import { storage } from '@/lib/storage';
import type { CampReusePolicy, RouteStyleMode, TripShapeMode } from '@/lib/api';

export const TRAILHEAD_COPILOT_ROUTE_BUILDER_DRAFT_KEY = 'trailhead_copilot_route_builder_draft_v1';

export type CopilotCampPreference = 'public' | 'private' | 'rv' | 'developed' | 'any';

export type TrailheadRouteBuilderDraft = {
  id?: string;
  source?: 'copilot' | 'manual' | string;
  updatedAt?: number;
  start?: string;
  destination?: string;
  stops?: string[];
  days?: number;
  tripShape?: TripShapeMode;
  routeStyle?: RouteStyleMode;
  campPreference?: CopilotCampPreference;
  campReuse?: CampReusePolicy;
  driveHours?: number;
  targetMiles?: number;
  restDays?: number[];
  rigConstraints?: Record<string, unknown> | null;
  useRigProfile?: boolean;
  autoBuild?: boolean;
  fuelStrategy?: 'auto_when_needed' | 'manual' | string;
  poiPreferences?: string[];
  originalCommand?: string;
};

export const TRAILHEAD_COPILOT_CAPABILITY_SUMMARY = [
  'Map can search, fly, select cards, preview routes, toggle layers, change style, show radar, public lands, topo, satellite, nautical, pins, camps, trails, and places.',
  'Navigation only starts through startNavigation after explicit confirmation and a usable current location.',
  'Route Builder handles multi-day trip drafts with start, destination, stops, days, shape, route style, camp preference, camp reuse, drive hours, target miles, rest days, and rig constraints.',
  'Guide, reports, offline downloads, rig profile, paid trip outputs, weather, safety, water, and community pins are first-class workflows.',
];

function cleanDraft(value: unknown): TrailheadRouteBuilderDraft {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const days = Number(input.days);
  const driveHours = Number(input.driveHours);
  const targetMiles = Number(input.targetMiles);
  const tripShape = input.tripShape === 'loop' || input.tripShape === 'there_and_back' ? input.tripShape : input.tripShape === 'one_way' ? 'one_way' : undefined;
  const routeStyle = input.routeStyle === 'direct' || input.routeStyle === 'wild' ? input.routeStyle : input.routeStyle === 'balanced' ? 'balanced' : undefined;
  const campPreference = input.campPreference === 'private' || input.campPreference === 'rv' || input.campPreference === 'developed' || input.campPreference === 'any'
    ? input.campPreference
    : input.campPreference === 'public' ? 'public' : undefined;
  const campReuse = input.campReuse === 'same_camp_window' || input.campReuse === 'manual' ? input.campReuse : input.campReuse === 'different_each_night' ? 'different_each_night' : undefined;
  return {
    id: typeof input.id === 'string' ? input.id : `copilot-draft-${Date.now()}`,
    source: typeof input.source === 'string' ? input.source : 'copilot',
    updatedAt: Number.isFinite(Number(input.updatedAt)) ? Number(input.updatedAt) : Date.now(),
    start: typeof input.start === 'string' ? input.start.trim().slice(0, 120) : undefined,
    destination: typeof input.destination === 'string' ? input.destination.trim().slice(0, 120) : undefined,
    stops: Array.isArray(input.stops) ? input.stops.map(String).map(s => s.trim()).filter(Boolean).slice(0, 12) : undefined,
    days: Number.isFinite(days) ? Math.max(1, Math.min(30, Math.round(days))) : undefined,
    tripShape,
    routeStyle,
    campPreference,
    campReuse,
    driveHours: Number.isFinite(driveHours) ? Math.max(1, Math.min(14, driveHours)) : undefined,
    targetMiles: Number.isFinite(targetMiles) ? Math.max(20, Math.min(700, Math.round(targetMiles))) : undefined,
    restDays: Array.isArray(input.restDays) ? input.restDays.map(Number).filter(Number.isFinite).map(n => Math.max(1, Math.round(n))).slice(0, 30) : undefined,
    rigConstraints: input.rigConstraints && typeof input.rigConstraints === 'object' ? input.rigConstraints as Record<string, unknown> : null,
    useRigProfile: input.useRigProfile === true,
    autoBuild: input.autoBuild === true,
    fuelStrategy: typeof input.fuelStrategy === 'string' ? input.fuelStrategy : undefined,
    poiPreferences: Array.isArray(input.poiPreferences) ? input.poiPreferences.map(String).map(s => s.trim()).filter(Boolean).slice(0, 12) : undefined,
    originalCommand: typeof input.originalCommand === 'string' ? input.originalCommand.slice(0, 500) : undefined,
  };
}

export async function loadTrailheadRouteBuilderDraft(): Promise<TrailheadRouteBuilderDraft | null> {
  const raw = await storage.get(TRAILHEAD_COPILOT_ROUTE_BUILDER_DRAFT_KEY).catch(() => null);
  if (!raw) return null;
  try {
    return cleanDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function saveTrailheadRouteBuilderDraft(draft: TrailheadRouteBuilderDraft): Promise<TrailheadRouteBuilderDraft> {
  const clean = cleanDraft({ ...draft, updatedAt: Date.now(), source: draft.source || 'copilot' });
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
