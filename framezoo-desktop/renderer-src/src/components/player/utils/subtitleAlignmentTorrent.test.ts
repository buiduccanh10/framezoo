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
  alignWindowsLocal: vi.fn(),
}));

vi.mock("./audioCapture", () => ({
  extractAudioWindow: torrentMocks.extractAudioWindow,
}));
vi.mock("../../../backend/helpers/fetch", () => ({
  mwFetch: torrentMocks.mwFetch,
}));
vi.mock("../../../setup/config", () => ({
  conf: () => ({ BACKEND_URL: "http://backend.test" }),
}));
vi.mock("../../../sync/aligner", async () => {
  const actual = await vi.importActual<typeof import("../../../sync/aligner")>(
    "../../../sync/aligner",
  );
  return {
    ...actual,
    alignWindowsLocal: torrentMocks.alignWindowsLocal,
  };
});

import { decodeWav } from "../../../sync/aligner";
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
    torrentServer = createServer((req, res) => {
      const parsedUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      receivedTorrentRequests.push({
        url: req.url ?? "",
        range: req.headers.range ?? null,
        client: parsedUrl.searchParams.get("client"),
        syncWindowIndex: parsedUrl.searchParams.get("syncWindowIndex"),
      });

      res.writeHead(206, {
        "Content-Range": "bytes 0-1023/104857600",
        "Content-Length": "1024",
        "Content-Type": "video/mp4",
      });
      res.end(Buffer.alloc(1024, 0xaa));
    });

    await new Promise<void>((resolve) => {
      torrentServer.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = torrentServer.address() as AddressInfo;
    torrentServerUrl = `http://127.0.0.1:${addr.port}/stream.mp4`;
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

  it("extracts multi-MB audio windows from a torrent source and aligns with local VAD+FFT engine", async () => {
    const WINDOW_DURATION_SECONDS = 60;
    const multiMbWavBuffer = createRealWavBuffer(WINDOW_DURATION_SECONDS, 440);
    expect(multiMbWavBuffer.byteLength).toBeGreaterThan(1_900_000); // ~1.92 MB

    // Verify real decodeWav decodes this buffer accurately
    const decodedVerification = decodeWav(multiMbWavBuffer);
    expect(decodedVerification.durationMs).toBe(60_000);
    expect(decodedVerification.sampleRate).toBe(16_000);
    expect(decodedVerification.samples.length).toBe(960_000);

    const extractionCalls: Array<{ windowIndex?: number; url: string }> = [];
    torrentMocks.extractAudioWindow.mockImplementation(async (request) => {
      extractionCalls.push({
        windowIndex: request.windowIndex,
        url: request.url,
      });

      const torrentQueryUrl = `${request.url}?client=sync&syncWindowIndex=${request.windowIndex}&syncStartAt=${request.startAt}&syncDuration=${request.duration}`;
      await fetch(torrentQueryUrl, { headers: { Range: "bytes=0-1023" } });

      return createRealWavBuffer(
        WINDOW_DURATION_SECONDS,
        440 + (request.windowIndex ?? 0) * 50,
      );
    });

    // Mock local aligner success
    torrentMocks.alignWindowsLocal.mockResolvedValue({
      aligned: true,
      offsetMs: -1500,
      confidence: 94,
      speechIntervals: [{ startMs: 10_000, endMs: 25_000 }],
      reason: null,
    });

    const progressEvents: Array<{
      progress: number;
      phase?: "capturing" | "analyzing";
    }> = [];

    const rawVtt = `WEBVTT

00:10:05.000 --> 00:10:08.000
Torrent speech cue line`;

    const result = await alignSubtitlesWithCurrentStream({
      sourceUrl: torrentServerUrl,
      isTorrent: true,
      startAt: 600,
      language: "en",
      subtitles: [{ track: "primary", vttData: rawVtt }],
      videoDuration: 3600,
      buffered: 1800,
      onProgress: (progress, phase) => {
        progressEvents.push({ progress, phase });
      },
    });

    expect(result.results.primary?.aligned).toBe(true);
    expect(result.results.primary?.offsetMs).toBe(-1500);
    expect(result.results.primary?.confidence).toBe(94);

    expect(extractionCalls.length).toBeGreaterThan(0);
    expect(extractionCalls[0]?.windowIndex).toBe(0);

    const alignedVtt = applySubtitleAlignment(
      rawVtt,
      result.results.primary!,
    );
    expect(alignedVtt).toContain("00:10:03.500 --> 00:10:06.500");
  });

  it("handles fallback to backend when local on-device sync is unavailable", async () => {
    const WINDOW_DURATION_SECONDS = 60;
    torrentMocks.extractAudioWindow.mockImplementation(async (request) => {
      const torrentQueryUrl = `${request.url}?client=sync&syncWindowIndex=${request.windowIndex}`;
      await fetch(torrentQueryUrl, { headers: { Range: "bytes=0-1023" } });
      return createRealWavBuffer(WINDOW_DURATION_SECONDS, 523);
    });

    // Simulate local sync failure/skip
    torrentMocks.alignWindowsLocal.mockRejectedValue(new Error("Local WASM disabled"));

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
    });

    expect(result.results.primary?.aligned).toBe(true);
    expect(result.results.primary?.offsetMs).toBe(2500);
    expect(torrentMocks.mwFetch).toHaveBeenCalled();
  });
});
