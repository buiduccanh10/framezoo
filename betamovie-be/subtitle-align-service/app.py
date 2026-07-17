from __future__ import annotations

import html
import os
import re
import statistics
import subprocess
import tempfile
import threading
import unicodedata
from difflib import SequenceMatcher
from typing import Any

from fastapi import FastAPI, Header, HTTPException
from faster_whisper import WhisperModel
from pydantic import BaseModel, Field


MODEL_NAME = os.getenv("ALIGN_MODEL", "small")
MODEL_DIR = os.getenv("ALIGN_MODEL_DIR", "/models")
CPU_THREADS = max(1, int(os.getenv("ALIGN_CPU_THREADS", "4")))
FFMPEG_TIMEOUT_SECONDS = max(
    30, int(os.getenv("ALIGN_FFMPEG_TIMEOUT_SECONDS", "120"))
)
MAX_WINDOW_MS = 60_000
MAX_SUBTITLE_BYTES = 1_000_000
MAX_OFFSET_MS = 120_000
ALIGNMENT_STEP_MS = 50
SPEECH_PADDING_MS = 150
INTERNAL_TOKEN = os.getenv("ALIGN_INTERNAL_TOKEN", "").strip()
ASR_ONSET_DELAY_MS = int(os.getenv("ALIGN_ASR_ONSET_DELAY_MS", "0"))
PROVIDER_AD_RE = re.compile(
    r"(?:https?://|www\.|[\w-]+\.(?:com|net|org)\b|opensubtitles|"
    r"download subtitles|subtitles? for any video|tryray|osdb|"
    r"watch online movies|"
    r"subtitles provided by)",
    re.IGNORECASE,
)

app = FastAPI(title="Betamovie Subtitle Align Service", version="1.0.0")
model_lock = threading.Lock()
model: WhisperModel | None = None


class WindowRequest(BaseModel):
    startMs: int = Field(ge=0)
    durationMs: int = Field(gt=0, le=MAX_WINDOW_MS)


class AlignRequest(BaseModel):
    sourceUrl: str = Field(min_length=1, max_length=8192)
    subtitleVtt: str = Field(min_length=1, max_length=MAX_SUBTITLE_BYTES)
    windows: list[WindowRequest] = Field(min_length=1, max_length=2)


def get_model() -> WhisperModel:
    global model
    if model is not None:
        return model

    with model_lock:
        if model is None:
            model = WhisperModel(
                MODEL_NAME,
                device="cpu",
                compute_type="int8",
                cpu_threads=CPU_THREADS,
                download_root=MODEL_DIR,
            )
    return model


def parse_timestamp(raw: str) -> int:
    value = raw.strip().replace(",", ".")
    parts = value.split(":")
    if len(parts) == 2:
        hours = 0
        minutes, seconds = parts
    elif len(parts) == 3:
        hours, minutes, seconds = parts
    else:
        raise ValueError("Invalid subtitle timestamp")

    seconds_value = float(seconds)
    return round(
        (int(hours) * 3600 + int(minutes) * 60 + seconds_value) * 1000
    )


TIMING_RE = re.compile(
    r"^\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{3})\s+-->\s+"
    r"((?:\d+:)?\d{1,2}:\d{2}[.,]\d{3})"
)
TAG_RE = re.compile(r"<[^>]+>")
WHITESPACE_RE = re.compile(r"\s+")


def normalize_text(raw: str) -> str:
    value = html.unescape(raw.replace("\\N", " "))
    value = TAG_RE.sub(" ", value).casefold()
    chars = []
    for char in value:
        category = unicodedata.category(char)
        if category.startswith("P") or category.startswith("S"):
            chars.append(" ")
        else:
            chars.append(char)
    return WHITESPACE_RE.sub(" ", "".join(chars)).strip()


def tokenize(raw: str) -> list[str]:
    return [token for token in normalize_text(raw).split(" ") if token]


def parse_vtt(vtt: str) -> list[dict[str, Any]]:
    cues: list[dict[str, Any]] = []
    blocks = re.split(r"\r?\n\s*\r?\n", vtt.strip())

    for block in blocks:
        lines = block.splitlines()
        timing_index = next(
            (index for index, line in enumerate(lines) if TIMING_RE.match(line)),
            None,
        )
        if timing_index is None:
            continue

        match = TIMING_RE.match(lines[timing_index])
        if not match:
            continue

        try:
            start_ms = parse_timestamp(match.group(1))
            end_ms = parse_timestamp(match.group(2))
        except ValueError:
            continue

        raw_text = " ".join(lines[timing_index + 1 :]).strip()
        text = normalize_text(raw_text)
        if end_ms <= start_ms or not text:
            continue

        cues.append(
            {
                "startMs": start_ms,
                "endMs": end_ms,
                "text": text,
                "rawText": raw_text,
                "tokens": text.split(" "),
            }
        )

    return sorted(cues, key=lambda cue: (cue["startMs"], cue["endMs"]))


def is_hls_url(source_url: str) -> bool:
    lowered = source_url.lower()
    return ".m3u8" in lowered or "/api/m3u8-proxy" in lowered


def extract_audio(source_url: str, window: WindowRequest) -> bytes:
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error"]
    if is_hls_url(source_url):
        command.extend(
            [
                "-protocol_whitelist",
                "file,http,https,tcp,tls,crypto,data",
                "-allowed_extensions",
                "ALL",
                "-extension_picky",
                "0",
                "-f",
                "hls",
            ]
        )

    command.extend(
        [
            "-i",
            source_url,
            # Seek after opening the HLS input. Input-side seeking can land on
            # an earlier segment boundary and shift every ASR timestamp.
            "-ss",
            f"{window.startMs / 1000:.3f}",
            "-t",
            f"{window.durationMs / 1000:.3f}",
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-f",
            "wav",
            "pipe:1",
        ]
    )

    try:
        result = subprocess.run(
            command,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=FFMPEG_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as error:
        raise RuntimeError("ffmpeg timed out while extracting subtitle audio") from error

    if result.returncode != 0 or not result.stdout:
        error = result.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"ffmpeg failed to extract subtitle audio: {error[-500:]}")

    return result.stdout


def transcribe_window(source_url: str, window: WindowRequest) -> list[dict[str, Any]]:
    audio = extract_audio(source_url, window)
    whisper = get_model()

    with tempfile.NamedTemporaryFile(suffix=".wav") as audio_file:
        audio_file.write(audio)
        audio_file.flush()
        segments, _ = whisper.transcribe(
            audio_file.name,
            beam_size=5,
            word_timestamps=True,
            vad_filter=True,
            condition_on_previous_text=False,
        )
        output = []
        for segment in segments:
            text = normalize_text(segment.text or "")
            if not text:
                continue

            start_ms = window.startMs + round(max(0.0, float(segment.start)) * 1000)
            end_ms = window.startMs + round(
                max(float(segment.start), float(segment.end)) * 1000
            )
            words = []
            for word in segment.words or []:
                if word.start is None or word.end is None:
                    continue
                word_text = normalize_text(word.word or "")
                if not word_text:
                    continue
                word_start_ms = window.startMs + round(max(0.0, float(word.start)) * 1000)
                word_end_ms = window.startMs + round(
                    max(float(word.start), float(word.end)) * 1000
                )
                if word_end_ms > word_start_ms:
                    words.append(
                        {
                            "startMs": word_start_ms,
                            "endMs": word_end_ms,
                            "text": word_text,
                        }
                    )
            output.append(
                {
                    "startMs": start_ms,
                    "endMs": end_ms,
                    "text": text,
                    "tokens": text.split(" "),
                    "words": words,
                }
            )

    return output


def overlap_ms(
    first_start: int,
    first_end: int,
    second_start: int,
    second_end: int,
) -> int:
    return max(0, min(first_end, second_end) - max(first_start, second_start))


def median_offset(offsets: list[int]) -> int:
    return round(statistics.median(offsets))


def text_similarity(left: list[str], right: list[str]) -> float:
    if not left or not right:
        return 0.0

    left_text = " ".join(left)
    right_text = " ".join(right)
    sequence_score = SequenceMatcher(None, left_text, right_text).ratio()
    left_set = set(left)
    right_set = set(right)
    token_score = len(left_set & right_set) / max(len(left_set | right_set), 1)
    return max(sequence_score, token_score)


def text_align(
    cues: list[dict[str, Any]],
    transcript: list[dict[str, Any]],
    window: WindowRequest,
) -> dict[str, Any] | None:
    window_end = window.startMs + window.durationMs
    window_cues = [
        cue
        for cue in cues
        if cue["endMs"] > window.startMs and cue["startMs"] < window_end
    ]
    window_segments = [
        segment
        for segment in transcript
        if segment["endMs"] > window.startMs and segment["startMs"] < window_end
    ]
    if not window_cues or not window_segments:
        return None

    matches: list[dict[str, Any]] = []
    transcript_index = 0

    for cue in window_cues:
        best: dict[str, Any] | None = None
        max_end = min(len(window_segments), transcript_index + 4)
        for start_index in range(transcript_index, max_end):
            combined_tokens: list[str] = []
            for end_index in range(start_index, min(len(window_segments), start_index + 3)):
                combined_tokens.extend(window_segments[end_index]["tokens"])
                score = text_similarity(cue["tokens"], combined_tokens)
                candidate = {
                    "score": score,
                    "startMs": window_segments[start_index]["startMs"],
                    "endIndex": end_index,
                    "tokenCount": len(cue["tokens"]),
                }
                if best is None or candidate["score"] > best["score"]:
                    best = candidate

        if best and best["score"] >= 0.48:
            matches.append(
                {
                    "offsetMs": best["startMs"] - cue["startMs"],
                    "score": best["score"],
                    "tokenCount": best["tokenCount"],
                }
            )
            transcript_index = best["endIndex"] + 1

    if not matches:
        return None

    offsets = [match["offsetMs"] for match in matches]
    center = median_offset(offsets)
    inliers = [
        match
        for match in matches
        if abs(match["offsetMs"] - center) <= 600
    ]
    matched_tokens = sum(match["tokenCount"] for match in inliers)

    if len(inliers) < 3 and matched_tokens < 8:
        return None

    score = sum(match["score"] for match in inliers) / len(inliers)
    confidence = "high" if len(inliers) >= 5 and score >= 0.62 else "medium"
    return {
        "offsetMs": center,
        "score": round(score, 4),
        "confidence": confidence,
        "matchedCueCount": len(inliers),
        "matchedTokens": matched_tokens,
        "method": "text",
    }


def merge_intervals(intervals: list[tuple[int, int]]) -> list[tuple[int, int]]:
    merged: list[tuple[int, int]] = []
    for start, end in sorted(intervals):
        if end <= start:
            continue
        if not merged or start > merged[-1][1]:
            merged.append((start, end))
        else:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
    return merged

def is_non_dialogue_cue(cue: dict[str, Any]) -> bool:
    text = cue["text"].strip()
    if PROVIDER_AD_RE.search(text):
        return True

    raw_text = cue.get("rawText", text).strip()
    letters = [char for char in raw_text if char.isalpha()]
    if not letters or not all(char.isupper() for char in letters):
        return False

    # Ignore likely title cards/disclaimers, but keep uppercase dialogue that
    # has a spoken sentence ending or an explicit dialogue dash.
    return not text.startswith(("-", "–")) and not text.endswith(
        ("!", "?", ".", "…", "。", "！", "？")
    )


def interval_iou(
    first_start: int,
    first_end: int,
    second_start: int,
    second_end: int,
) -> float:
    overlap = overlap_ms(first_start, first_end, second_start, second_end)
    union = max(first_end, second_end) - min(first_start, second_start)
    return overlap / max(union, 1)


def speech_align(
    cues: list[dict[str, Any]],
    transcript: list[dict[str, Any]],
    window: WindowRequest,
) -> dict[str, Any] | None:
    window_end = window.startMs + window.durationMs
    speech_segments = []
    speech_intervals = []
    for segment in transcript:
        segment_start = max(window.startMs, segment["startMs"])
        segment_end = min(window_end, segment["endMs"])
        if segment_end <= segment_start:
            continue

        speech_segments.append(
            {
                "startMs": segment_start,
                "endMs": segment_end,
            }
        )

        words = segment.get("words") or []
        padded_start = max(
            window.startMs, segment["startMs"] - SPEECH_PADDING_MS
        )
        padded_end = min(window_end, segment["endMs"] + SPEECH_PADDING_MS)
        segment_duration = max(1, segment["endMs"] - segment["startMs"])
        word_duration = sum(
            max(0, word["endMs"] - word["startMs"]) for word in words
        )
        word_coverage = word_duration / segment_duration

        # Whisper can return a long segment with sparse or broken word timing.
        # Keeping only those words creates artificial silent gaps and false
        # subtitle offsets.
        if words and word_coverage >= 0.2:
            speech_intervals.extend(
                (
                    max(window.startMs, word["startMs"] - SPEECH_PADDING_MS),
                    min(window_end, word["endMs"] + SPEECH_PADDING_MS),
                )
                for word in words
                if word["endMs"] > window.startMs and word["startMs"] < window_end
            )
        else:
            speech_intervals.append((padded_start, padded_end))

    speech = merge_intervals(speech_intervals)
    cues_in_window = [
        (index, cue)
        for index, cue in enumerate(cues)
        if cue["endMs"] > window.startMs - MAX_OFFSET_MS
        and cue["startMs"] < window_end + MAX_OFFSET_MS
        and not is_non_dialogue_cue(cue)
    ]
    if not speech or not cues_in_window:
        return None

    # A sparse VAD result can collapse an entire dialogue burst into one long
    # segment. In that case, matching the nearest cue start is more stable
    # than optimizing overlap against one oversized interval.
    if len(speech_segments) == 1:
        speech_start = speech_segments[0]["startMs"]
        _, nearest_cue = min(
            cues_in_window,
            key=lambda item: abs(item[1]["startMs"] - speech_start),
        )
        offset_ms = speech_start - nearest_cue["startMs"]
        return {
            "offsetMs": offset_ms,
            "score": 0.5,
            "confidence": "medium",
            "matchedCueCount": 1,
            "matchedTokens": 0,
            "method": "speech",
        }

    total_speech_duration = sum(end - start for start, end in speech)
    candidates: list[dict[str, Any]] = []
    for delay_ms in range(-MAX_OFFSET_MS, MAX_OFFSET_MS + 1, ALIGNMENT_STEP_MS):
        matched: list[dict[str, Any]] = []
        cue_cursor = 0
        for speech_segment in speech_segments:
            best_match: dict[str, Any] | None = None
            max_cue_index = min(len(cues_in_window), cue_cursor + 8)
            speech_start = speech_segment["startMs"]
            speech_end = speech_segment["endMs"]
            segment_duration = max(1, speech_end - speech_start)

            for cue_position in range(cue_cursor, max_cue_index):
                cue_index, cue = cues_in_window[cue_position]
                start_ms = cue["startMs"] + delay_ms
                end_ms = cue["endMs"] + delay_ms
                if end_ms <= window.startMs or start_ms >= window_end:
                    continue

                cue_duration = max(1, end_ms - start_ms)
                overlap = overlap_ms(start_ms, end_ms, speech_start, speech_end)
                if overlap < max(200, round(segment_duration * 0.15)):
                    continue

                precision = overlap / cue_duration
                iou = interval_iou(start_ms, end_ms, speech_start, speech_end)
                boundary_fit = 1 - min(
                    abs(start_ms - speech_start),
                    abs(end_ms - speech_end),
                ) / max(cue_duration, segment_duration, 1)
                match_score = (
                    0.55 * iou
                    + 0.3 * precision
                    + 0.15 * max(0.0, boundary_fit)
                )
                candidate = {
                    "cueIndex": cue_index,
                    "cuePosition": cue_position,
                    "cueStartMs": cue["startMs"],
                    "speechStartMs": speech_start,
                    "startMs": start_ms,
                    "endMs": end_ms,
                    "overlapMs": overlap,
                    "score": match_score,
                }
                if best_match is None or candidate["score"] > best_match["score"]:
                    best_match = candidate

            if best_match is not None:
                matched.append(best_match)
                cue_cursor = best_match["cuePosition"] + 1

        if not matched:
            continue

        longest_run = 0
        current_run = 0
        previous_index: int | None = None
        for item in matched:
            if previous_index is not None and item["cueIndex"] == previous_index + 1:
                current_run += 1
            else:
                current_run = 1
            longest_run = max(longest_run, current_run)
            previous_index = item["cueIndex"]

        overlap = sum(item["overlapMs"] for item in matched)
        matched_score = sum(item["score"] for item in matched) / len(matched)
        coverage = overlap / max(total_speech_duration, 1)

        # Count how many dialogue cues fall within the window at this
        # offset.  An offset that places more subtitle cues in the
        # analysis window is a stronger signal than one where only a
        # handful of cues barely fit the window boundary (which is
        # more likely a coincidental false peak).  Use the ratio of
        # in-window cues to detected speech segments as a density
        # bonus – a value > 1 means more cues are available than
        # speech segments, indicating a dialogue-rich region.
        cues_visible = 0
        for _, cue in cues_in_window:
            shifted_start = cue["startMs"] + delay_ms
            shifted_end = cue["endMs"] + delay_ms
            if shifted_end > window.startMs and shifted_start < window_end:
                cues_visible += 1

        # A higher cues_visible relative to speech segments is a
        # positive signal: the offset places us in a dialogue-dense
        # region where the VTT has enough cues to plausibly explain
        # the observed speech.  Cap at 1.0 but allow lower values to
        # penalise offsets with suspiciously few in-window cues.
        cue_density = min(cues_visible / max(len(speech_segments), 1), 1.0)

        # When only a small fraction of the total dialogue cues fall
        # within the window AND the match rate is very high (nearly
        # all visible cues were matched), the alignment is likely a
        # coincidental false peak rather than the true offset.  For
        # example, if 4 out of 10 dialogue cues happen to fit the
        # window boundary and all 4 match perfectly, while the correct
        # offset would place 7+ cues in-window with a looser fit.
        total_dialogue_cues = len(cues_in_window)
        match_ratio = len(matched) / max(cues_visible, 1)
        visibility_ratio = cues_visible / max(total_dialogue_cues, 1)
        thinness_penalty = 1.0
        if match_ratio > 0.85 and visibility_ratio < 0.65:
            # Scale down: the fewer cues visible relative to total,
            # the stronger the penalty.
            thinness_penalty = 0.6 + 0.4 * visibility_ratio

        score = (
            0.7 * matched_score * thinness_penalty
            + 0.15 * min(coverage, 1.0)
            + 0.15 * cue_density
        )
        candidate = {
            "offsetMs": delay_ms,
            "score": score,
            "matchedCueCount": len(matched),
            "longestRun": longest_run,
            "firstCuePosition": matched[0]["cuePosition"],
            "overlapMs": overlap,
            "matches": matched,
            "cuesVisible": cues_visible,
        }
        candidates.append(candidate)

    has_word_timing = any(segment.get("words") for segment in transcript)
    # With multiple ASR segments, one overlapping cue is an ambiguous peak
    # and must not decide the global offset. A single-segment window keeps the
    # nearest-cue fallback above for sparse speech.
    minimum_matches = 2 if has_word_timing else 3
    candidates = [
        candidate
        for candidate in candidates
        if candidate["matchedCueCount"] >= minimum_matches
    ]

    # Do not prefer the earliest subtitle sequence. Different subtitle cuts
    # can contain an earlier, equally plausible dialogue run; choose the
    # sequence that best explains the observed speech timing instead.
    candidates.sort(
        key=lambda candidate: (
            candidate["score"],
            candidate["longestRun"],
            candidate["matchedCueCount"],
            candidate["cuesVisible"],
            candidate["overlapMs"],
            -abs(candidate["offsetMs"]),
        ),
        reverse=True,
    )
    best = candidates[0] if candidates else None

    if not best:
        return None

    return {
        "offsetMs": median_offset(
            [
                item["speechStartMs"] - item["cueStartMs"]
                for item in best.get("matches", [])
            ]
        )
        if best.get("matches")
        else best["offsetMs"],
        "score": round(best["score"], 4),
        "confidence": "medium",
        "matchedCueCount": best["matchedCueCount"],
        "matchedTokens": 0,
        "method": "speech",
        "matchedCueStartsMs": [
            item["cueStartMs"] for item in best.get("matches", [])
        ],
    }


def align_window(
    cues: list[dict[str, Any]],
    transcript: list[dict[str, Any]],
    window: WindowRequest,
) -> dict[str, Any] | None:
    return text_align(cues, transcript, window) or speech_align(
        cues, transcript, window
    )


def align_cues(
    cues: list[dict[str, Any]],
    transcripts: list[list[dict[str, Any]]],
    windows: list[WindowRequest],
) -> dict[str, Any]:
    results = []
    for window, transcript in zip(windows, transcripts):
        result = align_window(cues, transcript, window)
        if result:
            results.append(result)

    if not results:
        return {
            "offsetMs": 0,
            "windowOffsetsMs": [],
            "driftMs": None,
            "confidence": "rejected",
            "matchedCueCount": 0,
            "scores": [],
            "methods": [],
            "reason": "No matching subtitle cues found in the reference windows",
        }

    offsets = [result["offsetMs"] - ASR_ONSET_DELAY_MS for result in results]
    drift_ms = (
        abs(offsets[0] - offsets[1]) if len(offsets) >= 2 else None
    )

    offset_ms = median_offset(offsets)
    confidence = "high" if len(results) == 2 and all(
        result["confidence"] == "high" for result in results
    ) else "medium"
    response = {
        "offsetMs": offset_ms,
        "windowOffsetsMs": offsets,
        "driftMs": drift_ms,
        "confidence": confidence,
        "matchedCueCount": sum(
            result["matchedCueCount"] for result in results
        ),
        "scores": [result["score"] for result in results],
        "methods": [result["method"] for result in results],
    }
    if drift_ms is not None and drift_ms > 350:
        response["reason"] = "Reference windows had drift; applied median offset"
    return response


@app.on_event("startup")
def load_model() -> None:
    get_model()


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "model": MODEL_NAME,
        "device": "cpu",
        "computeType": "int8",
        "ready": model is not None,
    }


@app.post("/v1/transcribe-windows")
def transcribe_windows(
    payload: AlignRequest,
    internal_token: str | None = Header(default=None, alias="x-internal-token"),
) -> dict[str, Any]:
    if INTERNAL_TOKEN and internal_token != INTERNAL_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid internal token")

    try:
        cues = parse_vtt(payload.subtitleVtt)
        transcripts = [
            transcribe_window(payload.sourceUrl, window)
            for window in payload.windows
        ]
        result = align_cues(cues, transcripts, payload.windows)
        return {
            **result,
            "windows": [
                {
                    "startMs": window.startMs,
                    "durationMs": window.durationMs,
                }
                for window in payload.windows
            ],
            "model": MODEL_NAME,
        }
    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail=str(error)[-500:],
        ) from error
