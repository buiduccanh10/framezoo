import { conf } from "@/setup/config";
import type { CaptionListItem } from "@/stores/player/slices/source";

import { fetchAddonJson } from "./client";
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

export interface AddonSubtitleProgressUpdate {
  captions: CaptionListItem[];
  completed: number;
  total: number;
  addonName?: string;
}

/**
 * Normalizes a raw StremioSubtitle from an addon into the internal
 * CaptionListItem format used by the player.
 *
 * The `source` field is set to the provider source or addon name so the subtitle panel can
 * display "English • Wyzie" style labels.
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
    type: sub.type,
    needsProxy: false,
    opensubtitles: true,
    display: display ?? language,
    source: sub.source || addon.manifest.name,
    isHearingImpaired: sub.isHearingImpaired,
    encoding: sub.encoding,
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
  options?: {
    forceRefresh?: boolean;
    preferredLanguages?: string[];
  },
): Promise<CaptionListItem[]> {
  let baseUrl = addon.baseUrl || "";
  if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
    const config = conf();
    const backend =
      config.BACKEND_URL ||
      (config.BACKEND_URLS.length > 0 ? config.BACKEND_URLS[0] : "") ||
      (typeof window !== "undefined" ? window.location.origin : "");
    const cleanBackend = backend ? backend.replace(/\/+$/, "") : "";
    const cleanPath = baseUrl.replace(/^\/+/, "");
    baseUrl = cleanPath ? `${cleanBackend}/${cleanPath}` : `${cleanBackend}/`;
  }
  if (!baseUrl.endsWith("/")) {
    baseUrl = `${baseUrl}/`;
  }

  const url = new URL(
    `subtitles/${type}/${encodeURIComponent(id)}.json`,
    baseUrl,
  );
  if (options?.forceRefresh) {
    url.searchParams.set("reload", Date.now().toString());
  }
  if (options?.preferredLanguages?.length) {
    url.searchParams.set(
      "language",
      Array.from(
        new Set(
          options.preferredLanguages
            .map((language) => language.trim().toLowerCase())
            .filter(Boolean),
        ),
      ).join(","),
    );
  }

  console.debug("[desktop-addon] subtitle request", {
    addonId: addon.manifest.id,
    addonName: addon.manifest.name,
    type,
    id,
    url: url.toString(),
  });

  const response = await fetchAddonJson<
    StremioSubtitleResponse | StremioSubtitle[]
  >(url.toString(), {
    manifestUrl: addon.manifestUrl,
    resource: "subtitles",
    type,
    id,
    ...(options?.forceRefresh
      ? {
          cacheBust: url.searchParams.get("reload") ?? Date.now().toString(),
        }
      : {}),
  });

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
  onProgress?: (update: AddonSubtitleProgressUpdate) => void,
  options?: {
    forceRefresh?: boolean;
    preferredLanguages?: string[];
  },
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

  const total = Math.max(eligibleAddons.length, 1);
  if (eligibleAddons.length === 0) {
    return { captions: [], errors: [] };
  }

  // Report initial progress
  onProgress?.({
    captions: [],
    completed: 0,
    total,
  });

  const seen = new Set<string>();
  const captions: CaptionListItem[] = [];
  const errors: AddonSubtitleLoadError[] = [];
  let completed = 0;

  await Promise.all(
    eligibleAddons.map(async (addon) => {
      try {
        const addonCaptions = await loadAddonSubtitles(
          addon,
          type,
          id,
          options,
        );
        const newCaptions: CaptionListItem[] = [];
        for (const caption of addonCaptions) {
          if (!seen.has(caption.url)) {
            seen.add(caption.url);
            captions.push(caption);
            newCaptions.push(caption);
          }
        }
        completed += 1;
        onProgress?.({
          captions: newCaptions,
          completed,
          total,
          addonName: addon.manifest.name,
        });
      } catch (err: unknown) {
        completed += 1;
        const message =
          err instanceof Error
            ? err.message
            : String(err ?? "Unknown addon error");
        errors.push({
          addonId: addon.manifest.id,
          addonName: addon.manifest.name,
          message,
        });
        onProgress?.({
          captions: [],
          completed,
          total,
          addonName: addon.manifest.name,
        });
      }
    }),
  );

  return { captions, errors };
}
