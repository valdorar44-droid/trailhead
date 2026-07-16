import assert from 'node:assert/strict';
import { createOriginalLocationQueue, type OriginalLocationQueueStorage } from '../locationQueue';
import { backgroundLocationStartMessage, IOS_LOCKED_SCREEN_LOCATION_MESSAGE, requireIosLockedScreenPermission } from '../locationPolicy';
import type { OriginalLocationSample } from '../types';

function memoryStorage(): OriginalLocationQueueStorage & { value: string | null } {
  return {
    value: null,
    async read() { return this.value; },
    async write(value) { this.value = value; },
    async remove() { this.value = null; },
  };
}

const now = 1_800_000_000_000;
const sample = (timestamp: number, lat = 38.5): OriginalLocationSample => ({
  lat,
  lng: -109.5,
  accuracy_m: 12,
  heading_deg: 20,
  speed_mps: 16,
  timestamp_ms: timestamp,
});

async function main() {
  const storage = memoryStorage();
  const queue = createOriginalLocationQueue(storage, {
    now: () => now,
    ttlMs: 60 * 60 * 1000,
    maxSamples: 3,
    checkpointEvery: 1,
  });

  await queue.enqueue([
    sample(now - 3_000, 38.1),
    sample(now - 1_000, 38.3),
    sample(now - 2_000, 38.2),
    sample(now - 2_000, 38.2),
    sample(now - 2 * 60 * 60 * 1000, 37),
  ]);
  assert.equal(await queue.count(), 3, 'queue deduplicates, bounds, and expires fixes');

  const delivered: number[] = [];
  await queue.drain(next => { delivered.push(next.timestamp_ms); });
  assert.deepEqual(delivered, [now - 3_000, now - 2_000, now - 1_000]);
  assert.equal(storage.value, null, 'successful drain removes raw coordinates');

  await queue.enqueue([sample(now - 2_000), sample(now - 1_000)]);
  await assert.rejects(queue.drain(next => {
    if (next.timestamp_ms === now - 1_000) throw new Error('callback unavailable');
  }), /callback unavailable/);
  assert.equal(await queue.count(), 1, 'failed and subsequent fixes remain durable');
  await queue.clear();
  assert.equal(await queue.count(), 0);

  assert.throws(
    () => requireIosLockedScreenPermission('ios', false),
    new RegExp(IOS_LOCKED_SCREEN_LOCATION_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );
  assert.doesNotThrow(() => requireIosLockedScreenPermission('ios', true));
  assert.match(backgroundLocationStartMessage('android'), /active-tour location service/);

  console.log('Originals durable location queue tests passed.');
}

void main();
