import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createAppSearchV2Client } from './appClient';
import {
  SearchV2SessionController,
  type OfflineSearchProviderV2,
  type SearchV2SessionContext,
  type SearchV2SessionState,
} from './session';
import { normalizeSearchV2Query } from './cache';

export type UseSearchV2SessionOptions = {
  enabled: boolean;
  active?: boolean;
  context: SearchV2SessionContext;
  offlineProvider?: OfflineSearchProviderV2;
  debounceMs?: number;
};

export function useSearchV2Session({
  enabled,
  active = true,
  context,
  offlineProvider,
  debounceMs = 220,
}: UseSearchV2SessionOptions) {
  const enabledRef = useRef(enabled);
  const offlineProviderRef = useRef(offlineProvider);
  enabledRef.current = enabled;
  offlineProviderRef.current = offlineProvider;

  const controller = useMemo(() => new SearchV2SessionController({
    client: createAppSearchV2Client(() => enabledRef.current),
    context,
    debounceMs,
    offlineProvider: request => offlineProviderRef.current?.(request) ?? [],
  }), []);
  const [state, setState] = useState<SearchV2SessionState>(() => controller.getState());
  const contextKey = stableContextKey(context);

  useEffect(() => controller.subscribe(setState), [controller]);
  useEffect(() => {
    if (!enabled || !active) {
      controller.pause();
      return;
    }
    controller.setContext(context);
    controller.resume();
  }, [active, contextKey, controller, enabled]);

  const setQuery = useCallback((query: string) => {
    const current = controller.getState();
    if (current.mode === 'suggest' && current.query === normalizeSearchV2Query(query)) return;
    controller.setQuery(query);
  }, [controller]);
  const search = useCallback((query?: string) => controller.search(query), [controller]);
  const refreshOffline = useCallback(() => controller.refreshOffline(), [controller]);
  const loadNextPage = useCallback(() => controller.loadNextPage(), [controller]);
  const selectResult = useCallback((resultId: string) => controller.selectResult(resultId), [controller]);
  const resolveResult = useCallback((resultId: string) => controller.resolveResult(resultId), [controller]);
  const clearSelection = useCallback(() => controller.clearSelection(), [controller]);
  const pause = useCallback(() => controller.pause(), [controller]);

  return {
    state,
    setQuery,
    search,
    refreshOffline,
    loadNextPage,
    selectResult,
    resolveResult,
    clearSelection,
    pause,
  };
}

function stableContextKey(context: SearchV2SessionContext): string {
  return JSON.stringify(context);
}
