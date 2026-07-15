import assert from 'node:assert/strict';
import test from 'node:test';
import { withAbortableTimeout } from '../routeBuilder/timeout';

test('route save deadline aborts the in-flight request', async () => {
  let requestSignal: AbortSignal | undefined;
  await assert.rejects(
    withAbortableTimeout(signal => {
      requestSignal = signal;
      return new Promise<never>(() => {});
    }, 5, 'route-save-geometry-timeout'),
    /route-save-geometry-timeout/,
  );
  assert.equal(requestSignal?.aborted, true);
});

test('parent cancellation aborts the save request with the session code', async () => {
  const parent = new AbortController();
  let requestSignal: AbortSignal | undefined;
  const pending = withAbortableTimeout(signal => {
    requestSignal = signal;
    return new Promise<never>(() => {});
  }, 1000, 'route-save-geometry-timeout', parent.signal);

  parent.abort();

  await assert.rejects(pending, /route-build-cancelled/);
  assert.equal(requestSignal?.aborted, true);
});
