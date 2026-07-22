import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';
import type { ComponentType } from 'react';
import { sanitizeTelemetryBreadcrumb, sanitizeTelemetryEvent } from './sanitize';
import { traceSampleRateFor } from './sampling';

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim() || '';
const requestedTraceRate = Number(process.env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || '0.1');
const tracesSampleRate = Number.isFinite(requestedTraceRate)
  ? Math.min(1, Math.max(0, requestedTraceRate))
  : 0.1;

Sentry.init({
  dsn,
  enabled: Boolean(dsn) && !__DEV__,
  sendDefaultPii: false,
  // Native envelopes bypass the JavaScript allowlist. Keep native delivery off
  // until equivalent Android/iOS filtering exists and passes privacy fixtures.
  enableNative: false,
  enableNativeCrashHandling: false,
  enableAutoSessionTracking: false,
  enableAppStartTracking: false,
  enableNativeFramesTracking: false,
  enableNativeNagger: false,
  attachStacktrace: true,
  maxBreadcrumbs: 0,
  normalizeDepth: 3,
  tracesSampler: context => traceSampleRateFor(context, tracesSampleRate),
  beforeBreadcrumb: sanitizeTelemetryBreadcrumb,
  beforeSend: event => sanitizeTelemetryEvent(event),
  beforeSendTransaction: event => sanitizeTelemetryEvent(event),
});

const telemetryScope = Sentry.getGlobalScope();
const nativeBuild = Platform.OS === 'ios'
  ? Constants.platform?.ios?.buildNumber
  : Constants.platform?.android?.versionCode;
telemetryScope.setTags({
  app_build: String(nativeBuild || 'unknown'),
  app_version: Constants.expoConfig?.version || 'unknown',
  expo_is_embedded_update: String(Updates.isEmbeddedLaunch),
  expo_update_id: Updates.updateId || 'embedded',
  platform: Platform.OS,
  release_channel: Updates.channel || 'embedded',
  runtime_version: Updates.runtimeVersion || 'unknown',
});

export function withTrailheadTelemetry<T extends ComponentType<any>>(component: T): T {
  return Sentry.wrap(component) as T;
}
