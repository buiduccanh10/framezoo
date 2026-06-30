import classNames from "classnames";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/buttons/Button";
import { Toggle } from "@/components/buttons/Toggle";
import { FlagIcon } from "@/components/FlagIcon";
import { Dropdown } from "@/components/form/Dropdown";
import { Heading1 } from "@/components/utils/Text";
import { appLanguageOptions } from "@/setup/i18n";
import { useOverlayStack } from "@/stores/interface/overlayStack";
import { isAutoplayAllowed } from "@/utils/autoplay";
import { getLocaleInfo, sortLangCodes } from "@/utils/language";

export function PreferencesPart(props: {
  language: string;
  setLanguage: (l: string) => void;
  enableAutoplay: boolean;
  setEnableAutoplay: (v: boolean) => void;
  enableSkipCredits: boolean;
  setEnableSkipCredits: (v: boolean) => void;
  enableAutoSkipSegments: boolean;
  setEnableAutoSkipSegments: (v: boolean) => void;
  manualSourceSelection: boolean;
  setManualSourceSelection: (v: boolean) => void;
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Column */}
        <div className="space-y-8">
          {/* Language Preference */}
          <div>
            <p className="text-white font-bold mb-3">
              {t("settings.preferences.language")}
            </p>
            <p className="max-w-[20rem] font-medium">
              {t("settings.preferences.languageDescription")}
            </p>
            <Dropdown
              className="w-full"
              options={options}
              selectedItem={selected || options[0]}
              setSelectedItem={(opt) => props.setLanguage(opt.id)}
            />
          </div>

          {/* Autoplay Preference */}
          <div>
            <p className="text-white font-bold mb-3">
              {t("settings.preferences.autoplay")}
            </p>
            <p className="max-w-[25rem] font-medium">
              {t("settings.preferences.autoplayDescription")}
            </p>
            <div
              className={classNames(
                "bg-dropdown-background select-none my-4 space-x-3 flex items-center max-w-[25rem] py-3 px-4 rounded-lg",
                allowAutoplay
                  ? "cursor-default opacity-100 pointer-events-none"
                  : "cursor-not-allowed opacity-50 pointer-events-none",
              )}
            >
              <Toggle enabled={autoplayEnabled} />
              <p className="flex-1 text-white font-bold">
                {t("settings.preferences.autoplayLabel")}
              </p>
            </div>

            {/* Skip End Credits Preference */}
            {autoplayEnabled && (
              <div className="pt-4 pl-4 border-l-8 border-dropdown-background">
                <p className="text-white font-bold mb-3">
                  {t("settings.preferences.skipCredits")}
                </p>
                <p className="max-w-[25rem] font-medium">
                  {t("settings.preferences.skipCreditsDescription")}
                </p>
                <div
                  onClick={() =>
                    props.setEnableSkipCredits(!props.enableSkipCredits)
                  }
                  className="bg-dropdown-background hover:bg-dropdown-hoverBackground select-none my-4 cursor-pointer space-x-3 flex items-center max-w-[25rem] py-3 px-4 rounded-lg"
                >
                  <Toggle enabled={props.enableSkipCredits} />
                  <p className="flex-1 text-white font-bold">
                    {t("settings.preferences.skipCreditsLabel")}
                  </p>
                </div>

                {/* Auto Skip Segments Preference */}
                <div className="pt-4 mt-4">
                  <p className="text-white font-bold mb-3">
                    {t("settings.preferences.autoSkipSegments")}
                  </p>
                  <p className="max-w-[25rem] font-medium">
                    {t("settings.preferences.autoSkipSegmentsDescription")}
                  </p>
                  <div
                    onClick={() =>
                      props.setEnableAutoSkipSegments(
                        !props.enableAutoSkipSegments,
                      )
                    }
                    className="bg-dropdown-background hover:bg-dropdown-hoverBackground select-none my-4 cursor-pointer space-x-3 flex items-center max-w-[25rem] py-3 px-4 rounded-lg"
                  >
                    <Toggle enabled={props.enableAutoSkipSegments} />
                    <p className="flex-1 text-white font-bold">
                      {t("settings.preferences.autoSkipSegmentsLabel")}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Double Click to Seek Preference */}
          <div>
            <p className="text-white font-bold mb-3">
              {t("settings.preferences.doubleClickToSeek")}
            </p>
            <p className="max-w-[25rem] font-medium">
              {t("settings.preferences.doubleClickToSeekDescription")}
            </p>
            <div className="bg-dropdown-background select-none my-4 space-x-3 flex items-center max-w-[25rem] py-3 px-4 rounded-lg pointer-events-none">
              <Toggle enabled />
              <p className="flex-1 text-white font-bold">
                {t("settings.preferences.doubleClickToSeekLabel")}
              </p>
            </div>
          </div>

          {/* Keyboard Shortcuts Preference */}
          <div>
            <p className="text-white font-bold mb-3">
              {t("settings.preferences.keyboardShortcuts")}
            </p>
            <p className="max-w-[25rem] font-medium">
              {t("settings.preferences.keyboardShortcutsDescription")}
            </p>
          </div>
          <Button
            theme="secondary"
            onClick={() => showModal("keyboard-commands-edit")}
          >
            {t("settings.preferences.keyboardShortcutsLabel")}
          </Button>
        </div>

        {/* Column */}
        <div id="source-order" className="space-y-8">
          <div className="flex flex-col gap-3">
            {/* Manual Source Selection */}
            <div>
              <p className="text-white font-bold mb-3">
                {t("settings.preferences.manualSource")}
              </p>
              <p className="max-w-[25rem] font-medium">
                {t("settings.preferences.manualSourceDescription")}
              </p>
              <div
                onClick={() =>
                  props.setManualSourceSelection(!props.manualSourceSelection)
                }
                className="bg-dropdown-background hover:bg-dropdown-hoverBackground select-none my-4 cursor-pointer space-x-3 flex items-center max-w-[25rem] py-3 px-4 rounded-lg"
              >
                <Toggle enabled={props.manualSourceSelection} />
                <p className="flex-1 text-white font-bold">
                  {t("settings.preferences.manualSourceLabel")}
                </p>
              </div>
            </div>

            {/* Auto Resume on Playback Error */}
            <div>
              <p className="text-white font-bold mb-3">
                {t("settings.preferences.autoResumeOnPlaybackError")}
              </p>
              <p className="max-w-[25rem] font-medium">
                {t("settings.preferences.autoResumeOnPlaybackErrorDescription")}
              </p>
              <div
                onClick={() =>
                  props.setEnableAutoResumeOnPlaybackError(
                    !props.enableAutoResumeOnPlaybackError,
                  )
                }
                className="bg-dropdown-background hover:bg-dropdown-hoverBackground select-none my-4 cursor-pointer space-x-3 flex items-center max-w-[25rem] py-3 px-4 rounded-lg"
              >
                <Toggle enabled={props.enableAutoResumeOnPlaybackError} />
                <p className="flex-1 text-white font-bold">
                  {t("settings.preferences.autoResumeOnPlaybackErrorLabel")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
