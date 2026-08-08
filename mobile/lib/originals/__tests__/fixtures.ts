import { createHash } from 'node:crypto';
import { originalManifestV3DeliveryContractSha256 } from '../manifestV3';
import type {
  OriginalManifestV1,
  OriginalManifestV2,
  OriginalManifestV3,
  OriginalStopV1,
  OriginalStoryV2,
} from '../types';

export const AUDIO_ONE = Buffer.from('story one audio');
export const AUDIO_TWO = Buffer.from('story two audio');
export const AUDIO_THREE = Buffer.from('story three audio');

export function sha256(value: Uint8Array) {
  return createHash('sha256').update(value).digest('hex');
}
function storyStop(
  id: string,
  sequence: number,
  lng: number,
  start: number,
  end: number,
  audioAssetId: string,
): OriginalStopV1 {
  return {
    id,
    sequence,
    title: `Story ${sequence}`,
    coordinates: { lat: 0, lng },
    transcript: `Transcript for story ${sequence}.`,
    audio_asset_id: audioAssetId,
    audio_duration_s: 60,
    trigger: {
      enter_radius_m: 250,
      exit_radius_m: 375,
      lead_time_s: 0,
      route_progress_start_m: start,
      route_progress_end_m: end,
    },
    citations: [{ title: 'Official source', url: 'https://example.gov/source' }],
  };
}

export function originalManifest(version = 1): OriginalManifestV1 {
  return {
    schema_version: 1,
    manifest_id: `moab-original:${version}`,
    pack_id: 'moab-original',
    version,
    locale: 'en-US',
    title: 'Moab: Canyons to the Sky',
    route: {
      profile: 'auto',
      direction: 'forward',
      geometry: { type: 'LineString', coordinates: [[0, 0], [0.02, 0]] },
      bounds: { north: 0.01, south: -0.01, east: 0.02, west: 0 },
      distance_m: 2_224,
      duration_s: 7_200,
    },
    stops: [
      storyStop('story-1', 1, 0.0045, 350, 700, 'audio-1'),
      storyStop('story-2', 2, 0.0108, 1_000, 1_400, 'audio-2'),
      storyStop('story-3', 3, 0.0162, 1_650, 2_050, 'audio-3'),
    ],
    assets: [
      { id: 'audio-1', kind: 'audio', path: 'https://assets.test/one.mp3', mime_type: 'audio/mpeg', bytes: AUDIO_ONE.byteLength, sha256: sha256(AUDIO_ONE) },
      { id: 'audio-2', kind: 'audio', path: 'https://assets.test/two.mp3', mime_type: 'audio/mpeg', bytes: AUDIO_TWO.byteLength, sha256: sha256(AUDIO_TWO) },
      { id: 'audio-3', kind: 'audio', path: 'https://assets.test/three.mp3', mime_type: 'audio/mpeg', bytes: AUDIO_THREE.byteLength, sha256: sha256(AUDIO_THREE) },
    ],
    offline_map: {
      region_id: 'moab-canyons',
      bounds: { north: 0.01, south: -0.01, east: 0.02, west: 0 },
      min_zoom: 8,
      max_zoom: 15,
      estimated_bytes: 500,
    },
    safety: { summary: 'Stay on paved roads.', emergency_note: 'Call 911.', disclaimers: ['Conditions change.'] },
    access: { surface: 'paved', vehicle: 'passenger vehicle', fees: 'Park fees apply.', accessibility_notes: 'Check each stop.' },
    season: { recommended_months: [3, 4, 5, 9, 10], closures_note: 'Check official alerts.' },
    review: { editorial_status: 'approved', field_drive_completed_at: '2026-07-01', source_review_completed_at: '2026-07-02' },
  };
}

export function originalManifestV2(version = 1): OriginalManifestV2 {
  const legacy = originalManifest(version);
  const stories = legacy.stops.map(stop => ({
    id: stop.id,
    kind: 'story' as const,
    title: stop.title,
    transcript: stop.transcript,
    audio_asset_id: stop.audio_asset_id,
    audio_duration_s: stop.audio_duration_s,
    citations: [{
      title: 'Official source',
      url: 'https://example.gov/source',
      publisher: 'National Park Service',
      role: 'story' as const,
      authority: 'official' as const,
      reviewed_at: '2026-08-01',
      rights_status: 'reference_only' as const,
      affected_claims: [`${stop.id}-claim`],
    }],
  }));
  const cueRefs = (reverse: boolean) => (reverse ? [...legacy.stops].reverse() : legacy.stops).map((stop, index) => ({
    story_id: stop.id,
    sequence: index + 1,
    coordinates: { ...stop.coordinates },
    trigger: { ...stop.trigger },
  }));
  const chapterBase = {
    sequence: 1,
    title: 'Mountain Crossing',
    summary: 'A reviewed chapter for deterministic mobile tests.',
    default_variant_id: 'eastbound',
    safety: { ...legacy.safety, disclaimers: [...legacy.safety.disclaimers] },
    access: { ...legacy.access },
    season: { ...legacy.season, recommended_months: [...legacy.season.recommended_months] },
    operational_sources: [{
      title: 'Current conditions',
      url: 'https://example.gov/conditions',
      publisher: 'National Park Service',
      reviewed_at: '2026-08-01',
      role: 'operational' as const,
      authority: 'official' as const,
      scope: ['mountain-crossing-access'],
    }],
    operational_readiness: {
      policy: 'required_before_start' as const,
      candidate_id: 'test-smokies-operational-v1',
      candidate_sha256: 'a'.repeat(64),
      source_scopes: ['mountain-crossing-access'],
      alternate_chapter_ids: [] as string[],
    },
    validation_selection: {
      selection_id: 'smokies-mountain-crossing-v1',
      required_variant_ids: ['eastbound', 'westbound'],
    },
  };
  return {
    schema_version: 2,
    manifest_id: `smokies-original:${version}`,
    pack_id: 'smokies-original',
    version,
    locale: 'en-US',
    title: 'Great Smoky Mountains: Ridges, Rivers & Living Memory',
    stories,
    chapters: [{
      id: 'mountain-crossing',
      ...chapterBase,
      variants: [
        {
          id: 'eastbound',
          sequence: 1,
          title: 'Eastbound',
          route: { ...legacy.route, geometry: { ...legacy.route.geometry, coordinates: [...legacy.route.geometry.coordinates] }, bounds: { ...legacy.route.bounds } },
          cue_refs: cueRefs(false),
        },
        {
          id: 'westbound',
          sequence: 2,
          title: 'Westbound',
          route: {
            ...legacy.route,
            direction: 'reverse',
            geometry: { ...legacy.route.geometry, coordinates: [...legacy.route.geometry.coordinates].reverse() },
            bounds: { ...legacy.route.bounds },
          },
          cue_refs: cueRefs(true),
        },
      ],
    }],
    assets: legacy.assets.map(asset => ({ ...asset, kind: 'narration' })),
    offline_map: { ...legacy.offline_map, bounds: { ...legacy.offline_map.bounds }, region_id: `smokies-union:${version}` },
    review: { editorial_status: 'approved', source_review_completed_at: '2026-08-01' },
  };
}

function extraV3Story(id: string, duration: number): OriginalStoryV2 {
  return {
    id,
    kind: 'story',
    title: `Story ${id}`,
    transcript: `Reviewed long-form transcript for ${id}.`,
    audio_asset_id: `audio-${id}`,
    audio_duration_s: duration,
    citations: [{
      title: 'Official source',
      url: `https://example.gov/source/${id}`,
      publisher: 'National Park Service',
      role: 'story',
      authority: 'official',
      reviewed_at: '2026-08-01',
      rights_status: 'reference_only',
      affected_claims: [`${id}-claim`],
    }],
  };
}

export function originalManifestV3(version = 1): OriginalManifestV3 {
  const base = originalManifestV2(version);
  const chapter = base.chapters[0];
  const sourceVariant = chapter.variants[0];
  base.stories[0].kind = 'cue';
  base.stories[2].kind = 'cue';
  base.stories.push(
    extraV3Story('story-4', 180),
    extraV3Story('story-5', 195),
    extraV3Story('story-6', 210),
  );
  ['story-4', 'story-5', 'story-6'].forEach((id, index) => {
    const body = Buffer.from(`audio for ${id}`);
    base.assets.push({
      id: `audio-${id}`,
      kind: 'narration',
      path: `${id}.mp3`,
      mime_type: 'audio/mpeg',
      bytes: body.byteLength,
      sha256: sha256(body),
    });
  });
  const [first, capacity, last] = sourceVariant.cue_refs;
  const manifest: OriginalManifestV3 = {
    ...base,
    schema_version: 3,
    consumer_contract: {
      schema_version: 1,
      contract_id: 'originals_long_form_delivery_v1',
      required_capabilities: [
        'originals_capacity_scheduler_v1',
        'originals_manifest_v3',
        'originals_selectable_v1',
      ],
    },
    chapters: [{
      ...chapter,
      validation_selection: {
        ...chapter.validation_selection,
        required_variant_ids: ['eastbound'],
      },
      variants: [{
        ...sourceVariant,
        cue_refs: [
          { ...first, sequence: 2 },
          { ...last, sequence: 4 },
        ],
        selectable_refs: [
          {
            story_id: 'story-4',
            sequence: 1,
            delivery: {
              mode: 'stopped_deeper',
              availability: 'before_route_user_confirmed_parked',
              experience_group_id: 'pre_route_story',
              requires_user_confirmed_parked: true,
              motion_inference_allowed: false,
              parking_availability: 'not_checked',
              parking_promise: false,
            },
          },
          {
            ...capacity,
            sequence: 3,
            delivery: {
              mode: 'capacity_deeper',
              admission_policy_id: 'capacity_before_next_hard_v1',
              next_hard_auto_story_id: last.story_id,
              guard_before_next_hard_auto_window_s: 30,
              fallback_mode: 'completion_deeper',
              may_queue_behind_capacity: false,
              may_wait_for_active_hard_auto: true,
            },
          },
          {
            story_id: 'story-5',
            sequence: 5,
            coordinates: { lat: 0, lng: 0.018 },
            delivery: {
              mode: 'stopped_deeper',
              availability: 'at_landmark_user_confirmed_parked',
              experience_group_id: 'landmark_story',
              requires_user_confirmed_parked: true,
              motion_inference_allowed: false,
              parking_availability: 'not_checked',
              parking_promise: false,
              availability_radius_m: 250,
            },
          },
          {
            story_id: 'story-6',
            sequence: 6,
            delivery: {
              mode: 'completion_deeper',
              availability: 'after_route_completion',
              requires_route_completion: true,
            },
          },
        ],
        delivery_contract_sha256: '0'.repeat(64),
      }],
    }],
  };
  const variant = manifest.chapters[0].variants[0];
  variant.delivery_contract_sha256 = originalManifestV3DeliveryContractSha256(manifest, {
    chapter_id: manifest.chapters[0].id,
    variant_id: variant.id,
  });
  return manifest;
}
