import type {
  MapMode,
  PremiumMapStyle,
} from '@/components/NativeMap/mapStyle';

export const ORIGINALS_MAPBOX_STYLE_URI = 'mapbox://styles/mapbox/outdoors-v12';

export type OriginalMapRendererMode = 'mapbox' | 'maplibre';

export type OriginalMainMapPresentation = {
  mapLayer: MapMode;
  premiumMapStyle: PremiumMapStyle;
  rendererMode: OriginalMapRendererMode | null;
};

export function originalOwnsMapContext(options: {
  originalActive: boolean;
  navigationActive: boolean;
}) {
  return options.originalActive && !options.navigationActive;
}

export function originalOfflineStyleURI(renderer: 'maplibre' | 'rnmapbox') {
  return renderer === 'rnmapbox' ? ORIGINALS_MAPBOX_STYLE_URI : undefined;
}

/**
 * An active Original uses the exact Mapbox style downloaded with its required
 * region. This changes presentation props only; the user's saved map choices
 * remain untouched and return as soon as the Original leaves the main map.
 */
export function resolveOriginalMainMapPresentation(
  current: OriginalMainMapPresentation,
  options: {
    originalActive: boolean;
    mapboxAvailable: boolean;
  },
): OriginalMainMapPresentation {
  if (!options.originalActive || !options.mapboxAvailable) return current;
  return {
    mapLayer: 'extreme',
    premiumMapStyle: 'outdoors',
    rendererMode: 'mapbox',
  };
}
