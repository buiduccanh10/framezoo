import { readBody } from 'h3';

import { setUserProviderCredential } from '~/utils/providerCredentials';

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

  const hasKey = await setUserProviderCredential(userId, rawApiKey);

  return {
    success: true,
    message: hasKey
      ? 'Wyzie API key saved successfully for your account.'
      : 'Wyzie API key removed. Your account will use the default server provider.',
    hasKey,
  };
});
