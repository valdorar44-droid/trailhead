import { Platform } from 'react-native';

let configured = false;

/**
 * Trailhead uses Mapbox for requested map, Search and navigation operations,
 * but does not enable Mapbox's separate product-improvement telemetry stream.
 * This is deliberately not a user preference: keeping it off ensures the
 * production privacy declaration remains stable and avoids nonessential
 * third-party collection.
 */
export async function disableNonessentialMapboxTelemetry(): Promise<void> {
  if (configured || (Platform.OS !== 'android' && Platform.OS !== 'ios')) return;
  configured = true;
  try {
    const module = await import('@rnmapbox/maps');
    module.default.setTelemetryEnabled(false);
  } catch {
    // Mapbox is not present on web and can be unavailable during isolated tests.
    // Fail closed: no fallback telemetry implementation is started.
  }
}

export function resetMapboxTelemetryGuardForTests(): void {
  configured = false;
}
