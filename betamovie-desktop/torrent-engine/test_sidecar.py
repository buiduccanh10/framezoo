import os
import sys
import tempfile
import threading
import time
import unittest
from io import BytesIO
from pathlib import Path
from types import MethodType
from types import ModuleType

sys.path.insert(0, str(Path(__file__).parent))

try:
    import torrent_constants as constants
    import torrent_utils as utils
    from torrent_runtime import TorrentRuntime
except ModuleNotFoundError as error:
    if error.name != "libtorrent":
        raise
    # Pure helper/transcoder tests do not instantiate the libtorrent engine.
    sys.modules["libtorrent"] = ModuleType("libtorrent")
    import torrent_constants as constants
    import torrent_utils as utils
    from torrent_runtime import TorrentRuntime


class SidecarStreamTest(unittest.TestCase):
    def test_keeps_requested_open_ended_ranges(self):
        large_end = 64 * 1024 * 1024
        self.assertEqual(
            utils.cap_open_ended_range("bytes=0-", (0, large_end)),
            (0, large_end),
        )
        self.assertEqual(
            utils.cap_open_ended_range("bytes=44-", (44, large_end)),
            (44, large_end),
        )
        self.assertEqual(
            utils.cap_open_ended_range("bytes=0-99", (0, 99)),
            (0, 99),
        )
        self.assertEqual(
            utils.cap_open_ended_range(
                "bytes=44-%d" % large_end,
                (44, large_end),
            ),
            (44, large_end),
        )
        self.assertEqual(
            utils.cap_open_ended_range(
                "bytes=-%d" % large_end,
                (0, large_end - 1),
            ),
            (0, large_end - 1),
        )

    def test_sends_headers_after_first_piece_is_available(self):
        runtime = object.__new__(TorrentRuntime)
        runtime.stop_event = threading.Event()
        runtime.metadata_ready = threading.Event()
        runtime.metadata_ready.set()
        runtime.metadata_complete = threading.Event()
        runtime.metadata_error = None
        runtime.info = None
        runtime.file_index = 0
        runtime.file_size = 4
        runtime.file_path = "episode.mkv"
        runtime.save_path = tempfile.gettempdir()
        runtime.session_id = "torrent-test"
        runtime.first_request_logged = False
        runtime._piece_priority_lock = threading.RLock()
        runtime._boosted_pieces = set()
        runtime._has_streamed_bytes = False
        runtime._last_stream_start = None
        piece_release = threading.Event()

        def open_first_chunk(self, _absolute_path, _start, _end, **_kwargs):
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

    def test_streams_full_body_without_range_header(self):
        runtime = object.__new__(TorrentRuntime)
        runtime.stop_event = threading.Event()
        runtime.metadata_ready = threading.Event()
        runtime.metadata_ready.set()
        runtime.metadata_complete = threading.Event()
        runtime.metadata_error = None
        runtime.info = None
        runtime.file_index = 0
        runtime.file_size = 9
        runtime.file_path = "episode.mkv"
        runtime.save_path = tempfile.gettempdir()
        runtime.session_id = "torrent-no-range-test"
        runtime.first_request_logged = False
        runtime.request_count = 0
        runtime._piece_priority_lock = threading.RLock()
        runtime._boosted_pieces = set()
        runtime._has_streamed_bytes = False
        runtime._last_stream_start = None

        def open_first_chunk(self, _absolute_path, _start, _end, **_kwargs):
            return BytesIO(b"012345678"), b"0123"

        def read_range_chunk(self, stream, start, end, **_kwargs):
            stream.seek(start)
            return stream.read(end - start + 1)

        runtime.open_first_chunk = MethodType(open_first_chunk, runtime)
        runtime.read_range_chunk = MethodType(read_range_chunk, runtime)

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

        self.assertEqual(handler.status, 200)
        self.assertEqual(handler.headers_sent["Content-Length"], "9")
        self.assertNotIn("Content-Range", handler.headers_sent)
        self.assertEqual(handler.wfile.getvalue(), b"012345678")

    def test_piece_scheduling_is_additive_for_concurrent_ranges(self):
        runtime = object.__new__(TorrentRuntime)
        runtime.stop_event = threading.Event()
        runtime._piece_priority_lock = threading.RLock()
        runtime._boosted_pieces = set()
        runtime.session_id = "torrent-priority-test"

        class FakeHandle:
            def __init__(self):
                self.priorities = []
                self.deadlines = []

            def have_piece(self, _piece):
                return False

            def piece_priority(self, piece, priority):
                self.priorities.append((piece, priority))

            def set_piece_deadline(self, piece, deadline, flags):
                self.deadlines.append((piece, deadline, flags))

            def prioritize_pieces(self, _priorities):
                raise AssertionError("scheduler must not reset global priorities")

        runtime.handle = FakeHandle()
        runtime._schedule_pieces([522], {522}, "tail-probe")
        runtime._schedule_pieces([478, 479], {478}, "playback-head")

        self.assertIn((522, 7), runtime.handle.priorities)
        self.assertIn((478, 7), runtime.handle.priorities)
        self.assertIn((479, 7), runtime.handle.priorities)
        self.assertEqual(len(runtime.handle.deadlines), 3)
        self.assertTrue(all(deadline > 0 for _, deadline, _ in runtime.handle.deadlines))

    def test_focus_file_does_not_reset_priorities_for_each_range(self):
        runtime = object.__new__(TorrentRuntime)
        runtime._piece_priority_lock = threading.RLock()
        runtime._focused_file_index = None
        runtime.file_index = 1

        class FakeFiles:
            def num_files(self):
                return 3

        class FakeInfo:
            def files(self):
                return FakeFiles()

        class FakeHandle:
            def __init__(self):
                self.file_priorities = []
                self.sequential_calls = 0
                self.sequential_enabled = None

            def prioritize_files(self, priorities):
                self.file_priorities.append(priorities)

            def set_sequential_download(self, enabled):
                self.sequential_calls += 1
                self.sequential_enabled = enabled

        runtime.info = FakeInfo()
        runtime.handle = FakeHandle()
        runtime.focus_file()
        runtime.focus_file()

        self.assertEqual(runtime.handle.file_priorities, [[0, 4, 0]])
        self.assertEqual(runtime.handle.sequential_calls, 1)
        self.assertFalse(runtime.handle.sequential_enabled)

    def test_ignores_initial_tail_probe_for_playback_cursor(self):
        runtime = object.__new__(TorrentRuntime)
        runtime.start_time = 0

        total = 100 * 1024 * 1024
        tail_start = total - constants.RANGE_PREFETCH_BYTES

        self.assertTrue(
            runtime.is_initial_tail_probe(
                tail_start + 1,
                total,
                2,
            ),
        )
        self.assertFalse(
            runtime.is_initial_tail_probe(
                0,
                total,
                1,
            ),
        )
        self.assertFalse(
            runtime.is_initial_tail_probe(
                tail_start + 1,
                total,
                4,
            ),
        )
        runtime.start_time = 120
        self.assertTrue(
            runtime.is_initial_tail_probe(
                tail_start + 1,
                total,
                2,
            ),
        )

    def test_initial_tail_probe_does_not_mark_streamed_cursor(self):
        runtime = object.__new__(TorrentRuntime)
        runtime.stop_event = threading.Event()
        runtime.metadata_ready = threading.Event()
        runtime.metadata_ready.set()
        runtime.metadata_complete = threading.Event()
        runtime.metadata_error = None
        runtime.info = None
        runtime.file_index = 0
        runtime.file_size = 100 * 1024 * 1024
        runtime.file_path = "episode.mkv"
        runtime.save_path = tempfile.gettempdir()
        runtime.session_id = "torrent-tail-probe-test"
        runtime.start_time = 0
        runtime.first_request_logged = False
        runtime.request_count = 1
        runtime._piece_priority_lock = threading.RLock()
        runtime._boosted_pieces = set()
        runtime._has_streamed_bytes = False
        runtime._last_stream_start = None

        def open_first_chunk(self, _absolute_path, start, end, **_kwargs):
            if end - start + 1 != 1:
                raise AssertionError("tail probe should request one byte")
            return BytesIO(b"x"), b"x"

        runtime.open_first_chunk = MethodType(open_first_chunk, runtime)

        class FakeHandler:
            command = "GET"
            headers = {
                "Range": "bytes=%d-" % (runtime.file_size - 1),
            }
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
        self.assertEqual(handler.wfile.getvalue(), b"x")
        self.assertFalse(runtime._has_streamed_bytes)
        self.assertIsNone(runtime._last_stream_start)

    def test_initial_tail_probe_sends_headers_before_waiting_for_body(self):
        runtime = object.__new__(TorrentRuntime)
        runtime.stop_event = threading.Event()
        runtime.metadata_ready = threading.Event()
        runtime.metadata_ready.set()
        runtime.metadata_complete = threading.Event()
        runtime.metadata_error = None
        runtime.info = None
        runtime.file_index = 0
        runtime.file_size = 100 * 1024 * 1024
        runtime.file_path = "episode.mkv"
        runtime.save_path = tempfile.gettempdir()
        runtime.session_id = "torrent-tail-defer-test"
        runtime.first_request_logged = True
        runtime.request_count = 1
        runtime._piece_priority_lock = threading.RLock()
        runtime._boosted_pieces = set()
        runtime._has_streamed_bytes = False
        runtime._last_stream_start = None
        body_release = threading.Event()

        def open_first_chunk(self, _absolute_path, _start, _end, **_kwargs):
            body_release.wait(2)
            return BytesIO(b"x"), b"x"

        runtime.open_first_chunk = MethodType(open_first_chunk, runtime)

        class FakeHandler:
            command = "GET"
            headers = {
                "Range": "bytes=%d-" % (runtime.file_size - 1),
            }
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

        self.assertTrue(handler.header_event.wait(1))
        self.assertEqual(handler.status, 206)
        self.assertEqual(handler.headers_sent["Content-Length"], "1")
        self.assertEqual(handler.wfile.getvalue(), b"")

        body_release.set()
        worker.join(2)
        self.assertFalse(worker.is_alive())
        self.assertEqual(handler.wfile.getvalue(), b"x")
        self.assertFalse(runtime._has_streamed_bytes)
        self.assertIsNone(runtime._last_stream_start)

    def test_waits_for_file_created_after_metadata(self):
        runtime = object.__new__(TorrentRuntime)
        runtime.stop_event = threading.Event()
        runtime.info = None
        runtime.file_index = None
        runtime.file_size = 5

        def read_range_chunk(self, stream, start, end, **_kwargs):
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
            utils.enforce_storage_limit(root_dir, max_bytes=100)

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
            utils.enforce_storage_limit(
                root_dir,
                max_bytes=70,
                active_paths={str(dir1)},
            )

            self.assertTrue(dir1.exists())  # Active preserved!
            self.assertFalse(dir2.exists())  # Inactive pruned!


if __name__ == "__main__":
    unittest.main()
