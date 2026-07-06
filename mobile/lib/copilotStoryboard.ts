import type { ExplorerCheckpoint, MissionControlBrief, MissionControlRisk } from './api';

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
  | 'mission_recap';

export type MissionSceneCameraMode = 'fit' | 'fly' | 'orbit' | 'follow';

export interface MissionSceneCamera {
  mode: MissionSceneCameraMode;
  zoom?: number;
  pitch?: number;
  bearing?: number;
}

export interface MissionSceneLayers {
  terrain?: boolean;
  warning?: boolean;
}

export interface MissionSceneCallout {
  id: string;
  title: string;
  note?: string;
  lat: number;
  lng: number;
  kind: string;
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
  camera: MissionSceneCamera;
  layers: MissionSceneLayers;
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

/** Approximate a point's fractional position along the route (0..1) by nearest vertex. */
function routeRatioFor(route: [number, number][], lat: number, lng: number): number {
  if (route.length < 2) return 0.5;
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < route.length; i += 1) {
    const dLng = route[i][0] - lng;
    const dLat = route[i][1] - lat;
    const dist = dLng * dLng + dLat * dLat;
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx / (route.length - 1);
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
    return `Mission recap: the ${tripName} plan is drafted. This preview is planning visualization, not proof the route is safe — review conditions before departure.`;
  }
  const reviewCount = brief.risks?.length ?? 0;
  if (brief.readiness === 'ready') {
    return `Mission recap: the plan checks out. ${reviewCount > 0 ? `Keep an eye on ${reviewCount} watch ${reviewCount === 1 ? 'item' : 'items'}, and confirm` : 'Confirm'} conditions on departure day.`;
  }
  if (brief.readiness === 'blocked') {
    return `Mission recap: this route is blocked as planned. Resolve the flagged items before committing to it — this preview is a planning visualization, not a green light.`;
  }
  return `Mission recap: the route is close, but ${reviewCount > 0 ? `${reviewCount} ${reviewCount === 1 ? 'item needs' : 'items need'}` : 'a few items need'} review before departure.`;
}

function recapSubtitle(brief: MissionControlBrief | null) {
  if (!brief) return 'Readiness not checked yet';
  if (brief.readiness === 'ready') return 'Ready — confirm conditions before departure';
  if (brief.readiness === 'blocked') return 'Blocked — resolve flagged items first';
  return 'Needs review before departure';
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

  const startTitle = validCheckpoints[0]?.title || '';
  const endTitle = validCheckpoints.length > 1 ? validCheckpoints[validCheckpoints.length - 1]?.title || '' : '';
  const legLabel = startTitle && endTitle && startTitle !== endTitle ? `${startTitle} to ${endTitle}` : tripName;

  // --- Always: intro + whole_route ---
  scenes.push({
    id: 'scene-intro',
    type: 'intro',
    title: tripName,
    subtitle: 'Mission briefing',
    durationMs: 9000,
    camera: { mode: 'fit', pitch: 52, zoom: 9.8 },
    layers: {},
    narration: `I built the plan for ${legLabel}. I'll fly it for you — the full route first, then the parts that matter.`,
    callouts: [],
  });
  scenes.push({
    id: 'scene-whole-route',
    type: 'whole_route',
    title: 'The full route',
    subtitle: `${validCheckpoints.length || 'Route'} checkpoints plotted`,
    durationMs: 15000,
    routeSlice: [0, 1],
    camera: { mode: 'follow', pitch: 64, zoom: 11.4 },
    layers: {},
    narration: "Here's the full route. I'll fly the plan by day, then show the stops and risks that need review.",
    callouts: validCheckpoints.slice(0, 8).map(cp => ({
      id: cp.id,
      title: cp.title,
      note: cp.note,
      lat: cp.lat,
      lng: cp.lng,
      kind: 'checkpoint',
    })),
  });

  const middle: WeightedScene[] = [];

  // --- day_flyover scenes ---
  const dayNumbers = Array.from(new Set(
    validCheckpoints.map(cp => Number(cp.day || 0)).filter(day => day > 0),
  )).sort((a, b) => a - b);
  const maxDay = dayNumbers.length ? dayNumbers[dayNumbers.length - 1] : 0;
  for (const day of dayNumbers.slice(0, MAX_DAY_SCENES)) {
    const dayCheckpoints = validCheckpoints.filter(cp => Number(cp.day || 0) === day);
    if (!dayCheckpoints.length) continue;
    const ratios = dayCheckpoints.map(cp => routeRatioFor(cleanRoute, cp.lat, cp.lng)).sort((a, b) => a - b);
    const start = clampRatio(day === dayNumbers[0] ? 0 : ratios[0] - 0.02);
    const end = clampRatio(day === maxDay ? 1 : ratios[ratios.length - 1] + 0.02);
    const anchor = dayCheckpoints[Math.floor(dayCheckpoints.length / 2)];
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
        focus: { lat: anchor.lat, lng: anchor.lng },
        camera: { mode: 'follow', zoom: 12.4, pitch: 66 },
        layers: {},
        narration: day === 1
          ? `Day 1 is the approach. ${dayNote || 'The plan keeps the first leg clean before the terrain gets interesting.'}`
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
        durationMs: 11000,
        focus: { lat: camp.lat, lng: camp.lng },
        camera: { mode: 'fly', zoom: 13.2, pitch: 68 },
        layers: { terrain: true },
        narration: `${camp.title} is the ${camp.day ? `day ${camp.day} ` : ''}overnight anchor. ${firstSentence(camp.note) || 'It stays close to the route and gives the day a clean landing.'}`,
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
          durationMs: 11000,
          focus: { lat: night.lat, lng: night.lng },
          camera: { mode: 'fly', zoom: 13.2, pitch: 68 },
          layers: { terrain: true },
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
        durationMs: 4600,
        focus: { lat: fuel.lat, lng: fuel.lng },
        camera: { mode: 'fly', zoom: 11.5, pitch: 55 },
        layers: {},
        narration: `Fuel coverage runs through ${fuel.title}. ${firstSentence(fuel.note) || 'Top off here before the next low-service stretch.'}`,
        callouts: [calloutFromPlace(fuel, 'fuel')],
      },
    });
  }

  // --- trail_flythrough scenes ---
  const trailPlaces = validPlaces
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
        durationMs: 5600,
        focus: { lat: trail.lat, lng: trail.lng },
        camera: { mode: 'fly', zoom: 12.5, pitch: 62 },
        layers: { terrain: true },
        narration: `I'm switching to terrain for ${trail.title} — this is where boots leave the vehicle. ${firstSentence(trail.note) || 'Check access and conditions before committing the day to it.'}`,
        callouts: [calloutFromPlace(trail, 'trail')],
      },
    });
  }

  // --- monument_orbit scenes ---
  const monumentPlaces = validPlaces
    .filter(p => placeMatches(p.type, [
      'monument', 'historic', 'park', 'viewpoint', 'view', 'scenic', 'waterfall', 'glacier', 'tourism', 'landmark', 'water',
    ]) && !placeMatches(p.type, ['weather', 'risk', 'trail', 'camp', 'stay', 'fuel']))
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
        durationMs: 6200,
        focus: { lat: monument.lat, lng: monument.lng },
        camera: { mode: 'orbit', zoom: 12, pitch: 62 },
        layers: { terrain: true },
        narration: `${monument.title} stays close to the route and gives the day a scenic anchor. ${firstSentence(monument.note) || 'Worth the stop if daylight holds.'}`,
        callouts: [calloutFromPlace(monument, 'monument')],
      },
    });
  }

  // --- risk / weather / offline scenes from Mission Control ---
  const risks = (missionBrief?.risks ?? [])
    .slice()
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  let riskCount = 0;
  const offlineSeen = { done: false };
  for (const risk of risks) {
    if (riskCount >= MAX_RISK_SCENES) break;
    const type = riskSceneType(risk);
    if (type === 'offline_readiness' && offlineSeen.done) continue;
    if (type === 'offline_readiness') offlineSeen.done = true;
    const focus = finite(risk.lat, risk.lng)
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
            ? 'Offline readiness'
            : 'Risk check',
        day: risk.day,
        durationMs: 5400,
        focus,
        routeSlice: type === 'offline_readiness' ? [0.25, 0.75] : undefined,
        camera: type === 'offline_readiness'
          ? { mode: 'fit', pitch: 45 }
          : { mode: 'fly', zoom: 10.5, pitch: 55 },
        layers: { warning: true },
        narration: type === 'weather_focus'
          ? `Weather watch: ${firstSentence(risk.summary) || risk.title}. Check timing before this segment.`
          : type === 'offline_readiness'
            ? `This is the remote stretch. ${firstSentence(risk.summary) || 'Offline maps and fuel planning matter here.'}`
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

  // Play order: days first (chronological), then focus stops by day/route position, risks near the end.
  const orderRank = (scene: MissionScene) => {
    if (scene.type === 'day_flyover') return 0;
    if (scene.type === 'camp_arrival' || scene.type === 'fuel_stop' || scene.type === 'trail_flythrough' || scene.type === 'monument_orbit') return 1;
    if (scene.type === 'risk_focus' || scene.type === 'weather_focus') return 2;
    if (scene.type === 'offline_readiness') return 3;
    return 1;
  };
  chosen.sort((a, b) => {
    const rank = orderRank(a) - orderRank(b);
    if (rank !== 0) return rank;
    return (a.day ?? 99) - (b.day ?? 99);
  });
  scenes.push(...chosen);

  // --- Always: mission_recap ---
  scenes.push({
    id: 'scene-recap',
    type: 'mission_recap',
    title: 'Mission recap',
    subtitle: recapSubtitle(missionBrief),
    durationMs: 6000,
    routeSlice: [0, 1],
    camera: { mode: 'fit', pitch: 45 },
    layers: { warning: missionBrief?.readiness === 'blocked' },
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
