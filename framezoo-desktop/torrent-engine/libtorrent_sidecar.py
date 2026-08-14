#!/usr/bin/env python3
"""JSON-lines libtorrent sidecar used by the Electron main process."""

from __future__ import annotations

import json
import sys

from torrent_engine import LibtorrentEngine
from torrent_http import emit

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
                elif message_type == "ping":
                    # Forces _ensure_session() so the OS network-permission
                    # dialog appears now (at app startup) rather than later
                    # when the user first tries to start a stream.
                    engine._ensure_session()
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
