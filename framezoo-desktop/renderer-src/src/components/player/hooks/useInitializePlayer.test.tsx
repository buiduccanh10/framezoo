import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLanguageStore } from "@/stores/language";
import type { PlayerMeta } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";

import { useInitializeSource } from "./useInitializePlayer";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/components/player/hooks/useSkipTime", () => ({
  useSkipTime: () => [],
}));

function Harness() {
  useInitializeSource();
  return null;
}

function createMeta(episode: number): PlayerMeta {
  return {
    type: "show",
    title: "Test Show",
    tmdbId: "1405",
    imdbId: "tt0773262",
    releaseYear: 2006,
    season: {
      number: 1,
      tmdbId: "season-1",
      title: "Season 1",
    },
    episode: {
      number: episode,
      tmdbId: `episode-${episode}`,
      title: `Episode ${episode}`,
    },
  };
}

describe("useInitializeSource", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    usePlayerStore.getState().reset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    usePlayerStore.getState().reset();
  });

  it("fetches external subtitles immediately when meta is set, without waiting for source", async () => {
    const addExternalSubtitlesSpy = vi.fn().mockResolvedValue(undefined);
    usePlayerStore.setState({
      addExternalSubtitles: addExternalSubtitlesSpy,
    });

    await act(async () => {
      root.render(<Harness />);
    });

    expect(addExternalSubtitlesSpy).not.toHaveBeenCalled();

    // User enters player or preloadedMeta is set
    await act(async () => {
      usePlayerStore.getState().setMeta(createMeta(1), "sourceSelection");
    });

    // Subtitle fetching should be triggered immediately without any source
    expect(usePlayerStore.getState().source).toBeNull();
    expect(usePlayerStore.getState().sourceId).toBeNull();
    expect(addExternalSubtitlesSpy).toHaveBeenCalledTimes(1);
    expect(addExternalSubtitlesSpy).toHaveBeenCalledWith(undefined);
  });

  it("fetches external subtitles when switching to another episode", async () => {
    const addExternalSubtitlesSpy = vi.fn().mockResolvedValue(undefined);
    usePlayerStore.setState({
      addExternalSubtitles: addExternalSubtitlesSpy,
    });

    await act(async () => {
      usePlayerStore.getState().setMeta(createMeta(1), "sourceSelection");
      root.render(<Harness />);
    });

    expect(addExternalSubtitlesSpy).toHaveBeenCalledTimes(1);

    // Switch to episode 2
    await act(async () => {
      usePlayerStore.getState().setMeta(createMeta(2), "sourceSelection");
    });

    expect(addExternalSubtitlesSpy).toHaveBeenCalledTimes(2);
  });

  it("forces refresh when appLanguage changes with an active mediaKey", async () => {
    const addExternalSubtitlesSpy = vi.fn().mockResolvedValue(undefined);
    usePlayerStore.setState({
      addExternalSubtitles: addExternalSubtitlesSpy,
    });

    await act(async () => {
      usePlayerStore.getState().setMeta(createMeta(1), "sourceSelection");
      root.render(<Harness />);
    });

    expect(addExternalSubtitlesSpy).toHaveBeenCalledTimes(1);

    // Change app language
    await act(async () => {
      useLanguageStore.setState({ language: "vi" });
    });

    expect(addExternalSubtitlesSpy).toHaveBeenCalledTimes(2);
    expect(addExternalSubtitlesSpy).toHaveBeenLastCalledWith(undefined, {
      forceRefresh: true,
    });
  });
});
