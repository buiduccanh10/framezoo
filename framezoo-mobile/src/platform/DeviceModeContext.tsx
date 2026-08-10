import React, { createContext, useContext, useMemo } from 'react';
import { Platform } from 'react-native';

export type DeviceMode = 'mobile' | 'tv';

const DeviceModeContext = createContext<DeviceMode>('mobile');

export function DeviceModeProvider(props: {
  children: React.ReactNode;
  mode?: DeviceMode;
}) {
  const mode = props.mode ?? (Platform.isTV ? 'tv' : 'mobile');
  return (
    <DeviceModeContext.Provider value={mode}>
      {props.children}
    </DeviceModeContext.Provider>
  );
}

export function useDeviceMode() {
  const mode = useContext(DeviceModeContext);
  return useMemo(
    () => ({ mode, isTV: mode === 'tv', isMobile: mode === 'mobile' }),
    [mode],
  );
}
