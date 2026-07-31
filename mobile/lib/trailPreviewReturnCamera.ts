import type {
  MapCameraClaimState,
  MapCameraOwner,
  MapCameraOwnership,
} from './mapCameraOwnership';
import { mapCameraOwnershipKey } from './mapCameraOwnership';

export type TrailPreviewViewportV1 = Readonly<{
  n: number;
  s: number;
  e: number;
  w: number;
  zoom: number;
}>;

export type TrailPreviewReturnCameraV1 = Readonly<{
  trailIdentity: string;
  geometryRevision: string;
  owner: MapCameraOwner;
  ownerExperienceKey: string | null;
  ownerKey: string;
  mode: 'route_claim' | 'user_viewport';
  viewport: TrailPreviewViewportV1 | null;
  styleGeneration: number;
  generation: number;
}>;

export type TrailPreviewReturnCameraDecision = Readonly<{
  action: 'route_claim' | 'restore_viewport' | 'discard';
  reason:
    | 'route_owner'
    | 'user_viewport'
    | 'stale_generation'
    | 'stale_trail'
    | 'stale_geometry'
    | 'stale_owner'
    | 'stale_style'
    | 'missing_viewport';
}>;

type CaptureTrailPreviewReturnCameraArgs = Readonly<{
  trailIdentity: string;
  geometryRevision: string;
  ownership: MapCameraOwnership;
  claimState: MapCameraClaimState;
  viewport: TrailPreviewViewportV1 | null;
  styleGeneration: number;
  generation: number;
}>;

type ResolveTrailPreviewReturnCameraArgs = Readonly<{
  trailIdentity: string;
  geometryRevision: string;
  ownerKey: string;
  styleGeneration: number;
  generation: number;
}>;

function validViewport(viewport: TrailPreviewViewportV1 | null): boolean {
  if (!viewport) return false;
  return [viewport.n, viewport.s, viewport.e, viewport.w, viewport.zoom].every(Number.isFinite)
    && viewport.n > viewport.s
    && viewport.e > viewport.w;
}

export function captureTrailPreviewReturnCamera(
  args: CaptureTrailPreviewReturnCameraArgs,
): TrailPreviewReturnCameraV1 {
  const ownerKey = mapCameraOwnershipKey(args.ownership);
  const userAdjusted = args.claimState.ownershipKey === ownerKey
    && args.claimState.cancelledOwnershipKey === ownerKey;
  const restoreUserViewport = userAdjusted && validViewport(args.viewport);
  return {
    trailIdentity: args.trailIdentity,
    geometryRevision: args.geometryRevision,
    owner: args.ownership.owner,
    ownerExperienceKey: args.ownership.experienceKey,
    ownerKey,
    mode: restoreUserViewport ? 'user_viewport' : 'route_claim',
    viewport: restoreUserViewport ? args.viewport : null,
    styleGeneration: args.styleGeneration,
    generation: args.generation,
  };
}

export function resolveTrailPreviewReturnCamera(
  snapshot: TrailPreviewReturnCameraV1,
  current: ResolveTrailPreviewReturnCameraArgs,
): TrailPreviewReturnCameraDecision {
  if (snapshot.generation !== current.generation) {
    return { action: 'discard', reason: 'stale_generation' };
  }
  if (snapshot.trailIdentity !== current.trailIdentity) {
    return { action: 'discard', reason: 'stale_trail' };
  }
  if (snapshot.geometryRevision !== current.geometryRevision) {
    return { action: 'discard', reason: 'stale_geometry' };
  }
  if (snapshot.ownerKey !== current.ownerKey) {
    return { action: 'discard', reason: 'stale_owner' };
  }
  if (snapshot.styleGeneration !== current.styleGeneration) {
    return { action: 'discard', reason: 'stale_style' };
  }
  if (snapshot.mode === 'route_claim') {
    return { action: 'route_claim', reason: 'route_owner' };
  }
  if (!validViewport(snapshot.viewport)) {
    return { action: 'discard', reason: 'missing_viewport' };
  }
  return { action: 'restore_viewport', reason: 'user_viewport' };
}
