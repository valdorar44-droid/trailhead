const REQUIRED_RELEASE_VALUES = [
  'EXPO_PUBLIC_SENTRY_DSN',
  'SENTRY_AUTH_TOKEN',
  'SENTRY_ORG',
  'SENTRY_PROJECT',
];

export function validateReleaseEnvironment(
  environment = process.env,
  { requireNativeDownloadsToken = false } = {},
) {
  const required = requireNativeDownloadsToken
    ? [...REQUIRED_RELEASE_VALUES, 'RNMAPBOX_MAPS_DOWNLOAD_TOKEN']
    : REQUIRED_RELEASE_VALUES;
  const missing = required.filter(name => !String(environment[name] || '').trim());
  if (missing.length) throw new Error(`Release environment is incomplete. Missing: ${missing.join(', ')}`);

  let dsn;
  try {
    dsn = new URL(String(environment.EXPO_PUBLIC_SENTRY_DSN));
  } catch {
    throw new Error('EXPO_PUBLIC_SENTRY_DSN is not a valid URL.');
  }
  if (dsn.protocol !== 'https:' || !dsn.username || !dsn.hostname || dsn.pathname === '/') {
    throw new Error('EXPO_PUBLIC_SENTRY_DSN is not a valid HTTPS project DSN.');
  }
  return { ready: true };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  validateReleaseEnvironment(process.env, {
    requireNativeDownloadsToken: process.argv.includes('--native-gate'),
  });
  console.log('Release environment is ready.');
}
