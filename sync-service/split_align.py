from __future__ import annotations

from dataclasses import dataclass
from typing import Any
import numpy as np

SPLIT_MIN_DIFF_MS = 2_000  # Minimum 2s difference to consider a split
DEFAULT_SPLIT_PENALTY = 7.0  # Same default as ffsubsync/alass
MAX_GROUP_SPREAD_MS = 1_200
RESIDUAL_SCALE_MS = 600.0
MAX_WINDOW_RESIDUAL_PENALTY = 25.0


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


def _weighted_offset(windows: list[dict[str, Any]]) -> float:
    total_w = 0.0
    total_val = 0.0
    for w in windows:
        conf = max(1.0, float(w["result"].get("confidence", 60)))
        total_w += conf
        total_val += conf * float(w["result"]["offsetMs"])
    return total_val / total_w


def _segment_cost(windows: list[dict[str, Any]], seg_offset: float) -> float:
    cost = 0.0
    for w in windows:
        diff = abs(float(w["result"]["offsetMs"]) - seg_offset)
        conf_weight = max(0.75, float(w["result"].get("confidence", 60)) / 80.0)
        norm_err = min(MAX_WINDOW_RESIDUAL_PENALTY, (diff / RESIDUAL_SCALE_MS) ** 2)
        cost += norm_err * conf_weight
    return cost


def _prune_isolated_interior_outliers(
    windows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Drop isolated 1-window interior spikes whose left & right neighbors agree (A -> B -> A)."""
    if len(windows) < 3:
        return windows
    kept: list[dict[str, Any]] = [windows[0]]
    for idx in range(1, len(windows) - 1):
        prev_off = int(kept[-1]["result"]["offsetMs"])
        cur_off = int(windows[idx]["result"]["offsetMs"])
        next_off = int(windows[idx + 1]["result"]["offsetMs"])
        if (
            abs(prev_off - next_off) <= MAX_GROUP_SPREAD_MS
            and abs(cur_off - prev_off) >= SPLIT_MIN_DIFF_MS
        ):
            continue
        kept.append(windows[idx])
    kept.append(windows[-1])
    return kept


def compute_piecewise_segments(
    window_entries: list[dict[str, Any]],
    global_offset_ms: int,
    split_penalty: float = DEFAULT_SPLIT_PENALTY,
) -> list[dict[str, int]]:
    """
    Given alignment results for multiple timeline windows, determine via penalized
    dynamic programming if piecewise segments (splits due to ads, recuts) should
    be introduced, filtering isolated interior A -> B -> A outliers.

    Each window_entry contains:
      - startAt: start position in seconds
      - result: {"offsetMs": int, "confidence": int, "aligned": bool}
    """
    _ = global_offset_ms
    valid_windows = [
        w
        for w in window_entries
        if w.get("result", {}).get("aligned") is True
        and isinstance(w["result"].get("offsetMs"), int)
        and int(w["result"].get("confidence", 0)) >= 60
    ]

    if len(valid_windows) < 2:
        return []

    sorted_windows = sorted(valid_windows, key=lambda w: float(w["startAt"]))
    cleaned_windows = _prune_isolated_interior_outliers(sorted_windows)
    n = len(cleaned_windows)
    if n < 2:
        return []

    # Optimal 1D penalized partitioning DP: minimize sum(segment_cost) + split_penalty * (K - 1)
    dp_cost = [float("inf")] * (n + 1)
    dp_prev = [-1] * (n + 1)
    dp_cost[0] = -float(split_penalty)

    for j in range(1, n + 1):
        for i in range(j):
            sub = cleaned_windows[i:j]
            seg_cost = _segment_cost(sub, _weighted_offset(sub))
            cand_cost = dp_cost[i] + seg_cost + float(split_penalty)
            if cand_cost < dp_cost[j]:
                dp_cost[j] = cand_cost
                dp_prev[j] = i

    groups: list[list[dict[str, Any]]] = []
    cur = n
    while cur > 0:
        prev = dp_prev[cur]
        groups.append(cleaned_windows[prev:cur])
        cur = prev
    groups.reverse()

    if len(groups) < 2:
        return []

    # Merge adjacent groups whose offsets do not differ meaningfully
    merged_groups: list[list[dict[str, Any]]] = [groups[0]]
    for grp in groups[1:]:
        prev_off = _weighted_offset(merged_groups[-1])
        cur_off = _weighted_offset(grp)
        if abs(cur_off - prev_off) < SPLIT_MIN_DIFF_MS:
            merged_groups[-1].extend(grp)
        else:
            merged_groups.append(grp)

    if len(merged_groups) < 2:
        return []

    segments: list[dict[str, int]] = []
    for i, group in enumerate(merged_groups):
        avg_offset = round(_weighted_offset(group))

        if i == 0:
            seg_start_ms = 0
        else:
            prev_end_s = float(merged_groups[i - 1][-1]["startAt"]) + 60.0
            cur_start_s = float(group[0]["startAt"])
            boundary_s = max(prev_end_s, (prev_end_s + cur_start_s) / 2.0)
            seg_start_ms = int(round(boundary_s * 1000))

        if i == len(merged_groups) - 1:
            seg_end_ms = 9_007_199_254_740_991  # JS Number.MAX_SAFE_INTEGER
        else:
            cur_end_s = float(group[-1]["startAt"]) + 60.0
            next_start_s = float(merged_groups[i + 1][0]["startAt"])
            boundary_s = max(cur_end_s, (cur_end_s + next_start_s) / 2.0)
            seg_end_ms = int(round(boundary_s * 1000))

        segments.append(
            {
                "startMs": seg_start_ms,
                "endMs": seg_end_ms,
                "offsetMs": avg_offset,
            }
        )

    offsets = [s["offsetMs"] for s in segments]
    if max(offsets) - min(offsets) < SPLIT_MIN_DIFF_MS:
        return []

    return segments
