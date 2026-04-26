import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { User, TripResult, Report, CampsitePin } from './api';

export interface RigProfile {
  vehicle_type: string;
  year: string;
  make: string;
  model: string;
  trim?: string;
  drive: string;
  lift_in: string;
  suspension?: string;
  tire_size?: string;
  ground_clearance_in: string;
  length_ft: string;
  fuel_range_miles?: string;
  has_winch?: boolean;
  winch_lbs?: string;
  locking_diffs?: string;
  has_skids?: boolean;
  has_rack?: boolean;
  is_towing?: boolean;
  trailer_length_ft?: string;
  tow_capacity_lbs?: string;
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
  favoriteCamps: CampsitePin[];
  offlineTripIds: string[];
  activeTripFromCache: boolean;
  hasPlan: boolean;
  planExpiresAt: number | null;
  setAuth: (token: string, user: User) => void;
  clearAuth: () => void;
  setActiveTrip: (trip: TripResult | null, fromCache?: boolean) => void;
  setRigProfile: (rig: RigProfile) => void;
  addTripToHistory: (item: TripHistoryItem) => void;
  setThemeMode: (mode: 'light' | 'dark') => void;
  setUserLoc: (loc: { lat: number; lng: number } | null) => void;
  setMapboxToken: (token: string) => void;
  setSessionId: (id: string) => void;
  addLiveReport: (report: Report) => void;
  setLiveReports: (reports: Report[]) => void;
  addCachedRegion: (label: string) => void;
  toggleFavorite: (camp: CampsitePin) => void;
  setOfflineTripIds: (ids: string[]) => void;
  setPlan: (active: boolean, expiresAt?: number | null) => void;
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
  favoriteCamps: [],
  offlineTripIds: [],
  activeTripFromCache: false,
  hasPlan: false,
  planExpiresAt: null,

  setAuth: (token, user) => {
    SecureStore.setItemAsync('trailhead_token', token);
    // Reset all user-specific state so a newly logged-in user never sees
    // a previous user's rig, history, or favorites still in memory.
    set({
      token, user,
      activeTrip: null,
      rigProfile: null,
      tripHistory: [],
      favoriteCamps: [],
      hasPlan: false,
      planExpiresAt: null,
    });
  },

  clearAuth: () => {
    // Wipe token AND all user-specific device storage so the next user
    // who logs in on this device starts with a clean slate.
    SecureStore.deleteItemAsync('trailhead_token');
    SecureStore.deleteItemAsync('trailhead_rig');
    SecureStore.deleteItemAsync('trailhead_history');
    SecureStore.deleteItemAsync('trailhead_favorites');
    set({
      token: null,
      user: null,
      activeTrip: null,
      rigProfile: null,
      tripHistory: [],
      favoriteCamps: [],
      hasPlan: false,
      planExpiresAt: null,
    });
  },

  setActiveTrip: (trip, fromCache = false) => set({ activeTrip: trip, activeTripFromCache: fromCache }),

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

  setOfflineTripIds: (ids) => set({ offlineTripIds: ids }),
  setPlan: (active, expiresAt = null) => set({ hasPlan: active, planExpiresAt: expiresAt }),

  toggleFavorite: (camp) => set((state) => {
    const exists = state.favoriteCamps.some(f => f.id === camp.id);
    const updated = exists
      ? state.favoriteCamps.filter(f => f.id !== camp.id)
      : [camp, ...state.favoriteCamps].slice(0, 50);
    SecureStore.setItemAsync('trailhead_favorites', JSON.stringify(updated));
    return { favoriteCamps: updated };
  }),
}));

// Load persisted data on startup
(async () => {
  try {
    const [rigRaw, historyRaw, themeRaw, sessionRaw, favRaw] = await Promise.all([
      SecureStore.getItemAsync('trailhead_rig'),
      SecureStore.getItemAsync('trailhead_history'),
      SecureStore.getItemAsync('trailhead_theme'),
      SecureStore.getItemAsync('trailhead_session'),
      SecureStore.getItemAsync('trailhead_favorites'),
    ]);
    const patch: Partial<AppState> = {};
    if (rigRaw) patch.rigProfile = JSON.parse(rigRaw);
    if (historyRaw) patch.tripHistory = JSON.parse(historyRaw);
    if (themeRaw === 'dark' || themeRaw === 'light') patch.themeMode = themeRaw;
    if (favRaw) patch.favoriteCamps = JSON.parse(favRaw);
    if (sessionRaw) patch.sessionId = sessionRaw;
    else {
      // First run — persist the generated ID
      const id = useStore.getState().sessionId;
      SecureStore.setItemAsync('trailhead_session', id);
    }
    if (Object.keys(patch).length > 0) useStore.setState(patch);
  } catch {}
})();
