import type { CommunityRatingKind } from './api';
import type { CoordinatedSheetKind } from './sheetCoordinator';

export type CommunityRatingTarget = {
  kind: CommunityRatingKind;
  entityId: string;
};

export function communityRatingTarget(input: {
  enabled: boolean;
  signedIn: boolean;
  kind: CoordinatedSheetKind;
  canonicalEntityId?: string | number | null;
  source?: string | null;
  type?: string | null;
  persistencePolicy?: string | null;
  temporaryUseOnly?: boolean | null;
}): CommunityRatingTarget | null {
  if (!input.enabled || !input.signedIn) return null;
  if (!isCommunityRatingKind(input.kind)) return null;
  const entityId = String(input.canonicalEntityId ?? '').trim();
  if (!entityId) return null;
  const sourceKind = `${input.source || ''} ${input.type || ''}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ');
  if (/\b(viator|original|originals|trip pack|guided tour)\b/.test(sourceKind)) return null;
  if (input.temporaryUseOnly || String(input.persistencePolicy || '').toLowerCase() === 'temporary') return null;
  return { kind: input.kind, entityId };
}

function isCommunityRatingKind(kind: CoordinatedSheetKind): kind is CommunityRatingKind {
  return kind === 'camp' || kind === 'trail' || kind === 'trailhead' || kind === 'place';
}
