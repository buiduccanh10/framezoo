from __future__ import annotations

import math
from typing import Optional
import numpy as np
from scipy.signal import fftconvolve

FRAME_MS = 25  # 25ms per bin
MAX_SEARCH_OFFSET_MS = 180_000  # ±3 minutes search range
ONSET_BOOST_FRAMES = 8  # First 200ms of an utterance/cue receives onset emphasis
ONSET_BOOST_WEIGHT = 1.45

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
    onset_weight: float = 1.0,
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
        if end_frame <= start_frame:
            continue
        signal[start_frame:end_frame] = np.maximum(signal[start_frame:end_frame], 1.0)
        if onset_weight > 1.0 and start_ms >= origin_ms:
            onset_end = min(end_frame, start_frame + ONSET_BOOST_FRAMES)
            signal[start_frame:onset_end] = np.maximum(
                signal[start_frame:onset_end],
                onset_weight,
            )
    return signal


def find_top_offsets_fft(
    speech_intervals: list[tuple[int, int]],
    subtitle_intervals: list[tuple[int, int]],
    audio_start_ms: int,
    audio_end_ms: int,
    max_offset_ms: int = MAX_SEARCH_OFFSET_MS,
    try_framerate_ratios: bool = False,
    search_centers: list[int] | None = None,
    top_k: int = 5,
    min_separation_ms: int = 1_500,
) -> list[tuple[int, float, float]]:
    """
    Return up to top_k distinct candidate peaks [(offset_ms, confidence_0_to_100, ratio), ...]
    using local-window energy normalized FFT cross-correlation with onset emphasis.
    Offset convention: speech_time = subtitle_time + offset_ms.
    """
    if not speech_intervals or not subtitle_intervals:
        return []

    duration_ms = audio_end_ms - audio_start_ms
    if duration_ms <= 0:
        return []

    ref_signal = intervals_to_signal(
        speech_intervals,
        origin_ms=audio_start_ms,
        duration_ms=duration_ms,
        frame_ms=FRAME_MS,
        onset_weight=ONSET_BOOST_WEIGHT,
    )
    n_ref = len(ref_signal)
    ref_energy = float(np.sum(ref_signal**2))
    if ref_energy <= 0:
        return []

    ratios = FRAMERATE_RATIOS if try_framerate_ratios else [1.0]
    query_origin_ms = audio_start_ms - max_offset_ms
    query_duration_ms = duration_ms + 2 * max_offset_ms
    max_offset_frames = int(max_offset_ms / FRAME_MS)

    candidates: list[tuple[int, float, float]] = []

    for ratio in ratios:
        if ratio == 1.0:
            scaled_subs = subtitle_intervals
        else:
            # Scale relative to audio_start_ms so non-unit ratios do not inject
            # a huge (ratio - 1) * audio_start_ms shift for later timeline windows.
            scaled_subs = [
                (
                    int(round(audio_start_ms + (s - audio_start_ms) * ratio)),
                    int(round(audio_start_ms + (e - audio_start_ms) * ratio)),
                )
                for s, e in subtitle_intervals
            ]

        query_signal = intervals_to_signal(
            scaled_subs,
            origin_ms=query_origin_ms,
            duration_ms=query_duration_ms,
            frame_ms=FRAME_MS,
            onset_weight=ONSET_BOOST_WEIGHT,
        )
        n_query = len(query_signal)
        if float(np.sum(query_signal**2)) <= 0:
            continue

        corr = fftconvolve(ref_signal, query_signal[::-1], mode="full")
        zero_k = n_query - 1

        low_k = max(0, zero_k - 2 * max_offset_frames)
        high_k = min(len(corr), zero_k + 1)
        if low_k >= high_k:
            continue

        # Compute local query energy within the sliding n_ref window for each lag k
        query_sq_cumsum = np.concatenate(
            ([0.0], np.cumsum(query_signal.astype(np.float64) ** 2))
        )
        k_indices = np.arange(low_k, high_k)
        q_starts = np.clip(zero_k - k_indices, 0, n_query)
        q_ends = np.clip(q_starts + n_ref, 0, n_query)
        local_q_energies = query_sq_cumsum[q_ends] - query_sq_cumsum[q_starts]

        # Guard against sparse single-cue windows artificially inflating cosine similarity
        denom_q_energies = np.maximum(local_q_energies, ref_energy * 0.20)
        denom = np.sqrt(ref_energy * denom_q_energies)

        valid_corr = corr[low_k:high_k]
        with np.errstate(divide="ignore", invalid="ignore"):
            norm_scores = np.where(
                (valid_corr > 0) & (local_q_energies > 0) & (denom > 0),
                valid_corr / denom,
                0.0,
            )
        norm_scores = np.clip(norm_scores, 0.0, 1.0)

        # Require non-unit framerate ratio to genuinely beat 1.0
        if ratio != 1.0:
            norm_scores = norm_scores * 0.985

        if ratio == 1.0:
            # Extract top local peaks for ratio == 1.0
            sorted_idx = np.argsort(norm_scores)[::-1]
            picked_for_ratio = 0
            for idx in sorted_idx:
                raw_score = float(norm_scores[idx])
                if raw_score <= 0:
                    break
                k = int(low_k + idx)
                lag = k - zero_k
                offset_ms = lag * FRAME_MS + max_offset_ms
                if any(
                    abs(offset_ms - existing_off) < min_separation_ms
                    for existing_off, _, existing_r in candidates
                    if existing_r == 1.0
                ):
                    continue
                adjusted_score = raw_score
                if search_centers:
                    closest_dist = min(abs(offset_ms - c) for c in search_centers)
                    if closest_dist < 1000:
                        adjusted_score *= 1.05
                candidates.append((offset_ms, adjusted_score, ratio))
                picked_for_ratio += 1
                if picked_for_ratio >= top_k:
                    break
        else:
            best_idx = int(np.argmax(norm_scores))
            raw_score = float(norm_scores[best_idx])
            if raw_score <= 0:
                continue
            k = int(low_k + best_idx)
            lag = k - zero_k
            offset_ms = lag * FRAME_MS + max_offset_ms
            adjusted_score = raw_score
            if search_centers:
                closest_dist = min(abs(offset_ms - c) for c in search_centers)
                if closest_dist < 1000:
                    adjusted_score *= 1.05
            candidates.append((offset_ms, adjusted_score, ratio))

    candidates.sort(key=lambda item: item[1], reverse=True)
    deduped: list[tuple[int, float, float]] = []
    for offset_ms, score, ratio in candidates:
        if any(abs(offset_ms - ex_off) < min_separation_ms for ex_off, _, _ in deduped):
            continue
        conf = round(min(1.0, score) * 100, 1)
        deduped.append((offset_ms, conf, ratio))
        if len(deduped) >= top_k:
            break

    return deduped


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
    Uses local-energy normalized FFT cross-correlation over onset-boosted speech vs subtitle activity.
    Offset is defined such that: speech_time = subtitle_time + offset_ms.
    """
    peaks = find_top_offsets_fft(
        speech_intervals=speech_intervals,
        subtitle_intervals=subtitle_intervals,
        audio_start_ms=audio_start_ms,
        audio_end_ms=audio_end_ms,
        max_offset_ms=max_offset_ms,
        try_framerate_ratios=try_framerate_ratios,
        search_centers=search_centers,
        top_k=1,
    )
    if not peaks:
        return 0, 0.0, 1.0
    return peaks[0]
