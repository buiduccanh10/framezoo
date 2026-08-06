import classNames from "classnames";
import { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/buttons/Button";
import { Toggle } from "@/components/buttons/Toggle";
import { FlagIcon } from "@/components/FlagIcon";
import { Dropdown } from "@/components/form/Dropdown";
import { SettingsCard } from "@/components/layout/SettingsCard";
import { Heading1 } from "@/components/utils/Text";
import { appLanguageOptions } from "@/setup/i18n";
import { useOverlayStack } from "@/stores/interface/overlayStack";
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
  enableDoubleClickToSeek: boolean;
  setEnableDoubleClickToSeek: (v: boolean) => void;
  enableAutoResumeOnPlaybackError: boolean;
  setEnableAutoResumeOnPlaybackError: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const { showModal } = useOverlayStack();
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
            title={t("settings.preferences.autoResumeOnPlaybackError")}
            description={t(
              "settings.preferences.autoResumeOnPlaybackErrorDescription",
            )}
          >
            <PreferenceToggleRow
              enabled={props.enableAutoResumeOnPlaybackError}
              label={t("settings.preferences.autoResumeOnPlaybackErrorLabel")}
              onClick={() =>
                props.setEnableAutoResumeOnPlaybackError(
                  !props.enableAutoResumeOnPlaybackError,
                )
              }
            />
          </PreferenceCard>

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
        </div>
      </div>
    </div>
  );
}
