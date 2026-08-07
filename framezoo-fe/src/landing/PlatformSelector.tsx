import type { AppDownloadOption } from "@/backend/download";

import type { LandingCopy } from "./i18n";

interface PlatformSelectorProps {
  options: AppDownloadOption[];
  recommendedId: AppDownloadOption["id"] | null;
  copy: LandingCopy["download"];
}

export function PlatformSelector({
  options,
  recommendedId,
  copy,
}: PlatformSelectorProps) {
  return (
    <div className="landing-platforms" aria-label={copy.chooseBuild}>
      <div className="landing-platform-grid">
        {options.map((option) => {
          const isRecommended = recommendedId === option.id;

          return (
            <a
              className={`landing-platform-card${isRecommended ? " is-recommended" : ""}`}
              key={option.id}
              href={option.url}
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
                <span aria-hidden="true">↓</span>
              </span>
            </a>
          );
        })}
      </div>
    </div>
  );
}
