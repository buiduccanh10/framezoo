import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { BackendScreen } from '@/screens/auth/BackendScreen';
import { LoginScreen } from '@/screens/auth/LoginScreen';
import { RegisterScreen } from '@/screens/auth/RegisterScreen';
import { colors } from '@/theme';

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  Backend: undefined;
};

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Register" component={RegisterScreen} options={{ title: 'Create account' }} />
      <Stack.Screen name="Backend" component={BackendScreen} options={{ title: 'Backend' }} />
    </Stack.Navigator>
  );
}
