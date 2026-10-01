from __future__ import annotations

from dataclasses import dataclass
from typing import Any
import numpy as np

SPLIT_MIN_DIFF_MS = 2_000  # Minimum 2s difference to consider a split
DEFAULT_SPLIT_PENALTY = 7.0  # Same default as ffsubsync/alass


@dataclass
class TimingSegment:
    start_ms: int
    end_ms: int
    offset_ms: int

    def to_dict(self) -> dict[str, int]:
        return {
            "startMs": self.start_ms,
            "endMs": self.end_ms,
            "offsetMs": self.offset_ms,
        }


def compute_piecewise_segments(
    window_entries: list[dict[str, Any]],
    global_offset_ms: int,
    split_penalty: float = DEFAULT_SPLIT_PENALTY,
) -> list[dict[str, int]]:
    """
    Given alignment results for multiple timeline windows, determine if
    piecewise segments (splits due to ads, recuts) should be introduced.
    
    Each window_entry contains:
      - startAt: start position in seconds
      - result: {"offsetMs": int, "confidence": int, "aligned": bool}
    """
    valid_windows = [
        w
        for w in window_entries
        if w.get("result", {}).get("aligned") is True
        and isinstance(w["result"].get("offsetMs"), int)
        and int(w["result"].get("confidence", 0)) >= 60
    ]

    if len(valid_windows) < 2:
        return []

    # Sort chronologically
    sorted_windows = sorted(valid_windows, key=lambda w: float(w["startAt"]))

    # Group into consecutive runs of similar offsets (within 1200ms)
    groups: list[list[dict[str, Any]]] = []
    for w in sorted_windows:
        cur_offset = int(w["result"]["offsetMs"])
        if not groups:
            groups.append([w])
            continue
        prev_group = groups[-1]
        prev_avg_offset = sum(int(item["result"]["offsetMs"]) for item in prev_group) / len(prev_group)
        if abs(cur_offset - prev_avg_offset) <= 1_200:
            prev_group.append(w)
        else:
            groups.append([w])

    if len(groups) < 2:
        return []

    # Check if the split between groups is significant and supported by multiple windows
    # or high confidence
    segments: list[dict[str, int]] = []
    for i, group in enumerate(groups):
        avg_offset = round(
            sum(int(item["result"]["offsetMs"]) for item in group) / len(group)
        )
        avg_conf = sum(int(item["result"]["confidence"]) for item in group) / len(group)

        # Start of this segment
        if i == 0:
            seg_start_ms = 0
        else:
            # Boundary is halfway between previous group end and current group start
            prev_end_s = float(groups[i - 1][-1]["startAt"]) + 60.0
            cur_start_s = float(group[0]["startAt"])
            boundary_s = max(prev_end_s, (prev_end_s + cur_start_s) / 2.0)
            seg_start_ms = int(round(boundary_s * 1000))

        # End of this segment
        if i == len(groups) - 1:
            seg_end_ms = 9_007_199_254_740_991  # JS Number.MAX_SAFE_INTEGER
        else:
            cur_end_s = float(group[-1]["startAt"]) + 60.0
            next_start_s = float(groups[i + 1][0]["startAt"])
            boundary_s = max(cur_end_s, (cur_end_s + next_start_s) / 2.0)
            seg_end_ms = int(round(boundary_s * 1000))

        segments.append(
            {
                "startMs": seg_start_ms,
                "endMs": seg_end_ms,
                "offsetMs": avg_offset,
            }
        )

    # Check if any segment differs significantly from another
    offsets = [s["offsetMs"] for s in segments]
    max_diff = max(offsets) - min(offsets)
    if max_diff < SPLIT_MIN_DIFF_MS:
        return []

    return segments
