import type { MutableRefObject } from 'react';
import type { MissionControlBrief } from './api';
import type { MissionCinematic, MissionScene } from './copilotStoryboard';
import type { CopilotPresenceState } from '@/components/copilot/CopilotPresenceOrb';
import { speakCopilotNarration, stopTrailheadVoice } from './voice';

export type MissionBriefPlaybackState = {
  cinematic: MissionCinematic | null;
  missionBrief: MissionControlBrief | null;
  missionLoading: boolean;
  activeScene: MissionScene | null;
  activeSceneIndex: number;
  playing: boolean;
  paused: boolean;
  complete: boolean;
  error: boolean;
  copilotPresence: CopilotPresenceState;
};

export function createMissionBriefPlaybackHandlers(opts: {
  webRef: MutableRefObject<{ postMessage: (msg: string) => void } | null>;
  cinematicRef: MutableRefObject<MissionCinematic | null>;
  presenceAfterSpeechRef: MutableRefObject<CopilotPresenceState>;
  setState: (patch: Partial<MissionBriefPlaybackState>) => void;
  logEvent?: (event: string, data?: Record<string, unknown>) => void;
}) {
  const { webRef, cinematicRef, presenceAfterSpeechRef, setState, logEvent } = opts;

  function sendCinematicCommand(command: 'replay' | 'pause' | 'resume' | 'skip' | 'stop') {
    const target = webRef.current;
    const postMessage = target?.postMessage;
    if (typeof postMessage !== 'function') return;
    try {
      postMessage.call(target, JSON.stringify({ type: 'mission_brief_cmd', command }));
    } catch {
      // Ignore stale WebView refs while the map remounts.
    }
  }

  function speakNarration(message: string, onPresence: CopilotPresenceState) {
    const text = message.trim();
    if (!text) return;
    presenceAfterSpeechRef.current = onPresence;
    speakCopilotNarration(text, {
      onStart: () => setState({ copilotPresence: 'speaking' }),
      onFinish: () => setState({ copilotPresence: presenceAfterSpeechRef.current }),
    }).catch(() => {});
  }

  function handleCinematicMessage(data: Record<string, unknown>) {
    const cinematic = cinematicRef.current;
    if (data.type === 'cinematic_ready') {
      setState({ error: false, copilotPresence: 'building' });
      logEvent?.('cinematic_opened', { scenes: cinematic?.scenes.length ?? 0 });
      return;
    }
    if (data.type === 'cinematic_started') {
      setState({ playing: true, paused: false, complete: false, error: false, copilotPresence: 'flying' });
      presenceAfterSpeechRef.current = 'flying';
      return;
    }
    if (data.type === 'cinematic_scene_started') {
      const index = Number(data.index ?? 0);
      const scene = cinematic?.scenes.find(item => item.id === data.sceneId) ?? cinematic?.scenes[index] ?? null;
      const basePresence: CopilotPresenceState = scene?.layers?.warning ? 'warning' : 'flying';
      presenceAfterSpeechRef.current = scene?.type === 'mission_recap' ? 'complete' : basePresence;
      setState({
        activeSceneIndex: index,
        activeScene: scene,
        playing: true,
        paused: false,
        copilotPresence: basePresence,
      });
      if (scene?.narration) speakNarration(scene.narration, basePresence);
      logEvent?.('cinematic_scene_started', { scene_id: scene?.id ?? data.sceneId, scene_type: scene?.type, index });
      return;
    }
    if (data.type === 'cinematic_paused') {
      setState({ paused: true, copilotPresence: 'paused' });
      logEvent?.('cinematic_pause', { index: Number(data.index ?? 0) });
      return;
    }
    if (data.type === 'cinematic_resumed') {
      const scene = cinematic?.scenes[Number(data.index ?? 0)] ?? null;
      setState({
        paused: false,
        copilotPresence: scene?.layers?.warning ? 'warning' : 'flying',
      });
      logEvent?.('cinematic_resume', { index: Number(data.index ?? 0) });
      return;
    }
    if (data.type === 'cinematic_complete') {
      setState({ playing: false, paused: false, complete: true, copilotPresence: 'complete' });
      presenceAfterSpeechRef.current = 'complete';
      logEvent?.('cinematic_complete', { scenes: cinematic?.scenes.length ?? 0 });
      return;
    }
    if (data.type === 'cinematic_error') {
      setState({
        playing: false,
        paused: false,
        error: true,
        activeScene: null,
        copilotPresence: 'idle',
      });
      presenceAfterSpeechRef.current = 'idle';
      stopTrailheadVoice().catch(() => {});
      logEvent?.('cinematic_error', { message: String(data.message || '').slice(0, 200) });
    }
  }

  function replay() {
    stopTrailheadVoice().catch(() => {});
    setState({ complete: false, error: false, paused: false, copilotPresence: 'flying' });
    presenceAfterSpeechRef.current = 'flying';
    sendCinematicCommand('replay');
    logEvent?.('cinematic_replay');
  }

  function pauseResume(paused: boolean) {
    if (paused) {
      sendCinematicCommand('resume');
      return;
    }
    stopTrailheadVoice().catch(() => {});
    sendCinematicCommand('pause');
  }

  function skip() {
    stopTrailheadVoice().catch(() => {});
    sendCinematicCommand('skip');
  }

  function stop() {
    stopTrailheadVoice().catch(() => {});
    sendCinematicCommand('stop');
    setState({
      playing: false,
      paused: false,
      complete: false,
      error: false,
      activeScene: null,
      activeSceneIndex: 0,
      copilotPresence: 'idle',
      cinematic: null,
    });
    cinematicRef.current = null;
    presenceAfterSpeechRef.current = 'idle';
  }

  return { handleCinematicMessage, replay, pauseResume, skip, stop, sendCinematicCommand };
}
