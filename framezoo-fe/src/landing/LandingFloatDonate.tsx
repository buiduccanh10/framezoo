import { useState } from "react";

import { getLandingCopy, useLandingLocale } from "./i18n";
import { LandingDonateModal } from "./LandingDonateModal";
import { HeartIcon } from "./LandingIcon";

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
        <HeartIcon className="landing-float-donate-mark" />
        <span>{copy.button}</span>
      </button>

      <LandingDonateModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        copy={copy}
      />
    </>
  );
}
