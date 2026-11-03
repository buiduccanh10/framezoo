import { isHearingImpairedCaption } from "@/components/player/utils/captions";
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

const GENERIC_SUBTITLE_LABELS = new Set([
  "vietnamese",
  "tieng viet",
  "tiếng việt",
  "english",
  "spanish",
  "french",
  "german",
  "italian",
  "portuguese",
  "russian",
  "chinese",
  "japanese",
  "korean",
  "arabic",
  "hindi",
  "unknown",
  "und",
  "default",
  "subtitles",
  "subtitle",
  "hearing impaired",
  "sdh",
  "forced",
]);

export function isGenericSubtitleLabel(
  label: string | undefined,
  language?: string,
): boolean {
  if (!label) return true;
  const normalized = label.trim().toLowerCase().replace(/\s+/g, " ");
  if (normalized.length === 0) return true;
  if (GENERIC_SUBTITLE_LABELS.has(normalized)) return true;
  if (language && normalized === language.trim().toLowerCase()) return true;
  return false;
}

export function extractSubtitleReleaseTitle(
  id?: string,
  language?: string,
): string | undefined {
  if (!id) return undefined;
  const trimmed = id.trim();
  // Strip trailing addon index suffix (e.g. "_1", "_15", "-1")
  const cleaned = trimmed.replace(/[_-]\d+$/, "").trim();

  if (cleaned.length <= 2) return undefined;

  // Check if it is a generic internal prefix (e.g. "sub-1", "subtitle_2", "track-3", "item-1")
  if (
    /^(sub|subs|subtitle|subtitles|track|item|caption|captions|id|idx)[-_]?\d*$/i.test(
      cleaned,
    )
  ) {
    return undefined;
  }

  // Purely numeric (e.g. "10195707" or "10195707.srt")
  if (/^\d+(\.(srt|vtt|sub|ass))?$/i.test(cleaned)) return undefined;

  // UUID or long hex hash (32+ chars)
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      cleaned,
    ) ||
    /^[0-9a-f]{32,}$/i.test(cleaned)
  ) {
    return undefined;
  }

  // IMDB id (e.g. "tt1375666" or "tt1375666:1:1")
  if (/^tt\d+(:[0-9:]+)?$/i.test(cleaned)) return undefined;

  // URL
  if (/^https?:\/\//i.test(cleaned)) return undefined;

  // Check if it's just a language code or generic label
  if (isGenericSubtitleLabel(cleaned, language)) return undefined;

  return cleaned;
}

export function extractAddonSubtitleLabel(
  sub: StremioSubtitle,
  language: string,
): string | undefined {
  const explicitLabel =
    sub.label?.trim() ||
    (sub as any).title?.trim() ||
    (sub as any).name?.trim() ||
    (sub as any).filename?.trim() ||
    (sub as any).file?.trim();

  // If label is present and not generic, use it
  if (explicitLabel && !isGenericSubtitleLabel(explicitLabel, language)) {
    return explicitLabel;
  }

  // Try extracting release name from sub.id
  const idRelease = extractSubtitleReleaseTitle(sub.id, language);
  if (idRelease) {
    return idRelease;
  }

  // Try extracting filename from URL path if present
  if (sub.url) {
    try {
      const pathname = new URL(sub.url).pathname;
      const filename = pathname.split("/").pop();
      if (filename) {
        const decoded = decodeURIComponent(filename).replace(
          /\.(srt|vtt|sub|ass)$/i,
          "",
        );
        const urlRelease = extractSubtitleReleaseTitle(decoded, language);
        if (urlRelease) return urlRelease;
      }
    } catch {
      // ignore invalid URLs
    }
  }

  // Fallback to explicit label if we had one
  if (explicitLabel) {
    return explicitLabel;
  }

  return undefined;
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
  _index: number,
): CaptionListItem | null {
  const url = sub.url?.trim();
  if (!url) return null;

  const language = (sub.lang ?? sub.language ?? "unknown").trim();
  const display = extractAddonSubtitleLabel(sub, language);
  const id = `addon:${addon.manifest.id}:${language}:${url}`;
  const isHearingImpaired = isHearingImpairedCaption({
    ...sub,
    display,
  });

  const isDisplayGeneric = isGenericSubtitleLabel(display, language);

  return {
    id,
    language,
    url,
    type: sub.type,
    needsProxy: false,
    opensubtitles: true,
    display: display ?? language,
    media: display && !isDisplayGeneric ? display : undefined,
    source: sub.source || addon.manifest.name,
    isHearingImpaired,
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
