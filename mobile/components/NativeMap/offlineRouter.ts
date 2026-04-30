/**
 * JS Offline Router — reads road tiles from the local TileServer (localhost:57832),
 * decodes MVT with pbf + @mapbox/vector-tile, builds a road graph, runs A*.
 *
 * Replaces the Swift OfflineRouter which has fatal crash points we can't fix via OTA.
 *
 * Feature flags (change here until we have a proper config):
 */
export const ENABLE_JS_OFFLINE_ROUTER   = true;
export const ENABLE_SWIFT_OFFLINE_ROUTER = false; // keep false — Swift router crashes

import Pbf from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';
import type { RouteResult } from './routing';

const LOCAL_TILE_PORT = 57832;
let loggedTileDecode = false;
let lastDebug = 'not run';
let lastTileFetchDebug = '';
const DENSIFY_STEP_M = 25;
const STITCH_RADIUS_M = 16;
const STITCH_MAX_PER_NODE = 2;
const MAX_BRIDGE_GAP_M = 30;
const MAX_BRIDGES = 0;
const MAX_CONFIDENT_ROUTE_KM = 35;
let routeSession = 0;

export function getLastOfflineRouterDebug() {
  return lastDebug;
}

async function fetchWithTimeout(url: string, ms = 3000): Promise<Response> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(tid);
  }
}

// ── Road-class speed table (km/h) ────────────────────────────────────────────
// PMTiles use Protomaps schema: property is `kind`, not `highway`
const SPEED: Record<string, number> = {
  // Protomaps kinds
  highway:    105,
  major_road:  75,
  medium_road: 60,
  minor_road:  40,
  other:       25,
  path:        12,
  // OSM highway values (fallback if tiles use raw OSM tags)
  motorway:   110, motorway_link: 70,
  trunk:       90, trunk_link:    60,
  primary:     80, primary_link:  55,
  secondary:   65, secondary_link: 50,
  tertiary:    50, tertiary_link:  40,
  unclassified: 40, residential:  30,
  service:     20, track:         15,
  footway:      6, cycleway:      15,
};

function speedFor(props: Record<string, any>): number {
  // Protomaps uses `kind`; raw OSM tiles use `highway`
  const cls = props?.kind ?? props?.highway ?? props?.class ?? props?.type ?? '';
  return SPEED[cls] ?? 30;
}

// ── Tile math ─────────────────────────────────────────────────────────────────
function latLngToTile(lat: number, lng: number, z: number): [number, number] {
  const n = 2 ** z;
  const x = Math.floor((lng + 180) / 360 * n);
  const sinLat = Math.sin(lat * Math.PI / 180);
  const y = Math.floor((0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * n);
  return [Math.max(0, Math.min(n - 1, x)), Math.max(0, Math.min(n - 1, y))];
}

function tileToLng(tx: number, z: number): number {
  return tx / (2 ** z) * 360 - 180;
}
function tileToLat(ty: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * ty) / (2 ** z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

// Convert tile-local pixel (0..extent) → WGS84
function pixelToLngLat(px: number, py: number, tx: number, ty: number, z: number, extent: number): [number, number] {
  const lng = tileToLng(tx + px / extent, z);
  const lat = tileToLat(ty + py / extent, z);
  return [lng, lat];
}

// Round to 5 decimal places (~1m) — merges endpoints at tile boundaries and
// quantization artifacts so the road graph is topologically connected.
function snap(v: number): number {
  return Math.round(v * 1e5) / 1e5;
}
function nodeKey(lng: number, lat: number): string {
  return `${snap(lng)},${snap(lat)}`;
}

// ── Haversine distance (metres) ───────────────────────────────────────────────
function haversine(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6_371_000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Graph types ───────────────────────────────────────────────────────────────
interface Node { key: string; lng: number; lat: number; }
interface Edge { to: string; dist: number; dur: number; }
type Graph = Map<string, { node: Node; edges: Edge[] }>;

function addEdge(graph: Graph, from: string, to: string, dist: number, speedKmh: number) {
  if (from === to || dist < 0.1) return 0;
  const a = graph.get(from);
  const b = graph.get(to);
  if (!a || !b) return 0;
  if (a.edges.some(e => e.to === to)) return 0;
  const dur = (dist / 1000) / speedKmh * 3600;
  a.edges.push({ to, dist, dur });
  b.edges.push({ to: from, dist, dur });
  return 2;
}

function stitchNearbyNodes(graph: Graph, radiusM = STITCH_RADIUS_M): number {
  const nodes = Array.from(graph.values()).map(v => v.node);
  if (nodes.length < 2) return 0;

  const cellDeg = 0.00035; // roughly 30-40m in Kansas/CONUS latitudes
  const buckets = new Map<string, Node[]>();
  const cellKey = (lng: number, lat: number) => `${Math.floor(lng / cellDeg)}:${Math.floor(lat / cellDeg)}`;

  for (const node of nodes) {
    const key = cellKey(node.lng, node.lat);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(node);
    else buckets.set(key, [node]);
  }

  let added = 0;
  for (const node of nodes) {
    const cx = Math.floor(node.lng / cellDeg);
    const cy = Math.floor(node.lat / cellDeg);
    const near: Array<{ node: Node; dist: number }> = [];

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = buckets.get(`${cx + dx}:${cy + dy}`);
        if (!bucket) continue;
        for (const other of bucket) {
          if (other.key <= node.key) continue;
          const dist = haversine(node.lng, node.lat, other.lng, other.lat);
          if (dist > 1 && dist <= radiusM) near.push({ node: other, dist });
        }
      }
    }

    near.sort((a, b) => a.dist - b.dist);
    for (const candidate of near.slice(0, STITCH_MAX_PER_NODE)) {
      added += addEdge(graph, node.key, candidate.node.key, candidate.dist, 12);
    }
  }
  return added;
}

function reachableFrom(graph: Graph, startKey: string, limit = 250_000): Set<string> {
  const seen = new Set<string>([startKey]);
  const queue = [startKey];
  for (let qi = 0; qi < queue.length && seen.size < limit; qi++) {
    for (const edge of graph.get(queue[qi])?.edges ?? []) {
      if (seen.has(edge.to)) continue;
      seen.add(edge.to);
      queue.push(edge.to);
    }
  }
  return seen;
}

function bridgeTowardGoal(graph: Graph, reachable: Set<string>, goalKey: string): number {
  const inside: Node[] = [];
  const outside: Node[] = [];
  const goal = graph.get(goalKey)?.node;
  if (!goal) return 0;

  for (const [key, entry] of graph) {
    if (reachable.has(key)) inside.push(entry.node);
    else outside.push(entry.node);
  }
  if (!inside.length || !outside.length) return 0;

  // Bias toward the goal side instead of scanning all pairs.
  inside.sort((a, b) => haversine(a.lng, a.lat, goal.lng, goal.lat) - haversine(b.lng, b.lat, goal.lng, goal.lat));
  outside.sort((a, b) => haversine(a.lng, a.lat, goal.lng, goal.lat) - haversine(b.lng, b.lat, goal.lng, goal.lat));

  let best: { a: Node; b: Node; dist: number } | null = null;
  const aMax = Math.min(inside.length, 1800);
  const bMax = Math.min(outside.length, 1800);
  for (let i = 0; i < aMax; i++) {
    const a = inside[i];
    for (let j = 0; j < bMax; j++) {
      const b = outside[j];
      const roughLatM = Math.abs(a.lat - b.lat) * 111000;
      const roughLngM = Math.abs(a.lng - b.lng) * 111000 * Math.cos(a.lat * Math.PI / 180);
      if (roughLatM > MAX_BRIDGE_GAP_M || roughLngM > MAX_BRIDGE_GAP_M) continue;
      const dist = haversine(a.lng, a.lat, b.lng, b.lat);
      if (dist <= MAX_BRIDGE_GAP_M && (!best || dist < best.dist)) best = { a, b, dist };
    }
  }

  return best ? addEdge(graph, best.a.key, best.b.key, best.dist, 8) : 0;
}

function astarWithRepairs(graph: Graph, startKey: string, goalKey: string, goalNode: Node): { path: string[]; dist: number; dur: number; bridgeEdges: number } | null {
  if (MAX_BRIDGES <= 0) {
    const result = astar(graph, startKey, goalKey, goalNode);
    return result ? { ...result, bridgeEdges: 0 } : null;
  }

  let bridgeEdges = 0;
  for (let i = 0; i <= MAX_BRIDGES; i++) {
    const result = astar(graph, startKey, goalKey, goalNode);
    if (result) return { ...result, bridgeEdges };

    const reachable = reachableFrom(graph, startKey);
    if (reachable.has(goalKey)) return null;
    const added = bridgeTowardGoal(graph, reachable, goalKey);
    if (!added) return null;
    bridgeEdges += added;
    console.log('[OfflineRouter] bridged disconnected road components', { pass: i + 1, added, reachable: reachable.size });
  }
  return null;
}

// ── Binary min-heap (for A*) ──────────────────────────────────────────────────
class MinHeap {
  private data: [number, string][] = [];
  push(cost: number, key: string) {
    this.data.push([cost, key]);
    this._bubbleUp(this.data.length - 1);
  }
  pop(): [number, string] | undefined {
    if (!this.data.length) return undefined;
    const top = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length) { this.data[0] = last; this._sinkDown(0); }
    return top;
  }
  get size() { return this.data.length; }
  private _bubbleUp(i: number) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.data[p][0] <= this.data[i][0]) break;
      [this.data[p], this.data[i]] = [this.data[i], this.data[p]];
      i = p;
    }
  }
  private _sinkDown(i: number) {
    const n = this.data.length;
    while (true) {
      let min = i;
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && this.data[l][0] < this.data[min][0]) min = l;
      if (r < n && this.data[r][0] < this.data[min][0]) min = r;
      if (min === i) break;
      [this.data[min], this.data[i]] = [this.data[i], this.data[min]];
      i = min;
    }
  }
}

// ── Fetch + decode a single MVT tile ─────────────────────────────────────────
async function fetchTile(z: number, x: number, y: number): Promise<VectorTile | null> {
  try {
    const url = `http://127.0.0.1:${LOCAL_TILE_PORT}/api/tiles/${z}/${x}/${y}.pbf?r=${routeSession}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      lastTileFetchDebug = `HTTP ${res.status} z${z}/${x}/${y}`;
      return null;
    }
    const buf  = await res.arrayBuffer();
    const head = Array.from(new Uint8Array(buf.slice(0, 4))).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const tile = new VectorTile(new Pbf(buf));
    lastTileFetchDebug = `HTTP ${res.status}, ${buf.byteLength}b, head ${head}`;
    if (!loggedTileDecode) {
      loggedTileDecode = true;
      console.log('[OfflineRouter] first tile decoded', {
        z, x, y,
        bytes: buf.byteLength,
        head,
        layers: Object.keys(tile.layers),
      });
    }
    return tile;
  } catch (e: any) {
    lastTileFetchDebug = `decode/fetch failed: ${e?.message ?? String(e)}`;
    if (!loggedTileDecode) {
      loggedTileDecode = true;
      console.warn('[OfflineRouter] first tile decode failed', {
        z, x, y,
        message: e?.message ?? String(e),
      });
    }
    return null;
  }
}

// Layer name used by the Protomaps/Trailhead PMTiles schema (confirmed from mapStyle.ts)
// Additional names are fallbacks for generic OpenMapTiles-style tilesets
const ROAD_LAYERS = ['roads', 'transportation', 'road', 'highway', 'route'];

// ── Build graph from tiles covering the route bbox ────────────────────────────
async function buildGraph(
  fromLng: number, fromLat: number,
  toLng:   number, toLat:   number,
  z:       number,
  padMult: number,
  stitchRadiusM: number,
): Promise<{ graph: Graph; stats: Record<string, number> }> {
  const stats: Record<string, number> = {
    tilesFetched: 0, tilesEmpty: 0, featureCount: 0, nodeCount: 0, edgeCount: 0,
    stitchEdges: 0, tilesHttp200: 0, tilesHttp204: 0,
  };

  const distKm = haversine(fromLng, fromLat, toLng, toLat) / 1000;

  const minPad = z >= 15 ? 0.008 : z >= 14 ? 0.012 : z >= 13 ? 0.02 : z >= 12 ? 0.035 : 0.05;
  const pad    = Math.max(minPad, (Math.abs(toLng - fromLng) + Math.abs(toLat - fromLat)) * padMult);
  const minLng = Math.min(fromLng, toLng) - pad;
  const maxLng = Math.max(fromLng, toLng) + pad;
  const minLat = Math.min(fromLat, toLat) - pad;
  const maxLat = Math.max(fromLat, toLat) + pad;

  const [txMin, tyMax] = latLngToTile(minLat, minLng, z); // note: ty increases southward
  const [txMax, tyMin] = latLngToTile(maxLat, maxLng, z);

  const tilesToFetch: [number, number][] = [];
  for (let tx = txMin; tx <= txMax; tx++) {
    for (let ty = tyMin; ty <= tyMax; ty++) {
      tilesToFetch.push([tx, ty]);
    }
  }

  console.log(`[OfflineRouter] z${z}, bbox tiles: ${tilesToFetch.length}, dist: ${Math.round(distKm)}km, stitch:${stitchRadiusM}m`);

  const graph: Graph = new Map();

  const addNode = (lng: number, lat: number) => {
    const key = nodeKey(lng, lat);
    if (!graph.has(key)) {
      graph.set(key, { node: { key, lng: snap(lng), lat: snap(lat) }, edges: [] });
    }
    return key;
  };

  // Fetch all tiles in parallel (localhost is fast)
  const tiles = await Promise.all(
    tilesToFetch.map(([tx, ty]) =>
      fetchWithTimeout(`http://127.0.0.1:${LOCAL_TILE_PORT}/api/tiles/${z}/${tx}/${ty}.pbf?r=${routeSession}`)
        .then(async res => {
          if (res.status === 204) return { tx, ty, status: res.status, tile: null as VectorTile | null, detail: '204' };
          if (!res.ok) return { tx, ty, status: res.status, tile: null as VectorTile | null, detail: `HTTP ${res.status}` };
          const buf = await res.arrayBuffer();
          const head = Array.from(new Uint8Array(buf.slice(0, 4))).map(b => b.toString(16).padStart(2, '0')).join(' ');
          try {
            const tile = new VectorTile(new Pbf(buf));
            return { tx, ty, status: res.status, tile, detail: `${buf.byteLength}b head ${head}` };
          } catch (e: any) {
            return { tx, ty, status: res.status, tile: null as VectorTile | null, detail: `decode ${buf.byteLength}b head ${head}: ${e?.message ?? String(e)}` };
          }
        })
        .catch((e: any) => ({ tx, ty, status: 0, tile: null as VectorTile | null, detail: `fetch ${e?.message ?? String(e)}` }))
    )
  );

  const firstProblem = tiles.find(t => !t.tile)?.detail ?? '';
  if (firstProblem) lastTileFetchDebug = firstProblem;

  for (const { tx, ty, tile, status } of tiles) {
    stats.tilesFetched++;
    if (status === 200) stats.tilesHttp200++;
    if (status === 204) stats.tilesHttp204++;
    if (!tile) { stats.tilesEmpty++; continue; }

    for (const layerName of ROAD_LAYERS) {
      const layer = tile.layers[layerName];
      if (!layer) continue;

      for (let fi = 0; fi < layer.length; fi++) {
        const feat = layer.feature(fi);
        if (feat.type !== 2) continue; // LineString only (type 2)

        const props = feat.properties;
        const speed = speedFor(props);
        stats.featureCount++;

        const geom = feat.loadGeometry(); // array of rings, each an array of {x,y}
        for (const ring of geom) {
          if (ring.length < 2) continue;
          // Convert all points to WGS84
          const pts: [number, number][] = ring.map(({ x, y }) =>
            pixelToLngLat(x, y, tx, ty, z, layer.extent)
          );
          // Add edges for each segment. Vector-tile road geometry is not a true
          // routable graph, so long lines are densified before nearby-node stitching.
          for (let i = 0; i < pts.length - 1; i++) {
            const [lng1, lat1] = pts[i];
            const [lng2, lat2] = pts[i + 1];
            const dist = haversine(lng1, lat1, lng2, lat2);
            if (dist < 0.1) continue; // skip degenerate segments
            const pieces = Math.max(1, Math.ceil(dist / DENSIFY_STEP_M));
            let prevKey = addNode(lng1, lat1);
            let prevLng = lng1;
            let prevLat = lat1;
            for (let j = 1; j <= pieces; j++) {
              const t = j / pieces;
              const lng = lng1 + (lng2 - lng1) * t;
              const lat = lat1 + (lat2 - lat1) * t;
              const nextKey = addNode(lng, lat);
              const pieceDist = haversine(prevLng, prevLat, lng, lat);
              stats.edgeCount += addEdge(graph, prevKey, nextKey, pieceDist, speed);
              prevKey = nextKey;
              prevLng = lng;
              prevLat = lat;
            }
          }
        }
      }
    }
  }

  stats.stitchEdges = stitchNearbyNodes(graph, stitchRadiusM);
  stats.edgeCount += stats.stitchEdges;
  stats.nodeCount = graph.size;
  return { graph, stats };
}

// ── Snap a coordinate to nearest graph node ───────────────────────────────────
function nearestNode(graph: Graph, lng: number, lat: number): { key: string; dist: number } | null {
  let bestKey = '';
  let bestDist = Infinity;
  for (const [key, { node }] of graph) {
    const d = haversine(lng, lat, node.lng, node.lat);
    if (d < bestDist) { bestDist = d; bestKey = key; }
  }
  return bestKey ? { key: bestKey, dist: bestDist } : null;
}

// ── A* ────────────────────────────────────────────────────────────────────────
function astar(
  graph:   Graph,
  startKey: string,
  goalKey:  string,
  goalNode: Node,
): { path: string[]; dist: number; dur: number } | null {
  const gScore = new Map<string, number>([[startKey, 0]]);
  const fScore = new Map<string, number>();
  const prev   = new Map<string, string>();
  const heap   = new MinHeap();

  const h = (key: string) => {
    const n = graph.get(key)?.node;
    if (!n) return 0;
    return haversine(n.lng, n.lat, goalNode.lng, goalNode.lat);
  };

  fScore.set(startKey, h(startKey));
  heap.push(fScore.get(startKey)!, startKey);

  let iterations = 0;
  while (heap.size > 0 && iterations++ < 500_000) {
    const item = heap.pop();
    if (!item) break;
    const [, current] = item;

    if (current === goalKey) {
      // Reconstruct path
      const path: string[] = [];
      let cur: string | undefined = goalKey;
      while (cur) { path.unshift(cur); cur = prev.get(cur); }
      const totalDist = gScore.get(goalKey) ?? 0;
      const totalDur  = path.reduce((acc, key, i) => {
        if (i === 0) return acc;
        const prevKey = path[i - 1];
        const edge = graph.get(prevKey)?.edges.find(e => e.to === key);
        return acc + (edge?.dur ?? 0);
      }, 0);
      return { path, dist: totalDist, dur: totalDur };
    }

    const gCur = gScore.get(current) ?? Infinity;
    for (const edge of (graph.get(current)?.edges ?? [])) {
      const tentative = gCur + edge.dist;
      if (tentative < (gScore.get(edge.to) ?? Infinity)) {
        prev.set(edge.to, current);
        gScore.set(edge.to, tentative);
        const f = tentative + h(edge.to);
        fScore.set(edge.to, f);
        heap.push(f, edge.to);
      }
    }
  }
  return null;
}

// ── Public entry point ────────────────────────────────────────────────────────
export async function fetchJSOfflineRoute(
  fromLng: number, fromLat: number,
  toLng:   number, toLat:   number,
): Promise<RouteResult | null> {
  if (!ENABLE_JS_OFFLINE_ROUTER) return null;

  console.log('[OfflineRouter] start', { fromLng, fromLat, toLng, toLat });
  lastDebug = 'starting';
  routeSession = Date.now();

  const distKm = haversine(fromLng, fromLat, toLng, toLat) / 1000;
  if (distKm > MAX_CONFIDENT_ROUTE_KM) {
    lastDebug = `offline router skipped: ${Math.round(distKm)}km exceeds ${MAX_CONFIDENT_ROUTE_KM}km confidence limit`;
    console.warn('[OfflineRouter] skipped long route', { distKm: Math.round(distKm) });
    return null;
  }

  const attempts = distKm < 12
    ? [
        { z: 15, pad: 0.12, stitch: 8 },
        { z: 14, pad: 0.18, stitch: 12 },
        { z: 13, pad: 0.25, stitch: 18 },
        { z: 12, pad: 0.35, stitch: 26 },
      ]
    : distKm < 55
    ? [
        { z: 14, pad: 0.12, stitch: 16 },
        { z: 13, pad: 0.20, stitch: 22 },
        { z: 12, pad: 0.28, stitch: 24 },
      ]
    : [
        { z: 12, pad: 0.20, stitch: 40 },
        { z: 11, pad: 0.32, stitch: 55 },
        { z: 10, pad: 0.55, stitch: 85 },
      ];

  let lastReason = 'not attempted';
  let bestReason = '';
  let graph: Graph | null = null;
  let result: { path: string[]; dist: number; dur: number; bridgeEdges: number } | null = null;

  for (const attempt of attempts) {
    const built = await buildGraph(fromLng, fromLat, toLng, toLat, attempt.z, attempt.pad, attempt.stitch);
    graph = built.graph;
    const [fromTx, fromTy] = latLngToTile(fromLat, fromLng, attempt.z);
    const [toTx, toTy] = latLngToTile(toLat, toLng, attempt.z);
    const routeSummary = `from ${fromLat.toFixed(4)},${fromLng.toFixed(4)} t${attempt.z}/${fromTx}/${fromTy} -> ${toLat.toFixed(4)},${toLng.toFixed(4)} t${attempt.z}/${toTx}/${toTy}`;
    const statSummary = `z${attempt.z} tiles ${built.stats.tilesFetched}/${built.stats.tilesEmpty} empty (${built.stats.tilesHttp200}x200/${built.stats.tilesHttp204}x204), features ${built.stats.featureCount}, nodes ${built.stats.nodeCount}, edges ${built.stats.edgeCount}; ${routeSummary}`;
    lastDebug = statSummary;
    console.log('[OfflineRouter] graph stats:', { attempt, ...built.stats });

    if (graph.size < 2) {
      lastReason = `${statSummary}: no road graph; ${lastTileFetchDebug}`;
      if (!bestReason && built.stats.tilesHttp200 > 0) bestReason = lastReason;
      continue;
    }

    const startSnap = nearestNode(graph, fromLng, fromLat);
    const goalSnap  = nearestNode(graph, toLng,   toLat);
    console.log('[OfflineRouter] snap', {
      attempt,
      startM: Math.round(startSnap?.dist ?? 0),
      goalM: Math.round(goalSnap?.dist ?? 0),
    });

    if (!startSnap || !goalSnap) {
      lastReason = `${statSummary}: could not snap`;
      bestReason = lastReason;
      continue;
    }

    if (startSnap.dist > 5000 || goalSnap.dist > 5000) {
      lastReason = `${statSummary}: snap too far ${Math.round(startSnap.dist)}/${Math.round(goalSnap.dist)}m`;
      bestReason = lastReason;
      continue;
    }

    const goalEntry = graph.get(goalSnap.key);
    if (!goalEntry) {
      lastReason = `${statSummary}: missing goal node`;
      bestReason = lastReason;
      continue;
    }

    result = astarWithRepairs(graph, startSnap.key, goalSnap.key, goalEntry.node);
    if (result) {
      console.log('[OfflineRouter] A* success', {
        attempt,
        nodes: result.path.length,
        dist: Math.round(result.dist),
        bridgeEdges: result.bridgeEdges,
      });
      lastDebug = `routed z${attempt.z}, ${Math.round(result.dist)}m, bridges ${result.bridgeEdges}`;
      break;
    }
    lastReason = `${statSummary}: disconnected graph`;
    bestReason = lastReason;
    console.warn('[OfflineRouter] A* found no path', { attempt });
  }

  if (!graph || !result) {
    const reason = bestReason || lastReason;
    console.warn('[OfflineRouter] failed', reason);
    lastDebug = reason;
    return null;
  }

  const coords: [number, number][] = result.path
    .map(key => graph.get(key)?.node)
    .filter(Boolean)
    .map(n => [n!.lng, n!.lat]);

  // Prepend actual start/end coords so the line reaches the pin
  coords.unshift([fromLng, fromLat]);
  coords.push([toLng, toLat]);

  const depart = { type: 'depart', modifier: '', name: 'Head toward destination',
                   distance: result.dist, duration: result.dur };
  const arrive = { type: 'arrive', modifier: '', name: 'Arrive at destination',
                   distance: 0, duration: 0,
                   lat: toLat, lng: toLng };

  return {
    coords,
    steps:         [depart, arrive],
    legs:          [[depart, arrive]],
    totalDistance: result.dist,
    totalDuration: result.dur,
    isProper:      true,
    fromCache:     false,
  };
}
