import os
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import MethodType

sys.path.insert(0, str(Path(__file__).parent))

import libtorrent_sidecar as sidecar


class SidecarStreamTest(unittest.TestCase):
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
