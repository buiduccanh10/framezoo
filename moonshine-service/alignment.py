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
MIN_ALIGNMENT_CONFIDENCE = 60
MIN_SPEECH_INTERVAL_MS = 120
MERGE_SPEECH_GAP_MS = 350
# A subtitle offset beyond this range is more likely a false match from a
# different scene than a real subtitle timing error.
MAX_ALIGNMENT_OFFSET_MS = 45_000
SEARCH_RANGE_MS = MAX_ALIGNMENT_OFFSET_MS
SEARCH_STEP_MS = 250
REFINE_RANGE_MS = 750
REFINE_STEP_MS = 25
SUBTITLE_ACTIVITY_MERGE_GAP_MS = 250
MAX_SPEECH_ANCHOR_ERROR_MS = 1_800
MIN_SPEECH_ANCHOR_OVERLAP_MS = 120
MIN_SPEECH_ANCHOR_COVERAGE = 0.5
MIN_MULTI_SPEECH_ANCHOR_COVERAGE = 2 / 3
_TRANSCRIPTION_LOCK = threading.Lock()


@dataclass(frozen=True)
class Cue:
    index: int
    start_ms: int
    end_ms: int
    block: str


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
    return merge_activity_intervals(
        clip_intervals(
            [
                (cue.start_ms + offset_ms, cue.end_ms + offset_ms)
                for cue in cues
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
    if (
        matched_anchors == 0
        or anchor_coverage < MIN_SPEECH_ANCHOR_COVERAGE
    ):
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
) -> tuple[int, float]:
    def rank_offset(value: int) -> tuple[float, int]:
        return (
            score_offset(
                cues,
                speech_intervals,
                value,
                audio_start_ms,
                audio_end_ms,
            ),
            -abs(value),
        )

    coarse_candidates = range(
        -SEARCH_RANGE_MS,
        SEARCH_RANGE_MS + 1,
        SEARCH_STEP_MS,
    )
    coarse_offset = max(coarse_candidates, key=rank_offset)
    refined_candidates = range(
        coarse_offset - REFINE_RANGE_MS,
        coarse_offset + REFINE_RANGE_MS + 1,
        REFINE_STEP_MS,
    )
    best_offset = max(refined_candidates, key=rank_offset)
    return best_offset, score_offset(
        cues,
        speech_intervals,
        best_offset,
        audio_start_ms,
        audio_end_ms,
    )


def alignment_result_from_speech(
    cues: list[Cue],
    speech_intervals: list[tuple[int, int]],
    audio_start_ms: int,
    audio_end_ms: int,
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
    if not cues:
        return invalid_alignment_result(
            speech_intervals,
            "invalid_subtitle",
        )

    find_offset = find_best_offset_fn or find_best_offset
    offset_ms, score = find_offset(
        cues,
        speech_intervals,
        audio_start_ms,
        audio_end_ms,
    )
    confidence = int(round(max(0.0, min(1.0, score)) * 100))
    if abs(offset_ms) >= MAX_ALIGNMENT_OFFSET_MS:
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
    minimum_anchor_coverage = (
        MIN_SPEECH_ANCHOR_COVERAGE
        if evidence.speech_anchor_count <= 2
        else MIN_MULTI_SPEECH_ANCHOR_COVERAGE
    )
    if (
        evidence.matched_anchors < minimum_anchors
        or evidence.anchor_coverage < minimum_anchor_coverage
    ):
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
    result_from_speech = alignment_result_fn or alignment_result_from_speech
    audio, sample_rate = decode(audio_data)
    audio_duration_ms = int(round(len(audio) * 1_000 / sample_rate))
    audio_end_ms = audio_start_ms + audio_duration_ms
    cues = parse_vtt(vtt)
    speech_intervals = transcribe(
        audio,
        sample_rate,
        language,
        audio_start_ms,
    )
    return result_from_speech(
        cues,
        speech_intervals,
        audio_start_ms,
        audio_end_ms,
    )


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
    result_from_speech = alignment_result_fn or alignment_result_from_speech
    audio, sample_rate = decode(audio_data)
    audio_duration_ms = int(round(len(audio) * 1_000 / sample_rate))
    audio_end_ms = audio_start_ms + audio_duration_ms
    speech_intervals = transcribe(
        audio,
        sample_rate,
        language,
        audio_start_ms,
    )

    results: dict[str, Any] = {}
    for subtitle in subtitles:
        track = subtitle["track"]
        vtt = subtitle["vttData"]
        try:
            cues = parse_vtt(vtt)
        except (IndexError, ValueError):
            results[track] = invalid_alignment_result(
                speech_intervals,
                "invalid_subtitle",
            )
            continue
        results[track] = result_from_speech(
            cues,
            speech_intervals,
            audio_start_ms,
            audio_end_ms,
        )
    return {"results": results}
