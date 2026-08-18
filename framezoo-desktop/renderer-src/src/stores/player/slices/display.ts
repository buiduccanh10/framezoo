import { DisplayInterface } from "@/components/player/display/displayInterface";
import { playerStatus } from "@/stores/player/slices/source";
import { MakeSlice } from "@/stores/player/slices/types";

export interface DisplaySlice {
  display: DisplayInterface | null;
  setDisplay(display: DisplayInterface | null): void;
  reset(): void;
}

export const createDisplaySlice: MakeSlice<DisplaySlice> = (set, get) => ({
  display: null,
  setDisplay(newDisplay: DisplayInterface | null) {
    const display = get().display;
    if (display) display.destroy("store:set-display");

    if (!newDisplay) {
      set((s) => {
        s.display = null;
        s.mediaPlaying.hasRenderedFrame = false;
        s.interface.pictureInPictureMode = null;
        s.interface.documentPictureInPictureWindow = null;
      });
      return;
    }

    // make display events update the state
    newDisplay.on("pause", () =>
      set((s) => {
        s.mediaPlaying.isPaused = true;
        s.mediaPlaying.isPlaying = false;
      }),
    );
    newDisplay.on("play", () =>
      set((s) => {
        s.mediaPlaying.hasPlayedOnce = true;
        s.mediaPlaying.isPaused = false;
        s.mediaPlaying.isPlaying = true;
        if (newDisplay.getType() === "casting") {
          s.mediaPlaying.hasRenderedFrame = true;
        }
      }),
    );
    newDisplay.on("fullscreen", (isFullscreen) =>
      set((s) => {
        s.interface.isFullscreen = isFullscreen;
      }),
    );
    newDisplay.on("time", (time) =>
      set((s) => {
        s.progress.time = time;
      }),
    );
    newDisplay.on("volumechange", (vol) =>
      set((s) => {
        s.mediaPlaying.volume = vol;
      }),
    );
    newDisplay.on("duration", (duration) =>
      set((s) => {
        s.progress.duration = duration;
      }),
    );
    newDisplay.on("buffered", (buffered) =>
      set((s) => {
        s.progress.buffered = buffered;
      }),
    );
    newDisplay.on("loading", (isLoading) =>
      set((s) => {
        s.mediaPlaying.isLoading = isLoading;
      }),
    );
    newDisplay.on("rendered", () =>
      set((s) => {
        s.mediaPlaying.hasRenderedFrame = true;
      }),
    );
    newDisplay.on("qualities", (qualities) => {
      set((s) => {
        s.qualities = qualities;
      });
    });
    newDisplay.on("changedquality", (quality) => {
      set((s) => {
        s.currentQuality = quality;
      });
    });
    newDisplay.on("segmentqualitydebug", (segmentQualityDebug) => {
      set((s) => {
        s.segmentQualityDebug = segmentQualityDebug;
      });
    });
    newDisplay.on("audiotracks", (audioTracks) => {
      set((s) => {
        s.audioTracks = audioTracks;
      });
    });
    newDisplay.on("subtitletracks", (subtitleTracks) => {
      get().setEmbeddedSubtitleTracks(
        subtitleTracks.map((track) => ({
          id: `embedded:${track.id}`,
          language: track.language || "unknown",
          url: "",
          trackId: track.id,
          type: "embedded",
          needsProxy: false,
          opensubtitles: false,
          display: track.label || track.language || `Track ${track.id}`,
          source: "embedded",
        })),
      );
    });
    newDisplay.on("changedaudiotrack", (audioTrack) => {
      set((s) => {
        s.currentAudioTrack = audioTrack;
      });
    });
    newDisplay.on("needstrack", (needsTrack) => {
      set((s) => {
        s.caption.asTrack = needsTrack;
      });
    });
    newDisplay.on("pictureinpicture", (pictureInPicture) => {
      set((s) => {
        s.interface.pictureInPictureMode = pictureInPicture.mode;
        s.interface.documentPictureInPictureWindow =
          pictureInPicture.mode === "document"
            ? (pictureInPicture.documentWindow as any)
            : null;
      });
    });
    newDisplay.on("canairplay", (canAirplay) => {
      set((s) => {
        s.interface.canAirplay = canAirplay;
      });
    });
    newDisplay.on("playbackrate", (rate) => {
      set((s) => {
        s.mediaPlaying.playbackRate = rate;
      });
    });
    newDisplay.on("error", (err) => {
      if (get().display !== newDisplay) return;

      const currentState = get();
      console.warn("[player] display error", {
        type: err.type,
        errorName: err.errorName,
        message: err.message,
        sourceId: currentState.sourceId,
        status: currentState.status,
        hls: err.hls
          ? {
              details: err.hls.details,
              fatal: err.hls.fatal,
              responseCode: err.hls.response?.code,
            }
          : undefined,
      });

      // Ignore errors emitted while the player is being reset or the source
      // picker is replacing an old source.
      if (
        !currentState.source ||
        (currentState.status !== playerStatus.PLAYING &&
          currentState.status !== playerStatus.PLAYBACK_ERROR)
      ) {
        return;
      }

      if (
        (currentState.source as any)?.isTorrent &&
        currentState.mediaPlaying.hasRenderedFrame
      ) {
        set((s) => {
          s.mediaPlaying.isLoading = false;
        });
        return;
      }

      set((s) => {
        s.status = playerStatus.PLAYBACK_ERROR;
        s.interface.error = err;
      });
    });

    set((s) => {
      s.display = newDisplay;
      s.mediaPlaying.hasRenderedFrame = false;
    });
  },
  reset() {
    get().display?.exitFullscreen?.();
    get().display?.load({
      source: null,
      startAt: 0,
      automaticQuality: false,
      preferredQuality: null,
      reason: "store:reset",
    });
    set((s) => {
      s.status = playerStatus.IDLE;
      s.meta = null;
      s.embedId = null;
      s.sourceId = null;
      s.interface.shouldStartFromBeginning = false;
      s.interface.skipNextSavedProgressResume = false;
      s.interface.isFullscreen = false;
      s.progress.time = 0;
      s.progress.duration = 0;
    });
  },
});
