/**
 * Device-only secure storage — WHEN_UNLOCKED_THIS_DEVICE_ONLY prevents iOS
 * from syncing keychain items to iCloud, which stops the "Sign into Apple
 * account" system prompt that fires whenever iCloud Keychain tries to sync.
 */
import * as SecureStore from 'expo-secure-store';

const OPT = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export const storage = {
  get: (key: string) => SecureStore.getItemAsync(key, OPT),
  set: (key: string, value: string) => SecureStore.setItemAsync(key, value, OPT),
  del: (key: string) => SecureStore.deleteItemAsync(key, OPT),
};
