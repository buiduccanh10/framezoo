import {
  createHttpStatusError,
  getAuthHeaders,
  withAuthRetry,
} from "@/backend/accounts/auth";
import { AccountWithToken } from "@/stores/auth";

interface PlayerState {
  isPlaying: boolean;
  isPaused: boolean;
  isLoading: boolean;
  hasPlayedOnce: boolean;
  time: number;
  duration: number;
  volume?: number;
  playbackRate: number;
  buffered: number;
}

interface ContentInfo {
  title: string;
  type: string;
  tmdbId?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  seasonId?: number;
  episodeId?: number;
}

interface PlayerStatusRequest {
  participantId: string;
  userId: string;
  nickname?: string;
  roomCode: string;
  isHost: boolean;
  content: ContentInfo;
  player: PlayerState;
}

interface PlayerStatusResponse {
  success: boolean;
  timestamp: number;
}

interface UserStatusResponse {
  participantId: string;
  userId: string;
  nickname?: string;
  roomCode: string;
  statuses: Array<{
    participantId: string;
    userId: string;
    nickname?: string;
    roomCode: string;
    isHost: boolean;
    content: ContentInfo;
    player: PlayerState;
    timestamp: number;
  }>;
}

interface RoomStatusesResponse {
  roomCode: string;
  users: Record<
    string,
    Array<{
      participantId: string;
      userId: string;
      nickname?: string;
      roomCode: string;
      isHost: boolean;
      content: ContentInfo;
      player: PlayerState;
      timestamp: number;
    }>
  >;
}

async function fetchPlayerStatusResponse(
  backendUrl: string,
  account: AccountWithToken | null,
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  return withAuthRetry(backendUrl, account, async (token) => {
    const headers = new Headers(init?.headers);
    Object.entries(getAuthHeaders(token)).forEach(([key, value]) => {
      headers.set(key, value);
    });

    const response = await fetch(input, {
      ...init,
      credentials: "include",
      headers,
    });

    if (!response.ok) {
      throw createHttpStatusError(response.status, response.statusText);
    }

    return response;
  });
}

/**
 * Send player status update to the backend
 */
export async function sendPlayerStatus(
  backendUrl: string | null,
  account: AccountWithToken | null,
  data: PlayerStatusRequest,
): Promise<PlayerStatusResponse> {
  if (!backendUrl) {
    throw new Error("Backend URL not set");
  }

  const response = await fetchPlayerStatusResponse(
    backendUrl,
    account,
    `${backendUrl}/api/player/status`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    },
  );

  return response.json();
}

/**
 * Get player status for a specific user in a room
 */
export async function getUserPlayerStatus(
  backendUrl: string | null,
  account: AccountWithToken | null,
  userId: string,
  roomCode: string,
): Promise<UserStatusResponse> {
  if (!backendUrl) {
    throw new Error("Backend URL not set");
  }

  const response = await fetchPlayerStatusResponse(
    backendUrl,
    account,
    `${backendUrl}/api/player/status?userId=${encodeURIComponent(
      userId,
    )}&roomCode=${encodeURIComponent(roomCode)}`,
  );

  return response.json();
}

/**
 * Get status for all users in a room
 */
export async function getRoomStatuses(
  backendUrl: string | null,
  account: AccountWithToken | null,
  roomCode: string,
): Promise<RoomStatusesResponse> {
  if (!backendUrl) {
    throw new Error("Backend URL not set");
  }

  const response = await fetchPlayerStatusResponse(
    backendUrl,
    account,
    `${backendUrl}/api/player/status?roomCode=${encodeURIComponent(roomCode)}`,
  );

  return response.json();
}
