import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createAppSearchV2Client } from './appClient';
import {
  SearchV2SessionController,
  type OfflineSearchProviderV2,
  type SearchV2SessionContext,
  type SearchV2SessionState,
} from './session';
import { normalizeSearchV2Query } from './cache';
import { accountStorage } from '../storage';
import {
  nextFrozenSearchCenterStateV2,
  type FrozenSearchCenterStateV2,
  type SearchCenterSnapshotV2,
} from './searchOrigin';

export type UseSearchV2SessionOptions = {
  enabled: boolean;
  active?: boolean;
  context: SearchV2SessionContext;
  offlineProvider?: OfflineSearchProviderV2;
  debounceMs?: number;
};

export function useFrozenSearchCenterV2(
  active: boolean,
  liveCenter: SearchCenterSnapshotV2 | null | undefined,
  sessionKey = 'default',
): SearchCenterSnapshotV2 | undefined {
  const snapshotRef = useRef<FrozenSearchCenterStateV2>({ active: false, sessionKey, center: undefined });
  snapshotRef.current = nextFrozenSearchCenterStateV2(snapshotRef.current, active, liveCenter, sessionKey);
  return snapshotRef.current.center;
}

export function useSearchV2Session({
  enabled,
  active = true,
  context,
  offlineProvider,
  debounceMs = 220,
}: UseSearchV2SessionOptions) {
  const enabledRef = useRef(enabled);
  const offlineProviderRef = useRef(offlineProvider);
  const [accountEpoch, setAccountEpoch] = useState(() => accountStorage.epoch());
  enabledRef.current = enabled;
  offlineProviderRef.current = offlineProvider;

  useEffect(() => accountStorage.subscribe((_cleaning, epoch) => {
    setAccountEpoch(epoch);
  }), []);

  const controller = useMemo(() => new SearchV2SessionController({
    client: createAppSearchV2Client(() => enabledRef.current),
    context,
    debounceMs,
    offlineProvider: request => offlineProviderRef.current?.(request) ?? [],
  }), [accountEpoch]);
  const [snapshot, setSnapshot] = useState<{
    controller: SearchV2SessionController;
    state: SearchV2SessionState;
  }>(() => ({ controller, state: controller.getState() }));
  const state = snapshot.controller === controller ? snapshot.state : controller.getState();
  const contextKey = stableContextKey(context);

  useEffect(() => {
    setSnapshot({ controller, state: controller.getState() });
    const unsubscribe = controller.subscribe(nextState => {
      setSnapshot({ controller, state: nextState });
    });
    return () => {
      unsubscribe();
      controller.dispose();
    };
  }, [controller]);
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
  const setContext = useCallback((next: SearchV2SessionContext, refreshCurrent = true) => {
    controller.setContext(next, refreshCurrent);
  }, [controller]);
  const search = useCallback((query?: string) => controller.search(query), [controller]);
  const retry = useCallback(() => controller.retry(), [controller]);
  const refreshOffline = useCallback(() => controller.refreshOffline(), [controller]);
  const loadNextPage = useCallback(() => controller.loadNextPage(), [controller]);
  const selectResult = useCallback((resultId: string) => controller.selectResult(resultId), [controller]);
  const resolveResult = useCallback((resultId: string) => controller.resolveResult(resultId), [controller]);
  const clearSelection = useCallback(() => controller.clearSelection(), [controller]);
  const pause = useCallback(() => controller.pause(), [controller]);

  return {
    state,
    setContext,
    setQuery,
    search,
    retry,
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
