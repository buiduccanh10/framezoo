import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Icon, Icons } from "@/components/Icon";
import { Modal, useModal } from "@/components/overlays/Modal";

export function DonateModal({ id = "donate" }: { id?: string }) {
  const { t } = useTranslation();
  const modal = useModal(id);
  const [selectedQr, setSelectedQr] = useState<{
    src: string;
    alt: string;
    label: string;
  } | null>(null);

  useEffect(() => {
    if (!modal.isShown) setSelectedQr(null);
  }, [modal.isShown]);

  const qrOptions = [
    {
      src: "/donate/paypal-qr.svg",
      alt: t("donate.paypalImageAlt", "PayPal donation QR code"),
      label: t("donate.paypalLabel", "PayPal"),
    },
    {
      src: "/donate/momo-qr.svg",
      alt: t("donate.momoImageAlt", "MoMo donation QR code"),
      label: t("donate.momoLabel", "MoMo"),
    },
  ];

  return (
    <Modal id={id} darkenClass="bg-black/80 backdrop-blur-md">
      <section
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        className="donate-modal-card pointer-events-auto"
      >
        <div className="relative">
          <button
            type="button"
            className="donate-modal-close tabbable"
            onClick={modal.hide}
            aria-label={t("donate.close", "Close")}
          >
            <Icon icon={Icons.X} />
          </button>

          <div className="donate-modal-heading">
            <span className="donate-modal-badge">
              {t("donate.badge", "A note from Framezoo")}
            </span>
            <h2 id={`${id}-title`}>
              {t("donate.modalTitle", "Help us keep building Framezoo")}
            </h2>
            <p id={`${id}-description`}>
              {t(
                "donate.subtitle",
                "Every contribution helps us improve the player, expand to more platforms, and keep listening to your ideas.",
              )}
            </p>
          </div>

          <p className="donate-modal-note">
            {t(
              "donate.note",
              "Thank you for caring about Framezoo and supporting the work behind it. Your contribution gives us more room to build a better experience for everyone.",
            )}
          </p>

          <p className="donate-modal-scan-hint">
            {t("donate.scanHint", "Scan this QR code with your banking app.")}
          </p>

          <div className="donate-modal-grid">
            {qrOptions.map((qr) => (
              <figure key={qr.src} className="donate-modal-method">
                <button
                  type="button"
                  className="donate-qr-frame donate-modal-image-frame"
                  onClick={() => setSelectedQr(qr)}
                  aria-label={t("donate.viewQr", {
                    defaultValue: "View {{label}} QR code larger",
                    label: qr.label,
                  })}
                >
                  <img
                    src={qr.src}
                    alt={qr.alt}
                    className="block w-full object-contain"
                    loading="eager"
                    decoding="async"
                  />
                </button>
                <figcaption className="donate-modal-method-caption">
                  <strong>{qr.label}</strong>
                </figcaption>
              </figure>
            ))}
          </div>

          <button
            type="button"
            className="donate-modal-dismiss tabbable"
            onClick={modal.hide}
          >
            {t("donate.close", "Close")}
          </button>
        </div>

        {selectedQr ? (
          <div
            className="fixed inset-0 z-[1002] grid place-items-center bg-black/90 p-4 backdrop-blur-md"
            role="dialog"
            aria-modal="true"
            aria-label={selectedQr.label}
            onClick={(event) => {
              if (event.target === event.currentTarget) setSelectedQr(null);
            }}
          >
            <button
              type="button"
              className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full border border-white/20 bg-white/10 text-white transition-colors hover:bg-white/20 tabbable"
              onClick={() => setSelectedQr(null)}
              aria-label={t("donate.close", "Close")}
            >
              <Icon icon={Icons.X} />
            </button>
            <img
              src={selectedQr.src}
              alt={selectedQr.alt}
              className="block max-h-[90dvh] max-w-[94vw] rounded-xl object-contain shadow-[0_28px_90px_rgba(0,0,0,0.65)]"
            />
          </div>
        ) : null}
      </section>
    </Modal>
  );
}
