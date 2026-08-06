import { unzipSync } from "fflate";
import { list } from "subsrt-ts";

import { proxiedFetch } from "@/backend/helpers/fetch";
import {
  decodeSubtitleBytes,
  normalizeSubtitleToVtt,
} from "@/components/player/utils/captions";
import { conf } from "@/setup/config";
import { CaptionListItem } from "@/stores/player/slices/source";
import { SimpleCache } from "@/utils/cache";

import {
  isExtensionActiveCached,
  sendExtensionRequest,
} from "../extension/messaging";

export const subtitleTypeList = list().map((type) => `.${type}`);
const downloadCache = new SimpleCache<string, string>();
downloadCache.setCompare((a, b) => a === b);
const expirySeconds = 24 * 60 * 60;

function isZipArchive(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 4) return false;
  const bytes = new Uint8Array(buffer, 0, 4);
  return (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

function extractSubtitleTextFromZip(
  buffer: ArrayBuffer,
  language?: string,
): string | null {
  try {
    const files = unzipSync(new Uint8Array(buffer));
    const entries = Object.entries(files).filter(
      ([name, content]) => !name.endsWith("/") && content.length > 0,
    );
    if (entries.length === 0) return null;

    const preferred = entries.find(([name]) =>
      subtitleTypeList.some((ext) => name.toLowerCase().endsWith(ext)),
    );
    const target = preferred?.[1] ?? entries[0][1];
    return decodeSubtitleBytes(target, language);
  } catch (error) {
    console.warn(
      "Failed to extract subtitle ZIP, falling back to raw decode",
      error,
    );
    return null;
  }
}

function isHtmlResponse(data: string, contentType?: string): boolean {
  const hasHtmlMarkup =
    /^\s*(?:<!doctype\s+html\b|<html\b|<head\b|<body\b)/i.test(data) ||
    /<!--[\s\S]*-->/i.test(data);
  if (hasHtmlMarkup) return true;

  if (!contentType?.toLowerCase().includes("text/html")) return false;

  return !/(?:^|\r?\n)\s*(?:(?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})\s+-->/m.test(
    data,
  );
}

/**
 * Always returns canonical WebVTT.
 */
export async function downloadCaptionAsVtt(
  caption: CaptionListItem,
): Promise<string> {
  const cached = downloadCache.get(caption.url);
  if (cached) return cached;

  let data: string | undefined;
  if (caption.needsProxy) {
    if (isExtensionActiveCached()) {
      const extensionResponse = await sendExtensionRequest({
        url: caption.url,
        method: "GET",
      });
      if (
        !extensionResponse?.success ||
        typeof extensionResponse.response.body !== "string"
      ) {
        throw new Error("failed to get caption data from extension");
      }

      data = extensionResponse.response.body;
    } else {
      data = await proxiedFetch<string>(caption.url, {
        responseType: "text",
        headers: {
          "Accept-Charset": "utf-8",
        },
      });
    }
  } else {
    const headers = new Headers();
    const isSubsourceDownload =
      caption.source?.toLowerCase().includes("subsource") &&
      /api\.subsource\.net\/api\/v1\/subtitles\/\d+\/download/.test(
        caption.url,
      );
    if (isSubsourceDownload) {
      const apiKey = conf().SUBSOURCE_API_KEY;
      if (apiKey) {
        headers.set("x-api-key", apiKey);
        headers.set("api-key", apiKey);
      }
    }

    const response = await fetch(caption.url, {
      headers,
    });
    if (!response.ok) {
      throw new Error(
        `Caption request failed: ${response.status} ${response.statusText}`,
      );
    }
    const contentType = response.headers.get("content-type") || "";

    // Get the raw bytes
    const buffer = await response.arrayBuffer();
    if (contentType.includes("application/zip") || isZipArchive(buffer)) {
      data = extractSubtitleTextFromZip(buffer, caption.language) ?? undefined;
    }

    if (!data) {
      data = decodeSubtitleBytes(buffer, caption.language);
    }

    if (data && isHtmlResponse(data, contentType)) {
      throw new Error("Subtitle source returned HTML instead of subtitle data");
    }
  }
  if (!data) throw new Error("failed to get caption data");

  if (isHtmlResponse(data)) {
    throw new Error("Subtitle source returned HTML instead of subtitle data");
  }

  const output = normalizeSubtitleToVtt(data, caption.type);
  downloadCache.set(caption.url, output, expirySeconds);
  return output;
}

/**
 * Downloads the WebVTT content. No different than a simple
 * get request with a cache.
 */
export async function downloadWebVTT(url: string): Promise<string> {
  const cached = downloadCache.get(url);
  if (cached) return cached;

  const buffer = await fetch(url).then((v) => v.arrayBuffer());
  return decodeSubtitleBytes(buffer);
}
