import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BASELINE_SETTLE_MS,
  CYCLE_PHASE_SETTLE_MS,
  EXPLORE_RECOVERY_SETTLE_MS,
  FINAL_LAYER_REPAIR_MAX_ATTEMPTS,
  FOREGROUND_PROOF_INTERVAL_MS,
  HEAVY_MAP_LAYER_KEYS,
  LAYER_CAROUSEL_REACQUIRE_POLL_MS,
  LAYER_CAROUSEL_REACQUIRE_TIMEOUT_MS,
  LAST_ANR_PARSE_PREFIX_MAX_CHARS,
  LAYER_PERSISTENCE_SETTLE_MS,
  LAYER_SHEET_PASSIVE_GRACE_MS,
  LAYER_SHEET_POLL_INTERVAL_MS,
  LAYER_SHEET_READY_TIMEOUT_MS,
  LAYER_SHEET_REVEAL_INTERVAL_MS,
  LAYER_STATE_CONVERGENCE_TIMEOUT_MS,
  MAP_LAYER_CYCLE_COUNT,
  MEMORY_GATE_HARNESS_ALLOWED_CHANGED_PATHS,
  MEMORY_GATE_HARNESS_REQUIRED_PATHS,
  MEMORY_GATE_REPORT_PRIVACY_STATEMENT,
  MemoryGateError,
  POST_MAP_SETTLE_MS,
  QA_DIAGNOSTICS_URI,
  applyLayerRestorationOutcome,
  awaitLayerCarouselSnapshot,
  awaitLayerCarouselReady,
  assertAndroidMemoryGateReportV3Privacy,
  assertExactLayerState,
  assertPssAndRssPhaseSafety,
  assertSafeMemoryGateAdbArgs,
  captureAndDisableHeavyLayers,
  checkedStateFromNode,
  classifyActiveMapSession,
  combineAnrCountV3,
  convergeLayerState,
  createLiveAnrMonitorV3,
  durablyRestoreCapturedHeavyLayers,
  ensureLayerSheetReady,
  executeLayerDiagnosticCycles,
  executeMemoryGateLifecycle,
  horizontalCarouselSwipePoints,
  hasPositiveVisibleBounds,
  inspectAwakePowerDump,
  inspectLayerSheetCloseState,
  inspectMapRendererReadiness,
  inspectRecognizedActiveServiceDump,
  inspectRetainedTreeReadiness,
  inspectTopResumedVisibleActivityDump,
  isContinuableLayerWorkloadFailureCode,
  parseMemoryGateArgs,
  parseRecognizedLastAnrDump,
  parseRecognizedExitInfoDump,
  promoteLiveAnrFailureV3,
  recordAndVerifyProcessIdentity,
  restoreCapturedHeavyLayers,
  summarizeMemoryWindow,
  validateMemoryGateHarnessProvenance,
  validatePreviewBuildEvidence,
  validateQaReleaseIdentity,
  waitWithContinuousProof,
  writeAndroidMemoryGateReportV3Atomically,
} from './android-map-memory-gate.mjs';
import {
  ANDROID_MEMORY_GATE_V3_POLICY,
  evaluateAndroidMemoryGateV3,
  evaluateExitInfoDiffV3,
  evaluateObjectCountRatchetV3,
} from './android-memory-gate-v3.mjs';
import { parseUiNodes } from './android-audit-lib.mjs';

assert.equal(BASELINE_SETTLE_MS, 90_000);
assert.equal(POST_MAP_SETTLE_MS, 90_000);
assert.equal(EXPLORE_RECOVERY_SETTLE_MS, 90_000);
assert.equal(CYCLE_PHASE_SETTLE_MS, 5_000);
assert.equal(FOREGROUND_PROOF_INTERVAL_MS, 10_000);
assert.equal(LAYER_STATE_CONVERGENCE_TIMEOUT_MS, 15_000);
assert.equal(LAYER_SHEET_READY_TIMEOUT_MS, 60_000);
assert.equal(LAYER_SHEET_PASSIVE_GRACE_MS, 30_000);
assert.equal(LAYER_SHEET_REVEAL_INTERVAL_MS, 5_000);
assert.equal(LAYER_SHEET_POLL_INTERVAL_MS, 500);
assert.equal(LAYER_CAROUSEL_REACQUIRE_TIMEOUT_MS, 15_000);
assert.equal(LAYER_CAROUSEL_REACQUIRE_POLL_MS, 500);
assert.equal(LAST_ANR_PARSE_PREFIX_MAX_CHARS, 64 * 1024);
assert.equal(LAYER_PERSISTENCE_SETTLE_MS, 2_000);
assert.equal(FINAL_LAYER_REPAIR_MAX_ATTEMPTS, 2);
assert.equal(MAP_LAYER_CYCLE_COUNT, 10);
assert.deepEqual(HEAVY_MAP_LAYER_KEYS, ['3d', 'lands', 'usgs', 'pois', 'trails', 'fire', 'ava', 'radar', 'mvum']);

let delayedSheetClock = 0;
let delayedSheetOpenCount = 0;
let delayedSheetRevealCount = 0;
const delayedSheetResult = await ensureLayerSheetReady({
  readState: async () => ({
    carouselReady: delayedSheetClock >= 25_000,
    sheetOpen: true,
    contentBounds: { left: 0, top: 0, right: 720, bottom: 1200 },
  }),
  openSheet: async () => {
    delayedSheetOpenCount += 1;
  },
  revealContent: async () => {
    delayedSheetRevealCount += 1;
  },
  waitFor: async durationMs => {
    delayedSheetClock += durationMs;
  },
  now: () => delayedSheetClock,
});
assert.equal(delayedSheetResult.waitedMs, 25_000);
assert.equal(delayedSheetOpenCount, 0, 'an already-open delayed sheet is never opened a second time');
assert.equal(delayedSheetRevealCount, 0, 'the passive grace period does not interact with the sheet');

let timedOutSheetClock = 0;
let timedOutSheetRevealCount = 0;
await assert.rejects(
  ensureLayerSheetReady({
    readState: async () => ({
      carouselReady: false,
      sheetOpen: true,
      contentBounds: { left: 0, top: 0, right: 720, bottom: 1200 },
    }),
    openSheet: async () => {
      throw new Error('an open sheet must not be tapped again');
    },
    revealContent: async () => {
      timedOutSheetRevealCount += 1;
    },
    waitFor: async durationMs => {
      timedOutSheetClock += durationMs;
    },
    now: () => timedOutSheetClock,
  }),
  error => error instanceof MemoryGateError && error.code === 'layer_carousel_unavailable',
);
assert.equal(timedOutSheetClock, LAYER_SHEET_READY_TIMEOUT_MS);
assert.equal(timedOutSheetRevealCount, 6, 'reveal swipes are bounded to one every five seconds after grace');

await assert.rejects(
  awaitLayerCarouselReady({
    readState: async () => ({ carouselReady: false, sheetOpen: true, contentBounds: null }),
    revealContent: async () => {},
    waitFor: async () => {},
    now: () => 0,
    timeoutMs: 30_000,
    passiveGraceMs: 30_000,
  }),
  error => error instanceof MemoryGateError && error.code === 'layer_sheet_readiness_contract_invalid',
);
await assert.rejects(
  ensureLayerSheetReady({
    readState: async () => null,
    openSheet: async () => {},
    revealContent: async () => {},
  }),
  error => error instanceof MemoryGateError && error.code === 'layer_sheet_readiness_contract_invalid',
);

let transientCarouselClock = 0;
let transientCarouselReads = 0;
const transientCarousel = { bounds: { left: 0, top: 100, right: 720, bottom: 400 } };
const reacquiredCarousel = await awaitLayerCarouselSnapshot({
  readSnapshot: async () => {
    transientCarouselReads += 1;
    return {
      nodes: [],
      carousel: transientCarouselClock >= 1_500 ? transientCarousel : null,
    };
  },
  waitFor: async durationMs => {
    transientCarouselClock += durationMs;
  },
  now: () => transientCarouselClock,
});
assert.equal(reacquiredCarousel.carousel, transientCarousel);
assert.equal(transientCarouselClock, 1_500);
assert.equal(transientCarouselReads, 4);

let missingCarouselClock = 0;
await assert.rejects(
  awaitLayerCarouselSnapshot({
    readSnapshot: async () => ({ nodes: [], carousel: null }),
    waitFor: async durationMs => {
      missingCarouselClock += durationMs;
    },
    now: () => missingCarouselClock,
  }),
  error => error instanceof MemoryGateError && error.code === 'layer_carousel_unavailable',
);
assert.equal(missingCarouselClock, LAYER_CAROUSEL_REACQUIRE_TIMEOUT_MS);
await assert.rejects(
  awaitLayerCarouselSnapshot({
    readSnapshot: async () => null,
    waitFor: async () => {},
    now: () => 0,
  }),
  error => error instanceof MemoryGateError && error.code === 'layer_carousel_reacquire_contract_invalid',
);

const harnessHashes = Object.fromEntries(
  MEMORY_GATE_HARNESS_REQUIRED_PATHS.map((path, index) => [path, String(index).repeat(64)]),
);
const validHarnessInput = {
  candidateGitSha: 'a'.repeat(40),
  harnessGitSha: 'b'.repeat(40),
  candidateAncestor: true,
  changedPaths: [
    'mobile/scripts/android-map-memory-gate.mjs',
    'docs/checkpoints/trailhead-1.0.10-active-checkpoint.md',
  ],
  trackedPaths: [...MEMORY_GATE_HARNESS_REQUIRED_PATHS],
  dirtyPaths: [],
  fileHashes: harnessHashes,
};
const harnessProvenance = validateMemoryGateHarnessProvenance(validHarnessInput);
assert.equal(harnessProvenance.candidate_is_ancestor, true);
assert.deepEqual(harnessProvenance.approved_candidate_delta, [
  'docs/checkpoints/trailhead-1.0.10-active-checkpoint.md',
  'mobile/scripts/android-map-memory-gate.mjs',
]);
assert.deepEqual(Object.keys(harnessProvenance.harness_file_sha256), MEMORY_GATE_HARNESS_REQUIRED_PATHS);
assert.throws(
  () => validateMemoryGateHarnessProvenance({
    ...validHarnessInput,
    changedPaths: [...validHarnessInput.changedPaths, 'mobile/app/(tabs)/map.tsx'],
  }),
  error => error instanceof MemoryGateError && error.code === 'harness_candidate_delta_unapproved',
);
assert.throws(
  () => validateMemoryGateHarnessProvenance({ ...validHarnessInput, dirtyPaths: ['harness_dirty'] }),
  error => error instanceof MemoryGateError && error.code === 'harness_worktree_dirty',
);
assert.throws(
  () => validateMemoryGateHarnessProvenance({
    ...validHarnessInput,
    trackedPaths: MEMORY_GATE_HARNESS_REQUIRED_PATHS.slice(1),
  }),
  error => error instanceof MemoryGateError && error.code === 'harness_file_untracked',
);
assert.throws(
  () => validateMemoryGateHarnessProvenance({
    ...validHarnessInput,
    fileHashes: { ...harnessHashes, [MEMORY_GATE_HARNESS_REQUIRED_PATHS[0]]: 'not-a-hash' },
  }),
  error => error instanceof MemoryGateError && error.code === 'harness_file_hash_unavailable',
);
assert.throws(
  () => validateMemoryGateHarnessProvenance({ ...validHarnessInput, candidateAncestor: false }),
  error => error instanceof MemoryGateError && error.code === 'candidate_not_ancestor_of_harness',
);
assert.equal(
  MEMORY_GATE_HARNESS_ALLOWED_CHANGED_PATHS.includes('dashboard/explore_serving_index_v2.json'),
  false,
  'the protected Explore index can never be part of the harness delta',
);

const privacyMemorySample = (totalPssKb, totalRssKb) => ({
  totalPssKb,
  totalSwapPssKb: 100_000,
  pssMinusSwapDiagnosticKb: totalPssKb - 100_000,
  totalRssKb,
  nativeHeapPssKb: 200_000,
  nativeHeapRssKb: 210_000,
  graphicsPssKb: 70_000,
  graphicsRssKb: 75_000,
  glMtrackPssKb: 65_000,
  glMtrackRssKb: 70_000,
  unknownPssKb: 80_000,
  unknownRssKb: 85_000,
  viewCount: 100,
  activityCount: 1,
  appContextCount: 5,
  webViewCount: 0,
});
const privacyObjectCountRatchet = evaluateObjectCountRatchetV3(
  Array.from({ length: 10 }, () => privacyMemorySample(700_000, 600_000)),
);
assert.equal(privacyObjectCountRatchet.complete, true);
assert.equal(privacyObjectCountRatchet.detected, false);
const privacyEvaluation = evaluateAndroidMemoryGateV3({
  exploreIdleSamples: [privacyMemorySample(400_000, 350_000)],
  mapIdleSamples: [privacyMemorySample(700_000, 600_000)],
  cycles: Array.from({ length: 10 }, () => ({
    heavyPeak: privacyMemorySample(900_000, 800_000),
    disabledRecovery: privacyMemorySample(700_000, 600_000),
  })),
  postMapRecoverySamples: [privacyMemorySample(700_000, 600_000)],
  exploreRecoverySamples: [privacyMemorySample(400_000, 350_000)],
  activeSamples: { navigation: [], preview3d: [], originals: [] },
  stability: {
    processAlive: true,
    exitEvidenceChecked: true,
    cancelled: false,
    layerStateRestored: true,
    objectCountRatchetDetected: false,
    lowMemoryKillCount: 0,
    oomCount: 0,
    anrCount: 0,
    processDeathCount: 0,
    duplicateRendererEvidenceComplete: true,
    duplicateRendererCount: 0,
    stateLossEvidenceComplete: true,
    stateLossCount: 0,
  },
});
assert.equal(privacyEvaluation.passed, true);
assert.equal(privacyEvaluation.m1Passed, true);
assert.equal(privacyEvaluation.activeExperienceEvidenceComplete, false);
assert.equal(privacyEvaluation.activeExperienceMemoryPassed, true);
assert.equal(privacyEvaluation.completeMemoryEvidencePassed, false);

const unevaluatedSafety = evaluateAndroidMemoryGateV3({
  exploreIdleSamples: [privacyMemorySample(400_000, 350_000)],
  mapIdleSamples: [privacyMemorySample(700_000, 600_000)],
  cycles: Array.from({ length: 10 }, () => ({
    heavyPeak: privacyMemorySample(900_000, 800_000),
    disabledRecovery: privacyMemorySample(700_000, 600_000),
  })),
  postMapRecoverySamples: [privacyMemorySample(700_000, 600_000)],
  exploreRecoverySamples: [privacyMemorySample(400_000, 350_000)],
  activeSamples: { navigation: [], preview3d: [], originals: [] },
  stability: {
    processAlive: true,
    exitEvidenceChecked: true,
    cancelled: false,
    layerStateRestored: true,
    objectCountRatchetDetected: false,
    lowMemoryKillCount: 0,
    oomCount: 0,
    anrCount: 0,
    processDeathCount: 0,
    duplicateRendererEvidenceComplete: false,
    duplicateRendererCount: 0,
    stateLossEvidenceComplete: false,
    stateLossCount: 0,
  },
});
assert.equal(unevaluatedSafety.passed, false);
assert.equal(unevaluatedSafety.stability.checks.duplicateRendererEvidenceComplete, false);
assert.equal(unevaluatedSafety.stability.checks.stateLossEvidenceComplete, false);

const privacyReportFixture = () => ({
  schema_version: 3,
  started_at: '2026-07-23T12:00:00.000Z',
  completed_at: '2026-07-23T12:20:00.000Z',
  candidate: {
    ota_source_git_sha: 'a'.repeat(40),
    harness_git_sha: 'b'.repeat(40),
    harness_provenance: {
      candidate_is_ancestor: true,
      approved_candidate_delta: ['mobile/scripts/android-map-memory-gate.mjs'],
      harness_file_sha256: harnessHashes,
    },
    binary_build_git_sha: 'c'.repeat(40),
    runtime: 'native-1.0.10-android.1',
    build_id: '06142308-0199-46cc-8a4c-fb9d45bca25e',
    update_id: '019f8e05-bad8-7925-8d46-54d2627b76b8',
    build_evidence_verified: true,
    device_identity_verified: true,
  },
  device: { role: 'stress_reference_4gb', android_sdk: 33, android_release_major: 13 },
  app: { package_name: 'com.trailhead.app', version_name: '1.0.10', version_code: '59' },
  safety: {
    exact_device_required: true,
    app_data_cleared: false,
    permissions_changed: false,
    active_navigation_or_tour: 'absent',
    duplicate_renderer_check_completed: true,
    duplicate_renderer_observed: false,
    layer_state_retention_check_completed: true,
    layer_state_loss_observed: false,
    raw_ui_or_logs_stored: false,
  },
  layers: {
    stress_keys: [...HEAVY_MAP_LAYER_KEYS],
    purpose: 'deterministic_memory_load',
    functional_regression_tested: false,
    initial: null,
    baseline: null,
    restored: true,
    recovery: null,
  },
  memory: {
    policy: ANDROID_MEMORY_GATE_V3_POLICY,
    device_role: 'stress_reference_4gb',
    explore_idle_settle_ms: 90_000,
    map_idle_settle_ms: 90_000,
    cycle_phase_settle_ms: 5_000,
    post_map_settle_ms: 90_000,
    explore_recovery_settle_ms: 90_000,
    sample_gap_ms: 3_000,
    cycle_count: 10,
    cycle_attempt_count: 0,
    explore_idle_samples: [],
    map_idle_samples: [],
    cycles: [],
    incomplete_cycles: [],
    partial_cycle: null,
    post_map_recovery_samples: [],
    explore_recovery_samples: [],
    active_samples: { navigation: [], preview3d: [], originals: [] },
    active_phase_status: {
      navigation: 'not_run_by_non_destructive_map_gate',
      preview3d: 'not_run_by_non_destructive_map_gate',
      originals: 'not_run_by_non_destructive_map_gate',
    },
    object_count_ratchet: privacyObjectCountRatchet,
    evaluation: privacyEvaluation,
  },
  process: {
    alive: true,
    instance_changed: false,
    foreground_proof_count: 42,
    foreground_proof_completed: true,
    terminal_identity_checked: true,
    exit_evidence_checked: true,
    exit_evidence: null,
    live_anr_evidence: {
      baseline_captured: true,
      observation_count: 8,
      new_anr_count: 0,
    },
  },
  result: 'passed',
  failure_code: null,
  execution_failure_codes: [],
  terminal_evidence_failure_code: null,
  restoration_failure_code: null,
  privacy: MEMORY_GATE_REPORT_PRIVACY_STATEMENT,
});
assert.equal(assertAndroidMemoryGateReportV3Privacy(privacyReportFixture()), true);
assert.throws(
  () => assertAndroidMemoryGateReportV3Privacy({
    ...privacyReportFixture(),
    memory: { ...privacyReportFixture().memory, search_text: 'Moab' },
  }),
  error => error instanceof MemoryGateError && error.code === 'report_privacy_invalid_memory_schema',
);
assert.throws(
  () => assertAndroidMemoryGateReportV3Privacy({
    ...privacyReportFixture(),
    device: { ...privacyReportFixture().device, model: 'personal phone' },
  }),
  error => error instanceof MemoryGateError && error.code === 'report_privacy_invalid_device_schema',
);
assert.throws(
  () => assertAndroidMemoryGateReportV3Privacy({
    ...privacyReportFixture(),
    privacy: 'user@example.com',
  }),
  error => error instanceof MemoryGateError && error.code === 'report_privacy_arbitrary_string',
);
assert.throws(
  () => assertAndroidMemoryGateReportV3Privacy({
    ...privacyReportFixture(),
    app: { ...privacyReportFixture().app, version_name: undefined },
  }),
  error => error instanceof MemoryGateError && error.code === 'report_privacy_invalid_value',
  'undefined must not disappear silently during JSON serialization',
);
assert.throws(
  () => assertAndroidMemoryGateReportV3Privacy({
    ...privacyReportFixture(),
    process: {
      ...privacyReportFixture().process,
      live_anr_evidence: {
        ...privacyReportFixture().process.live_anr_evidence,
        reason: 'raw Android ANR text must never be persisted',
      },
    },
  }),
  error => error instanceof MemoryGateError && error.code === 'report_privacy_invalid_live_anr_schema',
);

const atomicReportDirectory = mkdtempSync(join(tmpdir(), 'trailhead-memory-gate-v3-'));
try {
  const atomicReport = privacyReportFixture();
  const reportPath = writeAndroidMemoryGateReportV3Atomically(
    atomicReportDirectory,
    atomicReport,
  );
  assert.equal(reportPath, join(atomicReportDirectory, 'report.json'));
  assert.deepEqual(JSON.parse(readFileSync(reportPath, 'utf8')), atomicReport);
  assert.deepEqual(readdirSync(atomicReportDirectory), ['report.json']);

  writeFileSync(reportPath, 'previous-complete-report\n');
  assert.throws(
    () => writeAndroidMemoryGateReportV3Atomically(
      atomicReportDirectory,
      atomicReport,
      { renameSync: () => { throw new Error('simulated_rename_failure'); } },
    ),
    /simulated_rename_failure/,
  );
  assert.equal(
    readFileSync(reportPath, 'utf8'),
    'previous-complete-report\n',
    'a failed atomic rename cannot partially replace the last complete report',
  );
  assert.deepEqual(
    readdirSync(atomicReportDirectory),
    ['report.json'],
    'temporary evidence is removed after a failed atomic rename',
  );
} finally {
  rmSync(atomicReportDirectory, { recursive: true, force: true });
}

const swapHeavyExploreSample = {
  totalPssKb: 700_000,
  totalSwapPssKb: 400_000,
  pssMinusSwapDiagnosticKb: 300_000,
  totalRssKb: 500_000,
};
assert.doesNotThrow(() => assertPssAndRssPhaseSafety(
  [swapHeavyExploreSample],
  ANDROID_MEMORY_GATE_V3_POLICY.phaseBudgetsKb.activeExperience,
  'explore_idle',
), 'a phase-specific failure below the source-controlled safety cap must not stop leak diagnostics');
assert.throws(
  () => assertPssAndRssPhaseSafety(
    [{ ...swapHeavyExploreSample, totalPssKb: 1_375_001, pssMinusSwapDiagnosticKb: 975_001 }],
    ANDROID_MEMORY_GATE_V3_POLICY.phaseBudgetsKb.activeExperience,
    'explore_idle',
  ),
  error => error instanceof MemoryGateError && error.code === 'explore_idle_total_pss_safety_cap_failed',
);
assert.throws(
  () => assertPssAndRssPhaseSafety(
    [{ ...swapHeavyExploreSample, totalRssKb: 1_200_001 }],
    ANDROID_MEMORY_GATE_V3_POLICY.phaseBudgetsKb.activeExperience,
    'explore_idle',
  ),
  error => error instanceof MemoryGateError && error.code === 'explore_idle_rss_safety_cap_failed',
);

const memoryWindow = [
  { totalPssKb: 800_000, totalRssKb: 650_000 },
  { totalPssKb: 900_000, totalRssKb: 620_000 },
  { totalPssKb: 780_000, totalRssKb: 700_000 },
].map(sample => ({
  ...sample,
  totalSwapPssKb: 100_000,
  pssMinusSwapDiagnosticKb: sample.totalPssKb - 100_000,
}));
const divergentPeakSummary = summarizeMemoryWindow(
  memoryWindow,
  ANDROID_MEMORY_GATE_V3_POLICY.phaseBudgetsKb.heavyPeak,
  'peak',
);
assert.equal(divergentPeakSummary.totalPssKb, 900_000);
assert.equal(divergentPeakSummary.totalRssKb, 700_000);
assert.equal(divergentPeakSummary.totalSwapPssKb, 100_000);
assert.equal(divergentPeakSummary.pssMinusSwapDiagnosticKb, 800_000);
assert.equal(
  memoryWindow.find(sample => (
    sample.totalPssKb === divergentPeakSummary.totalPssKb
    && sample.totalRssKb === divergentPeakSummary.totalRssKb
  )),
  undefined,
  'divergent PSS and RSS peaks must not collapse to one composite-pressure sample',
);
const divergentValleySummary = summarizeMemoryWindow(
  memoryWindow,
  ANDROID_MEMORY_GATE_V3_POLICY.phaseBudgetsKb.mapIdle,
  'valley',
);
assert.equal(divergentValleySummary.totalPssKb, 780_000);
assert.equal(divergentValleySummary.totalRssKb, 620_000);
assert.equal(divergentValleySummary.pssMinusSwapDiagnosticKb, 680_000);
assert.throws(
  () => summarizeMemoryWindow(memoryWindow.slice(0, 2), ANDROID_MEMORY_GATE_V3_POLICY.phaseBudgetsKb.mapIdle, 'peak'),
  error => error instanceof MemoryGateError && error.code === 'memory_window_must_have_three_samples',
);

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

const uiNode = (resourceId, extra = '') => `<hierarchy><node resource-id="${resourceId}" content-desc="" checkable="false" checked="false" bounds="[0,0][100,100]" ${extra}/></hierarchy>`;
const uiNodes = resourceIds => parseUiNodes(
  `<hierarchy>${resourceIds.map((resourceId, index) => (
    `<node resource-id="${resourceId}" content-desc="" checkable="false" checked="false" bounds="[0,${index * 100}][100,${(index + 1) * 100}]"/>`
  )).join('')}</hierarchy>`,
);

const recognizedServices = `ACTIVITY MANAGER SERVICES (dumpsys activity services)
  User 0 active services:
  * ServiceRecord{42 u0 com.trailhead.app/com.mapbox.common.LifecycleService}
    packageName=com.trailhead.app`;
assert.deepEqual(inspectRecognizedActiveServiceDump(recognizedServices), { recognized: true });
assert.deepEqual(inspectRecognizedActiveServiceDump(
  'ACTIVITY MANAGER SERVICES (dumpsys activity services)\n  User 0 active services:',
), { recognized: true });
assert.deepEqual(inspectRecognizedActiveServiceDump(
  'ACTIVITY MANAGER SERVICES (dumpsys activity services)\n  (nothing)',
), { recognized: true }, 'the recognized no-active-services form is valid evidence');
assert.throws(
  () => inspectRecognizedActiveServiceDump(''),
  error => error instanceof MemoryGateError && error.code === 'active_service_dump_unrecognized',
);
assert.throws(
  () => inspectRecognizedActiveServiceDump(
    'ACTIVITY MANAGER SERVICES (dumpsys activity services)\n  User 0 active services:\n  * ServiceRecord{42 u0 com.other/.Service}',
  ),
  error => error instanceof MemoryGateError && error.code === 'active_service_dump_unrecognized',
);

const recognizedExitInfo = `ACTIVITY MANAGER PROCESS EXIT INFO (dumpsys activity exit-info)
Last Timestamp of Persistence Into Persistent Storage: 2026-07-23 04:23:20.181
  package: com.trailhead.app
    Historical Process Exit for uid=10303`;
assert.deepEqual(parseRecognizedExitInfoDump(recognizedExitInfo), []);
assert.deepEqual(parseRecognizedExitInfoDump(
  'ACTIVITY MANAGER PROCESS EXIT INFO (dumpsys activity exit-info)\nLast Timestamp of Persistence Into Persistent Storage: 2026-07-23 04:23:20.181',
), [], 'a recognized empty exit-history response is valid evidence');
assert.throws(
  () => parseRecognizedExitInfoDump(''),
  error => error instanceof MemoryGateError && error.code === 'exit_info_dump_unrecognized',
);
assert.throws(
  () => parseRecognizedExitInfoDump(recognizedExitInfo.replace('com.trailhead.app', 'com.other')),
  error => error instanceof MemoryGateError && error.code === 'exit_info_dump_unrecognized',
);

const lastAnrDump = (anrTime, reason, suffix = '') => `ACTIVITY MANAGER LAST ANR (dumpsys activity lastanr)
  ANR time: ${anrTime}
  Reason: ${reason}
${suffix}`;
const baselineLastAnr = parseRecognizedLastAnrDump(lastAnrDump(
  'Jul 22, 2026 8:30:00 AM',
  '1234 com.trailhead.app/com.trailhead.app.MainActivity is not responding. Waited 10010ms for MotionEvent',
  '  arbitrary metadata that must never be parsed',
));
assert.deepEqual(baselineLastAnr, {
  anrTime: 'Jul 22, 2026 8:30:00 AM',
  reason: '1234 com.trailhead.app/com.trailhead.app.MainActivity is not responding. Waited 10010ms for MotionEvent',
});
assert.equal(parseRecognizedLastAnrDump(
  'ACTIVITY MANAGER LAST ANR (dumpsys activity lastanr)\n  <no ANR has occurred since boot>',
), null);
assert.throws(
  () => parseRecognizedLastAnrDump(''),
  error => error instanceof MemoryGateError && error.code === 'last_anr_dump_unrecognized',
);
assert.throws(
  () => parseRecognizedLastAnrDump(
    'ACTIVITY MANAGER LAST ANR (dumpsys activity lastanr)\n  ANR time: Jul 23, 2026 9:41:44 AM',
  ),
  error => error instanceof MemoryGateError && error.code === 'last_anr_dump_unrecognized',
);
assert.deepEqual(
  parseRecognizedLastAnrDump(`${lastAnrDump(
    'Jul 23, 2026 9:41:44 AM',
    '88b6070 com.trailhead.app/com.trailhead.app.MainActivity is not responding',
  )}${'private-metadata\n'.repeat(10_000)}`),
  {
    anrTime: 'Jul 23, 2026 9:41:44 AM',
    reason: '88b6070 com.trailhead.app/com.trailhead.app.MainActivity is not responding',
  },
  'bounded parsing ignores the broad metadata tail',
);

const liveAnrMonitor = createLiveAnrMonitorV3({ baseline: baselineLastAnr });
assert.deepEqual(liveAnrMonitor.observe({ ...baselineLastAnr }), {
  baseline_captured: true,
  observation_count: 1,
  new_anr_count: 0,
  newAnrDetected: false,
}, 'the pre-launch baseline is not a new gate ANR');
assert.deepEqual(liveAnrMonitor.observe(parseRecognizedLastAnrDump(lastAnrDump(
  'Jul 23, 2026 9:40:00 AM',
  '7777 com.other/com.other.MainActivity is not responding',
))), {
  baseline_captured: true,
  observation_count: 2,
  new_anr_count: 0,
  newAnrDetected: false,
}, 'an unrelated app ANR does not fail Trailhead');
const newTrailheadAnr = parseRecognizedLastAnrDump(lastAnrDump(
  'Jul 23, 2026 9:41:44 AM',
  '88b6070 com.trailhead.app/com.trailhead.app.MainActivity is not responding. Waited 10010ms for MotionEvent',
));
assert.deepEqual(liveAnrMonitor.observe(newTrailheadAnr), {
  baseline_captured: true,
  observation_count: 3,
  new_anr_count: 1,
  newAnrDetected: true,
});
assert.deepEqual(liveAnrMonitor.observe(newTrailheadAnr), {
  baseline_captured: true,
  observation_count: 4,
  new_anr_count: 1,
  newAnrDetected: false,
}, 'terminal evidence does not double-count an ANR already found during foreground proof');

assert.deepEqual(inspectAwakePowerDump(
  'POWER MANAGER (dumpsys power)\nPower Manager State:\n  mWakefulness=Awake',
), { recognized: true, awake: true });
assert.throws(
  () => inspectAwakePowerDump('POWER MANAGER (dumpsys power)\n  mWakefulness=Asleep'),
  error => error instanceof MemoryGateError && error.code === 'device_not_awake',
);
assert.throws(
  () => inspectAwakePowerDump(''),
  error => error instanceof MemoryGateError && error.code === 'power_dump_unrecognized',
);

const foregroundActivities = `ACTIVITY MANAGER ACTIVITIES (dumpsys activity activities)
  * Task{abc A=10303:com.trailhead.app U=0 visible=true visibleRequested=true mode=fullscreen}
    topResumedActivity=ActivityRecord{def u0 com.trailhead.app/.MainActivity}`;
assert.deepEqual(inspectTopResumedVisibleActivityDump(foregroundActivities), {
  recognized: true,
  topResumed: true,
  visible: true,
});
assert.throws(
  () => inspectTopResumedVisibleActivityDump(foregroundActivities.replace('visible=true', 'visible=false')),
  error => error instanceof MemoryGateError && error.code === 'app_not_top_resumed_visible',
);
assert.throws(
  () => inspectTopResumedVisibleActivityDump(''),
  error => error instanceof MemoryGateError && error.code === 'activity_dump_unrecognized',
);

const foregroundProofEvents = [];
let foregroundProofCount = 0;
assert.equal(await waitWithContinuousProof({
  durationMs: 30_000,
  intervalMs: 10_000,
  prove: async () => {
    foregroundProofCount += 1;
    foregroundProofEvents.push(`prove:${foregroundProofCount}`);
  },
  waitFor: async durationMs => {
    foregroundProofEvents.push(`wait:${durationMs}`);
  },
}), 4);
assert.deepEqual(foregroundProofEvents, [
  'prove:1', 'wait:10000', 'prove:2', 'wait:10000', 'prove:3', 'wait:10000', 'prove:4',
]);
let failedProofCount = 0;
await assert.rejects(
  waitWithContinuousProof({
    durationMs: 30_000,
    intervalMs: 10_000,
    prove: async () => {
      failedProofCount += 1;
      if (failedProofCount === 2) throw new MemoryGateError('device_not_awake');
    },
    waitFor: async () => {},
  }),
  error => error instanceof MemoryGateError && error.code === 'device_not_awake',
);
assert.equal(failedProofCount, 2, 'a failed foreground proof aborts the settle immediately');

assert.equal(classifyActiveMapSession({ uiXml: uiNode('com.trailhead.app:id/map.navigation.end') }), 'active_navigation_ui');
assert.equal(classifyActiveMapSession({ uiXml: uiNode('originals.player.resume-pill') }), 'active_original_ui');
assert.equal(classifyActiveMapSession({ serviceDump: 'ServiceRecord{42 com.trailhead.app/.car.TrailheadCarLocationService}' }), 'active_navigation_service');
assert.equal(classifyActiveMapSession({ serviceDump: 'ServiceRecord{42 expo.modules.location.services.LocationTaskService}' }), 'active_original_service');
assert.equal(classifyActiveMapSession({ uiXml: uiNode('map.layers.open'), serviceDump: 'No services found' }), null);

assert.deepEqual(inspectMapRendererReadiness(uiNodes([
  'map.screen',
  'map.layers.open',
]), 'com.trailhead.app'), {
  ready: true,
  rootReady: true,
  rendererLoading: false,
  stableControlReady: true,
  rootCount: 1,
  stableControlCount: 1,
  duplicateRendererObserved: false,
});
assert.equal(inspectMapRendererReadiness(uiNodes([
  'map.screen',
  'map.renderer-loading',
  'map.layers.open',
]), 'com.trailhead.app').ready, false, 'a visible renderer-loading node blocks readiness');
assert.equal(inspectMapRendererReadiness(uiNodes([
  'map.screen',
]), 'com.trailhead.app').ready, false, 'map readiness requires a stable map control');
assert.equal(hasPositiveVisibleBounds({ bounds: { left: 0, top: 0, right: 100, bottom: 100 } }), true);
assert.equal(hasPositiveVisibleBounds({ bounds: { left: 0, top: 0, right: 0, bottom: 100 } }), false);
assert.equal(hasPositiveVisibleBounds({
  bounds: { left: 0, top: 0, right: 100, bottom: 100 },
  'visible-to-user': 'false',
}), false);
const duplicateMapNodes = parseUiNodes(`<hierarchy>
  <node resource-id="map.screen" bounds="[0,0][100,100]"/>
  <node resource-id="map.screen" bounds="[0,0][100,100]"/>
  <node resource-id="map.layers.open" bounds="[0,0][100,100]"/>
</hierarchy>`);
assert.equal(inspectMapRendererReadiness(
  duplicateMapNodes,
  'com.trailhead.app',
).duplicateRendererObserved, true);
const zeroBoundExplore = parseUiNodes(
  '<hierarchy><node resource-id="explore.screen" bounds="[0,0][0,100]"/></hierarchy>',
);
assert.equal(inspectRetainedTreeReadiness(
  zeroBoundExplore,
  'com.trailhead.app',
  'explore.screen',
).ready, false, 'retained-tree readiness requires positive visible bounds');

const openLayerSheetNodes = uiNodes([
  'map.layers.sheet',
  'map.layers.toggle-carousel',
  'map.layers.close',
]);
assert.equal(inspectLayerSheetCloseState(openLayerSheetNodes, 'com.trailhead.app').sheetOpen, true);
assert.throws(
  () => inspectLayerSheetCloseState(uiNodes([
    'map.layers.sheet',
    'map.layers.toggle-carousel',
  ]), 'com.trailhead.app'),
  error => error instanceof MemoryGateError && error.code === 'layer_close_unavailable',
  'an open sheet without its close control cannot be silently accepted',
);
assert.deepEqual(inspectLayerSheetCloseState(uiNodes([
  'map.layers.open',
]), 'com.trailhead.app'), { sheetOpen: false, closeNode: null });

const processIdentity = { alive: true, instanceChanged: false, internalProcessId: null };
assert.equal(recordAndVerifyProcessIdentity(processIdentity, 4242), true);
assert.equal(processIdentity.internalProcessId, 4242);
assert.equal(recordAndVerifyProcessIdentity(processIdentity, 4242), true);
assert.throws(
  () => recordAndVerifyProcessIdentity(processIdentity, 4343),
  error => error instanceof MemoryGateError && error.code === 'memory_process_instance_changed',
);
assert.equal(processIdentity.alive, false);
assert.equal(processIdentity.instanceChanged, true);
assert.throws(
  () => recordAndVerifyProcessIdentity({ alive: true, instanceChanged: false, internalProcessId: 4242 }, null),
  error => error instanceof MemoryGateError && error.code === 'memory_process_not_alive',
);

const newExitRecord = reason => ({
  timestampKeyMs: 1_792_640_000_000 + reason,
  reason,
  subreason: 0,
  status: 0,
  importance: 100,
  pssKb: 10,
  rssKb: 20,
});
for (const reason of [0, 1, 2, 10, 11, 12, 13, 14]) {
  const exitEvaluation = evaluateExitInfoDiffV3([], [newExitRecord(reason)]);
  assert.equal(exitEvaluation.passed, false, `new exit reason ${reason} must fail the gate`);
  assert.equal(exitEvaluation.newRecordCount, 1);
  assert.equal(exitEvaluation.processDeathCount, 1);
}

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

assert.equal(isContinuableLayerWorkloadFailureCode('layer_toggle_failed_ava'), true);
assert.equal(isContinuableLayerWorkloadFailureCode('layer_cycle_disable_not_confirmed_fire'), true);
assert.equal(isContinuableLayerWorkloadFailureCode('layer_selector_unavailable_radar'), true);
assert.equal(isContinuableLayerWorkloadFailureCode('layer_state_snapshot_incomplete_ava'), true);
assert.equal(isContinuableLayerWorkloadFailureCode('tap_failed'), false);
assert.equal(isContinuableLayerWorkloadFailureCode('process_instance_changed'), false);
assert.equal(isContinuableLayerWorkloadFailureCode('heavy_peak_total_pss_safety_cap_failed'), false);

const emptyLayerCycleMemory = () => ({
  cycle_attempt_count: 0,
  cycles: [],
  incomplete_cycles: [],
  partial_cycle: null,
});
const populateVerifiedHeavyPhase = async (cycle, attempt) => {
  attempt.heavyLayerStateVerified = true;
};
const populateHeavyMeasurement = async (cycle, attempt) => {
  attempt.heavyPeak = privacyMemorySample(900_000 + cycle, 800_000 + cycle);
  attempt.heavyPeakWindow = [attempt.heavyPeak];
};
const populateVerifiedDisabledPhase = async (cycle, attempt) => {
  attempt.disabledLayerStateVerified = true;
};
const populateDisabledMeasurement = async (cycle, attempt) => {
  attempt.disabledRecovery = privacyMemorySample(700_000 + cycle, 600_000 + cycle);
  attempt.disabledRecoveryWindow = [attempt.disabledRecovery];
};

const continuedCycleMemory = emptyLayerCycleMemory();
const continuedCycleEvents = [];
const continuedFailures = [];
const continuedSummary = await executeLayerDiagnosticCycles({
  cycleCount: MAP_LAYER_CYCLE_COUNT,
  memory: continuedCycleMemory,
  enableTransition: async (cycle, attempt) => {
    continuedCycleEvents.push(`enable:${cycle}`);
    await populateVerifiedHeavyPhase(cycle, attempt);
  },
  measureHeavyPeak: populateHeavyMeasurement,
  disableTransition: async (cycle, attempt) => {
    continuedCycleEvents.push(`disable:${cycle}`);
    if (cycle === 5) throw new MemoryGateError('layer_toggle_failed_ava');
    await populateVerifiedDisabledPhase(cycle, attempt);
  },
  measureDisabledRecovery: populateDisabledMeasurement,
  assertContinuationSafe: async ({ cycle, phase, failureCode }) => {
    continuedCycleEvents.push(`safe:${cycle}:${phase}:${failureCode}`);
  },
  recordWorkloadFailure: async failure => {
    continuedFailures.push(failure);
  },
  requirePostCycleBaseline: async () => {
    continuedCycleEvents.push('post-cycle-baseline');
  },
});
assert.deepEqual(continuedSummary, {
  attemptedCycleCount: 10,
  completedCycleCount: 9,
  incompleteCycleCount: 1,
});
assert.equal(continuedCycleMemory.cycle_attempt_count, 10);
assert.equal(continuedCycleMemory.cycles.length, 9);
assert.equal(continuedCycleMemory.incomplete_cycles.length, 1);
assert.equal(continuedCycleMemory.partial_cycle, null);
assert.equal(continuedCycleMemory.incomplete_cycles[0].cycle, 5);
assert.equal(continuedCycleMemory.incomplete_cycles[0].heavyLayerStateVerified, true);
assert.equal(continuedCycleMemory.incomplete_cycles[0].heavyPeak != null, true);
assert.equal(continuedCycleMemory.incomplete_cycles[0].disabledLayerStateVerified, false);
assert.equal(continuedCycleMemory.incomplete_cycles[0].disabledRecovery, null);
assert.equal(continuedCycleMemory.incomplete_cycles[0].enable_failure_code, null);
assert.equal(continuedCycleMemory.incomplete_cycles[0].disable_failure_code, 'layer_toggle_failed_ava');
assert.deepEqual(continuedFailures, [{
  cycle: 5,
  phase: 'disable',
  failureCode: 'layer_toggle_failed_ava',
}]);
assert.equal(
  continuedCycleEvents.filter(event => event === 'disable:5').length,
  1,
  'the failed transition is never blindly retried inside the same phase',
);
assert.equal(continuedCycleEvents.includes('enable:6'), true, 'diagnostics continue after a safe workload failure');
assert.equal(
  continuedCycleEvents.at(-1),
  'post-cycle-baseline',
  'the exact post-cycle baseline is required only after all ten attempts',
);
const incompleteCycleEvaluation = evaluateAndroidMemoryGateV3({
  exploreIdleSamples: [privacyMemorySample(400_000, 350_000)],
  mapIdleSamples: [privacyMemorySample(700_000, 600_000)],
  cycles: continuedCycleMemory.cycles,
  postMapRecoverySamples: [privacyMemorySample(700_000, 600_000)],
  exploreRecoverySamples: [privacyMemorySample(400_000, 350_000)],
  activeSamples: { navigation: [], preview3d: [], originals: [] },
  stability: {
    processAlive: true,
    exitEvidenceChecked: true,
    cancelled: false,
    layerStateRestored: true,
    objectCountRatchetDetected: false,
    lowMemoryKillCount: 0,
    oomCount: 0,
    anrCount: 0,
    processDeathCount: 0,
    duplicateRendererEvidenceComplete: true,
    duplicateRendererCount: 0,
    stateLossEvidenceComplete: true,
    stateLossCount: 0,
  },
});
assert.equal(incompleteCycleEvaluation.observedCycleCount, 9);
assert.equal(incompleteCycleEvaluation.cycleCountPassed, false);
assert.equal(incompleteCycleEvaluation.m1Passed, false, 'an incomplete workload cycle can never pass M1');

const mixedFailureMemory = emptyLayerCycleMemory();
const mixedFailureEvents = [];
const mixedFailures = [];
await executeLayerDiagnosticCycles({
  cycleCount: 3,
  memory: mixedFailureMemory,
  enableTransition: async (cycle, attempt) => {
    mixedFailureEvents.push(`enable:${cycle}`);
    if (cycle === 1) throw new MemoryGateError('layer_toggle_failed_fire');
    await populateVerifiedHeavyPhase(cycle, attempt);
  },
  measureHeavyPeak: async (cycle, attempt) => {
    mixedFailureEvents.push(`heavy:${cycle}`);
    await populateHeavyMeasurement(cycle, attempt);
  },
  disableTransition: async (cycle, attempt) => {
    mixedFailureEvents.push(`disable:${cycle}`);
    if (cycle === 2) throw new MemoryGateError('layer_toggle_failed_ava');
    await populateVerifiedDisabledPhase(cycle, attempt);
  },
  measureDisabledRecovery: async (cycle, attempt) => {
    mixedFailureEvents.push(`valley:${cycle}`);
    await populateDisabledMeasurement(cycle, attempt);
  },
  assertContinuationSafe: async ({ cycle, phase }) => {
    mixedFailureEvents.push(`safe:${cycle}:${phase}`);
  },
  recordWorkloadFailure: async failure => { mixedFailures.push(failure); },
  requirePostCycleBaseline: async () => { mixedFailureEvents.push('post-cycle-baseline'); },
});
assert.equal(mixedFailureMemory.cycle_attempt_count, 3);
assert.equal(mixedFailureMemory.cycles.length, 1);
assert.equal(mixedFailureMemory.incomplete_cycles.length, 2);
const enableFailureAttempt = mixedFailureMemory.incomplete_cycles[0];
assert.equal(enableFailureAttempt.cycle, 1);
assert.equal(enableFailureAttempt.enable_failure_code, 'layer_toggle_failed_fire');
assert.equal(enableFailureAttempt.heavyPeak, null, 'a failed enable phase cannot produce a heavy sample');
assert.equal(enableFailureAttempt.disabledLayerStateVerified, true);
assert.equal(enableFailureAttempt.disabledRecovery != null, true, 'disable still reaches a measured safe valley');
assert.equal(mixedFailureEvents.filter(event => event === 'enable:1').length, 1, 'enable is not blindly retapped');
assert.equal(mixedFailureEvents.filter(event => event === 'disable:1').length, 1, 'disable runs once after enable failure');
assert.deepEqual(
  mixedFailures.map(failure => `${failure.cycle}:${failure.phase}:${failure.failureCode}`),
  ['1:enable:layer_toggle_failed_fire', '2:disable:layer_toggle_failed_ava'],
  'multiple recoverable phase failures retain their diagnostic order',
);

const incompletePrivacyReport = privacyReportFixture();
incompletePrivacyReport.result = 'failed';
incompletePrivacyReport.failure_code = 'layer_toggle_failed_ava';
incompletePrivacyReport.memory.cycle_attempt_count = 10;
incompletePrivacyReport.memory.cycles = continuedCycleMemory.cycles;
incompletePrivacyReport.memory.incomplete_cycles = continuedCycleMemory.incomplete_cycles;
assert.equal(assertAndroidMemoryGateReportV3Privacy(incompletePrivacyReport), true);

for (const fatalContinuationCode of [
  'layer_workload_continuation_total_pss_safety_cap_failed',
  'process_instance_changed',
  'app_not_top_resumed_visible',
]) {
  const fatalMemory = emptyLayerCycleMemory();
  let recordedAfterFatalProof = false;
  let postBaselineReached = false;
  await assert.rejects(
    executeLayerDiagnosticCycles({
      cycleCount: MAP_LAYER_CYCLE_COUNT,
      memory: fatalMemory,
      enableTransition: populateVerifiedHeavyPhase,
      measureHeavyPeak: populateHeavyMeasurement,
      disableTransition: async (cycle, attempt) => {
        if (cycle === 2) throw new MemoryGateError('layer_toggle_failed_ava');
        await populateVerifiedDisabledPhase(cycle, attempt);
      },
      measureDisabledRecovery: populateDisabledMeasurement,
      assertContinuationSafe: async () => {
        throw new MemoryGateError(fatalContinuationCode);
      },
      recordWorkloadFailure: async () => { recordedAfterFatalProof = true; },
      requirePostCycleBaseline: async () => { postBaselineReached = true; },
    }),
    error => error instanceof MemoryGateError && error.code === fatalContinuationCode,
  );
  assert.equal(fatalMemory.cycle_attempt_count, 2);
  assert.equal(fatalMemory.cycles.length, 1);
  assert.equal(fatalMemory.incomplete_cycles.length, 0);
  assert.equal(fatalMemory.partial_cycle.disable_failure_code, 'layer_toggle_failed_ava');
  assert.equal(recordedAfterFatalProof, false, 'a fatal continuation proof is never downgraded to workload failure');
  assert.equal(postBaselineReached, false);
}

for (const immediateFailureCode of ['cancelled', 'tap_failed']) {
  const immediateMemory = emptyLayerCycleMemory();
  let continuationProofCalled = false;
  await assert.rejects(
    executeLayerDiagnosticCycles({
      cycleCount: MAP_LAYER_CYCLE_COUNT,
      memory: immediateMemory,
      enableTransition: async () => { throw new MemoryGateError(immediateFailureCode); },
      measureHeavyPeak: populateHeavyMeasurement,
      disableTransition: populateVerifiedDisabledPhase,
      measureDisabledRecovery: populateDisabledMeasurement,
      assertContinuationSafe: async () => { continuationProofCalled = true; },
      recordWorkloadFailure: async () => {},
      requirePostCycleBaseline: async () => {},
    }),
    error => error instanceof MemoryGateError && error.code === immediateFailureCode,
  );
  assert.equal(immediateMemory.cycle_attempt_count, 1);
  assert.equal(continuationProofCalled, false, `${immediateFailureCode} must abort before continuation proof`);
}

const postBaselineFailureMemory = emptyLayerCycleMemory();
await assert.rejects(
  executeLayerDiagnosticCycles({
    cycleCount: MAP_LAYER_CYCLE_COUNT,
    memory: postBaselineFailureMemory,
    enableTransition: populateVerifiedHeavyPhase,
    measureHeavyPeak: populateHeavyMeasurement,
    disableTransition: populateVerifiedDisabledPhase,
    measureDisabledRecovery: populateDisabledMeasurement,
    assertContinuationSafe: async () => {},
    recordWorkloadFailure: async () => {},
    requirePostCycleBaseline: async () => {
      throw new MemoryGateError('layer_post_cycle_baseline_not_confirmed_ava');
    },
  }),
  error => error instanceof MemoryGateError && error.code === 'layer_post_cycle_baseline_not_confirmed_ava',
);
assert.equal(postBaselineFailureMemory.cycle_attempt_count, 10);
assert.equal(postBaselineFailureMemory.cycles.length, 10);
assert.equal(postBaselineFailureMemory.partial_cycle, null);

const originalLayerStates = Object.fromEntries(
  HEAVY_MAP_LAYER_KEYS.map((key, index) => [key, index % 2 === 0]),
);
const disabledLayerStates = Object.fromEntries(
  HEAVY_MAP_LAYER_KEYS.map(key => [key, false]),
);
assert.deepEqual(
  assertExactLayerState({ ...originalLayerStates }, originalLayerStates, 'layer_state_mismatch'),
  originalLayerStates,
);
assert.throws(
  () => assertExactLayerState(
    { ...originalLayerStates, fire: !originalLayerStates.fire },
    originalLayerStates,
    'layer_state_mismatch',
  ),
  error => error instanceof MemoryGateError && error.code === 'layer_state_mismatch_fire',
  'restoration and cycle verification must compare one capture against the target state',
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

const restoredPrivacyReport = privacyReportFixture();
restoredPrivacyReport.layers.recovery = durableRestoration.recovery;
assert.equal(
  assertAndroidMemoryGateReportV3Privacy(restoredPrivacyReport),
  true,
  'the exact successful restoration payload written by the runner must satisfy the full report schema',
);

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

const unavailableRetentionReport = {
  result: 'failed',
  failure_code: 'memory_gate_v3_failed',
  restoration_failure_code: null,
  safety: {
    layer_state_retention_check_completed: false,
    layer_state_loss_observed: null,
  },
  layers: { restored: false, recovery: null },
};
applyLayerRestorationOutcome(unavailableRetentionReport, unsafeRetryGuard);
assert.equal(unavailableRetentionReport.safety.layer_state_retention_check_completed, false);
assert.equal(
  unavailableRetentionReport.safety.layer_state_loss_observed,
  null,
  'an unavailable retained-state check must remain unevaluated, never fabricated as false',
);

const primaryFailureReport = {
  result: 'failed',
  failure_code: 'explore_idle_total_pss_safety_cap_failed',
  restoration_failure_code: null,
  safety: {
    layer_state_retention_check_completed: false,
    layer_state_loss_observed: null,
  },
  layers: { restored: false, recovery: null },
};
applyLayerRestorationOutcome(primaryFailureReport, failedDurableRestoration);
assert.equal(primaryFailureReport.failure_code, 'explore_idle_total_pss_safety_cap_failed');
assert.equal(primaryFailureReport.restoration_failure_code, 'layer_restore_persisted_mismatch_fire');
assert.deepEqual(primaryFailureReport.layers.recovery, failedDurableRestoration.recovery);
assert.equal(primaryFailureReport.safety.layer_state_retention_check_completed, true);
assert.equal(primaryFailureReport.safety.layer_state_loss_observed, true);

const restorationOnlyFailureReport = {
  result: 'passed',
  failure_code: null,
  restoration_failure_code: null,
  safety: {
    layer_state_retention_check_completed: false,
    layer_state_loss_observed: null,
  },
  layers: { restored: false, recovery: null },
};
applyLayerRestorationOutcome(restorationOnlyFailureReport, failedDurableRestoration);
assert.equal(restorationOnlyFailureReport.result, 'failed');
assert.equal(restorationOnlyFailureReport.failure_code, null, 'restoration must not fabricate a primary gate failure');
assert.equal(restorationOnlyFailureReport.restoration_failure_code, 'layer_restore_persisted_mismatch_fire');

const lifecycleReport = () => ({
  result: 'running',
  failure_code: null,
  execution_failure_codes: [],
  terminal_evidence_failure_code: null,
  restoration_failure_code: null,
  completed_at: null,
  safety: {
    duplicate_renderer_check_completed: false,
    duplicate_renderer_observed: null,
    layer_state_retention_check_completed: false,
    layer_state_loss_observed: null,
  },
  layers: {
    initial: null,
    baseline: null,
    restored: false,
    recovery: null,
  },
  memory: {
    explore_idle_samples: [],
  },
});

// End-to-end failure-path regression: an enable transition can fail in a
// recoverable way without turning that attempt into a valid heavy-layer
// sample. The runner must still disable the layers, finish all ten diagnostic
// attempts, and execute the lifecycle restoration in finally.
const recoverableEnableFailureReport = lifecycleReport();
recoverableEnableFailureReport.memory = emptyLayerCycleMemory();
const recoverableEnableFailureEvents = [];
const recoverableEnableFailures = [];
let recoverableEnableInitialStates = null;
let recoverableEnableEvaluation = null;
const completedRecoverableEnableFailure = await executeMemoryGateLifecycle({
  report: recoverableEnableFailureReport,
  executeGate: async () => {
    recoverableEnableInitialStates = { ...originalLayerStates };
    recoverableEnableFailureReport.layers.initial = recoverableEnableInitialStates;
    recoverableEnableFailureReport.layers.baseline = { ...disabledLayerStates };
    await executeLayerDiagnosticCycles({
      cycleCount: MAP_LAYER_CYCLE_COUNT,
      memory: recoverableEnableFailureReport.memory,
      enableTransition: async (cycle, attempt) => {
        recoverableEnableFailureEvents.push(`enable:${cycle}`);
        if (cycle === 4) throw new MemoryGateError('layer_toggle_failed_fire');
        await populateVerifiedHeavyPhase(cycle, attempt);
      },
      measureHeavyPeak: async (cycle, attempt) => {
        recoverableEnableFailureEvents.push(`heavy:${cycle}`);
        await populateHeavyMeasurement(cycle, attempt);
      },
      disableTransition: async (cycle, attempt) => {
        recoverableEnableFailureEvents.push(`disable:${cycle}`);
        await populateVerifiedDisabledPhase(cycle, attempt);
      },
      measureDisabledRecovery: async (cycle, attempt) => {
        recoverableEnableFailureEvents.push(`valley:${cycle}`);
        await populateDisabledMeasurement(cycle, attempt);
      },
      assertContinuationSafe: async ({ cycle, phase }) => {
        recoverableEnableFailureEvents.push(`safe:${cycle}:${phase}`);
      },
      recordWorkloadFailure: async failure => {
        recoverableEnableFailures.push(failure);
        recoverableEnableFailureReport.result = 'failed';
        recoverableEnableFailureReport.failure_code ??= failure.failureCode;
      },
      requirePostCycleBaseline: async () => {
        recoverableEnableFailureEvents.push('post-cycle-baseline');
      },
    });
  },
  getInitialStates: () => recoverableEnableInitialStates,
  collectTerminalEvidence: async () => {
    recoverableEnableFailureEvents.push('terminal');
  },
  restoreLayers: async states => {
    recoverableEnableFailureEvents.push('restore');
    assert.deepEqual(states, originalLayerStates);
    return durableRestoration;
  },
  finalizeReport: async finalizedReport => {
    recoverableEnableFailureEvents.push('finalize');
    recoverableEnableEvaluation = evaluateAndroidMemoryGateV3({
      exploreIdleSamples: [privacyMemorySample(400_000, 350_000)],
      mapIdleSamples: [privacyMemorySample(700_000, 600_000)],
      cycles: finalizedReport.memory.cycles,
      postMapRecoverySamples: [privacyMemorySample(700_000, 600_000)],
      exploreRecoverySamples: [privacyMemorySample(400_000, 350_000)],
      activeSamples: { navigation: [], preview3d: [], originals: [] },
      stability: {
        processAlive: true,
        exitEvidenceChecked: true,
        cancelled: false,
        layerStateRestored: finalizedReport.layers.restored,
        objectCountRatchetDetected: false,
        lowMemoryKillCount: 0,
        oomCount: 0,
        anrCount: 0,
        processDeathCount: 0,
        duplicateRendererEvidenceComplete: true,
        duplicateRendererCount: 0,
        stateLossEvidenceComplete: true,
        stateLossCount: 0,
      },
    });
  },
  completedAt: () => '2026-07-23T00:00:00.000Z',
});
assert.equal(recoverableEnableFailureEvents.includes('heavy:4'), false, 'failed enable skips heavy sampling');
assert.equal(recoverableEnableFailureEvents.includes('disable:4'), true, 'disable still runs after enable failure');
assert.equal(recoverableEnableFailureEvents.includes('valley:4'), true, 'the recovered disabled state remains measurable');
assert.equal(recoverableEnableFailureEvents.indexOf('terminal') < recoverableEnableFailureEvents.indexOf('restore'), true);
assert.equal(recoverableEnableFailureEvents.at(-1), 'finalize');
assert.deepEqual(recoverableEnableFailures, [{
  cycle: 4,
  phase: 'enable',
  failureCode: 'layer_toggle_failed_fire',
}]);
assert.equal(completedRecoverableEnableFailure.memory.cycle_attempt_count, MAP_LAYER_CYCLE_COUNT);
assert.equal(completedRecoverableEnableFailure.memory.cycles.length, MAP_LAYER_CYCLE_COUNT - 1);
assert.equal(completedRecoverableEnableFailure.memory.incomplete_cycles.length, 1);
assert.equal(completedRecoverableEnableFailure.memory.incomplete_cycles[0].cycle, 4);
assert.equal(completedRecoverableEnableFailure.memory.incomplete_cycles[0].heavyPeak, null);
assert.equal(completedRecoverableEnableFailure.memory.incomplete_cycles[0].disabledLayerStateVerified, true);
assert.equal(completedRecoverableEnableFailure.memory.incomplete_cycles[0].disabledRecovery != null, true);
assert.equal(recoverableEnableEvaluation.observedCycleCount, MAP_LAYER_CYCLE_COUNT - 1);
assert.equal(recoverableEnableEvaluation.cycleCountPassed, false);
assert.equal(recoverableEnableEvaluation.m1Passed, false, 'the incomplete attempt cannot count toward ten valid cycles');
assert.equal(completedRecoverableEnableFailure.result, 'failed');
assert.equal(completedRecoverableEnableFailure.failure_code, 'layer_toggle_failed_fire');
assert.equal(completedRecoverableEnableFailure.layers.restored, true, 'lifecycle restoration still completes');

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
    throw new MemoryGateError('explore_idle_total_pss_safety_cap_failed');
  },
  getInitialStates: () => baselineInitialStates,
  collectTerminalEvidence: async () => {
    baselineFailureEvents.push('terminal');
  },
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
assert.deepEqual(baselineFailureEvents, ['execute', 'terminal', 'restore', 'finalize']);
assert.equal(completedBaselineFailure.result, 'failed');
assert.equal(completedBaselineFailure.failure_code, 'explore_idle_total_pss_safety_cap_failed');
assert.equal(completedBaselineFailure.layers.restored, true);
assert.equal(completedBaselineFailure.restoration_failure_code, null);
assert.equal(completedBaselineFailure.safety.layer_state_retention_check_completed, true);
assert.equal(completedBaselineFailure.safety.layer_state_loss_observed, false);
assert.equal(completedBaselineFailure.completed_at, '2026-07-23T00:00:00.000Z');
assert.deepEqual(finalizedBaselineFailure, completedBaselineFailure);

const firstFailureReport = lifecycleReport();
firstFailureReport.failure_code = 'layer_toggle_failed_ava';
await executeMemoryGateLifecycle({
  report: firstFailureReport,
  executeGate: async () => {
    throw new MemoryGateError('layer_post_cycle_baseline_not_confirmed_ava');
  },
  getInitialStates: () => null,
  collectTerminalEvidence: async () => {},
  restoreLayers: async () => { throw new Error('restoration must not run without a snapshot'); },
  finalizeReport: async () => {},
});
assert.equal(
  firstFailureReport.failure_code,
  'layer_toggle_failed_ava',
  'a later post-cycle failure cannot overwrite the first root workload failure',
);
assert.deepEqual(
  firstFailureReport.execution_failure_codes,
  ['layer_post_cycle_baseline_not_confirmed_ava'],
  'a later fatal execution failure remains visible without replacing the root cause',
);

const dualFailureReport = lifecycleReport();
let dualFailureInitialStates = null;
let finalizedDualFailure = null;
const completedDualFailure = await executeMemoryGateLifecycle({
  report: dualFailureReport,
  executeGate: async () => {
    dualFailureInitialStates = { ...originalLayerStates };
    throw new MemoryGateError('explore_idle_total_pss_safety_cap_failed');
  },
  getInitialStates: () => dualFailureInitialStates,
  collectTerminalEvidence: async () => {
    throw new MemoryGateError('process_exit_evidence_failed');
  },
  restoreLayers: async () => failedDurableRestoration,
  finalizeReport: async report => {
    finalizedDualFailure = JSON.parse(JSON.stringify(report));
  },
  completedAt: () => '2026-07-23T00:00:01.000Z',
});
assert.equal(completedDualFailure.result, 'failed');
assert.equal(completedDualFailure.failure_code, 'explore_idle_total_pss_safety_cap_failed');
assert.equal(completedDualFailure.terminal_evidence_failure_code, 'process_exit_evidence_failed');
assert.equal(completedDualFailure.restoration_failure_code, 'layer_restore_persisted_mismatch_fire');
assert.equal(completedDualFailure.layers.restored, false);
assert.equal(completedDualFailure.layers.recovery.attempt_count, FINAL_LAYER_REPAIR_MAX_ATTEMPTS);
assert.deepEqual(finalizedDualFailure, completedDualFailure, 'the finalized report retains both independent failures');

const cancellationEvents = [];
const cancellationReport = lifecycleReport();
let cancellationInitialStates = null;
await executeMemoryGateLifecycle({
  report: cancellationReport,
  executeGate: async () => {
    cancellationEvents.push('execute');
    cancellationInitialStates = { ...originalLayerStates };
    throw new MemoryGateError('cancelled');
  },
  getInitialStates: () => cancellationInitialStates,
  collectTerminalEvidence: async () => {
    cancellationEvents.push('terminal');
  },
  restoreLayers: async () => {
    cancellationEvents.push('restore');
    return durableRestoration;
  },
  finalizeReport: async () => {
    cancellationEvents.push('finalize');
  },
});
assert.deepEqual(
  cancellationEvents,
  ['execute', 'terminal', 'restore', 'finalize'],
  'cancellation still collects terminal evidence before restoring and finalizing',
);
assert.equal(cancellationReport.failure_code, 'cancelled');
assert.equal(cancellationReport.layers.restored, true);

const cancellationLiveAnrEvents = [];
const cancellationLiveAnrReport = lifecycleReport();
cancellationLiveAnrReport.process = {
  live_anr_evidence: {
    baseline_captured: true,
    observation_count: 0,
    new_anr_count: 0,
  },
};
const cancellationLiveAnrMonitor = createLiveAnrMonitorV3({ baseline: null });
await executeMemoryGateLifecycle({
  report: cancellationLiveAnrReport,
  executeGate: async () => {
    cancellationLiveAnrEvents.push('execute');
    throw new MemoryGateError('cancelled');
  },
  getInitialStates: () => null,
  collectTerminalEvidence: async () => {
    cancellationLiveAnrEvents.push('terminal');
    const observation = cancellationLiveAnrMonitor.observe(newTrailheadAnr);
    cancellationLiveAnrReport.process.live_anr_evidence = {
      baseline_captured: observation.baseline_captured,
      observation_count: observation.observation_count,
      new_anr_count: observation.new_anr_count,
    };
    if (observation.new_anr_count > 0) {
      throw new MemoryGateError('live_process_anr_observed');
    }
  },
  restoreLayers: async () => { throw new Error('restoration must not run'); },
  finalizeReport: async report => {
    cancellationLiveAnrEvents.push('finalize');
    promoteLiveAnrFailureV3(report);
  },
});
assert.deepEqual(cancellationLiveAnrEvents, ['execute', 'terminal', 'finalize']);
assert.equal(cancellationLiveAnrReport.result, 'failed');
assert.equal(cancellationLiveAnrReport.failure_code, 'live_process_anr_observed');
assert.deepEqual(cancellationLiveAnrReport.execution_failure_codes, ['cancelled']);
assert.equal(cancellationLiveAnrReport.terminal_evidence_failure_code, 'live_process_anr_observed');
assert.equal(cancellationLiveAnrReport.process.live_anr_evidence.new_anr_count, 1);
assert.equal(combineAnrCountV3(0, 1), 1);
const liveAnrStability = evaluateAndroidMemoryGateV3({
  exploreIdleSamples: [privacyMemorySample(400_000, 350_000)],
  mapIdleSamples: [privacyMemorySample(700_000, 600_000)],
  cycles: Array.from({ length: 10 }, () => ({
    heavyPeak: privacyMemorySample(900_000, 800_000),
    disabledRecovery: privacyMemorySample(700_000, 600_000),
  })),
  postMapRecoverySamples: [privacyMemorySample(700_000, 600_000)],
  exploreRecoverySamples: [privacyMemorySample(400_000, 350_000)],
  activeSamples: { navigation: [], preview3d: [], originals: [] },
  stability: {
    processAlive: true,
    exitEvidenceChecked: true,
    cancelled: false,
    layerStateRestored: true,
    objectCountRatchetDetected: false,
    lowMemoryKillCount: 0,
    oomCount: 0,
    anrCount: combineAnrCountV3(0, 1),
    processDeathCount: 0,
    duplicateRendererEvidenceComplete: true,
    duplicateRendererCount: 0,
    stateLossEvidenceComplete: true,
    stateLossCount: 0,
  },
});
assert.equal(liveAnrStability.stability.anrCount, 1);
assert.equal(liveAnrStability.stability.checks.noAnr, false);
assert.equal(liveAnrStability.passed, false, 'a surviving live-process ANR cannot report stable');

assert.equal(assertSafeMemoryGateAdbArgs(['devices', '-l']), true);
const remoteUi = '/sdcard/trailhead-memory-gate-123-456.xml';
const allowedDeviceCommands = [
  ['shell', 'getprop', 'ro.product.model'],
  ['shell', 'dumpsys', 'power'],
  ['shell', 'dumpsys', 'package', 'com.trailhead.app'],
  ['shell', 'dumpsys', 'meminfo', 'com.trailhead.app'],
  ['shell', 'dumpsys', 'activity', 'services', 'com.trailhead.app'],
  ['shell', 'dumpsys', 'activity', 'exit-info', 'com.trailhead.app'],
  ['shell', 'dumpsys', 'activity', 'lastanr'],
  ['shell', 'dumpsys', 'activity', 'activities', 'com.trailhead.app'],
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
  () => assertSafeMemoryGateAdbArgs(['-s', 'RFCR408DA9B', 'shell', 'dumpsys', 'activity', 'activities']),
  error => error instanceof MemoryGateError && error.code === 'unsafe_adb_command',
  'foreground checks must remain package-scoped',
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
