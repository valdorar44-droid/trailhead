export type PlanDeepLinkSection = 'trips' | 'downloads' | 'originals' | 'saved';

export type PlanDeepLinkRequest = Readonly<{
  section: PlanDeepLinkSection;
  item_id?: string;
}>;

type ParamValue = string | readonly string[] | undefined;

const SAFE_PLAN_ID = /^[a-z0-9][a-z0-9_-]{0,127}$/i;

function first(value: ParamValue) {
  return Array.isArray(value) ? value[0] : value;
}

function safeId(value: ParamValue) {
  const candidate = String(first(value) || '').trim();
  return SAFE_PLAN_ID.test(candidate) ? candidate : '';
}

/**
 * Parses navigation intent only. Ownership is intentionally resolved later
 * from the canonical TripRepository or verified Originals entitlement list.
 */
export function planDeepLinkRequest(params: Readonly<{
  section?: ParamValue;
  trip_id?: ParamValue;
  original_id?: ParamValue;
}>): PlanDeepLinkRequest | null {
  const sectionValue = String(first(params.section) || '').trim().toLowerCase();
  const tripId = safeId(params.trip_id);
  const originalId = safeId(params.original_id);

  if (sectionValue === 'originals' || originalId) {
    return Object.freeze({ section: 'originals', ...(originalId ? { item_id: originalId } : {}) });
  }
  if (sectionValue === 'downloads') return Object.freeze({ section: 'downloads' });
  if (sectionValue === 'saved') return Object.freeze({ section: 'saved' });
  if (sectionValue === 'trips' || tripId) {
    return Object.freeze({ section: 'trips', ...(tripId ? { item_id: tripId } : {}) });
  }
  return null;
}

/** Exact lookup prevents an external identifier from becoming a data fetch. */
export function findAuthorizedPlanItem<T extends Readonly<{ id: string }>>(
  requestedId: string | undefined,
  authorizedItems: readonly T[],
): T | null {
  if (!requestedId || !SAFE_PLAN_ID.test(requestedId)) return null;
  return authorizedItems.find(item => item.id === requestedId) ?? null;
}
