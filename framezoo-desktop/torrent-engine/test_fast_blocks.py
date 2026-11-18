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
