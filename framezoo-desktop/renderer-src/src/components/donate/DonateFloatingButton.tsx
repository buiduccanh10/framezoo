import { useTranslation } from "react-i18next";

import { IconPatch } from "@/components/buttons/IconPatch";
import { useModal } from "@/components/overlays/Modal";

export function DonateFloatingButton() {
  const { t } = useTranslation();
  const modal = useModal("donate");

  return (
    <button
      type="button"
      className="shrink-0 text-xl text-white tabbable rounded-full backdrop-blur-lg cursor-pointer flex items-center justify-center overflow-visible"
      onClick={modal.show}
      aria-label={t("donate.button", "Support Framezoo")}
      title={t("donate.modalTitle", "Help us keep building Framezoo")}
    >
      <IconPatch clickable downsized navigation>
        <img
          src="/donate/donate-gif.gif"
          alt=""
          className="h-7 w-7 object-contain pointer-events-none select-none"
          aria-hidden="true"
        />
      </IconPatch>
    </button>
  );
}

export const DonateButton = DonateFloatingButton;
