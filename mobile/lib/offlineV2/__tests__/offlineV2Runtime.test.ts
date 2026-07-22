import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  canonicalOfflineManifestJson,
  createOfflineBundleJobStoreV2,
  createOfflineBundleManifestRepository,
  createOfflineBundlePreparationClientV2,
  createOfflineBundleRuntimeV2,
  createOfflineDownloadCoordinator,
  offlineFtsPrefixQuery,
  type OfflineArtifactTransferAdapter,
  type OfflineBundleDownloadJobV2,
  type OfflineBundleManifestV2,
  type OfflineBundlePreparationClientV2,
  type OfflineRendererDownloadAdapter,
} from '..';
import { createMemoryOriginalFileAdapter } from '../../originals/__tests__/memoryFileAdapter';

const body = 'offline-places';

function manifest(revision = 'runtime-1'): OfflineBundleManifestV2 {
  const draft: OfflineBundleManifestV2 = {
    schema_version: 2,
    bundle_id: 'runtime-moab',
    revision,
    manifest_sha256: '0'.repeat(64),
    created_at: '2026-07-22T12:00:00.000Z',
    renderer: {
      id: 'rnmapbox',
      style_id: 'outdoors',
      style_uri: 'mapbox://styles/mapbox/outdoors-v12',
      style_revision: 'outdoors-12',
      style_pack_id: `style-${revision}`,
      tile_region_id: `tiles-${revision}`,
    },
    bounds: { west: -109.8, south: 38.3, east: -109.2, north: 38.9 },
    min_zoom: 6,
    max_zoom: 14,
    artifacts: [
      {
        id: 'map-style', kind: 'map_style', storage: 'renderer_style_pack', required: true,
        revision, bytes: 50, size_kind: 'estimated', integrity: 'renderer_probe',
      },
      {
        id: 'map-tiles', kind: 'map_tiles', storage: 'renderer_tile_region', required: true,
        revision, bytes: 100, size_kind: 'estimated', integrity: 'renderer_probe',
      },
      {
        id: 'places', kind: 'places', storage: 'file', required: true,
        revision, bytes: Buffer.byteLength(body), size_kind: 'exact', integrity: 'sha256',
        sha256: createHash('sha256').update(body).digest('hex'),
        uri: '/api/offline/bundles/prep/artifacts/places',
        media_type: 'application/json', record_count: 1,
      },
    ],
    capabilities: {
      map: true, places: true, trails: false, search: false,
      routing: false, contours: false, media: false,
    },
    required_storage_bytes: 512,
    source_attribution: ['Trailhead', 'Mapbox'],
    license_ids: ['trailhead-v2'],
  };
  return {
    ...draft,
    manifest_sha256: createHash('sha256')
      .update(canonicalOfflineManifestJson(draft))
      .digest('hex'),
  };
}

async function waitForJob(
  runtime: ReturnType<typeof createOfflineBundleRuntimeV2>,
  id: string,
  status: OfflineBundleDownloadJobV2['status'],
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const job = await runtime.get(id);
    if (job?.status === status) return job;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(`Job ${id} did not reach ${status}.`);
}

async function main() {
assert.equal(offlineFtsPrefixQuery('Moab camps'), '"Moab"* AND "camps"*');
assert.equal(offlineFtsPrefixQuery('mesa -arch: OR *'), '"mesa"* AND "arch"* AND "OR"*');
assert.equal(offlineFtsPrefixQuery('  '), '');

{
  const direct = manifest('direct');
  const client = createOfflineBundlePreparationClientV2({
    baseUrl: 'https://api.test',
    getAuthToken: async () => 'token',
    fetchImpl: (async () => new Response(JSON.stringify(direct), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch,
  });
  assert.equal((await client.prepare({ bounds: direct.bounds })).revision, 'direct');
}

{
  const queuedManifest = manifest('queued');
  const paths: string[] = [];
  const client = createOfflineBundlePreparationClientV2({
    baseUrl: 'https://api.test/',
    getAuthToken: async () => 'token',
    fetchImpl: (async (url: string | URL | Request) => {
      const path = String(url);
      paths.push(path);
      const payload = path.endsWith('/prepare')
        ? { schema_version: 2, id: 'preparation-1', status: 'queued', progress: 0, created_at: 1, updated_at: 1 }
        : { schema_version: 2, id: 'preparation-1', status: 'ready', progress: 100, manifest: queuedManifest, created_at: 1, updated_at: 2 };
      return new Response(JSON.stringify(payload), {
        status: path.endsWith('/prepare') ? 202 : 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch,
  });
  const updates: string[] = [];
  assert.equal((await client.prepare({ bounds: queuedManifest.bounds }, {
    poll_interval_ms: 250,
    onPreparation: item => updates.push(item.status),
  })).revision, 'queued');
  assert.deepEqual(updates, ['queued', 'ready']);
  assert.match(paths[1], /\/api\/offline\/bundles\/preparations\/preparation-1$/);

  paths.length = 0;
  updates.length = 0;
  assert.equal((await client.resume!('preparation-1', {
    poll_interval_ms: 250,
    onPreparation: item => updates.push(item.status),
  })).revision, 'queued');
  assert.deepEqual(updates, ['ready']);
  assert.deepEqual(paths, ['https://api.test/api/offline/bundles/preparations/preparation-1']);
}

function createHarness(options: {
  blockFirstTransfer?: boolean;
  corruptFirstTransfer?: boolean;
  freeBytes?: number;
  failRendererRemoval?: boolean;
} = {}) {
  const files = createMemoryOriginalFileAdapter();
  const repository = createOfflineBundleManifestRepository(files, 'memory://runtime/repository');
  const jobs = createOfflineBundleJobStoreV2(files, 'memory://runtime/jobs');
  let block = Boolean(options.blockFirstTransfer);
  let corruptTransfers = options.corruptFirstTransfer ? 1 : 0;
  let transferCalls = 0;
  const transfer: OfflineArtifactTransferAdapter = {
    async download(artifact, destination, downloadOptions) {
      transferCalls += 1;
      downloadOptions.onProgress?.({ received_bytes: 2, total_bytes: artifact.bytes, resume_token: 'resume-1' });
      if (block) {
        await new Promise<void>((_resolve, reject) => {
          downloadOptions.signal?.addEventListener('abort', () => {
            const error = new Error('paused');
            error.name = 'AbortError';
            reject(error);
          }, { once: true });
        });
      }
      const output = corruptTransfers > 0 ? 'x'.repeat(Buffer.byteLength(body)) : body;
      corruptTransfers = Math.max(0, corruptTransfers - 1);
      await files.writeText(destination, output);
      downloadOptions.onProgress?.({ received_bytes: artifact.bytes, total_bytes: artifact.bytes });
      return { etag: artifact.sha256 };
    },
    async pause() {
      block = false;
      return { resume_token: 'resume-1' };
    },
  };
  const renderer: OfflineRendererDownloadAdapter = {
    renderer: 'rnmapbox',
    async prepare(value) {
      return {
        renderer: 'rnmapbox',
        style_pack_id: value.renderer.style_pack_id,
        tile_region_id: value.renderer.tile_region_id,
        native_pack_name: `pack-${value.revision}`,
      };
    },
    async inspect() {
      return {
        renderer: 'rnmapbox', ready: true, style_ready: true,
        tiles_ready: true, render_probe_ready: true, diagnostics: [],
      };
    },
    async remove() {
      if (options.failRendererRemoval) throw new Error('native pack removal failed');
    },
  };
  const coordinator = createOfflineDownloadCoordinator({
    activeRenderer: 'rnmapbox', files, repository, rendererAdapters: { rnmapbox: renderer },
  });
  let currentManifest = manifest();
  let prepareCalls = 0;
  let resumeCalls = 0;
  const preparation: OfflineBundlePreparationClientV2 = {
    async prepare() {
      prepareCalls += 1;
      return currentManifest;
    },
    async resume() {
      resumeCalls += 1;
      return currentManifest;
    },
  };
  const runtime = createOfflineBundleRuntimeV2({
    ownerScope: 'account:7', preparation, coordinator, repository, jobs, transfer, renderer,
    storage: { freeDiskBytes: async () => options.freeBytes ?? 100_000_000 },
  });
  return {
    files, repository, jobs, runtime,
    setManifest(value: OfflineBundleManifestV2) { currentManifest = value; },
    preparationCalls() { return { prepare: prepareCalls, resume: resumeCalls }; },
    transferCalls() { return transferCalls; },
  };
}

{
  const harness = createHarness({ failRendererRemoval: true });
  const created = await harness.runtime.create({
    owner_scope: 'account:7', label: 'Removal failure', request: { bounds: manifest().bounds },
  });
  const ready = await waitForJob(harness.runtime, created.job_id, 'ready');
  await assert.rejects(
    harness.runtime.remove(ready.manifest!.bundle_id),
    /native pack removal failed/,
  );
  assert.equal((await harness.repository.listCurrentInstallations()).length, 1);
  assert.ok(await harness.jobs.get(created.job_id), 'failed native removal retains the visible job for retry');
}

{
  const harness = createHarness();
  const persisted: OfflineBundleDownloadJobV2 = Object.freeze({
    schema_version: 2,
    job_id: 'persisted-preparation',
    owner_scope: 'account:7',
    client_ref: 'area:persisted',
    label: 'Persisted preparation',
    status: 'paused',
    request: { bounds: manifest().bounds },
    preparation: Object.freeze({
      schema_version: 2,
      id: 'preparation-persisted',
      status: 'running',
      progress: 42,
      created_at: 1,
      updated_at: 2,
    }),
    artifact_states: Object.freeze({}),
    resume_tokens: Object.freeze({}),
    created_at_ms: 1,
    updated_at_ms: 2,
  });
  await harness.jobs.save(persisted);
  void harness.runtime.resume(persisted.job_id);
  assert.equal((await waitForJob(harness.runtime, persisted.job_id, 'ready')).status, 'ready');
  assert.deepEqual(
    harness.preparationCalls(),
    { prepare: 0, resume: 1 },
    'persisted preparation resumes with GET instead of creating a duplicate POST job',
  );
}

{
  const harness = createHarness();
  const created = await harness.runtime.create({
    owner_scope: 'account:7', client_ref: 'area:moab', label: 'Moab',
    request: { bounds: manifest().bounds },
  });
  const ready = await waitForJob(harness.runtime, created.job_id, 'ready');
  assert.equal(ready.artifact_states.places.status, 'ready');
  assert.equal((await harness.repository.listCurrentInstallations()).length, 1);
  assert.equal((await harness.jobs.list('account:7'))[0].client_ref, 'area:moab');

  const transfersBeforeInspection = harness.transferCalls();
  const livePath = ready.artifact_states.places.local_uri!;
  await harness.files.writeText(livePath, 'corrupt-value');
  const inspected = await harness.runtime.inspect(created.job_id);
  assert.equal(inspected.status, 'repair_required');
  assert.equal(inspected.artifact_states.places.status, 'repair_required');
  assert.equal(
    harness.transferCalls(),
    transfersBeforeInspection,
    'inspection reports corruption without silently starting a repair transfer',
  );
  assert.equal(await harness.files.readText(livePath), 'corrupt-value');

  const repair = await harness.runtime.create({
    owner_scope: 'account:7', client_ref: 'area:moab-repair', label: 'Moab repair',
    request: { bounds: manifest().bounds },
  });
  const repaired = await waitForJob(harness.runtime, repair.job_id, 'ready');
  assert.equal(await harness.files.readText(repaired.artifact_states.places.local_uri!), body);
  assert.equal((await harness.repository.listCurrentInstallations()).length, 1, 'repair replaces the same revision');
}

{
  const harness = createHarness({ blockFirstTransfer: true });
  const created = await harness.runtime.create({
    owner_scope: 'account:7', label: 'Paused area', request: { bounds: manifest().bounds },
  });
  await waitForJob(harness.runtime, created.job_id, 'downloading');
  const paused = await harness.runtime.pause(created.job_id);
  assert.equal(paused.status, 'paused');
  assert.equal(paused.resume_tokens.places, 'resume-1');
  void harness.runtime.resume(created.job_id);
  assert.equal((await waitForJob(harness.runtime, created.job_id, 'ready')).status, 'ready');
}

{
  const harness = createHarness({ freeBytes: 1 });
  const created = await harness.runtime.create({
    owner_scope: 'account:7', label: 'No storage', request: { bounds: manifest().bounds },
  });
  const failed = await waitForJob(harness.runtime, created.job_id, 'error');
  assert.equal(failed.error?.code, 'insufficient_storage');
}

{
  const harness = createHarness({ corruptFirstTransfer: true });
  const created = await harness.runtime.create({
    owner_scope: 'account:7', label: 'Corrupt first transfer', request: { bounds: manifest().bounds },
  });
  const repair = await waitForJob(harness.runtime, created.job_id, 'repair_required');
  assert.equal(repair.error?.code, 'offline_integrity_failed');
  assert.equal(repair.start, undefined, 'corrupt staged bytes are discarded');
  assert.deepEqual(repair.resume_tokens, {}, 'unsafe resume tokens are cleared');
  void harness.runtime.resume(created.job_id);
  assert.equal((await waitForJob(harness.runtime, created.job_id, 'ready')).status, 'ready');
}

console.log('Offline V2 preparation/runtime tests passed.');
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
