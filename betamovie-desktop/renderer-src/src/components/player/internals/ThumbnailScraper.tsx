import { startTransition, useEffect } from "react";

import { ThumbnailImage } from "@/stores/player/slices/thumbnails";
import { usePlayerStore } from "@/stores/player/store";

const PREVIEW_RETRY_DELAYS_MS = [
  3_000, 5_000, 10_000, 15_000, 20_000, 30_000, 30_000, 30_000, 30_000, 30_000,
];

function parseTimestamp(input: string): number | null {
  const match = input
    .trim()
    .match(/^(?:(\d+):)?(\d{2}):(\d{2})(?:\.(\d{3}))?$/);
  if (!match) return null;

  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  const milliseconds = Number(match[4] ?? 0);

  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

function parseSpriteReference(
  reference: string,
  baseUrl: string,
): ThumbnailImage["sprite"] | null {
  const resolvedUrl = new URL(reference, baseUrl);
  const hash = resolvedUrl.hash.replace(/^#/, "");
  if (!hash.startsWith("xywh=")) return null;

  const [x, y, width, height] = hash
    .slice(5)
    .split(",")
    .map((value) => Number(value.trim()));
  if ([x, y, width, height].some((value) => Number.isNaN(value))) return null;
  if (width <= 0 || height <= 0) return null;

  resolvedUrl.hash = "";
  return {
    url: resolvedUrl.toString(),
    x,
    y,
    width,
    height,
  };
}

function parsePreviewVtt(vtt: string, baseUrl: string): ThumbnailImage[] {
  const lines = vtt.replace(/\r/g, "").split("\n");
  const thumbnails: ThumbnailImage[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line.includes("-->")) continue;

    const [startRaw] = line.split("-->").map((value) => value.trim());
    const at = parseTimestamp(startRaw);
    if (at === null) continue;

    let payload = "";
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const value = lines[cursor].trim();
      if (!value) break;
      payload = value;
      break;
    }
    if (!payload) continue;

    const sprite = parseSpriteReference(payload, baseUrl);
    if (sprite) {
      thumbnails.push({ at, sprite });
      continue;
    }

    thumbnails.push({
      at,
      data: new URL(payload, baseUrl).toString(),
    });
  }

  return thumbnails.sort((a, b) => a.at - b.at);
}

function isGeneratedPreviewUrl(url: string): boolean {
  return /\/(?:embed\/api\/)?preview\/auto(?:[/?]|$)/i.test(url);
}

function isRetryablePreviewStatus(status: number, generated: boolean): boolean {
  return (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500 ||
    (generated && status === 404)
  );
}

function waitForRetry(delayMs: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve(true);
    }, delayMs);

    function abort() {
      window.clearTimeout(timeoutId);
      resolve(false);
    }

    signal.addEventListener("abort", abort, { once: true });
  });
}

export function ThumbnailScraper() {
  const resetImages = usePlayerStore((s) => s.thumbnails.resetImages);
  const setImages = usePlayerStore((s) => s.thumbnails.setImages);
  const previewVtt = usePlayerStore((s) =>
    s.source?.preview?.kind === "vtt" ? s.source.preview.vtt : null,
  );

  useEffect(() => {
    resetImages();

    if (!previewVtt) return undefined;

    const controller = new AbortController();
    const generatedPreview = isGeneratedPreviewUrl(previewVtt);

    const loadPreview = async () => {
      let lastError: unknown = null;

      for (
        let attempt = 0;
        attempt <= PREVIEW_RETRY_DELAYS_MS.length;
        attempt += 1
      ) {
        try {
          const response = await fetch(previewVtt, {
            signal: controller.signal,
            credentials: "include",
            cache: "no-store",
          });
          if (!response.ok) {
            const error = new Error(
              `Preview request failed: ${response.status} ${response.statusText}`,
            ) as Error & { status?: number };
            error.status = response.status;
            throw error;
          }

          const vtt = await response.text();
          if (controller.signal.aborted) return;

          const images = parsePreviewVtt(vtt, previewVtt);
          if (generatedPreview && images.length === 0) {
            throw new Error("Preview VTT has no thumbnail cues");
          }

          startTransition(() => {
            setImages(images);
          });
          return;
        } catch (error) {
          if (controller.signal.aborted) return;
          lastError = error;

          const status =
            error instanceof Error && "status" in error
              ? Number(error.status)
              : null;
          const retryable =
            status === null ||
            isRetryablePreviewStatus(status, generatedPreview);
          const delayMs = PREVIEW_RETRY_DELAYS_MS[attempt];

          if (!retryable || delayMs === undefined) break;
          if (!(await waitForRetry(delayMs, controller.signal))) return;
        }
      }

      if (!controller.signal.aborted) {
        console.warn("Failed to load preview VTT", lastError);
        resetImages();
      }
    };

    loadPreview();

    return () => {
      controller.abort();
    };
  }, [previewVtt, resetImages, setImages]);

  return null;
}
