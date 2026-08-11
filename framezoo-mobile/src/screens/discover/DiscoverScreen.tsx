import React, { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { ChoiceChips } from '@/components/navigation';
import {
  AppText,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  Section,
} from '@/components/primitives';
import { MediaRow } from '@/components/media';
import { discoverMedia, getDiscoverGenres } from '@/services/api/metadata';
import { demoMedia } from '@/services/metadata';
import { addonRepository } from '@/services/addons';
import {
  useDiscoverStore,
  type DiscoverCategory,
} from '@/state/discover/store';
import { useAuthStore } from '@/state/auth/store';
import { colors, spacing } from '@/theme';

import type { AddonCatalogItem } from '@/types';
import type { RootStackParamList } from '@/navigation/routeTypes';

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

export function DiscoverScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const category = useDiscoverStore(state => state.category);
  const setCategory = useDiscoverStore(state => state.setCategory);
  const backendUrl = useAuthStore(state => state.backendUrl);
  const isAddonCategory = category === 'addons';
  const [year, setYear] = useState('');
  const [country, setCountry] = useState('');
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
  const query = useQuery({
    queryKey: ['discover', backendUrl, category, year, country],
    queryFn: () => {
      if (isAddonCategory) {
        return Promise.resolve([]);
      }
      if (!backendUrl) {
        return Promise.resolve(
          demoMedia.filter(item => {
            const matchesYear = !year || String(item.year) === year;
            const matchesType =
              category === 'movies'
                ? item.type === 'movie'
                : category === 'tvshows'
                ? item.type === 'show'
                : true;
            return matchesYear && matchesType;
          }),
        );
      }
      return discoverMedia(backendUrl, category, { year, country });
    },
    enabled: !isAddonCategory,
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
    enabled: isAddonCategory,
    staleTime: 30_000,
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
  const items = useMemo(
    () =>
      isAddonCategory ? [...addonMovies, ...addonSeries] : query.data ?? [],
    [addonMovies, addonSeries, isAddonCategory, query.data],
  );
  const isLoading = isAddonCategory ? addonQuery.isLoading : query.isLoading;
  const isError = isAddonCategory ? addonQuery.isError : query.isError;
  const error = isAddonCategory ? addonQuery.error : query.error;
  const refetch = isAddonCategory ? addonQuery.refetch : query.refetch;
  const categoryLabel =
    allCategories.find(item => item.id === category)?.label ??
    (category === 'addons' ? 'Addons' : 'Discover');
  const addonFailures = addonQuery.data?.failures ?? [];

  return (
    <Screen
      scroll
      padded
      scrollKey={`${category}:${year}:${country}`}
      onRefresh={() => {
        refetch().catch(() => undefined);
      }}
      refreshing={
        isAddonCategory ? addonQuery.isRefetching : query.isRefetching
      }
    >
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <AppText variant="heading">Discover</AppText>
          <AppText variant="muted">Find your next watch.</AppText>
        </View>
        <Image
          accessibilityLabel="Framezoo logo"
          resizeMode="contain"
          source={require('../../assets/framezoo-logo.png')}
          style={styles.brand}
        />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categories}
      >
        {allCategories.map(item => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
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
      <View style={styles.filters}>
        <AppText variant="label">Filters</AppText>
        <ScrollView
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          <ChoiceChips
            compact
            options={yearOptions}
            value={year}
            onChange={setYear}
          />
        </ScrollView>
        <ScrollView
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          <ChoiceChips
            compact
            options={countries}
            value={country}
            onChange={setCountry}
          />
        </ScrollView>
      </View>
      {isLoading ? (
        <LoadingState
          label={
            isAddonCategory ? 'Loading addon catalogs...' : 'Loading catalog...'
          }
        />
      ) : null}
      {isError ? (
        <ErrorState
          message={
            error instanceof Error ? error.message : 'Catalog request failed.'
          }
          onRetry={() => refetch().catch(() => undefined)}
        />
      ) : null}
      {!isLoading && !isError && isAddonCategory && !items.length ? (
        <EmptyState
          title="No addon catalogs"
          description={
            addonFailures[0]?.message ??
            'Install an addon that declares a catalog resource to show content here.'
          }
          action="Manage addons"
          onAction={() => navigation.navigate('Addons')}
        />
      ) : null}
      {!isLoading && !isError && !isAddonCategory && !items.length ? (
        <EmptyState
          title="No media found"
          description="Try another category or filter."
        />
      ) : null}
      {!isLoading && !isError && items.length ? (
        <>
          {isAddonCategory ? (
            <>
              {addonMovies.length ? (
                <Section title="Movies from addons">
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.rowContent}
                  >
                    <MediaRow
                      items={addonMovies}
                      onPress={media =>
                        navigation.navigate('Details', {
                          mediaId: media.id,
                          type: media.type,
                        })
                      }
                    />
                  </ScrollView>
                </Section>
              ) : null}
              {addonSeries.length ? (
                <Section title="TV Shows from addons">
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.rowContent}
                  >
                    <MediaRow
                      items={addonSeries}
                      onPress={media =>
                        navigation.navigate('Details', {
                          mediaId: media.id,
                          type: media.type,
                        })
                      }
                      tv
                    />
                  </ScrollView>
                </Section>
              ) : null}
              {addonFailures.length ? (
                <AppText variant="caption" style={styles.addonWarning}>
                  {addonFailures.length} addon catalog request
                  {addonFailures.length === 1 ? '' : 's'} failed.
                </AppText>
              ) : null}
            </>
          ) : (
            <>
              <Section title={categoryLabel}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.rowContent}
                >
                  <MediaRow
                    items={items}
                    onPress={media =>
                      navigation.navigate('Details', {
                        mediaId: media.id,
                        type: media.type,
                      })
                    }
                  />
                </ScrollView>
              </Section>
              <Section title="Continue exploring">
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.rowContent}
                >
                  <MediaRow
                    items={[...items].reverse()}
                    onPress={media =>
                      navigation.navigate('Details', {
                        mediaId: media.id,
                        type: media.type,
                      })
                    }
                  />
                </ScrollView>
              </Section>
            </>
          )}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: spacing.xl,
  },
  headerCopy: { gap: spacing.xs },
  brand: { width: 48, height: 48, marginTop: spacing.xs },
  categories: {
    alignItems: 'center',
    gap: spacing.sm,
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
  filters: { gap: spacing.sm, marginBottom: spacing.xl },
  filterRow: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingRight: spacing.xl,
  },
  rowContent: { paddingRight: spacing.xl },
  addonWarning: {
    color: colors.warning,
    marginTop: -spacing.lg,
    marginBottom: spacing.lg,
  },
});
