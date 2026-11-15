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
          {/* <h3 className="font-semibold text-type-emphasis">
            {t("footer.legal.disclaimer")}
          </h3> */}
          <p className="mt-3">{t("footer.legal.disclaimerText")}</p>
          <a
            href="https://framezoo.top/legal/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-type-link underline hover:text-type-linkHover"
          >
            {t("auth.register.privacyPolicy")}
          </a>
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
