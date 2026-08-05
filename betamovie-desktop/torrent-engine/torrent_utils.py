from __future__ import annotations

import os
import re
import shutil
import sys
import tempfile
from typing import Any, List, Optional, Set, Tuple
from urllib.parse import parse_qs, urlparse

import torrent_constants as constants


def merge_tracker_sources(*sources: Any) -> List[str]:
    merged: List[str] = []
    seen: Set[str] = set()
    for source in sources:
        if not isinstance(source, (list, tuple)):
            continue
        for value in source:
            if not isinstance(value, str):
                continue
            tracker = value.strip()
            if not tracker or tracker in seen:
                continue
            seen.add(tracker)
            merged.append(tracker)
    return merged


def normalized_info_hash(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    value = value.strip()
    if value.lower().startswith("urn:btih:"):
        value = value[9:]
    return value.lower() or None


def get_magnet(request: dict[str, Any]) -> str:
    url = request.get("url")
    if isinstance(url, str) and url.strip().lower().startswith("magnet:"):
        return url.strip()

    info_hash = normalized_info_hash(request.get("infoHash"))
    if info_hash:
        return "magnet:?xt=urn:btih:" + info_hash

    raise ValueError("torrent request requires a magnet URL or infoHash")


def get_torrent_cache_key(request: dict[str, Any]) -> Optional[str]:
    value = normalized_info_hash(request.get("infoHash"))
    if not value:
        url = request.get("url")
        if isinstance(url, str) and url.strip().lower().startswith("magnet:"):
            try:
                for item in parse_qs(urlparse(url).query).get("xt", []):
                    if item.lower().startswith("urn:btih:"):
                        value = normalized_info_hash(item)
                        if value:
                            break
            except ValueError:
                value = None

    if not value:
        return None

    key = re.sub(r"[^a-z0-9]", "", value.lower())
    return key[:128] or None


def safe_file_name(value: str) -> str:
    return value.replace("\\", "/").rsplit("/", 1)[-1].lower()


def select_file(info: Any, request: dict[str, Any]) -> Tuple[int, str, int]:
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
        if safe_file_name(entry[1]).endswith(constants.VIDEO_EXTENSIONS)
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


def cap_open_ended_range(
    value: Optional[str],
    byte_range: Tuple[int, int],
) -> Tuple[int, int]:
    """Return the requested byte range without artificial limits."""
    if not value or not value.lower().startswith("bytes="):
        return byte_range

    raw_start, raw_end = value[6:].split("-", 1)
    start, end = byte_range
    if not raw_start:
        return max(start, end - (int(raw_end) if raw_end else 0)), end
    return start, min(end, int(raw_end) if raw_end else end)


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
            for file_name in files:
                file_path = os.path.join(root, file_name)
                if not os.path.islink(file_path):
                    total += os.path.getsize(file_path)
    except Exception:
        pass
    return total


def enforce_storage_limit(
    root_dir: str,
    max_bytes: int = constants.DEFAULT_MAX_TORRENT_BYTES,
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

    norm_active = {os.path.abspath(path) for path in active_paths}

    items: List[Tuple[str, int, float]] = []
    total_size = 0
    for directory in candidate_dirs:
        absolute_dir = os.path.abspath(directory)
        size = get_dir_size(absolute_dir)
        total_size += size
        if absolute_dir not in norm_active:
            try:
                mtime = os.path.getmtime(absolute_dir)
            except Exception:
                mtime = 0
            items.append((absolute_dir, size, mtime))

    if total_size <= max_bytes:
        return

    # Sort inactive folders by mtime ascending (oldest first)
    items.sort(key=lambda item: item[2])

    for absolute_dir, size, _ in items:
        if total_size <= max_bytes:
            break
        try:
            shutil.rmtree(absolute_dir, ignore_errors=True)
            total_size -= size
            sys.stderr.write(
                "[sidecar] Pruned old torrent cache: "
                f"{absolute_dir} ({size} bytes)\n"
            )
        except Exception as error:
            sys.stderr.write(
                f"[sidecar] Failed to prune {absolute_dir}: {error}\n"
            )
