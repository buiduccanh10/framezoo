import classNames from "classnames";

import { getCountryCodeForLocale } from "@/utils/language";
import { resolvePublicUrl } from "@/utils/publicUrl";
import "flag-icons/css/flag-icons.min.css";

export interface FlagIconProps {
  country?: string;
  langCode?: string;
}

export function FlagIcon(props: FlagIconProps) {
  const flagSrc = (path: string) => resolvePublicUrl(path) ?? path;
  let countryCode: string | null = props.country ?? null;
  if (props.langCode) countryCode = getCountryCodeForLocale(props.langCode);

  if (props.langCode === "tok")
    return (
      <div className="w-8 h-6 rounded bg-[#c8e1ed] flex justify-center items-center">
        <img src={flagSrc("/flags/tokiPona.svg")} className="w-7 h-5" />
      </div>
    );

  if (props.langCode === "pirate")
    return (
      <div className="w-8 h-6 rounded bg-[#2E3439] flex justify-center items-center">
        <img src={flagSrc("/flags/skull.svg")} className="w-4 h-4" />
      </div>
    );

  if (props.langCode === "cat")
    return (
      <div className="w-8 h-6 rounded bg-[#505050] flex justify-center items-center">
        <img src={flagSrc("/flags/cat.png")} className="w-4 h-4" />
      </div>
    );

  if (props.langCode === "uwu")
    return (
      <div className="w-8 h-6 rounded bg-[#222] flex justify-center items-center">
        <img src={flagSrc("/flags/uwu.png")} className="w-6 h-6" />
      </div>
    );

  if (props.langCode === "minion")
    return (
      <div className="w-8 h-6 rounded bg-[#ffff1a] flex justify-center items-center">
        <div className="w-4 h-4 border-2 border-gray-500 rounded-full bg-white flex justify-center items-center">
          <div className="w-1.5 h-1.5 rounded-full bg-gray-900 relative">
            <div className="absolute top-0 left-0 w-1 h-1 bg-white rounded-full transform -translate-x-1/3 -translate-y-1/3" />
          </div>
        </div>
      </div>
    );

  if (props.langCode === "futhark")
    return (
      <div className="w-8 h-6 rounded bg-gray-800 flex flex-col">
        <div className="flex-1 bg-brown-800" />
        <div className="h-2 bg-yellow-600 flex justify-center items-center">
          <span className="text-white text-lg translate-y-[-2px] font-bold z-50">
            ᚠ
          </span>
        </div>
        <div className="flex-1 bg-gray-600" />
      </div>
    );

  // Galicia - Not a country (Is a region of Spain) so have to add the flag manually
  if (props.langCode === "gl-ES")
    return (
      <div className="w-8 h-6 rounded bg-[#2E3439] flex justify-center items-center">
        <img src={flagSrc("/flags/galicia.svg")} className="rounded" />
      </div>
    );

  let backgroundClass = "bg-video-context-flagBg";
  if (countryCode === "np") backgroundClass = "bg-white";

  if (!countryCode) {
    return (
      <span
        className={classNames(
          "!w-8 min-w-8 h-6 rounded overflow-hidden bg-video-context-flagBg flex items-center justify-center text-video-context-type-secondary",
        )}
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <circle cx="12" cy="12" r="8.5" />
          <path d="M3.5 12h17M12 3.5c2.25 2.35 3.4 5.18 3.4 8.5S14.25 18.15 12 20.5C9.75 18.15 8.6 15.32 8.6 12S9.75 5.85 12 3.5Z" />
        </svg>
      </span>
    );
  }

  return (
    <span
      className={classNames(
        "!w-8 min-w-8 h-6 rounded overflow-hidden bg-cover bg-center block fi",
        backgroundClass,
        countryCode ? `fi-${countryCode}` : undefined,
      )}
    />
  );
}
