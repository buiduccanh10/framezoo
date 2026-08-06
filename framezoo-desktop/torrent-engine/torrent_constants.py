from __future__ import annotations

VIDEO_EXTENSIONS = (".avi", ".m4v", ".mkv", ".mov", ".mp4", ".webm")
STREAM_CHUNK_SIZE = 1024 * 1024
RANGE_PREFETCH_BYTES = 32 * 1024 * 1024
MAX_REPLAN_PREFETCH_BYTES = 128 * 1024 * 1024
STREAM_IDLE_FILE_PRIORITY = 1
STREAM_PIECE_PRIORITY = 7
STREAM_HOT_PIECE_PRIORITY = 4
STREAM_WARM_PIECE_PRIORITY = 2
STARTUP_WINDOW_PIECES = 4
TAIL_PREFETCH_BYTES = STREAM_CHUNK_SIZE
PREFETCH_DEADLINE_BASE_MS = 50
PREFETCH_DEADLINE_STEP_MS = 50
INITIAL_RANGE_HEADER_WAIT_TIMEOUT = 2
FIRST_RANGE_WAIT_TIMEOUT = 30
RANGE_WAIT_TIMEOUT = 30
METADATA_WAIT_TIMEOUT = 90
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
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://tracker.openbittorrent.com:6969/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://tracker.tiny-vps.com:6969/announce",
    "http://tracker.openbittorrent.com:80/announce",
)
