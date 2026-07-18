import type { OriginalAssetV1, OriginalManifestV1, OriginalStopV1 } from './types';

export class OriginalManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OriginalManifestError';
  }
}

function assertFinite(value: unknown, label: string, minimum?: number) {
  if (!Number.isFinite(value) || (minimum != null && Number(value) < minimum)) {
    throw new OriginalManifestError(`${label} must be a finite number${minimum != null ? ` >= ${minimum}` : ''}.`);
  }
}

function assertText(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new OriginalManifestError(`${label} is required.`);
  }
}

function validateAsset(asset: OriginalAssetV1, index: number) {
  const label = `assets[${index}]`;
  assertText(asset.id, `${label}.id`);
  assertText(asset.kind, `${label}.kind`);
  assertText(asset.path, `${label}.path`);
  assertText(asset.mime_type, `${label}.mime_type`);
  assertFinite(asset.bytes, `${label}.bytes`, 1);
  if (!/^[a-f0-9]{64}$/i.test(String(asset.sha256 || ''))) {
    throw new OriginalManifestError(`${label}.sha256 must be a SHA-256 hex digest.`);
  }
}

function validateStop(stop: OriginalStopV1, index: number, routeDistance: number, assetIds: Set<string>) {
  const label = `stops[${index}]`;
  assertText(stop.id, `${label}.id`);
  assertFinite(stop.sequence, `${label}.sequence`, 0);
  assertText(stop.title, `${label}.title`);
  assertFinite(stop.coordinates?.lat, `${label}.coordinates.lat`, -90);
  assertFinite(stop.coordinates?.lng, `${label}.coordinates.lng`, -180);
  if (Math.abs(stop.coordinates.lat) > 90 || Math.abs(stop.coordinates.lng) > 180) {
    throw new OriginalManifestError(`${label}.coordinates are outside valid latitude/longitude bounds.`);
  }
  assertText(stop.transcript, `${label}.transcript`);
  assertText(stop.audio_asset_id, `${label}.audio_asset_id`);
  if (!assetIds.has(stop.audio_asset_id)) {
    throw new OriginalManifestError(`${label}.audio_asset_id does not reference an asset.`);
  }
  if (stop.artwork_asset_id && !assetIds.has(stop.artwork_asset_id)) {
    throw new OriginalManifestError(`${label}.artwork_asset_id does not reference an asset.`);
  }
  assertFinite(stop.audio_duration_s, `${label}.audio_duration_s`, 1);
  assertFinite(stop.trigger?.enter_radius_m, `${label}.trigger.enter_radius_m`, 1);
  assertFinite(stop.trigger?.exit_radius_m, `${label}.trigger.exit_radius_m`, stop.trigger.enter_radius_m);
  assertFinite(stop.trigger?.lead_time_s, `${label}.trigger.lead_time_s`, 0);
  assertFinite(stop.trigger?.route_progress_start_m, `${label}.trigger.route_progress_start_m`, 0);
  assertFinite(stop.trigger?.route_progress_end_m, `${label}.trigger.route_progress_end_m`, stop.trigger.route_progress_start_m);
  if (stop.trigger.route_progress_end_m > routeDistance + 1) {
    throw new OriginalManifestError(`${label}.trigger route window exceeds route distance.`);
  }
  if (stop.trigger.approach_bearing_deg != null) {
    assertFinite(stop.trigger.approach_bearing_deg, `${label}.trigger.approach_bearing_deg`, 0);
    if (stop.trigger.approach_bearing_deg >= 360) {
      throw new OriginalManifestError(`${label}.trigger.approach_bearing_deg must be below 360.`);
    }
    assertFinite(stop.trigger.bearing_tolerance_deg, `${label}.trigger.bearing_tolerance_deg`, 1);
    if (Number(stop.trigger.bearing_tolerance_deg) > 180) {
      throw new OriginalManifestError(`${label}.trigger.bearing_tolerance_deg must not exceed 180.`);
    }
  }
  if (!Array.isArray(stop.citations) || stop.citations.length === 0) {
    throw new OriginalManifestError(`${label}.citations must contain at least one reviewed source.`);
  }
  stop.citations.forEach((citation, citationIndex) => {
    assertText(citation.title, `${label}.citations[${citationIndex}].title`);
    assertText(citation.url, `${label}.citations[${citationIndex}].url`);
    if (citation.role != null && citation.role !== 'story' && citation.role !== 'operational') {
      throw new OriginalManifestError(`${label}.citations[${citationIndex}].role must be story or operational.`);
    }
    if (
      citation.authority != null
      && citation.authority !== 'official'
      && citation.authority !== 'authoritative'
    ) {
      throw new OriginalManifestError(`${label}.citations[${citationIndex}].authority is invalid.`);
    }
    if (citation.scope != null && (
      !Array.isArray(citation.scope)
      || citation.scope.some(value => typeof value !== 'string' || !value.trim())
    )) {
      throw new OriginalManifestError(`${label}.citations[${citationIndex}].scope must contain non-empty strings.`);
    }
  });
}

export function validateOriginalManifest(input: unknown): OriginalManifestV1 {
  if (!input || typeof input !== 'object') throw new OriginalManifestError('Manifest must be an object.');
  const manifest = input as OriginalManifestV1;
  if (manifest.schema_version !== 1) throw new OriginalManifestError('Unsupported Originals manifest schema.');
  assertText(manifest.manifest_id, 'manifest_id');
  assertText(manifest.pack_id, 'pack_id');
  assertFinite(manifest.version, 'version', 1);
  assertText(manifest.locale, 'locale');
  assertText(manifest.title, 'title');
  if (manifest.route?.geometry?.type !== 'LineString' || !Array.isArray(manifest.route.geometry.coordinates)) {
    throw new OriginalManifestError('route.geometry must be a LineString.');
  }
  if (manifest.route.geometry.coordinates.length < 2) {
    throw new OriginalManifestError('route.geometry needs at least two coordinates.');
  }
  manifest.route.geometry.coordinates.forEach((coordinate, index) => {
    if (!Array.isArray(coordinate) || coordinate.length < 2) {
      throw new OriginalManifestError(`route.geometry.coordinates[${index}] is invalid.`);
    }
    assertFinite(coordinate[0], `route.geometry.coordinates[${index}][0]`);
    assertFinite(coordinate[1], `route.geometry.coordinates[${index}][1]`);
    if (Math.abs(coordinate[0]) > 180 || Math.abs(coordinate[1]) > 90) {
      throw new OriginalManifestError(`route.geometry.coordinates[${index}] is outside valid bounds.`);
    }
  });
  assertFinite(manifest.route.distance_m, 'route.distance_m', 1);
  assertFinite(manifest.route.duration_s, 'route.duration_s', 1);
  if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) {
    throw new OriginalManifestError('assets must contain the offline bundle assets.');
  }
  manifest.assets.forEach(validateAsset);
  const assetIds = new Set(manifest.assets.map(asset => asset.id));
  if (assetIds.size !== manifest.assets.length) throw new OriginalManifestError('Asset IDs must be unique.');
  if (!Array.isArray(manifest.stops) || manifest.stops.length === 0) {
    throw new OriginalManifestError('stops must contain at least one story.');
  }
  manifest.stops.forEach((stop, index) => validateStop(stop, index, manifest.route.distance_m, assetIds));
  const stopIds = new Set(manifest.stops.map(stop => stop.id));
  const sequences = new Set(manifest.stops.map(stop => stop.sequence));
  if (stopIds.size !== manifest.stops.length) throw new OriginalManifestError('Stop IDs must be unique.');
  if (sequences.size !== manifest.stops.length) throw new OriginalManifestError('Stop sequences must be unique.');
  assertText(manifest.offline_map?.region_id, 'offline_map.region_id');
  assertFinite(manifest.offline_map?.estimated_bytes, 'offline_map.estimated_bytes', 0);
  assertFinite(manifest.offline_map?.min_zoom, 'offline_map.min_zoom', 0);
  assertFinite(manifest.offline_map?.max_zoom, 'offline_map.max_zoom', manifest.offline_map.min_zoom);
  return manifest;
}

export function orderedOriginalStops(manifest: Pick<OriginalManifestV1, 'stops'>): OriginalStopV1[] {
  return [...manifest.stops].sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));
}
