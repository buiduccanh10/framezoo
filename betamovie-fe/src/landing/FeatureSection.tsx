import { animated, useSpring } from "@react-spring/web";
import { useEffect, useState } from "react";

import type { LandingCopy } from "./i18n";

interface FeatureSectionProps {
  copy: LandingCopy["features"];
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = () => setReduced(mediaQuery.matches);
    handleChange();
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  return reduced;
}

export function FeatureSection({ copy }: FeatureSectionProps) {
  const reducedMotion = useReducedMotion();
  const reveal = useSpring({
    from: { opacity: reducedMotion ? 1 : 0, y: reducedMotion ? 0 : 28 },
    opacity: 1,
    y: 0,
    delay: reducedMotion ? 0 : 180,
    config: { tension: 140, friction: 22 },
  });

  return (
    <section className="landing-features" id="performance">
      <div className="landing-section-heading landing-reveal landing-reveal-one">
        <span className="landing-eyebrow">02 / {copy.playback}</span>
        <h2>{copy.performanceTitle}</h2>
        <p>{copy.overviewDescription}</p>
      </div>

      <div className="landing-feature-grid">
        <animated.article
          className="landing-feature-card landing-feature-card-tall"
          style={reveal}
        >
          <div className="landing-feature-index">01</div>
          <div>
            <span className="landing-feature-glyph" aria-hidden="true">
              ◌
            </span>
            <h3>{copy.playback}</h3>
            <p>{copy.playbackDescription}</p>
          </div>
          <div className="landing-feature-wave" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
        </animated.article>

        <div className="landing-feature-stack">
          <article className="landing-feature-line">
            <span className="landing-feature-index">02</span>
            <div>
              <h3>{copy.performance}</h3>
              <p>{copy.performanceDescription}</p>
            </div>
            <span className="landing-feature-arrow" aria-hidden="true">
              ↗
            </span>
          </article>
          <article className="landing-feature-line">
            <span className="landing-feature-index">03</span>
            <div>
              <h3>{copy.continuity}</h3>
              <p>{copy.continuityDescription}</p>
            </div>
            <span className="landing-feature-arrow" aria-hidden="true">
              ↗
            </span>
          </article>
        </div>
      </div>

      <div className="landing-ecosystem" id="ecosystem">
        <div className="landing-ecosystem-copy">
          <span className="landing-eyebrow">{copy.addonLabel}</span>
          <h2>{copy.ecosystemTitle}</h2>
          <p>{copy.ecosystemDescription}</p>
        </div>
        <div className="landing-addon-orbit" aria-hidden="true">
          <span className="landing-orbit-ring landing-orbit-ring-one" />
          <span className="landing-orbit-ring landing-orbit-ring-two" />
          <span className="landing-orbit-core">A</span>
          <span className="landing-addon-tag landing-addon-tag-one">
            {copy.addonOne}
          </span>
          <span className="landing-addon-tag landing-addon-tag-two">
            {copy.addonTwo}
          </span>
          <span className="landing-addon-tag landing-addon-tag-three">
            {copy.addonThree}
          </span>
        </div>
      </div>

      <div className="landing-showcase">
        <div className="landing-showcase-image">
          <img src="/embed-preview.png" alt="" loading="lazy" />
          <span>{copy.showcaseCaption}</span>
        </div>
        <div className="landing-showcase-copy">
          <span className="landing-showcase-number">03</span>
          <h2>{copy.showcaseTitle}</h2>
          <p>{copy.showcaseDescription}</p>
        </div>
      </div>
    </section>
  );
}
