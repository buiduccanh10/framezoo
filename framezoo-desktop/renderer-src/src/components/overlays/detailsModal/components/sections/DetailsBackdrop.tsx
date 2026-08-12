import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import {
  TrailerPlayer,
  type TrailerPlayerHandle,
} from "@/components/TrailerPlayer";
import { LazyImage } from "@/components/utils/Image";

interface DetailsBackdropProps {
  title: string;
  logoUrl?: string | null;
  backdrop?: string | null;
  tmdbId: string;
  tmdbType: "movie" | "show";
  imdbId?: string | null;
  isTrailerEnabled: boolean;
  isTrailerMuted: boolean;
}

export const DetailsBackdrop = forwardRef<
  TrailerPlayerHandle,
  DetailsBackdropProps
>(function DetailsBackdropComponent(
  {
    title,
    logoUrl,
    backdrop,
    tmdbId,
    tmdbType,
    imdbId,
    isTrailerEnabled,
    isTrailerMuted,
  },
  ref,
) {
  const [logoHeight, setLogoHeight] = useState<number>(0);
  const logoRef = useRef<HTMLDivElement>(null);
  const [trailerReady, setTrailerReady] = useState(false);
  const trailerPlayerRef = useRef<TrailerPlayerHandle>(null);

  useImperativeHandle(
    ref,
    () => ({
      setMuted: (muted) => trailerPlayerRef.current?.setMuted(muted),
    }),
    [],
  );

  useEffect(() => {
    if (!isTrailerEnabled) {
      setTrailerReady(false);
    }
  }, [isTrailerEnabled]);

  useEffect(() => {
    if (logoRef.current) {
      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          // Isolate this state update to this small component
          setLogoHeight(entry.contentRect.height);
        }
      });

      resizeObserver.observe(logoRef.current);
      return () => resizeObserver.disconnect();
    }
  }, []);

  return (
    <div
      className="relative -mt-12 z-20"
      style={{
        height: `${Math.max(500, logoHeight + 400)}px`,
      }}
    >
      {/* Title/Logo positioned on backdrop */}
      <div ref={logoRef} className="absolute inset-x-0 bottom-20 z-30 px-6">
        {logoUrl ? (
          <LazyImage
            src={logoUrl}
            alt={title}
            className="max-w-[16rem] md:max-w-[20rem] lg:max-w-[30rem] max-h-[12rem] object-contain drop-shadow-lg bg-transparent"
            style={{ background: "none" }}
          />
        ) : (
          <h3 className="text-3xl md:text-4xl font-bold text-white drop-shadow-lg">
            {title}
          </h3>
        )}
      </div>

      {/* Fallback Image Layer (fades out when trailer is ready) */}
      <div
        className="absolute inset-0 transition-opacity duration-1000"
        style={{
          opacity: isTrailerEnabled && trailerReady ? 0 : 1,
          zIndex: -1,
        }}
      >
        {backdrop ? (
          <LazyImage
            src={backdrop}
            alt={title}
            className="absolute inset-0 w-full h-full object-cover object-top before:absolute before:inset-0 before:bg-[radial-gradient(circle_at_center,_transparent_0%,_rgba(0,0,0,0.4)_100%)]"
            style={{
              maskImage:
                "linear-gradient(to top, rgba(0, 0, 0, 0), rgba(0, 0, 0, 1) 150px)",
              WebkitMaskImage:
                "linear-gradient(to top, rgba(0, 0, 0, 0), rgba(0, 0, 0, 1) 150px)",
            }}
          />
        ) : (
          <div
            className="absolute inset-0 bg-cover bg-top before:absolute before:inset-0 before:bg-[radial-gradient(circle_at_center,_transparent_0%,_rgba(0,0,0,0.4)_100%)]"
            style={{
              maskImage:
                "linear-gradient(to top, rgba(0, 0, 0, 0), rgba(0, 0, 0, 1) 150px)",
              WebkitMaskImage:
                "linear-gradient(to top, rgba(0, 0, 0, 0), rgba(0, 0, 0, 1) 150px)",
            }}
          />
        )}
      </div>

      {/* Trailer Layer - Masked and hidden until playing */}
      {tmdbId && (
        <div
          className="absolute inset-0 w-full h-full object-cover object-center pointer-events-none"
          style={{
            zIndex: -2,
            maskImage:
              "linear-gradient(to top, rgba(0, 0, 0, 0) 10%, rgba(0, 0, 0, 1) 50%, rgba(0, 0, 0, 1) 100%)",
            WebkitMaskImage:
              "linear-gradient(to top, rgba(0, 0, 0, 0) 10%, rgba(0, 0, 0, 1) 50%, rgba(0, 0, 0, 1) 100%)",
            opacity: isTrailerEnabled && trailerReady ? 1 : 0,
            transition: "opacity 0.8s ease",
          }}
        >
          <TrailerPlayer
            ref={trailerPlayerRef}
            tmdbId={tmdbId}
            tmdbType={tmdbType}
            initialImdbId={imdbId || undefined}
            isActive={isTrailerEnabled}
            isMuted={isTrailerMuted}
            onPlay={() => {
              if (isTrailerEnabled) setTrailerReady(true);
            }}
            onError={() => {
              if (isTrailerEnabled) setTrailerReady(false);
            }}
          />
        </div>
      )}

      {/* Focus Vignette / Edge Blur Overlay */}
      <div
        className="absolute inset-0 pointer-events-none backdrop-blur-md bg-black/10"
        style={{
          maskImage:
            "radial-gradient(ellipse at center, transparent 40%, rgba(0, 0, 0, 1) 100%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at center, transparent 40%, rgba(0, 0, 0, 1) 100%)",
          zIndex: -1,
        }}
      />
    </div>
  );
});
