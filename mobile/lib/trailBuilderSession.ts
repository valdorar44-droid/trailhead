import { parseGpx, thinTrackCoords, type ParsedGpx } from './gpxParser';

export type TrailBuilderMode = 'canonical' | 'points' | 'draw' | 'gpx';
export type TrailBuilderActivity = 'hike' | 'bike' | 'horse' | 'ohv' | 'mixed';
export type TrailBuilderUseState = 'allowed' | 'not_allowed' | 'not_listed';

export type TrailBuilderAnchor<T = unknown> = Readonly<{
  coord: readonly [number, number];
  context?: T;
}>;

export type TrailBuilderHistory<T = unknown> = Readonly<{
  anchors: readonly TrailBuilderAnchor<T>[];
  redo: readonly TrailBuilderAnchor<T>[];
}>;

export type TrailBuilderGpxReview = Readonly<{
  parsed: ParsedGpx;
  name: string;
  coords: readonly [number, number][];
  sourcePointCount: number;
  distanceMiles: number;
  waypointCount: number;
  containsTimestamps: boolean;
}>;

export const TRAIL_BUILDER_GPX_MAX_BYTES = 10 * 1024 * 1024;
export const TRAIL_BUILDER_GPX_MAX_POINTS = 50_000;

const USE_ALIASES: Record<TrailBuilderActivity, readonly string[]> = {
  hike: ['hike', 'hiking', 'walk', 'walking', 'foot', 'pedestrian'],
  bike: ['bike', 'biking', 'bicycle', 'cycling', 'mountain bike', 'mtb'],
  horse: ['horse', 'horseback', 'equestrian'],
  ohv: ['ohv', '4wd', '4x4', 'off road', 'off-road', 'motor vehicle', 'motorized'],
  mixed: ['mixed', 'multi-use', 'multi use', 'shared use'],
};

function normalizedUses(values?: readonly string[] | null): string[] {
  return (values ?? [])
    .map(value => String(value || '').trim().toLowerCase())
    .filter(Boolean);
}

export function trailBuilderUseState(
  activity: TrailBuilderActivity,
  permittedUses?: readonly string[] | null,
): TrailBuilderUseState {
  const uses = normalizedUses(permittedUses);
  if (uses.length === 0) return 'not_listed';
  if (activity === 'mixed') {
    return uses.some(value => TRAIL_BUILDER_USE_ORDER.slice(0, 4)
      .some(item => TRAIL_BUILDER_USE_ALIASES(item).some(alias => value.includes(alias))))
      ? 'allowed'
      : 'not_allowed';
  }
  return uses.some(value => TRAIL_BUILDER_USE_ALIASES(activity).some(alias => value.includes(alias)))
    ? 'allowed'
    : 'not_allowed';
}

function TRAIL_BUILDER_USE_ALIASES(activity: TrailBuilderActivity) {
  return USE_ALIASES[activity];
}

export const TRAIL_BUILDER_USE_ORDER: readonly TrailBuilderActivity[] = [
  'hike', 'bike', 'horse', 'ohv', 'mixed',
];

export function trailBuilderActivityLabel(activity: TrailBuilderActivity): string {
  if (activity === 'hike') return 'Hike';
  if (activity === 'bike') return 'Bike';
  if (activity === 'horse') return 'Horse';
  if (activity === 'ohv') return 'OHV / 4WD';
  return 'Mixed use';
}

export function trailBuilderRoutingProfile(activity: TrailBuilderActivity): Readonly<{
  stadia: 'pedestrian' | 'bicycle' | 'auto';
  graphhopper: 'foot' | 'bike' | 'car';
  mapbox: 'walking' | 'cycling' | 'driving';
  requiresAccessReview: boolean;
}> {
  if (activity === 'bike') return { stadia: 'bicycle', graphhopper: 'bike', mapbox: 'cycling', requiresAccessReview: false };
  if (activity === 'ohv') return { stadia: 'auto', graphhopper: 'car', mapbox: 'driving', requiresAccessReview: true };
  return {
    stadia: 'pedestrian',
    graphhopper: 'foot',
    mapbox: 'walking',
    requiresAccessReview: activity === 'horse' || activity === 'mixed',
  };
}

export function trailBuilderAccessMessage(
  activity: TrailBuilderActivity,
  permittedUses?: readonly string[] | null,
): string {
  const state = trailBuilderUseState(activity, permittedUses);
  const label = trailBuilderActivityLabel(activity);
  if (state === 'not_allowed') return `${label} is not listed as a permitted use for this trail.`;
  if (state === 'not_listed') return `Permitted uses are not listed. Confirm ${label.toLowerCase()} access before following.`;
  return '';
}

export function appendTrailBuilderAnchor<T>(
  history: TrailBuilderHistory<T>,
  anchor: TrailBuilderAnchor<T>,
): TrailBuilderHistory<T> {
  return { anchors: [...history.anchors, anchor], redo: [] };
}

export function undoTrailBuilderAnchor<T>(history: TrailBuilderHistory<T>): TrailBuilderHistory<T> {
  if (history.anchors.length === 0) return history;
  const removed = history.anchors[history.anchors.length - 1];
  return {
    anchors: history.anchors.slice(0, -1),
    redo: [removed, ...history.redo],
  };
}

export function redoTrailBuilderAnchor<T>(history: TrailBuilderHistory<T>): TrailBuilderHistory<T> {
  if (history.redo.length === 0) return history;
  return {
    anchors: [...history.anchors, history.redo[0]],
    redo: history.redo.slice(1),
  };
}

export function reverseTrailBuilderRoute(coords: readonly [number, number][]): [number, number][] {
  return [...coords].reverse().map(([lng, lat]) => [lng, lat]);
}

export function outAndBackTrailBuilderRoute(coords: readonly [number, number][]): [number, number][] {
  if (coords.length < 2) return coords.map(([lng, lat]) => [lng, lat]);
  return [
    ...coords.map(([lng, lat]) => [lng, lat] as [number, number]),
    ...coords.slice(0, -1).reverse().map(([lng, lat]) => [lng, lat] as [number, number]),
  ];
}

export function closeTrailBuilderLoop(coords: readonly [number, number][]): [number, number][] {
  if (coords.length < 3) return coords.map(([lng, lat]) => [lng, lat]);
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return coords.map(([lng, lat]) => [lng, lat]);
  return [...coords.map(([lng, lat]) => [lng, lat] as [number, number]), [first[0], first[1]]];
}

export function trailBuilderEditAnchorIndices(coordCount: number, maxAnchors = 8): number[] {
  const count = Math.max(0, Math.floor(coordCount));
  const limit = Math.max(2, Math.floor(maxAnchors));
  if (count === 0) return [];
  if (count === 1) return [0];
  const desiredCount = Math.min(limit, count, Math.max(3, Math.ceil(count / 80)));
  return [...new Set(Array.from({ length: desiredCount }, (_, index) => (
    Math.round((index / Math.max(1, desiredCount - 1)) * (count - 1))
  )))];
}

export function reviewTrailBuilderGpx(
  content: string,
  fileName: string,
  byteSize = Array.from(content).reduce((sum, char) => {
    const code = char.codePointAt(0) ?? 0;
    return sum + (code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4);
  }, 0),
): TrailBuilderGpxReview {
  if (byteSize <= 0) throw new Error('This GPX file is empty.');
  if (byteSize > TRAIL_BUILDER_GPX_MAX_BYTES) throw new Error('Choose a GPX file smaller than 10 MB.');
  const parsed = parseGpx(content, fileName);
  const sourcePointCount = parsed.tracks.reduce((sum, track) => sum + track.rawPointCount, 0);
  if (sourcePointCount > TRAIL_BUILDER_GPX_MAX_POINTS) {
    throw new Error('This GPX has too many track points. Simplify it below 50,000 points and try again.');
  }
  const track = [...parsed.tracks].sort((a, b) => b.distanceMiles - a.distanceMiles)[0];
  if (!track || track.coords.length < 2) throw new Error('This GPX does not contain a route to review.');
  const coords = thinTrackCoords(track.coords);
  return {
    parsed,
    name: track.name || parsed.name,
    coords,
    sourcePointCount: track.rawPointCount,
    distanceMiles: track.distanceMiles,
    waypointCount: parsed.waypoints.length,
    containsTimestamps: /<time(?:\s|>)/i.test(content),
  };
}
