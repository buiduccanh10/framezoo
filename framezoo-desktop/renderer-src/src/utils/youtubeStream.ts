/**
 * Fetches a direct YouTube video stream URL via the Piped API
 * (open-source YouTube proxy: https://github.com/TeamPiped/Piped).
 * Returns a URL suitable for <video src>, bypassing any iframe/player UI.
 */

// Multiple public Piped instances as fallbacks
const PIPED_INSTANCES = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.adminforge.de",
  "https://api.piped.yt",
  "https://piped-api.garudalinux.org",
];

interface PipedVideoStream {
  url: string;
  quality: string;
  mimeType: string;
  bitrate: number;
  videoOnly: boolean;
}

interface PipedStreamsResponse {
  videoStreams: PipedVideoStream[];
  audioStreams?: { url: string; quality: string; mimeType: string }[];
  error?: string;
}

// In-memory cache: videoId → stream URL (or null if unavailable)
const streamCache = new Map<string, string | null>();

/**
 * Returns a direct MP4/WebM stream URL for the given YouTube video ID.
 * Tries multiple Piped instances and caches the result.
 * Returns null if all instances fail or no suitable stream found.
 */
export async function getYoutubeStreamUrl(
  videoId: string,
): Promise<string | null> {
  if (streamCache.has(videoId)) {
    return streamCache.get(videoId) ?? null;
  }

  for (const instance of PIPED_INSTANCES) {
    try {
      const res = await fetch(`${instance}/streams/${videoId}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) continue;

      const data: PipedStreamsResponse = await res.json();
      if (data.error) continue;

      // Prefer combined (non-videoOnly) streams for simplest playback;
      // for a muted background video, videoOnly is also fine.
      const streams = data.videoStreams ?? [];
      const preferred =
        // Pick best quality non-videoOnly stream (has muxed audio)
        streams.find(
          (s) =>
            !s.videoOnly &&
            (s.mimeType.includes("mp4") || s.mimeType.includes("webm")),
        ) ??
        // Fallback: any videoOnly stream (muted, so audio irrelevant)
        streams.find(
          (s) => s.mimeType.includes("mp4") || s.mimeType.includes("webm"),
        ) ??
        null;

      const url = preferred?.url ?? null;
      streamCache.set(videoId, url);
      return url;
    } catch {
      // Try next instance
    }
  }

  streamCache.set(videoId, null);
  return null;
}
