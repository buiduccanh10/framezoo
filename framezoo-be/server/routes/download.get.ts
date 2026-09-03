import { getQuery, sendRedirect, setHeader } from 'h3';

import { fetchDesktopDownloadManifest } from '../utils/desktopRelease';
import { recordUniqueDownload } from '../utils/downloadTracking';
import { scopedLogger } from '../utils/logger';

const log = scopedLogger('download-route');

export default defineEventHandler(async event => {
  const { option } = getQuery(event);
  const normalizedOption =
    typeof option === 'string'
      ? option.trim()
      : Array.isArray(option)
        ? option[0]?.trim() || ''
        : '';

  const manifest = await fetchDesktopDownloadManifest();

  if (normalizedOption) {
    const downloadOption = manifest?.options.find(option => option.id === normalizedOption);

    if (!downloadOption) {
      throw createError({
        statusCode: 404,
        message: 'Download option not found',
      });
    }

    try {
      await recordUniqueDownload(event, manifest?.version ?? 'unknown', downloadOption.id);
    } catch (error) {
      log.warn('Failed to record unique desktop download', {
        evt: 'download_unique_record_error',
        version: manifest?.version ?? 'unknown',
        optionId: downloadOption.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return sendRedirect(event, downloadOption.url, 302);
  }

  setHeader(event, 'Cache-Control', 'public, max-age=300');

  return {
    version: manifest?.version ?? null,
    options:
      manifest?.options.map(entry => ({
        id: entry.id,
        label: entry.label,
        description: entry.description,
        url: `/download?option=${entry.id}`,
      })) ?? [],
  };
});
