import type { LandingCopy } from "./i18n";
import { ArrowUpRightIcon } from "./LandingIcon";
import { usePlatformDetection } from "./platform";
import { PlatformSelector } from "./PlatformSelector";
import type { DownloadState } from "./useDownloadManifest";

interface DownloadSectionProps {
  copy: LandingCopy["download"];
  fullCopy?: LandingCopy;
  onRetry: () => void;
  state: DownloadState;
}

export function DownloadSection({
  copy,
  fullCopy,
  onRetry,
  state,
}: DownloadSectionProps) {
  const manifest = state.status === "ready" ? state.manifest : null;
  const detection = usePlatformDetection(manifest);

  return (
    <section className="landing-download" id="download">
      <div className="landing-download-header landing-scroll-reveal">
        <div>
          <span className="landing-eyebrow">{copy.eyebrow}</span>
          <h2>{copy.title}</h2>
        </div>
        <p>{copy.description}</p>
      </div>

      <div className="landing-download-content landing-scroll-reveal landing-scroll-reveal-delay-one">
        {state.status === "loading" ? (
          <div
            className="landing-platforms"
            role="status"
            aria-label={copy.loading}
          >
            <div className="landing-platform-grid" aria-hidden="true">
              {Array.from({ length: 4 }, (_, index) => (
                <div
                  className="landing-platform-card landing-platform-card-skeleton"
                  key={`platform-skeleton-${index}`}
                >
                  <span className="landing-platform-copy">
                    <span className="landing-skeleton landing-skeleton-platform-title" />
                    <span className="landing-skeleton landing-skeleton-platform-sub" />
                  </span>
                  <span className="landing-skeleton landing-skeleton-platform-action" />
                </div>
              ))}
            </div>
          </div>
        ) : state.status === "error" ? (
          <div
            className="landing-download-state landing-download-error"
            role="alert"
          >
            <span>{state.message}</span>
            <button
              className="landing-text-button"
              type="button"
              onClick={onRetry}
            >
              {copy.retry} <ArrowUpRightIcon />
            </button>
          </div>
        ) : state.status === "empty" ? (
          <div className="landing-download-state" role="status">
            {copy.empty}
            <button
              className="landing-text-button"
              type="button"
              onClick={onRetry}
            >
              {copy.retry} <ArrowUpRightIcon />
            </button>
          </div>
        ) : (
          <PlatformSelector
            options={state.manifest.options}
            recommendedId={detection.recommendedId}
            copy={copy}
            fullCopy={fullCopy}
          />
        )}
      </div>
    </section>
  );
}
