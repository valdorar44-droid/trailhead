export type TrailSheetHydrationStatus = 'idle' | 'loading' | 'ready' | 'partial';

export type TrailSheetHydrationState = {
  key: string;
  status: TrailSheetHydrationStatus;
  attempt: number;
};

export const EMPTY_TRAIL_SHEET_HYDRATION: TrailSheetHydrationState = {
  key: '',
  status: 'idle',
  attempt: 0,
};

export function beginTrailSheetHydration(
  key: string,
  attempt: number,
): TrailSheetHydrationState {
  return { key, status: 'loading', attempt };
}

export function completeTrailSheetHydration(
  state: TrailSheetHydrationState,
  key: string,
  attempt: number,
): TrailSheetHydrationState {
  if (state.key !== key || state.attempt !== attempt) return state;
  return { ...state, status: 'ready' };
}

export function timeoutTrailSheetHydration(
  state: TrailSheetHydrationState,
  key: string,
  attempt: number,
): TrailSheetHydrationState {
  if (state.key !== key || state.attempt !== attempt || state.status !== 'loading') return state;
  return { ...state, status: 'partial' };
}

export function trailSheetExpandedIsLoading(
  state: TrailSheetHydrationState,
  key: string,
  attempt: number,
): boolean {
  return state.key !== key || state.attempt !== attempt || state.status === 'idle' || state.status === 'loading';
}
