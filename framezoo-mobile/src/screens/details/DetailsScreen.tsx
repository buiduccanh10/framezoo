import React, { useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';

import { AppText, Button, EmptyState, ErrorState, LoadingState, Screen, Section } from '@/components/primitives';
import { MediaRow, Poster } from '@/components/media';
import { getMediaDetails } from '@/services/api/metadata';
import { deleteBookmark, saveBookmark } from '@/services/account';
import { demoMedia } from '@/services/metadata';
import { useAuthStore } from '@/state/auth/store';
import { useLibraryStore } from '@/state/library/store';
import { colors, spacing } from '@/theme';
import type { MediaDetails } from '@/types';

import type { RootStackParamList } from '@/navigation/routeTypes';

function demoDetails(id: string, type: 'movie' | 'show'): MediaDetails {
  const media = demoMedia.find((item) => item.id === id) ?? demoMedia.find((item) => item.type === type) ?? demoMedia[0];
  return {
    ...media,
    seasons:
      media.type === 'show'
        ? [
            {
              id: 'season-1',
              number: 1,
              title: 'Season 1',
              episodes: [
                { id: 'episode-1', number: 1, title: 'Pilot', overview: 'The story begins.' },
                { id: 'episode-2', number: 2, title: 'Second Signal', overview: 'A new clue appears.' },
              ],
            },
          ]
        : undefined,
    similar: demoMedia.filter((item) => item.id !== media.id),
  };
}

export function DetailsScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'Details'>>();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const backendUrl = useAuthStore((state) => state.backendUrl);
  const account = useAuthStore((state) => state.account);
  const addBookmark = useLibraryStore((state) => state.addBookmark);
  const removeBookmark = useLibraryStore((state) => state.removeBookmark);
  const bookmarks = useLibraryStore((state) => state.bookmarks);
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const [bookmarkError, setBookmarkError] = useState('');
  const detailsQuery = useQuery({
    queryKey: ['details', backendUrl, route.params.mediaId, route.params.type],
    queryFn: () =>
      backendUrl
        ? getMediaDetails(backendUrl, route.params.mediaId, route.params.type)
        : Promise.resolve(demoDetails(route.params.mediaId, route.params.type)),
  });
  const media = detailsQuery.data;
  const firstEpisode = useMemo(() => media?.seasons?.[0]?.episodes[0], [media]);

  const isBookmarked = Boolean(media && bookmarks.some((item) => item.mediaId === media.id));

  async function handleBookmark() {
    if (!account) {
      navigation.navigate('Auth');
      return;
    }
    if (!media || !backendUrl) return;
    setBookmarkBusy(true);
    setBookmarkError('');
    const entry = {
      mediaId: media!.id,
      type: media!.type,
      title: media!.title,
      poster: media!.poster,
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
      setBookmarkError(cause instanceof Error ? cause.message : 'Could not update bookmark.');
    } finally {
      setBookmarkBusy(false);
    }
  }

  if (detailsQuery.isLoading) return <LoadingState label="Loading details..." />;
  if (detailsQuery.isError) {
    return <ErrorState message={detailsQuery.error instanceof Error ? detailsQuery.error.message : 'Details request failed.'} onRetry={() => detailsQuery.refetch().catch(() => undefined)} />;
  }
  if (!media) return <EmptyState title="Media not found" />;

  return (
    <Screen scroll>
      {media.backdrop ? <Image source={{ uri: media.backdrop }} resizeMode="cover" style={styles.backdrop} /> : null}
      <View style={styles.body}>
        <View style={styles.hero}>
          <Poster uri={media.poster} title={media.title} width={132} />
          <View style={styles.heroCopy}>
            <AppText variant="heading">{media.title}</AppText>
            <AppText variant="muted">{[media.year, media.type === 'show' ? 'Series' : 'Movie', media.rating ? `${media.rating.toFixed(1)}/10` : null].filter(Boolean).join('  |  ')}</AppText>
            <Button label="Play" onPress={() => navigation.navigate('Player', { mediaId: media.id, type: media.type, season: firstEpisode ? 1 : undefined, episode: firstEpisode?.number })} />
            <Button
              disabled={bookmarkBusy}
              label={!account ? 'Sign in to bookmark' : bookmarkBusy ? 'Saving...' : isBookmarked ? 'Remove bookmark' : 'Add bookmark'}
              onPress={() => handleBookmark().catch(() => undefined)}
              variant="secondary"
            />
          </View>
        </View>
        {bookmarkError ? <AppText style={styles.error}>{bookmarkError}</AppText> : null}
        {media.overview ? <AppText variant="muted" style={styles.overview}>{media.overview}</AppText> : null}
        <View style={styles.metadata}>
          {media.rating ? <AppText variant="label">TMDB {media.rating.toFixed(1)}/10</AppText> : null}
          {media.imdbId ? <AppText variant="label">IMDb {media.imdbId}</AppText> : null}
          {media.genres?.length ? <AppText variant="muted">{media.genres.join('  |  ')}</AppText> : null}
        </View>
        {media.seasons?.map((season) => (
          <Section key={season.id} title={`${season.title}  |  ${season.episodes.length} episodes`}>
            <View style={styles.episodes}>
              {season.episodes.map((episode) => (
                <View key={episode.id} style={styles.episode}>
                  <View style={styles.episodeNumber}><AppText style={styles.episodeNumberText}>{episode.number}</AppText></View>
                  <View style={styles.episodeCopy}>
                    <AppText variant="label">{episode.title}</AppText>
                    {episode.overview ? <AppText variant="caption" numberOfLines={2}>{episode.overview}</AppText> : null}
                  </View>
                  <Button compact label="Play" onPress={() => navigation.navigate('Player', { mediaId: media.id, type: media.type, season: season.number, episode: episode.number })} />
                </View>
              ))}
            </View>
          </Section>
        ))}
        {media.cast?.length ? (
          <Section title="Cast">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.people}>
              {media.cast.map((person) => (
                <View key={person.id} style={styles.person}>
                  <Poster uri={person.image} title={person.name} width={76} height={96} />
                  <AppText numberOfLines={2} style={styles.personName}>{person.name}</AppText>
                  {person.character ? <AppText variant="caption" numberOfLines={2}>{person.character}</AppText> : null}
                </View>
              ))}
            </ScrollView>
          </Section>
        ) : null}
        {media.trailers?.length ? (
          <Section title="Trailers">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.people}>
              {media.trailers.map((trailer) => (
                <View key={trailer.id} style={styles.trailer}>
                  <Poster uri={trailer.thumbnail} title={trailer.title} width={180} height={102} />
                  <AppText numberOfLines={2} style={styles.personName}>{trailer.title}</AppText>
                </View>
              ))}
            </ScrollView>
          </Section>
        ) : null}
        {media.similar?.length ? (
          <Section title="Similar">
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <MediaRow items={media.similar} onPress={(item) => navigation.push('Details', { mediaId: item.id, type: item.type })} />
            </ScrollView>
          </Section>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  backdrop: { width: '100%', height: 220, opacity: 0.55 },
  body: { padding: spacing.lg },
  hero: { flexDirection: 'row', gap: spacing.lg, marginBottom: spacing.xl },
  heroCopy: { flex: 1, gap: spacing.md },
  overview: { marginBottom: spacing.xxl },
  error: { color: colors.danger, marginBottom: spacing.md },
  metadata: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.xl },
  episodes: { gap: spacing.sm },
  episode: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, backgroundColor: colors.surface, borderRadius: 12 },
  episodeNumber: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  episodeNumberText: { color: colors.accent, fontWeight: '800' },
  episodeCopy: { flex: 1, gap: spacing.xs },
  people: { gap: spacing.md, paddingRight: spacing.lg },
  person: { width: 76, gap: spacing.xs },
  personName: { fontWeight: '700' },
  trailer: { width: 180, gap: spacing.xs },
});
