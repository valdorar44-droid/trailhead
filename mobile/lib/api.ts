import { storage } from './storage';
import { Platform } from 'react-native';

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.gettrailhead.app';

async function getToken(): Promise<string | null> {
  return storage.get('trailhead_token');
}

export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
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
  geocodePlaces: (query: string, limit = 8) =>
    req<GeocodePlace[]>(`/api/geocode?q=${encodeURIComponent(query)}&limit=${limit}`),
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
  suggestPinUpdate: (id: number, data: { pin_name: string; note: string; field?: string; value?: string }) =>
    req<{ id?: number; status: string; credits_earned?: number; new_balance?: number }>(`/api/pins/${id}/suggest-update`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  upvotePin: (id: number) => req<{ ok: boolean; upvotes: number; downvotes: number; hidden: boolean }>(`/api/pins/${id}/upvote`, { method: 'POST' }),
  downvotePin: (id: number) => req<{ ok: boolean; upvotes: number; downvotes: number; hidden: boolean }>(`/api/pins/${id}/downvote`, { method: 'POST' }),

  getAudioGuide: (tripId: string, generate = false) =>
    req<Record<string, string>>(`/api/trip/${tripId}/guide${generate ? '?generate=true' : ''}`),
  getExploreCatalog: () =>
    req<ExploreCatalog>('/api/explore/catalog'),
  getExplorePlaces: (lat?: number, lng?: number, mode: 'featured' | 'nearby' | 'trip' = 'featured', limit = 60) => {
    const qs = new URLSearchParams({ mode, limit: String(limit) });
    if (lat != null && lng != null) {
      qs.set('lat', String(lat));
      qs.set('lng', String(lng));
    }
    return req<ExploreCatalog>(`/api/explore/places?${qs.toString()}`);
  },
  nearbyAudio: (lat: number, lng: number, location_name = '') =>
    req<{ narration: string }>('/api/audio/nearby', {
      method: 'POST', body: JSON.stringify({ lat, lng, location_name }),
    }),
  authorizeExploreAudio: (place_id: string, mode: 'summary' | 'story') =>
    req<{ authorized: boolean; charged: number; already_unlocked?: boolean; plan?: boolean; credits: number }>('/api/audio/explore/authorize', {
      method: 'POST', body: JSON.stringify({ place_id, mode }),
    }),
  ttsSource: async (text: string, mode: 'direction' | 'guide' = 'direction') => ({
    ...(mode === 'guide' && text.length > 1600
      ? { uri: `${BASE}${(await req<{ uri: string }>('/api/audio/tts-session', {
          method: 'POST',
          body: JSON.stringify({ mode, text }),
        })).uri}` }
      : { uri: `${BASE}/api/audio/tts?mode=${encodeURIComponent(mode)}&text=${encodeURIComponent(text)}` }),
    headers: await authHeaders(),
  }),

  getWeather: (lat: number, lng: number, days = 7) =>
    req<WeatherForecast>(`/api/weather?lat=${lat}&lng=${lng}&days=${days}`),
  getRouteWeather: (tripId: string, waypoints: Waypoint[]) =>
    req<RouteWeatherResult>('/api/weather/route', { method: 'POST', body: JSON.stringify({ trip_id: tripId, waypoints }) }),
  buildRoute: (locations: Array<{ lat: number; lng: number; type?: 'break' | 'through' }>, options: RouteBuildOptions = {}) =>
    req<RouteBuildResult>('/api/route', {
      method: 'POST',
      body: JSON.stringify({
        locations: locations.map(loc => ({ lat: loc.lat, lon: loc.lng, type: loc.type ?? 'break' })),
        options,
        units: 'miles',
      }),
    }),

  // Discovery
  getNearbyCamps: (lat: number, lng: number, radius = 50, types: string[] = []) =>
    req<CampsitePin[]>(`/api/nearby-camps?lat=${lat}&lng=${lng}&radius=${radius}&types=${types.join(',')}`),
  getCampsBbox: (n: number, s: number, e: number, w: number, types: string[] = []) =>
    req<CampsitePin[]>(`/api/camps/bbox?n=${n}&s=${s}&e=${e}&w=${w}&types=${types.join(',')}`),
  getOsmPois: (lat: number, lng: number, radius = 30, types = 'water,trailhead,viewpoint') =>
    req<OsmPoi[]>(`/api/osm-pois?lat=${lat}&lng=${lng}&radius=${radius}&types=${types}`),
  discoverTrails: (params: TrailDiscoverParams) => {
    const qs = new URLSearchParams({ mode: params.mode ?? 'nearby', limit: String(params.limit ?? 60) });
    if (params.lat != null) qs.set('lat', String(params.lat));
    if (params.lng != null) qs.set('lng', String(params.lng));
    if (params.radius != null) qs.set('radius', String(params.radius));
    if (params.n != null) qs.set('n', String(params.n));
    if (params.s != null) qs.set('s', String(params.s));
    if (params.e != null) qs.set('e', String(params.e));
    if (params.w != null) qs.set('w', String(params.w));
    return req<TrailDiscoverResponse>(`/api/trails/discover?${qs.toString()}`);
  },
  getTrailProfile: (trailId: string) =>
    req<TrailProfile>(`/api/trails/${encodeURIComponent(trailId)}`),
  suggestTrailEdit: (trailId: string, data: TrailEditSuggestionPayload) =>
    req<{ id: number; status: string; credits_earned: number; new_balance: number }>(`/api/trails/${encodeURIComponent(trailId)}/suggest-edit`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  buildTripEssentialsPack: (data: PlaceTripPackRequest) =>
    req<PlacePack>('/api/places/trip-essentials', {
      method: 'POST', body: JSON.stringify(data),
    }),
  getPlacePackManifest: () =>
    req<PlacePackManifest>('/api/places/packs/manifest'),
  getPlacePack: (region_id: string, pack_id = 'essentials') =>
    req<PlacePack>(`/api/places/packs/${encodeURIComponent(region_id)}/${encodeURIComponent(pack_id)}`),
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

  getContestStatus: () =>
    req<ContestStatus>('/api/contest/status'),
  enterContestDrawing: () =>
    req<{ ok: boolean; entry: ContestEntry; status: ContestUserStatus }>('/api/contest/free-entry', { method: 'POST' }),
  getContestRules: () =>
    req<ContestRules>('/api/contest/rules'),
  getMyContributions: () =>
    req<ContributorProfile>('/api/contributions/me'),
  getContributionsLeaderboard: (period: ContributionPeriod = 'month') =>
    req<ContributorLeaderboardResponse>(`/api/contributions/leaderboard?period=${period}`),
  getContributorProfile: (userId: number) =>
    req<ContributorProfile>(`/api/contributors/${userId}`),
  setContributionVisibility: (visible: boolean) =>
    req<ContributorProfile>('/api/contributions/privacy', { method: 'POST', body: JSON.stringify({ visible }) }),
  applyMapContributor: (data: MapContributorApplicationPayload) =>
    req<{ ok: boolean; application: MapContributorApplication }>('/api/contributions/map-contributor/apply', {
      method: 'POST', body: JSON.stringify(data),
    }),

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
  submitTrailFieldReport: (trailId: string, data: TrailFieldReportPayload) =>
    req<{ credits_earned: number; new_balance: number }>(`/api/trails/${encodeURIComponent(trailId)}/field-report`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  getTrailFieldReports: (trailId: string) =>
    req<CampFieldReport[]>(`/api/trails/${encodeURIComponent(trailId)}/field-reports`),
  getTrailFieldReportSummary: (trailId: string) =>
    req<FieldReportSummary>(`/api/trails/${encodeURIComponent(trailId)}/field-report-summary`),

  // Subscription
  subscriptionStatus: () =>
    req<SubscriptionStatus>('/api/subscription/status'),
  activateSubscription: (product_id: string, transaction_id: string) =>
    req<{ status: string; plan_type: string; plan_expires_at: number }>('/api/subscription/activate', {
      method: 'POST', body: JSON.stringify({ product_id, transaction_id, platform: Platform.OS }),
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
export interface GeocodePlace {
  name: string;
  lat: number;
  lng: number;
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
  route_progress?: number; route_progress_mi?: number; route_segment_index?: number;
  verified_source?: string;
}
export interface CampsitePin {
  id: string; name: string; lat: number; lng: number;
  tags: string[]; land_type: string; description: string;
  photo_url?: string; reservable: boolean; cost?: string; url: string; ada: boolean;
  route_distance_mi?: number; route_fit?: string; recommended_day?: number;
  route_progress?: number; route_progress_mi?: number; route_segment_index?: number;
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
  route_progress?: number; route_progress_mi?: number; route_segment_index?: number;
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
export interface ContestLeader {
  user_id: number; username: string; display_name: string; points: number; event_count: number; rank: number;
}
export interface ContestRules {
  title: string; eligibility: string; sponsor: string; prizes: string[]; entries: string; odds: string; points: string; contact: string;
}
export interface ContestEntry {
  id: number; user_id: number; period_month: string; period_year: string; entry_type: 'free' | 'subscriber'; created_at: number;
}
export interface ContestUserStatus {
  period_month: string; period_year: string; month_points: number; year_points: number;
  month_rank?: number | null; year_rank?: number | null; drawing_entered: boolean; drawing_entry_type?: string | null;
}
export interface ContestStatus extends ContestUserStatus {
  rules: ContestRules; month_leaders: ContestLeader[]; year_leaders: ContestLeader[];
}
export type ContributionPeriod = 'month' | 'year' | 'all';
export interface ContributorTier {
  id: string; label: string; points_required: number; next_label?: string | null; next_points?: number | null; progress: number;
}
export interface ContributorBadge {
  id: string; label: string; description: string; icon: string; tone: string; source: 'auto' | 'admin'; earned_at?: number | null;
}
export interface ContributorAward {
  id: number; prize_type: string; period_month?: string | null; period_year: string; prize_label: string; status: string; created_at: number;
}
export interface ContributorStats {
  total_events: number; reports: number; pins: number; camp_reports: number; trail_reports: number;
  confirmations: number; photos: number; edits: number; camp_status: number; signal_water_road?: number;
}
export interface ContributorProfile {
  user_id: number; username: string; display_name: string; is_self?: boolean; public_profile_visible: boolean;
  title: string; bio: string; avatar_color: string; joined_at: number;
  points: { month: number; year: number; all: number };
  rank: { month?: number | null; year?: number | null; all?: number | null };
  streak: number; tier: ContributorTier; stats: ContributorStats; badges: ContributorBadge[];
  awards: ContributorAward[]; recent_activity: { label: string; count: number; points: number }[];
}
export interface ContributorLeader {
  user_id: number; username: string; display_name: string; is_self?: boolean; rank_number: number; points_for_period: number;
  title: string; avatar_color: string; streak: number; tier: ContributorTier; stats: ContributorStats;
  badges: ContributorBadge[]; awards: ContributorAward[]; event_count: number;
  points: { month: number; year: number; all: number };
}
export interface ContributorLeaderboardResponse {
  period: ContributionPeriod; leaders: ContributorLeader[];
}
export interface MapContributorApplicationPayload {
  experience: string;
  regions: string[];
  sample_note?: string;
}
export interface MapContributorApplication extends MapContributorApplicationPayload {
  id: number;
  user_id: number;
  username?: string;
  status: 'pending' | 'approved' | 'dismissed';
  created_at: number;
  updated_at: number;
}
export interface Pin {
  id: number; lat: number; lng: number; name: string; type: string; description: string; land_type: string;
  details?: Record<string, string> | string;
  submitted_at?: number; upvotes?: number; downvotes?: number; hidden?: number;
}
export interface PinPayload {
  lat: number; lng: number; name: string; type?: string; description?: string; land_type?: string;
  details?: Record<string, string>;
}
export interface OsmPoi {
  id: string; name: string; lat: number; lng: number;
  type: 'water' | 'trail' | 'trailhead' | 'viewpoint' | 'peak' | 'hot_spring' | 'fuel' | 'propane' | 'dump' | 'shower' | 'laundromat' | 'lodging' | 'food' | 'grocery' | 'mechanic' | 'parking' | 'attraction' | 'poi'; subtype?: string; elevation?: string;
  source?: string;
  profile_id?: string;
  source_label?: string;
  photo_url?: string | null;
  length_mi?: number | null;
  activities?: string[];
  last_checked?: number;
  route_distance_mi?: number; route_fit?: string;
  route_progress?: number; route_progress_mi?: number; route_segment_index?: number;
}
export interface TrailClaim {
  source: string;
  last_checked?: number;
  note?: string;
}
export interface TrailPhoto {
  url: string;
  caption?: string;
  credit?: string;
  source?: string;
}
export interface TrailProfile {
  id: string;
  name: string;
  summary?: string;
  description?: string;
  lat: number;
  lng: number;
  length_mi?: number | null;
  difficulty?: string;
  activities: string[];
  land_manager?: string;
  geometry?: GeoJSON.FeatureCollection | null;
  trailheads: Array<{ name?: string; lat: number; lng: number; source?: string }>;
  official_url?: string;
  photos: TrailPhoto[];
  source: string;
  source_label: string;
  provenance: Record<string, TrailClaim>;
  last_checked: number;
  admin_edited?: boolean;
  distance_mi?: number;
  viewport_score?: number;
  field_report_summary?: FieldReportSummary;
}
export interface TrailDiscoverParams {
  lat?: number;
  lng?: number;
  radius?: number;
  n?: number;
  s?: number;
  e?: number;
  w?: number;
  mode?: 'nearby' | 'view';
  limit?: number;
}
export interface TrailDiscoverResponse {
  mode: 'nearby' | 'view';
  source: string;
  offline: boolean;
  trails: TrailProfile[];
}
export interface TrailEditSuggestionPayload {
  trail_name: string;
  field: string;
  value: string;
  note?: string;
}
export interface PlaceTripPackRequest {
  trip_id?: string;
  trip_name: string;
  waypoints: Array<{ lat: number; lng: number; name?: string; day?: number; type?: string }>;
  route_coords?: [number, number][];
}
export interface PlacePackPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type: OsmPoi['type'];
  category?: string;
  source?: string;
  subtype?: string;
  address?: string;
  fuel_types?: string;
  elevation?: string;
}
export interface PlacePack {
  schema_version: number;
  pack_id: string;
  trip_id?: string;
  trip_name?: string;
  region_id?: string;
  region_name?: string;
  name: string;
  generated_at: number;
  source: string;
  sample_count?: number;
  categories: string[];
  points: PlacePackPoint[];
}
export interface PlacePackManifestEntry {
  region_id: string;
  pack_id: string;
  size: number;
  point_count: number;
  url: string;
}
export interface PlacePackManifest {
  definitions: Record<string, { id: string; name: string; description: string; categories: string[] }>;
  packs: Record<string, PlacePackManifestEntry>;
}
export type ExploreCategory = 'Park' | 'National Monument' | 'Historic Site' | 'Scenic Landmark' | 'National Preserve' | 'National Seashore' | 'National Lakeshore' | string;
export interface ExplorePlaceSummary {
  id: string;
  title: string;
  category: ExploreCategory;
  state: string;
  region: string;
  lat?: number | null;
  lng?: number | null;
  rank: number;
  tags: string[];
  hook: string;
  short_description: string;
  thumbnail_url?: string | null;
  image_url?: string | null;
  source_url?: string | null;
  source_title?: string;
  distance_m?: number;
  day?: number;
}
export interface ExplorePlaceProfile {
  id: string;
  summary: ExplorePlaceSummary;
  profile: {
    hook: string;
    summary?: string;
    story?: string;
    why_it_matters: string;
    what_to_know: string;
    best_time_to_stop: string;
    access_notes: string;
    nearby_context: string;
  };
  audio_script: string;
  wiki_extract: string;
  source_pack?: {
    quality?: 'official' | 'wiki' | string;
    primary?: string;
    official_url?: string;
    nps_park_code?: string;
    sources?: { title?: string; publisher?: string; url?: string; kind?: string }[];
    photos?: { url?: string; caption?: string; credit?: string }[];
    activities?: string[];
    topics?: string[];
    things_to_do?: ExploreSourcePackItem[];
    things_to_see?: ExploreSourcePackItem[];
    visitor_centers?: ExploreSourcePackItem[];
    campgrounds?: ExploreSourcePackItem[];
    fees?: string[];
    operating_hours?: string;
    alerts?: { title?: string; category?: string; url?: string }[];
    source_note?: string;
    extract?: string;
  };
  facts: { coordinates?: string; source_url?: string; source_title?: string; official_url?: string; source_quality?: string; last_updated?: number };
  attribution: string;
}
export interface ExploreSourcePackItem {
  kind?: string;
  title?: string;
  description?: string;
  url?: string;
  lat?: number | null;
  lng?: number | null;
  image_url?: string;
  image_caption?: string;
  image_credit?: string;
}
export interface ExploreCatalog {
  schema_version: number;
  catalog_id: string;
  name: string;
  generated_at: number;
  source: string;
  future_pack_compatible?: boolean;
  mode?: string;
  places: ExplorePlaceProfile[];
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
export interface RouteBuildOptions {
  avoidTolls?: boolean;
  avoidHighways?: boolean;
  backRoads?: boolean;
  noFerries?: boolean;
}
export interface RouteBuildResult {
  trip?: {
    status?: number;
    summary?: { length?: number; time?: number };
    legs?: Array<{ shape?: string; summary?: { length?: number; time?: number } }>;
  };
  _trailhead?: { engine?: string; cache?: string; cache_key?: string };
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

export type OfflineAssetType = 'state_map' | 'state_route' | 'state_contours' | 'state_trails' | 'trip_corridor' | 'conus_map';
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
export interface TrailFieldReportPayload {
  trail_name: string;
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
