import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Subject, from, of } from "rxjs";
import {
  catchError,
  debounceTime,
  startWith,
  switchMap,
  tap,
} from "rxjs/operators";

import { enrichSearchResults, searchForMedia } from "@/backend/metadata/search";
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

function SearchSuffix(props: { failed?: boolean; results?: number }) {
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
          <p>{t("home.search.failed")}</p>
        </div>
      ) : null}
    </div>
  );
}

export function SearchListPart({
  searchQuery,
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
  const [searchSubject] = useState(() => new Subject<string>());

  useEffect(() => {
    const sub = searchSubject
      .pipe(
        tap(() => {
          setLoading(true);
          setError(null);
        }),
        debounceTime(300),
        switchMap((query) => {
          if (!query) {
            setLoading(false);
            return of([]);
          }
          return from(searchForMedia({ searchQuery: query })).pipe(
            switchMap((rawResults) => {
              if (!rawResults || rawResults.length === 0) return of([]);
              return from(
                enrichSearchResults({ searchQuery: query }, rawResults),
              ).pipe(startWith(rawResults));
            }),
            catchError((err) => {
              setError(err instanceof Error ? err : new Error("Search failed"));
              return of([]);
            }),
          );
        }),
      )
      .subscribe((finalResults) => {
        setResults(finalResults);
        setLoading(false);
      });

    return () => {
      sub.unsubscribe();
    };
  }, [searchSubject]);

  useEffect(() => {
    searchSubject.next(searchQuery);
  }, [searchQuery, searchSubject]);

  useEffect(() => {
    setSelectedGenreId(ALL_GENRES_FILTER_ID);
  }, [searchQuery]);

  useEffect(() => {
    if (
      selectedGenreId !== ALL_GENRES_FILTER_ID &&
      !genreFilterOptions.some((option) => option.id === selectedGenreId)
    ) {
      setSelectedGenreId(ALL_GENRES_FILTER_ID);
    }
  }, [genreFilterOptions, selectedGenreId]);

  if (loading) return <SearchLoadingPart />;
  if (error) return <SearchSuffix failed />;
  if (!results) return null;

  return (
    <div>
      <SectionHeading
        title={t("home.search.sectionTitle")}
        icon={Icons.SEARCH}
      />

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
