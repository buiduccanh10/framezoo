import { getQuery, getRequestHeader, type H3Event } from 'h3';

export function resolveFrontendOrigin(event: H3Event, requestedOrigin?: string): string {
  const query = getQuery(event);
  const explicitRequested = (
    (typeof requestedOrigin === 'string' ? requestedOrigin : '') ||
    (typeof query.frontendOrigin === 'string' ? query.frontendOrigin : '') ||
    getRequestHeader(event, 'x-frontend-origin') ||
    ''
  )
    .trim()
    .replace(/\/+$/, '');

  if (explicitRequested && explicitRequested !== 'null') {
    return explicitRequested;
  }

  const appDomain = (process.env.APP_DOMAIN || '').trim().replace(/\/+$/, '');
  if (appDomain && !appDomain.includes(',')) {
    return appDomain;
  }

  const envFrontend = (process.env.FRONTEND_ORIGIN || '').trim();
  if (envFrontend) {
    const list = envFrontend
      .split(',')
      .map(s => s.trim().replace(/\/+$/, ''))
      .filter(Boolean);
    if (list.length > 0) {
      return list[0];
    }
  }

  const rawHost =
    getRequestHeader(event, 'x-forwarded-host') ||
    getRequestHeader(event, 'host') ||
    'framezoo.top';
  const proto = getRequestHeader(event, 'x-forwarded-proto') || 'https';
  let host = rawHost;
  if (host.startsWith('api.')) {
    host = host.replace(/^api\./, '');
  } else if (host.includes(':3000')) {
    host = host.replace(':3000', '');
  }
  return `${proto}://${host}`;
}
