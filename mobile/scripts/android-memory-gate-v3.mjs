/**
 * Pure parsing and policy evaluation for the phase-aware Android memory gate.
 *
 * This module intentionally has no ADB, filesystem, clock, environment, or CLI
 * dependencies. The device runner owns collection; this module owns the
 * source-controlled policy and returns privacy-minimal numeric evidence only.
 */

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const ANDROID_MEMORY_GATE_V3_POLICY = deepFreeze({
  reportVersion: 3,
  requiredCycleCount: 10,
  cycleEdgeWindow: 3,
  phaseBudgetsKb: {
    exploreIdle: {
      maxTotalPssKb: 650_000,
      referencePssMinusSwapDiagnosticKb: 400_000,
      maxTotalRssKb: 550_000,
    },
    mapIdle: {
      maxTotalPssKb: 975_000,
      referencePssMinusSwapDiagnosticKb: 625_000,
      maxTotalRssKb: 775_000,
    },
    heavyPeak: {
      maxTotalPssKb: 1_275_000,
      referencePssMinusSwapDiagnosticKb: 900_000,
      maxTotalRssKb: 1_100_000,
    },
    activeExperience: {
      maxTotalPssKb: 1_375_000,
      referencePssMinusSwapDiagnosticKb: 1_000_000,
      maxTotalRssKb: 1_200_000,
    },
  },
  growth: {
    postMapRecovery: {
      maxPercentExclusive: 10,
      maxAbsoluteKbExclusive: 64_000,
    },
    disabledRecovery: {
      maxPercentInclusive: 10,
      maxAbsoluteKbInclusive: 64_000,
    },
    heavyPeak: {
      maxPercentInclusive: 10,
      maxAbsoluteKbInclusive: 96_000,
    },
    exploreReturn: {
      maxPercentInclusive: 15,
      maxAbsoluteKbInclusive: 96_000,
    },
    maxRetainedSlopeKbPerCycleInclusive: 8_000,
  },
});

export const ANDROID_MEMORY_GATE_V3_FAILURE_EXIT_REASONS = Object.freeze([
  2, // SIGNALED; some platform versions report LMK/SIGKILL this way
  3, // LOW_MEMORY
  4, // CRASH
  5, // CRASH_NATIVE
  6, // ANR
  7, // INITIALIZATION_FAILURE
  9, // EXCESSIVE_RESOURCE_USAGE
  17, // platform-defined fatal reason on newer Android releases
]);

const FAILURE_EXIT_REASON_SET = new Set(ANDROID_MEMORY_GATE_V3_FAILURE_EXIT_REASONS);
const INTERNAL_EXIT_PID = Symbol('internalExitPid');

const SAMPLE_METRICS = Object.freeze([
  'totalPssKb',
  'totalSwapPssKb',
  'pssMinusSwapDiagnosticKb',
  'totalRssKb',
  'nativeHeapPssKb',
  'nativeHeapRssKb',
  'graphicsPssKb',
  'graphicsRssKb',
  'glMtrackPssKb',
  'glMtrackRssKb',
  'unknownPssKb',
  'unknownRssKb',
  'viewCount',
  'activityCount',
  'appContextCount',
  'webViewCount',
]);

const REQUIRED_SAMPLE_METRICS = Object.freeze([
  'totalPssKb',
  'totalSwapPssKb',
  'pssMinusSwapDiagnosticKb',
  'totalRssKb',
]);

const COUNT_METRICS = new Set([
  'viewCount',
  'activityCount',
  'appContextCount',
  'webViewCount',
]);

const STABILITY_COUNT_FIELDS = Object.freeze([
  'lowMemoryKillCount',
  'oomCount',
  'anrCount',
  'processDeathCount',
  'duplicateRendererCount',
  'stateLossCount',
]);

export class AndroidMemoryGateV3Error extends Error {
  constructor(code) {
    super(code);
    this.name = 'AndroidMemoryGateV3Error';
    this.code = code;
  }
}

function escapedRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseInteger(value) {
  if (value == null) return null;
  const normalized = String(value).replaceAll(',', '');
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function labelledInteger(text, label) {
  const match = String(text).match(new RegExp(`${escapedRegex(label)}:\\s*([\\d,]+)`, 'i'));
  return parseInteger(match?.[1]);
}

function rowIntegers(text, label) {
  const pattern = new RegExp(`^\\s*${escapedRegex(label)}\\s+(?=[\\d,])(.+)$`, 'im');
  const remainder = String(text).match(pattern)?.[1];
  if (!remainder) return [];
  return [...remainder.matchAll(/[\d,]+/g)]
    .map(match => parseInteger(match[0]))
    .filter(Number.isFinite);
}

function labelledRowIntegers(text, label) {
  const pattern = new RegExp(`^\\s*${escapedRegex(label)}:\\s*(.+)$`, 'im');
  const remainder = String(text).match(pattern)?.[1];
  if (!remainder) return [];
  return [...remainder.matchAll(/[\d,]+/g)]
    .map(match => parseInteger(match[0]))
    .filter(Number.isFinite);
}

function objectCount(text, label) {
  return labelledInteger(text, label);
}

/**
 * Parse one `adb shell dumpsys meminfo <package>` response.
 *
 * The returned value never contains the raw dump, process name, package name,
 * device identity, or any other text. Optional breakdowns are null when an
 * Android release does not expose them.
 */
export function parseAndroidMeminfoV3(text) {
  const source = String(text ?? '').replace(/\r\n/g, '\n');
  const totalRow = rowIntegers(source, 'TOTAL');

  const totalPssKb = labelledInteger(source, 'TOTAL PSS') ?? totalRow[0] ?? null;
  const totalRssKb = labelledInteger(source, 'TOTAL RSS') ?? totalRow[4] ?? null;
  const totalSwapPssKb = labelledInteger(source, 'TOTAL SWAP PSS') ?? totalRow[3] ?? null;

  if (![totalPssKb, totalRssKb, totalSwapPssKb].every(Number.isFinite)) {
    throw new AndroidMemoryGateV3Error('meminfo_totals_unavailable');
  }
  if (totalPssKb <= 0 || totalRssKb <= 0 || totalSwapPssKb < 0) {
    throw new AndroidMemoryGateV3Error('meminfo_totals_invalid');
  }
  const nativeHeapRow = rowIntegers(source, 'Native Heap');
  const glMtrackRow = rowIntegers(source, 'GL mtrack');
  const summaryGraphicsRow = labelledRowIntegers(source, 'Graphics');
  const unknownRow = rowIntegers(source, 'Unknown');
  const nativeHeapPssKb = nativeHeapRow[0] ?? null;
  const nativeHeapRssKb = nativeHeapRow[4] ?? null;
  const glMtrackPssKb = glMtrackRow[0] ?? null;
  const glMtrackRssKb = glMtrackRow[4] ?? null;
  const summaryGraphicsPssKb = summaryGraphicsRow[0] ?? null;
  const summaryGraphicsRssKb = summaryGraphicsRow[1] ?? null;
  const unknownPssKb = unknownRow[0] ?? null;
  const unknownRssKb = unknownRow[4] ?? null;

  return {
    totalPssKb,
    totalSwapPssKb,
    // This subtraction is retained only to explain vendor-specific dumpsys
    // output seen during the old gate. Android does not define it as resident
    // PSS, so policy never gates on it; RSS is the resident-page measurement.
    pssMinusSwapDiagnosticKb: Math.max(0, totalPssKb - totalSwapPssKb),
    totalRssKb,
    nativeHeapPssKb,
    nativeHeapRssKb,
    graphicsPssKb: summaryGraphicsPssKb ?? glMtrackPssKb,
    graphicsRssKb: summaryGraphicsRssKb ?? glMtrackRssKb,
    glMtrackPssKb,
    glMtrackRssKb,
    unknownPssKb,
    unknownRssKb,
    viewCount: objectCount(source, 'Views'),
    activityCount: objectCount(source, 'Activities'),
    appContextCount: objectCount(source, 'AppContexts'),
    webViewCount: objectCount(source, 'WebViews'),
  };
}

function parseTimestampKey(value) {
  const match = String(value).match(
    /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/,
  );
  if (!match) return null;
  const [, year, month, day, hour, minute, second, millisecond] = match;
  const timestampKeyMs = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(millisecond),
  );
  return Number.isFinite(timestampKeyMs) ? timestampKeyMs : null;
}

function parseExitMemoryKb(value, unit) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const multiplier = unit?.toUpperCase() === 'GB'
    ? 1024 * 1024
    : unit?.toUpperCase() === 'MB'
      ? 1024
      : 1;
  return Math.round(amount * multiplier);
}

function finalizeExitRecord(record) {
  if (!record || !Number.isFinite(record.timestampKeyMs) || !Number.isInteger(record.reason)) return null;
  const sanitized = {
    timestampKeyMs: record.timestampKeyMs,
    reason: record.reason,
    subreason: record.subreason,
    status: record.status,
    importance: record.importance,
    pssKb: record.pssKb,
    rssKb: record.rssKb,
  };
  Object.defineProperty(sanitized, INTERNAL_EXIT_PID, {
    value: record.pid,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return sanitized;
}

/**
 * Parse package-scoped `dumpsys activity exit-info` output.
 *
 * Process names, descriptions, traces, UIDs, and raw text are discarded. PID
 * is retained as a non-enumerable internal diff key and never enters JSON or a
 * report. All enumerable record values are numeric or null.
 */
export function parseExitInfoV3(text) {
  const records = [];
  let current = null;
  const flush = () => {
    const finalized = finalizeExitRecord(current);
    if (finalized) records.push(finalized);
    current = null;
  };

  for (const line of String(text ?? '').replace(/\r\n/g, '\n').split('\n')) {
    if (/^\s*ApplicationExitInfo\s+#\d+:/.test(line)) {
      flush();
      current = {
        timestampKeyMs: null,
        pid: null,
        reason: null,
        subreason: null,
        status: null,
        importance: null,
        pssKb: null,
        rssKb: null,
      };
      continue;
    }
    if (!current) continue;
    const timestamp = line.match(/timestamp=(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})/);
    if (timestamp) {
      current.timestampKeyMs = parseTimestampKey(timestamp[1]);
      current.pid = parseInteger(line.match(/\bpid=(\d+)/)?.[1]);
    }
    const reason = line.match(/\breason=(\d+)/);
    if (reason) {
      current.reason = parseInteger(reason[1]);
      current.subreason = parseInteger(line.match(/\bsubreason=(\d+)/)?.[1]);
      const status = line.match(/\bstatus=(-?\d+)/)?.[1];
      current.status = status == null ? null : Number(status);
    }
    const importance = line.match(/\bimportance=(\d+)/)?.[1];
    if (importance != null) current.importance = parseInteger(importance);
    const pss = line.match(/\bpss=([\d.]+)(KB|MB|GB)?\b/i);
    if (pss) current.pssKb = parseExitMemoryKb(pss[1], pss[2]);
    const rss = line.match(/\brss=([\d.]+)(KB|MB|GB)?\b/i);
    if (rss) current.rssKb = parseExitMemoryKb(rss[1], rss[2]);
  }
  flush();
  assertMemoryGateV3NumericValues(records);
  return records;
}

function exitRecordFingerprint(record) {
  if (!record || typeof record !== 'object') throw new AndroidMemoryGateV3Error('invalid_exit_record');
  const numericFields = ['timestampKeyMs', 'reason', 'subreason', 'status', 'importance', 'pssKb', 'rssKb'];
  for (const field of numericFields) {
    if (record[field] != null && !Number.isFinite(record[field])) {
      throw new AndroidMemoryGateV3Error('invalid_exit_record');
    }
  }
  if (!Number.isFinite(record.timestampKeyMs) || !Number.isInteger(record.reason)) {
    throw new AndroidMemoryGateV3Error('invalid_exit_record');
  }
  const pid = record[INTERNAL_EXIT_PID];
  return [
    record.timestampKeyMs,
    Number.isInteger(pid) ? pid : null,
    record.reason,
    record.subreason,
    record.status,
  ].join(':');
}

function sanitizedExitRecord(record) {
  return {
    timestampKeyMs: record.timestampKeyMs,
    reason: record.reason,
    subreason: record.subreason ?? null,
    status: record.status ?? null,
    importance: record.importance ?? null,
    pssKb: record.pssKb ?? null,
    rssKb: record.rssKb ?? null,
  };
}

/** Return only records first observed after the baseline snapshot. */
export function diffExitInfoV3(beforeInput, afterInput) {
  if (!Array.isArray(beforeInput) || !Array.isArray(afterInput)) {
    throw new AndroidMemoryGateV3Error('invalid_exit_records');
  }
  const baselineCounts = new Map();
  for (const record of beforeInput) {
    const fingerprint = exitRecordFingerprint(record);
    baselineCounts.set(fingerprint, (baselineCounts.get(fingerprint) ?? 0) + 1);
  }
  const added = [];
  for (const record of afterInput) {
    const fingerprint = exitRecordFingerprint(record);
    const baselineCount = baselineCounts.get(fingerprint) ?? 0;
    if (baselineCount > 0) {
      baselineCounts.set(fingerprint, baselineCount - 1);
    } else {
      added.push(sanitizedExitRecord(record));
    }
  }
  assertMemoryGateV3NumericValues(added);
  return added;
}

/**
 * Evaluate only newly observed exit records. Historical entries are removed by
 * the baseline diff. The runner captures its baseline after its own force-stop,
 * so every newly observed exit record is unexpected and fails the gate,
 * including reason 10.
 */
export function evaluateExitInfoDiffV3(beforeInput, afterInput) {
  const added = diffExitInfoV3(beforeInput, afterInput);
  const failureReasonCounts = Object.fromEntries(
    ANDROID_MEMORY_GATE_V3_FAILURE_EXIT_REASONS.map(reason => [`reason${reason}Count`, 0]),
  );
  let forceStopCount = 0;
  let unclassifiedReasonCount = 0;
  for (const record of added) {
    if (record.reason === 10) forceStopCount += 1;
    if (FAILURE_EXIT_REASON_SET.has(record.reason)) {
      failureReasonCounts[`reason${record.reason}Count`] += 1;
    } else {
      unclassifiedReasonCount += 1;
    }
  }
  const failureCount = added.length;
  const evaluation = {
    passed: failureCount === 0,
    newRecordCount: added.length,
    failureCount,
    processDeathCount: added.length,
    forceStopCount,
    unclassifiedReasonCount,
    failureReasonCounts,
    failureRecords: added,
  };
  assertMemoryGateV3NumericValues(evaluation);
  return evaluation;
}

export function medianV3(values) {
  if (!Array.isArray(values) || values.length === 0 || values.some(value => !Number.isFinite(value))) {
    throw new AndroidMemoryGateV3Error('invalid_numeric_series');
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Ordinary least-squares slope for equally spaced samples, in KB/sample. */
export function linearSlopeV3(values) {
  if (!Array.isArray(values) || values.length === 0 || values.some(value => !Number.isFinite(value))) {
    throw new AndroidMemoryGateV3Error('invalid_numeric_series');
  }
  if (values.length === 1) return 0;
  const xMean = (values.length - 1) / 2;
  const yMean = values.reduce((sum, value) => sum + value, 0) / values.length;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < values.length; index += 1) {
    const centeredX = index - xMean;
    numerator += centeredX * (values[index] - yMean);
    denominator += centeredX ** 2;
  }
  return numerator / denominator;
}

/**
 * Detect a repeatable object-count ratchet across disabled recovery valleys.
 * A one-time sheet mount followed by a plateau, a bounded plateau, or ordinary
 * jitter is not enough: growth must continue into the final cycle window,
 * that window's floor must remain above the early floor, and its median must
 * exceed the immediately preceding window. This still catches staircase
 * leaks without treating bounded oscillation or staged initialization as a
 * retained-memory leak.
 */
export function evaluateObjectCountRatchetV3(samplesInput) {
  const samples = normalizeSamples(samplesInput);
  const metrics = ['viewCount', 'activityCount', 'appContextCount', 'webViewCount'];
  const requiredSampleCount = ANDROID_MEMORY_GATE_V3_POLICY.requiredCycleCount;
  const complete = samples.length >= requiredSampleCount
    && samples.every(sample => metrics.every(metric => sample[metric] != null));
  const results = {};
  let detected = false;
  for (const metric of metrics) {
    const values = samples.map(sample => sample[metric]);
    if (values.length < requiredSampleCount || values.some(value => value == null)) {
      results[metric] = {
        evaluated: false,
        detected: false,
        earlyMedian: null,
        precedingLateMedian: null,
        lateMedian: null,
        earlyFloor: null,
        lateFloor: null,
        slopePerCycle: null,
        positiveTransitionCount: null,
        latePositiveTransitionCount: null,
      };
      continue;
    }
    const edge = ANDROID_MEMORY_GATE_V3_POLICY.cycleEdgeWindow;
    const early = values.slice(0, edge);
    const precedingLate = values.slice(-(edge * 2), -edge);
    const late = values.slice(-edge);
    const earlyMedian = medianV3(early);
    const precedingLateMedian = medianV3(precedingLate);
    const lateMedian = medianV3(late);
    const earlyFloor = Math.min(...early);
    const lateFloor = Math.min(...late);
    const slopePerCycle = linearSlopeV3(values);
    const positiveTransitionCount = values.slice(1)
      .reduce((count, value, index) => count + (value > values[index] ? 1 : 0), 0);
    const lateStartIndex = values.length - edge;
    const latePositiveTransitionCount = values.slice(1)
      .reduce((count, value, index) => {
        const currentIndex = index + 1;
        return count + (currentIndex >= lateStartIndex && value > values[index] ? 1 : 0);
      }, 0);
    const metricDetected = lateMedian > earlyMedian
      && lateMedian > precedingLateMedian
      && lateFloor > earlyFloor
      && slopePerCycle > 0
      && positiveTransitionCount >= 2
      && latePositiveTransitionCount >= 1;
    results[metric] = {
      evaluated: true,
      detected: metricDetected,
      earlyMedian,
      precedingLateMedian,
      lateMedian,
      earlyFloor,
      lateFloor,
      slopePerCycle,
      positiveTransitionCount,
      latePositiveTransitionCount,
    };
    detected ||= metricDetected;
  }
  const evaluation = {
    available: samples.length > 0 && samples.some(
      sample => metrics.some(metric => sample[metric] != null),
    ),
    complete,
    requiredSampleCount,
    observedSampleCount: samples.length,
    detected,
    metrics: results,
  };
  assertMemoryGateV3NumericValues(evaluation);
  return evaluation;
}

function normalizeSample(sample) {
  if (!sample || typeof sample !== 'object' || Array.isArray(sample)) {
    throw new AndroidMemoryGateV3Error('invalid_memory_sample');
  }
  const normalized = {};
  for (const metric of SAMPLE_METRICS) {
    const value = sample[metric] ?? null;
    if (value != null && (!Number.isFinite(value) || value < 0)) {
      throw new AndroidMemoryGateV3Error('invalid_memory_sample');
    }
    if (COUNT_METRICS.has(metric) && value != null && !Number.isInteger(value)) {
      throw new AndroidMemoryGateV3Error('invalid_memory_sample');
    }
    normalized[metric] = value;
  }
  if (REQUIRED_SAMPLE_METRICS.some(metric => normalized[metric] == null)) {
    throw new AndroidMemoryGateV3Error('incomplete_memory_sample');
  }
  if (normalized.totalPssKb <= 0 || normalized.totalRssKb <= 0) {
    throw new AndroidMemoryGateV3Error('invalid_memory_sample');
  }
  if (normalized.pssMinusSwapDiagnosticKb
    !== Math.max(0, normalized.totalPssKb - normalized.totalSwapPssKb)) {
    throw new AndroidMemoryGateV3Error('inconsistent_pss_minus_swap_diagnostic');
  }
  return normalized;
}

function normalizeSamples(samples) {
  if (samples == null) return [];
  if (!Array.isArray(samples)) throw new AndroidMemoryGateV3Error('invalid_memory_samples');
  return samples.map(normalizeSample);
}

function nullableSummary(samples, metric) {
  const values = samples.map(sample => sample[metric]).filter(Number.isFinite);
  if (values.length === 0) return { count: 0, median: null, maximum: null };
  return {
    count: values.length,
    median: medianV3(values),
    maximum: Math.max(...values),
  };
}

function sampleSummary(samples) {
  return Object.fromEntries(SAMPLE_METRICS.map(metric => [metric, nullableSummary(samples, metric)]));
}

function emptyBudgetChecks() {
  return {
    totalPssWithinBudget: null,
    totalRssWithinBudget: null,
    pssMinusSwapDiagnosticWithinReference: null,
  };
}

export function evaluatePhaseBudgetV3(samplesInput, budget, { required = true } = {}) {
  const samples = normalizeSamples(samplesInput);
  if (!budget || typeof budget !== 'object') {
    throw new AndroidMemoryGateV3Error('phase_budget_unavailable');
  }
  const limits = {
    maxTotalPssKb: budget.maxTotalPssKb,
    maxTotalRssKb: budget.maxTotalRssKb,
    referencePssMinusSwapDiagnosticKb: budget.referencePssMinusSwapDiagnosticKb,
  };
  if (Object.values(limits).some(value => !Number.isFinite(value) || value <= 0)) {
    throw new AndroidMemoryGateV3Error('phase_budget_invalid');
  }
  if (samples.length === 0) {
    return {
      evaluated: false,
      required,
      passed: !required,
      sampleCount: 0,
      limits,
      checks: emptyBudgetChecks(),
      observed: sampleSummary(samples),
    };
  }
  const maxTotalPssKb = Math.max(...samples.map(sample => sample.totalPssKb));
  const maxTotalRssKb = Math.max(...samples.map(sample => sample.totalRssKb));
  const maxPssMinusSwapDiagnosticKb = Math.max(...samples.map(sample => sample.pssMinusSwapDiagnosticKb));
  const checks = {
    totalPssWithinBudget: maxTotalPssKb <= limits.maxTotalPssKb,
    totalRssWithinBudget: maxTotalRssKb <= limits.maxTotalRssKb,
    pssMinusSwapDiagnosticWithinReference:
      maxPssMinusSwapDiagnosticKb <= limits.referencePssMinusSwapDiagnosticKb,
  };
  const acceptanceChecks = [checks.totalPssWithinBudget, checks.totalRssWithinBudget];
  return {
    evaluated: true,
    required,
    passed: acceptanceChecks.every(Boolean),
    sampleCount: samples.length,
    limits,
    checks,
    observed: sampleSummary(samples),
  };
}

function unavailableGrowth(limit, inclusive) {
  return {
    evaluated: false,
    passed: false,
    baselineMedianKb: null,
    comparisonMedianKb: null,
    deltaKb: null,
    growthPercent: null,
    maxPercent: inclusive ? limit.maxPercentInclusive : limit.maxPercentExclusive,
    maxAbsoluteKb: inclusive ? limit.maxAbsoluteKbInclusive : limit.maxAbsoluteKbExclusive,
    percentPassed: null,
    absolutePassed: null,
  };
}

function evaluateGrowthSeries(beforeSamples, afterSamples, metric, limit, { inclusive = false } = {}) {
  if (beforeSamples.length === 0 || afterSamples.length === 0) return unavailableGrowth(limit, inclusive);
  const baselineMedianKb = medianV3(beforeSamples.map(sample => sample[metric]));
  const comparisonMedianKb = medianV3(afterSamples.map(sample => sample[metric]));
  if (baselineMedianKb <= 0) throw new AndroidMemoryGateV3Error('invalid_growth_baseline');
  const deltaKb = comparisonMedianKb - baselineMedianKb;
  const growthPercent = (deltaKb / baselineMedianKb) * 100;
  const maxPercent = inclusive ? limit.maxPercentInclusive : limit.maxPercentExclusive;
  const maxAbsoluteKb = inclusive ? limit.maxAbsoluteKbInclusive : limit.maxAbsoluteKbExclusive;
  const percentPassed = inclusive ? growthPercent <= maxPercent : growthPercent < maxPercent;
  const absolutePassed = inclusive ? deltaKb <= maxAbsoluteKb : deltaKb < maxAbsoluteKb;
  return {
    evaluated: true,
    passed: percentPassed && absolutePassed,
    baselineMedianKb,
    comparisonMedianKb,
    deltaKb,
    growthPercent,
    maxPercent,
    maxAbsoluteKb,
    percentPassed,
    absolutePassed,
  };
}

function evaluateDualMetricGrowth(beforeSamples, afterSamples, limit, options) {
  const totalPss = evaluateGrowthSeries(beforeSamples, afterSamples, 'totalPssKb', limit, options);
  const totalRss = evaluateGrowthSeries(beforeSamples, afterSamples, 'totalRssKb', limit, options);
  return {
    evaluated: totalPss.evaluated && totalRss.evaluated,
    passed: totalPss.passed && totalRss.passed,
    totalPss,
    totalRss,
  };
}

function unavailableSlope(limit) {
  return {
    evaluated: false,
    passed: false,
    totalPssKbPerCycle: null,
    totalRssKbPerCycle: null,
    maxKbPerCycle: limit,
    totalPssPassed: null,
    totalRssPassed: null,
  };
}

function evaluateRetainedSlope(disabledRecoverySamples) {
  const limit = ANDROID_MEMORY_GATE_V3_POLICY.growth.maxRetainedSlopeKbPerCycleInclusive;
  if (disabledRecoverySamples.length < 2) return unavailableSlope(limit);
  const totalPssKbPerCycle = linearSlopeV3(disabledRecoverySamples.map(sample => sample.totalPssKb));
  const totalRssKbPerCycle = linearSlopeV3(disabledRecoverySamples.map(sample => sample.totalRssKb));
  const totalPssPassed = totalPssKbPerCycle <= limit;
  const totalRssPassed = totalRssKbPerCycle <= limit;
  return {
    evaluated: true,
    passed: totalPssPassed && totalRssPassed,
    totalPssKbPerCycle,
    totalRssKbPerCycle,
    maxKbPerCycle: limit,
    totalPssPassed,
    totalRssPassed,
  };
}

function normalizeStability(input = {}, objectCountEvidence) {
  const booleanFields = [
    'processAlive',
    'exitEvidenceChecked',
    'cancelled',
    'layerStateRestored',
    'objectCountRatchetDetected',
    'duplicateRendererEvidenceComplete',
    'stateLossEvidenceComplete',
  ];
  for (const field of booleanFields) {
    if (typeof input[field] !== 'boolean') throw new AndroidMemoryGateV3Error('invalid_stability_evidence');
  }
  const counts = {};
  for (const field of STABILITY_COUNT_FIELDS) {
    const value = input[field];
    if (!Number.isInteger(value) || value < 0) throw new AndroidMemoryGateV3Error('invalid_stability_evidence');
    counts[field] = value;
  }
  const objectCountRatchetDetected = input.objectCountRatchetDetected || objectCountEvidence.detected;
  const checks = {
    processAlive: input.processAlive,
    exitEvidenceChecked: input.exitEvidenceChecked,
    notCancelled: !input.cancelled,
    layerStateRestored: input.layerStateRestored,
    objectCountEvidenceComplete: objectCountEvidence.complete,
    noObjectCountRatchet: !objectCountRatchetDetected,
    noLowMemoryKill: counts.lowMemoryKillCount === 0,
    noOom: counts.oomCount === 0,
    noAnr: counts.anrCount === 0,
    noProcessDeath: counts.processDeathCount === 0,
    duplicateRendererEvidenceComplete: input.duplicateRendererEvidenceComplete,
    noDuplicateRenderer: counts.duplicateRendererCount === 0,
    stateLossEvidenceComplete: input.stateLossEvidenceComplete,
    noStateLoss: counts.stateLossCount === 0,
  };
  return {
    passed: Object.values(checks).every(Boolean),
    processAlive: input.processAlive,
    exitEvidenceChecked: input.exitEvidenceChecked,
    cancelled: input.cancelled,
    layerStateRestored: input.layerStateRestored,
    duplicateRendererEvidenceComplete: input.duplicateRendererEvidenceComplete,
    stateLossEvidenceComplete: input.stateLossEvidenceComplete,
    objectCountEvidenceAvailable: objectCountEvidence.available,
    objectCountEvidenceComplete: objectCountEvidence.complete,
    objectCountRatchetDetected,
    ...counts,
    checks,
  };
}

function normalizeCycles(cyclesInput) {
  if (cyclesInput == null) return [];
  if (!Array.isArray(cyclesInput)) throw new AndroidMemoryGateV3Error('invalid_cycle_samples');
  return cyclesInput.map((cycle) => {
    if (!cycle || typeof cycle !== 'object' || Array.isArray(cycle)) {
      throw new AndroidMemoryGateV3Error('invalid_cycle_samples');
    }
    return {
      heavyPeak: normalizeSample(cycle.heavyPeak),
      disabledRecovery: normalizeSample(cycle.disabledRecovery),
    };
  });
}

function memoryCurve(samples) {
  return samples.map(sample => ({
    totalPssKb: sample.totalPssKb,
    totalSwapPssKb: sample.totalSwapPssKb,
    pssMinusSwapDiagnosticKb: sample.pssMinusSwapDiagnosticKb,
    totalRssKb: sample.totalRssKb,
  }));
}

/**
 * Assert recursively that a value contains only finite numbers, booleans, and
 * null. This is a value-domain check only; it does not validate report keys,
 * schema, or privacy. The runner owns the complete report-schema allowlist.
 */
export function assertMemoryGateV3NumericValues(value, seen = new WeakSet()) {
  if (value == null || typeof value === 'boolean') return true;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new AndroidMemoryGateV3Error('non_numeric_report_value');
    return true;
  }
  if (typeof value !== 'object') throw new AndroidMemoryGateV3Error('non_numeric_report_value');
  if (seen.has(value)) throw new AndroidMemoryGateV3Error('cyclic_report_value');
  seen.add(value);
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    assertMemoryGateV3NumericValues(child, seen);
  }
  seen.delete(value);
  return true;
}

/**
 * Backwards-compatible alias. Despite its historical name, this validates only
 * numeric/boolean/null values; it is not a schema or privacy allowlist.
 */
export const assertMemoryGateV3ReportPrivacy = assertMemoryGateV3NumericValues;

/**
 * Build AndroidMemoryGateReportV3 from already-collected samples.
 *
 * Optional active-experience phases are evaluated separately and cannot borrow
 * their larger budget for ordinary Explore or Map phases.
 */
export function evaluateAndroidMemoryGateV3(input = {}) {
  const exploreIdle = normalizeSamples(input.exploreIdleSamples);
  const mapIdle = normalizeSamples(input.mapIdleSamples);
  const postMapRecovery = normalizeSamples(input.postMapRecoverySamples);
  const exploreRecovery = normalizeSamples(input.exploreRecoverySamples);
  const cycles = normalizeCycles(input.cycles);
  const heavyPeaks = cycles.map(cycle => cycle.heavyPeak);
  const disabledRecoveries = cycles.map(cycle => cycle.disabledRecovery);
  const navigation = normalizeSamples(input.activeSamples?.navigation);
  const preview3d = normalizeSamples(input.activeSamples?.preview3d);
  const originals = normalizeSamples(input.activeSamples?.originals);
  const policy = ANDROID_MEMORY_GATE_V3_POLICY;

  const phaseBudgets = {
    exploreIdle: evaluatePhaseBudgetV3(exploreIdle, policy.phaseBudgetsKb.exploreIdle),
    mapIdle: evaluatePhaseBudgetV3(mapIdle, policy.phaseBudgetsKb.mapIdle),
    heavyPeaks: evaluatePhaseBudgetV3(heavyPeaks, policy.phaseBudgetsKb.heavyPeak),
    disabledRecoveries: evaluatePhaseBudgetV3(disabledRecoveries, policy.phaseBudgetsKb.mapIdle),
    postMapRecovery: evaluatePhaseBudgetV3(postMapRecovery, policy.phaseBudgetsKb.mapIdle),
    exploreRecovery: evaluatePhaseBudgetV3(exploreRecovery, policy.phaseBudgetsKb.exploreIdle),
    navigation: evaluatePhaseBudgetV3(navigation, policy.phaseBudgetsKb.activeExperience, { required: false }),
    preview3d: evaluatePhaseBudgetV3(preview3d, policy.phaseBudgetsKb.activeExperience, { required: false }),
    originals: evaluatePhaseBudgetV3(originals, policy.phaseBudgetsKb.activeExperience, { required: false }),
  };

  const edgeWindow = policy.cycleEdgeWindow;
  const earlyDisabled = disabledRecoveries.slice(0, edgeWindow);
  const lateDisabled = disabledRecoveries.slice(-edgeWindow);
  const earlyPeaks = heavyPeaks.slice(0, edgeWindow);
  const latePeaks = heavyPeaks.slice(-edgeWindow);
  const cycleCountPassed = cycles.length === policy.requiredCycleCount;

  const growth = {
    postMapRecovery: evaluateDualMetricGrowth(
      mapIdle,
      postMapRecovery,
      policy.growth.postMapRecovery,
    ),
    disabledRecovery: evaluateDualMetricGrowth(
      earlyDisabled,
      lateDisabled,
      policy.growth.disabledRecovery,
      { inclusive: true },
    ),
    heavyPeak: evaluateDualMetricGrowth(
      earlyPeaks,
      latePeaks,
      policy.growth.heavyPeak,
      { inclusive: true },
    ),
    retainedSlope: evaluateRetainedSlope(disabledRecoveries),
    exploreReturn: evaluateDualMetricGrowth(
      exploreIdle,
      exploreRecovery,
      policy.growth.exploreReturn,
      { inclusive: true },
    ),
  };

  const objectCountEvidence = evaluateObjectCountRatchetV3(disabledRecoveries);
  const stability = normalizeStability(input.stability, objectCountEvidence);
  const m1PhaseBudgetResults = [
    phaseBudgets.exploreIdle,
    phaseBudgets.mapIdle,
    phaseBudgets.heavyPeaks,
    phaseBudgets.disabledRecoveries,
    phaseBudgets.postMapRecovery,
    phaseBudgets.exploreRecovery,
  ];
  const activeExperienceBudgetResults = [
    phaseBudgets.navigation,
    phaseBudgets.preview3d,
    phaseBudgets.originals,
  ];
  const budgetPassed = m1PhaseBudgetResults.every(result => result.passed);
  const activeExperienceMemoryPassed = activeExperienceBudgetResults.every(
    result => result.passed,
  );
  const growthPassed = Object.values(growth).every(result => result.passed);
  const activeExperienceEvidenceComplete = activeExperienceBudgetResults.every(
    result => result.evaluated,
  );
  const m1Passed = budgetPassed && growthPassed && cycleCountPassed && stability.passed;
  const report = {
    version: policy.reportVersion,
    // `passed` remains a compatibility alias for the M1 Map/Explore gate.
    // Active experiences have an independent memory result and completeness.
    passed: m1Passed,
    m1Passed,
    activeExperienceEvidenceComplete,
    activeExperienceMemoryPassed,
    completeMemoryEvidencePassed:
      m1Passed && activeExperienceEvidenceComplete && activeExperienceMemoryPassed,
    budgetPassed,
    growthPassed,
    cycleCountPassed,
    requiredCycleCount: policy.requiredCycleCount,
    observedCycleCount: cycles.length,
    phaseBudgets,
    growth,
    stability,
    cycleCurve: {
      heavyPeaks: memoryCurve(heavyPeaks),
      disabledRecoveries: memoryCurve(disabledRecoveries),
    },
  };
  assertMemoryGateV3NumericValues(report);
  return report;
}
