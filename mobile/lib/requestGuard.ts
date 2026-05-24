type CacheEntry<T> = { expiresAt: number; value: T };

const inflight = new Map<string, Promise<unknown>>();
const memoryCache = new Map<string, CacheEntry<unknown>>();

export function normalizeRequestText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function stableNumber(value: number, precision = 3): string {
  return Number.isFinite(value) ? value.toFixed(precision) : '0';
}

export function stableRouteKey(route?: [number, number][]): string {
  if (!route?.length) return 'no-route';
  const first = route[0];
  const middle = route[Math.floor(route.length / 2)];
  const last = route[route.length - 1];
  return [route.length, first, middle, last]
    .map(value => Array.isArray(value) ? `${stableNumber(value[1])},${stableNumber(value[0])}` : String(value))
    .join(':');
}

export function guardedRequest<T>(
  key: string,
  ttlMs: number,
  factory: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const cached = memoryCache.get(key);
  if (cached && cached.expiresAt > now) return Promise.resolve(cached.value as T);

  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = factory()
    .then(value => {
      if (ttlMs > 0) memoryCache.set(key, { expiresAt: Date.now() + ttlMs, value });
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, promise);
  return promise;
}
