import re

with open('libtorrent_sidecar.py', 'r') as f:
    content = f.read()

# 1. Remove import subprocess
content = re.sub(r'import subprocess\n', '', content)

# 2. Remove timeout constants
content = re.sub(r'PROBE_WAIT_TIMEOUT = 5\nTRANSCODE_STARTUP_TIMEOUT = 5\nHLS_SEGMENT_DURATION = 2\n', '', content)

# 3. Remove FFmpeg functions and classes
start_pattern = "DIRECT_CONTAINER_FORMATS = "
end_pattern = "class TorrentHttpServer:\n"
start_idx = content.find(start_pattern)
end_idx = content.find(end_pattern)
if start_idx != -1 and end_idx != -1:
    content = content[:start_idx] + content[end_idx:]

# 4. Remove /hls/ route from TorrentHttpHandler
hls_route_pattern = """        # Route: /hls/<sessionId>/<filename>
        if len(parts) == 3 and parts[0] == "hls":
            runtime = self.server.runtime.get(parts[1])
            if runtime and runtime.can_serve_hls():
                runtime.try_cleanup_torrent()
                self.serve_hls_file(runtime, parts[2], head_only)
                return
            self.send_error(404)
            return

"""
content = content.replace(hls_route_pattern, '')

# 5. Remove serve_hls_file and send_hls_response
start_serve = "    def serve_hls_file("
end_log = "    def log_message(self, _format: str, *_args: Any) -> None:"
s_idx = content.find(start_serve)
e_idx = content.find(end_log)
if s_idx != -1 and e_idx != -1:
    content = content[:s_idx] + content[e_idx:]

# 6. TorrentRuntime __init__
init_old = """        self.stream_url = ""
        self.raw_stream_url = ""  # always points to /torrent/ route
        self.stream_type = "pending"
        self.transcoder: Optional[FFmpegTranscoder] = None
        self.hls_dir = ""
        self.transcode_video = False
        self.transcode_audio = True
        self.media_duration: Optional[float] = None
        self.start_time = self._get_requested_start_time()
        self._torrent_cleaned = False"""
init_new = """        self.stream_url = ""
        self.raw_stream_url = ""  # always points to /torrent/ route
        self.stream_type = "pending"
        self.start_time = self._get_requested_start_time()
        self._torrent_cleaned = False"""
content = content.replace(init_old, init_new)

# 7. start and initialize_metadata
start_old = """    def start(self) -> None:
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
            self.metadata_complete.set()"""

start_new = """    def start(self) -> None:
        self.raw_stream_url = self.engine.http_server.register(self)
        self.stream_type = "file"
        self.stream_url = self.raw_stream_url
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
        except Exception as error:
            self.metadata_error = str(error)
        finally:
            self.metadata_complete.set()"""
content = content.replace(start_old, start_new)

# 8. Remove probe_and_start_transcode, seek_transcoder, try_cleanup_torrent, can_serve_hls
probe_start = "    def probe_and_start_transcode(self) -> None:"
session_payload = "    def session_payload(self) -> Dict[str, Any]:"
p_idx = content.find(probe_start)
sp_idx = content.find(session_payload)
if p_idx != -1 and sp_idx != -1:
    content = content[:p_idx] + content[sp_idx:]

# 9. session_payload
sp_old = """            "startAt": self.start_time,
            "duration": self.media_duration,"""
sp_new = """            "startAt": self.start_time,
            "duration": None,"""
content = content.replace(sp_old, sp_new)

# 10. stop
stop_old = """        self.stop_event.set()
        self.engine.http_server.unregister(self.session_id)
        if self.transcoder:
            self.transcoder.stop()
        elif self.hls_dir:
            shutil.rmtree(self.hls_dir, ignore_errors=True)
        if not self._torrent_cleaned:"""
stop_new = """        self.stop_event.set()
        self.engine.http_server.unregister(self.session_id)
        if not self._torrent_cleaned:"""
content = content.replace(stop_old, stop_new)

# 11. current_status
cs_old = """        stream_error = self.metadata_error or (
            self.transcoder.error if self.transcoder else None
        )"""
cs_new = """        stream_error = self.metadata_error"""
content = content.replace(cs_old, cs_new)

cs2_old = """            "startAt": self.start_time,
            "duration": self.media_duration,"""
cs2_new = """            "startAt": self.start_time,
            "duration": None,"""
content = content.replace(cs2_old, cs2_new)

with open('libtorrent_sidecar.py', 'w') as f:
    f.write(content)

print("libtorrent_sidecar.py done.")

with open('test_sidecar.py', 'r') as f:
    test_content = f.read()

# Remove test cases from SidecarStreamTest except test_waits_for_file_created_after_metadata
start_probe_tests = "    def test_probe_transcodes_incompatible_audio(self):"
end_probe_tests = "class SidecarStorageTest(unittest.TestCase):"
p_test_idx = test_content.find(start_probe_tests)
p_end_idx = test_content.find(end_probe_tests)
if p_test_idx != -1 and p_end_idx != -1:
    test_content = test_content[:p_test_idx] + test_content[p_end_idx:]

with open('test_sidecar.py', 'w') as f:
    f.write(test_content)

print("test_sidecar.py done.")
