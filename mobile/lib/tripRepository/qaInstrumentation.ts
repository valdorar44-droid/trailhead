export type TripRepositoryQaInstrumentationV1 = {
  stateFileBytes: number;
  persist: {
    count: number;
    totalSerializedBytes: number;
    maxSerializedBytes: number;
  };
  hydration: {
    pages: number;
    items: number;
    applied: number;
    skipped: number;
  };
};

const MAX_DIAGNOSTIC_COUNT = 10_000_000;
const MAX_DIAGNOSTIC_BYTES = 1_000_000_000_000;

const emptyInstrumentation = (): TripRepositoryQaInstrumentationV1 => ({
  stateFileBytes: 0,
  persist: {
    count: 0,
    totalSerializedBytes: 0,
    maxSerializedBytes: 0,
  },
  hydration: {
    pages: 0,
    items: 0,
    applied: 0,
    skipped: 0,
  },
});

const instrumentationByScope = new Map<string, TripRepositoryQaInstrumentationV1>();

function boundedCount(value: unknown): number {
  const count = Number(value);
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.min(Math.trunc(count), MAX_DIAGNOSTIC_COUNT);
}

function boundedBytes(value: unknown): number {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return Math.min(Math.trunc(bytes), MAX_DIAGNOSTIC_BYTES);
}

function scopeInstrumentation(scopeKey: string): TripRepositoryQaInstrumentationV1 {
  const existing = instrumentationByScope.get(scopeKey);
  if (existing) return existing;
  const created = emptyInstrumentation();
  instrumentationByScope.set(scopeKey, created);
  return created;
}

export function recordTripRepositoryStateFileBytes(scopeKey: string, bytes: unknown): void {
  scopeInstrumentation(scopeKey).stateFileBytes = boundedBytes(bytes);
}

export function recordTripRepositoryPersist(scopeKey: string, serializedBytes: unknown): void {
  const instrumentation = scopeInstrumentation(scopeKey);
  const bytes = boundedBytes(serializedBytes);
  instrumentation.stateFileBytes = bytes;
  instrumentation.persist.count = boundedCount(instrumentation.persist.count + 1);
  instrumentation.persist.totalSerializedBytes = boundedBytes(
    instrumentation.persist.totalSerializedBytes + bytes,
  );
  instrumentation.persist.maxSerializedBytes = Math.max(
    instrumentation.persist.maxSerializedBytes,
    bytes,
  );
}

export function recordTripRepositoryHydrationPage(scopeKey: string, itemCount: unknown): void {
  const instrumentation = scopeInstrumentation(scopeKey);
  instrumentation.hydration.pages = boundedCount(instrumentation.hydration.pages + 1);
  instrumentation.hydration.items = boundedCount(
    instrumentation.hydration.items + boundedCount(itemCount),
  );
}

export function recordTripRepositoryHydrationResult(
  scopeKey: string,
  result: { applied?: unknown; skipped?: unknown },
): void {
  const instrumentation = scopeInstrumentation(scopeKey);
  instrumentation.hydration.applied = boundedCount(
    instrumentation.hydration.applied + boundedCount(result.applied),
  );
  instrumentation.hydration.skipped = boundedCount(
    instrumentation.hydration.skipped + boundedCount(result.skipped),
  );
}

export function getTripRepositoryQaInstrumentation(
  scopeKey: string,
): TripRepositoryQaInstrumentationV1 {
  const instrumentation = instrumentationByScope.get(scopeKey) ?? emptyInstrumentation();
  return {
    stateFileBytes: instrumentation.stateFileBytes,
    persist: { ...instrumentation.persist },
    hydration: { ...instrumentation.hydration },
  };
}

export function resetTripRepositoryQaInstrumentationForTests(scopeKey?: string): void {
  if (scopeKey) instrumentationByScope.delete(scopeKey);
  else instrumentationByScope.clear();
}
