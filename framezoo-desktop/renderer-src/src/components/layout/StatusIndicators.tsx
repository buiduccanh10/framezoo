import classNames from "classnames";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Icon, Icons } from "@/components/Icon";
import type { TorrentStorageInfo } from "@/desktop/torrentTypes";
import { useIsDesktopApp } from "@/hooks/useIsDesktopApp";
import { requestAppUpdate } from "@/setup/appUpdate";
import { useAppUpdateStore } from "@/stores/appUpdate";
import { useBannerStore } from "@/stores/banner";

export const LOW_SPACE_THRESHOLD_BYTES = 2 * 1024 * 1024 * 1024;

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

export function useStorageWarning() {
  const isDesktopApp = useIsDesktopApp();
  const [storageInfo, setStorageInfo] = useState<TorrentStorageInfo | null>(
    null,
  );

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

  const isLowSpace =
    isDesktopApp &&
    storageInfo !== null &&
    storageInfo.freeBytes < LOW_SPACE_THRESHOLD_BYTES;

  const freeSpacePercent = getFreeSpacePercent(
    storageInfo?.freeBytes,
    storageInfo?.totalBytes,
  );

  return { isLowSpace, freeSpacePercent, storageInfo };
}

export function useAppUpdateIndicator() {
  const isDesktopApp = useIsDesktopApp();
  const { t } = useTranslation();
  const updateStatus = useAppUpdateStore((s) => s.status);
  const updateVersion = useAppUpdateStore((s) => s.updateVersion);
  const isUpdatingApp = useAppUpdateStore((s) => s.isUpdating);
  const updateProgressPercent = useAppUpdateStore((s) => s.progressPercent);

  const hasVisibleUpdate =
    isDesktopApp &&
    (updateStatus === "available" ||
      updateStatus === "downloading" ||
      updateStatus === "downloaded" ||
      (updateStatus === "checking" && Boolean(updateVersion)));

  const updateButtonIcon =
    updateStatus === "downloaded"
      ? Icons.RELOAD
      : updateStatus === "downloading" || updateStatus === "checking"
        ? Icons.PROGRESS_SPINNER
        : Icons.DOWNLOAD;

  const updateButtonText =
    updateStatus === "downloaded"
      ? t("navigation.banner.appUpdate.restart")
      : updateStatus === "downloading"
        ? updateProgressPercent != null
          ? `${t("navigation.banner.appUpdate.updating")} ${Math.round(updateProgressPercent)}%`
          : `${t("navigation.banner.appUpdate.updating")}...`
        : updateStatus === "checking"
          ? `${t("navigation.banner.appUpdate.updating")}...`
          : updateVersion
            ? `v${updateVersion}`
            : t("navigation.banner.appUpdate.download");

  return {
    hasVisibleUpdate,
    updateButtonIcon,
    updateButtonText,
    isUpdatingApp,
    visibleUpdateStatus: updateStatus,
  };
}

export function StatusIndicators(props: {
  showUpdate?: boolean;
  className?: string;
  itemClassName?: string;
}) {
  const isOnline = useBannerStore((s) => s.isOnline);
  const isOffline = !isOnline;
  const { isLowSpace, freeSpacePercent } = useStorageWarning();
  const {
    hasVisibleUpdate,
    updateButtonIcon,
    updateButtonText,
    isUpdatingApp,
    visibleUpdateStatus,
  } = useAppUpdateIndicator();
  const { t } = useTranslation();

  const shouldShowUpdate = Boolean(props.showUpdate && hasVisibleUpdate);

  if (!shouldShowUpdate && !isOffline && !isLowSpace) return null;

  const offlineTooltip = t("navigation.status.offline");
  const lowSpaceTooltip =
    freeSpacePercent !== null
      ? t("navigation.status.lowSpaceWithPercent", {
          percent: freeSpacePercent,
        })
      : t("navigation.status.lowSpace");

  return (
    <div
      className={classNames(
        "flex shrink-0 items-center gap-1.5",
        props.className,
      )}
    >
      {shouldShowUpdate && (
        <button
          type="button"
          onClick={() => void requestAppUpdate()}
          disabled={
            isUpdatingApp ||
            visibleUpdateStatus === "downloading" ||
            visibleUpdateStatus === "checking"
          }
          className={classNames(
            "flex h-10 shrink-0 items-center gap-1.5 rounded-full border-2 border-transparent bg-pill-background/50 px-3 text-white backdrop-blur-lg transition-[background-color,transform] hover:bg-pill-backgroundHover hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60",
            props.itemClassName,
          )}
          aria-label={updateButtonText}
          title={updateButtonText}
        >
          <Icon
            icon={updateButtonIcon}
            className={classNames(
              "text-lg text-emerald-300",
              visibleUpdateStatus === "downloading" && "animate-spin",
            )}
          />
          <span className="max-w-[10rem] truncate text-xs font-semibold tabular-nums text-emerald-200">
            {updateButtonText}
          </span>
        </button>
      )}

      {isOffline && (
        <div
          className={classNames(
            "cursor-default flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-transparent bg-pill-background/50 text-red-400 backdrop-blur-lg",
            props.itemClassName,
          )}
          role="status"
          aria-label={offlineTooltip}
          title={offlineTooltip}
        >
          <Icon icon={Icons.WIFI_OFF} className="text-lg text-red-400" />
        </div>
      )}

      {isLowSpace && (
        <div
          className={classNames(
            "cursor-default flex h-10 shrink-0 items-center gap-1.5 rounded-full border-2 border-transparent bg-pill-background/50 px-3 text-red-400 backdrop-blur-lg",
            props.itemClassName,
          )}
          role="status"
          aria-label={lowSpaceTooltip}
          title={lowSpaceTooltip}
        >
          <Icon icon={Icons.HARD_DRIVE} className="text-lg text-red-400" />
          {freeSpacePercent !== null && (
            <span className="text-xs font-semibold tabular-nums">
              {freeSpacePercent}%
            </span>
          )}
        </div>
      )}
    </div>
  );
}
