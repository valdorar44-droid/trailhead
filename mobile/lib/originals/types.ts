export type OriginalContentKind = 'original_drive';

export type OriginalBoundsV1 = {
  north: number;
  south: number;
  east: number;
  west: number;
};

export type OriginalRouteV1 = {
  profile: string;
  direction: string;
  geometry: {
    type: 'LineString';
    coordinates: [number, number][];
  };
  bounds: OriginalBoundsV1;
  distance_m: number;
  duration_s: number;
};

export type OriginalCitationV1 = {
  title: string;
  url: string;
  publisher?: string;
  reviewed_at?: string;
};

export type OriginalTriggerV1 = {
  enter_radius_m: number;
  exit_radius_m: number;
  lead_time_s: number;
  route_progress_start_m: number;
  route_progress_end_m: number;
  approach_bearing_deg?: number;
  bearing_tolerance_deg?: number;
};

export type OriginalStopV1 = {
  id: string;
  sequence: number;
  title: string;
  coordinates: { lat: number; lng: number };
  explore_place_id?: string;
  transcript: string;
  audio_asset_id: string;
  audio_duration_s: number;
  artwork_asset_id?: string;
  trigger: OriginalTriggerV1;
  citations: OriginalCitationV1[];
};

export type OriginalAssetKind = 'audio' | 'image' | 'transcript' | 'route' | 'other' | string;

export type OriginalAssetV1 = {
  id: string;
  kind: OriginalAssetKind;
  path: string;
  mime_type: string;
  bytes: number;
  sha256: string;
};

export type OriginalOfflineMapV1 = {
  region_id: string;
  bounds: OriginalBoundsV1;
  min_zoom: number;
  max_zoom: number;
  estimated_bytes: number;
};

export type OriginalManifestV1 = {
  schema_version: 1;
  manifest_id: string;
  pack_id: string;
  version: number;
  locale: string;
  title: string;
  route: OriginalRouteV1;
  stops: OriginalStopV1[];
  assets: OriginalAssetV1[];
  offline_map: OriginalOfflineMapV1;
  safety: {
    summary: string;
    emergency_note: string;
    disclaimers: string[];
  };
  access: {
    surface: string;
    vehicle: string;
    fees: string;
    accessibility_notes: string;
  };
  season: {
    recommended_months: number[];
    closures_note: string;
  };
  review: {
    editorial_status: string;
    field_drive_completed_at: string;
    source_review_completed_at: string;
  };
};

export type OriginalManifestPreviewStopV1 = Pick<
  OriginalStopV1,
  'id' | 'sequence' | 'title' | 'coordinates'
>;

export type OriginalManifestPreviewV1 = {
  schema_version: 1;
  manifest_id: string;
  pack_id: string;
  version: number;
  locale: string;
  title: string;
  route: OriginalRouteV1;
  stops: OriginalManifestPreviewStopV1[];
  offline_map?: OriginalOfflineMapV1;
  safety: OriginalManifestV1['safety'];
  access: OriginalManifestV1['access'];
  season: OriginalManifestV1['season'];
};

export type OriginalSummary = {
  id: string;
  slug: string;
  content_kind: OriginalContentKind;
  version: number;
  title: string;
  summary: string;
  price_credits: number;
  explorer_price_credits: number;
  free: boolean;
  coverage_region: string;
  public_metadata: Record<string, unknown>;
  published_at: number | string;
  featured: boolean;
};

export type OriginalDetail = OriginalSummary & {
  manifest_preview: OriginalManifestPreviewV1;
};

export type OriginalCatalogResponse = {
  items: OriginalSummary[];
  next_cursor: string | null;
};

export type OriginalEntitlement = {
  id?: number | string;
  pack_id: string;
  version: number;
  user_id?: number;
  trip_id?: string | null;
  access_type?: string;
  acquired_at?: number | string;
  [key: string]: unknown;
};

export type OriginalAuthenticatedAcquisition = {
  guest_access?: false;
  entitlement: OriginalEntitlement;
  pack: OriginalSummary;
  trip: Record<string, unknown>;
  already_owned: boolean;
  replayed: boolean;
  credit_balance: number;
};

export type OriginalGuestAcquisition = {
  guest_access: true;
  access_type: 'guest_free';
  pack: OriginalSummary;
  manifest_path: string;
};

export type OriginalAcquisition = OriginalAuthenticatedAcquisition | OriginalGuestAcquisition;

export type OriginalOwnedResponse = {
  items: OriginalAuthenticatedAcquisition[];
};

export type OriginalLocalAccessV1 = {
  schema_version: 1;
  pack_id: string;
  version: number;
  slug: string;
  title: string;
  owner_scope: OriginalOwnerScope;
  access_type: 'guest_free' | 'entitled' | 'admin_preview';
  manifest_path?: string;
  claimed_at_ms: number;
  updated_at_ms: number;
};

export type OriginalOwnerScope = 'guest' | `account:${string}`;
export type OriginalSessionStatus = 'ready' | 'active' | 'paused' | 'completed' | 'stopped';
export type OriginalTrackingState = 'initializing' | 'on_route' | 'off_route' | 'poor_accuracy';
export type OriginalDownloadState = 'missing' | 'downloading' | 'ready' | 'corrupt';
export type OriginalPermissionState = 'unknown' | 'foreground' | 'background' | 'denied';

export type OriginalTriggerRuntimeStateV1 = {
  route_initialized: boolean;
  candidate_stop_id: string | null;
  candidate_entered_at_ms: number | null;
  candidate_sample_count: number;
  candidate_last_sample_at_ms: number | null;
};

export type OriginalSessionV1 = {
  schema_version: 1;
  session_id: string;
  pack_id: string;
  version: number;
  manifest_id: string;
  owner_scope: OriginalOwnerScope;
  status: OriginalSessionStatus;
  tracking_state: OriginalTrackingState;
  download_state: OriginalDownloadState;
  permission_state: OriginalPermissionState;
  triggered_stop_ids: string[];
  completed_stop_ids: string[];
  skipped_stop_ids: string[];
  missed_stop_ids: string[];
  queued_stop_id: string | null;
  current_stop_id: string | null;
  current_audio_position_ms: number;
  last_projected_route_progress_m: number | null;
  last_route_distance_m: number | null;
  user_paused: boolean;
  /** Present only while a terminal story is being replayed manually. */
  manual_replay_return_status?: OriginalSessionStatus | null;
  manual_replay_stop_id?: string | null;
  trigger_state: OriginalTriggerRuntimeStateV1;
  started_at_ms: number | null;
  updated_at_ms: number;
  completed_at_ms: number | null;
};

export type OriginalLocationSample = {
  lat: number;
  lng: number;
  accuracy_m: number | null;
  heading_deg?: number | null;
  speed_mps?: number | null;
  timestamp_ms: number;
};

export type OriginalTriggerEvent =
  | { type: 'gps_quality_changed'; state: 'poor_accuracy' | 'on_route' }
  | { type: 'route_state_changed'; state: 'off_route' | 'on_route'; distance_m: number }
  | { type: 'stops_missed'; stop_ids: string[] }
  | { type: 'stop_armed'; stop_id: string }
  | { type: 'stop_triggered'; stop_id: string }
  | { type: 'stop_queued'; stop_id: string }
  | { type: 'session_completed' };

export type OriginalTriggerDecisionCode =
  | 'inactive'
  | 'user_paused'
  | 'poor_accuracy'
  | 'route_unavailable'
  | 'off_route'
  | 'queue_full'
  | 'no_remaining_stops'
  | 'complete'
  | 'before_window'
  | 'after_window'
  | 'outside_radius'
  | 'missing_bearing'
  | 'wrong_bearing'
  | 'armed'
  | 'waiting_for_fixes'
  | 'waiting_for_dwell'
  | 'triggered'
  | 'queued'
  | 'missed';

/**
 * Read-only explanation of the decision made for a location fix. Values are
 * produced by the same gates that mutate the trigger session, so diagnostics
 * and runtime behavior cannot disagree about why a cue did or did not fire.
 */
export type OriginalTriggerDecisionDiagnostic = Readonly<{
  code: OriginalTriggerDecisionCode;
  message: string;
  stop_id: string | null;
  missed_stop_ids: readonly string[];
  session_status: OriginalSessionStatus;
  accuracy: Readonly<{
    actual_m: number | null;
    maximum_m: number;
  }>;
  route: Readonly<{
    projected_progress_m: number | null;
    distance_from_route_m: number | null;
    maximum_distance_from_route_m: number;
  }>;
  window: Readonly<{
    authored_start_m: number;
    effective_start_m: number;
    end_m: number;
  }> | null;
  radius: Readonly<{
    distance_to_stop_m: number;
    enter_radius_m: number;
    exit_radius_m: number;
  }> | null;
  bearing: Readonly<{
    actual_deg: number | null;
    required_deg: number;
    tolerance_deg: number;
    difference_deg: number | null;
  }> | null;
  wait: Readonly<{
    sample_count: number;
    required_sample_count: number;
    elapsed_ms: number;
    required_elapsed_ms: number;
  }> | null;
}>;

export type OriginalTriggerEvaluation = {
  session: OriginalSessionV1;
  events: OriginalTriggerEvent[];
  projected_route_progress_m: number | null;
  distance_from_route_m: number | null;
  decision: OriginalTriggerDecisionDiagnostic;
};
