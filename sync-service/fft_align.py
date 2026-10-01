from __future__ import annotations

import math
from typing import Optional
import numpy as np
from scipy.signal import fftconvolve

FRAME_MS = 25  # 25ms per bin
MAX_SEARCH_OFFSET_MS = 180_000  # ±3 minutes search range

# Common framerate ratios between film/TV standards
FRAMERATE_RATIOS = [
    1.0,
    23.976 / 24.0,
    24.0 / 23.976,
    23.976 / 25.0,
    25.0 / 23.976,
    24.0 / 25.0,
    25.0 / 24.0,
    29.97 / 25.0,
    25.0 / 29.97,
]


def intervals_to_signal(
    intervals: list[tuple[int, int]],
    origin_ms: int,
    duration_ms: int,
    frame_ms: int = FRAME_MS,
) -> np.ndarray:
    n_frames = max(1, int(math.ceil(duration_ms / frame_ms)))
    signal = np.zeros(n_frames, dtype=np.float32)
    for start_ms, end_ms in intervals:
        clipped_start = max(origin_ms, start_ms)
        clipped_end = min(origin_ms + duration_ms, end_ms)
        if clipped_end <= clipped_start:
            continue
        start_frame = max(0, int((clipped_start - origin_ms) / frame_ms))
        end_frame = min(n_frames, int(math.ceil((clipped_end - origin_ms) / frame_ms)))
        signal[start_frame:end_frame] = 1.0
    return signal


def find_best_offset_fft(
    speech_intervals: list[tuple[int, int]],
    subtitle_intervals: list[tuple[int, int]],
    audio_start_ms: int,
    audio_end_ms: int,
    max_offset_ms: int = MAX_SEARCH_OFFSET_MS,
    try_framerate_ratios: bool = True,
    search_centers: list[int] | None = None,
) -> tuple[int, float, float]:
    """
    Find best (offset_ms, confidence_0_to_100, best_framerate_ratio).
    Uses FFT cross-correlation over binary speech vs subtitle activity.
    Offset is defined such that: speech_time = subtitle_time + offset_ms.
    """
    if not speech_intervals or not subtitle_intervals:
        return 0, 0.0, 1.0

    duration_ms = audio_end_ms - audio_start_ms
    if duration_ms <= 0:
        return 0, 0.0, 1.0

    ref_signal = intervals_to_signal(
        speech_intervals,
        origin_ms=audio_start_ms,
        duration_ms=duration_ms,
        frame_ms=FRAME_MS,
    )
    ref_energy = float(np.sum(ref_signal**2))
    if ref_energy <= 0:
        return 0, 0.0, 1.0

    ratios = FRAMERATE_RATIOS if try_framerate_ratios else [1.0]

    best_offset_ms = 0
    best_score = 0.0
    best_ratio = 1.0

    query_origin_ms = audio_start_ms - max_offset_ms
    query_duration_ms = duration_ms + 2 * max_offset_ms
    max_offset_frames = int(max_offset_ms / FRAME_MS)

    for ratio in ratios:
        if ratio == 1.0:
            scaled_subs = subtitle_intervals
        else:
            scaled_subs = [
                (int(round(s * ratio)), int(round(e * ratio)))
                for s, e in subtitle_intervals
            ]

        query_signal = intervals_to_signal(
            scaled_subs,
            origin_ms=query_origin_ms,
            duration_ms=query_duration_ms,
            frame_ms=FRAME_MS,
        )
        query_energy = float(np.sum(query_signal**2))
        if query_energy <= 0:
            continue

        corr = fftconvolve(ref_signal, query_signal[::-1], mode="full")
        zero_k = len(query_signal) - 1

        # lag * FRAME_MS + max_offset_ms in [-max_offset_ms, max_offset_ms]
        # => lag in [-2 * max_offset_frames, 0]
        # => k in [zero_k - 2 * max_offset_frames, zero_k]
        low_k = max(0, zero_k - 2 * max_offset_frames)
        high_k = min(len(corr), zero_k + 1)
        if low_k >= high_k:
            continue

        valid_corr = np.full_like(corr, -np.inf)
        valid_corr[low_k:high_k] = corr[low_k:high_k]

        best_k = int(np.argmax(valid_corr))
        max_val = valid_corr[best_k]
        if max_val <= 0 or np.isneginf(max_val):
            continue

        lag = best_k - zero_k
        offset_ms = lag * FRAME_MS + max_offset_ms

        # Normalize score
        norm_score = float(max_val) / math.sqrt(ref_energy * query_energy)
        norm_score = min(1.0, max(0.0, norm_score))

        # Proximity bonus if search centers given
        adjusted_score = norm_score
        if search_centers:
            closest_dist = min(abs(offset_ms - c) for c in search_centers)
            if closest_dist < 1000:
                adjusted_score *= 1.05

        if adjusted_score > best_score:
            best_score = adjusted_score
            best_offset_ms = offset_ms
            best_ratio = ratio

    confidence = round(min(1.0, best_score) * 100, 1)
    return best_offset_ms, confidence, best_ratio
