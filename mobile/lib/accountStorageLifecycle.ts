export type AccountStorageEpoch = number;

export type AccountStorageBackend = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<unknown>;
  del: (key: string) => Promise<unknown>;
};

export function createAccountStorageLifecycle(backend: AccountStorageBackend) {
  let generation = 0;
  let cleanupDepth = 0;
  let writeTail: Promise<unknown> = Promise.resolve();
  const listeners = new Set<(cleaning: boolean, epoch: AccountStorageEpoch) => void>();

  const notify = () => {
    for (const listener of listeners) {
      try { listener(cleanupDepth > 0, generation); } catch {}
    }
  };

  const lifecycle = {
    epoch: (): AccountStorageEpoch => generation,
    isCleaning: () => cleanupDepth > 0,
    subscribe: (listener: (cleaning: boolean, epoch: AccountStorageEpoch) => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    get: (key: string) => backend.get(key),
    run: <T>(operation: () => Promise<T>, epoch: AccountStorageEpoch = generation): Promise<T | undefined> => {
      if (cleanupDepth > 0 || epoch !== generation) return Promise.resolve(undefined);
      const result = writeTail.then(async () => {
        if (cleanupDepth > 0 || epoch !== generation) return undefined;
        return operation();
      });
      writeTail = result.catch(() => undefined);
      return result;
    },
    set: (key: string, value: string, epoch: AccountStorageEpoch = generation) => {
      if (cleanupDepth > 0 || epoch !== generation) return Promise.resolve(false);
      return lifecycle.run(async () => {
        await backend.set(key, value);
        return true;
      }, epoch).then(result => result === true);
    },
    del: (key: string, epoch: AccountStorageEpoch = generation) => {
      if (cleanupDepth > 0 || epoch !== generation) return Promise.resolve(false);
      return lifecycle.run(async () => {
        await backend.del(key);
        return true;
      }, epoch).then(result => result === true);
    },
    beginCleanup: () => {
      generation += 1;
      cleanupDepth += 1;
      notify();
      return writeTail.catch(() => undefined);
    },
    endCleanup: () => {
      cleanupDepth = Math.max(0, cleanupDepth - 1);
      notify();
    },
  };

  return lifecycle;
}
