import type {
  PlannerV2Event,
  PlannerV2Finding,
  PlannerV2Snapshot,
  PlannerV2Task,
  TripResult,
} from '@/lib/api';
import type { StaticMapboxPin } from '@/components/explore/StaticMapboxPreview';

export type PlannerV2Message = {
  id: string;
  role: 'user' | 'guide';
  text: string;
};

export type PlannerV2View = 'conversation' | 'research' | 'reveal' | 'review';

export function mergePlannerEvents(
  current: PlannerV2Event[],
  incoming: PlannerV2Event[],
): PlannerV2Event[] {
  const bySequence = new Map<number, PlannerV2Event>();
  for (const event of [...current, ...incoming]) {
    if (!Number.isInteger(event.seq) || event.seq <= 0) continue;
    const previous = bySequence.get(event.seq);
    if (!previous || event.created_at >= previous.created_at) bySequence.set(event.seq, event);
  }
  return [...bySequence.values()].sort((a, b) => a.seq - b.seq);
}

export function newestPlannerMessage(snapshot: PlannerV2Snapshot | null): string {
  const latest = snapshot?.events[snapshot.events.length - 1];
  return String(latest?.payload?.message || latest?.task_id || 'Preparing your trip research.');
}

export function plannerTaskProgress(tasks: PlannerV2Task[]) {
  const doneStates = new Set(['completed', 'warning', 'blocked', 'skipped']);
  const completed = tasks.filter(task => doneStates.has(task.state)).length;
  return { completed, total: tasks.length, ratio: tasks.length ? completed / tasks.length : 0 };
}

export function plannerRunIsTerminal(status: string) {
  return ['ready_for_review', 'committed', 'cancelled', 'failed'].includes(status);
}

export function plannerRunCanResume(status: string) {
  return ['pending', 'running', 'ai', 'geocoding', 'routing', 'enriching', 'saving', 'committing'].includes(status);
}

function waypointPinKind(type: string) {
  const normalized = type.toLowerCase();
  if (/camp|motel|overnight/.test(normalized)) return 'camp';
  if (/fuel|gas/.test(normalized)) return 'fuel';
  if (/trail|hike/.test(normalized)) return 'trail';
  if (/warning|closure|permit/.test(normalized)) return 'warning';
  return 'place';
}

export function plannerMapPins(trip: TripResult | null): StaticMapboxPin[] {
  if (!trip) return [];
  const pins: StaticMapboxPin[] = [];
  const seen = new Set<string>();
  const add = (id: string, title: string, lat: unknown, lng: unknown, kind: string, active = false) => {
    const latitude = Number(lat);
    const longitude = Number(lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    const key = `${latitude.toFixed(5)},${longitude.toFixed(5)}:${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    pins.push({ id, title: title || 'Trip stop', lat: latitude, lng: longitude, kind, active });
  };
  (trip.plan?.waypoints ?? []).forEach((waypoint, index, all) => {
    add(
      `waypoint-${index}`,
      String(waypoint.name || `Stop ${index + 1}`),
      waypoint.lat,
      waypoint.lng,
      waypointPinKind(String(waypoint.type || 'place')),
      index === 0 || index === all.length - 1,
    );
  });
  (trip.campsites ?? []).forEach((camp, index) => {
    add(`camp-${index}`, String(camp.name || 'Camp'), camp.lat, camp.lng, 'camp');
  });
  (trip.gas_stations ?? []).forEach((station, index) => {
    add(`fuel-${index}`, String(station.name || 'Fuel'), station.lat, station.lng, 'fuel');
  });
  (trip.route_pois ?? []).forEach((place, index) => {
    add(`place-${index}`, String(place.name || 'Worthwhile stop'), place.lat, place.lng, waypointPinKind(String(place.type || 'place')));
  });
  (trip.route_conditions ?? []).forEach((condition, index) => {
    add(`condition-${index}`, String(condition.title || 'Route warning'), condition.lat, condition.lng, 'warning');
  });
  (trip.weather_checks ?? []).forEach((weather, index) => {
    add(`weather-${index}`, String(weather.title || 'Weather check'), weather.lat, weather.lng, 'weather');
  });
  const selected: StaticMapboxPin[] = [];
  const selectedIds = new Set<string>();
  const take = (candidates: StaticMapboxPin[], limit: number) => {
    for (const pin of candidates) {
      if (selected.length >= 16 || limit <= 0 || selectedIds.has(pin.id)) continue;
      selected.push(pin);
      selectedIds.add(pin.id);
      limit -= 1;
    }
  };
  // The static service has a bounded overlay budget. Preserve both endpoints,
  // then allocate that budget across every safety/research category instead of
  // letting early waypoint arrays hide warnings, weather, fuel or trails.
  take(pins.filter(pin => pin.active), 2);
  take(pins.filter(pin => pin.kind === 'warning'), 2);
  take(pins.filter(pin => pin.kind === 'weather'), 2);
  take(pins.filter(pin => pin.kind === 'fuel'), 3);
  take(pins.filter(pin => pin.kind === 'trail'), 3);
  take(pins.filter(pin => pin.kind === 'camp'), 3);
  take(pins.filter(pin => pin.kind === 'place'), 1);
  take(pins, 16 - selected.length);
  return selected;
}

export function plannerFindingsByKind(findings: PlannerV2Finding[]) {
  const groups = new Map<string, PlannerV2Finding[]>();
  for (const finding of findings) {
    const kind = String(finding.kind || 'place');
    groups.set(kind, [...(groups.get(kind) ?? []), finding]);
  }
  return groups;
}

export function plannerDraftSummary(trip: TripResult | null) {
  if (!trip) return { days: 0, miles: 0, stops: 0, camps: 0, fuel: 0 };
  const routeMeters = Number(trip.route_geometry?.totalDistance ?? trip.route_geometry?.total_distance);
  return {
    days: Number(trip.plan?.duration_days || 0),
    miles: Number.isFinite(routeMeters) && routeMeters > 0
      ? Math.round(routeMeters / 1609.344)
      : Math.round(Number(trip.plan?.total_est_miles || 0)),
    stops: trip.plan?.waypoints?.length ?? 0,
    camps: trip.campsites?.length ?? 0,
    fuel: trip.gas_stations?.length ?? 0,
  };
}

export function plannerRunStorageKey(userId: string | number | null | undefined) {
  return `planner_research_run:${String(userId ?? 'signed-out')}`;
}

export function plannerStartRequestStorageKey(userId: string | number | null | undefined) {
  return `planner_research_start_request:${String(userId ?? 'signed-out')}`;
}

export function plannerConversationStorageKey(userId: string | number | null | undefined) {
  return `planner_research_conversation:${String(userId ?? 'signed-out')}`;
}
