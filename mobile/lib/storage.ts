/**
 * Device-only secure storage — WHEN_UNLOCKED_THIS_DEVICE_ONLY prevents iOS
 * from syncing keychain items to iCloud, which stops the "Sign into Apple
 * account" system prompt that fires whenever iCloud Keychain tries to sync.
 */
import * as SecureStore from 'expo-secure-store';

const OPT = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const hasWebStorage = () => typeof window !== 'undefined' && !!window.localStorage;

export const storage = {
  get: (key: string) => {
    if (hasWebStorage()) return Promise.resolve(window.localStorage.getItem(key));
    return SecureStore.getItemAsync(key, OPT);
  },
  set: (key: string, value: string) => {
    if (hasWebStorage()) {
      window.localStorage.setItem(key, value);
      return Promise.resolve();
    }
    return SecureStore.setItemAsync(key, value, OPT);
  },
  del: (key: string) => {
    if (hasWebStorage()) {
      window.localStorage.removeItem(key);
      return Promise.resolve();
    }
    return SecureStore.deleteItemAsync(key, OPT);
  },
};
