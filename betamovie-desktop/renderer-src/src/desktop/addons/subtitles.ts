import type { CaptionListItem } from "@/stores/player/slices/source";

import { hasResource } from "./manifest";
import type { InstalledAddon, StremioSubtitle } from "./types";

export interface StremioSubtitleResponse {
  subtitles?: StremioSubtitle[];
}

export interface AddonSubtitleLoadError {
  addonId: string;
  addonName: string;
  message: string;
}

export interface AddonSubtitleLoadResult {
  captions: CaptionListItem[];
  errors: AddonSubtitleLoadError[];
}

const SUBTITLE_REQUEST_TIMEOUT_MS = 15_000;

async function fetchSubtitleJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(
    () => controller.abort(),
    SUBTITLE_REQUEST_TIMEOUT_MS,
  );

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Request failed with HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        `Subtitle request timed out after ${SUBTITLE_REQUEST_TIMEOUT_MS}ms: ${url}`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

/**
 * Normalizes a raw StremioSubtitle from an addon into the internal
 * CaptionListItem format used by the player.
 *
 * The `source` field is set to the addon name so the subtitle panel can
 * display "English • SubDL" style labels.
 */
export function normalizeAddonSubtitle(
  addon: InstalledAddon,
  sub: StremioSubtitle,
  index: number,
): CaptionListItem | null {
  const url = sub.url?.trim();
  if (!url) return null;

  const language = (sub.lang ?? sub.language ?? "unknown").trim();
  const display = sub.label?.trim() || undefined;
  const id = `addon:${addon.manifest.id}:${index}:${url}`;

  return {
    id,
    language,
    url,
    needsProxy: false,
    // opensubtitles flag controls subtitle alignment; addon subtitles are not
    // from OpenSubtitles so we leave it false.
    opensubtitles: false,
    display: display ?? language,
    source: addon.manifest.name,
  };
}

/**
 * Fetches subtitles from a single addon.
 * URL pattern: {baseUrl}/subtitles/{type}/{id}.json
 *
 * For series: id should be formatted as "{imdbId}:{season}:{episode}"
 */
export async function loadAddonSubtitles(
  addon: InstalledAddon,
  type: string,
  id: string,
): Promise<CaptionListItem[]> {
  const url = new URL(
    `subtitles/${type}/${encodeURIComponent(id)}.json`,
    addon.baseUrl,
  );

  console.debug("[desktop-addon] subtitle request", {
    addonId: addon.manifest.id,
    addonName: addon.manifest.name,
    type,
    id,
    url: url.toString(),
  });

  const response = await fetchSubtitleJson<
    StremioSubtitleResponse | StremioSubtitle[]
  >(url.toString());

  const rawSubs: StremioSubtitle[] = Array.isArray(response)
    ? response
    : (response?.subtitles ?? []);

  return rawSubs
    .map((sub, i) => normalizeAddonSubtitle(addon, sub, i))
    .filter((item): item is CaptionListItem => item !== null);
}

/**
 * Queries all enabled addons that support the "subtitles" resource in parallel,
 * then merges and de-duplicates the results.
 *
 * Failures from individual addons are logged and returned in `errors` — they
 * do NOT prevent results from other addons from being returned.
 */
export async function loadAllAddonSubtitles(
  addons: InstalledAddon[],
  type: string,
  id: string,
): Promise<AddonSubtitleLoadResult> {
  const eligibleAddons = addons
    .filter((addon) => addon.enabled)
    .filter((addon) => hasResource(addon, "subtitles"));

  console.debug("[desktop-addon] subtitle eligible addons", {
    type,
    id,
    addons: eligibleAddons.map((a) => ({
      id: a.manifest.id,
      name: a.manifest.name,
    })),
  });

  const results = await Promise.allSettled(
    eligibleAddons.map((addon) => loadAddonSubtitles(addon, type, id)),
  );

  const seen = new Set<string>();
  const captions: CaptionListItem[] = [];
  const errors: AddonSubtitleLoadError[] = [];

  results.forEach((result, index) => {
    const addon = eligibleAddons[index];
    if (!addon) return;

    if (result.status === "fulfilled") {
      for (const caption of result.value) {
        // De-duplicate by URL
        if (!seen.has(caption.url)) {
          seen.add(caption.url);
          captions.push(caption);
        }
      }
      console.debug("[desktop-addon] subtitles loaded", {
        addonId: addon.manifest.id,
        count: result.value.length,
      });
      return;
    }

    const message =
      result.reason instanceof Error
        ? result.reason.message
        : String(result.reason ?? "Unknown addon error");

    errors.push({
      addonId: addon.manifest.id,
      addonName: addon.manifest.name,
      message,
    });

    console.error("[desktop-addon] subtitle request failed", {
      addonId: addon.manifest.id,
      addonName: addon.manifest.name,
      type,
      id,
      message,
    });
  });

  return { captions, errors };
}
