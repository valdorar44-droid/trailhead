import type {
  OfflineBundleInstallationV2,
  OfflineBundleManifestV2,
  OfflineMapRenderer,
} from './types';

export type OfflineRendererReadiness = Readonly<{
  renderer: OfflineMapRenderer;
  ready: boolean;
  style_ready: boolean;
  tiles_ready: boolean;
  render_probe_ready: boolean;
  diagnostics: readonly string[];
}>;

export interface OfflineRendererReadinessAdapter {
  readonly renderer: OfflineMapRenderer;
  inspect(
    manifest: OfflineBundleManifestV2,
    installation: OfflineBundleInstallationV2['renderer'],
  ): Promise<OfflineRendererReadiness>;
}

export type RnMapboxReadinessSource = Readonly<{
  isStylePackReady(stylePackId: string, styleRevision: string): Promise<boolean>;
  isTileRegionReady(tileRegionId: string): Promise<boolean>;
  probeRender(manifest: OfflineBundleManifestV2): Promise<boolean>;
}>;

export function createRnMapboxReadinessAdapter(
  source: RnMapboxReadinessSource,
): OfflineRendererReadinessAdapter {
  return {
    renderer: 'rnmapbox',
    async inspect(manifest, installation) {
      const diagnostics: string[] = [];
      if (manifest.renderer.id !== 'rnmapbox' || installation.renderer !== 'rnmapbox') {
        return {
          renderer: 'rnmapbox', ready: false, style_ready: false, tiles_ready: false,
          render_probe_ready: false, diagnostics: ['The installed map uses a different renderer.'],
        };
      }
      if (installation.style_pack_id !== manifest.renderer.style_pack_id) {
        diagnostics.push('The installed style pack does not match the manifest.');
      }
      if (installation.tile_region_id !== manifest.renderer.tile_region_id) {
        diagnostics.push('The installed tile region does not match the manifest.');
      }
      const [styleReady, tilesReady] = await Promise.all([
        installation.style_pack_id === manifest.renderer.style_pack_id
          ? source.isStylePackReady(manifest.renderer.style_pack_id, manifest.renderer.style_revision).catch(() => false)
          : false,
        installation.tile_region_id === manifest.renderer.tile_region_id
          ? source.isTileRegionReady(manifest.renderer.tile_region_id).catch(() => false)
          : false,
      ]);
      if (!styleReady) diagnostics.push('The RNMapbox style pack is incomplete.');
      if (!tilesReady) diagnostics.push('The RNMapbox tile region is incomplete.');
      const probeReady = styleReady && tilesReady
        ? await source.probeRender(manifest).catch(() => false)
        : false;
      if (styleReady && tilesReady && !probeReady) diagnostics.push('The active renderer probe failed.');
      return {
        renderer: 'rnmapbox',
        ready: styleReady && tilesReady && probeReady,
        style_ready: styleReady,
        tiles_ready: tilesReady,
        render_probe_ready: probeReady,
        diagnostics,
      };
    },
  };
}

export type MapLibrePackStatus = Readonly<{
  percentage: number;
  error?: string;
}>;

export type MapLibreReadinessSource = Readonly<{
  getPackStatus(packName: string): Promise<MapLibrePackStatus | null>;
  probeRender(manifest: OfflineBundleManifestV2): Promise<boolean>;
}>;

export function createMapLibreReadinessAdapter(
  source: MapLibreReadinessSource,
): OfflineRendererReadinessAdapter {
  return {
    renderer: 'maplibre',
    async inspect(manifest, installation) {
      if (manifest.renderer.id !== 'maplibre' || installation.renderer !== 'maplibre') {
        return {
          renderer: 'maplibre', ready: false, style_ready: false, tiles_ready: false,
          render_probe_ready: false, diagnostics: ['The installed map uses a different renderer.'],
        };
      }
      const packName = installation.legacy_pack_name;
      const pack = packName ? await source.getPackStatus(packName).catch(() => null) : null;
      const packReady = Boolean(pack && Number(pack.percentage) >= 100 && !pack.error);
      const diagnostics: string[] = [];
      if (!packReady) diagnostics.push(pack?.error || 'The legacy MapLibre pack is incomplete.');
      const probeReady = packReady ? await source.probeRender(manifest).catch(() => false) : false;
      if (packReady && !probeReady) diagnostics.push('The legacy renderer probe failed.');
      return {
        renderer: 'maplibre',
        ready: packReady && probeReady,
        style_ready: packReady,
        tiles_ready: packReady,
        render_probe_ready: probeReady,
        diagnostics,
      };
    },
  };
}

export type LegacyOfflinePackSnapshot = Readonly<{
  name: string;
  renderer: OfflineMapRenderer | 'unknown';
  percentage: number;
  error?: string;
}>;

export type LegacyOfflinePackClassification = Readonly<{
  classification: 'map_only' | 'repair_required';
  label: 'Map only' | 'Repair required';
  reason: string;
}>;

/**
 * A complete legacy pack can only be described as "Map only": it has no V2
 * places/search/trail guarantees. A mismatched, incomplete, or failed pack
 * must be rebuilt by the active renderer and is never reported as Ready.
 */
export function classifyLegacyOfflinePack(
  pack: LegacyOfflinePackSnapshot,
  activeRenderer: OfflineMapRenderer,
): LegacyOfflinePackClassification {
  if (pack.renderer === 'unknown') {
    return { classification: 'repair_required', label: 'Repair required', reason: 'The map renderer cannot be identified.' };
  }
  if (pack.renderer !== activeRenderer) {
    return { classification: 'repair_required', label: 'Repair required', reason: `This ${pack.renderer} map cannot be used by ${activeRenderer}.` };
  }
  if (pack.error || !Number.isFinite(pack.percentage) || pack.percentage < 100) {
    return { classification: 'repair_required', label: 'Repair required', reason: pack.error || 'The legacy map download is incomplete.' };
  }
  return {
    classification: 'map_only',
    label: 'Map only',
    reason: 'The map is complete, but places, trails, and offline search are not verified.',
  };
}

