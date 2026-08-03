import classNames from "classnames";
import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/buttons/Button";
import { Toggle } from "@/components/buttons/Toggle";
import { Dropdown } from "@/components/form/Dropdown";
import { Icon, Icons } from "@/components/Icon";
import {
  CaptionSetting,
  ColorOption,
  SubtitleTrackTabs,
  colors,
} from "@/components/player/atoms/settings/CaptionSettingsView";
import { Menu } from "@/components/player/internals/ContextMenu";
import { CaptionCue } from "@/components/player/Player";
import { Heading1 } from "@/components/utils/Text";
import { Transition } from "@/components/utils/Transition";
import { SubtitleTrack } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";
import {
  DEFAULT_SUBTITLE_STYLING,
  SubtitleStyling,
  useSubtitleStore,
} from "@/stores/subtitles";

export function CaptionPreview(props: {
  fullscreen?: boolean;
  show?: boolean;
  styling: SubtitleStyling;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const { fullscreen, show, onToggle } = props;

  useEffect(() => {
    if (!fullscreen || !show) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onToggle();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [fullscreen, show, onToggle]);

  return (
    <div
      className={classNames({
        "pointer-events-none overflow-hidden w-full rounded": true,
        "aspect-video relative": !props.fullscreen,
        "fixed inset-0 z-[999]": props.fullscreen,
      })}
    >
      {props.fullscreen && props.show ? (
        <Helmet>
          <html data-no-scroll />
        </Helmet>
      ) : null}
      <Transition animation="fade" show={props.show}>
        <div
          className="absolute inset-0 pointer-events-auto"
          style={{
            backgroundImage:
              "radial-gradient(102.95% 87.07% at 100% 100%, #EEAA45 0%, rgba(165, 186, 151, 0.56) 54.69%, rgba(74, 207, 254, 0.00) 100%), linear-gradient(180deg, #48D3FF 0%, #3B27B2 100%)",
          }}
        >
          <button
            type="button"
            className="tabbable bg-black absolute right-3 top-3 text-white bg-opacity-25 duration-100 transition-[background-color,transform] active:scale-110 hover:bg-opacity-50 p-2 rounded-md cursor-pointer"
            onClick={props.onToggle}
          >
            <Icon icon={props.fullscreen ? Icons.X : Icons.EXPAND} />
          </button>

          <div
            className="text-white pointer-events-none absolute flex w-full flex-col items-center transition-[bottom] p-4"
            style={{
              bottom: `${props.styling.verticalPosition * 4}px`,
            }}
          >
            <div
              className={
                props.fullscreen ? "" : "transform origin-bottom text-[0.5rem]"
              }
            >
              <CaptionCue
                text={t("settings.subtitles.previewQuote") ?? undefined}
                styling={props.styling}
                overrideCasing={false}
              />
            </div>
          </div>
        </div>
      </Transition>
    </div>
  );
}

export function CaptionsPart(props: {
  styling: SubtitleStyling;
  setStyling: (s: SubtitleStyling) => void;
  secondaryStyling: SubtitleStyling;
  setSecondaryStyling: (s: SubtitleStyling) => void;
}) {
  const { t } = useTranslation();
  const [fullscreenPreview, setFullscreenPreview] = useState(false);

  const updatePrimaryStyling = useSubtitleStore((s) => s.updateStyling);
  const updateSecondaryStyling = useSubtitleStore(
    (s) => s.updateSecondaryStyling,
  );
  const dualSubEnabled = usePlayerStore((s) => s.caption.dualSubEnabled);
  const [selectedTrack, setSelectedTrack] = useState<SubtitleTrack>("primary");

  useEffect(() => {
    updatePrimaryStyling(props.styling);
    updateSecondaryStyling(props.secondaryStyling);
  }, [
    props.styling,
    props.secondaryStyling,
    updatePrimaryStyling,
    updateSecondaryStyling,
  ]);

  const styling =
    selectedTrack === "secondary" ? props.secondaryStyling : props.styling;
  const handleStylingChange = (newStyling: SubtitleStyling) => {
    if (selectedTrack === "secondary") {
      props.setSecondaryStyling(newStyling);
      updateSecondaryStyling(newStyling);
    } else {
      props.setStyling(newStyling);
      updatePrimaryStyling(newStyling);
    }
  };

  const resetSubStyling = () => {
    handleStylingChange({ ...DEFAULT_SUBTITLE_STYLING });
  };

  useEffect(() => {
    if (!dualSubEnabled) setSelectedTrack("primary");
  }, [dualSubEnabled]);

  return (
    <div>
      <Heading1 border>{t("settings.subtitles.title")}</Heading1>
      {dualSubEnabled && (
        <div className="mb-6 max-w-md">
          <SubtitleTrackTabs
            selectedTrack={selectedTrack}
            onChange={setSelectedTrack}
          />
        </div>
      )}
      <div className="grid md:grid-cols-[1fr,356px] gap-8">
        <div className="space-y-6">
          <>
            <CaptionSetting
              label={t("settings.subtitles.backgroundLabel")}
              max={100}
              min={0}
              onChange={(v) =>
                handleStylingChange({
                  ...styling,
                  backgroundOpacity: v / 100,
                })
              }
              value={styling.backgroundOpacity * 100}
              textTransformer={(s) => `${s}%`}
            />
            <div className="flex justify-between items-center">
              <Menu.FieldTitle>
                {t("settings.subtitles.backgroundBlurEnabledLabel")}
              </Menu.FieldTitle>
              <div className="flex justify-center items-center">
                <Toggle
                  enabled={styling.backgroundBlurEnabled}
                  onClick={() =>
                    handleStylingChange({
                      ...styling,
                      backgroundBlurEnabled: !styling.backgroundBlurEnabled,
                    })
                  }
                />
              </div>
            </div>
            <span className="text-xs text-type-secondary">
              {t("settings.subtitles.backgroundBlurEnabledDescription")}
            </span>
            {styling.backgroundBlurEnabled && (
              <CaptionSetting
                label={t("settings.subtitles.backgroundBlurLabel")}
                max={100}
                min={0}
                onChange={(v) =>
                  handleStylingChange({
                    ...styling,
                    backgroundBlur: v / 100,
                  })
                }
                value={styling.backgroundBlur * 100}
                textTransformer={(s) => `${s}%`}
              />
            )}
            <CaptionSetting
              label={t("settings.subtitles.textSizeLabel")}
              max={200}
              min={1}
              textTransformer={(s) => `${s}%`}
              onChange={(v) =>
                handleStylingChange({
                  ...styling,
                  size: v / 100,
                })
              }
              value={styling.size * 100}
            />
            <div className="flex justify-between items-center">
              <Menu.FieldTitle>
                {t("settings.subtitles.textStyle.title")}
              </Menu.FieldTitle>
              <div className="w-30">
                <Dropdown
                  options={[
                    {
                      id: "default",
                      name: t("settings.subtitles.textStyle.default"),
                    },
                    {
                      id: "raised",
                      name: t("settings.subtitles.textStyle.raised"),
                    },
                    {
                      id: "depressed",
                      name: t("settings.subtitles.textStyle.depressed"),
                    },
                    {
                      id: "Border",
                      name: t("settings.subtitles.textStyle.Border"),
                    },
                    {
                      id: "dropShadow",
                      name: t("settings.subtitles.textStyle.dropShadow"),
                    },
                  ]}
                  selectedItem={{
                    id: styling.fontStyle,
                    name:
                      t(`settings.subtitles.textStyle.${styling.fontStyle}`) ||
                      styling.fontStyle,
                  }}
                  setSelectedItem={(item) =>
                    handleStylingChange({
                      ...styling,
                      fontStyle: item.id,
                    })
                  }
                />
              </div>
            </div>
            {styling.fontStyle === "Border" && (
              <CaptionSetting
                label={t("settings.subtitles.BorderThicknessLabel")}
                max={10}
                min={0}
                onChange={(v) =>
                  handleStylingChange({
                    ...styling,
                    borderThickness: v,
                  })
                }
                value={styling.borderThickness}
                textTransformer={(s) => `${s}px`}
                decimalsAllowed={1}
              />
            )}
            <div className="flex justify-between items-center">
              <Menu.FieldTitle>
                {t("settings.subtitles.textBoldLabel")}
              </Menu.FieldTitle>
              <div className="flex justify-center items-center">
                <Toggle
                  enabled={styling.bold}
                  onClick={() =>
                    handleStylingChange({
                      ...styling,
                      bold: !styling.bold,
                    })
                  }
                />
              </div>
            </div>
            <div className="flex justify-between items-center">
              <Menu.FieldTitle>
                {t("settings.subtitles.colorLabel")}
              </Menu.FieldTitle>
              <div className="flex justify-center items-center space-x-2">
                {colors.map((v) => (
                  <ColorOption
                    onClick={() =>
                      handleStylingChange({
                        ...styling,
                        color: v,
                      })
                    }
                    color={v}
                    active={styling.color === v}
                    key={v}
                  />
                ))}
                <div className="relative">
                  <input
                    type="color"
                    value={styling.color}
                    onChange={(e) => {
                      const color = e.target.value;
                      handleStylingChange({ ...styling, color });
                    }}
                    className="absolute opacity-0 cursor-pointer w-8 h-8"
                  />
                  <div style={{ color: styling.color }}>
                    <Icon icon={Icons.BRUSH} className="text-2xl" />
                  </div>
                </div>
              </div>
            </div>
            <div className="flex justify-between items-center">
              <Menu.FieldTitle>
                {t("settings.subtitles.verticalPositionLabel")}
              </Menu.FieldTitle>
              <div className="flex justify-center items-center space-x-2">
                <button
                  type="button"
                  className={classNames(
                    "px-3 py-1 rounded transition-colors duration-100",
                    styling.verticalPosition === 1
                      ? "bg-video-context-buttonFocus"
                      : "bg-video-context-buttonFocus bg-opacity-0 hover:bg-opacity-50",
                  )}
                  onClick={() =>
                    handleStylingChange({
                      ...styling,
                      verticalPosition: 1,
                    })
                  }
                >
                  {t("settings.subtitles.low")}
                </button>
                <button
                  type="button"
                  className={classNames(
                    "px-3 py-1 rounded transition-colors duration-100",
                    styling.verticalPosition === 3
                      ? "bg-video-context-buttonFocus"
                      : "bg-video-context-buttonFocus bg-opacity-0 hover:bg-opacity-50",
                  )}
                  onClick={() =>
                    handleStylingChange({
                      ...styling,
                      verticalPosition: 3,
                    })
                  }
                >
                  {t("settings.subtitles.high")}
                </button>
              </div>
            </div>
            <Button
              className="w-full md:w-auto"
              theme="secondary"
              onClick={resetSubStyling}
            >
              {t("settings.reset")}
            </Button>
          </>
        </div>
        <>
          <CaptionPreview
            show
            styling={styling}
            onToggle={() => setFullscreenPreview((s) => !s)}
          />
          <CaptionPreview
            show={fullscreenPreview}
            fullscreen
            styling={styling}
            onToggle={() => setFullscreenPreview((s) => !s)}
          />
        </>
      </div>
    </div>
  );
}
