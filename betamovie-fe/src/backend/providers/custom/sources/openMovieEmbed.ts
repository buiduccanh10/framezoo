import {
  type EmbedOutput,
  type EmbedScrapeContext,
  NotFoundError,
  type StreamPreview,
  flags,
} from "@/lib/providers";

interface OpenMovieStreamInfo {
  name: string;
  title: string;
  url: string;
  subtitle?: string;
  quality: string;
  provider: string;
  headers?: Record<string, string>;
  streamType?: "hls" | "file" | "dash";
  variantId?: string;
  variantLabel?: string;
  preview?: StreamPreview;
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
    url.includes("m3u8") ||
    url.includes("/api/streams/") ||
    url.includes("/m3u8-proxy") ||
    url.includes(".m3u8")
  );
}

function isDashUrl(url: string): boolean {
  return (
    url.includes(".mpd") ||
    url.includes("/dash/") ||
    url.includes("/mpd-proxy") ||
    url.includes("application/dash+xml")
  );
}

export async function scrapeOpenMovieEmbed(
  ctx: EmbedScrapeContext,
): Promise<EmbedOutput> {
  const streamInfo = decodeStreamInfo(ctx.url);

  if (!streamInfo.url) {
    throw new NotFoundError("No stream URL found");
  }

  const inferredType =
    streamInfo.streamType ||
    (isDashUrl(streamInfo.url)
      ? "dash"
      : isHlsUrl(streamInfo.url)
        ? "hls"
        : "file");

  const qualityMap: Record<string, string> = {
    "2160p": "4k",
    "1440p": "1440",
    "1080p": "1080",
    "720p": "720",
    "480p": "480",
    "360p": "360",
  };

  const quality =
    qualityMap[streamInfo.quality] ||
    streamInfo.quality?.replace("p", "") ||
    "unknown";
  const streamVariantId = (streamInfo.variantId || streamInfo.provider || "")
    .trim()
    .replace(/\s+/g, "-");

  return {
    stream: [
      {
        id: `openmovie-${streamVariantId}-${inferredType}-${quality}`,
        type:
          inferredType === "dash"
            ? ("dash" as const)
            : inferredType === "hls"
              ? ("hls" as const)
              : ("file" as const),
        flags: [flags.CORS_ALLOWED],
        captions: streamInfo.subtitle
          ? [
              {
                id: streamInfo.subtitle,
                type: "srt", // Default to srt as seen in API response
                url: streamInfo.subtitle,
                hasCorsRestrictions: false,
                language: "en", // Default to English if not specified
              },
            ]
          : [],
        skipValidation: true,
        preview: streamInfo.preview,
        headers: streamInfo.headers,
        ...(inferredType === "hls" ? { playlist: streamInfo.url } : {}),
        ...(inferredType === "dash" ? { manifest: streamInfo.url } : {}),
        qualities: {
          [quality]: {
            type: inferredType === "hls" ? ("hls" as const) : ("mp4" as const),
            url: streamInfo.url,
          },
        },
      },
    ],
  } as any;
}
