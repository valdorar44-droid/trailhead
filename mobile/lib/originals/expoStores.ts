import { createOriginalAccessStore } from './accessStore';
import { createOriginalBundleStore } from './bundleStore';
import { expoOriginalFileAdapter } from './expoFileAdapter';
import { expoOriginalOfflineMapAdapter } from './mapAdapter';
import { createOriginalSessionStore } from './sessionStore';

export const originalAccessStore = createOriginalAccessStore(expoOriginalFileAdapter);
export const originalSessionStore = createOriginalSessionStore(expoOriginalFileAdapter);
export const originalBundleStore = createOriginalBundleStore(
  expoOriginalFileAdapter,
  undefined,
  expoOriginalOfflineMapAdapter,
);
