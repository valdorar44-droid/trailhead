import type { OriginalAccessStore } from './accessStore';
import { originalLocalAccessIsCurrent } from './accessPolicy';
import type { OriginalAudioAdapter, OriginalAudioPlaybackState } from './audioAdapter';
import { originalAudioCoordinator, type OriginalAudioFocusLease } from './audioCoordinator';
import type { OriginalBundleStore } from './bundleStore';
import { resolveOriginalManifestPlaybackForSession } from './manifestV2';
import {
  completeOriginalLongFormItem,
  originalLongFormHeadlessResumeAction,
  preemptOriginalLongFormForHardCue,
  resumeDeferredOriginalLongFormAfterHardCue,
  updateOriginalLongFormAudioPosition,
} from './longFormScheduler';
import {
  completeOriginalStop,
  finishManualOriginalStop,
  promoteNextOriginalStop,
} from './session';
import type { OriginalSessionStore } from './sessionStore';
import { evaluateOriginalLocation } from './triggerEngine';
import type {
  OriginalLocationSample,
  OriginalManifestV1,
  OriginalSelectablePlaybackPlanV1,
  OriginalSessionV1,
} from './types';

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
    const resumableExplicitOptional = Boolean(
      session?.long_form?.current_item_id
      && session.long_form.current_selection_origin === 'user_explicit'
      && (session.status === 'active' || session.status === 'ready' || session.status === 'completed')
    );
    if (
      !session
      || (session.status !== 'active' && !resumableExplicitOptional)
      || session.user_paused
    ) {
      return { kind: 'inactive' as const };
    }
    const access = await dependencies.access.get(session.owner_scope, session.pack_id, session.version);
    const allowed = access?.owner_scope === session.owner_scope
      && originalLocalAccessIsCurrent(access, undefined, { manifestId: session.manifest_id });
    if (!allowed) return { kind: 'inactive' as const };
    const [bundle, storedManifest] = await Promise.all([
      dependencies.bundles.get(session.owner_scope, session.pack_id, session.version),
      // StartTour already performed the full hash/map verification. Reading the
      // immutable promoted manifest here keeps a cold cue within the spike's
      // three-second budget without re-hashing the whole pack every GPS fix.
      dependencies.bundles.loadManifest(session.owner_scope, session.pack_id, session.version, false),
    ]);
    if (!bundle || !storedManifest || storedManifest.manifest_id !== session.manifest_id) {
      return { kind: 'unavailable' as const };
    }
    let playback: ReturnType<typeof resolveOriginalManifestPlaybackForSession>;
    try {
      playback = resolveOriginalManifestPlaybackForSession(storedManifest, session);
    } catch {
      return { kind: 'unavailable' as const };
    }
    return {
      kind: 'ready' as const,
      session,
      manifest: playback.manifest,
      selectable: playback.source_schema_version === 3 ? playback.selectable : null,
    };
  };

  const activeSessionStillMatches = async (
    expected: OriginalSessionV1,
    operationGeneration: number,
    identity?: { hard_stop_id?: string; optional_item_id?: string },
  ) => {
    if (generation !== operationGeneration) return false;
    const active = await dependencies.sessions.loadActive();
    const optionalIdentityMatches = Boolean(
      identity?.optional_item_id
      && active?.long_form?.current_item_id === identity.optional_item_id
      && active.long_form.current_selection_origin === 'user_explicit'
      && (active.status === 'active' || active.status === 'ready' || active.status === 'completed'),
    );
    return Boolean(
      generation === operationGeneration
      && active
      && active.session_id === expected.session_id
      && (active.status === 'active' || optionalIdentityMatches)
      && !active.user_paused
      && (identity?.hard_stop_id == null || active.current_stop_id === identity.hard_stop_id)
      && (
        identity?.optional_item_id == null || optionalIdentityMatches
      ),
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

  const persistOptionalAudioState = (
    plan: OriginalSelectablePlaybackPlanV1,
    itemId: string,
    state: OriginalAudioPlaybackState,
  ) => serialized(async () => {
    const active = await dependencies.sessions.loadActive();
    if (!active || active.long_form?.current_item_id !== itemId) return;
    if (Math.abs(state.position_ms - lastPositionPersisted) < 5_000) return;
    lastPositionPersisted = state.position_ms;
    await dependencies.sessions.setActiveIfCurrent(
      active.session_id,
      updateOriginalLongFormAudioPosition(active, plan, state.position_ms),
    );
  });

  const persistOptionalUserPause = (
    plan: OriginalSelectablePlaybackPlanV1,
    itemId: string,
    state: OriginalAudioPlaybackState,
  ) => serialized(async () => {
    const active = await dependencies.sessions.loadActive();
    if (!active || active.long_form?.current_item_id !== itemId || active.user_paused) return;
    const positioned = updateOriginalLongFormAudioPosition(active, plan, state.position_ms);
    await dependencies.sessions.setActiveIfCurrent(active.session_id, {
      ...positioned,
      status: 'paused',
      user_paused: true,
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
    plan: OriginalSelectablePlaybackPlanV1 | null,
    initialSession: OriginalSessionV1,
    stopId: string,
    positionMs = 0,
    operationGeneration = generation,
  ) => {
    let session = initialSession;
    if (generation !== operationGeneration) return false;
    const key = `hard:${session.owner_scope}:${session.pack_id}:${session.version}:${stopId}`;
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
    const artworkUri = stop.artwork_asset_id
      ? await dependencies.bundles.assetUri(
        session.owner_scope,
        session.pack_id,
        session.version,
        stop.artwork_asset_id,
      ).catch(() => null)
      : null;
    if (!await activeSessionStillMatches(session, operationGeneration)) return false;
    if (plan && session.long_form?.current_item_id) {
      const optionalAudio = await dependencies.audio.getState().catch(() => null);
      await dependencies.audio.stop().catch(() => {});
      await dependencies.audio.unload().catch(() => {});
      await releaseAudio();
      const preempted = preemptOriginalLongFormForHardCue(
        session,
        plan,
        optionalAudio?.loaded
          ? optionalAudio.position_ms
          : session.long_form.current_audio_position_ms,
      );
      const savedPreemption = await dependencies.sessions.setActiveIfCurrent(
        session.session_id,
        preempted,
      );
      if (!savedPreemption || generation !== operationGeneration) return false;
      session = savedPreemption;
    }

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
    if (!await activeSessionStillMatches(saved, operationGeneration, { hard_stop_id: stopId })) return false;
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
        metadata: {
          title: stop.title,
          artist: 'Trailhead Originals',
          albumTitle: manifest.title,
          ...(artworkUri ? { artworkUrl: artworkUri } : {}),
        },
        onState: state => {
          if (state.did_finish) {
            void serialized(() => finishStopInternal(manifest, plan, stopId, operationGeneration));
          }
          else void persistAudioState(stopId, state);
        },
        onUserPause: state => persistUserPause(stopId, state),
      });
      if (!await activeSessionStillMatches(saved, operationGeneration, { hard_stop_id: stopId })) {
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

  const playOptionalInternal = async (
    manifest: OriginalManifestV1,
    plan: OriginalSelectablePlaybackPlanV1,
    session: OriginalSessionV1,
    itemId: string,
    positionMs = 0,
    operationGeneration = generation,
  ) => {
    if (generation !== operationGeneration || session.current_stop_id) return false;
    const item = plan.items.find(value => value.id === itemId);
    if (!item || session.long_form?.current_item_id !== item.id) return false;
    const key = `optional:${session.owner_scope}:${session.pack_id}:${session.version}:${itemId}`;
    const currentAudio = await dependencies.audio.getState();
    if (generation !== operationGeneration) return false;
    if (playingKey === key && currentAudio.loaded) return true;
    const localUri = await dependencies.bundles.assetUri(
      session.owner_scope,
      session.pack_id,
      session.version,
      item.audio_asset_id,
    );
    if (!localUri) throw new Error('The selected story is not available offline.');
    const artworkUri = item.artwork_asset_id
      ? await dependencies.bundles.assetUri(
        session.owner_scope,
        session.pack_id,
        session.version,
        item.artwork_asset_id,
      ).catch(() => null)
      : null;
    if (!await activeSessionStillMatches(
      session,
      operationGeneration,
      { optional_item_id: itemId },
    )) return false;
    const positioned = updateOriginalLongFormAudioPosition(session, plan, positionMs);
    const saved = await dependencies.sessions.setActiveIfCurrent(session.session_id, positioned);
    if (!saved || generation !== operationGeneration) return false;
    await releaseAudio();
    if (!await activeSessionStillMatches(
      saved,
      operationGeneration,
      { optional_item_id: itemId },
    )) return false;
    audioLease = await originalAudioCoordinator.acquire({
      owner: 'trailhead-originals',
      priority: 'originals',
      pause: async () => {
        await dependencies.audio.pause();
        const state = await dependencies.audio.getState();
        await persistOptionalAudioState(plan, itemId, state);
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
    lastPositionPersisted = positioned.long_form?.current_audio_position_ms ?? 0;
    try {
      await dependencies.audio.load(localUri, {
        positionMs: positioned.long_form?.current_audio_position_ms ?? 0,
        metadata: {
          title: item.title,
          artist: 'Trailhead Originals',
          albumTitle: manifest.title,
          ...(artworkUri ? { artworkUrl: artworkUri } : {}),
        },
        onState: state => {
          if (state.did_finish) {
            void serialized(() => finishOptionalInternal(manifest, plan, itemId, operationGeneration));
          } else void persistOptionalAudioState(plan, itemId, state);
        },
        onUserPause: state => persistOptionalUserPause(plan, itemId, state),
      });
      if (!await activeSessionStillMatches(
        saved,
        operationGeneration,
        { optional_item_id: itemId },
      )) {
        await dependencies.audio.unload().catch(() => {});
        await releaseAudio();
        return false;
      }
      if (originalAudioCoordinator.activeOwner() === 'trailhead-originals') {
        await dependencies.audio.play();
      }
      return true;
    } catch (caught) {
      await dependencies.audio.unload().catch(() => {});
      await releaseAudio();
      if (originalAudioCoordinator.activeOwner() == null) {
        await dependencies.audio.releaseSession().catch(() => {});
      }
      throw caught;
    }
  };

  const finishOptionalInternal = async (
    manifest: OriginalManifestV1,
    plan: OriginalSelectablePlaybackPlanV1,
    itemId: string,
    operationGeneration = generation,
  ) => {
    if (generation !== operationGeneration) return;
    const active = await dependencies.sessions.loadActive();
    if (!active || active.long_form?.current_item_id !== itemId) return;
    await dependencies.audio.unload();
    await releaseAudio();
    if (!await activeSessionStillMatches(
      active,
      operationGeneration,
      { optional_item_id: itemId },
    )) return;
    const next = completeOriginalLongFormItem(active, plan, itemId);
    const saved = await dependencies.sessions.setActiveIfCurrent(active.session_id, next);
    if (!saved || generation !== operationGeneration) return;
    const nextGroupItemId = saved.long_form?.current_item_id;
    if (nextGroupItemId) {
      await playOptionalInternal(
        manifest,
        plan,
        saved,
        nextGroupItemId,
        0,
        operationGeneration,
      );
      return;
    }
    if (originalAudioCoordinator.activeOwner() == null) {
      await dependencies.audio.releaseSession().catch(() => {});
    }
  };

  const finishStopInternal = async (
    manifest: OriginalManifestV1,
    plan: OriginalSelectablePlaybackPlanV1 | null,
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
    if (!await activeSessionStillMatches(active, operationGeneration, { hard_stop_id: stopId })) return;
    const manualReplay = finishManualOriginalStop(active, stopId);
    let next = manualReplay ?? completeOriginalStop(active, stopId, manifest.stops.map(stop => stop.id));
    const promotion = promoteNextOriginalStop(next);
    next = promotion.session;
    const queued = promotion.promoted_stop_id;
    const deferred = !queued && plan
      ? resumeDeferredOriginalLongFormAfterHardCue(next, plan)
      : { session: next, action: null };
    next = deferred.session;
    const saved = await dependencies.sessions.setActiveIfCurrent(active.session_id, next);
    if (!saved || generation !== operationGeneration) return;
    if (deferred.action && plan) {
      await playOptionalInternal(
        manifest,
        plan,
        saved,
        deferred.action.item_id,
        deferred.action.position_ms,
        operationGeneration,
      );
      return;
    }
    if (next.status === 'completed' || (manualReplay && next.status !== 'active')) {
      await stopTracking().catch(() => {});
      if (originalAudioCoordinator.activeOwner() == null) {
        await dependencies.audio.releaseSession().catch(() => {});
      }
      return;
    }
    if (queued) await playStopInternal(manifest, plan, saved, queued, 0, operationGeneration);
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
    const { manifest, selectable } = context;
    const audioState = await dependencies.audio.getState();
    if (session.current_stop_id && !audioState.loaded) {
      const resumed = await playStopInternal(
        manifest,
        selectable,
        session,
        session.current_stop_id,
        session.current_audio_position_ms,
        operationGeneration,
      );
      if (resumed === false) return cancellationWon(operationGeneration);
      session = (await dependencies.sessions.loadActive()) ?? session;
    } else if (selectable && !audioState.loaded) {
      const resume = originalLongFormHeadlessResumeAction(session, selectable);
      if (resume) {
        const resumed = await playOptionalInternal(
          manifest,
          selectable,
          session,
          resume.item_id,
          resume.position_ms,
          operationGeneration,
        );
        if (resumed === false) return cancellationWon(operationGeneration);
        session = (await dependencies.sessions.loadActive()) ?? session;
      }
    }
    for (const sample of samples) {
      if (session.status !== 'active' || session.user_paused) break;
      const evaluation = evaluateOriginalLocation(manifest, session, sample);
      const trigger = evaluation.events.find(event => event.type === 'stop_triggered');
      // A cold task advances only guaranteed hard cues. Optional capacity,
      // parked, and completion choices must first be admitted or selected by
      // the foreground runtime; headless may only resume that explicit state.
      session = evaluation.session;
      const saved = await dependencies.sessions.setActiveIfCurrent(context.session.session_id, session);
      if (!saved || generation !== operationGeneration) return cancellationWon(operationGeneration);
      session = saved;
      if (trigger?.type === 'stop_triggered') {
        const played = await playStopInternal(
          manifest,
          selectable,
          session,
          trigger.stop_id,
          0,
          operationGeneration,
        );
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
