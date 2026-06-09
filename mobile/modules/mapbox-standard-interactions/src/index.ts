import { EventEmitter, requireOptionalNativeModule } from 'expo-modules-core';

const M = requireOptionalNativeModule('TrailheadMapboxStandardInteractions');
const emitter = M ? new EventEmitter(M) : null;

export type StandardFeatureTap = {
  source: 'mapbox_standard_feature';
  featureset: 'standardPoi' | 'standardPlaceLabels' | 'standardBuildings' | string;
  feature_id?: string | null;
  mapbox_id?: string | null;
  name?: string | null;
  class?: string | null;
  category?: string | null;
  group?: string | null;
  maki?: string | null;
  lat: number;
  lng: number;
  screen_x: number;
  screen_y: number;
  screen_position: string;
  selection_confidence: 'high' | 'medium' | 'low' | string;
  properties?: Record<string, unknown>;
};

export type MapboxPlaceEnrichmentRequest = {
  name?: string;
  lat: number;
  lng: number;
  mapbox_id?: string | null;
  category?: string | null;
  radius_meters?: number;
};

export type MapboxPlaceEnrichment = {
  id?: string;
  mapbox_id?: string;
  name?: string;
  lat?: number;
  lng?: number;
  source?: 'mapbox_search_sdk' | string;
  address?: string;
  description?: string;
  phone?: string;
  website?: string;
  rating?: number;
  average_rating?: number;
  review_count?: number;
  rating_count?: number;
  open_hours?: string[] | string | Record<string, unknown>;
  hours_label?: string;
  primary_image?: string;
  other_images?: string[];
  categories?: string[];
  category_ids?: string[];
  routable_points?: Array<{ name?: string; lat: number; lng: number }>;
  distance_meters?: number;
  eta_minutes?: number;
  metadata?: Record<string, unknown>;
};

export async function enableMapboxStandardInteractions(): Promise<boolean> {
  return M?.enable ? M.enable() : false;
}

export async function disableMapboxStandardInteractions(): Promise<boolean> {
  return M?.disable ? M.disable() : false;
}

export function addStandardFeatureTapListener(listener: (event: StandardFeatureTap) => void) {
  return (emitter as any)?.addListener('onStandardFeatureTap', listener) ?? { remove() {} };
}

export async function enrichMapboxPlace(data: MapboxPlaceEnrichmentRequest): Promise<MapboxPlaceEnrichment | null> {
  return M?.enrichPlace ? M.enrichPlace(data) : null;
}
