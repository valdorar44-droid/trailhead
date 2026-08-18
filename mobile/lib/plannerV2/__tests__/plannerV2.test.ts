import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  mergePlannerEvents,
  plannerCampCardSummary,
  plannerDraftSummary,
  plannerMapPins,
  plannerPresentationNotices,
  plannerReadinessCopy,
  plannerConversationStorageKey,
  plannerRunStorageKey,
  plannerSourceSummaryCopy,
  plannerStartRequestStorageKey,
  plannerTaskProgress,
} from '../model';
import type { PlannerV2Event, PlannerV2Task, TripResult } from '../../api';

test('event cursor ordering deduplicates reconnects and suppresses stale replacements', () => {
  const current: PlannerV2Event[] = [
    { seq: 1, event_type: 'task', task_id: 'route', state: 'running', payload: { message: 'Building route' }, created_at: 10 },
    { seq: 2, event_type: 'task', task_id: 'route', state: 'completed', payload: { message: 'Route ready' }, created_at: 20 },
  ];
  const merged = mergePlannerEvents(current, [
    { seq: 2, event_type: 'task', task_id: 'route', state: 'running', payload: { message: 'Stale' }, created_at: 15 },
    { seq: 3, event_type: 'task', task_id: 'research', state: 'running', payload: { message: 'Checking sources' }, created_at: 30 },
  ]);
  assert.deepEqual(merged.map(event => event.seq), [1, 2, 3]);
  assert.equal(merged[1].state, 'completed');
  assert.equal(merged[2].payload.message, 'Checking sources');
});

test('checklist progress counts only terminal truthful states', () => {
  const tasks: PlannerV2Task[] = [
    { id: 'one', title: 'One', state: 'completed', message: 'Done' },
    { id: 'two', title: 'Two', state: 'warning', message: 'Limited evidence' },
    { id: 'three', title: 'Three', state: 'running', message: 'Working' },
    { id: 'four', title: 'Four', state: 'queued', message: 'Waiting' },
  ];
  assert.deepEqual(plannerTaskProgress(tasks), { completed: 2, total: 4, ratio: 0.5 });
});

test('map preview derives camps fuel trails and actual route summary from the draft', () => {
  const trip = {
    trip_id: 'trip',
    plan: {
      trip_name: 'Moab to Flagstaff', overview: 'Desert route', duration_days: 3,
      states: ['UT', 'AZ'], total_est_miles: 330, daily_itinerary: [],
      logistics: {
        vehicle_recommendation: 'Any road-ready vehicle', fuel_strategy: 'Top up in Moab',
        water_strategy: 'Carry water', permits_needed: 'Check current rules', best_season: 'Spring or fall',
      },
      waypoints: [
        { name: 'Moab', type: 'start', day: 1, lat: 38.57, lng: -109.55, description: 'Start', land_type: 'city' },
        { name: 'Canyon Camp', type: 'camp', day: 1, lat: 37.20, lng: -110.20, description: 'Camp', land_type: 'public' },
        { name: 'Flagstaff', type: 'destination', day: 3, lat: 35.20, lng: -111.65, description: 'Finish', land_type: 'city' },
      ],
    },
    campsites: [],
    gas_stations: [{ id: 'fuel', name: 'Fuel', lat: 36.8, lng: -111.2, fuel_types: 'regular', address: '' }],
    route_pois: [{ id: 'trail', name: 'Route Trail', lat: 37.0, lng: -110.4, type: 'trail' }],
    route_conditions: [{
      id: 'warning', title: 'High Wind Warning', description: 'Wind', severity: 'high',
      lat: 36.5, lng: -111.0, source_label: 'National Weather Service', source_url: 'https://www.weather.gov/',
    }],
    weather_checks: [{
      id: 'weather', title: 'Weather check: Moab', description: 'Forecast available',
      lat: 38.57, lng: -109.55, source_label: 'Open-Meteo forecast', source_url: 'https://open-meteo.com/',
    }],
  } as unknown as TripResult;
  const pins = plannerMapPins(trip);
  assert.deepEqual(new Set(pins.map(pin => pin.kind)), new Set(['place', 'camp', 'fuel', 'trail', 'warning', 'weather']));
  assert.deepEqual(plannerDraftSummary(trip), { days: 3, miles: 330, stops: 3, camps: 0, fuel: 1 });
});

test('planner campground cards stay concise and hand full details to the map', () => {
  assert.equal(
    plannerCampCardSummary({ reservable: true }),
    'Reservations may be available. Open it on the map for access, amenities, current conditions, and complete campground details.',
  );
  assert.equal(
    plannerCampCardSummary({ reservable: false }),
    'Open it on the map for access, amenities, current conditions, and complete campground details.',
  );
  const here = dirname(fileURLToPath(import.meta.url));
  const screen = readFileSync(resolve(here, '../../../components/plannerV2/PlannerV2Screen.tsx'), 'utf8');
  assert.match(screen, /const reviewCamps = allCamps\.slice\(0, 6\)/);
  assert.match(screen, /testID="planner\.v2\.open-all-camps-on-map"/);
  assert.match(screen, /The complete campground inventory and full details stay on the map\./);
  assert.match(screen, /highlighted \$\{camps\.length === 1 \? 'camp' : 'camps'\}/);
  assert.doesNotMatch(screen, /\$\{summary\.camps\} camp options/);
  assert.doesNotMatch(screen, /body=\{camp\.description/);
});

test('ordinary research gaps read as planning notes while safety cautions stay visible', () => {
  assert.deepEqual(plannerPresentationNotices([
    'No sourced fuel options were returned.',
    'No sourced activity or trail options were returned.',
    'Live route conditions were unavailable.',
    'The domestic road route passed its border controls, but one secondary country check was unavailable.',
    'High wind closure reported on the planned road.',
  ]), {
    notes: [
      'Fuel stops are not pinned in this draft yet. Add preferred stations on the map or ask Trailhead to refine the route.',
      'No optional activities were added, so this draft stays focused on the route and camps. Ask Trailhead if you want more ideas.',
      'Live road updates were not attached to this draft. Refresh them on the map closer to departure.',
    ],
    cautions: [
      'The route stayed inside the confirmed country. One backup country lookup did not respond, so review the route map before departure.',
      'High wind closure reported on the planned road.',
    ],
  });
});

test('readiness copy avoids zero-count error language without inventing evidence', () => {
  const empty = plannerReadinessCopy({
    gas_stations: [], weather_checks: [], route_conditions: [],
  } as unknown as TripResult);
  assert.equal(empty.fuel, 'Fuel stops are not pinned yet. Open the map to add the stations you prefer before departure.');
  assert.equal(empty.conditions, 'No live alerts are attached to this draft. Refresh weather and road updates on the map closer to departure.');
  assert.equal(plannerSourceSummaryCopy(5, 0), '5 linked sources · Open any finding to review it');
  assert.equal(plannerSourceSummaryCopy(6, 2), '6 linked sources · 2 government or agency sources · Open any finding to review it');
  assert.equal(plannerSourceSummaryCopy(2, 5), '2 linked sources · 2 government or agency sources · Open any finding to review it');
  const alert = plannerReadinessCopy({
    gas_stations: [],
    weather_checks: [{ id: 'weather' }],
    route_conditions: [{ title: 'High Wind Warning', severity: 'high' }],
  } as unknown as TripResult);
  assert.equal(alert.conditions, '1 forecast area is linked. 1 road alert needs review: High Wind Warning. Refresh them before departure.');
  const here = dirname(fileURLToPath(import.meta.url));
  const screen = readFileSync(resolve(here, '../../../components/plannerV2/PlannerV2Screen.tsx'), 'utf8');
  assert.doesNotMatch(screen, /0 sourced fuel options are included/);
  assert.doesNotMatch(screen, /What still needs your attention/);
  assert.match(screen, />Planning notes</);
  assert.match(screen, />Before you go</);
  assert.match(screen, /body=\{`\$\{trip\.plan\.logistics\?\.fuel_strategy[^`]*\$\{readiness\.fuel\}/);
});

test('bounded preview keeps both endpoints and every safety research category', () => {
  const waypoints = Array.from({ length: 20 }, (_, index) => ({
    name: index === 0 ? 'Moab' : index === 19 ? 'Flagstaff' : `Draft stop ${index}`,
    type: index === 0 ? 'start' : index === 19 ? 'destination' : 'place',
    day: Math.min(3, index + 1),
    lat: 38.5 - index * 0.08,
    lng: -109.5 - index * 0.08,
    description: '',
    land_type: 'place',
  }));
  const trip = {
    trip_id: 'balanced-pins',
    plan: {
      trip_name: 'Moab to Flagstaff', overview: '', duration_days: 3,
      states: ['UT', 'AZ'], total_est_miles: 330, daily_itinerary: [],
      logistics: {
        vehicle_recommendation: 'Road-ready vehicle', fuel_strategy: 'Top up before remote stretches',
        water_strategy: 'Carry water', permits_needed: 'Check current rules', best_season: 'Spring or fall',
      },
      waypoints,
    },
    campsites: [{ id: 'camp', name: 'Camp', lat: 36.7, lng: -111.3 }],
    gas_stations: [{ id: 'fuel', name: 'Fuel', lat: 36.6, lng: -111.4 }],
    route_pois: [{ id: 'trail', name: 'Trail', type: 'trail', lat: 36.5, lng: -111.5 }],
    route_conditions: [{
      id: 'warning', title: 'Warning', description: '', severity: 'high',
      lat: 36.4, lng: -111.6, source_label: 'Official', source_url: 'https://example.gov/',
    }],
    weather_checks: [{
      id: 'weather', title: 'Weather', description: '',
      lat: 36.3, lng: -111.7, source_label: 'Forecast', source_url: 'https://example.gov/',
    }],
  } as unknown as TripResult;
  const pins = plannerMapPins(trip);
  assert.ok(pins.length <= 16);
  assert.deepEqual(new Set(pins.filter(pin => pin.active).map(pin => pin.title)), new Set(['Moab', 'Flagstaff']));
  assert.deepEqual(
    new Set(pins.map(pin => pin.kind)),
    new Set(['place', 'camp', 'fuel', 'trail', 'warning', 'weather']),
  );
});

test('resume storage is account-scoped', () => {
  assert.equal(plannerRunStorageKey(12), 'planner_research_run.12');
  assert.notEqual(plannerRunStorageKey(12), plannerRunStorageKey(13));
  assert.equal(plannerConversationStorageKey(12), 'planner_research_conversation.12');
  assert.notEqual(plannerConversationStorageKey(12), plannerConversationStorageKey(13));
  assert.equal(plannerStartRequestStorageKey(12), 'planner_research_start_request.12');
  assert.notEqual(plannerStartRequestStorageKey(12), plannerStartRequestStorageKey(13));
  for (const key of [
    plannerRunStorageKey(12),
    plannerConversationStorageKey(12),
    plannerStartRequestStorageKey(12),
  ]) {
    assert.match(key, /^[\w.-]+$/);
    assert.doesNotMatch(key, /:/);
  }
});

test('welcome starts as a compact conversation and expands after the first message', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const screen = readFileSync(resolve(here, '../../../components/plannerV2/PlannerV2Screen.tsx'), 'utf8');
  assert.match(screen, /const isWelcome = messages\.length === 0/);
  assert.match(screen, /What kind of trip are you imagining\?/);
  assert.match(screen, /Help me create a camping trip/);
  assert.match(screen, /Where are some of the best campgrounds around Moab\?/);
  assert.match(screen, /Find campsites around Moab that will fit my RV/);
  assert.match(screen, /submitBehavior="submit"/);
  assert.match(screen, /!isWelcome \? \(/);
  assert.doesNotMatch(screen, /Build a desert road trip|Moab to Flagstaff · 3 days|TRY A CONVERSATION/);
});

test('live research stays attached to the conversation with an expandable checklist', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const screen = readFileSync(resolve(here, '../../../components/plannerV2/PlannerV2Screen.tsx'), 'utf8');
  const applySnapshotStart = screen.indexOf('const applySnapshot');
  const applySnapshotEnd = screen.indexOf('useEffect(() =>', applySnapshotStart);
  assert.ok(applySnapshotStart >= 0 && applySnapshotEnd > applySnapshotStart);
  assert.doesNotMatch(screen.slice(applySnapshotStart, applySnapshotEnd), /setView\('research'\)/);
  assert.match(screen, /testID="planner\.v2\.open-research-checklist"/);
  assert.match(screen, /Researching your trip/);
  assert.match(screen, /View research checklist/);
  assert.match(screen, /Back to the conversation/);
  assert.match(screen, /researchActive && snapshot \? \(/);
  assert.match(screen, /onOpenResearch=\{\(\) => setView\('research'\)\}/);
  assert.match(screen, /const isWelcome = messages\.length === 0 && !researchActive/);
  assert.match(screen, /accessibilityLabel=\{`Researching your trip\. \$\{newestPlannerMessage\(snapshot\)\}\. \$\{progress\.completed\} of \$\{progress\.total\} checks finished\. View research checklist\.`\}/);
  assert.match(screen, /!isWelcome \? \([\s\S]*composer\(\)/);
  const researchViewStart = screen.indexOf('function ResearchView');
  const revealViewStart = screen.indexOf('function RevealView', researchViewStart);
  assert.ok(researchViewStart >= 0 && revealViewStart > researchViewStart);
  assert.doesNotMatch(screen.slice(researchViewStart, revealViewStart), /ref=\{scrollRef\}/);
});

test('conversation composer clears the tab bar and closes the gap while typing', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const screen = readFileSync(resolve(here, '../../../components/plannerV2/PlannerV2Screen.tsx'), 'utf8');
  assert.match(screen, /const TAB_BAR_COMPOSER_CLEARANCE = 94/);
  assert.match(screen, /const composerBottomPadding = keyboardOpen[\s\S]*TAB_BAR_COMPOSER_CLEARANCE \+ insets\.bottom/);
  assert.match(screen, /Keyboard\.addListener\(showEvent, \(\) => setKeyboardOpen\(true\)\)/);
  assert.match(screen, /Keyboard\.addListener\(hideEvent, \(\) => setKeyboardOpen\(false\)\)/);
  assert.match(screen, /composerBottomPadding=\{composerBottomPadding\}/);
  assert.match(screen, /paddingBottom: composerBottomPadding/);
  assert.doesNotMatch(screen, /paddingBottom: Math\.max\(bottomInset, 10\)/);
});

test('start retry preserves one account-scoped request and cancel copy is truthful', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const screen = readFileSync(resolve(here, '../../../components/plannerV2/PlannerV2Screen.tsx'), 'utf8');
  const apiSource = readFileSync(resolve(here, '../../api.ts'), 'utf8');
  assert.match(screen, /accountStorage\.get\(startRequestKey\)/);
  assert.match(screen, /accountStorage\.set\(startRequestKey, clientRequestId\)/);
  assert.match(screen, /accountStorage\.set\(runKey, next\.run_id\)/);
  assert.match(screen, /accountStorage\.del\(startRequestKey\)/);
  assert.match(apiSource, /client_request_id: clientRequestId/);
  assert.match(screen, /Stop this research/);
  assert.doesNotMatch(screen, /Pause this research/);
});

test('review is separate from the only explicit save action', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const screen = readFileSync(resolve(here, '../../../components/plannerV2/PlannerV2Screen.tsx'), 'utf8');
  assert.match(screen, /testID="planner\.v2\.review-full-trip"/);
  assert.match(screen, /setView\('review'\)/);
  assert.match(screen, /testID="planner\.v2\.save-to-trips"/);
  assert.match(screen, /api\.plannerV2Commit\(snapshot\.run_id, snapshot\.revision\)/);
  assert.match(screen, /This is the only action that saves the draft to your Trips\./);
  assert.match(screen, /\['ready_for_review', 'committing'\]\.includes\(snapshot\.status\)/);
  assert.match(screen, /Finish saving to Trips/);
  assert.doesNotMatch(screen, /CHAT_STAGES|PLAN_STAGES_LONG/);
});

test('every server mutation ignores a response after the signed-in account changes', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const screen = readFileSync(resolve(here, '../../../components/plannerV2/PlannerV2Screen.tsx'), 'utf8');
  assert.equal((screen.match(/const requestEpoch = accountStorage\.epoch\(\);/g) ?? []).length, 5);
  assert.equal((screen.match(/const stillCurrent = \(\) => accountStorage\.epoch\(\) === requestEpoch/g) ?? []).length, 5);
  assert.match(screen, /if \(stillCurrent\(\)\) setError\(plannerErrorMessage\(startError\)\)/);
  assert.match(screen, /if \(stillCurrent\(\)\) applySnapshot\(next\)/);
  assert.match(screen, /if \(!stillCurrent\(\)\) return;[\s\S]*setActiveTrip\(trip/);
});

test('meaningful detours require a visible revision-bound decision', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const screen = readFileSync(resolve(here, '../../../components/plannerV2/PlannerV2Screen.tsx'), 'utf8');
  const apiSource = readFileSync(resolve(here, '../../api.ts'), 'utf8');
  assert.match(screen, /OPTIONAL DETOURS/);
  assert.match(screen, /Keep current route/);
  assert.match(screen, /Add and recheck/);
  assert.match(screen, /Decide on detours to continue/);
  assert.match(screen, /disabled=\{busy \|\| pendingDetours > 0\}/);
  assert.match(screen, /snapshot\.revision/);
  assert.match(apiSource, /expected_revision: expectedRevision/);
});

test('preview flag leaves production on the established planner', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const plan = readFileSync(resolve(here, '../../../app/(tabs)/plan.tsx'), 'utf8');
  const eas = JSON.parse(readFileSync(resolve(here, '../../../eas.json'), 'utf8'));
  assert.match(plan, /PLANNER_RESEARCH_PREVIEW_ENABLED \? <PlannerV2Screen \/> : <PlanScreenContent \/>/);
  assert.equal(eas.build.preview.env.EXPO_PUBLIC_PLANNER_V2_ENABLED, 'true');
  assert.equal(eas.build.production.env.EXPO_PUBLIC_PLANNER_V2_ENABLED, 'false');
});

test('customer copy names Trailhead Guide without implementation jargon', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const screen = readFileSync(resolve(here, '../../../components/plannerV2/PlannerV2Screen.tsx'), 'utf8');
  assert.match(screen, /PLAN WITH TRAILHEAD/);
  assert.match(screen, /TRAILHEAD GUIDE/);
  assert.match(screen, /Describe your trip…/);
  assert.doesNotMatch(screen, /Plan with Trailhead AI|TRAILHEAD AGENT|Mapbox preview|Planner V2/);
});
