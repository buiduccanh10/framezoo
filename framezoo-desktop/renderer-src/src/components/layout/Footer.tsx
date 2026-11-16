import { useTranslation } from "react-i18next";

import { FRAMEZOO_SOCIAL_LINKS, Icon } from "@/components/Icon";
import { BrandPill } from "@/components/layout/BrandPill";
import { WideContainer } from "@/components/layout/WideContainer";

export function Footer() {
  const { t } = useTranslation();

  return (
    <footer className="mt-16 border-t border-type-divider py-16 md:py-8">
      <WideContainer ultraWide classNames="grid md:grid-cols-2 gap-16 md:gap-8">
        <div>
          <div className="inline-block">
            <BrandPill />
          </div>
          <p className="mt-4 lg:max-w-[400px]">{t("footer.tagline")}</p>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            {FRAMEZOO_SOCIAL_LINKS.map((item) => (
              <a
                key={item.href}
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-type-secondary transition-colors hover:text-type-emphasis tabbable rounded"
                aria-label={item.ariaLabel}
                title={item.title}
              >
                <Icon icon={item.icon} className="text-base" />
                <span>{item.label}</span>
              </a>
            ))}
          </div>
        </div>
        <div className="md:text-right">
          <p className="mt-3 text-sm text-type-secondary">
            {t("footer.legal.disclaimerText")}
          </p>
          <p className="mt-2 text-xs text-type-secondary/80">
            {t(
              "footer.legal.tmdbAttribution",
              "Film metadata & posters are provided by TMDB API (not endorsed or certified by TMDB).",
            )}
          </p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm md:justify-end">
            <a
              href="https://framezoo.top/legal/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="text-type-link underline hover:text-type-linkHover"
            >
              {t("footer.legal.terms", "Terms of Service")}
            </a>
            <a
              href="https://framezoo.top/legal/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-type-link underline hover:text-type-linkHover"
            >
              {t("auth.register.privacyPolicy")}
            </a>
            <a
              href="https://framezoo.top/legal/dmca"
              target="_blank"
              rel="noopener noreferrer"
              className="text-type-link underline hover:text-type-linkHover"
            >
              {t("footer.legal.dmca", "DMCA / Takedown")}
            </a>
            <a
              href="https://framezoo.top/legal/disclaimer"
              target="_blank"
              rel="noopener noreferrer"
              className="text-type-link underline hover:text-type-linkHover"
            >
              {t("footer.legal.disclaimer", "Disclaimer")}
            </a>
          </div>
        </div>
      </WideContainer>
    </footer>
  );
}

export function FooterView(props: {
  children: React.ReactNode;
  className?: string;
  showFooter?: boolean;
}) {
  return (
    <div
      className={["flex min-h-screen flex-col", props.className || ""].join(
        " ",
      )}
    >
      <div style={{ flex: "1 0 auto" }}>{props.children}</div>
      {props.showFooter === false ? null : <Footer />}
    </div>
  );
}
