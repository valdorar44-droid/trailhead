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
assert(mapSource.includes('fetchDirectedCinematic') && mapSource.includes('startDirectedCinematicFetch'),
  'map races the AI-director storyboard against the deterministic builders');
assert(mapSource.includes('missionDirectedPromiseRef.current = startDirectedCinematicFetch'),
  'scout handoff prefetches the AI storyboard so its budget overlaps existing waits');
assert(mapSource.includes('directedCinematic ?? localCinematic'),
  'deterministic cinematic remains the fallback when the AI storyboard misses its budget');
assert(mapSource.includes('waitForRouteRenderReady'), 'map waits for route overlay before fly');

const storyboardClientSource = readFileSync(join(root, 'lib/missionStoryboardClient.ts'), 'utf8');
assert(storyboardClientSource.includes('assembleForwardPass'),
  'AI beats are re-woven locally into a guaranteed forward pass');
assert(storyboardClientSource.includes("generated_by !== 'ai'"),
  'backend-fallback storyboards are skipped in favor of the richer local builder');
assert(/poi_flyover/.test(storyboardSource) && /route_rejoin/.test(storyboardSource),
  'storyboard vocabulary includes poi_flyover + route_rejoin');
assert(mapBriefSource.includes("scene.type !== 'route_rejoin'"),
  'route_rejoin transitions are silent and never wait on voice');
assert(mapSource.includes('useNativeOverlays: USE_NATIVE_MAP'), 'native player uses NativeMap overlays on main map');

const voiceSource = readFileSync(join(root, 'lib/voice.ts'), 'utf8');
assert(voiceSource.includes('playTrailheadVoice'), 'speakCopilotNarration uses Trailhead voice');

const realtimeSource = readFileSync(join(root, 'lib/realtimeCopilot.ts'), 'utf8');
assert(realtimeSource.includes('waitUntilSpeechIdle'), 'realtime copilot waits for speech idle before handoff');
assert(realtimeSource.includes('enterDirectorMode'), 'realtime copilot supports director mode on live session');
assert(realtimeSource.includes('exitDirectorMode'), 'realtime copilot can restore interactive voice after fly');
assert(realtimeSource.includes('setDirectorSpeechStartHandler'), 'realtime copilot exposes speech-start hook for fallback');
assert(mapSource.includes('ensureMissionDirectorVoice(true)'), 'mission always forces realtime director voice');
assert(mapSource.includes('primeFirstMissionBeat'), 'mission primes intro narration during building');
assert(mapSource.includes('missionPrimedSceneIndexRef'), 'mission skips duplicate intro narration on native scene start');
assert(realtimeSource.includes('awaitingSayDoneNonce'), 'realtime copilot tracks per-say narration completion');

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
assert(playerSource.includes('followCamera(scene, camPt'), 'camera center uses monotonic lookahead point ahead of marker');
assert(/FRAME_MS\s*=\s*80/.test(playerSource), 'camera retargets at ~12.5Hz');
assert(/CAMERA_TWEEN_MS\s*=\s*120/.test(playerSource) && playerSource.includes("mode: 'linearTo'"),
  'camera glides via overlapping constant-velocity linearTo tweens');
assert(playerSource.includes('camBusyUntil'), 'establishing flyTo is never interrupted by follow ticks');
assert(playerSource.includes('Math.max(lastCamDist, nominal)'), 'contiguous legs use monotonic camera distance (no backward snap)');
assert(playerSource.includes('HOLD_DRIFT_DEG_PER_S'), 'narration holds drift the bearing instead of freezing');
assert(playerSource.includes('estimateSpeechMs'), 'speaking scenes stretch to the narration estimate');
assert(mapSource.includes("finishMissionNarrationBeat('pause_release')"),
  'resume releases a narration beat orphaned by pause');
assert(mapSource.includes('|| mapMissionVisible'), 'tab bar hides during the cinematic so controls are reachable');
assert(playerSource.includes('destinationPoint') && playerSource.includes('low_pass'),
  'player renders low_pass POI framing');
assert(playerSource.includes("cam.orbit?.direction === 'ccw'"),
  'player honors AI orbit direction/sweep');
assert(playerSource.includes('setSpeed'), 'player exposes setSpeed');
assert(playerSource.includes('onProgressRoute?.([])') && playerSource.includes('onCallouts?.([])'),
  'player clears overlays on stop');
assert(playerSource.includes('onDebugTick'), 'player exposes debug tick hook for QA counters');

// --- Speed control UI ---
const controlsSource = readFileSync(join(root, 'components/copilot/TripPreviewControls.tsx'), 'utf8');
assert(/PREVIEW_SPEEDS\s*=\s*\[0\.5, 1, 2\]/.test(controlsSource), 'controls expose 0.5x / 1x / 2x speeds');
assert(controlsSource.includes('onCycleSpeed'), 'controls expose a speed cycle action');
assert(/DEFAULT_PREVIEW_SPEED[^\n]*=\s*0\.5/.test(controlsSource), 'default playback speed is slow/cinematic');

// --- Map-first layout wiring ---
assert(mapSource.includes('initialSpeed: mapMissionSpeedRef.current'), 'map passes playback speed into the player');
assert(mapSource.includes('cycleMapMissionSpeed'), 'map wires speed cycling');
assert(mapSource.includes('mapMissionBriefTop'), 'map renders the top cinematic caption');
assert(!mapSource.includes('<MissionControlPanel'), 'flyover does not show the Mission Control sheet after playback');
assert(mapSource.includes('TripPreviewControls'), 'flyover keeps the simple playback controls');

const playbackSource = readFileSync(join(root, 'lib/missionPlayback.ts'), 'utf8');
assert(playbackSource.includes('resolveMissionPlaybackMode'), 'missionPlayback exports playback mode resolver');
assert(playbackSource.includes('speakLiveMissionBeatInput'), 'missionPlayback exports live beat input helper');
assert(playbackSource.includes('createMissionPlaybackDebug'), 'missionPlayback exports device debug counters');
assert(mapSource.includes('ensureMissionPlaybackDebug'), 'map wires mission playback debug telemetry');
assert(mapSource.includes('speakLiveMissionBeatInput'), 'map uses speakLiveMissionBeatInput at scene start');
assert(mapSource.includes('onDebugTick'), 'map tracks camera vs overlay tick counts');
assert(mapSource.includes('resolveMissionPlaybackMode'), 'map resolves js vs native playback mode');
assert(mapSource.includes('isMissionAnimatorAvailable'), 'map probes native animator availability');

const animatorSource = readFileSync(join(root, 'modules/mission-animator/src/index.ts'), 'utf8');
assert(animatorSource.includes('startMissionAnimation'), 'native animator module exposes startMissionAnimation');
assert(animatorSource.includes('isMissionAnimatorAvailable'), 'native animator module exposes availability probe');
assert(animatorSource.includes('prepareMissionAnimation'), 'native animator module exposes prepareMissionAnimation');
assert(animatorSource.includes('clearMissionAnimation'), 'native animator module exposes clearMissionAnimation');
assert(animatorSource.includes('addMissionSceneStartListener'), 'native animator module exposes scene lifecycle events');
assert(mapSource.includes('startMissionAnimation(nativePayload)'), 'map starts native animator when available');
assert(mapSource.includes('clearMissionNativeListeners'), 'map cleans up native event listeners');

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
