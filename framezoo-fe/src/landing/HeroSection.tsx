import { animated, useSpring } from "@react-spring/web";
import { type MouseEvent, useRef } from "react";

import { FRAMEZOO_DESKTOP_VERSION } from "./appVersion";
import type { LandingCopy } from "./i18n";

interface HeroSectionProps {
  copy: LandingCopy["hero"];
  onHashLinkClick: (event: MouseEvent<HTMLAnchorElement>) => void;
}

export function HeroSection({ copy, onHashLinkClick }: HeroSectionProps) {
  const screenshotRef = useRef<HTMLDivElement>(null);
  const [{ x }, api] = useSpring(() => ({
    x: 0,
    config: { tension: 180, friction: 20 },
  }));

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const element = screenshotRef.current;
    if (!element || event.pointerType === "touch") return;
    const bounds = element.getBoundingClientRect();
    api.start({
      x: ((event.clientX - bounds.left) / bounds.width - 0.5) * 10,
    });
  };

  const resetPointer = () => {
    api.start({ x: 0 });
  };

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

      <div
        ref={screenshotRef}
        className="landing-hero-visual landing-reveal landing-reveal-two"
        onPointerMove={handlePointerMove}
        onPointerLeave={resetPointer}
      >
        <animated.figure
          className="landing-screenshot-frame"
          style={{
            transform: x.to(
              (xValue) => `perspective(1200px) rotateY(${xValue}deg)`,
            ),
          }}
        >
          <div className="landing-window-bar" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <img src="/embed-preview-1.png" alt={copy.imageAlt} />
          <div className="landing-screenshot-glare" aria-hidden="true" />
        </animated.figure>
      </div>
    </section>
  );
}
