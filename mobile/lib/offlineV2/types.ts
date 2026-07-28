/**
 * Versioned, renderer-aware contracts for complete offline bundles.
 *
 * These types are intentionally not wired into the legacy downloads UI yet.
 * They form the compatibility boundary for the V2 backend and mobile rollout.
 */

export const OFFLINE_BUNDLE_SCHEMA_VERSION = 2 as const;

export type OfflineMapRenderer = 'rnmapbox' | 'maplibre';

export type OfflineArtifactStatus =
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'verifying'
  | 'ready'
  | 'partial'
  | 'needs_update'
  | 'repair_required'
  | 'error';

export type OfflineArtifactKind =
  | 'map_style'
  | 'map_tiles'
  | 'places'
  | 'trails'
  | 'search_index'
  | 'routing'
  | 'contours'
  | 'thumbnail'
  | 'media';

export type OfflineArtifactStorage =
  | 'file'
  | 'renderer_style_pack'
  | 'renderer_tile_region'
  | 'renderer_legacy_pack';

export type OfflineBoundsV2 = Readonly<{
  west: number;
  south: number;
  east: number;
  north: number;
}>;

export type OfflineTrailScopeV2 = Readonly<{
  kind: 'trail';
  trail_id: string;
  geometry_revision: string;
  corridor_m: number;
}>;

export type OfflineBundleArtifactV2 = Readonly<{
  id: string;
  kind: OfflineArtifactKind;
  storage: OfflineArtifactStorage;
  required: boolean;
  revision: string;
  bytes: number;
  size_kind: 'exact' | 'estimated';
  integrity: 'sha256' | 'renderer_probe';
  sha256?: string;
  uri?: string;
  media_type?: string;
  record_count?: number;
}>;

export type OfflineBundleCapabilitiesV2 = Readonly<{
  map: boolean;
  places: boolean;
  trails: boolean;
  search: boolean;
  routing: boolean;
  contours: boolean;
  media: boolean;
}>;

export type OfflineBundleRendererV2 = Readonly<{
  id: OfflineMapRenderer;
  /** Server-approved style identifier selected by the active physical map. */
  style_id?: string;
  style_uri: string;
  style_revision: string;
  style_pack_id: string;
  tile_region_id: string;
}>;

export type OfflineBundleManifestV2 = Readonly<{
  schema_version: typeof OFFLINE_BUNDLE_SCHEMA_VERSION;
  bundle_id: string;
  revision: string;
  manifest_sha256: string;
  created_at: string;
  renderer: OfflineBundleRendererV2;
  bounds: OfflineBoundsV2;
  min_zoom: number;
  max_zoom: number;
  scope?: OfflineTrailScopeV2;
  artifacts: readonly OfflineBundleArtifactV2[];
  capabilities: OfflineBundleCapabilitiesV2;
  required_storage_bytes: number;
  source_attribution: readonly string[];
  license_ids: readonly string[];
  replaces_revisions?: readonly string[];
}>;

export type OfflineArtifactStateV2 = Readonly<{
  artifact_id: string;
  status: OfflineArtifactStatus;
  received_bytes: number;
  total_bytes: number;
  updated_at_ms: number;
  local_uri?: string;
  error_code?: string;
  error_message?: string;
}>;

export type OfflineRendererInstallationV2 = Readonly<{
  renderer: OfflineMapRenderer;
  style_pack_id?: string;
  tile_region_id?: string;
  native_pack_name?: string;
  legacy_pack_name?: string;
}>;

export type OfflineBundleInstallationV2 = Readonly<{
  schema_version: typeof OFFLINE_BUNDLE_SCHEMA_VERSION;
  bundle_id: string;
  revision: string;
  manifest_sha256: string;
  directory_uri: string;
  artifacts: Readonly<Record<string, OfflineArtifactStateV2>>;
  renderer: OfflineRendererInstallationV2;
  installed_at_ms: number;
  verified_at_ms?: number;
}>;

export type OfflineBundleCommitReceiptV2 = Readonly<{
  schema_version: typeof OFFLINE_BUNDLE_SCHEMA_VERSION;
  bundle_id: string;
  revision: string;
  manifest_sha256: string;
  verified_required_artifact_ids: readonly string[];
  renderer: Readonly<{
    id: OfflineMapRenderer;
    style_ready: true;
    tiles_ready: true;
    render_probe_ready: true;
  }>;
  verified_at_ms: number;
}>;

export type OfflineBundleInspectionV2 = Readonly<{
  status: OfflineArtifactStatus;
  ready: boolean;
  artifact_states: Readonly<Record<string, OfflineArtifactStateV2>>;
  capability_readiness: OfflineBundleCapabilitiesV2;
  diagnostics: readonly string[];
}>;
