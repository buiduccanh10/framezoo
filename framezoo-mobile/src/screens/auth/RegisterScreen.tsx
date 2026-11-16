import React, { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { AppText, Button, Screen, TextInput } from '@/components/primitives';
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
  const [acceptedLegal, setAcceptedLegal] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleRegister() {
    if (!nickname.trim() || !email.trim() || !password) {
      setError('Nickname, email and password are required.');
      return;
    }
    if (!acceptedLegal) {
      setError('You must confirm you are at least 16 years old and agree to the Terms and Privacy Policy.');
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
        email: email.trim().toLowerCase(),
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
        <TextInput onChangeText={(value) => setNickname(value.replace(/\s/g, ''))} placeholder="Nickname" value={nickname} />
        <TextInput autoCapitalize="none" keyboardType="email-address" onChangeText={(value) => setEmail(value.trim().toLowerCase())} placeholder="Email" value={email} />
        <TextInput autoCapitalize="none" secureTextEntry onChangeText={setPassword} placeholder="Password or passphrase" value={password} />
        <TextInput autoCapitalize="none" secureTextEntry onChangeText={setConfirmPassword} placeholder="Confirm password" value={confirmPassword} />
        <Pressable
          onPress={() => setAcceptedLegal((prev) => !prev)}
          style={styles.consentRow}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: acceptedLegal }}
        >
          <View style={[styles.checkbox, acceptedLegal && styles.checkboxChecked]}>
            {acceptedLegal ? <AppText variant="caption">✓</AppText> : null}
          </View>
          <View style={styles.consentTextWrap}>
            <AppText variant="caption">
              I confirm I am at least 16 years old and agree to the Terms of Service and Privacy Policy.
            </AppText>
            <View style={styles.legalLinks}>
              <Pressable onPress={() => Linking.openURL('https://framezoo.top/legal/terms').catch(() => undefined)}>
                <AppText variant="caption" style={styles.link}>Terms of Service</AppText>
              </Pressable>
              <AppText variant="caption"> · </AppText>
              <Pressable onPress={() => Linking.openURL('https://framezoo.top/legal/privacy').catch(() => undefined)}>
                <AppText variant="caption" style={styles.link}>Privacy Policy</AppText>
              </Pressable>
            </View>
          </View>
        </Pressable>
        {error ? <AppText style={styles.error}>{error}</AppText> : null}
        <Button disabled={busy || !acceptedLegal} label={busy ? 'Creating...' : 'Create account'} onPress={handleRegister} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { flex: 1, maxWidth: 480, width: '100%', alignSelf: 'center', justifyContent: 'center', gap: spacing.md },
  consentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  checkboxChecked: { backgroundColor: colors.accent, borderColor: colors.accent },
  consentTextWrap: { flex: 1, gap: 4 },
  legalLinks: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  link: { color: colors.accent, textDecorationLine: 'underline' },
  error: { color: colors.danger },
});
