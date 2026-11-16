import { useAuth } from '~/utils/auth';
import { getUserProviderCredential } from '~/utils/providerCredentials';

export default defineEventHandler(async event => {
  const auth = useAuth();
  let session;

  try {
    session = await auth.getCurrentSessionForEvent(event);
  } catch {
    return {
      configured: false,
      hasCustomKey: false,
      provider: null,
      providers: {
        wyzie: false,
        subsource: false,
        opensubtitles: false,
      },
    };
  }

  if (!session?.user) {
    return {
      configured: false,
      hasCustomKey: false,
      provider: null,
      providers: {
        wyzie: false,
        subsource: false,
        opensubtitles: false,
      },
    };
  }

  try {
    const [wyzieKey, subsourceKey, opensubsKey] = await Promise.all([
      getUserProviderCredential(session.user),
      getUserProviderCredential(session.user, 'subsource'),
      getUserProviderCredential(session.user, 'opensubtitles'),
    ]);

    const providers = {
      wyzie: Boolean(wyzieKey && wyzieKey.trim().length > 0),
      subsource: Boolean(subsourceKey && subsourceKey.trim().length > 0),
      opensubtitles: Boolean(opensubsKey && opensubsKey.trim().length > 0),
    };
    const hasCustomKey = providers.wyzie || providers.subsource || providers.opensubtitles;

    return {
      configured: hasCustomKey,
      hasCustomKey,
      provider: providers.wyzie
        ? 'wyzie'
        : providers.subsource
          ? 'subsource'
          : providers.opensubtitles
            ? 'opensubtitles'
            : null,
      providers,
    };
  } catch (err) {
    console.warn('[subtitles:status] Failed to lookup provider credential:', err);
    return {
      configured: false,
      hasCustomKey: false,
      provider: null,
      providers: {
        wyzie: false,
        subsource: false,
        opensubtitles: false,
      },
    };
  }
});
