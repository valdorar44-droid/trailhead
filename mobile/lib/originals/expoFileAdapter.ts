import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import type { OriginalFileAdapter } from './fileAdapter';

function digestToHex(value: ArrayBuffer) {
  return [...new Uint8Array(value)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

function abortError() {
  const error = new Error('Download cancelled.');
  error.name = 'AbortError';
  return error;
}

// Web previews can report a null document directory. Keep module evaluation
// safe there; an attempted offline download still fails through the adapter.
const documentDirectory = FileSystem.documentDirectory ?? 'file:///trailhead/';

export const expoOriginalFileAdapter: OriginalFileAdapter = {
  documentDirectory,

  async info(path) {
    const info = await FileSystem.getInfoAsync(path);
    return {
      exists: info.exists,
      isDirectory: info.exists ? Boolean(info.isDirectory) : false,
      size: info.exists ? Number((info as { size?: number }).size ?? 0) : 0,
    };
  },

  async ensureDirectory(path) {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) await FileSystem.makeDirectoryAsync(path, { intermediates: true });
    else if (!info.isDirectory) throw new Error(`Expected a directory at ${path}.`);
  },

  readText(path) {
    return FileSystem.readAsStringAsync(path);
  },

  writeText(path, value) {
    return FileSystem.writeAsStringAsync(path, value);
  },

  remove(path) {
    return FileSystem.deleteAsync(path, { idempotent: true });
  },

  move(from, to) {
    return FileSystem.moveAsync({ from, to });
  },

  async download(url, destination, options = {}) {
    if (options.signal?.aborted) throw abortError();
    const resumable = FileSystem.createDownloadResumable(
      url,
      destination,
      { headers: options.headers },
      progress => options.onProgress?.(
        progress.totalBytesWritten,
        progress.totalBytesExpectedToWrite,
      ),
    );
    let aborted = false;
    const cancel = () => {
      aborted = true;
      void resumable.pauseAsync().catch(() => undefined);
    };
    options.signal?.addEventListener('abort', cancel, { once: true });
    try {
      const result = await resumable.downloadAsync();
      if (aborted || options.signal?.aborted) throw abortError();
      if (!result?.uri) throw new Error('The asset download did not produce a file.');
    } finally {
      options.signal?.removeEventListener('abort', cancel);
    }
  },

  async sha256(path) {
    const bytes = await new File(path).bytes();
    return digestToHex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes));
  },

  async freeDiskBytes() {
    return FileSystem.getFreeDiskStorageAsync().catch(() => null);
  },
};
