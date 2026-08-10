import React from 'react';
import { StyleSheet, Text, type TextProps } from 'react-native';

import { colors, typography } from '@/theme';

export function AppText(
  props: TextProps & {
    variant?: 'body' | 'label' | 'title' | 'heading' | 'hero' | 'muted' | 'caption';
  },
) {
  const { variant = 'body', style, ...rest } = props;
  return <Text {...rest} style={[styles.base, styles[variant], style]} />;
}

const styles = StyleSheet.create({
  base: { color: colors.text, fontSize: typography.body },
  body: { color: colors.text, fontSize: typography.body, lineHeight: 22 },
  label: { color: colors.text, fontSize: typography.body, fontWeight: '700' },
  title: { color: colors.text, fontSize: typography.title, fontWeight: '800' },
  heading: { color: colors.text, fontSize: typography.heading, fontWeight: '800' },
  hero: { color: colors.text, fontSize: typography.hero, fontWeight: '900' },
  muted: { color: colors.textSecondary, fontSize: typography.body, lineHeight: 21 },
  caption: { color: colors.textDimmed, fontSize: typography.bodySmall },
});
