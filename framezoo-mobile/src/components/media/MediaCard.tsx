import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { MediaItem } from '@/types';
import { spacing } from '@/theme';

import { AppText } from '../primitives/AppText';
import { FocusRing } from '@/platform/focus/FocusRing';
import { Poster } from './Poster';

export function MediaCard(props: { media: MediaItem; onPress: () => void; width?: number }) {
  const [focused, setFocused] = useState(false);
  const width = props.width ?? 116;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[styles.card, { width }]}
    >
      <FocusRing focused={focused}>
        <Poster uri={props.media.poster} title={props.media.title} width={width} height={Math.round(width * 1.5)} />
      </FocusRing>
      <AppText numberOfLines={2} style={styles.title}>{props.media.title}</AppText>
      <AppText variant="caption">{[props.media.type === 'show' ? 'Series' : 'Movie', props.media.year].filter(Boolean).join('  |  ')}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.xs },
  title: { fontWeight: '700', minHeight: 40 },
  row: { flexDirection: 'row', gap: spacing.lg },
});

export function MediaRow(props: { items: MediaItem[]; onPress: (media: MediaItem) => void; tv?: boolean }) {
  return (
    <View style={styles.row}>
      {props.items.map((item) => (
        <MediaCard key={`${item.type}:${item.id}`} media={item} onPress={() => props.onPress(item)} width={props.tv ? 160 : 116} />
      ))}
    </View>
  );
}
