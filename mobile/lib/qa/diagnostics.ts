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
  original: { packId: string; version: number } | null;
};

type QaDiagnosticsInputV1 = Omit<QaDiagnosticsSnapshotV1, 'schema'> & Record<string, unknown>;

function boundedCount(value: unknown): number {
  const count = Number(value);
  return Number.isInteger(count) && count >= 0 ? Math.min(count, 10_000_000) : 0;
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
    original: input.original
      ? {
          packId: machineValue(input.original.packId),
          version: boundedCount(input.original.version),
        }
      : null,
  };
}
