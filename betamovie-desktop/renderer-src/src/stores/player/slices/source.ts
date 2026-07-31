/* eslint-disable no-console */
import { downloadCaptionAsVtt } from "@/backend/helpers/subs";
import { SegmentQualityDebugInfo } from "@/components/player/display/displayInterface";
import { MakeSlice } from "@/stores/player/slices/types";
import {
  SourceQuality,
  SourceSliceSource,
  selectQuality,
} from "@/stores/player/utils/qualities";
import { useQualityStore } from "@/stores/quality";
import { isAutoplayAllowed } from "@/utils/autoplay";
import googletranslate from "@/utils/translation/googletranslate";
import { translate } from "@/utils/translation/index";
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

export interface Caption {
  id: string;
  language: string;
  url?: string;
  vttData: string;
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
  externalSubtitleRequestId: number;
  externalSubtitleLoadProgress: {
    completed: number;
    total: number;
  };
  externalSubtitleMediaKey: string | null;
  caption: {
    selected: Caption | null;
    secondary: Caption | null;
    dualSubEnabled: boolean;
    activeTrack: SubtitleTrack;
    asTrack: boolean;
    translateTask: TranslateTask | null;
  };
  meta: PlayerMeta | null;
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
  addExternalSubtitles(requestId?: number): Promise<void>;
  translateCaption(
    targetCaption: CaptionListItem,
    targetLanguage: string,
  ): Promise<void>;
  clearTranslateTask(): void;
  reset(): void;
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
  if (meta.type === "show" && meta.season && meta.episode) {
    return `${meta.type}-${meta.tmdbId}-${meta.season.tmdbId}-${meta.episode.tmdbId}`;
  }

  // Fallback if show data is incomplete
  return `${meta.type}-${meta.tmdbId}`;
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
  externalSubtitleRequestId: 0,
  externalSubtitleLoadProgress: {
    completed: 0,
    total: 0,
  },
  externalSubtitleMediaKey: null,
  currentQuality: null,
  segmentQualityDebug: null,
  currentAudioTrack: null,
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

    set((s) => {
      s.meta = meta;
      s.embedId = null;
      s.sourceId = null;
      s.interface.hideNextEpisodeBtn = false;
      if (newStatus) s.status = newStatus;
      if (newMediaKey !== oldMediaKey) {
        s.externalSubtitleMediaKey = null;
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
    const currentMediaKey = getMediaKey(store.meta);
    const shouldReuseLoadedExternalSubtitles =
      !!currentMediaKey &&
      currentMediaKey === store.externalSubtitleMediaKey &&
      hasCompletedExternalSubtitleLoad(
        store.isLoadingExternalSubtitles,
        store.externalSubtitleLoadProgress,
      );
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
      s.isLoadingExternalSubtitles = !shouldReuseLoadedExternalSubtitles;
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
      s.interface.error = undefined;
      s.status = playerStatus.PLAYING;
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
      setTimeout(() => {
        nextStore.addExternalSubtitles(requestId);
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
      autoplay: isAutoplayAllowed(),
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
      s.status = playerStatus.IDLE;
      s.meta = null;
      s.mediaPlaying.isPlaying = false;
      s.mediaPlaying.isPaused = true;
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
  async addExternalSubtitles(requestId) {
    const store = get();
    if (!store.meta) return;
    const activeRequestId = requestId ?? store.externalSubtitleRequestId;
    const mediaKey = getMediaKey(store.meta);

    set((s) => {
      if (s.externalSubtitleRequestId === activeRequestId) {
        s.isLoadingExternalSubtitles = true;
        s.externalSubtitleLoadProgress = {
          completed: 0,
          total: 0,
        };
        s.externalSubtitleMediaKey = mediaKey;
      }
    });

    try {
      const { scrapeExternalSubtitles } =
        await import("@/utils/externalSubtitles");
      await scrapeExternalSubtitles(
        store.meta,
        ({ captions, completed, total }) => {
          if (get().externalSubtitleRequestId !== activeRequestId) return;

          set((s) => {
            if (s.externalSubtitleRequestId !== activeRequestId) return;

            s.externalSubtitleLoadProgress = {
              completed,
              total,
            };

            if (captions.length > 0) {
              const existingCaptionKeys = new Set(
                s.captionList.map(getCaptionIdentityKey),
              );
              const newCaptions = captions.filter(
                (c) => !existingCaptionKeys.has(getCaptionIdentityKey(c)),
              );
              s.captionList = sortCaptionList([
                ...s.captionList,
                ...newCaptions,
              ]);
            }
          });
        },
      );
    } catch (error) {
      if (get().externalSubtitleRequestId !== activeRequestId) return;
      console.error("Failed to scrape external subtitles:", error);
    } finally {
      set((s) => {
        if (s.externalSubtitleRequestId === activeRequestId) {
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
  ) {
    let store = get();

    if (store.caption.translateTask) {
      console.warn("A translation task is already in progress");
      return;
    }

    const abortController = new AbortController();

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
        s.caption.translateTask.fetchedTargetCaption = {
          id: targetCaption.id,
          language: targetCaption.language,
          vttData,
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
        const translatedCaption: Caption = {
          id: `${targetCaption.id}-translated-${targetLanguage}`,
          language: targetLanguage,
          vttData: result,
        };
        s.caption.translateTask.done = true;
        s.caption.translateTask.translatedCaption = translatedCaption;
      });
    } catch (err) {
      handleError(err);
    }
  },
});
