#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(mobileRoot, '..');
const androidRoot = join(mobileRoot, 'android');

function resolvedAndroidJavaEnvironment() {
  const candidates = [
    process.env.JAVA_HOME,
    join(homedir(), '.local', 'share', 'jdks', 'temurin-17'),
    '/usr/lib/jvm/java-17-openjdk-amd64',
    '/usr/lib/jvm/temurin-17-jdk-amd64',
  ].filter(Boolean);
  const javaHome = candidates.find(candidate => (
    existsSync(join(candidate, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'))
  ));
  if (!javaHome) return {};
  return {
    JAVA_HOME: javaHome,
    PATH: `${join(javaHome, 'bin')}${delimiter}${process.env.PATH ?? ''}`,
  };
}

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
    label: 'Release environment contract',
    cwd: mobileRoot,
    cmd: 'node',
    args: ['scripts/release-environment.test.mjs'],
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
    label: 'Explore source-level image and pagination guard',
    cwd: mobileRoot,
    cmd: 'node',
    args: ['scripts/explore-memory-guard.test.mjs'],
  },
  {
    label: 'Explore live API audit',
    cwd: mobileRoot,
    cmd: 'python',
    args: ['../scripts/audit_explore_live.py'],
  },
  {
    label: 'Viator experiences audit',
    cwd: mobileRoot,
    cmd: 'python',
    args: ['../scripts/audit_viator_experiences.py'],
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

if (failures.length) {
  console.error(`\nPre-preview checks failed: ${failures.join(', ')}`);
  process.exit(1);
}

console.log('\nPre-preview JS and native-boundary checks passed.');
console.log('Before a paid preview build, run this native gate from normal WSL:');
console.log('cd mobile/android && JAVA_HOME=/home/sean/.local/share/jdks/temurin-17 ./gradlew :app:assembleDebug');
