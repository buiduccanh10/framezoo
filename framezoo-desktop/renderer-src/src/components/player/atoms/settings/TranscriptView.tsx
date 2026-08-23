import { useVirtualizer } from "@tanstack/react-virtual";
import classNames from "classnames";
import Fuse from "fuse.js";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/buttons/Button";
import { FlagIcon } from "@/components/FlagIcon";
import { Icon, Icons } from "@/components/Icon";
import { Modal, ModalCard, useModal } from "@/components/overlays/Modal";
import { useCaptions } from "@/components/player/hooks/useCaptions";
import { usePlaybackClock } from "@/components/player/hooks/usePlaybackClock";
import { Menu } from "@/components/player/internals/ContextMenu";
import { Input } from "@/components/player/internals/ContextMenu/Input";
import {
  captionIsVisible,
  getCaptionDelayForCue,
  makeQueId,
  sanitize,
  tryParseCanonicalVtt,
} from "@/components/player/utils/captions";
import { useOverlayRouter } from "@/hooks/useOverlayRouter";
import {
  downloadMoonshineModel,
  setMoonshineModelPromptHandler,
} from "@/moonshine/runtime";
import type { MoonshineModelEntry } from "@/moonshine/types";
import { useToastStore } from "@/stores/interface/toast";
import { usePlayerStore } from "@/stores/player/store";
import { useSubtitleStore } from "@/stores/subtitles";
import { durationExceedsHour, formatSeconds } from "@/utils/formatSeconds";
import { getPrettyLanguageNameFromLocale } from "@/utils/language";

import type { SubtitleSelectionMode } from "./CaptionsView";
import { wordOverrides } from "../../Player";

const MOONSHINE_AUDIO_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "zh", label: "Mandarin" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "vi", label: "Vietnamese" },
  { code: "uk", label: "Ukrainian" },
  { code: "ar", label: "Arabic" },
] as const;

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
  const timeDuration = usePlayerStore((s) => s.progress.duration);
  const time = usePlaybackClock();
  const activeCaption =
    selectionMode === "secondary" ? secondaryCaption : primaryCaption;
  const delay = selectionMode === "secondary" ? secondaryDelay : primaryDelay;
  const setDelay =
    selectionMode === "secondary" ? setSecondaryDelay : setPrimaryDelay;
  const changeSelectionMode = onSelectionModeChange ?? setActiveCaptionTrack;
  const { syncSelectedCaption, canSyncSelectedCaption } = useCaptions();
  const syncModal = useModal("subtitle-sync-confirm");
  const modelModal = useModal("moonshine-model-download");
  const showToast = useToastStore((s) => s.showToast);

  const [isSyncCooldown, setIsSyncCooldown] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [delayInput, setDelayInput] = useState("");
  const [isDelayFocused, setIsDelayFocused] = useState(false);
  const [isAtTop, setIsAtTop] = useState(true);
  const [isAtBottom, setIsAtBottom] = useState(false);
  const [modelRequest, setModelRequest] = useState<{
    entry: MoonshineModelEntry;
    downloading: boolean;
  } | null>(null);
  const carouselRef = useRef<HTMLDivElement>(null);
  const modelResolverRef = useRef<((accepted: boolean) => void) | null>(null);
  const modelAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setMoonshineModelPromptHandler(
      (entry) =>
        new Promise<boolean>((resolve) => {
          modelResolverRef.current = resolve;
          setModelRequest({ entry, downloading: false });
          modelModal.show();
        }),
    );
    return () => {
      setMoonshineModelPromptHandler(null);
      modelAbortRef.current?.abort();
      modelResolverRef.current?.(false);
      modelResolverRef.current = null;
    };
  }, [modelModal]);

  const resolveModelRequest = (accepted: boolean) => {
    modelAbortRef.current?.abort();
    modelAbortRef.current = null;
    modelResolverRef.current?.(accepted);
    modelResolverRef.current = null;
    setModelRequest(null);
    modelModal.hide();
  };

  const handleModelDownload = async () => {
    if (!modelRequest || modelRequest.downloading) return;
    const controller = new AbortController();
    modelAbortRef.current = controller;
    setModelRequest((current) =>
      current ? { ...current, downloading: true } : current,
    );
    try {
      await downloadMoonshineModel(modelRequest.entry, controller.signal);
      resolveModelRequest(true);
    } catch {
      resolveModelRequest(false);
    }
  };

  const displayDelay = isDelayFocused ? delayInput : delay.toFixed(2);

  const handleConfirmSync = async () => {
    if (isSyncCooldown) return;
    setIsSyncCooldown(true);
    syncModal.hide();
    router.close();

    try {
      const outcome = await syncSelectedCaption();
      if (outcome.status === "success") {
        if (outcome.warningMessage) {
          showToast(
            t("player.menus.subtitles.syncSubtitleServerFallback", {
              defaultValue:
                "Local sync does not support this audio language; synced using server.",
            }),
            "info",
          );
          return;
        }
        showToast(
          t("player.menus.subtitles.syncSubtitleSuccess", {
            defaultValue: "Subtitle synced successfully",
          }),
          "success",
        );
        return;
      }
      if (outcome.status === "cancelled") return;

      const isRateLimit =
        Boolean(outcome.errorMessage) &&
        /rate limit|too many|429/i.test(outcome.errorMessage!);
      const isServerBusy =
        Boolean(outcome.errorMessage) &&
        /capacity|busy|503/i.test(outcome.errorMessage!);

      let detail = outcome.errorMessage;
      if (isRateLimit) {
        detail = t("player.menus.subtitles.syncRateLimit");
      } else if (isServerBusy) {
        detail = t("player.menus.subtitles.syncServerBusy");
      }

      showToast(
        detail
          ? t("player.menus.subtitles.syncSubtitleFailedWithDetail", {
              defaultValue: "Could not sync subtitle: {{detail}}",
              detail,
            })
          : t("player.menus.subtitles.syncSubtitleFailed", {
              defaultValue: "Could not sync subtitle",
            }),
        "error",
      );
    } finally {
      setTimeout(() => {
        setIsSyncCooldown(false);
      }, 3000);
    }
  };

  const parsedCaptions = useMemo(
    () => tryParseCanonicalVtt(activeCaption?.vttData),
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

  // Defer rendering the full list so the popup itself opens snappily.
  const deferredFilteredItems = useDeferredValue(filteredItems);
  const isListPending = deferredFilteredItems !== filteredItems;

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
      const nextFiltered = deferredFilteredItems.find((it) => it.start > time);
      if (nextFiltered) return nextFiltered.key;

      const hasActive = deferredFilteredItems.some(
        (it) => it.key === activeKey,
      );
      if (hasActive) return activeKey;
      return null;
    }
    return nextKey ?? activeKey;
  }, [deferredFilteredItems, searchQuery, time, nextKey, activeKey]);

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

  const scrollTargetIndex = useMemo(() => {
    if (!scrollTargetKey) return -1;
    return deferredFilteredItems.findIndex((it) => it.key === scrollTargetKey);
  }, [scrollTargetKey, deferredFilteredItems]);

  const virtualizer = useVirtualizer({
    count: deferredFilteredItems.length,
    getScrollElement: () => carouselRef.current,
    estimateSize: (index) => {
      const item = deferredFilteredItems[index];
      if (!item) return 38;
      const len = item.raw.length;
      if (len > 100) return 76;
      if (len > 50) return 56;
      return 38;
    },
    getItemKey: (index) => deferredFilteredItems[index]?.key ?? index,
    overscan: 5,
  });

  const lastScrolledIndexRef = useRef(-1);

  // Autoscroll with delay to prevent clashing with menu animation
  const [didFirstScroll, setDidFirstScroll] = useState(false);
  useEffect(() => {
    if (scrollTargetIndex === -1) return;

    // Prevent scrolling repeatedly to the same target if we already scrolled to it.
    // Since virtualizer is recreated every render, we must guard this.
    if (didFirstScroll && lastScrolledIndexRef.current === scrollTargetIndex) {
      return;
    }

    if (!didFirstScroll) {
      const timeout = setTimeout(() => {
        virtualizer.scrollToIndex(scrollTargetIndex, {
          align: "center",
          behavior: "smooth",
        });
        lastScrolledIndexRef.current = scrollTargetIndex;
        setDidFirstScroll(true);
      }, 100);
      return () => clearTimeout(timeout);
    }

    virtualizer.scrollToIndex(scrollTargetIndex, {
      align: "center",
      behavior: "smooth",
    });
    lastScrolledIndexRef.current = scrollTargetIndex;
  }, [scrollTargetIndex, didFirstScroll, virtualizer]);

  const handleItemClick = (item: (typeof transcriptItems)[number]) => {
    const newDelay = getCaptionDelayForCue(item.cue, time);
    setDelay(Number(newDelay.toFixed(2)));
  };

  return (
    <>
      <Menu.BackLink
        onClick={() => router.navigate("/captions")}
        rightSide={
          canSyncSelectedCaption ? (
            <button
              type="button"
              onClick={() => syncModal.show()}
              className="mr-[-0.5rem] flex h-8 w-8 items-center justify-center rounded-md text-video-context-type-accent transition-colors hover:bg-video-context-type-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={t(
                "player.menus.subtitles.syncSubtitleOpen",
                "Sync subtitle with AI",
              )}
              title={t(
                "player.menus.subtitles.syncSubtitleOpen",
                "Sync subtitle with AI",
              )}
            >
              <Icon icon={Icons.WAND} className="text-2xl" />
            </button>
          ) : null
        }
      >
        <span className="flex min-w-0 items-center gap-2">
          {t("player.menus.subtitles.transcriptChoice")}
        </span>
      </Menu.BackLink>
      <Menu.Section>
        <Modal id={modelModal.id}>
          <ModalCard className="!max-w-md">
            <div className="space-y-5">
              <div>
                <h3 className="text-lg font-semibold text-white">
                  Tải model {modelRequest?.entry.language.toUpperCase()}?
                </h3>
                <p className="mt-1 text-sm text-video-context-type-secondary">
                  Model được lưu trong thiết bị để đồng bộ phụ đề local.
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  theme="secondary"
                  onClick={() => resolveModelRequest(false)}
                >
                  {t("actions.cancel", "Hủy")}
                </Button>
                <Button
                  theme="purple"
                  disabled={modelRequest?.downloading === true}
                  onClick={() => void handleModelDownload()}
                >
                  {modelRequest?.downloading ? "Đang tải..." : "Tải model"}
                </Button>
              </div>
            </div>
          </ModalCard>
        </Modal>
        <Modal id={syncModal.id}>
          <ModalCard className="!max-w-md">
            <div className="space-y-5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-video-context-type-accent/15 text-video-context-type-accent">
                  <Icon icon={Icons.WAND} className="text-xl" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">
                    {t("player.menus.subtitles.syncSubtitleConfirmTitle", {
                      defaultValue: "Sync subtitle with AI?",
                    })}
                  </h3>
                  <p className="mt-1 text-sm text-video-context-type-secondary">
                    {t(
                      "player.menus.subtitles.syncSubtitleConfirmDescription",
                      {
                        defaultValue:
                          "Moonshine will analyze the current stream audio and align this subtitle.",
                      },
                    )}
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                <p className="text-xs uppercase tracking-wide text-video-context-type-secondary">
                  {t("player.menus.subtitles.syncSubtitleSupportedLanguages", {
                    defaultValue: "Supported audio languages",
                  })}
                </p>
                <p className="mt-2 text-sm leading-6 text-white">
                  {MOONSHINE_AUDIO_LANGUAGES.map((language, index) => (
                    <span key={language.code}>
                      {index > 0 ? ", " : ""}
                      {language.label}
                    </span>
                  ))}
                </p>
              </div>

              <div className="flex justify-end gap-2">
                <Button theme="secondary" onClick={() => syncModal.hide()}>
                  {t("actions.cancel")}
                </Button>
                <Button
                  theme="purple"
                  onClick={() => void handleConfirmSync()}
                  disabled={!canSyncSelectedCaption}
                >
                  {t("player.menus.subtitles.syncSubtitleAction", {
                    defaultValue: "Sync",
                  })}
                </Button>
              </div>
            </div>
          </ModalCard>
        </Modal>
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
              {t("player.menus.subtitles.delayLabel", "Subtitle offset")}
              {isDualSubEnabled
                ? ` · ${t(`player.menus.subtitles.${selectionMode}`)}`
                : ""}
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
        <div
          className={classNames(
            "transition-opacity duration-150 relative w-full",
            {
              "opacity-50": isListPending,
            },
          )}
          style={{ height: `${virtualizer.getTotalSize()}px` }}
        >
          {activeCaption ? (
            virtualizer.getVirtualItems().map((virtualItem) => {
              const item = deferredFilteredItems[virtualItem.index];
              if (!item) return null;

              const html = sanitize(item.raw.replaceAll(/\r?\n/g, "<br />"), {
                ALLOWED_TAGS: ["c", "b", "i", "u", "span", "ruby", "rt", "br"],
                ADD_TAGS: ["v", "lang"],
                ALLOWED_ATTR: ["title", "lang"],
              });

              const isActive = activeKey === item.key;

              return (
                <div
                  key={virtualItem.key}
                  data-que-id={item.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  className="absolute top-0 left-0 w-full pb-1"
                  style={{
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => handleItemClick(item)}
                    data-active-link={isActive ? true : undefined}
                    className={classNames(
                      "group flex w-full items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors duration-150 tabbable",
                      isActive
                        ? "bg-video-context-light/20 text-white shadow-sm"
                        : "text-video-context-type-main hover:bg-white/10 hover:text-white",
                    )}
                  >
                    <span
                      className={classNames(
                        "flex-none h-6 px-1.5 flex items-center justify-center rounded text-xs font-mono whitespace-nowrap transition-colors",
                        isActive
                          ? "bg-white/20 text-white font-semibold"
                          : "bg-video-context-light/20 text-video-context-type-secondary group-hover:text-white group-hover:bg-white/15",
                        showHours ? "min-w-[4.25rem]" : "min-w-[3.25rem]",
                      )}
                    >
                      {item.start < 0 || !Number.isFinite(item.start)
                        ? "N/A"
                        : formatSeconds(item.start, showHours)}
                    </span>
                    <span
                      className={
                        isActive
                          ? "flex-1 min-w-0 break-words text-white font-semibold text-sm leading-snug py-0.5"
                          : "flex-1 min-w-0 break-words text-video-context-type-main text-sm leading-snug py-0.5 hover:text-white transition-colors"
                      }
                    >
                      <span
                        dangerouslySetInnerHTML={{ __html: html }}
                        dir="ltr"
                      />
                    </span>
                  </button>
                </div>
              );
            })
          ) : (
            <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-video-context-type-secondary w-full">
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
