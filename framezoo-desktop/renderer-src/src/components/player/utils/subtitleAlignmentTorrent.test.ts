import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const torrentMocks = vi.hoisted(() => ({
  extractAudioWindow: vi.fn(),
  mwFetch: vi.fn(),
  ensureMoonshineModel: vi.fn(),
  transcribeMoonshine: vi.fn(),
  disableMoonshineForSession: vi.fn(),
}));

vi.mock("./audioCapture", () => ({
  extractAudioWindow: torrentMocks.extractAudioWindow,
}));
vi.mock("@/backend/helpers/fetch", () => ({
  mwFetch: torrentMocks.mwFetch,
}));
vi.mock("@/setup/config", () => ({
  conf: () => ({ BACKEND_URL: "http://backend.test" }),
}));

// Use the REAL decodeMoonshineWav implementation to verify parsing of multi-MB audio
import {
  MoonshineLanguageUnavailableError,
  decodeMoonshineWav,
} from "@/moonshine/runtime";

vi.mock("@/moonshine/runtime", async () => {
  const actual = await vi.importActual<typeof import("@/moonshine/runtime")>(
    "@/moonshine/runtime",
  );
  return {
    ...actual,
    ensureMoonshineModel: torrentMocks.ensureMoonshineModel,
    transcribeMoonshine: torrentMocks.transcribeMoonshine,
    disableMoonshineForSession: torrentMocks.disableMoonshineForSession,
  };
});

import {
  type SubtitleAlignmentResponse,
  alignSubtitlesWithCurrentStream,
  applySubtitleAlignment,
} from "./subtitleAlignment";

/**
 * Creates a real, fully standard 16-bit mono PCM RIFF/WAVE buffer.
 * At 16,000 Hz, each second is 32,000 bytes of audio samples.
 * A 60-second window yields: 44 bytes header + 1,920,000 bytes data = 1,920,044 bytes (~1.83 MiB / 1.92 MB).
 */
function createRealWavBuffer(
  durationSeconds: number,
  frequency = 440,
  sampleRate = 16_000,
): Uint8Array {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const totalSamples = durationSeconds * sampleRate;
  const dataSize = totalSamples * numChannels * bytesPerSample;
  const headerSize = 44;
  const buffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // RIFF header
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  view.setUint32(4, 36 + dataSize, true);
  bytes.set([0x57, 0x41, 0x56, 0x45], 8); // "WAVE"

  // fmt chunk (PCM)
  bytes.set([0x66, 0x6d, 0x74, 0x20], 12); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // audioFormat: 1 (PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  bytes.set([0x64, 0x61, 0x74, 0x61], 36); // "data"
  view.setUint32(40, dataSize, true);

  // Synthesize audio samples with audio tone
  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.round(
      Math.sin(2 * Math.PI * frequency * t) *
        12_000 *
        (t > 5 && t < 25 ? 1 : 0.05),
    );
    view.setInt16(headerSize + i * 2, sample, true);
  }

  return bytes;
}

describe("torrent subtitle alignment integration with real multi-MB audio data", () => {
  let torrentServer: Server;
  let torrentServerUrl: string;
  const receivedTorrentRequests: Array<{
    url: string;
    range: string | null;
    client: string | null;
    syncWindowIndex: string | null;
  }> = [];

  beforeAll(async () => {
    // Spin up a real HTTP server simulating the local torrent engine HTTP endpoint
    torrentServer = createServer((req, res) => {
      const parsedUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      receivedTorrentRequests.push({
        url: req.url ?? "",
        range: req.headers.range ?? null,
        client: parsedUrl.searchParams.get("client"),
        syncWindowIndex: parsedUrl.searchParams.get("syncWindowIndex"),
      });

      // Respond with 206 Partial Content simulating torrent range response
      res.writeHead(206, {
        "Content-Type": "video/mp4",
        "Accept-Ranges": "bytes",
        "Content-Range": "bytes 0-1023/104857600",
        "Content-Length": "1024",
      });
      res.end(Buffer.alloc(1024, 0x42));
    });

    await new Promise<void>((resolve) => {
      torrentServer.listen(0, "127.0.0.1", () => resolve());
    });
    const port = (torrentServer.address() as AddressInfo).port;
    torrentServerUrl = `http://127.0.0.1:${port}/torrent/session-xyz/movie.mkv`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      torrentServer.close((err) => (err ? reject(err) : resolve()));
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    receivedTorrentRequests.length = 0;
  });

  it("extracts multi-MB audio windows from a torrent source and aligns with local Moonshine decoding", async () => {
    const WINDOW_DURATION_SECONDS = 60;
    // Generate real ~1.92 MB WAV buffer (1,920,044 bytes each)
    const multiMbWavBuffer = createRealWavBuffer(WINDOW_DURATION_SECONDS, 440);
    expect(multiMbWavBuffer.byteLength).toBeGreaterThan(1_900_000); // ~1.92 MB

    // Verify real decodeMoonshineWav decodes this buffer accurately
    const decodedVerification = decodeMoonshineWav(multiMbWavBuffer);
    expect(decodedVerification.durationMs).toBe(60_000);
    expect(decodedVerification.sampleRate).toBe(16_000);
    expect(decodedVerification.samples.length).toBe(960_000);

    const extractionCalls: Array<{ windowIndex?: number; url: string }> = [];
    torrentMocks.extractAudioWindow.mockImplementation(async (request) => {
      extractionCalls.push({
        windowIndex: request.windowIndex,
        url: request.url,
      });

      // Make a real HTTP request to the torrent server simulating mpv audio fetch
      const torrentQueryUrl = `${request.url}?client=sync&syncWindowIndex=${request.windowIndex}&syncStartAt=${request.startAt}&syncDuration=${request.duration}`;
      await fetch(torrentQueryUrl, { headers: { Range: "bytes=0-1023" } });

      // Return real 1.92 MB WAV buffer
      return createRealWavBuffer(
        WINDOW_DURATION_SECONDS,
        440 + (request.windowIndex ?? 0) * 50,
      );
    });

    torrentMocks.ensureMoonshineModel.mockResolvedValue({
      language: "en",
      architecture: "tiny",
      files: [],
    });

    // Real decodeMoonshineWav is used inside alignSubtitlesWithCurrentStream.
    // We mock transcribeMoonshine to return speech intervals extracted from the decoded audio.
    torrentMocks.transcribeMoonshine.mockImplementation(
      async (_entry, audio) => {
        // Decode with real decoder to ensure every window's multi-MB audio is valid
        const decoded = decodeMoonshineWav(audio);
        expect(decoded.durationMs).toBe(60_000);
        expect(decoded.samples.length).toBe(960_000);
        return [
          { startMs: 10_000, endMs: 25_000 },
          { startMs: 30_000, endMs: 45_000 },
        ];
      },
    );

    const mockServerResult: SubtitleAlignmentResponse = {
      aligned: true,
      offsetMs: -1500,
      confidence: 94,
      speechIntervals: [{ startMs: 10_000, endMs: 25_000 }],
      reason: null,
    };
    torrentMocks.mwFetch.mockResolvedValue({
      results: { primary: mockServerResult },
    });

    const progressEvents: Array<{
      progress: number;
      phase?: "capturing" | "analyzing";
    }> = [];

    const rawVtt = `WEBVTT

00:10:05.000 --> 00:10:08.000
Torrent dialog line here`;

    const result = await alignSubtitlesWithCurrentStream({
      sourceUrl: torrentServerUrl,
      isTorrent: true,
      startAt: 600,
      language: "en",
      subtitles: [{ track: "primary", vttData: rawVtt }],
      videoDuration: 3600,
      buffered: 3600,
      onProgress: (progress, phase) => {
        progressEvents.push({ progress, phase });
      },
    });

    // 1. Verify torrent-specific extraction ordering: window 0 requested first
    expect(extractionCalls).toHaveLength(6);
    expect(extractionCalls[0].windowIndex).toBe(0);

    // 2. Verify all 6 windows extracted audio from torrent server with sync client params
    expect(receivedTorrentRequests).toHaveLength(6);
    for (const req of receivedTorrentRequests) {
      expect(req.client).toBe("sync");
      expect(req.syncWindowIndex).not.toBeNull();
    }

    // 3. Verify total extracted audio data is > 11 MB across the 6 windows
    const totalExtractedBytes =
      extractionCalls.length * multiMbWavBuffer.byteLength;
    expect(totalExtractedBytes).toBeGreaterThan(11_000_000); // 11.52 MB

    // 4. Verify speech intervals were sent to backend without uploading raw audio
    expect(torrentMocks.mwFetch).toHaveBeenCalledTimes(1);
    const backendRequest = torrentMocks.mwFetch.mock.calls[0][1];
    const formData = backendRequest.body as FormData;
    const bodyEntries = [...formData.entries()];
    expect(bodyEntries.filter(([name]) => name === "audio")).toHaveLength(0);

    const speechIntervals = JSON.parse(
      formData.get("speechIntervals") as string,
    );
    expect(speechIntervals).toHaveLength(6);
    for (const intervals of speechIntervals) {
      expect(intervals).toHaveLength(2);
      expect(intervals[0].startMs).toBeLessThan(intervals[0].endMs);
    }

    const windowStarts = JSON.parse(formData.get("windowStartsMs") as string);
    expect(windowStarts).toHaveLength(6);
    expect(windowStarts).toEqual([...windowStarts].sort((a, b) => a - b));

    // 5. Verify progress sequence: strictly monotonic, no jumping backwards
    for (let i = 1; i < progressEvents.length; i++) {
      expect(progressEvents[i].progress).toBeGreaterThanOrEqual(
        progressEvents[i - 1].progress,
      );
    }

    // All capturing phase events must finish before any analyzing event
    const firstAnalyzing = progressEvents.findIndex(
      (e) => e.phase === "analyzing",
    );
    expect(firstAnalyzing).toBeGreaterThan(0);

    const capturingEvents = progressEvents.slice(0, firstAnalyzing);
    const analyzingEvents = progressEvents.slice(firstAnalyzing);

    for (const e of capturingEvents) {
      expect(e.phase).toBe("capturing");
      expect(e.progress).toBeLessThanOrEqual(0.4);
    }
    // Capturing phase reaches exactly 0.4 (100% of preparation)
    expect(capturingEvents[capturingEvents.length - 1].progress).toBeCloseTo(
      0.4,
      5,
    );

    for (const e of analyzingEvents) {
      expect(e.phase).toBe("analyzing");
      expect(e.progress).toBeGreaterThan(0.4);
    }
    expect(progressEvents[progressEvents.length - 1]).toEqual({
      progress: 1,
      phase: "analyzing",
    });

    // 6. Verify end-to-end subtitle alignment application
    const primaryResult = result.results.primary;
    expect(primaryResult).toBeDefined();
    expect(primaryResult?.offsetMs).toBe(-1500);

    const alignedVtt = applySubtitleAlignment(rawVtt, primaryResult!);
    // 00:10:05.000 - 1.5s = 00:10:03.500
    expect(alignedVtt).toContain("00:10:03.500 --> 00:10:06.500");
  });

  it("handles multi-MB audio upload to backend for torrent sources when local inference is unavailable", async () => {
    const WINDOW_DURATION_SECONDS = 60;
    const multiMbWavBuffer = createRealWavBuffer(WINDOW_DURATION_SECONDS, 523);
    const singleWindowSize = multiMbWavBuffer.byteLength;
    expect(singleWindowSize).toBeGreaterThan(1_900_000); // ~1.92 MB

    torrentMocks.extractAudioWindow.mockImplementation(async (request) => {
      const torrentQueryUrl = `${request.url}?client=sync&syncWindowIndex=${request.windowIndex}`;
      await fetch(torrentQueryUrl, { headers: { Range: "bytes=0-1023" } });
      return createRealWavBuffer(WINDOW_DURATION_SECONDS, 523);
    });

    // Simulate local model unavailable (falls back to sending audio files to BE)
    torrentMocks.ensureMoonshineModel.mockRejectedValue(
      new MoonshineLanguageUnavailableError("vi"),
    );

    const mockServerResult: SubtitleAlignmentResponse = {
      aligned: true,
      offsetMs: 2500,
      confidence: 88,
      speechIntervals: [],
      reason: null,
    };
    torrentMocks.mwFetch.mockResolvedValue({
      results: { primary: mockServerResult },
    });

    const progressEvents: Array<{
      progress: number;
      phase?: "capturing" | "analyzing";
    }> = [];

    const rawVtt = `WEBVTT

00:05:00.000 --> 00:05:03.000
Phụ đề kiểm tra torrent`;

    const result = await alignSubtitlesWithCurrentStream({
      sourceUrl: torrentServerUrl,
      isTorrent: true,
      startAt: 600,
      language: "vi",
      subtitles: [{ track: "primary", vttData: rawVtt }],
      videoDuration: 3600,
      buffered: 3600,
      onProgress: (progress, phase) => {
        progressEvents.push({ progress, phase });
      },
    });

    // Verify backend received the multipart FormData containing all multi-MB audio windows
    expect(torrentMocks.mwFetch).toHaveBeenCalledTimes(1);
    const backendRequest = torrentMocks.mwFetch.mock.calls[0][1];
    const formData = backendRequest.body as FormData;

    // Extract all audio entries from FormData
    const entries = [...formData.entries()];
    const audioEntries = entries.filter(([name]) => name === "audio");
    expect(audioEntries).toHaveLength(6);

    // Verify that the total uploaded audio data is > 11 MB
    let totalUploadedBytes = 0;
    for (const [, file] of audioEntries) {
      expect(file).toBeInstanceOf(Blob);
      const blob = file as Blob;
      expect(blob.size).toBe(singleWindowSize);
      totalUploadedBytes += blob.size;

      // Verify the uploaded blob is a valid RIFF/WAVE header
      const arrayBuffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      expect(bytes[0]).toBe(0x52); // R
      expect(bytes[1]).toBe(0x49); // I
      expect(bytes[2]).toBe(0x46); // F
      expect(bytes[3]).toBe(0x46); // F
    }

    expect(totalUploadedBytes).toBe(6 * singleWindowSize);
    expect(totalUploadedBytes).toBeGreaterThan(11_000_000); // > 11.5 MB

    // Verify monotonic progress
    for (let i = 1; i < progressEvents.length; i++) {
      expect(progressEvents[i].progress).toBeGreaterThanOrEqual(
        progressEvents[i - 1].progress,
      );
    }

    // Audio capture completed before analyzing phase started
    const firstAnalyzing = progressEvents.findIndex(
      (e) => e.phase === "analyzing",
    );
    expect(firstAnalyzing).toBeGreaterThan(0);
    const capturingEvents = progressEvents.slice(0, firstAnalyzing);
    expect(capturingEvents[capturingEvents.length - 1].progress).toBeCloseTo(
      0.4,
      5,
    );

    // Final result applied
    const primaryResult = result.results.primary;
    expect(primaryResult?.offsetMs).toBe(2500);
    const alignedVtt = applySubtitleAlignment(rawVtt, primaryResult!);
    // 00:05:00.000 + 2.5s = 00:05:02.500
    expect(alignedVtt).toContain("00:05:02.500 --> 00:05:05.500");
  });
});
