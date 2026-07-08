import { Caption } from "@/stores/player/slices/source";
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

export interface DesktopPipState {
  source: LoadableSource | null;
  time: number;
  duration: number;
  paused: boolean;
  playbackRate: number;
  title: string;
  caption: DesktopPipCaption | null;
  secondaryCaption: DesktopPipCaption | null;
  dualSubEnabled: boolean;
}

export type DesktopPipAction =
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
): DesktopPipState | null {
  const source = getDesktopPipSourceSnapshot(
    state.source,
    state.currentQuality,
  );
  if (!source) return null;

  return {
    source,
    time: state.progress.time,
    duration: state.progress.duration,
    paused: state.mediaPlaying.isPaused,
    playbackRate: state.mediaPlaying.playbackRate,
    title: state.meta?.title ?? "AlphaFlix",
    caption: toDesktopPipCaption(state.caption.selected),
    secondaryCaption: toDesktopPipCaption(state.caption.secondary),
    dualSubEnabled: state.caption.dualSubEnabled,
  };
}
