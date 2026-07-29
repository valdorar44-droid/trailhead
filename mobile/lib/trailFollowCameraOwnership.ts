export type TrailFollowCameraMode = 'follow' | 'route_overview' | 'free';

export type TrailFollowCameraEvent = 'route_button' | 'gesture' | 'reset';

export function transitionTrailFollowCamera(
  mode: TrailFollowCameraMode,
  event: TrailFollowCameraEvent,
): TrailFollowCameraMode {
  if (event === 'reset') return 'follow';
  if (event === 'gesture') return 'free';
  return mode === 'follow' ? 'route_overview' : 'follow';
}

export function trailFollowCameraAction(mode: TrailFollowCameraMode): Readonly<{
  label: 'Route' | 'Recenter';
  icon: 'map-outline' | 'locate-outline';
}> {
  return mode === 'follow'
    ? { label: 'Route', icon: 'map-outline' }
    : { label: 'Recenter', icon: 'locate-outline' };
}
