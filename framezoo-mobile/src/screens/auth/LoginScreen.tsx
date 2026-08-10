import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { AppText, Button, Screen, TextInput } from '@/components/primitives';
import { login } from '@/services/api/auth';
import { persistAuth } from '@/app/bootstrap';
import { useAuthStore } from '@/state/auth/store';
import { colors, spacing } from '@/theme';

import type { AuthStackParamList } from '@/navigation/AuthNavigator';

export function LoginScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList>>();
  const backendUrl = useAuthStore((state) => state.backendUrl);
  const setAccount = useAuthStore((state) => state.setAccount);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleLogin() {
    setError('');
    if (!identifier.trim()) {
      setError('Enter an email or username.');
      return;
    }
    if (!password) {
      setError('Enter your password or passphrase.');
      return;
    }
    if (!backendUrl) {
      setError('Configure a backend before signing in.');
      return;
    }
    setBusy(true);
    try {
      setAccount(await login(backendUrl, { identifier: identifier.trim(), password }));
      await persistAuth();
      navigation.getParent()?.goBack();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Login failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll padded>
      <View style={styles.content}>
        <AppText variant="hero" style={styles.logo}>Framezoo</AppText>
        <AppText variant="muted" style={styles.subtitle}>Your personal media space.</AppText>
        <View style={styles.form}>
          <AppText variant="title">Sign in</AppText>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setIdentifier}
            placeholder="Email or username"
            value={identifier}
          />
          <TextInput
            autoCapitalize="none"
            secureTextEntry
            onChangeText={setPassword}
            placeholder="Password"
            value={password}
          />
          {error ? <AppText style={styles.error}>{error}</AppText> : null}
          <Button disabled={busy} label={busy ? 'Signing in...' : 'Sign in'} onPress={handleLogin} />
          <Button label="Create account" onPress={() => navigation.navigate('Register')} variant="secondary" />
          <Button label={backendUrl ? 'Change backend' : 'Configure backend'} onPress={() => navigation.navigate('Backend')} variant="ghost" />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, maxWidth: 480, width: '100%', alignSelf: 'center', justifyContent: 'center' },
  logo: { color: colors.accent, marginBottom: spacing.xs },
  subtitle: { marginBottom: spacing.xxl },
  form: { gap: spacing.md },
  error: { color: colors.danger },
});
