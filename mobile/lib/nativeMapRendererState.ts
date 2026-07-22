export type ActiveNativeMapRenderer = 'maplibre' | 'rnmapbox';

let activeRenderer: ActiveNativeMapRenderer | null = null;

export function setActiveNativeMapRenderer(renderer: ActiveNativeMapRenderer) {
  activeRenderer = renderer;
}

export function getActiveNativeMapRenderer() {
  return activeRenderer;
}

/**
 * Resolve the renderer the main map will mount. The Map screen writes the
 * authoritative in-memory value when credentials settle; the cached token is
 * the cold-start fallback used by root-mounted Originals bundle verification.
 */
export async function resolveActiveNativeMapRenderer(
  readCachedToken: () => Promise<string | null> = async () => {
    const { storage } = await import('./storage');
    return storage.get('trailhead_mapbox_token');
  },
): Promise<ActiveNativeMapRenderer> {
  if (activeRenderer) return activeRenderer;
  const token = await readCachedToken().catch(() => null);
  return token ? 'rnmapbox' : 'maplibre';
}

export function resetActiveNativeMapRendererForTests() {
  activeRenderer = null;
}
