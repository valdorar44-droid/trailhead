import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { User, TripResult } from './api';

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
  setAuth: (token: string, user: User) => void;
  clearAuth: () => void;
  setActiveTrip: (trip: TripResult | null) => void;
  setRigProfile: (rig: RigProfile) => void;
  addTripToHistory: (item: TripHistoryItem) => void;
}

export const useStore = create<AppState>((set) => ({
  user: null,
  token: null,
  activeTrip: null,
  rigProfile: null,
  tripHistory: [],

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
}));

// Load persisted rig profile + trip history on startup (session is restored by _layout.tsx)
(async () => {
  try {
    const [rigRaw, historyRaw] = await Promise.all([
      SecureStore.getItemAsync('trailhead_rig'),
      SecureStore.getItemAsync('trailhead_history'),
    ]);
    const patch: { rigProfile?: RigProfile; tripHistory?: TripHistoryItem[] } = {};
    if (rigRaw) patch.rigProfile = JSON.parse(rigRaw);
    if (historyRaw) patch.tripHistory = JSON.parse(historyRaw);
    if (Object.keys(patch).length > 0) useStore.setState(patch);
  } catch {}
})();
