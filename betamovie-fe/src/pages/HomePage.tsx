import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useTranslation } from "react-i18next";

import { OptionItem } from "@/components/form/Dropdown";
import { WideContainer } from "@/components/layout/WideContainer";
import { useDebounce } from "@/hooks/useDebounce";
import { useSearchQuery } from "@/hooks/useSearchQuery";
import DiscoverContent from "@/pages/discover/discoverContent";
import { useDiscoverOptions } from "@/pages/discover/hooks/useDiscoverMedia";
import { HomeLayout } from "@/pages/layouts/HomeLayout";
import { HeroPart } from "@/pages/parts/home/HeroPart";
import { SearchListPart } from "@/pages/parts/search/SearchListPart";
import { SearchLoadingPart } from "@/pages/parts/search/SearchLoadingPart";
import { conf } from "@/setup/config";
import { useOverlayStack } from "@/stores/interface/overlayStack";
import { MediaItem } from "@/utils/mediaTypes";

import { AdsPart } from "./parts/home/AdsPart";
import { SupportBar } from "./parts/home/SupportBar";

function useSearch(search: string) {
  const [searching, setSearching] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  const debouncedSearch = useDebounce<string>(search, 500);
  useEffect(() => {
    setSearching(search !== "");
    setLoading(search !== "");
    if (search !== "") {
      window.scrollTo(0, 0);
    }
  }, [search]);
  useEffect(() => {
    setLoading(false);
  }, [debouncedSearch]);

  return {
    loading,
    searching,
  };
}

export function HomePage() {
  const { t } = useTranslation();
  const [showBg, setShowBg] = useState<boolean>(false);
  const searchParams = useSearchQuery();
  const [search] = searchParams;
  const s = useSearch(search);
  const { showModal } = useOverlayStack();
  const [filterCountry, setFilterCountry] = useState("");
  const [filterYear, setFilterYear] = useState("");

  const { countries } = useDiscoverOptions("movie", {
    includeCountries: true,
  });
  const countryLabel = t("discover.filters.country", {
    defaultValue: "Country",
  });
  const countryOptions: OptionItem[] = [
    { id: "", name: countryLabel },
    ...countries,
  ];
  const selectedCountryOption =
    countryOptions.find((o) => o.id === filterCountry) || countryOptions[0];
  const yearOptions: OptionItem[] = (() => {
    const currentYear = new Date().getFullYear();
    return [
      { id: "", name: t("home.bookmarks.edit.yearLabel") },
      ...Array.from({ length: currentYear - 1899 }, (_, i) => {
        const year = (currentYear - i).toString();
        return { id: year, name: year };
      }),
    ];
  })();
  const selectedYearOption =
    yearOptions.find((o) => o.id === filterYear) || yearOptions[0];

  const handleShowDetails = (media: MediaItem) => {
    showModal("details", {
      id: Number(media.id),
      type: media.type === "movie" ? "movie" : "show",
    });
  };

  return (
    <HomeLayout showBg={showBg}>
      <div className="mb-2">
        <Helmet>
          <style type="text/css">{`
            html, body {
              scrollbar-gutter: stable;
            }
          `}</style>
          <title>{t("global.name")}</title>
        </Helmet>

        <HeroPart
          searchParams={searchParams}
          setIsSticky={setShowBg}
          showTitle
        />

        {conf().SHOW_SUPPORT_BAR ? <SupportBar /> : null}

        {conf().SHOW_AD ? <AdsPart /> : null}
      </div>

      {search && (
        <WideContainer>
          {s.loading ? (
            <SearchLoadingPart />
          ) : (
            s.searching && (
              <SearchListPart
                searchQuery={search}
                onShowDetails={handleShowDetails}
                filterCountry={filterCountry}
                filterYear={filterYear}
                onCountryChange={setFilterCountry}
                onYearChange={setFilterYear}
                countryOptions={countryOptions}
                yearOptions={yearOptions}
                countryLabel={countryLabel}
                selectedCountryOption={selectedCountryOption}
                selectedYearOption={selectedYearOption}
              />
            )
          )}
        </WideContainer>
      )}

      {!search && (
        <WideContainer ultraWide classNames="!px-3 md:!px-9">
          <div className="pb-20" />
          <DiscoverContent
            filterCountry={filterCountry}
            filterYear={filterYear}
            onFilterCountryChange={setFilterCountry}
            onFilterYearChange={setFilterYear}
          />
        </WideContainer>
      )}
    </HomeLayout>
  );
}
