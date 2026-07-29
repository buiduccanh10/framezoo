export const APP_DOWNLOAD_OPTION_IDS = [
  "mac-arm64",
  "mac-x64",
  "mac-universal",
  "win-x64",
  "win-arm64",
] as const;

export type AppDownloadOptionId = (typeof APP_DOWNLOAD_OPTION_IDS)[number];

export interface AppDownloadOption {
  id: AppDownloadOptionId;
  label: string;
  description: string;
  url: string;
}

export interface AppDownloadManifest {
  version: string | null;
  options: AppDownloadOption[];
}

export class DownloadManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DownloadManifestError";
  }
}

function isDownloadOptionId(value: unknown): value is AppDownloadOptionId {
  return (
    typeof value === "string" &&
    (APP_DOWNLOAD_OPTION_IDS as readonly string[]).includes(value)
  );
}

function getAbsoluteUrl(value: string, backendUrl: string) {
  const baseUrl =
    typeof window !== "undefined" ? window.location.origin : "http://localhost";

  let resolved: URL;
  try {
    resolved = new URL(value, new URL(backendUrl, baseUrl));
  } catch {
    throw new DownloadManifestError("Download URL is invalid.");
  }

  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
    throw new DownloadManifestError("Download URL protocol is invalid.");
  }

  return resolved.toString();
}

export function validateAppDownloadManifest(
  value: unknown,
  backendUrl: string,
): AppDownloadManifest {
  if (!value || typeof value !== "object") {
    throw new DownloadManifestError("Download manifest is invalid.");
  }

  const manifest = value as {
    version?: unknown;
    options?: unknown;
  };

  if (manifest.version !== null && typeof manifest.version !== "string") {
    throw new DownloadManifestError("Download manifest version is invalid.");
  }

  if (!Array.isArray(manifest.options)) {
    throw new DownloadManifestError("Download manifest options are invalid.");
  }

  const seenIds = new Set<string>();
  const options = manifest.options.map((optionValue) => {
    if (!optionValue || typeof optionValue !== "object") {
      throw new DownloadManifestError("Download option is invalid.");
    }

    const option = optionValue as {
      id?: unknown;
      label?: unknown;
      description?: unknown;
      url?: unknown;
    };

    if (
      !isDownloadOptionId(option.id) ||
      seenIds.has(option.id) ||
      typeof option.label !== "string" ||
      typeof option.description !== "string" ||
      typeof option.url !== "string" ||
      option.label.trim().length === 0 ||
      option.description.trim().length === 0 ||
      option.url.trim().length === 0
    ) {
      throw new DownloadManifestError("Download option is invalid.");
    }

    seenIds.add(option.id);

    return {
      id: option.id,
      label: option.label.trim(),
      description: option.description.trim(),
      url: getAbsoluteUrl(option.url, backendUrl),
    };
  });

  return {
    version:
      typeof manifest.version === "string"
        ? manifest.version.trim() || null
        : null,
    options,
  };
}

export function getConfiguredBackendUrl() {
  const runtimeConfig =
    typeof window !== "undefined"
      ? (window as Window & { __CONFIG__?: Record<string, unknown> }).__CONFIG__
      : undefined;
  const value =
    runtimeConfig?.VITE_BACKEND_URL ?? import.meta.env.VITE_BACKEND_URL;

  if (typeof value !== "string" || value.trim().length === 0) return null;

  return value.trim().replace(/\/+$/, "");
}

export async function getAppDownloadManifest(
  backendUrl: string,
): Promise<AppDownloadManifest> {
  const endpoint = getAbsoluteUrl("/download", backendUrl);
  const response = await fetch(endpoint, {
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new DownloadManifestError(
      `Download manifest request failed with status ${response.status}.`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new DownloadManifestError("Download manifest response is invalid.");
  }

  return validateAppDownloadManifest(payload, backendUrl);
}
