import assert from 'node:assert/strict';
import { createOriginalAccessStore } from '../accessStore';
import { createOriginalBundleStore } from '../bundleStore';
import { writeOriginalTextAtomically } from '../fileAdapter';
import { originalRestoreScopeIsCurrent, originalVersionAccessIsExact } from '../ownership';
import { createOriginalSession, finishManualOriginalStop, originalStopCanReplay, startManualOriginalStop } from '../session';
import { createOriginalSessionStore } from '../sessionStore';
import type { OriginalGuestAcquisition, OriginalSummary } from '../types';
import { AUDIO_ONE, AUDIO_THREE, AUDIO_TWO, originalManifest } from './fixtures';
import { createMemoryOriginalFileAdapter } from './memoryFileAdapter';

async function main() {
  assert.equal(originalRestoreScopeIsCurrent('account:A', 7, 7, 'A'), true);
  assert.equal(originalRestoreScopeIsCurrent('account:A', 7, 7, 'B'), false, 'A restore is rejected after a B switch');
  assert.equal(originalRestoreScopeIsCurrent('account:A', 7, 8, 'A'), false, 'stale same-account restore epochs are rejected');
  assert.equal(originalVersionAccessIsExact(1, 2), false, 'owning pinned v1 never unlocks requested v2');
  assert.equal(originalVersionAccessIsExact(2, 2), true);
  const files = createMemoryOriginalFileAdapter({
    downloads: {
      'https://assets.test/one.mp3': AUDIO_ONE,
      'https://assets.test/two.mp3': AUDIO_TWO,
      'https://assets.test/three.mp3': AUDIO_THREE,
    },
  });
  let mapReady = true;
  const mapAdapter = {
    prepare: async (_map: unknown, identity: { pack_id: string; version: number }) => ({
      pack_id: `map:${identity.pack_id}:${identity.version}`,
      ready: true as const,
      bytes: 500,
    }),
    isReady: async () => mapReady,
    remove: async () => {},
  };
  const bundles = createOriginalBundleStore(files, undefined, mapAdapter);
  const manifest = originalManifest();
  const downloaded = await bundles.download(manifest, { ownerScope: 'guest' });
  assert.equal(downloaded.version, 1);
  assert.equal((await bundles.getPinned('guest', manifest.pack_id))?.version, 1);
  assert.equal(await bundles.verify('guest', manifest.pack_id, 1), true);
  assert.equal((await bundles.loadManifest('guest', manifest.pack_id, 1))?.manifest_id, manifest.manifest_id);
  assert((await bundles.assetUri('guest', manifest.pack_id, 1, 'audio-1'))?.includes('/1/assets/'));

  const corruptV2 = originalManifest(2);
  corruptV2.assets[0].sha256 = 'f'.repeat(64);
  await assert.rejects(() => bundles.download(corruptV2, { ownerScope: 'guest' }), /checksum verification/);
  assert.equal((await bundles.getPinned('guest', manifest.pack_id))?.version, 1, 'failed replacement keeps the verified pin');
  assert(![...files.files.keys()].some(path => path.includes('/2.tmp-')), 'failed staging directory is removed');

  const validV2 = originalManifest(2);
  const updated = await bundles.download(validV2, { ownerScope: 'guest' });
  assert.equal(updated.version, 2, 'a verified immutable update becomes the active pin');
  assert.equal((await bundles.getPinned('guest', manifest.pack_id))?.version, 2);
  assert.equal(await bundles.verify('guest', manifest.pack_id, 1), true, 'the previous verified version remains available');
  assert.equal(await bundles.get('guest', manifest.pack_id, 3), null, 'a newer catalog version is not inferred from the older pin');

  const asset = updated.assets[0];
  const originalAssetBytes = files.files.get(asset.local_uri);
  assert(originalAssetBytes);
  files.files.set(asset.local_uri, new Uint8Array([0, 1, 2]));
  assert.equal(await bundles.verify('guest', manifest.pack_id, 2), false, 'corrupt assets fail resume verification');
  assert.equal(await bundles.loadManifest('guest', manifest.pack_id, 2), null, 'runtime manifest loads require a verified bundle');
  assert.equal(
    (await bundles.loadManifest('guest', manifest.pack_id, 2, false))?.version,
    2,
    'offline detail can still explain a corrupt exact-version download',
  );
  files.files.set(asset.local_uri, originalAssetBytes);
  assert.equal(await bundles.verify('guest', manifest.pack_id, 2), true);
  mapReady = false;
  assert.equal(await bundles.verify('guest', manifest.pack_id, 2), false, 'missing offline maps block restore');
  mapReady = true;

  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(
    () => bundles.download(originalManifest(3), { ownerScope: 'guest', signal: cancelled.signal }),
    error => error instanceof Error && error.name === 'AbortError',
  );

  const isolatedFiles = createMemoryOriginalFileAdapter({
    downloads: {
      'https://assets.test/one.mp3': AUDIO_ONE,
      'https://assets.test/two.mp3': AUDIO_TWO,
      'https://assets.test/three.mp3': AUDIO_THREE,
    },
  });
  const isolatedBundles = createOriginalBundleStore(isolatedFiles, undefined, mapAdapter);
  await isolatedBundles.download(manifest, { ownerScope: 'account:A' });
  assert(await isolatedBundles.get('account:A', manifest.pack_id, 1));
  assert.equal(await isolatedBundles.get('account:B', manifest.pack_id, 1), null, 'account B cannot see account A files');
  assert.equal(await isolatedBundles.get('guest', manifest.pack_id, 1), null, 'logout cannot infer access from an account bundle');

  await isolatedBundles.download(manifest, { ownerScope: 'guest' });
  const migratedBundles = await isolatedBundles.migrateGuestToAccount(42, [{ pack_id: manifest.pack_id, version: 1 }]);
  assert.equal(migratedBundles.length, 1, 'validated free guest files move with account conversion');
  assert.equal(await isolatedBundles.get('guest', manifest.pack_id, 1), null);
  assert.equal(await isolatedBundles.verify('account:42', manifest.pack_id, 1), true);

  const atomicFiles = createMemoryOriginalFileAdapter();
  const livePath = 'memory://docs/originals/atomic.json';
  await atomicFiles.writeText(livePath, 'previous');
  const move = atomicFiles.move.bind(atomicFiles);
  let failPromotion = true;
  const failingFiles = {
    ...atomicFiles,
    async move(from: string, to: string) {
      if (failPromotion && from === `${livePath}.tmp` && to === livePath) {
        failPromotion = false;
        throw new Error('synthetic promotion failure');
      }
      return move(from, to);
    },
  };
  await assert.rejects(
    () => writeOriginalTextAtomically(failingFiles, livePath, 'replacement'),
    /synthetic promotion failure/,
  );
  assert.equal(await atomicFiles.readText(livePath), 'previous', 'failed promotion restores the live value');
  assert.equal((await atomicFiles.info(`${livePath}.bak`)).exists, false, 'restored backup is cleaned up');
  assert.equal((await bundles.getPinned('guest', manifest.pack_id))?.version, 2, 'an interrupted update keeps the active pin');

  const lowStorageFiles = createMemoryOriginalFileAdapter({
    downloads: {
      'https://assets.test/one.mp3': AUDIO_ONE,
      'https://assets.test/two.mp3': AUDIO_TWO,
      'https://assets.test/three.mp3': AUDIO_THREE,
    },
    freeBytes: 1,
  });
  const lowStorageBundles = createOriginalBundleStore(lowStorageFiles, undefined, mapAdapter);
  await assert.rejects(
    () => lowStorageBundles.download(manifest, { ownerScope: 'guest' }),
    /Not enough free storage/,
  );

  const sessions = createOriginalSessionStore(files);
  let guest = createOriginalSession(manifest, 'guest', 100);
  assert.equal(originalStopCanReplay(guest, 'story-1'), false, 'ahead/current stories are not manually replayable');
  guest = {
    ...guest,
    status: 'paused',
    triggered_stop_ids: ['story-1'],
    completed_stop_ids: ['story-1'],
    last_projected_route_progress_m: 700,
    updated_at_ms: 200,
  };
  assert.equal(originalStopCanReplay(guest, 'story-1'), true, 'completed stories are replayable');
  assert.equal(originalStopCanReplay({ ...guest, completed_stop_ids: [], skipped_stop_ids: ['story-2'] }, 'story-2'), true);
  assert.equal(originalStopCanReplay({ ...guest, completed_stop_ids: [], missed_stop_ids: ['story-3'] }, 'story-3'), true);
  const replaying = startManualOriginalStop({ ...guest, status: 'completed' }, 'story-1', 250);
  assert.equal(replaying.status, 'active', 'manual replay exposes normal player controls');
  const replayFinished = finishManualOriginalStop(replaying, 'story-1', 300);
  assert.equal(replayFinished?.status, 'completed', 'terminal replay returns to the completion state');
  assert.equal(replayFinished?.current_stop_id, null);
  await sessions.setActive(guest);
  assert.equal((await sessions.loadActive())?.session_id, guest.session_id);
  assert.equal((await sessions.list('guest')).length, 1);

  const accountScope = 'account:42' as const;
  await sessions.save({
    ...createOriginalSession(manifest, accountScope, 300),
    missed_stop_ids: ['story-2'],
    updated_at_ms: 150,
  });
  const migrated = await sessions.migrateGuestToAccount(42, [{ pack_id: manifest.pack_id, version: 1 }]);
  assert.equal(migrated.length, 1);
  assert.deepEqual(new Set(migrated[0].completed_stop_ids), new Set(['story-1']));
  assert.deepEqual(new Set(migrated[0].missed_stop_ids), new Set(['story-2']));
  assert.equal((await sessions.loadActive())?.owner_scope, accountScope);
  assert.equal((await sessions.list('guest')).length, 0);

  const access = createOriginalAccessStore(files);
  const summary: OriginalSummary = {
    id: manifest.pack_id,
    slug: 'moab-canyons-to-the-sky',
    content_kind: 'original_drive',
    version: 1,
    title: manifest.title,
    summary: 'A scenic drive.',
    price_credits: 0,
    explorer_price_credits: 0,
    free: true,
    coverage_region: 'moab',
    public_metadata: {},
    published_at: 1,
    featured: true,
  };
  const guestAcquisition: OriginalGuestAcquisition = {
    guest_access: true,
    access_type: 'guest_free',
    pack: summary,
    manifest_path: '/api/originals/moab-original/versions/1/manifest',
  };
  await access.claimGuest(guestAcquisition);
  assert.equal((await access.get('guest', manifest.pack_id, 1))?.access_type, 'guest_free');
  const migratedAccess = await access.migrateGuestToAccount(42, [{ pack_id: manifest.pack_id, version: 1 }]);
  assert.equal(migratedAccess[0].access_type, 'entitled');
  assert.equal((await access.get(accountScope, manifest.pack_id, 1))?.title, manifest.title);
  assert.equal(await access.get('account:99', manifest.pack_id, 1), null, 'another account cannot reuse the entitlement');
  assert.equal(await access.get('guest', manifest.pack_id, 1), null, 'logout does not turn account ownership into guest access');
  assert.equal((await access.list('guest')).length, 0);

  console.log('Originals durable store tests passed.');
}

void main();
