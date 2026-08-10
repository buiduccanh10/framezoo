import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { PlatformIcon, SettingsCard, SettingsSection } from '@/components/navigation';
import { AppText, Button, EmptyState, ErrorState, LoadingState, Screen, TextInput } from '@/components/primitives';
import { addonRepository } from '@/services/addons';
import { colors, spacing } from '@/theme';
import type { InstalledAddon } from '@/types';

export function AddonsScreen() {
  const [addons, setAddons] = useState<InstalledAddon[]>([]);
  const [manifestUrl, setManifestUrl] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      setAddons(await addonRepository.list());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load addons.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  async function install() {
    setBusy(true);
    setError('');
    try {
      const addon = await addonRepository.install(manifestUrl);
      setManifestUrl('');
      setAddons((current) => [...current.filter((item) => item.manifest.id !== addon.manifest.id), addon]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Addon installation failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll padded>
      <SettingsSection icon="addons" title="Addons" description="Install only addons you choose. Framezoo does not bundle movie providers.">
        <SettingsCard title="Install manifest" description="Catalog, metadata, stream or subtitle resources." icon="addons">
          <TextInput autoCapitalize="none" autoCorrect={false} keyboardType="url" onChangeText={setManifestUrl} placeholder="https://addon.example/manifest.json" value={manifestUrl} />
          <Button disabled={busy || !manifestUrl.trim()} label={busy ? 'Loading...' : 'Install manifest'} onPress={() => install().catch(() => undefined)} />
        </SettingsCard>
      </SettingsSection>
      {error ? <ErrorState message={error} onRetry={() => refresh().catch(() => undefined)} /> : null}
      {busy && !addons.length ? <LoadingState label="Loading addons..." /> : null}
      {!busy && !addons.length ? <EmptyState title="No installed addons" description="Install a manifest URL to add catalogs, streams or subtitles." /> : null}
      <SettingsSection icon="addons" title="Installed addons" description={`${addons.length} addon${addons.length === 1 ? '' : 's'} installed.`}>
        {addons.map((addon) => (
          <SettingsCard key={addon.manifest.id} title={addon.manifest.name} description={`${addon.manifest.id}  |  ${addon.manifest.version}`} icon="addons">
            {addon.manifest.description ? <AppText variant="muted" numberOfLines={2}>{addon.manifest.description}</AppText> : null}
            <View style={styles.resourceRow}>
              {(addon.manifest.resources ?? []).map((resource) => (
                <View key={typeof resource === 'string' ? resource : resource.name} style={styles.resource}>
                  <PlatformIcon name={resourceNameToIcon(resource)} size={15} color={colors.accent} focused />
                  <AppText variant="caption">{typeof resource === 'string' ? resource : resource.name}</AppText>
                </View>
              ))}
            </View>
            <View style={styles.actions}>
              <Button compact label={addon.enabled ? 'Disable' : 'Enable'} variant="secondary" onPress={async () => setAddons(await addonRepository.setEnabled(addon.manifest.id, !addon.enabled))} />
              <Button compact label="Remove" variant="danger" onPress={async () => setAddons(await addonRepository.remove(addon.manifest.id))} />
            </View>
          </SettingsCard>
        ))}
      </SettingsSection>
    </Screen>
  );
}

const styles = StyleSheet.create({
  subtitle: { marginTop: spacing.xs, marginBottom: spacing.xl },
  resourceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  resource: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: 999, backgroundColor: colors.surfaceRaised },
  actions: { flexDirection: 'row', gap: spacing.sm },
});

function resourceNameToIcon(resource: string | { name: string }) {
  const name = typeof resource === 'string' ? resource : resource.name;
  if (name === 'catalog' || name === 'addon_catalog') return 'library' as const;
  if (name === 'meta') return 'discover' as const;
  if (name === 'subtitles') return 'captions' as const;
  return 'torrent' as const;
}
