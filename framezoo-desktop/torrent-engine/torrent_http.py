from __future__ import annotations

import json
import select
import socket
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, Optional
from urllib.parse import urlparse

import torrent_constants as constants


OUTPUT_LOCK = threading.Lock()


def log_event(message: str, **fields: Any) -> None:
    if "sessionId" in fields and "playbackId" not in fields:
        fields["playbackId"] = fields["sessionId"]
    fields.setdefault("wallClockMs", int(time.time() * 1000))
    suffix = " " + json.dumps(fields, separators=(",", ":")) if fields else ""
    sys.stderr.write(f"[sidecar] {message}{suffix}\n")
    sys.stderr.flush()


def emit(message: Dict[str, Any]) -> None:
    with OUTPUT_LOCK:
        sys.stdout.write(json.dumps(message, separators=(",", ":")) + "\n")
        sys.stdout.flush()


def is_client_connected(
    handler: BaseHTTPRequestHandler,
    connect_start: float,
) -> bool:
    """Return False only if the client has clearly closed the connection.

    We apply a grace period (CLIENT_DISCONNECT_GRACE_SECS) so we don't
    mistakenly kill a request that is still being set up by the client.
    """
    if (
        time.monotonic() - connect_start
        < constants.CLIENT_DISCONNECT_GRACE_SECS
    ):
        return True
    try:
        readable, _, _ = select.select([handler.connection], [], [], 0)
        if readable:
            message = handler.connection.recv(1, socket.MSG_PEEK)
            if not message:
                return False
    except Exception:
        return False
    return True


def get_local_cors_origin(
    handler: BaseHTTPRequestHandler,
) -> Optional[str]:
    origin = handler.headers.get("Origin")
    if not origin:
        return None
    if origin == "null":
        return origin

    try:
        parsed = urlparse(origin)
    except ValueError:
        return None

    if parsed.scheme not in ("http", "https"):
        return None
    if parsed.hostname not in ("localhost", "127.0.0.1", "::1"):
        return None
    return origin


def write_cors_headers(handler: BaseHTTPRequestHandler) -> None:
    origin = get_local_cors_origin(handler)
    if origin:
        handler.send_header("Access-Control-Allow-Origin", origin)
        handler.send_header("Access-Control-Allow-Credentials", "true")
        handler.send_header("Vary", "Origin")
    handler.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
    handler.send_header(
        "Access-Control-Allow-Headers",
        "Range, Content-Type, Accept, Origin",
    )
    handler.send_header(
        "Access-Control-Expose-Headers",
        "Accept-Ranges, Content-Length, Content-Range",
    )


class TorrentHttpServer:
    def __init__(self) -> None:
        self.sessions: Dict[str, "TorrentRuntime"] = {}
        self.lock = threading.RLock()
        self.server = QuietHTTPServer(("127.0.0.1", 0), TorrentHttpHandler)
        self.server.runtime = self  # type: ignore[attr-defined]
        self.thread = threading.Thread(
            target=self.server.serve_forever,
            name="torrent-http",
            daemon=True,
        )
        self.thread.start()
        address = self.server.server_address
        self.base_url = "http://127.0.0.1:%d" % address[1]

    def register(self, runtime: "TorrentRuntime") -> str:
        with self.lock:
            self.sessions[runtime.session_id] = runtime
        return self.base_url + "/torrent/" + runtime.session_id

    def get(self, session_id: str) -> Optional["TorrentRuntime"]:
        with self.lock:
            return self.sessions.get(session_id)

    def unregister(self, session_id: str) -> None:
        with self.lock:
            self.sessions.pop(session_id, None)

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()


class QuietHTTPServer(ThreadingHTTPServer):
    def handle_error(self, request: Any, client_address: Any) -> None:
        exc_type, exc_value, _ = sys.exc_info()
        if isinstance(exc_value, (ConnectionResetError, BrokenPipeError)):
            return
        super().handle_error(request, client_address)


class TorrentHttpHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def end_headers(self) -> None:
        write_cors_headers(self)
        super().end_headers()

    def do_GET(self) -> None:
        self.handle_torrent_request(False)

    def do_HEAD(self) -> None:
        self.handle_torrent_request(True)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.end_headers()

    def handle_torrent_request(self, head_only: bool) -> None:
        parts = urlparse(self.path).path.strip("/").split("/")

        # Route: /torrent/<sessionId>
        runtime = (
            self.server.runtime.get(parts[1])
            if len(parts) == 2 and parts[0] == "torrent"
            else None
        )
        if runtime is None:
            self.send_error(404)
            return
        runtime.serve(self, head_only)

    def log_message(self, _format: str, *_args: Any) -> None:
        return
