import assert from 'node:assert/strict';
import { originalSummaryForLocalAccess } from '../localAccessSummary';
import type { OriginalLocalAccessV1, OriginalSummary } from '../types';

const snapshot: OriginalSummary = {
  id: 'moab-original',
  slug: 'moab-canyons-to-the-sky',
  content_kind: 'original_drive',
  version: 3,
  title: 'Moab: Canyons to the Sky',
  summary: 'A self-guided scenic drive.',
  price_credits: 0,
  explorer_price_credits: 0,
  free: true,
  coverage_region: 'Moab, Utah',
  public_metadata: { story_count: 11 },
  published_at: 10,
  featured: true,
};

const acquired: OriginalLocalAccessV1 = {
  schema_version: 1,
  pack_id: 'moab-original',
  version: 3,
  slug: snapshot.slug,
  title: snapshot.title,
  owner_scope: 'guest',
  access_type: 'guest_free',
  pack_summary: snapshot,
  claimed_at_ms: 100,
  updated_at_ms: 100,
};

assert.equal(originalSummaryForLocalAccess(acquired), snapshot, 'an acquired Original is visible before its bundle is downloaded');

const legacy = { ...acquired, pack_summary: undefined };
const legacySummary = originalSummaryForLocalAccess(legacy);
assert.equal(legacySummary.id, legacy.pack_id);
assert.equal(legacySummary.version, legacy.version);
assert.equal(legacySummary.title, legacy.title);
assert.equal(legacySummary.free, true);

const mismatched = { ...acquired, pack_summary: { ...snapshot, id: 'another-pack' } };
assert.equal(
  originalSummaryForLocalAccess(mismatched).id,
  acquired.pack_id,
  'a mismatched snapshot cannot replace the durable access identity',
);

console.log('Originals local access summary tests passed.');
