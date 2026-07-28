import type { OfflineBundleInstallationV2, OfflineBundleManifestV2 } from './types';

export function resolveRnMapboxOfflinePackReadiness(input: Readonly<{
  manifest: OfflineBundleManifestV2;
  installation: OfflineBundleInstallationV2['renderer'];
  pack_exists: boolean;
  percentage: number;
  metadata: Readonly<Record<string, unknown>>;
}>) {
  const { manifest, installation } = input;
  const identityReady = Boolean(input.pack_exists
    && input.metadata.manifest_sha256 === manifest.manifest_sha256
    && input.metadata.style_id === manifest.renderer.style_id
    && input.metadata.style_uri === manifest.renderer.style_uri
    && input.metadata.style_revision === manifest.renderer.style_revision);
  const resourcesReady = identityReady && Number(input.percentage || 0) >= 100;
  const styleReady = resourcesReady
    && installation.style_pack_id === manifest.renderer.style_pack_id;
  const tilesReady = resourcesReady
    && installation.tile_region_id === manifest.renderer.tile_region_id;

  // This identity-bound status comes from RNMapbox's active native
  // OfflineManager. A separate Snapshotter can fetch online style resources,
  // so it cannot prove that this immutable offline pack is usable.
  const rendererProbeReady = styleReady && tilesReady;
  const diagnostics: string[] = [];
  if (!identityReady) diagnostics.push('The RNMapbox pack identity does not match the manifest.');
  else if (!resourcesReady) diagnostics.push('The RNMapbox offline map is incomplete.');
  if (!styleReady) diagnostics.push('The RNMapbox style pack is incomplete.');
  if (!tilesReady) diagnostics.push('The RNMapbox tile region is incomplete.');
  return Object.freeze({
    ready: rendererProbeReady,
    style_ready: styleReady,
    tiles_ready: tilesReady,
    render_probe_ready: rendererProbeReady,
    diagnostics: Object.freeze(diagnostics),
  });
}
