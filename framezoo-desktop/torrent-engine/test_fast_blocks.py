import socket
import struct
import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from torrent_fast_blocks import (
    fetch_blocks_from_peer,
    fetch_blocks_from_peers,
    normalize_endpoint,
)


class FastBlockProtocolTest(unittest.TestCase):
    def test_fast_probe_keeps_discovered_peers_when_connected_list_is_full(self):
        from torrent_runtime import TorrentRuntime

        runtime = object.__new__(TorrentRuntime)
        runtime.handle = SimpleNamespace(
            get_peer_info=lambda: [
                SimpleNamespace(ip=("192.0.2.1", port), pieces=[False])
                for port in range(8)
            ],
        )
        runtime.record = SimpleNamespace(
            discovery=SimpleNamespace(
                discovered_peers={("198.51.100.20", 6881)},
            ),
        )

        endpoints = runtime._fast_peer_endpoints({0})

        self.assertIn(("198.51.100.20", 6881), endpoints)
        self.assertEqual(len(endpoints), 9)

    def test_normalizes_libtorrent_endpoint_shapes(self):
        self.assertEqual(
            normalize_endpoint(("127.0.0.1", 6881)),
            ("127.0.0.1", 6881),
        )
        self.assertEqual(
            normalize_endpoint("('127.0.0.1', 6881)"),
            ("127.0.0.1", 6881),
        )
        self.assertEqual(normalize_endpoint("invalid"), None)

    def test_fast_probe_rotates_discovered_peers(self):
        from torrent_runtime import TorrentRuntime

        runtime = object.__new__(TorrentRuntime)
        runtime.handle = SimpleNamespace(get_peer_info=lambda: [])
        runtime.record = SimpleNamespace(discovery=SimpleNamespace(
            discovered_peers={("192.0.2.1", port) for port in range(1, 33)},
        ))
        first = set(runtime._fast_peer_endpoints({0}))
        second = set(runtime._fast_peer_endpoints({0}))
        self.assertEqual(len(first), 16)
        self.assertEqual(len(second), 16)
        self.assertFalse(first & second)

    def test_fetches_requested_blocks_from_tcp_peer(self):
        info_hash = b"01234567890123456789"
        peer_id = b"-FZTEST-" + b"012345678901"
        piece_length = 256 * 1024
        block_size = 16 * 1024
        blocks = {(0, i) for i in range(16)}
        payloads = {(0, i): bytes([i + 1]) * block_size for i in range(16)}
        requests = []
        ready = threading.Event()
        stop = threading.Event()
        server = socket.socket()
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        port = server.getsockname()[1]

        def serve_peer():
            try:
                ready.set()
                connection, _ = server.accept()
                with connection:
                    connection.settimeout(5)
                    handshake = self._recv_exact(connection, 68)
                    self.assertEqual(handshake[28:48], info_hash)
                    connection.sendall(
                        bytes([19])
                        + b"BitTorrent protocol"
                        + b"\x00" * 8
                        + info_hash
                        + b"-FZSEED-" + b"012345678901",
                    )
                    self.assertEqual(self._recv_exact(connection, 5), b"\x00\x00\x00\x01\x02")
                    connection.sendall(b"\x00\x00\x00\x01\x01")
                    while len(requests) < len(blocks):
                        length = struct.unpack(
                            ">I",
                            self._recv_exact(connection, 4),
                        )[0]
                        request = self._recv_exact(connection, length)
                        self.assertEqual(request[0], 6)
                        piece, begin, size = struct.unpack(
                            ">III",
                            request[1:13],
                        )
                        requests.append((piece, begin // block_size, size))
                    for piece, block, size in requests:
                        data = payloads[(piece, block)][:size]
                        connection.sendall(
                            struct.pack(
                                ">IBII",
                                9 + len(data),
                                7,
                                piece,
                                block * block_size,
                            )
                            + data,
                        )
            finally:
                stop.set()

        thread = threading.Thread(target=serve_peer, daemon=True)
        thread.start()
        self.assertTrue(ready.wait(2))
        try:
            result = fetch_blocks_from_peer(
                ("127.0.0.1", port),
                info_hash,
                peer_id,
                blocks,
                piece_length,
                block_size,
                piece_length,
            )
        finally:
            server.close()
            thread.join(timeout=2)
        self.assertEqual(result, payloads)
        self.assertEqual([block for _, block, _ in requests], list(range(16)))

    def test_fetch_keeps_blocks_before_peer_closes(self):
        info_hash = b"01234567890123456789"
        peer_id = b"-FZTEST-" + b"012345678901"
        piece_length = 64 * 1024
        block_size = 16 * 1024
        blocks = {(0, 0), (0, 1)}
        ready = threading.Event()
        client, server = socket.socketpair()

        def serve_partial():
            try:
                ready.set()
                server.settimeout(2)
                handshake = self._recv_exact(server, 68)
                server.sendall(
                    bytes([19])
                    + b"BitTorrent protocol"
                    + b"\x00" * 8
                    + handshake[28:48]
                    + b"-FZSEED-" + b"012345678901",
                )
                self.assertEqual(self._recv_exact(server, 5), b"\x00\x00\x00\x01\x02")
                server.sendall(b"\x00\x00\x00\x01\x01")
                for _ in blocks:
                    length = struct.unpack(">I", self._recv_exact(server, 4))[0]
                    self._recv_exact(server, length)
                data = b"a" * block_size
                server.sendall(
                    struct.pack(">IBII", 9 + len(data), 7, 0, 0) + data,
                )
            finally:
                server.close()

        thread = threading.Thread(target=serve_partial, daemon=True)
        thread.start()
        self.assertTrue(ready.wait(2))
        try:
            with patch("torrent_fast_blocks.socket.create_connection", return_value=client):
                result = fetch_blocks_from_peer(
                    ("127.0.0.1", 1),
                    info_hash,
                    peer_id,
                    blocks,
                    piece_length,
                    block_size,
                    piece_length,
                )
        finally:
            client.close()
            thread.join(timeout=2)

        self.assertEqual(result, {(0, 0): b"a" * block_size})

    def test_fetch_uses_allowed_fast_piece_before_unchoke(self):
        info_hash = b"01234567890123456789"
        peer_id = b"-FZTEST-" + b"012345678901"
        block_size = 16 * 1024
        client, server = socket.socketpair()
        data = b"a" * block_size
        release = threading.Event()

        def serve_allowed_fast():
            try:
                server.settimeout(2)
                handshake = self._recv_exact(server, 73)
                self.assertEqual(handshake[68:], b"\x00\x00\x00\x01\x02")
                server.sendall(
                    bytes([19])
                    + b"BitTorrent protocol"
                    + b"\x00" * 8
                    + info_hash
                    + b"-FZSEED-" + b"012345678901"
                    + struct.pack(">IBI", 5, 17, 0),
                )
                length = struct.unpack(">I", self._recv_exact(server, 4))[0]
                request = self._recv_exact(server, length)
                self.assertEqual(request[0], 6)
                self.assertEqual(struct.unpack(">III", request[1:13]), (0, 0, block_size))
                server.sendall(
                    struct.pack(">IBII", 9 + len(data), 7, 0, 0) + data
                )
                release.wait(1)
            finally:
                server.close()

        thread = threading.Thread(target=serve_allowed_fast, daemon=True)
        thread.start()
        started = time.monotonic()
        try:
            with patch("torrent_fast_blocks.socket.create_connection", return_value=client):
                result = fetch_blocks_from_peer(
                    ("127.0.0.1", 1),
                    info_hash,
                    peer_id,
                    {(0, 0)},
                    64 * 1024,
                    block_size,
                    64 * 1024,
                )
        finally:
            release.set()
            client.close()
            thread.join(timeout=2)

        self.assertEqual(result, {(0, 0): data})
        self.assertLess(time.monotonic() - started, 0.5)

    def test_keeps_received_blocks_when_peer_chokes_or_rejects(self):
        info_hash = b"01234567890123456789"
        block_size = 16384
        for message_id, allowed_fast in ((0, False), (0, True), (16, False), (16, True)):
            with self.subTest(message_id=message_id, allowed_fast=allowed_fast):
                client, server = socket.socketpair()

                def serve_partial():
                    try:
                        server.settimeout(2)
                        self._recv_exact(server, 73)
                        announcement = (
                            struct.pack(">IBI", 5, 17, 0)
                            if allowed_fast else b"\x00\x00\x00\x01\x01"
                        )
                        server.sendall(
                            bytes([19]) + b"BitTorrent protocol" + b"\x00" * 8
                            + info_hash + b"-FZSEED-" + b"012345678901"
                            + announcement
                        )
                        for _ in range(2):
                            length = struct.unpack(">I", self._recv_exact(server, 4))[0]
                            self._recv_exact(server, length)
                        rejection = (
                            struct.pack(">IB", 1, 0) if message_id == 0 else
                            struct.pack(">IBIII", 13, 16, 0, block_size, block_size)
                        )
                        server.sendall(
                            struct.pack(">IBII", 9 + block_size, 7, 0, 0)
                            + b"a" * block_size + rejection
                        )
                    finally:
                        server.close()

                thread = threading.Thread(target=serve_partial, daemon=True)
                thread.start()
                try:
                    with patch("torrent_fast_blocks.socket.create_connection", return_value=client):
                        result = fetch_blocks_from_peer(
                            ("127.0.0.1", 1), info_hash,
                            b"-FZTEST-" + b"012345678901",
                            {(0, 0), (0, 1)}, 65536, block_size, 65536,
                        )
                finally:
                    client.close()
                    thread.join(timeout=2)
                self.assertEqual(result, {(0, 0): b"a" * block_size})

    def test_reports_a_block_before_the_rest_of_the_batch_arrives(self):
        info_hash = b"01234567890123456789"
        client, server = socket.socketpair()
        ready, release = threading.Event(), threading.Event()
        received = []

        def serve():
            try:
                server.settimeout(2)
                self._recv_exact(server, 73)
                server.sendall(
                    bytes([19]) + b"BitTorrent protocol" + b"\x00" * 8
                    + info_hash + b"-FZSEED-" + b"012345678901"
                    + b"\x00\x00\x00\x01\x01"
                )
                for _ in range(2):
                    length = struct.unpack(">I", self._recv_exact(server, 4))[0]
                    self._recv_exact(server, length)
                server.sendall(struct.pack(">IBII", 9 + 16384, 7, 0, 0) + b"a" * 16384)
                release.wait(1)
            finally:
                server.close()

        server_thread = threading.Thread(target=serve, daemon=True)
        server_thread.start()
        with patch("torrent_fast_blocks.socket.create_connection", return_value=client):
            worker = threading.Thread(target=fetch_blocks_from_peer, args=(
                ("127.0.0.1", 1), info_hash, b"-FZTEST-" + b"012345678901",
                {(0, 0), (0, 1)}, 65536, 16384, 65536,
            ), kwargs={"on_block": lambda block, data: (received.append((block, data)), ready.set())})
            worker.start()
            try:
                self.assertTrue(ready.wait(1))
                self.assertTrue(worker.is_alive())
                self.assertEqual(received, [((0, 0), b"a" * 16384)])
            finally:
                release.set()
                worker.join(2)
                server_thread.join(2)

    def test_keepalives_do_not_extend_probe_deadline(self):
        info_hash = b"01234567890123456789"
        client, server = socket.socketpair()
        stop = threading.Event()

        def keepalive_peer():
            try:
                self._recv_exact(server, 73)
                server.sendall(
                    bytes([19]) + b"BitTorrent protocol" + b"\x00" * 8
                    + info_hash + b"-FZSEED-" + b"012345678901",
                )
                while not stop.wait(0.01):
                    server.sendall(b"\x00\x00\x00\x00")
            except OSError:
                pass
            finally:
                server.close()

        thread = threading.Thread(target=keepalive_peer, daemon=True)
        thread.start()
        started = time.monotonic()
        try:
            with patch("torrent_fast_blocks.socket.create_connection", return_value=client):
                result = fetch_blocks_from_peer(
                    ("127.0.0.1", 1), info_hash, b"-FZTEST-" + b"012345678901",
                    {(0, 0)}, 65536, 16384, 65536, timeout=0.15,
                )
        finally:
            stop.set()
            client.close()
            thread.join(timeout=2)
        self.assertEqual(result, {})
        self.assertLess(time.monotonic() - started, 0.5)

    def test_ignores_unaligned_block_before_valid_response(self):
        info_hash = b"01234567890123456789"
        peer_id = b"-FZTEST-" + b"012345678901"
        block_size = 16384
        for allowed_fast in (False, True):
            with self.subTest(allowed_fast=allowed_fast):
                client, server = socket.socketpair()

                def serve_peer():
                    try:
                        server.settimeout(2)
                        self._recv_exact(server, 73)
                        handshake = (
                            bytes([19]) + b"BitTorrent protocol" + b"\x00" * 8
                            + info_hash + b"-FZSEED-" + b"012345678901"
                        )
                        announcement = (
                            struct.pack(">IBI", 5, 17, 0)
                            if allowed_fast else b"\x00\x00\x00\x01\x01"
                        )
                        server.sendall(handshake + announcement)
                        length = struct.unpack(">I", self._recv_exact(server, 4))[0]
                        self._recv_exact(server, length)
                        for begin, byte in ((1, b"x"), (0, b"a")):
                            server.sendall(
                                struct.pack(">IBII", 9 + block_size, 7, 0, begin)
                                + byte * block_size
                            )
                    except OSError:
                        pass
                    finally:
                        server.close()

                thread = threading.Thread(target=serve_peer, daemon=True)
                thread.start()
                try:
                    with patch("torrent_fast_blocks.socket.create_connection", return_value=client):
                        result = fetch_blocks_from_peer(
                            ("127.0.0.1", 1), info_hash, peer_id,
                            {(0, 0)}, 65536, block_size, 65536,
                        )
                finally:
                    client.close()
                    thread.join(timeout=2)
                self.assertEqual(result, {(0, 0): b"a" * block_size})

    def test_peer_probe_does_not_wait_for_stale_endpoint(self):
        blocks = {(0, 0)}
        expected = {(0, 0): b"ok"}

        def fake_fetch(endpoint, *_args, **_kwargs):
            if endpoint[1] == 1:
                time.sleep(0.3)
                return {}
            return expected

        started = time.monotonic()
        with patch("torrent_fast_blocks.fetch_blocks_from_peer", fake_fetch):
            result = fetch_blocks_from_peers(
                [("192.0.2.1", 1), ("192.0.2.2", 2)],
                b"01234567890123456789",
                b"-FZTEST-" + b"012345678901",
                blocks,
                64 * 1024,
                16 * 1024,
                64 * 1024,
                timeout=1,
            )

        self.assertEqual(result, expected)
        self.assertLess(time.monotonic() - started, 0.2)

    def test_peer_probe_fans_out_startup_blocks(self):
        blocks = {(0, index) for index in range(4)}
        calls = []

        def fake_fetch(endpoint, _info_hash, _peer_id, assigned, *_args, **_kwargs):
            calls.append((endpoint, set(assigned)))
            return {block: bytes([block[1]]) for block in assigned}

        with patch("torrent_fast_blocks.fetch_blocks_from_peer", fake_fetch):
            result = fetch_blocks_from_peers(
                [("192.0.2.1", 1), ("192.0.2.2", 2)],
                b"01234567890123456789",
                b"-FZTEST-" + b"012345678901",
                blocks,
                64 * 1024,
                16 * 1024,
                64 * 1024,
            )

        self.assertEqual(result, {block: bytes([block[1]]) for block in blocks})
        self.assertTrue(calls)
        self.assertEqual(len(calls[0][1]), 4)

    def test_peer_probe_uses_unique_peer_ids_and_prioritizes_working_peers(self):
        from torrent_runtime import TorrentRuntime

        seen_peer_ids = []
        succeeded = []
        blocks = {(0, 0)}

        def fake_fetch(endpoint, _info_hash, peer_id, *_args, on_block=None, **_kwargs):
            seen_peer_ids.append(peer_id)
            if endpoint[1] == 2:
                data = b"ok"
                if on_block:
                    on_block((0, 0), data)
                return {(0, 0): data}
            return {}

        with patch("torrent_fast_blocks.fetch_blocks_from_peer", fake_fetch):
            result = fetch_blocks_from_peers(
                [("192.0.2.1", 1), ("192.0.2.2", 2)],
                b"01234567890123456789",
                b"-FZFB01-" + b"0" * 12,
                blocks,
                64 * 1024,
                16 * 1024,
                64 * 1024,
                on_peer_success=succeeded.append,
            )

        self.assertEqual(result, {(0, 0): b"ok"})
        self.assertEqual(len(seen_peer_ids), 2)
        self.assertEqual(len(set(seen_peer_ids)), 2)
        self.assertEqual(succeeded, [("192.0.2.2", 2)])

        runtime = object.__new__(TorrentRuntime)
        runtime._fast_block_lock = threading.Lock()
        runtime._working_fast_peers = []
        runtime._failed_fast_peers = {}
        runtime.engine = SimpleNamespace(listen_address="192.168.1.5", listen_port=49161)
        runtime.handle = SimpleNamespace(get_peer_info=lambda: [])
        runtime.record = SimpleNamespace(
            discovery=SimpleNamespace(
                discovered_peers={
                    ("192.168.1.5", 49161),
                    ("192.0.2.1", 1),
                    ("192.0.2.2", 2),
                    ("192.0.2.3", 3),
                },
            ),
        )
        runtime._record_fast_peer_success(("192.0.2.2", 2))
        runtime._record_fast_peer_failure(("192.0.2.1", 1))
        endpoints = runtime._fast_peer_endpoints({0})
        self.assertEqual(endpoints[0], ("192.0.2.2", 2))
        self.assertNotIn(("192.168.1.5", 49161), endpoints)
        self.assertGreater(endpoints.index(("192.0.2.1", 1)), endpoints.index(("192.0.2.3", 3)))

    def test_peer_probe_reuses_unchoked_socket_and_filters_by_bitfield(self):
        from torrent_fast_blocks import close_peer_connections

        info_hash = b"01234567890123456789"
        peer_id = b"-FZFB01-" + b"012345678901"
        piece_length = 64 * 1024
        block_size = 16 * 1024
        payloads = {
            (0, 0): b"a" * block_size,
            (0, 1): b"b" * block_size,
        }
        accepts = 0
        ready = threading.Event()
        server = socket.socket()
        server.bind(("127.0.0.1", 0))
        server.listen(2)
        port = server.getsockname()[1]

        def serve_peer():
            nonlocal accepts
            ready.set()
            conn, _ = server.accept()
            accepts += 1
            with conn:
                conn.settimeout(3)
                self._recv_exact(conn, 73)
                # Send handshake + BITFIELD (piece 0 only, bit 0x80) + UNCHOKE
                conn.sendall(
                    bytes([19])
                    + b"BitTorrent protocol"
                    + b"\x00" * 8
                    + info_hash
                    + b"-FZSEED-" + b"012345678901"
                    + struct.pack(">IBB", 2, 5, 0x80)
                    + b"\x00\x00\x00\x01\x01",
                )
                for _ in range(2):
                    length = struct.unpack(">I", self._recv_exact(conn, 4))[0]
                    req = self._recv_exact(conn, length)
                    self.assertEqual(req[0], 6)
                    piece, begin, size = struct.unpack(">III", req[1:13])
                    data = payloads[(piece, begin // block_size)][:size]
                    conn.sendall(
                        struct.pack(">IBII", 9 + len(data), 7, piece, begin)
                        + data,
                    )

        thread = threading.Thread(target=serve_peer, daemon=True)
        thread.start()
        self.assertTrue(ready.wait(2))
        sockets = {}
        sockets_lock = threading.Lock()
        try:
            first = fetch_blocks_from_peers(
                [("127.0.0.1", port)],
                info_hash,
                peer_id,
                {(0, 0)},
                piece_length,
                block_size,
                piece_length * 2,
                peer_sockets=sockets,
                peer_sockets_lock=sockets_lock,
            )
            self.assertEqual(first, {(0, 0): payloads[(0, 0)]})
            self.assertIn(("127.0.0.1", port), sockets)
            self.assertEqual(sockets[("127.0.0.1", port)].pieces, {0})

            # Asking for piece 1 (not in peer bitfield) skips without failing/closing.
            missing = fetch_blocks_from_peers(
                [("127.0.0.1", port)],
                info_hash,
                peer_id,
                {(1, 0)},
                piece_length,
                block_size,
                piece_length * 2,
                peer_sockets=sockets,
                peer_sockets_lock=sockets_lock,
            )
            self.assertEqual(missing, {})
            self.assertIn(("127.0.0.1", port), sockets)

            # Second request for piece 0 reuses the exact same TCP socket (accepts == 1).
            second = fetch_blocks_from_peers(
                [("127.0.0.1", port)],
                info_hash,
                peer_id,
                {(0, 1)},
                piece_length,
                block_size,
                piece_length * 2,
                peer_sockets=sockets,
                peer_sockets_lock=sockets_lock,
            )
            self.assertEqual(second, {(0, 1): payloads[(0, 1)]})
            self.assertEqual(accepts, 1)
        finally:
            close_peer_connections(sockets, sockets_lock)
            server.close()
            thread.join(timeout=2)

    def test_reverse_tail_orders_head_first_and_reverses_tail(self):
        from torrent_fast_blocks import _send_block_requests

        sent = []

        class RecordingSocket:
            def sendall(self, data):
                _, message_id, piece, begin, _length = struct.unpack(">IBIII", data)
                self.assertEqual(message_id, 6)
                sent.append((piece, begin // 16384))

        # unittest helper binding
        sock = RecordingSocket()
        sock.self = self
        RecordingSocket.assertEqual = self.assertEqual
        blocks = {(0, idx) for idx in range(8)}
        _send_block_requests(
            sock,
            blocks,
            16 * 1024 * 1024,
            16384,
            16 * 1024 * 1024,
            reverse_tail=True,
        )
        self.assertEqual(
            sent,
            [(0, 0), (0, 1), (0, 2), (0, 3), (0, 7), (0, 6), (0, 5), (0, 4)],
        )

    def test_busy_warm_socket_lock_waits_for_reuse_instead_of_redialing(self):
        from torrent_fast_blocks import PeerWireConnection, close_peer_connections

        info_hash = b"\x22" * 20
        peer_id = b"-TEST01-123456789012"
        block_size = 16384
        piece_length = 65536
        payload = b"z" * block_size

        server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server.bind(("127.0.0.1", 0))
        server.listen(2)
        port = server.getsockname()[1]

        client_sock, peer_sock = socket.socketpair()
        sockets_lock = threading.Lock()
        endpoint = ("127.0.0.1", port)
        pooled = PeerWireConnection(endpoint)
        pooled.stream = client_sock
        pooled.unchoked = True
        sockets = {endpoint: pooled}
        accepts = 0

        def serve():
            nonlocal accepts
            server.settimeout(0.5)
            try:
                header = self._recv_exact(peer_sock, 17)
                _, msg_id, piece, begin, length = struct.unpack(">IBIII", header)
                self.assertEqual((msg_id, piece, begin), (6, 0, 0))
                frame = struct.pack(">IBII", 9 + len(payload), 7, 0, 0) + payload
                peer_sock.sendall(struct.pack(">I", len(frame) - 4) + frame[4:])
                try:
                    extra, _ = server.accept()
                    accepts += 1
                    extra.close()
                except OSError:
                    pass
            finally:
                peer_sock.close()

        thread = threading.Thread(target=serve, daemon=True)
        thread.start()
        pooled.lock.acquire()
        releaser = threading.Timer(0.03, pooled.lock.release)
        releaser.start()
        try:
            fetched = fetch_blocks_from_peer(
                endpoint,
                info_hash,
                peer_id,
                {(0, 0)},
                piece_length,
                block_size,
                piece_length,
                timeout=1.0,
                peer_sockets=sockets,
                peer_sockets_lock=sockets_lock,
            )
            self.assertEqual(fetched, {(0, 0): payload})
            self.assertEqual(accepts, 0)
        finally:
            releaser.cancel()
            if pooled.lock.locked():
                pooled.lock.release()
            close_peer_connections(sockets, sockets_lock)
            server.close()
            thread.join(timeout=2)

    @staticmethod
    def _recv_exact(connection, length):
        data = bytearray()
        while len(data) < length:
            chunk = connection.recv(length - len(data))
            if not chunk:
                raise ConnectionError("peer closed connection")
            data.extend(chunk)
        return bytes(data)


if __name__ == "__main__":
    unittest.main()
