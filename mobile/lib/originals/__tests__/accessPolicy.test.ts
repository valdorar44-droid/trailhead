import assert from 'node:assert/strict';
import { originalLocalAccessIsCurrent } from '../accessPolicy';
import { createOriginalAccessStore } from '../accessStore';
import type { OriginalAuthenticatedAcquisition, OriginalSummary } from '../types';
import { createMemoryOriginalFileAdapter } from './memoryFileAdapter';

const pack: OriginalSummary = {
  id: 'smokies-original',
  slug: 'great-smoky-mountains-ridges-rivers-living-memory',
  content_kind: 'original_drive',
  version: 1,
  title: 'Great Smoky Mountains: Ridges, Rivers & Living Memory',
  summary: 'A four-chapter driving Original.',
  price_credits: 900,
  explorer_price_credits: 900,
  free: false,
  coverage_region: 'great_smoky_mountains',
  public_metadata: {},
  access_policy: {
    schema_version: 1,
    explorer_included: true,
    permanent_credit_price: 900,
  },
  published_at: 1,
  featured: false,
};

function acquisition(
  accessType: 'explorer_subscription' | 'permanent',
  options: { active?: boolean; expiresAt?: number | null; acquisitionType?: string } = {},
): OriginalAuthenticatedAcquisition {
  return {
    entitlement: {
      id: 'packent-smokies',
      pack_id: pack.id,
      version: pack.version,
      acquisition_type: options.acquisitionType
        ?? (accessType === 'explorer_subscription' ? 'explorer_included' : 'purchase'),
      access_type: accessType,
      permanent: accessType === 'permanent',
      access_active: options.active ?? accessType === 'permanent',
      access_expires_at: options.expiresAt ?? null,
    },
    pack,
    trip: { trip_id: 'trip-smokies' },
    already_owned: false,
    replayed: false,
    credit_balance: 900,
  };
}

async function main() {
  const store = createOriginalAccessStore(createMemoryOriginalFileAdapter());
  const active = await store.recordEntitlement(acquisition('explorer_subscription', {
    active: true,
    expiresAt: 2_000,
  }), 42);
  const claimedAt = active.claimed_at_ms;
  assert.equal(active.access_type, 'explorer_subscription');
  assert.equal(originalLocalAccessIsCurrent(active, 1_999), true);
  assert.equal(originalLocalAccessIsCurrent(active, 2_000), false, 'expiry is enforced locally');

  const expired = await store.recordEntitlement(acquisition('explorer_subscription', {
    active: false,
    expiresAt: null,
  }), 42);
  assert.equal(originalLocalAccessIsCurrent(expired, 2_001), false);
  assert.equal(expired.claimed_at_ms, claimedAt, 'expiry keeps the original local ownership record');
  assert.equal((await store.list('account:42')).length, 1, 'expiry never deletes the local pack record');

  const renewed = await store.recordEntitlement(acquisition('explorer_subscription', {
    active: true,
    expiresAt: 3_000,
  }), 42);
  assert.equal(renewed.claimed_at_ms, claimedAt);
  assert.equal(originalLocalAccessIsCurrent(renewed, 2_500), true, 'renewal restores the same record');
  assert.equal((await store.list('account:42')).length, 1);

  const permanent = await store.recordEntitlement(acquisition('permanent', {
    active: true,
    acquisitionType: 'purchase',
  }), 42);
  assert.equal(permanent.access_type, 'permanent');
  assert.equal(permanent.permanent, true);
  assert.equal(permanent.access_expires_at, null);
  assert.equal(permanent.claimed_at_ms, claimedAt, 'permanent upgrade reuses the same local record');
  assert.equal(originalLocalAccessIsCurrent(permanent, Number.MAX_SAFE_INTEGER), true);
  assert.equal((await store.list('account:42')).length, 1);

  const legacy = await store.recordEntitlement({
    ...acquisition('permanent'),
    entitlement: { pack_id: pack.id, version: pack.version },
  }, 77);
  assert.equal(legacy.access_type, 'entitled');
  assert.equal(originalLocalAccessIsCurrent(legacy), true, 'older permanent records remain compatible');

  const preview = {
    ...legacy,
    access_type: 'admin_preview' as const,
    manifest_id: 'smokies-original:private-r2',
  };
  assert.equal(originalLocalAccessIsCurrent(preview), false, 'admin preview access is never public access');
  assert.equal(originalLocalAccessIsCurrent(preview, undefined, {
    allowAdminPreview: true,
    manifestId: preview.manifest_id,
  }), true);
  assert.equal(originalLocalAccessIsCurrent(preview, undefined, {
    allowAdminPreview: true,
    manifestId: 'smokies-original:private-r3',
  }), false, 'admin preview access is bound to the exact immutable manifest');
  assert.equal(originalLocalAccessIsCurrent({ ...preview, manifest_id: undefined }, undefined, {
    allowAdminPreview: true,
    manifestId: preview.manifest_id,
  }), false, 'legacy unbound preview records fail closed');

  console.log('Original access policy tests passed.');
}

void main();
