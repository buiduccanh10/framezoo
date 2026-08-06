import classNames from "classnames";
import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { Toggle } from "@/components/buttons/Toggle";
import { Menu } from "@/components/player/internals/ContextMenu";
import { useOverlayRouter } from "@/hooks/useOverlayRouter";
import { useProgressBar } from "@/hooks/useProgressBar";
import { usePlayerStore } from "@/stores/player/store";
import { useWatchPartyStore } from "@/stores/watchParty";
import { isAutoplayAllowed } from "@/utils/autoplay";

const MIN_PLAYBACK_SPEED = 0.25;
const MAX_PLAYBACK_SPEED = 3;
const PLAYBACK_SPEED_STEP = 0.05;
const QUICK_PLAYBACK_SPEED_OPTIONS = [1, 1.25, 1.5, 2, 3];

function clampPlaybackSpeed(speed: number) {
  const snapped = Math.round(speed / PLAYBACK_SPEED_STEP) * PLAYBACK_SPEED_STEP;
  return Math.min(
    MAX_PLAYBACK_SPEED,
    Math.max(MIN_PLAYBACK_SPEED, Number(snapped.toFixed(2))),
  );
}

function formatPlaybackSpeed(speed: number) {
  return `${speed.toFixed(2)}x`;
}

function PlaybackSpeedControl(props: {
  selected: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const sliderRef = useRef<HTMLDivElement>(null);
  const speedRange = MAX_PLAYBACK_SPEED - MIN_PLAYBACK_SPEED;
  const normalizedSelected =
    (clampPlaybackSpeed(props.selected) - MIN_PLAYBACK_SPEED) / speedRange;

  const commitSlider = useCallback(
    (percentage: number) => {
      if (props.disabled) return;
      props.onChange(
        clampPlaybackSpeed(MIN_PLAYBACK_SPEED + speedRange * percentage),
      );
    },
    [props, speedRange],
  );

  const { dragging, dragPercentage, dragMouseDown } = useProgressBar(
    sliderRef,
    commitSlider,
    true,
  );

  const currentRate = dragging
    ? clampPlaybackSpeed(
        MIN_PLAYBACK_SPEED + speedRange * (dragPercentage / 100),
      )
    : clampPlaybackSpeed(props.selected);

  return (
    <div className="space-y-4">
      <div className="text-center font-semibold text-3xl text-white tracking-tight">
        {formatPlaybackSpeed(currentRate).toUpperCase()}
      </div>

      <div className="grid grid-cols-[auto,1fr,auto] items-center gap-3">
        <button
          type="button"
          disabled={props.disabled}
          onClick={() =>
            props.onChange(
              clampPlaybackSpeed(props.selected - PLAYBACK_SPEED_STEP),
            )
          }
          className={classNames(
            "tabbable w-12 h-12 rounded-full bg-white/15 text-2xl leading-none flex items-center justify-center text-white",
            props.disabled
              ? "opacity-50 cursor-not-allowed"
              : "hover:bg-white/25",
          )}
        >
          -
        </button>

        <div ref={sliderRef}>
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
              <div
                className="absolute top-0 left-0 h-full rounded-full bg-video-context-sliderFilled flex justify-end items-center"
                style={{
                  width: `${Math.max(0, Math.min(1, dragging ? dragPercentage / 100 : normalizedSelected)) * 100}%`,
                }}
              >
                <div className="w-[1rem] min-w-[1rem] h-[1rem] border-[4px] border-video-context-sliderFilled rounded-full transform translate-x-1/2 bg-white transition-[transform] duration-100" />
              </div>
            </div>
          </div>
        </div>

        <button
          type="button"
          disabled={props.disabled}
          onClick={() =>
            props.onChange(
              clampPlaybackSpeed(props.selected + PLAYBACK_SPEED_STEP),
            )
          }
          className={classNames(
            "tabbable w-12 h-12 rounded-full bg-white/15 text-2xl leading-none flex items-center justify-center text-white",
            props.disabled
              ? "opacity-50 cursor-not-allowed"
              : "hover:bg-white/25",
          )}
        >
          +
        </button>
      </div>

      <div className="grid grid-cols-5 gap-2">
        {QUICK_PLAYBACK_SPEED_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            disabled={props.disabled}
            onClick={() => props.onChange(option)}
            className={classNames(
              "tabbable px-2 py-2 rounded-full text-sm text-white/90 bg-video-context-light/10 transition-colors",
              Math.abs(props.selected - option) < PLAYBACK_SPEED_STEP / 2
                ? "bg-video-context-light/30 text-white"
                : "hover:bg-video-context-light/20",
              props.disabled ? "opacity-50 cursor-not-allowed" : null,
            )}
          >
            {option.toLocaleString("vi-VN", {
              minimumFractionDigits: option % 1 === 0 ? 1 : 2,
              maximumFractionDigits: 2,
            })}
            x
          </button>
        ))}
      </div>
    </div>
  );
}

export function PlaybackSettingsView({ id }: { id: string }) {
  const { t } = useTranslation();
  const router = useOverlayRouter(id);
  const playbackRate = usePlayerStore((s) => s.mediaPlaying.playbackRate);
  const display = usePlayerStore((s) => s.display);
  // const enableThumbnails = usePreferencesStore((s) => s.enableThumbnails);
  // const setEnableThumbnails = usePreferencesStore((s) => s.setEnableThumbnails);
  const isInWatchParty = useWatchPartyStore((s) => s.enabled);

  const autoplayEnabled = isAutoplayAllowed();
  const canShowAutoplay = !isInWatchParty;

  const setPlaybackRate = useCallback(
    (v: number) => {
      if (isInWatchParty) return; // Don't allow changes in watch party
      display?.setPlaybackRate(clampPlaybackSpeed(v));
    },
    [display, isInWatchParty],
  );

  // Force 1x speed in watch party
  useEffect(() => {
    if (isInWatchParty && display && playbackRate !== 1) {
      display.setPlaybackRate(1);
    }
  }, [isInWatchParty, display, playbackRate]);

  return (
    <>
      <Menu.BackLink onClick={() => router.navigate("/")}>
        {t("player.menus.playback.title")}
      </Menu.BackLink>
      <Menu.Section>
        <div className="space-y-4 mt-3">
          <Menu.FieldTitle>
            {t("player.menus.playback.speedLabel")}
            {isInWatchParty && (
              <span className="text-sm text-type-secondary ml-2">
                {t("player.menus.playback.disabled")}
              </span>
            )}
          </Menu.FieldTitle>
          <PlaybackSpeedControl
            selected={isInWatchParty ? 1 : playbackRate}
            onChange={setPlaybackRate}
            disabled={isInWatchParty}
          />
        </div>
      </Menu.Section>
      <Menu.Section>
        <div className="space-y-4 mt-3">
          {canShowAutoplay && (
            <Menu.Link rightSide={<Toggle enabled={autoplayEnabled} />}>
              {t("settings.preferences.autoplayLabel")}
            </Menu.Link>
          )}
        </div>
      </Menu.Section>
    </>
  );
}
