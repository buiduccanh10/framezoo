import { useEffect, useState } from "react";

import { getLandingCopy, useLandingLocale } from "./i18n";
import { LandingFeedbackModal } from "./LandingFeedbackModal";
import { MessageSquareIcon } from "./LandingIcon";

export function LandingFloatFeedback() {
  const [isOpen, setIsOpen] = useState(false);
  const locale = useLandingLocale();
  const copy = getLandingCopy(locale);
  const feedbackCopy = copy.feedback;

  useEffect(() => {
    const handleOpen = () => setIsOpen(true);
    window.addEventListener("open-landing-feedback", handleOpen);
    return () => {
      window.removeEventListener("open-landing-feedback", handleOpen);
    };
  }, []);

  return (
    <>
      <button
        type="button"
        className="landing-float-feedback"
        onClick={() => setIsOpen(true)}
        aria-label={feedbackCopy?.button ?? "Feedback"}
        title={feedbackCopy?.modalTitle ?? "Send us your feedback"}
      >
        <MessageSquareIcon />
        <span>{feedbackCopy?.button ?? "Feedback"}</span>
      </button>

      <LandingFeedbackModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        copy={feedbackCopy}
      />
    </>
  );
}
