import { storage } from './storage';

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.gettrailhead.app';

async function getToken(): Promise<string | null> {
  return storage.get('trailhead_token');
}

export class PaywallError extends Error {
  code: string;
  creditsNeeded?: number;
  constructor(message: string, code: string, creditsNeeded?: number) {
    super(message);
    this.name = 'PaywallError';
    this.code = code;
    this.creditsNeeded = creditsNeeded;
  }
}

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(message: string, status: number, detail?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
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
    const detail = err.detail;
    // Structured paywall response
    if (res.status === 402 && detail && typeof detail === 'object' && detail.earn_hint) {
      throw new PaywallError(detail.message ?? 'Feature requires credits or a plan.', detail.code ?? 'paywall', detail.credits_needed);
    }
    const msg = typeof detail === 'string' ? detail : (detail?.message ?? 'Request failed');
    throw new ApiError(msg, res.status, detail);
  }
  return res.json();
}

export const api = {
  register: (email: string, username: string, password: string, referral_code = '') =>
    req<{ token?: string; user?: User; needs_verification?: boolean; email?: string; message?: string }>('/api/auth/register', {
      method: 'POST', body: JSON.stringify({ email, username, password, referral_code }),
    }),
  login: (email: string, password: string) =>
    req<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ email, password }),
    }),
  verifyEmail: (token: string) =>
    req<{ token: string; user: User }>('/api/auth/verify-email', {
      method: 'POST', body: JSON.stringify({ token }),
    }),
  resendVerification: (email: string) =>
    req<{ ok: boolean; message: string }>('/api/auth/resend-verification', {
      method: 'POST', body: JSON.stringify({ email }),
    }),
  forgotPassword: (email: string) =>
    req<{ ok: boolean; message: string }>('/api/auth/forgot-password', {
      method: 'POST', body: JSON.stringify({ email }),
    }),
  me: () => req<User>('/api/auth/me'),

  plan: (request: string, sessionId = '') =>
    req<{ job_id: string; status: string }>('/api/plan', { method: 'POST', body: JSON.stringify({ request, session_id: sessionId }) }),

  // Submit plan job and poll until done (max 6 min). Safe if app backgrounds —
  // server completes the job and sends a push notification as a fallback.
  planFromSession: async (sessionId: string): Promise<TripResult> => {
    const { job_id } = await req<{ job_id: string; status: string }>(
      '/api/plan', { method: 'POST', body: JSON.stringify({ request: '', session_id: sessionId }) }
    );
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const job = await req<{ job_id: string; status: string; result: TripResult | null; error: string | null }>(
        `/api/plan/job/${job_id}`
      );
      if (job.status === 'done' && job.result) return job.result;
      if (job.status === 'failed') throw new Error(job.error ?? 'Planning failed — please try again');
    }
    throw new Error('Trip planning is taking longer than usual — check back in a moment');
  },

  getPlanJob: (jobId: string) =>
    req<{ job_id: string; status: string; result: TripResult | null; error: string | null }>(
      `/api/plan/job/${jobId}`
    ),

  registerPushToken: (token: string) =>
    req('/api/push-token', { method: 'POST', body: JSON.stringify({ token }) }),
  chat: (message: string, sessionId: string, currentTrip?: TripResult | null, rigContext?: Record<string, unknown> | null) =>
    req<ChatResponse>('/api/chat', { method: 'POST', body: JSON.stringify({ message, session_id: sessionId, current_trip: currentTrip ?? undefined, rig_context: rigContext ?? undefined }) }),
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
  getCreditPackages: () => req<CreditPackage[]>('/api/credits/packages'),
  createCheckout: (package_id: string) =>
    req<{ url: string; session_id: string }>('/api/credits/checkout', {
      method: 'POST', body: JSON.stringify({ package_id }),
    }),
  getLeaderboard: () => req<LeaderboardEntry[]>('/api/leaderboard'),

  deleteAccount: () => req<{ deleted: boolean }>('/api/auth/me', { method: 'DELETE' }),

  // Admin-only
  adminDeleteReport: (reportId: number) => req<{ ok: boolean }>(`/api/admin/reports/${reportId}`, { method: 'DELETE' }),
  adminRemovePhoto:  (reportId: number) => req<{ ok: boolean }>(`/api/admin/reports/${reportId}/remove-photo`, { method: 'POST' }),
  adminExpireReport: (reportId: number) => req<{ ok: boolean }>(`/api/admin/reports/${reportId}/expire`, { method: 'POST' }),
  getConfig: () => req<{ mapbox_token: string; protomaps_key?: string }>('/api/config'),
  getCampsites: (lat: number, lng: number, radius = 25) =>
    req<Campsite[]>(`/api/campsites?lat=${lat}&lng=${lng}&radius=${radius}`),
  searchCampsites: (lat: number, lng: number, radius = 40, types: string[] = []) =>
    req<CampsitePin[]>(`/api/campsites/search?lat=${lat}&lng=${lng}&radius=${radius}&types=${types.join(',')}`),
  getGas: (lat: number, lng: number, radius = 25) =>
    req<GasStation[]>(`/api/gas?lat=${lat}&lng=${lng}&radius=${radius}`),
  getCampsiteDetail: (id: string) =>
    req<CampsiteDetail>(`/api/campsites/${id}/detail`),
  suggestCampsiteEdit: (id: string, data: CampEditSuggestionPayload) =>
    req<{ id: number; status: string; credits_earned: number; new_balance: number }>(`/api/campsites/${encodeURIComponent(id)}/suggest-edit`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  adminUpdateCampsite: (id: string, data: Partial<CampAdminUpdatePayload>) =>
    req<{ ok: boolean; override: Partial<CampsiteDetail> }>(`/api/admin/campsites/${encodeURIComponent(id)}`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  submitPin: (data: PinPayload) =>
    req('/api/pins', { method: 'POST', body: JSON.stringify(data) }),
  getNearbyPins: (lat: number, lng: number, radius = 1.0) =>
    req<Pin[]>(`/api/pins?lat=${lat}&lng=${lng}&radius=${radius}`),
  upvotePin: (id: number) => req<{ ok: boolean; upvotes: number; downvotes: number; hidden: boolean }>(`/api/pins/${id}/upvote`, { method: 'POST' }),
  downvotePin: (id: number) => req<{ ok: boolean; upvotes: number; downvotes: number; hidden: boolean }>(`/api/pins/${id}/downvote`, { method: 'POST' }),

  getAudioGuide: (tripId: string) =>
    req<Record<string, string>>(`/api/trip/${tripId}/guide`),
  nearbyAudio: (lat: number, lng: number, location_name = '') =>
    req<{ narration: string }>('/api/audio/nearby', {
      method: 'POST', body: JSON.stringify({ lat, lng, location_name }),
    }),

  getWeather: (lat: number, lng: number, days = 7) =>
    req<WeatherForecast>(`/api/weather?lat=${lat}&lng=${lng}&days=${days}`),
  getRouteWeather: (tripId: string, waypoints: Waypoint[]) =>
    req<RouteWeatherResult>('/api/weather/route', { method: 'POST', body: JSON.stringify({ trip_id: tripId, waypoints }) }),

  // Discovery
  getNearbyCamps: (lat: number, lng: number, radius = 50, types: string[] = []) =>
    req<CampsitePin[]>(`/api/nearby-camps?lat=${lat}&lng=${lng}&radius=${radius}&types=${types.join(',')}`),
  getCampsBbox: (n: number, s: number, e: number, w: number, types: string[] = []) =>
    req<CampsitePin[]>(`/api/camps/bbox?n=${n}&s=${s}&e=${e}&w=${w}&types=${types.join(',')}`),
  getOsmPois: (lat: number, lng: number, radius = 30, types = 'water,trailhead,viewpoint') =>
    req<OsmPoi[]>(`/api/osm-pois?lat=${lat}&lng=${lng}&radius=${radius}&types=${types}`),
  getWikipediaNearby: (lat: number, lng: number, radius = 10000) =>
    req<WikiArticle[]>(`/api/wikipedia-nearby?lat=${lat}&lng=${lng}&radius=${radius}`),

  // AI features
  getCampsiteInsight: (data: CampsiteInsightRequest) =>
    req<CampsiteInsight>('/api/ai/campsite-insight', { method: 'POST', body: JSON.stringify(data) }),
  getRouteBrief: (data: RouteBriefRequest) =>
    req<RouteBrief>('/api/ai/route-brief', { method: 'POST', body: JSON.stringify(data) }),
  getPackingList: (data: PackingRequest) =>
    req<PackingList>('/api/ai/packing-list', { method: 'POST', body: JSON.stringify(data) }),

  submitBugReport: (data: { title: string; description: string; app_version?: string }) =>
    req<{ bug_id: number; message: string }>('/api/bugs', { method: 'POST', body: JSON.stringify(data) }),

  getLandCheck: (lat: number, lng: number) =>
    req<LandCheck>(`/api/land-check?lat=${lat}&lng=${lng}`),

  // Camp fullness
  reportCampFull: (campId: string, data: { camp_name: string; lat: number; lng: number }) =>
    req<CampFullnessResult>(`/api/camps/${encodeURIComponent(campId)}/full`, { method: 'POST', body: JSON.stringify(data) }),
  confirmCampFull: (campId: string) =>
    req<CampFullnessResult>(`/api/camps/${encodeURIComponent(campId)}/confirm-full`, { method: 'POST' }),
  disputeCampFull: (campId: string) =>
    req<CampFullnessResult>(`/api/camps/${encodeURIComponent(campId)}/dispute-full`, { method: 'POST' }),
  getCampFullness: (campId: string) =>
    req<CampFullness | null>(`/api/camps/${encodeURIComponent(campId)}/fullness`),
  getNearbyFullness: (lat: number, lng: number, radius?: number) =>
    req<CampFullness[]>(`/api/camps/fullness/nearby?lat=${lat}&lng=${lng}&radius=${radius ?? 0.5}`),

  // Camp Field Reports
  submitFieldReport: (campId: string, data: FieldReportPayload) =>
    req<{ credits_earned: number; new_balance: number }>(`/api/camps/${encodeURIComponent(campId)}/field-report`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  getFieldReports: (campId: string) =>
    req<CampFieldReport[]>(`/api/camps/${encodeURIComponent(campId)}/field-reports`),
  getFieldReportSummary: (campId: string) =>
    req<FieldReportSummary>(`/api/camps/${encodeURIComponent(campId)}/field-report-summary`),

  // Subscription
  subscriptionStatus: () =>
    req<SubscriptionStatus>('/api/subscription/status'),
  activateSubscription: (product_id: string, transaction_id: string) =>
    req<{ status: string; plan_type: string; plan_expires_at: number }>('/api/subscription/activate', {
      method: 'POST', body: JSON.stringify({ product_id, transaction_id }),
    }),
  authorizeOfflineDownload: (asset_type: OfflineAssetType, region_id: string, label = '') =>
    req<OfflineAuthorizeResult>('/api/offline/authorize', {
      method: 'POST', body: JSON.stringify({ asset_type, region_id, label }),
    }),
};

export interface TrailDNA {
  vehicle?: string;
  terrain?: string;
  camp_style?: string;
  duration?: string;
  regions?: string[];
}

export interface ChatResponse {
  type: 'message' | 'ready' | 'trip_update';
  content: string;
  outline?: string;
  trip?: TripResult;
  trail_dna?: TrailDNA;
}

export interface User {
  id: number; email: string; username: string; credits: number;
  referral_code: string; report_streak: number; created_at: number;
  reporting_restricted_until?: number;
  is_admin?: boolean;
  email_verified?: boolean | number;
}
export interface TripResult {
  trip_id: string; plan: TripPlan; campsites: Campsite[]; gas_stations: GasStation[];
  route_pois?: OsmPoi[];
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
  verified_match?: boolean; verified_distance_mi?: number; verified_name?: string;
  verified_source?: string; needs_review?: boolean; verification_note?: string;
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
  route_distance_mi?: number; route_fit?: string; recommended_day?: number;
  verified_source?: string;
}
export interface CampsitePin {
  id: string; name: string; lat: number; lng: number;
  tags: string[]; land_type: string; description: string;
  photo_url?: string; reservable: boolean; cost?: string; url: string; ada: boolean;
  route_distance_mi?: number; route_fit?: string; recommended_day?: number;
  source?: string; verified_source?: string;
}
export interface CampsiteDetail extends CampsitePin {
  photos: string[]; amenities: string[]; site_types: string[];
  activities: string[]; phone?: string; campsites_count: number;
  admin_edited?: boolean;
}
export interface GasStation {
  id: number | string; name: string; lat: number; lng: number;
  fuel_types: string; address: string;
  route_distance_mi?: number; route_fit?: string; recommended_day?: number;
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
export interface CreditPackage {
  id: string; credits: number; price_cents: number; price_display: string;
  label: string; popular: boolean;
}
export interface LeaderboardEntry {
  username: string; report_count: number; total_upvotes: number; streak: number;
}
export interface Pin {
  id: number; lat: number; lng: number; name: string; type: string; description: string; land_type: string;
  submitted_at?: number; upvotes?: number; downvotes?: number; hidden?: number;
}
export interface PinPayload {
  lat: number; lng: number; name: string; type?: string; description?: string; land_type?: string;
}
export interface OsmPoi {
  id: string; name: string; lat: number; lng: number;
  type: 'water' | 'trailhead' | 'viewpoint' | 'peak' | 'hot_spring'; subtype?: string; elevation?: string;
  route_distance_mi?: number; route_fit?: string;
}
export interface WikiArticle {
  title: string; lat: number; lng: number; dist_m: number; extract: string; url: string;
}
export interface CampsiteInsightRequest {
  name: string; lat: number; lng: number;
  description?: string; land_type?: string; amenities?: string[];
  facility_id?: string;
}
export interface CampsiteInsight {
  insider_tip: string; best_for: string; best_season: string;
  nearby_highlights: string[]; hazards: string | null;
  star_rating: number; coordinates_dms: string;
}
export interface RouteBriefRequest {
  trip_name: string; waypoints: object[]; reports?: object[];
}
export interface RouteBrief {
  readiness_score: number; top_concerns: string[]; must_do_before_leaving: string[];
  daily_highlights: string[]; estimated_fuel_stops: number;
  water_carry_gallons: number; briefing_summary: string;
  signal_dead_zones?: string[];
  fire_restriction_likelihood?: string;
  emergency_bailout?: string;
}
export interface PackingRequest {
  trip_name: string; duration_days: number;
  road_types?: string[]; land_types?: string[]; states?: string[];
}
export interface PackingList {
  essentials: string[]; recovery_gear: string[]; water_food: string[];
  navigation: string[]; shelter: string[]; tools_spares: string[];
  optional_nice_to_have: string[]; leave_at_home: string[];
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
export interface RouteWeatherResult {
  trip_id: string;
  forecasts: Record<string, WeatherForecast>;
}
export interface CampFullness {
  camp_id: string; camp_name: string; lat: number; lng: number;
  status: 'full' | 'open'; reporter_id: number; username?: string;
  confirmations: number; disputes: number;
  reported_at: number; expires_at: number;
}
export interface CampFullnessResult {
  credits_earned: number; new_balance: number;
  confirmations?: number; disputes?: number;
  status?: string; already_reported?: boolean; already_voted?: boolean;
}

export type OfflineAssetType = 'state_map' | 'state_route' | 'trip_corridor' | 'conus_map';
export interface OfflineAuthorizeResult {
  authorized: boolean;
  charged: number;
  free_used: boolean;
  already_authorized?: boolean;
  plan?: boolean;
  credits: number;
}
export interface LandCheck {
  land_type: string;
  admin_name: string;
  camping_status: 'allowed' | 'check-rules' | 'restricted' | 'unknown';
  camping_note: string;
  source: string;
}
export interface SubscriptionStatus {
  plan_type: string;
  plan_expires_at: number | null;
  is_active: boolean;
  credits: number;
  camp_searches_used: number;
}
export type FieldReportSentiment = 'loved_it' | 'its_ok' | 'would_skip';
export type FieldReportAccess = 'easy' | 'rough' | 'four_wd_required';
export type FieldReportCrowd = 'empty' | 'few_rigs' | 'packed';

export interface FieldReportPayload {
  camp_name: string;
  lat: number;
  lng: number;
  rig_label?: string;
  visited_date: string;
  sentiment: FieldReportSentiment;
  access_condition: FieldReportAccess;
  crowd_level: FieldReportCrowd;
  tags: string[];
  note?: string;
  photo_data?: string;
}
export interface CampFieldReport {
  id: number;
  username: string;
  rig_label?: string;
  visited_date: string;
  sentiment: FieldReportSentiment;
  access_condition: FieldReportAccess;
  crowd_level: FieldReportCrowd;
  tags: string[];
  note?: string;
  has_photo: boolean;
  created_at: number;
}
export interface FieldReportSummary {
  count: number;
  sentiment_counts: Record<string, number>;
  top_tags: { tag: string; count: number }[];
  last_visited: string | null;
}
export interface CampEditSuggestionPayload {
  camp_name: string;
  lat: number;
  lng: number;
  field: string;
  value: string;
  note?: string;
}
export interface CampAdminUpdatePayload {
  name: string;
  description: string;
  amenities: string[];
  site_types: string[];
  activities: string[];
  cost: string;
  phone: string;
  url: string;
}
