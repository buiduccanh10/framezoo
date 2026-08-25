import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ADDON_PROTOCOL_MAX_RESPONSE_SIZE_BYTES,
  AddonProtocolEngine,
  AddonProtocolError,
  getAddonResourceUrl,
} from "./engine";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AddonProtocolEngine", () => {
  it("builds protocol URLs relative to the manifest directory", () => {
    expect(
      getAddonResourceUrl({
        manifestUrl: "https://example.com/addons/demo/manifest.json",
        resource: "stream",
        type: "series",
        id: "tt1234567:1:2",
      }),
    ).toBe(
      "https://example.com/addons/demo/stream/series/tt1234567%3A1%3A2.json",
    );

    expect(
      getAddonResourceUrl({
        manifestUrl: "https://example.com/addons/demo/manifest.json",
        resource: "catalog",
        type: "movie",
        catalogId: "top",
      }),
    ).toBe("https://example.com/addons/demo/catalog/movie/top.json");
  });

  it("fetches and parses manifest JSON", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          id: "com.example.addon",
          version: "1.0.0",
          name: "Example",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new AddonProtocolEngine().loadManifest(
      "https://example.com/manifest.json",
    );

    expect(result.statusCode).toBe(200);
    expect(result.finalUrl).toBe("https://example.com/manifest.json");
    expect(result.body).toEqual({
      id: "com.example.addon",
      version: "1.0.0",
      name: "Example",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/manifest.json",
      expect.objectContaining({
        method: "GET",
        redirect: "follow",
      }),
    );
  });

  it("bypasses HTTP cache for cache-busted addon requests", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await new AddonProtocolEngine().request({
      manifestUrl: "https://example.com/addons/demo/manifest.json",
      resource: "subtitles",
      type: "series",
      id: "tt1234567:1:2",
      cacheBust: "123",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/addons/demo/subtitles/series/tt1234567%3A1%3A2.json?reload=123",
      expect.objectContaining({
        cache: "no-store",
      }),
    );
  });

  it("rejects unsupported protocols, HTTP failures, and invalid JSON", async () => {
    const engine = new AddonProtocolEngine();

    await expect(
      engine.loadManifest("file:///tmp/manifest.json"),
    ).rejects.toThrow("HTTP or HTTPS");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad gateway", { status: 502 })),
    );
    await expect(
      engine.loadManifest("https://example.com/manifest.json"),
    ).rejects.toMatchObject({
      statusCode: 502,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{not-json", { status: 200 })),
    );
    await expect(
      engine.loadManifest("https://example.com/manifest.json"),
    ).rejects.toThrow("invalid JSON");
  });

  it("rejects responses larger than the protocol limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("{}", {
            status: 200,
            headers: {
              "content-length": String(
                ADDON_PROTOCOL_MAX_RESPONSE_SIZE_BYTES + 1,
              ),
            },
          }),
      ),
    );

    await expect(
      new AddonProtocolEngine().loadManifest(
        "https://example.com/manifest.json",
      ),
    ).rejects.toThrow("maximum allowed size");
  });
});
