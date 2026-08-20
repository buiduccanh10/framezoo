import { useCallback, useEffect, useMemo, useRef } from "react";

import { downloadCaptionAsVtt } from "@/backend/helpers/subs";
import { useSkipTime } from "@/components/player/hooks/useSkipTime";
import { scoreCaptionSourceFit } from "@/components/player/utils/captionSourceFit";
import {
  type SubtitleAlignmentTrack,
  alignSubtitlesWithCurrentStream,
  applySubtitleAlignment,
  getSubtitleAlignmentBaseVtt,
  getSubtitleAlignmentInputVtt,
  isSubtitleAlignmentResultApplicable,
} from "@/components/player/utils/subtitleAlignment";
import { useInstalledAddons } from "@/desktop/addons/store";
import { loadAllAddonSubtitles } from "@/desktop/addons/subtitles";
import { useLanguageStore } from "@/stores/language";
import {
  Caption,
  CaptionListItem,
  isEmbeddedCaption,
} from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";
import { useSubtitleStore } from "@/stores/subtitles";
import { getPrettyLanguageNameFromLocale } from "@/utils/language";

import {
  getCaptionLanguageGroupKey,
  isLanguageMatch,
} from "../utils/captionLanguage";

let autoSelectionRequestId = 0;
let subtitleAlignmentRequestId = 0;
let activeSubtitleSyncCancel: (() => void) | null = null;
const AUTO_SCORE_MAX_CANDIDATES = 8;
const AUTO_SCORE_CONCURRENCY = 3;
const AUTO_SCORE_PER_ITEM_TIMEOUT_MS = 1500;
const SUBTITLE_SYNC_PAUSE_TIMEOUT_MS = 1500;
const SUBTITLE_SYNC_STABLE_SAMPLES = 2;

type SubtitleSyncTarget = {
  track: SubtitleAlignmentTrack;
  caption: Caption;
  listItem: CaptionListItem;
};

function waitForStablePlaybackPosition(): Promise<number | null> {
  return new Promise((resolve) => {
    const deadline = performance.now() + SUBTITLE_SYNC_PAUSE_TIMEOUT_MS;
    let previousTime: number | null = null;
    let stableSamples = 0;

    const sample = () => {
      const state = usePlayerStore.getState();
      const currentTime = state.progress.time;

      if (
        !state.mediaPlaying.isPlaying &&
        Number.isFinite(currentTime) &&
        (previousTime === null || Math.abs(currentTime - previousTime) <= 0.05)
      ) {
        stableSamples += 1;
      } else {
        stableSamples = 0;
      }
      previousTime = currentTime;

      if (
        stableSamples >= SUBTITLE_SYNC_STABLE_SAMPLES ||
        performance.now() >= deadline
      ) {
        resolve(
          stableSamples >= SUBTITLE_SYNC_STABLE_SAMPLES &&
            Number.isFinite(currentTime)
            ? currentTime
            : null,
        );
        return;
      }

      window.setTimeout(sample, 50);
    };

    sample();
  });
}

export type SubtitleSyncOutcome =
  | { status: "success"; warningMessage?: string }
  | { status: "cancelled" }
  | { status: "failed"; errorMessage?: string };

export function cancelActiveSubtitleSync() {
  activeSubtitleSyncCancel?.();
}

function extractSubtitleSyncErrorMessage(error: unknown): string | undefined {
  const queue: unknown[] = [error];
  const visited = new Set<object>();
  const fallbackMessages: string[] = [];

  while (queue.length > 0) {
    const value = queue.shift();

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) continue;

      try {
        queue.push(JSON.parse(trimmed));
        continue;
      } catch {
        fallbackMessages.push(trimmed);
        continue;
      }
    }

    if (!value || typeof value !== "object") continue;
    if (visited.has(value)) continue;
    visited.add(value);

    const record = value as Record<string, unknown>;
    const detail = record.detail;
    if (typeof detail === "string" && detail.trim()) {
      return detail.trim();
    }

    for (const key of ["data", "response", "_data"]) {
      if (record[key] !== undefined) queue.push(record[key]);
    }

    for (const key of ["statusMessage", "message", "error"]) {
      if (record[key] !== undefined) queue.push(record[key]);
    }
  }

  return fallbackMessages.find(
    (message) => !/^(bad request|fetch error|request failed)$/i.test(message),
  );
}

function resolvePreferredAutoSubtitleLanguage(
  lastSelectedLanguage: string | null,
  userLanguage: string | null | undefined,
) {
  return lastSelectedLanguage ?? userLanguage ?? "en";
}

export function useCaptions() {
  const setLanguage = useSubtitleStore((s) => s.setLanguage);
  const userLanguage = useLanguageStore((s) => s.language);
  const enabled = useSubtitleStore((s) => s.enabled);
  const resetSubtitleSpecificSettings = useSubtitleStore(
    (s) => s.resetSubtitleSpecificSettings,
  );
  const setCaption = usePlayerStore((s) => s.setCaption);
  const setSecondaryCaption = usePlayerStore((s) => s.setSecondaryCaption);
  const currentTranslateTask = usePlayerStore((s) => s.caption.translateTask);
  const lastSelectedLanguage = useSubtitleStore((s) => s.lastSelectedLanguage);
  const setIsOpenSubtitles = useSubtitleStore((s) => s.setIsOpenSubtitles);

  const captionList = usePlayerStore((s) => s.captionList);
  const getHlsCaptionList = usePlayerStore((s) => s.display?.getCaptionList);
  const source = usePlayerStore((s) => s.source);
  const embeddedSubtitleTracksLoaded = usePlayerStore(
    (s) => s.embeddedSubtitleTracksLoaded,
  );
  const selectedCaption = usePlayerStore((s) => s.caption.selected);
  const secondaryCaption = usePlayerStore((s) => s.caption.secondary);
  const externalSubtitleRequestId = usePlayerStore(
    (s) => s.externalSubtitleRequestId,
  );
  const isLoadingExternalSubtitles = usePlayerStore(
    (s) => s.isLoadingExternalSubtitles,
  );
  const videoDuration = usePlayerStore((s) => s.progress.duration);
  const segments = useSkipTime();

  const setCaptionAsTrack = usePlayerStore((s) => s.setCaptionAsTrack);
  const captionAsTrack = usePlayerStore((s) => s.caption.asTrack);
  const latestAutoSelectRequestIdRef = useRef<number | null>(null);
  const syncAbortControllerRef = useRef<AbortController | null>(null);
  const subtitleSync = usePlayerStore((s) => s.subtitleSync);
  const setSubtitleSyncState = usePlayerStore((s) => s.setSubtitleSyncState);
  const isSyncingSubtitle = subtitleSync.active;
  const syncSubtitleProgress = subtitleSync.active
    ? subtitleSync.progress
    : null;

  // ─── Addon subtitle injection ───────────────────────────────────────────────
  const installedAddons = useInstalledAddons();
  const meta = usePlayerStore((s) => s.meta);

  useEffect(() => {
    if (!meta) return;

    // Derive Stremio-compatible type and id from the player meta
    const type = meta.type === "show" ? "series" : "movie";
    let id: string;

    if (meta.type === "show" && meta.season != null && meta.episode != null) {
      // Series episode: imdbId:season:episode
      const imdbId = meta.imdbId ?? String(meta.tmdbId);
      id = `${imdbId}:${meta.season.number}:${meta.episode.number}`;
    } else {
      id = meta.imdbId ?? String(meta.tmdbId);
    }

    let cancelled = false;

    loadAllAddonSubtitles(installedAddons, type, id)
      .then(({ captions }) => {
        if (cancelled || captions.length === 0) return;

        // Merge addon subtitles into the player captionList via the store,
        // de-duplicating against entries already in the list.
        usePlayerStore.setState((state) => {
          const existingIds = new Set(state.captionList.map((c) => c.id));
          const newCaptions = captions.filter((c) => !existingIds.has(c.id));
          if (newCaptions.length === 0) return {};
          return { captionList: [...state.captionList, ...newCaptions] };
        });
      })
      .catch((err: unknown) => {
        console.warn("[useCaptions] Addon subtitle fetch failed", err);
      });

    return () => {
      cancelled = true;
    };
    // Re-run when the video changes (meta id changes) or addon list changes
  }, [
    meta,
    meta?.tmdbId,
    meta?.type,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    meta?.type === "show" ? (meta as any)?.season?.number : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    meta?.type === "show" ? (meta as any)?.episode?.number : undefined,
    installedAddons,
  ]);
  // ────────────────────────────────────────────────────────────────────────────

  const alignCaptionTracks = useCallback(
    async (targets: SubtitleSyncTarget[]): Promise<SubtitleSyncOutcome> => {
      const requestId = ++subtitleAlignmentRequestId;
      const abortController = new AbortController();
      syncAbortControllerRef.current = abortController;
      activeSubtitleSyncCancel = () => {
        abortController.abort();
      };
      const initialState = usePlayerStore.getState();
      const initialSource = initialState.source;
      const wasPlaying =
        initialState.mediaPlaying.isPlaying &&
        !initialState.mediaPlaying.isPaused;
      let contextSource = initialSource;

      if (targets.length === 0 || initialSource?.type !== "file") {
        return { status: "failed" };
      }

      setSubtitleSyncState({
        active: true,
        phase: wasPlaying ? "pausing" : "capturing",
        progress: 0,
      });

      try {
        if (wasPlaying) {
          initialState.display?.pause();
        }

        const pausedTime = await waitForStablePlaybackPosition();
        if (pausedTime === null) return { status: "failed" };

        const pausedState = usePlayerStore.getState();
        if (pausedState.source !== initialSource) return { status: "failed" };

        contextSource = pausedState.source;
        const quality =
          (pausedState.currentQuality &&
            contextSource.qualities[pausedState.currentQuality]) ||
          Object.values(contextSource.qualities).find((item) => Boolean(item));
        if (!quality?.url) return { status: "failed" };

        const contextQualityUrl = quality.url;
        const contextAudioTrackId = pausedState.currentAudioTrack?.id ?? null;
        const alignmentVideoDuration =
          pausedState.progress.duration > 0
            ? pausedState.progress.duration
            : (contextSource.duration ?? 0);

        setSubtitleSyncState({
          active: true,
          phase: "capturing",
          progress: 0,
        });

        const batchResult = await alignSubtitlesWithCurrentStream({
          sourceUrl: quality.url,
          startAt: Math.max(0, pausedTime - 30),
          language: pausedState.currentAudioTrack?.language ?? "en",
          subtitles: targets.map(({ track, caption }) => ({
            track,
            vttData: getSubtitleAlignmentInputVtt(caption),
          })),
          headers: contextSource.headers ?? contextSource.preferredHeaders,
          videoDuration: alignmentVideoDuration,
          buffered: pausedState.progress.buffered,
          signal: abortController.signal,
          onProgress: (progress, phase) => {
            if (requestId === subtitleAlignmentRequestId) {
              setSubtitleSyncState({
                active: true,
                phase: phase ?? (progress < 0.35 ? "capturing" : "analyzing"),
                progress,
              });
            }
          },
        });
        if (requestId !== subtitleAlignmentRequestId) {
          return { status: "failed" };
        }

        const currentPlayerState = usePlayerStore.getState();
        const currentSource = currentPlayerState.source;
        const currentQualityUrl =
          currentSource?.type === "file"
            ? (
                (currentPlayerState.currentQuality &&
                  currentSource.qualities[currentPlayerState.currentQuality]) ||
                Object.values(currentSource.qualities).find((item) =>
                  Boolean(item),
                )
              )?.url
            : undefined;
        if (
          currentSource !== contextSource ||
          currentQualityUrl !== contextQualityUrl ||
          (currentPlayerState.currentAudioTrack?.id ?? null) !==
            contextAudioTrackId
        ) {
          return { status: "failed" };
        }

        const currentCaptions = currentPlayerState.caption;
        const alignedTargets = targets.map((target) => {
          const result = batchResult.results[target.track];
          const currentCaption =
            target.track === "primary"
              ? currentCaptions.selected
              : currentCaptions.secondary;

          return {
            target,
            result,
            currentCaption,
            inputVttData: getSubtitleAlignmentInputVtt(target.caption),
            baseVttData: getSubtitleAlignmentBaseVtt(target.caption),
          };
        });
        const applicableTargets = alignedTargets.filter(
          ({ target, result, currentCaption, inputVttData }) =>
            isSubtitleAlignmentResultApplicable({
              result,
              expectedCaptionId: target.caption.id,
              currentCaptionId: currentCaption?.id,
              expectedBaseVttData: inputVttData,
              currentBaseVttData: currentCaption
                ? getSubtitleAlignmentInputVtt(currentCaption)
                : undefined,
            }),
        );

        if (applicableTargets.length === 0) {
          return {
            status: "failed",
            errorMessage: batchResult.errorMessage,
          };
        }

        setSubtitleSyncState({
          active: true,
          phase: "applying",
          progress: 1,
        });

        for (const {
          target,
          result,
          currentCaption,
          inputVttData,
          baseVttData,
        } of applicableTargets) {
          if (!result || !currentCaption) continue;
          const alignedVtt = applySubtitleAlignment(baseVttData, result);
          const alignment = {
            offsetMs: result.offsetMs,
            ...(result.segments ? { segments: result.segments } : {}),
          };
          if (
            alignedVtt !== currentCaption.vttData ||
            currentCaption.alignmentBaseVttData !== baseVttData ||
            currentCaption.alignment?.offsetMs !== alignment.offsetMs ||
            JSON.stringify(currentCaption.alignment?.segments) !==
              JSON.stringify(alignment.segments)
          ) {
            const nextCaption = {
              ...currentCaption,
              vttData: alignedVtt,
              alignmentBaseVttData: baseVttData,
              alignmentSourceVttData: inputVttData,
              alignment,
            };
            if (target.track === "primary") {
              setCaption(nextCaption);
            } else {
              setSecondaryCaption(nextCaption);
            }
          }
          resetSubtitleSpecificSettings(target.track);
        }

        console.info("[subtitle-align]", {
          tracks: targets.map(({ track, caption }) => {
            const result = batchResult.results[track];
            return {
              track,
              captionId: caption.id,
              offsetMs: result?.offsetMs,
              confidence: result?.confidence,
              reason: result?.reason,
            };
          }),
        });
        return {
          status: "success",
          warningMessage: batchResult.warningMessage,
        };
      } catch (error) {
        if (
          abortController.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return { status: "cancelled" };
        }
        if (requestId !== subtitleAlignmentRequestId) {
          return { status: "failed" };
        }
        console.warn("[subtitle-align] skipped", {
          captionIds: targets.map(({ caption }) => caption.id),
          error,
        });
        return {
          status: "failed",
          errorMessage: extractSubtitleSyncErrorMessage(error),
        };
      } finally {
        if (requestId === subtitleAlignmentRequestId) {
          if (syncAbortControllerRef.current === abortController) {
            syncAbortControllerRef.current = null;
            activeSubtitleSyncCancel = null;
          }
          const finalState = usePlayerStore.getState();
          if (
            wasPlaying &&
            finalState.source === contextSource &&
            finalState.display
          ) {
            finalState.display.play();
          }
          setSubtitleSyncState({
            active: false,
            phase: "idle",
            progress: 0,
          });
        }
      }
    },
    [
      resetSubtitleSpecificSettings,
      setCaption,
      setSecondaryCaption,
      setSubtitleSyncState,
    ],
  );

  const captions = useMemo(
    () =>
      captionList.length !== 0 ? captionList : (getHlsCaptionList?.() ?? []),
    [captionList, getHlsCaptionList],
  );

  const selectedCaptionListItem = useMemo(
    () =>
      selectedCaption
        ? (captions.find((caption) => caption.id === selectedCaption.id) ??
          selectedCaption.sourceCaption ??
          null)
        : null,
    [captions, selectedCaption],
  );
  const secondaryCaptionListItem = useMemo(
    () =>
      secondaryCaption
        ? (captions.find((caption) => caption.id === secondaryCaption.id) ??
          secondaryCaption.sourceCaption ??
          null)
        : null,
    [captions, secondaryCaption],
  );
  const canSyncSelectedCaption =
    source?.type === "file" &&
    ((selectedCaption != null &&
      selectedCaptionListItem != null &&
      !isEmbeddedCaption(selectedCaptionListItem) &&
      selectedCaptionListItem.opensubtitles === true &&
      selectedCaption.vttData.trim().length > 0) ||
      (secondaryCaption != null &&
        secondaryCaptionListItem != null &&
        !isEmbeddedCaption(secondaryCaptionListItem) &&
        secondaryCaptionListItem.opensubtitles === true &&
        secondaryCaption.vttData.trim().length > 0));

  const syncSelectedCaption =
    useCallback(async (): Promise<SubtitleSyncOutcome> => {
      if (isSyncingSubtitle || !canSyncSelectedCaption) {
        return { status: "failed" };
      }

      const targets: SubtitleSyncTarget[] = [];
      if (
        selectedCaption &&
        selectedCaptionListItem &&
        !isEmbeddedCaption(selectedCaptionListItem) &&
        selectedCaptionListItem.opensubtitles === true &&
        selectedCaption.vttData.trim().length > 0
      ) {
        targets.push({
          track: "primary",
          caption: selectedCaption,
          listItem: selectedCaptionListItem,
        });
      }
      if (
        secondaryCaption &&
        secondaryCaptionListItem &&
        secondaryCaption.id !== selectedCaption?.id &&
        !isEmbeddedCaption(secondaryCaptionListItem) &&
        secondaryCaptionListItem.opensubtitles === true &&
        secondaryCaption.vttData.trim().length > 0
      ) {
        targets.push({
          track: "secondary",
          caption: secondaryCaption,
          listItem: secondaryCaptionListItem,
        });
      }

      return alignCaptionTracks(targets);
    }, [
      alignCaptionTracks,
      canSyncSelectedCaption,
      isSyncingSubtitle,
      selectedCaption,
      selectedCaptionListItem,
      secondaryCaption,
      secondaryCaptionListItem,
    ]);

  const findCaptionByPreferredLanguage = useCallback(
    (language: string) => {
      const exact = captions.find((caption) => caption.language === language);
      if (exact) return exact;

      const byCode = captions.find((caption) =>
        isLanguageMatch(caption.language, language),
      );
      if (byCode) return byCode;

      const preferredName = getPrettyLanguageNameFromLocale(language)
        ?.toLowerCase()
        .split(" (")[0];
      if (preferredName) {
        const byPrettyName = captions.find((caption) => {
          const captionName = getPrettyLanguageNameFromLocale(caption.language)
            ?.toLowerCase()
            .split(" (")[0];
          return captionName === preferredName;
        });
        if (byPrettyName) return byPrettyName;
      }

      return null;
    },
    [captions],
  );

  const scoreCaptionsForLanguage = useCallback(
    async (
      language: string,
      options?: {
        mode?: "auto" | "full";
      },
    ) => {
      const mode = options?.mode ?? "full";
      const languageCaptions = captions.filter(
        (caption) =>
          isLanguageMatch(getCaptionLanguageGroupKey(caption), language) ||
          isLanguageMatch(caption.language, language),
      );

      if (languageCaptions.length === 0) return [];

      const inSourceCaptions = languageCaptions.filter(
        (caption) => !caption.opensubtitles,
      );
      if (inSourceCaptions.length > 0) {
        return inSourceCaptions.map((caption, index) => ({
          caption,
          index,
          score: 100,
          confidence: "high" as const,
        }));
      }

      const videoDurationMs = videoDuration > 0 ? videoDuration * 1000 : 0;
      const candidates =
        mode === "auto"
          ? languageCaptions.slice(0, AUTO_SCORE_MAX_CANDIDATES)
          : languageCaptions;
      const scored: Array<{
        caption: CaptionListItem;
        index: number;
        score: number;
        confidence: "high" | "medium" | "low";
      }> = [];

      let nextIndex = 0;
      const workers = Array.from(
        { length: Math.min(AUTO_SCORE_CONCURRENCY, candidates.length) },
        async () => {
          while (nextIndex < candidates.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            const caption = candidates[currentIndex];

            const fit = await Promise.race([
              scoreCaptionSourceFit(caption, {
                videoDurationMs,
                segments,
              }),
              new Promise<null>((resolve) => {
                setTimeout(() => resolve(null), AUTO_SCORE_PER_ITEM_TIMEOUT_MS);
              }),
            ]);

            scored.push({
              caption,
              index: currentIndex,
              score: fit?.score ?? -1,
              confidence: fit?.confidence ?? "low",
            });
          }
        },
      );
      await Promise.all(workers);

      scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.caption.opensubtitles !== b.caption.opensubtitles) {
          return a.caption.opensubtitles ? 1 : -1;
        }
        return a.index - b.index;
      });

      return scored;
    },
    [captions, segments, videoDuration],
  );

  const setDirectCaption = useCallback(
    (caption: Caption, listItem: CaptionListItem) => {
      setIsOpenSubtitles(!!listItem.opensubtitles);
      setCaption(caption);

      // Only reset subtitle settings if selecting a different caption
      if (selectedCaption?.id !== caption.id) {
        resetSubtitleSpecificSettings();
      }

      setLanguage(caption.language);

      // Preserve an existing native-track request when the subtitle finishes
      // loading after the player has already entered a mode that needs tracks.
      if (captionAsTrack) {
        setCaptionAsTrack(true);
      }
    },
    [
      captionAsTrack,
      setIsOpenSubtitles,
      setLanguage,
      setCaption,
      resetSubtitleSpecificSettings,
      setCaptionAsTrack,
      selectedCaption,
    ],
  );

  const selectCaptionById = useCallback(
    async (captionId: string): Promise<boolean> => {
      const caption = captions.find((v) => v.id === captionId);
      if (!caption) return false;

      try {
        const captionToSet: Caption = {
          id: caption.id,
          language: caption.language,
          url: caption.url,
          vttData: "",
          ...(isEmbeddedCaption(caption) ? { trackId: caption.trackId } : {}),
        };

        if (!isEmbeddedCaption(caption)) {
          captionToSet.vttData = await downloadCaptionAsVtt(caption);
        }

        setDirectCaption(captionToSet, caption);
        return true;
      } catch (error) {
        console.warn("Skipping unavailable caption source", {
          captionId: caption.id,
          source: caption.source,
          error,
        });
        return false;
      }
    },
    [captions, setDirectCaption],
  );

  const selectSecondaryCaptionById = useCallback(
    async (captionId: string | null) => {
      if (!captionId) {
        setSecondaryCaption(null);
        return;
      }

      const caption = captions.find((v) => v.id === captionId);
      if (!caption) return;

      const candidates = [
        caption,
        ...captions.filter(
          (candidate) =>
            candidate.id !== caption.id &&
            candidate.id !== selectedCaption?.id &&
            candidate.url !== caption.url &&
            getCaptionLanguageGroupKey(candidate) ===
              getCaptionLanguageGroupKey(caption),
        ),
      ];
      let lastError: unknown;

      for (const candidate of candidates) {
        try {
          const captionToSet: Caption = {
            id: candidate.id,
            language: candidate.language,
            url: candidate.url,
            vttData: "",
            ...(isEmbeddedCaption(candidate)
              ? { trackId: candidate.trackId }
              : {}),
          };

          if (!isEmbeddedCaption(candidate)) {
            captionToSet.vttData = await downloadCaptionAsVtt(candidate);
          }

          if (secondaryCaption?.id !== candidate.id) {
            resetSubtitleSpecificSettings("secondary");
          }
          setSecondaryCaption(captionToSet);
          return;
        } catch (error) {
          lastError = error;
        }
      }

      console.warn("Skipping unavailable secondary caption source", {
        captionId: caption.id,
        source: caption.source,
        error: lastError,
      });
    },
    [
      captions,
      resetSubtitleSpecificSettings,
      selectedCaption?.id,
      secondaryCaption,
      setSecondaryCaption,
    ],
  );

  const disableSecondary = useCallback(() => {
    setSecondaryCaption(null);
  }, [setSecondaryCaption]);

  const selectLanguage = useCallback(
    async (
      language: string,
      options?: {
        fallbackToEnglish?: boolean;
        waitForExternal?: boolean;
      },
    ) => {
      const fallbackToEnglish = options?.fallbackToEnglish ?? true;
      const waitForExternal = options?.waitForExternal ?? false;
      const requestId = ++autoSelectionRequestId;

      const selectBestAvailableCaption = async (targetLanguage: string) => {
        const scoredCaptions = await scoreCaptionsForLanguage(targetLanguage, {
          mode: "auto",
        });
        if (requestId !== autoSelectionRequestId) return false;
        for (const candidate of scoredCaptions.filter(
          (item) => item.score >= 0,
        )) {
          if (await selectCaptionById(candidate.caption.id)) return true;
        }
        return false;
      };

      const hasLanguageMatch = captions.some(
        (caption) =>
          isLanguageMatch(getCaptionLanguageGroupKey(caption), language) ||
          isLanguageMatch(caption.language, language),
      );
      const hasEmbeddedLanguageMatch = captions.some(
        (caption) =>
          isEmbeddedCaption(caption) &&
          (isLanguageMatch(getCaptionLanguageGroupKey(caption), language) ||
            isLanguageMatch(caption.language, language)),
      );

      if (
        waitForExternal &&
        isLoadingExternalSubtitles &&
        !hasEmbeddedLanguageMatch
      ) {
        return false;
      }

      if (!hasLanguageMatch && isLoadingExternalSubtitles && waitForExternal) {
        return false;
      }

      if (await selectBestAvailableCaption(language)) {
        return true;
      }

      let caption = findCaptionByPreferredLanguage(language);
      if (!caption && fallbackToEnglish && language !== "en") {
        if (waitForExternal && isLoadingExternalSubtitles) {
          return false;
        }

        if (await selectBestAvailableCaption("en")) {
          return true;
        }

        caption = findCaptionByPreferredLanguage("en");
      }
      if (!caption) return false;
      return selectCaptionById(caption.id);
    },
    [
      captions,
      findCaptionByPreferredLanguage,
      isLoadingExternalSubtitles,
      scoreCaptionsForLanguage,
      selectCaptionById,
    ],
  );

  const disable = useCallback(async () => {
    setIsOpenSubtitles(false);
    setCaption(null);
    setLanguage(null);
  }, [setCaption, setLanguage, setIsOpenSubtitles]);

  const selectLastUsedLanguage = useCallback(async () => {
    if (source?.type === "file" && !embeddedSubtitleTracksLoaded) {
      return false;
    }

    const language = resolvePreferredAutoSubtitleLanguage(
      lastSelectedLanguage,
      userLanguage,
    );
    return selectLanguage(language, {
      fallbackToEnglish: false,
    });
  }, [
    embeddedSubtitleTracksLoaded,
    lastSelectedLanguage,
    source,
    userLanguage,
    selectLanguage,
  ]);

  const selectLastUsedLanguageIfEnabled = useCallback(async () => {
    if (enabled || !lastSelectedLanguage) await selectLastUsedLanguage();
  }, [selectLastUsedLanguage, enabled, lastSelectedLanguage]);

  const toggleLastUsed = useCallback(async () => {
    if (enabled) disable();
    else await selectLastUsedLanguage();
  }, [selectLastUsedLanguage, disable, enabled]);

  const selectBestCaptionFromLastUsedLanguage = useCallback(async () => {
    const language = resolvePreferredAutoSubtitleLanguage(
      lastSelectedLanguage,
      userLanguage,
    );
    const scoredCaptions = await scoreCaptionsForLanguage(language);
    if (scoredCaptions.length === 0) return;

    const bestAlternativeCaption =
      scoredCaptions.find(
        (item) => item.score >= 0 && item.caption.id !== selectedCaption?.id,
      )?.caption ?? scoredCaptions.find((item) => item.score >= 0)?.caption;

    if (!bestAlternativeCaption) return;
    await selectCaptionById(bestAlternativeCaption.id);
  }, [
    lastSelectedLanguage,
    userLanguage,
    selectedCaption,
    scoreCaptionsForLanguage,
    selectCaptionById,
  ]);

  // Validate selected caption when caption list changes
  useEffect(() => {
    if (captions.length === 0) return;
    if (source?.type === "file" && !embeddedSubtitleTracksLoaded) return;

    if (!selectedCaption) {
      const isNewSourceRequest =
        latestAutoSelectRequestIdRef.current !== externalSubtitleRequestId;
      const shouldAutoSelect =
        isNewSourceRequest || enabled || !lastSelectedLanguage;

      if (shouldAutoSelect) {
        void selectLastUsedLanguage().then((didSelect) => {
          if (didSelect || !isLoadingExternalSubtitles) {
            latestAutoSelectRequestIdRef.current = externalSubtitleRequestId;
          }
        });
      }
      return;
    }
    latestAutoSelectRequestIdRef.current = externalSubtitleRequestId;

    // Skip validation for custom/pasted captions that aren't in the caption list
    const isCustomCaption =
      selectedCaption.id === "custom-caption" ||
      selectedCaption.id === "pasted-caption";
    const isPersistedCaption = selectedCaption.persisted;

    if (isCustomCaption || isPersistedCaption) return;

    const isSelectedCaptionStillAvailable = captions.some(
      (caption) =>
        caption.id ===
        (currentTranslateTask
          ? currentTranslateTask.targetCaption
          : selectedCaption
        ).id,
    );

    if (!isSelectedCaptionStillAvailable) {
      // Try to find a caption with the same language
      const sameLanguageCaption = findCaptionByPreferredLanguage(
        (currentTranslateTask
          ? currentTranslateTask.targetCaption
          : selectedCaption
        ).language,
      );

      if (sameLanguageCaption) {
        void selectLanguage(sameLanguageCaption.language, {
          fallbackToEnglish: false,
        });
      } else {
        // No caption with the same language found, clear the selection
        setCaption(null);
      }
    }
  }, [
    captions,
    selectedCaption,
    setCaption,
    selectCaptionById,
    currentTranslateTask,
    enabled,
    embeddedSubtitleTracksLoaded,
    isLoadingExternalSubtitles,
    externalSubtitleRequestId,
    source,
    lastSelectedLanguage,
    selectLastUsedLanguage,
    selectLanguage,
    findCaptionByPreferredLanguage,
  ]);

  // Validate secondary caption when caption list changes
  useEffect(() => {
    if (captions.length === 0 || !secondaryCaption) return;

    const isCustomCaption =
      secondaryCaption.id === "custom-caption" ||
      secondaryCaption.id === "pasted-caption";
    const isPersistedCaption = secondaryCaption.persisted;
    if (isCustomCaption || isPersistedCaption) return;

    const isSecondaryCaptionStillAvailable = captions.some(
      (caption) => caption.id === secondaryCaption.id,
    );
    if (isSecondaryCaptionStillAvailable) return;

    const sameLanguageCaption = findCaptionByPreferredLanguage(
      secondaryCaption.language,
    );
    if (sameLanguageCaption) {
      selectSecondaryCaptionById(sameLanguageCaption.id);
      return;
    }

    setSecondaryCaption(null);
  }, [
    captions,
    secondaryCaption,
    selectSecondaryCaptionById,
    setSecondaryCaption,
    findCaptionByPreferredLanguage,
  ]);

  return {
    selectLanguage,
    disable,
    selectLastUsedLanguage,
    toggleLastUsed,
    selectLastUsedLanguageIfEnabled,
    setDirectCaption,
    selectCaptionById,
    selectBestCaptionFromLastUsedLanguage,
    selectSecondaryCaptionById,
    disableSecondary,
    syncSelectedCaption,
    canSyncSelectedCaption,
    isSyncingSubtitle,
    syncSubtitleProgress,
    secondaryCaption,
  };
}
