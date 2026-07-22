import {
  canonicalOfflineManifestJson,
  validateOfflineBundleManifest,
} from './manifest';
import type {
  OfflineBundleCommitReceiptV2,
  OfflineBundleInstallationV2,
  OfflineBundleManifestV2,
} from './types';
import { validateOfflineArtifactFile } from './validation';

export type OfflineBundleStorageInfo = Readonly<{
  exists: boolean;
  isDirectory: boolean;
  size: number;
}>;

export interface OfflineBundleStorageAdapter {
  readonly documentDirectory: string;
  info(path: string): Promise<OfflineBundleStorageInfo>;
  ensureDirectory(path: string): Promise<void>;
  readText(path: string): Promise<string>;
  writeText(path: string, value: string): Promise<void>;
  remove(path: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  sha256(path: string): Promise<string>;
}

export type OfflineBundleStageV2 = Readonly<{
  stage_id: string;
  bundle_id: string;
  revision: string;
  directory_uri: string;
  artifacts_directory_uri: string;
  final_directory_uri: string;
}>;

export interface OfflineBundleManifestRepository {
  verifyManifest(manifest: OfflineBundleManifestV2): Promise<void>;
  saveManifest(manifest: OfflineBundleManifestV2): Promise<string>;
  getManifest(bundleId: string, revision: string): Promise<OfflineBundleManifestV2 | null>;
  createStage(manifest: OfflineBundleManifestV2): Promise<OfflineBundleStageV2>;
  artifactPath(stage: OfflineBundleStageV2, artifactId: string): string;
  discardStage(stage: OfflineBundleStageV2): Promise<void>;
  commitStage(
    stage: OfflineBundleStageV2,
    installation: OfflineBundleInstallationV2,
    receipt: OfflineBundleCommitReceiptV2,
  ): Promise<void>;
  getInstallation(bundleId: string, revision: string): Promise<OfflineBundleInstallationV2 | null>;
  getCurrentInstallation(bundleId: string): Promise<OfflineBundleInstallationV2 | null>;
}

function joinPath(root: string, ...parts: string[]) {
  const prefix = root.replace(/\/+$/, '');
  const suffix = parts.map(part => String(part).replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/');
  return suffix ? `${prefix}/${suffix}` : prefix;
}

function safePart(value: string) {
  return encodeURIComponent(value).replace(/%/g, '_');
}

function parentPath(path: string) {
  const clean = path.replace(/\/+$/, '');
  const slash = clean.lastIndexOf('/');
  return slash > 0 ? clean.slice(0, slash) : clean;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

async function recover(storage: OfflineBundleStorageAdapter, path: string) {
  if ((await storage.info(path)).exists) return;
  const backup = `${path}.bak`;
  if ((await storage.info(backup)).exists) await storage.move(backup, path);
}

async function promote(storage: OfflineBundleStorageAdapter, prepared: string, live: string) {
  await recover(storage, live);
  const backup = `${live}.bak`;
  await storage.remove(backup).catch(() => undefined);
  const hadLive = (await storage.info(live)).exists;
  if (hadLive) await storage.move(live, backup);
  try {
    await storage.move(prepared, live);
  } catch (error) {
    if (hadLive && !(await storage.info(live)).exists && (await storage.info(backup)).exists) {
      await storage.move(backup, live).catch(() => undefined);
    }
    throw error;
  }
  await storage.remove(backup).catch(() => undefined);
}

async function writeAtomically(storage: OfflineBundleStorageAdapter, path: string, value: string) {
  const temporary = `${path}.tmp`;
  await storage.ensureDirectory(parentPath(path));
  await storage.remove(temporary).catch(() => undefined);
  await storage.writeText(temporary, value);
  await promote(storage, temporary, path);
}

function parseInstallation(value: string): OfflineBundleInstallationV2 | null {
  try {
    const parsed = JSON.parse(value) as OfflineBundleInstallationV2;
    return parsed?.schema_version === 2 && parsed.bundle_id && parsed.revision ? parsed : null;
  } catch {
    return null;
  }
}

export function createOfflineBundleManifestRepository(
  storage: OfflineBundleStorageAdapter,
  root = joinPath(storage.documentDirectory, 'offline-v2'),
  now: () => number = Date.now,
): OfflineBundleManifestRepository {
  let operationTail: Promise<unknown> = Promise.resolve();
  const serialized = <T>(operation: () => Promise<T>) => {
    const result = operationTail.then(operation, operation);
    operationTail = result.catch(() => undefined);
    return result;
  };
  const manifestPath = (bundleId: string, revision: string) => (
    joinPath(root, 'manifests', safePart(bundleId), `${safePart(revision)}.json`)
  );
  const installRoot = (bundleId: string, revision: string) => (
    joinPath(root, 'bundles', safePart(bundleId), safePart(revision))
  );
  const currentPath = (bundleId: string) => joinPath(root, 'bundles', safePart(bundleId), '_current.json');

  const verifyManifestDigestInternal = async (manifestInput: OfflineBundleManifestV2) => {
    const manifest = validateOfflineBundleManifest(manifestInput);
    const digestPath = joinPath(
      root,
      '_integrity',
      `${safePart(manifest.bundle_id)}-${safePart(manifest.revision)}.json.tmp`,
    );
    await storage.ensureDirectory(parentPath(digestPath));
    await storage.remove(digestPath).catch(() => undefined);
    try {
      await storage.writeText(digestPath, canonicalOfflineManifestJson(manifest));
      const digest = (await storage.sha256(digestPath)).toLowerCase();
      if (digest !== manifest.manifest_sha256.toLowerCase()) {
        throw new Error(`Offline manifest ${manifest.bundle_id}@${manifest.revision} failed checksum verification.`);
      }
    } finally {
      await storage.remove(digestPath).catch(() => undefined);
    }
    return manifest;
  };

  const saveManifestInternal = async (manifestInput: OfflineBundleManifestV2) => {
    const manifest = await verifyManifestDigestInternal(manifestInput);
    const path = manifestPath(manifest.bundle_id, manifest.revision);
    await recover(storage, path);
    if ((await storage.info(path)).exists) {
      const existing = validateOfflineBundleManifest(JSON.parse(await storage.readText(path)));
      if (canonicalJson(existing) !== canonicalJson(manifest)) {
        throw new Error(`Offline manifest ${manifest.bundle_id}@${manifest.revision} is immutable.`);
      }
      return path;
    }
    await writeAtomically(storage, path, JSON.stringify(manifest));
    return path;
  };

  return {
    verifyManifest(manifest) {
      return serialized(async () => {
        await verifyManifestDigestInternal(manifest);
      });
    },

    saveManifest(manifest) {
      return serialized(() => saveManifestInternal(manifest));
    },

    getManifest(bundleId, revision) {
      return serialized(async () => {
        const path = manifestPath(bundleId, revision);
        await recover(storage, path);
        if (!(await storage.info(path)).exists) return null;
        try {
          return await verifyManifestDigestInternal(JSON.parse(await storage.readText(path)));
        } catch {
          return null;
        }
      });
    },

    createStage(manifestInput) {
      return serialized(async () => {
        const manifest = await verifyManifestDigestInternal(manifestInput);
        await saveManifestInternal(manifest);
        const nonce = `${now()}-${Math.random().toString(36).slice(2, 10)}`;
        const directory = joinPath(root, '_staging', safePart(manifest.bundle_id), `${safePart(manifest.revision)}-${nonce}`);
        const artifacts = joinPath(directory, 'artifacts');
        await storage.ensureDirectory(artifacts);
        await storage.writeText(joinPath(directory, 'manifest.json'), JSON.stringify(manifest));
        return Object.freeze({
          stage_id: nonce,
          bundle_id: manifest.bundle_id,
          revision: manifest.revision,
          directory_uri: directory,
          artifacts_directory_uri: artifacts,
          final_directory_uri: installRoot(manifest.bundle_id, manifest.revision),
        });
      });
    },

    artifactPath(stage, artifactId) {
      return joinPath(stage.artifacts_directory_uri, safePart(artifactId));
    },

    discardStage(stage) {
      return serialized(() => storage.remove(stage.directory_uri).catch(() => undefined));
    },

    commitStage(stage, installation, receipt) {
      return serialized(async () => {
        const stagedManifestPath = joinPath(stage.directory_uri, 'manifest.json');
        if (!(await storage.info(stagedManifestPath)).exists) {
          throw new Error('The staged manifest is missing.');
        }
        const manifest = await verifyManifestDigestInternal(
          JSON.parse(await storage.readText(stagedManifestPath)),
        );
        if (manifest.bundle_id !== stage.bundle_id || manifest.revision !== stage.revision) {
          throw new Error('The staged manifest identity does not match its directory.');
        }
        if (installation.bundle_id !== stage.bundle_id || installation.revision !== stage.revision) {
          throw new Error('The staged installation does not match its manifest identity.');
        }
        if (installation.manifest_sha256.toLowerCase() !== manifest.manifest_sha256.toLowerCase()) {
          throw new Error('The installation manifest checksum does not match the staged manifest.');
        }
        if (installation.directory_uri !== stage.final_directory_uri) {
          throw new Error('The installation directory must reference the immutable final directory.');
        }
        if (receipt.schema_version !== 2
          || receipt.bundle_id !== stage.bundle_id
          || receipt.revision !== stage.revision
          || receipt.manifest_sha256.toLowerCase() !== manifest.manifest_sha256.toLowerCase()) {
          throw new Error('The commit receipt does not match the staged manifest.');
        }
        if (receipt.renderer.id !== manifest.renderer.id
          || receipt.renderer.style_ready !== true
          || receipt.renderer.tiles_ready !== true
          || receipt.renderer.render_probe_ready !== true
          || installation.renderer.renderer !== manifest.renderer.id) {
          throw new Error('The active renderer has not passed the required readiness probe.');
        }
        if (!Number.isSafeInteger(receipt.verified_at_ms)
          || receipt.verified_at_ms <= 0
          || installation.verified_at_ms !== receipt.verified_at_ms) {
          throw new Error('The commit receipt verification time is invalid.');
        }
        const required = manifest.artifacts.filter(artifact => artifact.required);
        const expectedIds = required.map(artifact => artifact.id).sort();
        const receiptIds = [...new Set(receipt.verified_required_artifact_ids)].sort();
        if (JSON.stringify(receiptIds) !== JSON.stringify(expectedIds)) {
          throw new Error('The commit receipt does not cover every required artifact.');
        }
        for (const artifact of required) {
          const state = installation.artifacts[artifact.id];
          if (!state
            || state.status !== 'ready'
            || state.total_bytes !== artifact.bytes
            || state.received_bytes !== artifact.bytes) {
            throw new Error(`Required artifact ${artifact.id} is not verified.`);
          }
          if (artifact.storage !== 'file') continue;
          const stagedPath = joinPath(stage.artifacts_directory_uri, safePart(artifact.id));
          const result = await validateOfflineArtifactFile(storage, artifact, stagedPath);
          if (!result.valid) throw new Error(result.message);
          const expectedLivePath = joinPath(stage.final_directory_uri, 'artifacts', safePart(artifact.id));
          if (state.local_uri !== expectedLivePath) {
            throw new Error(`Required artifact ${artifact.id} has an invalid final path.`);
          }
        }
        if ((await storage.info(stage.final_directory_uri)).exists) {
          throw new Error(`Offline installation ${stage.bundle_id}@${stage.revision} is immutable.`);
        }
        await storage.writeText(joinPath(stage.directory_uri, 'installation.json'), JSON.stringify(installation));
        await promote(storage, stage.directory_uri, stage.final_directory_uri);
        await writeAtomically(storage, currentPath(stage.bundle_id), JSON.stringify({ revision: stage.revision }));
      });
    },

    getInstallation(bundleId, revision) {
      return serialized(async () => {
        const directory = installRoot(bundleId, revision);
        await recover(storage, directory);
        const path = joinPath(directory, 'installation.json');
        if (!(await storage.info(path)).exists) return null;
        return parseInstallation(await storage.readText(path));
      });
    },

    getCurrentInstallation(bundleId) {
      return serialized(async () => {
        const pointer = currentPath(bundleId);
        await recover(storage, pointer);
        if (!(await storage.info(pointer)).exists) return null;
        try {
          const revision = String(JSON.parse(await storage.readText(pointer))?.revision || '');
          if (!revision) return null;
          const path = joinPath(installRoot(bundleId, revision), 'installation.json');
          await recover(storage, installRoot(bundleId, revision));
          if (!(await storage.info(path)).exists) return null;
          return parseInstallation(await storage.readText(path));
        } catch {
          return null;
        }
      });
    },
  };
}
