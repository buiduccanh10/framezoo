import { useEffect, useRef, useState } from "react";

import { getConfiguredBackendUrl } from "@/backend/download";

import { AddonGuideSection } from "./AddonGuideSection";
import { DownloadSection } from "./DownloadSection";
import { FeatureSection } from "./FeatureSection";
import {
  LANDING_LOCALE_STORAGE_KEY,
  type LandingLocale,
  getInitialLandingLocale,
  getLandingCopy,
  getLandingLocaleOption,
} from "./i18n";
import { LandingLanguageSelector } from "./LandingLanguageSelector";
import { LandingParticles } from "./LandingParticles";
import {
  type LandingSeoCategoryId,
  applyLandingSeo,
  getLandingSeoMetadata,
} from "./seo";
import { useLandingMotion } from "./useLandingMotion";
import "./landing.css";

interface LandingCategoryPageProps {
  category: LandingSeoCategoryId;
}

export function LandingCategoryPage({ category }: LandingCategoryPageProps) {
  const [locale, setLocale] = useState<LandingLocale>(getInitialLandingLocale);
  const shellRef = useRef<HTMLDivElement>(null);
  const activeCopy = getLandingCopy(locale);
  const metadata = getLandingSeoMetadata(locale, category);
  useLandingMotion(shellRef);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir =
      getLandingLocaleOption(locale)?.direction ?? "ltr";
    applyLandingSeo(locale, category);

    try {
      window.localStorage.setItem(LANDING_LOCALE_STORAGE_KEY, locale);
    } catch {
      // Storage can be unavailable in private browsing contexts.
    }
  }, [category, locale]);

  return (
    <div className="landing-shell" data-seo-category={category} ref={shellRef}>
      <div className="landing-ambient landing-ambient-one" aria-hidden="true" />
      <div className="landing-ambient landing-ambient-two" aria-hidden="true" />
      <LandingParticles />

      <header className="landing-nav">
        <a className="landing-brand" href="/" aria-label="Framezoo home">
          <img
            src="/framezoo-logo.svg"
            width="138"
            height="40"
            alt="Framezoo"
          />
        </a>
        <nav className="landing-nav-links" aria-label="Primary navigation">
          <a href="/">{activeCopy.nav.home}</a>
          <a href="/experience">{activeCopy.nav.features}</a>
          <a href="/ecosystem">{activeCopy.nav.addons}</a>
          <a href="/create-addon">{activeCopy.nav.addonGuide}</a>
          <a href="/download">{activeCopy.nav.download}</a>
          <LandingLanguageSelector
            locale={locale}
            label={activeCopy.nav.language}
            onChange={setLocale}
          />
        </nav>
      </header>

      <main className="landing-category-main">
        <header className="landing-category-intro">
          <span className="landing-eyebrow">FRAMEZOO</span>
          <h1>{metadata.title.replace(" | Framezoo", "")}</h1>
          <p>{metadata.description}</p>
        </header>

        {category === "experience" && (
          <FeatureSection copy={activeCopy.features} variant="experience" />
        )}
        {category === "ecosystem" && (
          <FeatureSection copy={activeCopy.features} variant="ecosystem" />
        )}
        {category === "create-addon" && (
          <AddonGuideSection copy={activeCopy.addonGuide} />
        )}
        {category === "download" && (
          <DownloadSection
            backendUrl={getConfiguredBackendUrl()}
            copy={activeCopy.download}
          />
        )}
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
    </div>
  );
}
