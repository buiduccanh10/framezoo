import React from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, radius } from '@/theme';

export function FocusRing(props: { focused: boolean; children: React.ReactNode }) {
  return (
    <View style={[styles.base, props.focused && styles.focused]}>
      {props.children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.md, borderWidth: 2, borderColor: 'transparent' },
  focused: { borderColor: colors.accent, shadowColor: colors.accent, shadowOpacity: 0.55, shadowRadius: 12 },
});
