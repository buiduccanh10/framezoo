#!/usr/bin/env python3
"""Functional test: first download persists .torrent + resume.dat; replay is fast."""
import os
import shutil
import sys
import tempfile
import time
import threading
from pathlib import Path
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).parent))

import libtorrent as lt

from torrent_engine import LibtorrentEngine
from torrent_utils import get_torrent_cache_key

SEED_DIR = None
FILESIZE = 8 * 1024 * 1024


def make_torrent(tmp: Path) -> str:
    fs = lt.file_storage()
    global SEED_DIR
    SEED_DIR = tmp / "seed"
    SEED_DIR.mkdir(parents=True, exist_ok=True)
    data_path = SEED_DIR / "episode.mkv"
    data_path.write_bytes(os.urandom(FILESIZE))
    lt.add_files(fs, str(data_path))
    t = lt.create_torrent(fs)
    t.add_tracker("udp://tracker.openbittorrent.com:80/announce")
    lt.set_piece_hashes(t, str(SEED_DIR))
    entry = t.generate()
    torrent_file = tmp / "source.torrent"
    torrent_file.write_bytes(lt.bencode(entry))
    return str(torrent_file)


def seed_forever(torrent_path: str, listen_port: int = 6889):
    ses = lt.session({"listen_interfaces": f"0.0.0.0:{listen_port}", "enable_dht": False})
    h = ses.add_torrent(
        {"save_path": str(SEED_DIR), "ti": lt.torrent_info(torrent_path)}
    )
    while True:
        ses.pop_alerts()
        time.sleep(0.3)


def bytes_for_hashing(_infohash_upper: str) -> bytes:
    pass


def main():
    root = Path(tempfile.mkdtemp(prefix="faststart-"))
    print("root:", root)
    torrent_path = make_torrent(root)
    ih = lt.torrent_info(torrent_path).info_hash()
    request = {
        "url": "magnet:?xt=urn:btih:" + ih.to_bytes().hex(),
        "infoHash": str(ih),
        "fileName": "episode.mkv",
        "sourceId": "test",
    }

    threading.Thread(target=seed_forever, args=(torrent_path,), daemon=True).start()

    engine = LibtorrentEngine()
    cache_key = get_torrent_cache_key(request)
    data_root = Path(os.environ["FRAMEZOO_TORRENT_DATA_DIR"])
    cache_dir = data_root / ("torrent-" + cache_key)
    torrent_path_cached = cache_dir / (cache_key + ".torrent")
    resume_path = cache_dir / "resume.dat"

    # ---- PHASE 1: first download ----
    t0 = time.monotonic()
    engine.start("s1", request)
    print(f"[1] first start returned in {time.monotonic()-t0:.2f}s (magnet; no metadata yet)")
    runtime = engine.sessions["s1"]
    runtime.handle.connect_peer(("127.0.0.1", 6889), 0)
    runtime.wait_for_metadata(30)
    print("[1] metadata_ready in", runtime.elapsed_ms(), "ms")

    deadline = time.time() + 90
    while time.time() < deadline and runtime.current_status()["state"] != "ready":
        time.sleep(0.5)
    status = runtime.current_status()
    print("[1] download state:", status["state"], "progress:", round(status["progress"], 1))
    assert status["state"] == "ready", "first download did not finish"

    print(
        "[1] .torrent persisted:",
        torrent_path_cached.exists(),
        "| resume.dat pending period.",
    )

    engine.stop("s1")
    print("[1] resume.dat written on stop:", resume_path.exists(), "size:", resume_path.stat().st_size if resume_path.exists() else 0)
    assert resume_path.exists(), "resume.dat not written on stop"

    # ---- PHASE 2: replay ----
    t0 = time.monotonic()
    engine.start("s2", request)
    dt = time.monotonic() - t0
    print(f"[2] replay start returned in {dt:.2f}s")
    runtime2 = engine.sessions["s2"]
    st = runtime2.handle.status()
    print("[2] replay torrent state:", st.state, "(3=downloading, no full-check)")

    t0 = time.monotonic()
    runtime2.wait_for_metadata(5)
    print(f"[2] metadata_ready in {runtime2.elapsed_ms()}ms  (should be near-instant)")
    assert runtime2.metadata_ready.is_set()

    first_range_start = min(1024 * 1024, max(1, runtime2.file_size - 1))
    deadline = time.time() + 15
    while time.time() < deadline and not runtime2.range_is_ready(0, first_range_start):
        time.sleep(0.1)
    ready_ms = (time.monotonic() - t0) * 1000
    print(f"[2] first range ready in {ready_ms:.0f}ms (should be near-instant, no re-check no DHT)")
    assert runtime2.range_is_ready(0, first_range_start), "pieces not available instantly on replay"

    range_request = Request(
        runtime2.stream_url,
        headers={"Range": "bytes=0-1023"},
    )
    with urlopen(range_request, timeout=10) as response:
        body = response.read()
        print(
            "[2] HTTP range:",
            response.status,
            response.headers.get("Content-Range"),
            "bytes:",
            len(body),
        )
        assert response.status == 206
        assert response.headers.get("Content-Range", "").startswith(
            "bytes 0-1023/",
        )
        assert len(body) == 1024

    engine.stop("s2")
    engine.close()
    shutil.rmtree(root)
    print("PASS")


if __name__ == "__main__":
    main()
