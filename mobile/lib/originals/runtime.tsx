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
import { accountStorage } from '../storage';
import {
  buildCarAccountState,
  clearCarOriginalDrive,
  setCarOriginalDrive,
} from '../carIntegration';
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
import { getOriginalPreviewToken } from './previewAccess';
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
import { evaluateOriginalLocation, remainingOriginalTriggerStops } from './triggerEngine';
import type {
  OriginalLocationSample,
  OriginalAcquisition,
  OriginalAuthenticatedAcquisition,
  OriginalManifestV1,
  OriginalOwnerScope,
  OriginalSessionV1,
  OriginalTriggerEvaluation,
} from './types';

export type OriginalsRuntimeState = 'idle' | 'ready' | 'tracking' | 'paused' | 'completed' | 'error';

function currentCarTripContext() {
  const current = useStore.getState();
  return {
    trip: current.activeTrip,
    account: buildCarAccountState(current.user, Boolean(current.token)),
    mapboxAccessToken: current.mapboxToken,
  };
}

function syncOriginalDriveToCar(manifest: OriginalManifestV1) {
  return setCarOriginalDrive({
    packId: manifest.pack_id,
    version: manifest.version,
    manifestId: manifest.manifest_id,
    title: manifest.title,
    summary: `${manifest.stops.length} stories · audio plays on your phone`,
    coords: manifest.route.geometry.coordinates,
    totalDistanceM: manifest.route.distance_m,
    totalDurationS: manifest.route.duration_s,
    offlineReady: true,
    offlineMessage: 'Original route and stories are saved on this phone.',
  }, currentCarTripContext());
}

function clearOriginalDriveFromCar() {
  return clearCarOriginalDrive(currentCarTripContext());
}

export type OriginalsRuntimeValue = {
  state: OriginalsRuntimeState;
  session: OriginalSessionV1 | null;
  manifest: OriginalManifestV1 | null;
  bundle: OriginalBundleRecord | null;
  downloadProgress: OriginalBundleProgress | null;
  error: string | null;
  muted: boolean;
  simulation: boolean;
  lastTriggerEvaluation: OriginalTriggerEvaluation | null;
  audioPlaybackState: OriginalAudioPlaybackState | null;
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
  migrateGuestToAccount: (accountId: string | number) => Promise<OriginalSessionV1[]>;
};

/** Privileged synthetic controls intentionally excluded from the public runtime API. */
export type OriginalsAdminRuntimeValue = {
  startSimulation: (manifest: OriginalManifestV1) => Promise<OriginalSessionV1>;
  skipSimulationCue: () => Promise<void>;
  clearSimulationDiagnostic: () => void;
  submitLocationSample: (sample: OriginalLocationSample) => Promise<void>;
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
const OriginalsAdminRuntimeContext = createContext<OriginalsAdminRuntimeValue | null>(null);

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
  const [simulation, setSimulation] = useState(false);
  const [lastTriggerEvaluation, setLastTriggerEvaluation] = useState<OriginalTriggerEvaluation | null>(null);
  const [audioPlaybackState, setAudioPlaybackState] = useState<OriginalAudioPlaybackState | null>(null);

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
  const simulationRef = useRef(false);
  const lastTriggerEvaluationRef = useRef<OriginalTriggerEvaluation | null>(null);
  const stoppingRef = useRef(false);
  const stopTourPromiseRef = useRef<Promise<void> | null>(null);

  const requireCurrentAccess = useCallback(async (
    packId: string,
    version: number,
    expectedScope?: OriginalOwnerScope,
    allowAdminPreview = false,
  ) => {
    const requestEpoch = accountStorage.epoch();
    const requestUserId = useStore.getState().user?.id ?? null;
    const ownerScope = originalOwnerScopeForAccount(requestUserId);
    const scopeIsStillCurrent = () => originalRestoreScopeIsCurrent(
      ownerScope,
      requestEpoch,
      accountStorage.epoch(),
      useStore.getState().user?.id ?? null,
    );
    if (expectedScope && expectedScope !== ownerScope) {
      throw new Error('This downloaded Original belongs to a different account.');
    }
    const access = await dependencies.access.get(ownerScope, packId, version);
    if (!scopeIsStillCurrent()) throw new Error('The signed-in account changed. Try again.');
    const currentUser = useStore.getState().user;
    const allowed = access?.owner_scope === ownerScope && (
      ownerScope === 'guest'
        ? access.access_type === 'guest_free'
        : access.access_type === 'entitled'
          || (
            access.access_type === 'admin_preview'
            && Boolean(currentUser?.is_admin)
            && allowAdminPreview
          )
    );
    if (!allowed) {
      throw new Error(ownerScope === 'guest'
        ? 'Get this free Original on this device before downloading or starting it.'
        : 'Restore or acquire this exact Original version for the signed-in account.');
    }
    if (!scopeIsStillCurrent()) throw new Error('The signed-in account changed. Try again.');
    return ownerScope;
  }, [dependencies.access]);

  const publishSession = useCallback(async (next: OriginalSessionV1, active = true) => {
    sessionRef.current = next;
    if (mountedRef.current) setSession(next);
    // Trigger Lab sessions are deliberately ephemeral. They exercise the real
    // trigger and audio paths without replacing a tester's saved drive state.
    if (!simulationRef.current) {
      if (active) await dependencies.sessions.setActive(next);
      else await dependencies.sessions.save(next);
    }
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
    if (mountedRef.current) setAudioPlaybackState(audioState);
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
    const generation = trackingGenerationRef.current;
    const operationIsCurrent = () => (
      !stoppingRef.current
      && generation === trackingGenerationRef.current
      && sessionRef.current?.session_id === activeSession.session_id
      && manifestRef.current?.manifest_id === activeManifest.manifest_id
    );
    if (!operationIsCurrent()) return;
    const stop = activeManifest.stops.find(item => item.id === stopId);
    if (!stop) throw new Error('This story is not part of the active Original.');
    const ownerScope = await requireCurrentAccess(
      activeManifest.pack_id,
      activeManifest.version,
      activeSession.owner_scope,
      simulationRef.current,
    );
    if (!operationIsCurrent()) return;
    const localUri = await dependencies.bundles.assetUri(
      ownerScope,
      activeManifest.pack_id,
      activeManifest.version,
      stop.audio_asset_id,
    );
    if (!operationIsCurrent()) return;
    if (!localUri) throw new Error('Download this Original before playing its stories.');

    // Persist the trigger/current cue before audio begins. A process restart can
    // resume it, and the trigger engine will never fire the same cue twice.
    const persisted = await publishSession({
      ...activeSession,
      current_stop_id: stopId,
      current_audio_position_ms: Math.max(0, positionMs),
      updated_at_ms: Date.now(),
    });
    if (!operationIsCurrent()) return;
    lastPositionPersistRef.current = persisted.current_audio_position_ms;
    await acquireOriginalAudioFocus();
    if (!operationIsCurrent()) {
      await releaseAudio();
      return;
    }
    try {
      await dependencies.audio.load(localUri, {
        positionMs: persisted.current_audio_position_ms,
        onState: handleAudioState,
        onUserPause: value => handleExternalUserPauseRef.current(value),
      });
      if (!operationIsCurrent()) {
        await dependencies.audio.unload().catch(() => {});
        await releaseAudio();
        return;
      }
      if (originalAudioCoordinator.activeOwner() === 'trailhead-originals') {
        await dependencies.audio.play();
      }
    } catch (error) {
      await dependencies.audio.unload().catch(() => {});
      await releaseAudio();
      throw error;
    }
  }, [acquireOriginalAudioFocus, dependencies.audio, dependencies.bundles, handleAudioState, publishSession, releaseAudio, requireCurrentAccess]);

  const handleAudioFinished = useCallback(async () => {
    const activeManifest = manifestRef.current;
    const activeSession = sessionRef.current;
    const completedStopId = activeSession?.current_stop_id;
    if (!activeManifest || !activeSession || !completedStopId) return;
    const generation = trackingGenerationRef.current;
    await dependencies.audio.unload();
    await releaseAudio();
    if (
      stoppingRef.current
      || generation !== trackingGenerationRef.current
      || sessionRef.current?.session_id !== activeSession.session_id
    ) return;
    const manualReplay = finishManualOriginalStop(activeSession, completedStopId);
    let next = manualReplay ?? completeOriginalStop(
      activeSession,
      completedStopId,
      activeManifest.stops.map(stop => stop.id),
    );
    const queued = next.queued_stop_id;
    if (queued) next = { ...next, current_stop_id: queued, queued_stop_id: null, current_audio_position_ms: 0 };
    await publishSession(next);
    if (
      stoppingRef.current
      || generation !== trackingGenerationRef.current
      || sessionRef.current?.session_id !== activeSession.session_id
    ) return;
    if (!manualReplay && !simulationRef.current) {
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
    const generation = trackingGenerationRef.current;
    await stopLocation();
    if (
      stoppingRef.current
      || generation !== trackingGenerationRef.current
      || sessionRef.current?.session_id !== active.session_id
    ) return;
    lastPositionPersistRef.current = audioState.position_ms;
    await publishSession({
      ...active,
      status: 'paused',
      user_paused: true,
      current_audio_position_ms: Math.max(0, audioState.position_ms),
      updated_at_ms: Date.now(),
    });
    if (
      stoppingRef.current
      || generation !== trackingGenerationRef.current
      || sessionRef.current?.session_id !== active.session_id
    ) return;
    await releaseAudio();
    if (mountedRef.current) setState('paused');
  }, [publishSession, releaseAudio, stopLocation]);
  handleExternalUserPauseRef.current = handleExternalUserPause;

  const submitLocationSample = useCallback((sample: OriginalLocationSample) => {
    if (stoppingRef.current) return Promise.resolve();
    const generation = trackingGenerationRef.current;
    const operation = async () => {
      if (stoppingRef.current || generation !== trackingGenerationRef.current) return;
      const activeManifest = manifestRef.current;
      const activeSession = sessionRef.current;
      if (!activeManifest || !activeSession) return;
      const evaluation = evaluateOriginalLocation(activeManifest, activeSession, sample);
      if (stoppingRef.current || generation !== trackingGenerationRef.current) return;
      lastTriggerEvaluationRef.current = evaluation;
      if (mountedRef.current) setLastTriggerEvaluation(evaluation);
      await publishSession(evaluation.session);
      if (stoppingRef.current || generation !== trackingGenerationRef.current) return;
      for (const event of evaluation.events) {
        if (event.type === 'stops_missed') {
          event.stop_ids.forEach(stopId => {
            if (simulationRef.current) return;
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
          if (stoppingRef.current || generation !== trackingGenerationRef.current) return;
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

  const startLocation = useCallback(async (operationIsCurrent?: () => boolean) => {
    await stopLocation();
    if (operationIsCurrent && !operationIsCurrent()) throw new Error('Original start was cancelled.');
    const result = await dependencies.location.start(submitLocationSample);
    if (operationIsCurrent && !operationIsCurrent()) {
      await result.stop().catch(() => {});
      throw new Error('Original start was cancelled.');
    }
    stopLocationRef.current = result.stop;
    const active = sessionRef.current;
    if (active) {
      await publishSession({ ...active, permission_state: result.permission, updated_at_ms: Date.now() });
    }
    if (operationIsCurrent && !operationIsCurrent()) {
      await result.stop().catch(() => {});
      if (stopLocationRef.current === result.stop) stopLocationRef.current = null;
      throw new Error('Original start was cancelled.');
    }
    if (result.permission === 'denied') throw new Error('Location permission is required to trigger stories.');
  }, [dependencies.location, publishSession, stopLocation, submitLocationSample]);

  const activateTour = useCallback(async (
    manifestInput: OriginalManifestV1,
    restart: boolean,
    simulate = false,
  ) => {
    let activatedSessionId: string | null = null;
    const requestEpoch = accountStorage.epoch();
    const requestScope = originalOwnerScopeForAccount(useStore.getState().user?.id ?? null);
    const activationGeneration = trackingGenerationRef.current + 1;
    trackingGenerationRef.current = activationGeneration;
    const scopeIsStillCurrent = () => originalRestoreScopeIsCurrent(
      requestScope,
      requestEpoch,
      accountStorage.epoch(),
      useStore.getState().user?.id ?? null,
    );
    const activationIsCurrent = () => (
      scopeIsStillCurrent()
      && !stoppingRef.current
      && trackingGenerationRef.current === activationGeneration
    );
    const requireActiveActivation = () => {
      if (!activationIsCurrent()) throw new Error('Original start was cancelled.');
    };
    try {
      requireActiveActivation();
      if (simulate && !useStore.getState().user?.is_admin) {
        throw new Error('The Virtual Drive Lab is available only to Trailhead admins.');
      }
      if (
        simulate
        && !simulationRef.current
        && sessionRef.current?.status === 'active'
      ) {
        throw new Error('Pause or end the active drive before opening the trigger test.');
      }
      const cleanManifest = validateOriginalManifest(manifestInput);
      const ownerScope = await requireCurrentAccess(
        cleanManifest.pack_id,
        cleanManifest.version,
        requestScope,
        simulate,
      );
      requireActiveActivation();
      const installed = await dependencies.bundles.get(ownerScope, cleanManifest.pack_id, cleanManifest.version);
      requireActiveActivation();
      const verified = installed
        ? await dependencies.bundles.verify(ownerScope, cleanManifest.pack_id, cleanManifest.version)
        : false;
      requireActiveActivation();
      if (!installed || !verified) {
        throw new Error('Finish downloading and verifying this Original before starting.');
      }
      const existing = restart || simulate
        ? null
        : await dependencies.sessions.load(ownerScope, cleanManifest.pack_id, cleanManifest.version);
      requireActiveActivation();
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
      await stopLocation();
      requireActiveActivation();
      await dependencies.audio.stop().catch(() => {});
      requireActiveActivation();
      await dependencies.audio.unload().catch(() => {});
      requireActiveActivation();
      await releaseAudio();
      requireActiveActivation();
      simulationRef.current = simulate;
      lastTriggerEvaluationRef.current = null;
      manifestRef.current = cleanManifest;
      bundleRef.current = installed;
      if (mountedRef.current) {
        setManifest(cleanManifest);
        setBundle(installed);
        setError(null);
        setSimulation(simulate);
        setLastTriggerEvaluation(null);
        setAudioPlaybackState(null);
        setState('tracking');
      }
      activatedSessionId = active.session_id;
      requireActiveActivation();
      await publishSession(active);
      requireActiveActivation();
      if (!simulate) await startLocation(activationIsCurrent);
      requireActiveActivation();
      if (!simulate) await syncOriginalDriveToCar(cleanManifest).catch(() => {});
      requireActiveActivation();
      if (active.current_stop_id) {
        await playStop(active.current_stop_id, active.current_audio_position_ms);
        requireActiveActivation();
      }
      return sessionRef.current ?? active;
    } catch (caught) {
      if (activatedSessionId) await stopLocation();
      if (activatedSessionId && !simulate) await clearOriginalDriveFromCar().catch(() => {});
      if (!scopeIsStillCurrent() || trackingGenerationRef.current !== activationGeneration || stoppingRef.current) {
        throw new Error(scopeIsStillCurrent()
          ? 'Original start was cancelled.'
          : 'The signed-in account changed. Try again.');
      }
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
      if (activatedSessionId && simulate) {
        simulationRef.current = false;
        if (mountedRef.current) setSimulation(false);
      }
      throw caught;
    }
  }, [dependencies.audio, dependencies.bundles, dependencies.sessions, playStop, publishSession, releaseAudio, requireCurrentAccess, startLocation, stopLocation]);

  const downloadOriginal = useCallback(async (
    manifestInput: OriginalManifestV1,
    options: Omit<OriginalBundleDownloadOptions, 'onProgress' | 'ownerScope'> = {},
  ) => {
    let reportDownloadAnalytics = true;
    if (mountedRef.current) {
      setError(null);
      setDownloadProgress(null);
    }
    try {
      const requestEpoch = accountStorage.epoch();
      const requestUserId = useStore.getState().user?.id ?? null;
      const requestScope = originalOwnerScopeForAccount(requestUserId);
      const requestToken = requestUserId == null ? null : useStore.getState().token ?? null;
      if (requestUserId != null && !requestToken) throw new Error('Sign in to download this Original.');
      const scopeIsStillCurrent = () => originalRestoreScopeIsCurrent(
        requestScope,
        requestEpoch,
        accountStorage.epoch(),
        useStore.getState().user?.id ?? null,
      );
      const ownerScope = await requireCurrentAccess(
        manifestInput.pack_id,
        manifestInput.version,
        requestScope,
        true,
      );
      if (!scopeIsStillCurrent()) throw new Error('The signed-in account changed. Try again.');
      const access = await dependencies.access.get(ownerScope, manifestInput.pack_id, manifestInput.version);
      if (!scopeIsStillCurrent()) throw new Error('The signed-in account changed. Try again.');
      reportDownloadAnalytics = access?.access_type !== 'admin_preview';
      const previewToken = await getOriginalPreviewToken().catch(() => null);
      if (!scopeIsStillCurrent()) throw new Error('The signed-in account changed. Try again.');
      const controller = new AbortController();
      const abortForScopeChange = () => {
        if (!scopeIsStillCurrent()) controller.abort();
      };
      const abortForCaller = () => controller.abort();
      if (options.signal?.aborted) controller.abort();
      else options.signal?.addEventListener('abort', abortForCaller, { once: true });
      const unsubscribe = accountStorage.subscribe(abortForScopeChange);
      let installed: OriginalBundleRecord;
      try {
        installed = await dependencies.bundles.download(manifestInput, {
          ...options,
          ownerScope,
          headers: {
            ...(options.headers ?? {}),
            ...(requestToken ? { Authorization: `Bearer ${requestToken}` } : {}),
            ...(previewToken ? { 'X-Trailhead-Originals-Preview': previewToken } : {}),
          },
          signal: controller.signal,
          onProgress: value => {
            if (scopeIsStillCurrent() && mountedRef.current) setDownloadProgress(value);
          },
        });
      } finally {
        unsubscribe();
        options.signal?.removeEventListener('abort', abortForCaller);
      }
      if (!scopeIsStillCurrent()) throw new Error('The signed-in account changed. Try again.');
      bundleRef.current = installed;
      if (mountedRef.current) {
        setBundle(installed);
        setDownloadProgress(null);
        setState('ready');
      }
      if (reportDownloadAnalytics) {
        trackOriginalsAnalyticsEvent(ORIGINALS_ANALYTICS_EVENTS.downloadResult, {
          pack_id: manifestInput.pack_id,
          version: manifestInput.version,
          result: 'ready',
        });
      }
      return installed;
    } catch (caught) {
      if (reportDownloadAnalytics) {
        trackOriginalsAnalyticsEvent(ORIGINALS_ANALYTICS_EVENTS.downloadResult, {
          pack_id: manifestInput.pack_id,
          version: manifestInput.version,
          result: originalDownloadFailure(caught),
        });
      }
      const message = caught instanceof Error ? caught.message : 'Original download failed.';
      if (mountedRef.current) {
        setDownloadProgress(null);
        setError(message);
        setState('error');
      }
      throw caught;
    }
  }, [dependencies.access, dependencies.bundles, requireCurrentAccess]);

  const pauseTour = useCallback(async () => {
    const active = sessionRef.current;
    if (!active || stoppingRef.current) return;
    trackingGenerationRef.current += 1;
    const generation = trackingGenerationRef.current;
    await stopLocation();
    await dependencies.audio.pause();
    await persistExactAudioPosition();
    if (
      stoppingRef.current
      || generation !== trackingGenerationRef.current
      || sessionRef.current?.session_id !== active.session_id
    ) return;
    const persisted = sessionRef.current ?? active;
    await publishSession({
      ...persisted,
      status: 'paused',
      user_paused: true,
      updated_at_ms: Date.now(),
    });
    if (
      stoppingRef.current
      || generation !== trackingGenerationRef.current
      || sessionRef.current?.session_id !== active.session_id
    ) return;
    await releaseAudio();
    if (mountedRef.current) setState('paused');
  }, [dependencies.audio, persistExactAudioPosition, publishSession, releaseAudio, stopLocation]);

  const resumeTour = useCallback(async () => {
    const active = sessionRef.current;
    const activeManifest = manifestRef.current;
    if (!active || !activeManifest) throw new Error('No Trailhead Original is ready to resume.');
    if (stoppingRef.current) return;
    trackingGenerationRef.current += 1;
    const generation = trackingGenerationRef.current;
    const simulating = simulationRef.current;
    const operationIsCurrent = () => (
      !stoppingRef.current
      && generation === trackingGenerationRef.current
      && sessionRef.current?.session_id === active.session_id
      && manifestRef.current?.manifest_id === activeManifest.manifest_id
      && simulationRef.current === simulating
    );
    const ownerScope = await requireCurrentAccess(
      active.pack_id,
      active.version,
      active.owner_scope,
      simulating,
    );
    if (!operationIsCurrent()) return;
    const verified = await dependencies.bundles.verify(ownerScope, active.pack_id, active.version);
    if (!operationIsCurrent()) return;
    if (!verified) {
      await publishSession({ ...active, download_state: 'corrupt', status: 'paused', updated_at_ms: Date.now() });
      const message = 'This offline download is incomplete or corrupt. Download it again before resuming.';
      if (mountedRef.current) {
        setError(message);
        setState('error');
      }
      throw new Error(message);
    }
    const next = await publishSession({
      ...active,
      status: 'active',
      user_paused: false,
      updated_at_ms: Date.now(),
    });
    if (!operationIsCurrent()) return;
    if (mountedRef.current) setState('tracking');
    if (!simulating) {
      await startLocation();
      if (!operationIsCurrent()) {
        await stopLocation();
        return;
      }
      await syncOriginalDriveToCar(activeManifest).catch(() => {});
      if (!operationIsCurrent()) return;
    }
    const audioState = await dependencies.audio.getState();
    if (!operationIsCurrent()) return;
    if (next.current_stop_id) {
      if (audioState.loaded) {
        await acquireOriginalAudioFocus();
        if (!operationIsCurrent()) {
          await releaseAudio();
          return;
        }
        if (originalAudioCoordinator.activeOwner() === 'trailhead-originals') {
          await dependencies.audio.play();
        }
      } else {
        await playStop(next.current_stop_id, next.current_audio_position_ms);
      }
    }
  }, [acquireOriginalAudioFocus, dependencies.audio, dependencies.bundles, playStop, publishSession, releaseAudio, requireCurrentAccess, startLocation, stopLocation]);

  const stopTour = useCallback(() => {
    const inFlight = stopTourPromiseRef.current;
    if (inFlight) return inFlight;

    // Capture the persistence mode before any awaited cleanup. A concurrent
    // stop must never observe simulation=false and save an ephemeral preview.
    const wasSimulation = simulationRef.current;
    stoppingRef.current = true;
    trackingGenerationRef.current += 1;

    const operation = (async () => {
      try {
        await stopLocation().catch(() => {});

        // Cancel a pending native load, then drain any synthetic/native sample
        // that had already passed its generation check. Playback also checks
        // the generation after every await, so it cannot restart after this.
        await dependencies.audio.stop().catch(() => {});
        await dependencies.audio.unload().catch(() => {});
        await releaseAudio().catch(() => {});
        await sampleTailRef.current.catch(() => {});

        // A sample may have reached audio immediately before invalidation;
        // perform a final idempotent teardown after the queue is quiescent.
        await dependencies.audio.stop().catch(() => {});
        await dependencies.audio.unload().catch(() => {});
        await releaseAudio().catch(() => {});

        const active = sessionRef.current;
        if (!wasSimulation) {
          if (active) {
            await dependencies.sessions.save({
              ...active,
              status: 'stopped',
              updated_at_ms: Date.now(),
            }).catch(() => {});
          }
          await dependencies.sessions.setActive(null).catch(() => {});
          await clearOriginalDriveFromCar().catch(() => {});
        }
      } finally {
        simulationRef.current = false;
        lastTriggerEvaluationRef.current = null;
        sessionRef.current = null;
        manifestRef.current = null;
        bundleRef.current = null;
        finishingAudioRef.current = false;
        lastPositionPersistRef.current = 0;
        if (mountedRef.current) {
          setSession(null);
          setManifest(null);
          setBundle(null);
          setSimulation(false);
          setLastTriggerEvaluation(null);
          setAudioPlaybackState(null);
          setState('idle');
        }
        stoppingRef.current = false;
      }
    })();

    stopTourPromiseRef.current = operation;
    const clear = () => {
      if (stopTourPromiseRef.current === operation) stopTourPromiseRef.current = null;
    };
    operation.then(clear, clear);
    return operation;
  }, [dependencies.audio, dependencies.sessions, releaseAudio, stopLocation]);

  const skipCurrentStory = useCallback(async () => {
    const active = sessionRef.current;
    const activeManifest = manifestRef.current;
    if (!active?.current_stop_id || !activeManifest || stoppingRef.current) return;
    const generation = trackingGenerationRef.current;
    await dependencies.audio.stop();
    await dependencies.audio.unload();
    await releaseAudio();
    if (
      stoppingRef.current
      || generation !== trackingGenerationRef.current
      || sessionRef.current?.session_id !== active.session_id
    ) return;
    let next = skipOriginalStop(
      active,
      active.current_stop_id,
      activeManifest.stops.map(stop => stop.id),
    );
    const queued = next.queued_stop_id;
    if (queued) next = { ...next, current_stop_id: queued, queued_stop_id: null, current_audio_position_ms: 0 };
    await publishSession(next);
    if (
      stoppingRef.current
      || generation !== trackingGenerationRef.current
      || sessionRef.current?.session_id !== active.session_id
    ) return;
    if (!simulationRef.current) {
      trackOriginalsAnalyticsEvent(ORIGINALS_ANALYTICS_EVENTS.stopOutcome, {
        pack_id: active.pack_id,
        version: active.version,
        stop_id: active.current_stop_id,
        outcome: 'skipped',
      });
    }
    if (queued) await playStop(queued);
    else if (next.status === 'completed') {
      await stopLocation();
      if (mountedRef.current) setState('completed');
    }
  }, [dependencies.audio, playStop, publishSession, releaseAudio, stopLocation]);

  const skipSimulationCue = useCallback(async () => {
    if (!simulationRef.current || stoppingRef.current) {
      throw new Error('Cue advancing is available only in the no-driving trigger test.');
    }
    const active = sessionRef.current;
    const activeManifest = manifestRef.current;
    if (!active || !activeManifest) throw new Error('No draft trigger test is active.');
    if (active.current_stop_id) {
      throw new Error('Finish or skip the playing story before advancing the next cue.');
    }
    const nextStop = remainingOriginalTriggerStops(activeManifest, active)[0];
    if (!nextStop) return;
    const decision = lastTriggerEvaluationRef.current?.decision;
    const explicitCueFailure = decision?.stop_id === nextStop.id && [
      'before_window',
      'after_window',
      'outside_radius',
      'missing_bearing',
      'wrong_bearing',
    ].includes(decision.code);
    if (!explicitCueFailure) {
      throw new Error('Test this cue and capture a cue-specific failure before marking it failed.');
    }
    const next = skipOriginalStop(
      active,
      nextStop.id,
      activeManifest.stops.map(stop => stop.id),
    );
    await publishSession(next);
    lastTriggerEvaluationRef.current = null;
    if (mountedRef.current) {
      setLastTriggerEvaluation(null);
      if (next.status === 'completed') setState('completed');
    }
  }, [publishSession]);

  const clearSimulationDiagnostic = useCallback(() => {
    if (!simulationRef.current) return;
    lastTriggerEvaluationRef.current = null;
    if (mountedRef.current) setLastTriggerEvaluation(null);
  }, []);

  const replayStory = useCallback(async (stopId: string) => {
    const active = sessionRef.current;
    const activeManifest = manifestRef.current;
    if (!active || !activeManifest?.stops.some(stop => stop.id === stopId) || stoppingRef.current) return;
    const generation = trackingGenerationRef.current;
    if (!originalStopCanReplay(active, stopId)) {
      throw new Error('A story can be replayed only after it is completed, skipped, or missed.');
    }
    if (active.current_stop_id) {
      throw new Error('Pause or finish the current story before replaying another one.');
    }
    const ownerScope = await requireCurrentAccess(
      active.pack_id,
      active.version,
      active.owner_scope,
      simulationRef.current,
    );
    if (
      stoppingRef.current
      || generation !== trackingGenerationRef.current
      || sessionRef.current?.session_id !== active.session_id
    ) return;
    if (!await dependencies.bundles.verify(ownerScope, active.pack_id, active.version)) {
      throw new Error('This offline download needs to be downloaded again before replaying stories.');
    }
    if (
      stoppingRef.current
      || generation !== trackingGenerationRef.current
      || sessionRef.current?.session_id !== active.session_id
    ) return;
    await dependencies.audio.stop();
    await dependencies.audio.unload();
    await releaseAudio();
    if (
      stoppingRef.current
      || generation !== trackingGenerationRef.current
      || sessionRef.current?.session_id !== active.session_id
    ) return;
    await publishSession(startManualOriginalStop(active, stopId));
    if (
      stoppingRef.current
      || generation !== trackingGenerationRef.current
      || sessionRef.current?.session_id !== active.session_id
    ) return;
    if (mountedRef.current) setState('tracking');
    if (!simulationRef.current) {
      trackOriginalsAnalyticsEvent(ORIGINALS_ANALYTICS_EVENTS.stopOutcome, {
        pack_id: active.pack_id,
        version: active.version,
        stop_id: stopId,
        outcome: 'replayed',
      });
    }
    await playStop(stopId);
  }, [dependencies.audio, dependencies.bundles, playStop, publishSession, releaseAudio, requireCurrentAccess]);

  const seekStory = useCallback(async (positionMs: number) => {
    if (stoppingRef.current) return;
    const generation = trackingGenerationRef.current;
    const active = sessionRef.current;
    if (!active) return;
    await dependencies.audio.seek(positionMs);
    if (
      stoppingRef.current
      || generation !== trackingGenerationRef.current
      || sessionRef.current?.session_id !== active.session_id
    ) return;
    await publishSession({
      ...active,
      current_audio_position_ms: Math.max(0, positionMs),
      updated_at_ms: Date.now(),
    });
  }, [dependencies.audio, publishSession]);

  const setMuted = useCallback(async (nextMuted: boolean) => {
    if (stoppingRef.current) return;
    const generation = trackingGenerationRef.current;
    await dependencies.audio.setVolume(nextMuted ? 0 : 1);
    if (stoppingRef.current || generation !== trackingGenerationRef.current) return;
    if (mountedRef.current) setMutedState(nextMuted);
  }, [dependencies.audio]);

  const acquireOriginal = useCallback(async (id: string, version: number, idempotencyKey?: string) => {
    const requestEpoch = accountStorage.epoch();
    const requestUserId = useStore.getState().user?.id ?? null;
    const requestScope = originalOwnerScopeForAccount(requestUserId);
    const requestToken = requestUserId == null ? null : useStore.getState().token ?? null;
    if (requestUserId != null && !requestToken) throw new Error('Sign in to acquire this Original.');
    const scopeIsStillCurrent = () => originalRestoreScopeIsCurrent(
      requestScope,
      requestEpoch,
      accountStorage.epoch(),
      useStore.getState().user?.id ?? null,
    );
    const acquisition: OriginalAcquisition = await originalsApi.acquire(id, {
      idempotencyKey,
      version,
      authToken: requestToken,
    });
    if (!scopeIsStillCurrent()) throw new Error('The signed-in account changed. Try again.');
    const persisted = await accountStorage.run(async () => {
      if (!scopeIsStillCurrent()) return false;
      if (acquisition.guest_access) {
        if (requestUserId != null) return false;
        await dependencies.access.claimGuest(acquisition);
      } else {
        if (requestUserId == null) return false;
        await dependencies.access.recordEntitlement(acquisition, requestUserId);
      }
      return scopeIsStillCurrent();
    }, requestEpoch);
    if (persisted !== true || !scopeIsStillCurrent()) {
      throw new Error('The signed-in account changed. Try again.');
    }
    return acquisition;
  }, [dependencies.access]);

  const claimFeaturedOriginal = useCallback(async (idempotencyKey = `original-featured:${new Date().toISOString().slice(0, 7)}`) => {
    const requestEpoch = accountStorage.epoch();
    const requestUserId = useStore.getState().user?.id ?? null;
    const requestToken = useStore.getState().token ?? null;
    if (requestUserId == null || !requestToken) throw new Error('Sign in to claim this Original.');
    const requestScope = originalOwnerScopeForAccount(requestUserId);
    const scopeIsStillCurrent = () => originalRestoreScopeIsCurrent(
      requestScope,
      requestEpoch,
      accountStorage.epoch(),
      useStore.getState().user?.id ?? null,
    );
    const acquisition = await originalsApi.claimFeatured(idempotencyKey, undefined, requestToken);
    if (!scopeIsStillCurrent() || ('guest_access' in acquisition && acquisition.guest_access)) {
      throw new Error('The signed-in account changed. Try again.');
    }
    const persisted = await accountStorage.run(async () => {
      if (!scopeIsStillCurrent()) return false;
      await dependencies.access.recordEntitlement(acquisition, requestUserId);
      return scopeIsStillCurrent();
    }, requestEpoch);
    if (persisted !== true || !scopeIsStillCurrent()) {
      throw new Error('The signed-in account changed. Try again.');
    }
    return acquisition;
  }, [dependencies.access]);

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
    const requestScope = originalOwnerScopeForAccount(accountId);
    const requestToken = useStore.getState().token ?? null;
    const scopeIsStillCurrent = () => originalRestoreScopeIsCurrent(
      requestScope,
      requestEpoch,
      accountStorage.epoch(),
      useStore.getState().user?.id ?? null,
    );
    if (!requestToken || !scopeIsStillCurrent()) throw new Error('The signed-in account changed. Try again.');
    const guestAccess = await dependencies.access.list('guest');
    if (!scopeIsStillCurrent()) throw new Error('The signed-in account changed. Try again.');
    const guestPacks = new Map<string, { pack_id: string; version: number }>();
    guestAccess.filter(guest => guest.access_type === 'guest_free').forEach(guest => {
      guestPacks.set(`${guest.pack_id}@${guest.version}`, guest);
    });
    const acquired: Array<{ pack_id: string; version: number }> = [];
    const acceptedAcquisitions = new Map<string, OriginalAuthenticatedAcquisition>();
    for (const guest of guestPacks.values()) {
      if (
        !scopeIsStillCurrent()
      ) throw new Error('The signed-in account changed. Try again.');
      const acquisition = await originalsApi.acquire(guest.pack_id, {
        idempotencyKey: `guest-original:${guest.pack_id}:${guest.version}:account:${accountId}`,
        version: guest.version,
        authToken: requestToken,
      }).catch(() => null);
      if (
        acquisition
        && !acquisition.guest_access
        && String(acquisition.pack.id) === String(guest.pack_id)
        && acquisition.pack.version === guest.version
      ) {
        acquired.push(guest);
        acceptedAcquisitions.set(`${guest.pack_id}@${guest.version}`, acquisition);
      }
    }
    if (!scopeIsStillCurrent()) throw new Error('The signed-in account changed. Try again.');
    const acquisitionsByIdentity = new Map(acquired.map((identity, index) => [
      `${identity.pack_id}@${identity.version}`,
      identity,
    ]));
    const accepted = [...acquisitionsByIdentity.values()];
    const committed = await accountStorage.run(async () => {
      if (!scopeIsStillCurrent()) return null;
      // Only exact guest-free versions just accepted by the server may cross
      // into the account partition. Orphan sessions are never candidates.
      for (const identity of accepted) {
        const acquisition = acceptedAcquisitions.get(`${identity.pack_id}@${identity.version}`);
        if (!acquisition) return null;
        await dependencies.access.recordEntitlement(acquisition, accountId);
      }
      // Once this captured-scope commit begins, finish every idempotent move.
      // Account cleanup waits on accountStorage.run, so stopping between stores
      // would be more dangerous than completing the migration before cleanup.
      await dependencies.bundles.migrateGuestToAccount(accountId, accepted);
      const [migrated] = await Promise.all([
        dependencies.sessions.migrateGuestToAccount(accountId, accepted),
        dependencies.access.migrateGuestToAccount(accountId, accepted),
      ]);
      return migrated;
    }, requestEpoch);
    if (!committed || !scopeIsStillCurrent()) throw new Error('The signed-in account changed. Try again.');
    const migrated = committed;
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
    if (resumable.status !== 'stopped') await syncOriginalDriveToCar(restoredManifest).catch(() => {});
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
    simulation,
    lastTriggerEvaluation,
    audioPlaybackState,
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
    audioPlaybackState,
    lastTriggerEvaluation,
    manifest,
    migrateGuestToAccount,
    muted,
    simulation,
    pauseTour,
    replayStory,
    resumeTour,
    seekStory,
    setMuted,
    session,
    skipCurrentStory,
    state,
    stopTour,
  ]);

  const adminValue = useMemo<OriginalsAdminRuntimeValue>(() => ({
    startSimulation: value => {
      if (!useStore.getState().user?.is_admin) {
        return Promise.reject(new Error('The Virtual Drive Lab is available only to Trailhead admins.'));
      }
      return activateTour(value, true, true);
    },
    skipSimulationCue: () => {
      if (!useStore.getState().user?.is_admin || !simulationRef.current) {
        return Promise.reject(new Error('No admin Virtual Drive Lab session is active.'));
      }
      return skipSimulationCue();
    },
    clearSimulationDiagnostic: () => {
      if (!useStore.getState().user?.is_admin || !simulationRef.current) return;
      clearSimulationDiagnostic();
    },
    submitLocationSample: sample => {
      if (!useStore.getState().user?.is_admin || !simulationRef.current) {
        return Promise.reject(new Error('Synthetic location is available only in an admin Virtual Drive Lab session.'));
      }
      return submitLocationSample(sample);
    },
  }), [activateTour, clearSimulationDiagnostic, skipSimulationCue, submitLocationSample]);

  return (
    <OriginalsRuntimeContext.Provider value={value}>
      <OriginalsAdminRuntimeContext.Provider value={adminValue}>
        {children}
      </OriginalsAdminRuntimeContext.Provider>
    </OriginalsRuntimeContext.Provider>
  );
}

export function useOriginalsRuntime() {
  const value = useContext(OriginalsRuntimeContext);
  if (!value) throw new Error('useOriginalsRuntime must be used inside OriginalsRuntimeProvider.');
  return value;
}

export function useOriginalsAdminRuntime() {
  const value = useContext(OriginalsAdminRuntimeContext);
  if (!value) throw new Error('useOriginalsAdminRuntime must be used inside OriginalsRuntimeProvider.');
  return value;
}
