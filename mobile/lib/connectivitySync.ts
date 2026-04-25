import { useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { api, TripResult, RouteWeatherResult } from './api';

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://trailhead-production-2049.up.railway.app';
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
  activeTrip: TripResult | null;
  onWeatherUpdate: (weather: RouteWeatherResult) => void;
  onSyncComplete: () => void; // called when any sync succeeds (show toast)
  onReportRefresh: () => void; // called on reconnect to trigger live report re-fetch
}

export function useConnectivitySync({
  activeTrip,
  onWeatherUpdate,
  onSyncComplete,
  onReportRefresh,
}: SyncCallbacks) {
  const wasOnline = useRef<boolean | null>(null); // null = unknown (first probe not done)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isSyncing = useRef(false);

  const syncWeather = useCallback(async (trip: TripResult) => {
    if (isSyncing.current) return;
    isSyncing.current = true;
    try {
      const weather = await api.getRouteWeather(trip.trip_id, trip.plan.waypoints);
      const path = `${FileSystem.documentDirectory}weather_${trip.trip_id}.json`;
      await FileSystem.writeAsStringAsync(path, JSON.stringify(weather), {
        encoding: FileSystem.EncodingType.UTF8,
      });
      onWeatherUpdate(weather);
      onSyncComplete();
    } catch {
      // No signal or server error — stay silent
    } finally {
      isSyncing.current = false;
    }
  }, [onWeatherUpdate, onSyncComplete]);

  const tick = useCallback(async () => {
    const online = await probe();
    const prevOnline = wasOnline.current;
    wasOnline.current = online;

    if (!online) return;

    // Only act on the transition from offline/unknown → online
    if (prevOnline === true) return;

    // Reconnected — sync
    onReportRefresh();
    if (activeTrip) {
      await syncWeather(activeTrip);
    }
  }, [activeTrip, syncWeather, onReportRefresh]);

  // Keep tick closure fresh (activeTrip changes)
  const tickRef = useRef(tick);
  useEffect(() => { tickRef.current = tick; }, [tick]);

  useEffect(() => {
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
  }, []); // run once — tickRef keeps tick current
}
