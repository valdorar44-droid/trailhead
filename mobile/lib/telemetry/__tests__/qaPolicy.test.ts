import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  NATIVE_CRASH_ACKNOWLEDGEMENT,
  requireTelemetryDelivery,
  TelemetryDeliveryError,
  telemetryQaDecision,
} from '../qaPolicy';

const base = {
  channel: 'preview',
  enabled: true,
  isAdmin: true,
  isAndroidEmulator: true,
  nativePrivacySanitizerVerified: true,
};

assert.deepEqual(telemetryQaDecision('javascript_exception', base), { allowed: true });
assert.deepEqual(telemetryQaDecision('performance_span', base), { allowed: true });
assert.deepEqual(
  telemetryQaDecision('javascript_exception', { ...base, enabled: false }),
  { allowed: false, reason: 'disabled' },
);
assert.deepEqual(
  telemetryQaDecision('javascript_exception', { ...base, channel: 'production' }),
  { allowed: false, reason: 'not_preview' },
);
assert.deepEqual(
  telemetryQaDecision('javascript_exception', { ...base, isAdmin: false }),
  { allowed: false, reason: 'not_admin' },
);
assert.deepEqual(
  telemetryQaDecision('native_crash', {
    ...base,
    nativeCrashAcknowledgement: NATIVE_CRASH_ACKNOWLEDGEMENT,
  }),
  { allowed: true },
);
assert.deepEqual(
  telemetryQaDecision('native_crash', {
    ...base,
    isAndroidEmulator: false,
    nativeCrashAcknowledgement: NATIVE_CRASH_ACKNOWLEDGEMENT,
  }),
  { allowed: false, reason: 'not_emulator' },
);
assert.deepEqual(
  telemetryQaDecision('native_crash', base),
  { allowed: false, reason: 'not_acknowledged' },
);
assert.deepEqual(
  telemetryQaDecision('native_crash', {
    ...base,
    nativePrivacySanitizerVerified: false,
    nativeCrashAcknowledgement: NATIVE_CRASH_ACKNOWLEDGEMENT,
  }),
  { allowed: false, reason: 'native_privacy_unverified' },
);
assert.deepEqual(
  telemetryQaDecision('native_crash', {
    ...base,
    channel: 'production',
    nativeCrashAcknowledgement: NATIVE_CRASH_ACKNOWLEDGEMENT,
  }),
  { allowed: false, reason: 'not_preview' },
);

const runtimeSource = readFileSync('lib/telemetry/qa.ts', 'utf8');
const sentrySource = readFileSync('lib/telemetry/sentry.ts', 'utf8');
const screenSource = readFileSync('app/qa/telemetry.tsx', 'utf8');
assert.doesNotMatch(
  runtimeSource,
  /Sentry\.nativeCrash\s*\(/,
  'QA must not enable the native Sentry envelope path',
);
assert.match(
  runtimeSource,
  /options\.enableNative === false[\s\S]*?options\.enableNativeCrashHandling === false[\s\S]*?options\.sendDefaultPii === false[\s\S]*?options\.maxBreadcrumbs === 0/,
  'native crash QA must verify the privacy boundary at runtime',
);
assert.match(
  runtimeSource,
  /NativeModules[\s\S]*?RNSentry[\s\S]*?\.crash\(\)/,
  'the acknowledged QA action must terminate through the native bridge',
);
assert.match(sentrySource, /enableNative:\s*false/, 'native envelopes must remain disabled');
assert.match(sentrySource, /enableNativeCrashHandling:\s*false/, 'native crash upload must remain disabled');
assert.match(
  screenSource,
  /qa\.telemetry\.native-crash\.acknowledgement[\s\S]*?NATIVE_CRASH_ACKNOWLEDGEMENT/,
  'the QA screen must require the exact typed acknowledgement',
);
assert.match(
  screenSource,
  /Alert\.alert\([\s\S]*?Crash emulator/,
  'the QA screen must require a second destructive confirmation',
);

void (async () => {
  let captures = 0;
  await assert.rejects(
    requireTelemetryDelivery({
      enabled: false,
      capture: () => { captures += 1; },
      flush: async () => true,
    }),
    (error: unknown) => error instanceof TelemetryDeliveryError && error.reason === 'sentry_disabled',
  );
  assert.equal(captures, 0, 'disabled Sentry must not capture a QA event');

  await assert.rejects(
    requireTelemetryDelivery({
      enabled: true,
      capture: () => { captures += 1; return 'captured'; },
      flush: async () => false,
    }),
    (error: unknown) => error instanceof TelemetryDeliveryError && error.reason === 'flush_failed',
  );
  assert.equal(captures, 1);

  const delivered = await requireTelemetryDelivery({
    enabled: true,
    capture: () => { captures += 1; return 'captured'; },
    flush: async () => true,
  });
  assert.equal(delivered, 'captured');
  assert.equal(captures, 2);
  console.log('Telemetry QA production, delivery, and native-crash guards passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
