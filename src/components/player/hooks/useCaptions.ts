import { useCallback, useEffect, useMemo } from "react";
import subsrt from "subsrt-ts";

import { downloadCaption, downloadWebVTT } from "@/backend/helpers/subs";
import { useSkipTime } from "@/components/player/hooks/useSkipTime";
import { scoreCaptionSourceFit } from "@/components/player/utils/captionSourceFit";
import { useLanguageStore } from "@/stores/language";
import { Caption, CaptionListItem } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";
import { usePreferencesStore } from "@/stores/preferences";
import { useSubtitleStore } from "@/stores/subtitles";
import { getPrettyLanguageNameFromLocale } from "@/utils/language";

import {
  getCaptionLanguageGroupKey,
  isLanguageMatch,
} from "../utils/captionLanguage";
import {
  filterDuplicateCaptionCues,
  parseVttSubtitles,
} from "../utils/captions";

let autoSelectionRequestId = 0;

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
  const selectedCaption = usePlayerStore((s) => s.caption.selected);
  const secondaryCaption = usePlayerStore((s) => s.caption.secondary);
  const isLoadingExternalSubtitles = usePlayerStore(
    (s) => s.isLoadingExternalSubtitles,
  );
  const externalSubtitleLoadProgress = usePlayerStore(
    (s) => s.externalSubtitleLoadProgress,
  );
  const videoDuration = usePlayerStore((s) => s.progress.duration);
  const segments = useSkipTime();

  const getSubtitleTracks = usePlayerStore((s) => s.display?.getSubtitleTracks);
  const setSubtitlePreference = usePlayerStore(
    (s) => s.display?.setSubtitlePreference,
  );
  const setCaptionAsTrack = usePlayerStore((s) => s.setCaptionAsTrack);
  const enableNativeSubtitles = usePreferencesStore(
    (s) => s.enableNativeSubtitles,
  );

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
    async (language: string) => {
      const languageCaptions = captions.filter(
        (caption) =>
          isLanguageMatch(getCaptionLanguageGroupKey(caption), language) ||
          isLanguageMatch(caption.language, language),
      );

      if (languageCaptions.length === 0) return [];

      const videoDurationMs = videoDuration > 0 ? videoDuration * 1000 : 0;
      const scored = await Promise.all(
        languageCaptions.map(async (caption, index) => {
          const fit = await scoreCaptionSourceFit(caption, {
            videoDurationMs,
            segments,
          });

          return {
            caption,
            index,
            score: fit?.score ?? -1,
            confidence: fit?.confidence ?? "low",
          };
        }),
      );

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

      // Use native tracks for MP4 streams instead of custom rendering
      if (source?.type === "file" && enableNativeSubtitles) {
        setCaptionAsTrack(true);
      } else {
        // For HLS sources or when native subtitles are disabled, use custom rendering
        setCaptionAsTrack(false);
      }
    },
    [
      setIsOpenSubtitles,
      setLanguage,
      setCaption,
      resetSubtitleSpecificSettings,
      source,
      setCaptionAsTrack,
      enableNativeSubtitles,
      selectedCaption,
    ],
  );

  const selectCaptionById = useCallback(
    async (captionId: string) => {
      const caption = captions.find((v) => v.id === captionId);
      if (!caption) return;

      const captionToSet: Caption = {
        id: caption.id,
        language: caption.language,
        url: caption.url,
        srtData: "",
      };

      if (!caption.hls) {
        const srtData = await downloadCaption(caption);
        captionToSet.srtData = srtData;
      } else {
        // request a language change to hls, so it can load the subtitles
        await setSubtitlePreference?.(caption.language);
        const track = getSubtitleTracks?.().find(
          (t) => t.id.toString() === caption.id && t.details !== undefined,
        );
        if (!track) return;

        const fragments =
          track.details?.fragments?.filter(
            (frag) => frag !== null && frag.url !== null,
          ) ?? [];

        const vttCaptions = (
          await Promise.all(
            fragments.map(async (frag) => {
              const vtt = await downloadWebVTT(frag.url);
              return parseVttSubtitles(vtt);
            }),
          )
        ).flat();

        const filtered = filterDuplicateCaptionCues(vttCaptions);

        const srtData = subsrt.build(filtered, { format: "srt" });
        captionToSet.srtData = srtData;
      }

      setDirectCaption(captionToSet, caption);
    },
    [captions, getSubtitleTracks, setSubtitlePreference, setDirectCaption],
  );

  const selectSecondaryCaptionById = useCallback(
    async (captionId: string | null) => {
      if (!captionId) {
        setSecondaryCaption(null);
        return;
      }

      const caption = captions.find((v) => v.id === captionId);
      if (!caption) return;

      const captionToSet: Caption = {
        id: caption.id,
        language: caption.language,
        url: caption.url,
        srtData: "",
      };

      if (!caption.hls) {
        const srtData = await downloadCaption(caption);
        captionToSet.srtData = srtData;
      } else {
        await setSubtitlePreference?.(caption.language);
        const track = getSubtitleTracks?.().find(
          (t) => t.id.toString() === caption.id && t.details !== undefined,
        );
        if (!track) return;

        const fragments =
          track.details?.fragments?.filter(
            (frag) => frag !== null && frag.url !== null,
          ) ?? [];

        const vttCaptions = (
          await Promise.all(
            fragments.map(async (frag) => {
              const vtt = await downloadWebVTT(frag.url);
              return parseVttSubtitles(vtt);
            }),
          )
        ).flat();

        const filtered = filterDuplicateCaptionCues(vttCaptions);

        const srtData = subsrt.build(filtered, { format: "srt" });
        captionToSet.srtData = srtData;
      }

      setSecondaryCaption(captionToSet);
    },
    [captions, getSubtitleTracks, setSubtitlePreference, setSecondaryCaption],
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
        const scoredCaptions = await scoreCaptionsForLanguage(targetLanguage);
        if (requestId !== autoSelectionRequestId) return false;
        const bestCaption = scoredCaptions[0]?.caption;
        if (!bestCaption) return false;
        await selectCaptionById(bestCaption.id);
        return true;
      };

      const hasLanguageMatch = captions.some(
        (caption) =>
          isLanguageMatch(getCaptionLanguageGroupKey(caption), language) ||
          isLanguageMatch(caption.language, language),
      );

      const isWaitingForFirstExternalSource =
        waitForExternal &&
        isLoadingExternalSubtitles &&
        externalSubtitleLoadProgress.completed === 0;

      if (isWaitingForFirstExternalSource) {
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
      if (!caption) return;
      return selectCaptionById(caption.id);
    },
    [
      captions,
      findCaptionByPreferredLanguage,
      isLoadingExternalSubtitles,
      externalSubtitleLoadProgress.completed,
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
    const language = lastSelectedLanguage ?? userLanguage ?? "en";
    await selectLanguage(language, {
      fallbackToEnglish: false,
      waitForExternal: true,
    });
    return true;
  }, [lastSelectedLanguage, userLanguage, selectLanguage]);

  const selectLastUsedLanguageIfEnabled = useCallback(async () => {
    if (enabled || !lastSelectedLanguage) await selectLastUsedLanguage();
  }, [selectLastUsedLanguage, enabled, lastSelectedLanguage]);

  const toggleLastUsed = useCallback(async () => {
    if (enabled) disable();
    else await selectLastUsedLanguage();
  }, [selectLastUsedLanguage, disable, enabled]);

  const selectBestCaptionFromLastUsedLanguage = useCallback(async () => {
    const language = lastSelectedLanguage ?? userLanguage ?? "en";
    const scoredCaptions = await scoreCaptionsForLanguage(language);
    if (scoredCaptions.length === 0) return;

    const bestAlternativeCaption =
      scoredCaptions.find((item) => item.caption.id !== selectedCaption?.id)
        ?.caption ?? scoredCaptions[0]?.caption;

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
      if (enabled || !lastSelectedLanguage) {
        void selectLastUsedLanguage();
      }
      return;
    }

    // Skip validation for custom/pasted captions that aren't in the caption list
    const isCustomCaption =
      selectedCaption.id === "custom-caption" ||
      selectedCaption.id === "pasted-caption";

    if (isCustomCaption) return;

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
    if (isCustomCaption) return;

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
