import { useEffect, useState } from "react";

import { getConfiguredBackendUrl } from "@/backend/download";

import { DownloadSection } from "./DownloadSection";
import { FeatureSection } from "./FeatureSection";
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

  return (
    <div className="landing-shell">
      <div className="landing-ambient landing-ambient-one" aria-hidden="true" />
      <div className="landing-ambient landing-ambient-two" aria-hidden="true" />
      <LandingParticles />

      <header className="landing-nav">
        <a className="landing-brand" href="#top" aria-label="AlphaFlix home">
          <img
            src="/alphaflix-logo.svg"
            width="138"
            height="40"
            alt="AlphaFlix"
          />
        </a>
        <nav className="landing-nav-links" aria-label="Primary navigation">
          <a href="#performance">{activeCopy.nav.features}</a>
          <a href="#ecosystem">{activeCopy.nav.addons}</a>
          <a href="#download">{activeCopy.nav.download}</a>
          <LandingLanguageSelector
            locale={locale}
            label={activeCopy.nav.language}
            onChange={setLocale}
          />
        </nav>
      </header>

      <main id="top">
        <HeroSection copy={activeCopy.hero} />
        <FeatureSection copy={activeCopy.features} />
        <DownloadSection
          backendUrl={getConfiguredBackendUrl()}
          copy={activeCopy.download}
        />
      </main>

      <footer className="landing-footer">
        <div>
          <span className="landing-footer-kicker">ALPHAFLIX DESKTOP</span>
          <p>{activeCopy.footer.line}</p>
        </div>
        <span>{activeCopy.footer.status}</span>
      </footer>
    </div>
  );
}
