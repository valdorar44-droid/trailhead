import { storage } from '@/lib/storage';
import type { CampReusePolicy, RouteStyleMode, TripShapeMode } from '@/lib/api';

export const TRAILHEAD_COPILOT_ROUTE_BUILDER_DRAFT_KEY = 'trailhead_copilot_route_builder_draft_v1';

export type CopilotCampPreference = 'public' | 'private' | 'rv' | 'developed' | 'any';
export type CopilotRoadPreference = 'paved_ok' | 'dirt_ok' | 'high_clearance' | '4wd_only';
export type CopilotRiskTolerance = 'conservative' | 'moderate' | 'wild_but_safe';
export type CopilotPoiPreference =
  | 'fuel'
  | 'water'
  | 'trailhead'
  | 'viewpoint'
  | 'hot_spring'
  | 'food'
  | 'grocery'
  | 'mechanic'
  | 'attraction'
  | 'historic'
  | 'park'
  | 'monument'
  | 'visitor_center'
  | 'water_access'
  | 'camp_services';

export type TrailheadRouteBuilderDraftStop = {
  id?: string;
  day?: number;
  name: string;
  lat?: number;
  lng?: number;
  type?: 'start' | 'fuel' | 'waypoint' | 'camp' | 'motel' | string;
  routePointType?: 'side_stop' | 'break' | 'through';
  routeShapeRole?: 'start' | 'destination' | 'outbound_anchor' | 'return_anchor' | 'overnight' | 'side_stop';
  label?: string;
  description?: string;
  source?: string;
};

export type TrailheadRouteScoutDraftSummary = {
  status?: string;
  message?: string;
  totalMiles?: number;
  totalDurationHours?: number;
  reviewDays?: number[];
  missingDays?: number[];
  lockedStopCount?: number;
  stopCount?: number;
  generatedAt?: number;
};

export type TrailheadRouteBuilderDraft = {
  id?: string;
  source?: 'copilot' | 'manual' | string;
  updatedAt?: number;
  routeName?: string;
  start?: string;
  destination?: string;
  stops?: Array<string | TrailheadRouteBuilderDraftStop>;
  days?: number;
  tripShape?: TripShapeMode;
  routeStyle?: RouteStyleMode;
  campPreference?: CopilotCampPreference;
  campPhotoOnly?: boolean;
  campReuse?: CampReusePolicy;
  driveHours?: number;
  targetMiles?: number;
  restDays?: number[];
  rigConstraints?: Record<string, unknown> | null;
  useRigProfile?: boolean;
  autoBuild?: boolean;
  fuelStrategy?: 'auto_when_needed' | 'manual' | string;
  poiPreferences?: CopilotPoiPreference[] | string[];
  roadPreference?: CopilotRoadPreference | string;
  riskTolerance?: CopilotRiskTolerance | string;
  originalCommand?: string;
  handoff?: 'scout_review' | 'builder_setup' | string;
  scoutSummary?: TrailheadRouteScoutDraftSummary;
};

export const TRAILHEAD_COPILOT_CAPABILITY_SUMMARY = [
  'Map can search, fly, select cards, preview routes, toggle layers, change style, show radar, public lands, topo, satellite, nautical, pins, camps, group sites, trails, and places.',
  'Navigation only starts through startNavigation after explicit confirmation and a usable current location.',
  'Route Builder handles multi-day trip drafts with start, destination, stops, days, shape, route style, camp preference, camp reuse, drive hours, target miles, rest days, rig constraints, official camp details, huts, shelters, trekking lodges, base-camp corridors, group-site fit, nearby things to do, nearby campgrounds, parks, monuments, trail systems, and trip services.',
  'Recreation.gov/RIDB permits, tours, tickets, lotteries, and campsite bookings are assisted official handoffs; Trailhead can open, remind, and plan around them, but does not checkout or enter lotteries directly.',
  'Guide, reports, offline downloads, rig profile, paid trip outputs, weather, safety, water, and community pins are first-class workflows.',
];

function cleanDraftStop(value: unknown): string | TrailheadRouteBuilderDraftStop | null {
  if (typeof value === 'string') {
    const stop = value.trim();
    return stop ? stop.slice(0, 160) : null;
  }
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 160) : '';
  if (!name) return null;
  const lat = Number(input.lat);
  const lng = Number(input.lng);
  const day = Number(input.day);
  const stop: TrailheadRouteBuilderDraftStop = {
    id: typeof input.id === 'string' ? input.id.slice(0, 120) : undefined,
    day: Number.isFinite(day) ? Math.max(0, Math.min(30, Math.round(day))) : undefined,
    name,
    type: typeof input.type === 'string' ? input.type.slice(0, 40) : undefined,
    routePointType: input.routePointType === 'side_stop' || input.routePointType === 'through' || input.routePointType === 'break' ? input.routePointType : undefined,
    routeShapeRole: input.routeShapeRole === 'start' || input.routeShapeRole === 'destination' || input.routeShapeRole === 'outbound_anchor' || input.routeShapeRole === 'return_anchor' || input.routeShapeRole === 'overnight' || input.routeShapeRole === 'side_stop' ? input.routeShapeRole : undefined,
    label: typeof input.label === 'string' ? input.label.slice(0, 80) : undefined,
    description: typeof input.description === 'string' ? input.description.slice(0, 240) : undefined,
    source: typeof input.source === 'string' ? input.source.slice(0, 80) : undefined,
  };
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    stop.lat = lat;
    stop.lng = lng;
  }
  return stop;
}

function normalizeRoadPreference(value: unknown): CopilotRoadPreference | undefined {
  const clean = String(value || '').trim().toLowerCase();
  if (clean === 'paved_ok' || clean === 'dirt_ok' || clean === 'high_clearance' || clean === '4wd_only') return clean;
  return undefined;
}

function normalizeRiskTolerance(value: unknown): CopilotRiskTolerance | undefined {
  const clean = String(value || '').trim().toLowerCase();
  if (clean === 'conservative' || clean === 'moderate' || clean === 'wild_but_safe') return clean;
  return undefined;
}

function normalizeRouteStyle(value: unknown): RouteStyleMode | undefined {
  const clean = String(value || '').trim().toLowerCase();
  if (clean === 'direct' || clean === 'balanced' || clean === 'wild') return clean;
  if (clean === 'wild_but_safe' || clean === 'adventure' || clean === 'adventurous' || clean === 'rough' || clean === 'backroads') return 'wild';
  return undefined;
}

function normalizeCampPreference(value: unknown): CopilotCampPreference | undefined {
  const clean = String(value || '').trim().toLowerCase();
  if (clean === 'private' || clean === 'rv' || clean === 'developed' || clean === 'any') return clean;
  if (clean === 'public' || clean === 'primitive' || clean === 'dispersed' || clean === 'blm' || clean === 'usfs' || clean === 'federal') return 'public';
  return undefined;
}

function cleanScoutSummary(value: unknown): TrailheadRouteScoutDraftSummary | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as Record<string, unknown>;
  const totalMiles = Number(input.totalMiles);
  const totalDurationHours = Number(input.totalDurationHours);
  const lockedStopCount = Number(input.lockedStopCount);
  const stopCount = Number(input.stopCount);
  const generatedAt = Number(input.generatedAt);
  const cleanDays = (days: unknown) => Array.isArray(days)
    ? days.map(Number).filter(Number.isFinite).map(day => Math.max(1, Math.min(30, Math.round(day)))).slice(0, 30)
    : undefined;
  return {
    status: typeof input.status === 'string' ? input.status.slice(0, 40) : undefined,
    message: typeof input.message === 'string' ? input.message.slice(0, 700) : undefined,
    totalMiles: Number.isFinite(totalMiles) ? Math.max(0, Math.round(totalMiles)) : undefined,
    totalDurationHours: Number.isFinite(totalDurationHours) ? Math.max(0, Math.round(totalDurationHours * 10) / 10) : undefined,
    reviewDays: cleanDays(input.reviewDays),
    missingDays: cleanDays(input.missingDays),
    lockedStopCount: Number.isFinite(lockedStopCount) ? Math.max(0, Math.round(lockedStopCount)) : undefined,
    stopCount: Number.isFinite(stopCount) ? Math.max(0, Math.round(stopCount)) : undefined,
    generatedAt: Number.isFinite(generatedAt) ? generatedAt : undefined,
  };
}

function normalizePoiPreference(value: unknown): CopilotPoiPreference | null {
  const clean = String(value || '').trim().toLowerCase();
  if (
    clean === 'fuel'
    || clean === 'water'
    || clean === 'trailhead'
    || clean === 'viewpoint'
    || clean === 'hot_spring'
    || clean === 'food'
    || clean === 'grocery'
    || clean === 'mechanic'
    || clean === 'attraction'
    || clean === 'historic'
    || clean === 'park'
    || clean === 'monument'
    || clean === 'visitor_center'
    || clean === 'water_access'
    || clean === 'camp_services'
  ) {
    return clean;
  }
  return null;
}

export function normalizeTrailheadRouteBuilderDraft(value: unknown): TrailheadRouteBuilderDraft {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const days = Number(input.days);
  const driveHours = Number(input.driveHours);
  const targetMiles = Number(input.targetMiles);
  const tripShape = input.tripShape === 'loop' || input.tripShape === 'there_and_back' ? input.tripShape : input.tripShape === 'one_way' ? 'one_way' : undefined;
  const routeStyle = normalizeRouteStyle(input.routeStyle);
  const campPreference = normalizeCampPreference(input.campPreference);
  const campReuse = input.campReuse === 'same_camp_window' || input.campReuse === 'manual' ? input.campReuse : input.campReuse === 'different_each_night' ? 'different_each_night' : undefined;
  const poiPreferences = Array.isArray(input.poiPreferences)
    ? input.poiPreferences.map(normalizePoiPreference).filter((item): item is CopilotPoiPreference => !!item).slice(0, 12)
    : undefined;
  return {
    id: typeof input.id === 'string' ? input.id : `copilot-draft-${Date.now()}`,
    source: typeof input.source === 'string' ? input.source : 'copilot',
    updatedAt: Number.isFinite(Number(input.updatedAt)) ? Number(input.updatedAt) : Date.now(),
    routeName: typeof input.routeName === 'string' ? input.routeName.trim().slice(0, 140) : undefined,
    start: typeof input.start === 'string' ? input.start.trim().slice(0, 120) : undefined,
    destination: typeof input.destination === 'string' ? input.destination.trim().slice(0, 120) : undefined,
    stops: Array.isArray(input.stops) ? input.stops.map(cleanDraftStop).filter((stop): stop is string | TrailheadRouteBuilderDraftStop => !!stop).slice(0, 24) : undefined,
    days: Number.isFinite(days) ? Math.max(1, Math.min(30, Math.round(days))) : undefined,
    tripShape,
    routeStyle,
    campPreference,
    campPhotoOnly: input.campPhotoOnly === true || input.requirePhotos === true || input.require_photos === true || input.photosOnly === true,
    campReuse,
    driveHours: Number.isFinite(driveHours) ? Math.max(1, Math.min(14, driveHours)) : undefined,
    targetMiles: Number.isFinite(targetMiles) ? Math.max(20, Math.min(700, Math.round(targetMiles))) : undefined,
    restDays: Array.isArray(input.restDays) ? input.restDays.map(Number).filter(Number.isFinite).map(n => Math.max(1, Math.round(n))).slice(0, 30) : undefined,
    rigConstraints: input.rigConstraints && typeof input.rigConstraints === 'object' ? input.rigConstraints as Record<string, unknown> : null,
    useRigProfile: input.useRigProfile === true,
    autoBuild: input.autoBuild === true,
    fuelStrategy: typeof input.fuelStrategy === 'string' ? input.fuelStrategy : undefined,
    poiPreferences,
    roadPreference: normalizeRoadPreference(input.roadPreference),
    riskTolerance: normalizeRiskTolerance(input.riskTolerance),
    originalCommand: typeof input.originalCommand === 'string' ? input.originalCommand.slice(0, 500) : undefined,
    handoff: typeof input.handoff === 'string' ? input.handoff.slice(0, 60) : undefined,
    scoutSummary: cleanScoutSummary(input.scoutSummary),
  };
}

export async function loadTrailheadRouteBuilderDraft(): Promise<TrailheadRouteBuilderDraft | null> {
  const raw = await storage.get(TRAILHEAD_COPILOT_ROUTE_BUILDER_DRAFT_KEY).catch(() => null);
  if (!raw) return null;
  try {
    return normalizeTrailheadRouteBuilderDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function saveTrailheadRouteBuilderDraft(draft: TrailheadRouteBuilderDraft): Promise<TrailheadRouteBuilderDraft> {
  const clean = normalizeTrailheadRouteBuilderDraft({ ...draft, updatedAt: Date.now(), source: draft.source || 'copilot' });
  await storage.set(TRAILHEAD_COPILOT_ROUTE_BUILDER_DRAFT_KEY, JSON.stringify(clean));
  return clean;
}

export async function mergeTrailheadRouteBuilderDraft(update: TrailheadRouteBuilderDraft): Promise<TrailheadRouteBuilderDraft> {
  const existing = await loadTrailheadRouteBuilderDraft();
  return saveTrailheadRouteBuilderDraft({ ...(existing ?? {}), ...update, source: update.source || existing?.source || 'copilot' });
}

export async function clearTrailheadRouteBuilderDraft() {
  await storage.del(TRAILHEAD_COPILOT_ROUTE_BUILDER_DRAFT_KEY).catch(() => {});
}
