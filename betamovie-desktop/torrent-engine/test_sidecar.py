import os
import sys
import tempfile
import threading
import time
import unittest
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

    def test_probe_transcodes_incompatible_audio(self):
        result = type(
            "ProbeResult",
            (),
            {
                "returncode": 0,
                "stdout": (
                    '{"format":{"duration":"42.5","format_name":"matroska"},'
                    '"streams":['
                    '{"codec_type":"video","codec_name":"h264",'
                    '"pix_fmt":"yuv420p"},'
                    '{"codec_type":"audio","codec_name":"eac3"}]}'
                ),
            },
        )()

        with patch.dict(sidecar.os.environ, {"FORCE_DIRECT_PLAY": "0"}):
            with patch.object(sidecar.subprocess, "run", return_value=result):
                probe = sidecar.probe_file_info("episode.mkv")

        self.assertFalse(probe.direct_playable)
        self.assertFalse(probe.transcode_video)
        self.assertTrue(probe.transcode_audio)
        self.assertEqual(probe.audio_codec, "eac3")
        self.assertEqual(probe.duration, 42.5)

    def test_probe_allows_direct_mp4(self):
        result = type(
            "ProbeResult",
            (),
            {
                "returncode": 0,
                "stdout": (
                    '{"format":{"duration":"42.5",'
                    '"format_name":"mov,mp4,m4a,3gp,3g2,mj2"},'
                    '"streams":['
                    '{"codec_type":"video","codec_name":"h264",'
                    '"pix_fmt":"yuv420p"},'
                    '{"codec_type":"audio","codec_name":"aac"}]}'
                ),
            },
        )()

        with patch.dict(sidecar.os.environ, {"FORCE_DIRECT_PLAY": "0"}):
            with patch.object(sidecar.subprocess, "run", return_value=result):
                probe = sidecar.probe_file_info("episode.mp4")

        self.assertTrue(probe.direct_playable)
        self.assertFalse(probe.transcode_video)
        self.assertFalse(probe.transcode_audio)
        self.assertEqual(probe.video_codec, "h264")
        self.assertEqual(probe.duration, 42.5)

    def test_probe_transcodes_unsupported_video_even_with_aac(self):
        result = type(
            "ProbeResult",
            (),
            {
                "returncode": 0,
                "stdout": (
                    '{"format":{"format_name":"mov,mp4,m4a,3gp,3g2,mj2"},'
                    '"streams":['
                    '{"codec_type":"video","codec_name":"hevc",'
                    '"pix_fmt":"yuv420p10le"},'
                    '{"codec_type":"audio","codec_name":"aac"}]}'
                ),
            },
        )()

        with patch.dict(sidecar.os.environ, {"FORCE_DIRECT_PLAY": "0"}):
            with patch.object(sidecar.subprocess, "run", return_value=result):
                probe = sidecar.probe_file_info("episode.mp4")

        self.assertFalse(probe.direct_playable)
        self.assertTrue(probe.transcode_video)
        self.assertFalse(probe.transcode_audio)

    def test_probe_force_direct_play(self):
        result = type(
            "ProbeResult",
            (),
            {
                "returncode": 0,
                "stdout": (
                    '{"format":{"format_name":"matroska"},'
                    '"streams":['
                    '{"codec_type":"video","codec_name":"hevc",'
                    '"pix_fmt":"yuv420p10le"},'
                    '{"codec_type":"audio","codec_name":"eac3"}]}'
                ),
            },
        )()

        with patch.dict(sidecar.os.environ, {"FORCE_DIRECT_PLAY": "1"}):
            with patch.object(sidecar.subprocess, "run", return_value=result):
                probe = sidecar.probe_file_info("episode.mkv")

        self.assertTrue(probe.direct_playable)
        self.assertFalse(probe.transcode_video)
        self.assertFalse(probe.transcode_audio)

    def test_transcoder_builds_audio_transcode_hls_command(self):
        transcoder = sidecar.FFmpegTranscoder(
            session_id="session-1",
            input_url="http://127.0.0.1/torrent/session-1",
            hls_dir="/tmp/betamovie-hls",
            start_time=8,
        )

        with patch.object(sidecar.subprocess, "Popen") as popen:
            with patch.object(
                sidecar.FFmpegTranscoder,
                "_monitor",
                return_value=None,
            ):
                transcoder.start()

        command = popen.call_args.args[0]
        self.assertEqual(command[0], sidecar.get_ffmpeg_path())
        self.assertIn("-ss", command)
        self.assertIn("8", command)
        self.assertIn("-c:v", command)
        self.assertIn("copy", command)
        self.assertIn("-c:a", command)
        self.assertIn("aac", command)
        self.assertIn("-hls_time", command)
        self.assertIn(str(sidecar.HLS_SEGMENT_DURATION), command)
        self.assertIn("-f", command)
        self.assertIn("hls", command)
        self.assertEqual(command[-1], "/tmp/betamovie-hls/live.m3u8")

    def test_runtime_starts_transcoder_at_resume_position(self):
        runtime = object.__new__(sidecar.TorrentRuntime)
        runtime.session_id = "session-1"
        runtime.request = {"startAt": 120.5}
        runtime.engine = SimpleNamespace(
            http_server=SimpleNamespace(base_url="http://127.0.0.1:1234"),
        )
        runtime.save_path = "/tmp"
        runtime.file_path = "episode.mkv"
        runtime.raw_stream_url = "http://127.0.0.1:1234/torrent/session-1"
        runtime.media_duration = None
        runtime.hls_dir = ""
        runtime.transcoder = None
        runtime.stream_type = "pending"
        runtime.transcode_video = False
        runtime.stop_event = threading.Event()
        runtime._torrent_cleaned = False
        runtime.start_time = runtime._get_requested_start_time()

        with patch.object(
            sidecar,
            "probe_file_info",
            return_value=sidecar.MediaProbe(
                available=True,
                duration=300.0,
                format_name="matroska",
                video_codec="h264",
                video_pixel_format="yuv420p",
                audio_codec="eac3",
                direct_playable=False,
                transcode_video=False,
                transcode_audio=True,
            ),
        ):
            with patch.object(sidecar, "FFmpegTranscoder") as transcoder_type:
                transcoder = transcoder_type.return_value
                transcoder.error = None
                transcoder.wait_for_ready.return_value = True
                runtime.probe_and_start_transcode()

        self.assertEqual(
            transcoder_type.call_args.kwargs["start_time"],
            120.5,
        )
        self.assertEqual(runtime.start_time, 120.5)

    def test_runtime_clamps_resume_position_to_duration(self):
        runtime = object.__new__(sidecar.TorrentRuntime)
        runtime.session_id = "session-1"
        runtime.request = {"startAt": 999}
        runtime.engine = SimpleNamespace(
            http_server=SimpleNamespace(base_url="http://127.0.0.1:1234"),
        )
        runtime.save_path = "/tmp"
        runtime.file_path = "episode.mkv"
        runtime.raw_stream_url = "http://127.0.0.1:1234/torrent/session-1"
        runtime.media_duration = None
        runtime.hls_dir = ""
        runtime.transcoder = None
        runtime.stream_type = "pending"
        runtime.transcode_video = False
        runtime.stop_event = threading.Event()
        runtime._torrent_cleaned = False
        runtime.start_time = runtime._get_requested_start_time()

        with patch.object(
            sidecar,
            "probe_file_info",
            return_value=sidecar.MediaProbe(
                available=True,
                duration=300.0,
                format_name="matroska",
                video_codec="h264",
                video_pixel_format="yuv420p",
                audio_codec="eac3",
                direct_playable=False,
                transcode_video=False,
                transcode_audio=True,
            ),
        ):
            with patch.object(sidecar, "FFmpegTranscoder") as transcoder_type:
                transcoder = transcoder_type.return_value
                transcoder.error = None
                transcoder.wait_for_ready.return_value = True
                runtime.probe_and_start_transcode()

        self.assertEqual(runtime.start_time, 299.0)
        self.assertEqual(
            transcoder_type.call_args.kwargs["start_time"],
            299.0,
        )


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
