import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { NativeSelect } from '@/components/forms';
import {
  AppText,
  EmptyState,
  ErrorState,
  Screen,
  Section,
} from '@/components/primitives';
import { getDiscoverSection, getDiscoverGenres } from '@/services/api/metadata';
import { addonRepository } from '@/services/addons';
import { demoMedia } from '@/services/metadata';
import { useAuthStore } from '@/state/auth/store';
import {
  useDiscoverStore,
  type DiscoverCategory,
} from '@/state/discover/store';
import { useLibraryStore } from '@/state/library/store';
import { colors, spacing } from '@/theme';
import type { AddonCatalogItem } from '@/types';
import type { MediaItem, MediaType } from '@/types/media';
import type { RootStackParamList } from '@/navigation/routeTypes';

import { FeaturedCarousel } from './components/FeaturedCarousel';
import { MediaCarouselSection } from './components/MediaCarouselSection';

const categories: Array<{ id: DiscoverCategory; label: string }> = [
  { id: 'popular', label: 'Popular' },
  { id: 'movies', label: 'Movies' },
  { id: 'tvshows', label: 'TV Shows' },
  { id: 'addons', label: 'Addons' },
];

const countries = [
  { label: 'All countries', value: '' },
  { label: 'US', value: 'US' },
  { label: 'KR', value: 'KR' },
  { label: 'JP', value: 'JP' },
  { label: 'GB', value: 'GB' },
];

type SectionConfig = {
  key: string;
  title: string;
  section: 'trending' | 'popular' | 'topRated' | 'latest' | 'genre';
  mediaType: MediaType;
  genreId?: string;
};

function addonItemToMedia(item: AddonCatalogItem, type: 'movie' | 'series') {
  return {
    id: item.id,
    title: item.name,
    type: type === 'series' ? ('show' as const) : ('movie' as const),
    year: item.year,
    poster: item.poster,
    overview: item.description,
  };
}

function demoSectionItems(
  config: SectionConfig,
  year: string,
): MediaItem[] {
  return demoMedia.filter(item => {
    const typeMatches =
      config.mediaType === 'show' ? item.type === 'show' : item.type === 'movie';
    return typeMatches && (!year || String(item.year) === year);
  });
}

export function DiscoverScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const queryClient = useQueryClient();
  const category = useDiscoverStore(state => state.category);
  const setCategory = useDiscoverStore(state => state.setCategory);
  const backendUrl = useAuthStore(state => state.backendUrl);
  const progress = useLibraryStore(state => state.progress);
  const [year, setYear] = React.useState('');
  const [country, setCountry] = React.useState('');

  const yearOptions = useMemo(
    () => [
      { label: 'Any year', value: '' },
      ...Array.from({ length: 7 }, (_, index) => {
        const value = String(new Date().getFullYear() - index);
        return { label: value, value };
      }),
    ],
    [],
  );

  const genresQuery = useQuery({
    queryKey: ['discover-genres', backendUrl],
    queryFn: () => getDiscoverGenres(backendUrl),
    enabled: Boolean(backendUrl),
    staleTime: 24 * 60 * 60 * 1000,
  });

  const genreCategories = useMemo(
    () =>
      (genresQuery.data ?? []).map(genre => ({
        id: `genre:${genre.id}` as const,
        label: genre.name,
      })),
    [genresQuery.data],
  );
  const allCategories = useMemo(
    () => [...categories, ...genreCategories],
    [genreCategories],
  );

  const sectionConfigs = useMemo<SectionConfig[]>(() => {
    if (category === 'addons') return [];
    if (category === 'popular') {
      return [
        {
          key: 'popular-movies',
          title: 'Popular movies',
          section: 'popular',
          mediaType: 'movie',
        },
        {
          key: 'popular-shows',
          title: 'Popular TV shows',
          section: 'popular',
          mediaType: 'show',
        },
      ];
    }
    if (category === 'movies') {
      return [
        {
          key: 'movies-trending',
          title: 'Trending movies',
          section: 'trending',
          mediaType: 'movie',
        },
        {
          key: 'movies-popular',
          title: 'Popular movies',
          section: 'popular',
          mediaType: 'movie',
        },
        {
          key: 'movies-top-rated',
          title: 'Top rated movies',
          section: 'topRated',
          mediaType: 'movie',
        },
        {
          key: 'movies-latest',
          title: 'Latest releases',
          section: 'latest',
          mediaType: 'movie',
        },
      ];
    }
    if (category === 'tvshows') {
      return [
        {
          key: 'shows-trending',
          title: 'Trending TV shows',
          section: 'trending',
          mediaType: 'show',
        },
        {
          key: 'shows-popular',
          title: 'Popular TV shows',
          section: 'popular',
          mediaType: 'show',
        },
        {
          key: 'shows-top-rated',
          title: 'Top rated TV shows',
          section: 'topRated',
          mediaType: 'show',
        },
        {
          key: 'shows-latest',
          title: 'On the air',
          section: 'latest',
          mediaType: 'show',
        },
      ];
    }

    const genreId = category.slice('genre:'.length);
    const genreTitle =
      genreCategories.find(item => item.id === category)?.label ?? 'Genre';
    return [
      {
        key: `genre:${genreId}`,
        title: `Movies in ${genreTitle}`,
        section: 'genre',
        mediaType: 'movie',
        genreId,
      },
    ];
  }, [category, genreCategories]);

  const sectionQueries = useQueries({
    queries: sectionConfigs.map(config => ({
      queryKey: [
        'discover-section',
        backendUrl,
        config.key,
        year,
        country,
      ],
      queryFn: () =>
        backendUrl
          ? getDiscoverSection(
              backendUrl,
              config.section,
              config.mediaType,
              { year, country },
              config.genreId,
            )
          : Promise.resolve(demoSectionItems(config, year)),
      enabled: category !== 'addons',
      staleTime: 60 * 1000,
    })),
  });

  const addonQuery = useQuery({
    queryKey: ['discover-addon-catalogs'],
    queryFn: async () => {
      const [movies, series] = await Promise.all([
        addonRepository.loadCatalog('movie', 'top'),
        addonRepository.loadCatalog('series', 'top'),
      ]);
      return {
        movies: movies.items.map(item => addonItemToMedia(item, 'movie')),
        series: series.items.map(item => addonItemToMedia(item, 'series')),
        failures: [...movies.failures, ...series.failures],
      };
    },
    staleTime: 30_000,
  });

  const progressItems = useMemo<MediaItem[]>(
    () =>
      progress
        .slice()
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .map(item => ({
          id: item.mediaId,
          title: item.title ?? 'Continue watching',
          type: item.type,
          poster: item.poster,
          year: item.year,
        })),
    [progress],
  );

  const addonMovies = useMemo(
    () =>
      (addonQuery.data?.movies ?? []).filter(
        item => !year || String(item.year) === year,
      ),
    [addonQuery.data?.movies, year],
  );
  const addonSeries = useMemo(
    () =>
      (addonQuery.data?.series ?? []).filter(
        item => !year || String(item.year) === year,
      ),
    [addonQuery.data?.series, year],
  );
  const addonItems = category === 'addons' ? [...addonMovies, ...addonSeries] : [];
  const sectionsLoading = sectionQueries.some(query => query.isLoading);
  const sectionsHaveError = sectionQueries.some(query => query.isError);
  const nativeItems = sectionQueries.flatMap(query => query.data ?? []);
  const hasNativeContent = nativeItems.length > 0 || progressItems.length > 0;
  const hasSuccessfulSection = sectionQueries.some(
    query => (query.data?.length ?? 0) > 0,
  );
  const hasAddonContent = addonMovies.length > 0 || addonSeries.length > 0;

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['discover-featured'] }),
      queryClient.invalidateQueries({ queryKey: ['discover-genres'] }),
      queryClient.invalidateQueries({ queryKey: ['discover-section'] }),
      addonQuery.refetch(),
    ]);
  }

  function showDetails(media: MediaItem) {
    navigation.navigate('Details', { mediaId: media.id, type: media.type });
  }

  function playMedia(media: MediaItem) {
    navigation.navigate('Player', { mediaId: media.id, type: media.type });
  }

  return (
    <Screen
      scroll
      safeAreaTop={false}
      scrollKey={`${category}:${year}:${country}`}
      onRefresh={() => {
        refresh().catch(() => undefined);
      }}
      refreshing={
        addonQuery.isRefetching ||
        sectionQueries.some(query => query.isRefetching)
      }
    >
      <FeaturedCarousel onPlay={playMedia} onShowDetails={showDetails} />

      <View style={styles.content}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categories}
        >
          {allCategories.map(item => (
            <Pressable
              accessibilityRole="button"
              key={item.id}
              onPress={() => setCategory(item.id)}
              style={[
                styles.category,
                category === item.id && styles.categoryActive,
              ]}
            >
              <AppText
                style={
                  category === item.id
                    ? styles.categoryActiveText
                    : styles.categoryText
                }
              >
                {item.label}
              </AppText>
            </Pressable>
          ))}
        </ScrollView>

        {category !== 'addons' ? (
          <View style={styles.filters}>
            <NativeSelect
              label="Year"
              options={yearOptions}
              value={year}
              onChange={setYear}
            />
            <NativeSelect
              label="Country"
              options={countries}
              value={country}
              onChange={setCountry}
            />
          </View>
        ) : null}

        {progressItems.length ? (
          <MediaCarouselSection
            title="Continue watching"
            items={progressItems}
            onPress={showDetails}
          />
        ) : null}

        {sectionsLoading
          ? sectionConfigs.map(config => (
              <MediaCarouselSection
                key={config.key}
                loading
                title={config.title}
                items={[]}
                onPress={showDetails}
              />
            ))
          : null}

        {sectionsHaveError && !hasSuccessfulSection ? (
          <ErrorState
            message="Some Discover sections could not be loaded."
            onRetry={() => {
              sectionQueries.forEach(query => {
                query.refetch().catch(() => undefined);
              });
            }}
          />
        ) : null}

        {!sectionsLoading
          ? sectionConfigs.map((config, index) => (
              <MediaCarouselSection
                key={config.key}
                title={config.title}
                items={sectionQueries[index]?.data ?? []}
                onPress={showDetails}
              />
            ))
          : null}

        {category !== 'popular' && category !== 'addons' && hasAddonContent ? (
          <AddonRows
            movies={addonMovies}
            series={addonSeries}
            onPress={showDetails}
          />
        ) : null}

        {category === 'addons' && addonQuery.isLoading ? (
          <MediaCarouselSection
            loading
            title="Addon catalogs"
            items={[]}
            onPress={showDetails}
          />
        ) : null}

        {category === 'addons' && !addonQuery.isLoading && !hasAddonContent ? (
          <EmptyState
            title="No addon catalogs"
            description={
              addonQuery.data?.failures[0]?.message ??
              'Install an addon that declares a catalog resource to show content here.'
            }
            action="Manage addons"
            onAction={() => navigation.navigate('Addons')}
          />
        ) : null}

        {category !== 'addons' &&
        !sectionsLoading &&
        !sectionsHaveError &&
        !hasNativeContent ? (
          <EmptyState
            title="No media found"
            description="Try another category or filter."
          />
        ) : null}

        {addonQuery.data?.failures.length && category !== 'addons' ? (
          <AppText variant="caption" style={styles.addonWarning}>
            {addonQuery.data.failures.length} addon catalog request
            {addonQuery.data.failures.length === 1 ? '' : 's'} failed.
          </AppText>
        ) : null}

        {category === 'addons' && addonItems.length ? (
          <AppText variant="caption" style={styles.addonWarning}>
            Catalogs are supplied by your installed addons.
          </AppText>
        ) : null}
      </View>
    </Screen>
  );
}

function AddonRows(props: {
  movies: MediaItem[];
  series: MediaItem[];
  onPress: (media: MediaItem) => void;
}) {
  return (
    <>
      {props.movies.length ? (
        <MediaCarouselSection
          badge="Addons"
          title="Movies from addons"
          items={props.movies}
          onPress={props.onPress}
        />
      ) : null}
      {props.series.length ? (
        <MediaCarouselSection
          badge="Addons"
          title="TV shows from addons"
          items={props.series}
          onPress={props.onPress}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: spacing.lg },
  categories: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  category: {
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  categoryActive: { backgroundColor: colors.text, borderColor: colors.text },
  categoryText: { color: colors.textSecondary, fontWeight: '700' },
  categoryActiveText: { color: colors.black, fontWeight: '800' },
  filters: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xl,
  },
  addonWarning: {
    color: colors.warning,
    marginHorizontal: spacing.lg,
    marginTop: -spacing.lg,
    marginBottom: spacing.lg,
  },
});
