import React from 'react';
import { Platform } from 'react-native';
import { Ionicons } from '@react-native-vector-icons/ionicons/static';
import { MaterialIcons } from '@react-native-vector-icons/material-icons/static';

export type PlatformIconName =
  | 'discover'
  | 'search'
  | 'library'
  | 'settings'
  | 'addons'
  | 'account'
  | 'preferences'
  | 'appearance'
  | 'captions'
  | 'torrent'
  | 'backend'
  | 'language'
  | 'playback'
  | 'bookmark'
  | 'history'
  | 'migration'
  | 'trash'
  | 'logout'
  | 'edit'
  | 'chevronRight'
  | 'check'
  | 'refresh';

const icons: Record<
  PlatformIconName,
  {
    ios: { active: string; inactive: string };
    android: { active: string; inactive: string };
  }
> = {
  discover: {
    ios: { active: 'sparkles', inactive: 'sparkles-outline' },
    android: { active: 'auto-awesome', inactive: 'auto-awesome' },
  },
  search: {
    ios: { active: 'search', inactive: 'search-outline' },
    android: { active: 'search', inactive: 'search' },
  },
  library: {
    ios: { active: 'library', inactive: 'library-outline' },
    android: { active: 'video-library', inactive: 'video-library' },
  },
  settings: {
    ios: { active: 'settings', inactive: 'settings-outline' },
    android: { active: 'settings', inactive: 'settings' },
  },
  addons: {
    ios: { active: 'extension-puzzle', inactive: 'extension-puzzle-outline' },
    android: { active: 'extension', inactive: 'extension' },
  },
  account: {
    ios: { active: 'person-circle', inactive: 'person-circle-outline' },
    android: { active: 'account-circle', inactive: 'account-circle' },
  },
  preferences: {
    ios: { active: 'options', inactive: 'options-outline' },
    android: { active: 'tune', inactive: 'tune' },
  },
  appearance: {
    ios: { active: 'color-palette', inactive: 'color-palette-outline' },
    android: { active: 'palette', inactive: 'palette' },
  },
  captions: {
    ios: { active: 'text', inactive: 'text-outline' },
    android: { active: 'closed-caption', inactive: 'closed-caption' },
  },
  torrent: {
    ios: { active: 'cloud-download', inactive: 'cloud-download-outline' },
    android: { active: 'cloud-download', inactive: 'cloud-download' },
  },
  backend: {
    ios: { active: 'server', inactive: 'server-outline' },
    android: { active: 'dns', inactive: 'dns' },
  },
  language: {
    ios: { active: 'language', inactive: 'language-outline' },
    android: { active: 'language', inactive: 'language' },
  },
  playback: {
    ios: { active: 'play-circle', inactive: 'play-circle-outline' },
    android: { active: 'play-circle-filled', inactive: 'play-circle-outline' },
  },
  bookmark: {
    ios: { active: 'bookmark', inactive: 'bookmark-outline' },
    android: { active: 'bookmark', inactive: 'bookmark-border' },
  },
  history: {
    ios: { active: 'time', inactive: 'time-outline' },
    android: { active: 'history', inactive: 'history' },
  },
  migration: {
    ios: { active: 'swap-horizontal', inactive: 'swap-horizontal-outline' },
    android: { active: 'swap-horiz', inactive: 'swap-horiz' },
  },
  trash: {
    ios: { active: 'trash', inactive: 'trash-outline' },
    android: { active: 'delete', inactive: 'delete-outline' },
  },
  logout: {
    ios: { active: 'log-out', inactive: 'log-out-outline' },
    android: { active: 'logout', inactive: 'logout' },
  },
  edit: {
    ios: { active: 'create', inactive: 'create-outline' },
    android: { active: 'edit', inactive: 'edit' },
  },
  chevronRight: {
    ios: { active: 'chevron-forward', inactive: 'chevron-forward' },
    android: { active: 'chevron-right', inactive: 'chevron-right' },
  },
  check: {
    ios: { active: 'checkmark-circle', inactive: 'checkmark-circle-outline' },
    android: { active: 'check-circle', inactive: 'check-circle-outline' },
  },
  refresh: {
    ios: { active: 'refresh', inactive: 'refresh-outline' },
    android: { active: 'refresh', inactive: 'refresh' },
  },
};

export function PlatformIcon(props: {
  name: PlatformIconName;
  size?: number;
  color: string;
  focused?: boolean;
}) {
  const icon = icons[props.name];
  const variant = props.focused ? 'active' : 'inactive';
  const size = props.size ?? 22;

  if (Platform.OS === 'ios') {
    return (
      <Ionicons
        name={icon.ios[variant] as never}
        size={size}
        color={props.color}
      />
    );
  }

  return (
    <MaterialIcons
      name={icon.android[variant] as never}
      size={size}
      color={props.color}
    />
  );
}
