import type { TripResult, TripShapeMode } from './api';

export type RouteBuildSessionPhase =
  | 'routing'
  | 'camps'
  | 'fuel'
  | 'activities'
  | 'saving'
  | 'complete'
  | 'failed'
  | 'cancelled';

export type RouteBuildSessionStatus = 'running' | 'complete' | 'failed' | 'cancelled';
export type RouteBuildActivityChoice = 'pending' | 'browse' | 'skip';
export type RouteBuildSessionSource = 'manual_route_builder' | 'assisted_trip_planner';

export type RouteBuildPreviewStopType =
  | 'start'
  | 'destination'
  | 'camp'
  | 'overnight_review'
  | 'fuel';

export interface RouteBuildPreviewStop {
  id: string;
  lat: number;
  lng: number;
  day: number;
  type: RouteBuildPreviewStopType;
  name: string;
  needsReview?: boolean;
}

export interface RouteBuildSessionProgress {
  completed: number;
  total: number;
}

export interface RouteBuildSession {
  requestId: string;
  tripId: string;
  source: RouteBuildSessionSource;
  phase: RouteBuildSessionPhase;
  status: RouteBuildSessionStatus;
  message: string;
  routeName: string;
  tripShape: TripShapeMode;
  startedAt: number;
  updatedAt: number;
  routeCoords: [number, number][];
  totalDistanceMi: number | null;
  totalDurationHours: number | null;
  camps: RouteBuildSessionProgress;
  fuel: RouteBuildSessionProgress;
  previewStops: RouteBuildPreviewStop[];
  activityChoice: RouteBuildActivityChoice;
  finalTripId: string | null;
  activityOfferTripId: string | null;
  activityOfferCreatedAt: number | null;
  errorMessage: string | null;
}

export type StartRouteBuildSessionInput = Pick<
  RouteBuildSession,
  'requestId' | 'tripId' | 'routeName' | 'tripShape'
> & {
  source?: RouteBuildSessionSource;
  previewStops?: RouteBuildPreviewStop[];
};

export type RouteBuildSessionPatch = Partial<Omit<
  RouteBuildSession,
  'requestId' | 'tripId' | 'source' | 'startedAt' | 'updatedAt'
>>;

const requestControllers = new Map<string, AbortController>();
const activitySearchControllers = new Map<string, AbortController>();
const activityChoiceWaiters = new Map<string, (choice: RouteBuildActivityChoice | 'cancelled') => void>();

export function createRouteBuildRequestId(now = Date.now()) {
  return `route_build_${now}_${Math.random().toString(36).slice(2, 9)}`;
}

export function createRouteBuildSession(
  input: StartRouteBuildSessionInput,
  now = Date.now(),
): RouteBuildSession {
  return {
    requestId: input.requestId,
    tripId: input.tripId,
    source: input.source ?? 'manual_route_builder',
    phase: 'routing',
    status: 'running',
    message: 'Finding your route',
    routeName: input.routeName,
    tripShape: input.tripShape,
    startedAt: now,
    updatedAt: now,
    routeCoords: [],
    totalDistanceMi: null,
    totalDurationHours: null,
    camps: { completed: 0, total: 0 },
    fuel: { completed: 0, total: 0 },
    previewStops: input.previewStops ?? [],
    activityChoice: 'pending',
    finalTripId: null,
    activityOfferTripId: null,
    activityOfferCreatedAt: null,
    errorMessage: null,
  };
}

export function routeBuildPreviewStopsFromTrip(trip: TripResult): RouteBuildPreviewStop[] {
  const coordinates = (trip.plan?.waypoints ?? [])
    .map((waypoint, index) => {
      const lat = Number(waypoint.lat);
      const lng = Number(waypoint.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { waypoint, index, lat, lng };
    })
    .filter((value): value is NonNullable<typeof value> => value !== null);

  return coordinates.map((entry, position) => {
    const type: RouteBuildPreviewStopType = position === 0
      ? 'start'
      : position === coordinates.length - 1
        ? 'destination'
        : entry.waypoint.type === 'camp' || entry.waypoint.type === 'motel'
          ? 'camp'
          : entry.waypoint.type === 'fuel'
            ? 'fuel'
            : 'destination';
    return {
      id: `assisted-${entry.index}-${entry.waypoint.day}-${type}`,
      lat: entry.lat,
      lng: entry.lng,
      day: Math.max(1, Number(entry.waypoint.day) || 1),
      type,
      name: String(entry.waypoint.name || `Stop ${position + 1}`).trim() || `Stop ${position + 1}`,
      needsReview: entry.waypoint.needs_review === true,
    };
  });
}

export function routeBuildCoordsFromTrip(trip: TripResult): [number, number][] {
  const saved = trip.route_geometry?.coords;
  if (Array.isArray(saved) && saved.length >= 2) {
    const coordinates = saved
      .map(point => Array.isArray(point) ? [Number(point[0]), Number(point[1])] as [number, number] : null)
      .filter((point): point is [number, number] => (
        point !== null && Number.isFinite(point[0]) && Number.isFinite(point[1])
      ));
    if (coordinates.length >= 2) return coordinates;
  }
  return routeBuildPreviewStopsFromTrip(trip).map(stop => [stop.lng, stop.lat]);
}

export function updateRouteBuildSessionState(
  current: RouteBuildSession | null,
  requestId: string,
  patch: RouteBuildSessionPatch,
  now = Date.now(),
): RouteBuildSession | null {
  if (!current || current.requestId !== requestId || current.status !== 'running') return current;
  return { ...current, ...patch, updatedAt: now };
}

export function cancelRouteBuildSessionState(
  current: RouteBuildSession | null,
  requestId: string | undefined,
  now = Date.now(),
): RouteBuildSession | null {
  if (!current || (requestId && current.requestId !== requestId) || current.status !== 'running') return current;
  return {
    ...current,
    phase: 'cancelled',
    status: 'cancelled',
    message: 'Route build stopped',
    errorMessage: null,
    updatedAt: now,
  };
}

export function routeBuildSessionIsRunning(session: RouteBuildSession | null, requestId: string) {
  return session?.requestId === requestId && session.status === 'running';
}

export function openRouteBuildRequest(requestId: string): AbortSignal | undefined {
  closeRouteBuildRequest(requestId, true);
  if (typeof AbortController === 'undefined') return undefined;
  const controller = new AbortController();
  requestControllers.set(requestId, controller);
  return controller.signal;
}

export function routeBuildRequestSignal(requestId: string) {
  return requestControllers.get(requestId)?.signal;
}

export function openRouteBuildActivitySearch(requestId: string) {
  cancelRouteBuildActivitySearch(requestId);
  if (typeof AbortController === 'undefined') return undefined;
  const controller = new AbortController();
  activitySearchControllers.set(requestId, controller);
  return controller.signal;
}

export function routeBuildActivitySearchSignal(requestId: string) {
  return activitySearchControllers.get(requestId)?.signal;
}

export function cancelRouteBuildActivitySearch(requestId: string) {
  activitySearchControllers.get(requestId)?.abort();
  activitySearchControllers.delete(requestId);
}

export function closeRouteBuildRequest(requestId: string, abort = false) {
  const controller = requestControllers.get(requestId);
  if (abort) controller?.abort();
  requestControllers.delete(requestId);
  cancelRouteBuildActivitySearch(requestId);
  activityChoiceWaiters.get(requestId)?.('cancelled');
  activityChoiceWaiters.delete(requestId);
}

export function closeAllRouteBuildRequests() {
  for (const controller of requestControllers.values()) controller.abort();
  requestControllers.clear();
  for (const controller of activitySearchControllers.values()) controller.abort();
  activitySearchControllers.clear();
  for (const resolve of activityChoiceWaiters.values()) resolve('cancelled');
  activityChoiceWaiters.clear();
}

export function waitForRouteBuildActivityChoice(
  requestId: string,
): Promise<Exclude<RouteBuildActivityChoice, 'pending'> | 'cancelled'> {
  return new Promise(resolve => {
    activityChoiceWaiters.set(requestId, choice => {
      resolve(choice === 'pending' ? 'cancelled' : choice);
    });
  });
}

export function resolveRouteBuildActivityChoice(
  requestId: string,
  choice: Exclude<RouteBuildActivityChoice, 'pending'>,
) {
  const resolve = activityChoiceWaiters.get(requestId);
  if (!resolve) return false;
  activityChoiceWaiters.delete(requestId);
  resolve(choice);
  return true;
}
