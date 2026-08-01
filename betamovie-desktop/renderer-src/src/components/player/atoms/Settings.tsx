import { useEffect, useState } from "react";
import { useWindowSize } from "react-use";

import { Icons } from "@/components/Icon";
import { OverlayAnchor } from "@/components/overlays/OverlayAnchor";
import { Overlay } from "@/components/overlays/OverlayDisplay";
import { OverlayPage } from "@/components/overlays/OverlayPage";
import { OverlayRouter } from "@/components/overlays/OverlayRouter";
import { VideoPlayerButton } from "@/components/player/internals/Button";
import { Menu } from "@/components/player/internals/ContextMenu";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  useInternalOverlayRouter,
  useOverlayRouter,
} from "@/hooks/useOverlayRouter";
import { SourceSelectPart } from "@/pages/parts/player/SourceSelectPart";
import { CaptionListItem } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";

import { AudioView } from "./settings/AudioView";
import { CaptionSettingsView } from "./settings/CaptionSettingsView";
import { CaptionsView } from "./settings/CaptionsView";
import { LanguageSubtitlesView } from "./settings/LanguageSubtitlesView";
import { PlaybackSettingsView } from "./settings/PlaybackSettingsView";
import { QualityView } from "./settings/QualityView";
import { SettingsMenu } from "./settings/SettingsMenu";
import { SkipSegmentsView } from "./settings/SkipSegmentsView";
import { TranscriptView } from "./settings/TranscriptView";
import { TranslateSubtitleView } from "./settings/TranslateSubtitleView";
import { WatchPartyView } from "./settings/WatchPartyView";

function SettingsOverlay({ id }: { id: string }) {
  const [chosenLanguage, setChosenLanguage] = useState<string | null>(null);
  const [captionToTranslate, setCaptionToTranslate] =
    useState<CaptionListItem | null>(null);
  const [sourceViewState, setSourceViewState] = useState<"addons" | "streams">(
    "addons",
  );
  const { width: viewportWidth, height: viewportHeight } = useWindowSize();
  const { isMobile } = useIsMobile();
  const router = useOverlayRouter(id);
  const internalRouter = useInternalOverlayRouter(id);
  const playerMeta = usePlayerStore((state) => state.meta);
  const isTranscriptVisible = internalRouter.isCurrentPage(
    "/captions/transcript",
  );
  const subtitleSelectionMode = usePlayerStore(
    (state) => state.caption.activeTrack,
  );
  const isDualSubEnabled = usePlayerStore(
    (state) => state.caption.dualSubEnabled,
  );
  const setSubtitleSelectionMode = usePlayerStore(
    (state) => state.setActiveCaptionTrack,
  );

  const isLandscape = viewportWidth > viewportHeight;
  const horizontalPadding = isMobile ? 20 : 60;
  const verticalPadding = isMobile ? (isLandscape ? 12 : 24) : 40;
  const maxOverlayWidth = Math.max(280, viewportWidth - horizontalPadding * 2);
  const maxOverlayHeight = Math.max(260, viewportHeight - verticalPadding * 2);
  const defaultWidth = Math.min(343, maxOverlayWidth);
  const wideWidth = Math.min(443, maxOverlayWidth);
  const defaultHeight = Math.min(496, maxOverlayHeight);
  const transcriptHeight = Math.min(
    defaultHeight + (isDualSubEnabled ? 96 : 0),
    maxOverlayHeight,
  );
  const playbackHeight = Math.min(330, maxOverlayHeight);
  const skipSegmentsHeight = Math.min(446, maxOverlayHeight);

  // reset source id and language when going to home or closing overlay
  useEffect(() => {
    if (!router.isRouterActive) {
      setChosenLanguage(null);
      setSourceViewState("addons");
    }
    if (router.route === "/") {
      setChosenLanguage(null);
      setSourceViewState("addons");
    }
  }, [router.isRouterActive, router.route]);

  const extraWideWidth = Math.min(650, maxOverlayWidth);

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
          width={sourceViewState === "streams" ? extraWideWidth : defaultWidth}
          height={defaultHeight}
        >
          {playerMeta ? (
            <SourceSelectPart
              meta={playerMeta}
              mode="full"
              onCancel={() => router.navigate("/")}
              onSelected={() => router.close()}
              onStateChange={setSourceViewState}
            />
          ) : null}
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
          height={transcriptHeight}
        >
          <Menu.CardWithScrollable scrollLastChild>
            {isTranscriptVisible ? (
              <TranscriptView
                id={id}
                selectionMode={subtitleSelectionMode}
                onSelectionModeChange={setSubtitleSelectionMode}
              />
            ) : null}
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
