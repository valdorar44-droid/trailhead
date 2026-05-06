import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system';
import { User, TripResult, Report, CampsitePin } from './api';

// File-based trip storage — no 2KB SecureStore limit
const TRIP_FILE = () => `${FileSystem.documentDirectory}active_trip.json`;
const saveTripFile  = (trip: TripResult) => FileSystem.writeAsStringAsync(TRIP_FILE(), JSON.stringify(trip)).catch(() => {});
const loadTripFile  = async (): Promise<TripResult | null> => {
  try { const raw = await FileSystem.readAsStringAsync(TRIP_FILE()); return JSON.parse(raw); } catch { return null; }
};
const deleteTripFile = () => FileSystem.deleteAsync(TRIP_FILE(), { idempotent: true }).catch(() => {});
const RIG_FILE = () => `${FileSystem.documentDirectory}rig_profile.json`;
const saveRigFile = (rig: RigProfile) => FileSystem.writeAsStringAsync(RIG_FILE(), JSON.stringify(rig)).catch(() => {});
const loadRigFile = async (): Promise<RigProfile | null> => {
  try { const raw = await FileSystem.readAsStringAsync(RIG_FILE()); return JSON.parse(raw); } catch { return null; }
};
const deleteRigFile = () => FileSystem.deleteAsync(RIG_FILE(), { idempotent: true }).catch(() => {});
const PLAN_KEY = 'trailhead_plan';

// Keep all keychain items on this device only — prevents iOS from prompting
// "Sign into Apple account" to sync with iCloud Keychain.
const KCO = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const hasWebStorage = () => typeof window !== 'undefined' && !!window.localStorage;
const ss = (key: string, val: string) => {
  if (hasWebStorage()) {
    window.localStorage.setItem(key, val);
    return Promise.resolve();
  }
  return SecureStore.setItemAsync(key, val, KCO);
};
const sg = (key: string) => {
  if (hasWebStorage()) return Promise.resolve(window.localStorage.getItem(key));
  return SecureStore.getItemAsync(key, KCO);
};
const sd = (key: string) => {
  if (hasWebStorage()) {
    window.localStorage.removeItem(key);
    return Promise.resolve();
  }
  return SecureStore.deleteItemAsync(key, KCO);
};
const newSessionId = () => 'sess_' + Math.random().toString(36).slice(2, 12);

export interface SavedPlace {
  id: string;
  name: string;
  lat: number;
  lng: number;
  icon: 'star' | 'camp' | 'flag' | 'water' | 'fuel' | 'pin';
  groupId?: string;
  note?: string;
  createdAt: number;
}

export interface MarkerGroup {
  id: string;
  name: string;
  color: string;
  icon: string;
  visible: boolean;
  createdAt: number;
}

export interface SearchHistoryItem {
  name: string;
  lat: number;
  lng: number;
  searchedAt: number;
}

export interface TourTargetRect {
  left: number;
  top: number;
  width: number;
  height: number;
  updatedAt: number;
}

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
  fuel_mpg?: string;
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
  savedPlaces: SavedPlace[];
  markerGroups: MarkerGroup[];
  searchHistory: SearchHistoryItem[];
  offlineTripIds: string[];
  activeTripFromCache: boolean;
  tabBarHidden: boolean;
  hasPlan: boolean;
  planExpiresAt: number | null;
  guidedTourRunId: number;
  tourTargets: Record<string, TourTargetRect>;
  setAuth: (token: string, user: User) => void;
  clearAuth: () => void;
  setActiveTrip: (trip: TripResult | null, fromCache?: boolean) => void;
  setTabBarHidden: (hidden: boolean) => void;
  setRigProfile: (rig: RigProfile) => void;
  addTripToHistory: (item: TripHistoryItem) => void;
  removeTripFromHistory: (tripId: string) => void;
  setThemeMode: (mode: 'light' | 'dark') => void;
  setUserLoc: (loc: { lat: number; lng: number } | null) => void;
  setMapboxToken: (token: string) => void;
  setSessionId: (id: string) => void;
  addLiveReport: (report: Report) => void;
  setLiveReports: (reports: Report[]) => void;
  addCachedRegion: (label: string) => void;
  removeCachedRegion: (label: string) => void;
  toggleFavorite: (camp: CampsitePin) => void;
  addSavedPlace: (p: SavedPlace) => void;
  removeSavedPlace: (id: string) => void;
  addMarkerGroup: (g: MarkerGroup) => void;
  updateMarkerGroup: (id: string, updates: Partial<MarkerGroup>) => void;
  removeMarkerGroup: (id: string) => void;
  addSearchHistory: (item: SearchHistoryItem) => void;
  clearSearchHistory: () => void;
  setOfflineTripIds: (ids: string[]) => void;
  setPlan: (active: boolean, expiresAt?: number | null) => void;
  startGuidedTour: () => void;
  setTourTarget: (key: string, rect: Omit<TourTargetRect, 'updatedAt'> | null) => void;
  restoreActiveTrip: () => Promise<void>;
}

export const useStore = create<AppState>((set) => ({
  user: null,
  token: null,
  activeTrip: null,
  rigProfile: null,
  tripHistory: [],
  themeMode: 'dark',
  userLoc: null,
  mapboxToken: '',
  sessionId: 'sess_' + Math.random().toString(36).slice(2, 12),
  liveReports: [],
  cachedRegions: [],
  favoriteCamps: [],
  savedPlaces: [],
  markerGroups: [],
  searchHistory: [],
  offlineTripIds: [],
  activeTripFromCache: false,
  tabBarHidden: false,
  hasPlan: false,
  planExpiresAt: null,
  guidedTourRunId: 0,
  tourTargets: {},

  setAuth: (token, user) => {
    ss('trailhead_token', token);
    ss('trailhead_user', JSON.stringify(user));
    set((state) => ({
      token, user,
      activeTrip: state.activeTrip,
      rigProfile: state.rigProfile,
      tripHistory: state.tripHistory,
      favoriteCamps: state.favoriteCamps,
    }));
  },

  clearAuth: () => {
    const freshSession = newSessionId();
    sd('trailhead_token');
    sd('trailhead_user');
    sd('trailhead_rig');
    sd('trailhead_history');
    sd('trailhead_favorites');
    sd('trailhead_active_trip');
    sd('trailhead_active_route');
    sd(PLAN_KEY);
    sd('trailhead_iap_pending');
    ss('trailhead_session', freshSession);
    deleteTripFile(); // clear file-based trip storage too
    deleteRigFile();
    set({
      token: null,
      user: null,
      activeTrip: null,
      rigProfile: null,
      tripHistory: [],
      favoriteCamps: [],
      sessionId: freshSession,
      hasPlan: false,
      planExpiresAt: null,
    });
  },

  setActiveTrip: (trip, fromCache = false) => {
    deleteTripFile();
    sd('trailhead_active_route');
    set({ activeTrip: trip, activeTripFromCache: fromCache });
  },

  setTabBarHidden: (hidden) => set({ tabBarHidden: hidden }),

  setRigProfile: (rig) => {
    ss('trailhead_rig', JSON.stringify(rig));
    saveRigFile(rig);
    set({ rigProfile: rig });
  },

  addTripToHistory: (item) => set((state) => {
    const updated = [item, ...state.tripHistory.filter(t => t.trip_id !== item.trip_id)].slice(0, 10);
    ss('trailhead_history', JSON.stringify(updated));
    return { tripHistory: updated };
  }),

  removeTripFromHistory: (tripId) => set((state) => {
    const updated = state.tripHistory.filter(t => t.trip_id !== tripId);
    ss('trailhead_history', JSON.stringify(updated));
    return {
      tripHistory: updated,
      activeTrip: state.activeTrip?.trip_id === tripId ? null : state.activeTrip,
      activeTripFromCache: state.activeTrip?.trip_id === tripId ? false : state.activeTripFromCache,
    };
  }),

  setThemeMode: (mode) => {
    ss('trailhead_theme', mode);
    set({ themeMode: mode });
  },

  setUserLoc: (loc) => set({ userLoc: loc }),
  setMapboxToken: (token) => set({ mapboxToken: token }),
  addLiveReport: (report) => set(state => ({
    liveReports: [report, ...state.liveReports.filter(r => r.id !== report.id)].slice(0, 100),
  })),
  setLiveReports: (reports) => set({ liveReports: reports }),
  addCachedRegion: (label) => set(state => {
    const updated = [label, ...state.cachedRegions.filter(r => r !== label)].slice(0, 20);
    ss('trailhead_cached_regions', JSON.stringify(updated));
    return { cachedRegions: updated };
  }),
  removeCachedRegion: (label) => set(state => {
    const updated = state.cachedRegions.filter(r => r !== label);
    ss('trailhead_cached_regions', JSON.stringify(updated));
    return { cachedRegions: updated };
  }),
  setSessionId: (id) => {
    ss('trailhead_session', id);
    set({ sessionId: id });
  },

  setOfflineTripIds: (ids) => set({ offlineTripIds: ids }),
  setPlan: (active, expiresAt = null) => {
    if (active) ss(PLAN_KEY, JSON.stringify({ active: true, expiresAt: expiresAt ?? null, updatedAt: Date.now() }));
    else sd(PLAN_KEY);
    set({ hasPlan: active, planExpiresAt: expiresAt });
  },
  startGuidedTour: () => set(state => ({ guidedTourRunId: state.guidedTourRunId + 1 })),
  setTourTarget: (key, rect) => set((state) => {
    const next = { ...state.tourTargets };
    if (!rect) delete next[key];
    else next[key] = { ...rect, updatedAt: Date.now() };
    return { tourTargets: next };
  }),

  restoreActiveTrip: async () => {
    const trip = await loadTripFile();
    if (trip) set({ activeTrip: trip });
  },

  toggleFavorite: (camp) => set((state) => {
    const exists = state.favoriteCamps.some(f => f.id === camp.id);
    const updated = exists
      ? state.favoriteCamps.filter(f => f.id !== camp.id)
      : [camp, ...state.favoriteCamps].slice(0, 50);
    ss('trailhead_favorites', JSON.stringify(updated));
    return { favoriteCamps: updated };
  }),

  addSavedPlace: (p) => set((state) => {
    const updated = [p, ...state.savedPlaces.filter(x => x.id !== p.id)].slice(0, 200);
    ss('trailhead_saved_places', JSON.stringify(updated));
    return { savedPlaces: updated };
  }),
  removeSavedPlace: (id) => set((state) => {
    const updated = state.savedPlaces.filter(x => x.id !== id);
    ss('trailhead_saved_places', JSON.stringify(updated));
    return { savedPlaces: updated };
  }),

  addMarkerGroup: (g) => set((state) => {
    const updated = [...state.markerGroups, g];
    ss('trailhead_marker_groups', JSON.stringify(updated));
    return { markerGroups: updated };
  }),
  updateMarkerGroup: (id, updates) => set((state) => {
    const updated = state.markerGroups.map(g => g.id === id ? { ...g, ...updates } : g);
    ss('trailhead_marker_groups', JSON.stringify(updated));
    return { markerGroups: updated };
  }),
  removeMarkerGroup: (id) => set((state) => {
    const updated = state.markerGroups.filter(g => g.id !== id);
    ss('trailhead_marker_groups', JSON.stringify(updated));
    return { savedPlaces: state.savedPlaces.filter(p => p.groupId !== id), markerGroups: updated };
  }),

  addSearchHistory: (item) => set((state) => {
    const deduped = state.searchHistory.filter(h => h.name !== item.name);
    const updated = [item, ...deduped].slice(0, 30);
    ss('trailhead_search_history', JSON.stringify(updated));
    return { searchHistory: updated };
  }),
  clearSearchHistory: () => {
    sd('trailhead_search_history');
    set({ searchHistory: [] });
  },
}));

// Load persisted data on startup
(async () => {
  try {
    const [rigRaw, historyRaw, themeRaw, sessionRaw, favRaw, cachedRegionsRaw, activeTripRaw, planRaw,
           savedPlacesRaw, markerGroupsRaw, searchHistoryRaw, tokenRaw, userRaw] = await Promise.all([
      sg('trailhead_rig'),
      sg('trailhead_history'),
      sg('trailhead_theme'),
      sg('trailhead_session'),
      sg('trailhead_favorites'),
      sg('trailhead_cached_regions'),
      sg('trailhead_active_trip'),
      sg(PLAN_KEY),
      sg('trailhead_saved_places'),
      sg('trailhead_marker_groups'),
      sg('trailhead_search_history'),
      sg('trailhead_token'),
      sg('trailhead_user'),
    ]);
    const patch: Partial<AppState> = {};
    // Restore auth session — keeps user logged in across app launches
    if (tokenRaw) patch.token = tokenRaw;
    if (userRaw) { try { patch.user = JSON.parse(userRaw); } catch {} }
    const rigFromFile = !rigRaw ? await loadRigFile() : null;
    if (rigRaw) {
      const rig = JSON.parse(rigRaw) as RigProfile;
      patch.rigProfile = rig;
      saveRigFile(rig);
    } else if (rigFromFile) {
      patch.rigProfile = rigFromFile;
      ss('trailhead_rig', JSON.stringify(rigFromFile));
    }
    if (historyRaw) patch.tripHistory = JSON.parse(historyRaw);
    patch.themeMode = 'dark';
    if (favRaw) patch.favoriteCamps = JSON.parse(favRaw);
    if (cachedRegionsRaw) patch.cachedRegions = JSON.parse(cachedRegionsRaw);
    if (savedPlacesRaw) patch.savedPlaces = JSON.parse(savedPlacesRaw);
    if (markerGroupsRaw) patch.markerGroups = JSON.parse(markerGroupsRaw);
    if (searchHistoryRaw) patch.searchHistory = JSON.parse(searchHistoryRaw);
    if (sessionRaw) patch.sessionId = sessionRaw;
    if (planRaw) {
      try {
        const cached = JSON.parse(planRaw);
        const expiresAt = Number(cached.expiresAt ?? 0);
        if (cached.active && (!expiresAt || expiresAt * 1000 > Date.now())) {
          patch.hasPlan = true;
          patch.planExpiresAt = cached.expiresAt ?? null;
        } else {
          sd(PLAN_KEY);
        }
      } catch {
        sd(PLAN_KEY);
      }
    }
    deleteTripFile();
    if (activeTripRaw) sd('trailhead_active_trip');
    if (!sessionRaw) {
      // First run — persist the generated ID
      const id = useStore.getState().sessionId;
      ss('trailhead_session', id);
    }
    if (Object.keys(patch).length > 0) useStore.setState(patch);
  } catch {}
})();
