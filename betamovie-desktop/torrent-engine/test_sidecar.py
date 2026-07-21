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


if __name__ == "__main__":
    unittest.main()
