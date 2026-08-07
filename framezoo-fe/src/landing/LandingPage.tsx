import { type MouseEvent, useEffect, useRef, useState } from "react";

import { getConfiguredBackendUrl } from "@/backend/download";

import { AddonGuideSection } from "./AddonGuideSection";
import { DownloadSection } from "./DownloadSection";
import { FeatureSection } from "./FeatureSection";
import {
  getLandingHashId,
  navigateToLandingHash,
  scrollToLandingHash,
} from "./hashScroll";
import { HeroSection } from "./HeroSection";
import {
  LANDING_LOCALE_STORAGE_KEY,
  type LandingLocale,
  getInitialLandingLocale,
  getLandingCopy,
  getLandingLocaleOption,
} from "./i18n";
import { LandingLanguageSelector } from "./LandingLanguageSelector";
import { LandingParticles } from "./LandingParticles";
import "./landing.css";

export function LandingPage() {
  const [locale, setLocale] = useState<LandingLocale>(getInitialLandingLocale);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const activeCopy = getLandingCopy(locale);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir =
      getLandingLocaleOption(locale)?.direction ?? "ltr";

    try {
      window.localStorage.setItem(LANDING_LOCALE_STORAGE_KEY, locale);
    } catch {
      // Storage can be unavailable in private browsing contexts.
    }
  }, [locale]);

  useEffect(() => {
    const handleHashChange = () => {
      window.requestAnimationFrame(() => {
        scrollToLandingHash(window.location.hash, "smooth");
      });
    };

    window.requestAnimationFrame(() => {
      scrollToLandingHash(window.location.hash, "instant");
    });
    window.addEventListener("hashchange", handleHashChange);
    window.addEventListener("popstate", handleHashChange);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
      window.removeEventListener("popstate", handleHashChange);
    };
  }, []);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    const revealNodes = Array.from(
      shell.querySelectorAll<HTMLElement>(".landing-scroll-reveal"),
    );
    shell.classList.add("is-motion-ready");

    if (typeof IntersectionObserver === "undefined") {
      revealNodes.forEach((node) => node.classList.add("is-visible"));
      return () => shell.classList.remove("is-motion-ready");
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      {
        rootMargin: "0px 0px -10% 0px",
        threshold: 0.16,
      },
    );

    revealNodes.forEach((node) => observer.observe(node));
    return () => {
      observer.disconnect();
      shell.classList.remove("is-motion-ready");
    };
  }, []);

  useEffect(() => {
    const sentinel = topSentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      ([entry]) => setShowBackToTop(!entry.isIntersecting),
      { threshold: 0 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  const handleLandingHashClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    const href = event.currentTarget.getAttribute("href");
    const id = href?.startsWith("#") ? getLandingHashId(href) : null;
    if (!href || !id || !document.getElementById(id)) return;

    event.preventDefault();
    navigateToLandingHash(href);
  };

  return (
    <div className="landing-shell" ref={shellRef}>
      <div className="landing-ambient landing-ambient-one" aria-hidden="true" />
      <div className="landing-ambient landing-ambient-two" aria-hidden="true" />
      <LandingParticles />

      <header className="landing-nav">
        <a
          className="landing-brand"
          href="#top"
          aria-label="FrameZoo home"
          onClick={handleLandingHashClick}
        >
          <img
            src="/framezoo-logo.svg"
            width="138"
            height="40"
            alt="FrameZoo"
          />
        </a>
        <nav className="landing-nav-links" aria-label="Primary navigation">
          <a href="#experience" onClick={handleLandingHashClick}>
            {activeCopy.nav.features}
          </a>
          <a href="#ecosystem" onClick={handleLandingHashClick}>
            {activeCopy.nav.addons}
          </a>
          <a href="#addon-guide" onClick={handleLandingHashClick}>
            {activeCopy.nav.addonGuide}
          </a>
          <a href="#download" onClick={handleLandingHashClick}>
            {activeCopy.nav.download}
          </a>
          <LandingLanguageSelector
            locale={locale}
            label={activeCopy.nav.language}
            onChange={setLocale}
          />
        </nav>
      </header>

      <main id="top">
        <div
          ref={topSentinelRef}
          className="landing-top-sentinel"
          aria-hidden="true"
        />
        <HeroSection
          copy={activeCopy.hero}
          onHashLinkClick={handleLandingHashClick}
        />
        <FeatureSection copy={activeCopy.features} />
        <AddonGuideSection copy={activeCopy.addonGuide} />
        <DownloadSection
          backendUrl={getConfiguredBackendUrl()}
          copy={activeCopy.download}
        />
      </main>

      <footer className="landing-footer">
        <div>
          <p>{activeCopy.footer.line}</p>
        </div>
      </footer>

      <button
        className={`landing-back-to-top${showBackToTop ? " is-visible" : ""}`}
        type="button"
        aria-label="Back to top"
        aria-hidden={!showBackToTop}
        tabIndex={showBackToTop ? 0 : -1}
        onClick={() => navigateToLandingHash("#top")}
      >
        <span aria-hidden="true">↑</span>
      </button>
    </div>
  );
}
