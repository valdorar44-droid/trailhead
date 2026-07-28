export function screenIsActive(isFocused: boolean, appState: string) {
  return isFocused && appState === 'active';
}

/**
 * Android may restore a native ScrollView offset before asynchronously loaded
 * content reaches its previous height. Keep retained warm-state offsets when
 * they are valid, but never leave the viewport beyond the current content.
 */
export function boundedRetainedScrollOffset(
  offset: number,
  contentHeight: number,
  viewportHeight: number,
) {
  const safeOffset = Number.isFinite(offset) ? Math.max(0, offset) : 0;
  const safeContentHeight = Number.isFinite(contentHeight) ? Math.max(0, contentHeight) : 0;
  const safeViewportHeight = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0;
  return Math.min(safeOffset, Math.max(0, safeContentHeight - safeViewportHeight));
}

/**
 * Idle Map sensing belongs to the focused foreground screen. Once navigation
 * starts, its existing native/background adapters and mounted turn runtime must
 * retain the location watch across tab blur and screen lock.
 */
export function mapLocationWatchShouldRun(screenActive: boolean, navigationActive: boolean) {
  return screenActive || navigationActive;
}

/**
 * Expensive visual sources follow only the visible foreground Map screen. The
 * renderer stays mounted on blur, while background navigation/location/audio
 * continue through their independent runtimes.
 */
export function mapVisualWorkShouldRun(
  screenActive: boolean,
  _appActive: boolean,
  _navigationActive: boolean,
  visuallyCovered = false,
) {
  return screenActive && !visuallyCovered;
}

/**
 * Viewport work is generation-bound so a request started before Map blur can
 * never commit after a later focus transition.
 */
export function visualWorkRequestIsCurrent(
  visualWorkActive: boolean,
  currentGeneration: number,
  requestGeneration: number,
) {
  return visualWorkActive && currentGeneration === requestGeneration;
}

export type MapVisualRefreshBounds = {
  n: number;
  s: number;
  e: number;
  w: number;
};

type MapVisualRefreshStamp = {
  boundsKey: string;
  generation: number;
  recordedAt: number;
};

const VISUAL_REFRESH_DEDUPE_MS = 500;

function mapVisualRefreshBoundsKey(bounds: MapVisualRefreshBounds) {
  return [bounds.n, bounds.s, bounds.e, bounds.w]
    .map(value => Number(value).toFixed(5))
    .join(':');
}

/**
 * Coordinates the one visual-source refresh needed when a retained Map tab
 * becomes visible again. A native region event wins over the fallback timer;
 * if the timer wins first, an equivalent late region event is deduplicated.
 * Navigation and location runtimes do not use this coordinator.
 */
export function createMapVisualRefreshCoordinator(
  initialActive: boolean,
  initialGeneration = 0,
) {
  let active = initialActive;
  let generation = initialGeneration;
  let pendingResume = false;
  let lastRefresh: MapVisualRefreshStamp | null = null;

  const recordRefresh = (
    bounds: MapVisualRefreshBounds,
    requestGeneration: number,
    recordedAt: number,
  ) => {
    if (!active || requestGeneration !== generation) return false;
    const boundsKey = mapVisualRefreshBoundsKey(bounds);
    if (
      lastRefresh?.generation === requestGeneration
      && lastRefresh.boundsKey === boundsKey
      && recordedAt - lastRefresh.recordedAt <= VISUAL_REFRESH_DEDUPE_MS
    ) return false;
    lastRefresh = { boundsKey, generation: requestGeneration, recordedAt };
    return true;
  };

  return {
    transition(nextActive: boolean, nextGeneration: number) {
      if (nextActive === active) {
        generation = nextGeneration;
        return;
      }
      const becameActive = !active && nextActive;
      active = nextActive;
      generation = nextGeneration;
      pendingResume = becameActive;
      if (!active) lastRefresh = null;
    },
    region(
      bounds: MapVisualRefreshBounds,
      requestGeneration: number,
      recordedAt = Date.now(),
    ) {
      if (!active || requestGeneration !== generation) return false;
      pendingResume = false;
      return recordRefresh(bounds, requestGeneration, recordedAt);
    },
    resume(
      bounds: MapVisualRefreshBounds,
      requestGeneration: number,
      recordedAt = Date.now(),
    ) {
      if (!pendingResume || !active || requestGeneration !== generation) return false;
      pendingResume = false;
      return recordRefresh(bounds, requestGeneration, recordedAt);
    },
    hasPendingResume() {
      return pendingResume;
    },
  };
}
