/**
 * Mapbox's native telemetry API does not exist in the web bundle. Keeping this
 * as a platform file also prevents Metro from pulling native Mapbox CSS into
 * the Trailhead web export through the root store.
 */
export async function disableNonessentialMapboxTelemetry(_accessToken: string): Promise<void> {}

export function resetMapboxTelemetryGuardForTests(): void {}
