import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';

export const mobileStorage = {
  get: (key: string) => AsyncStorage.getItem(key),
  set: (key: string, value: string) => AsyncStorage.setItem(key, value),
  remove: (key: string) => AsyncStorage.removeItem(key),
  async getJson<T>(key: string): Promise<T | null> {
    const value = await AsyncStorage.getItem(key);
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  },
  setJson(key: string, value: unknown) {
    return AsyncStorage.setItem(key, JSON.stringify(value));
  },
  async getSecureJson<T>(service: string): Promise<T | null> {
    try {
      const credentials = await Keychain.getGenericPassword({ service });
      if (!credentials) return null;
      return JSON.parse(credentials.password) as T;
    } catch {
      return null;
    }
  },
  setSecureJson(service: string, value: unknown) {
    return Keychain.setGenericPassword('framezoo', JSON.stringify(value), {
      service,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },
  removeSecure(service: string) {
    return Keychain.resetGenericPassword({ service });
  },
};
