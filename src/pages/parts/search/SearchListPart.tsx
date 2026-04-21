import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAsyncFn } from "react-use";

import { searchForMedia } from "@/backend/metadata/search";
import { MWQuery } from "@/backend/metadata/types/mw";
import { ActionPillButton } from "@/components/buttons/ActionPillButton";
import { IconPatch } from "@/components/buttons/IconPatch";
import { Icons } from "@/components/Icon";
import { SectionHeading } from "@/components/layout/SectionHeading";
import { MediaGrid } from "@/components/media/MediaGrid";
import { WatchedMediaCard } from "@/components/media/WatchedMediaCard";
import { useDiscoverOptions } from "@/pages/discover/hooks/useDiscoverMedia";
import { SearchLoadingPart } from "@/pages/parts/search/SearchLoadingPart";
import { MediaItem } from "@/utils/mediaTypes";

const ALL_GENRES_FILTER_ID = "all";

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
}: {
  searchQuery: string;
  onShowDetails?: (media: MediaItem) => void;
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
    if (selectedGenreId === ALL_GENRES_FILTER_ID) {
      return results;
    }

    const selectedGenreNumber = Number(selectedGenreId);
    return results.filter((result) =>
      (result.genreIds ?? []).includes(selectedGenreNumber),
    );
  }, [results, selectedGenreId]);

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

          {genreFilterOptions.length > 0 ? (
            <div className="mb-5">
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
                <button
                  type="button"
                  className={`whitespace-nowrap rounded-full px-4 py-2 text-sm transition-[background,transform] duration-100 hover:scale-105 ${
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
                    className={`whitespace-nowrap rounded-full px-4 py-2 text-sm transition-[background,transform] duration-100 hover:scale-105 ${
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
          ) : null}

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
