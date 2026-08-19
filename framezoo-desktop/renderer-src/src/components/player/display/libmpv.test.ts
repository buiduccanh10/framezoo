import { afterEach, describe, expect, it, vi } from "vitest";

import { makeLibMpvDisplayInterface } from "./libmpv";

type Source = {
  type: "mp4";
  url: string;
};

function makeElement() {
  return {
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 640,
      height: 360,
    }),
  } as unknown as HTMLElement;
}

describe("libmpv display", () => {
  afterEach(() => {
    delete (window as any).electronAPI;
  });

  it("keeps only the latest load when player creation is shared", async () => {
    const loads: Array<{ url: string }> = [];
    const createPlayer = vi.fn().mockResolvedValue("player-1");
    const loadPlayer = vi.fn((_: string, request: { url: string }) => {
      loads.push({ url: request.url });
      return Promise.resolve(true);
    });

    (window as any).electronAPI = {
      createLibMpvPlayer: createPlayer,
      loadLibMpvSource: loadPlayer,
      sendLibMpvCommand: vi.fn().mockResolvedValue(true),
      onLibMpvEvent: vi.fn().mockReturnValue(() => undefined),
      onLibMpvLog: vi.fn().mockReturnValue(() => undefined),
    };

    const display = makeLibMpvDisplayInterface();
    display.processContainerElement(makeElement());
    display.load({
      source: { type: "mp4", url: "https://example.test/old.mkv" } as Source,
      startAt: 0,
      automaticQuality: false,
      preferredQuality: null,
    });
    display.load({
      source: { type: "mp4", url: "https://example.test/new.mkv" } as Source,
      startAt: 12,
      automaticQuality: false,
      preferredQuality: null,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(createPlayer).toHaveBeenCalledTimes(1);
    expect(loads).toEqual([{ url: "https://example.test/new.mkv" }]);
    display.destroy();
  });

  it("stops loading when native source loading returns false", async () => {
    const errors: Array<{ errorName?: string }> = [];
    const loading: boolean[] = [];

    (window as any).electronAPI = {
      createLibMpvPlayer: vi.fn().mockResolvedValue("player-1"),
      loadLibMpvSource: vi.fn().mockResolvedValue(false),
      sendLibMpvCommand: vi.fn().mockResolvedValue(true),
      onLibMpvEvent: vi.fn().mockReturnValue(() => undefined),
      onLibMpvLog: vi.fn().mockReturnValue(() => undefined),
    };

    const display = makeLibMpvDisplayInterface();
    display.processContainerElement(makeElement());
    display.on("loading", (isLoading) => loading.push(isLoading));
    display.on("error", (error) => errors.push(error));
    display.load({
      source: { type: "mp4", url: "https://example.test/video.mkv" } as Source,
      startAt: 0,
      automaticQuality: false,
      preferredQuality: null,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(loading).toContain(false);
    expect(errors.at(-1)?.errorName).toBe("libmpv_load_failed");
    display.destroy();
  });

  it("maps authoritative properties and excludes video tracks", async () => {
    let eventListener:
      | ((event: {
          playerId: string;
          generation: number;
          type: "property";
          name: string;
          data: unknown;
        }) => void)
      | undefined;
    const audioTracks: unknown[] = [];
    const subtitleTracks: unknown[] = [];
    const durations: number[] = [];

    (window as any).electronAPI = {
      createLibMpvPlayer: vi.fn().mockResolvedValue("player-1"),
      loadLibMpvSource: vi.fn().mockResolvedValue(true),
      sendLibMpvCommand: vi.fn().mockResolvedValue(true),
      onLibMpvEvent: vi.fn((listener) => {
        eventListener = listener;
        return () => undefined;
      }),
      onLibMpvLog: vi.fn().mockReturnValue(() => undefined),
    };

    const display = makeLibMpvDisplayInterface();
    display.processContainerElement(makeElement());
    display.on("duration", (duration) => durations.push(duration));
    display.on("audiotracks", (tracks) => audioTracks.push(tracks));
    display.on("subtitletracks", (tracks) => subtitleTracks.push(tracks));
    const source = {
      type: "mp4",
      url: "https://example.test/video.mkv",
    } as Source;
    display.load({
      source,
      startAt: 0,
      automaticQuality: false,
      preferredQuality: null,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    eventListener?.({
      playerId: "player-1",
      generation: 1,
      type: "property",
      name: "duration",
      data: 120,
    });
    eventListener?.({
      playerId: "player-1",
      generation: 1,
      type: "property",
      name: "track-list",
      data: JSON.stringify([
        { id: 1, type: "video", title: "Video" },
        { id: 2, type: "audio", lang: "en", title: "English" },
        { id: 3, type: "sub", lang: "vi", title: "Vietnamese" },
      ]),
    });

    expect(durations).toEqual([120]);
    expect(audioTracks.at(-1)).toEqual([
      { id: "2", label: "English", language: "en" },
    ]);
    expect(subtitleTracks.at(-1)).toEqual([
      {
        id: "3",
        kind: "sub",
        label: "Vietnamese",
        language: "vi",
        selected: false,
      },
    ]);
    expect(display.getSubtitleTracks()).toEqual([
      {
        id: "3",
        kind: "sub",
        label: "Vietnamese",
        language: "vi",
        selected: false,
      },
    ]);
    display.destroy();
  });

  it("selects embedded subtitles natively and disables them for external captions", async () => {
    const commands: Array<{ type: string; trackId?: string }> = [];

    (window as any).electronAPI = {
      createLibMpvPlayer: vi.fn().mockResolvedValue("player-1"),
      loadLibMpvSource: vi.fn().mockResolvedValue(true),
      sendLibMpvCommand: vi.fn(
        (_id: string, command: { type: string; trackId?: string }) => {
          commands.push(command);
          return Promise.resolve(true);
        },
      ),
      onLibMpvEvent: vi.fn().mockReturnValue(() => undefined),
      onLibMpvLog: vi.fn().mockReturnValue(() => undefined),
    };

    const display = makeLibMpvDisplayInterface();
    display.processContainerElement(makeElement());
    display.load({
      source: {
        type: "mp4",
        url: "http://127.0.0.1/video.mkv",
      } as Source,
      startAt: 0,
      automaticQuality: false,
      preferredQuality: null,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    display.setCaption({
      id: "embedded:3",
      language: "vi",
      vttData: "",
      trackId: "3",
    });
    display.setCaption({
      id: "external:vi",
      language: "vi",
      vttData: "WEBVTT",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(commands).toContainEqual({
      type: "set-subtitle-track",
      trackId: "3",
    });
    expect(commands).toContainEqual({
      type: "set-subtitle-track",
      trackId: "no",
    });
    display.setSecondaryCaption?.({
      id: "embedded:4",
      language: "en",
      vttData: "",
      trackId: "4",
    });
    display.setSecondaryCaption?.(null);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(commands).toContainEqual({
      type: "set-secondary-subtitle-track",
      trackId: "4",
    });
    expect(commands).toContainEqual({
      type: "set-secondary-subtitle-track",
      trackId: "no",
    });
    display.destroy();
  });

  it("keeps the loading overlay until libmpv renders the first frame", async () => {
    let eventListener:
      | ((event: {
          playerId: string;
          generation: number;
          type: "file-loaded" | "video-reconfig" | "video-frame";
        }) => void)
      | undefined;
    const loading: boolean[] = [];
    const rendered: number[] = [];

    (window as any).electronAPI = {
      createLibMpvPlayer: vi.fn().mockResolvedValue("player-1"),
      loadLibMpvSource: vi.fn().mockResolvedValue(true),
      sendLibMpvCommand: vi.fn().mockResolvedValue(true),
      onLibMpvEvent: vi.fn((listener) => {
        eventListener = listener;
        return () => undefined;
      }),
      onLibMpvLog: vi.fn().mockReturnValue(() => undefined),
    };

    const display = makeLibMpvDisplayInterface();
    display.processContainerElement(makeElement());
    display.on("loading", (isLoading) => loading.push(isLoading));
    display.on("rendered", () => rendered.push(1));
    display.load({
      source: {
        type: "mp4",
        url: "https://example.test/video.mkv",
      } as Source,
      startAt: 0,
      automaticQuality: false,
      preferredQuality: null,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    eventListener?.({
      playerId: "player-1",
      generation: 1,
      type: "file-loaded",
    });
    eventListener?.({
      playerId: "player-1",
      generation: 1,
      type: "video-reconfig",
    });
    expect(loading).toEqual([true]);

    eventListener?.({
      playerId: "player-1",
      generation: 1,
      type: "video-frame",
    });
    expect(loading).toEqual([true, false]);
    expect(rendered).toEqual([1]);
    display.destroy();
  });

  it("does not publish resume time from pre-frame property updates", async () => {
    let eventListener:
      | ((event: {
          playerId: string;
          generation: number;
          type: string;
          name?: string;
          data?: unknown;
        }) => void)
      | undefined;
    const times: number[] = [];

    (window as any).electronAPI = {
      createLibMpvPlayer: vi.fn().mockResolvedValue("player-1"),
      loadLibMpvSource: vi.fn().mockResolvedValue(true),
      sendLibMpvCommand: vi.fn().mockResolvedValue(true),
      onLibMpvEvent: vi.fn((listener) => {
        eventListener = listener;
        return () => undefined;
      }),
      onLibMpvLog: vi.fn().mockReturnValue(() => undefined),
    };

    const display = makeLibMpvDisplayInterface();
    display.processContainerElement(makeElement());
    display.on("time", (time) => times.push(time));
    display.load({
      source: {
        type: "mp4",
        url: "https://example.test/torrent-file.mp4",
      } as Source,
      startAt: 1571,
      automaticQuality: false,
      preferredQuality: null,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    eventListener?.({
      playerId: "player-1",
      generation: 1,
      type: "property",
      name: "time-pos",
      data: 1590,
    });
    expect(times).toEqual([]);

    eventListener?.({
      playerId: "player-1",
      generation: 1,
      type: "video-frame",
    });
    expect(times).toEqual([1571]);

    display.destroy();
  });

  it("does not surface cache-buffering stalls as a user pause", async () => {
    let eventListener:
      | ((event: {
          playerId: string;
          generation: number;
          type: "file-loaded" | "property";
          name?: string;
          data?: unknown;
        }) => void)
      | undefined;
    const plays: number[] = [];
    const pauses: number[] = [];
    const loading: boolean[] = [];

    (window as any).electronAPI = {
      createLibMpvPlayer: vi.fn().mockResolvedValue("player-1"),
      loadLibMpvSource: vi.fn().mockResolvedValue(true),
      sendLibMpvCommand: vi.fn().mockResolvedValue(true),
      onLibMpvEvent: vi.fn((listener) => {
        eventListener = listener;
        return () => undefined;
      }),
      onLibMpvLog: vi.fn().mockReturnValue(() => undefined),
    };

    const display = makeLibMpvDisplayInterface();
    display.processContainerElement(makeElement());
    display.on("loading", (isLoading) => loading.push(isLoading));
    display.on("play", () => plays.push(1));
    display.on("pause", () => pauses.push(1));
    display.load({
      source: {
        type: "mp4",
        url: "http://127.0.0.1/video.mkv",
      } as Source,
      startAt: 0,
      automaticQuality: false,
      preferredQuality: null,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    // File opens and mpv reports it is actually playing.
    eventListener?.({
      playerId: "player-1",
      generation: 1,
      type: "file-loaded",
    });
    eventListener?.({
      playerId: "player-1",
      generation: 1,
      type: "property",
      name: "pause",
      data: false,
    });
    expect(plays.length).toBeGreaterThan(0);

    // Torrent input underruns: mpv flips pause=true while pausing for cache.
    // This must not be reported as a user pause.
    eventListener?.({
      playerId: "player-1",
      generation: 1,
      type: "property",
      name: "paused-for-cache",
      data: true,
    });
    eventListener?.({
      playerId: "player-1",
      generation: 1,
      type: "property",
      name: "pause",
      data: true,
    });
    expect(pauses).toEqual([]);
    expect(loading.at(-1)).toBe(true);

    // Cache recovers: playback resumes automatically.
    eventListener?.({
      playerId: "player-1",
      generation: 1,
      type: "property",
      name: "paused-for-cache",
      data: false,
    });
    eventListener?.({
      playerId: "player-1",
      generation: 1,
      type: "property",
      name: "pause",
      data: false,
    });
    expect(plays.length).toBeGreaterThanOrEqual(2);
    expect(pauses).toEqual([]);
    display.destroy();
  });

  it("queues the app play action across native player creation and load", async () => {
    const commands: Array<{ type: string }> = [];

    (window as any).electronAPI = {
      createLibMpvPlayer: vi.fn().mockResolvedValue("player-1"),
      loadLibMpvSource: vi.fn().mockResolvedValue(true),
      sendLibMpvCommand: vi.fn((_id: string, command: { type: string }) => {
        commands.push(command);
        return Promise.resolve(true);
      }),
      onLibMpvEvent: vi.fn().mockReturnValue(() => undefined),
      onLibMpvLog: vi.fn().mockReturnValue(() => undefined),
    };

    const display = makeLibMpvDisplayInterface();
    display.processContainerElement(makeElement());
    display.load({
      source: {
        type: "mp4",
        url: "http://127.0.0.1/video.mkv",
      } as Source,
      startAt: 0,
      automaticQuality: false,
      preferredQuality: null,
      autoplay: false,
    });
    display.play();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(commands.at(-1)).toEqual({ type: "play" });
    display.destroy();
  });

  it("does not surface the previous source's teardown pause as a user pause", async () => {
    let eventListener:
      | ((event: {
          playerId: string;
          generation: number;
          type: "file-loaded" | "property";
          name?: string;
          data?: unknown;
        }) => void)
      | undefined;
    const plays: number[] = [];
    const pauses: number[] = [];

    (window as any).electronAPI = {
      createLibMpvPlayer: vi.fn().mockResolvedValue("player-1"),
      loadLibMpvSource: vi.fn().mockResolvedValue(true),
      sendLibMpvCommand: vi.fn().mockResolvedValue(true),
      onLibMpvEvent: vi.fn((listener) => {
        eventListener = listener;
        return () => undefined;
      }),
      onLibMpvLog: vi.fn().mockReturnValue(() => undefined),
    };

    const display = makeLibMpvDisplayInterface();
    display.processContainerElement(makeElement());
    display.on("play", () => plays.push(1));
    display.on("pause", () => pauses.push(1));
    display.load({
      source: {
        type: "mp4",
        url: "http://127.0.0.1/video.mkv",
      } as Source,
      startAt: 0,
      automaticQuality: false,
      preferredQuality: null,
      autoplay: false,
    });
    display.play();

    await new Promise((resolve) => setTimeout(resolve, 0));

    // The user pressed play while the new file is still loading. The pause
    // reported here is a leftover from the old source's teardown and must
    // not be surfaced as a user pause.
    eventListener?.({
      playerId: "player-1",
      generation: 1,
      type: "property",
      name: "pause",
      data: true,
    });
    expect(pauses).toEqual([]);

    // The new file loads and playback starts automatically.
    eventListener?.({
      playerId: "player-1",
      generation: 1,
      type: "file-loaded",
    });
    eventListener?.({
      playerId: "player-1",
      generation: 1,
      type: "property",
      name: "pause",
      data: false,
    });
    expect(plays.length).toBeGreaterThan(0);
    expect(pauses).toEqual([]);
    display.destroy();
  });

  it("resets generation when clearing the native player", async () => {
    let eventListener:
      | ((event: {
          playerId: string;
          generation: number;
          type: "property";
          name: string;
          data: unknown;
        }) => void)
      | undefined;
    const durations: number[] = [];
    const createPlayer = vi
      .fn()
      .mockResolvedValueOnce("player-1")
      .mockResolvedValueOnce("player-2");

    (window as any).electronAPI = {
      createLibMpvPlayer: createPlayer,
      loadLibMpvSource: vi.fn().mockResolvedValue(true),
      sendLibMpvCommand: vi.fn().mockResolvedValue(true),
      destroyLibMpvPlayer: vi.fn().mockResolvedValue(true),
      onLibMpvEvent: vi.fn((listener) => {
        eventListener = listener;
        return () => undefined;
      }),
      onLibMpvLog: vi.fn().mockReturnValue(() => undefined),
    };

    const display = makeLibMpvDisplayInterface();
    display.processContainerElement(makeElement());
    display.on("duration", (duration) => durations.push(duration));

    const source = (url: string) => ({ type: "mp4", url }) as Source;
    display.load({
      source: source("https://example.test/first.mkv"),
      startAt: 0,
      automaticQuality: false,
      preferredQuality: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    display.load({
      source: null,
      startAt: 0,
      automaticQuality: false,
      preferredQuality: null,
    });
    display.load({
      source: source("https://example.test/second.mkv"),
      startAt: 0,
      automaticQuality: false,
      preferredQuality: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    eventListener?.({
      playerId: "player-2",
      generation: 1,
      type: "property",
      name: "duration",
      data: 120,
    });

    expect(durations).toEqual([120]);
    expect(createPlayer).toHaveBeenCalledTimes(2);
    display.destroy();
  });

  it("keeps native generation in sync when loads are coalesced", async () => {
    let eventListener:
      | ((event: {
          playerId: string;
          generation: number;
          type: "file-loaded" | "property" | "video-frame";
          name?: string;
          data?: unknown;
        }) => void)
      | undefined;
    const plays: number[] = [];
    const rendered: number[] = [];
    const loading: boolean[] = [];
    let sentGeneration: number | undefined;

    (window as any).electronAPI = {
      createLibMpvPlayer: vi.fn().mockResolvedValue("player-1"),
      loadLibMpvSource: vi.fn(
        (_id: string, request: { generation?: number }) => {
          sentGeneration = request.generation;
          return Promise.resolve(true);
        },
      ),
      sendLibMpvCommand: vi.fn().mockResolvedValue(true),
      onLibMpvEvent: vi.fn((listener) => {
        eventListener = listener;
        return () => undefined;
      }),
      onLibMpvLog: vi.fn().mockReturnValue(() => undefined),
    };

    const display = makeLibMpvDisplayInterface();
    display.processContainerElement(makeElement());
    display.on("loading", (isLoading) => loading.push(isLoading));
    display.on("play", () => plays.push(1));
    display.on("rendered", () => rendered.push(1));

    // Two loads land before the native player exists: the renderer advances
    // its own counter twice while only the latest load reaches the addon.
    // The load request must tag that shared generation so native events stay
    // in sync with the renderer instead of every event being dropped.
    display.load({
      source: { type: "mp4", url: "https://example.test/old.mkv" } as Source,
      startAt: 0,
      automaticQuality: false,
      preferredQuality: null,
    });
    display.load({
      source: { type: "mp4", url: "https://example.test/new.mkv" } as Source,
      startAt: 0,
      automaticQuality: false,
      preferredQuality: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const generation = sentGeneration;
    expect(typeof generation).toBe("number");
    if (typeof generation !== "number") {
      display.destroy();
      return;
    }

    eventListener?.({
      playerId: "player-1",
      generation,
      type: "file-loaded",
    });
    eventListener?.({
      playerId: "player-1",
      generation,
      type: "property",
      name: "pause",
      data: false,
    });
    expect(plays.length).toBeGreaterThan(0);

    eventListener?.({
      playerId: "player-1",
      generation,
      type: "video-frame",
    });
    expect(rendered).toEqual([1]);
    expect(loading.at(-1)).toBe(false);
    display.destroy();
  });

  it("destroys the native player when the source is cleared", async () => {
    const destroyPlayer = vi.fn().mockResolvedValue(true);

    (window as any).electronAPI = {
      createLibMpvPlayer: vi.fn().mockResolvedValue("player-1"),
      loadLibMpvSource: vi.fn().mockResolvedValue(true),
      sendLibMpvCommand: vi.fn().mockResolvedValue(true),
      destroyLibMpvPlayer: destroyPlayer,
      onLibMpvEvent: vi.fn().mockReturnValue(() => undefined),
      onLibMpvLog: vi.fn().mockReturnValue(() => undefined),
    };

    const display = makeLibMpvDisplayInterface();
    display.processContainerElement(makeElement());
    display.load({
      source: {
        type: "mp4",
        url: "https://example.test/video.mkv",
      } as Source,
      startAt: 0,
      automaticQuality: false,
      preferredQuality: null,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    display.load({
      source: null,
      startAt: 0,
      automaticQuality: false,
      preferredQuality: null,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(destroyPlayer).toHaveBeenCalledWith(
      "player-1",
      "display:load-empty-source",
    );
  });

  it("holds time updates until the seek target is reached", async () => {
    let eventListener:
      | ((event: {
          playerId: string;
          generation: number;
          type: "property";
          name: string;
          data: unknown;
        }) => void)
      | undefined;
    const seekCommands: number[] = [];
    const times: number[] = [];

    (window as any).electronAPI = {
      createLibMpvPlayer: vi.fn().mockResolvedValue("player-1"),
      loadLibMpvSource: vi.fn().mockResolvedValue(true),
      sendLibMpvCommand: vi.fn(
        (_id: string, command: { type: string; time?: number }) => {
          if (command.type === "seek") seekCommands.push(command.time ?? -1);
          return Promise.resolve(true);
        },
      ),
      onLibMpvEvent: vi.fn((listener) => {
        eventListener = listener;
        return () => undefined;
      }),
      onLibMpvLog: vi.fn().mockReturnValue(() => undefined),
    };

    const display = makeLibMpvDisplayInterface();
    display.processContainerElement(makeElement());
    display.on("time", (time) => times.push(time));
    display.load({
      source: { type: "mp4", url: "https://example.test/video.mkv" } as Source,
      startAt: 0,
      automaticQuality: false,
      preferredQuality: null,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const timePos = (time: number) =>
      eventListener?.({
        playerId: "player-1",
        generation: 1,
        type: "property",
        name: "time-pos",
        data: time,
      });

    timePos(10);
    expect(times).toEqual([10]);

    // Seek: mpv reports the stale pre-seek position, then settles on target.
    display.setTime(60);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seekCommands).toEqual([60]);
    expect(times).toEqual([10]);

    timePos(10.4);
    expect(times).toEqual([10]);

    timePos(50);
    expect(times).toEqual([10]);

    timePos(60);
    expect(times).toEqual([10, 60]);

    display.destroy();
  });

  it("holds the keyframe backtrack reported right after a seek settles", async () => {
    let eventListener:
      | ((event: {
          playerId: string;
          generation: number;
          type: string;
          name?: string;
          data?: unknown;
        }) => void)
      | undefined;
    const times: number[] = [];
    const seekCommands: number[] = [];

    (window as any).electronAPI = {
      createLibMpvPlayer: vi.fn().mockResolvedValue("player-1"),
      loadLibMpvSource: vi.fn().mockResolvedValue(true),
      sendLibMpvCommand: vi.fn(
        (_id: string, command: { type: string; time?: number }) => {
          if (command.type === "seek") seekCommands.push(command.time ?? -1);
          return Promise.resolve(true);
        },
      ),
      onLibMpvEvent: vi.fn((listener) => {
        eventListener = listener;
        return () => undefined;
      }),
      onLibMpvLog: vi.fn().mockReturnValue(() => undefined),
    };

    const display = makeLibMpvDisplayInterface();
    display.processContainerElement(makeElement());
    display.on("time", (time) => times.push(time));
    display.load({
      source: { type: "mp4", url: "https://example.test/video.mkv" } as Source,
      startAt: 0,
      automaticQuality: false,
      preferredQuality: null,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const timePos = (time: number) =>
      eventListener?.({
        playerId: "player-1",
        generation: 1,
        type: "property",
        name: "time-pos",
        data: time,
      });

    timePos(10);
    expect(times).toEqual([10]);

    display.setTime(60);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The seek target lands.
    timePos(60);
    expect(times).toEqual([10, 60]);

    // mpv then snaps back to the keyframe while frames catch up — the cue
    // at 60 must not blink out.
    timePos(50);
    expect(times).toEqual([10, 60]);

    // Forward flow resumes once playback actually reaches the position.
    timePos(59.8);
    expect(times).toEqual([10, 60, 59.8]);

    display.destroy();
  });

  it("ignores stale backward time updates during normal playback", async () => {
    let eventListener:
      | ((event: {
          playerId: string;
          generation: number;
          type: string;
          name?: string;
          data?: unknown;
        }) => void)
      | undefined;
    const times: number[] = [];

    (window as any).electronAPI = {
      createLibMpvPlayer: vi.fn().mockResolvedValue("player-1"),
      loadLibMpvSource: vi.fn().mockResolvedValue(true),
      sendLibMpvCommand: vi.fn().mockResolvedValue(true),
      onLibMpvEvent: vi.fn((listener) => {
        eventListener = listener;
        return () => undefined;
      }),
      onLibMpvLog: vi.fn().mockReturnValue(() => undefined),
    };

    const display = makeLibMpvDisplayInterface();
    display.processContainerElement(makeElement());
    display.on("time", (time) => times.push(time));
    display.load({
      source: { type: "mp4", url: "https://example.test/video.mkv" } as Source,
      startAt: 0,
      automaticQuality: false,
      preferredQuality: null,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const timePos = (time: number) =>
      eventListener?.({
        playerId: "player-1",
        generation: 1,
        type: "property",
        name: "time-pos",
        data: time,
      });

    timePos(60.2);
    timePos(59);
    expect(times).toEqual([60.2]);

    // A real backward seek still passes through the pending-seek path.
    display.setTime(50);
    await new Promise((resolve) => setTimeout(resolve, 0));
    timePos(50);
    expect(times).toEqual([60.2, 50]);

    display.destroy();
  });

  it("holds time updates during a normal stream cache pause", async () => {
    let eventListener:
      | ((event: {
          playerId: string;
          generation: number;
          type: string;
          name?: string;
          data?: unknown;
        }) => void)
      | undefined;
    const times: number[] = [];

    (window as any).electronAPI = {
      createLibMpvPlayer: vi.fn().mockResolvedValue("player-1"),
      loadLibMpvSource: vi.fn().mockResolvedValue(true),
      sendLibMpvCommand: vi.fn().mockResolvedValue(true),
      onLibMpvEvent: vi.fn((listener) => {
        eventListener = listener;
        return () => undefined;
      }),
      onLibMpvLog: vi.fn().mockReturnValue(() => undefined),
    };

    const display = makeLibMpvDisplayInterface();
    display.processContainerElement(makeElement());
    display.on("time", (time) => times.push(time));
    display.load({
      source: { type: "mp4", url: "https://example.test/video.mkv" } as Source,
      startAt: 0,
      automaticQuality: false,
      preferredQuality: null,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const property = (name: string, data: unknown) =>
      eventListener?.({
        playerId: "player-1",
        generation: 1,
        type: "property",
        name,
        data,
      });

    property("time-pos", 60.2);
    property("paused-for-cache", true);
    property("time-pos", 65);
    expect(times).toEqual([60.2]);

    property("paused-for-cache", false);
    property("time-pos", 60.4);
    expect(times).toEqual([60.2, 60.4]);

    display.destroy();
  });

  it("settles a paused scrub when mpv reports the seek completed", async () => {
    let eventListener:
      | ((event: {
          playerId: string;
          generation: number;
          type: string;
          name?: string;
          data?: unknown;
        }) => void)
      | undefined;
    const times: number[] = [];

    (window as any).electronAPI = {
      createLibMpvPlayer: vi.fn().mockResolvedValue("player-1"),
      loadLibMpvSource: vi.fn().mockResolvedValue(true),
      sendLibMpvCommand: vi.fn().mockResolvedValue(true),
      onLibMpvEvent: vi.fn((listener) => {
        eventListener = listener;
        return () => undefined;
      }),
      onLibMpvLog: vi.fn().mockReturnValue(() => undefined),
    };

    const display = makeLibMpvDisplayInterface();
    display.processContainerElement(makeElement());
    display.on("time", (time) => times.push(time));
    display.load({
      source: { type: "mp4", url: "https://example.test/video.mkv" } as Source,
      startAt: 0,
      automaticQuality: false,
      preferredQuality: null,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const timePos = (time: number) =>
      eventListener?.({
        playerId: "player-1",
        generation: 1,
        type: "property",
        name: "time-pos",
        data: time,
      });

    timePos(10);
    expect(times).toEqual([10]);

    display.setTime(60);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // mpv reports the target early while still seeking — hold it so the
    // cue does not pop in ahead of the picture.
    eventListener?.({
      playerId: "player-1",
      generation: 1,
      type: "property",
      name: "seeking",
      data: true,
    });
    timePos(60);
    expect(times).toEqual([10]);

    // The seek completes while paused; no follow-up time-pos event arrives,
    // so the held position must settle now instead of freezing the time.
    eventListener?.({
      playerId: "player-1",
      generation: 1,
      type: "property",
      name: "seeking",
      data: false,
    });
    expect(times).toEqual([10, 60]);

    display.destroy();
  });

  it("holds the stale time-pos snapshot during the initial load seek", async () => {
    let eventListener:
      | ((event: {
          playerId: string;
          generation: number;
          type: string;
          name?: string;
          data?: unknown;
        }) => void)
      | undefined;
    const times: number[] = [];

    (window as any).electronAPI = {
      createLibMpvPlayer: vi.fn().mockResolvedValue("player-1"),
      loadLibMpvSource: vi.fn().mockResolvedValue(true),
      sendLibMpvCommand: vi.fn().mockResolvedValue(true),
      onLibMpvEvent: vi.fn((listener) => {
        eventListener = listener;
        return () => undefined;
      }),
      onLibMpvLog: vi.fn().mockReturnValue(() => undefined),
    };

    const display = makeLibMpvDisplayInterface();
    display.processContainerElement(makeElement());
    display.on("time", (time) => times.push(time));
    display.load({
      source: { type: "mp4", url: "https://example.test/first.mkv" } as Source,
      startAt: 0,
      automaticQuality: false,
      preferredQuality: null,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const timePos = (time: number, generation: number) =>
      eventListener?.({
        playerId: "player-1",
        generation,
        type: "property",
        name: "time-pos",
        data: time,
      });

    timePos(10, 1);
    expect(times).toEqual([10]);

    // Reload the file at a resume position (store calls setTime before load).
    display.setTime(30);
    display.load({
      source: { type: "mp4", url: "https://example.test/video.mkv" } as Source,
      startAt: 30,
      automaticQuality: false,
      preferredQuality: null,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    // FILE_LOADED property snapshot reports the pre-seek position — the cue
    // at the resume position must not flash before the initial seek lands.
    timePos(0, 2);
    expect(times).toEqual([10]);

    // The native initial seek lands at the resume position.
    timePos(30, 2);
    expect(times).toEqual([10]);

    // Resume UI time is published only after the first visible frame.
    eventListener?.({
      playerId: "player-1",
      generation: 2,
      type: "video-frame",
    });
    expect(times).toEqual([10, 30]);

    display.destroy();
  });
});
