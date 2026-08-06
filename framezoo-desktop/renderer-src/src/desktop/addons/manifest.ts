import type { InstalledAddon, StremioManifest, StremioResource } from "./types";

export function normalizeManifestUrl(input: string) {
  const url = new URL(input.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Addon manifest must use HTTP or HTTPS");
  }
  return url.toString();
}

export function normalizeManifest(
  manifestUrl: string,
  value: unknown,
): InstalledAddon {
  const url = normalizeManifestUrl(manifestUrl);
  if (!value || typeof value !== "object") {
    throw new Error("Addon manifest is not a JSON object");
  }

  const manifest = value as Partial<StremioManifest>;
  const id = normalizeRequiredManifestField(manifest.id, "id");
  const version = normalizeRequiredManifestField(manifest.version, "version");
  const name = normalizeRequiredManifestField(manifest.name, "name");

  if (!id || !version || !name) {
    throw new Error("Addon manifest requires id, version, and name");
  }

  const normalizedManifest: StremioManifest = {
    ...manifest,
    id,
    version,
    name,
    logo: normalizeAddonAssetUrl(url, manifest.logo),
    background: normalizeAddonAssetUrl(url, manifest.background),
  };

  return {
    manifestUrl: url,
    baseUrl: new URL(".", url).toString(),
    manifest: normalizedManifest,
    enabled: true,
    addedAt: Date.now(),
  };
}

function normalizeRequiredManifestField(
  value: unknown,
  field: "id" | "version" | "name",
) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Addon manifest requires ${field}`);
  }

  return value.trim();
}

export function normalizeAddonAssetUrl(
  manifestUrl: string,
  value: unknown,
): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;

  try {
    const resolved = new URL(value.trim(), manifestUrl);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      return undefined;
    }
    return resolved.toString();
  } catch {
    return undefined;
  }
}

export function hasStreamResource(resources?: StremioResource[]) {
  return (
    Array.isArray(resources) &&
    resources.some((resource) =>
      typeof resource === "string"
        ? resource === "stream"
        : resource?.name === "stream",
    )
  );
}

export function supportsType(addon: InstalledAddon, type: "movie" | "series") {
  const manifestTypes = addon.manifest.types;
  if (Array.isArray(manifestTypes) && manifestTypes.length > 0) {
    return manifestTypes.includes(type);
  }

  const streamResource = addon.manifest.resources?.find((resource) =>
    typeof resource === "string"
      ? resource === "stream"
      : resource?.name === "stream",
  );
  if (typeof streamResource === "object" && streamResource.types?.length) {
    return streamResource.types.includes(type);
  }

  return true;
}

/**
 * Returns true if the addon manifest declares the given resource capability.
 * Works for any resource name: "catalog", "meta", "stream", "subtitles".
 */
export function hasResource(addon: InstalledAddon, resource: string): boolean {
  return (
    Array.isArray(addon.manifest.resources) &&
    addon.manifest.resources.some((r) =>
      typeof r === "string" ? r === resource : r?.name === resource,
    )
  );
}

/**
 * Returns the normalized list of resource names declared in the manifest.
 * Useful for displaying capability badges in the UI.
 */
export function getAddonResources(addon: InstalledAddon): string[] {
  if (!Array.isArray(addon.manifest.resources)) return [];
  return addon.manifest.resources
    .map((r) => (typeof r === "string" ? r : (r?.name ?? "")))
    .filter(Boolean);
}
