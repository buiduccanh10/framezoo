import { list } from "subsrt-ts";

import { proxiedFetch } from "@/backend/helpers/fetch";
import { convertSubtitlesToSrt } from "@/components/player/utils/captions";
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

interface ZipEntry {
  compressionMethod: number;
  fileName: string;
  compressedSize: number;
  localHeaderOffset: number;
}

function getUint16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function getUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function findEndOfCentralDirectory(view: DataView): number {
  const minOffset = Math.max(0, view.byteLength - 0xffff - 22);
  for (let offset = view.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (getUint32(view, offset) === 0x06054b50) {
      return offset;
    }
  }

  throw new Error("ZIP end of central directory not found");
}

function parseZipEntries(buffer: ArrayBuffer): ZipEntry[] {
  const view = new DataView(buffer);
  const eocdOffset = findEndOfCentralDirectory(view);
  const centralDirectorySize = getUint32(view, eocdOffset + 12);
  const centralDirectoryOffset = getUint32(view, eocdOffset + 16);
  const entries: ZipEntry[] = [];

  let offset = centralDirectoryOffset;
  const endOffset = centralDirectoryOffset + centralDirectorySize;

  while (offset < endOffset) {
    if (getUint32(view, offset) !== 0x02014b50) {
      throw new Error("Invalid ZIP central directory file header");
    }

    const compressionMethod = getUint16(view, offset + 10);
    const compressedSize = getUint32(view, offset + 20);
    const fileNameLength = getUint16(view, offset + 28);
    const extraFieldLength = getUint16(view, offset + 30);
    const fileCommentLength = getUint16(view, offset + 32);
    const localHeaderOffset = getUint32(view, offset + 42);
    const fileName = new TextDecoder().decode(
      new Uint8Array(buffer, offset + 46, fileNameLength),
    );

    entries.push({
      compressionMethod,
      fileName,
      compressedSize,
      localHeaderOffset,
    });

    offset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
  }

  return entries;
}

async function inflateZipEntry(
  compressedData: Uint8Array,
  compressionMethod: number,
): Promise<ArrayBuffer> {
  const compressedCopy = new Uint8Array(compressedData);

  if (compressionMethod === 0) {
    return compressedCopy.buffer;
  }

  if (compressionMethod !== 8) {
    throw new Error(`Unsupported ZIP compression method: ${compressionMethod}`);
  }

  const stream = new Blob([compressedCopy]).stream();
  const decompressedStream = stream.pipeThrough(
    new DecompressionStream("deflate-raw"),
  );

  return new Response(decompressedStream).arrayBuffer();
}

function getZipEntryData(buffer: ArrayBuffer, entry: ZipEntry): Uint8Array {
  const view = new DataView(buffer);
  const offset = entry.localHeaderOffset;

  if (getUint32(view, offset) !== 0x04034b50) {
    throw new Error("Invalid ZIP local file header");
  }

  const fileNameLength = getUint16(view, offset + 26);
  const extraFieldLength = getUint16(view, offset + 28);
  const dataStart = offset + 30 + fileNameLength + extraFieldLength;

  return new Uint8Array(buffer, dataStart, entry.compressedSize);
}

function isSubtitleEntry(fileName: string): boolean {
  const normalized = fileName.toLowerCase();
  return subtitleTypeList.some((extension) => normalized.endsWith(extension));
}

function pickBestSubtitleEntry(entries: ZipEntry[]): ZipEntry | undefined {
  const subtitleEntries = entries.filter((entry) =>
    isSubtitleEntry(entry.fileName),
  );
  if (subtitleEntries.length === 0) return undefined;

  const preferredEntry = subtitleEntries.find((entry) =>
    entry.fileName.toLowerCase().includes("utf"),
  );

  return preferredEntry ?? subtitleEntries[0];
}

async function extractSubtitleFromZip(buffer: ArrayBuffer): Promise<string> {
  const entries = parseZipEntries(buffer);
  const selectedEntry = pickBestSubtitleEntry(entries);

  if (!selectedEntry) {
    throw new Error("No subtitle file found in ZIP archive");
  }

  const compressedData = getZipEntryData(buffer, selectedEntry);
  const subtitleBuffer = await inflateZipEntry(
    compressedData,
    selectedEntry.compressionMethod,
  );

  return new TextDecoder().decode(subtitleBuffer);
}

async function downloadSubSourceCaption(
  caption: CaptionListItem,
): Promise<string> {
  const response = await fetch(caption.url);

  if (!response.ok) {
    throw new Error(`SubSource download returned ${response.status}`);
  }

  const zipBuffer = await response.arrayBuffer();
  return extractSubtitleFromZip(zipBuffer);
}

/**
 * Always returns SRT
 */
export async function downloadCaption(
  caption: CaptionListItem,
): Promise<string> {
  const cached = downloadCache.get(caption.url);
  if (cached) return cached;

  let data: string | undefined;
  if (caption.source === "subsource") {
    data = await downloadSubSourceCaption(caption);
  } else if (caption.needsProxy) {
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
    const response = await fetch(caption.url);
    const contentType = response.headers.get("content-type") || "";
    const charset = contentType.includes("charset=")
      ? contentType.split("charset=")[1].toLowerCase()
      : "utf-8";

    // Get the raw bytes
    const buffer = await response.arrayBuffer();
    // Decode using the detected charset, defaulting to UTF-8
    const decoder = new TextDecoder(charset);
    data = decoder.decode(buffer);
  }
  if (!data) throw new Error("failed to get caption data");

  const output = convertSubtitlesToSrt(data);
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

  const data = await fetch(url).then((v) => v.text());
  return data;
}
