import { useEffect, useRef, useState } from "react";

import { getConfiguredBackendUrl } from "@/backend/download";
import { ensureGuestToken } from "@/backend/guestAuth";

import type { LandingCopy } from "./i18n";

const TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p";
const TMDB_COLUMN_COUNT = 3;
const TMDB_ITEMS_PER_COLUMN = 6;
const MIN_MOSAIC_ITEMS_PER_COLUMN = 5;

export const TMDB_SHOWCASE_FEEDS = [
  { path: "/api/tmdb/trending/all/day", defaultMediaType: "movie" },
  { path: "/api/tmdb/movie/popular", defaultMediaType: "movie" },
  { path: "/api/tmdb/tv/popular", defaultMediaType: "tv" },
] as const;

interface TmdbResult {
  id?: unknown;
  media_type?: unknown;
  title?: unknown;
  name?: unknown;
  poster_path?: unknown;
}

export interface MovieCard {
  id: number;
  mediaType: "movie" | "tv";
  title: string;
  posterPath: string;
}

function normalizeResult(
  result: TmdbResult,
  defaultMediaType: "movie" | "tv" = "movie",
): MovieCard | null {
  const id = Number(result.id);
  const mediaType =
    result.media_type === "tv"
      ? "tv"
      : result.media_type === "movie"
        ? "movie"
        : defaultMediaType;
  const title =
    typeof result.title === "string"
      ? result.title.trim()
      : typeof result.name === "string"
        ? result.name.trim()
        : "";

  const posterPath =
    typeof result.poster_path === "string" ? result.poster_path.trim() : "";

  if (!Number.isInteger(id) || id <= 0 || !title || !posterPath) return null;

  return {
    id,
    mediaType,
    title,
    posterPath,
  };
}

export function normalizeTmdbResults(
  payload: unknown,
  limit = 18,
  defaultMediaType: "movie" | "tv" = "movie",
) {
  if (!payload || typeof payload !== "object") return [];

  const results = (payload as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];

  const seen = new Set<string>();
  return results
    .map((result) =>
      result && typeof result === "object"
        ? normalizeResult(result as TmdbResult, defaultMediaType)
        : null,
    )
    .filter((result): result is MovieCard => {
      if (!result) return false;
      const key = getMovieKey(result);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

export function partitionMovieColumns(
  movies: MovieCard[],
  columnCount = TMDB_COLUMN_COUNT,
): MovieCard[][] {
  if (columnCount <= 0) return [];

  const columns = Array.from({ length: columnCount }, () => [] as MovieCard[]);
  movies.forEach((movie, index) => {
    columns[index % columnCount]?.push(movie);
  });
  return columns;
}

export function buildTmdbShowcaseColumns(
  payloads: unknown[],
  perColumnLimit = TMDB_ITEMS_PER_COLUMN,
): MovieCard[][] {
  if (perColumnLimit <= 0) {
    return TMDB_SHOWCASE_FEEDS.map(() => []);
  }

  // Normalize each TMDB feed independently with its media type
  const rawColumns = TMDB_SHOWCASE_FEEDS.map((feed, index) =>
    normalizeTmdbResults(
      payloads[index],
      perColumnLimit * TMDB_COLUMN_COUNT,
      feed.defaultMediaType,
    ),
  );

  // Deduplicate across columns so the 3 columns show distinct titles
  const usedKeys = new Set<string>();
  const columns = rawColumns.map((column) => {
    const uniqueColumn: MovieCard[] = [];
    for (const movie of column) {
      const key = getMovieKey(movie);
      if (usedKeys.has(key)) continue;
      usedKeys.add(key);
      uniqueColumn.push(movie);
      if (uniqueColumn.length >= perColumnLimit) break;
    }
    return uniqueColumn;
  });

  // Backfill any empty column from remaining unused pool if one endpoint failed
  const unusedPool = rawColumns
    .flat()
    .filter((movie) => !usedKeys.has(getMovieKey(movie)));

  let poolIndex = 0;
  return columns.map((column) => {
    if (column.length > 0) return column;
    const fallbackColumn: MovieCard[] = [];
    while (
      fallbackColumn.length < perColumnLimit &&
      poolIndex < unusedPool.length
    ) {
      const candidate = unusedPool[poolIndex++];
      const key = getMovieKey(candidate);
      if (usedKeys.has(key)) continue;
      usedKeys.add(key);
      fallbackColumn.push(candidate);
    }
    return fallbackColumn;
  });
}

function getTmdbEndpoint(backendUrl: string | null, path: string) {
  if (!backendUrl) return path;
  return new URL(path, `${backendUrl}/`).toString();
}

function getMovieKey(movie: MovieCard) {
  return `${movie.mediaType}:${movie.id}`;
}

function getPosterUrl(movie: MovieCard) {
  return `${TMDB_IMAGE_BASE_URL}/w500${movie.posterPath}`;
}

const POSTER_PRELOAD_TIMEOUT_MS = 6000;
// Pixels per second for each mosaic column; different speeds avoid a flat grid
const MOSAIC_SPEEDS = [42, 34, 46];
// Initial loop progress per column so columns start visually staggered
const MOSAIC_START_PROGRESS = [0.12, 0.45, 0.28];
const MAX_FRAME_DELTA_MS = 50;
// Hover slows the mosaic to this fraction of its normal speed
const MOSAIC_HOVER_SPEED_FACTOR = 0.25;
const MOSAIC_SPEED_EASE_MS = 300;

function preloadPoster(movie: MovieCard): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();
    const timeoutId = window.setTimeout(
      () => resolve(false),
      POSTER_PRELOAD_TIMEOUT_MS,
    );
    const settle = (ok: boolean) => {
      window.clearTimeout(timeoutId);
      resolve(ok);
    };
    image.onload = () => settle(true);
    image.onerror = () => settle(false);
    image.src = getPosterUrl(movie);
  });
}

// Drop broken posters before render so the loop never reflows mid-animation
async function filterLoadablePosters(columns: MovieCard[][]) {
  return Promise.all(
    columns.map(async (column) => {
      const results = await Promise.all(column.map(preloadPoster));
      return column.filter((_, index) => results[index]);
    }),
  );
}

interface MovieShowcaseSectionProps {
  copy: LandingCopy["movies"];
  variant?: "default" | "hero";
}

export function MovieShowcaseSection({
  copy,
  variant = "default",
}: MovieShowcaseSectionProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const loopRailRef = useRef<HTMLDivElement>(null);
  const mosaicTrackRefs = useRef<(HTMLDivElement | null)[]>([]);
  const mosaicOffsetsRef = useRef<number[]>([]);
  const isMosaicHoveredRef = useRef(false);
  const [movieColumns, setMovieColumns] = useState<MovieCard[][]>(() =>
    TMDB_SHOWCASE_FEEDS.map(() => []),
  );
  const [isLoading, setIsLoading] = useState(true);
  const backendUrl = getConfiguredBackendUrl();
  const movies = movieColumns.flat();

  useEffect(() => {
    const controller = new AbortController();

    const loadMovies = async () => {
      try {
        const guestToken = await ensureGuestToken(backendUrl);
        const headers: Record<string, string> = { Accept: "application/json" };
        if (guestToken) {
          headers.Authorization = `Bearer ${guestToken}`;
        }

        const responses = await Promise.allSettled(
          TMDB_SHOWCASE_FEEDS.map(async (feed) => {
            const response = await fetch(
              getTmdbEndpoint(backendUrl, feed.path),
              {
                signal: controller.signal,
                headers,
              },
            );

            if (!response.ok) {
              throw new Error(`TMDB request failed: ${response.status}`);
            }

            return response.json();
          }),
        );

        if (controller.signal.aborted) return;

        const payloads = responses.map((result) =>
          result.status === "fulfilled" ? result.value : null,
        );
        const nextColumns = await filterLoadablePosters(
          buildTmdbShowcaseColumns(payloads),
        );
        if (controller.signal.aborted) return;

        if (nextColumns.every((column) => column.length === 0)) {
          throw new Error("TMDB returned no titles");
        }

        setMovieColumns(nextColumns);
      } catch {
        if (controller.signal.aborted) return;
        setMovieColumns(TMDB_SHOWCASE_FEEDS.map(() => []));
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    };

    void loadMovies();
    return () => controller.abort();
  }, [backendUrl]);

  useEffect(() => {
    if (variant !== "hero" || isLoading) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frameId = 0;
    let lastTime: number | null = null;
    let speedFactor = 1;
    const offsets = mosaicOffsetsRef.current;

    const step = (time: number) => {
      // Clamp delta so returning from a background tab does not jump
      const delta =
        lastTime === null ? 0 : Math.min(time - lastTime, MAX_FRAME_DELTA_MS);
      lastTime = time;

      // Ease toward the target speed so hover slows down smoothly, not abruptly
      const targetFactor = isMosaicHoveredRef.current
        ? MOSAIC_HOVER_SPEED_FACTOR
        : 1;
      speedFactor +=
        (targetFactor - speedFactor) *
        Math.min(1, delta / MOSAIC_SPEED_EASE_MS);

      mosaicTrackRefs.current.forEach((track, index) => {
        if (!track) return;
        // Track holds two identical halves (incl. trailing gap) → half = loop
        const loopHeight = track.offsetHeight / 2;
        if (loopHeight <= 0) return;

        let offset =
          offsets[index] ?? loopHeight * (MOSAIC_START_PROGRESS[index] ?? 0);
        offset += ((MOSAIC_SPEEDS[index] ?? 40) * speedFactor * delta) / 1000;
        // Modulo against the live height keeps the loop seamless after reflow
        offset %= loopHeight;
        offsets[index] = offset;
        track.style.transform = `translate3d(0, ${-offset}px, 0)`;
      });

      frameId = window.requestAnimationFrame(step);
    };

    frameId = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frameId);
  }, [isLoading, variant]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (variant === "hero" || !viewport || isLoading || movies.length === 0) {
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const normalizeLoopPosition = () => {
      const firstRail = loopRailRef.current;
      const secondRail = firstRail?.nextElementSibling as HTMLElement | null;
      const loopOffset =
        firstRail && secondRail
          ? secondRail.offsetLeft - firstRail.offsetLeft
          : (firstRail?.offsetWidth ?? 0);

      if (loopOffset <= 0) return;
      if (viewport.scrollLeft >= loopOffset) {
        viewport.scrollLeft -= loopOffset;
      } else if (viewport.scrollLeft < 0) {
        viewport.scrollLeft += loopOffset;
      }
    };

    const intervalId = window.setInterval(() => {
      if (document.hidden) return;

      viewport.scrollLeft += 1;
    }, 32);

    viewport.addEventListener("scroll", normalizeLoopPosition, {
      passive: true,
    });

    return () => {
      window.clearInterval(intervalId);
      viewport.removeEventListener("scroll", normalizeLoopPosition);
    };
  }, [isLoading, movies.length, variant]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (variant === "hero" || !viewport || isLoading || movies.length === 0) {
      return;
    }

    let frameId = 0;

    const updateCardPerspective = () => {
      frameId = 0;

      const viewportRect = viewport.getBoundingClientRect();
      const edgeBuffer = viewportRect.width * 0.04;
      const start = viewportRect.left - edgeBuffer;
      const range = viewportRect.width + edgeBuffer * 2;
      const cards = viewport.querySelectorAll<HTMLElement>(
        ".landing-movie-card:not(.landing-movie-card-skeleton)",
      );

      cards.forEach((card) => {
        const cardRect = card.getBoundingClientRect();
        const center = cardRect.left + cardRect.width / 2;
        const progress = Math.max(0, Math.min(1, (center - start) / range));
        const easedProgress = progress * progress * (3 - 2 * progress);
        const scale = 0.64 + easedProgress * 0.48;
        const opacity = 0.2 + easedProgress * 0.8;
        const blur = (1 - easedProgress) * 2.2;
        const brightness = 0.58 + easedProgress * 0.42;
        const saturation = 0.62 + easedProgress * 0.38;

        card.style.setProperty("--movie-scale", scale.toFixed(3));
        card.style.setProperty("--movie-opacity", opacity.toFixed(3));
        card.style.setProperty("--movie-blur", `${blur.toFixed(2)}px`);
        card.style.setProperty("--movie-brightness", brightness.toFixed(3));
        card.style.setProperty("--movie-saturation", saturation.toFixed(3));
      });
    };

    const schedulePerspectiveUpdate = () => {
      if (frameId !== 0) return;
      frameId = window.requestAnimationFrame(updateCardPerspective);
    };

    updateCardPerspective();
    viewport.addEventListener("scroll", schedulePerspectiveUpdate, {
      passive: true,
    });
    window.addEventListener("resize", schedulePerspectiveUpdate);

    return () => {
      viewport.removeEventListener("scroll", schedulePerspectiveUpdate);
      window.removeEventListener("resize", schedulePerspectiveUpdate);
      if (frameId !== 0) window.cancelAnimationFrame(frameId);
    };
  }, [isLoading, movies.length, variant]);

  const renderMovieCard = (
    movie: MovieCard,
    index: number,
    groupIndex: number | string,
    showTitle = true,
  ) => {
    return (
      <article
        className="landing-movie-card"
        key={`${groupIndex}:${movie.mediaType}:${movie.id}`}
      >
        <div className="landing-movie-poster">
          <img
            src={getPosterUrl(movie)}
            alt={`${movie.title} poster`}
            loading={!showTitle || index < 4 ? "eager" : "lazy"}
            decoding="async"
            onError={(event) => {
              // Hide instead of removing from state to avoid a layout jump
              event.currentTarget.style.visibility = "hidden";
            }}
          />
          <div className="landing-movie-shade" aria-hidden="true" />
          {showTitle ? (
            <div className="landing-movie-card-copy">
              <h3>{movie.title}</h3>
            </div>
          ) : null}
        </div>
      </article>
    );
  };

  if (variant === "hero") {
    // Each loop half must be taller than the viewport, otherwise the seam shows
    const columnLength = Math.max(
      ...movieColumns.map((column) => column.length),
      MIN_MOSAIC_ITEMS_PER_COLUMN,
    );
    const mosaicColumns = movieColumns.map((column) =>
      column.length
        ? Array.from(
            { length: columnLength },
            (_, index) => column[index % column.length],
          )
        : [],
    );

    return (
      <section
        className="landing-movies landing-movies-hero"
        id="movies"
        aria-label={copy.title}
      >
        <div className="landing-mosaic-shell">
          <div className="landing-mosaic-label">
            <span className="landing-eyebrow">{copy.eyebrow}</span>
          </div>
          <div
            className="landing-movie-mosaic"
            aria-hidden="true"
            onPointerEnter={() => {
              isMosaicHoveredRef.current = true;
            }}
            onPointerLeave={() => {
              isMosaicHoveredRef.current = false;
            }}
          >
            {mosaicColumns.map((columnMovies, columnIndex) => {
              const loopMovies = [...columnMovies, ...columnMovies];

              return (
                <div
                  className={`landing-movie-mosaic-column landing-movie-mosaic-column-${columnIndex}`}
                  key={`mosaic-column-${columnIndex}`}
                >
                  <div
                    className="landing-movie-mosaic-track"
                    ref={(node) => {
                      mosaicTrackRefs.current[columnIndex] = node;
                    }}
                  >
                    {isLoading
                      ? Array.from({ length: 4 }, (_, index) => (
                          <div
                            className="landing-movie-card landing-movie-card-skeleton"
                            key={`mosaic-skeleton-${columnIndex}-${index}`}
                            aria-hidden="true"
                          />
                        ))
                      : loopMovies.map((movie, index) =>
                          renderMovieCard(
                            movie,
                            index % Math.max(columnMovies.length, 1),
                            `mosaic-${columnIndex}-${index}`,
                            false,
                          ),
                        )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className={`landing-movies landing-movies-${variant}`}
      id="movies"
      aria-label={copy.title}
    >
      <div className="landing-movie-stage">
        <div className="landing-movie-stage-glow" aria-hidden="true" />
        <div ref={viewportRef} className="landing-movie-viewport">
          <div className="landing-movie-track">
            <div className="landing-movie-rail" ref={loopRailRef}>
              {isLoading
                ? Array.from({ length: 6 }, (_, index) => (
                    <div
                      className="landing-movie-card landing-movie-card-skeleton"
                      key={`movie-skeleton-${index}`}
                      aria-hidden="true"
                    />
                  ))
                : movies.map((movie, index) =>
                    renderMovieCard(movie, index, 0),
                  )}
            </div>
            {!isLoading && (
              <div className="landing-movie-rail" aria-hidden="true">
                {movies.map((movie, index) => renderMovieCard(movie, index, 1))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
