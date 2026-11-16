import { randomBytes } from 'node:crypto';
import { getQuery } from 'h3';

import { prisma } from '~/utils/prisma';
import { getUserProviderCredential } from '~/utils/providerCredentials';

export default defineEventHandler(async event => {
  const query = getQuery(event);
  const ticket = typeof query.ticket === 'string' ? query.ticket.trim() : '';

  if (!ticket) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'Missing ticket parameter',
    });
  }

  const storage = useStorage('cache');
  const ticketKey = `subtitles:ticket:${ticket}`;
  const ticketData = await storage.getItem<{ userId: string }>(ticketKey);

  if (!ticketData?.userId) {
    return {
      valid: false,
      message: 'Ticket has expired or is invalid. Please request a new one from the desktop app.',
    };
  }

  // Single-use: Invalidate ticket immediately to prevent replay attacks
  await storage.removeItem(ticketKey);

  const userId = ticketData.userId;

  // Retrieve user nickname
  let nickname = 'User';
  try {
    const user = await prisma.users.findUnique({
      where: { id: userId },
      select: { nickname: true },
    });
    if (user?.nickname) {
      nickname = user.nickname;
    }
  } catch (err) {
    console.warn('[subtitles:verify] User lookup failed:', err);
  }

  // Retrieve existing custom provider keys if already set
  let currentApiKey = '';
  let subsourceApiKey = '';
  let opensubtitlesApiKey = '';
  try {
    const [wyzieKey, subsourceKey, opensubsKey] = await Promise.all([
      getUserProviderCredential(userId),
      getUserProviderCredential(userId, 'subsource'),
      getUserProviderCredential(userId, 'opensubtitles'),
    ]);
    if (wyzieKey) currentApiKey = wyzieKey;
    if (subsourceKey) subsourceApiKey = subsourceKey;
    if (opensubsKey) opensubtitlesApiKey = opensubsKey;
  } catch (err) {
    console.warn('[subtitles:verify] Key lookup failed:', err);
  }

  // Issue a 15-minute configure session token for this web page session
  const configureToken = randomBytes(24).toString('base64url');
  await storage.setItem(`subtitles:session:${configureToken}`, { userId }, { ttl: 900 });

  return {
    valid: true,
    userId,
    nickname,
    currentApiKey,
    credentials: {
      wyzie: currentApiKey,
      subsource: subsourceApiKey,
      opensubtitles: opensubtitlesApiKey,
    },
    configureToken,
  };
});
