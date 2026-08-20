import classNames from "classnames";
import Fuse from "fuse.js";
import {
  type DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { subtitleTypeList } from "@/backend/helpers/subs";
import { useFileDrop } from "@/components/DropFile";
import { FlagIcon } from "@/components/FlagIcon";
import { Icon, Icons } from "@/components/Icon";
import { Spinner } from "@/components/layout/Spinner";
import { useCaptions } from "@/components/player/hooks/useCaptions";
import { usePlaybackClock } from "@/components/player/hooks/usePlaybackClock";
import { Menu } from "@/components/player/internals/ContextMenu";
import { SelectableLink } from "@/components/player/internals/ContextMenu/Links";
import {
  captionIsVisible,
  decodeSubtitleBytes,
  normalizeSubtitleToVtt,
  tryParseCanonicalVtt,
} from "@/components/player/utils/captions";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useOverlayRouter } from "@/hooks/useOverlayRouter";
import { useLanguageStore } from "@/stores/language";
import { CaptionListItem, SubtitleTrack } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";
import { useSubtitleStore } from "@/stores/subtitles";
import {
  getPrettyLanguageNameFromLocale,
  sortLangCodes,
} from "@/utils/language";

import { useCaptionMatchScore } from "../../hooks/useCaptionMatchScore";
import { getCaptionLanguageGroupKey } from "../../utils/captionLanguage";

const SHOW_MATCH_SCORE = false;

export interface CaptionOptionProps {
  countryCode?: string;
  children: React.ReactNode;
  selected?: boolean;
  primarySelected?: boolean;
  secondarySelected?: boolean;
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  error?: React.ReactNode;
  flag?: boolean;
  translatable?: boolean;
  isTranslatedTarget?: boolean;
  subtitleUrl?: string;
  subtitleType?: string;
  subtitleSource?: string;
  subtitleEncoding?: string;
  isHearingImpaired?: boolean;
  onDoubleClick?: () => void;
  onTranslate?: () => void;
  matchScore?: number | null;
}

function CaptionOptionRightSide(props: CaptionOptionProps) {
  if (props.loading) {
    // should override selected and error and not show translate button
    return <Spinner className="text-lg" />;
  }

  function translateBtn(margin: boolean) {
    return (
      props.translatable && (
        <span
          className={classNames(
            "text-buttons-secondaryText px-2 py-1 rounded bg-opacity-0",
            {
              "mr-1": margin,
              "bg-opacity-100 bg-buttons-purpleHover": props.isTranslatedTarget,
            },
            "transition duration-300 ease-in-out",
            "hover:bg-opacity-100 hover:bg-buttons-primaryHover",
            "hover:text-buttons-primaryText",
          )}
          onClick={(e) => {
            e.stopPropagation();
            props.onTranslate?.();
          }}
        >
          <Icon icon={Icons.TRANSLATE} className="text-lg" />
        </span>
      )
    );
  }

  if (
    props.primarySelected ||
    props.secondarySelected ||
    props.selected ||
    props.error
  ) {
    return (
      <div className="flex items-center gap-1">
        {translateBtn(true)}
        {props.error ? (
          <span className="flex items-center text-video-context-error">
            <Icon className="ml-2" icon={Icons.WARNING} />
          </span>
        ) : (
          <>
            {props.selected ? (
              <Icon
                icon={Icons.CIRCLE_CHECK}
                className={classNames(
                  "text-xl",
                  props.secondarySelected
                    ? "text-purple-300"
                    : "text-video-context-type-accent",
                )}
              />
            ) : null}
            {props.primarySelected && !props.selected ? (
              <span className="flex items-center rounded bg-video-context-type-accent/20 px-2 py-0.5 text-xs font-medium text-video-context-type-accent">
                1st
              </span>
            ) : null}
            {props.secondarySelected && !props.selected ? (
              <span className="flex items-center rounded bg-purple-500/20 px-2 py-0.5 text-xs font-medium text-purple-300">
                2nd
              </span>
            ) : null}
          </>
        )}
      </div>
    );
  }

  return translateBtn(false);
}

export function CaptionOption(props: CaptionOptionProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { t } = useTranslation();
  const getSubtitleBadgeLabel = (value?: string) => {
    if (!value) return null;
    if (value.toLowerCase() === "embedded") {
      return t("player.menus.subtitles.embedded", {
        defaultValue: "Embedded",
      });
    }
    return value.toUpperCase();
  };
  const subtitleTypeLabel = getSubtitleBadgeLabel(props.subtitleType);
  const subtitleSourceLabel = getSubtitleBadgeLabel(props.subtitleSource);
  const subtitleSource = props.subtitleSource?.toLowerCase();

  const tooltipContent = useMemo(() => {
    if (!props.subtitleUrl && !props.subtitleSource) return null;

    const parts = [];

    if (props.subtitleSource) {
      parts.push(`Source: ${props.subtitleSource}`);
    }

    if (props.subtitleEncoding) {
      parts.push(`Encoding: ${props.subtitleEncoding}`);
    }

    if (props.isHearingImpaired) {
      parts.push(`Hearing Impaired: Yes`);
    }

    if (props.subtitleUrl) {
      parts.push(`URL: ${props.subtitleUrl}`);
    }

    if (
      SHOW_MATCH_SCORE &&
      props.matchScore !== undefined &&
      props.matchScore !== null
    ) {
      parts.push(`Match Score: ${props.matchScore}%`);
    }

    return parts.join("\n");
  }, [
    props.subtitleUrl,
    props.subtitleSource,
    props.subtitleEncoding,
    props.isHearingImpaired,
    props.matchScore,
  ]);

  const handleMouseEnter = () => {
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current);
    }
    tooltipTimeoutRef.current = setTimeout(() => setShowTooltip(true), 500);
  };

  const handleMouseLeave = () => {
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current);
    }
    setShowTooltip(false);
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (tooltipTimeoutRef.current) {
        clearTimeout(tooltipTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <SelectableLink
        selected={props.selected || props.secondarySelected}
        loading={props.loading}
        error={props.error}
        disabled={props.disabled}
        onClick={props.onClick}
        onDoubleClick={props.onDoubleClick}
        rightSide={<CaptionOptionRightSide {...props} />}
      >
        <span
          data-active-link={props.selected ? true : undefined}
          className="flex flex-col items-start"
        >
          <div className="flex items-center">
            {props.flag ? (
              <span data-code={props.countryCode} className="mr-3 inline-flex">
                <FlagIcon langCode={props.countryCode} />
              </span>
            ) : null}
            <span
              className={
                props.flag || props.subtitleUrl || props.subtitleSource
                  ? "truncate max-w-[100px]"
                  : ""
              }
            >
              {props.children}
            </span>
          </div>
          <div className="flex items-center">
            {subtitleTypeLabel && (
              <span className="px-2 py-0.5 mt-2 rounded bg-video-context-hoverColor bg-opacity-80 text-video-context-type-main text-xs font-semibold">
                {subtitleTypeLabel}
              </span>
            )}
            {subtitleSourceLabel && (
              <span
                className={classNames(
                  "ml-2 px-2 py-0.5 mt-2 rounded text-white text-xs font-semibold overflow-hidden text-ellipsis whitespace-nowrap",
                  {
                    "bg-blue-500": subtitleSource?.includes("wyzie"),
                    "bg-orange-500": subtitleSource === "opensubs",
                    "bg-cyan-500": subtitleSource === "subsource",
                    "bg-green-500": subtitleSource === "granite",
                  },
                )}
              >
                {subtitleSourceLabel}
              </span>
            )}
            {props.isHearingImpaired && (
              <Icon icon={Icons.EAR} className="ml-2 mt-2" />
            )}
            {SHOW_MATCH_SCORE &&
              props.matchScore !== undefined &&
              props.matchScore !== null && (
                <span
                  className={classNames(
                    "text-xs font-bold ml-2 mt-2 whitespace-nowrap",
                    {
                      "text-video-context-type-accent": props.matchScore >= 80,
                      "text-yellow-500":
                        props.matchScore >= 50 && props.matchScore < 80,
                      "text-video-context-error": props.matchScore < 50,
                    },
                  )}
                >
                  {t("player.menus.subtitles.matchScoreLabel", {
                    score: props.matchScore,
                    defaultValue: "Match ~{{score}}%",
                  })}
                </span>
              )}
          </div>
        </span>
      </SelectableLink>
      {tooltipContent && showTooltip && (
        <div className="flex flex-col absolute z-50 left-1/2 -translate-x-1/2 bottom-full mb-2 px-3 py-2 bg-black/80 text-white/80 text-xs rounded-lg backdrop-blur-sm w-60 break-all whitespace-pre-line">
          {tooltipContent}
          {props.onDoubleClick && (
            <span className="text-white/50 text-xs">
              {t("player.menus.subtitles.doubleClickToCopy")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// Hook to filter and sort subtitle list with search
export function useSubtitleList(subs: CaptionListItem[], searchQuery: string) {
  const { t: translate } = useTranslation();
  const unknownChoice = translate("player.menus.subtitles.unknownLanguage");
  return useMemo(() => {
    const input = subs.map((t) => ({
      ...t,
      languageName:
        getPrettyLanguageNameFromLocale(t.language) ?? unknownChoice,
    }));
    const sorted = sortLangCodes(input.map((t) => t.language));
    let results = input.sort((a, b) => {
      return sorted.indexOf(a.language) - sorted.indexOf(b.language);
    });

    if (searchQuery.trim().length > 0) {
      const fuse = new Fuse(input, {
        includeScore: true,
        threshold: 0.3, // Lower threshold = stricter matching (0 = exact, 1 = match anything)
        keys: ["languageName"],
      });

      results = fuse.search(searchQuery).map((res) => res.item);
    }

    return results;
  }, [subs, searchQuery, unknownChoice]);
}

export function CustomCaptionOption({
  selectionMode = "primary",
}: {
  selectionMode?: SubtitleSelectionMode;
}) {
  const { t } = useTranslation();
  const primaryLanguage = usePlayerStore((s) => s.caption.selected?.language);
  const secondaryLanguage = usePlayerStore(
    (s) => s.caption.secondary?.language,
  );
  const setCaption = usePlayerStore((s) => s.setCaption);
  const setSecondaryCaption = usePlayerStore((s) => s.setSecondaryCaption);
  const setCustomSubs = useSubtitleStore((s) => s.setCustomSubs);
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const isSecondary = selectionMode === "secondary";

  const handleFileSelect = (file: File) => {
    setError(null);
    const reader = new FileReader();

    reader.addEventListener("load", (event) => {
      if (
        !event.target?.result ||
        !(event.target.result instanceof ArrayBuffer)
      ) {
        setError("Failed to read file");
        return;
      }

      try {
        const decoded = decodeSubtitleBytes(event.target.result, "vi");
        const converted = normalizeSubtitleToVtt(decoded);
        const caption = {
          language: "custom",
          vttData: converted,
          id: "custom-caption",
        };
        if (isSecondary) {
          setSecondaryCaption(caption);
        } else {
          setCaption(caption);
          setCustomSubs();
        }
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to convert subtitle file",
        );
      }
    });

    reader.addEventListener("error", () => {
      setError("Failed to read file");
    });

    reader.readAsArrayBuffer(file);
  };

  return (
    <CaptionOption
      selected={
        (isSecondary ? secondaryLanguage : primaryLanguage) === "custom"
      }
      primarySelected={!isSecondary && primaryLanguage === "custom"}
      secondarySelected={isSecondary && secondaryLanguage === "custom"}
      error={error}
      onClick={() => fileInput.current?.click()}
    >
      {t("player.menus.subtitles.customChoice")}
      <input
        className="hidden"
        ref={fileInput}
        accept={subtitleTypeList.join(",")}
        type="file"
        onChange={(e) => {
          const files = e.target.files;
          if (!files || files.length === 0) return;

          const file = files[0];
          const fileExtension = `.${file.name.split(".").pop()?.toLowerCase()}`;

          if (!subtitleTypeList.includes(fileExtension)) {
            setError(
              `Unsupported file type. Supported: ${subtitleTypeList.join(", ")}`,
            );
            e.target.value = ""; // Reset input
            return;
          }

          handleFileSelect(file);
          e.target.value = ""; // Reset input so same file can be selected again
        }}
      />
    </CaptionOption>
  );
}

export function PasteCaptionOption({
  selected,
  selectionMode = "primary",
}: {
  selected?: boolean;
  selectionMode?: SubtitleSelectionMode;
}) {
  const { t } = useTranslation();
  const setCaption = usePlayerStore((s) => s.setCaption);
  const setSecondaryCaption = usePlayerStore((s) => s.setSecondaryCaption);
  const setCustomSubs = useSubtitleStore((s) => s.setCustomSubs);
  const setPrimaryDelay = useSubtitleStore((s) => s.setPrimaryDelay);
  const setSecondaryDelay = useSubtitleStore((s) => s.setSecondaryDelay);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSecondary = selectionMode === "secondary";

  const handlePaste = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const clipboardText = await navigator.clipboard.readText();
      const parsedData = JSON.parse(clipboardText);

      // Validate the structure
      if (!parsedData.id || !parsedData.url || !parsedData.language) {
        throw new Error("Invalid subtitle data format");
      }

      // Check for CORS restrictions
      if (parsedData.hasCorsRestrictions) {
        throw new Error("Protected subtitle url, cannot be used");
      }

      // Fetch the subtitle content
      const response = await fetch(parsedData.url);
      if (!response.ok) {
        throw new Error(`Failed to fetch subtitle: ${response.status}`);
      }

      const subtitleText = await response.text();

      const converted = normalizeSubtitleToVtt(subtitleText);

      const caption = {
        language: parsedData.language,
        vttData: converted,
        id: "pasted-caption",
      };
      if (isSecondary) {
        setSecondaryCaption(caption);
      } else {
        setCaption(caption);
        setCustomSubs();
      }

      // Set delay if included in the pasted data, otherwise reset to 0
      if (parsedData.delay !== undefined) {
        if (isSecondary) setSecondaryDelay(parsedData.delay);
        else setPrimaryDelay(parsedData.delay);
      } else {
        if (isSecondary) setSecondaryDelay(0);
        else setPrimaryDelay(0);
      }
    } catch (err) {
      console.error("Failed to paste subtitle:", err);
      setError(err instanceof Error ? err.message : "Failed to paste subtitle");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <CaptionOption
      onClick={handlePaste}
      loading={isLoading}
      error={error}
      selected={selected}
      primarySelected={selectionMode === "primary" && selected}
      secondarySelected={selectionMode === "secondary" && selected}
    >
      {t("player.menus.subtitles.pasteChoice")}
    </CaptionOption>
  );
}

export type SubtitleSelectionMode = SubtitleTrack;

export interface CaptionsViewProps {
  id: string;
  backLink?: boolean;
  onChooseLanguage?: (language: string) => void;
  selectionMode?: SubtitleSelectionMode;
  onSelectionModeChange?: (mode: SubtitleSelectionMode) => void;
}

export function CaptionsView({
  id,
  backLink,
  onChooseLanguage,
  selectionMode = "primary",
  onSelectionModeChange,
}: CaptionsViewProps) {
  const { t } = useTranslation();
  const router = useOverlayRouter(id);
  const { isMobile } = useIsMobile();
  const selectedCaption = usePlayerStore((s) => s.caption.selected);
  const secondaryCaption = usePlayerStore((s) => s.caption.secondary);
  const isDualSubEnabled = usePlayerStore((s) => s.caption.dualSubEnabled);
  const setDualSubEnabled = usePlayerStore((s) => s.setDualSubEnabled);
  const currentTranslateTask = usePlayerStore((s) => s.caption.translateTask);
  const { disable, selectBestCaptionFromLastUsedLanguage, disableSecondary } =
    useCaptions();
  const [isRandomSelecting, setIsRandomSelecting] = useState(false);
  const scrollableContainerRef = useRef<HTMLDivElement>(null);

  const handleRandomSelect = async () => {
    if (isRandomSelecting) return; // Prevent multiple simultaneous calls
    setIsRandomSelecting(true);
    try {
      await selectBestCaptionFromLastUsedLanguage();
    } finally {
      setIsRandomSelecting(false);
    }
  };
  const setCaption = usePlayerStore((s) => s.setCaption);
  const setSecondaryCaption = usePlayerStore((s) => s.setSecondaryCaption);
  const videoTime = usePlaybackClock();
  const selectedLanguage = usePlayerStore((s) => s.caption.selected?.language);
  const captionList = usePlayerStore((s) => s.captionList);
  const getHlsCaptionList = usePlayerStore((s) => s.display?.getCaptionList);
  const addExternalSubtitles = usePlayerStore((s) => s.addExternalSubtitles);
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
  const refreshButtonLabel = isLoadingExternalSubtitles
    ? t("player.menus.subtitles.refreshing")
    : t("player.menus.subtitles.refresh");
  const primaryDelay = useSubtitleStore((s) => s.primaryDelay);
  const secondaryDelay = useSubtitleStore((s) => s.secondaryDelay);
  const appLanguage = useLanguageStore((s) => s.language);
  const setCustomSubs = useSubtitleStore((s) => s.setCustomSubs);
  const matchScore = useCaptionMatchScore();
  const effectiveMatchScore = matchScore ?? 0;
  const matchScoreLabel =
    matchScore !== undefined && matchScore !== null
      ? t("player.menus.subtitles.matchScoreLabel", {
          score: matchScore,
          defaultValue: "Match ~{{score}}%",
        })
      : null;
  const activeCaption =
    selectionMode === "secondary" ? secondaryCaption : selectedCaption;
  const activeDelay =
    selectionMode === "secondary" ? secondaryDelay : primaryDelay;
  const disableActiveCaption = () => {
    if (selectionMode === "secondary") {
      disableSecondary();
      onSelectionModeChange?.("primary");
      return;
    }
    void disable();
  };
  const handleRefreshExternalSubtitles = useCallback(() => {
    if (isLoadingExternalSubtitles) return;
    void addExternalSubtitles(undefined, { forceRefresh: true });
  }, [addExternalSubtitles, isLoadingExternalSubtitles]);
  const renderHeaderActions = (settingsPath: string) => (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={handleRefreshExternalSubtitles}
        disabled={isLoadingExternalSubtitles}
        className={classNames(
          "-my-1 p-[0.4em] rounded tabbable hover:bg-video-context-light hover:bg-opacity-10",
          isLoadingExternalSubtitles ? "opacity-60 cursor-not-allowed" : "",
        )}
        aria-label={refreshButtonLabel}
        title={refreshButtonLabel}
      >
        <Icon
          icon={Icons.RELOAD}
          className={classNames(
            "text-lg",
            isLoadingExternalSubtitles ? "animate-spin" : "",
          )}
        />
      </button>
      <button
        type="button"
        onClick={() => router.navigate(settingsPath)}
        className="-mr-2 -my-1 px-2 p-[0.4em] rounded tabbable hover:bg-video-context-light hover:bg-opacity-10"
      >
        {t("player.menus.subtitles.customizeLabel")}
      </button>
    </div>
  );

  // Get combined caption list
  const captions = useMemo(
    () =>
      captionList.length !== 0 ? captionList : (getHlsCaptionList?.() ?? []),
    [captionList, getHlsCaptionList],
  );

  // Split captions into source and external (opensubtitles)
  const sourceCaptions = useMemo(
    () => captions.filter((x) => !x.opensubtitles),
    [captions],
  );
  const externalCaptions = useMemo(
    () => captions.filter((x) => x.opensubtitles),
    [captions],
  );

  // Group captions by language
  const groupedCaptions = useMemo(() => {
    const allCaptions = [...sourceCaptions, ...externalCaptions];
    const groups: Record<string, typeof allCaptions> = {};

    allCaptions.forEach((caption) => {
      const lang = getCaptionLanguageGroupKey(caption);
      if (!groups[lang]) {
        groups[lang] = [];
      }
      groups[lang].push(caption);
    });

    // Sort languages
    const sortedGroups: Array<{
      language: string;
      captions: typeof allCaptions;
      languageName: string;
    }> = [];
    Object.entries(groups).forEach(([lang, captionsForLang]) => {
      const languageName =
        getPrettyLanguageNameFromLocale(lang) ||
        t("player.menus.subtitles.unknownLanguage");
      sortedGroups.push({
        language: lang,
        captions: captionsForLang,
        languageName,
      });
    });

    // Sort with app language first, then alphabetically
    return sortedGroups.sort((a, b) => {
      // App language always comes first
      if (a.language === appLanguage) return -1;
      if (b.language === appLanguage) return 1;

      // Then sort alphabetically
      return a.languageName.localeCompare(b.languageName);
    });
  }, [sourceCaptions, externalCaptions, t, appLanguage]);

  // Get current subtitle text preview
  const currentSubtitleText = useMemo(() => {
    if (!activeCaption) return null;
    const parsedCaptions = tryParseCanonicalVtt(activeCaption.vttData);
    const visibleCaption = parsedCaptions.find(({ start, end }) =>
      captionIsVisible(start, end, activeDelay, videoTime),
    );
    return visibleCaption?.content;
  }, [activeCaption, activeDelay, videoTime]);

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const files = event.dataTransfer.files;
    const firstFile = files[0];
    if (!files || !firstFile) return;

    const fileExtension = `.${firstFile.name.split(".").pop()?.toLowerCase()}`;
    if (!fileExtension || !subtitleTypeList.includes(fileExtension)) {
      return;
    }

    const reader = new FileReader();
    reader.addEventListener("load", (e) => {
      if (!e.target?.result || !(e.target.result instanceof ArrayBuffer)) {
        return;
      }

      try {
        const decoded = decodeSubtitleBytes(e.target.result, "vi");
        const converted = normalizeSubtitleToVtt(decoded);

        const caption = {
          language: "custom",
          vttData: converted,
          id: "custom-caption",
        };
        if (selectionMode === "secondary") {
          setSecondaryCaption(caption);
        } else {
          setCaption(caption);
          setCustomSubs();
        }
      } catch {
        // Silently fail on drop - user can use the upload button for better error feedback
      }
    });

    reader.addEventListener("error", () => {
      // Silently fail on drop - user can use the upload button for better error feedback
    });

    reader.readAsArrayBuffer(firstFile);
  }

  const { dragging, fileDropProps } = useFileDrop({
    onDrop,
  });

  useEffect(() => {
    const active =
      scrollableContainerRef.current?.querySelector<HTMLElement>(
        "[data-active-link]",
      );

    if (!active || !scrollableContainerRef.current) return;

    const boxRect = scrollableContainerRef.current.getBoundingClientRect();
    const activeLinkRect = active.getBoundingClientRect();
    const activeYPos = activeLinkRect.top - boxRect.top;

    scrollableContainerRef.current.scrollTo({
      top: activeYPos - boxRect.height / 2 + activeLinkRect.height / 2,
      left: 0,
      behavior: "smooth",
    });
  }, [
    selectedCaption?.id,
    secondaryCaption?.id,
    selectionMode,
    currentTranslateTask,
  ]);

  return (
    <>
      <div className="px-6">
        <div
          className={classNames(
            "absolute inset-0 flex items-center justify-center text-white z-10 pointer-events-none transition-opacity duration-300",
            dragging ? "opacity-100" : "opacity-0",
          )}
        >
          <div className="flex flex-col items-center">
            <Icon className="text-5xl mb-4" icon={Icons.UPLOAD} />
            <span className="text-xl weight font-medium">
              {t("player.menus.subtitles.dropSubtitleFile")}
            </span>
          </div>
        </div>

        {backLink ? (
          <Menu.BackLink
            onClick={() => router.navigate("/")}
            rightSide={renderHeaderActions("/captions/settings")}
          >
            {t("player.menus.subtitles.title")}
          </Menu.BackLink>
        ) : (
          <Menu.Title
            rightSide={renderHeaderActions("/captions/settingsOverlay")}
          >
            {t("player.menus.subtitles.title")}
          </Menu.Title>
        )}
      </div>
      <div
        ref={scrollableContainerRef}
        className={classNames(
          "px-6 !pt-1 mt-2 pb-3 h-full space-y-1 overflow-y-auto overflow-x-hidden scrollbar-none transition duration-300",
          dragging ? "opacity-20" : "",
        )}
        {...fileDropProps}
      >
        {/* Secondary subtitle hint — shown when dual sub is active */}
        {isDualSubEnabled && selectionMode === "secondary" && (
          <div className="w-full px-0 pt-2 pb-1 text-center text-xs leading-relaxed text-video-context-type-secondary">
            {t("player.menus.subtitles.dualSubHint")}
          </div>
        )}

        {/* Current subtitle preview */}
        {isMobile && activeCaption && (
          <div className="mt-3 p-2 rounded-xl bg-video-context-light bg-opacity-10 text-center">
            <div className="text-sm text-video-context-type-secondary mb-1">
              {t("player.menus.subtitles.previewLabel")} ·{" "}
              {t(`player.menus.subtitles.${selectionMode}`)}
            </div>
            <div
              className="text-base font-medium min-h-[3rem] flex items-center justify-center"
              style={{ minHeight: "3rem" }}
            >
              {currentSubtitleText ? (
                <div
                  dangerouslySetInnerHTML={{
                    __html: currentSubtitleText.replaceAll(/\r?\n/g, "<br />"),
                  }}
                />
              ) : (
                <span className="text-video-context-type-secondary italic">
                  ...{" "}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Selected captions indicator — keeps both tracks visible while choosing */}
        {isDualSubEnabled && (selectedCaption || secondaryCaption) && (
          <div className="mt-2 grid w-full gap-3">
            {selectedCaption && (
              <div
                className={classNames(
                  "rounded-xl border p-3 transition-colors",
                  selectionMode === "primary"
                    ? "border-video-context-type-accent/50 bg-video-context-type-accent/15"
                    : "border-white/10 bg-white/[0.04]",
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-video-context-type-accent/25 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-video-context-type-accent">
                      {t("player.menus.subtitles.primary")}
                    </span>
                    <FlagIcon langCode={selectedCaption.language} />
                    <span className="min-w-0 truncate text-sm text-white">
                      {getPrettyLanguageNameFromLocale(
                        selectedCaption.language,
                      ) || selectedCaption.language}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => disable()}
                    className="rounded-md p-1 text-video-context-type-accent transition-colors hover:bg-white/10 hover:text-white"
                    aria-label={t("player.menus.subtitles.offChoice")}
                  >
                    <Icon icon={Icons.X} className="text-base" />
                  </button>
                </div>
              </div>
            )}

            {secondaryCaption && (
              <div
                className={classNames(
                  "rounded-xl border p-3 transition-colors",
                  selectionMode === "secondary"
                    ? "border-purple-400/60 bg-purple-500/15"
                    : "border-white/10 bg-white/[0.04]",
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-purple-500/25 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-purple-300">
                      {t("player.menus.subtitles.secondary")}
                    </span>
                    <FlagIcon langCode={secondaryCaption.language} />
                    <span className="min-w-0 truncate text-sm text-white">
                      {getPrettyLanguageNameFromLocale(
                        secondaryCaption.language,
                      ) || secondaryCaption.language}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      disableSecondary();
                      if (selectionMode === "secondary") {
                        onSelectionModeChange?.("primary");
                      }
                    }}
                    className="rounded-md p-1 text-purple-300 transition-colors hover:bg-white/10 hover:text-white"
                    aria-label={t("player.menus.subtitles.clearSecondary")}
                  >
                    <Icon icon={Icons.X} className="text-base" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div>
          {/* Off button */}
          <CaptionOption
            onClick={() => disableActiveCaption()}
            selected={!activeCaption}
          >
            {t("player.menus.subtitles.offChoice")}
          </CaptionOption>

          {/* Dual sub toggle (player store; SubtitleView reads dualSubEnabled) */}
          <div>
            <SelectableLink
              selected={isDualSubEnabled}
              onClick={() => {
                const next = !isDualSubEnabled;
                setDualSubEnabled(next);
                if (!next) {
                  onSelectionModeChange?.("primary");
                }
              }}
              rightSide={
                <div
                  className={classNames(
                    "w-8 h-4 rounded-full transition-colors relative",
                    isDualSubEnabled ? "bg-purple-500" : "bg-white/20",
                  )}
                >
                  <div
                    className={classNames(
                      "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform",
                      isDualSubEnabled ? "translate-x-4" : "translate-x-0.5",
                    )}
                  />
                </div>
              }
            >
              <span className="flex flex-col">
                <span>{t("player.menus.subtitles.dualSub")}</span>
                <span className="text-xs text-video-context-type-secondary mt-0.5">
                  {t("player.menus.subtitles.dualSubDesc")}
                </span>
              </span>
            </SelectableLink>

            {/* Primary / Secondary tab selector — only visible when dual sub is on */}
            {isDualSubEnabled && (
              <div
                className="my-2 grid w-full grid-cols-2 gap-1 rounded-xl bg-white/[0.06] p-1"
                role="tablist"
                aria-label={t("player.menus.subtitles.dualSub")}
              >
                <button
                  type="button"
                  onClick={() => onSelectionModeChange?.("primary")}
                  className={classNames(
                    "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    selectionMode === "primary"
                      ? "bg-video-context-type-accent text-white shadow-sm"
                      : "text-video-context-type-secondary hover:bg-white/10",
                  )}
                  role="tab"
                  aria-selected={selectionMode === "primary"}
                >
                  {t("player.menus.subtitles.primary")}
                </button>
                <button
                  type="button"
                  onClick={() => onSelectionModeChange?.("secondary")}
                  className={classNames(
                    "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    selectionMode === "secondary"
                      ? "bg-purple-600 text-white shadow-sm"
                      : "text-video-context-type-secondary hover:bg-white/10",
                  )}
                  role="tab"
                  aria-selected={selectionMode === "secondary"}
                >
                  {t("player.menus.subtitles.secondary")}
                </button>
              </div>
            )}
          </div>

          {/* Automatically select subtitles option */}
          {captions.length > 0 && selectionMode === "primary" && (
            <CaptionOption
              onClick={() => handleRandomSelect()}
              selected={!!selectedCaption}
              loading={isRandomSelecting}
            >
              <div className="flex flex-col">
                {t("player.menus.subtitles.autoSelectChoice")}
                {selectedCaption && (
                  <span className="text-video-context-type-secondary text-xs">
                    {t("player.menus.subtitles.autoSelectDifferentChoice")}
                  </span>
                )}
                {SHOW_MATCH_SCORE && matchScoreLabel && (
                  <span
                    className={classNames(
                      "text-xs font-bold mt-2 whitespace-nowrap",
                      {
                        "text-video-context-type-accent":
                          effectiveMatchScore >= 80,
                        "text-yellow-500":
                          effectiveMatchScore >= 50 && effectiveMatchScore < 80,
                        "text-video-context-error": effectiveMatchScore < 50,
                      },
                    )}
                  >
                    {matchScoreLabel}
                  </span>
                )}
              </div>
            </CaptionOption>
          )}

          {/* Custom upload option */}
          <CustomCaptionOption selectionMode={selectionMode} />

          {/* Paste subtitle option */}
          <PasteCaptionOption
            selected={activeCaption?.id === "pasted-caption"}
            selectionMode={selectionMode}
          />

          {activeCaption && (
            <Menu.ChevronLink
              onClick={() => router.navigate("/captions/transcript")}
            >
              {t("player.menus.subtitles.transcriptChoice")}
            </Menu.ChevronLink>
          )}

          <div className="h-1" />

          {/* No subtitles available message */}
          {!isLoadingExternalSubtitles &&
            sourceCaptions.length === 0 &&
            externalCaptions.length === 0 && (
              <div className="p-4 pb-4 rounded-xl bg-video-context-light bg-opacity-10 text-center">
                <div className="text-video-context-type-secondary">
                  {t("player.menus.subtitles.empty")}
                </div>
              </div>
            )}

          {/* Loading external subtitles */}
          {isLoadingExternalSubtitles && (
            <div className="p-4 rounded-xl bg-video-context-light bg-opacity-10 text-center">
              <div className="text-video-context-type-secondary">
                {externalSubtitleProgressLabel}
              </div>
            </div>
          )}

          {/* Language selection */}
          {groupedCaptions.length > 0 &&
            groupedCaptions.map(
              ({ language, languageName, captions: captionsForLang }) => {
                const isPrimarySelected =
                  (!currentTranslateTask && selectedLanguage === language) ||
                  (!!currentTranslateTask &&
                    !currentTranslateTask.error &&
                    currentTranslateTask.targetCaption.language === language);
                const isSecondarySelected =
                  secondaryCaption?.language === language;

                return (
                  <Menu.ChevronLink
                    key={language}
                    selected={
                      selectionMode === "primary"
                        ? isPrimarySelected
                        : isSecondarySelected
                    }
                    rightText={captionsForLang.length.toString()}
                    onClick={() => {
                      onChooseLanguage?.(language);
                      router.navigate(
                        backLink
                          ? "/captions/languages"
                          : "/captionsOverlay/languagesOverlay",
                      );
                    }}
                  >
                    <span className="flex items-center">
                      <FlagIcon langCode={language} />
                      <span className="ml-3">{languageName}</span>
                      {isDualSubEnabled &&
                        isPrimarySelected &&
                        selectionMode === "secondary" && (
                          <span className="ml-2 text-xs font-medium text-video-context-type-accent bg-video-context-type-accent/20 px-1.5 py-0.5 rounded">
                            1st
                          </span>
                        )}
                      {isDualSubEnabled &&
                        isSecondarySelected &&
                        selectionMode === "primary" && (
                          <span className="ml-2 text-xs font-medium text-purple-400 bg-purple-500/20 px-1.5 py-0.5 rounded">
                            2nd
                          </span>
                        )}
                    </span>
                  </Menu.ChevronLink>
                );
              },
            )}
        </div>
      </div>
    </>
  );
}

export default CaptionsView;
