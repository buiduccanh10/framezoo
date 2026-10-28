import { useCallback, useEffect, useRef, useState } from "react";

import { Icon, Icons } from "@/components/Icon";
import {
  makePercentage,
  makePercentageString,
  useProgressBar,
} from "@/hooks/useProgressBar";
import { usePlayerStore } from "@/stores/player/store";
import { canChangeVolume } from "@/utils/detectFeatures";

import { useVolume } from "../hooks/useVolume";

interface Props {
  className?: string;
  iconSizeClass?: string;
  buttonClassName?: string;
}

const MAX_VOLUME = 2;

export function Volume(props: Props) {
  const ref = useRef<HTMLDivElement>(null!);
  const setHovering = usePlayerStore((s) => s.setHoveringLeftControls);
  const hovering = usePlayerStore((s) => s.interface.leftControlHovering);
  const volume = usePlayerStore((s) => s.mediaPlaying.volume);
  const { setVolume, toggleMute } = useVolume();

  const lastRaf = useRef<number | null>(null);
  const [isWheeling, setIsWheeling] = useState(false);
  const wheelTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (lastRaf.current !== null) {
        cancelAnimationFrame(lastRaf.current);
      }
      if (wheelTimeout.current !== null) {
        clearTimeout(wheelTimeout.current);
      }
    };
  }, []);

  const commitVolume = useCallback(
    (pos: number) => {
      const nextVol = Math.max(0, Math.min(MAX_VOLUME, pos * MAX_VOLUME));
      const rounded = Math.round(nextVol * 100) / 100;
      if (lastRaf.current !== null) {
        cancelAnimationFrame(lastRaf.current);
      }
      lastRaf.current = requestAnimationFrame(() => {
        setVolume(rounded);
        lastRaf.current = null;
      });
    },
    [setVolume],
  );

  const { dragging, dragPercentage, dragMouseDown } = useProgressBar(
    ref,
    commitVolume,
    true,
  );

  const handleClick = useCallback(() => {
    if (!hovering) {
      setHovering(true);
      return;
    }
    toggleMute();
  }, [hovering, setHovering, toggleMute]);

  const handleMouseEnter = useCallback(async () => {
    if (await canChangeVolume()) setHovering(true);
    document.body.classList.add("overflow-y-hidden");
  }, [setHovering]);

  const handleMouseLeave = () => {
    document.body.classList.remove("overflow-y-hidden");
  };

  let percentage = (volume / MAX_VOLUME) * 100;
  if (dragging) percentage = dragPercentage;
  const percentageString = makePercentageString(makePercentage(percentage));

  const currentVolume = dragging
    ? Math.max(0, Math.min(MAX_VOLUME, (dragPercentage / 100) * MAX_VOLUME))
    : volume;
  const volumePercentage = Math.round(currentVolume * 100);
  const showTooltip = dragging || isWheeling;

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      event.preventDefault();
      let newVolume = volume - event.deltaY / 1000;
      newVolume = Math.max(0, Math.min(MAX_VOLUME, newVolume));
      setVolume(Math.round(newVolume * 100) / 100);
      setIsWheeling(true);
      if (wheelTimeout.current !== null) {
        clearTimeout(wheelTimeout.current);
      }
      wheelTimeout.current = setTimeout(() => {
        setIsWheeling(false);
        wheelTimeout.current = null;
      }, 800);
    },
    [volume, setVolume],
  );

  const getVolumeIcon = (volumeLevel: number) => {
    if (volumeLevel === 0) {
      return Icons.VOLUME_X;
    }
    if (volumeLevel > 0 && volumeLevel <= 0.33) {
      return Icons.VOLUME_LOW;
    }
    if (volumeLevel > 0.33 && volumeLevel <= 0.66) {
      return Icons.VOLUME_MED;
    }
    return Icons.VOLUME;
  };

  return (
    <div
      className={props.className}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onWheel={handleWheel}
    >
      <div className="pointer-events-auto flex cursor-pointer items-center py-0 touch-none">
        <div
          className={`${props.buttonClassName ?? "p-3"} text-white ${props.iconSizeClass ?? "text-[32px]"}`}
          onClick={handleClick}
        >
          <Icon icon={getVolumeIcon(volume / MAX_VOLUME)} />
        </div>
        <div
          className={`linear -ml-2 w-0 transition-[width,opacity] duration-300 ${
            hovering || dragging
              ? "!w-28 opacity-100 overflow-visible"
              : "w-4 opacity-0 overflow-hidden"
          }`}
        >
          <div
            ref={ref}
            className="flex h-10 w-24 items-center px-2"
            onMouseDown={dragMouseDown}
            onTouchStart={dragMouseDown}
          >
            <div className="relative h-1.5 flex-1 rounded-full bg-gray-500/50">
              <div
                className="absolute inset-y-0 left-0 flex items-center justify-end rounded-full bg-video-audio-set"
                style={{
                  width: percentageString,
                }}
              >
                <div className="absolute right-0 top-1/2 flex -translate-y-1/2 translate-x-1/2 items-center justify-center">
                  <div className="h-4 w-4 rounded-full bg-white shadow" />
                  {showTooltip && (
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 select-none whitespace-nowrap rounded bg-black/90 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white shadow-lg">
                      {volumePercentage}%
                      <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 border-x-4 border-t-4 border-x-transparent border-t-black/90" />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
