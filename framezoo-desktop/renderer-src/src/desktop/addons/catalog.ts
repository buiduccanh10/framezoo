import {
  fetchComplianceBlocklist,
  isDomainInBlocklist,
  isImdbBlocked,
  isMediaBlocked,
} from "./blocklist";
import { fetchAddonJson } from "./client";
import { hasResource } from "./manifest";
import type { InstalledAddon } from "./types";

/**
 * Stremio catalog response shape.
 * Mirrors the protocol spec for /catalog/{type}/{id}.json
 */
export interface StremioMetaPreview {
  id: string;
  type: string;
  name: string;
  imdb_id?: string;
  tmdb_id?: string | number;
  poster?: string;
  posterShape?: "square" | "poster" | "landscape";
  background?: string;
  logo?: string;
  description?: string;
  releaseInfo?: string;
  imdbRating?: string;
  genres?: string[];
  director?: string[];
  cast?: string[];
  runtime?: string;
  released?: string;
  year?: number;
}

export type CatalogMediaIdentity =
  { kind: "imdb"; id: string } | { kind: "tmdb"; id: string };

/** Resolve a catalog item's app-facing identity without discarding addon IDs. */
export function getCatalogMediaIdentity(
  item: Pick<StremioMetaPreview, "id" | "imdb_id" | "tmdb_id">,
): CatalogMediaIdentity | null {
  const rawTmdbId = String(item.tmdb_id ?? "").trim();
  const tmdbId = rawTmdbId.replace(/^tmdb:/i, "");
  if (/^\d+$/.test(tmdbId)) {
    return { kind: "tmdb", id: tmdbId };
  }

  const rawImdbId = item.imdb_id?.trim() ?? "";
  if (/^tt\d+$/i.test(rawImdbId)) {
    return { kind: "imdb", id: rawImdbId };
  }

  const rawId = item.id.trim();
  if (/^tmdb:\d+$/i.test(rawId)) {
    return { kind: "tmdb", id: rawId.slice("tmdb:".length) };
  }
  if (/^tt\d+$/i.test(rawId)) {
    return { kind: "imdb", id: rawId };
  }

  return null;
}

export interface StremoCatalogResponse {
  metas?: StremioMetaPreview[];
}

export interface AddonCatalogEntry {
  /** The addon this item came from */
  addonId: string;
  addonName: string;
  item: StremioMetaPreview;
}

export interface AddonCatalogLoadError {
  addonId: string;
  addonName: string;
  message: string;
}

export interface AddonCatalogLoadResult {
  items: AddonCatalogEntry[];
  errors: AddonCatalogLoadError[];
}

/**
 * Returns a stable React Query cache key for a catalog request.
 */
export function getAddonCatalogQueryKey(
  addon: InstalledAddon,
  type: string,
  catalogId: string,
) {
  return [
    "addon-catalog",
    addon.manifest.id,
    addon.manifest.version,
    addon.manifestUrl,
    type,
    catalogId ?? "default",
  ] as const;
}

/**
 * Fetches a single catalog from one addon.
 * URL pattern: {baseUrl}/catalog/{type}/{catalogId}.json (with optional /skip={skip}.json)
 */
export async function loadAddonCatalog(
  addon: InstalledAddon,
  type: string,
  catalogId: string,
  options?: { skip?: number },
): Promise<StremioMetaPreview[]> {
  const blocklist = await fetchComplianceBlocklist().catch(() => null);
  if (
    blocklist &&
    isDomainInBlocklist(
      addon.manifestUrl || addon.baseUrl,
      blocklist.addonDomains,
    )
  ) {
    return [];
  }

  const skip = options?.skip;
  const path =
    skip && skip > 0
      ? `catalog/${type}/${encodeURIComponent(catalogId)}/skip=${skip}.json`
      : `catalog/${type}/${encodeURIComponent(catalogId)}.json`;
  const url = new URL(path, addon.baseUrl);
  if (skip && skip > 0) {
    url.searchParams.set("skip", String(skip));
  }

  console.debug("[desktop-addon] catalog request", {
    addonId: addon.manifest.id,
    addonName: addon.manifest.name,
    type,
    catalogId,
    skip,
    url: url.toString(),
  });

  const response = await fetchAddonJson<StremoCatalogResponse>(url.toString(), {
    manifestUrl: addon.manifestUrl,
    resource: "catalog",
    type,
    catalogId,
  });

  const rawMetas = Array.isArray(response)
    ? (response as StremioMetaPreview[])
    : response && Array.isArray(response.metas)
      ? response.metas
      : null;

  if (!rawMetas) {
    console.warn("[desktop-addon] catalog returned unexpected shape", {
      addonId: addon.manifest.id,
      response,
    });
    return [];
  }

  if (
    !blocklist ||
    (blocklist.tmdbIds.length === 0 && blocklist.imdbIds.length === 0)
  ) {
    return rawMetas;
  }

  return rawMetas.filter((item) => {
    const identity = getCatalogMediaIdentity(item);
    if (!identity) return true;
    if (identity.kind === "tmdb") {
      return !isMediaBlocked(identity.id, item.type || type, blocklist.tmdbIds);
    }
    return !isImdbBlocked(identity.id, blocklist.imdbIds);
  });
}

/**
 * Queries all enabled addons that support the "catalog" resource in parallel
 * for the given content type and catalog id. Merges all results.
 *
 * Failures from individual addons are reported in the `errors` field and
 * do NOT prevent results from other addons from being returned.
 */
export async function loadAllAddonCatalogs(
  addons: InstalledAddon[],
  type: string,
  catalogId?: string,
  options?: { skip?: number; addonId?: string; excludeAddonIds?: string[] },
): Promise<AddonCatalogLoadResult> {
  const eligibleAddons = addons
    .filter((addon) => addon.enabled)
    .filter((addon) => hasResource(addon, "catalog"))
    .filter(
      (addon) => !options?.addonId || addon.manifest.id === options.addonId,
    )
    .filter(
      (addon) =>
        !options?.excludeAddonIds ||
        !options.excludeAddonIds.includes(addon.manifest.id),
    )
    .filter(
      (addon) =>
        !addon.manifest.catalogs?.length ||
        addon.manifest.catalogs.some(
          (cat) => cat.type === type && (!catalogId || cat.id === catalogId),
        ),
    );

  console.debug("[desktop-addon] catalog eligible addons", {
    type,
    catalogId,
    addons: eligibleAddons.map((a) => ({
      id: a.manifest.id,
      name: a.manifest.name,
    })),
  });

  const results = await Promise.allSettled(
    eligibleAddons.map(async (addon) => {
      // If catalogId is not provided, use the first catalog of this type, or default to "top"
      const targetCatalogId =
        catalogId ??
        (addon.manifest.catalogs?.find((c) => c.type === type)?.id as
          string | undefined) ??
        "top";

      const metas = await loadAddonCatalog(
        addon,
        type,
        targetCatalogId,
        options,
      );
      console.debug("[desktop-addon] catalog loaded", {
        addonId: addon.manifest.id,
        catalogId: targetCatalogId,
        count: metas.length,
      });
      return { addon, metas };
    }),
  );

  const items: AddonCatalogEntry[] = [];
  const errors: AddonCatalogLoadError[] = [];

  results.forEach((result, index) => {
    const addon = eligibleAddons[index];
    if (!addon) return;

    if (result.status === "fulfilled") {
      result.value.metas.forEach((item) => {
        items.push({
          addonId: addon.manifest.id,
          addonName: addon.manifest.name,
          item,
        });
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

    console.error("[desktop-addon] catalog request failed", {
      addonId: addon.manifest.id,
      addonName: addon.manifest.name,
      type,
      catalogId,
      message,
    });
  });

  return { items, errors };
}
