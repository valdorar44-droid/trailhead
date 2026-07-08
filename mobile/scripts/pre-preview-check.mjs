#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
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
    label: 'Visible copy audit',
    cwd: mobileRoot,
    cmd: 'node',
    args: ['scripts/user-facing-copy-audit.mjs'],
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
