import { storage } from './storage';
import { Platform } from 'react-native';
import { guardedRequest, normalizeRequestText, stableNumber, stableRouteKey } from './requestGuard';

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.gettrailhead.app';
export type WeatherUnitMode = 'auto' | 'imperial' | 'metric';

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
    const msg = typeof detail === 'string' ? detail : (detail?.message ?? detail?.reason ?? 'Request failed');
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
  oauthApple: (identity_token: string, full_name = '', email = '') =>
    req<{ token: string; user: User }>('/api/auth/oauth/apple', {
      method: 'POST', body: JSON.stringify({ identity_token, full_name, email }),
    }),
  oauthGoogle: (identity_token: string, full_name = '', email = '') =>
    req<{ token: string; user: User }>('/api/auth/oauth/google', {
      method: 'POST', body: JSON.stringify({ identity_token, full_name, email }),
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
  getSupportInbox: () =>
    req<{ threads: SupportThread[]; unread_count: number }>('/api/support/inbox'),
  getSupportThread: (threadId: number) =>
    req<SupportThread>(`/api/support/threads/${threadId}`),
  sendSupportMessage: (data: { thread_id?: number; subject?: string; category?: string; body: string }) =>
    req<{ ok: boolean; thread_id: number; message?: SupportMessage | null }>('/api/support/inbox/message', {
      method: 'POST', body: JSON.stringify(data),
    }),
  chat: (message: string, sessionId: string, currentTrip?: TripResult | null, rigContext?: Record<string, unknown> | null) =>
    req<ChatResponse>('/api/chat', { method: 'POST', body: JSON.stringify({ message, session_id: sessionId, current_trip: currentTrip ?? undefined, rig_context: rigContext ?? undefined }) }),
  getTrip: (id: string) => req<TripResult>(`/api/trip/${id}`),
  listTrips: (limit = 25) => req<{ trips: AccountTripSummary[] }>(`/api/trips?limit=${limit}`),
  saveTrip: (trip: TripResult, route_geometry?: SavedRouteGeometryPayload | null, builder_state?: Record<string, unknown> | null, source: string = Platform.OS) =>
    req<TripResult>(`/api/trip/${encodeURIComponent(trip.trip_id)}`, {
      method: 'PUT',
      body: JSON.stringify({
        trip,
        route_geometry,
        builder_state,
        source,
        request: `${source} route: ${trip.plan?.trip_name ?? trip.trip_id}`,
      }),
    }),
  saveTripGeometry: (tripId: string, route_geometry: SavedRouteGeometryPayload) =>
    req<TripResult>(`/api/trip/${encodeURIComponent(tripId)}/geometry`, {
      method: 'PUT',
      body: JSON.stringify({ route_geometry }),
    }),

  submitReport: (data: ReportPayload) =>
    req<ReportResponse>('/api/reports', { method: 'POST', body: JSON.stringify(data) }),
  getNearbyReports: (lat: number, lng: number, radius = 0.5) =>
    req<Report[]>(`/api/reports?lat=${lat}&lng=${lng}&radius=${radius}`),
  getReportsAlongRoute: (waypoints: Waypoint[]) =>
    req<Report[]>('/api/reports/along-route', {
      method: 'POST', body: JSON.stringify({ waypoints }),
    }),
  getNearbyAlerts: (lat: number, lng: number, radius = 0.5) =>
    req<Report[]>(`/api/conditions/nearby?lat=${lat}&lng=${lng}&radius=${radius}`),
  getAlertsAlongRoute: (waypoints: Waypoint[]) =>
    req<Report[]>('/api/conditions/along-route', {
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
  getExtremeConfig: () => req<ExtremeConfig>('/api/extreme/config'),
  authorizeExtremeSession: (data: ExtremeSessionAuthorizeRequest) =>
    req<ExtremeSessionAuthorizeResponse>('/api/extreme/session/authorize', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  endExtremeSession: (session_id: string, reason = 'ended') =>
    req<{ ok: boolean; session_id: string; status: string; ended_at?: number }>('/api/extreme/session/end', {
      method: 'POST',
      body: JSON.stringify({ session_id, reason }),
    }),
  logExtremeLedger: (data: ExtremeLedgerRequest) =>
    req<{ ok: boolean; event_id: number }>('/api/extreme/ledger', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  authorizeExtremeNavigation: (data: ExtremeNavigationAuthorizeRequest) =>
    req<ExtremeNavigationAuthorizeResponse>('/api/extreme/navigation/authorize', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  extremeWeatherRouteRisk: (data: ExtremeRouteRiskRequest) =>
    req<ExtremeRouteRiskResponse>('/api/extreme/weather/route-risk', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  extremeCopilotCommand: (data: ExtremeCopilotCommandRequest) =>
    req<ExtremeCopilotCommandResponse>('/api/extreme/copilot/command', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  extremeCopilotSession: (data: ExtremeCopilotSessionRequest) =>
    req<ExtremeCopilotSessionResponse>('/api/extreme/copilot/session', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  extremeCopilotMessage: (data: ExtremeCopilotMessageRequest) =>
    req<ExtremeCopilotMessageResponse>('/api/extreme/copilot/message', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  confirmExtremeCopilotAction: (data: ExtremeCopilotConfirmRequest) =>
    req<ExtremeCopilotConfirmResponse>('/api/extreme/copilot/action/confirm', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  createRealtimeCopilotSession: (data: RealtimeCopilotSessionRequest = {}) =>
    req<RealtimeCopilotSessionResponse>('/api/extreme/copilot/realtime-session', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  extremeSearchSession: (metadata: Record<string, unknown> = {}) =>
    req<ExtremeSearchSessionResponse>('/api/extreme/search/session', {
      method: 'POST',
      body: JSON.stringify({ metadata }),
    }),
  extremeSearchSuggest: (data: ExtremeSearchSuggestRequest) =>
    req<ExtremeSearchResponse>('/api/extreme/search/suggest', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  extremeSearchRetrieve: (data: ExtremeSearchRetrieveRequest) =>
    req<ExtremeSearchResponse>('/api/extreme/search/retrieve', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  extremeSearchCategory: (data: ExtremeSearchCategoryRequest) =>
    req<ExtremeSearchResponse>('/api/extreme/search/category', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  extremeSearchReverse: (data: ExtremeSearchReverseRequest) =>
    req<ExtremeSearchResponse>('/api/extreme/search/reverse', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  extremeDirections: (data: ExtremeDirectionsRequest) =>
    req<ExtremeDirectionsResponse>('/api/extreme/directions', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  geocodePlaces: (query: string, limit = 8) => {
    const normalized = normalizeRequestText(query);
    if (normalized.length < 2) return Promise.resolve([]);
    const safeLimit = Math.max(1, Math.min(Math.round(limit || 8), 10));
    return guardedRequest(
      `geocode:${normalized}:${safeLimit}`,
      10 * 60_000,
      () => req<GeocodePlace[]>(`/api/geocode?q=${encodeURIComponent(normalized)}&limit=${safeLimit}`),
    );
  },
  resolveGeocodePlace: (query: string, limit = 8) => {
    const normalized = normalizeRequestText(query);
    if (normalized.length < 2) {
      return Promise.resolve({
        status: 'not_found',
        query: normalized,
        normalized_query: normalized,
        selected: null,
        alternatives: [],
        rejected: [],
        reason: 'empty_query',
      } as GeocodeResolveResponse);
    }
    const safeLimit = Math.max(2, Math.min(Math.round(limit || 8), 10));
    return guardedRequest(
      `geocode-resolve:${normalized}:${safeLimit}`,
      10 * 60_000,
      () => req<GeocodeResolveResponse>(`/api/geocode/resolve?q=${encodeURIComponent(normalized)}&limit=${safeLimit}`),
    );
  },
  getSearchPlaceCard: (query: string, lat: number, lng: number) =>
    guardedRequest(
      `search-card:${normalizeRequestText(query)}:${stableNumber(lat)}:${stableNumber(lng)}`,
      10 * 60_000,
      () => req<OsmPoi | null>(`/api/places/search-card?q=${encodeURIComponent(query)}&lat=${lat}&lng=${lng}`),
    ),
  resolveMapCard: (data: MapCardResolveRequest) =>
    guardedRequest(
      `map-card:${data.kind || 'place'}:${data.source || ''}:${data.id || data.provider_place_id || data.place_id || ''}:${normalizeRequestText(data.name || '')}:${stableNumber(data.lat, 4)}:${stableNumber(data.lng, 4)}`,
      10 * 60_000,
      () => req<MapCardResolveResponse>('/api/map-card/resolve', { method: 'POST', body: JSON.stringify(data) }),
    ),
  getCampsites: (lat: number, lng: number, radius = 25) =>
    req<Campsite[]>(`/api/campsites?lat=${lat}&lng=${lng}&radius=${radius}`),
  searchCampsites: (lat: number, lng: number, radius = 40, types: string[] = []) =>
    req<CampsitePin[]>(`/api/campsites/search?lat=${lat}&lng=${lng}&radius=${radius}&types=${types.join(',')}`)
      .then(canonicalizeCampsitePins),
  getGas: (lat: number, lng: number, radius = 25) =>
    req<GasStation[]>(`/api/gas?lat=${lat}&lng=${lng}&radius=${radius}`),
  getFuelEstimate: (miles: number, mpg: number, states: string[] = [], unit: WeatherUnitMode = 'imperial') =>
    guardedRequest(
      `fuel-estimate:${Math.round(miles)}:${Math.round(mpg * 10) / 10}:${states.slice().sort().join(',')}:${unit}`,
      30 * 60_000,
      () => req<FuelEstimate>(`/api/fuel/estimate?miles=${encodeURIComponent(String(Math.max(0, miles)))}&mpg=${encodeURIComponent(String(Math.max(1, mpg)))}&states=${encodeURIComponent(states.join(','))}&unit=${encodeURIComponent(unit === 'metric' ? 'metric' : 'imperial')}`),
    ),
  getCampsiteDetail: (id: string) => {
    const raw = String(id || '');
    if (raw.startsWith('ridb_site:')) {
      const [, facilityId, campsiteId] = raw.split(':');
      if (facilityId && campsiteId) {
        return req<CampsiteDetail>(`/api/campsites/${encodeURIComponent(facilityId)}/sites/${encodeURIComponent(campsiteId)}/detail`);
      }
    }
    return req<CampsiteDetail>(`/api/campsites/${encodeURIComponent(id)}/detail`);
  },
  suggestCampsiteEdit: (id: string, data: CampEditSuggestionPayload) =>
    req<{ id: number; status: string; credits_earned: number; new_balance: number }>(`/api/campsites/${encodeURIComponent(id)}/suggest-edit`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  adminUpdateCampsite: (id: string, data: Partial<CampAdminUpdatePayload>) =>
    req<{ ok: boolean; override: Partial<CampsiteDetail> }>(`/api/admin/campsites/${encodeURIComponent(id)}`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  adminClearCampCache: (data: { scope: 'all' | 'source' | 'camp_id' | 'near'; source_prefix?: string; camp_id?: string; lat?: number; lng?: number; radius_mi?: number }) =>
    req<{ ok: boolean; deleted: number; brief_deleted: number; scope: string }>('/api/admin/cache/camps/clear', {
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
  getExploreCampgrounds: (placeId: string, limit = 24) =>
    req<ExploreCampgroundsResponse>(`/api/explore/places/${encodeURIComponent(placeId)}/campgrounds?limit=${limit}`)
      .then(res => ({ ...res, campgrounds: canonicalizeCampsitePins(res.campgrounds ?? []) })),
  nearbyAudio: (lat: number, lng: number, location_name = '') =>
    req<{ narration: string }>('/api/audio/nearby', {
      method: 'POST', body: JSON.stringify({ lat, lng, location_name }),
    }),
  authorizeExploreAudio: (place_id: string, mode: 'summary' | 'story') =>
    req<{ authorized: boolean; charged: number; already_unlocked?: boolean; plan?: boolean; credits: number }>('/api/audio/explore/authorize', {
      method: 'POST', body: JSON.stringify({ place_id, mode }),
    }),
  authorizePlaceCategories: (group = 'town_services') =>
    req<{ authorized: boolean; charged: number; already_unlocked?: boolean; plan?: boolean; group: string; credits: number }>('/api/places/categories/authorize', {
      method: 'POST', body: JSON.stringify({ group }),
    }),
  authorizePlaceDetail: (source: string, place_id: string, category = '') =>
    req<{ authorized: boolean; charged: number; already_unlocked?: boolean; plan?: boolean; credits: number }>('/api/places/detail/authorize', {
      method: 'POST', body: JSON.stringify({ source, place_id, category }),
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

  getWeather: (lat: number, lng: number, days = 7, units: WeatherUnitMode = 'auto') =>
    req<WeatherForecast>(`/api/weather?lat=${lat}&lng=${lng}&days=${days}&units=${encodeURIComponent(units)}`),
  getRouteWeather: (tripId: string, waypoints: Waypoint[], units: WeatherUnitMode = 'auto') =>
    req<RouteWeatherResult>('/api/weather/route', { method: 'POST', body: JSON.stringify({ trip_id: tripId, waypoints, units }) }),
  buildRoute: (locations: Array<{ lat: number; lng: number; type?: 'break' | 'through' }>, options: RouteBuildOptions = {}, units: 'miles' | 'kilometers' = 'miles') =>
    req<RouteBuildResult>('/api/route', {
      method: 'POST',
      body: JSON.stringify({
        locations: locations.map(loc => ({ lat: loc.lat, lon: loc.lng, type: loc.type ?? 'break' })),
        options,
        units,
      }),
    }),

  // Discovery
  getNearbyCamps: (lat: number, lng: number, radius = 50, types: string[] = []) =>
    req<CampsitePin[]>(`/api/nearby-camps?lat=${lat}&lng=${lng}&radius=${radius}&types=${types.join(',')}`)
      .then(canonicalizeCampsitePins),
  getRouteCampWindows: (data: RouteCampWindowsRequest) =>
    req<RouteCampWindowsResponse>('/api/route/camp-windows', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getCampsBbox: (n: number, s: number, e: number, w: number, types: string[] = []) =>
    req<CampsitePin[]>(`/api/camps/bbox?n=${n}&s=${s}&e=${e}&w=${w}&types=${types.join(',')}`)
      .then(canonicalizeCampsitePins),
  getOsmPois: (lat: number, lng: number, radius = 30, types = 'water,trailhead,viewpoint') =>
    req<OsmPoi[]>(`/api/osm-pois?lat=${lat}&lng=${lng}&radius=${radius}&types=${types}`),
  getNearbyPlaces: (lat: number, lng: number, radius = 25, categories = 'fuel,water,trailhead,viewpoint', provider: 'auto' | 'geoapify' | 'google' | 'foursquare' | 'osm' | 'nps' | 'blm' | 'usfs' = 'auto') =>
    guardedRequest(
      `nearby:${provider}:${stableNumber(lat)}:${stableNumber(lng)}:${Math.round(radius)}:${categories.split(',').map(c => c.trim()).filter(Boolean).sort().join(',')}`,
      5 * 60_000,
      () => req<OsmPoi[]>(`/api/places/nearby?lat=${lat}&lng=${lng}&radius=${radius}&categories=${encodeURIComponent(categories)}&provider=${encodeURIComponent(provider)}`),
    ),
  getWaterNavigationLines: (n: number, s: number, e: number, w: number) =>
    guardedRequest(
      `water-nav-lines:${stableNumber(n, 3)}:${stableNumber(s, 3)}:${stableNumber(e, 3)}:${stableNumber(w, 3)}`,
      20 * 60_000,
      () => req<WaterNavigationLinesResponse>(`/api/water/navigation-lines?n=${n}&s=${s}&e=${e}&w=${w}`),
    ),
  getWaterConditions: (lat: number, lng: number) =>
    guardedRequest(
      `water-conditions:${stableNumber(lat, 2)}:${stableNumber(lng, 2)}`,
      10 * 60_000,
      () => req<WaterConditionsResponse>(`/api/water/conditions?lat=${lat}&lng=${lng}`),
    ),
  getHydroChartProfile: (n: number, s: number, e: number, w: number) =>
    guardedRequest(
      `hydro-chart-profile:${stableNumber(n, 3)}:${stableNumber(s, 3)}:${stableNumber(e, 3)}:${stableNumber(w, 3)}`,
      20 * 60_000,
      () => req<HydroChartProfileResponse>(`/api/hydro/chart-profile?n=${n}&s=${s}&e=${e}&w=${w}`),
    ),
  getWaterSpotCards: (n: number, s: number, e: number, w: number) =>
    guardedRequest(
      `water-spot-cards:${stableNumber(n, 3)}:${stableNumber(s, 3)}:${stableNumber(e, 3)}:${stableNumber(w, 3)}`,
      20 * 60_000,
      () => req<WaterSpotCardsResponse>(`/api/water/spot-cards?n=${n}&s=${s}&e=${e}&w=${w}`),
    ),
  getFishingConditions: (lat: number, lng: number) =>
    guardedRequest(
      `fishing-conditions:${stableNumber(lat, 2)}:${stableNumber(lng, 2)}`,
      10 * 60_000,
      () => req<FishingConditionsResponse>(`/api/water/fishing-conditions?lat=${lat}&lng=${lng}`),
    ),
  getSuggestedWaterCorridor: (start: { lat: number; lng: number }, end: { lat: number; lng: number }, draftFt?: number) => {
    const qs = new URLSearchParams({
      start_lat: String(start.lat),
      start_lng: String(start.lng),
      end_lat: String(end.lat),
      end_lng: String(end.lng),
    });
    if (draftFt != null) qs.set('draft_ft', String(draftFt));
    return guardedRequest(
      `water-corridor:${stableNumber(start.lat, 3)}:${stableNumber(start.lng, 3)}:${stableNumber(end.lat, 3)}:${stableNumber(end.lng, 3)}:${draftFt ?? ''}`,
      10 * 60_000,
      () => req<SuggestedWaterCorridorResponse>(`/api/water/suggested-corridor?${qs.toString()}`),
    );
  },
  getNearbySmartPack: (
    lat: number,
    lng: number,
    radius = 35,
    categories = 'camp,trailhead,viewpoint,peak,hot_spring,park,historic,climbing,ohv,attraction,camping,water,grocery,mechanic,parking,dump,propane,fuel',
    route?: [number, number][],
    options: { scope_id?: string; recommended_day?: number; route_scope?: 'leg' | 'route' | 'area' } = {},
  ) =>
    guardedRequest(
      `smart-pack:${stableNumber(lat)}:${stableNumber(lng)}:${Math.round(radius)}:${categories.split(',').map(c => c.trim()).filter(Boolean).sort().join(',')}:${stableRouteKey(route)}:${options.scope_id ?? ''}:${options.recommended_day ?? ''}:${options.route_scope ?? ''}`,
      5 * 60_000,
      () => req<NearbySmartPackResponse>('/api/nearby/smart-pack', {
        method: 'POST',
        body: JSON.stringify({ center: { lat, lng }, radius, categories: categories.split(',').filter(Boolean), route, ...options }),
      }),
    ),
  getPlaceDetail: (source: string, placeId: string, category = '') =>
    guardedRequest(
      `place-detail:${String(source || '').toLowerCase()}:${placeId}:${String(category || '').toLowerCase()}`,
      15 * 60_000,
      () => req<PlaceDetail>(`/api/places/${encodeURIComponent(source)}/${encodeURIComponent(placeId)}/detail${category ? `?category=${encodeURIComponent(category)}` : ''}`),
    ),
  canonicalizePlace: (data: CanonicalPlacePayload) =>
    req<{ trailhead_place_id: string; place: TrailheadPlace }>('/api/places/canonicalize', {
      method: 'POST', body: JSON.stringify(data),
    }),
  getCanonicalPlace: (trailheadPlaceId: string) =>
    req<TrailheadPlace>(`/api/places/${encodeURIComponent(trailheadPlaceId)}`),
  getPlaceComments: (trailheadPlaceId: string) =>
    req<PlaceComment[]>(`/api/places/${encodeURIComponent(trailheadPlaceId)}/comments`),
  submitPlaceComment: (trailheadPlaceId: string, data: PlaceCommentPayload) =>
    req<{ comment: PlaceComment; photo?: TrailheadPlacePhoto | null; credits_earned: number; new_balance: number }>(`/api/places/${encodeURIComponent(trailheadPlaceId)}/comments`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  uploadPlacePhoto: (trailheadPlaceId: string, data: PlacePhotoPayload) =>
    req<TrailheadPlacePhoto & { credits_earned: number; new_balance: number }>(`/api/places/${encodeURIComponent(trailheadPlaceId)}/photos`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  suggestPlaceEdit: (trailheadPlaceId: string, data: PlaceEditSuggestionPayload) =>
    req<{ id: number; status: string; credits_earned: number; new_balance: number }>(`/api/places/${encodeURIComponent(trailheadPlaceId)}/edit-suggestions`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  getPlaceReservationStatus: (trailheadPlaceId: string, startDate = '', endDate = '') => {
    const qs = new URLSearchParams();
    if (startDate) qs.set('start_date', startDate);
    if (endDate) qs.set('end_date', endDate);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return req<PlaceReservationStatus>(`/api/places/${encodeURIComponent(trailheadPlaceId)}/reservation-status${suffix}`);
  },
  savePlaceReservationAlert: (trailheadPlaceId: string, data: PlaceReservationAlertPayload) =>
    req<{ ok: boolean; alert: PlaceReservationAlert }>(`/api/places/${encodeURIComponent(trailheadPlaceId)}/reservation-alerts`, {
      method: 'POST', body: JSON.stringify(data),
    }),
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
  discoverTrailArea: (params: TrailDiscoverParams) => {
    const qs = new URLSearchParams({ limit: String(params.limit ?? 24) });
    if (params.lat != null) qs.set('lat', String(params.lat));
    if (params.lng != null) qs.set('lng', String(params.lng));
    if (params.radius != null) qs.set('radius', String(params.radius));
    return req<{ area: ExplorePlaceProfile }>(`/api/trail-areas/discover?${qs.toString()}`);
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
  getExcursionsNearby: (data: ExcursionNearbyRequest) =>
    req<ExcursionNearbyResponse>('/api/excursions/nearby', { method: 'POST', body: JSON.stringify(data) }),

  // AI features
  getCampsiteInsight: (data: CampsiteInsightRequest) =>
    req<CampsiteInsight>('/api/ai/campsite-insight', { method: 'POST', body: JSON.stringify(data) }),
  getRouteBrief: (data: RouteBriefRequest) =>
    req<RouteBrief>('/api/ai/route-brief', { method: 'POST', body: JSON.stringify(data) }),
  getPackingList: (data: PackingRequest) =>
    req<PackingList>('/api/ai/packing-list', { method: 'POST', body: JSON.stringify(data) }),

  submitBugReport: (data: {
    title: string;
    description: string;
    app_version?: string;
    category?: 'bug' | 'offensive';
    source_surface?: string;
    screenshot_data?: string;
    screenshot_content_type?: string;
    ai_context?: Record<string, unknown>;
  }) =>
    req<{ bug_id: number; message: string }>('/api/bugs', { method: 'POST', body: JSON.stringify(data) }),

  getContestStatus: () =>
    req<ContestStatus>('/api/contest/status'),
  enterContestDrawing: () =>
    req<{ ok: boolean; entry: ContestEntry; status: ContestUserStatus }>('/api/contest/free-entry', { method: 'POST' }),
  getContestRules: () =>
    req<ContestRules>('/api/contest/rules'),
  logAnalyticsEvent: (event_type: string, session_id = '', event_data: Record<string, unknown> = {}) =>
    req<{ ok: boolean }>('/api/analytics/event', { method: 'POST', body: JSON.stringify({ event_type, session_id, event_data }) }),
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
  getCampComments: (campId: string) =>
    req<CampComment[]>(`/api/camps/${encodeURIComponent(campId)}/comments`),
  submitCampComment: (campId: string, data: CampCommentPayload) =>
    req<{ id: number; created_at: number }>(`/api/camps/${encodeURIComponent(campId)}/comments`, {
      method: 'POST', body: JSON.stringify(data),
    }),
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

export interface RouteValidationResult {
  ok: boolean;
  reason?: string;
  details?: string[];
  severity?: 'block' | 'warn';
  supported_region?: boolean;
}

export interface ChatResponse {
  type: 'message' | 'ready' | 'trip_update';
  content: string;
  outline?: string;
  trip?: TripResult;
  trail_dna?: TrailDNA;
  route_validation?: RouteValidationResult;
}

export interface User {
  id: number; email: string; username: string; credits: number;
  referral_code: string; report_streak: number; created_at: number;
  reporting_restricted_until?: number;
  is_admin?: boolean;
  email_verified?: boolean | number;
}
export interface SupportMessage {
  id: number;
  thread_id: number;
  sender_role: 'user' | 'admin' | string;
  sender_user_id?: number | null;
  sender_admin_id?: number | null;
  body: string;
  created_at: number;
  meta?: Record<string, unknown>;
}
export interface SupportThread {
  id: number;
  user_id: number;
  username?: string;
  email?: string;
  category: string;
  subject: string;
  status: string;
  opened_by: string;
  created_by_admin?: number | null;
  last_message_at: number;
  created_at: number;
  updated_at: number;
  unread_count?: number;
  last_message_body?: string;
  messages?: SupportMessage[];
}
export type ExtremeSurface = 'map_layers' | 'map' | 'route_builder' | 'navigation' | 'copilot' | 'weather';
export type ExtremeCheckpointType = 'start' | 'fuel' | 'stay' | 'camp' | 'food' | 'repair' | 'viewpoint' | 'weather' | 'finish' | string;
export interface ExtremeCheckpoint {
  id: string;
  type: ExtremeCheckpointType;
  title: string;
  note: string;
  lat: number;
  lng: number;
  day: number;
  sequence: number;
  status: 'planned' | 'suggested' | 'confirmed' | 'review' | string;
  source: 'trailhead' | 'user' | 'community' | 'offline' | string;
  source_id?: string;
  confidence?: 'high' | 'medium' | 'low' | 'estimated' | string;
  expires_at?: number | null;
}
export interface TripMemory {
  vehicle?: Record<string, unknown>;
  range?: Record<string, unknown>;
  clearance?: Record<string, unknown>;
  trailer?: Record<string, unknown>;
  comfort_level?: string;
  preferred_stays?: string[];
  avoid_rules?: string[];
  public_private_preference?: string;
  offline_readiness?: Record<string, unknown>;
  risk_notes?: string[];
  recent_user_edits?: Record<string, unknown>[];
}
export interface ExtremeConfig {
  tier_name: 'Extreme Explorer' | string;
  enabled: boolean;
  entitled: boolean;
  enabled_visual?: boolean;
  entitled_visual?: boolean;
  kill_switch: boolean;
  master_enabled?: boolean;
  beta_active: boolean;
  allowed_surfaces: ExtremeSurface[] | string[];
  allowed_surfaces_visual?: string[];
  style_uris: Record<'standard' | 'live_road' | 'satellite_trail' | '3d_terrain' | 'night_drive' | 'weather_watch' | 'outdoors', string>;
  style_labels: Record<string, string>;
  mapbox_public_token: string;
  max_demo_session_seconds: number;
  max_navigation_session_seconds?: number;
  feature_flags?: {
    native_mode: boolean;
    search: boolean;
    weather: boolean;
    navigation: boolean;
    voice: boolean;
    copilot: boolean;
    mapgpt_pilot: boolean;
    atlas_pilot: boolean;
  };
  weather?: {
    enabled: boolean;
    provider?: 'mapbox' | 'trailhead' | string;
    mapbox_conditions_enabled?: boolean;
    layers: Array<{ id: string; label: string; enabled_by_default?: boolean }>;
  };
  copilot?: {
    enabled: boolean;
    voice_enabled: boolean;
    press_to_talk: boolean;
    wake_phrase: boolean;
    persona: string;
    voice: string;
    actions: Record<string, string>;
    requires_confirmation: boolean;
  };
  navigation?: {
    enabled: boolean;
    requires_explicit_authorization: boolean;
    max_session_seconds: number;
    free_drive: boolean;
  };
  cost_caps?: { daily_cents: number };
  pilot_flags?: { mapgpt: boolean; atlas: boolean };
  guardrails: {
    navigation_sessions: boolean;
    free_drive: boolean;
    mapgpt: boolean;
    offline_mapbox_packs: boolean;
    permanent_copilot_mutations?: boolean;
  };
}
export interface ExtremeSessionAuthorizeRequest {
  surface: ExtremeSurface;
  trip_id?: string | null;
  checkpoints?: ExtremeCheckpoint[];
  trip_memory?: TripMemory;
  metadata?: Record<string, unknown>;
}
export interface ExtremeSessionAuthorizeResponse {
  authorized: boolean;
  session_id: string;
  expires_at: number;
  max_demo_session_seconds: number;
  navigation_session_authorized: false;
}
export interface ExtremeNavigationAuthorizeRequest {
  surface: 'navigation';
  trip_id?: string | null;
  route_id?: string | null;
  route_summary?: Record<string, unknown>;
  trip_memory?: TripMemory;
  metadata?: Record<string, unknown>;
  acknowledged_billing: boolean;
  navigation_mode?: 'route_guidance' | string;
}
export interface ExtremeNavigationAuthorizeResponse {
  authorized: boolean;
  session_id: string;
  expires_at: number;
  max_navigation_session_seconds: number;
  navigation_session_authorized: true;
  free_drive_authorized: false;
  route_id?: string | null;
}
export interface ExtremeLedgerRequest {
  session_id?: string | null;
  event_type: string;
  surface: ExtremeSurface;
  trip_id?: string | null;
  event_data?: Record<string, unknown>;
}
export interface ExtremeRouteRiskRequest {
  trip_id?: string | null;
  route: Array<{ lat: number; lng: number; day?: number }>;
  checkpoints?: ExtremeCheckpoint[];
  metadata?: Record<string, unknown>;
}
export interface ExtremeRouteRiskResponse {
  enabled: boolean;
  layers: Array<{ id: string; label: string; enabled_by_default?: boolean }>;
  risk_checkpoints: ExtremeCheckpoint[];
  summary: string;
}
export interface ExtremeCopilotCommandRequest {
  session_id?: string | null;
  trip_id?: string | null;
  command: string;
  mode?: 'text' | 'voice' | string;
  context?: Record<string, unknown>;
}
export interface ExtremeCopilotCommandResponse {
  ok: boolean;
  message: string;
  action: {
    id: number;
    type: string;
    label: string;
    status: 'staged' | string;
    requires_confirmation: boolean;
    payload?: Record<string, unknown>;
    map_action?: MapActionRequest;
  };
}
export interface CopilotContext {
  user?: {
    location?: { lat: number; lng: number; accuracy?: number | null } | null;
    location_permission?: 'granted' | 'denied' | 'undetermined' | string;
    heading?: number | null;
    speed?: number | null;
    plan_tier?: string;
    admin?: boolean;
    rig_profile?: Record<string, unknown> | null;
  };
  map?: {
    center?: { lat: number; lng: number } | null;
    zoom?: number;
    bounds?: Record<string, number> | null;
    active_style?: string;
    visible_layers?: string[];
    selected_place?: Record<string, unknown> | null;
    current_results?: Array<Record<string, unknown>>;
    current_result_set_id?: string | null;
    current_place_results?: Array<Record<string, unknown>>;
    current_camp_results?: Array<Record<string, unknown>>;
    current_trail_results?: Array<Record<string, unknown>>;
    visible_result_set_id?: string | null;
    visible_map_features?: Array<MapSelectableFeature>;
    query_context?: Record<string, unknown> | null;
    active_pins?: Array<Record<string, unknown>>;
    current_screen?: string;
  };
  route?: {
    active_route?: boolean;
    destination?: Record<string, unknown> | null;
    eta?: number | null;
    distance?: number | null;
    upcoming_turns?: Array<Record<string, unknown>>;
    route_provider?: string;
    route_id?: string | null;
    nav_mode?: boolean;
    route_ready?: boolean;
    route_scout?: RouteScoutState | Record<string, unknown> | null;
  };
  trip?: {
    active_trip?: string | null;
    selected_day?: number | null;
    route_builder_draft?: Record<string, unknown> | null;
    saved_stops?: Array<Record<string, unknown>>;
    offline_status?: Record<string, unknown>;
    current_screen?: string;
  };
  app?: Record<string, unknown>;
  safety?: Record<string, unknown>;
}
export interface MapSelectableFeature {
  feature_id: string;
  result_id?: string;
  result_set_id?: string;
  result_index: number;
  name: string;
  lat: number;
  lng: number;
  type: string;
  subtype?: string | null;
  source?: string | null;
  source_label?: string | null;
  source_layer?: string | null;
  distance_mi?: number | null;
  screen_x?: number | null;
  screen_y?: number | null;
  screen_position?: 'left' | 'right' | 'top' | 'bottom' | 'center' | string | null;
  confidence?: 'high' | 'medium' | 'low' | string | null;
  aliases?: string[];
  address?: string | null;
  rating?: number | null;
  summary?: string | null;
  raw_feature?: Record<string, unknown> | null;
  place?: Record<string, unknown> | null;
}
export interface RouteScoutStop {
  day: number;
  name: string;
  lat: number;
  lng: number;
  type: 'start' | 'camp' | 'destination' | 'review' | string;
  routePointType?: 'side_stop' | 'break' | 'through';
  routeShapeRole?: 'start' | 'destination' | 'outbound_anchor' | 'return_anchor' | 'overnight' | 'side_stop';
  label?: string;
  description?: string;
  source?: string;
  confidence?: string;
  progress_mi?: number | null;
  camp?: CampsitePin | null;
  reason?: string | null;
  overnight_kind?: 'camp' | 'motel' | 'review' | string | null;
  overnight_style?: 'dispersed' | 'developed' | 'rv' | 'private' | 'unknown' | string | null;
  fit_notes?: string[];
}
export interface RouteScoutState {
  status: 'idle' | 'scouting' | 'needs_input' | 'ready' | 'review' | 'failed' | string;
  message: string;
  question?: string;
  options?: string[];
  operationId?: number | string;
  phase?: 'starting' | 'plotting' | 'windows' | 'camps' | 'services' | 'finalizing' | string;
  phaseLabel?: string;
  progressPct?: number;
  focusTarget?: { name?: string; lat: number; lng: number; zoom?: number } | null;
  previewStops?: RouteScoutStop[];
  startName?: string;
  destinationName?: string;
  days?: number;
  driveHours?: number | null;
  routeStyle?: RouteStyleMode | string;
  campPreference?: string;
  totalMiles?: number;
  totalDurationHours?: number;
  routeCoords?: [number, number][];
  stops?: RouteScoutStop[];
  windows?: RouteCampWindowResult[];
  missingDays?: number[];
  draftArgs?: Record<string, unknown>;
  spoken_summary?: string;
}
export interface MapActionRequest {
  id?: number;
  action_id: string;
  action_type: 'getMapContext' | 'getVisibleMapCandidates' | 'searchPlaces' | 'searchTrails' | 'selectPlace' | 'selectRenderedFeature' | 'selectVisiblePlace' | 'searchAndSelectPlace' | 'openSelectedPlaceCard' | 'routeToSelectedPlace' | 'flyToPlace' | 'zoomMap' | 'setMapZoom' | 'toggleLayer' | 'setMapStyle' | 'buildRoute' | 'modifyRoute' | 'startRouteScout' | 'saveScoutToRouteBuilder' | 'dropPin' | 'saveTrip' | 'downloadOfflineArea' | 'explainVisibleArea' | 'askForConfirmation' | string;
  args: Record<string, unknown>;
  requires_confirmation: boolean;
  cost_class: string;
  surface: ExtremeSurface | string;
  provider: string;
  status?: string;
  label?: string;
}
export interface MapActionResult {
  ok: boolean;
  message: string;
  map_updates: Record<string, unknown>;
  status?: 'staged' | 'confirmed' | 'applied' | 'failed' | 'canceled' | string;
  spoken_summary?: string;
  results?: Array<Record<string, unknown>>;
  selected?: Record<string, unknown> | null;
  requires_confirmation?: boolean;
  selected_place?: Record<string, unknown> | null;
  route_preview?: Record<string, unknown> | null;
  location_status?: Record<string, unknown> | null;
  navigation?: Record<string, unknown> | null;
  route_builder_draft?: Record<string, unknown> | null;
  current_screen?: string | null;
  failure_reason?: string | null;
  ledger_id?: number | null;
  error_code?: string | null;
}
export interface ExtremeCopilotSessionRequest {
  surface?: ExtremeSurface | string;
  trip_id?: string | null;
  context?: CopilotContext;
  metadata?: Record<string, unknown>;
}
export interface ExtremeCopilotSessionResponse {
  ok: boolean;
  session_id: string;
  expires_at: number;
  provider: string;
  voice_enabled: boolean;
  ledger_id?: number;
}
export interface ExtremeCopilotMessageRequest {
  session_id?: string | null;
  trip_id?: string | null;
  message: string;
  mode?: 'text' | 'voice' | string;
  context?: CopilotContext;
  provider?: string;
}
export interface ExtremeCopilotMessageResponse {
  ok: boolean;
  session_id?: string | null;
  provider: string;
  message: string;
  action: MapActionRequest;
  result: MapActionResult;
}
export interface ExtremeCopilotConfirmRequest {
  action_id: number;
  confirmed: boolean;
  client_result?: Record<string, unknown>;
}
export interface ExtremeCopilotConfirmResponse {
  ok: boolean;
  action_id: number;
  status: string;
  confirmed: boolean;
  ledger_id?: number;
}
export interface RealtimeCopilotSessionRequest {
  session_id?: string | null;
  voice?: string;
  mode?: 'push_to_talk' | 'wake_phrase' | string;
  wake_phrase?: boolean;
  context?: CopilotContext;
}
export interface RealtimeCopilotSessionResponse {
  ok?: boolean;
  client_secret?: string | { value?: string; expires_at?: number; [key: string]: unknown };
  session_id?: string;
  expires_at?: number;
  model?: string;
  fallback_model?: string;
  voice?: string;
  provider?: string;
  wake_phrase?: boolean;
  [key: string]: unknown;
}
export interface ExtremeSearchSessionResponse {
  session_token: string;
  temporary_use_only: boolean;
  expires_in_seconds: number;
}
export interface ExtremeSearchSuggestRequest {
  q: string;
  session_token: string;
  proximity?: string;
  origin?: string;
  bbox?: string;
  country?: string;
  types?: string;
  language?: string;
  limit?: number;
}
export interface ExtremeSearchRetrieveRequest {
  mapbox_id: string;
  session_token: string;
  language?: string;
  proximity?: string;
  origin?: string;
}
export interface ExtremeSearchCategoryRequest {
  category: string;
  proximity?: string;
  bbox?: string;
  country?: string;
  language?: string;
  limit?: number;
}
export interface ExtremeSearchReverseRequest {
  lat: number;
  lng: number;
  language?: string;
  limit?: number;
  country?: string;
  types?: string;
}
export interface ExtremeDirectionsRequest {
  coordinates: Array<[number, number]>;
  profile?: 'mapbox/driving-traffic' | 'mapbox/driving' | 'mapbox/walking' | 'mapbox/cycling' | string;
  steps?: boolean;
  alternatives?: boolean;
  annotations?: string;
  exclude?: string;
  language?: string;
  voice_units?: 'imperial' | 'metric' | string;
  overview?: 'full' | 'simplified' | 'false' | string;
  metadata?: Record<string, unknown>;
}
export interface ExtremeSearchResponse {
  suggestions?: any[];
  features?: any[];
  _trailhead?: { temporary_use_only?: boolean; [key: string]: unknown };
  [key: string]: unknown;
}
export interface ExtremeDirectionsResponse {
  routes?: any[];
  waypoints?: any[];
  code?: string;
  message?: string;
  _trailhead?: { engine?: string; temporary_use_only?: boolean; [key: string]: unknown };
  [key: string]: unknown;
}
export interface GeocodePlace {
  name: string;
  lat: number;
  lng: number;
  source?: string;
  place_id?: string;
  provider_place_id?: string;
  feature_type?: string;
  place_types?: string[];
  category?: string;
  relevance?: number;
  country_code?: string | null;
  country?: string | null;
  region?: string | null;
  bbox?: number[] | null;
  confidence?: string;
  score?: number;
}
export interface GeocodeRejectedPlace {
  name?: string;
  lat?: number;
  lng?: number;
  country_code?: string | null;
  feature_type?: string | null;
  place_id?: string | number | null;
  score?: number;
  reason?: string;
}
export interface GeocodeResolveResponse {
  status: 'resolved' | 'ambiguous' | 'mismatch' | 'not_found' | string;
  query: string;
  normalized_query?: string;
  selected?: GeocodePlace | null;
  alternatives?: GeocodePlace[];
  rejected?: GeocodeRejectedPlace[];
  reason?: string;
  countrycodes?: string;
  retry_of?: string;
}
export interface TripResult {
  trip_id: string; plan: TripPlan; campsites: Campsite[]; gas_stations: GasStation[];
  route_pois?: OsmPoi[];
  timeline?: TripTimeline;
  audio_guide?: Record<string, string>;
  route_geometry?: SavedRouteGeometryPayload;
  builder_state?: Record<string, unknown>;
  updated_at?: number;
  version?: number;
}
export interface AccountTripSummary {
  trip_id: string; trip_name: string; states: string[]; duration_days: number; est_miles: number;
  created_at: number; updated_at: number; source?: string; version?: number;
}
export interface SavedRouteGeometryPayload {
  coords: [number, number][];
  steps?: any[];
  legs?: any[];
  totalDistance?: number;
  totalDuration?: number;
  total_distance?: number;
  total_duration?: number;
  tripId?: string | null;
  ts?: number;
  source?: string;
}
export interface TripPlan {
  trip_name: string; overview: string; duration_days: number;
  states: string[]; total_est_miles: number;
  waypoints: Waypoint[]; daily_itinerary: DayPlan[]; logistics: Logistics;
  timeline?: TripTimeline;
  route_preferences?: {
    route_style?: RouteStyleMode;
    camp_preference?: string;
    require_photos?: boolean;
    camp_reuse_policy?: CampReusePolicy;
    region_hint?: string;
    max_daily_drive_hours?: number | null;
  };
  planner_warnings?: string[];
}
export type RouteStyleMode = 'direct' | 'balanced' | 'wild';
export type TripShapeMode = 'one_way' | 'loop' | 'there_and_back';
export type CampReusePolicy = 'different_each_night' | 'same_camp_window' | 'manual';
export interface TripTimelineEvent {
  type: 'start' | 'depart' | 'drive' | 'fuel' | 'poi' | 'overnight' | 'rest' | string;
  title: string;
  description?: string;
  day: number;
  source?: string;
  warning_level?: 'info' | 'review' | 'warn' | string;
  point?: { lat: number; lng: number } | null;
  route_position?: {
    route_progress?: number;
    route_progress_mi?: number;
    route_distance_mi?: number;
    route_segment_index?: number;
  };
  distance_mi?: number;
  road_type?: string;
  quick_actions?: string[];
}
export interface TripTimelineDay {
  day: number;
  title: string;
  summary?: string;
  distance_mi?: number;
  road_type?: string;
  warning_level?: 'info' | 'review' | 'warn' | string;
  events: TripTimelineEvent[];
}
export interface TripTimeline {
  schema_version: number;
  days: TripTimelineDay[];
  warnings?: Array<{ level: string; message?: string }>;
  offline_readiness?: {
    map?: boolean;
    navigation?: boolean;
    places?: boolean;
    topo?: boolean;
    trails?: boolean;
    trip_download?: boolean;
    message?: string;
  };
}
export interface Waypoint {
  day: number; name: string; type: string; description: string;
  land_type: string; notes?: string; lat?: number; lng?: number;
  route_point_type?: 'side_stop' | 'break' | 'through';
  verified_match?: boolean; verified_distance_mi?: number; verified_name?: string;
  verified_source?: string; needs_review?: boolean; verification_note?: string;
  camp_window_start?: number; camp_window_end?: number; camp_window_label?: string;
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
export interface MobileCoverageRecord {
  provider?: string;
  technology?: string;
  availability_class?: string;
  signal?: string | number | null;
  download_mbps?: number | null;
  upload_mbps?: number | null;
  sample_count?: number | null;
  data_date?: string;
  source?: string;
  source_label?: string;
}

export interface MobileCoverageSummary {
  available?: boolean;
  records?: MobileCoverageRecord[];
  modeled_source?: {
    source?: string;
    source_label?: string;
    data_date?: string;
    url?: string;
    status?: string;
  };
  source_label?: string;
  disclaimer?: string;
  last_checked?: number;
}

export interface CampsitePin {
  id: string; name: string; lat: number; lng: number;
  tags: string[]; land_type: string; description: string;
  amenities?: string[]; site_types?: string[];
  photos?: string[] | Array<{ url?: string; source?: string; caption?: string; credit?: string }>;
  photo_url?: string; reservable: boolean; cost?: string; url: string; ada: boolean;
  photo_candidates?: string[] | Array<{ url?: string; source?: string; caption?: string; credit?: string }>;
  hero_photo_url?: string | null; primary_image?: string | null; image_url?: string | null; images?: string[];
  site_media_count?: number; photo_fallback_chain?: string[]; photo_status?: 'official' | 'fallback' | 'missing' | string;
  mobile_coverage?: MobileCoverageSummary | null;
  price_summary?: {
    label?: string; min?: number; median?: number | null; max?: number;
    sample_count?: number; last_year?: number | null; source?: string; freshness?: string;
  };
  things_to_do?: NearbySmartPlace[];
  things_to_see?: NearbySmartPlace[];
  visitor_centers?: NearbySmartPlace[];
  campgrounds_nearby?: NearbySmartPlace[];
  trip_services?: NearbySmartPlace[];
  official_url?: string; booking_url?: string; source_badge?: string; source_freshness?: string; last_checked?: number;
  link_label?: 'Reserve' | 'Official page' | 'Search official site' | string;
  route_distance_mi?: number; route_fit?: string; recommended_day?: number;
  route_progress?: number; route_progress_mi?: number; route_segment_index?: number;
  source?: string; verified_source?: string;
  cache_status?: string; fetched_at?: number; feature_source?: string;
  rating?: number; rating_count?: number; phone?: string; address?: string;
  provider_place_id?: string; place_id?: string;
  provider_notices?: Array<{ label?: string; text?: string }>;
}

function campSourceBadge(camp: Partial<CampsitePin> & Record<string, any>): string {
  const raw = String(camp.source_badge || camp.verified_source || camp.source || camp.feature_source || '').toLowerCase();
  if (raw.includes('ridb') || raw.includes('recreation')) return 'Recreation.gov';
  if (raw.includes('nps')) return 'NPS';
  if (raw.includes('blm')) return 'BLM';
  if (raw.includes('usfs') || raw.includes('forest')) return 'USFS';
  if (raw.includes('mapbox')) return 'Mapbox';
  if (raw.includes('geoapify')) return 'Map data';
  if (raw.includes('mixed')) return 'Mixed source';
  if (raw.includes('osm') || raw.includes('openstreetmap')) return 'OSM';
  if (raw.includes('community')) return 'Community';
  return camp.source_badge || camp.verified_source || 'Camp source';
}

function inferCampLandType(camp: Partial<CampsitePin> & Record<string, any>): string {
  const haystack = [
    camp.land_type, camp.source_badge, camp.verified_source, camp.source, camp.feature_source,
    camp.description, ...(Array.isArray(camp.tags) ? camp.tags : []),
  ].join(' ').toLowerCase();
  if (haystack.includes('private') || haystack.includes('farm') || haystack.includes('ranch') || haystack.includes('winery') || haystack.includes('glamping')) return 'private';
  if (haystack.includes('blm')) return 'BLM';
  if (haystack.includes('usfs') || haystack.includes('forest')) return 'USFS';
  if (haystack.includes('nps') || haystack.includes('national park')) return 'NPS';
  if (haystack.includes('state park')) return 'state';
  if (haystack.includes('dispersed')) return 'dispersed';
  return camp.land_type || 'campground';
}

function canonicalizeCampsitePin(raw: CampsitePin): CampsitePin {
  const camp = { ...(raw || {}) } as CampsitePin & Record<string, any>;
  const tags = Array.isArray(camp.tags) ? camp.tags.filter(Boolean).map(String) : [];
  const amenities = Array.isArray(camp.amenities) ? camp.amenities.filter(Boolean).map(String) : [];
  const siteTypes = Array.isArray(camp.site_types) ? camp.site_types.filter(Boolean).map(String) : [];
  const sourceBadge = campSourceBadge(camp);
  const landType = inferCampLandType(camp);
  const id = String(camp.id || camp.provider_place_id || camp.place_id || `${sourceBadge}:${camp.name}:${camp.lat}:${camp.lng}`);
  const name = String(camp.name || camp.description || 'Camp').trim();
  const description = String(camp.description || (landType === 'private' ? 'Private stay candidate.' : 'Camp candidate.')).trim();
  const url = String(camp.url || camp.booking_url || camp.official_url || '');
  const normalizedTags = Array.from(new Set([
    ...tags,
    'camp',
    landType,
    sourceBadge,
  ].filter(Boolean)));
  return {
    ...camp,
    id,
    name,
    lat: Number(camp.lat),
    lng: Number(camp.lng),
    tags: normalizedTags,
    land_type: landType,
    description,
    amenities,
    site_types: siteTypes.length ? siteTypes : normalizedTags.filter(tag => /tent|rv|cabin|dispersed|private|camp/i.test(tag)),
    reservable: Boolean(camp.reservable || camp.booking_url),
    url,
    ada: Boolean(camp.ada),
    source_badge: sourceBadge,
    verified_source: camp.verified_source || sourceBadge,
    link_label: camp.link_label || (camp.booking_url ? 'Reserve' : camp.official_url ? 'Official page' : 'Search official site'),
  };
}

function canonicalizeCampsitePins(items: CampsitePin[]): CampsitePin[] {
  return (items || [])
    .map(canonicalizeCampsitePin)
    .filter(camp => Number.isFinite(camp.lat) && Number.isFinite(camp.lng) && Math.abs(camp.lat) <= 90 && Math.abs(camp.lng) <= 180);
}
export interface RouteCampWindowInput {
  day: number;
  start: number;
  end: number;
  label: string;
  target_mi: number;
  search_window_mi?: number;
}
export interface RouteCampWindowsRequest {
  route: Array<{ lat: number; lng: number }>;
  windows: RouteCampWindowInput[];
  camp_filters?: string[];
  route_style?: RouteStyleMode | 'adventure';
  camp_preference?: string;
  require_photos?: boolean;
  region_hint?: string;
  camp_reuse_policy?: CampReusePolicy;
  max_daily_drive_hours?: number;
  max_radius?: number;
}
export interface RouteCampWindowResult {
  day: number;
  start: number;
  end: number;
  label: string;
  target_mi?: number;
  search_window_mi?: number;
  camp: CampsitePin | null;
  selected?: CampsitePin | null;
  candidates?: CampsitePin[];
  fallback: { lat: number; lng: number; name: string; description: string } | null;
  strong: boolean;
  confidence?: 'strong' | 'review' | 'missing' | string;
  coverage_status?: 'ready' | 'review' | 'sparse' | string;
  reason?: string;
  reason_short?: string;
  display_name?: string;
  overnight_kind?: 'camp' | 'motel' | 'review' | string;
  overnight_style?: 'dispersed' | 'developed' | 'rv' | 'private' | 'unknown' | string;
  fallback_label?: string;
  fit_notes?: string[];
  search_radius_mi?: number;
  search_passes?: Array<{ name: string; radius_mi: number; filters?: string[]; found: number; kept?: number; target_only?: boolean }>;
  found: number;
  cache_status?: string;
  error?: string;
}
export interface RouteCampWindowsResponse {
  windows: RouteCampWindowResult[];
  errors?: Record<string, string>;
}
export interface CampsiteDetail extends CampsitePin {
  photos: string[]; amenities: string[]; site_types: string[];
  activities: string[]; phone?: string; campsites_count: number;
  campsites?: Array<{
    id?: string; name?: string; type?: string; loop?: string;
    map_card_id?: string; facility_id?: string; lat?: number | null; lng?: number | null;
    max_people?: string; equipment_length?: string; driveway?: string; surface?: string;
    accessible?: boolean; shade?: boolean; fire?: boolean; pets?: boolean; hookups?: boolean;
    check_in?: string; check_out?: string; reserve_type?: string;
    photos?: string[]; photo_url?: string | null;
    source_badge?: string; verified_source?: string;
  }>;
  site_media_count?: number;
  photo_fallback_chain?: string[];
  price_summary?: {
    label?: string; min?: number; median?: number | null; max?: number;
    sample_count?: number; last_year?: number | null; source?: string; freshness?: string;
  };
  things_to_do?: NearbySmartPlace[];
  things_to_see?: NearbySmartPlace[];
  visitor_centers?: NearbySmartPlace[];
  campgrounds_nearby?: NearbySmartPlace[];
  trip_services?: NearbySmartPlace[];
  context_status?: PlaceContextStatus;
  rail_status?: PlaceContextStatus;
  permits?: NearbySmartPlace[];
  tours?: NearbySmartPlace[];
  events?: NearbySmartPlace[];
  links?: Array<{ title?: string; type?: string; description?: string; url?: string; source_badge?: string }>;
  admin_edited?: boolean;
  access_notes?: string;
  bail_out_notes?: string;
  stay_limit?: string;
  reservation_notes?: string;
  source_confidence_notes?: string;
  max_rig_length?: string;
  reviews?: PlaceReview[];
  provider_notices?: Array<{ label?: string; text?: string }>;
  media_source?: 'trailhead' | 'ridb' | 'blm' | 'osm' | 'google' | 'mixed' | string;
}
export interface PlaceContextStatus {
  status?: 'full' | 'partial' | 'empty' | string;
  rail_counts?: Record<string, number>;
  errors?: Record<string, string>;
}
export interface GasStation {
  id: number | string; name: string; lat: number; lng: number;
  fuel_types: string; address: string;
  price?: number; price_source?: string; price_updated_at?: string;
  route_distance_mi?: number; route_fit?: string; recommended_day?: number;
  route_progress?: number; route_progress_mi?: number; route_segment_index?: number;
}
export interface FuelEstimate {
  miles: number;
  mpg: number;
  gallons: number;
  liters: number;
  estimated_cost: number;
  price_per_gallon: number;
  source: string;
  confidence: 'high' | 'medium' | 'estimated' | string;
  updated_at: string;
  unit: 'imperial' | 'metric';
}
export interface Report {
  id: number | string; lat: number; lng: number; type: string; subtype: string;
  description: string; severity: string; upvotes: number; downvotes: number;
  confirmations: number; has_photo: number; cluster_count: number;
  username: string; created_at: number; expires_at: number; waypoint_day?: number;
  source?: 'trailhead' | 'provider' | string; provider?: string | null; provider_id?: string;
  updated_at?: number; road_name?: string | null; confidence?: number; geometry?: unknown;
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
  type: 'camp' | 'water' | 'trail' | 'trailhead' | 'viewpoint' | 'peak' | 'pass' | 'glacier' | 'bridge' | 'checkpost' | 'settlement' | 'hot_spring' | 'fuel' | 'propane' | 'dump' | 'shower' | 'laundromat' | 'lodging' | 'private_stay' | 'farm_stay' | 'ranch' | 'winery' | 'glamping' | 'private_camp' | 'food' | 'grocery' | 'mechanic' | 'parking' | 'attraction' | 'hardware' | 'camping' | 'medical' | 'parts' | 'wifi' | 'poi'; subtype?: string; elevation?: string;
  display_type?: string;
  source?: string;
  source_label?: string;
  provider_place_id?: string;
  place_id?: string;
  address?: string;
  phone?: string;
  website?: string;
  official_url?: string;
  booking_url?: string;
  registration_url?: string;
  summary?: string;
  description?: string;
  details?: string;
  start_date?: string;
  end_date?: string;
  price?: string;
  open_now?: boolean | null;
  hours?: string[];
  open_hours?: string[] | string | Record<string, unknown> | null;
  hours_label?: string | null;
  rating?: number;
  rating_count?: number;
  average_rating?: number;
  review_count?: number;
  google_maps_uri?: string;
  attribution?: string;
  profile_id?: string;
  photo_url?: string | null;
  primary_image?: string | null;
  other_images?: string[];
  mapbox_id?: string | null;
  mapbox_categories?: string[];
  brand?: string | null;
  external_ids?: Record<string, unknown>;
  routable_points?: Array<{ name?: string | null; lat: number; lng: number }>;
  eta_minutes?: number | null;
  distance_meters?: number | null;
  enrichment_source?: 'mapbox_standard' | 'mapbox_searchbox_rest' | 'mapbox_search_sdk' | 'none' | string;
  enrichment_status?: 'pending' | 'enriched' | 'unavailable' | 'failed' | string;
  length_mi?: number | null;
  rich_detail_available?: boolean;
  rich_detail_locked?: boolean;
  rich_detail_reason?: string;
  activities?: string[];
  source_badge?: string;
  source_freshness?: string;
  photo_status?: string;
  last_checked?: number;
  route_distance_mi?: number; route_fit?: string;
  route_progress?: number; route_progress_mi?: number; route_segment_index?: number;
  waterbody_name?: string;
  waterbody_type?: string;
  access?: string;
  craft?: string;
  fishing_score?: number;
  fishing_score_label?: string;
  fish_species?: string[] | string;
  stocking_notes?: string;
  regulations_url?: string;
  gauge_id?: string;
  gauge_url?: string;
  flow_cfs?: number;
  gage_height_ft?: number;
  observed_at?: number | string;
  chart_source?: string;
  chart_url?: string;
  weather_url?: string;
  tides_url?: string;
  safety_url?: string;
  navigation_feature?: string;
  hazard_type?: string;
  mark_color?: string;
  mark_shape?: string;
  light_character?: string;
  depth_ft?: number;
  max_draft_ft?: number;
  navigation_note?: string;
  aliases?: string[];
  search_terms?: string[];
  local_terms?: string[];
  trek_name?: string;
  stage_name?: string;
  safety_note?: string;
}

export interface WaterNavigationLineFeature {
  type: 'Feature';
  geometry: { type: 'LineString'; coordinates: [number, number][] } | { type: 'Point'; coordinates: [number, number] };
  properties: {
    id?: string;
    name?: string;
    kind?: 'marked_channel' | 'recommended_track' | 'range_line' | 'traffic_lane' | 'deep_water_route' | 'water_follow_line' | 'navigation_aid' | 'channel_marker' | 'water_hazard' | 'anchorage' | 'lock' | string;
    subtype?: string;
    label?: string;
    code?: string;
    marker_color?: string;
    navigation_feature?: string;
    hazard_type?: string;
    mark_color?: string;
    mark_shape?: string;
    light_character?: string;
    depth?: string;
    depth_ft?: number;
    source?: string;
    source_freshness?: string;
    seamark_type?: string;
    waterway?: string;
    max_draft?: string;
    max_draft_ft?: number;
    navigation_note?: string;
  };
}
export interface MarineChartSource {
  id: string;
  name: string;
  role: string;
  status: string;
  offline: boolean;
  confidence: string;
  url?: string;
  station_id?: string;
  note?: string;
}
export interface HydroCoverageRegion {
  id: string;
  name: string;
  file?: string;
  available?: boolean;
  confidence?: string;
  status?: string;
  offline?: boolean;
  coverage_note?: string;
  counts?: Record<string, number>;
}
export interface HydroCoverageProfile {
  available: boolean;
  coverage: 'available' | 'live_only' | 'planned' | 'none' | string;
  regions: HydroCoverageRegion[];
  counts: {
    contours?: number;
    shallow_zones?: number;
    hazards?: number;
    labels?: number;
  };
  layers?: string[];
  warning?: string;
}
export interface MarineChartProfile {
  mode: string;
  region: string;
  sources: MarineChartSource[];
  provider_capabilities?: Record<string, {
    provider_class?: string;
    status?: string;
    offline?: string;
    coverage_confidence?: string;
    supports_depth_ranges?: boolean;
    supports_hazards?: boolean;
    supports_structure?: boolean;
    supports_corridors?: boolean;
    note?: string;
  }>;
  licensed_chart?: {
    available?: boolean;
    status?: string;
    offline_ready?: boolean;
    coverage_confidence?: string;
    note?: string;
  };
  offline_status?: Record<string, string>;
  depth_ranges?: Array<{ id: string; label: string; hazard?: boolean }>;
  hazard_summary?: {
    hydro_hazards?: number;
    open_seamark_hazards?: string | number;
    source_confidence?: string;
  };
  corridor_availability?: {
    status?: string;
    licensed_provider_required_for_premium_confidence?: boolean;
    turn_by_turn?: boolean;
    certified_navigation?: boolean;
  };
  hydro?: HydroCoverageProfile | null;
  recommended_next_pipeline?: string;
  disclaimer?: string;
}
export interface HydroChartProfileResponse {
  mode: string;
  hydro?: HydroCoverageProfile | null;
  chart_profile?: MarineChartProfile;
}
export interface WaterConditionsResponse {
  station?: {
    id: string;
    name: string;
    lat: number;
    lng: number;
    provider?: string;
    source_url?: string;
    distance_mi?: number;
  } | null;
  observed_at?: number | null;
  wind_dir_deg?: number | null;
  wind_kt?: number | null;
  wind_mph?: number | null;
  gust_kt?: number | null;
  gust_mph?: number | null;
  wave_height_m?: number | null;
  wave_height_ft?: number | null;
  dominant_period_s?: number | null;
  average_period_s?: number | null;
  air_temp_c?: number | null;
  water_temp_c?: number | null;
  pressure_hpa?: number | null;
  crossing_risk?: { score?: number; label?: string };
  source?: string;
  source_url?: string;
  note?: string;
  error?: string;
  navigation_note?: string;
}
export interface WaterNavigationLinesResponse {
  type: 'FeatureCollection';
  features: WaterNavigationLineFeature[];
  source?: string;
  generated_at?: number;
  note?: string;
  error?: string;
  counts?: {
    lines?: number;
    points?: number;
    hazards?: number;
    aids?: number;
    recommended_tracks?: number;
  };
  chart_profile?: MarineChartProfile;
}
export interface WaterSpotCard {
  id: string;
  name: string;
  kind: 'structure' | 'access' | 'spot' | string;
  lat: number;
  lng: number;
  species_targets?: string[];
  depth_range_ft?: { min?: number; max?: number; source?: string };
  structure?: string[];
  best_context?: string[];
  actions?: string[];
  source?: string;
  source_confidence?: string;
  navigation_note?: string;
}
export interface WaterSpotCardsResponse {
  mode: string;
  region: string;
  cards: WaterSpotCard[];
  empty_state?: string | null;
  source_disclosure?: string;
}
export interface FishingConditionsResponse {
  mode: string;
  station?: WaterConditionsResponse['station'];
  solunar?: {
    status?: string;
    major_window?: string;
    minor_window?: string;
    source?: string;
  };
  weather_source?: string;
  source_disclosure?: string;
  navigation_note?: string;
}
export interface SuggestedWaterCorridorResponse {
  mode: string;
  status: string;
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  distance_mi: number;
  eta_minutes: number;
  conflicts: Array<{ kind: string; severity: string; note: string; lat?: number; lng?: number }>;
  source_confidence: string;
  source_disclosure?: string;
  route_points?: Array<{ name: string; lat: number; lng: number; kind?: string; note?: string }>;
  chart_source?: string;
  live_offline_gaps?: string[];
  turn_by_turn: boolean;
  certified_navigation: boolean;
  navigation_note: string;
}
export interface PlacePhoto {
  url: string;
  credit?: string;
  source?: string;
  caption?: string;
}
export interface PlaceReview {
  authorName: string;
  rating?: number;
  relativeTime?: string;
  text?: string;
  profileUrl?: string;
  photoUrl?: string;
  source?: string;
}
export interface CanonicalPlacePayload {
  id?: string | number;
  name: string;
  lat: number;
  lng: number;
  source?: string;
  source_label?: string;
  source_place_id?: string;
  provider_place_id?: string;
  place_id?: string;
  category?: string;
  type?: string;
  subtype?: string;
  official_url?: string;
  url?: string;
  website?: string;
  photo_url?: string | null;
  hero_photo_url?: string | null;
  summary?: string;
  description?: string;
  address?: string;
  phone?: string;
  rating?: number;
  rating_count?: number;
  reservable?: boolean;
  booking_url?: string;
  reservation_notes?: string;
  amenities?: string[];
  activities?: string[];
  photos?: Array<PlacePhoto | string>;
  metadata?: Record<string, unknown>;
}
export interface TrailheadPlacePhoto {
  id: number;
  trailhead_place_id?: string;
  username?: string;
  comment_id?: number | null;
  object_key?: string | null;
  url: string;
  caption?: string | null;
  source?: string;
  status?: string;
  credits_awarded?: number;
  created_at: number;
}
export interface PlaceComment {
  id: number;
  username: string;
  body: string;
  created_at: number;
  photos?: TrailheadPlacePhoto[];
}
export interface TrailheadPlace {
  trailhead_place_id: string;
  source: string;
  source_label?: string;
  source_place_id?: string;
  source_priority?: number;
  name: string;
  lat: number;
  lng: number;
  category?: string;
  subtype?: string;
  official_url?: string;
  hero_photo_url?: string | null;
  hero_photo_source?: string;
  provider_ids?: Record<string, string>;
  provenance?: Record<string, unknown>;
  display_metadata?: Record<string, unknown>;
  photos: TrailheadPlacePhoto[];
  comments: PlaceComment[];
  last_seen?: number;
}
export interface PlaceCommentPayload {
  body: string;
  photo_data?: string;
  photo_caption?: string;
}
export interface PlacePhotoPayload {
  photo_data: string;
  caption?: string;
  comment_id?: number;
  content_type?: string;
}
export interface PlaceEditSuggestionPayload {
  place_name?: string;
  field: string;
  value: string;
  note?: string;
}
export interface PlaceReservationAlert {
  id: number;
  trailhead_place_id: string;
  user_id: number;
  start_date?: string | null;
  end_date?: string | null;
  party_size?: number | null;
  source?: string | null;
  booking_url?: string | null;
  status: string;
  created_at: number;
  updated_at: number;
}
export interface PlaceReservationAlertPayload {
  start_date?: string;
  end_date?: string;
  party_size?: number;
}
export interface PlaceReservationStatus {
  trailhead_place_id: string;
  source: string;
  source_label?: string;
  official: boolean;
  reservable: boolean;
  booking_url?: string;
  check_availability_url?: string;
  link_label?: 'Reserve' | 'Official page' | 'Search official site' | string;
  link_confidence?: 'verified' | 'source' | 'fallback' | 'none' | string;
  availability_supported: boolean;
  alert_supported: boolean;
  alerts: PlaceReservationAlert[];
  source_freshness?: string;
  notes?: string;
}
export interface PlaceDetail extends OsmPoi {
  photos?: PlacePhoto[];
  reviews?: PlaceReview[];
  hours?: string[];
  international_phone?: string;
  source_footer?: string;
  distance_mi?: number;
  summary?: string;
  access_note?: string;
}
export interface NearbySmartPlace extends OsmPoi {
  source: string;
  source_label?: string;
  confidence?: 'high' | 'medium' | 'low' | string;
  distance_mi?: number;
  summary?: string;
  access_note?: string;
  photo_url?: string | null;
}
export interface NearbySmartPackResponse {
  center: { lat: number; lng: number };
  radius: number;
  categories: string[];
  places: NearbySmartPlace[];
  errors?: Record<string, string>;
  category_access?: {
    explore_group?: string;
    explore_unlocked?: boolean;
    unlock_cost?: number;
    locked_categories?: string[];
  };
}
export interface MapCardResolveRequest {
  kind?: 'search' | 'place' | 'poi' | 'camp' | 'trail' | string;
  id?: string;
  source?: string;
  source_label?: string;
  selection_source?: string;
  feature_id?: string;
  provider_place_id?: string;
  place_id?: string;
  source_layer?: string | null;
  screen_x?: number | null;
  screen_y?: number | null;
  screen_position?: string | null;
  selection_confidence?: string | null;
  raw_feature?: Record<string, unknown> | null;
  name: string;
  lat: number;
  lng: number;
  type?: string;
  subtype?: string;
  photo_url?: string | null;
  summary?: string;
  address?: string;
  rating?: number;
  rating_count?: number;
  country_code?: string | null;
  country?: string | null;
  region?: string | null;
  bbox?: number[] | null;
  route?: [number, number][];
}
export interface MapCardResolveResponse {
  card: PlaceDetail;
  camp?: CampsitePin | null;
  camp_detail?: CampsiteDetail | null;
  photos?: PlacePhoto[];
  sections?: Array<{ type: string; title: string; items?: unknown[] }>;
  related?: {
    places?: NearbySmartPlace[];
    camps?: NearbySmartPlace[];
    things_to_do?: NearbySmartPlace[];
    things_to_see?: NearbySmartPlace[];
    visitor_centers?: NearbySmartPlace[];
    campgrounds_nearby?: NearbySmartPlace[];
    trip_services?: NearbySmartPlace[];
    trails?: TrailProfile[];
    context_status?: PlaceContextStatus;
    rail_status?: PlaceContextStatus;
  };
  context_status?: PlaceContextStatus;
  rail_status?: PlaceContextStatus;
  partial?: boolean;
  errors?: Record<string, string>;
  timings?: Record<string, number>;
  display_source_label?: string;
  enriched_by?: string;
  cache_status?: string;
  photo_candidates?: PlacePhoto[];
  locked_sections?: Array<{ type: string; title: string; items?: unknown[] }>;
}
export interface TrailClaim {
  source: string;
  last_checked?: number;
  note?: string;
}
export interface TrailPhoto {
  url: string;
  thumbnail_url?: string;
  caption?: string;
  credit?: string;
  source?: string;
  provider?: string;
  license?: string;
  source_url?: string;
  commercial_restricted?: boolean;
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
  route_type?: string;
  elevation_gain_ft?: number | null;
  best_season?: string;
  warnings?: string[];
  feature_type?: string;
  feature_label?: string;
  trekking_only?: boolean;
  guide_required?: boolean;
  permit_note?: string;
  glacier_crossing?: boolean;
  altitude_ft?: number | null;
  season_window?: string;
  source_confidence?: string;
  route_target?: { name?: string; lat: number; lng: number; reason?: string } | null;
  geometry_ref?: string;
  area_id?: string;
  area_name?: string;
  activities: string[];
  land_manager?: string;
  geometry?: GeoJSON.FeatureCollection | null;
  trailheads: Array<{ name?: string; lat: number; lng: number; source?: string }>;
  official_url?: string;
  photos: TrailPhoto[];
  source: string;
  source_label: string;
  source_pack?: {
    quality?: string;
    primary?: string;
    official_url?: string;
    sources?: { title?: string; publisher?: string; url?: string; kind?: string }[];
    photos?: TrailPhoto[];
    license?: string;
    geometry_ref?: string;
    source_note?: string;
  };
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
  official_url?: string;
  booking_url?: string;
  photo_url?: string | null;
  reservable?: boolean;
  tags?: string[];
  amenities?: string[];
  site_types?: string[];
  source_badge?: string;
  source_freshness?: string;
  last_checked?: number;
  waterbody_name?: string;
  waterbody_type?: string;
  access?: string;
  craft?: string;
  fishing_score?: number;
  fishing_score_label?: string;
  fish_species?: string[] | string;
  stocking_notes?: string;
  regulations_url?: string;
  gauge_id?: string;
  gauge_url?: string;
  flow_cfs?: number;
  gage_height_ft?: number;
  observed_at?: number | string;
  chart_source?: string;
  chart_url?: string;
  weather_url?: string;
  tides_url?: string;
  safety_url?: string;
  navigation_feature?: string;
  hazard_type?: string;
  mark_color?: string;
  mark_shape?: string;
  light_character?: string;
  depth_ft?: number;
  max_draft_ft?: number;
  navigation_note?: string;
  aliases?: string[];
  search_terms?: string[];
  local_terms?: string[];
  trek_name?: string;
  stage_name?: string;
  safety_note?: string;
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
  explore_group?: 'camping' | 'glamping' | 'huts_lodging' | 'trails' | 'parks' | 'water' | 'services' | string;
  state: string;
  region: string;
  lat?: number | null;
  lng?: number | null;
  rank: number;
  hero_rank?: number;
  tags: string[];
  badges?: string[];
  hook: string;
  short_description: string;
  thumbnail_url?: string | null;
  image_url?: string | null;
  image_credit?: string;
  image_license?: string;
  source_url?: string | null;
  source_title?: string;
  distance_m?: number;
  day?: number;
}
export interface ExplorePlaceProfile {
  id: string;
  summary: ExplorePlaceSummary;
  card?: {
    title?: string;
    headline?: string;
    summary?: string;
    highlight?: string;
    region?: string;
    facts?: string[];
  };
  category?: string;
  subcategories?: string[];
  sources?: { title?: string; publisher?: string; name?: string; url?: string; kind?: string }[];
  quality?: string;
  quality_score?: number;
  search_aliases?: string[];
  best_season?: string;
  access?: Record<string, unknown>;
  safety?: Record<string, unknown>;
  trails?: ExploreTrailCard[];
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
    booking_url?: string;
    license?: string;
    image_asset?: string;
  };
  facts: { coordinates?: string; source_url?: string; source_title?: string; official_url?: string; source_quality?: string; last_updated?: number };
  attribution: string;
}
export interface ExploreTrailCard {
  id: string;
  trail_id?: string;
  title: string;
  difficulty: 'Easy' | 'Moderate' | 'Hard' | string;
  feature_type?: string;
  feature_label?: string;
  trekking_only?: boolean;
  guide_required?: boolean;
  permit_note?: string;
  glacier_crossing?: boolean;
  altitude_ft?: number | null;
  season_window?: string;
  route_target?: { name?: string; lat: number; lng: number; reason?: string } | null;
  distance_mi: number;
  route_type: string;
  elevation_gain_ft?: number;
  typical_time?: string;
  area?: string;
  image_url?: string;
  image_credit?: string;
  image_license?: string;
  summary: string;
  description?: string;
  best_season?: string;
  dogs?: string;
  bikes?: string;
  tags?: string[];
  highlights?: string[];
  lat?: number | null;
  lng?: number | null;
  source_url?: string;
  source_label?: string;
  geometry_ref?: string;
  photos?: TrailPhoto[];
  source_pack?: TrailProfile['source_pack'];
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
export interface ExploreCampgroundsResponse {
  place_id: string;
  center: { lat: number; lng: number; name?: string };
  radius_mi: number;
  count: number;
  campgrounds: CampsitePin[];
}
export interface WikiArticle {
  title: string; lat: number; lng: number; dist_m: number; extract: string; url: string;
}
export type ExcursionType = 'trail' | 'trailhead' | 'ohv' | 'viewpoint' | 'peak' | 'hot_spring' | 'park' | 'historic' | 'climbing' | 'water' | 'attraction' | 'poi';
export interface ExcursionCandidate {
  id: string;
  name: string;
  type: ExcursionType | string;
  subtype?: string;
  lat: number;
  lng: number;
  source: string;
  source_label: string;
  summary?: string;
  why_go?: string;
  access_notes?: string;
  risk_notes?: string;
  best_for?: string;
  distance_from_route_mi?: number;
  route_distance_mi?: number;
  route_progress?: number;
  route_progress_mi?: number;
  route_segment_index?: number;
  recommended_day?: number;
  detour_mi?: number;
  drive_time_min?: number;
  day_fit?: string;
  offline_ready?: boolean;
  source_confidence?: 'high' | 'medium' | 'low' | string;
  sensitive_location?: boolean;
  length_mi?: number | null;
  difficulty?: string;
  activities?: string[];
}
export interface ExcursionNearbyRequest {
  center: { lat: number; lng: number };
  radius?: number;
  categories?: string[];
  route?: [number, number][];
  day?: number;
  source_context?: string;
}
export interface ExcursionNearbyResponse {
  center: { lat: number; lng: number };
  radius: number;
  categories: string[];
  excursions: ExcursionCandidate[];
  errors?: Record<string, string>;
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
  trailhead_units?: {
    mode: 'imperial' | 'metric';
    temperature_label: string;
    wind_label: string;
    precipitation_label: string;
    distance_unit: 'miles' | 'kilometers';
  };
  daily: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_sum: number[];
    precipitation_probability_max?: number[];
    windspeed_10m_max: number[];
    wind_gusts_10m_max?: number[];
    weathercode: number[];
    uv_index_max?: number[];
  };
  current?: {
    time?: string;
    temperature_2m?: number;
    relative_humidity_2m?: number;
    apparent_temperature?: number;
    precipitation?: number;
    weather_code?: number;
    wind_speed_10m?: number;
    wind_direction_10m?: number;
    wind_gusts_10m?: number;
  };
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    relative_humidity_2m?: number[];
    precipitation_probability?: number[];
    precipitation?: number[];
    weather_code?: number[];
    wind_speed_10m?: number[];
  };
  air_quality?: {
    available?: boolean;
    current?: {
      us_aqi?: number;
      pm2_5?: number;
      pm10?: number;
      ozone?: number;
      nitrogen_dioxide?: number;
    };
    hourly?: Record<string, Array<number | null> | string[]>;
  };
  source_label?: string;
  health_summary?: {
    air_quality_source?: string;
    advisory?: string;
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
export interface CampComment {
  id: number;
  username: string;
  body: string;
  created_at: number;
}
export interface CampCommentPayload {
  camp_name: string;
  lat: number;
  lng: number;
  body: string;
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
  access_notes: string;
  bail_out_notes: string;
  stay_limit: string;
  reservation_notes: string;
  source_confidence_notes: string;
  max_rig_length: string;
}
