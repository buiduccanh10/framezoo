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

    def test_merges_trackers_without_duplicates(self):
        self.assertEqual(
            utils.merge_tracker_sources(
                [" udp://one.example/announce ", "udp://two.example/announce"],
                ["udp://one.example/announce", None],
                ["udp://three.example/announce"],
            ),
            [
                "udp://one.example/announce",
                "udp://two.example/announce",
                "udp://three.example/announce",
            ],
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

    def test_sends_headers_before_missing_initial_piece_arrives(self):
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
        runtime.session_id = "torrent-early-headers-test"
        runtime.first_request_logged = False
        runtime.request_count = 0
        runtime._piece_priority_lock = threading.RLock()
        runtime._boosted_pieces = set()
        runtime._has_streamed_bytes = False
        runtime._last_stream_start = None
        body_release = threading.Event()

        def open_first_chunk(self, _absolute_path, _start, _end, timeout, **_kwargs):
            if timeout <= constants.INITIAL_RANGE_HEADER_WAIT_TIMEOUT:
                return None, None
            body_release.wait(2)
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

        self.assertTrue(handler.header_event.wait(1))
        self.assertEqual(handler.status, 206)
        self.assertEqual(handler.wfile.getvalue(), b"")

        # The body remains blocked until the piece becomes available.
        body_release.set()
        worker.join(1)
        self.assertFalse(worker.is_alive())
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
        self.assertIn((479, 4), runtime.handle.priorities)
        self.assertEqual(len(runtime.handle.deadlines), 3)
        self.assertIn(0, [deadline for _, deadline, _ in runtime.handle.deadlines])

    def test_piece_scheduling_uses_hot_startup_window_and_warm_readahead(self):
        runtime = object.__new__(TorrentRuntime)
        runtime._piece_priority_lock = threading.RLock()
        runtime._boosted_pieces = set()
        runtime.session_id = "torrent-startup-window-test"

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

        runtime.handle = FakeHandle()
        runtime._schedule_pieces(
            [10, 11, 12, 13, 14, 15],
            {10},
            "range",
        )

        self.assertEqual(
            runtime.handle.priorities,
            [
                (10, constants.STREAM_PIECE_PRIORITY),
                (11, constants.STREAM_HOT_PIECE_PRIORITY),
                (12, constants.STREAM_HOT_PIECE_PRIORITY),
                (13, constants.STREAM_HOT_PIECE_PRIORITY),
                (14, constants.STREAM_WARM_PIECE_PRIORITY),
                (15, constants.STREAM_WARM_PIECE_PRIORITY),
            ],
        )
        self.assertEqual(runtime.handle.deadlines[0][1], 0)

    def test_metadata_prefetches_head_and_tail_pieces(self):
        runtime = object.__new__(TorrentRuntime)
        runtime.info = type(
            "FakeInfo",
            (),
            {"piece_length": lambda _self: 256 * 1024},
        )()
        runtime.file_index = 0
        runtime.file_size = 4 * constants.STREAM_CHUNK_SIZE
        runtime.session_id = "torrent-startup-prefetch-test"
        scheduled = []

        def map_pieces(self, start, _length):
            if start == 0:
                return {10, 11, 12, 13, 14}
            return {90, 91}

        def schedule(self, pieces, required, reason):
            scheduled.append((pieces, required, reason))

        runtime.map_pieces = MethodType(map_pieces, runtime)
        runtime._schedule_pieces = MethodType(schedule, runtime)
        runtime.prime_startup_ranges()

        self.assertEqual(
            scheduled,
            [
                (
                    [10, 11, 12, 13],
                    {10, 11, 12, 13},
                    "startup-prefetch",
                ),
                ([90, 91], {90, 91}, "startup-prefetch"),
            ],
        )

    def test_reannounces_when_target_piece_is_unavailable_with_active_rate(self):
        runtime = object.__new__(TorrentRuntime)
        runtime.session_id = "torrent-target-stall-test"
        runtime._reannounce_lock = threading.Lock()
        runtime._last_reannounce = -constants.REANNOUNCE_COOLDOWN
        calls = []

        class FakeStatus:
            num_peers = 3
            download_rate = 10_000

        class FakeHandle:
            def status(self):
                return FakeStatus()

            def piece_availability(self):
                return [0] * 8

            def force_reannounce(self):
                calls.append("tracker")

            def force_dht_announce(self):
                calls.append("dht")

        runtime.handle = FakeHandle()
        runtime._force_reannounce_if_stalled(7, 20, 1.1)

        self.assertEqual(calls, ["tracker", "dht"])

    def test_reannounces_when_target_piece_has_availability(self):
        runtime = object.__new__(TorrentRuntime)
        runtime.session_id = "torrent-target-available-test"
        runtime._reannounce_lock = threading.Lock()
        runtime._last_reannounce = -constants.REANNOUNCE_COOLDOWN
        calls = []

        class FakeStatus:
            num_peers = 2
            download_rate = 10_000

        class FakeHandle:
            def status(self):
                return FakeStatus()

            def piece_availability(self):
                return [0] * 7 + [1]

            def force_reannounce(self):
                calls.append("tracker")

            def force_dht_announce(self):
                calls.append("dht")

        runtime.handle = FakeHandle()
        runtime._force_reannounce_if_stalled(7, 20, 1.1)

        self.assertEqual(calls, ["tracker", "dht"])

    def test_kicks_target_piece_to_force_endgame_re_request(self):
        runtime = object.__new__(TorrentRuntime)
        runtime.session_id = "torrent-target-escalation-test"
        runtime.stop_event = threading.Event()
        runtime._piece_priority_lock = threading.RLock()
        runtime._boosted_pieces = set()
        runtime._piece_priorities = {}
        runtime._piece_deadlines = {}
        runtime._pending_kick_restore = {}
        calls = []

        class FakeInfo:
            def num_pieces(self):
                return 8

        class FakeHandle:
            def have_piece(self, _piece):
                return False

            def piece_priority(self, piece, *priority):
                if priority:
                    calls.append(("priority", piece, priority[0]))
                    return None
                return 2

            def clear_piece_deadlines(self):
                calls.append(("clear",))

            def reset_piece_deadline(self, piece):
                calls.append(("reset", piece))

            def set_piece_deadline(self, piece, deadline, _flags):
                calls.append(("deadline", piece, deadline))

            def piece_availability(self):
                return [5] * 8

        runtime.info = FakeInfo()
        runtime.handle = FakeHandle()
        runtime._kick_target_piece(7)

        self.assertEqual(
            calls,
            [
                # Empty the time-critical list so the stalled piece's
                # in-flight requests become cancellable.
                ("clear",),
                # Filter the piece: priority 0 stops new requests while the
                # hold lasts.
                ("priority", 7, 0),
                # Post libtorrent's cancel_non_critical through a throwaway
                # missing piece (the target must not be time-critical for the
                # cancel to reach it): libtorrent sends CANCEL messages for
                # every non-time-critical in-flight request, then resets it.
                ("deadline", 0, 10000),
                ("reset", 0),
            ],
        )
        self.assertNotIn(7, runtime._piece_deadlines)
        self.assertIn(7, runtime._pending_kick_restore)

        runtime._restore_pending_kicks(time.monotonic() + 1)
        self.assertEqual(
            calls[-3:],
            [
                ("priority", 7, constants.STREAM_PIECE_PRIORITY),
                ("reset", 7),
                ("deadline", 7, 0),
            ],
        )
        self.assertNotIn(7, runtime._pending_kick_restore)
        self.assertIn(7, runtime._boosted_pieces)
        self.assertEqual(
            runtime._piece_priorities[7],
            constants.STREAM_PIECE_PRIORITY,
        )

    def test_focus_demotes_other_priority_seven_pieces_after_stall(self):
        runtime = object.__new__(TorrentRuntime)
        runtime.session_id = "torrent-focus-test"
        runtime._piece_priority_lock = threading.RLock()
        runtime._boosted_pieces = set()
        runtime._piece_priorities = {7: 7, 8: 7, 9: 2}
        runtime._piece_deadlines = {}
        runtime.elapsed_ms = lambda: 0
        priorities = {}

        class FakeHandle:
            def have_piece(self, piece):
                return piece == 99

            def piece_priority(self, piece, *priority):
                if priority:
                    priorities[piece] = priority[0]
                    return None
                return priorities.get(piece, 0)

            def set_piece_deadline(self, _piece, _deadline, _flags):
                return None

            def reset_piece_deadline(self, _piece):
                return None

            def piece_availability(self):
                return [5] * 10

        runtime.handle = FakeHandle()

        self.assertTrue(runtime._activate_target_focus(7))
        self.assertEqual(
            priorities[8],
            constants.STREAM_HOT_PIECE_PRIORITY,
        )
        self.assertEqual(runtime._piece_priorities[9], 2)

        runtime._schedule_pieces([7, 8, 9], {7, 8, 9}, reason="range")
        self.assertEqual(priorities[7], constants.STREAM_PIECE_PRIORITY)
        self.assertEqual(
            priorities[8],
            constants.STREAM_HOT_PIECE_PRIORITY,
        )

        runtime._release_target_focus(7)
        runtime._schedule_pieces([7, 8, 9], {7, 8, 9}, reason="range")
        self.assertEqual(priorities[8], constants.STREAM_PIECE_PRIORITY)

    def _wait_handle(
        self,
        runtime,
        total_done_holder,
        kicks,
        priorities,
    ):
        class FakeStatus:
            has_metadata = True
            download_rate = 8_000_000
            pieces = [False, False]
            num_peers = 5

            @property
            def total_done(self):
                return total_done_holder[0]

        class FakeHandle:
            def status(self):
                return FakeStatus()

            def piece_availability(self):
                return [3, 3]

            def have_piece(self, _piece):
                return False

            def piece_priority(self, piece, *priority):
                if priority:
                    priorities[piece] = priority[0]
                    if priority[0] == 0:
                        kicks.append(("kick", piece))
                    return None
                return priorities.get(piece, 0)

            def set_piece_deadline(self, _piece, _deadline, _flags):
                return None

            def reset_piece_deadline(self, _piece):
                return None

        return FakeHandle()

    def test_skips_kick_while_swarm_makes_progress(self):
        runtime = object.__new__(TorrentRuntime)
        runtime.stop_event = threading.Event()
        runtime.info = None
        runtime.file_index = None
        runtime.file_size = 2
        runtime.session_id = "torrent-kick-gate-test"
        runtime.last_range_key = None
        runtime._piece_priority_lock = threading.RLock()
        runtime._boosted_pieces = set()
        runtime._piece_priorities = {}
        runtime._piece_deadlines = {}
        runtime._reannounce_lock = threading.Lock()
        runtime._last_reannounce = 0.0
        runtime.elapsed_ms = lambda: 0

        def map_pieces(self, _start, _length):
            return {0}

        def noop(self, *_args, **_kwargs):
            return None

        total_done_holder = [0]
        kicks = []

        class GrowingTotal:
            @property
            def total_done(self):
                total_done_holder[0] += 2 * 1024 * 1024
                return total_done_holder[0]

        class BusyStatus:
            has_metadata = True
            download_rate = 8_000_000
            pieces = [False, False]
            num_peers = 5
            total_done = GrowingTotal.total_done

        class BusyHandle:
            def status(self):
                return BusyStatus()

            def piece_availability(self):
                return [3, 3]

            def have_piece(self, _piece):
                return False

            def piece_priority(self, piece, *priority):
                if priority:
                    if priority[0] == 0:
                        kicks.append(("kick", piece))
                    return None
                return 7

            def set_piece_deadline(self, _piece, _deadline, _flags):
                return None

            def reset_piece_deadline(self, _piece):
                return None

        runtime.map_pieces = MethodType(map_pieces, runtime)
        runtime._force_reannounce_if_stalled = MethodType(noop, runtime)
        runtime.handle = BusyHandle()
        runtime.wait_for_range(0, 0, timeout=2.2, track_position=False)

        self.assertEqual(kicks, [])

    def test_kicks_when_swarm_makes_no_progress(self):
        runtime = object.__new__(TorrentRuntime)
        runtime.stop_event = threading.Event()
        runtime.info = None
        runtime.file_index = None
        runtime.file_size = 2
        runtime.session_id = "torrent-kick-idle-test"
        runtime.last_range_key = None
        runtime._piece_priority_lock = threading.RLock()
        runtime._boosted_pieces = set()
        runtime._piece_priorities = {}
        runtime._piece_deadlines = {}
        runtime._reannounce_lock = threading.Lock()
        runtime._last_reannounce = 0.0
        runtime.elapsed_ms = lambda: 0

        def map_pieces(self, _start, _length):
            return {0}

        def noop(self, *_args, **_kwargs):
            return None

        kicks = []
        runtime.handle = self._wait_handle(runtime, [0], kicks, {})
        runtime.map_pieces = MethodType(map_pieces, runtime)
        runtime._force_reannounce_if_stalled = MethodType(noop, runtime)
        runtime.wait_for_range(0, 0, timeout=2.2, track_position=False)

        self.assertEqual(kicks, [("kick", 0)])

    def test_kicks_when_swarm_goes_idle_after_partial_progress(self):
        runtime = object.__new__(TorrentRuntime)
        runtime.stop_event = threading.Event()
        runtime.info = None
        runtime.file_index = None
        runtime.file_size = 2
        runtime.session_id = "torrent-kick-idle-after-progress-test"
        runtime.last_range_key = None
        runtime._piece_priority_lock = threading.RLock()
        runtime._boosted_pieces = set()
        runtime._piece_priorities = {}
        runtime._piece_deadlines = {}
        runtime._reannounce_lock = threading.Lock()
        runtime._last_reannounce = 0.0
        runtime.elapsed_ms = lambda: 0

        def map_pieces(self, _start, _length):
            return {0}

        def noop(self, *_args, **_kwargs):
            return None

        total_done_holder = [0]
        grew_once = [False]
        kicks = []

        class FadingStatus:
            has_metadata = True
            pieces = [False, False]
            num_peers = 5

            @property
            def total_done(self):
                if not grew_once[0]:
                    grew_once[0] = True
                    total_done_holder[0] += 3 * 1024 * 1024
                return total_done_holder[0]

            @property
            def download_rate(self):
                return 8_000_000 if not grew_once[0] else 0

        class FadingHandle:
            def status(self):
                return FadingStatus()

            def piece_availability(self):
                return [3, 3]

            def have_piece(self, _piece):
                return False

            def piece_priority(self, piece, *priority):
                if priority:
                    if priority[0] == 0:
                        kicks.append(("kick", piece))
                    return None
                return 7

            def set_piece_deadline(self, _piece, _deadline, _flags):
                return None

            def reset_piece_deadline(self, _piece):
                return None

        runtime.map_pieces = MethodType(map_pieces, runtime)
        runtime._force_reannounce_if_stalled = MethodType(noop, runtime)
        runtime.handle = FadingHandle()
        runtime.wait_for_range(0, 0, timeout=2.2, track_position=False)

        self.assertEqual(kicks, [("kick", 0)])

    def test_focus_enables_kick_despite_swarm_progress(self):
        old_focus_delay = constants.TARGET_FOCUS_DELAY
        old_kick_delay = constants.TARGET_KICK_DELAY
        old_kick_interval = constants.TARGET_KICK_INTERVAL
        try:
            constants.TARGET_FOCUS_DELAY = 0.3
            constants.TARGET_KICK_DELAY = 0.4
            constants.TARGET_KICK_INTERVAL = 0.6

            runtime = object.__new__(TorrentRuntime)
            runtime.stop_event = threading.Event()
            runtime.info = None
            runtime.file_index = None
            runtime.file_size = 2
            runtime.session_id = "torrent-focus-kick-test"
            runtime.last_range_key = None
            runtime._piece_priority_lock = threading.RLock()
            runtime._boosted_pieces = set()
            runtime._piece_priorities = {0: 7, 1: 7}
            runtime._piece_deadlines = {}
            runtime._reannounce_lock = threading.Lock()
            runtime._last_reannounce = 0.0
            runtime.elapsed_ms = lambda: 0

            def map_pieces(self, _start, _length):
                return {0}

            def noop(self, *_args, **_kwargs):
                return None

            total_done_holder = [0]
            kicks = []
            priorities = {0: 7, 1: 7}

            class GrowingTotal:
                @property
                def total_done(self):
                    total_done_holder[0] += 2 * 1024 * 1024
                    return total_done_holder[0]

            class BusyStatus:
                has_metadata = True
                download_rate = 8_000_000
                pieces = [False, False]
                num_peers = 5
                total_done = GrowingTotal.total_done

            class BusyHandle:
                def status(self):
                    return BusyStatus()

                def piece_availability(self):
                    return [3, 3]

                def have_piece(self, _piece):
                    return False

                def piece_priority(self, piece, *priority):
                    if priority:
                        priorities[piece] = priority[0]
                        if priority[0] == 0:
                            kicks.append(("kick", piece))
                        return None
                    return priorities.get(piece, 0)

                def set_piece_deadline(self, _piece, _deadline, _flags):
                    return None

                def reset_piece_deadline(self, _piece):
                    return None

            runtime.map_pieces = MethodType(map_pieces, runtime)
            runtime._force_reannounce_if_stalled = MethodType(noop, runtime)
            runtime.handle = BusyHandle()
            runtime.wait_for_range(0, 0, timeout=2.2, track_position=False)
        finally:
            constants.TARGET_FOCUS_DELAY = old_focus_delay
            constants.TARGET_KICK_DELAY = old_kick_delay
            constants.TARGET_KICK_INTERVAL = old_kick_interval

        self.assertGreaterEqual(len(kicks), 1)
        self.assertEqual(
            priorities[1],
            constants.STREAM_HOT_PIECE_PRIORITY,
        )
        self.assertEqual(
            priorities[0],
            constants.STREAM_PIECE_PRIORITY,
        )
        self.assertIsNone(runtime._focus_piece)

    def test_kick_holds_piece_at_zero_through_replans_then_restores(self):
        old_restore_delay = constants.TARGET_KICK_RESTORE_DELAY
        old_kick_delay = constants.TARGET_KICK_DELAY
        old_kick_interval = constants.TARGET_KICK_INTERVAL
        old_focus_delay = constants.TARGET_FOCUS_DELAY
        try:
            constants.TARGET_KICK_RESTORE_DELAY = 0.3
            constants.TARGET_KICK_DELAY = 0.05
            constants.TARGET_KICK_INTERVAL = 0.2
            constants.TARGET_FOCUS_DELAY = 60

            runtime = object.__new__(TorrentRuntime)
            runtime.stop_event = threading.Event()
            runtime.info = None
            runtime.file_index = None
            runtime.file_size = 2
            runtime.session_id = "torrent-two-phase-kick-test"
            runtime.last_range_key = None
            runtime._piece_priority_lock = threading.RLock()
            runtime._boosted_pieces = set()
            runtime._piece_priorities = {0: 7}
            runtime._piece_deadlines = {}
            runtime._pending_kick_restore = {}
            runtime._reannounce_lock = threading.Lock()
            runtime._last_reannounce = 0.0
            runtime.elapsed_ms = lambda: 0

            def map_pieces(self, _start, _length):
                return {0}

            def noop(self, *_args, **_kwargs):
                return None

            calls = []

            class FakeStatus:
                has_metadata = True
                download_rate = 0
                total_done = 0
                pieces = [False]
                num_peers = 3

            class FakeHandle:
                def status(self):
                    return FakeStatus()

                def piece_availability(self):
                    return [3]

                def have_piece(self, _piece):
                    return False

                def piece_priority(self, piece, *priority):
                    if priority:
                        calls.append(("priority", piece, priority[0]))
                        return None
                    return 0

                def set_piece_deadline(self, _piece, _deadline, _flags):
                    return None

                def reset_piece_deadline(self, _piece):
                    return None

            runtime.map_pieces = MethodType(map_pieces, runtime)
            runtime._force_reannounce_if_stalled = MethodType(noop, runtime)
            runtime.handle = FakeHandle()
            runtime.wait_for_range(0, 0, timeout=1.6, track_position=False)
        finally:
            constants.TARGET_KICK_RESTORE_DELAY = old_restore_delay
            constants.TARGET_KICK_DELAY = old_kick_delay
            constants.TARGET_KICK_INTERVAL = old_kick_interval
            constants.TARGET_FOCUS_DELAY = old_focus_delay

        piece_calls = [
            entry
            for entry in calls
            if entry[0] == "priority" and entry[1] == 0
        ]
        kick_index = piece_calls.index(("priority", 0, 0))
        restore_index = piece_calls.index(
            ("priority", 0, constants.STREAM_PIECE_PRIORITY)
        )
        self.assertGreaterEqual(kick_index, 1)
        self.assertLess(restore_index, len(piece_calls))
        self.assertTrue(
            all(
                entry == ("priority", 0, 0)
                for entry in piece_calls[kick_index + 1 : restore_index]
            )
        )
        self.assertEqual(
            piece_calls[-1],
            ("priority", 0, constants.STREAM_PIECE_PRIORITY),
        )

    def test_concurrent_ranges_keep_independent_blocked_state(self):
        runtime = object.__new__(TorrentRuntime)
        runtime.stop_event = threading.Event()
        runtime.info = None
        runtime.file_index = None
        runtime.file_size = 2
        runtime.session_id = "torrent-concurrent-stall-test"
        runtime.last_range_key = None
        runtime._piece_priority_lock = threading.RLock()
        runtime._boosted_pieces = set()
        runtime._reannounce_lock = threading.Lock()
        runtime._last_reannounce = 0.0
        observed_targets = []
        observed_lock = threading.Lock()

        def map_pieces(self, start, _length):
            return {start}

        def schedule(self, _pieces, _required, _reason=None, **_kwargs):
            return None

        def record_stall(
            self,
            target_piece,
            _blocked_waits,
            _stall_seconds,
        ):
            with observed_lock:
                observed_targets.append(target_piece)

        class FakeStatus:
            has_metadata = True
            total_done = 0
            download_rate = 10_000
            pieces = [False, False]
            num_peers = 2

        class FakeHandle:
            def status(self):
                return FakeStatus()

            def piece_availability(self):
                return [0, 0]

            def have_piece(self, _piece):
                return False

        runtime.map_pieces = MethodType(map_pieces, runtime)
        runtime._schedule_pieces = MethodType(schedule, runtime)
        runtime._force_reannounce_if_stalled = MethodType(
            record_stall,
            runtime,
        )
        runtime.handle = FakeHandle()

        workers = [
            threading.Thread(
                target=runtime.wait_for_range,
                args=(piece, piece),
                kwargs={"timeout": 0.55, "track_position": False},
            )
            for piece in (0, 1)
        ]
        for worker in workers:
            worker.start()
        for worker in workers:
            worker.join(2)

        self.assertEqual(set(observed_targets), {0, 1})
        self.assertGreaterEqual(observed_targets.count(0), 1)
        self.assertGreaterEqual(observed_targets.count(1), 1)

    def test_blocked_range_expands_replan_window_to_cap(self):
        runtime = object.__new__(TorrentRuntime)
        runtime.stop_event = threading.Event()
        runtime.info = None
        runtime.file_index = None
        runtime.file_size = constants.MAX_REPLAN_PREFETCH_BYTES * 2
        runtime.session_id = "torrent-replan-test"
        runtime.last_range_key = None
        runtime._piece_priority_lock = threading.RLock()
        runtime._boosted_pieces = set()
        map_lengths = []

        def map_pieces(self, _start, length):
            map_lengths.append(length)
            return {0} if length <= 1 else {0, 1, 2, 3}

        runtime.map_pieces = MethodType(map_pieces, runtime)

        class FakeStatus:
            has_metadata = True
            total_done = 0
            download_rate = 0
            pieces = [False] * 4

        class FakeHandle:
            def status(self):
                return FakeStatus()

            def piece_availability(self):
                return [0] * 4

            def have_piece(self, _piece):
                return False

            def piece_priority(self, _piece, _priority):
                return None

            def set_piece_deadline(self, _piece, _deadline, _flags):
                return None

        runtime.handle = FakeHandle()
        runtime.wait_for_range(0, 0, timeout=0.7, track_position=False)

        self.assertIn(constants.RANGE_PREFETCH_BYTES, map_lengths)
        self.assertIn(constants.RANGE_PREFETCH_BYTES * 2, map_lengths)
        self.assertIn(constants.MAX_REPLAN_PREFETCH_BYTES, map_lengths)

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

        self.assertEqual(runtime.handle.file_priorities, [[0, 1, 0]])
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
