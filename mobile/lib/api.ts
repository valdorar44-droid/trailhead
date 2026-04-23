import * as SecureStore from 'expo-secure-store';

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://trailhead-production-2049.up.railway.app';

async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync('trailhead_token');
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string> ?? {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? 'Request failed');
  }
  return res.json();
}

export const api = {
  // Auth
  register: (email: string, username: string, password: string, referral_code = '') =>
    req<{ token: string; user: User }>('/api/auth/register', {
      method: 'POST', body: JSON.stringify({ email, username, password, referral_code }),
    }),
  login: (email: string, password: string) =>
    req<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ email, password }),
    }),
  me: () => req<User>('/api/auth/me'),

  // Trips
  plan: (request: string) =>
    req<TripResult>('/api/plan', { method: 'POST', body: JSON.stringify({ request }) }),
  getTrip: (id: string) => req<TripResult>(`/api/trip/${id}`),

  // Reports
  submitReport: (data: ReportPayload) =>
    req<{ report_id: number; credits_earned: number; new_balance: number }>('/api/reports', {
      method: 'POST', body: JSON.stringify(data),
    }),
  getNearbyReports: (lat: number, lng: number, radius = 0.5) =>
    req<Report[]>(`/api/reports?lat=${lat}&lng=${lng}&radius=${radius}`),
  upvoteReport: (id: number) =>
    req(`/api/reports/${id}/upvote`, { method: 'POST' }),
  downvoteReport: (id: number) =>
    req(`/api/reports/${id}/downvote`, { method: 'POST' }),

  // Credits
  getCredits: () => req<{ balance: number; history: CreditTransaction[] }>('/api/credits'),

  // Campsites
  getCampsites: (lat: number, lng: number, radius = 25) =>
    req<Campsite[]>(`/api/campsites?lat=${lat}&lng=${lng}&radius=${radius}`),

  // Community pins
  submitPin: (data: PinPayload) =>
    req('/api/pins', { method: 'POST', body: JSON.stringify(data) }),
  getNearbyPins: (lat: number, lng: number) =>
    req<Pin[]>(`/api/pins?lat=${lat}&lng=${lng}`),
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface User {
  id: number; email: string; username: string;
  credits: number; referral_code: string; created_at: number;
}

export interface TripResult {
  trip_id: string;
  plan: TripPlan;
  campsites: Campsite[];
  gas_stations: GasStation[];
}

export interface TripPlan {
  trip_name: string; overview: string; duration_days: number;
  states: string[]; total_est_miles: number;
  waypoints: Waypoint[];
  daily_itinerary: DayPlan[];
  logistics: Logistics;
}

export interface Waypoint {
  day: number; name: string; type: string; description: string;
  land_type: string; notes?: string; lat?: number; lng?: number;
}

export interface DayPlan {
  day: number; title: string; description: string;
  est_miles: number; road_type: string; highlights: string[];
}

export interface Logistics {
  vehicle_recommendation: string; fuel_strategy: string;
  water_strategy: string; permits_needed: string; best_season: string;
}

export interface Campsite {
  id: string; name: string; lat: number; lng: number;
  reservable: boolean; description: string; url: string;
}

export interface GasStation {
  id: number; name: string; lat: number; lng: number;
  fuel_types: string; address: string;
}

export interface Report {
  id: number; lat: number; lng: number; type: string; subtype: string;
  description: string; severity: string; upvotes: number; downvotes: number;
  username: string; created_at: number;
}

export interface ReportPayload {
  lat: number; lng: number; type: string;
  subtype?: string; description?: string; severity?: string;
}

export interface CreditTransaction {
  id: number; amount: number; reason: string; created_at: number;
}

export interface Pin {
  id: number; lat: number; lng: number; name: string;
  type: string; description: string; land_type: string;
}

export interface PinPayload {
  lat: number; lng: number; name: string;
  type?: string; description?: string; land_type?: string;
}
