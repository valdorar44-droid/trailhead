import assert from 'node:assert/strict';
import { validateOriginalManifest } from '../manifest';
import {
  compileOriginalManifestV2,
  compileOriginalManifestV2Selections,
  listOriginalChapterSelections,
  resolveOriginalManifestForPlayback,
  resolveOriginalManifestForSession,
  validateOriginalConsumerManifest,
  validateOriginalManifestPreview,
  validateOriginalManifestV2,
} from '../manifestV2';
import type {
  OriginalChapterV2,
  OriginalManifestV2,
  OriginalRouteVariantV2,
  OriginalStoryV2,
} from '../types';
import { originalManifest } from './fixtures';

const SHA = 'a'.repeat(64);

function story(id: string, kind: OriginalStoryV2['kind']): OriginalStoryV2 {
  return {
    id,
    kind,
    title: kind === 'story' ? `Story ${id}` : `Cue ${id}`,
    transcript: `Reviewed transcript for ${id}.`,
    audio_asset_id: `audio-${id}`,
    audio_duration_s: kind === 'story' ? 240 : 25,
    citations: [{
      title: 'Official story source',
      url: `https://www.nps.gov/story/${id}`,
      publisher: 'National Park Service',
      role: 'story',
      authority: 'official',
      reviewed_at: '2026-08-01',
      rights_status: 'reference_only',
      affected_claims: [`${id}-visible-scene`, `${id}-history`],
    }],
  };
}

function variant(
  id: string,
  sequence: number,
  direction: string,
  storyIds: string[],
): OriginalRouteVariantV2 {
  return {
    id,
    sequence,
    title: direction === 'forward' ? 'Eastbound' : 'Westbound',
    route: {
      profile: 'driving',
      direction,
      geometry: {
        type: 'LineString',
        coordinates: direction === 'forward'
          ? [[-83.55, 35.6], [-83.53, 35.61], [-83.51, 35.62]]
          : [[-83.51, 35.62], [-83.53, 35.61], [-83.55, 35.6]],
      },
      bounds: { north: 35.62, south: 35.6, east: -83.51, west: -83.55 },
      distance_m: 2_000,
      duration_s: 300,
    },
    cue_refs: storyIds.map((storyId, index) => ({
      story_id: storyId,
      sequence: index + 1,
      coordinates: direction === 'forward'
        ? { lat: 35.605 + index * 0.01, lng: -83.545 + index * 0.02 }
        : { lat: 35.615 - index * 0.01, lng: -83.515 - index * 0.02 },
      explore_place_id: `place-${storyId}`,
      trigger: {
        enter_radius_m: 200,
        exit_radius_m: 300,
        lead_time_s: 0,
        route_progress_start_m: 200 + index * 800,
        route_progress_end_m: 500 + index * 800,
      },
    })),
  };
}

function chapter(
  id: string,
  sequence: number,
  variants: OriginalRouteVariantV2[],
  defaultVariantId: string,
  alternateChapterIds: string[],
): OriginalChapterV2 {
  return {
    id,
    sequence,
    title: id === 'mountain-crossing' ? 'Mountain Crossing' : 'Foothills Parkway',
    summary: 'A selectable drive chapter with current operating checks.',
    default_variant_id: defaultVariantId,
    safety: {
      summary: 'Use marked pullouts.',
      emergency_note: 'Call 911 in an emergency.',
      disclaimers: ['Conditions can change.'],
    },
    access: {
      surface: 'paved',
      vehicle: 'passenger vehicle',
      fees: 'Current fees are checked before Start Tour.',
      accessibility_notes: 'Accessibility varies by stop.',
    },
    season: {
      recommended_months: [4, 5, 6, 9, 10],
      closures_note: 'Seasonal access is checked before Start Tour.',
    },
    operational_sources: [{
      title: 'Current road conditions',
      url: 'https://www.nps.gov/grsm/planyourvisit/conditions.htm',
      publisher: 'National Park Service',
      reviewed_at: '2026-08-01',
      role: 'operational',
      authority: 'official',
      scope: [`${id}-access`],
    }],
    operational_readiness: {
      policy: 'required_before_start',
      source_scopes: [`${id}-access`],
      alternate_chapter_ids: alternateChapterIds,
    },
    validation_selection: {
      selection_id: `smokies-${id}-v1`,
      required_variant_ids: variants.map(candidate => candidate.id),
    },
    variants,
  };
}

function manifestV2(): OriginalManifestV2 {
  const mountainVariants = [
    variant('eastbound', 1, 'forward', ['ridge-story', 'gap-cue']),
    variant('westbound', 2, 'reverse', ['gap-cue', 'ridge-story']),
  ];
  const foothillsVariants = [variant('westbound', 1, 'forward', ['foothills-story'])];
  return {
    schema_version: 2,
    manifest_id: 'smokies-original:1',
    pack_id: 'smokies-original',
    version: 1,
    locale: 'en-US',
    title: 'Great Smoky Mountains: Ridges, Rivers & Living Memory',
    stories: [
      story('ridge-story', 'story'),
      story('gap-cue', 'cue'),
      story('foothills-story', 'story'),
    ],
    // Deliberately reverse input order; declared sequences define selection order.
    chapters: [
      chapter('foothills-parkway', 2, foothillsVariants, 'westbound', ['mountain-crossing']),
      chapter('mountain-crossing', 1, mountainVariants, 'eastbound', ['foothills-parkway']),
    ],
    assets: [
      { id: 'audio-ridge-story', kind: 'narration', path: 'ridge.mp3', mime_type: 'audio/mpeg', bytes: 10, sha256: SHA },
      { id: 'audio-gap-cue', kind: 'narration', path: 'gap.mp3', mime_type: 'audio/mpeg', bytes: 10, sha256: SHA },
      { id: 'audio-foothills-story', kind: 'narration', path: 'foothills.mp3', mime_type: 'audio/mpeg', bytes: 10, sha256: SHA },
    ],
    offline_map: {
      region_id: 'smokies-original-union-v1',
      bounds: { north: 35.8, south: 35.4, east: -83.1, west: -84.0 },
      min_zoom: 7,
      max_zoom: 16,
      estimated_bytes: 500_000_000,
    },
    review: {
      editorial_status: 'approved',
      source_review_completed_at: '2026-08-01',
    },
  };
}

function clonedManifest() {
  return JSON.parse(JSON.stringify(manifestV2())) as OriginalManifestV2;
}

const legacy = originalManifest();
assert.equal(validateOriginalManifest(legacy), legacy, 'the existing V1 validator remains unchanged');

const manifest = manifestV2();
assert.equal(validateOriginalManifestV2(manifest), manifest);
assert.equal(validateOriginalConsumerManifest(legacy), legacy, 'the consumer discriminator preserves V1');
assert.equal(validateOriginalConsumerManifest(manifest), manifest, 'the consumer discriminator accepts V2');

const publicPreview = {
  schema_version: 2 as const,
  manifest_id: manifest.manifest_id,
  pack_id: manifest.pack_id,
  version: manifest.version,
  locale: manifest.locale,
  title: manifest.title,
  chapters: listOriginalChapterSelections(manifest).reduce<Array<{
    id: string;
    sequence: number;
    title: string;
    summary: string;
    default_variant_id: string;
    variants: Array<{
      id: string;
      sequence: number;
      title: string;
      direction: string;
      distance_m: number;
      duration_s: number;
      story_count: number;
      cue_count: number;
    }>;
  }>>((chapters, selection) => {
    let chapter = chapters.find(item => item.id === selection.chapter_id);
    if (!chapter) {
      const source = manifest.chapters.find(item => item.id === selection.chapter_id)!;
      chapter = {
        id: source.id,
        sequence: source.sequence,
        title: source.title,
        summary: source.summary,
        default_variant_id: source.default_variant_id,
        variants: [],
      };
      chapters.push(chapter);
    }
    chapter.variants.push({
      id: selection.variant_id,
      sequence: selection.variant_sequence,
      title: selection.variant_title,
      direction: selection.direction,
      distance_m: selection.distance_m,
      duration_s: selection.duration_s,
      story_count: selection.story_count,
      cue_count: selection.cue_count,
    });
    return chapters;
  }, []),
};
assert.equal(validateOriginalManifestPreview(publicPreview), publicPreview);
assert.throws(
  () => validateOriginalManifestPreview({ ...publicPreview, stories: manifest.stories }),
  /unsupported fields: stories/,
  'public detail previews cannot expose narration transcripts',
);
assert.throws(
  () => validateOriginalManifestPreview({
    ...publicPreview,
    chapters: [{ ...publicPreview.chapters[0], route: manifest.chapters[1].variants[0].route }],
  }),
  /unsupported fields: route/,
  'public V2 previews reject nested route geometry instead of silently retaining it',
);
assert.throws(
  () => validateOriginalManifestPreview({ ...publicPreview, narration_profile: { provider: 'cartesia' } }),
  /unsupported fields: narration_profile/,
  'public previews reject internal provider metadata',
);

assert.deepEqual(listOriginalChapterSelections(manifest).map(selection => ({
  chapter: selection.chapter_id,
  variant: selection.variant_id,
  default: selection.is_default,
  stories: selection.story_count,
  cues: selection.cue_count,
})), [
  { chapter: 'mountain-crossing', variant: 'eastbound', default: true, stories: 1, cues: 1 },
  { chapter: 'mountain-crossing', variant: 'westbound', default: false, stories: 1, cues: 1 },
  { chapter: 'foothills-parkway', variant: 'westbound', default: true, stories: 1, cues: 0 },
]);

const beforeCompile = JSON.stringify(manifest);
const compiledDefaultResult = compileOriginalManifestV2(manifest, { chapter_id: 'mountain-crossing' });
const compiledDefault = compiledDefaultResult.manifest;
assert.equal(JSON.stringify(manifest), beforeCompile, 'compilation does not mutate the immutable V2 manifest');
assert.deepEqual(compiledDefaultResult.selection, {
  validation_selection_id: 'smokies-mountain-crossing-v1',
  chapter_id: 'mountain-crossing',
  variant_id: 'eastbound',
});
assert.equal(compiledDefault.schema_version, 1);
assert.equal(compiledDefault.manifest_id, manifest.manifest_id);
assert.equal(compiledDefault.title, `${manifest.title} — Mountain Crossing`);
assert.deepEqual(compiledDefault.stops.map(stop => stop.id), ['ridge-story', 'gap-cue']);
assert.equal(compiledDefault.stops[0].coordinates.lng, -83.545);
assert.equal(compiledDefault.stops[0].trigger.route_progress_start_m, 200);
assert.equal(compiledDefault.offline_map.region_id, 'smokies-original-union-v1');
assert.deepEqual(compiledDefault.assets.map(asset => asset.id), [
  'audio-foothills-story',
  'audio-gap-cue',
  'audio-ridge-story',
]);
assert.equal(validateOriginalManifest(compiledDefault), compiledDefault);
assert.deepEqual(
  compiledDefault.stops[0].citations[0].scope,
  undefined,
  'editorial claim identifiers never become reader-facing citation scope',
);
assert.equal(
  compileOriginalManifestV2Selections(manifest).length,
  3,
  'detail hydration validates once and compiles every selectable route',
);
assert.deepEqual(
  compileOriginalManifestV2(manifest, { chapter_id: 'mountain-crossing' }),
  compiledDefaultResult,
  'default compilation is deterministic',
);

const compiledReverseResult = compileOriginalManifestV2(manifest, {
  chapter_id: 'mountain-crossing',
  variant_id: 'westbound',
});
const compiledReverse = compiledReverseResult.manifest;
assert.equal(compiledReverse.manifest_id, compiledDefault.manifest_id);
assert.notDeepEqual(compiledReverseResult.selection, compiledDefaultResult.selection);
assert.deepEqual(compiledReverse.stops.map(stop => stop.id), ['gap-cue', 'ridge-story']);
assert.equal(compiledReverse.route.direction, 'reverse');

assert.throws(
  () => resolveOriginalManifestForPlayback(manifest),
  /Choose a chapter and direction/,
  'V2 playback never guesses a route variant',
);
const resolvedPlayback = resolveOriginalManifestForPlayback(manifest, {
  chapter_id: 'mountain-crossing',
  variant_id: 'westbound',
});
assert.equal(resolvedPlayback.source_schema_version, 2);
assert.equal(resolvedPlayback.manifest.route.direction, 'reverse');
assert.deepEqual(resolvedPlayback.selection, {
  schema_version: 1,
  validation_selection_id: 'smokies-mountain-crossing-v1',
  chapter_id: 'mountain-crossing',
  variant_id: 'westbound',
});
assert.equal(
  resolveOriginalManifestForSession(manifest, { chapter_selection: resolvedPlayback.selection }).route.direction,
  'reverse',
  'restore recompiles the exact persisted route selection',
);
assert.throws(
  () => resolveOriginalManifestForSession(manifest, {
    chapter_selection: {
      ...resolvedPlayback.selection!,
      validation_selection_id: 'stale-selection',
    },
  }),
  /validation identity no longer matches/,
);
assert.throws(
  () => resolveOriginalManifestForPlayback(legacy, {
    chapter_id: 'mountain-crossing',
    variant_id: 'eastbound',
  }),
  /cannot be used with a V1 Original/,
);

function assertInvalid(mutate: (candidate: OriginalManifestV2) => void, expected: RegExp) {
  const candidate = clonedManifest();
  mutate(candidate);
  assert.throws(() => validateOriginalManifestV2(candidate), expected);
}

assertInvalid(candidate => {
  candidate.stories[1].id = candidate.stories[0].id;
}, /Story IDs must be unique/);

assertInvalid(candidate => {
  (candidate as unknown as Record<string, unknown>).narration_profile = { provider: 'cartesia' };
}, /unsupported fields: narration_profile/);

assertInvalid(candidate => {
  (candidate.chapters[0] as unknown as Record<string, unknown>).internal_note = 'server only';
}, /unsupported fields: internal_note/);

assertInvalid(candidate => {
  candidate.chapters[1].variants[0].cue_refs[1].sequence = 3;
}, /sequences must be contiguous/);

assertInvalid(candidate => {
  candidate.chapters[1].variants[0].cue_refs[1].story_id = 'ridge-story';
}, /story references must be unique/);

assertInvalid(candidate => {
  candidate.chapters[1].default_variant_id = 'missing';
}, /default_variant_id does not reference/);

assertInvalid(candidate => {
  candidate.chapters[1].validation_selection.required_variant_ids = ['eastbound'];
}, /must require every chapter variant exactly once/);

assertInvalid(candidate => {
  candidate.chapters[0].validation_selection.selection_id = (
    candidate.chapters[1].validation_selection.selection_id
  );
}, /validation selection IDs must be unique/i);

assertInvalid(candidate => {
  candidate.chapters[0].operational_readiness.source_scopes = ['missing-scope'];
}, /without a source/);

assertInvalid(candidate => {
  candidate.chapters[0].operational_readiness.alternate_chapter_ids = ['foothills-parkway'];
}, /invalid alternate chapter reference/);

assertInvalid(candidate => {
  candidate.stories.push(story('unused-story', 'story'));
  candidate.assets.push({
    id: 'audio-unused-story',
    kind: 'narration',
    path: 'unused.mp3',
    mime_type: 'audio/mpeg',
    bytes: 10,
    sha256: SHA,
  });
}, /Every shared story must be referenced/);

assertInvalid(candidate => {
  candidate.chapters[1].variants[1].cue_refs[0].story_id = 'unknown-story';
}, /references an unknown story/);

assertInvalid(candidate => {
  candidate.assets.find(asset => asset.id === 'audio-ridge-story')!.mime_type = 'audio/mp4';
}, /asset format must be audio\/mpeg/);

assertInvalid(candidate => {
  (candidate.stories[0].citations[0] as unknown as { rights_status: string }).rights_status = 'unknown';
}, /rights_status is invalid/);

assertInvalid(candidate => {
  candidate.stories[0].citations[0].affected_claims = [];
}, /affected_claims must contain/);

assertInvalid(candidate => {
  // The non-default variant is also compiled and validated.
  candidate.chapters[1].variants[1].cue_refs[1].trigger.route_progress_end_m = 9_999;
}, /trigger route window exceeds route distance/);

assertInvalid(candidate => {
  candidate.offline_map.bounds.west = -83.54;
}, /not covered by the union offline_map bounds/);

assertInvalid(candidate => {
  candidate.chapters[1].variants[0].cue_refs[0].coordinates.lng = -84.1;
}, /coordinates is not covered by the union offline_map bounds/);

assert.throws(
  () => compileOriginalManifestV2(manifest, { chapter_id: 'missing' }),
  /Unknown chapter/,
);
assert.throws(
  () => compileOriginalManifestV2(manifest, {
    chapter_id: 'mountain-crossing',
    variant_id: 'missing',
  }),
  /Unknown variant/,
);

console.log('OriginalManifestV2 contract and compiler tests passed.');
