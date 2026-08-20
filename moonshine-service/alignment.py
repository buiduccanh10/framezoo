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
ACTIVITY_FINGERPRINT_BIN_MS = 100
ACTIVITY_FINGERPRINT_TOP_K = 8
ACTIVITY_FINGERPRINT_REFINE_RANGE_MS = 500
SUBTITLE_ACTIVITY_MERGE_GAP_MS = 250
MAX_SPEECH_ANCHOR_ERROR_MS = 1_800
MIN_SPEECH_ANCHOR_OVERLAP_MS = 120
MIN_SPEECH_ANCHOR_COVERAGE = 0.20
MIN_SPEECH_ANCHOR_COVERAGE_2_ANCHORS = 0.25
# Subtitle starts are the most reliable boundary for avoiding visible
# pre-roll. Keep a small lead-in grace period for natural subtitle timing.
SUBTITLE_EARLY_START_GRACE_MS = 250
SPEECH_ANCHOR_START_WEIGHT = 0.65
SPEECH_ANCHOR_END_WEIGHT = 0.35
SPEECH_ANCHOR_EARLY_START_PENALTY_WEIGHT = 0.15
_TRANSCRIPTION_LOCK = threading.Lock()


CREDIT_AD_PATTERNS = re.compile(
    r"(?i)("
    r"https?://|www\.|osdb\.link|\.org\b|\.com\b|\.net\b|\.link\b|\.tv\b|\.me\b|\.app\b|"
    r"opensubtitles|subscene|addic7ed|podnapisi|yify|rarbg|psa\b|"
    r"vip\s*member|remove\s*all\s*ads|watch\s*online|support\s*us|"
    r"subtitles?\s*(by|downloaded|created|sync)|"
    r"synced?\s*by|resync\s*by|corrected\s*by|"
    r"dịch\s*bởi|biên\s*dịch|thực\s*hiện\s*bởi|vietsub\s*bởi|"
    r"phimmoi|xemphim|motphim|bilutv|tvhay"
    r")"
)

MALFORMED_ENCODING_PATTERNS = re.compile(
    r"\ufffd|[\u0080-\u009f]|"
    r"(?:\u00c3|\u00c2)[\u0080-\u00bf]|"
    r"\u00e2(?:[\u0080-\u00bf]|\u20ac|\u2122|\u0153|\u2013|\u2014)|"
    r"\u00f0[\u0080-\u00bf]"
)
MOJIBAKE_SYMBOLS = frozenset(
    "\u00a4\u00a6\u00ab\u00ac\u00b1\u00b5\u00b6\u00bb\u00bc"
    "\u00bd\u00be\u00bf\u00d7"
)


@dataclass(frozen=True)
class Cue:
    index: int
    start_ms: int
    end_ms: int
    block: str


def is_credit_or_ad_cue(cue: Cue) -> bool:
    return bool(CREDIT_AD_PATTERNS.search(cue.block))

def _cue_text(cue: Cue) -> str:
    lines = cue.block.splitlines()
    return " ".join(
        line.strip()
        for line in lines
        if line.strip()
        and not line.strip().isdigit()
        and not TIMING_RE.match(line)
    )

def is_malformed_encoding_cue(cue: Cue) -> bool:
    text = _cue_text(cue)
    if not text:
        return False
    if MALFORMED_ENCODING_PATTERNS.search(text):
        return True

    compact_text = re.sub(r"\s+", "", text)
    symbol_count = sum(
        character in MOJIBAKE_SYMBOLS for character in compact_text
    )
    high_byte_count = sum(
        0x80 <= ord(character) <= 0xFF for character in compact_text
    )
    return (
        symbol_count >= 3
        and high_byte_count >= 6
        and symbol_count / max(1, len(compact_text)) >= 0.05
    )

def filter_alignment_cues(cues: list[Cue]) -> list[Cue]:
    usable_cues = [
        cue
        for cue in cues
        if not is_credit_or_ad_cue(cue) and not is_malformed_encoding_cue(cue)
    ]
    if usable_cues:
        return usable_cues

    # Preserve the existing ad-only fallback, but never reintroduce
    # malformed-encoding cues as alignment anchors.
    return [cue for cue in cues if not is_malformed_encoding_cue(cue)]


def estimate_initial_cue_start_ms(cues: list[Cue] | None) -> int | None:
    if not cues:
        return None
    dialogue_cues = filter_alignment_cues(cues)
    if not dialogue_cues:
        return None
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

    clean_p = filter_alignment_cues(primary_cues)
    clean_s = filter_alignment_cues(secondary_cues)

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
    return filter_alignment_cues(cues)


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


def _fingerprint_bits_for_intervals(
    intervals: list[tuple[int, int]],
    origin_ms: int,
    end_ms: int,
) -> int:
    bits = 0
    bin_ms = ACTIVITY_FINGERPRINT_BIN_MS
    for start_ms, interval_end_ms in intervals:
        clipped_start = max(origin_ms, start_ms)
        clipped_end = min(end_ms, interval_end_ms)
        if clipped_end <= clipped_start:
            continue

        first_bin = max(0, (clipped_start - origin_ms) // bin_ms)
        last_bin = max(
            first_bin + 1,
            (clipped_end - origin_ms + bin_ms - 1) // bin_ms,
        )
        bits |= ((1 << (last_bin - first_bin)) - 1) << first_bin
    return bits


def _shift_fingerprint_bits(bits: int, offset_ms: int) -> int:
    offset_bins = int(round(offset_ms / ACTIVITY_FINGERPRINT_BIN_MS))
    if offset_bins >= 0:
        return bits << offset_bins
    return bits >> -offset_bins


def _fingerprint_bit_count(bits: int) -> int:
    bit_count = getattr(bits, "bit_count", None)
    if bit_count is not None:
        return bit_count()
    return bin(bits).count("1")


def _build_activity_fingerprint(
    cues: list[Cue],
    speech_intervals: list[tuple[int, int]],
    audio_start_ms: int,
    audio_end_ms: int,
) -> tuple[int, int, int]:
    max_offset_ms = MAX_PLAUSIBLE_ALIGNMENT_OFFSET_MS
    origin_ms = audio_start_ms - max_offset_ms
    fingerprint_end_ms = audio_end_ms + max_offset_ms
    audio_mask = _fingerprint_bits_for_intervals(
        [(audio_start_ms, audio_end_ms)],
        origin_ms,
        fingerprint_end_ms,
    )
    speech_bits = _fingerprint_bits_for_intervals(
        clip_intervals(speech_intervals, audio_start_ms, audio_end_ms),
        origin_ms,
        fingerprint_end_ms,
    )
    subtitle_intervals = merge_activity_intervals(
        [
            (cue.start_ms, cue.end_ms)
            for cue in cues
            if cue.end_ms > origin_ms and cue.start_ms < fingerprint_end_ms
        ],
        SUBTITLE_ACTIVITY_MERGE_GAP_MS,
    )
    subtitle_bits = _fingerprint_bits_for_intervals(
        subtitle_intervals,
        origin_ms,
        fingerprint_end_ms,
    )
    return speech_bits, subtitle_bits, audio_mask


def _score_activity_fingerprint(
    speech_bits: int,
    subtitle_bits: int,
    audio_mask: int,
    offset_ms: int,
) -> float:
    shifted_subtitle_bits = _shift_fingerprint_bits(
        subtitle_bits,
        offset_ms,
    ) & audio_mask
    speech_count = _fingerprint_bit_count(speech_bits)
    subtitle_count = _fingerprint_bit_count(shifted_subtitle_bits)
    if speech_count == 0 or subtitle_count == 0:
        return 0.0

    overlap_count = _fingerprint_bit_count(speech_bits & shifted_subtitle_bits)
    union_count = _fingerprint_bit_count(speech_bits | shifted_subtitle_bits)
    if overlap_count == 0 or union_count == 0:
        return 0.0

    recall = overlap_count / speech_count
    precision = overlap_count / subtitle_count
    iou = overlap_count / union_count
    return iou * 0.50 + recall * 0.25 + precision * 0.25


def _match_speech_anchor_boundaries(
    speech_intervals: list[tuple[int, int]],
    subtitle_intervals: list[tuple[int, int]],
) -> tuple[int, list[tuple[int, int, int]]]:
    used_subtitle_indices: set[int] = set()
    anchor_errors: list[tuple[int, int, int]] = []
    last_subtitle_index = -1

    for speech_start, speech_end in speech_intervals:
        best_index: int | None = None
        best_rank: tuple[float, float] | None = None
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

            start_error = abs(speech_start - subtitle_start)
            end_error = abs(speech_end - subtitle_end)
            early_start_error = max(
                0,
                speech_start
                - subtitle_start
                - SUBTITLE_EARLY_START_GRACE_MS,
            )
            boundary_error = max(start_error, end_error)
            weighted_boundary_error = (
                start_error * SPEECH_ANCHOR_START_WEIGHT
                + end_error * SPEECH_ANCHOR_END_WEIGHT
                + early_start_error
                * SPEECH_ANCHOR_EARLY_START_PENALTY_WEIGHT
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

            rank = (overlap_ratio, -weighted_boundary_error)
            if best_rank is None or rank > best_rank:
                best_index = index
                best_rank = rank

        if best_index is None or best_rank is None:
            continue

        used_subtitle_indices.add(best_index)
        last_subtitle_index = best_index
        subtitle_start, subtitle_end = subtitle_intervals[best_index]
        anchor_errors.append(
            (
                abs(speech_start - subtitle_start),
                abs(speech_end - subtitle_end),
                max(
                    0,
                    speech_start
                    - subtitle_start
                    - SUBTITLE_EARLY_START_GRACE_MS,
                ),
            )
        )

    return len(anchor_errors), anchor_errors


def match_speech_anchors(
    speech_intervals: list[tuple[int, int]],
    subtitle_intervals: list[tuple[int, int]],
) -> tuple[int, list[int]]:
    matched_anchors, boundary_errors = _match_speech_anchor_boundaries(
        speech_intervals,
        subtitle_intervals,
    )
    return matched_anchors, [
        min(start_error, end_error)
        for start_error, end_error, _ in boundary_errors
    ]


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

    matched_anchors, anchor_errors = _match_speech_anchor_boundaries(
        speech_activity,
        subtitle_activity,
    )
    anchor_coverage = matched_anchors / len(speech_activity)
    start_errors = [errors[0] for errors in anchor_errors]
    end_errors = [errors[1] for errors in anchor_errors]
    early_start_errors = [errors[2] for errors in anchor_errors]
    median_start_error_ms = (
        sorted(start_errors)[len(start_errors) // 2]
        if start_errors
        else MAX_SPEECH_ANCHOR_ERROR_MS
    )
    median_end_error_ms = (
        sorted(end_errors)[len(end_errors) // 2]
        if end_errors
        else MAX_SPEECH_ANCHOR_ERROR_MS
    )
    median_early_start_error_ms = (
        sorted(early_start_errors)[len(early_start_errors) // 2]
        if early_start_errors
        else 0
    )
    median_anchor_error_ms = (
        round(
            median_start_error_ms * SPEECH_ANCHOR_START_WEIGHT
            + median_end_error_ms * SPEECH_ANCHOR_END_WEIGHT
            + median_early_start_error_ms
            * SPEECH_ANCHOR_EARLY_START_PENALTY_WEIGHT
        )
        if anchor_errors
        else MAX_SPEECH_ANCHOR_ERROR_MS
    )

    speech_recall = overlap_duration / speech_duration
    subtitle_precision = overlap_duration / subtitle_duration
    activity_iou = overlap_duration / union_duration
    start_score = max(
        0.0,
        1.0 - median_start_error_ms / MAX_SPEECH_ANCHOR_ERROR_MS,
    )
    end_score = max(
        0.0,
        1.0 - median_end_error_ms / MAX_SPEECH_ANCHOR_ERROR_MS,
    )
    early_start_penalty = min(
        1.0,
        median_early_start_error_ms / MAX_SPEECH_ANCHOR_ERROR_MS,
    )
    boundary_score = max(
        0.0,
        start_score * SPEECH_ANCHOR_START_WEIGHT
        + end_score * SPEECH_ANCHOR_END_WEIGHT
        - early_start_penalty * SPEECH_ANCHOR_EARLY_START_PENALTY_WEIGHT,
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

    def rank_offset(value: int) -> tuple[float, int, int]:
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
            -abs(value),
        )

    speech_bits, subtitle_bits, audio_mask = _build_activity_fingerprint(
        cues,
        speech_intervals,
        audio_start_ms,
        audio_end_ms,
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

    fingerprint_ranked_candidates = sorted(
        coarse_candidates_set,
        key=lambda value: (
            _score_activity_fingerprint(
                speech_bits,
                subtitle_bits,
                audio_mask,
                value,
            ),
            -min(abs(value - center) for center in centers),
            -abs(value),
        ),
        reverse=True,
    )
    top_fingerprint_score = _score_activity_fingerprint(
        speech_bits,
        subtitle_bits,
        audio_mask,
        fingerprint_ranked_candidates[0],
    )

    if top_fingerprint_score > 0:
        coarse_candidates = set(
            fingerprint_ranked_candidates[:ACTIVITY_FINGERPRINT_TOP_K]
        )
        for center in centers:
            coarse_candidates.add(
                min(
                    coarse_candidates_set,
                    key=lambda value: abs(value - center),
                )
            )
        refined_candidates_set: set[int] = set()
        for coarse_offset in coarse_candidates:
            refined_candidates_set.update(
                range(
                    coarse_offset - ACTIVITY_FINGERPRINT_REFINE_RANGE_MS,
                    coarse_offset
                    + ACTIVITY_FINGERPRINT_REFINE_RANGE_MS
                    + 1,
                    REFINE_STEP_MS,
                )
            )
        refined_candidates = refined_candidates_set
    else:
        # Preserve the exhaustive path for sparse or empty fingerprints.
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

    if cues and speech_intervals:
        candidate_cues = filter_alignment_cues(cues)
        if not candidate_cues:
            return sorted(centers)
        speech_first_ms = speech_intervals[0][0]
        nearest_cue = min(
            candidate_cues,
            key=lambda cue: abs(cue.start_ms - speech_first_ms),
        )
        anchor_starts = {candidate_cues[0].start_ms, nearest_cue.start_ms}
        for anchor_start_ms in anchor_starts:
            speech_guided_offset = speech_first_ms - anchor_start_ms
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

    results: dict[str, Any] = {}
    for subtitle in subtitles:
        track = subtitle["track"]
        cues = parsed_tracks.get(track)
        if cues is None:
            results[track] = invalid_alignment_result(
                speech_intervals,
                "invalid_subtitle",
            )
            continue

        track_search_centers = compute_track_search_centers(
            cues,
            speech_intervals,
            audio_start_ms,
        )
        try:
            res = result_from_speech(
                cues,
                speech_intervals,
                audio_start_ms,
                audio_end_ms,
                search_centers=track_search_centers,
            )
        except TypeError:
            res = result_from_speech(
                cues,
                speech_intervals,
                audio_start_ms,
                audio_end_ms,
            )
        results[track] = res

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

    for speech_intervals, audio_start_ms, audio_end_ms in windows:
        window_result = align_speech_batch(
            speech_intervals,
            subtitles,
            audio_start_ms,
            audio_end_ms,
            alignment_result_fn=alignment_result_fn,
            parsed_tracks=parsed_tracks,
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
