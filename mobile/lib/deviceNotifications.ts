import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { api } from './api';
import { accountStorage, storage } from './storage';

const EXPO_PROJECT_ID = '92c016d2-6e63-480e-a483-a6898d7e77d5';
const PUSH_TOKEN_STORAGE_KEY = 'trailhead_push_token';

export type NotificationRegistrationResult = 'registered' | 'denied' | 'unavailable';

export async function enableAccountNotifications(): Promise<NotificationRegistrationResult> {
  if (Platform.OS === 'web') return 'unavailable';
  const storageEpoch = accountStorage.epoch();
  try {
    const current = await Notifications.getPermissionsAsync();
    const permission = current.status === 'granted'
      ? current
      : current.canAskAgain
        ? await Notifications.requestPermissionsAsync()
        : current;
    if (permission.status !== 'granted') return 'denied';

    const token = (await Notifications.getExpoPushTokenAsync({ projectId: EXPO_PROJECT_ID })).data;
    const registered = await accountStorage.run(async () => {
      await api.registerPushToken(token);
      await storage.set(PUSH_TOKEN_STORAGE_KEY, token);
      return true;
    }, storageEpoch);
    return registered ? 'registered' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

export async function removeAccountPushToken(authToken?: string) {
  let cleanupError: unknown = null;
  try {
    await api.deletePushToken(authToken);
  } catch (error) {
    cleanupError = error;
  }
  try {
    await removeLocalPushRegistration();
  } catch (error) {
    cleanupError ??= error;
  }
  if (cleanupError) throw cleanupError;
}

export async function removeLocalPushRegistration() {
  let cleanupError: unknown = null;
  if (Platform.OS !== 'web') {
    try {
      await Notifications.unregisterForNotificationsAsync();
    } catch (error) {
      cleanupError ??= error;
    }
  }
  try {
    await storage.del(PUSH_TOKEN_STORAGE_KEY);
  } catch (error) {
    cleanupError ??= error;
  }
  if (cleanupError) throw cleanupError;
}
