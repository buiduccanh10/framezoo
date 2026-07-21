import { RefObject, useCallback, useEffect, useRef, useState } from "react";

import { isExtensionActiveCached } from "@/backend/extension/messaging";
import { prepareStream } from "@/backend/extension/streams";
import {
  getCachedMetadata,
  refreshCachedMetadata,
} from "@/backend/helpers/providerApi";
import { getProviders } from "@/backend/providers/providers";
import { loadProviderMetadata } from "@/backend/providers/runtimeMetadata";
import { FullScraperEvents, RunOutput, ScrapeMedia } from "@/lib/providers";
import { getMediaKey } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";
import { usePreferencesStore } from "@/stores/preferences";

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

  const initEvent = useCallback((evt: ScraperEvent<"init">) => {
    setSources(
      evt.sourceIds
        .map((v) => {
          const source = getCachedMetadata().find((s) => s.id === v);
          const out: ScrapingSegment = {
            name: source?.name ?? v,
            id: source?.id ?? v,
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
  }, []);

  const startEvent = useCallback((id: ScraperEvent<"start">) => {
    setSources((s) => {
      if (s[id]) s[id].status = "pending";
      return { ...s };
    });
    setCurrentSource(id);
  }, []);

  const updateEvent = useCallback((evt: ScraperEvent<"update">) => {
    setSources((s) => {
      if (s[evt.id]) {
        s[evt.id].status = evt.status;
        s[evt.id].reason = evt.reason;
        s[evt.id].error = evt.error;
        s[evt.id].percentage = evt.percentage;
      }
      return { ...s };
    });
  }, []);

  const discoverEmbedsEvent = useCallback(
    (evt: ScraperEvent<"discoverEmbeds">) => {
      setSources((s) => {
        evt.embeds.forEach((v) => {
          const source = getCachedMetadata().find(
            (src) => src.id === v.embedScraperId,
          );
          const out: ScrapingSegment = {
            embedId: v.embedScraperId,
            name: source?.name ?? v.embedScraperId,
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
        if (!source) return [...s];
        source.children = evt.embeds.map((v) => v.id);
        return [...s];
      });
    },
    [],
  );

  const startScrape = useCallback(() => {
    setCurrentSource(undefined);
  }, []);

  const getResult = useCallback((output: RunOutput | null) => {
    if (output) {
      setSources((s) => {
        if (s[output.sourceId]) s[output.sourceId].status = "success";
        return { ...s };
      });
    }
    return output;
  }, []);

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
  } = useBaseScrape();

  const lastSuccessfulSource = usePreferencesStore(
    (s) => s.lastSuccessfulSource,
  );

  const preferredEmbedOrder = usePreferencesStore((s) => s.embedOrder);
  const enableEmbedOrder = usePreferencesStore((s) => s.enableEmbedOrder);
  const scrapeGeneration = useRef(0);

  const startScraping = useCallback(
    async (
      media: ScrapeMedia,
      startFromSourceId?: string,
      preferredSourceId?: string,
    ) => {
      const generation = ++scrapeGeneration.current;
      const isCurrentRun = () => generation === scrapeGeneration.current;

      await loadProviderMetadata();
      if (!isCurrentRun()) return null;
      refreshCachedMetadata();

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

      // If we have a last successful source, prioritize it
      // BUT only if we're not resuming from a specific source
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
          init: (event) => {
            if (isCurrentRun()) initEvent(event);
          },
          start: (event) => {
            if (isCurrentRun()) startEvent(event);
          },
          update: (event) => {
            if (isCurrentRun()) updateEvent(event);
          },
          discoverEmbeds: (event) => {
            if (isCurrentRun()) discoverEmbedsEvent(event);
          },
        },
      });
      if (!isCurrentRun()) return null;
      if (output && isExtensionActiveCached())
        await prepareStream(output.stream);
      const result = getResult(output);
      if (output) {
        const remainingSourceIds = filteredSourceOrder.filter(
          (sourceId) => sourceId !== output.sourceId,
        );
        if (remainingSourceIds.length > 0) {
          void providers.warmSources({
            media,
            sourceIds: remainingSourceIds,
          });
        }
      }
      return result;
    },
    [
      initEvent,
      startEvent,
      updateEvent,
      discoverEmbedsEvent,
      getResult,
      startScrape,
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
