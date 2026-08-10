import React from 'react';
import { Platform } from 'react-native';
import { createNativeBottomTabNavigator } from '@react-navigation/bottom-tabs/unstable';

import { DiscoverScreen } from '@/screens/discover/DiscoverScreen';
import { LibraryScreen } from '@/screens/library/LibraryScreen';
import { SearchScreen } from '@/screens/search/SearchScreen';
import { SettingsScreen } from '@/screens/settings/SettingsScreen';
import { colors } from '@/theme';

import type { MainTabParamList } from './routeTypes';

const Tab = createNativeBottomTabNavigator<MainTabParamList>();
const isIOS26OrLater = Platform.OS === 'ios' && Number(Platform.Version) >= 26;

export function MobileNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textDimmed,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
        tabBarLabelVisibilityMode: 'labeled',
        tabBarControllerMode: 'auto',
        tabBarMinimizeBehavior: isIOS26OrLater ? 'onScrollDown' : 'auto',
      }}
    >
      <Tab.Screen
        name="Discover"
        component={DiscoverScreen}
        options={{
          title: 'Discover',
          tabBarLabel: 'Discover',
          tabBarIcon: () =>
            Platform.OS === 'ios'
              ? { type: 'sfSymbol', name: 'sparkles' }
              : { type: 'image', source: { uri: 'ic_tab_discover' } },
        }}
      />
      <Tab.Screen
        name="Search"
        component={SearchScreen}
        options={{
          title: 'Search',
          tabBarLabel: 'Search',
          tabBarIcon: () =>
            Platform.OS === 'ios'
              ? { type: 'sfSymbol', name: 'magnifyingglass' }
              : { type: 'image', source: { uri: 'ic_tab_search' } },
        }}
      />
      <Tab.Screen
        name="Library"
        component={LibraryScreen}
        options={{
          title: 'Library',
          tabBarLabel: 'Library',
          tabBarIcon: () =>
            Platform.OS === 'ios'
              ? { type: 'sfSymbol', name: 'books.vertical' }
              : { type: 'image', source: { uri: 'ic_tab_library' } },
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          title: 'Settings',
          tabBarLabel: 'Settings',
          tabBarIcon: () =>
            Platform.OS === 'ios'
              ? { type: 'sfSymbol', name: 'gearshape' }
              : { type: 'image', source: { uri: 'ic_tab_settings' } },
        }}
      />
    </Tab.Navigator>
  );
}
