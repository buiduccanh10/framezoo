// Interface for player status
export interface PlayerStatus {
  participantId: string;
  userId: string;
  nickname?: string;
  roomCode: string;
  isHost: boolean;
  content: {
    title: string;
    type: string;
    tmdbId?: number | string;
    seasonId?: number;
    episodeId?: number;
    seasonNumber?: number;
    episodeNumber?: number;
  };
  player: {
    isPlaying: boolean;
    isPaused: boolean;
    isLoading: boolean;
    hasPlayedOnce: boolean;
    time: number;
    duration: number;
    volume: number;
    playbackRate: number;
    buffered: number;
  };
  timestamp: number;
}

// In-memory store for player status data
// Key: participantId+roomCode, Value: Status data array
export const playerStatusStore = new Map<string, PlayerStatus[]>();

// Cleanup interval (30 minutes in milliseconds)
export const CLEANUP_INTERVAL = 30 * 60 * 1000;
// A participant is considered "in room" only if recently active.
// Use a wider window to avoid false "alone" states when host is paused/buffering.
export const ACTIVE_PRESENCE_WINDOW_MS = 45 * 1000;

const KEY_SEPARATOR = ":";

export function buildPlayerStatusStoreKey(
  participantId: string,
  roomCode: string,
): string {
  return `${encodeURIComponent(participantId)}${KEY_SEPARATOR}${encodeURIComponent(roomCode)}`;
}

/**
 * Backward-safe parser for status store keys.
 * Supports both encoded keys and old plain `userId:roomCode` keys.
 */
export function parsePlayerStatusStoreKey(
  key: string,
): { participantId: string; roomCode: string } | null {
  const separatorIndex = key.indexOf(KEY_SEPARATOR);
  if (separatorIndex < 0) return null;

  const rawParticipantId = key.slice(0, separatorIndex);
  const rawRoomCode = key.slice(separatorIndex + 1);
  if (!rawParticipantId || !rawRoomCode) return null;

  try {
    return {
      participantId: decodeURIComponent(rawParticipantId),
      roomCode: decodeURIComponent(rawRoomCode),
    };
  } catch {
    return {
      participantId: rawParticipantId,
      roomCode: rawRoomCode,
    };
  }
}

// Clean up old status entries
function cleanupOldStatuses() {
  const cutoffTime = Date.now() - CLEANUP_INTERVAL;

  for (const [key, statuses] of playerStatusStore.entries()) {
    const filteredStatuses = statuses.filter(status => status.timestamp >= cutoffTime);

    if (filteredStatuses.length === 0) {
      playerStatusStore.delete(key);
    } else {
      playerStatusStore.set(key, filteredStatuses);
    }
  }
}

// Schedule cleanup every 5 minutes
setInterval(cleanupOldStatuses, 5 * 60 * 1000);
