import {
  type EmbedOutput,
  type EmbedScrapeContext,
  NotFoundError,
  flags,
} from "@p-stream/providers";

interface OpenMovieStreamInfo {
  name: string;
  title: string;
  url: string;
  quality: string;
  provider: string;
}

// Parse the encoded stream info from the embed URL
function decodeStreamInfo(encodedUrl: string): OpenMovieStreamInfo {
  try {
    // Remove the "openmovie://" prefix
    const encoded = encodedUrl.replace("openmovie://", "");
    return JSON.parse(decodeURIComponent(encoded));
  } catch {
    throw new NotFoundError("Failed to decode OpenMovie stream info");
  }
}

// Determine if a URL is an M3U8/HLS stream
function isHlsUrl(url: string): boolean {
  return (
    url.includes("m3u8") || url.includes("/m3u8-proxy") || url.includes(".m3u8")
  );
}

export async function scrapeOpenMovieEmbed(
  ctx: EmbedScrapeContext,
): Promise<EmbedOutput> {
  const streamInfo = decodeStreamInfo(ctx.url);

  if (!streamInfo.url) {
    throw new NotFoundError("No stream URL found");
  }

  const isHls = isHlsUrl(streamInfo.url);

  if (isHls) {
    return {
      stream: [
        {
          id: `openmovie-${streamInfo.provider}-hls`,
          type: "hls" as const,
          playlist: streamInfo.url,
          flags: [flags.CORS_ALLOWED],
          captions: [],
          skipValidation: true,
        },
      ],
    };
  }

  // MP4/direct file stream
  return {
    stream: [
      {
        id: `openmovie-${streamInfo.provider}-file`,
        type: "file" as const,
        flags: [flags.CORS_ALLOWED],
        captions: [],
        skipValidation: true,
        qualities: {
          [streamInfo.quality === "1080p"
            ? "1080"
            : streamInfo.quality === "720p"
              ? "720"
              : streamInfo.quality === "480p"
                ? "480"
                : streamInfo.quality === "360p"
                  ? "360"
                  : "unknown"]: {
            type: "mp4" as const,
            url: streamInfo.url,
          },
        },
      },
    ],
  };
}
