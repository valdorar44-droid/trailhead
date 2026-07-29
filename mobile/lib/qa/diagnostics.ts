export type QaDiagnosticsSnapshotV1 = {
  schema: 'qa_diagnostics_v1';
  release: {
    appVersion: string;
    buildNumber: string;
    channel: string;
    commitSha: string;
    platform: 'android' | 'ios';
    runtimeVersion: string;
    updateId: string;
  };
  accountRole: 'guest' | 'account' | 'explorer' | 'admin';
  features: {
    configured: {
      offlineV2: 'off' | 'public';
      originals: 'off' | 'internal' | 'public_beta' | 'public';
      searchV2: 'off' | 'public';
      uiSystemV2: 'off' | 'public';
    };
    effectiveAccess: {
      offlineV2: boolean;
      originals: boolean;
      searchV2: boolean;
      uiSystemV2: boolean;
    };
  };
  offlineBundles: Array<{
    placeRecords: number;
    revision: string;
    searchRecords: number;
    state: string;
    trailRecords: number;
  }>;
  offlinePlacePacksV1: {
    packCount: number;
    pointCount: number;
    pointCountUnknownPackCount: number;
    storageBytes: number;
  };
  offlineRendererLifecycle: {
    terminalCode: string | null;
    events: Array<{
      phase: string;
      elapsedMs: number;
      progressBucket?: number;
    }>;
  };
  runtimeMemory: {
    jsHeapTotalBytes: number;
    jsHeapUsedBytes: number;
  };
  tripRepository: {
    stateFileBytes: number;
    tripCount: number;
    savedEntityCount: number;
    outboxCount: number;
    hydration: {
      pages: number;
      items: number;
      applied: number;
      skipped: number;
    };
    persist: {
      count: number;
      totalSerializedBytes: number;
      maxSerializedBytes: number;
    };
  };
  activeTrip: {
    serializedBytes: number;
    audioGuideEntryCount: number;
    routeCoordinateCount: number;
    routeStepCount: number;
    routeLegCount: number;
    waypointCount: number;
  } | null;
  original: { packId: string; version: number } | null;
};

type QaDiagnosticsInputV1 = Omit<
  QaDiagnosticsSnapshotV1,
  'schema' | 'offlineRendererLifecycle'
> & {
  offlineRendererLifecycle?: unknown;
} & Record<string, unknown>;

function boundedCount(value: unknown): number {
  const count = Number(value);
  return Number.isInteger(count) && count >= 0 ? Math.min(count, 10_000_000) : 0;
}

function boundedBytes(value: unknown): number {
  const bytes = Number(value);
  return Number.isSafeInteger(bytes) && bytes >= 0
    ? Math.min(bytes, 1_000_000_000_000)
    : 0;
}

function machineValue(value: unknown, fallback = 'unknown'): string {
  const candidate = String(value || '').trim();
  return /^[a-z0-9][a-z0-9._:+-]{0,159}$/i.test(candidate) ? candidate : fallback;
}

function binaryStage(value: unknown): 'off' | 'public' {
  return value === 'public' ? 'public' : 'off';
}

function originalsStage(value: unknown): 'off' | 'internal' | 'public_beta' | 'public' {
  return ['off', 'internal', 'public_beta', 'public'].includes(String(value))
    ? value as 'off' | 'internal' | 'public_beta' | 'public'
    : 'off';
}

const OFFLINE_RENDERER_PHASES = new Set([
  'waiting_for_pack',
  'pack_registered',
  'progress_observed',
  'native_error_canceled',
  'native_error_network',
  'native_error_resource',
  'native_error_other',
  'native_error_recovered',
  'pack_missing',
  'pack_stalled',
  'complete',
  'paused',
  'timed_out',
]);

const OFFLINE_RENDERER_TERMINAL_CODES = new Set([
  'rnmapbox_pack_timed_out',
  'rnmapbox_pack_missing',
  ...['canceled', 'network', 'resource', 'other'].flatMap(category => [
    `rnmapbox_${category}_before_registration`,
    `rnmapbox_${category}_pack_missing`,
    `rnmapbox_${category}_pack_stalled`,
  ]),
]);

function offlineRendererLifecycle(value: any): QaDiagnosticsSnapshotV1['offlineRendererLifecycle'] {
  const terminalCode = OFFLINE_RENDERER_TERMINAL_CODES.has(String(value?.terminal_code))
    ? String(value.terminal_code)
    : null;
  const events = (Array.isArray(value?.events) ? value.events : [])
    .slice(-24)
    .flatMap((event: any) => {
      const phase = String(event?.phase || '');
      if (!OFFLINE_RENDERER_PHASES.has(phase)) return [];
      const elapsedMs = Math.min(24 * 60 * 60 * 1_000, boundedCount(event?.elapsed_ms));
      const rawBucket = Number(event?.progress_bucket);
      const progressBucket = Number.isFinite(rawBucket)
        ? Math.max(0, Math.min(100, Math.floor(rawBucket / 10) * 10))
        : undefined;
      return [{
        phase,
        elapsedMs,
        ...(progressBucket === undefined ? {} : { progressBucket }),
      }];
    });
  return { terminalCode, events };
}

export function buildQaDiagnosticsSnapshotV1(input: QaDiagnosticsInputV1): QaDiagnosticsSnapshotV1 {
  return {
    schema: 'qa_diagnostics_v1',
    release: {
      appVersion: machineValue(input.release?.appVersion),
      buildNumber: machineValue(input.release?.buildNumber),
      channel: machineValue(input.release?.channel),
      commitSha: machineValue(input.release?.commitSha),
      platform: input.release?.platform === 'ios' ? 'ios' : 'android',
      runtimeVersion: machineValue(input.release?.runtimeVersion),
      updateId: machineValue(input.release?.updateId),
    },
    accountRole: ['guest', 'account', 'explorer', 'admin'].includes(input.accountRole)
      ? input.accountRole
      : 'guest',
    features: {
      configured: {
        offlineV2: binaryStage(input.features?.configured?.offlineV2),
        originals: originalsStage(input.features?.configured?.originals),
        searchV2: binaryStage(input.features?.configured?.searchV2),
        uiSystemV2: binaryStage(input.features?.configured?.uiSystemV2),
      },
      effectiveAccess: {
        offlineV2: input.features?.effectiveAccess?.offlineV2 === true,
        originals: input.features?.effectiveAccess?.originals === true,
        searchV2: input.features?.effectiveAccess?.searchV2 === true,
        uiSystemV2: input.features?.effectiveAccess?.uiSystemV2 === true,
      },
    },
    offlineBundles: (input.offlineBundles || []).slice(0, 100).map(bundle => ({
      placeRecords: boundedCount(bundle.placeRecords),
      revision: machineValue(bundle.revision),
      searchRecords: boundedCount(bundle.searchRecords),
      state: machineValue(bundle.state),
      trailRecords: boundedCount(bundle.trailRecords),
    })),
    offlinePlacePacksV1: {
      packCount: boundedCount(input.offlinePlacePacksV1?.packCount),
      pointCount: boundedCount(input.offlinePlacePacksV1?.pointCount),
      pointCountUnknownPackCount: boundedCount(
        input.offlinePlacePacksV1?.pointCountUnknownPackCount,
      ),
      storageBytes: boundedBytes(input.offlinePlacePacksV1?.storageBytes),
    },
    offlineRendererLifecycle: offlineRendererLifecycle(input.offlineRendererLifecycle),
    runtimeMemory: {
      jsHeapTotalBytes: boundedBytes(input.runtimeMemory?.jsHeapTotalBytes),
      jsHeapUsedBytes: boundedBytes(input.runtimeMemory?.jsHeapUsedBytes),
    },
    tripRepository: {
      stateFileBytes: boundedBytes(input.tripRepository?.stateFileBytes),
      tripCount: boundedCount(input.tripRepository?.tripCount),
      savedEntityCount: boundedCount(input.tripRepository?.savedEntityCount),
      outboxCount: boundedCount(input.tripRepository?.outboxCount),
      hydration: {
        pages: boundedCount(input.tripRepository?.hydration?.pages),
        items: boundedCount(input.tripRepository?.hydration?.items),
        applied: boundedCount(input.tripRepository?.hydration?.applied),
        skipped: boundedCount(input.tripRepository?.hydration?.skipped),
      },
      persist: {
        count: boundedCount(input.tripRepository?.persist?.count),
        totalSerializedBytes: boundedBytes(input.tripRepository?.persist?.totalSerializedBytes),
        maxSerializedBytes: boundedBytes(input.tripRepository?.persist?.maxSerializedBytes),
      },
    },
    activeTrip: input.activeTrip
      ? {
          serializedBytes: boundedBytes(input.activeTrip.serializedBytes),
          audioGuideEntryCount: boundedCount(input.activeTrip.audioGuideEntryCount),
          routeCoordinateCount: boundedCount(input.activeTrip.routeCoordinateCount),
          routeStepCount: boundedCount(input.activeTrip.routeStepCount),
          routeLegCount: boundedCount(input.activeTrip.routeLegCount),
          waypointCount: boundedCount(input.activeTrip.waypointCount),
        }
      : null,
    original: input.original
      ? {
          packId: machineValue(input.original.packId),
          version: boundedCount(input.original.version),
        }
      : null,
  };
}
