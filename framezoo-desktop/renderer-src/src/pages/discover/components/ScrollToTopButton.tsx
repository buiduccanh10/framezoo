import { type CSSProperties, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Icon, Icons } from "@/components/Icon";
import { useBannerSize } from "@/stores/banner";

export function ScrollToTopButton() {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  const bannerSize = useBannerSize();

  const toggleVisibility = () => {
    const scrolled = window.scrollY > 300;
    setIsVisible(scrolled);
  };

  useEffect(() => {
    const handleScroll = () => {
      const timeout = setTimeout(toggleVisibility, 100);
      return () => clearTimeout(timeout);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div
      className="fixed bottom-[calc(2.25rem+var(--banner-height))] left-12 z-50 -translate-x-1/2 transform md:bottom-[calc(1rem+var(--banner-height))] md:left-1/2"
      style={{ "--banner-height": `${bannerSize}px` } as CSSProperties}
    >
      <div
        className={`absolute inset-0 mx-auto h-[50px] w-[200px] rounded-full blur-[50px] opacity-50 pointer-events-none z-0 ${
          isVisible ? "opacity-100 visible" : "opacity-0 invisible"
        }`}
        style={{
          backgroundImage: `linear-gradient(to right, rgba(var(--colors-buttons-purpleHover)), rgba(var(--colors-progress-filled)))`,
          transition: "opacity 0.4s ease-in-out, transform 0.2s ease-in-out",
        }}
      />
      <button
        type="button"
        onClick={scrollToTop}
        className={`relative backdrop-blur-sm flex items-center justify-center space-x-2 rounded-full px-3 py-3 md:py-2 text-lg font-semibold text-white bg-pill-background/80 hover:bg-pill-backgroundHover transition-opacity hover:scale-105 duration-500 ease-in-out ${
          isVisible ? "opacity-100 visible" : "opacity-0 invisible"
        }`}
        style={{
          transition: "opacity 0.4s ease-in-out, transform 0.2s ease-in-out",
        }}
      >
        <Icon icon={Icons.CHEVRON_UP} className="text-2xl z-10" />
        <span className="z-10 hidden md:block">
          {t("discover.scrollToTop")}
        </span>
      </button>
    </div>
  );
}
