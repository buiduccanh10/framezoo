import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Subject, from, of, timer } from "rxjs";
import {
  catchError,
  debounce,
  map as rxMap,
  startWith,
  switchMap,
  tap,
} from "rxjs/operators";

import {
  type AiSearchIntentSummary,
  enrichSearchResults,
  searchForMedia,
  searchForMediaWithAi,
} from "@/backend/metadata/search";
import { ActionPillButton } from "@/components/buttons/ActionPillButton";
import { IconPatch } from "@/components/buttons/IconPatch";
import { Dropdown, OptionItem } from "@/components/form/Dropdown";
import { Icon, Icons } from "@/components/Icon";
import { SectionHeading } from "@/components/layout/SectionHeading";
import { MediaGrid } from "@/components/media/MediaGrid";
import { WatchedMediaCard } from "@/components/media/WatchedMediaCard";
import { useDiscoverOptions } from "@/pages/discover/hooks/useDiscoverMedia";
import { SearchLoadingPart } from "@/pages/parts/search/SearchLoadingPart";
import { MediaItem } from "@/utils/mediaTypes";

const ALL_GENRES_FILTER_ID = "all";

function normalizeCountryCode(value?: string) {
  return value?.trim().toUpperCase() ?? "";
}

function SearchSuffix(props: {
  failed?: boolean;
  errorMessage?: string;
  results?: number;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const icon: Icons = props.failed ? Icons.WARNING : Icons.EYE_SLASH;

  return (
    <div className="mt-40 flex flex-col items-center justify-center space-y-3 text-center">
      <IconPatch
        icon={icon}
        className={`text-xl ${
          props.failed ? "text-red-400" : "text-type-logo"
        }`}
      />

      {/* standard suffix */}
      {!props.failed ? (
        <div>
          {(props.results ?? 0) > 0 ? (
            <>
              <p>{t("home.search.allResults")}</p>
              <ActionPillButton
                className="px-py p-[0.3em] mt-3 rounded-xl text-type-dimmed box-content text-[17px] bg-largeCard-background justify-center items-center"
                onClick={() => navigate("/discover")}
              >
                {t("home.search.discoverMore")}
              </ActionPillButton>
            </>
          ) : (
            <p>{t("home.search.noResults")}</p>
          )}
        </div>
      ) : null}

      {/* Error result */}
      {props.failed ? (
        <div>
          <p>{props.errorMessage || t("home.search.failed")}</p>
        </div>
      ) : null}
    </div>
  );
}

export function SearchListPart({
  searchQuery,
  aiMode = false,
  onShowDetails,
  filterCountry,
  filterYear,
  onCountryChange,
  onYearChange,
  countryOptions,
  yearOptions,
  countryLabel,
  selectedCountryOption,
  selectedYearOption,
}: {
  searchQuery: string;
  aiMode?: boolean;
  onShowDetails?: (media: MediaItem) => void;
  filterCountry?: string;
  filterYear?: string;
  onCountryChange?: (country: string) => void;
  onYearChange?: (year: string) => void;
  countryOptions: OptionItem[];
  yearOptions: OptionItem[];
  countryLabel: string;
  selectedCountryOption: OptionItem;
  selectedYearOption: OptionItem;
}) {
  const { t } = useTranslation();

  const [results, setResults] = useState<MediaItem[]>([]);
  const [aiIntent, setAiIntent] = useState<AiSearchIntentSummary | null>(null);
  const [selectedGenreId, setSelectedGenreId] =
    useState<string>(ALL_GENRES_FILTER_ID);
  const { genres: movieGenres } = useDiscoverOptions("movie");
  const { genres: showGenres } = useDiscoverOptions("tv");
  const genreNameById = useMemo(() => {
    const map = new Map<number, string>();
    [...movieGenres, ...showGenres].forEach((genre) => {
      if (!map.has(genre.id)) {
        map.set(genre.id, genre.name);
      }
    });
    return map;
  }, [movieGenres, showGenres]);

  const availableGenreIds = useMemo(() => {
    return [...new Set(results.flatMap((result) => result.genreIds ?? []))];
  }, [results]);

  const genreFilterOptions = useMemo(
    () =>
      availableGenreIds
        .map((genreId) => ({
          id: genreId.toString(),
          name:
            genreNameById.get(genreId) ??
            t(`tmdb.genres.${genreId}`, {
              defaultValue: `Genre ${genreId}`,
            }),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [availableGenreIds, genreNameById, t],
  );

  const filteredResults = useMemo(() => {
    const selectedGenreNumber =
      selectedGenreId === ALL_GENRES_FILTER_ID ? null : Number(selectedGenreId);
    const normalizedCountry = normalizeCountryCode(filterCountry);
    const normalizedYear = filterYear?.trim() ?? "";

    return results.filter((item) => {
      const matchesGenre =
        selectedGenreNumber === null
          ? true
          : (item.genreIds ?? []).includes(selectedGenreNumber);
      const matchesYear =
        normalizedYear === "" || item.year?.toString() === normalizedYear;
      const matchesCountry =
        normalizedCountry === "" ||
        (item.originCountryCodes ?? []).some(
          (code) => normalizeCountryCode(code) === normalizedCountry,
        );

      return matchesGenre && matchesYear && matchesCountry;
    });
  }, [results, selectedGenreId, filterYear, filterCountry]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Create a persistent Subject for the search query stream
  const [searchSubject] = useState(
    () => new Subject<{ query: string; aiMode: boolean }>(),
  );

  useEffect(() => {
    const sub = searchSubject
      .pipe(
        tap(() => {
          setLoading(true);
          setError(null);
        }),
        debounce((payload) => timer(payload.aiMode ? 750 : 300)),
        switchMap(({ query, aiMode: useAi }) => {
          const trimmed = query.trim();
          if (!trimmed || (useAi && trimmed.length < 2)) {
            setLoading(false);
            return of<{
              items: MediaItem[];
              intent: AiSearchIntentSummary | null;
            }>({ items: [], intent: null });
          }

          if (useAi) {
            return from(searchForMediaWithAi({ searchQuery: trimmed })).pipe(
              switchMap((aiResult) => {
                if (!aiResult.items.length) {
                  return of({ items: [], intent: aiResult.intent });
                }
                return from(
                  enrichSearchResults(
                    { searchQuery: `ai:${trimmed}` },
                    aiResult.items,
                  ),
                ).pipe(
                  rxMap((items) => ({ items, intent: aiResult.intent })),
                  startWith({
                    items: aiResult.items,
                    intent: aiResult.intent,
                  }),
                );
              }),
              catchError((err) => {
                setError(
                  err instanceof Error ? err : new Error("Search failed"),
                );
                return of({ items: [], intent: null });
              }),
            );
          }

          return from(searchForMedia({ searchQuery: query })).pipe(
            switchMap((rawResults) => {
              if (!rawResults || rawResults.length === 0) {
                return of({ items: [], intent: null });
              }
              return from(
                enrichSearchResults({ searchQuery: query }, rawResults),
              ).pipe(
                rxMap((items) => ({ items, intent: null })),
                startWith({ items: rawResults, intent: null }),
              );
            }),
            catchError((err) => {
              setError(err instanceof Error ? err : new Error("Search failed"));
              return of({ items: [], intent: null });
            }),
          );
        }),
      )
      .subscribe(({ items, intent }) => {
        setResults(items);
        setAiIntent(intent);
        setLoading(false);
      });

    return () => {
      sub.unsubscribe();
    };
  }, [searchSubject]);

  useEffect(() => {
    searchSubject.next({ query: searchQuery, aiMode });
  }, [searchQuery, aiMode, searchSubject]);

  useEffect(() => {
    setSelectedGenreId(ALL_GENRES_FILTER_ID);
  }, [searchQuery, aiMode]);

  useEffect(() => {
    if (
      selectedGenreId !== ALL_GENRES_FILTER_ID &&
      !genreFilterOptions.some((option) => option.id === selectedGenreId)
    ) {
      setSelectedGenreId(ALL_GENRES_FILTER_ID);
    }
  }, [genreFilterOptions, selectedGenreId]);

  const errorStatus =
    (error as { statusCode?: number; status?: number } | null)?.statusCode ??
    (error as { status?: number } | null)?.status;
  const errorMessage =
    errorStatus === 429
      ? t("home.search.aiRateLimited", {
          defaultValue:
            "Too many AI searches right now. Please wait a moment and try again.",
        })
      : undefined;

  if (loading) return <SearchLoadingPart />;
  if (error) return <SearchSuffix failed errorMessage={errorMessage} />;
  if (!results) return null;

  return (
    <div>
      <SectionHeading
        title={
          aiMode
            ? t("home.search.aiSectionTitle", {
                defaultValue: "AI search results",
              })
            : t("home.search.sectionTitle")
        }
        icon={aiMode ? Icons.AI_SPARKLES : Icons.SEARCH}
      />

      {aiMode && aiIntent?.summary ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-type-secondary">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-pill-background/60 px-3 py-1 text-type-text">
            <Icon icon={Icons.AI_SPARKLES} className="text-[11px]" />
            <span>{aiIntent.summary}</span>
          </span>
          {aiIntent.originCountries.map((code) => (
            <span
              key={code}
              className="rounded-full bg-pill-background/40 px-2.5 py-1"
            >
              {code}
            </span>
          ))}
          {aiIntent.yearFrom !== null || aiIntent.yearTo !== null ? (
            <span className="rounded-full bg-pill-background/40 px-2.5 py-1">
              {aiIntent.yearFrom ?? "..."} – {aiIntent.yearTo ?? "..."}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="mb-5">
        <div className="relative flex items-center">
          <div className="overflow-x-auto scrollbar-none flex-1 min-w-0">
            <div className="flex items-center gap-2 pb-1">
              <button
                type="button"
                className={`whitespace-nowrap rounded-full px-4 py-2 text-sm transition-[background,transform] duration-100 hover:scale-105 shrink-0 ${
                  selectedGenreId === ALL_GENRES_FILTER_ID
                    ? "bg-type-logo text-white"
                    : "bg-pill-background/60 text-type-secondary hover:bg-pill-backgroundHover"
                }`}
                onClick={() => setSelectedGenreId(ALL_GENRES_FILTER_ID)}
              >
                {t("home.search.genreFilterAll")}
              </button>

              {genreFilterOptions.map((genre) => (
                <button
                  key={genre.id}
                  type="button"
                  className={`whitespace-nowrap rounded-full px-4 py-2 text-sm transition-[background,transform] duration-100 hover:scale-105 shrink-0 ${
                    selectedGenreId === genre.id
                      ? "bg-type-logo text-white"
                      : "bg-pill-background/60 text-type-secondary hover:bg-pill-backgroundHover"
                  }`}
                  onClick={() => setSelectedGenreId(genre.id)}
                >
                  {genre.name}
                </button>
              ))}
            </div>
          </div>

          <div className="sticky right-0 z-10 flex shrink-0 items-center gap-2 bg-transparent pl-3">
            <div className="w-px h-6 bg-white/10 shrink-0" />

            <div className="relative whitespace-nowrap shrink-0">
              <Dropdown
                selectedItem={selectedCountryOption}
                setSelectedItem={(item) => onCountryChange?.(item.id)}
                options={countryOptions}
                className="!my-0"
                customButton={
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-full bg-mediaCard-hoverBackground px-4 py-2 text-sm font-medium text-type-secondary transition-colors hover:bg-mediaCard-background md:text-base"
                  >
                    <span>
                      {filterCountry
                        ? `${countryLabel}: ${selectedCountryOption.name}`
                        : countryLabel}
                    </span>
                    <Icon
                      icon={Icons.UP_DOWN_ARROW}
                      className="text-xs text-dropdown-secondary"
                    />
                  </button>
                }
              />
            </div>

            <div className="relative whitespace-nowrap shrink-0">
              <Dropdown
                selectedItem={selectedYearOption}
                setSelectedItem={(item) => onYearChange?.(item.id)}
                options={yearOptions}
                customButton={
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-full bg-mediaCard-hoverBackground px-4 py-2 text-sm font-medium text-type-secondary transition-colors hover:bg-mediaCard-background md:text-base"
                  >
                    <span>
                      {filterYear
                        ? `${t("home.bookmarks.edit.yearLabel")}: ${filterYear}`
                        : t("home.bookmarks.edit.yearLabel")}
                    </span>
                    <Icon
                      icon={Icons.UP_DOWN_ARROW}
                      className="text-xs text-dropdown-secondary"
                    />
                  </button>
                }
                preventWrap
                className="!my-0"
              />
            </div>
          </div>
        </div>
      </div>

      {filteredResults.length > 0 ? (
        <MediaGrid>
          {filteredResults.map((v) => (
            <WatchedMediaCard
              key={v.id.toString()}
              media={v}
              onShowDetails={onShowDetails}
            />
          ))}
        </MediaGrid>
      ) : null}

      <SearchSuffix results={filteredResults.length} />
    </div>
  );
}
