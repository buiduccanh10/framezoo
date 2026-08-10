import React, { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { persistAuth, persistBackendUrl, persistPreferences } from '@/app/bootstrap';
import { getSessions, deleteAccount, removeSession, updateAccount, updateSession, type MobileSession } from '@/services/account';
import { getSettings, updateSettings } from '@/services/settings';
import { AppText, Button, ErrorState, LoadingState, Screen, TextInput } from '@/components/primitives';
import { ChoiceChips, SettingsCard, SettingsItem, SettingsSection, SettingsToggle } from '@/components/navigation';
import type { RootStackParamList } from '@/navigation/routeTypes';
import { useAuthStore } from '@/state/auth/store';
import { usePreferencesStore } from '@/state/preferences/store';
import { useSubtitleStore } from '@/state/subtitles/store';
import { useThemeStore } from '@/state/theme/store';
import { colors, spacing } from '@/theme';
import type { AccountWithToken } from '@/types';

const DEFAULT_TORRENT_SIZE = String(5 * 1024 * 1024 * 1024);
const TORRENT_SIZES = [
  { label: '2 GB', value: String(2 * 1024 * 1024 * 1024) },
  { label: '5 GB', value: DEFAULT_TORRENT_SIZE },
  { label: '10 GB', value: String(10 * 1024 * 1024 * 1024) },
  { label: '50 GB', value: String(50 * 1024 * 1024 * 1024) },
  { label: 'Unlimited', value: '1099511627776000' },
];
const PROFILE_COLORS = [
  { label: 'Ember', value: colors.accent },
  { label: 'Crimson', value: '#B30000' },
  { label: 'Gold', value: '#D99424' },
  { label: 'Ocean', value: '#1F8ECF' },
];

interface SettingsDraft {
  backendUrl: string;
  language: string;
  theme: string;
  autoplay: boolean;
  skipCredits: boolean;
  autoSkipSegments: boolean;
  autoResumeOnPlaybackError: boolean;
  enableDoubleClickToSeek: boolean;
  proxyTmdb: boolean;
  subtitleLanguage: string;
  subtitleFontSize: number;
  subtitleDelayMs: number;
  torrentMaxSizeBytes: string;
  nickname: string;
  deviceName: string;
  colorA: string;
  colorB: string;
  icon: string;
}

function makeDraft(account: AccountWithToken | null, backendUrl: string): SettingsDraft {
  const preferences = usePreferencesStore.getState();
  const subtitles = useSubtitleStore.getState();
  return {
    backendUrl,
    language: preferences.language,
    theme: preferences.theme,
    autoplay: preferences.autoplay,
    skipCredits: preferences.skipCredits,
    autoSkipSegments: preferences.autoSkipSegments,
    autoResumeOnPlaybackError: preferences.autoResumeOnPlaybackError,
    enableDoubleClickToSeek: preferences.enableDoubleClickToSeek,
    proxyTmdb: preferences.proxyTmdb,
    subtitleLanguage: subtitles.language,
    subtitleFontSize: subtitles.fontSize,
    subtitleDelayMs: subtitles.delayMs,
    torrentMaxSizeBytes: preferences.torrentMaxSizeBytes || DEFAULT_TORRENT_SIZE,
    nickname: account?.nickname ?? '',
    deviceName: account?.deviceName ?? 'Framezoo',
    colorA: account?.profile.colorA ?? colors.accent,
    colorB: account?.profile.colorB ?? colors.accentStrong,
    icon: account?.profile.icon ?? 'user',
  };
}

function normalizeBackendUrl(value: string) {
  const normalized = value.trim().replace(/\/+$/, '');
  if (!normalized) return '';
  if (/^https?:\/\//i.test(normalized)) return normalized;
  return `https://${normalized}`;
}

function formatBytes(value: string) {
  if (value === '1099511627776000') return 'Unlimited';
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return 'Unknown';
  return `${Math.round(bytes / 1024 / 1024 / 1024)} GB`;
}

function sessionLabel(session: MobileSession) {
  const userAgent = session.userAgent ?? '';
  const platform = /Android/i.test(userAgent)
    ? 'Android'
    : /iPhone|iPad|iPod/i.test(userAgent)
      ? 'iOS'
      : /Macintosh|Mac OS/i.test(userAgent)
        ? 'macOS'
        : /Windows/i.test(userAgent)
          ? 'Windows'
          : 'Unknown';
  return `${session.device || 'Unnamed device'} · ${platform}`;
}

export function SettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const account = useAuthStore((state) => state.account);
  const backendUrl = useAuthStore((state) => state.backendUrl);
  const setAccount = useAuthStore((state) => state.setAccount);
  const setBackendUrl = useAuthStore((state) => state.setBackendUrl);
  const [draft, setDraft] = useState(() => makeDraft(account, backendUrl));
  const [baseline, setBaseline] = useState(() => makeDraft(account, backendUrl));
  const [sessions, setSessions] = useState<MobileSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(baseline),
    [baseline, draft],
  );

  useEffect(() => {
    let cancelled = false;
    const localDraft = makeDraft(account, backendUrl);
    setDraft(localDraft);
    setBaseline(localDraft);
    setError('');
    setNotice('');
    setSessions([]);

    if (!account || !backendUrl) return;
    setLoading(true);
    Promise.all([getSettings(backendUrl, account), getSessions(backendUrl, account)])
      .then(([remote, remoteSessions]) => {
        if (cancelled) return;
        const next = {
          ...localDraft,
          language: remote.applicationLanguage ?? localDraft.language,
          theme: remote.applicationTheme ?? localDraft.theme,
          subtitleLanguage: remote.defaultSubtitleLanguage ?? localDraft.subtitleLanguage,
          autoplay: remote.enableAutoplay ?? localDraft.autoplay,
          skipCredits: remote.enableSkipCredits ?? localDraft.skipCredits,
          autoSkipSegments: remote.enableAutoSkipSegments ?? localDraft.autoSkipSegments,
          autoResumeOnPlaybackError:
            remote.enableAutoResumeOnPlaybackError ?? localDraft.autoResumeOnPlaybackError,
          enableDoubleClickToSeek:
            remote.enableDoubleClickToSeek ?? localDraft.enableDoubleClickToSeek,
          proxyTmdb: remote.proxyTmdb ?? localDraft.proxyTmdb,
          torrentMaxSizeBytes: remote.torrentMaxSizeBytes ?? localDraft.torrentMaxSizeBytes,
        };
        setDraft(next);
        setBaseline(next);
        setSessions(remoteSessions);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Could not load account settings.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [account?.userId, backendUrl]);

  function updateDraft<K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setNotice('');
  }

  function resetDraft() {
    setDraft(baseline);
    setNotice('');
    setError('');
  }

  async function commit(next: SettingsDraft, currentAccount: AccountWithToken | null, currentBackend: string) {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      if (currentAccount && currentBackend) {
        await updateSettings(currentBackend, currentAccount, {
          applicationLanguage: next.language,
          applicationTheme: next.theme,
          defaultSubtitleLanguage: next.subtitleLanguage,
          enableAutoplay: next.autoplay,
          enableSkipCredits: next.skipCredits,
          enableAutoSkipSegments: next.autoSkipSegments,
          enableAutoResumeOnPlaybackError: next.autoResumeOnPlaybackError,
          enableDoubleClickToSeek: next.enableDoubleClickToSeek,
          proxyTmdb: next.proxyTmdb,
          torrentMaxSizeBytes: next.torrentMaxSizeBytes,
        });

        if (
          next.nickname !== currentAccount.nickname ||
          next.colorA !== currentAccount.profile.colorA ||
          next.colorB !== currentAccount.profile.colorB ||
          next.icon !== currentAccount.profile.icon
        ) {
          await updateAccount(currentBackend, currentAccount, {
            nickname: next.nickname.trim() || currentAccount.nickname,
            profile: { colorA: next.colorA, colorB: next.colorB, icon: next.icon },
          });
        }

        if (next.deviceName.trim() && next.deviceName.trim() !== currentAccount.deviceName) {
          await updateSession(currentBackend, currentAccount, next.deviceName.trim());
        }
      }

      const nextAccount =
        currentAccount && next.backendUrl === currentBackend
          ? {
              ...currentAccount,
              nickname: next.nickname.trim() || currentAccount.nickname,
              deviceName: next.deviceName.trim() || currentAccount.deviceName,
              profile: { colorA: next.colorA, colorB: next.colorB, icon: next.icon },
            }
          : currentAccount && next.backendUrl !== currentBackend
            ? null
            : currentAccount;

      const preferences = usePreferencesStore.getState();
      const subtitles = useSubtitleStore.getState();
      preferences.setLanguage(next.language);
      preferences.setTheme(next.theme);
      preferences.setAutoplay(next.autoplay);
      preferences.setSkipCredits(next.skipCredits);
      preferences.setAutoSkipSegments(next.autoSkipSegments);
      preferences.setAutoResumeOnPlaybackError(next.autoResumeOnPlaybackError);
      preferences.setEnableDoubleClickToSeek(next.enableDoubleClickToSeek);
      preferences.setProxyTmdb(next.proxyTmdb);
      preferences.setTorrentMaxSizeBytes(next.torrentMaxSizeBytes);
      subtitles.setLanguage(next.subtitleLanguage);
      subtitles.setFontSize(next.subtitleFontSize);
      subtitles.setDelayMs(next.subtitleDelayMs);
      useThemeStore.getState().setThemeId(next.theme);
      setAccount(nextAccount);
      setBackendUrl(next.backendUrl);
      await Promise.all([persistAuth(), persistBackendUrl(), persistPreferences()]);
      setDraft(next);
      setBaseline(next);
      setSessions(nextAccount ? sessions : []);
      setNotice(nextAccount ? 'Settings saved.' : 'Backend changed. Sign in again to sync account data.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  }

  function save() {
    const next = { ...draft, backendUrl: normalizeBackendUrl(draft.backendUrl) };
    if (!next.backendUrl) {
      setError('Backend URL is required.');
      return;
    }
    if (account && next.backendUrl !== backendUrl) {
      Alert.alert(
        'Change backend',
        'Changing backend signs out this device. Continue?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Confirm', style: 'destructive', onPress: () => void commit(next, account, backendUrl) },
        ],
      );
      return;
    }
    void commit(next, account, backendUrl);
  }

  function logout() {
    setAccount(null);
    persistAuth().catch(() => undefined);
    setNotice('Signed out on this device.');
  }

  function deleteCurrentAccount() {
    if (!account || !backendUrl) return;
    Alert.alert('Delete account', 'This permanently deletes the account and synced data.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void deleteAccount(backendUrl, account)
            .then(() => {
              setAccount(null);
              return persistAuth();
            })
            .then(() => setNotice('Account deleted.'))
            .catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not delete account.'));
        },
      },
    ]);
  }

  function signOutAllDevices() {
    if (!account || !backendUrl) return;
    void Promise.all(
      sessions
        .filter((session) => session.id !== account.sessionId)
        .map((session) => removeSession(backendUrl, account, session.id)),
    )
      .then(() => {
        logout();
        setSessions([]);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not sign out other devices.'));
  }

  function removeDevice(session: MobileSession) {
    if (!account || !backendUrl) return;
    void removeSession(backendUrl, account, session.id)
      .then(() => setSessions((current) => current.filter((item) => item.id !== session.id)))
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not remove device.'));
  }

  if (loading) {
    return <LoadingState label="Loading settings..." />;
  }

  return (
    <Screen scroll padded>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <AppText variant="heading">Settings</AppText>
          <AppText variant="muted">{account ? `Signed in as ${account.nickname}` : 'Local mode'}</AppText>
        </View>
        {dirty ? <AppText style={styles.unsaved}>Unsaved changes</AppText> : null}
      </View>
      {error ? <ErrorState message={error} /> : null}
      {notice ? <AppText style={styles.notice}>{notice}</AppText> : null}

      <SettingsSection icon="account" title="Account" description="Profile, devices and account actions.">
        {!account ? (
          <SettingsCard title="Use Framezoo with an account" description="Sign in only when you need synced bookmarks, history or progress.">
            <Button label="Sign in" onPress={() => navigation.navigate('Auth')} />
          </SettingsCard>
        ) : (
          <>
            <SettingsCard title="Profile" description="These details are synced to your backend." icon="account">
              <View style={styles.profilePreview}>
                <View style={[styles.avatar, { backgroundColor: draft.colorA }]}>
                  <AppText variant="title">{draft.nickname.slice(0, 1).toUpperCase() || 'F'}</AppText>
                </View>
                <View style={styles.profileCopy}>
                  <AppText variant="title">{draft.nickname || 'Framezoo user'}</AppText>
                  <AppText variant="muted">{account.email ?? 'No email shown'}</AppText>
                </View>
              </View>
              <TextInput
                autoCapitalize="none"
                onChangeText={(value) => updateDraft('nickname', value)}
                placeholder="Nickname"
                value={draft.nickname}
              />
              <AppText variant="label">Profile color</AppText>
              <ChoiceChips
                options={PROFILE_COLORS}
                value={draft.colorA}
                onChange={(value) => updateDraft('colorA', value)}
              />
              <AppText variant="caption">The selected color is used for your account avatar.</AppText>
            </SettingsCard>

            <SettingsCard title="Current device" description="Rename this mobile or TV session." icon="settings">
              <TextInput
                onChangeText={(value) => updateDraft('deviceName', value)}
                placeholder="Framezoo"
                value={draft.deviceName}
              />
            </SettingsCard>

            <SettingsCard title="Signed-in devices" description="Remove sessions you no longer recognize." icon="account">
              {sessions.length ? (
                sessions.map((session) => (
                  <SettingsItem
                    key={session.id}
                    icon="account"
                    title={sessionLabel(session)}
                    description={session.id === account.sessionId ? 'Current device' : `Last active ${new Date(session.accessedAt).toLocaleString()}`}
                    onPress={session.id === account.sessionId ? undefined : () => removeDevice(session)}
                    value={session.id === account.sessionId ? 'Current' : 'Remove'}
                  />
                ))
              ) : (
                <AppText variant="muted">No device sessions returned.</AppText>
              )}
              <Button compact label="Sign out all other devices" onPress={signOutAllDevices} variant="secondary" />
            </SettingsCard>

            <SettingsCard title="Account actions" icon="settings">
              <Button label="Log out" onPress={logout} variant="danger" />
              <Button label="Migration" onPress={() => navigation.navigate('Migration')} variant="secondary" />
              <Button label="Delete account" onPress={deleteCurrentAccount} variant="danger" />
            </SettingsCard>
          </>
        )}
      </SettingsSection>

      <SettingsSection icon="preferences" title="Preferences" description="Playback behavior, language and metadata options.">
        <SettingsCard title="Language" description="Choose the app language." icon="language">
          <ChoiceChips
            options={[
              { label: 'English', value: 'en' },
              { label: 'Vietnamese', value: 'vi' },
            ]}
            value={draft.language}
            onChange={(value) => updateDraft('language', value)}
          />
        </SettingsCard>
        <SettingsCard title="Autoplay" description="Autoplay is native-safe on mobile and TV." icon="playback">
          <SettingsToggle title="Autoplay" value={draft.autoplay} locked />
          <SettingsToggle
            title="Skip credits"
            description="Skip marked credits when metadata provides them."
            value={draft.skipCredits}
            onChange={(value) => updateDraft('skipCredits', value)}
          />
          <SettingsToggle
            title="Auto-skip segments"
            description="Skip intro or outro segments when available."
            value={draft.autoSkipSegments}
            onChange={(value) => updateDraft('autoSkipSegments', value)}
          />
        </SettingsCard>
        <SettingsCard title="Playback recovery" description="Recover from transient stream errors." icon="playback">
          <SettingsToggle
            title="Resume after playback error"
            value={draft.autoResumeOnPlaybackError}
            onChange={(value) => updateDraft('autoResumeOnPlaybackError', value)}
          />
          <SettingsToggle
            title="Double-tap seek"
            description="Available after native player integration."
            value={draft.enableDoubleClickToSeek}
            onChange={(value) => updateDraft('enableDoubleClickToSeek', value)}
            locked
          />
          <SettingsToggle
            title="Backend metadata proxy"
            description="Use backend metadata adapters when enabled."
            value={draft.proxyTmdb}
            onChange={(value) => updateDraft('proxyTmdb', value)}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection icon="appearance" title="Appearance" description="Native theme choices keep the Ember visual language.">
        <SettingsCard title="Theme" description="More theme palettes can be added without changing navigation." icon="appearance">
          <ChoiceChips
            options={[{ label: 'Ember', value: 'ember' }]}
            value={draft.theme}
            onChange={(value) => updateDraft('theme', value)}
          />
          <View style={styles.themePreview}>
            <View style={[styles.themeDot, { backgroundColor: colors.accent }]} />
            <View style={[styles.themeDot, { backgroundColor: colors.accentStrong }]} />
            <View style={styles.themePreviewCopy}>
              <AppText variant="label">Ember</AppText>
              <AppText variant="caption">Framezoo default</AppText>
            </View>
          </View>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection icon="captions" title="Subtitles" description="Subtitle language, size and timing.">
        <SettingsCard title="Subtitle language" icon="captions">
          <ChoiceChips
            options={[
              { label: 'English', value: 'en' },
              { label: 'Vietnamese', value: 'vi' },
              { label: 'Original', value: 'original' },
            ]}
            value={draft.subtitleLanguage}
            onChange={(value) => updateDraft('subtitleLanguage', value)}
          />
        </SettingsCard>
        <SettingsCard title="Subtitle size" description="Applied by the native player adapter." icon="captions">
          <ChoiceChips
            options={[
              { label: 'Small', value: '16' },
              { label: 'Medium', value: '18' },
              { label: 'Large', value: '22' },
              { label: 'XL', value: '26' },
            ]}
            value={String(draft.subtitleFontSize)}
            onChange={(value) => updateDraft('subtitleFontSize', Number(value))}
          />
        </SettingsCard>
        <SettingsCard title="Subtitle delay" description="Use when subtitle timing needs a small correction." icon="captions">
          <ChoiceChips
            options={[
              { label: '-2s', value: '-2000' },
              { label: '-1s', value: '-1000' },
              { label: '0s', value: '0' },
              { label: '+1s', value: '1000' },
              { label: '+2s', value: '2000' },
            ]}
            value={String(draft.subtitleDelayMs)}
            onChange={(value) => updateDraft('subtitleDelayMs', Number(value))}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection icon="torrent" title="Torrent cache" description="User-installed stream addons only. Native torrent cache is prepared for the libtorrent phase.">
        <SettingsCard title="Maximum cache size" description="This preference is stored now and consumed by the native torrent engine later." icon="torrent">
          <ChoiceChips
            options={TORRENT_SIZES}
            value={draft.torrentMaxSizeBytes}
            onChange={(value) => updateDraft('torrentMaxSizeBytes', value)}
          />
          <SettingsItem title="Current configured limit" value={formatBytes(draft.torrentMaxSizeBytes)} />
          <Button compact label="Clear cache" onPress={() => setNotice('Cache clear becomes available with the native libtorrent adapter.')} variant="secondary" />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection icon="addons" title="Addons and backend" description="Sources remain user-installed and generic by resource type.">
        <SettingsCard title="Backend URL" description="Matches the desktop backend selector flow." icon="backend">
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            onChangeText={(value) => updateDraft('backendUrl', value)}
            placeholder="https://backend.example.com"
            value={draft.backendUrl}
          />
          <AppText variant="caption">Changing backend while signed in signs out this device after confirmation.</AppText>
        </SettingsCard>
        <SettingsCard title="Addon manager" description="Install catalog, metadata, stream or subtitle manifests." icon="addons">
          <Button label="Manage addons" onPress={() => navigation.navigate('Addons')} />
        </SettingsCard>
      </SettingsSection>

      <View style={styles.saveBar}>
        <Button compact label="Reset" onPress={resetDraft} disabled={!dirty || saving} variant="secondary" />
        <Button label={saving ? 'Saving...' : 'Save settings'} onPress={save} disabled={!dirty || saving} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: spacing.xl },
  headerCopy: { gap: spacing.xs },
  unsaved: { color: colors.warning, marginTop: spacing.md },
  notice: { color: colors.success, marginBottom: spacing.lg },
  profilePreview: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  profileCopy: { flex: 1, gap: spacing.xs },
  themePreview: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: 12, backgroundColor: colors.background },
  themeDot: { width: 24, height: 24, borderRadius: 12 },
  themePreviewCopy: { gap: spacing.xs },
  saveBar: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, paddingVertical: spacing.lg, marginBottom: spacing.xxl },
});
