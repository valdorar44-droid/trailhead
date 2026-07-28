import type { OfflineArtifactKind } from './types';

export type OfflineVerificationPhaseCodeV1 =
  | 'search_index'
  | 'manifest'
  | 'renderer_probe'
  | 'artifact_integrity'
  | 'promote';

export type OfflineVerificationProgressV1 = Readonly<{
  phase_code: OfflineVerificationPhaseCodeV1;
  artifact_kind?: OfflineArtifactKind;
  started_at_ms: number;
}>;

export function offlineVerificationLabel(progress?: OfflineVerificationProgressV1) {
  switch (progress?.phase_code) {
    case 'search_index': return 'Checking offline search';
    case 'renderer_probe': return 'Checking offline map';
    case 'artifact_integrity': return 'Checking downloaded data';
    case 'manifest':
    case 'promote': return 'Finishing download';
    default: return 'Verifying';
  }
}

export async function awaitOfflineVerificationV1<T>(
  operation: Promise<T>,
  options: Readonly<{ signal?: AbortSignal; timeout_ms?: number }> = {},
) {
  const timeoutMs = Math.max(1, Math.round(options.timeout_ms ?? 60_000));
  if (options.signal?.aborted) {
    const error = new Error('Offline download paused.');
    error.name = 'AbortError';
    throw error;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let removeAbort: () => void = () => {};
  const boundary = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error('Offline verification did not finish in time.');
      (error as Error & { code?: string }).code = 'offline_verification_timeout';
      reject(error);
    }, timeoutMs);
    const abort = () => {
      const error = new Error('Offline download paused.');
      error.name = 'AbortError';
      reject(error);
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    removeAbort = () => options.signal?.removeEventListener('abort', abort);
  });
  try {
    return await Promise.race([operation, boundary]);
  } finally {
    if (timer) clearTimeout(timer);
    removeAbort();
  }
}
