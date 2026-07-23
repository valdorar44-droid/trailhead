#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  ANDROID_MEMORY_GATE_V3_FAILURE_EXIT_REASONS,
  ANDROID_MEMORY_GATE_V3_POLICY,
  AndroidMemoryGateV3Error,
  assertMemoryGateV3NumericValues,
  assertMemoryGateV3ReportPrivacy,
  diffExitInfoV3,
  evaluateAndroidMemoryGateV3,
  evaluateExitInfoDiffV3,
  evaluateObjectCountRatchetV3,
  evaluatePhaseBudgetV3,
  linearSlopeV3,
  medianV3,
  parseAndroidMeminfoV3,
  parseExitInfoV3,
} from './android-memory-gate-v3.mjs';

const sample = (totalPssKb, pssMinusSwapDiagnosticKb, totalRssKb, extra = {}) => ({
  totalPssKb,
  totalSwapPssKb: totalPssKb - pssMinusSwapDiagnosticKb,
  pssMinusSwapDiagnosticKb,
  totalRssKb,
  nativeHeapPssKb: extra.nativeHeapPssKb ?? 250_000,
  nativeHeapRssKb: extra.nativeHeapRssKb ?? 260_000,
  graphicsPssKb: extra.graphicsPssKb ?? 80_000,
  graphicsRssKb: extra.graphicsRssKb ?? 80_000,
  glMtrackPssKb: extra.glMtrackPssKb ?? 80_000,
  glMtrackRssKb: extra.glMtrackRssKb ?? 80_000,
  unknownPssKb: extra.unknownPssKb ?? 100_000,
  unknownRssKb: extra.unknownRssKb ?? 110_000,
  viewCount: extra.viewCount ?? 100,
  activityCount: extra.activityCount ?? 1,
  appContextCount: extra.appContextCount ?? 5,
  webViewCount: extra.webViewCount ?? 0,
});

const stableEvidence = (overrides = {}) => ({
  processAlive: true,
  exitEvidenceChecked: true,
  cancelled: false,
  layerStateRestored: true,
  objectCountRatchetDetected: false,
  duplicateRendererEvidenceComplete: true,
  stateLossEvidenceComplete: true,
  lowMemoryKillCount: 0,
  oomCount: 0,
  anrCount: 0,
  processDeathCount: 0,
  duplicateRendererCount: 0,
  stateLossCount: 0,
  ...overrides,
});

const makePassingInput = () => ({
  exploreIdleSamples: [
    sample(498_000, 318_000, 448_000),
    sample(500_000, 320_000, 450_000),
    sample(502_000, 322_000, 452_000),
  ],
  mapIdleSamples: [
    sample(798_000, 518_000, 698_000),
    sample(800_000, 520_000, 700_000),
    sample(802_000, 522_000, 702_000),
  ],
  cycles: Array.from({ length: 10 }, (_, index) => ({
    heavyPeak: sample(1_000_000 + index * 3_000, 700_000 + index * 2_000, 900_000 + index * 2_000),
    disabledRecovery: sample(820_000 + index * 2_000, 530_000 + index * 1_000, 710_000 + index * 1_000),
  })),
  postMapRecoverySamples: [
    sample(833_000, 538_000, 718_000),
    sample(835_000, 540_000, 720_000),
    sample(837_000, 542_000, 722_000),
  ],
  exploreRecoverySamples: [
    sample(518_000, 328_000, 468_000),
    sample(520_000, 330_000, 470_000),
    sample(522_000, 332_000, 472_000),
  ],
  activeSamples: {
    navigation: [sample(1_300_000, 950_000, 1_150_000)],
    preview3d: [],
    originals: [],
  },
  stability: stableEvidence(),
});

assert.equal(ANDROID_MEMORY_GATE_V3_POLICY.reportVersion, 3);
assert.equal(ANDROID_MEMORY_GATE_V3_POLICY.requiredCycleCount, 10);
assert.deepEqual(ANDROID_MEMORY_GATE_V3_POLICY.phaseBudgetsKb.exploreIdle, {
  maxTotalPssKb: 650_000,
  referencePssMinusSwapDiagnosticKb: 400_000,
  maxTotalRssKb: 550_000,
});
assert.deepEqual(ANDROID_MEMORY_GATE_V3_POLICY.phaseBudgetsKb.mapIdle, {
  maxTotalPssKb: 975_000,
  referencePssMinusSwapDiagnosticKb: 625_000,
  maxTotalRssKb: 775_000,
});
assert.deepEqual(ANDROID_MEMORY_GATE_V3_POLICY.phaseBudgetsKb.heavyPeak, {
  maxTotalPssKb: 1_275_000,
  referencePssMinusSwapDiagnosticKb: 900_000,
  maxTotalRssKb: 1_100_000,
});
assert.deepEqual(ANDROID_MEMORY_GATE_V3_POLICY.phaseBudgetsKb.activeExperience, {
  maxTotalPssKb: 1_375_000,
  referencePssMinusSwapDiagnosticKb: 1_000_000,
  maxTotalRssKb: 1_200_000,
});
assert.ok(Object.isFrozen(ANDROID_MEMORY_GATE_V3_POLICY));
assert.ok(Object.isFrozen(ANDROID_MEMORY_GATE_V3_POLICY.phaseBudgetsKb));
assert.ok(Object.isFrozen(ANDROID_MEMORY_GATE_V3_POLICY.phaseBudgetsKb.exploreIdle));
assert.deepEqual(ANDROID_MEMORY_GATE_V3_FAILURE_EXIT_REASONS, [2, 3, 4, 5, 6, 7, 9, 17]);

// Real Samsung/Android 13-shaped fixture. Swap is deliberately substantial so
// PSS, swap context, and RSS cannot accidentally collapse into one metric.
const samsungMeminfo = `Applications Memory Usage (in Kilobytes):
Uptime: 496383133 Realtime: 736299932

** MEMINFO in pid 5011 [com.trailhead.app] **
                   Pss  Private  Private  SwapPss      Rss     Heap     Heap     Heap
                 Total    Dirty    Clean    Dirty    Total     Size    Alloc     Free
  Native Heap   416133   416068        0   111429   416736   621944   339854   282089
  Dalvik Heap   109108   108696        0     1122   110148   121000    96424    24576
    GL mtrack    14700    14700        0        0    14700
      Unknown   512896   512628      188    34433   513204
        TOTAL  1260980  1063608    34292   151946  1184200   742944   436278   306665

 App Summary
            Graphics:    14700                          14700

           TOTAL PSS:  1260980            TOTAL RSS:  1184200       TOTAL SWAP PSS:   151946

 Objects
               Views:       59         ViewRootImpl:        1
         AppContexts:        7           Activities:        1
            WebViews:        0
`;

assert.deepEqual(parseAndroidMeminfoV3(samsungMeminfo), {
  totalPssKb: 1_260_980,
  totalSwapPssKb: 151_946,
  pssMinusSwapDiagnosticKb: 1_109_034,
  totalRssKb: 1_184_200,
  nativeHeapPssKb: 416_133,
  nativeHeapRssKb: 416_736,
  graphicsPssKb: 14_700,
  graphicsRssKb: 14_700,
  glMtrackPssKb: 14_700,
  glMtrackRssKb: 14_700,
  unknownPssKb: 512_896,
  unknownRssKb: 513_204,
  viewCount: 59,
  activityCount: 1,
  appContextCount: 7,
  webViewCount: 0,
});

assert.deepEqual(
  parseAndroidMeminfoV3(`
  Native Heap    10,000  9,000 0 1,000 11,000
    GL mtrack     2,000  2,000 0 0 2,000
      Unknown     3,000  3,000 0 0 3,000
        TOTAL   100,000 50,000 5,000 20,000 90,000
  Views: 0 AppContexts: 0 Activities: 0 WebViews: 0
  `),
  {
    totalPssKb: 100_000,
    totalSwapPssKb: 20_000,
    pssMinusSwapDiagnosticKb: 80_000,
    totalRssKb: 90_000,
    nativeHeapPssKb: 10_000,
    nativeHeapRssKb: 11_000,
    graphicsPssKb: 2_000,
    graphicsRssKb: 2_000,
    glMtrackPssKb: 2_000,
    glMtrackRssKb: 2_000,
    unknownPssKb: 3_000,
    unknownRssKb: 3_000,
    viewCount: 0,
    activityCount: 0,
    appContextCount: 0,
    webViewCount: 0,
  },
  'the TOTAL table is a supported fallback and zero object counts remain zero',
);
assert.throws(
  () => parseAndroidMeminfoV3('process not found'),
  error => error instanceof AndroidMemoryGateV3Error && error.code === 'meminfo_totals_unavailable',
);
const swapHeavyMeminfo = parseAndroidMeminfoV3(
  'TOTAL PSS: 100 TOTAL RSS: 90 TOTAL SWAP PSS: 101',
);
assert.equal(swapHeavyMeminfo.totalPssKb, 100);
assert.equal(swapHeavyMeminfo.totalSwapPssKb, 101);
assert.equal(swapHeavyMeminfo.pssMinusSwapDiagnosticKb, 0);

assert.equal(medianV3([3, 1, 2]), 2);
assert.equal(medianV3([4, 1, 3, 2]), 2.5);
assert.equal(linearSlopeV3([10, 20, 30, 40]), 10);
assert.equal(linearSlopeV3([40, 30, 20, 10]), -10);
assert.equal(linearSlopeV3([42]), 0);
assert.throws(() => medianV3([]), /invalid_numeric_series/);

const flatObjects = Array.from({ length: 10 }, () => sample(800_000, 500_000, 700_000, {
  viewCount: 100,
  activityCount: 1,
  appContextCount: 5,
  webViewCount: 0,
}));
const flatObjectEvidence = evaluateObjectCountRatchetV3(flatObjects);
assert.equal(flatObjectEvidence.available, true);
assert.equal(flatObjectEvidence.complete, true);
assert.equal(flatObjectEvidence.detected, false);
const ratchetingObjects = Array.from({ length: 10 }, (_, index) => sample(800_000, 500_000, 700_000, {
  viewCount: 100 + index * 10,
  activityCount: 1,
  appContextCount: 5,
  webViewCount: 0,
}));
const objectRatchet = evaluateObjectCountRatchetV3(ratchetingObjects);
assert.equal(objectRatchet.detected, true);
assert.equal(objectRatchet.metrics.viewCount.detected, true);
const staircaseValues = [100, 100, 110, 110, 110, 110, 110, 110, 120, 120];
const staircaseObjects = staircaseValues.map(viewCount => sample(800_000, 500_000, 700_000, {
  viewCount,
  activityCount: 1,
  appContextCount: 5,
  webViewCount: 0,
}));
const staircaseEvaluation = evaluateObjectCountRatchetV3(staircaseObjects);
assert.equal(staircaseEvaluation.metrics.viewCount.positiveTransitionCount, 2);
assert.equal(staircaseEvaluation.metrics.viewCount.earlyMedian, 100);
assert.equal(staircaseEvaluation.metrics.viewCount.lateMedian, 120);
assert.equal(
  Math.max(...staircaseValues.slice(0, 3)),
  Math.min(...staircaseValues.slice(-3)),
  'the staircase fixture deliberately has an equal early/late edge boundary',
);
assert.equal(staircaseEvaluation.metrics.viewCount.detected, true, 'staircase growth is a ratchet');
assert.equal(staircaseEvaluation.metrics.viewCount.latePositiveTransitionCount, 1);
const plateauObjects = Array.from({ length: 10 }, () => sample(800_000, 500_000, 700_000, {
  viewCount: 125,
}));
assert.equal(
  evaluateObjectCountRatchetV3(plateauObjects).metrics.viewCount.detected,
  false,
  'a stable plateau is not a ratchet',
);
const oneTimeMountPlateauValues = [100, 100, 100, 125, 125, 125, 125, 125, 125, 125];
const oneTimeMountPlateau = evaluateObjectCountRatchetV3(
  oneTimeMountPlateauValues.map(viewCount => sample(800_000, 500_000, 700_000, { viewCount })),
);
assert.equal(oneTimeMountPlateau.metrics.viewCount.positiveTransitionCount, 1);
assert.equal(
  oneTimeMountPlateau.metrics.viewCount.detected,
  false,
  'one mount followed by a stable plateau is not a repeated leak',
);
const jitterValues = [100, 104, 99, 103, 98, 102, 99, 101, 100, 99];
const jitterObjects = jitterValues.map(viewCount => sample(800_000, 500_000, 700_000, {
  viewCount,
}));
assert.equal(
  evaluateObjectCountRatchetV3(jitterObjects).metrics.viewCount.detected,
  false,
  'bounded jitter without durable repeated growth is not a ratchet',
);
const periodicJitterValues = [100, 101, 100, 101, 100, 101, 100, 101, 100, 101];
assert.equal(
  evaluateObjectCountRatchetV3(
    periodicJitterValues.map(viewCount => sample(800_000, 500_000, 700_000, { viewCount })),
  ).metrics.viewCount.detected,
  false,
  'periodic bounded jitter does not create a rising late-cycle floor',
);
const stagedInitializationValues = [100, 110, 120, 120, 120, 120, 120, 120, 120, 120];
assert.equal(
  evaluateObjectCountRatchetV3(
    stagedInitializationValues.map(viewCount => sample(800_000, 500_000, 700_000, { viewCount })),
  ).metrics.viewCount.detected,
  false,
  'normal staged initialization followed by a plateau is not a ratchet',
);
const transientObjects = [...flatObjects];
transientObjects[4] = sample(800_000, 500_000, 700_000, { viewCount: 300 });
assert.equal(evaluateObjectCountRatchetV3(transientObjects).detected, false, 'one transient mount is not a ratchet');
const partialObjectEvidence = evaluateObjectCountRatchetV3(flatObjects.slice(0, 9));
assert.equal(partialObjectEvidence.available, true);
assert.equal(partialObjectEvidence.complete, false);
const missingObjectEvidence = flatObjects.map((entry, index) => (
  index === 5 ? { ...entry, viewCount: null } : entry
));
const missingObjectEvaluation = evaluateObjectCountRatchetV3(missingObjectEvidence);
assert.equal(missingObjectEvaluation.available, true);
assert.equal(missingObjectEvaluation.complete, false);
assert.equal(missingObjectEvaluation.detected, false);

for (const [phase, budget] of Object.entries(ANDROID_MEMORY_GATE_V3_POLICY.phaseBudgetsKb)) {
  const atBoundary = sample(
    budget.maxTotalPssKb,
    budget.referencePssMinusSwapDiagnosticKb,
    budget.maxTotalRssKb,
  );
  assert.equal(
    evaluatePhaseBudgetV3([atBoundary], budget).passed,
    true,
    `${phase} must accept a sample exactly at its hard budget`,
  );
  for (const metric of ['totalPssKb', 'totalRssKb']) {
    const over = { ...atBoundary, [metric]: atBoundary[metric] + 1 };
    if (metric === 'totalPssKb') over.totalSwapPssKb += 1;
    const evaluated = evaluatePhaseBudgetV3([over], budget);
    assert.equal(evaluated.passed, false, `${phase}.${metric} must fail one KB over budget`);
  }
  const diagnosticOver = sample(
    budget.maxTotalPssKb,
    budget.referencePssMinusSwapDiagnosticKb + 1,
    budget.maxTotalRssKb,
  );
  const diagnosticEvaluation = evaluatePhaseBudgetV3([diagnosticOver], budget);
  assert.equal(diagnosticEvaluation.checks.pssMinusSwapDiagnosticWithinReference, false);
  assert.equal(diagnosticEvaluation.passed, true, `${phase} diagnostic reference must not gate`);
}

const passing = evaluateAndroidMemoryGateV3(makePassingInput());
assert.equal(passing.version, 3);
assert.equal(passing.passed, true);
assert.equal(passing.m1Passed, true);
assert.equal(passing.activeExperienceMemoryPassed, true);
assert.equal(passing.activeExperienceEvidenceComplete, false);
assert.equal(
  passing.completeMemoryEvidencePassed,
  false,
  'M1 can pass before all active experiences are measured',
);
assert.equal(passing.cycleCountPassed, true);
assert.equal(passing.phaseBudgets.navigation.passed, true);
assert.equal(passing.phaseBudgets.preview3d.evaluated, false);
assert.equal(passing.phaseBudgets.preview3d.passed, true, 'an unmeasured optional active phase does not block M1');
assert.equal(passing.growth.retainedSlope.totalPssKbPerCycle, 2_000);
assert.equal(passing.growth.retainedSlope.totalRssKbPerCycle, 1_000);
assert.equal(passing.cycleCurve.heavyPeaks.length, 10);
assertMemoryGateV3NumericValues(passing);
assert.doesNotMatch(JSON.stringify(passing), /Samsung|Moab|com\.trailhead|RFCR|search/i);

const completeEvidenceInput = makePassingInput();
completeEvidenceInput.activeSamples.preview3d = [sample(1_250_000, 900_000, 1_100_000)];
completeEvidenceInput.activeSamples.originals = [sample(1_250_000, 900_000, 1_100_000)];
const completeEvidence = evaluateAndroidMemoryGateV3(completeEvidenceInput);
assert.equal(completeEvidence.passed, true);
assert.equal(completeEvidence.m1Passed, true);
assert.equal(completeEvidence.activeExperienceEvidenceComplete, true);
assert.equal(completeEvidence.activeExperienceMemoryPassed, true);
assert.equal(completeEvidence.completeMemoryEvidencePassed, true);

const missingObjectCountInput = makePassingInput();
missingObjectCountInput.cycles[5].disabledRecovery.viewCount = null;
const missingObjectCountReport = evaluateAndroidMemoryGateV3(missingObjectCountInput);
assert.equal(missingObjectCountReport.stability.objectCountEvidenceComplete, false);
assert.equal(missingObjectCountReport.stability.checks.objectCountEvidenceComplete, false);
assert.equal(missingObjectCountReport.passed, false, 'missing object-count evidence must fail without suppressing the report');

const nineCycleInput = makePassingInput();
nineCycleInput.cycles.pop();
const nineCycleReport = evaluateAndroidMemoryGateV3(nineCycleInput);
assert.equal(nineCycleReport.cycleCountPassed, false);
assert.equal(nineCycleReport.passed, false);

const postAbsoluteBoundaryInput = makePassingInput();
postAbsoluteBoundaryInput.mapIdleSamples = [sample(800_000, 520_000, 700_000)];
postAbsoluteBoundaryInput.postMapRecoverySamples = [sample(864_000, 540_000, 720_000)];
const postAbsoluteBoundary = evaluateAndroidMemoryGateV3(postAbsoluteBoundaryInput);
assert.equal(postAbsoluteBoundary.growth.postMapRecovery.totalPss.growthPercent, 8);
assert.equal(postAbsoluteBoundary.growth.postMapRecovery.totalPss.absolutePassed, false);
assert.equal(postAbsoluteBoundary.growth.postMapRecovery.passed, false);

const postPercentBoundaryInput = makePassingInput();
postPercentBoundaryInput.mapIdleSamples = [sample(800_000, 400_000, 400_000)];
postPercentBoundaryInput.postMapRecoverySamples = [sample(800_000, 400_000, 440_000)];
const postPercentBoundary = evaluateAndroidMemoryGateV3(postPercentBoundaryInput);
assert.equal(postPercentBoundary.growth.postMapRecovery.totalRss.growthPercent, 10);
assert.equal(postPercentBoundary.growth.postMapRecovery.totalRss.percentPassed, false);
assert.equal(postPercentBoundary.growth.postMapRecovery.totalRss.absolutePassed, true);

const inclusiveExploreBoundaryInput = makePassingInput();
inclusiveExploreBoundaryInput.exploreIdleSamples = [sample(500_000, 320_000, 450_000)];
inclusiveExploreBoundaryInput.exploreRecoverySamples = [sample(575_000, 368_000, 517_500)];
const inclusiveExploreBoundary = evaluateAndroidMemoryGateV3(inclusiveExploreBoundaryInput);
assert.equal(inclusiveExploreBoundary.growth.exploreReturn.totalPss.growthPercent, 15);
assert.equal(inclusiveExploreBoundary.growth.exploreReturn.totalRss.growthPercent, 15);
assert.equal(inclusiveExploreBoundary.growth.exploreReturn.passed, true);

const disabledRecoveryBoundaryInput = makePassingInput();
disabledRecoveryBoundaryInput.cycles = Array.from({ length: 10 }, (_, index) => ({
  heavyPeak: sample(1_000_000, 700_000, 900_000),
  disabledRecovery: sample(
    index < 3 ? 700_000 : index > 6 ? 764_000 : 730_000,
    index < 3 ? 500_000 : index > 6 ? 530_000 : 515_000,
    700_000,
  ),
}));
const disabledRecoveryBoundary = evaluateAndroidMemoryGateV3(disabledRecoveryBoundaryInput);
assert.equal(disabledRecoveryBoundary.growth.disabledRecovery.totalPss.deltaKb, 64_000);
assert.equal(disabledRecoveryBoundary.growth.disabledRecovery.totalPss.absolutePassed, true);
assert.equal(disabledRecoveryBoundary.growth.disabledRecovery.passed, true);

const disabledRecoveryPercentBoundaryInput = makePassingInput();
disabledRecoveryPercentBoundaryInput.cycles = Array.from({ length: 10 }, (_, index) => ({
  heavyPeak: sample(1_000_000, 700_000, 900_000),
  disabledRecovery: sample(
    700_000,
    500_000,
    index < 3 ? 500_000 : index > 6 ? 550_000 : 525_000,
  ),
}));
const disabledRecoveryPercentBoundary = evaluateAndroidMemoryGateV3(
  disabledRecoveryPercentBoundaryInput,
);
assert.equal(disabledRecoveryPercentBoundary.growth.disabledRecovery.totalRss.growthPercent, 10);
assert.equal(disabledRecoveryPercentBoundary.growth.disabledRecovery.totalRss.percentPassed, true);
assert.equal(disabledRecoveryPercentBoundary.growth.disabledRecovery.passed, true);

const heavyPeakBoundaryInput = makePassingInput();
heavyPeakBoundaryInput.cycles = Array.from({ length: 10 }, (_, index) => ({
  heavyPeak: sample(
    index < 3 ? 1_000_000 : index > 6 ? 1_096_000 : 1_040_000,
    index < 3 ? 700_000 : index > 6 ? 750_000 : 725_000,
    900_000,
  ),
  disabledRecovery: sample(820_000, 530_000, 710_000),
}));
const heavyPeakBoundary = evaluateAndroidMemoryGateV3(heavyPeakBoundaryInput);
assert.equal(heavyPeakBoundary.growth.heavyPeak.totalPss.deltaKb, 96_000);
assert.equal(heavyPeakBoundary.growth.heavyPeak.totalPss.absolutePassed, true);
assert.equal(heavyPeakBoundary.growth.heavyPeak.passed, true);

const heavyPeakPercentBoundaryInput = makePassingInput();
heavyPeakPercentBoundaryInput.cycles = Array.from({ length: 10 }, (_, index) => ({
  heavyPeak: sample(
    1_000_000,
    700_000,
    index < 3 ? 800_000 : index > 6 ? 880_000 : 840_000,
  ),
  disabledRecovery: sample(820_000, 530_000, 710_000),
}));
const heavyPeakPercentBoundary = evaluateAndroidMemoryGateV3(heavyPeakPercentBoundaryInput);
assert.equal(heavyPeakPercentBoundary.growth.heavyPeak.totalRss.growthPercent, 10);
assert.equal(heavyPeakPercentBoundary.growth.heavyPeak.totalRss.percentPassed, true);
assert.equal(heavyPeakPercentBoundary.growth.heavyPeak.passed, true);

const slopeFailureInput = makePassingInput();
slopeFailureInput.cycles = Array.from({ length: 10 }, (_, index) => ({
  heavyPeak: sample(1_000_000, 700_000, 900_000),
  disabledRecovery: sample(700_000 + index * 9_000, 500_000 + index * 1_000, 700_000),
}));
const slopeFailure = evaluateAndroidMemoryGateV3(slopeFailureInput);
assert.equal(slopeFailure.growth.disabledRecovery.passed, true, 'edge growth remains below both caps');
assert.equal(slopeFailure.growth.retainedSlope.totalPssKbPerCycle, 9_000);
assert.equal(slopeFailure.growth.retainedSlope.totalPssPassed, false);
assert.equal(slopeFailure.passed, false);

const rssSlopeFailureInput = makePassingInput();
rssSlopeFailureInput.cycles = Array.from({ length: 10 }, (_, index) => ({
  heavyPeak: sample(1_000_000, 700_000, 900_000),
  disabledRecovery: sample(700_000, 500_000, 650_000 + index * 9_000),
}));
const rssSlopeFailure = evaluateAndroidMemoryGateV3(rssSlopeFailureInput);
assert.equal(rssSlopeFailure.growth.retainedSlope.totalRssKbPerCycle, 9_000);
assert.equal(rssSlopeFailure.growth.retainedSlope.totalRssPassed, false);
assert.equal(rssSlopeFailure.passed, false);

const diagnosticOnlyGrowthInput = makePassingInput();
diagnosticOnlyGrowthInput.postMapRecoverySamples = [sample(837_000, 800_000, 722_000)];
const diagnosticOnlyGrowth = evaluateAndroidMemoryGateV3(diagnosticOnlyGrowthInput);
assert.equal(
  diagnosticOnlyGrowth.phaseBudgets.postMapRecovery.checks
    .pssMinusSwapDiagnosticWithinReference,
  false,
);
assert.equal(diagnosticOnlyGrowth.phaseBudgets.postMapRecovery.passed, true);
assert.equal(diagnosticOnlyGrowth.growth.postMapRecovery.passed, true);
assert.equal(diagnosticOnlyGrowth.passed, true, 'PSS-minus-swap remains diagnostic only');

const activeOverBudgetInput = makePassingInput();
activeOverBudgetInput.activeSamples.preview3d = [sample(1_250_000, 900_000, 1_100_000)];
activeOverBudgetInput.activeSamples.originals = [sample(1_375_001, 1_000_000, 1_200_000)];
const activeOverBudget = evaluateAndroidMemoryGateV3(activeOverBudgetInput);
assert.equal(activeOverBudget.phaseBudgets.originals.passed, false);
assert.equal(activeOverBudget.phaseBudgets.mapIdle.passed, true);
assert.equal(activeOverBudget.budgetPassed, true);
assert.equal(activeOverBudget.passed, true);
assert.equal(activeOverBudget.m1Passed, true);
assert.equal(activeOverBudget.activeExperienceEvidenceComplete, true);
assert.equal(activeOverBudget.activeExperienceMemoryPassed, false);
assert.equal(activeOverBudget.completeMemoryEvidencePassed, false);

const forgedNoRatchetInput = makePassingInput();
forgedNoRatchetInput.cycles = Array.from({ length: 10 }, (_, index) => ({
  heavyPeak: sample(1_000_000, 700_000, 900_000),
  disabledRecovery: sample(820_000, 530_000, 710_000, {
    viewCount: 100 + index * 10,
  }),
}));
forgedNoRatchetInput.stability.objectCountRatchetDetected = false;
const forgedNoRatchet = evaluateAndroidMemoryGateV3(forgedNoRatchetInput);
assert.equal(forgedNoRatchet.stability.objectCountEvidenceComplete, true);
assert.equal(forgedNoRatchet.stability.objectCountRatchetDetected, true);
assert.equal(forgedNoRatchet.stability.passed, false);
assert.equal(forgedNoRatchet.passed, false);

for (const badStability of [
  { processAlive: false },
  { exitEvidenceChecked: false },
  { cancelled: true },
  { layerStateRestored: false },
  { objectCountRatchetDetected: true },
  { lowMemoryKillCount: 1 },
  { oomCount: 1 },
  { anrCount: 1 },
  { processDeathCount: 1 },
  { duplicateRendererEvidenceComplete: false },
  { duplicateRendererCount: 1 },
  { stateLossEvidenceComplete: false },
  { stateLossCount: 1 },
]) {
  const input = makePassingInput();
  input.stability = stableEvidence(badStability);
  const report = evaluateAndroidMemoryGateV3(input);
  assert.equal(report.stability.passed, false, `stability evidence must fail: ${JSON.stringify(badStability)}`);
  assert.equal(report.passed, false);
}

const cancelledPartial = evaluateAndroidMemoryGateV3({ stability: stableEvidence({ cancelled: true }) });
assert.equal(cancelledPartial.passed, false);
assert.equal(cancelledPartial.observedCycleCount, 0);
assert.equal(cancelledPartial.phaseBudgets.exploreIdle.evaluated, false);
assertMemoryGateV3NumericValues(cancelledPartial);

const sourceControlledInput = makePassingInput();
sourceControlledInput.exploreIdleSamples = [sample(650_001, 400_000, 550_000)];
sourceControlledInput.thresholds = { maxTotalPssKb: Number.MAX_SAFE_INTEGER };
const sourceControlledReport = evaluateAndroidMemoryGateV3(sourceControlledInput);
assert.equal(sourceControlledReport.phaseBudgets.exploreIdle.passed, false);
assert.equal(
  sourceControlledReport.phaseBudgets.exploreIdle.limits.maxTotalPssKb,
  ANDROID_MEMORY_GATE_V3_POLICY.phaseBudgetsKb.exploreIdle.maxTotalPssKb,
  'input cannot weaken source-controlled budgets',
);

assert.throws(
  () => evaluateAndroidMemoryGateV3({ stability: stableEvidence(), exploreIdleSamples: [
    { ...sample(500_000, 320_000, 450_000), pssMinusSwapDiagnosticKb: 319_999 },
  ] }),
  error => error instanceof AndroidMemoryGateV3Error
    && error.code === 'inconsistent_pss_minus_swap_diagnostic',
);
const normalizedSwapHeavySample = {
  ...sample(100_000, 0, 90_000),
  totalSwapPssKb: 120_000,
  pssMinusSwapDiagnosticKb: 0,
};
assert.equal(
  evaluatePhaseBudgetV3(
    [normalizedSwapHeavySample],
    ANDROID_MEMORY_GATE_V3_POLICY.phaseBudgetsKb.exploreIdle,
  ).passed,
  true,
  'normalization allows vendor dumps where SwapPSS exceeds PSS and keeps the diagnostic clamped',
);
assert.throws(
  () => evaluatePhaseBudgetV3(
    [{ ...normalizedSwapHeavySample, pssMinusSwapDiagnosticKb: 1 }],
    ANDROID_MEMORY_GATE_V3_POLICY.phaseBudgetsKb.exploreIdle,
  ),
  error => error instanceof AndroidMemoryGateV3Error
    && error.code === 'inconsistent_pss_minus_swap_diagnostic',
  'normalization rejects an unclamped PSS-minus-swap diagnostic',
);
assert.throws(
  () => assertMemoryGateV3NumericValues({ harmlessNumber: 1, rawDump: 'private device text' }),
  error => error instanceof AndroidMemoryGateV3Error && error.code === 'non_numeric_report_value',
);
assert.throws(
  () => assertMemoryGateV3NumericValues({ value: Number.POSITIVE_INFINITY }),
  error => error instanceof AndroidMemoryGateV3Error && error.code === 'non_numeric_report_value',
);

const samsungExitBaselineText = `ACTIVITY MANAGER PROCESS EXIT INFO (dumpsys activity exit-info)
  package: com.trailhead.app
    Historical Process Exit for uid=10303
        ApplicationExitInfo #0:
          timestamp=2026-07-23 03:31:34.050 pid=20679 realUid=10303 packageUid=10303 definingUid=10303 user=0
          process=com.trailhead.app reason=10 (USER REQUESTED) subreason=21 (FORCE STOP) status=0
          importance=100 pss=697MB rss=541MB description=stop com.trailhead.app due to from pid 4976 state=empty trace=null
        ApplicationExitInfo #1:
          timestamp=2026-07-23 02:36:16.162 pid=25025 realUid=10303 packageUid=10303 definingUid=10303 user=0
          process=com.trailhead.app reason=4 (APP CRASH(EXCEPTION)) subreason=0 (UNKNOWN) status=0
          importance=100 pss=0.00 rss=0.00 description=crash state=empty trace=null
`;
const samsungExitBaseline = parseExitInfoV3(samsungExitBaselineText);
assert.equal(samsungExitBaseline.length, 2);
assert.deepEqual(samsungExitBaseline[0], {
  timestampKeyMs: Date.UTC(2026, 6, 23, 3, 31, 34, 50),
  reason: 10,
  subreason: 21,
  status: 0,
  importance: 100,
  pssKb: 697 * 1024,
  rssKb: 541 * 1024,
});
assert.equal(samsungExitBaseline[1].reason, 4);
assert.equal(samsungExitBaseline[1].pssKb, 0);
assert.doesNotMatch(JSON.stringify(samsungExitBaseline), /20679|25025|com\.trailhead|crash|description/i);
assertMemoryGateV3NumericValues(samsungExitBaseline);

const samsungExitAfter = parseExitInfoV3(`${samsungExitBaselineText}
        ApplicationExitInfo #2:
          timestamp=2026-07-23 04:10:00.000 pid=30001 realUid=10303 packageUid=10303 definingUid=10303 user=0
          process=com.trailhead.app reason=10 (USER REQUESTED) subreason=21 (FORCE STOP) status=0
          importance=100 pss=0.89GB rss=857MB description=stop state=empty trace=null
`);
const forceStopDiff = diffExitInfoV3(samsungExitBaseline, samsungExitAfter);
assert.equal(forceStopDiff.length, 1, 'historical force-stops and crashes must not be re-counted');
assert.equal(forceStopDiff[0].reason, 10);
assert.equal(forceStopDiff[0].pssKb, Math.round(0.89 * 1024 * 1024));
const forceStopEvaluation = evaluateExitInfoDiffV3(samsungExitBaseline, samsungExitAfter);
assert.equal(forceStopEvaluation.passed, false);
assert.equal(forceStopEvaluation.forceStopCount, 1);
assert.equal(forceStopEvaluation.failureCount, 1);
assert.equal(forceStopEvaluation.processDeathCount, 1);
assert.equal(forceStopEvaluation.newRecordCount, 1);
const unchangedExitEvaluation = evaluateExitInfoDiffV3(samsungExitBaseline, samsungExitBaseline);
assert.equal(unchangedExitEvaluation.passed, true);
assert.equal(unchangedExitEvaluation.failureCount, 0);
assert.equal(unchangedExitEvaluation.processDeathCount, 0);

for (const reason of [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 17]) {
  const after = parseExitInfoV3(`
    ApplicationExitInfo #0:
      timestamp=2026-07-23 05:00:${String(reason).padStart(2, '0')}.000 pid=${31_000 + reason}
      process=com.trailhead.app reason=${reason} (FAILURE) subreason=0 (UNKNOWN) status=0
      importance=100 pss=123MB rss=234MB description=discarded
  `);
  const evaluation = evaluateExitInfoDiffV3([], after);
  assert.equal(evaluation.passed, false, `new exit reason ${reason} must fail`);
  assert.equal(evaluation.failureCount, 1);
  assert.equal(evaluation.processDeathCount, 1);
  if (ANDROID_MEMORY_GATE_V3_FAILURE_EXIT_REASONS.includes(reason)) {
    assert.equal(evaluation.failureReasonCounts[`reason${reason}Count`], 1);
  } else {
    assert.equal(evaluation.unclassifiedReasonCount, 1);
  }
  assertMemoryGateV3NumericValues(evaluation);
}

assert.equal(
  assertMemoryGateV3ReportPrivacy,
  assertMemoryGateV3NumericValues,
  'the historical export remains only a backwards-compatible numeric-value alias',
);

const benignExit = parseExitInfoV3(`
  ApplicationExitInfo #0:
    timestamp=2026-07-23 06:00:00.000 pid=32000
    process=com.trailhead.app reason=11 (USER STOPPED) subreason=0 status=0
    importance=400 pss=12MB rss=20MB
`);
const userStoppedEvaluation = evaluateExitInfoDiffV3([], benignExit);
assert.equal(userStoppedEvaluation.passed, false);
assert.equal(userStoppedEvaluation.failureCount, 1);
assert.equal(userStoppedEvaluation.processDeathCount, 1);
assert.equal(userStoppedEvaluation.unclassifiedReasonCount, 1);

console.log('PASS: AndroidMemoryGateReportV3 parser and policy');
