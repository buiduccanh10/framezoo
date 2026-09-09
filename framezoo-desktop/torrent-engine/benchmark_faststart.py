#!/usr/bin/env python3
"""Compare cold shared-piece startup against Framezoo and Stremio."""

from __future__ import annotations

import http.server
import hashlib
import ipaddress
import json
import os
import shutil
from statistics import median
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).parent))

import libtorrent as lt

from torrent_engine import LibtorrentEngine

PREVIOUS_SIZE = 12 * 1024 * 1024
TARGET_SIZE = 8 * 1024 * 1024
PIECE_LENGTH = 16 * 1024 * 1024
READ_SIZE = 64 * 1024
SEED_RATE = 1024 * 1024
STREMIO_BASE_URL = os.environ.get(
    "STREMIO_ENGINEFS_URL",
    "http://127.0.0.1:11470",
).rstrip("/")
TRIALS = int(os.environ.get("FRAMEZOO_BENCHMARK_TRIALS", "3"))


class TrackerHandler(http.server.BaseHTTPRequestHandler):
    server: "LocalTracker"

    def do_GET(self) -> None:
        if self.path.split("?", 1)[0] != "/announce":
            self.send_error(404)
            return

        peers = bytearray()
        for host, port in self.server.peers:
            peers.extend(ipaddress.ip_address(host).packed)
            peers.extend(int(port).to_bytes(2, "big"))
        body = lt.bencode(
            {
                b"interval": 1,
                b"min interval": 1,
                b"peers": bytes(peers),
            },
        )
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except BrokenPipeError:
            # Clients may close after receiving enough peer information.
            pass

    def log_message(self, *_args: Any) -> None:
        return


class LocalTracker(http.server.ThreadingHTTPServer):
    def __init__(self) -> None:
        super().__init__(("127.0.0.1", 0), TrackerHandler)
        self.peers: list[tuple[str, int]] = []

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.server_port}/announce"


def start_tracker() -> tuple[LocalTracker, threading.Thread]:
    tracker = LocalTracker()
    thread = threading.Thread(
        target=tracker.serve_forever,
        name="benchmark-tracker",
        daemon=True,
    )
    thread.start()
    return tracker, thread


def write_random_file(path: Path, size: int) -> None:
    with path.open("wb") as stream:
        remaining = size
        while remaining:
            chunk_size = min(1024 * 1024, remaining)
            stream.write(os.urandom(chunk_size))
            remaining -= chunk_size


def make_fixture(root: Path, tracker_url: str) -> tuple[Path, str]:
    seed_dir = root / "seed"
    content_dir = seed_dir / "shared-piece-fixture"
    content_dir.mkdir(parents=True)
    write_random_file(content_dir / "previous.bin", PREVIOUS_SIZE)
    write_random_file(content_dir / "episode.mkv", TARGET_SIZE)

    storage = lt.file_storage()
    storage.add_file(
        "shared-piece-fixture/previous.bin",
        PREVIOUS_SIZE,
    )
    storage.add_file(
        "shared-piece-fixture/episode.mkv",
        TARGET_SIZE,
    )
    # The bundled binding fills v1 piece hashes; keep the benchmark fixture
    # v1-only so libtorrent does not reject incomplete hybrid metadata.
    creator = lt.create_torrent(
        storage,
        PIECE_LENGTH,
        64,
    )
    creator.add_tracker(tracker_url)
    lt.set_piece_hashes(creator, str(seed_dir))

    torrent_path = root / "fixture.torrent"
    torrent_path.write_bytes(lt.bencode(creator.generate()))
    info = lt.torrent_info(str(torrent_path))
    info_hash = str(info.info_hash())
    target_offset = int(info.files().file_offset(1))
    if info.piece_length() != PIECE_LENGTH or target_offset != PREVIOUS_SIZE:
        raise AssertionError(
            "fixture layout mismatch: "
            f"piece={info.piece_length()} offset={target_offset}",
        )
    return torrent_path, info_hash


def start_seeder(
    torrent_path: Path,
    seed_dir: Path,
    ready: threading.Event,
    stop: threading.Event,
    result: dict[str, int],
) -> threading.Thread:
    def run() -> None:
        session = lt.session(
            {
                "listen_interfaces": "127.0.0.1:0",
                "enable_dht": False,
                "enable_lsd": False,
                "enable_upnp": False,
                "enable_natpmp": False,
            },
        )
        handle = session.add_torrent(
            {
                "save_path": str(seed_dir),
                "ti": lt.torrent_info(str(torrent_path)),
            },
        )
        handle.set_upload_limit(SEED_RATE)
        result["port"] = int(session.listen_port())
        seed_deadline = time.monotonic() + 30
        while time.monotonic() < seed_deadline and not stop.is_set():
            status = handle.status()
            if bool(getattr(status, "is_seeding", False)):
                break
            time.sleep(0.05)
        ready.set()
        while not stop.wait(0.05):
            session.pop_alerts()
        try:
            session.remove_torrent(handle)
        except Exception:
            pass

    thread = threading.Thread(target=run, name="benchmark-seeder", daemon=True)
    thread.start()
    return thread


def read_stream(url: str) -> dict[str, Any]:
    started = time.monotonic()
    request = Request(url, headers={"Range": f"bytes=0-{READ_SIZE - 1}"})
    with urlopen(request, timeout=120) as response:
        headers_ms = (time.monotonic() - started) * 1000
        first_byte_ms: Optional[float] = None
        total = 0
        digest = hashlib.sha256()
        while total < READ_SIZE:
            chunk = response.read(min(8192, READ_SIZE - total))
            if not chunk:
                break
            total += len(chunk)
            digest.update(chunk)
            if first_byte_ms is None:
                first_byte_ms = (time.monotonic() - started) * 1000
        body_ms = (time.monotonic() - started) * 1000
    return {
        "headers_ms": headers_ms,
        "first_byte_ms": first_byte_ms,
        "read_64k_ms": body_ms if total == READ_SIZE else None,
        "bytes": float(total),
        "sha256": digest.hexdigest(),
    }


def run_framezoo(
    torrent_path: Path,
    info_hash: str,
    tracker_url: str,
    seeder_port: int,
    data_dir: Path,
) -> dict[str, Any]:
    os.environ["FRAMEZOO_TORRENT_DATA_DIR"] = str(data_dir)
    engine = LibtorrentEngine()
    request = {
        "url": (
            f"magnet:?xt=urn:btih:{info_hash}"
            f"&tr={quote(tracker_url, safe='')}"
        ),
        "infoHash": info_hash,
        "fileIdx": 1,
        "fileName": "episode.mkv",
        "sourceId": "benchmark",
    }
    started = time.monotonic()
    engine.start("benchmark", request)
    runtime = engine.sessions["benchmark"]
    runtime.handle.connect_peer(("127.0.0.1", seeder_port), 0)
    runtime.wait_for_metadata(60)
    metadata_ms = (time.monotonic() - started) * 1000
    stream = read_stream(runtime.stream_url)
    engine.stop("benchmark")
    engine.close()
    stream["metadata_ms"] = metadata_ms
    stream["total_first_byte_ms"] = (
        metadata_ms + (stream["first_byte_ms"] or 0)
    )
    stream["total_64k_ms"] = metadata_ms + (stream["read_64k_ms"] or 0)
    stream["total_start_ms"] = (
        stream["total_64k_ms"]
    )
    return stream


def stremio_create(torrent_path: Path) -> float:
    started = time.monotonic()
    request = Request(
        f"{STREMIO_BASE_URL}/create",
        data=json.dumps({"from": str(torrent_path)}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=120) as response:
        response.read()
    return (time.monotonic() - started) * 1000


def run_stremio(
    torrent_path: Path,
    info_hash: str,
) -> dict[str, Any]:
    metadata_ms = stremio_create(torrent_path)
    stream = read_stream(f"{STREMIO_BASE_URL}/{info_hash}/1")
    try:
        with urlopen(
            f"{STREMIO_BASE_URL}/{info_hash}/remove",
            timeout=10,
        ):
            pass
    except Exception:
        pass
    cache_path = Path(tempfile.gettempdir()) / info_hash
    shutil.rmtree(cache_path, ignore_errors=True)
    stream["metadata_ms"] = metadata_ms
    stream["total_first_byte_ms"] = (
        metadata_ms + (stream["first_byte_ms"] or 0)
    )
    stream["total_64k_ms"] = metadata_ms + (stream["read_64k_ms"] or 0)
    stream["total_start_ms"] = stream["total_64k_ms"]
    return stream


def print_result(label: str, result: dict[str, Any]) -> None:
    print(
        f"{label}: "
        f"metadata={result['metadata_ms']:.0f}ms "
        f"headers={result['headers_ms']:.0f}ms "
        f"first_byte={result['first_byte_ms'] or -1:.0f}ms "
        f"total_first_byte={result['total_first_byte_ms'] or -1:.0f}ms "
        f"64KiB={result['read_64k_ms'] or -1:.0f}ms "
        f"total_64KiB={result['total_64k_ms'] or -1:.0f}ms "
        f"content={'ok' if result.get('content_ok') else 'bad'} "
        f"bytes={result['bytes']:.0f}",
    )


def median_metric(
    results: list[dict[str, Any]],
    key: str,
) -> Optional[float]:
    values = [
        float(result[key])
        for result in results
        if result.get(key) is not None
    ]
    return median(values) if values else None


def main() -> None:
    tracker, tracker_thread = start_tracker()
    all_results: dict[str, list[dict[str, Any]]] = {
        "Framezoo": [],
        "Stremio": [],
    }
    try:
        for trial in range(1, TRIALS + 1):
            root = Path(tempfile.mkdtemp(prefix="framezoo-benchmark-"))
            seed_dir = root / "seed"
            stop_events = [threading.Event(), threading.Event()]
            ready_events = [threading.Event(), threading.Event()]
            seeder_results: list[dict[str, int]] = [{}, {}]
            try:
                torrent_path, info_hash = make_fixture(root, tracker.url)
                for index in range(2):
                    seeder_dir = root / f"seeder-{index}"
                    shutil.copytree(
                        seed_dir / "shared-piece-fixture",
                        seeder_dir / "shared-piece-fixture",
                    )
                seeder_threads = [
                    start_seeder(
                        torrent_path,
                        root / f"seeder-{index}",
                        ready_events[index],
                        stop_events[index],
                        seeder_results[index],
                    )
                    for index in range(2)
                ]
                if not all(event.wait(10) for event in ready_events):
                    raise RuntimeError("seeders did not start")
                tracker.peers = [
                    ("127.0.0.1", seeder_results[index]["port"])
                    for index in range(2)
                ]
                framezoo = run_framezoo(
                    torrent_path,
                    info_hash,
                    tracker.url,
                    seeder_results[0]["port"],
                    root / "framezoo-cache",
                )
                stremio = run_stremio(torrent_path, info_hash)
                expected_hash = hashlib.sha256(
                    (seed_dir / "shared-piece-fixture" / "episode.mkv")
                    .read_bytes()[:READ_SIZE],
                ).hexdigest()
                for result in (framezoo, stremio):
                    result["content_ok"] = (
                        result.get("sha256") == expected_hash
                    )
                    if not result["content_ok"]:
                        raise AssertionError(
                            "stream payload does not match fixture prefix",
                        )
                all_results["Framezoo"].append(framezoo)
                all_results["Stremio"].append(stremio)
                print(f"trial {trial} infohash={info_hash}")
                print_result("  Framezoo", framezoo)
                print_result("  Stremio  ", stremio)
            finally:
                for event in stop_events:
                    event.set()
                for thread in seeder_threads if "seeder_threads" in locals() else []:
                    thread.join(timeout=5)
                shutil.rmtree(root, ignore_errors=True)
    finally:
        tracker.shutdown()
        tracker.server_close()
        tracker_thread.join(timeout=5)


    framezoo_first = median_metric(
        all_results["Framezoo"],
        "total_first_byte_ms",
    )
    stremio_first = median_metric(
        all_results["Stremio"],
        "total_first_byte_ms",
    )
    framezoo_64k = median_metric(
        all_results["Framezoo"],
        "total_64k_ms",
    )
    stremio_64k = median_metric(
        all_results["Stremio"],
        "total_64k_ms",
    )
    print(
        "median total first byte: "
        f"Framezoo={framezoo_first or -1:.0f}ms "
        f"Stremio={stremio_first or -1:.0f}ms "
        f"ratio={(framezoo_first / stremio_first) if framezoo_first and stremio_first else -1:.1f}x",
    )
    print(
        "median total 64KiB: "
        f"Framezoo={framezoo_64k or -1:.0f}ms "
        f"Stremio={stremio_64k or -1:.0f}ms "
        f"ratio={(framezoo_64k / stremio_64k) if framezoo_64k and stremio_64k else -1:.1f}x",
    )


if __name__ == "__main__":
    main()
