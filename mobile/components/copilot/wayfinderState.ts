export const TRAILHEAD_WAYFINDER_STATES = [
  'idle',
  'listening',
  'userSpeaking',
  'thinking',
  'speaking',
  'error',
  'noMicPermission',
  'disconnected',
  'building',
  'flying',
  'warning',
  'paused',
  'complete',
] as const;

export type TrailheadWayfinderState = (typeof TRAILHEAD_WAYFINDER_STATES)[number];

export type TrailheadWayfinderVisualState =
  | 'idle'
  | 'listening'
  | 'userSpeaking'
  | 'thinking'
  | 'speaking'
  | 'error'
  | 'noMicPermission'
  | 'disconnected'
  | 'flying'
  | 'warning'
  | 'paused'
  | 'complete';

export function resolveWayfinderVisualState(
  state: TrailheadWayfinderState,
): TrailheadWayfinderVisualState {
  if (state === 'building') return 'thinking';
  return state;
}

export function shouldAnimateWayfinderEntry(state: TrailheadWayfinderState): boolean {
  return !['idle', 'disconnected', 'paused', 'complete'].includes(
    resolveWayfinderVisualState(state),
  );
}
