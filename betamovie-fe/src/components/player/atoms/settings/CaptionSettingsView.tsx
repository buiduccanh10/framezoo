import classNames from "classnames";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/buttons/Button";
import { Toggle } from "@/components/buttons/Toggle";
import { Dropdown } from "@/components/form/Dropdown";
import { Icon, Icons } from "@/components/Icon";
import { Menu } from "@/components/player/internals/ContextMenu";
import {
  type CaptionCueType,
  captionHtml,
  captionPlainText,
  getCaptionCueForNavigation,
  getCaptionDelayForCue,
  getCaptionTimelineIndex,
  getCaptionTimelineWindow,
  parseCanonicalVtt,
} from "@/components/player/utils/captions";
import { useOverlayRouter } from "@/hooks/useOverlayRouter";
import { useProgressBar } from "@/hooks/useProgressBar";
import { usePlayerStore } from "@/stores/player/store";
import {
  DEFAULT_SUBTITLE_STYLING,
  SubtitleStyling,
  useSubtitleStore,
} from "@/stores/subtitles";
import { durationExceedsHour, formatSeconds } from "@/utils/formatSeconds";

const VISIBLE_CUE_COUNT = 13;
const CUE_SWIPE_THRESHOLD = 32;

export function ColorOption(props: {
  color: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={classNames(
        "tabbable p-1.5 bg-video-context-buttonFocus rounded transition-colors duration-100",
        props.active ? "bg-opacity-100" : "bg-opacity-0 cursor-pointer",
      )}
      onClick={props.onClick}
    >
      <div
        className="w-6 h-6 rounded-full flex justify-center items-center"
        style={{ backgroundColor: props.color }}
      >
        {props.active ? (
          <Icon className="text-sm text-black" icon={Icons.CHECKMARK} />
        ) : null}
      </div>
    </button>
  );
}

export function SubtitleCueTimeline(props: {
  label: string;
  hint: string;
  emptyLabel: string;
  cues: CaptionCueType[];
  delay: number;
  videoTime: number;
  onSelectCue: (cue: CaptionCueType) => void;
  onReset: () => void;
}) {
  const activeIndex = useMemo(
    () => getCaptionTimelineIndex(props.cues, props.delay, props.videoTime),
    [props.cues, props.delay, props.videoTime],
  );
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressMarkerClickRef = useRef(false);
  const wheelDeltaRef = useRef(0);
  const wheelResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const handleNav = useCallback(
    (direction: -1 | 1) => {
      if (activeIndex === null) return;
      const cue = getCaptionCueForNavigation(
        props.cues,
        props.delay,
        props.videoTime,
        direction,
      );
      if (!cue) return;
      props.onSelectCue(cue);
    },
    [activeIndex, props],
  );

  const handleSelectCueAtIndex = useCallback(
    (cueIndex: number) => {
      if (suppressMarkerClickRef.current) {
        suppressMarkerClickRef.current = false;
        return;
      }
      if (cueIndex < 0 || cueIndex >= props.cues.length) return;
      props.onSelectCue(props.cues[cueIndex]);
    },
    [props],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;

      pointerStartRef.current = {
        x: event.clientX,
        y: event.clientY,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const start = pointerStartRef.current;
      pointerStartRef.current = null;
      if (!start) return;

      const deltaX = event.clientX - start.x;
      const deltaY = event.clientY - start.y;
      if (
        Math.abs(deltaX) < CUE_SWIPE_THRESHOLD ||
        Math.abs(deltaX) <= Math.abs(deltaY)
      ) {
        return;
      }

      event.preventDefault();
      suppressMarkerClickRef.current = true;
      handleNav(deltaX < 0 ? 1 : -1);
      window.setTimeout(() => {
        suppressMarkerClickRef.current = false;
      }, 350);
    },
    [handleNav],
  );

  const handlePointerCancel = useCallback(() => {
    pointerStartRef.current = null;
  }, []);

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;

      event.preventDefault();
      wheelDeltaRef.current += event.deltaX;
      if (Math.abs(wheelDeltaRef.current) < CUE_SWIPE_THRESHOLD) return;

      const direction = wheelDeltaRef.current > 0 ? 1 : -1;
      wheelDeltaRef.current = 0;
      handleNav(direction);

      if (wheelResetTimeoutRef.current) {
        clearTimeout(wheelResetTimeoutRef.current);
      }
      wheelResetTimeoutRef.current = setTimeout(() => {
        wheelDeltaRef.current = 0;
        wheelResetTimeoutRef.current = null;
      }, 150);
    },
    [handleNav],
  );

  useEffect(() => {
    return () => {
      if (wheelResetTimeoutRef.current) {
        clearTimeout(wheelResetTimeoutRef.current);
      }
    };
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    handleNav(event.key === "ArrowLeft" ? -1 : 1);
  };

  const onReset = props.onReset;
  const handleReset = useCallback(() => {
    onReset();
  }, [onReset]);

  // Keep the active cue centered while showing six cues on either side.
  const renderRadius = Math.floor(VISIBLE_CUE_COUNT / 2);
  const { start: renderStart, end: renderEnd } = getCaptionTimelineWindow(
    activeIndex,
    props.cues.length,
    renderRadius,
  );

  const previewCue = activeIndex !== null ? props.cues[activeIndex] : undefined;

  if (props.cues.length === 0) {
    return (
      <div>
        <Menu.FieldTitle>{props.label}</Menu.FieldTitle>
        <p className="mt-1 text-xs text-video-context-type-secondary">
          {props.hint}
        </p>
        <div className="mt-3 rounded-lg bg-video-context-light bg-opacity-10 px-3 py-4 text-center text-sm text-video-context-type-secondary">
          {props.emptyLabel}
        </div>
      </div>
    );
  }

  return (
    <div>
      <Menu.FieldTitle>{props.label}</Menu.FieldTitle>
      <p className="mt-1 text-xs text-video-context-type-secondary">
        {props.hint}
      </p>

      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="subtitle-cue-previous"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-video-context-light bg-opacity-10 text-video-context-type-primary transition-colors hover:bg-opacity-20 disabled:opacity-50"
          onClick={() => handleNav(-1)}
          disabled={activeIndex === null || activeIndex <= 0}
        >
          <Icon icon={Icons.CHEVRON_LEFT} />
        </button>

        {/* Viewport — only shows VISIBLE_CUE_COUNT markers */}
        <div
          role="group"
          tabIndex={0}
          aria-label={props.label}
          onKeyDown={handleKeyDown}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onWheel={handleWheel}
          className="relative h-14 flex-1 touch-none select-none overflow-hidden cursor-grab outline-none active:cursor-grabbing"
        >
          {/* Background track line */}
          <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-video-context-slider bg-opacity-25" />

          {/* Markers — each positioned relative to activeIndex at center */}
          {props.cues.slice(renderStart, renderEnd).map((cue, i) => {
            const cueIndex = renderStart + i;
            const isActive = cueIndex === activeIndex;
            const plainText = captionPlainText(cue.content);
            // activeIndex sits at 50%, each step is 100/VISIBLE_CUE_COUNT wide
            const offset = cueIndex - (activeIndex ?? 0);
            const left = 50 + offset * (100 / VISIBLE_CUE_COUNT);

            return (
              <button
                key={`cue-${cueIndex}`}
                type="button"
                data-testid={`subtitle-cue-marker-${cueIndex}`}
                title={plainText}
                aria-label={plainText}
                aria-current={isActive ? "true" : undefined}
                onClick={() => handleSelectCueAtIndex(cueIndex)}
                className="absolute top-1/2 flex h-10 w-3 -translate-x-1/2 -translate-y-1/2 items-center justify-center transition-[left] duration-300 ease-in-out"
                style={{ left: `${left}%` }}
              >
                <span
                  className={classNames(
                    "h-6 rounded-full transition-all duration-150",
                    isActive
                      ? "w-1.5 bg-video-context-sliderFilled"
                      : "w-1 bg-video-context-slider",
                  )}
                />
              </button>
            );
          })}
        </div>

        <button
          type="button"
          data-testid="subtitle-cue-next"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-video-context-light bg-opacity-10 text-video-context-type-primary transition-colors hover:bg-opacity-20 disabled:opacity-50"
          onClick={() => handleNav(1)}
          disabled={
            activeIndex === null || activeIndex >= props.cues.length - 1
          }
        >
          <Icon icon={Icons.CHEVRON_RIGHT} />
        </button>

        <button
          type="button"
          data-testid="subtitle-cue-reset"
          aria-label={props.label}
          title={props.label}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-video-context-light bg-opacity-10 text-video-context-type-primary transition-colors hover:bg-opacity-20 disabled:opacity-50"
          onClick={handleReset}
          disabled={props.delay === 0}
        >
          <Icon icon={Icons.RELOAD} />
        </button>
      </div>

      <div className="rounded-xl bg-video-context-light bg-opacity-10 p-3 text-center">
        {previewCue ? (
          <div
            data-testid="subtitle-cue-preview-time"
            className="mb-1 text-xs text-video-context-type-secondary"
          >
            {formatSeconds(
              previewCue.start / 1000,
              durationExceedsHour(previewCue.start / 1000),
            )}
          </div>
        ) : null}
        <div
          className="min-h-[3rem] text-base font-medium"
          dangerouslySetInnerHTML={{
            __html: captionHtml(previewCue?.content),
          }}
        />
      </div>
    </div>
  );
}

export function CaptionSetting(props: {
  textTransformer?: (s: string) => string;
  value: number;
  onChange?: (val: number) => void;
  max: number;
  label: string;
  min: number;
  decimalsAllowed?: number;
  controlButtons?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const currentPercentage = (props.value - props.min) / (props.max - props.min);
  const commit = useCallback(
    (percentage: number) => {
      const range = props.max - props.min;
      const newPercentage = Math.min(Math.max(percentage, 0), 1);
      props.onChange?.(props.min + range * newPercentage);
    },
    [props],
  );

  const { dragging, dragPercentage, dragMouseDown } = useProgressBar(
    ref,
    commit,
    true,
  );

  const [isFocused, setIsFocused] = useState(false);
  const [inputValue, setInputValue] = useState("");

  useEffect(() => {
    function listener(e: KeyboardEvent) {
      if (e.key === "Enter" && isFocused) {
        inputRef.current?.blur();
      }
    }
    window.addEventListener("keydown", listener);
    return () => {
      window.removeEventListener("keydown", listener);
    };
  }, [isFocused]);

  const inputClasses = `tabbable py-1 bg-video-context-inputBg rounded text-white cursor-text ${
    props.controlButtons ? "text-center px-4 w-24" : "px-3 text-left w-20"
  }`;
  const arrowButtonClasses =
    "tabbable hover:text-white transition-colors duration-100 w-full h-full flex justify-center items-center hover:bg-video-context-buttonOverInputHover rounded";
  const textTransformer = props.textTransformer ?? ((s) => s);

  return (
    <div>
      <Menu.FieldTitle>{props.label}</Menu.FieldTitle>
      <div className="grid items-center grid-cols-[1fr,auto] gap-4">
        <div ref={ref}>
          <div
            className="group/progress w-full h-8 flex items-center cursor-pointer"
            onMouseDown={dragMouseDown}
            onTouchStart={dragMouseDown}
          >
            <div
              dir="ltr"
              className={[
                "relative w-full h-1 bg-video-context-slider bg-opacity-25 rounded-full transition-[height] duration-100 group-hover/progress:h-1.5",
                dragging ? "!h-1.5" : "",
              ].join(" ")}
            >
              {/* Actual progress bar */}
              <div
                className="absolute top-0 left-0 h-full rounded-full bg-video-context-sliderFilled flex justify-end items-center"
                style={{
                  width: `${
                    Math.max(
                      0,
                      Math.min(
                        1,
                        dragging ? dragPercentage / 100 : currentPercentage,
                      ),
                    ) * 100
                  }%`,
                }}
              >
                <div
                  className={[
                    "w-[1rem] min-w-[1rem] h-[1rem] border-[4px] border-video-context-sliderFilled rounded-full transform translate-x-1/2 bg-white transition-[transform] duration-100",
                  ].join(" ")}
                />
              </div>
            </div>
          </div>
        </div>
        <div>
          {isFocused ? (
            <input
              className={inputClasses}
              value={inputValue}
              autoFocus
              onFocus={(e) => {
                (e.target as HTMLInputElement).select();
              }}
              onBlur={(e) => {
                setIsFocused(false);
                const num = Number((e.target as HTMLInputElement).value);
                if (!Number.isNaN(num))
                  props.onChange?.(
                    (props.decimalsAllowed ?? 0) === 0 ? Math.round(num) : num,
                  );
              }}
              ref={inputRef}
              onChange={(e) =>
                setInputValue((e.target as HTMLInputElement).value)
              }
            />
          ) : (
            <div
              className="relative"
              onClick={(evt) => {
                if ((evt.target as HTMLButtonElement).closest(".actions"))
                  return;

                setInputValue(props.value.toFixed(props.decimalsAllowed ?? 0));
                setIsFocused(true);
              }}
            >
              <button
                className={classNames(
                  inputClasses,
                  props.controlButtons ? "relative" : undefined,
                )}
                type="button"
                tabIndex={0}
              >
                {textTransformer(
                  props.value.toFixed(props.decimalsAllowed ?? 0),
                )}
              </button>
              {props.controlButtons ? (
                <>
                  <div className="actions w-6 h-full absolute left-0 top-0 grid grid-cols-1 items-center justify-center">
                    <button
                      type="button"
                      onClick={
                        () =>
                          props.onChange?.(
                            props.value -
                              1 / 10 ** (props.decimalsAllowed ?? 0),
                          ) // Remove depending on the decimalsAllowed. If there's 1 decimal allowed, add 0.1. For 2, add 0.01, etc.
                      }
                      className={arrowButtonClasses}
                    >
                      <Icon icon={Icons.CHEVRON_LEFT} />
                    </button>
                  </div>
                  <div className="actions w-6 h-full absolute right-0 top-0 grid grid-cols-1 items-center justify-center">
                    <button
                      type="button"
                      onClick={
                        () =>
                          props.onChange?.(
                            props.value +
                              1 / 10 ** (props.decimalsAllowed ?? 0),
                          ) // Add depending on the decimalsAllowed. If there's 1 decimal allowed, add 0.1. For 2, add 0.01, etc.
                      }
                      className={arrowButtonClasses}
                    >
                      <Icon icon={Icons.CHEVRON_RIGHT} />
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export const colors = ["#ffffff", "#80b1fa", "#e2e535", "#10B239FF"];

export function CaptionSettingsView({
  id,
  overlayBackLink,
}: {
  id: string;
  overlayBackLink?: boolean;
}) {
  const { t } = useTranslation();
  const router = useOverlayRouter(id);
  const subtitleStore = useSubtitleStore();

  const styling = subtitleStore.styling;
  const overrideCasing = subtitleStore.overrideCasing;
  const delay = subtitleStore.delay;
  const setOverrideCasing = subtitleStore.setOverrideCasing;
  const setDelay = subtitleStore.setDelay;
  const updateStyling = subtitleStore.updateStyling;
  const selectedCaption = usePlayerStore((s) => s.caption.selected);
  const vttData = usePlayerStore((s) => s.caption.selected?.vttData);
  const videoTime = usePlayerStore((s) => s.progress.time);

  useEffect(() => {
    subtitleStore.updateStyling(styling);
  }, [styling, subtitleStore]);

  const handleStylingChange = (newStyling: SubtitleStyling) => {
    updateStyling(newStyling);
  };

  const parsedCaptions = useMemo(() => {
    if (!vttData || !selectedCaption) return [];
    try {
      return parseCanonicalVtt(vttData);
    } catch {
      return [];
    }
  }, [vttData, selectedCaption]);

  const handleSelectCue = useCallback(
    (cue: CaptionCueType) => {
      setDelay(getCaptionDelayForCue(cue, videoTime));
    },
    [setDelay, videoTime],
  );

  const handleResetTimeline = useCallback(() => {
    setDelay(0);
  }, [setDelay]);

  const resetSubStyling = () => {
    subtitleStore.updateStyling(DEFAULT_SUBTITLE_STYLING);
  };

  return (
    <>
      <Menu.BackLink
        onClick={() =>
          router.navigate(overlayBackLink ? "/captionsOverlay" : "/captions")
        }
      >
        {t("player.menus.subtitles.settings.backlink")}
      </Menu.BackLink>
      <Menu.Section className="space-y-6 pb-5">
        <>
          <SubtitleCueTimeline
            label={t("player.menus.subtitles.settings.timeline")}
            hint={t("player.menus.subtitles.settings.timelineHint")}
            emptyLabel={t("player.menus.subtitles.settings.timelineEmpty")}
            cues={parsedCaptions}
            delay={delay}
            videoTime={videoTime}
            onSelectCue={handleSelectCue}
            onReset={handleResetTimeline}
          />
          <div className="flex justify-between items-center">
            <Menu.FieldTitle>
              {t("player.menus.subtitles.settings.fixCapitals")}
            </Menu.FieldTitle>
            <div className="flex justify-center items-center">
              <Toggle
                enabled={overrideCasing}
                onClick={() => setOverrideCasing(!overrideCasing)}
              />
            </div>
          </div>
          <Menu.Divider />
          <CaptionSetting
            label={t("settings.subtitles.backgroundLabel")}
            max={100}
            min={0}
            onChange={(v) =>
              handleStylingChange({ ...styling, backgroundOpacity: v / 100 })
            }
            value={styling.backgroundOpacity * 100}
            textTransformer={(s) => `${s}%`}
          />
          <div className="flex justify-between items-center">
            <Menu.FieldTitle>
              {t("settings.subtitles.backgroundBlurEnabledLabel")}
            </Menu.FieldTitle>
            <div className="flex justify-center items-center">
              <Toggle
                enabled={styling.backgroundBlurEnabled}
                onClick={() =>
                  handleStylingChange({
                    ...styling,
                    backgroundBlurEnabled: !styling.backgroundBlurEnabled,
                  })
                }
              />
            </div>
          </div>
          <span className="text-xs text-type-secondary">
            {t("settings.subtitles.backgroundBlurEnabledDescription")}
          </span>
          {styling.backgroundBlurEnabled && (
            <CaptionSetting
              label={t("settings.subtitles.backgroundBlurLabel")}
              max={100}
              min={0}
              onChange={(v) =>
                handleStylingChange({ ...styling, backgroundBlur: v / 100 })
              }
              value={styling.backgroundBlur * 100}
              textTransformer={(s) => `${s}%`}
            />
          )}
          <CaptionSetting
            label={t("settings.subtitles.textSizeLabel")}
            max={200}
            min={1}
            textTransformer={(s) => `${s}%`}
            onChange={(v) => handleStylingChange({ ...styling, size: v / 100 })}
            value={styling.size * 100}
          />
          <div className="flex justify-between items-center">
            <Menu.FieldTitle>
              {t("settings.subtitles.textStyle.title") || "Font Style"}
            </Menu.FieldTitle>
            <Dropdown
              options={[
                {
                  id: "default",
                  name: t("settings.subtitles.textStyle.default"),
                },
                {
                  id: "raised",
                  name: t("settings.subtitles.textStyle.raised"),
                },
                {
                  id: "depressed",
                  name: t("settings.subtitles.textStyle.depressed"),
                },
                {
                  id: "Border",
                  name: t("settings.subtitles.textStyle.Border"),
                },
                {
                  id: "dropShadow",
                  name: t("settings.subtitles.textStyle.dropShadow"),
                },
              ]}
              selectedItem={{
                id: styling.fontStyle,
                name:
                  t(`settings.subtitles.textStyle.${styling.fontStyle}`) ||
                  styling.fontStyle,
              }}
              setSelectedItem={(item) =>
                handleStylingChange({
                  ...styling,
                  fontStyle: item.id,
                })
              }
            />
          </div>
          {styling.fontStyle === "Border" && (
            <CaptionSetting
              label={t("settings.subtitles.BorderThicknessLabel")}
              max={10}
              min={0}
              onChange={(v) =>
                handleStylingChange({ ...styling, borderThickness: v })
              }
              value={styling.borderThickness}
              textTransformer={(s) => `${s}px`}
              decimalsAllowed={1}
            />
          )}
          <div className="flex justify-between items-center">
            <Menu.FieldTitle>
              {t("settings.subtitles.textBoldLabel")}
            </Menu.FieldTitle>
            <div className="flex justify-center items-center">
              <Toggle
                enabled={styling.bold}
                onClick={() =>
                  handleStylingChange({ ...styling, bold: !styling.bold })
                }
              />
            </div>
          </div>
          <div className="flex justify-between items-center">
            <Menu.FieldTitle>
              {t("settings.subtitles.colorLabel")}
            </Menu.FieldTitle>
            <div className="flex justify-center items-center space-x-2">
              {colors.map((color) => (
                <ColorOption
                  key={color}
                  color={color}
                  active={styling.color === color}
                  onClick={() => handleStylingChange({ ...styling, color })}
                />
              ))}
              <div className="relative inline-block">
                <input
                  type="color"
                  value={styling.color}
                  onChange={(e) => {
                    const color = e.target.value;
                    handleStylingChange({ ...styling, color });
                  }}
                  className="absolute opacity-0 cursor-pointer w-10 h-10"
                />
                <div style={{ color: styling.color }}>
                  <Icon icon={Icons.BRUSH} className="text-2xl" />
                </div>
              </div>
            </div>
          </div>
          <div className="flex justify-between items-center">
            <Menu.FieldTitle>
              {t("settings.subtitles.verticalPositionLabel")}
            </Menu.FieldTitle>
            <div className="flex justify-center items-center space-x-2">
              <button
                type="button"
                className={classNames(
                  "px-3 py-1 rounded transition-colors duration-100",
                  styling.verticalPosition === 1
                    ? "bg-video-context-buttonFocus"
                    : "bg-video-context-buttonFocus bg-opacity-0 hover:bg-opacity-50",
                )}
                onClick={() =>
                  handleStylingChange({
                    ...styling,
                    verticalPosition: 1,
                  })
                }
              >
                {t("settings.subtitles.low")}
              </button>
              <button
                type="button"
                className={classNames(
                  "px-3 py-1 rounded transition-colors duration-100",
                  styling.verticalPosition === 3
                    ? "bg-video-context-buttonFocus"
                    : "bg-video-context-buttonFocus bg-opacity-0 hover:bg-opacity-50",
                )}
                onClick={() =>
                  handleStylingChange({
                    ...styling,
                    verticalPosition: 3,
                  })
                }
              >
                {t("settings.subtitles.high")}
              </button>
            </div>
          </div>
          <Button
            className="w-full md:w-auto"
            theme="secondary"
            onClick={resetSubStyling}
          >
            {t("settings.reset")}
          </Button>
        </>
      </Menu.Section>
    </>
  );
}
