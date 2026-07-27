import Mapbox from '@rnmapbox/maps';

let configured = false;

/**
 * Trailhead uses Mapbox for requested map, Search and navigation operations,
 * but does not enable Mapbox's separate product-improvement telemetry stream.
 * The access token must be configured before calling the native telemetry API.
 */
export async function disableNonessentialMapboxTelemetry(accessToken: string): Promise<void> {
  if (configured) return;
  const token = accessToken.trim();
  if (!token) return;
  try {
    await Mapbox.setAccessToken(token);
    Mapbox.setTelemetryEnabled(false);
    configured = true;
  } catch {
    // Leave the guard retryable until native Mapbox accepts a valid token.
  }
}

export function resetMapboxTelemetryGuardForTests(): void {
  configured = false;
}
