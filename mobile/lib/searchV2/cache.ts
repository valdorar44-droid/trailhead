import type { SearchPageModeV2, SearchPageV2, SearchRequestV2 } from './types';

export type SearchV2CacheOptions = {
  capacity?: number;
  ttlMs?: number;
  now?: () => number;
};

type CacheEntry = {
  expiresAt: number;
  page: SearchPageV2;
};

export class SearchV2PageCache {
  private readonly capacity: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly entries = new Map<string, CacheEntry>();

  constructor(options: SearchV2CacheOptions = {}) {
    this.capacity = clampInteger(options.capacity ?? 24, 1, 100);
    this.ttlMs = clampInteger(options.ttlMs ?? 60_000, 0, 10 * 60_000);
    this.now = options.now ?? Date.now;
  }

  get(key: string): SearchPageV2 | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.page;
  }

  set(key: string, page: SearchPageV2): void {
    if (this.ttlMs <= 0) return;
    this.entries.delete(key);
    this.entries.set(key, { expiresAt: this.now() + this.ttlMs, page });
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

export function searchV2CacheKey(mode: SearchPageModeV2, request: SearchRequestV2): string {
  return `${mode}:${stableSerialize({
    ...request,
    query: normalizeSearchV2Query(request.query).toLowerCase(),
  })}`;
}

export function normalizeSearchV2Query(query: string): string {
  return String(query ?? '').trim().replace(/\s+/g, ' ').slice(0, 160);
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableSerialize(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

