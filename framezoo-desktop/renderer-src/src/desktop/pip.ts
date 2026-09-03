import { getSegmentBoundsSeconds } from "@/components/player/hooks/useSkipTime";
import {
  PlayerControlVisibility,
  getSkipSegmentVisibility,
  isSegmentEndingAtVideoEnd,
} from "@/components/player/utils/controlVisibility";
import { getNextEpisodeAction } from "@/components/player/utils/episodeNavigation";
import {
  Caption,
  PlayerStatus,
  playerStatus,
} from "@/stores/player/slices/source";
import { AllSlices } from "@/stores/player/slices/types";
import {
  LoadableSource,
  SourceQuality,
  SourceSliceSource,
} from "@/stores/player/utils/qualities";

export interface DesktopPipCaption {
  vttData: string;
  language: string;
}

export interface PipWindowSize {
  width: number;
  height: number;
}

export interface DesktopPipTorrentState {
  state: string;
  progress: number;
  speedBytesPerSecond: number;
  downloadedBytes: number;
  totalBytes: number | null;
  streamType: "pending" | "hls" | "file" | null;
  streamUrl: string | null;
}

export interface DesktopPipEpisodeState {
  season: number | null;
  episode: number;
  title: string;
}

export interface DesktopPipSkipSegmentState {
  type: "intro" | "recap" | "credits" | "preview";
  startTime: number;
  endTime: number;
  visibility: PlayerControlVisibility;
  isEndingAtVideoEnd: boolean;
}

export interface DesktopPipState {
  source: LoadableSource | null;
  status: PlayerStatus;
  sourceLoading: boolean;
  time: number;
  duration: number;
  paused: boolean;
  playbackRate: number;
  title: string;
  logo: string | null;
  backdrop: string | null;
  isLoading: boolean;
  hasRenderedFrame: boolean;
  buffered: number;
  playbackTarget: "main" | "pip";
  torrent: DesktopPipTorrentState | null;
  episode: DesktopPipEpisodeState | null;
  nextEpisode: DesktopPipEpisodeState | null;
  nextEpisodeIsSeasonChange: boolean;
  canControl: boolean;
  hideNextEpisodeButton: boolean;
  skipSegment: DesktopPipSkipSegmentState | null;
  primaryDelay: number;
  secondaryDelay: number;
  caption: DesktopPipCaption | null;
  secondaryCaption: DesktopPipCaption | null;
  dualSubEnabled: boolean;
}

export type DesktopPipAction =
  | {
      type: "close";
    }
  | {
      type: "togglePlayback";
    }
  | {
      type: "seekBy";
      delta: number;
    }
  | {
      type: "seekTo";
      time: number;
    }
  | {
      type: "nextEpisode";
    }
  | {
      type: "skipSegment";
      time: number;
    };

const DOCUMENT_PIP_WINDOW_SIZE_STORAGE_KEY = "__MW::documentPipWindowSize";
const DESKTOP_PIP_WINDOW_SIZE_STORAGE_KEY = "__MW::desktopPipWindowSize";
const DOCUMENT_PIP_MIN_WIDTH = 320;
const DOCUMENT_PIP_MIN_HEIGHT = 180;
const DESKTOP_PIP_MIN_WIDTH = 320;
const DESKTOP_PIP_MIN_HEIGHT = 180;
const DESKTOP_PIP_MAX_WIDTH = 1280;
const DESKTOP_PIP_MAX_HEIGHT = 720;

function normalizePipWindowSize(
  value: unknown,
  options: {
    minWidth: number;
    minHeight: number;
    maxWidth?: number;
    maxHeight?: number;
  },
): PipWindowSize | null {
  if (!value || typeof value !== "object") return null;

  const width = Number((value as PipWindowSize).width);
  const height = Number((value as PipWindowSize).height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }

  return {
    width: Math.round(
      Math.min(
        options.maxWidth ?? Number.POSITIVE_INFINITY,
        Math.max(options.minWidth, width),
      ),
    ),
    height: Math.round(
      Math.min(
        options.maxHeight ?? Number.POSITIVE_INFINITY,
        Math.max(options.minHeight, height),
      ),
    ),
  };
}

function getPersistedPipWindowSize(
  storageKey: string,
  options: {
    minWidth: number;
    minHeight: number;
    maxWidth?: number;
    maxHeight?: number;
  },
): PipWindowSize | null {
  if (typeof window === "undefined") return null;

  try {
    const rawValue = window.localStorage.getItem(storageKey);
    if (!rawValue) return null;

    return normalizePipWindowSize(JSON.parse(rawValue), options);
  } catch {
    return null;
  }
}

function persistPipWindowSize(
  storageKey: string,
  size: PipWindowSize,
  options: {
    minWidth: number;
    minHeight: number;
    maxWidth?: number;
    maxHeight?: number;
  },
): PipWindowSize | null {
  if (typeof window === "undefined") return null;

  const normalizedSize = normalizePipWindowSize(size, options);
  if (!normalizedSize) return null;

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(normalizedSize));
  } catch {
    // Ignore storage write failures and keep runtime behavior unchanged.
  }

  return normalizedSize;
}

export function getPersistedDocumentPipWindowSize(): PipWindowSize | null {
  return getPersistedPipWindowSize(DOCUMENT_PIP_WINDOW_SIZE_STORAGE_KEY, {
    minWidth: DOCUMENT_PIP_MIN_WIDTH,
    minHeight: DOCUMENT_PIP_MIN_HEIGHT,
  });
}

export function setPersistedDocumentPipWindowSize(
  size: PipWindowSize,
): PipWindowSize | null {
  return persistPipWindowSize(DOCUMENT_PIP_WINDOW_SIZE_STORAGE_KEY, size, {
    minWidth: DOCUMENT_PIP_MIN_WIDTH,
    minHeight: DOCUMENT_PIP_MIN_HEIGHT,
  });
}

export function getPersistedDesktopPipWindowSize(): PipWindowSize | null {
  return getPersistedPipWindowSize(DESKTOP_PIP_WINDOW_SIZE_STORAGE_KEY, {
    minWidth: DESKTOP_PIP_MIN_WIDTH,
    minHeight: DESKTOP_PIP_MIN_HEIGHT,
    maxWidth: DESKTOP_PIP_MAX_WIDTH,
    maxHeight: DESKTOP_PIP_MAX_HEIGHT,
  });
}

export function setPersistedDesktopPipWindowSize(
  size: PipWindowSize,
): PipWindowSize | null {
  return persistPipWindowSize(DESKTOP_PIP_WINDOW_SIZE_STORAGE_KEY, size, {
    minWidth: DESKTOP_PIP_MIN_WIDTH,
    minHeight: DESKTOP_PIP_MIN_HEIGHT,
    maxWidth: DESKTOP_PIP_MAX_WIDTH,
    maxHeight: DESKTOP_PIP_MAX_HEIGHT,
  });
}

function toDesktopPipCaption(
  caption: Caption | null,
): DesktopPipCaption | null {
  if (!caption) return null;
  return {
    vttData: caption.vttData,
    language: caption.language,
  };
}

function getDesktopPipFileSource(
  source: Extract<SourceSliceSource, { type: "file" }>,
  currentQuality: SourceQuality | null,
): LoadableSource | null {
  const preferredStream =
    (currentQuality ? source.qualities[currentQuality] : null) ?? null;
  const fallbackStream =
    preferredStream ??
    Object.values(source.qualities).find((stream) => Boolean(stream?.url));

  if (!fallbackStream) return null;

  return {
    ...fallbackStream,
    headers: source.headers,
    preferredHeaders: source.preferredHeaders,
  };
}

export function getDesktopPipSourceSnapshot(
  source: SourceSliceSource | null,
  currentQuality: SourceQuality | null,
): LoadableSource | null {
  if (!source) return null;

  if (source.type === "hls" || source.type === "dash") {
    return {
      type: source.type,
      url: source.url,
      headers: source.headers,
      preferredHeaders: source.preferredHeaders,
    };
  }

  return getDesktopPipFileSource(source, currentQuality);
}

export function getDesktopPipStateFromPlayerState(
  state: AllSlices,
  primaryDelay = 0,
  secondaryDelay = 0,
): DesktopPipState | null {
  const source = getDesktopPipSourceSnapshot(
    state.source,
    state.currentQuality,
  );
  const currentTime = Math.max(0, state.progress.time);
  const duration = Math.max(0, state.progress.duration);
  const meta = state.meta;
  const currentEpisode =
    meta?.type === "show" && meta.episode
      ? {
          season: meta.season?.number ?? null,
          episode: meta.episode.number,
          title: meta.episode.title,
        }
      : null;
  const nextEpisodeAction =
    getNextEpisodeAction(meta) ?? state.interface?.nextEpisodeAction;
  const nextEpisode = nextEpisodeAction
    ? {
        season: nextEpisodeAction.season?.number ?? null,
        episode: nextEpisodeAction.episode.number,
        title: nextEpisodeAction.episode.title,
      }
    : null;
  const endingSegment =
    meta?.type === "show"
      ? state.skipSegments?.find((segment) =>
          isSegmentEndingAtVideoEnd(segment, duration),
        )
      : undefined;
  const activeSkipSegment =
    state.skipSegments?.find((segment) => {
      const bounds = getSegmentBoundsSeconds(segment, duration);
      if (!bounds) return false;
      const end = bounds.end ?? duration;
      return (
        currentTime >= bounds.start &&
        currentTime <= end &&
        getSkipSegmentVisibility(currentTime, segment, duration) !== "none"
      );
    }) ?? null;
  const skipSegmentBounds = activeSkipSegment
    ? getSegmentBoundsSeconds(activeSkipSegment, duration)
    : null;

  return {
    source,
    status: state.status,
    sourceLoading: state.status === playerStatus.SOURCE_SELECTION,
    time: currentTime,
    duration,
    paused: state.mediaPlaying.isPaused,
    playbackRate: state.mediaPlaying.playbackRate,
    title: state.meta?.title ?? "Framezoo",
    logo: state.meta?.logo ?? null,
    backdrop: state.meta?.backdrop ?? state.meta?.poster ?? null,
    isLoading: state.mediaPlaying.isLoading,
    hasRenderedFrame: state.mediaPlaying.hasRenderedFrame,
    buffered: Math.max(0, state.progress.buffered),
    playbackTarget: "pip",
    torrent: null,
    episode: currentEpisode,
    nextEpisode,
    nextEpisodeIsSeasonChange: Boolean(nextEpisodeAction?.isSeasonChange),
    canControl: true,
    hideNextEpisodeButton: state.interface?.hideNextEpisodeBtn ?? false,
    skipSegment:
      activeSkipSegment && skipSegmentBounds
        ? {
            type: activeSkipSegment.type,
            startTime: skipSegmentBounds.start,
            endTime: skipSegmentBounds.end ?? duration,
            visibility: getSkipSegmentVisibility(
              currentTime,
              activeSkipSegment,
              duration,
            ),
            isEndingAtVideoEnd:
              meta?.type === "show" &&
              (activeSkipSegment === endingSegment ||
                isSegmentEndingAtVideoEnd(activeSkipSegment, duration)),
          }
        : null,
    primaryDelay: Number.isFinite(primaryDelay) ? primaryDelay : 0,
    secondaryDelay: Number.isFinite(secondaryDelay) ? secondaryDelay : 0,
    caption: toDesktopPipCaption(state.caption?.selected ?? null),
    secondaryCaption: toDesktopPipCaption(state.caption?.secondary ?? null),
    dualSubEnabled: state.caption?.dualSubEnabled ?? false,
  };
}
