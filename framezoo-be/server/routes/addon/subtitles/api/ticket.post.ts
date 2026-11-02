import { randomBytes } from 'node:crypto';
import { getQuery, getRequestHeader, readBody } from 'h3';
import { resolveFrontendOrigin } from '~/utils/frontendOrigin';

import { useAuth } from '~/utils/auth';

export default defineEventHandler(async event => {
  const auth = useAuth();
  let session;

  try {
    session = await auth.getCurrentSessionForEvent(event);
  } catch {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      message: 'You must be logged in to create a configuration ticket',
    });
  }

  if (!session?.user) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      message: 'Invalid user session',
    });
  }

  // Generate a cryptographically secure single-use ticket
  const ticket = randomBytes(24).toString('base64url');

  const storage = useStorage('cache');
  // Ticket expires in 5 minutes (300 seconds)
  await storage.setItem(`subtitles:ticket:${ticket}`, { userId: session.user }, { ttl: 300 });

  const body = event.method === 'POST' ? await readBody(event).catch(() => ({})) : {};
  const requestedOrigin =
    typeof body?.frontendOrigin === 'string' ? body.frontendOrigin : undefined;
  const origin = resolveFrontendOrigin(event, requestedOrigin);

  const configureUrl = `${origin}/addon/subtitles/configure?ticket=${ticket}`;

  return {
    ticket,
    url: configureUrl,
  };
});
