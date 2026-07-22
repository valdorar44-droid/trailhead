import { useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { api, TripResult, RouteWeatherResult } from './api';
import { TRAILHEAD_API_BASE } from './apiBase';
import { useStore } from './store';
import { accountStorage } from './storage';
import {
  routeWeatherCacheEnvelope,
  routeWeatherCacheFileName,
  routeWeatherWaypointSignature,
} from './routeWeather';

const BASE = TRAILHEAD_API_BASE;
const POLL_MS = 45_000;
const PROBE_TIMEOUT_MS = 5_000;

async function probe(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    const res = await fetch(`${BASE}/api/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

interface SyncCallbacks {
  active?: boolean;
  activeTrip: TripResult | null;
  onWeatherUpdate: (weather: RouteWeatherResult) => void;
  onSyncComplete: () => void; // called when any sync succeeds (show toast)
  onReportRefresh: () => void; // called on reconnect to trigger live report re-fetch
  onReconnect?: () => void; // called once when the probe transitions to online
}

export function useConnectivitySync({
  active = true,
  activeTrip,
  onWeatherUpdate,
  onSyncComplete,
  onReportRefresh,
  onReconnect,
}: SyncCallbacks) {
  const wasOnline = useRef<boolean | null>(null); // null = unknown (first probe not done)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isSyncing = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;

  const syncWeather = useCallback(async (trip: TripResult) => {
    if (isSyncing.current) return;
    const epoch = accountStorage.epoch();
    isSyncing.current = true;
    try {
      const units = useStore.getState().weatherUnitMode;
      const weather = await api.getRouteWeather(trip.trip_id, trip.plan.waypoints, units);
      const signature = routeWeatherWaypointSignature(trip.plan.waypoints);
      const path = `${FileSystem.documentDirectory}${routeWeatherCacheFileName(
        trip.trip_id,
        units,
        signature,
      )}`;
      const stored = await accountStorage.run(async () => {
        await FileSystem.writeAsStringAsync(
          path,
          JSON.stringify(routeWeatherCacheEnvelope(weather, units, signature)),
          { encoding: FileSystem.EncodingType.UTF8 },
        );
        return true;
      }, epoch);
      if (!stored || !activeRef.current) return;
      onWeatherUpdate(weather);
      onSyncComplete();
    } catch {
      // No signal or server error — stay silent
    } finally {
      isSyncing.current = false;
    }
  }, [onWeatherUpdate, onSyncComplete]);

  const tick = useCallback(async () => {
    const tickEpoch = accountStorage.epoch();
    const tickAccountId = useStore.getState().user?.id;
    const online = await probe();
    if (
      !activeRef.current
      || accountStorage.epoch() !== tickEpoch
      || String(useStore.getState().user?.id ?? '') !== String(tickAccountId ?? '')
    ) return;
    const prevOnline = wasOnline.current;
    wasOnline.current = online;

    if (!online) return;

    // Only act on the transition from offline/unknown → online
    if (prevOnline === true) return;

    // Reconnected — sync
    onReconnect?.();
    onReportRefresh();
    if (activeTrip) {
      await syncWeather(activeTrip);
    }
  }, [activeTrip, syncWeather, onReportRefresh, onReconnect]);

  // Keep tick closure fresh (activeTrip changes)
  const tickRef = useRef(tick);
  useEffect(() => { tickRef.current = tick; }, [tick]);

  useEffect(() => {
    if (!active) {
      wasOnline.current = null;
      return;
    }
    // Start polling
    intervalRef.current = setInterval(() => tickRef.current(), POLL_MS);

    // Run once immediately on mount (catches first foreground)
    tickRef.current();

    // Re-probe when app comes back to foreground
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        // Reset so next tick treats it as a fresh reconnect check
        wasOnline.current = null;
        tickRef.current();
      }
    });

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      sub.remove();
    };
  }, [active]); // tickRef keeps the request closure current without restarting the interval
}
