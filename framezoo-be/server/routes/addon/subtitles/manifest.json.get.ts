import { setHeader } from 'h3';

export default defineEventHandler(event => {
  setHeader(event, 'Content-Type', 'application/json');
  setHeader(event, 'Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');

  return {
    id: 'community.framezoo.subtitles',
    version: '1.0.0',
    name: 'Framezoo Subtitles',
    description: 'Native subtitle provider (Wyzie, OpenSubtitles, SubSource, Granite)',
    resources: ['subtitles'],
    types: ['movie', 'series'],
    catalogs: [],
    behaviorHints: {
      configurable: false,
    },
  };
});
