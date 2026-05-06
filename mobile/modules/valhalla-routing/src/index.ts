import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

type ValhallaRoutingModule = {
  route(packPath: string, requestJson: string): Promise<string>;
  diagnose(packPath: string, requestJson: string): Promise<string>;
  routeTrailGraph(graphPath: string, requestJson: string): Promise<string>;
};

const NativeValhallaRouting = requireOptionalNativeModule<ValhallaRoutingModule>('ValhallaRoutingModule');

export type TrailheadNavigationState = {
  active?: boolean;
  follow?: boolean;
  reason?: string;
  lat?: number;
  lng?: number;
  speed?: number | null;
  heading?: number | null;
  distanceM?: number;
  remainingM?: number;
  routeDistanceM?: number;
  deviationM?: number;
  segmentIdx?: number;
  offRoute?: boolean;
  warnOffRoute?: boolean;
  projectedLng?: number;
  projectedLat?: number;
  passedSegmentIdx?: number;
  passedProgressM?: number;
  offRouteStreak?: number;
};

type TrailheadNavigationModule = {
  startSession(routeCoords: [number, number][], follow: boolean): Promise<TrailheadNavigationState>;
  stopSession(): Promise<TrailheadNavigationState>;
  setFollow(enabled: boolean): Promise<TrailheadNavigationState>;
  updateLocation(lat: number, lng: number, accuracy?: number | null, speed?: number | null, heading?: number | null): Promise<TrailheadNavigationState>;
  getSnapshot(): Promise<TrailheadNavigationState>;
  addListener(eventName: 'onNavigationState', listener: (state: TrailheadNavigationState) => void): EventSubscription;
};

const NativeTrailheadNavigation = requireOptionalNativeModule<TrailheadNavigationModule>('TrailheadNavigationModule');

export function routeValhalla(packPath: string, requestJson: string): Promise<string> {
  if (!NativeValhallaRouting) {
    return Promise.reject(new Error('ValhallaRoutingModule is not linked in this binary'));
  }
  return NativeValhallaRouting.route(packPath, requestJson);
}

export function diagnoseValhalla(packPath: string, requestJson: string): Promise<string> {
  if (!NativeValhallaRouting || typeof NativeValhallaRouting.diagnose !== 'function') {
    return Promise.resolve('native-diag: diagnose is not linked in this binary');
  }
  return NativeValhallaRouting.diagnose(packPath, requestJson);
}

export function routeTrailGraph(graphPath: string, requestJson: string): Promise<string> {
  if (!NativeValhallaRouting || typeof NativeValhallaRouting.routeTrailGraph !== 'function') {
    return Promise.reject(new Error('Trail route graph routing is not linked in this binary'));
  }
  return NativeValhallaRouting.routeTrailGraph(graphPath, requestJson);
}

export function hasNativeNavigationEngine(): boolean {
  return !!NativeTrailheadNavigation;
}

export function startNavigationSession(routeCoords: [number, number][], follow = true): Promise<TrailheadNavigationState> {
  if (!NativeTrailheadNavigation) return Promise.reject(new Error('TrailheadNavigationModule is not linked in this binary'));
  return NativeTrailheadNavigation.startSession(routeCoords, follow);
}

export function stopNavigationSession(): Promise<TrailheadNavigationState> {
  if (!NativeTrailheadNavigation) return Promise.resolve({ active: false, follow: false, reason: 'unlinked' });
  return NativeTrailheadNavigation.stopSession();
}

export function setNavigationFollow(enabled: boolean): Promise<TrailheadNavigationState> {
  if (!NativeTrailheadNavigation) return Promise.resolve({ active: false, follow: false, reason: 'unlinked' });
  return NativeTrailheadNavigation.setFollow(enabled);
}

export function updateNavigationLocation(
  lat: number,
  lng: number,
  accuracy?: number | null,
  speed?: number | null,
  heading?: number | null,
): Promise<TrailheadNavigationState> {
  if (!NativeTrailheadNavigation) return Promise.resolve({ active: false, reason: 'unlinked' });
  return NativeTrailheadNavigation.updateLocation(lat, lng, accuracy ?? null, speed ?? null, heading ?? null);
}

export function addNavigationStateListener(listener: (state: TrailheadNavigationState) => void): EventSubscription | null {
  return NativeTrailheadNavigation?.addListener('onNavigationState', listener) ?? null;
}
