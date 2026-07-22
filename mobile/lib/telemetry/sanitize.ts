const SENSITIVE_KEY = /(^|_)(authorization|cookie|token|password|secret|email|phone|message|body|attachment|payout|payment|search|query|latitude|longitude|lat|lng|coordinates?|geometry|route|polyline|waypoints?|user|username|account|identity|ip|ip_address|device_id|installation_id|advertising_id|advertiser_id|serial|mac_address|referrer|clipboard|url|uri)($|_)/i;
const IDENTIFIER_SEGMENT = /\b(?:[0-9a-f]{8}-[0-9a-f-]{27,}|\d{4,})\b/gi;
const ABSOLUTE_URL = /[a-z][a-z0-9+.-]*:\/\/[^\s]+/gi;
const COORDINATE_PAIR = /-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/g;
const LABELED_COORDINATE = /\b(?:lat(?:itude)?|lon(?:gitude)?|lng)\s*[:=]\s*-?\d{1,3}(?:\.\d+)?/gi;
const SAFE_METADATA_KEYS = new Set([
  'app_version',
  'device_class',
  'expo_is_embedded_update',
  'expo_update_id',
  'platform',
  'runtime_version',
]);

/**
 * Retain only the URL origin. Paths can contain referral codes, support
 * attachment references, search text, route IDs, or account identifiers.
 */
function scrubUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.origin;
  } catch {
    return '[Filtered URL]';
  }
}

export function scrubTelemetryString(value: string): string {
  return value
    .replace(ABSOLUTE_URL, match => scrubUrl(match))
    .replace(COORDINATE_PAIR, '[Filtered coordinates]')
    .replace(LABELED_COORDINATE, '[Filtered coordinate]')
    .replace(IDENTIFIER_SEGMENT, ':id')
    .slice(0, 1000);
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizedKey(key);
  return SENSITIVE_KEY.test(normalized);
}

function normalizedKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-z0-9]+/gi, '_')
    .toLowerCase();
}

export function scrubTelemetryValue(value: unknown, key = '', depth = 0): unknown {
  if (isSensitiveKey(key)) return '[Filtered]';
  if (depth > 5) return '[Truncated]';
  if (typeof value === 'string' && SAFE_METADATA_KEYS.has(normalizedKey(key))) {
    return value.slice(0, 160);
  }
  if (typeof value === 'string') return scrubTelemetryString(value);
  if (Array.isArray(value)) {
    return value.slice(0, 30).map(item => scrubTelemetryValue(item, '', depth + 1));
  }
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 60)
      .map(([childKey, childValue]) => [
        childKey,
        scrubTelemetryValue(childValue, childKey, depth + 1),
      ]),
  );
}
