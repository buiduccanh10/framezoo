from __future__ import annotations

import asyncio
import json
import math
import os
import re
import struct
import threading
import wave
from dataclasses import dataclass
from typing import Any

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile

try:
    from moonshine_voice import ModelArch, Transcriber, get_model_for_language
except ImportError:  # pragma: no cover - exercised only by broken image builds
    ModelArch = None
    Transcriber = None
    get_model_for_language = None


from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    if Transcriber is not None and get_model_for_language is not None:
        if not os.getenv("MOONSHINE_MODEL_ARCH"):
            os.environ["MOONSHINE_MODEL_ARCH"] = "tiny"
        get_transcriber("en")
        get_transcriber("ko")
    yield

app = FastAPI(title="Betamovie Moonshine alignment service", version="1", lifespan=lifespan)

TIMING_RE = re.compile(
    r"^\s*((?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d{3})?)\s+-->\s+"
    r"((?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d{3})?)(?:\s+.*)?$"
)
TAG_RE = re.compile(r"<[^>]+>")
LANGUAGE_RE = re.compile(r"^[a-z]{2,3}(?:-[a-z]{2,4})?$", re.IGNORECASE)
ISO_639_3_TO_1 = {
    "ara": "ar",
    "ces": "cs",
    "deu": "de",
    "ell": "el",
    "eng": "en",
    "fas": "fa",
    "fin": "fi",
    "fra": "fr",
    "heb": "he",
    "hin": "hi",
    "ind": "id",
    "ita": "it",
    "jpn": "ja",
    "kor": "ko",
    "nld": "nl",
    "nor": "no",
    "pol": "pl",
    "por": "pt",
    "ron": "ro",
    "rus": "ru",
    "spa": "es",
    "swe": "sv",
    "tha": "th",
    "tur": "tr",
    "ukr": "uk",
    "vie": "vi",
    "zho": "zh",
}

MAX_AUDIO_BYTES = 8 * 1024 * 1024
MAX_VTT_BYTES = 2 * 1024 * 1024
MIN_ALIGNMENT_CONFIDENCE = 60
MIN_SPEECH_INTERVAL_MS = 120
MERGE_SPEECH_GAP_MS = 350
SEARCH_RANGE_MS = 180_000
SEARCH_STEP_MS = 250
REFINE_RANGE_MS = 750
REFINE_STEP_MS = 25


@dataclass(frozen=True)
class Cue:
    index: int
    start_ms: int
    end_ms: int
    block: str


_transcribers: dict[str, Any] = {}
_transcriber_lock = threading.Lock()


def normalize_language(language: str) -> str:
    value = (language or os.getenv("MOONSHINE_LANGUAGE", "en")).strip().lower()
    if not LANGUAGE_RE.fullmatch(value):
        return "en"
    base_language = value.split("-", 1)[0]
    return ISO_639_3_TO_1.get(base_language, base_language)


def resolve_model_arch():
    value = os.getenv("MOONSHINE_MODEL_ARCH", "").strip().lower()
    if not value:
        return None
    if ModelArch is None:
        raise RuntimeError("moonshine_voice is not installed")

    named_arches = {
        "tiny": ModelArch.TINY,
        "base": ModelArch.BASE,
    }
    if value in named_arches:
        return named_arches[value]
    try:
        return ModelArch(int(value))
    except (TypeError, ValueError):
        raise RuntimeError(
            "MOONSHINE_MODEL_ARCH must be tiny, base, or a valid model enum value"
        ) from None


def get_transcriber(language: str):
    if Transcriber is None or get_model_for_language is None:
        raise RuntimeError("moonshine_voice is not installed")

    normalized = normalize_language(language)
    with _transcriber_lock:
        transcriber = _transcribers.get(normalized)
        if transcriber is not None:
            return transcriber

        model_arch = resolve_model_arch()
        try:
            model_path, resolved_arch = get_model_for_language(
                normalized,
                model_arch,
            )
        except ValueError:
            if model_arch is None:
                raise
            # Some Moonshine languages only publish a base model.
            model_path, resolved_arch = get_model_for_language(normalized)
        transcriber = Transcriber(
            model_path=model_path,
            model_arch=resolved_arch,
        )
        _transcribers[normalized] = transcriber
        return transcriber


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
    with _transcriber_lock:
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


def build_cleaned_vtt(
    vtt: str,
    cues: list[Cue],
    speech_intervals: list[tuple[int, int]],
    offset_ms: int,
    audio_start_ms: int,
    audio_end_ms: int,
) -> str:
    if not cues or not speech_intervals:
        return vtt

    keep_indexes: set[int] = set()
    for cue in cues:
        shifted_start = cue.start_ms + offset_ms
        shifted_end = cue.end_ms + offset_ms
        if shifted_end <= 0:
            continue
        if shifted_end <= audio_start_ms or shifted_start >= audio_end_ms:
            keep_indexes.add(cue.index)
            continue
        cue_overlap = sum(
            overlap_ms(shifted_start, shifted_end, start_ms, end_ms)
            for start_ms, end_ms in speech_intervals
        )
        if cue_overlap >= MIN_SPEECH_INTERVAL_MS:
            keep_indexes.add(cue.index)

    cue_by_block = {cue.block: cue for cue in cues}
    output_blocks: list[str] = []
    cue_index = 0
    for block in re.split(r"\r?\n\s*\r?\n", vtt.strip()):
        cue = cue_by_block.get(block)
        if cue is None:
            output_blocks.append(block)
            continue
        if cue.index in keep_indexes:
            output_blocks.append(block)
        cue_index += 1
    return "\n\n".join(output_blocks).strip() + "\n"


def alignment_result_from_speech(
    vtt: str,
    cues: list[Cue],
    speech_intervals: list[tuple[int, int]],
    audio_start_ms: int,
    audio_end_ms: int,
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

    offset_ms, score = find_best_offset(
        cues,
        speech_intervals,
        audio_start_ms,
        audio_end_ms,
    )
    confidence = int(round(max(0.0, min(1.0, score)) * 100))
    cleaned_vtt = build_cleaned_vtt(
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
) -> dict[str, Any]:
    audio, sample_rate = decode_wav(audio_data)
    audio_duration_ms = int(round(len(audio) * 1_000 / sample_rate))
    audio_end_ms = audio_start_ms + audio_duration_ms
    cues = parse_vtt(vtt)
    speech_intervals = transcribe_speech_intervals(
        audio,
        sample_rate,
        language,
        audio_start_ms,
    )
    return alignment_result_from_speech(
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
) -> dict[str, Any]:
    audio, sample_rate = decode_wav(audio_data)
    audio_duration_ms = int(round(len(audio) * 1_000 / sample_rate))
    audio_end_ms = audio_start_ms + audio_duration_ms
    speech_intervals = transcribe_speech_intervals(
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
        results[track] = alignment_result_from_speech(
            vtt,
            cues,
            speech_intervals,
            audio_start_ms,
            audio_end_ms,
        )
    return {"results": results}


def parse_batch_subtitles(value: str) -> list[dict[str, str]]:
    try:
        payload = json.loads(value)
    except json.JSONDecodeError as error:
        raise ValueError("subtitles must be valid JSON") from error

    if not isinstance(payload, list) or not payload:
        raise ValueError("subtitles must be a non-empty array")
    if len(payload) > 2:
        raise ValueError("subtitles supports primary and secondary tracks only")

    subtitles: list[dict[str, str]] = []
    seen_tracks: set[str] = set()
    for item in payload:
        if not isinstance(item, dict):
            raise ValueError("each subtitle must be an object")
        track = item.get("track")
        vtt_data = item.get("vttData")
        if track not in {"primary", "secondary"}:
            raise ValueError("subtitle track must be primary or secondary")
        if track in seen_tracks:
            raise ValueError("subtitle tracks must be unique")
        if not isinstance(vtt_data, str) or not vtt_data.strip():
            raise ValueError("subtitle vttData must be a non-empty string")
        if len(vtt_data.encode("utf-8")) > MAX_VTT_BYTES:
            raise ValueError("subtitle is too large")
        seen_tracks.add(track)
        subtitles.append({"track": track, "vttData": vtt_data})
    return subtitles


def validate_internal_token(token: str | None) -> None:
    expected_token = os.getenv("MOONSHINE_INTERNAL_TOKEN", "").strip()
    if expected_token and token != expected_token:
        raise HTTPException(status_code=401, detail="invalid internal token")


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "model": os.getenv("MOONSHINE_MODEL_ARCH", "default"),
        "language": normalize_language(os.getenv("MOONSHINE_LANGUAGE", "en")),
    }


@app.post("/v1/align")
async def align(
    audio: UploadFile = File(...),
    vtt: UploadFile | None = File(default=None),
    subtitles: str | None = Form(default=None),
    language: str = Form("en"),
    audio_start_ms: int = Form(0),
    x_internal_token: str | None = Header(default=None),
) -> dict[str, Any]:
    validate_internal_token(x_internal_token)
    if vtt is None and subtitles is None:
        raise HTTPException(
            status_code=400,
            detail="audio and vtt or subtitles are required",
        )

    if subtitles is not None:
        try:
            subtitle_items = parse_batch_subtitles(subtitles)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

        audio_data = await audio.read()
        if len(audio_data) > MAX_AUDIO_BYTES:
            raise HTTPException(status_code=413, detail="audio is too large")
        if not audio_data:
            raise HTTPException(status_code=400, detail="audio is empty")

        try:
            return await asyncio.to_thread(
                align_vtt_batch,
                audio_data,
                subtitle_items,
                normalize_language(language),
                max(0, int(audio_start_ms)),
            )
        except (ValueError, wave.Error) as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        except Exception as error:
            raise HTTPException(status_code=502, detail=str(error)) from error

    assert vtt is not None
    vtt_data = await vtt.read()
    if len(vtt_data) > MAX_VTT_BYTES:
        raise HTTPException(status_code=413, detail="subtitle is too large")

    audio_data = await audio.read()
    if len(audio_data) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="audio is too large")
    if not audio_data:
        raise HTTPException(status_code=400, detail="audio is empty")

    try:
        return await asyncio.to_thread(
            align_vtt,
            audio_data,
            vtt_data.decode("utf-8-sig"),
            normalize_language(language),
            max(0, int(audio_start_ms)),
        )
    except (ValueError, wave.Error) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.post("/v1/align-batch")
async def align_batch_endpoint(
    audio: UploadFile = File(...),
    subtitles: str = Form(...),
    language: str = Form("en"),
    audio_start_ms: int = Form(0),
    x_internal_token: str | None = Header(default=None),
) -> dict[str, Any]:
    validate_internal_token(x_internal_token)
    try:
        subtitle_items = parse_batch_subtitles(subtitles)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    audio_data = await audio.read()
    if len(audio_data) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="audio is too large")
    if not audio_data:
        raise HTTPException(status_code=400, detail="audio is empty")

    try:
        return await asyncio.to_thread(
            align_vtt_batch,
            audio_data,
            subtitle_items,
            normalize_language(language),
            max(0, int(audio_start_ms)),
        )
    except (ValueError, wave.Error) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
