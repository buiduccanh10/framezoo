import fs from "node:fs";
import { createReadStream } from "node:fs";
import path from "node:path";
import { getRouterParam, sendStream, setHeader } from "h3";

import {
  DEFAULT_DESKTOP_UPDATE_CHANNEL,
  resolveDesktopUpdateRequest,
} from "../../../utils/desktopRelease";

function getContentType(fileName: string) {
  if (fileName.endsWith(".yml")) return "application/x-yaml; charset=utf-8";
  if (fileName.endsWith(".json")) return "application/json; charset=utf-8";
  if (fileName.endsWith(".blockmap")) return "application/octet-stream";
  if (fileName.endsWith(".dmg")) return "application/x-apple-diskimage";
  if (fileName.endsWith(".zip")) return "application/zip";
  if (fileName.endsWith(".exe")) return "application/vnd.microsoft.portable-executable";
  return "application/octet-stream";
}

function getCacheControl(fileName: string) {
  if (fileName.endsWith(".yml") || fileName.endsWith(".json")) {
    return "public, max-age=60, stale-while-revalidate=300";
  }

  return "public, max-age=31536000, immutable";
}

export default defineEventHandler(async event => {
  const channel =
    getRouterParam(event, "channel")?.trim() || DEFAULT_DESKTOP_UPDATE_CHANNEL;
  const requestedPath = getRouterParam(event, "path")?.trim();

  if (!requestedPath) {
    throw createError({
      statusCode: 404,
      message: "Update file not found",
    });
  }

  const resolved = resolveDesktopUpdateRequest(channel, requestedPath);
  if (!resolved) {
    throw createError({
      statusCode: 404,
      message: "Update file not found",
    });
  }

  setHeader(event, "Cache-Control", getCacheControl(resolved.fileName));
  setHeader(event, "Content-Type", getContentType(resolved.fileName));
  setHeader(event, "Content-Length", fs.statSync(resolved.filePath).size);
  setHeader(
    event,
    "Content-Disposition",
    `inline; filename="${path.basename(resolved.fileName)}"`,
  );

  return sendStream(event, createReadStream(resolved.filePath));
});
