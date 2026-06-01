/**
 * MapLibre style spec for Trailhead - dark outdoor theme.
 * Protomaps v4 schema: "kind" on all layers, "rank" on places (1=most important).
 *
 * Key principle: highways must be thick + bright at z3-z5 so users can
 * orient themselves when zoomed out to a 200-mile view. OSM achieves this
 * with thick red interstates; we use bright orange (#e89428) on a dark field.
 * City labels use Protomaps "rank" (NOT "population_rank") — lower rank = bigger city.
 */

export type MapMode = 'satellite' | 'topo' | 'hybrid' | 'light' | 'city' | 'contrast' | 'desert' | 'snow' | 'dark' | 'red';

const TILE_BASE = 'https://tiles.gettrailhead.app';
const API_BASE = 'https://api.gettrailhead.app';
const GLYPH_URL = `${TILE_BASE}/api/fonts/{fontstack}/{range}.pbf`;

// When the local tile server is running, tile requests go to localhost.
// Glyphs still come from the CDN (always online for label rendering).
// tileSession changes each time we swap PMTiles files → busts MapLibre's cache
// so stale tiles from the old file don't persist.
export const LOCAL_TILE_PORT = 57832;

const TOPO_LAND = '#182118';
const TOPO_LAND_EARTH = '#1b261c';
const TOPO_WATER = '#061a2f';
const MAP_STYLE_PALETTES: Record<Exclude<MapMode, 'satellite' | 'hybrid'>, {
  land: string;
  earth: string;
  water: string;
  park: string;
  forest: string;
  grass: string;
  residential: string;
  wetland: string;
  minorRoad: string;
  majorRoad: string;
  trunkRoad: string;
  casing: string;
  halo: string;
}> = {
  topo: { land: TOPO_LAND, earth: TOPO_LAND_EARTH, water: TOPO_WATER, park: '#1a3322', forest: '#162818', grass: '#1e2818', residential: '#252830', wetland: '#1b2f21', minorRoad: '#7a7d88', majorRoad: '#b88838', trunkRoad: '#e89428', casing: '#0e1118', halo: '#13161c' },
  light: { land: '#f6f7f2', earth: '#f0f2ea', water: '#b9d8ed', park: '#dbeed4', forest: '#d4ead0', grass: '#e4efd5', residential: '#eceff3', wetland: '#c9dfd0', minorRoad: '#9ca3af', majorRoad: '#d18a2d', trunkRoad: '#f97316', casing: '#ffffff', halo: '#ffffff' },
  city: { land: '#eef1f4', earth: '#e6eaf0', water: '#a8cfe8', park: '#d8ead7', forest: '#cfe4d1', grass: '#dfead0', residential: '#d8dde5', wetland: '#c5d9d2', minorRoad: '#7b8494', majorRoad: '#d99028', trunkRoad: '#ea580c', casing: '#ffffff', halo: '#f8fafc' },
  contrast: { land: '#05070b', earth: '#080c12', water: '#003b5c', park: '#12391f', forest: '#0f2f18', grass: '#26320f', residential: '#151923', wetland: '#113225', minorRoad: '#f8fafc', majorRoad: '#fbbf24', trunkRoad: '#fb923c', casing: '#000000', halo: '#020617' },
  desert: { land: '#2a2418', earth: '#30291b', water: '#083f4c', park: '#33411f', forest: '#29351c', grass: '#3b351d', residential: '#3a3124', wetland: '#28422e', minorRoad: '#a38b67', majorRoad: '#d48b39', trunkRoad: '#f59e0b', casing: '#171108', halo: '#1f170d' },
  snow: { land: '#e7edf2', earth: '#dde6ee', water: '#8fc0de', park: '#d5e2dd', forest: '#c9d8d2', grass: '#dce7df', residential: '#d4dce5', wetland: '#c1d8da', minorRoad: '#64748b', majorRoad: '#d08a2e', trunkRoad: '#ea580c', casing: '#f8fafc', halo: '#f8fafc' },
  dark: { land: '#0b1020', earth: '#101827', water: '#08233d', park: '#102719', forest: '#0f2117', grass: '#1d2615', residential: '#1c2433', wetland: '#123026', minorRoad: '#818cf8', majorRoad: '#d6a143', trunkRoad: '#fbbf24', casing: '#020617', halo: '#020617' },
  red: { land: '#12090b', earth: '#180d10', water: '#1e1b4b', park: '#251112', forest: '#211011', grass: '#2a1610', residential: '#201013', wetland: '#1f191f', minorRoad: '#fca5a5', majorRoad: '#ef4444', trunkRoad: '#f97316', casing: '#060202', halo: '#080303' },
};
const WETLAND_KINDS = ['wetland', 'marsh', 'swamp', 'bog', 'mud', 'saltmarsh', 'tidalflat', 'wetland_noveg'];
export type ContourSourceMode = 'none' | 'online' | 'local';
export type TrailSourceMode = 'none' | 'online' | 'local';

export function buildMapStyle(
  mode: MapMode,
  mapboxToken: string,
  localTiles = false,
  tileSession = 0,
  contourMode: ContourSourceMode = 'none',
  trailMode: TrailSourceMode = 'online',
  showNautical = false,
  showTerrain = false,
): object {
  // Changing the source id (not just the URL) forces MapLibre to fully recreate
  // the source and drop its tile cache — the correct approach for cache-busting.
  const pmId = `pm${tileSession}`;
  const tileUrl = localTiles
    ? `http://127.0.0.1:${LOCAL_TILE_PORT}/api/tiles/{z}/{x}/{y}.pbf`
    : `${TILE_BASE}/api/tiles/{z}/{x}/{y}.pbf`;
  const contourId = `contours${tileSession}`;
  const contourUrl = contourMode === 'local'
    ? `http://127.0.0.1:${LOCAL_TILE_PORT}/api/contours/{z}/{x}/{y}.pbf`
    : 'https://tiles.openstreetmap.us/vector/contours-feet/{z}/{x}/{y}.mvt';
  const hydroId = `hydro${tileSession}`;
  const trailId = `trailpacks${tileSession}`;
  const trailUrl = trailMode === 'local'
    ? `http://127.0.0.1:${LOCAL_TILE_PORT}/api/trails/{z}/{x}/{y}.pbf`
    : `${TILE_BASE}/api/trails/{z}/{x}/{y}.pbf`;
  const sat = mode === 'satellite';
  const hyb = mode === 'hybrid';
  const palette = MAP_STYLE_PALETTES[sat || hyb ? 'topo' : mode];
  const lwHalo = sat ? 'rgba(0,0,0,0.85)' : palette.halo;
  const showContours = contourMode !== 'none' && !sat;
  const showTrailPack = trailMode === 'local';
  const demId = `dem${tileSession}`;
  const trailVisualClass = [
    'coalesce',
    ['get', 'trail_visual_class'],
    [
      'match',
      ['coalesce', ['get', 'route_class'], ['get', 'kind'], 'unknown'],
      'mvum', 'motorized',
      'motorized', 'motorized',
      'track', 'motorized',
      'bike', 'bike',
      'bicycle', 'bike',
      'mtb', 'bike',
      'cycleway', 'bike',
      'horse', 'horse',
      'bridleway', 'horse',
      'hike', 'hike',
      'hiking', 'hike',
      'foot', 'hike',
      'footway', 'hike',
      'path', 'hike',
      'unknown',
    ],
  ];

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
  if (showTerrain && mapboxToken) {
    sources[demId] = {
      type: 'raster-dem',
      tiles: [`https://api.mapbox.com/raster/v1/mapbox.mapbox-terrain-dem-v1/{z}/{x}/{y}.webp?access_token=${mapboxToken}`],
      tileSize: 512,
      maxzoom: 14,
      encoding: 'mapbox',
    };
  }
  if (showContours) {
    sources[contourId] = {
      type: 'vector',
      tiles: [contourUrl],
      minzoom: 8,
      maxzoom: 12,
      attribution: 'OpenStreetMap US, Mapzen DEM, GDAL',
    };
  }
  if (showTrailPack) {
    const trailSource: Record<string, unknown> = {
      type: 'vector',
      tiles: [trailUrl],
      minzoom: 8,
      maxzoom: 15,
      attribution: 'OpenStreetMap, USFS MVUM',
    };
    sources[trailId] = trailSource;
  }
  if (showNautical) {
    sources[hydroId] = {
      type: 'vector',
      tiles: [`${TILE_BASE}/api/hydro/tiles/mn-lotw/{z}/{x}/{y}.pbf`],
      minzoom: 8,
      maxzoom: 15,
      attribution: 'Safe Water hydro awareness - not for navigation',
    };
    sources['noaa-charts'] = {
      type: 'raster',
      tiles: [`${API_BASE}/api/noaa-chart-tile/{z}/{x}/{y}`],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 16,
      attribution: 'NOAA Office of Coast Survey',
    };
    sources['chs-nonna'] = {
      type: 'raster',
      tiles: [`${API_BASE}/api/chs-nonna-tile/{z}/{x}/{y}`],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 18,
      attribution: 'Canadian Hydrographic Service NONNA - non-navigational bathymetry',
    };
  }

  const fillOp = sat ? 0 : hyb ? 0.4 : 1;
  const roadOp = sat ? 0 : 1;
  const labelOp = sat ? 0 : 1;

  const layers: object[] = [
    // Background must read as land, not water. Some vector tiles are sparse or
    // resolve late, so a navy background makes random land areas look flooded.
    { id: 'bg', type: 'background', paint: { 'background-color': sat ? '#000' : palette.land } },
  ];

  if (sources['sat']) {
    layers.push({
      id: 'satellite', type: 'raster', source: 'sat',
      paint: { 'raster-opacity': 1, 'raster-fade-duration': 0 },
    });
  }
  if (showTerrain && mapboxToken) {
    layers.push({
      id: 'terrain-hillshade', type: 'hillshade', source: demId,
      paint: {
        'hillshade-shadow-color': sat || hyb ? '#0f172a' : '#2f2618',
        'hillshade-highlight-color': sat || hyb ? '#fff7ed' : '#d1b27b',
        'hillshade-accent-color': sat || hyb ? '#64748b' : '#8b6b3d',
        'hillshade-exaggeration': sat || hyb ? 0.62 : 0.5,
        'hillshade-opacity': sat || hyb ? 0.46 : 0.48,
      },
    });
  }

  layers.push(
    // Earth fill - lighter than background so continents always read at any zoom
    { id: 'earth', type: 'fill', source: pmId, 'source-layer': 'earth',
      filter: ['==', ['get', 'kind'], 'earth'],
      paint: { 'fill-color': palette.earth, 'fill-opacity': fillOp } },

    // Landuse
    { id: 'lu-park', type: 'fill', source: pmId, 'source-layer': 'landuse',
      filter: ['in', ['get', 'kind'], ['literal', ['national_park', 'park', 'nature_reserve', 'protected_area']]],
      paint: { 'fill-color': palette.park, 'fill-opacity': sat ? 0 : hyb ? 0.4 : 0.9 } },
    { id: 'lu-forest', type: 'fill', source: pmId, 'source-layer': 'landuse',
      filter: ['in', ['get', 'kind'], ['literal', ['forest', 'wood']]],
      paint: { 'fill-color': palette.forest, 'fill-opacity': sat ? 0 : hyb ? 0.35 : 0.85 } },
    { id: 'lu-grass', type: 'fill', source: pmId, 'source-layer': 'landuse',
      filter: ['in', ['get', 'kind'], ['literal', ['grassland', 'meadow']]],
      paint: { 'fill-color': palette.grass, 'fill-opacity': sat ? 0 : hyb ? 0.25 : 0.6 } },
    { id: 'lu-residential', type: 'fill', source: pmId, 'source-layer': 'landuse',
      filter: ['in', ['get', 'kind'], ['literal', ['residential', 'urban_area']]],
      minzoom: 9,
      paint: { 'fill-color': palette.residential, 'fill-opacity': sat ? 0 : 0.5 } },

    // Some high-zoom Protomaps water tiles include wetlands/marshes. They are
    // land on satellite, so draw them as marsh instead of solid lake water.
    { id: 'wetland-poly', type: 'fill', source: pmId, 'source-layer': 'water',
      filter: ['all',
        ['==', ['geometry-type'], 'Polygon'],
        ['in', ['coalesce', ['get', 'kind'], ''], ['literal', WETLAND_KINDS]],
      ],
      paint: { 'fill-color': palette.wetland, 'fill-opacity': sat ? 0 : hyb ? 0.28 : 0.72 } },

    // Water - clearly distinguishable deep blue even at z4. Exclude marsh-like
    // polygons so trail zoom does not randomly make land look flooded.
    { id: 'water-poly', type: 'fill', source: pmId, 'source-layer': 'water',
      filter: ['all',
        ['==', ['geometry-type'], 'Polygon'],
        ['!', ['in', ['coalesce', ['get', 'kind'], 'water'], ['literal', WETLAND_KINDS]]],
      ],
      paint: { 'fill-color': sat ? 'rgba(12,30,53,0)' : palette.water, 'fill-opacity': hyb ? 0.5 : 1 } },
    { id: 'water-river', type: 'line', source: pmId, 'source-layer': 'water',
      filter: ['in', ['get', 'kind'], ['literal', ['river', 'stream', 'canal']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': palette.water, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 10, 1.5, 15, 3], 'line-opacity': roadOp } },
  );

  if (showContours) {
    layers.push(
      { id: 'contour-line', type: 'line', source: contourId, 'source-layer': 'contours',
        minzoom: 10,
        filter: ['!', ['to-boolean', ['coalesce', ['get', 'idx'], false]]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': hyb ? 'rgba(255,218,151,0.62)' : '#8a7652',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.35, 13, 0.65, 16, 1.05],
          'line-opacity': hyb ? 0.66 : 0.66,
        } },
      { id: 'contour-index-line', type: 'line', source: contourId, 'source-layer': 'contours',
        minzoom: 9,
        filter: ['to-boolean', ['coalesce', ['get', 'idx'], false]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': hyb ? 'rgba(255,226,166,0.9)' : '#a38a5c',
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.65, 13, 1.05, 16, 1.6],
          'line-opacity': hyb ? 0.86 : 0.82,
        } },
      { id: 'contour-label', type: 'symbol', source: contourId, 'source-layer': 'contours',
        minzoom: 12,
        filter: ['all', ['has', 'ele'], ['to-boolean', ['coalesce', ['get', 'idx'], false]]],
        layout: {
          'symbol-placement': 'line',
          'text-field': [
            'case',
            ['==', ['get', 'unit'], 'm'],
            ['concat', ['to-string', ['get', 'ele']], ' m'],
            ['concat', ['to-string', ['get', 'ele']], ' ft'],
          ],
          'text-size': ['interpolate', ['linear'], ['zoom'], 12, 9, 15, 11],
          'text-font': ['Noto Sans Medium'],
          'text-repeat': 500,
        },
        paint: {
          'text-color': hyb ? '#ffe7b8' : '#b39a68',
          'text-halo-color': lwHalo,
          'text-halo-width': hyb ? 2 : 1.3,
          'text-opacity': hyb ? 0.95 : 0.88,
        } },
    );
  }

  if (showTrailPack) {
    layers.push(
      { id: 'trail-pack-casing', type: 'line', source: trailId, 'source-layer': 'trails',
        minzoom: 8,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': sat || hyb ? 'rgba(3,7,18,0.86)' : '#10140f',
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.8, 12, 3.8, 15, 7.2],
          'line-opacity': sat || hyb ? 0.86 : 0.7,
        } },
      { id: 'trail-pack-line', type: 'line', source: trailId, 'source-layer': 'trails',
        minzoom: 8,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': [
            'match',
            trailVisualClass,
            'motorized', '#22c55e',
            'hike', '#1d8cff',
            'bike', '#f97316',
            'horse', '#a855f7',
            'restricted', '#ef4444',
            'unknown', sat || hyb ? '#0f172a' : '#94a3b8',
            '#94a3b8',
          ],
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.0, 12, 2.15, 15, 4.8],
          'line-opacity': sat || hyb ? 0.96 : 0.9,
        } },
      { id: 'trail-pack-label', type: 'symbol', source: trailId, 'source-layer': 'trails',
        minzoom: 13,
        filter: ['has', 'name'],
        layout: {
          'symbol-placement': 'line',
          'text-field': ['get', 'name'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 16, 12],
          'text-font': ['Noto Sans Medium'],
          'text-repeat': 380,
        },
        paint: {
          'text-color': sat ? '#fde68a' : '#d69b3a',
          'text-halo-color': lwHalo,
          'text-halo-width': 1.4,
          'text-opacity': sat ? 0.9 : 0.86,
        } },
    );
  }

  if (showNautical) {
    layers.push(
      {
        id: 'chs-nonna-layer',
        type: 'raster',
        source: 'chs-nonna',
        paint: {
          'raster-opacity': sat ? 0.64 : hyb ? 0.48 : 0.52,
          'raster-fade-duration': 120,
        },
      },
      {
        id: 'noaa-charts-layer',
        type: 'raster',
        source: 'noaa-charts',
        paint: {
          'raster-opacity': sat ? 0.68 : hyb ? 0.52 : 0.56,
          'raster-fade-duration': 120,
        },
      },
      {
        id: 'hydro-depth-area',
        type: 'fill',
        source: hydroId,
        'source-layer': 'depth_areas',
        minzoom: 8,
        paint: {
          'fill-color': ['match', ['get', 'depth_band'],
            'shallow_0_5', '#f97316',
            'shallow_5_10', '#facc15',
            'moderate_10_20', '#22d3ee',
            'deep_20_40', '#0284c7',
            'deep_40_plus', '#1d4ed8',
            '#0ea5e9'],
          'fill-opacity': sat ? 0.22 : hyb ? 0.24 : 0.32,
        },
      },
      {
        id: 'hydro-hazard-glow',
        type: 'fill',
        source: hydroId,
        'source-layer': 'reef_hazards',
        minzoom: 9,
        paint: {
          'fill-color': '#ef4444',
          'fill-opacity': sat ? 0.18 : 0.24,
          'fill-outline-color': '#fb923c',
        },
      },
      {
        id: 'hydro-hazard-line',
        type: 'line',
        source: hydroId,
        'source-layer': 'reef_hazards',
        minzoom: 9,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#fb923c',
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.1, 13, 2.2, 16, 3.8],
          'line-opacity': 0.86,
          'line-blur': 0.7,
        },
      },
      {
        id: 'hydro-depth-contour',
        type: 'line',
        source: hydroId,
        'source-layer': 'depth_contours',
        minzoom: 10,
        filter: ['!', ['to-boolean', ['coalesce', ['get', 'idx'], false]]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': sat ? 'rgba(186,230,253,0.72)' : '#67e8f9',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.55, 13, 0.95, 16, 1.45],
          'line-opacity': sat ? 0.68 : 0.76,
        },
      },
      {
        id: 'hydro-depth-index-contour',
        type: 'line',
        source: hydroId,
        'source-layer': 'depth_contours',
        minzoom: 9,
        filter: ['to-boolean', ['coalesce', ['get', 'idx'], false]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': sat ? '#e0f2fe' : '#bae6fd',
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.95, 13, 1.65, 16, 2.35],
          'line-opacity': sat ? 0.76 : 0.88,
        },
      },
      {
        id: 'hydro-depth-label',
        type: 'symbol',
        source: hydroId,
        'source-layer': 'hydro_labels',
        minzoom: 12,
        filter: ['has', 'depth_ft'],
        layout: {
          'symbol-placement': 'line',
          'text-field': ['coalesce', ['get', 'depth_label'], ['concat', ['to-string', ['get', 'depth_ft']], "'"]],
          'text-size': 10,
          'text-font': ['Noto Sans Bold'],
          'text-repeat': 340,
          'text-rotation-alignment': 'map',
          'text-keep-upright': true,
        },
        paint: {
          'text-color': '#e0f2fe',
          'text-halo-color': lwHalo,
          'text-halo-width': 1.5,
          'text-opacity': 0.92,
        },
      },
    );
  }

  layers.push(

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
      paint: { 'line-color': sat ? '#e0e0e0' : palette.minorRoad,
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.7, 14, 2.8, 17, 8],
        'line-opacity': roadOp } },

    // Major / primary roads - visible from z5 (case + fill)
    { id: 'road-major-case', type: 'line', source: pmId, 'source-layer': 'roads',
      filter: ['in', ['get', 'kind'], ['literal', ['major_road', 'medium_road']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': sat ? '#0e1118' : palette.casing,
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.5, 8, 4, 12, 7, 16, 14],
        'line-opacity': roadOp } },
    { id: 'road-major', type: 'line', source: pmId, 'source-layer': 'roads',
      filter: ['in', ['get', 'kind'], ['literal', ['major_road', 'medium_road']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': sat ? '#fde68a' : palette.majorRoad,
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1, 8, 3, 12, 5.5, 16, 11],
        'line-opacity': roadOp } },

    // Highways (interstates) - thick bright orange from z3 so map reads at 200-mile view
    { id: 'road-trunk-case', type: 'line', source: pmId, 'source-layer': 'roads',
      filter: ['==', ['get', 'kind'], 'highway'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': sat ? '#0e1118' : palette.casing,
        'line-width': ['interpolate', ['linear'], ['zoom'], 3, 3, 6, 5, 10, 8, 15, 16],
        'line-opacity': roadOp } },
    { id: 'road-trunk', type: 'line', source: pmId, 'source-layer': 'roads',
      filter: ['==', ['get', 'kind'], 'highway'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': sat ? '#fbbf24' : palette.trunkRoad,
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

    ...(showTerrain ? [
      { id: 'building-extrusion', type: 'fill-extrusion', source: pmId, 'source-layer': 'buildings',
        minzoom: 15,
        filter: ['any', ['has', 'height'], ['has', 'render_height'], ['has', 'levels']],
        paint: {
          'fill-extrusion-color': sat || hyb ? '#e7e5e4' : '#3d4654',
          'fill-extrusion-opacity': sat || hyb ? 0.52 : 0.36,
          'fill-extrusion-height': [
            'case',
            ['has', 'height'], ['to-number', ['get', 'height']],
            ['has', 'render_height'], ['to-number', ['get', 'render_height']],
            ['has', 'levels'], ['*', ['to-number', ['get', 'levels']], 3],
            10,
          ],
          'fill-extrusion-base': [
            'case',
            ['has', 'min_height'], ['to-number', ['get', 'min_height']],
            ['has', 'render_min_height'], ['to-number', ['get', 'render_min_height']],
            0,
          ],
          'fill-extrusion-vertical-gradient': true,
        } },
    ] : []),

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

    // Road labels — route shields and line names. Protomaps road tiles can
    // expose shield_text/ref/network; fall back to name so offline packs still
    // label even when refs are sparse.
    { id: 'road-shield-hwy', type: 'symbol', source: pmId, 'source-layer': 'roads',
      minzoom: 6,
      filter: ['all',
        ['==', ['get', 'kind'], 'highway'],
        ['any', ['has', 'shield_text'], ['has', 'ref'], ['has', 'network']],
      ],
      layout: {
        'symbol-placement': 'line',
        'text-field': ['coalesce', ['get', 'shield_text'], ['get', 'ref'], ['get', 'network']],
        'text-size': ['interpolate', ['linear'], ['zoom'], 6, 9, 10, 11, 14, 12],
        'text-font': ['Noto Sans Bold'],
        'text-repeat': 260,
        'text-padding': 3,
        'text-rotation-alignment': 'map',
        'text-keep-upright': true,
      },
      paint: {
        'text-color': sat ? '#fff7ed' : '#fff5e5',
        'text-halo-color': sat ? 'rgba(20,20,24,0.96)' : '#7c3f12',
        'text-halo-width': 2.8,
        'text-opacity': roadOp,
      } },
    { id: 'road-name-hwy', type: 'symbol', source: pmId, 'source-layer': 'roads',
      minzoom: 7,
      filter: ['all',
        ['==', ['get', 'kind'], 'highway'],
        ['any', ['has', 'name'], ['has', 'ref'], ['has', 'shield_text']],
      ],
      layout: {
        'text-field': ['coalesce', ['get', 'name'], ['get', 'ref'], ['get', 'shield_text']],
        'text-size': ['interpolate', ['linear'], ['zoom'], 7, 9, 11, 11, 15, 13],
        'text-font': ['Noto Sans Medium'],
        'symbol-placement': 'line',
        'text-max-width': 12,
        'text-repeat': 360,
        'text-offset': [0, 0.78],
        'text-rotation-alignment': 'map',
        'text-keep-upright': true,
      },
      paint: { 'text-color': sat ? '#fbbf24' : '#c4a050', 'text-halo-color': lwHalo, 'text-halo-width': 1.8, 'text-opacity': roadOp } },
    { id: 'road-name-major', type: 'symbol', source: pmId, 'source-layer': 'roads',
      minzoom: 10,
      filter: ['all', ['has', 'name'], ['in', ['get', 'kind'], ['literal', ['major_road', 'medium_road']]]],
      layout: {
        'text-field': ['get', 'name'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 10, 9, 14, 11, 16, 12],
        'text-font': ['Noto Sans Medium'],
        'symbol-placement': 'line',
        'text-max-width': 10,
        'text-repeat': 320,
        'text-offset': [0, 0.68],
        'text-rotation-alignment': 'map',
        'text-keep-upright': true,
      },
      paint: { 'text-color': sat ? '#fff' : '#d0c6a2', 'text-halo-color': lwHalo, 'text-halo-width': 1.7, 'text-opacity': labelOp } },
    { id: 'road-name', type: 'symbol', source: pmId, 'source-layer': 'roads',
      minzoom: 13,
      filter: ['all', ['has', 'name'], ['==', ['get', 'kind'], 'minor_road']],
      layout: {
        'text-field': ['get', 'name'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 13, 9, 16, 11],
        'text-font': ['Noto Sans Medium'],
        'symbol-placement': 'line',
        'text-max-width': 10,
        'text-repeat': 260,
        'text-offset': [0, 0.62],
        'text-rotation-alignment': 'map',
        'text-keep-upright': true,
      },
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
    ...(showTerrain && mapboxToken ? { terrain: { source: demId, exaggeration: hyb ? 1.85 : 1.6 } } : {}),
    layers,
  };
}
