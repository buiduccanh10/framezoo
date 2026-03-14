import { useTranslation } from "react-i18next";

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
        </div>
        <div className="md:text-right">
          <h3 className="font-semibold text-type-emphasis">
            {t("footer.legal.disclaimer")}
          </h3>
          <p className="mt-3">{t("footer.legal.disclaimerText")}</p>
        </div>
        {/* <div className="flex flex-wrap gap-[0.5rem] -ml-3">
          {conf().GITHUB_LINK && (
            <FooterLink icon={Icons.GITHUB} href={conf().GITHUB_LINK}>
              {t("footer.links.github")}
            </FooterLink>
          )}
          <FooterLink icon={Icons.FLUXER} href={conf().FLUXER_LINK}>
            {t("footer.links.fluxer")}/Discord
          </FooterLink>
          <FooterLink href="https://rentry.co/nnqtas3e" icon={Icons.TIP_JAR}>
            {t("footer.links.funding")}
          </FooterLink>
          <div className="inline md:hidden">
            <Legal />
          </div>
        </div>
        <div className="hidden items-center justify-end md:flex -mr-3">
          <Legal />
        </div> */}
      </WideContainer>
    </footer>
  );
}

export function FooterView(props: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={["flex min-h-screen flex-col", props.className || ""].join(
        " ",
      )}
    >
      <div style={{ flex: "1 0 auto" }}>{props.children}</div>
      <Footer />
    </div>
  );
}
