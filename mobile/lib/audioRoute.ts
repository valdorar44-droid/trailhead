import { setSpeakerphoneEnabled } from '@/modules/audio-route/src';

export async function enableRealtimeSpeakerphone(): Promise<void> {
  await setSpeakerphoneEnabled(true).catch(() => false);
}

export async function disableRealtimeSpeakerphone(): Promise<void> {
  await setSpeakerphoneEnabled(false).catch(() => false);
}
