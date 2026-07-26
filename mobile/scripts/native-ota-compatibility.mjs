import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MOBILE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(MOBILE_ROOT, '..');
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'overrides',
  'resolutions',
];

const NATIVE_PATHS = [
  /^mobile\/android\//,
  /^mobile\/ios\//,
  /^mobile\/(?:app\.config\.(?:js|ts)|app\.json|eas\.json)$/,
  /^mobile\/(?:plugins|modules|patches)\//,
  /^mobile\/react-native\.config\.(?:js|cjs|mjs|ts)$/,
  /^mobile\/assets\/(?:fonts\/|icon\.|adaptive-icon\.|splash\.)/,
  /^mobile\/(?:Podfile|Gemfile|gradle\.properties)$/,
];

function commandName(name) {
  return process.platform === 'win32' && name === 'npx' ? 'npx.cmd' : name;
}

function run(command, args, options = {}) {
  const result = spawnSync(commandName(command), args, {
    cwd: options.cwd || REPO_ROOT,
    env: options.env || process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new Error(`${options.label || command} failed${detail ? `: ${detail}` : ''}`);
  }
  return String(result.stdout || '');
}

function git(args) {
  return run('git', ['-C', REPO_ROOT, ...args], { label: `git ${args[0]}` }).trim();
}

function sourceKey(source) {
  if (source?.filePath) return `${source.type}:${source.filePath}`;
  if (source?.id) return `${source.type}:${source.id}`;
  return `${source?.type || 'unknown'}:${source?.hash || 'missing'}`;
}

export function parseFingerprintComparison(output) {
  const text = String(output || '');
  const start = text.indexOf('{');
  if (start < 0) throw new Error('EAS fingerprint comparison did not return JSON evidence.');
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start));
  } catch {
    throw new Error('EAS fingerprint comparison returned invalid JSON evidence.');
  }
  if (!parsed?.fingerprint1?.hash || !parsed?.fingerprint2?.hash) {
    throw new Error('EAS fingerprint comparison is missing build or local hashes.');
  }
  return parsed;
}

export function fingerprintSourceDifferences(comparison) {
  const build = new Map((comparison?.fingerprint1?.sources || []).map(source => [sourceKey(source), source.hash]));
  const local = new Map((comparison?.fingerprint2?.sources || []).map(source => [sourceKey(source), source.hash]));
  return [...new Set([...build.keys(), ...local.keys()])]
    .filter(key => build.get(key) !== local.get(key))
    .sort()
    .map(key => ({ source: key, build: build.get(key) || null, local: local.get(key) || null }));
}

export function assertAllowedFingerprintDifferences(differences, platform) {
  const allowed = new Set([
    'contents:expoConfig',
    'contents:packageJson:scripts',
    `dir:${platform}`,
  ]);
  const unexplained = differences.filter(difference => !allowed.has(difference.source));
  if (unexplained.length) {
    throw new Error(`Unexplained ${platform} native fingerprint differences: ${unexplained.map(item => item.source).join(', ')}`);
  }
  return differences;
}

function packageAt(ref) {
  const text = git(['show', `${ref}:mobile/package.json`]);
  return JSON.parse(text);
}

export function dependencyDifferences(before, after) {
  return DEPENDENCY_FIELDS.filter(field => JSON.stringify(before?.[field] || {}) !== JSON.stringify(after?.[field] || {}));
}

export function nativeImpactingPaths(paths) {
  return paths.filter(path => NATIVE_PATHS.some(pattern => pattern.test(path)));
}

export function validateJsOnlySourceDiff({ changedPaths, buildPackage, releasePackage }) {
  const blockedPaths = nativeImpactingPaths(changedPaths);
  if (blockedPaths.length) {
    throw new Error(`Production OTA changes native inputs: ${blockedPaths.join(', ')}`);
  }
  const dependencyFields = dependencyDifferences(buildPackage, releasePackage);
  if (dependencyFields.length) {
    throw new Error(`Production OTA changes dependency fields: ${dependencyFields.join(', ')}`);
  }
  return {
    changedPaths: [...changedPaths],
    dependencyFields,
    packageScriptsChanged: JSON.stringify(buildPackage?.scripts || {}) !== JSON.stringify(releasePackage?.scripts || {}),
  };
}

function assertGitTreeEqual(buildSha, releaseSha, path) {
  const before = git(['rev-parse', `${buildSha}:${path}`]);
  const after = git(['rev-parse', `${releaseSha}:${path}`]);
  if (before !== after) throw new Error(`Production OTA changes ${path}.`);
  return before;
}

function compareBuildFingerprint({ buildId, platform, evidenceDir, environment }) {
  const output = run('npx', [
    '--yes',
    'eas-cli@21.0.2',
    'fingerprint:compare',
    '--build-id',
    buildId,
    '--environment',
    'production',
    '--json',
    '--non-interactive',
  ], {
    cwd: MOBILE_ROOT,
    env: environment,
    label: `${platform} fingerprint comparison`,
  });
  mkdirSync(evidenceDir, { recursive: true });
  const evidencePath = resolve(evidenceDir, `native-fingerprint-${platform}.json`);
  writeFileSync(evidencePath, output, 'utf8');
  const comparison = parseFingerprintComparison(output);
  const differences = fingerprintSourceDifferences(comparison);
  assertAllowedFingerprintDifferences(differences, platform);
  return {
    buildFingerprint: comparison.fingerprint1.hash,
    localFingerprint: comparison.fingerprint2.hash,
    differences,
    evidencePath,
  };
}

export function verifyJsOnlyProductionCompatibility({
  buildSha,
  releaseSha,
  androidBuildId,
  iosBuildId,
  evidenceDir = resolve(MOBILE_ROOT, 'dist', 'release-evidence'),
  environment = process.env,
}) {
  if (!/^[a-f0-9]{40}$/i.test(buildSha) || !/^[a-f0-9]{40}$/i.test(releaseSha)) {
    throw new Error('Build and release SHAs must be full Git revisions.');
  }
  const ancestry = spawnSync('git', ['-C', REPO_ROOT, 'merge-base', '--is-ancestor', buildSha, releaseSha]);
  if (ancestry.status !== 0) throw new Error('Production build SHA is not an ancestor of the OTA source.');

  const changedPaths = git(['diff', '--name-only', `${buildSha}..${releaseSha}`]).split(/\r?\n/).filter(Boolean);
  const source = validateJsOnlySourceDiff({
    changedPaths,
    buildPackage: packageAt(buildSha),
    releasePackage: packageAt(releaseSha),
  });
  const nativeTrees = {
    android: assertGitTreeEqual(buildSha, releaseSha, 'mobile/android'),
    ios: assertGitTreeEqual(buildSha, releaseSha, 'mobile/ios'),
  };
  const fingerprints = {
    android: compareBuildFingerprint({ buildId: androidBuildId, platform: 'android', evidenceDir, environment }),
    ios: compareBuildFingerprint({ buildId: iosBuildId, platform: 'ios', evidenceDir, environment }),
  };
  const evidence = {
    buildSha,
    releaseSha,
    source,
    nativeTrees,
    fingerprints,
  };
  const summaryPath = resolve(evidenceDir, 'native-ota-compatibility.json');
  writeFileSync(summaryPath, JSON.stringify(evidence, null, 2), 'utf8');
  return { ...evidence, summaryPath };
}

export function readPackageForTest(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
