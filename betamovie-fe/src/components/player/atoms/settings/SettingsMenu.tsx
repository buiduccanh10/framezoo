import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { getCachedMetadata } from "@/backend/helpers/providerApi";
import { useProviderMetadataVersion } from "@/backend/providers/runtimeMetadata";
import { Toggle } from "@/components/buttons/Toggle";
import { Icon, Icons } from "@/components/Icon";
import { useCaptions } from "@/components/player/hooks/useCaptions";
import { Menu } from "@/components/player/internals/ContextMenu";
import {
  formatKkphimSourceName,
  getOpenMovieVariantLabelFromStreamId,
} from "@/components/player/utils/openMovieVariant";
import { useOverlayRouter } from "@/hooks/useOverlayRouter";
import { usePlayerStore } from "@/stores/player/store";
import { qualityToString } from "@/stores/player/utils/qualities";
import { useSubtitleStore } from "@/stores/subtitles";
import { getPrettyLanguageNameFromLocale } from "@/utils/language";

export function SettingsMenu({ id }: { id: string }) {
  const { t } = useTranslation();
  useProviderMetadataVersion();
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
  const currentEmbedId = usePlayerStore(
    (s) => (s as any).embedId as string | null,
  );
  const activeStreamId = usePlayerStore((s) => s.source?.id);
  const sourceName = currentSourceId
    ? (getCachedMetadata().find((src) => src.id === currentSourceId)?.name ??
      "...")
    : "...";
  const kkphimVariantLabel = useMemo(() => {
    if (currentSourceId !== "kkphim") {
      return null;
    }

    return getOpenMovieVariantLabelFromStreamId(activeStreamId);
  }, [activeStreamId, currentSourceId]);
  const sourceDisplayName = useMemo(() => {
    if (currentSourceId !== "kkphim") {
      return sourceName;
    }

    return formatKkphimSourceName(sourceName, kkphimVariantLabel);
  }, [currentSourceId, kkphimVariantLabel, sourceName]);
  const embedName =
    currentSourceId === "kkphim" || !currentEmbedId
      ? undefined
      : getCachedMetadata().find((s) => s.id === currentEmbedId)?.name;
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
          {t("player.menus.settings.qualityItem")}
          <span className="text-type-secondary text-sm">
            {currentQuality
              ? qualityToString(currentQuality)
              : t("player.menus.quality.auto")}
          </span>
        </Menu.ChevronLink>
        <Menu.ChevronLink
          box
          onClick={() => router.navigate("/source")}
          rightText={kkphimVariantLabel ?? sourceDisplayName}
        >
          {t("player.menus.settings.sourceItem")}
          <span className="text-type-secondary text-sm">
            {sourceDisplayName}
          </span>
          {embedName && (
            <span className="text-type-secondary text-xs">{embedName}</span>
          )}
        </Menu.ChevronLink>
        <Menu.ChevronLink
          box
          onClick={() => router.navigate("/captions")}
          rightText={sourceName}
        >
          {t("player.menus.settings.subtitleItem")}
          <span className="text-type-secondary text-sm">
            {selectedLanguagePretty ?? t("player.menus.subtitles.offChoice")}
          </span>
          {secondaryLanguagePretty && (
            <span className="text-purple-400 text-xs">
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
            {t("player.menus.settings.audioItem")}
            <span className="text-type-secondary text-sm">
              {selectedAudioLanguagePretty}
            </span>
          </Menu.ChevronLink>
        ) : (
          <Menu.ChevronLink
            box
            onClick={() => router.navigate("/audio")}
            disabled
          >
            {t("player.menus.settings.audioItem")}
            <span className="text-type-secondary text-sm">
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
