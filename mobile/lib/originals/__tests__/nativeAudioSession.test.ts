import assert from 'node:assert/strict';
import { createNativeAudioSessionQueue } from '../nativeAudioSession';

async function main() {
  const apply = createNativeAudioSessionQueue();
  const events: string[] = [];
  let releaseFirst = () => {};
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });

  const first = apply(async () => {
    events.push('voice:start');
    await firstGate;
    events.push('voice:end');
  });
  const second = apply(async () => {
    events.push('originals:start');
    events.push('originals:end');
  });

  await Promise.resolve();
  assert.deepEqual(events, ['voice:start'], 'native audio-session changes are serialized');
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, [
    'voice:start',
    'voice:end',
    'originals:start',
    'originals:end',
  ]);

  await apply(async () => { events.push('originals:reapplied'); });
  assert.equal(events.at(-1), 'originals:reapplied', 'mode setup runs again on resume');

  console.log('Native audio session queue tests passed.');
}

void main();
