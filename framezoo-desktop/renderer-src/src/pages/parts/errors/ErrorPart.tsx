import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ButtonPlain } from "@/components/buttons/Button";
import { Icons } from "@/components/Icon";
import { BrandPill } from "@/components/layout/BrandPill";
import { IconPill } from "@/components/layout/IconPill";
import { WindowControls } from "@/components/layout/WindowControls";
import { Title } from "@/components/text/Title";
import { Paragraph } from "@/components/utils/Text";
import { useIsMacWindowed } from "@/hooks/useIsDesktopApp";
import { ErrorContainer, ErrorLayout } from "@/pages/layouts/ErrorLayout";
import { ErrorCardInPlainModal } from "@/pages/parts/errors/ErrorCard";

export function ErrorPart(props: { error: any; errorInfo: any }) {
  const isMacWindowed = useIsMacWindowed();
  const { t } = useTranslation();
  const [showErrorCard, setShowErrorCard] = useState(false);

  const maxLineCount = 5;
  const errorLines = (props.errorInfo.componentStack || "")
    .split("\n")
    .slice(0, maxLineCount);

  const error = `${props.error.toString()}\n${errorLines.join("\n")}`;

  return (
    <div className="relative flex min-h-screen flex-1 flex-col">
      {/* Top Header */}
      <div
        className="fixed top-0 left-0 right-0 z-20 flex items-center pointer-events-auto"
        data-app-region="drag"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <div className="px-1 py-5 sm:px-4 md:px-6 lg:px-7 relative z-[60] flex flex-1 items-center justify-between">
          <div className="pointer-events-auto flex items-center min-h-[40px] gap-1 sm:gap-2 md:gap-3">
            {isMacWindowed && (
              <div
                className="w-[72px] shrink-0 pointer-events-none"
                aria-hidden="true"
              />
            )}
            <div
              className="block shrink-0 tabbable rounded-full text-xs ssm:text-base"
              data-app-region="no-drag"
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            >
              <BrandPill header />
            </div>
          </div>
          <div
            className="relative pointer-events-auto ml-auto flex items-center"
            data-app-region="no-drag"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            <WindowControls />
          </div>
        </div>
      </div>
      <div className="flex h-full flex-1 flex-col items-center justify-center p-5 text-center">
        <ErrorLayout>
          <ErrorContainer maxWidth="max-w-2xl w-9/10">
            <IconPill icon={Icons.EYE_SLASH}>{t("errors.badge")}</IconPill>
            <Title>{t("errors.title")}</Title>

            <Paragraph>{props.error.toString()}</Paragraph>
            <ErrorCardInPlainModal
              show={showErrorCard}
              onClose={() => setShowErrorCard(false)}
              error={error}
            />

            <div className="flex gap-3">
              <ButtonPlain
                theme="secondary"
                className="mt-6 p-2.5 md:px-12"
                onClick={() => window.location.reload()}
              >
                {t("errors.reloadPage")}
              </ButtonPlain>
              <ButtonPlain
                theme="purple"
                className="mt-6 p-2.5 md:px-12"
                onClick={() => setShowErrorCard(true)}
              >
                {t("errors.showError")}
              </ButtonPlain>
            </div>
          </ErrorContainer>
        </ErrorLayout>
      </div>
    </div>
  );
}
