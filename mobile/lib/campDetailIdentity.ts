export type CampDetailIdentitySource = {
  id?: string | number | null;
  source?: string | null;
  source_badge?: string | null;
  verified_source?: string | null;
};

export function ridbFacilityIdFromCanonicalCampId(value: unknown): string | null {
  const match = /^(?:place:)?ridb:([^:]+)$/i.exec(String(value || '').trim());
  return match?.[1] || null;
}

export function campDetailFetchId(camp: CampDetailIdentitySource | null | undefined): string | null {
  const id = String(camp?.id || '').trim();
  if (!id) return null;
  const canonicalRidbId = ridbFacilityIdFromCanonicalCampId(id);
  if (canonicalRidbId) return canonicalRidbId;
  if (id.startsWith('ridb_site:')) return id;
  if (/^(blm_|thp_|dsl_|dispersed_lead:)/i.test(id)) return id;
  const source = `${camp?.source || ''} ${camp?.source_badge || ''} ${camp?.verified_source || ''}`.toLowerCase();
  if (/^\d+$/.test(id) && /ridb|recreation\.gov|recreation gov/.test(source)) return id;
  return null;
}
