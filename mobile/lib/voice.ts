import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import * as Speech from 'expo-speech';
import { api } from './api';
import {
  originalAudioCoordinator,
  type OriginalAudioFocusLease,
  type OriginalAudioPriorityName,
} from './originals/audioCoordinator';
import { applyNativeAudioSessionMode } from './originals/nativeAudioSession';

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
let cueRequestId = 0;
let deviceVoicePromise: Promise<string | undefined> | null = null;
const preloadedSounds = new Map<string, { sound: Audio.Sound; createdAt: number }>();
let activeVoiceFocus: { requestId: number; owner: string; lease: OriginalAudioFocusLease } | null = null;
let activeCueFocus: { requestId: number; owner: string; lease: OriginalAudioFocusLease } | null = null;

function voiceAudioPriority(mode: VoiceMode): OriginalAudioPriorityName {
  return mode === 'direction' ? 'navigation' : 'copilot';
}

async function releaseVoiceAudioFocus(requestId?: number) {
  const focus = activeVoiceFocus;
  if (!focus || (requestId != null && focus.requestId !== requestId)) return;
  activeVoiceFocus = null;
  await focus.lease.release().catch(() => {});
}

async function acquireVoiceAudioFocus(requestId: number, mode: VoiceMode) {
  const owner = `trailhead-voice:${mode}:${requestId}`;
  const lease = await originalAudioCoordinator.acquire({
    owner,
    priority: voiceAudioPriority(mode),
    pause: async () => {
      if (requestId !== voiceRequestId) return;
      if (activeSound) await activeSound.pauseAsync().catch(() => {});
      else await Speech.pause().catch(() => {});
    },
    resume: async () => {
      if (requestId !== voiceRequestId) return;
      if (activeSound) await activeSound.playAsync().catch(() => {});
      else await Speech.resume().catch(() => {});
    },
    canAutoResume: () => requestId === voiceRequestId,
  });
  if (requestId !== voiceRequestId || originalAudioCoordinator.activeOwner() !== owner) {
    await lease.release().catch(() => {});
    return false;
  }
  activeVoiceFocus = { requestId, owner, lease };
  return true;
}

async function releaseCueAudioFocus(requestId?: number) {
  const focus = activeCueFocus;
  if (!focus || (requestId != null && focus.requestId !== requestId)) return;
  activeCueFocus = null;
  await focus.lease.release().catch(() => {});
}

async function stopActiveTrailheadCue(expectedRequestId?: number) {
  if (expectedRequestId != null && activeCueFocus?.requestId !== expectedRequestId) return;
  const focusRequestId = activeCueFocus?.requestId;
  const sound = activeCueSound;
  activeCueSound = null;
  if (sound) {
    await sound.stopAsync().catch(() => {});
    await sound.unloadAsync().catch(() => {});
  }
  if (focusRequestId != null) await releaseCueAudioFocus(focusRequestId);
}

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
  return applyNativeAudioSessionMode(() => Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    interruptionModeIOS: InterruptionModeIOS.DuckOthers,
    playsInSilentModeIOS: true,
    staysActiveInBackground: true,
    interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: false,
  }));
}

function ensureCueAudioMode() {
  return applyNativeAudioSessionMode(() => Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    interruptionModeIOS: InterruptionModeIOS.DuckOthers,
    playsInSilentModeIOS: true,
    staysActiveInBackground: true,
    interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: false,
  }));
}

async function stopActiveTrailheadVoice() {
  const focusRequestId = activeVoiceFocus?.requestId;
  const sound = activeSound;
  activeSound = null;
  try {
    await Speech.stop().catch(() => {});
    if (sound) {
      await sound.stopAsync().catch(() => {});
      await sound.unloadAsync().catch(() => {});
    }
  } catch {
  } finally {
    if (focusRequestId != null) await releaseVoiceAudioFocus(focusRequestId);
  }
}

export async function stopTrailheadVoice() {
  voiceRequestId += 1;
  await stopActiveTrailheadVoice();
}

export async function preloadTrailheadVoice(text: string, mode: VoiceMode = 'flyover'): Promise<boolean> {
  const clean = text.trim();
  if (!clean) return false;
  const key = voiceCacheKey(clean, mode);
  if (preloadedSounds.has(key)) return true;
  try {
    const source = await api.ttsSource(clean, mode);
    const { sound } = await Audio.Sound.createAsync(source, { shouldPlay: false });
    preloadedSounds.set(key, { sound, createdAt: Date.now() });
    trimPreloadedVoiceCache();
    return true;
  } catch {
    return false;
  }
}

export async function playTrailheadCue(name: 'copilotListening' | 'trailGuidance') {
  const requestId = cueRequestId + 1;
  cueRequestId = requestId;
  try {
    await stopActiveTrailheadCue();
    if (requestId !== cueRequestId) return;
    const owner = `trailhead-ui-cue:${requestId}`;
    const lease = await originalAudioCoordinator.acquire({
      owner,
      priority: 'ui',
      pause: async () => {
        if (requestId === cueRequestId) await activeCueSound?.pauseAsync().catch(() => {});
      },
      resume: async () => {
        if (requestId === cueRequestId) await activeCueSound?.playAsync().catch(() => {});
      },
      canAutoResume: () => requestId === cueRequestId,
    });
    if (requestId !== cueRequestId || originalAudioCoordinator.activeOwner() !== owner) {
      await lease.release().catch(() => {});
      return;
    }
    activeCueFocus = { requestId, owner, lease };
    await ensureCueAudioMode();
    if (requestId !== cueRequestId || originalAudioCoordinator.activeOwner() !== owner) {
      await releaseCueAudioFocus(requestId);
      return;
    }
    const cueSource = { copilotListening: COPILOT_LISTENING_CUE, trailGuidance: COPILOT_LISTENING_CUE }[name];
    let cueSound: Audio.Sound | null = null;
    const created = await Audio.Sound.createAsync(
      cueSource,
      { shouldPlay: false, volume: 0.72 },
      status => {
        if ('didJustFinish' in status && status.didJustFinish && cueSound) {
          const finishedSound = cueSound;
          cueSound = null;
          finishedSound.unloadAsync().catch(() => {});
          if (activeCueSound === finishedSound) activeCueSound = null;
          void releaseCueAudioFocus(requestId);
        }
      },
    );
    cueSound = created.sound;
    if (requestId !== cueRequestId || originalAudioCoordinator.activeOwner() !== owner) {
      const sound = cueSound;
      cueSound = null;
      await sound.unloadAsync().catch(() => {});
      await releaseCueAudioFocus(requestId);
      return;
    }
    activeCueSound = cueSound;
    await cueSound.playAsync();
  } catch {
    await stopActiveTrailheadCue(requestId);
  }
}

/** Cinematic narration — instant on-device speech (zero network latency, always plays).
 *  Used for the flythrough so narration never lags or goes silent. */
export function speakCinematicNarration(text: string, callbacks?: VoiceCallbacks) {
  const clean = (text || '').trim();
  if (!clean) return;
  const requestId = voiceRequestId + 1;
  voiceRequestId = requestId;
  void (async () => {
    await stopActiveTrailheadVoice();
    if (requestId !== voiceRequestId) return;
    const hasFocus = await acquireVoiceAudioFocus(requestId, 'flyover');
    if (!hasFocus) {
      callbacks?.onUnavailable?.();
      return;
    }
    try {
      await ensureVoiceAudioMode();
      const voice = await bestDeviceVoiceId();
      if (requestId !== voiceRequestId) {
        await releaseVoiceAudioFocus(requestId);
        return;
      }
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        void releaseVoiceAudioFocus(requestId)
          .finally(() => callbacks?.onFinish?.('device_tts'));
      };
      Speech.speak(clean, {
        rate: 0.92,
        pitch: 1.02,
        language: 'en-US',
        ...(voice ? { voice } : {}),
        onStart: () => callbacks?.onStart?.('device_tts'),
        onDone: finish,
        onStopped: finish,
        onError: finish,
      });
    } catch {
      await releaseVoiceAudioFocus(requestId);
      callbacks?.onFinish?.('device_tts');
    }
  })();
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
    speakCinematicNarration(clean, {
      onStart: () => {
        started = true;
        callbacks?.onStart?.();
      },
      onFinish: () => {
        finished = true;
        callbacks?.onFinish?.();
      },
      onUnavailable: () => {
        if (finished) return;
        finished = true;
        callbacks?.onUnavailable?.();
      },
    });
  };
  const startTimer = allowDeviceFallback
    ? setTimeout(() => {
        if (!started && !finished) startDeviceSpeech();
      }, callbacks?.startTimeoutMs ?? 2400)
    : null;
  try {
    await playTrailheadVoice(clean, 'flyover', allowDeviceFallback ? { rate: 0.9, pitch: 1, language: 'en-US' } : false, {
      onStart: source => {
        if (fallbackStarted || finished) return;
        started = true;
        if (startTimer) clearTimeout(startTimer);
        callbacks?.onStart?.(source);
      },
      onFinish: source => {
        if (finished) return;
        finished = true;
        if (startTimer) clearTimeout(startTimer);
        callbacks?.onFinish?.(source);
      },
      onFallback: () => {
        if (startTimer) clearTimeout(startTimer);
        startDeviceSpeech();
      },
    });
  } catch {
    if (startTimer) clearTimeout(startTimer);
    startDeviceSpeech();
  }
}

export async function playTrailheadVoice(text: string, mode: VoiceMode, fallbackOptions?: SpeechOptions | false, callbacks?: VoiceCallbacks) {
  const clean = text.trim();
  if (!clean) return;
  const requestId = voiceRequestId + 1;
  voiceRequestId = requestId;
  await stopActiveTrailheadVoice();
  if (requestId !== voiceRequestId) return;
  try {
    const hasFocus = await acquireVoiceAudioFocus(requestId, mode);
    if (!hasFocus) {
      if (callbacks?.onUnavailable) callbacks.onUnavailable();
      else callbacks?.onFallback?.('audio_focus_unavailable');
      return;
    }
    await ensureVoiceAudioMode();
    if (requestId !== voiceRequestId) {
      await releaseVoiceAudioFocus(requestId);
      return;
    }
    const key = voiceCacheKey(clean, mode);
    const cached = preloadedSounds.get(key);
    let sound = cached?.sound ?? null;
    if (cached) preloadedSounds.delete(key);
    if (!sound) {
      const source = await api.ttsSource(clean, mode);
      if (requestId !== voiceRequestId) {
        await releaseVoiceAudioFocus(requestId);
        return;
      }
      const created = await Audio.Sound.createAsync(source, { shouldPlay: false });
      sound = created.sound;
    }
    if (requestId !== voiceRequestId) {
      await sound.stopAsync().catch(() => {});
      await sound.unloadAsync().catch(() => {});
      await releaseVoiceAudioFocus(requestId);
      return;
    }
    activeSound = sound;
    let finished = false;
    sound.setOnPlaybackStatusUpdate(status => {
      if ('didJustFinish' in status && status.didJustFinish && !finished) {
        finished = true;
        sound?.unloadAsync().catch(() => {});
        if (activeSound === sound) activeSound = null;
        void releaseVoiceAudioFocus(requestId)
          .finally(() => callbacks?.onFinish?.(generatedVoiceSource(mode)));
      }
    });
    await sound.setPositionAsync(0).catch(() => {});
    await sound.playAsync();
    callbacks?.onStart?.(generatedVoiceSource(mode));
  } catch (err) {
    console.warn('Trailhead voice MP3 failed.', err);
    if (requestId !== voiceRequestId) {
      await releaseVoiceAudioFocus(requestId);
      return;
    }
    if (activeSound) {
      const sound = activeSound;
      activeSound = null;
      await sound.stopAsync().catch(() => {});
      await sound.unloadAsync().catch(() => {});
    }
    if (fallbackOptions === false) {
      await releaseVoiceAudioFocus(requestId);
      callbacks?.onFallback?.('generated_voice_error');
      return;
    }
    ensureVoiceAudioMode().catch(() => {});
    const voice = await bestDeviceVoiceId();
    if (requestId !== voiceRequestId) {
      await releaseVoiceAudioFocus(requestId);
      return;
    }
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      void releaseVoiceAudioFocus(requestId)
        .finally(() => callbacks?.onFinish?.('device_tts'));
    };
    try {
      Speech.speak(clean, {
        rate: 0.9,
        pitch: 1,
        language: 'en-US',
        ...(voice ? { voice } : {}),
        ...(fallbackOptions ?? {}),
        onStart: () => callbacks?.onStart?.('device_tts'),
        onDone: finish,
        onStopped: finish,
        onError: finish,
      });
    } catch {
      await releaseVoiceAudioFocus(requestId);
      callbacks?.onFinish?.('device_tts');
    }
  }
}
