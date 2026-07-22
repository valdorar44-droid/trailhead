import assert from 'node:assert/strict';
import {
  QA_PERFORMANCE_TRANSACTION,
  spanWasSampled,
  traceSampleRateFor,
} from '../sampling';

assert.equal(traceSampleRateFor({ name: QA_PERFORMANCE_TRANSACTION }, 0.1), 1);
assert.equal(traceSampleRateFor({ transactionContext: { name: QA_PERFORMANCE_TRANSACTION } }, 0), 1);
assert.equal(traceSampleRateFor({ name: 'trailhead.app' }, 0.1), 0.1);
assert.equal(spanWasSampled({ spanContext: () => ({ traceFlags: 1 }) }), true);
assert.equal(spanWasSampled({ spanContext: () => ({ traceFlags: 0 }) }), false);
assert.equal(spanWasSampled(null), false);

console.log('Telemetry sampling tests passed.');
