from __future__ import annotations

import threading
import os
import sys
import tempfile
from typing import Any, Dict

import libtorrent as lt

from torrent_http import TorrentHttpServer
from torrent_runtime import TorrentRuntime
from torrent_utils import (
    enforce_storage_limit,
    get_magnet,
    get_torrent_data_dir,
)


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
        except Exception as error:
            sys.stderr.write(
                f"[sidecar] Initial storage cleanup error: {error}\n"
            )

    def start(
        self,
        session_id: str,
        request: Dict[str, Any],
    ) -> Dict[str, Any]:
        magnet = get_magnet(request)
        root = get_torrent_data_dir()
        with self.lock:
            active_paths = {runtime.save_path for runtime in self.sessions.values()}
        try:
            enforce_storage_limit(root, active_paths=active_paths)
        except Exception as error:
            sys.stderr.write(
                f"[sidecar] Storage limit enforcement error: {error}\n"
            )

        save_path = tempfile.mkdtemp(
            prefix="betamovie-torrent-",
            dir=root,
        )
        params = lt.parse_magnet_uri(magnet)
        params.save_path = save_path
        params.storage_mode = lt.storage_mode_t.storage_mode_sparse
        handle = self.session.add_torrent(params)

        actual_save_path = handle.status().save_path
        if actual_save_path != save_path:
            try:
                os.rmdir(save_path)
            except OSError:
                pass
            save_path = actual_save_path

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
