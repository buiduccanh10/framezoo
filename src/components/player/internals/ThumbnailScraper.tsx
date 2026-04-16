import { startTransition, useEffect } from "react";

import { ThumbnailImage } from "@/stores/player/slices/thumbnails";
import { usePlayerStore } from "@/stores/player/store";
import { usePreferencesStore } from "@/stores/preferences";

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

export function ThumbnailScraper() {
  const resetImages = usePlayerStore((s) => s.thumbnails.resetImages);
  const setImages = usePlayerStore((s) => s.thumbnails.setImages);
  const previewVtt = usePlayerStore((s) =>
    s.source?.preview?.kind === "vtt" ? s.source.preview.vtt : null,
  );
  const enableThumbnails = usePreferencesStore((s) => s.enableThumbnails);

  useEffect(() => {
    resetImages();

    if (!enableThumbnails || !previewVtt) return undefined;

    const controller = new AbortController();

    const loadPreview = async () => {
      try {
        const response = await fetch(previewVtt, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(
            `Preview request failed: ${response.status} ${response.statusText}`,
          );
        }

        const vtt = await response.text();
        if (controller.signal.aborted) return;

        const images = parsePreviewVtt(vtt, previewVtt);
        startTransition(() => {
          setImages(images);
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        console.warn("Failed to load preview VTT", error);
        resetImages();
      }
    };

    loadPreview();

    return () => {
      controller.abort();
    };
  }, [enableThumbnails, previewVtt, resetImages, setImages]);

  return null;
}
