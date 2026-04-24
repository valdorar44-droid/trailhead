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
  register: (email: string, username: string, password: string, referral_code = '') =>
    req<{ token: string; user: User }>('/api/auth/register', {
      method: 'POST', body: JSON.stringify({ email, username, password, referral_code }),
    }),
  login: (email: string, password: string) =>
    req<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ email, password }),
    }),
  me: () => req<User>('/api/auth/me'),

  plan: (request: string) =>
    req<TripResult>('/api/plan', { method: 'POST', body: JSON.stringify({ request }) }),
  getTrip: (id: string) => req<TripResult>(`/api/trip/${id}`),

  submitReport: (data: ReportPayload) =>
    req<ReportResponse>('/api/reports', { method: 'POST', body: JSON.stringify(data) }),
  getNearbyReports: (lat: number, lng: number, radius = 0.5) =>
    req<Report[]>(`/api/reports?lat=${lat}&lng=${lng}&radius=${radius}`),
  getReportsAlongRoute: (waypoints: Waypoint[]) =>
    req<Report[]>('/api/reports/along-route', {
      method: 'POST', body: JSON.stringify({ waypoints }),
    }),
  upvoteReport: (id: number) => req(`/api/reports/${id}/upvote`, { method: 'POST' }),
  downvoteReport: (id: number) => req(`/api/reports/${id}/downvote`, { method: 'POST' }),
  confirmReport: (id: number) =>
    req<{ credits_earned: number; new_balance: number }>(`/api/reports/${id}/confirm`, { method: 'POST' }),

  getCredits: () => req<{ balance: number; history: CreditTransaction[] }>('/api/credits'),
  getLeaderboard: () => req<LeaderboardEntry[]>('/api/leaderboard'),

  getConfig: () => req<{ mapbox_token: string }>('/api/config'),
  getCampsites: (lat: number, lng: number, radius = 25) =>
    req<Campsite[]>(`/api/campsites?lat=${lat}&lng=${lng}&radius=${radius}`),
  searchCampsites: (lat: number, lng: number, radius = 40, types: string[] = []) =>
    req<CampsitePin[]>(`/api/campsites/search?lat=${lat}&lng=${lng}&radius=${radius}&types=${types.join(',')}`),
  getCampsiteDetail: (id: string) =>
    req<CampsiteDetail>(`/api/campsites/${id}/detail`),
  submitPin: (data: PinPayload) =>
    req('/api/pins', { method: 'POST', body: JSON.stringify(data) }),
  getNearbyPins: (lat: number, lng: number, radius = 1.0) =>
    req<Pin[]>(`/api/pins?lat=${lat}&lng=${lng}&radius=${radius}`),

  getAudioGuide: (tripId: string) =>
    req<Record<string, string>>(`/api/trip/${tripId}/guide`),
  nearbyAudio: (lat: number, lng: number, location_name = '') =>
    req<{ narration: string }>('/api/audio/nearby', {
      method: 'POST', body: JSON.stringify({ lat, lng, location_name }),
    }),

  getWeather: (lat: number, lng: number, days = 7) =>
    req<WeatherForecast>(`/api/weather?lat=${lat}&lng=${lng}&days=${days}`),
};

export interface User {
  id: number; email: string; username: string; credits: number;
  referral_code: string; report_streak: number; created_at: number;
  reporting_restricted_until?: number;
}
export interface TripResult {
  trip_id: string; plan: TripPlan; campsites: Campsite[]; gas_stations: GasStation[];
  audio_guide?: Record<string, string>;
}
export interface TripPlan {
  trip_name: string; overview: string; duration_days: number;
  states: string[]; total_est_miles: number;
  waypoints: Waypoint[]; daily_itinerary: DayPlan[]; logistics: Logistics;
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
export interface CampsitePin {
  id: string; name: string; lat: number; lng: number;
  tags: string[]; land_type: string; description: string;
  photo_url?: string; reservable: boolean; cost?: string; url: string; ada: boolean;
}
export interface CampsiteDetail extends CampsitePin {
  photos: string[]; amenities: string[]; site_types: string[];
  activities: string[]; phone?: string; campsites_count: number;
}
export interface GasStation {
  id: number; name: string; lat: number; lng: number;
  fuel_types: string; address: string;
}
export interface Report {
  id: number; lat: number; lng: number; type: string; subtype: string;
  description: string; severity: string; upvotes: number; downvotes: number;
  confirmations: number; has_photo: number; cluster_count: number;
  username: string; created_at: number; expires_at: number; waypoint_day?: number;
}
export interface ReportPayload {
  lat: number; lng: number; type: string;
  subtype?: string; description?: string; severity?: string; photo_data?: string;
}
export interface ReportResponse {
  report_id: number; credits_earned: number; new_balance: number;
  streak: number; streak_bonus: number; streak_reason: string; ttl_hours: number;
}
export interface CreditTransaction {
  id: number; amount: number; reason: string; created_at: number;
}
export interface LeaderboardEntry {
  username: string; report_count: number; total_upvotes: number; streak: number;
}
export interface Pin {
  id: number; lat: number; lng: number; name: string; type: string; description: string; land_type: string;
}
export interface PinPayload {
  lat: number; lng: number; name: string; type?: string; description?: string; land_type?: string;
}
export interface WeatherForecast {
  daily: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_sum: number[];
    windspeed_10m_max: number[];
    weathercode: number[];
  };
}
