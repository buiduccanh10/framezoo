import { defineEventHandler, readBody, createError } from 'h3';
import {
  buildPlayerStatusStoreKey,
  playerStatusStore,
  PlayerStatus,
} from '~/utils/playerStatus';

export default defineEventHandler(async event => {
  const body = await readBody(event);

  if (!body || !body.userId || !body.roomCode) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing required fields: userId, roomCode',
    });
  }

  const status: PlayerStatus = {
    participantId: body.participantId || body.userId,
    userId: body.userId,
    nickname: body.nickname,
    roomCode: body.roomCode,
    isHost: body.isHost || false,
    content: {
      title: body.content?.title || 'Unknown',
      type: body.content?.type || 'Unknown',
      tmdbId: body.content?.tmdbId,
      seasonId: body.content?.seasonId,
      episodeId: body.content?.episodeId,
      seasonNumber: body.content?.seasonNumber,
      episodeNumber: body.content?.episodeNumber,
    },
    player: {
      isPlaying: body.player?.isPlaying || false,
      isPaused: body.player?.isPaused || false,
      isLoading: body.player?.isLoading || false,
      hasPlayedOnce: body.player?.hasPlayedOnce || false,
      time: body.player?.time || 0,
      duration: body.player?.duration || 0,
      volume: body.player?.volume || 0,
      playbackRate: body.player?.playbackRate || 1,
      buffered: body.player?.buffered || 0,
    },
    timestamp: Date.now(),
  };

  const key = buildPlayerStatusStoreKey(status.participantId, status.roomCode);
  const existingStatuses = playerStatusStore.get(key) || [];

  // Add new status and keep only the last 5 statuses
  existingStatuses.push(status);
  if (existingStatuses.length > 5) {
    existingStatuses.shift();
  }

  playerStatusStore.set(key, existingStatuses);

  return { success: true, timestamp: status.timestamp };
});
