import {
  stableTrailRouteDigest,
  TRAIL_SHARE_TOKEN_PATTERN,
  type SharedTrailRouteV1,
} from './trailRouteSharing';

type Listener = () => void;

type SharedTrailTokenHandoffState =
  | Readonly<{ phase: 'idle' }>
  | Readonly<{ phase: 'pending'; digest: string; token: string }>
  | Readonly<{ phase: 'resolving'; digest: string }>
  | Readonly<{ phase: 'focused'; digest: string }>;

let handoffState: SharedTrailTokenHandoffState = { phase: 'idle' };
let recipientFocused = false;
let resolvedDigest = '';
let recipientRoute: SharedTrailRouteV1 | null = null;
const listeners = new Set<Listener>();

/** Keeps the bearer token in process memory only until the static recipient screen consumes it. */
export function handoffSharedTrailToken(token: string): boolean {
  const clean = String(token || '').trim();
  if (!TRAIL_SHARE_TOKEN_PATTERN.test(clean)) return false;
  const digest = stableTrailRouteDigest(clean);
  if (handoffState.phase !== 'idle' && handoffState.digest === digest) return false;
  recipientRoute = null;
  resolvedDigest = '';
  handoffState = { phase: 'pending', digest, token: clean };
  for (const listener of listeners) listener();
  return true;
}

export function consumeSharedTrailToken(): string {
  if (handoffState.phase !== 'pending') return '';
  const { digest, token } = handoffState;
  // The resolving state retains only a digest. The raw bearer exists only in
  // this return value while the recipient performs its anonymous request.
  handoffState = { phase: 'resolving', digest };
  return token;
}

/** Marks the recipient route as the active owner of a resolved handoff. */
export function settleSharedTrailTokenResolution(resolved: boolean): void {
  if (handoffState.phase !== 'resolving') return;
  const { digest } = handoffState;
  if (!resolved) {
    if (resolvedDigest === digest) resolvedDigest = '';
    handoffState = { phase: 'idle' };
    return;
  }
  resolvedDigest = digest;
  handoffState = recipientFocused ? { phase: 'focused', digest } : { phase: 'idle' };
}

/**
 * Only the focused recipient screen may own and consume a link activation.
 * Blurring releases the digest so intentionally reopening the same HTTPS link
 * creates a fresh anonymous resolution instead of looking like an OS duplicate.
 */
export function setSharedTrailRecipientFocused(focused: boolean): void {
  recipientFocused = focused;
  if (!focused) {
    if (handoffState.phase === 'focused' || handoffState.phase === 'resolving') {
      handoffState = { phase: 'idle' };
    }
    return;
  }
  if (handoffState.phase === 'idle' && resolvedDigest && recipientRoute) {
    handoffState = { phase: 'focused', digest: resolvedDigest };
  }
}

export function clearSharedTrailTokenHandoff(): void {
  handoffState = { phase: 'idle' };
  recipientFocused = false;
  resolvedDigest = '';
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
  resolvedDigest = '';
  if (handoffState.phase === 'focused') handoffState = { phase: 'idle' };
}

export function subscribeSharedTrailToken(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
