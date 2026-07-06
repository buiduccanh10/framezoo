import { useAuth } from '~/utils/auth';

const PUBLIC_API_PREFIXES = [
  '/api/m3u8-proxy',
  '/api/media-proxy',
  '/api/preview-proxy',
  '/api/preview/auto',
  '/api/preview/file',
  '/api/embed/api/m3u8-proxy',
  '/api/embed/api/media-proxy',
  '/api/embed/api/preview-proxy',
  '/api/embed/api/preview/auto',
  '/api/embed/api/preview/file',
];

export default defineEventHandler(async event => {
  if (!event.path.startsWith('/api/')) {
    return;
  }

  // Keep CORS preflight open.
  if (event.method === 'OPTIONS') {
    return;
  }

  if (PUBLIC_API_PREFIXES.some(prefix => event.path.startsWith(prefix))) {
    return;
  }

  const internalApiToken = process.env.INTERNAL_API_TOKEN?.trim();
  const tokenFromHeader = getRequestHeader(event, 'x-internal-token')?.trim();
  const query = getQuery(event);
  const tokenFromQuery = typeof query.internalToken === 'string' ? query.internalToken.trim() : '';

  if (
    internalApiToken &&
    ((tokenFromHeader && tokenFromHeader === internalApiToken) ||
      (tokenFromQuery && tokenFromQuery === internalApiToken))
  ) {
    return;
  }

  const session = await useAuth().getCurrentSessionForEvent(event);
  event.context.session = session;
});
