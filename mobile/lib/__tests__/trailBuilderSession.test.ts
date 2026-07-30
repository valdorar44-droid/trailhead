import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  appendTrailBuilderAnchor,
  closeTrailBuilderLoop,
  outAndBackTrailBuilderRoute,
  redoTrailBuilderAnchor,
  reviewTrailBuilderGpx,
  reverseTrailBuilderRoute,
  trailBuilderAccessMessage,
  trailBuilderEditAnchorIndices,
  trailBuilderRoutingProfile,
  trailBuilderUseState,
  undoTrailBuilderAnchor,
} from '../trailBuilderSession';

test('point history supports deterministic undo and redo and clears redo after a new point', () => {
  const empty = { anchors: [], redo: [] };
  const one = appendTrailBuilderAnchor(empty, { coord: [-109.5, 38.5] as const });
  const two = appendTrailBuilderAnchor(one, { coord: [-109.4, 38.6] as const });
  const undone = undoTrailBuilderAnchor(two);
  assert.equal(undone.anchors.length, 1);
  assert.deepEqual(undone.redo[0].coord, [-109.4, 38.6]);
  const redone = redoTrailBuilderAnchor(undone);
  assert.deepEqual(redone.anchors, two.anchors);
  const replaced = appendTrailBuilderAnchor(undone, { coord: [-109.3, 38.7] as const });
  assert.equal(replaced.redo.length, 0);
});

test('route transformations keep exact coordinates and produce reviewable shapes', () => {
  const route: [number, number][] = [[-109.5, 38.5], [-109.4, 38.6], [-109.3, 38.7]];
  assert.deepEqual(reverseTrailBuilderRoute(route), [...route].reverse());
  assert.deepEqual(outAndBackTrailBuilderRoute(route), [route[0], route[1], route[2], route[1], route[0]]);
  assert.deepEqual(closeTrailBuilderLoop(route), [route[0], route[1], route[2], route[0]]);
  assert.deepEqual(route, [[-109.5, 38.5], [-109.4, 38.6], [-109.3, 38.7]], 'source geometry is immutable');
});

test('editing short and closed routes keeps an interior turning anchor', () => {
  assert.deepEqual(trailBuilderEditAnchorIndices(2), [0, 1]);
  assert.deepEqual(
    trailBuilderEditAnchorIndices(3),
    [0, 1, 2],
    'an out-and-back start, turn, start route must not collapse to two identical endpoints',
  );
  assert.deepEqual(trailBuilderEditAnchorIndices(161), [0, 80, 160]);
  assert.equal(trailBuilderEditAnchorIndices(10_000).length, 8);
});

test('source-backed permitted uses block unsupported activity without inventing access', () => {
  assert.equal(trailBuilderUseState('hike', ['hiking', 'horseback']), 'allowed');
  assert.equal(trailBuilderUseState('bike', ['hiking', 'horseback']), 'not_allowed');
  assert.equal(trailBuilderUseState('ohv', []), 'not_listed');
  assert.match(trailBuilderAccessMessage('bike', ['hiking']), /not listed as a permitted use/i);
  assert.match(trailBuilderAccessMessage('horse', []), /permitted uses are not listed/i);
  assert.equal(trailBuilderRoutingProfile('bike').mapbox, 'cycling');
  assert.equal(trailBuilderRoutingProfile('ohv').requiresAccessReview, true);
});

test('GPX review selects the longest track, strips private metadata from the route, and reports it', () => {
  const gpx = `<?xml version="1.0"?><gpx version="1.1"><metadata><name>Weekend Loop</name></metadata>
    <wpt lat="38.50" lon="-109.50"><name>Private camp</name></wpt>
    <trk><name>Short spur</name><trkseg><trkpt lat="38.50" lon="-109.50"/><trkpt lat="38.501" lon="-109.501"/></trkseg></trk>
    <trk><name>Main loop</name><trkseg><trkpt lat="38.50" lon="-109.50"><time>2026-07-28T01:00:00Z</time></trkpt><trkpt lat="38.60" lon="-109.60"/><trkpt lat="38.70" lon="-109.70"/></trkseg></trk>
  </gpx>`;
  const review = reviewTrailBuilderGpx(gpx, 'weekend.gpx');
  assert.equal(review.name, 'Main loop');
  assert.equal(review.coords.length, 3);
  assert.equal(review.containsTimestamps, true);
  assert.equal(review.waypointCount, 1);
  assert.equal('time' in (review.coords[0] as unknown as object), false);
});

test('GPX review rejects empty routes, oversized files, and excessive point counts', () => {
  assert.throws(() => reviewTrailBuilderGpx('<gpx version="1.1"></gpx>', 'empty.gpx'), /does not contain a route/i);
  assert.throws(() => reviewTrailBuilderGpx('<gpx version="1.1"></gpx>', 'large.gpx', 10 * 1024 * 1024 + 1), /smaller than 10 MB/i);
  const points = Array.from({ length: 50_001 }, (_, index) => `<trkpt lat="38.${String(index % 1000).padStart(3, '0')}" lon="-109.${String(index % 1000).padStart(3, '0')}"/>`).join('');
  assert.throws(
    () => reviewTrailBuilderGpx(`<gpx version="1.1"><trk><trkseg>${points}</trkseg></trk></gpx>`, 'dense.gpx'),
    /too many track points/i,
  );
});

test('builder discard restores its invoking trail context and exposes route transforms', () => {
  const mapSource = readFileSync('app/(tabs)/map.tsx', 'utf8');
  const panelSource = readFileSync('components/trails/TrailBuilderPanel.tsx', 'utf8');
  assert.match(mapSource, /trailBuilderReturnContextRef/);
  assert.match(mapSource, /restoreTrailBuilderReturnContext\(\)/);
  assert.match(mapSource, /testIDPrefix="trail\.builder\.points"/);
  assert.match(panelSource, /\$\{testIDPrefix\}\.route-options/);
  assert.match(mapSource, /applyTrailRouteShape\('reverse'\)/);
  assert.match(mapSource, /applyTrailRouteShape\('out_back'\)/);
  assert.match(mapSource, /applyTrailRouteShape\('loop'\)/);
  assert.match(panelSource, /trail\.builder\.route-shape\.\$\{action\.id\}/);
});
