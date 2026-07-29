import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DownloadManifestError,
  getAppDownloadManifest,
  validateAppDownloadManifest,
} from "./download";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("download manifest", () => {
  it("validates options and resolves relative URLs", () => {
    const manifest = validateAppDownloadManifest(
      {
        version: "1.2.3",
        options: [
          {
            id: "mac-universal",
            label: "macOS Universal",
            description: "Works on both Mac architectures",
            url: "/download?option=mac-universal",
          },
        ],
      },
      "https://downloads.example.com",
    );

    expect(manifest).toEqual({
      version: "1.2.3",
      options: [
        {
          id: "mac-universal",
          label: "macOS Universal",
          description: "Works on both Mac architectures",
          url: "https://downloads.example.com/download?option=mac-universal",
        },
      ],
    });
  });

  it("keeps an empty release manifest as a valid empty state", () => {
    expect(
      validateAppDownloadManifest(
        { version: null, options: [] },
        "https://downloads.example.com",
      ),
    ).toEqual({ version: null, options: [] });
  });

  it("rejects malformed manifests", () => {
    expect(() =>
      validateAppDownloadManifest(
        {
          version: "1.2.3",
          options: [
            {
              id: "linux-x64",
              label: "Linux",
              description: "Unsupported",
              url: "/download?option=linux-x64",
            },
          ],
        },
        "https://downloads.example.com",
      ),
    ).toThrow(DownloadManifestError);
  });

  it("surfaces API failures for the retry state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 503,
          statusText: "Unavailable",
        }),
      ),
    );

    await expect(
      getAppDownloadManifest("https://downloads.example.com"),
    ).rejects.toThrow("status 503");
  });
});
