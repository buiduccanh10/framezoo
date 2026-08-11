import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { PlatformIcon } from '@/components/navigation';
import { AppText, Button, ErrorState, EmptyState, LoadingState, Screen, TextInput } from '@/components/primitives';
import { MediaCard } from '@/components/media';
import { searchMedia } from '@/services/api/metadata';
import { demoMedia } from '@/services/metadata';
import { useAuthStore } from '@/state/auth/store';
import { colors, spacing } from '@/theme';

import type { RootStackParamList } from '@/navigation/routeTypes';

export function SearchScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const backendUrl = useAuthStore((state) => state.backendUrl);
  const [input, setInput] = useState('');
  const [queryText, setQueryText] = useState('');
  const query = useQuery({
    queryKey: ['search', backendUrl, queryText],
    enabled: Boolean(queryText.trim()),
    queryFn: () =>
      backendUrl
        ? searchMedia(backendUrl, queryText)
        : Promise.resolve(demoMedia.filter((item) => item.title.toLowerCase().includes(queryText.toLowerCase()))),
  });

  useEffect(() => {
    const timer = setTimeout(() => setQueryText(input.trim()), 450);
    return () => clearTimeout(timer);
  }, [input]);

  return (
    <Screen
      scroll
      padded
      onRefresh={() => {
        if (queryText) query.refetch().catch(() => undefined);
      }}
      refreshing={query.isRefetching}
    >
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <AppText variant="heading">Search</AppText>
          <AppText variant="muted">Search metadata from your backend.</AppText>
        </View>
        <PlatformIcon name="search" size={26} color={colors.accent} focused />
      </View>
      <View style={styles.searchRow}>
        <View style={styles.inputWrap}>
          <PlatformIcon name="search" size={19} color={colors.textDimmed} />
          <TextInput
            autoCorrect={false}
            onChangeText={setInput}
            placeholder="Search movies and shows"
            returnKeyType="search"
            value={input}
            style={styles.input}
          />
        </View>
        <Button compact label="Go" onPress={() => setQueryText(input.trim())} />
      </View>
      {!queryText ? <EmptyState title="Start searching" description="Enter a title, TMDB ID or keyword." /> : null}
      {query.isLoading || (query.isFetching && Boolean(queryText)) ? <LoadingState label="Searching..." /> : null}
      {query.isError ? <ErrorState message={query.error instanceof Error ? query.error.message : 'Search failed.'} onRetry={() => query.refetch().catch(() => undefined)} /> : null}
      {query.data && query.data.length === 0 && !query.isFetching ? <EmptyState title="No results" description="Try a different title or keyword." /> : null}
      {query.data && query.data.length > 0 ? (
        <View style={styles.grid}>
          {query.data.map((media) => (
            <MediaCard key={`${media.type}:${media.id}`} media={media} onPress={() => navigation.navigate('Details', { mediaId: media.id, type: media.type })} width={110} />
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: spacing.xl },
  headerCopy: { gap: spacing.xs },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xl },
  inputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface, paddingLeft: spacing.md },
  input: { flex: 1, borderWidth: 0, backgroundColor: 'transparent' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
});
