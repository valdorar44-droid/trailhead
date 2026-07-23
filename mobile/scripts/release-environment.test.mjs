import assert from 'node:assert/strict';
import { validateReleaseEnvironment } from './release-environment.mjs';

const ready = {
  EXPO_PUBLIC_SENTRY_DSN: 'https://public@example.ingest.sentry.io/123',
  EXPO_PUBLIC_TELEMETRY_QA_ENABLED: 'true',
  RNMAPBOX_MAPS_DOWNLOAD_TOKEN: 'secret-mapbox-token',
  SENTRY_AUTH_TOKEN: 'secret-sentry-token',
  SENTRY_ORG: 'trailhead',
  SENTRY_PROJECT: 'mobile',
};

assert.deepEqual(validateReleaseEnvironment(ready), { ready: true });
for (const name of Object.keys(ready).filter(name => (
  name !== 'RNMAPBOX_MAPS_DOWNLOAD_TOKEN'
  && name !== 'EXPO_PUBLIC_TELEMETRY_QA_ENABLED'
))) {
  assert.throws(
    () => validateReleaseEnvironment({ ...ready, [name]: '' }),
    new RegExp(name),
  );
}
assert.throws(
  () => validateReleaseEnvironment(
    { ...ready, RNMAPBOX_MAPS_DOWNLOAD_TOKEN: '' },
    { requireNativeDownloadsToken: true },
  ),
  /RNMAPBOX_MAPS_DOWNLOAD_TOKEN/,
);
assert.throws(
  () => validateReleaseEnvironment({ ...ready, EXPO_PUBLIC_SENTRY_DSN: 'http://example.test/1' }),
  /HTTPS project DSN/,
);
assert.deepEqual(
  validateReleaseEnvironment(ready, { requirePreviewQa: true }),
  { ready: true },
);
assert.throws(
  () => validateReleaseEnvironment(
    { ...ready, EXPO_PUBLIC_TELEMETRY_QA_ENABLED: 'false' },
    { requirePreviewQa: true },
  ),
  /EXPO_PUBLIC_TELEMETRY_QA_ENABLED/,
);

console.log('Release environment tests passed.');
