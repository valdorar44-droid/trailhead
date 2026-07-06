import {
  createMissionPlaybackDebug,
  missionNarrationWatchdogMs,
  resolveMissionPlaybackMode,
  speakLiveMissionBeatInput,
} from '@/lib/missionPlayback';
import { shouldSpeakLiveScoutScene } from '@/lib/mapMissionBrief';
import type { MissionCinematic, MissionScene } from '@/lib/copilotStoryboard';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`missionPlayback contract failed: ${message}`);
}

assert(resolveMissionPlaybackMode() === 'js', 'default playback mode is js OTA player');

const liveCinematic: MissionCinematic = {
  id: 'c1',
  tripId: null,
  title: 't',
  route: [] as [number, number][],
  scenes: [],
  generatedAt: 0,
  sources: ['route_scout_live'],
};

const beat = speakLiveMissionBeatInput(
  liveCinematic,
  { id: 's1', type: 'drive_leg', title: 'Moab', subtitle: 'Camp', durationMs: 10000, camera: { mode: 'follow' }, layers: {}, narration: '', callouts: [], day: 1 },
  { startName: 'Moab', destinationName: 'Flagstaff', dayPlans: [{ day: 1, startName: 'Moab', endName: 'Camp', driveSummary: '~120 mi' }] } as any,
);
assert(beat.speak && beat.isLiveScout && beat.beatText.includes('Moab'), 'live scout beat input speaks with runtime text');

const silent = speakLiveMissionBeatInput(
  liveCinematic,
  { id: 's2', type: 'route_rejoin', title: 'Rejoin', subtitle: '', durationMs: 5000, camera: { mode: 'follow' }, layers: {}, narration: '', callouts: [] },
  null,
);
assert(!silent.speak, 'route_rejoin is silent');

const watchdog = missionNarrationWatchdogMs(
  { durationMs: 10000 } as MissionScene,
  1,
  'Day 1 leaves Moab toward camp.',
);
assert(watchdog >= 13000, 'watchdog exceeds scene duration and speech estimate');

const debug = createMissionPlaybackDebug();
debug.sceneStart({ scene_id: 's1', speak: true });
debug.narrationDone('realtime');
debug.watchdogFired({ scene_id: 's1' });
assert(debug.counters.sceneStarts === 1, 'debug counts scene starts');
assert(debug.counters.narrationDone.realtime === 1, 'debug counts narration done by source');
assert(debug.counters.watchdogFires === 1, 'debug counts watchdog fires');

assert(shouldSpeakLiveScoutScene({ id: 'x', type: 'camp_arrival', title: '', subtitle: '', durationMs: 1, camera: { mode: 'orbit' }, layers: {}, narration: '', callouts: [] }), 'live scout speaks camp_arrival');

export const missionPlaybackContract = { beat, watchdog };
