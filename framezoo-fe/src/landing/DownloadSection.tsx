import type { LandingCopy } from "./i18n";
import { detectPlatformForManifest } from "./platform";
import { PlatformSelector } from "./PlatformSelector";
import type { DownloadState } from "./useDownloadManifest";

interface DownloadSectionProps {
  copy: LandingCopy["download"];
  onRetry: () => void;
  state: DownloadState;
}

export function DownloadSection({
  copy,
  onRetry,
  state,
}: DownloadSectionProps) {
  const detection =
    state.status === "ready" ? detectPlatformForManifest(state.manifest) : null;

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
          <div className="landing-download-state" role="status">
            <span className="landing-state-pulse" aria-hidden="true" />
            {copy.loading}
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
              {copy.retry} <span aria-hidden="true">↗</span>
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
              {copy.retry} <span aria-hidden="true">↗</span>
            </button>
          </div>
        ) : (
          <PlatformSelector
            options={state.manifest.options}
            recommendedId={detection?.recommendedId ?? null}
            copy={copy}
          />
        )}
      </div>
    </section>
  );
}
