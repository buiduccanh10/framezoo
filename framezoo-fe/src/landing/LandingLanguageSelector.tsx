import { useEffect, useRef, useState } from "react";

import { LANDING_LOCALES, type LandingLocale } from "./i18n";

interface LandingLanguageSelectorProps {
  locale: LandingLocale;
  label: string;
  onChange: (locale: LandingLocale) => void;
}

export function LandingLanguageSelector({
  locale,
  label,
  onChange,
}: LandingLanguageSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const activeLanguage = LANDING_LOCALES.find((item) => item.id === locale);
  const selectLocale = (nextLocale: LandingLocale) => {
    onChange(nextLocale);
    setIsOpen(false);
  };

  useEffect(() => {
    if (!isOpen) return;

    const handleDocumentClick = (event: MouseEvent) => {
      if (rootRef.current && !event.composedPath().includes(rootRef.current)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("click", handleDocumentClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div className="landing-language-menu" ref={rootRef}>
      <button
        className="landing-language-toggle"
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={label}
        onClick={() => setIsOpen((value) => !value)}
      >
        <span className="landing-language-flag" aria-hidden="true">
          {activeLanguage?.flag}
        </span>
        <span>{activeLanguage?.nativeLabel}</span>
      </button>

      {isOpen ? (
        <div
          className="landing-language-options"
          role="menu"
          aria-label={label}
        >
          {LANDING_LOCALES.map((option) => (
            <button
              className={`landing-language-option${
                option.id === locale ? " is-active" : ""
              }`}
              key={option.id}
              type="button"
              role="menuitemradio"
              aria-checked={option.id === locale}
              onPointerDown={(event) => {
                // Store the start Y position to detect dragging
                (event.currentTarget as any)._startY = event.clientY;
                (event.currentTarget as any)._isDragging = false;
              }}
              onPointerMove={(event) => {
                const startY = (event.currentTarget as any)._startY;
                if (startY !== undefined) {
                  // If moved more than 5px, it's a drag/scroll
                  if (Math.abs(event.clientY - startY) > 5) {
                    (event.currentTarget as any)._isDragging = true;
                  }
                }
              }}
              onClick={(event) => {
                event.stopPropagation();
                // Only select if not dragging
                if (!(event.currentTarget as any)._isDragging) {
                  selectLocale(option.id);
                }
              }}
            >
              <span className="landing-language-flag" aria-hidden="true">
                {option.flag}
              </span>
              <span>{option.nativeLabel}</span>
              {option.id === locale ? (
                <span className="landing-language-check" aria-hidden="true">
                  ✓
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
