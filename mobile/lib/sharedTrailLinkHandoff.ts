import {
  stableTrailRouteDigest,
  TRAIL_SHARE_TOKEN_PATTERN,
  type SharedTrailRouteV1,
} from './trailRouteSharing';

type Listener = () => void;

let pendingToken = '';
let recentDigest = '';
let recentAt = 0;
let recipientRoute: SharedTrailRouteV1 | null = null;
const listeners = new Set<Listener>();

/** Keeps the bearer token in process memory only until the static recipient screen consumes it. */
export function handoffSharedTrailToken(token: string): boolean {
  const clean = String(token || '').trim();
  if (!TRAIL_SHARE_TOKEN_PATTERN.test(clean)) return false;
  const digest = stableTrailRouteDigest(clean);
  const now = Date.now();
  if (digest === recentDigest && now - recentAt < 3_000) return false;
  recentDigest = digest;
  recentAt = now;
  recipientRoute = null;
  pendingToken = clean;
  for (const listener of listeners) listener();
  return true;
}

export function consumeSharedTrailToken(): string {
  const token = pendingToken;
  pendingToken = '';
  return token;
}

export function clearSharedTrailTokenHandoff(): void {
  pendingToken = '';
  recipientRoute = null;
}

/** Keeps the resolved immutable revision available while Map is on top. */
export function rememberSharedTrailRecipientRoute(route: SharedTrailRouteV1): void {
  recipientRoute = route;
}

export function readSharedTrailRecipientRoute(): SharedTrailRouteV1 | null {
  return recipientRoute;
}

export function clearSharedTrailRecipientRoute(): void {
  recipientRoute = null;
}

export function subscribeSharedTrailToken(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
