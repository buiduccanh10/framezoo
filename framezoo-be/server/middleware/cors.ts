import { applyCorsHeaders, resolveCorsOrigin } from '~/utils/cors';

export default defineEventHandler(event => {
  applyCorsHeaders(event);

  if (event.method === 'OPTIONS') {
    if (getRequestHeader(event, 'origin') && !resolveCorsOrigin(event)) {
      throw createError({
        statusCode: 403,
        statusMessage: 'CORS origin not allowed',
      });
    }
    event.node.res.statusCode = 204;
    return '';
  }
});
