import type {
  OriginalAuthenticatedAcquisition,
  OriginalEntitlementAccessType,
  OriginalLocalAccessV1,
} from './types';

export const ORIGINAL_EXPLORER_ACCESS_REQUIRED =
  'An active Explorer membership is required to play this Original.';

export function originalEntitlementAccessType(
  acquisition: OriginalAuthenticatedAcquisition,
): OriginalEntitlementAccessType | 'entitled' {
  const entitlement = acquisition.entitlement;
  if (
    entitlement.access_type === 'explorer_subscription'
    || entitlement.access_type === 'permanent'
  ) return entitlement.access_type;
  if (entitlement.acquisition_type === 'explorer_included') return 'explorer_subscription';
  // Older servers did not return access metadata. Keep their already-issued
  // entitlements compatible instead of accidentally locking permanent access.
  return 'entitled';
}

export function originalLocalAccessIsCurrent(
  access: OriginalLocalAccessV1 | null | undefined,
  nowSeconds = Math.floor(Date.now() / 1_000),
  options: { allowAdminPreview?: boolean; manifestId?: string } = {},
) {
  if (!access) return false;
  if (access.access_type === 'guest_free') return true;
  if (access.access_type === 'admin_preview') {
    return Boolean(options.allowAdminPreview)
      && (options.manifestId == null || access.manifest_id === options.manifestId);
  }
  if (access.access_type === 'entitled' || access.access_type === 'permanent') return true;
  if (access.access_type !== 'explorer_subscription') return false;
  if (access.access_receipt_required === true) {
    if (options.manifestId != null && access.manifest_id !== options.manifestId) return false;
    const expiresAt = access.access_receipt_expires_at;
    const trustedTimeFloor = Math.max(0, access.trusted_time_floor_s ?? 0, nowSeconds);
    return access.access_receipt_status === 'valid'
      && access.access_active === true
      && typeof expiresAt === 'number'
      && Number.isFinite(expiresAt)
      && expiresAt > trustedTimeFloor;
  }
  const expiresAt = access.access_expires_at;
  return access.access_active === true
    && typeof expiresAt === 'number'
    && Number.isFinite(expiresAt)
    && expiresAt > nowSeconds;
}

export function originalLocalAccessIsExplorerSubscription(
  access: OriginalLocalAccessV1 | null | undefined,
) {
  return access?.access_type === 'explorer_subscription';
}
