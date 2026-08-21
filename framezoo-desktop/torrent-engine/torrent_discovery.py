from __future__ import annotations

import ipaddress
import socket
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from dataclasses import dataclass
from typing import Any, Callable, Iterable, List, Optional, Set, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import quote, quote_from_bytes, urlsplit, urlunsplit
from urllib.request import Request, urlopen

import libtorrent as lt

import torrent_constants as constants


@dataclass(frozen=True)
class PeerAddress:
    host: str
    port: int


@dataclass(frozen=True)
class TrackerResult:
    tracker: str
    peers: Tuple[PeerAddress, ...]
    error: Optional[str] = None


def _dict_value(entry: Any, key: str, default: Any = None) -> Any:
    if not isinstance(entry, dict):
        return default
    if key in entry:
        return entry[key]
    encoded = key.encode("utf-8")
    return entry.get(encoded, default)


def _as_text(value: Any) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    return str(value)


def _parse_compact_peers(value: Any, width: int) -> List[PeerAddress]:
    if not isinstance(value, (bytes, bytearray, memoryview)):
        return []
    raw = bytes(value)
    if len(raw) % width:
        return []

    peers: List[PeerAddress] = []
    for offset in range(0, len(raw), width):
        block = raw[offset : offset + width]
        try:
            if width == 6:
                host = str(ipaddress.IPv4Address(block[:4]))
                port = int.from_bytes(block[4:6], "big")
            else:
                host = str(ipaddress.IPv6Address(block[:16]))
                port = int.from_bytes(block[16:18], "big")
        except ValueError:
            continue
        if port:
            peers.append(PeerAddress(host, port))
    return peers


def _parse_dictionary_peers(value: Any) -> List[PeerAddress]:
    if not isinstance(value, list):
        return []

    peers: List[PeerAddress] = []
    for item in value:
        host = _dict_value(item, "ip")
        port = _dict_value(item, "port")
        if host is None or port is None:
            continue
        try:
            normalized_host = _as_text(host).strip()
            normalized_port = int(port)
        except (TypeError, ValueError):
            continue
        if normalized_host and 0 < normalized_port <= 65535:
            peers.append(PeerAddress(normalized_host, normalized_port))
    return peers


def parse_tracker_response(payload: bytes) -> Tuple[PeerAddress, ...]:
    """Decode a bencoded tracker response into unique peer addresses."""
    decoded = lt.bdecode(payload)
    failure = _dict_value(decoded, "failure reason")
    if failure:
        raise ValueError(_as_text(failure))

    values: List[PeerAddress] = []
    values.extend(_parse_compact_peers(_dict_value(decoded, "peers"), 6))
    values.extend(_parse_compact_peers(_dict_value(decoded, "peers6"), 18))
    values.extend(_parse_dictionary_peers(_dict_value(decoded, "peers")))

    unique: List[PeerAddress] = []
    seen: Set[Tuple[str, int]] = set()
    for peer in values:
        key = (peer.host, peer.port)
        if key in seen:
            continue
        seen.add(key)
        unique.append(peer)
    return tuple(unique)


def _append_query(url: str, params: Iterable[Tuple[str, str]]) -> str:
    parsed = urlsplit(url)
    query = parsed.query
    encoded = "&".join(
        f"{quote(str(key), safe='')}={quote(str(value), safe='')}"
        for key, value in params
    )
    if query:
        query += "&" + encoded
    else:
        query = encoded
    return urlunsplit(
        (parsed.scheme, parsed.netloc, parsed.path, query, parsed.fragment),
    )


def _append_binary_query(url: str, name: str, value: bytes) -> str:
    parsed = urlsplit(url)
    encoded = f"{quote(name, safe='')}={quote_from_bytes(value, safe='')}"
    query = f"{parsed.query}&{encoded}" if parsed.query else encoded
    return urlunsplit(
        (parsed.scheme, parsed.netloc, parsed.path, query, parsed.fragment),
    )


def _append_tracker_query(
    url: str,
    params: Iterable[Tuple[str, Any]],
) -> str:
    parsed = urlsplit(url)
    encoded: List[str] = []
    for key, value in params:
        if isinstance(value, (bytes, bytearray, memoryview)):
            encoded_value = quote_from_bytes(bytes(value), safe="")
        else:
            encoded_value = quote(str(value), safe="")
        encoded.append(f"{quote(str(key), safe='')}={encoded_value}")
    query = "&".join(encoded)
    if parsed.query:
        query = f"{parsed.query}&{query}" if query else parsed.query
    return urlunsplit(
        (parsed.scheme, parsed.netloc, parsed.path, query, parsed.fragment),
    )


def announce_http_tracker(
    tracker: str,
    info_hash: bytes,
    peer_id: bytes,
    port: int,
    downloaded: int = 0,
    left: Optional[int] = None,
    uploaded: int = 0,
    numwant: int = constants.TRACKER_NUMWANT,
    timeout: float = constants.TRACKER_REQUEST_TIMEOUT,
    event: Optional[str] = "started",
) -> TrackerResult:
    """Announce to an HTTP(S) tracker using the compact peer response mode."""
    parsed = urlsplit(tracker)
    if parsed.scheme not in ("http", "https"):
        return TrackerResult(tracker, (), "unsupported tracker protocol")

    # Keep the same query ordering as Stremio's bittorrent-tracker client.
    # Renfei sits behind a cache that has behaved differently for equivalent
    # query strings with a different ordering.
    request_params: List[Tuple[str, Any]] = [
        ("numwant", str(max(1, numwant))),
        ("uploaded", str(max(0, uploaded))),
        ("downloaded", str(max(0, downloaded))),
    ]
    if left is not None:
        request_params.append(("left", str(max(0, left))))
    if event is not None:
        request_params.append(("event", event))
    request_params.extend(
        (
            ("compact", "1"),
            ("info_hash", info_hash),
            ("peer_id", peer_id),
            ("port", str(port)),
        ),
    )
    request_url = _append_tracker_query(tracker, request_params)

    request = Request(
        request_url,
        headers={
            "Accept": "text/plain, application/octet-stream",
            "User-Agent": constants.TRACKER_USER_AGENT,
        },
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            payload = response.read(constants.TRACKER_MAX_RESPONSE_BYTES)
        return TrackerResult(tracker, parse_tracker_response(payload))
    except (HTTPError, URLError, OSError, TimeoutError, ValueError) as error:
        return TrackerResult(tracker, (), str(error))
    except Exception as error:
        return TrackerResult(tracker, (), str(error))


def _normalize_tracker(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    tracker = value.strip()
    if tracker.startswith("tracker:"):
        tracker = tracker[8:]
    if not tracker or tracker.startswith("dht:"):
        return None
    parsed = urlsplit(tracker)
    if parsed.scheme not in ("http", "https", "udp"):
        return None
    return tracker


def normalize_trackers(values: Iterable[Any]) -> List[str]:
    result: List[str] = []
    seen: Set[str] = set()
    for value in values:
        tracker = _normalize_tracker(value)
        if not tracker:
            continue
        key = tracker.rstrip("/").lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(tracker)
    return result


def get_local_ipv4() -> Optional[str]:
    """Resolve the local IPv4 used for outbound traffic without sending data."""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.connect(("1.1.1.1", 443))
            address = sock.getsockname()[0]
        finally:
            sock.close()
        if address and address != "0.0.0.0":
            return address
    except OSError:
        return None
    return None


class TorrentDiscovery:
    def __init__(
        self,
        session: Any,
        handle: Any,
        info_hash: Any,
        trackers: Iterable[str],
        peer_id: bytes,
        listen_port: int,
        status_callback: Optional[Callable[[dict[str, Any]], None]] = None,
    ) -> None:
        self.session = session
        self.handle = handle
        self.info_hash = info_hash
        self.peer_id = peer_id
        self.listen_port = listen_port
        self.status_callback = status_callback
        self.stop_event = threading.Event()
        self.lock = threading.RLock()
        self.trackers = normalize_trackers(trackers)
        self.injected_peers: Set[Tuple[str, int]] = set()
        self.peer_last_attempt_at: dict[Tuple[str, int], float] = {}
        self.peer_rotation = 0
        self.discovered_peers: Set[Tuple[str, int]] = set()
        self.trackers_attempted = 0
        self.trackers_succeeded = 0
        self.last_discovery_at: Optional[float] = None
        self.phase = "pending"
        self.last_error: Optional[str] = None
        self.dht_running = False
        self.thread = threading.Thread(
            target=self._run,
            name="torrent-discovery",
            daemon=True,
        )

    def start(self) -> None:
        self.thread.start()

    def stop(self) -> None:
        self.stop_event.set()
        with self.lock:
            self.phase = "stopped"
        if self.thread.is_alive() and threading.current_thread() is not self.thread:
            self.thread.join(timeout=2)
        self._emit_status()

    def add_trackers(self, trackers: Iterable[str]) -> None:
        with self.lock:
            self.trackers = normalize_trackers((*self.trackers, *trackers))

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            return {
                "discoveryPhase": self.phase,
                "trackersAttempted": self.trackers_attempted,
                "trackersSucceeded": self.trackers_succeeded,
                "peersDiscovered": len(self.discovered_peers),
                "peersInjected": len(self.injected_peers),
                "dhtRunning": self.dht_running,
                "lastDiscoveryAt": (
                    int(self.last_discovery_at * 1000)
                    if self.last_discovery_at is not None
                    else None
                ),
                "lastDiscoveryError": self.last_error,
            }

    def _emit_status(self) -> None:
        if self.status_callback:
            try:
                self.status_callback(self.snapshot())
            except Exception:
                pass

    def _bootstrap_dht(self) -> None:
        try:
            start_dht = getattr(self.session, "start_dht", None)
            if callable(start_dht):
                start_dht()
            add_dht_node = getattr(self.session, "add_dht_node", None)
            if callable(add_dht_node):
                for host, port in constants.DHT_BOOTSTRAP_NODES:
                    try:
                        add_dht_node((host, port))
                    except Exception:
                        continue
            dht_get_peers = getattr(self.session, "dht_get_peers", None)
            if callable(dht_get_peers):
                dht_get_peers(self.info_hash)
            with self.lock:
                self.dht_running = True
        except Exception as error:
            with self.lock:
                self.last_error = str(error)
        self._emit_status()

    def _announce_tracker(self, tracker: str, status: Any) -> TrackerResult:
        parsed = urlsplit(tracker)
        if parsed.scheme not in ("http", "https"):
            return TrackerResult(tracker, (), "native tracker")

        downloaded = int(getattr(status, "total_done", 0))
        total_wanted = int(getattr(status, "total_wanted", 0))
        # Stremio's metadata bootstrap omits `left` until the torrent
        # metadata is known. Some HTTP trackers, including Renfei, treat
        # `left=1` as a different cached announce and may stall it.
        left = (
            max(0, total_wanted - downloaded)
            if total_wanted > 0
            else None
        )
        return announce_http_tracker(
            tracker,
            self.info_hash.to_bytes(),
            self.peer_id,
            self.listen_port,
            downloaded=downloaded,
            left=left,
            timeout=constants.TRACKER_REQUEST_TIMEOUT,
        )

    def _inject_peers(self, peers: Iterable[PeerAddress]) -> None:
        candidates: List[PeerAddress] = []
        seen: Set[Tuple[str, int]] = set()
        for peer in peers:
            key = (peer.host, peer.port)
            if key in seen:
                continue
            seen.add(key)
            candidates.append(peer)
        if not candidates:
            return

        # Do not pin discovery to the first stale tracker response forever.
        # Rotate the bounded injection budget across the complete response so
        # later cycles can try endpoints beyond the first 150 entries.
        with self.lock:
            offset = self.peer_rotation % len(candidates)
            self.peer_rotation = (
                offset
                + min(len(candidates), constants.DISCOVERY_MAX_PEERS)
            ) % len(candidates)
        ordered = candidates[offset:] + candidates[:offset]
        attempts = 0
        for peer in ordered:
            if self.stop_event.is_set():
                return
            key = (peer.host, peer.port)
            now = time.monotonic()
            with self.lock:
                self.discovered_peers.add(key)
                last_attempt_at = self.peer_last_attempt_at.get(key)
                if (
                    last_attempt_at is not None
                    and now - last_attempt_at
                    < constants.DISCOVERY_PEER_RETRY_SECONDS
                ):
                    continue
                if attempts >= constants.DISCOVERY_MAX_PEERS:
                    break
                # connect_peer() only queues an outbound attempt. Track the
                # attempt separately so stale peers can be retried later.
                self.peer_last_attempt_at[key] = now
                attempts += 1
            try:
                connect_peer = getattr(self.handle, "connect_peer", None)
                if not callable(connect_peer):
                    continue
                # Mark manually injected endpoints as tracker-derived peers.
                # This keeps libtorrent's peer-source accounting/policy
                # aligned with the tracker response that produced them.
                connect_peer((peer.host, peer.port), 1)
                with self.lock:
                    self.injected_peers.add(key)
            except Exception:
                continue

    def _connected_peers(self) -> int:
        try:
            status = self.handle.status()
            return max(0, int(getattr(status, "num_peers", 0)))
        except Exception:
            return 0

    def _wait_for_peer_deficit(self) -> bool:
        """Match peer-search: pause while the swarm has enough peers.

        A periodic wake-up still retries stale peer connections, while a
        falling peer count immediately resumes discovery.
        """
        while not self.stop_event.is_set():
            if self._connected_peers() < constants.DISCOVERY_MIN_PEERS:
                return True
            if self.stop_event.wait(constants.DISCOVERY_COOL_OFF_SECONDS):
                return False
        return False

    def _run_cycle(self) -> None:
        try:
            status = self.handle.status()
        except Exception:
            return

        with self.lock:
            trackers = list(self.trackers)
            self.phase = "discovering"
            self.last_discovery_at = time.time()

        http_trackers = [
            tracker
            for tracker in trackers
            if urlsplit(tracker).scheme in ("http", "https")
        ]
        results: List[TrackerResult] = []
        if http_trackers:
            executor = ThreadPoolExecutor(
                max_workers=min(
                    constants.DISCOVERY_TRACKER_CONCURRENCY,
                    len(http_trackers),
                ),
                thread_name_prefix="torrent-tracker",
            )
            futures = {
                executor.submit(self._announce_tracker, tracker, status): tracker
                for tracker in http_trackers
            }
            with self.lock:
                self.trackers_attempted += len(futures)
            pending = set(futures)
            try:
                while pending and not self.stop_event.is_set():
                    completed, pending = wait(
                        pending,
                        timeout=0.25,
                        return_when=FIRST_COMPLETED,
                    )
                    for future in completed:
                        tracker = futures[future]
                        try:
                            results.append(future.result())
                        except Exception as error:
                            results.append(TrackerResult(tracker, (), str(error)))
            finally:
                for future in pending:
                    future.cancel()
                executor.shutdown(wait=False, cancel_futures=True)

        if self.stop_event.is_set():
            return

        discovered: List[PeerAddress] = []
        for result in results:
            if result.error is None:
                with self.lock:
                    self.trackers_succeeded += 1
            if result.peers:
                discovered.extend(result.peers)
            elif result.error and result.error != "native tracker":
                with self.lock:
                    self.last_error = result.error
            if self.stop_event.is_set():
                return
        self._inject_peers(discovered)

        try:
            if self.stop_event.is_set():
                return
            force_dht = getattr(self.handle, "force_dht_announce", None)
            if callable(force_dht):
                force_dht()
            dht_get_peers = getattr(self.session, "dht_get_peers", None)
            if callable(dht_get_peers):
                dht_get_peers(self.info_hash)
        except Exception as error:
            with self.lock:
                self.last_error = str(error)

        with self.lock:
            if self.stop_event.is_set():
                self.phase = "stopped"
            else:
                self.phase = "ready" if self.injected_peers else "waiting"
        self._emit_status()

    def _run(self) -> None:
        self._bootstrap_dht()
        retry_index = 0
        while not self.stop_event.is_set():
            backoff = constants.DISCOVERY_BACKOFF_SECONDS[
                min(retry_index, len(constants.DISCOVERY_BACKOFF_SECONDS) - 1)
            ]
            if self.stop_event.wait(backoff):
                break
            self._run_cycle()
            retry_index += 1
            if not self._wait_for_peer_deficit():
                break
        with self.lock:
            self.phase = "stopped"
        self._emit_status()
