/**
 * MapLibre style spec for Trailhead — dark outdoor theme.
 * Protomaps v4 tile schema: property name is "kind" on all source layers.
 * Glyphs served from our CF Worker edge cache for offline reliability.
 */

export type MapMode = 'satellite' | 'topo' | 'hybrid';

const TILE_BASE = 'https://tiles.gettrailhead.app';
const GLYPH_URL = `${TILE_BASE}/api/fonts/{fontstack}/{range}.pbf`;

export function buildMapStyle(mode: MapMode, mapboxToken: string): object {
  const sat = mode === 'satellite';
  const hyb = mode === 'hybrid';
  const lwHalo = sat ? 'rgba(0,0,0,0.85)' : '#1c1f26';

  const sources: Record<string, object> = {
    pm: {
      type: 'vector',
      tiles: [`${TILE_BASE}/api/tiles/{z}/{x}/{y}.pbf`],
      maxzoom: 15,
      attribution: '© OpenStreetMap',
    },
  };

  if ((sat || hyb) && mapboxToken) {
    sources['sat'] = {
      type: 'raster',
      tiles: [`https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token=${mapboxToken}`],
      tileSize: 512,
      maxzoom: 19,
    };
  }

  const fillOp = sat ? 0 : hyb ? 0.4 : 1;
  const roadOp = sat ? 0 : 1;
  const labelOp = sat ? 0 : 1;

  const layers: object[] = [
    { id: 'bg', type: 'background', paint: { 'background-color': sat ? '#000' : '#1c1f26' } },
  ];

  if (sources['sat']) {
    layers.push({ id: 'satellite', type: 'raster', source: 'sat', paint: { 'raster-opacity': 1, 'raster-fade-duration': 0 } });
  }

  layers.push(
    // ── Earth + land ─────────────────────────────────────────────────────────
    { id: 'earth', type: 'fill', source: 'pm', 'source-layer': 'earth', filter: ['==', ['get', 'kind'], 'earth'], paint: { 'fill-color': '#272a30', 'fill-opacity': fillOp } },
    { id: 'earth-cliff', type: 'fill', source: 'pm', 'source-layer': 'earth', filter: ['==', ['get', 'kind'], 'cliff'], paint: { 'fill-color': '#3b3f48', 'fill-opacity': sat ? 0 : 0.7 } },
    // ── Landuse ──────────────────────────────────────────────────────────────
    { id: 'lu-park', type: 'fill', source: 'pm', 'source-layer': 'landuse', filter: ['in', ['get', 'kind'], ['literal', ['national_park', 'park', 'nature_reserve', 'protected_area']]], paint: { 'fill-color': '#2a3f2c', 'fill-opacity': sat ? 0 : hyb ? 0.35 : 0.92 } },
    { id: 'lu-forest', type: 'fill', source: 'pm', 'source-layer': 'landuse', filter: ['in', ['get', 'kind'], ['literal', ['forest', 'wood']]], paint: { 'fill-color': '#243325', 'fill-opacity': sat ? 0 : hyb ? 0.3 : 0.8 } },
    { id: 'lu-grass', type: 'fill', source: 'pm', 'source-layer': 'landuse', filter: ['in', ['get', 'kind'], ['literal', ['grassland', 'meadow']]], paint: { 'fill-color': '#2c3327', 'fill-opacity': sat ? 0 : hyb ? 0.25 : 0.55 } },
    { id: 'lu-residential', type: 'fill', source: 'pm', 'source-layer': 'landuse', filter: ['in', ['get', 'kind'], ['literal', ['residential', 'urban_area']]], minzoom: 9, paint: { 'fill-color': '#2b2e34', 'fill-opacity': sat ? 0 : 0.5 } },
    // ── Water ────────────────────────────────────────────────────────────────
    { id: 'water-poly', type: 'fill', source: 'pm', 'source-layer': 'water', paint: { 'fill-color': sat ? 'rgba(12,30,53,0)' : '#1a2940', 'fill-opacity': hyb ? 0.45 : 1 } },
    { id: 'water-river', type: 'line', source: 'pm', 'source-layer': 'water', filter: ['in', ['get', 'kind'], ['literal', ['river', 'stream', 'canal']]], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#1a2940', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 12, 1.6, 15, 3], 'line-opacity': roadOp } },
    // ── Park outlines ────────────────────────────────────────────────────────
    { id: 'lu-park-line', type: 'line', source: 'pm', 'source-layer': 'landuse', filter: ['in', ['get', 'kind'], ['literal', ['national_park', 'nature_reserve', 'protected_area']]], minzoom: 7, paint: { 'line-color': '#3f6845', 'line-width': 1.2, 'line-opacity': sat ? 0 : 0.7 } },
    // ── Roads (case + fill for highway/major) ────────────────────────────────
    { id: 'road-other', type: 'line', source: 'pm', 'source-layer': 'roads', filter: ['==', ['get', 'kind'], 'other'], minzoom: 12, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': sat ? 'rgba(255,255,255,0.5)' : '#5a4a2c', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 16, 2], 'line-dasharray': [2, 2], 'line-opacity': roadOp } },
    { id: 'road-path', type: 'line', source: 'pm', 'source-layer': 'roads', filter: ['==', ['get', 'kind'], 'path'], minzoom: 12, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': sat ? 'rgba(167,139,250,0.8)' : '#a07840', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 16, 2.5], 'line-dasharray': [3, 2], 'line-opacity': roadOp } },
    { id: 'road-minor-case', type: 'line', source: 'pm', 'source-layer': 'roads', filter: ['==', ['get', 'kind'], 'minor_road'], minzoom: 9, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#1c1f26', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.8, 14, 3.5, 17, 10], 'line-opacity': roadOp } },
    { id: 'road-minor', type: 'line', source: 'pm', 'source-layer': 'roads', filter: ['==', ['get', 'kind'], 'minor_road'], minzoom: 9, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': sat ? '#fff' : '#6e7079', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.6, 14, 2.5, 17, 8], 'line-opacity': roadOp } },
    { id: 'road-major-case', type: 'line', source: 'pm', 'source-layer': 'roads', filter: ['in', ['get', 'kind'], ['literal', ['major_road', 'medium_road']]], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#1c1f26', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.9, 12, 4.5, 16, 12], 'line-opacity': roadOp } },
    { id: 'road-major', type: 'line', source: 'pm', 'source-layer': 'roads', filter: ['in', ['get', 'kind'], ['literal', ['major_road', 'medium_road']]], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': sat ? '#fde68a' : '#a8896a', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.7, 12, 3, 16, 10], 'line-opacity': roadOp } },
    { id: 'road-trunk-case', type: 'line', source: 'pm', 'source-layer': 'roads', filter: ['==', ['get', 'kind'], 'highway'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#1c1f26', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 2.5, 10, 7, 15, 14], 'line-opacity': roadOp } },
    { id: 'road-trunk', type: 'line', source: 'pm', 'source-layer': 'roads', filter: ['==', ['get', 'kind'], 'highway'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': sat ? '#fbbf24' : '#d8a23a', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.5, 10, 4, 15, 10], 'line-opacity': roadOp } },
    // ── Boundaries ───────────────────────────────────────────────────────────
    { id: 'boundary-region', type: 'line', source: 'pm', 'source-layer': 'boundaries', filter: ['==', ['get', 'kind'], 'region'], paint: { 'line-color': '#5a6a82', 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.6, 8, 1.2], 'line-dasharray': [4, 3], 'line-opacity': sat ? 0.4 : 0.65 } },
    { id: 'boundary-country', type: 'line', source: 'pm', 'source-layer': 'boundaries', filter: ['==', ['get', 'kind'], 'country'], paint: { 'line-color': '#7c8aa3', 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.8, 8, 2], 'line-opacity': sat ? 0.6 : 0.85 } },
    // ── POI circles ──────────────────────────────────────────────────────────
    { id: 'pm-pois-camp', type: 'circle', source: 'pm', 'source-layer': 'pois', filter: ['in', ['get', 'kind'], ['literal', ['camp_site', 'camp_pitch', 'picnic_site', 'shelter']]], paint: { 'circle-radius': 5, 'circle-color': '#14b8a6', 'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff', 'circle-opacity': labelOp } },
    { id: 'pm-pois-trailhead', type: 'circle', source: 'pm', 'source-layer': 'pois', filter: ['==', ['get', 'kind'], 'trailhead'], paint: { 'circle-radius': 5, 'circle-color': '#22c55e', 'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff', 'circle-opacity': labelOp } },
    // ── Labels ───────────────────────────────────────────────────────────────
    { id: 'water-name', type: 'symbol', source: 'pm', 'source-layer': 'water', filter: ['has', 'name'], minzoom: 8, layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-font': ['Noto Sans Italic'], 'text-max-width': 8 }, paint: { 'text-color': '#7eb6e2', 'text-halo-color': lwHalo, 'text-halo-width': 1.5, 'text-opacity': labelOp } },
    { id: 'peak-name', type: 'symbol', source: 'pm', 'source-layer': 'pois', filter: ['==', ['get', 'kind'], 'peak'], minzoom: 11, layout: { 'text-field': ['get', 'name'], 'text-size': 10, 'text-font': ['Noto Sans Regular'], 'text-offset': [0, 0.7], 'text-anchor': 'top' }, paint: { 'text-color': '#f59e0b', 'text-halo-color': lwHalo, 'text-halo-width': 1.5, 'text-opacity': labelOp } },
    { id: 'road-name', type: 'symbol', source: 'pm', 'source-layer': 'roads', minzoom: 13, filter: ['all', ['has', 'name'], ['in', ['get', 'kind'], ['literal', ['highway', 'major_road', 'medium_road', 'minor_road']]]], layout: { 'text-field': ['get', 'name'], 'text-size': 10, 'text-font': ['Noto Sans Medium'], 'symbol-placement': 'line', 'text-max-width': 10 }, paint: { 'text-color': sat ? '#fff' : '#b9bcc4', 'text-halo-color': lwHalo, 'text-halo-width': 1.8, 'text-opacity': labelOp } },
    { id: 'park-name', type: 'symbol', source: 'pm', 'source-layer': 'pois', filter: ['in', ['get', 'kind'], ['literal', ['park', 'national_park', 'nature_reserve']]], minzoom: 8, layout: { 'text-field': ['get', 'name'], 'text-size': ['interpolate', ['linear'], ['zoom'], 8, 9, 13, 12], 'text-font': ['Noto Sans Italic'], 'text-max-width': 9 }, paint: { 'text-color': '#7fb88b', 'text-halo-color': lwHalo, 'text-halo-width': 1.6, 'text-opacity': labelOp } },
    { id: 'place-small', type: 'symbol', source: 'pm', 'source-layer': 'places', minzoom: 7, filter: ['all', ['==', ['get', 'kind'], 'locality'], ['<', ['coalesce', ['get', 'population_rank'], 0], 8]], layout: { 'text-field': ['get', 'name'], 'text-size': ['interpolate', ['linear'], ['zoom'], 7, 9, 14, 12], 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': '#a3aab9', 'text-halo-color': lwHalo, 'text-halo-width': 1.8, 'text-opacity': labelOp } },
    { id: 'place-medium', type: 'symbol', source: 'pm', 'source-layer': 'places', minzoom: 6, filter: ['all', ['==', ['get', 'kind'], 'locality'], ['>=', ['coalesce', ['get', 'population_rank'], 0], 8], ['<', ['coalesce', ['get', 'population_rank'], 0], 11]], layout: { 'text-field': ['get', 'name'], 'text-size': ['interpolate', ['linear'], ['zoom'], 6, 10, 12, 15], 'text-font': ['Noto Sans Medium'] }, paint: { 'text-color': '#cdd2dd', 'text-halo-color': lwHalo, 'text-halo-width': 2, 'text-opacity': labelOp } },
    { id: 'place-large', type: 'symbol', source: 'pm', 'source-layer': 'places', minzoom: 3, filter: ['all', ['==', ['get', 'kind'], 'locality'], ['>=', ['coalesce', ['get', 'population_rank'], 0], 11]], layout: { 'text-field': ['get', 'name'], 'text-size': ['interpolate', ['linear'], ['zoom'], 4, 11, 12, 17], 'text-font': ['Noto Sans Bold'] }, paint: { 'text-color': '#e6e9f1', 'text-halo-color': lwHalo, 'text-halo-width': 2.2, 'text-opacity': labelOp } },
  );

  return {
    version: 8 as const,
    sources,
    glyphs: GLYPH_URL,
    layers,
  };
}
