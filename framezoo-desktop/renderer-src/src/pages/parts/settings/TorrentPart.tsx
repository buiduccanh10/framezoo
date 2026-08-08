import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Dropdown } from "@/components/form/Dropdown";
import { SettingsCard } from "@/components/layout/SettingsCard";
import { Heading1 } from "@/components/utils/Text";
import { usePreferencesStore } from "@/stores/preferences";

const PREDEFINED_OPTIONS = [
  { id: "2147483648", name: "2 GB" },
  { id: "5368709120", name: "5 GB" },
  { id: "10737418240", name: "10 GB" },
  { id: "53687091200", name: "50 GB" },
  { id: "unlimited", name: "Unlimited" },
  { id: "custom", name: "Custom..." },
];

export function TorrentPart() {
  const { t } = useTranslation();
  const torrentMaxSize = usePreferencesStore((s) => s.torrentMaxSize);
  const setTorrentMaxSize = usePreferencesStore((s) => s.setTorrentMaxSize);

  // Determine initial selected item based on store
  const getInitialOption = () => {
    if (!torrentMaxSize)
      return PREDEFINED_OPTIONS.find((o) => o.id === "5368709120")!;
    const predefined = PREDEFINED_OPTIONS.find((o) => o.id === torrentMaxSize);
    if (predefined) return predefined;
    return PREDEFINED_OPTIONS.find((o) => o.id === "custom")!;
  };

  const [selectedItem, setSelectedItem] = useState(getInitialOption());
  const [customValue, setCustomValue] = useState("");

  // Initialize custom input if it's a custom value
  useEffect(() => {
    if (
      torrentMaxSize &&
      !PREDEFINED_OPTIONS.find((o) => o.id === torrentMaxSize)
    ) {
      setSelectedItem(PREDEFINED_OPTIONS.find((o) => o.id === "custom")!);
      const gbValue = (
        parseInt(torrentMaxSize, 10) /
        (1024 * 1024 * 1024)
      ).toFixed(2);
      setCustomValue(gbValue.replace(/\.00$/, ""));
    } else if (!torrentMaxSize) {
      setSelectedItem(PREDEFINED_OPTIONS.find((o) => o.id === "5368709120")!);
    } else {
      setSelectedItem(PREDEFINED_OPTIONS.find((o) => o.id === torrentMaxSize)!);
    }
  }, [torrentMaxSize]);

  const handleSelect = (item: (typeof PREDEFINED_OPTIONS)[0]) => {
    setSelectedItem(item);
    if (item.id === "custom") {
      return;
    }
    if (item.id === "unlimited") {
      setTorrentMaxSize("1099511627776000"); // 1000 TB
      return;
    }
    setTorrentMaxSize(item.id);
  };

  const handleCustomBlur = () => {
    if (selectedItem.id !== "custom") return;
    const parsed = parseFloat(customValue);
    if (isNaN(parsed) || parsed <= 0) {
      setCustomValue("5");
      setTorrentMaxSize("5368709120");
    } else {
      const bytes = Math.floor(parsed * 1024 * 1024 * 1024);
      setTorrentMaxSize(bytes.toString());
    }
  };

  // Ensure "Unlimited" and "Custom" are translated
  const translatedOptions = PREDEFINED_OPTIONS.map((opt) => ({
    ...opt,
    name:
      opt.id === "unlimited"
        ? t("settings.torrent.unlimited", "Unlimited")
        : opt.id === "custom"
          ? t("settings.torrent.custom", "Custom...")
          : opt.name,
  }));

  const activeOption =
    translatedOptions.find((o) => o.id === selectedItem.id) ||
    translatedOptions[0];

  return (
    <div>
      <Heading1 border>{t("settings.torrent.title", "Torrent Cache")}</Heading1>
      <div className="space-y-6">
        <SettingsCard>
          <div className="my-3">
            <p className="text-white font-bold mb-3">
              {t("settings.torrent.maxSizeLabel", "Maximum Cache Size")}
            </p>
            <p className="max-w-[40rem] font-medium mb-6 text-type-secondary">
              {t(
                "settings.torrent.maxSizeDescription",
                "Set the maximum amount of disk space the torrent engine can use for caching downloaded pieces. If the cache exceeds this limit, older pieces will be deleted.",
              )}
            </p>
            <div className="flex items-center w-full max-w-sm gap-4">
              <Dropdown
                selectedItem={activeOption}
                setSelectedItem={handleSelect}
                options={translatedOptions}
                className="w-48 !my-0"
              />
              {selectedItem.id === "custom" && (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    step="1"
                    className="w-24 px-3 py-2 bg-authentication-inputBg border border-authentication-inputBorder rounded-xl text-white outline-none focus:border-authentication-inputBorderFocus transition-colors"
                    value={customValue}
                    onChange={(e) => setCustomValue(e.target.value)}
                    onBlur={handleCustomBlur}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleCustomBlur();
                      }
                    }}
                    placeholder="e.g. 15"
                  />
                  <span className="text-type-secondary">GB</span>
                </div>
              )}
            </div>
          </div>
        </SettingsCard>
      </div>
    </div>
  );
}
