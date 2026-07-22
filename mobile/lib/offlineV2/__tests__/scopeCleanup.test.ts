import assert from 'node:assert/strict';
import { clearOfflineBundleScopeV2 } from '../scopeCleanup';
import type { OfflineBundleDownloadJobV2 } from '../jobStore';
import type { OfflineBundleInstallationV2, OfflineBundleManifestV2 } from '../types';
import { createMemoryOriginalFileAdapter } from '../../originals/__tests__/memoryFileAdapter';

async function main() {
  const storage = createMemoryOriginalFileAdapter();
  const root = 'memory://docs/offline-v2/scopes/account_3A7';
  const otherRoot = 'memory://docs/offline-v2/scopes/account_3A8';
  await storage.ensureDirectory(root);
  await storage.ensureDirectory(otherRoot);
  await storage.writeText(`${root}/private.bin`, 'private');
  await storage.writeText(`${otherRoot}/keep.bin`, 'keep');

  const manifest = {
    schema_version: 2,
    bundle_id: 'orphan-bundle',
    revision: 'one',
    renderer: {
      id: 'rnmapbox', style_id: 'outdoors', style_uri: 'mapbox://styles/mapbox/outdoors-v12',
      style_revision: 'one', style_pack_id: 'style-orphan', tile_region_id: 'tiles-orphan',
    },
  } as OfflineBundleManifestV2;
  const job = {
    schema_version: 2,
    job_id: 'job-orphan',
    owner_scope: 'account:7',
    label: 'Orphan',
    status: 'paused',
    request: { bounds: { west: -110, south: 38, east: -109, north: 39 } },
    manifest,
    artifact_states: {},
    resume_tokens: {},
    created_at_ms: 1,
    updated_at_ms: 1,
  } as OfflineBundleDownloadJobV2;
  const installation = {
    schema_version: 2,
    bundle_id: 'installed-bundle',
    revision: 'two',
    manifest_sha256: 'a'.repeat(64),
    directory_uri: `${root}/installed`,
    artifacts: {},
    renderer: { renderer: 'rnmapbox', native_pack_name: 'installed-pack' },
    installed_at_ms: 1,
  } as OfflineBundleInstallationV2;

  let jobs: OfflineBundleDownloadJobV2[] = [job];
  let installations: OfflineBundleInstallationV2[] = [installation];
  const removedPacks: string[] = [];
  await clearOfflineBundleScopeV2({
    ownerScope: 'account:7',
    root,
    runtime: {
      async list() { return jobs; },
      async cancel(id) { jobs = jobs.filter(item => item.job_id !== id); },
    },
    jobs: { async list() { return jobs; } } as any,
    repository: {
      async listCurrentInstallations() { return installations; },
      async removeCurrentInstallation(bundleId: string) {
        installations = installations.filter(item => item.bundle_id !== bundleId);
      },
    } as any,
    renderer: {
      async remove(value) { removedPacks.push(String(value.native_pack_name || '')); },
    },
    storage,
    rendererInstallationForManifest: value => ({
      renderer: value.renderer.id,
      native_pack_name: `orphan-${value.revision}`,
    }),
  });

  assert.deepEqual(removedPacks.sort(), ['installed-pack', 'orphan-one']);
  assert.equal((await storage.info(root)).exists, false, 'departing account root is erased');
  assert.equal((await storage.info(otherRoot)).exists, true, 'another account root is untouched');
  assert.equal(await storage.readText(`${otherRoot}/keep.bin`), 'keep');
  console.log('Offline V2 account-scope cleanup tests passed.');
}

void main();
