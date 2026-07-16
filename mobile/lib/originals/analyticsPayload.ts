export const ORIGINALS_ANALYTICS_RELEASE_COHORT = 'originals_v1' as const;

export const ORIGINALS_ANALYTICS_EVENTS = {
  downloadResult: 'originals_download_result',
  stopOutcome: 'originals_stop_outcome',
} as const;

export type OriginalsAnalyticsEvent = typeof ORIGINALS_ANALYTICS_EVENTS[keyof typeof ORIGINALS_ANALYTICS_EVENTS];

export type OriginalsAnalyticsInput = {
  pack_id?: unknown;
  version?: unknown;
  stop_id?: unknown;
  result?: unknown;
  outcome?: unknown;
  [key: string]: unknown;
};

export type SanitizedOriginalsAnalytics = {
  sessionId: string;
  eventData: Record<string, string | number>;
};

const EVENT_VALUES: Partial<Record<OriginalsAnalyticsEvent, ReadonlySet<string>>> = {
  [ORIGINALS_ANALYTICS_EVENTS.downloadResult]: new Set([
    'ready',
    'failed',
    'cancelled',
    'insufficient_storage',
    'corrupt',
  ]),
  [ORIGINALS_ANALYTICS_EVENTS.stopOutcome]: new Set([
    'completed',
    'skipped',
    'missed',
    'replayed',
  ]),
};

const EVENT_VALUE_KEY: Record<OriginalsAnalyticsEvent, 'result' | 'outcome'> = {
  [ORIGINALS_ANALYTICS_EVENTS.downloadResult]: 'result',
  [ORIGINALS_ANALYTICS_EVENTS.stopOutcome]: 'outcome',
};

const KNOWN_EVENTS = new Set<string>(Object.values(ORIGINALS_ANALYTICS_EVENTS));

function identifier(value: unknown, limit = 120) {
  return String(value ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]+/g, '_')
    .slice(0, limit)
    .replace(/^_+|_+$/g, '');
}

function positiveVersion(value: unknown) {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 1
    && value <= 1_000_000
    ? value
    : null;
}

/**
 * Builds the only shape the Originals client is allowed to submit. Unknown
 * keys and all arrays/objects are discarded, so location fixes and route
 * geometry cannot cross the analytics boundary even before server scrubbing.
 */
export function sanitizeOriginalsAnalyticsPayload(
  eventType: string,
  input: OriginalsAnalyticsInput,
): SanitizedOriginalsAnalytics | null {
  if (!KNOWN_EVENTS.has(eventType)) return null;
  const event = eventType as OriginalsAnalyticsEvent;
  const packId = identifier(input.pack_id);
  if (!packId) return null;
  const eventData: Record<string, string | number> = {
    release_cohort: ORIGINALS_ANALYTICS_RELEASE_COHORT,
    pack_id: packId,
  };
  const version = positiveVersion(input.version);
  if (version != null) eventData.version = version;
  else return null;

  if (event === ORIGINALS_ANALYTICS_EVENTS.stopOutcome) {
    const stopId = identifier(input.stop_id);
    if (!stopId) return null;
    eventData.stop_id = stopId;
  }

  const valueKey = EVENT_VALUE_KEY[event];
  const allowed = EVENT_VALUES[event];
  const value = input[valueKey];
  if (!allowed?.has(String(value))) return null;
  eventData[valueKey] = String(value);

  return {
    sessionId: '',
    eventData,
  };
}
