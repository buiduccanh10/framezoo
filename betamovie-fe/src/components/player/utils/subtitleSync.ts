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
    }),
    body: JSON.stringify(request),
  });
  const payload = (await response.json().catch(() => null)) as
    | SubtitleSyncResult
    | { statusMessage?: string; message?: string }
    | null;

  if (!response.ok) {
    throw new Error(
      payload &&
        "statusMessage" in payload &&
        typeof payload.statusMessage === "string"
        ? payload.statusMessage
        : payload && "message" in payload && typeof payload.message === "string"
          ? payload.message
          : `Subtitle sync failed with status ${response.status}`,
    );
  }

  return payload as SubtitleSyncResult;
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
