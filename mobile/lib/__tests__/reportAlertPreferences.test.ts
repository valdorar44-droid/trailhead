import assert from 'node:assert/strict';
import { createAccountStorageLifecycle } from '../accountStorageLifecycle';
import {
  loadReportAlertPreferences,
  parseReportAlertPreferences,
  saveReportAlertPreferences,
} from '../reportAlertPreferences';

async function main() {
  const values = new Map<string, string>();
  const lifecycle = createAccountStorageLifecycle({
    get: async key => values.get(key) ?? null,
    set: async (key, value) => { values.set(key, value); },
    del: async key => { values.delete(key); },
  });

  const first = { road_condition: false, weather: true };
  assert.equal(await saveReportAlertPreferences(lifecycle, first, lifecycle.epoch()), true);
  assert.deepEqual(await loadReportAlertPreferences(lifecycle), first);

  const second = { ...first, weather: false };
  assert.equal(await saveReportAlertPreferences(lifecycle, second, lifecycle.epoch()), true);
  assert.deepEqual(
    await loadReportAlertPreferences(lifecycle),
    { road_condition: false, weather: false },
    'explicit false values survive serialization and a fresh read',
  );

  assert.deepEqual(
    parseReportAlertPreferences('{"road_condition":false,"weather":"false","fire":true}'),
    { road_condition: false, fire: true },
    'invalid preference values do not turn alerts on or off accidentally',
  );
  assert.deepEqual(parseReportAlertPreferences('{not-json'), {});
  assert.deepEqual(
    await loadReportAlertPreferences({ get: async () => { throw new Error('unavailable'); } }),
    {},
  );

  const staleEpoch = lifecycle.epoch();
  await lifecycle.beginCleanup();
  lifecycle.endCleanup();
  assert.equal(await saveReportAlertPreferences(lifecycle, { fire: false }, staleEpoch), false);
  assert.deepEqual(await loadReportAlertPreferences(lifecycle), second);

  console.log('Report alert preference tests passed.');
}

void main();
