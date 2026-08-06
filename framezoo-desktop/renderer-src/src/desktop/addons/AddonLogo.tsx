import classNames from "classnames";
import { useEffect, useState } from "react";

import { Icon, Icons } from "@/components/Icon";
import { LazyImage } from "@/components/utils/Image";

interface AddonLogoProps {
  name: string;
  logo?: string;
  className?: string;
  fallbackIcon?: Icons;
}

export function AddonLogo({
  name,
  logo,
  className = "h-10 w-10",
  fallbackIcon = Icons.EXTENSION,
}: AddonLogoProps) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [logo]);

  if (!logo || hasError) {
    return (
      <span
        className={classNames(
          "flex shrink-0 items-center justify-center rounded-lg bg-white/10 text-xl text-white",
          className,
        )}
        aria-label={`${name} addon icon`}
      >
        <Icon icon={fallbackIcon} />
      </span>
    );
  }

  return (
    <LazyImage
      src={logo}
      alt={`${name} addon icon`}
      className={classNames("shrink-0 rounded-lg object-contain", className)}
      showSkeleton={false}
      loading="eager"
      decoding="sync"
      onError={() => setHasError(true)}
    />
  );
}
