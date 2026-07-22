import type { OfflineBundleStartV2 } from './coordinator';
import type { OfflineBundleStorageAdapter } from './repository';
import type {
  OfflineArtifactStateV2,
  OfflineBundleInstallationV2,
  OfflineBundleManifestV2,
} from './types';
import type {
  OfflineBundlePreparationV2,
  OfflineBundlePrepareRequestV2,
} from './preparation';

export type OfflineBundleJobStatusV2 =
  | 'preparing'
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'verifying'
  | 'ready'
  | 'repair_required'
  | 'error';

export type OfflineBundleDownloadJobV2 = Readonly<{
  schema_version: 2;
  job_id: string;
  owner_scope: string;
  client_ref?: string;
  label: string;
  status: OfflineBundleJobStatusV2;
  request: OfflineBundlePrepareRequestV2;
  preparation?: OfflineBundlePreparationV2;
  manifest?: OfflineBundleManifestV2;
  start?: OfflineBundleStartV2;
  artifact_states: Readonly<Record<string, OfflineArtifactStateV2>>;
  resume_tokens: Readonly<Record<string, string>>;
  renderer_installation?: OfflineBundleInstallationV2['renderer'];
  error?: Readonly<{ code: string; message: string }>;
  created_at_ms: number;
  updated_at_ms: number;
}>;

export interface OfflineBundleJobStoreV2 {
  save(job: OfflineBundleDownloadJobV2): Promise<void>;
  get(jobId: string): Promise<OfflineBundleDownloadJobV2 | null>;
  list(ownerScope: string): Promise<readonly OfflineBundleDownloadJobV2[]>;
  remove(jobId: string): Promise<void>;
}

function join(root: string, ...parts: string[]) {
  return [root.replace(/\/+$/, ''), ...parts.map(part => part.replace(/^\/+|\/+$/g, ''))]
    .filter(Boolean)
    .join('/');
}

function safe(value: string) {
  return encodeURIComponent(value).replace(/%/g, '_');
}

function parent(path: string) {
  const slash = path.replace(/\/+$/, '').lastIndexOf('/');
  return slash > 0 ? path.slice(0, slash) : path;
}

async function writeAtomic(storage: OfflineBundleStorageAdapter, path: string, value: string) {
  const temporary = `${path}.tmp`;
  await storage.ensureDirectory(parent(path));
  await storage.remove(temporary).catch(() => undefined);
  await storage.writeText(temporary, value);
  const backup = `${path}.bak`;
  await storage.remove(backup).catch(() => undefined);
  const hadLive = (await storage.info(path)).exists;
  if (hadLive) await storage.move(path, backup);
  try {
    await storage.move(temporary, path);
  } catch (error) {
    if (hadLive && !(await storage.info(path)).exists && (await storage.info(backup)).exists) {
      await storage.move(backup, path).catch(() => undefined);
    }
    throw error;
  }
  await storage.remove(backup).catch(() => undefined);
}

function parseJob(value: string): OfflineBundleDownloadJobV2 | null {
  try {
    const job = JSON.parse(value) as OfflineBundleDownloadJobV2;
    return job?.schema_version === 2 && job.job_id && job.owner_scope ? Object.freeze(job) : null;
  } catch {
    return null;
  }
}

export function createOfflineBundleJobStoreV2(
  storage: OfflineBundleStorageAdapter,
  root = join(storage.documentDirectory, 'offline-v2', 'jobs'),
): OfflineBundleJobStoreV2 {
  const indexPath = join(root, '_index.json');
  let tail: Promise<unknown> = Promise.resolve();
  const serialized = <T>(operation: () => Promise<T>) => {
    const result = tail.then(operation, operation);
    tail = result.catch(() => undefined);
    return result;
  };
  const pathFor = (jobId: string) => join(root, `${safe(jobId)}.json`);
  const readIds = async () => {
    if (!(await storage.info(indexPath)).exists) return [] as string[];
    try {
      const parsed = JSON.parse(await storage.readText(indexPath));
      if (!Array.isArray(parsed?.job_ids)) return [] as string[];
      const ids: string[] = parsed.job_ids
        .map((value: unknown) => String(value))
        .filter((value: string) => Boolean(value));
      return [...new Set<string>(ids)];
    } catch {
      return [] as string[];
    }
  };

  return {
    save(job) {
      return serialized(async () => {
        await writeAtomic(storage, pathFor(job.job_id), JSON.stringify(job));
        const ids = await readIds();
        if (!ids.includes(job.job_id)) {
          await writeAtomic(storage, indexPath, JSON.stringify({ schema_version: 1, job_ids: [...ids, job.job_id] }));
        }
      });
    },
    get(jobId) {
      return serialized(async () => {
        const path = pathFor(jobId);
        return (await storage.info(path)).exists ? parseJob(await storage.readText(path)) : null;
      });
    },
    list(ownerScope) {
      return serialized(async () => {
        const jobs = await Promise.all((await readIds()).map(async id => {
          const path = pathFor(id);
          return (await storage.info(path)).exists ? parseJob(await storage.readText(path)) : null;
        }));
        return Object.freeze(jobs
          .filter((job): job is OfflineBundleDownloadJobV2 => Boolean(job && job.owner_scope === ownerScope))
          .sort((left, right) => right.updated_at_ms - left.updated_at_ms));
      });
    },
    remove(jobId) {
      return serialized(async () => {
        await storage.remove(pathFor(jobId)).catch(() => undefined);
        const ids = (await readIds()).filter(id => id !== jobId);
        await writeAtomic(storage, indexPath, JSON.stringify({ schema_version: 1, job_ids: ids }));
      });
    },
  };
}
