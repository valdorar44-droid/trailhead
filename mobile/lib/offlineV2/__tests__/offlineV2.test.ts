import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  classifyLegacyOfflinePack,
  canonicalOfflineManifestJson,
  createMapLibreReadinessAdapter,
  createOfflineBundleManifestRepository,
  createOfflineDownloadCoordinator,
  createQueuedArtifactState,
  createRnMapboxReadinessAdapter,
  transitionOfflineArtifactState,
  validateOfflineArtifactFile,
  validateOfflineBundleManifest,
  type OfflineBundleInstallationV2,
  type OfflineBundleManifestV2,
  type OfflineRendererReadinessAdapter,
} from '..';
import { createMemoryOriginalFileAdapter } from '../../originals/__tests__/memoryFileAdapter';

const placesBody = 'places-index';
const placesHash = createHash('sha256').update(placesBody).digest('hex');
const sha = (character: string) => character.repeat(64);

const manifest = (revision = '2026-07-20.1'): OfflineBundleManifestV2 => {
  const value: OfflineBundleManifestV2 = {
    schema_version: 2,
    bundle_id: 'moab-box',
    revision,
    manifest_sha256: sha('0'),
    created_at: '2026-07-20T12:00:00.000Z',
    renderer: {
      id: 'rnmapbox',
      style_uri: 'mapbox://styles/trailhead/outdoors',
      style_revision: 'style-7',
      style_pack_id: 'style:moab-box',
      tile_region_id: 'tiles:moab-box',
    },
    bounds: { west: -109.8, south: 38.3, east: -109.2, north: 38.9 },
    min_zoom: 5,
    max_zoom: 14,
    artifacts: [
      {
        id: 'map-style', kind: 'map_style', storage: 'renderer_style_pack', required: true,
        revision: 'style-7', bytes: 10, size_kind: 'estimated', integrity: 'renderer_probe',
      },
      {
        id: 'map-tiles', kind: 'map_tiles', storage: 'renderer_tile_region', required: true,
        revision: 'tiles-7', bytes: 20, size_kind: 'estimated', integrity: 'renderer_probe',
      },
      {
        id: 'places', kind: 'places', storage: 'file', required: true,
        revision: 'places-7', bytes: Buffer.byteLength(placesBody), size_kind: 'exact', integrity: 'sha256',
        sha256: placesHash, uri: 'https://assets.test/places.sqlite', record_count: 42,
      },
      {
        id: 'thumbs', kind: 'thumbnail', storage: 'file', required: false,
        revision: 'thumbs-7', bytes: 5, size_kind: 'exact', integrity: 'sha256',
        sha256: sha('c'), uri: 'https://assets.test/thumbs.bin',
      },
    ],
    capabilities: {
      map: true, places: true, trails: false, search: false,
      routing: false, contours: false, media: true,
    },
    required_storage_bytes: 128,
    source_attribution: ['Trailhead', 'Mapbox'],
    license_ids: ['trailhead-canonical-v1'],
  };
  return {
    ...value,
    manifest_sha256: createHash('sha256').update(canonicalOfflineManifestJson(value)).digest('hex'),
  };
};

async function main() {
{
  assert.equal(validateOfflineBundleManifest(manifest()).schema_version, 2);
  assert.throws(() => validateOfflineBundleManifest({
    ...manifest(),
    artifacts: [...manifest().artifacts, manifest().artifacts[0]],
  }), /Duplicate artifact id/);
  assert.throws(() => validateOfflineBundleManifest({
    ...manifest(),
    required_storage_bytes: 1,
  }), /cannot be smaller/);
}

{
  const queued = createQueuedArtifactState({ id: 'places', bytes: 12 }, 10);
  const downloading = transitionOfflineArtifactState(queued, 'downloading', { received_bytes: 4, updated_at_ms: 20 });
  const verifying = transitionOfflineArtifactState(downloading, 'verifying', { updated_at_ms: 30 });
  const ready = transitionOfflineArtifactState(verifying, 'ready', { local_uri: 'memory://places', updated_at_ms: 40 });
  assert.equal(queued.received_bytes, 0, 'the previous state remains unchanged');
  assert.equal(Object.isFrozen(ready), true);
  assert.equal(ready.received_bytes, 12);
  assert.throws(() => transitionOfflineArtifactState(queued, 'ready'), /Invalid offline artifact transition/);
}

{
  const files = createMemoryOriginalFileAdapter();
  await files.writeText('memory://docs/valid', placesBody);
  const descriptor = manifest().artifacts.find(artifact => artifact.id === 'places')!;
  assert.equal((await validateOfflineArtifactFile(files, descriptor, 'memory://docs/valid')).code, 'valid');
  assert.equal((await validateOfflineArtifactFile(files, descriptor, 'memory://docs/missing')).code, 'missing');
  await files.writeText('memory://docs/wrong', 'wrong');
  assert.equal((await validateOfflineArtifactFile(files, descriptor, 'memory://docs/wrong')).code, 'size_mismatch');
}

{
  let styleReady = true;
  let tilesReady = true;
  let probeReady = true;
  const adapter = createRnMapboxReadinessAdapter({
    async isStylePackReady() { return styleReady; },
    async isTileRegionReady() { return tilesReady; },
    async probeRender() { return probeReady; },
  });
  const install = {
    renderer: 'rnmapbox' as const,
    style_pack_id: 'style:moab-box',
    tile_region_id: 'tiles:moab-box',
  };
  assert.equal((await adapter.inspect(manifest(), install)).ready, true);
  tilesReady = false;
  assert.equal((await adapter.inspect(manifest(), install)).tiles_ready, false);
  tilesReady = true;
  probeReady = false;
  assert.equal((await adapter.inspect(manifest(), install)).render_probe_ready, false);
  styleReady = false;
  assert.equal((await adapter.inspect(manifest(), install)).style_ready, false);
}

{
  const mapLibreManifest: OfflineBundleManifestV2 = {
    ...manifest(),
    renderer: { ...manifest().renderer, id: 'maplibre' },
    artifacts: manifest().artifacts.map(artifact => artifact.kind === 'map_style' || artifact.kind === 'map_tiles'
      ? { ...artifact, storage: 'renderer_legacy_pack' as const }
      : artifact),
  };
  let percentage = 100;
  const adapter = createMapLibreReadinessAdapter({
    async getPackStatus() { return { percentage }; },
    async probeRender() { return true; },
  });
  const installed = { renderer: 'maplibre' as const, legacy_pack_name: 'Moab' };
  assert.equal((await adapter.inspect(mapLibreManifest, installed)).ready, true);
  percentage = 62;
  assert.equal((await adapter.inspect(mapLibreManifest, installed)).ready, false);
  assert.equal(classifyLegacyOfflinePack({ name: 'Moab', renderer: 'maplibre', percentage: 100 }, 'maplibre').label, 'Map only');
  assert.equal(classifyLegacyOfflinePack({ name: 'Moab', renderer: 'maplibre', percentage: 100 }, 'rnmapbox').label, 'Repair required');
}

{
  const files = createMemoryOriginalFileAdapter();
  const repository = createOfflineBundleManifestRepository(files, undefined, () => 1000);
  const first = manifest();
  const savedPath = await repository.saveManifest(first);
  assert.match(savedPath, /offline-v2\/manifests/);
  assert.equal((await repository.getManifest(first.bundle_id, first.revision))?.revision, first.revision);
  await assert.rejects(
    repository.saveManifest({ ...first, manifest_sha256: sha('f') }),
    /failed checksum verification/,
  );
  const edited = { ...first, max_zoom: 15, manifest_sha256: sha('0') };
  const editedWithDigest = {
    ...edited,
    manifest_sha256: createHash('sha256').update(canonicalOfflineManifestJson(edited)).digest('hex'),
  };
  await assert.rejects(
    repository.saveManifest(editedWithDigest),
    /is immutable/,
  );

  const readyRenderer: OfflineRendererReadinessAdapter = {
    renderer: 'rnmapbox',
    async inspect() {
      return {
        renderer: 'rnmapbox', ready: true, style_ready: true, tiles_ready: true,
        render_probe_ready: true, diagnostics: [],
      };
    },
  };
  const coordinator = createOfflineDownloadCoordinator({
    activeRenderer: 'rnmapbox',
    files,
    repository,
    rendererAdapters: { rnmapbox: readyRenderer },
    now: () => 2000,
  });
  const start = await coordinator.begin(first);
  await files.writeText(repository.artifactPath(start.stage, 'places'), placesBody);
  const committed = await coordinator.commit(start, {
    renderer: 'rnmapbox',
    style_pack_id: first.renderer.style_pack_id,
    tile_region_id: first.renderer.tile_region_id,
  });
  const { installation, receipt } = committed;
  const finalPlaces = installation.artifacts.places.local_uri!;
  assert.equal(receipt.manifest_sha256, first.manifest_sha256);
  assert.deepEqual(
    [...receipt.verified_required_artifact_ids].sort(),
    first.artifacts.filter(artifact => artifact.required).map(artifact => artifact.id).sort(),
  );
  assert.equal((await repository.getInstallation(first.bundle_id, first.revision))?.directory_uri, start.stage.final_directory_uri);
  assert.equal((await repository.getCurrentInstallation(first.bundle_id))?.revision, first.revision);

  const inspection = await coordinator.inspect(first, installation);
  assert.equal(inspection.status, 'ready');
  assert.equal(inspection.ready, true);
  assert.equal(inspection.artifact_states.thumbs.status, 'queued', 'missing optional media does not block readiness');
  assert.equal(inspection.capability_readiness.media, false);

  await files.writeText(finalPlaces, 'corrupt-data');
  const corrupt = await coordinator.inspect(first, installation);
  assert.equal(corrupt.status, 'repair_required');
  assert.equal(corrupt.artifact_states.places.status, 'repair_required');

  const update = await coordinator.inspect(manifest('2026-07-20.2'), installation);
  assert.equal(update.status, 'needs_update');

  const wrongRenderer = createOfflineDownloadCoordinator({
    activeRenderer: 'maplibre', files, repository, rendererAdapters: {}, now: () => 3000,
  });
  assert.equal((await wrongRenderer.inspect(first, installation)).status, 'repair_required');

  const interruptedManifest = manifest('2026-07-20.interrupted');
  const interrupted = await coordinator.begin(interruptedManifest);
  await files.writeText(repository.artifactPath(interrupted.stage, 'places'), 'partial');
  await assert.rejects(
    coordinator.commit(interrupted, {
      renderer: 'rnmapbox',
      style_pack_id: interruptedManifest.renderer.style_pack_id,
      tile_region_id: interruptedManifest.renderer.tile_region_id,
    }),
    /wrong size/,
  );
  assert.equal(await repository.getInstallation(interruptedManifest.bundle_id, interruptedManifest.revision), null);

  const corruptManifest = manifest('2026-07-20.corrupt');
  const corruptStage = await coordinator.begin(corruptManifest);
  await files.writeText(repository.artifactPath(corruptStage.stage, 'places'), 'places-indey');
  await assert.rejects(
    coordinator.commit(corruptStage, {
      renderer: 'rnmapbox',
      style_pack_id: corruptManifest.renderer.style_pack_id,
      tile_region_id: corruptManifest.renderer.tile_region_id,
    }),
    /checksum verification/,
  );

  const rendererFailure: OfflineRendererReadinessAdapter = {
    renderer: 'rnmapbox',
    async inspect() {
      return {
        renderer: 'rnmapbox', ready: false, style_ready: true, tiles_ready: true,
        render_probe_ready: false, diagnostics: ['The active renderer probe failed.'],
      };
    },
  };
  const failingCoordinator = createOfflineDownloadCoordinator({
    activeRenderer: 'rnmapbox', files, repository,
    rendererAdapters: { rnmapbox: rendererFailure }, now: () => 3000,
  });
  const probeManifest = manifest('2026-07-20.probe');
  const probeStage = await failingCoordinator.begin(probeManifest);
  await files.writeText(repository.artifactPath(probeStage.stage, 'places'), placesBody);
  await assert.rejects(
    failingCoordinator.commit(probeStage, {
      renderer: 'rnmapbox',
      style_pack_id: probeManifest.renderer.style_pack_id,
      tile_region_id: probeManifest.renderer.tile_region_id,
    }),
    /renderer probe failed/,
  );
  await assert.rejects(
    coordinator.commit(probeStage, { renderer: 'maplibre', legacy_pack_name: 'wrong-renderer' }),
    /active map renderer/,
  );

  const receiptManifest = manifest('2026-07-20.receipt');
  const receiptStage = await repository.createStage(receiptManifest);
  await files.writeText(repository.artifactPath(receiptStage, 'places'), placesBody);
  const readyState = (index: number, local_uri?: string) => {
    const artifact = receiptManifest.artifacts[index];
    const queued = createQueuedArtifactState(artifact, 4000);
    const downloading = transitionOfflineArtifactState(queued, 'downloading', {
      received_bytes: artifact.bytes, updated_at_ms: 4000,
    });
    const verifying = transitionOfflineArtifactState(downloading, 'verifying', { updated_at_ms: 4000 });
    return transitionOfflineArtifactState(verifying, 'ready', { local_uri, updated_at_ms: 4000 });
  };
  const forgedInstallation: OfflineBundleInstallationV2 = {
    schema_version: 2,
    bundle_id: receiptManifest.bundle_id,
    revision: receiptManifest.revision,
    manifest_sha256: receiptManifest.manifest_sha256,
    directory_uri: receiptStage.final_directory_uri,
    artifacts: {
      'map-style': readyState(0),
      'map-tiles': readyState(1),
      places: readyState(2, `${receiptStage.final_directory_uri}/artifacts/places`),
      thumbs: createQueuedArtifactState(receiptManifest.artifacts[3], 4000),
    },
    renderer: {
      renderer: 'rnmapbox',
      style_pack_id: receiptManifest.renderer.style_pack_id,
      tile_region_id: receiptManifest.renderer.tile_region_id,
    },
    installed_at_ms: 4000,
    verified_at_ms: 4000,
  };
  await assert.rejects(
    repository.commitStage(receiptStage, forgedInstallation, {
      schema_version: 2,
      bundle_id: receiptManifest.bundle_id,
      revision: receiptManifest.revision,
      manifest_sha256: receiptManifest.manifest_sha256,
      verified_required_artifact_ids: ['map-style', 'map-tiles'],
      renderer: {
        id: 'rnmapbox', style_ready: true, tiles_ready: true, render_probe_ready: true,
      },
      verified_at_ms: 4000,
    }),
    /does not cover every required artifact/,
  );

  const newStage = await coordinator.begin(manifest('2026-07-20.3'));
  assert.equal(newStage.artifact_states.places.status, 'queued');
  assert.equal((await repository.getManifest(first.bundle_id, '2026-07-20.3'))?.revision, '2026-07-20.3');
  await repository.discardStage(newStage.stage);
}

console.log('Offline V2 foundation tests passed.');
}

void main();
