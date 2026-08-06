import { useTranslation } from "react-i18next";

import { Button } from "@/components/buttons/Button";
import { SolidSettingsCard } from "@/components/layout/SettingsCard";
import { Heading3 } from "@/components/utils/Text";
import { useOverlayStack } from "@/stores/interface/overlayStack";

export function RegisterCalloutPart() {
  const { t } = useTranslation();

  return (
    <div>
      <SolidSettingsCard
        paddingClass="px-6 py-12"
        className="grid grid-cols-2 gap-12 mt-5"
      >
        <div>
          <Heading3>{t("settings.account.register.title")}</Heading3>
          <p className="text-type-text max-w-[30rem]">
            {t("settings.account.register.text")}
          </p>
        </div>
        <div className="flex justify-end items-center">
          <Button
            theme="purple"
            onClick={() =>
              useOverlayStack.getState().showModal("auth", { mode: "login" })
            }
          >
            {t("settings.account.register.cta")}
          </Button>
        </div>
      </SolidSettingsCard>
    </div>
  );
}
