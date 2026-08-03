import type {
  AddonProtocolRequest,
  AddonProtocolResource,
  AddonProtocolResponse,
} from "./types";

export const ADDON_PROTOCOL_TIMEOUT_MS = 15_000;
export const ADDON_PROTOCOL_MAX_RESPONSE_SIZE_BYTES = 5 * 1024 * 1024;

const RESOURCE_NAMES = new Set<AddonProtocolResource>([
  "catalog",
  "meta",
  "stream",
  "subtitles",
  "addon_catalog",
]);

export class AddonProtocolError extends Error {
  readonly statusCode: number | null;
  readonly url: string;

  constructor(message: string, url: string, statusCode: number | null = null) {
    super(message);
    this.name = "AddonProtocolError";
    this.statusCode = statusCode;
    this.url = url;
  }
}

export function normalizeAddonManifestUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new AddonProtocolError("Addon manifest URL is invalid", input);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AddonProtocolError(
      "Addon manifest must use HTTP or HTTPS",
      input,
    );
  }

  return url.toString();
}

function encodeSegment(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new AddonProtocolError(`Addon ${label} is required`, value);
  }
  return encodeURIComponent(normalized);
}

export function getAddonResourceUrl(request: AddonProtocolRequest) {
  const manifestUrl = normalizeAddonManifestUrl(request.manifestUrl);
  if (!RESOURCE_NAMES.has(request.resource)) {
    throw new AddonProtocolError(
      `Unsupported addon resource: ${String(request.resource)}`,
      manifestUrl,
    );
  }

  const baseUrl = new URL(".", manifestUrl);
  let resourcePath: string;

  switch (request.resource) {
    case "catalog":
      resourcePath = `catalog/${encodeSegment(request.type ?? "", "type")}/${encodeSegment(request.catalogId ?? request.id ?? "top", "catalog id")}.json`;
      break;
    case "meta":
    case "stream":
    case "subtitles":
      resourcePath = `${request.resource}/${encodeSegment(request.type ?? "", "type")}/${encodeSegment(request.id ?? "", "id")}.json`;
      break;
    case "addon_catalog":
      resourcePath = `addon_catalog/${encodeSegment(request.type ?? "", "type")}/${encodeSegment(request.id ?? "default", "id")}.json`;
      break;
  }

  return new URL(resourcePath, baseUrl).toString();
}

async function readJsonResponse<T>(
  response: Response,
  url: string,
): Promise<AddonProtocolResponse<T>> {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength &&
    Number(contentLength) > ADDON_PROTOCOL_MAX_RESPONSE_SIZE_BYTES
  ) {
    throw new AddonProtocolError(
      "Addon response exceeds the maximum allowed size",
      url,
      response.status,
    );
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > ADDON_PROTOCOL_MAX_RESPONSE_SIZE_BYTES) {
    throw new AddonProtocolError(
      "Addon response exceeds the maximum allowed size",
      url,
      response.status,
    );
  }

  let body: T;
  try {
    body = JSON.parse(Buffer.from(buffer).toString("utf8")) as T;
  } catch {
    throw new AddonProtocolError(
      "Addon returned invalid JSON",
      url,
      response.status,
    );
  }

  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    statusCode: response.status,
    headers,
    finalUrl: response.url || url,
    body,
  };
}

export class AddonProtocolEngine {
  async loadManifest(manifestUrl: string) {
    const url = normalizeAddonManifestUrl(manifestUrl);
    return this.requestJson(url);
  }

  async request(request: AddonProtocolRequest) {
    return this.requestJson(getAddonResourceUrl(request));
  }

  private async requestJson<T = unknown>(
    url: string,
  ): Promise<AddonProtocolResponse<T>> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(ADDON_PROTOCOL_TIMEOUT_MS),
      });
    } catch (error) {
      const message =
        error instanceof Error && error.name === "TimeoutError"
          ? `Addon request timed out after ${ADDON_PROTOCOL_TIMEOUT_MS}ms: ${url}`
          : error instanceof Error
            ? error.message
            : "Addon request failed";
      throw new AddonProtocolError(message, url);
    }

    if (!response.ok) {
      throw new AddonProtocolError(
        `Request failed with HTTP ${response.status}`,
        url,
        response.status,
      );
    }

    return readJsonResponse<T>(response, url);
  }
}
