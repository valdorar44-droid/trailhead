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

function shouldSpeakScene(type) {
  return ['intro', 'whole_route', 'day_flyover', 'risk_focus', 'weather_focus', 'offline_readiness', 'mission_recap'].includes(type);
}

assert(shouldSpeakScene('intro'), 'shouldSpeakScene accepts intro');
assert(shouldSpeakScene('mission_recap'), 'shouldSpeakScene accepts mission_recap');
assert(!shouldSpeakScene('fuel_stop'), 'shouldSpeakScene rejects fuel_stop');
assert(!shouldSpeakScene('camp_arrival'), 'shouldSpeakScene rejects camp_arrival');

const storyboardSource = readFileSync(join(root, 'lib/copilotStoryboard.ts'), 'utf8');
assert(!/command center/i.test(storyboardSource), 'copilotStoryboard avoids command center wording');

const mapBriefSource = readFileSync(join(root, 'lib/mapMissionBrief.ts'), 'utf8');
assert(mapBriefSource.includes('getCurrentMissionRoute'), 'mapMissionBrief exports getCurrentMissionRoute');
assert(mapBriefSource.includes('shouldSpeakScene'), 'mapMissionBrief exports shouldSpeakScene');

const nativeMapSource = readFileSync(join(root, 'components/NativeMap/index.tsx'), 'utf8');
assert(nativeMapSource.includes('mission-brief-progress-line'), 'NativeMap renders mission briefing progress layer');

const mapSource = readFileSync(join(root, 'app/(tabs)/map.tsx'), 'utf8');
assert(!mapSource.includes('setTimeout(() => { startMapMissionBrief'), 'map tab no longer auto-starts mission briefing');
assert(mapSource.includes('useNativeOverlays: USE_NATIVE_MAP'), 'native player uses NativeMap overlays on main map');
assert(mapSource.includes('shouldSpeakScene(scene)'), 'scene narration gated to major scenes');

const voiceSource = readFileSync(join(root, 'lib/voice.ts'), 'utf8');
assert(voiceSource.includes('playTrailheadVoice'), 'speakCopilotNarration uses Trailhead voice');

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
