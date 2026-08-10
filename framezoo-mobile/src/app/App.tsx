import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { RootNavigator } from '@/navigation/RootNavigator';
import { colors } from '@/theme';
import { useAuthStore } from '@/state/auth/store';

import { bootstrap } from './bootstrap';
import { AppProviders } from './providers/AppProviders';

function AppContent() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    bootstrap().finally(() => setReady(true));
  }, []);

  if (!ready || !hydrated) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }
  return <RootNavigator />;
}

export default function App() {
  return (
    <AppProviders>
      <AppContent />
    </AppProviders>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});
