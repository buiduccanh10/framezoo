import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { AppText, Button, Screen, TextInput } from '@/components/primitives';
import type { AuthStackParamList } from '@/navigation/AuthNavigator';
import { register } from '@/services/api/auth';
import { persistAuth } from '@/app/bootstrap';
import { useAuthStore } from '@/state/auth/store';
import { colors, spacing } from '@/theme';

export function RegisterScreen() {
  const navigation = useNavigation();
  const backendUrl = useAuthStore((state) => state.backendUrl);
  const setAccount = useAuthStore((state) => state.setAccount);
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleRegister() {
    if (!nickname.trim() || !email.trim() || !password) {
      setError('Nickname, email and password are required.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (!backendUrl) {
      setError('Configure a backend before creating an account.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      setAccount(await register(backendUrl, {
        nickname: nickname.trim(),
        email: email.trim(),
        password,
        profile: { colorA: colors.accent, colorB: colors.accentStrong, icon: 'user' },
      }));
      await persistAuth();
      navigation.getParent()?.goBack();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Registration failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll padded>
      <View style={styles.form}>
        <AppText variant="heading">Create account</AppText>
        <AppText variant="muted">Sync bookmarks, progress and history across devices.</AppText>
        <TextInput onChangeText={setNickname} placeholder="Nickname" value={nickname} />
        <TextInput autoCapitalize="none" keyboardType="email-address" onChangeText={setEmail} placeholder="Email" value={email} />
        <TextInput autoCapitalize="none" secureTextEntry onChangeText={setPassword} placeholder="Password or passphrase" value={password} />
        <TextInput autoCapitalize="none" secureTextEntry onChangeText={setConfirmPassword} placeholder="Confirm password" value={confirmPassword} />
        {error ? <AppText style={styles.error}>{error}</AppText> : null}
        <Button disabled={busy} label={busy ? 'Creating...' : 'Create account'} onPress={handleRegister} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { flex: 1, maxWidth: 480, width: '100%', alignSelf: 'center', justifyContent: 'center', gap: spacing.md },
  error: { color: colors.danger },
});
