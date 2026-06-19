import { MediaPlaylist } from "hls.js";

import { MWMediaType } from "@/backend/metadata/types/mw";
import { AudioTrack, CaptionListItem } from "@/stores/player/slices/source";
import { LoadableSource, SourceQuality } from "@/stores/player/utils/qualities";
import { Listener } from "@/utils/events";

export type DisplayErrorType = "hls" | "htmlvideo" | "global";
export type DisplayError = {
  stackTrace?: string;
  message?: string;
  key?: string;
  errorName: string;
  type: DisplayErrorType;
  hls?: {
    details: string;
    fatal: boolean;
    level?: number;
    levelDetails?: {
      url: string;
      width: number;
      height: number;
      bitrate: number;
    };
    frag?: {
      url: string;
      baseurl: string;
      duration: number;
      start: number;
      sn: number | string;
    };
    type: string;
    url?: string;
  };
};

export type SegmentQualityDebugInfo = {
  realQuality: "1080" | "720" | "unknown";
  width: number | null;
  height: number | null;
  updatedAt: number;
};

export type PictureInPictureMode = "native" | "document" | null;
export type PictureInPictureState = {
  active: boolean;
  mode: PictureInPictureMode;
  documentWindow: Window | null;
};

export type DisplayInterfaceEvents = {
  play: void;
  pause: void;
  fullscreen: boolean;
  volumechange: number;
  time: number;
  duration: number;
  buffered: number;
  loading: boolean;
  qualities: SourceQuality[];
  changedquality: SourceQuality | null;
  audiotracks: AudioTrack[];
  changedaudiotrack: AudioTrack | null;
  needstrack: boolean;
  pictureinpicture: PictureInPictureState;
  canairplay: boolean;
  playbackrate: number;
  error: DisplayError;
  segmentqualitydebug: SegmentQualityDebugInfo | null;
};

export interface qualityChangeOptions {
  source: LoadableSource | null;
  automaticQuality: boolean;
  preferredQuality: SourceQuality | null;
  startAt: number;
  autoplay?: boolean;
}

export interface DisplayMeta {
  title: string;
  type: MWMediaType;
}

export interface DisplayCaption {
  id: string;
  vttData: string;
  language: string;
  url?: string;
}

export type DisplayType = "web" | "casting";

export interface DisplayInterface extends Listener<DisplayInterfaceEvents> {
  play(): void;
  pause(): void;
  load(ops: qualityChangeOptions): void;
  changeQuality(
    automaticQuality: boolean,
    preferredQuality: SourceQuality | null,
  ): void;
  changeAudioTrack(audioTrack: AudioTrack): void;
  processVideoElement(video: HTMLVideoElement): void;
  processContainerElement(container: HTMLElement): void;
  toggleFullscreen(): void;
  togglePictureInPicture(): void;
  setSeeking(active: boolean): void;
  setVolume(vol: number): void;
  setTime(t: number): void;
  destroy(): void;
  startAirplay(): void;
  setPlaybackRate(rate: number): void;
  setMeta(meta: DisplayMeta): void;
  setCaption(caption: DisplayCaption | null): void;
  getType(): DisplayType;
  getCaptionList(): CaptionListItem[];
  getSubtitleTracks(): MediaPlaylist[];
  setSubtitlePreference(lang: string): Promise<void>;
}
