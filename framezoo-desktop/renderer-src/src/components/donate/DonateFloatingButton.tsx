import { useTranslation } from "react-i18next";

import { useModal } from "@/components/overlays/Modal";

export function DonateFloatingButton() {
  const { t } = useTranslation();
  const modal = useModal("donate");

  return (
    <button
      type="button"
      className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] left-[calc(1.25rem+env(safe-area-inset-left))] z-[600] shrink-0 rounded-full tabbable transition-all duration-200 ease-out hover:scale-105 hover:brightness-110 active:scale-95 motion-reduce:transition-none"
      onClick={modal.show}
      aria-label={t("donate.button", "Support Framezoo")}
      title={t("donate.modalTitle", "Help us keep building Framezoo")}
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <img
        className="block h-[30px] w-[150px]"
        src="/donate/buy-me-a-coffee.webp"
        alt=""
        aria-hidden="true"
      />
    </button>
  );
}
