from __future__ import annotations

import re
import struct
import threading
from dataclasses import dataclass
from typing import Any, Callable

from model_runtime import get_transcriber


TIMING_RE = re.compile(
    r"^\s*((?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d{3})?)\s+-->\s+"
    r"((?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d{3})?)(?:\s+.*)?$"
)

MAX_AUDIO_BYTES = 8 * 1024 * 1024
MAX_VTT_BYTES = 2 * 1024 * 1024
MAX_ALIGNMENT_TOTAL_AUDIO_BYTES = 14 * 1024 * 1024
MIN_ALIGNMENT_CONFIDENCE = 60
MIN_SPEECH_INTERVAL_MS = 120
MERGE_SPEECH_GAP_MS = 350
MIN_ALIGNMENT_SPEECH_DURATION_MS = 1_000
# A subtitle offset beyond this range is more likely a false match from a
# different scene than a real subtitle timing error.
MAX_ALIGNMENT_OFFSET_MS = 45_000
MAX_PLAUSIBLE_ALIGNMENT_OFFSET_MS = 180_000
SEARCH_RANGE_MS = MAX_ALIGNMENT_OFFSET_MS
SEARCH_STEP_MS = 250
REFINE_RANGE_MS = 750
REFINE_STEP_MS = 25
SUBTITLE_ACTIVITY_MERGE_GAP_MS = 250
MAX_SPEECH_ANCHOR_ERROR_MS = 1_800
MIN_SPEECH_ANCHOR_OVERLAP_MS = 120
MIN_SPEECH_ANCHOR_COVERAGE = 0.20
MIN_SPEECH_ANCHOR_COVERAGE_2_ANCHORS = 0.25
_TRANSCRIPTION_LOCK = threading.Lock()


CREDIT_AD_PATTERNS = re.compile(
    r"(?i)("
    r"https?://|www\.|osdb\.link|\.org\b|\.com\b|\.net\b|\.link\b|\.tv\b|\.me\b|"
    r"opensubtitles|subscene|addic7ed|podnapisi|yify|rarbg|psa\b|"
    r"vip\s*member|remove\s*all\s*ads|watch\s*online|support\s*us|"
    r"subtitles?\s*(by|downloaded|created|sync)|"
    r"synced?\s*by|resync\s*by|corrected\s*by|"
    r"dịch\s*bởi|biên\s*dịch|thực\s*hiện\s*bởi|vietsub\s*bởi|"
    r"phimmoi|xemphim|motphim|bilutv|tvhay"
    r")"
)


@dataclass(frozen=True)
class Cue:
    index: int
    start_ms: int
    end_ms: int
    block: str


def is_credit_or_ad_cue(cue: Cue) -> bool:
    return bool(CREDIT_AD_PATTERNS.search(cue.block))


def estimate_initial_cue_start_ms(cues: list[Cue] | None) -> int | None:
    if not cues:
        return None
    dialogue_cues = [c for c in cues if not is_credit_or_ad_cue(c)]
    if not dialogue_cues:
        dialogue_cues = cues
    candidates = dialogue_cues[: min(10, len(dialogue_cues))]
    for cue in candidates:
        if cue.end_ms - cue.start_ms >= 800:
            return cue.start_ms
    return dialogue_cues[0].start_ms


def estimate_subtitle_relative_offset(
    primary_cues: list[Cue] | None,
    secondary_cues: list[Cue] | None,
    max_offset_ms: int = MAX_PLAUSIBLE_ALIGNMENT_OFFSET_MS,
) -> int | None:
    if not primary_cues or not secondary_cues:
        return None

    clean_p = [c for c in primary_cues if not is_credit_or_ad_cue(c)]
    clean_s = [c for c in secondary_cues if not is_credit_or_ad_cue(c)]
    if not clean_p:
        clean_p = primary_cues
    if not clean_s:
        clean_s = secondary_cues

    # Use cues from the first 30 minutes (or up to 100 cues) to compare timing cadence
    p_cues = [c for c in clean_p if c.start_ms <= 1_800_000]
    if len(p_cues) < 5:
        p_cues = clean_p[:100]
    s_cues = [c for c in clean_s if c.start_ms <= 1_800_000]
    if len(s_cues) < 5:
        s_cues = clean_s[:100]

    p_raw = [(c.start_ms, c.end_ms) for c in p_cues if c.end_ms > c.start_ms]
    s_raw = [(c.start_ms, c.end_ms) for c in s_cues if c.end_ms > c.start_ms]
    p_intervals = merge_activity_intervals(p_raw, SUBTITLE_ACTIVITY_MERGE_GAP_MS)
    s_intervals = merge_activity_intervals(s_raw, SUBTITLE_ACTIVITY_MERGE_GAP_MS)

    p_start = estimate_initial_cue_start_ms(clean_p)
    s_start = estimate_initial_cue_start_ms(clean_s)
    initial_diff = (
        (p_start - s_start)
        if (p_start is not None and s_start is not None)
        else 0
    )

    if not p_intervals or not s_intervals:
        return initial_diff if (p_start is not None and s_start is not None) else None

    p_duration = sum(end - start for start, end in p_intervals)
    if p_duration <= 0:
        return initial_diff if (p_start is not None and s_start is not None) else None

    def rank_relative_offset(offset: int) -> tuple[float, int]:
        shifted_s = [(start + offset, end + offset) for start, end in s_intervals]
        overlap = total_interval_overlap(p_intervals, shifted_s)
        dist_to_initial = abs(offset - initial_diff)
        return (overlap / p_duration, -dist_to_initial)

    # Search around 0 and around initial_diff
    search_centers: set[int] = {0}
    if abs(initial_diff) <= max_offset_ms:
        search_centers.add(initial_diff)

    coarse_candidates: set[int] = set()
    for center in search_centers:
        for offset in range(center - 45_000, center + 45_001, 500):
            if abs(offset) <= max_offset_ms:
                coarse_candidates.add(offset)

    if not coarse_candidates:
        coarse_candidates.add(0)

    best_coarse = max(coarse_candidates, key=rank_relative_offset)

    # Refine around best coarse offset in steps of 50ms
    refined_candidates = range(best_coarse - 1_000, best_coarse + 1_001, 50)
    best_offset = max(refined_candidates, key=rank_relative_offset)

    overlap_score, _ = rank_relative_offset(best_offset)
    if overlap_score > 0.15:
        return best_offset

    # Fallback to initial dialogue difference
    if p_start is not None and s_start is not None:
        return p_start - s_start

    return None


@dataclass(frozen=True)
class OffsetEvidence:
    score: float
    matched_anchors: int
    speech_anchor_count: int
    anchor_coverage: float
    median_anchor_error_ms: int


def parse_timestamp(value: str) -> int:
    normalized = value.replace(",", ".")
    parts = normalized.split(":")
    seconds_part = parts.pop()
    seconds, milliseconds = seconds_part.split(".")
    minute = int(parts.pop()) if parts else 0
    hour = int(parts.pop()) if parts else 0
    return (
        hour * 3_600_000
        + minute * 60_000
        + int(seconds) * 1_000
        + int(milliseconds.ljust(3, "0")[:3])
    )


def parse_vtt(text: str) -> list[Cue]:
    cues: list[Cue] = []
    for block in re.split(r"\r?\n\s*\r?\n", text.strip()):
        lines = block.splitlines()
        timing_index = next(
            (index for index, line in enumerate(lines) if TIMING_RE.match(line)),
            None,
        )
        if timing_index is None:
            continue

        match = TIMING_RE.match(lines[timing_index])
        if match is None:
            continue
        start_ms = parse_timestamp(match.group(1))
        end_ms = parse_timestamp(match.group(2))
        if end_ms <= start_ms:
            continue
        cues.append(
            Cue(
                index=len(cues),
                start_ms=start_ms,
                end_ms=end_ms,
                block=block,
            )
        )
    return cues


def parse_alignment_cues(text: str) -> list[Cue]:
    cues = parse_vtt(text)
    dialogue_cues = [cue for cue in cues if not is_credit_or_ad_cue(cue)]
    return dialogue_cues or cues


def decode_wav(data: bytes) -> tuple[list[float], int]:
    if len(data) < 12 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise ValueError("audio must be a RIFF/WAVE file")

    fmt: bytes | None = None
    frames: bytes | None = None
    offset = 12
    while offset + 8 <= len(data):
        chunk_id = data[offset : offset + 4]
        chunk_size = int.from_bytes(data[offset + 4 : offset + 8], "little")
        chunk_start = offset + 8
        chunk_end = chunk_start + chunk_size
        if chunk_end > len(data):
            raise ValueError("audio contains a truncated WAV chunk")

        if chunk_id == b"fmt " and fmt is None:
            fmt = data[chunk_start:chunk_end]
        elif chunk_id == b"data" and frames is None:
            frames = data[chunk_start:chunk_end]
        offset = chunk_end + (chunk_size & 1)

    if fmt is None or len(fmt) < 16 or frames is None:
        raise ValueError("audio must contain valid fmt and data WAV chunks")

    (
        audio_format,
        channels,
        sample_rate,
        _byte_rate,
        block_align,
        bits_per_sample,
    ) = struct.unpack_from("<HHIIHH", fmt)
    if audio_format == 0xFFFE:
        extension_size = (
            int.from_bytes(fmt[16:18], "little") if len(fmt) >= 18 else 0
        )
        pcm_subformat = bytes.fromhex("0100000000001000800000aa00389b71")
        if extension_size < 22 or len(fmt) < 40 or fmt[24:40] != pcm_subformat:
            raise ValueError("audio must use PCM WAVE_FORMAT_EXTENSIBLE")
    elif audio_format != 1:
        raise ValueError("audio must be signed 16-bit PCM WAV")

    if channels not in (1, 2):
        raise ValueError("audio must contain mono or stereo channels")
    if bits_per_sample != 16 or block_align != channels * 2:
        raise ValueError("audio must be signed 16-bit PCM WAV")
    if sample_rate <= 0:
        raise ValueError("audio must have a valid sample rate")

    samples: list[float] = []
    frame_width = channels * 2
    if len(frames) % frame_width:
        raise ValueError("audio data is not aligned to complete PCM frames")
    for offset in range(0, len(frames), frame_width):
        total = 0
        for channel in range(channels):
            start = offset + channel * 2
            total += int.from_bytes(
                frames[start : start + 2],
                byteorder="little",
                signed=True,
            )
        samples.append(total / channels / 32768.0)
    return samples, sample_rate


def merge_intervals(intervals: list[tuple[int, int]]) -> list[tuple[int, int]]:
    merged: list[list[int]] = []
    for start_ms, end_ms in sorted(intervals):
        if end_ms - start_ms < MIN_SPEECH_INTERVAL_MS:
            continue
        if merged and start_ms <= merged[-1][1] + MERGE_SPEECH_GAP_MS:
            merged[-1][1] = max(merged[-1][1], end_ms)
        else:
            merged.append([start_ms, end_ms])
    return [(start, end) for start, end in merged]


def transcribe_speech_intervals(
    audio: list[float],
    sample_rate: int,
    language: str,
    audio_start_ms: int,
) -> list[tuple[int, int]]:
    transcriber = get_transcriber(language)
    with _TRANSCRIPTION_LOCK:
        transcript = transcriber.transcribe_without_streaming(
            audio,
            sample_rate=sample_rate,
            flags=0,
        )

    intervals: list[tuple[int, int]] = []
    for line in transcript.lines:
        start_ms = audio_start_ms + int(round(float(line.start_time) * 1_000))
        duration_ms = int(round(float(line.duration) * 1_000))
        end_ms = start_ms + duration_ms
        if duration_ms >= MIN_SPEECH_INTERVAL_MS:
            intervals.append((start_ms, end_ms))
    return merge_intervals(intervals)


def overlap_ms(
    first_start: int,
    first_end: int,
    second_start: int,
    second_end: int,
) -> int:
    return max(0, min(first_end, second_end) - max(first_start, second_start))


def clip_intervals(
    intervals: list[tuple[int, int]],
    start_ms: int,
    end_ms: int,
) -> list[tuple[int, int]]:
    clipped: list[tuple[int, int]] = []
    for interval_start, interval_end in intervals:
        clipped_start = max(start_ms, interval_start)
        clipped_end = min(end_ms, interval_end)
        if clipped_end > clipped_start:
            clipped.append((clipped_start, clipped_end))
    return clipped


def merge_activity_intervals(
    intervals: list[tuple[int, int]],
    max_gap_ms: int,
) -> list[tuple[int, int]]:
    merged: list[list[int]] = []
    for start_ms, end_ms in sorted(intervals):
        if end_ms <= start_ms:
            continue
        if merged and start_ms <= merged[-1][1] + max_gap_ms:
            merged[-1][1] = max(merged[-1][1], end_ms)
        else:
            merged.append([start_ms, end_ms])
    return [(start_ms, end_ms) for start_ms, end_ms in merged]


def total_interval_overlap(
    first_intervals: list[tuple[int, int]],
    second_intervals: list[tuple[int, int]],
) -> int:
    total = 0
    second_index = 0
    for first_start, first_end in first_intervals:
        while (
            second_index < len(second_intervals)
            and second_intervals[second_index][1] <= first_start
        ):
            second_index += 1
        index = second_index
        while index < len(second_intervals):
            second_start, second_end = second_intervals[index]
            if second_start >= first_end:
                break
            total += overlap_ms(first_start, first_end, second_start, second_end)
            index += 1
    return total


def build_shifted_subtitle_intervals(
    cues: list[Cue],
    offset_ms: int,
    audio_start_ms: int,
    audio_end_ms: int,
) -> list[tuple[int, int]]:
    min_cue_end = audio_start_ms - offset_ms
    max_cue_start = audio_end_ms - offset_ms
    return merge_activity_intervals(
        clip_intervals(
            [
                (cue.start_ms + offset_ms, cue.end_ms + offset_ms)
                for cue in cues
                if cue.end_ms > min_cue_end and cue.start_ms < max_cue_start
            ],
            audio_start_ms,
            audio_end_ms,
        ),
        SUBTITLE_ACTIVITY_MERGE_GAP_MS,
    )


def match_speech_anchors(
    speech_intervals: list[tuple[int, int]],
    subtitle_intervals: list[tuple[int, int]],
) -> tuple[int, list[int]]:
    used_subtitle_indices: set[int] = set()
    anchor_errors: list[int] = []
    last_subtitle_index = -1

    for speech_start, speech_end in speech_intervals:
        best_index: int | None = None
        best_rank: tuple[float, int] | None = None
        speech_duration = speech_end - speech_start

        for index, (subtitle_start, subtitle_end) in enumerate(
            subtitle_intervals
        ):
            if index in used_subtitle_indices or index <= last_subtitle_index:
                continue

            overlap = overlap_ms(
                speech_start,
                speech_end,
                subtitle_start,
                subtitle_end,
            )
            if overlap < MIN_SPEECH_ANCHOR_OVERLAP_MS:
                continue

            boundary_error = min(
                abs(speech_start - subtitle_start),
                abs(speech_end - subtitle_end),
            )
            overlap_ratio = overlap / max(
                MIN_SPEECH_ANCHOR_OVERLAP_MS,
                min(speech_duration, subtitle_end - subtitle_start),
            )
            if (
                boundary_error > MAX_SPEECH_ANCHOR_ERROR_MS
                and overlap_ratio < 0.25
            ):
                continue

            rank = (overlap_ratio, -boundary_error)
            if best_rank is None or rank > best_rank:
                best_index = index
                best_rank = rank

        if best_index is None or best_rank is None:
            continue

        used_subtitle_indices.add(best_index)
        last_subtitle_index = best_index
        subtitle_start, subtitle_end = subtitle_intervals[best_index]
        anchor_errors.append(
            min(
                abs(speech_start - subtitle_start),
                abs(speech_end - subtitle_end),
            )
        )

    return len(anchor_errors), anchor_errors


def evaluate_offset(
    cues: list[Cue],
    speech_intervals: list[tuple[int, int]],
    offset_ms: int,
    audio_start_ms: int,
    audio_end_ms: int,
) -> OffsetEvidence:
    if not cues or not speech_intervals:
        return OffsetEvidence(0.0, 0, 0, 0.0, 0)

    speech_activity = clip_intervals(
        speech_intervals,
        audio_start_ms,
        audio_end_ms,
    )
    subtitle_activity = build_shifted_subtitle_intervals(
        cues,
        offset_ms,
        audio_start_ms,
        audio_end_ms,
    )
    if not speech_activity or not subtitle_activity:
        return OffsetEvidence(
            0.0,
            0,
            len(speech_activity),
            0.0,
            0,
        )

    speech_duration = sum(end_ms - start_ms for start_ms, end_ms in speech_activity)
    subtitle_duration = sum(
        end_ms - start_ms for start_ms, end_ms in subtitle_activity
    )
    overlap_duration = total_interval_overlap(speech_activity, subtitle_activity)
    union_duration = speech_duration + subtitle_duration - overlap_duration
    if speech_duration <= 0 or subtitle_duration <= 0 or union_duration <= 0:
        return OffsetEvidence(
            0.0,
            0,
            len(speech_activity),
            0.0,
            0,
        )

    matched_anchors, anchor_errors = match_speech_anchors(
        speech_activity,
        subtitle_activity,
    )
    anchor_coverage = matched_anchors / len(speech_activity)
    median_anchor_error_ms = (
        sorted(anchor_errors)[len(anchor_errors) // 2]
        if anchor_errors
        else MAX_SPEECH_ANCHOR_ERROR_MS
    )

    speech_recall = overlap_duration / speech_duration
    subtitle_precision = overlap_duration / subtitle_duration
    activity_iou = overlap_duration / union_duration
    boundary_score = max(
        0.0,
        1.0 - median_anchor_error_ms / MAX_SPEECH_ANCHOR_ERROR_MS,
    )
    score = (
        activity_iou * 0.30
        + speech_recall * 0.20
        + subtitle_precision * 0.15
        + anchor_coverage * 0.25
        + boundary_score * 0.10
    )
    if matched_anchors == 0:
        score *= 0.5

    return OffsetEvidence(
        min(1.0, score),
        matched_anchors,
        len(speech_activity),
        anchor_coverage,
        median_anchor_error_ms,
    )


def score_offset(
    cues: list[Cue],
    speech_intervals: list[tuple[int, int]],
    offset_ms: int,
    audio_start_ms: int,
    audio_end_ms: int,
) -> float:
    return evaluate_offset(
        cues,
        speech_intervals,
        offset_ms,
        audio_start_ms,
        audio_end_ms,
    ).score


def find_best_offset(
    cues: list[Cue],
    speech_intervals: list[tuple[int, int]],
    audio_start_ms: int,
    audio_end_ms: int,
    search_centers: list[int] | None = None,
) -> tuple[int, float]:
    centers = search_centers or [0]

    def rank_offset(value: int) -> tuple[float, int]:
        dist_to_center = min(abs(value - c) for c in centers)
        return (
            score_offset(
                cues,
                speech_intervals,
                value,
                audio_start_ms,
                audio_end_ms,
            ),
            -dist_to_center,
        )
    coarse_candidates_set: set[int] = set()
    for center in centers:
        for offset in range(
            center - SEARCH_RANGE_MS,
            center + SEARCH_RANGE_MS + 1,
            SEARCH_STEP_MS,
        ):
            if abs(offset) <= MAX_PLAUSIBLE_ALIGNMENT_OFFSET_MS:
                coarse_candidates_set.add(offset)

    if not coarse_candidates_set:
        coarse_candidates_set.add(0)

    coarse_offset = max(coarse_candidates_set, key=rank_offset)
    refined_candidates = range(
        coarse_offset - REFINE_RANGE_MS,
        coarse_offset + REFINE_RANGE_MS + 1,
        REFINE_STEP_MS,
    )
    best_offset = max(refined_candidates, key=rank_offset)
    best_score = score_offset(
        cues,
        speech_intervals,
        best_offset,
        audio_start_ms,
        audio_end_ms,
    )
    return best_offset, best_score


def alignment_result_from_speech(
    cues: list[Cue],
    speech_intervals: list[tuple[int, int]],
    audio_start_ms: int,
    audio_end_ms: int,
    search_centers: list[int] | None = None,
    find_best_offset_fn: Callable[..., tuple[int, float]] | None = None,
) -> dict[str, Any]:
    if not speech_intervals:
        return {
            "aligned": False,
            "offsetMs": 0,
            "confidence": 0,
            "speechIntervals": [],
            "reason": "no_speech_detected",
        }
    total_speech_duration_ms = sum(
        max(0, end_ms - start_ms) for start_ms, end_ms in speech_intervals
    )
    if total_speech_duration_ms < MIN_ALIGNMENT_SPEECH_DURATION_MS:
        return {
            "aligned": False,
            "offsetMs": 0,
            "confidence": 0,
            "speechIntervals": [
                {"startMs": start_ms, "endMs": end_ms}
                for start_ms, end_ms in speech_intervals
            ],
            "reason": "insufficient_speech_in_window",
        }
    if not cues:
        return invalid_alignment_result(
            speech_intervals,
            "invalid_subtitle",
        )

    max_allowed_offset = (
        MAX_PLAUSIBLE_ALIGNMENT_OFFSET_MS
        if search_centers
        and any(abs(c) > MAX_ALIGNMENT_OFFSET_MS for c in search_centers)
        else MAX_ALIGNMENT_OFFSET_MS
    )

    find_offset = find_best_offset_fn or find_best_offset
    try:
        offset_ms, score = find_offset(
            cues,
            speech_intervals,
            audio_start_ms,
            audio_end_ms,
            search_centers=search_centers,
        )
    except TypeError:
        offset_ms, score = find_offset(
            cues,
            speech_intervals,
            audio_start_ms,
            audio_end_ms,
        )

    confidence = int(round(max(0.0, min(1.0, score)) * 100))
    if abs(offset_ms) >= max_allowed_offset:
        return {
            "aligned": False,
            "offsetMs": 0,
            "confidence": confidence,
            "speechIntervals": [
                {"startMs": start_ms, "endMs": end_ms}
                for start_ms, end_ms in speech_intervals
            ],
            "reason": "offset_out_of_range",
        }
    if confidence < MIN_ALIGNMENT_CONFIDENCE:
        return {
            "aligned": False,
            "offsetMs": 0,
            "confidence": confidence,
            "speechIntervals": [
                {"startMs": start_ms, "endMs": end_ms}
                for start_ms, end_ms in speech_intervals
            ],
            "reason": "low_alignment_confidence",
        }

    evidence = evaluate_offset(
        cues,
        speech_intervals,
        offset_ms,
        audio_start_ms,
        audio_end_ms,
    )
    minimum_anchors = 1 if evidence.speech_anchor_count <= 1 else 2
    if evidence.matched_anchors < minimum_anchors:
        return {
            "aligned": False,
            "offsetMs": 0,
            "confidence": confidence,
            "speechIntervals": [
                {"startMs": start_ms, "endMs": end_ms}
                for start_ms, end_ms in speech_intervals
            ],
            "speechAnchorCount": evidence.matched_anchors,
            "speechAnchorCoverage": evidence.anchor_coverage,
            "reason": "insufficient_speech_anchors",
        }

    minimum_anchor_coverage = (
        MIN_SPEECH_ANCHOR_COVERAGE
        if evidence.matched_anchors >= 3
        else MIN_SPEECH_ANCHOR_COVERAGE_2_ANCHORS
    )
    if evidence.anchor_coverage < minimum_anchor_coverage:
        return {
            "aligned": False,
            "offsetMs": 0,
            "confidence": confidence,
            "speechIntervals": [
                {"startMs": start_ms, "endMs": end_ms}
                for start_ms, end_ms in speech_intervals
            ],
            "speechAnchorCount": evidence.matched_anchors,
            "speechAnchorCoverage": evidence.anchor_coverage,
            "reason": "insufficient_speech_anchors",
        }

    # Keep the original timeline in the response. The renderer aggregates
    # multiple windows and applies one consensus offset once; local snapping
    # from a single window would mix evidence and can double-shift cues.
    return {
        "aligned": confidence >= MIN_ALIGNMENT_CONFIDENCE,
        "offsetMs": offset_ms,
        "confidence": confidence,
        "speechIntervals": [
            {"startMs": start_ms, "endMs": end_ms}
            for start_ms, end_ms in speech_intervals
        ],
        "speechAnchorCount": evidence.matched_anchors,
        "speechAnchorCoverage": evidence.anchor_coverage,
        "reason": None,
    }


def invalid_alignment_result(
    speech_intervals: list[tuple[int, int]],
    reason: str,
) -> dict[str, Any]:
    return {
        "aligned": False,
        "offsetMs": 0,
        "confidence": 0,
        "speechIntervals": [
            {"startMs": start_ms, "endMs": end_ms}
            for start_ms, end_ms in speech_intervals
        ],
        "reason": reason,
    }


def compute_track_search_centers(
    cues: list[Cue] | None,
    speech_intervals: list[tuple[int, int]],
    audio_start_ms: int,
    additional_hints: list[int] | None = None,
    max_offset_ms: int = MAX_PLAUSIBLE_ALIGNMENT_OFFSET_MS,
) -> list[int]:
    centers: set[int] = {0}
    if additional_hints:
        for hint in additional_hints:
            if abs(hint) <= max_offset_ms:
                centers.add(hint)

    if cues and speech_intervals and audio_start_ms <= 60_000:
        sub_first_ms = estimate_initial_cue_start_ms(cues)
        if sub_first_ms is not None:
            speech_first_ms = speech_intervals[0][0]
            speech_guided_offset = speech_first_ms - sub_first_ms
            if abs(speech_guided_offset) <= max_offset_ms:
                centers.add(speech_guided_offset)

    return sorted(centers)


def align_vtt(
    audio_data: bytes,
    vtt: str,
    language: str,
    audio_start_ms: int,
    decode_wav_fn: Callable[[bytes], tuple[list[float], int]] | None = None,
    transcribe_speech_intervals_fn: Callable[
        [list[float], int, str, int],
        list[tuple[int, int]],
    ]
    | None = None,
    alignment_result_fn: Callable[..., dict[str, Any]] | None = None,
) -> dict[str, Any]:
    decode = decode_wav_fn or decode_wav
    transcribe = transcribe_speech_intervals_fn or transcribe_speech_intervals
    audio, sample_rate = decode(audio_data)
    audio_duration_ms = int(round(len(audio) * 1_000 / sample_rate))
    audio_end_ms = audio_start_ms + audio_duration_ms
    speech_intervals = transcribe(
        audio,
        sample_rate,
        language,
        audio_start_ms,
    )
    return align_speech_batch(
        speech_intervals,
        [{"track": "primary", "vttData": vtt}],
        audio_start_ms,
        audio_end_ms,
        alignment_result_fn=alignment_result_fn,
    )["results"]["primary"]


def align_speech_batch(
    speech_intervals: list[tuple[int, int]],
    subtitles: list[dict[str, str]],
    audio_start_ms: int,
    audio_end_ms: int,
    alignment_result_fn: Callable[..., dict[str, Any]] | None = None,
    parsed_tracks: dict[str, list[Cue] | None] | None = None,
    delta_hint_ms: int | None = None,
    has_precomputed_delta: bool = False,
) -> dict[str, Any]:
    result_from_speech = alignment_result_fn or alignment_result_from_speech
    speech_intervals = merge_intervals(speech_intervals)

    if parsed_tracks is None:
        parsed_tracks = {}
        for subtitle in subtitles:
            track = subtitle["track"]
            vtt = subtitle.get("vttData", "")
            try:
                parsed_tracks[track] = parse_alignment_cues(vtt)
            except (IndexError, ValueError):
                parsed_tracks[track] = None

    primary_cues = parsed_tracks.get("primary")
    secondary_cues = parsed_tracks.get("secondary")
    if not has_precomputed_delta:
        delta_hint_ms = estimate_subtitle_relative_offset(
            primary_cues, secondary_cues
        )

    results: dict[str, Any] = {}
    primary_offset_ms: int | None = None

    # 1. Align primary track first
    if "primary" in parsed_tracks:
        cues = parsed_tracks["primary"]
        if cues is None:
            results["primary"] = invalid_alignment_result(
                speech_intervals,
                "invalid_subtitle",
            )
        else:
            primary_hints = (
                [-delta_hint_ms] if delta_hint_ms is not None else None
            )
            primary_search_centers = compute_track_search_centers(
                cues,
                speech_intervals,
                audio_start_ms,
                additional_hints=primary_hints,
            )
            try:
                res = result_from_speech(
                    cues,
                    speech_intervals,
                    audio_start_ms,
                    audio_end_ms,
                    search_centers=primary_search_centers,
                )
            except TypeError:
                res = result_from_speech(
                    cues,
                    speech_intervals,
                    audio_start_ms,
                    audio_end_ms,
                )
            results["primary"] = res
            if res.get("aligned") and isinstance(res.get("offsetMs"), int):
                primary_offset_ms = res["offsetMs"]

    # 2. Align secondary and other tracks
    for subtitle in subtitles:
        track = subtitle["track"]
        if track == "primary":
            continue
        cues = parsed_tracks.get(track)
        if cues is None:
            results[track] = invalid_alignment_result(
                speech_intervals,
                "invalid_subtitle",
            )
            continue

        hints: list[int] = []
        if delta_hint_ms is not None:
            if primary_offset_ms is not None:
                hints.append(primary_offset_ms + delta_hint_ms)
            hints.append(delta_hint_ms)

        track_search_centers = compute_track_search_centers(
            cues,
            speech_intervals,
            audio_start_ms,
            additional_hints=hints,
        )

        try:
            results[track] = result_from_speech(
                cues,
                speech_intervals,
                audio_start_ms,
                audio_end_ms,
                search_centers=track_search_centers,
            )
        except TypeError:
            results[track] = result_from_speech(
                cues,
                speech_intervals,
                audio_start_ms,
                audio_end_ms,
            )
    return {"results": results}


def align_vtt_batch(
    audio_data: bytes,
    subtitles: list[dict[str, str]],
    language: str,
    audio_start_ms: int,
    decode_wav_fn: Callable[[bytes], tuple[list[float], int]] | None = None,
    transcribe_speech_intervals_fn: Callable[
        [list[float], int, str, int],
        list[tuple[int, int]],
    ]
    | None = None,
    alignment_result_fn: Callable[..., dict[str, Any]] | None = None,
) -> dict[str, Any]:
    decode = decode_wav_fn or decode_wav
    transcribe = transcribe_speech_intervals_fn or transcribe_speech_intervals
    audio, sample_rate = decode(audio_data)
    audio_duration_ms = int(round(len(audio) * 1_000 / sample_rate))
    audio_end_ms = audio_start_ms + audio_duration_ms
    speech_intervals = transcribe(
        audio,
        sample_rate,
        language,
        audio_start_ms,
    )
    return align_speech_batch(
        speech_intervals,
        subtitles,
        audio_start_ms,
        audio_end_ms,
        alignment_result_fn=alignment_result_fn,
    )


def _cluster_alignment_candidates(
    candidates: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    sorted_candidates = sorted(
        candidates,
        key=lambda item: int(item["result"].get("offsetMs", 0)),
    )
    clusters: list[dict[str, Any]] = []

    for candidate in sorted_candidates:
        current = clusters[-1] if clusters else None
        current_candidates = current["candidates"] if current else []
        if (
            current
            and int(candidate["result"].get("offsetMs", 0))
            - int(current_candidates[0]["result"].get("offsetMs", 0))
            <= 1_200
        ):
            current_candidates.append(candidate)
            continue
        clusters.append({"candidates": [candidate]})

    for cluster in clusters:
        cluster_candidates = cluster["candidates"]
        cluster["averageConfidence"] = sum(
            int(item["result"].get("confidence", 0))
            for item in cluster_candidates
        ) / len(cluster_candidates)
        cluster["averageOffsetMs"] = sum(
            int(item["result"].get("offsetMs", 0))
            for item in cluster_candidates
        ) / len(cluster_candidates)
        cluster["score"] = len(cluster_candidates) * 100 + cluster[
            "averageConfidence"
        ]

    return clusters


def _has_speech_evidence(result: dict[str, Any]) -> bool:
    return (
        result.get("reason")
        not in {"no_speech_detected", "insufficient_speech_in_window"}
        and bool(result.get("speechIntervals"))
    )


def _build_unaligned_consensus_result(
    candidates: list[dict[str, Any]],
    reason: str,
) -> dict[str, Any]:
    best = max(
        candidates,
        key=lambda item: int(item.get("confidence", 0)),
        default=None,
    )
    return {
        "aligned": False,
        "offsetMs": 0,
        "confidence": int(best.get("confidence", 0)) if best else 0,
        "speechIntervals": best.get("speechIntervals", []) if best else [],
        "reason": reason,
    }


def select_alignment_consensus(
    entries: list[dict[str, Any]],
) -> dict[str, Any]:
    candidates = [entry["result"] for entry in entries]
    speech_candidates = [
        result for result in candidates if _has_speech_evidence(result)
    ]
    valid_entries = [
        entry
        for entry in entries
        if _has_speech_evidence(entry["result"])
        and entry["result"].get("aligned") is True
        and isinstance(entry["result"].get("offsetMs"), int)
        and int(entry["result"].get("confidence", 0)) >= MIN_ALIGNMENT_CONFIDENCE
        and abs(int(entry["result"].get("offsetMs", 0)))
        <= MAX_PLAUSIBLE_ALIGNMENT_OFFSET_MS
    ]

    if not valid_entries:
        return _build_unaligned_consensus_result(
            candidates,
            "no_speech_detected"
            if not speech_candidates
            else "low_alignment_confidence",
        )

    clusters = sorted(
        _cluster_alignment_candidates(valid_entries),
        key=lambda cluster: cluster["score"],
        reverse=True,
    )
    best_cluster = clusters[0]
    second_cluster = clusters[1] if len(clusters) > 1 else None
    score_margin = (
        best_cluster["score"] - second_cluster["score"]
        if second_cluster
        else float("inf")
    )

    intro_entry = next(
        (entry for entry in valid_entries if entry["startAt"] <= 120),
        None,
    )
    main_entries = [
        entry for entry in valid_entries if entry["startAt"] > 120
    ]
    if (
        intro_entry
        and main_entries
        and int(intro_entry["result"].get("confidence", 0)) >= 75
    ):
        main_clusters = sorted(
            _cluster_alignment_candidates(main_entries),
            key=lambda cluster: cluster["score"],
            reverse=True,
        )
        main_best_cluster = main_clusters[0] if main_clusters else None
        if (
            main_best_cluster
            and main_best_cluster["averageConfidence"]
            >= MIN_ALIGNMENT_CONFIDENCE
            and abs(
                int(intro_entry["result"].get("offsetMs", 0))
                - main_best_cluster["averageOffsetMs"]
            )
            > 15_000
        ):
            intro_offset = int(intro_entry["result"]["offsetMs"])
            main_offset = round(main_best_cluster["averageOffsetMs"])
            return {
                **intro_entry["result"],
                "aligned": True,
                "offsetMs": main_offset,
                "confidence": round(
                    (
                        int(intro_entry["result"].get("confidence", 0))
                        + main_best_cluster["averageConfidence"]
                    )
                    / 2
                ),
                "segments": [
                    {
                        "startMs": 0,
                        "endMs": 180_000,
                        "offsetMs": intro_offset,
                    },
                    {
                        "startMs": 180_000,
                        "endMs": 9_007_199_254_740_991,
                        "offsetMs": main_offset,
                    },
                ],
                "reason": None,
            }

    has_consensus = (
        len(best_cluster["candidates"]) >= 2
        and best_cluster["averageConfidence"] >= MIN_ALIGNMENT_CONFIDENCE
        and score_margin >= 10
    )
    if not has_consensus:
        return _build_unaligned_consensus_result(
            candidates,
            "insufficient_consensus"
            if len(best_cluster["candidates"]) < 2
            else "ambiguous_alignment",
        )

    representative = max(
        best_cluster["candidates"],
        key=lambda item: int(item["result"].get("confidence", 0)),
    )["result"]
    return {
        **representative,
        "aligned": True,
        "offsetMs": round(best_cluster["averageOffsetMs"]),
        "confidence": round(best_cluster["averageConfidence"]),
        "reason": None,
    }


def align_speech_windows(
    windows: list[tuple[list[tuple[int, int]], int, int]],
    subtitles: list[dict[str, str]],
    alignment_result_fn: Callable[..., dict[str, Any]] | None = None,
) -> dict[str, Any]:
    entries_by_track: dict[str, list[dict[str, Any]]] = {
        subtitle["track"]: [] for subtitle in subtitles
    }

    parsed_tracks: dict[str, list[Cue] | None] = {}
    for subtitle in subtitles:
        track = subtitle["track"]
        vtt = subtitle.get("vttData", "")
        try:
            parsed_tracks[track] = parse_alignment_cues(vtt)
        except (IndexError, ValueError):
            parsed_tracks[track] = None

    primary_cues = parsed_tracks.get("primary")
    secondary_cues = parsed_tracks.get("secondary")
    delta_hint_ms = estimate_subtitle_relative_offset(
        primary_cues, secondary_cues
    )

    for speech_intervals, audio_start_ms, audio_end_ms in windows:
        window_result = align_speech_batch(
            speech_intervals,
            subtitles,
            audio_start_ms,
            audio_end_ms,
            alignment_result_fn=alignment_result_fn,
            parsed_tracks=parsed_tracks,
            delta_hint_ms=delta_hint_ms,
            has_precomputed_delta=True,
        )
        for track, result in window_result["results"].items():
            entries_by_track.setdefault(track, []).append(
                {
                    "startAt": audio_start_ms / 1_000,
                    "result": result,
                }
            )

    return {
        "results": {
            track: select_alignment_consensus(entries)
            for track, entries in entries_by_track.items()
        }
    }


def align_vtt_windows(
    windows: list[tuple[bytes, int]],
    subtitles: list[dict[str, str]],
    language: str,
    decode_wav_fn: Callable[[bytes], tuple[list[float], int]] | None = None,
    transcribe_speech_intervals_fn: Callable[
        [list[float], int, str, int],
        list[tuple[int, int]],
    ]
    | None = None,
    alignment_result_fn: Callable[..., dict[str, Any]] | None = None,
) -> dict[str, Any]:
    decode = decode_wav_fn or decode_wav
    transcribe = transcribe_speech_intervals_fn or transcribe_speech_intervals
    speech_windows: list[tuple[list[tuple[int, int]], int, int]] = []

    for audio_data, audio_start_ms in windows:
        audio, sample_rate = decode(audio_data)
        audio_duration_ms = int(round(len(audio) * 1_000 / sample_rate))
        audio_end_ms = audio_start_ms + audio_duration_ms
        speech_intervals = transcribe(
            audio,
            sample_rate,
            language,
            audio_start_ms,
        )
        speech_windows.append((speech_intervals, audio_start_ms, audio_end_ms))

    return align_speech_windows(
        speech_windows,
        subtitles,
        alignment_result_fn=alignment_result_fn,
    )
