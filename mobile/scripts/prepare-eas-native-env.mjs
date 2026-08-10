#!/usr/bin/env node
const platform = String(process.env.EAS_BUILD_PLATFORM || '').toLowerCase();

if (platform !== 'android' && platform !== 'ios') {
  console.log('Native build environment preparation skipped outside EAS.');
  process.exit(0);
}

const required = [
  'EXPO_PUBLIC_SENTRY_DSN',
  'SENTRY_AUTH_TOKEN',
  'SENTRY_ORG',
  'SENTRY_PROJECT',
  ...(platform === 'android' ? ['GOOGLE_MAPS_API_KEY'] : []),
];
const missing = required.filter(name => !String(process.env[name] || '').trim());
if (missing.length) {
  throw new Error(`Missing EAS environment values for ${platform}: ${missing.join(', ')}`);
}

console.log(`Native ${platform} build environment is complete.`);
