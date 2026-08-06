import { applyCorsHeaders } from '~/utils/cors';
import { useAuth } from '~/utils/auth';
import { isValidInternalApiRequest } from '~/utils/internalApi';

export default defineEventHandler(async event => {
  if (!event.path.startsWith('/metrics')) {
    return;
  }

  applyCorsHeaders(event, 'GET, OPTIONS, POST, PUT');
  if (event.method === 'OPTIONS') {
    return;
  }

  if (isValidInternalApiRequest(event)) {
    return;
  }

  await useAuth().getCurrentSessionForEvent(event);
});
