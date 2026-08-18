import { type MouseEvent } from "react";

import { FRAMEZOO_DESKTOP_VERSION } from "./appVersion";
import type { LandingCopy } from "./i18n";
import { MovieShowcaseSection } from "./MovieShowcaseSection";

interface HeroSectionProps {
  copy: LandingCopy["hero"];
  movieCopy: LandingCopy["movies"];
  onHashLinkClick: (event: MouseEvent<HTMLAnchorElement>) => void;
}

export function HeroSection({
  copy,
  movieCopy,
  onHashLinkClick,
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
        <span className="landing-app-version">v{FRAMEZOO_DESKTOP_VERSION}</span>
      </div>

      <div className="landing-hero-visual landing-reveal landing-reveal-two">
        <MovieShowcaseSection copy={movieCopy} variant="hero" />
      </div>
    </section>
  );
}
