export function withAbortableTimeout<T>(
  run: (signal?: AbortSignal) => Promise<T>,
  ms: number,
  code: string,
  parentSignal?: AbortSignal,
): Promise<T> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      parentSignal?.removeEventListener?.('abort', handleParentAbort);
    };
    const finishResolve = (value: T) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const finishReject = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const handleParentAbort = () => {
      controller?.abort();
      finishReject(new Error('route-build-cancelled'));
    };
    if (parentSignal?.aborted) {
      handleParentAbort();
      return;
    }
    parentSignal?.addEventListener?.('abort', handleParentAbort, { once: true });
    timer = setTimeout(() => {
      controller?.abort();
      finishReject(new Error(code));
    }, ms);
    run(controller?.signal).then(
      value => finishResolve(value),
      error => finishReject(error instanceof Error ? error : new Error(String(error))),
    );
  });
}
