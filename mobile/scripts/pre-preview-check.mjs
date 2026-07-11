#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(mobileRoot, '..');

const checks = [
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
    label: 'Explore feed audit',
    cwd: mobileRoot,
    cmd: 'node',
    args: ['scripts/explore-feed-audit.mjs'],
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
    label: 'Storyboard and Co-Pilot bridge tests',
    cwd: repoRoot,
    cmd: 'python',
    args: ['-m', 'unittest', 'tests.test_mission_storyboard', 'tests.test_copilot_tool_bridge'],
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
