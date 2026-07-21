import { sendExtensionRequest } from "@/backend/extension/messaging";

import { normalizeManifest, normalizeManifestUrl } from "./manifest";
import type {
  InstalledAddon,
  StremioManifest,
  StremioStream,
  StremioStreamResponse,
} from "./types";

const ADDON_REQUEST_TIMEOUT_MS = 15_000;

function requestTimeoutError(url: string) {
  return new Error(
    `Addon request timed out after ${ADDON_REQUEST_TIMEOUT_MS}ms: ${url}`,
  );
}

async function fetchWithTimeout(url: string) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(
    () => controller.abort(),
    ADDON_REQUEST_TIMEOUT_MS,
  );

  try {
    return await fetch(url, {
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) throw requestTimeoutError(url);
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const fetchFromRenderer = async () => {
    const startedAt = Date.now();
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      throw new Error(`Request failed with HTTP ${response.status}`);
    }
    console.debug("[desktop-addon] renderer request completed", {
      url,
      elapsedMs: Date.now() - startedAt,
      status: response.status,
    });
    return (await response.json()) as T;
  };

  const fetchFromDesktop = async () => {
    const startedAt = Date.now();
    const result = await sendExtensionRequest<T>(
      {
        url,
        method: "GET",
      },
      ADDON_REQUEST_TIMEOUT_MS,
    );
    if (!result?.success) {
      throw new Error(result?.error ?? `Request failed: ${url}`);
    }
    if (result.response.statusCode < 200 || result.response.statusCode >= 300) {
      throw new Error(`Request failed with HTTP ${result.response.statusCode}`);
    }

    console.debug("[desktop-addon] Electron request completed", {
      url,
      elapsedMs: Date.now() - startedAt,
      status: result.response.statusCode,
    });

    const body = result.response.body;
    if (typeof body !== "string") return body;

    try {
      return JSON.parse(body) as T;
    } catch {
      throw new Error("Addon returned invalid JSON");
    }
  };

  const desktopApi = window.electronAPI;
  if (
    window.__ALPHAFLIX_DESKTOP__ &&
    typeof desktopApi?.sendExtensionMessage === "function"
  ) {
    const requests = [fetchFromRenderer(), fetchFromDesktop()];
    try {
      return await Promise.any(requests);
    } catch (bridgeError) {
      const errors =
        bridgeError instanceof AggregateError
          ? bridgeError.errors
          : [bridgeError];
      const messages = errors.map((error) =>
        error instanceof Error ? error.message : String(error),
      );
      throw new Error(
        `All addon request transports failed: ${messages.join("; ")}`,
      );
    }
  }

  return fetchFromRenderer();
}

export async function loadAddonManifest(input: string) {
  const manifestUrl = normalizeManifestUrl(input);
  const manifest = await fetchJson<StremioManifest>(manifestUrl);
  return normalizeManifest(manifestUrl, manifest);
}

export async function loadAddonStreams(
  addon: InstalledAddon,
  media: {
    type: "movie" | "series";
    id: string;
    season?: number;
    episode?: number;
  },
) {
  const mediaId =
    media.type === "series" && media.season != null && media.episode != null
      ? `${media.id}:${media.season}:${media.episode}`
      : media.id;
  const url = new URL(
    `stream/${media.type}/${encodeURIComponent(mediaId)}.json`,
    addon.baseUrl,
  );
  console.debug("[desktop-addon] stream request", {
    addonId: addon.manifest.id,
    addonName: addon.manifest.name,
    mediaType: media.type,
    mediaId,
    url: url.toString(),
  });

  const response = await fetchJson<StremioStreamResponse | StremioStream[]>(
    url.toString(),
  );
  if (Array.isArray(response)) return response;
  if (response && Array.isArray(response.streams)) return response.streams;

  throw new Error("Addon returned an invalid stream response");
}
