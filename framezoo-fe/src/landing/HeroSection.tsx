import { type MouseEvent } from "react";

import type { LandingCopy } from "./i18n";
import { MovieShowcaseSection } from "./MovieShowcaseSection";

interface HeroSectionProps {
  copy: LandingCopy["hero"];
  movieCopy: LandingCopy["movies"];
  onHashLinkClick: (event: MouseEvent<HTMLAnchorElement>) => void;
  version: string | null;
}

export function HeroSection({
  copy,
  movieCopy,
  onHashLinkClick,
  version,
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
            <span aria-hidden="true">↗</span>
          </a>
          <a
            className="landing-button landing-button-quiet"
            href="#experience"
            onClick={onHashLinkClick}
          >
            {copy.secondaryCta}
          </a>
        </div>
        {version ? (
          <span className="landing-app-version">v{version}</span>
        ) : null}
      </div>

      <div className="landing-hero-visual landing-reveal landing-reveal-two">
        <MovieShowcaseSection copy={movieCopy} variant="hero" />
      </div>
    </section>
  );
}
