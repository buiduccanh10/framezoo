import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';

import { AppText, Button, EmptyState, ErrorState, LoadingState, Screen } from '@/components/primitives';
import { ChoiceChips, PlatformIcon, SettingsCard, SettingsSection } from '@/components/navigation';
import { addonRepository } from '@/services/addons';
import { demoMedia } from '@/services/metadata';
import { MockPlayerAdapter } from '@/adapters/player';
import { useAuthStore } from '@/state/auth/store';
import { colors, spacing } from '@/theme';
import type { AddonStream, PlayerSnapshot } from '@/types';

import type { RootStackParamList } from '@/navigation/routeTypes';

export function PlayerScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'Player'>>();
  const backendUrl = useAuthStore((state) => state.backendUrl);
  const adapter = useRef(new MockPlayerAdapter()).current;
  const [sources, setSources] = useState<AddonStream[]>([]);
  const [selected, setSelected] = useState<AddonStream | null>(null);
  const [snapshot, setSnapshot] = useState<PlayerSnapshot>(adapter.getSnapshot());
  const [loadingSources, setLoadingSources] = useState(true);
  const [sourceError, setSourceError] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');

  useEffect(() => {
    const unsubscribe = adapter.subscribe(setSnapshot);
    return () => {
      unsubscribe();
      adapter.destroy().catch(() => undefined);
    };
  }, [adapter]);

  useEffect(() => {
    let cancelled = false;
    setLoadingSources(true);
    setSourceError('');
    addonRepository
      .loadStreams({
        type: route.params.type === 'show' ? 'series' : 'movie',
        id: route.params.mediaId,
        season: route.params.season,
        episode: route.params.episode,
      })
      .then((result) => {
        if (!cancelled) setSources(result);
      })
      .catch((cause) => {
        if (!cancelled) {
          setSourceError(cause instanceof Error ? cause.message : 'Source loading failed.');
          setSources([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingSources(false);
      });
    return () => {
      cancelled = true;
    };
  }, [backendUrl, route.params]);

  const title = useMemo(
    () => demoMedia.find((item) => item.id === route.params.mediaId)?.title ?? 'Framezoo Player',
    [route.params.mediaId],
  );
  const sourceOptions = useMemo(
    () => [
      { label: 'All', value: 'all' },
      ...Array.from(new Set(sources.map((source) => source.addonId))).map((addonId) => ({
        label: sources.find((source) => source.addonId === addonId)?.addonName ?? addonId,
        value: addonId,
      })),
    ],
    [sources],
  );
  const filteredSources = useMemo(
    () => sourceFilter === 'all' ? sources : sources.filter((source) => source.addonId === sourceFilter),
    [sourceFilter, sources],
  );

  async function loadSource(source: AddonStream) {
    setSelected(source);
    await adapter.load(source);
    await adapter.play();
  }

  if (loadingSources) {
    return <LoadingState label="Loading addon streams..." />;
  }

  return (
    <Screen scroll padded>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <AppText variant="title">{title}</AppText>
          <AppText variant="muted">
            {route.params.type === 'show' ? `S${route.params.season ?? 1} E${route.params.episode ?? 1}` : 'Movie'}
          </AppText>
        </View>
        <AppText style={styles.status}>{snapshot.status.toUpperCase()}</AppText>
      </View>
      <View style={styles.video}>
        <PlatformIcon name="playback" size={48} color={colors.accent} focused />
        <AppText variant="heading" style={styles.videoLogo}>FZ</AppText>
        <AppText variant="muted">{selected ? `${selected.kind.toUpperCase()} source selected` : 'Select a source to start the mock player.'}</AppText>
        {snapshot.error ? <AppText style={styles.error}>{snapshot.error}</AppText> : null}
      </View>
      {sourceError ? <ErrorState message={sourceError} /> : null}
      <SettingsSection icon="addons" title="Sources" description="Select an addon stream. The app does not resolve or bundle providers.">
        <SettingsCard title="Source addons" icon="addons">
          <ChoiceChips options={sourceOptions} value={sourceFilter} onChange={setSourceFilter} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sources}>
            {filteredSources.map((source) => (
              <Pressable
                key={source.id}
                accessibilityRole="button"
                onPress={() => loadSource(source).catch(() => undefined)}
                style={[styles.source, selected?.id === source.id && styles.sourceActive]}
              >
                <AppText variant="label">{source.name}</AppText>
                <AppText variant="caption">{source.addonName}  |  {source.kind}</AppText>
              </Pressable>
            ))}
          </ScrollView>
          {!sources.length ? <EmptyState title="No streams" description="Install a stream addon and try again." /> : null}
        </SettingsCard>
      </SettingsSection>
      <View style={styles.controls}>
        <Button compact label="-30s" onPress={() => adapter.seek(snapshot.position - 30).catch(() => undefined)} variant="secondary" />
        <Button compact label={snapshot.status === 'playing' ? 'Pause' : 'Play'} onPress={() => (snapshot.status === 'playing' ? adapter.pause() : adapter.play()).catch(() => undefined)} />
        <Button compact label="+30s" onPress={() => adapter.seek(snapshot.position + 30).catch(() => undefined)} variant="secondary" />
        <Button compact label="Subtitles" onPress={() => adapter.setSubtitleTrack(snapshot.activeSubtitleId ? null : snapshot.subtitleTracks[0] ?? null).catch(() => undefined)} variant="secondary" />
      </View>
      <View style={styles.progress}>
        <View style={[styles.progressFill, { width: `${snapshot.duration ? (snapshot.position / snapshot.duration) * 100 : 0}%` }]} />
      </View>
      <AppText variant="caption">{formatTime(snapshot.position)} / {formatTime(snapshot.duration)}  |  Volume {Math.round(snapshot.volume * 100)}%</AppText>
      <View style={styles.controls}>
        <Button compact label="Volume -" onPress={() => adapter.setVolume(snapshot.volume - 0.1).catch(() => undefined)} variant="secondary" />
        <Button compact label="Volume +" onPress={() => adapter.setVolume(snapshot.volume + 0.1).catch(() => undefined)} variant="secondary" />
      </View>
    </Screen>
  );
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  headerCopy: { gap: spacing.xs },
  status: { color: colors.accent, fontWeight: '800', fontSize: 12 },
  video: { minHeight: 230, borderRadius: 16, backgroundColor: colors.black, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, marginBottom: spacing.xl },
  videoLogo: { color: colors.accent },
  error: { color: colors.danger },
  sources: { gap: spacing.sm, paddingVertical: spacing.md },
  source: { minWidth: 180, padding: spacing.md, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  sourceActive: { borderColor: colors.accent, backgroundColor: colors.surfaceRaised },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginVertical: spacing.md },
  progress: { height: 5, backgroundColor: colors.border, borderRadius: 3, overflow: 'hidden', marginTop: spacing.md },
  progressFill: { height: '100%', backgroundColor: colors.accent },
});
