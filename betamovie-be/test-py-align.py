import urllib.request
import json

req = urllib.request.Request("http://localhost:3200/v1/transcribe-windows", method="POST", headers={"Content-Type": "application/json"})
data = json.dumps({
    "sourceUrl": "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
    "subtitleVtt": "WEBVTT\n\n1\n00:00:00.000 --> 00:00:05.000\nTest subtitle",
    "windows": [{"startMs": 0, "durationMs": 60000}]
}).encode('utf-8')

with urllib.request.urlopen(req, data=data) as response:
    print("Status:", response.status)
    while True:
        line = response.readline()
        if not line:
            break
        print("CHUNK:", line.decode('utf-8').strip())
