export type MapExperienceMode =
  | 'browse'
  | 'route_build'
  | 'route_review'
  | 'navigation'
  | 'originals'
  | 'trace'
  | 'preview3d';

export type MapExperienceSignals = {
  navigationActive?: boolean;
  originalsActive?: boolean;
  preview3dActive?: boolean;
  traceActive?: boolean;
  routeBuildStatus?: 'running' | 'complete' | 'failed' | 'cancelled' | null;
};

/**
 * One deterministic mode controls the shared NativeMap presentation. Higher
 * priority, safety-sensitive experiences win without replacing the renderer.
 */
export function resolveMapExperienceMode(signals: MapExperienceSignals): MapExperienceMode {
  if (signals.navigationActive) return 'navigation';
  if (signals.originalsActive) return 'originals';
  if (signals.preview3dActive) return 'preview3d';
  if (signals.traceActive) return 'trace';
  if (signals.routeBuildStatus === 'running' || signals.routeBuildStatus === 'failed') return 'route_build';
  if (signals.routeBuildStatus === 'complete') return 'route_review';
  return 'browse';
}

export function mapModeOwnsRoutePreview(mode: MapExperienceMode): boolean {
  return mode === 'route_build' || mode === 'route_review';
}
