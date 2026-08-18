import { useAuth } from '~/utils/auth';

export default defineEventHandler(async () => {
  const auth = useAuth();
  const tokens = auth.makeGuestToken();
  return auth.toGuestTokenResponse(tokens);
});
