import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAsyncFn } from "react-use";

import { searchForMedia } from "@/backend/metadata/search";
import { MWQuery } from "@/backend/metadata/types/mw";
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
  const [state, exec] = useAsyncFn((query: MWQuery) => searchForMedia(query));

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

  useEffect(() => {
    async function runSearch(query: MWQuery) {
      const searchResults = await exec(query);
      if (!searchResults) return;
      setResults(searchResults);
    }

    if (searchQuery !== "") runSearch({ searchQuery });
  }, [searchQuery, exec]);

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

  if (state.loading) return <SearchLoadingPart />;
  if (state.error) return <SearchSuffix failed />;
  if (!results) return null;

  return (
    <div>
      {filteredResults.length > 0 ? (
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

          <MediaGrid>
            {filteredResults.map((v) => (
              <WatchedMediaCard
                key={v.id.toString()}
                media={v}
                onShowDetails={onShowDetails}
              />
            ))}
          </MediaGrid>
        </div>
      ) : null}

      <SearchSuffix results={filteredResults.length} />
    </div>
  );
}
