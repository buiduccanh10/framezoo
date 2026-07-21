import { useEffect, useRef, useState } from "react";

import { LazyImage } from "@/components/utils/Image";

interface DetailsBackdropProps {
  title: string;
  logoUrl?: string | null;
  backdrop?: string | null;
}

export function DetailsBackdrop({
  title,
  logoUrl,
  backdrop,
}: DetailsBackdropProps) {
  const [logoHeight, setLogoHeight] = useState<number>(0);
  const logoRef = useRef<HTMLDivElement>(null);

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
            zIndex: -1,
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
            zIndex: -1,
          }}
        />
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
}
