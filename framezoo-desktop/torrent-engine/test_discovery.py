import sys
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))

import libtorrent as lt

import torrent_discovery as discovery


class TrackerResponseTest(unittest.TestCase):
    def test_http_announce_omits_left_when_metadata_is_unknown(self):
        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self, _limit):
                return lt.bencode({b"peers": b""})

        request_url = None

        def fake_urlopen(request, timeout):
            nonlocal request_url
            request_url = request.full_url
            self.assertEqual(timeout, 5)
            return FakeResponse()

        with patch.object(discovery, "urlopen", side_effect=fake_urlopen):
            result = discovery.announce_http_tracker(
                "http://tracker.example/announce",
                bytes.fromhex("00" * 20),
                b"-FZ0001-" + b"0" * 12,
                6881,
                left=None,
            )

        self.assertIsNone(result.error)
        self.assertIsNotNone(request_url)
        self.assertNotIn("left=", request_url)
        self.assertLess(
            request_url.index("numwant="),
            request_url.index("info_hash="),
        )
        self.assertLess(
            request_url.index("info_hash="),
            request_url.index("peer_id="),
        )

    def test_binary_tracker_query_escapes_reserved_bytes(self):
        query = discovery._append_binary_query(
            "http://tracker.example/announce",
            "info_hash",
            b"\x00/\xff",
        )
        self.assertIn("info_hash=%00%2F%FF", query)

    def test_parses_compact_ipv4_ipv6_and_dictionary_peers(self):
        ipv4 = bytes([127, 0, 0, 1]) + (6881).to_bytes(2, "big")
        ipv6 = bytes.fromhex("20010db8000000000000000000000001") + (
            51413
        ).to_bytes(2, "big")
        compact_payload = lt.bencode(
            {
                b"peers": ipv4,
                b"peers6": ipv6,
            },
        )
        self.assertEqual(
            discovery.parse_tracker_response(compact_payload),
            (
                discovery.PeerAddress("127.0.0.1", 6881),
                discovery.PeerAddress("2001:db8::1", 51413),
            ),
        )

        dictionary_payload = lt.bencode(
            {
                b"peers": [
                    {
                        b"ip": b"127.0.0.1",
                        b"port": 6881,
                    },
                ],
            },
        )
        self.assertEqual(
            discovery.parse_tracker_response(dictionary_payload),
            (discovery.PeerAddress("127.0.0.1", 6881),),
        )

    def test_raises_tracker_failure_reason(self):
        payload = lt.bencode({b"failure reason": b"temporarily unavailable"})
        with self.assertRaisesRegex(ValueError, "temporarily unavailable"):
            discovery.parse_tracker_response(payload)

    def test_normalizes_tracker_sources_and_deduplicates(self):
        self.assertEqual(
            discovery.normalize_trackers(
                [
                    "tracker:http://tracker.example/announce",
                    "http://tracker.example/announce/",
                    "dht:abcdef",
                    "udp://tracker.example:6969/announce",
                    "file:///tmp/source",
                ],
            ),
            [
                "http://tracker.example/announce",
                "udp://tracker.example:6969/announce",
            ],
        )


class TorrentDiscoveryTest(unittest.TestCase):
    def test_slow_tracker_does_not_hide_fast_tracker_result(self):
        fast_peer = discovery.PeerAddress("127.0.0.1", 6881)
        slow_started = threading.Event()
        release_slow = threading.Event()

        class FakeHandle:
            def __init__(self):
                self.connected = []

            def status(self):
                return SimpleNamespace(total_done=0, total_wanted=100)

            def connect_peer(self, address, _source):
                self.connected.append(address)

            def force_dht_announce(self):
                return None

        class FakeSession:
            def dht_get_peers(self, _info_hash):
                return None

        runtime = discovery.TorrentDiscovery(
            FakeSession(),
            FakeHandle(),
            lt.sha1_hash(bytes.fromhex("02" * 20)),
            [
                "http://slow.example/announce",
                "http://fast.example/announce",
            ],
            b"-FZ0001-" + b"0" * 12,
            6881,
        )

        def announce(tracker, *_args, **_kwargs):
            if "slow" in tracker:
                slow_started.set()
                release_slow.wait(1)
                return discovery.TrackerResult(tracker, ())
            return discovery.TrackerResult(tracker, (fast_peer,))

        with patch.object(discovery, "announce_http_tracker", side_effect=announce):
            cycle = threading.Thread(target=runtime._run_cycle)
            cycle.start()
            self.assertTrue(slow_started.wait(1))
            deadline = time.monotonic() + 1
            while not runtime.handle.connected and time.monotonic() < deadline:
                time.sleep(0.01)
            release_slow.set()
            cycle.join(2)

        self.assertEqual(runtime.handle.connected, [("127.0.0.1", 6881)])

    def test_stop_marks_discovery_stopped_and_cleans_worker(self):
        runtime = discovery.TorrentDiscovery(
            SimpleNamespace(),
            SimpleNamespace(),
            lt.sha1_hash(bytes.fromhex("03" * 20)),
            [],
            b"-FZ0001-" + b"0" * 12,
            6881,
        )
        with patch.object(
            discovery.constants,
            "DISCOVERY_BACKOFF_SECONDS",
            (0.0, 0.01),
        ):
            runtime.start()
            time.sleep(0.02)
            runtime.stop()

        self.assertFalse(runtime.thread.is_alive())
        self.assertEqual(runtime.snapshot()["discoveryPhase"], "stopped")

    def test_cycle_queries_http_trackers_and_injects_unique_peers(self):
        peer = discovery.PeerAddress("127.0.0.1", 6881)
        second_peer = discovery.PeerAddress("127.0.0.2", 6882)
        results = {
            "http://one.example/announce": discovery.TrackerResult(
                "http://one.example/announce",
                (peer, second_peer),
            ),
            "http://two.example/announce": discovery.TrackerResult(
                "http://two.example/announce",
                (peer,),
            ),
        }

        class FakeHandle:
            def __init__(self):
                self.connected = []
                self.dht_announces = 0

            def status(self):
                return SimpleNamespace(total_done=0, total_wanted=100)

            def connect_peer(self, address, _source):
                self.connected.append(address)

            def force_dht_announce(self):
                self.dht_announces += 1

        class FakeSession:
            def dht_get_peers(self, _info_hash):
                return None

        handle = FakeHandle()
        info_hash = lt.sha1_hash(bytes.fromhex("00" * 20))
        runtime = discovery.TorrentDiscovery(
            FakeSession(),
            handle,
            info_hash,
            results.keys(),
            b"-FZ0001-" + b"0" * 12,
            6881,
        )

        def announce(tracker, *_args, **_kwargs):
            return results[tracker]

        with patch.object(discovery, "announce_http_tracker", side_effect=announce):
            runtime._run_cycle()

        self.assertEqual(
            handle.connected,
            [("127.0.0.1", 6881), ("127.0.0.2", 6882)],
        )
        self.assertEqual(runtime.snapshot()["trackersAttempted"], 2)
        self.assertEqual(runtime.snapshot()["trackersSucceeded"], 2)
        self.assertEqual(runtime.snapshot()["peersDiscovered"], 2)
        self.assertEqual(runtime.snapshot()["peersInjected"], 2)
        self.assertEqual(handle.dht_announces, 1)

    def test_tracker_failure_does_not_abort_cycle(self):
        class FakeHandle:
            def status(self):
                return SimpleNamespace(total_done=0, total_wanted=100)

            def force_dht_announce(self):
                return None

        class FakeSession:
            def dht_get_peers(self, _info_hash):
                return None

        runtime = discovery.TorrentDiscovery(
            FakeSession(),
            FakeHandle(),
            lt.sha1_hash(bytes.fromhex("01" * 20)),
            ["http://broken.example/announce"],
            b"-FZ0001-" + b"0" * 12,
            6881,
        )
        with patch.object(
            discovery,
            "announce_http_tracker",
            return_value=discovery.TrackerResult(
                "http://broken.example/announce",
                (),
                "connection refused",
            ),
        ):
            runtime._run_cycle()

        snapshot = runtime.snapshot()
        self.assertEqual(snapshot["trackersAttempted"], 1)
        self.assertEqual(snapshot["peersInjected"], 0)
        self.assertEqual(snapshot["lastDiscoveryError"], "connection refused")


    def test_retries_stale_peer_after_cooldown_without_increasing_unique_count(self):
        peer = discovery.PeerAddress("127.0.0.1", 6881)

        class FakeHandle:
            def __init__(self):
                self.connected = []

            def connect_peer(self, address, _source):
                self.connected.append(address)

        runtime = discovery.TorrentDiscovery(
            SimpleNamespace(),
            FakeHandle(),
            lt.sha1_hash(bytes.fromhex("04" * 20)),
            [],
            b"-FZ0001-" + b"0" * 12,
            6881,
        )

        with patch.object(
            discovery.time,
            "monotonic",
            side_effect=(100.0, 100.0, 106.0),
        ):
            runtime._inject_peers([peer])
            runtime._inject_peers([peer])
            runtime._inject_peers([peer])

        self.assertEqual(
            runtime.handle.connected,
            [("127.0.0.1", 6881), ("127.0.0.1", 6881)],
        )
        self.assertEqual(runtime.snapshot()["peersDiscovered"], 1)
        self.assertEqual(runtime.snapshot()["peersInjected"], 1)

    def test_peer_rotation_retries_known_and_new_peers(self):
        first = discovery.PeerAddress("127.0.0.1", 6881)
        second = discovery.PeerAddress("127.0.0.2", 6882)

        class FakeHandle:
            def __init__(self):
                self.connected = []

            def connect_peer(self, address, _source):
                self.connected.append(address)

        runtime = discovery.TorrentDiscovery(
            SimpleNamespace(),
            FakeHandle(),
            lt.sha1_hash(bytes.fromhex("05" * 20)),
            [],
            b"-FZ0001-" + b"0" * 12,
            6881,
        )

        with patch.object(discovery.constants, "DISCOVERY_MAX_PEERS", 1):
            with patch.object(
                discovery.time,
                "monotonic",
                side_effect=(200.0, 200.0, 206.0),
            ):
                runtime._inject_peers([first])
                runtime._inject_peers([second])
                runtime._inject_peers([first])

        self.assertEqual(
            runtime.handle.connected,
            [
                ("127.0.0.1", 6881),
                ("127.0.0.2", 6882),
                ("127.0.0.1", 6881),
            ],
        )
        self.assertEqual(runtime.snapshot()["peersDiscovered"], 2)
        self.assertEqual(runtime.snapshot()["peersInjected"], 2)

if __name__ == "__main__":
    unittest.main()
