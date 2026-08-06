import { useAuth } from '~/utils/auth';
import { isValidInternalApiRequest } from '~/utils/internalApi';

const isPublicApiRequest = (path: string, method: string) => {
  if (method !== 'GET') return false;
  if (path === '/api/skip-segments') return true;
  return path === '/api/tmdb' || path.startsWith('/api/tmdb/');
};

export default defineEventHandler(async event => {
  const path = event.path.split('?')[0] || '';

  if (!path.startsWith('/api/')) {
    return;
  }

  // Keep CORS preflight open.
  if (event.method === 'OPTIONS') {
    return;
  }

  // Metadata and skip-segment lookups are available before login.
  if (isPublicApiRequest(path, event.method)) {
    return;
  }

  if (isValidInternalApiRequest(event)) {
    return;
  }

  const session = await useAuth().getCurrentSessionForEvent(event);
  event.context.session = session;
});
