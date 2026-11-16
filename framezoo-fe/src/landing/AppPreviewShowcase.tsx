import { useEffect, useMemo, useState } from "react";

import { getConfiguredBackendUrl } from "@/backend/download";

interface AppPreviewShowcaseProps {
  variant: "detail" | "discovery";
  ariaLabel: string;
}

export interface PreviewTmdbItem {
  id: number;
  mediaType: "movie" | "tv";
  title: string;
  overview: string;
  posterPath: string;
  backdropPath: string | null;
  voteAverage: number | null;
  year: string | null;
}

interface RawPreviewTmdbItem {
  id?: unknown;
  media_type?: unknown;
  title?: unknown;
  name?: unknown;
  overview?: unknown;
  poster_path?: unknown;
  backdrop_path?: unknown;
  vote_average?: unknown;
  release_date?: unknown;
  first_air_date?: unknown;
}

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

const PREVIEW_PLACEHOLDERS: PreviewTmdbItem[] = [
  {
    id: 1,
    mediaType: "movie",
    title: "Modular Metadata View",
    overview:
      "Inspect synopses, ratings, cast, and dual-language subtitle tracks before playback.",
    posterPath: "",
    backdropPath: null,
    voteAverage: 8.6,
    year: "TMDB",
  },
  {
    id: 2,
    mediaType: "tv",
    title: "Multi-Source Subtitles",
    overview:
      "Search and align dual subtitles across multiple providers in real time.",
    posterPath: "",
    backdropPath: null,
    voteAverage: 8.4,
    year: "SYNC",
  },
  {
    id: 3,
    mediaType: "movie",
    title: "Addon Catalog Browser",
    overview:
      "Install third-party Stremio-compatible addons to organize your own media libraries.",
    posterPath: "",
    backdropPath: null,
    voteAverage: 8.2,
    year: "ADDON",
  },
  {
    id: 4,
    mediaType: "tv",
    title: "Cross-Device Continuity",
    overview:
      "Keep watch progress, bookmarks, and preferences synchronized across platforms.",
    posterPath: "",
    backdropPath: null,
    voteAverage: 8.5,
    year: "SYNC",
  },
];

export function normalizePreviewTmdbItems(
  payload: unknown,
  limit = 6,
): PreviewTmdbItem[] {
  if (!payload || typeof payload !== "object") return [];
  const results = (payload as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];

  const items: PreviewTmdbItem[] = [];
  const seen = new Set<string>();

  for (const entry of results) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as RawPreviewTmdbItem;
    const id = Number(raw.id);
    const mediaType =
      raw.media_type === "tv"
        ? "tv"
        : raw.media_type === "movie"
          ? "movie"
          : typeof raw.name === "string" && !raw.title
            ? "tv"
            : "movie";
    const title =
      typeof raw.title === "string"
        ? raw.title.trim()
        : typeof raw.name === "string"
          ? raw.name.trim()
          : "";
    const posterPath =
      typeof raw.poster_path === "string" ? raw.poster_path.trim() : "";

    if (!Number.isInteger(id) || id <= 0 || !title || !posterPath) continue;

    const key = `${mediaType}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const rawDate =
      typeof raw.release_date === "string"
        ? raw.release_date
        : typeof raw.first_air_date === "string"
          ? raw.first_air_date
          : "";
    const yearMatch = rawDate.match(/^(\d{4})/);
    const vote = Number(raw.vote_average);

    items.push({
      id,
      mediaType,
      title,
      overview:
        typeof raw.overview === "string" && raw.overview.trim()
          ? raw.overview.trim()
          : "Explore rich title metadata, ratings, and synchronized subtitles from official APIs.",
      posterPath,
      backdropPath:
        typeof raw.backdrop_path === "string" && raw.backdrop_path.trim()
          ? raw.backdrop_path.trim()
          : null,
      voteAverage:
        Number.isFinite(vote) && vote > 0 ? Math.round(vote * 10) / 10 : null,
      year: yearMatch ? yearMatch[1] : null,
    });

    if (items.length >= limit) break;
  }

  return items;
}

export function AppPreviewShowcase({
  variant,
  ariaLabel,
}: AppPreviewShowcaseProps) {
  const backendUrl = getConfiguredBackendUrl();
  const [items, setItems] = useState<PreviewTmdbItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [discoveryFilter, setDiscoveryFilter] = useState<
    "all" | "movie" | "tv"
  >("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [dualSubsEnabled, setDualSubsEnabled] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const endpointPath =
      variant === "detail"
        ? "/api/tmdb/trending/all/day"
        : "/api/tmdb/movie/popular";
    const secondaryPath =
      variant === "discovery" ? "/api/tmdb/tv/popular" : null;

    const resolveUrl = (path: string) =>
      backendUrl ? new URL(path, `${backendUrl}/`).toString() : path;

    const load = async () => {
      try {
        const requests = [
          fetch(resolveUrl(endpointPath), {
            signal: controller.signal,
            headers: { Accept: "application/json" },
          }),
          ...(secondaryPath
            ? [
                fetch(resolveUrl(secondaryPath), {
                  signal: controller.signal,
                  headers: { Accept: "application/json" },
                }),
              ]
            : []),
        ];
        const responses = await Promise.all(requests);
        const payloads = await Promise.all(
          responses.map((res) => (res.ok ? res.json() : null)),
        );
        if (controller.signal.aborted) return;

        const merged = payloads.flatMap((payload) =>
          normalizePreviewTmdbItems(payload, 8),
        );
        const unique: PreviewTmdbItem[] = [];
        const seen = new Set<string>();
        for (const item of merged) {
          const key = `${item.mediaType}:${item.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          unique.push(item);
        }
        if (unique.length > 0) {
          setItems(unique.slice(0, 8));
        }
      } catch {
        // Keep neutral placeholder UI when offline or during SSR.
      }
    };

    void load();
    return () => controller.abort();
  }, [backendUrl, variant]);

  const activeItems = items.length > 0 ? items : PREVIEW_PLACEHOLDERS;
  const selectedItem = activeItems[selectedIndex % activeItems.length];

  const filteredDiscoveryItems = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return activeItems
      .filter((item) =>
        discoveryFilter === "all" ? true : item.mediaType === discoveryFilter,
      )
      .filter((item) =>
        query ? item.title.toLowerCase().includes(query) : true,
      )
      .slice(0, 6);
  }, [activeItems, discoveryFilter, searchTerm]);

  const backdropUrl = selectedItem.backdropPath
    ? `${TMDB_IMAGE_BASE}/w780${selectedItem.backdropPath}`
    : null;
  const posterUrl = selectedItem.posterPath
    ? `${TMDB_IMAGE_BASE}/w342${selectedItem.posterPath}`
    : null;

  return (
    <div className="landing-app-sim" role="region" aria-label={ariaLabel}>
      <div className="landing-app-sim-chrome">
        <div className="landing-app-sim-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="landing-app-sim-brand">
          <img src="/framezoo-app-icon.png" alt="" width="14" height="14" />
          <span>framezoo</span>
        </div>
        <div className="landing-app-sim-pills">
          <span className={variant === "discovery" ? "is-active" : ""}>
            Discover
          </span>
          <span className={variant === "detail" ? "is-active" : ""}>
            Metadata
          </span>
          <span>Addons</span>
        </div>
      </div>

      {variant === "detail" ? (
        <div className="landing-app-sim-detail">
          <div className="landing-app-sim-backdrop">
            {backdropUrl ? (
              <img
                src={backdropUrl}
                alt=""
                loading="lazy"
                className="landing-app-sim-backdrop-img"
              />
            ) : null}
            <div className="landing-app-sim-backdrop-scrim" />
            <div className="landing-app-sim-detail-body">
              <div className="landing-app-sim-poster">
                {posterUrl ? (
                  <img
                    src={posterUrl}
                    alt={selectedItem.title}
                    loading="lazy"
                  />
                ) : (
                  <div className="landing-app-sim-poster-fallback">
                    <span>FZ</span>
                  </div>
                )}
              </div>
              <div className="landing-app-sim-meta">
                <div className="landing-app-sim-badges">
                  <span>
                    {selectedItem.mediaType === "tv" ? "SERIES" : "MOVIE"}
                  </span>
                  {selectedItem.year ? <span>{selectedItem.year}</span> : null}
                  {selectedItem.voteAverage ? (
                    <span>TMDB {selectedItem.voteAverage.toFixed(1)}</span>
                  ) : null}
                </div>
                <h3>{selectedItem.title}</h3>
                <p>{selectedItem.overview}</p>
                <div className="landing-app-sim-actions">
                  <button
                    type="button"
                    className={`landing-app-sim-toggle ${dualSubsEnabled ? "is-on" : ""}`}
                    onClick={() => setDualSubsEnabled((prev) => !prev)}
                  >
                    {dualSubsEnabled
                      ? "Dual Subtitles: EN + VI"
                      : "Subtitle: EN"}
                  </button>
                  <button
                    type="button"
                    className="landing-app-sim-cycle"
                    onClick={() =>
                      setSelectedIndex(
                        (prev) => (prev + 1) % activeItems.length,
                      )
                    }
                  >
                    Next title →
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="landing-app-sim-subbar">
            <div className="landing-app-sim-subline">
              <span className="lang-en">EN</span>
              <p>Frame-accurate subtitle alignment across user addons.</p>
            </div>
            {dualSubsEnabled ? (
              <div className="landing-app-sim-subline">
                <span className="lang-vi">VI</span>
                <p>Phụ đề kép song ngữ mượt mà, căn chỉnh thời gian tức thì.</p>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="landing-app-sim-discovery">
          <div className="landing-app-sim-toolbar">
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search TMDB titles..."
              aria-label="Filter preview titles"
            />
            <div className="landing-app-sim-filters" role="group">
              {(
                [
                  ["all", "All"],
                  ["movie", "Movies"],
                  ["tv", "Series"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={discoveryFilter === id ? "is-active" : ""}
                  onClick={() => setDiscoveryFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="landing-app-sim-grid">
            {(filteredDiscoveryItems.length > 0
              ? filteredDiscoveryItems
              : PREVIEW_PLACEHOLDERS
            ).map((item, index) => (
              <button
                key={`${item.mediaType}:${item.id}:${index}`}
                type="button"
                className={`landing-app-sim-card ${selectedItem.id === item.id ? "is-selected" : ""}`}
                onClick={() => {
                  const found = activeItems.findIndex(
                    (entry) =>
                      entry.id === item.id &&
                      entry.mediaType === item.mediaType,
                  );
                  if (found >= 0) setSelectedIndex(found);
                }}
              >
                <div className="landing-app-sim-card-art">
                  {item.posterPath ? (
                    <img
                      src={`${TMDB_IMAGE_BASE}/w342${item.posterPath}`}
                      alt={item.title}
                      loading="lazy"
                    />
                  ) : (
                    <span>{item.year ?? "FZ"}</span>
                  )}
                </div>
                <strong title={item.title}>{item.title}</strong>
                <small>
                  {item.mediaType === "tv" ? "Series" : "Movie"}
                  {item.year ? ` · ${item.year}` : ""}
                </small>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
