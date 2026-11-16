import { useEffect, useState } from "react";

import { getLandingCopy, useLandingLocale } from "./i18n";
import { LandingFeedbackModal } from "./LandingFeedbackModal";
import { FRAMEZOO_SOCIAL_LINKS, MessageSquareIcon } from "./LandingIcon";

export function LandingFloatFeedback() {
  const [isOpen, setIsOpen] = useState(false);
  const [requestedCategory, setRequestedCategory] = useState<
    "bug" | "feature" | "copyright" | "privacy" | "other"
  >("bug");
  const locale = useLandingLocale();
  const copy = getLandingCopy(locale);
  const feedbackCopy = copy.feedback;

  useEffect(() => {
    const handleOpen = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          category?: "bug" | "feature" | "copyright" | "privacy" | "other";
        }>
      )?.detail;
      setRequestedCategory(detail?.category || "bug");
      setIsOpen(true);
    };
    window.addEventListener("open-landing-feedback", handleOpen);
    return () => {
      window.removeEventListener("open-landing-feedback", handleOpen);
    };
  }, []);

  return (
    <>
      <div className="landing-float-actions">
        <button
          type="button"
          className="landing-float-feedback"
          onClick={() => {
            setRequestedCategory("bug");
            setIsOpen(true);
          }}
          aria-label={feedbackCopy?.button ?? "Feedback"}
          title={feedbackCopy?.modalTitle ?? "Send us your feedback"}
        >
          <MessageSquareIcon />
          <span>{feedbackCopy?.button ?? "Feedback"}</span>
        </button>

        {FRAMEZOO_SOCIAL_LINKS.map(({ href, ariaLabel, title, Icon }) => (
          <a
            key={href}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="landing-float-social"
            aria-label={ariaLabel}
            title={title}
          >
            <Icon />
          </a>
        ))}
      </div>

      <LandingFeedbackModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        copy={feedbackCopy}
        initialCategory={requestedCategory}
      />
    </>
  );
}
