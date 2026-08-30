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
import {
  getActiveTorrentStatus,
  subscribeActiveTorrentStatus,
} from "@/desktop/torrentPlaybackStore";
import { usePlayerStore } from "@/stores/player/store";
import { LoadableSource } from "@/stores/player/utils/qualities";
import { useSubtitleStore } from "@/stores/subtitles";
import { useWatchPartyStore } from "@/stores/watchParty";
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
  generation?: number;
};

type LibMpvCommand =
  | { type: "play" }
  | { type: "pause" }
  | { type: "seek"; time: number }
  | { type: "set-volume"; volume: number }
  | { type: "set-mute"; muted: boolean }
  | { type: "set-playback-rate"; rate: number }
  | { type: "set-audio-track"; trackId: string }
  | { type: "set-subtitle-track"; trackId: string }
  | { type: "set-secondary-subtitle-track"; trackId: string };

type PendingLoad = {
  generation: number;
  source: LoadableSource;
  request: LibMpvSourceRequest;
  desktopPipHandoff?: Promise<boolean>;
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
  destroyLibMpvPlayer?: (playerId: string, reason?: string) => Promise<boolean>;
  onLibMpvEvent?: (listener: (event: LibMpvPlayerEvent) => void) => () => void;
  onLibMpvLog?: (listener: (log: LibMpvLogEvent) => void) => () => void;
  toggleFullscreen?: () => Promise<void>;
  exitPlayerFullscreen?: () => Promise<void>;
  setFullscreen?: (fullscreen: boolean) => Promise<void>;
  exitFullscreen?: () => Promise<void>;
  closeDesktopPipWindow?: () => Promise<boolean>;
  focusMainWindow?: () => Promise<boolean>;
  getFullscreenState?: () => Promise<boolean>;
  minimizeWindow?: () => Promise<void>;
  maximizeWindow?: () => Promise<void>;
  closeWindow?: () => Promise<void>;
  isMaximized?: () => Promise<boolean>;
  onMaximizeState?: (listener: (isMaximized: boolean) => void) => () => void;
  isWindows?: boolean;
  platform?: string;
  onFullscreenState?: (listener: (isFullscreen: boolean) => void) => () => void;
  getStartupNativeWarmupState?: () => Promise<{
    status?: string;
    libmpv?: { status?: string; message?: string };
    torrent?: { status?: string; message?: string };
  }>;
  waitForStartupNativeWarmup?: () => Promise<{
    status?: string;
    libmpv?: { status?: string; message?: string };
    torrent?: { status?: string; message?: string };
  }>;
  getLibMpvDiagnostics?: () => Promise<{
    diagnostics: string;
    lastError: string | null;
    lastCreateError: string | null;
  } | null>;
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
  let bufferedTime = 0;
  let volume = 1;
  let playbackRate = 1;
  let paused = true;
  let isSeeking = false;
  // Set while a seek command is in flight. mpv reports stale time-pos while
  // seeking, so time updates are held back until the position matches the
  // seek target. This keeps the subtitle overlay from flashing cues for a
  // position the video has not reached yet.
  let pendingSeekTarget: number | null = null;
  let pendingSeekSetAt = 0;
  let heldSeekPosition: number | null = null;
  const PENDING_SEEK_TIMEOUT_MS = 8000;
  const TIME_BACKTRACK_TOLERANCE_SECONDS = 0.5;
  const AUDIO_PTS_TAKEOVER_MS = 400;
  let lastTimePosAt = 0;
  let lastAudioPts = -1;
  let isFullscreen = false;
  let pictureInPictureMode: PictureInPictureMode = null;
  let caption: DisplayCaption | null = null;
  let secondaryCaption: DisplayCaption | null = null;
  let tracks: MpvTrack[] = [];
  let destroyed = false;
  let desiredPaused = true;
  let unbindEvents: (() => void) | null = null;
  let unbindLogs: (() => void) | null = null;
  let playerCreatePromise: Promise<string | null> | null = null;
  let nativeOperationQueue = Promise.resolve();
  let pendingLoad: PendingLoad | null = null;
  let lastBoundsKey: string | null = null;
  let loadStartedAt = 0;
  let firstFrameLoggedGeneration = -1;
  let desktopPipClosedUnsubscribe: (() => void) | null = null;
  let desktopPipActionUnsubscribe: (() => void) | null = null;
  let desktopPipTogglePromise: Promise<void> | null = null;
  let desktopPipShouldResume = false;
  let desktopPipTarget: "main" | "pip" = "main";
  let desktopPipWindowOpen = false;
  let desktopPipTransitioning = false;
  let desktopPipHandoffPromise: Promise<boolean> | null = null;
  let unbindDesktopPipStore: (() => void) | null = null;
  let unbindDesktopPipTorrent: (() => void) | null = null;
  let unbindDesktopPipWatchParty: (() => void) | null = null;
  let unbindFullscreen: (() => void) | null = null;
  // Tracks whether the current generation's file has fully loaded.
  // Used to drop stale `pause: true` events emitted during old-file teardown.
  let fileLoaded = false;
  // True while mpv is paused solely because its input buffer underran
  // (torrent download slow). Such a pause is not a user pause and must not
  // flip the UI to the paused state.
  let cachePaused = false;
  // Keep resume UI state stable until the first decoded frame is visible.
  // time-pos can advance while libmpv is still resolving the initial seek.
  let pendingInitialResumeTime: number | null = null;

  function logPlaybackMilestone(
    timingPhase: "libmpv_file_loaded" | "libmpv_video_frame",
    eventType: "file-loaded" | "video-frame",
  ) {
    console.info("[libmpv] playback milestone", {
      timingPhase,
      event: eventType,
      playerId,
      generation,
      elapsedMs:
        loadStartedAt > 0
          ? Math.max(0, Math.round(performance.now() - loadStartedAt))
          : undefined,
      sourceType: source?.type,
      isTorrent: source?.isTorrent === true,
    });
  }

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

  function handoffDesktopPipToMain(): Promise<boolean> {
    if (desktopPipHandoffPromise) return desktopPipHandoffPromise;
    if (desktopPipTarget !== "pip") return Promise.resolve(true);

    const api = getElectronApi();
    const currentPlayerId = playerId;
    if (!api?.reparentLibMpvPlayer || !currentPlayerId) {
      return Promise.resolve(false);
    }

    desktopPipTransitioning = true;
    const transition = (async () => {
      const didReparent =
        (await enqueueNativeOperation(() =>
          api.reparentLibMpvPlayer?.(currentPlayerId, "main"),
        )) ?? false;
      if (!didReparent) return false;

      desktopPipTarget = "main";
      desktopPipShouldResume = false;
      emit("loading", false);
      emitPictureInPictureState(null);
      syncPipState(true);
      updateBounds();

      const didClose = api.closeDesktopPipWindow
        ? await api.closeDesktopPipWindow()
        : true;
      if (!didClose && desktopPipWindowOpen) {
        return false;
      }
      await api.focusMainWindow?.();
      return true;
    })();

    const trackedTransition = transition.finally(() => {
      desktopPipHandoffPromise = null;
      desktopPipTransitioning = false;
    });
    desktopPipHandoffPromise = trackedTransition;
    return trackedTransition;
  }

  function dispatchDesktopPipAction(action: DesktopPipAction) {
    window.dispatchEvent(
      new CustomEvent("framezoo:desktop-pip-action", {
        detail: action,
      }),
    );
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
      pipApi.onDesktopPipAction?.(async (action) => {
        if (destroyed || desktopPipTransitioning) {
          return;
        }
        if (action.type === "close") {
          await handoffDesktopPipToMain();
          return;
        }
        if (action.type === "nextEpisode") {
          const didHandoff = await handoffDesktopPipToMain();
          if (!didHandoff) return;
          dispatchDesktopPipAction(action);
          return;
        }
        if (desktopPipTarget !== "pip") return;

        if (action.type === "skipSegment") {
          thisDisplay.setTime(action.time);
        } else if (action.type === "togglePlayback") {
          if (paused) {
            thisDisplay.play();
            desktopPipShouldResume = true;
          } else {
            thisDisplay.pause();
            desktopPipShouldResume = false;
          }
        } else if (action.type === "seekBy") {
          thisDisplay.setTime(time + action.delta);
        } else if (action.type === "seekTo") {
          thisDisplay.setTime(action.time);
        }
      }) ?? null;

    desktopPipClosedUnsubscribe =
      pipApi.onDesktopPipClosed?.(() => {
        desktopPipWindowOpen = false;
        const wasDesktopPip =
          pictureInPictureMode === "desktop" || desktopPipTarget === "pip";
        if (!wasDesktopPip) {
          syncPipState(true);
          return;
        }

        const shouldResume = desktopPipShouldResume;
        desktopPipShouldResume = false;
        desktopPipTransitioning = true;

        const finishClose = async () => {
          let reparented = true;
          const currentPlayerId = playerId;
          if (currentPlayerId) {
            reparented =
              (await enqueueNativeOperation(async () => {
                const didReparent =
                  (await api.reparentLibMpvPlayer?.(currentPlayerId, "main")) ??
                  false;
                if (didReparent && shouldResume && !destroyed) {
                  // Do not enqueue another operation from inside the current
                  // operation. That would wait on itself forever.
                  await api.sendLibMpvCommand?.(currentPlayerId, {
                    type: "play",
                  });
                }
                return didReparent;
              })) ?? false;
          }

          if (!destroyed) {
            desktopPipTarget = "main";
            emit("loading", false);
            emitPictureInPictureState(null);
            if (!reparented) {
              console.warn(
                "[libmpv] desktop PiP player reparent did not confirm",
              );
            }
            updateBounds();
          }
          desktopPipTransitioning = false;
        };

        void finishClose().catch((error) => {
          desktopPipTransitioning = false;
          console.warn("[libmpv] desktop PiP close transition failed", error);
        });
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
      let createdPlayerId: string | null = null;
      let invokeError: string | null = null;
      try {
        createdPlayerId =
          (await electronApi.createLibMpvPlayer!(bounds)) ?? null;
      } catch (error) {
        // An IPC rejection carries the native throw directly (e.g. a JS
        // exception raised before the controller's own try/catch).
        invokeError = error instanceof Error ? error.message : String(error);
      }
      if (!createdPlayerId || destroyed || !source) {
        if (createdPlayerId && (destroyed || !source)) {
          await electronApi.destroyLibMpvPlayer?.(
            createdPlayerId,
            destroyed
              ? "display:ensure-player-aborted-destroyed"
              : "display:ensure-player-aborted-no-source",
          );
        }
        if (!createdPlayerId) {
          // Wait for the startup warmup to settle (it also retries loading the
          // native addon) so the reported failure is the real cause instead of
          // a generic message. This is essential for diagnosing Windows
          // releases where the addon binary or its runtime is missing/broken.
          const warmup = await electronApi
            ?.waitForStartupNativeWarmup?.()
            .catch(() => null);
          const settleState = (warmup ??
            (await electronApi
              ?.getStartupNativeWarmupState?.()
              .catch(() => null))) as
            | { libmpv?: { status?: string; message?: string } }
            | null
            | undefined;
          const libmpvMsg =
            settleState?.libmpv?.status === "error"
              ? settleState.libmpv.message
              : undefined;
          // Always pull the main-process addon diagnostics so the error report
          // carries the real root cause (candidates, load error, runtime path)
          // even when the startup warmup settled without an error message.
          const addonDiagnostics = await electronApi
            ?.getLibMpvDiagnostics?.()
            .catch(() => null);
          const createErrorText =
            addonDiagnostics?.lastCreateError ?? invokeError;
          const diagnosticsText = addonDiagnostics?.diagnostics
            ? `(${addonDiagnostics.diagnostics})`
            : "";
          // Prefer the real create failure (e.g. "native surface creation
          // failed") over the generic diagnostics; both are surfaced so the
          // report pinpoints the exact native throw.
          const createMessage = createErrorText
            ? `Native libmpv player creation failed: ${createErrorText} ${
                diagnosticsText || ""
              }`.trim()
            : null;
          emit("error", {
            type: "mpv",
            errorName:
              createErrorText || libmpvMsg
                ? "libmpv_create_failed"
                : "libmpv_native_unavailable",
            message:
              libmpvMsg && !createErrorText
                ? `Native libmpv addon is unavailable: ${libmpvMsg} ${diagnosticsText}`.trim()
                : (createMessage ??
                  (diagnosticsText
                    ? `Native libmpv addon is unavailable ${diagnosticsText}`
                    : "Native libmpv addon is unavailable")),
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

    void (async () => {
      if (pending.desktopPipHandoff) {
        const didHandoff = await pending.desktopPipHandoff;
        if (!didHandoff || desktopPipTarget !== "main") {
          return;
        }
      }

      await enqueueNativeOperation(async () => {
        if (
          destroyed ||
          pending.generation !== generation ||
          source !== pending.source ||
          playerId !== id
        ) {
          return;
        }
        const loaded = await electronApi?.loadLibMpvSource?.(
          id,
          pending.request,
        );
        if (loaded === false) {
          emit("loading", false);
          emit("error", {
            type: "mpv",
            errorName: "libmpv_load_failed",
            message: "Native libmpv could not load the selected source",
          });
          return;
        }
        await electronApi?.sendLibMpvCommand?.(id, {
          type: "set-subtitle-track",
          trackId: caption?.trackId ?? "no",
        });
        await electronApi?.sendLibMpvCommand?.(id, {
          type: "set-secondary-subtitle-track",
          trackId: secondaryCaption?.trackId ?? "no",
        });
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
    })().catch((error) => {
      emit("loading", false);
      emit("error", {
        type: "mpv",
        errorName: "libmpv_load_failed",
        message: error instanceof Error ? error.message : String(error),
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

  function destroyNativePlayer(id: string, reason: string) {
    console.info("[libmpv] destroy_requested", {
      playerId: id,
      reason,
    });
    void enqueueNativeOperation(() =>
      electronApi?.destroyLibMpvPlayer?.(id, reason),
    );
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
    const subtitleTracks = tracks.filter((track) => track.kind === "sub");
    emit("audiotracks", audioTracks);
    emit("subtitletracks", subtitleTracks);
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

  function publishTimePosition(position: number) {
    time = position;
    emit("time", time);
    if (time > bufferedTime) {
      bufferedTime = time;
      emit("buffered", bufferedTime);
    }
    syncPipState();
  }

  function applyTimePosition(position: number, isSeekSettled = false) {
    if (pendingInitialResumeTime !== null) return;
    if (!isSeekSettled && position < time) {
      // Small decoder/audio clock jitter during continuous playback without seek:
      // do not backtrack the player's published position.
      return;
    }
    publishTimePosition(position);
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
      event.name !== "audio-pts" &&
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
      logPlaybackMilestone("libmpv_file_loaded", "file-loaded");
      fileLoaded = true;
      if (!desiredPaused) {
        if (paused) {
          thisDisplay.play();
        } else {
          emit("play", undefined);
        }
      }
      return;
    }

    if (event.type === "video-reconfig") {
      return;
    }

    if (event.type === "video-frame") {
      if (firstFrameLoggedGeneration !== generation) {
        firstFrameLoggedGeneration = generation;
        logPlaybackMilestone("libmpv_video_frame", "video-frame");
      }
      const initialResumeTime = pendingInitialResumeTime;
      pendingInitialResumeTime = null;
      emit("rendered", undefined);
      if (initialResumeTime !== null) {
        publishTimePosition(initialResumeTime);
      }
      emit("loading", false);
      if (!paused) {
        emit("play", undefined);
      }
      return;
    }

    if (event.type === "end-file") {
      paused = true;
      fileLoaded = false;
      lastTimePosAt = 0;
      lastAudioPts = -1;
      emit("loading", false);
      return;
    }

    if (event.type !== "property") return;

    switch (event.name) {
      case "time-pos":
        if (typeof event.data === "number" && Number.isFinite(event.data)) {
          lastTimePosAt = performance.now();
          const rawPosition = Math.max(0, event.data);
          if (pendingSeekTarget !== null) {
            const isNearTarget =
              Math.abs(rawPosition - pendingSeekTarget) <= 3.5;
            if (
              !isNearTarget &&
              performance.now() - pendingSeekSetAt <= PENDING_SEEK_TIMEOUT_MS
            ) {
              // Stale pre-seek time-pos from before seek command was processed: drop it
              break;
            }
            if (isSeeking && isNearTarget) {
              heldSeekPosition = rawPosition;
              break;
            }
            pendingSeekTarget = null;
            heldSeekPosition = null;
            applyTimePosition(rawPosition, true);
            break;
          }
          if (rawPosition < time - TIME_BACKTRACK_TOLERANCE_SECONDS) {
            // A backward jump without a pending seek is stale decoder state,
            // not user navigation.
            break;
          }
          applyTimePosition(rawPosition);
        }
        break;
      case "audio-pts":
        if (typeof event.data === "number" && Number.isFinite(event.data)) {
          lastAudioPts = Math.max(0, event.data);
          if (
            pendingSeekTarget === null &&
            !paused &&
            !cachePaused &&
            !isSeeking &&
            (lastTimePosAt === 0 ||
              performance.now() - lastTimePosAt > AUDIO_PTS_TAKEOVER_MS)
          ) {
            if (lastAudioPts >= time - TIME_BACKTRACK_TOLERANCE_SECONDS) {
              applyTimePosition(lastAudioPts);
            }
          }
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
          if (event.data && !desiredPaused && !fileLoaded && !cachePaused) {
            return;
          }
          const wasPaused = paused;
          paused = event.data;
          if (!paused) {
            syncPipState(true);
            if (cachePaused || !wasPaused) {
              emit("loading", false);
            }
            emit("play", undefined);
          } else if (!cachePaused) {
            // A pause that is not caused by input starvation is a real
            // (user or EOF) pause.
            emit("loading", false);
            emit("pause", undefined);
            syncPipState(true);

            // If mpv reports pause=true but we want to play:
            // - If file hasn't loaded yet for this generation, the pause event
            //   is a leftover from old-file teardown — ignore it (don't force
            //   play because playerId may not be ready yet).
            // - If file is already loaded, force play immediately.
            if (!desiredPaused && fileLoaded) {
              thisDisplay.play();
            }
          } else {
            // Buffering stall: keep the UI in its current play state and
            // surface the wait through the loading indicator instead.
            syncPipState(true);
            emit("loading", true);
          }
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
        if (event.data === true) {
          isSeeking = true;
          emit("loading", true);
          break;
        }
        isSeeking = false;
        emit("loading", false);
        if (pendingSeekTarget !== null) {
          const settled =
            heldSeekPosition !== null ? heldSeekPosition : pendingSeekTarget;
          pendingSeekTarget = null;
          heldSeekPosition = null;
          applyTimePosition(settled, true);
        }
        break;
      case "paused-for-cache":
        cachePaused = event.data === true;
        emit("loading", cachePaused);
        break;
      case "demuxer-cache-duration":
        if (
          typeof event.data === "number" &&
          Number.isFinite(event.data) &&
          Number.isFinite(time)
        ) {
          bufferedTime = Math.max(bufferedTime, time + Math.max(0, event.data));
          emit("buffered", bufferedTime);
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

  let lastPipSync = 0;
  function syncPipState(force = false) {
    if (!desktopPipWindowOpen && pictureInPictureMode !== "desktop") return;
    const now = Date.now();
    if (!force && now - lastPipSync < 250) return;
    lastPipSync = now;

    const api = getElectronApi() as any;
    if (!api?.updateDesktopPipWindow) return;
    const state = buildPipState();
    if (state) {
      void api.updateDesktopPipWindow(state);
    }
  }

  function buildPipState(): DesktopPipState | null {
    const playerState = usePlayerStore.getState();
    const subtitleState = useSubtitleStore.getState();
    const pipBaseState = getDesktopPipStateFromPlayerState(
      playerState,
      subtitleState.primaryDelay,
      subtitleState.secondaryDelay,
    );
    if (!pipBaseState) return null;
    const activeTorrentStatus = getActiveTorrentStatus();
    const watchPartyState = useWatchPartyStore.getState();

    return {
      ...pipBaseState,
      canControl: !watchPartyState.enabled || watchPartyState.isHost,
      source,
      time,
      duration,
      paused,
      playbackRate,
      title: playerState.meta?.title ?? "",
      isLoading: playerState.mediaPlaying.isLoading,
      hasRenderedFrame: playerState.mediaPlaying.hasRenderedFrame,
      buffered: playerState.progress.buffered,
      playbackTarget: desktopPipTarget,
      torrent: activeTorrentStatus
        ? {
            state: activeTorrentStatus.state,
            progress: activeTorrentStatus.progress,
            speedBytesPerSecond: activeTorrentStatus.speedBytesPerSecond,
            downloadedBytes: activeTorrentStatus.downloadedBytes,
            totalBytes: activeTorrentStatus.totalBytes,
            streamType: activeTorrentStatus.streamType ?? null,
            streamUrl: activeTorrentStatus.streamUrl,
          }
        : null,
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

  unbindDesktopPipStore = usePlayerStore.subscribe(() => syncPipState());
  unbindDesktopPipTorrent = subscribeActiveTorrentStatus(() => syncPipState());
  unbindDesktopPipWatchParty = useWatchPartyStore.subscribe(() =>
    syncPipState(),
  );

  async function performDesktopPipToggle() {
    const api = getElectronApi() as
      | (LibMpvElectronApi & {
          openDesktopPipWindow?: (
            state: DesktopPipState,
            windowSize?: unknown,
          ) => Promise<boolean>;
          activateDesktopPipWindow?: () => Promise<boolean>;
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
    const initialPipState = {
      ...state,
      playbackTarget: "pip" as const,
    };

    const shouldResume = !desiredPaused;
    desktopPipShouldResume = shouldResume;
    desktopPipTransitioning = true;

    // Stop native playback before the PiP renderer starts its startup/auth
    // gates. This prevents the hidden main window from advancing its clock
    // while the PiP window is still showing its loading screen.
    desiredPaused = true;
    await sendNativeCommand(playerId, { type: "pause" });

    let reparented = false;
    let enteredPip = false;
    try {
      const opened = await api.openDesktopPipWindow(
        initialPipState,
        getPersistedDesktopPipWindowSize(),
      );
      if (!opened) return;
      desktopPipWindowOpen = true;

      reparented =
        (await enqueueNativeOperation(() =>
          api.reparentLibMpvPlayer?.(playerId!, "pip"),
        )) ?? false;
      if (!reparented) return;

      desktopPipTarget = "pip";
      const activated = api.activateDesktopPipWindow
        ? await api.activateDesktopPipWindow()
        : true;
      if (!activated || desktopPipTarget !== "pip") return;

      enteredPip = true;
      desktopPipTransitioning = false;
      emit("loading", false);
      emitPictureInPictureState("desktop");
      bindDesktopPipActions();
      if (shouldResume) {
        thisDisplay.play();
      }
    } finally {
      if (!reparented || !enteredPip) {
        if (reparented) {
          desktopPipTarget = "main";
          await enqueueNativeOperation(() =>
            api.reparentLibMpvPlayer?.(playerId!, "main"),
          );
          updateBounds();
        }
        await api.closeDesktopPipWindow?.();
        desktopPipShouldResume = false;
        desktopPipTransitioning = false;
        if (shouldResume) {
          thisDisplay.play();
        }
      }
    }
  }

  function toggleDesktopPip() {
    if (desktopPipTogglePromise) {
      const api = getElectronApi() as {
        closeDesktopPipWindow?: () => Promise<boolean>;
      } | null;
      void api?.closeDesktopPipWindow?.();
      return;
    }

    desktopPipTogglePromise = performDesktopPipToggle()
      .catch((error) => {
        console.warn("[libmpv] desktop PiP transition failed", error);
      })
      .finally(() => {
        desktopPipTogglePromise = null;
      });
  }

  const thisDisplay: DisplayInterface = {
    on,
    off,
    getType() {
      return "web";
    },
    destroy(reason = "display:destroy") {
      destroyed = true;
      pendingLoad = null;
      lastTimePosAt = 0;
      lastAudioPts = -1;
      const pipApi = getElectronApi() as {
        closeDesktopPipWindow?: () => Promise<boolean>;
      } | null;
      if (
        pictureInPictureMode === "desktop" ||
        desktopPipTarget === "pip" ||
        desktopPipTransitioning
      ) {
        desktopPipShouldResume = false;
        desktopPipTarget = "main";
        void pipApi?.closeDesktopPipWindow?.();
      }
      desktopPipWindowOpen = false;
      resizeObserver?.disconnect();
      resizeObserver = null;
      unbindEvents?.();
      unbindEvents = null;
      unbindLogs?.();
      unbindLogs = null;
      unbindFullscreen?.();
      unbindFullscreen = null;
      cleanupPipSubscriptions();
      const playerToDestroy = playerId;
      playerId = null;
      if (playerToDestroy) {
        destroyNativePlayer(playerToDestroy, reason);
      }
      if (pictureInPictureMode === "desktop") {
        pictureInPictureMode = null;
        emitPictureInPictureState(null);
      }
      desktopPipTransitioning = false;
      if (isFullscreen) {
        isFullscreen = false;
        emit("fullscreen", false);
        const api = getElectronApi();
        if (api?.exitPlayerFullscreen) {
          void api.exitPlayerFullscreen();
        } else if (api?.exitFullscreen) {
          void api.exitFullscreen();
        } else if (api?.setFullscreen) {
          void api.setFullscreen(false);
        } else if (api?.toggleFullscreen) {
          void api.toggleFullscreen();
        } else if (fscreen.fullscreenElement) {
          void fscreen.exitFullscreen();
        }
      }
      fscreen.removeEventListener("fullscreenchange", fullscreenChanged);
      unbindDesktopPipStore?.();
      unbindDesktopPipStore = null;
      unbindDesktopPipTorrent?.();
      unbindDesktopPipTorrent = null;
      unbindDesktopPipWatchParty?.();
      unbindDesktopPipWatchParty = null;
    },
    load(ops) {
      source = ops.source;
      tracks = [];
      emit("audiotracks", []);
      emit("changedaudiotrack", null);
      time = Math.max(0, ops.startAt);
      pendingInitialResumeTime = time > 0.5 ? time : null;
      bufferedTime = time;
      duration = ops.source?.duration ?? 0;
      desiredPaused = !(ops.autoplay ?? true);
      emit("loading", Boolean(ops.source));
      if (duration > 0) emit("duration", duration);
      syncPipState(true);

      if (!ops.source) {
        if (desktopPipTarget === "pip" && !desktopPipTransitioning) {
          void handoffDesktopPipToMain().catch((error) => {
            console.warn("[libmpv] source reset PiP handoff failed", error);
          });
        }

        // Native player generations restart at zero after destroy. Do not
        // consume a generation for the clear/reset lifecycle.
        generation = 0;
        desiredPaused = true;
        pendingLoad = null;
        pendingSeekTarget = null;
        pendingInitialResumeTime = null;
        const playerToDestroy = playerId;
        playerId = null;
        tracks = [];
        unbindEvents?.();
        unbindEvents = null;
        unbindLogs?.();
        unbindLogs = null;
        if (playerToDestroy) {
          destroyNativePlayer(
            playerToDestroy,
            ops.reason ?? "display:load-empty-source",
          );
        }
        return;
      }

      const requestGeneration = generation + 1;
      generation = requestGeneration;
      fileLoaded = false; // reset for new load
      firstFrameLoggedGeneration = -1;
      lastTimePosAt = 0;
      lastAudioPts = -1;
      pendingSeekTarget = time > 0.5 ? time : null;
      pendingSeekSetAt = pendingSeekTarget === null ? 0 : performance.now();
      heldSeekPosition = null;
      loadStartedAt = performance.now();
      const requestedSource = ops.source;
      const headers = sourceHeaders(requestedSource);
      const loadRequest: LibMpvSourceRequest = {
        url: requestedSource.url,
        type: sourceType(requestedSource),
        startAt: time,
        autoplay: ops.autoplay ?? true,
        // Tag the request with our generation so the controller and native
        // addon tag emitted events with the same value. This keeps generation
        // in sync even when an earlier load is coalesced away (only the latest
        // load reaches the native player).
        generation: requestGeneration,
        ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
        ...(requestedSource.isTorrent ? { isTorrent: true } : {}),
      };
      pendingLoad = {
        generation: requestGeneration,
        source: requestedSource,
        request: loadRequest,
        desktopPipHandoff:
          desktopPipTarget === "pip"
            ? handoffDesktopPipToMain()
            : (desktopPipHandoffPromise ?? undefined),
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
      const api = getElectronApi();
      if (api?.toggleFullscreen) {
        void api.toggleFullscreen();
        return;
      }
      if (fscreen.fullscreenElement) {
        void fscreen.exitFullscreen();
        return;
      }
      if (!containerElement) return;
      void fscreen.requestFullscreen(containerElement);
    },
    exitFullscreen() {
      const api = getElectronApi();
      if (api?.exitFullscreen) {
        void api.exitFullscreen();
        return;
      }
      if (api?.setFullscreen) {
        void api.setFullscreen(false);
        return;
      }
      if (api?.exitPlayerFullscreen) {
        void api.exitPlayerFullscreen();
        return;
      }
      if (isFullscreen && api?.toggleFullscreen) {
        void api.toggleFullscreen();
        return;
      }
      if (fscreen.fullscreenElement) {
        void fscreen.exitFullscreen();
      }
    },
    setFullscreen(fullscreen: boolean) {
      const api = getElectronApi();
      if (api?.setFullscreen) {
        void api.setFullscreen(fullscreen);
        return;
      }
      if (fullscreen !== isFullscreen) {
        thisDisplay.toggleFullscreen();
      }
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
      if (pictureInPictureMode === "desktop") {
        desktopPipShouldResume = true;
      }
      if (!playerId) {
        void ensurePlayer();
        return;
      }
      void sendNativeCommand(playerId, { type: "play" });
    },
    pause() {
      desiredPaused = true;
      if (pictureInPictureMode === "desktop") {
        desktopPipShouldResume = false;
      }
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
      if (pendingInitialResumeTime !== null) {
        pendingInitialResumeTime = clamped;
      }
      pendingSeekTarget = clamped;
      pendingSeekSetAt = performance.now();
      heldSeekPosition = null;
      // Deliberately no "time" emit here: the rendered frame has not caught
      // up to the target yet, and forwarding the target optimistically makes
      // subtitles pop in ahead of the video. "time" is emitted from the
      // time-pos handler once the seek settles.
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
      syncPipState(true);
      if (!playerId) return;

      void sendNativeCommand(playerId, {
        type: "set-subtitle-track",
        trackId: nextCaption?.trackId ?? "no",
      });
    },
    setSecondaryCaption(nextCaption) {
      secondaryCaption = nextCaption;
      syncPipState(true);
      if (!playerId) return;

      void sendNativeCommand(playerId, {
        type: "set-secondary-subtitle-track",
        trackId: nextCaption?.trackId ?? "no",
      });
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
    if (getElectronApi()?.toggleFullscreen) return; // Native handles this via IPC
    isFullscreen = Boolean(fscreen.fullscreenElement);
    emit("fullscreen", isFullscreen);
  }

  fscreen.addEventListener("fullscreenchange", fullscreenChanged);

  unbindFullscreen =
    electronApi?.onFullscreenState?.((isFull) => {
      isFullscreen = isFull;
      emit("fullscreen", isFull);
    }) ?? null;

  if (electronApi?.getFullscreenState) {
    electronApi
      .getFullscreenState()
      .then((isFull) => {
        if (destroyed) return;
        isFullscreen = Boolean(isFull);
        emit("fullscreen", isFullscreen);
      })
      .catch(() => {});
  }

  return thisDisplay;
}
