from __future__ import annotations

import asyncio
import json
import os
import wave
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile

import alignment as _alignment
from alignment import (
    MAX_AUDIO_BYTES,
    MAX_VTT_BYTES,
    MIN_ALIGNMENT_CONFIDENCE,
    alignment_result_from_speech as _alignment_result_from_speech,
    decode_wav,
    evaluate_offset,
    find_best_offset,
    parse_vtt,
    transcribe_speech_intervals,
)
from model_runtime import (
    ModelArch,
    Transcriber,
    get_model_for_language,
    get_transcriber,
    normalize_language,
    preload_transcribers,
    resolve_model_arch,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    preload_transcribers()
    yield


app = FastAPI(
    title="Framezoo Moonshine alignment service",
    version="1",
    lifespan=lifespan,
)


def alignment_result_from_speech(
    cues: list[_alignment.Cue],
    speech_intervals: list[tuple[int, int]],
    audio_start_ms: int,
    audio_end_ms: int,
    search_centers: list[int] | None = None,
    find_best_offset_fn: Any = None,
) -> dict[str, Any]:
    return _alignment_result_from_speech(
        cues,
        speech_intervals,
        audio_start_ms,
        audio_end_ms,
        search_centers=search_centers,
        find_best_offset_fn=find_best_offset_fn or find_best_offset,
    )


def align_vtt(
    audio_data: bytes,
    vtt: str,
    language: str,
    audio_start_ms: int,
) -> dict[str, Any]:
    return _alignment.align_vtt(
        audio_data,
        vtt,
        language,
        audio_start_ms,
        decode_wav_fn=decode_wav,
        transcribe_speech_intervals_fn=transcribe_speech_intervals,
        alignment_result_fn=alignment_result_from_speech,
    )


def align_vtt_batch(
    audio_data: bytes,
    subtitles: list[dict[str, str]],
    language: str,
    audio_start_ms: int,
) -> dict[str, Any]:
    return _alignment.align_vtt_batch(
        audio_data,
        subtitles,
        language,
        audio_start_ms,
        decode_wav_fn=decode_wav,
        transcribe_speech_intervals_fn=transcribe_speech_intervals,
        alignment_result_fn=alignment_result_from_speech,
    )


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
        res = await asyncio.to_thread(
            align_vtt_batch,
            audio_data,
            subtitle_items,
            normalize_language(language),
            max(0, int(audio_start_ms)),
        )
        import logging
        logging.getLogger("uvicorn.error").info("ALIGN_BATCH_OUT (start_ms=%s): %s", audio_start_ms, res)
        return res
    except (ValueError, wave.Error) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
