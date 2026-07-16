import { createHash } from 'node:crypto';
import type { OriginalFileAdapter, OriginalFileInfo } from '../fileAdapter';

export function createMemoryOriginalFileAdapter(input: {
  downloads?: Record<string, Uint8Array>;
  freeBytes?: number;
} = {}) {
  const files = new Map<string, Uint8Array>();
  const directories = new Set<string>(['memory://docs']);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const normalized = (path: string) => path.replace(/\/+$/, '');

  const adapter: OriginalFileAdapter & {
    files: Map<string, Uint8Array>;
    directories: Set<string>;
  } = {
    documentDirectory: 'memory://docs',
    files,
    directories,

    async info(path): Promise<OriginalFileInfo> {
      const key = normalized(path);
      const value = files.get(key);
      return value
        ? { exists: true, isDirectory: false, size: value.byteLength }
        : { exists: directories.has(key), isDirectory: directories.has(key), size: 0 };
    },

    async ensureDirectory(path) {
      const parts = normalized(path).split('/');
      for (let index = 3; index <= parts.length; index += 1) {
        directories.add(parts.slice(0, index).join('/'));
      }
    },

    async readText(path) {
      const value = files.get(normalized(path));
      if (!value) throw new Error('File not found.');
      return decoder.decode(value);
    },

    async writeText(path, value) {
      files.set(normalized(path), encoder.encode(value));
    },

    async remove(path) {
      const key = normalized(path);
      files.delete(key);
      [...files.keys()].filter(item => item.startsWith(`${key}/`)).forEach(item => files.delete(item));
      [...directories].filter(item => item === key || item.startsWith(`${key}/`)).forEach(item => directories.delete(item));
    },

    async move(from, to) {
      const source = normalized(from);
      const destination = normalized(to);
      const direct = files.get(source);
      if (direct) {
        files.set(destination, direct);
        files.delete(source);
        return;
      }
      const movingFiles = [...files.entries()].filter(([path]) => path.startsWith(`${source}/`));
      const movingDirectories = [...directories].filter(path => path === source || path.startsWith(`${source}/`));
      if (!movingFiles.length && !movingDirectories.length) throw new Error('Source not found.');
      movingDirectories.forEach(path => {
        directories.delete(path);
        directories.add(`${destination}${path.slice(source.length)}`);
      });
      movingFiles.forEach(([path, value]) => {
        files.delete(path);
        files.set(`${destination}${path.slice(source.length)}`, value);
      });
    },

    async download(url, destination, options = {}) {
      if (options.signal?.aborted) throw new Error('cancelled');
      const value = input.downloads?.[url];
      if (!value) throw new Error(`No fixture download for ${url}.`);
      files.set(normalized(destination), value);
      options.onProgress?.(value.byteLength, value.byteLength);
    },

    async sha256(path) {
      const value = files.get(normalized(path));
      if (!value) throw new Error('File not found.');
      return createHash('sha256').update(value).digest('hex');
    },

    async freeDiskBytes() {
      return input.freeBytes ?? 1_000_000;
    },
  };

  return adapter;
}
