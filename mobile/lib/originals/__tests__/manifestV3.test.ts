import assert from 'node:assert/strict';

import { originalAssetRequest } from '../bundleStore';
import {
  compileOriginalManifestV3,
  compileOriginalManifestV3Selections,
  listOriginalChapterSelectionsV3,
  originalManifestV3DeliveryContractSha256,
  validateOriginalManifestV3,
} from '../manifestV3';
import {
  resolveOriginalManifestForPlayback,
  resolveOriginalManifestPlaybackForSession,
  resolveOriginalManifestForSession,
  validateOriginalConsumerManifest,
  validateOriginalManifestPreview,
} from '../manifestV2';
import type { OriginalManifestV3 } from '../types';
import { originalManifestV3 } from './fixtures';

const PYTHON_CANONICAL_HASH = '58016df4ffbd67fc9ff4ef2b9c2ad90dc61a79b981f59b79d91bf1814ecbac41';

function clonedManifest() {
  return structuredClone(originalManifestV3());
}

function rehash(manifest: OriginalManifestV3) {
  const chapter = manifest.chapters[0];
  const variant = chapter.variants[0];
  variant.delivery_contract_sha256 = originalManifestV3DeliveryContractSha256(manifest, {
    chapter_id: chapter.id,
    variant_id: variant.id,
  });
}

const source = originalManifestV3();
const beforeValidation = JSON.stringify(source);
const manifest = validateOriginalManifestV3(source);
assert.equal(JSON.stringify(source), beforeValidation, 'V3 validation does not mutate its input');
assert.deepEqual(validateOriginalManifestV3(source), manifest, 'V3 normalization is deterministic');
assert.equal(
  manifest.chapters[0].variants[0].delivery_contract_sha256,
  PYTHON_CANONICAL_HASH,
  'the mobile hash matches the fixed value produced by the Python V3 normalizer',
);
assert.equal(validateOriginalConsumerManifest(source).schema_version, 3);

const compiled = compileOriginalManifestV3(manifest, {
  chapter_id: 'mountain-crossing',
  variant_id: 'eastbound',
});
assert.deepEqual(compiled.selection, {
  validation_selection_id: 'smokies-mountain-crossing-v1',
  chapter_id: 'mountain-crossing',
  variant_id: 'eastbound',
  delivery_contract_sha256: PYTHON_CANONICAL_HASH,
});
assert.deepEqual(compiled.manifest.stops.map(stop => [stop.id, stop.sequence]), [
  ['story-1', 1],
  ['story-3', 2],
]);
assert.equal(compiled.manifest.title, `${manifest.title} — Mountain Crossing`);
assert.deepEqual(compiled.selectable.items.map(item => [item.id, item.delivery.mode]), [
  ['story-4', 'stopped_deeper'],
  ['story-2', 'capacity_deeper'],
  ['story-5', 'stopped_deeper'],
  ['story-6', 'completion_deeper'],
]);
assert.equal(compiled.selectable.delivery_contract_sha256, PYTHON_CANONICAL_HASH);
assert.equal(
  compiled.manifest.stops.some(stop => compiled.selectable.items.some(item => item.id === stop.id)),
  false,
  'selectable stories never enter the legacy hard-cue FIFO',
);
assert.equal(compileOriginalManifestV3Selections(manifest).length, 1);
assert.deepEqual(listOriginalChapterSelectionsV3(manifest).map(item => ({
  stories: item.story_count,
  cues: item.cue_count,
})), [{ stories: 4, cues: 2 }]);

const resolved = resolveOriginalManifestForPlayback(manifest, {
  chapter_id: 'mountain-crossing',
  variant_id: 'eastbound',
});
assert.equal(resolved.source_schema_version, 3);
assert.equal(resolved.manifest.stops.length, 2);
assert.deepEqual(
  resolved.source_schema_version === 3
    ? resolved.selectable.items.map(item => item.id)
    : [],
  ['story-4', 'story-2', 'story-5', 'story-6'],
);
assert.equal(resolveOriginalManifestForSession(manifest, {
  chapter_selection: {
    ...resolved.selection,
    delivery_contract_sha256: PYTHON_CANONICAL_HASH,
  },
} as Parameters<typeof resolveOriginalManifestForSession>[1]).stops.length, 2);
const restoredPlayback = resolveOriginalManifestPlaybackForSession(manifest, {
  chapter_selection: {
    ...resolved.selection,
    delivery_contract_sha256: PYTHON_CANONICAL_HASH,
  },
} as Parameters<typeof resolveOriginalManifestPlaybackForSession>[1]);
assert.equal(restoredPlayback.source_schema_version, 3);
assert.deepEqual(
  restoredPlayback.source_schema_version === 3
    ? restoredPlayback.selectable.items.map(item => item.id)
    : [],
  ['story-4', 'story-2', 'story-5', 'story-6'],
  'stored V3 sessions restore the selectable sidecar without entering the hard FIFO',
);
assert.throws(() => resolveOriginalManifestForSession(manifest, {
  chapter_selection: {
    ...resolved.selection,
    delivery_contract_sha256: 'f'.repeat(64),
  },
} as Parameters<typeof resolveOriginalManifestForSession>[1]), /long-form delivery identity/);

const selection = listOriginalChapterSelectionsV3(manifest)[0];
const publicPreview = {
  schema_version: 3 as const,
  manifest_id: manifest.manifest_id,
  pack_id: manifest.pack_id,
  version: manifest.version,
  locale: manifest.locale,
  title: manifest.title,
  consumer_contract: structuredClone(manifest.consumer_contract),
  chapters: [{
    id: selection.chapter_id,
    sequence: selection.chapter_sequence,
    title: selection.chapter_title,
    summary: selection.chapter_summary,
    default_variant_id: selection.variant_id,
    variants: [{
      id: selection.variant_id,
      sequence: selection.variant_sequence,
      title: selection.variant_title,
      direction: selection.direction,
      distance_m: selection.distance_m,
      duration_s: selection.duration_s,
      story_count: selection.story_count,
      cue_count: selection.cue_count,
      hard_auto_count: 2,
      selectable_count: 4,
    }],
  }],
};
assert.equal(validateOriginalManifestPreview(publicPreview), publicPreview);
assert.throws(() => validateOriginalManifestPreview({
  ...publicPreview,
  consumer_contract: {
    ...publicPreview.consumer_contract,
    required_capabilities: [...publicPreview.consumer_contract.required_capabilities].reverse(),
  },
}), /canonical sorted capability set/);
assert.throws(() => validateOriginalManifestPreview({
  ...publicPreview,
  chapters: [{
    ...publicPreview.chapters[0],
    variants: [{ ...publicPreview.chapters[0].variants[0], selectable_count: 3 }],
  }],
}), /delivery counts must match/);
assert.throws(() => validateOriginalManifestPreview({
  ...publicPreview,
  chapters: [{
    ...publicPreview.chapters[0],
    variants: [{ ...publicPreview.chapters[0].variants[0], hard_auto_count: 0 }],
  }],
}), /hard_auto_count must be a positive integer/);

function assertInvalid(mutate: (candidate: OriginalManifestV3) => void, expected: RegExp) {
  const candidate = clonedManifest();
  mutate(candidate);
  assert.throws(() => validateOriginalManifestV3(candidate), expected);
}

assertInvalid(candidate => {
  (candidate as unknown as Record<string, unknown>).internal_note = true;
}, /unsupported fields: internal_note/);
assertInvalid(candidate => {
  (candidate.consumer_contract as unknown as { required_capabilities: string[] })
    .required_capabilities = [
    'originals_manifest_v3',
    'originals_capacity_scheduler_v1',
    'originals_selectable_v1',
  ];
}, /canonical sorted capability set/);
assertInvalid(candidate => {
  candidate.chapters[0].variants[0].selectable_refs[0].story_id = 'story-1';
  rehash(candidate);
}, /exactly once across cue_refs and selectable_refs/);
assertInvalid(candidate => {
  candidate.chapters[0].variants[0].selectable_refs[3].sequence = 7;
  rehash(candidate);
}, /delivery sequence must be contiguous/);
assertInvalid(candidate => {
  const capacity = candidate.chapters[0].variants[0].selectable_refs[1];
  if (capacity.delivery.mode === 'capacity_deeper') {
    capacity.delivery.next_hard_auto_story_id = 'missing-cue';
  }
  rehash(candidate);
}, /must name a hard cue/);
assertInvalid(candidate => {
  const stopped = candidate.chapters[0].variants[0].selectable_refs[0];
  if (stopped.delivery.mode === 'stopped_deeper') {
    (stopped as unknown as Record<string, unknown>).trigger = {
      ...candidate.chapters[0].variants[0].cue_refs[0].trigger,
    };
  }
}, /stopped delivery cannot have a trigger/);
assertInvalid(candidate => {
  candidate.chapters[0].variants[0].delivery_contract_sha256 = 'f'.repeat(64);
}, /canonical content/);
assertInvalid(candidate => {
  candidate.stories[0].transcript = 'x'.repeat(8 * 1024 * 1024);
}, /exceeds the size limit/);

const audioChanged = clonedManifest();
audioChanged.stories[0].audio_duration_s += 1;
assert.notEqual(originalManifestV3DeliveryContractSha256(audioChanged, {
  chapter_id: 'mountain-crossing',
  variant_id: 'eastbound',
}), PYTHON_CANONICAL_HASH);
const routeChanged = clonedManifest();
routeChanged.chapters[0].variants[0].route.geometry.coordinates[0][0] += 0.0001;
assert.notEqual(originalManifestV3DeliveryContractSha256(routeChanged, {
  chapter_id: 'mountain-crossing',
  variant_id: 'eastbound',
}), PYTHON_CANONICAL_HASH);

const apiAsset = originalAssetRequest('/api/original-assets/pack/audio/hash', {
  Authorization: 'Bearer account-token',
  'X-Trailhead-Originals-Consumer-Contract': 'stale-value',
});
assert.equal(apiAsset.headers.Authorization, 'Bearer account-token');
assert.equal(
  apiAsset.headers['X-Trailhead-Originals-Consumer-Contract'],
  'originals_long_form_delivery_v1',
  'direct API asset fetches cannot omit or override the V3 consumer contract',
);
assert.equal(
  apiAsset.headers['X-Trailhead-Originals-Capabilities'],
  'originals_capacity_scheduler_v1,originals_manifest_v3,originals_selectable_v1',
);
assert.deepEqual(
  originalAssetRequest('https://assets.gettrailhead.app/story.mp3', {
    Authorization: 'Bearer must-not-leak',
  }).headers,
  {},
  'account and capability headers remain stripped from approved CDN assets',
);

console.log('OriginalManifestV3 parser, compiler, preview, and hash tests passed.');
