import type { ExploreSourcePackItem } from './api';

export type ExploreDetailModuleKey =
  | 'see'
  | 'do'
  | 'stay'
  | 'visitor'
  | 'trails'
  | 'amenities'
  | 'fees'
  | 'alerts'
  | 'calendar'
  | 'weather'
  | 'map'
  | 'story'
  | 'nearby';

export type ExploreDetailTab = 'summary' | ExploreDetailModuleKey;

export type ExploreDetailNavigationState = {
  placeId: string;
  activeModule: ExploreDetailModuleKey | null;
  selectedItem: ExploreSourcePackItem | null;
  placeSearch: string;
  mainScrollY: number;
  childScrollY: number;
};

export type ExploreDetailNavigationAction =
  | { type: 'reset'; placeId: string; tab: ExploreDetailTab }
  | { type: 'open_module'; module: ExploreDetailModuleKey | null }
  | { type: 'select_item'; item: ExploreSourcePackItem | null }
  | { type: 'set_search'; value: string }
  | { type: 'set_scroll'; surface: 'main' | 'child'; y: number };

export function createExploreDetailNavigationState(
  placeId = '',
  tab: ExploreDetailTab = 'summary',
): ExploreDetailNavigationState {
  return {
    placeId,
    activeModule: tab === 'summary' ? null : tab,
    selectedItem: null,
    placeSearch: '',
    mainScrollY: 0,
    childScrollY: 0,
  };
}

export function exploreDetailNavigationReducer(
  state: ExploreDetailNavigationState,
  action: ExploreDetailNavigationAction,
): ExploreDetailNavigationState {
  if (action.type === 'reset') {
    return createExploreDetailNavigationState(action.placeId, action.tab);
  }
  if (action.type === 'open_module') {
    return {
      ...state,
      activeModule: action.module,
      selectedItem: null,
      mainScrollY: 0,
      childScrollY: 0,
    };
  }
  if (action.type === 'select_item') {
    return { ...state, selectedItem: action.item, childScrollY: 0 };
  }
  if (action.type === 'set_search') {
    return { ...state, placeSearch: action.value };
  }
  const y = Number.isFinite(action.y) ? Math.max(0, action.y) : 0;
  return action.surface === 'child'
    ? { ...state, childScrollY: y }
    : { ...state, mainScrollY: y };
}
