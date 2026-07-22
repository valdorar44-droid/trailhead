import assert from 'node:assert/strict';
import { scrubTelemetryString, scrubTelemetryValue } from '../sanitize';

assert.equal(
  scrubTelemetryString('Failed https://gettrailhead.app/r/PRIVATE-CODE?token=secret#fragment'),
  'Failed https://gettrailhead.app',
);

assert.equal(
  scrubTelemetryString('Request 123456 for 51.0447,-114.0719'),
  'Request :id for [Filtered coordinates]',
);

assert.deepEqual(
  scrubTelemetryValue({
    route_geometry: [[-114.07, 51.04]],
    search_query: 'camping near Moab',
    searchText: 'private typed text',
    attachment_refs: ['attachment-private'],
    deviceId: 'private-installation-id',
    platform: 'android',
    runtime_version: 'native-1.0.10-android.1',
    'expo-update-id': '019f7932-c916-7e2b-96b5-0cedf4ffc458',
    request: {
      url: 'https://api.gettrailhead.app/api/support/attachments/private-ref',
      status_code: 500,
    },
  }),
  {
    route_geometry: '[Filtered]',
    search_query: '[Filtered]',
    searchText: '[Filtered]',
    attachment_refs: '[Filtered]',
    deviceId: '[Filtered]',
    platform: 'android',
    runtime_version: 'native-1.0.10-android.1',
    'expo-update-id': '019f7932-c916-7e2b-96b5-0cedf4ffc458',
    request: {
      url: '[Filtered]',
      status_code: 500,
    },
  },
);

console.log('Sentry privacy sanitization tests passed.');
