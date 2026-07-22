import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { fullGitSha, resolveReleaseCommitSha } = require('./release-identity.cjs');

const eas = 'a'.repeat(40);
const github = 'b'.repeat(40);
const explicit = 'c'.repeat(40);

assert.equal(fullGitSha('abc1234'), '');
assert.equal(fullGitSha(` ${eas.toUpperCase()} `), eas);
assert.equal(resolveReleaseCommitSha({
  EAS_BUILD_GIT_COMMIT_HASH: eas,
  GITHUB_SHA: github,
  EXPO_PUBLIC_RELEASE_COMMIT_SHA: explicit,
}), eas, 'EAS identity must outrank mutable project/update values');
assert.equal(resolveReleaseCommitSha({
  GITHUB_SHA: github,
  EXPO_PUBLIC_RELEASE_COMMIT_SHA: explicit,
}), github, 'GitHub identity must outrank the explicit local publisher value');
assert.equal(resolveReleaseCommitSha({ EXPO_PUBLIC_RELEASE_COMMIT_SHA: explicit }), explicit);
assert.equal(resolveReleaseCommitSha({ EXPO_PUBLIC_RELEASE_COMMIT_SHA: 'deadbee' }), 'unknown');

console.log('Release commit identity tests passed.');
