import { animated, useSpring } from "@react-spring/web";
import { useRef } from "react";

import type { LandingCopy } from "./i18n";

interface HeroSectionProps {
  copy: LandingCopy["hero"];
}

export function HeroSection({ copy }: HeroSectionProps) {
  const screenshotRef = useRef<HTMLDivElement>(null);
  const [{ x, y }, api] = useSpring(() => ({
    x: 0,
    y: 0,
    config: { tension: 180, friction: 20 },
  }));

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const element = screenshotRef.current;
    if (!element || event.pointerType === "touch") return;
    const bounds = element.getBoundingClientRect();
    api.start({
      x: ((event.clientX - bounds.left) / bounds.width - 0.5) * 10,
      y: ((event.clientY - bounds.top) / bounds.height - 0.5) * -8,
    });
  };

  const resetPointer = () => {
    api.start({ x: 0, y: 0 });
  };

  return (
    <section className="landing-hero" aria-labelledby="hero-title">
      <div className="landing-hero-copy landing-reveal landing-reveal-one">
        <span className="landing-eyebrow">{copy.eyebrow}</span>
        <h1 id="hero-title">
          {copy.title} <span>{copy.titleAccent}</span>
        </h1>
        <p>{copy.description}</p>
        <div className="landing-hero-actions">
          <a className="landing-button landing-button-primary" href="#download">
            {copy.primaryCta}
            <span aria-hidden="true">↗</span>
          </a>
          <a
            className="landing-button landing-button-quiet"
            href="#performance"
          >
            {copy.secondaryCta}
          </a>
        </div>
        <div className="landing-hero-meta">
          <span className="landing-live-dot" aria-hidden="true" />
          <span>{copy.version}</span>
          <span className="landing-meta-divider" aria-hidden="true" />
          <span>macOS / Windows</span>
        </div>
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
            <small>ALPHAFLIX DESKTOP</small>
          </div>
          <img src="/embed-preview.png" alt={copy.imageAlt} />
          <div className="landing-screenshot-glare" aria-hidden="true" />
        </animated.figure>
        <animated.span
          className="landing-visual-label landing-visual-label-top"
          style={{ transform: y.to((value) => `translateY(${value}px)`) }}
        >
          NATIVE / 01
        </animated.span>
        <animated.span
          className="landing-visual-label landing-visual-label-bottom"
          style={{ transform: y.to((value) => `translateY(${-value}px)`) }}
        >
          FOCUS / 24
        </animated.span>
      </div>
    </section>
  );
}
