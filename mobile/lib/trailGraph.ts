export type TrailGraphSelection = {
  features: GeoJSON.Feature[];
  stats: {
    segments: number;
    lengthM: number;
    loopLikely: boolean;
    source: 'graph';
  };
};

type Coord = [number, number];

type Candidate = {
  id: string;
  name: string;
  coords: Coord[];
  start: Coord;
  end: Coord;
  lengthM: number;
  distanceToSeedM: number;
  nameScore: number;
};

const NODE_PRECISION = 5;
const CONNECT_M = 78;
const MAX_SEED_DISTANCE_M = 8500;
const MAX_LENGTH_M = 140_000;
const MAX_SEGMENTS = 140;

function coordDistanceM(a: Coord, b: Coord) {
  const lat = ((a[1] + b[1]) / 2) * Math.PI / 180;
  const x = (b[0] - a[0]) * Math.cos(lat) * 111_320;
  const y = (b[1] - a[1]) * 110_540;
  return Math.hypot(x, y);
}

function routeLengthM(coords: Coord[]) {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += coordDistanceM(coords[i - 1], coords[i]);
  return total;
}

function pointToSegmentDistanceM(p: Coord, a: Coord, b: Coord) {
  const lat = ((p[1] + a[1] + b[1]) / 3) * Math.PI / 180;
  const scaleX = Math.cos(lat) * 111_320;
  const scaleY = 110_540;
  const px = p[0] * scaleX, py = p[1] * scaleY;
  const ax = a[0] * scaleX, ay = a[1] * scaleY;
  const bx = b[0] * scaleX, by = b[1] * scaleY;
  const vx = bx - ax, vy = by - ay;
  const len2 = vx * vx + vy * vy;
  if (len2 <= 0.01) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
}

function lineDistanceToPointM(coords: Coord[], point: Coord) {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < coords.length; i++) {
    best = Math.min(best, pointToSegmentDistanceM(point, coords[i - 1], coords[i]));
    if (best < 10) break;
  }
  return best;
}

function normalizeName(value?: string) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\b(trail|path|road|route|loop|connector|spur|trailhead)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function namesCompatible(a?: string, b?: string) {
  const aa = normalizeName(a);
  const bb = normalizeName(b);
  if (!aa || !bb) return true;
  return aa === bb || aa.includes(bb) || bb.includes(aa);
}

function nodeKey(coord: Coord) {
  return `${coord[0].toFixed(NODE_PRECISION)},${coord[1].toFixed(NODE_PRECISION)}`;
}

function propertiesName(props: any) {
  return String(
    props?.name
    ?? props?.trail_name
    ?? props?.ref
    ?? props?.mvum_symbol_name
    ?? props?.symbol
    ?? '',
  ).trim();
}

function flattenFeature(feature: any, seed: Coord, wantedName?: string): Candidate[] {
  const geometry = feature?.geometry;
  if (!geometry || (geometry.type !== 'LineString' && geometry.type !== 'MultiLineString')) return [];
  const props = feature.properties ?? {};
  const name = propertiesName(props);
  const normalized = normalizeName(name);
  const wanted = normalizeName(wantedName);
  const nameScore = wanted && normalized
    ? normalized === wanted ? 4 : normalized.includes(wanted) || wanted.includes(normalized) ? 3 : 0
    : 1;
  const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
  return lines.map((raw: any, idx: number) => {
    const coords = (raw ?? [])
      .map((c: any) => [Number(c?.[0]), Number(c?.[1])] as Coord)
      .filter((c: Coord) => Number.isFinite(c[0]) && Number.isFinite(c[1]));
    if (coords.length < 2) return null;
    const lengthM = routeLengthM(coords);
    if (lengthM < 8) return null;
    return {
      id: `${feature?.id ?? props?.trail_id ?? props?.segment_id ?? name ?? 'trail'}:${idx}:${nodeKey(coords[0])}`,
      name,
      coords,
      start: coords[0],
      end: coords[coords.length - 1],
      lengthM,
      distanceToSeedM: lineDistanceToPointM(coords, seed),
      nameScore,
    };
  }).filter(Boolean) as Candidate[];
}

function endpointsTouch(a: Candidate, b: Candidate) {
  return coordDistanceM(a.start, b.start) <= CONNECT_M
    || coordDistanceM(a.start, b.end) <= CONNECT_M
    || coordDistanceM(a.end, b.start) <= CONNECT_M
    || coordDistanceM(a.end, b.end) <= CONNECT_M;
}

function buildAdjacency(candidates: Candidate[]) {
  const adjacency = new Map<string, Set<string>>();
  for (const c of candidates) adjacency.set(c.id, new Set());

  const nodeBuckets = new Map<string, Candidate[]>();
  for (const c of candidates) {
    for (const key of [nodeKey(c.start), nodeKey(c.end)]) {
      const bucket = nodeBuckets.get(key) ?? [];
      bucket.push(c);
      nodeBuckets.set(key, bucket);
    }
  }

  for (const bucket of nodeBuckets.values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        adjacency.get(bucket[i].id)?.add(bucket[j].id);
        adjacency.get(bucket[j].id)?.add(bucket[i].id);
      }
    }
  }

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      if (!endpointsTouch(candidates[i], candidates[j])) continue;
      adjacency.get(candidates[i].id)?.add(candidates[j].id);
      adjacency.get(candidates[j].id)?.add(candidates[i].id);
    }
  }
  return adjacency;
}

function componentFrom(seed: Candidate, candidatesById: Map<string, Candidate>, adjacency: Map<string, Set<string>>, wantedName?: string) {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const queue = [seed.id];
  let lengthM = 0;
  while (queue.length && out.length < MAX_SEGMENTS && lengthM < MAX_LENGTH_M) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const candidate = candidatesById.get(id);
    if (!candidate) continue;
    if (wantedName && candidate.name && !namesCompatible(candidate.name, wantedName) && candidate.distanceToSeedM > 950) continue;
    out.push(candidate);
    lengthM += candidate.lengthM;
    const next = [...(adjacency.get(id) ?? [])]
      .map(nextId => candidatesById.get(nextId))
      .filter(Boolean)
      .sort((a, b) => ((b!.nameScore - a!.nameScore) || (a!.distanceToSeedM - b!.distanceToSeedM))) as Candidate[];
    for (const n of next) if (!seen.has(n.id)) queue.push(n.id);
  }
  return out;
}

function likelyLoop(candidates: Candidate[]) {
  if (!candidates.length) return false;
  const counts = new Map<string, number>();
  for (const c of candidates) {
    counts.set(nodeKey(c.start), (counts.get(nodeKey(c.start)) ?? 0) + 1);
    counts.set(nodeKey(c.end), (counts.get(nodeKey(c.end)) ?? 0) + 1);
  }
  const odd = [...counts.values()].filter(v => v % 2 === 1).length;
  return odd <= 2 && candidates.length >= 3;
}

export function buildOfflineTrailGraphSelection(features: any[], seed: Coord, trailName?: string): TrailGraphSelection {
  const candidates = features
    .flatMap(feature => flattenFeature(feature, seed, trailName))
    .filter(c => {
      if (c.distanceToSeedM > MAX_SEED_DISTANCE_M) return false;
      if (trailName && c.name && !namesCompatible(c.name, trailName) && c.distanceToSeedM > 1200) return false;
      return true;
    })
    .sort((a, b) => (b.nameScore - a.nameScore) || (a.distanceToSeedM - b.distanceToSeedM));

  const seedCandidate = candidates.find(c => c.distanceToSeedM <= 320 && (c.nameScore > 0 || !trailName))
    ?? candidates.find(c => c.distanceToSeedM <= 900)
    ?? candidates[0];

  if (!seedCandidate) return { features: [], stats: { segments: 0, lengthM: 0, loopLikely: false, source: 'graph' } };

  const byId = new Map(candidates.map(c => [c.id, c]));
  const adjacency = buildAdjacency(candidates);
  const selected = componentFrom(seedCandidate, byId, adjacency, trailName);
  const selectedIds = new Set(selected.map(c => c.id));

  for (const candidate of candidates) {
    if (selected.length >= MAX_SEGMENTS) break;
    if (selectedIds.has(candidate.id)) continue;
    if (candidate.distanceToSeedM > 2400) continue;
    if (candidate.nameScore <= 0 && !namesCompatible(candidate.name, seedCandidate.name)) continue;
    selected.push(candidate);
    selectedIds.add(candidate.id);
  }

  const seenGeometry = new Set<string>();
  const out = selected.flatMap(candidate => {
    const key = `${nodeKey(candidate.start)}:${nodeKey(candidate.end)}`;
    const reverseKey = `${nodeKey(candidate.end)}:${nodeKey(candidate.start)}`;
    if (seenGeometry.has(key) || seenGeometry.has(reverseKey)) return [];
    seenGeometry.add(key);
    return [{
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: candidate.coords },
      properties: {
        name: candidate.name || trailName || 'Selected trail',
        selected: 1,
        graph: 1,
      },
    } as GeoJSON.Feature];
  });

  return {
    features: out,
    stats: {
      segments: out.length,
      lengthM: selected.reduce((sum, c) => sum + c.lengthM, 0),
      loopLikely: likelyLoop(selected),
      source: 'graph',
    },
  };
}
