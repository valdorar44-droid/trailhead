import assert from 'node:assert/strict';
import {
  ORIGINAL_MAP_STALL_TIMEOUT_MS,
  createOriginalMapDownloadWatchdog,
  observeOriginalMapDownload,
} from '../mapDownloadWatchdog';

function main() {
  const started = createOriginalMapDownloadWatchdog(1_000);
  assert.equal(
    observeOriginalMapDownload(started, null, 1_000 + ORIGINAL_MAP_STALL_TIMEOUT_MS - 1).stalled,
    false,
    'a download remains eligible immediately before the fixed stall boundary',
  );
  assert.equal(
    observeOriginalMapDownload(started, null, 1_000 + ORIGINAL_MAP_STALL_TIMEOUT_MS).stalled,
    true,
    'a download without native progress fails at the fixed stall boundary',
  );

  const first = observeOriginalMapDownload(started, {
    percentage: 12,
    receivedBytes: 1_024,
    complete: false,
  }, 5_000);
  assert.equal(first.advanced, true);
  assert.equal(first.state.lastProgressAtMs, 5_000);

  const duplicate = observeOriginalMapDownload(first.state, {
    percentage: 12,
    receivedBytes: 1_024,
    complete: false,
  }, 40_000);
  assert.equal(duplicate.advanced, false);
  assert.equal(
    duplicate.state.lastProgressAtMs,
    5_000,
    'repeated native callbacks cannot keep a stalled download alive forever',
  );

  const bytesOnly = observeOriginalMapDownload(duplicate.state, {
    percentage: 12,
    receivedBytes: 2_048,
    complete: false,
  }, 41_000);
  assert.equal(bytesOnly.advanced, true);
  assert.equal(bytesOnly.state.lastProgressAtMs, 41_000);

  const regressed = observeOriginalMapDownload(bytesOnly.state, {
    percentage: 4,
    receivedBytes: 512,
    complete: false,
  }, 42_000);
  assert.equal(regressed.state.lastPercentage, 12);
  assert.equal(regressed.state.lastReceivedBytes, 2_048);
  assert.equal(regressed.advanced, false);

  const verified = observeOriginalMapDownload(regressed.state, {
    percentage: 100,
    receivedBytes: 8_192,
    complete: true,
  }, 43_000);
  assert.equal(verified.complete, true);
  assert.equal(verified.stalled, false);

  const callbackOnly = observeOriginalMapDownload(regressed.state, {
    percentage: 100,
    receivedBytes: 8_192,
    complete: false,
  }, 43_000);
  assert.equal(
    callbackOnly.complete,
    false,
    'a 100% callback is progress, but installed-pack verification owns readiness',
  );

  console.log('Originals offline-map watchdog tests passed.');
}

main();
