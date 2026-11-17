import classNames from "classnames";
import { ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/buttons/Button";
import { Toggle } from "@/components/buttons/Toggle";
import { FlagIcon } from "@/components/FlagIcon";
import { Dropdown } from "@/components/form/Dropdown";
import { SortableList } from "@/components/form/SortableList";
import { SettingsCard } from "@/components/layout/SettingsCard";
import { Heading1 } from "@/components/utils/Text";
import { useInstalledAddons } from "@/desktop/addons/store";
import { useIsDesktopApp } from "@/hooks/useIsDesktopApp";
import { appLanguageOptions } from "@/setup/i18n";
import { useOverlayStack } from "@/stores/interface/overlayStack";
import { DEFAULT_HOME_SECTIONS } from "@/stores/preferences";
import { isAutoplayAllowed } from "@/utils/autoplay";
import { getLocaleInfo, sortLangCodes } from "@/utils/language";

function PreferenceCard(props: {
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <SettingsCard
      className={classNames("flex flex-col gap-5 self-start", props.className)}
    >
      <div className="space-y-3">
        <p className="text-white font-bold">{props.title}</p>
        <p className="max-w-[32rem] font-medium">{props.description}</p>
      </div>
      <div className="space-y-4">{props.children}</div>
    </SettingsCard>
  );
}

function PreferenceToggleRow(props: {
  enabled: boolean;
  label: string;
  onClick?: () => void;
  locked?: boolean;
  dimmed?: boolean;
}) {
  return (
    <div
      onClick={props.locked ? undefined : props.onClick}
      className={classNames(
        "bg-dropdown-background select-none flex items-center gap-3 rounded-lg px-4 py-3",
        props.locked
          ? props.dimmed
            ? "cursor-not-allowed opacity-50 pointer-events-none"
            : "cursor-default pointer-events-none"
          : "cursor-pointer hover:bg-dropdown-hoverBackground",
      )}
    >
      <Toggle enabled={props.enabled} />
      <p className="flex-1 text-white font-bold">{props.label}</p>
    </div>
  );
}

export function PreferencesPart(props: {
  language: string;
  setLanguage: (l: string) => void;
  enableAutoplay: boolean;
  setEnableAutoplay: (v: boolean) => void;
  enableSkipCredits: boolean;
  setEnableSkipCredits: (v: boolean) => void;
  enableAutoSkipSegments: boolean;
  setEnableAutoSkipSegments: (v: boolean) => void;
  autoUpdateEnabled: boolean;
  setAutoUpdateEnabled: (v: boolean) => void;
  homeSectionOrder: string[];
  setHomeSectionOrder: (v: string[]) => void;
}) {
  const { t } = useTranslation();
  const isDesktopApp = useIsDesktopApp();
  const { showModal } = useOverlayStack();
  const addons = useInstalledAddons();
  const sorted = sortLangCodes(appLanguageOptions.map((item) => item.code));

  const allowAutoplay = isAutoplayAllowed();
  const autoplayEnabled = allowAutoplay;

  const options = appLanguageOptions
    .sort((a, b) => sorted.indexOf(a.code) - sorted.indexOf(b.code))
    .map((opt) => ({
      id: opt.code,
      name: `${opt.name}${opt.nativeName ? ` — ${opt.nativeName}` : ""}`,
      leftIcon: <FlagIcon langCode={opt.code} />,
    }));

  const selected = options.find(
    (item) => item.id === getLocaleInfo(props.language)?.code,
  );

  const getSectionName = (id: string) => {
    if (id.startsWith("addon:")) {
      const addonId = id.replace("addon:", "");
      const addon = addons.find((a) => a.manifest.id === addonId);
      return addon ? `${addon.manifest.name} (Addon)` : id;
    }
    switch (id) {
      case "trending":
        return t("discover.carousel.title.trending", "Xu hướng");
      case "popular":
        return t("discover.carousel.title.popular", "Phổ biến");
      case "providers":
        return t("discover.carousel.title.providers", "Nhà cung cấp");
      case "top-rated":
        return t("discover.carousel.title.topRated", "Đánh giá cao");
      case "editor-picks":
        return t("discover.carousel.title.editorPicks", "Biên tập viên chọn");
      case "latest":
        return t("discover.carousel.title.latest", "Mới phát hành");
      case "for-you":
        return t("discover.carousel.title.forYou", "Dành cho bạn");
      case "recommendations":
        return t("discover.carousel.title.recommendations", "Gợi ý cho bạn");
      case "genres":
        return t("discover.carousel.title.genres", "Thể loại");
      case "addons":
        return t("discover.carousel.title.addons", "Addons");
      default:
        return id;
    }
  };

  const sortableItems = useMemo(() => {
    const list = [...(props.homeSectionOrder || DEFAULT_HOME_SECTIONS)];

    // Ensure all default sections are included
    DEFAULT_HOME_SECTIONS.forEach((sec) => {
      if (!list.includes(sec)) {
        list.push(sec);
      }
    });

    // Also include any currently enabled addons that declare catalogs
    addons
      .filter((a) => a.enabled && a.manifest.catalogs?.length)
      .forEach((a) => {
        const addonKey = `addon:${a.manifest.id}`;
        if (!list.includes(addonKey)) {
          list.push(addonKey);
        }
      });

    // Filter out addons that are no longer installed
    return list
      .filter((id) => {
        if (id.startsWith("addon:")) {
          const aId = id.replace("addon:", "");
          return addons.some((a) => a.manifest.id === aId);
        }
        return true;
      })
      .map((id) => ({
        id,
        name: getSectionName(id),
      }));
  }, [props.homeSectionOrder, addons, t]);

  return (
    <div className="space-y-12">
      <Heading1 border>{t("settings.preferences.title")}</Heading1>
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <PreferenceCard
            title={t("settings.preferences.language")}
            description={t("settings.preferences.languageDescription")}
          >
            <Dropdown
              className="w-full"
              options={options}
              selectedItem={selected || options[0]}
              setSelectedItem={(opt) => props.setLanguage(opt.id)}
            />
          </PreferenceCard>

          <PreferenceCard
            title={t("settings.preferences.autoplay")}
            description={t("settings.preferences.autoplayDescription")}
          >
            <PreferenceToggleRow
              enabled={autoplayEnabled}
              label={t("settings.preferences.autoplayLabel")}
              locked
              dimmed={!allowAutoplay}
            />

            {autoplayEnabled && (
              <div className="space-y-5 rounded-xl border border-settings-card-border/60 bg-settings-card-background/30 p-4">
                <div className="space-y-3">
                  <p className="text-white font-bold">
                    {t("settings.preferences.skipCredits")}
                  </p>
                  <p className="font-medium">
                    {t("settings.preferences.skipCreditsDescription")}
                  </p>
                  <PreferenceToggleRow
                    enabled={props.enableSkipCredits}
                    label={t("settings.preferences.skipCreditsLabel")}
                    onClick={() =>
                      props.setEnableSkipCredits(!props.enableSkipCredits)
                    }
                  />
                </div>

                <div className="space-y-3">
                  <p className="text-white font-bold">
                    {t("settings.preferences.autoSkipSegments")}
                  </p>
                  <p className="font-medium">
                    {t("settings.preferences.autoSkipSegmentsDescription")}
                  </p>
                  <PreferenceToggleRow
                    enabled={props.enableAutoSkipSegments}
                    label={t("settings.preferences.autoSkipSegmentsLabel")}
                    onClick={() =>
                      props.setEnableAutoSkipSegments(
                        !props.enableAutoSkipSegments,
                      )
                    }
                  />
                </div>
              </div>
            )}
          </PreferenceCard>

          <PreferenceCard
            title={t("settings.preferences.doubleClickToSeek")}
            description={t("settings.preferences.doubleClickToSeekDescription")}
          >
            <PreferenceToggleRow
              enabled
              label={t("settings.preferences.doubleClickToSeekLabel")}
              locked
            />
          </PreferenceCard>
        </div>

        <div className="space-y-6">
          <PreferenceCard
            title={t("settings.preferences.keyboardShortcuts")}
            description={t("settings.preferences.keyboardShortcutsDescription")}
          >
            <Button
              className="w-full sm:w-auto"
              theme="secondary"
              onClick={() => showModal("keyboard-commands-edit")}
            >
              {t("settings.preferences.keyboardShortcutsLabel")}
            </Button>
          </PreferenceCard>

          {isDesktopApp && (
            <PreferenceCard
              title={t("settings.preferences.autoUpdate")}
              description={t("settings.preferences.autoUpdateDescription")}
            >
              <PreferenceToggleRow
                enabled={props.autoUpdateEnabled}
                label={t("settings.preferences.autoUpdateLabel")}
                onClick={() =>
                  props.setAutoUpdateEnabled(!props.autoUpdateEnabled)
                }
              />
            </PreferenceCard>
          )}

          <PreferenceCard
            title={t(
              "settings.preferences.homeSectionOrder",
              "Sắp xếp danh mục",
            )}
            description={t(
              "settings.preferences.homeSectionOrderDescription",
              "Kéo thả để sắp xếp lại thứ tự hiển thị các danh mục trên trang chủ và khám phá (bao gồm cả Addons).",
            )}
          >
            <div className="space-y-2">
              <div className="max-h-[22rem] overflow-y-auto overscroll-contain pr-2">
                <SortableList
                  items={sortableItems}
                  setItems={(newItems) => {
                    props.setHomeSectionOrder(newItems.map((item) => item.id));
                  }}
                />
              </div>
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  className="text-xs text-type-secondary hover:text-white transition-colors"
                  onClick={() => {
                    props.setHomeSectionOrder(DEFAULT_HOME_SECTIONS);
                  }}
                >
                  {t(
                    "settings.preferences.resetHomeSectionOrder",
                    "Đặt lại thứ tự mặc định",
                  )}
                </button>
              </div>
            </div>
          </PreferenceCard>
        </div>
      </div>
    </div>
  );
}
