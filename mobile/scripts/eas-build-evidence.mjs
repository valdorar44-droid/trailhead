import { spawnSync } from 'node:child_process';

function requiredText(value, label) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`Missing ${label}.`);
  return text;
}

export function validateProductionBuild(build, expected) {
  const label = expected.platform.toLowerCase();
  const failures = [];
  const check = (condition, message) => {
    if (!condition) failures.push(message);
  };

  check(build?.id === expected.id, `${label} build ID does not match.`);
  check(build?.status === 'FINISHED', `${label} build is not FINISHED.`);
  check(build?.platform === expected.platform, `${label} build platform is not ${expected.platform}.`);
  check(build?.distribution === 'STORE', `${label} build is not a store distribution.`);
  check(build?.buildProfile === 'production', `${label} build profile is not production.`);
  check(build?.channel === 'production', `${label} build channel is not production.`);
  check(build?.gitCommitHash === expected.commitSha, `${label} build SHA does not match the release SHA.`);
  check(build?.runtimeVersion === expected.runtimeVersion, `${label} runtime does not match app config.`);
  check(build?.appVersion === expected.appVersion, `${label} marketing version does not match.`);
  check(build?.project?.id === expected.projectId, `${label} build belongs to a different EAS project.`);
  check(Boolean(build?.artifacts?.applicationArchiveUrl), `${label} build archive is missing.`);
  check(Boolean(build?.fingerprint?.hash), `${label} native fingerprint is missing.`);
  check(/^\d+$/.test(String(build?.appBuildVersion || '')), `${label} build number is missing.`);

  if (failures.length) throw new Error(failures.join(' '));
  return {
    buildId: build.id,
    buildNumber: String(build.appBuildVersion),
    commitSha: build.gitCommitHash,
    fingerprint: build.fingerprint.hash,
    platform: build.platform,
    runtimeVersion: build.runtimeVersion,
  };
}

function commandName(name) {
  return process.platform === 'win32' && name === 'npx' ? 'npx.cmd' : name;
}

export function fetchEasBuild(buildId) {
  const result = spawnSync(commandName('npx'), [
    '--yes', 'eas-cli@21.0.2', 'build:view', buildId, '--json',
  ], {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Unable to verify EAS build ${buildId}.`);
  }
  try {
    return JSON.parse(String(result.stdout || '').trim());
  } catch {
    throw new Error(`EAS build ${buildId} returned invalid JSON.`);
  }
}

export function verifyPairedProductionBuilds({ appConfig, packageJson, environment = process.env }) {
  const releaseSha = requiredText(environment.EXPO_PUBLIC_RELEASE_COMMIT_SHA, 'release commit SHA');
  if (!/^[a-f0-9]{40}$/i.test(releaseSha)) throw new Error('Release commit SHA must be a full Git SHA.');
  const androidBuildSha = requiredText(environment.TRAILHEAD_ANDROID_PRODUCTION_BUILD_SHA, 'Android production build SHA');
  const iosBuildSha = requiredText(environment.TRAILHEAD_IOS_PRODUCTION_BUILD_SHA, 'iOS production build SHA');
  if (androidBuildSha !== iosBuildSha) throw new Error('Android and iOS production builds must share one source SHA.');
  if (!/^[a-f0-9]{40}$/i.test(androidBuildSha)) throw new Error('Production build SHA must be a full Git SHA.');
  const projectId = requiredText(appConfig?.extra?.eas?.projectId, 'EAS project ID');
  const androidId = requiredText(environment.TRAILHEAD_ANDROID_PRODUCTION_BUILD_ID, 'Android production build ID');
  const iosId = requiredText(environment.TRAILHEAD_IOS_PRODUCTION_BUILD_ID, 'iOS production build ID');
  if (androidId === iosId) throw new Error('Android and iOS production build IDs must be distinct.');

  const common = { appVersion: packageJson.version, commitSha: androidBuildSha, projectId };
  const android = validateProductionBuild(fetchEasBuild(androidId), {
    ...common,
    id: androidId,
    platform: 'ANDROID',
    runtimeVersion: appConfig.android.runtimeVersion,
  });
  const ios = validateProductionBuild(fetchEasBuild(iosId), {
    ...common,
    id: iosId,
    platform: 'IOS',
    runtimeVersion: appConfig.ios.runtimeVersion,
  });
  return { android, ios, buildSha: androidBuildSha, releaseSha };
}
