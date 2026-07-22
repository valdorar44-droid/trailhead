import {
  joinOriginalPath,
  promoteOriginalPathSafely,
  recoverOriginalPath,
  writeOriginalTextAtomically,
  type OriginalFileAdapter,
} from './fileAdapter';
import { validateOriginalManifest } from './manifest';
import type { OriginalOfflineMapAdapter } from './mapAdapter';
import type { OriginalAssetV1, OriginalManifestV1, OriginalOwnerScope } from './types';

export type OriginalBundleAssetRecord = OriginalAssetV1 & {
  local_uri: string;
};

export type OriginalBundleRecord = {
  schema_version: 1;
  owner_scope: OriginalOwnerScope;
  pack_id: string;
  version: number;
  manifest_id: string;
  manifest_sha256: string;
  directory_uri: string;
  manifest_uri: string;
  assets: OriginalBundleAssetRecord[];
  map_pack_id: string;
  map_bytes: number;
  total_bytes: number;
  verified_at_ms: number;
};

type OriginalBundleScopeV1 = {
  records: Record<string, Record<string, OriginalBundleRecord>>;
  pinned_versions: Record<string, number>;
};

type OriginalBundleIndexV2 = {
  schema_version: 2;
  scopes: Partial<Record<OriginalOwnerScope, OriginalBundleScopeV1>>;
};

export type OriginalBundleProgress = {
  phase: 'preparing' | 'assets' | 'map' | 'verifying' | 'promoting';
  completed_bytes: number;
  total_bytes: number;
  asset_id?: string;
  percentage: number;
};

export type OriginalBundleDownloadOptions = {
  ownerScope: OriginalOwnerScope;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  mapAdapter?: OriginalOfflineMapAdapter;
  pinVersion?: boolean;
  onProgress?: (progress: OriginalBundleProgress) => void;
};

export type OriginalBundleStore = ReturnType<typeof createOriginalBundleStore>;

const emptyIndex = (): OriginalBundleIndexV2 => ({
  schema_version: 2,
  scopes: {},
});

const emptyScope = (): OriginalBundleScopeV1 => ({ records: {}, pinned_versions: {} });

function bundleScope(index: OriginalBundleIndexV2, ownerScope: OriginalOwnerScope) {
  return index.scopes[ownerScope] ??= emptyScope();
}

function safePart(value: string) {
  return encodeURIComponent(value).replace(/%/g, '_');
}

function fileExtension(asset: OriginalAssetV1) {
  const cleanPath = asset.path.split(/[?#]/)[0];
  const pathMatch = cleanPath.match(/(\.[a-z0-9]{1,8})$/i);
  if (pathMatch) return pathMatch[1].toLowerCase();
  const byMime: Record<string, string> = {
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'audio/aac': '.aac',
    'audio/wav': '.wav',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'application/json': '.json',
    'text/plain': '.txt',
  };
  return byMime[asset.mime_type.toLowerCase()] ?? '.bin';
}

function resolveAssetUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith('//')) return `https:${path}`;
  const base = (process.env.EXPO_PUBLIC_API_URL?.trim() || 'https://api.gettrailhead.app').replace(/\/+$/, '');
  return `${base}/${path.replace(/^\/+/, '')}`;
}

function progress(
  callback: OriginalBundleDownloadOptions['onProgress'],
  phase: OriginalBundleProgress['phase'],
  completed: number,
  total: number,
  assetId?: string,
) {
  callback?.({
    phase,
    completed_bytes: completed,
    total_bytes: total,
    asset_id: assetId,
    percentage: total > 0 ? Math.max(0, Math.min(100, completed / total * 100)) : 0,
  });
}

function throwIfCancelled(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  const error = new Error('Original download cancelled.');
  error.name = 'AbortError';
  throw error;
}

export function createOriginalBundleStore(
  files: OriginalFileAdapter,
  root = joinOriginalPath(files.documentDirectory, 'originals/bundles'),
  defaultMapAdapter?: OriginalOfflineMapAdapter,
) {
  const indexPath = joinOriginalPath(root, '_index.json');
  let operationTail: Promise<unknown> = Promise.resolve();
  const serialized = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = operationTail.then(operation, operation);
    operationTail = result.catch(() => undefined);
    return result;
  };

  const scopeRoot = (ownerScope: OriginalOwnerScope) => joinOriginalPath(root, safePart(ownerScope));
  const packRoot = (ownerScope: OriginalOwnerScope, packId: string) => (
    joinOriginalPath(scopeRoot(ownerScope), safePart(packId))
  );
  const versionRoot = (ownerScope: OriginalOwnerScope, packId: string, version: number) => (
    joinOriginalPath(packRoot(ownerScope, packId), String(version))
  );

  const readIndex = async (): Promise<OriginalBundleIndexV2> => {
    try {
      await recoverOriginalPath(files, indexPath);
      const parsed = JSON.parse(await files.readText(indexPath));
      // V1 had one device-global namespace. It is deliberately not migrated:
      // attributing those files to the currently signed-in account could expose
      // a paid download after logout or account switching.
      return parsed?.schema_version === 2 && parsed.scopes
        ? parsed
        : emptyIndex();
    } catch {
      return emptyIndex();
    }
  };

  const writeIndex = (index: OriginalBundleIndexV2) => (
    writeOriginalTextAtomically(files, indexPath, JSON.stringify(index))
  );

  const verifyRecordInternal = async (record: OriginalBundleRecord) => {
    await recoverOriginalPath(files, record.directory_uri);
    const manifestInfo = await files.info(record.manifest_uri);
    if (!manifestInfo.exists) return false;
    try {
      if (!/^[a-f0-9]{64}$/i.test(record.manifest_sha256 || '')) return false;
      const manifestDigest = await files.sha256(record.manifest_uri);
      if (manifestDigest.toLowerCase() !== record.manifest_sha256.toLowerCase()) return false;
      const manifest = validateOriginalManifest(JSON.parse(await files.readText(record.manifest_uri)));
      if (
        manifest.pack_id !== record.pack_id
        || manifest.version !== record.version
        || manifest.manifest_id !== record.manifest_id
      ) return false;
      if (manifest.assets.length !== record.assets.length) return false;
      for (let index = 0; index < manifest.assets.length; index += 1) {
        const expected = manifest.assets[index];
        const installed = record.assets[index];
        if (
          expected.id !== installed.id
          || expected.kind !== installed.kind
          || expected.path !== installed.path
          || expected.mime_type !== installed.mime_type
          || expected.bytes !== installed.bytes
          || expected.sha256.toLowerCase() !== installed.sha256.toLowerCase()
        ) return false;
      }
    } catch {
      return false;
    }
    for (const asset of record.assets) {
      const info = await files.info(asset.local_uri);
      if (!info.exists || info.size !== asset.bytes) return false;
      const digest = await files.sha256(asset.local_uri);
      if (digest.toLowerCase() !== asset.sha256.toLowerCase()) return false;
    }
    if (defaultMapAdapter?.isReady && !await defaultMapAdapter.isReady(record.map_pack_id)) return false;
    return true;
  };

  return {
    root,

    download(manifestInput: OriginalManifestV1, options: OriginalBundleDownloadOptions) {
      return serialized(async () => {
        const manifest = validateOriginalManifest(manifestInput);
        const ownerScope = options.ownerScope;
        if (!ownerScope) throw new Error('An owner scope is required for an offline Original.');
        const totalBytes = manifest.assets.reduce((sum, asset) => sum + asset.bytes, 0)
          + Math.max(0, manifest.offline_map.estimated_bytes);
        progress(options.onProgress, 'preparing', 0, totalBytes);
        throwIfCancelled(options.signal);

        const freeBytes = await files.freeDiskBytes();
        if (freeBytes != null && freeBytes < totalBytes * 1.1) {
          throw new Error('Not enough free storage to download this Trailhead Original.');
        }

        const currentIndex = await readIndex();
        const currentScope = bundleScope(currentIndex, ownerScope);
        const existing = currentScope.records[manifest.pack_id]?.[String(manifest.version)];
        if (existing && await verifyRecordInternal(existing)) {
          if (options.pinVersion !== false) {
            currentScope.pinned_versions[manifest.pack_id] = manifest.version;
          } else if (currentScope.pinned_versions[manifest.pack_id] === manifest.version) {
            delete currentScope.pinned_versions[manifest.pack_id];
          }
          await writeIndex(currentIndex);
          return existing;
        }

        const finalDirectory = versionRoot(ownerScope, manifest.pack_id, manifest.version);
        const stagingDirectory = `${finalDirectory}.tmp-${Date.now()}`;
        await files.remove(stagingDirectory).catch(() => {});
        await files.ensureDirectory(joinOriginalPath(stagingDirectory, 'assets'));
        let completedBytes = 0;
        let preparedMapPackId: string | null = null;
        try {
          const headers = options.headers ?? {};
          const stagedAssets: OriginalBundleAssetRecord[] = [];
          for (const asset of manifest.assets) {
            throwIfCancelled(options.signal);
            const fileName = `${safePart(asset.id)}${fileExtension(asset)}`;
            const stagedUri = joinOriginalPath(stagingDirectory, 'assets', fileName);
            const finalUri = joinOriginalPath(finalDirectory, 'assets', fileName);
            await files.download(resolveAssetUrl(asset.path), stagedUri, {
              headers,
              signal: options.signal,
              onProgress: received => progress(
                options.onProgress,
                'assets',
                completedBytes + Math.min(received, asset.bytes),
                totalBytes,
                asset.id,
              ),
            });
            const info = await files.info(stagedUri);
            if (!info.exists || info.size !== asset.bytes) {
              throw new Error(`Downloaded asset ${asset.id} has the wrong size.`);
            }
            const digest = await files.sha256(stagedUri);
            if (digest.toLowerCase() !== asset.sha256.toLowerCase()) {
              throw new Error(`Downloaded asset ${asset.id} failed checksum verification.`);
            }
            completedBytes += asset.bytes;
            stagedAssets.push({ ...asset, local_uri: finalUri });
            progress(options.onProgress, 'assets', completedBytes, totalBytes, asset.id);
          }

          throwIfCancelled(options.signal);
          const mapAdapter = options.mapAdapter ?? defaultMapAdapter;
          if (!mapAdapter) throw new Error('Offline map downloads are unavailable on this device.');
          const preparedMap = await mapAdapter.prepare(
            manifest.offline_map,
            { pack_id: `${safePart(ownerScope)}:${manifest.pack_id}`, version: manifest.version },
            {
              signal: options.signal,
              onProgress: value => progress(
                options.onProgress,
                'map',
                completedBytes + Math.min(value.received_bytes, manifest.offline_map.estimated_bytes),
                totalBytes,
              ),
            },
          );
          preparedMapPackId = preparedMap.pack_id;
          completedBytes += manifest.offline_map.estimated_bytes;

          const stagedManifestUri = joinOriginalPath(stagingDirectory, 'manifest.json');
          await files.writeText(stagedManifestUri, JSON.stringify(manifest));
          const manifestSha256 = await files.sha256(stagedManifestUri);
          const record: OriginalBundleRecord = {
            schema_version: 1,
            owner_scope: ownerScope,
            pack_id: manifest.pack_id,
            version: manifest.version,
            manifest_id: manifest.manifest_id,
            manifest_sha256: manifestSha256,
            directory_uri: finalDirectory,
            manifest_uri: joinOriginalPath(finalDirectory, 'manifest.json'),
            assets: stagedAssets,
            map_pack_id: preparedMap.pack_id,
            map_bytes: preparedMap.bytes,
            total_bytes: totalBytes,
            verified_at_ms: Date.now(),
          };
          await files.writeText(joinOriginalPath(stagingDirectory, 'bundle.json'), JSON.stringify(record));
          progress(options.onProgress, 'verifying', completedBytes, totalBytes);
          throwIfCancelled(options.signal);

          progress(options.onProgress, 'promoting', completedBytes, totalBytes);
          await promoteOriginalPathSafely(files, stagingDirectory, finalDirectory);

          const index = await readIndex();
          const scope = bundleScope(index, ownerScope);
          scope.records[manifest.pack_id] ??= {};
          scope.records[manifest.pack_id][String(manifest.version)] = record;
          if (options.pinVersion !== false) {
            scope.pinned_versions[manifest.pack_id] = manifest.version;
          } else if (scope.pinned_versions[manifest.pack_id] === manifest.version) {
            delete scope.pinned_versions[manifest.pack_id];
          }
          await writeIndex(index);
          return record;
        } catch (error) {
          await files.remove(stagingDirectory).catch(() => {});
          if (preparedMapPackId) {
            const mapAdapter = options.mapAdapter ?? defaultMapAdapter;
            await mapAdapter?.remove?.(preparedMapPackId).catch(() => {});
          }
          throw error;
        }
      });
    },

    get(ownerScope: OriginalOwnerScope, packId: string, version: number) {
      return serialized(async () => {
        const index = await readIndex();
        return bundleScope(index, ownerScope).records[packId]?.[String(version)] ?? null;
      });
    },

    getPinned(ownerScope: OriginalOwnerScope, packId: string) {
      return serialized(async () => {
        const index = await readIndex();
        const scope = bundleScope(index, ownerScope);
        const version = scope.pinned_versions[packId];
        return version == null ? null : scope.records[packId]?.[String(version)] ?? null;
      });
    },

    list(ownerScope: OriginalOwnerScope, packId?: string) {
      return serialized(async () => {
        const index = await readIndex();
        const records = bundleScope(index, ownerScope).records;
        const groups = packId ? [records[packId] ?? {}] : Object.values(records);
        return groups.flatMap(group => Object.values(group));
      });
    },

    loadManifest(
      ownerScope: OriginalOwnerScope,
      packId: string,
      version: number,
      requireVerified = true,
    ) {
      return serialized(async () => {
        const index = await readIndex();
        const record = bundleScope(index, ownerScope).records[packId]?.[String(version)];
        if (!record) return null;
        await recoverOriginalPath(files, record.directory_uri);
        if (requireVerified && !await verifyRecordInternal(record)) return null;
        try {
          return validateOriginalManifest(JSON.parse(await files.readText(record.manifest_uri)));
        } catch {
          return null;
        }
      });
    },

    assetUri(ownerScope: OriginalOwnerScope, packId: string, version: number, assetId: string) {
      return serialized(async () => {
        const index = await readIndex();
        const record = bundleScope(index, ownerScope).records[packId]?.[String(version)];
        return record?.assets.find(asset => asset.id === assetId)?.local_uri ?? null;
      });
    },

    verify(ownerScope: OriginalOwnerScope, packId: string, version: number) {
      return serialized(async () => {
        const index = await readIndex();
        const record = bundleScope(index, ownerScope).records[packId]?.[String(version)];
        return record ? verifyRecordInternal(record) : false;
      });
    },

    remove(ownerScope: OriginalOwnerScope, packId: string, version: number) {
      return serialized(async () => {
        const index = await readIndex();
        const scope = bundleScope(index, ownerScope);
        const record = scope.records[packId]?.[String(version)];
        if (!record) return;
        await files.remove(record.directory_uri).catch(() => {});
        await (defaultMapAdapter?.remove?.(record.map_pack_id) ?? Promise.resolve()).catch(() => {});
        delete scope.records[packId][String(version)];
        if (scope.pinned_versions[packId] === version) delete scope.pinned_versions[packId];
        await writeIndex(index);
      });
    },

    eraseScope(ownerScope: OriginalOwnerScope) {
      return serialized(async () => {
        const index = await readIndex();
        const scope = index.scopes[ownerScope];
        const records = scope
          ? Object.values(scope.records).flatMap(group => Object.values(group))
          : [];
        // Native map deletion is part of account cleanup. Keep the index and
        // files intact if it fails so the privacy barrier can report/retry it.
        for (const record of records) {
          if (record.map_pack_id) await defaultMapAdapter?.remove?.(record.map_pack_id);
        }
        const rootForScope = scopeRoot(ownerScope);
        await files.remove(rootForScope);
        if ((await files.info(rootForScope)).exists) {
          throw new Error('The account-owned Original downloads could not be removed.');
        }
        delete index.scopes[ownerScope];
        await writeIndex(index);
      });
    },

    migrateGuestToAccount(
      accountId: string | number,
      allowed: Array<{ pack_id: string; version: number }>,
    ) {
      return serialized(async () => {
        const accountScope = `account:${accountId}` as OriginalOwnerScope;
        const index = await readIndex();
        const guest = bundleScope(index, 'guest');
        const account = bundleScope(index, accountScope);
        const migrated: OriginalBundleRecord[] = [];
        for (const identity of allowed) {
          const record = guest.records[identity.pack_id]?.[String(identity.version)];
          if (!record || !await verifyRecordInternal(record)) continue;
          const existing = account.records[identity.pack_id]?.[String(identity.version)];
          if (existing && await verifyRecordInternal(existing)) {
            account.pinned_versions[identity.pack_id] = identity.version;
            continue;
          }
          const destination = versionRoot(accountScope, identity.pack_id, identity.version);
          await files.ensureDirectory(packRoot(accountScope, identity.pack_id));
          await promoteOriginalPathSafely(files, record.directory_uri, destination);
          const next: OriginalBundleRecord = {
            ...record,
            owner_scope: accountScope,
            directory_uri: destination,
            manifest_uri: joinOriginalPath(destination, 'manifest.json'),
            assets: record.assets.map(asset => ({
              ...asset,
              local_uri: asset.local_uri.replace(record.directory_uri, destination),
            })),
          };
          account.records[identity.pack_id] ??= {};
          account.records[identity.pack_id][String(identity.version)] = next;
          account.pinned_versions[identity.pack_id] = identity.version;
          delete guest.records[identity.pack_id][String(identity.version)];
          if (guest.pinned_versions[identity.pack_id] === identity.version) {
            delete guest.pinned_versions[identity.pack_id];
          }
          migrated.push(next);
        }
        await writeIndex(index);
        return migrated;
      });
    },
  };
}
