import React from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Screen } from '@/components/primitives';
import { spacing } from '@/theme';

export function MigrationScreen() {
  return (
    <Screen scroll padded>
      <View style={styles.content}>
        <AppText variant="heading">Migration</AppText>
        <AppText variant="muted">Move bookmarks, progress, settings and watch history between Framezoo installs.</AppText>
        <Button label="Import export file" onPress={() => undefined} />
        <Button label="Export current data" onPress={() => undefined} variant="secondary" />
        <AppText variant="caption">Native document picker and share sheet are reserved for the next native integration pass.</AppText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, gap: spacing.lg },
});
