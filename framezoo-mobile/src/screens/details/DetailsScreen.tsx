import React, { useEffect, useMemo, useState } from 'react';
import {
  Image,
  Linking,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';

import { NativeSelect } from '@/components/forms';
import {
  ExternalRatings,
  MediaRow,
  PlatformBadge,
  Poster,
} from '@/components/media';
import { PlatformIcon, type PlatformIconName } from '@/components/navigation';
import {
  AppText,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  Section,
} from '@/components/primitives';
import {
  getExternalRatings,
  getMediaDetails,
  getNetworkContent,
  getSeasonDetails,
  getSimilarMedia,
} from '@/services/api/metadata';
import { deleteBookmark, saveBookmark } from '@/services/account';
import { demoMedia } from '@/services/metadata';
import { useAuthStore } from '@/state/auth/store';
import { useLibraryStore } from '@/state/library/store';
import { useDeviceMode } from '@/platform/DeviceModeContext';
import { colors, radius, spacing } from '@/theme';
import type { MediaDetails } from '@/types';
import { getImageTone } from '@/utils/imageContrast';

import type { RootStackParamList } from '@/navigation/routeTypes';

function demoDetails(id: string, type: 'movie' | 'show'): MediaDetails {
  const media =
    demoMedia.find(item => item.id === id) ??
    demoMedia.find(item => item.type === type) ??
    demoMedia[0];
  return {
    ...media,
    genres: ['Drama', 'Adventure'],
    runtime: 128,
    language: 'en',
    director: 'Framezoo Studio',
    actors: ['Lead performer', 'Supporting performer'],
    seasons:
      media.type === 'show'
        ? [
            {
              id: 'season-1',
              number: 1,
              title: 'Season 1',
              episodeCount: 2,
              episodes: [
                {
                  id: 'episode-1',
                  number: 1,
                  title: 'Pilot',
                  overview: 'The story begins.',
                  airDate: '2026-01-01',
                },
                {
                  id: 'episode-2',
                  number: 2,
                  title: 'Second Signal',
                  overview: 'A new clue appears.',
                  airDate: '2026-01-08',
                },
              ],
            },
          ]
        : undefined,
    cast: [
      {
        id: 'director-1',
        name: 'Framezoo Studio',
        character: 'Director',
      },
      {
        id: 'person-1',
        name: 'Lead performer',
        character: 'Main character',
      },
      {
        id: 'person-2',
        name: 'Supporting performer',
        character: 'Supporting character',
      },
    ],
    trailers: [],
    similar: demoMedia.filter(item => item.id !== media.id),
  };
}

function formatDate(value?: string) {
  if (!value) return undefined;
  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatRuntime(minutes?: number) {
  if (!minutes) return undefined;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours}h ${remainder}m` : `${remainder}m`;
}

function formatEndTime(minutes?: number) {
  if (!minutes) return undefined;
  const endTime = new Date(Date.now() + minutes * 60 * 1000);
  return endTime.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getDetailsHeroHeight(width: number, height: number, isTV: boolean) {
  return isTV
    ? Math.max(560, Math.round(width * 0.56))
    : Math.max(460, Math.min(560, Math.round(height * 0.52) + 32));
}

function compactCount(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function ActionIcon(props: {
  icon: PlatformIconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled}
      onPress={props.onPress}
      style={[styles.iconAction, props.disabled && styles.disabled]}
    >
      <PlatformIcon color={colors.text} focused name={props.icon} size={19} />
      <AppText style={styles.iconActionLabel}>{props.label}</AppText>
    </Pressable>
  );
}

export function DetailsScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'Details'>>();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const backendUrl = useAuthStore(state => state.backendUrl);
  const account = useAuthStore(state => state.account);
  const { isTV } = useDeviceMode();
  const { width, height } = useWindowDimensions();
  const bookmarks = useLibraryStore(state => state.bookmarks);
  const progress = useLibraryStore(state => state.progress);
  const addBookmark = useLibraryStore(state => state.addBookmark);
  const removeBookmark = useLibraryStore(state => state.removeBookmark);
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const [bookmarkError, setBookmarkError] = useState('');
  const [selectedSeason, setSelectedSeason] = useState<number>();
  const [heroTextColor, setHeroTextColor] = useState<string>(colors.text);
  const [heroMutedColor, setHeroMutedColor] = useState<string>(
    colors.textDimmed,
  );

  const detailsQuery = useQuery({
    queryKey: ['details', backendUrl, route.params.mediaId, route.params.type],
    queryFn: () =>
      backendUrl
        ? getMediaDetails(backendUrl, route.params.mediaId, route.params.type)
        : Promise.resolve(demoDetails(route.params.mediaId, route.params.type)),
  });
  const media = detailsQuery.data;
  const defaultSeason =
    media?.seasons?.find(season => season.number > 0)?.number ??
    media?.seasons?.[0]?.number ??
    1;
  const seasonNumber = selectedSeason ?? defaultSeason;
  const selectedSeasonMeta = media?.seasons?.find(
    season => season.number === seasonNumber,
  );
  const seasonQuery = useQuery({
    queryKey: ['details-season', backendUrl, media?.id, seasonNumber],
    enabled: Boolean(
      backendUrl && media?.type === 'show' && selectedSeasonMeta,
    ),
    queryFn: () =>
      getSeasonDetails(backendUrl as string, media?.id as string, seasonNumber),
    staleTime: 60 * 60 * 1000,
  });
  const episodes = seasonQuery.data ?? selectedSeasonMeta?.episodes ?? [];
  const ratingsQuery = useQuery({
    queryKey: [
      'details-ratings',
      backendUrl,
      media?.type,
      media?.id,
      media?.imdbId,
      media?.title,
      media?.year,
    ],
    enabled: Boolean(backendUrl && media),
    queryFn: () =>
      getExternalRatings(backendUrl as string, media as MediaDetails),
    staleTime: 6 * 60 * 60 * 1000,
  });
  const networkQuery = useQuery({
    queryKey: ['details-network', backendUrl, media?.type, media?.id],
    enabled: Boolean(backendUrl && media),
    queryFn: () =>
      getNetworkContent(
        backendUrl as string,
        media?.id as string,
        media?.type as 'movie' | 'show',
      ),
    staleTime: 24 * 60 * 60 * 1000,
  });
  const similarQuery = useQuery({
    queryKey: ['details-similar', backendUrl, media?.type, media?.id],
    enabled: Boolean(backendUrl && media),
    queryFn: () =>
      getSimilarMedia(
        backendUrl as string,
        media?.id as string,
        media?.type as 'movie' | 'show',
      ),
    staleTime: 24 * 60 * 60 * 1000,
  });
  const trailerItems = useMemo(() => {
    if (!media) return [];

    const items = [...(media.trailers ?? [])];
    const imdbTrailer = ratingsQuery.data?.imdb;
    if (
      imdbTrailer?.trailerUrl &&
      !items.some(item => item.url === imdbTrailer.trailerUrl)
    ) {
      items.unshift({
        id: 'imdb-trailer',
        title: `${media.title} IMDb trailer`,
        url: imdbTrailer.trailerUrl,
        thumbnail: imdbTrailer.trailerThumbnail,
      });
    }
    return items;
  }, [media, ratingsQuery.data?.imdb]);

  useEffect(() => {
    if (media?.seasons?.length && selectedSeason === undefined) {
      setSelectedSeason(
        media.seasons.find(season => season.number > 0)?.number ??
          media.seasons[0].number,
      );
    }
  }, [media, selectedSeason]);

  useEffect(() => {
    let cancelled = false;

    if (!media?.backdrop) {
      setHeroTextColor(colors.text);
      setHeroMutedColor(colors.textDimmed);
      return () => {
        cancelled = true;
      };
    }

    getImageTone(media.backdrop)
      .then(tone => {
        if (cancelled) return;
        const isLight = tone === 'light';
        setHeroTextColor(isLight ? colors.black : colors.text);
        setHeroMutedColor(isLight ? '#3d3d3d' : colors.textDimmed);
      })
      .catch(() => {
        if (!cancelled) {
          setHeroTextColor(colors.text);
          setHeroMutedColor(colors.textDimmed);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [media?.backdrop]);

  const progressEntry = useMemo(
    () =>
      media
        ? progress.find(
            item => item.mediaId === media.id && item.type === media.type,
          )
        : undefined,
    [media, progress],
  );
  const isBookmarked = Boolean(
    media &&
      bookmarks.some(
        item => item.mediaId === media.id && item.type === media.type,
      ),
  );
  const firstEpisode = episodes[0];
  const playSeason =
    media?.type === 'show' ? progressEntry?.season ?? seasonNumber : undefined;
  const playEpisode =
    media?.type === 'show'
      ? progressEntry?.episode ?? firstEpisode?.number
      : undefined;
  const playLabel =
    media?.type === 'show' &&
    progressEntry?.season != null &&
    progressEntry.episode != null
      ? `Resume S${progressEntry.season}:E${progressEntry.episode}`
      : progressEntry
      ? 'Resume'
      : 'Play';

  async function handleBookmark() {
    if (!account) {
      navigation.navigate('Auth');
      return;
    }
    if (!media || !backendUrl) return;

    setBookmarkBusy(true);
    setBookmarkError('');
    const entry = {
      mediaId: media.id,
      type: media.type,
      title: media.title,
      poster: media.poster,
      createdAt: Date.now(),
    };
    try {
      if (isBookmarked) {
        await deleteBookmark(backendUrl, account, media.id);
        removeBookmark(media.id);
      } else {
        await saveBookmark(backendUrl, account, entry);
        addBookmark(entry);
      }
    } catch (cause) {
      setBookmarkError(
        cause instanceof Error ? cause.message : 'Could not update bookmark.',
      );
    } finally {
      setBookmarkBusy(false);
    }
  }

  function handlePlay(season?: number, episode?: number) {
    if (!media) return;
    navigation.navigate('Player', {
      mediaId: media.id,
      type: media.type,
      season: season ?? playSeason,
      episode: episode ?? playEpisode,
    });
  }

  function handleShare() {
    if (!media) return;
    Share.share({
      title: media.title,
      message: `${media.title}${media.year ? ` (${media.year})` : ''}`,
    }).catch(() => undefined);
  }

  function handleCollection() {
    if (!media?.collection) return;
    Linking.openURL(
      `https://www.themoviedb.org/collection/${media.collection.id}`,
    ).catch(() => undefined);
  }

  if (detailsQuery.isLoading) {
    return <LoadingState label="Loading details..." />;
  }
  if (detailsQuery.isError) {
    return (
      <ErrorState
        message={
          detailsQuery.error instanceof Error
            ? detailsQuery.error.message
            : 'Details request failed.'
        }
        onRetry={() => detailsQuery.refetch().catch(() => undefined)}
      />
    );
  }
  if (!media) return <EmptyState title="Media not found" />;

  const seasonOptions =
    media.seasons?.map(season => ({
      label: `${season.title}${
        season.episodeCount ? ` (${season.episodeCount})` : ''
      }`,
      value: String(season.number),
    })) ?? [];

  return (
    <Screen scroll safeAreaTop={false}>
      <View
        style={[
          styles.backdropHero,
          { height: getDetailsHeroHeight(width, height, isTV) },
        ]}
      >
        {media.backdrop ? (
          <Image
            accessibilityLabel={media.title}
            resizeMode="cover"
            source={{ uri: media.backdrop }}
            style={styles.backdrop}
          />
        ) : null}
        <View style={styles.heroOverlay}>
          <View style={styles.header}>
            <Poster
              uri={media.poster}
              title={media.title}
              width={isTV ? 180 : 120}
              height={isTV ? 270 : 180}
            />
            <View style={styles.headerCopy}>
              {media.logo ? (
                <Image
                  accessibilityLabel={`${media.title} logo`}
                  resizeMode="contain"
                  source={{ uri: media.logo }}
                  style={styles.logo}
                />
              ) : (
                <AppText variant="hero" style={styles.headerTitle}>
                  {media.title}
                </AppText>
              )}
              <View style={styles.ratingsLine}>
                <PlatformBadge
                  provider={networkQuery.data?.platforms?.[0]}
                  size={30}
                />
                <ExternalRatings
                  loading={ratingsQuery.isLoading}
                  ratings={ratingsQuery.data}
                  tmdbRating={media.rating}
                  tmdbVotes={media.voteCount}
                  compact
                  mutedColor={heroMutedColor}
                  valueColor={heroTextColor}
                />
              </View>
              <AppText variant="muted" style={{ color: heroTextColor }}>
                {[media.type === 'show' ? 'Series' : 'Movie', media.year]
                  .filter(Boolean)
                  .join('  •  ')}
              </AppText>
              <View style={styles.headerMeta}>
                {media.releaseDate ? (
                  <AppText
                    variant="caption"
                    style={[styles.metaText, { color: heroMutedColor }]}
                  >
                    {formatDate(media.releaseDate)}
                  </AppText>
                ) : null}
                {media.numberOfSeasons ? (
                  <AppText
                    variant="caption"
                    style={[styles.metaText, { color: heroMutedColor }]}
                  >
                    • {media.numberOfSeasons}{' '}
                    {media.numberOfSeasons === 1 ? 'season' : 'seasons'}
                  </AppText>
                ) : null}
              </View>
            </View>
          </View>
          <View style={[styles.actions, styles.heroActions]}>
            <Button label={playLabel} onPress={() => handlePlay()} />
            <ActionIcon
              icon="bookmark"
              label={isBookmarked ? 'Saved' : 'Save'}
              onPress={() => handleBookmark().catch(() => undefined)}
              disabled={bookmarkBusy}
            />
            <ActionIcon icon="share" label="Share" onPress={handleShare} />
          </View>
        </View>
      </View>

      <View style={styles.body}>
        {bookmarkError ? (
          <AppText style={styles.error}>{bookmarkError}</AppText>
        ) : null}

        {media.overview ? (
          <AppText style={styles.overview}>{media.overview}</AppText>
        ) : null}

        {media.genres?.length ? (
          <View style={styles.genres}>
            {media.genres.map(genre => (
              <View key={genre} style={styles.genre}>
                <AppText variant="caption" style={styles.genreText}>
                  {genre}
                </AppText>
              </View>
            ))}
          </View>
        ) : null}

        <Section title="Details" showTitle={false}>
          <View style={styles.infoCard}>
            {formatRuntime(media.runtime) ? (
              <InfoRow
                label="Runtime"
                value={formatRuntime(media.runtime) as string}
              />
            ) : null}
            {media.type === 'movie' && media.runtime ? (
              <InfoRow
                label="Ends at"
                value={formatEndTime(media.runtime) as string}
              />
            ) : null}
            {media.language ? (
              <InfoRow label="Language" value={media.language.toUpperCase()} />
            ) : null}
            {media.releaseDate ? (
              <InfoRow
                label="Release date"
                value={formatDate(media.releaseDate) as string}
              />
            ) : null}
            {typeof media.rating === 'number' ? (
              <InfoRow
                label="TMDB rating"
                value={`${media.rating.toFixed(1)}${
                  typeof media.voteCount === 'number'
                    ? ` (${compactCount(media.voteCount)})`
                    : ''
                }`}
              />
            ) : null}
            {media.imdbId ? (
              <InfoRow label="IMDb ID" value={media.imdbId} />
            ) : null}
            <InfoRow label="TMDB ID" value={media.id} />
            {media.collection && media.type === 'movie' ? (
              <Pressable
                accessibilityRole="button"
                onPress={handleCollection}
                style={styles.collectionButton}
              >
                <PlatformIcon
                  color={colors.textDimmed}
                  name="library"
                  size={20}
                />
                <View style={styles.collectionCopy}>
                  <AppText variant="caption" style={styles.infoLabel}>
                    Collection
                  </AppText>
                  <AppText numberOfLines={2} style={styles.collectionName}>
                    {media.collection.name}
                  </AppText>
                </View>
                <PlatformIcon
                  color={colors.textDimmed}
                  name="chevronRight"
                  size={18}
                />
              </Pressable>
            ) : null}
          </View>
        </Section>

        {media.type === 'show' && seasonOptions.length ? (
          <Section title="Episodes">
            <NativeSelect
              label="Season"
              options={seasonOptions}
              value={String(seasonNumber)}
              onChange={value => setSelectedSeason(Number(value))}
            />
            {seasonQuery.isLoading ? (
              <LoadingState label="Loading episodes..." />
            ) : episodes.length ? (
              <View style={styles.episodes}>
                {episodes.map(episode => (
                  <View key={episode.id} style={styles.episode}>
                    {episode.stillPath ? (
                      <Poster
                        uri={episode.stillPath}
                        title={episode.title}
                        width={128}
                        height={72}
                      />
                    ) : (
                      <View style={styles.episodeNumber}>
                        <AppText style={styles.episodeNumberText}>
                          {episode.number}
                        </AppText>
                      </View>
                    )}
                    <View style={styles.episodeCopy}>
                      <AppText variant="label" numberOfLines={2}>
                        E{episode.number} · {episode.title}
                      </AppText>
                      {episode.airDate ? (
                        <AppText variant="caption">
                          {formatDate(episode.airDate)}
                        </AppText>
                      ) : null}
                      {episode.overview ? (
                        <AppText variant="caption" numberOfLines={2}>
                          {episode.overview}
                        </AppText>
                      ) : null}
                    </View>
                    <Button
                      compact
                      label={
                        progressEntry?.season === seasonNumber &&
                        progressEntry.episode === episode.number
                          ? 'Resume'
                          : 'Play'
                      }
                      onPress={() => handlePlay(seasonNumber, episode.number)}
                    />
                  </View>
                ))}
              </View>
            ) : (
              <EmptyState
                title="No episodes"
                description="Episode data is not available for this season."
              />
            )}
          </Section>
        ) : null}

        {media.cast?.length ? (
          <Section title="Cast" showTitle={false}>
            <ScrollView
              contentContainerStyle={styles.people}
              horizontal
              showsHorizontalScrollIndicator={false}
            >
              {media.cast.map(person => (
                <View key={person.id} style={styles.person}>
                  <Poster
                    uri={person.image}
                    title={person.name}
                    width={82}
                    height={108}
                  />
                  <AppText numberOfLines={2} style={styles.personName}>
                    {person.name}
                  </AppText>
                  {person.character ? (
                    <AppText variant="caption" numberOfLines={2}>
                      {person.character}
                    </AppText>
                  ) : null}
                </View>
              ))}
            </ScrollView>
          </Section>
        ) : null}

        {trailerItems.length ? (
          <Section title="Trailers">
            <ScrollView
              contentContainerStyle={styles.trailers}
              horizontal
              showsHorizontalScrollIndicator={false}
            >
              {trailerItems.map(trailer => (
                <Pressable
                  accessibilityRole="button"
                  key={trailer.id}
                  onPress={() =>
                    Linking.openURL(trailer.url).catch(() => undefined)
                  }
                  style={styles.trailer}
                >
                  <Poster
                    uri={trailer.thumbnail}
                    title={trailer.title}
                    width={220}
                    height={124}
                  />
                  <AppText numberOfLines={2} style={styles.personName}>
                    {trailer.title}
                  </AppText>
                </Pressable>
              ))}
            </ScrollView>
          </Section>
        ) : null}

        {similarQuery.isLoading ||
        similarQuery.data?.length ||
        media.similar?.length ? (
          <Section title="Similar">
            {similarQuery.isLoading ? (
              <LoadingState label="Loading similar media..." />
            ) : (
              <ScrollView
                contentContainerStyle={styles.similar}
                horizontal
                showsHorizontalScrollIndicator={false}
              >
                <MediaRow
                  items={similarQuery.data ?? media.similar ?? []}
                  onPress={item =>
                    navigation.push('Details', {
                      mediaId: item.id,
                      type: item.type,
                    })
                  }
                />
              </ScrollView>
            )}
          </Section>
        ) : null}
      </View>
    </Screen>
  );
}

function InfoRow(props: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <AppText variant="caption" style={styles.infoLabel}>
        {props.label}
      </AppText>
      <AppText variant="caption" style={styles.infoValue}>
        {props.value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  backdropHero: {
    width: '100%',
    justifyContent: 'flex-end',
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: '100%',
    height: '100%',
  },
  heroOverlay: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  logo: { width: '60%', height: 60, alignSelf: 'flex-start' },
  headerTitle: { maxWidth: '100%' },
  body: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.lg,
  },
  headerCopy: { flex: 1, gap: spacing.md },
  ratingsLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  headerMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  metaText: { color: colors.textDimmed },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  heroActions: {
    marginTop: spacing.xl,
    marginBottom: 0,
  },
  iconAction: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconActionLabel: { fontWeight: '700' },
  disabled: { opacity: 0.45 },
  error: { color: colors.danger, marginBottom: spacing.md },
  overview: { color: colors.textSecondary, marginTop: spacing.lg },
  genres: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  genre: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  genreText: { color: colors.textSecondary, fontWeight: '700' },
  infoCard: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
  infoLabel: { color: colors.textDimmed, fontWeight: '700' },
  infoValue: { flex: 1, color: colors.textSecondary, textAlign: 'right' },
  collectionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
  },
  collectionCopy: { flex: 1, gap: 2 },
  collectionName: { color: colors.text, fontWeight: '700' },
  episodes: { gap: spacing.sm },
  episode: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  episodeNumber: {
    width: 44,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
  },
  episodeNumberText: { color: colors.accent, fontSize: 20, fontWeight: '900' },
  episodeCopy: { flex: 1, gap: 3 },
  people: { gap: spacing.md, paddingRight: spacing.lg },
  person: { width: 82, gap: spacing.xs },
  personName: { fontWeight: '700' },
  trailers: { gap: spacing.md, paddingRight: spacing.lg },
  trailer: { width: 220, gap: spacing.xs },
  similar: { paddingRight: spacing.lg },
});
