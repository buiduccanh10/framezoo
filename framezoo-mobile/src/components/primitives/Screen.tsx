import React, { useEffect, useRef } from 'react';
import {
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing } from '@/theme';

export function Screen(props: {
  children: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
  style?: object;
  refreshing?: boolean;
  onRefresh?: () => void;
  scrollKey?: string | number;
  safeAreaTop?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const topInset = props.safeAreaTop === false ? 0 : insets.top + spacing.sm;
  const useNativeScrollInset =
    Platform.OS === 'ios' && props.scroll && props.safeAreaTop !== false;
  useEffect(() => {
    if (props.scroll && props.scrollKey !== undefined) {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }
  }, [props.scroll, props.scrollKey]);

  const content = (
    <View
      style={[
        styles.content,
        props.scroll ? styles.scrollContentView : styles.fillContent,
        props.padded && styles.padded,
        { paddingTop: useNativeScrollInset ? 0 : topInset },
        props.style,
      ]}
    >
      {props.children}
    </View>
  );

  return props.scroll ? (
    <ScrollView
      ref={scrollRef}
      style={styles.screen}
      contentContainerStyle={styles.scrollContent}
      contentInsetAdjustmentBehavior="never"
      contentInset={
        useNativeScrollInset
          ? { bottom: 0, left: 0, right: 0, top: topInset }
          : undefined
      }
      contentOffset={useNativeScrollInset ? { x: 0, y: -topInset } : undefined}
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
  content: {},
  fillContent: { flex: 1 },
  scrollContentView: { alignSelf: 'stretch' },
  padded: { paddingHorizontal: spacing.lg },
  scrollContent: { flexGrow: 1, paddingBottom: spacing.xxxl },
});
