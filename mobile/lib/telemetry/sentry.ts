import * as Sentry from '@sentry/react-native';
import * as Updates from 'expo-updates';
import type { ComponentType } from 'react';
import { scrubTelemetryString, scrubTelemetryValue } from './sanitize';

function sanitizeBreadcrumb(breadcrumb: Sentry.Breadcrumb): Sentry.Breadcrumb | null {
  if (breadcrumb.category === 'console') return null;
  if (/^(fetch|xhr|http)(\.|$)/i.test(breadcrumb.category || '')) {
    const data = breadcrumb.data || {};
    return {
      category: breadcrumb.category,
      type: breadcrumb.type,
      level: breadcrumb.level,
      timestamp: breadcrumb.timestamp,
      data: {
        method: typeof data.method === 'string' ? data.method : undefined,
        status_code: typeof data.status_code === 'number' ? data.status_code : undefined,
      },
    };
  }
  return {
    ...breadcrumb,
    message: breadcrumb.message ? scrubTelemetryString(breadcrumb.message) : undefined,
    data: scrubTelemetryValue(breadcrumb.data) as Record<string, unknown> | undefined,
  };
}

function sanitizeEvent<T extends Sentry.Event>(event: T): T {
  return {
    ...event,
    user: undefined,
    request: undefined,
    message: event.message ? scrubTelemetryString(event.message) : undefined,
    exception: event.exception
      ? {
          ...event.exception,
          values: event.exception.values?.map(value => ({
            ...value,
            value: value.value ? scrubTelemetryString(value.value) : value.value,
            mechanism: value.mechanism
              ? { ...value.mechanism, data: scrubTelemetryValue(value.mechanism.data) as typeof value.mechanism.data }
              : value.mechanism,
          })),
        }
      : undefined,
    fingerprint: event.fingerprint?.map(value => scrubTelemetryString(value)),
    transaction: event.transaction ? scrubTelemetryString(event.transaction) : undefined,
    spans: event.spans?.map(span => ({
      ...span,
      description: span.description ? scrubTelemetryString(span.description) : undefined,
      data: scrubTelemetryValue(span.data) as typeof span.data,
    })),
    breadcrumbs: event.breadcrumbs?.map(sanitizeBreadcrumb).filter(Boolean) as Sentry.Breadcrumb[] | undefined,
    contexts: scrubTelemetryValue(event.contexts) as Sentry.Event['contexts'],
    extra: scrubTelemetryValue(event.extra) as Sentry.Event['extra'],
    tags: scrubTelemetryValue(event.tags) as Sentry.Event['tags'],
  } as T;
}

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim() || '';
const requestedTraceRate = Number(process.env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || '0.1');
const tracesSampleRate = Number.isFinite(requestedTraceRate)
  ? Math.min(1, Math.max(0, requestedTraceRate))
  : 0.1;

Sentry.init({
  dsn,
  enabled: Boolean(dsn) && !__DEV__,
  sendDefaultPii: false,
  enableNative: true,
  enableNativeCrashHandling: true,
  enableAutoSessionTracking: true,
  attachStacktrace: true,
  maxBreadcrumbs: 50,
  normalizeDepth: 5,
  tracesSampleRate,
  beforeBreadcrumb: sanitizeBreadcrumb,
  beforeSend: event => sanitizeEvent(event),
  beforeSendTransaction: event => sanitizeEvent(event),
});

const telemetryScope = Sentry.getGlobalScope();
telemetryScope.setTag('expo-update-id', Updates.updateId || 'embedded');
telemetryScope.setTag('expo-is-embedded-update', String(Updates.isEmbeddedLaunch));

export function withTrailheadTelemetry<T extends ComponentType<any>>(component: T): T {
  return Sentry.wrap(component) as T;
}
