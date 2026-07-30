import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import type { TrailPreviewManifest } from '../api';
import {
  interpolateTrailPreviewBearing,
  interpolateTrailPreviewFrame,
  normalizeTrailPreviewKeyframes,
  trailPreviewClockLabel,
  trailPreviewDurationMs,
  trailPreviewFinishCoordinate,
  trailPreviewProgressFromPointer,
} from '../trailPreviewPlayback';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const playerSource = readFileSync(join(mobileRoot, 'components/trails/TrailPreviewPlayer.tsx'), 'utf8');
const mapSource = readFileSync(join(mobileRoot, 'app/(tabs)/map.tsx'), 'utf8');
const nativeMapSource = readFileSync(join(mobileRoot, 'components/NativeMap/index.tsx'), 'utf8');

const manifest: TrailPreviewManifest = {
  version: 1,
  status: 'available',
  route_id: 'trail:test:1',
  trail_id: 'trail:test',
  trail_name: 'Test Trail',
  preview_available: true,
  distance_m: 1609,
  coordinates: [[-109, 38], [-108.9, 38.1], [-108.8, 38.2]],
  keyframes: [
    { progress: 1, coordinate: [-108.8, 38.2], bearing: 10, duration_ms: 1000, cumulative_distance_m: 1609 },
    { progress: 0, coordinate: [-109, 38], bearing: 350, duration_ms: 1000, cumulative_distance_m: 0 },
  ],
};

test('keyframes sort deterministically and interpolate the short bearing arc', () => {
  const frames = normalizeTrailPreviewKeyframes(manifest);
  assert.deepEqual(frames.map(frame => frame.progress), [0, 1]);
  const midpoint = interpolateTrailPreviewFrame(frames, 0.5);
  assert.deepEqual(midpoint?.coordinate.map(value => Number(value.toFixed(3))), [-108.9, 38.1]);
  assert.equal(Math.round(midpoint?.bearing ?? -1), 0);
  assert.equal(Math.round(interpolateTrailPreviewBearing(10, 350, 0.5)), 0);
});

test('playback timing, scrub progress and clock labels are bounded', () => {
  const frames = normalizeTrailPreviewKeyframes(manifest);
  assert.equal(trailPreviewDurationMs(frames), 5200);
  assert.equal(trailPreviewProgressFromPointer(-20, 100), 0);
  assert.equal(trailPreviewProgressFromPointer(45, 100), 0.45);
  assert.equal(trailPreviewProgressFromPointer(140, 100), 1);
  assert.equal(trailPreviewClockLabel(138000), '2:18');
});

test('the finish coordinate is the verified manifest endpoint', () => {
  assert.deepEqual(trailPreviewFinishCoordinate(manifest), [-108.8, 38.2]);
  assert.equal(trailPreviewFinishCoordinate({ ...manifest, coordinates: [] }), null);
});

test('T6 remains a silent same-map preview with explicit controls and return semantics', () => {
  assert.match(mapSource, /preview3dActive:\s*mapMissionVisible\s*\|\|\s*trailPreviewOpen/);
  assert.match(mapSource, /onBack=\{returnFromTrailPreview\}/);
  assert.match(mapSource, /onClose=\{exitTrailPreview\}/);
  assert.match(playerSource, /testID="trail\.preview\.scrubber"/);
  assert.match(playerSource, /testID="trail\.preview\.restart"/);
  assert.match(playerSource, /testID="trail\.preview\.recenter"/);
  assert.match(playerSource, /testID="trail\.preview\.back"/);
  assert.match(playerSource, /testID="trail\.preview\.close"/);
  assert.match(mapSource, /selectedTrail && !trailPreviewOpen && !navMode && !trailPinCaptureMode && trailCardCollapsed/);
  assert.match(mapSource, /selectedTrail && !trailPreviewOpen && !navMode && !trailPinCaptureMode && !trailCardCollapsed/);
  assert.doesNotMatch(playerSource, /Speech|voice|narrat/i);
});

test('canonical Trails V2 preview consumes the identity-bound resolved route plan before the network fallback', () => {
  assert.match(mapSource, /trailRoutePlanMatchesOwner\(routePlan, trail\)/);
  assert.match(mapSource, /buildLocalTrailPreviewManifest\(trail, localProfile, candidatePlan\)/);
  assert.match(mapSource, /ownedRoutePlan\?\.coords\?\.length/);
  assert.match(mapSource, /local:\$\{trail\.id\}:\$\{ownedRoutePlan\.geometryRevision/);
});

test('Trail Builder uses the shared T6 player and restores the builder through Back', () => {
  const builderFlyover = mapSource.match(
    /async function flyTrailRoutePlan[\s\S]*?\n  }\n\n  function trailRoutePlanStatus/,
  )?.[0] ?? '';
  assert.match(builderFlyover, /await openTrailPreview\(trail, plan\)/);
  assert.doesNotMatch(builderFlyover, /startMapMissionBrief|missionRouteOverrideRef/);
  assert.match(mapSource, /async function openTrailPreview\(trail: TrailFeature, routePlanOverride: TrailRoutePlan \| null = null\)/);
  assert.match(mapSource, /const candidatePlan = routePlanOverride\s*\?\?/);
  assert.match(mapSource, /testID="trail\.builder\.review"/);
  assert.match(mapSource, /testID="trail\.builder\.route\.flyover"/);
  assert.match(mapSource, /setTrailRouteBuilderOpen\(context\.trailRouteBuilderOpen\)/);
  assert.match(mapSource, /setTrailPinCaptureMode\(context\.trailPinCaptureMode\)/);
  assert.match(mapSource, /setTrailTraceMode\(context\.trailTraceMode\)/);
  assert.match(mapSource, /syncTrailCaptureModeToWeb\(context\.trailPinCaptureMode\)/);
  assert.match(mapSource, /setTrailPinCaptureMode\(false\);\s*setTrailTraceMode\(false\);\s*syncTrailCaptureModeToWeb\(false\)/);
  assert.match(mapSource, /trailTraceMode && !trailPreviewOpen && !navMode/);
  assert.match(mapSource, /trailPinCaptureMode && !trailPreviewOpen && !navMode/);
  assert.equal([...mapSource.matchAll(/trailId: feature\.id/g)].length, 2);
  assert.match(mapSource, /geometryRevision: localTrailPlanGeometryRevision\(coords\)/);
  assert.match(mapSource, /geometryRevision: localTrailPlanGeometryRevision\(clean\)/);
});

test('the preview route keeps its yellow finish diamond on the native map', () => {
  assert.match(nativeMapSource, /id="trail-preview-finish-diamond"/);
  assert.match(nativeMapSource, /textColor:\s*'#F5C84B'/);
  assert.match(nativeMapSource, /trailPreviewVisual\.marker && trailPreviewProgress < 0\.995/);
  assert.match(nativeMapSource, /id="trail-preview-finish-marker"/);
  assert.match(nativeMapSource, /testID="trail\.preview\.finish-diamond"/);
  assert.match(nativeMapSource, /transform:\s*\[\{ rotate: '45deg' \}\]/);
  assert.match(playerSource, /Math\.round\(manifest\.distance_m \* progress\)/);
});
