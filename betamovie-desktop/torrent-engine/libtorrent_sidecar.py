#!/usr/bin/env python3
"""JSON-lines libtorrent sidecar used by the Electron main process."""

from __future__ import annotations

import glob
import json
import math
import mimetypes
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import warnings
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib.parse import urlparse

warnings.filterwarnings("ignore", category=DeprecationWarning)

import libtorrent as lt


OUTPUT_LOCK = threading.Lock()
VIDEO_EXTENSIONS = (".avi", ".m4v", ".mkv", ".mov", ".mp4", ".webm")
STREAM_CHUNK_SIZE = 1024 * 1024
RANGE_WAIT_TIMEOUT = 90
PROBE_WAIT_TIMEOUT = 5
TRANSCODE_STARTUP_TIMEOUT = 5
HLS_SEGMENT_DURATION = 2
RANGE_RETRY_INTERVAL = 0.2
FILE_OPEN_RETRY_INTERVAL = 0.2


def emit(message: Dict[str, Any]) -> None:
    with OUTPUT_LOCK:
        sys.stdout.write(json.dumps(message, separators=(",", ":")) + "\n")
        sys.stdout.flush()

def get_local_cors_origin(handler: BaseHTTPRequestHandler) -> Optional[str]:
    origin = handler.headers.get("Origin")
    if not origin:
        return None
    if origin == "null":
        return origin

    try:
        parsed = urlparse(origin)
    except ValueError:
        return None

    if parsed.scheme not in ("http", "https"):
        return None
    if parsed.hostname not in ("localhost", "127.0.0.1", "::1"):
        return None
    return origin

def write_cors_headers(handler: BaseHTTPRequestHandler) -> None:
    origin = get_local_cors_origin(handler)
    if origin:
        handler.send_header("Access-Control-Allow-Origin", origin)
        handler.send_header("Access-Control-Allow-Credentials", "true")
        handler.send_header("Vary", "Origin")
    handler.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
    handler.send_header(
        "Access-Control-Allow-Headers",
        "Range, Content-Type, Accept, Origin",
    )
    handler.send_header(
        "Access-Control-Expose-Headers",
        "Accept-Ranges, Content-Length, Content-Range",
    )


def normalized_info_hash(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    value = value.strip()
    if value.lower().startswith("urn:btih:"):
        value = value[9:]
    return value.lower() or None


def get_magnet(request: Dict[str, Any]) -> str:
    url = request.get("url")
    if isinstance(url, str) and url.strip().lower().startswith("magnet:"):
        return url.strip()

    info_hash = normalized_info_hash(request.get("infoHash"))
    if info_hash:
        return "magnet:?xt=urn:btih:" + info_hash

    raise ValueError("torrent request requires a magnet URL or infoHash")


def safe_file_name(value: str) -> str:
    return value.replace("\\", "/").rsplit("/", 1)[-1].lower()


def select_file(info: Any, request: Dict[str, Any]) -> Tuple[int, str, int]:
    files = info.files()
    entries = [
        (index, str(files.file_path(index)), int(files.file_size(index)))
        for index in range(files.num_files())
    ]
    entries = [entry for entry in entries if entry[2] > 0]
    if not entries:
        raise ValueError("torrent contains no non-empty files")

    requested_index = request.get("fileIdx")
    if isinstance(requested_index, int):
        for index, path, size in entries:
            if index == requested_index:
                return index, path, size

    requested_name = request.get("fileName")
    if isinstance(requested_name, str) and requested_name.strip():
        wanted = safe_file_name(requested_name)
        for index, path, size in entries:
            if safe_file_name(path) == wanted:
                return index, path, size

    video_entries = [
        entry
        for entry in entries
        if safe_file_name(entry[1]).endswith(VIDEO_EXTENSIONS)
    ]
    return max(video_entries or entries, key=lambda entry: entry[2])


def torrent_hash(info: Any, fallback: Any) -> Optional[str]:
    value = normalized_info_hash(fallback)
    if value:
        return value
    try:
        return str(info.info_hash()).lower()
    except Exception:
        return None


DIRECT_CONTAINER_FORMATS = {"mov", "mp4"}
DIRECT_VIDEO_CODECS = {"h264"}
DIRECT_VIDEO_PIXEL_FORMATS = {"yuv420p", "yuvj420p", "nv12"}
DIRECT_AUDIO_CODECS = {"aac", "mp3"}


def get_ffmpeg_path() -> str:
    return os.environ.get("FFMPEG_PATH", "ffmpeg")


def get_ffprobe_path() -> str:
    return os.environ.get("FFPROBE_PATH", "ffprobe")


@dataclass(frozen=True)
class MediaProbe:
    available: bool
    duration: Optional[float]
    format_name: str
    video_codec: Optional[str]
    video_pixel_format: Optional[str]
    audio_codec: Optional[str]
    direct_playable: bool
    transcode_video: bool
    transcode_audio: bool


def unavailable_media_probe() -> MediaProbe:
    return MediaProbe(
        available=False,
        duration=None,
        format_name="",
        video_codec=None,
        video_pixel_format=None,
        audio_codec=None,
        direct_playable=False,
        transcode_video=True,
        transcode_audio=True,
    )


def probe_file_info(input_path: str) -> MediaProbe:
    """Probe container/codecs before choosing direct playback or HLS."""
    ffprobe = get_ffprobe_path()
    try:
        result = subprocess.run(
            [
                ffprobe,
                "-v", "quiet",
                "-probesize", "2M",
                "-analyzeduration", "2M",
                "-print_format", "json",
                "-show_format",
                "-show_streams",
                input_path,
            ],
            capture_output=True,
            text=True,
            timeout=PROBE_WAIT_TIMEOUT,
        )
        if result.returncode != 0:
            return unavailable_media_probe()
        info = json.loads(result.stdout)
        duration: Optional[float] = None
        duration_str = info.get("format", {}).get("duration")
        if duration_str:
            try:
                duration = float(duration_str)
            except ValueError:
                pass

        streams = info.get("streams", [])
        if not duration:
            for s in streams:
                d = s.get("duration")
                if d:
                    try:
                        duration = float(d)
                        break
                    except ValueError:
                        pass

        video_stream = next(
            (stream for stream in streams if stream.get("codec_type") == "video"),
            None,
        )
        audio_stream = next(
            (stream for stream in streams if stream.get("codec_type") == "audio"),
            None,
        )
        format_name = str(info.get("format", {}).get("format_name") or "").lower()
        format_tokens = set(format_name.split(","))
        video_codec = (
            str(video_stream.get("codec_name") or "").lower()
            if video_stream
            else None
        )
        video_pixel_format = (
            str(video_stream.get("pix_fmt") or "").lower()
            if video_stream
            else None
        )
        audio_codec = (
            str(audio_stream.get("codec_name") or "").lower()
            if audio_stream
            else None
        )
        video_copy_compatible = (
            video_codec in DIRECT_VIDEO_CODECS
            and video_pixel_format in DIRECT_VIDEO_PIXEL_FORMATS
        )
        direct_playable = (
            bool(video_stream)
            and bool(format_tokens & DIRECT_CONTAINER_FORMATS)
            and video_copy_compatible
            and (audio_stream is None or audio_codec in DIRECT_AUDIO_CODECS)
        )

        return MediaProbe(
            available=True,
            duration=duration,
            format_name=format_name,
            video_codec=video_codec,
            video_pixel_format=video_pixel_format,
            audio_codec=audio_codec,
            direct_playable=direct_playable,
            transcode_video=not video_copy_compatible,
            transcode_audio=(
                audio_stream is not None
                and audio_codec not in DIRECT_AUDIO_CODECS
            ),
        )
    except Exception as exc:
        sys.stderr.write(f"[ffprobe] probe failed: {exc}\n")
        sys.stderr.flush()
        return unavailable_media_probe()


def get_max_generated_segment(hls_dir: str) -> int:
    """Find the highest segment index currently written to hls_dir."""
    try:
        ts_files = glob.glob(os.path.join(hls_dir, "seg_*.ts"))
        if not ts_files:
            return -1
        max_idx = -1
        for f in ts_files:
            base = os.path.basename(f)
            try:
                num = int(base.replace("seg_", "").replace(".ts", ""))
                if num > max_idx:
                    max_idx = num
            except ValueError:
                pass
        return max_idx
    except Exception:
        return -1


class FFmpegTranscoder:
    """Runs FFmpeg to produce browser-compatible HLS segments."""

    def __init__(
        self,
        session_id: str,
        input_url: str,
        hls_dir: str,
        start_time: float = 0.0,
        transcode_video: bool = False,
        transcode_audio: bool = True,
    ) -> None:
        self.session_id = session_id
        self.input_url = input_url
        self.hls_dir = hls_dir
        self.start_time = start_time
        self.transcode_video = transcode_video
        self.transcode_audio = transcode_audio
        self.process: Optional[subprocess.Popen] = None
        self.is_ready = threading.Event()
        self.is_finished = False
        self.error: Optional[str] = None
        self._monitor_thread: Optional[threading.Thread] = None

    def start(self) -> None:
        os.makedirs(self.hls_dir, exist_ok=True)
        ffmpeg = get_ffmpeg_path()
        cmd = [
            ffmpeg,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
        ]
        if self.start_time > 0:
            cmd.extend(["-ss", str(int(self.start_time))])
        start_seg = (
            int(self.start_time / HLS_SEGMENT_DURATION)
            if self.start_time > 0
            else 0
        )
        if self.transcode_video:
            video_args = [
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-tune",
                "zerolatency",
                "-pix_fmt",
                "yuv420p",
                "-profile:v",
                "main",
                "-g",
                "48",
                "-keyint_min",
                "48",
                "-sc_threshold",
                "0",
                "-force_key_frames",
                f"expr:gte(t,n_forced*{HLS_SEGMENT_DURATION})",
            ]
        else:
            video_args = ["-c:v", "copy"]
        audio_args = (
            ["-c:a", "aac", "-b:a", "192k", "-ac", "2"]
            if self.transcode_audio
            else ["-c:a", "copy"]
        )
        cmd.extend([
            "-i", self.input_url,
            *video_args,
            *audio_args,
            "-f", "hls",
            "-hls_time", str(HLS_SEGMENT_DURATION),
            "-hls_list_size", "0",
            "-start_number", str(start_seg),
            "-hls_playlist_type", "event",
            "-hls_flags", "append_list+independent_segments",
            "-hls_segment_type", "mpegts",
            "-hls_segment_filename",
            os.path.join(self.hls_dir, "seg_%05d.ts"),
            os.path.join(self.hls_dir, "live.m3u8"),
        ])
        self.process = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        self._monitor_thread = threading.Thread(
            target=self._monitor,
            name="ffmpeg-monitor-" + self.session_id,
            daemon=True,
        )
        self._monitor_thread.start()

    def _monitor(self) -> None:
        """Wait for the first HLS segment, then wait for FFmpeg to finish."""
        playlist = os.path.join(self.hls_dir, "live.m3u8")
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            if (
                os.path.exists(playlist)
                and os.path.getsize(playlist) > 0
            ):
                segments = glob.glob(
                    os.path.join(self.hls_dir, "seg_*.ts"),
                )
                if segments:
                    self.is_ready.set()
                    break
            if self.process and self.process.poll() is not None:
                # FFmpeg exited before producing any segments
                stderr = ""
                if self.process.stderr:
                    stderr = self.process.stderr.read().decode(
                        errors="replace",
                    )
                self.error = f"FFmpeg exited early: {stderr[-500:]}"
                self.is_ready.set()
                self.is_finished = True
                return
            time.sleep(0.3)
        else:
            self.error = "Timed out waiting for FFmpeg first segment"
            self.is_ready.set()
            self.is_finished = True
            return

        # Wait for FFmpeg to complete (whole file transcoded)
        if self.process:
            self.process.wait()
        self.is_finished = True

    def wait_for_ready(self, timeout: float = 90) -> bool:
        return self.is_ready.wait(timeout)

    def stop(self) -> None:
        if self.process and self.process.poll() is None:
            self.process.kill()
            try:
                self.process.wait(timeout=5)
            except Exception:
                pass
        shutil.rmtree(self.hls_dir, ignore_errors=True)


class TorrentHttpServer:
    def __init__(self) -> None:
        self.sessions: Dict[str, "TorrentRuntime"] = {}
        self.lock = threading.RLock()
        self.server = QuietHTTPServer(("127.0.0.1", 0), TorrentHttpHandler)
        self.server.runtime = self  # type: ignore[attr-defined]
        self.thread = threading.Thread(
            target=self.server.serve_forever,
            name="torrent-http",
            daemon=True,
        )
        self.thread.start()
        address = self.server.server_address
        self.base_url = "http://127.0.0.1:%d" % address[1]

    def register(self, runtime: "TorrentRuntime") -> str:
        with self.lock:
            self.sessions[runtime.session_id] = runtime
        return self.base_url + "/torrent/" + runtime.session_id

    def get(self, session_id: str) -> Optional["TorrentRuntime"]:
        with self.lock:
            return self.sessions.get(session_id)

    def unregister(self, session_id: str) -> None:
        with self.lock:
            self.sessions.pop(session_id, None)

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()


class QuietHTTPServer(ThreadingHTTPServer):
    def handle_error(self, request: Any, client_address: Any) -> None:
        import sys
        exc_type, exc_value, _ = sys.exc_info()
        if isinstance(exc_value, (ConnectionResetError, BrokenPipeError)):
            return
        super().handle_error(request, client_address)


class TorrentHttpHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def end_headers(self) -> None:
        write_cors_headers(self)
        super().end_headers()

    def do_GET(self) -> None:
        self.handle_torrent_request(False)

    def do_HEAD(self) -> None:
        self.handle_torrent_request(True)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.end_headers()

    def handle_torrent_request(self, head_only: bool) -> None:
        parts = urlparse(self.path).path.strip("/").split("/")

        # Route: /hls/<sessionId>/<filename>
        if len(parts) == 3 and parts[0] == "hls":
            runtime = self.server.runtime.get(parts[1])
            if runtime and runtime.can_serve_hls():
                runtime.try_cleanup_torrent()
                self.serve_hls_file(runtime, parts[2], head_only)
                return
            self.send_error(404)
            return

        # Route: /torrent/<sessionId>
        runtime = (
            self.server.runtime.get(parts[1])
            if len(parts) == 2 and parts[0] == "torrent"
            else None
        )
        if runtime is None:
            self.send_error(404)
            return
        runtime.serve(self, head_only)

    def serve_hls_file(
        self,
        runtime: "TorrentRuntime",
        filename: str,
        head_only: bool,
    ) -> None:
        """Serve an HLS playlist or segment file."""
        # Sanitize filename to prevent path traversal
        safe_name = os.path.basename(filename)
        file_path = os.path.join(runtime.hls_dir, safe_name)
        if not os.path.isfile(file_path):
            if safe_name == "live.m3u8" and runtime.stream_type in {
                "pending",
                "hls",
            }:
                self.send_hls_response(
                    (
                        "#EXTM3U\n"
                        "#EXT-X-VERSION:3\n"
                        "#EXT-X-TARGETDURATION:2\n"
                        "#EXT-X-MEDIA-SEQUENCE:0\n"
                        "#EXT-X-PLAYLIST-TYPE:EVENT\n"
                    ).encode("utf-8"),
                    head_only,
                )
                return
            if (
                safe_name.endswith(".ts")
                and safe_name.startswith("seg_")
                and runtime.transcoder
            ):
                try:
                    seg_num = int(
                        safe_name.replace("seg_", "").replace(".ts", ""),
                    )
                    max_seg = get_max_generated_segment(runtime.hls_dir)
                    # Only seek if requested segment is far away from current progress.
                    # Nearby pre-fetches (within 30 segments) should NOT kill FFmpeg.
                    is_nearby = max_seg >= 0 and (
                        max_seg - 5 <= seg_num <= max_seg + 30
                    )
                    if not is_nearby:
                        target_time = float(seg_num * HLS_SEGMENT_DURATION)
                        runtime.seek_transcoder(target_time)
                except Exception as err:
                    sys.stderr.write(f"[transcode-seek] error: {err}\n")
                    sys.stderr.flush()

            deadline = time.monotonic() + 20
            while time.monotonic() < deadline and not os.path.isfile(file_path):
                if runtime.stop_event.is_set():
                    break
                time.sleep(0.2)
            if not os.path.isfile(file_path):
                self.send_error(404)
                return

        if safe_name.endswith(".m3u8"):
            content_type = "application/vnd.apple.mpegurl"
            cache_control = "no-cache"
            try:
                # Keep FFmpeg's media sequence/start number. Rebuilding a VOD
                # manifest from zero can seek a resumed stream back to segment 0.
                with open(file_path, "rb") as f:
                    data = f.read()
            except OSError:
                self.send_error(500)
                return
        else:
            content_type = "video/mp2t"
            cache_control = "max-age=3600"
            try:
                with open(file_path, "rb") as f:
                    data = f.read()
            except OSError:
                self.send_error(500)
                return

        self.send_hls_response(
            data,
            head_only,
            content_type=content_type,
            cache_control=cache_control,
        )

    def send_hls_response(
        self,
        data: bytes,
        head_only: bool,
        content_type: str = "application/vnd.apple.mpegurl",
        cache_control: str = "no-cache",
    ) -> None:
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", cache_control)
        self.end_headers()

        if not head_only:
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def log_message(self, _format: str, *_args: Any) -> None:
        return


class TorrentRuntime:
    def __init__(
        self,
        engine: "LibtorrentEngine",
        session_id: str,
        request: Dict[str, Any],
        handle: Any,
        save_path: str,
    ) -> None:
        self.engine = engine
        self.session_id = session_id
        self.request = request
        self.handle = handle
        self.save_path = save_path
        self.info: Any = None
        self.file_index: Optional[int] = None
        self.file_path = ""
        self.file_size = 0
        self.stream_url = ""
        self.raw_stream_url = ""  # always points to /torrent/ route
        self.stream_type = "pending"
        self.transcoder: Optional[FFmpegTranscoder] = None
        self.hls_dir = ""
        self.transcode_video = False
        self.transcode_audio = True
        self.media_duration: Optional[float] = None
        self.start_time = self._get_requested_start_time()
        self._torrent_cleaned = False
        self.stop_event = threading.Event()
        self.metadata_ready = threading.Event()
        self.metadata_complete = threading.Event()
        self.metadata_error: Optional[str] = None
        self.metadata_thread: Optional[threading.Thread] = None
        self.status_thread = threading.Thread(
            target=self.publish_status,
            name="torrent-status-" + session_id,
            daemon=True,
        )

    def _get_requested_start_time(self) -> float:
        value = self.request.get("startAt", 0)
        try:
            value = float(value)
        except (TypeError, ValueError):
            return 0.0
        return max(0.0, value) if math.isfinite(value) else 0.0

    def start(self) -> None:
        self.raw_stream_url = self.engine.http_server.register(self)
        self.stream_url = (
            self.engine.http_server.base_url
            + "/hls/"
            + self.session_id
            + "/live.m3u8"
        )
        self.status_thread.start()
        self.metadata_thread = threading.Thread(
            target=self.initialize_metadata,
            name="torrent-metadata-" + self.session_id,
            daemon=True,
        )
        self.metadata_thread.start()

    def initialize_metadata(self) -> None:
        try:
            self.wait_for_metadata(90)
            self.probe_and_start_transcode()
        except Exception as error:
            self.metadata_error = str(error)
        finally:
            self.metadata_complete.set()

    def wait_for_metadata(self, timeout: float) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline and not self.stop_event.is_set():
            status = self.handle.status()
            if status.has_metadata:
                self.info = self.handle.torrent_file()
                if self.info is None:
                    raise ValueError("libtorrent returned no torrent metadata")
                (
                    self.file_index,
                    self.file_path,
                    self.file_size,
                ) = select_file(self.info, self.request)
                priorities = [0] * self.info.files().num_files()
                priorities[self.file_index] = 7
                self.handle.prioritize_files(priorities)
                self.handle.set_sequential_download(True)
                self.metadata_ready.set()
                return
            time.sleep(0.2)
        raise TimeoutError("timed out waiting for torrent metadata")

    def probe_and_start_transcode(self) -> None:
        """Choose direct playback or start browser-compatible HLS."""
        # Probe quickly. Slow peers must not keep the player on the addon list.
        try:
            self.wait_for_range(
                0,
                2 * 1024 * 1024,
                timeout=PROBE_WAIT_TIMEOUT,
            )
        except Exception:
            pass

        relative_path = self.file_path.replace("\\", "/")
        target_file_path = os.path.abspath(
            os.path.join(self.save_path, relative_path),
        )

        probe = probe_file_info(target_file_path)
        self.media_duration = probe.duration
        if probe.duration and probe.duration > 0:
            self.start_time = min(
                self.start_time,
                max(0.0, probe.duration - 1),
            )

        sys.stderr.write(
            "[probe] "
            + json.dumps(
                {
                    "sessionId": self.session_id,
                    "available": probe.available,
                    "format": probe.format_name,
                    "videoCodec": probe.video_codec,
                    "videoPixelFormat": probe.video_pixel_format,
                    "audioCodec": probe.audio_codec,
                    "decision": (
                        "direct" if probe.direct_playable else "hls"
                    ),
                    "transcodeVideo": probe.transcode_video,
                    "transcodeAudio": probe.transcode_audio,
                },
                separators=(",", ":"),
            )
            + "\n",
        )
        sys.stderr.flush()

        if probe.direct_playable:
            self.stream_type = "file"
            self.stream_url = self.raw_stream_url
            return

        self.transcode_video = probe.transcode_video
        self.transcode_audio = probe.transcode_audio
        self.hls_dir = tempfile.mkdtemp(prefix="betamovie-hls-")
        self.transcoder = FFmpegTranscoder(
            session_id=self.session_id,
            input_url=self.raw_stream_url,
            hls_dir=self.hls_dir,
            start_time=self.start_time,
            transcode_video=self.transcode_video,
            transcode_audio=self.transcode_audio,
        )
        self.stream_type = "hls"
        self.stream_url = (
            self.engine.http_server.base_url
            + "/hls/"
            + self.session_id
            + "/live.m3u8"
        )
        self.transcoder.start()
        self.transcoder.wait_for_ready(timeout=TRANSCODE_STARTUP_TIMEOUT)

        if self.transcoder.error:
            sys.stderr.write(
                f"[transcode] error: {self.transcoder.error}\n",
            )
            sys.stderr.flush()
            self.metadata_error = self.transcoder.error

    def seek_transcoder(self, start_time: float) -> None:
        """Seek FFmpeg transcoder to target start time (in seconds)."""
        with self.engine.lock:
            if self.transcoder:
                self.transcoder.stop()
            self.transcoder = FFmpegTranscoder(
                session_id=self.session_id,
                input_url=self.raw_stream_url,
                hls_dir=self.hls_dir,
                start_time=start_time,
                transcode_video=self.transcode_video,
                transcode_audio=self.transcode_audio,
            )
            self.transcoder.start()
            self.transcoder.wait_for_ready(timeout=15)

    def try_cleanup_torrent(self) -> None:
        """Delete torrent data once FFmpeg has fully consumed the file."""
        if (
            self.transcoder
            and self.transcoder.is_finished
            and not self._torrent_cleaned
        ):
            self._torrent_cleaned = True
            try:
                self.engine.session.remove_torrent(self.handle)
            except Exception:
                pass
            shutil.rmtree(self.save_path, ignore_errors=True)

    def can_serve_hls(self) -> bool:
        return self.stream_type in {"pending", "hls"} and not self.stop_event.is_set()

    def session_payload(self) -> Dict[str, Any]:
        return {
            "sessionId": self.session_id,
            "sourceId": self.request.get("sourceId", ""),
            "streamUrl": self.stream_url,
            "streamType": self.stream_type,
            "startAt": self.start_time,
            "duration": self.media_duration,
            "fileName": (
                self.file_path.rsplit("/", 1)[-1]
                or self.request.get("fileName")
                or None
            ),
            "infoHash": torrent_hash(
                self.info,
                self.request.get("infoHash"),
            ),
        }

    def stop(self) -> None:
        self.stop_event.set()
        self.engine.http_server.unregister(self.session_id)
        if self.transcoder:
            self.transcoder.stop()
        elif self.hls_dir:
            shutil.rmtree(self.hls_dir, ignore_errors=True)
        if not self._torrent_cleaned:
            try:
                self.engine.session.remove_torrent(self.handle)
            except Exception:
                pass
            shutil.rmtree(self.save_path, ignore_errors=True)

    def current_status(self) -> Dict[str, Any]:
        status = self.handle.status()
        file_progress = 0
        if self.file_index is not None:
            try:
                progress = self.handle.file_progress()
                file_progress = int(progress[self.file_index])
            except Exception:
                file_progress = int(getattr(status, "total_done", 0))

        total = self.file_size or None
        progress_value = (
            100.0
            if total and file_progress >= total
            else ((file_progress / total) * 100.0 if total else 0.0)
        )
        stream_error = self.metadata_error or (
            self.transcoder.error if self.transcoder else None
        )
        if stream_error:
            lifecycle = "error"
        elif not status.has_metadata:
            lifecycle = "starting"
        elif total and file_progress >= total:
            lifecycle = "ready"
        elif getattr(status, "download_rate", 0) > 0:
            lifecycle = "downloading"
        else:
            lifecycle = "buffering"

        return {
            "sessionId": self.session_id,
            "sourceId": self.request.get("sourceId", ""),
            "state": lifecycle,
            "progress": progress_value,
            "speedBytesPerSecond": int(getattr(status, "download_rate", 0)),
            "peers": int(getattr(status, "num_peers", 0)),
            "infoHash": torrent_hash(
                self.info,
                self.request.get("infoHash"),
            ),
            "fileName": (
                self.file_path.rsplit("/", 1)[-1]
                or self.request.get("fileName")
                or None
            ),
            "downloadedBytes": file_progress,
            "totalBytes": total,
            "streamType": self.stream_type,
            "streamUrl": self.stream_url or None,
            "startAt": self.start_time,
            "duration": self.media_duration,
            "error": stream_error,
            "updatedAt": int(time.time() * 1000),
        }

    def publish_status(self) -> None:
        while not self.stop_event.is_set():
            try:
                emit({"type": "status", "status": self.current_status()})
            except Exception:
                return
            self.stop_event.wait(0.5)

    def map_pieces(self, start: int, length: int) -> Set[int]:
        if self.info is None or self.file_index is None:
            return set()

        def mapped_piece(offset: int) -> Optional[int]:
            try:
                slices = self.info.map_file(
                    self.file_index,
                    offset,
                    1,
                )
            except Exception:
                return None
            if isinstance(slices, (list, tuple)):
                slices = slices[0] if slices else None
            piece = getattr(slices, "piece", None)
            return piece if isinstance(piece, int) else None

        end = min(self.file_size, start + max(1, length)) - 1
        if end < start:
            return set()

        first_piece = mapped_piece(start)
        last_piece = mapped_piece(end)
        if first_piece is None or last_piece is None:
            return set()
        return set(range(first_piece, last_piece + 1))

    def wait_for_range(
        self,
        start: int,
        end: int,
        timeout: float = RANGE_WAIT_TIMEOUT,
    ) -> bool:
        prefetch_length = max(end - start + 1, 25 * 1024 * 1024)
        required_pieces = self.map_pieces(start, end - start + 1)
        all_pieces = list(self.map_pieces(start, prefetch_length))

        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline and not self.stop_event.is_set():
            missing_required = [
                piece
                for piece in required_pieces
                if not self.handle.have_piece(piece)
            ]
            if not missing_required:
                return True

            for idx, piece in enumerate(all_pieces):
                if not self.handle.have_piece(piece):
                    try:
                        self.handle.set_piece_deadline(
                            piece,
                            idx * 100,
                            lt.deadline_flags_t.alert_when_available,
                        )
                    except Exception:
                        pass
            time.sleep(RANGE_RETRY_INTERVAL)
        return not required_pieces

    def read_range_chunk(
        self,
        stream: Any,
        start: int,
        end: int,
    ) -> Optional[bytes]:
        expected_length = end - start + 1
        deadline = time.monotonic() + RANGE_WAIT_TIMEOUT

        while time.monotonic() < deadline and not self.stop_event.is_set():
            if not self.wait_for_range(start, end):
                return None

            stream.seek(start)
            chunk = stream.read(expected_length)
            if len(chunk) == expected_length:
                return chunk

            # libtorrent can finish a piece before the file descriptor sees
            # the complete range. Retry instead of sending a short 206 body.
            time.sleep(RANGE_RETRY_INTERVAL)

        return None

    def serve(self, handler: BaseHTTPRequestHandler, head_only: bool) -> None:
        if not self.metadata_ready.is_set():
            self.metadata_complete.wait(RANGE_WAIT_TIMEOUT)
        if self.metadata_error:
            handler.send_error(502, self.metadata_error)
            return
        if not self.metadata_ready.is_set() or self.file_index is None:
            handler.send_error(425, "Torrent metadata is not ready")
            return

        total = self.file_size
        range_header = handler.headers.get("Range")
        try:
            byte_range = parse_range(range_header, total)
        except (TypeError, ValueError):
            byte_range = None
        if byte_range is None and range_header:
            handler.send_response(416)
            handler.send_header("Content-Range", "bytes */%d" % total)
            handler.send_header("Connection", "close")
            handler.end_headers()
            return

        if byte_range is None:
            start, end, status_code = 0, max(0, total - 1), 200
        else:
            start, end, status_code = byte_range[0], byte_range[1], 206

        relative_path = self.file_path.replace("\\", "/")
        absolute_path = os.path.abspath(
            os.path.join(self.save_path, relative_path),
        )
        root = os.path.abspath(self.save_path)
        if not absolute_path.startswith(root + os.sep):
            handler.send_error(500, "Invalid torrent file path")
            return

        content_type = (
            mimetypes.guess_type(absolute_path)[0]
            or "application/octet-stream"
        )
        length = max(0, end - start + 1)

        stream = None
        first_chunk: Optional[bytes] = None
        if not head_only and length > 0:
            stream, first_chunk = self.open_first_chunk(
                absolute_path,
                start,
                end,
            )
            if stream is None or first_chunk is None:
                handler.send_error(
                    504,
                    "Torrent file is not ready for the requested range",
                )
                return

        handler.send_response(status_code)
        handler.send_header("Accept-Ranges", "bytes")
        handler.send_header("Content-Type", content_type)
        handler.send_header("Content-Length", str(length))
        if status_code == 206:
            handler.send_header(
                "Content-Range",
                "bytes %d-%d/%d" % (start, end, total),
            )
        handler.end_headers()

        if head_only or length == 0:
            return

        try:
            offset = start
            chunk = first_chunk
            while offset <= end:
                if chunk is None:
                    chunk_end = min(end, offset + STREAM_CHUNK_SIZE - 1)
                    chunk = self.read_range_chunk(stream, offset, chunk_end)
                    if chunk is None:
                        handler.close_connection = True
                        return

                handler.wfile.write(chunk)
                handler.wfile.flush()
                offset += len(chunk)
                chunk = None
        except (BrokenPipeError, ConnectionResetError):
            return
        finally:
            if stream is not None:
                stream.close()

    def open_first_chunk(
        self,
        absolute_path: str,
        start: int,
        end: int,
    ) -> Tuple[Optional[Any], Optional[bytes]]:
        """Wait for libtorrent to create and fill the first requested bytes."""
        chunk_end = min(end, start + STREAM_CHUNK_SIZE - 1)
        deadline = time.monotonic() + RANGE_WAIT_TIMEOUT

        while time.monotonic() < deadline and not self.stop_event.is_set():
            try:
                stream = open(absolute_path, "rb")
            except FileNotFoundError:
                time.sleep(FILE_OPEN_RETRY_INTERVAL)
                continue
            except OSError:
                return None, None

            chunk = self.read_range_chunk(stream, start, chunk_end)
            if chunk is not None:
                return stream, chunk

            stream.close()
            if self.stop_event.is_set():
                break
            time.sleep(FILE_OPEN_RETRY_INTERVAL)

        return None, None


def parse_range(
    value: Optional[str],
    size: int,
) -> Optional[Tuple[int, int]]:
    if not value:
        return None
    if not value.lower().startswith("bytes=") or "," in value:
        return None

    raw_start, raw_end = value[6:].split("-", 1)
    if not raw_start:
        suffix = int(raw_end)
        if suffix <= 0:
            return None
        return max(0, size - suffix), max(0, size - 1)

    start = int(raw_start)
    end = int(raw_end) if raw_end else size - 1
    if start < 0 or start >= size or end < start:
        return None
    return start, min(end, size - 1)


DEFAULT_MAX_TORRENT_BYTES = 5 * 1024 * 1024 * 1024  # 5 GB


def get_torrent_data_dir() -> str:
    env_dir = os.environ.get("BETAMOVIE_TORRENT_DATA_DIR")
    if env_dir:
        os.makedirs(env_dir, exist_ok=True)
        return os.path.abspath(env_dir)
    fallback = (
        os.path.expanduser("~/Library/Application Support/AlphaFlix/torrents")
        if sys.platform == "darwin"
        else os.path.join(tempfile.gettempdir(), "betamovie-torrents")
    )
    os.makedirs(fallback, exist_ok=True)
    return os.path.abspath(fallback)


def get_dir_size(path: str) -> int:
    total = 0
    try:
        for root, _, files in os.walk(path):
            for f in files:
                fp = os.path.join(root, f)
                if not os.path.islink(fp):
                    total += os.path.getsize(fp)
    except Exception:
        pass
    return total


def enforce_storage_limit(
    root_dir: str,
    max_bytes: int = DEFAULT_MAX_TORRENT_BYTES,
    active_paths: Optional[Set[str]] = None,
) -> None:
    if active_paths is None:
        active_paths = set()

    max_bytes_env = os.environ.get("BETAMOVIE_TORRENT_MAX_SIZE_BYTES")
    if max_bytes_env:
        try:
            max_bytes = int(max_bytes_env)
        except ValueError:
            pass

    if not os.path.exists(root_dir):
        return

    candidate_dirs: List[str] = []

    # 1. Directories inside root_dir
    try:
        for entry in os.listdir(root_dir):
            full_path = os.path.join(root_dir, entry)
            if os.path.isdir(full_path):
                candidate_dirs.append(full_path)
    except Exception:
        pass

    # 2. Legacy directories in system tempdir
    temp_dir = tempfile.gettempdir()
    if os.path.abspath(temp_dir) != os.path.abspath(root_dir):
        try:
            for entry in os.listdir(temp_dir):
                if entry.startswith("betamovie-torrent-"):
                    full_path = os.path.join(temp_dir, entry)
                    if os.path.isdir(full_path):
                        candidate_dirs.append(full_path)
        except Exception:
            pass

    norm_active = {os.path.abspath(p) for p in active_paths}

    items: List[Tuple[str, int, float]] = []
    total_size = 0
    for d in candidate_dirs:
        abs_d = os.path.abspath(d)
        size = get_dir_size(abs_d)
        total_size += size
        if abs_d not in norm_active:
            try:
                mtime = os.path.getmtime(abs_d)
            except Exception:
                mtime = 0
            items.append((abs_d, size, mtime))

    if total_size <= max_bytes:
        return

    # Sort inactive folders by mtime ascending (oldest first)
    items.sort(key=lambda x: x[2])

    for abs_d, size, _ in items:
        if total_size <= max_bytes:
            break
        try:
            shutil.rmtree(abs_d, ignore_errors=True)
            total_size -= size
            sys.stderr.write(
                f"[sidecar] Pruned old torrent cache: {abs_d} ({size} bytes)\n"
            )
        except Exception as err:
            sys.stderr.write(f"[sidecar] Failed to prune {abs_d}: {err}\n")


class LibtorrentEngine:
    def __init__(self) -> None:
        self.session = lt.session(
            {
                "listen_interfaces": "0.0.0.0:6881-6891",
                "enable_dht": True,
                "enable_lsd": True,
                "enable_upnp": True,
                "enable_natpmp": True,
            },
        )
        try:
            self.session.start_dht()
        except Exception:
            pass
        self.http_server = TorrentHttpServer()
        self.sessions: Dict[str, TorrentRuntime] = {}
        self.lock = threading.RLock()

        try:
            root = get_torrent_data_dir()
            enforce_storage_limit(root)
        except Exception as err:
            sys.stderr.write(f"[sidecar] Initial storage cleanup error: {err}\n")

    def start(
        self,
        session_id: str,
        request: Dict[str, Any],
    ) -> Dict[str, Any]:
        magnet = get_magnet(request)
        root = get_torrent_data_dir()
        with self.lock:
            active_paths = {r.save_path for r in self.sessions.values()}
        try:
            enforce_storage_limit(root, active_paths=active_paths)
        except Exception as err:
            sys.stderr.write(
                f"[sidecar] Storage limit enforcement error: {err}\n"
            )

        save_path = tempfile.mkdtemp(
            prefix="betamovie-torrent-",
            dir=root,
        )
        params = lt.parse_magnet_uri(magnet)
        params.save_path = save_path
        params.storage_mode = lt.storage_mode_t.storage_mode_sparse
        handle = self.session.add_torrent(params)
        runtime = TorrentRuntime(
            self,
            session_id,
            request,
            handle,
            save_path,
        )
        with self.lock:
            self.sessions[session_id] = runtime
        runtime.start()

        # Return a pending HLS session immediately. Metadata/probe/transcode
        # continue in the runtime thread and publish the final stream choice.
        return runtime.session_payload()

    def stop(self, session_id: str) -> None:
        with self.lock:
            runtime = self.sessions.pop(session_id, None)
        if runtime is not None:
            runtime.stop()

    def close(self) -> None:
        for session_id in list(self.sessions.keys()):
            self.stop(session_id)
        self.http_server.close()


def main() -> None:
    engine = LibtorrentEngine()
    try:
        for line in sys.stdin:
            if not line.strip():
                continue
            message = json.loads(line)
            message_type = message.get("type")
            request_id = message.get("requestId")
            session_id = message.get("sessionId")
            try:
                if message_type == "start":
                    session = engine.start(
                        session_id,
                        message.get("request") or {},
                    )
                    emit(
                        {
                            "type": "response",
                            "requestId": request_id,
                            "ok": True,
                            "session": session,
                        },
                    )
                elif message_type == "stop":
                    engine.stop(session_id)
                    emit(
                        {
                            "type": "response",
                            "requestId": request_id,
                            "ok": True,
                        },
                    )
                else:
                    raise ValueError("unknown torrent sidecar message")
            except Exception as error:
                emit(
                    {
                        "type": "response",
                        "requestId": request_id,
                        "ok": False,
                        "error": str(error),
                    },
                )
    finally:
        engine.close()


if __name__ == "__main__":
    main()
