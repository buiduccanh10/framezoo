import { defineEventHandler, getQuery, createError } from 'h3';
import {
  ACTIVE_PRESENCE_WINDOW_MS,
  buildPlayerStatusStoreKey,
  CLEANUP_INTERVAL,
  parsePlayerStatusStoreKey,
  playerStatusStore,
} from '~/utils/playerStatus';

export default defineEventHandler(event => {
  const query = getQuery(event);
  const userId = query.userId as string;
  const participantId = query.participantId as string;
  const roomCode = query.roomCode as string;

  // If roomCode is provided but no userId, return all statuses for that room
  if (roomCode && !userId) {
    const now = Date.now();
    const activeCutoff = now - ACTIVE_PRESENCE_WINDOW_MS;
    const cleanupCutoff = now - CLEANUP_INTERVAL;
    const roomStatuses: Record<string, any[]> = {};

    for (const [key, statuses] of playerStatusStore.entries()) {
      const parsedKey = parsePlayerStatusStoreKey(key);
      if (!parsedKey || parsedKey.roomCode !== roomCode) continue;

      const nonExpiredStatuses = statuses.filter(
        status => status.timestamp >= cleanupCutoff,
      );

      if (nonExpiredStatuses.length !== statuses.length) {
        if (nonExpiredStatuses.length === 0) {
          playerStatusStore.delete(key);
          continue;
        }
        playerStatusStore.set(key, nonExpiredStatuses);
      }

      const activeStatuses = nonExpiredStatuses.filter(
        status => status.timestamp >= activeCutoff,
      );

      if (activeStatuses.length > 0) {
        roomStatuses[parsedKey.participantId] = activeStatuses;
      }
    }

    return {
      roomCode,
      users: roomStatuses,
    };
  }

  // If participantId (preferred) or userId is provided with roomCode, return status in that room
  if ((participantId || userId) && roomCode) {
    const directKey = participantId
      ? buildPlayerStatusStoreKey(participantId, roomCode)
      : userId
        ? buildPlayerStatusStoreKey(userId, roomCode)
        : null;

    let statuses = directKey ? (playerStatusStore.get(directKey) || []) : [];

    // Backward compatible lookup: if caller only has userId, search by userId in participant-scoped keys.
    if (!participantId && userId && statuses.length === 0) {
      for (const [key, item] of playerStatusStore.entries()) {
        const parsedKey = parsePlayerStatusStoreKey(key);
        if (!parsedKey || parsedKey.roomCode !== roomCode) continue;
        if (item.some(status => status.userId === userId)) {
          statuses = item;
          break;
        }
      }
    }

    // Remove statuses older than the cleanup interval (30 minutes)
    const cutoffTime = Date.now() - CLEANUP_INTERVAL;
    const recentStatuses = statuses.filter(status => status.timestamp >= cutoffTime);

    if (directKey && recentStatuses.length !== statuses.length) {
      playerStatusStore.set(directKey, recentStatuses);
    }

    return {
      userId,
      participantId: participantId || null,
      roomCode,
      statuses: recentStatuses,
    };
  }

  // If neither is provided, return error
  throw createError({
    statusCode: 400,
    statusMessage: 'Missing required query parameters: roomCode and/or userId',
  });
});
