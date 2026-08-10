import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DeviceModeProvider } from '@/platform/DeviceModeContext';
import '@/i18n';

import { QueryProvider } from './QueryProvider';

export function AppProviders(props: { children: React.ReactNode }) {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#030303" />
      <DeviceModeProvider>
        <QueryProvider>{props.children}</QueryProvider>
      </DeviceModeProvider>
    </SafeAreaProvider>
  );
}
