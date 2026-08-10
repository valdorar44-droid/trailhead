import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  COPILOT_VOICE_DISMISS_REASONS,
  realtimeCopilotStartIsCurrent,
  realtimeNarratorStartIsCurrent,
  releaseRealtimeCopilotHandle,
} from '../copilotVoiceLifecycle';

const mapSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../app/(tabs)/map.tsx'),
  'utf8',
);
const realtimeSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../realtimeCopilot.ts'),
  'utf8',
);

test('every Co-Pilot dismissal path releases and nulls the realtime handle', () => {
  for (const reason of COPILOT_VOICE_DISMISS_REASONS) {
    let stops = 0;
    const ref = { current: { stop: () => { stops += 1; } } };
    assert.equal(releaseRealtimeCopilotHandle(ref), true, reason);
    assert.equal(stops, 1, reason);
    assert.equal(ref.current, null, reason);
    assert.equal(releaseRealtimeCopilotHandle(ref), false, `${reason} is idempotent`);
    assert.equal(stops, 1, `${reason} does not stop twice`);
  }
});

test('a native stop failure still clears the retained handle', () => {
  const ref = { current: { stop: () => { throw new Error('native close failed'); } } };
  assert.equal(releaseRealtimeCopilotHandle(ref), true);
  assert.equal(ref.current, null);
});

test('a late microphone start is rejected after close, background, or screen blur', () => {
  const base = {
    operation: 7,
    currentOperation: 7,
    modalVisible: true,
    appActive: true,
    screenFocused: true,
  };
  assert.equal(realtimeCopilotStartIsCurrent(base), true);
  assert.equal(realtimeCopilotStartIsCurrent({ ...base, currentOperation: 8 }), false);
  assert.equal(realtimeCopilotStartIsCurrent({ ...base, modalVisible: false }), false);
  assert.equal(realtimeCopilotStartIsCurrent({ ...base, appActive: false }), false);
  assert.equal(realtimeCopilotStartIsCurrent({ ...base, screenFocused: false }), false);
});

test('Map routes backdrop, close button, Android Back, and background through the guarded close setter', () => {
  assert.match(mapSource, /const \[showExtremeCopilot, setShowExtremeCopilotState\] = useState\(false\)/);
  assert.match(mapSource, /if \(!visible\) stopCopilotVoiceSession\(\)/);
  assert.match(mapSource, /onRequestClose=\{\(\) => setShowExtremeCopilot\(false\)\}/);
  assert.match(mapSource, /StyleSheet\.absoluteFillObject[^\n]+onPress=\{\(\) => setShowExtremeCopilot\(false\)\}/);
  assert.match(mapSource, /extremeCopilotClose[^\n]+onPress=\{\(\) => setShowExtremeCopilot\(false\)\}/);
  assert.match(mapSource, /AppState\.addEventListener\('change',[\s\S]*setShowExtremeCopilot\(false\)/);
  assert.match(mapSource, /!screenActivity\.isFocused[\s\S]*setShowExtremeCopilot\(false\)/);
  assert.equal(
    (mapSource.match(/setShowExtremeCopilotState\(/g) ?? []).length,
    1,
    'the raw visibility setter is private to the cleanup-aware wrapper',
  );
});

test('late narration handles require the same live owner, active app, and focused Map', () => {
  const base = {
    operation: 4,
    currentOperation: 4,
    experienceActive: true,
    appActive: true,
    screenFocused: true,
  };
  assert.equal(realtimeNarratorStartIsCurrent(base), true);
  assert.equal(realtimeNarratorStartIsCurrent({ ...base, currentOperation: 5 }), false);
  assert.equal(realtimeNarratorStartIsCurrent({ ...base, experienceActive: false }), false);
  assert.equal(realtimeNarratorStartIsCurrent({ ...base, appActive: false }), false);
  assert.equal(realtimeNarratorStartIsCurrent({ ...base, screenFocused: false }), false);
});

test('narration-only WebRTC receives audio without requesting microphone access', () => {
  assert.match(realtimeSource, /options\.narrationOnly\s*\? null\s*:\s*await mediaDevices\.getUserMedia/);
  assert.match(realtimeSource, /addTransceiver\('audio', \{ direction: 'recvonly' \}\)/);
  assert.match(realtimeSource, /catch \(error\) \{\s*cleanup\(\);\s*throw error;/);
});
