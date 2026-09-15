import { useCallback, useEffect, useRef } from "react";

import { isPlaybackInteractionLocked } from "@/components/player/utils/playbackLock";
import { playerStatus } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";

import { usePlayerMeta } from "../hooks/usePlayerMeta";

// Native libmpv audio is outside Chromium's media-element graph. This tiny
// silent element gives Chromium audio focus so its Media Session can reach the
// Windows/macOS system media controls without adding a second audible player.
const SILENT_AUDIO_DATA_URL =
  "data:audio/wav;base64,UklGRiUAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQEAAACA";

const MEDIA_SESSION_ACTIONS: MediaSessionAction[] = [
  "play",
  "pause",
  "stop",
  "seekbackward",
  "seekforward",
  "seekto",
  "previoustrack",
  "nexttrack",
];

function getMediaSession(): globalThis.MediaSession | null {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
    return null;
  }
  return navigator.mediaSession;
}

function isDesktopShell(): boolean {
  return Boolean(
    (window as Window & { __FRAMEZOO_DESKTOP__?: boolean })
      .__FRAMEZOO_DESKTOP__,
  );
}

function setActionHandler(
  mediaSession: globalThis.MediaSession,
  action: MediaSessionAction,
  handler: MediaSessionActionHandler | null,
) {
  try {
    mediaSession.setActionHandler(action, handler);
  } catch {
    // Chromium exposes some actions only on selected platform versions.
  }
}

function clearMediaSession(mediaSession: globalThis.MediaSession) {
  mediaSession.metadata = null;
  mediaSession.playbackState = "none";
  for (const action of MEDIA_SESSION_ACTIONS) {
    setActionHandler(mediaSession, action, null);
  }
}

export function MediaSession() {
  const { setDirectMeta } = usePlayerMeta();
  const setShouldStartFromBeginning = usePlayerStore(
    (s) => s.setShouldStartFromBeginning,
  );

  const status = usePlayerStore((s) => s.status);
  const mediaPlaying = usePlayerStore((s) => s.mediaPlaying);
  const progress = usePlayerStore((s) => s.progress);
  const meta = usePlayerStore((s) => s.meta);
  const display = usePlayerStore((s) => s.display);

  const audioFocusRef = useRef<HTMLAudioElement | null>(null);

  const hasActiveMedia = Boolean(
    display &&
    meta &&
    status === playerStatus.PLAYING &&
    (mediaPlaying.isPlaying ||
      mediaPlaying.isLoading ||
      mediaPlaying.hasPlayedOnce),
  );

  const changeEpisode = useCallback(
    (change: number) => {
      const nextEp = meta?.episodes?.find(
        (v) => v.number === (meta?.episode?.number ?? 0) + change,
      );

      if (!meta || !nextEp) return;
      const state = usePlayerStore.getState();
      if (
        isPlaybackInteractionLocked(
          state.mediaPlaying,
          state.subtitleSync.active,
        )
      ) {
        return;
      }

      const metaCopy = { ...meta };
      metaCopy.episode = nextEp;
      setShouldStartFromBeginning(true);
      setDirectMeta(metaCopy);
    },
    [meta, setDirectMeta, setShouldStartFromBeginning],
  );

  const updatePositionState = useCallback((position: number) => {
    const mediaSession = getMediaSession();
    if (!mediaSession || typeof mediaSession.setPositionState !== "function") {
      return;
    }

    const state = usePlayerStore.getState();
    const duration = state.progress.duration;
    if (
      typeof duration !== "number" ||
      !Number.isFinite(duration) ||
      duration <= 0
    ) {
      return;
    }

    const playbackRate = Number.isFinite(state.mediaPlaying.playbackRate)
      ? Math.max(0.1, state.mediaPlaying.playbackRate)
      : 1;
    const safePosition = Math.min(
      duration,
      Math.max(0, Number.isFinite(position) ? position : 0),
    );

    try {
      mediaSession.setPositionState({
        duration,
        playbackRate,
        position: safePosition,
      });
    } catch {
      // Position state is optional and can be rejected while a source reloads.
    }
  }, []);

  useEffect(() => {
    const mediaSession = getMediaSession();
    if (!mediaSession) return;

    mediaSession.playbackState = hasActiveMedia
      ? mediaPlaying.isPaused
        ? "paused"
        : "playing"
      : "none";
  }, [hasActiveMedia, mediaPlaying.isPaused]);

  useEffect(() => {
    if (!hasActiveMedia) return;
    updatePositionState(progress.time);
  }, [hasActiveMedia, progress.time, progress.duration, updatePositionState]);

  useEffect(() => {
    if (!isDesktopShell()) return;

    const audio = new Audio(SILENT_AUDIO_DATA_URL);
    audio.preload = "auto";
    audio.loop = true;
    audio.volume = 1;
    audio.setAttribute("aria-hidden", "true");
    audioFocusRef.current = audio;

    return () => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audioFocusRef.current = null;
    };
  }, []);

  useEffect(() => {
    const audio = audioFocusRef.current;
    if (!audio) return;

    if (hasActiveMedia && mediaPlaying.isPlaying) {
      void audio.play().catch(() => {
        // The Electron shell normally allows autoplay; retry on the next state update.
      });
      return;
    }

    audio.pause();
  }, [hasActiveMedia, mediaPlaying.isPlaying]);

  useEffect(() => {
    const mediaSession = getMediaSession();
    if (
      !mediaSession ||
      !hasActiveMedia ||
      typeof MediaMetadata === "undefined"
    ) {
      if (mediaSession && !hasActiveMedia) clearMediaSession(mediaSession);
      return;
    }

    if (!meta) {
      clearMediaSession(mediaSession);
      return;
    }

    let title: string | undefined;
    let artist: string | undefined;
    let album: string | undefined;

    if (meta.type === "movie") {
      title = meta.title;
    } else if (meta.type === "show") {
      artist = meta.title;
      album = `Season ${meta.season?.number ?? 1}`;
      title = `S${meta.season?.number} E${meta.episode?.number}: ${meta.episode?.title}`;
    }

    if (!title) {
      clearMediaSession(mediaSession);
      return;
    }

    const artwork =
      typeof meta?.poster === "string" && meta.poster.length > 0
        ? [{ src: meta.poster, sizes: "342x513", type: "image/png" }]
        : undefined;

    mediaSession.metadata = new MediaMetadata({
      title,
      ...(artist ? { artist } : {}),
      ...(album ? { album } : {}),
      ...(artwork ? { artwork } : {}),
    });

    setActionHandler(mediaSession, "play", () => {
      const state = usePlayerStore.getState();
      if (
        isPlaybackInteractionLocked(
          state.mediaPlaying,
          state.subtitleSync.active,
        )
      ) {
        return;
      }
      state.display?.play();
      updatePositionState(state.progress.time);
    });

    setActionHandler(mediaSession, "pause", () => {
      const state = usePlayerStore.getState();
      if (
        isPlaybackInteractionLocked(
          state.mediaPlaying,
          state.subtitleSync.active,
        )
      ) {
        return;
      }
      state.display?.pause();
      updatePositionState(state.progress.time);
    });

    setActionHandler(mediaSession, "stop", () => {
      const state = usePlayerStore.getState();
      if (
        isPlaybackInteractionLocked(
          state.mediaPlaying,
          state.subtitleSync.active,
        )
      ) {
        return;
      }
      state.display?.pause();
    });

    setActionHandler(mediaSession, "seekto", (event) => {
      const state = usePlayerStore.getState();
      if (
        event.seekTime == null ||
        !Number.isFinite(event.seekTime) ||
        isPlaybackInteractionLocked(
          state.mediaPlaying,
          state.subtitleSync.active,
        )
      ) {
        return;
      }
      state.display?.setTime(event.seekTime);
      updatePositionState(event.seekTime);
    });

    const seekBy = (direction: -1 | 1, offset?: number) => {
      const state = usePlayerStore.getState();
      if (
        isPlaybackInteractionLocked(
          state.mediaPlaying,
          state.subtitleSync.active,
        )
      ) {
        return;
      }
      const delta = Number.isFinite(offset) && offset! > 0 ? offset! : 10;
      const nextTime = state.progress.time + direction * delta;
      state.display?.setTime(nextTime);
      updatePositionState(nextTime);
    };

    setActionHandler(mediaSession, "seekbackward", (event) =>
      seekBy(-1, event.seekOffset),
    );
    setActionHandler(mediaSession, "seekforward", (event) =>
      seekBy(1, event.seekOffset),
    );

    if ((meta.episode?.number ?? 1) > 1) {
      setActionHandler(mediaSession, "previoustrack", () => changeEpisode(-1));
    } else {
      setActionHandler(mediaSession, "previoustrack", null);
    }

    const totalEpisodes = meta.episodes?.length ?? 0;
    const currentEpisodeNumber = meta.episode?.number ?? 0;
    if (currentEpisodeNumber > 0 && currentEpisodeNumber < totalEpisodes) {
      setActionHandler(mediaSession, "nexttrack", () => changeEpisode(1));
    } else {
      setActionHandler(mediaSession, "nexttrack", null);
    }

    return () => clearMediaSession(mediaSession);
  }, [changeEpisode, hasActiveMedia, meta, updatePositionState]);

  useEffect(() => {
    return () => {
      const mediaSession = getMediaSession();
      if (mediaSession) clearMediaSession(mediaSession);
    };
  }, []);

  return null;
}
