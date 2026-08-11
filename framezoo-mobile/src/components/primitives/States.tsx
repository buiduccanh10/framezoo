import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { colors, spacing } from '@/theme';

import { AppText } from './AppText';
import { Button } from './Button';

export function LoadingState(props: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.accent} size="large" />
      {props.label ? <AppText variant="muted">{props.label}</AppText> : null}
    </View>
  );
}

export function EmptyState(props: { title: string; description?: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.center}>
      <AppText variant="title">{props.title}</AppText>
      {props.description ? <AppText variant="muted" style={styles.description}>{props.description}</AppText> : null}
      {props.action && props.onAction ? <Button label={props.action} onPress={props.onAction} compact /> : null}
    </View>
  );
}

export function ErrorState(props: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.center}>
      <AppText variant="title">Something went wrong</AppText>
      <AppText variant="muted" style={styles.description}>{props.message}</AppText>
      {props.onRetry ? <Button label="Retry" onPress={props.onRetry} compact /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xxl, minHeight: 180 },
  description: { maxWidth: 420, textAlign: 'center' },
});
