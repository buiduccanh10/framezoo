import classNames from "classnames";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Icon, Icons } from "@/components/Icon";
import { Heading1 } from "@/components/utils/Text";
import {
  primaryOptions,
  secondaryOptions,
  tertiaryOptions,
} from "@themes/custom";

const availableThemes = [
  {
    id: "default",
    selector: "theme-default",
    key: "settings.appearance.themes.default",
  },
  {
    id: "classic",
    selector: "theme-classic",
    key: "settings.appearance.themes.classic",
  },
  {
    id: "blue",
    selector: "theme-blue",
    key: "settings.appearance.themes.blue",
  },
  {
    id: "teal",
    selector: "theme-teal",
    key: "settings.appearance.themes.teal",
  },
  {
    id: "red",
    selector: "theme-red",
    key: "settings.appearance.themes.red",
  },
  {
    id: "gray",
    selector: "theme-gray",
    key: "settings.appearance.themes.gray",
  },
  {
    id: "green",
    selector: "theme-green",
    key: "settings.appearance.themes.green",
  },
  {
    id: "forest",
    selector: "theme-forest",
    key: "settings.appearance.themes.forest",
  },
  {
    id: "autumn",
    selector: "theme-autumn",
    key: "settings.appearance.themes.autumn",
  },
  {
    id: "frost",
    selector: "theme-frost",
    key: "settings.appearance.themes.frost",
  },
  {
    id: "mocha",
    selector: "theme-mocha",
    key: "settings.appearance.themes.mocha",
  },
  {
    id: "pink",
    selector: "theme-pink",
    key: "settings.appearance.themes.pink",
  },
  {
    id: "noir",
    selector: "theme-noir",
    key: "settings.appearance.themes.noir",
  },
  {
    id: "ember",
    selector: "theme-ember",
    key: "settings.appearance.themes.ember",
  },
  {
    id: "acid",
    selector: "theme-acid",
    key: "settings.appearance.themes.acid",
  },
  {
    id: "spark",
    selector: "theme-spark",
    key: "settings.appearance.themes.spark",
  },
  {
    id: "cobalt",
    selector: "theme-cobalt",
    key: "settings.appearance.themes.cobalt",
  },
  {
    id: "grape",
    selector: "theme-grape",
    key: "settings.appearance.themes.grape",
  },
  {
    id: "spiderman",
    selector: "theme-spiderman",
    key: "settings.appearance.themes.spiderman",
  },
  {
    id: "wolverine",
    selector: "theme-wolverine",
    key: "settings.appearance.themes.wolverine",
  },
  {
    id: "hulk",
    selector: "theme-hulk",
    key: "settings.appearance.themes.hulk",
  },
  {
    id: "popsicle",
    selector: "theme-popsicle",
    key: "settings.appearance.themes.popsicle",
  },
  {
    id: "christmas",
    selector: "theme-christmas",
    key: "settings.appearance.themes.christmas",
  },
  {
    id: "custom",
    selector: "theme-custom",
    key: "settings.appearance.themes.custom",
  },
];

function ThemePreview(props: {
  selector?: string;
  active?: boolean;
  inUse?: boolean;
  name: string;
  onClick?: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div
      className={classNames(props.selector, "cursor-pointer group tabbable")}
      onClick={props.onClick}
    >
      {/* Little card thing */}
      <div
        tabIndex={0}
        onKeyUp={(e) => e.key === "Enter" && e.currentTarget.click()}
        className={classNames(
          "tabbable scroll-mt-32 w-full h-32 relative rounded-lg border bg-gradient-to-br from-themePreview-primary/20 to-themePreview-secondary/10 bg-clip-content transition-colors duration-150",
          props.active
            ? "border-themePreview-primary"
            : "border-transparent group-hover:border-white/20",
        )}
      >
        {/* Dots */}
        <div className="absolute top-2 left-2">
          <div className="h-5 w-5 bg-themePreview-primary rounded-full" />
          <div className="h-5 w-5 bg-themePreview-secondary rounded-full -mt-2" />
        </div>
        {/* Active check */}
        <Icon
          icon={Icons.CHECKMARK}
          className={classNames(
            "absolute top-3 right-3 text-xs text-white transition-opacity duration-150",
            props.active ? "opacity-100" : "opacity-0",
          )}
        />
        {/* Mini movie-web. So Kawaiiiii! */}
        <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 w-3/5 h-4/5 rounded-t-lg -mb-px bg-background-main overflow-hidden">
          <div className="relative w-full h-full">
            {/* Background color */}
            <div className="bg-themePreview-primary/50 w-[130%] h-10 absolute left-1/2 -top-5 blur-xl transform -translate-x-1/2 rounded-[100%]" />
            {/* Navbar */}
            <div className="p-2 flex justify-between items-center">
              <div className="flex space-x-1">
                <div className="bg-themePreview-ghost bg-opacity-10 w-4 h-2 rounded-full" />
                <div className="bg-themePreview-ghost bg-opacity-10 w-2 h-2 rounded-full" />
                <div className="bg-themePreview-ghost bg-opacity-10 w-2 h-2 rounded-full" />
              </div>
              <div className="bg-themePreview-ghost bg-opacity-10 w-2 h-2 rounded-full" />
            </div>
            {/* Hero */}
            <div className="mt-1 flex items-center flex-col gap-1">
              {/* Title and subtitle */}
              <div className="bg-themePreview-ghost bg-opacity-20 w-8 h-0.5 rounded-full" />
              <div className="bg-themePreview-ghost bg-opacity-20 w-6 h-0.5 rounded-full" />
              {/* Search bar */}
              <div className="bg-themePreview-ghost bg-opacity-10 w-16 h-2 mt-1 rounded-full" />
            </div>
            {/* Media grid */}
            <div className="mt-5 px-3">
              {/* Title */}
              <div className="flex gap-1 items-center">
                <div className="bg-themePreview-ghost bg-opacity-20 w-2 h-2 rounded-full" />
                <div className="bg-themePreview-ghost bg-opacity-20 w-8 h-0.5 rounded-full" />
              </div>
              {/* Blocks */}
              <div className="flex w-full gap-1 mt-1">
                <div className="bg-themePreview-ghost bg-opacity-10 w-full h-20 rounded" />
                <div className="bg-themePreview-ghost bg-opacity-10 w-full h-20 rounded" />
                <div className="bg-themePreview-ghost bg-opacity-10 w-full h-20 rounded" />
                <div className="bg-themePreview-ghost bg-opacity-10 w-full h-20 rounded" />
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-2 flex justify-between items-center">
        <span className="font-medium text-white">{props.name}</span>
        <span
          className={classNames(
            "inline-block px-3 py-1 leading-tight text-sm transition-opacity duration-150 rounded-full bg-pill-activeBackground text-white/85",
            props.inUse ? "opacity-100" : "opacity-0 pointer-events-none",
          )}
        >
          {t("settings.appearance.activeTheme")}
        </span>
      </div>
    </div>
  );
}

function ColorOption(props: {
  active: boolean;
  colors: Record<string, string>;
  onClick: () => void;
  title: string;
}) {
  const c1 =
    props.colors["--colors-type-logo"] ||
    props.colors["--colors-background-main"] ||
    props.colors["--colors-type-text"];
  const c2 =
    props.colors["--colors-lightBar-light"] ||
    props.colors["--colors-modal-background"] ||
    props.colors["--colors-utils-divider"];

  return (
    <div
      className={classNames(
        "cursor-pointer p-1 rounded-full border-2 transition-all",
        props.active
          ? "border-type-link scale-110"
          : "border-transparent hover:border-white/20 hover:scale-105",
      )}
      onClick={props.onClick}
      title={props.title}
    >
      <div className="w-8 h-8 rounded-full overflow-hidden flex transform rotate-45">
        <div
          className="flex-1 h-full"
          style={{ backgroundColor: `rgb(${c1})` }}
        />
        <div
          className="flex-1 h-full"
          style={{ backgroundColor: `rgb(${c2})` }}
        />
      </div>
    </div>
  );
}

export function AppearancePart(props: {
  active: string;
  inUse: string;
  setTheme: (theme: string) => void;
  customTheme: {
    primary: string;
    secondary: string;
    tertiary: string;
  };
  setCustomTheme: (v: {
    primary: string;
    secondary: string;
    tertiary: string;
  }) => void;
}) {
  const { t } = useTranslation();

  const customTheme = props.customTheme;
  const setCustomTheme = props.setCustomTheme;

  const carouselRef = useRef<HTMLDivElement>(null);
  const activeThemeRef = useRef<HTMLDivElement>(null);
  const [isAtTop, setIsAtTop] = useState(true);
  const [isAtBottom, setIsAtBottom] = useState(false);

  const checkScrollPosition = () => {
    const container = carouselRef.current;
    if (!container) return;

    setIsAtTop(container.scrollTop <= 0);
    setIsAtBottom(
      Math.abs(
        container.scrollHeight - container.scrollTop - container.clientHeight,
      ) < 2,
    );
  };

  useEffect(() => {
    const container = carouselRef.current;
    if (!container) return;

    container.addEventListener("scroll", checkScrollPosition);
    checkScrollPosition(); // Check initial position

    return () => container.removeEventListener("scroll", checkScrollPosition);
  }, []);

  useEffect(() => {
    if (activeThemeRef.current && carouselRef.current) {
      const element = activeThemeRef.current;
      const container = carouselRef.current;

      const elementRect = element.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();

      // Center the element in the container
      container.scrollTop =
        elementRect.top +
        container.scrollTop -
        containerRect.top -
        (containerRect.height - elementRect.height) / 2;

      checkScrollPosition(); // Update masks after scrolling
    }
  }, [props.active]);

  return (
    <div className="space-y-12">
      <Heading1 border>{t("settings.appearance.title")}</Heading1>

      <div className="space-y-8">
        <div
          ref={carouselRef}
          className={classNames(
            "grid grid-cols-2 gap-4 max-w-[600px] max-h-[36rem] md:max-h-[64rem] overflow-y-auto",
            "vertical-carousel-container",
            {
              "hide-top-gradient": isAtTop,
              "hide-bottom-gradient": isAtBottom,
            },
          )}
        >
          {availableThemes.map((v) => (
            <div key={v.id} ref={props.active === v.id ? activeThemeRef : null}>
              <ThemePreview
                selector={v.selector}
                active={props.active === v.id}
                inUse={props.inUse === v.id}
                name={t(v.key)}
                onClick={() => props.setTheme(v.id)}
              />
            </div>
          ))}
        </div>

        {props.active === "custom" && (
          <div className="animate-fade-in space-y-6 pt-4 border-t border-utils-divider">
            <div>
              <p className="text-white font-bold mb-3">
                {t("settings.appearance.customParts.primary")}
              </p>
              <div className="flex flex-wrap gap-3">
                {primaryOptions.map((opt) => (
                  <ColorOption
                    key={opt.id}
                    active={customTheme.primary === opt.id}
                    colors={opt.colors}
                    onClick={() =>
                      setCustomTheme({ ...customTheme, primary: opt.id })
                    }
                    title={t(`settings.appearance.themes.${opt.id}`)}
                  />
                ))}
              </div>
            </div>
            <div>
              <p className="text-white font-bold mb-3">
                {t("settings.appearance.customParts.secondary")}
              </p>
              <div className="flex flex-wrap gap-3">
                {secondaryOptions.map((opt) => (
                  <ColorOption
                    key={opt.id}
                    active={customTheme.secondary === opt.id}
                    colors={opt.colors}
                    onClick={() =>
                      setCustomTheme({ ...customTheme, secondary: opt.id })
                    }
                    title={t(`settings.appearance.themes.${opt.id}`)}
                  />
                ))}
              </div>
            </div>
            <div>
              <p className="text-white font-bold mb-3">
                {t("settings.appearance.customParts.tertiary")}
              </p>
              <div className="flex flex-wrap gap-3">
                {tertiaryOptions.map((opt) => (
                  <ColorOption
                    key={opt.id}
                    active={customTheme.tertiary === opt.id}
                    colors={opt.colors}
                    onClick={() =>
                      setCustomTheme({ ...customTheme, tertiary: opt.id })
                    }
                    title={t(`settings.appearance.themes.${opt.id}`)}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
