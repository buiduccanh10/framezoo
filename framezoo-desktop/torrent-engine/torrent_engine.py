from __future__ import annotations

import os
import shutil
import sys
import tempfile
import threading
from typing import Any, Dict, Optional, Set

import libtorrent as lt

import torrent_constants as constants
from torrent_discovery import TorrentDiscovery, get_local_ipv4
from torrent_http import TorrentHttpServer, log_event
from torrent_runtime import TorrentRuntime
from torrent_utils import (
    enforce_storage_limit,
    get_magnet,
    get_request_trackers,
    get_torrent_cache_key,
    get_torrent_data_dir,
    get_torrent_info_trackers,
    merge_tracker_sources,
)


class TorrentRecord:
    """Shared libtorrent handle and discovery state for one infohash."""

    def __init__(
        self,
        engine: "LibtorrentEngine",
        key: str,
        handle: Any,
        save_path: str,
        persistent_cache: bool,
        cache_ready: bool,
        trackers: list[str],
    ) -> None:
        self.engine = engine
        self.key = key
        self.handle = handle
        self.save_path = save_path
        self.persistent_cache = persistent_cache
        # Metadata alone must not make a failed startup reusable.
        self.cache_ready = cache_ready
        self.session_ids: Set[str] = set()
        self.lock = threading.RLock()
        self.removal_timer: Optional[threading.Timer] = None
        info_hash = None
        try:
            info_hash = handle.info_hash()
        except Exception:
            pass
        self.discovery = (
            TorrentDiscovery(
                engine.session,
                handle,
                info_hash,
                trackers,
                engine.peer_id,
                engine.listen_port,
            )
            if info_hash is not None
            else None
        )

    def start(self) -> None:
        if self.discovery is not None:
            self.discovery.start()

    def add_session(self, session_id: str) -> bool:
        with self.lock:
            was_idle = not self.session_ids
            if self.removal_timer is not None:
                self.removal_timer.cancel()
                self.removal_timer = None
            self.session_ids.add(session_id)
            return was_idle

    def remove_session(self, session_id: str) -> bool:
        with self.lock:
            self.session_ids.discard(session_id)
            return not self.session_ids

    def add_trackers(self, trackers: list[str]) -> None:
        if self.discovery is not None:
            self.discovery.add_trackers(trackers)

    def reactivate(self, session_id: str) -> None:
        try:
            self.handle.resume()
        except Exception:
            pass
        if self.discovery is None:
            return
        details = self.discovery.reactivate()
        try:
            info_hash = str(self.handle.info_hash())
        except Exception:
            info_hash = self.key
        log_event(
            "torrent handle reactivated",
            sessionId=session_id,
            infoHash=info_hash,
            cacheKey=self.key,
            discoveryPhase=self.snapshot().get("discoveryPhase"),
            **details,
        )

    def update_file_priorities(self) -> None:
        try:
            status = self.handle.status()
            if not status.has_metadata:
                return
            info = self.handle.torrent_file()
            if info is None:
                return
            priorities = [0] * info.files().num_files()
            with self.lock:
                for session_id in self.session_ids:
                    runtime = self.engine.sessions.get(session_id)
                    if runtime is not None and runtime.file_index is not None:
                        priorities[runtime.file_index] = constants.STREAM_IDLE_FILE_PRIORITY
            self.handle.prioritize_files(priorities)
        except Exception:
            pass

    def snapshot(self) -> dict[str, Any]:
        if self.discovery is None:
            return {
                "discoveryPhase": "unavailable",
                "trackersAttempted": 0,
                "trackersSucceeded": 0,
                "peersDiscovered": 0,
                "peersInjected": 0,
                "dhtRunning": False,
                "lastDiscoveryAt": None,
                "lastDiscoveryError": None,
            }
        return self.discovery.snapshot()

    def stop_discovery(self) -> None:
        if self.discovery is not None:
            self.discovery.stop()


class LibtorrentEngine:
    def __init__(self) -> None:
        self._session: Any = None
        self._session_lock = threading.Lock()
        self._start_lock = threading.Lock()
        self.http_server = TorrentHttpServer()
        self.sessions: Dict[str, TorrentRuntime] = {}
        self.records: Dict[str, TorrentRecord] = {}
        self.session_records: Dict[str, str] = {}
        self.lock = threading.RLock()
        self._alert_lock = threading.Lock()
        self._finished_blocks: dict[str, Set[tuple[int, int]]] = {}
        self.peer_id = b"-FZ0001-" + os.urandom(12)
        self.listen_address: Optional[str] = None
        self.listen_port = 6881

        try:
            root = get_torrent_data_dir()
            enforce_storage_limit(root)
        except Exception as error:
            sys.stderr.write(
                f"[sidecar] Initial storage cleanup error: {error}\n",
            )

    def _network_settings(self) -> dict[str, Any]:
        address = get_local_ipv4()
        self.listen_address = address
        if address:
            return {
                "listen_interfaces": f"{address}:6881-6891",
                "outgoing_interfaces": address,
            }
        return {
            "listen_interfaces": "0.0.0.0:6881-6891",
        }

    def _ensure_session(self) -> Any:
        if self._session is not None:
            return self._session
        with self._session_lock:
            if self._session is not None:
                return self._session
            settings = {
                **self._network_settings(),
                "connections_limit": 400,
                "enable_dht": True,
                "enable_lsd": True,
                "enable_upnp": True,
                "enable_natpmp": True,
                "connection_speed": 500,
                "request_queue_time": 1,
                "max_out_request_queue": 1500,
                "max_allowed_in_request_queue": 2000,
                "whole_pieces_threshold": 0,
                "peer_connect_timeout": 2,
                "piece_timeout": 3,
                "aio_threads": 8,
                "send_buffer_watermark": 4 * 1024 * 1024,
                "suggest_mode": 1,
                "mixed_mode_algorithm": 0,
                # Playback requests byte ranges inside shared pieces. Avoid
                # disk-locality heuristics that delay those partial ranges.
                "piece_extent_affinity": False,
                "active_downloads": -1,
                "active_limit": -1,
                "announce_to_all_trackers": True,
                "announce_to_all_tiers": True,
                "allow_multiple_connections_per_ip": True,
            }
            alert_category = getattr(
                getattr(lt, "alert", None),
                "category_t",
                None,
            )
            block_progress = getattr(
                alert_category,
                "block_progress_notification",
                None,
            )
            if block_progress is not None:
                settings["alert_mask"] = int(block_progress)
            session = lt.session(settings)
            try:
                session.start_dht()
            except Exception:
                pass
            try:
                self.listen_port = int(session.listen_port())
            except Exception:
                self.listen_port = 6881
            self._session = session
            log_event(
                "torrent network ready",
                listenAddress=self.listen_address,
                listenPort=self.listen_port,
            )
        return self._session

    @property
    def session(self) -> Any:
        return self._ensure_session()

    def _create_record(
        self,
        session_id: str,
        request: Dict[str, Any],
        cache_key: Optional[str],
        save_path: str,
        trackers: list[str],
    ) -> TorrentRecord:
        session = self._ensure_session()
        resume_data = b""
        torrent_info = None
        cache_ready = False

        if cache_key:
            cache_ready = os.path.isfile(
                os.path.join(save_path, ".framezoo-stream-ready"),
            )
            torrent_path = os.path.join(save_path, cache_key + ".torrent")
            resume_path = os.path.join(save_path, "resume.dat")
            if not cache_ready:
                # Older versions saved this control state after metadata, even
                # when no media bytes ever reached the player. Never restore it.
                for stale_path in (torrent_path, resume_path):
                    try:
                        os.remove(stale_path)
                    except FileNotFoundError:
                        pass
                    except OSError as error:
                        sys.stderr.write(
                            "[sidecar] Failed to discard unplayable cache state: "
                            f"{error}\n",
                        )
            if cache_ready and os.path.exists(torrent_path):
                try:
                    torrent_info = lt.torrent_info(torrent_path)
                except Exception as error:
                    sys.stderr.write(
                        f"[sidecar] Failed to load cached torrent file: {error}\n",
                    )
            if cache_ready and os.path.exists(resume_path):
                try:
                    with open(resume_path, "rb") as file:
                        resume_data = file.read()
                except OSError:
                    resume_data = b""

        magnet = get_magnet(request)
        magnet_params = lt.parse_magnet_uri(magnet)
        magnet_trackers = list(getattr(magnet_params, "trackers", []))
        cached_trackers = get_torrent_info_trackers(torrent_info)
        params = magnet_params
        if torrent_info is not None:
            # A cached torrent_info is authoritative. Do not combine it with
            # magnet params; libtorrent rejects that combination as a hash
            # mismatch even when both hashes are equal.
            params = lt.add_torrent_params()
            params.ti = torrent_info
        params.save_path = save_path

        if resume_data:
            try:
                resume_params = lt.read_resume_data(resume_data)
                if torrent_info is not None and getattr(
                    resume_params,
                    "ti",
                    None,
                ) is None:
                    resume_params.ti = torrent_info
                resume_params.trackers = merge_tracker_sources(
                    resume_params.trackers,
                    cached_trackers,
                    magnet_trackers,
                    trackers,
                    constants.DEFAULT_TRACKERS,
                )
                url_seeds = list(resume_params.url_seeds)
                for url_seed in params.url_seeds:
                    if url_seed not in url_seeds:
                        url_seeds.append(url_seed)
                resume_params.url_seeds = url_seeds
                resume_params.save_path = save_path
                params = resume_params
            except Exception as error:
                sys.stderr.write(
                    f"[sidecar] Failed to parse resume data: {error}\n",
                )

        params.trackers = merge_tracker_sources(
            getattr(params, "trackers", []),
            cached_trackers,
            magnet_trackers,
            trackers,
            constants.DEFAULT_TRACKERS,
        )
        params.storage_mode = lt.storage_mode_t.storage_mode_sparse
        torrent_flags = getattr(lt, "torrent_flags", None)
        auto_managed = getattr(torrent_flags, "auto_managed", None)
        paused = getattr(torrent_flags, "paused", None)
        if auto_managed is not None:
            try:
                params.flags &= ~auto_managed
                if paused is not None:
                    params.flags &= ~paused
            except Exception:
                pass

        handle = session.add_torrent(params)
        actual_save_path = handle.status().save_path
        if actual_save_path != save_path:
            try:
                os.rmdir(save_path)
            except OSError:
                pass
            save_path = actual_save_path

        key = cache_key or session_id
        record = TorrentRecord(
            self,
            key,
            handle,
            save_path,
            persistent_cache=bool(cache_key),
            cache_ready=cache_ready,
            trackers=merge_tracker_sources(
                cached_trackers,
                magnet_trackers,
                trackers,
                constants.DEFAULT_TRACKERS,
            ),
        )
        with self.lock:
            self.records[key] = record
        record.start()
        return record

    def start(
        self,
        session_id: str,
        request: Dict[str, Any],
    ) -> Dict[str, Any]:
        self._ensure_session()
        root = get_torrent_data_dir()
        cache_key = get_torrent_cache_key(request)
        trackers = get_request_trackers(request)
        record_key = cache_key or session_id

        with self._start_lock:
            record_was_idle = False
            with self.lock:
                record = self.records.get(record_key)
                if record is not None:
                    record.add_trackers(trackers)
                    record_was_idle = record.add_session(session_id)
            if record is not None:
                runtime = TorrentRuntime(
                    self,
                    session_id,
                    request,
                    record.handle,
                    record.save_path,
                    persistent_cache=record.persistent_cache,
                    record=record,
                )
                with self.lock:
                    self.sessions[session_id] = runtime
                    self.session_records[session_id] = record_key
                if record_was_idle:
                    record.reactivate(session_id)
                runtime.start()
                log_event(
                    "torrent handle reused",
                    sessionId=session_id,
                    cacheKey=record_key,
                    activeSessions=len(record.session_ids),
                    reactivated=record_was_idle,
                )
                return runtime.session_payload()

            if cache_key:
                save_path = os.path.join(root, "torrent-" + cache_key)
                os.makedirs(save_path, exist_ok=True)
            else:
                save_path = tempfile.mkdtemp(
                    prefix="framezoo-torrent-",
                    dir=root,
                )

            try:
                with self.lock:
                    active_paths = {
                        runtime.save_path for runtime in self.sessions.values()
                    }
                active_paths.add(save_path)
                
                max_bytes_override = request.get("maxBytes")
                if max_bytes_override is not None:
                    enforce_storage_limit(
                        root,
                        max_bytes=max_bytes_override,
                        active_paths=active_paths,
                    )
                else:
                    enforce_storage_limit(root, active_paths=active_paths)
            except Exception as error:
                sys.stderr.write(
                    f"[sidecar] Storage limit enforcement error: {error}\n",
                )

            record = self._create_record(
                session_id,
                request,
                cache_key,
                save_path,
                trackers,
            )
            record.add_session(session_id)
            runtime = TorrentRuntime(
                self,
                session_id,
                request,
                record.handle,
                record.save_path,
                persistent_cache=record.persistent_cache,
                record=record,
            )
            with self.lock:
                self.sessions[session_id] = runtime
                self.session_records[session_id] = record.key
            runtime.start()
            return runtime.session_payload()

    def _remove_record(self, record_key: str) -> None:
        with self.lock:
            record = self.records.get(record_key)
            if record is None:
                return
            with record.lock:
                if record.session_ids:
                    return
                self.records.pop(record_key, None)
        record.stop_discovery()
        if record.persistent_cache and record.cache_ready:
            self._save_record_resume_data(record)
            try:
                os.utime(record.save_path, None)
            except OSError:
                pass
        try:
            self.session.remove_torrent(record.handle)
        except Exception:
            pass
        if not record.persistent_cache or not record.cache_ready:
            shutil.rmtree(record.save_path, ignore_errors=True)

    def _schedule_record_removal(self, record_key: str) -> None:
        remove_now = False
        with self.lock:
            record = self.records.get(record_key)
            if record is None or record.session_ids:
                return
            if not record.cache_ready:
                remove_now = True
            else:
                timer = threading.Timer(
                    constants.TORRENT_HANDLE_GRACE_SECONDS,
                    self._remove_record,
                    args=(record_key,),
                )
                timer.daemon = True
                record.removal_timer = timer
                timer.start()
        if remove_now:
            self._remove_record(record_key)

    def _save_record_resume_data(self, record: TorrentRecord) -> bool:
        if not record.persistent_cache or not record.cache_ready:
            return False
        try:
            data = lt.bencode(record.handle.write_resume_data())
            with open(
                os.path.join(record.save_path, "resume.dat"),
                "wb",
            ) as file:
                file.write(data)
            return True
        except Exception as error:
            sys.stderr.write(f"[sidecar] Failed to save resume data: {error}\n")
            return False

    def stop(self, session_id: str) -> None:
        with self._start_lock:
            with self.lock:
                runtime = self.sessions.pop(session_id, None)
                record_key = self.session_records.pop(session_id, None)
                record = self.records.get(record_key) if record_key else None
            if runtime is None:
                return
            runtime.stop(remove_torrent=False)
            if record is not None:
                is_empty = record.remove_session(session_id)
                if is_empty:
                    runtime.release_playback_schedule()
                    record.stop_discovery()
                    try:
                        record.handle.pause()
                    except Exception:
                        pass
                record.update_file_priorities()
                if is_empty:
                    self._save_record_resume_data(record)
                    self._schedule_record_removal(record.key)

    def get_discovery_status(self, record: Any) -> dict[str, Any]:
        snapshot = record.snapshot() if record is not None else {}
        if self.listen_address:
            snapshot["listenAddress"] = self.listen_address
        return snapshot

    def finished_blocks_for(self, handle: Any) -> Set[tuple[int, int]]:
        """Return blocks libtorrent has written, including partial pieces."""
        try:
            info_hash = str(handle.info_hash())
        except Exception:
            return set()

        with self._alert_lock:
            try:
                alerts = self.session.pop_alerts()
            except Exception:
                alerts = []
            for alert in alerts:
                if not isinstance(alert, lt.block_finished_alert):
                    continue
                try:
                    alert_handle = alert.handle
                    alert_hash = str(alert_handle.info_hash())
                    block = (
                        int(alert.piece_index),
                        int(alert.block_index),
                    )
                except Exception:
                    continue
                self._finished_blocks.setdefault(alert_hash, set()).add(block)

            finished = set(self._finished_blocks.get(info_hash, set()))
            try:
                pieces = handle.status().pieces
                if pieces:
                    finished = {
                        block
                        for block in finished
                        if block[0] >= len(pieces) or not pieces[block[0]]
                    }
                    self._finished_blocks[info_hash] = finished
            except Exception:
                pass
            return finished

    def close(self) -> None:
        for session_id in list(self.sessions.keys()):
            self.stop(session_id)
        with self.lock:
            records = list(self.records.items())
            self.records.clear()
        for _, record in records:
            if record.removal_timer is not None:
                record.removal_timer.cancel()
            record.session_ids.clear()
            record.stop_discovery()
            if record.persistent_cache and record.cache_ready:
                self._save_record_resume_data(record)
            else:
                shutil.rmtree(record.save_path, ignore_errors=True)
            try:
                self.session.remove_torrent(record.handle)
            except Exception:
                pass
        self.http_server.close()
