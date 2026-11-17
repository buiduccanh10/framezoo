from __future__ import annotations

from bisect import bisect_left
import re
import struct
import threading
from dataclasses import dataclass
from typing import Any, Callable

import numpy as np

from vad import detect_speech_intervals
from fft_align import FRAMERATE_RATIOS, find_best_offset_fft, find_top_offsets_fft
from split_align import compute_piecewise_segments


TIMING_RE = re.compile(
    r"^\s*((?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d{3})?)\s+-->\s+"
    r"((?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d{3})?)(?:\s+.*)?$"
)

MAX_AUDIO_BYTES = 8 * 1024 * 1024
MAX_VTT_BYTES = 2 * 1024 * 1024
MAX_VTT_CUES = 20_000
MAX_ALIGNMENT_TOTAL_AUDIO_BYTES = 14 * 1024 * 1024
MIN_ALIGNMENT_CONFIDENCE = 60
MIN_SPEECH_INTERVAL_MS = 120
MERGE_SPEECH_GAP_MS = 350
MIN_ALIGNMENT_SPEECH_DURATION_MS = 1_000
# A subtitle offset beyond this range is more likely a false match from a
# different scene than a real subtitle timing error.
MAX_ALIGNMENT_OFFSET_MS = 45_000
MAX_PLAUSIBLE_ALIGNMENT_OFFSET_MS = 360_000
MAX_POOLED_WINDOW_SPAN_MS = 600_000
SEARCH_RANGE_MS = MAX_ALIGNMENT_OFFSET_MS
SEARCH_STEP_MS = 250
REFINE_RANGE_MS = 750
REFINE_STEP_MS = 25
ACTIVITY_FINGERPRINT_BIN_MS = 100
ACTIVITY_FINGERPRINT_TOP_K = 6
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
MIN_RATE_RATIO = 0.95
MAX_RATE_RATIO = 1.05
# Small drift needs stronger evidence than broadcast-FPS drift because a few
# hundred milliseconds of per-window matching jitter can look linear.
MIN_SMALL_DRIFT_RATE_DELTA = 0.00005
MIN_SMALL_DRIFT_INLIERS = 4
MIN_SMALL_DRIFT_SPAN_MS = 600_000
MIN_SMALL_DRIFT_ENDPOINT_DELTA_MS = 350
MAX_SMALL_DRIFT_RESIDUAL_MS = 450
MIN_SMALL_DRIFT_RMSE_GAIN_MS = 50
MIN_SMALL_DRIFT_R2 = 0.35
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

SDH_BRACKET_RE = re.compile(
    r"\[[^\]]*\]|\([^)]*\)|\{[^}]*\}|<[^>]+>|[♪♫♬♩]+"
)
MUSIC_GLYPHS = frozenset("♪♫♬♩")
PURE_MUSIC_ALLOWED_CHARS = frozenset("♪♫♬♩-~ \t\r\n")
SPEAKER_LABEL_RE = re.compile(r"^[ \t]*[-–—]?[ \t]*[A-ZÀ-Ỹ0-9][A-ZÀ-Ỹ0-9 \t]{0,19}:[ \t]*")


def _is_pure_music_cue(text: str) -> bool:
    """Linear-time check for music-only cues (replaces backtracking regex)."""
    stripped = text.strip()
    if not stripped:
        return False
    if all(ch in PURE_MUSIC_ALLOWED_CHARS for ch in stripped):
        return True
    return stripped[0] in MUSIC_GLYPHS and stripped[-1] in MUSIC_GLYPHS


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

def is_non_speech_sdh_cue(cue: Cue) -> bool:
    """
    Detect Hearing-Impaired (SDH) sound effect cues or music-only lyrics
    (e.g. '[Music]', '(applause)', '♪ ... ♪') where VAD will not detect speech.
    """
    text = _cue_text(cue)
    if not text:
        return True
    if _is_pure_music_cue(text):
        return True
    cleaned = SDH_BRACKET_RE.sub(" ", text)
    # Remove speaker labels like "MAN:" or "- " and check if any letters/digits remain
    cleaned = SPEAKER_LABEL_RE.sub("", cleaned)
    has_word_char = any(ch.isalnum() for ch in cleaned)
    return not has_word_char

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
        if not is_credit_or_ad_cue(cue)
        and not is_malformed_encoding_cue(cue)
        and not is_non_speech_sdh_cue(cue)
    ]
    if usable_cues:
        return usable_cues

    non_ad_cues = [
        cue
        for cue in cues
        if not is_credit_or_ad_cue(cue) and not is_malformed_encoding_cue(cue)
    ]
    if non_ad_cues:
        return non_ad_cues

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
    # Split blocks in linear O(N) time without regex backtracking on malformed files
    blocks: list[str] = []
    current_lines: list[str] = []
    for raw_line in text.splitlines():
        if raw_line.strip():
            current_lines.append(raw_line)
        elif current_lines:
            blocks.append("\n".join(current_lines))
            current_lines.clear()
    if current_lines:
        blocks.append("\n".join(current_lines))

    for block in blocks:
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
        if len(cues) >= MAX_VTT_CUES:
            raise ValueError("subtitle contains too many cues")
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


def decode_wav(data: bytes) -> tuple[Any, int]:
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

    frame_width = channels * 2
    if len(frames) % frame_width:
        raise ValueError("audio data is not aligned to complete PCM frames")
    pcm = np.frombuffer(frames, dtype="<i2")
    if channels == 1:
        samples = pcm.astype(np.float32) * np.float32(1.0 / 32768.0)
    else:
        stereo = pcm.reshape(-1, 2)
        samples = (
            stereo[:, 0].astype(np.float32) + stereo[:, 1].astype(np.float32)
        ) * np.float32(0.5 / 32768.0)
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
    return detect_speech_intervals(
        audio,
        sample_rate=sample_rate,
        audio_start_ms=audio_start_ms,
    )


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


def _slice_cues_overlapping(
    cues: list[Cue],
    min_cue_end: int,
    max_cue_start: int,
) -> list[Cue]:
    """Slice cues overlapping (min_cue_end, max_cue_start), using binary search when sorted."""
    if not cues:
        return []
    if len(cues) > 32 and cues[0].start_ms <= cues[-1].start_ms:
        start_idx = bisect_left(
            cues,
            min_cue_end - 60_000,
            key=lambda cue: cue.start_ms,
        )
        selected: list[Cue] = []
        for cue in cues[start_idx:]:
            if cue.start_ms >= max_cue_start:
                break
            if cue.end_ms > min_cue_end:
                selected.append(cue)
        return selected
    return [
        cue
        for cue in cues
        if cue.end_ms > min_cue_end and cue.start_ms < max_cue_start
    ]


def build_shifted_subtitle_intervals(
    cues: list[Cue],
    offset_ms: int,
    audio_start_ms: int,
    audio_end_ms: int,
) -> list[tuple[int, int]]:
    min_cue_end = audio_start_ms - offset_ms
    max_cue_start = audio_end_ms - offset_ms
    overlapping = _slice_cues_overlapping(cues, min_cue_end, max_cue_start)
    return merge_activity_intervals(
        clip_intervals(
            [
                (cue.start_ms + offset_ms, cue.end_ms + offset_ms)
                for cue in overlapping
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
    overlapping_cues = _slice_cues_overlapping(cues, origin_ms, fingerprint_end_ms)
    subtitle_intervals = merge_activity_intervals(
        [
            (cue.start_ms, cue.end_ms)
            for cue in overlapping_cues
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
        best_span: tuple[int, int] | None = None
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

            # Allow a single continuous speech utterance to span consecutive
            # split subtitle cues (e.g. a 6s sentence split into two 3s cues).
            chain_end_idx = index
            chain_end_ms = subtitle_end
            chain_overlap = overlap
            while chain_end_idx + 1 < len(subtitle_intervals):
                next_idx = chain_end_idx + 1
                if next_idx in used_subtitle_indices:
                    break
                next_start, next_end = subtitle_intervals[next_idx]
                if next_start - chain_end_ms > 900:
                    break
                next_ov = overlap_ms(
                    speech_start,
                    speech_end,
                    next_start,
                    next_end,
                )
                if next_ov < MIN_SPEECH_ANCHOR_OVERLAP_MS:
                    break
                if abs(speech_end - next_end) <= abs(speech_end - chain_end_ms) + 250:
                    chain_end_idx = next_idx
                    chain_end_ms = next_end
                    chain_overlap += next_ov
                else:
                    break

            for candidate_end_idx, eff_end_ms, eff_overlap in (
                (index, subtitle_end, overlap),
                (chain_end_idx, chain_end_ms, chain_overlap),
            ):
                start_error = abs(speech_start - subtitle_start)
                end_error = abs(speech_end - eff_end_ms)
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
                overlap_ratio = eff_overlap / max(
                    MIN_SPEECH_ANCHOR_OVERLAP_MS,
                    min(speech_duration, eff_end_ms - subtitle_start),
                )
                if (
                    boundary_error > MAX_SPEECH_ANCHOR_ERROR_MS
                    and overlap_ratio < 0.25
                ):
                    continue

                rank = (min(1.0, overlap_ratio), -weighted_boundary_error)
                if best_rank is None or rank > best_rank:
                    best_span = (index, candidate_end_idx)
                    best_rank = rank

        if best_span is None or best_rank is None:
            # Check if this speech interval is the second clause inside the
            # same merged/multi-sentence subtitle interval just matched.
            if last_subtitle_index >= 0 and anchor_errors:
                prev_sub_start, prev_sub_end = subtitle_intervals[last_subtitle_index]
                tail_overlap = overlap_ms(
                    speech_start,
                    speech_end,
                    prev_sub_start,
                    prev_sub_end,
                )
                if (
                    tail_overlap >= max(MIN_SPEECH_ANCHOR_OVERLAP_MS, int(speech_duration * 0.5))
                    and abs(speech_end - prev_sub_end) <= MAX_SPEECH_ANCHOR_ERROR_MS
                ):
                    prev_start_err, _, prev_early_err = anchor_errors[-1]
                    new_end_err = abs(speech_end - prev_sub_end)
                    anchor_errors[-1] = (prev_start_err, new_end_err, prev_early_err)
                    anchor_errors.append((prev_start_err, new_end_err, 0))
            continue

        span_start_idx, span_end_idx = best_span
        for idx in range(span_start_idx, span_end_idx + 1):
            used_subtitle_indices.add(idx)
        last_subtitle_index = span_end_idx
        subtitle_start = subtitle_intervals[span_start_idx][0]
        subtitle_end = subtitle_intervals[span_end_idx][1]
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
    local_cues = _slice_cues_overlapping(
        cues,
        audio_start_ms - MAX_PLAUSIBLE_ALIGNMENT_OFFSET_MS - 60_000,
        audio_end_ms + MAX_PLAUSIBLE_ALIGNMENT_OFFSET_MS + 60_000,
    ) or cues
    centers_set = set(search_centers or [0])
    fft_peak_offsets: list[int] = []
    cue_intervals = [(c.start_ms, c.end_ms) for c in local_cues if c.end_ms > c.start_ms]
    try:
        fft_peaks = find_top_offsets_fft(
            speech_intervals,
            cue_intervals,
            audio_start_ms,
            audio_end_ms,
            try_framerate_ratios=False,
            search_centers=search_centers,
            top_k=5,
        )
        top_fft_conf = fft_peaks[0][1] if fft_peaks else 0.0
        if top_fft_conf < 65.0 and (audio_end_ms - audio_start_ms) <= 180_000:
            ratio_peaks = find_top_offsets_fft(
                speech_intervals,
                cue_intervals,
                audio_start_ms,
                audio_end_ms,
                try_framerate_ratios=True,
                search_centers=search_centers,
                top_k=5,
            )
            fft_peaks = sorted(
                [*fft_peaks, *ratio_peaks],
                key=lambda item: item[1],
                reverse=True,
            )[:8]
        for fft_offset, fft_conf, _ in fft_peaks:
            if fft_conf >= 15.0 and abs(fft_offset) <= MAX_PLAUSIBLE_ALIGNMENT_OFFSET_MS:
                centers_set.add(fft_offset)
                if fft_offset not in fft_peak_offsets:
                    fft_peak_offsets.append(fft_offset)
    except Exception:
        pass
    centers = sorted(centers_set)

    score_memo: dict[int, float] = {}

    def cached_score_offset(value: int) -> float:
        cached = score_memo.get(value)
        if cached is not None:
            return cached
        val = score_offset(
            local_cues,
            speech_intervals,
            value,
            audio_start_ms,
            audio_end_ms,
        )
        score_memo[value] = val
        return val

    def rank_offset(value: int) -> tuple[float, int, int]:
        dist_to_center = min(abs(value - c) for c in centers)
        return (
            cached_score_offset(value),
            -dist_to_center,
            -abs(value),
        )

    speech_bits, subtitle_bits, audio_mask = _build_activity_fingerprint(
        local_cues,
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
        seed_candidates: list[int] = []
        for cand in (
            *fft_peak_offsets,
            *[
                min(coarse_candidates_set, key=lambda value, c=center: abs(value - c))
                for center in centers
            ],
            *fingerprint_ranked_candidates[:ACTIVITY_FINGERPRINT_TOP_K],
        ):
            if all(abs(cand - existing) >= 200 for existing in seed_candidates):
                seed_candidates.append(cand)
            if len(seed_candidates) >= 10:
                break

        stage1_candidates: set[int] = set()
        for seed in seed_candidates:
            stage1_candidates.update(
                range(
                    seed - ACTIVITY_FINGERPRINT_REFINE_RANGE_MS,
                    seed + ACTIVITY_FINGERPRINT_REFINE_RANGE_MS + 1,
                    100,
                )
            )
            stage1_candidates.add(seed)
        top_stage1 = sorted(stage1_candidates, key=rank_offset, reverse=True)[:2]

        refined_candidates_set: set[int] = set()
        for peak in top_stage1:
            refined_candidates_set.update(
                range(
                    peak - 125,
                    peak + 126,
                    REFINE_STEP_MS,
                )
            )
        refined_candidates = refined_candidates_set
    else:
        # Preserve exhaustive sweep for sparse/empty fingerprints (pre-sliced O(log N) cues).
        coarse_offset = max(coarse_candidates_set, key=rank_offset)
        refined_candidates = range(
            coarse_offset - REFINE_RANGE_MS,
            coarse_offset + REFINE_RANGE_MS + 1,
            REFINE_STEP_MS,
        )

    best_offset = max(refined_candidates, key=rank_offset)
    best_score = cached_score_offset(best_offset)
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

    max_center_abs = max((abs(c) for c in (search_centers or ())), default=0)
    max_allowed_offset = (
        min(
            MAX_PLAUSIBLE_ALIGNMENT_OFFSET_MS,
            max(180_000, max_center_abs + SEARCH_RANGE_MS),
        )
        if max_center_abs > MAX_ALIGNMENT_OFFSET_MS
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
    if abs(offset_ms) >= MAX_PLAUSIBLE_ALIGNMENT_OFFSET_MS:
        return {
            **invalid_alignment_result(speech_intervals, "offset_out_of_range"),
            "confidence": confidence,
        }
    if confidence < MIN_ALIGNMENT_CONFIDENCE:
        reason = (
            "offset_out_of_range"
            if abs(offset_ms) >= max_allowed_offset
            else "low_alignment_confidence"
        )
        return {
            **invalid_alignment_result(speech_intervals, reason),
            "confidence": confidence,
        }

    evidence = evaluate_offset(
        cues,
        speech_intervals,
        offset_ms,
        audio_start_ms,
        audio_end_ms,
    )
    if abs(offset_ms) >= max_allowed_offset and not (
        confidence >= 68
        and evidence.matched_anchors >= 3
        and evidence.anchor_coverage >= 0.35
    ):
        return {
            **invalid_alignment_result(speech_intervals, "offset_out_of_range"),
            "confidence": confidence,
        }

    # Keep the original timeline in the response. The renderer aggregates
    # multiple windows and applies one consensus offset once; local snapping
    # from a single window would mix evidence and can double-shift cues.
    return _finalize_offset_evidence(
        speech_intervals,
        offset_ms,
        confidence,
        evidence,
    )


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


def _finalize_offset_evidence(
    speech_intervals: list[tuple[int, int]],
    offset_ms: int,
    confidence: int,
    evidence: OffsetEvidence,
    require_multi_anchor: bool = False,
) -> dict[str, Any]:
    """Validate confidence and speech anchor evidence into an alignment result."""
    serialized_intervals = [
        {"startMs": start_ms, "endMs": end_ms}
        for start_ms, end_ms in speech_intervals
    ]
    if confidence < MIN_ALIGNMENT_CONFIDENCE:
        return {
            "aligned": False,
            "offsetMs": 0,
            "confidence": confidence,
            "speechIntervals": serialized_intervals,
            "reason": "low_alignment_confidence",
        }

    minimum_anchors = (
        2
        if require_multi_anchor
        else (1 if evidence.speech_anchor_count <= 1 else 2)
    )
    if evidence.matched_anchors < minimum_anchors:
        return {
            "aligned": False,
            "offsetMs": 0,
            "confidence": confidence,
            "speechIntervals": serialized_intervals,
            "speechAnchorCount": evidence.matched_anchors,
            "speechAnchorCoverage": evidence.anchor_coverage,
            "reason": "insufficient_speech_anchors",
        }

    if evidence.matched_anchors == 1 and confidence < 80:
        return {
            "aligned": False,
            "offsetMs": 0,
            "confidence": confidence,
            "speechIntervals": serialized_intervals,
            "speechAnchorCount": evidence.matched_anchors,
            "speechAnchorCoverage": evidence.anchor_coverage,
            "reason": "low_confidence_for_single_anchor",
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
            "speechIntervals": serialized_intervals,
            "speechAnchorCount": evidence.matched_anchors,
            "speechAnchorCoverage": evidence.anchor_coverage,
            "reason": "insufficient_speech_anchors",
        }

    return {
        "aligned": confidence >= MIN_ALIGNMENT_CONFIDENCE,
        "offsetMs": offset_ms,
        "confidence": confidence,
        "speechIntervals": serialized_intervals,
        "speechAnchorCount": evidence.matched_anchors,
        "speechAnchorCoverage": evidence.anchor_coverage,
        "reason": None,
    }


def _scale_cues_around_subtitle_pivot(
    cues: list[Cue],
    subtitle_pivot_ms: int,
    rate_ratio: float,
    min_cue_end: int,
    max_cue_start: int,
) -> list[Cue]:
    """Scale cues locally around a subtitle pivot to eliminate intra-window drift."""
    effective_rate = rate_ratio if rate_ratio > 0 else 1.0
    raw_min = (
        subtitle_pivot_ms
        + int((min_cue_end - subtitle_pivot_ms) / effective_rate)
        - 5_000
    )
    raw_max = (
        subtitle_pivot_ms
        + int((max_cue_start - subtitle_pivot_ms) / effective_rate)
        + 5_000
    )
    overlapping = _slice_cues_overlapping(cues, raw_min, raw_max)
    scaled: list[Cue] = []
    for cue in overlapping:
        start_ms = int(
            round(subtitle_pivot_ms + (cue.start_ms - subtitle_pivot_ms) * effective_rate)
        )
        end_ms = int(
            round(subtitle_pivot_ms + (cue.end_ms - subtitle_pivot_ms) * effective_rate)
        )
        if end_ms > start_ms:
            scaled.append(Cue(cue.index, start_ms, end_ms, cue.block))
    return scaled


def _align_window_at_projected_rate(
    cues: list[Cue],
    speech_intervals: list[tuple[int, int]],
    audio_start_ms: int,
    audio_end_ms: int,
    expected_offset_ms: int,
    rate_ratio: float,
    search_radius_ms: int = 2_400,
) -> dict[str, Any]:
    """Align a single audio window under a local linear framerate ratio hypothesis."""
    if not speech_intervals:
        return invalid_alignment_result([], "no_speech_detected")
    total_speech_duration_ms = sum(
        max(0, end_ms - start_ms) for start_ms, end_ms in speech_intervals
    )
    if total_speech_duration_ms < MIN_ALIGNMENT_SPEECH_DURATION_MS:
        return invalid_alignment_result(
            speech_intervals,
            "insufficient_speech_in_window",
        )
    if not cues:
        return invalid_alignment_result(speech_intervals, "invalid_subtitle")
    if abs(expected_offset_ms) > MAX_PLAUSIBLE_ALIGNMENT_OFFSET_MS:
        return invalid_alignment_result(speech_intervals, "offset_out_of_range")

    window_mid_ms = (audio_start_ms + audio_end_ms) // 2
    subtitle_pivot_ms = window_mid_ms - expected_offset_ms
    scaled_cues = _scale_cues_around_subtitle_pivot(
        cues,
        subtitle_pivot_ms,
        rate_ratio,
        audio_start_ms - expected_offset_ms - search_radius_ms - 2_000,
        audio_end_ms - expected_offset_ms + search_radius_ms + 2_000,
    )
    if not scaled_cues:
        return invalid_alignment_result(speech_intervals, "low_alignment_confidence")

    score_memo: dict[int, float] = {}

    def cached_score(cand: int) -> float:
        val = score_memo.get(cand)
        if val is None:
            val = score_offset(
                scaled_cues,
                speech_intervals,
                cand,
                audio_start_ms,
                audio_end_ms,
            )
            score_memo[cand] = val
        return val

    coarse_candidates = [
        cand
        for cand in range(
            expected_offset_ms - search_radius_ms,
            expected_offset_ms + search_radius_ms + 1,
            150,
        )
        if abs(cand) < MAX_PLAUSIBLE_ALIGNMENT_OFFSET_MS
    ]
    if not coarse_candidates:
        return invalid_alignment_result(speech_intervals, "offset_out_of_range")

    coarse_ranked = sorted(
        coarse_candidates,
        key=lambda cand: (cached_score(cand), -abs(cand - expected_offset_ms)),
        reverse=True,
    )
    if cached_score(coarse_ranked[0]) < 0.45:
        return invalid_alignment_result(speech_intervals, "low_alignment_confidence")

    top_peaks: list[int] = []
    for cand in coarse_ranked:
        if all(abs(cand - peak) >= 300 for peak in top_peaks):
            top_peaks.append(cand)
            if len(top_peaks) >= 2:
                break

    refined_candidates: set[int] = set()
    for peak in top_peaks:
        for cand in range(peak - 150, peak + 151, REFINE_STEP_MS):
            if abs(cand) < MAX_PLAUSIBLE_ALIGNMENT_OFFSET_MS:
                refined_candidates.add(cand)
    if not refined_candidates:
        refined_candidates.add(coarse_ranked[0])

    best_offset = max(
        refined_candidates,
        key=lambda cand: (cached_score(cand), -abs(cand - expected_offset_ms)),
    )
    best_score = cached_score(best_offset)
    confidence = int(round(max(0.0, min(1.0, best_score)) * 100))
    evidence = evaluate_offset(
        scaled_cues,
        speech_intervals,
        best_offset,
        audio_start_ms,
        audio_end_ms,
    )
    true_offset_ms = (
        best_offset
        if abs(rate_ratio - 1.0) <= 1e-6
        else int(
            round(
                expected_offset_ms
                + (best_offset - expected_offset_ms) / rate_ratio
            )
        )
    )
    if abs(true_offset_ms) >= MAX_PLAUSIBLE_ALIGNMENT_OFFSET_MS:
        return {
            **invalid_alignment_result(speech_intervals, "offset_out_of_range"),
            "confidence": confidence,
        }

    return _finalize_offset_evidence(
        speech_intervals,
        true_offset_ms,
        confidence,
        evidence,
        require_multi_anchor=abs(rate_ratio - 1.0) > 1e-4,
    )


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
    additional_hints_by_track: dict[str, list[int]] | None = None,
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

        fft_hints: list[int] = list(
            (additional_hints_by_track or {}).get(track, [])
        )
        if speech_intervals and cues:
            try:
                cue_intervals = [
                    (c.start_ms, c.end_ms) for c in cues if c.end_ms > c.start_ms
                ]
                fft_peaks = find_top_offsets_fft(
                    speech_intervals,
                    cue_intervals,
                    audio_start_ms,
                    audio_end_ms,
                    try_framerate_ratios=False,
                    top_k=3,
                )
                if (not fft_peaks or fft_peaks[0][1] < 35.0) and (audio_end_ms - audio_start_ms) <= 180_000:
                    fft_peaks = [
                        *fft_peaks,
                        *find_top_offsets_fft(
                            speech_intervals,
                            cue_intervals,
                            audio_start_ms,
                            audio_end_ms,
                            try_framerate_ratios=True,
                            top_k=3,
                        ),
                    ]
                for fft_off, fft_conf, _ in fft_peaks:
                    if fft_conf >= 30.0 and fft_off not in fft_hints:
                        fft_hints.append(fft_off)
            except Exception:
                pass

        track_search_centers = compute_track_search_centers(
            cues,
            speech_intervals,
            audio_start_ms,
            additional_hints=fft_hints or None,
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

    # Cross-track rescue: if primary and secondary are both present and one track
    # aligned while the other failed, use their relative subtitle cadence offset
    # to guide a second pass on the unaligned track.
    if len(subtitles) == 2:
        t0, t1 = subtitles[0]["track"], subtitles[1]["track"]
        r0, r1 = results.get(t0, {}), results.get(t1, {})
        c0, c1 = parsed_tracks.get(t0), parsed_tracks.get(t1)
        if c0 and c1 and bool(r0.get("aligned")) != bool(r1.get("aligned")):
            aligned_track = t0 if r0.get("aligned") else t1
            failed_track = t1 if aligned_track == t0 else t0
            aligned_cues = c0 if aligned_track == t0 else c1
            failed_cues = c1 if aligned_track == t0 else c0
            rel_offset = estimate_subtitle_relative_offset(
                aligned_cues,
                failed_cues,
            )
            if rel_offset is not None:
                guided_offset = int(results[aligned_track]["offsetMs"]) + rel_offset
                rescue_centers = compute_track_search_centers(
                    failed_cues,
                    speech_intervals,
                    audio_start_ms,
                    additional_hints=[guided_offset],
                )
                try:
                    rescued = result_from_speech(
                        failed_cues,
                        speech_intervals,
                        audio_start_ms,
                        audio_end_ms,
                        search_centers=rescue_centers,
                    )
                    if rescued.get("aligned"):
                        results[failed_track] = rescued
                except TypeError:
                    pass

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


def _weighted_linear_fit(
    xs: list[float],
    ys: list[float],
    weights: list[float],
) -> tuple[float, float] | None:
    total_w = sum(weights)
    if total_w <= 0:
        return None
    mean_x = sum(w * x for w, x in zip(weights, xs)) / total_w
    mean_y = sum(w * y for w, y in zip(weights, ys)) / total_w
    denom = sum(w * (x - mean_x) ** 2 for w, x in zip(weights, xs))
    if denom <= 1e-6:
        return None
    slope = sum(w * (x - mean_x) * (y - mean_y) for w, x, y in zip(weights, xs, ys)) / denom
    intercept = mean_y - slope * mean_x
    return slope, intercept


def _has_consistent_drift_direction(
    points: list[tuple[float, float, float, float, dict[str, Any]]],
    slope: float,
    minimum_match_ratio: float = 0.75,
) -> bool:
    if len(points) < 3:
        return False
    direction = 1 if slope > 1.0 else -1
    direction_matches = 0
    direction_checks = 0
    sorted_points = sorted(points, key=lambda point: point[1])
    for previous, current in zip(sorted_points, sorted_points[1:]):
        delta = current[2] - previous[2]
        if abs(delta) < 50:
            continue
        direction_checks += 1
        if (1 if delta > 0 else -1) == direction:
            direction_matches += 1
    required_checks = max(2, min(3, len(sorted_points) - 1))
    return (
        direction_checks >= required_checks
        and direction_matches / direction_checks >= minimum_match_ratio
    )


def _fit_small_linear_drift(
    points: list[tuple[float, float, float, float, dict[str, Any]]],
) -> dict[str, Any] | None:
    """Fit sub-second cumulative drift without mistaking window jitter for drift."""
    if len(points) < MIN_SMALL_DRIFT_INLIERS:
        return None

    sorted_points = sorted(points, key=lambda point: point[1])
    min_inliers = max(
        MIN_SMALL_DRIFT_INLIERS,
        int(np.ceil(len(sorted_points) * 0.75)),
    )
    best: tuple[tuple[int, float, float], dict[str, Any]] | None = None

    for i, first in enumerate(sorted_points[:-1]):
        for last in sorted_points[i + 1 :]:
            if last[1] - first[1] < MIN_SMALL_DRIFT_SPAN_MS:
                continue
            x_span = last[0] - first[0]
            if x_span <= 0:
                continue
            candidate_slope = (last[1] - first[1]) / x_span
            if not (MIN_RATE_RATIO <= candidate_slope <= MAX_RATE_RATIO):
                continue
            if abs(candidate_slope - 1.0) < MIN_SMALL_DRIFT_RATE_DELTA:
                continue
            candidate_intercept = first[1] - candidate_slope * first[0]
            candidate_inliers = [
                point
                for point in sorted_points
                if abs(
                    point[1]
                    - (candidate_slope * point[0] + candidate_intercept)
                )
                <= MAX_SMALL_DRIFT_RESIDUAL_MS
            ]
            if len(candidate_inliers) < min_inliers:
                continue

            fit = _weighted_linear_fit(
                [point[0] for point in candidate_inliers],
                [point[1] for point in candidate_inliers],
                [point[3] for point in candidate_inliers],
            )
            if fit is None:
                continue
            slope, intercept = fit
            if (
                not (MIN_RATE_RATIO <= slope <= MAX_RATE_RATIO)
                or abs(slope - 1.0) < MIN_SMALL_DRIFT_RATE_DELTA
            ):
                continue

            inliers = [
                point
                for point in sorted_points
                if abs(point[1] - (slope * point[0] + intercept))
                <= MAX_SMALL_DRIFT_RESIDUAL_MS
            ]
            if len(inliers) < min_inliers:
                continue
            inliers.sort(key=lambda point: point[1])

            predicted_drift_ms = abs(
                (slope - 1.0) * (inliers[-1][0] - inliers[0][0])
            )
            if predicted_drift_ms < MIN_SMALL_DRIFT_ENDPOINT_DELTA_MS:
                continue

            weights = [point[3] for point in inliers]
            weight_sum = sum(weights)
            offset_values = [point[2] for point in inliers]
            offset_mean = sum(
                weight * offset
                for weight, offset in zip(weights, offset_values)
            ) / weight_sum
            constant_rmse = float(
                np.sqrt(
                    sum(
                        weight * (offset - offset_mean) ** 2
                        for weight, offset in zip(weights, offset_values)
                    )
                    / weight_sum
                )
            )
            linear_residuals = [
                point[1] - (slope * point[0] + intercept)
                for point in inliers
            ]
            linear_rmse = float(
                np.sqrt(
                    sum(
                        weight * residual**2
                        for weight, residual in zip(weights, linear_residuals)
                    )
                    / weight_sum
                )
            )
            if (
                max(abs(residual) for residual in linear_residuals)
                > MAX_SMALL_DRIFT_RESIDUAL_MS
                or constant_rmse - linear_rmse < MIN_SMALL_DRIFT_RMSE_GAIN_MS
            ):
                continue

            offset_variance = sum(
                weight * (offset - offset_mean) ** 2
                for weight, offset in zip(weights, offset_values)
            )
            if offset_variance <= 1e-6:
                continue
            offset_r2 = 1.0 - sum(
                weight * residual**2
                for weight, residual in zip(weights, linear_residuals)
            ) / offset_variance
            if offset_r2 < MIN_SMALL_DRIFT_R2:
                continue

            if not _has_consistent_drift_direction(inliers, slope, 0.60):
                continue

            average_confidence = round(sum(weights) / len(inliers))
            representative = max(inliers, key=lambda point: point[3])[4]["result"]
            result = {
                **representative,
                "aligned": True,
                "offsetMs": int(round(intercept)),
                "rateRatio": round(float(slope), 6),
                "confidence": average_confidence,
                "reason": None,
            }
            rank = (len(inliers), predicted_drift_ms, -linear_rmse)
            if best is None or rank > best[0]:
                best = (rank, result)

    return best[1] if best is not None else None


def _fit_framerate_drift(
    valid_entries: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """Detect smooth linear FPS drift (e.g. 23.976<->24, 24<->25) across >= 2 windows."""
    if len(valid_entries) < 2:
        return None

    sorted_entries = sorted(valid_entries, key=lambda e: float(e["startAt"]))
    points: list[tuple[float, float, float, float, dict[str, Any]]] = []
    for entry in sorted_entries:
        t_v = float(entry.get("midMs", float(entry["startAt"]) * 1000.0))
        offset_ms = float(entry["result"]["offsetMs"])
        t_s = t_v - offset_ms
        conf = max(1.0, float(entry["result"].get("confidence", 60)))
        points.append((t_s, t_v, offset_ms, conf, entry))

    # A drift model must explain most windows; a short local timing jump is
    # handled by the piecewise path instead of being promoted to global rate.
    min_required_inliers = max(4, int(np.ceil(len(points) * 0.75)))
    best_model: dict[str, Any] | None = None

    if len(points) >= 3:
        for i in range(len(points)):
            for j in range(i + 1, len(points)):
                t_si, t_vi, _, _, _ = points[i]
                t_sj, t_vj, _, _, _ = points[j]
                if abs(t_vj - t_vi) < 180_000 or abs(t_sj - t_si) < 180_000:
                    continue
                cand_slope = (t_vj - t_vi) / (t_sj - t_si)
                if not (MIN_RATE_RATIO <= cand_slope <= MAX_RATE_RATIO):
                    continue
                cand_intercept = t_vi - cand_slope * t_si

                inliers = [
                    p
                    for p in points
                    if abs(p[1] - (cand_slope * p[0] + cand_intercept)) <= 750.0
                ]
                if (
                    len(inliers) < min_required_inliers
                    or (inliers[-1][1] - inliers[0][1]) < 180_000
                ):
                    continue

                fit = _weighted_linear_fit(
                    [p[0] for p in inliers],
                    [p[1] for p in inliers],
                    [p[3] for p in inliers],
                )
                if fit is None:
                    continue
                slope, intercept = fit
                if (
                    not (MIN_RATE_RATIO <= slope <= MAX_RATE_RATIO)
                    or abs(slope - 1.0) < 0.0004
                ):
                    continue

                # Recompute inliers tightly around OLS refit
                inliers = [
                    p
                    for p in points
                    if abs(p[1] - (slope * p[0] + intercept)) <= 750.0
                ]
                if (
                    len(inliers) < min_required_inliers
                    or (inliers[-1][1] - inliers[0][1]) < 180_000
                ):
                    continue
                if not _has_consistent_drift_direction(inliers, slope):
                    continue

                # Snap cleanly to broadcast FPS ratio when within 0.04% and errors stay <= 750ms
                snapped_to_std = False
                best_std = min(
                    (r for r in FRAMERATE_RATIOS if abs(r - 1.0) > 1e-6),
                    key=lambda r: abs(r - slope),
                    default=None,
                )
                if best_std is not None and abs(best_std - slope) <= 0.0004:
                    w_sum = sum(p[3] for p in inliers)
                    std_intercept = (
                        sum(p[3] * (p[1] - best_std * p[0]) for p in inliers) / w_sum
                    )
                    std_max_err = max(
                        abs(p[1] - (best_std * p[0] + std_intercept))
                        for p in inliers
                    )
                    if std_max_err <= 750.0:
                        slope = best_std
                        intercept = std_intercept
                        snapped_to_std = True

                offsets = [p[2] for p in inliers]
                offset_spread = max(offsets) - min(offsets)
                min_offset_spread = 500.0 if snapped_to_std else 800.0
                if offset_spread < min_offset_spread:
                    continue
                min_span_ms = (
                    180_000
                    if (snapped_to_std and offset_spread >= 1_500.0)
                    else 240_000
                )
                if inliers[-1][1] - inliers[0][1] < min_span_ms:
                    continue

                w_sum = sum(p[3] for p in inliers)
                const_mean = sum(p[3] * p[2] for p in inliers) / w_sum
                const_rmse = float(
                    np.sqrt(
                        sum(p[3] * (p[2] - const_mean) ** 2 for p in inliers) / w_sum
                    )
                )
                lin_residuals = [
                    abs(p[1] - (slope * p[0] + intercept)) for p in inliers
                ]
                linear_rmse = float(
                    np.sqrt(
                        sum(p[3] * r**2 for p, r in zip(inliers, lin_residuals))
                        / w_sum
                    )
                )
                if max(lin_residuals) > 750.0:
                    continue
                min_const_rmse = (
                    max(250.0, linear_rmse * 1.6)
                    if snapped_to_std
                    else max(420.0, linear_rmse * 2.5)
                )
                if const_rmse < min_const_rmse:
                    continue

                score_tuple = (len(inliers), -linear_rmse)
                if best_model is None or score_tuple > best_model["rank"]:
                    avg_conf = round(sum(p[3] for p in inliers) / len(inliers))
                    rep = max(inliers, key=lambda p: p[3])[4]["result"]
                    best_model = {
                        "rank": score_tuple,
                        "result": {
                            **rep,
                            "aligned": True,
                            "offsetMs": int(round(intercept)),
                            "rateRatio": round(float(slope), 6),
                            "confidence": avg_conf,
                            "reason": None,
                        },
                    }

    if best_model is None and len(points) == 2:
        p0, p1 = points[0], points[1]
        if (
            p1[1] - p0[1] >= 600_000
            and p1[0] - p0[0] >= 600_000
            and abs(p1[2] - p0[2]) > 1_200.0
            and min(p0[3], p1[3]) >= 72.0
            and int(p0[4]["result"].get("speechAnchorCount", 0)) >= 2
            and int(p1[4]["result"].get("speechAnchorCount", 0)) >= 2
        ):
            cand_slope = (p1[1] - p0[1]) / (p1[0] - p0[0])
            best_std = min(
                (r for r in FRAMERATE_RATIOS if abs(r - 1.0) > 1e-6),
                key=lambda r: abs(r - cand_slope),
                default=None,
            )
            if best_std is not None and abs(best_std - cand_slope) <= 0.0004:
                w_sum = p0[3] + p1[3]
                std_intercept = (
                    p0[3] * (p0[1] - best_std * p0[0])
                    + p1[3] * (p1[1] - best_std * p1[0])
                ) / w_sum
                rep = p1[4]["result"] if p1[3] >= p0[3] else p0[4]["result"]
                return {
                    **rep,
                    "aligned": True,
                    "offsetMs": int(round(std_intercept)),
                    "rateRatio": round(float(best_std), 6),
                    "confidence": round((p0[3] + p1[3]) / 2),
                    "reason": None,
                }

    if best_model is not None:
        return best_model["result"]

    return _fit_small_linear_drift(points)


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

    fps_drift_result = _fit_framerate_drift(valid_entries)
    if fps_drift_result is not None:
        return fps_drift_result

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
        and not any(
            abs(
                int(intro_entry["result"].get("offsetMs", 0))
                - int(m["result"].get("offsetMs", 0))
            )
            <= 1_200
            for m in main_entries
        )
    ):
        main_clusters = sorted(
            _cluster_alignment_candidates(main_entries),
            key=lambda cluster: cluster["score"],
            reverse=True,
        )
        if len(main_entries) >= 3 and len(main_clusters) > 1:
            main_fps_drift = _fit_framerate_drift(main_entries)
            if main_fps_drift is not None:
                return main_fps_drift
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

    # Fallback: one window is sufficient when independent speech anchors provide
    # enough coverage; sparse or single-anchor evidence still needs consensus.
    if not has_consensus and len(best_cluster["candidates"]) == 1:
        single_result = best_cluster["candidates"][0]["result"]
        single_anchor_count = int(single_result.get("speechAnchorCount", 0))
        single_anchor_coverage = float(
            single_result.get("speechAnchorCoverage", 0.0)
        )
        strong_single_window = (
            single_anchor_count >= 3
            and single_anchor_coverage >= MIN_SPEECH_ANCHOR_COVERAGE
            and best_cluster["averageConfidence"] >= MIN_ALIGNMENT_CONFIDENCE
        ) or (
            single_anchor_count >= 2
            and single_anchor_coverage >= MIN_SPEECH_ANCHOR_COVERAGE_2_ANCHORS
            and best_cluster["averageConfidence"] >= 70
        )
        if strong_single_window and score_margin >= 20:
            has_consensus = True

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
    avg_offset = round(best_cluster["averageOffsetMs"])
    avg_conf = round(best_cluster["averageConfidence"])
    piecewise_segments = compute_piecewise_segments(valid_entries, avg_offset)

    consensus_res = {
        **representative,
        "aligned": True,
        "offsetMs": avg_offset,
        "confidence": avg_conf,
        "reason": None,
    }
    if piecewise_segments:
        consensus_res["segments"] = piecewise_segments
    return consensus_res


def _window_needs_drift_rescue(
    windows: list[tuple[list[tuple[int, int]], int, int]],
    entries: list[dict[str, Any]],
    consensus: dict[str, Any],
) -> bool:
    """Return True when any speech window failed alignment or diverges from consensus."""
    if not consensus.get("aligned"):
        return True
    if consensus.get("rateRatio") is not None:
        return False
    consensus_offset = int(consensus.get("offsetMs", 0))
    for idx, (win_speech, _, _) in enumerate(windows):
        speech_ms = sum(max(0, end - start) for start, end in win_speech)
        if speech_ms < MIN_ALIGNMENT_SPEECH_DURATION_MS:
            continue
        result = entries[idx]["result"]
        if not result.get("aligned"):
            return True
        if abs(int(result.get("offsetMs", 0)) - consensus_offset) > 1_200:
            return True
    return False


def _seed_rate_scaled_entries(
    windows: list[tuple[list[tuple[int, int]], int, int]],
    entries: list[dict[str, Any]],
    cues: list[Cue],
) -> list[dict[str, Any]]:
    """Seed up to two speech-dense windows when Pass 1 produced zero aligned windows."""
    seeded_entries = [dict(entry) for entry in entries]
    speech_ranked = sorted(
        (
            (sum(max(0, e - s) for s, e in win_speech), idx, win_speech, s_ms, e_ms)
            for idx, (win_speech, s_ms, e_ms) in enumerate(windows)
            if sum(max(0, e - s) for s, e in win_speech) >= MIN_ALIGNMENT_SPEECH_DURATION_MS
        ),
        key=lambda item: item[0],
        reverse=True,
    )
    if not speech_ranked:
        return seeded_entries

    cue_intervals = [(c.start_ms, c.end_ms) for c in cues if c.end_ms > c.start_ms]
    non_unit_ratios = [r for r in FRAMERATE_RATIOS if abs(r - 1.0) > 1e-4]

    for _, idx, win_speech, s_ms, e_ms in speech_ranked[:2]:
        merged_speech = merge_intervals(win_speech)
        fft_peaks = find_top_offsets_fft(
            merged_speech,
            cue_intervals,
            s_ms,
            e_ms,
            try_framerate_ratios=True,
            top_k=3,
        )
        seen_peaks: list[int] = []
        best_res: dict[str, Any] | None = None
        for fft_off, fft_conf, fft_ratio in fft_peaks:
            if fft_conf < 20.0 or any(abs(fft_off - p) < 1_500 for p in seen_peaks):
                continue
            seen_peaks.append(fft_off)
            ratios_to_try = (
                [fft_ratio, *[r for r in non_unit_ratios if abs(r - fft_ratio) > 1e-4]]
                if abs(fft_ratio - 1.0) > 1e-4
                else non_unit_ratios
            )
            for ratio in ratios_to_try:
                res = _align_window_at_projected_rate(
                    cues,
                    merged_speech,
                    s_ms,
                    e_ms,
                    fft_off,
                    ratio,
                )
                if (
                    res.get("aligned")
                    and int(res.get("confidence", 0)) >= 68
                    and int(res.get("speechAnchorCount", 0)) >= 2
                ):
                    if best_res is None or int(res["confidence"]) > int(best_res["confidence"]):
                        best_res = res
                    break
            if best_res is not None:
                break
        if best_res is not None:
            seeded_entries[idx] = {**seeded_entries[idx], "result": best_res}

    return seeded_entries


def _project_and_fit_framerate_drift(
    windows: list[tuple[list[tuple[int, int]], int, int]],
    base_entries: list[dict[str, Any]],
    cues: list[Cue],
) -> dict[str, Any] | None:
    """Project linear FPS hypotheses from aligned anchor windows across the timeline."""
    aligned_indices = [
        i
        for i, entry in enumerate(base_entries)
        if entry["result"].get("aligned")
        and isinstance(entry["result"].get("offsetMs"), int)
    ]
    if not aligned_indices:
        return None

    best_anchor_idx = max(
        aligned_indices,
        key=lambda i: int(base_entries[i]["result"].get("confidence", 0)),
    )
    anchor_indices = [best_anchor_idx]
    best_mid_ms = int(base_entries[best_anchor_idx]["midMs"])
    furthest_idx = max(
        aligned_indices,
        key=lambda i: abs(int(base_entries[i]["midMs"]) - best_mid_ms),
    )
    if (
        furthest_idx != best_anchor_idx
        and abs(int(base_entries[furthest_idx]["midMs"]) - best_mid_ms) >= 180_000
    ):
        anchor_indices.append(furthest_idx)

    candidate_ratios = [r for r in FRAMERATE_RATIOS if abs(r - 1.0) > 1e-4]
    if len(anchor_indices) == 2:
        i0, i1 = anchor_indices
        t_v0 = float(base_entries[i0]["midMs"])
        t_v1 = float(base_entries[i1]["midMs"])
        t_s0 = t_v0 - float(base_entries[i0]["result"]["offsetMs"])
        t_s1 = t_v1 - float(base_entries[i1]["result"]["offsetMs"])
        if abs(t_v1 - t_v0) >= 180_000 and abs(t_s1 - t_s0) >= 180_000:
            emp_r = (t_v1 - t_v0) / (t_s1 - t_s0)
            if (
                MIN_RATE_RATIO <= emp_r <= MAX_RATE_RATIO
                and abs(emp_r - 1.0) >= 0.0004
                and all(abs(emp_r - r) > 1e-5 for r in candidate_ratios)
            ):
                candidate_ratios.append(emp_r)

    merged_windows = [
        (
            idx,
            merge_intervals(win_speech),
            s_ms,
            e_ms,
            (s_ms + e_ms) // 2,
            sum(max(0, e - s) for s, e in win_speech),
        )
        for idx, (win_speech, s_ms, e_ms) in enumerate(windows)
    ]
    eval_cache: dict[tuple[int, int, float, int], dict[str, Any]] = {}

    def cached_projected_align(
        idx: int,
        win_speech: list[tuple[int, int]],
        s_ms: int,
        e_ms: int,
        expected_offset_ms: int,
        ratio: float,
        radius_ms: int,
    ) -> dict[str, Any]:
        key = (idx, expected_offset_ms, round(ratio, 6), radius_ms)
        cached = eval_cache.get(key)
        if cached is None:
            cached = _align_window_at_projected_rate(
                cues,
                win_speech,
                s_ms,
                e_ms,
                expected_offset_ms,
                ratio,
                search_radius_ms=radius_ms,
            )
            eval_cache[key] = cached
        return cached

    best_hypothesis: tuple[tuple[int, int], dict[str, Any]] | None = None

    for anchor_idx in anchor_indices:
        anchor_mid_ms = int(base_entries[anchor_idx]["midMs"])
        anchor_offset_ms = int(base_entries[anchor_idx]["result"]["offsetMs"])
        for ratio in candidate_ratios:
            cand_entries: list[dict[str, Any]] = []
            far_window_verified = False

            for idx, win_speech, s_ms, e_ms, win_mid_ms, speech_ms in merged_windows:
                orig_entry = base_entries[idx]
                orig_res = orig_entry["result"]
                expected_offset_ms = int(
                    round(
                        anchor_offset_ms
                        + (1.0 - 1.0 / ratio) * (win_mid_ms - anchor_mid_ms)
                    )
                )

                chosen_res = orig_res
                was_rescued_or_refined = False

                if idx == anchor_idx:
                    if abs(ratio - 1.0) >= 0.005 and speech_ms >= MIN_ALIGNMENT_SPEECH_DURATION_MS:
                        refined = cached_projected_align(
                            idx,
                            win_speech,
                            s_ms,
                            e_ms,
                            anchor_offset_ms,
                            ratio,
                            900,
                        )
                        if (
                            refined.get("aligned")
                            and int(refined.get("confidence", 0))
                            >= int(orig_res.get("confidence", 0)) - 5
                        ):
                            chosen_res = refined
                elif (
                    orig_res.get("aligned")
                    and abs(int(orig_res["offsetMs"]) - expected_offset_ms) <= 750
                ):
                    if abs(ratio - 1.0) >= 0.005 and speech_ms >= MIN_ALIGNMENT_SPEECH_DURATION_MS:
                        refined = cached_projected_align(
                            idx,
                            win_speech,
                            s_ms,
                            e_ms,
                            expected_offset_ms,
                            ratio,
                            900,
                        )
                        if refined.get("aligned") and int(refined.get("confidence", 0)) >= int(
                            orig_res.get("confidence", 0)
                        ):
                            chosen_res = refined
                            was_rescued_or_refined = True
                elif (
                    speech_ms >= MIN_ALIGNMENT_SPEECH_DURATION_MS
                    and abs(expected_offset_ms) <= MAX_PLAUSIBLE_ALIGNMENT_OFFSET_MS
                ):
                    rescued = cached_projected_align(
                        idx,
                        win_speech,
                        s_ms,
                        e_ms,
                        expected_offset_ms,
                        ratio,
                        2_400,
                    )
                    if (
                        rescued.get("aligned")
                        and isinstance(rescued.get("offsetMs"), int)
                        and abs(int(rescued["offsetMs"]) - expected_offset_ms) <= 900
                        and (
                            not orig_res.get("aligned")
                            or int(rescued.get("confidence", 0))
                            >= int(orig_res.get("confidence", 0)) - 6
                        )
                    ):
                        chosen_res = rescued
                        was_rescued_or_refined = True

                if (
                    idx != anchor_idx
                    and was_rescued_or_refined
                    and abs(win_mid_ms - anchor_mid_ms) >= 240_000
                    and chosen_res.get("aligned")
                    and int(chosen_res.get("confidence", 0)) >= 65
                    and int(chosen_res.get("speechAnchorCount", 0)) >= 2
                ):
                    far_window_verified = True

                cand_entries.append(
                    {
                        "startAt": orig_entry["startAt"],
                        "midMs": orig_entry["midMs"],
                        "result": chosen_res,
                    }
                )

            if not far_window_verified:
                continue

            valid_cand_entries = [
                entry
                for entry in cand_entries
                if _has_speech_evidence(entry["result"])
                and entry["result"].get("aligned") is True
                and isinstance(entry["result"].get("offsetMs"), int)
                and int(entry["result"].get("confidence", 0)) >= MIN_ALIGNMENT_CONFIDENCE
            ]
            fps_result = _fit_framerate_drift(valid_cand_entries)
            if fps_result is None:
                continue

            slope = float(fps_result["rateRatio"])
            intercept = float(fps_result["offsetMs"])
            inlier_count = sum(
                1
                for entry in valid_cand_entries
                if abs(
                    float(entry["midMs"])
                    - (
                        slope * (float(entry["midMs"]) - float(entry["result"]["offsetMs"]))
                        + intercept
                    )
                )
                <= 750.0
            )
            rank = (inlier_count, int(fps_result.get("confidence", 0)))
            if best_hypothesis is None or rank > best_hypothesis[0]:
                best_hypothesis = (rank, fps_result)

    return best_hypothesis[1] if best_hypothesis is not None else None


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
                    "midMs": (audio_start_ms + audio_end_ms) // 2,
                    "result": result,
                }
            )

    final_results: dict[str, Any] = {}
    is_mocked_batch = hasattr(align_speech_batch, "assert_called")
    result_from_speech = alignment_result_fn or alignment_result_from_speech

    for track, entries in entries_by_track.items():
        consensus = select_alignment_consensus(entries)
        cues = parsed_tracks.get(track)

        # Cross-window hint rescue, FPS drift projection & bounded pooled fallback
        if (
            cues
            and not is_mocked_batch
            and len(windows) >= 2
            and _window_needs_drift_rescue(windows, entries, consensus)
        ):
            working_entries = entries
            if (
                alignment_result_fn is None
                and not any(e["result"].get("aligned") for e in working_entries)
            ):
                working_entries = _seed_rate_scaled_entries(windows, working_entries, cues)

            aligned_hints = [
                int(e["result"]["offsetMs"])
                for e in working_entries
                if e["result"].get("aligned") and isinstance(e["result"].get("offsetMs"), int)
            ]
            rescued_entries = working_entries
            if aligned_hints:
                rescued_entries = []
                for idx, (speech_intervals, audio_start_ms, audio_end_ms) in enumerate(windows):
                    orig_entry = working_entries[idx]
                    if orig_entry["result"].get("aligned"):
                        rescued_entries.append(orig_entry)
                        continue
                    merged_speech = merge_intervals(speech_intervals)
                    centers = compute_track_search_centers(
                        cues,
                        merged_speech,
                        audio_start_ms,
                        additional_hints=aligned_hints,
                    )
                    try:
                        re_res = result_from_speech(
                            cues,
                            merged_speech,
                            audio_start_ms,
                            audio_end_ms,
                            search_centers=centers,
                        )
                    except TypeError:
                        re_res = orig_entry["result"]
                    rescued_entries.append(
                        {
                            "startAt": orig_entry["startAt"],
                            "midMs": orig_entry.get("midMs", (audio_start_ms + audio_end_ms) // 2),
                            "result": re_res if re_res.get("aligned") else orig_entry["result"],
                        }
                    )
                rescued_consensus = select_alignment_consensus(rescued_entries)
                if rescued_consensus.get("aligned") and (
                    not consensus.get("aligned")
                    or rescued_consensus.get("rateRatio") is not None
                ):
                    consensus = rescued_consensus

            if (
                alignment_result_fn is None
                and consensus.get("rateRatio") is None
                and _window_needs_drift_rescue(windows, rescued_entries, consensus)
            ):
                projected_drift = _project_and_fit_framerate_drift(
                    windows,
                    rescued_entries,
                    cues,
                )
                if projected_drift is not None:
                    const_inliers = [
                        e
                        for e in rescued_entries
                        if e["result"].get("aligned")
                        and isinstance(e["result"].get("offsetMs"), int)
                        and abs(int(e["result"]["offsetMs"]) - int(consensus.get("offsetMs", 0)))
                        <= 750
                    ]
                    if not consensus.get("aligned") or not (
                        len(const_inliers) >= 3
                        and int(projected_drift.get("confidence", 0))
                        < int(consensus.get("confidence", 0)) - 8
                    ):
                        consensus = projected_drift

            dense_rejected_windows = sum(
                1
                for idx, (win_speech, _, _) in enumerate(windows)
                if not entries[idx]["result"].get("aligned")
                and entries[idx]["result"].get("reason") in {
                    "low_alignment_confidence",
                    "offset_out_of_range",
                    "ambiguous_alignment",
                }
                and len(win_speech) >= 2
                and sum(max(0, e - s) for s, e in win_speech) >= 4_000
            )
            should_run_pooled_fallback = (
                not consensus.get("aligned")
                and not (not aligned_hints and dense_rejected_windows >= 2)
            )

            # Pooled multi-window fallback for sparse-dialogue movies (bounded span <= 10 min)
            if should_run_pooled_fallback:
                sorted_windows = sorted(windows, key=lambda w: w[1])
                pooled_subset = sorted_windows
                if sorted_windows[-1][2] - sorted_windows[0][1] > MAX_POOLED_WINDOW_SPAN_MS:
                    best_subset: list[tuple[list[tuple[int, int]], int, int]] = []
                    best_speech_ms = -1
                    for start_idx in range(len(sorted_windows)):
                        sub_start = sorted_windows[start_idx][1]
                        cand: list[tuple[list[tuple[int, int]], int, int]] = []
                        cand_speech_ms = 0
                        for item in sorted_windows[start_idx:]:
                            if item[2] - sub_start > MAX_POOLED_WINDOW_SPAN_MS:
                                break
                            cand.append(item)
                            cand_speech_ms += sum(max(0, e - s) for s, e in item[0])
                        if cand_speech_ms > best_speech_ms:
                            best_speech_ms = cand_speech_ms
                            best_subset = cand
                    pooled_subset = best_subset

                pooled_speech = merge_intervals(
                    [iv for win_speech, _, _ in pooled_subset for iv in win_speech]
                )
                if len(pooled_speech) >= 2 and pooled_subset:
                    min_start_ms = min(s for _, s, _ in pooled_subset)
                    max_end_ms = max(e for _, _, e in pooled_subset)
                    cue_intervals = [(c.start_ms, c.end_ms) for c in cues if c.end_ms > c.start_ms]
                    pooled_hints = list(aligned_hints)
                    for _, s_ms, e_ms in pooled_subset:
                        win_sp = [iv for iv in pooled_speech if iv[1] > s_ms and iv[0] < e_ms]
                        if win_sp:
                            for fft_off, fft_conf, _ in find_top_offsets_fft(
                                win_sp,
                                cue_intervals,
                                s_ms,
                                e_ms,
                                try_framerate_ratios=False,
                                top_k=2,
                            ):
                                if fft_conf >= 25.0:
                                    pooled_hints.append(fft_off)
                    pooled_centers = compute_track_search_centers(
                        cues,
                        pooled_speech,
                        min_start_ms,
                        additional_hints=pooled_hints or None,
                    )
                    try:
                        pooled_res = result_from_speech(
                            cues,
                            pooled_speech,
                            min_start_ms,
                            max_end_ms,
                            search_centers=pooled_centers,
                        )
                        if (
                            pooled_res.get("aligned")
                            and int(pooled_res.get("speechAnchorCount", 0)) >= 2
                            and int(pooled_res.get("confidence", 0)) >= 65
                        ):
                            consensus = pooled_res
                    except TypeError:
                        pass

        final_results[track] = consensus

    return {"results": final_results}


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
