import assert from 'node:assert/strict';
import { deliverPendingOriginalFeedback, retryOriginalFeedback, submitOriginalFeedback } from '../feedback';
import { createOriginalFeedbackStore, type OriginalFeedbackPayloadV1 } from '../feedbackStore';
import { createMemoryOriginalFileAdapter } from './memoryFileAdapter';

const files = createMemoryOriginalFileAdapter();
const store = createOriginalFeedbackStore(files);
const payload: OriginalFeedbackPayloadV1 = {
  version: 4,
  stop_id: 'mesa-arch',
  category: 'trigger_timing',
  rating: 4,
  message: 'The story began a little late.',
  platform: 'ios',
  app_version: '1.0.9',
  runtime_version: 'native-1.0.9-originals1',
};

let attempt = 0;
const submittedKeys: string[] = [];
const guestTokens: string[] = [];
const installIds: string[] = [];
const api = {
  async feedbackGuestToken(_packId: string, _version: number, installId: string) {
    installIds.push(installId);
    const token = `guest-token-${guestTokens.length + 1}`;
    guestTokens.push(token);
    return { token };
  },
  async submitFeedback(_packId: string, submitted: OriginalFeedbackPayloadV1, options: { idempotencyKey: string; guestToken?: string }) {
    submittedKeys.push(options.idempotencyKey);
    assert.deepEqual(submitted, payload);
    attempt += 1;
    if (attempt === 1) throw new Error('offline');
    assert.equal(options.guestToken, 'guest-token-2');
    return { receipt_id: 'feedback-42' };
  },
};

async function main() {
const first = await submitOriginalFeedback({
  packId: 'moab',
  payload,
  authentication: 'guest',
  idempotencyKey: 'feedback-idempotency-1',
  nowMs: 100,
}, { store, api });
assert.equal(first.sent, false);
let pending = await store.listPending('moab', 4);
assert.equal(pending.length, 1, 'feedback is persisted before a failed network delivery');
assert.equal(pending[0].attempt_count, 1);
assert.equal(pending[0].last_error, 'offline');

const retried = await retryOriginalFeedback({ store, api }, 'moab', 4);
assert.deepEqual(retried.map(value => value.sent), [true]);
assert.deepEqual(submittedKeys, ['feedback-idempotency-1', 'feedback-idempotency-1']);
assert.equal(installIds.length, 2);
assert.equal(installIds[0], installIds[1], 'the opaque install identifier remains stable across guest retries');
assert.equal((await store.listPending('moab', 4)).length, 0);
const receipts = await store.listReceipts('moab', 4);
assert.equal(receipts[0].server_receipt_id, 'feedback-42');
assert.equal(receipts[0].idempotency_key, 'feedback-idempotency-1');

const signed = {
  schema_version: 1 as const,
  idempotency_key: 'signed-feedback',
  pack_id: 'moab',
  payload,
  authentication: 'signed_in' as const,
  created_at_ms: 200,
  updated_at_ms: 200,
  attempt_count: 0,
};
await store.enqueue(signed);
const signedResult = await deliverPendingOriginalFeedback(signed, { store, api, authToken: null });
assert.equal(signedResult.sent, false);
pending = await store.listPending('moab', 4);
assert.equal(pending.find(value => value.idempotency_key === 'signed-feedback')?.attempt_count, 1);

console.log('Originals feedback queue tests passed.');
}

void main();
