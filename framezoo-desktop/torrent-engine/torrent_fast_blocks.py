from __future__ import annotations

import ast
import os
import select
import socket
import struct
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Callable, Dict, Iterable, Optional, Set, Tuple

Block = Tuple[int, int]
Endpoint = Tuple[str, int]

_PROTOCOL = b"BitTorrent protocol"
_MAX_MESSAGE_BYTES = 2 * 1024 * 1024
_INTERESTED = b"\x00\x00\x00\x01\x02"


def normalize_endpoint(value: object) -> Optional[Endpoint]:
    if isinstance(value, (tuple, list)) and len(value) >= 2:
        try:
            return str(value[0]), int(value[1])
        except (TypeError, ValueError):
            return None
    if not isinstance(value, str):
        return None
    try:
        parsed = ast.literal_eval(value)
    except (SyntaxError, ValueError):
        parsed = None
    if isinstance(parsed, (tuple, list)) and len(parsed) >= 2:
        try:
            return str(parsed[0]), int(parsed[1])
        except (TypeError, ValueError):
            return None
    host, separator, port = value.rpartition(":")
    if not separator:
        return None
    try:
        return host.strip("[]"), int(port)
    except ValueError:
        return None


def _recv_exact(stream: socket.socket, length: int, deadline: float) -> bytes:
    data = bytearray()
    while len(data) < length:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("peer probe timed out")
        stream.settimeout(remaining)
        chunk = stream.recv(length - len(data))
        if not chunk:
            raise ConnectionError("peer closed connection")
        data.extend(chunk)
    return bytes(data)


def _recv_message(stream: socket.socket, deadline: float) -> Tuple[Optional[int], bytes]:
    length = struct.unpack(">I", _recv_exact(stream, 4, deadline))[0]
    if length == 0:
        return None, b""
    if length > _MAX_MESSAGE_BYTES:
        raise ValueError("peer message is too large")
    payload = _recv_exact(stream, length, deadline)
    return payload[0], payload[1:]


def _send_block_requests(
    stream: socket.socket,
    blocks: Iterable[Block],
    piece_length: int,
    block_size: int,
    total_size: int,
    reverse_tail: bool = False,
) -> Dict[Block, int]:
    requested: Dict[Block, int] = {}
    ordered = sorted(blocks)
    if reverse_tail and len(ordered) >= 8:
        ordered = ordered[:4] + list(reversed(ordered[4:]))
    for piece, block in ordered:
        global_offset = piece * piece_length + block * block_size
        length = min(block_size, total_size - global_offset)
        if length <= 0:
            continue
        stream.sendall(
            struct.pack(
                ">IBIII",
                13,
                6,
                piece,
                block * block_size,
                length,
            ),
        )
        requested[(piece, block)] = length
    return requested


class PeerWireConnection:
    """Reusable TCP BitTorrent peer wire state for fast-block fetches."""

    def __init__(self, endpoint: Endpoint) -> None:
        self.endpoint = endpoint
        self.lock = threading.Lock()
        self.stream: Optional[socket.socket] = None
        self.unchoked = False
        self.allowed_fast: Set[int] = set()
        self.pieces: Set[int] = set()
        self.known_bitfield = False

    def might_have_blocks(self, blocks: Set[Block]) -> bool:
        if not self.known_bitfield:
            return True
        return all(piece in self.pieces for piece, _ in blocks)

    def close(self) -> None:
        stream = self.stream
        self.stream = None
        self.unchoked = False
        self.allowed_fast.clear()
        self.pieces.clear()
        self.known_bitfield = False
        if stream is not None:
            try:
                stream.close()
            except OSError:
                pass


def close_peer_connections(
    peer_sockets: Optional[Dict[Endpoint, PeerWireConnection]],
    peer_sockets_lock: Optional[threading.Lock] = None,
) -> None:
    if not peer_sockets:
        return
    if peer_sockets_lock is not None:
        with peer_sockets_lock:
            connections = list(peer_sockets.values())
            peer_sockets.clear()
    else:
        connections = list(peer_sockets.values())
        peer_sockets.clear()
    for conn in connections:
        conn.close()


def _connection_peer_id(peer_id: bytes) -> bytes:
    prefix = peer_id[:8] if len(peer_id) >= 8 else b"-FZFB01-"
    return (prefix + os.urandom(20))[:20]


def _apply_piece_availability_message(
    conn: PeerWireConnection,
    message_id: Optional[int],
    payload: bytes,
) -> None:
    if message_id == 4 and len(payload) >= 4:
        conn.pieces.add(struct.unpack(">I", payload[:4])[0])
    elif message_id == 14:
        conn.known_bitfield = False
        conn.pieces.clear()
    elif message_id == 15:
        conn.known_bitfield = True
        conn.pieces.clear()
    elif message_id == 5:
        conn.known_bitfield = True
        for byte_index, byte in enumerate(payload):
            if not byte:
                continue
            base = byte_index * 8
            for bit in range(8):
                if byte & (0x80 >> bit):
                    conn.pieces.add(base + bit)


def _open_peer_connection(
    conn: PeerWireConnection,
    info_hash: bytes,
    peer_id: bytes,
    timeout: float,
    deadline: float,
) -> bool:
    remaining = max(0.05, min(timeout, deadline - time.monotonic()))
    stream = socket.create_connection(conn.endpoint, timeout=remaining)
    conn.stream = stream
    stream.settimeout(remaining)
    try:
        stream.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    except OSError:
        pass
    stream.sendall(
        bytes([len(_PROTOCOL)])
        + _PROTOCOL
        + b"\x00" * 8
        + info_hash
        + peer_id
        + _INTERESTED,
    )
    try:
        handshake = _recv_exact(stream, 68, deadline)
    except (ConnectionError, OSError, TimeoutError):
        conn.close()
        return False
    if (
        handshake[0] != len(_PROTOCOL)
        or handshake[1:20] != _PROTOCOL
        or handshake[28:48] != info_hash
    ):
        conn.close()
        raise ConnectionError("peer handshake mismatch")
    return True


def _drain_pending_control_messages(conn: PeerWireConnection) -> bool:
    """Drain queued peer control frames before sending requests on a warm socket."""
    stream = conn.stream
    if stream is None:
        return False
    for _ in range(32):
        try:
            readable, _, _ = select.select([stream], [], [], 0.0)
        except (OSError, ValueError):
            conn.close()
            return False
        if not readable:
            return True
        try:
            message_id, payload = _recv_message(stream, time.monotonic() + 0.05)
        except (ConnectionError, OSError, TimeoutError, ValueError):
            conn.close()
            return False
        if message_id == 0:
            conn.unchoked = False
        elif message_id == 1:
            conn.unchoked = True
        elif message_id == 17 and len(payload) >= 4:
            conn.allowed_fast.add(struct.unpack(">I", payload[:4])[0])
        elif message_id in (4, 5, 14, 15):
            _apply_piece_availability_message(conn, message_id, payload)
    return True


def _fetch_from_connection(
    conn: PeerWireConnection,
    info_hash: bytes,
    peer_id: bytes,
    blocks: Set[Block],
    piece_length: int,
    block_size: int,
    total_size: int,
    timeout: float,
    on_block: Optional[Callable[[Block, bytes], None]],
    should_stop: Optional[Callable[[], bool]],
    final_callbacks: Optional[list[tuple[Block, bytes]]] = None,
    reverse_tail: bool = False,
    on_unchoked: Optional[Callable[[PeerWireConnection], None]] = None,
) -> tuple[Dict[Block, bytes], bool]:
    received: Dict[Block, bytes] = {}
    initially_unchoked = bool(conn.stream is not None and conn.unchoked)
    deadline = time.monotonic() + (
        min(timeout, 1.2) if (initially_unchoked and timeout >= 0.5) else timeout
    )
    extend_window = min(max(timeout, 0.8), 1.2)
    stop_draining = False

    if conn.stream is not None and not _drain_pending_control_messages(conn):
        conn.close()

    if conn.stream is None:
        if should_stop and should_stop():
            return received, False
        deadline = time.monotonic() + timeout
        if not _open_peer_connection(conn, info_hash, peer_id, timeout, deadline):
            return received, False

    stream = conn.stream
    assert stream is not None

    if initially_unchoked and not conn.might_have_blocks(blocks):
        return received, bool(conn.unchoked or conn.allowed_fast)

    requested: Dict[Block, int] = {}
    pending = set(blocks)
    outstanding: Set[Block] = set()

    def request_blocks(candidates: Set[Block]) -> None:
        selected = candidates & pending
        if not selected:
            return
        sent = _send_block_requests(
            stream,
            selected,
            piece_length,
            block_size,
            total_size,
            reverse_tail=reverse_tail,
        )
        requested.update(sent)
        pending.difference_update(sent)
        outstanding.update(sent)

    if conn.unchoked:
        request_blocks(set(pending))
    elif conn.allowed_fast:
        request_blocks(
            {block for block in pending if block[0] in conn.allowed_fast},
        )

    while not conn.unchoked and (pending or outstanding):
        if should_stop and should_stop():
            return received, False
        try:
            message_id, payload = _recv_message(stream, deadline)
        except (ConnectionError, OSError, TimeoutError):
            return received, False
        if message_id == 0:
            conn.unchoked = False
            if not outstanding:
                raise ConnectionError("peer choked fast block request")
            return received, False
        if message_id == 1:
            conn.unchoked = True
            if on_unchoked is not None:
                on_unchoked(conn)
            if timeout >= 0.5:
                deadline = max(deadline, time.monotonic() + extend_window)
            request_blocks(set(pending))
        elif message_id == 17 and len(payload) >= 4:
            allowed_piece = struct.unpack(">I", payload[:4])[0]
            conn.allowed_fast.add(allowed_piece)
            if timeout >= 0.5:
                deadline = max(deadline, time.monotonic() + extend_window)
            request_blocks(
                {block for block in pending if block[0] == allowed_piece},
            )
        elif message_id == 16:
            return received, False
        elif message_id in (4, 5, 14, 15):
            _apply_piece_availability_message(conn, message_id, payload)
        elif message_id == 7 and len(payload) >= 8:
            piece, begin = struct.unpack(">II", payload[:8])
            block = (piece, begin // block_size)
            if begin % block_size == 0 and block in outstanding:
                data = payload[8:]
                if len(data) != requested[block]:
                    raise ValueError("peer returned an unexpected block length")
                received[block] = data
                outstanding.remove(block)
                if timeout >= 0.5:
                    deadline = max(deadline, time.monotonic() + extend_window)
                if not pending and not outstanding and final_callbacks is not None:
                    final_callbacks.append((block, data))
                elif on_block:
                    on_block(block, data)

    while outstanding:
        if should_stop and should_stop():
            if (
                not stop_draining
                and conn.unchoked
                and len(outstanding) <= 4
                and timeout >= 0.5
            ):
                stop_draining = True
                deadline = min(deadline, time.monotonic() + 0.08)
            elif not stop_draining:
                return received, False
        try:
            message_id, payload = _recv_message(stream, deadline)
        except (ConnectionError, OSError, TimeoutError):
            # Keep blocks received before a stale peer closes. The next
            # probe round will request only the missing blocks.
            return received, False
        if message_id is None:
            continue
        if message_id == 0:
            conn.unchoked = False
            return received, False
        if message_id == 1:
            conn.unchoked = True
            continue
        if message_id == 16:
            return received, False
        if message_id == 17 and len(payload) >= 4:
            conn.allowed_fast.add(struct.unpack(">I", payload[:4])[0])
            continue
        if message_id in (4, 5, 14, 15):
            _apply_piece_availability_message(conn, message_id, payload)
            continue
        if message_id != 7 or len(payload) < 8:
            continue

        piece, begin = struct.unpack(">II", payload[:8])
        block = (piece, begin // block_size)
        if begin % block_size or block not in outstanding:
            continue
        data = payload[8:]
        if len(data) != requested[block]:
            raise ValueError("peer returned an unexpected block length")
        received[block] = data
        outstanding.remove(block)
        if timeout >= 0.5 and not stop_draining:
            deadline = max(deadline, time.monotonic() + extend_window)
        if not pending and not outstanding and final_callbacks is not None:
            final_callbacks.append((block, data))
        elif on_block:
            on_block(block, data)

    keep_open = (
        bool(received)
        and not outstanding
        and conn.stream is not None
        and (conn.unchoked or bool(conn.allowed_fast))
    )
    return received, keep_open


def fetch_blocks_from_peer(
    endpoint: Endpoint,
    info_hash: bytes,
    peer_id: bytes,
    blocks: Set[Block],
    piece_length: int,
    block_size: int,
    total_size: int,
    timeout: float = 2.0,
    on_block: Optional[Callable[[Block, bytes], None]] = None,
    should_stop: Optional[Callable[[], bool]] = None,
    peer_sockets: Optional[Dict[Endpoint, PeerWireConnection]] = None,
    peer_sockets_lock: Optional[threading.Lock] = None,
    reverse_tail: bool = False,
) -> Dict[Block, bytes]:
    if not blocks:
        return {}
    if len(info_hash) != 20 or len(peer_id) != 20:
        raise ValueError("invalid BitTorrent handshake identifiers")

    if peer_sockets is None or peer_sockets_lock is None:
        conn = PeerWireConnection(endpoint)
        try:
            received, _ = _fetch_from_connection(
                conn,
                info_hash,
                peer_id,
                blocks,
                piece_length,
                block_size,
                total_size,
                timeout,
                on_block,
                should_stop,
            )
            return received
        finally:
            conn.close()

    with peer_sockets_lock:
        pooled = peer_sockets.get(endpoint)
    acquired_pooled = False
    if pooled is not None and not (should_stop and should_stop()):
        lock_wait = min(0.18, max(0.0, timeout * 0.25))
        acquired_pooled = (
            pooled.lock.acquire(timeout=lock_wait)
            if lock_wait > 0
            else pooled.lock.acquire(blocking=False)
        )
    if acquired_pooled:
        conn = pooled
        owns_lock = True
    else:
        conn = PeerWireConnection(endpoint)
        conn.lock.acquire()
        owns_lock = True

    def publish_connection(active_conn: PeerWireConnection) -> None:
        if active_conn.stream is None:
            return
        old_conn = None
        with peer_sockets_lock:
            existing = peer_sockets.get(endpoint)
            if existing is not None and existing is not active_conn:
                old_conn = existing
            peer_sockets[endpoint] = active_conn
        if old_conn is not None:
            old_conn.close()

    final_callbacks: list[tuple[Block, bytes]] = []
    keep_open = False
    try:
        received, keep_open = _fetch_from_connection(
            conn,
            info_hash,
            peer_id,
            blocks,
            piece_length,
            block_size,
            total_size,
            timeout,
            on_block,
            should_stop,
            final_callbacks if on_block is not None else None,
            reverse_tail=reverse_tail,
            on_unchoked=publish_connection,
        )
        return received
    finally:
        if keep_open:
            publish_connection(conn)
        else:
            conn.close()
            with peer_sockets_lock:
                if peer_sockets.get(endpoint) is conn:
                    peer_sockets.pop(endpoint, None)
        if owns_lock:
            conn.lock.release()
        if on_block is not None and final_callbacks:
            for block, data in final_callbacks:
                on_block(block, data)


def fetch_blocks_from_peers(
    endpoints: Iterable[Endpoint],
    info_hash: bytes,
    peer_id: bytes,
    blocks: Set[Block],
    piece_length: int,
    block_size: int,
    total_size: int,
    timeout: float = 2.0,
    on_block: Optional[Callable[[Block, bytes], None]] = None,
    on_peer_success: Optional[Callable[[Endpoint], None]] = None,
    on_peer_failure: Optional[Callable[[Endpoint], None]] = None,
    peer_sockets: Optional[Dict[Endpoint, PeerWireConnection]] = None,
    peer_sockets_lock: Optional[threading.Lock] = None,
    should_stop: Optional[Callable[[], bool]] = None,
) -> Dict[Block, bytes]:
    remaining = set(blocks)
    received: Dict[Block, bytes] = {}
    candidates = list(dict.fromkeys(endpoints))
    if not candidates or not remaining:
        return received

    progress_lock = threading.Lock()
    satisfied: Set[Block] = set()
    succeeded: Set[Endpoint] = set()

    def all_satisfied() -> bool:
        if should_stop is not None and should_stop():
            return True
        with progress_lock:
            return len(satisfied) >= len(blocks)

    def make_endpoint_callback(ep: Endpoint) -> Callable[[Block, bytes], None]:
        def _callback(block: Block, data: bytes) -> None:
            with progress_lock:
                satisfied.add(block)
                first_success = ep not in succeeded
                if first_success:
                    succeeded.add(ep)
            if first_success and on_peer_success:
                on_peer_success(ep)
            if on_block:
                on_block(block, data)

        return _callback

    def run_probe_wave(
        wave_candidates: list[Endpoint],
        wave_timeout: float,
        split_blocks: bool,
    ) -> bool:
        if not wave_candidates or not remaining or (should_stop and should_stop()):
            return False
        batches: Dict[Endpoint, Set[Block]] = {
            endpoint: set() for endpoint in wave_candidates
        }
        if not split_blocks or len(remaining) < len(wave_candidates):
            for endpoint in wave_candidates:
                batches[endpoint] = set(remaining)
        else:
            for index, block in enumerate(sorted(remaining)):
                batches[wave_candidates[index % len(wave_candidates)]].add(block)

        wave_received = False
        executor = ThreadPoolExecutor(max_workers=min(32, len(wave_candidates)))
        futures = {
            executor.submit(
                fetch_blocks_from_peer,
                endpoint,
                info_hash,
                _connection_peer_id(peer_id),
                batches[endpoint],
                piece_length,
                block_size,
                total_size,
                wave_timeout,
                make_endpoint_callback(endpoint),
                should_stop=all_satisfied,
                peer_sockets=peer_sockets,
                peer_sockets_lock=peer_sockets_lock,
                reverse_tail=(not split_blocks and idx % 2 == 1 and len(remaining) >= 8),
            ): endpoint
            for idx, endpoint in enumerate(wave_candidates)
            if batches[endpoint]
        }
        try:
            for future in as_completed(futures):
                if should_stop is not None and should_stop():
                    break
                endpoint = futures[future]
                try:
                    fetched = future.result()
                except (ConnectionError, OSError, TimeoutError, ValueError):
                    with progress_lock:
                        incomplete = len(satisfied) < len(blocks)
                    if endpoint not in succeeded and incomplete and on_peer_failure:
                        on_peer_failure(endpoint)
                    continue
                if fetched:
                    wave_received = True
                    with progress_lock:
                        satisfied.update(fetched)
                        first_success = endpoint not in succeeded
                        if first_success:
                            succeeded.add(endpoint)
                    if first_success and on_peer_success:
                        on_peer_success(endpoint)
                else:
                    with progress_lock:
                        incomplete = len(satisfied) < len(blocks)
                    if endpoint not in succeeded and incomplete and on_peer_failure:
                        on_peer_failure(endpoint)
                received.update(fetched)
                remaining.difference_update(fetched)
                if not remaining:
                    break
        finally:
            executor.shutdown(wait=False, cancel_futures=True)
        return wave_received

    warm_candidates: list[Endpoint] = []
    skip_known_missing: Set[Endpoint] = set()
    warm_probed: list[Endpoint] = []
    if peer_sockets is not None and peer_sockets_lock is not None:
        with peer_sockets_lock:
            for endpoint in candidates:
                conn = peer_sockets.get(endpoint)
                if conn is None or conn.stream is None:
                    continue
                if not conn.might_have_blocks(remaining):
                    skip_known_missing.add(endpoint)
                    continue
                if conn.unchoked:
                    warm_candidates.append(endpoint)
        if warm_candidates:
            warm_probed = warm_candidates[:2]
            run_probe_wave(
                warm_probed,
                min(timeout, 1.2),
                split_blocks=(len(warm_probed) > 1 and len(remaining) >= 8),
            )
            if remaining and not (should_stop and should_stop()):
                warm_succeeded = [ep for ep in warm_probed if ep in succeeded]
                if warm_succeeded:
                    run_probe_wave(
                        warm_succeeded,
                        min(timeout, 1.2),
                        split_blocks=False,
                    )
            if not remaining or (should_stop and should_stop()):
                return received

    cold_candidates = (
        [
            ep
            for ep in candidates
            if ep not in warm_probed and ep not in skip_known_missing
        ]
        if (warm_probed or skip_known_missing)
        else candidates
    )
    if not cold_candidates:
        return received

    # Tracker responses contain stale peers. Probe them concurrently so one
    # dead endpoint cannot delay a live peer behind it.
    for attempt in range(2):
        if not remaining or (should_stop and should_stop()):
            break
        attempt_candidates = (
            list(succeeded) if attempt == 1 and succeeded else cold_candidates
        )
        wave_received = run_probe_wave(
            attempt_candidates,
            timeout,
            split_blocks=(attempt == 1),
        )
        if attempt == 0 and not wave_received:
            break
    return received
