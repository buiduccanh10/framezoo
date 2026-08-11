import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { AppText } from '@/components/primitives/AppText';
import { PlatformIcon, type PlatformIconName } from '@/components/navigation';
import { DiscoverScreen } from '@/screens/discover/DiscoverScreen';
import { LibraryScreen } from '@/screens/library/LibraryScreen';
import { SearchScreen } from '@/screens/search/SearchScreen';
import { SettingsScreen } from '@/screens/settings/SettingsScreen';
import { colors, spacing } from '@/theme';

import type { RootStackParamList } from './routeTypes';

type TVSection = 'Discover' | 'Search' | 'Library' | 'Settings';

const items: Array<{ id: TVSection; label: string; icon: PlatformIconName }> = [
  { id: 'Discover', label: 'Discover', icon: 'discover' },
  { id: 'Search', label: 'Search', icon: 'search' },
  { id: 'Library', label: 'Library', icon: 'library' },
  { id: 'Settings', label: 'Settings', icon: 'settings' },
];

export function TVNavigator() {
  const [section, setSection] = useState<TVSection>('Discover');
  const [focusedItem, setFocusedItem] = useState<TVSection | 'Addons'>('Discover');
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const screen =
    section === 'Discover' ? <DiscoverScreen /> :
    section === 'Search' ? <SearchScreen /> :
    section === 'Library' ? <LibraryScreen /> :
    <SettingsScreen />;

  return (
    <View style={styles.shell}>
      <View style={styles.rail}>
        <AppText variant="heading" style={styles.logo}>FZ</AppText>
        {items.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            onPress={() => setSection(item.id)}
            onFocus={() => setFocusedItem(item.id)}
            hasTVPreferredFocus={item.id === 'Discover'}
            style={[
              styles.railItem,
              section === item.id && styles.active,
              focusedItem === item.id && styles.focused,
            ]}
          >
            <PlatformIcon name={item.icon} size={24} color={colors.accent} focused={focusedItem === item.id} />
            <AppText style={styles.railLabel}>{item.label}</AppText>
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('Addons')}
          onFocus={() => setFocusedItem('Addons')}
          hasTVPreferredFocus={false}
          style={[styles.railItem, focusedItem === 'Addons' && styles.focused]}
        >
          <PlatformIcon name="addons" size={24} color={colors.accent} focused={focusedItem === 'Addons'} />
          <AppText style={styles.railLabel}>Addons</AppText>
        </Pressable>
      </View>
      <View style={styles.content}>{screen}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, flexDirection: 'row', backgroundColor: colors.background },
  rail: { width: 176, backgroundColor: colors.surface, padding: spacing.lg, paddingTop: 48, gap: spacing.sm },
  logo: { color: colors.accent, marginBottom: spacing.xl, textAlign: 'center' },
  railItem: { minHeight: 56, borderRadius: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  active: { backgroundColor: colors.surfaceRaised },
  focused: { borderWidth: 2, borderColor: colors.accent },
  railLabel: { fontWeight: '700' },
  content: { flex: 1 },
});
