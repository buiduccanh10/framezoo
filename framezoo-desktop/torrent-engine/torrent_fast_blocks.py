from __future__ import annotations

import ast
import socket
import struct
from typing import Dict, Iterable, Optional, Set, Tuple

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


def _recv_exact(stream: socket.socket, length: int) -> bytes:
    data = bytearray()
    while len(data) < length:
        chunk = stream.recv(length - len(data))
        if not chunk:
            raise ConnectionError("peer closed connection")
        data.extend(chunk)
    return bytes(data)


def _recv_message(stream: socket.socket) -> Tuple[Optional[int], bytes]:
    length = struct.unpack(">I", _recv_exact(stream, 4))[0]
    if length == 0:
        return None, b""
    if length > _MAX_MESSAGE_BYTES:
        raise ValueError("peer message is too large")
    payload = _recv_exact(stream, length)
    return payload[0], payload[1:]


def _send_block_requests(
    stream: socket.socket,
    blocks: Iterable[Block],
    piece_length: int,
    block_size: int,
    total_size: int,
) -> Dict[Block, int]:
    requested: Dict[Block, int] = {}
    for piece, block in blocks:
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


def fetch_blocks_from_peer(
    endpoint: Endpoint,
    info_hash: bytes,
    peer_id: bytes,
    blocks: Set[Block],
    piece_length: int,
    block_size: int,
    total_size: int,
    timeout: float = 2.0,
) -> Dict[Block, bytes]:
    if not blocks:
        return {}
    if len(info_hash) != 20 or len(peer_id) != 20:
        raise ValueError("invalid BitTorrent handshake identifiers")

    received: Dict[Block, bytes] = {}
    with socket.create_connection(endpoint, timeout=timeout) as stream:
        stream.settimeout(timeout)
        stream.sendall(
            bytes([len(_PROTOCOL)])
            + _PROTOCOL
            + b"\x00" * 8
            + info_hash
            + peer_id,
        )
        handshake = _recv_exact(stream, 68)
        if (
            handshake[0] != len(_PROTOCOL)
            or handshake[1:20] != _PROTOCOL
            or handshake[28:48] != info_hash
        ):
            raise ConnectionError("peer handshake mismatch")

        stream.sendall(_INTERESTED)
        unchoked = False
        while not unchoked:
            message_id, payload = _recv_message(stream)
            if message_id == 0:
                raise ConnectionError("peer choked fast block request")
            if message_id == 1:
                unchoked = True
            elif message_id == 16:
                raise ConnectionError("peer rejected fast block request")

        requested = _send_block_requests(
            stream,
            blocks,
            piece_length,
            block_size,
            total_size,
        )
        pending = set(requested)
        while pending:
            message_id, payload = _recv_message(stream)
            if message_id is None:
                continue
            if message_id == 0:
                raise ConnectionError("peer choked during fast block request")
            if message_id == 16:
                raise ConnectionError("peer rejected fast block request")
            if message_id != 7 or len(payload) < 8:
                continue

            piece, begin = struct.unpack(">II", payload[:8])
            block = (piece, begin // block_size)
            if block not in pending:
                continue
            data = payload[8:]
            if len(data) != requested[block]:
                raise ValueError("peer returned an unexpected block length")
            received[block] = data
            pending.remove(block)
    return received


def fetch_blocks_from_peers(
    endpoints: Iterable[Endpoint],
    info_hash: bytes,
    peer_id: bytes,
    blocks: Set[Block],
    piece_length: int,
    block_size: int,
    total_size: int,
    timeout: float = 2.0,
) -> Dict[Block, bytes]:
    remaining = set(blocks)
    received: Dict[Block, bytes] = {}
    for endpoint in endpoints:
        if not remaining:
            break
        try:
            fetched = fetch_blocks_from_peer(
                endpoint,
                info_hash,
                peer_id,
                remaining,
                piece_length,
                block_size,
                total_size,
                timeout=timeout,
            )
        except (ConnectionError, OSError, TimeoutError, ValueError):
            continue
        received.update(fetched)
        remaining.difference_update(fetched)
    return received
