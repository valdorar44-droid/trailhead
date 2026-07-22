export type SearchSurfaceV2 =
  | 'map'
  | 'explore'
  | 'route_editor'
  | 'trail_hub'
  | 'downloads'
  | 'unknown';

export type SearchIntentV2 = 'any' | 'destination' | 'place' | 'trail' | 'camp' | 'service';
export type SearchScopeV2 = 'global' | 'viewport' | 'nearby' | 'route' | 'offline';
export type SearchPersistencePolicyV2 = 'canonical' | 'durable_external' | 'temporary';

export type SearchCenterV2 = {
  lat: number;
  lng: number;
};

export type SearchBoundsV2 = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type SearchFilterValueV2 = string | number | boolean | null | Array<string | number | boolean>;

export type SearchRequestV2 = {
  query: string;
  surface?: SearchSurfaceV2;
  intent?: SearchIntentV2;
  scope?: SearchScopeV2;
  center?: SearchCenterV2;
  bounds?: SearchBoundsV2;
  route_ref?: string;
  radius_meters?: number;
  categories?: string[];
  filters?: Record<string, SearchFilterValueV2>;
  cursor?: string;
  limit?: number;
  session_id?: string;
  include_external?: boolean;
  /**
   * Explicit provider selection. These values are copied verbatim from one
   * SearchResultV2 returned in this session; clients must never construct a
   * provider detail reference.
   */
  selected_result_id?: string;
  selected_detail_ref?: string;
};

export type SearchProvenanceV2 = {
  provider: string;
  source_label: string;
  provider_result_id?: string | null;
  attribution?: string | null;
  temporary_use_only: boolean;
};

export type SearchResultV2 = {
  result_id: string;
  canonical_place_id?: string | null;
  title: string;
  subtitle?: string | null;
  kind: string;
  categories: string[];
  coordinates?: SearchCenterV2 | null;
  parent?: string | null;
  distance_meters?: number | null;
  provenance: SearchProvenanceV2;
  persistence_policy: SearchPersistencePolicyV2;
  detail_ref?: string | null;
  score: number;
  match_reason: string;
};

export type SearchPageV2 = {
  query: string;
  results: SearchResultV2[];
  next_cursor?: string | null;
  has_more: boolean;
  source_counts: Record<string, number>;
  revision: string;
  elapsed_ms: number;
};

export type SearchResolveResponseV2 = {
  query: string;
  status: 'resolved' | 'ambiguous' | 'not_found';
  selected?: SearchResultV2 | null;
  alternatives: SearchResultV2[];
  reason: string;
  revision: string;
};

export type SearchPageModeV2 = 'suggest' | 'results';
