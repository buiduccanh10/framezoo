import classNames from "classnames";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";

import { IconPatch } from "@/components/buttons/IconPatch";
import { Icons } from "@/components/Icon";
import { WatchPartyInputLink } from "@/components/LinksDropdown";
import { useIsDesktopApp } from "@/hooks/useIsDesktopApp";
import { checkForAppUpdate } from "@/setup/appUpdate";
import { useOverlayStack } from "@/stores/interface/overlayStack";

import { AddonManager } from "./AddonManager";
import {
  StatusIndicators,
  getFreeSpacePercent,
  useAppUpdateIndicator,
} from "./StatusIndicators";

export { getFreeSpacePercent };

export function NavActionsCollapsible() {
  const location = useLocation();
  const { t } = useTranslation();
  const isDesktopApp = useIsDesktopApp();
  const { hasVisibleUpdate, isUpdatingApp } = useAppUpdateIndicator();
  const [isExpanded, setIsExpanded] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsExpanded(true);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      setIsExpanded(false);
    }, 500);
  };

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleManualUpdateCheck = async () => {
    const foundUpdate = await checkForAppUpdate();
    if (!foundUpdate) {
      window.alert(t("settings.sidebar.info.upToDate"));
    }
  };

  return (
    <div
      className="relative flex w-fit flex-none items-center h-14 py-2 -my-2"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <div
        className="flex items-center"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* Menu Anchor Button */}
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          className="relative z-10 shrink-0 text-xl text-white tabbable rounded-full backdrop-blur-lg cursor-pointer flex items-center justify-center overflow-visible"
          aria-label="Menu tiện ích"
          title="Menu tiện ích"
        >
          <div
            className={classNames(
              "transition-transform duration-300 ease-out flex items-center justify-center",
              isExpanded ? "rotate-90" : "rotate-0",
            )}
          >
            <IconPatch
              icon={Icons.MENU}
              clickable
              downsized
              navigation
              active={isExpanded}
            />
          </div>
        </button>

        {/* The buttons emerging/sliding out horizontally from the menu button. */}
        <div
          className={classNames(
            "flex items-center gap-1.5 py-2 -my-2 transition-all duration-300 ease-in-out origin-left sm:gap-2",
            isExpanded
              ? "max-w-[500px] opacity-100 pointer-events-auto translate-x-0 px-2 sm:px-2.5 overflow-visible"
              : "max-w-0 opacity-0 pointer-events-none -translate-x-3 px-0 overflow-hidden",
          )}
        >
          {/* Subtle connector / separator line indicating emergence from menu */}
          <div
            className={classNames(
              "w-[1px] h-4 bg-white/20 shrink-0 transition-opacity duration-200",
              isExpanded ? "opacity-100" : "opacity-0",
            )}
          />

          {/* 1. Search / Discover Button */}
          <div
            className="shrink-0 flex items-center justify-center overflow-visible"
            title="Tìm kiếm"
          >
            {location.pathname === "/discover" ? (
              <Link
                to="/browse"
                onClick={() => window.scrollTo(0, 0)}
                className="shrink-0 text-xl text-white tabbable rounded-full backdrop-blur-lg flex items-center justify-center overflow-visible"
                title="Tìm kiếm"
              >
                <IconPatch icon={Icons.SEARCH} clickable downsized navigation />
              </Link>
            ) : (
              <Link
                to="/discover"
                onClick={() => window.scrollTo(0, 0)}
                className="shrink-0 text-xl text-white tabbable rounded-full backdrop-blur-lg flex items-center justify-center overflow-visible"
                title="Khám phá"
              >
                <IconPatch
                  icon={Icons.RISING_STAR}
                  clickable
                  downsized
                  navigation
                />
              </Link>
            )}
          </div>

          {/* 2. Bookmarks Button */}
          <div
            className="shrink-0 flex items-center justify-center overflow-visible"
            title={t("home.bookmarks.sectionTitle")}
          >
            <Link
              to="/marked"
              onClick={() => window.scrollTo(0, 0)}
              className="shrink-0 text-xl text-white tabbable rounded-full backdrop-blur-lg flex items-center justify-center overflow-visible"
              title={t("home.bookmarks.sectionTitle")}
              aria-label={t("home.bookmarks.sectionTitle")}
            >
              <IconPatch
                icon={
                  location.pathname === "/marked" ||
                  location.pathname === "/bookmarks"
                    ? Icons.BOOKMARK
                    : Icons.BOOKMARK_OUTLINE
                }
                clickable
                downsized
                navigation
                active={
                  location.pathname === "/marked" ||
                  location.pathname === "/bookmarks"
                }
              />
            </Link>
          </div>

          {/* 3. Watch History Button */}
          <div
            className="shrink-0 flex items-center justify-center overflow-visible"
            title={t("home.watchHistory.sectionTitle")}
          >
            <Link
              to="/watch-history"
              onClick={() => window.scrollTo(0, 0)}
              className="shrink-0 text-xl text-white tabbable rounded-full backdrop-blur-lg flex items-center justify-center overflow-visible"
              title={t("home.watchHistory.sectionTitle")}
              aria-label={t("home.watchHistory.sectionTitle")}
            >
              <IconPatch
                icon={
                  location.pathname === "/watch-history"
                    ? Icons.CLOCK
                    : Icons.CLOCK_OUTLINE
                }
                clickable
                downsized
                navigation
                active={location.pathname === "/watch-history"}
              />
            </Link>
          </div>

          {/* 4. Watch Party Button */}
          <div
            className="shrink-0 flex items-center justify-center overflow-visible"
            title="Xem cùng bạn bè"
          >
            <WatchPartyInputLink />
          </div>

          {/* 3. Addon Manager Button */}
          <div
            className="shrink-0 flex items-center justify-center overflow-visible"
            title="Tiện ích bổ sung"
          >
            <AddonManager>
              {(open) => (
                <button
                  type="button"
                  onClick={open}
                  className="shrink-0 text-xl text-white tabbable rounded-full backdrop-blur-lg cursor-pointer flex items-center justify-center overflow-visible"
                  title="Tiện ích bổ sung"
                  aria-label="Tiện ích bổ sung"
                >
                  <IconPatch
                    icon={Icons.EXTENSION}
                    clickable
                    downsized
                    navigation
                  />
                </button>
              )}
            </AddonManager>
          </div>

          {/* 4. Feedback Button */}
          <div
            className="shrink-0 flex items-center justify-center overflow-visible"
            title="Gửi phản hồi"
          >
            <button
              type="button"
              onClick={() => useOverlayStack.getState().showModal("feedback")}
              className="shrink-0 text-xl text-white tabbable rounded-full backdrop-blur-lg cursor-pointer flex items-center justify-center overflow-visible"
              title="Gửi phản hồi"
              aria-label="Gửi phản hồi"
            >
              <IconPatch icon={Icons.FEEDBACK} clickable downsized navigation />
            </button>
          </div>

          {isDesktopApp && !hasVisibleUpdate ? (
            <div
              className="shrink-0 flex items-center justify-center overflow-visible"
              title={t("settings.sidebar.info.checkForUpdates")}
            >
              <button
                type="button"
                onClick={() => void handleManualUpdateCheck()}
                disabled={isUpdatingApp}
                className="shrink-0 text-xl text-white tabbable rounded-full backdrop-blur-lg cursor-pointer flex items-center justify-center overflow-visible disabled:cursor-not-allowed disabled:opacity-60"
                aria-label={t("settings.sidebar.info.checkForUpdates")}
              >
                <IconPatch
                  icon={isUpdatingApp ? Icons.PROGRESS_SPINNER : Icons.DOWNLOAD}
                  clickable
                  downsized
                  navigation
                />
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <StatusIndicators showUpdate className="ml-1.5" />
    </div>
  );
}
