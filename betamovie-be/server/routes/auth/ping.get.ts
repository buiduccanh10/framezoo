import { useAuth } from '~/utils/auth';

export default defineEventHandler(async event => {
  const session = await useAuth().getCurrentSessionForEvent(event);

  return {
    ok: true,
    sessionId: session.id,
    accessedAt: session.accessed_at,
  };
});
