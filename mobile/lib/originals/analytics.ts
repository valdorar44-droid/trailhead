import { api } from '../api';
import {
  sanitizeOriginalsAnalyticsPayload,
  type OriginalsAnalyticsEvent,
  type OriginalsAnalyticsInput,
} from './analyticsPayload';

/** Best-effort by design: analytics must never alter an Originals session. */
export function trackOriginalsAnalyticsEvent(
  eventType: OriginalsAnalyticsEvent,
  input: OriginalsAnalyticsInput,
) {
  const payload = sanitizeOriginalsAnalyticsPayload(eventType, input);
  if (!payload) return;
  try {
    void api.logAnalyticsEvent(eventType, payload.sessionId, payload.eventData).catch(() => {});
  } catch {
    // Some native/network failures can throw before returning a Promise.
  }
}

export * from './analyticsPayload';
