export type LayersFiltersSection =
  | 'map-content'
  | 'camps'
  | 'places'
  | 'water'
  | 'stays'
  | 'explore-services'
  | 'community'
  | 'weather-layers';

export type LayersFiltersEntry =
  | 'layers'
  | 'filters'
  | 'styles'
  | 'legend'
  | 'camps'
  | 'places'
  | 'water'
  | 'services'
  | 'community'
  | 'weather';

export type LayersFiltersReturnContext =
  | 'map_drawer'
  | 'map_shortcut'
  | 'legend'
  | 'style_gallery'
  | 'unknown';

export type MapLayersFiltersState = {
  visible: boolean;
  legendVisible: boolean;
  activeSection: LayersFiltersSection;
  returnContext: LayersFiltersReturnContext | null;
};

export type MapLayersFiltersAction =
  | { type: 'open'; entry: LayersFiltersEntry; returnContext?: LayersFiltersReturnContext | null }
  | { type: 'open_legend' }
  | { type: 'close_legend' }
  | { type: 'close' };

export const initialMapLayersFiltersState: MapLayersFiltersState = {
  visible: false,
  legendVisible: false,
  activeSection: 'map-content',
  returnContext: null,
};

export function resolveLayersFiltersEntry(entry: LayersFiltersEntry): {
  surface: 'layers_filters';
  section: LayersFiltersSection;
  openLegend: boolean;
} {
  const section: LayersFiltersSection = entry === 'camps'
    ? 'camps'
    : entry === 'places'
      ? 'places'
      : entry === 'water'
        ? 'water'
        : entry === 'services'
          ? 'explore-services'
          : entry === 'community'
            ? 'community'
            : entry === 'weather'
              ? 'weather-layers'
              : 'map-content';
  return { surface: 'layers_filters', section, openLegend: entry === 'legend' };
}

export function mapLayersFiltersReducer(
  state: MapLayersFiltersState,
  action: MapLayersFiltersAction,
): MapLayersFiltersState {
  switch (action.type) {
    case 'open': {
      const target = resolveLayersFiltersEntry(action.entry);
      return {
        visible: true,
        legendVisible: target.openLegend,
        activeSection: target.section,
        returnContext: action.returnContext === undefined ? state.returnContext : action.returnContext,
      };
    }
    case 'open_legend':
      return { ...state, visible: true, legendVisible: true };
    case 'close_legend':
      return { ...state, legendVisible: false };
    case 'close':
      return { ...state, visible: false, legendVisible: false };
    default:
      return state;
  }
}
