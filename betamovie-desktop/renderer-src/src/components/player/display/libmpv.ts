import fscreen from "fscreen";

import {
  DisplayCaption,
  DisplayError,
  DisplayInterface,
  DisplayInterfaceEvents,
  DisplayMeta,
  MpvTrack,
  PictureInPictureMode,
} from "@/components/player/display/displayInterface";
import {
  DesktopPipAction,
  DesktopPipState,
  getDesktopPipStateFromPlayerState,
  getPersistedDesktopPipWindowSize,
} from "@/desktop/pip";
import { usePlayerStore } from "@/stores/player/store";
import { LoadableSource } from "@/stores/player/utils/qualities";
import { useSubtitleStore } from "@/stores/subtitles";
import { makeEmitter } from "@/utils/events";

type LibMpvBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type LibMpvPlayerEvent = {
  playerId: string;
  playbackId?: string;
  generation: number;
  type:
    | "property"
    | "file-loaded"
    | "video-reconfig"
    | "video-frame"
    | "end-file"
    | "log"
    | "error";
  name?: string;
  data?: unknown;
  message?: string;
  level?: string;
};

type LibMpvLogEvent = {
  level?: string;
  name?: string;
  data?: unknown;
};

type LibMpvSourceRequest = {
  url: string;
  type: "file" | "mp4" | "hls" | "dash" | "web";
  startAt: number;
  autoplay: boolean;
  headers?: Record<string, string>;
};

type LibMpvCommand =
  | { type: "play" }
  | { type: "pause" }
  | { type: "seek"; time: number }
  | { type: "set-volume"; volume: number }
  | { type: "set-mute"; muted: boolean }
  | { type: "set-playback-rate"; rate: number }
  | { type: "set-audio-track"; trackId: string }
  | { type: "set-subtitle-track"; trackId: string };

type PendingLoad = {
  generation: number;
  source: LoadableSource;
  request: LibMpvSourceRequest;
};

type LibMpvElectronApi = {
  createLibMpvPlayer?: (bounds: LibMpvBounds) => Promise<string | null>;
  resizeLibMpvPlayer?: (
    playerId: string,
    bounds: LibMpvBounds,
  ) => Promise<boolean>;
  loadLibMpvSource?: (
    playerId: string,
    request: LibMpvSourceRequest,
  ) => Promise<boolean>;
  sendLibMpvCommand?: (
    playerId: string,
    command: LibMpvCommand,
  ) => Promise<boolean>;
  reparentLibMpvPlayer?: (
    playerId: string,
    target: "main" | "pip",
  ) => Promise<boolean>;
  destroyLibMpvPlayer?: (playerId: string) => Promise<boolean>;
  onLibMpvEvent?: (listener: (event: LibMpvPlayerEvent) => void) => () => void;
  onLibMpvLog?: (listener: (log: LibMpvLogEvent) => void) => () => void;
};

function getElectronApi(): LibMpvElectronApi | null {
  return ((window as any).electronAPI as LibMpvElectronApi | undefined) ?? null;
}

function normalizeVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 1;
  return Math.max(0, Math.min(1, volume));
}

function sourceType(source: LoadableSource): LibMpvSourceRequest["type"] {
  if (source.type === "mp4") return source.isTorrent ? "file" : "mp4";
  return source.type;
}

function sourceHeaders(
  source: LoadableSource,
): Record<string, string> | undefined {
  const headers = source.headers ?? source.preferredHeaders;
  if (!headers || typeof headers !== "object") return undefined;
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([, value]) => typeof value === "string" && value.length > 0,
    ),
  );
}

function toAudioTrack(track: MpvTrack) {
  return {
    id: track.id,
    label: track.label || track.language || track.id,
    language: track.language || "unknown",
  };
}

function toDisplayError(event: LibMpvPlayerEvent): DisplayError {
  return {
    type: "mpv",
    errorName: event.name ?? "libmpv_error",
    message: event.message ?? "libmpv playback error",
  };
}

export function makeLibMpvDisplayInterface(): DisplayInterface {
  const { emit, on, off } = makeEmitter<DisplayInterfaceEvents>();
  const electronApi = getElectronApi();
  let containerElement: HTMLElement | null = null;
  let surfaceElement: HTMLElement | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let playerId: string | null = null;
  let source: LoadableSource | null = null;
  let generation = 0;
  let duration = 0;
  let time = 0;
  let volume = 1;
  let playbackRate = 1;
  let paused = true;
  let isSeeking = false;
  let isFullscreen = false;
  let pictureInPictureMode: PictureInPictureMode = null;
  let caption: DisplayCaption | null = null;
  let tracks: MpvTrack[] = [];
  let destroyed = false;
  let desiredPaused = true;
  let unbindEvents: (() => void) | null = null;
  let unbindLogs: (() => void) | null = null;
  let playerCreatePromise: Promise<string | null> | null = null;
  let nativeOperationQueue = Promise.resolve();
  let pendingLoad: PendingLoad | null = null;
  let lastBoundsKey: string | null = null;
  let desktopPipClosedUnsubscribe: (() => void) | null = null;
  let desktopPipActionUnsubscribe: (() => void) | null = null;

  function enqueueNativeOperation<T>(
    operation: () => Promise<T> | T,
  ): Promise<T> {
    const next = nativeOperationQueue.then(operation, operation);
    nativeOperationQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  function getBounds(): LibMpvBounds | null {
    const element = surfaceElement ?? containerElement;
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const bounds = {
      x: rect.left,
      y: rect.top,
      width: rect.width || window.innerWidth,
      height: rect.height || window.innerHeight,
    };
    const boundsKey = Object.values(bounds).join(":");
    if (boundsKey !== lastBoundsKey) {
      lastBoundsKey = boundsKey;
      console.debug("[libmpv] surface_bounds", bounds);
    }
    return bounds;
  }

  function bindDesktopPipActions() {
    if (desktopPipActionUnsubscribe) return;
    const api = getElectronApi();
    if (!api) return;

    const pipApi = api as typeof api & {
      onDesktopPipAction?: (
        listener: (action: DesktopPipAction) => void,
      ) => () => void;
      onDesktopPipClosed?: (listener: () => void) => () => void;
    };

    desktopPipActionUnsubscribe =
      pipApi.onDesktopPipAction?.((action) => {
        if (action.type === "togglePlayback") {
          if (paused) thisDisplay.play();
          else thisDisplay.pause();
        } else if (action.type === "seekBy") {
          thisDisplay.setTime(time + action.delta);
        } else if (action.type === "seekTo") {
          thisDisplay.setTime(action.time);
        }
      }) ?? null;

    desktopPipClosedUnsubscribe =
      pipApi.onDesktopPipClosed?.(() => {
        if (pictureInPictureMode !== "desktop") return;
        if (playerId) {
          void enqueueNativeOperation(() =>
            api.reparentLibMpvPlayer?.(playerId!, "main"),
          );
        }
        pictureInPictureMode = null;
        emitPictureInPictureState(null);
      }) ?? null;
  }

  function emitPictureInPictureState(
    mode: PictureInPictureMode,
    documentWindow: Window | null = null,
  ) {
    pictureInPictureMode = mode;
    emit("pictureinpicture", {
      active: mode !== null,
      mode,
      documentWindow,
    });
  }

  async function ensurePlayer(): Promise<string | null> {
    if (destroyed || playerId || !electronApi?.createLibMpvPlayer) {
      return playerId;
    }

    if (playerCreatePromise) return playerCreatePromise;

    const bounds = getBounds();
    if (!bounds) return null;

    playerCreatePromise = enqueueNativeOperation(async () => {
      const createdPlayerId = await electronApi.createLibMpvPlayer!(bounds);
      if (!createdPlayerId || destroyed || !source) {
        if (createdPlayerId && (destroyed || !source)) {
          await electronApi.destroyLibMpvPlayer?.(createdPlayerId);
        }
        if (!createdPlayerId) {
          emit("error", {
            type: "mpv",
            errorName: "libmpv_native_unavailable",
            message: "Native libmpv addon is unavailable",
          });
        }
        return null;
      }

      playerId = createdPlayerId;
      unbindEvents = electronApi.onLibMpvEvent?.(handleEvent) ?? null;
      unbindLogs =
        electronApi.onLibMpvLog?.((log) => {
          console.debug("[libmpv]", log);
        }) ?? null;
      bindDesktopPipActions();
      updateBounds();
      flushPendingLoad(createdPlayerId);
      return createdPlayerId;
    });

    playerCreatePromise.then(
      () => {
        playerCreatePromise = null;
      },
      () => {
        playerCreatePromise = null;
      },
    );
    return playerCreatePromise;
  }

  function flushPendingLoad(id: string) {
    const pending = pendingLoad;
    if (!pending) return;
    pendingLoad = null;

    void enqueueNativeOperation(async () => {
      if (
        destroyed ||
        pending.generation !== generation ||
        source !== pending.source ||
        playerId !== id
      ) {
        return;
      }
      await electronApi?.loadLibMpvSource?.(id, pending.request);
      await electronApi?.sendLibMpvCommand?.(id, {
        type: "set-volume",
        volume,
      });
      await electronApi?.sendLibMpvCommand?.(id, {
        type: "set-playback-rate",
        rate: playbackRate,
      });
      await electronApi?.sendLibMpvCommand?.(id, {
        type: desiredPaused ? "pause" : "play",
      });
    });
  }

  function sendNativeCommand(id: string, command: LibMpvCommand) {
    return enqueueNativeOperation(() =>
      electronApi?.sendLibMpvCommand?.(id, command),
    );
  }

  function updateBounds() {
    if (!playerId || !electronApi?.resizeLibMpvPlayer) return;
    const bounds = getBounds();
    if (bounds) void electronApi.resizeLibMpvPlayer(playerId, bounds);
  }

  function handleTrackList(data: unknown) {
    if (typeof data === "string") {
      try {
        data = JSON.parse(data) as unknown;
      } catch {
        return;
      }
    }
    if (!Array.isArray(data)) return;
    tracks = data
      .filter(
        (track): track is Record<string, unknown> =>
          !!track && typeof track === "object",
      )
      .map((track): MpvTrack | null => {
        if (track.type !== "audio" && track.type !== "sub") return null;
        return {
          id: String(track.id ?? ""),
          kind: track.type,
          label: String(track.title ?? track.lang ?? track.id ?? ""),
          language: String(track.lang ?? "unknown"),
          selected: track.selected === true,
        };
      })
      .filter((track): track is MpvTrack => Boolean(track?.id));

    const audioTracks = tracks
      .filter((track) => track.kind === "audio")
      .map(toAudioTrack);
    emit("audiotracks", audioTracks);
    emit(
      "changedaudiotrack",
      audioTracks.find((track) =>
        tracks.some(
          (nativeTrack) =>
            nativeTrack.kind === "audio" &&
            nativeTrack.id === track.id &&
            nativeTrack.selected,
        ),
      ) ?? null,
    );
  }

  function handleEvent(event: LibMpvPlayerEvent) {
    if (!playerId || event.playerId !== playerId) {
      console.warn("[libmpv] dropped event: player mismatch", {
        expected: playerId,
        received: event.playerId,
        type: event.type,
      });
      return;
    }
    if (event.generation !== generation) {
      console.warn("[libmpv] dropped event: generation mismatch", {
        expected: generation,
        received: event.generation,
        type: event.type,
        name: event.name,
      });
      return;
    }

    if (
      event.type === "file-loaded" ||
      event.type === "video-reconfig" ||
      (event.type === "property" &&
        (event.name === "duration" ||
          event.name === "pause" ||
          event.name === "video-params" ||
          event.name === "video-out-params"))
    ) {
      console.info("[libmpv] renderer event", {
        type: event.type,
        name: event.name,
        data:
          event.name === "video-params" || event.name === "video-out-params"
            ? "[video-params]"
            : event.data,
        generation: event.generation,
      });
    }

    if (
      event.type === "property" &&
      event.name !== "time-pos" &&
      event.name !== "demuxer-cache-duration"
    ) {
      console.debug("[libmpv] property", {
        generation: event.generation,
        name: event.name,
        data: event.data,
      });
    }

    if (event.type === "error") {
      emit("error", toDisplayError(event));
      emit("loading", false);
      return;
    }

    if (event.type === "file-loaded") {
      return;
    }

    if (event.type === "video-reconfig") {
      return;
    }

    if (event.type === "video-frame") {
      emit("loading", false);
      return;
    }

    if (event.type === "end-file") {
      paused = true;
      emit("pause", undefined);
      emit("loading", false);
      return;
    }

    if (event.type !== "property") return;

    switch (event.name) {
      case "time-pos":
        if (typeof event.data === "number" && Number.isFinite(event.data)) {
          time = Math.max(0, event.data);
          emit("time", time);
        }
        break;
      case "duration":
        if (typeof event.data === "number" && Number.isFinite(event.data)) {
          duration = Math.max(0, event.data);
          emit("duration", duration);
        }
        break;
      case "pause":
        if (typeof event.data === "boolean") {
          paused = event.data;
          emit(paused ? "pause" : "play", undefined);
        }
        break;
      case "volume":
        if (typeof event.data === "number") {
          volume = normalizeVolume(event.data / 100);
          emit("volumechange", volume);
        }
        break;
      case "speed":
        if (typeof event.data === "number" && event.data > 0) {
          playbackRate = event.data;
          emit("playbackrate", playbackRate);
        }
        break;
      case "seeking":
        isSeeking = event.data === true;
        emit("loading", isSeeking);
        break;
      case "paused-for-cache":
        emit("loading", event.data === true);
        break;
      case "demuxer-cache-duration":
        if (
          typeof event.data === "number" &&
          Number.isFinite(event.data) &&
          Number.isFinite(time)
        ) {
          emit("buffered", time + Math.max(0, event.data));
        }
        break;
      case "track-list":
        handleTrackList(event.data);
        break;
      default:
        break;
    }
  }

  function cleanupPipSubscriptions() {
    desktopPipActionUnsubscribe?.();
    desktopPipClosedUnsubscribe?.();
    desktopPipActionUnsubscribe = null;
    desktopPipClosedUnsubscribe = null;
  }

  function buildPipState(): DesktopPipState | null {
    const playerState = usePlayerStore.getState();
    if (!source) return null;
    return {
      ...getDesktopPipStateFromPlayerState(
        playerState,
        useSubtitleStore.getState().delay,
      ),
      source,
      time,
      duration,
      paused,
      playbackRate,
      title: playerState.meta?.title ?? "",
      delay: useSubtitleStore.getState().delay,
      caption: caption
        ? { vttData: caption.vttData, language: caption.language }
        : null,
      secondaryCaption: playerState.caption.secondary
        ? {
            vttData: playerState.caption.secondary.vttData,
            language: playerState.caption.secondary.language,
          }
        : null,
      dualSubEnabled: playerState.caption.dualSubEnabled,
    };
  }

  async function toggleDesktopPip() {
    const api = getElectronApi() as
      | (LibMpvElectronApi & {
          openDesktopPipWindow?: (
            state: DesktopPipState,
            windowSize?: unknown,
          ) => Promise<boolean>;
          closeDesktopPipWindow?: () => Promise<boolean>;
        })
      | null;
    if (!api || !playerId) return;

    if (pictureInPictureMode === "desktop") {
      await api.closeDesktopPipWindow?.();
      return;
    }

    const state = buildPipState();
    if (!state || !api.openDesktopPipWindow) return;
    const opened = await api.openDesktopPipWindow(
      state,
      getPersistedDesktopPipWindowSize(),
    );
    if (!opened) return;
    const reparented = await enqueueNativeOperation(() =>
      api.reparentLibMpvPlayer?.(playerId!, "pip"),
    );
    if (reparented) {
      emitPictureInPictureState("desktop");
      bindDesktopPipActions();
    }
  }

  const thisDisplay: DisplayInterface = {
    on,
    off,
    getType() {
      return "web";
    },
    destroy() {
      destroyed = true;
      pendingLoad = null;
      resizeObserver?.disconnect();
      resizeObserver = null;
      unbindEvents?.();
      unbindEvents = null;
      unbindLogs?.();
      unbindLogs = null;
      cleanupPipSubscriptions();
      const playerToDestroy = playerId;
      playerId = null;
      if (playerToDestroy) {
        void enqueueNativeOperation(() =>
          electronApi?.destroyLibMpvPlayer?.(playerToDestroy),
        );
      }
      if (pictureInPictureMode === "desktop") {
        pictureInPictureMode = null;
        emitPictureInPictureState(null);
      }
      fscreen.removeEventListener("fullscreenchange", fullscreenChanged);
    },
    load(ops) {
      source = ops.source;
      tracks = [];
      emit("audiotracks", []);
      emit("changedaudiotrack", null);
      time = Math.max(0, ops.startAt);
      duration = ops.source?.duration ?? 0;
      desiredPaused = !(ops.autoplay ?? true);
      emit("loading", Boolean(ops.source));
      if (duration > 0) emit("duration", duration);

      if (!ops.source) {
        // Native player generations restart at zero after destroy. Do not
        // consume a generation for the clear/reset lifecycle.
        generation = 0;
        desiredPaused = true;
        pendingLoad = null;
        const playerToDestroy = playerId;
        playerId = null;
        tracks = [];
        unbindEvents?.();
        unbindEvents = null;
        unbindLogs?.();
        unbindLogs = null;
        if (playerToDestroy) {
          void enqueueNativeOperation(() =>
            electronApi?.destroyLibMpvPlayer?.(playerToDestroy),
          );
        }
        return;
      }

      const requestGeneration = generation + 1;
      generation = requestGeneration;
      const requestedSource = ops.source;
      const headers = sourceHeaders(requestedSource);
      const loadRequest: LibMpvSourceRequest = {
        url: requestedSource.url,
        type: sourceType(requestedSource),
        startAt: time,
        autoplay: ops.autoplay ?? true,
        ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
      };
      pendingLoad = {
        generation: requestGeneration,
        source: requestedSource,
        request: loadRequest,
      };
      void ensurePlayer().then((id) => {
        if (
          !id ||
          destroyed ||
          requestGeneration !== generation ||
          source !== requestedSource
        ) {
          return;
        }
        flushPendingLoad(id);
      });
    },
    changeQuality() {
      // Adaptive HLS/DASH quality is delegated to libmpv. File qualities
      // continue to reload through the player store.
    },
    changeAudioTrack(track) {
      if (!playerId) return;
      void sendNativeCommand(playerId, {
        type: "set-audio-track",
        trackId: track.id,
      });
    },
    processContainerElement(container) {
      containerElement = container;
      bindDesktopPipActions();
    },
    processSurfaceElement(surface) {
      surfaceElement = surface;
      resizeObserver?.disconnect();
      resizeObserver = null;
      if (!surface) return;
      resizeObserver = new ResizeObserver(updateBounds);
      resizeObserver.observe(surface);
      if (source) void ensurePlayer();
      updateBounds();
    },
    toggleFullscreen() {
      if (fscreen.fullscreenElement) {
        void fscreen.exitFullscreen();
        return;
      }
      if (!containerElement) return;
      void fscreen.requestFullscreen(containerElement);
    },
    togglePictureInPicture() {
      void toggleDesktopPip();
    },
    setSeeking(active) {
      isSeeking = active;
      emit("loading", active);
    },
    play() {
      desiredPaused = false;
      if (!playerId) {
        void ensurePlayer();
        return;
      }
      void sendNativeCommand(playerId, { type: "play" });
    },
    pause() {
      desiredPaused = true;
      if (!playerId) return;
      void sendNativeCommand(playerId, { type: "pause" });
    },
    setTime(nextTime) {
      if (!playerId) return;
      const clamped = Math.max(
        0,
        Math.min(nextTime, duration > 0 ? duration : Number.POSITIVE_INFINITY),
      );
      time = clamped;
      emit("time", clamped);
      void sendNativeCommand(playerId, {
        type: "seek",
        time: clamped,
      });
    },
    setVolume(nextVolume) {
      volume = normalizeVolume(nextVolume);
      if (!playerId) {
        emit("volumechange", volume);
        return;
      }
      void sendNativeCommand(playerId, {
        type: "set-volume",
        volume,
      });
    },
    setPlaybackRate(rate) {
      if (!Number.isFinite(rate) || rate <= 0 || !playerId) return;
      playbackRate = rate;
      void sendNativeCommand(playerId, {
        type: "set-playback-rate",
        rate,
      });
    },
    setMeta(_meta: DisplayMeta) {},
    setCaption(nextCaption) {
      caption = nextCaption;
    },
    getCaptionList() {
      return [];
    },
    getSubtitleTracks() {
      return tracks.filter((track) => track.kind === "sub");
    },
    async setSubtitlePreference(language) {
      const track = tracks.find(
        (item) => item.kind === "sub" && item.language === language,
      );
      if (!track || !playerId) return;
      await sendNativeCommand(playerId, {
        type: "set-subtitle-track",
        trackId: track.id,
      });
    },
    startAirplay() {},
  };

  function fullscreenChanged() {
    isFullscreen = Boolean(fscreen.fullscreenElement);
    emit("fullscreen", isFullscreen);
  }

  fscreen.addEventListener("fullscreenchange", fullscreenChanged);

  return thisDisplay;
}
