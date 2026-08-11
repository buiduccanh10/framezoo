import React from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { MediaCard } from '@/components/media';
import { AppText } from '@/components/primitives';
import { useDeviceMode } from '@/platform/DeviceModeContext';
import { colors, spacing } from '@/theme';
import type { MediaItem } from '@/types';

export function MediaCarouselSection(props: {
  title: string;
  items: MediaItem[];
  onPress: (media: MediaItem) => void;
  badge?: string;
  loading?: boolean;
}) {
  const { isTV } = useDeviceMode();
  const width = isTV ? 166 : 116;

  if (props.loading) {
    return (
      <View style={styles.section}>
        <SectionHeader title={props.title} badge={props.badge} />
        <FlatList
          data={Array.from({ length: isTV ? 6 : 5 }, (_, index) => index)}
          horizontal
          keyExtractor={item => `skeleton:${item}`}
          renderItem={() => (
            <View
              style={[
                styles.skeletonCard,
                { width, height: Math.round(width * 1.5) + 58 },
              ]}
            />
          )}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
        />
      </View>
    );
  }

  if (!props.items.length) return null;

  return (
    <View style={styles.section}>
      <SectionHeader title={props.title} badge={props.badge} />
      <FlatList
        data={props.items}
        horizontal
        keyExtractor={item => `${item.type}:${item.id}`}
        nestedScrollEnabled
        renderItem={({ item }) => (
          <MediaCard
            media={item}
            onPress={() => props.onPress(item)}
            width={width}
          />
        )}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      />
    </View>
  );
}

function SectionHeader(props: { title: string; badge?: string }) {
  return (
    <View style={styles.header}>
      <AppText variant="title">{props.title}</AppText>
      {props.badge ? (
        <View style={styles.badge}>
          <AppText variant="caption" style={styles.badgeText}>
            {props.badge}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: spacing.xxl },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    backgroundColor: colors.surfaceRaised,
  },
  badgeText: { color: colors.textSecondary, fontWeight: '700' },
  row: { gap: spacing.lg, paddingHorizontal: spacing.lg, paddingRight: spacing.xxl },
  skeletonCard: {
    borderRadius: 12,
    backgroundColor: colors.surfaceRaised,
    marginHorizontal: spacing.xs,
  },
});
