import {
  OFFLINE_BUNDLE_SCHEMA_VERSION,
  type OfflineArtifactKind,
  type OfflineBundleArtifactV2,
  type OfflineBundleManifestV2,
} from './types';

const SHA256_HEX = /^[a-f0-9]{64}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T/;

export class OfflineBundleManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfflineBundleManifestError';
  }
}

export function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && SHA256_HEX.test(value);
}

function nonEmpty(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new OfflineBundleManifestError(`${label} is required.`);
  }
}

function validateArtifact(artifact: OfflineBundleArtifactV2, index: number) {
  const label = `artifacts[${index}]`;
  nonEmpty(artifact.id, `${label}.id`);
  nonEmpty(artifact.revision, `${label}.revision`);
  if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes < 0) {
    throw new OfflineBundleManifestError(`${label}.bytes must be a non-negative safe integer.`);
  }
  if (artifact.storage === 'file') {
    if (typeof artifact.uri !== 'string' || !artifact.uri.trim()) {
      throw new OfflineBundleManifestError(`${label}.uri is required for file artifacts.`);
    }
    let deliveryUri: URL | null = null;
    try {
      deliveryUri = artifact.uri.startsWith('/') ? null : new URL(artifact.uri);
    } catch {
      throw new OfflineBundleManifestError(`${label}.uri must be a trusted HTTPS or offline API URL.`);
    }
    const relativeDelivery = artifact.uri.startsWith('/api/offline/bundles/')
      && !artifact.uri.includes('?') && !artifact.uri.includes('#');
    const httpsDelivery = Boolean(deliveryUri
      && deliveryUri.protocol === 'https:'
      && !deliveryUri.username
      && !deliveryUri.password
      && !deliveryUri.search
      && !deliveryUri.hash);
    if (!relativeDelivery && !httpsDelivery) {
      throw new OfflineBundleManifestError(`${label}.uri must be a trusted HTTPS or offline API URL.`);
    }
    if (artifact.size_kind !== 'exact' || artifact.integrity !== 'sha256' || !isSha256Hex(artifact.sha256)) {
      throw new OfflineBundleManifestError(`${label} must use exact size and SHA-256 integrity.`);
    }
  } else {
    if (artifact.uri != null || artifact.sha256 != null) {
      throw new OfflineBundleManifestError(`${label} renderer artifacts cannot have a URI or checksum.`);
    }
    if (artifact.size_kind !== 'estimated' || artifact.integrity !== 'renderer_probe') {
      throw new OfflineBundleManifestError(`${label} must use renderer-probe integrity.`);
    }
  }
  if (artifact.record_count != null && (!Number.isSafeInteger(artifact.record_count) || artifact.record_count < 0)) {
    throw new OfflineBundleManifestError(`${label}.record_count must be a non-negative safe integer.`);
  }
}

function capabilityArtifactKinds(capability: keyof OfflineBundleManifestV2['capabilities']): OfflineArtifactKind[] {
  switch (capability) {
    case 'map': return ['map_style', 'map_tiles'];
    case 'places': return ['places'];
    case 'trails': return ['trails'];
    case 'search': return ['search_index'];
    case 'routing': return ['routing'];
    case 'contours': return ['contours'];
    case 'media': return ['thumbnail', 'media'];
  }
}

export function validateOfflineBundleManifest(input: OfflineBundleManifestV2): OfflineBundleManifestV2 {
  if (!input || input.schema_version !== OFFLINE_BUNDLE_SCHEMA_VERSION) {
    throw new OfflineBundleManifestError('Offline bundle schema_version must be 2.');
  }
  nonEmpty(input.bundle_id, 'bundle_id');
  nonEmpty(input.revision, 'revision');
  if (!isSha256Hex(input.manifest_sha256)) {
    throw new OfflineBundleManifestError('manifest_sha256 must be a SHA-256 hex digest.');
  }
  if (typeof input.created_at !== 'string' || !ISO_DATE.test(input.created_at) || !Number.isFinite(Date.parse(input.created_at))) {
    throw new OfflineBundleManifestError('created_at must be an ISO-8601 timestamp.');
  }
  nonEmpty(input.renderer?.style_uri, 'renderer.style_uri');
  if (input.renderer?.style_id != null
    && !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(input.renderer.style_id)) {
    throw new OfflineBundleManifestError('renderer.style_id must be a valid server-approved identifier.');
  }
  nonEmpty(input.renderer?.style_revision, 'renderer.style_revision');
  nonEmpty(input.renderer?.style_pack_id, 'renderer.style_pack_id');
  nonEmpty(input.renderer?.tile_region_id, 'renderer.tile_region_id');
  if (input.renderer.id !== 'rnmapbox' && input.renderer.id !== 'maplibre') {
    throw new OfflineBundleManifestError('renderer.id must be rnmapbox or maplibre.');
  }

  const { west, south, east, north } = input.bounds ?? {} as OfflineBundleManifestV2['bounds'];
  if (![west, south, east, north].every(Number.isFinite)
    || west < -180 || east > 180 || south < -90 || north > 90
    || west >= east || south >= north) {
    throw new OfflineBundleManifestError('bounds must be a valid west/south/east/north box.');
  }
  if (!Number.isFinite(input.min_zoom) || !Number.isFinite(input.max_zoom)
    || input.min_zoom < 0 || input.max_zoom > 24 || input.min_zoom > input.max_zoom) {
    throw new OfflineBundleManifestError('min_zoom and max_zoom must define a valid 0-24 range.');
  }
  if (!Array.isArray(input.artifacts) || !input.artifacts.length) {
    throw new OfflineBundleManifestError('artifacts must contain at least one item.');
  }
  const ids = new Set<string>();
  input.artifacts.forEach((artifact, index) => {
    validateArtifact(artifact, index);
    if (ids.has(artifact.id)) throw new OfflineBundleManifestError(`Duplicate artifact id: ${artifact.id}.`);
    ids.add(artifact.id);
  });

  const requiredBytes = input.artifacts
    .filter(artifact => artifact.required)
    .reduce((total, artifact) => total + artifact.bytes, 0);
  if (!Number.isSafeInteger(input.required_storage_bytes) || input.required_storage_bytes < requiredBytes) {
    throw new OfflineBundleManifestError('required_storage_bytes cannot be smaller than required artifacts.');
  }

  for (const capability of Object.keys(input.capabilities) as Array<keyof typeof input.capabilities>) {
    if (!input.capabilities[capability]) continue;
    const expectedKinds = capabilityArtifactKinds(capability);
    const hasArtifacts = capability === 'map'
      ? expectedKinds.every(kind => input.artifacts.some(artifact => artifact.kind === kind))
      : expectedKinds.some(kind => input.artifacts.some(artifact => artifact.kind === kind));
    if (!hasArtifacts) {
      throw new OfflineBundleManifestError(`Capability ${capability} is missing its declared artifact.`);
    }
  }
  if (!Array.isArray(input.source_attribution) || !Array.isArray(input.license_ids)) {
    throw new OfflineBundleManifestError('source_attribution and license_ids must be arrays.');
  }
  return input;
}

export function offlineManifestKey(manifest: Pick<OfflineBundleManifestV2, 'bundle_id' | 'revision'>) {
  return `${manifest.bundle_id}@${manifest.revision}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([key, item]) => key !== 'manifest_sha256' && item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Canonical digest payload shared with the Python V2 issuer. */
export function canonicalOfflineManifestJson(manifest: OfflineBundleManifestV2): string {
  return canonicalJson(manifest);
}
