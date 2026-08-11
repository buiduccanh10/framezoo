import { createReadStream } from "node:fs";
import fs from "node:fs";
import { getQuery, sendStream, setHeader } from "h3";

import {
  DEFAULT_DESKTOP_UPDATE_CHANNEL,
  getDesktopDownloadOptionById,
  getDesktopDownloadOptions,
  readDesktopReleaseManifest,
  resolveDesktopReleaseFilePath,
} from "../utils/desktopRelease";
import { recordUniqueDownload } from "../utils/downloadTracking";
import { scopedLogger } from "../utils/logger";

const log = scopedLogger('download-route');

export default defineEventHandler(async event => {
  const { option } = getQuery(event);
  const normalizedOption =
    typeof option === 'string'
      ? option.trim()
      : Array.isArray(option)
        ? option[0]?.trim() || ''
        : '';

  const manifest = readDesktopReleaseManifest(DEFAULT_DESKTOP_UPDATE_CHANNEL);

  if (normalizedOption) {
    const downloadOption = manifest
      ? getDesktopDownloadOptionById(manifest, normalizedOption)
      : null;

    if (!downloadOption) {
      throw createError({
        statusCode: 404,
        message: 'Download option not found',
      });
    }

    const filePath = resolveDesktopReleaseFilePath(
      DEFAULT_DESKTOP_UPDATE_CHANNEL,
      downloadOption.path,
    );
    if (!filePath || !fs.existsSync(filePath)) {
      throw createError({
        statusCode: 404,
        message: 'Download file is not available',
      });
    }

    try {
      await recordUniqueDownload(
        event,
        manifest?.version ?? 'unknown',
        downloadOption.id,
      );
    } catch (error) {
      log.warn('Failed to record unique desktop download', {
        evt: 'download_unique_record_error',
        version: manifest?.version ?? 'unknown',
        optionId: downloadOption.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    setHeader(
      event,
      "Content-Disposition",
      `attachment; filename="${downloadOption.fileName}"`,
    );
    setHeader(event, "Content-Type", "application/octet-stream");
    setHeader(event, "Content-Length", fs.statSync(filePath).size);
    return sendStream(event, createReadStream(filePath));
  }

  setHeader(event, 'Cache-Control', 'public, max-age=300');

  return {
    version: manifest?.version ?? null,
    options: manifest
      ? getDesktopDownloadOptions(manifest).map((entry) => ({
          id: entry.id,
          label: entry.label,
          description: entry.description,
          url: `/download?option=${entry.id}`,
        }))
      : [],
  };
});
