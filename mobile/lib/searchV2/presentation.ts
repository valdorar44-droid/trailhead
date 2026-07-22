import type { SearchRequestV2, SearchResultV2, SearchSurfaceV2 } from './types';

export type SearchablePlaceV2 = {
  id?: string | number | null;
  name?: string | null;
  lat?: number | null;
  lng?: number | null;
  type?: string | null;
  subtype?: string | null;
  address?: string | null;
  source?: string | null;
  source_label?: string | null;
};

export type SearchV2LegacyPlace = {
  name: string;
  lat: number;
  lng: number;
  id?: string;
  result_id: string;
  place_id?: string;
  source: string;
  source_label: string;
  type: string;
  subtype?: string;
  category?: string;
  feature_type?: string;
  address?: string;
  summary?: string;
  distance_meters?: number | null;
};

export type SearchV2DisplayPlace = Omit<SearchV2LegacyPlace, 'lat' | 'lng'> & {
  lat?: number;
  lng?: number;
  /** True when this provider row must be resolved after the user presses it. */
  resolution_required: boolean;
};

export function searchResultV2ToDisplayPlace(result: SearchResultV2): SearchV2DisplayPlace {
  const lat = typeof result.coordinates?.lat === 'number' && Number.isFinite(result.coordinates.lat)
    ? result.coordinates.lat
    : undefined;
  const lng = typeof result.coordinates?.lng === 'number' && Number.isFinite(result.coordinates.lng)
    ? result.coordinates.lng
    : undefined;
  const sourceLabel = cleanLabel(result.provenance?.source_label) || cleanLabel(result.kind) || 'Place';
  return {
    name: result.title,
    lat,
    lng,
    id: result.canonical_place_id || result.result_id,
    result_id: result.result_id,
    place_id: result.canonical_place_id || undefined,
    source: result.persistence_policy === 'canonical' ? 'trailhead_search' : result.provenance.provider || 'search',
    source_label: sourceLabel,
    type: result.kind || result.categories?.[0] || 'place',
    subtype: result.categories?.[0] || undefined,
    category: result.categories?.[0] || undefined,
    feature_type: result.kind || undefined,
    address: result.subtitle || result.parent || undefined,
    summary: result.subtitle || undefined,
    distance_meters: result.distance_meters,
    resolution_required: lat == null || lng == null,
  };
}

export function searchResultV2ToLegacyPlace(result: SearchResultV2): SearchV2LegacyPlace | null {
  const display = searchResultV2ToDisplayPlace(result);
  if (display.lat == null || display.lng == null) return null;
  const { resolution_required: _resolutionRequired, ...place } = display;
  return {
    ...place,
    lat: display.lat,
    lng: display.lng,
  };
}

export function offlineSearchResultsV2(
  request: SearchRequestV2,
  places: SearchablePlaceV2[],
  surface: SearchSurfaceV2,
): SearchResultV2[] {
  const query = normalize(request.query);
  if (!query) return [];
  const tokens = query.split(/\s+/).filter(Boolean);
  const limit = Math.max(1, Math.min(30, Math.round(request.limit ?? 10)));
  return places
    .map((place, index) => {
      const name = String(place.name || '').trim();
      const normalizedName = normalize(name);
      const subtitle = [place.subtype, place.address].map(cleanLabel).filter(Boolean).join(' · ');
      const haystack = normalize([name, place.type, place.subtype, place.address, place.source_label].filter(Boolean).join(' '));
      let score = 0;
      if (normalizedName === query) score += 120;
      if (normalizedName.startsWith(query)) score += 80;
      else if (normalizedName.includes(query)) score += 60;
      if (haystack.includes(query)) score += 30;
      for (const token of tokens) {
        if (normalizedName.includes(token)) score += 12;
        else if (haystack.includes(token)) score += 6;
      }
      return { place, index, name, subtitle, score };
    })
    .filter(row => row.name && row.score > 0 && Number.isFinite(Number(row.place.lat)) && Number.isFinite(Number(row.place.lng)))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map(({ place, name, subtitle, score, index }) => {
      const stableId = String(place.id ?? `${Number(place.lat).toFixed(5)}:${Number(place.lng).toFixed(5)}:${index}`);
      const kind = cleanKind(place.type || place.subtype || 'place');
      return {
        result_id: `offline:${stableId}`,
        canonical_place_id: place.id == null ? null : String(place.id),
        title: name,
        subtitle: subtitle || null,
        kind,
        categories: Array.from(new Set([kind, cleanKind(place.subtype)].filter(Boolean))),
        coordinates: { lat: Number(place.lat), lng: Number(place.lng) },
        parent: place.address || null,
        distance_meters: null,
        provenance: {
          provider: 'trailhead_offline',
          source_label: cleanLabel(place.source_label) || 'Downloaded',
          provider_result_id: null,
          temporary_use_only: false,
        },
        persistence_policy: 'canonical',
        detail_ref: place.id == null ? null : `${surface}:${place.id}`,
        score,
        match_reason: 'offline_match',
      };
    });
}

function normalize(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function cleanLabel(value: unknown): string {
  const raw = String(value || '').trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (!raw) return '';
  return raw.replace(/\b\w/g, character => character.toUpperCase());
}

function cleanKind(value: unknown): string {
  return normalize(value).replace(/\s+/g, '_');
}
