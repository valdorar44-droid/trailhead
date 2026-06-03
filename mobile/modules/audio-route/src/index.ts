import { requireOptionalNativeModule } from 'expo-modules-core';

const M = requireOptionalNativeModule('AudioRouteModule');

export async function setSpeakerphoneEnabled(enabled: boolean): Promise<boolean> {
  if (!M?.setSpeakerphoneEnabled) return false;
  return M.setSpeakerphoneEnabled(enabled);
}
