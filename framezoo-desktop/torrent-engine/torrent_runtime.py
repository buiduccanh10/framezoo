from __future__ import annotations

import math
import mimetypes
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler
from typing import Any, Optional, Set, Tuple

import libtorrent as lt

import torrent_constants as constants
from torrent_http import emit, is_client_connected, log_event
from torrent_utils import (
    cap_open_ended_range,
    get_torrent_cache_key,
    parse_range,
    select_file,
    torrent_hash,
    write_atomic_resume_data,
)
from torrent_fast_blocks import (
    Endpoint,
    close_peer_connections,
    fetch_blocks_from_peers,
    normalize_endpoint,
)


class TorrentRuntime:
    def __init__(
        self,
        engine: "LibtorrentEngine",
        session_id: str,
        request: dict[str, Any],
        handle: Any,
        save_path: str,
        persistent_cache: bool = False,
        record: Any = None,
        torrent_profile: str = "default",
    ) -> None:
        self.engine = engine
        self.session_id = session_id
        self.request = request
        self.handle = handle
        self.save_path = save_path
        self.persistent_cache = persistent_cache
        self.record = record
        # A cold magnet has no resume state to validate; cached playback does.
        self._wait_for_file_check = bool(getattr(record, "cache_ready", False))
        self.torrent_profile = (
            torrent_profile
            if torrent_profile in {"default", "soft", "fast", "ultra-fast"}
            else "default"
        )
        self.cache_key = get_torrent_cache_key(request)
        self._resume_lock = threading.Lock()
        self.info: Any = None
        self.file_index: Optional[int] = None
        self.file_path = ""
        self.file_size = 0
        try:
            if self.handle is not None and getattr(self.handle.status(), "has_metadata", False):
                self.info = self.handle.torrent_file()
                if self.info is not None:
                    (
                        self.file_index,
                        self.file_path,
                        self.file_size,
                    ) = select_file(self.info, self.request)
        except Exception:
            pass
        self.stream_url = ""
        self.raw_stream_url = ""  # always points to /torrent/ route
        self.stream_type = "pending"
        self.start_time = self._get_requested_start_time()
        self.duration = self._get_requested_duration()
        self._torrent_cleaned = False
        self.stop_event = threading.Event()
        self.metadata_ready = threading.Event()
        self.metadata_complete = threading.Event()
        self.metadata_error: Optional[str] = None
        self.metadata_thread: Optional[threading.Thread] = None
        self._metadata_lock = threading.Lock()
        self.session_started_at = time.monotonic()
        self.first_request_logged = False
        self.request_count = 0
        self.last_range_key: Optional[Tuple[int, int]] = None
        self._piece_priority_lock = threading.RLock()
        self._boosted_pieces: Set[int] = set()
        self._piece_priorities: dict[int, int] = {}
        self._piece_deadlines: dict[int, int] = {}
        # Pieces cancelled by _kick_target_piece: piece -> monotonic time
        # when the priority-0 hold expires and _restore_pending_kicks
        # re-raises the piece to endgame-request it from every peer.
        self._pending_kick_restore: dict[int, float] = {}
        self._focused_file_index: Optional[int] = None
        self._has_streamed_bytes = False
        self._playhead_streamed_bytes = 0
        self._was_startup_bounded = False
        self._startup_window_completed_logged = False
        self._tail_probe_ready_logged = False
        self._resume_range_ready_logged = False
        self._startup_target_pieces: Set[int] = set()
        self._startup_required_target_pieces: Set[int] = set()
        self._last_stream_start: Optional[int] = None
        self._first_peer_logged = False
        self._first_download_logged = False
        self._first_piece_prioritized_logged = False
        self._first_piece_ready_logged = False
        self._reannounce_lock = threading.Lock()
        self._last_reannounce = 0.0
        self._focus_piece: Optional[int] = None
        self._playback_focus_piece: Optional[int] = None
        self._active_playback_request_id = 0
        self._startup_tail_pieces: Set[int] = set()
        self._startup_required_tail_pieces: Set[int] = set()
        self._fast_block_lock = threading.Lock()
        self._fast_blocks: dict[tuple[int, int], bytes] = {}
        self._fast_blocks_inflight: Set[tuple[int, int]] = set()
        self._fast_block_retry_at: dict[tuple[int, int], float] = {}
        self._startup_fast_head_blocks: Set[tuple[int, int]] = set()
        self._startup_fast_head_end = -1
        self._startup_fast_prefetch_started = False
        self._startup_tail_prefetch_queued = False
        self._fast_lookahead_until = -1
        self._paused_boundary_pieces: Set[int] = set()
        self._fast_peer_id = b"-FZFB01-" + os.urandom(12)
        self._range_wake_event = threading.Event()
        self._working_fast_peers: list[Endpoint] = []
        self._failed_fast_peers: dict[Endpoint, float] = {}
        self._fast_peer_sockets: dict[Endpoint, Any] = {}
        self._fast_peer_sockets_lock = threading.Lock()
        self.status_thread = threading.Thread(
            target=self.publish_status,
            name="torrent-status-" + session_id,
            daemon=True,
        )

    def elapsed_ms(self) -> int:
        started_at = getattr(self, "session_started_at", time.monotonic())
        return int(max(0.0, (time.monotonic() - started_at) * 1000))

    def _get_requested_start_time(self) -> float:
        value = self.request.get("startAt", 0)
        try:
            value = float(value)
        except (TypeError, ValueError):
            return 0.0
        return max(0.0, value) if math.isfinite(value) else 0.0

    def _get_requested_duration(self) -> float:
        value = self.request.get("duration", 0)
        try:
            value = float(value)
        except (TypeError, ValueError):
            return 0.0
        return max(0.0, value) if math.isfinite(value) else 0.0

    def _safe_piece_length(self) -> int:
        info = getattr(self, "info", None)
        if info is None:
            return constants.STREAM_CHUNK_SIZE
        try:
            length = int(info.piece_length())
            return length if length > 0 else constants.STREAM_CHUNK_SIZE
        except Exception:
            return constants.STREAM_CHUNK_SIZE

    def _is_large_piece_torrent(self) -> bool:
        return self._safe_piece_length() >= getattr(
            constants,
            "LARGE_PIECE_THRESHOLD_BYTES",
            8 * 1024 * 1024,
        )

    def _file_first_piece(self) -> int:
        if (
            getattr(self, "info", None) is None
            or getattr(self, "file_index", None) is None
        ):
            return 0
        return min(self.map_pieces(0, 1), default=0)

    def _is_playback_request_superseded(
        self,
        playback_request_id: Optional[int],
    ) -> bool:
        return (
            playback_request_id is not None
            and playback_request_id != getattr(self, "_active_playback_request_id", 0)
        )

    def _set_sequential_mode(self, enable_seq: bool) -> None:
        handle = getattr(self, "handle", None)
        if handle is None:
            return
        set_seq = getattr(handle, "set_sequential_download", None)
        if callable(set_seq):
            try:
                set_seq(enable_seq)
            except Exception:
                pass
        seq_flag = getattr(
            getattr(lt, "torrent_flags", None),
            "sequential_download",
            None,
        )
        if seq_flag is None:
            return
        flag_fn = getattr(
            handle,
            "set_flags" if enable_seq else "unset_flags",
            None,
        )
        if callable(flag_fn):
            try:
                flag_fn(seq_flag)
            except Exception:
                pass

    def start(self) -> None:
        self.raw_stream_url = self.engine.http_server.register(self)
        self.stream_type = "pending"
        self.stream_url = self.raw_stream_url
        log_event(
            "session started",
            sessionId=self.session_id,
            sourceId=self.request.get("sourceId", ""),
            streamUrl=self.stream_url,
            timingPhase="torrent_start",
            elapsedMs=self.elapsed_ms(),
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
            self.wait_for_metadata()
        except Exception as error:
            if self.stop_event.is_set():
                self.metadata_complete.set()
                return
            self.metadata_error = str(error)
            log_event(
                "metadata failed",
                sessionId=self.session_id,
                error=self.metadata_error,
            )
        finally:
            self.metadata_complete.set()

    def wait_for_metadata(self, timeout: Optional[float] = None) -> None:
        deadline = (
            time.monotonic() + timeout
            if timeout is not None
            else None
        )
        last_reannounce = 0.0
        while (
            (deadline is None or time.monotonic() < deadline)
            and not self.stop_event.is_set()
        ):
            if self.metadata_ready.is_set():
                return
            status = self.handle.status()
            checking_states = (
                getattr(getattr(lt, "torrent_status", None), "checking_resume_data", None),
                getattr(getattr(lt, "torrent_status", None), "checking_files", None),
            )
            if status.has_metadata:
                handle_state = getattr(status, "state", None)
                if (
                    self._wait_for_file_check
                    and handle_state in checking_states
                    and (
                        deadline is None or time.monotonic() + 0.1 < deadline
                    )
                ):
                    # shortcut: cold metadata can schedule immediately; cached resume waits for file validation.
                    time.sleep(0.05)
                    continue
                with self._metadata_lock:
                    if self.metadata_ready.is_set():
                        return
                    self.info = self.handle.torrent_file()
                    if self.info is None:
                        raise ValueError(
                            "libtorrent returned no torrent metadata",
                        )
                    (
                        self.file_index,
                        self.file_path,
                        self.file_size,
                    ) = select_file(self.info, self.request)
                    try:
                        self.materialize_selected_file()
                    except OSError as error:
                        log_event(
                            "selected file precreate failed",
                            sessionId=self.session_id,
                            fileName=self.file_path,
                            error=str(error),
                        )
                    if self._is_large_piece_torrent():
                        if getattr(self, "record", None) is not None:
                            self.record.last_file_index = self.file_index
                        try:
                            set_download_limit = getattr(
                                self.handle, "set_download_limit", None
                            )
                            if callable(set_download_limit):
                                set_download_limit(0)
                        except Exception:
                            pass
                        with self._piece_priority_lock:
                            self._focused_file_index = self.file_index
                    elif getattr(self, "record", None) is not None:
                        self.record.update_file_priorities()
                    else:
                        priorities = [0] * self.info.files().num_files()
                        priorities[self.file_index] = constants.STREAM_IDLE_FILE_PRIORITY
                        self.handle.prioritize_files(priorities)
                    # Disable global sequential download until playback head leaves piece 0
                    # on resume sessions so pieces 0..N-1 do not compete with header/Cues/target.
                    enable_seq = (
                        (getattr(self, "start_time", 0.0) or 0.0) <= 0.0
                        and not self._is_large_piece_torrent()
                    )
                    self._set_sequential_mode(enable_seq)
                    resume = getattr(self.handle, "resume", None)
                    if callable(resume):
                        try:
                            resume()
                        except Exception:
                            pass
                    self.prime_startup_ranges()
                    record = getattr(self, "record", None)
                    discovery = getattr(record, "discovery", None)
                    if discovery is not None:
                        try:
                            if int(getattr(self.handle.status(), "num_peers", 0)) == 0:
                                discovery.reactivate()
                        except Exception:
                            pass
                    # Start wire probes before libmpv opens the route. Priority
                    # alone does not request partial blocks from tracker peers.
                    self.prime_startup_fast_blocks()
                    # Expose the blocking range route immediately. libmpv can
                    # open it while the first blocks are still arriving.
                    self.stream_type = "file"
                    self.metadata_ready.set()
                    try:
                        emit({"type": "status", "status": self.current_status()})
                    except Exception:
                        pass
                    log_event(
                        "stream route ready",
                        sessionId=self.session_id,
                        fileName=self.file_path.rsplit("/", 1)[-1],
                        fileSize=self.file_size,
                        timingPhase="stream_ready",
                        elapsedMs=self.elapsed_ms(),
                    )
                return
            now = time.monotonic()
            if (
                now - last_reannounce
                >= constants.METADATA_REANNOUNCE_INTERVAL
            ):
                self._force_reannounce_for_metadata()
                last_reannounce = now
            time.sleep(0.05)
        if self.stop_event.is_set():
            return
        raise TimeoutError("timed out waiting for torrent metadata")

    def _force_reannounce_for_metadata(self) -> None:
        now = time.monotonic()
        with self._reannounce_lock:
            if (
                now - getattr(self, "_last_reannounce", 0.0)
                < constants.REANNOUNCE_COOLDOWN
            ):
                return

            announced = False
            force_reannounce = getattr(self.handle, "force_reannounce", None)
            force_dht_announce = getattr(
                self.handle,
                "force_dht_announce",
                None,
            )
            try:
                if callable(force_reannounce):
                    force_reannounce()
                    announced = True
            except Exception:
                pass
            try:
                if callable(force_dht_announce):
                    force_dht_announce()
                    announced = True
            except Exception:
                pass
            if not announced:
                return
            self._last_reannounce = now

        status = self.handle.status()
        log_event(
            "metadata swarm reannounce",
            sessionId=self.session_id,
            peers=int(getattr(status, "num_peers", 0)),
            downloadRate=int(getattr(status, "download_rate", 0)),
            timingPhase="metadata_reannounce",
            elapsedMs=self.elapsed_ms(),
        )

    def session_payload(self) -> dict[str, Any]:
        return {
            "sessionId": self.session_id,
            "sourceId": self.request.get("sourceId", ""),
            "streamUrl": self.stream_url,
            "streamType": self.stream_type,
            "startAt": self.start_time,
            "duration": self.duration if getattr(self, "duration", 0.0) > 0 else None,
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

    def selected_file_path(self) -> str:
        relative_path = self.file_path.replace("\\", "/")
        absolute_path = os.path.abspath(
            os.path.join(self.save_path, relative_path),
        )
        root = os.path.abspath(self.save_path)
        if not absolute_path.startswith(root + os.sep):
            raise ValueError("invalid torrent file path")
        return absolute_path

    def materialize_selected_file(self) -> None:
        """Create the selected sparse file before shared pieces are requested."""
        absolute_path = self.selected_file_path()
        os.makedirs(os.path.dirname(absolute_path), exist_ok=True)
        try:
            if (
                os.path.exists(absolute_path)
                and os.path.getsize(absolute_path) == self.file_size
            ):
                return
        except OSError:
            pass
        try:
            stream = open(absolute_path, "r+b")
        except FileNotFoundError:
            stream = open(absolute_path, "w+b")
        with stream:
            stream.truncate(self.file_size)

    def persist_metadata(self, overwrite: bool = False) -> bool:
        if not self.cache_key or self.info is None:
            return False
        torrent_path = os.path.join(self.save_path, self.cache_key + ".torrent")
        if os.path.exists(torrent_path) and not overwrite:
            return True
        try:
            entry = lt.create_torrent(self.info).generate()
            temporary_path = torrent_path + ".tmp"
            with open(temporary_path, "wb") as f:
                f.write(lt.bencode(entry))
            os.replace(temporary_path, torrent_path)
            log_event(
                "metadata persisted",
                sessionId=self.session_id,
                torrentPath=torrent_path,
            )
            return True
        except Exception as error:
            sys.stderr.write(f"[sidecar] Failed to persist torrent metadata: {error}\n")
            return False

    def _cache_is_ready(self) -> bool:
        record = getattr(self, "record", None)
        if record is not None:
            with record.lock:
                return bool(record.cache_ready)
        return bool(getattr(self, "_cache_ready", False))

    def mark_stream_playable(self) -> None:
        """Persist only after playback receives a real media byte."""
        if not getattr(self, "persistent_cache", False):
            return

        record = getattr(self, "record", None)
        lock = record.lock if record is not None else self._metadata_lock
        with lock:
            if self._cache_is_ready():
                return
            if not self.persist_metadata(overwrite=True):
                return
            marker_path = os.path.join(
                self.save_path,
                ".framezoo-stream-ready",
            )
            try:
                with open(marker_path + ".tmp", "wb") as marker:
                    marker.write(b"1\n")
                os.replace(marker_path + ".tmp", marker_path)
            except OSError as error:
                sys.stderr.write(
                    f"[sidecar] Failed to mark torrent cache ready: {error}\n",
                )
                return
            if record is not None:
                record.cache_ready = True
            else:
                self._cache_ready = True
            self.save_resume_data_sync()

    def save_resume_data_sync(self) -> bool:
        if not self.persistent_cache or not self._cache_is_ready():
            return False
        handle = getattr(self, "handle", None)
        if handle is None:
            return False
        lock = getattr(self, "_resume_lock", None)
        if lock is None:
            lock = getattr(self, "_metadata_lock", None)
        if lock is not None:
            with lock:
                return write_atomic_resume_data(handle, self.save_path)
        return write_atomic_resume_data(handle, self.save_path)

    def stop(self, remove_torrent: bool = True) -> None:
        self.stop_event.set()
        self.engine.http_server.unregister(self.session_id)
        if remove_torrent or getattr(self, "record", None) is None:
            close_peer_connections(
                getattr(self, "_fast_peer_sockets", None),
                getattr(self, "_fast_peer_sockets_lock", None),
            )
        log_event("session stopped", sessionId=self.session_id)
        if not self._torrent_cleaned:
            if self.persistent_cache:
                self.save_resume_data_sync()
            if remove_torrent:
                try:
                    self.engine.session.remove_torrent(self.handle)
                except Exception:
                    pass
                if self.persistent_cache:
                    try:
                        os.utime(self.save_path, None)
                    except OSError:
                        pass
            self._torrent_cleaned = True

    def release_playback_schedule(self) -> None:
        """Drop this idle runtime's deadlines without discarding downloaded pieces."""
        with self._piece_priority_lock:
            stale_pieces = set(getattr(self, "_boosted_pieces", set()))
            stale_kicked = set(getattr(self, "_pending_kick_restore", {}).keys())
            stale_pieces.update(stale_kicked)
            stale_pieces.update(getattr(self, "_piece_priorities", {}).keys())
            self._boosted_pieces.clear()
            self._piece_priorities.clear()
            self._piece_deadlines.clear()
            self._pending_kick_restore.clear()

        record = getattr(self, "record", None)
        other_session_ids = (
            set(getattr(record, "session_ids", set())) - {self.session_id}
            if record is not None
            else set()
        )
        other_protected_pieces: Set[int] = set()
        other_same_file_active = False
        engine = getattr(self, "engine", None)
        if other_session_ids and engine is not None:
            sessions = getattr(engine, "sessions", None) or {}
            for other_id in other_session_ids:
                other = sessions.get(other_id)
                if other is None:
                    continue
                other_file_index = getattr(other, "file_index", None)
                if (
                    self.file_index is None
                    or other_file_index is None
                    or other_file_index == self.file_index
                ):
                    other_same_file_active = True
                other_lock = getattr(other, "_piece_priority_lock", None)
                if other_lock is not None:
                    with other_lock:
                        other_protected_pieces.update(
                            getattr(other, "_boosted_pieces", set()),
                        )
                        for attr in ("_focus_piece", "_playback_focus_piece"):
                            focus_val = getattr(other, attr, None)
                            if focus_val is not None:
                                other_protected_pieces.add(focus_val)
                else:
                    other_protected_pieces.update(
                        getattr(other, "_boosted_pieces", set()),
                    )

        releasable_pieces = stale_pieces - other_protected_pieces
        demote_priority = (
            0
            if other_session_ids and not other_same_file_active
            else constants.STREAM_IDLE_FILE_PRIORITY
        )
        clear_deadlines = getattr(self.handle, "clear_piece_deadlines", None)
        if not other_session_ids and callable(clear_deadlines):
            try:
                clear_deadlines()
            except Exception:
                pass
        else:
            reset_deadline = getattr(self.handle, "reset_piece_deadline", None)
            if callable(reset_deadline):
                for piece in releasable_pieces:
                    try:
                        reset_deadline(piece)
                    except Exception:
                        continue

        demoted = 0
        for piece in releasable_pieces:
            try:
                if self.handle.have_piece(piece) and piece not in stale_kicked:
                    continue
                self.handle.piece_priority(
                    piece,
                    demote_priority,
                )
                demoted += 1
            except Exception:
                continue
        log_event(
            "playback schedule released",
            sessionId=self.session_id,
            stalePieces=len(stale_pieces),
            demotedPieces=demoted,
        )

    def current_status(self) -> dict[str, Any]:
        status = self.handle.status()
        self._observe_status_milestones(status)
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

        discovery_status: dict[str, Any] = {}
        record = getattr(self, "record", None)
        engine = getattr(self, "engine", None)
        if record is not None and engine is not None:
            try:
                discovery_status = engine.get_discovery_status(record)
            except Exception:
                discovery_status = {}

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
            "duration": self.duration if getattr(self, "duration", 0.0) > 0 else None,
            "error": stream_error,
            "updatedAt": int(time.time() * 1000),
            **discovery_status,
        }

    def _observe_status_milestones(self, status: Any) -> None:
        peers = int(getattr(status, "num_peers", 0))
        download_rate = int(getattr(status, "download_rate", 0))
        now = time.monotonic()
        if peers > 0 and now - getattr(self, "_last_peer_harvest", 0.0) >= 10.0:
            self._last_peer_harvest = now
            record = getattr(self, "record", None)
            if record is not None and getattr(record, "discovery", None) is not None:
                try:
                    record.discovery._harvest_peers_from_handle()
                except Exception:
                    pass
        if peers > 0 and not self._first_peer_logged:
            self._first_peer_logged = True
            log_event(
                "first peer",
                sessionId=self.session_id,
                peers=peers,
                timingPhase="first_peer",
                elapsedMs=self.elapsed_ms(),
            )
        if download_rate > 0 and not self._first_download_logged:
            self._first_download_logged = True
            log_event(
                "first download rate",
                sessionId=self.session_id,
                peers=peers,
                downloadRate=download_rate,
                timingPhase="first_download_rate",
                elapsedMs=self.elapsed_ms(),
            )

    def publish_status(self) -> None:
        resume_saves = 0
        while not self.stop_event.is_set():
            try:
                refresh_network = getattr(self.engine, "refresh_network", None)
                if callable(refresh_network):
                    refresh_network()
                emit({"type": "status", "status": self.current_status()})
            except Exception:
                return
            self.stop_event.wait(0.5)
            # Persist resume data periodically so cached torrents survive
            # abrupt app exits without a full re-check on the next start.
            resume_saves += 1
            if (
                resume_saves >= 60
                and self.persistent_cache
                and self._cache_is_ready()
                and self.metadata_ready.is_set()
            ):
                resume_saves = 0
                self.save_resume_data_sync()

    def map_pieces(self, start: int, length: int) -> Set[int]:
        if (
            getattr(self, "info", None) is None
            or getattr(self, "file_index", None) is None
        ):
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

    def file_piece_end(self, start: int) -> int:
        if self.info is None or self.file_index is None:
            return max(0, self.file_size - 1)
        try:
            mapped = self.info.map_file(self.file_index, start, 1)
            piece = int(getattr(mapped, "piece"))
            file_offset = int(
                self.info.files().file_offset(self.file_index),
            )
            piece_length = int(self.info.piece_length())
            return min(
                self.file_size - 1,
                (piece + 1) * piece_length - file_offset - 1,
            )
        except Exception:
            return max(0, self.file_size - 1)

    @staticmethod
    def _deadline_flags() -> int:
        deadline_flags_type = getattr(lt, "deadline_flags_t", None)
        if deadline_flags_type is None:
            # Compatibility with older Python bindings.
            deadline_flags_type = getattr(lt, "deadline_flags", None)
        return int(getattr(deadline_flags_type, "alert_when_available", 0))

    def _set_piece_deadline(self, piece: int, deadline_ms: int) -> None:
        self.handle.set_piece_deadline(
            piece,
            deadline_ms,
            self._deadline_flags(),
        )
        lock = getattr(self, "_piece_priority_lock", None)
        if lock is None:
            self._piece_deadlines = getattr(self, "_piece_deadlines", {})
            self._piece_deadlines[piece] = deadline_ms
            return
        with lock:
            self._piece_deadlines = getattr(self, "_piece_deadlines", {})
            self._piece_deadlines[piece] = deadline_ms

    def prioritize_range(
        self,
        start: int,
        length: int,
        reason: str,
        is_sync: bool = False,
        sync_metadata: Optional[dict[str, Any]] = None,
    ) -> None:
        pieces = sorted(self.map_pieces(start, length))
        self._schedule_pieces(
            pieces,
            set(pieces),
            reason,
            is_sync=is_sync,
            sync_metadata=sync_metadata,
        )

    def prime_startup_ranges(self) -> None:
        """Keep enough contiguous playback data active before libmpv's first frame.

        Metadata probing can take longer than the first few pieces. A four-piece
        burst leaves libtorrent with no high-priority demand, so it falls back
        to low-priority background selection and the player appears stalled.
        """
        if (
            self.info is None
            or self.file_index is None
            or self.file_size <= 0
        ):
            return

        try:
            piece_length = int(self.info.piece_length())
        except (AttributeError, TypeError, ValueError):
            piece_length = constants.STREAM_CHUNK_SIZE

        try:
            start_time = getattr(self, "start_time", 0.0) or 0.0
            if start_time > 0:
                startup_window = min(self.file_size, constants.STARTUP_PREFETCH_BYTES)
            elif piece_length >= getattr(
                constants, "LARGE_PIECE_THRESHOLD_BYTES", 8 * 1024 * 1024
            ):
                startup_window = min(self.file_size, self._startup_window_bytes())
            else:
                startup_window = max(
                    constants.STARTUP_PREFETCH_BYTES,
                    piece_length * constants.STARTUP_WINDOW_PIECES,
                )
            startup_pieces = sorted(self.map_pieces(0, startup_window))

            # Stremio-like fast start: Fetch head pieces and container tail index (MKV Cues / MP4 moov)
            if piece_length >= getattr(
                constants, "LARGE_PIECE_THRESHOLD_BYTES", 8 * 1024 * 1024
            ):
                tail_length = min(
                    self.file_size,
                    getattr(constants, "STARTUP_TAIL_PREFETCH_BYTES", 8 * 1024 * 1024),
                )
            else:
                tail_length = min(
                    self.file_size,
                    max(
                        piece_length * 2,
                        getattr(constants, "STARTUP_TAIL_PREFETCH_BYTES", 8 * 1024 * 1024),
                    ),
                )
                if self.file_size > piece_length:
                    tail_length = min(
                        tail_length,
                        max(piece_length, self.file_size // 2),
                    )
            tail_start = max(0, self.file_size - tail_length)
            tail_pieces = sorted(self.map_pieces(tail_start, tail_length))
            self._startup_tail_pieces = set(tail_pieces)

            # Pre-prioritize pieces at startAt if resume/seek offset and duration are known
            target_pieces: list[int] = []
            start_time = getattr(self, "start_time", 0.0) or 0.0
            duration = getattr(self, "duration", 0.0) or 0.0
            file_size = getattr(self, "file_size", 0) or 0
            if start_time > 0 and duration > 0 and file_size > 0:
                target_byte = int(
                    (min(start_time, duration) / duration) * file_size
                )
                target_pieces = sorted(
                    self.map_pieces(
                        target_byte,
                        self._startup_window_bytes(),
                    )
                )

            combined_pieces = sorted(
                set(startup_pieces) | set(tail_pieces) | set(target_pieces)
            )
            # Focus critical bandwidth strictly on the container head pieces (playback playhead),
            # the container tail pieces (Matroska Cues / MP4 moov index), and resume target pieces.
            required_count = 1 if piece_length >= 8 * 1024 * 1024 else 2
            required_pieces = set()
            if startup_pieces:
                required_pieces.update(startup_pieces[:required_count])
            # Keep the container tail warm, but let the first playback range
            # own startup bandwidth. A real tail probe promotes these pieces
            # through wait_for_range() when the demuxer asks for them.
            self._startup_required_tail_pieces = set()
            if target_pieces:
                required_targets = set(target_pieces[:required_count])
                required_pieces.update(required_targets)
            else:
                required_targets = set()
            self._startup_target_pieces = set(target_pieces)
            self._startup_required_target_pieces = required_targets

            if combined_pieces:
                if piece_length >= getattr(
                    constants, "LARGE_PIECE_THRESHOLD_BYTES", 8 * 1024 * 1024
                ):
                    keep_set = set(combined_pieces)
                    file_pieces = self.map_pieces(0, self.file_size)
                    prioritize_vec = getattr(
                        self.handle, "prioritize_pieces", None
                    )
                    get_prios = getattr(
                        self.handle, "get_piece_priorities", None
                    )
                    if callable(prioritize_vec) and callable(get_prios):
                        try:
                            num_pieces = int(self.info.num_pieces())
                            prios = [0] * num_pieces
                            # Preserve priorities for any concurrent sibling sessions sharing this record.
                            record = getattr(self, "record", None)
                            engine = getattr(self, "engine", None)
                            if record is not None and engine is not None:
                                for sid in list(getattr(record, "session_ids", ())):
                                    sibling = engine.sessions.get(sid)
                                    if (
                                        sibling is not None
                                        and sibling is not self
                                        and getattr(sibling, "file_index", None)
                                        is not None
                                    ):
                                        for piece in getattr(
                                            sibling, "_boosted_pieces", ()
                                        ):
                                            if 0 <= piece < num_pieces:
                                                prios[piece] = (
                                                    constants.STREAM_HOT_PIECE_PRIORITY
                                                )
                            for piece in keep_set:
                                if 0 <= piece < num_pieces:
                                    prios[piece] = constants.STREAM_PIECE_PRIORITY
                            prioritize_vec(prios)
                        except Exception:
                            pass
                    else:
                        for piece in file_pieces:
                            if piece not in keep_set:
                                try:
                                    if not self.handle.have_piece(piece):
                                        self.handle.piece_priority(piece, 0)
                                except Exception:
                                    pass
                self._schedule_pieces(
                    combined_pieces,
                    required_pieces,
                    reason="startup-prefetch",
                )
                # Resume playback seeks after the container is opened. Do not
                # leave that target behind the byte-zero head in the deadline
                # queue; both are needed, but the target must be requested now.
                if start_time > 0 and required_targets:
                    for piece in required_targets:
                        try:
                            if not self.handle.have_piece(piece):
                                self.handle.piece_priority(
                                    piece,
                                    constants.STREAM_PIECE_PRIORITY,
                                )
                                self._set_piece_deadline(piece, 0)
                        except Exception:
                            continue

            log_event(
                "startup prefetch",
                sessionId=self.session_id,
                startupBytes=constants.STARTUP_PREFETCH_BYTES,
                startupPieces=startup_pieces,
                timingPhase="startup_prefetch",
                elapsedMs=self.elapsed_ms(),
            )
        except Exception as error:
            log_event(
                "startup prefetch failed",
                sessionId=self.session_id,
                error=str(error),
            )

    def wait_for_initial_chunk(self) -> None:
        """Do not expose the route until the media header bytes exist."""
        if self.file_size <= 0 or not self.file_path:
            raise ValueError("selected torrent file is empty")

        absolute_path = self.selected_file_path()

        initial_bytes = (
            constants.INITIAL_STREAM_BYTES
            if self._is_large_piece_torrent()
            else constants.STREAM_CHUNK_SIZE
        )
        end = min(self.file_size - 1, initial_bytes - 1)
        stream, chunk = self.open_first_chunk(
            absolute_path,
            0,
            end,
            track_position=False,
            timeout=None,
        )
        if stream is not None:
            stream.close()
        if not chunk:
            raise TimeoutError("timed out waiting for initial torrent bytes")

        self.stream_type = "file"
        log_event(
            "stream ready",
            sessionId=self.session_id,
            firstChunkBytes=len(chunk),
            timingPhase="stream_ready",
            elapsedMs=self.elapsed_ms(),
        )

    def prime_startup_fast_blocks(self) -> None:
        """Fetch the first range and resume target while metadata is settling."""
        if getattr(self, "handle", None) is None or self.file_size <= 0:
            return
        initial_bytes = (
            constants.INITIAL_STREAM_BYTES
            if self._is_large_piece_torrent()
            else constants.STREAM_CHUNK_SIZE
        )
        initial_end = min(self.file_size - 1, initial_bytes - 1)
        if self._is_large_piece_torrent():
            self._startup_fast_head_end = initial_end
            self._startup_fast_head_blocks = self._required_range_blocks(
                0,
                initial_end,
            )
        self._start_fast_block_fetch(0, initial_end)
        if self.start_time <= 0 or self.duration <= 0:
            return
        target_byte = int(
            (min(self.start_time, self.duration) / self.duration) * self.file_size
        )
        self._start_fast_block_fetch(
            target_byte,
            min(
                self.file_size - 1,
                target_byte + constants.INITIAL_STREAM_BYTES - 1,
            ),
        )

    def focus_file(self) -> None:
        if self.info is None or self.file_index is None:
            return
        with self._piece_priority_lock:
            if getattr(self, "_focused_file_index", None) == self.file_index:
                return
        try:
            if not self._is_large_piece_torrent():
                if getattr(self, "record", None) is not None:
                    self.record.update_file_priorities()
                else:
                    priorities = [0] * self.info.files().num_files()
                    priorities[self.file_index] = constants.STREAM_IDLE_FILE_PRIORITY
                    self.handle.prioritize_files(priorities)
            enable_seq = (
                (getattr(self, "start_time", 0.0) or 0.0) <= 0.0
                and not self._is_large_piece_torrent()
            )
            self._set_sequential_mode(enable_seq)
            with self._piece_priority_lock:
                self._focused_file_index = self.file_index
        except Exception:
            pass

    def refocus_piece_window(self) -> None:
        with self._piece_priority_lock:
            boosted = self._boosted_pieces
            self._boosted_pieces = set()
        for piece in boosted:
            try:
                if not self.handle.have_piece(piece):
                    self.handle.piece_priority(
                        piece,
                        constants.STREAM_HOT_PIECE_PRIORITY,
                    )
                self.handle.reset_piece_deadline(piece)
            except Exception:
                continue
        if boosted:
            log_event(
                "piece window refocused",
                sessionId=self.session_id,
                resetPieces=len(boosted),
            )

    def maybe_refocus(self, start: int) -> None:
        should_refocus = False
        with self._piece_priority_lock:
            previous = self._last_stream_start
            is_seek = previous is not None and (
                start < previous
                or (start - previous) > constants.STARTUP_PLAYBACK_BYTES
            )
            if is_seek:
                if getattr(self, "_playhead_streamed_bytes", None) is not None:
                    self._playhead_streamed_bytes = 0
                self._fast_lookahead_until = -1
            if previous is None:
                if start > constants.RANGE_PREFETCH_BYTES:
                    should_refocus = True
            elif abs(start - previous) > constants.RANGE_PREFETCH_BYTES:
                should_refocus = True
            self._last_stream_start = start
        if should_refocus:
            self.refocus_piece_window()
            first_piece = min(self.map_pieces(start, 1), default=None)
            if first_piece is not None:
                self._focus_playback_piece(first_piece)

    def is_initial_tail_probe(
        self,
        start: int,
        total: int,
        request_number: int,
    ) -> bool:
        """Ignore mpv's early or container-index EOF probes when tracking the playback cursor."""
        if total <= 1024 * 1024 or start <= 0:
            return False
        tail_window = (
            min(max(1024 * 1024, total // 4), constants.RANGE_PREFETCH_BYTES)
            if total <= constants.RANGE_PREFETCH_BYTES * 2
            else constants.RANGE_PREFETCH_BYTES
        )
        tail_start = max(0, total - tail_window)
        if start < tail_start:
            return False
        if request_number <= constants.INITIAL_TAIL_PROBE_MAX_REQUESTS:
            return True

        startup_tail_pieces = getattr(self, "_startup_tail_pieces", None)
        last_stream_start = getattr(self, "_last_stream_start", None) or 0
        if startup_tail_pieces and not all(
            self._piece_have(piece) for piece in startup_tail_pieces
        ):
            if (
                getattr(self, "info", None) is not None
                and getattr(self, "file_index", None) is not None
                and bool(set(self.map_pieces(start, 1)) & startup_tail_pieces)
            ):
                return True
            return last_stream_start < constants.STARTUP_PREFETCH_BYTES

        if (
            getattr(self, "info", None) is not None
            and getattr(self, "file_index", None) is not None
        ):
            eof_probe_cap = min(
                total,
                max(constants.STARTUP_PREFETCH_BYTES, self._safe_piece_length() * 2),
            )
            prefetch_bytes = self._get_quality_prefetch_window()[0]
            if (
                start >= max(1, total - eof_probe_cap)
                and last_stream_start < start - prefetch_bytes
            ):
                return True
        return False

    def range_is_ready(self, start: int, end: int) -> bool:
        pieces = self.map_pieces(start, end - start + 1)
        if not pieces:
            return False
        try:
            if all(self.handle.have_piece(piece) for piece in pieces):
                return True
        except RuntimeError:
            return False
        return self._range_blocks_are_finished(start, end)

    def _required_range_blocks(
        self,
        start: int,
        end: int,
    ) -> Set[tuple[int, int]]:
        """Map a file range to libtorrent's finished block coordinates."""
        if (
            start < 0
            or end < start
            or self.file_size <= 0
            or self.info is None
            or start >= self.file_size
        ):
            return set()
        end = min(end, self.file_size - 1)
        try:
            piece_length = int(self.info.piece_length())
            file_offset = int(
                self.info.files().file_offset(self.file_index),
            )
            status = self.handle.status()
            block_size = int(getattr(status, "block_size", 0))
        except (AttributeError, IndexError, TypeError, ValueError):
            return set()
        if piece_length <= 0 or block_size <= 0:
            return set()

        first_global = file_offset + start
        last_global = file_offset + end
        first_piece = first_global // piece_length
        last_piece = last_global // piece_length
        required: Set[tuple[int, int]] = set()
        for piece in range(first_piece, last_piece + 1):
            piece_start = piece * piece_length
            piece_end = piece_start + piece_length - 1
            local_first = max(first_global, piece_start)
            local_last = min(last_global, piece_end)
            block_start = max(
                0,
                (local_first - piece_start) // block_size,
            )
            block_end = max(
                0,
                (local_last - piece_start) // block_size,
            )
            required.update(
                (piece, block)
                for block in range(block_start, block_end + 1)
            )
        return required

    def _disk_flushed_blocks(
        self,
        pieces: Set[int],
    ) -> tuple[Set[tuple[int, int]], bool]:
        """Return blocks written to disk (state == 3) and whether RAM cache needs flush."""
        if not pieces:
            return set(), False
        get_queue = getattr(self.handle, "get_download_queue", None)
        if not callable(get_queue):
            return set(), False
        try:
            queue = get_queue()
        except Exception:
            return set(), False
        flushed: Set[tuple[int, int]] = set()
        needs_flush = False
        for entry in queue:
            try:
                piece_index = int(entry.get("piece_index", -1))
            except Exception:
                continue
            if piece_index not in pieces:
                continue
            for block_index, block in enumerate(entry.get("blocks", ())):
                try:
                    state = int(block.get("state", 0))
                except Exception:
                    continue
                if state == 3:
                    flushed.add((piece_index, block_index))
                elif state == 2:
                    needs_flush = True
        return flushed, needs_flush

    def _range_blocks_are_finished(self, start: int, end: int, cached_blocks: Optional[Set[tuple[int, int]]] = None) -> bool:
        required = self._required_range_blocks(start, end)
        if not required:
            return False
        pieces = {piece for piece, _ in required}
        have_pieces: Set[int] = set()
        have_piece_fn = getattr(self.handle, "have_piece", None)
        if callable(have_piece_fn):
            try:
                have_pieces = {piece for piece in pieces if have_piece_fn(piece)}
            except Exception:
                return False
        remaining = {item for item in required if item[0] not in have_pieces}
        if not remaining:
            return True
        if callable(getattr(self.handle, "get_download_queue", None)):
            remaining_pieces = {piece for piece, _ in remaining}
            flushed, needs_flush = self._disk_flushed_blocks(remaining_pieces)
            if needs_flush:
                self.flush_piece_cache()
                flushed, _ = self._disk_flushed_blocks(remaining_pieces)
            with getattr(self, "_fast_block_lock", threading.Lock()):
                flushed.update(
                    block
                    for block in (cached_blocks if cached_blocks is not None else getattr(self, "_fast_blocks", set()))
                    if block in remaining
                )
            return remaining.issubset(flushed)
        engine = getattr(self, "engine", None)
        get_finished = getattr(engine, "finished_blocks_for", None)
        if callable(get_finished):
            finished = get_finished(self.handle)
        else:
            finished = set(getattr(self, "_finished_blocks", set()))
        fast_lock = getattr(self, "_fast_block_lock", None)
        if fast_lock is None:
            finished.update(cached_blocks if cached_blocks is not None else getattr(self, "_fast_blocks", set()))
        else:
            with fast_lock:
                finished.update(cached_blocks if cached_blocks is not None else getattr(self, "_fast_blocks", set()))
        return remaining.issubset(finished)

    def _fast_peer_pool(
        self,
    ) -> tuple[
        threading.Lock,
        list[Endpoint],
        dict[Endpoint, float],
        dict[Endpoint, Any],
        threading.Lock,
    ]:
        record = getattr(self, "record", None)
        if (
            record is not None
            and hasattr(record, "fast_peer_lock")
            and hasattr(record, "working_fast_peers")
            and hasattr(record, "failed_fast_peers")
            and hasattr(record, "fast_peer_sockets")
            and hasattr(record, "fast_peer_sockets_lock")
        ):
            return (
                record.fast_peer_lock,
                record.working_fast_peers,
                record.failed_fast_peers,
                record.fast_peer_sockets,
                record.fast_peer_sockets_lock,
            )
        lock = getattr(self, "_fast_block_lock", None)
        if lock is None:
            lock = threading.Lock()
            self._fast_block_lock = lock
        working = getattr(self, "_working_fast_peers", None)
        if working is None:
            working = []
            self._working_fast_peers = working
        failed = getattr(self, "_failed_fast_peers", None)
        if failed is None:
            failed = {}
            self._failed_fast_peers = failed
        sockets = getattr(self, "_fast_peer_sockets", None)
        if sockets is None:
            sockets = {}
            self._fast_peer_sockets = sockets
        sockets_lock = getattr(self, "_fast_peer_sockets_lock", None)
        if sockets_lock is None:
            sockets_lock = threading.Lock()
            self._fast_peer_sockets_lock = sockets_lock
        return lock, working, failed, sockets, sockets_lock

    def _has_warm_fast_peer(self) -> bool:
        pool_lock, working, _, sockets, sockets_lock = self._fast_peer_pool()
        with pool_lock:
            if working:
                return True
        with sockets_lock:
            return any(getattr(conn, "unchoked", False) for conn in sockets.values())

    def _boundary_piece_competes(self, piece: int) -> bool:
        """True when libtorrent would spend swarm bandwidth on another file's bytes
        in a large piece that fast blocks are already serving."""
        try:
            if not self._is_large_piece_torrent() or getattr(self, "info", None) is None:
                return False
            piece_length = int(self.info.piece_length())
            file_offset = int(self.info.files().file_offset(self.file_index))
        except Exception:
            return False
        return piece * piece_length < file_offset and self._has_warm_fast_peer()

    def _next_unfinished_file_piece(self, exclude_piece: int) -> Optional[int]:
        """Return another unfinished piece in the selected file to keep total_wanted > 0."""
        if (
            getattr(self, "info", None) is None
            or getattr(self, "file_size", 0) <= 0
            or getattr(self, "handle", None) is None
        ):
            return None
        try:
            paused = getattr(self, "_paused_boundary_pieces", ())
            for piece in self.map_pieces(0, self.file_size):
                if piece == exclude_piece or piece in paused:
                    continue
                if not self.handle.have_piece(piece):
                    return piece
        except Exception:
            return None
        return None

    def _should_pause_boundary_piece(
        self,
        piece: int,
        is_sync: bool = False,
        require_verified: bool = False,
    ) -> bool:
        """Pause a competing boundary piece only when another unfinished file piece
        keeps total_wanted > 0 and fast blocks already have a warm peer."""
        if is_sync or require_verified:
            return False
        if not self._boundary_piece_competes(piece):
            return False
        return self._next_unfinished_file_piece(piece) is not None

    def _pause_boundary_piece(self, piece: int) -> None:
        """Pause a competing boundary piece at priority 0 and cancel its requests once."""
        with self._piece_priority_lock:
            next_piece = self._next_unfinished_file_piece(piece)
            if next_piece is None:
                return
            next_prio = max(
                self._piece_priority(next_piece) or 0,
                constants.STREAM_HOT_PIECE_PRIORITY,
            )
            self.handle.piece_priority(next_piece, next_prio)
            self._boosted_pieces = getattr(self, "_boosted_pieces", set())
            self._boosted_pieces.add(next_piece)
            self._piece_priorities = getattr(self, "_piece_priorities", {})
            self._piece_priorities[next_piece] = next_prio

            paused = getattr(self, "_paused_boundary_pieces", None)
            if paused is None:
                paused = set()
                self._paused_boundary_pieces = paused
            newly_paused = piece not in paused
            paused.add(piece)

            if newly_paused:
                clear_deadlines = getattr(
                    self.handle,
                    "clear_piece_deadlines",
                    None,
                )
                if callable(clear_deadlines):
                    clear_deadlines()
                else:
                    self._reset_piece_deadline(piece)
            elif piece in getattr(self, "_piece_deadlines", {}):
                self._reset_piece_deadline(piece)

            self.handle.piece_priority(piece, 0)
            self._piece_priorities[piece] = 0
            if newly_paused:
                self._post_kick_cancel(piece)

    def _unpause_stale_boundary_pieces(self, force: bool = False) -> None:
        """Restore paused boundary pieces when fast blocks no longer cover them."""
        handle = getattr(self, "handle", None)
        if handle is None:
            return
        with self._piece_priority_lock:
            paused = getattr(self, "_paused_boundary_pieces", None)
            if not paused:
                return
            for piece in list(paused):
                try:
                    if handle.have_piece(piece):
                        paused.discard(piece)
                        continue
                    if not force and self._should_pause_boundary_piece(piece):
                        continue
                    paused.discard(piece)
                    focus_piece = getattr(self, "_focus_piece", None)
                    restore_prio = (
                        constants.STREAM_PIECE_PRIORITY
                        if focus_piece in (None, piece)
                        else constants.STREAM_IDLE_FILE_PRIORITY
                    )
                    handle.piece_priority(piece, restore_prio)
                    self._piece_priorities = getattr(
                        self,
                        "_piece_priorities",
                        {},
                    )
                    self._piece_priorities[piece] = restore_prio
                except Exception:
                    continue

    def _record_fast_peer_success(self, endpoint: Endpoint) -> None:
        pool_lock, working, failed, _, _ = self._fast_peer_pool()
        with pool_lock:
            if endpoint in working:
                working.remove(endpoint)
            working.insert(0, endpoint)
            del working[16:]
            failed.pop(endpoint, None)

    def _record_fast_peer_failure(self, endpoint: Endpoint) -> None:
        pool_lock, working, failed, _, _ = self._fast_peer_pool()
        with pool_lock:
            if endpoint in working:
                working.remove(endpoint)
                return
            failed[endpoint] = time.monotonic()

    def _fast_peer_endpoints(self, pieces: Set[int]) -> list[Endpoint]:
        engine = getattr(self, "engine", None)
        listen_port = getattr(engine, "listen_port", None)
        listen_address = getattr(engine, "listen_address", None)

        def is_self_endpoint(endpoint: Endpoint) -> bool:
            if listen_port is None or endpoint[1] != listen_port:
                return False
            return endpoint[0] in {"127.0.0.1", "0.0.0.0", "::1", listen_address}

        try:
            peers = self.handle.get_peer_info()
        except Exception:
            peers = []

        connected_ready_scored: list[tuple[tuple[bool, int, float], Endpoint]] = []
        active_connected_endpoints: Set[Endpoint] = set()
        connected_other: list[Endpoint] = []
        seen: Set[Endpoint] = set()
        for peer in peers:
            endpoint = normalize_endpoint(getattr(peer, "ip", None))
            if endpoint is None or endpoint in seen or is_self_endpoint(endpoint):
                continue
            seen.add(endpoint)
            peer_pieces = getattr(peer, "pieces", None)
            has_piece = False
            if peer_pieces is not None and pieces:
                try:
                    num_pieces = len(peer_pieces)
                    has_piece = any(
                        0 <= p < num_pieces and bool(peer_pieces[p])
                        for p in pieces
                    )
                except Exception:
                    has_piece = False
            down_speed = int(getattr(peer, "down_speed", 0) or 0)
            progress = float(getattr(peer, "progress", 0.0) or 0.0)
            if has_piece or down_speed > 0 or progress > 0.0:
                connected_ready_scored.append(
                    ((has_piece, down_speed, progress), endpoint)
                )
                if has_piece and down_speed > 0:
                    active_connected_endpoints.add(endpoint)
            else:
                connected_other.append(endpoint)
        connected_ready_scored.sort(key=lambda item: item[0], reverse=True)
        connected_ready = [endpoint for _, endpoint in connected_ready_scored]

        discovered: list[Endpoint] = []
        discovery = getattr(getattr(self, "record", None), "discovery", None)
        with getattr(discovery, "lock", threading.Lock()):
            discovered_peers = tuple(getattr(discovery, "discovered_peers", ()))
        for peer in discovered_peers:
            endpoint = normalize_endpoint(peer)
            if endpoint is None or endpoint in discovered or is_self_endpoint(endpoint):
                continue
            discovered.append(endpoint)

        discovered = sorted(peer for peer in discovered if peer not in seen)

        pool_lock, working_list, failed_map, sockets, sockets_lock = self._fast_peer_pool()
        required_blocks = {(piece, 0) for piece in pieces}
        with sockets_lock:
            skip_endpoints = {
                ep
                for ep, conn in sockets.items()
                if getattr(conn, "known_bitfield", False)
                and required_blocks
                and not conn.might_have_blocks(required_blocks)
            }

        with pool_lock:
            working = [
                ep
                for ep in working_list
                if not is_self_endpoint(ep) and ep not in skip_endpoints
            ]
            max_endpoints = 16
            now = time.monotonic()
            expired = [ep for ep, ts in failed_map.items() if now - ts >= 45.0]
            for ep in expired:
                failed_map.pop(ep, None)
            fresh_discovered = [
                ep
                for ep in discovered
                if ep not in failed_map and ep not in skip_endpoints
            ]
            stale_discovered = [
                ep
                for ep in discovered
                if ep in failed_map and ep not in skip_endpoints
            ]
            if fresh_discovered:
                offset = getattr(self, "_fast_peer_cursor", 0) % len(fresh_discovered)
                self._fast_peer_cursor = (
                    offset
                    + max(
                        1,
                        max_endpoints
                        - min(
                            6,
                            len(connected_ready)
                            + len(connected_other)
                            + len(working),
                        ),
                    )
                )
                fresh_discovered = fresh_discovered[offset:] + fresh_discovered[:offset]

        connected_all = [
            ep
            for ep in (connected_ready + connected_other)
            if ep not in skip_endpoints
        ]
        connected_fresh = [
            ep
            for ep in connected_all
            if ep not in failed_map or ep in active_connected_endpoints
        ]
        connected_stale = [
            ep
            for ep in connected_all
            if ep in failed_map and ep not in active_connected_endpoints
        ]
        # Prioritize working fast peers and fresh active swarm peers before sampling
        # rotated fresh tracker endpoints and failed endpoints.
        endpoints: list[Endpoint] = []
        for endpoint in (
            working
            + connected_fresh[:6]
            + fresh_discovered
            + connected_fresh[6:]
            + connected_stale
            + stale_discovered
        ):
            if endpoint in endpoints:
                continue
            endpoints.append(endpoint)
            # Stremio keeps a wider connection set during startup. A larger
            # probe fan-out lets a reachable peer win over stale tracker data.
            if len(endpoints) >= max_endpoints:
                break
        return endpoints

    def _start_fast_block_fetch(self, start: int, end: int) -> None:
        required = self._required_range_blocks(start, end)
        if not required or self.stop_event.is_set():
            return

        try:
            piece_length = int(self.info.piece_length())
            file_offset = int(self.info.files().file_offset(self.file_index))
            block_size = int(self.handle.status().block_size)
            total_size = int(self.info.files().total_size())
            info_hash = bytes.fromhex(str(self.handle.info_hash()))
        except (AttributeError, IndexError, TypeError, ValueError):
            return
        if piece_length <= 0 or block_size <= 0 or total_size <= 0:
            return

        pieces = {piece for piece, _ in required}
        have_piece_fn = getattr(self.handle, "have_piece", None)
        have_pieces: Set[int] = set()
        if callable(have_piece_fn):
            try:
                have_pieces = {piece for piece in pieces if have_piece_fn(piece)}
            except Exception:
                have_pieces = set()
        if callable(getattr(self.handle, "get_download_queue", None)):
            finished, _ = self._disk_flushed_blocks(pieces - have_pieces)
            finished.update(item for item in required if item[0] in have_pieces)
        else:
            engine = getattr(self, "engine", None)
            get_finished = getattr(engine, "finished_blocks_for", None)
            if callable(get_finished):
                finished = get_finished(self.handle)
            else:
                finished = set(getattr(self, "_finished_blocks", set()))
            finished.update(item for item in required if item[0] in have_pieces)
        with self._fast_block_lock:
            finished.update(self._fast_blocks)
            now = time.monotonic()
            pending = {
                block
                for block in required - finished - self._fast_blocks_inflight
                if now >= self._fast_block_retry_at.get(block, 0.0)
            }
            if not pending:
                return
            self._fast_blocks_inflight.update(pending)

        endpoints = self._fast_peer_endpoints(
            {piece for piece, _ in pending},
        )
        if not endpoints:
            with self._fast_block_lock:
                self._fast_blocks_inflight.difference_update(pending)
            return

        thread = threading.Thread(
            target=self._fetch_fast_blocks,
            args=(
                pending,
                endpoints,
                info_hash,
                piece_length,
                file_offset,
                block_size,
                total_size,
            ),
            name="torrent-fast-blocks-" + self.session_id,
            daemon=True,
        )
        thread.start()
        log_event(
            "fast block fetch started",
            sessionId=self.session_id,
            blocks=len(pending),
            peers=len(endpoints),
            timingPhase="fast_block_fetch",
            elapsedMs=self.elapsed_ms(),
        )

    def _fetch_fast_blocks(
        self,
        blocks: Set[tuple[int, int]],
        endpoints: list[Endpoint],
        info_hash: bytes,
        piece_length: int,
        file_offset: int,
        block_size: int,
        total_size: int,
    ) -> None:
        active = threading.Event()
        active.set()
        seen: Set[tuple[int, int]] = set()

        def record(block: tuple[int, int], data: bytes) -> None:
            piece, index = block
            position = piece * piece_length + index * block_size
            if position >= file_offset + self.file_size or position + len(data) <= file_offset:
                return
            with self._fast_block_lock:
                if not active.is_set() or self.stop_event.is_set():
                    return
                seen.add(block)
                self._fast_blocks.setdefault(block, data)
                while sum(map(len, self._fast_blocks.values())) > 8 * 1024 * 1024:
                    self._fast_blocks.pop(next(iter(self._fast_blocks)))
                head_blocks = getattr(self, "_startup_fast_head_blocks", set())
                start_virtual_prefetch = bool(
                    self._is_large_piece_torrent()
                    and bool(head_blocks)
                    and not getattr(self, "_startup_fast_prefetch_started", False)
                    and head_blocks.issubset(self._fast_blocks)
                )
                if start_virtual_prefetch:
                    self._startup_fast_prefetch_started = True
            if start_virtual_prefetch:
                virtual_end = min(self.file_size, constants.STARTUP_VIRTUAL_PIECE_BYTES) - 1
                head_end = getattr(self, "_startup_fast_head_end", -1)
                if virtual_end > head_end:
                    self._start_fast_block_fetch(head_end + 1, virtual_end)
            wake = getattr(self, "_range_wake_event", None)
            if wake is not None:
                wake.set()

        _, _, _, sockets, sockets_lock = self._fast_peer_pool()
        try:
            # ponytail: peer blocks are unverified until the piece completes; replace with verified block injection when available.
            fetched = fetch_blocks_from_peers(
                endpoints,
                info_hash,
                self._fast_peer_id,
                blocks,
                piece_length,
                block_size,
                total_size,
                timeout=2.0,
                on_block=record,
                on_peer_success=getattr(self, "_record_fast_peer_success", None),
                on_peer_failure=getattr(self, "_record_fast_peer_failure", None),
                peer_sockets=sockets,
                peer_sockets_lock=sockets_lock,
                should_stop=self.stop_event.is_set,
            )
            for block, data in fetched.items():
                record(block, data)
        finally:
            with self._fast_block_lock:
                active.clear()
                self._fast_blocks_inflight.difference_update(blocks)
                retry_delay = 0.05 if not seen else constants.BLOCKED_REPLAN_INTERVAL
                retry_at = time.monotonic() + retry_delay
                for block in blocks - seen:
                    self._fast_block_retry_at[block] = retry_at
                for block in seen:
                    self._fast_block_retry_at.pop(block, None)
            if not seen:
                wake = getattr(self, "_range_wake_event", None)
                if wake is not None:
                    wake.set()
        fetched = seen
        if fetched:
            log_event(
                "fast blocks ready",
                sessionId=self.session_id,
                blocks=len(fetched),
                timingPhase="fast_block_ready",
                elapsedMs=self.elapsed_ms(),
            )
    def _startup_window_bytes(self) -> int:
        try:
            piece_length = (
                int(self.info.piece_length())
                if getattr(self, "info", None) is not None
                else constants.STREAM_CHUNK_SIZE
            )
        except Exception:
            piece_length = constants.STREAM_CHUNK_SIZE
        if piece_length >= getattr(
            constants, "LARGE_PIECE_THRESHOLD_BYTES", 8 * 1024 * 1024
        ):
            return getattr(constants, "STARTUP_PLAYBACK_BYTES", 4 * 1024 * 1024)
        return max(
            getattr(constants, "STARTUP_PLAYBACK_BYTES", 4 * 1024 * 1024),
            piece_length * constants.STARTUP_WINDOW_PIECES,
        )

    def _is_startup_window_active(self, start: Optional[int] = None) -> bool:
        if getattr(self, "info", None) is None:
            return not getattr(self, "_has_streamed_bytes", False)
        if (
            getattr(self, "_has_streamed_bytes", False)
            and getattr(self, "_playhead_streamed_bytes", None) is None
        ):
            return False
        window_bytes = self._startup_window_bytes()
        if (
            start is not None
            and (getattr(self, "start_time", 0.0) or 0.0) > 0.0
            and start < window_bytes
        ):
            return True
        streamed = int(getattr(self, "_playhead_streamed_bytes", 0) or 0)
        return streamed < window_bytes

    def _startup_progress_fields(self) -> dict[str, Any]:
        downloaded_bytes = None
        file_progress_pct = None
        try:
            if getattr(self, "handle", None) is not None:
                if getattr(self, "file_index", None) is not None:
                    downloaded_bytes = int(
                        self.handle.file_progress()[self.file_index]
                    )
                else:
                    downloaded_bytes = int(
                        getattr(self.handle.status(), "total_done", 0)
                    )
                if downloaded_bytes is not None and getattr(self, "file_size", 0) > 0:
                    file_progress_pct = round(
                        (downloaded_bytes / self.file_size) * 100.0, 2
                    )
        except Exception:
            pass
        return {
            "downloadedBytes": downloaded_bytes,
            "fileProgressPct": file_progress_pct,
            "streamedBytes": int(getattr(self, "_playhead_streamed_bytes", 0) or 0),
        }

    def _protected_startup_critical_pieces(self) -> Set[int]:
        protected = set(
            getattr(self, "_startup_required_tail_pieces", set())
        )
        if (
            getattr(self, "_playback_focus_piece", None) in (None, 0)
            and (getattr(self, "start_time", 0.0) or 0.0) > 0.0
        ):
            protected.update(
                getattr(self, "_startup_required_target_pieces", set())
            )
        return protected

    def _schedule_pieces(
        self,
        prefetch_pieces: list[int],
        required_pieces: Set[int],
        reason: str,
        is_sync: bool = False,
        sync_metadata: Optional[dict[str, Any]] = None,
    ) -> None:
        """Keep stream demand and read-ahead priorities additive.

        HTTP clients can issue probe, seek, and playback ranges concurrently.
        Resetting the complete piece-priority array for each request lets one
        request starve another. Set only the pieces needed by this request so
        previously scheduled stream pieces remain eligible.
        """
        missing_pieces = 0
        required_set = set(required_pieces)
        first_required_piece = min(required_set) if required_set else None
        required_list = sorted(required_set)
        required_ranks = {p: i for i, p in enumerate(required_list)}
        first_piece_was_prioritized = False
        prioritized_piece_bounds: list[int] = []
        with self._piece_priority_lock:
            for index, piece in enumerate(prefetch_pieces):
                try:
                    if self.handle.have_piece(piece):
                        continue
                except RuntimeError:
                    return
                if piece in getattr(self, "_pending_kick_restore", {}):
                    continue
                if self._should_pause_boundary_piece(piece, is_sync=is_sync):
                    try:
                        self._pause_boundary_piece(piece)
                    except Exception:
                        pass
                    continue
                paused_boundary = getattr(self, "_paused_boundary_pieces", None)
                if paused_boundary:
                    paused_boundary.discard(piece)

                if piece in required_set:
                    focus_piece = getattr(self, "_focus_piece", None)
                    protected_tail = self._protected_startup_critical_pieces()
                    rank = required_ranks.get(piece, 0)
                    deadline_ms = min(250, rank * 25)
                    if is_sync:
                        priority = constants.STREAM_PIECE_PRIORITY
                        deadline_ms = 0
                    elif (
                        focus_piece is not None
                        and piece != focus_piece
                        and piece not in protected_tail
                    ):
                        priority = constants.STREAM_HOT_PIECE_PRIORITY
                    else:
                        priority = constants.STREAM_PIECE_PRIORITY
                    if not is_sync and self._boundary_piece_competes(piece):
                        priority = constants.STREAM_IDLE_FILE_PRIORITY
                        deadline_ms = None
                elif (
                    self._is_startup_window_active()
                    and index < constants.STARTUP_WINDOW_PIECES
                ):
                    priority = constants.STREAM_HOT_PIECE_PRIORITY
                    # Keep the bootstrap window active without adding more
                    # time-critical pieces than the current playhead.
                    deadline_ms = None
                else:
                    priority = constants.STREAM_WARM_PIECE_PRIORITY
                    deadline_ms = None
                try:
                    if deadline_ms is None:
                        if piece in getattr(self, "_piece_deadlines", {}):
                            self._reset_piece_deadline(piece)
                        self.handle.piece_priority(piece, priority)
                    else:
                        self.handle.piece_priority(piece, priority)
                        self._set_piece_deadline(
                            piece,
                            max(0, deadline_ms),
                        )
                    with self._piece_priority_lock:
                        self._boosted_pieces.add(piece)
                        self._piece_priorities = getattr(
                            self,
                            "_piece_priorities",
                            {},
                        )
                        self._piece_priorities[piece] = priority
                    if piece == first_required_piece:
                        first_piece_was_prioritized = True
                    prioritized_piece_bounds.append(piece)
                    missing_pieces += 1
                except Exception:
                    continue

        # Suppress repetitive blocked-replan logs; they change nothing between
        # re-asserts and drown out the important timing events.
        now = time.monotonic()
        last_logged = getattr(self, "_last_range_prioritized_log", 0.0)
        suppress = (
            reason == "blocked-replan"
            and missing_pieces == getattr(self, "_last_range_prioritized_missing", None)
            and now - last_logged < constants.BLOCKED_REPLAN_REASSERT_INTERVAL
        )
        if not suppress:
            self._last_range_prioritized_log = now
            self._last_range_prioritized_missing = missing_pieces
            log_event(
                "range prioritized",
                sessionId=self.session_id,
                reason=reason,
                pieces=len(prefetch_pieces),
                firstPiece=(prefetch_pieces[0] if prefetch_pieces else None),
                lastPiece=(prefetch_pieces[-1] if prefetch_pieces else None),
                requiredPieces=len(required_pieces),
                missingPieces=missing_pieces,
                firstMissingPiece=(
                    prioritized_piece_bounds[0]
                    if prioritized_piece_bounds
                    else None
                ),
                lastMissingPiece=(
                    prioritized_piece_bounds[-1]
                    if prioritized_piece_bounds
                    else None
                ),
                timingPhase=(
                    "first_chunk_prioritized"
                    if reason == "first-chunk"
                    else None
                ),
                **(sync_metadata or {}),
            )
        if (
            required_set
            and first_piece_was_prioritized
            and not getattr(self, "_first_piece_prioritized_logged", False)
            and reason in ("first-chunk", "range", "blocked-replan")
        ):
            self._first_piece_prioritized_logged = True
            log_event(
                "first piece prioritized",
                sessionId=self.session_id,
                piece=first_required_piece,
                priority=constants.STREAM_PIECE_PRIORITY,
                deadlineMs=0,
                timingPhase="first_piece_prioritized",
                elapsedMs=self.elapsed_ms(),
                **(sync_metadata or {}),
            )
        if (
            is_sync
            and not getattr(self, "_first_sync_range_prioritized_logged", False)
        ):
            self._first_sync_range_prioritized_logged = True
            log_event(
                "first sync range prioritized",
                sessionId=self.session_id,
                requiredPieces=len(required_set),
                pieces=len(prefetch_pieces),
                priority=constants.STREAM_PIECE_PRIORITY,
                deadlineMs=0,
                timingPhase="first_sync_range_prioritized",
                elapsedMs=self.elapsed_ms(),
                **(sync_metadata or {}),
            )

    def _reset_piece_deadline(self, piece: int) -> None:
        reset_deadline = getattr(self.handle, "reset_piece_deadline", None)
        if callable(reset_deadline):
            try:
                reset_deadline(piece)
            except Exception:
                pass
        with self._piece_priority_lock:
            self._piece_deadlines = getattr(
                self,
                "_piece_deadlines",
                {},
            )
            self._piece_deadlines.pop(piece, None)

    def _focus_playback_piece(self, target_piece: int) -> None:
        """Move the time-critical window to the current playback head.

        Startup prefetch may have queued deadlines for an earlier probe. Clear
        those deadlines before the first playable range is scheduled, then
        leave only the current head eligible for deadline-driven requests.
        """
        with self._piece_priority_lock:
            file_first_piece = self._file_first_piece()
            is_resume_header_probe = (
                target_piece == file_first_piece
                and (getattr(self, "start_time", 0.0) or 0.0) > 0.0
            )
            prev_target = getattr(self, "_playback_focus_piece", None)
            if prev_target == target_piece:
                return
            if (
                is_resume_header_probe
                and prev_target is not None
                and prev_target > file_first_piece
            ):
                return
            self._playback_focus_piece = target_piece
            if (
                prev_target != target_piece
                and getattr(self, "_playhead_streamed_bytes", None) is not None
            ):
                self._playhead_streamed_bytes = 0
            if target_piece > file_first_piece:
                self._startup_target_pieces = set()
                self._startup_required_target_pieces = set()
            clear_deadlines = getattr(
                self.handle,
                "clear_piece_deadlines",
                None,
            )
            if callable(clear_deadlines):
                try:
                    clear_deadlines()
                except Exception:
                    pass
            self._piece_deadlines = getattr(
                self,
                "_piece_deadlines",
                {},
            )
            self._piece_deadlines.clear()
            demoted = 0
            tail_already_served = bool(
                getattr(self, "_tail_probe_ready_logged", False)
            )
            protected_tail = (
                set()
                if (target_piece > file_first_piece and tail_already_served)
                else getattr(self, "_startup_tail_pieces", set())
            )
            protected_targets = (
                getattr(self, "_startup_target_pieces", set())
                if is_resume_header_probe
                else set()
            )
            keep_boosted = (
                {target_piece}
                | set(protected_tail)
                | set(protected_targets)
            )
            for piece in list(self._boosted_pieces):
                if piece in keep_boosted:
                    continue
                self._boosted_pieces.discard(piece)
                try:
                    if self.handle.have_piece(piece):
                        continue
                    demote_prio = (
                        0
                        if (
                            tail_already_served
                            and target_piece > file_first_piece
                            and piece in getattr(self, "_startup_tail_pieces", set())
                        )
                        else constants.STREAM_IDLE_FILE_PRIORITY
                    )
                    self.handle.piece_priority(
                        piece,
                        demote_prio,
                    )
                    self._piece_priorities[piece] = demote_prio
                    demoted += 1
                except Exception:
                    continue

            # Switch sequential download mode based on target position:
            # At piece 0 (without resume target), sequential mode ensures normal linear streaming.
            # On resume header probes or at target_piece > file_first_piece, disabling global
            # sequential download prevents libtorrent from clogging peer pipelines with 0..N-1.
            self._set_sequential_mode(
                target_piece == file_first_piece
                and not is_resume_header_probe
                and not self._is_large_piece_torrent(),
            )

            # Suppress uncompleted pieces prior to target_piece (except file_first_piece & tail)
            # so 100% bandwidth focuses on the seek/resume position.
            if (
                target_piece > file_first_piece
                and getattr(self, "info", None) is not None
            ):
                protected_startup = {file_first_piece} | set(protected_tail)
                try:
                    for piece in range(file_first_piece, target_piece):
                        if (
                            piece in protected_startup
                            or piece in self._boosted_pieces
                        ):
                            continue
                        if self.handle.have_piece(piece):
                            continue
                        if self.handle.piece_priority(piece) != 0:
                            self.handle.piece_priority(piece, 0)
                            self._piece_priorities[piece] = 0
                            demoted += 1
                except Exception:
                    pass

            # When seeking backward, un-filter pieces between new target_piece and old target_piece
            if prev_target is not None and target_piece < prev_target:
                try:
                    for piece in range(target_piece, prev_target + 1):
                        if not self.handle.have_piece(piece) and self.handle.piece_priority(piece) == 0:
                            self.handle.piece_priority(piece, constants.STREAM_IDLE_FILE_PRIORITY)
                            self._piece_priorities[piece] = constants.STREAM_IDLE_FILE_PRIORITY
                except Exception:
                    pass

            # Re-assert deadlines and priority for uncompleted startup tail pieces
            required_tail = (
                set()
                if (target_piece > file_first_piece and tail_already_served)
                else getattr(self, "_startup_required_tail_pieces", set())
            )
            for piece in required_tail:
                try:
                    if not self.handle.have_piece(piece):
                        self.handle.piece_priority(
                            piece,
                            constants.STREAM_PIECE_PRIORITY,
                        )
                        self._set_piece_deadline(piece, 50)
                except Exception:
                    pass
            if is_resume_header_probe:
                for piece in getattr(self, "_startup_required_target_pieces", set()):
                    try:
                        if not self.handle.have_piece(piece):
                            self.handle.piece_priority(
                                piece,
                                constants.STREAM_PIECE_PRIORITY,
                            )
                            self._set_piece_deadline(piece, 75)
                    except Exception:
                        pass
        log_event(
            "playback piece focused",
            sessionId=self.session_id,
            targetPiece=target_piece,
            demotedPieces=demoted,
            timingPhase="playback_piece_focus",
            elapsedMs=self.elapsed_ms(),
        )
    def _log_first_piece_ready(self, piece: Optional[int]) -> None:
        if piece is None or getattr(self, "_first_piece_ready_logged", False):
            return
        self._first_piece_ready_logged = True
        log_event(
            "first piece ready",
            sessionId=self.session_id,
            piece=piece,
            timingPhase="first_piece_ready",
            elapsedMs=self.elapsed_ms(),
        )

    def _piece_availability(self, piece: Optional[int]) -> Optional[int]:
        if piece is None:
            return None
        try:
            availability = self.handle.piece_availability()
            if piece >= len(availability):
                return None
            return int(availability[piece])
        except Exception:
            return None

    def _piece_have(self, piece: Optional[int]) -> Optional[bool]:
        if piece is None:
            return None
        try:
            return bool(self.handle.have_piece(piece))
        except Exception:
            return None

    def _piece_priority(self, piece: Optional[int]) -> Optional[int]:
        if piece is None:
            return None
        try:
            value = self.handle.piece_priority(piece)
            return int(value)
        except Exception:
            lock = getattr(self, "_piece_priority_lock", None)
            if lock is None:
                value = getattr(self, "_piece_priorities", {}).get(piece)
            else:
                with lock:
                    value = getattr(self, "_piece_priorities", {}).get(piece)
            return int(value) if value is not None else None

    def _piece_deadline(self, piece: Optional[int]) -> Optional[int]:
        if piece is None:
            return None
        lock = getattr(self, "_piece_priority_lock", None)
        if lock is None:
            value = getattr(self, "_piece_deadlines", {}).get(piece)
        else:
            with lock:
                value = getattr(self, "_piece_deadlines", {}).get(piece)
        return int(value) if value is not None else None

    def _activate_target_focus(self, target_piece: int) -> bool:
        """Give the stalled target exclusive bandwidth.

        The swarm races ahead on other priority-7 pieces while the target's
        final blocks sit with slow peers, so raising the target alone never
        finishes it. Demote every other priority-7 piece to hot priority so
        the target owns the swarm until it completes. Only one stall owns
        the focus at a time; concurrent request loops keep their required
        pieces at hot priority until the focus is released.
        """
        with self._piece_priority_lock:
            current = getattr(self, "_focus_piece", None)
            if current is not None and current != target_piece:
                return False
            if current == target_piece:
                return True
            self._focus_piece = target_piece
            demoted = 0
            protected_tail = self._protected_startup_critical_pieces()
            for piece, priority in list(self._piece_priorities.items()):
                if (
                    piece == target_piece
                    or piece in protected_tail
                    or priority != constants.STREAM_PIECE_PRIORITY
                ):
                    continue
                try:
                    if self.handle.have_piece(piece):
                        continue
                    self.handle.piece_priority(
                        piece,
                        constants.STREAM_HOT_PIECE_PRIORITY,
                    )
                    self._piece_priorities[piece] = (
                        constants.STREAM_HOT_PIECE_PRIORITY
                    )
                    self._reset_piece_deadline(piece)
                    demoted += 1
                except Exception:
                    continue
            if demoted:
                log_event(
                    "target piece focus",
                    sessionId=self.session_id,
                    targetPiece=target_piece,
                    demotedPieces=demoted,
                    timingPhase="target_piece_focus",
                    elapsedMs=self.elapsed_ms(),
                )
            return True

    def _release_target_focus(self, target_piece: Optional[int]) -> None:
        """Clear focus ownership without re-raising demoted pieces; their
        owning request loops re-assert top priority on their next schedule."""
        if target_piece is None:
            return
        with self._piece_priority_lock:
            if getattr(self, "_focus_piece", None) == target_piece:
                self._focus_piece = None

    def _post_kick_cancel(self, target_piece: int) -> None:
        """Trigger libtorrent's cancel_non_critical for the stalled piece.

        libtorrent only sends CANCEL messages from cancel_non_critical(),
        which it posts when set_piece_deadline() is called with an empty
        time-critical list, cancelling every in-flight request except the
        time-critical pieces. Add a throwaway missing piece to that list to
        post the cancel (the target itself must not be time-critical when it
        runs, so it is exempt from the cancel), then un-promote it again.
        """
        try:
            num_pieces = int(self.info.num_pieces())
        except Exception:
            return
        file_scoped = getattr(self, "file_index", None) is not None
        candidates: list[int] = []
        if file_scoped and getattr(self, "file_size", 0) > 0:
            try:
                candidates = sorted(self.map_pieces(0, self.file_size))
            except Exception:
                candidates = []
        if not candidates:
            candidates = list(range(num_pieces))
        for piece in candidates:
            if piece == target_piece:
                continue
            try:
                if self.handle.have_piece(piece):
                    continue
            except RuntimeError:
                return
            orig_prio = self._piece_priority(piece) if file_scoped else None
            try:
                # flags=0 (no alert_when_available): avoid read_piece_alert
                self.handle.set_piece_deadline(piece, 10000, 0)
            except Exception:
                return
            reset_deadline = getattr(self.handle, "reset_piece_deadline", None)
            if callable(reset_deadline):
                try:
                    reset_deadline(piece)
                except Exception:
                    pass
            if file_scoped and orig_prio is not None:
                try:
                    self.handle.piece_priority(piece, orig_prio)
                except Exception:
                    pass
            return

    def _range_target_piece_has_prefix(
        self,
        start: int,
        end: int,
        target_piece: Optional[int],
    ) -> bool:
        """Return whether the requested range starts inside a piece."""
        if target_piece is None:
            return False
        required = self._required_range_blocks(start, end)
        target_blocks = {
            block
            for piece, block in required
            if piece == target_piece
        }
        if not target_blocks:
            return False
        return min(target_blocks) > 0

    def _piece_blocks_finished_count(
        self,
        target_piece: Optional[int],
        piece_blocks: Optional[Set[int]] = None,
    ) -> int:
        if target_piece is None:
            return 0
        queue_count = 0
        get_queue = getattr(self.handle, "get_download_queue", None)
        if callable(get_queue):
            try:
                for entry in get_queue():
                    if int(entry.get("piece_index", -1)) == target_piece:
                        queue_count = sum(
                            1
                            for idx, block in enumerate(entry.get("blocks", ()))
                            if (piece_blocks is None or idx in piece_blocks)
                            and int(block.get("state", 0)) >= 2
                        )
                        break
            except Exception:
                queue_count = 0
        engine = getattr(self, "engine", None)
        get_finished = getattr(engine, "finished_blocks_for", None)
        alert_count = 0
        if callable(get_finished):
            try:
                finished = get_finished(self.handle)
                alert_count = sum(
                    1
                    for piece, block in finished
                    if piece == target_piece
                    and (piece_blocks is None or block in piece_blocks)
                )
            except Exception:
                alert_count = 0
        return max(queue_count, alert_count)

    def _target_piece_finished_blocks(
        self,
        target_piece: Optional[int],
    ) -> int:
        """Count blocks written for target_piece so active downloads are not kicked."""
        return self._piece_blocks_finished_count(target_piece)

    def _required_target_blocks_finished(
        self,
        target_piece: int,
        required_blocks: Set[tuple[int, int]],
    ) -> int:
        """Count state >= 2/finished blocks for block-0-aligned sub-ranges."""
        piece_blocks = {b for p, b in required_blocks if p == target_piece}
        if not piece_blocks:
            return self._target_piece_finished_blocks(target_piece)
        return self._piece_blocks_finished_count(target_piece, piece_blocks)

    def _target_piece_has_pending_requests(
        self,
        target_piece: Optional[int],
    ) -> bool:
        """True when libtorrent currently has active wire requests for target_piece."""
        if target_piece is None:
            return False
        get_queue = getattr(self.handle, "get_download_queue", None)
        if not callable(get_queue):
            return False
        try:
            for entry in get_queue():
                if int(entry.get("piece_index", -1)) == target_piece:
                    return any(
                        int(block.get("state", 0)) >= 1
                        for block in entry.get("blocks", ())
                    )
        except Exception:
            return False
        return False

    def _kick_target_piece(self, target_piece: Optional[int]) -> None:
        """Cancel a stalled target piece so its blocks are re-requested.

        Raising priority alone never cancels in-flight block requests, so a
        piece whose final blocks sit with slow peers can stay incomplete for
        minutes while the swarm races ahead. Filter the piece (priority 0)
        and hold it there for a full picker tick (TARGET_KICK_RESTORE_DELAY)
        while _post_kick_cancel() makes libtorrent send CANCEL messages for
        every non-time-critical in-flight request, the stalled piece's
        included. Once the hold expires, _restore_pending_kicks re-raises
        the piece so every peer that has it re-requests the missing blocks
        (endgame).
        """
        if target_piece is None or self._piece_have(target_piece):
            return
        if self._should_pause_boundary_piece(target_piece):
            try:
                self._pause_boundary_piece(target_piece)
            except Exception:
                pass
            return

        try:
            # Empty the time-critical list first: the piece's in-flight
            # requests are only cancellable while it is not time-critical.
            # clear_piece_deadlines() drops every deadline piece to low
            # priority (transient; the next schedule re-asserts them).
            clear_deadlines = getattr(
                self.handle,
                "clear_piece_deadlines",
                None,
            )
            if callable(clear_deadlines):
                clear_deadlines()
            else:
                reset_deadline = getattr(
                    self.handle,
                    "reset_piece_deadline",
                    None,
                )
                if callable(reset_deadline):
                    reset_deadline(target_piece)
            # Filter the piece: priority 0 stops the picker from requesting
            # more of its blocks during the hold. Filtering alone does not
            # abort in-flight requests; _post_kick_cancel() handles that.
            self.handle.piece_priority(target_piece, 0)
            self._post_kick_cancel(target_piece)
            with self._piece_priority_lock:
                self._piece_priorities = getattr(
                    self,
                    "_piece_priorities",
                    {},
                )
                self._piece_priorities[target_piece] = 0
                self._pending_kick_restore = getattr(
                    self,
                    "_pending_kick_restore",
                    {},
                )
                self._pending_kick_restore[target_piece] = (
                    time.monotonic() + constants.TARGET_KICK_RESTORE_DELAY
                )
                for tail_piece in self._protected_startup_critical_pieces():
                    if (
                        tail_piece == target_piece
                        or tail_piece in self._pending_kick_restore
                        or self.handle.have_piece(tail_piece)
                    ):
                        continue
                    self.handle.piece_priority(
                        tail_piece,
                        constants.STREAM_PIECE_PRIORITY,
                    )
                    self._piece_priorities[tail_piece] = (
                        constants.STREAM_PIECE_PRIORITY
                    )
                    self._set_piece_deadline(tail_piece, 100)
        except Exception:
            return

        log_event(
            "target piece kicked",
            sessionId=self.session_id,
            targetPiece=target_piece,
            targetPieceAvailability=self._piece_availability(target_piece),
            targetPieceHave=False,
            targetPiecePriority=self._piece_priority(target_piece),
            targetPieceDeadlineMs=self._piece_deadline(target_piece),
            restoreDelayMs=int(constants.TARGET_KICK_RESTORE_DELAY * 1000),
            timingPhase="target_piece_kicked",
            elapsedMs=self.elapsed_ms(),
        )

    def _restore_pending_kicks(self, now: Optional[float] = None) -> None:
        """Re-raise kicked pieces whose priority-0 hold has expired.

        Called from the range-wait loop every tick and on every exit path so
        a cancelled piece is never left at priority 0 once the hold that made
        the cancellation effective is over.
        """
        if now is None:
            now = time.monotonic()
        handle = getattr(self, "handle", None)
        if handle is None:
            return
        with self._piece_priority_lock:
            self._unpause_stale_boundary_pieces()
            pending = getattr(self, "_pending_kick_restore", {})
            if not pending:
                return
            for piece, restore_at in list(pending.items()):
                if now < restore_at:
                    continue
                pending.pop(piece, None)
                try:
                    if handle.have_piece(piece):
                        handle.piece_priority(
                            piece,
                            constants.STREAM_IDLE_FILE_PRIORITY,
                        )
                        continue
                    if self._should_pause_boundary_piece(piece):
                        self._pause_boundary_piece(piece)
                        continue
                    handle.piece_priority(
                        piece,
                        constants.STREAM_PIECE_PRIORITY,
                    )
                    reset_deadline = getattr(
                        handle,
                        "reset_piece_deadline",
                        None,
                    )
                    if callable(reset_deadline):
                        reset_deadline(piece)
                    self._set_piece_deadline(piece, 0)
                    self._boosted_pieces = getattr(
                        self,
                        "_boosted_pieces",
                        set(),
                    )
                    self._boosted_pieces.add(piece)
                    self._piece_priorities = getattr(
                        self,
                        "_piece_priorities",
                        {},
                    )
                    self._piece_priorities[piece] = (
                        constants.STREAM_PIECE_PRIORITY
                    )
                except Exception:
                    continue
                log_event(
                    "target piece escalated",
                    sessionId=self.session_id,
                    targetPiece=piece,
                    targetPieceAvailability=self._piece_availability(piece),
                    targetPieceHave=False,
                    targetPiecePriority=self._piece_priority(piece),
                    targetPieceDeadlineMs=self._piece_deadline(piece),
                    timingPhase="target_piece_escalated",
                    elapsedMs=self.elapsed_ms(),
                )
            for tail_piece in self._protected_startup_critical_pieces():
                if tail_piece in pending:
                    continue
                try:
                    if not handle.have_piece(tail_piece):
                        handle.piece_priority(
                            tail_piece,
                            constants.STREAM_PIECE_PRIORITY,
                        )
                        self._set_piece_deadline(tail_piece, 25)
                except Exception:
                    continue

    def _force_reannounce_if_stalled(
        self,
        target_piece: Optional[int],
        blocked_waits: int,
        stall_seconds: float,
    ) -> None:
        target_availability = self._piece_availability(target_piece)
        if (
            target_piece is None
            or stall_seconds < constants.TARGET_STALL_REANNOUNCE_DELAY
            or target_availability is None
        ):
            return

        now = time.monotonic()
        with self._reannounce_lock:
            if (
                now - getattr(self, "_last_reannounce", 0.0)
                < constants.REANNOUNCE_COOLDOWN
            ):
                return

            announced = False
            record = getattr(self, "record", None)
            reactivate = getattr(record, "reactivate", None)
            if callable(reactivate):
                try:
                    reactivate(self.session_id)
                    announced = True
                except Exception as error:
                    sys.stderr.write(
                        f"[sidecar] Failed to reactivate stalled torrent: {error}\n",
                    )
            if not announced:
                force_reannounce = getattr(self.handle, "force_reannounce", None)
                force_dht_announce = getattr(
                    self.handle,
                    "force_dht_announce",
                    None,
                )
                try:
                    if callable(force_reannounce):
                        force_reannounce()
                        announced = True
                except Exception:
                    pass
                try:
                    if callable(force_dht_announce):
                        force_dht_announce()
                        announced = True
                except Exception:
                    pass
            if not announced:
                return
            self._last_reannounce = now

        status = self.handle.status()
        log_event(
            "swarm reannounce",
            sessionId=self.session_id,
            peers=int(getattr(status, "num_peers", 0)),
            downloadRate=int(getattr(status, "download_rate", 0)),
            blockedWaits=blocked_waits,
            targetPiece=target_piece,
            targetPieceAvailability=target_availability,
            targetPieceHave=self._piece_have(target_piece),
            targetPiecePriority=self._piece_priority(target_piece),
            targetPieceDeadlineMs=self._piece_deadline(target_piece),
            stallMs=int(stall_seconds * 1000),
            timingPhase="swarm_reannounce",
            elapsedMs=self.elapsed_ms(),
        )

    def _get_range_prefetch_bytes(self, is_sync: bool) -> int:
        if is_sync:
            return constants.SYNC_RANGE_PREFETCH_BYTES
        base, _ = self._get_quality_prefetch_window()
        return self._apply_profile_prefetch(base)

    def _get_max_replan_prefetch_bytes(self, is_sync: bool) -> int:
        if is_sync:
            return constants.SYNC_RANGE_PREFETCH_BYTES
        _, base = self._get_quality_prefetch_window()
        return self._apply_profile_prefetch(base)

    def _normalized_quality_hint(self) -> str:
        request = getattr(self, "request", {})
        if not isinstance(request, dict):
            return ""
        return str(request.get("quality", "")).strip().lower()

    def _get_quality_prefetch_window(self) -> tuple[int, int]:
        """Scale steady-state prefetch by quality tier with file-size guard."""
        if self._is_high_bitrate_stream():
            return (
                constants.HIGH_BITRATE_RANGE_PREFETCH_BYTES,
                constants.HIGH_BITRATE_MAX_REPLAN_PREFETCH_BYTES,
            )
        quality = self._normalized_quality_hint()
        if quality in {"1080", "1080p", "fhd"}:
            file_size = getattr(self, "file_size", None)
            if (
                file_size is not None
                and 0 < file_size < constants.COMPACT_FHD_FILE_THRESHOLD_BYTES
            ):
                return (
                    constants.COMPACT_FHD_RANGE_PREFETCH_BYTES,
                    constants.COMPACT_FHD_MAX_REPLAN_PREFETCH_BYTES,
                )
            return (
                constants.RANGE_PREFETCH_BYTES,
                constants.MAX_REPLAN_PREFETCH_BYTES,
            )
        tiers = (
            ({"1440", "1440p", "2k", "qhd"}, constants.QHD_RANGE_PREFETCH_BYTES, constants.QHD_MAX_REPLAN_PREFETCH_BYTES),
            ({"720", "720p", "hd"}, constants.HD_RANGE_PREFETCH_BYTES, constants.HD_MAX_REPLAN_PREFETCH_BYTES),
            ({"480", "480p", "360", "360p", "sd"}, constants.SD_RANGE_PREFETCH_BYTES, constants.SD_MAX_REPLAN_PREFETCH_BYTES),
        )
        for aliases, prefetch_bytes, max_replan_bytes in tiers:
            if quality in aliases:
                return (prefetch_bytes, max_replan_bytes)
        return (
            constants.RANGE_PREFETCH_BYTES,
            constants.MAX_REPLAN_PREFETCH_BYTES,
        )

    def _is_high_bitrate_stream(self) -> bool:
        """Use the addon quality hint before falling back to file size.

        A 4K encode can be smaller than 4 GiB. Relying only on file size
        leaves those streams on the 32 MiB default window and starves the
        next HEVC reference range before libmpv can pause cleanly.
        """
        if self._normalized_quality_hint() in {"4k", "2160", "2160p", "uhd"}:
            return True
        file_size = getattr(self, "file_size", None)
        return bool(
            file_size is not None
            and file_size >= constants.HIGH_BITRATE_FILE_THRESHOLD_BYTES
        )

    def _apply_profile_prefetch(self, byte_count: int) -> int:
        numerator, denominator = {
            "soft": (1, 2),
            "default": (1, 1),
            "fast": (3, 2),
            "ultra-fast": (2, 1),
        }.get(getattr(self, "torrent_profile", "default"), (1, 1))
        return max(1, byte_count * numerator // denominator)

    def wait_for_range(
        self,
        start: int,
        end: int,
        timeout: Optional[float] = constants.RANGE_WAIT_TIMEOUT,
        handler: Optional[BaseHTTPRequestHandler] = None,
        connect_start: float = 0.0,
        track_position: bool = True,
        is_sync: bool = False,
        sync_metadata: Optional[dict[str, Any]] = None,
        playback_request_id: Optional[int] = None,
        require_verified: bool = False,
        request_end: Optional[int] = None,
    ) -> bool:
        if track_position and self._is_playback_request_superseded(
            playback_request_id,
        ):
            return False
        is_tail_probe = start > 0 and not track_position and not is_sync
        startup_bounded = (
            getattr(self, "info", None) is not None
            and not is_sync
            and not is_tail_probe
            and self._is_startup_window_active(start)
        )
        use_fast_stall_timers = startup_bounded or (
            is_tail_probe and bool(getattr(self, "_startup_tail_pieces", None))
        )
        focus_delay = (
            min(
                constants.TARGET_FOCUS_DELAY,
                getattr(constants, "STARTUP_TARGET_FOCUS_DELAY", 0.8),
            )
            if use_fast_stall_timers
            else constants.TARGET_FOCUS_DELAY
        )
        kick_delay = (
            min(
                constants.TARGET_KICK_DELAY,
                getattr(constants, "STARTUP_TARGET_KICK_DELAY", 0.4),
            )
            if use_fast_stall_timers
            else constants.TARGET_KICK_DELAY
        )
        reannounce_delay = (
            min(constants.TARGET_STALL_REANNOUNCE_DELAY, kick_delay)
            if use_fast_stall_timers
            else constants.TARGET_STALL_REANNOUNCE_DELAY
        )
        if is_tail_probe:
            prefetch_length = max(1, end - start + 1)
        elif startup_bounded:
            prefetch_length = max(
                end - start + 1,
                self._startup_window_bytes(),
            )
        else:
            prefetch_length = max(
                end - start + 1,
                self._get_range_prefetch_bytes(is_sync),
            )
        required_pieces = sorted(self.map_pieces(start, end - start + 1))
        if is_tail_probe and required_pieces:
            with self._piece_priority_lock:
                self._startup_required_tail_pieces = set(required_pieces)
        all_pieces = sorted(self.map_pieces(start, prefetch_length))
        range_key = (start, end)
        first_required_piece = min(required_pieces) if required_pieces else None
        last_required_piece = max(required_pieces) if required_pieces else None
        try:
            all_ready = (
                (
                    all(self.handle.have_piece(p) for p in required_pieces)
                    if require_verified
                    else self.range_is_ready(start, end)
                )
                if required_pieces
                else True
            )
        except RuntimeError:
            all_ready = False

        should_log_wait = (
            not all_ready
            or first_required_piece != getattr(self, "_last_wait_logged_piece", None)
            or is_tail_probe
            or is_sync
        )
        if should_log_wait and getattr(self, "last_range_key", None) != range_key:
            self.last_range_key = range_key
            self._last_wait_logged_piece = first_required_piece
            total_done_bytes = None
            file_progress_bytes = None
            download_rate = None
            connected_peers = None
            handle_paused = None
            discovery_status: dict[str, Any] = {}
            try:
                status = self.handle.status()
                total_done_bytes = int(getattr(status, "total_done", 0))
                download_rate = int(getattr(status, "download_rate", 0))
                connected_peers = int(getattr(status, "num_peers", 0))
                handle_paused = getattr(status, "paused", None)
                if self.file_index is not None:
                    file_progress_bytes = int(
                        self.handle.file_progress()[self.file_index],
                    )
                piece_flags = getattr(status, "pieces", None)
                piece_count = len(piece_flags) if piece_flags is not None else None
                first_piece_available = (
                    bool(piece_flags[first_required_piece])
                    if (
                        piece_flags is not None
                        and first_required_piece is not None
                        and first_required_piece < len(piece_flags)
                    )
                    else None
                )
                availability = self.handle.piece_availability()
                first_piece_availability = (
                    int(availability[first_required_piece])
                    if (
                        first_required_piece is not None
                        and first_required_piece < len(availability)
                    )
                    else None
                )
                record = getattr(self, "record", None)
                engine = getattr(self, "engine", None)
                if record is not None and engine is not None:
                    discovery_status = engine.get_discovery_status(record)
            except Exception:
                piece_count = None
                first_piece_available = None
                first_piece_availability = None
            log_event(
                "range wait",
                sessionId=self.session_id,
                start=start,
                end=end,
                requiredPieces=len(required_pieces),
                firstPiece=first_required_piece,
                lastPiece=last_required_piece,
                pieceCount=piece_count,
                firstPieceAvailable=first_piece_available,
                firstPieceAvailability=first_piece_availability,
                totalDoneBytes=total_done_bytes,
                fileProgressBytes=file_progress_bytes,
                downloadRate=download_rate,
                connectedPeers=connected_peers,
                handlePaused=handle_paused,
                trackPosition=track_position,
                elapsedMs=self.elapsed_ms(),
                **discovery_status,
                **(sync_metadata or {}),
            )

        deadline = (
            time.monotonic() + timeout
            if timeout is not None
            else None
        )

        previous_stream_start = getattr(self, "_last_stream_start", None)
        if track_position:
            self.maybe_refocus(start)
        fast_end = end
        is_contiguous_followup = False
        v_end = end
        if (
            track_position
            and not is_sync
            and self.file_size > 0
            and self._is_large_piece_torrent()
        ):
            is_contiguous_followup = (
                previous_stream_start is not None
                and 0 < start - previous_stream_start <= constants.INITIAL_STREAM_BYTES
            )
            can_pipeline_first_virtual_piece = False
            if start == 0 and not is_contiguous_followup:
                can_pipeline_first_virtual_piece = self._has_warm_fast_peer()
            if is_contiguous_followup or can_pipeline_first_virtual_piece:
                vp = constants.STARTUP_VIRTUAL_PIECE_BYTES
                v_end = ((start // vp) + 1) * vp - 1
                fast_end = min(self.file_size - 1, max(end, v_end))
        if is_sync or require_verified:
            self._unpause_stale_boundary_pieces(force=True)
        required_set = set(required_pieces)
        paused_boundary = getattr(self, "_paused_boundary_pieces", ())
        boundary_needs_pause = (
            first_required_piece is not None
            and first_required_piece not in paused_boundary
            and self._should_pause_boundary_piece(
                first_required_piece,
                is_sync=is_sync,
                require_verified=require_verified,
            )
        )
        should_schedule = (
            not all_ready
            or first_required_piece != getattr(self, "_last_scheduled_piece", None)
            or getattr(self, "_was_startup_bounded", False) != startup_bounded
            or is_sync
            or boundary_needs_pause
        )
        if should_schedule:
            self._last_scheduled_piece = first_required_piece
            self._was_startup_bounded = startup_bounded
            self._schedule_pieces(
                all_pieces,
                required_set,
                reason="range",
                is_sync=is_sync,
                sync_metadata=sync_metadata,
            )
            if not all_ready:
                self._start_fast_block_fetch(start, fast_end)
        if (
            all_ready
            and track_position
            and not is_sync
            and is_contiguous_followup
            and first_required_piece is not None
            and request_end is not None
            and request_end > v_end
            and start >= constants.STARTUP_VIRTUAL_PIECE_BYTES
            and self._boundary_piece_competes(first_required_piece)
        ):
            vp = constants.STARTUP_VIRTUAL_PIECE_BYTES
            next_v_start = v_end + 1
            next_v_end = min(
                request_end,
                self.file_piece_end(start),
                v_end + vp,
            )
            if (
                next_v_start <= next_v_end
                and next_v_end > getattr(self, "_fast_lookahead_until", -1)
            ):
                fast_lock = getattr(self, "_fast_block_lock", None)
                if fast_lock is None:
                    inflight = bool(getattr(self, "_fast_blocks_inflight", ()))
                else:
                    with fast_lock:
                        inflight = bool(getattr(self, "_fast_blocks_inflight", ()))
                if not inflight:
                    self._fast_lookahead_until = next_v_end
                    self._start_fast_block_fetch(next_v_start, next_v_end)

        tail_paused_pieces: dict[int, int] = {}
        tail_focused = (
            is_tail_probe
            and not all_ready
            and bool(required_pieces)
        )
        if tail_focused:
            required_tail_set = set(required_pieces)
            self._set_sequential_mode(False)
            with self._piece_priority_lock:
                for piece in list(getattr(self, "_boosted_pieces", set())):
                    if piece in required_tail_set or self._piece_have(piece):
                        continue
                    prev_prio = self._piece_priority(piece)
                    if prev_prio and prev_prio > 0:
                        tail_paused_pieces[piece] = prev_prio
                        try:
                            self._reset_piece_deadline(piece)
                            self.handle.piece_priority(piece, 0)
                        except Exception:
                            pass
                for index, piece in enumerate(required_pieces):
                    try:
                        if not self.handle.have_piece(piece):
                            self.handle.piece_priority(
                                piece,
                                constants.STREAM_PIECE_PRIORITY,
                            )
                            self._set_piece_deadline(piece, index * 25)
                    except Exception:
                        pass

        try:
            return self._wait_for_range_loop(
                start=start,
                end=end,
                fast_end=fast_end,
                deadline=deadline,
                handler=handler,
                connect_start=connect_start,
                track_position=track_position,
                is_sync=is_sync,
                sync_metadata=sync_metadata,
                playback_request_id=playback_request_id,
                require_verified=require_verified,
                required_pieces=required_pieces,
                required_set=required_set,
                first_required_piece=first_required_piece,
                prefetch_length=prefetch_length,
                is_tail_probe=is_tail_probe,
                startup_bounded=startup_bounded,
                focus_delay=focus_delay,
                kick_delay=kick_delay,
                reannounce_delay=reannounce_delay,
            )
        finally:
            if tail_focused:
                focus_piece = getattr(self, "_playback_focus_piece", None)
                with self._piece_priority_lock:
                    for piece, prev_prio in tail_paused_pieces.items():
                        if (
                            focus_piece is not None
                            and focus_piece > self._file_first_piece()
                            and piece < focus_piece
                        ):
                            continue
                        try:
                            if not self.handle.have_piece(piece):
                                self.handle.piece_priority(piece, prev_prio)
                                self._set_piece_deadline(piece, 0)
                        except Exception:
                            pass
                self._set_sequential_mode(
                    (getattr(self, "start_time", 0.0) or 0.0) <= 0.0
                    and focus_piece in (None, self._file_first_piece())
                    and not self._is_large_piece_torrent()
                )

    def _wait_for_range_loop(
        self,
        *,
        start: int,
        end: int,
        fast_end: int,
        deadline: Optional[float],
        handler: Optional[BaseHTTPRequestHandler],
        connect_start: float,
        track_position: bool,
        is_sync: bool,
        sync_metadata: Optional[dict[str, Any]],
        playback_request_id: Optional[int],
        require_verified: bool,
        required_pieces: list[int],
        required_set: Set[int],
        first_required_piece: Optional[int],
        prefetch_length: int,
        is_tail_probe: bool,
        startup_bounded: bool,
        focus_delay: float,
        kick_delay: float,
        reannounce_delay: float,
    ) -> bool:
        blocked_waits = 0
        blocked_replan_count = 0
        last_blocked_replan = 0.0
        last_kick = float("-inf")
        focus_claimed = False
        last_replan_schedule = 0.0
        last_replan_length = 0
        last_missing_signature = ""
        stalled_target_piece: Optional[int] = None
        stalled_target_blocks = 0
        stalled_since = time.monotonic()
        target_stall_logged = False
        large_piece = self._is_large_piece_torrent()
        head_aligned_required_blocks = (
            self._required_range_blocks(start, end)
            if (large_piece and not require_verified)
            else set()
        )
        while (
            (deadline is None or time.monotonic() < deadline)
            and not self.stop_event.is_set()
        ):
            wake = getattr(self, "_range_wake_event", None)
            if wake is not None:
                wake.clear()
            if handler and not is_client_connected(handler, connect_start):
                log_event(
                    "client disconnected during range wait",
                    sessionId=self.session_id,
                    start=start,
                    end=end,
                )
                self._restore_pending_kicks(
                    time.monotonic() + constants.TARGET_KICK_RESTORE_DELAY
                )
                return False
            if track_position and self._is_playback_request_superseded(
                playback_request_id,
            ):
                log_event(
                    "range wait superseded",
                    sessionId=self.session_id,
                    start=start,
                    end=end,
                    playbackRequestId=playback_request_id,
                    activePlaybackRequestId=getattr(
                        self,
                        "_active_playback_request_id",
                        0,
                    ),
                )
                self._restore_pending_kicks(
                    time.monotonic() + constants.TARGET_KICK_RESTORE_DELAY
                )
                return False
            try:
                missing_required = [
                    piece
                    for piece in required_pieces
                    if not self.handle.have_piece(piece)
                ]
            except RuntimeError:
                self._restore_pending_kicks(
                    time.monotonic() + constants.TARGET_KICK_RESTORE_DELAY
                )
                return False
            if (
                first_required_piece is not None
                and first_required_piece not in missing_required
            ):
                self._log_first_piece_ready(first_required_piece)
            partial_ready = (
                not require_verified
                and bool(missing_required)
                and self._range_blocks_are_finished(start, end)
            )
            if not missing_required or partial_ready:
                if stalled_target_piece is not None:
                    self._release_target_focus(stalled_target_piece)
                self._restore_pending_kicks(
                    time.monotonic() + constants.TARGET_KICK_RESTORE_DELAY
                )
                log_event(
                    "range ready",
                    sessionId=self.session_id,
                    start=start,
                    end=end,
                    requiredPieces=len(required_pieces),
                    trackPosition=track_position,
                    partialPiece=partial_ready,
                    timingPhase="range_ready",
                    elapsedMs=self.elapsed_ms(),
                    **(sync_metadata or {}),
                )
                if is_tail_probe and not getattr(
                    self, "_tail_probe_ready_logged", False
                ):
                    self._tail_probe_ready_logged = True
                    log_event(
                        "tail probe ready",
                        sessionId=self.session_id,
                        start=start,
                        end=end,
                        timingPhase="tail_probe_ready",
                        elapsedMs=self.elapsed_ms(),
                        **self._startup_progress_fields(),
                    )
                if (
                    track_position
                    and (getattr(self, "start_time", 0.0) or 0.0) > 0.0
                    and start >= self._startup_window_bytes()
                    and not getattr(self, "_resume_range_ready_logged", False)
                ):
                    self._resume_range_ready_logged = True
                    log_event(
                        "resume range ready",
                        sessionId=self.session_id,
                        start=start,
                        end=end,
                        timingPhase="resume_range_ready",
                        elapsedMs=self.elapsed_ms(),
                        **self._startup_progress_fields(),
                    )
                if is_sync and not getattr(
                    self, "_first_sync_bytes_ready_logged", False
                ):
                    self._first_sync_bytes_ready_logged = True
                    try:
                        status = self.handle.status()
                        downloaded_bytes = int(getattr(status, "total_done", 0))
                    except Exception:
                        downloaded_bytes = None
                    log_event(
                        "first sync bytes ready",
                        sessionId=self.session_id,
                        downloadedBytes=downloaded_bytes,
                        requiredPieces=len(required_pieces),
                        timingPhase="first_sync_bytes_ready",
                        elapsedMs=self.elapsed_ms(),
                        **(sync_metadata or {}),
                    )
                return True

            blocked_waits += 1
            if wake is not None:
                wake.wait(constants.RANGE_RETRY_INTERVAL)
            else:
                time.sleep(constants.RANGE_RETRY_INTERVAL)
            if self.stop_event.is_set() or (
                track_position
                and self._is_playback_request_superseded(playback_request_id)
            ):
                break

            now = time.monotonic()
            self._restore_pending_kicks(now)
            if now - last_blocked_replan >= constants.BLOCKED_REPLAN_INTERVAL:
                last_blocked_replan = now
                blocked_replan_count += 1
                target_piece = missing_required[0] if missing_required else None
                if (
                    target_piece is not None
                    and head_aligned_required_blocks
                    and not self._range_target_piece_has_prefix(
                        start,
                        end,
                        target_piece,
                    )
                    and any(p == target_piece for p, _ in head_aligned_required_blocks)
                ):
                    target_blocks_done = self._required_target_blocks_finished(
                        target_piece,
                        head_aligned_required_blocks,
                    )
                else:
                    target_blocks_done = self._target_piece_finished_blocks(
                        target_piece,
                    )
                target_blocks_delta = max(
                    0,
                    target_blocks_done - stalled_target_blocks,
                )
                stalled_target_blocks = target_blocks_done
                if target_piece != stalled_target_piece:
                    previous_target = stalled_target_piece
                    stalled_target_piece = target_piece
                    stalled_since = now
                    target_stall_logged = False
                    last_kick = float("-inf")
                    focus_claimed = False
                    if previous_target is not None:
                        self._release_target_focus(previous_target)
                elif target_blocks_delta > 0:
                    # Active progress on target piece: defer kick.
                    stalled_since = now
                    target_stall_logged = False
                target_availability = self._piece_availability(target_piece)
                target_have = self._piece_have(target_piece)
                stall_seconds = max(0.0, now - stalled_since)
                if (
                    target_piece is not None
                    and stall_seconds >= reannounce_delay
                ):
                    if not target_stall_logged:
                        status = self.handle.status()
                        log_event(
                            "target piece stalled",
                            sessionId=self.session_id,
                            targetPiece=target_piece,
                            targetPieceAvailability=target_availability,
                            targetPieceHave=target_have,
                            targetPiecePriority=self._piece_priority(
                                target_piece,
                            ),
                            targetPieceDeadlineMs=self._piece_deadline(
                                target_piece,
                            ),
                            peers=int(getattr(status, "num_peers", 0)),
                            downloadRate=int(
                                getattr(status, "download_rate", 0),
                            ),
                            blockedWaits=blocked_waits,
                            stallMs=int(stall_seconds * 1000),
                            timingPhase="target_piece_stalled",
                            elapsedMs=self.elapsed_ms(),
                        )
                        target_stall_logged = True
                    # Focus: after the target stalls long enough, demote
                    # every other priority-7 piece so the stuck piece owns
                    # the swarm's full bandwidth until it completes.
                    if (
                        stall_seconds >= focus_delay
                        and not focus_claimed
                    ):
                        focus_claimed = self._activate_target_focus(
                            target_piece,
                        )
                    # Endgame: cancel and re-request the stuck piece so its
                    # missing blocks are pulled from every peer, not just the
                    # slow one holding the in-flight request. The kick gate
                    # tracks the target piece only: a busy swarm tells us
                    # nothing about the required piece, which can be stuck
                    # with every peer requesting it from the same two slow
                    # seeds. cancel_non_critical keeps the piece's downloaded
                    # blocks and only re-picks its missing ones, so repeated
                    # kicks are safe while it remains stalled.
                    if (
                        target_availability is not None
                        and stall_seconds >= kick_delay
                        and now - last_kick
                        >= constants.TARGET_KICK_INTERVAL
                        and target_blocks_delta == 0
                        and not (
                            stall_seconds < 2.0
                            and int(getattr(status, "download_rate", 0) or 0) > 0
                            and self._target_piece_has_pending_requests(
                                target_piece,
                            )
                        )
                    ):
                        self._kick_target_piece(target_piece)
                        last_kick = now
                if is_tail_probe or startup_bounded:
                    replan_cap = prefetch_length
                elif large_piece:
                    replan_cap = max(1, end - start + 1)
                else:
                    replan_cap = (
                        max(
                            prefetch_length,
                            self._get_max_replan_prefetch_bytes(is_sync),
                        )
                    )
                expansion = min(
                    2 ** min(2, blocked_replan_count),
                    max(1, replan_cap // max(1, prefetch_length)),
                )
                replan_length = min(
                    replan_cap,
                    prefetch_length * expansion,
                )
                # Expand the read-ahead window as it grows, and re-assert the
                # window periodically, but do not reschedule on every tick.
                missing_signature = ",".join(
                    str(piece) for piece in missing_required
                )
                if (
                    replan_length != last_replan_length
                    or missing_signature != last_missing_signature
                    or now - last_replan_schedule
                    >= constants.BLOCKED_REPLAN_REASSERT_INTERVAL
                ):
                    last_replan_length = replan_length
                    last_missing_signature = missing_signature
                    last_replan_schedule = now
                    replanned_pieces = sorted(
                        self.map_pieces(start, replan_length),
                    )
                    self._schedule_pieces(
                        replanned_pieces,
                        required_set,
                        reason="blocked-replan",
                        is_sync=is_sync,
                        sync_metadata=sync_metadata,
                    )
                self._start_fast_block_fetch(start, fast_end)
                self._force_reannounce_if_stalled(
                    target_piece,
                    blocked_waits,
                    stall_seconds,
                )
        if stalled_target_piece is not None:
            self._release_target_focus(stalled_target_piece)
        self._restore_pending_kicks(
            time.monotonic() + constants.TARGET_KICK_RESTORE_DELAY
        )
        return not required_pieces

    def flush_piece_cache(self) -> None:
        try:
            if hasattr(self, "handle") and callable(getattr(self.handle, "flush_cache", None)):
                self.handle.flush_cache()
        except Exception:
            pass

    def read_range_chunk(
        self,
        stream: Any,
        start: int,
        end: int,
        timeout: Optional[float] = constants.RANGE_WAIT_TIMEOUT,
        handler: Optional[BaseHTTPRequestHandler] = None,
        connect_start: float = 0.0,
        track_position: bool = True,
        is_sync: bool = False,
        sync_metadata: Optional[dict[str, Any]] = None,
        playback_request_id: Optional[int] = None,
        request_end: Optional[int] = None,
    ) -> Optional[bytes]:
        end = min(end, self.file_piece_end(start))
        expected_length = end - start + 1
        deadline = (
            time.monotonic() + timeout
            if timeout is not None
            else None
        )
        retries_with_zeros = 0
        max_zero_retries = 10
        sparse_zero_block = b"\x00" * 16384

        while (
            (deadline is None or time.monotonic() < deadline)
            and not self.stop_event.is_set()
        ):
            if track_position and self._is_playback_request_superseded(
                playback_request_id,
            ):
                return None
            if handler and not is_client_connected(handler, connect_start):
                log_event(
                    "client disconnected during chunk read",
                    sessionId=self.session_id,
                    start=start,
                    end=end,
                )
                return None
            if not self.wait_for_range(
                start,
                end,
                timeout=timeout,
                handler=handler,
                connect_start=connect_start,
                track_position=track_position,
                is_sync=is_sync,
                sync_metadata=sync_metadata,
                playback_request_id=playback_request_id,
                request_end=request_end,
            ):
                return None

            fast_blocks = getattr(self, "_fast_blocks", None)
            cached = None
            if isinstance(fast_blocks, dict):
                required = self._required_range_blocks(start, end)
                with self._fast_block_lock:
                    cached = {key: fast_blocks[key] for key in required if key in fast_blocks}
                if not self._range_blocks_are_finished(start, end, set(cached)):
                    continue
            stream.seek(start)
            chunk = stream.read(expected_length)
            if len(chunk) == expected_length and cached:
                piece_length = int(self.info.piece_length())
                file_offset = int(self.info.files().file_offset(self.file_index))
                block_size = int(self.handle.status().block_size)
                merged = bytearray(chunk)
                try:
                    verified = {
                        piece for piece in {p for p, _ in cached}
                        if self.handle.have_piece(piece)
                    }
                except RuntimeError:
                    return None
                for (piece, block), data in cached.items():
                    if piece in verified:
                        continue
                    block_start = piece * piece_length + block * block_size - file_offset
                    first = max(start, block_start)
                    last = min(end + 1, block_start + len(data))
                    if first < last:
                        merged[first - start:last - start] = data[first - block_start:last - block_start]
                chunk = bytes(merged)
            if len(chunk) == expected_length:
                has_sparse_zeros = (
                    (sparse_zero_block in chunk)
                    if len(chunk) >= 16384
                    else (chunk == b"\x00" * len(chunk))
                )
                if has_sparse_zeros:
                    pieces = self.map_pieces(start, len(chunk))
                    verified = False
                    if pieces:
                        try:
                            verified = all(
                                self.handle.have_piece(piece)
                                for piece in pieces
                            )
                        except RuntimeError:
                            verified = False
                    if not verified:
                        if retries_with_zeros < max_zero_retries:
                            retries_with_zeros += 1
                            self.flush_piece_cache()
                            time.sleep(constants.RANGE_RETRY_INTERVAL)
                            continue
                        remaining_timeout = (
                            max(0.1, deadline - time.monotonic())
                            if deadline is not None
                            else timeout
                        )
                        if not self.wait_for_range(
                            start,
                            end,
                            timeout=remaining_timeout,
                            handler=handler,
                            connect_start=connect_start,
                            track_position=track_position,
                            is_sync=is_sync,
                            sync_metadata=sync_metadata,
                            playback_request_id=playback_request_id,
                            require_verified=True,
                        ):
                            return None
                        continue

                return chunk

            # libtorrent can finish a piece before the file descriptor sees
            # the complete range. Retry instead of sending a short 206 body.
            time.sleep(constants.RANGE_RETRY_INTERVAL)

        return None

    def serve(
        self,
        handler: BaseHTTPRequestHandler,
        head_only: bool,
        is_sync: bool = False,
        sync_metadata: Optional[dict[str, Any]] = None,
    ) -> None:
        # mpv cancels the current range connection while seeking. Keep each
        # response single-use so FFmpeg does not reuse a half-read HTTP body.
        handler.close_connection = True
        connect_start = time.monotonic()
        request_number = getattr(self, "request_count", 0) + 1
        self.request_count = request_number
        if not self.first_request_logged:
            self.first_request_logged = True
            log_event(
                "first HTTP request",
                sessionId=self.session_id,
                method=handler.command,
                range=handler.headers.get("Range"),
                timingPhase="first_http_request",
                elapsedMs=self.elapsed_ms(),
                **(sync_metadata or {}),
            )
        else:
            log_event(
                "HTTP request",
                sessionId=self.session_id,
                request=request_number,
                method=handler.command,
                range=handler.headers.get("Range"),
                timingPhase="http_request",
                elapsedMs=self.elapsed_ms(),
                **(sync_metadata or {}),
            )
        while (
            not self.metadata_ready.is_set()
            and not self.metadata_complete.is_set()
            and not self.stop_event.is_set()
        ):
            if not is_client_connected(handler, connect_start):
                return
            self.metadata_complete.wait(0.5)
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
            start = 0
            end = max(0, total - 1)
            status_code = 200
        else:
            start, end, status_code = byte_range[0], byte_range[1], 206
            start, end = cap_open_ended_range(range_header, (start, end))

        track_position = (
            not is_sync
            and not self.is_initial_tail_probe(
                start,
                total,
                request_number,
            )
        )
        if not track_position:
            log_event(
                "initial tail probe",
                sessionId=self.session_id,
                request=request_number,
                start=start,
                end=end,
                elapsedMs=self.elapsed_ms(),
            )

        self.focus_file()

        try:
            absolute_path = self.selected_file_path()
        except ValueError:
            handler.send_error(500, "Invalid torrent file path")
            return

        content_type = (
            mimetypes.guess_type(absolute_path)[0]
            or "application/octet-stream"
        )
        length = max(0, end - start + 1)
        playback_request_id: Optional[int] = None
        if not head_only and length > 0 and track_position:
            with self._piece_priority_lock:
                next_id = getattr(self, "_active_playback_request_id", 0) + 1
                self._active_playback_request_id = next_id
                playback_request_id = next_id

        stream = None
        first_chunk: Optional[bytes] = None
        defer_first_chunk = not head_only and length > 0
        if not head_only and length > 0 and track_position:
            # Give the current piece a short chance to arrive before headers,
            # then keep the HTTP response alive while the body waits.
            stream, first_chunk = self.open_first_chunk(
                absolute_path,
                start,
                end,
                handler=handler,
                connect_start=connect_start,
                track_position=track_position,
                timeout=constants.INITIAL_RANGE_HEADER_WAIT_TIMEOUT,
                is_sync=is_sync,
                sync_metadata=sync_metadata,
                playback_request_id=playback_request_id,
            )
            defer_first_chunk = stream is None or first_chunk is None

        handler.send_response(status_code)
        handler.send_header("Accept-Ranges", "bytes")
        handler.send_header("Content-Type", content_type)
        handler.send_header("Content-Length", str(length))
        handler.send_header("Connection", "close")
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
            trackPosition=track_position,
            timingPhase="headers_sent",
            elapsedMs=self.elapsed_ms(),
        )

        if head_only or length == 0:
            return

        if defer_first_chunk:
            # Acknowledge the range before waiting on a missing piece. This
            # keeps libmpv's HTTP load alive during peer discovery and filling.
            stream, first_chunk = self.open_first_chunk(
                absolute_path,
                start,
                end,
                handler=handler,
                connect_start=connect_start,
                track_position=track_position,
                timeout=constants.FIRST_RANGE_WAIT_TIMEOUT,
                is_sync=is_sync,
                sync_metadata=sync_metadata,
                playback_request_id=playback_request_id,
            )
            if stream is None or first_chunk is None:
                log_event(
                    "range unavailable after headers",
                    sessionId=self.session_id,
                    request=request_number,
                    start=start,
                    end=end,
                )
                return

        try:
            offset = start
            chunk = first_chunk
            first_bytes_sent = False
            while offset <= end:
                if track_position and self._is_playback_request_superseded(
                    playback_request_id,
                ):
                    handler.close_connection = True
                    return
                if chunk is None:
                    chunk_size = (
                        constants.INITIAL_STREAM_BYTES
                        if track_position
                        and self._is_large_piece_torrent()
                        and self._is_startup_window_active(offset)
                        else constants.STREAM_CHUNK_SIZE
                    )
                    chunk_end = min(
                        end,
                        offset + chunk_size - 1,
                        self.file_piece_end(offset),
                    )
                    chunk = self.read_range_chunk(
                        stream,
                        offset,
                        chunk_end,
                        handler=handler,
                        connect_start=connect_start,
                        track_position=track_position,
                        is_sync=is_sync,
                        sync_metadata=sync_metadata,
                        playback_request_id=playback_request_id,
                        request_end=end,
                    )
                    if chunk is None:
                        handler.close_connection = True
                        return

                handler.wfile.write(chunk)
                handler.wfile.flush()
                if not first_bytes_sent:
                    first_bytes_sent = True
                    log_event(
                        "first bytes sent",
                        sessionId=self.session_id,
                        request=request_number,
                        start=start,
                        bytesSent=len(chunk),
                        timingPhase="first_bytes_sent",
                        elapsedMs=self.elapsed_ms(),
                        **self._startup_progress_fields(),
                    )
                if track_position:
                    self.mark_stream_playable()
                    with self._piece_priority_lock:
                        self._has_streamed_bytes = True
                        self._last_stream_start = offset
                        window_bytes = self._startup_window_bytes()
                        if (
                            (getattr(self, "start_time", 0.0) or 0.0) <= 0.0
                            or offset >= window_bytes
                        ):
                            prev_streamed = int(
                                getattr(self, "_playhead_streamed_bytes", 0)
                                or 0
                            )
                            new_streamed = prev_streamed + len(chunk)
                            self._playhead_streamed_bytes = new_streamed
                            if (
                                prev_streamed < window_bytes <= new_streamed
                                and not getattr(
                                    self,
                                    "_startup_window_completed_logged",
                                    False,
                                )
                            ):
                                self._startup_window_completed_logged = True
                                log_event(
                                    "startup window complete",
                                    sessionId=self.session_id,
                                    request=request_number,
                                    offset=offset + len(chunk),
                                    timingPhase="startup_window_complete",
                                    elapsedMs=self.elapsed_ms(),
                                    **self._startup_progress_fields(),
                                )
                offset += len(chunk)
                chunk = None
            log_event(
                "HTTP response complete",
                sessionId=self.session_id,
                request=request_number,
                start=start,
                end=end,
                bytesSent=offset - start,
                trackPosition=track_position,
                timingPhase="response_complete",
                elapsedMs=self.elapsed_ms(),
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
        handler: Optional[BaseHTTPRequestHandler] = None,
        connect_start: float = 0.0,
        track_position: bool = True,
        timeout: Optional[float] = constants.FIRST_RANGE_WAIT_TIMEOUT,
        is_sync: bool = False,
        sync_metadata: Optional[dict[str, Any]] = None,
        playback_request_id: Optional[int] = None,
    ) -> Tuple[Optional[Any], Optional[bytes]]:
        """Wait for libtorrent to create and fill the first requested bytes."""
        if track_position and self._is_playback_request_superseded(
            playback_request_id,
        ):
            return None, None
        chunk_end = min(
            end,
            start + (
                constants.INITIAL_STREAM_BYTES
                if track_position and not is_sync
                else constants.STREAM_CHUNK_SIZE
            ) - 1,
            self.file_piece_end(start),
        )
        if (
            getattr(self, "info", None) is not None
            and getattr(self, "file_index", None) is not None
        ):
            # The sparse file may not exist until libtorrent writes its first
            # block. Schedule the playhead before waiting for that file.
            first_piece = min(self.map_pieces(start, 1), default=None)
            if first_piece is not None and track_position:
                self._focus_playback_piece(first_piece)
            self.prioritize_range(
                start,
                max(1, chunk_end - start + 1),
                reason="first-chunk" if track_position else "tail-chunk",
                is_sync=is_sync,
                sync_metadata=sync_metadata,
            )
        deadline = (
            time.monotonic() + timeout
            if timeout is not None
            else None
        )
        if connect_start == 0.0:
            connect_start = time.monotonic()

        while (
            (deadline is None or time.monotonic() < deadline)
            and not self.stop_event.is_set()
        ):
            if track_position and self._is_playback_request_superseded(
                playback_request_id,
            ):
                return None, None
            if handler and not is_client_connected(handler, connect_start):
                log_event(
                    "client disconnected before first chunk",
                    sessionId=self.session_id,
                    start=start,
                    end=end,
                )
                return None, None
            try:
                stream = open(absolute_path, "rb", buffering=0)
            except FileNotFoundError:
                remaining = (
                    None
                    if deadline is None
                    else max(0.0, deadline - time.monotonic())
                )
                if remaining is not None and remaining <= 0:
                    return None, None
                time.sleep(
                    min(constants.FILE_OPEN_RETRY_INTERVAL, remaining)
                    if remaining is not None
                    else constants.FILE_OPEN_RETRY_INTERVAL
                )
                continue
            except OSError:
                return None, None

            remaining = (
                None
                if deadline is None
                else max(0.01, deadline - time.monotonic())
            )
            chunk = self.read_range_chunk(
                stream,
                start,
                chunk_end,
                # The first HTTP pass has its own short header deadline.
                # `RANGE_WAIT_TIMEOUT=None` only means the body may keep
                # waiting after headers; it must not disable this deadline.
                timeout=remaining,
                handler=handler,
                connect_start=connect_start,
                track_position=track_position,
                is_sync=is_sync,
                sync_metadata=sync_metadata,
                playback_request_id=playback_request_id,
            )
            if chunk is not None:
                return stream, chunk

            stream.close()
            if self.stop_event.is_set():
                break
            remaining = (
                None
                if deadline is None
                else max(0.0, deadline - time.monotonic())
            )
            if remaining is not None and remaining <= 0:
                break
            time.sleep(
                min(constants.FILE_OPEN_RETRY_INTERVAL, remaining)
                if remaining is not None
                else constants.FILE_OPEN_RETRY_INTERVAL
            )

        return None, None
