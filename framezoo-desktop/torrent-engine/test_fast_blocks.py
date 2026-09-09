import socket
import struct
import threading
import unittest

from torrent_fast_blocks import (
    fetch_blocks_from_peer,
    normalize_endpoint,
)


class FastBlockProtocolTest(unittest.TestCase):
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

    def test_fetches_requested_blocks_from_tcp_peer(self):
        info_hash = b"01234567890123456789"
        peer_id = b"-FZTEST-" + b"012345678901"
        piece_length = 64 * 1024
        block_size = 16 * 1024
        blocks = {(0, 2), (0, 3)}
        payloads = {
            (0, 2): b"a" * block_size,
            (0, 3): b"b" * block_size,
        }
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
                    requests = []
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
