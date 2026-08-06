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
 * URL pattern: {baseUrl}/catalog/{type}/{catalogId}.json
 */
export async function loadAddonCatalog(
  addon: InstalledAddon,
  type: string,
  catalogId: string,
): Promise<StremioMetaPreview[]> {
  const url = new URL(
    `catalog/${type}/${encodeURIComponent(catalogId)}.json`,
    addon.baseUrl,
  );

  console.debug("[desktop-addon] catalog request", {
    addonId: addon.manifest.id,
    addonName: addon.manifest.name,
    type,
    catalogId,
    url: url.toString(),
  });

  const response = await fetchAddonJson<StremoCatalogResponse>(url.toString(), {
    manifestUrl: addon.manifestUrl,
    resource: "catalog",
    type,
    catalogId,
  });

  if (Array.isArray(response)) return response as StremioMetaPreview[];
  if (response && Array.isArray(response.metas)) return response.metas;

  console.warn("[desktop-addon] catalog returned unexpected shape", {
    addonId: addon.manifest.id,
    response,
  });
  return [];
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
): Promise<AddonCatalogLoadResult> {
  const eligibleAddons = addons
    .filter((addon) => addon.enabled)
    .filter((addon) => hasResource(addon, "catalog"))
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
          | string
          | undefined) ??
        "top";

      const metas = await loadAddonCatalog(addon, type, targetCatalogId);
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
