from __future__ import annotations

from dataclasses import dataclass
from typing import Any
import numpy as np

SPLIT_MIN_DIFF_MS = 2_000  # Minimum 2s difference to consider a split
DEFAULT_SPLIT_PENALTY = 7.0  # Same default as ffsubsync/alass
MAX_GROUP_SPREAD_MS = 1_200
RESIDUAL_SCALE_MS = 600.0
MAX_WINDOW_RESIDUAL_PENALTY = 25.0
SUB_SPLIT_MIN_DIFF_MS = 650
SUB_SPLIT_PENALTY = 2.0
SUB_RESIDUAL_SCALE_MS = 300.0
MIN_SUB_SPLIT_GROUP_SPREAD_MS = 700
MIN_BOUNDARY_GAP_MS = 8_000


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


def _segment_cost(
    windows: list[dict[str, Any]],
    seg_offset: float,
    residual_scale_ms: float = RESIDUAL_SCALE_MS,
) -> float:
    cost = 0.0
    for w in windows:
        diff = abs(float(w["result"]["offsetMs"]) - seg_offset)
        conf_weight = max(0.75, float(w["result"].get("confidence", 60)) / 80.0)
        norm_err = min(MAX_WINDOW_RESIDUAL_PENALTY, (diff / residual_scale_ms) ** 2)
        cost += norm_err * conf_weight
    return cost


def _partition_windows_dp(
    windows: list[dict[str, Any]],
    split_penalty: float,
    residual_scale_ms: float,
    min_diff_ms: int,
) -> list[list[dict[str, Any]]]:
    """Run optimal 1D penalized DP and merge adjacent groups closer than min_diff_ms."""
    n = len(windows)
    if n < 2:
        return [windows] if windows else []

    dp_cost = [float("inf")] * (n + 1)
    dp_prev = [-1] * (n + 1)
    dp_cost[0] = -float(split_penalty)

    for j in range(1, n + 1):
        for i in range(j):
            sub = windows[i:j]
            seg_cost = _segment_cost(sub, _weighted_offset(sub), residual_scale_ms)
            cand_cost = dp_cost[i] + seg_cost + float(split_penalty)
            if cand_cost < dp_cost[j]:
                dp_cost[j] = cand_cost
                dp_prev[j] = i

    groups: list[list[dict[str, Any]]] = []
    cur = n
    while cur > 0:
        prev = dp_prev[cur]
        groups.append(windows[prev:cur])
        cur = prev
    groups.reverse()

    return _merge_close_groups(groups, min_diff_ms)


def _merge_close_groups(
    groups: list[list[dict[str, Any]]],
    min_diff_ms: int,
) -> list[list[dict[str, Any]]]:
    if len(groups) < 2:
        return groups
    merged: list[list[dict[str, Any]]] = [list(groups[0])]
    for grp in groups[1:]:
        if abs(_weighted_offset(grp) - _weighted_offset(merged[-1])) < min_diff_ms:
            merged[-1].extend(grp)
        else:
            merged.append(list(grp))
    return merged


def _refine_staircase_group(
    group: list[dict[str, Any]],
) -> list[list[dict[str, Any]]]:
    """Sub-partition an already-confirmed multi-segment group for smaller HDTV ad steps."""
    if len(group) < 2:
        return [group]
    offsets = [int(w["result"]["offsetMs"]) for w in group]
    if max(offsets) - min(offsets) < MIN_SUB_SPLIT_GROUP_SPREAD_MS:
        return [group]
    return _partition_windows_dp(
        group,
        SUB_SPLIT_PENALTY,
        SUB_RESIDUAL_SCALE_MS,
        SUB_SPLIT_MIN_DIFF_MS,
    )


def _snap_boundary_to_subtitle_gap(
    cues: list[Any] | None,
    prev_end_ms: int,
    next_start_ms: int,
    prev_offset_ms: int,
    next_offset_ms: int,
) -> int:
    """Snap a split boundary to the widest subtitle silence gap between adjacent windows."""
    fallback_ms = int(round(max(prev_end_ms, (prev_end_ms + next_start_ms) / 2.0)))
    if not cues or len(cues) < 2 or next_start_ms <= prev_end_ms:
        return fallback_ms

    avg_off_ms = (prev_offset_ms + next_offset_ms) / 2.0
    sub_lo_ms = prev_end_ms - avg_off_ms
    sub_hi_ms = next_start_ms - avg_off_ms
    best_gap_ms = 0
    best_boundary_ms = fallback_ms

    for idx in range(len(cues) - 1):
        cue_end = getattr(cues[idx], "end_ms", None)
        next_cue_start = getattr(cues[idx + 1], "start_ms", None)
        if cue_end is None or next_cue_start is None:
            continue
        if next_cue_start <= sub_lo_ms or cue_end >= sub_hi_ms:
            continue
        gap_ms = next_cue_start - cue_end
        if gap_ms < MIN_BOUNDARY_GAP_MS or gap_ms <= best_gap_ms:
            continue
        cand_video_ms = int(round((cue_end + next_cue_start) / 2.0 + avg_off_ms))
        if prev_end_ms <= cand_video_ms <= next_start_ms:
            best_gap_ms = gap_ms
            best_boundary_ms = cand_video_ms

    return best_boundary_ms


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
    cues: list[Any] | None = None,
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

    merged_groups = _partition_windows_dp(
        cleaned_windows,
        split_penalty,
        RESIDUAL_SCALE_MS,
        SPLIT_MIN_DIFF_MS,
    )

    if len(merged_groups) < 2:
        return []

    # Drop isolated low-confidence boundary outliers when a multi-window majority agrees
    if len(cleaned_windows) >= 4:
        if (
            len(merged_groups[0]) == 1
            and len(merged_groups[1]) >= 2
            and int(merged_groups[0][0]["result"].get("confidence", 0)) < 82
        ):
            merged_groups.pop(0)
        if (
            len(merged_groups) >= 2
            and len(merged_groups[-1]) == 1
            and len(merged_groups[-2]) >= 2
            and int(merged_groups[-1][0]["result"].get("confidence", 0)) < 82
        ):
            merged_groups.pop()
        if len(merged_groups) < 2:
            return []

    # Gate 2: once Gate 1 confirms a multi-segment split, refine smaller HDTV break steps
    if split_penalty <= DEFAULT_SPLIT_PENALTY:
        refined_groups: list[list[dict[str, Any]]] = []
        for grp in merged_groups:
            refined_groups.extend(_refine_staircase_group(grp))
        if len(refined_groups) >= 3:
            merged_groups = _merge_close_groups(refined_groups, SUB_SPLIT_MIN_DIFF_MS)

    segments: list[dict[str, int]] = []
    for i, group in enumerate(merged_groups):
        avg_offset = round(_weighted_offset(group))
        seg_start_ms = 0 if i == 0 else segments[-1]["endMs"]

        if i == len(merged_groups) - 1:
            seg_end_ms = 9_007_199_254_740_991  # JS Number.MAX_SAFE_INTEGER
        else:
            cur_win = group[-1]
            cur_dur_s = float(cur_win.get("durationSec", 60.0))
            cur_end_ms = int(round((float(cur_win["startAt"]) + cur_dur_s) * 1000))
            next_start_ms = int(round(float(merged_groups[i + 1][0]["startAt"]) * 1000))
            next_offset = round(_weighted_offset(merged_groups[i + 1]))
            seg_end_ms = _snap_boundary_to_subtitle_gap(
                cues,
                cur_end_ms,
                next_start_ms,
                avg_offset,
                next_offset,
            )

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
