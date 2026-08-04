from __future__ import annotations

VIDEO_EXTENSIONS = (".avi", ".m4v", ".mkv", ".mov", ".mp4", ".webm")
STREAM_CHUNK_SIZE = 1024 * 1024
RANGE_PREFETCH_BYTES = 32 * 1024 * 1024
STREAM_IDLE_FILE_PRIORITY = 1
STREAM_ACTIVE_FILE_PRIORITY = 4
STREAM_PIECE_PRIORITY = 7
PREFETCH_DEADLINE_BASE_MS = 50
PREFETCH_DEADLINE_STEP_MS = 50
FIRST_RANGE_WAIT_TIMEOUT = 120
RANGE_WAIT_TIMEOUT = 30
METADATA_WAIT_TIMEOUT = 90
INITIAL_TAIL_PROBE_MAX_REQUESTS = 3
RANGE_RETRY_INTERVAL = 0.2
# Minimum seconds to wait before declaring client disconnected.
# MPV holds the TCP connection open while waiting for the 206 header;
# select() may briefly see the socket as readable due to buffered request
# bytes that were already consumed, so we give the client a short grace
# period before we start checking for disconnection.
CLIENT_DISCONNECT_GRACE_SECS = 10.0
FILE_OPEN_RETRY_INTERVAL = 0.2
DEFAULT_MAX_TORRENT_BYTES = 5 * 1024 * 1024 * 1024
