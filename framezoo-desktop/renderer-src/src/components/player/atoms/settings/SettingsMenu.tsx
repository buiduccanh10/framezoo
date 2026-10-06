import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { Toggle } from "@/components/buttons/Toggle";
import { Icon, Icons } from "@/components/Icon";
import { useCaptions } from "@/components/player/hooks/useCaptions";
import { Menu } from "@/components/player/internals/ContextMenu";
import { useInstalledAddons } from "@/desktop/addons/store";
import { useActiveTorrentStatus } from "@/desktop/torrentPlaybackStore";
import { useOverlayRouter } from "@/hooks/useOverlayRouter";
import { usePlayerStore } from "@/stores/player/store";
import { qualityToString } from "@/stores/player/utils/qualities";
import { useSubtitleStore } from "@/stores/subtitles";
import { getPrettyLanguageNameFromLocale } from "@/utils/language";

export function SettingsMenu({ id }: { id: string }) {
  const { t } = useTranslation();
  const addons = useInstalledAddons();
  const router = useOverlayRouter(id);
  const currentQuality = usePlayerStore((s) => s.currentQuality);
  const currentAudioTrack = usePlayerStore((s) => s.currentAudioTrack);
  const selectedCaptionLanguage = usePlayerStore(
    (s) => s.caption.selected?.language,
  );
  const secondaryCaptionLanguage = usePlayerStore(
    (s) => s.caption.secondary?.language,
  );
  const subtitlesEnabled = useSubtitleStore((s) => s.enabled);
  const currentSourceId = usePlayerStore((s) => s.sourceId);
  const torrentStatus = useActiveTorrentStatus();
  const pendingTorrentSourceId =
    torrentStatus?.streamType === "pending" ? torrentStatus.sourceId : null;
  const activeSourceId = pendingTorrentSourceId ?? currentSourceId;
  const addonSourceName = useMemo(() => {
    if (!activeSourceId) return "Addon streams";
    return (
      addons.find((addon) => activeSourceId.startsWith(`${addon.manifest.id}:`))
        ?.manifest.name ?? "Addon streams"
    );
  }, [activeSourceId, addons]);
  const sourceName = activeSourceId ? addonSourceName : "...";
  const { toggleLastUsed } = useCaptions();

  const selectedLanguagePretty = selectedCaptionLanguage
    ? (getPrettyLanguageNameFromLocale(selectedCaptionLanguage) ??
      t("player.menus.subtitles.unknownLanguage"))
    : undefined;

  const secondaryLanguagePretty = secondaryCaptionLanguage
    ? (getPrettyLanguageNameFromLocale(secondaryCaptionLanguage) ??
      t("player.menus.subtitles.unknownLanguage"))
    : undefined;

  const selectedAudioLanguagePretty = currentAudioTrack
    ? (getPrettyLanguageNameFromLocale(currentAudioTrack.language) ??
      currentAudioTrack.label ??
      t("player.menus.subtitles.unknownLanguage"))
    : undefined;

  return (
    <Menu.Card>
      <Menu.Section grid>
        <Menu.ChevronLink
          box
          onClick={() => router.navigate("/quality")}
          rightText={currentQuality ? qualityToString(currentQuality) : ""}
        >
          <span className="w-full text-center truncate">
            {t("player.menus.settings.qualityItem")}
          </span>
          <span className="text-type-secondary text-sm w-full text-center truncate leading-tight">
            {currentQuality
              ? qualityToString(currentQuality)
              : t("player.menus.quality.auto")}
          </span>
        </Menu.ChevronLink>
        <Menu.ChevronLink
          box
          onClick={() => router.navigate("/source")}
          rightText={sourceName}
        >
          <span className="w-full text-center truncate">
            {t("player.menus.settings.sourceItem")}
          </span>
          <span className="text-type-secondary text-sm w-full text-center truncate leading-tight">
            {sourceName}
          </span>
        </Menu.ChevronLink>
        <Menu.ChevronLink
          box
          onClick={() => router.navigate("/captions")}
          rightText={sourceName}
        >
          <span className="w-full text-center truncate">
            {t("player.menus.settings.subtitleItem")}
          </span>
          <span className="text-type-secondary text-sm w-full text-center line-clamp-2 leading-tight">
            {selectedLanguagePretty ?? t("player.menus.subtitles.offChoice")}
          </span>
          {secondaryLanguagePretty && (
            <span className="text-purple-400 text-xs w-full text-center truncate leading-tight">
              + {secondaryLanguagePretty}
            </span>
          )}
        </Menu.ChevronLink>
        {currentAudioTrack ? (
          <Menu.ChevronLink
            box
            onClick={() => router.navigate("/audio")}
            rightText={selectedAudioLanguagePretty ?? undefined}
          >
            <span className="w-full text-center truncate">
              {t("player.menus.settings.audioItem")}
            </span>
            <span className="text-type-secondary text-sm w-full text-center line-clamp-2 leading-tight">
              {selectedAudioLanguagePretty}
            </span>
          </Menu.ChevronLink>
        ) : (
          <Menu.ChevronLink
            box
            onClick={() => router.navigate("/audio")}
            disabled
          >
            <span className="w-full text-center truncate">
              {t("player.menus.settings.audioItem")}
            </span>
            <span className="text-type-secondary text-sm w-full text-center line-clamp-2 leading-tight">
              {t("player.menus.audio.default")}
            </span>
          </Menu.ChevronLink>
        )}
      </Menu.Section>
      <Menu.Section>
        <Menu.Link
          clickable
          onClick={() => router.navigate("/watchparty")}
          rightSide={<Icon className="text-xl" icon={Icons.WATCH_PARTY} />}
        >
          {t("player.menus.watchparty.watchpartyItem")}
        </Menu.Link>
      </Menu.Section>
      <Menu.SectionTitle />
      <Menu.Section>
        <Menu.Link
          rightSide={
            <Toggle
              enabled={subtitlesEnabled}
              onClick={() => toggleLastUsed().catch(() => {})}
            />
          }
        >
          {t("player.menus.settings.enableSubtitles")}
        </Menu.Link>
        <Menu.ChevronLink onClick={() => router.navigate("/playback")}>
          {t("player.menus.settings.playbackItem")}
        </Menu.ChevronLink>
        <Menu.ChevronLink
          onClick={() => router.navigate("/playback/skip-segments")}
        >
          {t("player.skipTime.skipSegments")}
        </Menu.ChevronLink>
      </Menu.Section>
    </Menu.Card>
  );
}
