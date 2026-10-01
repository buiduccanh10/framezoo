/**
 * Silero VAD (v5) inference runner in browser / WebWorker using onnxruntime-web.
 * Model size: ~1.2MB.
 * Runs in < 50ms for 60s audio.
 */

import * as ort from "onnxruntime-web";

export const SILERO_SAMPLE_RATE = 16_000;
export const FRAME_SAMPLES = 512; // 32ms at 16kHz
export const CONTEXT_SIZE = 64; // Silero VAD v5 requires 64 context samples (input length = 576)
export const VAD_THRESHOLD = 0.45;
export const MIN_SPEECH_INTERVAL_MS = 100;
export const MERGE_SPEECH_GAP_MS = 300;

let sessionPromise: Promise<ort.InferenceSession> | null = null;

export async function getSileroVadSession(): Promise<ort.InferenceSession> {
  if (sessionPromise) return sessionPromise;

  sessionPromise = (async () => {
    // Configure ONNX Runtime Web WASM options
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.simd = true;

    const modelUrl = new URL("/models/silero_vad.onnx", window.location.href)
      .href;
    const session = await ort.InferenceSession.create(modelUrl, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
    return session;
  })();

  return sessionPromise;
}

/**
 * Resample Float32Array from origSampleRate to 16,000 Hz using linear interpolation.
 */
export function resampleTo16k(
  samples: Float32Array,
  origSampleRate: number,
): Float32Array {
  if (origSampleRate === SILERO_SAMPLE_RATE) {
    return samples;
  }
  const ratio = SILERO_SAMPLE_RATE / origSampleRate;
  const newLength = Math.round(samples.length * ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const origPos = i / ratio;
    const idx = Math.floor(origPos);
    const frac = origPos - idx;
    const s0 = samples[idx] ?? 0;
    const s1 = samples[idx + 1] ?? s0;
    result[i] = s0 * (1 - frac) + s1 * frac;
  }
  return result;
}

/**
 * Merge adjacent speech intervals.
 */
export function mergeSpeechIntervals(
  intervals: Array<[number, number]>,
  minDurationMs = MIN_SPEECH_INTERVAL_MS,
  mergeGapMs = MERGE_SPEECH_GAP_MS,
): Array<[number, number]> {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];

  for (const [startMs, endMs] of sorted) {
    if (endMs - startMs < minDurationMs) continue;
    if (
      merged.length > 0 &&
      startMs <= merged[merged.length - 1]![1] + mergeGapMs
    ) {
      merged[merged.length - 1]![1] = Math.max(
        merged[merged.length - 1]![1],
        endMs,
      );
    } else {
      merged.push([startMs, endMs]);
    }
  }
  return merged;
}

/**
 * Detect speech intervals from 16kHz Float32Array audio using Silero VAD v5.
 */
export async function detectSpeechIntervals(
  audio: Float32Array,
  origSampleRate: number,
  audioStartMs = 0,
  threshold = VAD_THRESHOLD,
): Promise<Array<[number, number]>> {
  const session = await getSileroVadSession();
  const samples = resampleTo16k(audio, origSampleRate);
  const numSamples = samples.length;
  if (numSamples < FRAME_SAMPLES) return [];

  const rawIntervals: Array<[number, number]> = [];
  let currentSpeechStart: number | null = null;

  // Hidden state tensor: [2, 1, 128]
  let stateTensor: ort.Tensor = new ort.Tensor(
    "float32",
    new Float32Array(2 * 1 * 128),
    [2, 1, 128],
  );
  const srTensor = new ort.Tensor(
    "int64",
    BigInt64Array.from([BigInt(SILERO_SAMPLE_RATE)]),
    [],
  );

  // Silero VAD v5 requires 64 context samples prepended to each 512-sample frame
  const contextData = new Float32Array(CONTEXT_SIZE);

  for (let offset = 0; offset < numSamples; offset += FRAME_SAMPLES) {
    const inputData = new Float32Array(CONTEXT_SIZE + FRAME_SAMPLES);
    inputData.set(contextData, 0);

    const slice = samples.subarray(
      offset,
      Math.min(numSamples, offset + FRAME_SAMPLES),
    );
    inputData.set(slice, CONTEXT_SIZE);

    const inputTensor = new ort.Tensor("float32", inputData, [
      1,
      CONTEXT_SIZE + FRAME_SAMPLES,
    ]);
    const feeds: Record<string, ort.Tensor> = {
      input: inputTensor,
      state: stateTensor,
      sr: srTensor,
    };

    const results = await session.run(feeds);
    const probTensor = results.output ?? results[session.outputNames[0]!];
    const prob = (probTensor?.data as Float32Array)[0] ?? 0;

    const nextStateTensor = results.stateN ?? results[session.outputNames[1]!];
    if (nextStateTensor) {
      stateTensor = nextStateTensor;
    }

    // Update rolling context with the last 64 samples of current input
    contextData.set(inputData.subarray(inputData.length - CONTEXT_SIZE));

    const frameStartMs =
      audioStartMs + Math.round((offset / SILERO_SAMPLE_RATE) * 1000);

    if (prob >= threshold) {
      if (currentSpeechStart === null) {
        currentSpeechStart = frameStartMs;
      }
    } else {
      if (currentSpeechStart !== null) {
        rawIntervals.push([currentSpeechStart, frameStartMs]);
        currentSpeechStart = null;
      }
    }
  }

  if (currentSpeechStart !== null) {
    const totalDurationMs =
      audioStartMs + Math.round((numSamples / SILERO_SAMPLE_RATE) * 1000);
    rawIntervals.push([currentSpeechStart, totalDurationMs]);
  }

  return mergeSpeechIntervals(rawIntervals);
}
