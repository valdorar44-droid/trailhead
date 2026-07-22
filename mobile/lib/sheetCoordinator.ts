export type CoordinatedSheetKind =
  | 'place'
  | 'camp'
  | 'trail'
  | 'trailhead'
  | 'community_report'
  | 'explore_hub';

export type SheetPresentation = 'peek' | 'half' | 'full';

export type SheetReturnContext = {
  surface: 'map' | 'explore' | 'trail_hub' | 'saved' | 'offline' | 'unknown';
  key?: string | null;
};

export type SheetIdentity = {
  kind: CoordinatedSheetKind;
  entityId: string;
};

export type SheetCoordinatorState = {
  current: SheetIdentity | null;
  presentation: SheetPresentation;
  requestGeneration: number;
  returnContext: SheetReturnContext | null;
};

export type SheetCoordinatorAction =
  | { type: 'open'; identity: SheetIdentity; presentation?: SheetPresentation; returnContext?: SheetReturnContext | null }
  | { type: 'set_presentation'; presentation: SheetPresentation }
  | { type: 'close' }
  | { type: 'enrichment_committed'; identity: SheetIdentity; requestGeneration: number };

export const initialSheetCoordinatorState: SheetCoordinatorState = {
  current: null,
  presentation: 'peek',
  requestGeneration: 0,
  returnContext: null,
};

export function sheetCoordinatorReducer(
  state: SheetCoordinatorState,
  action: SheetCoordinatorAction,
): SheetCoordinatorState {
  switch (action.type) {
    case 'open': {
      const sameEntity = sameSheetIdentity(state.current, action.identity);
      return {
        current: action.identity,
        presentation: action.presentation ?? (sameEntity ? state.presentation : 'peek'),
        requestGeneration: sameEntity ? state.requestGeneration : state.requestGeneration + 1,
        returnContext: action.returnContext === undefined ? state.returnContext : action.returnContext,
      };
    }
    case 'set_presentation':
      return state.current ? { ...state, presentation: action.presentation } : state;
    case 'close':
      return state.current || state.returnContext
        ? { ...state, current: null, presentation: 'peek', requestGeneration: state.requestGeneration + 1 }
        : state;
    case 'enrichment_committed':
      // Enrichment may update modules only for the entity/generation that
      // initiated it. Returning the same object rejects stale completions.
      return sameSheetIdentity(state.current, action.identity)
        && state.requestGeneration === action.requestGeneration
        ? state
        : state;
    default:
      return state;
  }
}

export function sheetRequestIsCurrent(
  state: SheetCoordinatorState,
  identity: SheetIdentity,
  requestGeneration: number,
): boolean {
  return sameSheetIdentity(state.current, identity)
    && state.requestGeneration === requestGeneration;
}

function sameSheetIdentity(left: SheetIdentity | null, right: SheetIdentity): boolean {
  return Boolean(left && left.kind === right.kind && left.entityId === right.entityId);
}
