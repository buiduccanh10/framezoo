import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { persistBackendUrl } from '@/app/bootstrap';
import { AppText, Button, Screen, TextInput } from '@/components/primitives';
import { useAuthStore } from '@/state/auth/store';
import { colors, spacing } from '@/theme';

export function BackendScreen() {
  const navigation = useNavigation();
  const current = useAuthStore((state) => state.backendUrl);
  const setBackendUrl = useAuthStore((state) => state.setBackendUrl);
  const [value, setValue] = useState(current);
  const [error, setError] = useState('');

  function save() {
    const normalized = value.trim().replace(/\/+$/, '');
    if (!normalized || !/^https?:\/\//i.test(normalized)) {
      setError('Backend URL must start with http:// or https://.');
      return;
    }
    setBackendUrl(normalized);
    persistBackendUrl().catch(() => undefined);
    navigation.goBack();
  }

  return (
    <Screen scroll padded>
      <View style={styles.form}>
        <AppText variant="heading">Backend URL</AppText>
        <AppText variant="muted">Use your configured Framezoo backend. No provider host is bundled in the app.</AppText>
        <TextInput autoCapitalize="none" autoCorrect={false} keyboardType="url" onChangeText={setValue} placeholder="https://backend.example.com" value={value} />
        {error ? <AppText style={styles.error}>{error}</AppText> : null}
        <Button label="Save backend" onPress={save} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { flex: 1, maxWidth: 560, width: '100%', alignSelf: 'center', justifyContent: 'center', gap: spacing.md },
  error: { color: colors.danger },
});
