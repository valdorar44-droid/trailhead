import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import { api } from './api';

type SpeechOptions = Parameters<typeof Speech.speak>[1];
type VoiceMode = 'direction' | 'guide';
type VoiceCallbacks = {
  onStart?: () => void;
  onFinish?: () => void;
};

let activeSound: Audio.Sound | null = null;
let voiceRequestId = 0;

export async function stopTrailheadVoice() {
  voiceRequestId += 1;
  try {
    Speech.stop();
    if (activeSound) {
      const sound = activeSound;
      activeSound = null;
      await sound.stopAsync().catch(() => {});
      await sound.unloadAsync().catch(() => {});
    }
  } catch {}
}

export async function playTrailheadVoice(text: string, mode: VoiceMode, fallbackOptions?: SpeechOptions, callbacks?: VoiceCallbacks) {
  const clean = text.trim();
  if (!clean) return;
  const requestId = voiceRequestId + 1;
  voiceRequestId = requestId;
  await stopTrailheadVoice();
  voiceRequestId = requestId;
  try {
    const source = await api.ttsSource(clean, mode);
    if (requestId !== voiceRequestId) return;
    const { sound } = await Audio.Sound.createAsync(
      source,
      { shouldPlay: true },
      status => {
        if ('didJustFinish' in status && status.didJustFinish) {
          sound.unloadAsync().catch(() => {});
          if (activeSound === sound) activeSound = null;
          callbacks?.onFinish?.();
        }
      },
    );
    if (requestId !== voiceRequestId) {
      await sound.stopAsync().catch(() => {});
      await sound.unloadAsync().catch(() => {});
      return;
    }
    activeSound = sound;
    callbacks?.onStart?.();
  } catch (err) {
    console.warn('Trailhead voice MP3 failed; falling back to device speech.', err);
    if (requestId !== voiceRequestId) return;
    Speech.speak(clean, {
      rate: 0.9,
      pitch: 1,
      language: 'en-US',
      ...(fallbackOptions ?? {}),
      onStart: callbacks?.onStart,
      onDone: callbacks?.onFinish,
      onStopped: callbacks?.onFinish,
      onError: callbacks?.onFinish,
    });
  }
}
