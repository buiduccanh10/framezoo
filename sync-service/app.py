import json
import os
import wave
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, File, Form, Header, HTTPException, Request, Response, UploadFile

import alignment as _alignment
from alignment import (
    MAX_ALIGNMENT_TOTAL_AUDIO_BYTES,
    MAX_AUDIO_BYTES,
    MAX_VTT_BYTES,
    MIN_ALIGNMENT_CONFIDENCE,
    alignment_result_from_speech as _alignment_result_from_speech,
    align_speech_windows as _align_speech_windows,
    align_vtt_windows as _align_vtt_windows,
    decode_wav,
    evaluate_offset,
    find_best_offset,
    parse_vtt,
    transcribe_speech_intervals,
)
from limiter import check_request_rate_limit, run_protected_inference
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

MAX_ALIGNMENT_WINDOWS = 6


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


def align_speech_batch(
    speech_intervals: list[tuple[int, int]],
    subtitles: list[dict[str, str]],
    audio_start_ms: int,
    audio_end_ms: int,
) -> dict[str, Any]:
    return _alignment.align_speech_batch(
        speech_intervals,
        subtitles,
        audio_start_ms,
        audio_end_ms,
        alignment_result_fn=alignment_result_from_speech,
    )


def align_vtt_windows(
    windows: list[tuple[bytes, int]],
    subtitles: list[dict[str, str]],
    language: str,
) -> dict[str, Any]:
    return _align_vtt_windows(
        windows,
        subtitles,
        language,
        decode_wav_fn=decode_wav,
        transcribe_speech_intervals_fn=transcribe_speech_intervals,
        alignment_result_fn=alignment_result_from_speech,
    )


def align_speech_windows(
    windows: list[tuple[list[tuple[int, int]], int, int]],
    subtitles: list[dict[str, str]],
) -> dict[str, Any]:
    return _align_speech_windows(
        windows,
        subtitles,
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


def _parse_interval(value: Any) -> tuple[int, int]:
    if not isinstance(value, dict):
        raise ValueError("speech interval must be an object")
    start_ms = value.get("startMs")
    end_ms = value.get("endMs")
    if (
        isinstance(start_ms, bool)
        or isinstance(end_ms, bool)
        or not isinstance(start_ms, int)
        or not isinstance(end_ms, int)
        or start_ms < 0
        or end_ms <= start_ms
    ):
        raise ValueError("speech interval must contain valid startMs and endMs")
    return start_ms, end_ms


def parse_speech_intervals(value: str) -> list[tuple[int, int]]:
    try:
        payload = json.loads(value)
    except json.JSONDecodeError as error:
        raise ValueError("speechIntervals must be valid JSON") from error
    if not isinstance(payload, list):
        raise ValueError("speechIntervals must be an array")
    if len(payload) > 500:
        raise ValueError("too many speech intervals")
    return [_parse_interval(item) for item in payload]


def parse_speech_interval_windows(
    value: str,
    expected_count: int,
) -> list[list[tuple[int, int]]]:
    try:
        payload = json.loads(value)
    except json.JSONDecodeError as error:
        raise ValueError("speechIntervals must be valid JSON") from error
    if (
        not isinstance(payload, list)
        or len(payload) != expected_count
        or any(not isinstance(window, list) for window in payload)
    ):
        raise ValueError("invalid speech window metadata")
    return [parse_speech_intervals(json.dumps(window)) for window in payload]


def parse_window_starts(value: str, expected_count: int) -> list[int]:
    try:
        payload = json.loads(value)
    except json.JSONDecodeError as error:
        raise ValueError("windowStartsMs must be valid JSON") from error
    if (
        not isinstance(payload, list)
        or len(payload) != expected_count
        or any(
            isinstance(item, bool)
            or not isinstance(item, int)
            or item < 0
            for item in payload
        )
    ):
        raise ValueError("invalid alignment window metadata")
    return payload


def parse_window_durations(
    value: str,
    expected_count: int,
) -> list[int]:
    try:
        payload = json.loads(value)
    except json.JSONDecodeError as error:
        raise ValueError("windowDurationsMs must be valid JSON") from error
    if (
        not isinstance(payload, list)
        or len(payload) != expected_count
        or any(
            isinstance(item, bool)
            or not isinstance(item, int)
            or item <= 0
            for item in payload
        )
    ):
        raise ValueError("invalid alignment window durations")
    return payload


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
    request: Request,
    audio: UploadFile = File(...),
    vtt: UploadFile | None = File(default=None),
    subtitles: str | None = Form(default=None),
    language: str = Form("en"),
    audio_start_ms: int = Form(0),
    x_internal_token: str | None = Header(default=None),
) -> dict[str, Any]:
    validate_internal_token(x_internal_token)
    await check_request_rate_limit(request)

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
            return await run_protected_inference(
                align_vtt_batch,
                audio_data,
                subtitle_items,
                normalize_language(language),
                max(0, int(audio_start_ms)),
            )
        except (ValueError, wave.Error) as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        except HTTPException:
            raise
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
        return await run_protected_inference(
            align_vtt,
            audio_data,
            vtt_data.decode("utf-8-sig"),
            normalize_language(language),
            max(0, int(audio_start_ms)),
        )
    except (ValueError, wave.Error) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.post("/v1/align-batch")
async def align_batch_endpoint(
    request: Request,
    audio: UploadFile | None = File(default=None),
    subtitles: str = Form(...),
    language: str = Form("en"),
    audio_start_ms: int = Form(0),
    audio_end_ms: int | None = Form(default=None),
    speech_intervals: str | None = Form(default=None),
    x_internal_token: str | None = Header(default=None),
) -> dict[str, Any]:
    validate_internal_token(x_internal_token)
    await check_request_rate_limit(request)

    if audio is None and speech_intervals is None:
        raise HTTPException(
            status_code=400,
            detail="audio or speechIntervals is required",
        )
    if audio is not None and speech_intervals is not None:
        raise HTTPException(
            status_code=400,
            detail="audio and speechIntervals cannot be sent together",
        )

    try:
        subtitle_items = parse_batch_subtitles(subtitles)
        start_ms = max(0, int(audio_start_ms))
        if speech_intervals is not None:
            intervals = parse_speech_intervals(speech_intervals)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    if speech_intervals is not None:
        end_ms = (
            max(start_ms + 1, max((end for _, end in intervals), default=0))
            if audio_end_ms is None
            else int(audio_end_ms)
        )
        if end_ms <= start_ms:
            raise HTTPException(
                status_code=400,
                detail="audioEndMs must be greater than audioStartMs",
            )
        try:
            return await run_protected_inference(
                align_speech_batch,
                intervals,
                subtitle_items,
                start_ms,
                end_ms,
            )
        except (ValueError, wave.Error) as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        except HTTPException:
            raise
        except Exception as error:
            raise HTTPException(status_code=502, detail=str(error)) from error

    assert audio is not None
    audio_data = await audio.read()
    if len(audio_data) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="audio is too large")
    if not audio_data:
        raise HTTPException(status_code=400, detail="audio is empty")

    try:
        res = await run_protected_inference(
            align_vtt_batch,
            audio_data,
            subtitle_items,
            normalize_language(language),
            start_ms,
        )
        import logging
        logging.getLogger("uvicorn.error").info(
            "ALIGN_BATCH_OUT (start_ms=%s): %s",
            audio_start_ms,
            res,
        )
        return res
    except (ValueError, wave.Error) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.post("/v1/align-windows")
async def align_windows_endpoint(
    request: Request,
    audio: list[UploadFile] | None = File(default=None),
    subtitles: str = Form(...),
    window_starts_ms: str = Form(...),
    language: str = Form("en"),
    window_durations_ms: str | None = Form(default=None),
    speech_intervals: str | None = Form(default=None),
    x_internal_token: str | None = Header(default=None),
) -> dict[str, Any]:
    validate_internal_token(x_internal_token)
    await check_request_rate_limit(request)

    if audio is not None and speech_intervals is not None:
        raise HTTPException(
            status_code=400,
            detail="audio and speechIntervals cannot be sent together",
        )
    if audio is None and speech_intervals is None:
        raise HTTPException(
            status_code=400,
            detail="audio windows or speechIntervals are required",
        )

    try:
        subtitle_items = parse_batch_subtitles(subtitles)
        if audio is not None:
            window_count = len(audio)
        else:
            raw_intervals = json.loads(speech_intervals or "null")
            window_count = (
                len(raw_intervals) if isinstance(raw_intervals, list) else 0
            )
        if not 1 <= window_count <= MAX_ALIGNMENT_WINDOWS:
            raise ValueError("invalid alignment window metadata")
        starts = parse_window_starts(window_starts_ms, window_count)
        if speech_intervals is not None:
            interval_windows = parse_speech_interval_windows(
                speech_intervals,
                window_count,
            )
            if window_durations_ms is None:
                raise ValueError("windowDurationsMs is required for speechIntervals")
            durations = parse_window_durations(
                window_durations_ms,
                window_count,
            )
    except (ValueError, json.JSONDecodeError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    if speech_intervals is not None:
        speech_windows = [
            (intervals, start_ms, start_ms + duration_ms)
            for intervals, start_ms, duration_ms in zip(
                interval_windows,
                starts,
                durations,
            )
        ]
        try:
            return await run_protected_inference(
                align_speech_windows,
                speech_windows,
                subtitle_items,
            )
        except (ValueError, wave.Error) as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        except HTTPException:
            raise
        except Exception as error:
            raise HTTPException(status_code=502, detail=str(error)) from error

    assert audio is not None
    windows: list[tuple[bytes, int]] = []
    total_audio_bytes = 0
    for window_audio, start_ms in zip(audio, starts):
        audio_data = await window_audio.read()
        total_audio_bytes += len(audio_data)
        if len(audio_data) > MAX_AUDIO_BYTES:
            raise HTTPException(status_code=413, detail="audio is too large")
        if not audio_data:
            raise HTTPException(status_code=400, detail="audio is empty")
        windows.append((audio_data, start_ms))

    if total_audio_bytes > MAX_ALIGNMENT_TOTAL_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="alignment audio is too large")

    try:
        return await run_protected_inference(
            align_vtt_windows,
            windows,
            subtitle_items,
            normalize_language(language),
        )
    except (ValueError, wave.Error) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
