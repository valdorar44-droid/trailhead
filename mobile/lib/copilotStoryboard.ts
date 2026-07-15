import type { ExplorerCheckpoint, MissionControlBrief, MissionControlRisk } from './api';
import { buildCinematicHighlights, isCinematicScenicPlace } from './cinematicHighlights';
import { distanceBetweenLngLatMeters, routeRatioForPoint } from './routeProjection';

export type MissionSceneType =
  | 'intro'
  | 'whole_route'
  | 'day_flyover'
  | 'drive_leg'
  | 'trail_flythrough'
  | 'monument_orbit'
  | 'camp_arrival'
  | 'fuel_stop'
  | 'risk_focus'
  | 'weather_focus'
  | 'offline_readiness'
  | 'mission_recap'
  | 'poi_flyover'
  | 'route_rejoin';

export type MissionSceneCameraMode = 'fit' | 'fly' | 'orbit' | 'follow';

export interface MissionSceneCamera {
  mode: MissionSceneCameraMode;
  zoom?: number;
  pitch?: number;
  bearing?: number;
  /** Orbit framing for poi_flyover/orbit beats (direction + sweep in degrees). */
  orbit?: { direction?: 'cw' | 'ccw'; sweepDeg?: number };
  /** Named framing preset — low_pass glides through the focus along `bearing`. */
  preset?: 'low_pass';
}

export interface MissionSceneLayers {
  terrain?: boolean;
  warning?: boolean;
}

export type MissionScenePacingKind =
  | 'scenic_orbit'
  | 'scenic_low_pass'
  | 'route_leg'
  | 'rejoin'
  | 'context';

export interface MissionScenePacing {
  kind: MissionScenePacingKind;
  minDurationMs?: number;
  maxDurationMs?: number;
  /** Cinematic cap for compressed route-leg ground speed. */
  groundSpeedMpsCap?: number;
}

export interface MissionSceneCallout {
  id: string;
  title: string;
  note?: string;
  lat: number;
  lng: number;
  kind: string;
  source?: string;
  source_label?: string;
}

export interface MissionScene {
  id: string;
  type: MissionSceneType;
  title: string;
  subtitle: string;
  day?: number;
  durationMs: number;
  /** Fractional [start, end] positions along the route (0..1). */
  routeSlice?: [number, number];
  focus?: { lat: number; lng: number };
  /** For poi_flyover/route_rejoin: route fraction where the tour resumes. */
  rejoinRatio?: number;
  camera: MissionSceneCamera;
  layers: MissionSceneLayers;
  pacing?: MissionScenePacing;
  narration: string;
  callouts: MissionSceneCallout[];
}

export interface MissionCinematic {
  id: string;
  tripId: string | null;
  title: string;
  route: [number, number][];
  scenes: MissionScene[];
  generatedAt: number;
  sources: string[];
}

export interface StoryboardPlace {
  id: string;
  type: string;
  title: string;
  note?: string;
  lat: number;
  lng: number;
  day?: number;
  source?: string;
  source_label?: string;
  confidence?: string;
  route_distance_mi?: number;
}

export interface BuildMissionCinematicInput {
  tripId: string | null;
  tripName: string;
  route: [number, number][];
  checkpoints: ExplorerCheckpoint[];
  places: StoryboardPlace[];
  missionBrief: MissionControlBrief | null;
}

const MAX_SCENES = 16;
const MAX_CAMP_SCENES = 3;
const MAX_FUEL_SCENES = 2;
const MAX_TRAIL_SCENES = 2;
const MAX_MONUMENT_SCENES = 2;
const MAX_SCENIC_SCENES = 5;
const MAX_RISK_SCENES = 3;
const MAX_DAY_SCENES = 5;

function finite(lat?: number, lng?: number) {
  return Number.isFinite(lat) && Number.isFinite(lng);
}

function confidenceRank(confidence?: string) {
  const clean = String(confidence || '').toLowerCase();
  if (clean === 'high') return 3;
  if (clean === 'medium') return 2;
  if (clean === 'low' || clean === 'estimated') return 1;
  return 0;
}

function severityRank(severity?: string) {
  const clean = String(severity || '').toLowerCase();
  if (clean === 'block') return 4;
  if (clean === 'warning') return 3;
  if (clean === 'watch') return 2;
  if (clean === 'info') return 1;
  return 0;
}

function routeMidpoint(route: [number, number][]): { lat: number; lng: number } | undefined {
  if (!route.length) return undefined;
  const mid = route[Math.floor(route.length / 2)];
  return { lat: mid[1], lng: mid[0] };
}

function clampRatio(value: number) {
  return Math.max(0, Math.min(1, value));
}

function placeMatches(type: string, needles: string[]) {
  const clean = String(type || '').toLowerCase();
  return needles.some(needle => clean.includes(needle));
}

function calloutFromPlace(place: StoryboardPlace, kind: string): MissionSceneCallout {
  return {
    id: place.id,
    title: place.title,
    note: place.note,
    lat: place.lat,
    lng: place.lng,
    kind,
    source: place.source,
    source_label: place.source_label,
  };
}

function firstSentence(text?: string) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const match = clean.match(/^[^.!?]{10,180}[.!?]/);
  return match ? match[0].trim() : clean.slice(0, 180);
}

type WeightedScene = { scene: MissionScene; priority: number };

function riskSceneType(risk: MissionControlRisk): MissionSceneType {
  const type = String(risk.type || '').toLowerCase();
  if (['weather', 'fire', 'smoke', 'air_quality'].includes(type)) return 'weather_focus';
  if (['offline', 'signal'].includes(type)) return 'offline_readiness';
  return 'risk_focus';
}

function recapNarration(brief: MissionControlBrief | null, tripName: string) {
  if (!brief) {
    return `${tripName} is ready to review. Check camps, fuel, and current conditions before departure.`;
  }
  const reviewCount = brief.risks?.length ?? 0;
  if (brief.readiness === 'ready') {
    return reviewCount > 0
      ? `The route is set. Keep an eye on ${reviewCount} watch ${reviewCount === 1 ? 'item' : 'items'} and confirm conditions before you go.`
      : 'The route is set. Confirm current conditions before you go.';
  }
  if (brief.readiness === 'blocked') {
    return 'This route needs changes before departure. Check the flagged items in the trip overview.';
  }
  return reviewCount > 0
    ? `The route is close, but ${reviewCount} ${reviewCount === 1 ? 'item needs' : 'items need'} review before departure.`
    : 'The route is close. Review the trip overview before departure.';
}

function recapSubtitle(brief: MissionControlBrief | null) {
  if (!brief) return 'Review before departure';
  if (brief.readiness === 'ready') return 'Looks ready; confirm conditions before departure';
  if (brief.readiness === 'blocked') return 'Needs changes before departure';
  return 'Review before departure';
}

export interface ForwardPassInput {
  route: [number, number][];
  /** Highlight beats in any order; legs/rejoins are woven around them. */
  beats: MissionScene[];
  startTitle?: string;
  endTitle?: string;
  checkpoints?: Array<{ lat: number; lng: number; day?: number }>;
}

/**
 * Weave highlight beats into ONE forward pass over the route: contiguous
 * follow legs between beats in route order, no full-route re-fly, no
 * category back-jumps — and after every poi_flyover a silent route_rejoin
 * that carries the camera back to the route. This keeps "no teleporting"
 * structural regardless of who authored the beats (deterministic builder or
 * the AI storyboard).
 */
export function assembleForwardPass(input: ForwardPassInput): MissionScene[] {
  const { route, startTitle = '', endTitle = '' } = input;
  const validCheckpoints = (input.checkpoints ?? []).filter(cp => finite(cp.lat, cp.lng));
  const out: MissionScene[] = [];
  const ratioOfScene = (s: MissionScene): number => {
    if (s.focus) return routeRatioForPoint(route, s.focus.lat, s.focus.lng);
    if (s.routeSlice) return (s.routeSlice[0] + s.routeSlice[1]) / 2;
    return 0.5;
  };
  const beatOrder = (t: MissionSceneType) =>
    t === 'camp_arrival' ? 0 : t === 'monument_orbit' || t === 'poi_flyover' ? 1 : 2; // prefer camp over duplicate monument at same spot
  const NON_BEATS: MissionSceneType[] = ['day_flyover', 'whole_route', 'drive_leg', 'intro', 'mission_recap', 'route_rejoin'];
  const beatsRaw = input.beats
    .filter(s => !NON_BEATS.includes(s.type)) // legs are regenerated contiguously
    .map(s => ({ ratio: clampRatio(ratioOfScene(s)), scene: s }))
    .sort((a, b) => (a.ratio - b.ratio) || (beatOrder(a.scene.type) - beatOrder(b.scene.type)));
  const samePlace = (a: MissionScene, b: MissionScene) => {
    if (a.id === b.id) return true;
    const aCalloutIds = new Set(a.callouts.map(callout => callout.id).filter(Boolean));
    if (b.callouts.some(callout => aCalloutIds.has(callout.id))) return true;
    if (!a.focus || !b.focus) return false;
    return distanceBetweenLngLatMeters(
      [a.focus.lng, a.focus.lat],
      [b.focus.lng, b.focus.lat],
    ) <= 100;
  };
  // Only collapse beats that resolve to the same physical place. Nearby route
  // fractions can still represent distinct camps, overlooks, or access points.
  const beats: typeof beatsRaw = [];
  for (const b of beatsRaw) {
    const duplicateIndex = beats.findIndex(existing => samePlace(existing.scene, b.scene));
    if (duplicateIndex < 0) {
      beats.push(b);
    } else if (beatOrder(b.scene.type) < beatOrder(beats[duplicateIndex].scene.type)) {
      beats[duplicateIndex] = b;
    }
  }
  beats.sort((a, b) => (a.ratio - b.ratio) || (beatOrder(a.scene.type) - beatOrder(b.scene.type)));

  const cpRatios = validCheckpoints.map(cp => ({ r: routeRatioForPoint(route, cp.lat, cp.lng), cp }));
  const dayForRange = (a: number, b: number): number | undefined => {
    const inSeg = cpRatios.filter(x => x.r >= a - 0.001 && x.r <= b + 0.001);
    const days = Array.from(new Set(inSeg.map(x => Number(x.cp.day || 0)).filter(d => d > 0)));
    return days.length === 1 ? days[0] : undefined;
  };
  const stopPhrase = (scene?: MissionScene): string => {
    if (!scene) return 'the next stop';
    if (scene.type === 'camp_arrival') return `tonight's camp at ${scene.title}`;
    if (scene.type === 'fuel_stop') return `fuel at ${scene.title}`;
    if (scene.type === 'monument_orbit' || scene.type === 'poi_flyover') return `the scenic stop at ${scene.title}`;
    if (scene.type === 'trail_flythrough') return `the trail stop at ${scene.title}`;
    if (scene.type === 'weather_focus' || scene.type === 'risk_focus' || scene.type === 'offline_readiness') return `the route check near ${scene.title}`;
    return scene.title || 'the next stop';
  };
  // Follow-leg titles/narration describe the next stop type; the camera still
  // owns the exact route line.
  const followLeg = (a: number, b: number, first: boolean, destScene?: MissionScene): MissionScene | null => {
    if (b - a < 0.05) return null;
    const day = dayForRange(a, b);
    const target = stopPhrase(destScene);
    return {
      id: `scene-leg-${a.toFixed(2)}-${b.toFixed(2)}`,
      type: 'day_flyover',
      title: first ? `Leaving ${startTitle || 'the start'}` : `Toward ${target}`,
      subtitle: first ? `Heading for ${target}` : target,
      day,
      durationMs: Math.round(9000 + (b - a) * 9000),
      routeSlice: [a, b],
      camera: { mode: 'follow', pitch: 64 },
      layers: {},
      pacing: { kind: 'route_leg', minDurationMs: 10000, maxDurationMs: 30000, groundSpeedMpsCap: 12000 },
      narration: first
        ? `Leaving ${startTitle || 'the start'}, the line heads toward ${target}.`
        : `Then we continue toward ${target}.`,
      callouts: [],
    };
  };

  let cursor = 0;
  let firstLeg = true;
  for (const b of beats) {
    const leg = followLeg(cursor, b.ratio, firstLeg, b.scene);
    if (leg) { out.push(leg); firstLeg = false; }
    out.push(b.scene);
    cursor = Math.max(cursor, b.ratio);
    // Off-route excursions glide back to the route through a silent rejoin
    // transition; the next leg starts exactly where the rejoin lands.
    if (b.scene.type === 'poi_flyover') {
      const rejoin = clampRatio(Math.max(cursor, b.scene.rejoinRatio ?? b.ratio));
      out.push({
        id: `scene-rejoin-${rejoin.toFixed(3)}`,
        type: 'route_rejoin',
        title: 'Back on route',
        subtitle: '',
        durationMs: 4500,
        rejoinRatio: rejoin,
        camera: { mode: 'fly' },
        layers: {},
        pacing: { kind: 'rejoin', minDurationMs: 3600, maxDurationMs: 6500 },
        narration: '',
        callouts: [],
      });
      cursor = rejoin;
    }
  }
  const tail = followLeg(cursor, 1, firstLeg, endTitle ? {
    id: 'scene-finish-target',
    type: 'day_flyover',
    title: endTitle,
    subtitle: '',
    durationMs: 0,
    camera: { mode: 'follow' },
    layers: {},
    narration: '',
    callouts: [],
  } : undefined);
  if (tail) out.push(tail);
  return out;
}

export function buildMissionCinematic(input: BuildMissionCinematicInput): MissionCinematic {
  const { tripId, tripName, route, checkpoints, places, missionBrief } = input;
  const cleanRoute = (route || []).filter(coord =>
    Array.isArray(coord) && Number.isFinite(coord[0]) && Number.isFinite(coord[1]),
  ) as [number, number][];
  const midpoint = routeMidpoint(cleanRoute);
  const sources = new Set<string>(['trailhead']);
  const scenes: MissionScene[] = [];

  const validCheckpoints = (checkpoints || []).filter(cp => finite(cp.lat, cp.lng));
  const validPlaces = (places || []).filter(p => finite(p.lat, p.lng));
  validPlaces.forEach(p => { if (p.source) sources.add(p.source); });
  if (missionBrief) sources.add('mission_control');
  const scenicPlaces = buildCinematicHighlights({
    route: cleanRoute,
    places: validPlaces,
    max: MAX_SCENIC_SCENES,
  });
  if (scenicPlaces.length) sources.add('cinematic_highlights');
  const scenicKeys = new Set(scenicPlaces.map(place => `${place.lat.toFixed(4)}:${place.lng.toFixed(4)}`));

  const startTitle = validCheckpoints[0]?.title || '';
  const endTitle = validCheckpoints.length > 1 ? validCheckpoints[validCheckpoints.length - 1]?.title || '' : '';
  const legLabel = startTitle && endTitle && startTitle !== endTitle ? `${startTitle} to ${endTitle}` : tripName;

  // --- Always: intro + whole_route ---
  scenes.push({
    id: 'scene-intro',
    type: 'intro',
    title: tripName,
    subtitle: startTitle ? `From ${startTitle}` : 'Trip overview',
    durationMs: 10000,
    routeSlice: [0, Math.min(0.1, 12 / Math.max(cleanRoute.length, 2))],
    camera: { mode: 'follow', zoom: 13.4, pitch: 66 },
    layers: { terrain: true },
    pacing: { kind: 'context', minDurationMs: 8000, maxDurationMs: 14000 },
    narration: '',
    callouts: [],
  });
  // No standalone whole-route re-fly — the intro establishes the whole route, then
  // we fly it once, forward, in contiguous legs (assembled below).

  const middle: WeightedScene[] = [];

  // --- day_flyover scenes ---
  const dayNumbers = Array.from(new Set(
    validCheckpoints.map(cp => Number(cp.day || 0)).filter(day => day > 0),
  )).sort((a, b) => a - b);
  const maxDay = dayNumbers.length ? dayNumbers[dayNumbers.length - 1] : 0;
  for (const day of dayNumbers.slice(0, MAX_DAY_SCENES)) {
    const dayCheckpoints = validCheckpoints.filter(cp => Number(cp.day || 0) === day);
    if (!dayCheckpoints.length) continue;
    const ratios = dayCheckpoints.map(cp => routeRatioForPoint(cleanRoute, cp.lat, cp.lng)).sort((a, b) => a - b);
    const start = clampRatio(day === dayNumbers[0] ? 0 : ratios[0] - 0.02);
    const end = clampRatio(day === maxDay ? 1 : ratios[ratios.length - 1] + 0.02);
    const dayFocus = dayCheckpoints[Math.floor(dayCheckpoints.length / 2)];
    const dayNote = firstSentence(dayCheckpoints.map(cp => cp.note).find(Boolean));
    middle.push({
      priority: 90 - day,
      scene: {
        id: `scene-day-${day}`,
        type: 'day_flyover',
        title: `Day ${day}`,
        subtitle: dayCheckpoints.map(cp => cp.title).slice(0, 3).join(' · '),
        day,
        durationMs: 14000,
        routeSlice: [start, Math.max(end, start + 0.02)],
        focus: { lat: dayFocus.lat, lng: dayFocus.lng },
        camera: { mode: 'follow', zoom: 12.4, pitch: 66 },
        layers: {},
        pacing: { kind: 'route_leg', minDurationMs: 12000, maxDurationMs: 28000, groundSpeedMpsCap: 12000 },
        narration: day === 1
          ? `Day 1 rolls out toward the first planned stop. ${dayNote || 'Confirm the next camp window before dark.'}`
          : `Day ${day}. ${dayNote || `This leg runs through ${dayCheckpoints[0].title}.`}`,
        callouts: dayCheckpoints.slice(0, 4).map(cp => ({
          id: cp.id, title: cp.title, note: cp.note, lat: cp.lat, lng: cp.lng, kind: 'checkpoint',
        })),
      },
    });
  }

  // --- camp_arrival scenes ---
  const campPlaces = validPlaces
    .filter(p => placeMatches(p.type, ['camp', 'stay', 'overnight', 'lodging', 'glamping', 'hut']))
    .sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence));
  const overnightCallouts = (missionBrief?.overnights ?? [])
    .filter(night => finite(night.lat, night.lng))
    .map(night => ({
      id: `overnight-${night.day}`,
      title: night.name,
      note: night.reason,
      lat: Number(night.lat),
      lng: Number(night.lng),
      kind: 'camp',
      day: night.day,
    }));
  const campSeen = new Set<string>();
  let campCount = 0;
  for (const camp of campPlaces) {
    if (campCount >= MAX_CAMP_SCENES) break;
    const key = `${camp.lat.toFixed(3)}:${camp.lng.toFixed(3)}`;
    if (campSeen.has(key)) continue;
    campSeen.add(key);
    campCount += 1;
    middle.push({
      priority: 70 + confidenceRank(camp.confidence),
      scene: {
        id: `scene-camp-${camp.id}`,
        type: 'camp_arrival',
        title: camp.title,
        subtitle: camp.day ? `Tonight's camp · Day ${camp.day}` : "Tonight's camp",
        day: camp.day,
        durationMs: 6200,
        focus: { lat: camp.lat, lng: camp.lng },
        camera: { mode: 'fly', zoom: 12.8, pitch: 60 },
        layers: { terrain: true },
        pacing: { kind: 'context', minDurationMs: 5200, maxDurationMs: 9000 },
        narration: `${camp.title} is the ${camp.day ? `day ${camp.day} ` : ''}overnight stop. ${firstSentence(camp.note) || 'Confirm the stay before departure.'}`,
        callouts: [calloutFromPlace(camp, 'camp')],
      },
    });
  }
  if (campCount === 0 && overnightCallouts.length) {
    for (const night of overnightCallouts.slice(0, MAX_CAMP_SCENES)) {
      middle.push({
        priority: 70,
        scene: {
          id: `scene-${night.id}`,
          type: 'camp_arrival',
          title: night.title,
          day: night.day,
          durationMs: 6200,
          focus: { lat: night.lat, lng: night.lng },
          camera: { mode: 'fly', zoom: 12.8, pitch: 60 },
          layers: { terrain: true },
          pacing: { kind: 'context', minDurationMs: 5200, maxDurationMs: 9000 },
          subtitle: `Tonight's camp · Day ${night.day}`,
          narration: `${night.title} covers night ${night.day}. ${firstSentence(night.note) || 'Confirm the stay before departure.'}`,
          callouts: [{ id: night.id, title: night.title, note: night.note, lat: night.lat, lng: night.lng, kind: 'camp' }],
        },
      });
    }
  }

  // --- fuel_stop scenes ---
  const fuelPlaces = validPlaces
    .filter(p => placeMatches(p.type, ['fuel', 'gas', 'diesel', 'propane']))
    .sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence));
  let fuelCount = 0;
  for (const fuel of fuelPlaces) {
    if (fuelCount >= MAX_FUEL_SCENES) break;
    fuelCount += 1;
    middle.push({
      priority: 66 + confidenceRank(fuel.confidence),
      scene: {
        id: `scene-fuel-${fuel.id}`,
        type: 'fuel_stop',
        title: fuel.title,
        subtitle: fuel.day ? `Fuel · Day ${fuel.day}` : 'Fuel checkpoint',
        day: fuel.day,
        durationMs: 4200,
        focus: { lat: fuel.lat, lng: fuel.lng },
        camera: { mode: 'fly', zoom: 11.5, pitch: 55 },
        layers: {},
        pacing: { kind: 'context', minDurationMs: 4200, maxDurationMs: 7200 },
        narration: `Fuel stop at ${fuel.title}. ${firstSentence(fuel.note) || 'Top off here before the next remote stretch.'}`,
        callouts: [calloutFromPlace(fuel, 'fuel')],
      },
    });
  }

  // --- cinematic scenic highlights ---
  for (const scenic of scenicPlaces) {
    const kind = String(scenic.type || '').toLowerCase();
    const ratio = routeRatioForPoint(cleanRoute, scenic.lat, scenic.lng);
    const isDriveBy = /\b(scenic_drive|trail)\b/.test(kind);
    const summary = firstSentence(scenic.note) || 'A real scenic highlight close to this route.';
    middle.push({
      priority: 96 + confidenceRank(scenic.confidence),
      scene: {
        id: `scene-scenic-${scenic.id}`,
        type: isDriveBy ? 'poi_flyover' : 'monument_orbit',
        title: scenic.title,
        subtitle: 'Scenic stop',
        day: scenic.day,
        durationMs: isDriveBy ? 8800 : 11000,
        routeSlice: [ratio, clampRatio(ratio + 0.015)],
        focus: { lat: scenic.lat, lng: scenic.lng },
        rejoinRatio: ratio,
        camera: isDriveBy
          ? { mode: 'fly', zoom: 13.5, pitch: 70, preset: 'low_pass' }
          : { mode: 'orbit', zoom: 12.8, pitch: 66, orbit: { direction: 'cw', sweepDeg: 360 } },
        layers: { terrain: true },
        pacing: isDriveBy
          ? { kind: 'scenic_low_pass', minDurationMs: 10500, maxDurationMs: 18000 }
          : { kind: 'scenic_orbit', minDurationMs: 14000, maxDurationMs: 24000 },
        narration: `${scenic.title}. ${summary} Then we continue onward.`,
        callouts: [calloutFromPlace(scenic, 'scenic')],
      },
    });
  }

  // --- trail_flythrough scenes ---
  const trailPlaces = validPlaces
    .filter(p => !scenicKeys.has(`${p.lat.toFixed(4)}:${p.lng.toFixed(4)}`))
    .filter(p => placeMatches(p.type, ['trail', 'trailhead', 'hike', 'trek', 'climb']))
    .sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence));
  let trailCount = 0;
  for (const trail of trailPlaces) {
    if (trailCount >= MAX_TRAIL_SCENES) break;
    trailCount += 1;
    middle.push({
      priority: 60 + confidenceRank(trail.confidence),
      scene: {
        id: `scene-trail-${trail.id}`,
        type: 'trail_flythrough',
        title: trail.title,
        subtitle: 'Trail time',
        day: trail.day,
        durationMs: 6200,
        focus: { lat: trail.lat, lng: trail.lng },
        camera: { mode: 'fly', zoom: 13.2, pitch: 66, preset: 'low_pass' },
        layers: { terrain: true },
        pacing: { kind: 'scenic_low_pass', minDurationMs: 9000, maxDurationMs: 15000 },
        narration: `${trail.title}. ${firstSentence(trail.note) || 'Check access and conditions before setting aside time for it.'} Then we continue onward.`,
        callouts: [calloutFromPlace(trail, 'trail')],
      },
    });
  }

  // --- monument_orbit scenes ---
  const monumentPlaces = validPlaces
    .filter(p => !scenicKeys.has(`${p.lat.toFixed(4)}:${p.lng.toFixed(4)}`))
    .filter(p => placeMatches(p.type, [
      'monument', 'historic', 'park', 'viewpoint', 'view', 'scenic', 'waterfall', 'glacier', 'tourism', 'landmark', 'water',
    ]) && isCinematicScenicPlace(p) && !placeMatches(p.type, ['weather', 'risk', 'trail', 'camp', 'stay', 'fuel']))
    .sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence));
  let monumentCount = 0;
  for (const monument of monumentPlaces) {
    if (monumentCount >= MAX_MONUMENT_SCENES) break;
    monumentCount += 1;
    middle.push({
      priority: 56 + confidenceRank(monument.confidence),
      scene: {
        id: `scene-monument-${monument.id}`,
        type: 'monument_orbit',
        title: monument.title,
        subtitle: 'Scenic stop',
        day: monument.day,
        durationMs: 9800,
        focus: { lat: monument.lat, lng: monument.lng },
        rejoinRatio: routeRatioForPoint(cleanRoute, monument.lat, monument.lng),
        camera: { mode: 'orbit', zoom: 12.6, pitch: 66, orbit: { direction: 'cw', sweepDeg: 360 } },
        layers: { terrain: true },
        pacing: { kind: 'scenic_orbit', minDurationMs: 14000, maxDurationMs: 24000 },
        narration: `${monument.title}. ${firstSentence(monument.note) || 'A real scenic stop close to the route.'} Then we continue onward.`,
        callouts: [calloutFromPlace(monument, 'monument')],
      },
    });
  }

  // --- risk / weather / offline scenes from route checks ---
  const risks = (missionBrief?.risks ?? [])
    .slice()
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  let riskCount = 0;
  const offlineSeen = { done: false };
  for (const risk of risks) {
    if (riskCount >= MAX_RISK_SCENES) break;
    const type = riskSceneType(risk);
    if (type === 'offline_readiness' && offlineSeen.done) continue;
    // Located risks become forward-ordered beats; coordinate-less risks stay as
    // Route-check warnings only (no redundant mid-route zoom-out cuts).
    const hasCoords = finite(risk.lat, risk.lng);
    if (!hasCoords && type !== 'offline_readiness') continue;
    if (type === 'offline_readiness') offlineSeen.done = true;
    const focus = hasCoords
      ? { lat: Number(risk.lat), lng: Number(risk.lng) }
      : midpoint;
    riskCount += 1;
    const severityHigh = severityRank(risk.severity) >= 3;
    middle.push({
      priority: 80 + severityRank(risk.severity),
      scene: {
        id: `scene-risk-${risk.id}`,
        type,
        title: risk.title,
        subtitle: type === 'weather_focus'
          ? 'Weather watch'
          : type === 'offline_readiness'
            ? 'Signal check'
            : 'Risk check',
        day: risk.day,
        durationMs: 5400,
        focus,
        routeSlice: type === 'offline_readiness' ? [0.25, 0.75] : undefined,
        camera: type === 'offline_readiness'
          ? { mode: 'fit', pitch: 45 }
          : { mode: 'fly', zoom: 10.5, pitch: 55 },
        layers: { warning: true },
        pacing: { kind: 'context', minDurationMs: 5000, maxDurationMs: 9000 },
        narration: type === 'weather_focus'
          ? `Weather watch: ${firstSentence(risk.summary) || risk.title}. Check timing before this segment.`
          : type === 'offline_readiness'
            ? `This is the remote stretch. ${firstSentence(risk.summary) || 'Keep the route saved and fuel topped off here.'}`
            : `${severityHigh ? 'This section deserves a closer look. ' : ''}${firstSentence(risk.summary) || risk.title}`,
        callouts: focus
          ? [{ id: risk.id, title: risk.title, note: firstSentence(risk.summary), lat: focus.lat, lng: focus.lng, kind: 'risk' }]
          : [],
      },
    });
  }

  // --- bound the middle scenes ---
  const middleBudget = Math.max(0, MAX_SCENES - 3);
  const chosen = middle
    .sort((a, b) => b.priority - a.priority)
    .slice(0, middleBudget)
    .map(entry => entry.scene);

  // --- Assemble as ONE forward pass ---------------------------------------
  scenes.push(...assembleForwardPass({
    route: cleanRoute,
    beats: chosen,
    startTitle,
    endTitle,
    checkpoints: validCheckpoints,
  }));

  // --- Always: mission_recap ---
  scenes.push({
    id: 'scene-recap',
    type: 'mission_recap',
    title: 'Trip recap',
    subtitle: recapSubtitle(missionBrief),
    durationMs: 6000,
    routeSlice: [0, 1],
    camera: { mode: 'fit', pitch: 45 },
    layers: { warning: missionBrief?.readiness === 'blocked' },
    pacing: { kind: 'context', minDurationMs: 6000, maxDurationMs: 11000 },
    narration: recapNarration(missionBrief, tripName),
    callouts: [],
  });

  return {
    id: `cinematic-${tripId || 'preview'}-${Date.now()}`,
    tripId,
    title: tripName,
    route: cleanRoute,
    scenes,
    generatedAt: Math.floor(Date.now() / 1000),
    sources: Array.from(sources),
  };
}
