#!/usr/bin/env python3
"""JSON-lines libtorrent sidecar used by the Electron main process."""

from __future__ import annotations

import json
import os
import signal
import sys

from torrent_engine import LibtorrentEngine
from torrent_http import emit

def main() -> None:
    engine = LibtorrentEngine()

    def handle_signal(_signum: int, _frame: object) -> None:
        sys.exit(0)

    try:
        signal.signal(signal.SIGTERM, handle_signal)
        signal.signal(signal.SIGINT, handle_signal)
    except Exception:
        pass

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
                    if session_id:
                        engine.stop(session_id)
                    else:
                        for s_id in list(engine.sessions.keys()):
                            engine.stop(s_id)
                    emit(
                        {
                            "type": "response",
                            "requestId": request_id,
                            "ok": True,
                        },
                    )
                elif message_type == "stop_all":
                    for s_id in list(engine.sessions.keys()):
                        engine.stop(s_id)
                    with engine.lock:
                        for record in list(engine.records.values()):
                            if not record.session_ids:
                                record.pause_discovery()
                                record.update_file_priorities()
                                if record.persistent_cache and record.cache_ready:
                                    engine._save_record_resume_data(record)
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
        try:
            engine.close()
        except Exception:
            pass
        os._exit(0)


if __name__ == "__main__":
    main()
