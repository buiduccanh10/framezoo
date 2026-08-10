import AsyncStorage from '@react-native-async-storage/async-storage';

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
};
