import type { OfflineRendererDownloadAdapter } from './coordinator';
import type { OfflineBundleManifestV2 } from './types';

function safe(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 52);
}

export function rnMapboxPackName(manifest: Pick<OfflineBundleManifestV2, 'bundle_id' | 'revision'>) {
  return `trailhead-v2-${safe(manifest.bundle_id)}-${safe(manifest.revision)}`.slice(0, 110);
}

const unavailable = 'Offline map downloads are available in the Trailhead mobile app.';

/**
 * RNMapbox has no browser offline-pack implementation. Keep the web bundle
 * free of native Mapbox imports and report the capability honestly.
 */
export function createRnMapboxOfflineDownloadAdapter(): OfflineRendererDownloadAdapter {
  return {
    renderer: 'rnmapbox',
    async prepare() {
      throw new Error(unavailable);
    },
    async inspect() {
      return {
        renderer: 'rnmapbox',
        ready: false,
        style_ready: false,
        tiles_ready: false,
        render_probe_ready: false,
        diagnostics: [unavailable],
      };
    },
    async pause() {},
    async resume() {},
    async remove() {},
  };
}
