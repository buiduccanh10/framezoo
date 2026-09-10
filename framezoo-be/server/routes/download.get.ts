import { setHeader } from 'h3';

import { fetchDesktopDownloadManifest } from '../utils/desktopRelease';

export default defineEventHandler(async event => {
  const manifest = await fetchDesktopDownloadManifest();

  setHeader(event, 'Cache-Control', 'no-store');

  return {
    version: manifest?.version ?? null,
    options:
      manifest?.options.map(entry => ({
        id: entry.id,
        label: entry.label,
        description: entry.description,
        url: entry.url,
      })) ?? [],
  };
});
