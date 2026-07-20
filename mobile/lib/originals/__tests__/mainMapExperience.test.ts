import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL as NodeURL } from 'node:url';
import { originalMainMapExperience } from '../mainMapExperience';
import {
  consumerOriginalPlayerShouldRedirect,
  originalStartDestination,
} from '../mainMapNavigation';
import type { OriginalManifestV1, OriginalSessionV1 } from '../types';

const manifest: OriginalManifestV1 = {
  schema_version: 1,
  manifest_id: 'manifest-moab-v1',
  pack_id: 'moab',
  version: 1,
  locale: 'en-US',
  title: 'Moab: Canyons to the Sky',
  route: {
    profile: 'driving',
    direction: 'forward',
    geometry: {
      type: 'LineString',
      coordinates: [[-109.6, 38.5], [-109.5, 38.55], [-109.4, 38.6]],
    },
    bounds: { north: 38.6, south: 38.5, east: -109.4, west: -109.6 },
    distance_m: 20_000,
    duration_s: 2_000,
  },
  stops: [1, 2, 3].map(sequence => ({
    id: `stop-${sequence}`,
    sequence,
    title: `Story ${sequence}`,
    coordinates: { lat: 38.5 + sequence * 0.02, lng: -109.6 + sequence * 0.04 },
    transcript: `Story ${sequence}`,
    audio_asset_id: `audio-${sequence}`,
    audio_duration_s: 60,
    trigger: {
      enter_radius_m: 250,
      exit_radius_m: 375,
      lead_time_s: 4,
      route_progress_start_m: (sequence - 1) * 6_000,
      route_progress_end_m: sequence * 6_000,
    },
    citations: [],
  })),
  assets: [],
  offline_map: {
    region_id: 'moab',
    bounds: { north: 38.6, south: 38.5, east: -109.4, west: -109.6 },
    min_zoom: 8,
    max_zoom: 15,
    estimated_bytes: 1,
  },
  safety: { summary: '', emergency_note: '', disclaimers: [] },
  access: { surface: 'paved', vehicle: 'passenger', fees: '', accessibility_notes: '' },
  season: { recommended_months: [], closures_note: '' },
  review: { editorial_status: 'approved' },
};

const session: OriginalSessionV1 = {
  schema_version: 1,
  session_id: 'session-1',
  pack_id: 'moab',
  version: 1,
  manifest_id: manifest.manifest_id,
  owner_scope: 'guest',
  status: 'active',
  tracking_state: 'on_route',
  download_state: 'ready',
  permission_state: 'foreground',
  triggered_stop_ids: ['stop-1'],
  completed_stop_ids: ['stop-1'],
  skipped_stop_ids: [],
  missed_stop_ids: [],
  queued_stop_id: null,
  current_stop_id: null,
  current_audio_position_ms: 0,
  last_projected_route_progress_m: 8_000,
  last_route_distance_m: 0,
  user_paused: false,
  trigger_state: {
    route_initialized: true,
    candidate_stop_id: null,
    candidate_entered_at_ms: null,
    candidate_sample_count: 0,
    candidate_last_sample_at_ms: null,
  },
  started_at_ms: 1,
  updated_at_ms: 2,
  completed_at_ms: null,
};

const model = originalMainMapExperience(manifest, session, 'guest', false);
assert.equal(model.active, true);
assert.equal(model.routeProgress, 0.4);
assert.equal(model.cues[0]?.state, 'completed');
assert.equal(model.cues[1]?.state, 'next');
assert.equal(model.cues[2]?.state, 'upcoming');

assert.equal(originalMainMapExperience(manifest, session, 'account:7', false).active, false);
assert.equal(originalMainMapExperience(manifest, session, 'guest', true).active, false);
assert.equal(
  originalMainMapExperience(manifest, { ...session, status: 'stopped' }, 'guest', false).active,
  false,
);

assert.deepEqual(originalStartDestination('moab', 1), {
  pathname: '/(tabs)/map',
  params: { original: 'moab', version: '1' },
});
assert.equal(consumerOriginalPlayerShouldRedirect(undefined), true);
assert.equal(consumerOriginalPlayerShouldRedirect('0'), true);
assert.equal(consumerOriginalPlayerShouldRedirect('1'), false);

const detailScreenSource = readFileSync(
  fileURLToPath(new NodeURL('../../../app/originals/[id].tsx', import.meta.url)),
  'utf8',
);
const beginStartIndex = detailScreenSource.indexOf('const beginStart');
const beginSimulationIndex = detailScreenSource.indexOf('const beginSimulation');
assert.notEqual(beginStartIndex, -1, 'Original detail must define beginStart');
assert.notEqual(beginSimulationIndex, -1, 'Original detail must define beginSimulation');
assert.ok(beginSimulationIndex > beginStartIndex, 'beginSimulation must follow the consumer start block');
const consumerStartBlock = detailScreenSource.slice(
  beginStartIndex,
  beginSimulationIndex,
);
assert.match(consumerStartBlock, /originalStartDestination/);
assert.doesNotMatch(
  consumerStartBlock,
  /\/originals\/player/,
  'consumer Start must never open the standalone Originals map',
);

const standalonePlayerSource = readFileSync(
  fileURLToPath(new NodeURL('../../../app/originals/player.tsx', import.meta.url)),
  'utf8',
);
assert.match(standalonePlayerSource, /consumerOriginalPlayerShouldRedirect/);
assert.match(standalonePlayerSource, /Opening this Original on the Trailhead map/);
assert.match(standalonePlayerSource, /runtimeSession\.owner_scope === ownerScope/);
assert.match(
  standalonePlayerSource,
  /pathname: '\/originals\/\[id\]'/,
  'a cold legacy player link must return to the Original detail instead of opening a blank map',
);
assert.match(
  standalonePlayerSource,
  /: '\/originals' as any/,
  'a malformed legacy player link without an Original ID must return to the catalog instead of opening a blank map',
);

const mainMapPlayerSource = readFileSync(
  fileURLToPath(new NodeURL('../../../components/originals/OriginalsMapPlayerSheet.tsx', import.meta.url)),
  'utf8',
);
const originalArtworkSource = readFileSync(
  fileURLToPath(new NodeURL('../../../components/originals/OriginalArtwork.tsx', import.meta.url)),
  'utf8',
);
assert.match(originalArtworkSource, /onError=\{\(\) => setImageFailed\(true\)\}/, 'failed remote artwork must reveal a durable fallback');
assert.doesNotMatch(originalArtworkSource, /routeLine/, 'the rejected oval placeholder cannot return');
const endTourIndex = mainMapPlayerSource.indexOf('const endTour');
const collapsedPlayerIndex = mainMapPlayerSource.indexOf('if (!panelExpanded)');
assert.notEqual(endTourIndex, -1, 'main-map player must define a full End tour action');
assert.notEqual(collapsedPlayerIndex, -1, 'main-map player must define its collapsed state');
assert.ok(collapsedPlayerIndex > endTourIndex, 'collapsed player must follow End tour');
const completionCloseBlock = mainMapPlayerSource.slice(
  endTourIndex,
  collapsedPlayerIndex,
);
assert.match(
  completionCloseBlock,
  /runtime\.stopTour/,
  'End tour must remove the Original route and player from the main map',
);
assert.doesNotMatch(completionCloseBlock, /runtime\.pauseTour/, 'End tour must never minimize into a resumable pill');
assert.match(mainMapPlayerSource, /label=\{isCompleted \? 'Close recap' : 'End tour'\}/);
assert.match(
  mainMapPlayerSource,
  /const shouldResume = isPaused \|\| session\.status === 'ready'/,
  'ready sessions must present a Resume control',
);

const legacyEndPrompt = standalonePlayerSource.slice(
  standalonePlayerSource.indexOf("Alert.alert('End this tour?"),
  standalonePlayerSource.indexOf("style={[styles.secondaryButton", standalonePlayerSource.indexOf("Alert.alert('End this tour?")),
);
assert.match(legacyEndPrompt, /originalsRuntime\.stopTour/);
assert.doesNotMatch(legacyEndPrompt, /originalsRuntime\.pauseTour/);

console.log('Originals main-map experience tests passed.');
