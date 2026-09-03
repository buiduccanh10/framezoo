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
import { applyLandingSeo } from "./seo";
import { useDownloadManifest } from "./useDownloadManifest";
import { useLandingMotion } from "./useLandingMotion";
import "./landing.css";

export function LandingPage() {
  const [locale, setLocale] = useState<LandingLocale>(getInitialLandingLocale);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const activeCopy = getLandingCopy(locale);
  const backendUrl = getConfiguredBackendUrl();
  const { state: downloadState, loadManifest } = useDownloadManifest(
    backendUrl,
    {
      error: activeCopy.download.error,
      noBackend: activeCopy.download.noBackend,
    },
  );
  useLandingMotion(shellRef);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir =
      getLandingLocaleOption(locale)?.direction ?? "ltr";
    applyLandingSeo(locale);

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
    const scrollTarget =
      event.currentTarget.dataset.scrollTarget ??
      (href?.startsWith("#") ? href : null);
    const id = scrollTarget ? getLandingHashId(scrollTarget) : null;
    if (!scrollTarget || !id || !document.getElementById(id)) return;

    event.preventDefault();
    navigateToLandingHash(scrollTarget);
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
          aria-label="Framezoo home"
          onClick={handleLandingHashClick}
        >
          <img
            src="/framezoo-logo.svg"
            width="138"
            height="40"
            alt="Framezoo"
          />
        </a>
        <nav className="landing-nav-links" aria-label="Primary navigation">
          <a
            href="/"
            data-scroll-target="#top"
            onClick={handleLandingHashClick}
          >
            {activeCopy.nav.home}
          </a>
          <a
            href="/experience"
            data-scroll-target="#experience"
            onClick={handleLandingHashClick}
          >
            {activeCopy.nav.features}
          </a>
          <a
            href="/ecosystem"
            data-scroll-target="#ecosystem"
            onClick={handleLandingHashClick}
          >
            {activeCopy.nav.addons}
          </a>
          <a
            href="/create-addon"
            data-scroll-target="#addon-guide"
            onClick={handleLandingHashClick}
          >
            {activeCopy.nav.addonGuide}
          </a>
          <a
            href="/download"
            data-scroll-target="#download"
            onClick={handleLandingHashClick}
          >
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
        <div className="landing-home">
          <HeroSection
            copy={activeCopy.hero}
            movieCopy={activeCopy.movies}
            onHashLinkClick={handleLandingHashClick}
            version={
              downloadState.status === "ready"
                ? downloadState.manifest.version
                : null
            }
          />
        </div>
        <FeatureSection copy={activeCopy.features} />
        <AddonGuideSection copy={activeCopy.addonGuide} />
        <DownloadSection
          copy={activeCopy.download}
          onRetry={loadManifest}
          state={downloadState}
        />
      </main>

      <footer className="landing-footer">
        <div>
          <nav className="landing-footer-nav" aria-label="Footer navigation">
            <a href="/">{activeCopy.nav.home}</a>
            <a href="/experience">{activeCopy.nav.features}</a>
            <a href="/ecosystem">{activeCopy.nav.addons}</a>
            <a href="/create-addon">{activeCopy.nav.addonGuide}</a>
            <a href="/download">{activeCopy.nav.download}</a>
          </nav>
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
