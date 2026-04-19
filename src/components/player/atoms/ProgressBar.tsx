import {
  MouseEvent,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  getSegmentBoundsSeconds,
  useSkipTime,
} from "@/components/player/hooks/useSkipTime";
import { LazyImage } from "@/components/utils/Image";
import { useProgressBar } from "@/hooks/useProgressBar";
import {
  ThumbnailImage,
  nearestImageAt,
} from "@/stores/player/slices/thumbnails";
import { usePlayerStore } from "@/stores/player/store";
import { durationExceedsHour, formatSeconds } from "@/utils/formatSeconds";

const SEGMENT_COLORS: Record<
  "intro" | "recap" | "credits" | "preview",
  string
> = {
  intro: "rgba(99, 102, 241, 0.75)", // indigo
  recap: "rgba(245, 158, 11, 0.75)", // amber
  credits: "rgba(34, 197, 94, 0.75)", // green
  preview: "rgba(234, 179, 8, 0.75)", // yellow
};

function ThumbnailPreview(props: { thumbnail: ThumbnailImage }) {
  if (props.thumbnail.data) {
    return (
      <LazyImage
        src={props.thumbnail.data}
        alt=""
        className="h-24 border rounded-xl border-gray-800 no-fade"
        showSkeleton={false}
        loading="eager"
        decoding="sync"
      />
    );
  }

  if (props.thumbnail.sprite) {
    const { sprite } = props.thumbnail;
    const scale = 96 / sprite.height;
    const width = Math.max(1, Math.round(sprite.width * scale));

    return (
      <div
        className="border rounded-xl border-gray-800 overflow-hidden bg-black"
        style={{
          width,
          height: 96,
        }}
      >
        <img
          src={sprite.url}
          alt=""
          className="block max-w-none no-fade pointer-events-none select-none"
          style={{
            transform: `translate(${-sprite.x * scale}px, ${-sprite.y * scale}px) scale(${scale})`,
            transformOrigin: "top left",
          }}
        />
      </div>
    );
  }

  return null;
}

function ThumbnailDisplay(props: { at: number; show: boolean }) {
  const thumbnailImages = usePlayerStore((s) => s.thumbnails.images);
  const currentThumbnail = useMemo(() => {
    return nearestImageAt(thumbnailImages, props.at)?.image;
  }, [thumbnailImages, props.at]);
  const [offsets, setOffsets] = useState({
    offscreenLeft: 0,
    offscreenRight: 0,
  });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const padding = 32;
    const left = Math.max(0, (rect.left - padding) * -1);
    const right = Math.max(0, rect.right + padding - window.innerWidth);

    setOffsets({
      offscreenLeft: left,
      offscreenRight: right,
    });
  }, [props.at, currentThumbnail]);

  // Keep time label width consistent and avoid recomputing
  const formattedTime = useMemo(
    () => formatSeconds(Math.max(props.at, 0), durationExceedsHour(props.at)),
    [props.at],
  );
  const transformX =
    offsets.offscreenLeft > 0 ? offsets.offscreenLeft : -offsets.offscreenRight;

  if (!props.show) return null;

  return (
    <div className="flex flex-col items-center -translate-x-1/2 pointer-events-none">
      <div className="w-screen flex justify-center">
        <div ref={ref}>
          <div
            style={{
              transform: `translateX(${transformX}px)`,
            }}
          >
            {currentThumbnail ? (
              <ThumbnailPreview thumbnail={currentThumbnail} />
            ) : null}
            <p className="mt-1 mx-auto text-center border rounded-xl border-gray-800 px-3 py-1 backdrop-blur-lg bg-black bg-opacity-20 w-max">
              {formattedTime}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function useMouseHoverPosition(barRef: RefObject<HTMLDivElement>) {
  const [mousePos, setMousePos] = useState(-1);

  const mouseMove = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const bar = barRef.current;
      if (!bar) return;
      const rect = barRef.current.getBoundingClientRect();
      const pos = (e.pageX - rect.left) / barRef.current.offsetWidth;
      setMousePos(pos * 100);
    },
    [setMousePos, barRef],
  );

  const mouseLeave = useCallback(() => {
    setMousePos(-1);
  }, [setMousePos]);

  return { mousePos, mouseMove, mouseLeave };
}

export function ProgressBar() {
  const { duration, time, buffered } = usePlayerStore((s) => s.progress);
  const display = usePlayerStore((s) => s.display);
  const setDraggingTime = usePlayerStore((s) => s.setDraggingTime);
  const setSeeking = usePlayerStore((s) => s.setSeeking);
  const { isSeeking } = usePlayerStore((s) => s.interface);
  const segments = useSkipTime();

  const segmentRanges = useMemo(() => {
    if (duration <= 0) return [];
    return segments
      .map((seg) => {
        const bounds = getSegmentBoundsSeconds(seg, duration);
        if (!bounds) return null;

        const endSec = bounds.end ?? duration;
        const left = Math.max(
          0,
          Math.min(100, (bounds.start / duration) * 100),
        );
        const rawWidth = ((endSec - bounds.start) / duration) * 100;
        const width = Math.max(0, Math.min(100 - left, rawWidth));
        if (width <= 0) return null;

        return {
          key: `${seg.type}-${seg.submission_count}-${seg.start_ms ?? "null"}-${seg.end_ms ?? "null"}`,
          left,
          width,
          color: SEGMENT_COLORS[seg.type],
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
  }, [segments, duration]);

  const commitTime = useCallback(
    (percentage: number) => {
      display?.setTime(percentage * duration);
    },
    [duration, display],
  );

  const ref = useRef<HTMLDivElement>(null);
  const { mouseMove, mouseLeave, mousePos } = useMouseHoverPosition(ref);

  const { dragging, dragPercentage, dragMouseDown } = useProgressBar(
    ref,
    commitTime,
  );
  useEffect(() => {
    setSeeking(dragging);
  }, [setSeeking, dragging]);

  useEffect(() => {
    setDraggingTime((dragPercentage / 100) * duration);
  }, [setDraggingTime, duration, dragPercentage]);

  const previewPercentage = dragging ? dragPercentage : mousePos;
  const shouldShowPreview = dragging || mousePos > -1;

  return (
    <div className="w-full relative" dir="ltr">
      <div className="top-0 absolute inset-x-0 z-[70] pointer-events-none">
        <div
          className="absolute bottom-0"
          style={{
            left: `${previewPercentage}%`,
          }}
        >
          <ThumbnailDisplay
            at={Math.floor((previewPercentage / 100) * duration)}
            show={shouldShowPreview}
          />
        </div>
      </div>

      <div className="w-full" ref={ref}>
        <div
          className="group w-full h-8 flex items-center cursor-pointer"
          onMouseDown={dragMouseDown}
          onTouchStart={dragMouseDown}
          onMouseLeave={mouseLeave}
          onMouseMove={mouseMove}
        >
          <div
            className={[
              "relative w-full h-[4px] bg-progress-background bg-opacity-25 rounded-sm transition-[height] duration-100 group-hover:h-[6px]",
              dragging ? "!h-[6px]" : "",
            ].join(" ")}
          >
            {/* Skip segment markers */}
            {segmentRanges.map((range) => (
              <div
                key={range.key}
                className="absolute top-0 bottom-0 rounded-sm pointer-events-none"
                style={{
                  left: `${range.left}%`,
                  width: `${range.width}%`,
                  backgroundColor: range.color,
                }}
              />
            ))}
            {/* Pre-loaded content bar */}
            <div
              className="absolute top-0 left-0 h-full rounded-sm bg-progress-preloaded bg-opacity-50 flex justify-end items-center"
              style={{
                width: `${(buffered / duration) * 100}%`,
              }}
            />

            {/* Actual progress bar */}
            <div
              className="absolute top-0 dir-neutral:left-0 h-full rounded-sm bg-progress-filled flex justify-end items-center"
              style={{
                width: `${
                  Math.max(
                    0,
                    Math.min(
                      1,
                      dragging ? dragPercentage / 100 : time / duration,
                    ),
                  ) * 100
                }%`,
              }}
            >
              <div
                className={[
                  "w-[20px] min-w-[20px] h-[20px] rounded-full transform translate-x-1/2 scale-0 group-hover:scale-100 bg-progress-filled transition-[transform] duration-100 shadow-[0_0_8px_rgba(0,0,0,0.5)]",
                  isSeeking ? "scale-100" : "",
                ].join(" ")}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
