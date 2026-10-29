import { useTranslation } from "react-i18next";

import { IconPatch } from "@/components/buttons/IconPatch";
import { Icons } from "@/components/Icon";
import { useModal } from "@/components/overlays/Modal";

export function DonateFloatingButton() {
  const { t } = useTranslation();
  const modal = useModal("donate");

  return (
    <button
      type="button"
      className="shrink-0 rounded-full text-xl text-white tabbable"
      onClick={modal.show}
      aria-label={t("donate.button", "Support Framezoo")}
      title={t("donate.modalTitle", "Help us keep building Framezoo")}
    >
      <IconPatch icon={Icons.HEART} clickable downsized navigation />
    </button>
  );
}
