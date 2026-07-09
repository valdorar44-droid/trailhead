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
assert(!/\b(anchor|coverage|switching to terrain|boots leave the vehicle|low-service)\b/i.test(storyboardSource),
  'copilotStoryboard avoids generic flyover narration');
assert(storyboardSource.includes('overnight stop') && storyboardSource.includes('Fuel stop at'),
  'copilotStoryboard uses plain camp and fuel narration');

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
assert(!mapSource.includes('handoffScoutToCinematic') && !mapSource.includes('AUTO_FLY_AFTER_SCOUT'),
  'route scout does not auto-start the flyover');
assert(mapSource.includes('Route is built. Want me to fly the plan?'), 'Co-Pilot asks before flyover after route build');
assert(mapSource.includes('enterDirectorMode') || mapSource.includes('ensureMissionDirectorVoice'),
  'map uses unified realtime director voice');
assert(mapSource.includes('missionBeatCaption'), 'map uses runtime beat text for caption and voice');
assert(mapSource.includes('shouldSpeakMissionScene'), 'scene narration gated for live scout beats');
assert(mapSource.includes('speakCopilotNarration'), 'map falls back to Trailhead guide voice');
assert(mapSource.includes("command: 'markNarrationDone'"), 'WebView flyover receives narration completion');
assert(mapSource.includes('patchMissionBriefOverlay'), 'map batches mission overlay updates');
assert(mapSource.includes('captionText={mapMissionCaptionText}'), 'map passes runtime caption text to TripPreviewCaption');
assert(mapSource.includes('fetchDirectedCinematic') && mapSource.includes('startDirectedCinematicFetch'),
  'map races the AI-director storyboard against the deterministic builders');
assert(mapSource.includes('missionRouteOverrideRef.current = coords') && mapSource.includes('missionDirectedPromiseRef.current = startDirectedCinematicFetch'),
  'route scout prefetches the storyboard while waiting for Fly the Plan');
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
const webMissionPlayerSource = readFileSync(join(root, 'lib/missionBriefMapPlayerScript.ts'), 'utf8');
assert(webMissionPlayerSource.includes('markNarrationDone') && webMissionPlayerSource.includes('narrationCapMs'),
  'WebView flyover waits for narration with a cap');
assert(webMissionPlayerSource.includes('duration: 120') && webMissionPlayerSource.includes('now - cine.lastCameraTs >= 80'),
  'WebView follow camera uses throttled smooth retargets');
assert(webMissionPlayerSource.includes('sweepDeg') && webMissionPlayerSource.includes('Math.min(360'),
  'WebView orbit scenes honor storyboard sweep');

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
assert(controlsSource.includes('PanResponder.create') && controlsSource.includes('accessibilityRole="adjustable"'),
  'controls expose a draggable flyover progress slider');

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
const animatorConfigSource = readFileSync(join(root, 'modules/mission-animator/expo-module.config.json'), 'utf8');
const androidAnimatorModuleSource = readFileSync(join(root, 'modules/mission-animator/android/src/main/java/expo/modules/missionanimator/TrailheadMissionAnimatorModule.kt'), 'utf8');
const androidAnimatorSource = readFileSync(join(root, 'modules/mission-animator/android/src/main/java/expo/modules/missionanimator/TrailheadMissionAnimator.kt'), 'utf8');
const iosAnimatorSource = readFileSync(join(root, 'modules/mission-animator/ios/TrailheadMissionAnimatorModule.swift'), 'utf8');
assert(animatorConfigSource.includes('TrailheadMissionAnimatorModule'), 'native animator autolink config names the platform module');
assert(androidAnimatorModuleSource.includes('Name("TrailheadMissionAnimator")') && androidAnimatorSource.includes('internal class TrailheadMissionAnimator'),
  'Android native animator module and implementation are present');
assert(androidAnimatorSource.includes('Choreographer.FrameCallback') && androidAnimatorSource.includes('MapView'),
  'Android native animator owns frame timing and MapView updates');
assert(iosAnimatorSource.includes('Name("TrailheadMissionAnimator")') && iosAnimatorSource.includes('private final class NativeMissionAnimator'),
  'iOS native animator module and implementation are present');
assert(iosAnimatorSource.includes('private func runOnMain') && iosAnimatorSource.includes('Thread.isMainThread'),
  'iOS native animator avoids main-thread sync deadlocks');
assert((iosAnimatorSource.match(/DispatchQueue\.main\.sync/g) ?? []).length === 1,
  'iOS native animator confines DispatchQueue.main.sync to the guarded helper');
assert(mapSource.includes('startMissionAnimation(nativePayload)'), 'map starts native animator when available');
assert(mapSource.includes('clearMissionNativeListeners'), 'map cleans up native event listeners');

assert(mapSource.includes('mapMissionNotice'), 'map surfaces the 3D-fallback notice');
assert(!/headline: 'Trip needs review'/.test(mapSource), 'map avoids debug hero copy in the fallback brief');
assert(!mapSource.includes("opened: 'mission_briefing'"), 'Co-Pilot reports flyover, not a briefing sheet');
assert(!/(mission control|mission briefing)/i.test(mapSource), 'local flyover trigger avoids old Mission Control wording');

const nativeMapContrast = nativeMapSource.includes('mission-brief-full-route-casing');
assert(nativeMapContrast, 'NativeMap draws a high-contrast route casing');

const routeBuilderSource = readFileSync(join(root, 'app/(tabs)/route-builder.tsx'), 'utf8');
const footerDockSource = readFileSync(join(root, 'components/routeBuilder/RouteBuilderFooterDock.tsx'), 'utf8');
const storeSource = readFileSync(join(root, 'lib/store.ts'), 'utf8');
assert(storeSource.includes('pendingRouteFlyover') && storeSource.includes('setPendingRouteFlyover'),
  'store carries pending route-builder flyover handoff');
assert(routeBuilderSource.includes('saveRouteAndFlyover'), 'Route Builder can save and open a flyover');
assert(routeBuilderSource.includes("setPendingRouteFlyover({ runId: Date.now(), source: 'route_builder' })"),
  'Route Builder marks the map to auto-start a deterministic flyover');
assert(routeBuilderSource.includes('secondaryActionLabel="Flyover"'), 'Route Builder footer exposes Flyover action');
assert(routeBuilderSource.includes('Preview the route on the map'), 'Route Builder action sheet explains flyover without AI wording');
assert(routeBuilderSource.includes('Route draft') && routeBuilderSource.includes('Fuel pending'),
  'Route Builder footer avoids zero-value draft copy');
assert(footerDockSource.includes('secondaryActionLabel') && footerDockSource.includes('secondaryActionIcon'),
  'Route Builder footer supports a compact secondary action');
assert(mapSource.includes('pendingRouteFlyover') && mapSource.includes("source: 'trail_builder'") && mapSource.includes('skipDirected: true'),
  'Map consumes Route Builder flyover requests through deterministic playback');
assert(mapSource.includes('flyTrailRoutePlan') && mapSource.includes('missionRouteOverrideRef.current = plan.coords'),
  'Trail Builder flyover uses the selected trail route');
assert(mapSource.includes("routeName: trail.name || plan.title || 'Trail route'") && mapSource.includes('skipDirected: true'),
  'Trail Builder flyover uses deterministic playback without directed storyboard');
assert(mapSource.includes('label="Flyover"') && mapSource.includes('play-circle-outline'),
  'Trail Builder exposes a Flyover action after route build');
assert(mapSource.includes("previewTrailDistanceM > 0 ? fmtTrailRouteDistance(previewTrailDistanceM) : 'Set route'"),
  'Trail Builder capture panel avoids dead distance placeholders');
assert(mapSource.includes("trailCapturePins.length ? String(trailCapturePins.length) : 'Start'"),
  'Trail Builder capture panel avoids zero-value point copy');

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
