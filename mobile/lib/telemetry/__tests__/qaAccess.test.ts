import assert from 'node:assert/strict';
import { resolveTelemetryQaAccess } from '../qaAccess';

assert.equal(resolveTelemetryQaAccess({
  authHydrated: false,
  navigationReady: false,
  surfaceAllowed: false,
}), 'pending', 'cold launch must not redirect before auth or navigation is ready');

assert.equal(resolveTelemetryQaAccess({
  authHydrated: false,
  navigationReady: true,
  surfaceAllowed: false,
}), 'pending', 'initial signed-out state is not authoritative before auth hydration');

assert.equal(resolveTelemetryQaAccess({
  authHydrated: true,
  navigationReady: false,
  surfaceAllowed: false,
}), 'pending', 'redirect waits until the root navigator is mounted');

assert.equal(resolveTelemetryQaAccess({
  authHydrated: true,
  navigationReady: true,
  surfaceAllowed: true,
}), 'allowed', 'an authenticated preview admin retains QA access');

assert.equal(resolveTelemetryQaAccess({
  authHydrated: true,
  navigationReady: true,
  surfaceAllowed: false,
}), 'redirect', 'a settled unauthorized session redirects from QA');

console.log('telemetry QA access tests passed');
