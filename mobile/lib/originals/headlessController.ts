import type { OriginalAccessStore } from './accessStore';
import type { OriginalAudioAdapter, OriginalAudioPlaybackState } from './audioAdapter';
import { originalAudioCoordinator, type OriginalAudioFocusLease } from './audioCoordinator';
import type { OriginalBundleStore } from './bundleStore';
import { completeOriginalStop, finishManualOriginalStop } from './session';
import type { OriginalSessionStore } from './sessionStore';
import { evaluateOriginalLocation } from './triggerEngine';
import type { OriginalLocationSample, OriginalManifestV1, OriginalSessionV1 } from './types';

export type OriginalHeadlessControllerDependencies = {
  audio: OriginalAudioAdapter;
  access: OriginalAccessStore;
  bundles: OriginalBundleStore;
  sessions: OriginalSessionStore;
};

type StopTracking = () => Promise<void>;

/**
 * Owns the smallest possible cold-task runtime. It never reads the network or
 * uploads locations: it restores one exact verified download, advances the
 * pure trigger state machine, persists the cue, and only then starts local
 * narration.
 */
export function createOriginalHeadlessController(
  dependencies: OriginalHeadlessControllerDependencies,
) {
  let operationTail: Promise<unknown> = Promise.resolve();
  let audioLease: OriginalAudioFocusLease | null = null;
  let playingKey: string | null = null;
  let lastPositionPersisted = 0;
  let stopTracking: StopTracking = async () => {};
  let generation = 0;
  let stopping = false;
  let stopOperation: Promise<void> | null = null;

  const serialized = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = operationTail.then(operation, operation);
    operationTail = result.catch(() => undefined);
    return result;
  };

  const cancellationWon = (operationGeneration: number) => (
    stopping || generation !== operationGeneration
  );

  const releaseAudio = async () => {
    const lease = audioLease;
    audioLease = null;
    playingKey = null;
    if (lease) await lease.release().catch(() => {});
  };

  const exactContext = async () => {
    const session = await dependencies.sessions.loadActive();
    if (!session || session.status !== 'active' || session.user_paused) {
      return { kind: 'inactive' as const };
    }
    const access = await dependencies.access.get(session.owner_scope, session.pack_id, session.version);
    const allowed = access?.owner_scope === session.owner_scope && (
      session.owner_scope === 'guest'
        ? access.access_type === 'guest_free'
        : access.access_type === 'entitled'
    );
    if (!allowed) return { kind: 'inactive' as const };
    const [bundle, manifest] = await Promise.all([
      dependencies.bundles.get(session.owner_scope, session.pack_id, session.version),
      // StartTour already performed the full hash/map verification. Reading the
      // immutable promoted manifest here keeps a cold cue within the spike's
      // three-second budget without re-hashing the whole pack every GPS fix.
      dependencies.bundles.loadManifest(session.owner_scope, session.pack_id, session.version, false),
    ]);
    if (!bundle || !manifest || manifest.manifest_id !== session.manifest_id) {
      return { kind: 'unavailable' as const };
    }
    return { kind: 'ready' as const, session, manifest };
  };

  const activeSessionStillMatches = async (
    expected: OriginalSessionV1,
    operationGeneration: number,
    stopId?: string,
  ) => {
    if (generation !== operationGeneration) return false;
    const active = await dependencies.sessions.loadActive();
    return Boolean(
      generation === operationGeneration
      && active
      && active.session_id === expected.session_id
      && active.status === 'active'
      && !active.user_paused
      && (stopId == null || active.current_stop_id === stopId),
    );
  };

  const persistAudioState = (stopId: string, state: OriginalAudioPlaybackState) => serialized(async () => {
    const active = await dependencies.sessions.loadActive();
    if (!active || active.current_stop_id !== stopId) return;
    if (Math.abs(state.position_ms - lastPositionPersisted) < 5_000) return;
    lastPositionPersisted = state.position_ms;
    await dependencies.sessions.setActiveIfCurrent(active.session_id, {
      ...active,
      current_audio_position_ms: Math.max(0, state.position_ms),
      updated_at_ms: Date.now(),
    });
  });

  const persistUserPause = (stopId: string, state: OriginalAudioPlaybackState) => serialized(async () => {
    const active = await dependencies.sessions.loadActive();
    if (!active || active.current_stop_id !== stopId || active.user_paused) return;
    await dependencies.sessions.setActiveIfCurrent(active.session_id, {
      ...active,
      status: 'paused',
      user_paused: true,
      current_audio_position_ms: Math.max(0, state.position_ms),
      updated_at_ms: Date.now(),
    });
    await releaseAudio();
    await stopTracking().catch(() => {});
    if (originalAudioCoordinator.activeOwner() == null) {
      await dependencies.audio.releaseSession().catch(() => {});
    }
  });

  const playStopInternal = async (
    manifest: OriginalManifestV1,
    session: OriginalSessionV1,
    stopId: string,
    positionMs = 0,
    operationGeneration = generation,
  ) => {
    if (generation !== operationGeneration) return false;
    const key = `${session.owner_scope}:${session.pack_id}:${session.version}:${stopId}`;
    const currentAudio = await dependencies.audio.getState();
    if (generation !== operationGeneration) return false;
    if (playingKey === key && currentAudio.loaded) return;
    const stop = manifest.stops.find(value => value.id === stopId);
    if (!stop) throw new Error('The active Original cue is missing from its immutable manifest.');
    const localUri = await dependencies.bundles.assetUri(
      session.owner_scope,
      session.pack_id,
      session.version,
      stop.audio_asset_id,
    );
    if (!localUri) throw new Error('The active Original narration is not available offline.');
    if (!await activeSessionStillMatches(session, operationGeneration)) return false;

    const persisted = {
      ...session,
      current_stop_id: stopId,
      current_audio_position_ms: Math.max(0, positionMs),
      updated_at_ms: Date.now(),
    };
    // This write is intentionally before load/play for duplicate prevention.
    const saved = await dependencies.sessions.setActiveIfCurrent(session.session_id, persisted);
    if (!saved || generation !== operationGeneration) return false;
    await releaseAudio();
    if (!await activeSessionStillMatches(saved, operationGeneration, stopId)) return false;
    audioLease = await originalAudioCoordinator.acquire({
      owner: 'trailhead-originals',
      priority: 'originals',
      pause: async () => {
        await dependencies.audio.pause();
        const state = await dependencies.audio.getState();
        await persistAudioState(stopId, state);
      },
      resume: async () => {
        const active = await dependencies.sessions.loadActive();
        if (!active?.user_paused && (await dependencies.audio.getState()).loaded) {
          await dependencies.audio.play();
        }
      },
      canAutoResume: () => true,
    });
    playingKey = key;
    lastPositionPersisted = persisted.current_audio_position_ms;
    try {
      await dependencies.audio.load(localUri, {
        positionMs: persisted.current_audio_position_ms,
        onState: state => {
          if (state.did_finish) void serialized(() => finishStopInternal(manifest, stopId, operationGeneration));
          else void persistAudioState(stopId, state);
        },
        onUserPause: state => persistUserPause(stopId, state),
      });
      if (!await activeSessionStillMatches(saved, operationGeneration, stopId)) {
        await dependencies.audio.unload().catch(() => {});
        await releaseAudio();
        if (originalAudioCoordinator.activeOwner() == null) {
          await dependencies.audio.releaseSession().catch(() => {});
        }
        return false;
      }
      if (originalAudioCoordinator.activeOwner() === 'trailhead-originals') {
        await dependencies.audio.play();
      }
      return true;
    } catch (error) {
      await dependencies.audio.unload().catch(() => {});
      await releaseAudio();
      if (originalAudioCoordinator.activeOwner() == null) {
        await dependencies.audio.releaseSession().catch(() => {});
      }
      throw error;
    }
  };

  const finishStopInternal = async (
    manifest: OriginalManifestV1,
    stopId: string,
    operationGeneration = generation,
  ) => {
    if (generation !== operationGeneration) return;
    const active = await dependencies.sessions.loadActive();
    if (
      generation !== operationGeneration
      || !active
      || active.status !== 'active'
      || active.current_stop_id !== stopId
    ) return;
    await dependencies.audio.unload();
    await releaseAudio();
    if (!await activeSessionStillMatches(active, operationGeneration, stopId)) return;
    const manualReplay = finishManualOriginalStop(active, stopId);
    let next = manualReplay ?? completeOriginalStop(active, stopId, manifest.stops.map(stop => stop.id));
    const queued = next.queued_stop_id;
    if (queued) {
      next = { ...next, current_stop_id: queued, queued_stop_id: null, current_audio_position_ms: 0 };
    }
    const saved = await dependencies.sessions.setActiveIfCurrent(active.session_id, next);
    if (!saved || generation !== operationGeneration) return;
    if (next.status === 'completed' || (manualReplay && next.status !== 'active')) {
      await stopTracking().catch(() => {});
      if (originalAudioCoordinator.activeOwner() == null) {
        await dependencies.audio.releaseSession().catch(() => {});
      }
      return;
    }
    if (queued) await playStopInternal(manifest, saved, queued, 0, operationGeneration);
  };

  const processInternal = async (samples: OriginalLocationSample[], operationGeneration: number) => {
    // `true` means the native delivery was consumed. End-tour cancellation
    // deliberately discards its final fixes instead of retrying them later.
    if (cancellationWon(operationGeneration)) return true;
    const context = await exactContext();
    if (cancellationWon(operationGeneration)) return true;
    if (context.kind === 'inactive') {
      await stopTracking().catch(() => {});
      return true;
    }
    if (context.kind === 'unavailable') return false;
    let { session } = context;
    const { manifest } = context;
    const audioState = await dependencies.audio.getState();
    if (session.current_stop_id && !audioState.loaded) {
      const resumed = await playStopInternal(
        manifest,
        session,
        session.current_stop_id,
        session.current_audio_position_ms,
        operationGeneration,
      );
      if (resumed === false) return cancellationWon(operationGeneration);
      session = (await dependencies.sessions.loadActive()) ?? session;
    }
    for (const sample of samples) {
      if (session.status !== 'active' || session.user_paused) break;
      const evaluation = evaluateOriginalLocation(manifest, session, sample);
      session = evaluation.session;
      const saved = await dependencies.sessions.setActiveIfCurrent(context.session.session_id, session);
      if (!saved || generation !== operationGeneration) return cancellationWon(operationGeneration);
      session = saved;
      const trigger = evaluation.events.find(event => event.type === 'stop_triggered');
      if (trigger?.type === 'stop_triggered') {
        const played = await playStopInternal(manifest, session, trigger.stop_id, 0, operationGeneration);
        if (played === false) return cancellationWon(operationGeneration);
        session = (await dependencies.sessions.loadActive()) ?? session;
      }
      if (session.status === 'completed') {
        await stopTracking().catch(() => {});
        break;
      }
    }
    return true;
  };

  return {
    process(samples: OriginalLocationSample[], nextStopTracking: StopTracking) {
      if (stopping) return Promise.resolve(true);
      stopTracking = nextStopTracking;
      const operationGeneration = generation;
      return serialized(() => processInternal(samples, operationGeneration));
    },
    stop() {
      if (stopOperation) return stopOperation;
      stopping = true;
      generation += 1;
      const operation = (async () => {
        const cleanup = async () => {
          await stopTracking().catch(() => {});
          await dependencies.audio.stop().catch(() => {});
          await dependencies.audio.unload().catch(() => {});
          await releaseAudio();
          if (originalAudioCoordinator.activeOwner() == null) {
            await dependencies.audio.releaseSession().catch(() => {});
          }
        };
        try {
          await cleanup();
          await operationTail.catch(() => {});
          await cleanup();
        } finally {
          stopping = false;
        }
      })();
      stopOperation = operation;
      operation.finally(() => {
        if (stopOperation === operation) stopOperation = null;
      }).catch(() => {});
      return operation;
    },
    flush() {
      return operationTail.then(() => undefined);
    },
  };
}
