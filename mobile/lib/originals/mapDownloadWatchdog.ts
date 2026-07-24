export type OriginalMapDownloadObservation = {
  percentage: number;
  receivedBytes: number;
  complete: boolean;
};

export type OriginalMapDownloadWatchdogState = {
  lastPercentage: number;
  lastReceivedBytes: number;
  lastProgressAtMs: number;
};

export const ORIGINAL_MAP_STATUS_POLL_MS = 2_000;
export const ORIGINAL_MAP_STALL_TIMEOUT_MS = 60_000;

function finiteNonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function createOriginalMapDownloadWatchdog(
  nowMs: number,
): OriginalMapDownloadWatchdogState {
  return {
    lastPercentage: 0,
    lastReceivedBytes: 0,
    lastProgressAtMs: nowMs,
  };
}

export function observeOriginalMapDownload(
  state: OriginalMapDownloadWatchdogState,
  observation: OriginalMapDownloadObservation | null,
  nowMs: number,
  stallTimeoutMs = ORIGINAL_MAP_STALL_TIMEOUT_MS,
) {
  const percentage = observation
    ? Math.min(100, finiteNonNegative(observation.percentage))
    : state.lastPercentage;
  const receivedBytes = observation
    ? finiteNonNegative(observation.receivedBytes)
    : state.lastReceivedBytes;
  const advanced = percentage > state.lastPercentage
    || receivedBytes > state.lastReceivedBytes;
  const nextState: OriginalMapDownloadWatchdogState = {
    lastPercentage: Math.max(state.lastPercentage, percentage),
    lastReceivedBytes: Math.max(state.lastReceivedBytes, receivedBytes),
    lastProgressAtMs: advanced ? nowMs : state.lastProgressAtMs,
  };
  const complete = observation?.complete === true;
  return {
    state: nextState,
    advanced,
    complete,
    stalled: !complete && nowMs - nextState.lastProgressAtMs >= stallTimeoutMs,
  };
}
