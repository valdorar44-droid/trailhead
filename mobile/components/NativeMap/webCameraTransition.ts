type WebCamera = Record<string, unknown>;

type WebMapCamera = {
  easeTo?: (camera: WebCamera) => unknown;
  flyTo?: (camera: WebCamera) => unknown;
};

/**
 * Keep high-frequency flyover retargets on a direct easing path. Repeated
 * Mapbox flyTo arcs can lift a pitched globe camera past the visible ground.
 */
export function applyWebCameraTransition(
  map: WebMapCamera,
  camera: WebCamera,
  mode?: string,
): 'easeTo' | 'flyTo' {
  if ((mode === 'linearTo' || mode === 'easeTo') && typeof map.easeTo === 'function') {
    map.easeTo(mode === 'linearTo' ? { ...camera, easing: (progress: number) => progress } : camera);
    return 'easeTo';
  }
  map.flyTo?.(camera);
  return 'flyTo';
}
