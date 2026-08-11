import React from 'react';
import { Image, StyleSheet } from 'react-native';

import { getPlatformAsset } from '@/assets/metadataAssets';

export function PlatformBadge(props: {
  provider?: string;
  size?: number;
}) {
  const source = getPlatformAsset(props.provider);
  if (!source) return null;

  const size = props.size ?? 32;
  return (
    <Image
      accessibilityLabel={props.provider}
      resizeMode="contain"
      source={source}
      style={[styles.image, { height: size, width: size }]}
    />
  );
}

const styles = StyleSheet.create({
  image: {
    borderRadius: 7,
  },
});
