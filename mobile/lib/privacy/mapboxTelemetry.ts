import { Platform } from 'react-native';

let configured = false;

/**
 * Trailhead uses Mapbox for requested map, Search and navigation operations,
 * but does not enable Mapbox's separate product-improvement telemetry stream.
 * This is deliberately not a user preference: keeping it off ensures the
 * production privacy declaration remains stable and avoids nonessential
 * third-party collection.
 */
export async function disableNonessentialMapboxTelemetry(accessToken: string): Promise<void> {
  if (configured || (Platform.OS !== 'android' && Platform.OS !== 'ios')) return;
  const token = accessToken.trim();
  if (!token) return;
  try {
    const module = await import('@rnmapbox/maps');
    await module.default.setAccessToken(token);
    module.default.setTelemetryEnabled(false);
    configured = true;
  } catch {
    // Mapbox is not present on web and can be unavailable during isolated tests.
    // Leave the guard retryable until a valid native token has been configured.
  }
}

export function resetMapboxTelemetryGuardForTests(): void {
  configured = false;
}
