import React, { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { colors, radius, spacing } from '@/theme';

import { AppText } from './AppText';

export function Button(props: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  compact?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const variant = props.variant ?? 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={props.onPress}
      style={[
        styles.base,
        props.compact && styles.compact,
        styles[variant],
        focused && styles.focused,
        props.disabled && styles.disabled,
      ]}
    >
      <AppText style={styles[`${variant}Text` as keyof typeof styles] as object}>
        {props.label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  compact: { minHeight: 38, paddingHorizontal: spacing.md },
  primary: { backgroundColor: colors.text },
  secondary: { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
  danger: { backgroundColor: colors.danger },
  ghost: { backgroundColor: 'transparent' },
  primaryText: { color: colors.black, fontWeight: '800' },
  secondaryText: { color: colors.text, fontWeight: '700' },
  dangerText: { color: colors.black, fontWeight: '800' },
  ghostText: { color: colors.accent, fontWeight: '700' },
  focused: { borderColor: colors.accent, shadowColor: colors.accent, shadowOpacity: 0.5, shadowRadius: 8 },
  disabled: { opacity: 0.45 },
});
