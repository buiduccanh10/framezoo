import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { loadLibrary } from '@/services/account';
import { PlatformIcon, SettingsCard, SettingsSection } from '@/components/navigation';
import { AppText, EmptyState, ErrorState, LoadingState, Screen, Section } from '@/components/primitives';
import { MediaRow } from '@/components/media';
import { demoMedia } from '@/services/metadata';
import { useAuthStore } from '@/state/auth/store';
import { useLibraryStore } from '@/state/library/store';
import { colors, spacing } from '@/theme';

import type { RootStackParamList } from '@/navigation/routeTypes';

export function LibraryScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const account = useAuthStore((state) => state.account);
  const backendUrl = useAuthStore((state) => state.backendUrl);
  const bookmarks = useLibraryStore((state) => state.bookmarks);
  const history = useLibraryStore((state) => state.history);
  const progress = useLibraryStore((state) => state.progress);
  const setBookmarks = useLibraryStore((state) => state.setBookmarks);
  const setHistory = useLibraryStore((state) => state.setHistory);
  const setProgressEntries = useLibraryStore((state) => state.setProgressEntries);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!account || !backendUrl) return;
    setLoading(true);
    setError('');
    try {
      const next = await loadLibrary(backendUrl, account);
      setBookmarks(next.bookmarks);
      setHistory(next.history);
      setProgressEntries(next.progress);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load library.');
    } finally {
      setLoading(false);
    }
  }, [account, backendUrl, setBookmarks, setHistory, setProgressEntries]);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  const bookmarkItems = useMemo(
    () =>
      bookmarks.map((item) => ({
        id: item.mediaId,
        title: item.title,
        type: item.type,
        poster: item.poster,
      })),
    [bookmarks],
  );
  const historyItems = useMemo(
    () =>
      history.map((item) => ({
        id: item.mediaId,
        title: item.title,
        type: item.type,
        poster: item.poster,
      })),
    [history],
  );
  const progressItems = useMemo(
    () =>
      progress.map((item) => ({
        id: item.mediaId,
        title: item.title ?? demoMedia.find((media) => media.id === item.mediaId)?.title ?? 'Continue watching',
        type: item.type,
        poster: item.poster ?? demoMedia.find((media) => media.id === item.mediaId)?.poster,
      })),
    [progress],
  );

  if (!account) {
    return (
      <Screen scroll padded>
        <SettingsSection icon="library" title="Library" description="Bookmarks, progress and watch history.">
          <SettingsCard title="Sign in to use your library" description="Your saved media syncs through your account.">
            <EmptyState
              title="Your library is private"
              description="Sign in only when you need synced bookmarks, history or progress."
              action="Sign in"
              onAction={() => navigation.navigate('Auth')}
            />
          </SettingsCard>
        </SettingsSection>
      </Screen>
    );
  }

  return (
    <Screen scroll padded onRefresh={refresh} refreshing={loading}>
      <SettingsSection icon="library" title="Library" description={`Synced for ${account.nickname}.`}>
        {error ? <ErrorState message={error} onRetry={() => refresh().catch(() => undefined)} /> : null}
        {loading && !bookmarks.length && !history.length ? <LoadingState label="Loading library..." /> : null}
        <Section title="Continue watching">
          {progressItems.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <MediaRow
                items={progressItems}
                onPress={(media) => navigation.navigate('Details', { mediaId: media.id, type: media.type })}
              />
            </ScrollView>
          ) : (
            <EmptyState title="Nothing in progress" description="Start a movie or episode to see it here." />
          )}
        </Section>
        <Section title="Bookmarks">
          {bookmarkItems.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <MediaRow
                items={bookmarkItems}
                onPress={(media) => navigation.navigate('Details', { mediaId: media.id, type: media.type })}
              />
            </ScrollView>
          ) : (
            <EmptyState title="No bookmarks" description="Use the bookmark action on a details page." />
          )}
        </Section>
        <Section title="Watch history">
          {historyItems.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <MediaRow
                items={historyItems}
                onPress={(media) => navigation.navigate('Details', { mediaId: media.id, type: media.type })}
              />
            </ScrollView>
          ) : (
            <EmptyState title="No watch history" />
          )}
        </Section>
      </SettingsSection>
      <AppText variant="caption" style={styles.footer}>
        <PlatformIcon name="refresh" size={14} color={colors.textDimmed} /> Pull to refresh synced data.
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  footer: { textAlign: 'center', marginBottom: spacing.xl },
});
