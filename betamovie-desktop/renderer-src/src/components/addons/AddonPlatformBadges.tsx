import classNames from "classnames";
import { useTranslation } from "react-i18next";

import { Icon, Icons } from "@/components/Icon";

type Platform = "alphaflix" | "stremio";

function PlatformIcon({ platform }: { platform: Platform }) {
  if (platform === "alphaflix") {
    return (
      <span
        aria-hidden="true"
        className="relative h-4 w-4 shrink-0 overflow-hidden"
      >
        <Icon
          icon={Icons.LOGO}
          className="absolute -left-2 -top-1 block [&>svg]:h-6 [&>svg]:w-auto [&>svg]:max-w-none"
        />
      </span>
    );
  }

  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5 shrink-0"
      width="124.926"
      height="124.927"
      viewBox="0 0 124.926 124.927"
      fill="none"
    >
      <defs>
        <linearGradient
          id="addon-platform-stremio-gradient"
          x1="1"
          x2="0.296"
          y1="1"
          y2="0.296"
          gradientUnits="objectBoundingBox"
        >
          <stop offset="0" stopColor="#1155d9" />
          <stop offset="1" stopColor="#7b5bf5" />
        </linearGradient>
      </defs>
      <g transform="translate(0.001)">
        <rect
          width="88.336"
          height="88.336"
          fill="url(#addon-platform-stremio-gradient)"
          rx="6"
          transform="rotate(45 31.231 75.4)"
        />
        <path
          fill="#fff"
          d="M83.389 61.658a1 1 0 0 1 0 1.611L54.75 84.334a1 1 0 0 1-1.592-.806V41.399a1 1 0 0 1 1.592-.806Z"
        />
      </g>
    </svg>
  );
}

export function AddonPlatformBadges({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const platforms: Array<{
    id: Platform;
    label: string;
    className: string;
  }> = [
    {
      id: "stremio",
      label: t("addons.platforms.stremio", "Stremio"),
      className: "border-orange-400/35 bg-orange-400/10 text-orange-100",
    },
    {
      id: "alphaflix",
      label: t("addons.platforms.alphaflix", "AlphaFlix"),
      className: "border-[#E40D00]/35 bg-[#E40D00]/10 text-red-100",
    },
  ];

  return (
    <div
      className={classNames("flex flex-wrap items-center gap-1.5", className)}
      aria-label={t(
        "addons.platforms.supported",
        "Supported platforms: Stremio and AlphaFlix",
      )}
    >
      {platforms.map((platform) => (
        <span
          key={platform.id}
          className={classNames(
            "inline-flex items-center gap-1 rounded-full border font-medium leading-none",
            compact ? "px-1.5 py-1 text-[10px]" : "px-2 py-1 text-[11px]",
            platform.className,
          )}
        >
          <PlatformIcon platform={platform.id} />
          <span>{platform.label}</span>
        </span>
      ))}
    </div>
  );
}
