import assert from 'node:assert/strict';
import { createOriginalAccessStore } from '../accessStore';
import { createOriginalBundleStore } from '../bundleStore';
import { createOriginalFeedbackStore } from '../feedbackStore';
import { writeOriginalTextAtomically } from '../fileAdapter';
import { compileOriginalManifestV2 } from '../manifestV2';
import {
  originalPackVersionAccessIsExact,
  originalRestoreScopeIsCurrent,
  originalVersionAccessIsExact,
} from '../ownership';
import {
  createOriginalSession,
  finishManualOriginalStop,
  normalizeCompletedOriginalSession,
  originalStopCanReplay,
  startManualOriginalStop,
} from '../session';
import { createOriginalSessionStore } from '../sessionStore';
import type { OriginalAuthenticatedAcquisition, OriginalGuestAcquisition, OriginalSummary } from '../types';
import {
  AUDIO_ONE,
  AUDIO_THREE,
  AUDIO_TWO,
  originalManifest,
  originalManifestV2,
  originalManifestV3,
} from './fixtures';
import { createMemoryOriginalFileAdapter } from './memoryFileAdapter';

async function main() {
  process.env.EXPO_PUBLIC_ORIGINAL_ASSET_HOSTS = 'https://assets.test';
  assert.equal(originalRestoreScopeIsCurrent('account:A', 7, 7, 'A'), true);
  assert.equal(originalRestoreScopeIsCurrent('account:A', 7, 7, 'B'), false, 'A restore is rejected after a B switch');
  assert.equal(originalRestoreScopeIsCurrent('account:A', 7, 8, 'A'), false, 'stale same-account restore epochs are rejected');
  assert.equal(originalVersionAccessIsExact(1, 2), false, 'owning pinned v1 never unlocks requested v2');
  assert.equal(originalVersionAccessIsExact(2, 2), true);
  assert.equal(originalPackVersionAccessIsExact('moab', 1, 'moab', 1), true);
  assert.equal(
    originalPackVersionAccessIsExact('featured-now', 1, 'featured-before', 1),
    false,
    'a rotated featured pack with the same version never unlocks a stale detail page',
  );
  const files = createMemoryOriginalFileAdapter({
    downloads: {
      'https://assets.test/one.mp3': AUDIO_ONE,
      'https://assets.test/two.mp3': AUDIO_TWO,
      'https://assets.test/three.mp3': AUDIO_THREE,
      'https://api.gettrailhead.app/story-4.mp3': Buffer.from('audio for story-4'),
      'https://api.gettrailhead.app/story-5.mp3': Buffer.from('audio for story-5'),
      'https://api.gettrailhead.app/story-6.mp3': Buffer.from('audio for story-6'),
    },
  });
  const assetRequests: Array<{ url: string; headers?: Record<string, string> }> = [];
  const fixtureDownload = files.download.bind(files);
  files.download = async (url, destination, options = {}) => {
    assetRequests.push({ url, headers: options.headers });
    return fixtureDownload(url, destination, options);
  };
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
  const downloaded = await bundles.download(manifest, {
    ownerScope: 'guest',
    headers: {
      Authorization: 'Bearer account-token',
      'X-Trailhead-Originals-Preview': 'preview-token',
    },
  });
  assert.equal(downloaded.version, 1);
  assert.equal((await bundles.getPinned('guest', manifest.pack_id))?.version, 1);
  assert.equal(await bundles.verify('guest', manifest.pack_id, 1), true);
  assert.equal((await bundles.loadManifest('guest', manifest.pack_id, 1))?.manifest_id, manifest.manifest_id);
  assert((await bundles.assetUri('guest', manifest.pack_id, 1, 'audio-1'))?.includes('/1/assets/'));
  assert.deepEqual(
    assetRequests[0]?.headers,
    {},
    'account and preview credentials are stripped from an approved cross-origin asset host',
  );
  const unapprovedAsset = originalManifest(81);
  unapprovedAsset.assets[0].path = 'https://untrusted.example/audio.mp3';
  await assert.rejects(
    () => bundles.download(unapprovedAsset, {
      ownerScope: 'guest',
      headers: { Authorization: 'Bearer must-not-leak' },
    }),
    /host is not approved/i,
  );
  assert.equal(
    assetRequests.some(request => request.url.includes('untrusted.example')),
    false,
    'an unapproved asset host is rejected before the file adapter sees it',
  );

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
  const savedManifestText = await files.readText(updated.manifest_uri);
  const alteredManifest = JSON.parse(savedManifestText);
  alteredManifest.stops[0].transcript = 'A syntactically valid but corrupted offline transcript.';
  await files.writeText(updated.manifest_uri, JSON.stringify(alteredManifest));
  assert.equal(await bundles.verify('guest', manifest.pack_id, 2), false, 'manifest content changes fail digest verification');
  assert.equal(await bundles.loadManifest('guest', manifest.pack_id, 2), null, 'runtime never loads a modified offline manifest');
  await files.writeText(updated.manifest_uri, savedManifestText);
  assert.equal(await bundles.verify('guest', manifest.pack_id, 2), true);
  mapReady = false;
  assert.equal(await bundles.verify('guest', manifest.pack_id, 2), false, 'missing offline maps block restore');
  mapReady = true;

  const previewLike = originalManifest(4);
  await bundles.download(previewLike, { ownerScope: 'guest', pinVersion: false });
  assert.equal((await bundles.getPinned('guest', manifest.pack_id))?.version, 2, 'non-pinned previews do not replace the production pin');
  assert.equal(await bundles.verify('guest', manifest.pack_id, 4), true, 'a non-pinned preview is still fully verified');

  const unionManifest = originalManifestV2();
  const unionBundle = await bundles.download(unionManifest, { ownerScope: 'guest' });
  assert.equal(unionBundle.manifest_schema_version, 2);
  assert.equal(await bundles.verify('guest', unionManifest.pack_id, unionManifest.version), true);
  const loadedUnion = await bundles.loadManifest('guest', unionManifest.pack_id, unionManifest.version);
  assert.equal(loadedUnion?.schema_version, 2, 'the offline bundle retains the raw union manifest');
  assert.equal(
    loadedUnion && loadedUnion.schema_version === 2 ? loadedUnion.chapters[0].variants.length : 0,
    2,
    'one verified bundle contains every selectable route variant',
  );
  const longFormManifest = originalManifestV3();
  const longFormBundle = await bundles.download(longFormManifest, { ownerScope: 'guest' });
  assert.equal(longFormBundle.manifest_schema_version, 3);
  assert.equal(await bundles.verify(
    'guest',
    longFormManifest.pack_id,
    longFormManifest.version,
  ), true);
  const loadedLongForm = await bundles.loadManifest(
    'guest',
    longFormManifest.pack_id,
    longFormManifest.version,
  );
  assert.equal(loadedLongForm?.schema_version, 3, 'the offline bundle retains the raw V3 union manifest');
  assert.equal(
    loadedLongForm?.schema_version === 3
      ? loadedLongForm.chapters[0].variants[0].selectable_refs.length
      : 0,
    4,
    'one verified V3 bundle contains the selectable long-form union',
  );
  const directAssetRequest = assetRequests.find(request => request.url.endsWith('/story-4.mp3'));
  assert.equal(
    directAssetRequest?.headers?.['X-Trailhead-Originals-Consumer-Contract'],
    'originals_long_form_delivery_v1',
    'direct V3 API asset downloads carry the fixed consumer contract',
  );
  const revisedUnion = {
    ...originalManifestV2(),
    manifest_id: `${unionManifest.manifest_id}:studio-revision-2`,
    title: `${unionManifest.title} revised`,
  };
  const revisedBundle = await bundles.download(revisedUnion, { ownerScope: 'guest' });
  assert.equal(
    revisedBundle.manifest_id,
    revisedUnion.manifest_id,
    'a same-version Studio manifest with a new immutable identity replaces the stale bundle',
  );
  const loadedRevision = await bundles.loadManifest(
    'guest',
    revisedUnion.pack_id,
    revisedUnion.version,
  );
  assert.equal(loadedRevision?.manifest_id, revisedUnion.manifest_id);
  assert.equal(loadedRevision?.title, revisedUnion.title);

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
  const staleForegroundCompletion = {
    ...guest,
    status: 'active' as const,
    current_stop_id: null,
    completed_stop_ids: ['story-1'],
    completed_at_ms: 240,
  };
  const normalizedCompletion = normalizeCompletedOriginalSession(
    staleForegroundCompletion,
    ['story-1'],
  );
  assert.equal(normalizedCompletion.status, 'completed');
  const staleCompletionReplay = startManualOriginalStop(staleForegroundCompletion, 'story-1', 250);
  assert.equal(
    staleCompletionReplay.manual_replay_return_status,
    'completed',
    'a stale foreground status cannot make a completed-tour replay return to active',
  );
  await sessions.setActive(guest);
  assert.equal((await sessions.loadActive())?.session_id, guest.session_id);
  assert.equal((await sessions.list('guest')).length, 1);

  const selectionFiles = createMemoryOriginalFileAdapter();
  const selectedSessions = createOriginalSessionStore(selectionFiles);
  const east = compileOriginalManifestV2(unionManifest, {
    chapter_id: 'mountain-crossing',
    variant_id: 'eastbound',
  });
  const west = compileOriginalManifestV2(unionManifest, {
    chapter_id: 'mountain-crossing',
    variant_id: 'westbound',
  });
  const eastSelection = { schema_version: 1 as const, ...east.selection };
  const westSelection = { schema_version: 1 as const, ...west.selection };
  const eastSession = createOriginalSession(east.manifest, 'guest', 1_000, eastSelection);
  const westSession = createOriginalSession(west.manifest, 'guest', 2_000, westSelection);
  await selectedSessions.save(eastSession);
  await selectedSessions.save(westSession);
  assert.equal((await selectedSessions.list('guest')).length, 2, 'two route variants coexist for one pack version');
  assert.equal(
    (await selectedSessions.load('guest', unionManifest.pack_id, unionManifest.version, eastSelection))?.chapter_selection?.variant_id,
    'eastbound',
  );
  assert.equal(
    (await selectedSessions.load('guest', unionManifest.pack_id, unionManifest.version, westSelection))?.chapter_selection?.variant_id,
    'westbound',
  );
  assert.equal(
    await selectedSessions.load('guest', unionManifest.pack_id, unionManifest.version),
    null,
    'a V2 session is never guessed from its parent pack identity',
  );
  assert(
    [...selectionFiles.files.keys()].every(path => !path.includes('#')),
    'selection-aware session paths remain valid URI/file names',
  );
  const maxId = `x${'a'.repeat(239)}`;
  const maxSelection = {
    schema_version: 1 as const,
    validation_selection_id: maxId,
    chapter_id: maxId,
    variant_id: maxId,
  };
  await selectedSessions.save(createOriginalSession(
    { ...east.manifest, pack_id: maxId },
    'guest',
    3_000,
    maxSelection,
  ));
  const maxSessionFile = [...selectionFiles.files.keys()]
    .find(file => file.includes('/sessions/guest/v2~') && file.endsWith('.json'));
  assert(maxSessionFile, 'maximum valid V2 identities produce a session file');
  const maxSessionBasename = maxSessionFile.split('/').pop() ?? '';
  assert(
    `${maxSessionBasename}.tmp`.length < 255 && `${maxSessionBasename}.bak`.length < 255,
    'bounded V2 filenames leave room for atomic temporary and backup suffixes',
  );
  const migratedSelections = await selectedSessions.migrateGuestToAccount(84, [{
    pack_id: unionManifest.pack_id,
    version: unionManifest.version,
  }]);
  assert.equal(migratedSelections.length, 2, 'guest conversion migrates each selected route independently');
  assert.equal((await selectedSessions.list('account:84')).length, 2);
  assert.equal(
    (await selectedSessions.list('guest')).length,
    1,
    'the unrelated maximum-ID session remains private to its guest owner',
  );

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

  const activeAccount = {
    ...migrated[0],
    status: 'active' as const,
    user_paused: false,
    updated_at_ms: 400,
  };
  await sessions.setActive(activeAccount);
  const conditionalUpdate = await sessions.setActiveIfCurrent(activeAccount.session_id, {
    ...activeAccount,
    current_audio_position_ms: 12_345,
    updated_at_ms: 450,
  });
  assert.equal(conditionalUpdate?.current_audio_position_ms, 12_345);
  await sessions.save({ ...activeAccount, status: 'stopped', updated_at_ms: 500 });
  await sessions.setActive(null);
  const staleHeadlessWrite = await sessions.setActiveIfCurrent(activeAccount.session_id, {
    ...activeAccount,
    updated_at_ms: 550,
  });
  assert.equal(staleHeadlessWrite, null, 'a cold task cannot revive a session after End tour clears the active pointer');
  assert.equal(await sessions.loadActive(), null);
  assert.equal(
    (await sessions.load(accountScope, manifest.pack_id, manifest.version))?.status,
    'stopped',
    'End tour keeps stopped progress history without keeping an active session',
  );

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
  const guestAccess = await access.get('guest', manifest.pack_id, 1);
  assert.equal(guestAccess?.access_type, 'guest_free');
  assert.deepEqual(guestAccess?.pack_summary, summary, 'guest acquisition metadata survives before bundle download');
  const migratedAccess = await access.migrateGuestToAccount(42, [{ pack_id: manifest.pack_id, version: 1 }]);
  assert.equal(migratedAccess[0].access_type, 'entitled');
  assert.deepEqual(migratedAccess[0].pack_summary, summary, 'guest acquisition metadata survives account migration');
  assert.equal((await access.get(accountScope, manifest.pack_id, 1))?.title, manifest.title);
  assert.equal(await access.get('account:99', manifest.pack_id, 1), null, 'another account cannot reuse the entitlement');
  assert.equal(await access.get('guest', manifest.pack_id, 1), null, 'logout does not turn account ownership into guest access');
  assert.equal((await access.list('guest')).length, 0);

  const authenticatedAcquisition: OriginalAuthenticatedAcquisition = {
    entitlement: { pack_id: manifest.pack_id, version: 1 },
    pack: summary,
    trip: {},
    already_owned: false,
    replayed: false,
    credit_balance: 500,
  };
  await access.recordEntitlement(authenticatedAcquisition, 77);
  assert.deepEqual(
    (await access.get('account:77', manifest.pack_id, 1))?.pack_summary,
    summary,
    'authenticated acquisition metadata survives before bundle download',
  );

  const previewManifest = {
    ...manifest,
    version: 1_000_000_009,
    manifest_id: `${manifest.manifest_id}:draft:9`,
  };
  await access.recordAdminPreview(previewManifest, 42);
  const previewAccess = await access.get(accountScope, manifest.pack_id, previewManifest.version);
  assert.equal(previewAccess?.access_type, 'admin_preview');
  assert.equal(previewAccess?.owner_scope, accountScope);
  assert.equal(
    await access.get('guest', manifest.pack_id, previewManifest.version),
    null,
    'admin draft access never leaks into the guest scope',
  );

  // Account departure removes only the signed-in scope. A free guest Original
  // on the same installation must remain available after logout/deletion.
  await bundles.download(manifest, { ownerScope: accountScope });
  await sessions.save(createOriginalSession(manifest, 'guest', 600));
  await access.claimGuest(guestAcquisition);
  const feedback = createOriginalFeedbackStore(files);
  const feedbackBase = {
    schema_version: 1 as const,
    pack_id: manifest.pack_id,
    payload: {
      version: manifest.version,
      category: 'general' as const,
      message: 'Test feedback',
      platform: 'android' as const,
    },
    created_at_ms: 1,
    updated_at_ms: 1,
    attempt_count: 0,
  };
  await feedback.enqueue({ ...feedbackBase, idempotency_key: 'guest-feedback', authentication: 'guest' });
  await feedback.enqueue({ ...feedbackBase, idempotency_key: 'account-feedback', authentication: 'signed_in' });

  await sessions.eraseScope(accountScope);
  await bundles.eraseScope(accountScope);
  await access.eraseScope(accountScope);
  await feedback.eraseSignedIn();

  assert.equal((await sessions.list(accountScope)).length, 0);
  assert.equal((await bundles.list(accountScope)).length, 0);
  assert.equal((await access.list(accountScope)).length, 0);
  assert.equal((await sessions.list('guest')).length, 1, 'guest progress survives account cleanup');
  assert.ok(await bundles.getPinned('guest', manifest.pack_id), 'guest download survives account cleanup');
  assert.ok(await access.get('guest', manifest.pack_id, 1), 'guest-free access survives account cleanup');
  assert.ok(await access.get('account:77', manifest.pack_id, 1), 'another account scope remains isolated');
  assert.deepEqual((await feedback.listPending()).map(item => item.idempotency_key), ['guest-feedback']);

  console.log('Originals durable store tests passed.');
}

void main();
