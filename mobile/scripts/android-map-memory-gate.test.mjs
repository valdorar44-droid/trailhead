import assert from 'node:assert/strict';

import {
  BASELINE_SETTLE_MS,
  HEAVY_MAP_LAYER_KEYS,
  MAP_LAYER_CYCLE_COUNT,
  MAX_GROWTH_PERCENT,
  MAX_TOTAL_PSS_KB,
  MemoryGateError,
  QA_DIAGNOSTICS_URI,
  assertSafeMemoryGateAdbArgs,
  captureAndDisableHeavyLayers,
  checkedStateFromNode,
  classifyActiveMapSession,
  evaluateMemoryGate,
  horizontalCarouselSwipePoints,
  median,
  parseMemoryGateArgs,
  restoreCapturedHeavyLayers,
  validatePreviewBuildEvidence,
  validateQaReleaseIdentity,
} from './android-map-memory-gate.mjs';

assert.equal(BASELINE_SETTLE_MS, 90_000);
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
