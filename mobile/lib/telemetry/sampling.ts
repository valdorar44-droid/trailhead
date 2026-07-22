export const QA_PERFORMANCE_TRANSACTION = 'trailhead.qa.performance';

type TraceSamplingContext = {
  name?: unknown;
  transactionContext?: { name?: unknown };
};

export function traceSampleRateFor(
  context: TraceSamplingContext,
  defaultRate: number,
): number {
  const transactionName = String(
    context?.name ?? context?.transactionContext?.name ?? '',
  );
  return transactionName === QA_PERFORMANCE_TRANSACTION ? 1 : defaultRate;
}

export function spanWasSampled(span: unknown): boolean {
  if (!span || typeof span !== 'object') return false;
  const spanContext = (span as { spanContext?: () => { traceFlags?: number } }).spanContext;
  if (typeof spanContext !== 'function') return false;
  const traceFlags = Number(spanContext.call(span)?.traceFlags || 0);
  return (traceFlags & 1) === 1;
}
