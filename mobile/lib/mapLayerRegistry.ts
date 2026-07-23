export type MapLayerAvailability =
  | 'always'
  | 'mapbox'
  | 'navigation'
  | 'weather';

export type MapLayerFreshness =
  | 'static'
  | 'downloaded'
  | 'viewport'
  | 'current';

export type MapLayerOfflineCapability =
  | 'renderer_managed'
  | 'downloaded'
  | 'partial'
  | 'online_only';

export type MapLayerLegend =
  | 'none'
  | 'trail'
  | 'mvum'
  | 'avalanche'
  | 'safe_water';

type RegistryBase = {
  key: string;
  label: string;
  sub: string;
  icon: string;
  color: string;
  availability: MapLayerAvailability;
  sourceLabel: string;
  freshness: MapLayerFreshness;
  offlineCapability: MapLayerOfflineCapability;
  legend: MapLayerLegend;
};

export const MAP_BASE_STYLE_REGISTRY = [
  { key: 'topo', title: 'Topo', sub: 'Trails, terrain, public land', colors: ['#182118', '#25633a', '#061a2f'] },
  { key: 'satellite', title: 'Satellite', sub: 'Imagery first', colors: ['#111827', '#4b5563', '#1f2937'] },
  { key: 'hybrid', title: 'Hybrid', sub: 'Imagery with labels', colors: ['#101827', '#6b7280', '#f59e0b'] },
  { key: 'light', title: 'Light', sub: 'Bright road view', colors: ['#f8fafc', '#dbeafe', '#2563eb'] },
  { key: 'city', title: 'City', sub: 'Clear streets and places', colors: ['#f3f4f6', '#cbd5e1', '#0284c7'] },
  { key: 'contrast', title: 'High Contrast', sub: 'Maximum line clarity', colors: ['#020617', '#f8fafc', '#f97316'] },
  { key: 'desert', title: 'Desert', sub: 'Dry terrain and washes', colors: ['#2a2418', '#9a6a32', '#0e7490'] },
  { key: 'snow', title: 'Snow', sub: 'Winter terrain view', colors: ['#e5edf4', '#94a3b8', '#2563eb'] },
  { key: 'dark', title: 'Dark Road', sub: 'Low-glare roads', colors: ['#0b1020', '#334155', '#fbbf24'] },
  { key: 'red', title: 'Red / Night', sub: 'Night-friendly contrast', colors: ['#12090b', '#7f1d1d', '#ef4444'] },
] as const;

export const MAPBOX_STYLE_REGISTRY = [
  { key: 'outdoors', label: 'Outdoors', sub: 'Trails and terrain', icon: 'trail-sign-outline', color: '#84cc16' },
  { key: 'standard', label: 'Standard', sub: 'Clear day view', icon: 'map-outline', color: '#38bdf8' },
  { key: 'standard_satellite', label: 'Satellite Plus', sub: 'Imagery with labels', icon: 'earth-outline', color: '#22c55e' },
  { key: 'streets', label: 'Streets', sub: 'Roads and places', icon: 'navigate-outline', color: '#60a5fa' },
  { key: 'navigation_day', label: 'Traffic Day', sub: 'Road guidance', icon: 'git-merge-outline', color: '#f97316' },
  { key: 'navigation_night', label: 'Traffic Night', sub: 'Low-glare guidance', icon: 'moon-outline', color: '#ef4444' },
  { key: 'dawn', label: 'Dawn', sub: 'Low sun lighting', icon: 'partly-sunny-outline', color: '#f59e0b' },
  { key: 'dusk', label: 'Dusk', sub: 'Evening lighting', icon: 'cloudy-night-outline', color: '#a855f7' },
  { key: 'night', label: 'Night', sub: 'Low-glare standard', icon: 'moon-outline', color: '#818cf8' },
  { key: 'satellite_streets', label: 'Satellite Streets', sub: 'Imagery with roads', icon: 'image-outline', color: '#14b8a6' },
] as const;

export const MAP_OVERLAY_REGISTRY = [
  { key: '3d', label: '3D Terrain', sub: 'Tilted terrain and buildings', icon: 'cube-outline', color: '#a3e635', availability: 'always', sourceLabel: 'Active map', freshness: 'static', offlineCapability: 'renderer_managed', legend: 'none' },
  { key: 'lands', label: 'Public Land', sub: 'BLM, USFS and park boundaries', icon: 'layers-outline', color: '#D97745', availability: 'always', sourceLabel: 'Official public-land boundaries', freshness: 'downloaded', offlineCapability: 'downloaded', legend: 'none' },
  { key: 'usgs', label: 'Topo Lines', sub: 'Contours and trail context', icon: 'trail-sign-outline', color: '#0ea5e9', availability: 'always', sourceLabel: 'USGS', freshness: 'downloaded', offlineCapability: 'downloaded', legend: 'none' },
  { key: 'pois', label: 'Places', sub: 'Fuel, water, services', icon: 'location-outline', color: '#3b82f6', availability: 'always', sourceLabel: 'Trailhead places', freshness: 'downloaded', offlineCapability: 'downloaded', legend: 'none' },
  { key: 'trails', label: 'Trails & Dirt', sub: 'Tracks and paths', icon: 'trail-sign-outline', color: '#22c55e', availability: 'always', sourceLabel: 'Trailhead trail catalog', freshness: 'downloaded', offlineCapability: 'downloaded', legend: 'trail' },
  { key: 'nautical', label: 'Water Safety', sub: 'Markers and hazards', icon: 'boat-outline', color: '#0891b2', availability: 'always', sourceLabel: 'Official chart context', freshness: 'viewport', offlineCapability: 'partial', legend: 'safe_water' },
  { key: 'fire', label: 'Wildfire', sub: 'Current fire data', icon: 'flame-outline', color: '#ef4444', availability: 'always', sourceLabel: 'Current fire sources', freshness: 'current', offlineCapability: 'online_only', legend: 'none' },
  { key: 'ava', label: 'Avalanche', sub: 'Snow danger areas', icon: 'snow-outline', color: '#3b82f6', availability: 'always', sourceLabel: 'Avalanche centers', freshness: 'current', offlineCapability: 'online_only', legend: 'avalanche' },
  { key: 'radar', label: 'Radar', sub: 'Rain and storms', icon: 'rainy-outline', color: '#06b6d4', availability: 'weather', sourceLabel: 'Weather radar', freshness: 'current', offlineCapability: 'online_only', legend: 'none' },
  { key: 'mvum', label: 'Motor Access', sub: 'Seasonal roads', icon: 'car-outline', color: '#22c55e', availability: 'always', sourceLabel: 'USFS MVUM', freshness: 'viewport', offlineCapability: 'online_only', legend: 'mvum' },
] as const satisfies readonly RegistryBase[];

export const MAP_TOOL_REGISTRY = [
  { key: 'globe_terrain', label: 'Globe / 3D', sub: 'Terrain view', icon: 'planet-outline', color: '#a3e635', availability: 'always', sourceLabel: 'Active map', freshness: 'static', offlineCapability: 'renderer_managed', legend: 'none' },
  { key: 'search_box', label: 'Search', sub: 'Find places', icon: 'search-outline', color: '#38bdf8', availability: 'mapbox', sourceLabel: 'Trailhead search', freshness: 'current', offlineCapability: 'partial', legend: 'none' },
  { key: 'directions', label: 'Directions', sub: 'Choose destination', icon: 'navigate-outline', color: '#f97316', availability: 'navigation', sourceLabel: 'Trailhead navigation', freshness: 'current', offlineCapability: 'partial', legend: 'none' },
  { key: 'traffic', label: 'Traffic', sub: 'Congestion style', icon: 'git-merge-outline', color: '#ef4444', availability: 'navigation', sourceLabel: 'Current traffic', freshness: 'current', offlineCapability: 'online_only', legend: 'none' },
  { key: 'weather', label: 'Weather', sub: 'Radar view', icon: 'rainy-outline', color: '#06b6d4', availability: 'weather', sourceLabel: 'Current weather', freshness: 'current', offlineCapability: 'online_only', legend: 'none' },
] as const satisfies readonly RegistryBase[];

export type MapBaseStyleKey = typeof MAP_BASE_STYLE_REGISTRY[number]['key'];
export type MapboxStyleKey = typeof MAPBOX_STYLE_REGISTRY[number]['key'];
export type MapOverlayKey = typeof MAP_OVERLAY_REGISTRY[number]['key'];
export type MapToolKey = typeof MAP_TOOL_REGISTRY[number]['key'];

export function mapLayerRegistrySnapshot() {
  return {
    styles: MAP_BASE_STYLE_REGISTRY.map(item => item.key),
    mapboxStyles: MAPBOX_STYLE_REGISTRY.map(item => item.key),
    overlays: MAP_OVERLAY_REGISTRY.map(item => item.key),
    tools: MAP_TOOL_REGISTRY.map(item => item.key),
  } as const;
}

export function mapLayerRegistryHasUniqueKeys(): boolean {
  const snapshot = mapLayerRegistrySnapshot();
  return Object.values(snapshot).every(keys => new Set(keys).size === keys.length);
}
