import { readBody, setHeader } from 'h3';

import { isSubtitleKeyProvider, testSubtitleProviderKey } from '~/utils/subtitles/keyTest';

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'private, no-store');

  const body = await readBody<{ provider?: unknown; apiKey?: unknown }>(event).catch(() => ({}));
  if (!isSubtitleKeyProvider(body?.provider)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'Invalid subtitle provider',
    });
  }

  const result = await testSubtitleProviderKey(body.provider, body?.apiKey);
  return {
    provider: body.provider,
    ...result,
  };
});
