import { createHash } from 'node:crypto';
import type { OriginalManifestV1, OriginalStopV1 } from '../types';

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
