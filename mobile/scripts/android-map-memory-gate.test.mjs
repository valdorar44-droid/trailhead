import assert from 'node:assert/strict';

import {
  BASELINE_SETTLE_MS,
  FINAL_LAYER_REPAIR_MAX_ATTEMPTS,
  HEAVY_MAP_LAYER_KEYS,
  LAYER_PERSISTENCE_SETTLE_MS,
  LAYER_STATE_CONVERGENCE_TIMEOUT_MS,
  MAP_LAYER_CYCLE_COUNT,
  MAX_GROWTH_PERCENT,
  MAX_TOTAL_PSS_KB,
  MemoryGateError,
  QA_DIAGNOSTICS_URI,
  applyLayerRestorationOutcome,
  assertSafeMemoryGateAdbArgs,
  captureAndDisableHeavyLayers,
  checkedStateFromNode,
  classifyActiveMapSession,
  convergeLayerState,
  durablyRestoreCapturedHeavyLayers,
  executeMemoryGateLifecycle,
  evaluateBaselinePssLimit,
  evaluateMemoryGate,
  horizontalCarouselSwipePoints,
  median,
  parseMemoryGateArgs,
  restoreCapturedHeavyLayers,
  validatePreviewBuildEvidence,
  validateQaReleaseIdentity,
} from './android-map-memory-gate.mjs';

assert.equal(BASELINE_SETTLE_MS, 90_000);
assert.equal(LAYER_STATE_CONVERGENCE_TIMEOUT_MS, 5_000);
assert.equal(LAYER_PERSISTENCE_SETTLE_MS, 2_000);
assert.equal(FINAL_LAYER_REPAIR_MAX_ATTEMPTS, 2);
assert.equal(MAP_LAYER_CYCLE_COUNT, 10);
assert.equal(MAX_TOTAL_PSS_KB, 512_000);
assert.equal(MAX_GROWTH_PERCENT, 10);
assert.deepEqual(HEAVY_MAP_LAYER_KEYS, ['3d', 'lands', 'usgs', 'pois', 'trails', 'fire', 'ava', 'radar', 'mvum']);

const phoneCarouselBounds = { left: 0, top: 1_200, right: 720, bottom: 1_500 };
assert.deepEqual(
  horizontalCarouselSwipePoints(phoneCarouselBounds, 'forward'),
  [450, 1_350, 270, 1_350],
  'the gate must advance less than one layer card so a clipped middle card cannot be skipped',
);
assert.deepEqual(
  horizontalCarouselSwipePoints(phoneCarouselBounds, 'reverse'),
  [270, 1_350, 450, 1_350],
);
assert.throws(
  () => horizontalCarouselSwipePoints({ left: 0, top: 0, right: 70, bottom: 100 }, 'forward'),
  error => error instanceof MemoryGateError && error.code === 'carousel_bounds_unavailable',
);
const narrowCarouselSwipe = horizontalCarouselSwipePoints(
  { left: 10, top: 100, right: 90, bottom: 160 },
  'forward',
);
assert.equal(narrowCarouselSwipe[0] - narrowCarouselSwipe[2], 48);
assert.ok(narrowCarouselSwipe[2] >= 10 && narrowCarouselSwipe[0] <= 90);

// Model the physical carousel rather than teleporting directly to a target.
// Three cards fit on screen and each bounded drag advances at most one card.
// This is the exact layout that the former 72%-width fling skipped `pois` in.
const physicalLayerOrder = ['3d', 'lands', 'usgs', 'pois', 'trails', 'nautical', 'fire', 'ava', 'radar', 'mvum'];
const seekPhysicalCarousel = (targets, start, step) => {
  let position = start;
  const visited = [];
  for (const target of targets) {
    for (let attempt = 0; attempt < physicalLayerOrder.length; attempt += 1) {
      const visible = physicalLayerOrder.slice(position, position + 3);
      if (visible.includes(target)) {
        visited.push(target);
        break;
      }
      position = Math.max(0, Math.min(physicalLayerOrder.length - 3, position + step));
    }
  }
  return visited;
};
const forwardPhysicalVisit = seekPhysicalCarousel(HEAVY_MAP_LAYER_KEYS, 0, 1);
assert.deepEqual(forwardPhysicalVisit, HEAVY_MAP_LAYER_KEYS);
assert.ok(forwardPhysicalVisit.indexOf('pois') < forwardPhysicalVisit.indexOf('trails'));
assert.deepEqual(
  seekPhysicalCarousel([...HEAVY_MAP_LAYER_KEYS].reverse(), physicalLayerOrder.length - 3, -1),
  [...HEAVY_MAP_LAYER_KEYS].reverse(),
);

const parsed = parseMemoryGateArgs([
  '--serial', 'RFCR408DA9B',
  '--expected-version-name', '1.0.10',
  '--expected-version-code', '59',
  '--expected-commit-sha', '90b8124f701a8bb9f6f2119f67bb7cceecc80267',
  '--expected-build-commit-sha', '25741160e205b545226eff299eaa9755ba1f6933',
  '--runtime', 'native-1.0.10-android.1',
  '--build-id', '06142308-0199-46cc-8a4c-fb9d45bca25e',
  '--update-id', '019f8c00-d492-71f0-8ea8-5214fb196a3c',
]);
assert.equal(parsed.serial, 'RFCR408DA9B');
assert.equal(parsed.packageName, 'com.trailhead.app');
assert.equal(parsed.expectedVersionCode, '59');
assert.equal(parsed.expectedCommitSha, '90b8124f701a8bb9f6f2119f67bb7cceecc80267');
assert.equal(parsed.expectedBuildCommitSha, '25741160e205b545226eff299eaa9755ba1f6933');
assert.notEqual(parsed.expectedCommitSha, parsed.expectedBuildCommitSha, 'compatible OTAs may run on an older binary build');
assert.throws(() => parseMemoryGateArgs([]), error => error instanceof MemoryGateError && error.code === 'invalid_serial');
assert.throws(
  () => parseMemoryGateArgs(['--serial', 'safe', '--max-pss-kb', '999999']),
  error => error instanceof MemoryGateError && error.code === 'invalid_arguments',
  'acceptance limits must not be configurable from the CLI',
);
assert.throws(
  () => parseMemoryGateArgs([
    '--serial', 'RFCR408DA9B', '--package', 'com.example.other',
    '--expected-version-name', '1.0.10', '--expected-version-code', '59',
    '--expected-commit-sha', '90b8124f701a8bb9f6f2119f67bb7cceecc80267',
    '--expected-build-commit-sha', '25741160e205b545226eff299eaa9755ba1f6933',
    '--runtime', 'native-1.0.10-android.1', '--build-id', 'build', '--update-id', 'update',
  ]),
  error => error instanceof MemoryGateError && error.code === 'invalid_package',
);
assert.throws(
  () => parseMemoryGateArgs([
    '--serial', 'RFCR408DA9B',
    '--expected-version-name', '1.0.10', '--expected-version-code', '59',
    '--expected-commit-sha', '90b8124f701a8bb9f6f2119f67bb7cceecc80267',
    '--runtime', 'native-1.0.10-android.1', '--build-id', 'build', '--update-id', 'update',
  ]),
  error => error instanceof MemoryGateError && error.code === 'invalid_build_commit_sha',
);

assert.equal(median([3, 1, 2]), 2);
assert.equal(median([4, 1, 2, 3]), 2.5);

const baselineUnderLimit = evaluateBaselinePssLimit([420_000, 511_999, 430_000]);
assert.equal(baselineUnderLimit.passed, true);
assert.equal(baselineUnderLimit.maxObservedPssKb, 511_999);
const baselineWithOneBoundarySample = evaluateBaselinePssLimit([400_000, 512_000, 401_000]);
assert.equal(
  baselineWithOneBoundarySample.passed,
  false,
  'one baseline sample at the strict limit must stop the gate before layer cycles',
);
assert.equal(baselineWithOneBoundarySample.maxObservedPssKb, 512_000);

const passing = evaluateMemoryGate({
  baselineSamples: [420_000, 421_000, 419_000],
  cyclePeakSamples: [480_000, 490_000],
  postSamples: [450_000, 451_000, 449_000],
});
assert.equal(passing.passed, true);
assert.equal(passing.maxObservedPssKb, 490_000);

const pssBoundary = evaluateMemoryGate({
  baselineSamples: [400_000, 400_000, 400_000],
  cyclePeakSamples: [512_000],
  postSamples: [400_000, 400_000, 400_000],
});
assert.equal(pssBoundary.pssPassed, false, '512000 KB must fail the strict less-than gate');
assert.equal(pssBoundary.passed, false);

const growthBoundary = evaluateMemoryGate({
  baselineSamples: [400_000, 400_000, 400_000],
  cyclePeakSamples: [440_000],
  postSamples: [440_000, 440_000, 440_000],
});
assert.equal(growthBoundary.growthPercent, 10);
assert.equal(growthBoundary.growthPassed, false, '10% growth must fail the strict less-than gate');
assert.equal(growthBoundary.passed, false);

const uiNode = (resourceId, extra = '') => `<hierarchy><node resource-id="${resourceId}" content-desc="" checkable="false" checked="false" bounds="[0,0][100,100]" ${extra}/></hierarchy>`;
assert.equal(classifyActiveMapSession({ uiXml: uiNode('com.trailhead.app:id/map.navigation.end') }), 'active_navigation_ui');
assert.equal(classifyActiveMapSession({ uiXml: uiNode('originals.player.resume-pill') }), 'active_original_ui');
assert.equal(classifyActiveMapSession({ serviceDump: 'ServiceRecord{42 com.trailhead.app/.car.TrailheadCarLocationService}' }), 'active_navigation_service');
assert.equal(classifyActiveMapSession({ serviceDump: 'ServiceRecord{42 expo.modules.location.services.LocationTaskService}' }), 'active_original_service');
assert.equal(classifyActiveMapSession({ uiXml: uiNode('map.layers.open'), serviceDump: 'No services found' }), null);

assert.equal(checkedStateFromNode({ checkable: 'true', checked: 'true' }), true);
assert.equal(checkedStateFromNode({ checkable: 'true', checked: 'false' }), false);
assert.throws(
  () => checkedStateFromNode({ checkable: 'false', checked: 'false' }),
  error => error instanceof MemoryGateError && error.code === 'layer_accessibility_state_missing',
);

let convergenceClock = 0;
let convergenceTaps = 0;
let convergenceReads = 0;
const delayedStates = [false, false, true];
assert.equal(await convergeLayerState({
  initialState: false,
  desiredState: true,
  tapOnce: async () => { convergenceTaps += 1; },
  readState: async () => {
    convergenceReads += 1;
    return delayedStates.shift() ?? true;
  },
  waitFor: async durationMs => { convergenceClock += durationMs; },
  now: () => convergenceClock,
  timeoutMs: 1_000,
  pollIntervalMs: 100,
  failureCode: 'layer_toggle_failed_delayed',
}), true);
assert.equal(convergenceTaps, 1, 'a delayed toggle must be tapped exactly once');
assert.equal(convergenceReads, 3, 'the node must be reacquired until its state converges');

let timeoutClock = 0;
let timeoutTaps = 0;
await assert.rejects(
  convergeLayerState({
    initialState: false,
    desiredState: true,
    tapOnce: async () => { timeoutTaps += 1; },
    readState: async () => false,
    waitFor: async durationMs => { timeoutClock += durationMs; },
    now: () => timeoutClock,
    timeoutMs: 300,
    pollIntervalMs: 100,
    failureCode: 'layer_toggle_failed_timeout_fixture',
  }),
  error => error instanceof MemoryGateError && error.code === 'layer_toggle_failed_timeout_fixture',
);
assert.equal(timeoutTaps, 1, 'a slow or failed transition must never be blindly re-tapped');

let alreadyConvergedTaps = 0;
assert.equal(await convergeLayerState({
  initialState: true,
  desiredState: true,
  tapOnce: async () => { alreadyConvergedTaps += 1; },
  readState: async () => { throw new Error('an already-converged node should not be reacquired'); },
}), true);
assert.equal(alreadyConvergedTaps, 0);

const originalLayerStates = Object.fromEntries(
  HEAVY_MAP_LAYER_KEYS.map((key, index) => [key, index % 2 === 0]),
);
const disabledLayerStates = Object.fromEntries(
  HEAVY_MAP_LAYER_KEYS.map(key => [key, false]),
);
const baselineActions = [];
let capturedBeforeDisable = null;
const preparedLayers = await captureAndDisableHeavyLayers({
  captureStates: async () => {
    baselineActions.push('capture');
    return originalLayerStates;
  },
  resetBeforeDisable: async () => {
    baselineActions.push('reset');
  },
  disableLayers: async () => {
    baselineActions.push('disable');
    assert.deepEqual(capturedBeforeDisable, originalLayerStates, 'original choices must be recorded before toggling');
    return disabledLayerStates;
  },
  onCaptured: states => {
    baselineActions.push('record');
    capturedBeforeDisable = states;
  },
});
assert.deepEqual(baselineActions, ['capture', 'record', 'reset', 'disable']);
assert.deepEqual(preparedLayers.initialStates, originalLayerStates);
assert.deepEqual(preparedLayers.baselineStates, disabledLayerStates);
assert.notEqual(preparedLayers.initialStates, originalLayerStates, 'the restoration snapshot must not alias mutable UI state');
await assert.rejects(
  captureAndDisableHeavyLayers({
    captureStates: async () => originalLayerStates,
    disableLayers: async () => disabledLayerStates,
    onCaptured: () => {},
  }),
  error => error instanceof MemoryGateError && error.code === 'layer_traversal_reset_missing',
);
await assert.rejects(
  captureAndDisableHeavyLayers({
    captureStates: async () => originalLayerStates,
    resetBeforeDisable: async () => {},
    disableLayers: async () => ({ ...disabledLayerStates, fire: true }),
    onCaptured: () => {},
  }),
  error => error instanceof MemoryGateError && error.code === 'layer_baseline_not_disabled_fire',
);

// Stateful regression: the forward capture leaves the carousel at its final
// item. A second forward pass cannot reach `3d` until the gate resets to the
// beginning. Restoration must then put every original choice back exactly.
const carouselModel = {
  position: 0,
  states: { ...originalLayerStates },
  visits: [],
};
const resetCarouselModel = async () => {
  carouselModel.position = 0;
  carouselModel.visits.push('reset');
};
const visitCarouselModel = async desiredState => {
  const states = {};
  for (const key of HEAVY_MAP_LAYER_KEYS) {
    const target = HEAVY_MAP_LAYER_KEYS.indexOf(key);
    if (target < carouselModel.position) {
      throw new MemoryGateError(`model_cannot_seek_forward_${key}`);
    }
    carouselModel.position = target;
    carouselModel.visits.push(`${desiredState == null ? 'capture' : 'set'}:${key}`);
    states[key] = carouselModel.states[key];
    if (desiredState != null) {
      carouselModel.states[key] = desiredState;
      states[key] = desiredState;
    }
  }
  return states;
};
const statefulPreparedLayers = await captureAndDisableHeavyLayers({
  captureStates: () => visitCarouselModel(null),
  resetBeforeDisable: resetCarouselModel,
  disableLayers: () => visitCarouselModel(false),
  onCaptured: () => {},
});
assert.deepEqual(statefulPreparedLayers.initialStates, originalLayerStates);
assert.deepEqual(statefulPreparedLayers.baselineStates, disabledLayerStates);
assert.deepEqual(carouselModel.states, disabledLayerStates);
assert.equal(carouselModel.visits[HEAVY_MAP_LAYER_KEYS.length], 'reset');
await restoreCapturedHeavyLayers(statefulPreparedLayers.initialStates, async states => {
  await resetCarouselModel();
  for (const key of HEAVY_MAP_LAYER_KEYS) {
    const target = HEAVY_MAP_LAYER_KEYS.indexOf(key);
    if (target < carouselModel.position) return false;
    carouselModel.position = target;
    carouselModel.states[key] = states[key];
    carouselModel.visits.push(`restore:${key}`);
  }
  return true;
});
assert.deepEqual(carouselModel.states, originalLayerStates, 'capture → disable → restore must preserve exact layer choices');

let restoredLayerStates = null;
assert.equal(await restoreCapturedHeavyLayers(originalLayerStates, async states => {
  restoredLayerStates = states;
  return true;
}), true);
assert.deepEqual(restoredLayerStates, originalLayerStates, 'the finally path must receive every original layer value');
assert.notEqual(restoredLayerStates, originalLayerStates, 'the restoration target must not alias mutable UI state');
await assert.rejects(
  restoreCapturedHeavyLayers(originalLayerStates, async () => false),
  error => error instanceof MemoryGateError && error.code === 'layer_restore_failed',
);

const durableEvents = [];
const durableModel = { ...disabledLayerStates };
const durableRestoration = await durablyRestoreCapturedHeavyLayers({
  initialStates: originalLayerStates,
  relaunch: async phase => { durableEvents.push(`relaunch:${phase}`); },
  setLayers: async (keys, desiredState) => {
    durableEvents.push(`set:${desiredState}:${keys.join(',')}`);
    for (const key of keys) durableModel[key] = desiredState;
    return Object.fromEntries(keys.map(key => [key, durableModel[key]]));
  },
  captureStates: async () => {
    durableEvents.push('capture');
    return { ...durableModel };
  },
  waitForPersistence: async durationMs => {
    durableEvents.push(`persist:${durationMs}`);
  },
});
assert.equal(durableRestoration.restored, true);
assert.equal(durableRestoration.failureCode, null);
assert.equal(durableRestoration.recovery.attempt_count, 1);
assert.equal(durableRestoration.recovery.recovered_after_retry, false);
assert.deepEqual(durableRestoration.recovery.verified_before_relaunch, originalLayerStates);
assert.deepEqual(durableRestoration.recovery.verified_after_relaunch, originalLayerStates);
assert.deepEqual(durableModel, originalLayerStates);
assert.deepEqual(durableEvents, [
  'relaunch:before_restore',
  `set:false:${HEAVY_MAP_LAYER_KEYS.filter(key => originalLayerStates[key] === false).join(',')}`,
  `set:true:${HEAVY_MAP_LAYER_KEYS.filter(key => originalLayerStates[key] === true).join(',')}`,
  'capture',
  `persist:${LAYER_PERSISTENCE_SETTLE_MS}`,
  'relaunch:after_restore',
  'capture',
]);

let persistedCaptureCount = 0;
const persistedMismatchModel = { ...originalLayerStates };
const failedDurableRestoration = await durablyRestoreCapturedHeavyLayers({
  initialStates: originalLayerStates,
  relaunch: async phase => {
    if (phase === 'after_restore') persistedMismatchModel.fire = !originalLayerStates.fire;
  },
  setLayers: async (keys, desiredState) => {
    for (const key of keys) persistedMismatchModel[key] = desiredState;
    return Object.fromEntries(keys.map(key => [key, persistedMismatchModel[key]]));
  },
  captureStates: async () => {
    persistedCaptureCount += 1;
    return { ...persistedMismatchModel };
  },
  waitForPersistence: async () => {},
});
assert.equal(failedDurableRestoration.restored, false);
assert.equal(failedDurableRestoration.failureCode, 'layer_restore_persisted_mismatch_fire');
assert.equal(failedDurableRestoration.recovery.attempt_count, FINAL_LAYER_REPAIR_MAX_ATTEMPTS);
assert.equal(failedDurableRestoration.recovery.attempts.length, FINAL_LAYER_REPAIR_MAX_ATTEMPTS);
assert.equal(failedDurableRestoration.recovery.retry_reason, 'layer_restore_persisted_mismatch_fire');
assert.equal(failedDurableRestoration.recovery.recovered_after_retry, false);
assert.equal(failedDurableRestoration.recovery.post_restore_relaunch_completed, true);
assert.deepEqual(
  failedDurableRestoration.recovery.failure_observed_state,
  persistedMismatchModel,
  'the report must preserve the exact boolean recovery state seen after failure',
);
assert.equal(
  persistedCaptureCount,
  3 * FINAL_LAYER_REPAIR_MAX_ATTEMPTS,
  'a persistent mismatch receives one bounded retry and records each verification/failure read',
);

let transientPostRestoreCount = 0;
const recoverableMismatchEvents = [];
const recoverableMismatchModel = { ...disabledLayerStates };
const recoveredDurableRestoration = await durablyRestoreCapturedHeavyLayers({
  initialStates: originalLayerStates,
  relaunch: async phase => {
    recoverableMismatchEvents.push(`relaunch:${phase}`);
    if (phase === 'after_restore') {
      transientPostRestoreCount += 1;
      if (transientPostRestoreCount === 1) {
        recoverableMismatchModel.fire = !originalLayerStates.fire;
      }
    }
  },
  setLayers: async (keys, desiredState) => {
    recoverableMismatchEvents.push(`set:${desiredState}`);
    for (const key of keys) recoverableMismatchModel[key] = desiredState;
    return Object.fromEntries(keys.map(key => [key, recoverableMismatchModel[key]]));
  },
  captureStates: async () => ({ ...recoverableMismatchModel }),
  waitForPersistence: async () => {},
});
assert.equal(recoveredDurableRestoration.restored, true);
assert.equal(recoveredDurableRestoration.failureCode, null);
assert.equal(recoveredDurableRestoration.recovery.attempt_count, 2);
assert.equal(recoveredDurableRestoration.recovery.retry_reason, 'layer_restore_persisted_mismatch_fire');
assert.equal(recoveredDurableRestoration.recovery.recovered_after_retry, true);
assert.deepEqual(recoverableMismatchModel, originalLayerStates);
assert.equal(
  recoverableMismatchEvents.filter(event => event === 'relaunch:after_restore').length,
  2,
  'a recoverable persisted mismatch receives exactly one final retry',
);

let nonPersistedFailureRelaunches = 0;
const unsafeRetryGuard = await durablyRestoreCapturedHeavyLayers({
  initialStates: originalLayerStates,
  relaunch: async () => { nonPersistedFailureRelaunches += 1; },
  setLayers: async () => { throw new MemoryGateError('layer_selector_unavailable_fire'); },
  captureStates: async () => ({ ...disabledLayerStates }),
  waitForPersistence: async () => {},
});
assert.equal(unsafeRetryGuard.restored, false);
assert.equal(unsafeRetryGuard.failureCode, 'layer_selector_unavailable_fire');
assert.equal(unsafeRetryGuard.recovery.attempt_count, 1);
assert.equal(nonPersistedFailureRelaunches, 1, 'unknown selector state is never blindly retried');

const primaryFailureReport = {
  result: 'failed',
  failure_code: 'total_pss_limit_failed',
  restoration_failure_code: null,
  layers: { restored: false, recovery: null },
};
applyLayerRestorationOutcome(primaryFailureReport, failedDurableRestoration);
assert.equal(primaryFailureReport.failure_code, 'total_pss_limit_failed');
assert.equal(primaryFailureReport.restoration_failure_code, 'layer_restore_persisted_mismatch_fire');
assert.deepEqual(primaryFailureReport.layers.recovery, failedDurableRestoration.recovery);

const restorationOnlyFailureReport = {
  result: 'passed',
  failure_code: null,
  restoration_failure_code: null,
  layers: { restored: false, recovery: null },
};
applyLayerRestorationOutcome(restorationOnlyFailureReport, failedDurableRestoration);
assert.equal(restorationOnlyFailureReport.result, 'failed');
assert.equal(restorationOnlyFailureReport.failure_code, null, 'restoration must not fabricate a primary gate failure');
assert.equal(restorationOnlyFailureReport.restoration_failure_code, 'layer_restore_persisted_mismatch_fire');

const lifecycleReport = () => ({
  result: 'running',
  failure_code: null,
  restoration_failure_code: null,
  completed_at: null,
  layers: {
    initial: null,
    baseline: null,
    restored: false,
    recovery: null,
  },
  memory: {
    baseline_samples_kb: [],
    baseline_evaluation: null,
  },
});

const baselineFailureEvents = [];
const baselineFailureReport = lifecycleReport();
let baselineInitialStates = null;
let finalizedBaselineFailure = null;
const completedBaselineFailure = await executeMemoryGateLifecycle({
  report: baselineFailureReport,
  executeGate: async () => {
    baselineFailureEvents.push('execute');
    baselineInitialStates = { ...originalLayerStates };
    baselineFailureReport.layers.initial = baselineInitialStates;
    baselineFailureReport.layers.baseline = { ...disabledLayerStates };
    baselineFailureReport.memory.baseline_samples_kb = [520_000, 521_000, 519_000];
    baselineFailureReport.memory.baseline_evaluation = evaluateBaselinePssLimit(
      baselineFailureReport.memory.baseline_samples_kb,
    );
    if (!baselineFailureReport.memory.baseline_evaluation.passed) {
      throw new MemoryGateError('total_pss_limit_failed');
    }
  },
  getInitialStates: () => baselineInitialStates,
  restoreLayers: async states => {
    baselineFailureEvents.push('restore');
    assert.deepEqual(states, originalLayerStates);
    return durableRestoration;
  },
  finalizeReport: async report => {
    baselineFailureEvents.push('finalize');
    finalizedBaselineFailure = JSON.parse(JSON.stringify(report));
  },
  completedAt: () => '2026-07-23T00:00:00.000Z',
});
assert.deepEqual(baselineFailureEvents, ['execute', 'restore', 'finalize']);
assert.equal(completedBaselineFailure.result, 'failed');
assert.equal(completedBaselineFailure.failure_code, 'total_pss_limit_failed');
assert.equal(completedBaselineFailure.layers.restored, true);
assert.equal(completedBaselineFailure.restoration_failure_code, null);
assert.equal(completedBaselineFailure.completed_at, '2026-07-23T00:00:00.000Z');
assert.deepEqual(finalizedBaselineFailure, completedBaselineFailure);

const dualFailureReport = lifecycleReport();
let dualFailureInitialStates = null;
let finalizedDualFailure = null;
const completedDualFailure = await executeMemoryGateLifecycle({
  report: dualFailureReport,
  executeGate: async () => {
    dualFailureInitialStates = { ...originalLayerStates };
    throw new MemoryGateError('total_pss_limit_failed');
  },
  getInitialStates: () => dualFailureInitialStates,
  restoreLayers: async () => failedDurableRestoration,
  finalizeReport: async report => {
    finalizedDualFailure = JSON.parse(JSON.stringify(report));
  },
  completedAt: () => '2026-07-23T00:00:01.000Z',
});
assert.equal(completedDualFailure.result, 'failed');
assert.equal(completedDualFailure.failure_code, 'total_pss_limit_failed');
assert.equal(completedDualFailure.restoration_failure_code, 'layer_restore_persisted_mismatch_fire');
assert.equal(completedDualFailure.layers.restored, false);
assert.equal(completedDualFailure.layers.recovery.attempt_count, FINAL_LAYER_REPAIR_MAX_ATTEMPTS);
assert.deepEqual(finalizedDualFailure, completedDualFailure, 'the finalized report retains both independent failures');

assert.equal(assertSafeMemoryGateAdbArgs(['devices', '-l']), true);
const remoteUi = '/sdcard/trailhead-memory-gate-123-456.xml';
const allowedDeviceCommands = [
  ['shell', 'getprop', 'ro.product.model'],
  ['shell', 'dumpsys', 'package', 'com.trailhead.app'],
  ['shell', 'dumpsys', 'meminfo', 'com.trailhead.app'],
  ['shell', 'dumpsys', 'activity', 'services', 'com.trailhead.app'],
  ['shell', 'uiautomator', 'dump', remoteUi],
  ['exec-out', 'cat', remoteUi],
  ['shell', 'rm', '-f', remoteUi],
  ['shell', 'cmd', 'package', 'resolve-activity', '--brief', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', 'com.trailhead.app'],
  ['shell', 'am', 'force-stop', 'com.trailhead.app'],
  ['shell', 'am', 'start', '-W', '-n', 'com.trailhead.app/.MainActivity'],
  ['shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', QA_DIAGNOSTICS_URI, '-p', 'com.trailhead.app'],
  ['shell', 'input', 'tap', '500', '900'],
  ['shell', 'input', 'swipe', '900', '500', '200', '500', '220'],
];
for (const command of allowedDeviceCommands) {
  assert.equal(assertSafeMemoryGateAdbArgs(['-s', 'RFCR408DA9B', ...command]), true, command.join(' '));
}
assert.throws(
  () => assertSafeMemoryGateAdbArgs(['-s', 'RFCR408DA9B', 'shell', 'pm', 'clear', 'com.trailhead.app']),
  error => error instanceof MemoryGateError && error.code === 'unsafe_adb_command',
);
assert.throws(
  () => assertSafeMemoryGateAdbArgs(['-s', 'RFCR408DA9B', 'uninstall', 'com.trailhead.app']),
  error => error instanceof MemoryGateError && error.code === 'unsafe_adb_command',
);
assert.throws(
  () => assertSafeMemoryGateAdbArgs(['-s', 'RFCR408DA9B', 'shell', 'pm', 'grant', 'com.trailhead.app', 'android.permission.ACCESS_FINE_LOCATION']),
  error => error instanceof MemoryGateError && error.code === 'unsafe_adb_command',
);
assert.throws(
  () => assertSafeMemoryGateAdbArgs(['-s', 'RFCR408DA9B', 'shell', 'am', 'force-stop', 'com.example.other']),
  error => error instanceof MemoryGateError && error.code === 'unsafe_adb_command',
);

const buildEvidence = {
  id: '06142308-0199-46cc-8a4c-fb9d45bca25e',
  status: 'FINISHED',
  platform: 'ANDROID',
  distribution: 'INTERNAL',
  buildProfile: 'preview',
  channel: 'preview',
  gitCommitHash: '25741160e205b545226eff299eaa9755ba1f6933',
  runtimeVersion: 'native-1.0.10-android.1',
  appVersion: '1.0.10',
  appBuildVersion: '59',
  project: { id: '92c016d2-6e63-480e-a483-a6898d7e77d5' },
};
assert.equal(validatePreviewBuildEvidence(buildEvidence, {
  appVersion: '1.0.10',
  buildId: buildEvidence.id,
  buildCommitSha: buildEvidence.gitCommitHash,
  runtimeVersion: buildEvidence.runtimeVersion,
  versionCode: '59',
}).id, buildEvidence.id);
assert.throws(
  () => validatePreviewBuildEvidence({ ...buildEvidence, gitCommitHash: 'bad' }, {
    appVersion: '1.0.10', buildId: buildEvidence.id, buildCommitSha: buildEvidence.gitCommitHash,
    runtimeVersion: buildEvidence.runtimeVersion, versionCode: '59',
  }),
  error => error instanceof MemoryGateError && error.code === 'build_commit_mismatch',
);

const qaIdentity = {
  schema: 'qa_release_identity_v1',
  appVersion: '1.0.10',
  buildNumber: '59',
  channel: 'preview',
  commitSha: parsed.expectedCommitSha,
  platform: 'android',
  runtimeVersion: buildEvidence.runtimeVersion,
  updateId: '019f8c00-d492-71f0-8ea8-5214fb196a3c',
};
assert.equal(validateQaReleaseIdentity(qaIdentity, {
  expectedVersionName: '1.0.10', expectedVersionCode: '59',
  expectedCommitSha: parsed.expectedCommitSha, runtime: buildEvidence.runtimeVersion,
  updateId: qaIdentity.updateId,
}), true);
assert.throws(
  () => validateQaReleaseIdentity({ ...qaIdentity, updateId: 'wrong' }, {
    expectedVersionName: '1.0.10', expectedVersionCode: '59',
    expectedCommitSha: parsed.expectedCommitSha, runtime: buildEvidence.runtimeVersion,
    updateId: qaIdentity.updateId,
  }),
  error => error instanceof MemoryGateError && error.code === 'qa_update_mismatch',
);

console.log('Android map-memory gate tests passed.');
