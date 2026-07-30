import assert from 'node:assert/strict';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(scriptsDir, '..');
const packageJsonPath = path.join(mobileRoot, 'package.json');
const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));

const localModules = Object.entries(packageJson.dependencies ?? {})
  .filter(([, spec]) => typeof spec === 'string' && spec.startsWith('file:./modules/'));

assert.ok(localModules.length > 0, 'Expected at least one tracked local Expo module.');

const results = [];
for (const [packageName, spec] of localModules) {
  const relativeModulePath = spec.slice('file:'.length);
  const expectedModulePath = path.resolve(mobileRoot, relativeModulePath);
  const installedModulePath = path.join(mobileRoot, 'node_modules', packageName);

  const [expectedRealPath, installedRealPath] = await Promise.all([
    realpath(expectedModulePath),
    realpath(installedModulePath),
  ]);

  assert.equal(
    installedRealPath,
    expectedRealPath,
    `${packageName} resolves outside this release worktree: ${installedRealPath}`,
  );

  const installedPackage = JSON.parse(
    await readFile(path.join(installedModulePath, 'package.json'), 'utf8'),
  );
  assert.equal(installedPackage.name, packageName, `${packageName} package identity mismatch.`);

  const entry = installedPackage.main ?? installedPackage.module ?? 'index.js';
  const entryPath = path.resolve(installedModulePath, entry);
  assert.ok((await stat(entryPath)).isFile(), `${packageName} entry file is missing: ${entry}`);

  results.push(`${packageName} -> ${path.relative(mobileRoot, installedRealPath)}`);
}

console.log(`Local Expo module resolution passed (${results.length}/${results.length}).`);
for (const result of results) console.log(`  ${result}`);
