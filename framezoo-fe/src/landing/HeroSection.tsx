import { type MouseEvent } from "react";

import type { LandingCopy } from "./i18n";
import { ArrowUpRightIcon, DownloadIcon } from "./LandingIcon";
import { MovieShowcaseSection } from "./MovieShowcaseSection";

export function formatDownloadCount(count: number): string {
  if (count >= 1000) {
    const inK = (count / 1000).toFixed(1).replace(/\.0$/, "");
    return `${inK}k+`;
  }
  if (count >= 100) {
    return `${Math.floor(count / 10) * 10}+`;
  }
  return `${count}+`;
}

interface HeroSectionProps {
  copy: LandingCopy["hero"];
  movieCopy: LandingCopy["movies"];
  onHashLinkClick: (event: MouseEvent<HTMLAnchorElement>) => void;
  version: string | null;
  totalDownloads?: number | null;
  isMetaLoading?: boolean;
}

export function HeroSection({
  copy,
  movieCopy,
  onHashLinkClick,
  version,
  totalDownloads,
  isMetaLoading = false,
}: HeroSectionProps) {
  return (
    <section className="landing-hero" aria-labelledby="hero-title">
      <div className="landing-hero-copy landing-reveal landing-reveal-one">
        <h1 id="hero-title">
          {copy.title} <span>{copy.titleAccent}</span>
        </h1>
        <p>{copy.description}</p>
        <div className="landing-hero-actions">
          <a
            className="landing-button landing-button-primary"
            href="#download"
            onClick={onHashLinkClick}
          >
            {copy.primaryCta}
            <ArrowUpRightIcon />
          </a>
          <a
            className="landing-button landing-button-quiet"
            href="#experience"
            onClick={onHashLinkClick}
          >
            {copy.secondaryCta}
          </a>
        </div>
        {isMetaLoading ? (
          <div
            className="landing-hero-meta landing-hero-meta-skeleton"
            aria-hidden="true"
          >
            <span className="landing-skeleton landing-hero-meta-skeleton-version" />
            <span className="landing-hero-meta-dot">•</span>
            <span className="landing-skeleton landing-hero-meta-skeleton-downloads" />
          </div>
        ) : version || totalDownloads ? (
          <div className="landing-hero-meta">
            {version ? (
              <span className="landing-app-version">v{version}</span>
            ) : null}
            {version && totalDownloads ? (
              <span className="landing-hero-meta-dot" aria-hidden="true">
                •
              </span>
            ) : null}
            {totalDownloads ? (
              <span className="landing-hero-downloads">
                <DownloadIcon className="landing-hero-downloads-icon" />
                <span>
                  {formatDownloadCount(totalDownloads)}{" "}
                  {copy.downloads ?? "lượt tải"}
                </span>
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="landing-hero-visual landing-reveal landing-reveal-two">
        <MovieShowcaseSection copy={movieCopy} variant="hero" />
      </div>
    </section>
  );
}
