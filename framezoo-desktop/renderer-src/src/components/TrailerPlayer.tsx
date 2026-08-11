import React, { useEffect, useState } from "react";

import { getIMDbMetadata } from "@/backend/metadata/imdb";
import { fetchCachedTmdb } from "@/utils/tmdbQuery";

interface TrailerPlayerProps {
  tmdbId: string;
  tmdbType: "movie" | "show";
  initialImdbId?: string;
  isActive: boolean;
  onPlay?: () => void;
}

export const TrailerPlayer: React.FC<TrailerPlayerProps> = ({
  tmdbId,
  tmdbType,
  initialImdbId,
  isActive,
  onPlay,
}) => {
  const [isReady, setIsReady] = useState(false);
  const [shouldRender, setShouldRender] = useState(isActive);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    if (isActive) {
      setShouldRender(true);

      const fetchTrailer = async () => {
        if (streamUrl) return;

        try {
          let imdbId = initialImdbId;

          // Fetch IMDb ID if missing
          if (!imdbId) {
            const externalIds = await fetchCachedTmdb<any>(
              `/${tmdbType === "movie" ? "movie" : "tv"}/${tmdbId}/external_ids`,
            );
            if (isCancelled) return;
            imdbId = externalIds?.imdb_id;
          }

          if (!imdbId) return;

          // Fetch IMDb metadata to get trailer URL
          const metadata = await getIMDbMetadata(imdbId);
          if (isCancelled) return;

          if (metadata?.trailer_url) {
            setStreamUrl(metadata.trailer_url);
          }
        } catch (error) {
          console.error("Failed to fetch IMDb trailer:", error);
        }
      };

      void fetchTrailer();
    } else {
      const timer = setTimeout(() => {
        setShouldRender(false);
        setIsReady(false);
      }, 1000);
      return () => {
        clearTimeout(timer);
        isCancelled = true;
      };
    }

    return () => {
      isCancelled = true;
    };
  }, [isActive, tmdbId, tmdbType, initialImdbId, streamUrl]);

  if (!shouldRender || !streamUrl) return null;

  return (
    <div
      className="absolute inset-0 w-full h-full object-cover object-center pointer-events-none"
      style={{
        maskImage:
          "linear-gradient(to top, rgba(0, 0, 0, 0), rgba(0, 0, 0, 1) 700px)",
        WebkitMaskImage:
          "linear-gradient(to top, rgba(0, 0, 0, 0), rgba(0, 0, 0, 1) 700px)",
        opacity: isReady && isActive ? 1 : 0,
        transition: "opacity 0.8s ease",
        zIndex: isActive ? 10 : 5,
      }}
    >
      <video
        src={streamUrl}
        autoPlay
        muted
        loop
        playsInline
        onCanPlay={() => {
          setIsReady(true);
          if (onPlay) onPlay();
        }}
        onError={() => setIsReady(false)}
        className="w-full h-full object-cover object-center pointer-events-none"
      />
    </div>
  );
};
