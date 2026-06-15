import { useMemo } from "react";

import { useSkipTime } from "@/components/player/hooks/useSkipTime";
import { parseSubtitles } from "@/components/player/utils/captions";
import { computeCaptionSourceFitScore } from "@/components/player/utils/captionSourceFit";
import { usePlayerStore } from "@/stores/player/store";

export function useCaptionMatchScore() {
  const segments = useSkipTime();
  const videoDuration = usePlayerStore((s) => s.progress.duration);
  const srtData = usePlayerStore((s) => s.caption.selected?.srtData);

  const matchScore = useMemo(() => {
    if (!srtData) return null;
    const cues = parseSubtitles(srtData);
    const fit = computeCaptionSourceFitScore(cues, {
      videoDurationMs: videoDuration * 1000,
      segments,
    });
    return fit?.score ?? null;
  }, [srtData, segments, videoDuration]);

  return matchScore;
}
