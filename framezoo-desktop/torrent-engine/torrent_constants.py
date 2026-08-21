from __future__ import annotations

VIDEO_EXTENSIONS = (".avi", ".m4v", ".mkv", ".mov", ".mp4", ".webm")
STREAM_CHUNK_SIZE = 1024 * 1024
RANGE_PREFETCH_BYTES = 32 * 1024 * 1024
MAX_REPLAN_PREFETCH_BYTES = 128 * 1024 * 1024
# Keep the selected file materialized on disk while the playback scheduler
# boosts the contiguous range that libmpv currently needs.
STREAM_IDLE_FILE_PRIORITY = 1
STREAM_PIECE_PRIORITY = 7
STREAM_HOT_PIECE_PRIORITY = 4
STREAM_WARM_PIECE_PRIORITY = 2
STARTUP_WINDOW_PIECES = 4
# Keep the startup window bounded by piece size, not the full replan cap.
# A large metadata-time burst can consume bandwidth before the first range.
STARTUP_PREFETCH_BYTES = STREAM_CHUNK_SIZE
PREFETCH_DEADLINE_BASE_MS = 50
PREFETCH_DEADLINE_STEP_MS = 50
INITIAL_RANGE_HEADER_WAIT_TIMEOUT = 2
FIRST_RANGE_WAIT_TIMEOUT = None
RANGE_WAIT_TIMEOUT = None
METADATA_REANNOUNCE_INTERVAL = 15
INITIAL_TAIL_PROBE_MAX_REQUESTS = 3
RANGE_RETRY_INTERVAL = 0.05
BLOCKED_REPLAN_INTERVAL = 0.25
# Re-assert/expand the blocked range only when the missing set or the window
# size changes, or every N seconds. Re-scheduling every tick churns
# libtorrent's piece picker and spams logs without helping the stuck piece.
BLOCKED_REPLAN_REASSERT_INTERVAL = 5
# A stuck required piece rarely completes from priority alone: libtorrent
# never cancels in-flight block requests when priority is raised. After the
# target stalls this long we cancel the piece (priority 0) and re-prioritize
# it so every missing block is re-requested from all peers (endgame).
# The kick gate tracks the target piece itself, not swarm throughput: a
# swarm can be delivering other pieces at full speed while the required
# piece receives nothing, so kicks run on the stall timer alone. The cancel
# (cancel_non_critical) only aborts the target's own in-flight requests; the
# blocks it downloaded are kept and re-picked, so kicking while the swarm is
# busy is safe.
TARGET_KICK_DELAY = 1.0
TARGET_KICK_INTERVAL = 4.0
# A kick drops the target to priority 0 to cancel its in-flight requests,
# then restores top priority after this delay. Raising it back within the
# same picker tick is a no-op: the cancellation is never processed, so the
# missing blocks stay requested from the same slow peers. A full tick at
# priority 0 forces a genuine re-request from every peer (endgame).
TARGET_KICK_RESTORE_DELAY = 0.5
# After the target stalls this long, demote every other priority-7 piece to
# hot priority so the stuck piece receives the swarm's full bandwidth.
TARGET_FOCUS_DELAY = 3.0
TARGET_STALL_REANNOUNCE_DELAY = 1.0
REANNOUNCE_COOLDOWN = 5
# Minimum seconds to wait before declaring client disconnected.
# MPV holds the TCP connection open while waiting for the 206 header;
# select() may briefly see the socket as readable due to buffered request
# bytes that were already consumed, so we give the client a short grace
# period before we start checking for disconnection.
CLIENT_DISCONNECT_GRACE_SECS = 10.0
FILE_OPEN_RETRY_INTERVAL = 0.2
DEFAULT_MAX_TORRENT_BYTES = 5 * 1024 * 1024 * 1024

DEFAULT_TRACKERS = (
    "udp://zer0day.ch:1337/announce",
    "udp://tracker.publictracker.xyz:6969/announce",
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://tracker.openbittorrent.com:6969/announce",
    "udp://open.demonii.com:1337/announce",
    "udp://open.stealth.si:80/announce",
    "http://tracker.renfei.net:8080/announce",
    "udp://udp.tracker.projectk.org:23333/announce",
    "udp://tracker.tryhackx.org:6969/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://tracker.theoks.net:6969/announce",
    "udp://tracker.startwork.cv:1337/announce",
    "udp://tracker.qu.ax:6969/announce",
    "udp://tracker.dler.org:6969/announce",
    "udp://tracker.auctor.tv:6969/announce",
    "udp://tracker-udp.gbitt.info:80/announce",
    "udp://torrentclub.online:54123/announce",
    "udp://torrentclub.online:1984/announce",
    "udp://t.overflow.biz:6969/announce",
    "udp://explodie.org:6969/announce",
    "udp://bittorrent-tracker.e-n-c-r-y-p-t.net:1337/announce",
    "udp://tracker.plx.im:6969/announce",
    "udp://tracker.nyaa.vc:6969/announce",
    "udp://tracker.iperson.xyz:6969/announce",
    "udp://tracker.gmi.gd:6969/announce",
    "udp://tracker.fnix.net:6969/announce",
    "udp://tracker.flatuslifir.is:6969/announce",
    "udp://tracker.ducks.party:1984/announce",
    "udp://tracker.bluefrog.pw:2710/announce",
    "https://tracker.yemekyedim.com:443/announce",
    "https://tracker.pmman.tech:443/announce",
    "https://tracker.bt4g.com:443/announce",
    "https://tr.zukizuki.org:443/announce",
    "https://ht.therarbg.to:443/announce",
    "http://tracker810.xyz:11450/announce",
    "udp://opentor.net:6969",
    "http://bt.t-ru.org/ann?magnet",
    "http://bt2.t-ru.org/ann?magnet",
    "http://bt4.t-ru.org/ann?magnet",
)

TRACKER_NUMWANT = 50
TRACKER_REQUEST_TIMEOUT = 5.0
TRACKER_MAX_RESPONSE_BYTES = 1024 * 1024
TRACKER_USER_AGENT = "Framezoo/1.1 torrent-discovery"
DISCOVERY_TRACKER_CONCURRENCY = 4
DISCOVERY_MIN_PEERS = 40
DISCOVERY_MAX_PEERS = 150
DISCOVERY_PEER_RETRY_SECONDS = 5.0
DISCOVERY_COOL_OFF_SECONDS = 30.0
DISCOVERY_BACKOFF_SECONDS = (0.0, 5.0, 15.0, 30.0, 60.0)
DHT_BOOTSTRAP_NODES = (
    ("router.bittorrent.com", 6881),
    ("router.utorrent.com", 6881),
    ("dht.transmissionbt.com", 6881),
)
TORRENT_HANDLE_GRACE_SECONDS = 3.0
