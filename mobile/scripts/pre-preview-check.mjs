#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(mobileRoot, '..');
const androidRoot = join(mobileRoot, 'android');

function resolvedAndroidJavaEnvironment() {
  const javaCandidates = [
    process.env.JAVA_HOME,
    join(homedir(), '.local', 'share', 'jdks', 'temurin-17'),
    '/usr/lib/jvm/java-17-openjdk-amd64',
    '/usr/lib/jvm/temurin-17-jdk-amd64',
  ].filter(Boolean);
  const javaHome = javaCandidates.find(candidate => (
    existsSync(join(candidate, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'))
  ));
  const sdkCandidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    join(homedir(), 'android-sdk'),
    join(homedir(), 'Android', 'Sdk'),
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : '',
    '/opt/android-sdk',
    '/usr/local/android-sdk',
  ].filter(Boolean);
  const androidHome = sdkCandidates.find(candidate => existsSync(join(candidate, 'platform-tools')));
  return {
    ...(javaHome ? {
      JAVA_HOME: javaHome,
      PATH: `${join(javaHome, 'bin')}${delimiter}${process.env.PATH ?? ''}`,
    } : {}),
    ...(androidHome ? {
      ANDROID_HOME: androidHome,
      ANDROID_SDK_ROOT: androidHome,
    } : {}),
  };
}

const prepreviewDbRoot = mkdtempSync(join(tmpdir(), 'trailhead-prepreview-'));
const prepreviewDbPath = join(prepreviewDbRoot, 'trailhead.db');
const prepreviewDbEnvironment = { TRAILHEAD_DB_PATH: prepreviewDbPath };

const checks = [
  {
    label: 'Native/config drift',
    cwd: mobileRoot,
    cmd: 'node',
    args: ['scripts/native-drift-check.mjs'],
  },
  {
    label: 'Pinned Maestro flow contract',
    cwd: mobileRoot,
    cmd: 'node',
    args: ['scripts/maestro-config.test.mjs'],
  },
  {
    label: 'Stable automation selector contract',
    cwd: mobileRoot,
    cmd: 'node',
    args: ['scripts/automation-selector-contract.test.mjs'],
  },
  {
    label: 'Android memory V3 policy contract',
    cwd: mobileRoot,
    cmd: 'node',
    args: ['scripts/android-memory-gate-v3.test.mjs'],
  },
  {
    label: 'Android map-memory gate contract',
    cwd: mobileRoot,
    cmd: 'node',
    args: ['scripts/android-map-memory-gate.test.mjs'],
  },
  {
    label: 'Release worktree publication guard',
    cwd: mobileRoot,
    cmd: 'node',
    args: ['scripts/release-worktree.test.mjs'],
  },
  {
    label: 'Release commit identity',
    cwd: mobileRoot,
    cmd: 'node',
    args: ['scripts/release-identity.test.mjs'],
  },
  {
    label: 'Paired EAS production-build evidence',
    cwd: mobileRoot,
    cmd: 'node',
    args: ['scripts/eas-build-evidence.test.mjs'],
  },
  {
    label: 'Paired EAS update evidence',
    cwd: mobileRoot,
    cmd: 'node',
    args: ['scripts/eas-update-evidence.test.mjs'],
  },
  {
    label: 'Native-compatible production OTA',
    cwd: mobileRoot,
    cmd: 'node',
    args: ['scripts/native-ota-compatibility.test.mjs'],
  },
  {
    label: 'Production runtime-matrix preservation',
    cwd: mobileRoot,
    cmd: 'node',
    args: ['scripts/production-runtime-matrix.test.mjs'],
  },
  {
    label: 'Release environment contract',
    cwd: mobileRoot,
    cmd: 'node',
    args: ['scripts/release-environment.test.mjs'],
  },
  {
    label: 'Isolated backend schema',
    cwd: repoRoot,
    cmd: 'python',
    args: ['-c', 'from db.store import init_db; init_db()'],
    env: prepreviewDbEnvironment,
  },
  {
    label: 'Version-pinned Originals route fixture',
    cwd: mobileRoot,
    cmd: 'node',
    args: ['--import', 'tsx', 'scripts/original-route-fixture.test.ts'],
  },
  {
    label: 'Android Auto debug unit tests',
    cwd: androidRoot,
    cmd: process.platform === 'win32' ? 'gradlew.bat' : './gradlew',
    args: [':app:testDebugUnitTest'],
    env: resolvedAndroidJavaEnvironment(),
  },
  {
    label: 'Mission flyover native/JS smoke',
    cwd: mobileRoot,
    cmd: 'node',
    args: ['scripts/mission-briefing-smoke.mjs'],
  },
  {
    label: 'Plan copy audit',
    cwd: mobileRoot,
    cmd: 'node',
    args: ['scripts/user-facing-copy-audit.mjs'],
  },
  {
    label: 'Plan workspace navigation audit',
    cwd: mobileRoot,
    cmd: 'node',
    args: ['scripts/plan-workspace-regression-audit.mjs'],
  },
  {
    label: 'Mounted-tab lifecycle tests',
    cwd: mobileRoot,
    cmd: 'node',
    args: ['--import', 'tsx', 'lib/__tests__/mobileLifecycle.test.ts'],
  },
  {
    label: 'Map layers and filters routing tests',
    cwd: mobileRoot,
    cmd: 'node',
    args: ['--import', 'tsx', 'lib/__tests__/mapLayersFiltersController.test.ts'],
  },
  {
    label: 'Map layer registry parity tests',
    cwd: mobileRoot,
    cmd: 'node',
    args: ['--import', 'tsx', 'lib/__tests__/mapLayerRegistry.test.ts'],
  },
  {
    label: 'Camp sheet enrichment identity tests',
    cwd: mobileRoot,
    cmd: 'node',
    args: ['--import', 'tsx', 'lib/__tests__/campDetailIdentity.test.ts'],
  },
  {
    label: 'Camp sheet peek, loading, and nested Back contract',
    cwd: mobileRoot,
    cmd: 'node',
    args: ['--import', 'tsx', 'lib/__tests__/campSheetFlowContract.test.ts'],
  },
  {
    label: 'Campground factual brief contract',
    cwd: mobileRoot,
    cmd: 'node',
    args: ['--import', 'tsx', 'lib/__tests__/campgroundBriefV3Contract.test.ts'],
  },
  {
    label: 'Viewport-bounded wildfire overlay tests',
    cwd: mobileRoot,
    cmd: 'npm',
    args: ['run', 'test:fire-overlay'],
  },
  {
    label: 'Sentry privacy, QA guard, and diagnostics tests',
    cwd: mobileRoot,
    cmd: 'npm',
    args: ['run', 'test:telemetry'],
  },
  {
    label: 'Referral link attribution tests',
    cwd: mobileRoot,
    cmd: 'npm',
    args: ['run', 'test:referrals'],
  },
  {
    label: 'Nonessential third-party collection controls',
    cwd: mobileRoot,
    cmd: 'npm',
    args: ['run', 'test:privacy-controls'],
  },
  {
    label: 'Universal and app-link routing tests',
    cwd: mobileRoot,
    cmd: 'node',
    args: ['--import', 'tsx', 'lib/__tests__/appLinks.test.ts'],
  },
  {
    label: 'Offline V2 preservation and runtime tests',
    cwd: mobileRoot,
    cmd: 'npm',
    args: ['run', 'test:offline-v2'],
  },
  {
    label: 'Search V2 session tests',
    cwd: mobileRoot,
    cmd: 'npm',
    args: ['run', 'test:search-v2'],
  },
  {
    label: 'Originals runtime tests',
    cwd: mobileRoot,
    cmd: 'npm',
    args: ['run', 'test:originals'],
  },
  {
    label: 'Explore feed audit',
    cwd: mobileRoot,
    cmd: 'node',
    args: ['scripts/explore-feed-audit.mjs'],
  },
  {
    label: 'Explore detail module registry tests',
    cwd: mobileRoot,
    cmd: 'node',
    args: ['--import', 'tsx', 'lib/__tests__/exploreDetailModuleRegistry.test.ts'],
  },
  {
    label: 'Explore source-level image and pagination guard',
    cwd: mobileRoot,
    cmd: 'npm',
    args: ['run', 'test:explore-memory-guard'],
  },
  {
    label: 'NPS adaptive hub preservation tests',
    cwd: mobileRoot,
    cmd: 'npm',
    args: ['run', 'test:nps-hub-preservation'],
  },
  {
    label: 'Explore live API audit',
    cwd: mobileRoot,
    cmd: 'python',
    args: ['../scripts/audit_explore_live.py'],
    env: prepreviewDbEnvironment,
  },
  {
    label: 'Viator experiences audit',
    cwd: mobileRoot,
    cmd: 'python',
    args: ['../scripts/audit_viator_experiences.py'],
    env: prepreviewDbEnvironment,
  },
  {
    label: 'Explore copy audit',
    cwd: mobileRoot,
    cmd: 'node',
    args: ['scripts/user-facing-copy-audit.mjs', '--preset', 'explore'],
  },
  {
    label: 'Map copy audit',
    cwd: mobileRoot,
    cmd: 'node',
    args: ['scripts/user-facing-copy-audit.mjs', '--preset', 'map'],
  },
  {
    label: 'TypeScript',
    cwd: mobileRoot,
    cmd: 'npx',
    args: ['tsc', '--noEmit'],
    env: { NODE_OPTIONS: '--max-old-space-size=4096' },
  },
  {
    label: 'Full backend regression suite',
    cwd: repoRoot,
    cmd: 'python',
    args: ['-m', 'unittest', 'discover', '-s', 'tests'],
    env: prepreviewDbEnvironment,
  },
  {
    label: 'Whitespace diff check',
    cwd: repoRoot,
    cmd: 'git',
    args: ['diff', '--check'],
  },
];

const failures = [];

function runInlineCheck(label, fn) {
  console.log(`\n== ${label} ==`);
  try {
    fn();
  } catch (error) {
    console.error(error?.message ?? String(error));
    failures.push(label);
  }
}

runInlineCheck('Map WebView bridge guard', () => {
  const mapSource = readFileSync(join(mobileRoot, 'app/(tabs)/map.tsx'), 'utf8');
  if (!mapSource.includes('function postWebMessage(message: string)')) {
    throw new Error('Map screen is missing the safe WebView message bridge.');
  }
  if (mapSource.includes('webRef.current?.postMessage(')) {
    throw new Error('Use postWebMessage(...) instead of calling webRef.current?.postMessage(...) directly.');
  }
  const bridgeFiles = [
    'lib/missionBriefNativePlayer.ts',
    'lib/missionBriefPlayback.ts',
  ];
  for (const file of bridgeFiles) {
    const source = readFileSync(join(mobileRoot, file), 'utf8');
    if (source.includes('webRef.current?.postMessage(')) {
      throw new Error(`${file} calls webRef.current?.postMessage directly.`);
    }
    if (!source.includes("typeof postMessage !== 'function'")) {
      throw new Error(`${file} is missing a WebView postMessage function guard.`);
    }
  }
});

for (const check of checks) {
  console.log(`\n== ${check.label} ==`);
  const result = spawnSync(check.cmd, check.args, {
    cwd: check.cwd,
    env: { ...process.env, ...(check.env ?? {}) },
    stdio: 'inherit',
  });
  if (result.status !== 0) failures.push(check.label);
}

rmSync(prepreviewDbRoot, { recursive: true, force: true });

if (failures.length) {
  console.error(`\nPre-preview checks failed: ${failures.join(', ')}`);
  process.exit(1);
}

console.log('\nPre-preview JS and native-boundary checks passed.');
console.log('Before a paid preview build, run this native gate from normal WSL:');
console.log('cd mobile/android && JAVA_HOME=/home/sean/.local/share/jdks/temurin-17 ./gradlew :app:assembleDebug');
