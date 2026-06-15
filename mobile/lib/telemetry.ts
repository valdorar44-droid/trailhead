import { api } from '@/lib/api';

const sentKeys = new Set<string>();

export function trackPhase0Event(eventType: string, eventData: Record<string, unknown> = {}) {
  api.logAnalyticsEvent(eventType, '', eventData).catch(() => {});
}

export function trackPhase0Once(key: string, eventType: string, eventData: Record<string, unknown> = {}) {
  if (!key || sentKeys.has(key)) return;
  sentKeys.add(key);
  trackPhase0Event(eventType, eventData);
}
