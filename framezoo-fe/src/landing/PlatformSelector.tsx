import type { AppDownloadOption } from "@/backend/download";

import type { LandingCopy } from "./i18n";

interface PlatformSelectorProps {
  options: AppDownloadOption[];
  selectedId: AppDownloadOption["id"] | null;
  recommendedId: AppDownloadOption["id"] | null;
  copy: LandingCopy["download"];
  onSelect: (id: AppDownloadOption["id"]) => void;
}

export function PlatformSelector({
  options,
  selectedId,
  recommendedId,
  copy,
  onSelect,
}: PlatformSelectorProps) {
  return (
    <div className="landing-platforms" aria-label={copy.chooseBuild}>
      <div className="landing-platform-grid">
        {options.map((option) => {
          const isSelected = selectedId === option.id;
          const isRecommended = recommendedId === option.id;

          return (
            <button
              className={`landing-platform-card${isSelected ? " is-selected" : ""}`}
              key={option.id}
              type="button"
              onClick={() => onSelect(option.id)}
              aria-pressed={isSelected}
            >
              <span className="landing-platform-icon" aria-hidden="true">
                {option.id.startsWith("mac") ? "⌘" : "⊞"}
              </span>
              <span className="landing-platform-copy">
                <strong>{option.label}</strong>
              </span>
              <span className="landing-platform-state">
                {isRecommended
                  ? copy.recommended
                  : isSelected
                    ? copy.selected
                    : ""}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
