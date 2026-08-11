import React from 'react';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useDeviceMode } from '@/platform/DeviceModeContext';
import { AddonsScreen } from '@/screens/addons/AddonsScreen';
import { DetailsScreen } from '@/screens/details/DetailsScreen';
import { MigrationScreen } from '@/screens/migration/MigrationScreen';
import { PlayerScreen } from '@/screens/player/PlayerScreen';
import { colors } from '@/theme';

import { AuthNavigator } from './AuthNavigator';
import { MobileNavigator } from './MobileNavigator';
import type { RootStackParamList } from './routeTypes';
import { TVNavigator } from './TVNavigator';

const Stack = createNativeStackNavigator<RootStackParamList>();

const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.background,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    primary: colors.accent,
  },
};

export function RootNavigator() {
  const { isTV } = useDeviceMode();

  return (
    <NavigationContainer theme={navigationTheme}>
      <Stack.Navigator
        initialRouteName="Main"
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '800' },
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen
          name="Main"
          component={isTV ? TVNavigator : MobileNavigator}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Auth"
          component={AuthNavigator}
          options={{ headerShown: false, presentation: 'modal' }}
        />
        <Stack.Screen
          name="Details"
          component={DetailsScreen}
          options={{
            headerTransparent: true,
            headerStyle: { backgroundColor: 'transparent' },
            headerTitle: '',
            headerShadowVisible: false,
          }}
        />
        <Stack.Screen name="Player" component={PlayerScreen} options={{ headerShown: false, orientation: 'landscape' }} />
        <Stack.Screen name="Addons" component={AddonsScreen} options={{ title: 'Addons' }} />
        <Stack.Screen name="Settings" component={require('@/screens/settings/SettingsScreen').SettingsScreen} options={{ title: 'Settings' }} />
        <Stack.Screen name="Migration" component={MigrationScreen} options={{ title: 'Migration' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
