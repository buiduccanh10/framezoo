import { readBody } from 'h3';

export default defineEventHandler(async event => {
  const body = await readBody<{ configureToken?: string; apiKey?: string }>(event);

  const configureToken = typeof body?.configureToken === 'string' ? body.configureToken.trim() : '';

  if (!configureToken) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      message: 'Missing or invalid configuration session',
    });
  }

  const storage = useStorage('cache');
  const sessionKey = `subtitles:session:${configureToken}`;
  const sessionData = await storage.getItem<{ userId: string }>(sessionKey);

  if (!sessionData?.userId) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      message: 'Configuration session has expired. Please re-open the settings from the app.',
    });
  }

  const userId = sessionData.userId;
  const rawApiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';

  if (rawApiKey) {
    // Basic sanitization
    const sanitizedKey = rawApiKey.replace(/[\r\n\t]/g, '').slice(0, 256);
    await storage.setItem(`user:wyzie_key:${userId}`, sanitizedKey);

    return {
      success: true,
      message: 'Wyzie API key saved successfully for your account.',
      hasKey: true,
    };
  }

  // If empty string or null, remove custom key (reverting to server default)
  await storage.removeItem(`user:wyzie_key:${userId}`);

  return {
    success: true,
    message: 'Wyzie API key removed. Your account will use the default server provider.',
    hasKey: false,
  };
});
