const DEFAULT_ADDON_GUIDE_URL = "http://localhost:5173/#addon-guide";

export function getAddonGuideUrl() {
  const configuredUrl = window.__CONFIG__?.VITE_ADDON_GUIDE_URL?.trim();
  if (!configuredUrl) return DEFAULT_ADDON_GUIDE_URL;

  try {
    const url = new URL(configuredUrl);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.toString();
    }
  } catch {
    // Fall back to the local landing URL.
  }

  return DEFAULT_ADDON_GUIDE_URL;
}

export async function openAddonGuide() {
  const url = getAddonGuideUrl();
  const openExternal = window.electronAPI?.openExternal;

  if (typeof openExternal === "function") {
    await openExternal(url);
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}
