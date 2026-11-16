import { readBody } from 'h3';

import { setUserProviderCredential } from '~/utils/providerCredentials';

const ALLOWED_PROVIDERS = ['wyzie', 'subsource', 'opensubtitles'] as const;
type SubtitleCredentialProvider = (typeof ALLOWED_PROVIDERS)[number];

const isAllowedProvider = (value: unknown): value is SubtitleCredentialProvider =>
  typeof value === 'string' && (ALLOWED_PROVIDERS as readonly string[]).includes(value);

export default defineEventHandler(async event => {
  const body = await readBody<{
    configureToken?: string;
    apiKey?: string;
    provider?: string;
    credentials?: Partial<Record<SubtitleCredentialProvider, string>>;
  }>(event);

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

  if (body?.credentials && typeof body.credentials === 'object') {
    const updated: Record<SubtitleCredentialProvider, boolean> = {
      wyzie: false,
      subsource: false,
      opensubtitles: false,
    };

    for (const provider of ALLOWED_PROVIDERS) {
      const value = body.credentials[provider];
      const normalized = typeof value === 'string' ? value.trim() : '';
      updated[provider] = await setUserProviderCredential(userId, normalized, provider);
    }

    return {
      success: true,
      message: 'Subtitle provider API keys updated successfully for your account.',
      hasKey: updated.wyzie,
      providers: updated,
    };
  }

  const provider: SubtitleCredentialProvider = isAllowedProvider(body?.provider)
    ? body.provider
    : 'wyzie';
  const rawApiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';

  const hasKey = await setUserProviderCredential(userId, rawApiKey, provider);

  return {
    success: true,
    message: hasKey
      ? `${provider} API key saved successfully for your account.`
      : `${provider} API key removed. Your account will use the default server provider.`,
    hasKey,
    provider,
  };
});
