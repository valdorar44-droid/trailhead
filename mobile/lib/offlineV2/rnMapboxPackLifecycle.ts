export type RnMapboxOfflinePackStatus = Readonly<{
  percentage?: number;
  completedResourceCount?: number;
  completedResourceSize?: number;
}>;

export type RnMapboxNativeFailureCategory = 'canceled' | 'network' | 'resource' | 'other';

export type RnMapboxNativeFailureSnapshot = Readonly<{
  sequence: number;
  category: RnMapboxNativeFailureCategory;
}>;

export type RnMapboxOfflineLifecyclePhase =
  | 'waiting_for_pack'
  | 'pack_registered'
  | 'progress_observed'
  | 'native_error_canceled'
  | 'native_error_network'
  | 'native_error_resource'
  | 'native_error_other'
  | 'native_error_recovered'
  | 'pack_missing'
  | 'pack_stalled'
  | 'complete'
  | 'paused'
  | 'timed_out';

export type RnMapboxOfflineLifecycleTraceEvent = Readonly<{
  phase: RnMapboxOfflineLifecyclePhase;
  elapsed_ms: number;
  progress_bucket?: number;
}>;

let lastTrace: readonly RnMapboxOfflineLifecycleTraceEvent[] = Object.freeze([]);
let lastTerminalCode: string | null = null;

/**
 * Returns fixed phase codes only. Pack names, bounds, routes, account data, and
 * raw native messages are intentionally never captured.
 */
export function getLastRnMapboxOfflineLifecycleTrace() {
  return lastTrace;
}

export function getLastRnMapboxOfflineLifecycleDiagnostics() {
  return Object.freeze({
    events: lastTrace,
    terminal_code: lastTerminalCode,
  });
}

export function recordRnMapboxOfflineLifecycleTerminalCode(code: string) {
  lastTerminalCode = code;
}

export function classifyRnMapboxNativeFailure(message: unknown): RnMapboxNativeFailureCategory {
  const normalized = typeof message === 'string' ? message.toLowerCase() : '';
  if (/cancel(?:ed|led)|already.*(?:load|pending)/.test(normalized)) return 'canceled';
  if (/network|connect|timeout|timed out|dns|host|socket/.test(normalized)) return 'network';
  if (/tile|resource|style|region|disk|storage/.test(normalized)) return 'resource';
  return 'other';
}

export class RnMapboxOfflineLifecycleError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'RnMapboxOfflineLifecycleError';
    this.code = code;
  }
}

function abortError() {
  const error = new Error('Offline map download paused.');
  error.name = 'AbortError';
  return error;
}

function metric(status: RnMapboxOfflinePackStatus) {
  return Object.freeze({
    percentage: Math.max(0, Math.min(100, Number(status.percentage) || 0)),
    bytes: Math.max(0, Number(status.completedResourceSize) || 0),
    count: Math.max(0, Number(status.completedResourceCount) || 0),
  });
}

function advanced(
  current: ReturnType<typeof metric>,
  previous: ReturnType<typeof metric>,
) {
  return current.percentage > previous.percentage + 0.01
    || current.bytes > previous.bytes
    || current.count > previous.count;
}

export async function awaitRnMapboxOfflinePackReady<TPack>(input: Readonly<{
  getPack(): Promise<TPack | undefined>;
  readStatus(pack: TPack): Promise<RnMapboxOfflinePackStatus>;
  getNativeFailure?(): RnMapboxNativeFailureSnapshot | undefined;
  pause?(pack: TPack): Promise<void>;
  signal?: AbortSignal;
  expectedBytes: number;
  onProgress?(progress: Readonly<{ received_bytes: number; total_bytes: number }>): void;
  onTrace?(event: RnMapboxOfflineLifecycleTraceEvent): void;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  pollIntervalMs?: number;
  nativeErrorStallMs?: number;
  timeoutMs?: number;
}>): Promise<TPack> {
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? (milliseconds => new Promise<void>(resolve => setTimeout(resolve, milliseconds)));
  const startedAt = now();
  const pollIntervalMs = input.pollIntervalMs ?? 400;
  const nativeErrorStallMs = input.nativeErrorStallMs ?? 8_000;
  const timeoutMs = input.timeoutMs ?? 6 * 60 * 60 * 1_000;
  const expectedBytes = Math.max(0, input.expectedBytes);
  const trace: RnMapboxOfflineLifecycleTraceEvent[] = [];
  lastTerminalCode = null;
  const emit = (phase: RnMapboxOfflineLifecyclePhase, percentage?: number) => {
    const event = Object.freeze({
      phase,
      elapsed_ms: Math.max(0, now() - startedAt),
      ...(percentage === undefined ? {} : { progress_bucket: Math.floor(percentage / 10) * 10 }),
    });
    if (trace.at(-1)?.phase !== event.phase || trace.at(-1)?.progress_bucket !== event.progress_bucket) {
      trace.push(event);
      if (trace.length > 24) trace.shift();
      lastTrace = Object.freeze([...trace]);
      input.onTrace?.(event);
    }
  };

  emit('waiting_for_pack');
  let previous = metric({});
  let lastProgressAt = startedAt;
  let lastFailureSequence = -1;
  let pendingFailure: Readonly<{
    category: RnMapboxNativeFailureCategory;
    observedAt: number;
    baseline: ReturnType<typeof metric>;
  }> | undefined;
  let registered = false;

  while (true) {
    if (input.signal?.aborted) {
      const pack = await input.getPack().catch(() => undefined);
      if (pack && input.pause) await input.pause(pack).catch(() => undefined);
      emit('paused');
      throw abortError();
    }
    if (now() - startedAt > timeoutMs) {
      emit('timed_out');
      recordRnMapboxOfflineLifecycleTerminalCode('rnmapbox_pack_timed_out');
      throw new RnMapboxOfflineLifecycleError(
        'rnmapbox_pack_timed_out',
        'The offline map did not finish in time.',
      );
    }

    const failure = input.getNativeFailure?.();
    if (failure && failure.sequence > lastFailureSequence) {
      lastFailureSequence = failure.sequence;
      pendingFailure = Object.freeze({
        category: failure.category,
        observedAt: now(),
        baseline: previous,
      });
      emit(`native_error_${failure.category}` as RnMapboxOfflineLifecyclePhase, previous.percentage);
    }

    const pack = await input.getPack().catch(() => undefined);
    if (!pack) {
      emit('pack_missing');
      const code = pendingFailure
        ? `rnmapbox_${pendingFailure.category}_pack_missing`
        : 'rnmapbox_pack_missing';
      recordRnMapboxOfflineLifecycleTerminalCode(code);
      throw new RnMapboxOfflineLifecycleError(
        code,
        'The offline map could not be created.',
      );
    }
    if (!registered) {
      registered = true;
      emit('pack_registered');
    }

    const status = await input.readStatus(pack);
    const current = metric(status);
    const didAdvance = advanced(current, previous);
    if (didAdvance) {
      lastProgressAt = now();
      emit('progress_observed', current.percentage);
      if (pendingFailure && advanced(current, pendingFailure.baseline)) {
        pendingFailure = undefined;
        emit('native_error_recovered', current.percentage);
      }
    }

    const received = Math.min(
      expectedBytes,
      Math.max(current.bytes, Math.round(expectedBytes * current.percentage / 100)),
    );
    input.onProgress?.({ received_bytes: received, total_bytes: expectedBytes });
    if (current.percentage >= 100) {
      emit('complete', 100);
      lastTerminalCode = null;
      return pack;
    }

    previous = current;
    if (pendingFailure
      && now() - Math.max(pendingFailure.observedAt, lastProgressAt) >= nativeErrorStallMs) {
      emit('pack_stalled', current.percentage);
      const code = `rnmapbox_${pendingFailure.category}_pack_stalled`;
      recordRnMapboxOfflineLifecycleTerminalCode(code);
      throw new RnMapboxOfflineLifecycleError(
        code,
        'The offline map stopped before it was ready. Try again.',
      );
    }
    await sleep(pollIntervalMs);
  }
}
