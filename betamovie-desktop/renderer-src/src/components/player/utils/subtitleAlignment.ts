import { mwFetch } from "@/backend/helpers/fetch";
import { conf } from "@/setup/config";

import { extractAudioWindow } from "./audioCapture";
import { shiftVttTimestamps } from "./captions";

export interface SubtitleAlignmentResponse {
  aligned: boolean;
  offsetMs: number;
  confidence: number;
  speechIntervals: Array<{
    startMs: number;
    endMs: number;
  }>;
  cleanedVtt: string;
  reason: string | null;
}

function normalizeHeaders(
  headers: unknown,
): Record<string, string> | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([, value]) => typeof value === "string" && value.length > 0,
    ),
  );
}

export async function alignSubtitleWithCurrentStream(options: {
  sourceUrl: string;
  startAt: number;
  language: string;
  vttData: string;
  headers?: unknown;
  signal?: AbortSignal;
}): Promise<SubtitleAlignmentResponse> {
  const audio = await extractAudioWindow({
    url: options.sourceUrl,
    startAt: options.startAt,
    duration: 30,
    headers: normalizeHeaders(options.headers),
  });

  const body = new FormData();
  const audioCopy = new Uint8Array(audio.byteLength);
  audioCopy.set(audio);
  body.append(
    "audio",
    new Blob([audioCopy.buffer], { type: "audio/wav" }),
    "capture.wav",
  );
  body.append(
    "vtt",
    new Blob([options.vttData], { type: "text/vtt" }),
    "subtitle.vtt",
  );
  body.append("language", options.language || "en");
  body.append("audioStartMs", String(Math.round(options.startAt * 1000)));

  return await mwFetch<SubtitleAlignmentResponse>("/api/subtitle-align", {
    method: "POST",
    body,
    baseURL: conf().BACKEND_URL ?? undefined,
    signal: options.signal,
    timeout: 120_000,
  });
}

export function applySubtitleAlignment(
  vttData: string,
  result: SubtitleAlignmentResponse,
): string {
  const cleanedVtt = result.cleanedVtt || vttData;
  if (!result.aligned || !Number.isFinite(result.offsetMs)) {
    return cleanedVtt;
  }
  return shiftVttTimestamps(cleanedVtt, result.offsetMs / 1000);
}
