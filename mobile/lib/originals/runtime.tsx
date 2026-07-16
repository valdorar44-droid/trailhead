import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useStore } from '../store';
import { accountStorage, storage } from '../storage';
import { originalsApi } from './api';
import {
  type OriginalAccessStore,
} from './accessStore';
import {
  ORIGINALS_ANALYTICS_EVENTS,
  trackOriginalsAnalyticsEvent,
} from './analytics';
import {
  expoAudioOriginalAudioAdapter,
  type OriginalAudioAdapter,
  type OriginalAudioPlaybackState,
} from './audioAdapter';
import {
  originalAudioCoordinator,
  type OriginalAudioFocusLease,
} from './audioCoordinator';
import {
  type OriginalBundleDownloadOptions,
  type OriginalBundleProgress,
  type OriginalBundleRecord,
  type OriginalBundleStore,
} from './bundleStore';
import {
  expoOriginalLocationAdapter,
  type OriginalLocationAdapter,
} from './locationAdapter';
import { validateOriginalManifest } from './manifest';
import { originalOwnerScopeForAccount, originalRestoreScopeIsCurrent } from './ownership';
import {
  completeOriginalStop,
  createOriginalSession,
  finishManualOriginalStop,
  originalStopCanReplay,
  skipOriginalStop,
  startManualOriginalStop,
} from './session';
import {
  type OriginalSessionStore,
} from './sessionStore';
import {
  originalAccessStore,
  originalBundleStore,
  originalSessionStore,
} from './expoStores';
import { evaluateOriginalLocation } from './triggerEngine';
import type {
  OriginalLocationSample,
  OriginalAcquisition,
  OriginalManifestV1,
  OriginalOwnerScope,
  OriginalSessionV1,
} from './types';

export type OriginalsRuntimeState = 'idle' | 'ready' | 'tracking' | 'paused' | 'completed' | 'error';

export type OriginalsRuntimeValue = {
  state: OriginalsRuntimeState;
  session: OriginalSessionV1 | null;
  manifest: OriginalManifestV1 | null;
  bundle: OriginalBundleRecord | null;
  downloadProgress: OriginalBundleProgress | null;
  error: string | null;
  muted: boolean;
  audioCapabilities: OriginalAudioAdapter['capabilities'];
  downloadOriginal: (
    manifest: OriginalManifestV1,
    options?: Omit<OriginalBundleDownloadOptions, 'onProgress' | 'ownerScope'>,
  ) => Promise<OriginalBundleRecord>;
  startTour: (manifest: OriginalManifestV1) => Promise<OriginalSessionV1>;
  restartTour: (manifest: OriginalManifestV1) => Promise<OriginalSessionV1>;
  pauseTour: () => Promise<void>;
  resumeTour: () => Promise<void>;
  stopTour: () => Promise<void>;
  skipCurrentStory: () => Promise<void>;
  replayStory: (stopId: string) => Promise<void>;
  seekStory: (positionMs: number) => Promise<void>;
  setMuted: (muted: boolean) => Promise<void>;
  acquireOriginal: (id: string, version: number, idempotencyKey?: string) => Promise<OriginalAcquisition>;
  claimFeaturedOriginal: (idempotencyKey?: string) => Promise<OriginalAcquisition>;
  beginAudioInterruption: (kind: 'navigation' | 'hazard') => Promise<() => Promise<void>>;
  submitLocationSample: (sample: OriginalLocationSample) => Promise<void>;
  migrateGuestToAccount: (accountId: string | number) => Promise<OriginalSessionV1[]>;
};

type OriginalsRuntimeDependencies = {
  audio: OriginalAudioAdapter;
  location: OriginalLocationAdapter;
  bundles: OriginalBundleStore;
  sessions: OriginalSessionStore;
  access: OriginalAccessStore;
};

const defaultDependencies: OriginalsRuntimeDependencies = {
  audio: expoAudioOriginalAudioAdapter,
  location: expoOriginalLocationAdapter,
  bundles: originalBundleStore,
  sessions: originalSessionStore,
  access: originalAccessStore,
};

const OriginalsRuntimeContext = createContext<OriginalsRuntimeValue | null>(null);

function originalDownloadFailure(error: unknown) {
  if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('free storage') || message.includes('not enough storage')) return 'insufficient_storage';
  if (message.includes('checksum') || message.includes('wrong size') || message.includes('corrupt')) return 'corrupt';
  return 'failed';
}

export function OriginalsRuntimeProvider({
  children,
  dependencies = defaultDependencies,
}: {
  children: ReactNode;
  dependencies?: OriginalsRuntimeDependencies;
}) {
  const userId = useStore(state => state.user?.id ?? null);
  const [state, setState] = useState<OriginalsRuntimeState>('idle');
  const [session, setSession] = useState<OriginalSessionV1 | null>(null);
  const [manifest, setManifest] = useState<OriginalManifestV1 | null>(null);
  const [bundle, setBundle] = useState<OriginalBundleRecord | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<OriginalBundleProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMutedState] = useState(false);

  const sessionRef = useRef<OriginalSessionV1 | null>(null);
  const manifestRef = useRef<OriginalManifestV1 | null>(null);
  const bundleRef = useRef<OriginalBundleRecord | null>(null);
  const stopLocationRef = useRef<(() => Promise<void>) | null>(null);
  const audioLeaseRef = useRef<OriginalAudioFocusLease | null>(null);
  const finishingAudioRef = useRef(false);
  const sampleTailRef = useRef<Promise<unknown>>(Promise.resolve());
  const lastPositionPersistRef = useRef(0);
  const mountedRef = useRef(true);
  const priorUserIdRef = useRef<string | number | null>(null);
  const trackingGenerationRef = useRef(0);

  const requireCurrentAccess = useCallback(async (
    packId: string,
    version: number,
    expectedScope?: OriginalOwnerScope,
  ) => {
    const ownerScope = originalOwnerScopeForAccount(useStore.getState().user?.id ?? null);
    if (expectedScope && expectedScope !== ownerScope) {
      throw new Error('This downloaded Original belongs to a different account.');
    }
    const access = await dependencies.access.get(ownerScope, packId, version);
    const allowed = access?.owner_scope === ownerScope && (
      ownerScope === 'guest'
        ? access.access_type === 'guest_free'
        : access.access_type === 'entitled'
    );
    if (!allowed) {
      throw new Error(ownerScope === 'guest'
        ? 'Get this free Original on this device before downloading or starting it.'
        : 'Restore or acquire this exact Original version for the signed-in account.');
    }
    return ownerScope;
  }, [dependencies.access]);

  const publishSession = useCallback(async (next: OriginalSessionV1, active = true) => {
    sessionRef.current = next;
    if (mountedRef.current) setSession(next);
    if (active) await dependencies.sessions.setActive(next);
    else await dependencies.sessions.save(next);
    return next;
  }, [dependencies.sessions]);

  const stopLocation = useCallback(async () => {
    const stop = stopLocationRef.current;
    stopLocationRef.current = null;
    if (stop) await stop().catch(() => {});
  }, []);

  const releaseAudio = useCallback(async () => {
    const lease = audioLeaseRef.current;
    audioLeaseRef.current = null;
    if (lease) await lease.release().catch(() => {});
  }, []);

  const handleAudioFinishedRef = useRef<() => Promise<void>>(async () => {});
  const handleExternalUserPauseRef = useRef<(state: OriginalAudioPlaybackState) => Promise<void>>(async () => {});

  const handleAudioState = useCallback((audioState: OriginalAudioPlaybackState) => {
    const active = sessionRef.current;
    if (!active) return;
    if (audioState.loaded && Math.abs(audioState.position_ms - lastPositionPersistRef.current) >= 5_000) {
      lastPositionPersistRef.current = audioState.position_ms;
      const next = { ...active, current_audio_position_ms: audioState.position_ms, updated_at_ms: Date.now() };
      void publishSession(next).catch(() => {});
    }
    if (audioState.did_finish && !finishingAudioRef.current) {
      finishingAudioRef.current = true;
      void handleAudioFinishedRef.current()
        .catch(caught => {
          if (!mountedRef.current) return;
          setError(caught instanceof Error ? caught.message : 'Narration could not continue.');
          setState('error');
        })
        .finally(() => {
          finishingAudioRef.current = false;
        });
    }
  }, [publishSession]);

  const persistExactAudioPosition = useCallback(async () => {
    const active = sessionRef.current;
    if (!active?.current_stop_id) return active;
    const audioState = await dependencies.audio.getState();
    if (!audioState.loaded) return active;
    const positionMs = Math.max(0, audioState.position_ms);
    lastPositionPersistRef.current = positionMs;
    return publishSession({
      ...active,
      current_audio_position_ms: positionMs,
      updated_at_ms: Date.now(),
    });
  }, [dependencies.audio, publishSession]);

  const acquireOriginalAudioFocus = useCallback(async () => {
    await releaseAudio();
    audioLeaseRef.current = await originalAudioCoordinator.acquire({
      owner: 'trailhead-originals',
      priority: 'originals',
      pause: async () => {
        await dependencies.audio.pause();
        await persistExactAudioPosition();
      },
      resume: async () => {
        if (sessionRef.current?.user_paused) return;
        const status = await dependencies.audio.getState();
        if (status.loaded) await dependencies.audio.play();
      },
      canAutoResume: () => !sessionRef.current?.user_paused,
    });
  }, [dependencies.audio, persistExactAudioPosition, releaseAudio]);

  const playStop = useCallback(async (stopId: string, positionMs = 0) => {
    const activeManifest = manifestRef.current;
    const activeSession = sessionRef.current;
    if (!activeManifest || !activeSession) throw new Error('No Trailhead Original is active.');
    const stop = activeManifest.stops.find(item => item.id === stopId);
    if (!stop) throw new Error('This story is not part of the active Original.');
    const ownerScope = await requireCurrentAccess(
      activeManifest.pack_id,
      activeManifest.version,
      activeSession.owner_scope,
    );
    const localUri = await dependencies.bundles.assetUri(
      ownerScope,
      activeManifest.pack_id,
      activeManifest.version,
      stop.audio_asset_id,
    );
    if (!localUri) throw new Error('Download this Original before playing its stories.');

    // Persist the trigger/current cue before audio begins. A process restart can
    // resume it, and the trigger engine will never fire the same cue twice.
    const persisted = await publishSession({
      ...activeSession,
      current_stop_id: stopId,
      current_audio_position_ms: Math.max(0, positionMs),
      updated_at_ms: Date.now(),
    });
    lastPositionPersistRef.current = persisted.current_audio_position_ms;
    await acquireOriginalAudioFocus();
    try {
      await dependencies.audio.load(localUri, {
        positionMs: persisted.current_audio_position_ms,
        onState: handleAudioState,
        onUserPause: value => handleExternalUserPauseRef.current(value),
      });
      if (originalAudioCoordinator.activeOwner() === 'trailhead-originals') {
        await dependencies.audio.play();
      }
    } catch (error) {
      await dependencies.audio.unload().catch(() => {});
      await releaseAudio();
      throw error;
    }
  }, [acquireOriginalAudioFocus, dependencies.audio, dependencies.bundles, handleAudioState, publishSession, requireCurrentAccess]);

  const handleAudioFinished = useCallback(async () => {
    const activeManifest = manifestRef.current;
    const activeSession = sessionRef.current;
    const completedStopId = activeSession?.current_stop_id;
    if (!activeManifest || !activeSession || !completedStopId) return;
    await dependencies.audio.unload();
    await releaseAudio();
    const manualReplay = finishManualOriginalStop(activeSession, completedStopId);
    let next = manualReplay ?? completeOriginalStop(
      activeSession,
      completedStopId,
      activeManifest.stops.map(stop => stop.id),
    );
    const queued = next.queued_stop_id;
    if (queued) next = { ...next, current_stop_id: queued, queued_stop_id: null, current_audio_position_ms: 0 };
    await publishSession(next);
    if (!manualReplay) {
      trackOriginalsAnalyticsEvent(ORIGINALS_ANALYTICS_EVENTS.stopOutcome, {
        pack_id: activeSession.pack_id,
        version: activeSession.version,
        stop_id: completedStopId,
        outcome: 'completed',
      });
    }
    if (next.status === 'completed') {
      await stopLocation();
      if (mountedRef.current) setState('completed');
      return;
    }
    if (manualReplay && next.status !== 'active') {
      if (mountedRef.current) setState('paused');
      return;
    }
    if (queued) await playStop(queued);
  }, [dependencies.audio, playStop, publishSession, releaseAudio, stopLocation]);
  handleAudioFinishedRef.current = handleAudioFinished;

  const handleExternalUserPause = useCallback(async (audioState: OriginalAudioPlaybackState) => {
    const active = sessionRef.current;
    if (!active?.current_stop_id || active.user_paused) return;
    trackingGenerationRef.current += 1;
    await stopLocation();
    lastPositionPersistRef.current = audioState.position_ms;
    await publishSession({
      ...active,
      status: 'paused',
      user_paused: true,
      current_audio_position_ms: Math.max(0, audioState.position_ms),
      updated_at_ms: Date.now(),
    });
    await releaseAudio();
    if (mountedRef.current) setState('paused');
  }, [publishSession, releaseAudio, stopLocation]);
  handleExternalUserPauseRef.current = handleExternalUserPause;

  const submitLocationSample = useCallback((sample: OriginalLocationSample) => {
    const generation = trackingGenerationRef.current;
    const operation = async () => {
      if (generation !== trackingGenerationRef.current) return;
      const activeManifest = manifestRef.current;
      const activeSession = sessionRef.current;
      if (!activeManifest || !activeSession) return;
      const evaluation = evaluateOriginalLocation(activeManifest, activeSession, sample);
      if (generation !== trackingGenerationRef.current) return;
      await publishSession(evaluation.session);
      for (const event of evaluation.events) {
        if (event.type === 'stops_missed') {
          event.stop_ids.forEach(stopId => {
            trackOriginalsAnalyticsEvent(ORIGINALS_ANALYTICS_EVENTS.stopOutcome, {
              pack_id: evaluation.session.pack_id,
              version: evaluation.session.version,
              stop_id: stopId,
              outcome: 'missed',
            });
          });
        }
      }
      const trigger = evaluation.events.find(event => event.type === 'stop_triggered');
      if (trigger?.type === 'stop_triggered') {
        try {
          await playStop(trigger.stop_id);
        } catch (caught) {
          await stopLocation();
          const failed = sessionRef.current;
          if (failed) {
            await publishSession({
              ...failed,
              status: 'paused',
              user_paused: true,
              updated_at_ms: Date.now(),
            }).catch(() => {});
          }
          if (mountedRef.current) {
            setError(caught instanceof Error ? caught.message : 'Narration could not start.');
            setState('error');
          }
        }
      }
      if (evaluation.session.status === 'completed') {
        await stopLocation();
        if (mountedRef.current) setState('completed');
      }
    };
    const result = sampleTailRef.current.then(operation, operation);
    sampleTailRef.current = result.catch(() => undefined);
    return result;
  }, [playStop, publishSession, stopLocation]);

  const startLocation = useCallback(async () => {
    await stopLocation();
    const result = await dependencies.location.start(submitLocationSample);
    stopLocationRef.current = result.stop;
    const active = sessionRef.current;
    if (active) {
      await publishSession({ ...active, permission_state: result.permission, updated_at_ms: Date.now() });
    }
    if (result.permission === 'denied') throw new Error('Location permission is required to trigger stories.');
  }, [dependencies.location, publishSession, stopLocation, submitLocationSample]);

  const activateTour = useCallback(async (manifestInput: OriginalManifestV1, restart: boolean) => {
    let activatedSessionId: string | null = null;
    try {
      const cleanManifest = validateOriginalManifest(manifestInput);
      const ownerScope = await requireCurrentAccess(cleanManifest.pack_id, cleanManifest.version);
      const installed = await dependencies.bundles.get(ownerScope, cleanManifest.pack_id, cleanManifest.version);
      if (!installed || !await dependencies.bundles.verify(ownerScope, cleanManifest.pack_id, cleanManifest.version)) {
        throw new Error('Finish downloading and verifying this Original before starting.');
      }
      const existing = restart
        ? null
        : await dependencies.sessions.load(ownerScope, cleanManifest.pack_id, cleanManifest.version);
      const now = Date.now();
      const active = {
        ...(existing ?? createOriginalSession(cleanManifest, ownerScope, now)),
        status: 'active' as const,
        user_paused: false,
        download_state: 'ready' as const,
        started_at_ms: existing?.started_at_ms ?? now,
        completed_at_ms: restart ? null : existing?.completed_at_ms ?? null,
        updated_at_ms: now,
      };
      trackingGenerationRef.current += 1;
      manifestRef.current = cleanManifest;
      bundleRef.current = installed;
      if (mountedRef.current) {
        setManifest(cleanManifest);
        setBundle(installed);
        setError(null);
        setState('tracking');
      }
      activatedSessionId = active.session_id;
      await publishSession(active);
      await startLocation();
      if (active.current_stop_id) await playStop(active.current_stop_id, active.current_audio_position_ms);
      return sessionRef.current ?? active;
    } catch (caught) {
      if (activatedSessionId) await stopLocation();
      const active = sessionRef.current;
      if (active?.session_id === activatedSessionId && active.status === 'active') {
        await publishSession({
          ...active,
          status: 'paused',
          user_paused: true,
          updated_at_ms: Date.now(),
        }).catch(() => {});
      }
      const message = caught instanceof Error ? caught.message : 'Unable to start this Original.';
      if (mountedRef.current) {
        setError(message);
        setState('error');
      }
      throw caught;
    }
  }, [dependencies.bundles, dependencies.sessions, playStop, publishSession, requireCurrentAccess, startLocation]);

  const downloadOriginal = useCallback(async (
    manifestInput: OriginalManifestV1,
    options: Omit<OriginalBundleDownloadOptions, 'onProgress' | 'ownerScope'> = {},
  ) => {
    if (mountedRef.current) {
      setError(null);
      setDownloadProgress(null);
    }
    try {
      const ownerScope = await requireCurrentAccess(manifestInput.pack_id, manifestInput.version);
      const token = await storage.get('trailhead_token').catch(() => null);
      const installed = await dependencies.bundles.download(manifestInput, {
        ...options,
        ownerScope,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(options.headers ?? {}),
        },
        onProgress: value => mountedRef.current && setDownloadProgress(value),
      });
      bundleRef.current = installed;
      if (mountedRef.current) {
        setBundle(installed);
        setDownloadProgress(null);
        setState('ready');
      }
      trackOriginalsAnalyticsEvent(ORIGINALS_ANALYTICS_EVENTS.downloadResult, {
        pack_id: manifestInput.pack_id,
        version: manifestInput.version,
        result: 'ready',
      });
      return installed;
    } catch (caught) {
      trackOriginalsAnalyticsEvent(ORIGINALS_ANALYTICS_EVENTS.downloadResult, {
        pack_id: manifestInput.pack_id,
        version: manifestInput.version,
        result: originalDownloadFailure(caught),
      });
      const message = caught instanceof Error ? caught.message : 'Original download failed.';
      if (mountedRef.current) {
        setDownloadProgress(null);
        setError(message);
        setState('error');
      }
      throw caught;
    }
  }, [dependencies.bundles, requireCurrentAccess]);

  const pauseTour = useCallback(async () => {
    const active = sessionRef.current;
    if (!active) return;
    trackingGenerationRef.current += 1;
    await stopLocation();
    await dependencies.audio.pause();
    await persistExactAudioPosition();
    const persisted = sessionRef.current ?? active;
    await publishSession({
      ...persisted,
      status: 'paused',
      user_paused: true,
      updated_at_ms: Date.now(),
    });
    await releaseAudio();
    if (mountedRef.current) setState('paused');
  }, [dependencies.audio, persistExactAudioPosition, publishSession, releaseAudio, stopLocation]);

  const resumeTour = useCallback(async () => {
    const active = sessionRef.current;
    const activeManifest = manifestRef.current;
    if (!active || !activeManifest) throw new Error('No Trailhead Original is ready to resume.');
    const ownerScope = await requireCurrentAccess(active.pack_id, active.version, active.owner_scope);
    const verified = await dependencies.bundles.verify(ownerScope, active.pack_id, active.version);
    if (!verified) {
      await publishSession({ ...active, download_state: 'corrupt', status: 'paused', updated_at_ms: Date.now() });
      const message = 'This offline download is incomplete or corrupt. Download it again before resuming.';
      if (mountedRef.current) {
        setError(message);
        setState('error');
      }
      throw new Error(message);
    }
    trackingGenerationRef.current += 1;
    const next = await publishSession({
      ...active,
      status: 'active',
      user_paused: false,
      updated_at_ms: Date.now(),
    });
    if (mountedRef.current) setState('tracking');
    await startLocation();
    const audioState = await dependencies.audio.getState();
    if (next.current_stop_id) {
      if (audioState.loaded) {
        await acquireOriginalAudioFocus();
        if (originalAudioCoordinator.activeOwner() === 'trailhead-originals') {
          await dependencies.audio.play();
        }
      } else {
        await playStop(next.current_stop_id, next.current_audio_position_ms);
      }
    }
  }, [acquireOriginalAudioFocus, dependencies.audio, dependencies.bundles, playStop, publishSession, requireCurrentAccess, startLocation]);

  const stopTour = useCallback(async () => {
    const active = sessionRef.current;
    trackingGenerationRef.current += 1;
    await stopLocation();
    await dependencies.audio.stop();
    await dependencies.audio.unload();
    await releaseAudio();
    if (active) await publishSession({ ...active, status: 'stopped', updated_at_ms: Date.now() }, false);
    await dependencies.sessions.setActive(null);
    sessionRef.current = null;
    manifestRef.current = null;
    bundleRef.current = null;
    if (mountedRef.current) {
      setSession(null);
      setManifest(null);
      setBundle(null);
      setState('idle');
    }
  }, [dependencies.audio, dependencies.sessions, publishSession, releaseAudio, stopLocation]);

  const skipCurrentStory = useCallback(async () => {
    const active = sessionRef.current;
    const activeManifest = manifestRef.current;
    if (!active?.current_stop_id || !activeManifest) return;
    await dependencies.audio.stop();
    await dependencies.audio.unload();
    await releaseAudio();
    let next = skipOriginalStop(
      active,
      active.current_stop_id,
      activeManifest.stops.map(stop => stop.id),
    );
    const queued = next.queued_stop_id;
    if (queued) next = { ...next, current_stop_id: queued, queued_stop_id: null, current_audio_position_ms: 0 };
    await publishSession(next);
    trackOriginalsAnalyticsEvent(ORIGINALS_ANALYTICS_EVENTS.stopOutcome, {
      pack_id: active.pack_id,
      version: active.version,
      stop_id: active.current_stop_id,
      outcome: 'skipped',
    });
    if (queued) await playStop(queued);
    else if (next.status === 'completed') {
      await stopLocation();
      if (mountedRef.current) setState('completed');
    }
  }, [dependencies.audio, playStop, publishSession, releaseAudio, stopLocation]);

  const replayStory = useCallback(async (stopId: string) => {
    const active = sessionRef.current;
    const activeManifest = manifestRef.current;
    if (!active || !activeManifest?.stops.some(stop => stop.id === stopId)) return;
    if (!originalStopCanReplay(active, stopId)) {
      throw new Error('A story can be replayed only after it is completed, skipped, or missed.');
    }
    if (active.current_stop_id) {
      throw new Error('Pause or finish the current story before replaying another one.');
    }
    const ownerScope = await requireCurrentAccess(active.pack_id, active.version, active.owner_scope);
    if (!await dependencies.bundles.verify(ownerScope, active.pack_id, active.version)) {
      throw new Error('This offline download needs to be downloaded again before replaying stories.');
    }
    await dependencies.audio.stop();
    await dependencies.audio.unload();
    await releaseAudio();
    await publishSession(startManualOriginalStop(active, stopId));
    if (mountedRef.current) setState('tracking');
    trackOriginalsAnalyticsEvent(ORIGINALS_ANALYTICS_EVENTS.stopOutcome, {
      pack_id: active.pack_id,
      version: active.version,
      stop_id: stopId,
      outcome: 'replayed',
    });
    await playStop(stopId);
  }, [dependencies.audio, dependencies.bundles, playStop, publishSession, releaseAudio, requireCurrentAccess]);

  const seekStory = useCallback(async (positionMs: number) => {
    await dependencies.audio.seek(positionMs);
    const active = sessionRef.current;
    if (active) await publishSession({
      ...active,
      current_audio_position_ms: Math.max(0, positionMs),
      updated_at_ms: Date.now(),
    });
  }, [dependencies.audio, publishSession]);

  const setMuted = useCallback(async (nextMuted: boolean) => {
    await dependencies.audio.setVolume(nextMuted ? 0 : 1);
    if (mountedRef.current) setMutedState(nextMuted);
  }, [dependencies.audio]);

  const acquireOriginal = useCallback(async (id: string, version: number, idempotencyKey?: string) => {
    const requestEpoch = accountStorage.epoch();
    const requestUserId = userId;
    const acquisition: OriginalAcquisition = await originalsApi.acquire(id, { idempotencyKey, version });
    if (
      requestEpoch !== accountStorage.epoch()
      || String(useStore.getState().user?.id ?? '') !== String(requestUserId ?? '')
    ) return acquisition;
    if (acquisition.guest_access) {
      await dependencies.access.claimGuest(acquisition);
    } else if (userId != null) {
      await dependencies.access.recordEntitlement(acquisition, userId);
    }
    return acquisition;
  }, [dependencies.access, userId]);

  const claimFeaturedOriginal = useCallback(async (idempotencyKey = `original-featured:${new Date().toISOString().slice(0, 7)}`) => {
    const requestEpoch = accountStorage.epoch();
    const requestUserId = userId;
    const acquisition = await originalsApi.claimFeatured(idempotencyKey);
    if (
      requestEpoch === accountStorage.epoch()
      && requestUserId != null
      && String(useStore.getState().user?.id ?? '') === String(requestUserId)
      && !('guest_access' in acquisition && acquisition.guest_access)
    ) {
      await dependencies.access.recordEntitlement(acquisition, requestUserId);
    }
    return acquisition;
  }, [dependencies.access, userId]);

  const beginAudioInterruption = useCallback(async (kind: 'navigation' | 'hazard') => {
    const owner = `trailhead-originals-${kind}:${Date.now()}`;
    const lease = await originalAudioCoordinator.acquire({
      owner,
      priority: kind,
      pause: () => {},
      resume: () => {},
    });
    return () => lease.release();
  }, []);

  const migrateGuestToAccount = useCallback(async (accountId: string | number) => {
    const requestEpoch = accountStorage.epoch();
    const [guestSessions, guestAccess] = await Promise.all([
      dependencies.sessions.list('guest'),
      dependencies.access.list('guest'),
    ]);
    const guestPacks = new Map<string, { pack_id: string; version: number }>();
    [...guestSessions, ...guestAccess].forEach(guest => {
      guestPacks.set(`${guest.pack_id}@${guest.version}`, guest);
    });
    const acquired: Array<{ pack_id: string; version: number }> = [];
    for (const guest of guestPacks.values()) {
      if (
        requestEpoch !== accountStorage.epoch()
        || String(useStore.getState().user?.id ?? '') !== String(accountId)
      ) return [];
      const acquisition = await originalsApi.acquire(guest.pack_id, {
        idempotencyKey: `guest-original:${guest.pack_id}:${guest.version}:account:${accountId}`,
        version: guest.version,
      }).catch(() => null);
      if (acquisition && !acquisition.guest_access) {
        acquired.push(guest);
        await dependencies.access.recordEntitlement(acquisition, accountId).catch(() => null);
      }
    }
    if (
      requestEpoch !== accountStorage.epoch()
      || String(useStore.getState().user?.id ?? '') !== String(accountId)
    ) return [];
    // Only exact free versions that the server just accepted are allowed to
    // cross from the guest partition into this account partition.
    await dependencies.bundles.migrateGuestToAccount(accountId, acquired);
    const [migrated] = await Promise.all([
      dependencies.sessions.migrateGuestToAccount(accountId, acquired),
      dependencies.access.migrateGuestToAccount(accountId, acquired),
    ]);
    const active = sessionRef.current;
    if (active?.owner_scope === 'guest') {
      const replacement = migrated.find(value => (
        value.pack_id === active.pack_id && value.version === active.version
      ));
      if (replacement) {
        sessionRef.current = replacement;
        if (mountedRef.current) setSession(replacement);
      }
    }
    return migrated;
  }, [dependencies.access, dependencies.bundles, dependencies.sessions]);

  const restoreActiveForScope = useCallback(async (ownerScope: OriginalOwnerScope) => {
    const restoreEpoch = accountStorage.epoch();
    const scopeIsStillCurrent = () => originalRestoreScopeIsCurrent(
      ownerScope,
      restoreEpoch,
      accountStorage.epoch(),
      useStore.getState().user?.id ?? null,
    );
    const deviceActive = await dependencies.sessions.loadActive();
    const active = deviceActive?.owner_scope === ownerScope
      ? deviceActive
      : (await dependencies.sessions.list(ownerScope))
        .sort((a, b) => b.updated_at_ms - a.updated_at_ms)[0] ?? null;
    if (!active || !scopeIsStillCurrent()) return null;
    const access = await dependencies.access.get(ownerScope, active.pack_id, active.version);
    const accessAllowed = access?.owner_scope === ownerScope && (
      ownerScope === 'guest'
        ? access.access_type === 'guest_free'
        : access.access_type === 'entitled'
    );
    if (!accessAllowed || !scopeIsStillCurrent()) return null;
    const [restoredManifest, restoredBundle, verified] = await Promise.all([
      dependencies.bundles.loadManifest(ownerScope, active.pack_id, active.version, false),
      dependencies.bundles.get(ownerScope, active.pack_id, active.version),
      dependencies.bundles.verify(ownerScope, active.pack_id, active.version),
    ]);
    if (!restoredManifest || !restoredBundle || !mountedRef.current || !scopeIsStillCurrent()) return null;
    if (!verified) {
      const corrupt = {
        ...active,
        status: 'paused' as const,
        download_state: 'corrupt' as const,
        updated_at_ms: Date.now(),
      };
      if (!scopeIsStillCurrent()) return null;
      sessionRef.current = corrupt;
      manifestRef.current = restoredManifest;
      bundleRef.current = restoredBundle;
      setSession(corrupt);
      setManifest(restoredManifest);
      setBundle(restoredBundle);
      setError('This offline download is incomplete or corrupt. Download it again before resuming.');
      setState('error');
      await dependencies.sessions.save(corrupt);
      return corrupt;
    }
    let resumable = { ...active, download_state: 'ready' as const };
    if (active.status === 'active') {
      // A cold TaskManager runtime may still own native location/audio when the
      // foreground app is opened. Quiesce both adapters and persist the exact
      // position before presenting the durable Resume state.
      await dependencies.location.stopActive().catch(() => {});
      const audioState = await dependencies.audio.getState().catch(() => null);
      await dependencies.audio.pause().catch(() => {});
      await dependencies.audio.unload().catch(() => {});
      await originalAudioCoordinator.release('trailhead-originals').catch(() => {});
      resumable = {
        ...resumable,
        status: 'paused',
        user_paused: false,
        current_audio_position_ms: audioState?.loaded
          ? Math.max(0, audioState.position_ms)
          : active.current_audio_position_ms,
        updated_at_ms: Date.now(),
      };
    }
    if (!scopeIsStillCurrent()) return null;
    sessionRef.current = resumable;
    manifestRef.current = restoredManifest;
    bundleRef.current = restoredBundle;
    setSession(resumable);
    setManifest(restoredManifest);
    setBundle(restoredBundle);
    setState(resumable.status === 'completed' ? 'completed' : 'ready');
    if (resumable !== active) await dependencies.sessions.setActive(resumable);
    return resumable;
  }, [dependencies.access, dependencies.audio, dependencies.bundles, dependencies.location, dependencies.sessions]);

  useEffect(() => {
    mountedRef.current = true;
    void restoreActiveForScope(originalOwnerScopeForAccount(userId)).catch(() => {});
    return () => {
      mountedRef.current = false;
      void stopLocation();
      void dependencies.audio.unload();
      void releaseAudio();
    };
  }, []);

  useEffect(() => {
    const prior = priorUserIdRef.current;
    priorUserIdRef.current = userId;
    if (userId != null && String(prior ?? '') !== String(userId)) {
      void (async () => {
        if (prior != null) {
          const priorScope = originalOwnerScopeForAccount(prior);
          if (sessionRef.current?.owner_scope === priorScope) await stopTour().catch(() => {});
        } else if (sessionRef.current?.owner_scope === 'guest') {
          // Stop device-local playback before converting its exact free claim;
          // no guest session may keep running under an authenticated identity.
          await stopTour().catch(() => {});
        }
        await migrateGuestToAccount(userId).catch(() => []);
        await restoreActiveForScope(originalOwnerScopeForAccount(userId)).catch(() => null);
      })();
    } else if (prior != null && userId == null) {
      void (async () => {
        const priorScope = originalOwnerScopeForAccount(prior);
        if (sessionRef.current?.owner_scope === priorScope) await stopTour().catch(() => {});
        await restoreActiveForScope('guest').catch(() => null);
      })();
    }
  }, [migrateGuestToAccount, restoreActiveForScope, stopTour, userId]);

  const value = useMemo<OriginalsRuntimeValue>(() => ({
    state,
    session,
    manifest,
    bundle,
    downloadProgress,
    error,
    muted,
    audioCapabilities: dependencies.audio.capabilities,
    downloadOriginal,
    startTour: value => activateTour(value, false),
    restartTour: value => activateTour(value, true),
    pauseTour,
    resumeTour,
    stopTour,
    skipCurrentStory,
    replayStory,
    seekStory,
    setMuted,
    acquireOriginal,
    claimFeaturedOriginal,
    beginAudioInterruption,
    submitLocationSample,
    migrateGuestToAccount,
  }), [
    activateTour,
    acquireOriginal,
    claimFeaturedOriginal,
    beginAudioInterruption,
    bundle,
    dependencies.audio.capabilities,
    downloadOriginal,
    downloadProgress,
    error,
    manifest,
    migrateGuestToAccount,
    muted,
    pauseTour,
    replayStory,
    resumeTour,
    seekStory,
    setMuted,
    session,
    skipCurrentStory,
    state,
    stopTour,
    submitLocationSample,
  ]);

  return <OriginalsRuntimeContext.Provider value={value}>{children}</OriginalsRuntimeContext.Provider>;
}

export function useOriginalsRuntime() {
  const value = useContext(OriginalsRuntimeContext);
  if (!value) throw new Error('useOriginalsRuntime must be used inside OriginalsRuntimeProvider.');
  return value;
}
