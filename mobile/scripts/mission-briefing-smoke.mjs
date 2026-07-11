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
  return ['intro', 'drive_leg', 'camp_arrival', 'fuel_stop', 'monument_orbit', 'poi_flyover', 'mission_recap'].includes(type);
}

assert(shouldSpeakLiveScoutScene('intro'), 'live scout accepts intro');
assert(shouldSpeakLiveScoutScene('drive_leg'), 'live scout accepts drive_leg');
assert(shouldSpeakLiveScoutScene('camp_arrival'), 'live scout accepts camp_arrival');
assert(shouldSpeakLiveScoutScene('fuel_stop'), 'live scout accepts fuel_stop');
assert(shouldSpeakLiveScoutScene('monument_orbit'), 'live scout accepts scenic orbit');
assert(shouldSpeakLiveScoutScene('poi_flyover'), 'live scout accepts poi_flyover');
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
assert(!/we follow the route toward|Continuing toward/i.test(storyboardSource),
  'copilotStoryboard avoids generic connective-leg narration');
assert(!/Offline maps and fuel planning matter here/i.test(storyboardSource),
  'copilotStoryboard avoids old offline-map narration');
assert(storyboardSource.includes('the line heads toward') && storyboardSource.includes('Then we continue toward'),
  'copilotStoryboard uses cleaner connective-leg narration');
assert(storyboardSource.includes('overnight stop') && storyboardSource.includes('Fuel stop at'),
  'copilotStoryboard uses plain camp and fuel narration');

const mapBriefSource = readFileSync(join(root, 'lib/mapMissionBrief.ts'), 'utf8');
assert(mapBriefSource.includes('getCurrentMissionRoute'), 'mapMissionBrief exports getCurrentMissionRoute');
assert(mapBriefSource.includes('buildScoutLiveCinematic'), 'mapMissionBrief exports scout live cinematic builder');
assert(mapBriefSource.includes('liveMissionBeatBrief'), 'mapMissionBrief exports live beat brief helper');
assert(mapBriefSource.includes('shouldSpeakLiveScoutScene'), 'mapMissionBrief exports live scout speech gate');
assert(mapBriefSource.includes('missionBeatCaption'), 'mapMissionBrief exports runtime beat caption helper');
assert(mapBriefSource.includes('sceneNarrationWatchdogMs'), 'mapMissionBrief exports narration watchdog helper');
assert(mapBriefSource.includes("'fuel_stop', 'monument_orbit', 'poi_flyover'"),
  'live scout flyover speaks fuel and scenic stop beats');
assert(mapBriefSource.includes('dayStopsForPlan') && mapBriefSource.includes('sweepDeg: 360'),
  'live scout flyover can add fuel/scenic stops before camp');
assert(mapBriefSource.includes('The highlighted line heads toward') &&
  mapBriefSource.includes("We'll circle it, then continue onward."),
  'live scout flyover narration describes line movement and scenic return');
assert(mapBriefSource.includes("Here's the flyover for") &&
  !mapBriefSource.includes("is built. I'll fly it day by day"),
  'flyover intro accepts the handoff without repeating the build prompt');
assert(!/key camps|quick stop|strong signal|scenic pause/i.test(mapBriefSource),
  'live scout flyover avoids generic app-like narration');

const captionSource = readFileSync(join(root, 'components/copilot/TripPreviewCaption.tsx'), 'utf8');
assert(captionSource.includes('captionText'), 'TripPreviewCaption accepts runtime caption override');

const nativeMapSource = readFileSync(join(root, 'components/NativeMap/index.tsx'), 'utf8');
assert(nativeMapSource.includes('mission-brief-progress-line'), 'NativeMap renders mission briefing progress layer');

const mapSource = readFileSync(join(root, 'app/(tabs)/map.tsx'), 'utf8');
const realtimeSource = readFileSync(join(root, 'lib/realtimeCopilot.ts'), 'utf8');
assert(!mapSource.includes('handoffScoutToCinematic') && !mapSource.includes('AUTO_FLY_AFTER_SCOUT'),
  'route scout does not auto-start the flyover');
assert(mapSource.includes('Route is built. Would you like a flyover?'), 'Co-Pilot asks before flyover after route build');
assert(realtimeSource.includes('Would you like a flyover?') &&
  !mapSource.includes('Want me to fly the plan?') &&
  !realtimeSource.includes('Want me to fly the plan?'),
  'route scout handoff uses clean flyover wording');
assert(mapSource.includes('enterDirectorMode') || mapSource.includes('ensureMissionDirectorVoice'),
  'map uses unified realtime director voice');
assert(mapSource.includes('missionBeatCaption'), 'map uses runtime beat text for caption and voice');
assert(mapSource.includes('shouldSpeakMissionScene'), 'scene narration gated for live scout beats');
assert(mapSource.includes('speakFlyoverBeat'), 'map uses flyover voice with device fallback');
assert(mapSource.includes("command: 'markNarrationDone'"), 'WebView flyover receives narration completion');
assert(!mapSource.includes('startMissionBriefFromMsg(msg)'), 'WebView flyover does not call removed inline player');
assert(mapSource.includes("msg.type==='cinematic_camera'") && mapSource.includes('map.easeTo(camOpts)'),
  'WebView flyover camera moves without creating search pins');
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
assert(storyboardClientSource.includes('Math.min(360, sweep)'),
  'AI storyboard sanitizer preserves true 360 scenic orbits');
assert(storyboardClientSource.includes("generated_by !== 'ai'"),
  'backend-fallback storyboards are skipped in favor of the richer local builder');
assert(/poi_flyover/.test(storyboardSource) && /route_rejoin/.test(storyboardSource),
  'storyboard vocabulary includes poi_flyover + route_rejoin');
assert(mapBriefSource.includes("scene.type !== 'route_rejoin'"),
  'route_rejoin transitions are silent and never wait on voice');
assert(mapSource.includes('useNativeOverlays: useNativeMapSurface'), 'native player uses NativeMap overlays on main map');
const webMissionPlayerSource = readFileSync(join(root, 'lib/missionBriefMapPlayerScript.ts'), 'utf8');
assert(webMissionPlayerSource.includes('markNarrationDone') && webMissionPlayerSource.includes('narrationCapMs'),
  'WebView flyover waits for narration with a cap');
assert(webMissionPlayerSource.includes('duration: 120') && webMissionPlayerSource.includes('now - cine.lastCameraTs >= 80'),
  'WebView follow camera uses throttled smooth retargets');
assert(webMissionPlayerSource.includes('sweepDeg') && webMissionPlayerSource.includes('Math.min(360'),
  'WebView orbit scenes honor storyboard sweep');

const voiceSource = readFileSync(join(root, 'lib/voice.ts'), 'utf8');
assert(voiceSource.includes('playTrailheadVoice'), 'speakCopilotNarration uses Trailhead voice');
assert(voiceSource.includes("'flyover'") && voiceSource.includes('cartesia_sonic'),
  'flyover voice uses dedicated Cartesia Sonic mode');

assert(realtimeSource.includes('waitUntilSpeechIdle'), 'realtime copilot waits for speech idle before handoff');
assert(realtimeSource.includes('enterDirectorMode'), 'realtime copilot supports director mode on live session');
assert(realtimeSource.includes('exitDirectorMode'), 'realtime copilot can restore interactive voice after fly');
assert(realtimeSource.includes('setDirectorSpeechStartHandler'), 'realtime copilot exposes speech-start hook for fallback');
assert(!mapSource.includes('ensureMissionDirectorVoice(true)'), 'mission flyover no longer forces realtime director voice');
assert(mapSource.includes('preloadTrailheadVoice'), 'mission prewarms flyover voice clips');
assert(mapSource.includes('beginMissionSceneBeat(scene, index)'), 'mission narrates from player scene-start events');
assert(mapSource.includes('missionPrimedSceneIndexRef.current = -1'), 'mission clears stale primed narration state before each run');
assert(realtimeSource.includes('awaitingSayDoneNonce'), 'realtime copilot tracks per-say narration completion');

const directorSource = readFileSync(join(root, 'lib/cinematicDirector.ts'), 'utf8');
assert(directorSource.includes('waitForRouteRenderReady'), 'cinematic director waits for route render');

const serverSource = readFileSync(join(root, '../dashboard/server.py'), 'utf8');
assert(serverSource.includes('CARTESIA_TTS_ENDPOINT'),
  'backend flyover TTS uses Cartesia Sonic');
assert(serverSource.includes('if clean == "flyover"'),
  'backend accepts flyover TTS mode');

// --- Cinematic camera engine ---
const playerSource = readFileSync(join(root, 'lib/missionBriefNativePlayer.ts'), 'utf8');
assert(playerSource.includes('effectiveDuration'), 'player computes an effective scene duration');
assert(playerSource.includes('/ Math.max(0.1, speed)'), 'speed divides base scene duration down to 0.1x');
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
assert(playerSource.includes('minNarrationSettleMs'), 'speaking scenes keep a short settle without slowing the route crawl');
assert(mapSource.includes("finishMissionNarrationBeat('pause_release')"),
  'resume releases a narration beat orphaned by pause');
assert(mapSource.includes('|| mapMissionVisible'), 'tab bar hides during the cinematic so controls are reachable');
assert(playerSource.includes('destinationPoint') && playerSource.includes('low_pass'),
  'player renders low_pass POI framing');
assert(playerSource.includes("cam.orbit?.direction === 'ccw'"),
  'player honors AI orbit direction/sweep');
assert(playerSource.includes('Math.min(360, orbitSweepRaw)'),
  'JS native player preserves true 360 scenic orbits');
assert(playerSource.includes('setSpeed'), 'player exposes setSpeed');
assert(playerSource.includes('onProgressRoute?.([])') && playerSource.includes('onCallouts?.([])'),
  'player clears overlays on stop');
assert(playerSource.includes('onDebugTick'), 'player exposes debug tick hook for QA counters');
assert(playerSource.includes('cinematic_camera') && !playerSource.includes("postWeb({ type: 'fly_to'"),
  'JS flyover player separates camera motion from normal map fly-to pins');
assert(!playerSource.includes('webRef.current?.postMessage(') &&
  playerSource.includes("typeof postMessage !== 'function'"),
  'JS flyover player guards stale WebView postMessage refs');

const missionPlaybackSource = readFileSync(join(root, 'lib/missionBriefPlayback.ts'), 'utf8');
assert(!missionPlaybackSource.includes('webRef.current?.postMessage(') &&
  missionPlaybackSource.includes("typeof postMessage !== 'function'"),
  'mission playback commands guard stale WebView postMessage refs');

// --- Speed control UI ---
const controlsSource = readFileSync(join(root, 'components/copilot/TripPreviewControls.tsx'), 'utf8');
assert(controlsSource.includes('PREVIEW_SPEED_PRESETS') &&
  controlsSource.includes("label: 'Slow'") &&
  controlsSource.includes("label: 'Normal'") &&
  controlsSource.includes("label: 'Fast'"),
  'controls expose slow, normal, and faster flyover speeds');
assert(controlsSource.includes('onSpeedChange') && controlsSource.includes('TextInput'),
  'controls expose preset and custom speed actions');
assert(/DEFAULT_PREVIEW_SPEED[^\n]*=\s*1/.test(controlsSource), 'default playback speed is steady');
assert(controlsSource.includes('PanResponder.create') && controlsSource.includes('accessibilityRole="adjustable"'),
  'controls expose a draggable flyover progress slider');
assert(controlsSource.includes('onCameraPresetChange') && controlsSource.includes('Tilt') && controlsSource.includes('Zoom'),
  'controls expose camera zoom and tilt presets');
assert(controlsSource.includes('onExitToOverview') && controlsSource.includes('Back to trip overview'),
  'controls expose a trip overview exit from flyover playback');

// --- Map-first layout wiring ---
assert(mapSource.includes('initialSpeed: mapMissionSpeedRef.current'), 'map passes playback speed into the player');
assert(mapSource.includes('applyMapMissionSpeed'), 'map wires preset and custom speed changes');
assert(mapSource.includes('returnFromMissionToTripOverview') && mapSource.includes('focusTripOverviewCamera'),
  'map can leave flyover and reframe the trip overview camera');
assert(mapSource.includes("flyoverMode === 'copilot'") && mapSource.includes("mapMissionFlyoverModeRef.current === 'trail_builder'"),
  'Trail Builder flyover stays visual-only');
assert(mapSource.includes('consumePendingFlyoverAffirmation') && mapSource.includes("Preparing flyover."),
  'Co-Pilot can start the flyover from a voice/text yes');
assert(mapSource.includes('mapMissionBriefTop'), 'map renders the top cinematic caption');
assert(!mapSource.includes('<MissionControlPanel'), 'flyover does not show the Mission Control sheet after playback');
assert(mapSource.includes('TripPreviewControls'), 'flyover keeps the simple playback controls');

const playbackSource = readFileSync(join(root, 'lib/missionPlayback.ts'), 'utf8');
assert(playbackSource.includes('cartesia_sonic'), 'mission playback tracks Cartesia Sonic voice path');
assert(playbackSource.includes('resolveMissionPlaybackMode'), 'missionPlayback exports playback mode resolver');
assert(playbackSource.includes('speakLiveMissionBeatInput'), 'missionPlayback exports live beat input helper');
assert(playbackSource.includes('createMissionPlaybackDebug'), 'missionPlayback exports device debug counters');
assert(mapSource.includes('ensureMissionPlaybackDebug'), 'map wires mission playback debug telemetry');
assert(mapSource.includes('speakLiveMissionBeatInput'), 'map uses speakLiveMissionBeatInput at scene start');
assert(mapSource.includes('onDebugTick'), 'map tracks camera vs overlay tick counts');
assert(mapSource.includes('resolveMissionPlaybackMode'), 'map resolves js vs native playback mode');
assert(mapSource.includes('isMissionAnimatorAvailable'), 'map probes native animator availability');
assert(mapSource.includes('isMissionAnimatorCinematicOrbitAvailable') && mapSource.includes('native_animator_orbit_available'),
  'map requires native orbit support before using native cinematic playback');

const animatorSource = readFileSync(join(root, 'modules/mission-animator/src/index.ts'), 'utf8');
assert(animatorSource.includes('startMissionAnimation'), 'native animator module exposes startMissionAnimation');
assert(animatorSource.includes('isMissionAnimatorAvailable'), 'native animator module exposes availability probe');
assert(animatorSource.includes('isMissionAnimatorCinematicOrbitAvailable') &&
  animatorSource.includes('getMissionAnimatorFeatureVersion'),
  'native animator JS wrapper exposes cinematic orbit feature detection');
assert(animatorSource.includes('prepareMissionAnimation'), 'native animator module exposes prepareMissionAnimation');
assert(animatorSource.includes('clearMissionAnimation'), 'native animator module exposes clearMissionAnimation');
assert(animatorSource.includes('addMissionSceneStartListener'), 'native animator module exposes scene lifecycle events');
assert(animatorSource.includes('seekMissionAnimation') &&
  animatorSource.includes('setMissionAnimationFreeCamera') &&
  animatorSource.includes('skipMissionAnimationScene'),
  'native animator module exposes seek, free-camera, and skip controls');
assert(animatorSource.includes('markMissionAnimationNarrationDone'),
  'native animator module exposes narration completion');
const animatorConfigSource = readFileSync(join(root, 'modules/mission-animator/expo-module.config.json'), 'utf8');
const androidAnimatorModuleSource = readFileSync(join(root, 'modules/mission-animator/android/src/main/java/expo/modules/missionanimator/TrailheadMissionAnimatorModule.kt'), 'utf8');
const androidAnimatorSource = readFileSync(join(root, 'modules/mission-animator/android/src/main/java/expo/modules/missionanimator/TrailheadMissionAnimator.kt'), 'utf8');
const iosAnimatorSource = readFileSync(join(root, 'modules/mission-animator/ios/TrailheadMissionAnimatorModule.swift'), 'utf8');
assert(animatorConfigSource.includes('TrailheadMissionAnimatorModule'), 'native animator autolink config names the platform module');
assert(androidAnimatorModuleSource.includes('Name("TrailheadMissionAnimator")') && androidAnimatorSource.includes('internal class TrailheadMissionAnimator'),
  'Android native animator module and implementation are present');
assert(androidAnimatorModuleSource.includes('getMissionAnimatorFeatureVersion') && androidAnimatorModuleSource.includes('3'),
  'Android native animator reports cinematic feature version');
assert(androidAnimatorSource.includes('Choreographer.FrameCallback') && androidAnimatorSource.includes('MapView'),
  'Android native animator owns frame timing and MapView updates');
assert(androidAnimatorModuleSource.includes('seekMissionAnimation') &&
  androidAnimatorSource.includes('fun seekTo') &&
  androidAnimatorSource.includes('fun setFreeCamera') &&
  androidAnimatorSource.includes('fun skipScene'),
  'Android native animator supports seek, free-camera, and scene skip');
assert(androidAnimatorModuleSource.includes('markMissionAnimationNarrationDone') &&
  androidAnimatorSource.includes('fun markNarrationDone') &&
  androidAnimatorSource.includes('narrationCapSec'),
  'Android native animator waits for narration with a cap');
assert(androidAnimatorSource.includes('cameraOrbitSweep') &&
  androidAnimatorSource.includes('tickOrbit') &&
  androidAnimatorSource.includes('coerceIn(30.0, 360.0)'),
  'Android native animator supports 360 scenic orbit beats');
assert(iosAnimatorSource.includes('Name("TrailheadMissionAnimator")') && iosAnimatorSource.includes('private final class NativeMissionAnimator'),
  'iOS native animator module and implementation are present');
assert(iosAnimatorSource.includes('getMissionAnimatorFeatureVersion') && iosAnimatorSource.includes('3'),
  'iOS native animator reports cinematic feature version');
assert(iosAnimatorSource.includes('private func runOnMain') && iosAnimatorSource.includes('Thread.isMainThread'),
  'iOS native animator avoids main-thread sync deadlocks');
assert(iosAnimatorSource.includes('seekMissionAnimation') &&
  iosAnimatorSource.includes('func seekTo') &&
  iosAnimatorSource.includes('func setFreeCamera') &&
  iosAnimatorSource.includes('func skipScene'),
  'iOS native animator supports seek, free-camera, and scene skip');
assert(iosAnimatorSource.includes('markMissionAnimationNarrationDone') &&
  iosAnimatorSource.includes('func markNarrationDone') &&
  iosAnimatorSource.includes('narrationCap'),
  'iOS native animator waits for narration with a cap');
assert(iosAnimatorSource.includes('cameraOrbitSweep') &&
  iosAnimatorSource.includes('tickOrbit') &&
  iosAnimatorSource.includes('max(30, min(360'),
  'iOS native animator supports 360 scenic orbit beats');
assert((iosAnimatorSource.match(/DispatchQueue\.main\.sync/g) ?? []).length === 1,
  'iOS native animator confines DispatchQueue.main.sync to the guarded helper');
assert(mapSource.includes('startMissionAnimation(nativePayload)'), 'map starts native animator when available');
assert(mapSource.includes('seekMissionAnimation(ratio)') &&
  mapSource.includes('setMissionAnimationFreeCamera(enabled)') &&
  mapSource.includes('skipMissionAnimationScene()'),
  'map wires native flyover controls to the native animator');
assert(mapSource.includes('markMissionAnimationNarrationDone()'),
  'map tells native flyover when narration finishes');
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
assert(mapSource.includes("postRN({type:'map_tapped',lat:e.lngLat.lat,lng:e.lngLat.lng})") &&
  mapSource.includes('trailPinCaptureMode &&') &&
  mapSource.includes('addTrailCaptureAnchor(webTapCoord)'),
  'WebView Trail Builder taps create route points while capture mode is active');
assert(mapSource.includes('syncTrailCaptureModeToWeb') &&
  mapSource.includes('[0, 120, 420, 900, 1800]') &&
  mapSource.includes('set_trail_capture_mode'),
  'WebView Trail Builder capture mode is retried across cold WebView load');
assert(mapSource.includes('syncTrailCaptureModeToWeb(true)') &&
  mapSource.includes('syncTrailCaptureModeToWeb(false)'),
  'Trail Builder directly syncs WebView capture mode on start and stop');
assert(!mapSource.includes("Styles, 3D, land, weather"),
  'map drawer does not advertise the removed land overlay');
assert(mapSource.includes("engineLabel = usedManualFallback ? 'Manual line' : 'Trail route'") &&
  mapSource.includes('Review the line before saving. Add points around bends and forks.'),
  'WebView Trail Builder falls back to a reviewable manual route');
assert(!mapSource.includes('Trail graph did not match'),
  'Trail Builder avoids technical route-copy in visible messages');
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
