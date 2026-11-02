import { setHeader } from 'h3';

import { resolveFrontendOrigin } from '~/utils/frontendOrigin';

export default defineEventHandler(event => {
  setHeader(event, 'Content-Type', 'application/json');
  setHeader(event, 'Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');

  const frontendOrigin = resolveFrontendOrigin(event);

  return {
    id: 'community.framezoo.subtitles',
    version: '1.0.0',
    name: 'Framezoo Subtitles',
    description: 'Native subtitle provider (Wyzie, OpenSubtitles, SubSource, Granite)',
    logo: 'https://framezoo.top/favicon-192.png',
    resources: ['subtitles'],
    types: ['movie', 'series'],
    catalogs: [],
    behaviorHints: {
      configurable: true,
      configurationRequired: false,
      configurationUrl: `${frontendOrigin}/addon/subtitles/configure`,
    },
  };
});
