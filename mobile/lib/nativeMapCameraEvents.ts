export type TrackingModeBreakawayInput = Readonly<{
  followUserLocation: boolean;
  nowMs: number;
  userGestureUntilMs: number;
  programmaticUntilMs: number;
}>;

export type RegionGestureBreakawayInput = Readonly<{
  nativeUserEvent: boolean;
  nowMs: number;
  programmaticUntilMs: number;
}>;

export type FreeCameraCommandInput = Readonly<{
  navigationActive: boolean;
}>;

/**
 * A free-camera command issued while navigation owns the map must wait for the
 * native tracking camera to detach. iOS can otherwise accept the command and
 * immediately replace it with the final live-location tracking frame.
 */
export function shouldQueueFreeCameraCommand({
  navigationActive,
}: FreeCameraCommandInput): boolean {
  return navigationActive;
}

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

/**
 * RNMapbox may retain user-interaction flags on the camera events emitted by
 * a command started from a button press. A map touch clears the programmatic
 * interval before its region events arrive, so only events outside that
 * interval may release camera ownership.
 */
export function shouldNotifyRegionGestureBreakaway({
  nativeUserEvent,
  nowMs,
  programmaticUntilMs,
}: RegionGestureBreakawayInput): boolean {
  return nativeUserEvent && nowMs >= programmaticUntilMs;
}
