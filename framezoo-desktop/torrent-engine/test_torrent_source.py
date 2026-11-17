import tempfile
import unittest
from pathlib import Path

import libtorrent as lt

from torrent_engine import LibtorrentEngine


class TorrentSourceTest(unittest.TestCase):
    def test_loads_local_torrent_metadata_without_magnet_exchange(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "episode.mkv").write_bytes(b"episode")
            storage = lt.file_storage()
            storage.add_file("episode.mkv", 7)
            creator = lt.create_torrent(storage)
            lt.set_piece_hashes(creator, str(root))
            source = root / "episode.torrent"
            source.write_bytes(lt.bencode(creator.generate()))

            info = LibtorrentEngine._load_torrent_source({"url": str(source)})

            self.assertIsNotNone(info)
            self.assertEqual(info.info_hash(), lt.torrent_info(str(source)).info_hash())


if __name__ == "__main__":
    unittest.main()
