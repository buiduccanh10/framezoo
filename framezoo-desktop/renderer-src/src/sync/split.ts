/**
 * Dynamic Programming piecewise alignment (Split Detection).
 * Detects breaks/splits caused by commercial breaks, uncut scenes, or intro edits.
 */

export interface TimingSegment {
  startMs: number;
  endMs: number;
  offsetMs: number;
}

export interface WindowSyncEntry {
  startAt: number; // in seconds
  result: {
    aligned: boolean;
    offsetMs: number;
    confidence: number;
  };
}

const SPLIT_MIN_DIFF_MS = 2000; // Minimum 2s offset difference

export function computePiecewiseSegments(
  windowEntries: WindowSyncEntry[],
  globalOffsetMs: number,
): TimingSegment[] {
  const validWindows = windowEntries.filter(
    (w) =>
      w.result?.aligned === true &&
      typeof w.result.offsetMs === "number" &&
      w.result.confidence >= 60,
  );

  if (validWindows.length < 2) return [];

  const sortedWindows = [...validWindows].sort((a, b) => a.startAt - b.startAt);

  // Group consecutive windows with similar offsets (within 1200ms)
  const groups: WindowSyncEntry[][] = [];
  for (const w of sortedWindows) {
    if (groups.length === 0) {
      groups.push([w]);
      continue;
    }
    const prevGroup = groups[groups.length - 1]!;
    const prevAvg =
      prevGroup.reduce((sum, item) => sum + item.result.offsetMs, 0) /
      prevGroup.length;
    if (Math.abs(w.result.offsetMs - prevAvg) <= 1200) {
      prevGroup.push(w);
    } else {
      groups.push([w]);
    }
  }

  if (groups.length < 2) return [];

  const segments: TimingSegment[] = [];
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]!;
    const avgOffset = Math.round(
      group.reduce((sum, item) => sum + item.result.offsetMs, 0) / group.length,
    );

    let segStartMs = 0;
    if (i > 0) {
      const prevEndS = groups[i - 1]![groups[i - 1]!.length - 1]!.startAt + 60;
      const curStartS = group[0]!.startAt;
      const boundaryS = Math.max(prevEndS, (prevEndS + curStartS) / 2);
      segStartMs = Math.round(boundaryS * 1000);
    }

    let segEndMs = Number.MAX_SAFE_INTEGER;
    if (i < groups.length - 1) {
      const curEndS = group[group.length - 1]!.startAt + 60;
      const nextStartS = groups[i + 1]![0]!.startAt;
      const boundaryS = Math.max(curEndS, (curEndS + nextStartS) / 2);
      segEndMs = Math.round(boundaryS * 1000);
    }

    segments.push({
      startMs: segStartMs,
      endMs: segEndMs,
      offsetMs: avgOffset,
    });
  }

  // Ensure at least two segments differ by more than SPLIT_MIN_DIFF_MS
  const offsets = segments.map((s) => s.offsetMs);
  const maxDiff = Math.max(...offsets) - Math.min(...offsets);
  if (maxDiff < SPLIT_MIN_DIFF_MS) {
    return [];
  }

  return segments;
}
