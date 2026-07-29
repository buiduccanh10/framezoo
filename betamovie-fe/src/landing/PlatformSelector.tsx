import type { AppDownloadOption } from "@/backend/download";

import type { LandingCopy } from "./LandingPage";
import type { PlatformDetection } from "./platform";

interface PlatformSelectorProps {
  options: AppDownloadOption[];
  selectedId: AppDownloadOption["id"] | null;
  recommendedId: AppDownloadOption["id"] | null;
  detection: PlatformDetection;
  copy: LandingCopy["download"];
  onSelect: (id: AppDownloadOption["id"]) => void;
}

function getPlatformName(id: AppDownloadOption["id"]) {
  if (id.startsWith("mac")) return "macOS";
  return "Windows";
}

function getArchitectureName(id: AppDownloadOption["id"]) {
  if (id.endsWith("universal")) return "Universal";
  if (id.endsWith("arm64")) return "ARM64";
  return "x64";
}

export function PlatformSelector({
  options,
  selectedId,
  recommendedId,
  detection,
  copy,
  onSelect,
}: PlatformSelectorProps) {
  return (
    <div className="landing-platforms" aria-label={copy.chooseBuild}>
      <div className="landing-platforms-heading">
        <span>{copy.chooseBuild}</span>
        <small>
          {detection.platform === "other"
            ? copy.showAll
            : `${copy.detected}: ${detection.platform === "macos" ? "macOS" : "Windows"}`}
        </small>
      </div>
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
                <strong>
                  {getPlatformName(option.id)} {getArchitectureName(option.id)}
                </strong>
                <small>{option.description}</small>
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
