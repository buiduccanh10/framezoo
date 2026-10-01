from __future__ import annotations

import os
import threading
import urllib.request
import numpy as np
import onnxruntime as ort
from scipy.signal import resample_poly

SILERO_VAD_FILENAME = "silero_vad.onnx"
SILERO_VAD_URL = (
    "https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx"
)
SILERO_SAMPLE_RATE = 16_000
FRAME_SAMPLES = 512  # 32ms at 16kHz
CONTEXT_SIZE = 64  # Silero VAD v5 requires 64 context samples (input length = 576)
VAD_THRESHOLD = 0.45
MIN_SPEECH_INTERVAL_MS = 100
MERGE_SPEECH_GAP_MS = 300

_SESSION: ort.InferenceSession | None = None
_LOCK = threading.Lock()


def get_model_path() -> str:
    current_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(current_dir, SILERO_VAD_FILENAME)


def get_vad_session() -> ort.InferenceSession:
    global _SESSION
    if _SESSION is not None:
        return _SESSION

    with _LOCK:
        if _SESSION is None:
            model_path = get_model_path()
            if not os.path.exists(model_path) or os.path.getsize(model_path) < 100_000:
                urllib.request.urlretrieve(SILERO_VAD_URL, model_path)
            opts = ort.SessionOptions()
            opts.inter_op_num_threads = 1
            opts.intra_op_num_threads = 2
            opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            _SESSION = ort.InferenceSession(
                model_path,
                sess_options=opts,
                providers=["CPUExecutionProvider"],
            )
    return _SESSION


def resample_audio(audio: list[float] | np.ndarray, orig_sr: int, target_sr: int = SILERO_SAMPLE_RATE) -> np.ndarray:
    if orig_sr == target_sr:
        return np.asarray(audio, dtype=np.float32)
    # Using scipy resample_poly for fast and high-quality rational resampling
    import math
    gcd = math.gcd(orig_sr, target_sr)
    up = target_sr // gcd
    down = orig_sr // gcd
    resampled = resample_poly(np.asarray(audio, dtype=np.float32), up, down)
    return resampled.astype(np.float32)


def merge_speech_intervals(
    intervals: list[tuple[int, int]],
    min_duration_ms: int = MIN_SPEECH_INTERVAL_MS,
    merge_gap_ms: int = MERGE_SPEECH_GAP_MS,
) -> list[tuple[int, int]]:
    merged: list[list[int]] = []
    for start_ms, end_ms in sorted(intervals):
        if end_ms - start_ms < min_duration_ms:
            continue
        if merged and start_ms <= merged[-1][1] + merge_gap_ms:
            merged[-1][1] = max(merged[-1][1], end_ms)
        else:
            merged.append([start_ms, end_ms])
    return [(start, end) for start, end in merged]


def detect_speech_intervals(
    audio: list[float] | np.ndarray,
    sample_rate: int,
    audio_start_ms: int = 0,
    threshold: float = VAD_THRESHOLD,
) -> list[tuple[int, int]]:
    """
    Run Silero VAD over the input audio.
    Returns merged [(start_ms, end_ms), ...] in absolute timestamps.
    """
    session = get_vad_session()
    samples = resample_audio(audio, sample_rate, SILERO_SAMPLE_RATE)
    num_samples = len(samples)
    if num_samples < FRAME_SAMPLES:
        return []

    state = np.zeros((2, 1, 128), dtype=np.float32)
    context = np.zeros((1, CONTEXT_SIZE), dtype=np.float32)
    sr_tensor = np.array(SILERO_SAMPLE_RATE, dtype=np.int64)

    raw_intervals: list[tuple[int, int]] = []
    current_speech_start: int | None = None

    frame_duration_ms = int(round((FRAME_SAMPLES / SILERO_SAMPLE_RATE) * 1000))

    for offset in range(0, num_samples, FRAME_SAMPLES):
        frame = samples[offset : offset + FRAME_SAMPLES]
        if len(frame) < FRAME_SAMPLES:
            frame = np.pad(frame, (0, FRAME_SAMPLES - len(frame)))

        chunk = frame.reshape(1, FRAME_SAMPLES).astype(np.float32)
        x = np.concatenate([context, chunk], axis=1)
        out, state = session.run(None, {"input": x, "state": state, "sr": sr_tensor})
        prob = float(out[0][0])
        context = x[:, -CONTEXT_SIZE:]

        frame_start_ms = audio_start_ms + int(round((offset / SILERO_SAMPLE_RATE) * 1000))
        frame_end_ms = frame_start_ms + frame_duration_ms

        if prob >= threshold:
            if current_speech_start is None:
                current_speech_start = frame_start_ms
        else:
            if current_speech_start is not None:
                raw_intervals.append((current_speech_start, frame_start_ms))
                current_speech_start = None

    if current_speech_start is not None:
        total_duration_ms = audio_start_ms + int(round((num_samples / SILERO_SAMPLE_RATE) * 1000))
        raw_intervals.append((current_speech_start, total_duration_ms))

    return merge_speech_intervals(raw_intervals)
