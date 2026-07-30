import os
import sys
import tempfile
import threading
import time
import unittest
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from types import MethodType
from types import ModuleType
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))

try:
    import libtorrent_sidecar as sidecar
except ModuleNotFoundError as error:
    if error.name != "libtorrent":
        raise
    # Pure helper/transcoder tests do not instantiate the libtorrent engine.
    sys.modules["libtorrent"] = ModuleType("libtorrent")
    import libtorrent_sidecar as sidecar


class SidecarStreamTest(unittest.TestCase):
    def test_caps_open_ended_ranges(self):
        large_end = sidecar.RANGE_RESPONSE_MAX_BYTES * 2
        self.assertEqual(
            sidecar.cap_open_ended_range("bytes=0-", (0, large_end)),
            (0, sidecar.RANGE_RESPONSE_MAX_BYTES - 1),
        )
        self.assertEqual(
            sidecar.cap_open_ended_range("bytes=44-", (44, large_end)),
            (44, 44 + sidecar.RANGE_RESPONSE_MAX_BYTES - 1),
        )
        self.assertEqual(
            sidecar.cap_open_ended_range("bytes=0-99", (0, 99)),
            (0, 99),
        )
        self.assertEqual(
            sidecar.cap_open_ended_range(
                "bytes=44-%d" % large_end,
                (44, large_end),
            ),
            (44, 44 + sidecar.RANGE_RESPONSE_MAX_BYTES - 1),
        )
        self.assertEqual(
            sidecar.cap_open_ended_range(
                "bytes=-%d" % large_end,
                (0, large_end - 1),
            ),
            (
                large_end - sidecar.RANGE_RESPONSE_MAX_BYTES,
                large_end - 1,
            ),
        )

    def test_sends_headers_after_first_piece_is_available(self):
        runtime = object.__new__(sidecar.TorrentRuntime)
        runtime.stop_event = threading.Event()
        runtime.metadata_ready = threading.Event()
        runtime.metadata_ready.set()
        runtime.metadata_complete = threading.Event()
        runtime.metadata_error = None
        runtime.file_index = 0
        runtime.file_size = 4
        runtime.file_path = "episode.mkv"
        runtime.save_path = tempfile.gettempdir()
        runtime.session_id = "torrent-test"
        runtime.first_request_logged = False
        piece_release = threading.Event()

        def open_first_chunk(self, _absolute_path, _start, _end):
            piece_release.wait(2)
            return BytesIO(b"test"), b"test"

        runtime.open_first_chunk = MethodType(open_first_chunk, runtime)

        class FakeHandler:
            command = "GET"
            headers = {"Range": "bytes=0-"}
            close_connection = False

            def __init__(self):
                self.status = None
                self.headers_sent = {}
                self.header_event = threading.Event()
                self.wfile = BytesIO()

            def send_response(self, status):
                self.status = status

            def send_header(self, name, value):
                self.headers_sent[name] = value

            def end_headers(self):
                self.header_event.set()

        handler = FakeHandler()
        worker = threading.Thread(target=runtime.serve, args=(handler, False))
        worker.start()

        self.assertFalse(handler.header_event.wait(0.1))
        self.assertIsNone(handler.status)

        piece_release.set()
        self.assertTrue(handler.header_event.wait(1))
        self.assertEqual(handler.status, 206)
        self.assertEqual(handler.headers_sent["Content-Length"], "4")
        self.assertEqual(handler.headers_sent["Connection"], "close")

        worker.join(2)
        self.assertFalse(worker.is_alive())
        self.assertTrue(handler.close_connection)
        self.assertEqual(handler.wfile.getvalue(), b"test")

    def test_bounds_no_range_requests(self):
        with patch.object(sidecar, "RANGE_RESPONSE_MAX_BYTES", 4):
            runtime = object.__new__(sidecar.TorrentRuntime)
            runtime.stop_event = threading.Event()
            runtime.metadata_ready = threading.Event()
            runtime.metadata_ready.set()
            runtime.metadata_complete = threading.Event()
            runtime.metadata_error = None
            runtime.file_index = 0
            runtime.file_size = 9
            runtime.file_path = "episode.mkv"
            runtime.save_path = tempfile.gettempdir()
            runtime.session_id = "torrent-no-range-test"
            runtime.first_request_logged = False

            def open_first_chunk(self, _absolute_path, _start, _end):
                return BytesIO(b"012345678"), b"0123"

            def read_range_chunk(self, stream, start, end):
                stream.seek(start)
                return stream.read(end - start + 1)

            runtime.open_first_chunk = MethodType(
                open_first_chunk,
                runtime,
            )
            runtime.read_range_chunk = MethodType(
                read_range_chunk,
                runtime,
            )

            class FakeHandler:
                command = "GET"
                headers = {}
                close_connection = False

                def __init__(self):
                    self.status = None
                    self.headers_sent = {}
                    self.wfile = BytesIO()

                def send_response(self, status):
                    self.status = status

                def send_header(self, name, value):
                    self.headers_sent[name] = value

                def end_headers(self):
                    return None

            handler = FakeHandler()
            runtime.serve(handler, False)

            self.assertEqual(handler.status, 206)
            self.assertEqual(handler.headers_sent["Content-Length"], "4")
            self.assertEqual(
                handler.headers_sent["Content-Range"],
                "bytes 0-3/9",
            )
            self.assertEqual(handler.wfile.getvalue(), b"0123")

    def test_waits_for_file_created_after_metadata(self):
        runtime = object.__new__(sidecar.TorrentRuntime)
        runtime.stop_event = threading.Event()

        def read_range_chunk(self, stream, start, end):
            expected_length = end - start + 1
            stream.seek(start)
            data = stream.read(expected_length)
            return data if len(data) == expected_length else None

        runtime.read_range_chunk = MethodType(read_range_chunk, runtime)

        with tempfile.TemporaryDirectory() as directory:
            file_path = Path(directory) / "episode.mkv"

            def create_file():
                time.sleep(0.25)
                file_path.write_bytes(b"video")

            threading.Thread(target=create_file, daemon=True).start()
            stream, first_chunk = runtime.open_first_chunk(
                str(file_path),
                0,
                4,
            )

            self.assertIsNotNone(stream)
            self.assertEqual(first_chunk, b"video")
            stream.close()

class SidecarStorageTest(unittest.TestCase):
    def test_enforce_storage_limit_prunes_oldest(self):
        with tempfile.TemporaryDirectory() as root_dir:
            dir1 = Path(root_dir) / "torrent-1"
            dir2 = Path(root_dir) / "torrent-2"
            dir3 = Path(root_dir) / "torrent-3"

            dir1.mkdir()
            dir2.mkdir()
            dir3.mkdir()

            (dir1 / "data.bin").write_bytes(b"A" * 60)
            (dir2 / "data.bin").write_bytes(b"B" * 60)
            (dir3 / "data.bin").write_bytes(b"C" * 60)

            # Set distinct mtimes
            now = time.time()
            os.utime(dir1, (now - 300, now - 300))
            os.utime(dir2, (now - 200, now - 200))
            os.utime(dir3, (now - 100, now - 100))

            # Limit to 100 bytes (total is 180 bytes)
            sidecar.enforce_storage_limit(root_dir, max_bytes=100)

            self.assertFalse(dir1.exists())  # Oldest pruned
            self.assertTrue(dir2.exists() or dir3.exists())

    def test_enforce_storage_limit_preserves_active(self):
        with tempfile.TemporaryDirectory() as root_dir:
            dir1 = Path(root_dir) / "torrent-1"
            dir2 = Path(root_dir) / "torrent-2"

            dir1.mkdir()
            dir2.mkdir()

            (dir1 / "data.bin").write_bytes(b"A" * 60)
            (dir2 / "data.bin").write_bytes(b"B" * 60)

            now = time.time()
            os.utime(dir1, (now - 300, now - 300))
            os.utime(dir2, (now - 100, now - 100))

            # Mark dir1 (oldest) as active
            sidecar.enforce_storage_limit(
                root_dir,
                max_bytes=70,
                active_paths={str(dir1)},
            )

            self.assertTrue(dir1.exists())  # Active preserved!
            self.assertFalse(dir2.exists())  # Inactive pruned!


if __name__ == "__main__":
    unittest.main()
