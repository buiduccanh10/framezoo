import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getMetaFromId } from "@/backend/metadata/getmeta";
import { MWMediaType } from "@/backend/metadata/types/mw";
import { useCaptions } from "@/components/player/hooks/useCaptions";
import { usePlayerMeta } from "@/components/player/hooks/usePlayerMeta";
import { useVolume } from "@/components/player/hooks/useVolume";
import { isPlaybackInteractionLocked } from "@/components/player/utils/playbackLock";
import { useOverlayRouter } from "@/hooks/useOverlayRouter";
import { useOverlayStack } from "@/stores/interface/overlayStack";
import { usePlayerStore } from "@/stores/player/store";
import { usePreferencesStore } from "@/stores/preferences";
import { useProgressStore } from "@/stores/progress";
import { useSubtitleStore } from "@/stores/subtitles";
import { useEmpheralVolumeStore } from "@/stores/volume";
import { useWatchPartyStore } from "@/stores/watchParty";
import {
  DEFAULT_KEYBOARD_SHORTCUTS,
  LOCKED_SHORTCUTS,
  ShortcutId,
  matchesShortcut,
} from "@/utils/keyboardShortcuts";

export function KeyboardEvents() {
  const router = useOverlayRouter("");
  const display = usePlayerStore((s) => s.display);
  const mediaProgress = usePlayerStore((s) => s.progress);
  const { isSeeking } = usePlayerStore((s) => s.interface);
  const mediaPlaying = usePlayerStore((s) => s.mediaPlaying);
  const isSubtitleSyncActive = usePlayerStore((s) => s.subtitleSync.active);
  const isPlaybackLocked = isPlaybackInteractionLocked(
    mediaPlaying,
    isSubtitleSyncActive,
  );
  const time = usePlayerStore((s) => s.progress.time);
  const duration = usePlayerStore((s) => s.progress.duration);
  const { setVolume, toggleMute } = useVolume();
  const isInWatchParty = useWatchPartyStore((s) => s.enabled);
  const meta = usePlayerStore((s) => s.meta);
  const activeSubtitleTrack = usePlayerStore((s) => s.caption.activeTrack);
  const { setDirectMeta } = usePlayerMeta();
  const setShouldStartFromBeginning = usePlayerStore(
    (s) => s.setShouldStartFromBeginning,
  );
  const updateItem = useProgressStore((s) => s.updateItem);

  const { toggleLastUsed, selectBestCaptionFromLastUsedLanguage } =
    useCaptions();
  const setShowVolume = useEmpheralVolumeStore((s) => s.setShowVolume);
  const primaryDelay = useSubtitleStore((s) => s.primaryDelay);
  const secondaryDelay = useSubtitleStore((s) => s.secondaryDelay);
  const setPrimaryDelay = useSubtitleStore((s) => s.setPrimaryDelay);
  const setSecondaryDelay = useSubtitleStore((s) => s.setSecondaryDelay);
  const setDelay =
    activeSubtitleTrack === "secondary" ? setSecondaryDelay : setPrimaryDelay;
  const delay =
    activeSubtitleTrack === "secondary" ? secondaryDelay : primaryDelay;
  const setShowDelayIndicator = useSubtitleStore(
    (s) => s.setShowDelayIndicator,
  );
  const storedKeyboardShortcuts = usePreferencesStore(
    (s) => s.keyboardShortcuts,
  );
  // Merge defaults with stored shortcuts to ensure new shortcuts are available
  const keyboardShortcuts = useMemo(
    () => ({
      ...DEFAULT_KEYBOARD_SHORTCUTS,
      ...storedKeyboardShortcuts,
    }),
    [storedKeyboardShortcuts],
  );
  const enableNumberKeySeeking = usePreferencesStore(
    (s) => s.enableNumberKeySeeking,
  );

  const [isRolling, setIsRolling] = useState(false);
  const volumeDebounce = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const subtitleDebounce = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const seekResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const lastSeekTargetRef = useRef<number | null>(null);
  const lastSeekKeyTimeRef = useRef<number>(0);

  const setCurrentOverlay = useOverlayStack((s) => s.setCurrentOverlay);

  useEffect(() => {
    if (!isPlaybackLocked) return;
    setCurrentOverlay(null);
  }, [isPlaybackLocked, setCurrentOverlay]);

  const performSeek = useCallback((delta: number) => {
    const maxDuration = dataRef.current.duration;
    const baseTime =
      lastSeekTargetRef.current !== null
        ? lastSeekTargetRef.current
        : dataRef.current.time;

    const targetTime = Math.max(
      0,
      Math.min(
        maxDuration > 0 ? maxDuration : Number.POSITIVE_INFINITY,
        baseTime + delta,
      ),
    );

    lastSeekTargetRef.current = targetTime;
    if (seekResetTimeoutRef.current) {
      clearTimeout(seekResetTimeoutRef.current);
    }
    seekResetTimeoutRef.current = setTimeout(() => {
      lastSeekTargetRef.current = null;
    }, 800);

    dataRef.current.display?.setTime(targetTime);
  }, []);

  const performAbsoluteSeek = useCallback((targetTime: number) => {
    const maxDuration = dataRef.current.duration;
    const clamped = Math.max(
      0,
      Math.min(
        maxDuration > 0 ? maxDuration : Number.POSITIVE_INFINITY,
        targetTime,
      ),
    );
    lastSeekTargetRef.current = clamped;
    if (seekResetTimeoutRef.current) {
      clearTimeout(seekResetTimeoutRef.current);
    }
    seekResetTimeoutRef.current = setTimeout(() => {
      lastSeekTargetRef.current = null;
    }, 800);

    dataRef.current.display?.setTime(clamped);
  }, []);

  const lastVolumeTargetRef = useRef<number | null>(null);
  const volumeResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const performVolumeChange = useCallback((delta: number) => {
    const currentVol =
      lastVolumeTargetRef.current !== null
        ? lastVolumeTargetRef.current
        : (dataRef.current.mediaPlaying?.volume ?? 1);

    const targetVolume = Math.max(
      0,
      Math.min(1, Math.round((currentVol + delta) * 100) / 100),
    );
    lastVolumeTargetRef.current = targetVolume;

    if (volumeResetTimeoutRef.current) {
      clearTimeout(volumeResetTimeoutRef.current);
    }
    volumeResetTimeoutRef.current = setTimeout(() => {
      lastVolumeTargetRef.current = null;
    }, 800);

    dataRef.current.setVolume(targetVolume);
  }, []);

  // Episode navigation functions
  const navigateToNextEpisode = useCallback(async () => {
    if (!meta || meta.type !== "show" || !meta.episode) return;
    usePlayerStore.getState().display?.pause();

    // Check if we're at the last episode of the current season
    const isLastEpisode =
      meta.episode.number === meta.episodes?.[meta.episodes.length - 1]?.number;

    if (!isLastEpisode) {
      // Navigate to next episode in current season
      const nextEp = meta.episodes?.find(
        (v) => v.number === meta.episode!.number + 1,
      );
      if (nextEp) {
        const metaCopy = { ...meta };
        metaCopy.episode = nextEp;
        setShouldStartFromBeginning(true);
        setDirectMeta(metaCopy);
        const defaultProgress = { duration: 0, watched: 0 };
        updateItem({
          meta: metaCopy,
          progress: defaultProgress,
        });
      }
    } else {
      // Navigate to first episode of next season
      if (!meta.tmdbId) return;

      try {
        const data = await getMetaFromId(MWMediaType.SERIES, meta.tmdbId);
        if (data?.meta.type !== MWMediaType.SERIES) return;

        const nextSeason = data.meta.seasons?.find(
          (season) => season.number === (meta.season?.number ?? 0) + 1,
        );

        if (nextSeason) {
          const seasonData = await getMetaFromId(
            MWMediaType.SERIES,
            meta.tmdbId,
            nextSeason.id,
          );

          if (seasonData?.meta.type === MWMediaType.SERIES) {
            const nextSeasonEpisodes = seasonData.meta.seasonData.episodes
              .filter((episode) => {
                // Simple aired check - episodes without air_date are considered aired
                return (
                  !episode.air_date || new Date(episode.air_date) <= new Date()
                );
              })
              .map((episode) => ({
                number: episode.number,
                title: episode.title,
                tmdbId: episode.id,
                air_date: episode.air_date,
              }));

            if (nextSeasonEpisodes.length > 0) {
              const nextEp = nextSeasonEpisodes[0];

              const metaCopy = { ...meta };
              metaCopy.episode = nextEp;
              metaCopy.season = {
                number: nextSeason.number,
                title: nextSeason.title,
                tmdbId: nextSeason.id,
              };
              metaCopy.episodes = nextSeasonEpisodes;
              setShouldStartFromBeginning(true);
              setDirectMeta(metaCopy);
              const defaultProgress = { duration: 0, watched: 0 };
              updateItem({
                meta: metaCopy,
                progress: defaultProgress,
              });
            }
          }
        }
      } catch (error) {
        console.error("Failed to load next season:", error);
      }
    }
  }, [meta, setDirectMeta, setShouldStartFromBeginning, updateItem]);

  const navigateToPreviousEpisode = useCallback(async () => {
    if (!meta || meta.type !== "show" || !meta.episode) return;
    usePlayerStore.getState().display?.pause();

    // Check if we're at the first episode of the current season
    const isFirstEpisode = meta.episode.number === meta.episodes?.[0]?.number;

    if (!isFirstEpisode) {
      // Navigate to previous episode in current season
      const prevEp = meta.episodes?.find(
        (v) => v.number === meta.episode!.number - 1,
      );
      if (prevEp) {
        const metaCopy = { ...meta };
        metaCopy.episode = prevEp;
        setShouldStartFromBeginning(true);
        setDirectMeta(metaCopy);
        const defaultProgress = { duration: 0, watched: 0 };
        updateItem({
          meta: metaCopy,
          progress: defaultProgress,
        });
      }
    } else {
      // Navigate to last episode of previous season
      if (!meta.tmdbId) return;

      try {
        const data = await getMetaFromId(MWMediaType.SERIES, meta.tmdbId);
        if (data?.meta.type !== MWMediaType.SERIES) return;

        const prevSeason = data.meta.seasons?.find(
          (season) => season.number === (meta.season?.number ?? 0) - 1,
        );

        if (prevSeason) {
          const seasonData = await getMetaFromId(
            MWMediaType.SERIES,
            meta.tmdbId,
            prevSeason.id,
          );

          if (seasonData?.meta.type === MWMediaType.SERIES) {
            const prevSeasonEpisodes = seasonData.meta.seasonData.episodes
              .filter((episode) => {
                // Simple aired check - episodes without air_date are considered aired
                return (
                  !episode.air_date || new Date(episode.air_date) <= new Date()
                );
              })
              .map((episode) => ({
                number: episode.number,
                title: episode.title,
                tmdbId: episode.id,
                air_date: episode.air_date,
              }));

            if (prevSeasonEpisodes.length > 0) {
              const prevEp = prevSeasonEpisodes[prevSeasonEpisodes.length - 1];

              const metaCopy = { ...meta };
              metaCopy.episode = prevEp;
              metaCopy.season = {
                number: prevSeason.number,
                title: prevSeason.title,
                tmdbId: prevSeason.id,
              };
              metaCopy.episodes = prevSeasonEpisodes;
              setShouldStartFromBeginning(true);
              setDirectMeta(metaCopy);
              const defaultProgress = { duration: 0, watched: 0 };
              updateItem({
                meta: metaCopy,
                progress: defaultProgress,
              });
            }
          }
        }
      } catch (error) {
        console.error("Failed to load previous season:", error);
      }
    }
  }, [meta, setDirectMeta, setShouldStartFromBeginning, updateItem]);

  const dataRef = useRef({
    setShowVolume,
    setVolume,
    toggleMute,
    setIsRolling,
    toggleLastUsed,
    selectBestCaptionFromLastUsedLanguage,
    display,
    mediaPlaying,
    mediaProgress,
    isSeeking,
    isRolling,
    time,
    duration,
    activeSubtitleTrack,
    router,
    setDelay,
    delay,
    setShowDelayIndicator,
    setCurrentOverlay,
    isInWatchParty,
    performSeek,
    performAbsoluteSeek,
    performVolumeChange,
    navigateToNextEpisode,
    navigateToPreviousEpisode,
    keyboardShortcuts,
    enableNumberKeySeeking,
  });

  useEffect(() => {
    dataRef.current = {
      setShowVolume,
      setVolume,
      toggleMute,
      setIsRolling,
      toggleLastUsed,
      selectBestCaptionFromLastUsedLanguage,
      display,
      mediaPlaying,
      mediaProgress,
      isSeeking,
      isRolling,
      time,
      duration,
      activeSubtitleTrack,
      router,
      setDelay,
      delay,
      setShowDelayIndicator,
      setCurrentOverlay,
      isInWatchParty,
      performSeek,
      performAbsoluteSeek,
      performVolumeChange,
      navigateToNextEpisode,
      navigateToPreviousEpisode,
      keyboardShortcuts,
      enableNumberKeySeeking,
    };
  }, [
    setShowVolume,
    setVolume,
    toggleMute,
    setIsRolling,
    toggleLastUsed,
    selectBestCaptionFromLastUsedLanguage,
    display,
    mediaPlaying,
    mediaProgress,
    isSeeking,
    isRolling,
    time,
    duration,
    activeSubtitleTrack,
    router,
    setDelay,
    delay,
    setShowDelayIndicator,
    setCurrentOverlay,
    isInWatchParty,
    performSeek,
    performAbsoluteSeek,
    performVolumeChange,
    navigateToNextEpisode,
    navigateToPreviousEpisode,
    keyboardShortcuts,
    enableNumberKeySeeking,
  ]);

  useEffect(() => {
    const keydownEventHandler = (evt: KeyboardEvent) => {
      if (evt.target && (evt.target as HTMLInputElement).nodeName === "INPUT")
        return;

      const state = usePlayerStore.getState();
      if (
        isPlaybackInteractionLocked(
          state.mediaPlaying,
          state.subtitleSync.active,
        )
      ) {
        evt.preventDefault();
        return;
      }

      const k = evt.key;
      const keyL = evt.key.toLowerCase();

      const isVolumeUp =
        k === LOCKED_SHORTCUTS.ARROW_UP ||
        matchesShortcut(
          evt,
          dataRef.current.keyboardShortcuts[ShortcutId.INCREASE_VOLUME],
        );
      const isVolumeDown =
        k === LOCKED_SHORTCUTS.ARROW_DOWN ||
        matchesShortcut(
          evt,
          dataRef.current.keyboardShortcuts[ShortcutId.DECREASE_VOLUME],
        );
      const isMute =
        matchesShortcut(
          evt,
          dataRef.current.keyboardShortcuts[ShortcutId.MUTE],
        ) || ["m", "M"].includes(k);

      // Volume (locked shortcuts & customizable shortcuts)
      if (isVolumeUp || isVolumeDown || isMute) {
        dataRef.current.setShowVolume(true);
        dataRef.current.setCurrentOverlay("volume");

        if (volumeDebounce.current) clearTimeout(volumeDebounce.current);
        volumeDebounce.current = setTimeout(() => {
          dataRef.current.setShowVolume(false);
          dataRef.current.setCurrentOverlay(null);
        }, 3e3);
      }
      if (isVolumeUp) {
        evt.preventDefault();
        dataRef.current.performVolumeChange(0.15);
        return;
      }
      if (isVolumeDown) {
        evt.preventDefault();
        dataRef.current.performVolumeChange(-0.15);
        return;
      }
      // Mute - check customizable shortcut or m/M
      if (isMute) {
        lastVolumeTargetRef.current = null;
        dataRef.current.toggleMute();
        return;
      }

      // Video playback speed - disabled in watch party (hardcoded, not customizable)
      if ((k === ">" || k === "<") && !dataRef.current.isInWatchParty) {
        const options = [0.25, 0.5, 1, 1.5, 2];
        let idx = options.indexOf(dataRef.current.mediaPlaying?.playbackRate);
        if (idx === -1) idx = options.indexOf(1);
        const nextIdx = idx + (k === ">" ? 1 : -1);
        const next = options[nextIdx];
        if (next) dataRef.current.display?.setPlaybackRate(next);
      }

      // Handle spacebar press & MediaPlayPause for immediate play/pause
      // Space is locked, always check it
      if (k === LOCKED_SHORTCUTS.PLAY_PAUSE_SPACE || k === "MediaPlayPause") {
        // Skip if it's a repeated event
        if (evt.repeat) {
          return;
        }

        // Skip if a button is targeted
        if (evt.target && (evt.target as HTMLElement).nodeName === "BUTTON") {
          return;
        }

        // Prevent the default spacebar behavior
        evt.preventDefault();

        // Do not allow pause if video is still loading (but allow play if paused)
        if (
          !dataRef.current.mediaPlaying.isPaused &&
          (dataRef.current.mediaPlaying.isLoading ||
            !dataRef.current.mediaPlaying.hasRenderedFrame)
        ) {
          return;
        }

        const action = dataRef.current.mediaPlaying.isPaused ? "play" : "pause";
        dataRef.current.display?.[action]();
        return;
      }

      if (k === "MediaStop") {
        evt.preventDefault();
        dataRef.current.display?.pause();
        return;
      }

      // Subtitle delay - customizable; handle before repeat guard so holding works.
      if (
        matchesShortcut(
          evt,
          dataRef.current.keyboardShortcuts[ShortcutId.SYNC_SUBTITLES_EARLIER],
        )
      ) {
        evt.preventDefault();
        const subtitleState = useSubtitleStore.getState();
        const currentDelay =
          dataRef.current.activeSubtitleTrack === "secondary"
            ? subtitleState.secondaryDelay
            : subtitleState.primaryDelay;
        dataRef.current.setDelay(currentDelay - 0.5);
        dataRef.current.setShowDelayIndicator(true);
        dataRef.current.setCurrentOverlay("subtitle");
        if (subtitleDebounce.current) clearTimeout(subtitleDebounce.current);
        subtitleDebounce.current = setTimeout(() => {
          dataRef.current.setShowDelayIndicator(false);
          dataRef.current.setCurrentOverlay(null);
        }, 3000);
        return;
      }
      if (
        matchesShortcut(
          evt,
          dataRef.current.keyboardShortcuts[ShortcutId.SYNC_SUBTITLES_LATER],
        )
      ) {
        evt.preventDefault();
        const subtitleState = useSubtitleStore.getState();
        const currentDelay =
          dataRef.current.activeSubtitleTrack === "secondary"
            ? subtitleState.secondaryDelay
            : subtitleState.primaryDelay;
        dataRef.current.setDelay(currentDelay + 0.5);
        dataRef.current.setShowDelayIndicator(true);
        dataRef.current.setCurrentOverlay("subtitle");
        if (subtitleDebounce.current) clearTimeout(subtitleDebounce.current);
        subtitleDebounce.current = setTimeout(() => {
          dataRef.current.setShowDelayIndicator(false);
          dataRef.current.setCurrentOverlay(null);
        }, 3000);
        return;
      }

      // Video progress - handle skip shortcuts with accumulated seek & throttled repeat
      const canHandleSeek = () => {
        const now = performance.now();
        if (evt.repeat) {
          if (now - lastSeekKeyTimeRef.current < 150) {
            return false;
          }
        }
        lastSeekKeyTimeRef.current = now;
        return true;
      };

      // Arrow keys are locked (always 5 seconds)
      if (k === LOCKED_SHORTCUTS.ARROW_RIGHT) {
        evt.preventDefault();
        if (canHandleSeek()) {
          dataRef.current.performSeek(5);
        }
        return;
      }
      if (k === LOCKED_SHORTCUTS.ARROW_LEFT) {
        evt.preventDefault();
        if (canHandleSeek()) {
          dataRef.current.performSeek(-5);
        }
        return;
      }

      // Skip forward/backward 5 seconds - customizable (skip if set to arrow keys)
      const skipForward5 =
        dataRef.current.keyboardShortcuts[ShortcutId.SKIP_FORWARD_5];
      if (
        skipForward5?.key &&
        skipForward5.key !== LOCKED_SHORTCUTS.ARROW_RIGHT &&
        matchesShortcut(evt, skipForward5)
      ) {
        evt.preventDefault();
        if (canHandleSeek()) {
          dataRef.current.performSeek(5);
        }
        return;
      }
      const skipBackward5 =
        dataRef.current.keyboardShortcuts[ShortcutId.SKIP_BACKWARD_5];
      if (
        skipBackward5?.key &&
        skipBackward5.key !== LOCKED_SHORTCUTS.ARROW_LEFT &&
        matchesShortcut(evt, skipBackward5)
      ) {
        evt.preventDefault();
        if (canHandleSeek()) {
          dataRef.current.performSeek(-5);
        }
        return;
      }

      // Skip forward/backward 10 seconds - customizable
      if (
        matchesShortcut(
          evt,
          dataRef.current.keyboardShortcuts[ShortcutId.SKIP_FORWARD_10],
        )
      ) {
        evt.preventDefault();
        if (canHandleSeek()) {
          dataRef.current.performSeek(10);
        }
        return;
      }
      if (
        matchesShortcut(
          evt,
          dataRef.current.keyboardShortcuts[ShortcutId.SKIP_BACKWARD_10],
        )
      ) {
        evt.preventDefault();
        if (canHandleSeek()) {
          dataRef.current.performSeek(-10);
        }
        return;
      }

      // Skip forward/backward 1 second - customizable
      if (
        matchesShortcut(
          evt,
          dataRef.current.keyboardShortcuts[ShortcutId.SKIP_FORWARD_1],
        )
      ) {
        evt.preventDefault();
        if (canHandleSeek()) {
          dataRef.current.performSeek(1);
        }
        return;
      }
      if (
        matchesShortcut(
          evt,
          dataRef.current.keyboardShortcuts[ShortcutId.SKIP_BACKWARD_1],
        )
      ) {
        evt.preventDefault();
        if (canHandleSeek()) {
          dataRef.current.performSeek(-1);
        }
        return;
      }

      // Skip to percentage with number keys (0-9) - locked, always use number keys
      if (
        dataRef.current.enableNumberKeySeeking &&
        /^[0-9]$/.test(k) &&
        dataRef.current.duration > 0 &&
        !evt.ctrlKey &&
        !evt.metaKey &&
        !evt.shiftKey &&
        !evt.altKey
      ) {
        if (evt.repeat) return;
        evt.preventDefault();
        if (k === "0") {
          dataRef.current.performAbsoluteSeek(0);
        } else if (k === "9") {
          const targetTime = (dataRef.current.duration * 90) / 100;
          dataRef.current.performAbsoluteSeek(targetTime);
        } else {
          // 1-8 for 10%-80%
          const percentage = parseInt(k, 10) * 10;
          const targetTime = (dataRef.current.duration * percentage) / 100;
          dataRef.current.performAbsoluteSeek(targetTime);
        }
        return;
      }

      // Utils - Fullscreen is customizable
      if (
        matchesShortcut(
          evt,
          dataRef.current.keyboardShortcuts[ShortcutId.TOGGLE_FULLSCREEN],
        )
      ) {
        if (evt.repeat) return;
        dataRef.current.display?.toggleFullscreen();
      }

      // K key for play/pause - locked shortcut
      if (keyL === LOCKED_SHORTCUTS.PLAY_PAUSE_K.toLowerCase()) {
        if (evt.repeat) return;
        if (evt.target && (evt.target as HTMLElement).nodeName === "BUTTON") {
          return;
        }

        if (
          !dataRef.current.mediaPlaying.isPaused &&
          (dataRef.current.mediaPlaying.isLoading ||
            !dataRef.current.mediaPlaying.hasRenderedFrame)
        ) {
          return;
        }

        const action = dataRef.current.mediaPlaying.isPaused ? "play" : "pause";
        dataRef.current.display?.[action]();
        return;
      }

      // Media keys: Next / Previous Track
      if (k === "MediaTrackNext") {
        if (evt.repeat) return;
        evt.preventDefault();
        dataRef.current.navigateToNextEpisode();
        return;
      }
      if (k === "MediaTrackPrevious") {
        if (evt.repeat) return;
        evt.preventDefault();
        dataRef.current.navigateToPreviousEpisode();
        return;
      }

      // Escape is locked
      if (k === LOCKED_SHORTCUTS.ESCAPE) {
        if (dataRef.current.router.isRouterActive) {
          dataRef.current.router.close();
        } else if (usePlayerStore.getState().interface.isFullscreen) {
          if (dataRef.current.display?.exitFullscreen) {
            dataRef.current.display.exitFullscreen();
          } else {
            dataRef.current.display?.toggleFullscreen();
          }
        }
      }

      // Episode navigation (shows only) - customizable
      if (
        matchesShortcut(
          evt,
          dataRef.current.keyboardShortcuts[ShortcutId.NEXT_EPISODE],
        )
      ) {
        if (evt.repeat) return;
        dataRef.current.navigateToNextEpisode();
      }
      if (
        matchesShortcut(
          evt,
          dataRef.current.keyboardShortcuts[ShortcutId.PREVIOUS_EPISODE],
        )
      ) {
        if (evt.repeat) return;
        dataRef.current.navigateToPreviousEpisode();
      }

      // Captions - customizable
      if (
        matchesShortcut(
          evt,
          dataRef.current.keyboardShortcuts[ShortcutId.TOGGLE_CAPTIONS],
        )
      ) {
        dataRef.current.toggleLastUsed().catch(() => {}); // ignore errors
      }
      // Best-fit caption selection - customizable
      if (
        matchesShortcut(
          evt,
          dataRef.current.keyboardShortcuts[ShortcutId.RANDOM_CAPTION],
        )
      ) {
        dataRef.current.selectBestCaptionFromLastUsedLanguage().catch(() => {}); // ignore errors
      }

      // Barrel roll - customizable
      if (
        matchesShortcut(
          evt,
          dataRef.current.keyboardShortcuts[ShortcutId.BARREL_ROLL],
        )
      ) {
        if (dataRef.current.isRolling || evt.ctrlKey || evt.metaKey) return;

        dataRef.current.setIsRolling(true);
        document.querySelector(".popout-location")?.classList.add("roll");
        document.body.setAttribute("data-no-scroll", "true");

        setTimeout(() => {
          document.querySelector(".popout-location")?.classList.remove("roll");
          document.body.removeAttribute("data-no-scroll");
          dataRef.current.setIsRolling(false);
        }, 1e3);
      }
    };

    window.addEventListener("keydown", keydownEventHandler);

    return () => {
      window.removeEventListener("keydown", keydownEventHandler);
      if (subtitleDebounce.current) {
        clearTimeout(subtitleDebounce.current);
      }
      if (volumeDebounce.current) {
        clearTimeout(volumeDebounce.current);
      }
      if (volumeResetTimeoutRef.current) {
        clearTimeout(volumeResetTimeoutRef.current);
      }
      if (seekResetTimeoutRef.current) {
        clearTimeout(seekResetTimeoutRef.current);
      }
    };
  }, []);

  return null;
}
