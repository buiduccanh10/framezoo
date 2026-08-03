import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendExtensionRequest: vi.fn(),
}));

vi.mock("@/backend/extension/messaging", () => mocks);

import { loadAddonManifest, loadAddonStreams } from "./client";
import { normalizeManifest } from "./manifest";

const addon = normalizeManifest("https://torrentio.strem.fun/manifest.json", {
  id: "com.stremio.torrentio.addon",
  version: "0.0.15",
  name: "Torrentio",
  resources: [
    {
      name: "stream",
      types: ["movie", "series"],
      idPrefixes: ["tt"],
    },
  ],
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  mocks.sendExtensionRequest.mockReset();
});

describe("desktop addon client", () => {
  it("uses the native protocol bridge when available", async () => {
    const loadManifest = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: { "content-type": "application/json" },
      finalUrl: "https://example.com/manifest.json",
      body: {
        id: "com.example.native",
        version: "1.0.0",
        name: "Native addon",
        description: "Loaded by the desktop protocol engine.",
        logo: "assets/logo.svg",
        resources: ["catalog"],
      },
    });
    const request = vi.fn();

    vi.stubGlobal("window", {
      __ALPHAFLIX_DESKTOP__: true,
      electronAPI: {
        addons: {
          loadManifest,
          request,
        },
      },
    });

    const nativeAddon = await loadAddonManifest(
      "https://example.com/addons/manifest.json",
    );

    expect(loadManifest).toHaveBeenCalledWith(
      "https://example.com/addons/manifest.json",
    );
    expect(request).not.toHaveBeenCalled();
    expect(nativeAddon.manifest.logo).toBe(
      "https://example.com/addons/assets/logo.svg",
    );
    expect(nativeAddon.manifest.description).toBe(
      "Loaded by the desktop protocol engine.",
    );
  });

  it("uses renderer fetch when Electron IPC does not settle", async () => {
    mocks.sendExtensionRequest.mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal("window", {
      __ALPHAFLIX_DESKTOP__: true,
      electronAPI: {
        sendExtensionMessage: vi.fn(),
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        expect(String(input)).toBe(
          "https://torrentio.strem.fun/stream/series/tt9288030%3A1%3A1.json",
        );
        return new Response(
          JSON.stringify({
            streams: [
              {
                infoHash: "0123456789abcdef0123456789abcdef01234567",
                fileIdx: 0,
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }),
    );

    const streams = await loadAddonStreams(addon, {
      type: "series",
      id: "tt9288030",
      season: 1,
      episode: 1,
    });

    expect(streams).toHaveLength(1);
    expect(streams[0]?.infoHash).toBe(
      "0123456789abcdef0123456789abcdef01234567",
    );
  });

  it("uses Electron IPC when renderer fetch is unavailable", async () => {
    vi.stubGlobal("window", {
      __ALPHAFLIX_DESKTOP__: true,
      electronAPI: {
        sendExtensionMessage: vi.fn(),
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    mocks.sendExtensionRequest.mockResolvedValue({
      success: true,
      response: {
        statusCode: 200,
        headers: {},
        finalUrl: "https://torrentio.strem.fun/stream/movie/tt1234567.json",
        body: {
          streams: [
            {
              infoHash: "abcdef0123456789abcdef0123456789abcdef01",
            },
          ],
        },
      },
    });

    const streams = await loadAddonStreams(addon, {
      type: "movie",
      id: "tt1234567",
    });

    expect(streams).toHaveLength(1);
    expect(mocks.sendExtensionRequest).toHaveBeenCalledWith(
      {
        url: "https://torrentio.strem.fun/stream/movie/tt1234567.json",
        method: "GET",
      },
      15_000,
    );
  });
});
