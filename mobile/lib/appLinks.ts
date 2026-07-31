import { sharedTrailTokenFromUrl } from './trailRouteSharing';

export type TrailheadAppLinkDestination =
  | { screen: 'support'; threadId?: string }
  | { screen: 'prizes' }
  | { screen: 'trips'; tripId?: string }
  | { screen: 'original'; originalId: string }
  | { screen: 'sharedTrail'; shareToken: string };

const SAFE_IDENTIFIER = /^[a-z0-9][a-z0-9_-]{0,127}$/i;
const ALLOWED_HOSTS = new Set(['gettrailhead.app', 'api.gettrailhead.app']);

function safeIdentifier(value: string | null | undefined): string {
  const normalized = String(value || '').trim();
  return SAFE_IDENTIFIER.test(normalized) ? normalized : '';
}

function safePathSegments(pathname: string): string[] | null {
  try {
    return pathname.split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
}

export function appLinkDestinationFromUrl(
  value: string | null | undefined,
): TrailheadAppLinkDestination | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const protocol = url.protocol.toLowerCase();
  if (protocol === 'https:' && !ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return null;
  if (protocol !== 'https:' && protocol !== 'trailhead:') return null;

  let segments = safePathSegments(url.pathname);
  if (!segments) return null;
  if (protocol === 'trailhead:' && url.hostname) segments = [url.hostname, ...segments];
  if (segments[0]?.toLowerCase() === 'app') segments = segments.slice(1);
  const section = segments[0]?.toLowerCase();

  if (section === 'support') {
    const threadId = safeIdentifier(
      segments[1] || url.searchParams.get('thread_id') || url.searchParams.get('support_thread_id'),
    );
    return { screen: 'support', ...(threadId ? { threadId } : {}) };
  }
  if (section === 'prizes') return { screen: 'prizes' };
  if (section === 'trips') {
    const rawTripId = segments[1] || url.searchParams.get('trip_id');
    const tripId = safeIdentifier(rawTripId);
    if (rawTripId && !tripId) return null;
    return { screen: 'trips', ...(tripId ? { tripId } : {}) };
  }
  if (section === 'originals') {
    const originalId = safeIdentifier(segments[1] || url.searchParams.get('id'));
    return originalId ? { screen: 'original', originalId } : null;
  }
  if (section === 'trails' && segments[1]?.toLowerCase() === 'shared') {
    const shareToken = sharedTrailTokenFromUrl(value);
    return shareToken ? { screen: 'sharedTrail', shareToken } : null;
  }
  return null;
}
