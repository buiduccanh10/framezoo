import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/buttons/Button";
import { Dropdown } from "@/components/form/Dropdown";
import { SettingsCard } from "@/components/layout/SettingsCard";
import { Heading1 } from "@/components/utils/Text";
import type {
  TorrentProfile,
  TorrentStorageInfo,
} from "@/desktop/torrentTypes";
import { useToastStore } from "@/stores/interface/toast";
import { usePreferencesStore } from "@/stores/preferences";

const GIB = 1024 ** 3;
const DEFAULT_MAX_SIZE_BYTES = 5 * GIB;
const SIZE_OPTIONS = [
  { id: "0", key: "noCaching", fallback: "No caching" },
  { id: String(2 * GIB), name: "2 GiB" },
  { id: String(5 * GIB), name: "5 GiB" },
  { id: String(10 * GIB), name: "10 GiB" },
  { id: "unlimited", key: "infinite", fallback: "Infinite" },
  { id: "custom", key: "custom", fallback: "Custom..." },
];
const PROFILE_OPTIONS: Array<{
  id: TorrentProfile;
  key: string;
  fallback: string;
}> = [
  { id: "default", key: "profileDefault", fallback: "Default" },
  { id: "soft", key: "profileSoft", fallback: "Soft" },
  { id: "fast", key: "profileFast", fallback: "Fast" },
  { id: "ultra-fast", key: "profileUltraFast", fallback: "Ultra Fast" },
];

function optionForSize(value: string | null) {
  return (
    SIZE_OPTIONS.find(
      (option) => option.id === (value ?? String(DEFAULT_MAX_SIZE_BYTES)),
    ) ?? SIZE_OPTIONS.find((option) => option.id === "custom")!
  );
}

function getMaxSizeBytes(value: string | null): number | null {
  if (value === "unlimited") return null;
  if (value === null) return DEFAULT_MAX_SIZE_BYTES;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_MAX_SIZE_BYTES;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** unitIndex;

  return `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits: unitIndex === 0 ? 0 : 2,
  }).format(value)} ${units[unitIndex]}`;
}

function shortPath(value: string) {
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join("/") || value;
}

async function getTorrentStorageInfo(): Promise<TorrentStorageInfo | null> {
  if (typeof window.electronAPI?.getTorrentStorageInfo !== "function") {
    return null;
  }

  return window.electronAPI.getTorrentStorageInfo();
}

export function TorrentPart() {
  const { t } = useTranslation();
  const showToast = useToastStore((s) => s.showToast);
  const torrentMaxSize = usePreferencesStore((s) => s.torrentMaxSize);
  const setTorrentMaxSize = usePreferencesStore((s) => s.setTorrentMaxSize);
  const torrentCacheRoot = usePreferencesStore((s) => s.torrentCacheRoot);
  const setTorrentCacheRoot = usePreferencesStore((s) => s.setTorrentCacheRoot);
  const torrentProfile = usePreferencesStore((s) => s.torrentProfile);
  const setTorrentProfile = usePreferencesStore((s) => s.setTorrentProfile);

  const [selectedSize, setSelectedSize] = useState(() =>
    optionForSize(torrentMaxSize),
  );
  const [customValue, setCustomValue] = useState("");
  const [storageInfo, setStorageInfo] = useState<TorrentStorageInfo | null>(
    null,
  );
  const [isClearing, setIsClearing] = useState(false);
  const [isChoosingDrive, setIsChoosingDrive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refreshStorageInfo = async () => {
      try {
        const nextInfo = await getTorrentStorageInfo();
        if (!cancelled && nextInfo) setStorageInfo(nextInfo);
      } catch {
        if (!cancelled) setStorageInfo(null);
      }
    };

    void refreshStorageInfo();
    const interval = window.electronAPI?.getTorrentStorageInfo
      ? window.setInterval(refreshStorageInfo, 5000)
      : undefined;
    return () => {
      cancelled = true;
      if (interval) window.clearInterval(interval);
    };
  }, [torrentCacheRoot, torrentMaxSize]);

  useEffect(() => {
    setSelectedSize(optionForSize(torrentMaxSize));
    if (
      torrentMaxSize &&
      !SIZE_OPTIONS.some((option) => option.id === torrentMaxSize)
    ) {
      setCustomValue((Number(torrentMaxSize) / GIB).toString());
    }
  }, [torrentMaxSize]);

  const sizeOptions = useMemo(
    () =>
      SIZE_OPTIONS.map((option) => ({
        id: option.id,
        name: option.key
          ? t(`settings.torrent.${option.key}`, option.fallback)
          : option.name!,
      })),
    [t],
  );
  const activeSizeOption = sizeOptions.find(
    (option) => option.id === selectedSize.id,
  )!;

  const profileOptions = useMemo(
    () =>
      PROFILE_OPTIONS.map((option) => ({
        id: option.id,
        name: t(`settings.torrent.${option.key}`, option.fallback),
      })),
    [t],
  );
  const activeProfileOption =
    profileOptions.find((option) => option.id === torrentProfile) ??
    profileOptions[0];

  const activeDriveId = torrentCacheRoot ? "custom" : "default";
  const driveOptions = [
    { id: "default", name: t("settings.torrent.defaultDrive", "Default") },
    ...(torrentCacheRoot
      ? [{ id: "custom", name: shortPath(torrentCacheRoot) }]
      : []),
    {
      id: "select",
      name: t("settings.torrent.selectDrive", "Select folder..."),
    },
  ];
  const activeDriveOption = driveOptions.find(
    (option) => option.id === activeDriveId,
  )!;

  const handleSizeSelect = (item: { id: string }) => {
    const next = SIZE_OPTIONS.find((option) => option.id === item.id);
    if (!next) return;
    setSelectedSize(next);
    if (next.id === "custom") {
      const bytes = getMaxSizeBytes(torrentMaxSize) ?? DEFAULT_MAX_SIZE_BYTES;
      setCustomValue((bytes / GIB).toString());
    } else {
      setTorrentMaxSize(next.id);
    }
  };

  const handleCustomBlur = () => {
    if (selectedSize.id !== "custom") return;
    const parsed = Number(customValue);
    const bytes = Math.floor(parsed * GIB);
    if (
      !Number.isFinite(parsed) ||
      parsed <= 0 ||
      !Number.isSafeInteger(bytes)
    ) {
      setCustomValue("5");
      setTorrentMaxSize(String(DEFAULT_MAX_SIZE_BYTES));
      return;
    }
    setTorrentMaxSize(String(bytes));
  };

  const handleDriveSelect = async (item: { id: string }) => {
    if (item.id !== "default" && item.id !== "select") return;
    if (typeof window.electronAPI?.setTorrentSettings !== "function") return;

    setIsChoosingDrive(true);
    try {
      let nextRoot: string | null = null;
      if (item.id === "select") {
        if (typeof window.electronAPI.selectTorrentCacheRoot !== "function")
          return;
        nextRoot = await window.electronAPI.selectTorrentCacheRoot();
        if (!nextRoot) return;
      }

      const applied = await window.electronAPI.setTorrentSettings({
        maxBytes: getMaxSizeBytes(torrentMaxSize),
        cacheRoot: nextRoot,
        profile: torrentProfile,
      });
      if (!applied) throw new Error("Torrent cache settings were rejected");
      setTorrentCacheRoot(nextRoot);
    } catch {
      showToast(
        t(
          "settings.torrent.selectDriveError",
          "Could not select cache folder.",
        ),
        "error",
      );
    } finally {
      setIsChoosingDrive(false);
    }
  };

  const handleClearCache = async () => {
    if (typeof window.electronAPI?.clearTorrentStorage !== "function") return;

    setIsClearing(true);
    try {
      const cleared = await window.electronAPI.clearTorrentStorage();
      if (!cleared) throw new Error("Failed to clear torrent storage");
      setStorageInfo(await getTorrentStorageInfo());
      showToast(t("settings.torrent.clearCacheSuccess", "Cache cleared"));
    } catch {
      showToast(
        t(
          "settings.torrent.clearCacheError",
          "Failed to clear cache. Please try again.",
        ),
        "error",
      );
    } finally {
      setIsClearing(false);
    }
  };

  const storageMaxLabel =
    storageInfo?.maxBytes === null
      ? t("settings.torrent.infinite", "Infinite")
      : storageInfo?.maxBytes === 0
        ? t("settings.torrent.noCaching", "No caching")
        : storageInfo
          ? formatBytes(storageInfo.maxBytes)
          : "";

  return (
    <div>
      <Heading1 border>{t("settings.torrent.title", "Streaming")}</Heading1>
      <SettingsCard>
        <div className="space-y-6 py-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <span className="text-white">
              {t("settings.torrent.maxSizeLabel", "Cache size")}
            </span>
            <div className="flex w-full max-w-md items-center gap-3 md:justify-end">
              <Dropdown
                selectedItem={activeSizeOption}
                setSelectedItem={handleSizeSelect}
                options={sizeOptions}
                className="min-w-[12rem] !my-0"
                preventWrap
              />
              {selectedSize.id === "custom" && (
                <div className="flex shrink-0 items-center gap-2">
                  <input
                    aria-label={t(
                      "settings.torrent.customSizeLabel",
                      "Custom cache size in GiB",
                    )}
                    type="number"
                    min="0.01"
                    step="0.1"
                    className="w-24 rounded-xl border border-authentication-inputBorder bg-authentication-inputBg px-3 py-2 text-white outline-none transition-colors focus:border-authentication-inputBorderFocus"
                    value={customValue}
                    onChange={(event) => setCustomValue(event.target.value)}
                    onBlur={handleCustomBlur}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") handleCustomBlur();
                    }}
                    placeholder={t(
                      "settings.torrent.customSizePlaceholder",
                      "e.g. 15",
                    )}
                  />
                  <span className="text-type-secondary">GiB</span>
                </div>
              )}
            </div>
          </div>

          <p className="-mt-3 max-w-[48rem] font-medium text-type-secondary">
            {t(
              "settings.torrent.cacheSizeBehaviorDescription",
              "Applies to new streams. Cache is pruned when idle torrent handles expire (up to 5 minutes after stopping). Playback can exceed the limit; no caching removes data when the stream stops, but pieces still use disk while playing.",
            )}
          </p>

          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <span className="text-white">
              {t("settings.torrent.cachingDriveLabel", "Caching drive")}
            </span>
            <div aria-busy={isChoosingDrive}>
              <Dropdown
                selectedItem={activeDriveOption}
                setSelectedItem={handleDriveSelect}
                options={driveOptions}
                className={`min-w-[12rem] max-w-md !my-0 md:w-96 ${isChoosingDrive ? "pointer-events-none opacity-60" : ""}`}
                preventWrap
              />
            </div>
          </div>
          <p className="-mt-3 max-w-[48rem] font-medium text-type-secondary">
            {torrentCacheRoot && (
              <span className="break-all" title={torrentCacheRoot}>
                {torrentCacheRoot} —{" "}
              </span>
            )}
            {torrentCacheRoot
              ? t(
                  "settings.torrent.cachingDriveDescription",
                  "New torrent data is stored in the Framezoo/torrents subfolder. Existing and active streams stay where they are.",
                )
              : t(
                  "settings.torrent.defaultDriveDescription",
                  "New torrent data uses the app's default location. Existing and active streams stay where they are.",
                )}
          </p>

          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <span className="text-white">
              {t("settings.torrent.torrentProfileLabel", "Torrent profile")}
            </span>
            <Dropdown
              selectedItem={activeProfileOption}
              setSelectedItem={(item: { id: string }) =>
                setTorrentProfile(item.id as TorrentProfile)
              }
              options={profileOptions}
              className="min-w-[12rem] max-w-md !my-0 md:w-96"
              preventWrap
            />
          </div>
          <p className="-mt-3 max-w-[48rem] font-medium text-type-secondary">
            {t(
              "settings.torrent.torrentProfileDescription",
              "Controls read-ahead for new streams: Soft 0.5×, Default 1×, Fast 1.5×, Ultra Fast 2×. Higher profiles may use more bandwidth and temporary disk space.",
            )}
          </p>

          <div className="border-t border-utils-divider/50 pt-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="mb-2 font-bold text-white">
                  {t("settings.torrent.currentSizeLabel", "Current cache size")}
                </p>
                <p className="font-medium text-type-secondary">
                  {storageInfo ? (
                    <>
                      {`${formatBytes(storageInfo.usedBytes)} / ${storageMaxLabel}`}
                      {storageInfo.freeBytes !== undefined && (
                        <span className="ml-2">
                          {t("settings.torrent.spaceLeftOnDevice", {
                            space: formatBytes(storageInfo.freeBytes),
                            defaultValue: `(${formatBytes(storageInfo.freeBytes)} space left on device)`,
                          })}
                        </span>
                      )}
                    </>
                  ) : (
                    t("settings.torrent.currentSizeLoading", "Loading...")
                  )}
                </p>
                <p className="mt-1 text-sm text-type-secondary">
                  {storageInfo?.path}
                </p>
              </div>
              <Button
                theme="purple"
                loading={isClearing}
                disabled={
                  typeof window.electronAPI?.clearTorrentStorage !== "function"
                }
                onClick={handleClearCache}
                className="w-full md:w-auto"
              >
                {t("settings.torrent.clearCache", "Clear cache")}
              </Button>
            </div>
          </div>
        </div>
      </SettingsCard>
    </div>
  );
}
