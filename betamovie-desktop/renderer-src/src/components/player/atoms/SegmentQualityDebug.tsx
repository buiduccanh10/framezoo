import { usePlayerStore } from "@/stores/player/store";

export function SegmentQualityDebug() {
  const segmentQualityDebug = usePlayerStore((s) => s.segmentQualityDebug);

  if (!import.meta.env.DEV) return null;

  const realQuality = segmentQualityDebug?.realQuality ?? "unknown";
  const width = segmentQualityDebug?.width;
  const height = segmentQualityDebug?.height;
  const resolutionText =
    width && height ? `${width}x${height}` : "stream-unresolved";

  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-white/25 bg-black/45 px-2 py-0.5 text-[11px] font-medium text-white/90">
      <span>SEG {realQuality}</span>
      <span className="text-white/70">{resolutionText}</span>
    </span>
  );
}
