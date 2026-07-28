#!/usr/bin/env python3
"""JSON-lines libtorrent sidecar used by the Electron main process."""

from __future__ import annotations

import glob
import json
import math
import mimetypes
import os
import shutil
import sys
import tempfile
import threading
import time
import warnings
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib.parse import urlparse

warnings.filterwarnings("ignore", category=DeprecationWarning)

import libtorrent as lt


OUTPUT_LOCK = threading.Lock()
VIDEO_EXTENSIONS = (".avi", ".m4v", ".mkv", ".mov", ".mp4", ".webm")
STREAM_CHUNK_SIZE = 1024 * 1024
RANGE_PREFETCH_BYTES = 32 * 1024 * 1024
RANGE_WAIT_TIMEOUT = 90
RANGE_RETRY_INTERVAL = 0.2
FILE_OPEN_RETRY_INTERVAL = 0.2

def log_event(message: str, **fields: Any) -> None:
    if "sessionId" in fields and "playbackId" not in fields:
        fields["playbackId"] = fields["sessionId"]
    suffix = " " + json.dumps(fields, separators=(",", ":")) if fields else ""
    sys.stderr.write(f"[sidecar] {message}{suffix}\n")
    sys.stderr.flush()


def emit(message: Dict[str, Any]) -> None:
    with OUTPUT_LOCK:
        sys.stdout.write(json.dumps(message, separators=(",", ":")) + "\n")
        sys.stdout.flush()

def get_local_cors_origin(handler: BaseHTTPRequestHandler) -> Optional[str]:
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


def normalized_info_hash(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    value = value.strip()
    if value.lower().startswith("urn:btih:"):
        value = value[9:]
    return value.lower() or None


def get_magnet(request: Dict[str, Any]) -> str:
    url = request.get("url")
    if isinstance(url, str) and url.strip().lower().startswith("magnet:"):
        return url.strip()

    info_hash = normalized_info_hash(request.get("infoHash"))
    if info_hash:
        return "magnet:?xt=urn:btih:" + info_hash

    raise ValueError("torrent request requires a magnet URL or infoHash")


def safe_file_name(value: str) -> str:
    return value.replace("\\", "/").rsplit("/", 1)[-1].lower()


def select_file(info: Any, request: Dict[str, Any]) -> Tuple[int, str, int]:
    files = info.files()
    entries = [
        (index, str(files.file_path(index)), int(files.file_size(index)))
        for index in range(files.num_files())
    ]
    entries = [entry for entry in entries if entry[2] > 0]
    if not entries:
        raise ValueError("torrent contains no non-empty files")

    requested_index = request.get("fileIdx")
    if isinstance(requested_index, int):
        for index, path, size in entries:
            if index == requested_index:
                return index, path, size

    requested_name = request.get("fileName")
    if isinstance(requested_name, str) and requested_name.strip():
        wanted = safe_file_name(requested_name)
        for index, path, size in entries:
            if safe_file_name(path) == wanted:
                return index, path, size

    video_entries = [
        entry
        for entry in entries
        if safe_file_name(entry[1]).endswith(VIDEO_EXTENSIONS)
    ]
    return max(video_entries or entries, key=lambda entry: entry[2])


def torrent_hash(info: Any, fallback: Any) -> Optional[str]:
    value = normalized_info_hash(fallback)
    if value:
        return value
    try:
        return str(info.info_hash()).lower()
    except Exception:
        return None


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
        import sys
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


class TorrentRuntime:
    def __init__(
        self,
        engine: "LibtorrentEngine",
        session_id: str,
        request: Dict[str, Any],
        handle: Any,
        save_path: str,
    ) -> None:
        self.engine = engine
        self.session_id = session_id
        self.request = request
        self.handle = handle
        self.save_path = save_path
        self.info: Any = None
        self.file_index: Optional[int] = None
        self.file_path = ""
        self.file_size = 0
        self.stream_url = ""
        self.raw_stream_url = ""  # always points to /torrent/ route
        self.stream_type = "pending"
        self.start_time = self._get_requested_start_time()
        self._torrent_cleaned = False
        self.stop_event = threading.Event()
        self.metadata_ready = threading.Event()
        self.metadata_complete = threading.Event()
        self.metadata_error: Optional[str] = None
        self.metadata_thread: Optional[threading.Thread] = None
        self.first_request_logged = False
        self.request_count = 0
        self.last_range_key: Optional[Tuple[int, int]] = None
        self.status_thread = threading.Thread(
            target=self.publish_status,
            name="torrent-status-" + session_id,
            daemon=True,
        )

    def _get_requested_start_time(self) -> float:
        value = self.request.get("startAt", 0)
        try:
            value = float(value)
        except (TypeError, ValueError):
            return 0.0
        return max(0.0, value) if math.isfinite(value) else 0.0

    def start(self) -> None:
        self.raw_stream_url = self.engine.http_server.register(self)
        self.stream_type = "file"
        self.stream_url = self.raw_stream_url
        log_event(
            "session started",
            sessionId=self.session_id,
            sourceId=self.request.get("sourceId", ""),
            streamUrl=self.stream_url,
        )
        self.status_thread.start()
        self.metadata_thread = threading.Thread(
            target=self.initialize_metadata,
            name="torrent-metadata-" + self.session_id,
            daemon=True,
        )
        self.metadata_thread.start()

    def initialize_metadata(self) -> None:
        try:
            self.wait_for_metadata(90)
        except Exception as error:
            self.metadata_error = str(error)
            log_event(
                "metadata failed",
                sessionId=self.session_id,
                error=self.metadata_error,
            )
        finally:
            self.metadata_complete.set()

    def wait_for_metadata(self, timeout: float) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline and not self.stop_event.is_set():
            status = self.handle.status()
            if status.has_metadata:
                self.info = self.handle.torrent_file()
                if self.info is None:
                    raise ValueError("libtorrent returned no torrent metadata")
                (
                    self.file_index,
                    self.file_path,
                    self.file_size,
                ) = select_file(self.info, self.request)
                priorities = [0] * self.info.files().num_files()
                priorities[self.file_index] = 7
                self.handle.prioritize_files(priorities)
                self.handle.set_sequential_download(True)
                self.prioritize_range(
                    0,
                    RANGE_PREFETCH_BYTES,
                    reason="metadata",
                )
                self.metadata_ready.set()
                log_event(
                    "metadata ready",
                    sessionId=self.session_id,
                    fileName=self.file_path.rsplit("/", 1)[-1],
                    fileSize=self.file_size,
                )
                return
            time.sleep(0.2)
        raise TimeoutError("timed out waiting for torrent metadata")

    def session_payload(self) -> Dict[str, Any]:
        return {
            "sessionId": self.session_id,
            "sourceId": self.request.get("sourceId", ""),
            "streamUrl": self.stream_url,
            "streamType": self.stream_type,
            "startAt": self.start_time,
            "duration": None,
            "fileName": (
                self.file_path.rsplit("/", 1)[-1]
                or self.request.get("fileName")
                or None
            ),
            "infoHash": torrent_hash(
                self.info,
                self.request.get("infoHash"),
            ),
        }

    def stop(self) -> None:
        self.stop_event.set()
        self.engine.http_server.unregister(self.session_id)
        log_event("session stopped", sessionId=self.session_id)
        if not self._torrent_cleaned:
            try:
                self.engine.session.remove_torrent(self.handle)
            except Exception:
                pass
            shutil.rmtree(self.save_path, ignore_errors=True)

    def current_status(self) -> Dict[str, Any]:
        status = self.handle.status()
        file_progress = 0
        if self.file_index is not None:
            try:
                progress = self.handle.file_progress()
                file_progress = int(progress[self.file_index])
            except Exception:
                file_progress = int(getattr(status, "total_done", 0))

        total = self.file_size or None
        progress_value = (
            100.0
            if total and file_progress >= total
            else ((file_progress / total) * 100.0 if total else 0.0)
        )
        stream_error = self.metadata_error
        if stream_error:
            lifecycle = "error"
        elif not status.has_metadata:
            lifecycle = "starting"
        elif total and file_progress >= total:
            lifecycle = "ready"
        elif getattr(status, "download_rate", 0) > 0:
            lifecycle = "downloading"
        else:
            lifecycle = "buffering"

        return {
            "sessionId": self.session_id,
            "sourceId": self.request.get("sourceId", ""),
            "state": lifecycle,
            "progress": progress_value,
            "speedBytesPerSecond": int(getattr(status, "download_rate", 0)),
            "peers": int(getattr(status, "num_peers", 0)),
            "infoHash": torrent_hash(
                self.info,
                self.request.get("infoHash"),
            ),
            "fileName": (
                self.file_path.rsplit("/", 1)[-1]
                or self.request.get("fileName")
                or None
            ),
            "downloadedBytes": file_progress,
            "totalBytes": total,
            "streamType": self.stream_type,
            "streamUrl": self.stream_url or None,
            "startAt": self.start_time,
            "duration": None,
            "error": stream_error,
            "updatedAt": int(time.time() * 1000),
        }

    def publish_status(self) -> None:
        while not self.stop_event.is_set():
            try:
                emit({"type": "status", "status": self.current_status()})
            except Exception:
                return
            self.stop_event.wait(0.5)

    def map_pieces(self, start: int, length: int) -> Set[int]:
        if self.info is None or self.file_index is None:
            return set()

        def mapped_piece(offset: int) -> Optional[int]:
            try:
                slices = self.info.map_file(
                    self.file_index,
                    offset,
                    1,
                )
            except Exception:
                return None
            if isinstance(slices, (list, tuple)):
                slices = slices[0] if slices else None
            piece = getattr(slices, "piece", None)
            return piece if isinstance(piece, int) else None

        end = min(self.file_size, start + max(1, length)) - 1
        if end < start:
            return set()

        first_piece = mapped_piece(start)
        last_piece = mapped_piece(end)
        if first_piece is None or last_piece is None:
            return set()
        return set(range(first_piece, last_piece + 1))

    def prioritize_range(
        self,
        start: int,
        length: int,
        reason: str,
    ) -> None:
        pieces = sorted(self.map_pieces(start, length))
        missing_pieces = [
            piece for piece in pieces if not self.handle.have_piece(piece)
        ]
        for index, piece in enumerate(missing_pieces):
            try:
                self.handle.piece_priority(piece, 7)
                self.handle.set_piece_deadline(
                    piece,
                    index * 25,
                    lt.deadline_flags_t.alert_when_available,
                )
            except Exception:
                continue
        log_event(
            "range prioritized",
            sessionId=self.session_id,
            reason=reason,
            start=start,
            length=length,
            pieces=len(pieces),
            missingPieces=len(missing_pieces),
        )

    def wait_for_range(
        self,
        start: int,
        end: int,
        timeout: float = RANGE_WAIT_TIMEOUT,
    ) -> bool:
        prefetch_length = max(end - start + 1, RANGE_PREFETCH_BYTES)
        required_pieces = sorted(self.map_pieces(start, end - start + 1))
        all_pieces = sorted(self.map_pieces(start, prefetch_length))
        range_key = (start, end)
        if getattr(self, "last_range_key", None) != range_key:
            self.last_range_key = range_key
            try:
                status = self.handle.status()
                piece_flags = getattr(status, "pieces", None)
                piece_count = len(piece_flags) if piece_flags is not None else None
                first_piece_available = (
                    bool(piece_flags[0])
                    if piece_flags is not None and len(piece_flags) > 0
                    else None
                )
            except Exception:
                piece_count = None
                first_piece_available = None
            log_event(
                "range wait",
                sessionId=self.session_id,
                start=start,
                end=end,
                requiredPieces=len(required_pieces),
                firstPiece=min(required_pieces) if required_pieces else None,
                lastPiece=max(required_pieces) if required_pieces else None,
                prefetchPieces=len(all_pieces),
                pieceCount=piece_count,
                firstPieceAvailable=first_piece_available,
            )

        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline and not self.stop_event.is_set():
            missing_required = [
                piece
                for piece in required_pieces
                if not self.handle.have_piece(piece)
            ]
            if not missing_required:
                log_event(
                    "range ready",
                    sessionId=self.session_id,
                    start=start,
                    end=end,
                    requiredPieces=len(required_pieces),
                )
                return True

            # Required bytes win over read-ahead. Reapplying a short deadline
            # to the required pieces prevents sequential mode from starving a
            # demuxer request after an HTTP seek.
            for index, piece in enumerate(required_pieces):
                if not self.handle.have_piece(piece):
                    try:
                        self.handle.piece_priority(piece, 7)
                        self.handle.set_piece_deadline(
                            piece,
                            index * 10,
                            lt.deadline_flags_t.alert_when_available,
                        )
                    except Exception:
                        pass
            for index, piece in enumerate(all_pieces):
                if piece in required_pieces or self.handle.have_piece(piece):
                    continue
                try:
                    self.handle.piece_priority(piece, 7)
                    self.handle.set_piece_deadline(
                        piece,
                        500 + index * 50,
                        lt.deadline_flags_t.alert_when_available,
                    )
                except Exception:
                    pass
            time.sleep(RANGE_RETRY_INTERVAL)
        return not required_pieces

    def read_range_chunk(
        self,
        stream: Any,
        start: int,
        end: int,
    ) -> Optional[bytes]:
        expected_length = end - start + 1
        deadline = time.monotonic() + RANGE_WAIT_TIMEOUT

        while time.monotonic() < deadline and not self.stop_event.is_set():
            if not self.wait_for_range(start, end):
                return None

            stream.seek(start)
            chunk = stream.read(expected_length)
            if len(chunk) == expected_length:
                return chunk

            # libtorrent can finish a piece before the file descriptor sees
            # the complete range. Retry instead of sending a short 206 body.
            time.sleep(RANGE_RETRY_INTERVAL)

        return None

    def serve(self, handler: BaseHTTPRequestHandler, head_only: bool) -> None:
        request_number = getattr(self, "request_count", 0) + 1
        self.request_count = request_number
        if not self.first_request_logged:
            self.first_request_logged = True
            log_event(
                "first HTTP request",
                sessionId=self.session_id,
                method=handler.command,
                range=handler.headers.get("Range"),
            )
        else:
            log_event(
                "HTTP request",
                sessionId=self.session_id,
                request=request_number,
                method=handler.command,
                range=handler.headers.get("Range"),
            )
        if not self.metadata_ready.is_set():
            self.metadata_complete.wait(RANGE_WAIT_TIMEOUT)
        if self.metadata_error:
            handler.send_error(502, self.metadata_error)
            return
        if not self.metadata_ready.is_set() or self.file_index is None:
            handler.send_error(425, "Torrent metadata is not ready")
            return

        total = self.file_size
        range_header = handler.headers.get("Range")
        try:
            byte_range = parse_range(range_header, total)
        except (TypeError, ValueError):
            byte_range = None
        if byte_range is None and range_header:
            handler.send_response(416)
            handler.send_header("Content-Range", "bytes */%d" % total)
            handler.send_header("Connection", "close")
            handler.end_headers()
            log_event(
                "HTTP range rejected",
                sessionId=self.session_id,
                request=request_number,
                range=range_header,
                total=total,
            )
            return

        if byte_range is None:
            start, end, status_code = 0, max(0, total - 1), 200
        else:
            start, end, status_code = byte_range[0], byte_range[1], 206

        relative_path = self.file_path.replace("\\", "/")
        absolute_path = os.path.abspath(
            os.path.join(self.save_path, relative_path),
        )
        root = os.path.abspath(self.save_path)
        if not absolute_path.startswith(root + os.sep):
            handler.send_error(500, "Invalid torrent file path")
            return

        content_type = (
            mimetypes.guess_type(absolute_path)[0]
            or "application/octet-stream"
        )
        length = max(0, end - start + 1)

        stream = None
        first_chunk: Optional[bytes] = None
        if not head_only and length > 0:
            # Do not send a successful response until the first bytes exist.
            # A 206 header followed by an empty body makes libmpv classify the
            # torrent as a stalled HTTP stream.
            stream, first_chunk = self.open_first_chunk(
                absolute_path,
                start,
                end,
            )
            if stream is None or first_chunk is None:
                log_event(
                    "range unavailable",
                    sessionId=self.session_id,
                    request=request_number,
                    start=start,
                    end=end,
                )
                handler.send_error(504, "Torrent range is not available")
                return

        handler.send_response(status_code)
        handler.send_header("Accept-Ranges", "bytes")
        handler.send_header("Content-Type", content_type)
        handler.send_header("Content-Length", str(length))
        if status_code == 206:
            handler.send_header(
                "Content-Range",
                "bytes %d-%d/%d" % (start, end, total),
            )
        handler.end_headers()
        handler.wfile.flush()
        log_event(
            "HTTP response headers sent",
            sessionId=self.session_id,
            status=status_code,
            start=start,
            end=end,
            length=length,
            firstChunkBytes=len(first_chunk) if first_chunk is not None else 0,
            request=request_number,
        )

        if head_only or length == 0:
            return

        try:
            offset = start
            chunk = first_chunk
            while offset <= end:
                if chunk is None:
                    chunk_end = min(end, offset + STREAM_CHUNK_SIZE - 1)
                    chunk = self.read_range_chunk(stream, offset, chunk_end)
                    if chunk is None:
                        handler.close_connection = True
                        return

                handler.wfile.write(chunk)
                handler.wfile.flush()
                offset += len(chunk)
                chunk = None
            log_event(
                "HTTP response complete",
                sessionId=self.session_id,
                request=request_number,
                start=start,
                end=end,
                bytesSent=offset - start,
            )
        except (BrokenPipeError, ConnectionResetError):
            log_event(
                "HTTP response disconnected",
                sessionId=self.session_id,
                request=request_number,
                bytesSent=max(0, offset - start),
            )
            return
        finally:
            if stream is not None:
                stream.close()

    def open_first_chunk(
        self,
        absolute_path: str,
        start: int,
        end: int,
    ) -> Tuple[Optional[Any], Optional[bytes]]:
        """Wait for libtorrent to create and fill the first requested bytes."""
        chunk_end = min(end, start + STREAM_CHUNK_SIZE - 1)
        deadline = time.monotonic() + RANGE_WAIT_TIMEOUT

        while time.monotonic() < deadline and not self.stop_event.is_set():
            try:
                stream = open(absolute_path, "rb")
            except FileNotFoundError:
                time.sleep(FILE_OPEN_RETRY_INTERVAL)
                continue
            except OSError:
                return None, None

            chunk = self.read_range_chunk(stream, start, chunk_end)
            if chunk is not None:
                return stream, chunk

            stream.close()
            if self.stop_event.is_set():
                break
            time.sleep(FILE_OPEN_RETRY_INTERVAL)

        return None, None


def parse_range(
    value: Optional[str],
    size: int,
) -> Optional[Tuple[int, int]]:
    if not value:
        return None
    if not value.lower().startswith("bytes=") or "," in value:
        return None

    raw_start, raw_end = value[6:].split("-", 1)
    if not raw_start:
        suffix = int(raw_end)
        if suffix <= 0:
            return None
        return max(0, size - suffix), max(0, size - 1)

    start = int(raw_start)
    end = int(raw_end) if raw_end else size - 1
    if start < 0 or start >= size or end < start:
        return None
    return start, min(end, size - 1)


DEFAULT_MAX_TORRENT_BYTES = 5 * 1024 * 1024 * 1024  # 5 GB


def get_torrent_data_dir() -> str:
    env_dir = os.environ.get("BETAMOVIE_TORRENT_DATA_DIR")
    if env_dir:
        os.makedirs(env_dir, exist_ok=True)
        return os.path.abspath(env_dir)
    fallback = (
        os.path.expanduser("~/Library/Application Support/AlphaFlix/torrents")
        if sys.platform == "darwin"
        else os.path.join(tempfile.gettempdir(), "betamovie-torrents")
    )
    os.makedirs(fallback, exist_ok=True)
    return os.path.abspath(fallback)


def get_dir_size(path: str) -> int:
    total = 0
    try:
        for root, _, files in os.walk(path):
            for f in files:
                fp = os.path.join(root, f)
                if not os.path.islink(fp):
                    total += os.path.getsize(fp)
    except Exception:
        pass
    return total


def enforce_storage_limit(
    root_dir: str,
    max_bytes: int = DEFAULT_MAX_TORRENT_BYTES,
    active_paths: Optional[Set[str]] = None,
) -> None:
    if active_paths is None:
        active_paths = set()

    max_bytes_env = os.environ.get("BETAMOVIE_TORRENT_MAX_SIZE_BYTES")
    if max_bytes_env:
        try:
            max_bytes = int(max_bytes_env)
        except ValueError:
            pass

    if not os.path.exists(root_dir):
        return

    candidate_dirs: List[str] = []

    # 1. Directories inside root_dir
    try:
        for entry in os.listdir(root_dir):
            full_path = os.path.join(root_dir, entry)
            if os.path.isdir(full_path):
                candidate_dirs.append(full_path)
    except Exception:
        pass

    # 2. Legacy directories in system tempdir
    temp_dir = tempfile.gettempdir()
    if os.path.abspath(temp_dir) != os.path.abspath(root_dir):
        try:
            for entry in os.listdir(temp_dir):
                if entry.startswith("betamovie-torrent-"):
                    full_path = os.path.join(temp_dir, entry)
                    if os.path.isdir(full_path):
                        candidate_dirs.append(full_path)
        except Exception:
            pass

    norm_active = {os.path.abspath(p) for p in active_paths}

    items: List[Tuple[str, int, float]] = []
    total_size = 0
    for d in candidate_dirs:
        abs_d = os.path.abspath(d)
        size = get_dir_size(abs_d)
        total_size += size
        if abs_d not in norm_active:
            try:
                mtime = os.path.getmtime(abs_d)
            except Exception:
                mtime = 0
            items.append((abs_d, size, mtime))

    if total_size <= max_bytes:
        return

    # Sort inactive folders by mtime ascending (oldest first)
    items.sort(key=lambda x: x[2])

    for abs_d, size, _ in items:
        if total_size <= max_bytes:
            break
        try:
            shutil.rmtree(abs_d, ignore_errors=True)
            total_size -= size
            sys.stderr.write(
                f"[sidecar] Pruned old torrent cache: {abs_d} ({size} bytes)\n"
            )
        except Exception as err:
            sys.stderr.write(f"[sidecar] Failed to prune {abs_d}: {err}\n")


class LibtorrentEngine:
    def __init__(self) -> None:
        self.session = lt.session(
            {
                "listen_interfaces": "0.0.0.0:6881-6891",
                "enable_dht": True,
                "enable_lsd": True,
                "enable_upnp": True,
                "enable_natpmp": True,
            },
        )
        try:
            self.session.start_dht()
        except Exception:
            pass
        self.http_server = TorrentHttpServer()
        self.sessions: Dict[str, TorrentRuntime] = {}
        self.lock = threading.RLock()

        try:
            root = get_torrent_data_dir()
            enforce_storage_limit(root)
        except Exception as err:
            sys.stderr.write(f"[sidecar] Initial storage cleanup error: {err}\n")

    def start(
        self,
        session_id: str,
        request: Dict[str, Any],
    ) -> Dict[str, Any]:
        magnet = get_magnet(request)
        root = get_torrent_data_dir()
        with self.lock:
            active_paths = {r.save_path for r in self.sessions.values()}
        try:
            enforce_storage_limit(root, active_paths=active_paths)
        except Exception as err:
            sys.stderr.write(
                f"[sidecar] Storage limit enforcement error: {err}\n"
            )

        save_path = tempfile.mkdtemp(
            prefix="betamovie-torrent-",
            dir=root,
        )
        params = lt.parse_magnet_uri(magnet)
        params.save_path = save_path
        params.storage_mode = lt.storage_mode_t.storage_mode_sparse
        handle = self.session.add_torrent(params)
        runtime = TorrentRuntime(
            self,
            session_id,
            request,
            handle,
            save_path,
        )
        with self.lock:
            self.sessions[session_id] = runtime
        runtime.start()

        # Return the local file route immediately. Metadata continues in the
        # runtime thread while the HTTP handler waits for requested pieces.
        return runtime.session_payload()

    def stop(self, session_id: str) -> None:
        with self.lock:
            runtime = self.sessions.pop(session_id, None)
        if runtime is not None:
            runtime.stop()

    def close(self) -> None:
        for session_id in list(self.sessions.keys()):
            self.stop(session_id)
        self.http_server.close()


def main() -> None:
    engine = LibtorrentEngine()
    try:
        for line in sys.stdin:
            if not line.strip():
                continue
            message = json.loads(line)
            message_type = message.get("type")
            request_id = message.get("requestId")
            session_id = message.get("sessionId")
            try:
                if message_type == "start":
                    session = engine.start(
                        session_id,
                        message.get("request") or {},
                    )
                    emit(
                        {
                            "type": "response",
                            "requestId": request_id,
                            "ok": True,
                            "session": session,
                        },
                    )
                elif message_type == "stop":
                    engine.stop(session_id)
                    emit(
                        {
                            "type": "response",
                            "requestId": request_id,
                            "ok": True,
                        },
                    )
                else:
                    raise ValueError("unknown torrent sidecar message")
            except Exception as error:
                emit(
                    {
                        "type": "response",
                        "requestId": request_id,
                        "ok": False,
                        "error": str(error),
                    },
                )
    finally:
        engine.close()


if __name__ == "__main__":
    main()
