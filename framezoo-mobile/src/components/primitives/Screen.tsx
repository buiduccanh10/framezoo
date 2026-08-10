import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing } from '@/theme';

export function Screen(props: {
  children: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
  style?: object;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const content = (
    <View
      style={[
        styles.content,
        props.padded && styles.padded,
        { paddingTop: Math.max(insets.top, spacing.lg) },
        props.style,
      ]}
    >
      {props.children}
    </View>
  );

  return props.scroll ? (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        props.onRefresh ? (
          <RefreshControl
            colors={[colors.accent]}
            onRefresh={props.onRefresh}
            refreshing={Boolean(props.refreshing)}
            tintColor={colors.accent}
          />
        ) : undefined
      }
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {content}
    </ScrollView>
  ) : (
    <View style={styles.screen}>{content}</View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1 },
  padded: { paddingHorizontal: spacing.lg },
  scrollContent: { flexGrow: 1, paddingBottom: spacing.xxxl },
});
