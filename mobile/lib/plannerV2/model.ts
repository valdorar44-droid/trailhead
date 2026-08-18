import type {
  Campsite,
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

export function plannerResearchFailureCopy(error: unknown) {
  const message = String(error || '').trim();
  if (/confirm both (?:route )?(?:endpoints|ends)|confirm the start and destination/i.test(message)) {
    return "I couldn't confirm both route places. Return to the conversation, name them clearly, and try again.";
  }
  if (/country|border|outside the confirmed/i.test(message)) {
    return 'This route needs a country or border check. Return to the conversation and review the route places.';
  }
  if (/road route|route unavailable|could not build.*route/i.test(message)) {
    return "I couldn't build a reliable road route. Return to the conversation and check the route places.";
  }
  return "I couldn't finish this research. Your completed checks are still here.";
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

export function plannerCampCardSummary(camp: Pick<Campsite, 'reservable'>) {
  const availability = camp.reservable ? 'Reservations may be available. ' : '';
  return `${availability}Open it on the map for access, amenities, current conditions, and complete campground details.`;
}

export type PlannerPresentationNotices = {
  notes: string[];
  cautions: string[];
};

function customerPlanningNote(warning: string): string | null {
  if (/^No sourced fuel options were returned\.?$/i.test(warning)) {
    return 'Fuel stops are not pinned in this draft yet. Add preferred stations on the map or ask Trailhead to refine the route.';
  }
  if (/^No sourced activity or trail options were returned\.?$/i.test(warning)) {
    return 'No optional activities were added, so this draft stays focused on the route and camps. Ask Trailhead if you want more ideas.';
  }
  if (/^(?:Live|Current) (?:road|route) conditions (?:were )?unavailable(?:\.|$)/i.test(warning)) {
    return 'Live road updates were not attached to this draft. Refresh them on the map and check closures before departure.';
  }
  if (/^Live closure and alert feeds may be incomplete(?:\.|$)/i.test(warning)) {
    return 'Current closure and public-land updates need a quick refresh on the map before departure.';
  }
  if (/^Weather forecasts were unavailable(?:\.|$)/i.test(warning)) {
    return "A forecast wasn't attached to this draft. Refresh weather on the map closer to departure.";
  }
  if (/left out because .*direct source/i.test(warning)) return warning;
  return null;
}

export function plannerPresentationNotices(warnings: string[]): PlannerPresentationNotices {
  const notes: string[] = [];
  const cautions: string[] = [];
  const seen = new Set<string>();
  for (const source of warnings) {
    const warning = String(source || '').trim();
    if (!warning) continue;
    let text = customerPlanningNote(warning);
    let target = notes;
    if (!text) {
      target = cautions;
      text = /domestic road route passed (?:its )?border controls/i.test(warning)
        && /secondary country check/i.test(warning)
        ? 'The route stayed inside the confirmed country. One backup country lookup did not respond, so review the route map before departure.'
        : warning;
    }
    const key = `${target === notes ? 'note' : 'caution'}:${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    target.push(text);
  }
  return { notes, cautions };
}

export function plannerReadinessCopy(trip: TripResult | null) {
  const fuelCount = trip?.gas_stations?.length ?? 0;
  const weatherCount = trip?.weather_checks?.length ?? 0;
  const conditionCount = trip?.route_conditions?.length ?? 0;
  const conditionTitles = (trip?.route_conditions ?? [])
    .map(condition => String(condition?.title || '').trim().slice(0, 90))
    .filter(Boolean)
    .slice(0, 2);
  const conditionDetail = conditionTitles.length ? `: ${conditionTitles.join('; ')}` : '';
  const fuel = fuelCount > 0
    ? `${fuelCount} fuel ${fuelCount === 1 ? 'stop is' : 'stops are'} linked. Confirm hours and availability before departure.`
    : 'Fuel stops are not pinned yet. Open the map to add the stations you prefer before departure.';
  let conditions = 'No live alerts are attached to this draft. Refresh weather and road updates on the map closer to departure.';
  if (weatherCount > 0 && conditionCount > 0) {
    conditions = `${weatherCount} forecast ${weatherCount === 1 ? 'area is' : 'areas are'} linked. ${conditionCount} road ${conditionCount === 1 ? 'alert needs' : 'alerts need'} review${conditionDetail}. Refresh them before departure.`;
  } else if (weatherCount > 0) {
    conditions = `${weatherCount} forecast ${weatherCount === 1 ? 'area is' : 'areas are'} linked. No active road update was attached; refresh before departure.`;
  } else if (conditionCount > 0) {
    conditions = `${conditionCount} road ${conditionCount === 1 ? 'alert needs' : 'alerts need'} review${conditionDetail}. Refresh weather and road updates before departure.`;
  }
  return {
    fuel,
    permits: 'Permit guidance appears when Trailhead has a direct agency source. Confirm access rules in the linked sources before departure.',
    conditions,
  };
}

export function plannerSourceSummaryCopy(sourceCount: number, officialCount: number) {
  const sources = Math.max(0, Math.trunc(Number(sourceCount) || 0));
  const official = Math.min(sources, Math.max(0, Math.trunc(Number(officialCount) || 0)));
  if (!sources) return 'Research links will appear here when the draft includes sourced findings.';
  const agencyCopy = official > 0
    ? ` · ${official} government or agency ${official === 1 ? 'source' : 'sources'}`
    : '';
  return `${sources} linked ${sources === 1 ? 'source' : 'sources'}${agencyCopy} · Open any finding to review it`;
}

export function plannerRunStorageKey(userId: string | number | null | undefined) {
  return `planner_research_run.${String(userId ?? 'signed-out')}`;
}

export function plannerStartRequestStorageKey(userId: string | number | null | undefined) {
  return `planner_research_start_request.${String(userId ?? 'signed-out')}`;
}

export function plannerConversationStorageKey(userId: string | number | null | undefined) {
  return `planner_research_conversation.${String(userId ?? 'signed-out')}`;
}
