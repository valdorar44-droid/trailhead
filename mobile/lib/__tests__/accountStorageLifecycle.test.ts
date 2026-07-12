import assert from 'node:assert/strict';
import { createAccountStorageLifecycle } from '../accountStorageLifecycle';

async function main() {
  const values = new Map<string, string>();
  let releaseWrite!: () => void;
  const writeStarted = new Promise<void>(resolve => {
    releaseWrite = resolve;
  });
  let unblockWrite!: () => void;
  const writeBlocked = new Promise<void>(resolve => {
    unblockWrite = resolve;
  });

  const backend = {
    get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string) => {
      if (key === 'delayed') {
        releaseWrite();
        await writeBlocked;
      }
      values.set(key, value);
    },
    del: async (key: string) => {
      values.delete(key);
    },
  };

  const lifecycle = createAccountStorageLifecycle(backend);
  const lifecycleEvents: Array<{ cleaning: boolean; epoch: number }> = [];
  const unsubscribe = lifecycle.subscribe((cleaning, epoch) => lifecycleEvents.push({ cleaning, epoch }));
  const oldEpoch = lifecycle.epoch();
  const delayedWrite = lifecycle.set('delayed', 'private', oldEpoch);
  await writeStarted;

  const drained = lifecycle.beginCleanup();
  assert.deepEqual(lifecycleEvents, [{ cleaning: true, epoch: oldEpoch + 1 }]);
  assert.equal(await lifecycle.set('during-cleanup', 'private'), false);
  unblockWrite();
  assert.equal(await delayedWrite, true);
  await drained;

  await backend.del('delayed');
  assert.equal(await lifecycle.set('late-write', 'private', oldEpoch), false);
  lifecycle.endCleanup();
  assert.deepEqual(lifecycleEvents.at(-1), { cleaning: false, epoch: oldEpoch + 1 });
  unsubscribe();
  assert.equal(values.has('delayed'), false);
  assert.equal(values.has('late-write'), false);

  assert.equal(await lifecycle.set('new-session', 'allowed'), true);
  assert.equal(values.get('new-session'), 'allowed');

  console.log('Account storage lifecycle tests passed.');
}

void main();
