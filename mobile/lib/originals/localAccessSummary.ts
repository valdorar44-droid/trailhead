import type { OriginalLocalAccessV1, OriginalSummary } from './types';

function snapshotMatchesAccess(access: OriginalLocalAccessV1, snapshot: OriginalSummary) {
  return String(snapshot.id) === String(access.pack_id)
    && snapshot.version === access.version;
}

/**
 * Returns the server-supplied acquisition snapshot when available. Older
 * access records remain readable through a deliberately minimal fallback so
 * ownership never depends on having already downloaded the offline bundle.
 */
export function originalSummaryForLocalAccess(access: OriginalLocalAccessV1): OriginalSummary {
  if (access.pack_summary && snapshotMatchesAccess(access, access.pack_summary)) return access.pack_summary;
  return {
    id: access.pack_id,
    slug: access.slug,
    content_kind: 'original_drive',
    version: access.version,
    title: access.title,
    summary: 'Saved Trailhead Original.',
    price_credits: 0,
    explorer_price_credits: 0,
    free: access.access_type === 'guest_free',
    coverage_region: '',
    public_metadata: {},
    published_at: access.claimed_at_ms,
    featured: false,
  };
}
