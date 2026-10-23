/**
 * Fast Fourier Transform (Cooley-Tukey Radix-2) and Cross-Correlation in pure TypeScript.
 * Zero external dependencies, ultra-fast (< 5ms for 100,000 samples).
 */

export const FRAME_MS = 25; // 25ms per bin (40 frames per second)
export const MAX_SEARCH_OFFSET_MS = 180_000; // ±3 minutes search range
export const ONSET_BOOST_FRAMES = 8; // First 200ms of an utterance/cue receives onset emphasis
export const ONSET_BOOST_WEIGHT = 1.45;

export const FRAMERATE_RATIOS = [
  1.0,
  23.976 / 24.0,
  24.0 / 23.976,
  23.976 / 25.0,
  25.0 / 23.976,
  24.0 / 25.0,
  25.0 / 24.0,
  29.97 / 25.0,
  25.0 / 29.97,
];

/**
 * In-place complex Radix-2 Cooley-Tukey FFT.
 * real and imag must have length equal to a power of 2.
 */
export function complexFft(
  real: Float32Array,
  imag: Float32Array,
  inverse = false,
): void {
  const n = real.length;
  if (n <= 1) return;

  // Bit reversal permutation
  let j = 0;
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      const tr = real[i]!;
      real[i] = real[j]!;
      real[j] = tr;
      const ti = imag[i]!;
      imag[i] = imag[j]!;
      imag[j] = ti;
    }
    let k = n >> 1;
    while (k <= j) {
      j -= k;
      k >>= 1;
    }
    j += k;
  }

  // Butterfly computations
  const sign = inverse ? 1.0 : -1.0;
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = (sign * 2 * Math.PI) / len;
    const wstepReal = Math.cos(angle);
    const wstepImag = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let wReal = 1.0;
      let wImag = 0.0;
      for (let k = 0; k < half; k++) {
        const uReal = real[i + k]!;
        const uImag = imag[i + k]!;
        const vReal = real[i + k + half]! * wReal - imag[i + k + half]! * wImag;
        const vImag = real[i + k + half]! * wImag + imag[i + k + half]! * wReal;

        real[i + k] = uReal + vReal;
        imag[i + k] = uImag + vImag;
        real[i + k + half] = uReal - vReal;
        imag[i + k + half] = uImag - vImag;

        const nextWReal = wReal * wstepReal - wImag * wstepImag;
        wImag = wReal * wstepImag + wImag * wstepReal;
        wReal = nextWReal;
      }
    }
  }

  if (inverse) {
    for (let i = 0; i < n; i++) {
      real[i]! /= n;
      imag[i]! /= n;
    }
  }
}

/**
 * Next power of 2 greater than or equal to x.
 */
function nextPow2(x: number): number {
  let p = 1;
  while (p < x) p <<= 1;
  return p;
}

/**
 * Convert speech or subtitle intervals [(start_ms, end_ms), ...] to float profile
 * with optional onset boundary boost.
 */
export function intervalsToSignal(
  intervals: Array<[number, number]>,
  originMs: number,
  durationMs: number,
  frameMs: number = FRAME_MS,
  onsetWeight = 1.0,
): Float32Array {
  const nFrames = Math.max(1, Math.ceil(durationMs / frameMs));
  const signal = new Float32Array(nFrames);
  for (const [startMs, endMs] of intervals) {
    const clippedStart = Math.max(originMs, startMs);
    const clippedEnd = Math.min(originMs + durationMs, endMs);
    if (clippedEnd <= clippedStart) continue;

    const startFrame = Math.max(
      0,
      Math.floor((clippedStart - originMs) / frameMs),
    );
    const endFrame = Math.min(
      nFrames,
      Math.ceil((clippedEnd - originMs) / frameMs),
    );
    for (let f = startFrame; f < endFrame; f++) {
      if (signal[f]! < 1.0) signal[f] = 1.0;
    }
    if (onsetWeight > 1.0 && startMs >= originMs) {
      const onsetEnd = Math.min(endFrame, startFrame + ONSET_BOOST_FRAMES);
      for (let f = startFrame; f < onsetEnd; f++) {
        if (signal[f]! < onsetWeight) signal[f] = onsetWeight;
      }
    }
  }
  return signal;
}

/**
 * Fast cross-correlation using FFT: corr = ifft(fft(ref) * conj(fft(query))).
 * Returns the correlation array of length len(ref) + len(query) - 1.
 */
export function fftConvolveCorrelation(
  ref: Float32Array,
  query: Float32Array,
): Float32Array {
  const outLen = ref.length + query.length - 1;
  const fftLen = nextPow2(outLen);

  const realRef = new Float32Array(fftLen);
  const imagRef = new Float32Array(fftLen);
  realRef.set(ref);
  complexFft(realRef, imagRef, false);

  // Reversing query corresponds to correlation
  const realQuery = new Float32Array(fftLen);
  const imagQuery = new Float32Array(fftLen);
  for (let i = 0; i < query.length; i++) {
    realQuery[i] = query[query.length - 1 - i]!;
  }
  complexFft(realQuery, imagQuery, false);

  // Multiply in frequency domain: (ar + j*ai) * (br + j*bi)
  const realProd = new Float32Array(fftLen);
  const imagProd = new Float32Array(fftLen);
  for (let i = 0; i < fftLen; i++) {
    realProd[i] = realRef[i]! * realQuery[i]! - imagRef[i]! * imagQuery[i]!;
    imagProd[i] = realRef[i]! * imagQuery[i]! + imagRef[i]! * realQuery[i]!;
  }

  complexFft(realProd, imagProd, true);
  return realProd.subarray(0, outLen);
}

export interface FftOffsetCandidate {
  offsetMs: number;
  confidence: number;
  ratio: number;
}

/**
 * Return up to topK distinct candidate peaks using local-window energy normalized
 * FFT cross-correlation with onset emphasis.
 * Offset convention: speech_time = subtitle_time + offsetMs.
 */
export function findTopOffsetsFft(
  speechIntervals: Array<[number, number]>,
  subtitleIntervals: Array<[number, number]>,
  audioStartMs: number,
  audioEndMs: number,
  maxOffsetMs: number = MAX_SEARCH_OFFSET_MS,
  tryFramerateRatios = false,
  searchCenters: number[] | null = null,
  topK = 5,
  minSeparationMs = 1500,
): FftOffsetCandidate[] {
  if (speechIntervals.length === 0 || subtitleIntervals.length === 0) {
    return [];
  }

  const durationMs = audioEndMs - audioStartMs;
  if (durationMs <= 0) {
    return [];
  }

  const refSignal = intervalsToSignal(
    speechIntervals,
    audioStartMs,
    durationMs,
    FRAME_MS,
    ONSET_BOOST_WEIGHT,
  );
  const nRef = refSignal.length;
  let refEnergy = 0;
  for (let i = 0; i < nRef; i++) {
    refEnergy += refSignal[i]! * refSignal[i]!;
  }
  if (refEnergy <= 0) {
    return [];
  }

  const ratios = tryFramerateRatios ? FRAMERATE_RATIOS : [1.0];
  const queryOriginMs = audioStartMs - maxOffsetMs;
  const queryDurationMs = durationMs + 2 * maxOffsetMs;
  const maxOffsetFrames = Math.floor(maxOffsetMs / FRAME_MS);

  const rawCandidates: Array<{
    offsetMs: number;
    score: number;
    ratio: number;
  }> = [];

  for (const ratio of ratios) {
    const scaledSubs: Array<[number, number]> =
      ratio === 1.0
        ? subtitleIntervals
        : subtitleIntervals.map(([s, e]) => [
            Math.round(audioStartMs + (s - audioStartMs) * ratio),
            Math.round(audioStartMs + (e - audioStartMs) * ratio),
          ]);

    const querySignal = intervalsToSignal(
      scaledSubs,
      queryOriginMs,
      queryDurationMs,
      FRAME_MS,
      ONSET_BOOST_WEIGHT,
    );
    const nQuery = querySignal.length;
    const querySqCumsum = new Float64Array(nQuery + 1);
    for (let i = 0; i < nQuery; i++) {
      const v = querySignal[i]!;
      querySqCumsum[i + 1] = querySqCumsum[i]! + v * v;
    }
    if (querySqCumsum[nQuery]! <= 0) continue;

    const corr = fftConvolveCorrelation(refSignal, querySignal);
    const zeroK = nQuery - 1;

    const lowK = Math.max(0, zeroK - 2 * maxOffsetFrames);
    const highK = Math.min(corr.length, zeroK + 1);
    if (lowK >= highK) continue;

    const ratioPenalty = ratio === 1.0 ? 1.0 : 0.985;
    const minQueryEnergy = refEnergy * 0.2;

    if (ratio === 1.0) {
      const binScores: Array<{ k: number; score: number }> = [];
      for (let k = lowK; k < highK; k++) {
        const val = corr[k]!;
        if (val <= 0) continue;
        const qStart = Math.max(0, Math.min(nQuery, zeroK - k));
        const qEnd = Math.max(0, Math.min(nQuery, qStart + nRef));
        const localQEnergy = querySqCumsum[qEnd]! - querySqCumsum[qStart]!;
        if (localQEnergy <= 0) continue;
        const denom = Math.sqrt(
          refEnergy * Math.max(localQEnergy, minQueryEnergy),
        );
        if (denom <= 0) continue;
        const normScore = Math.min(
          1.0,
          Math.max(0.0, (val / denom) * ratioPenalty),
        );
        if (normScore > 0) {
          binScores.push({ k, score: normScore });
        }
      }
      binScores.sort((a, b) => b.score - a.score);
      let picked = 0;
      for (const item of binScores) {
        const lag = item.k - zeroK;
        const offsetMs = lag * FRAME_MS + maxOffsetMs;
        if (
          rawCandidates.some(
            (c) =>
              c.ratio === 1.0 &&
              Math.abs(c.offsetMs - offsetMs) < minSeparationMs,
          )
        ) {
          continue;
        }
        let adjustedScore = item.score;
        if (searchCenters && searchCenters.length > 0) {
          let closestDist = Infinity;
          for (const c of searchCenters) {
            const d = Math.abs(offsetMs - c);
            if (d < closestDist) closestDist = d;
          }
          if (closestDist < 1000) adjustedScore *= 1.05;
        }
        rawCandidates.push({ offsetMs, score: adjustedScore, ratio });
        picked += 1;
        if (picked >= topK) break;
      }
    } else {
      let bestK = -1;
      let bestRatioScore = 0;
      for (let k = lowK; k < highK; k++) {
        const val = corr[k]!;
        if (val <= 0) continue;
        const qStart = Math.max(0, Math.min(nQuery, zeroK - k));
        const qEnd = Math.max(0, Math.min(nQuery, qStart + nRef));
        const localQEnergy = querySqCumsum[qEnd]! - querySqCumsum[qStart]!;
        if (localQEnergy <= 0) continue;
        const denom = Math.sqrt(
          refEnergy * Math.max(localQEnergy, minQueryEnergy),
        );
        if (denom <= 0) continue;
        const normScore = Math.min(
          1.0,
          Math.max(0.0, (val / denom) * ratioPenalty),
        );
        if (normScore > bestRatioScore) {
          bestRatioScore = normScore;
          bestK = k;
        }
      }
      if (bestK >= 0 && bestRatioScore > 0) {
        const lag = bestK - zeroK;
        const offsetMs = lag * FRAME_MS + maxOffsetMs;
        let adjustedScore = bestRatioScore;
        if (searchCenters && searchCenters.length > 0) {
          let closestDist = Infinity;
          for (const c of searchCenters) {
            const d = Math.abs(offsetMs - c);
            if (d < closestDist) closestDist = d;
          }
          if (closestDist < 1000) adjustedScore *= 1.05;
        }
        rawCandidates.push({ offsetMs, score: adjustedScore, ratio });
      }
    }
  }

  rawCandidates.sort((a, b) => b.score - a.score);
  const deduped: FftOffsetCandidate[] = [];
  for (const cand of rawCandidates) {
    if (
      deduped.some(
        (ex) => Math.abs(ex.offsetMs - cand.offsetMs) < minSeparationMs,
      )
    ) {
      continue;
    }
    const confidence = Math.round(Math.min(1.0, cand.score) * 1000) / 10;
    deduped.push({
      offsetMs: cand.offsetMs,
      confidence,
      ratio: cand.ratio,
    });
    if (deduped.length >= topK) break;
  }

  return deduped;
}

/**
 * Find best (offsetMs, confidence, ratio) using FFT cross-correlation.
 * Offset convention: speech_time = subtitle_time + offsetMs.
 */
export function findBestOffsetFft(
  speechIntervals: Array<[number, number]>,
  subtitleIntervals: Array<[number, number]>,
  audioStartMs: number,
  audioEndMs: number,
  maxOffsetMs: number = MAX_SEARCH_OFFSET_MS,
  tryFramerateRatios = true,
  searchCenters: number[] | null = null,
): { offsetMs: number; confidence: number; ratio: number } {
  const peaks = findTopOffsetsFft(
    speechIntervals,
    subtitleIntervals,
    audioStartMs,
    audioEndMs,
    maxOffsetMs,
    tryFramerateRatios,
    searchCenters,
    1,
  );
  if (peaks.length === 0) {
    return { offsetMs: 0, confidence: 0, ratio: 1.0 };
  }
  return peaks[0]!;
}
