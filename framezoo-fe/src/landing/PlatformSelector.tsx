import { useMemo, useState } from "react";

import type { AppDownloadOption } from "@/backend/download";

import { DownloadConfirmModal } from "./DownloadConfirmModal";
import type { LandingCopy } from "./i18n";
import { DownloadIcon } from "./LandingIcon";

interface PlatformSelectorProps {
  options: AppDownloadOption[];
  recommendedId: AppDownloadOption["id"] | null;
  copy: LandingCopy["download"];
  fullCopy?: LandingCopy;
}

export function PlatformSelector({
  options,
  recommendedId,
  copy,
  fullCopy,
}: PlatformSelectorProps) {
  const [pendingOption, setPendingOption] = useState<AppDownloadOption | null>(
    null,
  );

  const displayOptions = useMemo(() => {
    if (!recommendedId) return options;

    const recommended = options.find((opt) => opt.id === recommendedId);
    if (!recommended) return options;

    const isWinRecommended = recommended.id.startsWith("win-");
    const isMacRecommended = recommended.id.startsWith("mac-");

    const samePlatform = options.filter(
      (opt) =>
        opt.id !== recommendedId &&
        ((isWinRecommended && opt.id.startsWith("win-")) ||
          (isMacRecommended && opt.id.startsWith("mac-"))),
    );

    const otherPlatform = options.filter(
      (opt) =>
        opt.id !== recommendedId &&
        !(
          (isWinRecommended && opt.id.startsWith("win-")) ||
          (isMacRecommended && opt.id.startsWith("mac-"))
        ),
    );

    return [recommended, ...samePlatform, ...otherPlatform];
  }, [options, recommendedId]);

  const handleCardClick = (
    event: React.MouseEvent<HTMLAnchorElement>,
    option: AppDownloadOption,
  ) => {
    if (fullCopy) {
      event.preventDefault();
      setPendingOption(option);
    }
  };

  const handleConfirmDownload = (option: AppDownloadOption) => {
    setPendingOption(null);
    window.open(option.url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="landing-platforms" aria-label={copy.chooseBuild}>
      <div className="landing-platform-grid">
        {displayOptions.map((option) => {
          const isRecommended = recommendedId === option.id;

          return (
            <a
              className={`landing-platform-card${isRecommended ? " is-recommended" : ""}`}
              key={option.id}
              href={option.url}
              onClick={(e) => handleCardClick(e, option)}
              target="_blank"
              rel="noreferrer"
              aria-label={`${copy.download}: ${option.label}`}
            >
              <span className="landing-platform-copy">
                <strong>{option.label}</strong>
                {isRecommended ? (
                  <span className="landing-platform-state">
                    {copy.recommended}
                  </span>
                ) : null}
              </span>
              <span className="landing-platform-action">
                {copy.download}
                <DownloadIcon />
              </span>
            </a>
          );
        })}
      </div>

      {fullCopy && (
        <DownloadConfirmModal
          isOpen={pendingOption !== null}
          option={pendingOption}
          copy={fullCopy}
          onClose={() => setPendingOption(null)}
          onConfirm={handleConfirmDownload}
        />
      )}
    </div>
  );
}
