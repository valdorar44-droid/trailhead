import assert from 'node:assert/strict';
import test from 'node:test';
import type { OfflineTrail } from '../offlineTrails';
import type {
  OwnedTrailRouteV1,
  TrailRouteShareMutationV1,
} from '../trailRouteSharing';
import {
  StaleTrailRouteSharingRequestError,
  TrailRouteSharingRepositoryV1,
  type TrailRouteSharingClientV1,
} from '../trailRouteSharingRepository';

const TOKEN = 'B'.repeat(43);

function localTrail(): OfflineTrail {
  return {
    id: 'local-1',
    trail: {
      id: 'local-1', name: 'Mesa route', lat: 38.5, lng: -109.6, type: 'trail', source: 'trip',
      subtitle: 'Saved route', score: 1,
      support: { campsNearby: 0, fuelNearby: 0, waterNearby: 0, reportsNearby: 0, offlineReady: true, readinessLabel: 'Ready' },
    },
    geometry: {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[-109.6, 38.5], [-109.59, 38.51]] } }],
    },
    savedAt: 10,
    source: 'manual',
    ownerRouteOrigin: 'builder',
  };
}

function ownerRoute(overrides: Partial<OwnedTrailRouteV1> = {}): OwnedTrailRouteV1 {
  return {
    id: 'remote-1', origin: 'builder', title: 'Mesa route',
    geometry: { type: 'LineString', coordinates: [[-109.6, 38.5], [-109.59, 38.51]] },
    revision: 1, geometry_revision: 1, geometry_sha256: 'sha', visibility: 'private',
    share_enabled: false, share_revision: 0, privacy_reviewed_at: null,
    ...overrides,
  };
}

function client(overrides: Partial<TrailRouteSharingClientV1> = {}): TrailRouteSharingClientV1 {
  return {
    createOwnedTrailRoute: async () => ownerRoute(),
    getOwnedTrailRoute: async () => ownerRoute(),
    updateOwnedTrailRoute: async (_id, data) => ownerRoute({
      revision: data.expected_revision + 1,
      privacy_reviewed_at: data.privacy_reviewed ? Date.now() : null,
    }),
    createOwnedTrailShareLink: async (_id, expectedRevision): Promise<TrailRouteShareMutationV1> => ({
      route: ownerRoute({ revision: expectedRevision + 1, privacy_reviewed_at: Date.now(), share_enabled: true, share_revision: 1 }),
      share_revision: 1,
      share_token: TOKEN,
      share_url: `https://gettrailhead.app/app/trails/shared#token=${TOKEN}`,
      link_exists: false,
      rotate_required: false,
    }),
    revokeOwnedTrailShareLink: async () => ({ route: ownerRoute({ share_enabled: false, share_revision: 2 }), revoked: true }),
    resolveSharedTrailRoute: async () => { throw new Error('not used'); },
    ...overrides,
  };
}

function repository(
  routeClient: TrailRouteSharingClientV1,
  ownerScopeIsCurrent: (scope: string) => boolean = () => true,
  captureAuthToken: () => Promise<string | null> = async () => 'token-a',
) {
  return new TrailRouteSharingRepositoryV1(routeClient, ownerScopeIsCurrent, captureAuthToken);
}

test('privacy confirmation is required before any remote call', async () => {
  let calls = 0;
  const routeRepository = repository(client({
    createOwnedTrailRoute: async () => { calls += 1; return ownerRoute(); },
  }));
  await assert.rejects(
    routeRepository.createLink('1:account:a', localTrail(), { start: 0, finish: 1 }, async () => {}, false),
    /review route privacy/i,
  );
  assert.equal(calls, 0);
});

test('create, privacy review, and fresh share persist only server mappings', async () => {
  const persisted: OfflineTrail[] = [];
  const routeRepository = repository(client());
  const result = await routeRepository.createLink(
    '1:account:a',
    localTrail(),
    { start: 0, finish: 1 },
    async route => { persisted.push(route); },
    true,
  );
  assert.equal(result.status, 'ready');
  assert.equal(persisted.at(-1)?.sharing?.shareEnabled, true);
  assert.equal(JSON.stringify(persisted).includes(TOKEN), false, 'bearer token must remain transient');
});

test('replayed active link without a returned bearer token requires rotation', async () => {
  const routeRepository = repository(client({
    createOwnedTrailRoute: async () => ownerRoute({ privacy_reviewed_at: Date.now(), share_enabled: true, share_revision: 4 }),
  }));
  const result = await routeRepository.createLink(
    '1:account:a', localTrail(), { start: 0, finish: 1 }, async () => {}, true,
  );
  assert.equal(result.status, 'active_without_token');
});

test('account switch before a request prevents mutation with the new account token', async () => {
  let currentScope = '2:account:b';
  let mutations = 0;
  const routeRepository = repository(client({
    createOwnedTrailRoute: async () => { mutations += 1; return ownerRoute(); },
  }), scope => scope === currentScope);
  await assert.rejects(
    routeRepository.createLink('1:account:a', localTrail(), { start: 0, finish: 1 }, async () => {}, true),
    StaleTrailRouteSharingRequestError,
  );
  assert.equal(mutations, 0);
  currentScope = '1:account:a';
});

test('account switch while auth is loading prevents mutation with a newly loaded token', async () => {
  let currentScope = '1:account:a';
  let resolveToken!: (token: string | null) => void;
  let mutations = 0;
  const token = new Promise<string | null>(resolve => { resolveToken = resolve; });
  const routeRepository = repository(client({
    createOwnedTrailRoute: async () => { mutations += 1; return ownerRoute(); },
  }), scope => scope === currentScope, async () => token);
  const pending = routeRepository.createLink(
    '1:account:a', localTrail(), { start: 0, finish: 1 }, async () => {}, true,
  );
  currentScope = '2:account:b';
  resolveToken('token-b');
  await assert.rejects(pending, StaleTrailRouteSharingRequestError);
  assert.equal(mutations, 0);
});

test('account A to B during a deferred response prevents persistence and later mutations', async () => {
  let currentScope = '1:account:a';
  let resolveCreate!: (route: OwnedTrailRouteV1) => void;
  let updates = 0;
  let shares = 0;
  let persists = 0;
  const create = new Promise<OwnedTrailRouteV1>(resolve => { resolveCreate = resolve; });
  const routeRepository = repository(client({
    createOwnedTrailRoute: async () => create,
    updateOwnedTrailRoute: async () => { updates += 1; return ownerRoute({ revision: 2 }); },
    createOwnedTrailShareLink: async () => { shares += 1; throw new Error('must not share'); },
  }), scope => scope === currentScope);
  const pending = routeRepository.createLink(
    '1:account:a', localTrail(), { start: 0, finish: 1 }, async () => { persists += 1; }, true,
  );
  currentScope = '2:account:b';
  resolveCreate(ownerRoute());
  await assert.rejects(pending, StaleTrailRouteSharingRequestError);
  assert.equal(persists, 0);
  assert.equal(updates, 0);
  assert.equal(shares, 0);
});

test('invalid owner responses fail before persistence', async () => {
  let persists = 0;
  const routeRepository = repository(client({
    createOwnedTrailRoute: async () => ({ id: '' } as OwnedTrailRouteV1),
  }));
  await assert.rejects(
    routeRepository.createLink('1:account:a', localTrail(), { start: 0, finish: 1 }, async () => { persists += 1; }, true),
    /invalid route response/i,
  );
  assert.equal(persists, 0);
});
