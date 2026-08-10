import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  originalAdminPreviewExitAction,
  originalAdminPreviewRenderableReviewEntries,
  originalAdminPreviewReviewEntries,
} from '../adminPreviewReview';
import { compileOriginalManifestV3, validateOriginalManifestV3 } from '../manifestV3';
import type { OriginalManifestV3 } from '../types';

const here = dirname(fileURLToPath(import.meta.url));
const source = JSON.parse(readFileSync(resolve(
  here,
  '../../../../originals/smokies/roaring_fork_private_manifest_v3.json',
), 'utf8')) as Omit<OriginalManifestV3, 'pack_id' | 'version' | 'manifest_id'>;
const manifest = validateOriginalManifestV3({
  ...source,
  pack_id: 'great_smoky_mountains_ridges_rivers_living_memory',
  version: 1_000_000_002,
  manifest_id: 'original_preview_manifest_great_smoky_mountains_ridges_rivers_living_memory_r2',
});
const compiled = compileOriginalManifestV3(manifest, {
  chapter_id: 'roaring_fork',
  variant_id: 'one_way',
});

const adminEntries = originalAdminPreviewReviewEntries(
  compiled.manifest,
  compiled.selectable,
  { isAdmin: true, simulation: true, privatePreview: true },
);
assert.equal(adminEntries.length, 13, 'the exact R2 review exposes all thirteen stories');
assert.deepEqual(adminEntries.map(entry => entry.sequence), Array.from({ length: 13 }, (_, index) => index + 1));
assert.equal(new Set(adminEntries.map(entry => entry.id)).size, 13);
assert.deepEqual(
  Object.fromEntries(['hard_auto', 'capacity_deeper', 'stopped_deeper', 'completion_deeper'].map(mode => [
    mode,
    adminEntries.filter(entry => entry.mode === mode).length,
  ])),
  {
    hard_auto: 5,
    capacity_deeper: 4,
    stopped_deeper: 3,
    completion_deeper: 1,
  },
);

for (const surface of [
  'android_back',
  'top_close',
  'end_test',
  'completion_exit',
  'privilege_loss',
] as const) {
  assert.equal(
    originalAdminPreviewExitAction(surface, {
      privateReviewActive: true,
      cleanupPending: false,
    }),
    'exact_private_cleanup',
    `${surface} cannot discard a live private-review cleanup identity`,
  );
  assert.equal(
    originalAdminPreviewExitAction(surface, {
      privateReviewActive: false,
      cleanupPending: true,
    }),
    'exact_private_cleanup',
    `${surface} keeps retrying a partial exact cleanup`,
  );
  assert.equal(
    originalAdminPreviewExitAction(surface, {
      privateReviewActive: false,
      cleanupPending: false,
    }),
    'simulation_stop',
    `${surface} leaves ordinary admin Trigger Lab behavior unchanged`,
  );
}
assert.deepEqual(adminEntries.map(entry => entry.id), [
  'rf_cue_02',
  'rf_story_03',
  'rf_cue_01',
  'rf_story_01',
  'rf_cue_04',
  'rf_cue_03',
  'rf_story_02',
  'rf_story_04',
  'rf_story_05',
  'rf_cue_05',
  'rf_story_06',
  'rf_story_07',
  'rf_cue_06',
]);
assert.ok(adminEntries.every(entry => entry.audio_asset_id && entry.artwork_asset_id));

const localAssets = compiled.manifest.assets.map(asset => ({
  ...asset,
  local_uri: `file:///verified-private-bundle/${asset.id}`,
}));
const renderableEntries = originalAdminPreviewRenderableReviewEntries(adminEntries, localAssets);
assert.equal(renderableEntries.length, 13);
assert.equal(
  new Set(renderableEntries.map(entry => entry.artwork_asset_id)).size,
  7,
  'all thirteen stories retain the exact seven approved artwork identities',
);
assert.ok(renderableEntries.every(entry => (
  entry.artwork_uri === `file:///verified-private-bundle/${entry.artwork_asset_id}`
)));
assert.throws(
  () => originalAdminPreviewRenderableReviewEntries(
    adminEntries,
    localAssets.filter(asset => asset.id !== renderableEntries[0].artwork_asset_id),
  ),
  /Approved artwork .* is not uniquely available/,
  'private review fails closed instead of substituting missing artwork',
);
assert.throws(
  () => originalAdminPreviewRenderableReviewEntries(
    adminEntries,
    [...localAssets, localAssets.find(asset => asset.id === renderableEntries[0].artwork_asset_id)!],
  ),
  /Approved artwork .* is not uniquely available/,
  'ambiguous local artwork identities also fail closed',
);

assert.deepEqual(
  originalAdminPreviewReviewEntries(compiled.manifest, compiled.selectable, {
    isAdmin: false,
    simulation: true,
    privatePreview: true,
  }),
  [],
  'ordinary signed-in users never receive private review controls',
);
assert.deepEqual(
  originalAdminPreviewReviewEntries(compiled.manifest, compiled.selectable, {
    isAdmin: true,
    simulation: false,
    privatePreview: true,
  }),
  [],
  'public/normal playback remains unchanged for administrators',
);
assert.deepEqual(
  originalAdminPreviewReviewEntries(compiled.manifest, compiled.selectable, {
    isAdmin: true,
    simulation: true,
    privatePreview: false,
  }),
  [],
  'an admin Trigger Lab for released content does not expose private review controls',
);
assert.deepEqual(
  originalAdminPreviewReviewEntries(compiled.manifest, null, {
    isAdmin: true,
    simulation: true,
    privatePreview: true,
  }),
  [],
  'V1/V2 playback does not gain this V3-only control',
);

console.log('Exact R2 admin private-review reachability tests passed.');
