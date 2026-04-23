import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { User, TripResult } from './api';

interface AppState {
  user: User | null;
  token: string | null;
  activeTrip: TripResult | null;
  setAuth: (token: string, user: User) => void;
  clearAuth: () => void;
  setActiveTrip: (trip: TripResult | null) => void;
}

export const useStore = create<AppState>((set) => ({
  user: null,
  token: null,
  activeTrip: null,

  setAuth: (token, user) => {
    SecureStore.setItemAsync('trailhead_token', token);
    set({ token, user });
  },

  clearAuth: () => {
    SecureStore.deleteItemAsync('trailhead_token');
    set({ token: null, user: null });
  },

  setActiveTrip: (trip) => set({ activeTrip: trip }),
}));
