import { useMemo } from "react";

import { useSkipTime } from "@/components/player/hooks/useSkipTime";
import { parseCanonicalVtt } from "@/components/player/utils/captions";
import { computeCaptionSourceFitScore } from "@/components/player/utils/captionSourceFit";
import { usePlayerStore } from "@/stores/player/store";

export function useCaptionMatchScore() {
  const segments = useSkipTime();
  const videoDuration = usePlayerStore((s) => s.progress.duration);
  const vttData = usePlayerStore((s) => s.caption.selected?.vttData);

  const matchScore = useMemo(() => {
    if (!vttData) return null;
    const cues = parseCanonicalVtt(vttData);
    const fit = computeCaptionSourceFitScore(cues, {
      videoDurationMs: videoDuration * 1000,
      segments,
    });
    return fit?.score ?? null;
  }, [vttData, segments, videoDuration]);

  return matchScore;
}
