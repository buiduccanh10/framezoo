import { defineEventHandler, getQuery, sendRedirect } from 'h3';

import { resolveFrontendOrigin } from '~/utils/frontendOrigin';

export default defineEventHandler(event => {
  const query = getQuery(event);
  const frontendOrigin = resolveFrontendOrigin(event);
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (typeof value === 'string') {
      searchParams.set(key, value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') {
          searchParams.append(key, item);
        }
      }
    }
  }

  const queryString = searchParams.toString();
  const targetUrl = `${frontendOrigin}/addon/subtitles/configure${queryString ? `?${queryString}` : ''}`;

  return sendRedirect(event, targetUrl, 302);
});
