import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const map = fs.readFileSync(path.resolve(here, '../../app/(tabs)/map.tsx'), 'utf8');
const background = fs.readFileSync(path.resolve(here, '../backgroundTasks.ts'), 'utf8');
const repository = fs.readFileSync(path.resolve(here, '../trailRecordingRepository.ts'), 'utf8');
const config = fs.readFileSync(path.resolve(here, '../../app.config.js'), 'utf8');

assert.match(map, /resolveTrailFollowStart\(\{/);
assert.match(map, /sourceBackedTrailheads\(trail\)/);
assert.match(map, /trail\.trailheads_v2\?\.length/);
assert.match(map, /setTrailRoutePlans\(existing => existing\.length \? existing : \[plan\]\)/);
assert.match(map, /!isTrailhead && selectedTrailRoutePlan/);
assert.match(map, /nativeMapRef\.current\?\.restoreRoute\(plan\.coords/);
assert.match(map, /<TrailFollowHud/);
assert.match(map, /End & save|onEndAndSave/);
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

console.log('trail follow map contract tests passed');
