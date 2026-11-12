import { setHeader } from 'h3';

import { fetchDesktopDownloadManifest, fetchDesktopTotalDownloads } from '../utils/desktopRelease';

export default defineEventHandler(async event => {
  const [manifest, totalDownloads] = await Promise.all([
    fetchDesktopDownloadManifest(),
    fetchDesktopTotalDownloads(),
  ]);

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
    totalDownloads: totalDownloads ?? null,
  };
});
