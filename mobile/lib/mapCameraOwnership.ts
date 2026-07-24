import type { MapExperienceMode } from './mapExperienceMode';

export type MapCameraOwner = MapExperienceMode;

export type MapCameraOwnership = {
  owner: MapCameraOwner;
  experienceKey: string | null;
  blocksRecentViewport: boolean;
  restoreBrowseCameraOnRelease: boolean;
};

export type MapCameraClaimState = {
  ownershipKey: string;
  appliedApplicationKey: string | null;
  cancelledOwnershipKey: string | null;
};

export const BROWSE_MAP_CAMERA_OWNERSHIP: MapCameraOwnership = {
  owner: 'browse',
  experienceKey: null,
  blocksRecentViewport: false,
  restoreBrowseCameraOnRelease: false,
};

const CAMERA_OWNER_PRIORITY: Record<MapCameraOwner, number> = {
  browse: 0,
  trace: 1,
  route_build: 1,
  route_review: 3,
  preview3d: 3,
  originals: 4,
  navigation: 5,
};

export function mapCameraOwnerPriority(owner: MapCameraOwner): number {
  return CAMERA_OWNER_PRIORITY[owner];
}

export function createMapCameraOwnership(
  owner: MapCameraOwner,
  experienceKey: string | null,
): MapCameraOwnership {
  if (owner === 'browse') return BROWSE_MAP_CAMERA_OWNERSHIP;
  return {
    owner,
    experienceKey: experienceKey?.trim() || owner,
    blocksRecentViewport: true,
    restoreBrowseCameraOnRelease: owner === 'originals',
  };
}

export function mapCameraOwnershipKey(ownership: MapCameraOwnership): string {
  return `${ownership.owner}:${ownership.experienceKey ?? 'none'}`;
}

export function initialMapCameraClaimState(): MapCameraClaimState {
  return {
    ownershipKey: mapCameraOwnershipKey(BROWSE_MAP_CAMERA_OWNERSHIP),
    appliedApplicationKey: null,
    cancelledOwnershipKey: null,
  };
}

function synchronizeClaimState(
  state: MapCameraClaimState,
  ownership: MapCameraOwnership,
): MapCameraClaimState {
  const ownershipKey = mapCameraOwnershipKey(ownership);
  if (state.ownershipKey === ownershipKey) return state;
  return {
    ownershipKey,
    appliedApplicationKey: null,
    cancelledOwnershipKey: null,
  };
}

export function consumeMapCameraClaim(
  state: MapCameraClaimState,
  ownership: MapCameraOwnership,
  applicationKey: string,
): { state: MapCameraClaimState; apply: boolean } {
  const synchronized = synchronizeClaimState(state, ownership);
  if (
    ownership.owner === 'browse'
    || synchronized.cancelledOwnershipKey === synchronized.ownershipKey
    || synchronized.appliedApplicationKey === applicationKey
  ) {
    return { state: synchronized, apply: false };
  }
  return {
    state: {
      ...synchronized,
      appliedApplicationKey: applicationKey,
    },
    apply: true,
  };
}

export function cancelMapCameraClaimForGesture(
  state: MapCameraClaimState,
  ownership: MapCameraOwnership,
): MapCameraClaimState {
  const synchronized = synchronizeClaimState(state, ownership);
  if (ownership.owner === 'browse') return synchronized;
  return {
    ...synchronized,
    cancelledOwnershipKey: synchronized.ownershipKey,
  };
}
