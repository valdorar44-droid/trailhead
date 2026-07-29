import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { trailFollowCameraAction, transitionTrailFollowCamera } from '../trailFollowCameraOwnership';

const here = path.dirname(fileURLToPath(import.meta.url));
const map = fs.readFileSync(path.resolve(here, '../../app/(tabs)/map.tsx'), 'utf8');
const background = fs.readFileSync(path.resolve(here, '../backgroundTasks.ts'), 'utf8');
const repository = fs.readFileSync(path.resolve(here, '../trailRecordingRepository.ts'), 'utf8');
const config = fs.readFileSync(path.resolve(here, '../../app.config.js'), 'utf8');

assert.match(map, /resolveTrailFollowStart\(\{/);
assert.match(map, /sourceBackedTrailheads\(trail\)/);
assert.match(map, /trail\.trailheads_v2\?\.length/);
assert.match(map, /setTrailRoutePlans\(existing => existing\.length \? existing : \[plan\]\)/);
assert.match(map, /async function startSelectedTrailNavigation\(trail: TrailFeature\)/);
assert.match(map, /const system = await api\.getTrailSystem\(trail\.system_v2_id\)/);
assert.match(map, /startSelectedTrailNavigation\(selectedTrail\)/);
assert.match(map, /nativeMapRef\.current\?\.restoreRoute\(plan\.coords/);
assert.match(map, /const presentTrailFollowRoute = useCallback/);
assert.match(map, /const presentTrailFollowHandoffContext = useCallback/);
assert.match(map, /nativeMapRef\.current\?\.highlightResolvedTrail\(geometry/);
assert.match(map, /if \(handoff\?\.phase === 'handoff'\)[\s\S]*presentTrailFollowHandoffContext\(handoff\)/);
assert.match(map, /presentTrailFollowRoute\(trailFollowSession, trailFollowCameraMode === 'route_overview'\)/);
assert.match(map, /onOpenRoute=\{\(\) => \{[\s\S]*transitionTrailFollowCamera\(trailFollowCameraModeRef\.current, 'route_button'\)/);
assert.match(map, /navCameraFollowStateRef\.current = false;\s*setNavCameraFollow\(false\)/);
assert.match(map, /cameraMode=\{trailFollowCameraMode\}/);
assert.match(map, /trailFollowActive=\{trailFollowSession\?\.phase === 'follow'/);
assert.match(map, /!trailFollowSession && routeFromCache && navMode/);
assert.match(map, /!trailFollowSession && !!routeDebug && !isRouted/);
assert.match(map, /handoffRouteUnavailable: trailFollowSession\.phase === 'handoff'/);
assert.match(map, /const trailFollowOwnsHud = Boolean\(trailFollowSession\)/);
assert.match(map, /const canOpenMapDrawer = !trailFollowSession/);
assert.match(map, /const showInlineMapSearch = Boolean\(\s*!trailFollowSession/);
assert.match(map, /<TrailFollowHud/);
assert.match(map, /End & save|onEndAndSave/);
assert.match(map, /exportTrailRecordingGpx\(completed\.id\)/);
assert.match(map, /Sharing\.shareAsync\(path/);
assert.match(map, /Export GPX/);
assert.match(map, /phase: 'recording_only'/);
assert.match(map, /recording\.followActive \? 'recovery' : 'recording_only'/);
assert.match(repository, /follow_active INTEGER NOT NULL DEFAULT 1/);
assert.match(repository, /markActiveTrailRecordingFollowEnded/);
assert.match(map, /trailFollowSessionRef\.current\?\.phase === 'handoff'/);
assert.doesNotMatch(map, /WebView[^\n]+TrailFollow/);

assert.match(background, /TaskManager\.defineTask\(TRAIL_RECORDING_LOCATION_TASK/);
assert.match(background, /appendTrailRecordingPoint\(recordingPointFromLocation\(location\)\)/);
assert.doesNotMatch(background, /trailRecording[^\n]+telemetry/i);
assert.match(repository, /trail_recording_points/);
assert.match(repository, /exportTrailRecordingGpx/);
assert.doesNotMatch(repository, /fetch\(|api\.|analytics|telemetry/i);

assert.match(config, /isAndroidBackgroundLocationEnabled: false/);
assert.match(config, /active trail recording can continue/);

assert.equal(transitionTrailFollowCamera('follow', 'route_button'), 'route_overview');
assert.equal(transitionTrailFollowCamera('route_overview', 'gesture'), 'free');
assert.equal(transitionTrailFollowCamera('free', 'route_button'), 'follow');
assert.deepEqual(trailFollowCameraAction('route_overview'), { label: 'Recenter', icon: 'locate-outline' });

console.log('trail follow map contract tests passed');
