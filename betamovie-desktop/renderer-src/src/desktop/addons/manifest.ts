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
  if (
    typeof manifest.id !== "string" ||
    typeof manifest.version !== "string" ||
    typeof manifest.name !== "string"
  ) {
    throw new Error("Addon manifest requires id, version, and name");
  }

  if (!hasStreamResource(manifest.resources)) {
    throw new Error("Addon manifest does not expose a stream resource");
  }

  return {
    manifestUrl: url,
    baseUrl: new URL(".", url).toString(),
    manifest: {
      ...manifest,
      id: manifest.id,
      version: manifest.version,
      name: manifest.name,
    },
    enabled: true,
    addedAt: Date.now(),
  };
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
