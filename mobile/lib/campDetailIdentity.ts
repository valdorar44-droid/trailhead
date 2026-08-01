export type CampDetailIdentitySource = {
  id?: string | number | null;
  name?: string | null;
  lat?: number | null;
  lng?: number | null;
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
  // Durable agency-backed Explore identities resolve against Trailhead's
  // stored catalog before the server considers any live provider. Keeping the
  // full identity is important because the reviewed USFS/NPS/BLM record owns
  // the operational facts shown in the campground sheet.
  if (/^place:(?:usfs|nps|blm|osm|trailhead):[^:]+/i.test(id)) return id;
  if (id.startsWith('ridb_site:')) return id;
  if (/^(blm_|thp_|dsl_|dispersed_lead:)/i.test(id)) return id;
  const source = `${camp?.source || ''} ${camp?.source_badge || ''} ${camp?.verified_source || ''}`.toLowerCase();
  if (/^\d+$/.test(id) && /ridb|recreation\.gov|recreation gov/.test(source)) return id;
  return null;
}

export function campDetailMatchesSelection(
  selected: CampDetailIdentitySource | null | undefined,
  detail: CampDetailIdentitySource | null | undefined,
): boolean {
  if (!selected || !detail) return false;
  const selectedLat = Number(selected.lat);
  const selectedLng = Number(selected.lng);
  const detailLat = Number(detail.lat);
  const detailLng = Number(detail.lng);
  if (![selectedLat, selectedLng, detailLat, detailLng].every(Number.isFinite)) return true;

  const distanceKm = haversineKm(selectedLat, selectedLng, detailLat, detailLng);
  if (distanceKm > 160) return false;
  if (distanceKm <= 20) return true;
  return namesOverlap(selected.name, detail.name);
}

function namesOverlap(left: unknown, right: unknown): boolean {
  const normalize = (value: unknown) => String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(token => token.length > 2 && !['camp', 'campsite', 'campground', 'park', 'national', 'the'].includes(token));
  const leftTokens = normalize(left);
  const rightTokens = new Set(normalize(right));
  if (!leftTokens.length || !rightTokens.size) return false;
  return leftTokens.some(token => rightTokens.has(token));
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(lat2 - lat1);
  const dLng = radians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
