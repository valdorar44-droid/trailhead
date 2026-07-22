import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SearchV2PageCache } from '../cache';
import {
  canonicalSearchResultIdV2,
  exploreSearchCategoriesForCategory,
  exploreSearchIntentForCategory,
  formatSearchDistanceV2,
  isTemporarySearchResultV2,
} from '../explore';
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

test('Explore search maps visible filters to real server facets', () => {
  assert.equal(exploreSearchIntentForCategory('camp'), 'camp');
  assert.equal(exploreSearchIntentForCategory('trailheads'), 'trail');
  assert.equal(exploreSearchIntentForCategory('fuel'), 'service');
  assert.equal(exploreSearchIntentForCategory('water'), 'any');
  assert.equal(exploreSearchIntentForCategory('all'), 'any');
  assert.deepEqual(
    exploreSearchCategoriesForCategory('camp'),
    ['camping', 'campground', 'rv_park', 'dispersed_camp', 'overnight_parking', 'private_camp'],
  );
  assert.deepEqual(exploreSearchCategoriesForCategory('huts'), ['lodging']);
  assert.deepEqual(
    exploreSearchCategoriesForCategory('views'),
    ['viewpoint', 'peak', 'waterfall', 'scenic_drive'],
  );
  assert.deepEqual(exploreSearchCategoriesForCategory('resupply'), ['grocery', 'market', 'repair', 'supplies']);
  assert.deepEqual(
    exploreSearchCategoriesForCategory('water'),
    ['water', 'lake', 'waterfall', 'hot_spring', 'glacier'],
  );
  assert.equal(exploreSearchCategoriesForCategory('guided'), undefined);
});

test('only durable Search V2 results may match an existing Explore profile', () => {
  const canonical = {
    ...makeResult('canonical:moab', 'Moab', 'canonical:moab'),
  };
  assert.equal(canonicalSearchResultIdV2(canonical), 'canonical:moab');
  assert.equal(isTemporarySearchResultV2(canonical), false);

  const temporary: SearchResultV2 = {
    ...makeResult('mapbox:moab', 'Moab'),
    canonical_place_id: 'canonical:lookalike',
    persistence_policy: 'temporary',
    provenance: {
      provider: 'mapbox',
      source_label: 'Mapbox search',
      temporary_use_only: true,
    },
  };
  assert.equal(canonicalSearchResultIdV2(temporary), '');
  assert.equal(isTemporarySearchResultV2(temporary), true);
});

test('search result distances respect the selected unit mode', () => {
  assert.equal(formatSearchDistanceV2(1609.344, 'imperial'), '1.0 mi');
  assert.equal(formatSearchDistanceV2(500, 'metric'), '500 m');
  assert.equal(formatSearchDistanceV2(12500, 'metric'), '13 km');
  assert.equal(formatSearchDistanceV2(null, 'imperial'), '');
});

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

test('offline catalog refresh preserves server order, selection, query, and session while rejecting an older refresh', async () => {
  const olderRefresh = deferred<SearchResultV2[]>();
  const currentRefresh = deferred<SearchResultV2[]>();
  const offlineSessions: string[] = [];
  let offlineCalls = 0;
  let createdSessions = 0;
  let serverCalls = 0;
  const first = makeResult('server-1', 'First', 'canonical-1');
  const second = makeResult('server-2', 'Second', 'canonical-2');
  const controller = new SearchV2SessionController({
    client: pageClient({ suggest: async () => {
      serverCalls += 1;
      return makePage([first, second], {
        revision: 'server-r7',
        source_counts: { trailhead: 2, external: 0 },
      });
    } }),
    context: { surface: 'downloads', include_external: false },
    offlineProvider: request => {
      offlineSessions.push(String(request.session_id));
      offlineCalls += 1;
      if (offlineCalls === 1) return [];
      return offlineCalls === 2 ? olderRefresh.promise : currentRefresh.promise;
    },
    createSessionId: () => {
      createdSessions += 1;
      return 'session-a';
    },
  });

  controller.setQuery('Moab');
  await flushPromises();
  controller.selectResult(second.result_id);

  const olderPending = controller.refreshOffline();
  const currentPending = controller.refreshOffline();
  currentRefresh.resolve([
    makeResult('offline-duplicate', 'First offline', 'canonical-1'),
    makeResult('offline-extra', 'Downloaded camp', 'canonical-camp'),
  ]);
  await currentPending;
  assert.deepEqual(
    controller.getState().results.map(item => item.title),
    ['First', 'Second', 'Downloaded camp'],
  );

  olderRefresh.resolve([makeResult('offline-stale', 'Stale downloaded row', 'canonical-stale')]);
  await olderPending;
  const state = controller.getState();
  assert.deepEqual(state.results.map(item => item.title), ['First', 'Second', 'Downloaded camp']);
  assert.equal(state.query, 'Moab');
  assert.equal(state.selectedResult?.result_id, second.result_id);
  assert.equal(state.revision, 'server-r7');
  assert.deepEqual(state.sourceCounts, { trailhead: 2, external: 0 });
  assert.equal(serverCalls, 1, 'refresh must not restart online search');
  assert.equal(createdSessions, 1, 'refresh must not rotate the search session');
  assert.deepEqual(offlineSessions, ['session-a', 'session-a', 'session-a']);
});

test('delayed offline refresh cannot commit after the query generation changes', async () => {
  const staleRefresh = deferred<SearchResultV2[]>();
  let moabOfflineCalls = 0;
  const controller = new SearchV2SessionController({
    client: pageClient({ suggest: async request => makePage([
      makeResult(`server-${request.query.toLowerCase()}`, request.query),
    ]) }),
    context: { surface: 'downloads', include_external: false },
    offlineProvider: request => {
      if (request.query === 'Moab') {
        moabOfflineCalls += 1;
        return moabOfflineCalls === 1 ? [] : staleRefresh.promise;
      }
      return [makeResult('offline-arches', 'Downloaded Arches')];
    },
    createSessionId: () => 'session-a',
  });

  controller.setQuery('Moab');
  await flushPromises();
  const pending = controller.refreshOffline();
  controller.setQuery('Arches');
  await flushPromises();
  staleRefresh.resolve([makeResult('offline-moab-stale', 'Downloaded Moab')]);
  await pending;

  assert.equal(controller.getState().query, 'Arches');
  assert.deepEqual(
    controller.getState().results.map(item => item.title),
    ['Arches', 'Downloaded Arches'],
  );
});

test('a delayed one-character offline lookup cannot commit into a changed context', async () => {
  const oldContext = deferred<SearchResultV2[]>();
  const controller = new SearchV2SessionController({
    client: pageClient({}),
    context: { surface: 'map', scope: 'nearby', center: { lat: 38, lng: -109 } },
    offlineProvider: () => oldContext.promise,
    createSessionId: () => 'session-a',
  });

  controller.setQuery('M');
  controller.setContext({ surface: 'map', scope: 'nearby', center: { lat: 39, lng: -110 } });
  oldContext.resolve([makeResult('old-context-offline', 'Old context camp')]);
  await flushPromises();

  assert.equal(controller.getState().query, 'M');
  assert.deepEqual(controller.getState().results, []);
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

test('reopening restarts an interrupted suggestion without clearing warm rows or selection', async () => {
  const first = deferred<SearchPageV2>();
  const resumed = deferred<SearchPageV2>();
  const sessions: string[] = [];
  const issuedSessions = ['session-a', 'session-b'];
  let calls = 0;
  const warm = makeResult('offline-moab', 'Moab offline', 'canonical-moab');
  const controller = new SearchV2SessionController({
    client: pageClient({ suggest: request => {
      sessions.push(String(request.session_id));
      calls += 1;
      return calls === 1 ? first.promise : resumed.promise;
    } }),
    context: { surface: 'map', include_external: false },
    offlineProvider: () => [warm],
    createSessionId: () => issuedSessions.shift() ?? 'session-overflow',
  });

  controller.setQuery('Moab');
  controller.selectResult(warm.result_id);
  controller.pause();
  assert.deepEqual(controller.getState().results.map(item => item.title), ['Moab offline']);
  assert.equal(controller.getState().selectedResult?.result_id, warm.result_id);

  controller.resume();
  assert.equal(calls, 2);
  assert.deepEqual(sessions, ['session-a', 'session-b']);
  assert.equal(controller.getState().query, 'Moab');
  assert.deepEqual(controller.getState().results.map(item => item.title), ['Moab offline']);
  assert.equal(controller.getState().selectedResult?.result_id, warm.result_id);

  first.resolve(makePage([makeResult('stale-server', 'Stale server row')]));
  await flushPromises();
  assert.deepEqual(controller.getState().results.map(item => item.title), ['Moab offline']);

  resumed.resolve(makePage([makeResult('server-moab', 'Moab', 'canonical-moab')]));
  await flushPromises();
  assert.deepEqual(controller.getState().results.map(item => item.title), ['Moab']);
  assert.equal(controller.getState().selectedResult?.result_id, warm.result_id);

  controller.pause();
  controller.resume();
  assert.equal(calls, 2, 'completed ready work must not be duplicated on reopen');
  controller.dispose();
});

test('reopening restarts an interrupted submitted-results request in place', async () => {
  const first = deferred<SearchPageV2>();
  const resumed = deferred<SearchPageV2>();
  let calls = 0;
  const controller = new SearchV2SessionController({
    client: pageClient({ results: () => {
      calls += 1;
      return calls === 1 ? first.promise : resumed.promise;
    } }),
    context: { surface: 'explore', include_external: false },
    offlineProvider: () => [makeResult('offline-camp', 'Downloaded camp')],
    createSessionId: () => `session-${calls + 1}`,
  });

  void controller.search('camp');
  controller.pause();
  controller.resume();
  assert.equal(calls, 2);
  assert.equal(controller.getState().mode, 'results');
  assert.equal(controller.getState().query, 'camp');
  assert.deepEqual(controller.getState().results.map(item => item.title), ['Downloaded camp']);

  first.resolve(makePage([makeResult('stale-result', 'Stale result')]));
  await flushPromises();
  assert.deepEqual(controller.getState().results.map(item => item.title), ['Downloaded camp']);
  resumed.resolve(makePage([makeResult('current-result', 'Current result')]));
  await flushPromises();
  assert.deepEqual(
    controller.getState().results.map(item => item.title),
    ['Current result', 'Downloaded camp'],
  );
  controller.dispose();
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

test('successful provider resolve keeps its matching token then rotates the next search session', async () => {
  const scheduler = new ManualScheduler();
  const issued = ['session-a', 'session-b', 'session-c'];
  const suggestSessions: string[] = [];
  const resolveSessions: string[] = [];
  const unresolved = temporarySuggestion('mapbox:place.moab', 'Moab');
  const controller = new SearchV2SessionController({
    client: pageClient({
      suggest: async request => {
        suggestSessions.push(String(request.session_id));
        return makePage(request.include_external ? [unresolved] : []);
      },
      resolve: async request => {
        resolveSessions.push(String(request.session_id));
        return {
          query: request.query,
          status: 'resolved',
          selected: { ...unresolved, coordinates: { lat: 38.5733, lng: -109.5498 } },
          alternatives: [],
          reason: 'explicit_selection',
          revision: 'resolved-r2',
        };
      },
    }),
    context: { surface: 'map' },
    scheduler,
    now: () => scheduler.currentTime,
    createSessionId: () => issued.shift() ?? 'session-overflow',
  });

  controller.setQuery('Moab');
  await flushPromises();
  scheduler.advance(220);
  await flushPromises();
  const selected = await controller.resolveResult(unresolved.result_id);
  assert.equal(selected?.coordinates?.lat, 38.5733);
  assert.deepEqual(resolveSessions, ['session-a']);

  controller.setQuery('Arches');
  await flushPromises();
  assert.equal(suggestSessions.at(-1), 'session-b');
});

test('abandoned sessions rotate after 180 seconds but warm provider rows retain their retrieve token', async () => {
  const scheduler = new ManualScheduler();
  const issued = ['session-a', 'session-b', 'session-c'];
  const suggestSessions: string[] = [];
  const resolveSessions: string[] = [];
  const unresolved = temporarySuggestion('mapbox:place.moab', 'Moab');
  const controller = new SearchV2SessionController({
    client: pageClient({
      suggest: async request => {
        suggestSessions.push(String(request.session_id));
        return makePage(request.include_external ? [unresolved] : []);
      },
      resolve: async request => {
        resolveSessions.push(String(request.session_id));
        return {
          query: request.query,
          status: 'resolved',
          selected: { ...unresolved, coordinates: { lat: 38.5733, lng: -109.5498 } },
          alternatives: [],
          reason: 'explicit_selection',
          revision: 'resolved-r2',
        };
      },
    }),
    context: { surface: 'map' },
    scheduler,
    now: () => scheduler.currentTime,
    createSessionId: () => issued.shift() ?? 'session-overflow',
  });

  controller.setQuery('Moab');
  await flushPromises();
  scheduler.advance(220);
  await flushPromises();
  assert.equal(controller.getState().results[0]?.result_id, unresolved.result_id);

  scheduler.advance(180_000 - 220);
  assert.equal(controller.getState().results[0]?.result_id, unresolved.result_id, 'expiry keeps warm rows visible');
  await controller.resolveResult(unresolved.result_id);
  assert.deepEqual(resolveSessions, ['session-a'], 'the old row retrieves with the token that created it');

  controller.setQuery('Canyonlands');
  await flushPromises();
  assert.equal(suggestSessions.at(-1), 'session-b', 'new activity uses the rotated session');
});

test('search activity extends the abandoned-session deadline deterministically', async () => {
  const scheduler = new ManualScheduler();
  const issued = ['session-a', 'session-b'];
  const canonicalSessions: string[] = [];
  const controller = new SearchV2SessionController({
    client: pageClient({ suggest: async request => {
      if (!request.include_external) canonicalSessions.push(String(request.session_id));
      return makePage([]);
    } }),
    context: { surface: 'map' },
    scheduler,
    now: () => scheduler.currentTime,
    createSessionId: () => issued.shift() ?? 'session-overflow',
  });

  controller.setQuery('Moab');
  await flushPromises();
  scheduler.advance(179_000);
  controller.setQuery('Arches');
  await flushPromises();
  scheduler.advance(179_999);
  controller.setQuery('Canyonlands');
  await flushPromises();
  assert.deepEqual(canonicalSessions.slice(0, 3), ['session-a', 'session-a', 'session-a']);

  scheduler.advance(180_000);
  controller.setQuery('Zion');
  await flushPromises();
  assert.equal(canonicalSessions.at(-1), 'session-b');
});

test('elapsed inactivity rotates before a request when the native timer was suspended', async () => {
  const scheduler = new ManualScheduler();
  const issued = ['session-a', 'session-b'];
  const sessions: string[] = [];
  let currentTime = 0;
  const controller = new SearchV2SessionController({
    client: pageClient({ suggest: async request => {
      if (!request.include_external) sessions.push(String(request.session_id));
      return makePage([]);
    } }),
    context: { surface: 'map' },
    scheduler,
    now: () => currentTime,
    createSessionId: () => issued.shift() ?? 'session-overflow',
  });

  controller.setQuery('Moab');
  await flushPromises();
  assert.equal(sessions.at(-1), 'session-a');

  // Advance only the injected wall clock, as if the app resumed before a
  // suspended JavaScript timer had a chance to run.
  currentTime = 180_001;
  controller.setQuery('Arches');
  await flushPromises();
  assert.equal(sessions.at(-1), 'session-b');
});

test('pause abandons the provider session without clearing warm results', async () => {
  const scheduler = new ManualScheduler();
  const issued = ['session-a', 'session-b'];
  const sessions: string[] = [];
  const warm = makeResult('canonical-moab', 'Moab');
  const controller = new SearchV2SessionController({
    client: pageClient({ suggest: async request => {
      sessions.push(String(request.session_id));
      return makePage([warm]);
    } }),
    context: { surface: 'map' },
    scheduler,
    now: () => scheduler.currentTime,
    createSessionId: () => issued.shift() ?? 'session-overflow',
  });

  controller.setQuery('Moab');
  await flushPromises();
  const beforePause = controller.getState().results;
  controller.pause();
  assert.deepEqual(controller.getState().results, beforePause);

  controller.setQuery('Arches');
  await flushPromises();
  assert.equal(sessions.at(-1), 'session-b');
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

function temporarySuggestion(resultId: string, title: string): SearchResultV2 {
  return {
    ...makeResult(resultId, title),
    canonical_place_id: null,
    coordinates: null,
    persistence_policy: 'temporary',
    detail_ref: `provider:mapbox:${resultId}:0123456789abcdef0123456789abcdef`,
    provenance: {
      provider: 'mapbox',
      source_label: 'Mapbox search',
      provider_result_id: resultId,
      temporary_use_only: true,
    },
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

  get currentTime(): number {
    return this.now;
  }

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
