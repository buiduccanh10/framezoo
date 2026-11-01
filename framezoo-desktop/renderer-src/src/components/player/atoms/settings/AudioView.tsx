import { iso6393To1 } from "iso-639-3";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { FlagIcon } from "@/components/FlagIcon";
import { Menu } from "@/components/player/internals/ContextMenu";
import { useOverlayRouter } from "@/hooks/useOverlayRouter";
import { AudioTrack } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";
import { AudioOutputMode, usePreferencesStore } from "@/stores/preferences";
import { getPrettyLanguageNameFromLocale } from "@/utils/language";

import { SelectableLink } from "../../internals/ContextMenu/Links";

export function AudioOption(props: {
  langCode?: string;
  children: React.ReactNode;
  selected?: boolean;
  onClick?: () => void;
}) {
  return (
    <SelectableLink selected={props.selected} onClick={props.onClick}>
      <span className="flex items-center">
        <span data-code={props.langCode} className="mr-3 inline-flex">
          <FlagIcon langCode={props.langCode} />
        </span>
        <span>{props.children}</span>
      </span>
    </SelectableLink>
  );
}

export function AudioView({ id }: { id: string }) {
  const { t } = useTranslation();
  const unknownChoice = t("player.menus.subtitles.unknownLanguage");

  const router = useOverlayRouter(id);
  const audioTracks = usePlayerStore((s) => s.audioTracks);
  const currentAudioTrack = usePlayerStore((s) => s.currentAudioTrack);
  const changeAudioTrack = usePlayerStore((s) => s.display?.changeAudioTrack);
  const setAudioMode = usePlayerStore((s) => s.display?.setAudioMode);

  const audioOutputMode = usePreferencesStore((s) => s.audioOutputMode);
  const setAudioOutputMode = usePreferencesStore((s) => s.setAudioOutputMode);

  const changeTrack = useCallback(
    (track: AudioTrack) => {
      changeAudioTrack?.(track);
      router.close();
    },
    [router, changeAudioTrack],
  );

  const handleSelectMode = useCallback(
    (mode: AudioOutputMode) => {
      setAudioOutputMode(mode);
      setAudioMode?.(mode);
    },
    [setAudioOutputMode, setAudioMode],
  );

  const audioModes: Array<{
    id: AudioOutputMode;
    title: string;
    description: string;
  }> = [
    {
      id: "auto",
      title: t("player.menus.audio.modes.auto", "Surround Sound / Auto"),
      description: t(
        "player.menus.audio.modes.autoDesc",
        "5.1/7.1, Dolby Atmos, Apple Spatial Audio, Windows Sonic",
      ),
    },
    {
      id: "stereo-dialogue",
      title: t(
        "player.menus.audio.modes.stereoDialogue",
        "Stereo (Dialogue Boost)",
      ),
      description: t(
        "player.menus.audio.modes.stereoDialogueDesc",
        "Enhanced voice clarity for laptop speakers or night listening",
      ),
    },
    {
      id: "passthrough",
      title: t(
        "player.menus.audio.modes.passthrough",
        "Passthrough (Bitstream)",
      ),
      description: t(
        "player.menus.audio.modes.passthroughDesc",
        "Direct digital stream for external Soundbars and AV Receivers",
      ),
    },
  ];

  return (
    <>
      <Menu.BackLink onClick={() => router.navigate("/")}>
        {t("player.menus.settings.audioItem")}
      </Menu.BackLink>

      <Menu.SectionTitle>
        {t("player.menus.audio.modeSection", "Audio Output Mode")}
      </Menu.SectionTitle>
      <Menu.Section className="flex flex-col">
        {audioModes.map((mode) => (
          <SelectableLink
            key={mode.id}
            selected={mode.id === audioOutputMode}
            onClick={() => handleSelectMode(mode.id)}
          >
            <div className="flex flex-col text-left py-0.5">
              <span className="font-medium text-sm text-white">
                {mode.title}
              </span>
              <span className="text-xs text-type-secondary">
                {mode.description}
              </span>
            </div>
          </SelectableLink>
        ))}
      </Menu.Section>

      {audioTracks.length > 0 && (
        <>
          <Menu.SectionTitle>
            {t("player.menus.audio.tracksSection", "Audio Tracks")}
          </Menu.SectionTitle>
          <Menu.Section className="flex flex-col pb-4">
            {audioTracks.map((v) => (
              <AudioOption
                key={v.id}
                selected={v.id === currentAudioTrack?.id}
                langCode={
                  v.language.length === 3
                    ? (iso6393To1[v.language] ?? v.language)
                    : v.language
                }
                onClick={
                  audioTracks.includes(v) ? () => changeTrack(v) : undefined
                }
              >
                {getPrettyLanguageNameFromLocale(v.language) ??
                  v.label ??
                  unknownChoice}
              </AudioOption>
            ))}
          </Menu.Section>
        </>
      )}
    </>
  );
}
