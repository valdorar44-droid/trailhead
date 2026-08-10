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
import { AppState } from 'react-native';
import { useStore } from '../store';
import { accountStorage } from '../storage';
import {
  buildCarAccountState,
  clearCarOriginalDrive,
  setCarOriginalDrive,
} from '../carIntegration';
import { originalsApi } from './api';
import { originalAdminPreviewReviewEntries } from './adminPreviewReview';
import { registerOriginalsAccountDepartureStopper } from './accountCleanup';
import {
  type OriginalAccessStore,
} from './accessStore';
import {
  ORIGINAL_EXPLORER_ACCESS_REQUIRED,
  originalLocalAccessIsCurrent,
  originalLocalAccessIsExplorerSubscription,
} from './accessPolicy';
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
import {
  resolveOriginalManifestForPlayback,
  resolveOriginalManifestPlaybackForSession,
} from './manifestV2';
import {
  completeOriginalLongFormItem,
  createOriginalLongFormSession,
  ensureOriginalLongFormSession,
  evaluateOriginalLongFormCapacity,
  originalLongFormBeforeRouteContextIsActive,
  originalLongFormCapacityLocationIsAccepted,
  originalLongFormHeadlessResumeAction,
  originalLongFormLandmarkFixIsEligible,
  preemptOriginalLongFormForHardCue,
  replayOriginalLongFormItem,
  resumeDeferredOriginalLongFormAfterHardCue,
  selectOriginalLongFormItem,
  updateOriginalLongFormAudioPosition,
  withOriginalLongFormSession,
} from './longFormScheduler';
import { stopHeadlessOriginalRuntime } from './headlessRuntime';
import { originalOwnerScopeForAccount, originalRestoreScopeIsCurrent } from './ownership';
import {
  clearOriginalPrivateReviewCleanupIdentityStrict,
  clearOriginalPreviewAccessStrict,
  getOriginalPrivateReviewCleanupIdentity,
  getOriginalPreviewToken,
  saveOriginalPrivateReviewCleanupIdentity,
  type OriginalPrivateReviewCleanupIdentityV1,
} from './previewAccess';
import {
  completeOriginalStop,
  createOriginalSession,
  finishManualOriginalStop,
  normalizeCompletedOriginalSession,
  originalStopCanReplay,
  promoteNextOriginalStop,
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
  OriginalAccessMode,
  OriginalAuthenticatedAcquisition,
  OriginalChapterSelectionV2,
  OriginalManifest,
  OriginalManifestV1,
  OriginalOwnerScope,
  OriginalSelectablePlaybackPlanV1,
  OriginalSessionV1,
  OriginalTriggerEvaluation,
} from './types';

export type OriginalsRuntimeState = 'idle' | 'ready' | 'tracking' | 'paused' | 'completed' | 'error';

function currentCarTripContext() {
  const current = useStore.getState();
  return {
    trip: current.activeTrip,
    account: buildCarAccountState(current.user, Boolean(current.token), Date.now(), current.hasPlan),
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
  selectablePlan: OriginalSelectablePlaybackPlanV1 | null;
  bundle: OriginalBundleRecord | null;
  downloadProgress: OriginalBundleProgress | null;
  error: string | null;
  muted: boolean;
  simulation: boolean;
  lastTriggerEvaluation: OriginalTriggerEvaluation | null;
  audioPlaybackState: OriginalAudioPlaybackState | null;
  audioCapabilities: OriginalAudioAdapter['capabilities'];
  downloadOriginal: (
    manifest: OriginalManifest,
    options?: Omit<
      OriginalBundleDownloadOptions,
      'onProgress' | 'ownerScope' | 'privatePreviewManifestId'
    >,
  ) => Promise<OriginalBundleRecord>;
  startTour: (
    manifest: OriginalManifest,
    selection?: OriginalChapterSelectionV2,
  ) => Promise<OriginalSessionV1>;
  restartTour: (
    manifest: OriginalManifest,
    selection?: OriginalChapterSelectionV2,
  ) => Promise<OriginalSessionV1>;
  pauseTour: () => Promise<void>;
  resumeTour: () => Promise<void>;
  stopTour: () => Promise<void>;
  skipCurrentStory: () => Promise<void>;
  replayStory: (stopId: string) => Promise<void>;
  playLongFormItem: (
    itemId: string,
    options: { userConfirmedParked?: boolean },
  ) => Promise<void>;
  seekStory: (positionMs: number) => Promise<void>;
  setMuted: (muted: boolean) => Promise<void>;
  acquireOriginal: (
    id: string,
    version: number,
    idempotencyKey?: string,
    accessMode?: OriginalAccessMode,
  ) => Promise<OriginalAcquisition>;
  claimFeaturedOriginal: (idempotencyKey?: string) => Promise<OriginalAcquisition>;
  beginAudioInterruption: (kind: 'navigation' | 'hazard') => Promise<() => Promise<void>>;
  migrateGuestToAccount: (accountId: string | number) => Promise<OriginalSessionV1[]>;
};

/** Privileged synthetic controls intentionally excluded from the public runtime API. */
export type OriginalsAdminRuntimeValue = {
  privateReviewActive: boolean;
  privateReviewCleanupPending: boolean;
  startSimulation: (
    manifest: OriginalManifest,
    selection?: OriginalChapterSelectionV2,
  ) => Promise<OriginalSessionV1>;
  skipSimulationCue: () => Promise<void>;
  clearSimulationDiagnostic: () => void;
  submitLocationSample: (sample: OriginalLocationSample) => Promise<void>;
  reviewPreviewStory: (storyId: string) => Promise<void>;
  endPrivateReview: () => Promise<void>;
};

type OriginalPrivateReviewIdentity = {
  ownerScope: OriginalOwnerScope;
  packId: string;
  version: number;
  manifestId: string;
};

function storedPrivateReviewIdentity(
  identity: OriginalPrivateReviewIdentity,
): OriginalPrivateReviewCleanupIdentityV1 {
  return {
    owner_scope: identity.ownerScope,
    pack_id: identity.packId,
    version: identity.version,
    manifest_id: identity.manifestId,
  };
}

function runtimePrivateReviewIdentity(
  identity: OriginalPrivateReviewCleanupIdentityV1,
): OriginalPrivateReviewIdentity {
  return {
    ownerScope: identity.owner_scope,
    packId: identity.pack_id,
    version: identity.version,
    manifestId: identity.manifest_id,
  };
}

function samePrivateReviewIdentity(
  left: OriginalPrivateReviewIdentity,
  right: OriginalPrivateReviewIdentity,
) {
  return left.ownerScope === right.ownerScope
    && left.packId === right.packId
    && left.version === right.version
    && left.manifestId === right.manifestId;
}

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
  const [selectablePlan, setSelectablePlan] = useState<OriginalSelectablePlaybackPlanV1 | null>(null);
  const [bundle, setBundle] = useState<OriginalBundleRecord | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<OriginalBundleProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMutedState] = useState(false);
  const [simulation, setSimulation] = useState(false);
  const [privateReviewActive, setPrivateReviewActive] = useState(false);
  const [privateReviewCleanupPending, setPrivateReviewCleanupPending] = useState(false);
  const [lastTriggerEvaluation, setLastTriggerEvaluation] = useState<OriginalTriggerEvaluation | null>(null);
  const [audioPlaybackState, setAudioPlaybackState] = useState<OriginalAudioPlaybackState | null>(null);

  const sessionRef = useRef<OriginalSessionV1 | null>(null);
  const manifestRef = useRef<OriginalManifestV1 | null>(null);
  const selectablePlanRef = useRef<OriginalSelectablePlaybackPlanV1 | null>(null);
  const lastLocationSampleRef = useRef<OriginalLocationSample | null>(null);
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
  const privateReviewIdentityRef = useRef<OriginalPrivateReviewIdentity | null>(null);
  const privateReviewCleanupIdentityRef = useRef<OriginalPrivateReviewIdentity | null>(null);
  const lastTriggerEvaluationRef = useRef<OriginalTriggerEvaluation | null>(null);
  const stoppingRef = useRef(false);
  const stopTourPromiseRef = useRef<Promise<void> | null>(null);
  const privateReviewCleanupPromiseRef = useRef<Promise<void> | null>(null);

  const requireCurrentAccess = useCallback(async (
    packId: string,
    version: number,
    expectedScope?: OriginalOwnerScope,
    allowAdminPreview = false,
    expectedManifestId?: string,
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
    const allowed = access?.owner_scope === ownerScope && originalLocalAccessIsCurrent(
      access,
      Math.floor(Date.now() / 1_000),
      {
        allowAdminPreview: Boolean(currentUser?.is_admin) && allowAdminPreview,
        manifestId: expectedManifestId,
      },
    );
    if (!allowed) {
      if (originalLocalAccessIsExplorerSubscription(access)) {
        throw new Error(ORIGINAL_EXPLORER_ACCESS_REQUIRED);
      }
      throw new Error(ownerScope === 'guest'
        ? 'Get this free Original on this device before downloading or starting it.'
        : 'Restore or acquire this exact Original version for the signed-in account.');
    }
    if (!scopeIsStillCurrent()) throw new Error('The signed-in account changed. Try again.');
    return { ownerScope, access };
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
  const handleExternalUserPlayRef = useRef<(state: OriginalAudioPlaybackState) => Promise<void>>(async () => {});

  const handleAudioState = useCallback((audioState: OriginalAudioPlaybackState) => {
    if (stoppingRef.current) return;
    if (mountedRef.current) setAudioPlaybackState(audioState);
    const active = sessionRef.current;
    if (!active) return;
    if (audioState.loaded && Math.abs(audioState.position_ms - lastPositionPersistRef.current) >= 5_000) {
      lastPositionPersistRef.current = audioState.position_ms;
      const plan = selectablePlanRef.current;
      const next = active.long_form?.current_item_id && plan
        ? updateOriginalLongFormAudioPosition(active, plan, audioState.position_ms)
        : { ...active, current_audio_position_ms: audioState.position_ms, updated_at_ms: Date.now() };
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
    if (!active) return null;
    const hasOptionalAudio = Boolean(active.long_form?.current_item_id && selectablePlanRef.current);
    if (!active.current_stop_id && !hasOptionalAudio) return active;
    const audioState = await dependencies.audio.getState();
    if (!audioState.loaded) return active;
    const positionMs = Math.max(0, audioState.position_ms);
    lastPositionPersistRef.current = positionMs;
    const plan = selectablePlanRef.current;
    return publishSession(hasOptionalAudio && plan
      ? updateOriginalLongFormAudioPosition(active, plan, positionMs)
      : {
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
    let activeSession = sessionRef.current;
    if (!activeManifest || !activeSession) throw new Error('No Trailhead Original is active.');
    const sessionId = activeSession.session_id;
    const generation = trackingGenerationRef.current;
    const operationIsCurrent = () => (
      !stoppingRef.current
      && generation === trackingGenerationRef.current
      && sessionRef.current?.session_id === sessionId
      && manifestRef.current?.manifest_id === activeManifest.manifest_id
    );
    if (!operationIsCurrent()) return;
    const stop = activeManifest.stops.find(item => item.id === stopId);
    if (!stop) throw new Error('This story is not part of the active Original.');
    const { ownerScope } = await requireCurrentAccess(
      activeManifest.pack_id,
      activeManifest.version,
      activeSession.owner_scope,
      simulationRef.current,
      activeManifest.manifest_id,
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
    const artworkUri = stop.artwork_asset_id
      ? await dependencies.bundles.assetUri(
        ownerScope,
        activeManifest.pack_id,
        activeManifest.version,
        stop.artwork_asset_id,
      ).catch(() => null)
      : null;
    if (!operationIsCurrent()) return;

    const activePlan = selectablePlanRef.current;
    const latestSession = sessionRef.current;
    if (activePlan && latestSession?.long_form?.current_item_id) {
      const audioState = await dependencies.audio.getState().catch(() => null);
      await dependencies.audio.stop().catch(() => {});
      await dependencies.audio.unload().catch(() => {});
      await releaseAudio();
      if (!operationIsCurrent()) return;
      activeSession = await publishSession(preemptOriginalLongFormForHardCue(
        latestSession,
        activePlan,
        audioState?.loaded ? audioState.position_ms : latestSession.long_form.current_audio_position_ms,
      ));
      if (!operationIsCurrent()) return;
    }

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
        metadata: {
          title: stop.title,
          artist: 'Trailhead Originals',
          albumTitle: activeManifest.title,
          ...(artworkUri ? { artworkUrl: artworkUri } : {}),
        },
        onState: handleAudioState,
        onUserPause: value => handleExternalUserPauseRef.current(value),
        onUserPlay: value => handleExternalUserPlayRef.current(value),
      });
      if (!operationIsCurrent()) {
        await dependencies.audio.unload().catch(() => {});
        await releaseAudio();
        return;
      }
      if (originalAudioCoordinator.activeOwner() === 'trailhead-originals') {
        await dependencies.audio.play();
      }
      if (mountedRef.current) setState('tracking');
    } catch (error) {
      await dependencies.audio.unload().catch(() => {});
      await releaseAudio();
      if (originalAudioCoordinator.activeOwner() == null) {
        await dependencies.audio.releaseSession().catch(() => {});
      }
      throw error;
    }
  }, [acquireOriginalAudioFocus, dependencies.audio, dependencies.bundles, handleAudioState, publishSession, releaseAudio, requireCurrentAccess]);

  const playOptionalItem = useCallback(async (itemId: string, positionMs = 0) => {
    const activeManifest = manifestRef.current;
    const activePlan = selectablePlanRef.current;
    const activeSession = sessionRef.current;
    if (!activeManifest || !activePlan || !activeSession) {
      throw new Error('No Trailhead Original story is active.');
    }
    const item = activePlan.items.find(value => value.id === itemId);
    if (!item || activeSession.long_form?.current_item_id !== item.id) {
      throw new Error('This story is not selected for playback.');
    }
    if (activeSession.current_stop_id) {
      throw new Error('The driving story must finish before this story can play.');
    }
    const generation = trackingGenerationRef.current;
    const operationIsCurrent = () => (
      !stoppingRef.current
      && generation === trackingGenerationRef.current
      && sessionRef.current?.session_id === activeSession.session_id
      && sessionRef.current?.long_form?.current_item_id === item.id
      && selectablePlanRef.current?.delivery_contract_sha256 === activePlan.delivery_contract_sha256
    );
    const { ownerScope } = await requireCurrentAccess(
      activeManifest.pack_id,
      activeManifest.version,
      activeSession.owner_scope,
      simulationRef.current,
      activeManifest.manifest_id,
    );
    if (!operationIsCurrent()) return;
    const localUri = await dependencies.bundles.assetUri(
      ownerScope,
      activeManifest.pack_id,
      activeManifest.version,
      item.audio_asset_id,
    );
    if (!operationIsCurrent()) return;
    if (!localUri) throw new Error('Download this Original before playing its stories.');
    const artworkUri = item.artwork_asset_id
      ? await dependencies.bundles.assetUri(
        ownerScope,
        activeManifest.pack_id,
        activeManifest.version,
        item.artwork_asset_id,
      ).catch(() => null)
      : null;
    if (!operationIsCurrent()) return;
    const persisted = await publishSession(updateOriginalLongFormAudioPosition(
      activeSession,
      activePlan,
      positionMs,
    ));
    if (!operationIsCurrent()) return;
    lastPositionPersistRef.current = persisted.long_form?.current_audio_position_ms ?? 0;
    await acquireOriginalAudioFocus();
    if (!operationIsCurrent()) {
      await releaseAudio();
      return;
    }
    try {
      await dependencies.audio.load(localUri, {
        positionMs: persisted.long_form?.current_audio_position_ms ?? 0,
        metadata: {
          title: item.title,
          artist: 'Trailhead Originals',
          albumTitle: activeManifest.title,
          ...(artworkUri ? { artworkUrl: artworkUri } : {}),
        },
        onState: handleAudioState,
        onUserPause: value => handleExternalUserPauseRef.current(value),
        onUserPlay: value => handleExternalUserPlayRef.current(value),
      });
      if (!operationIsCurrent()) {
        await dependencies.audio.unload().catch(() => {});
        await releaseAudio();
        return;
      }
      if (originalAudioCoordinator.activeOwner() === 'trailhead-originals') {
        await dependencies.audio.play();
      }
      if (mountedRef.current) setState('tracking');
    } catch (caught) {
      await dependencies.audio.unload().catch(() => {});
      await releaseAudio();
      if (originalAudioCoordinator.activeOwner() == null) {
        await dependencies.audio.releaseSession().catch(() => {});
      }
      throw caught;
    }
  }, [acquireOriginalAudioFocus, dependencies.audio, dependencies.bundles, handleAudioState, publishSession, releaseAudio, requireCurrentAccess]);

  const handleAudioFinished = useCallback(async () => {
    const activeManifest = manifestRef.current;
    const activeSession = sessionRef.current;
    const activePlan = selectablePlanRef.current;
    const completedOptionalId = activeSession?.long_form?.current_item_id;
    if (activeManifest && activeSession && activePlan && completedOptionalId) {
      const generation = trackingGenerationRef.current;
      await dependencies.audio.unload();
      await releaseAudio();
      if (
        stoppingRef.current
        || generation !== trackingGenerationRef.current
        || sessionRef.current?.session_id !== activeSession.session_id
      ) return;
      const next = completeOriginalLongFormItem(
        activeSession,
        activePlan,
        completedOptionalId,
      );
      await publishSession(next);
      const nextGroupItemId = next.long_form?.current_item_id;
      if (nextGroupItemId) {
        await playOptionalItem(nextGroupItemId, 0);
        return;
      }
      if (originalAudioCoordinator.activeOwner() == null) {
        await dependencies.audio.releaseSession().catch(() => {});
      }
      if (mountedRef.current) {
        setState(next.status === 'completed' ? 'completed' : 'tracking');
      }
      return;
    }
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
    const promotion = promoteNextOriginalStop(next);
    next = promotion.session;
    const queued = promotion.promoted_stop_id;
    const deferred = !queued && activePlan
      ? resumeDeferredOriginalLongFormAfterHardCue(next, activePlan)
      : { session: next, action: null };
    next = deferred.session;
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
    if (!queued && !deferred.action && originalAudioCoordinator.activeOwner() == null) {
      await dependencies.audio.releaseSession().catch(() => {});
    }
    if (deferred.action) {
      await playOptionalItem(deferred.action.item_id, deferred.action.position_ms);
      return;
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
  }, [dependencies.audio, playOptionalItem, playStop, publishSession, releaseAudio, stopLocation]);
  handleAudioFinishedRef.current = handleAudioFinished;

  const handleExternalUserPause = useCallback(async (audioState: OriginalAudioPlaybackState) => {
    const active = sessionRef.current;
    if ((!active?.current_stop_id && !active?.long_form?.current_item_id) || active.user_paused) return;
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
      ...(active.long_form?.current_item_id && selectablePlanRef.current
        ? {
          long_form: updateOriginalLongFormAudioPosition(
            active,
            selectablePlanRef.current,
            audioState.position_ms,
          ).long_form,
        }
        : { current_audio_position_ms: Math.max(0, audioState.position_ms) }),
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
      const previousAcceptedTimestamp = activeSession.last_location_timestamp_ms;
      const acceptedForTransientUse = evaluation.decision.code !== 'stale_fix'
        && (previousAcceptedTimestamp == null || sample.timestamp_ms > previousAcceptedTimestamp)
        && evaluation.session.last_location_timestamp_ms === sample.timestamp_ms;
      if (
        acceptedForTransientUse
        && (
          !lastLocationSampleRef.current
          || sample.timestamp_ms > lastLocationSampleRef.current.timestamp_ms
        )
      ) lastLocationSampleRef.current = sample;
      lastTriggerEvaluationRef.current = evaluation;
      if (mountedRef.current) setLastTriggerEvaluation(evaluation);
      const trigger = evaluation.events.find(event => event.type === 'stop_triggered');
      const activePlan = selectablePlanRef.current;
      const capacityLocationAccepted = originalLongFormCapacityLocationIsAccepted(
        activeSession,
        sample,
        evaluation,
      );
      const capacity = !trigger
        && activePlan
        && !simulationRef.current
        && capacityLocationAccepted
        ? evaluateOriginalLongFormCapacity(
          activePlan,
          activeManifest,
          evaluation.session,
          sample,
          {
            projected_progress_m: evaluation.projected_route_progress_m,
            distance_from_route_m: evaluation.distance_from_route_m,
          },
        )
        : null;
      await publishSession(capacity?.session ?? evaluation.session);
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
      } else if (capacity?.action) {
        try {
          await playOptionalItem(capacity.action.item_id, capacity.action.position_ms);
        } catch (caught) {
          if (stoppingRef.current || generation !== trackingGenerationRef.current) return;
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
  }, [playOptionalItem, playStop, publishSession, stopLocation]);

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

  const handleExternalUserPlay = useCallback(async () => {
    const active = sessionRef.current;
    const activeManifest = manifestRef.current;
    if (
      (!active?.current_stop_id && !active?.long_form?.current_item_id)
      || !active.user_paused
      || !activeManifest
      || stoppingRef.current
    ) return;
    trackingGenerationRef.current += 1;
    const generation = trackingGenerationRef.current;
    const simulating = simulationRef.current;
    const operationIsCurrent = () => (
      !stoppingRef.current
      && generation === trackingGenerationRef.current
      && sessionRef.current?.session_id === active.session_id
      && sessionRef.current?.current_stop_id === active.current_stop_id
      && sessionRef.current?.long_form?.current_item_id === active.long_form?.current_item_id
      && manifestRef.current?.manifest_id === activeManifest.manifest_id
    );
    await publishSession({
      ...active,
      status: 'active',
      user_paused: false,
      updated_at_ms: Date.now(),
    });
    if (!operationIsCurrent()) return;
    await acquireOriginalAudioFocus();
    if (!operationIsCurrent()) {
      await releaseAudio();
      return;
    }
    if (!simulating) {
      await startLocation(operationIsCurrent);
      if (!operationIsCurrent()) {
        await stopLocation();
        return;
      }
      await syncOriginalDriveToCar(activeManifest).catch(() => {});
      if (!operationIsCurrent()) return;
    }
    if (mountedRef.current) setState('tracking');
  }, [acquireOriginalAudioFocus, publishSession, releaseAudio, startLocation, stopLocation]);
  handleExternalUserPlayRef.current = handleExternalUserPlay;

  const activateTour = useCallback(async (
    manifestInput: OriginalManifest,
    restart: boolean,
    simulate = false,
    chapterSelection?: OriginalChapterSelectionV2,
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
      if (privateReviewCleanupIdentityRef.current) {
        throw new Error('Finish removing the pending private review before starting another Original.');
      }
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
      const resolved = resolveOriginalManifestForPlayback(manifestInput, chapterSelection);
      const cleanManifest = validateOriginalManifest(resolved.manifest);
      const { ownerScope, access: activationAccess } = await requireCurrentAccess(
        cleanManifest.pack_id,
        cleanManifest.version,
        requestScope,
        simulate,
        cleanManifest.manifest_id,
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
      const exactPrivateReview = Boolean(
        simulate
        && useStore.getState().user?.is_admin
        && activationAccess?.owner_scope === ownerScope
        && activationAccess.access_type === 'admin_preview'
        && activationAccess.manifest_id === cleanManifest.manifest_id
      );
      const privateReviewIdentity: OriginalPrivateReviewIdentity | null = exactPrivateReview
        ? {
          ownerScope,
          packId: cleanManifest.pack_id,
          version: cleanManifest.version,
          manifestId: cleanManifest.manifest_id,
        }
        : null;
      const existing = restart || simulate
        ? null
        : await dependencies.sessions.load(
          ownerScope,
          cleanManifest.pack_id,
          cleanManifest.version,
          resolved.selection,
        );
      requireActiveActivation();
      const now = Date.now();
      let active: OriginalSessionV1 = {
        ...(existing ?? createOriginalSession(cleanManifest, ownerScope, now, resolved.selection)),
        status: 'active' as const,
        user_paused: false,
        download_state: 'ready' as const,
        started_at_ms: existing?.started_at_ms ?? now,
        completed_at_ms: restart ? null : existing?.completed_at_ms ?? null,
        updated_at_ms: now,
      };
      if (resolved.source_schema_version === 3) {
        active = withOriginalLongFormSession(
          active,
          ensureOriginalLongFormSession(active, resolved.selectable, now),
        );
      }
      await stopLocation();
      requireActiveActivation();
      await dependencies.audio.stop().catch(() => {});
      requireActiveActivation();
      await dependencies.audio.unload().catch(() => {});
      requireActiveActivation();
      await releaseAudio();
      requireActiveActivation();
      simulationRef.current = simulate;
      privateReviewIdentityRef.current = privateReviewIdentity;
      privateReviewCleanupIdentityRef.current = null;
      lastTriggerEvaluationRef.current = null;
      manifestRef.current = cleanManifest;
      selectablePlanRef.current = resolved.source_schema_version === 3
        ? resolved.selectable
        : null;
      lastLocationSampleRef.current = null;
      bundleRef.current = installed;
      if (mountedRef.current) {
        setManifest(cleanManifest);
        setSelectablePlan(selectablePlanRef.current);
        setBundle(installed);
        setError(null);
        setSimulation(simulate);
        setPrivateReviewActive(Boolean(privateReviewIdentity));
        setPrivateReviewCleanupPending(false);
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
      } else if (resolved.source_schema_version === 3) {
        const explicitResume = originalLongFormHeadlessResumeAction(active, resolved.selectable);
        if (explicitResume) {
          await playOptionalItem(explicitResume.item_id, explicitResume.position_ms);
          requireActiveActivation();
        }
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
        privateReviewIdentityRef.current = null;
        if (mountedRef.current) {
          setSimulation(false);
          setPrivateReviewActive(false);
        }
      }
      throw caught;
    }
  }, [dependencies.access, dependencies.audio, dependencies.bundles, dependencies.sessions, playOptionalItem, playStop, publishSession, releaseAudio, requireCurrentAccess, startLocation, stopLocation]);

  const downloadOriginal = useCallback(async (
    manifestInput: OriginalManifest,
    options: Omit<
      OriginalBundleDownloadOptions,
      'onProgress' | 'ownerScope' | 'privatePreviewManifestId'
    > = {},
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
      const { ownerScope, access } = await requireCurrentAccess(
        manifestInput.pack_id,
        manifestInput.version,
        requestScope,
        true,
        manifestInput.manifest_id,
      );
      if (!scopeIsStillCurrent()) throw new Error('The signed-in account changed. Try again.');
      const adminPreview = access?.access_type === 'admin_preview';
      reportDownloadAnalytics = !adminPreview;
      if (adminPreview) {
        const pending = await getOriginalPrivateReviewCleanupIdentity();
        if (
          !pending
          || pending.owner_scope !== ownerScope
          || pending.pack_id !== manifestInput.pack_id
          || pending.version !== manifestInput.version
          || pending.manifest_id !== manifestInput.manifest_id
        ) throw new Error('The exact private preview cleanup identity is not ready.');
      }
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
          privatePreviewManifestId: adminPreview ? manifestInput.manifest_id : undefined,
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
    const { ownerScope } = await requireCurrentAccess(
      active.pack_id,
      active.version,
      active.owner_scope,
      simulating,
      activeManifest.manifest_id,
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
    const resumingCompletedStory = Boolean(
      active.long_form?.current_item_id && active.completed_at_ms != null,
    );
    const next = await publishSession({
      ...active,
      status: resumingCompletedStory ? 'completed' : 'active',
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
    if (next.current_stop_id || next.long_form?.current_item_id) {
      if (audioState.loaded) {
        await acquireOriginalAudioFocus();
        if (!operationIsCurrent()) {
          await releaseAudio();
          return;
        }
        if (originalAudioCoordinator.activeOwner() === 'trailhead-originals') {
          await dependencies.audio.play();
        }
      } else if (next.current_stop_id) {
        await playStop(next.current_stop_id, next.current_audio_position_ms);
      } else if (next.long_form?.current_item_id) {
        await playOptionalItem(
          next.long_form.current_item_id,
          next.long_form.current_audio_position_ms,
        );
      }
    }
  }, [acquireOriginalAudioFocus, dependencies.audio, dependencies.bundles, playOptionalItem, playStop, publishSession, releaseAudio, requireCurrentAccess, startLocation, stopLocation]);

  const stopTour = useCallback(() => {
    const inFlight = stopTourPromiseRef.current;
    if (inFlight) return inFlight;

    // Capture the persistence mode before any awaited cleanup. A concurrent
    // stop must never observe simulation=false and save an ephemeral preview.
    const wasSimulation = simulationRef.current;
    const sessionAtStop = sessionRef.current;
    stoppingRef.current = true;
    trackingGenerationRef.current += 1;
    // Disable the independent cold runtime synchronously, before reading
    // foreground audio state or awaiting any teardown work. Its generation
    // gate must win every End Tour race, including a slow native getState().
    const headlessStop = stopHeadlessOriginalRuntime().catch(() => {});

    const operation = (async () => {
      try {
        let exactAudioPositionMs = sessionAtStop?.current_audio_position_ms ?? 0;
        if (sessionAtStop?.current_stop_id || sessionAtStop?.long_form?.current_item_id) {
          const audioState = await dependencies.audio.getState().catch(() => null);
          if (audioState?.loaded) exactAudioPositionMs = Math.max(0, audioState.position_ms);
        }

        await stopLocation().catch(() => {});
        await dependencies.location.stopActive().catch(() => {});
        let persistenceError: unknown = null;
        const active = sessionAtStop ?? sessionRef.current;
        if (!wasSimulation) {
          if (active) {
            try {
              const stopped = {
                ...active,
                status: 'stopped',
                current_audio_position_ms: active.current_stop_id
                  ? exactAudioPositionMs
                  : active.current_audio_position_ms,
                updated_at_ms: Date.now(),
              } satisfies OriginalSessionV1;
              await dependencies.sessions.save(
                active.long_form?.current_item_id && selectablePlanRef.current
                  ? updateOriginalLongFormAudioPosition(
                    stopped,
                    selectablePlanRef.current,
                    exactAudioPositionMs,
                  )
                  : stopped,
              );
            } catch (error) {
              persistenceError = error;
            }
          }
          try {
            await dependencies.sessions.setActive(null);
          } catch (error) {
            persistenceError ??= error;
          }
          await clearOriginalDriveFromCar().catch(() => {});
        }
        await headlessStop;

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
        await originalAudioCoordinator.release('trailhead-originals').catch(() => {});
        if (originalAudioCoordinator.activeOwner() == null) {
          await dependencies.audio.releaseSession().catch(() => {});
        }
        if (persistenceError) throw persistenceError;
      } finally {
        simulationRef.current = false;
        privateReviewIdentityRef.current = null;
        lastTriggerEvaluationRef.current = null;
        sessionRef.current = null;
        manifestRef.current = null;
        selectablePlanRef.current = null;
        lastLocationSampleRef.current = null;
        bundleRef.current = null;
        finishingAudioRef.current = false;
        lastPositionPersistRef.current = 0;
        if (mountedRef.current) {
          setSession(null);
          setManifest(null);
          setSelectablePlan(null);
          setBundle(null);
          setSimulation(false);
          setPrivateReviewActive(false);
          if (!privateReviewCleanupIdentityRef.current) {
            setPrivateReviewCleanupPending(false);
          }
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
  }, [dependencies.audio, dependencies.location, dependencies.sessions, releaseAudio, stopLocation]);

  useEffect(
    () => registerOriginalsAccountDepartureStopper(stopTour),
    [stopTour],
  );

  const reviewPreviewStory = useCallback(async (storyId: string) => {
    const currentUser = useStore.getState().user;
    const identity = privateReviewIdentityRef.current;
    if (
      !simulationRef.current
      || !currentUser?.is_admin
      || !identity
      || privateReviewCleanupIdentityRef.current
      || stoppingRef.current
    ) throw new Error('Private story review is available only for an exact admin preview.');
    const active = sessionRef.current;
    const activeManifest = manifestRef.current;
    const activePlan = selectablePlanRef.current;
    const currentScope = originalOwnerScopeForAccount(currentUser.id);
    if (
      !active
      || !activeManifest
      || !activePlan
      || identity.ownerScope !== currentScope
      || active.owner_scope !== identity.ownerScope
      || active.pack_id !== identity.packId
      || active.version !== identity.version
      || active.manifest_id !== identity.manifestId
      || activeManifest.manifest_id !== identity.manifestId
    ) {
      throw new Error('No long-form private review is active.');
    }
    const access = await dependencies.access.get(
      identity.ownerScope,
      identity.packId,
      identity.version,
    );
    if (
      originalOwnerScopeForAccount(useStore.getState().user?.id ?? null) !== identity.ownerScope
      || !useStore.getState().user?.is_admin
      || access?.access_type !== 'admin_preview'
      || access.manifest_id !== identity.manifestId
    ) throw new Error('The exact private preview access is no longer active.');
    if (
      stoppingRef.current
      || privateReviewCleanupIdentityRef.current
      || sessionRef.current?.session_id !== active.session_id
      || manifestRef.current?.manifest_id !== activeManifest.manifest_id
      || selectablePlanRef.current?.delivery_contract_sha256 !== activePlan.delivery_contract_sha256
    ) throw new Error('The private review changed before playback could start.');
    const entry = originalAdminPreviewReviewEntries(activeManifest, activePlan, {
      isAdmin: true,
      simulation: true,
      privatePreview: true,
    }).find(candidate => candidate.id === storyId);
    if (!entry) throw new Error('This story is not part of the private review selection.');
    if (
      active.current_stop_id
      || active.long_form?.current_item_id
      || active.long_form?.deferred_item_id
      || active.long_form?.pending_group_item_ids.length
    ) {
      throw new Error('Finish or skip the playing story before reviewing another one.');
    }
    if (entry.mode === 'hard_auto') {
      await publishSession(startManualOriginalStop(active, entry.id));
      try {
        await playStop(entry.id);
      } catch (error) {
        await publishSession(active).catch(() => {});
        throw error;
      }
      return;
    }
    const now = Date.now();
    const longForm = ensureOriginalLongFormSession(active, activePlan, now);
    const selected = withOriginalLongFormSession(active, {
      ...longForm,
      current_item_id: entry.id,
      current_audio_position_ms: 0,
      current_selection_origin: 'user_explicit',
      pending_group_item_ids: [],
      deferred_item_id: null,
      deferred_audio_position_ms: 0,
      deferred_selection_origin: null,
      capacity_candidate: null,
      updated_at_ms: now,
    });
    await publishSession(selected);
    try {
      await playOptionalItem(entry.id, 0);
    } catch (error) {
      await publishSession(active).catch(() => {});
      throw error;
    }
  }, [dependencies.access, playOptionalItem, playStop, publishSession]);

  const endPrivateReview = useCallback(() => {
    if (privateReviewCleanupPromiseRef.current) return privateReviewCleanupPromiseRef.current;
    const operation = (async () => {
      const currentUser = useStore.getState().user;
      if (currentUser?.id == null || stoppingRef.current) {
        throw new Error('Sign in to the account that opened this private review to clean it up.');
      }
      const currentScope = originalOwnerScopeForAccount(currentUser.id);
      const durableIdentity = await getOriginalPrivateReviewCleanupIdentity();
      let identity = durableIdentity
        ? runtimePrivateReviewIdentity(durableIdentity)
        : privateReviewCleanupIdentityRef.current;
      if (identity) {
        if (identity.ownerScope !== currentScope) {
          throw new Error('Sign back in to the account that opened this private review.');
        }
        if (
          durableIdentity
          && privateReviewCleanupIdentityRef.current
          && !samePrivateReviewIdentity(identity, privateReviewCleanupIdentityRef.current)
        ) throw new Error('The pending private review cleanup identity changed; nothing was removed.');
        if (!durableIdentity) {
          await saveOriginalPrivateReviewCleanupIdentity(storedPrivateReviewIdentity(identity));
        }
      } else {
        const active = sessionRef.current;
        const activeManifest = manifestRef.current;
        const activeIdentity = privateReviewIdentityRef.current;
        if (
          !currentUser.is_admin
          || !simulationRef.current
          || !active
          || !activeManifest
          || !activeIdentity
          || activeIdentity.ownerScope !== currentScope
          || active.owner_scope !== activeIdentity.ownerScope
          || active.pack_id !== activeIdentity.packId
          || active.version !== activeIdentity.version
          || active.manifest_id !== activeIdentity.manifestId
          || activeManifest.manifest_id !== activeIdentity.manifestId
        ) throw new Error('No exact admin private review is active.');
        const access = await dependencies.access.get(
          activeIdentity.ownerScope,
          activeIdentity.packId,
          activeIdentity.version,
        );
        if (
          originalOwnerScopeForAccount(useStore.getState().user?.id ?? null) !== activeIdentity.ownerScope
          || !useStore.getState().user?.is_admin
          || access?.access_type !== 'admin_preview'
          || access.manifest_id !== activeIdentity.manifestId
        ) {
          throw new Error('The active bundle is not the exact private preview; nothing was removed.');
        }
        identity = activeIdentity;
        await saveOriginalPrivateReviewCleanupIdentity(storedPrivateReviewIdentity(identity));
      }
      privateReviewCleanupIdentityRef.current = identity;
      if (mountedRef.current) {
        setPrivateReviewActive(false);
        setPrivateReviewCleanupPending(true);
      }
      await clearOriginalPreviewAccessStrict();
      if (simulationRef.current || sessionRef.current) await stopTour();
      await dependencies.bundles.removePrivatePreview(
        identity.ownerScope,
        identity.packId,
        identity.version,
        identity.manifestId,
      );
      await dependencies.access.removeAdminPreview(
        identity.ownerScope,
        identity.packId,
        identity.version,
        identity.manifestId,
      );
      await clearOriginalPrivateReviewCleanupIdentityStrict(storedPrivateReviewIdentity(identity));
      privateReviewCleanupIdentityRef.current = null;
      privateReviewIdentityRef.current = null;
      if (mountedRef.current) {
        setPrivateReviewActive(false);
        setPrivateReviewCleanupPending(false);
      }
    })();
    privateReviewCleanupPromiseRef.current = operation;
    const clear = () => {
      if (privateReviewCleanupPromiseRef.current === operation) {
        privateReviewCleanupPromiseRef.current = null;
      }
    };
    operation.then(clear, clear);
    return operation;
  }, [dependencies.access, dependencies.bundles, stopTour]);

  useEffect(() => {
    let cancelled = false;
    void getOriginalPrivateReviewCleanupIdentity().then(async pending => {
      if (cancelled || !pending) return;
      const currentUser = useStore.getState().user;
      if (
        currentUser?.id == null
        || originalOwnerScopeForAccount(currentUser.id) !== pending.owner_scope
      ) return;
      const identity = runtimePrivateReviewIdentity(pending);
      privateReviewCleanupIdentityRef.current = identity;
      if (mountedRef.current) {
        setPrivateReviewActive(false);
        setPrivateReviewCleanupPending(true);
      }
      await endPrivateReview();
    }).catch(caught => {
      if (cancelled || !mountedRef.current) return;
      setError(caught instanceof Error
        ? caught.message
        : 'The pending private review cleanup needs attention.');
      setState('error');
    });
    return () => { cancelled = true; };
  }, [endPrivateReview, userId]);

  const skipCurrentStory = useCallback(async () => {
    const active = sessionRef.current;
    const activeManifest = manifestRef.current;
    const activePlan = selectablePlanRef.current;
    const optionalId = active?.long_form?.current_item_id;
    if (
      active
      && activePlan
      && optionalId
      && simulationRef.current
      && useStore.getState().user?.is_admin
      && !stoppingRef.current
    ) {
      const generation = trackingGenerationRef.current;
      await dependencies.audio.stop();
      await dependencies.audio.unload();
      await releaseAudio();
      if (
        stoppingRef.current
        || generation !== trackingGenerationRef.current
        || sessionRef.current?.session_id !== active.session_id
      ) return;
      const next = completeOriginalLongFormItem(active, activePlan, optionalId);
      await publishSession(next);
      if (originalAudioCoordinator.activeOwner() == null) {
        await dependencies.audio.releaseSession().catch(() => {});
      }
      if (mountedRef.current) setState(next.status === 'completed' ? 'completed' : 'tracking');
      return;
    }
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
    const promotion = promoteNextOriginalStop(next);
    next = promotion.session;
    const queued = promotion.promoted_stop_id;
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
    else {
      if (originalAudioCoordinator.activeOwner() == null) {
        await dependencies.audio.releaseSession().catch(() => {});
      }
      if (next.status === 'completed') {
        await stopLocation();
        if (mountedRef.current) setState('completed');
      }
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

  const playLongFormItem = useCallback(async (
    itemId: string,
    options: { userConfirmedParked?: boolean },
  ) => {
    const active = sessionRef.current;
    const plan = selectablePlanRef.current;
    if (!active || !plan || stoppingRef.current) {
      throw new Error('No Trailhead Original story is ready.');
    }
    const item = plan.items.find(value => value.id === itemId);
    if (!item) throw new Error('This story is not part of the selected route.');
    const latestSample = lastLocationSampleRef.current;
    const withinLandmarkRadius = originalLongFormLandmarkFixIsEligible(
      item,
      latestSample,
      Date.now(),
    );
    const eligibility = {
      user_confirmed_parked: options.userConfirmedParked === true,
      before_route_context_active: originalLongFormBeforeRouteContextIsActive(active),
      within_landmark_radius: withinLandmarkRadius,
      route_completed: active.status === 'completed'
        && active.completed_at_ms != null,
    };
    const result = active.long_form?.completed_item_ids.includes(itemId)
      ? replayOriginalLongFormItem(plan, active, itemId, eligibility)
      : selectOriginalLongFormItem(plan, active, itemId, eligibility);
    if (!result.ok) {
      const messages: Record<typeof result.code, string> = {
        already_complete: 'This story is already complete.',
        audio_busy: 'Finish the playing story before starting another one.',
        not_available_here: 'This story is not available from the current stop.',
        not_complete: 'This story has not finished yet.',
        parked_confirmation_required: 'Confirm that you are parked before playing this story.',
        route_completion_required: 'This story becomes available after the route is complete.',
        unknown_item: 'This story is not part of the selected route.',
      };
      throw new Error(messages[result.code]);
    }
    await publishSession(result.session);
    await playOptionalItem(item.id, 0);
  }, [playOptionalItem, publishSession]);

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
    const { ownerScope } = await requireCurrentAccess(
      active.pack_id,
      active.version,
      active.owner_scope,
      simulationRef.current,
      activeManifest.manifest_id,
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
    const plan = selectablePlanRef.current;
    await publishSession(active.long_form?.current_item_id && plan
      ? updateOriginalLongFormAudioPosition(active, plan, positionMs)
      : {
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

  const acquireOriginal = useCallback(async (
    id: string,
    version: number,
    idempotencyKey?: string,
    accessMode: OriginalAccessMode = 'permanent',
  ) => {
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
      accessMode,
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
    // The explicit active pointer is authoritative. Once End tour clears it,
    // never infer a resumable drive from historical session files.
    if (!deviceActive) return null;
    const latestForScope = deviceActive.owner_scope === ownerScope
      ? deviceActive
      : (await dependencies.sessions.list(ownerScope))
        .sort((a, b) => b.updated_at_ms - a.updated_at_ms)[0] ?? null;
    // A stopped session is an explicit restore barrier. Do not skip over it
    // and resurrect an older paused drive after the user chose End tour.
    if (latestForScope?.status === 'stopped') {
      // Do not mutate app/car state from an asynchronous restore read: a newer
      // Start action may already have replaced this stopped session.
      return null;
    }
    const active = latestForScope;
    if (!active || !scopeIsStillCurrent()) return null;
    const access = await dependencies.access.get(ownerScope, active.pack_id, active.version);
    const accessAllowed = access?.owner_scope === ownerScope
      && originalLocalAccessIsCurrent(access, undefined, { manifestId: active.manifest_id });
    if (!accessAllowed || !scopeIsStillCurrent()) return null;
    const [storedManifest, restoredBundle, verified] = await Promise.all([
      dependencies.bundles.loadManifest(ownerScope, active.pack_id, active.version, false),
      dependencies.bundles.get(ownerScope, active.pack_id, active.version),
      dependencies.bundles.verify(ownerScope, active.pack_id, active.version),
    ]);
    if (!storedManifest || !restoredBundle || !mountedRef.current || !scopeIsStillCurrent()) return null;
    let restoredManifest: OriginalManifestV1;
    let restoredSelectablePlan: OriginalSelectablePlaybackPlanV1 | null = null;
    let restoredSession = active;
    try {
      const playback = resolveOriginalManifestPlaybackForSession(storedManifest, active);
      restoredManifest = playback.manifest;
      if (playback.source_schema_version === 3) {
        restoredSelectablePlan = playback.selectable;
        restoredSession = withOriginalLongFormSession(
          active,
          ensureOriginalLongFormSession(active, playback.selectable),
        );
      }
    } catch {
      return null;
    }
    if (!verified) {
      const corrupt = {
        ...restoredSession,
        status: 'paused' as const,
        download_state: 'corrupt' as const,
        updated_at_ms: Date.now(),
      };
      if (!scopeIsStillCurrent()) return null;
      sessionRef.current = corrupt;
      manifestRef.current = restoredManifest;
      selectablePlanRef.current = restoredSelectablePlan;
      bundleRef.current = restoredBundle;
      setSession(corrupt);
      setManifest(restoredManifest);
      setSelectablePlan(restoredSelectablePlan);
      setBundle(restoredBundle);
      setError('This offline download is incomplete or corrupt. Download it again before resuming.');
      setState('error');
      await dependencies.sessions.save(corrupt);
      return corrupt;
    }
    const normalizedActive = normalizeCompletedOriginalSession(
      restoredSession,
      restoredManifest.stops.map(stop => stop.id),
    );
    let resumable: OriginalSessionV1 = { ...normalizedActive, download_state: 'ready' };
    if (normalizedActive.status === 'active') {
      // A cold TaskManager runtime may still own native location/audio when the
      // foreground app is opened. Quiesce both adapters and persist the exact
      // position before presenting the durable Resume state.
      await dependencies.location.stopActive().catch(() => {});
      const audioState = await dependencies.audio.getState().catch(() => null);
      await dependencies.audio.pause().catch(() => {});
      await dependencies.audio.unload().catch(() => {});
      await originalAudioCoordinator.release('trailhead-originals').catch(() => {});
      const paused: OriginalSessionV1 = {
        ...resumable,
        status: 'paused',
        user_paused: false,
        current_audio_position_ms: audioState?.loaded
          ? Math.max(0, audioState.position_ms)
          : normalizedActive.current_audio_position_ms,
        updated_at_ms: Date.now(),
      };
      resumable = normalizedActive.long_form?.current_item_id
        && restoredSelectablePlan
        && audioState?.loaded
        ? updateOriginalLongFormAudioPosition(
          paused,
          restoredSelectablePlan,
          audioState.position_ms,
        )
        : paused;
    }
    if (!scopeIsStillCurrent()) return null;
    sessionRef.current = resumable;
    manifestRef.current = restoredManifest;
    selectablePlanRef.current = restoredSelectablePlan;
    lastLocationSampleRef.current = null;
    bundleRef.current = restoredBundle;
    setSession(resumable);
    setManifest(restoredManifest);
    setSelectablePlan(restoredSelectablePlan);
    setBundle(restoredBundle);
    setState(resumable.status === 'completed' ? 'completed' : 'ready');
    if (resumable !== active) await dependencies.sessions.setActive(resumable);
    if (resumable.status !== 'stopped') await syncOriginalDriveToCar(restoredManifest).catch(() => {});
    return resumable;
  }, [dependencies.access, dependencies.audio, dependencies.bundles, dependencies.location, dependencies.sessions]);

  const reconcilePersistedSessionForScope = useCallback(async (ownerScope: OriginalOwnerScope) => {
    const reconcileEpoch = accountStorage.epoch();
    const scopeIsStillCurrent = () => originalRestoreScopeIsCurrent(
      ownerScope,
      reconcileEpoch,
      accountStorage.epoch(),
      useStore.getState().user?.id ?? null,
    );
    const current = sessionRef.current;
    if (!current || current.owner_scope !== ownerScope) return null;
    const persisted = await dependencies.sessions.loadActive();
    if (!persisted || !scopeIsStillCurrent()) return null;
    const matchesCurrentExperience = (
      persisted.owner_scope === current.owner_scope
      && persisted.session_id === current.session_id
      && persisted.pack_id === current.pack_id
      && persisted.version === current.version
      && persisted.manifest_id === current.manifest_id
    );
    if (
      !matchesCurrentExperience
      || persisted.status === 'stopped'
      || persisted.updated_at_ms <= current.updated_at_ms
    ) return null;
    const reconciled = manifestRef.current
      ? normalizeCompletedOriginalSession(
        persisted,
        manifestRef.current.stops.map(stop => stop.id),
      )
      : persisted;
    sessionRef.current = reconciled;
    if (mountedRef.current) {
      setSession(reconciled);
      setState(
        reconciled.status === 'completed'
          ? 'completed'
          : reconciled.status === 'paused'
            ? reconciled.user_paused ? 'paused' : 'ready'
            : reconciled.status === 'active'
              ? 'tracking'
              : 'ready',
      );
    }
    if (reconciled !== persisted) await dependencies.sessions.setActive(reconciled);
    return reconciled;
  }, [dependencies.sessions]);

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
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState !== 'active') return;
      void reconcilePersistedSessionForScope(
        originalOwnerScopeForAccount(useStore.getState().user?.id ?? null),
      ).catch(() => {});
    });
    return () => subscription.remove();
  }, [reconcilePersistedSessionForScope]);

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
    selectablePlan,
    bundle,
    downloadProgress,
    error,
    muted,
    simulation,
    lastTriggerEvaluation,
    audioPlaybackState,
    audioCapabilities: dependencies.audio.capabilities,
    downloadOriginal,
    startTour: (value, selection) => activateTour(value, false, false, selection),
    restartTour: (value, selection) => activateTour(value, true, false, selection),
    pauseTour,
    resumeTour,
    stopTour,
    skipCurrentStory,
    replayStory,
    playLongFormItem,
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
    selectablePlan,
    migrateGuestToAccount,
    muted,
    simulation,
    pauseTour,
    playLongFormItem,
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
    privateReviewActive,
    privateReviewCleanupPending,
    startSimulation: (value, selection) => {
      if (!useStore.getState().user?.is_admin) {
        return Promise.reject(new Error('The Virtual Drive Lab is available only to Trailhead admins.'));
      }
      return activateTour(value, true, true, selection);
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
    reviewPreviewStory,
    endPrivateReview,
  }), [
    activateTour,
    clearSimulationDiagnostic,
    endPrivateReview,
    privateReviewActive,
    privateReviewCleanupPending,
    reviewPreviewStory,
    skipSimulationCue,
    submitLocationSample,
  ]);

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
