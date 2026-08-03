export type RealtimeCopilotStopHandle = Readonly<{
  stop: () => void;
}>;

export type RealtimeCopilotHandleRef = {
  current: RealtimeCopilotStopHandle | null;
};

export const COPILOT_VOICE_DISMISS_REASONS = [
  'backdrop',
  'close_button',
  'android_back',
  'app_background',
  'screen_blur',
  'programmatic_close',
] as const;

export type CopilotVoiceDismissReason = typeof COPILOT_VOICE_DISMISS_REASONS[number];

/**
 * Detach first so a synchronous `onStatus("stopped")` callback cannot retain
 * or re-use the microphone handle while it is being torn down.
 */
export function releaseRealtimeCopilotHandle(ref: RealtimeCopilotHandleRef): boolean {
  const handle = ref.current;
  ref.current = null;
  if (!handle) return false;
  try {
    handle.stop();
  } catch {
    // UI state still has to reset even when a native/WebRTC close throws.
  }
  return true;
}

export function realtimeCopilotStartIsCurrent(input: Readonly<{
  operation: number;
  currentOperation: number;
  modalVisible: boolean;
  appActive: boolean;
  screenFocused: boolean;
}>): boolean {
  return input.operation === input.currentOperation
    && input.modalVisible
    && input.appActive
    && input.screenFocused;
}

export function realtimeNarratorStartIsCurrent(input: Readonly<{
  operation: number;
  currentOperation: number;
  experienceActive: boolean;
  appActive: boolean;
  screenFocused: boolean;
}>): boolean {
  return input.operation === input.currentOperation
    && input.experienceActive
    && input.appActive
    && input.screenFocused;
}
