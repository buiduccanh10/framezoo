#!/usr/bin/env python3
"""JSON-lines libtorrent sidecar used by the Electron main process."""

from __future__ import annotations

import json
import sys

from torrent_constants import (
    CLIENT_DISCONNECT_GRACE_SECS,
    DEFAULT_MAX_TORRENT_BYTES,
    FILE_OPEN_RETRY_INTERVAL,
    RANGE_PREFETCH_BYTES,
    RANGE_RESPONSE_MAX_BYTES,
    RANGE_RETRY_INTERVAL,
    RANGE_WAIT_TIMEOUT,
    STREAM_CHUNK_SIZE,
    VIDEO_EXTENSIONS,
)
from torrent_engine import LibtorrentEngine
from torrent_http import (
    TorrentHttpHandler,
    TorrentHttpServer,
    QuietHTTPServer,
    emit,
    get_local_cors_origin,
    is_client_connected,
    log_event,
    write_cors_headers,
)
from torrent_runtime import TorrentRuntime
from torrent_utils import (
    cap_open_ended_range,
    enforce_storage_limit,
    get_dir_size,
    get_magnet,
    get_torrent_data_dir,
    normalized_info_hash,
    parse_range,
    safe_file_name,
    select_file,
    torrent_hash,
)


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
