import type { OriginalLocationSample } from './types';

export type OriginalLocationQueueStorage = {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  remove(): Promise<void>;
};

type OriginalLocationQueueSnapshot = {
  schema_version: 1;
  samples: OriginalLocationSample[];
};

type OriginalLocationQueueOptions = {
  maxSamples?: number;
  ttlMs?: number;
  checkpointEvery?: number;
  now?: () => number;
};

const DEFAULT_MAX_SAMPLES = 2048;
const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;
const DEFAULT_CHECKPOINT_EVERY = 20;

function validSample(sample: OriginalLocationSample) {
  return Number.isFinite(sample.lat)
    && Number.isFinite(sample.lng)
    && Math.abs(sample.lat) <= 90
    && Math.abs(sample.lng) <= 180
    && Number.isFinite(sample.timestamp_ms)
    && sample.timestamp_ms > 0;
}

function sampleKey(sample: OriginalLocationSample) {
  return `${sample.timestamp_ms}:${sample.lat.toFixed(7)}:${sample.lng.toFixed(7)}`;
}

function normalizeSamples(
  samples: OriginalLocationSample[],
  nowMs: number,
  ttlMs: number,
  maxSamples: number,
) {
  const oldest = nowMs - ttlMs;
  const newest = nowMs + 5 * 60 * 1000;
  const deduplicated = new Map<string, OriginalLocationSample>();
  samples.forEach(sample => {
    if (!validSample(sample) || sample.timestamp_ms < oldest || sample.timestamp_ms > newest) return;
    deduplicated.set(sampleKey(sample), { ...sample });
  });
  return [...deduplicated.values()]
    .sort((a, b) => a.timestamp_ms - b.timestamp_ms)
    .slice(-maxSamples);
}

function parseSnapshot(raw: string | null) {
  if (!raw) return [] as OriginalLocationSample[];
  try {
    const parsed = JSON.parse(raw) as Partial<OriginalLocationQueueSnapshot>;
    return parsed.schema_version === 1 && Array.isArray(parsed.samples) ? parsed.samples : [];
  } catch {
    return [];
  }
}

export function createOriginalLocationQueue(
  storage: OriginalLocationQueueStorage,
  options: OriginalLocationQueueOptions = {},
) {
  const maxSamples = Math.max(1, Math.floor(options.maxSamples ?? DEFAULT_MAX_SAMPLES));
  const ttlMs = Math.max(60_000, options.ttlMs ?? DEFAULT_TTL_MS);
  const checkpointEvery = Math.max(1, Math.floor(options.checkpointEvery ?? DEFAULT_CHECKPOINT_EVERY));
  const now = options.now ?? Date.now;
  let operationTail: Promise<unknown> = Promise.resolve();

  const serialized = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = operationTail.then(operation, operation);
    operationTail = result.catch(() => undefined);
    return result;
  };

  const read = async () => normalizeSamples(parseSnapshot(await storage.read()), now(), ttlMs, maxSamples);
  const persist = async (samples: OriginalLocationSample[]) => {
    if (!samples.length) {
      await storage.remove();
      return;
    }
    const snapshot: OriginalLocationQueueSnapshot = { schema_version: 1, samples };
    await storage.write(JSON.stringify(snapshot));
  };

  return {
    enqueue(samples: OriginalLocationSample[]) {
      return serialized(async () => {
        const next = normalizeSamples([...await read(), ...samples], now(), ttlMs, maxSamples);
        await persist(next);
        return next.length;
      });
    },

    drain(handler: (sample: OriginalLocationSample) => void | Promise<void>) {
      return serialized(async () => {
        let pending = await read();
        let delivered = 0;
        await persist(pending);
        while (pending.length) {
          try {
            await handler(pending[0]);
          } catch (error) {
            await persist(pending);
            throw error;
          }
          pending = pending.slice(1);
          delivered += 1;
          if (delivered % checkpointEvery === 0) await persist(pending);
        }
        await storage.remove();
        return delivered;
      });
    },

    count() {
      return serialized(async () => (await read()).length);
    },

    clear() {
      return serialized(async () => storage.remove());
    },
  };
}
