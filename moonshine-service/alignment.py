from __future__ import annotations

import re
import struct
import wave
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
SEARCH_RANGE_MS = 180_000
SEARCH_STEP_MS = 250
REFINE_RANGE_MS = 750
REFINE_STEP_MS = 25
# Cue boundaries within this distance of a detected speech-interval boundary
# are snapped onto it, removing residual per-cue error after the global shift.
SNAP_RANGE_MS = 250


@dataclass(frozen=True)
class Cue:
    index: int
    start_ms: int
    end_ms: int
    block: str


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


def format_timestamp(value_ms: int) -> str:
    value_ms = max(0, int(round(value_ms)))
    hours, remainder = divmod(value_ms, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, milliseconds = divmod(remainder, 1_000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}.{milliseconds:03d}"


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


def score_offset(
    cues: list[Cue],
    speech_intervals: list[tuple[int, int]],
    offset_ms: int,
    audio_start_ms: int,
    audio_end_ms: int,
) -> float:
    if not cues or not speech_intervals:
        return 0.0

    analyzed_cues = [
        cue
        for cue in cues
        if cue.end_ms + offset_ms > audio_start_ms
        and cue.start_ms + offset_ms < audio_end_ms
    ]
    if not analyzed_cues:
        return 0.0

    total_cue_duration = sum(cue.end_ms - cue.start_ms for cue in analyzed_cues)
    total_speech_duration = sum(
        min(audio_end_ms, end_ms) - max(audio_start_ms, start_ms)
        for start_ms, end_ms in speech_intervals
        if end_ms > audio_start_ms and start_ms < audio_end_ms
    )
    if total_cue_duration <= 0 or total_speech_duration <= 0:
        return 0.0

    matched_cue_count = 0
    total_overlap = 0
    for cue in analyzed_cues:
        shifted_start = cue.start_ms + offset_ms
        shifted_end = cue.end_ms + offset_ms
        cue_overlap = sum(
            overlap_ms(shifted_start, shifted_end, start_ms, end_ms)
            for start_ms, end_ms in speech_intervals
        )
        total_overlap += min(cue_overlap, cue.end_ms - cue.start_ms)
        if cue_overlap >= MIN_SPEECH_INTERVAL_MS:
            matched_cue_count += 1

    cue_coverage = total_overlap / total_cue_duration
    speech_coverage = min(1.0, total_overlap / total_speech_duration)
    cue_match = matched_cue_count / len(analyzed_cues)
    return cue_coverage * 0.45 + speech_coverage * 0.35 + cue_match * 0.20


def find_best_offset(
    cues: list[Cue],
    speech_intervals: list[tuple[int, int]],
    audio_start_ms: int,
    audio_end_ms: int,
) -> tuple[int, float]:
    coarse_candidates = range(
        -SEARCH_RANGE_MS,
        SEARCH_RANGE_MS + 1,
        SEARCH_STEP_MS,
    )
    coarse_offset = max(
        coarse_candidates,
        key=lambda value: score_offset(
            cues,
            speech_intervals,
            value,
            audio_start_ms,
            audio_end_ms,
        ),
    )
    refined_candidates = range(
        coarse_offset - REFINE_RANGE_MS,
        coarse_offset + REFINE_RANGE_MS + 1,
        REFINE_STEP_MS,
    )
    best_offset = max(
        refined_candidates,
        key=lambda value: score_offset(
            cues,
            speech_intervals,
            value,
            audio_start_ms,
            audio_end_ms,
        ),
    )
    return best_offset, score_offset(
        cues,
        speech_intervals,
        best_offset,
        audio_start_ms,
        audio_end_ms,
    )


def snap_aligned_cue(
    cue: Cue,
    offset_ms: int,
    speech_intervals: list[tuple[int, int]],
) -> tuple[int, int] | None:
    """Return (start_ms, end_ms) in file coordinates for the aligned cue.

    The cue is shifted by the global offset; if it overlaps a detected speech
    interval, boundaries within SNAP_RANGE_MS of the interval are snapped onto
    it. Returns None when the cue should be dropped (shifted entirely before
    the file start).
    """
    shifted_start = cue.start_ms + offset_ms
    shifted_end = cue.end_ms + offset_ms
    if shifted_end <= 0:
        return None

    best_interval: tuple[int, int] | None = None
    best_overlap = 0
    for start_ms, end_ms in speech_intervals:
        interval_overlap = overlap_ms(
            shifted_start, shifted_end, start_ms, end_ms
        )
        if interval_overlap > best_overlap:
            best_overlap = interval_overlap
            best_interval = (start_ms, end_ms)

    snapped_start = shifted_start
    snapped_end = shifted_end
    if best_interval is not None and best_overlap > 0:
        interval_start, interval_end = best_interval
        if abs(interval_start - shifted_start) <= SNAP_RANGE_MS:
            snapped_start = interval_start
        if abs(interval_end - shifted_end) <= SNAP_RANGE_MS:
            snapped_end = interval_end

    file_start = max(0, snapped_start - offset_ms)
    file_end = max(0, snapped_end - offset_ms)
    if file_end <= file_start:
        return None
    return file_start, file_end


def build_cleaned_vtt(
    vtt: str,
    cues: list[Cue],
    speech_intervals: list[tuple[int, int]],
    offset_ms: int,
    audio_start_ms: int,
    audio_end_ms: int,
) -> str:
    """Rewrite the VTT with aligned timings.

    Every cue is shifted by the global offset and boundaries near a detected
    speech interval are snapped onto it. Unlike dropping unaligned cues inside
    the analysis window, every cue is kept so subtitles never permanently
    disappear where the user is currently watching.
    """
    if not cues or not speech_intervals:
        return vtt

    cue_by_block = {cue.block: cue for cue in cues}
    output_blocks: list[str] = []
    for block in re.split(r"\r?\n\s*\r?\n", vtt.strip()):
        cue = cue_by_block.get(block)
        if cue is None:
            output_blocks.append(block)
            continue

        aligned = snap_aligned_cue(cue, offset_ms, speech_intervals)
        if aligned is None:
            continue
        file_start, file_end = aligned

        lines = block.splitlines()
        for index, line in enumerate(lines):
            match = TIMING_RE.match(line)
            if match is None:
                continue
            lines[index] = (
                f"{format_timestamp(file_start)} --> {format_timestamp(file_end)}"
                + line[match.end(2) :]
            )
            break
        output_blocks.append("\n".join(lines))

    return "\n\n".join(output_blocks).strip() + "\n"


def alignment_result_from_speech(
    vtt: str,
    cues: list[Cue],
    speech_intervals: list[tuple[int, int]],
    audio_start_ms: int,
    audio_end_ms: int,
    find_best_offset_fn: Callable[..., tuple[int, float]] | None = None,
    build_cleaned_vtt_fn: Callable[..., str] | None = None,
) -> dict[str, Any]:
    if not speech_intervals:
        return {
            "aligned": False,
            "offsetMs": 0,
            "confidence": 0,
            "speechIntervals": [],
            "cleanedVtt": vtt,
            "reason": "no_speech_detected",
        }

    find_offset = find_best_offset_fn or find_best_offset
    clean_vtt = build_cleaned_vtt_fn or build_cleaned_vtt
    offset_ms, score = find_offset(
        cues,
        speech_intervals,
        audio_start_ms,
        audio_end_ms,
    )
    confidence = int(round(max(0.0, min(1.0, score)) * 100))
    cleaned_vtt = clean_vtt(
        vtt,
        cues,
        speech_intervals,
        offset_ms,
        audio_start_ms,
        audio_end_ms,
    )
    return {
        "aligned": confidence >= MIN_ALIGNMENT_CONFIDENCE,
        "offsetMs": offset_ms,
        "confidence": confidence,
        "speechIntervals": [
            {"startMs": start_ms, "endMs": end_ms}
            for start_ms, end_ms in speech_intervals
        ],
        "cleanedVtt": cleaned_vtt,
        "reason": (
            None
            if confidence >= MIN_ALIGNMENT_CONFIDENCE
            else "low_alignment_confidence"
        ),
    }


def invalid_alignment_result(
    vtt: str,
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
        "cleanedVtt": vtt,
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
        vtt,
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
                vtt,
                speech_intervals,
                "invalid_subtitle",
            )
            continue
        results[track] = result_from_speech(
            vtt,
            cues,
            speech_intervals,
            audio_start_ms,
            audio_end_ms,
        )
    return {"results": results}
