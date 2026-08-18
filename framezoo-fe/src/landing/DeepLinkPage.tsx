import { useEffect, useState } from "react";

import { getInitialLandingLocale, getLandingCopy } from "./i18n";

export function DeepLinkPage({ path }: { path: string }) {
  const t = getLandingCopy(getInitialLandingLocale());
  const [showFallback, setShowFallback] = useState(false);
  const safePath = path.startsWith("/") ? path.substring(1) : path;
  const appUrl = `framezoo://${safePath}`;

  useEffect(() => {
    window.location.replace(appUrl);

    const timer = window.setTimeout(() => {
      setShowFallback(true);
    }, 2500);

    return () => window.clearTimeout(timer);
  }, [appUrl]);

  return (
    <main className="deep-link-page" aria-live="polite">
      {showFallback && (
        <section
          className="deep-link-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="deep-link-title"
        >
          <h1 id="deep-link-title">{t.deepLink.opening}</h1>
          <p>{t.deepLink.openingDescription.replace(/<\/?1>/g, "")}</p>
          <div className="deep-link-actions">
            <a className="deep-link-primary" href={appUrl}>
              {t.deepLink.retry}
            </a>
            <a
              className="deep-link-secondary"
              href="https://framezoo.top/#download"
              target="_blank"
              rel="noreferrer"
            >
              {t.deepLink.download}
            </a>
          </div>
        </section>
      )}
    </main>
  );
}
