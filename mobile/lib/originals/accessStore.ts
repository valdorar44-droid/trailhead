import {
  joinOriginalPath,
  recoverOriginalPath,
  writeOriginalTextAtomically,
  type OriginalFileAdapter,
} from './fileAdapter';
import type {
  OriginalAuthenticatedAcquisition,
  OriginalGuestAcquisition,
  OriginalLocalAccessV1,
  OriginalManifestV1,
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
      return serialized(() => {
        const now = Date.now();
        return saveInternal({
          schema_version: 1,
          pack_id: acquisition.pack.id,
          version: acquisition.pack.version,
          slug: acquisition.pack.slug,
          title: acquisition.pack.title,
          owner_scope: `account:${accountId}`,
          access_type: 'entitled',
          pack_summary: acquisition.pack,
          claimed_at_ms: now,
          updated_at_ms: now,
        });
      });
    },

    recordAdminPreview(manifest: OriginalManifestV1, accountId: string | number) {
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
      return serialized(async () => (await readIndex()).scopes[ownerScope] ?? []);
    },

    get(ownerScope: OriginalOwnerScope, packId: string, version?: number) {
      return serialized(async () => {
        const records = (await readIndex()).scopes[ownerScope] ?? [];
        return records.find(record => (
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
