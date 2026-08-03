export type MapRecentViewportRestoreResolutionV1 = 'none' | 'cached' | 'explicit';

export type MapRecentViewportRestoreGateV1 = {
  generation: number;
  resolvedBy: MapRecentViewportRestoreResolutionV1;
};

export function initialMapRecentViewportRestoreGateV1(): MapRecentViewportRestoreGateV1 {
  return {
    generation: 0,
    resolvedBy: 'none',
  };
}
export function beginMapRecentViewportRestoreV1(
  state: MapRecentViewportRestoreGateV1,
): number {
  return state.generation;
}

export function claimExplicitMapCameraV1(
  state: MapRecentViewportRestoreGateV1,
): MapRecentViewportRestoreGateV1 {
  return {
    generation: state.generation + 1,
    resolvedBy: 'explicit',
  };
}

export function canCommitMapRecentViewportRestoreV1(
  state: MapRecentViewportRestoreGateV1,
  requestGeneration: number,
): boolean {
  return state.resolvedBy === 'none' && state.generation === requestGeneration;
}

export function commitMapRecentViewportRestoreV1(
  state: MapRecentViewportRestoreGateV1,
  requestGeneration: number,
): { state: MapRecentViewportRestoreGateV1; apply: boolean } {
  if (!canCommitMapRecentViewportRestoreV1(state, requestGeneration)) {
    return { state, apply: false };
  }
  return {
    state: {
      generation: state.generation,
      resolvedBy: 'cached',
    },
    apply: true,
  };
}
