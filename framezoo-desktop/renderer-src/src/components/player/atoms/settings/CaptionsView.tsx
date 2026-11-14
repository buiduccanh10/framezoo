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
import { Menu } from "@/components/player/internals/ContextMenu";
import { SelectableLink } from "@/components/player/internals/ContextMenu/Links";
import {
  captionIsVisible,
  decodeSubtitleBytes,
  isHearingImpairedCaption,
  normalizeSubtitleToVtt,
  tryParseCanonicalVtt,
} from "@/components/player/utils/captions";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useOverlayRouter } from "@/hooks/useOverlayRouter";
import { useLanguageStore } from "@/stores/language";
import {
  CaptionListItem,
  SubtitleTrack,
  isEmbeddedCaption,
} from "@/stores/player/slices/source";
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
  const { t } = useTranslation();

  if (props.loading) {
    // should override selected and error and not show translate button
    return <Spinner className="text-lg" />;
  }

  function translateBtn(margin: boolean) {
    return (
      props.translatable && (
        <span
          className={classNames(
            "text-buttons-secondaryText px-2 py-1 rounded bg-transparent cursor-pointer",
            {
              "mr-1": margin,
              "bg-buttons-purpleHover/100": props.isTranslatedTarget,
            },
            "transition duration-300 ease-in-out",
            "hover:bg-buttons-primaryHover/100",
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
          <span
            className="flex items-center text-video-context-error"
            title={typeof props.error === "string" ? props.error : undefined}
          >
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
                {t("player.menus.subtitles.dualSubPrimaryBadge", {
                  defaultValue: "Primary",
                })}
              </span>
            ) : null}
            {props.secondarySelected && !props.selected ? (
              <span className="flex items-center rounded bg-purple-500/20 px-2 py-0.5 text-xs font-medium text-purple-300">
                {t("player.menus.subtitles.dualSubSecondaryBadge", {
                  defaultValue: "Secondary",
                })}
              </span>
            ) : null}
          </>
        )}
      </div>
    );
  }

  return translateBtn(false);
}

export function getSubtitleSourceBadgeClass(source?: string): string {
  if (!source) return "bg-zinc-600";
  const s = source.toLowerCase();

  // 1. Well-known subtitle providers (fuzzy matching)
  if (s.includes("wyzie")) return "bg-blue-600";
  if (s.includes("subsource")) return "bg-cyan-600";
  if (s.includes("opensub")) return "bg-orange-500";
  if (s.includes("granite")) return "bg-emerald-600";
  if (s.includes("subdl")) return "bg-amber-600";
  if (s.includes("yts") || s.includes("yify")) return "bg-teal-600";
  if (s.includes("podnapisi")) return "bg-purple-600";
  if (s.includes("addic7ed") || s.includes("a4k")) return "bg-rose-600";
  if (s.includes("vdrk")) return "bg-indigo-600";
  if (s.includes("embedded")) return "bg-slate-600";

  // 2. Deterministic palette for external / custom addons
  const palette = [
    "bg-indigo-600",
    "bg-violet-600",
    "bg-purple-600",
    "bg-fuchsia-600",
    "bg-pink-600",
    "bg-rose-600",
    "bg-sky-600",
    "bg-teal-600",
    "bg-emerald-600",
    "bg-amber-600",
  ];

  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash << 5) - hash + s.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % palette.length;
  return palette[index];
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
  const isHearingImpaired =
    props.isHearingImpaired ||
    isHearingImpairedCaption({
      isHearingImpaired: props.isHearingImpaired,
      label: typeof props.children === "string" ? props.children : undefined,
      url: props.subtitleUrl,
    });

  const tooltipContent = useMemo(() => {
    if (!props.subtitleUrl && !props.subtitleSource && !props.error)
      return null;

    const parts = [];

    if (props.error) {
      parts.push(`Error: ${props.error}`);
    }

    if (props.subtitleSource) {
      parts.push(`Source: ${props.subtitleSource}`);
    }

    if (props.subtitleEncoding) {
      parts.push(`Encoding: ${props.subtitleEncoding}`);
    }

    if (isHearingImpaired) {
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
    isHearingImpaired,
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
          className="flex flex-col items-start min-w-0 flex-1 w-full"
        >
          <div className="flex items-center min-w-0 w-full">
            {props.flag ? (
              <span
                data-code={props.countryCode}
                className="mr-3 inline-flex flex-shrink-0"
              >
                <FlagIcon langCode={props.countryCode} />
              </span>
            ) : null}
            <span
              className="truncate block min-w-0 flex-1"
              title={
                typeof props.children === "string" ? props.children : undefined
              }
            >
              {props.children}
            </span>
            {isHearingImpaired && (
              <span
                className="ml-2 inline-flex flex-shrink-0 items-center text-video-context-type-accent"
                title={t("player.menus.subtitles.hearingImpaired", {
                  defaultValue: "Hearing Impaired (SDH)",
                })}
              >
                <Icon icon={Icons.EAR} className="text-base" />
              </span>
            )}
          </div>
          {(subtitleTypeLabel ||
            subtitleSourceLabel ||
            (SHOW_MATCH_SCORE &&
              props.matchScore !== undefined &&
              props.matchScore !== null)) && (
            <div className="flex items-center min-w-0 w-full">
              {subtitleTypeLabel && (
                <span className="px-2 py-0.5 mt-2 rounded bg-video-context-hoverColor/80 text-video-context-type-main text-xs font-semibold flex-shrink-0">
                  {subtitleTypeLabel}
                </span>
              )}
              {subtitleSourceLabel && (
                <span
                  className={classNames(
                    "ml-2 px-2 py-0.5 mt-2 rounded text-white text-xs font-semibold overflow-hidden text-ellipsis whitespace-nowrap flex-shrink min-w-0 shadow-sm",
                    getSubtitleSourceBadgeClass(subtitleSource),
                  )}
                >
                  {subtitleSourceLabel}
                </span>
              )}
              {SHOW_MATCH_SCORE &&
                props.matchScore !== undefined &&
                props.matchScore !== null && (
                  <span
                    className={classNames(
                      "text-xs font-bold ml-2 mt-2 whitespace-nowrap flex-shrink-0",
                      {
                        "text-video-context-type-accent":
                          props.matchScore >= 80,
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
          )}
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
  const fileInput = useRef<HTMLInputElement>(null!);
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
  dualSelectionMode?: SubtitleSelectionMode;
}

export function CaptionsView({
  id,
  backLink,
  onChooseLanguage,
  selectionMode = "primary",
  onSelectionModeChange,
  dualSelectionMode,
}: CaptionsViewProps) {
  const { t } = useTranslation();
  const router = useOverlayRouter(id);
  const { isMobile } = useIsMobile();
  const selectedCaption = usePlayerStore((s) => s.caption.selected);
  const secondaryCaption = usePlayerStore((s) => s.caption.secondary);
  const isDualSubEnabled = usePlayerStore((s) => s.caption.dualSubEnabled);
  const currentTranslateTask = usePlayerStore((s) => s.caption.translateTask);
  const {
    canSyncSelectedCaption,
    disable,
    selectBestCaptionFromLastUsedLanguage,
    disableSecondary,
  } = useCaptions();
  const hasRenderedFrame = usePlayerStore(
    (s) => s.mediaPlaying.hasRenderedFrame,
  );
  const [isRandomSelecting, setIsRandomSelecting] = useState(false);
  const scrollableContainerRef = useRef<HTMLDivElement>(null!);

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
  const videoTime = usePlayerStore((s) => s.progress.time);
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
          "-my-1 p-[0.4em] rounded tabbable hover:bg-video-context-light/10",
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
        className="-mr-2 -my-1 px-2 p-[0.4em] rounded tabbable hover:bg-video-context-light/10"
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
  const activeCaptionListItem = activeCaption
    ? (captions.find((caption) => caption.id === activeCaption.id) ??
      activeCaption.sourceCaption ??
      null)
    : null;
  const isNativeCaption = Boolean(
    activeCaption &&
    (activeCaption.trackId ||
      (activeCaptionListItem && isEmbeddedCaption(activeCaptionListItem))),
  );
  const canOpenTranscript = Boolean(
    activeCaption &&
    !isNativeCaption &&
    activeCaption.vttData.trim().length > 0,
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

  const renderLanguageOptions = (languageRoute: string) =>
    groupedCaptions.map(
      ({ language, languageName, captions: captionsForLang }) => {
        const isPrimarySelected =
          (!currentTranslateTask && selectedLanguage === language) ||
          (!!currentTranslateTask &&
            !currentTranslateTask.error &&
            currentTranslateTask.targetCaption.language === language);
        const isSecondarySelected = secondaryCaption?.language === language;

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
              router.navigate(languageRoute);
            }}
          >
            <span className="flex items-center">
              <FlagIcon langCode={language} />
              <span className="ml-3">{languageName}</span>
              {(isDualSubEnabled || dualSelectionMode) &&
                isPrimarySelected &&
                selectionMode === "secondary" && (
                  <span className="ml-2 rounded bg-video-context-type-accent/20 px-1.5 py-0.5 text-xs font-medium text-video-context-type-accent">
                    {t("player.menus.subtitles.dualSubPrimaryBadge", {
                      defaultValue: "Primary",
                    })}
                  </span>
                )}
              {(isDualSubEnabled || dualSelectionMode) &&
                isSecondarySelected &&
                selectionMode === "primary" && (
                  <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-xs font-medium text-video-context-type-secondary">
                    {t("player.menus.subtitles.dualSubSecondaryBadge", {
                      defaultValue: "Secondary",
                    })}
                  </span>
                )}
            </span>
          </Menu.ChevronLink>
        );
      },
    );

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

  if (dualSelectionMode) {
    const trackLabel = t(`player.menus.subtitles.${dualSelectionMode}`);

    return (
      <>
        <div className="px-6">
          <Menu.BackLink
            onClick={() => router.navigate("/captions/dual")}
            rightSide={renderHeaderActions("/captions/settings")}
          >
            <span className="truncate">{trackLabel}</span>
          </Menu.BackLink>
        </div>
        <div className="mt-2 h-full overflow-y-auto overflow-x-hidden px-6 !pt-1 pb-3 scrollbar-none">
          <p className="mb-2 px-1 text-xs leading-relaxed text-video-context-type-secondary">
            {t("player.menus.subtitles.dualSubSelectHint", {
              defaultValue: "Choose a subtitle track for this slot",
            })}
          </p>
          {renderLanguageOptions(
            `/captions/dual/${dualSelectionMode}/languages`,
          )}
        </div>
      </>
    );
  }

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
          <div className="mt-3 p-2 rounded-xl bg-video-context-light/10 text-center">
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

        {canSyncSelectedCaption && canOpenTranscript && (
          <button
            type="button"
            onClick={() => router.navigate("/captions/transcript/sync")}
            disabled={!hasRenderedFrame}
            className={classNames(
              "group mt-3 flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-[background-color,border-color,transform] duration-150",
              "mb-2 border-video-context-type-accent/35 bg-video-context-type-accent/10 hover:border-video-context-type-accent/55 hover:bg-video-context-type-accent/15 active:scale-[0.99]",
              "tabbable disabled:cursor-not-allowed disabled:opacity-50",
            )}
            aria-label={t("player.menus.subtitles.autoSyncAction", "Auto sync")}
          >
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-video-context-type-accent/20 text-video-context-type-accent">
              <Icon icon={Icons.WAND} className="text-xl" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold text-white">
                  {t("player.menus.subtitles.autoSyncTitle", {
                    defaultValue: "Auto sync",
                  })}
                </span>
                <span className="shrink-0 whitespace-nowrap rounded-full bg-video-context-type-accent/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-video-context-type-accent">
                  {t("player.menus.subtitles.autoSyncBadge", {
                    defaultValue: "AI",
                  })}
                </span>
              </span>
              <span className="mt-0.5 block truncate text-xs text-video-context-type-secondary">
                {t("player.menus.subtitles.autoSyncDescription", {
                  defaultValue:
                    "Match subtitles to the spoken dialogue automatically",
                })}
              </span>
            </span>
            <span className="flex flex-none items-center text-video-context-type-secondary transition-transform group-hover:translate-x-0.5 group-hover:text-video-context-type-main">
              <Icon icon={Icons.CHEVRON_RIGHT} className="text-lg" />
            </span>
          </button>
        )}

        <div>
          {/* Off button */}
          <CaptionOption
            onClick={() => disableActiveCaption()}
            selected={!activeCaption}
          >
            {t("player.menus.subtitles.offChoice")}
          </CaptionOption>

          <Menu.ChevronLink
            selected={isDualSubEnabled}
            onClick={() => router.navigate("/captions/dual")}
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span>{t("player.menus.subtitles.dualSub")}</span>
              <span className="mt-0.5 truncate text-xs text-video-context-type-secondary">
                {selectedCaption && secondaryCaption
                  ? `${getPrettyLanguageNameFromLocale(selectedCaption.language) ?? selectedCaption.language} + ${getPrettyLanguageNameFromLocale(secondaryCaption.language) ?? secondaryCaption.language}`
                  : t("player.menus.subtitles.dualSubDesc")}
              </span>
            </span>
          </Menu.ChevronLink>

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
              disabled={!canOpenTranscript}
            >
              {t("player.menus.subtitles.transcriptChoice", {
                defaultValue: "Transcript",
              })}
            </Menu.ChevronLink>
          )}
          <div className="h-1" />

          {/* No subtitles available message */}
          {!isLoadingExternalSubtitles &&
            sourceCaptions.length === 0 &&
            externalCaptions.length === 0 && (
              <div className="p-4 pb-4 rounded-xl bg-video-context-light/10 text-center">
                <div className="text-video-context-type-secondary">
                  {t("player.menus.subtitles.empty")}
                </div>
              </div>
            )}

          {/* Loading external subtitles */}
          {isLoadingExternalSubtitles && (
            <div className="p-4 rounded-xl bg-video-context-light/10 text-center">
              <div className="text-video-context-type-secondary">
                {externalSubtitleProgressLabel}
              </div>
            </div>
          )}

          {/* Language selection */}
          {groupedCaptions.length > 0 &&
            renderLanguageOptions(
              backLink
                ? "/captions/languages"
                : "/captionsOverlay/languagesOverlay",
            )}
        </div>
      </div>
    </>
  );
}

export default CaptionsView;
