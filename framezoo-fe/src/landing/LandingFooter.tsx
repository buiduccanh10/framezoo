import type { LandingCopy } from "./i18n";
import { FRAMEZOO_SOCIAL_LINKS } from "./LandingIcon";

interface LandingFooterProps {
  copy: LandingCopy;
}

export function triggerLandingFeedback(
  category?: "bug" | "feature" | "copyright" | "privacy" | "other",
) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("open-landing-feedback", {
        detail: category ? { category } : undefined,
      }),
    );
  }
}

export function LandingFooter({ copy }: LandingFooterProps) {
  const { nav, footer } = copy;

  return (
    <footer className="landing-footer">
      <div className="landing-footer-container">
        <div className="landing-footer-grid">
          <div className="landing-footer-brand">
            <a className="landing-brand" href="/" aria-label={nav.homeAria}>
              <img
                src="/framezoo-logo.svg"
                width="138"
                height="40"
                alt="Framezoo"
              />
            </a>
            <p className="landing-footer-tagline">{footer.line}</p>
            <span className="landing-footer-status">{footer.status}</span>
            <p className="landing-footer-disclaimer" data-nosnippet>
              {footer.disclaimer}
            </p>
          </div>

          <div className="landing-footer-column">
            <h3>{footer.productTitle}</h3>
            <nav
              className="landing-footer-links"
              aria-label={footer.productTitle}
            >
              <a href="/">{nav.home}</a>
              <a href="/experience">{nav.features}</a>
              <a href="/ecosystem">{nav.addons}</a>
              <a href="/download">{nav.download}</a>
            </nav>
          </div>

          <div className="landing-footer-column">
            <h3>{footer.resourcesTitle}</h3>
            <nav
              className="landing-footer-links"
              aria-label={footer.resourcesTitle}
            >
              <a href="/guide/install">{nav.installGuide}</a>
              <a href="/create-addon">{nav.addonGuide}</a>
              <button
                type="button"
                className="landing-footer-link-button"
                onClick={() => triggerLandingFeedback()}
              >
                {footer.reportIssue}
              </button>
              {FRAMEZOO_SOCIAL_LINKS.map(
                ({ href, label, ariaLabel, title, Icon }) => (
                  <a
                    key={href}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="landing-footer-social-link"
                    aria-label={ariaLabel}
                    title={title}
                  >
                    <Icon className="landing-footer-social-icon" />
                    <span>{label}</span>
                  </a>
                ),
              )}
            </nav>
          </div>

          <div className="landing-footer-column">
            <h3>{footer.legalTitle}</h3>
            <nav
              className="landing-footer-links"
              aria-label={footer.legalTitle}
            >
              <a href="/legal/terms">{footer.terms}</a>
              <a href="/legal/privacy">{footer.privacy}</a>
              <a href="/legal/copyright">{footer.copyright}</a>
              <a href="/legal/addon-policy">{footer.addonPolicy}</a>
            </nav>
          </div>
        </div>

        <div className="landing-footer-bottom">
          <span className="landing-footer-copyright">{footer.rights}</span>
          <span className="landing-footer-attribution">
            {footer.metadataAttribution}
          </span>
        </div>
      </div>
    </footer>
  );
}
