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

  const serialized = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = operationTail.then(operation, operation);
    operationTail = result.catch(() => undefined);
    return result;
  };

  const releaseAudio = async () => {
    const lease = audioLease;
    audioLease = null;
    playingKey = null;
    if (lease) await lease.release().catch(() => {});
  };

  const exactContext = async () => {
    const session = await dependencies.sessions.loadActive();
    if (!session || session.status !== 'active' || session.user_paused) return null;
    const access = await dependencies.access.get(session.owner_scope, session.pack_id, session.version);
    const allowed = access?.owner_scope === session.owner_scope && (
      session.owner_scope === 'guest'
        ? access.access_type === 'guest_free'
        : access.access_type === 'entitled'
    );
    if (!allowed) return null;
    const [bundle, manifest] = await Promise.all([
      dependencies.bundles.get(session.owner_scope, session.pack_id, session.version),
      // StartTour already performed the full hash/map verification. Reading the
      // immutable promoted manifest here keeps a cold cue within the spike's
      // three-second budget without re-hashing the whole pack every GPS fix.
      dependencies.bundles.loadManifest(session.owner_scope, session.pack_id, session.version, false),
    ]);
    if (!bundle || !manifest || manifest.manifest_id !== session.manifest_id) return null;
    return { session, manifest };
  };

  const persistAudioState = (stopId: string, state: OriginalAudioPlaybackState) => serialized(async () => {
    const active = await dependencies.sessions.loadActive();
    if (!active || active.current_stop_id !== stopId) return;
    if (Math.abs(state.position_ms - lastPositionPersisted) < 5_000) return;
    lastPositionPersisted = state.position_ms;
    await dependencies.sessions.setActive({
      ...active,
      current_audio_position_ms: Math.max(0, state.position_ms),
      updated_at_ms: Date.now(),
    });
  });

  const persistUserPause = (stopId: string, state: OriginalAudioPlaybackState) => serialized(async () => {
    const active = await dependencies.sessions.loadActive();
    if (!active || active.current_stop_id !== stopId || active.user_paused) return;
    await dependencies.sessions.setActive({
      ...active,
      status: 'paused',
      user_paused: true,
      current_audio_position_ms: Math.max(0, state.position_ms),
      updated_at_ms: Date.now(),
    });
    await releaseAudio();
    await stopTracking().catch(() => {});
  });

  const playStopInternal = async (
    manifest: OriginalManifestV1,
    session: OriginalSessionV1,
    stopId: string,
    positionMs = 0,
  ) => {
    const key = `${session.owner_scope}:${session.pack_id}:${session.version}:${stopId}`;
    const currentAudio = await dependencies.audio.getState();
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

    const persisted = {
      ...session,
      current_stop_id: stopId,
      current_audio_position_ms: Math.max(0, positionMs),
      updated_at_ms: Date.now(),
    };
    // This write is intentionally before load/play for duplicate prevention.
    await dependencies.sessions.setActive(persisted);
    await releaseAudio();
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
          if (state.did_finish) void serialized(() => finishStopInternal(manifest, stopId));
          else void persistAudioState(stopId, state);
        },
        onUserPause: state => persistUserPause(stopId, state),
      });
      if (originalAudioCoordinator.activeOwner() === 'trailhead-originals') {
        await dependencies.audio.play();
      }
    } catch (error) {
      await dependencies.audio.unload().catch(() => {});
      await releaseAudio();
      throw error;
    }
  };

  const finishStopInternal = async (manifest: OriginalManifestV1, stopId: string) => {
    const active = await dependencies.sessions.loadActive();
    if (!active || active.current_stop_id !== stopId) return;
    await dependencies.audio.unload();
    await releaseAudio();
    const manualReplay = finishManualOriginalStop(active, stopId);
    let next = manualReplay ?? completeOriginalStop(active, stopId, manifest.stops.map(stop => stop.id));
    const queued = next.queued_stop_id;
    if (queued) {
      next = { ...next, current_stop_id: queued, queued_stop_id: null, current_audio_position_ms: 0 };
    }
    await dependencies.sessions.setActive(next);
    if (next.status === 'completed' || (manualReplay && next.status !== 'active')) {
      await stopTracking().catch(() => {});
      return;
    }
    if (queued) await playStopInternal(manifest, next, queued);
  };

  const processInternal = async (samples: OriginalLocationSample[]) => {
    const context = await exactContext();
    if (!context) return false;
    let { session } = context;
    const { manifest } = context;
    const audioState = await dependencies.audio.getState();
    if (session.current_stop_id && !audioState.loaded) {
      await playStopInternal(
        manifest,
        session,
        session.current_stop_id,
        session.current_audio_position_ms,
      );
      session = (await dependencies.sessions.loadActive()) ?? session;
    }
    for (const sample of samples) {
      if (session.status !== 'active' || session.user_paused) break;
      const evaluation = evaluateOriginalLocation(manifest, session, sample);
      session = evaluation.session;
      await dependencies.sessions.setActive(session);
      const trigger = evaluation.events.find(event => event.type === 'stop_triggered');
      if (trigger?.type === 'stop_triggered') {
        await playStopInternal(manifest, session, trigger.stop_id);
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
      stopTracking = nextStopTracking;
      return serialized(() => processInternal(samples));
    },
    flush() {
      return operationTail.then(() => undefined);
    },
  };
}
