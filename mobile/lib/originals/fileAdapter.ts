export type OriginalFileInfo = {
  exists: boolean;
  isDirectory: boolean;
  size: number;
};

export type OriginalDownloadOptions = {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  onProgress?: (receivedBytes: number, totalBytes: number) => void;
};

export type OriginalFileAdapter = {
  documentDirectory: string;
  info(path: string): Promise<OriginalFileInfo>;
  ensureDirectory(path: string): Promise<void>;
  readText(path: string): Promise<string>;
  writeText(path: string, value: string): Promise<void>;
  remove(path: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  download(url: string, destination: string, options?: OriginalDownloadOptions): Promise<void>;
  sha256(path: string): Promise<string>;
  freeDiskBytes(): Promise<number | null>;
};

export function joinOriginalPath(root: string, ...parts: string[]) {
  const prefix = root.replace(/\/+$/, '');
  const suffix = parts
    .map(part => String(part).replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
  return suffix ? `${prefix}/${suffix}` : prefix;
}

export function originalPathParent(path: string) {
  const normalized = path.replace(/\/+$/, '');
  const slash = normalized.lastIndexOf('/');
  return slash > 0 ? normalized.slice(0, slash) : normalized;
}

export function originalBackupPath(path: string) {
  return `${path}.bak`;
}

/**
 * Finish recovery from an interrupted promotion. A live path is never removed
 * before its replacement is ready: the previous value is renamed to a backup
 * and remains recoverable until the new value is in place.
 */
export async function recoverOriginalPath(
  files: OriginalFileAdapter,
  path: string,
) {
  const live = await files.info(path);
  if (live.exists) return;
  const backup = originalBackupPath(path);
  if ((await files.info(backup)).exists) await files.move(backup, path);
}

export async function promoteOriginalPathSafely(
  files: OriginalFileAdapter,
  preparedPath: string,
  livePath: string,
) {
  const backup = originalBackupPath(livePath);
  await recoverOriginalPath(files, livePath);
  await files.remove(backup).catch(() => {});
  const hadLiveValue = (await files.info(livePath)).exists;
  if (hadLiveValue) await files.move(livePath, backup);
  try {
    await files.move(preparedPath, livePath);
  } catch (error) {
    if (hadLiveValue && !(await files.info(livePath)).exists && (await files.info(backup)).exists) {
      await files.move(backup, livePath).catch(() => {});
    }
    throw error;
  }
  await files.remove(backup).catch(() => {});
}

export async function writeOriginalTextAtomically(
  files: OriginalFileAdapter,
  path: string,
  value: string,
) {
  const temporary = `${path}.tmp`;
  await files.ensureDirectory(originalPathParent(path));
  await files.remove(temporary).catch(() => {});
  await files.writeText(temporary, value);
  await promoteOriginalPathSafely(files, temporary, path);
}
