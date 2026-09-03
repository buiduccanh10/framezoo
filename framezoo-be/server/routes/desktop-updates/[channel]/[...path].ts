import { getRouterParam, sendRedirect, setHeader } from 'h3';

import {
  DEFAULT_DESKTOP_UPDATE_CHANNEL,
  getDesktopGitHubReleaseAssetUrl,
  isSafeDesktopUpdateChannel,
} from '../../../utils/desktopRelease';

function getCacheControl(fileName: string) {
  if (fileName.endsWith('.yml') || fileName.endsWith('.json')) {
    return 'public, max-age=60, stale-while-revalidate=300';
  }

  return 'public, max-age=31536000, immutable';
}

export default defineEventHandler(async event => {
  const channel = getRouterParam(event, 'channel')?.trim() || DEFAULT_DESKTOP_UPDATE_CHANNEL;
  const requestedPath = getRouterParam(event, 'path')?.trim();

  if (!isSafeDesktopUpdateChannel(channel)) {
    throw createError({
      statusCode: 404,
      message: 'Update file not found',
    });
  }

  if (!requestedPath) {
    throw createError({
      statusCode: 404,
      message: 'Update file not found',
    });
  }

  const normalizedPath = requestedPath.replace(/^\/+/, '');
  const pathParts = normalizedPath.split('/');
  if (
    pathParts.length > 2 ||
    pathParts.some(part => part.length === 0 || part === '.' || part === '..')
  ) {
    throw createError({
      statusCode: 404,
      message: 'Update file not found',
    });
  }

  const fileName = pathParts[pathParts.length - 1];
  const releaseUrl = getDesktopGitHubReleaseAssetUrl(fileName);
  if (!releaseUrl) {
    throw createError({
      statusCode: 404,
      message: 'Update file not found',
    });
  }

  setHeader(event, 'Cache-Control', getCacheControl(fileName));
  return sendRedirect(event, releaseUrl, 302);
});
