'use strict';

const FULL_GIT_SHA = /^[a-f0-9]{40}$/i;

function fullGitSha(value) {
  const candidate = String(value || '').trim();
  return FULL_GIT_SHA.test(candidate) ? candidate.toLowerCase() : '';
}

/**
 * EAS and GitHub provide source-controlled identities. The explicit value is
 * reserved for the guarded local OTA publisher and must never override them.
 */
function resolveReleaseCommitSha(environment = process.env) {
  return fullGitSha(environment.EAS_BUILD_GIT_COMMIT_HASH)
    || fullGitSha(environment.GITHUB_SHA)
    || fullGitSha(environment.EXPO_PUBLIC_RELEASE_COMMIT_SHA)
    || 'unknown';
}

module.exports = { fullGitSha, resolveReleaseCommitSha };
