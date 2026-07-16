import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

type NativeCarReportsModule = {
  setSession(accountId: string, bearerToken: string, apiBaseUrl: string): Promise<boolean>;
  clearSession(discardQueuedReports: boolean): Promise<boolean>;
  requestFlush(): Promise<boolean>;
  getQueueStatus(): Promise<CarReportQueueStatus>;
};

export type CarReportQueueStatus = {
  signedIn: boolean;
  queued: number;
  totalQueued: number;
  oldestObservedAt: number | null;
};

const NativeModule = Platform.OS === 'android'
  ? requireOptionalNativeModule<NativeCarReportsModule>('TrailheadCarReports')
  : null;

export async function setCarReportSession(
  accountId: string | number,
  bearerToken: string,
  apiBaseUrl: string,
): Promise<boolean> {
  if (!NativeModule) return false;
  return NativeModule.setSession(String(accountId), bearerToken, apiBaseUrl);
}

export async function clearCarReportSession(discardQueuedReports = true): Promise<boolean> {
  if (!NativeModule) return false;
  return NativeModule.clearSession(discardQueuedReports);
}

export async function requestCarReportFlush(): Promise<boolean> {
  if (!NativeModule) return false;
  return NativeModule.requestFlush();
}

export async function getCarReportQueueStatus(): Promise<CarReportQueueStatus> {
  if (!NativeModule) {
    return { signedIn: false, queued: 0, totalQueued: 0, oldestObservedAt: null };
  }
  return NativeModule.getQueueStatus();
}
