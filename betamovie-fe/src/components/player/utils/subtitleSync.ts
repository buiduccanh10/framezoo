import { conf } from "@/setup/config";
import {
  Caption,
  CaptionListItem,
  PlayerMeta,
  SubtitleSyncState,
} from "@/stores/player/slices/source";
import {
  SourceQuality,
  SourceSliceSource,
} from "@/stores/player/utils/qualities";
import { getBackendAuthHeaders } from "@/utils/backendAuth";

export type SubtitleSyncStatus =
  | "idle"
  | "syncing"
  | "applied"
  | "rejected"
  | "error";

export interface SubtitleSyncResult {
  offsetMs: number;
  windowOffsetsMs: number[];
  driftMs: number | null;
  confidence: "high" | "medium" | "rejected";
  matchedCueCount: number;
  scores: number[];
  methods: string[];
  reason?: string;
  cached?: boolean;
  model?: string;
}

export interface SubtitleSyncSource {
  type: "hls" | "dash" | "file";
  url: string;
  headers: Record<string, string>;
}

export interface SubtitleSyncRequest {
  mediaKey: string;
  sourceId: string;
  captionId: string;
  sourceType: SubtitleSyncSource["type"];
  sourceUrl: string;
  sourceHeaders: Record<string, string>;
  subtitleVtt: string;
  videoDurationMs: number;
  skipSegments: Array<{
    type: string;
    start_ms: number | null;
    end_ms: number | null;
  }>;
  force?: boolean;
}

export function getAppliedSubtitleSyncOffsetMs(
  sync: Pick<SubtitleSyncState, "status" | "offsetMs"> | null | undefined,
): number {
  if (sync?.status !== "applied" || !Number.isFinite(sync.offsetMs)) {
    return 0;
  }
  return sync.offsetMs;
}

export function getEffectiveSubtitleDelay(
  manualDelaySeconds: number,
  syncOffsetMs: number,
): number {
  const manual = Number.isFinite(manualDelaySeconds) ? manualDelaySeconds : 0;
  const sync = Number.isFinite(syncOffsetMs) ? syncOffsetMs / 1000 : 0;
  return manual + sync;
}

export function getSubtitleSyncKey(
  mediaKey: string | null,
  sourceId: string | null,
  captionId: string | null,
): string | null {
  if (!mediaKey || !sourceId || !captionId) return null;
  return `${mediaKey}:${sourceId}:${captionId}`;
}

export function resolveSubtitleSyncSource(
  source: SourceSliceSource | null,
  currentQuality: SourceQuality | null,
): SubtitleSyncSource | null {
  if (!source) return null;

  const headers = {
    ...(source.preferredHeaders || {}),
    ...(source.headers || {}),
  };

  if (source.type === "hls" || source.type === "dash") {
    return {
      type: source.type,
      url: source.url,
      headers,
    };
  }

  const selected =
    (currentQuality ? source.qualities[currentQuality] : null) ||
    Object.values(source.qualities).find((stream) => stream?.url);
  if (!selected?.url) return null;

  return {
    type: "file",
    url: selected.url,
    headers,
  };
}

export async function requestSubtitleSync(
  request: SubtitleSyncRequest,
  onProgress?: (percent: number) => void,
): Promise<SubtitleSyncResult> {
  const backendUrl = conf().BACKEND_URL?.replace(/\/+$/, "");
  if (!backendUrl) {
    throw new Error("Subtitle sync backend is unavailable");
  }

  const response = await fetch(`${backendUrl}/api/subtitles/align`, {
    method: "POST",
    credentials: "include",
    headers: getBackendAuthHeaders(`${backendUrl}/api/subtitles/align`, {
      "content-type": "application/json",
      accept: "text/event-stream",
    }),
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Subtitle sync failed with status ${response.status}: ${text}`,
    );
  }

  if (!response.body) {
    throw new Error("No response body from subtitle sync backend");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let result: SubtitleSyncResult | null = null;
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          let data: {
            type?: string;
            percent?: number;
            data?: SubtitleSyncResult;
            error?: string;
          };
          try {
            data = JSON.parse(line.substring(6)) as typeof data;
          } catch {
            // ignore JSON parse errors for corrupted lines
            continue;
          }

          if (data.type === "progress") {
            onProgress?.(data.percent ?? 0);
          } else if (data.type === "result" && data.data) {
            result = data.data;
          } else if (data.type === "error") {
            throw new Error(data.error || "Subtitle alignment failed");
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!result) {
    throw new Error("Subtitle sync did not return a result");
  }

  return result;
}

export function getSubtitleSyncMediaKey(
  meta: PlayerMeta | null,
): string | null {
  if (!meta) return null;
  if (meta.type === "movie") return `${meta.type}-${meta.tmdbId}`;
  if (meta.season && meta.episode) {
    return `${meta.type}-${meta.tmdbId}-${meta.season.tmdbId}-${meta.episode.tmdbId}`;
  }
  return `${meta.type}-${meta.tmdbId}`;
}

export function getSubtitleSyncCaptionId(
  caption: Caption | null,
  captionList: CaptionListItem[],
): string | null {
  if (!caption) return null;
  return captionList.find((item) => item.id === caption.id)?.id || caption.id;
}
