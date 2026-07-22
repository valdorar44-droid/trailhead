import type { OsmPoi } from '../api';
import type { SearchRequestV2, SearchResultV2, SearchSurfaceV2 } from '../searchV2/types';
import { createExpoOfflineV2Persistence } from './expoAdapters';
import { markOfflineV2ArtifactsConsumed } from './consumption';
import { searchExpoOfflineIndex, validateExpoOfflineSearchIndex } from './sqliteIndex';
import {
  type DownloadedSearchResultPoiV2,
  offlineInstallationRevisionV2,
  searchDownloadedOfflineIndexesV2,
} from './offlineSearchPresentation';
import { trailGeometryRepresentativePointV2 } from './trailGeometry';
import type {
  OfflineBoundsV2,
  OfflineBundleManifestV2,
} from './types';

export type ExpoOfflineV2SearchIndex = Readonly<{
  bundle_id: string;
  revision: string;
  path: string;
  bounds: OfflineBoundsV2;
}>;

export type ExpoOfflineV2Poi = DownloadedSearchResultPoiV2 & Readonly<{
  offline_entity_kind: 'place' | 'trail_profile';
}>;

export type ExpoOfflineV2Catalog = Readonly<{
  owner_scope: string;
  /** Changes whenever the installed bundle set or a repaired copy changes. */
  installation_revision: string;
  places: readonly ExpoOfflineV2Poi[];
  trail_features: GeoJSON.FeatureCollection;
  search_indexes: readonly ExpoOfflineV2SearchIndex[];
  diagnostics: readonly string[];
}>;

export type ExpoOfflineV2CatalogRefresh = Readonly<{
  catalog: ExpoOfflineV2Catalog;
  installation_revision: string;
  changed: boolean;
}>;

const EMPTY_FEATURE_COLLECTION: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

function finiteCoordinate(value: unknown, low: number, high: number) {
  const number = Number(value);
  return Number.isFinite(number) && number >= low && number <= high ? number : null;
}

function within(bounds: OfflineBoundsV2, lat: number, lng: number) {
  return lat >= bounds.south && lat <= bounds.north && lng >= bounds.west && lng <= bounds.east;
}

const POI_TYPES = new Set([
  'camp', 'water', 'trail', 'trailhead', 'viewpoint', 'peak', 'pass', 'glacier', 'bridge',
  'checkpost', 'settlement', 'hot_spring', 'fuel', 'propane', 'dump', 'shower', 'laundromat',
  'lodging', 'private_stay', 'farm_stay', 'ranch', 'winery', 'glamping', 'private_camp',
  'food', 'grocery', 'mechanic', 'parking', 'attraction', 'hardware', 'camping', 'medical',
  'parts', 'wifi', 'poi',
]);

function poiType(value: unknown): OsmPoi['type'] {
  const clean = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return (POI_TYPES.has(clean) ? clean : 'poi') as OsmPoi['type'];
}

function documentToPoi(
  document: Record<string, unknown>,
  bounds: OfflineBoundsV2,
  fallbackType: 'place' | 'trail',
): ExpoOfflineV2Poi | null {
  const lat = finiteCoordinate(document.lat, -90, 90);
  const lng = finiteCoordinate(document.lng, -180, 180);
  const id = String(document.id || '').trim();
  const name = String(document.name || document.label || '').trim();
  if (lat == null || lng == null || !id || !name || !within(bounds, lat, lng)) return null;
  const type = poiType(fallbackType === 'trail'
    ? 'trail'
    : document.type || document.category || document.kind || document.subtype);
  return {
    ...(document as Partial<OsmPoi>),
    id,
    name,
    lat,
    lng,
    type,
    subtype: String(document.subtype || document.category || '').trim() || undefined,
    source: 'trailhead_offline_v2',
    source_label: String(document.source_label || 'Downloaded').trim() || 'Downloaded',
    source_badge: String(document.source_badge || document.source_label || 'Downloaded').trim() || 'Downloaded',
    profile_id: fallbackType === 'trail' ? id : String(document.profile_id || '').trim() || undefined,
    raw: document,
    offline_entity_kind: fallbackType === 'trail' ? 'trail_profile' : 'place',
  } as ExpoOfflineV2Poi;
}

function parsePlaces(
  text: string,
  manifest: OfflineBundleManifestV2,
  expectedRecords?: number,
) {
  const payload = JSON.parse(text) as { schema_version?: unknown; count?: unknown; places?: unknown };
  if (payload.schema_version !== 2 || !Array.isArray(payload.places)) {
    throw new Error('The offline places artifact has an unsupported format.');
  }
  const count = Number(payload.count);
  if (!Number.isSafeInteger(count) || count !== payload.places.length || (expectedRecords != null && count !== expectedRecords)) {
    throw new Error('The offline places artifact record count does not match its manifest.');
  }
  return payload.places
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
    .map(item => documentToPoi(item, manifest.bounds, 'place'))
    .filter((item): item is ExpoOfflineV2Poi => Boolean(item));
}

function parseTrails(
  text: string,
  manifest: OfflineBundleManifestV2,
  expectedRecords?: number,
) {
  const payload = JSON.parse(text) as GeoJSON.FeatureCollection & { schema_version?: unknown; count?: unknown };
  if (payload.type !== 'FeatureCollection' || payload.schema_version !== 2 || !Array.isArray(payload.features)) {
    throw new Error('The offline trails artifact has an unsupported format.');
  }
  const count = Number(payload.count);
  if (!Number.isSafeInteger(count) || count !== payload.features.length || (expectedRecords != null && count !== expectedRecords)) {
    throw new Error('The offline trails artifact record count does not match its manifest.');
  }
  const features: GeoJSON.Feature[] = [];
  const pois: ExpoOfflineV2Poi[] = [];
  for (const feature of payload.features) {
    if (!feature || feature.type !== 'Feature' || !feature.geometry) continue;
    const properties = feature.properties && typeof feature.properties === 'object'
      ? { ...feature.properties } as Record<string, unknown>
      : {};
    const representative = trailGeometryRepresentativePointV2(feature.geometry, manifest.bounds);
    if (!representative) continue;
    const [lng, lat] = representative;
    const id = String(properties.id || feature.id || '').trim();
    const name = String(properties.name || properties.label || 'Trail').trim();
    const normalizedProperties = {
      ...properties,
      id,
      name,
      lat,
      lng,
      kind: 'trail',
      offline_bundle_id: manifest.bundle_id,
      offline_revision: manifest.revision,
    };
    features.push({ ...feature, properties: normalizedProperties });
    const poi = documentToPoi(normalizedProperties, manifest.bounds, 'trail');
    if (poi) pois.push(poi);
  }
  return { features, pois };
}

export async function loadExpoOfflineV2Catalog(ownerScope: string): Promise<ExpoOfflineV2Catalog> {
  const persistence = createExpoOfflineV2Persistence(ownerScope);
  const installations = await persistence.repository.listCurrentInstallations();
  const installationRevision = expoOfflineV2InstallationRevision(installations);
  const places = new Map<string, ExpoOfflineV2Poi>();
  const trailFeatures = new Map<string, GeoJSON.Feature>();
  const searchIndexes: ExpoOfflineV2SearchIndex[] = [];
  const diagnostics: string[] = [];

  for (const installation of installations) {
    const manifest = await persistence.repository.getManifest(installation.bundle_id, installation.revision);
    if (!manifest || manifest.manifest_sha256 !== installation.manifest_sha256) {
      diagnostics.push(`${installation.bundle_id}: manifest verification failed.`);
      continue;
    }
    for (const artifact of manifest.artifacts.filter(item => item.storage === 'file')) {
      const state = installation.artifacts[artifact.id];
      if (state?.status !== 'ready' || !state.local_uri) continue;
      try {
        if (artifact.kind === 'places') {
          for (const place of parsePlaces(await persistence.storage.readText(state.local_uri), manifest, artifact.record_count)) {
            if (!places.has(place.id)) places.set(place.id, place);
          }
          markOfflineV2ArtifactsConsumed(ownerScope, manifest.bundle_id, manifest.revision, ['places']);
        } else if (artifact.kind === 'trails') {
          const parsed = parseTrails(await persistence.storage.readText(state.local_uri), manifest, artifact.record_count);
          for (const feature of parsed.features) {
            const id = String(feature.id || feature.properties?.id || '');
            if (id && !trailFeatures.has(id)) trailFeatures.set(id, feature);
          }
          for (const place of parsed.pois) {
            if (!places.has(place.id)) places.set(place.id, place);
          }
          markOfflineV2ArtifactsConsumed(ownerScope, manifest.bundle_id, manifest.revision, ['trails']);
        } else if (artifact.kind === 'search_index') {
          await validateExpoOfflineSearchIndex(state.local_uri, artifact.record_count);
          searchIndexes.push({
            bundle_id: manifest.bundle_id,
            revision: manifest.revision,
            path: state.local_uri,
            bounds: manifest.bounds,
          });
          markOfflineV2ArtifactsConsumed(ownerScope, manifest.bundle_id, manifest.revision, ['search_index']);
        }
      } catch (error) {
        diagnostics.push(`${manifest.bundle_id} ${artifact.kind}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  return Object.freeze({
    owner_scope: ownerScope,
    installation_revision: installationRevision,
    places: Object.freeze([...places.values()]),
    trail_features: Object.freeze({
      type: 'FeatureCollection',
      features: Object.freeze([...trailFeatures.values()]),
    }) as GeoJSON.FeatureCollection,
    search_indexes: Object.freeze(searchIndexes),
    diagnostics: Object.freeze(diagnostics),
  });
}

export async function searchExpoOfflineV2Catalog(
  catalog: ExpoOfflineV2Catalog,
  request: SearchRequestV2,
  surface: SearchSurfaceV2,
  queryIndex: typeof searchExpoOfflineIndex = searchExpoOfflineIndex,
): Promise<SearchResultV2[]> {
  return searchDownloadedOfflineIndexesV2({
    request,
    surface,
    indexes: catalog.search_indexes,
    canonical: catalog.places,
    queryIndex,
  });
}

/** Deterministic installed-content fingerprint suitable for view refresh checks. */
export const expoOfflineV2InstallationRevision = offlineInstallationRevisionV2;

/**
 * Always rereads repository pointers; call when Search opens so a newly
 * installed, repaired, updated, or removed bundle cannot leave stale results.
 */
export async function refreshExpoOfflineV2Catalog(
  ownerScope: string,
  previousInstallationRevision?: string | null,
): Promise<ExpoOfflineV2CatalogRefresh> {
  const catalog = await loadExpoOfflineV2Catalog(ownerScope);
  return Object.freeze({
    catalog,
    installation_revision: catalog.installation_revision,
    changed: previousInstallationRevision !== catalog.installation_revision,
  });
}

/** Canonical V2 rows win identity conflicts; legacy-only detail remains additive. */
export function mergeOfflinePoiInventory(
  canonical: readonly OsmPoi[],
  legacy: readonly OsmPoi[],
) {
  const rows = new Map<string, OsmPoi>();
  const identity = (item: OsmPoi) => String(item.id || `${item.name}:${item.lat.toFixed(5)}:${item.lng.toFixed(5)}`);
  for (const item of canonical) rows.set(identity(item), item);
  for (const item of legacy) {
    const id = identity(item);
    const current = rows.get(id);
    rows.set(id, current ? ({ ...item, ...current } as OsmPoi) : item);
  }
  return [...rows.values()];
}

export const EMPTY_EXPO_OFFLINE_V2_CATALOG: ExpoOfflineV2Catalog = Object.freeze({
  owner_scope: 'anonymous',
  installation_revision: 'empty',
  places: Object.freeze([]),
  trail_features: EMPTY_FEATURE_COLLECTION,
  search_indexes: Object.freeze([]),
  diagnostics: Object.freeze([]),
});
