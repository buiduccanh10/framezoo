import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";

import { FlagIcon } from "@/components/FlagIcon";
import { Icon, Icons } from "@/components/Icon";
import { useCaptions } from "@/components/player/hooks/useCaptions";
import { Menu } from "@/components/player/internals/ContextMenu";
import { useOverlayRouter } from "@/hooks/useOverlayRouter";
import { CaptionListItem } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";
import { getPrettyLanguageNameFromLocale } from "@/utils/language";

import { CaptionOption, type SubtitleSelectionMode } from "./CaptionsView";
import { useCaptionMatchScore } from "../../hooks/useCaptionMatchScore";
import { getCaptionLanguageGroupKey } from "../../utils/captionLanguage";

function isLikelyUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function inferSubtitleSource(
  source: string | undefined,
  url: string,
): string | undefined {
  if (source && source.trim().length > 0) return source;

  if (url.includes("sub.wyzie.io")) return "wyzie";
  if (url.includes("subsource")) return "subsource";
  if (url.includes("opensubtitles")) return "opensubs";

  return undefined;
}

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function isGenericLanguageLabel(
  label: string | undefined,
  prettyLanguage: string,
  languageCode: string,
): boolean {
  if (!label) return true;
  const normalized = normalizeLabel(label);
  const normalizedPrettyLanguage = normalizeLabel(prettyLanguage);
  const normalizedCode = normalizeLabel(languageCode);

  return (
    normalized.length === 0 ||
    normalized === normalizedPrettyLanguage ||
    normalized === normalizedCode
  );
}

export interface LanguageSubtitlesViewProps {
  id: string;
  language: string;
  overlayBackLink?: boolean;
  onTranslateSubtitle?: (caption: CaptionListItem) => void;
  selectionMode?: SubtitleSelectionMode;
}

export function LanguageSubtitlesView({
  id,
  language,
  overlayBackLink,
  onTranslateSubtitle,
  selectionMode = "primary",
}: LanguageSubtitlesViewProps) {
  const { t } = useTranslation();
  const router = useOverlayRouter(id);
  const selectedCaptionId = usePlayerStore((s) => s.caption.selected?.id);
  const secondaryCaptionId = usePlayerStore((s) => s.caption.secondary?.id);
  const currentTranslateTask = usePlayerStore((s) => s.caption.translateTask);
  const { selectCaptionById, selectSecondaryCaptionById } = useCaptions();
  const [currentlyDownloading, setCurrentlyDownloading] = useState<
    string | null
  >(null);
  const [scrollTrigger, setScrollTrigger] = useState(0);
  const captionList = usePlayerStore((s) => s.captionList);
  const matchScore = useCaptionMatchScore();

  useEffect(() => {
    if (selectedCaptionId) {
      setScrollTrigger((prev) => prev + 1);
    }
  }, [selectedCaptionId]);

  // Manual scroll function with smooth behavior
  const scrollToActiveCaption = () => {
    const active = document.querySelector("[data-active-link]");
    if (!active) return;

    active.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  };

  const getHlsCaptionList = usePlayerStore((s) => s.display?.getCaptionList);
  const isLoadingExternalSubtitles = usePlayerStore(
    (s) => s.isLoadingExternalSubtitles,
  );
  const externalSubtitleLoadProgress = usePlayerStore(
    (s) => s.externalSubtitleLoadProgress,
  );
  const externalSubtitleProgressLabel =
    externalSubtitleLoadProgress.total > 0
      ? t("player.menus.subtitles.loadingExternalProgress", {
          progress: Math.round(
            (externalSubtitleLoadProgress.completed /
              externalSubtitleLoadProgress.total) *
              100,
          ),
          defaultValue: "Loading external subtitles... ({{progress}}%)",
        })
      : t("player.menus.subtitles.loadingExternal");

  const captions = useMemo(
    () =>
      captionList.length !== 0 ? captionList : (getHlsCaptionList?.() ?? []),
    [captionList, getHlsCaptionList],
  );

  const languageCaptions = useMemo(
    () =>
      captions.filter(
        (caption) => getCaptionLanguageGroupKey(caption) === language,
      ),
    [captions, language],
  );

  const [downloadReq, startDownload] = useAsyncFn(
    async (captionId: string) => {
      setCurrentlyDownloading(captionId);
      if (selectionMode === "secondary") {
        return selectSecondaryCaptionById(captionId);
      }
      return selectCaptionById(captionId);
    },
    [selectCaptionById, selectSecondaryCaptionById, selectionMode],
  );

  const handleRandomSelect = async () => {
    if (languageCaptions.length === 0) return;

    const randomIndex = Math.floor(Math.random() * languageCaptions.length);
    const randomCaption = languageCaptions[randomIndex];

    await startDownload(randomCaption.id);
    setTimeout(() => scrollToActiveCaption(), 100);
  };

  const renderSubtitleOption = (v: CaptionListItem) => {
    const inferredSource = inferSubtitleSource(v.source, v.url);
    const prettyLanguage =
      getPrettyLanguageNameFromLocale(v.language) ||
      t("player.menus.subtitles.unknownLanguage");
    const displayCandidate =
      v.display && !isLikelyUrl(v.display) ? v.display.trim() : "";
    const mediaCandidate =
      v.media && !isLikelyUrl(v.media) ? v.media.trim() : "";
    const displayIsGeneric = isGenericLanguageLabel(
      displayCandidate,
      prettyLanguage,
      v.language,
    );
    const displayTitle =
      (!displayIsGeneric && displayCandidate) ||
      mediaCandidate ||
      displayCandidate ||
      prettyLanguage;

    const handleDoubleClick = async () => {
      const copyData = {
        id: v.id,
        url: v.url,
        language: v.language,
        type: v.type,
        hasCorsRestrictions: v.needsProxy,
        opensubtitles: v.opensubtitles,
        display: v.display,
        media: v.media,
        isHearingImpaired: v.isHearingImpaired,
        source: v.source,
        encoding: v.encoding,
        delay: 0,
      };

      try {
        await navigator.clipboard.writeText(JSON.stringify(copyData));
      } catch (err) {
        console.error("Failed to copy subtitle data:", err);
      }
    };

    const isPrimarySelected =
      v.id === selectedCaptionId ||
      (!!currentTranslateTask &&
        !currentTranslateTask.error &&
        v.id === currentTranslateTask.targetCaption.id);
    const isSecondarySelected = v.id === secondaryCaptionId;

    const isSelected =
      selectionMode === "primary" ? isPrimarySelected : isSecondarySelected;

    const isTranslating =
      !!currentTranslateTask &&
      !currentTranslateTask.done &&
      !currentTranslateTask.error;

    return (
      <CaptionOption
        key={v.id}
        countryCode={v.language}
        selected={isSelected}
        secondarySelected={
          selectionMode === "primary" ? isSecondarySelected : isPrimarySelected
        }
        disabled={isTranslating}
        loading={
          (v.id === currentlyDownloading && downloadReq.loading) ||
          (!!currentTranslateTask &&
            v.id === currentTranslateTask.targetCaption.id &&
            !currentTranslateTask.done &&
            !currentTranslateTask.error)
        }
        error={
          v.id === currentlyDownloading && downloadReq.error
            ? downloadReq.error.toString()
            : undefined
        }
        onClick={() => !isTranslating && startDownload(v.id)}
        onTranslate={() => {
          onTranslateSubtitle?.(v);
          router.navigate(
            overlayBackLink
              ? "/captionsOverlay/languagesOverlay/translateSubtitleOverlay"
              : "/captions/languages/translateSubtitleOverlay",
          );
        }}
        isTranslatedTarget={
          !!currentTranslateTask &&
          !currentTranslateTask.error &&
          v.id === currentTranslateTask.targetCaption.id
        }
        onDoubleClick={handleDoubleClick}
        flag
        translatable={selectionMode === "primary"}
        subtitleUrl={v.url}
        subtitleType={v.type}
        subtitleSource={inferredSource}
        subtitleEncoding={v.encoding}
        isHearingImpaired={v.isHearingImpaired}
        matchScore={v.id === selectedCaptionId ? matchScore : undefined}
      >
        {displayTitle}
      </CaptionOption>
    );
  };

  const languageName =
    getPrettyLanguageNameFromLocale(language) ||
    t("player.menus.subtitles.unknownLanguage");

  return (
    <>
      {/* Header — wrapped in single div for CardWithScrollable grid layout */}
      <div>
        <Menu.BackLink
          onClick={() =>
            router.navigate(overlayBackLink ? "/captionsOverlay" : "/captions")
          }
          rightSide={
            languageCaptions.length > 0 && (
              <button
                type="button"
                onClick={handleRandomSelect}
                className="-mr-2 -my-1 px-2 p-[0.4em] rounded tabbable hover:bg-video-context-light hover:bg-opacity-10"
                title="Pick random subtitle"
              >
                <Icon icon={Icons.REPEAT} className="text-lg" />
              </button>
            )
          }
        >
          <span className="flex min-w-0 flex-1 items-center">
            <FlagIcon langCode={language} />
            <span className="ml-3 block min-w-0 truncate">{languageName}</span>
          </span>
        </Menu.BackLink>

        {selectionMode === "secondary" && (
          <div className="px-4 py-2 text-xs text-center bg-purple-500/20 text-purple-300 border-b border-purple-500/30">
            {t("player.menus.subtitles.selectingSecondary")}
          </div>
        )}
      </div>

      {/* Scrollable subtitle list — always 2nd child for CardWithScrollable */}
      <Menu.ScrollToActiveSection
        className="!pt-1 mt-2 pb-3"
        loaded={scrollTrigger > 0}
      >
        {languageCaptions.length > 0 ? (
          languageCaptions.map(renderSubtitleOption)
        ) : (
          <div className="text-center text-video-context-type-secondary py-2">
            {isLoadingExternalSubtitles
              ? externalSubtitleProgressLabel
              : t("player.menus.subtitles.notFound")}
          </div>
        )}
      </Menu.ScrollToActiveSection>
    </>
  );
}
