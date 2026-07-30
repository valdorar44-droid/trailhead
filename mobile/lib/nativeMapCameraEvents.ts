export type TrackingModeBreakawayInput = Readonly<{
  followUserLocation: boolean;
  nowMs: number;
  userGestureUntilMs: number;
  programmaticUntilMs: number;
}>;

/**
 * RNMapbox can report tracking-mode changes for both camera commands and
 * touch gestures. Only a recent real touch may break Trail Follow away from
 * its tracking camera.
 */
export function shouldNotifyTrackingModeBreakaway({
  followUserLocation,
  nowMs,
  userGestureUntilMs,
  programmaticUntilMs,
}: TrackingModeBreakawayInput): boolean {
  if (followUserLocation) return false;
  if (nowMs < programmaticUntilMs) return false;
  return nowMs < userGestureUntilMs;
}
