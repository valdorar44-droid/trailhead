import type { TripDocumentV2, TripExperienceRefV1 } from './types';

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function tripExperienceRefFromApi(value: unknown): TripExperienceRefV1 | undefined {
  const input = record(value);
  const packId = typeof input?.pack_id === 'string' ? input.pack_id.trim() : '';
  const manifestId = typeof input?.manifest_id === 'string' ? input.manifest_id.trim() : '';
  const version = Number(input?.version);
  if (
    input?.kind !== 'trailhead_original'
    || !packId
    || !manifestId
    || !Number.isInteger(version)
    || version < 1
  ) return undefined;
  return { kind: 'trailhead_original', packId, version, manifestId };
}

export function isTrailheadOriginalTripDocument(
  document: Pick<TripDocumentV2, 'experienceRef'>,
) {
  return document.experienceRef?.kind === 'trailhead_original';
}
