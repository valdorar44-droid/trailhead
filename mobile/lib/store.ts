import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { User, TripResult, Report } from './api';

export interface RigProfile {
  vehicle_type: string;
  year: string;
  make: string;
  model: string;
  ground_clearance_in: string;
  lift_in: string;
  drive: string;
  length_ft: string;
}

export interface TripHistoryItem {
  trip_id: string;
  trip_name: string;
  states: string[];
  duration_days: number;
  est_miles: number;
  planned_at: number;
}

interface AppState {
  user: User | null;
  token: string | null;
  activeTrip: TripResult | null;
  rigProfile: RigProfile | null;
  tripHistory: TripHistoryItem[];
  themeMode: 'light' | 'dark';
  userLoc: { lat: number; lng: number } | null;
  mapboxToken: string;
  sessionId: string;
  liveReports: Report[];
  cachedRegions: string[];
  setAuth: (token: string, user: User) => void;
  clearAuth: () => void;
  setActiveTrip: (trip: TripResult | null) => void;
  setRigProfile: (rig: RigProfile) => void;
  addTripToHistory: (item: TripHistoryItem) => void;
  setThemeMode: (mode: 'light' | 'dark') => void;
  setUserLoc: (loc: { lat: number; lng: number } | null) => void;
  setMapboxToken: (token: string) => void;
  setSessionId: (id: string) => void;
  addLiveReport: (report: Report) => void;
  setLiveReports: (reports: Report[]) => void;
  addCachedRegion: (label: string) => void;
}

export const useStore = create<AppState>((set) => ({
  user: null,
  token: null,
  activeTrip: null,
  rigProfile: null,
  tripHistory: [],
  themeMode: 'light',
  userLoc: null,
  mapboxToken: '',
  sessionId: 'sess_' + Math.random().toString(36).slice(2, 12),
  liveReports: [],
  cachedRegions: [],

  setAuth: (token, user) => {
    SecureStore.setItemAsync('trailhead_token', token);
    set({ token, user });
  },

  clearAuth: () => {
    SecureStore.deleteItemAsync('trailhead_token');
    set({ token: null, user: null, activeTrip: null });
  },

  setActiveTrip: (trip) => set({ activeTrip: trip }),

  setRigProfile: (rig) => {
    SecureStore.setItemAsync('trailhead_rig', JSON.stringify(rig));
    set({ rigProfile: rig });
  },

  addTripToHistory: (item) => set((state) => {
    const updated = [item, ...state.tripHistory.filter(t => t.trip_id !== item.trip_id)].slice(0, 10);
    SecureStore.setItemAsync('trailhead_history', JSON.stringify(updated));
    return { tripHistory: updated };
  }),

  setThemeMode: (mode) => {
    SecureStore.setItemAsync('trailhead_theme', mode);
    set({ themeMode: mode });
  },

  setUserLoc: (loc) => set({ userLoc: loc }),
  setMapboxToken: (token) => set({ mapboxToken: token }),
  addLiveReport: (report) => set(state => ({
    liveReports: [report, ...state.liveReports.filter(r => r.id !== report.id)].slice(0, 100),
  })),
  setLiveReports: (reports) => set({ liveReports: reports }),
  addCachedRegion: (label) => set(state => ({
    cachedRegions: [label, ...state.cachedRegions.filter(r => r !== label)].slice(0, 20),
  })),
  setSessionId: (id) => {
    SecureStore.setItemAsync('trailhead_session', id);
    set({ sessionId: id });
  },
}));

// Load persisted data on startup
(async () => {
  try {
    const [rigRaw, historyRaw, themeRaw, sessionRaw] = await Promise.all([
      SecureStore.getItemAsync('trailhead_rig'),
      SecureStore.getItemAsync('trailhead_history'),
      SecureStore.getItemAsync('trailhead_theme'),
      SecureStore.getItemAsync('trailhead_session'),
    ]);
    const patch: Partial<AppState> = {};
    if (rigRaw) patch.rigProfile = JSON.parse(rigRaw);
    if (historyRaw) patch.tripHistory = JSON.parse(historyRaw);
    if (themeRaw === 'dark' || themeRaw === 'light') patch.themeMode = themeRaw;
    if (sessionRaw) patch.sessionId = sessionRaw;
    else {
      // First run — persist the generated ID
      const id = useStore.getState().sessionId;
      SecureStore.setItemAsync('trailhead_session', id);
    }
    if (Object.keys(patch).length > 0) useStore.setState(patch);
  } catch {}
})();
