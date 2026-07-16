import { expoAudioOriginalAudioAdapter } from './audioAdapter';
import { originalAccessStore, originalBundleStore, originalSessionStore } from './expoStores';
import { createOriginalHeadlessController } from './headlessController';
import type { OriginalLocationSample } from './types';

const controller = createOriginalHeadlessController({
  audio: expoAudioOriginalAudioAdapter,
  access: originalAccessStore,
  bundles: originalBundleStore,
  sessions: originalSessionStore,
});

export function processHeadlessOriginalLocationSamples(
  samples: OriginalLocationSample[],
  stopTracking: () => Promise<void>,
) {
  return controller.process(samples, stopTracking);
}
