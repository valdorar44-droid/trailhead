import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import * as Speech from 'expo-speech';
import { api } from './api';

type SpeechOptions = Parameters<typeof Speech.speak>[1];
type VoiceMode = 'direction' | 'guide' | 'flyover';
type VoiceStartSource = 'cartesia_sonic' | 'device_tts';
type VoiceCallbacks = {
  onStart?: (source?: VoiceStartSource) => void;
  onFinish?: (source?: VoiceStartSource) => void;
  onFallback?: (reason?: string) => void;
  onUnavailable?: () => void;
  allowDeviceFallback?: boolean;
  startTimeoutMs?: number;
};

const COPILOT_LISTENING_CUE = require('../assets/trail-guide/copilot-listening.wav');

let activeSound: Audio.Sound | null = null;
let activeCueSound: Audio.Sound | null = null;
let voiceRequestId = 0;
let audioModeReady: Promise<void> | null = null;
let cueAudioModeReady: Promise<void> | null = null;
let deviceVoicePromise: Promise<string | undefined> | null = null;
const preloadedSounds = new Map<string, { sound: Audio.Sound; createdAt: number }>();

function voiceCacheKey(text: string, mode: VoiceMode) {
  return `${mode}:${text.trim()}`;
}

function generatedVoiceSource(_mode: VoiceMode): VoiceStartSource {
  return 'cartesia_sonic';
}

function trimPreloadedVoiceCache(limit = 4) {
  const entries = [...preloadedSounds.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
  while (entries.length > limit) {
    const [key, item] = entries.shift()!;
    preloadedSounds.delete(key);
    item.sound.unloadAsync().catch(() => {});
  }
}

async function bestDeviceVoiceId(): Promise<string | undefined> {
  if (!deviceVoicePromise) {
    deviceVoicePromise = Speech.getAvailableVoicesAsync()
      .then(voices => {
        const en = voices.filter(voice => voice.language === 'en-US' || voice.language?.startsWith('en-US') || voice.language?.startsWith('en-'));
        const score = (voice: any) => {
          const haystack = `${voice.identifier || ''} ${voice.name || ''} ${voice.quality || ''}`.toLowerCase();
          let value = 0;
          if (/siri|enhanced|premium|neural|natural|google|samsung/.test(haystack)) value += 8;
          if (/compact|default/.test(haystack)) value -= 3;
          if (voice.language === 'en-US') value += 2;
          return value;
        };
        return en.sort((a, b) => score(b) - score(a))[0]?.identifier;
      })
      .catch(() => undefined);
  }
  return deviceVoicePromise;
}

function ensureVoiceAudioMode() {
  if (!audioModeReady) {
    audioModeReady = Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      interruptionModeIOS: InterruptionModeIOS.DuckOthers,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    }).catch(err => {
      audioModeReady = null;
      throw err;
    });
  }
  return audioModeReady;
}

function ensureCueAudioMode() {
  if (!cueAudioModeReady) {
    cueAudioModeReady = Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      interruptionModeIOS: InterruptionModeIOS.DuckOthers,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    }).catch(err => {
      cueAudioModeReady = null;
      throw err;
    });
  }
  return cueAudioModeReady;
}

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

export async function preloadTrailheadVoice(text: string, mode: VoiceMode = 'flyover'): Promise<boolean> {
  const clean = text.trim();
  if (!clean) return false;
  const key = voiceCacheKey(clean, mode);
  if (preloadedSounds.has(key)) return true;
  try {
    await ensureVoiceAudioMode();
    const source = await api.ttsSource(clean, mode);
    const { sound } = await Audio.Sound.createAsync(source, { shouldPlay: false });
    preloadedSounds.set(key, { sound, createdAt: Date.now() });
    trimPreloadedVoiceCache();
    return true;
  } catch {
    return false;
  }
}

export async function playTrailheadCue(name: 'copilotListening') {
  try {
    await ensureCueAudioMode();
    if (activeCueSound) {
      const sound = activeCueSound;
      activeCueSound = null;
      await sound.stopAsync().catch(() => {});
      await sound.unloadAsync().catch(() => {});
    }
    const cueSource = { copilotListening: COPILOT_LISTENING_CUE }[name];
    const { sound } = await Audio.Sound.createAsync(
      cueSource,
      { shouldPlay: true, volume: 0.72 },
      status => {
        if ('didJustFinish' in status && status.didJustFinish) {
          sound.unloadAsync().catch(() => {});
          if (activeCueSound === sound) activeCueSound = null;
        }
      },
    );
    activeCueSound = sound;
  } catch {}
}

/** Cinematic narration — instant on-device speech (zero network latency, always plays).
 *  Used for the flythrough so narration never lags or goes silent. */
export function speakCinematicNarration(text: string, callbacks?: VoiceCallbacks) {
  const clean = (text || '').trim();
  if (!clean) return;
  voiceRequestId += 1;
  ensureVoiceAudioMode().catch(() => {});
  try { Speech.stop(); } catch {}
  bestDeviceVoiceId().then(voice => {
    Speech.speak(clean, {
      rate: 0.92,
      pitch: 1.02,
      language: 'en-US',
      ...(voice ? { voice } : {}),
      onStart: () => callbacks?.onStart?.('device_tts'),
      onDone: () => callbacks?.onFinish?.('device_tts'),
      onStopped: () => callbacks?.onFinish?.('device_tts'),
      onError: () => callbacks?.onFinish?.('device_tts'),
    });
  }).catch(() => {
    Speech.speak(clean, {
      rate: 0.92,
      pitch: 1.02,
      language: 'en-US',
      onStart: () => callbacks?.onStart?.('device_tts'),
      onDone: () => callbacks?.onFinish?.('device_tts'),
      onStopped: () => callbacks?.onFinish?.('device_tts'),
      onError: () => callbacks?.onFinish?.('device_tts'),
    });
  });
}

/** Co-Pilot cinematic narration — Cartesia via Trailhead's server-side TTS. */
export async function speakCopilotNarration(text: string, callbacks?: VoiceCallbacks) {
  return playTrailheadVoice(
    text,
    'guide',
    { rate: 0.9, pitch: 1, language: 'en-US' },
    callbacks,
  );
}

/** Flyover narration: Cartesia Sonic first; no device fallback unless explicitly allowed. */
export async function speakFlyoverBeat(text: string, callbacks?: VoiceCallbacks) {
  const clean = text.trim();
  if (!clean) return;
  const allowDeviceFallback = callbacks?.allowDeviceFallback === true;
  let started = false;
  let finished = false;
  let fallbackStarted = false;
  const finishUnavailable = () => {
    if (finished || fallbackStarted) return;
    fallbackStarted = true;
    finished = true;
    callbacks?.onUnavailable?.();
  };
  const startDeviceSpeech = () => {
    if (finished || fallbackStarted) return;
    if (!allowDeviceFallback) {
      finishUnavailable();
      return;
    }
    fallbackStarted = true;
    callbacks?.onFallback?.('cartesia_voice_unavailable');
    stopTrailheadVoice().catch(() => {});
    speakCinematicNarration(clean, {
      onStart: () => {
        started = true;
        callbacks?.onStart?.();
      },
      onFinish: () => {
        finished = true;
        callbacks?.onFinish?.();
      },
    });
  };
  const startTimer = setTimeout(() => {
    if (!started && !finished) startDeviceSpeech();
  }, callbacks?.startTimeoutMs ?? 2400);
  try {
    await playTrailheadVoice(clean, 'flyover', allowDeviceFallback ? { rate: 0.9, pitch: 1, language: 'en-US' } : false, {
      onStart: source => {
        if (fallbackStarted || finished) return;
        started = true;
        clearTimeout(startTimer);
        callbacks?.onStart?.(source);
      },
      onFinish: source => {
        if (finished) return;
        finished = true;
        clearTimeout(startTimer);
        callbacks?.onFinish?.(source);
      },
      onFallback: () => {
        clearTimeout(startTimer);
        startDeviceSpeech();
      },
    });
  } catch {
    clearTimeout(startTimer);
    startDeviceSpeech();
  }
}

export async function playTrailheadVoice(text: string, mode: VoiceMode, fallbackOptions?: SpeechOptions | false, callbacks?: VoiceCallbacks) {
  const clean = text.trim();
  if (!clean) return;
  const requestId = voiceRequestId + 1;
  voiceRequestId = requestId;
  await stopTrailheadVoice();
  voiceRequestId = requestId;
  try {
    await ensureVoiceAudioMode();
    if (requestId !== voiceRequestId) return;
    const key = voiceCacheKey(clean, mode);
    const cached = preloadedSounds.get(key);
    let sound = cached?.sound ?? null;
    if (cached) preloadedSounds.delete(key);
    if (!sound) {
      const source = await api.ttsSource(clean, mode);
      if (requestId !== voiceRequestId) return;
      const created = await Audio.Sound.createAsync(source, { shouldPlay: false });
      sound = created.sound;
    }
    if (requestId !== voiceRequestId) {
      await sound.stopAsync().catch(() => {});
      await sound.unloadAsync().catch(() => {});
      return;
    }
    activeSound = sound;
    sound.setOnPlaybackStatusUpdate(status => {
      if ('didJustFinish' in status && status.didJustFinish) {
        sound?.unloadAsync().catch(() => {});
        if (activeSound === sound) activeSound = null;
        callbacks?.onFinish?.(generatedVoiceSource(mode));
      }
    });
    await sound.setPositionAsync(0).catch(() => {});
    await sound.playAsync();
    callbacks?.onStart?.(generatedVoiceSource(mode));
  } catch (err) {
    console.warn('Trailhead voice MP3 failed.', err);
    if (requestId !== voiceRequestId) return;
    if (fallbackOptions === false) {
      callbacks?.onFallback?.('generated_voice_error');
      return;
    }
    ensureVoiceAudioMode().catch(() => {});
    const voice = await bestDeviceVoiceId();
    Speech.speak(clean, {
      rate: 0.9,
      pitch: 1,
      language: 'en-US',
      ...(voice ? { voice } : {}),
      ...(fallbackOptions ?? {}),
      onStart: () => callbacks?.onStart?.('device_tts'),
      onDone: () => callbacks?.onFinish?.('device_tts'),
      onStopped: () => callbacks?.onFinish?.('device_tts'),
      onError: () => callbacks?.onFinish?.('device_tts'),
    });
  }
}
