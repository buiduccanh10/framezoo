/* eslint-disable no-console */
import { downloadCaptionAsVtt } from "@/backend/helpers/subs";
import { SegmentQualityDebugInfo } from "@/components/player/display/displayInterface";
import {
  NATIVE_SUBTITLE_ADDON_ID,
  getInstalledAddons,
} from "@/desktop/addons/storage";
import { loadAllAddonSubtitles } from "@/desktop/addons/subtitles";
import { clearActiveTorrentSession } from "@/desktop/torrentPlaybackStore";
import { useLanguageStore } from "@/stores/language";
import { MakeSlice } from "@/stores/player/slices/types";
import {
  SourceQuality,
  SourceSliceSource,
  selectQuality,
} from "@/stores/player/utils/qualities";
import { useQualityStore } from "@/stores/quality";
import { useSubtitleStore } from "@/stores/subtitles";
import { isAutoplayAllowed } from "@/utils/autoplay";
import { getExternalSubtitleLanguageKey } from "@/utils/externalSubtitles/language";
import {
  EXTERNAL_SUBTITLE_CACHE_GC_MS,
  EXTERNAL_SUBTITLE_CACHE_TTL_MS,
  getExternalSubtitleQueryKey,
  queryClient,
} from "@/utils/queryClient";
import googletranslate from "@/utils/translation/googletranslate";
import {
  applyStoredCaptionAlignment,
  translate,
} from "@/utils/translation/index";
import { ValuesOf } from "@/utils/typeguard";

export const playerStatus = {
  IDLE: "idle",
  RESUME: "resume",
  SOURCE_SELECTION: "sourceSelection",
  PLAYING: "playing",
  PLAYBACK_ERROR: "playbackError",
} as const;

export type PlayerStatus = ValuesOf<typeof playerStatus>;

export interface PlayerMetaEpisode {
  number: number;
  tmdbId: string;
  title: string;
  air_date?: string;
  overview?: string;
}

export interface PlayerMeta {
  type: "movie" | "show";
  title: string;
  tmdbId: string;
  imdbId?: string;
  releaseYear: number;
  poster?: string;
  backdrop?: string;
  logo?: string;
  overview?: string;
  originalLanguage?: string;
  episodes?: PlayerMetaEpisode[];
  episode?: PlayerMetaEpisode;
  season?: {
    number: number;
    tmdbId: string;
    title: string;
  };
}

export interface PlayerNavigationState {
  playerMeta?: PlayerMeta;
}

export interface SubtitleAlignmentSegment {
  startMs: number;
  endMs: number;
  offsetMs: number;
}

export interface SubtitleAlignmentState {
  offsetMs: number;
  segments?: SubtitleAlignmentSegment[];
}

export interface Caption {
  id: string;
  language: string;
  url?: string;
  vttData: string;
  alignmentBaseVttData?: string;
  alignmentSourceVttData?: string;
  alignment?: SubtitleAlignmentState;
  sourceCaption?: CaptionListItem;
  trackId?: string;
  persisted?: boolean;
}

export interface CaptionListItem {
  id: string;
  language: string;
  url: string;
  trackId?: string;
  type?: string;
  needsProxy: boolean;
  hls?: boolean;
  opensubtitles?: boolean;
  // subtitle details from wyzie
  display?: string;
  media?: string;
  isHearingImpaired?: boolean;
  source?: string;
  encoding?: string;
}

export type SubtitleTrack = "primary" | "secondary";

export interface AddExternalSubtitlesOptions {
  forceRefresh?: boolean;
}

export type SubtitleSyncPhase =
  | "idle"
  | "pausing"
  | "capturing"
  | "analyzing"
  | "applying";

export interface SubtitleSyncState {
  active: boolean;
  phase: SubtitleSyncPhase;
  progress: number;
}

export interface AudioTrack {
  id: string;
  label: string;
  language: string;
}

export interface TranslateTask {
  targetCaption: CaptionListItem;
  fetchedTargetCaption?: Caption;
  targetLanguage: string;
  translatedCaption?: Caption;
  done: boolean;
  error: boolean;
  cancel: () => void;
}

export interface PreferredStream {
  seriesId: string;
  mediaKey?: string;
  addonId: string;
  sourceKind?: "torrent" | "hls" | "dash" | "file";
  quality: string;
  name: string;
  title: string;
  bingeGroup?: string;
  savedAt?: number;
}

export interface SourceSlice {
  status: PlayerStatus;
  source: SourceSliceSource | null;
  sourceId: string | null;
  embedId: string | null;
  qualities: SourceQuality[];
  audioTracks: AudioTrack[];
  embeddedSubtitleTracksLoaded: boolean;
  currentQuality: SourceQuality | null;
  segmentQualityDebug: SegmentQualityDebugInfo | null;
  currentAudioTrack: AudioTrack | null;
  captionList: CaptionListItem[];
  isLoadingExternalSubtitles: boolean;
  externalSubtitleLoadError: string | null;
  externalSubtitleRequestId: number;
  externalSubtitleLoadProgress: {
    completed: number;
    total: number;
  };
  externalSubtitleMediaKey: string | null;
  externalSubtitleRefreshMediaKey: string | null;
  caption: {
    selected: Caption | null;
    secondary: Caption | null;
    dualSubEnabled: boolean;
    activeTrack: SubtitleTrack;
    asTrack: boolean;
    translateTask: TranslateTask | null;
  };
  meta: PlayerMeta | null;
  preferredStream: PreferredStream | null;
  subtitleSync: SubtitleSyncState;
  setPreferredStream(stream: PreferredStream | null): void;
  setSubtitleSyncState(state: SubtitleSyncState): void;
  setStatus(status: PlayerStatus): void;
  setSource(
    stream: SourceSliceSource,
    captions: CaptionListItem[],
    startAt: number,
  ): void;
  switchQuality(quality: SourceQuality): void;
  setMeta(meta: PlayerMeta, status?: PlayerStatus): void;
  setCaption(caption: Caption | null): void;
  setEmbeddedSubtitleTracks(captions: CaptionListItem[]): void;
  setSecondaryCaption(caption: Caption | null): void;
  setDualSubEnabled(enabled: boolean): void;
  setActiveCaptionTrack(track: SubtitleTrack): void;
  setSourceId(id: string | null): void;
  setEmbedId(id: string | null): void;
  enableAutomaticQuality(): void;
  redisplaySource(startAt: number): void;
  setCaptionAsTrack(asTrack: boolean): void;
  addExternalSubtitles(
    requestId?: number,
    options?: AddExternalSubtitlesOptions,
  ): Promise<void>;
  translateCaption(
    targetCaption: CaptionListItem,
    targetLanguage: string,
    sourceCaption?: Caption,
  ): Promise<void>;
  clearTranslateTask(): void;
  reset(): void;
}

export function getAddonMediaId(meta: PlayerMeta): string {
  const isSpecialSeason = meta.type === "show" && meta.season?.number === 0;
  const imdbId = meta.imdbId?.trim();

  if (!isSpecialSeason && imdbId && /^tt\d+$/i.test(imdbId)) return imdbId;
  return `tmdb:${meta.tmdbId}`;
}

/**
 * Generates a unique media key for tracking failed sources per media.
 * For movies: `${type}-${tmdbId}`
 * For shows: `${type}-${tmdbId}-${season.tmdbId}-${episode.tmdbId}`
 */
export function getMediaKey(meta: PlayerMeta | null): string | null {
  if (!meta) return null;

  if (meta.type === "movie") {
    return `${meta.type}-${meta.tmdbId}`;
  }

  // For shows, include season and episode IDs for per-episode tracking
  if (meta.type === "show") {
    const seasonKey = meta.season?.tmdbId ?? meta.season?.number ?? "0";
    const episodeKey = meta.episode?.tmdbId ?? meta.episode?.number ?? "0";
    return `${meta.type}-${meta.tmdbId}-${seasonKey}-${episodeKey}`;
  }

  // Fallback if show data is incomplete
  return `${meta.type}-${meta.tmdbId}`;
}

function getExternalSubtitleMediaKey(meta: PlayerMeta | null): string | null {
  const mediaKey = getMediaKey(meta);
  if (!mediaKey) return null;

  return `${mediaKey}:${getExternalSubtitleLanguageKey(
    useSubtitleStore.getState().lastSelectedLanguage,
    useLanguageStore.getState().language,
  )}`;
}

function hasVietnameseWyzieCaption(captions: CaptionListItem[]) {
  return captions.some((caption) => {
    const language = caption.language.trim().toLowerCase().split("-")[0];
    const source = caption.source?.toLowerCase() ?? "";
    return (
      language === "vi" &&
      (source.includes("wyzie") || caption.url.includes("sub.wyzie.io"))
    );
  });
}

function hasNativeSubtitleAddon(addons: ReturnType<typeof getInstalledAddons>) {
  return addons.some(
    (addon) =>
      addon.enabled &&
      (addon.isNative || addon.manifest.id === NATIVE_SUBTITLE_ADDON_ID),
  );
}

function getCaptionIdentityKey(caption: CaptionListItem): string {
  return [
    caption.url,
    caption.language,
    caption.trackId ?? "",
    caption.type ?? "",
    caption.source ?? "",
    caption.display ?? "",
  ].join("::");
}

export function isEmbeddedCaption(
  caption: Pick<CaptionListItem, "trackId" | "type" | "source">,
): boolean {
  return (
    typeof caption.trackId === "string" ||
    caption.type === "embedded" ||
    caption.source === "embedded"
  );
}

function getCaptionSourcePriority(caption: CaptionListItem): number {
  if (isEmbeddedCaption(caption)) return -2;
  if (!caption.opensubtitles) return -1;

  const normalizedSource = caption.source?.toLowerCase() ?? "";
  if (normalizedSource.includes("wyzie")) return 0;
  if (normalizedSource.includes("opensubs")) return 1;
  if (normalizedSource.includes("subsource")) return 2;
  if (normalizedSource.includes("granite")) return 3;

  return Number.MAX_SAFE_INTEGER;
}

function sortCaptionList(captions: CaptionListItem[]) {
  return [...captions].sort((a, b) => {
    const priorityDiff =
      getCaptionSourcePriority(a) - getCaptionSourcePriority(b);
    if (priorityDiff !== 0) return priorityDiff;

    const languageCompare = a.language.localeCompare(b.language);
    if (languageCompare !== 0) return languageCompare;

    return (a.display ?? "").localeCompare(b.display ?? "");
  });
}

function mergeCaptionLists(
  primaryCaptions: CaptionListItem[],
  extraCaptions: CaptionListItem[],
) {
  const seen = new Set<string>();
  const merged: CaptionListItem[] = [];

  [...primaryCaptions, ...extraCaptions].forEach((caption) => {
    const key = getCaptionIdentityKey(caption);
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(caption);
  });

  return sortCaptionList(merged);
}

function isCustomCaptionId(captionId: string) {
  return captionId === "custom-caption" || captionId === "pasted-caption";
}

function hasCompletedExternalSubtitleLoad(
  isLoadingExternalSubtitles: boolean,
  externalSubtitleLoadProgress: { completed: number; total: number },
) {
  return (
    !isLoadingExternalSubtitles &&
    externalSubtitleLoadProgress.total > 0 &&
    externalSubtitleLoadProgress.completed >= externalSubtitleLoadProgress.total
  );
}

function canPreserveCaption(caption: Caption | null) {
  if (!caption) return false;
  if (isCustomCaptionId(caption.id)) return true;
  if (caption.trackId?.trim()) return true;
  return caption.vttData.trim().length > 0;
}

function captionExistsInList(
  caption: Caption | null,
  captionList: CaptionListItem[],
) {
  if (!caption) return false;
  return captionList.some((listItem) => listItem.id === caption.id);
}

function toPersistedCaption(
  caption: Caption | null,
  captionList: CaptionListItem[],
) {
  if (!caption) return null;
  if (isCustomCaptionId(caption.id)) return caption;

  return {
    ...caption,
    persisted: !captionExistsInList(caption, captionList),
  };
}

export const createSourceSlice: MakeSlice<SourceSlice> = (set, get) => ({
  source: null,
  sourceId: null,
  embedId: null,
  qualities: [],
  audioTracks: [],
  embeddedSubtitleTracksLoaded: false,
  captionList: [],
  isLoadingExternalSubtitles: false,
  externalSubtitleLoadError: null,
  externalSubtitleRequestId: 0,
  externalSubtitleLoadProgress: {
    completed: 0,
    total: 0,
  },
  externalSubtitleMediaKey: null,
  externalSubtitleRefreshMediaKey: null,
  currentQuality: null,
  segmentQualityDebug: null,
  currentAudioTrack: null,
  preferredStream: null,
  subtitleSync: {
    active: false,
    phase: "idle",
    progress: 0,
  },
  setPreferredStream(stream) {
    set((s) => {
      s.preferredStream = stream;
    });
  },
  setSubtitleSyncState(state) {
    set((s) => {
      s.subtitleSync = state;
    });
  },
  status: playerStatus.IDLE,
  meta: null,
  caption: {
    selected: null,
    secondary: null,
    dualSubEnabled: false,
    activeTrack: "primary",
    asTrack: false,
    translateTask: null,
  },
  setSourceId(id) {
    set((s) => {
      s.status = playerStatus.PLAYING;
      s.sourceId = id;
      s.embedId = null;
    });
  },
  setEmbedId(id) {
    set((s) => {
      s.embedId = id;
    });
  },
  setStatus(status: PlayerStatus) {
    set((s) => {
      s.status = status;
    });
  },
  setMeta(meta, newStatus) {
    const store = get();
    const oldMediaKey = getMediaKey(store.meta);
    const newMediaKey = getMediaKey(meta);
    const isMediaChanged = newMediaKey !== oldMediaKey;

    if (isMediaChanged || newStatus === playerStatus.SOURCE_SELECTION) {
      store.display?.load({
        source: null,
        startAt: 0,
        automaticQuality: false,
        preferredQuality: null,
        reason: "store:set-meta",
      });
      store.display?.setCaption(null);
      store.display?.setSecondaryCaption?.(null);
      store.clearTranslateTask();

      // Prevent ghost torrent status from previous episode showing during source selection
      if (typeof window !== "undefined") {
        clearActiveTorrentSession();
      }
    }

    set((s) => {
      s.meta = meta;
      s.embedId = null;
      s.sourceId = null;
      s.interface.hideNextEpisodeBtn = false;
      s.interface.nextEpisodeAction = null;
      if (newStatus) s.status = newStatus;
      if (isMediaChanged) {
        // Invalidate subtitle selection/load work before the next source is ready.
        s.externalSubtitleRequestId += 1;
        s.externalSubtitleMediaKey = null;
        if (oldMediaKey && newMediaKey) {
          s.externalSubtitleRefreshMediaKey = newMediaKey;
        } else if (s.externalSubtitleRefreshMediaKey !== newMediaKey) {
          s.externalSubtitleRefreshMediaKey = null;
        }
        s.caption.selected = null;
        s.caption.secondary = null;
        s.caption.translateTask = null;
        s.captionList = [];
        s.embeddedSubtitleTracksLoaded = false;
        s.audioTracks = [];
        s.currentAudioTrack = null;
        s.currentQuality = null;
        s.segmentQualityDebug = null;
        s.source = null;
        s.progress.time = 0;
        s.progress.duration = 0;
        s.progress.buffered = 0;
        s.mediaPlaying.hasRenderedFrame = false;
        s.mediaPlaying.isLoading = true;
      } else if (newStatus === playerStatus.SOURCE_SELECTION) {
        s.mediaPlaying.hasRenderedFrame = false;
        s.mediaPlaying.isLoading = true;
      }
    });
  },
  setCaption(caption) {
    const store = get();
    store.display?.setCaption(caption);
    if (
      !caption ||
      (store.caption.translateTask &&
        store.caption.translateTask.targetCaption.id !== caption?.id &&
        store.caption.translateTask.translatedCaption?.id !== caption?.id)
    ) {
      store.clearTranslateTask();
    }
    set((s) => {
      s.caption.selected = caption;
      if (
        caption &&
        s.caption.translateTask?.translatedCaption?.id === caption.id
      ) {
        s.caption.translateTask.translatedCaption = caption;
      }
    });
  },
  setEmbeddedSubtitleTracks(captions) {
    set((s) => {
      const existingCaptions = s.captionList.filter(
        (caption) => !isEmbeddedCaption(caption),
      );
      s.captionList = sortCaptionList([...existingCaptions, ...captions]);
      s.embeddedSubtitleTracksLoaded = true;
    });
  },
  setSecondaryCaption(caption) {
    const store = get();
    store.display?.setSecondaryCaption?.(
      store.caption.dualSubEnabled ? caption : null,
    );
    set((s) => {
      s.caption.secondary = caption;
      if (
        caption &&
        s.caption.translateTask?.translatedCaption?.id === caption.id
      ) {
        s.caption.translateTask.translatedCaption = caption;
      }
    });
  },
  setDualSubEnabled(enabled) {
    const store = get();
    store.display?.setSecondaryCaption?.(
      enabled ? store.caption.secondary : null,
    );
    set((s) => {
      s.caption.dualSubEnabled = enabled;
      if (!enabled) {
        s.caption.secondary = null;
        s.caption.activeTrack = "primary";
      }
    });
  },
  setActiveCaptionTrack(track) {
    set((s) => {
      s.caption.activeTrack = track;
    });
  },
  setSource(
    stream: SourceSliceSource,
    captions: CaptionListItem[],
    startAt: number,
  ) {
    const store = get();
    const currentMediaKey = getExternalSubtitleMediaKey(store.meta);
    const currentMediaId = getMediaKey(store.meta);
    const hasLoadedForCurrentMedia =
      !!currentMediaKey && currentMediaKey === store.externalSubtitleMediaKey;
    const shouldForceRefreshExternalSubtitles =
      !!currentMediaId &&
      currentMediaId === store.externalSubtitleRefreshMediaKey;
    const isExternalLoading = store.isLoadingExternalSubtitles;
    const shouldReuseLoadedExternalSubtitles =
      !shouldForceRefreshExternalSubtitles &&
      hasLoadedForCurrentMedia &&
      (hasCompletedExternalSubtitleLoad(
        store.isLoadingExternalSubtitles,
        store.externalSubtitleLoadProgress,
      ) ||
        isExternalLoading);
    const existingExternalCaptions = shouldReuseLoadedExternalSubtitles
      ? store.captionList.filter((caption) => caption.opensubtitles)
      : [];
    const mergedCaptions = shouldReuseLoadedExternalSubtitles
      ? mergeCaptionLists(captions, existingExternalCaptions)
      : captions;
    const preservedSelectedCaption =
      shouldReuseLoadedExternalSubtitles &&
      canPreserveCaption(store.caption.selected)
        ? toPersistedCaption(store.caption.selected, mergedCaptions)
        : null;
    const preservedSecondaryCaption =
      shouldReuseLoadedExternalSubtitles &&
      canPreserveCaption(store.caption.secondary)
        ? toPersistedCaption(store.caption.secondary, mergedCaptions)
        : null;
    let qualities: string[] = [];
    if (stream.type === "file") qualities = Object.keys(stream.qualities);
    const qualityPreferences = useQualityStore.getState();
    const loadableStream = selectQuality(stream, qualityPreferences.quality);

    set((s) => {
      const nextRequestId = s.externalSubtitleRequestId + 1;
      s.source = stream;
      s.mediaPlaying.hasRenderedFrame = false;
      s.qualities = qualities as SourceQuality[];
      s.currentQuality = stream.quality ?? loadableStream.quality;
      s.segmentQualityDebug = null;
      s.captionList = mergedCaptions;
      s.externalSubtitleRequestId = nextRequestId;
      s.isLoadingExternalSubtitles = shouldReuseLoadedExternalSubtitles
        ? isExternalLoading
        : true;
      s.externalSubtitleLoadProgress = shouldReuseLoadedExternalSubtitles
        ? store.externalSubtitleLoadProgress
        : {
            completed: 0,
            total: 0,
          };
      s.caption.selected = preservedSelectedCaption;
      s.caption.secondary = preservedSecondaryCaption;
      s.caption.dualSubEnabled =
        !!preservedSelectedCaption &&
        !!preservedSecondaryCaption &&
        store.caption.dualSubEnabled;
      s.caption.activeTrack =
        s.caption.dualSubEnabled && store.caption.activeTrack === "secondary"
          ? "secondary"
          : "primary";
      s.caption.translateTask = null;
      s.externalSubtitleMediaKey = shouldReuseLoadedExternalSubtitles
        ? currentMediaKey
        : null;
      if (shouldForceRefreshExternalSubtitles) {
        s.externalSubtitleRefreshMediaKey = null;
      }
      s.interface.error = undefined;
      s.status = playerStatus.PLAYING;
      const autoplayNext = store.mediaPlaying.isPlaying || isAutoplayAllowed();
      s.mediaPlaying.isPaused = !autoplayNext;
      s.mediaPlaying.isPlaying = autoplayNext;
      s.audioTracks = [];
      s.embeddedSubtitleTracksLoaded = false;
      s.currentAudioTrack = null;
    });
    const nextStore = get();
    const requestId = nextStore.externalSubtitleRequestId;
    nextStore.redisplaySource(startAt);
    nextStore.display?.setCaption(preservedSelectedCaption);
    nextStore.display?.setSecondaryCaption?.(
      nextStore.caption.dualSubEnabled ? preservedSecondaryCaption : null,
    );

    // Trigger external subtitle scraping after stream is loaded
    // This runs asynchronously so it doesn't block the stream loading
    if (!shouldReuseLoadedExternalSubtitles) {
      const sourceMediaKey = getMediaKey(nextStore.meta);
      setTimeout(() => {
        const currentStore = get();
        if (
          currentStore.externalSubtitleRequestId !== requestId ||
          getMediaKey(currentStore.meta) !== sourceMediaKey
        ) {
          return;
        }

        void currentStore.addExternalSubtitles(requestId, {
          forceRefresh: shouldForceRefreshExternalSubtitles,
        });
      }, 100);
    }
  },
  redisplaySource(startAt: number) {
    const store = get();
    if (!store.source) return;
    const qualityPreferences = useQualityStore.getState();
    const loadableStream = selectQuality(store.source, {
      automaticQuality: qualityPreferences.quality.automaticQuality,
      lastChosenQuality: qualityPreferences.quality.lastChosenQuality,
    });
    set((s) => {
      s.interface.error = undefined;
      s.status = playerStatus.PLAYING;
    });
    store.display?.load({
      source: loadableStream.stream,
      startAt,
      automaticQuality: qualityPreferences.quality.automaticQuality,
      preferredQuality: qualityPreferences.quality.lastChosenQuality,
      autoplay: store.mediaPlaying.isPlaying || isAutoplayAllowed(),
    });
  },
  switchQuality(quality) {
    const store = get();
    if (!store.source) return;
    if (store.source.type === "file") {
      const selectedQuality = store.source.qualities[quality];
      if (!selectedQuality) return;
      set((s) => {
        s.currentQuality = quality;
        s.status = playerStatus.PLAYING;
        s.interface.error = undefined;
      });
      store.display?.load({
        source: selectedQuality,
        startAt: store.progress.time,
        automaticQuality: false,
        preferredQuality: quality,
        autoplay: store.mediaPlaying.isPlaying,
      });
    } else if (store.source.type === "hls" || store.source.type === "dash") {
      store.display?.changeQuality(false, quality);
    }
  },
  enableAutomaticQuality() {
    const store = get();
    store.display?.changeQuality(true, null);
  },
  setCaptionAsTrack(asTrack: boolean) {
    set((s) => {
      s.caption.asTrack = asTrack;
    });
  },
  reset() {
    get().clearSkipSegments?.();
    set((s) => {
      s.source = null;
      s.sourceId = null;
      s.embedId = null;
      s.qualities = [];
      s.audioTracks = [];
      s.embeddedSubtitleTracksLoaded = false;
      s.captionList = [];
      s.isLoadingExternalSubtitles = false;
      s.externalSubtitleRequestId += 1;
      s.externalSubtitleLoadProgress = {
        completed: 0,
        total: 0,
      };
      s.externalSubtitleMediaKey = null;
      s.currentQuality = null;
      s.segmentQualityDebug = null;
      s.currentAudioTrack = null;
      s.subtitleSync = {
        active: false,
        phase: "idle",
        progress: 0,
      };
      s.status = playerStatus.IDLE;
      s.meta = null;
      s.mediaPlaying.isPlaying = isAutoplayAllowed();
      s.mediaPlaying.isPaused = !isAutoplayAllowed();
      s.mediaPlaying.isLoading = false;
      s.mediaPlaying.hasPlayedOnce = false;
      s.mediaPlaying.hasRenderedFrame = false;
      this.clearTranslateTask();
      s.caption = {
        selected: null,
        secondary: null,
        dualSubEnabled: false,
        activeTrack: "primary",
        asTrack: false,
        translateTask: null,
      };
    });
  },
  async addExternalSubtitles(requestId, options) {
    const store = get();
    if (!store.meta) return;
    const activeRequestId = requestId ?? store.externalSubtitleRequestId + 1;
    const mediaKey = getExternalSubtitleMediaKey(store.meta);
    const requestedMediaKey = getMediaKey(store.meta);
    const requestedMeta = store.meta;
    if (!mediaKey || !requestedMediaKey) return;
    const queryKey = getExternalSubtitleQueryKey(mediaKey);
    const forceRefresh = options?.forceRefresh === true;
    const preferredLanguages = getExternalSubtitleLanguageKey(
      useSubtitleStore.getState().lastSelectedLanguage,
      useLanguageStore.getState().language,
    )
      .split(",")
      .filter(Boolean);

    set((s) => {
      if (requestId == null) {
        s.externalSubtitleRequestId = activeRequestId;
      }
      if (
        s.externalSubtitleRequestId === activeRequestId ||
        getMediaKey(s.meta) === requestedMediaKey
      ) {
        s.isLoadingExternalSubtitles = true;
        s.externalSubtitleLoadError = null;
        s.externalSubtitleLoadProgress = {
          completed: 0,
          total: 1,
        };
        s.externalSubtitleMediaKey = mediaKey;
        if (forceRefresh) {
          s.captionList = s.captionList.filter(
            (caption) => !caption.opensubtitles,
          );
        }
      }
    });

    let progressTimer: NodeJS.Timeout | null = null;
    let currentProgress = 5;

    const startProgressTimer = () => {
      progressTimer = setInterval(() => {
        const activeStore = get();
        if (
          getMediaKey(activeStore.meta) !== requestedMediaKey ||
          !activeStore.isLoadingExternalSubtitles
        ) {
          if (progressTimer) clearInterval(progressTimer);
          return;
        }

        if (currentProgress < 90) {
          const step = Math.max(2, Math.floor((90 - currentProgress) / 7));
          currentProgress = Math.min(90, currentProgress + step);
          set((s) => {
            if (getMediaKey(s.meta) === requestedMediaKey) {
              s.externalSubtitleLoadProgress = {
                completed: currentProgress,
                total: 100,
              };
            }
          });
        }
      }, 150);
    };

    try {
      if (forceRefresh) {
        await queryClient.cancelQueries({ queryKey, exact: true });
        queryClient.removeQueries({ queryKey, exact: true });
      }

      startProgressTimer();

      const baseMediaId = getAddonMediaId(requestedMeta);
      const type = requestedMeta.type === "show" ? "series" : "movie";
      const id =
        requestedMeta.type === "show" &&
        requestedMeta.season != null &&
        requestedMeta.episode != null
          ? `${baseMediaId}:${requestedMeta.season.number}:${requestedMeta.episode.number}`
          : baseMediaId;

      const captions = await queryClient.fetchQuery<CaptionListItem[]>({
        queryKey,
        staleTime: EXTERNAL_SUBTITLE_CACHE_TTL_MS,
        gcTime: EXTERNAL_SUBTITLE_CACHE_GC_MS,
        queryFn: async () => {
          const addons = getInstalledAddons();
          const onProgress = ({
            captions: sourceCaptions,
            completed,
            total,
          }: {
            captions: CaptionListItem[];
            completed: number;
            total: number;
          }) => {
            const currentStore = get();
            if (getMediaKey(currentStore.meta) !== requestedMediaKey) {
              return;
            }

            set((s) => {
              if (total > 1) {
                s.externalSubtitleLoadProgress = {
                  completed,
                  total,
                };
              }

              if (sourceCaptions.length > 0) {
                const existingCaptionKeys = new Set(
                  s.captionList.map(getCaptionIdentityKey),
                );
                const newCaptions = sourceCaptions.filter(
                  (caption) =>
                    !existingCaptionKeys.has(getCaptionIdentityKey(caption)),
                );
                s.captionList = sortCaptionList([
                  ...s.captionList,
                  ...newCaptions,
                ]);
              }
            });
          };

          const loadSubtitles = () =>
            loadAllAddonSubtitles(addons, type, id, onProgress, {
              forceRefresh,
              preferredLanguages,
            });

          let result = await loadSubtitles();
          if (
            forceRefresh &&
            hasNativeSubtitleAddon(addons) &&
            !hasVietnameseWyzieCaption(result.captions)
          ) {
            console.info(
              "[player] retrying forced subtitle refresh without Wyzie Vietnamese subtitle",
              { id },
            );
            await new Promise((resolve) => setTimeout(resolve, 250));
            result = await loadSubtitles();
          }

          const { captions: loadedCaptions, errors } = result;

          if (loadedCaptions.length === 0 && errors.length > 0) {
            throw new Error(
              `Failed to fetch subtitles: ${errors.map((e) => e.message).join(", ")}`,
            );
          }

          return loadedCaptions;
        },
      });

      if (progressTimer) clearInterval(progressTimer);

      const currentStore = get();
      if (getMediaKey(currentStore.meta) === requestedMediaKey) {
        if (captions.length === 0) {
          queryClient.removeQueries({ queryKey, exact: true });
        }

        set((s) => {
          const sourceCaptions = s.captionList.filter(
            (caption) => !caption.opensubtitles,
          );
          s.captionList = sortCaptionList([...sourceCaptions, ...captions]);
          s.externalSubtitleMediaKey = mediaKey;
          s.externalSubtitleLoadProgress = {
            completed: 100,
            total: 100,
          };
        });
      }
    } catch (error) {
      if (getMediaKey(get().meta) !== requestedMediaKey) return;
      console.error("Failed to load external subtitles:", error);
      set((s) => {
        s.externalSubtitleLoadError =
          error instanceof Error ? error.message : String(error);
      });
    } finally {
      if (progressTimer) clearInterval(progressTimer);
      set((s) => {
        if (getMediaKey(s.meta) === requestedMediaKey) {
          s.isLoadingExternalSubtitles = false;
        }
      });
    }
  },

  clearTranslateTask() {
    set((s) => {
      if (s.caption.translateTask) {
        s.caption.translateTask.cancel();
      }
      s.caption.translateTask = null;
    });
  },

  async translateCaption(
    targetCaption: CaptionListItem,
    targetLanguage: string,
    sourceCaptionSnapshot?: Caption,
  ) {
    let store = get();

    if (store.caption.translateTask) {
      console.warn("A translation task is already in progress");
      return;
    }

    const abortController = new AbortController();
    const activeCaption =
      sourceCaptionSnapshot ??
      [store.caption.selected, store.caption.secondary].find(
        (caption): caption is Caption =>
          caption !== null &&
          (caption.id === targetCaption.id ||
            caption.sourceCaption?.id === targetCaption.id),
      );
    const sourceCaption: Caption = activeCaption
      ? {
          ...activeCaption,
          vttData: activeCaption.alignmentBaseVttData ?? activeCaption.vttData,
          alignmentSourceVttData:
            activeCaption.alignmentSourceVttData ??
            activeCaption.alignmentBaseVttData ??
            activeCaption.vttData,
        }
      : {
          id: targetCaption.id,
          language: targetCaption.language,
          vttData: "",
        };

    set((s) => {
      s.caption.translateTask = {
        targetCaption,
        targetLanguage,
        done: false,
        error: false,
        cancel() {
          if (!this.done && !this.error) {
            console.log("Translation task was cancelled");
          }
          abortController.abort();
        },
      };
    });

    function handleError(err: any) {
      if (abortController.signal.aborted) {
        return;
      }
      console.error("Translation task ran into an error", err);
      set((s) => {
        if (!s.caption.translateTask) return;
        s.caption.translateTask.error = true;
      });
    }

    try {
      const vttData = await downloadCaptionAsVtt(targetCaption);
      if (abortController.signal.aborted) {
        return;
      }
      if (!vttData) {
        throw new Error("Fetching failed");
      }
      set((s) => {
        if (!s.caption.translateTask) return;
        const fetchedVttData = sourceCaption.vttData || vttData;
        s.caption.translateTask.fetchedTargetCaption = {
          ...sourceCaption,
          vttData: fetchedVttData,
          alignmentSourceVttData:
            sourceCaption.alignmentSourceVttData ?? fetchedVttData,
          sourceCaption: targetCaption,
        };
      });
      store = get();
    } catch (err) {
      handleError(err);
      return;
    }

    try {
      const result = await translate(
        store.caption.translateTask!.fetchedTargetCaption!,
        targetLanguage,
        googletranslate,
        abortController.signal,
      );
      if (abortController.signal.aborted) {
        return;
      }
      if (!result) {
        throw new Error("Translation failed");
      }
      set((s) => {
        if (!s.caption.translateTask) return;
        const translatedBaseVttData = result;
        const translatedSourceCaption =
          s.caption.translateTask.fetchedTargetCaption ?? sourceCaption;
        const alignment = translatedSourceCaption.alignment;
        const translatedCaption: Caption = {
          id: `${targetCaption.id}-translated-${targetLanguage}`,
          language: targetLanguage,
          url: targetCaption.url,
          vttData: applyStoredCaptionAlignment(
            translatedBaseVttData,
            alignment,
          ),
          alignmentSourceVttData:
            translatedSourceCaption.alignmentSourceVttData,
          ...(alignment
            ? {
                alignmentBaseVttData: translatedBaseVttData,
                alignment,
              }
            : {}),
          sourceCaption: targetCaption,
        };
        s.caption.translateTask.done = true;
        s.caption.translateTask.translatedCaption = translatedCaption;
      });
    } catch (err) {
      handleError(err);
    }
  },
});
