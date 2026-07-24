export function exactSavedTripRevision(value: unknown): number | null {
  const revision = Number(value);
  return Number.isInteger(revision) && revision >= 1 ? revision : null;
}

export function createBriefAndBackupIdempotencyKey(input: {
  tripId: string;
  tripRevision: number;
  now?: number;
  entropy?: string;
}): string {
  const now = Math.max(0, Math.floor(input.now ?? Date.now()));
  const seed = `${input.tripId}:${input.tripRevision}:${now}:${input.entropy ?? Math.random().toString(36).slice(2)}`;
  return `brief-${input.tripRevision}-${now.toString(36)}-${fnv1a(seed)}`;
}

export function briefEvidenceStatusLabel(value: unknown): 'Partially checked' | 'Evidence found' | 'Not checked' {
  const normalized = String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (normalized === 'partially checked') return 'Partially checked';
  if (normalized === 'observations found' || normalized === 'references found') return 'Evidence found';
  return 'Not checked';
}

export function briefAvailabilityLabel(value: unknown): string {
  const normalized = String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (!normalized
    || normalized === 'unknown'
    || normalized === 'not checked'
    || normalized === 'unavailable'
    || normalized === 'not available'
    || normalized === 'not observed') return 'Not checked';
  return normalized.replace(/\b\w/g, character => character.toUpperCase());
}

export function briefRouteProgressLabel(value: unknown): string {
  const progress = Number(value);
  if (!Number.isFinite(progress)) return 'Not checked';
  const fraction = progress > 1 ? progress / 100 : progress;
  return `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}% of route`;
}

export function briefEvidenceTimeLabel(observedAt: unknown, updatedAt: unknown): string {
  const candidates: Array<{ value: unknown; prefix: 'Observed' | 'Updated' }> = [
    { value: observedAt, prefix: 'Observed' },
    { value: updatedAt, prefix: 'Updated' },
  ];
  for (const candidate of candidates) {
    const raw = String(candidate.value ?? '').trim();
    if (!raw) continue;
    const numeric = Number(candidate.value);
    const parsed = Number.isFinite(numeric) && numeric > 0
      ? new Date(numeric < 1_000_000_000_000 ? numeric * 1000 : numeric)
      : new Date(raw);
    if (Number.isNaN(parsed.getTime())) continue;
    const label = parsed.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: parsed.getUTCFullYear() === new Date().getUTCFullYear() ? undefined : 'numeric',
      timeZone: 'UTC',
    });
    return `${candidate.prefix} ${label}`;
  }
  return '';
}

function fnv1a(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
