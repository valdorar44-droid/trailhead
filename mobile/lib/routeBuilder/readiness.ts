import type { DayRouteSegment, TripReadiness, TripReadinessTask, ProviderRouteGeometry, RouteBuilderStopLike } from './model';
import { isTemporaryRouteAnchor } from './geometry';

export function computeTripReadiness(input: {
  stops: RouteBuilderStopLike[];
  geometry?: ProviderRouteGeometry | null;
  daySegments?: DayRouteSegment[];
  days: number[];
  dayNeedsOvernight: (day: number) => boolean;
  restDays?: number[];
  fuelRangeMi?: number | null;
}) {
  const tasks: TripReadinessTask[] = [];
  const rest = new Set(input.restDays ?? []);
  const geometryReady = !!input.geometry && input.geometry.coords.length >= 2 && input.geometry.source !== 'sketch' && input.geometry.source !== 'none';
  if (!geometryReady) {
    tasks.push({ level: 'warn', label: 'Route ready', text: 'Build a road route before using navigation.' });
  } else {
    tasks.push({ level: 'ok', label: 'Route ready', text: input.geometry?.confidence === 'medium' ? 'Route built. Review it before leaving.' : 'Road route is saved.' });
  }

  const missingOvernight = input.days.filter(day => !rest.has(day) && input.dayNeedsOvernight(day) && !input.stops.some(stop => stop.day === day && (stop.type === 'camp' || stop.type === 'motel')));
  if (missingOvernight.length) {
    tasks.push({ level: 'warn', label: 'Choose a camp', text: `Add camp/lodging for day ${missingOvernight[0]}.` });
  } else if (input.stops.length) {
    tasks.push({ level: 'ok', label: 'Choose a camp', text: 'Overnight stops are set.' });
  }

  const temporary = input.stops.find(isTemporaryRouteAnchor);
  if (temporary) {
    tasks.push({ level: 'warn', label: 'Review this day', text: `Day ${temporary.day} still needs a picked stop.` });
  }

  const longDay = input.daySegments?.find(segment => segment.overDailyMax);
  if (longDay) {
    tasks.push({ level: 'warn', label: 'Drive time', text: `Day ${longDay.day} is over your daily max.` });
  } else if (input.daySegments?.length) {
    tasks.push({ level: 'ok', label: 'Pace', text: 'Daily drive times fit your max.' });
  }

  if (input.fuelRangeMi && input.geometry?.totalDistanceMi && input.geometry.totalDistanceMi > input.fuelRangeMi * 0.7 && !input.stops.some(stop => stop.type === 'fuel')) {
    tasks.push({ level: 'warn', label: 'Fuel', text: `Rig range is about ${Math.round(input.fuelRangeMi)} mi. Add fuel before remote stretches.` });
  }

  const navigationReady = tasks.every(task => task.level === 'ok') && geometryReady;
  return {
    navigationReady,
    routeReady: geometryReady,
    tasks: tasks.slice(0, 5),
  } satisfies TripReadiness;
}
