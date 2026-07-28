import { useCallback, useEffect, useMemo, useRef } from "react";

import { downloadCaptionAsVtt } from "@/backend/helpers/subs";
import { useSkipTime } from "@/components/player/hooks/useSkipTime";
import { scoreCaptionSourceFit } from "@/components/player/utils/captionSourceFit";
import { useLanguageStore } from "@/stores/language";
import { Caption, CaptionListItem } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";
import { useSubtitleStore } from "@/stores/subtitles";
import { getPrettyLanguageNameFromLocale } from "@/utils/language";

import {
  getCaptionLanguageGroupKey,
  isLanguageMatch,
} from "../utils/captionLanguage";

let autoSelectionRequestId = 0;
const AUTO_SCORE_MAX_CANDIDATES = 8;
const AUTO_SCORE_CONCURRENCY = 3;
const AUTO_SCORE_PER_ITEM_TIMEOUT_MS = 1500;
const AUTO_SUBTITLE_DISABLED_SOURCE_IDS = new Set(["kkphim"]);

function resolvePreferredAutoSubtitleLanguage(
  lastSelectedLanguage: string | null,
  userLanguage: string | null | undefined,
) {
  return lastSelectedLanguage ?? userLanguage ?? "en";
}

function isAutoSubtitleDisabledSource(sourceId: string | null): boolean {
  if (!sourceId) return false;
  return AUTO_SUBTITLE_DISABLED_SOURCE_IDS.has(sourceId);
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
  const sourceId = usePlayerStore((s) => s.sourceId);
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

  const captions = useMemo(
    () =>
      captionList.length !== 0 ? captionList : (getHlsCaptionList?.() ?? []),
    [captionList, getHlsCaptionList],
  );

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
        };

        captionToSet.vttData = await downloadCaptionAsVtt(caption);

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

      try {
        const captionToSet: Caption = {
          id: caption.id,
          language: caption.language,
          url: caption.url,
          vttData: "",
        };

        captionToSet.vttData = await downloadCaptionAsVtt(caption);

        setSecondaryCaption(captionToSet);
      } catch (error) {
        console.warn("Skipping unavailable secondary caption source", {
          captionId: caption.id,
          source: caption.source,
          error,
        });
      }
    },
    [captions, setSecondaryCaption],
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

      if (waitForExternal && isLoadingExternalSubtitles) {
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
    const language = resolvePreferredAutoSubtitleLanguage(
      lastSelectedLanguage,
      userLanguage,
    );
    return selectLanguage(language, {
      fallbackToEnglish: false,
      waitForExternal: true,
    });
  }, [lastSelectedLanguage, userLanguage, selectLanguage]);

  const selectLastUsedLanguageIfEnabled = useCallback(async () => {
    if (isAutoSubtitleDisabledSource(sourceId)) return;
    if (enabled || !lastSelectedLanguage) await selectLastUsedLanguage();
  }, [sourceId, selectLastUsedLanguage, enabled, lastSelectedLanguage]);

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

    if (!selectedCaption) {
      const isAutoSelectDisabledForSource =
        isAutoSubtitleDisabledSource(sourceId);
      if (isAutoSelectDisabledForSource) {
        latestAutoSelectRequestIdRef.current = externalSubtitleRequestId;
        return;
      }

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
    isLoadingExternalSubtitles,
    externalSubtitleRequestId,
    sourceId,
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
    secondaryCaption,
  };
}
