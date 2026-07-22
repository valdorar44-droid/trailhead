import assert from 'node:assert/strict';
import {
  allowlistedTelemetryTags,
  allowlistedTransactionName,
  sanitizeTelemetryBreadcrumb,
  sanitizeTelemetryEvent,
} from '../sanitize';

assert.equal(sanitizeTelemetryBreadcrumb(), null);
assert.equal(allowlistedTransactionName('/trips/private-trip-id'), 'trailhead.app');
assert.equal(allowlistedTransactionName('trailhead.qa.performance'), 'trailhead.qa.performance');

assert.deepEqual(
  allowlistedTelemetryTags({
    app_version: '1.0.10',
    error_code: 'qa_js_nonfatal',
    expoUpdateId: '019f7932-c916-7e2b-96b5-0cedf4ffc458',
    search_query: 'camping near Moab',
    deviceId: 'private-installation-id',
    arbitrary: 'not-reviewed',
  }),
  {
    app_version: '1.0.10',
    error_code: 'qa_js_nonfatal',
    expo_update_id: '019f7932-c916-7e2b-96b5-0cedf4ffc458',
  },
);

const sanitized = sanitizeTelemetryEvent({
  event_id: '019f7932c9167e2b96b50cedf4ffc458',
  type: 'transaction',
  transaction: '/support/private-thread',
  message: 'Failed for sean@example.com near 51.0447,-114.0719',
  platform: 'javascript',
  release: 'com.trailhead.app@1.0.10+59',
  dist: '59',
  environment: 'preview',
  user: { id: 'private-account', email: 'sean@example.com' },
  request: { url: 'https://api.gettrailhead.app/api/support/private-thread' },
  breadcrumbs: [{ category: 'ui.input', message: 'camping near Moab' }],
  tags: {
    error_code: 'qa_js_nonfatal',
    runtime_version: 'native-1.0.10-android.1',
    route_id: 'private-route',
  },
  contexts: {
    app: { app_version: '1.0.10', app_build: '59', app_name: 'Trailhead' },
    device: { name: 'Sean phone', unique_id: 'private-device' },
    trace: { trace_id: 'abc123', span_id: 'def456', op: 'qa.telemetry', data: { query: 'Moab' } },
    unknown: { secret: 'private' },
  },
  extra: {
    coordinates: [51.0447, -114.0719],
    route_geometry: [[-114.07, 51.04]],
    attachment: 'private-ref',
  },
  debug_meta: {
    images: [
      {
        type: 'sourcemap',
        debug_id: '67e9247c-814e-392b-a027-dbde6748fcbf',
        code_file: 'app:///index.android.bundle?token=private',
        private_path: '/Users/sean/private/source-map.js',
      },
      {
        type: 'macho',
        debug_id: '6f6cda67-5568-3e7b-a419-51ee6962c51a',
        uuid: '6f6cda67-5568-3e7b-a419-51ee6962c51a',
        image_addr: '0x1000a0000',
        image_size: 7284736,
        image_vmaddr: '0x100000000',
        code_file: '/private/var/containers/Bundle/Application/private-install/Trailhead.app/Trailhead',
        name: '/private/var/containers/Bundle/Application/private-install/Trailhead.app/Trailhead',
        arch: 'arm64',
        unknown_context: { account: 'private-account' },
      },
      {
        type: 'sourcemap',
        debug_id: 'not a debug id belonging to sean@example.com',
        code_file: 'app:///private/user/index.android.bundle',
      },
      {
        type: 'private_debug_format',
        debug_id: '18b5b660-1e92-4e53-a01d-9b065ab72179',
        code_file: '/private/private-account/secret.bundle',
      },
    ],
    private_metadata: { route: 'private-route' },
  },
  exception: {
    values: [{
      type: 'TrailheadQaError',
      value: 'private free-form exception text',
      stacktrace: {
        frames: [{
          abs_path: 'app:///index.android.bundle?token=private',
          filename: 'https://example.test/private/user/index.android.bundle?token=private',
          function: 'runTelemetryQaCheck',
          lineno: 42,
          colno: 7,
          vars: { searchText: 'private typed text' },
        }],
      },
      mechanism: { type: 'generic', handled: true, data: { private: 'value' } },
    }],
  },
  spans: [{
    op: 'qa.telemetry',
    description: 'private trip route',
    trace_id: 'abc123',
    span_id: 'def456',
    start_timestamp: 1,
    timestamp: 2,
    data: { url: 'https://api.gettrailhead.app/private' },
  }],
});

assert.deepEqual(sanitized, {
  contexts: {
    app: { app_build: '59', app_version: '1.0.10' },
    trace: { op: 'qa.telemetry', span_id: 'def456', trace_id: 'abc123' },
  },
  debug_meta: {
    images: [
      {
        code_file: 'app:///index.android.bundle',
        debug_id: '67e9247c-814e-392b-a027-dbde6748fcbf',
        type: 'sourcemap',
      },
      {
        arch: 'arm64',
        code_file: 'Trailhead',
        debug_id: '6f6cda67-5568-3e7b-a419-51ee6962c51a',
        image_addr: '0x1000a0000',
        image_size: 7284736,
        image_vmaddr: '0x100000000',
        name: 'Trailhead',
        type: 'macho',
        uuid: '6f6cda67-5568-3e7b-a419-51ee6962c51a',
      },
    ],
  },
  dist: '59',
  environment: 'preview',
  event_id: '019f7932c9167e2b96b50cedf4ffc458',
  exception: {
    values: [{
      mechanism: { handled: true, type: 'generic' },
      stacktrace: {
        frames: [{
          abs_path: 'app:///index.android.bundle',
          colno: 7,
          filename: 'index.android.bundle',
          function: 'runTelemetryQaCheck',
          lineno: 42,
        }],
      },
      type: 'TrailheadQaError',
      value: 'qa_js_nonfatal',
    }],
  },
  platform: 'javascript',
  release: 'com.trailhead.app@1.0.10+59',
  spans: [{
    op: 'qa.telemetry',
    span_id: 'def456',
    start_timestamp: 1,
    timestamp: 2,
    trace_id: 'abc123',
  }],
  tags: {
    error_code: 'qa_js_nonfatal',
    runtime_version: 'native-1.0.10-android.1',
  },
  transaction: 'trailhead.app',
  type: 'transaction',
});

const serialized = JSON.stringify(sanitized).toLowerCase();
for (const forbidden of [
  'sean@example.com',
  'private-account',
  'private-device',
  'camping near moab',
  '51.0447',
  'private-ref',
  'private free-form exception text',
  'private trip route',
  'token=private',
  'private-install',
  'private_path',
  'private_metadata',
  'private_debug_format',
  'unknown_context',
]) {
  assert.equal(serialized.includes(forbidden), false, `retained private value: ${forbidden}`);
}

const nestedBundlePath = sanitizeTelemetryEvent({
  platform: 'javascript',
  debug_meta: {
    images: [{
      type: 'sourcemap',
      debug_id: '18b5b660-1e92-4e53-a01d-9b065ab72179',
      code_file: 'app:///accounts/private-account/build/index.android.bundle?secret=1',
    }],
  },
  exception: {
    values: [{
      type: 'Error',
      stacktrace: {
        frames: [{
          abs_path: 'app:///accounts/private-account/build/index.android.bundle?secret=1',
          filename: 'app:///accounts/private-account/build/index.android.bundle?secret=1',
          lineno: 7,
        }],
      },
    }],
  },
});

assert.equal(nestedBundlePath.debug_meta.images[0].code_file, 'index.android.bundle');
assert.equal(nestedBundlePath.exception.values[0].stacktrace.frames[0].abs_path, 'index.android.bundle');
assert.equal(nestedBundlePath.exception.values[0].stacktrace.frames[0].filename, 'index.android.bundle');
assert.equal(JSON.stringify(nestedBundlePath).includes('private-account'), false);

const privateTraceOperation = sanitizeTelemetryEvent({
  platform: 'javascript',
  contexts: {
    trace: {
      trace_id: 'abc123',
      span_id: 'def456',
      op: 'search.moab',
    },
  },
});
assert.deepEqual(privateTraceOperation.contexts?.trace, {
  span_id: 'def456',
  trace_id: 'abc123',
});
assert.equal(JSON.stringify(privateTraceOperation).includes('search.moab'), false);

console.log('Sentry allowlist privacy tests passed.');
