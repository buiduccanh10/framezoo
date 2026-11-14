export const APP_VERSION_PATTERN = /^[a-zA-Z0-9._+-]{1,40}$/;

export function extractAppVersionFromHeaders(
  appVersionHeader?: string | null,
  userAgent?: string | null
): string | null {
  const trimmed = typeof appVersionHeader === 'string' ? appVersionHeader.trim() : '';
  if (trimmed && APP_VERSION_PATTERN.test(trimmed)) {
    return trimmed;
  }

  if (userAgent) {
    const match = userAgent.match(/Framezoo\/([a-zA-Z0-9._+-]{1,40})/i);
    if (match?.[1]) return match[1];
  }

  return null;
}

export function resolveSessionClientUpdate(input: {
  headerAppVersion?: string | null;
  explicitAppVersion?: string | null;
  requestUserAgent?: string | null;
  storedAppVersion?: string | null;
  storedUserAgent?: string | null;
}): {
  detectedVersion: string | null;
  nextVersion?: string;
  nextUserAgent?: string;
} {
  const liveUa =
    typeof input.requestUserAgent === 'string' ? input.requestUserAgent.trim().slice(0, 1024) : '';
  const detectedVersion =
    extractAppVersionFromHeaders(input.explicitAppVersion) ??
    extractAppVersionFromHeaders(input.headerAppVersion, liveUa || input.storedUserAgent);

  return {
    detectedVersion,
    nextVersion:
      detectedVersion && detectedVersion !== input.storedAppVersion ? detectedVersion : undefined,
    nextUserAgent: liveUa && liveUa !== input.storedUserAgent ? liveUa : undefined,
  };
}
