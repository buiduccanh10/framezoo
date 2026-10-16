import { useCallback, useEffect, useRef, useState } from "react";

import { isPlaybackInteractionLocked } from "@/components/player/utils/playbackLock";
import { usePlayerStore } from "@/stores/player/store";

import { usePlayerMeta } from "../hooks/usePlayerMeta";

export function MediaSession() {
  const { setDirectMeta } = usePlayerMeta();
  const setShouldStartFromBeginning = usePlayerStore(
    (s) => s.setShouldStartFromBeginning,
  );

  const mediaPlaying = usePlayerStore((s) => s.mediaPlaying);
  const progress = usePlayerStore((s) => s.progress);
  const meta = usePlayerStore((s) => s.meta);
  const display = usePlayerStore((s) => s.display);
  const [nativeControlsAvailable, setNativeControlsAvailable] = useState(false);

  const shouldUpdatePositionState = useRef(false);
  const lastPlaybackPosition = useRef(0);

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
      )
        return;

      const metaCopy = { ...meta };
      metaCopy.episode = nextEp;
      setShouldStartFromBeginning(true);
      setDirectMeta(metaCopy);
    },
    [meta, setDirectMeta, setShouldStartFromBeginning],
  );

  useEffect(() => {
    const api = window.electronAPI;
    if (typeof api?.getNativeMediaControlsState !== "function") return;
    let active = true;
    void api
      .getNativeMediaControlsState()
      .then((available) => {
        if (active) setNativeControlsAvailable(available === true);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!nativeControlsAvailable) return;
    const onNativeMediaCommand = window.electronAPI?.onNativeMediaCommand;
    if (typeof onNativeMediaCommand !== "function") return;

    return onNativeMediaCommand(({ command }) => {
      const state = usePlayerStore.getState();
      if (
        isPlaybackInteractionLocked(
          state.mediaPlaying,
          state.subtitleSync.active,
        )
      ) {
        return;
      }

      if (command === "next") {
        changeEpisode(1);
        return;
      }
      if (command === "previous") {
        changeEpisode(-1);
        return;
      }
      if (command === "play") {
        state.display?.play();
        return;
      }
      if (command === "pause") {
        state.display?.pause();
        return;
      }
      if (state.mediaPlaying.isPaused) {
        state.display?.play();
      } else {
        state.display?.pause();
      }
    });
  }, [changeEpisode, nativeControlsAvailable]);

  useEffect(() => {
    if (!nativeControlsAvailable) return;
    const api = window.electronAPI;
    if (
      typeof api?.setNativeMediaMetadata !== "function" ||
      typeof api.setNativeMediaNavigation !== "function"
    ) {
      return;
    }

    const episodeNumber = meta?.episode?.number;
    const seasonNumber = meta?.season?.number;
    const isShowEpisode =
      meta?.type === "show" &&
      typeof episodeNumber === "number" &&
      typeof seasonNumber === "number";
    const title = isShowEpisode
      ? `S${String(seasonNumber).padStart(2, "0")}E${String(episodeNumber).padStart(2, "0")}: ${meta?.episode?.title ?? ""}`
      : (meta?.title ?? "");
    const previousEnabled = Boolean(
      isShowEpisode &&
      meta?.episodes?.find((episode) => episode.number === episodeNumber - 1),
    );
    const nextEnabled = Boolean(
      isShowEpisode &&
      meta?.episodes?.find((episode) => episode.number === episodeNumber + 1),
    );

    void api
      .setNativeMediaMetadata({
        title,
        artist: isShowEpisode ? (meta?.title ?? "") : "",
        albumTitle: isShowEpisode
          ? (meta?.season?.title ?? `Season ${seasonNumber}`)
          : "",
        artworkUrl: meta?.poster,
      })
      .catch(() => {});
    void api
      .setNativeMediaNavigation({ previousEnabled, nextEnabled })
      .catch(() => {});
  }, [
    meta?.episode?.number,
    meta?.episode?.title,
    meta?.episodes,
    meta?.season?.number,
    meta?.season?.title,
    meta?.title,
    meta?.type,
    meta?.poster,
    nativeControlsAvailable,
  ]);

  const updatePositionState = useCallback(
    (position: number) => {
      if (typeof navigator.mediaSession.setPositionState !== "function") return;

      const { duration, buffered } = progress;
      const { playbackRate } = mediaPlaying;

      if (
        typeof duration !== "number" ||
        Number.isNaN(duration) ||
        !Number.isFinite(duration) ||
        duration <= 0
      ) {
        return;
      }

      if (
        typeof position !== "number" ||
        Number.isNaN(position) ||
        position < 0
      ) {
        position = 0;
      }

      if (position > buffered) {
        shouldUpdatePositionState.current = true;
      }

      if (position > duration) {
        position = duration;
      }

      lastPlaybackPosition.current = progress.time;

      navigator.mediaSession.setPositionState({
        duration,
        playbackRate,
        position,
      });
    },
    [mediaPlaying, progress],
  );

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = mediaPlaying.isPaused
      ? "paused"
      : "playing";
  }, [mediaPlaying.isPaused]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    if (
      typeof progress.duration !== "number" ||
      Number.isNaN(progress.duration) ||
      progress.duration <= 0
    ) {
      return;
    }
    updatePositionState(progress.time);
  }, [
    progress.time,
    mediaPlaying.playbackRate,
    progress.duration,
    updatePositionState,
  ]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;

    const { time, duration } = progress;
    const { isLoading } = mediaPlaying;

    if (
      typeof duration !== "number" ||
      Number.isNaN(duration) ||
      duration <= 0
    ) {
      return;
    }

    if (!shouldUpdatePositionState.current && isLoading) {
      shouldUpdatePositionState.current = true;
    }

    if (
      !isLoading &&
      !shouldUpdatePositionState.current &&
      Math.abs(time - lastPlaybackPosition.current) >= 5
    ) {
      shouldUpdatePositionState.current = true;
    }

    if (shouldUpdatePositionState.current && !isLoading) {
      shouldUpdatePositionState.current = false;
      updatePositionState(time);
    }

    lastPlaybackPosition.current = time;
  }, [mediaPlaying, progress, updatePositionState]);

  useEffect(() => {
    if (
      !("mediaSession" in navigator) ||
      (!mediaPlaying.isLoading && mediaPlaying.isPlaying && !display)
    ) {
      return;
    }

    let title: string | undefined;
    let artist: string | undefined;

    const clearWebActionHandlers = () => {
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
      navigator.mediaSession.setActionHandler("seekto", null);
      navigator.mediaSession.setActionHandler("previoustrack", null);
      navigator.mediaSession.setActionHandler("nexttrack", null);
    };

    if (meta?.type === "movie") {
      title = meta.title;
    } else if (meta?.type === "show") {
      artist = meta.title;
      title = `S${meta.season?.number} E${meta.episode?.number}: ${meta.episode?.title}`;
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      artwork: [
        { src: meta?.poster ?? "", sizes: "342x513", type: "image/png" },
      ],
    });

    if (nativeControlsAvailable) {
      clearWebActionHandlers();
      return;
    }

    navigator.mediaSession.setActionHandler("play", () => {
      const state = usePlayerStore.getState();
      if (
        isPlaybackInteractionLocked(
          state.mediaPlaying,
          state.subtitleSync.active,
        )
      ) {
        return;
      }
      display?.play();
      updatePositionState(progress.time);
    });

    navigator.mediaSession.setActionHandler("pause", () => {
      const state = usePlayerStore.getState();
      if (
        isPlaybackInteractionLocked(
          state.mediaPlaying,
          state.subtitleSync.active,
        )
      ) {
        return;
      }
      display?.pause();
      updatePositionState(progress.time);
    });

    navigator.mediaSession.setActionHandler("seekto", (e) => {
      const state = usePlayerStore.getState();
      if (
        e.seekTime == null ||
        isPlaybackInteractionLocked(
          state.mediaPlaying,
          state.subtitleSync.active,
        )
      ) {
        return;
      }
      display?.setTime(e.seekTime);
      updatePositionState(e.seekTime);
    });

    const currentEpisodeNumber = meta?.episode?.number ?? 0;
    const hasPreviousEpisode = Boolean(
      meta?.episodes?.find(
        (episode) => episode.number === currentEpisodeNumber - 1,
      ),
    );
    if (hasPreviousEpisode) {
      navigator.mediaSession.setActionHandler("previoustrack", () =>
        changeEpisode(-1),
      );
    } else {
      navigator.mediaSession.setActionHandler("previoustrack", null);
    }

    const hasNextEpisode = Boolean(
      meta?.episodes?.find(
        (episode) => episode.number === currentEpisodeNumber + 1,
      ),
    );
    if (hasNextEpisode) {
      navigator.mediaSession.setActionHandler("nexttrack", () =>
        changeEpisode(1),
      );
    } else {
      navigator.mediaSession.setActionHandler("nexttrack", null);
    }

    return clearWebActionHandlers;
  }, [
    changeEpisode,
    updatePositionState,
    mediaPlaying.isLoading,
    mediaPlaying.isPlaying,
    display,
    progress.duration,
    progress.time,
    meta?.episode?.number,
    meta?.episodes,
    meta?.episode?.title,
    meta?.title,
    meta?.type,
    meta?.poster,
    meta?.season?.number,
    nativeControlsAvailable,
  ]);

  return null;
}

// what did we learn today? never use isNaN instead of Number.isNaN !!!
