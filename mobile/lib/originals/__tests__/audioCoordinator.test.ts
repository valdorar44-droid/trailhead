import assert from 'node:assert/strict';
import { createOriginalAudioCoordinator } from '../audioCoordinator';

async function main() {
  const coordinator = createOriginalAudioCoordinator();
  const events: string[] = [];
  let userPaused = false;
  const original = await coordinator.acquire({
    owner: 'original',
    priority: 'originals',
    pause: () => { events.push('original:pause'); },
    resume: () => { events.push('original:resume'); },
    canAutoResume: () => !userPaused,
  });
  assert.equal(coordinator.activeOwner(), 'original');

  const ui = await coordinator.acquire({
    owner: 'ui',
    priority: 'ui',
    pause: () => { events.push('ui:pause'); },
    resume: () => { events.push('ui:resume'); },
  });
  assert.equal(coordinator.activeOwner(), 'original', 'UI cues cannot interrupt an Original');
  assert.equal(events.length, 0);
  await ui.release();

  const copilot = await coordinator.acquire({
    owner: 'copilot',
    priority: 'copilot',
    pause: () => { events.push('copilot:pause'); },
    resume: () => { events.push('copilot:resume'); },
  });
  assert.equal(coordinator.activeOwner(), 'original', 'Co-Pilot cannot interrupt an Original');
  assert.equal(events.length, 0, 'lower-priority acquisition does not pause the Original');
  await copilot.release();

  const navigation = await coordinator.acquire({
    owner: 'navigation',
    priority: 'navigation',
    pause: () => { events.push('navigation:pause'); },
    resume: () => { events.push('navigation:resume'); },
  });
  assert.equal(coordinator.activeOwner(), 'navigation');
  assert.deepEqual(events, ['original:pause']);
  await navigation.release();
  assert.equal(coordinator.activeOwner(), 'original');
  assert.deepEqual(events, ['original:pause', 'original:resume']);

  const hazard = await coordinator.acquire({
    owner: 'hazard',
    priority: 'hazard',
    pause: () => {},
    resume: () => {},
  });
  userPaused = true;
  await hazard.release();
  assert.equal(events.at(-1), 'original:pause', 'user-paused narration is not auto-resumed');
  await original.release();
  assert.equal(coordinator.activeOwner(), null);

  console.log('Originals audio coordinator tests passed.');
}

void main();
