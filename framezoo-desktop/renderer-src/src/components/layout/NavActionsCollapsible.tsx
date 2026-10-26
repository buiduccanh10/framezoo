import classNames from "classnames";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";

import { IconPatch } from "@/components/buttons/IconPatch";
import { Icons } from "@/components/Icon";
import { WatchPartyInputLink } from "@/components/LinksDropdown";
import type { TorrentStorageInfo } from "@/desktop/torrentTypes";
import { useIsDesktopApp } from "@/hooks/useIsDesktopApp";
import { checkForAppUpdate, requestAppUpdate } from "@/setup/appUpdate";
import { useAppUpdateStore } from "@/stores/appUpdate";
import { useBannerStore } from "@/stores/banner";
import { useOverlayStack } from "@/stores/interface/overlayStack";

import { AddonManager } from "./AddonManager";

const LOW_SPACE_THRESHOLD_BYTES = 2 * 1024 * 1024 * 1024;
// Temporary dev-only preview for manual visual QA. Remove after status UI sign-off.
const FORCE_STATUS_INDICATORS = import.meta.env.DEV;
// Set null to exercise the real updater; change state to preview each button.
const FORCE_UPDATE_STATE: "available" | "downloading" | "downloaded" | null =
  import.meta.env.DEV ? "available" : null;
const FORCE_UPDATE_VERSION = "2.0.7";
const FORCE_UPDATE_PROGRESS_PERCENT = 42;

export function getFreeSpacePercent(
  freeBytes?: number,
  totalBytes?: number,
): number | null {
  if (
    freeBytes === undefined ||
    totalBytes === undefined ||
    !Number.isFinite(freeBytes) ||
    !Number.isFinite(totalBytes) ||
    totalBytes <= 0
  ) {
    return null;
  }

  return Math.max(0, Math.min(100, Math.round((freeBytes / totalBytes) * 100)));
}

export function NavActionsCollapsible() {
  const location = useLocation();
  const { t } = useTranslation();
  const isDesktopApp = useIsDesktopApp();
  const isOnline = useBannerStore((s) => s.isOnline);
  const hasUpdate = useAppUpdateStore((s) => s.hasUpdate);
  const updateStatus = useAppUpdateStore((s) => s.status);
  const updateVersion = useAppUpdateStore((s) => s.updateVersion);
  const isUpdatingApp = useAppUpdateStore((s) => s.isUpdating);
  const updateProgressPercent = useAppUpdateStore((s) => s.progressPercent);
  const [storageInfo, setStorageInfo] = useState<TorrentStorageInfo | null>(
    null,
  );
  const [isExpanded, setIsExpanded] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (
      !isDesktopApp ||
      typeof window.electronAPI?.getTorrentStorageInfo !== "function"
    ) {
      return;
    }

    let cancelled = false;
    const refreshStorageInfo = async () => {
      try {
        const nextInfo = await window.electronAPI!.getTorrentStorageInfo!();
        if (!cancelled) setStorageInfo(nextInfo ?? null);
      } catch {
        if (!cancelled) setStorageInfo(null);
      }
    };

    void refreshStorageInfo();
    const interval = window.setInterval(refreshStorageInfo, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [isDesktopApp]);

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
    }, 200);
  };

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const previewUpdateStatus =
    FORCE_UPDATE_STATE !== null && updateStatus === "idle"
      ? FORCE_UPDATE_STATE
      : null;
  const visibleUpdateStatus = previewUpdateStatus ?? updateStatus;
  const visibleUpdateVersion = previewUpdateStatus
    ? FORCE_UPDATE_VERSION
    : updateVersion;
  const visibleUpdateProgress = previewUpdateStatus
    ? FORCE_UPDATE_PROGRESS_PERCENT
    : updateProgressPercent;
  const hasVisibleUpdate =
    isDesktopApp &&
    (previewUpdateStatus !== null || hasUpdate) &&
    (visibleUpdateStatus === "available" ||
      visibleUpdateStatus === "downloading" ||
      visibleUpdateStatus === "downloaded");
  const isOffline = (isDesktopApp && FORCE_STATUS_INDICATORS) || !isOnline;
  const isLowSpace =
    isDesktopApp &&
    (FORCE_STATUS_INDICATORS ||
      (storageInfo !== null &&
        storageInfo.freeBytes < LOW_SPACE_THRESHOLD_BYTES));
  const freeSpacePercent =
    isDesktopApp && FORCE_STATUS_INDICATORS
      ? 7
      : getFreeSpacePercent(storageInfo?.freeBytes, storageInfo?.totalBytes);

  const updateButtonIcon =
    visibleUpdateStatus === "downloaded"
      ? Icons.RELOAD
      : visibleUpdateStatus === "downloading"
        ? Icons.PROGRESS_SPINNER
        : Icons.DOWNLOAD;
  const updateButtonText =
    visibleUpdateStatus === "downloaded"
      ? t("navigation.banner.appUpdate.restart")
      : visibleUpdateStatus === "downloading"
        ? visibleUpdateProgress != null
          ? `${t("navigation.banner.appUpdate.updating")} ${Math.round(visibleUpdateProgress)}%`
          : t("navigation.banner.appUpdate.updating")
        : visibleUpdateVersion
          ? `v${visibleUpdateVersion}`
          : t("navigation.banner.appUpdate.download");

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

        {/* The 4 buttons emerging/sliding out horizontally from the menu button. */}
        <div
          className={classNames(
            "flex max-w-[calc(100vw-8rem)] items-center gap-1.5 overflow-x-auto overflow-y-visible scrollbar-none py-2 -my-2 transition-all duration-300 ease-out origin-left sm:gap-2",
            isExpanded
              ? "opacity-100 pointer-events-auto translate-x-0 pl-1.5 sm:pl-2"
              : "max-w-0 opacity-0 pointer-events-none -translate-x-5 pl-0",
          )}
          style={{
            overflow: isExpanded ? "auto" : "hidden",
          }}
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
                className="shrink-0 text-lg text-white tabbable rounded-full backdrop-blur-lg flex items-center justify-center overflow-visible"
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

          {/* 2. Watch Party Button */}
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

      <div className="flex shrink-0 items-center gap-1">
        {hasVisibleUpdate ? (
          <button
            type="button"
            onClick={() => void requestAppUpdate()}
            disabled={isUpdatingApp || visibleUpdateStatus === "downloading"}
            className="flex shrink-0 items-center gap-1 rounded-lg border-2 border-transparent bg-pill-background/50 px-1 text-white transition-colors hover:bg-pill-backgroundHover disabled:cursor-not-allowed disabled:opacity-60"
            aria-label={updateButtonText}
            title={updateButtonText}
          >
            <IconPatch
              icon={updateButtonIcon}
              transparent
              downsized
              className={classNames(
                "text-emerald-300",
                visibleUpdateStatus === "downloading" && "animate-spin",
              )}
            />
            <span className="max-w-[10rem] truncate pr-1 text-xs font-semibold tabular-nums text-emerald-200">
              {updateButtonText}
            </span>
          </button>
        ) : null}

        {isOffline ? (
          <div
            className="pointer-events-none mr-1 flex shrink-0 items-center"
            role="status"
            aria-label={t("navigation.banner.offline")}
            title={t("navigation.banner.offline")}
          >
            <IconPatch
              icon={Icons.WIFI_OFF}
              downsized
              navigation
              className="text-red-400"
            />
          </div>
        ) : null}

        {isLowSpace ? (
          <div
            className="pointer-events-none mr-1 flex shrink-0 items-center gap-0.5 rounded-lg border-2 border-transparent bg-pill-background/50 px-1 text-red-400"
            role="status"
            aria-label={t("navigation.banner.lowSpace")}
            title={t("navigation.banner.lowSpace")}
          >
            <IconPatch
              icon={Icons.HARD_DRIVE}
              transparent
              downsized
              className="text-red-400"
            />
            {freeSpacePercent !== null ? (
              <span className="text-xs font-semibold tabular-nums">
                {freeSpacePercent}%
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
