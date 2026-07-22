import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SearchV2PageCache } from '../cache';
import {
  HttpSearchV2Client,
  SearchV2FeatureDisabledError,
  normalizeRequest,
  type SearchV2Client,
} from '../client';
import {
  SearchV2SessionController,
  type SearchV2Scheduler,
} from '../session';
import type { SearchPageV2, SearchRequestV2, SearchResultV2 } from '../types';

test('HTTP client blocks requests when the product feature is disabled', async () => {
  let fetchCalls = 0;
  const client = new HttpSearchV2Client({
    baseUrl: 'https://api.example.test',
    isEnabled: () => false,
    fetchImpl: (async () => {
      fetchCalls += 1;
      throw new Error('fetch should not run');
    }) as typeof fetch,
  });

  await assert.rejects(
    client.suggest({ query: 'Moab' }),
    SearchV2FeatureDisabledError,
  );
  assert.equal(fetchCalls, 0);
});

test('HTTP client serializes scoped search and forwards cancellation and auth', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const page = makePage([makeResult('moab', 'Moab')]);
  const client = new HttpSearchV2Client({
    baseUrl: 'https://api.example.test/',
    isEnabled: async () => true,
    getHeaders: () => ({ Authorization: 'Bearer test' }),
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return { ok: true, status: 200, json: async () => page } as Response;
    }) as typeof fetch,
  });
  const controller = new AbortController();

  await client.results({
    query: '  camp   near Moab ',
    surface: 'explore',
    intent: 'camp',
    scope: 'viewport',
    bounds: { west: -110, south: 38, east: -109, north: 39 },
    session_id: 'session-test',
    limit: 99,
  }, { signal: controller.signal });

  assert.equal(calls.length, 1);
  const requestUrl = new URL(calls[0].url);
  assert.equal(requestUrl.pathname, '/api/search/v2/results');
  assert.equal(requestUrl.searchParams.get('q'), 'camp near Moab');
  assert.equal(requestUrl.searchParams.get('bbox'), '-110,38,-109,39');
  assert.equal(requestUrl.searchParams.get('filters'), null);
  assert.equal(requestUrl.searchParams.get('limit'), '30');
  assert.equal(calls[0].init?.signal, controller.signal);
  assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, 'Bearer test');
});

test('HTTP client resolves only an explicitly selected provider row with its original session', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const selected = makeResult('mapbox:place.moab', 'Moab');
  selected.persistence_policy = 'temporary';
  selected.provenance = {
    provider: 'mapbox', source_label: 'Mapbox search', provider_result_id: 'place.moab', temporary_use_only: true,
  };
  const client = new HttpSearchV2Client({
    baseUrl: 'https://api.example.test',
    isEnabled: () => true,
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          query: 'Moab', status: 'resolved', selected, alternatives: [], reason: 'explicit_selection', revision: 'r2',
        }),
      } as Response;
    }) as typeof fetch,
  });

  await client.resolve({
    query: 'Moab', surface: 'map', intent: 'destination', scope: 'global',
    session_id: 'session-original', include_external: true,
    selected_result_id: 'mapbox:place.moab',
    selected_detail_ref: 'provider:mapbox:place.moab:0123456789abcdef0123456789abcdef',
  });

  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).pathname, '/api/search/v2/resolve');
  const body = JSON.parse(String(calls[0].init?.body));
  assert.equal(body.session_id, 'session-original');
  assert.equal(body.selected_result_id, 'mapbox:place.moab');
  assert.equal(body.selected_detail_ref, 'provider:mapbox:place.moab:0123456789abcdef0123456789abcdef');
});

test('typeahead shows offline and canonical rows immediately, then debounces provider fallback', async () => {
  const scheduler = new ManualScheduler();
  const canonical = deferred<SearchPageV2>();
  const enriched = deferred<SearchPageV2>();
  const calls: boolean[] = [];
  const client = pageClient({
    suggest: async request => {
      const includeExternal = request.include_external === true;
      calls.push(includeExternal);
      return includeExternal ? enriched.promise : canonical.promise;
    },
  });
  const offline = makeResult('offline-moab', 'Moab offline', 'canonical-moab');
  const controller = new SearchV2SessionController({
    client,
    context: { surface: 'map' },
    debounceMs: 220,
    scheduler,
    offlineProvider: () => [offline],
    createSessionId: () => 'session-test',
  });

  controller.setQuery('Moab');
  assert.deepEqual(controller.getState().results.map(item => item.title), ['Moab offline']);
  assert.deepEqual(calls, [false]);
  assert.equal(controller.getState().loadingPresentation, 'inline');
  assert.equal(controller.getState().isEnriching, true);
  assert.equal(controller.getState().selectedResult, null);

  canonical.resolve(makePage([makeResult('server-moab', 'Moab', 'canonical-moab')]));
  await flushPromises();
  assert.deepEqual(controller.getState().results.map(item => item.title), ['Moab']);
  assert.equal(controller.getState().loadingPresentation, 'inline');
  assert.equal(controller.getState().isEnriching, true);

  scheduler.advance(219);
  assert.deepEqual(calls, [false]);
  scheduler.advance(1);
  assert.deepEqual(calls, [false, true]);

  enriched.resolve(makePage([
    makeResult('server-moab', 'Moab', 'canonical-moab'),
    makeResult('provider-canyonlands', 'Canyonlands'),
  ]));
  await flushPromises();
  assert.deepEqual(controller.getState().results.map(item => item.title), ['Moab', 'Canyonlands']);
  assert.equal(controller.getState().loadingPresentation, 'none');
  assert.equal(controller.getState().isEnriching, false);
  assert.equal(controller.getState().selectedResult, null);
  assert.equal(controller.selectResult('server-moab')?.title, 'Moab');
  assert.equal(controller.getState().selectedResult?.result_id, 'server-moab');
});

test('pausing cancels pending work without clearing warm search results', async () => {
  const scheduler = new ManualScheduler();
  const canonical = deferred<SearchPageV2>();
  let calls = 0;
  const controller = new SearchV2SessionController({
    client: pageClient({ suggest: async () => {
      calls += 1;
      return canonical.promise;
    } }),
    context: { surface: 'route_editor' },
    debounceMs: 220,
    scheduler,
    offlineProvider: () => [makeResult('offline-moab', 'Moab offline', 'canonical-moab')],
  });

  controller.setQuery('Moab');
  assert.deepEqual(controller.getState().results.map(item => item.title), ['Moab offline']);
  controller.pause();
  assert.deepEqual(controller.getState().results.map(item => item.title), ['Moab offline']);
  assert.equal(controller.getState().status, 'ready');
  assert.equal(controller.getState().isEnriching, false);

  canonical.resolve(makePage([makeResult('server-moab', 'Moab', 'canonical-moab')]));
  await flushPromises();
  scheduler.advance(220);
  assert.equal(calls, 1);
  assert.deepEqual(controller.getState().results.map(item => item.title), ['Moab offline']);
});

test('one typed character may show offline suggestions without making a server request', () => {
  let calls = 0;
  const controller = new SearchV2SessionController({
    client: pageClient({ suggest: async () => {
      calls += 1;
      return makePage([]);
    } }),
    context: { surface: 'map' },
    offlineProvider: request => request.query === 'M'
      ? [makeResult('recent-moab', 'Moab')]
      : [],
    createSessionId: () => 'session-test',
  });

  controller.setQuery('M');

  assert.equal(calls, 0);
  assert.deepEqual(controller.getState().results.map(item => item.title), ['Moab']);
  assert.equal(controller.getState().status, 'ready');
  assert.equal(controller.getState().loadingPresentation, 'none');
});

test('offline scope never calls the HTTP search client', async () => {
  let calls = 0;
  const client = pageClient({
    suggest: async () => {
      calls += 1;
      return makePage([]);
    },
    results: async () => {
      calls += 1;
      return makePage([]);
    },
  });
  const controller = new SearchV2SessionController({
    client,
    context: { surface: 'downloads', scope: 'offline' },
    offlineProvider: request => request.query === 'Moab'
      ? [makeResult('offline-moab', 'Moab')]
      : [],
    createSessionId: () => 'session-offline',
  });

  controller.setQuery('Moab');
  await controller.search('Moab');
  await controller.loadNextPage();

  assert.equal(calls, 0);
  assert.equal(controller.getState().status, 'ready');
  assert.deepEqual(controller.getState().results.map(item => item.title), ['Moab']);
});

test('client validates scoped search and explicit-selection pairs before transport', () => {
  assert.throws(
    () => normalizeRequest({ query: 'Moab', scope: 'route' }, 'results'),
    /requires a route reference/i,
  );
  assert.throws(
    () => normalizeRequest({ query: 'Moab', selected_result_id: 'mapbox:one' }, 'results'),
    /both result and detail references/i,
  );
  assert.throws(
    () => normalizeRequest({ query: 'Moab', include_external: true }, 'results'),
    /requires a session/i,
  );
  const nearby = normalizeRequest({
    query: 'Moab',
    scope: 'nearby',
    center: { lat: 38.57, lng: -109.55 },
    radius_meters: 5_000,
    session_id: 'session-nearby',
  }, 'results');
  assert.equal(nearby.radius_meters, 5_000);
  const route = normalizeRequest({
    query: 'fuel', scope: 'route', route_ref: 'trip:1', filters: { open_now: true },
    session_id: 'session-route',
  }, 'results');
  assert.equal(route.route_ref, 'trip:1');
  assert.equal(route.filters?.open_now, true);
});

test('coordinate-less provider suggestions resolve only after their row is pressed', async () => {
  const resolveRequests: SearchRequestV2[] = [];
  const unresolved = makeResult('mapbox:place.moab', 'Moab');
  unresolved.coordinates = null;
  unresolved.canonical_place_id = null;
  unresolved.persistence_policy = 'temporary';
  unresolved.detail_ref = 'provider:mapbox:place.moab:0123456789abcdef0123456789abcdef';
  unresolved.provenance = {
    provider: 'mapbox', source_label: 'Mapbox search', provider_result_id: 'place.moab', temporary_use_only: true,
  };
  const resolved = { ...unresolved, coordinates: { lat: 38.5733, lng: -109.5498 } };
  const controller = new SearchV2SessionController({
    client: pageClient({
      suggest: async () => makePage([unresolved]),
      resolve: async request => {
        resolveRequests.push(request);
        return {
          query: request.query, status: 'resolved', selected: resolved,
          alternatives: [], reason: 'explicit_selection', revision: 'resolved-r2',
        };
      },
    }),
    context: {
      surface: 'map', intent: 'destination', scope: 'nearby',
      center: { lat: 38.57, lng: -109.55 }, include_external: true,
    },
    createSessionId: () => 'session-original',
  });

  controller.setQuery('Moab');
  await flushPromises();
  assert.equal(resolveRequests.length, 0);
  assert.equal(controller.getState().results[0].coordinates, null);

  const selection = controller.resolveResult(unresolved.result_id);
  assert.equal(controller.getState().resolvingResultId, unresolved.result_id);
  const selected = await selection;
  assert.equal(resolveRequests.length, 1);
  assert.equal(resolveRequests[0].session_id, 'session-original');
  assert.deepEqual(resolveRequests[0].center, { lat: 38.57, lng: -109.55 });
  assert.equal(resolveRequests[0].selected_result_id, unresolved.result_id);
  assert.equal(resolveRequests[0].selected_detail_ref, unresolved.detail_ref);
  assert.equal(selected?.coordinates?.lat, 38.5733);
  assert.equal(controller.getState().selectedResult?.result_id, unresolved.result_id);
  assert.equal(controller.getState().resolvingResultId, null);
});

test('typing a new query cancels an in-flight explicit selection without committing it', async () => {
  const pendingResolve = deferred<Awaited<ReturnType<SearchV2Client['resolve']>>>();
  const unresolved = makeResult('mapbox:place.moab', 'Moab');
  unresolved.coordinates = null;
  unresolved.persistence_policy = 'temporary';
  unresolved.detail_ref = 'provider:mapbox:place.moab:0123456789abcdef0123456789abcdef';
  unresolved.provenance = {
    provider: 'mapbox', source_label: 'Mapbox search', provider_result_id: 'place.moab', temporary_use_only: true,
  };
  const controller = new SearchV2SessionController({
    client: pageClient({
      suggest: async request => makePage(request.query === 'Moab' ? [unresolved] : [makeResult('arches', 'Arches')]),
      resolve: async () => pendingResolve.promise,
    }),
    context: { surface: 'map' },
    createSessionId: () => 'session-original',
  });
  controller.setQuery('Moab');
  await flushPromises();
  const selecting = controller.resolveResult(unresolved.result_id);
  controller.setQuery('Arches');
  pendingResolve.resolve({
    query: 'Moab', status: 'resolved',
    selected: { ...unresolved, coordinates: { lat: 38.57, lng: -109.55 } },
    alternatives: [], reason: 'explicit_selection', revision: 'old',
  });
  await selecting;
  await flushPromises();
  assert.equal(controller.getState().query, 'Arches');
  assert.equal(controller.getState().selectedResult, null);
  assert.equal(controller.getState().resolvingResultId, null);
});

test('canonical-only contexts skip the provider pass and finish without a debounce wait', async () => {
  const scheduler = new ManualScheduler();
  const calls: SearchRequestV2[] = [];
  const controller = new SearchV2SessionController({
    client: pageClient({ suggest: async request => {
      calls.push(request);
      return makePage([makeResult('canonical-moab', 'Moab')]);
    } }),
    context: { surface: 'downloads', include_external: false },
    scheduler,
    createSessionId: () => 'session-test',
  });

  controller.setQuery('Moab');
  await flushPromises();
  scheduler.advance(250);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].include_external, false);
  assert.equal(controller.getState().isEnriching, false);
  assert.equal(controller.getState().loadingPresentation, 'none');
});

test('full results reserve skeleton loading for an empty first page', async () => {
  const online = deferred<SearchPageV2>();
  const controller = new SearchV2SessionController({
    client: pageClient({ results: async () => online.promise }),
    context: { surface: 'explore' },
    offlineProvider: () => [],
    createSessionId: () => 'session-test',
  });

  const pending = controller.search('Moab');
  assert.equal(controller.getState().loadingPresentation, 'skeleton');
  assert.deepEqual(controller.getState().results, []);

  online.resolve(makePage([makeResult('server-moab', 'Moab')]));
  await pending;
  assert.equal(controller.getState().loadingPresentation, 'none');
});

test('full results keep useful offline rows visible instead of replacing them with skeletons', async () => {
  const online = deferred<SearchPageV2>();
  const controller = new SearchV2SessionController({
    client: pageClient({ results: async () => online.promise }),
    context: { surface: 'downloads' },
    offlineProvider: () => [makeResult('offline-moab', 'Moab offline')],
    createSessionId: () => 'session-test',
  });

  const pending = controller.search('Moab');
  assert.equal(controller.getState().loadingPresentation, 'inline');
  assert.deepEqual(controller.getState().results.map(item => item.title), ['Moab offline']);

  online.resolve(makePage([makeResult('server-moab', 'Moab')]));
  await pending;
  assert.equal(controller.getState().loadingPresentation, 'none');
});

test('session rejects a slow stale response even when transport ignores abort', async () => {
  const scheduler = new ManualScheduler();
  const requests = new Map<string, ReturnType<typeof deferred<SearchPageV2>>>();
  const client = pageClient({
    suggest: request => {
      const pending = deferred<SearchPageV2>();
      requests.set(`${request.query}:${Boolean(request.include_external)}`, pending);
      return pending.promise;
    },
  });
  const controller = new SearchV2SessionController({
    client,
    context: { surface: 'explore' },
    scheduler,
    createSessionId: () => 'session-test',
  });

  controller.setQuery('Moab');
  controller.setQuery('Yosemite');
  requests.get('Yosemite:false')?.resolve(makePage([makeResult('yosemite', 'Yosemite')]));
  await flushPromises();
  requests.get('Moab:false')?.resolve(makePage([makeResult('moab', 'Moab')]));
  await flushPromises();

  assert.equal(controller.getState().query, 'Yosemite');
  assert.deepEqual(controller.getState().results.map(item => item.title), ['Yosemite']);
  assert.equal(controller.getState().selectedResult, null);
});

test('changing search context restarts the active session and rejects old-context results', async () => {
  const scheduler = new ManualScheduler();
  const requests: Array<{
    request: SearchRequestV2;
    pending: ReturnType<typeof deferred<SearchPageV2>>;
  }> = [];
  const client = pageClient({
    suggest: request => {
      const pending = deferred<SearchPageV2>();
      requests.push({ request, pending });
      return pending.promise;
    },
  });
  const controller = new SearchV2SessionController({
    client,
    context: { surface: 'map', scope: 'nearby', center: { lat: 38, lng: -109 } },
    scheduler,
    createSessionId: () => 'session-test',
  });

  controller.setQuery('camp');
  controller.setContext({ surface: 'map', scope: 'nearby', center: { lat: 39, lng: -110 } });
  assert.equal(requests.length, 2);
  assert.equal(requests[1].request.center?.lat, 39);

  requests[1].pending.resolve(makePage([makeResult('new-context', 'New context')]));
  await flushPromises();
  requests[0].pending.resolve(makePage([makeResult('old-context', 'Old context')]));
  await flushPromises();
  assert.deepEqual(controller.getState().results.map(item => item.title), ['New context']);
});

test('pagination keeps server order and places unmatched offline results after all server pages', async () => {
  const first = makePage(
    [makeResult('server-1', 'First', 'canonical-1')],
    { has_more: true, next_cursor: 'page-2' },
  );
  const second = makePage([makeResult('server-2', 'Second', 'canonical-2')]);
  const client = pageClient({
    results: async request => request.cursor ? second : first,
  });
  const controller = new SearchV2SessionController({
    client,
    context: { surface: 'trail_hub', limit: 10 },
    offlineProvider: () => [
      makeResult('offline-duplicate', 'First offline', 'canonical-1'),
      makeResult('offline-extra', 'Offline extra', 'canonical-extra'),
    ],
    createSessionId: () => 'session-test',
  });

  await controller.search('trail');
  assert.deepEqual(controller.getState().results.map(item => item.title), ['First', 'Offline extra']);
  await controller.loadNextPage();
  assert.deepEqual(controller.getState().results.map(item => item.title), ['First', 'Second', 'Offline extra']);
  assert.equal(controller.getState().hasMore, false);
});

test('bounded cache evicts least recently used pages and expires entries', () => {
  let now = 100;
  const cache = new SearchV2PageCache({ capacity: 2, ttlMs: 50, now: () => now });
  cache.set('one', makePage([makeResult('one', 'One')]));
  cache.set('two', makePage([makeResult('two', 'Two')]));
  assert.ok(cache.get('one'));
  cache.set('three', makePage([makeResult('three', 'Three')]));
  assert.equal(cache.get('two'), null);
  assert.equal(cache.size, 2);
  now = 151;
  assert.equal(cache.get('one'), null);
});

function pageClient(overrides: Partial<SearchV2Client>): SearchV2Client {
  const unavailable = async (_request: SearchRequestV2): Promise<SearchPageV2> => {
    throw new Error('Unexpected search request');
  };
  return {
    suggest: overrides.suggest ?? unavailable,
    results: overrides.results ?? unavailable,
    resolve: overrides.resolve ?? (async request => ({
      query: request.query,
      status: 'not_found',
      selected: null,
      alternatives: [],
      reason: 'test',
      revision: 'test',
    })),
  };
}

function makeResult(resultId: string, title: string, canonicalPlaceId?: string): SearchResultV2 {
  return {
    result_id: resultId,
    canonical_place_id: canonicalPlaceId,
    title,
    subtitle: null,
    kind: 'place',
    categories: [],
    coordinates: { lat: 38.57, lng: -109.55 },
    parent: null,
    distance_meters: null,
    provenance: {
      provider: 'trailhead',
      source_label: 'Trailhead',
      temporary_use_only: false,
    },
    persistence_policy: 'canonical',
    detail_ref: null,
    score: 100,
    match_reason: 'exact_title',
  };
}

function makePage(
  results: SearchResultV2[],
  overrides: Partial<SearchPageV2> = {},
): SearchPageV2 {
  return {
    query: 'test',
    results,
    next_cursor: null,
    has_more: false,
    source_counts: { trailhead: results.length, external: 0 },
    revision: 'revision-test',
    elapsed_ms: 3,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

class ManualScheduler implements SearchV2Scheduler {
  private now = 0;
  private nextId = 1;
  private tasks = new Map<number, { at: number; handler: () => void }>();

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
    due.forEach(([id, task]) => {
      this.tasks.delete(id);
      task.handler();
    });
  }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
