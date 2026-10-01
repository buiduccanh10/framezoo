import { findBestOffsetFft } from "./fft";
import {
  TimingSegment,
  WindowSyncEntry,
  computePiecewiseSegments,
} from "./split";
import { detectSpeechIntervals } from "./vad";

export interface SubtitleCue {
  startMs: number;
  endMs: number;
  text: string;
}

export interface LocalAlignmentResult {
  aligned: boolean;
  offsetMs: number;
  confidence: number;
  speechIntervals: Array<{ startMs: number; endMs: number }>;
  segments?: TimingSegment[];
  framerateRatio?: number;
  reason: string | null;
}

const TIMING_LINE_RE =
  /^\s*((?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d{3})?)\s+-->\s+((?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d{3})?)(?:\s+.*)?$/;

export function parseTimestampToMs(timestamp: string): number {
  const parts = timestamp.trim().replace(",", ".").split(":");
  let seconds = 0;
  if (parts.length === 3) {
    seconds =
      parseFloat(parts[0]!) * 3600 +
      parseFloat(parts[1]!) * 60 +
      parseFloat(parts[2]!);
  } else if (parts.length === 2) {
    seconds = parseFloat(parts[0]!) * 60 + parseFloat(parts[1]!);
  } else {
    seconds = parseFloat(parts[0]!);
  }
  return Math.round(seconds * 1000);
}

export function parseVttCues(vttContent: string): SubtitleCue[] {
  const lines = vttContent
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");
  const cues: SubtitleCue[] = [];
  let currentStartMs: number | null = null;
  let currentEndMs: number | null = null;
  let textLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const match = TIMING_LINE_RE.exec(trimmed);
    if (match) {
      if (currentStartMs !== null && currentEndMs !== null) {
        cues.push({
          startMs: currentStartMs,
          endMs: currentEndMs,
          text: textLines.join(" ").trim(),
        });
      }
      currentStartMs = parseTimestampToMs(match[1]!);
      currentEndMs = parseTimestampToMs(match[2]!);
      textLines = [];
    } else if (currentStartMs !== null && trimmed.length > 0) {
      if (!trimmed.startsWith("NOTE") && !trimmed.startsWith("WEBVTT")) {
        textLines.push(trimmed);
      }
    } else if (
      trimmed.length === 0 &&
      currentStartMs !== null &&
      currentEndMs !== null
    ) {
      cues.push({
        startMs: currentStartMs,
        endMs: currentEndMs,
        text: textLines.join(" ").trim(),
      });
      currentStartMs = null;
      currentEndMs = null;
      textLines = [];
    }
  }

  if (currentStartMs !== null && currentEndMs !== null) {
    cues.push({
      startMs: currentStartMs,
      endMs: currentEndMs,
      text: textLines.join(" ").trim(),
    });
  }

  return cues;
}

export function decodeWav(data: Uint8Array): {
  samples: Float32Array;
  sampleRate: number;
  durationMs: number;
} {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.byteLength < 44 || view.getUint32(0, false) !== 0x52494646) {
    throw new Error("Invalid WAV header");
  }

  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);

  // Locate data chunk
  let dataOffset = 12;
  let dataLength = 0;
  while (dataOffset + 8 <= data.byteLength) {
    const chunkId = view.getUint32(dataOffset, false);
    const chunkSize = view.getUint32(dataOffset + 4, true);
    if (chunkId === 0x64617461) {
      // 'data'
      dataOffset += 8;
      dataLength = chunkSize;
      break;
    }
    dataOffset += 8 + chunkSize + (chunkSize & 1);
  }

  if (dataLength <= 0 || dataOffset + dataLength > data.byteLength) {
    dataOffset = 44;
    dataLength = data.byteLength - 44;
  }

  const bytesPerSample = bitsPerSample / 8;
  const totalSamples = Math.floor(dataLength / (channels * bytesPerSample));
  const samples = new Float32Array(totalSamples);

  if (bitsPerSample === 16) {
    for (let i = 0; i < totalSamples; i++) {
      let sum = 0;
      for (let ch = 0; ch < channels; ch++) {
        sum += view.getInt16(dataOffset + (i * channels + ch) * 2, true);
      }
      samples[i] = sum / channels / 32768.0;
    }
  } else if (bitsPerSample === 32) {
    for (let i = 0; i < totalSamples; i++) {
      let sum = 0;
      for (let ch = 0; ch < channels; ch++) {
        sum += view.getFloat32(dataOffset + (i * channels + ch) * 4, true);
      }
      samples[i] = sum / channels;
    }
  } else {
    throw new Error(`Unsupported WAV bits per sample: ${bitsPerSample}`);
  }

  // Amplitude normalization: if audio is very quiet (e.g. downmixed cinema track), boost to nominal range
  let maxAbs = 0;
  for (let i = 0; i < totalSamples; i++) {
    const val = Math.abs(samples[i]!);
    if (val > maxAbs) maxAbs = val;
  }
  if (maxAbs > 0.0001 && maxAbs < 0.25) {
    const scale = 0.5 / maxAbs;
    for (let i = 0; i < totalSamples; i++) {
      samples[i] = Math.max(-1, Math.min(1, samples[i]! * scale));
    }
  }

  const durationMs = Math.round((totalSamples * 1000) / sampleRate);
  return { samples, sampleRate, durationMs };
}

/**
 * Align subtitle cues with captured audio window 100% on-device.
 */
export async function alignSingleWindowLocal(options: {
  audioWav: Uint8Array;
  vttData: string;
  audioStartMs: number;
}): Promise<LocalAlignmentResult> {
  const { samples, sampleRate, durationMs } = decodeWav(options.audioWav);
  const audioEndMs = options.audioStartMs + durationMs;

  const speechIntervals = await detectSpeechIntervals(
    samples,
    sampleRate,
    options.audioStartMs,
  );

  console.info(
    `[local-sync] Window start: ${options.audioStartMs}ms, duration: ${durationMs}ms, sampleRate: ${sampleRate}Hz, speech intervals: ${speechIntervals.length}`,
  );

  if (speechIntervals.length === 0) {
    return {
      aligned: false,
      offsetMs: 0,
      confidence: 0,
      speechIntervals: [],
      reason: "no_speech_detected",
    };
  }

  const cues = parseVttCues(options.vttData);
  const cueIntervals: Array<[number, number]> = cues.map((c) => [
    c.startMs,
    c.endMs,
  ]);

  const { offsetMs, confidence, ratio } = findBestOffsetFft(
    speechIntervals,
    cueIntervals,
    options.audioStartMs,
    audioEndMs,
    180_000,
    true,
  );

  const isAligned = confidence >= 50;
  console.info(
    `[local-sync] Window result -> offset: ${offsetMs}ms, confidence: ${Math.round(confidence)}%, ratio: ${ratio}, aligned: ${isAligned}`,
  );

  return {
    aligned: isAligned,
    offsetMs,
    confidence: Math.round(confidence),
    speechIntervals: speechIntervals.map(([startMs, endMs]) => ({
      startMs,
      endMs,
    })),
    framerateRatio: ratio,
    reason: isAligned ? null : "low_alignment_confidence",
  };
}

/**
 * Align multiple windows on-device and run split detection piecewise alignment.
 */
export async function alignWindowsLocal(options: {
  windows: Array<{ audioWav: Uint8Array; startMs: number }>;
  vttData: string;
}): Promise<LocalAlignmentResult> {
  const results: WindowSyncEntry[] = [];
  let allSpeechIntervals: Array<{ startMs: number; endMs: number }> = [];

  for (const win of options.windows) {
    const res = await alignSingleWindowLocal({
      audioWav: win.audioWav,
      vttData: options.vttData,
      audioStartMs: win.startMs,
    });
    if (res.aligned) {
      results.push({
        startAt: win.startMs / 1000,
        result: {
          aligned: true,
          offsetMs: res.offsetMs,
          confidence: res.confidence,
        },
      });
    }
    allSpeechIntervals = allSpeechIntervals.concat(res.speechIntervals);
  }

  if (results.length === 0) {
    console.info(
      `[local-sync] None of the ${options.windows.length} windows reached confidence threshold. Total speech intervals: ${allSpeechIntervals.length}`,
    );
    return {
      aligned: false,
      offsetMs: 0,
      confidence: 0,
      speechIntervals: allSpeechIntervals,
      reason: "no_speech_detected",
    };
  }

  const bestWindow = [...results].sort(
    (a, b) => b.result.confidence - a.result.confidence,
  )[0]!;

  const piecewiseSegments = computePiecewiseSegments(
    results,
    bestWindow.result.offsetMs,
  );

  console.info(
    `[local-sync] Consensus alignment complete -> offset: ${bestWindow.result.offsetMs}ms, confidence: ${bestWindow.result.confidence}%, segments: ${piecewiseSegments.length}`,
  );

  return {
    aligned: true,
    offsetMs: bestWindow.result.offsetMs,
    confidence: bestWindow.result.confidence,
    speechIntervals: allSpeechIntervals,
    segments: piecewiseSegments.length > 0 ? piecewiseSegments : undefined,
    reason: null,
  };
}
