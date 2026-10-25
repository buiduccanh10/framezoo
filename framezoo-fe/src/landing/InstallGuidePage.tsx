import { useEffect, useState } from "react";

import { getConfiguredBackendUrl } from "@/backend/download";

import { DownloadSection } from "./DownloadSection";
import {
  LANDING_LOCALE_STORAGE_KEY,
  type LandingLocale,
  getInitialLandingLocale,
  getLandingCopy,
  getLandingLocaleOption,
} from "./i18n";
import { LandingLanguageSelector } from "./LandingLanguageSelector";
import { LandingParticles } from "./LandingParticles";
import { useDownloadManifest } from "./useDownloadManifest";

export function InstallGuidePage() {
  const [locale, setLocale] = useState<LandingLocale>(getInitialLandingLocale);
  const [activeTab, setActiveTab] = useState<"mac" | "win">(() => {
    if (typeof window !== "undefined") {
      const hash = window.location.hash.toLowerCase();
      if (hash.includes("win")) return "win";
      if (hash.includes("mac")) return "mac";
      if (
        navigator.userAgent.includes("Windows") ||
        navigator.userAgent.includes("Win32")
      ) {
        return "win";
      }
    }
    return "mac";
  });

  const activeCopy = getLandingCopy(locale);
  const backendUrl = getConfiguredBackendUrl();
  const { state: downloadState, loadManifest } = useDownloadManifest(
    backendUrl,
    {
      error: activeCopy.download.error,
      noBackend: activeCopy.download.noBackend,
    },
  );

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir =
      getLandingLocaleOption(locale)?.direction ?? "ltr";

    try {
      window.localStorage.setItem(LANDING_LOCALE_STORAGE_KEY, locale);
    } catch {
      // Storage unavailable in private browsing
    }
  }, [locale]);

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.toLowerCase();
      if (hash.includes("win")) setActiveTab("win");
      else if (hash.includes("mac")) setActiveTab("mac");
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const guide = activeCopy.installGuide;

  return (
    <div className="landing-shell landing-guide-shell">
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
        <nav className="landing-nav-links" aria-label="Navigation">
          <a href="/">{guide.backHome}</a>
          <a href="/#download">{guide.downloadApp}</a>
          <LandingLanguageSelector
            locale={locale}
            label={activeCopy.nav.language}
            onChange={setLocale}
          />
        </nav>
      </header>

      <main className="install-guide-main">
        <div className="install-guide-header">
          <span className="landing-eyebrow">Documentation</span>
          <h1 className="install-guide-title">{guide.title}</h1>
          <p className="install-guide-subtitle">{guide.subtitle}</p>

          <div
            className="install-guide-tabs"
            role="tablist"
            aria-label="Operating System Selection"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "mac"}
              className={`install-guide-tab ${activeTab === "mac" ? "is-active" : ""}`}
              onClick={() => {
                setActiveTab("mac");
                window.location.hash = "mac";
              }}
            >
               {guide.macTab}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "win"}
              className={`install-guide-tab ${activeTab === "win" ? "is-active" : ""}`}
              onClick={() => {
                setActiveTab("win");
                window.location.hash = "windows";
              }}
            >
              ⊞ {guide.winTab}
            </button>
          </div>
        </div>

        {activeTab === "mac" ? (
          <section className="install-guide-content" id="mac">
            <div className="install-guide-card">
              <div className="install-guide-card-header">
                <span className="install-guide-step-badge">1</span>
                <div>
                  <h2>{guide.mac.step1Title}</h2>
                  <p>{guide.mac.step1Desc}</p>
                </div>
              </div>
              <div className="install-guide-mockup mac-dmg-mockup">
                <div className="mockup-row">
                  <div className="mockup-item">
                    <img
                      src="/framezoo-app-icon.png"
                      alt="Framezoo"
                      className="mockup-app-icon"
                      width="58"
                      height="58"
                    />
                    <span className="mockup-label">Framezoo</span>
                  </div>
                  <span className="mockup-arrow">➔</span>
                  <div className="mockup-item">
                    <svg
                      className="mockup-folder-icon"
                      width="58"
                      height="58"
                      viewBox="0 0 64 64"
                      fill="none"
                      aria-label="Applications Folder"
                    >
                      <path
                        d="M6 18C6 14.6863 8.68629 12 12 12H24.5858C26.1771 12 27.7033 12.6321 28.8284 13.7574L32 16.9289C33.1251 18.0542 34.6513 18.6863 36.2426 18.6863H52C55.3137 18.6863 58 21.3726 58 24.6863V48C58 51.3137 55.3137 54 52 54H12C8.68629 54 6 51.3137 6 48V18Z"
                        fill="url(#folderGradBack)"
                      />
                      <path
                        d="M4 26C4 22.6863 6.68629 20 10 20H54C57.3137 20 60 22.6863 60 26V48C60 51.3137 57.3137 54 54 54H10C6.68629 54 4 51.3137 4 48V26Z"
                        fill="url(#folderGradFront)"
                      />
                      <defs>
                        <linearGradient id="folderGradBack" x1="6" y1="12" x2="58" y2="54" gradientUnits="userSpaceOnUse">
                          <stop stopColor="#5AC8FA" />
                          <stop offset="1" stopColor="#007AFF" />
                        </linearGradient>
                        <linearGradient id="folderGradFront" x1="4" y1="20" x2="60" y2="54" gradientUnits="userSpaceOnUse">
                          <stop stopColor="#64D2FF" />
                          <stop offset="1" stopColor="#0A84FF" />
                        </linearGradient>
                      </defs>
                    </svg>
                    <span className="mockup-label">Applications</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="install-guide-card is-warning">
              <div className="install-guide-card-header">
                <span className="install-guide-step-badge">⚠️</span>
                <div>
                  <h2>{guide.mac.step2Title}</h2>
                  <p>{guide.mac.step2Desc}</p>
                </div>
              </div>
              <div className="install-guide-dialog-box">
                <div className="dialog-box-title">
                  &ldquo;Framezoo&rdquo; is damaged and can&rsquo;t be opened.
                </div>
                <div className="dialog-box-desc">
                  Apple cannot check it for malicious software. This happens
                  when an app is downloaded outside the Mac App Store without an
                  annual commercial certificate.
                </div>
              </div>
            </div>

            <div className="install-guide-card is-solution">
              <div className="install-guide-card-header">
                <span className="install-guide-step-badge">2</span>
                <div>
                  <h2>{guide.mac.step3Title}</h2>
                  <p className="install-guide-highlight">
                    Giải pháp nhanh: Mở qua Menu chuột phải Finder
                  </p>
                </div>
              </div>

              <ol className="install-guide-steps-list">
                {guide.mac.step3Steps.map((step, idx) => (
                  <li key={idx} className="install-guide-step-item">
                    <span className="step-num">{idx + 1}</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>

              <div className="install-guide-terminal-tip">
                <p>
                  <strong>💡 Cách dự phòng qua Terminal:</strong> Nếu bạn vẫn bị
                  chặn, mở Terminal và chạy lệnh:
                </p>
                <code>xattr -cr /Applications/Framezoo.app</code>
              </div>

              <div className="install-guide-note">
                <span className="note-icon">ℹ️</span>
                <p>{guide.mac.note}</p>
              </div>
            </div>
          </section>
        ) : (
          <section className="install-guide-content" id="windows">
            <div className="install-guide-card">
              <div className="install-guide-card-header">
                <span className="install-guide-step-badge">1</span>
                <div>
                  <h2>{guide.win.step1Title}</h2>
                  <p>{guide.win.step1Desc}</p>
                </div>
              </div>
            </div>

            <div className="install-guide-card is-warning">
              <div className="install-guide-card-header">
                <span className="install-guide-step-badge">⚠️</span>
                <div>
                  <h2>{guide.win.step2Title}</h2>
                  <p>{guide.win.step2Desc}</p>
                </div>
              </div>
              <div className="install-guide-dialog-box win-smartscreen-box">
                <div className="smartscreen-banner">
                  Windows protected your PC
                </div>
                <div className="smartscreen-text">
                  Microsoft Defender SmartScreen prevented an unrecognized app
                  from starting. Running this app might put your PC at risk.
                </div>
                <div className="smartscreen-actions">
                  <span className="smartscreen-link">
                    <u>More info</u> (Bấm vào đây)
                  </span>
                </div>
              </div>
            </div>

            <div className="install-guide-card is-solution">
              <div className="install-guide-card-header">
                <span className="install-guide-step-badge">2</span>
                <div>
                  <h2>{guide.win.step3Title}</h2>
                  <p className="install-guide-highlight">
                    Bấm More info &rarr; Run anyway
                  </p>
                </div>
              </div>

              <ol className="install-guide-steps-list">
                {guide.win.step3Steps.map((step, idx) => (
                  <li key={idx} className="install-guide-step-item">
                    <span className="step-num">{idx + 1}</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>

              <div className="install-guide-note">
                <span className="note-icon">ℹ️</span>
                <p>{guide.win.note}</p>
              </div>
            </div>
          </section>
        )}

        <div className="install-guide-download-cta">
          <DownloadSection
            copy={activeCopy.download}
            fullCopy={activeCopy}
            onRetry={loadManifest}
            state={downloadState}
          />
        </div>
      </main>

      <footer className="landing-footer">
        <div>
          <nav className="landing-footer-nav" aria-label="Footer navigation">
            <a href="/">{activeCopy.nav.home}</a>
            <a href="/experience">{activeCopy.nav.features}</a>
            <a href="/ecosystem">{activeCopy.nav.addons}</a>
            <a href="/create-addon">{activeCopy.nav.addonGuide}</a>
            <a href="/#download">{activeCopy.nav.download}</a>
          </nav>
          <p>{activeCopy.footer.line}</p>
        </div>
      </footer>
    </div>
  );
}
