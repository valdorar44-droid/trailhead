import { requireOptionalNativeModule } from 'expo-modules-core';
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

export type MissionSceneProgressEvent = {
  sceneId: string;
  progress: number;
};

export type MissionSceneLifecycleEvent = {
  sceneId: string;
  index: number;
  type: string;
};

type NativeMissionAnimator = {
  isAvailable?: () => boolean | Promise<boolean>;
  startMissionAnimation?: (payload: MissionAnimationPayload) => boolean | Promise<boolean>;
  pauseMissionAnimation?: () => boolean | Promise<boolean>;
  resumeMissionAnimation?: () => boolean | Promise<boolean>;
  stopMissionAnimation?: () => boolean | Promise<boolean>;
  setMissionAnimationSpeed?: (speed: number) => boolean | Promise<boolean>;
};

const Native = requireOptionalNativeModule<NativeMissionAnimator>('TrailheadMissionAnimator');

/** True only after a native binary ships the animator (Phase B). OTA alone cannot enable this. */
export async function isMissionAnimatorAvailable(): Promise<boolean> {
  if (!Native?.isAvailable) return false;
  try {
    return !!(await Native.isAvailable());
  } catch {
    return false;
  }
}

export async function startMissionAnimation(payload: MissionAnimationPayload): Promise<boolean> {
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

export async function setMissionAnimationSpeed(speed: number): Promise<boolean> {
  if (!Native?.setMissionAnimationSpeed) return false;
  try {
    return !!(await Native.setMissionAnimationSpeed(speed));
  } catch {
    return false;
  }
}
