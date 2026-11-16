import { useEffect, useState } from "react";

import {
  LANDING_LOCALE_STORAGE_KEY,
  type LandingLocale,
  getInitialLandingLocale,
  getLandingCopy,
  getLandingLocaleOption,
} from "./i18n";
import { LandingFooter, triggerLandingFeedback } from "./LandingFooter";
import { LandingLanguageSelector } from "./LandingLanguageSelector";
import { LandingParticles } from "./LandingParticles";
import { LEGAL_OPERATOR } from "./legalOperator";
import { applyPageSeo } from "./seo";
import "./landing.css";

export type LegalTabId = "terms" | "privacy" | "copyright" | "addon-policy";

export function getLegalTabFromPathname(pathname: string): LegalTabId | null {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (
    normalized === "/legal" ||
    normalized === "/legal/terms" ||
    normalized === "/terms"
  ) {
    return "terms";
  }
  if (normalized === "/legal/privacy" || normalized === "/privacy") {
    return "privacy";
  }
  if (
    normalized === "/legal/copyright" ||
    normalized === "/legal/dmca" ||
    normalized === "/legal/disclaimer" ||
    normalized === "/copyright" ||
    normalized === "/dmca" ||
    normalized === "/disclaimer"
  ) {
    return "copyright";
  }
  if (normalized === "/legal/addon-policy" || normalized === "/addon-policy") {
    return "addon-policy";
  }
  return null;
}

export function LegalPage({
  initialTab = "terms",
}: {
  initialTab?: LegalTabId;
}) {
  const [locale, setLocale] = useState<LandingLocale>(getInitialLandingLocale);
  const [activeTab, setActiveTab] = useState<LegalTabId>(initialTab);
  const activeCopy = getLandingCopy(locale);
  const catalog = activeCopy.legal;
  const activeDocument = catalog.tabs[activeTab];

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir =
      getLandingLocaleOption(locale)?.direction ?? "ltr";
    applyPageSeo(locale, {
      title: `${activeDocument.title} | Framezoo`,
      description: activeDocument.summary,
      path: `/legal/${activeTab}`,
    });

    try {
      window.localStorage.setItem(LANDING_LOCALE_STORAGE_KEY, locale);
    } catch {
      // Storage unavailable
    }
  }, [activeDocument.summary, activeDocument.title, activeTab, locale]);

  const handleSelectTab = (tab: LegalTabId) => {
    setActiveTab(tab);
    if (typeof window !== "undefined") {
      window.history.pushState({}, "", `/legal/${tab}`);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return (
    <div className="landing-shell landing-legal-shell">
      <div className="landing-ambient landing-ambient-one" aria-hidden="true" />
      <div className="landing-ambient landing-ambient-two" aria-hidden="true" />
      <LandingParticles />

      <header className="landing-nav">
        <a
          className="landing-brand"
          href="/"
          aria-label={activeCopy.nav.homeAria}
        >
          <img
            src="/framezoo-logo.svg"
            width="138"
            height="40"
            alt="Framezoo"
          />
        </a>
        <nav
          className="landing-nav-links"
          aria-label={activeCopy.nav.primaryAria}
        >
          <a href="/">{activeCopy.nav.home}</a>
          <a href="/experience">{activeCopy.nav.features}</a>
          <a href="/ecosystem">{activeCopy.nav.addons}</a>
          <a href="/create-addon">{activeCopy.nav.addonGuide}</a>
          <a href="/download">{activeCopy.nav.download}</a>
          <a href="/guide/install">{activeCopy.nav.installGuide}</a>
          <LandingLanguageSelector
            locale={locale}
            label={activeCopy.nav.language}
            onChange={setLocale}
          />
        </nav>
      </header>

      <main className="legal-page-main">
        <header className="legal-page-header">
          <span className="landing-eyebrow">{catalog.eyebrow}</span>
          <h1>{catalog.pageTitle}</h1>
          <p>{catalog.pageSubtitle}</p>

          <div
            className="legal-page-tabs"
            role="tablist"
            aria-label={activeCopy.footer.legalTitle}
          >
            {(
              [
                ["terms", activeCopy.footer.terms],
                ["privacy", activeCopy.footer.privacy],
                ["copyright", activeCopy.footer.copyright],
                ["addon-policy", activeCopy.footer.addonPolicy],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={activeTab === id}
                className={`legal-page-tab ${activeTab === id ? "is-active" : ""}`}
                onClick={() => handleSelectTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </header>

        <article className="legal-document-card">
          <header className="legal-document-header">
            <span className="legal-document-updated">
              {activeDocument.updatedAt}
            </span>
            <h2>{activeDocument.title}</h2>
            <p className="legal-document-summary">{activeDocument.summary}</p>
          </header>

          <div
            className="legal-section-block"
            style={{
              marginBottom: "1.5rem",
              padding: "1rem 1.25rem",
              borderRadius: "0.75rem",
              background: "rgba(255, 255, 255, 0.03)",
              border: "1px solid var(--landing-line)",
              fontSize: "0.9rem",
              lineHeight: 1.65,
            }}
          >
            <strong style={{ display: "block", marginBottom: "0.35rem" }}>
              {locale === "vi"
                ? "Chủ thể vận hành & Đầu mối tiếp nhận pháp lý (Việt Nam)"
                : "Operator & Official Legal / Privacy Contact"}
            </strong>
            <div>
              {locale === "vi" ? "Chủ thể: " : "Operator: "}
              <strong>{LEGAL_OPERATOR.operatorName}</strong>
            </div>
            <div>
              {locale === "vi" ? "Địa chỉ liên hệ: " : "Address: "}
              {LEGAL_OPERATOR.operatorAddress}
            </div>
            <div>
              Email:{" "}
              <a
                href={`mailto:${LEGAL_OPERATOR.contactEmail}`}
                style={{ textDecoration: "underline" }}
              >
                {LEGAL_OPERATOR.contactEmail}
              </a>{" "}
              ({LEGAL_OPERATOR.legalRoutingEmail} /{" "}
              {LEGAL_OPERATOR.privacyRoutingEmail}) ·{" "}
              {locale === "vi" ? "SĐT: " : "Phone: "}
              <a
                href={`tel:${LEGAL_OPERATOR.phone}`}
                style={{ textDecoration: "underline" }}
              >
                {LEGAL_OPERATOR.phone}
              </a>
            </div>
          </div>

          <div className="legal-document-sections">
            {activeDocument.sections.map((section) => (
              <section key={section.badge} className="legal-section-block">
                <div className="legal-section-heading">
                  <span className="legal-section-badge">{section.badge}</span>
                  <h3>{section.title}</h3>
                </div>
                <div className="legal-section-body">
                  {section.paragraphs.map((paragraph, index) => (
                    <p key={index}>{paragraph}</p>
                  ))}
                  {section.bullets && (
                    <ul className="legal-section-bullets">
                      {section.bullets.map((bullet, index) => (
                        <li key={index}>{bullet}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            ))}
          </div>

          <aside className="legal-contact-banner">
            <div>
              <h3>{catalog.reportCtaTitle}</h3>
              <p>{catalog.reportCtaDesc}</p>
            </div>
            <button
              type="button"
              className="landing-button landing-button-primary"
              onClick={() =>
                triggerLandingFeedback(
                  activeTab === "copyright"
                    ? "copyright"
                    : activeTab === "privacy"
                      ? "privacy"
                      : "bug",
                )
              }
            >
              {catalog.reportCtaButton}
            </button>
          </aside>
        </article>
      </main>

      <LandingFooter copy={activeCopy} />
    </div>
  );
}
