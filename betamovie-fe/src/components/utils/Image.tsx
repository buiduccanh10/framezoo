import classNames from "classnames";
import React, { ImgHTMLAttributes, useEffect, useState } from "react";
import { LazyLoadImage } from "react-lazy-load-image-component";

import { Icon, Icons } from "@/components/Icon";
import { resolvePublicUrl } from "@/utils/publicUrl";

export interface ImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  fallbackSrc?: string;
  showSkeleton?: boolean;
}

export function LazyImage({
  src,
  alt,
  className,
  fallbackSrc,
  showSkeleton = true,
  loading = "lazy",
  decoding = "async",
  onLoad,
  onError,
  style,
  ...props
}: ImageProps) {
  const resolvedSrc = resolvePublicUrl(src);
  const resolvedFallbackSrc = resolvePublicUrl(fallbackSrc);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [currentSrc, setCurrentSrc] = useState<string | undefined>(resolvedSrc);

  useEffect(() => {
    // Reset state when src changes
    setIsLoaded(false);
    setHasError(false);
    setCurrentSrc(resolvedSrc);
  }, [resolvedSrc]);

  const handleLoad = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    setIsLoaded(true);
    onLoad?.(e);
  };

  const handleError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    if (resolvedFallbackSrc && currentSrc !== resolvedFallbackSrc) {
      setCurrentSrc(resolvedFallbackSrc);
      setHasError(false);
    } else {
      setHasError(true);
    }
    setIsLoaded(true); // Remove skeleton on error
    onError?.(e);
  };

  return (
    <div
      className={classNames(
        "relative",
        // Optional placeholder background until loaded
        !isLoaded && showSkeleton
          ? "bg-mediaCard-hoverBackground"
          : "bg-transparent",
        className, // pass to wrapper to handle absolute, w-full, h-full etc.
      )}
      style={style}
    >
      {/* Skeleton / Placeholder animation */}
      {!isLoaded && showSkeleton && !hasError && (
        <div className="absolute inset-0 animate-pulse bg-white/5" />
      )}

      {/* Error Fallback Icon */}
      {hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-mediaCard-hoverBackground">
          <Icon icon={Icons.WARNING} className="text-type-secondary text-2xl" />
        </div>
      )}

      {/* Actual Image */}
      {currentSrc && !hasError && (
        <LazyLoadImage
          src={currentSrc}
          alt={alt || ""}
          loading={loading}
          decoding={decoding}
          onLoad={handleLoad}
          onError={handleError}
          className={classNames("block", className)}
          {...props} // Passed props should go to the img tag, minus any wrapper style props potentially conflicting
        />
      )}
    </div>
  );
}
