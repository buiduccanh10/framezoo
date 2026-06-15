import classNames from "classnames";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";

import { NoUserAvatar, UserAvatar } from "@/components/Avatar";
import { IconPatch } from "@/components/buttons/IconPatch";
import { Icons } from "@/components/Icon";
import { LinksDropdown, WatchPartyInputLink } from "@/components/LinksDropdown";
import { Lightbar } from "@/components/utils/Lightbar";
import { useAuth } from "@/hooks/auth/useAuth";
import { BlurEllipsis } from "@/pages/layouts/SubPageLayout";
import { useBannerSize } from "@/stores/banner";
import { usePreferencesStore } from "@/stores/preferences";

import { BrandPill } from "./BrandPill";

export interface NavigationProps {
  bg?: boolean;
  noLightbar?: boolean;
  doBackground?: boolean;
  clearBackground?: boolean;
}

export function Navigation(props: NavigationProps) {
  const bannerHeight = useBannerSize();
  const location = useLocation();
  const { loggedIn } = useAuth();
  const { t } = useTranslation();
  const [scrollPosition, setScrollPosition] = useState(0);
  const [installPromptEvent, setInstallPromptEvent] = useState<any | null>(
    null,
  );

  useEffect(() => {
    const handleScroll = () => {
      setScrollPosition(window.scrollY);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Capture PWA install prompt so we can trigger it from a button (mobile & desktop)
  useEffect(() => {
    const handleBeforeInstallPrompt = (event: any) => {
      // Debug: log when Chrome fires the PWA install prompt
      // This helps verify installability in production.
      // eslint-disable-next-line no-console
      console.log("[PWA] beforeinstallprompt fired", {
        time: new Date().toISOString(),
        platform: (event as any).platforms,
      });
      event.preventDefault();
      setInstallPromptEvent(event);
    };

    window.addEventListener(
      "beforeinstallprompt",
      handleBeforeInstallPrompt as any,
    );

    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt as any,
      );
    };
  }, []);

  const handleInstallClick = async () => {
    // Debug: log click and whether we currently have a saved install event
    // eslint-disable-next-line no-console
    console.log("[PWA] Install button clicked", {
      hasEvent: !!installPromptEvent,
      time: new Date().toISOString(),
    });

    if (installPromptEvent) {
      try {
        // eslint-disable-next-line no-console
        console.log("[PWA] Calling prompt() for install");
        await installPromptEvent.prompt();
        await installPromptEvent.userChoice?.then?.((choiceResult: any) =>
          console.log("[PWA] User choice", {
            outcome: choiceResult?.outcome,
            platform: choiceResult?.platform,
          }),
        );
      } catch (error) {
        console.error("[PWA] Error during install prompt", error);
      } finally {
        setInstallPromptEvent(null);
      }
      return;
    }

    const ua = navigator.userAgent || "";
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    const isSafari =
      /Safari/i.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);

    if (isIOS && isSafari) {
      alert(t("navigation.install.iosSafariGuide"));
      return;
    }

    alert(t("navigation.install.genericGuide"));
  };

  // Calculate mask length based on scroll position
  const getMaskLength = () => {
    // When at top (0), use longer mask (200px)
    // When scrolled down (300px+), use shorter mask (100px)
    const maxScroll = 300;
    const minLength = 100;
    const maxLength = 180;
    const scrollFactor = Math.min(scrollPosition, maxScroll) / maxScroll;
    return minLength + (maxLength - minLength) * (1 - scrollFactor);
  };

  const enableLowPerformanceMode = usePreferencesStore(
    (s) => s.enableLowPerformanceMode,
  );

  return (
    <>
      {/* lightbar */}
      {!props.noLightbar ? (
        <div
          className="absolute inset-x-0 top-0 flex h-[88px] items-center justify-center"
          style={{
            top: `${bannerHeight}px`,
          }}
        >
          <div className="absolute inset-x-0 -mt-[22%] flex items-center sm:mt-0">
            <Lightbar noParticles={enableLowPerformanceMode} />
          </div>
        </div>
      ) : null}

      {/* backgrounds - these are seperate because of z-index issues */}
      <div
        className="top-content fixed z-[20] pointer-events-none left-0 right-0 top-0 min-h-[150px]"
        style={{
          top: `${bannerHeight}px`,
        }}
      >
        <div
          className={classNames(
            "fixed left-0 right-0 top-0 flex items-center", // border-b border-utils-divider border-opacity-50
            "transition-[background-color,backdrop-filter] duration-300 ease-in-out",
            props.doBackground
              ? props.clearBackground
                ? "backdrop-blur-md bg-transparent"
                : "bg-background-main"
              : "bg-transparent",
          )}
        >
          {props.doBackground ? (
            <div className="absolute w-full h-full inset-0 overflow-hidden">
              <BlurEllipsis positionClass="absolute" />
            </div>
          ) : null}
          <div className="opacity-0 absolute inset-0 block h-20 pointer-events-auto" />
          <div
            className={classNames(
              "transition-[background-color,backdrop-filter,opacity] duration-300 ease-in-out",
              props.bg ? "opacity-100" : "opacity-0",
              "absolute inset-0 block h-[11rem]",
              props.clearBackground
                ? "backdrop-blur-md bg-transparent"
                : "bg-background-main",
            )}
            style={{
              maskImage: `linear-gradient(
                to bottom,
                rgba(0, 0, 0, 1),
                rgba(0, 0, 0, 1) calc(100% - ${getMaskLength()}px),
                rgba(0, 0, 0, 0) 100%
              )`,
              WebkitMaskImage: `linear-gradient(
                to bottom,
                rgba(0, 0, 0, 1),
                rgba(0, 0, 0, 1) calc(100% - ${getMaskLength()}px),
                rgba(0, 0, 0, 0) 100%
              )`,
            }}
          />
        </div>
      </div>

      {/* content */}
      <div
        className="top-content fixed pointer-events-none left-0 right-0 z-[500] top-0 min-h-[150px]"
        style={{
          top: `${bannerHeight}px`,
        }}
      >
        <div className={classNames("fixed left-0 right-0 flex items-center")}>
          <div className="px-7 py-5 relative z-[60] flex flex-1 items-center justify-between">
            <div className="flex items-center space-x-1.5 ssm:space-x-3 pointer-events-auto">
              {location.pathname !== "/login" &&
                location.pathname !== "/register" && (
                  <Link
                    className="block tabbable rounded-full text-xs ssm:text-base"
                    to="/discover"
                    onClick={() => window.scrollTo(0, 0)}
                  >
                    <BrandPill clickable header />
                  </Link>
                )}
              {!enableLowPerformanceMode &&
                location.pathname !== "/login" &&
                location.pathname !== "/register" &&
                location.pathname !== "/settings" &&
                (location.pathname === "/discover" ? (
                  <Link
                    to="/browse"
                    onClick={() => window.scrollTo(0, 0)}
                    className="text-lg text-white tabbable rounded-full backdrop-blur-lg"
                  >
                    <IconPatch
                      icon={Icons.SEARCH}
                      clickable
                      downsized
                      navigation
                    />
                  </Link>
                ) : (
                  <Link
                    to="/discover"
                    onClick={() => window.scrollTo(0, 0)}
                    className="text-xl text-white tabbable rounded-full backdrop-blur-lg"
                  >
                    <IconPatch
                      icon={Icons.RISING_STAR}
                      clickable
                      downsized
                      navigation
                    />
                  </Link>
                ))}
              {location.pathname !== "/login" &&
                location.pathname !== "/settings" &&
                location.pathname !== "/register" && (
                  <WatchPartyInputLink triggerVariant="icon" />
                )}

              {/* {location.pathname !== "/login" &&
                location.pathname !== "/settings" &&
                location.pathname !== "/register" && (
                  <button
                    type="button"
                    onClick={handleInstallClick}
                    className="text-xl text-white tabbable rounded-full backdrop-blur-lg"
                  >
                    <IconPatch
                      icon={Icons.DOWNLOAD}
                      clickable
                      downsized
                      navigation
                    />
                  </button>
                )} */}
              {/* <a
                onClick={() => openNotifications()}
                rel="noreferrer"
                className="text-xl text-white tabbable rounded-full backdrop-blur-lg relative"
              >
                <IconPatch icon={Icons.BELL} clickable downsized navigation />
                {(() => {
                  const count = getUnreadCount();
                  const shouldShow =
                    typeof count === "number" ? count > 0 : count === "99+";
                  return shouldShow ? (
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
                      {count}
                    </span>
                  ) : null;
                })()}
              </a> */}
            </div>
            {location.pathname !== "/login" &&
              location.pathname !== "/register" && (
                <div className="relative pointer-events-auto">
                  <LinksDropdown>
                    {loggedIn ? <UserAvatar withName /> : <NoUserAvatar />}
                  </LinksDropdown>
                </div>
              )}
          </div>
        </div>
      </div>
    </>
  );
}
