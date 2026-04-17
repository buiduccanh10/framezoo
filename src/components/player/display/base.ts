import fscreen from "fscreen";
import Hls, { ErrorData, ErrorDetails, Level } from "hls.js";

import {
  RULE_IDS,
  isExtensionActiveCached,
  setDomainRule,
} from "@/backend/extension/messaging";
import {
  DisplayInterface,
  DisplayInterfaceEvents,
} from "@/components/player/display/displayInterface";
import { handleBuffered } from "@/components/player/utils/handleBuffered";
import { getMediaErrorDetails } from "@/components/player/utils/mediaErrorDetails";
import {
  createM3U8ProxyUrl,
  createMP4ProxyUrl,
  isUrlAlreadyProxied,
} from "@/components/player/utils/proxy";
import { useLanguageStore } from "@/stores/language";
import {
  LoadableSource,
  SourceQuality,
  getPreferredQuality,
} from "@/stores/player/utils/qualities";
import { processCdnLink } from "@/utils/cdn";
import {
  canChangeVolume,
  canFullscreen,
  canFullscreenAnyElement,
  canPictureInPicture,
  canPlayHlsNatively,
  canWebkitFullscreen,
  canWebkitPictureInPicture,
} from "@/utils/detectFeatures";
import { makeEmitter } from "@/utils/events";

const levelConversionMap: Record<number, SourceQuality> = {
  360: "360",
  1080: "1080",
  720: "720",
  480: "480",
  2160: "4k",
};

// Define quality thresholds for mapping non-standard resolutions
const qualityThresholds = [
  { minHeight: 1800, quality: "4k" as SourceQuality },
  { minHeight: 800, quality: "1080" as SourceQuality },
  { minHeight: 600, quality: "720" as SourceQuality },
  { minHeight: 420, quality: "480" as SourceQuality },
  { minHeight: 0, quality: "360" as SourceQuality },
];
const MIN_AUTOPLAY_BUFFER_SECONDS = 3;
const RECOVERABLE_HLS_BUFFER_ERRORS = new Set<string>([
  ErrorDetails.BUFFER_STALLED_ERROR,
  ErrorDetails.BUFFER_NUDGE_ON_STALL,
  ErrorDetails.BUFFER_SEEK_OVER_HOLE,
  ErrorDetails.BUFFER_APPEND_ERROR,
  ErrorDetails.BUFFER_APPENDING_ERROR,
]);
const RECOVERABLE_HLS_NETWORK_ERRORS = new Set<string>([
  ErrorDetails.KEY_LOAD_ERROR,
  ErrorDetails.KEY_LOAD_TIMEOUT,
  ErrorDetails.FRAG_LOAD_ERROR,
  ErrorDetails.FRAG_LOAD_TIMEOUT,
  ErrorDetails.AUDIO_TRACK_LOAD_ERROR,
  ErrorDetails.AUDIO_TRACK_LOAD_TIMEOUT,
  ErrorDetails.LEVEL_LOAD_ERROR,
  ErrorDetails.LEVEL_LOAD_TIMEOUT,
]);
const HLS_START_LOAD_THROTTLE_MS = 2500;
const HLS_SOURCEBUFFER_RACE_WINDOW_MS = 6000;
const HLS_SOURCEBUFFER_RACE_THRESHOLD = 3;
const HLS_RECREATE_COOLDOWN_MS = 12000;

function hlsLevelToQuality(level?: Level): SourceQuality | null {
  if (!level?.height) return null;

  // First check for exact matches
  const exactMatch = levelConversionMap[level.height];
  if (exactMatch) return exactMatch;

  // For non-standard resolutions, map to closest standard quality
  for (const threshold of qualityThresholds) {
    if (level.height >= threshold.minHeight) {
      return threshold.quality;
    }
  }

  return "unknown"; // fallback to unknown quality
}

function hlsLevelsToQualities(levels: Level[]): SourceQuality[] {
  return levels
    .map((v) => hlsLevelToQuality(v))
    .filter((v): v is SourceQuality => !!v);
}

// Sort levels by quality (height) to ensure we can select the best one
function sortLevelsByQuality(levels: Level[]): Level[] {
  return [...levels].sort((a, b) => (b.height || 0) - (a.height || 0));
}

function getManualHlsSelection(
  levels: Level[],
  preferredQuality: SourceQuality | null,
): { levelIndex: number; quality: SourceQuality } | null {
  const sortedLevels = sortLevelsByQuality(levels);
  const qualities = hlsLevelsToQualities(sortedLevels);
  const availableQuality = getPreferredQuality(qualities, {
    lastChosenQuality: preferredQuality,
    automaticQuality: false,
  });

  if (!availableQuality) return null;

  const matchingLevels = levels.filter(
    (level) => hlsLevelToQuality(level) === availableQuality,
  );
  if (matchingLevels.length === 0) return null;

  const bestLevel = sortLevelsByQuality(matchingLevels)[0];
  const levelIndex = levels.indexOf(bestLevel);
  if (levelIndex === -1) return null;

  return {
    levelIndex,
    quality: availableQuality,
  };
}

function isRecoverableHlsBufferIssue(data: ErrorData) {
  return RECOVERABLE_HLS_BUFFER_ERRORS.has(data.details);
}

function isRecoverableHlsNetworkIssue(data: ErrorData) {
  return !data.fatal && RECOVERABLE_HLS_NETWORK_ERRORS.has(data.details);
}

function getHlsErrorMessage(data: ErrorData) {
  const error = (data.error ?? (data as any).err) as
    | Error
    | { message?: string; name?: string }
    | undefined;
  return error?.message ?? "";
}

function getHlsErrorName(data: ErrorData) {
  const error = (data.error ?? (data as any).err) as
    | Error
    | { message?: string; name?: string }
    | undefined;
  return error?.name ?? "";
}

function isDetachedSourceBufferRace(data: ErrorData) {
  if (
    data.details !== ErrorDetails.BUFFER_APPEND_ERROR &&
    data.details !== ErrorDetails.BUFFER_APPENDING_ERROR
  ) {
    return false;
  }

  const errorMessage = getHlsErrorMessage(data);
  const errorName = getHlsErrorName(data);

  return (
    errorName === "HlsJsTrackRemovedError" ||
    errorMessage.includes(
      "SourceBuffer has been removed from the parent media source",
    ) ||
    errorMessage.includes("SourceBuffer, but it does not exist")
  );
}

export function makeVideoElementDisplayInterface(): DisplayInterface {
  const { emit, on, off } = makeEmitter<DisplayInterfaceEvents>();
  let source: LoadableSource | null = null;
  let hls: Hls | null = null;
  let videoElement: HTMLVideoElement | null = null;
  let containerElement: HTMLElement | null = null;
  let isFullscreen = false;
  let isPictureInPicture = false;
  let isPausedBeforeSeeking = false;
  let isSeeking = false;
  let startAt = 0;
  let automaticQuality = false;
  let preferenceQuality: SourceQuality | null = null;
  let lastVolume = 1;
  let lastValidDuration = 0; // Store the last valid duration to prevent reset during source switches
  let lastValidTime = 0; // Store the last valid time to prevent reset during source switches
  let shouldAutoplayAfterLoad = false; // Flag to track if we should autoplay after loading completes
  let qualityChangeTimeout: NodeJS.Timeout | null = null; // Timeout for debouncing rapid quality changes
  let qualitySetupRetryTimeout: NodeJS.Timeout | null = null; // Retry manual quality setup after manifest load
  let hlsRecoveryTimeout: NodeJS.Timeout | null = null; // Throttle recovery attempts for transient HLS failures
  let lastHlsStartLoadAt = 0;
  let detachedSourceBufferRaceCount = 0;
  let detachedSourceBufferRaceWindowStart = 0;
  let lastHlsRecreateAt = 0;

  const languagePromises = new Map<
    string,
    (value: void | PromiseLike<void>) => void
  >();

  function getBufferedAhead(): number {
    if (!videoElement) return 0;
    const currentTime = videoElement.currentTime ?? 0;
    const buffered = videoElement.buffered;
    if (buffered.length === 0) return 0;

    for (let i = 0; i < buffered.length; i += 1) {
      if (currentTime >= buffered.start(i) && currentTime <= buffered.end(i)) {
        return buffered.end(i) - currentTime;
      }
    }
    return 0;
  }

  function hasEnoughBufferForPlayback() {
    return getBufferedAhead() >= MIN_AUTOPLAY_BUFFER_SECONDS;
  }

  function tryAutoplayWhenReady() {
    if (!videoElement || !shouldAutoplayAfterLoad) return;

    // For resumed playback (>0s), allow immediate autoplay attempt.
    // For initial startup, wait until enough data is buffered.
    const isResumedPlayback = (videoElement.currentTime ?? 0) > 0;
    if (!isResumedPlayback && !hasEnoughBufferForPlayback()) return;

    const playPromise = videoElement.play();
    if (!playPromise) {
      shouldAutoplayAfterLoad = false;
      return;
    }

    playPromise
      .then(() => {
        shouldAutoplayAfterLoad = false;
        emit("loading", false);
      })
      .catch((error: unknown) => {
        const errorName = error instanceof DOMException ? error.name : "";
        // Browser policy block needs user gesture; don't keep retrying.
        if (errorName === "NotAllowedError") {
          shouldAutoplayAfterLoad = false;
          emit("pause", undefined);
        }
      });
  }

  function clearHlsRecoveryTimeout() {
    if (hlsRecoveryTimeout) {
      clearTimeout(hlsRecoveryTimeout);
      hlsRecoveryTimeout = null;
    }
  }

  function startHlsLoadThrottled(atTime: number): boolean {
    if (!hls) return false;
    const now = Date.now();
    if (now - lastHlsStartLoadAt < HLS_START_LOAD_THROTTLE_MS) {
      return false;
    }
    lastHlsStartLoadAt = now;
    hls.startLoad(Math.max(atTime, 0));
    return true;
  }

  function resetDetachedSourceBufferRaceTracking() {
    detachedSourceBufferRaceCount = 0;
    detachedSourceBufferRaceWindowStart = 0;
  }

  function trackDetachedSourceBufferRace() {
    const now = Date.now();
    if (
      detachedSourceBufferRaceWindowStart === 0 ||
      now - detachedSourceBufferRaceWindowStart >
        HLS_SOURCEBUFFER_RACE_WINDOW_MS
    ) {
      detachedSourceBufferRaceWindowStart = now;
      detachedSourceBufferRaceCount = 0;
    }
    detachedSourceBufferRaceCount += 1;
    return detachedSourceBufferRaceCount;
  }

  function recreateHlsAtCurrentTime(src: LoadableSource) {
    if (!videoElement || src.type !== "hls") return false;
    const now = Date.now();
    if (now - lastHlsRecreateAt < HLS_RECREATE_COOLDOWN_MS) {
      return false;
    }

    const resumeAt = Math.max(videoElement.currentTime ?? 0, 0);
    const shouldResumePlayback =
      !videoElement.paused || shouldAutoplayAfterLoad;

    lastHlsRecreateAt = now;
    startAt = resumeAt;
    shouldAutoplayAfterLoad = shouldResumePlayback;
    resetDetachedSourceBufferRaceTracking();

    emit("loading", true);
    setupSource(videoElement, src);
    tryAutoplayWhenReady();
    return true;
  }

  function scheduleHlsRecovery() {
    if (hlsRecoveryTimeout) return;

    hlsRecoveryTimeout = setTimeout(() => {
      hlsRecoveryTimeout = null;
      if (!hls || !videoElement || isSeeking || videoElement.ended) return;

      const currentTime = videoElement.currentTime ?? 0;
      const bufferAhead = getBufferedAhead();
      const notReadyForPlayback = videoElement.readyState < 3;

      // Only intervene if playback still looks starved after hls.js had time to recover on its own.
      if (!notReadyForPlayback && bufferAhead >= 1.5) return;

      if (automaticQuality && hls.currentLevel > 0) {
        hls.nextLevel = hls.currentLevel - 1;
      }

      emit("loading", true);
      const restarted = startHlsLoadThrottled(currentTime);
      if (restarted) {
        tryAutoplayWhenReady();
      }
    }, 1500);
  }

  function reportLevels() {
    if (!hls) return;
    const levels = hls.levels;
    const convertedLevels = levels
      .map((v) => hlsLevelToQuality(v))
      .filter((v): v is SourceQuality => !!v);
    emit("qualities", convertedLevels);
  }

  function reportAudioTracks() {
    if (!hls) return;
    const currentLanguage = useLanguageStore.getState().language;
    const audioTracks = hls.audioTracks;
    const languageTrack = audioTracks.find((v) => v.lang === currentLanguage);
    if (languageTrack) {
      hls.audioTrack = audioTracks.indexOf(languageTrack);
    }
    const currentTrack = audioTracks?.[hls.audioTrack ?? 0];
    if (!currentTrack) return;
    emit("changedaudiotrack", {
      id: currentTrack.id.toString(),
      label: currentTrack.name,
      language: currentTrack.lang ?? "unknown",
    });
    emit(
      "audiotracks",
      hls.audioTracks.map((v) => ({
        id: v.id.toString(),
        label: v.name,
        language: v.lang ?? "unknown",
      })),
    );
  }

  function setupQualityForHls(): SourceQuality | null {
    if (videoElement && canPlayHlsNatively(videoElement)) {
      return null;
    }

    if (!hls) return null;
    if (!automaticQuality) {
      const manualSelection = getManualHlsSelection(
        hls.levels,
        preferenceQuality,
      );
      if (manualSelection) {
        hls.startLevel = manualSelection.levelIndex;
        hls.nextLevel = manualSelection.levelIndex;
        hls.currentLevel = manualSelection.levelIndex;
        hls.loadLevel = manualSelection.levelIndex;
        return manualSelection.quality;
      }
    } else {
      hls.startLevel = -1;
      hls.currentLevel = -1;
      hls.loadLevel = -1;
    }
    // For manual quality selection, wait for LEVEL_SWITCHED to emit quality
    // to avoid showing intermediate states when HLS switches away from unplayable levels
    // For automatic quality, currentLevel is -1, so we wait for LEVEL_SWITCHED event
    return null;
  }

  function setupSource(vid: HTMLVideoElement, src: LoadableSource) {
    // Ensure cross-origin media requests carry auth cookies for backend-proxied endpoints.
    vid.crossOrigin = "use-credentials";

    if (hls) {
      hls.destroy();
      hls = null;
    }
    lastHlsStartLoadAt = 0;
    resetDetachedSourceBufferRaceTracking();
    if (qualitySetupRetryTimeout) {
      clearTimeout(qualitySetupRetryTimeout);
      qualitySetupRetryTimeout = null;
    }
    clearHlsRecoveryTimeout();
    if (src.type === "hls") {
      if (canPlayHlsNatively(vid)) {
        vid.src = processCdnLink(src.url);
        vid.currentTime = startAt;
        return;
      }

      if (!Hls.isSupported())
        throw new Error("HLS not supported. Update your browser. 🤦‍♂️");
      if (!hls) {
        hls = new Hls({
          autoStartLoad: false,
          xhrSetup: (xhr) => {
            xhr.withCredentials = true;
          },
          maxBufferLength: 240, // 240 seconds
          maxMaxBufferLength: 480,
          abrEwmaDefaultEstimate: 5 * 1000 * 1000, // 5 Mbps default bandwidth estimate for better ABR decisions
          preserveManualLevelOnError: true,
          fragLoadPolicy: {
            default: {
              maxLoadTimeMs: 30 * 1000, // allow it load extra long, fragments are slow if requested for the first time on an origin
              maxTimeToFirstByteMs: 30 * 1000,
              errorRetry: {
                maxNumRetry: 10,
                retryDelayMs: 1000,
                maxRetryDelayMs: 10000,
              },
              timeoutRetry: {
                maxNumRetry: 10,
                maxRetryDelayMs: 0,
                retryDelayMs: 0,
              },
            },
          },
          renderTextTracksNatively: false,
        });
        const currentHls = hls;
        const exceptions = [
          "Failed to execute 'appendBuffer' on 'SourceBuffer': This SourceBuffer has been removed from the parent media source.",
        ];
        hls?.on(Hls.Events.ERROR, (event, data) => {
          if (hls !== currentHls) return;
          if (isDetachedSourceBufferRace(data)) {
            clearHlsRecoveryTimeout();
            const raceCount = trackDetachedSourceBufferRace();
            const recreated =
              raceCount >= HLS_SOURCEBUFFER_RACE_THRESHOLD &&
              recreateHlsAtCurrentTime(src);

            if (recreated) {
              console.warn(
                "Recreated HLS instance after repeated SourceBuffer race",
                {
                  raceCount,
                  details: data.details,
                  parent: data.parent,
                },
              );
              return;
            }

            scheduleHlsRecovery();
            console.warn("Ignoring transient HLS SourceBuffer race", {
              raceCount,
              details: data.details,
              parent: data.parent,
            });
            return;
          }

          if (isRecoverableHlsBufferIssue(data)) {
            emit("loading", true);
            scheduleHlsRecovery();
            console.warn("HLS buffering event", data);
          } else if (isRecoverableHlsNetworkIssue(data)) {
            emit("loading", true);
            scheduleHlsRecovery();
            console.warn("HLS recoverable network event", data);
          } else {
            console.error("HLS error", data);
          }

          // Extract detailed HLS error information
          const hlsErrorInfo = {
            details: data.details,
            fatal: data.fatal,
            level: data.level,
            levelDetails: (data as any).levelDetails
              ? {
                  url: (data as any).levelDetails.url,
                  width: (data as any).levelDetails.width,
                  height: (data as any).levelDetails.height,
                  bitrate: (data as any).levelDetails.bitrate,
                }
              : undefined,
            frag: data.frag
              ? {
                  url: data.frag.url,
                  baseurl: data.frag.baseurl,
                  duration: data.frag.duration,
                  start: data.frag.start,
                  sn: data.frag.sn,
                }
              : undefined,
            type: data.type,
            url: (data as any).url,
          };

          if (isRecoverableHlsBufferIssue(data)) {
            return;
          }
          if (isRecoverableHlsNetworkIssue(data)) {
            return;
          }

          if (
            data.fatal &&
            src?.url === data.frag?.baseurl &&
            !exceptions.includes(getHlsErrorMessage(data))
          ) {
            emit("error", {
              message: getHlsErrorMessage(data),
              stackTrace: data.error?.stack,
              errorName: getHlsErrorName(data) || "HLSError",
              type: "hls",
              hls: hlsErrorInfo,
            });
          } else if (data.details === "manifestLoadError") {
            // Handle manifest load errors specifically
            emit("error", {
              message: "Failed to load HLS manifest",
              stackTrace: data.error?.stack || "",
              errorName: data.error?.name || "ManifestLoadError",
              type: "hls",
              hls: hlsErrorInfo,
            });
          }
        });
        hls.on(Hls.Events.STALL_RESOLVED, () => {
          if (hls !== currentHls) return;
          clearHlsRecoveryTimeout();
          resetDetachedSourceBufferRaceTracking();
          emit("loading", false);
        });
        hls.on(Hls.Events.MANIFEST_LOADED, () => {
          if (hls !== currentHls) return;
          if (!hls) return;
          reportLevels();
          const configuredQuality = setupQualityForHls();
          if (configuredQuality) {
            emit("changedquality", configuredQuality);
          }

          if (!automaticQuality) {
            if (qualitySetupRetryTimeout) {
              clearTimeout(qualitySetupRetryTimeout);
              qualitySetupRetryTimeout = null;
            }
            qualitySetupRetryTimeout = setTimeout(() => {
              if (!hls) return;
              if (automaticQuality) return;
              const retriedQuality = setupQualityForHls();
              if (retriedQuality) {
                emit("changedquality", retriedQuality);
              }
            }, 250);
          }

          reportAudioTracks();
          resetDetachedSourceBufferRaceTracking();
          lastHlsStartLoadAt = Date.now();
          hls.startLoad(startAt);

          if (isExtensionActiveCached()) {
            hls.on(Hls.Events.LEVEL_LOADED, async (_, data) => {
              const chunkUrlsDomains = data.details.fragments.map(
                (v) => new URL(v.url).hostname,
              );
              const chunkUrls = [...new Set(chunkUrlsDomains)];

              await setDomainRule({
                ruleId: RULE_IDS.SET_DOMAINS_HLS,
                targetDomains: chunkUrls,
                requestHeaders: {
                  ...src.preferredHeaders,
                  ...src.headers,
                },
              });
            });
            hls.on(Hls.Events.AUDIO_TRACK_LOADED, async (_, data) => {
              const chunkUrlsDomains = data.details.fragments.map(
                (v) => new URL(v.url).hostname,
              );
              const chunkUrls = [...new Set(chunkUrlsDomains)];

              await setDomainRule({
                ruleId: RULE_IDS.SET_DOMAINS_HLS_AUDIO,
                targetDomains: chunkUrls,
                requestHeaders: {
                  ...src.preferredHeaders,
                  ...src.headers,
                },
              });
            });
          }
        });
        hls.on(Hls.Events.LEVEL_SWITCHED, () => {
          if (!hls) return;

          // Don't process level switched events during debounced quality changes
          if (qualityChangeTimeout) return;

          const currentLevel = hls.levels[hls.currentLevel];
          const currentQuality = hlsLevelToQuality(currentLevel);
          const manualQuality = getManualHlsSelection(
            hls.levels,
            preferenceQuality,
          )?.quality;
          const configuredQuality = automaticQuality
            ? currentQuality
            : (manualQuality ?? currentQuality);

          emit("changedquality", configuredQuality);
        });
        hls.on(Hls.Events.SUBTITLE_TRACK_LOADED, () => {
          for (const [lang, resolve] of languagePromises) {
            const track = hls?.subtitleTracks.find((t) => t.lang === lang);
            if (track) {
              resolve();
              languagePromises.delete(lang);
              break;
            }
          }
        });
      }

      hls.attachMedia(vid);
      hls.loadSource(processCdnLink(src.url));
      vid.currentTime = startAt;
      return;
    }

    vid.src = processCdnLink(src.url);
    vid.currentTime = startAt;
  }

  function webkitPresentationModeChange() {
    if (!videoElement) return;
    const webkitPlayer = videoElement as any;
    const isInWebkitPip =
      webkitPlayer.webkitPresentationMode === "picture-in-picture";
    isPictureInPicture = isInWebkitPip;
    // Use native tracks in WebKit PiP mode for iOS compatibility
    emit("needstrack", isInWebkitPip);

    // On iOS, entering PiP may allow autoplay that was previously blocked
    if (isInWebkitPip && videoElement.paused && shouldAutoplayAfterLoad) {
      tryAutoplayWhenReady();
    }
  }

  function setSource() {
    if (!videoElement || !source) return;
    setupSource(videoElement, source);

    videoElement.addEventListener("play", () => {
      emit("play", undefined);
      emit("loading", false);
    });
    videoElement.addEventListener("error", () => {
      const err = videoElement?.error ?? null;
      const errorDetails = getMediaErrorDetails(err);
      emit("error", {
        errorName: errorDetails.name,
        key: errorDetails.key,
        type: "htmlvideo",
      });
    });
    videoElement.addEventListener("playing", () => emit("play", undefined));
    videoElement.addEventListener("pause", () => emit("pause", undefined));
    videoElement.addEventListener("canplay", () => {
      const hasEnoughBuffer = hasEnoughBufferForPlayback();

      // Only set loading to false if we have enough buffer or if we're not at startup.
      if (hasEnoughBuffer || (videoElement?.currentTime ?? 0) > 0) {
        emit("loading", false);
      }

      // Attempt autoplay only when playback is ready.
      tryAutoplayWhenReady();
    });
    videoElement.addEventListener("waiting", () => emit("loading", true));
    videoElement.addEventListener("volumechange", () =>
      emit(
        "volumechange",
        videoElement?.muted ? 0 : (videoElement?.volume ?? 0),
      ),
    );
    videoElement.addEventListener("timeupdate", () => {
      const currentTime = videoElement?.currentTime ?? 0;
      // Always emit time updates when seeking to prevent subtitle freezing
      // Also emit when progressing forward or when time changes significantly
      // This prevents time from resetting to 0 during source switches
      if (
        currentTime >= lastValidTime ||
        isSeeking ||
        Math.abs(currentTime - lastValidTime) > 0.1
      ) {
        lastValidTime = currentTime;
        emit("time", currentTime);
      }
    });
    videoElement.addEventListener("loadedmetadata", () => {
      if (
        source?.type === "hls" &&
        videoElement &&
        canPlayHlsNatively(videoElement)
      ) {
        emit("qualities", ["unknown"]);
        emit("changedquality", "unknown");
      }
      // Only emit duration if it's a valid value (> 0) to prevent progress reset during source switches
      const duration = videoElement?.duration ?? 0;
      if (duration > 0) {
        lastValidDuration = duration;
        emit("duration", duration);
      } else if (lastValidDuration > 0) {
        // Keep the last valid duration if the new one is invalid
        emit("duration", lastValidDuration);
      }
    });
    videoElement.addEventListener("progress", () => {
      if (videoElement) {
        const bufferedTime = handleBuffered(
          videoElement.currentTime,
          videoElement.buffered,
        );
        emit("buffered", bufferedTime);

        const hasEnoughBuffer = hasEnoughBufferForPlayback();

        // If we're still loading but now have enough buffer, stop loading
        // This handles cases where canplay fired with insufficient buffer
        if (hasEnoughBuffer && videoElement.readyState >= 3) {
          emit("loading", false);
        }

        if (hasEnoughBuffer && videoElement.readyState >= 3) {
          tryAutoplayWhenReady();
        }
      }
    });
    videoElement.addEventListener("webkitbeginfullscreen", () => {
      isFullscreen = true;
      emit("fullscreen", isFullscreen);
      emit("needstrack", true);
    });
    videoElement.addEventListener("webkitendfullscreen", () => {
      isFullscreen = false;
      emit("fullscreen", isFullscreen);
      if (!isFullscreen) emit("needstrack", false);
    });
    videoElement.addEventListener(
      "webkitplaybacktargetavailabilitychanged",
      (e: any) => {
        if (e.availability === "available") {
          emit("canairplay", true);
        }
      },
    );
    videoElement.addEventListener(
      "webkitpresentationmodechanged",
      webkitPresentationModeChange,
    );
    videoElement.addEventListener("ratechange", () => {
      if (videoElement) emit("playbackrate", videoElement.playbackRate);
    });

    videoElement.addEventListener("durationchange", () => {
      // Only emit duration if it's a valid value (> 0) to prevent progress reset during source switches
      const duration = videoElement?.duration ?? 0;
      if (duration > 0) {
        lastValidDuration = duration;
        emit("duration", duration);
      } else if (lastValidDuration > 0) {
        // Keep the last valid duration if the new one is invalid
        emit("duration", lastValidDuration);
      }
    });
  }

  function unloadSource() {
    // Clear any pending quality change timeout
    if (qualityChangeTimeout) {
      clearTimeout(qualityChangeTimeout);
      qualityChangeTimeout = null;
    }
    if (qualitySetupRetryTimeout) {
      clearTimeout(qualitySetupRetryTimeout);
      qualitySetupRetryTimeout = null;
    }
    clearHlsRecoveryTimeout();
    lastHlsStartLoadAt = 0;
    resetDetachedSourceBufferRaceTracking();

    if (videoElement) {
      videoElement.removeAttribute("src");
      videoElement.load();
    }
    if (hls) {
      hls.destroy();
      hls = null;
    }
    // Reset the last valid duration and time when unloading source
    lastValidDuration = 0;
    lastValidTime = 0;
  }

  function destroyVideoElement() {
    unloadSource();
    if (videoElement) {
      videoElement = null;
    }
    // Clear any remaining timeout
    if (qualityChangeTimeout) {
      clearTimeout(qualityChangeTimeout);
      qualityChangeTimeout = null;
    }
    if (qualitySetupRetryTimeout) {
      clearTimeout(qualitySetupRetryTimeout);
      qualitySetupRetryTimeout = null;
    }
    clearHlsRecoveryTimeout();
  }

  function fullscreenChange() {
    isFullscreen =
      !!document.fullscreenElement || // other browsers
      !!(document as any).webkitFullscreenElement; // safari
    emit("fullscreen", isFullscreen);
    if (!isFullscreen) emit("needstrack", false);

    // On iOS, entering fullscreen may allow autoplay that was previously blocked
    if (
      isFullscreen &&
      videoElement &&
      videoElement.paused &&
      shouldAutoplayAfterLoad
    ) {
      tryAutoplayWhenReady();
    }
  }
  fscreen.addEventListener("fullscreenchange", fullscreenChange);

  function pictureInPictureChange() {
    isPictureInPicture = !!document.pictureInPictureElement;
    // Use native tracks in PiP mode for better compatibility with iOS and other platforms
    emit("needstrack", isPictureInPicture);

    // Entering PiP may allow autoplay that was previously blocked
    if (
      isPictureInPicture &&
      videoElement &&
      videoElement.paused &&
      shouldAutoplayAfterLoad
    ) {
      tryAutoplayWhenReady();
    }
  }

  document.addEventListener("enterpictureinpicture", pictureInPictureChange);
  document.addEventListener("leavepictureinpicture", pictureInPictureChange);

  return {
    on,
    off,
    getType() {
      return "web";
    },
    destroy: () => {
      destroyVideoElement();
      fscreen.removeEventListener("fullscreenchange", fullscreenChange);
      document.removeEventListener(
        "enterpictureinpicture",
        pictureInPictureChange,
      );
      document.removeEventListener(
        "leavepictureinpicture",
        pictureInPictureChange,
      );
    },
    load(ops) {
      if (!ops.source) unloadSource();
      automaticQuality = ops.automaticQuality;
      preferenceQuality = ops.preferredQuality;
      source = ops.source;
      emit("loading", true);
      startAt = ops.startAt;
      // Use the autoplay flag from options, defaulting to true if not specified
      shouldAutoplayAfterLoad = ops.autoplay ?? true;
      setSource();
    },
    changeQuality(newAutomaticQuality, newPreferredQuality) {
      if (source?.type !== "hls") return;

      // Clear any pending quality change to prevent race conditions
      if (qualityChangeTimeout) {
        clearTimeout(qualityChangeTimeout);
        qualityChangeTimeout = null;
      }
      if (qualitySetupRetryTimeout) {
        clearTimeout(qualitySetupRetryTimeout);
        qualitySetupRetryTimeout = null;
      }

      automaticQuality = newAutomaticQuality;
      preferenceQuality = newPreferredQuality;

      // Debounce quality changes to prevent rapid switching issues
      qualityChangeTimeout = setTimeout(() => {
        setupQualityForHls();
        qualityChangeTimeout = null;
      }, 100); // 100ms debounce delay
    },

    processVideoElement(video) {
      destroyVideoElement();
      videoElement = video;
      setSource();
      this.setVolume(lastVolume);
    },
    processContainerElement(container) {
      containerElement = container;
    },
    setMeta() {},
    setCaption() {},

    pause() {
      videoElement?.pause();
    },
    play() {
      videoElement?.play();
    },
    setSeeking(active) {
      if (active === isSeeking) return;
      isSeeking = active;

      // if it was playing when starting to seek, play again
      if (!active) {
        if (!isPausedBeforeSeeking) this.play();
        return;
      }

      isPausedBeforeSeeking = videoElement?.paused ?? true;
      this.pause();
    },
    setTime(t) {
      if (!videoElement) return;
      // clamp time between 0 and max duration
      let time = Math.min(t, videoElement.duration);
      time = Math.max(0, time);

      if (Number.isNaN(time)) return;
      emit("time", time);
      videoElement.currentTime = time;
    },
    async setVolume(v) {
      // clamp time between 0 and 1
      let volume = Math.min(v, 1);
      volume = Math.max(0, volume);

      // actually set
      lastVolume = v;
      if (!videoElement) return;
      videoElement.muted = volume === 0; // Muted attribute is always supported

      // update state
      const isChangeable = await canChangeVolume();
      if (isChangeable) {
        videoElement.volume = volume;
      } else {
        // For browsers where it can't be changed
        emit("volumechange", volume === 0 ? 0 : 1);
      }
    },
    toggleFullscreen() {
      if (isFullscreen) {
        isFullscreen = false;
        emit("fullscreen", isFullscreen);
        emit("needstrack", false);
        if (!fscreen.fullscreenElement) return;
        fscreen.exitFullscreen();
        return;
      }

      // enter fullscreen
      isFullscreen = true;
      emit("fullscreen", isFullscreen);
      if (!canFullscreen() || fscreen.fullscreenElement) return;
      if (canFullscreenAnyElement()) {
        if (containerElement) fscreen.requestFullscreen(containerElement);
        return;
      }
      if (canWebkitFullscreen()) {
        if (videoElement) {
          const tracks = videoElement.textTracks;
          for (let i = 0; i < tracks.length; i++) {
            if (tracks[i].kind === "subtitles") {
              tracks[i].mode = "showing";
            }
          }
          emit("needstrack", true);
          (videoElement as any).webkitEnterFullscreen();
        }
      }
    },
    togglePictureInPicture() {
      if (!videoElement) return;
      if (canWebkitPictureInPicture()) {
        const webkitPlayer = videoElement as any;
        webkitPlayer.webkitSetPresentationMode(
          webkitPlayer.webkitPresentationMode === "picture-in-picture"
            ? "inline"
            : "picture-in-picture",
        );
      }
      if (canPictureInPicture()) {
        if (videoElement !== document.pictureInPictureElement) {
          videoElement.requestPictureInPicture();
        } else {
          document.exitPictureInPicture();
        }
      }
    },
    startAirplay() {
      const videoPlayer = videoElement as any;
      if (!videoPlayer || !videoPlayer.webkitShowPlaybackTargetPicker) return;

      if (!source) {
        // No source loaded, just trigger Airplay
        videoPlayer.webkitShowPlaybackTargetPicker();
        return;
      }

      // Store the original URL to restore later
      const originalUrl =
        source?.type === "hls" ? hls?.url || source.url : videoPlayer.src;

      let proxiedUrl: string | null = null;

      if (source?.type === "hls") {
        // Only proxy HLS streams if they need it:
        // 1. Not already proxied AND
        // 2. Has headers (either preferredHeaders or headers)
        const allHeaders = {
          ...source.preferredHeaders,
          ...source.headers,
        };
        const hasHeaders = Object.keys(allHeaders).length > 0;

        // Don't create proxy URL if it's already using the proxy
        if (!isUrlAlreadyProxied(source.url) && hasHeaders) {
          proxiedUrl = createM3U8ProxyUrl(source.url, allHeaders);
        } else {
          proxiedUrl = source.url; // Already proxied or no headers needed
        }
      } else if (source?.type === "mp4") {
        const allHeaders = {
          ...source.preferredHeaders,
          ...source.headers,
        };
        const hasHeaders = Object.keys(allHeaders).length > 0;
        if (!isUrlAlreadyProxied(source.url) && hasHeaders) {
          // Use MP4 proxy for streams with headers
          proxiedUrl = createMP4ProxyUrl(source.url, allHeaders);
        } else {
          proxiedUrl = source.url;
        }
      }

      // Function to restore original URL
      const restoreOriginalUrl = () => {
        if (source?.type === "hls") {
          if (hls && originalUrl) {
            hls.loadSource(originalUrl);
          }
        } else if (originalUrl) {
          videoPlayer.src = originalUrl;
        }
      };

      // Function to check airplay state and restore if needed
      const checkAirplayState = () => {
        const isWireless = videoPlayer.webkitCurrentPlaybackTargetIsWireless;
        if (!isWireless) {
          // Airplay didn't start or ended, restore original URL
          restoreOriginalUrl();
        }
      };

      if (proxiedUrl && proxiedUrl !== originalUrl) {
        // Set the proxied URL for Airplay
        if (source?.type === "hls") {
          if (hls) {
            hls.loadSource(proxiedUrl);
          } else {
            videoPlayer.src = proxiedUrl;
          }
        } else {
          videoPlayer.src = proxiedUrl;
        }

        // Small delay to ensure the URL is set before triggering Airplay
        setTimeout(() => {
          videoPlayer.webkitShowPlaybackTargetPicker();

          // Check airplay state after user interaction
          // Give user time to select device, then check if airplay started
          setTimeout(() => {
            checkAirplayState();
          }, 2000);

          // Set up periodic check for airplay state changes
          const airplayCheckInterval = setInterval(() => {
            const isWireless =
              videoPlayer.webkitCurrentPlaybackTargetIsWireless;
            if (!isWireless) {
              // Airplay ended, restore original URL
              restoreOriginalUrl();
              clearInterval(airplayCheckInterval);
            }
          }, 1000);

          // Clear interval after 5 minutes as safety measure
          setTimeout(() => clearInterval(airplayCheckInterval), 300000);
        }, 100);
      } else {
        // No proxying needed, just trigger Airplay
        videoPlayer.webkitShowPlaybackTargetPicker();
      }
    },
    setPlaybackRate(rate) {
      if (videoElement) videoElement.playbackRate = rate;
    },
    getCaptionList() {
      return (
        hls?.subtitleTracks.map((track) => {
          return {
            id: track.id.toString(),
            language: track.lang ?? "unknown",
            url: track.url,
            type: "vtt", // HLS captions are typically VTT format
            needsProxy: false,
            hls: true,
          };
        }) ?? []
      );
    },
    getSubtitleTracks() {
      return hls?.subtitleTracks ?? [];
    },
    async setSubtitlePreference(lang) {
      // default subtitles are already loaded by hls.js
      const track = hls?.subtitleTracks.find((t) => t.lang === lang);
      if (track?.details !== undefined) return Promise.resolve();

      // need to wait a moment before hls loads the subtitles
      const promise = new Promise<void>((resolve, reject) => {
        languagePromises.set(lang, resolve);

        // reject after some time, if hls.js fails to load the subtitles
        // for any reason
        setTimeout(() => {
          reject();
          languagePromises.delete(lang);
        }, 5000);
      });
      hls?.setSubtitleOption({ lang });
      return promise;
    },
    changeAudioTrack(track) {
      if (!hls) return;
      const audioTrack = hls?.audioTracks.find(
        (t) => t.id.toString() === track.id,
      );
      if (!audioTrack) return;
      hls.audioTrack = hls.audioTracks.indexOf(audioTrack);
      emit("changedaudiotrack", {
        id: audioTrack.id.toString(),
        label: audioTrack.name,
        language: audioTrack.lang ?? "unknown",
      });
    },
  };
}
