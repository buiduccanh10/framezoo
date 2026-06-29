import { RefObject, useCallback, useEffect, useRef, useState } from "react";

import { isExtensionActiveCached } from "@/backend/extension/messaging";
import { prepareStream } from "@/backend/extension/streams";
import { getCachedMetadata } from "@/backend/helpers/providerApi";
import { getProviders } from "@/backend/providers/providers";
import { loadProviderMetadata } from "@/backend/providers/runtimeMetadata";
import { FullScraperEvents, RunOutput, ScrapeMedia } from "@/lib/providers";
import { getMediaKey } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";
import { usePreferencesStore } from "@/stores/preferences";

const SOURCE_TIMEOUT_MS = 15000;

export interface ScrapingItems {
  id: string;
  children: string[];
}

export interface ScrapingSegment {
  name: string;
  id: string;
  embedId?: string;
  status: "failure" | "pending" | "notfound" | "success" | "waiting";
  reason?: string;
  error?: any;
  percentage: number;
}

type ScraperEvent<Event extends keyof FullScraperEvents> = Parameters<
  NonNullable<FullScraperEvents[Event]>
>[0];

function useBaseScrape() {
  const [sources, setSources] = useState<Record<string, ScrapingSegment>>({});
  const [sourceOrder, setSourceOrder] = useState<ScrapingItems[]>([]);
  const [currentSource, setCurrentSource] = useState<string>();
  const [timedOutSource, setTimedOutSource] = useState<string | null>(null);
  const lastId = useRef<string | null>(null);
  const sourceStartTime = useRef<number | null>(null);
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimeoutTimer = useCallback(() => {
    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
  }, []);

  const initEvent = useCallback((evt: ScraperEvent<"init">) => {
    setSources(
      evt.sourceIds
        .map((v) => {
          const source = getCachedMetadata().find((s) => s.id === v);
          if (!source) throw new Error("invalid source id");
          const out: ScrapingSegment = {
            name: source.name,
            id: source.id,
            status: "waiting",
            percentage: 0,
          };
          return out;
        })
        .reduce<Record<string, ScrapingSegment>>((a, v) => {
          a[v.id] = v;
          return a;
        }, {}),
    );
    setSourceOrder(evt.sourceIds.map((v) => ({ id: v, children: [] })));
    setTimedOutSource(null);
  }, []);

  const startEvent = useCallback(
    (id: ScraperEvent<"start">) => {
      const lastIdTmp = lastId.current;
      setSources((s) => {
        if (s[id]) s[id].status = "pending";
        if (lastIdTmp && s[lastIdTmp] && s[lastIdTmp].status === "pending")
          s[lastIdTmp].status = "success";
        return { ...s };
      });
      setCurrentSource(id);
      lastId.current = id;

      clearTimeoutTimer();
      sourceStartTime.current = Date.now();

      timeoutTimerRef.current = setTimeout(() => {
        setSources((s) => {
          if (s[id] && s[id].status === "pending") {
            s[id].status = "failure";
            s[id].reason = "Timeout after 15s";
          }
          return { ...s };
        });
        setTimedOutSource(id);
      }, SOURCE_TIMEOUT_MS);
    },
    [clearTimeoutTimer],
  );

  const updateEvent = useCallback(
    (evt: ScraperEvent<"update">) => {
      if (
        evt.status === "success" ||
        evt.status === "failure" ||
        evt.status === "notfound"
      ) {
        clearTimeoutTimer();
      }

      setSources((s) => {
        if (s[evt.id]) {
          s[evt.id].status = evt.status;
          s[evt.id].reason = evt.reason;
          s[evt.id].error = evt.error;
          s[evt.id].percentage = evt.percentage;
        }
        return { ...s };
      });
    },
    [clearTimeoutTimer],
  );

  const discoverEmbedsEvent = useCallback(
    (evt: ScraperEvent<"discoverEmbeds">) => {
      setSources((s) => {
        evt.embeds.forEach((v) => {
          const source = getCachedMetadata().find(
            (src) => src.id === v.embedScraperId,
          );
          if (!source) throw new Error("invalid source id");
          const out: ScrapingSegment = {
            embedId: v.embedScraperId,
            name: source.name,
            id: v.id,
            status: "waiting",
            percentage: 0,
          };
          s[v.id] = out;
        });
        return { ...s };
      });
      setSourceOrder((s) => {
        const source = s.find((v) => v.id === evt.sourceId);
        if (!source) throw new Error("invalid source id");
        source.children = evt.embeds.map((v) => v.id);
        return [...s];
      });
    },
    [],
  );

  const startScrape = useCallback(() => {
    lastId.current = null;
    sourceStartTime.current = null;
    clearTimeoutTimer();
    setTimedOutSource(null);
  }, [clearTimeoutTimer]);

  const getResult = useCallback(
    (output: RunOutput | null) => {
      clearTimeoutTimer();
      if (output && lastId.current) {
        setSources((s) => {
          if (!lastId.current) return s;
          if (s[lastId.current]) s[lastId.current].status = "success";
          return { ...s };
        });
      }
      return output;
    },
    [clearTimeoutTimer],
  );

  return {
    initEvent,
    startEvent,
    updateEvent,
    discoverEmbedsEvent,
    startScrape,
    getResult,
    sources,
    sourceOrder,
    currentSource,
    timedOutSource,
    clearTimeoutTimer,
  };
}

export function useScrape() {
  const {
    sources,
    sourceOrder,
    currentSource,
    updateEvent,
    discoverEmbedsEvent,
    initEvent,
    getResult,
    startEvent,
    startScrape,
    timedOutSource,
    clearTimeoutTimer,
  } = useBaseScrape();

  const preferredSourceOrder = usePreferencesStore((s) => s.sourceOrder);
  const enableSourceOrder = usePreferencesStore((s) => s.enableSourceOrder);
  const lastSuccessfulSource = usePreferencesStore(
    (s) => s.lastSuccessfulSource,
  );

  const preferredEmbedOrder = usePreferencesStore((s) => s.embedOrder);
  const enableEmbedOrder = usePreferencesStore((s) => s.enableEmbedOrder);

  const startScraping = useCallback(
    async (
      media: ScrapeMedia,
      startFromSourceId?: string,
      preferredSourceId?: string,
    ) => {
      await loadProviderMetadata();

      const providerInstance = getProviders();
      const allSources = providerInstance.listSources();
      const playerState = usePlayerStore.getState();

      // Get media-specific failed sources/embeds
      // Try to get media key from player state first, fallback to deriving from ScrapeMedia
      let mediaKey = getMediaKey(playerState.meta);
      if (!mediaKey) {
        // Derive media key from ScrapeMedia if meta is not set yet
        if (media.type === "movie") {
          mediaKey = `movie-${media.tmdbId}`;
        } else if (media.type === "show" && media.season && media.episode) {
          mediaKey = `show-${media.tmdbId}-${media.season.tmdbId}-${media.episode.tmdbId}`;
        } else if (media.type === "show") {
          mediaKey = `show-${media.tmdbId}`;
        }
      }
      const failedSources = mediaKey
        ? playerState.failedSourcesPerMedia[mediaKey] || []
        : [];
      const failedEmbeds = mediaKey
        ? playerState.failedEmbedsPerMedia[mediaKey] || {}
        : {};

      // Omit failed and globally disabled sources (disabled = UI-only unavailable, no scrape)
      let baseSourceOrder = allSources
        .filter(
          (source) => !failedSources.includes(source.id) && !source.disabled,
        )
        .map((source) => source.id);

      // Apply custom source ordering if enabled
      if (enableSourceOrder && (preferredSourceOrder || []).length > 0) {
        const orderedSources: string[] = [];
        const remainingSources = [...baseSourceOrder];

        // Add sources in preferred order
        for (const sourceId of preferredSourceOrder) {
          const sourceIndex = remainingSources.indexOf(sourceId);
          if (sourceIndex !== -1) {
            orderedSources.push(sourceId);
            remainingSources.splice(sourceIndex, 1);
          }
        }

        // Add remaining sources
        baseSourceOrder = [...orderedSources, ...remainingSources];
      }

      // If we have a last successful source, prioritize it
      // BUT only if we're not resuming from a specific source (to preserve custom order)
      if (lastSuccessfulSource && !startFromSourceId) {
        const lastSourceIndex = baseSourceOrder.indexOf(lastSuccessfulSource);
        if (lastSourceIndex !== -1) {
          baseSourceOrder = [
            lastSuccessfulSource,
            ...baseSourceOrder.filter((id) => id !== lastSuccessfulSource),
          ];
        }
      }

      // If starting from a specific source ID, filter the order to start AFTER that source
      // This preserves the custom order while starting from the next source
      let filteredSourceOrder = baseSourceOrder;
      if (startFromSourceId) {
        const startIndex = filteredSourceOrder.indexOf(startFromSourceId);
        if (startIndex !== -1) {
          filteredSourceOrder = filteredSourceOrder.slice(startIndex + 1);
        }
      }

      // Prefer a specific source first (used for episode-to-episode continuity).
      if (preferredSourceId && !startFromSourceId) {
        const preferredIndex = filteredSourceOrder.indexOf(preferredSourceId);
        if (preferredIndex !== -1) {
          filteredSourceOrder = [
            preferredSourceId,
            ...filteredSourceOrder.filter((id) => id !== preferredSourceId),
          ];
        }
      }

      // Collect all failed embed IDs across all sources for current media
      const allFailedEmbedIds = Object.values(failedEmbeds).flat();

      // Filter out failed embeds from the embed order
      const filteredEmbedOrder = enableEmbedOrder
        ? (preferredEmbedOrder || []).filter(
            (id) => !allFailedEmbedIds.includes(id),
          )
        : undefined;

      startScrape();
      const providers = getProviders();
      const output = await providers.runAll({
        media,
        sourceOrder: filteredSourceOrder,
        embedOrder: filteredEmbedOrder,
        events: {
          init: initEvent,
          start: startEvent,
          update: updateEvent,
          discoverEmbeds: discoverEmbedsEvent,
        },
      });
      if (output && isExtensionActiveCached())
        await prepareStream(output.stream);
      return getResult(output);
    },
    [
      initEvent,
      startEvent,
      updateEvent,
      discoverEmbedsEvent,
      getResult,
      startScrape,
      preferredSourceOrder,
      enableSourceOrder,
      lastSuccessfulSource,
      preferredEmbedOrder,
      enableEmbedOrder,
    ],
  );

  const resumeScraping = useCallback(
    async (media: ScrapeMedia, startFromSourceId: string) => {
      return startScraping(media, startFromSourceId);
    },
    [startScraping],
  );

  return {
    startScraping,
    resumeScraping,
    sourceOrder,
    sources,
    currentSource,
    timedOutSource,
    clearTimeoutTimer,
  };
}

export function useListCenter(
  containerRef: RefObject<HTMLDivElement | null>,
  listRef: RefObject<HTMLDivElement | null>,
  sourceOrder: ScrapingItems[],
  currentSource: string | undefined,
) {
  const [renderedOnce, setRenderedOnce] = useState(false);

  const updatePosition = useCallback(() => {
    if (!containerRef.current) return;
    if (!listRef.current) return;

    const elements = [
      ...listRef.current.querySelectorAll("div[data-source-id]"),
    ] as HTMLDivElement[];

    const currentIndex = elements.findIndex(
      (e) => e.getAttribute("data-source-id") === currentSource,
    );

    const currentElement = elements[currentIndex];

    if (!currentElement) return;

    const containerWidth = containerRef.current.getBoundingClientRect().width;
    const listWidth = listRef.current.getBoundingClientRect().width;

    const containerHeight = containerRef.current.getBoundingClientRect().height;

    const listTop = listRef.current.getBoundingClientRect().top;

    const currentTop = currentElement.getBoundingClientRect().top;
    const currentHeight = currentElement.getBoundingClientRect().height;

    const topDifference = currentTop - listTop;

    const listNewLeft = containerWidth / 2 - listWidth / 2;
    const listNewTop = containerHeight / 2 - topDifference - currentHeight / 2;

    listRef.current.style.transform = `translateY(${listNewTop}px) translateX(${listNewLeft}px)`;
    setTimeout(() => {
      setRenderedOnce(true);
    }, 150);
  }, [currentSource, containerRef, listRef, setRenderedOnce]);

  const updatePositionRef = useRef(updatePosition);

  useEffect(() => {
    updatePosition();
    updatePositionRef.current = updatePosition;
  }, [updatePosition, sourceOrder]);

  useEffect(() => {
    function resize() {
      updatePositionRef.current();
    }
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
    };
  }, []);

  return renderedOnce;
}
