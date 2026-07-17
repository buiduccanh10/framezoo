import time
import subprocess

start = time.time()
subprocess.run([
    "ffmpeg", "-hide_banner", "-loglevel", "error",
    "-protocol_whitelist", "file,http,https,tcp,tls,crypto,data",
    "-allowed_extensions", "ALL", "-extension_picky", "0", "-f", "hls",
    "-i", "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
    "-ss", "60", "-t", "60", "-vn", "-ac", "1", "-ar", "16000",
    "-f", "wav", "test.wav"
], check=True)
print(f"Extract took: {time.time() - start:.2f}s")

from faster_whisper import WhisperModel
model = WhisperModel("small", compute_type="int8", cpu_threads=4)
start = time.time()
segments, _ = model.transcribe("test.wav", beam_size=5, word_timestamps=True, vad_filter=True, condition_on_previous_text=False)
for s in segments:
    print(f"Segment: {s.start}-{s.end}")
print(f"Transcribe took: {time.time() - start:.2f}s")
