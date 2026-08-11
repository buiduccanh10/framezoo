import React from 'react';
import { StyleSheet, TextInput as NativeTextInput } from 'react-native';

import { colors, radius, spacing } from '@/theme';

export function TextInput(props: React.ComponentProps<typeof NativeTextInput>) {
  return (
    <NativeTextInput
      placeholderTextColor={colors.textDimmed}
      {...props}
      style={[styles.input, props.style]}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    color: colors.text,
    paddingHorizontal: spacing.md,
    fontSize: 16,
  },
});
