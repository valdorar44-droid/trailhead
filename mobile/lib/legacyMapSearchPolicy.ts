export type LegacyMapSearchCompletion<T> = {
  results: T[];
  selected: null;
};

/**
 * Legacy Map search treats server ranking as authoritative. Completing a query
 * only publishes choices; opening a place remains an explicit user action.
 */
export function completeLegacyMapSearch<T>(serverRankedResults: readonly T[]): LegacyMapSearchCompletion<T> {
  return {
    results: [...serverRankedResults],
    selected: null,
  };
}
