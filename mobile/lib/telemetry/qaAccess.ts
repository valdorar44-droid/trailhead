export type TelemetryQaAccess = 'pending' | 'allowed' | 'redirect';

export function resolveTelemetryQaAccess(input: {
  authHydrated: boolean;
  navigationReady: boolean;
  surfaceAllowed: boolean;
}): TelemetryQaAccess {
  if (!input.authHydrated || !input.navigationReady) return 'pending';
  return input.surfaceAllowed ? 'allowed' : 'redirect';
}
