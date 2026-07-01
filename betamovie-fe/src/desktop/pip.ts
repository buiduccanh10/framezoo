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

  if (source.type === "hls") {
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
