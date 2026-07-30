import classNames from "classnames";
import Fuse from "fuse.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { FlagIcon } from "@/components/FlagIcon";
import { Icon, Icons } from "@/components/Icon";
import { Menu } from "@/components/player/internals/ContextMenu";
import { Input } from "@/components/player/internals/ContextMenu/Input";
import { Link } from "@/components/player/internals/ContextMenu/Links";
import {
  captionIsVisible,
  getCaptionDelayForCue,
  makeQueId,
  parseCanonicalVtt,
  sanitize,
} from "@/components/player/utils/captions";
import { useOverlayRouter } from "@/hooks/useOverlayRouter";
import { usePlayerStore } from "@/stores/player/store";
import { useSubtitleStore } from "@/stores/subtitles";
import { durationExceedsHour, formatSeconds } from "@/utils/formatSeconds";
import { getPrettyLanguageNameFromLocale } from "@/utils/language";

import type { SubtitleSelectionMode } from "./CaptionsView";
import { wordOverrides } from "../../Player";

export function TranscriptView({
  id,
  selectionMode = "primary",
  onSelectionModeChange,
}: {
  id: string;
  selectionMode?: SubtitleSelectionMode;
  onSelectionModeChange?: (mode: SubtitleSelectionMode) => void;
}) {
  const { t } = useTranslation();
  const router = useOverlayRouter(id);
  const primaryCaption = usePlayerStore((s) => s.caption.selected);
  const secondaryCaption = usePlayerStore((s) => s.caption.secondary);
  const isDualSubEnabled = usePlayerStore((s) => s.caption.dualSubEnabled);
  const setActiveCaptionTrack = usePlayerStore((s) => s.setActiveCaptionTrack);
  const primaryDelay = useSubtitleStore((s) => s.primaryDelay);
  const secondaryDelay = useSubtitleStore((s) => s.secondaryDelay);
  const setPrimaryDelay = useSubtitleStore((s) => s.setPrimaryDelay);
  const setSecondaryDelay = useSubtitleStore((s) => s.setSecondaryDelay);
  const { duration: timeDuration, time } = usePlayerStore((s) => s.progress);
  const activeCaption =
    selectionMode === "secondary" ? secondaryCaption : primaryCaption;
  const delay = selectionMode === "secondary" ? secondaryDelay : primaryDelay;
  const setDelay =
    selectionMode === "secondary" ? setSecondaryDelay : setPrimaryDelay;
  const changeSelectionMode = onSelectionModeChange ?? setActiveCaptionTrack;

  const [searchQuery, setSearchQuery] = useState("");
  const [delayInput, setDelayInput] = useState("");
  const [isDelayFocused, setIsDelayFocused] = useState(false);
  const [isAtTop, setIsAtTop] = useState(true);
  const [isAtBottom, setIsAtBottom] = useState(false);
  const carouselRef = useRef<HTMLDivElement>(null);

  const displayDelay = isDelayFocused ? delayInput : delay.toFixed(2);

  const parsedCaptions = useMemo(
    () =>
      activeCaption?.vttData ? parseCanonicalVtt(activeCaption.vttData) : [],
    [activeCaption],
  );

  const showHours = useMemo(() => {
    const subtitleDuration =
      (parsedCaptions[parsedCaptions.length - 1]?.end ?? 0) / 1000;
    return durationExceedsHour(Math.max(timeDuration, subtitleDuration));
  }, [parsedCaptions, timeDuration]);

  const transcriptItems = useMemo(
    () =>
      parsedCaptions.map((cue, i) => {
        const { start, end, content: raw } = cue;
        const delayedStart = start / 1000 + delay;
        const delayedEnd = end / 1000 + delay;

        const textWithNewlines = (raw || "")
          .split(" ")
          .map((word) => wordOverrides[word] ?? word)
          .join(" ")
          .replaceAll(/ i'/g, " I'")
          .replaceAll(/\r?\n/g, " ");

        return {
          key: makeQueId(i, start, end),
          cue,
          startMs: start,
          endMs: end,
          start: delayedStart,
          end: delayedEnd,
          raw: textWithNewlines,
        };
      }),
    [parsedCaptions, delay],
  );

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return transcriptItems;
    const fuse = new Fuse(transcriptItems, {
      includeScore: true,
      isCaseSensitive: false,
      shouldSort: false,
      threshold: 0.2,
      keys: ["raw"],
    });
    return fuse.search(searchQuery).map((r) => r.item);
  }, [transcriptItems, searchQuery]);

  // Determine currently visible caption to highlight
  const { activeKey, nextKey } = useMemo(() => {
    if (parsedCaptions.length === 0)
      return {
        activeKey: null as string | null,
        nextKey: null as string | null,
      };

    const visibleIdx = parsedCaptions.findIndex(({ start, end }) =>
      captionIsVisible(start, end, delay, time),
    );

    // Next upcoming caption (first with start > now)
    const startsSec = parsedCaptions.map((c) => c.start / 1000 + delay);
    const nextIdx = startsSec.findIndex((s) => s > time);

    const key =
      visibleIdx !== -1
        ? makeQueId(
            visibleIdx,
            parsedCaptions[visibleIdx]!.start,
            parsedCaptions[visibleIdx]!.end,
          )
        : null; // Show nothing during gaps

    let nextKeyLocal: string | null = null;
    if (nextIdx !== -1) {
      const n = parsedCaptions[nextIdx]!;
      nextKeyLocal = makeQueId(nextIdx, n.start, n.end);
    }

    return { activeKey: key, nextKey: nextKeyLocal };
  }, [parsedCaptions, delay, time]);

  const scrollTargetKey = useMemo(() => {
    if (searchQuery.trim()) {
      const nextFiltered = filteredItems.find((it) => it.start > time);
      if (nextFiltered) return nextFiltered.key;

      const hasActive = filteredItems.some((it) => it.key === activeKey);
      if (hasActive) return activeKey;
      return null;
    }
    return nextKey ?? activeKey;
  }, [filteredItems, searchQuery, time, nextKey, activeKey]);

  const checkScrollPosition = () => {
    const container = carouselRef.current;
    if (!container) return;

    setIsAtTop(container.scrollTop <= 0);
    setIsAtBottom(
      Math.abs(
        container.scrollHeight - container.scrollTop - container.clientHeight,
      ) < 2,
    );
  };

  useEffect(() => {
    const container = carouselRef.current;
    if (!container) return;

    container.addEventListener("scroll", checkScrollPosition);
    checkScrollPosition(); // Check initial position

    return () => {
      container.removeEventListener("scroll", checkScrollPosition);
    };
  }, []);

  // Autoscroll with delay to prevent clashing with menu animation
  const [didFirstScroll, setDidFirstScroll] = useState(false);
  useEffect(() => {
    if (!scrollTargetKey) return;
    const scrollToStablePoint = (target: HTMLElement) => {
      const container = carouselRef.current;
      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();

      const containerHeight = container.clientHeight || 288; // 18rem = 288px
      const desiredOffsetFromTop = Math.floor(containerHeight * 0.6); // half of the container height

      // Current absolute position of target center within container's scroll space
      const targetCenterAbs =
        container.scrollTop +
        (targetRect.top - containerRect.top) +
        targetRect.height / 2;

      // Desired scrollTop so that the target center sits at desired offset
      let nextScrollTop = targetCenterAbs - desiredOffsetFromTop;

      const maxScrollTop = Math.max(
        0,
        container.scrollHeight - containerHeight,
      );
      nextScrollTop = Math.max(0, Math.min(nextScrollTop, maxScrollTop));

      container.scrollTo({ top: nextScrollTop, behavior: "smooth" });
    };

    const doScroll = () => {
      const el = document.querySelector<HTMLElement>(
        `[data-que-id="${scrollTargetKey}"]`,
      );
      if (el) scrollToStablePoint(el);
    };

    if (!didFirstScroll) {
      const timeout = setTimeout(() => {
        doScroll();
        setDidFirstScroll(true);
      }, 100);
      return () => clearTimeout(timeout);
    }
    doScroll();
  }, [scrollTargetKey, didFirstScroll]);

  const handleItemClick = (item: (typeof transcriptItems)[number]) => {
    const newDelay = getCaptionDelayForCue(item.cue, time);
    setDelay(Number(newDelay.toFixed(2)));
  };

  return (
    <>
      <Menu.BackLink onClick={() => router.navigate("/captions")}>
        <span className="flex min-w-0 items-center gap-2">
          {t("player.menus.subtitles.transcriptChoice")}
          <span className="truncate text-video-context-type-secondary">
            · {t(`player.menus.subtitles.${selectionMode}`)}
          </span>
        </span>
      </Menu.BackLink>
      <Menu.Section>
        {isDualSubEnabled && (
          <div
            className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-white/[0.06] p-1"
            role="tablist"
            aria-label={t("player.menus.subtitles.dualSub")}
          >
            {(["primary", "secondary"] as const).map((track) => {
              const caption =
                track === "primary" ? primaryCaption : secondaryCaption;
              const language = caption
                ? (getPrettyLanguageNameFromLocale(caption.language) ??
                  caption.language)
                : t("player.menus.subtitles.offChoice");

              return (
                <button
                  key={track}
                  type="button"
                  role="tab"
                  aria-selected={selectionMode === track}
                  onClick={() => changeSelectionMode(track)}
                  disabled={track === "secondary" && !secondaryCaption}
                  className={classNames(
                    "flex min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                    selectionMode === track
                      ? track === "primary"
                        ? "bg-video-context-type-accent text-white shadow-sm"
                        : "bg-purple-600 text-white shadow-sm"
                      : "text-video-context-type-secondary hover:bg-white/10",
                  )}
                >
                  {caption ? <FlagIcon langCode={caption.language} /> : null}
                  <span className="min-w-0 truncate">
                    <span className="block text-[11px] font-semibold uppercase tracking-wide opacity-70">
                      {t(`player.menus.subtitles.${track}`)}
                    </span>
                    <span className="block truncate">{language}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <div className="flex flex-col gap-2.5">
          <Input
            value={searchQuery}
            onInput={setSearchQuery}
            placeholder={t(
              "player.menus.subtitles.searchPlaceholder",
              "Search subtitles or dialogue...",
            )}
          />
          <div className="flex items-center justify-between px-1 py-0.5 text-sm">
            <span className="font-medium text-video-context-type-main text-xs sm:text-sm">
              {t("player.menus.subtitles.delayLabel", "Subtitle offset")} ·{" "}
              {t(`player.menus.subtitles.${selectionMode}`)}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setDelay(Number((delay - 0.1).toFixed(2)))}
                className="w-7 h-7 flex items-center justify-center rounded-md bg-video-context-light bg-opacity-15 hover:bg-opacity-25 text-white font-bold transition-colors select-none text-sm"
                title="-0.1s"
              >
                -
              </button>
              <div className="relative flex items-center">
                <input
                  type="text"
                  inputMode="decimal"
                  value={displayDelay}
                  onFocus={() => {
                    setDelayInput(delay.toString());
                    setIsDelayFocused(true);
                  }}
                  onChange={(e) => {
                    const valStr = e.target.value;
                    setDelayInput(valStr);
                    const val = parseFloat(valStr);
                    if (!isNaN(val)) {
                      setDelay(Number(val.toFixed(2)));
                    }
                  }}
                  onBlur={() => setIsDelayFocused(false)}
                  className="w-16 h-7 text-center font-mono text-xs bg-video-context-inputBg text-white rounded-md border border-white/5 focus:border-white/20 focus:outline-none pr-3.5 transition-colors"
                />
                <span className="absolute right-2 text-xs text-video-context-type-secondary pointer-events-none">
                  s
                </span>
              </div>
              <button
                type="button"
                onClick={() => setDelay(Number((delay + 0.1).toFixed(2)))}
                className="w-7 h-7 flex items-center justify-center rounded-md bg-video-context-light bg-opacity-15 hover:bg-opacity-25 text-white font-bold transition-colors select-none text-sm"
                title="+0.1s"
              >
                +
              </button>
              <button
                type="button"
                onClick={() => setDelay(0)}
                disabled={delay === 0}
                className="h-7 px-2 ml-0.5 text-xs rounded-md bg-video-context-light bg-opacity-15 hover:bg-opacity-25 text-video-context-type-main hover:text-white transition-colors flex items-center justify-center disabled:opacity-40 disabled:hover:bg-opacity-15 disabled:hover:text-video-context-type-main disabled:cursor-not-allowed"
                title={t("player.menus.subtitles.resetDelay", "Reset")}
              >
                <Icon icon={Icons.RELOAD} className="text-xs" />
              </button>
            </div>
          </div>
        </div>
      </Menu.Section>
      <div
        ref={carouselRef}
        className={classNames(
          "min-h-0 overflow-y-auto",
          "vertical-carousel-container",
          {
            "hide-top-gradient": isAtTop,
            "hide-bottom-gradient": isAtBottom,
          },
        )}
      >
        <div className="flex flex-col gap-1 pb-4">
          {activeCaption ? (
            filteredItems.map((item) => {
              const html = sanitize(item.raw.replaceAll(/\r?\n/g, "<br />"), {
                ALLOWED_TAGS: ["c", "b", "i", "u", "span", "ruby", "rt", "br"],
                ADD_TAGS: ["v", "lang"],
                ALLOWED_ATTR: ["title", "lang"],
              });

              const isActive = activeKey === item.key;

              return (
                <div key={item.key} data-que-id={item.key}>
                  <Link
                    onClick={() => handleItemClick(item)}
                    clickable
                    className="items-start transition-colors duration-150 rounded-lg"
                    active={isActive}
                  >
                    <span className="mr-3 flex-none w-[4.5rem] h-[1.75rem] flex items-center justify-center px-0 leading-tight rounded-md bg-video-context-light bg-opacity-20 text-video-context-type-main font-normal whitespace-nowrap overflow-hidden text-sm">
                      {item.start < 0 || !Number.isFinite(item.start)
                        ? "N/A"
                        : formatSeconds(item.start, showHours)}
                    </span>
                    <span
                      className={
                        isActive
                          ? "flex-1 text-white font-semibold text-sm leading-snug py-0.5"
                          : "flex-1 text-video-context-type-main text-sm leading-snug py-0.5 hover:text-white transition-colors"
                      }
                    >
                      <span
                        dangerouslySetInnerHTML={{ __html: html }}
                        dir="ltr"
                      />
                    </span>
                  </Link>
                </div>
              );
            })
          ) : (
            <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-video-context-type-secondary">
              {selectionMode === "secondary"
                ? t("player.menus.subtitles.clearSecondary")
                : t("player.menus.subtitles.offChoice")}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
