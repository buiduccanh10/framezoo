import { useCallback, useEffect, useState } from "react";

import {
  type AppDownloadManifest,
  type AppDownloadOption,
  getAppDownloadManifest,
} from "@/backend/download";

import type { LandingCopy } from "./i18n";
import { detectPlatformForManifest } from "./platform";
import { PlatformSelector } from "./PlatformSelector";

interface DownloadSectionProps {
  backendUrl: string | null;
  copy: LandingCopy["download"];
}

type DownloadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "empty" }
  | { status: "ready"; manifest: AppDownloadManifest };

export function DownloadSection({ backendUrl, copy }: DownloadSectionProps) {
  const [state, setState] = useState<DownloadState>({ status: "loading" });
  const [selectedId, setSelectedId] = useState<AppDownloadOption["id"] | null>(
    null,
  );

  const loadManifest = useCallback(() => {
    if (!backendUrl) {
      setState({ status: "error", message: copy.noBackend });
      return;
    }

    setState({ status: "loading" });
    void getAppDownloadManifest(backendUrl)
      .then((manifest) => {
        if (manifest.options.length === 0) {
          setSelectedId(null);
          setState({ status: "empty" });
          return;
        }

        const recommendedId = detectPlatformForManifest(manifest).recommendedId;
        setSelectedId(recommendedId);
        setState({ status: "ready", manifest });
      })
      .catch((error: unknown) => {
        console.error("Failed to load desktop download manifest:", error);
        setState({
          status: "error",
          message: copy.error,
        });
      });
  }, [backendUrl, copy.error, copy.noBackend]);

  useEffect(() => {
    loadManifest();
  }, [loadManifest]);

  const selectedOption =
    state.status === "ready"
      ? (state.manifest.options.find((option) => option.id === selectedId) ??
        state.manifest.options[0])
      : null;

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
              onClick={loadManifest}
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
              onClick={loadManifest}
            >
              {copy.retry} <span aria-hidden="true">↗</span>
            </button>
          </div>
        ) : (
          <div className="landing-download-content">
            <PlatformSelector
              options={state.manifest.options}
              selectedId={selectedOption?.id ?? null}
              recommendedId={
                detectPlatformForManifest(state.manifest).recommendedId
              }
              detection={detectPlatformForManifest(state.manifest)}
              copy={copy}
              onSelect={setSelectedId}
            />
            <div className="landing-download-cta">
              <div>
                <span>{copy.version}</span>
                <strong>
                  {state.manifest.version
                    ? `v${state.manifest.version}`
                    : "Stable build"}
                </strong>
              </div>
              <a
                className="landing-button landing-button-primary"
                href={selectedOption?.url}
                target="_blank"
                rel="noreferrer"
              >
                {copy.download}
                <span aria-hidden="true">↓</span>
              </a>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
