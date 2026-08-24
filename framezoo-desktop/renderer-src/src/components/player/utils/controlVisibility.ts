import {
  SegmentData,
  getSegmentBoundsSeconds,
} from "@/components/player/hooks/useSkipTime";

export type PlayerControlVisibility = "always" | "hover" | "none";

export function getSkipSegmentVisibility(
  currentTime: number,
  segment: SegmentData | null,
  duration: number,
): PlayerControlVisibility {
  if (!segment) return "none";

  const bounds = getSegmentBoundsSeconds(segment, duration);
  if (!bounds) return "none";

  const endSeconds =
    bounds.end !== null ? bounds.end : duration > 0 ? duration : Infinity;
  if (currentTime < bounds.start || currentTime > endSeconds) return "none";

  return (currentTime - bounds.start) * 1000 <= 10000 ? "always" : "hover";
}

export function isSegmentEndingAtVideoEnd(
  segment: SegmentData,
  duration: number,
): boolean {
  if (duration <= 0) return false;
  const bounds = getSegmentBoundsSeconds(segment, duration);
  if (!bounds) return false;

  const endSeconds = bounds.end ?? duration;
  return endSeconds >= duration - 0.5;
}

export function getNextEpisodeVisibility(
  time: number,
  duration: number,
): PlayerControlVisibility {
  if (duration <= 0) return "none";

  const percentage = time / duration;
  const secondsFromEnd = duration - time;
  if (secondsFromEnd <= 30) return "always";
  if (percentage >= 0.93) return "hover";
  return "none";
}
