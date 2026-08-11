import React from 'react';
import { Image, StyleSheet, View } from 'react-native';

import {
  getPopcornAsset,
  getTomatoAsset,
  ratingAssets,
} from '@/assets/metadataAssets';
import type { ExternalRatings as ExternalRatingsData } from '@/services/api/metadata';
import { colors, spacing } from '@/theme';

import { AppText } from '../primitives/AppText';

function compactCount(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function RatingBrand(props: { name: 'imdb' | 'tmdb' }) {
  return (
    <View
      style={[
        styles.brand,
        props.name === 'imdb' ? styles.imdbBrand : styles.tmdbBrand,
      ]}
    >
      <Image
        accessibilityLabel={props.name.toUpperCase()}
        resizeMode="contain"
        source={ratingAssets[props.name]}
        style={styles.brandImage}
      />
    </View>
  );
}

function RatingMark(props: { label: string; color: string }) {
  return (
    <View style={[styles.mark, { backgroundColor: props.color }]}>
      <AppText style={styles.markText}>{props.label}</AppText>
    </View>
  );
}

export function ExternalRatings(props: {
  tmdbRating?: number;
  tmdbVotes?: number;
  ratings?: ExternalRatingsData;
  loading?: boolean;
  compact?: boolean;
  valueColor?: string;
  mutedColor?: string;
}) {
  const valueColor = props.valueColor ?? colors.text;
  const mutedColor = props.mutedColor ?? colors.textDimmed;
  const items: React.ReactNode[] = [];

  if (typeof props.tmdbRating === 'number') {
    items.push(
      <View key="tmdb" style={styles.item}>
        <RatingBrand name="tmdb" />
        <AppText style={[styles.value, { color: valueColor }]}>
          {props.tmdbRating.toFixed(1)}
        </AppText>
        {typeof props.tmdbVotes === 'number' ? (
          <AppText style={[styles.count, { color: mutedColor }]}>
            ({compactCount(props.tmdbVotes)})
          </AppText>
        ) : null}
      </View>,
    );
  }

  if (props.loading || props.ratings?.imdb) {
    items.push(
      <View key="imdb" style={styles.item}>
        <RatingBrand name="imdb" />
        {props.loading ? (
          <View style={[styles.loadingValue, { backgroundColor: mutedColor }]} />
        ) : (
          <>
            <AppText style={[styles.value, { color: valueColor }]}>
              {props.ratings?.imdb?.rating.toFixed(1)}
            </AppText>
            {props.ratings?.imdb ? (
              <AppText style={[styles.count, { color: mutedColor }]}>
                ({compactCount(props.ratings.imdb.votes)})
              </AppText>
            ) : null}
          </>
        )}
      </View>,
    );
  }

  if (props.loading || props.ratings?.rottenTomatoes) {
    items.push(
      <View key="rt" style={styles.item}>
        {props.ratings?.rottenTomatoes ? (
          <Image
            accessibilityLabel="Rotten Tomatoes"
            resizeMode="contain"
            source={getTomatoAsset(props.ratings.rottenTomatoes.tomatoIcon)}
            style={styles.ratingImage}
          />
        ) : (
          <RatingMark color="#fa320a" label="RT" />
        )}
        {props.loading ? (
          <View style={[styles.loadingValue, { backgroundColor: mutedColor }]} />
        ) : (
          <AppText style={[styles.value, { color: valueColor }]}>
            {props.ratings?.rottenTomatoes?.tomatoScore}%
          </AppText>
        )}
      </View>,
    );
  }

  if (
    props.loading ||
    typeof props.ratings?.rottenTomatoes?.popcornScore === 'number'
  ) {
    items.push(
      <View key="audience" style={styles.item}>
        {props.ratings?.rottenTomatoes ? (
          <Image
            accessibilityLabel="Popcornmeter"
            resizeMode="contain"
            source={getPopcornAsset(
              props.ratings.rottenTomatoes.popcornIcon ?? 'empty',
            )}
            style={styles.ratingImage}
          />
        ) : (
          <RatingMark color="#f59e0b" label="AUD" />
        )}
        {props.loading ? (
          <View style={[styles.loadingValue, { backgroundColor: mutedColor }]} />
        ) : (
          <AppText style={[styles.value, { color: valueColor }]}>
            {props.ratings?.rottenTomatoes?.popcornScore}%
          </AppText>
        )}
      </View>,
    );
  }

  if (!items.length) return null;

  return (
    <View style={[styles.row, props.compact && styles.compactRow]}>
      {items.map((item, index) => (
        <React.Fragment key={index}>
          {index > 0 ? (
            <AppText style={[styles.separator, { color: mutedColor }]}>•</AppText>
          ) : null}
          {item}
        </React.Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  compactRow: { gap: spacing.xs },
  item: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  brand: {
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: 3,
  },
  tmdbBrand: { width: 44 },
  imdbBrand: { width: 26, backgroundColor: '#f5c518' },
  brandImage: { width: '100%', height: '100%' },
  mark: {
    minWidth: 28,
    height: 18,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 3,
  },
  markText: { color: colors.black, fontSize: 9, fontWeight: '900' },
  value: { color: colors.text, fontSize: 13, fontWeight: '800' },
  count: { color: colors.textDimmed, fontSize: 11 },
  separator: { color: colors.textDimmed, fontSize: 13 },
  ratingImage: { width: 20, height: 20 },
  loadingValue: {
    width: 30,
    height: 13,
    borderRadius: 3,
    backgroundColor: colors.border,
  },
});
