import type {
  DayRouteSegment,
  ProviderRouteGeometry,
  RouteBuilderIntent,
  RouteBuilderStopLike,
  RouteBuildIssue,
  RouteBuildSession,
} from './model';
import {
  computeDaySegmentsFromRouteGeometry,
  filterDurableNavigationStops,
  isTemporaryRouteAnchor,
} from './geometry';
import { computeTripReadiness } from './readiness';

export function buildRouteBuilderSession<TStop extends RouteBuilderStopLike>(input: {
  intent: RouteBuilderIntent;
  stops: TStop[];
  geometry?: ProviderRouteGeometry | null;
  restDays?: number[];
  fuelRangeMi?: number | null;
  dayNeedsOvernight: (day: number) => boolean;
  campWindowForDay?: (day: number) => { start: number; end: number; label: string };
  maxDriveHoursByDay?: Record<number, number | undefined>;
  existingDaySegments?: DayRouteSegment[];
  extraIssues?: RouteBuildIssue[];
}): RouteBuildSession<TStop> {
  const durableStops = filterDurableNavigationStops(input.stops);
  const temporaryAnchors = input.stops.filter(isTemporaryRouteAnchor);
  const geometry = input.geometry ?? null;
  const daySegments = geometry?.coords.length
    ? computeDaySegmentsFromRouteGeometry({
        geometry,
        days: input.intent.days,
        defaultMaxDriveHours: input.intent.maxDriveHoursPerDay,
        maxDriveHoursByDay: input.maxDriveHoursByDay,
        campWindowForDay: input.campWindowForDay,
        shape: input.intent.shape,
      })
    : input.existingDaySegments ?? [];
  const readiness = computeTripReadiness({
    stops: input.stops,
    geometry,
    daySegments,
    days: input.intent.days,
    dayNeedsOvernight: input.dayNeedsOvernight,
    restDays: input.restDays,
    fuelRangeMi: input.fuelRangeMi,
  });

  const issues: RouteBuildIssue[] = [...(input.extraIssues ?? [])];
  if (!readiness.routeReady) {
    issues.push({
      code: 'provider_route_missing',
      level: 'block',
      message: 'Road route is missing.',
    });
  } else if (geometry?.confidence === 'medium' || geometry?.engine === 'osrm-fallback') {
    issues.push({
      code: 'provider_route_low_confidence',
      level: 'warn',
      message: 'Route built with a fallback path. Review it before navigation.',
    });
  }
  for (const anchor of temporaryAnchors) {
    issues.push({
      code: 'temporary_anchor',
      level: 'warn',
      day: anchor.day,
      message: `Day ${anchor.day} still needs a picked stop.`,
    });
  }
  for (const day of input.intent.days) {
    if (input.restDays?.includes(day)) continue;
    if (input.dayNeedsOvernight(day) && !input.stops.some(stop => stop.day === day && (stop.type === 'camp' || stop.type === 'motel'))) {
      issues.push({
        code: 'missing_overnight',
        level: 'warn',
        day,
        message: `Day ${day} needs camp or lodging.`,
      });
    }
  }
  for (const segment of daySegments) {
    if (segment.overDailyMax) {
      issues.push({
        code: 'over_daily_max',
        level: 'warn',
        day: segment.day,
        message: `Day ${segment.day} is over the selected daily drive max.`,
      });
    }
  }
  if (input.fuelRangeMi && geometry?.totalDistanceMi && geometry.totalDistanceMi > input.fuelRangeMi * 0.7 && !input.stops.some(stop => stop.type === 'fuel')) {
    issues.push({
      code: 'fuel_range',
      level: 'warn',
      message: 'Add fuel before remote stretches.',
    });
  }

  return {
    intent: input.intent,
    geometry,
    daySegments,
    durableStops,
    temporaryAnchors,
    issues,
    readiness,
    navigationReady: readiness.navigationReady && !issues.some(issue => issue.level === 'block'),
  };
}
