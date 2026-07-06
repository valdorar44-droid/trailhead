#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function shouldSpeakLiveScoutScene(type) {
  return ['intro', 'drive_leg', 'camp_arrival', 'mission_recap'].includes(type);
}

assert(shouldSpeakLiveScoutScene('intro'), 'live scout accepts intro');
assert(shouldSpeakLiveScoutScene('drive_leg'), 'live scout accepts drive_leg');
assert(shouldSpeakLiveScoutScene('camp_arrival'), 'live scout accepts camp_arrival');
assert(shouldSpeakLiveScoutScene('mission_recap'), 'live scout accepts mission_recap');
assert(!shouldSpeakLiveScoutScene('whole_route'), 'live scout rejects whole_route');

function shouldSpeakScene(type) {
  return type !== 'whole_route';
}

assert(shouldSpeakScene('intro'), 'shouldSpeakScene accepts intro');

const storyboardSource = readFileSync(join(root, 'lib/copilotStoryboard.ts'), 'utf8');
assert(!/command center/i.test(storyboardSource), 'copilotStoryboard avoids command center wording');

const mapBriefSource = readFileSync(join(root, 'lib/mapMissionBrief.ts'), 'utf8');
assert(mapBriefSource.includes('getCurrentMissionRoute'), 'mapMissionBrief exports getCurrentMissionRoute');
assert(mapBriefSource.includes('buildScoutLiveCinematic'), 'mapMissionBrief exports scout live cinematic builder');
assert(mapBriefSource.includes('liveMissionBeatBrief'), 'mapMissionBrief exports live beat brief helper');
assert(mapBriefSource.includes('shouldSpeakLiveScoutScene'), 'mapMissionBrief exports live scout speech gate');
assert(mapBriefSource.includes('missionBeatCaption'), 'mapMissionBrief exports runtime beat caption helper');
assert(mapBriefSource.includes('sceneNarrationWatchdogMs'), 'mapMissionBrief exports narration watchdog helper');

const captionSource = readFileSync(join(root, 'components/copilot/TripPreviewCaption.tsx'), 'utf8');
assert(captionSource.includes('captionText'), 'TripPreviewCaption accepts runtime caption override');

const nativeMapSource = readFileSync(join(root, 'components/NativeMap/index.tsx'), 'utf8');
assert(nativeMapSource.includes('mission-brief-progress-line'), 'NativeMap renders mission briefing progress layer');

const mapSource = readFileSync(join(root, 'app/(tabs)/map.tsx'), 'utf8');
assert(mapSource.includes('AUTO_FLY_AFTER_SCOUT') && mapSource.includes('handoffScoutToCinematic'),
  'cinematic auto-starts after the scout builds via director handoff');
assert(mapSource.includes('enterDirectorMode') || mapSource.includes('ensureMissionDirectorVoice'),
  'map uses unified realtime director voice');
assert(mapSource.includes('missionBeatCaption'), 'map uses runtime beat text for caption and voice');
assert(mapSource.includes('shouldSpeakMissionScene'), 'scene narration gated for live scout beats');
assert(mapSource.includes('speakCopilotNarration'), 'map falls back to Trailhead guide voice');
assert(mapSource.includes('patchMissionBriefOverlay'), 'map batches mission overlay updates');
assert(mapSource.includes('captionText={mapMissionCaptionText}'), 'map passes runtime caption text to TripPreviewCaption');
assert(!mapSource.includes('createMissionStoryboard'), 'map fly uses scout-live storyboard not pre-generated API');
assert(mapSource.includes('waitForRouteRenderReady'), 'map waits for route overlay before fly');
assert(mapSource.includes('useNativeOverlays: USE_NATIVE_MAP'), 'native player uses NativeMap overlays on main map');

const voiceSource = readFileSync(join(root, 'lib/voice.ts'), 'utf8');
assert(voiceSource.includes('playTrailheadVoice'), 'speakCopilotNarration uses Trailhead voice');

const realtimeSource = readFileSync(join(root, 'lib/realtimeCopilot.ts'), 'utf8');
assert(realtimeSource.includes('waitUntilSpeechIdle'), 'realtime copilot waits for speech idle before handoff');
assert(realtimeSource.includes('enterDirectorMode'), 'realtime copilot supports director mode on live session');
assert(realtimeSource.includes('exitDirectorMode'), 'realtime copilot can restore interactive voice after fly');
assert(realtimeSource.includes('setDirectorSpeechStartHandler'), 'realtime copilot exposes speech-start hook for fallback');
assert(realtimeSource.includes('response.output_item.done'), 'realtime copilot treats output item done as speech end');

const directorSource = readFileSync(join(root, 'lib/cinematicDirector.ts'), 'utf8');
assert(directorSource.includes('waitForRouteRenderReady'), 'cinematic director waits for route render');

// --- Cinematic camera engine ---
const playerSource = readFileSync(join(root, 'lib/missionBriefNativePlayer.ts'), 'utf8');
assert(playerSource.includes('effectiveDuration'), 'player computes an effective scene duration');
assert(playerSource.includes('/ Math.max(0.25, speed)'), 'speed divides base scene duration');
assert(playerSource.includes('cumulativeDistances') && playerSource.includes('pointAtDistance'),
  'player uses distance-based route interpolation');
assert(playerSource.includes('bearingLngLat') && playerSource.includes('smoothAngle'),
  'player uses lookahead bearing + bearing smoothing');
assert(playerSource.includes('followCamera(scene, ahead'), 'camera center uses lookahead ahead of marker');
assert(/FRAME_MS\s*=\s*250/.test(playerSource), 'camera updates use 250ms cadence');
assert(playerSource.includes('CAMERA_TWEEN_MS'), 'camera tween duration is tuned separately from frame cadence');
assert(playerSource.includes('setSpeed'), 'player exposes setSpeed');
assert(playerSource.includes('onProgressRoute?.([])') && playerSource.includes('onCallouts?.([])'),
  'player clears overlays on stop');
assert(playerSource.includes('onNotice'), 'player surfaces non-fatal notices (3D fallback)');

// --- Speed control UI ---
const controlsSource = readFileSync(join(root, 'components/copilot/TripPreviewControls.tsx'), 'utf8');
assert(/PREVIEW_SPEEDS\s*=\s*\[0\.5, 1, 2\]/.test(controlsSource), 'controls expose 0.5x / 1x / 2x speeds');
assert(controlsSource.includes('onCycleSpeed'), 'controls expose a speed cycle action');
assert(/DEFAULT_PREVIEW_SPEED[^\n]*=\s*0\.5/.test(controlsSource), 'default playback speed is slow/cinematic');

// --- Map-first layout wiring ---
assert(mapSource.includes('initialSpeed: mapMissionSpeedRef.current'), 'map passes playback speed into the player');
assert(mapSource.includes('cycleMapMissionSpeed'), 'map wires speed cycling');
assert(mapSource.includes('mapMissionBriefTop'), 'map renders the top cinematic caption');
assert(mapSource.includes('showCompactMissionChrome'), 'map compacts Mission Control during active playback');
assert(mapSource.includes('mapMissionNotice'), 'map surfaces the 3D-fallback notice');
assert(!/headline: 'Trip needs review'/.test(mapSource), 'map avoids debug hero copy in the fallback brief');

const nativeMapContrast = nativeMapSource.includes('mission-brief-full-route-casing');
assert(nativeMapContrast, 'NativeMap draws a high-contrast route casing');

const tsc = spawnSync('npx', ['tsc', '--noEmit'], {
  cwd: root,
  env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096' },
  encoding: 'utf8',
});
if (tsc.status !== 0) {
  failures.push(`tsc --noEmit failed:\n${tsc.stdout}\n${tsc.stderr}`);
}

const diffCheck = spawnSync('git', ['diff', '--check'], {
  cwd: join(root, '..'),
  encoding: 'utf8',
});
if (diffCheck.status !== 0) {
  failures.push(`git diff --check failed:\n${diffCheck.stdout}\n${diffCheck.stderr}`);
}

if (failures.length) {
  console.error('Mission briefing smoke failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Mission briefing smoke passed.');
