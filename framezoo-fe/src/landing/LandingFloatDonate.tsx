import { useState } from "react";

import { getLandingCopy, useLandingLocale } from "./i18n";
import { LandingDonateModal } from "./LandingDonateModal";

export function LandingFloatDonate() {
  const [isOpen, setIsOpen] = useState(false);
  const locale = useLandingLocale();
  const copy = getLandingCopy(locale).donate;

  return (
    <>
      <button
        type="button"
        className="landing-float-donate"
        onClick={() => setIsOpen(true)}
        aria-label={copy.button}
        title={copy.modalTitle}
      >
        <img
          className="landing-float-donate-image"
          src="/donate/buy-me-a-coffee.webp"
          alt=""
          aria-hidden="true"
        />
      </button>

      <LandingDonateModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        copy={copy}
      />
    </>
  );
}
