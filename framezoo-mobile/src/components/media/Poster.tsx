import React, { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { colors, radius } from '@/theme';

export function Poster(props: { uri?: string; title: string; width?: number; height?: number }) {
  const [failed, setFailed] = useState(false);
  const width = props.width ?? 116;
  const height = props.height ?? Math.round(width * 1.5);
  return (
    <View style={[styles.container, { width, height }]}>
      {props.uri && !failed ? (
        <Image
          source={{ uri: props.uri }}
          accessibilityLabel={props.title}
          onError={() => setFailed(true)}
          resizeMode="cover"
          style={styles.image}
        />
      ) : (
        <View style={styles.placeholder}>
          <Image source={require('../../assets/placeholder.png')} style={styles.placeholderImage} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden', borderRadius: radius.md, backgroundColor: colors.surfaceRaised },
  image: { width: '100%', height: '100%' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  placeholderImage: { width: '55%', height: '55%', opacity: 0.35 },
});
