import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  originalAdminDraftPreviewPlan,
  originalAdminDraftPreviewRouteParams,
  originalAdminPreviewExitAction,
  originalAdminPreviewRenderableReviewEntries,
  originalAdminPreviewReviewEntries,
  originalAdminPreviewSelectionRequired,
  originalPrivateFieldSafeDiagnostic,
} from '../adminPreviewReview';
import { compileOriginalManifestV3, validateOriginalManifestV3 } from '../manifestV3';
import type { OriginalManifestV3 } from '../types';

const here = dirname(fileURLToPath(import.meta.url));
const source = JSON.parse(readFileSync(resolve(
  here,
  '../../../../originals/smokies/roaring_fork_private_manifest_v3.json',
), 'utf8')) as Omit<OriginalManifestV3, 'pack_id' | 'version' | 'manifest_id'>;
const completeManifest = JSON.parse(readFileSync(resolve(
  here,
  '../../../../originals/smokies/smokies_complete_private_manifest_v3.json',
), 'utf8')) as unknown;
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

assert.equal(originalAdminPreviewSelectionRequired({ schema_version: 1 }), false);
assert.equal(originalAdminPreviewSelectionRequired({ schema_version: 2 }), true);
assert.equal(
  originalAdminPreviewSelectionRequired({ schema_version: 3 }),
  true,
  'Manifest V3 private preview cannot proceed without an explicit chapter and direction',
);

const completePreviewPlan = originalAdminDraftPreviewPlan(completeManifest);
assert.equal(completePreviewPlan.schema_version, 3);
assert.deepEqual(
  completePreviewPlan.selections.map(selection => ({
    key: `${selection.chapter_id}:${selection.variant_id}`,
    label: `${selection.chapter_title} — ${selection.variant_title}`,
    default: selection.is_default,
  })),
  [
    { key: 'mountain_crossing:tn_to_nc', label: 'Mountain Crossing — Sugarlands to Cherokee', default: true },
    { key: 'mountain_crossing:nc_to_tn', label: 'Mountain Crossing — Cherokee to Sugarlands', default: false },
    { key: 'little_river_cades_cove:sugarlands_to_cades_cove_loop', label: 'Little River and Cades Cove — Sugarlands, Little River and Cades Cove', default: true },
    { key: 'roaring_fork:one_way', label: 'Roaring Fork Motor Nature Trail — Roaring Fork Motor Nature Trail', default: true },
    { key: 'foothills_parkway:west_to_east', label: 'Foothills Parkway — Chilhowee Lake to Wears Valley', default: true },
    { key: 'foothills_parkway:east_to_west', label: 'Foothills Parkway — Wears Valley to Chilhowee Lake', default: false },
  ],
  'the admin draft plan exposes all six exact chapter and direction selections',
);
assert.deepEqual(originalAdminDraftPreviewPlan({ schema_version: 1 }).selections, []);
assert.deepEqual(originalAdminDraftPreviewRouteParams('legacy-draft', 1), { id: 'legacy-draft' });
assert.deepEqual(
  completePreviewPlan.selections.map(selection => (
    originalAdminDraftPreviewRouteParams('smokies-draft', 3, selection)
  )),
  completePreviewPlan.selections.map(selection => ({
    id: 'smokies-draft',
    chapter: selection.chapter_id,
    variant: selection.variant_id,
  })),
  'all six admin choices preserve their exact chapter and variant route parameters',
);
assert.throws(
  () => originalAdminDraftPreviewRouteParams('smokies-draft', 3),
  /requires a chapter and direction/,
);
assert.throws(
  () => originalAdminDraftPreviewRouteParams('legacy-draft', 1, completePreviewPlan.selections[0]),
  /V1 Original admin draft cannot use a chapter selection/,
);
const missingChaptersManifest = structuredClone(completeManifest) as any;
missingChaptersManifest.chapters = [];
assert.throws(
  () => originalAdminDraftPreviewPlan(missingChaptersManifest),
  /chapters are required/,
);
const duplicateSelectionManifest = structuredClone(completeManifest) as any;
duplicateSelectionManifest.chapters[0].variants.push(duplicateSelectionManifest.chapters[0].variants[0]);
assert.throws(
  () => originalAdminDraftPreviewPlan(duplicateSelectionManifest),
  /selection .* is duplicated/,
);
const duplicateSequenceManifest = structuredClone(completeManifest) as any;
duplicateSequenceManifest.chapters[0].variants[1].sequence = duplicateSequenceManifest.chapters[0].variants[0].sequence;
assert.throws(
  () => originalAdminDraftPreviewPlan(duplicateSequenceManifest),
  /variant sequence .* is duplicated/,
);

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

const safeDiagnosticInput = {
  pack_id: 'great_smoky_mountains_ridges_rivers_living_memory',
  version: 1_000_000_004,
  manifest_id: 'original_preview_manifest_smokies_r4',
  region_id: 'smokies_ridges_rivers_living_memory_union_private_v1',
  map_bytes: 213_073_997,
  map_complete: true as const,
  bundle_verified: true as const,
};
assert.equal(
  originalPrivateFieldSafeDiagnostic(safeDiagnosticInput, { isAdmin: false, privateField: true }),
  null,
  'ordinary users never receive the private field diagnostic',
);
assert.equal(
  originalPrivateFieldSafeDiagnostic(safeDiagnosticInput, { isAdmin: true, privateField: false }),
  null,
  'admin non-field surfaces never receive the private field diagnostic',
);
const safeDiagnostic = originalPrivateFieldSafeDiagnostic(
  safeDiagnosticInput,
  { isAdmin: true, privateField: true },
);
assert.deepEqual(safeDiagnostic, {
  pack_id: safeDiagnosticInput.pack_id,
  version: safeDiagnosticInput.version,
  manifest_id: safeDiagnosticInput.manifest_id,
  region_code: 'SMOKIES_RIDGES_RIVERS_V1',
  region_label: 'Great Smoky Mountains · Ridges, Rivers & Living Memory',
  map_bytes: 213_073_997,
  map_complete: true,
  bundle_verified: true,
});
assert.deepEqual(Object.keys(safeDiagnostic!).sort(), [
  'bundle_verified',
  'manifest_id',
  'map_bytes',
  'map_complete',
  'pack_id',
  'region_code',
  'region_label',
  'version',
]);
assert.throws(
  () => originalPrivateFieldSafeDiagnostic(
    { ...safeDiagnosticInput, region_id: 'unreviewed-private-region' },
    { isAdmin: true, privateField: true },
  ),
  /could not be safely rendered/,
);

const previewScreenSource = readFileSync(resolve(here, '../../../app/originals/preview.tsx'), 'utf8');
assert.match(previewScreenSource, /!authHydrated \|\| !adminRuntime\.privateReviewRecoveryChecked/);
const freshAuthorizationIndex = previewScreenSource.indexOf('originalsApi.adminPreviewManifest');
const consumedRecoveryIndex = previewScreenSource.indexOf('await requireConsumedOriginalPrivateFieldReviewRecovery');
const recoveredStartIndex = previewScreenSource.indexOf('startPrivateFieldDrive(manifest, selection)');
assert.ok(
  freshAuthorizationIndex >= 0
  && consumedRecoveryIndex > freshAuthorizationIndex
  && recoveredStartIndex > consumedRecoveryIndex,
  'recovery requires fresh online authorization before exact local reuse and field start',
);
assert.match(
  previewScreenSource,
  /if \(durable\) \{[\s\S]*Verifying the saved private bundle and offline map[\s\S]*\} else \{[\s\S]*downloadOriginal/,
  'the consumed recovery branch never redownloads the private bundle or map',
);
assert.match(
  previewScreenSource,
  /startPrivateFieldDrive\(manifest, selection\)[\s\S]*armOriginalPrivateFieldReviewRecovery/,
  'fresh acquisition arms one recovery only after field startup succeeds',
);
assert.match(previewScreenSource, /mode === 'field'/);
assert.match(previewScreenSource, /startPrivateFieldDrive\(manifest, selection\)/);
assert.match(
  previewScreenSource,
  /catch\(async \(caught:[\s\S]*await cleanupPrivateAcquisition\(\)/,
  'permission/start failures retain the exact private cleanup barrier',
);
assert.match(
  previewScreenSource,
  /return \(\) => \{[\s\S]*cleanupPrivateAcquisition\(\)/,
  'navigation away cannot abandon a field-review download or credential',
);
const catalogScreenSource = readFileSync(resolve(here, '../../../app/originals/index.tsx'), 'utf8');
assert.match(catalogScreenSource, /Private GPS field test/);
assert.match(catalogScreenSource, /FOREGROUND ONLY · PARKED OR PASSENGER/);
assert.match(catalogScreenSource, /mode: 'field'/);

const runtimeSource = readFileSync(resolve(here, '../runtime.tsx'), 'utf8');
assert.match(runtimeSource, /if \(!authHydrated\) return undefined/);
assert.match(
  runtimeSource,
  /getOriginalPrivateReviewCleanupIdentity\(\)[\s\S]*catch \{[\s\S]*getOriginalPrivateReviewCleanupIdentityForCleanup\(\)/,
  'a corrupt field marker is cleanup-only when its exact resource tuple remains verifiable',
);
assert.match(
  runtimeSource.slice(runtimeSource.indexOf('const consumed = await consumeOriginalPrivateFieldReviewRecovery')),
  /consumeOriginalPrivateFieldReviewRecovery[\s\S]*dependencies\.access\.get[\s\S]*dependencies\.bundles\.loadManifest/,
  'the one-time cold lease is consumed before local recovery awaits',
);
assert.doesNotMatch(
  runtimeSource.slice(
    runtimeSource.indexOf('const consumed = await consumeOriginalPrivateFieldReviewRecovery'),
    runtimeSource.indexOf('const skipCurrentStory'),
  ),
  /startPrivateFieldDrive\(/,
  'cold-launch quarantine never automatically starts a field session',
);
const playerSource = readFileSync(resolve(here, '../../../app/originals/player.tsx'), 'utf8');
assert.match(playerSource, /isAdmin && privateFieldActive[\s\S]*privateFieldDiagnostic/);
assert.match(playerSource, /originals\.private-field\.safe-diagnostic/);
assert.doesNotMatch(playerSource, /privateFieldDiagnostic\.(?:owner_scope|map_pack_id|directory_uri|manifest_uri|local_uri|device_id|capacity|coordinates|token)/);

console.log('Exact R2 admin private-review reachability tests passed.');
