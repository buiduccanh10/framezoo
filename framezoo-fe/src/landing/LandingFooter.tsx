import type { LandingCopy } from "./i18n";

interface LandingFooterProps {
  copy: LandingCopy;
}

export function triggerLandingFeedback() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("open-landing-feedback"));
  }
}

export function LandingFooter({ copy }: LandingFooterProps) {
  const { nav, footer } = copy;

  return (
    <footer className="landing-footer" data-nosnippet>
      <div className="landing-footer-container">
        <div className="landing-footer-grid">
          <div className="landing-footer-brand">
            <a className="landing-brand" href="/" aria-label="Framezoo home">
              <img
                src="/framezoo-logo.svg"
                width="138"
                height="40"
                alt="Framezoo"
              />
            </a>
            <p className="landing-footer-tagline">{footer.line}</p>
            <span className="landing-footer-status">{footer.status}</span>
            <p className="landing-footer-disclaimer">{footer.disclaimer}</p>
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
                onClick={triggerLandingFeedback}
              >
                {footer.reportIssue}
              </button>
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
