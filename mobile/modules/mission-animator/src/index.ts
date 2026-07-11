import { EventEmitter, requireOptionalNativeModule } from 'expo-modules-core';
import type { MissionScene } from '@/lib/copilotStoryboard';

export type MissionAnimationCamera = {
  pitch: number;
  minZoom: number;
  maxZoom: number;
  lookaheadM: number;
};

export type MissionAnimationPayload = {
  route: [number, number][];
  scenes: MissionScene[];
  speed: number;
  terrain: boolean;
  camera: MissionAnimationCamera;
};

export type MissionSceneLifecycleEvent = {
  sceneId: string;
  index: number;
  type?: string;
};

export type MissionSceneProgressEvent = MissionSceneLifecycleEvent & {
  progress: number;
  localProgress?: number;
};

export type MissionErrorEvent = {
  message: string;
  code?: string;
};

export type MissionDebugEvent = {
  kind: string;
  details?: Record<string, unknown>;
};

type NativeMissionAnimator = {
  isAvailable?: () => boolean | Promise<boolean>;
  getMissionAnimatorFeatureVersion?: () => number | Promise<number>;
  prepareMissionAnimation?: (payload: MissionAnimationPayload) => boolean | Promise<boolean>;
  startMissionAnimation?: (payload?: MissionAnimationPayload) => boolean | Promise<boolean>;
  pauseMissionAnimation?: () => boolean | Promise<boolean>;
  resumeMissionAnimation?: () => boolean | Promise<boolean>;
  stopMissionAnimation?: () => boolean | Promise<boolean>;
  clearMissionAnimation?: () => boolean | Promise<boolean>;
  setMissionAnimationSpeed?: (speed: number) => boolean | Promise<boolean>;
  setMissionAnimationCamera?: (camera: MissionAnimationCamera) => boolean | Promise<boolean>;
  seekMissionAnimation?: (ratio: number) => boolean | Promise<boolean>;
  setMissionAnimationFreeCamera?: (enabled: boolean) => boolean | Promise<boolean>;
  skipMissionAnimationScene?: () => boolean | Promise<boolean>;
  markMissionAnimationNarrationDone?: () => boolean | Promise<boolean>;
};

const Native = requireOptionalNativeModule<NativeMissionAnimator>('TrailheadMissionAnimator');
const emitter = Native ? new EventEmitter(Native as any) : null;

/** True when the native binary ships TrailheadMissionAnimator and a MapView is mounted. */
export async function isMissionAnimatorAvailable(): Promise<boolean> {
  if (!Native?.isAvailable) return false;
  try {
    return !!(await Native.isAvailable());
  } catch {
    return false;
  }
}

export async function isMissionAnimatorCinematicOrbitAvailable(): Promise<boolean> {
  if (!Native?.getMissionAnimatorFeatureVersion) return false;
  try {
    return Number(await Native.getMissionAnimatorFeatureVersion()) >= 2;
  } catch {
    return false;
  }
}

export async function isMissionAnimatorScenePacingAvailable(): Promise<boolean> {
  if (!Native?.getMissionAnimatorFeatureVersion) return false;
  try {
    return Number(await Native.getMissionAnimatorFeatureVersion()) >= 3;
  } catch {
    return false;
  }
}

export async function prepareMissionAnimation(payload: MissionAnimationPayload): Promise<boolean> {
  if (!Native?.prepareMissionAnimation) return false;
  try {
    return !!(await Native.prepareMissionAnimation(payload));
  } catch {
    return false;
  }
}

export async function startMissionAnimation(payload?: MissionAnimationPayload): Promise<boolean> {
  if (!Native?.startMissionAnimation) return false;
  try {
    return !!(await Native.startMissionAnimation(payload));
  } catch {
    return false;
  }
}

export async function pauseMissionAnimation(): Promise<boolean> {
  if (!Native?.pauseMissionAnimation) return false;
  try {
    return !!(await Native.pauseMissionAnimation());
  } catch {
    return false;
  }
}

export async function resumeMissionAnimation(): Promise<boolean> {
  if (!Native?.resumeMissionAnimation) return false;
  try {
    return !!(await Native.resumeMissionAnimation());
  } catch {
    return false;
  }
}

export async function stopMissionAnimation(): Promise<boolean> {
  if (!Native?.stopMissionAnimation) return false;
  try {
    return !!(await Native.stopMissionAnimation());
  } catch {
    return false;
  }
}

export async function clearMissionAnimation(): Promise<boolean> {
  if (!Native?.clearMissionAnimation) return false;
  try {
    return !!(await Native.clearMissionAnimation());
  } catch {
    return false;
  }
}

export async function setMissionAnimationSpeed(speed: number): Promise<boolean> {
  if (!Native?.setMissionAnimationSpeed) return false;
  try {
    return !!(await Native.setMissionAnimationSpeed(speed));
  } catch {
    return false;
  }
}

export async function setMissionAnimationCamera(camera: MissionAnimationCamera): Promise<boolean> {
  if (!Native?.setMissionAnimationCamera) return false;
  try {
    return !!(await Native.setMissionAnimationCamera(camera));
  } catch {
    return false;
  }
}

export async function seekMissionAnimation(ratio: number): Promise<boolean> {
  if (!Native?.seekMissionAnimation) return false;
  try {
    return !!(await Native.seekMissionAnimation(ratio));
  } catch {
    return false;
  }
}

export async function setMissionAnimationFreeCamera(enabled: boolean): Promise<boolean> {
  if (!Native?.setMissionAnimationFreeCamera) return false;
  try {
    return !!(await Native.setMissionAnimationFreeCamera(enabled));
  } catch {
    return false;
  }
}

export async function skipMissionAnimationScene(): Promise<boolean> {
  if (!Native?.skipMissionAnimationScene) return false;
  try {
    return !!(await Native.skipMissionAnimationScene());
  } catch {
    return false;
  }
}

export async function markMissionAnimationNarrationDone(): Promise<boolean> {
  if (!Native?.markMissionAnimationNarrationDone) return false;
  try {
    return !!(await Native.markMissionAnimationNarrationDone());
  } catch {
    return false;
  }
}

export function addMissionSceneStartListener(listener: (event: MissionSceneLifecycleEvent) => void) {
  return (emitter as any)?.addListener('onMissionSceneStart', listener) ?? { remove() {} };
}

export function addMissionSceneProgressListener(listener: (event: MissionSceneProgressEvent) => void) {
  return (emitter as any)?.addListener('onMissionSceneProgress', listener) ?? { remove() {} };
}

export function addMissionSceneEndListener(listener: (event: MissionSceneLifecycleEvent) => void) {
  return (emitter as any)?.addListener('onMissionSceneEnd', listener) ?? { remove() {} };
}

export function addMissionCompleteListener(listener: () => void) {
  return (emitter as any)?.addListener('onMissionComplete', listener) ?? { remove() {} };
}

export function addMissionErrorListener(listener: (event: MissionErrorEvent) => void) {
  return (emitter as any)?.addListener('onMissionError', listener) ?? { remove() {} };
}

export function addMissionDebugListener(listener: (event: MissionDebugEvent) => void) {
  return (emitter as any)?.addListener('onMissionDebug', listener) ?? { remove() {} };
}
