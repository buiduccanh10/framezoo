import { useEffect, useRef, useState } from "react";

import { getConfiguredBackendUrl } from "@/backend/download";
import { ensureGuestToken } from "@/backend/guestAuth";

import type { LandingCopy } from "./i18n";

const TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p";
const TMDB_TRENDING_PATH = "/api/tmdb/trending/all/day";

const FALLBACK_POSTERS = ["/embed-preview-detail.png", "/embed-preview.png"];

const FALLBACK_MOVIES: MovieCard[] = [
  {
    id: 157336,
    mediaType: "movie",
    title: "Interstellar",
    posterPath: null,
  },
  {
    id: 155,
    mediaType: "movie",
    title: "The Dark Knight",
    posterPath: null,
  },
  {
    id: 27205,
    mediaType: "movie",
    title: "Inception",
    posterPath: null,
  },
  {
    id: 603,
    mediaType: "movie",
    title: "The Matrix",
    posterPath: null,
  },
  {
    id: 13,
    mediaType: "movie",
    title: "Forrest Gump",
    posterPath: null,
  },
  {
    id: 680,
    mediaType: "movie",
    title: "Pulp Fiction",
    posterPath: null,
  },
];

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
  posterPath: string | null;
}

function normalizeResult(result: TmdbResult): MovieCard | null {
  const id = Number(result.id);
  const mediaType = result.media_type === "tv" ? "tv" : "movie";
  const title =
    typeof result.title === "string"
      ? result.title.trim()
      : typeof result.name === "string"
        ? result.name.trim()
        : "";

  if (!Number.isInteger(id) || id <= 0 || !title) return null;

  return {
    id,
    mediaType,
    title,
    posterPath:
      typeof result.poster_path === "string" && result.poster_path.trim()
        ? result.poster_path
        : null,
  };
}

export function normalizeTmdbResults(payload: unknown, limit = 10) {
  if (!payload || typeof payload !== "object") return [];

  const results = (payload as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];

  const seen = new Set<string>();
  return results
    .map((result) =>
      result && typeof result === "object"
        ? normalizeResult(result as TmdbResult)
        : null,
    )
    .filter((result): result is MovieCard => {
      if (!result) return false;
      const key = `${result.mediaType}:${result.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function getTmdbEndpoint(backendUrl: string | null) {
  if (!backendUrl) return TMDB_TRENDING_PATH;
  return new URL(TMDB_TRENDING_PATH, `${backendUrl}/`).toString();
}

function getPosterUrl(movie: MovieCard, index: number) {
  return movie.posterPath
    ? `${TMDB_IMAGE_BASE_URL}/w500${movie.posterPath}`
    : FALLBACK_POSTERS[index % FALLBACK_POSTERS.length];
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
  const [movies, setMovies] = useState<MovieCard[]>(FALLBACK_MOVIES);
  const [isLoading, setIsLoading] = useState(true);
  const backendUrl = getConfiguredBackendUrl();

  useEffect(() => {
    const controller = new AbortController();

    const loadMovies = async () => {
      try {
        const guestToken = await ensureGuestToken(backendUrl);
        const headers: Record<string, string> = { Accept: "application/json" };
        if (guestToken) {
          headers.Authorization = `Bearer ${guestToken}`;
        }

        const response = await fetch(getTmdbEndpoint(backendUrl), {
          signal: controller.signal,
          headers,
        });

        if (!response.ok) {
          throw new Error(`TMDB request failed: ${response.status}`);
        }

        const normalizedMovies = normalizeTmdbResults(await response.json());
        if (normalizedMovies.length === 0) {
          throw new Error("TMDB returned no titles");
        }

        setMovies(normalizedMovies);
      } catch {
        if (controller.signal.aborted) return;
        setMovies(FALLBACK_MOVIES);
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    };

    void loadMovies();
    return () => controller.abort();
  }, [backendUrl]);

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
    groupIndex: number,
    className = "",
  ) => {
    return (
      <article
        className={`landing-movie-card${className ? ` ${className}` : ""}`}
        key={`${groupIndex}:${movie.mediaType}:${movie.id}`}
      >
        <div className="landing-movie-poster">
          <img
            src={getPosterUrl(movie, index)}
            alt={`${movie.title} poster`}
            loading={index < 4 ? "eager" : "lazy"}
            onError={(event) => {
              event.currentTarget.src =
                FALLBACK_POSTERS[index % FALLBACK_POSTERS.length];
            }}
          />
          <div className="landing-movie-shade" aria-hidden="true" />
          <div className="landing-movie-card-copy">
            <h3>{movie.title}</h3>
          </div>
        </div>
      </article>
    );
  };

  if (variant === "hero") {
    const sourceMovies = movies.length > 0 ? movies : FALLBACK_MOVIES;
    const mosaicColumns = [0, 1, 2].map((columnIndex) => {
      const columnMovies = Array.from(
        { length: 6 },
        (_, index) =>
          sourceMovies[(index * 2 + columnIndex) % sourceMovies.length],
      );

      return [...columnMovies, ...columnMovies];
    });

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
          <div className="landing-movie-mosaic" aria-hidden="true">
            {mosaicColumns.map((columnMovies, columnIndex) => (
              <div
                className={`landing-movie-mosaic-column landing-movie-mosaic-column-${columnIndex}`}
                key={`mosaic-column-${columnIndex}`}
              >
                <div className="landing-movie-mosaic-track">
                  {columnMovies.map((movie, index) =>
                    renderMovieCard(
                      movie,
                      index % 6,
                      columnIndex * 2 + Math.floor(index / 6),
                      columnIndex === 1 ? "landing-movie-card-featured" : "",
                    ),
                  )}
                </div>
              </div>
            ))}
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
