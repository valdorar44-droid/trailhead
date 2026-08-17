export const MAP_SEARCH_V2_QUERY_COALESCE_MS = 160;

export type MapSearchQueryScheduler = {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
};

const defaultScheduler: MapSearchQueryScheduler = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function scheduleMapSearchV2Query(
  query: string,
  setQuery: (query: string) => void,
  scheduler: MapSearchQueryScheduler = defaultScheduler,
) {
  const handle = scheduler.setTimeout(() => setQuery(query), MAP_SEARCH_V2_QUERY_COALESCE_MS);
  return () => scheduler.clearTimeout(handle);
}

export function commitMapSearchV2QueryNow(
  query: string,
  setQuery: (query: string) => void,
  cancelPending: (() => void) | null = null,
) {
  cancelPending?.();
  setQuery(query);
}

export function androidMapSearchKeyboardCoversVisualWork(
  platform: string,
  keyboardVisible: boolean,
  inlineSearchOpen: boolean,
  fullSearchOpen: boolean,
) {
  return platform === 'android'
    && keyboardVisible
    && (inlineSearchOpen || fullSearchOpen);
}
