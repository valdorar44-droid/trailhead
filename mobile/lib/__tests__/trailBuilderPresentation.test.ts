import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const panelSource = fs.readFileSync(path.join(root, 'components/trails/TrailBuilderPanel.tsx'), 'utf8');
const mapSource = fs.readFileSync(path.join(root, 'app/(tabs)/map.tsx'), 'utf8');

test('Trail Builder uses the approved hierarchy and plain-language routing labels', () => {
  for (const label of [
    'Trail Builder',
    'Trail',
    'Roads',
    '4WD roads',
    'Hybrid · trails and roads',
    'Straight line',
    'Apply routing',
    'Route ready',
    '3D preview',
    'Start Follow',
    'Draw a line',
    'Review line',
  ]) {
    assert.ok(panelSource.includes(label) || mapSource.includes(label), `missing ${label}`);
  }
  assert.ok(!panelSource.includes('fontFamily: mono'));
  assert.ok(!panelSource.includes('FOLLOW TRAILS'));
  assert.ok(!panelSource.includes('AI'));
});

test('Trail Builder keeps driving-safe targets and stable automation IDs', () => {
  assert.match(panelSource, /height: 48/);
  assert.match(panelSource, /minHeight: 48/);
  assert.match(panelSource, /width: 48/);
  for (const testID of [
    'trail.builder.activity',
    'trail.builder.routing.open',
    'trail.builder.routing.apply',
    'trail.builder.points.build',
    'trail.builder.draw.undo',
    'trail.builder.draw.clear',
    'trail.builder.draw.review',
  ]) {
    assert.ok(panelSource.includes(testID), `missing ${testID}`);
  }
});

test('Trail Builder actions stay above the platform gesture area', () => {
  const safeBottomPattern = /style=\{\[s\.trailRouteBuilderWrap, \{ bottom: Math\.max\(insets\.bottom, 8\) \}\]\}/g;
  assert.equal(
    mapSource.match(safeBottomPattern)?.length,
    3,
    'draw, point, and review sheets must all respect the bottom safe area',
  );
  assert.ok(!mapSource.includes('style={s.trailRouteBuilderWrap}'), 'no builder sheet may sit flush against the gesture edge');
});

test('Draw review is explicit and routing changes rebuild with the selected mode', () => {
  assert.match(mapSource, /onTraceStart=\{beginTrailTraceStroke\}/);
  assert.match(mapSource, /onTraceEnd=\{finishTrailTraceStroke\}/);
  assert.ok(!mapSource.includes('onTraceEnd={finishTrailTrace}'));
  assert.match(mapSource, /onReview=\{\(\) => \{ void finishTrailTrace\(\); \}\}/);
  assert.match(mapSource, /snapMode: nextMode/);
  assert.match(mapSource, /const routeMode = opts\.snapMode \?\? trailSnapMode/);
});

test('Route ready preserves Save, flyover, Follow, reshape, and point editing', () => {
  assert.match(mapSource, /nameAndSaveTrailRoutePlan/);
  assert.match(mapSource, /flyTrailRoutePlan/);
  assert.match(mapSource, /startTrailRoutePlan/);
  assert.match(mapSource, /applyTrailRouteShape\('reverse'\)/);
  assert.match(mapSource, /applyTrailRouteShape\('out_back'\)/);
  assert.match(mapSource, /applyTrailRouteShape\('loop'\)/);
  assert.match(panelSource, /TrailBuilderRouteOptionsSheet/);
  assert.match(mapSource, /function editSelectedTrailRoutePoints\(\)/);
  assert.match(mapSource, /setTrailPinCaptureMode\(true\)/);
});

test('manual rebuild commits the current edited-anchor snapshot', () => {
  assert.match(
    mapSource,
    /onBuild=\{\(\) => \{ void capturePinnedTrailRoute\(trailCaptureAnchors\); \}\}/,
    'post-edit Build must use the same identity-bound anchor snapshot as routing, undo, and redo rebuilds',
  );
  assert.ok(!mapSource.includes('onBuild={() => { void capturePinnedTrailRoute(); }}'));
});
