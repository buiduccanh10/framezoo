from __future__ import annotations

import math
import mimetypes
import os
import shutil
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
    ) -> None:
        self.engine = engine
        self.session_id = session_id
        self.request = request
        self.handle = handle
        self.save_path = save_path
        self.persistent_cache = persistent_cache
        self.cache_key = get_torrent_cache_key(request)
        self._resume_lock = threading.Lock()
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
        self._metadata_lock = threading.Lock()
        self.session_started_at = time.monotonic()
        self.first_request_logged = False
        self.request_count = 0
        self.last_range_key: Optional[Tuple[int, int]] = None
        self._piece_priority_lock = threading.RLock()
        self._boosted_pieces: Set[int] = set()
        self._piece_priorities: dict[int, int] = {}
        self._piece_deadlines: dict[int, int] = {}
        self._focused_file_index: Optional[int] = None
        self._has_streamed_bytes = False
        self._last_stream_start: Optional[int] = None
        self._first_peer_logged = False
        self._first_download_logged = False
        self._first_piece_prioritized_logged = False
        self._first_piece_ready_logged = False
        self._reannounce_lock = threading.Lock()
        self._last_reannounce = 0.0
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

    def start(self) -> None:
        self.raw_stream_url = self.engine.http_server.register(self)
        self.stream_type = "file"
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
            if self.metadata_ready.is_set():
                return
            status = self.handle.status()
            if status.has_metadata:
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
                    priorities = [0] * self.info.files().num_files()
                    priorities[
                        self.file_index
                    ] = constants.STREAM_IDLE_FILE_PRIORITY
                    self.handle.prioritize_files(priorities)
                    # Piece priorities and deadlines drive playback; global
                    # sequential mode would start from piece 0 instead of
                    # the selected file's playhead.
                    self.handle.set_sequential_download(False)
                    if self.persistent_cache:
                        self.persist_metadata()
                    self.metadata_ready.set()
                    log_event(
                        "metadata ready",
                        sessionId=self.session_id,
                        fileName=self.file_path.rsplit("/", 1)[-1],
                        fileSize=self.file_size,
                        timingPhase="metadata_ready",
                        elapsedMs=self.elapsed_ms(),
                    )
                    self.prime_startup_ranges()
                return
            time.sleep(0.2)
        if self.stop_event.is_set():
            return
        raise TimeoutError("timed out waiting for torrent metadata")

    def session_payload(self) -> dict[str, Any]:
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

    def persist_metadata(self) -> None:
        if not self.cache_key or self.info is None:
            return
        torrent_path = os.path.join(self.save_path, self.cache_key + ".torrent")
        if os.path.exists(torrent_path):
            return
        try:
            entry = lt.create_torrent(self.info).generate()
            with open(torrent_path, "wb") as f:
                f.write(lt.bencode(entry))
            log_event(
                "metadata persisted",
                sessionId=self.session_id,
                torrentPath=torrent_path,
            )
        except Exception as error:
            sys.stderr.write(f"[sidecar] Failed to persist torrent metadata: {error}\n")

    def save_resume_data_sync(self) -> bool:
        if not self.persistent_cache:
            return False
        with self._resume_lock:
            try:
                entry = self.handle.write_resume_data()
                data = lt.bencode(entry)
                with open(
                    os.path.join(self.save_path, "resume.dat"),
                    "wb",
                ) as f:
                    f.write(data)
                return True
            except Exception as error:
                sys.stderr.write(f"[sidecar] Failed to save resume data: {error}\n")
                return False

    def stop(self) -> None:
        self.stop_event.set()
        self.engine.http_server.unregister(self.session_id)
        log_event("session stopped", sessionId=self.session_id)
        if not self._torrent_cleaned:
            if self.persistent_cache:
                self.save_resume_data_sync()
            try:
                self.engine.session.remove_torrent(self.handle)
            except Exception:
                pass
            if self.persistent_cache:
                try:
                    os.utime(self.save_path, None)
                except OSError:
                    pass
            else:
                shutil.rmtree(self.save_path, ignore_errors=True)
            self._torrent_cleaned = True

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

    def _observe_status_milestones(self, status: Any) -> None:
        peers = int(getattr(status, "num_peers", 0))
        download_rate = int(getattr(status, "download_rate", 0))
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
                and self.metadata_ready.is_set()
            ):
                resume_saves = 0
                self.save_resume_data_sync()

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
    ) -> None:
        pieces = sorted(self.map_pieces(start, length))
        self._schedule_pieces(pieces, set(pieces), reason)

    def prime_startup_ranges(self) -> None:
        """Schedule head and tail pieces before libmpv issues HTTP probes."""
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
            head_pieces = sorted(
                self.map_pieces(
                    0,
                    max(1, piece_length * constants.STARTUP_WINDOW_PIECES),
                ),
            )[: constants.STARTUP_WINDOW_PIECES]
            tail_start = max(
                0,
                self.file_size - constants.TAIL_PREFETCH_BYTES,
            )
            tail_pieces = [
                piece
                for piece in sorted(
                    self.map_pieces(
                        tail_start,
                        constants.TAIL_PREFETCH_BYTES,
                    ),
                )
                if piece not in head_pieces
            ]

            if head_pieces:
                self._schedule_pieces(
                    head_pieces,
                    set(head_pieces),
                    reason="startup-prefetch",
                )
            if tail_pieces:
                self._schedule_pieces(
                    tail_pieces,
                    set(tail_pieces),
                    reason="startup-prefetch",
                )

            log_event(
                "startup prefetch",
                sessionId=self.session_id,
                headPieces=head_pieces,
                tailPieces=tail_pieces,
                tailStart=tail_start,
                timingPhase="startup_prefetch",
                elapsedMs=self.elapsed_ms(),
            )
        except Exception as error:
            log_event(
                "startup prefetch failed",
                sessionId=self.session_id,
                error=str(error),
            )

    def focus_file(self) -> None:
        if self.info is None or self.file_index is None:
            return
        with self._piece_priority_lock:
            if getattr(self, "_focused_file_index", None) == self.file_index:
                return
        try:
            priorities = [0] * self.info.files().num_files()
            priorities[self.file_index] = constants.STREAM_IDLE_FILE_PRIORITY
            self.handle.prioritize_files(priorities)
            self.handle.set_sequential_download(False)
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
            if (
                self._has_streamed_bytes
                and previous is not None
                and abs(start - previous) > constants.RANGE_PREFETCH_BYTES
            ):
                should_refocus = True
            self._last_stream_start = start
        if should_refocus:
            self.refocus_piece_window()

    def is_initial_tail_probe(
        self,
        start: int,
        total: int,
        request_number: int,
    ) -> bool:
        """Ignore mpv's early EOF probe when tracking the playback cursor."""
        if request_number > constants.INITIAL_TAIL_PROBE_MAX_REQUESTS:
            return False
        if total <= constants.RANGE_PREFETCH_BYTES * 2:
            return False
        tail_start = max(0, total - constants.RANGE_PREFETCH_BYTES)
        return start > constants.RANGE_PREFETCH_BYTES and start >= tail_start

    def range_is_ready(self, start: int, end: int) -> bool:
        pieces = self.map_pieces(start, end - start + 1)
        if not pieces:
            return False
        try:
            return all(self.handle.have_piece(piece) for piece in pieces)
        except RuntimeError:
            return False

    def _schedule_pieces(
        self,
        prefetch_pieces: list[int],
        required_pieces: Set[int],
        reason: str,
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
        first_piece_was_prioritized = False
        with self._piece_priority_lock:
            for index, piece in enumerate(prefetch_pieces):
                try:
                    if self.handle.have_piece(piece):
                        continue
                except RuntimeError:
                    return

                if piece in required_set:
                    priority = constants.STREAM_PIECE_PRIORITY
                    distance = (
                        0
                        if first_required_piece is None
                        else max(0, piece - first_required_piece)
                    )
                    deadline_ms = distance * 25
                elif index < constants.STARTUP_WINDOW_PIECES:
                    priority = constants.STREAM_HOT_PIECE_PRIORITY
                    deadline_ms = (
                        constants.PREFETCH_DEADLINE_BASE_MS
                        + index * constants.PREFETCH_DEADLINE_STEP_MS
                    )
                else:
                    priority = constants.STREAM_WARM_PIECE_PRIORITY
                    deadline_ms = (
                        constants.PREFETCH_DEADLINE_BASE_MS
                        + index * constants.PREFETCH_DEADLINE_STEP_MS
                    )
                try:
                    self.handle.piece_priority(piece, priority)
                    self._set_piece_deadline(piece, max(0, deadline_ms))
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
                    missing_pieces += 1
                except Exception:
                    continue

        log_event(
            "range prioritized",
            sessionId=self.session_id,
            reason=reason,
            pieces=len(prefetch_pieces),
            requiredPieces=len(required_pieces),
            missingPieces=missing_pieces,
            timingPhase=(
                "first_chunk_prioritized"
                if reason == "first-chunk"
                else None
            ),
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

    def _reassert_target_piece(self, target_piece: Optional[int]) -> None:
        if target_piece is None or self._piece_have(target_piece):
            return

        with self._piece_priority_lock:
            try:
                self.handle.piece_priority(
                    target_piece,
                    constants.STREAM_PIECE_PRIORITY,
                )
                reset_deadline = getattr(
                    self.handle,
                    "reset_piece_deadline",
                    None,
                )
                if callable(reset_deadline):
                    reset_deadline(target_piece)
                self._set_piece_deadline(target_piece, 0)
                self._boosted_pieces.add(target_piece)
                self._piece_priorities = getattr(
                    self,
                    "_piece_priorities",
                    {},
                )
                self._piece_priorities[target_piece] = (
                    constants.STREAM_PIECE_PRIORITY
                )
            except Exception:
                return

        log_event(
            "target piece escalated",
            sessionId=self.session_id,
            targetPiece=target_piece,
            targetPieceAvailability=self._piece_availability(target_piece),
            targetPieceHave=False,
            targetPiecePriority=self._piece_priority(target_piece),
            targetPieceDeadlineMs=self._piece_deadline(target_piece),
            timingPhase="target_piece_escalated",
            elapsedMs=self.elapsed_ms(),
        )

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

    def wait_for_range(
        self,
        start: int,
        end: int,
        timeout: float = constants.RANGE_WAIT_TIMEOUT,
        handler: Optional[BaseHTTPRequestHandler] = None,
        connect_start: float = 0.0,
        track_position: bool = True,
    ) -> bool:
        prefetch_length = max(
            end - start + 1,
            constants.RANGE_PREFETCH_BYTES,
        )
        required_pieces = sorted(self.map_pieces(start, end - start + 1))
        all_pieces = sorted(self.map_pieces(start, prefetch_length))
        range_key = (start, end)
        first_required_piece = min(required_pieces) if required_pieces else None
        last_required_piece = max(required_pieces) if required_pieces else None
        if getattr(self, "last_range_key", None) != range_key:
            self.last_range_key = range_key
            total_done_bytes = None
            file_progress_bytes = None
            download_rate = None
            try:
                status = self.handle.status()
                total_done_bytes = int(getattr(status, "total_done", 0))
                download_rate = int(getattr(status, "download_rate", 0))
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
                trackPosition=track_position,
                elapsedMs=self.elapsed_ms(),
            )

        deadline = time.monotonic() + timeout

        if track_position:
            self.maybe_refocus(start)
        required_set = set(required_pieces)
        self._schedule_pieces(all_pieces, required_set, reason="range")

        blocked_waits = 0
        blocked_replan_count = 0
        last_blocked_replan = 0.0
        stalled_target_piece: Optional[int] = None
        stalled_since = time.monotonic()
        target_stall_logged = False
        while time.monotonic() < deadline and not self.stop_event.is_set():
            if handler and not is_client_connected(handler, connect_start):
                log_event(
                    "client disconnected during range wait",
                    sessionId=self.session_id,
                    start=start,
                    end=end,
                )
                return False
            try:
                missing_required = [
                    piece
                    for piece in required_pieces
                    if not self.handle.have_piece(piece)
                ]
            except RuntimeError:
                return False
            if (
                first_required_piece is not None
                and first_required_piece not in missing_required
            ):
                self._log_first_piece_ready(first_required_piece)
            if not missing_required:
                log_event(
                    "range ready",
                    sessionId=self.session_id,
                    start=start,
                    end=end,
                    requiredPieces=len(required_pieces),
                    trackPosition=track_position,
                    timingPhase="range_ready",
                    elapsedMs=self.elapsed_ms(),
                )
                return True

            blocked_waits += 1
            time.sleep(constants.RANGE_RETRY_INTERVAL)
            if self.stop_event.is_set():
                break

            now = time.monotonic()
            if now - last_blocked_replan >= constants.BLOCKED_REPLAN_INTERVAL:
                last_blocked_replan = now
                blocked_replan_count += 1
                target_piece = missing_required[0] if missing_required else None
                if target_piece != stalled_target_piece:
                    stalled_target_piece = target_piece
                    stalled_since = now
                    target_stall_logged = False
                target_availability = self._piece_availability(target_piece)
                target_have = self._piece_have(target_piece)
                stall_seconds = max(0.0, now - stalled_since)
                if (
                    target_piece is not None
                    and stall_seconds
                    >= constants.TARGET_STALL_REANNOUNCE_DELAY
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
                    self._reassert_target_piece(target_piece)
                expansion = min(
                    2 ** min(2, blocked_replan_count),
                    constants.MAX_REPLAN_PREFETCH_BYTES
                    // max(1, prefetch_length),
                )
                replan_length = min(
                    constants.MAX_REPLAN_PREFETCH_BYTES,
                    prefetch_length * expansion,
                )
                replanned_pieces = sorted(
                    self.map_pieces(start, replan_length),
                )
                self._schedule_pieces(
                    replanned_pieces,
                    required_set,
                    reason="blocked-replan",
                )
                self._force_reannounce_if_stalled(
                    target_piece,
                    blocked_waits,
                    stall_seconds,
                )
        return not required_pieces

    def read_range_chunk(
        self,
        stream: Any,
        start: int,
        end: int,
        timeout: float = constants.RANGE_WAIT_TIMEOUT,
        handler: Optional[BaseHTTPRequestHandler] = None,
        connect_start: float = 0.0,
        track_position: bool = True,
    ) -> Optional[bytes]:
        end = min(end, self.file_piece_end(start))
        expected_length = end - start + 1
        deadline = time.monotonic() + timeout

        while time.monotonic() < deadline and not self.stop_event.is_set():
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
            ):
                return None

            stream.seek(start)
            chunk = stream.read(expected_length)
            if len(chunk) == expected_length:
                return chunk

            # libtorrent can finish a piece before the file descriptor sees
            # the complete range. Retry instead of sending a short 206 body.
            time.sleep(constants.RANGE_RETRY_INTERVAL)

        return None

    def serve(self, handler: BaseHTTPRequestHandler, head_only: bool) -> None:
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
            )
        if not self.metadata_ready.is_set():
            self.metadata_complete.wait(constants.METADATA_WAIT_TIMEOUT)
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

        track_position = not self.is_initial_tail_probe(
            start,
            total,
            request_number,
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
                if chunk is None:
                    chunk_end = min(
                        end,
                        offset + constants.STREAM_CHUNK_SIZE - 1,
                        self.file_piece_end(offset),
                    )
                    chunk = self.read_range_chunk(
                        stream,
                        offset,
                        chunk_end,
                        handler=handler,
                        connect_start=connect_start,
                        track_position=track_position,
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
                    )
                if track_position:
                    with self._piece_priority_lock:
                        self._has_streamed_bytes = True
                        self._last_stream_start = offset
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
        timeout: float = constants.FIRST_RANGE_WAIT_TIMEOUT,
    ) -> Tuple[Optional[Any], Optional[bytes]]:
        """Wait for libtorrent to create and fill the first requested bytes."""
        chunk_end = min(
            end,
            start + constants.STREAM_CHUNK_SIZE - 1,
            self.file_piece_end(start),
        )
        if (
            track_position
            and self.info is not None
            and self.file_index is not None
        ):
            # The sparse file may not exist until libtorrent writes its first
            # block. Schedule the playhead before waiting for that file.
            self.prioritize_range(
                start,
                max(1, chunk_end - start + 1),
                reason="first-chunk",
            )
        deadline = time.monotonic() + timeout
        if connect_start == 0.0:
            connect_start = time.monotonic()

        while time.monotonic() < deadline and not self.stop_event.is_set():
            if handler and not is_client_connected(handler, connect_start):
                log_event(
                    "client disconnected before first chunk",
                    sessionId=self.session_id,
                    start=start,
                    end=end,
                )
                return None, None
            try:
                stream = open(absolute_path, "rb")
            except FileNotFoundError:
                time.sleep(constants.FILE_OPEN_RETRY_INTERVAL)
                continue
            except OSError:
                return None, None

            remaining = max(0.01, deadline - time.monotonic())
            chunk = self.read_range_chunk(
                stream,
                start,
                chunk_end,
                timeout=min(constants.RANGE_WAIT_TIMEOUT, remaining),
                handler=handler,
                connect_start=connect_start,
                track_position=track_position,
            )
            if chunk is not None:
                return stream, chunk

            stream.close()
            if self.stop_event.is_set():
                break
            time.sleep(constants.FILE_OPEN_RETRY_INTERVAL)

        return None, None
