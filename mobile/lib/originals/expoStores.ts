import { createOriginalAccessStore } from './accessStore';
import { createOriginalBundleStore } from './bundleStore';
import { createOriginalFeedbackStore } from './feedbackStore';
import { expoOriginalFileAdapter } from './expoFileAdapter';
import { expoOriginalOfflineMapAdapter } from './mapAdapter';
import { createOriginalSessionStore } from './sessionStore';

export const originalAccessStore = createOriginalAccessStore(expoOriginalFileAdapter);
export const originalSessionStore = createOriginalSessionStore(expoOriginalFileAdapter);
export const originalFeedbackStore = createOriginalFeedbackStore(expoOriginalFileAdapter);
export const originalBundleStore = createOriginalBundleStore(
  expoOriginalFileAdapter,
  undefined,
  expoOriginalOfflineMapAdapter,
);
