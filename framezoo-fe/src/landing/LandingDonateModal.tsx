import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import type { LandingCopy } from "./i18n";

interface LandingDonateModalProps {
  isOpen: boolean;
  onClose: () => void;
  copy: LandingCopy["donate"];
}

export function LandingDonateModal({
  isOpen,
  onClose,
  copy,
}: LandingDonateModalProps) {
  const [selectedQr, setSelectedQr] = useState<{
    src: string;
    alt: string;
    label: string;
  } | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setSelectedQr(null);
      return;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (selectedQr) {
        setSelectedQr(null);
      } else {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose, selectedQr]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="landing-donate-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="landing-donate-title"
      aria-describedby="landing-donate-description"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="landing-donate-card">
        <button
          type="button"
          className="landing-donate-close"
          onClick={onClose}
          aria-label={copy.close}
        >
          <span aria-hidden="true">×</span>
        </button>

        <div className="landing-donate-heading">
          <span className="landing-donate-badge">{copy.badge}</span>
          <h2 id="landing-donate-title">{copy.modalTitle}</h2>
          <p id="landing-donate-description">{copy.subtitle}</p>
        </div>

        <p className="landing-donate-note">{copy.note}</p>

        <p className="landing-donate-scan-hint">{copy.scanHint}</p>

        <div className="landing-donate-grid">
          {[
            {
              src: "/donate/paypal-qr.svg",
              alt: copy.paypalImageAlt,
              label: copy.paypalLabel,
            },
            {
              src: "/donate/momo-qr.svg",
              alt: copy.momoImageAlt,
              label: copy.momoLabel,
            },
          ].map((qr) => (
            <figure className="landing-donate-method" key={qr.src}>
              <button
                type="button"
                className="landing-donate-image-frame"
                onClick={() => setSelectedQr(qr)}
                aria-label={`${copy.viewQr}: ${qr.label}`}
              >
                <img
                  src={qr.src}
                  alt={qr.alt}
                  loading="eager"
                  decoding="async"
                />
              </button>
              <figcaption>
                <strong>{qr.label}</strong>
              </figcaption>
            </figure>
          ))}
        </div>

        <button
          type="button"
          className="landing-donate-dismiss"
          onClick={onClose}
        >
          {copy.close}
        </button>
      </div>

      {selectedQr ? (
        <div
          className="landing-donate-viewer"
          role="dialog"
          aria-modal="true"
          aria-label={selectedQr.label}
          onClick={(event) => {
            if (event.target === event.currentTarget) setSelectedQr(null);
          }}
        >
          <button
            type="button"
            className="landing-donate-viewer-close"
            onClick={() => setSelectedQr(null)}
            aria-label={copy.close}
          >
            <span aria-hidden="true">×</span>
          </button>
          <img src={selectedQr.src} alt={selectedQr.alt} />
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
