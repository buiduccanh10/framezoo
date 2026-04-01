import { useEffect, useState } from "react";
import { useWindowSize } from "react-use";

import { Icons } from "@/components/Icon";
import { OverlayAnchor } from "@/components/overlays/OverlayAnchor";
import { Overlay } from "@/components/overlays/OverlayDisplay";
import { OverlayPage } from "@/components/overlays/OverlayPage";
import { OverlayRouter } from "@/components/overlays/OverlayRouter";
import {
  EmbedSelectionView,
  SourceSelectionView,
} from "@/components/player/atoms/settings/SourceSelectingView";
import { VideoPlayerButton } from "@/components/player/internals/Button";
import { Menu } from "@/components/player/internals/ContextMenu";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useOverlayRouter } from "@/hooks/useOverlayRouter";
import { CaptionListItem } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";

import { AudioView } from "./settings/AudioView";
import { CaptionSettingsView } from "./settings/CaptionSettingsView";
import {
  CaptionsView,
  type SubtitleSelectionMode,
} from "./settings/CaptionsView";
import { DownloadRoutes } from "./settings/Downloads";
import { LanguageSubtitlesView } from "./settings/LanguageSubtitlesView";
import { PlaybackSettingsView } from "./settings/PlaybackSettingsView";
import { QualityView } from "./settings/QualityView";
import { SettingsMenu } from "./settings/SettingsMenu";
import { SkipSegmentsView } from "./settings/SkipSegmentsView";
import { TranscriptView } from "./settings/TranscriptView";
import { TranslateSubtitleView } from "./settings/TranslateSubtitleView";
import { WatchPartyView } from "./settings/WatchPartyView";

function SettingsOverlay({ id }: { id: string }) {
  const [chosenSourceId, setChosenSourceId] = useState<string | null>(null);
  const [chosenLanguage, setChosenLanguage] = useState<string | null>(null);
  const [captionToTranslate, setCaptionToTranslate] =
    useState<CaptionListItem | null>(null);
  const [subtitleSelectionMode, setSubtitleSelectionMode] =
    useState<SubtitleSelectionMode>("primary");
  const [isDualSubEnabled, setIsDualSubEnabled] = useState(false);
  const { width: viewportWidth, height: viewportHeight } = useWindowSize();
  const { isMobile } = useIsMobile();
  const router = useOverlayRouter(id);

  const isLandscape = viewportWidth > viewportHeight;
  const horizontalPadding = isMobile ? 20 : 60;
  const verticalPadding = isMobile ? (isLandscape ? 12 : 24) : 40;
  const maxOverlayWidth = Math.max(280, viewportWidth - horizontalPadding * 2);
  const maxOverlayHeight = Math.max(260, viewportHeight - verticalPadding * 2);
  const defaultWidth = Math.min(343, maxOverlayWidth);
  const wideWidth = Math.min(443, maxOverlayWidth);
  const defaultHeight = Math.min(496, maxOverlayHeight);
  const playbackHeight = Math.min(330, maxOverlayHeight);
  const skipSegmentsHeight = Math.min(446, maxOverlayHeight);

  // reset source id and language when going to home or closing overlay
  useEffect(() => {
    if (!router.isRouterActive) {
      setChosenSourceId(null);
      setChosenLanguage(null);
      setSubtitleSelectionMode("primary");
    }
    if (router.route === "/") {
      setChosenSourceId(null);
      setChosenLanguage(null);
    }
  }, [router.isRouterActive, router.route]);

  return (
    <Overlay id={id}>
      <OverlayRouter id={id}>
        <OverlayPage
          id={id}
          path="/"
          width={defaultWidth}
          height={defaultHeight}
        >
          <SettingsMenu id={id} />
        </OverlayPage>
        <OverlayPage
          id={id}
          path="/quality"
          width={defaultWidth}
          height={defaultHeight}
        >
          <Menu.Card>
            <QualityView id={id} />
          </Menu.Card>
        </OverlayPage>
        <OverlayPage
          id={id}
          path="/audio"
          width={defaultWidth}
          height={defaultHeight}
        >
          <Menu.Card>
            <AudioView id={id} />
          </Menu.Card>
        </OverlayPage>
        <OverlayPage
          id={id}
          path="/captions"
          width={defaultWidth}
          height={defaultHeight}
        >
          <Menu.CardWithScrollable>
            <CaptionsView
              id={id}
              backLink
              onChooseLanguage={setChosenLanguage}
              selectionMode={subtitleSelectionMode}
              onSelectionModeChange={setSubtitleSelectionMode}
              isDualSubEnabled={isDualSubEnabled}
              onDualSubToggle={setIsDualSubEnabled}
            />
          </Menu.CardWithScrollable>
        </OverlayPage>
        {/* This is used by the captions shortcut in bottomControls of player */}
        <OverlayPage
          id={id}
          path="/captionsOverlay"
          width={defaultWidth}
          height={defaultHeight}
        >
          <Menu.CardWithScrollable>
            <CaptionsView
              id={id}
              onChooseLanguage={setChosenLanguage}
              selectionMode={subtitleSelectionMode}
              onSelectionModeChange={setSubtitleSelectionMode}
              isDualSubEnabled={isDualSubEnabled}
              onDualSubToggle={setIsDualSubEnabled}
            />
          </Menu.CardWithScrollable>
        </OverlayPage>
        <OverlayPage
          id={id}
          path="/captionsOverlay/languagesOverlay"
          width={wideWidth}
          height={defaultHeight}
        >
          <Menu.CardWithScrollable>
            {chosenLanguage && (
              <LanguageSubtitlesView
                id={id}
                language={chosenLanguage}
                onTranslateSubtitle={setCaptionToTranslate}
                overlayBackLink
                selectionMode={subtitleSelectionMode}
              />
            )}
          </Menu.CardWithScrollable>
        </OverlayPage>
        <OverlayPage
          id={id}
          path="/captionsOverlay/languagesOverlay/translateSubtitleOverlay"
          width={wideWidth}
          height={defaultHeight}
        >
          <Menu.CardWithScrollable>
            {captionToTranslate && (
              <TranslateSubtitleView
                id={id}
                caption={captionToTranslate}
                overlayBackLink
              />
            )}
          </Menu.CardWithScrollable>
        </OverlayPage>
        <OverlayPage
          id={id}
          path="/captions/settings"
          width={defaultWidth}
          height={defaultHeight}
        >
          <Menu.Card>
            <CaptionSettingsView id={id} />
          </Menu.Card>
        </OverlayPage>
        {/* This is used by the captions shortcut in bottomControls of player */}
        <OverlayPage
          id={id}
          path="/captions/settingsOverlay"
          width={defaultWidth}
          height={defaultHeight}
        >
          <Menu.Card>
            <CaptionSettingsView id={id} overlayBackLink />
          </Menu.Card>
        </OverlayPage>
        <OverlayPage
          id={id}
          path="/source"
          width={defaultWidth}
          height={defaultHeight}
        >
          <Menu.CardWithScrollable>
            <SourceSelectionView id={id} onChoose={setChosenSourceId} />
          </Menu.CardWithScrollable>
        </OverlayPage>
        <OverlayPage
          id={id}
          path="/source/embeds"
          width={defaultWidth}
          height={defaultHeight}
        >
          <Menu.CardWithScrollable>
            <EmbedSelectionView id={id} sourceId={chosenSourceId} />
          </Menu.CardWithScrollable>
        </OverlayPage>
        <OverlayPage
          id={id}
          path="/playback"
          width={defaultWidth}
          height={playbackHeight}
        >
          <Menu.Card>
            <PlaybackSettingsView id={id} />
          </Menu.Card>
        </OverlayPage>
        <OverlayPage
          id={id}
          path="/playback/skip-segments"
          width={defaultWidth}
          height={skipSegmentsHeight}
        >
          <Menu.Card>
            <SkipSegmentsView id={id} />
          </Menu.Card>
        </OverlayPage>
        <OverlayPage
          id={id}
          path="/captions/transcript"
          width={defaultWidth}
          height={defaultHeight}
        >
          <Menu.CardWithScrollable>
            <TranscriptView id={id} />
          </Menu.CardWithScrollable>
        </OverlayPage>
        <OverlayPage
          id={id}
          path="/captions/languages"
          width={wideWidth}
          height={defaultHeight}
        >
          <Menu.CardWithScrollable>
            {chosenLanguage && (
              <LanguageSubtitlesView
                id={id}
                language={chosenLanguage}
                onTranslateSubtitle={setCaptionToTranslate}
                selectionMode={subtitleSelectionMode}
              />
            )}
          </Menu.CardWithScrollable>
        </OverlayPage>
        <OverlayPage
          id={id}
          path="/captions/languages/translateSubtitleOverlay"
          width={wideWidth}
          height={defaultHeight}
        >
          <Menu.CardWithScrollable>
            {captionToTranslate && (
              <TranslateSubtitleView id={id} caption={captionToTranslate} />
            )}
          </Menu.CardWithScrollable>
        </OverlayPage>
        <DownloadRoutes id={id} />
        <OverlayPage
          id={id}
          path="/watchparty"
          width={defaultWidth}
          height={defaultHeight}
        >
          <Menu.CardWithScrollable>
            <WatchPartyView id={id} />
          </Menu.CardWithScrollable>
        </OverlayPage>
      </OverlayRouter>
    </Overlay>
  );
}

export function SettingsRouter() {
  return <SettingsOverlay id="settings" />;
}

export function Settings(props: {
  iconSizeClass?: string;
  className?: string;
}) {
  const router = useOverlayRouter("settings");
  const setHasOpenOverlay = usePlayerStore((s) => s.setHasOpenOverlay);

  useEffect(() => {
    setHasOpenOverlay(router.isRouterActive);
  }, [setHasOpenOverlay, router.isRouterActive]);

  return (
    <OverlayAnchor id={router.id}>
      <VideoPlayerButton
        className={props.className}
        iconSizeClass={props.iconSizeClass}
        onClick={() => router.open()}
        icon={Icons.GEAR}
      />
    </OverlayAnchor>
  );
}
