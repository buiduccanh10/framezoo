export function extractAddonHostname(rawUrl: string): string | null {
  try {
    const normalized = rawUrl.includes('://') ? rawUrl : `https://${rawUrl}`;
    return new URL(normalized).hostname.toLowerCase().replace(/\.+$/, '') || null;
  } catch {
    return null;
  }
}

export function isAddonDomainBlocked(
  urlOrHost: string,
  blockedDomains: string[],
): boolean {
  if (!urlOrHost || blockedDomains.length === 0) return false;
  const host = extractAddonHostname(urlOrHost);
  if (!host) return false;
  return blockedDomains.some((entry) => {
    const domain = entry.trim().toLowerCase().replace(/^\*\./, '');
    return Boolean(domain) && (host === domain || host.endsWith(`.${domain}`));
  });
}
