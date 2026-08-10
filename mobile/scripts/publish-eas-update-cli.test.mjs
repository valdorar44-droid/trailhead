import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const publisher = readFileSync(new URL('./publish-eas-update.mjs', import.meta.url), 'utf8');
const sentryUploader = readFileSync(new URL('./upload-sentry-update-sourcemaps.mjs', import.meta.url), 'utf8');
const updateList = publisher.match(/'update:list',[\s\S]*?'--limit',\s*'(\d+)'/);

assert.ok(updateList, 'publisher must query the isolated candidate branch');
const limit = Number(updateList[1]);
assert.ok(limit >= 1 && limit <= 50, 'EAS update:list limit must stay within the CLI-supported 1–50 range');

assert.match(publisher, /\{ platform: 'android', inputDir: 'dist-android' \}/);
assert.match(publisher, /\{ platform: 'ios', inputDir: 'dist-ios' \}/);
assert.match(publisher, /'--platform', stage\.platform/);
assert.match(publisher, /'--input-dir', stage\.inputDir/);
assert.doesNotMatch(publisher, /'--platform', 'all',[\s\S]{0,240}'expo', 'export'/);
const nativeStageLoop = publisher.match(
  /for \(const \[index, stage\] of nativeReleaseStages\.entries\(\)\) \{([\s\S]*?)\n\}\nif \(productionSnapshot\)/,
);
assert.ok(nativeStageLoop, 'publisher must use one bounded native platform loop');
const nativeStageBody = nativeStageLoop[1];
const nativeExport = nativeStageBody.indexOf("'expo', 'export'");
const stagedSentryUpload = nativeStageBody.indexOf(
  "'scripts/upload-sentry-update-sourcemaps.mjs',\n    '--input-dir', stage.inputDir",
);
const stagedUpdatePublish = nativeStageBody.indexOf("run('npx', updateArgsFor(stage)");
assert.ok(
  nativeExport >= 0
    && stagedSentryUpload > nativeExport
    && stagedUpdatePublish > stagedSentryUpload,
  'each native export must be uploaded to Sentry and published before the next platform starts',
);
assert.doesNotMatch(
  publisher,
  /for \(const stage of nativeReleaseStages\)/,
  'native export, Sentry upload, and candidate publication must not be split across loops',
);
assert.match(sentryUploader, /process\.argv\.indexOf\('--input-dir'\)/);
assert.match(sentryUploader, /Cannot upload OTA source maps outside the mobile project/);
assert.match(sentryUploader, /spawnSync\(cli, \[relativeInputDir\]/);

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRelative = `scripts/.source-map-fixture-${process.pid}`;
const fixtureDirectory = join(mobileRoot, fixtureRelative);
mkdirSync(fixtureDirectory, { recursive: true });
try {
  writeFileSync(join(fixtureDirectory, 'index.js'), 'console.log("fixture");\n', 'utf8');
  writeFileSync(join(fixtureDirectory, 'index.js.map'), '{}\n', 'utf8');
  const fixtureCheck = spawnSync(process.execPath, [
    'scripts/upload-sentry-update-sourcemaps.mjs',
    '--check-files',
    '--input-dir', fixtureRelative,
  ], { cwd: mobileRoot, encoding: 'utf8' });
  assert.equal(fixtureCheck.status, 0, fixtureCheck.stderr);

  const traversalCheck = spawnSync(process.execPath, [
    'scripts/upload-sentry-update-sourcemaps.mjs',
    '--check-files',
    '--input-dir', '../outside-mobile',
  ], { cwd: mobileRoot, encoding: 'utf8' });
  assert.notEqual(traversalCheck.status, 0, 'Sentry uploader must reject input directories outside mobile');
  assert.match(traversalCheck.stderr, /outside the mobile project/);

  const missingValueCheck = spawnSync(process.execPath, [
    'scripts/upload-sentry-update-sourcemaps.mjs',
    '--check-files',
    '--input-dir',
  ], { cwd: mobileRoot, encoding: 'utf8' });
  assert.notEqual(missingValueCheck.status, 0, 'Sentry uploader must reject a missing --input-dir value');
  assert.match(missingValueCheck.stderr, /requires a directory/);
} finally {
  rmSync(fixtureDirectory, { recursive: true, force: true });
}

console.log('Production publisher CLI contract tests passed.');
