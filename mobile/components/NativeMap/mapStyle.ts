/**
 * MapLibre style spec for Trailhead - dark outdoor theme.
 * Protomaps v4 schema: "kind" on all layers, "rank" on places (1=most important).
 *
 * Key principle: highways must be thick + bright at z3-z5 so users can
 * orient themselves when zoomed out to a 200-mile view. OSM achieves this
 * with thick red interstates; we use bright orange (#e89428) on a dark field.
 * City labels use Protomaps "rank" (NOT "population_rank") — lower rank = bigger city.
 */

export type MapMode = 'satellite' | 'topo' | 'hybrid';

const TILE_BASE = 'https://tiles.gettrailhead.app';
const GLYPH_URL = `${TILE_BASE}/api/fonts/{fontstack}/{range}.pbf`;

// When the local tile server is running, tile requests go to localhost.
// Glyphs still come from the CDN (always online for label rendering).
// tileSession changes each time we swap PMTiles files → busts MapLibre's cache
// so stale tiles from the old file don't persist.
export const LOCAL_TILE_PORT = 57832;

export function buildMapStyle(mode: MapMode, mapboxToken: string, localTiles = false, tileSession = 0): object {
  // Changing the source id (not just the URL) forces MapLibre to fully recreate
  // the source and drop its tile cache — the correct approach for cache-busting.
  const pmId = `pm${tileSession}`;
  const tileUrl = localTiles
    ? `http://127.0.0.1:${LOCAL_TILE_PORT}/api/tiles/{z}/{x}/{y}.pbf`
    : `${TILE_BASE}/api/tiles/{z}/{x}/{y}.pbf`;
  const sat = mode === 'satellite';
  const hyb = mode === 'hybrid';
  const lwHalo = sat ? 'rgba(0,0,0,0.85)' : '#13161c';

  const sources: Record<string, object> = {
    [pmId]: {
      type: 'vector',
      tiles: [tileUrl],
      minzoom: 0,
      maxzoom: 15,
      // No bounds set. Online tiles are global; local region files return 204
      // outside their coverage and fall back to the low-zoom base when present.
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
    // Background is noticeably different from earth fill so land mass reads clearly
    { id: 'bg', type: 'background', paint: { 'background-color': sat ? '#000' : '#0e1118' } },
  ];

  if (sources['sat']) {
    layers.push({
      id: 'satellite', type: 'raster', source: 'sat',
      paint: { 'raster-opacity': 1, 'raster-fade-duration': 0 },
    });
  }

  layers.push(
    // Earth fill - lighter than background so continents always read at any zoom
    { id: 'earth', type: 'fill', source: pmId, 'source-layer': 'earth',
      filter: ['==', ['get', 'kind'], 'earth'],
      paint: { 'fill-color': '#1e2330', 'fill-opacity': fillOp } },

    // Landuse
    { id: 'lu-park', type: 'fill', source: pmId, 'source-layer': 'landuse',
      filter: ['in', ['get', 'kind'], ['literal', ['national_park', 'park', 'nature_reserve', 'protected_area']]],
      paint: { 'fill-color': '#1a3322', 'fill-opacity': sat ? 0 : hyb ? 0.4 : 0.9 } },
    { id: 'lu-forest', type: 'fill', source: pmId, 'source-layer': 'landuse',
      filter: ['in', ['get', 'kind'], ['literal', ['forest', 'wood']]],
      paint: { 'fill-color': '#162818', 'fill-opacity': sat ? 0 : hyb ? 0.35 : 0.85 } },
    { id: 'lu-grass', type: 'fill', source: pmId, 'source-layer': 'landuse',
      filter: ['in', ['get', 'kind'], ['literal', ['grassland', 'meadow']]],
      paint: { 'fill-color': '#1e2818', 'fill-opacity': sat ? 0 : hyb ? 0.25 : 0.6 } },
    { id: 'lu-residential', type: 'fill', source: pmId, 'source-layer': 'landuse',
      filter: ['in', ['get', 'kind'], ['literal', ['residential', 'urban_area']]],
      minzoom: 9,
      paint: { 'fill-color': '#252830', 'fill-opacity': sat ? 0 : 0.5 } },

    // Water - clearly distinguishable deep blue even at z4
    { id: 'water-poly', type: 'fill', source: pmId, 'source-layer': 'water',
      paint: { 'fill-color': sat ? 'rgba(12,30,53,0)' : '#0a1a2e', 'fill-opacity': hyb ? 0.5 : 1 } },
    { id: 'water-river', type: 'line', source: pmId, 'source-layer': 'water',
      filter: ['in', ['get', 'kind'], ['literal', ['river', 'stream', 'canal']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#0a1a2e', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 10, 1.5, 15, 3], 'line-opacity': roadOp } },

    // Park outlines visible from z6
    { id: 'lu-park-line', type: 'line', source: pmId, 'source-layer': 'landuse',
      filter: ['in', ['get', 'kind'], ['literal', ['national_park', 'nature_reserve', 'protected_area']]],
      minzoom: 6,
      paint: { 'line-color': '#3a6040', 'line-width': 1, 'line-opacity': sat ? 0 : 0.8 } },

    // Dirt roads / tracks
    { id: 'road-other', type: 'line', source: pmId, 'source-layer': 'roads',
      filter: ['==', ['get', 'kind'], 'other'], minzoom: 12,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': sat ? 'rgba(255,255,255,0.5)' : '#5a4a2c',
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 16, 2],
        'line-dasharray': [2, 2], 'line-opacity': roadOp } },

    // Trails
    { id: 'road-path', type: 'line', source: pmId, 'source-layer': 'roads',
      filter: ['==', ['get', 'kind'], 'path'], minzoom: 11,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': sat ? 'rgba(167,139,250,0.8)' : '#9a7840',
        'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.8, 16, 2.5],
        'line-dasharray': [3, 2], 'line-opacity': roadOp } },

    // Minor roads (show from z9)
    { id: 'road-minor-case', type: 'line', source: pmId, 'source-layer': 'roads',
      filter: ['==', ['get', 'kind'], 'minor_road'], minzoom: 9,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#0e1118',
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1, 14, 4, 17, 11],
        'line-opacity': roadOp } },
    { id: 'road-minor', type: 'line', source: pmId, 'source-layer': 'roads',
      filter: ['==', ['get', 'kind'], 'minor_road'], minzoom: 9,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': sat ? '#e0e0e0' : '#7a7d88',
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.7, 14, 2.8, 17, 8],
        'line-opacity': roadOp } },

    // Major / primary roads - visible from z5 (case + fill)
    { id: 'road-major-case', type: 'line', source: pmId, 'source-layer': 'roads',
      filter: ['in', ['get', 'kind'], ['literal', ['major_road', 'medium_road']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#0e1118',
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.5, 8, 4, 12, 7, 16, 14],
        'line-opacity': roadOp } },
    { id: 'road-major', type: 'line', source: pmId, 'source-layer': 'roads',
      filter: ['in', ['get', 'kind'], ['literal', ['major_road', 'medium_road']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': sat ? '#fde68a' : '#b88838',
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1, 8, 3, 12, 5.5, 16, 11],
        'line-opacity': roadOp } },

    // Highways (interstates) - thick bright orange from z3 so map reads at 200-mile view
    { id: 'road-trunk-case', type: 'line', source: pmId, 'source-layer': 'roads',
      filter: ['==', ['get', 'kind'], 'highway'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#0e1118',
        'line-width': ['interpolate', ['linear'], ['zoom'], 3, 3, 6, 5, 10, 8, 15, 16],
        'line-opacity': roadOp } },
    { id: 'road-trunk', type: 'line', source: pmId, 'source-layer': 'roads',
      filter: ['==', ['get', 'kind'], 'highway'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': sat ? '#fbbf24' : '#e89428',
        'line-width': ['interpolate', ['linear'], ['zoom'], 3, 2, 6, 3.5, 10, 6, 15, 12],
        'line-opacity': roadOp } },

    // Boundaries
    { id: 'boundary-region', type: 'line', source: pmId, 'source-layer': 'boundaries',
      filter: ['==', ['get', 'kind'], 'region'],
      paint: { 'line-color': '#6a7a96',
        'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.8, 8, 1.5],
        'line-dasharray': [4, 3], 'line-opacity': sat ? 0.5 : 0.85 } },
    { id: 'boundary-country', type: 'line', source: pmId, 'source-layer': 'boundaries',
      filter: ['==', ['get', 'kind'], 'country'],
      paint: { 'line-color': '#8c9ab3',
        'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1, 8, 2.5],
        'line-opacity': sat ? 0.7 : 1 } },

    // POI circles — camp types differentiated by color + size
    // camp_site (developed, facilities)  = teal,   6px
    // camp_pitch (dispersed/individual)  = brown,  3.5px — primitive pads
    // shelter (trail shelter)            = purple, 5px
    { id: 'pm-pois-camp-site', type: 'circle', source: pmId, 'source-layer': 'pois',
      filter: ['==', ['get', 'kind'], 'camp_site'],
      paint: { 'circle-radius': 6, 'circle-color': '#14b8a6', 'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff', 'circle-opacity': labelOp } },
    { id: 'pm-pois-camp-pitch', type: 'circle', source: pmId, 'source-layer': 'pois',
      filter: ['==', ['get', 'kind'], 'camp_pitch'],
      minzoom: 11,
      paint: { 'circle-radius': 3.5, 'circle-color': '#c4915a', 'circle-stroke-width': 1, 'circle-stroke-color': 'rgba(255,255,255,0.6)', 'circle-opacity': labelOp } },
    { id: 'pm-pois-shelter', type: 'circle', source: pmId, 'source-layer': 'pois',
      filter: ['==', ['get', 'kind'], 'shelter'],
      paint: { 'circle-radius': 5, 'circle-color': '#8b5cf6', 'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff', 'circle-opacity': labelOp } },
    { id: 'pm-pois-trailhead', type: 'circle', source: pmId, 'source-layer': 'pois',
      filter: ['==', ['get', 'kind'], 'trailhead'],
      paint: { 'circle-radius': 5, 'circle-color': '#22c55e', 'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff', 'circle-opacity': labelOp } },

    // Labels
    { id: 'water-name', type: 'symbol', source: pmId, 'source-layer': 'water',
      filter: ['has', 'name'], minzoom: 7,
      layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-font': ['Noto Sans Italic'], 'text-max-width': 8 },
      paint: { 'text-color': '#4a9ece', 'text-halo-color': lwHalo, 'text-halo-width': 1.5, 'text-opacity': labelOp } },

    { id: 'peak-name', type: 'symbol', source: pmId, 'source-layer': 'pois',
      filter: ['==', ['get', 'kind'], 'peak'], minzoom: 10,
      layout: { 'text-field': ['get', 'name'], 'text-size': 10, 'text-font': ['Noto Sans Regular'],
        'text-offset': [0, 0.7], 'text-anchor': 'top' },
      paint: { 'text-color': '#f59e0b', 'text-halo-color': lwHalo, 'text-halo-width': 1.5, 'text-opacity': labelOp } },

    // Road labels — highways from z8, local roads from z12
    { id: 'road-name-hwy', type: 'symbol', source: pmId, 'source-layer': 'roads',
      minzoom: 8,
      filter: ['all', ['has', 'name'], ['==', ['get', 'kind'], 'highway']],
      layout: { 'text-field': ['get', 'name'], 'text-size': 9, 'text-font': ['Noto Sans Medium'],
        'symbol-placement': 'line', 'text-max-width': 10, 'text-repeat': 400 },
      paint: { 'text-color': sat ? '#fbbf24' : '#c4a050', 'text-halo-color': lwHalo, 'text-halo-width': 1.8, 'text-opacity': roadOp } },
    { id: 'road-name', type: 'symbol', source: pmId, 'source-layer': 'roads',
      minzoom: 12,
      filter: ['all', ['has', 'name'], ['in', ['get', 'kind'], ['literal', ['major_road', 'medium_road', 'minor_road']]]],
      layout: { 'text-field': ['get', 'name'], 'text-size': 10, 'text-font': ['Noto Sans Medium'],
        'symbol-placement': 'line', 'text-max-width': 10 },
      paint: { 'text-color': sat ? '#fff' : '#b9bcc4', 'text-halo-color': lwHalo, 'text-halo-width': 1.8, 'text-opacity': labelOp } },

    { id: 'park-name', type: 'symbol', source: pmId, 'source-layer': 'pois',
      filter: ['in', ['get', 'kind'], ['literal', ['park', 'national_park', 'nature_reserve']]],
      minzoom: 7,
      layout: { 'text-field': ['get', 'name'], 'text-size': 10, 'text-font': ['Noto Sans Italic'], 'text-max-width': 9 },
      paint: { 'text-color': '#5faa6a', 'text-halo-color': lwHalo, 'text-halo-width': 1.6, 'text-opacity': labelOp } },

    // Country labels z2-z5
    { id: 'place-country', type: 'symbol', source: pmId, 'source-layer': 'places',
      minzoom: 2, maxzoom: 5,
      filter: ['==', ['get', 'kind'], 'country'],
      layout: { 'text-field': ['get', 'name'], 'text-size': ['interpolate', ['linear'], ['zoom'], 2, 9, 5, 13],
        'text-font': ['Noto Sans Medium'], 'text-transform': 'uppercase' },
      paint: { 'text-color': '#9aa5b8', 'text-halo-color': lwHalo, 'text-halo-width': 1.5, 'text-opacity': labelOp } },

    // State/region labels z4-z8
    { id: 'place-region', type: 'symbol', source: pmId, 'source-layer': 'places',
      minzoom: 4, maxzoom: 8,
      filter: ['==', ['get', 'kind'], 'region'],
      layout: { 'text-field': ['get', 'name'], 'text-size': ['interpolate', ['linear'], ['zoom'], 4, 8, 7, 12],
        'text-font': ['Noto Sans Regular'], 'text-transform': 'uppercase', 'text-letter-spacing': 0.08 },
      paint: { 'text-color': '#4a5a70', 'text-halo-color': lwHalo, 'text-halo-width': 1.2, 'text-opacity': labelOp } },

    // FIXED: Protomaps v4 uses 'rank' (1=most important) NOT 'population_rank'
    // rank 1-4: major metros (Chicago, KC, Omaha…) from z3
    { id: 'place-large', type: 'symbol', source: pmId, 'source-layer': 'places',
      minzoom: 3,
      filter: ['all', ['==', ['get', 'kind'], 'locality'], ['<=', ['coalesce', ['get', 'rank'], 99], 4]],
      layout: { 'text-field': ['get', 'name'], 'text-size': ['interpolate', ['linear'], ['zoom'], 3, 11, 8, 18, 12, 22],
        'text-font': ['Noto Sans Medium'] },
      paint: { 'text-color': '#e6e9f1', 'text-halo-color': lwHalo, 'text-halo-width': 2.5, 'text-opacity': labelOp } },

    // rank 5-7: cities (Topeka, Wichita, Lincoln…) from z5
    { id: 'place-medium', type: 'symbol', source: pmId, 'source-layer': 'places',
      minzoom: 5,
      filter: ['all', ['==', ['get', 'kind'], 'locality'],
        ['>', ['coalesce', ['get', 'rank'], 99], 4],
        ['<=', ['coalesce', ['get', 'rank'], 99], 7]],
      layout: { 'text-field': ['get', 'name'], 'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10, 10, 15, 14, 18],
        'text-font': ['Noto Sans Medium'] },
      paint: { 'text-color': '#cdd2dd', 'text-halo-color': lwHalo, 'text-halo-width': 2, 'text-opacity': labelOp } },

    // rank > 7: towns from z8
    { id: 'place-small', type: 'symbol', source: pmId, 'source-layer': 'places',
      minzoom: 8,
      filter: ['all', ['==', ['get', 'kind'], 'locality'], ['>', ['coalesce', ['get', 'rank'], 99], 7]],
      layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-font': ['Noto Sans Regular'] },
      paint: { 'text-color': '#a3aab9', 'text-halo-color': lwHalo, 'text-halo-width': 1.8, 'text-opacity': labelOp } },
  );

  return {
    version: 8 as const,
    sources,
    glyphs: GLYPH_URL,
    layers,
  };
}
