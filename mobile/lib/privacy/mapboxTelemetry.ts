/**
 * Non-native fallback used by TypeScript and non-Metro tooling. Metro selects
 * mapboxTelemetry.native.ts on Android/iOS and mapboxTelemetry.web.ts on web.
 */
export async function disableNonessentialMapboxTelemetry(_accessToken: string): Promise<void> {}

export function resetMapboxTelemetryGuardForTests(): void {}
