import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

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
  const activeLanguage = LANDING_LOCALES.find((item) => item.id === locale);

  return (
    <div className="landing-language-menu">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            className="landing-language-toggle"
            type="button"
            aria-label={label}
          >
            <span className="landing-language-flag" aria-hidden="true">
              {activeLanguage?.flag}
            </span>
            <span>{activeLanguage?.nativeLabel}</span>
          </button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="landing-language-options"
            aria-label={label}
            align="end"
            sideOffset={10}
            collisionPadding={16}
          >
            <DropdownMenu.RadioGroup
              value={locale}
              onValueChange={(value) => onChange(value as LandingLocale)}
            >
              {LANDING_LOCALES.map((option) => (
                <DropdownMenu.RadioItem
                  className={`landing-language-option${
                    option.id === locale ? " is-active" : ""
                  }`}
                  key={option.id}
                  value={option.id}
                >
                  <span className="landing-language-flag" aria-hidden="true">
                    {option.flag}
                  </span>
                  <span>{option.nativeLabel}</span>
                  <DropdownMenu.ItemIndicator asChild>
                    <span className="landing-language-check" aria-hidden="true">
                      <svg
                        viewBox="0 0 16 16"
                        width="13"
                        height="13"
                        fill="none"
                      >
                        <path
                          d="m3.25 8.25 3 3 6.5-6.5"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
