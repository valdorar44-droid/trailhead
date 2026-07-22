const APPROVED_RNMAPBOX_OFFLINE_STYLES = new Set([
  'standard',
  'standard_satellite',
  'satellite_streets',
  'streets',
  'outdoors',
  'navigation_day',
  'navigation_night',
]);

/**
 * Returns the server-approved style that is byte-for-byte representative of
 * the visible physical map. Trailhead's custom non-extreme styles deliberately
 * return null and continue through the legacy downloader.
 */
export function resolveActiveOfflineRendererStyleId(
  mapLayer: string,
  premiumStyle: string,
): string | null {
  if (mapLayer !== 'extreme') return null;
  const normalized = premiumStyle === 'dawn' || premiumStyle === 'dusk' || premiumStyle === 'night'
    ? 'standard'
    : premiumStyle;
  return APPROVED_RNMAPBOX_OFFLINE_STYLES.has(normalized) ? normalized : null;
}
