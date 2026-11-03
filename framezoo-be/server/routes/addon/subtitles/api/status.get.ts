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
    };
  }

  if (!session?.user) {
    return {
      configured: false,
      hasCustomKey: false,
      provider: null,
    };
  }

  try {
    const savedKey = await getUserProviderCredential(session.user);
    const hasCustomKey = Boolean(savedKey && savedKey.trim().length > 0);
    return {
      configured: hasCustomKey,
      hasCustomKey,
      provider: hasCustomKey ? 'wyzie' : null,
    };
  } catch (err) {
    console.warn('[subtitles:status] Failed to lookup provider credential:', err);
    return {
      configured: false,
      hasCustomKey: false,
      provider: null,
    };
  }
});
