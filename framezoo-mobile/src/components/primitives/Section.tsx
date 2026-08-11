import React from 'react';
import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';

import { AppText } from './AppText';

export function Section(props: {
  title: string;
  action?: string;
  onAction?: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <AppText variant="title">{props.title}</AppText>
        {props.action && props.onAction ? (
          <AppText onPress={props.onAction} style={styles.action}>
            {props.action}
          </AppText>
        ) : null}
      </View>
      {props.children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: spacing.xxl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  action: { color: '#8288fe', fontWeight: '700' },
});
