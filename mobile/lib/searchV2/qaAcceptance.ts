import type { SearchV2Client } from './client';
import { SearchV2SessionController, type SearchV2Scheduler } from './session';
import type { SearchPageV2, SearchRequestV2, SearchResultV2 } from './types';

export type SearchRaceQaEvidence = {
  explicitSelectionConfirmed: true;
  noAutomaticSelection: true;
  staleResponseRejected: true;
};

/**
 * Deterministic preview evidence for the Search V2 race contract. The client
 * intentionally ignores AbortSignal so the generation guard—not transport
 * timing—must reject the late A response. No provider or production API is
 * contacted.
 */
export async function runSearchRaceQaCheck(): Promise<SearchRaceQaEvidence> {
  const requests = new Map<string, Deferred<SearchPageV2>>();
  const scheduler = new QaSearchScheduler();
  const client: SearchV2Client = {
    suggest: request => {
      const pending = deferred<SearchPageV2>();
      requests.set(request.query, pending);
      return pending.promise;
    },
    results: unexpectedPageRequest,
    resolve: async request => ({
      query: request.query,
      status: 'not_found',
      selected: null,
      alternatives: [],
      reason: 'qa_fixture_only',
      revision: 'qa-search-race-v1',
    }),
  };
  const controller = new SearchV2SessionController({
    client,
    context: { surface: 'explore', include_external: false },
    scheduler,
    createSessionId: () => 'qa-search-race-session',
  });

  try {
    controller.setQuery('Moab');
    scheduler.advance(220);
    controller.setQuery('Yosemite');
    scheduler.advance(220);

    const slowA = requireRequest(requests, 'Moab');
    const fastB = requireRequest(requests, 'Yosemite');
    fastB.resolve(pageFor('Yosemite', [result('qa-fast-b', 'Yosemite')]));
    await settlePromises();
    slowA.resolve(pageFor('Moab', [result('qa-slow-a', 'Moab')]));
    await settlePromises();

    const settled = controller.getState();
    requireQa(settled.query === 'Yosemite', 'current_query_changed');
    requireQa(
      settled.results.length === 1 && settled.results[0]?.result_id === 'qa-fast-b',
      'stale_response_committed',
    );
    requireQa(settled.selectedResult === null, 'result_opened_without_press');

    const selected = await controller.resolveResult('qa-fast-b');
    requireQa(selected?.result_id === 'qa-fast-b', 'explicit_selection_failed');
    requireQa(
      controller.getState().selectedResult?.result_id === 'qa-fast-b',
      'explicit_selection_not_committed',
    );

    return {
      explicitSelectionConfirmed: true,
      noAutomaticSelection: true,
      staleResponseRejected: true,
    };
  } finally {
    controller.dispose();
  }
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

class QaSearchScheduler implements SearchV2Scheduler {
  private now = 0;
  private nextId = 1;
  private readonly tasks = new Map<number, { at: number; handler: () => void }>();

  setTimeout = (handler: () => void, delayMs: number): number => {
    const id = this.nextId++;
    this.tasks.set(id, { at: this.now + delayMs, handler });
    return id;
  };

  clearTimeout = (handle: unknown): void => {
    this.tasks.delete(Number(handle));
  };

  advance(milliseconds: number): void {
    this.now += milliseconds;
    const due = [...this.tasks.entries()]
      .filter(([, task]) => task.at <= this.now)
      .sort((left, right) => left[1].at - right[1].at);
    for (const [id, task] of due) {
      this.tasks.delete(id);
      task.handler();
    }
  }
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(onResolve => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

function requireRequest(
  requests: Map<string, Deferred<SearchPageV2>>,
  query: string,
): Deferred<SearchPageV2> {
  const request = requests.get(query);
  requireQa(Boolean(request), `missing_${query.toLowerCase()}_request`);
  return request!;
}

function result(resultId: string, title: string): SearchResultV2 {
  return {
    result_id: resultId,
    canonical_place_id: resultId,
    title,
    subtitle: 'Deterministic QA fixture',
    kind: 'place',
    categories: [],
    coordinates: { lat: 0, lng: 0 },
    parent: null,
    distance_meters: null,
    provenance: {
      provider: 'trailhead',
      source_label: 'Trailhead QA',
      temporary_use_only: false,
    },
    persistence_policy: 'canonical',
    detail_ref: null,
    score: 100,
    match_reason: 'qa_fixture',
  };
}

function pageFor(query: string, results: SearchResultV2[]): SearchPageV2 {
  return {
    query,
    results,
    next_cursor: null,
    has_more: false,
    source_counts: { trailhead: results.length, external: 0 },
    revision: 'qa-search-race-v1',
    elapsed_ms: 1,
  };
}

async function unexpectedPageRequest(_request: SearchRequestV2): Promise<SearchPageV2> {
  throw new Error('Search race QA fixture received an unexpected full-results request.');
}

async function settlePromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function requireQa(condition: boolean, code: string): asserts condition {
  if (!condition) throw new Error(`Search race QA failed: ${code}`);
}
