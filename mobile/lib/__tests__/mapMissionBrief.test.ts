import {
  buildMapMissionCinematic,
  buildScoutLiveCinematic,
  getCurrentMissionRoute,
  liveMissionBeatBrief,
  missionBeatCaption,
  sceneNarrationWatchdogMs,
  shouldSpeakLiveScoutScene,
  shouldSpeakMissionScene,
  shouldSpeakScene,
  showFlyPlanAction,
} from '@/lib/mapMissionBrief';
import type { MissionScene } from '@/lib/copilotStoryboard';
import type { TripResult } from '@/lib/api';
import { isCinematicScenicPlace, rankCinematicPlaces } from '@/lib/cinematicHighlights';
import { scenePacingDurationMs } from '@/lib/missionBriefNativePlayer';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`mapMissionBrief contract failed: ${message}`);
}

const moabBigSurRoute: [number, number][] = [
  [-109.5498, 38.5733],
  [-115.0, 37.5],
  [-121.8081, 36.2704],
];

const activeTrip = {
  trip_id: 'trip-moab-big-sur',
  plan: {
    trip_name: 'Moab to Big Sur',
    overview: '',
    duration_days: 3,
    states: ['UT', 'CA'],
    total_est_miles: 900,
    waypoints: [
      { day: 1, name: 'Moab', type: 'start', description: 'Depart Moab', land_type: 'town', lat: 38.5733, lng: -109.5498 },
      { day: 2, name: 'Desert camp', type: 'camp', description: 'Overnight window', land_type: 'blm', lat: 37.2, lng: -113.5 },
      { day: 3, name: 'Big Sur', type: 'finish', description: 'Coast arrival', land_type: 'town', lat: 36.2704, lng: -121.8081 },
    ],
    daily_itinerary: [],
    logistics: { vehicle_recommendation: '', fuel_strategy: '', water_strategy: '', permits_needed: '', best_season: '' },
  },
  campsites: [{ id: 'camp-1', name: 'Desert camp', lat: 37.2, lng: -113.5 }],
  gas_stations: [{ id: 'fuel-1', name: 'Chevron Vernal', lat: 40.45, lng: -109.53 }],
  route_pois: [
    { id: 'poi-1', name: 'Scenic overlook', lat: 37.8, lng: -114.2, type: 'viewpoint', description: 'Wide canyon views near the route.' },
    { id: 'poi-2', name: 'Fuel only', lat: 37.9, lng: -114.4, type: 'fuel' },
  ],
  route_geometry: { coords: moabBigSurRoute },
} as unknown as TripResult;

const cinematic = buildMapMissionCinematic({
  tripId: activeTrip.trip_id,
  tripName: activeTrip.plan.trip_name,
  route: moabBigSurRoute,
  activeTrip,
  missionBrief: {
    ok: true,
    generated_at: Date.now(),
    readiness: 'needs_review',
    headline: 'Route close',
    summary: 'Fuel and offline maps need review.',
    scores: [],
    overnights: [{ day: 2, name: 'Desert camp', lat: 37.2, lng: -113.5, status: 'confirmed', source: 'trip', confidence: 'high', reason: 'Locked camp' }],
    risks: [{ id: 'risk-1', type: 'fuel_gap', title: 'Fuel gap', summary: 'Long stretch without fuel', severity: 'warning', confidence: 'medium', source_ids: [] }],
    recommendations: [],
    map_filters: [],
    source_summary: [],
  },
});

assert(!!cinematic && cinematic.scenes.length >= 4, 'Moab → Big Sur cinematic has multiple scenes');
assert(cinematic!.scenes[0]?.type === 'intro', 'scene order starts with intro');
assert(cinematic!.scenes.some(scene => scene.type === 'drive_leg' || scene.type === 'day_flyover'), 'includes route leg scenes');
assert(cinematic!.scenes.some(scene => scene.type === 'mission_recap'), 'includes mission_recap');
assert(
  cinematic!.scenes.every(scene => !String(scene.narration || '').toLowerCase().includes('command center')),
  'narration avoids generic command center wording',
);
assert(
  cinematic!.scenes.some(scene => scene.title.includes('Moab') || String(scene.subtitle || '').includes('Moab')),
  'scenes reference actual route names',
);
const scenicScene = cinematic!.scenes.find(scene => scene.type === 'monument_orbit' && scene.title.includes('Scenic overlook'));
assert(!!scenicScene, 'deterministic cinematic includes real scenic route POIs');
assert(scenicScene!.camera.orbit?.sweepDeg === 360, 'scenic route POIs get a 360 orbit');
assert(!cinematic!.scenes.some(scene => scene.title === 'Fuel only' && scene.type === 'monument_orbit'), 'fuel-only stops are not scenic cinematic beats');

const rankedHighlights = rankCinematicPlaces({
  route: moabBigSurRoute,
  places: [
    { id: 'boring-fuel', type: 'fuel', title: 'Gas stop', note: 'Fuel only, not a scenic stop.', lat: 37.1, lng: -113.4, source: 'osm', confidence: 'medium' },
    { id: 'boring-road', type: 'road', title: 'County Road 12', note: 'Generic county road label.', lat: 37.3, lng: -113.7, source: 'osm', confidence: 'medium' },
    { id: 'boring-camp', type: 'camp', title: 'Canyon Camp', note: 'Camp logistics only.', lat: 37.4, lng: -113.8, source: 'trip_camp', confidence: 'high' },
    { id: 'random-desert', type: 'locality', title: 'Dry Desert', note: 'Generic desert label near the route.', lat: 37.5, lng: -113.9, source: 'osm', confidence: 'medium' },
    { id: 'summary-missing', type: 'viewpoint', title: 'Source Only View', lat: 37.6, lng: -114.0, source: 'nps', confidence: 'high' },
    { id: 'real-view', type: 'viewpoint', title: 'Canyon Overlook', note: 'Wide view over the canyon.', lat: 37.8, lng: -114.2, source: 'nps', confidence: 'high' },
  ],
});
assert(rankedHighlights.length === 1 && rankedHighlights[0].title === 'Canyon Overlook', 'cinematic highlight scorer keeps scenic places and rejects fuel/roads');
assert(isCinematicScenicPlace({ type: 'waterfall', title: 'Falls viewpoint', note: 'Waterfall overlook with a clear source.', source: 'nps' }), 'source-backed waterfall viewpoints are scenic');
assert(!isCinematicScenicPlace({ type: 'viewpoint', title: 'Unnamed View', note: 'Short', source: 'osm' }), 'scenic places require a real summary');

const routePick = getCurrentMissionRoute({
  lastRouteCoords: moabBigSurRoute,
  activeTrip,
  routeScout: null,
});
assert(routePick?.source === 'visible_route', 'prefers visible route when it matches trip');

const majorScene: MissionScene = { id: 's1', type: 'day_flyover', title: 'Day 1', subtitle: '', durationMs: 10000, camera: { mode: 'follow' }, layers: {}, narration: '', callouts: [] };
const campScene: MissionScene = { id: 's2', type: 'camp_arrival', title: 'Camp', subtitle: '', durationMs: 8000, camera: { mode: 'orbit' }, layers: {}, narration: '', callouts: [] };
assert(shouldSpeakScene(majorScene), 'shouldSpeakScene includes day_flyover');
assert(shouldSpeakScene(campScene), 'shouldSpeakScene includes camp_arrival');
const orbitDuration = scenePacingDurationMs({ ...campScene, pacing: { kind: 'scenic_orbit' } }, 1);
const routeDuration = scenePacingDurationMs({ ...majorScene, pacing: { kind: 'route_leg', groundSpeedMpsCap: 1000 } }, 1, 60_000);
assert(orbitDuration >= 14000, '360 orbit pacing has a slow cinematic floor');
assert(routeDuration >= 60000, 'route leg pacing respects ground-speed caps');

const scoutLive = buildScoutLiveCinematic({
  tripName: 'Moab to Flagstaff',
  route: moabBigSurRoute,
  routeScout: {
    status: 'ready',
    message: 'ready',
    startName: 'Moab',
    destinationName: 'Flagstaff',
    dayPlans: [
      { day: 1, startName: 'Moab', endName: 'Desert camp', campName: 'Desert camp', campStatus: 'locked', driveSummary: '~180 mi', campMeta: 'BLM · dispersed' },
      { day: 2, startName: 'Desert camp', endName: 'Flagstaff', campName: 'Pines camp', campStatus: 'locked', driveSummary: '~200 mi', campMeta: 'NF campground' },
    ],
    stops: [
      { day: 1, type: 'camp', name: 'Desert camp', lat: 37.2, lng: -113.5 },
      { day: 1, type: 'viewpoint', name: 'Canyon overlook', description: 'Wide canyon view.', lat: 37.8, lng: -114.2 },
      { day: 2, type: 'camp', name: 'Pines camp', lat: 35.2, lng: -111.6 },
    ],
  },
});
assert(!!scoutLive && scoutLive.scenes.length >= 4, 'scout live cinematic has leg and camp beats');
assert(scoutLive!.scenes.some(scene => scene.type === 'drive_leg'), 'scout live includes drive legs');
assert(scoutLive!.scenes.some(scene => scene.type === 'camp_arrival'), 'scout live includes camp arrivals');
assert(scoutLive!.scenes.some(scene => scene.type === 'monument_orbit' && scene.camera.orbit?.sweepDeg === 360), 'scout live scenic stops get 360 orbits');
const introBeat = liveMissionBeatBrief(scoutLive!.scenes.find(scene => scene.type === 'intro')!, {
  startName: 'Moab',
  destinationName: 'Flagstaff',
} as any);
assert(introBeat.includes('Moab') && introBeat.includes('Flagstaff'), 'live intro beat names the route');
assert(
  shouldSpeakLiveScoutScene(scoutLive!.scenes.find(scene => scene.type === 'drive_leg')!),
  'live scout drive legs are speaking scenes',
);
assert(
  shouldSpeakLiveScoutScene(scoutLive!.scenes.find(scene => scene.type === 'camp_arrival')!),
  'live scout camp arrivals are speaking scenes',
);
assert(
  missionBeatCaption(scoutLive, scoutLive!.scenes.find(scene => scene.type === 'camp_arrival')!, {
    startName: 'Moab',
    destinationName: 'Flagstaff',
    dayPlans: [{ day: 1, campName: 'Desert camp', campMeta: 'BLM · dispersed' }],
  } as any).includes('Desert camp'),
  'mission beat caption uses live scout facts',
);
assert(sceneNarrationWatchdogMs({ durationMs: 10000 } as MissionScene) >= 13000, 'narration watchdog exceeds scene duration');

assert(!showFlyPlanAction({ lastRouteCoords: [], activeTrip: null, routeScout: null }), 'Fly the Plan hidden without route');
assert(showFlyPlanAction({ lastRouteCoords: moabBigSurRoute, activeTrip, routeScout: null }), 'Fly the Plan visible with trip route');

export const mapMissionBriefContract = { cinematic, routePick };
