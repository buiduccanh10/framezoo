import { createError, type H3Event } from 'h3';

import { useAuth } from '~/utils/auth';
import { getUserProviderCredential } from '~/utils/providerCredentials';
import { checkSubtitleTargetBlocked } from '~/utils/takedown';

export async function prepareSubtitleDownload(
  event: H3Event,
  provider: 'subsource' | 'opensubtitles',
  fallbackServerKey: string
): Promise<{ subtitleId: string; apiKey: string }> {
  const params = event.context.params as { id?: string } | undefined;
  const subtitleId = params?.id?.replace(/\.(srt|vtt|zip|json)$/, '').trim();

  if (!subtitleId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'Missing subtitle id',
    });
  }

  const isBlocked = await checkSubtitleTargetBlocked({
    subtitleId: `${provider === 'opensubtitles' ? 'opensubs' : 'subsource'}:${subtitleId}`,
  });
  if (isBlocked) {
    throw createError({
      statusCode: 451,
      statusMessage: 'Unavailable For Legal Reasons',
      message: 'This subtitle has been removed following a legal or copyright notice.',
    });
  }

  let apiKey = fallbackServerKey.trim();
  try {
    const authSession = await useAuth().getOptionalCurrentSessionForEvent(event);
    if (authSession?.user) {
      const userKey = await getUserProviderCredential(authSession.user, provider);
      if (userKey?.trim()) apiKey = userKey.trim();
    }
  } catch {
    // Unauthenticated requests fall back to server commercial API key.
  }

  if (!apiKey) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: `${provider} API key is not configured`,
    });
  }

  return { subtitleId, apiKey };
}
