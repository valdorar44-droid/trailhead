import {
  joinOriginalPath,
  recoverOriginalPath,
  writeOriginalTextAtomically,
  type OriginalFileAdapter,
} from './fileAdapter';
import { originalEntitlementAccessType } from './accessPolicy';
import { evaluateOriginalEntitlementReceipt } from './trustedEntitlementReceipt';
import type {
  OriginalAuthenticatedAcquisition,
  OriginalGuestAcquisition,
  OriginalLocalAccessV1,
  OriginalManifest,
  OriginalOwnerScope,
} from './types';

type OriginalAccessIndexV1 = {
  schema_version: 1;
  scopes: Record<string, OriginalLocalAccessV1[]>;
};

export type OriginalAccessStore = ReturnType<typeof createOriginalAccessStore>;

const emptyIndex = (): OriginalAccessIndexV1 => ({ schema_version: 1, scopes: {} });

function key(record: Pick<OriginalLocalAccessV1, 'pack_id' | 'version'>) {
  return `${record.pack_id}@${record.version}`;
}

function refreshTrustedExplorerAccess(
  record: OriginalLocalAccessV1,
  options: { allowSignedRefresh?: boolean } = {},
) {
  if (record.access_type !== 'explorer_subscription' || record.access_receipt_required !== true) {
    return record;
  }
  if (
    record.entitlement_id == null
    || !record.manifest_id
    || !record.access_owner_binding
  ) {
    return {
      ...record,
      access_active: false,
      access_receipt_status: 'identity_mismatch' as const,
    };
  }
  const evaluation = evaluateOriginalEntitlementReceipt(record.access_receipt, {
    ownerBinding: record.access_owner_binding,
    entitlementId: record.entitlement_id,
    packId: record.pack_id,
    version: record.version,
    manifestId: record.manifest_id,
    manifestSchemaVersion: record.manifest_schema_version ?? 2,
  }, {
    previousTrustedTimeFloorS: record.trusted_time_floor_s,
    previousReceiptExpiresAtS: record.access_receipt_expires_at,
    previousMonotonicAnchorMs: record.receipt_monotonic_anchor_ms,
    previousMonotonicAnchorTimeS: record.receipt_monotonic_anchor_time_s,
    allowSignedRefresh: options.allowSignedRefresh,
  });
  return {
    ...record,
    access_active: evaluation.active,
    access_receipt_status: evaluation.status,
    trusted_time_floor_s: evaluation.trustedTimeFloorS,
    access_receipt_expires_at: evaluation.receiptExpiresAtS,
    receipt_monotonic_anchor_ms: evaluation.monotonicAnchorMs ?? undefined,
    receipt_monotonic_anchor_time_s: evaluation.monotonicAnchorTimeS ?? undefined,
  };
}

export function createOriginalAccessStore(
  files: OriginalFileAdapter,
  root = joinOriginalPath(files.documentDirectory, 'originals/access'),
) {
  const indexPath = joinOriginalPath(root, '_index.json');
  let operationTail: Promise<unknown> = Promise.resolve();
  const serialized = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = operationTail.then(operation, operation);
    operationTail = result.catch(() => undefined);
    return result;
  };
  const readIndex = async (): Promise<OriginalAccessIndexV1> => {
    try {
      await recoverOriginalPath(files, indexPath);
      const parsed = JSON.parse(await files.readText(indexPath));
      return parsed?.schema_version === 1 && parsed.scopes ? parsed : emptyIndex();
    } catch {
      return emptyIndex();
    }
  };
  const writeIndex = (index: OriginalAccessIndexV1) => (
    writeOriginalTextAtomically(files, indexPath, JSON.stringify(index))
  );
  const saveInternal = async (record: OriginalLocalAccessV1) => {
    const index = await readIndex();
    const records = index.scopes[record.owner_scope] ?? [];
    index.scopes[record.owner_scope] = [
      record,
      ...records.filter(item => key(item) !== key(record)),
    ];
    await writeIndex(index);
    return record;
  };

  return {
    claimGuest(acquisition: OriginalGuestAcquisition) {
      return serialized(() => {
        const now = Date.now();
        return saveInternal({
          schema_version: 1,
          pack_id: acquisition.pack.id,
          version: acquisition.pack.version,
          slug: acquisition.pack.slug,
          title: acquisition.pack.title,
          owner_scope: 'guest',
          access_type: 'guest_free',
          pack_summary: acquisition.pack,
          manifest_path: acquisition.manifest_path,
          claimed_at_ms: now,
          updated_at_ms: now,
        });
      });
    },

    recordEntitlement(acquisition: OriginalAuthenticatedAcquisition, accountId: string | number) {
      return serialized(async () => {
        const now = Date.now();
        const ownerScope = `account:${accountId}` as OriginalOwnerScope;
        const index = await readIndex();
        const existing = (index.scopes[ownerScope] ?? []).find(record => (
          record.pack_id === acquisition.pack.id
          && record.version === acquisition.pack.version
        ));
        const accessType = originalEntitlementAccessType(acquisition);
        const explorerSubscription = accessType === 'explorer_subscription';
        const record = refreshTrustedExplorerAccess({
          schema_version: 1,
          pack_id: acquisition.pack.id,
          version: acquisition.pack.version,
          slug: acquisition.pack.slug,
          title: acquisition.pack.title,
          owner_scope: ownerScope,
          access_type: accessType,
          permanent: explorerSubscription ? false : true,
          access_active: explorerSubscription
            ? acquisition.entitlement.access_active === true
            : true,
          access_expires_at: explorerSubscription
            ? acquisition.entitlement.access_expires_at ?? null
            : null,
          access_receipt_required: explorerSubscription
            ? acquisition.entitlement.access_receipt_required === true
            : undefined,
          manifest_id: explorerSubscription
            ? acquisition.entitlement.manifest_id
            : undefined,
          manifest_schema_version: explorerSubscription
            ? acquisition.entitlement.manifest_schema_version ?? 2
            : undefined,
          access_owner_binding: explorerSubscription
            ? acquisition.entitlement.access_owner_binding
            : undefined,
          access_receipt_expires_at: explorerSubscription
            ? acquisition.entitlement.access_receipt_expires_at ?? null
            : undefined,
          access_receipt: explorerSubscription
            ? acquisition.entitlement.access_receipt ?? null
            : undefined,
          trusted_time_floor_s: explorerSubscription
            ? existing?.trusted_time_floor_s
            : undefined,
          receipt_monotonic_anchor_ms: explorerSubscription
            ? existing?.receipt_monotonic_anchor_ms
            : undefined,
          receipt_monotonic_anchor_time_s: explorerSubscription
            ? existing?.receipt_monotonic_anchor_time_s
            : undefined,
          entitlement_id: acquisition.entitlement.id,
          acquisition_type: acquisition.entitlement.acquisition_type,
          // Temporary V2/V3 access is validated above against a signed server
          // receipt. The local floor advances but never extends its expiry.
          pack_summary: acquisition.pack,
          claimed_at_ms: existing?.claimed_at_ms ?? now,
          updated_at_ms: now,
        }, { allowSignedRefresh: true });
        return saveInternal(record);
      });
    },

    recordAdminPreview(manifest: OriginalManifest, accountId: string | number) {
      return serialized(() => {
        const now = Date.now();
        return saveInternal({
          schema_version: 1,
          pack_id: manifest.pack_id,
          version: manifest.version,
          slug: manifest.pack_id,
          title: manifest.title,
          owner_scope: `account:${accountId}`,
          access_type: 'admin_preview',
          manifest_path: `/api/admin/originals/${encodeURIComponent(manifest.pack_id)}/device-preview/manifest`,
          claimed_at_ms: now,
          updated_at_ms: now,
        });
      });
    },

    list(ownerScope: OriginalOwnerScope) {
      return serialized(async () => {
        const index = await readIndex();
        const records = index.scopes[ownerScope] ?? [];
        const refreshed = records.map(record => refreshTrustedExplorerAccess(record));
        if (JSON.stringify(records) !== JSON.stringify(refreshed)) {
          index.scopes[ownerScope] = refreshed;
          await writeIndex(index);
        }
        return refreshed;
      });
    },

    get(ownerScope: OriginalOwnerScope, packId: string, version?: number) {
      return serialized(async () => {
        const index = await readIndex();
        const records = index.scopes[ownerScope] ?? [];
        const refreshed = records.map(record => refreshTrustedExplorerAccess(record));
        if (JSON.stringify(records) !== JSON.stringify(refreshed)) {
          index.scopes[ownerScope] = refreshed;
          await writeIndex(index);
        }
        return refreshed.find(record => (
          record.pack_id === packId && (version == null || record.version === version)
        )) ?? null;
      });
    },

    migrateGuestToAccount(
      accountId: string | number,
      allowed: Array<{ pack_id: string; version: number }> | null = null,
    ) {
      return serialized(async () => {
        const accountScope = `account:${accountId}` as OriginalOwnerScope;
        const index = await readIndex();
        const guests = index.scopes.guest ?? [];
        const accounts = index.scopes[accountScope] ?? [];
        const allowedKeys = allowed ? new Set(allowed.map(key)) : null;
        const existing = new Map(accounts.map(record => [key(record), record]));
        const toMigrate = guests.filter(guest => !allowedKeys || allowedKeys.has(key(guest)));
        const migrated = toMigrate.map(guest => ({
          ...guest,
          owner_scope: accountScope,
          access_type: 'entitled' as const,
          manifest_path: undefined,
          updated_at_ms: Date.now(),
        }));
        for (const record of migrated) existing.set(key(record), record);
        index.scopes[accountScope] = [...existing.values()];
        index.scopes.guest = guests.filter(guest => !toMigrate.some(item => key(item) === key(guest)));
        await writeIndex(index);
        return migrated;
      });
    },

    remove(ownerScope: OriginalOwnerScope, packId: string, version?: number) {
      return serialized(async () => {
        const index = await readIndex();
        index.scopes[ownerScope] = (index.scopes[ownerScope] ?? []).filter(record => (
          record.pack_id !== packId || (version != null && record.version !== version)
        ));
        await writeIndex(index);
      });
    },

    eraseScope(ownerScope: OriginalOwnerScope) {
      return serialized(async () => {
        const index = await readIndex();
        delete index.scopes[ownerScope];
        await writeIndex(index);
      });
    },
  };
}
