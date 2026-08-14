import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePreventRemove } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/design';
import {
  originalAdminPreviewExitAction,
  originalAdminPreviewReviewEntries,
  originalAdminPreviewRenderableReviewEntries,
  originalSimulationSamplesForNextCue,
  originalVirtualDriveCueResultOutcome,
  runOriginalRouteValidation,
  useOriginalsAdminRuntime,
  useOriginalsRuntime,
  type OriginalRouteValidationReportV1,
  type OriginalAdminPreviewExitSurface,
  type OriginalAdminPreviewReviewEntry,
  type OriginalAdminPreviewRenderableReviewEntry,
  type OriginalSessionV1,
  type OriginalStopV1,
  type OriginalTriggerDecisionDiagnostic,
} from '@/lib/originals';
import { useStore } from '@/lib/store';
import {
  getOriginalDetail,
  manifestStories,
  originalSessionToUi,
  selectableManifestItemStory,
  selectOriginalUiChapter,
} from '@/components/originals/originalsUiService';
import OriginalRouteMap from '@/components/originals/OriginalRouteMap';
import OriginalFeedbackSheet from '@/components/originals/OriginalFeedbackSheet';
import type { OriginalUiDetail, OriginalUiSession } from '@/components/originals/types';
import {
  consumerOriginalPlayerShouldRedirect,
  originalStartDestination,
} from '@/lib/originals/mainMapNavigation';
import {
  createOriginalVirtualDriveLabState,
  nextOriginalVirtualDriveCueProgress,
  ORIGINAL_VIRTUAL_DRIVE_OFF_ROUTE_M,
  ORIGINAL_VIRTUAL_DRIVE_TICK_REAL_MS,
  ORIGINAL_VIRTUAL_DRIVE_TICK_SIMULATED_MS,
  originalVirtualDriveCueStatuses,
  seekOriginalVirtualDriveLab,
  tickOriginalVirtualDriveLab,
  updateOriginalVirtualDriveLabState,
  type OriginalVirtualDriveCueStatus,
  type OriginalVirtualDriveGpsQuality,
  type OriginalVirtualDriveLabState,
} from '@/lib/originals/virtualDriveLab';

type SimulationCueResult = {
  stopId: string;
  sequence: number;
  title: string;
  outcome: 'passed' | 'failed';
  code: string;
  message: string;
  speedMps: number;
  projectedProgressM: number | null;
  authoredStartM: number;
  effectiveStartM: number;
  endM: number;
  distanceToStopM: number | null;
  enterRadiusM: number;
  actualBearingDeg: number | null;
  requiredBearingDeg: number | null;
  bearingToleranceDeg: number | null;
};

function routeParam(value: string | string[] | undefined) {
  const resolved = Array.isArray(value) ? value[0] : value;
  return resolved?.trim() || '';
}

function sessionSelectionMatchesRequest(
  selection: OriginalSessionV1['chapter_selection'] | undefined,
  requestedChapterId: string,
  requestedVariantId: string,
) {
  if (!requestedChapterId && !requestedVariantId) return selection == null;
  if (!requestedChapterId || !requestedVariantId || !selection) return false;
  return selection.chapter_id === requestedChapterId && selection.variant_id === requestedVariantId;
}

export default function OriginalPlayerScreen() {
  const C = useTheme();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    id?: string | string[];
    version?: string | string[];
    simulate?: string | string[];
    field?: string | string[];
    chapter?: string | string[];
    variant?: string | string[];
  }>();
  const id = routeParam(params.id);
  const versionValue = routeParam(params.version) || undefined;
  const requestedVersion = Number.isFinite(Number(versionValue)) ? Number(versionValue) : undefined;
  const simulateValue = routeParam(params.simulate) || undefined;
  const privateFieldValue = routeParam(params.field) || undefined;
  const requestedChapterId = routeParam(params.chapter);
  const requestedVariantId = routeParam(params.variant);
  const redirectConsumerToMainMap = consumerOriginalPlayerShouldRedirect(
    simulateValue,
    privateFieldValue,
  );
  const originalsRuntime = useOriginalsRuntime();
  const originalsAdminRuntime = useOriginalsAdminRuntime();
  const runtimeRef = useRef(originalsRuntime);
  runtimeRef.current = originalsRuntime;
  const adminRuntimeRef = useRef(originalsAdminRuntime);
  adminRuntimeRef.current = originalsAdminRuntime;
  const ownsPrivateReviewRouteRef = useRef(simulateValue === '1' || privateFieldValue === '1');
  const exitPromptVisibleRef = useRef(false);
  const [navigationAllowed, setNavigationAllowed] = useState(false);
  const accountId = useStore(state => state.user?.id ?? null);
  const ownerScope = accountId == null ? 'guest' : `account:${String(accountId)}`;
  const [detail, setDetail] = useState<OriginalUiDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [transcriptVisible, setTranscriptVisible] = useState(true);
  const [storiesVisible, setStoriesVisible] = useState(false);
  const [feedbackVisible, setFeedbackVisible] = useState(false);
  const [simulationBusy, setSimulationBusy] = useState(false);
  const [validationBusy, setValidationBusy] = useState(false);
  const [validationReport, setValidationReport] = useState<OriginalRouteValidationReportV1 | null>(null);
  const [simulationSpeedMps, setSimulationSpeedMps] = useState(12);
  const [simulationResults, setSimulationResults] = useState<SimulationCueResult[]>([]);
  const [reviewOpenedIds, setReviewOpenedIds] = useState<string[]>([]);
  const [reviewBusyId, setReviewBusyId] = useState<string | null>(null);
  const [reviewCleanupBusy, setReviewCleanupBusy] = useState(false);
  const [driveLabState, setDriveLabState] = useState<OriginalVirtualDriveLabState | null>(null);
  const [driveLabError, setDriveLabError] = useState('');
  const driveLabStateRef = useRef<OriginalVirtualDriveLabState | null>(null);
  const driveLabManifestKeyRef = useRef('');
  const driveLabTickBusyRef = useRef(false);
  const isAdmin = useStore(state => Boolean(state.user?.is_admin));
  const privateFieldActive = privateFieldValue === '1'
    && originalsAdminRuntime.privateReviewMode === 'field';
  const privateFieldDiagnostic = isAdmin && privateFieldActive
    ? originalsAdminRuntime.privateFieldDiagnostic
    : null;
  const runtimeManifest = originalsRuntime.manifest;
  const runtimeSession = originalsRuntime.session;
  const runtimeMatchesRequest = Boolean(
    runtimeManifest
    && runtimeSession
    && runtimeSession.owner_scope === ownerScope
    && runtimeSession.pack_id === runtimeManifest.pack_id
    && runtimeSession.version === runtimeManifest.version
    && runtimeSession.manifest_id === runtimeManifest.manifest_id
    && runtimeSession.download_state === 'ready'
    && runtimeSession.status !== 'stopped'
    && (!id || runtimeManifest.pack_id === id)
    && (requestedVersion == null || runtimeManifest.version === requestedVersion)
    && sessionSelectionMatchesRequest(
      runtimeSession.chapter_selection,
      requestedChapterId,
      requestedVariantId,
    )
  );
  const detailRequestParams = useMemo(() => ({
    id,
    ...(requestedVersion == null ? {} : { version: String(requestedVersion) }),
    ...(requestedChapterId ? { chapter: requestedChapterId } : {}),
    ...(requestedVariantId ? { variant: requestedVariantId } : {}),
  }), [id, requestedChapterId, requestedVariantId, requestedVersion]);
  const rawAdminReviewEntries = useMemo(() => originalAdminPreviewReviewEntries(
    originalsRuntime.manifest,
    originalsRuntime.selectablePlan,
    {
      isAdmin,
      simulation: originalsRuntime.simulation && simulateValue === '1',
      privatePreview: originalsAdminRuntime.privateReviewActive,
    },
  ), [
    isAdmin,
    originalsAdminRuntime.privateReviewActive,
    originalsRuntime.manifest,
    originalsRuntime.selectablePlan,
    originalsRuntime.simulation,
    simulateValue,
  ]);
  const adminReviewResolution = useMemo(() => {
    try {
      return {
        entries: originalAdminPreviewRenderableReviewEntries(
          rawAdminReviewEntries,
          originalsRuntime.bundle?.assets,
        ),
        error: '',
      };
    } catch (caught) {
      return {
        entries: [] as OriginalAdminPreviewRenderableReviewEntry[],
        error: caught instanceof Error
          ? caught.message
          : 'The approved private review artwork could not be verified.',
      };
    }
  }, [originalsRuntime.bundle?.assets, rawAdminReviewEntries]);
  const adminReviewEntries = adminReviewResolution.entries;

  useEffect(() => {
    if (!redirectConsumerToMainMap) return;
    if (runtimeMatchesRequest && runtimeManifest) {
      router.replace(originalStartDestination(runtimeManifest.pack_id, runtimeManifest.version) as any);
      return;
    }
    router.replace(
      id
        ? { pathname: '/originals/[id]', params: detailRequestParams } as any
        : '/originals' as any,
    );
  }, [
    detailRequestParams,
    id,
    redirectConsumerToMainMap,
    router,
    runtimeManifest,
    runtimeMatchesRequest,
  ]);

  useEffect(() => () => {
    if (
      ownsPrivateReviewRouteRef.current
      && (
        runtimeRef.current.simulation
        || adminRuntimeRef.current.privateReviewMode === 'field'
        || adminRuntimeRef.current.privateReviewActive
        || adminRuntimeRef.current.privateReviewCleanupPending
      )
    ) {
      if (
        adminRuntimeRef.current.privateReviewActive
        || adminRuntimeRef.current.privateReviewMode === 'field'
        || adminRuntimeRef.current.privateReviewCleanupPending
      ) {
        void adminRuntimeRef.current.endPrivateReview().catch(() => {});
      } else {
        void runtimeRef.current.stopTour().catch(() => {});
      }
    }
  }, []);

  const commitDriveLabState = useCallback((next: OriginalVirtualDriveLabState | null) => {
    driveLabStateRef.current = next;
    setDriveLabState(next);
  }, []);

  useEffect(() => {
    const manifest = originalsRuntime.manifest;
    const activeSession = originalsRuntime.session;
    if (!originalsRuntime.simulation || !isAdmin || !manifest || !activeSession || !runtimeMatchesRequest) {
      driveLabManifestKeyRef.current = '';
      commitDriveLabState(null);
      return;
    }
    const selection = activeSession.chapter_selection;
    const manifestKey = selection
      ? `${manifest.manifest_id}:${manifest.version}:${encodeURIComponent(selection.chapter_id)}:${encodeURIComponent(selection.variant_id)}`
      : `${manifest.manifest_id}:${manifest.version}`;
    if (driveLabManifestKeyRef.current === manifestKey && driveLabStateRef.current) return;
    driveLabManifestKeyRef.current = manifestKey;
    commitDriveLabState(createOriginalVirtualDriveLabState(manifest, {
      progress_m: activeSession?.last_projected_route_progress_m ?? 0,
      speed_mps: simulationSpeedMps,
      synthetic_timestamp_ms: Math.max(
        Date.now(),
        Number(activeSession?.last_location_timestamp_ms ?? activeSession?.updated_at_ms ?? 0) + 1_000,
      ),
    }));
    setSimulationResults([]);
    setReviewOpenedIds([]);
    setValidationReport(null);
    setDriveLabError('');
  }, [
    commitDriveLabState,
    isAdmin,
    originalsRuntime.manifest,
    originalsRuntime.session,
    originalsRuntime.simulation,
    runtimeMatchesRequest,
    simulationSpeedMps,
  ]);

  useEffect(() => {
    if (originalsAdminRuntime.privateReviewMode == null || isAdmin) return;
    commitDriveLabState(null);
    const action = originalAdminPreviewExitAction('privilege_loss', {
      privateReviewActive: originalsAdminRuntime.privateReviewActive
        || originalsAdminRuntime.privateReviewMode === 'field',
      cleanupPending: originalsAdminRuntime.privateReviewCleanupPending,
    });
    if (action === 'exact_private_cleanup') {
      void originalsAdminRuntime.endPrivateReview().catch(() => {});
    } else {
      void originalsRuntime.stopTour().catch(() => {});
    }
  }, [
    commitDriveLabState,
    isAdmin,
    originalsAdminRuntime.endPrivateReview,
    originalsAdminRuntime.privateReviewActive,
    originalsAdminRuntime.privateReviewCleanupPending,
    originalsAdminRuntime.privateReviewMode,
    originalsRuntime.simulation,
    originalsRuntime.stopTour,
  ]);

  useEffect(() => {
    if (!originalsRuntime.simulation || !isAdmin || !driveLabState?.playing) return;
    const timer = setInterval(() => {
      if (driveLabTickBusyRef.current) return;
      const manifest = runtimeRef.current.manifest;
      const current = driveLabStateRef.current;
      if (!manifest || !current?.playing || !runtimeRef.current.simulation) return;
      const sessionTimestamp = Number(runtimeRef.current.session?.last_location_timestamp_ms ?? 0);
      const synchronized = sessionTimestamp >= current.synthetic_timestamp_ms
        ? { ...current, synthetic_timestamp_ms: sessionTimestamp + 1 }
        : current;
      let tick;
      try {
        tick = tickOriginalVirtualDriveLab(
          manifest,
          synchronized,
          ORIGINAL_VIRTUAL_DRIVE_TICK_SIMULATED_MS,
        );
      } catch (error: any) {
        commitDriveLabState({ ...current, playing: false });
        setDriveLabError(error?.message || 'The synthetic route clock could not advance.');
        return;
      }
      commitDriveLabState(tick.state);
      if (!tick.sample) return;
      driveLabTickBusyRef.current = true;
      void originalsAdminRuntime.submitLocationSample(tick.sample).catch((error: any) => {
        const latest = driveLabStateRef.current;
        if (latest) commitDriveLabState({ ...latest, playing: false });
        setDriveLabError(error?.message || 'The synthetic GPS sample could not be processed.');
      }).finally(() => {
        driveLabTickBusyRef.current = false;
      });
    }, ORIGINAL_VIRTUAL_DRIVE_TICK_REAL_MS);
    return () => clearInterval(timer);
  }, [commitDriveLabState, driveLabState?.playing, isAdmin, originalsAdminRuntime, originalsRuntime.simulation]);

  useEffect(() => {
    const evaluation = originalsRuntime.lastTriggerEvaluation;
    const decision = evaluation?.decision;
    const manifest = originalsRuntime.manifest;
    if (!originalsRuntime.simulation || !decision?.stop_id || !manifest) return;
    const outcome = originalVirtualDriveCueResultOutcome(decision.code);
    if (!outcome) return;
    const stop = manifest.stops.find(item => item.id === decision.stop_id);
    if (!stop) return;
    const result: SimulationCueResult = {
      stopId: stop.id,
      sequence: stop.sequence,
      title: stop.title,
      outcome,
      code: decision.code,
      message: decision.message,
      speedMps: simulationSpeedMps,
      projectedProgressM: decision.route.projected_progress_m,
      authoredStartM: decision.window?.authored_start_m ?? stop.trigger.route_progress_start_m,
      effectiveStartM: decision.window?.effective_start_m ?? Math.max(
        0,
        stop.trigger.route_progress_start_m - simulationSpeedMps * Math.max(0, stop.trigger.lead_time_s || 0),
      ),
      endM: decision.window?.end_m ?? stop.trigger.route_progress_end_m,
      distanceToStopM: decision.radius?.distance_to_stop_m ?? null,
      enterRadiusM: decision.radius?.enter_radius_m ?? stop.trigger.enter_radius_m,
      actualBearingDeg: decision.bearing?.actual_deg ?? null,
      requiredBearingDeg: decision.bearing?.required_deg ?? stop.trigger.approach_bearing_deg ?? null,
      bearingToleranceDeg: decision.bearing?.tolerance_deg ?? stop.trigger.bearing_tolerance_deg ?? null,
    };
    setSimulationResults(current => [
      ...current.filter(item => item.stopId !== result.stopId),
      result,
    ].sort((a, b) => a.sequence - b.sequence));
  }, [originalsRuntime.lastTriggerEvaluation, originalsRuntime.manifest, originalsRuntime.simulation, simulationSpeedMps]);

  useEffect(() => {
    let cancelled = false;
    void getOriginalDetail(id, requestedVersion).then(nextDetail => {
      if (cancelled) return;
      setDetail(
        requestedChapterId && requestedVariantId
          ? selectOriginalUiChapter(nextDetail, requestedChapterId, requestedVariantId)
          : nextDetail,
      );
    }).catch(() => {}).finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [id, requestedChapterId, requestedVariantId, requestedVersion]);

  const session = useMemo(() => {
    if (!originalsRuntime.session || !originalsRuntime.manifest || !runtimeMatchesRequest) return null;
    return originalSessionToUi(originalsRuntime.session, originalsRuntime.manifest, originalsRuntime.muted);
  }, [originalsRuntime.manifest, originalsRuntime.muted, originalsRuntime.session, runtimeMatchesRequest]);

  const playerDetail = useMemo(() => {
    if (
      !detail
      || !originalsRuntime.manifest
      || !runtimeMatchesRequest
    ) return detail;
    const hardStories = manifestStories(originalsRuntime.manifest, originalsRuntime.session);
    const stories = adminReviewEntries.length
      ? adminReviewEntries.map(entry => (
        entry.mode === 'hard_auto'
          ? hardStories.find(story => story.id === entry.id)!
          : selectableManifestItemStory(
            originalsRuntime.selectablePlan,
            entry.id,
            originalsRuntime.session,
          )!
      )).filter(Boolean)
      : hardStories;
    return { ...detail, stories, storyCount: stories.length };
  }, [
    adminReviewEntries,
    detail,
    originalsRuntime.manifest,
    originalsRuntime.selectablePlan,
    originalsRuntime.session,
    runtimeMatchesRequest,
  ]);

  const togglePause = useCallback(async () => {
    if (!session) return;
    if (session.userPaused || originalsRuntime.state === 'paused') await originalsRuntime.resumeTour();
    else await originalsRuntime.pauseTour();
  }, [originalsRuntime, session]);

  useEffect(() => {
    if (originalsRuntime.simulation) setTranscriptVisible(false);
  }, [originalsRuntime.simulation]);

  const finishSimulationExit = useCallback((navigateAfterStop?: () => void) => {
    setNavigationAllowed(true);
    ownsPrivateReviewRouteRef.current = false;
    void originalsRuntime.stopTour().catch(() => {}).finally(() => {
      requestAnimationFrame(() => {
        if (navigateAfterStop) navigateAfterStop();
        else router.replace('/originals' as any);
      });
    });
  }, [originalsRuntime, router]);

  const closePlayer = useCallback(() => {
    if (!originalsRuntime.simulation) {
      router.replace('/(tabs)/map' as any);
      return;
    }
    finishSimulationExit();
  }, [finishSimulationExit, originalsRuntime.simulation, router]);

  const requestPrivateReviewCleanup = useCallback((navigateAfterCleanup?: () => void) => {
    if (reviewCleanupBusy || exitPromptVisibleRef.current) return;
    exitPromptVisibleRef.current = true;
    const pending = originalsAdminRuntime.privateReviewCleanupPending;
    Alert.alert(
      pending ? 'Finish private review cleanup?' : 'End private review?',
      'This removes only this private revision, its downloaded assets and offline map, and the preview credential from this device.',
      [
        {
          text: pending ? 'Stay here' : 'Keep reviewing',
          style: 'cancel',
          onPress: () => { exitPromptVisibleRef.current = false; },
        },
        {
          text: pending ? 'Retry cleanup' : 'End private review',
          style: 'destructive',
          onPress: () => {
            exitPromptVisibleRef.current = false;
            setReviewCleanupBusy(true);
            void originalsAdminRuntime.endPrivateReview()
              .then(() => {
                setNavigationAllowed(true);
                ownsPrivateReviewRouteRef.current = false;
                requestAnimationFrame(() => {
                  if (navigateAfterCleanup) navigateAfterCleanup();
                  else router.replace('/originals' as any);
                });
              })
              .catch((error: any) => {
                Alert.alert(
                  'Private review cleanup needs attention',
                  error?.message || 'The exact private review could not be fully removed.',
                );
              })
              .finally(() => setReviewCleanupBusy(false));
          },
        },
      ],
      {
        cancelable: true,
        onDismiss: () => { exitPromptVisibleRef.current = false; },
      },
    );
  }, [originalsAdminRuntime, reviewCleanupBusy, router]);

  const requestClosePlayer = useCallback((
    surface: OriginalAdminPreviewExitSurface,
    navigateAfterStop?: () => void,
  ) => {
    if (originalAdminPreviewExitAction(surface, {
      privateReviewActive: originalsAdminRuntime.privateReviewActive
        || originalsAdminRuntime.privateReviewMode === 'field',
      cleanupPending: originalsAdminRuntime.privateReviewCleanupPending,
    }) === 'exact_private_cleanup') {
      requestPrivateReviewCleanup(navigateAfterStop);
      return;
    }
    if (!originalsRuntime.simulation) {
      if (navigateAfterStop) navigateAfterStop();
      else closePlayer();
      return;
    }
    if (exitPromptVisibleRef.current) return;
    exitPromptVisibleRef.current = true;
    Alert.alert(
      'End trigger test?',
      'The per-story test report is temporary. Synthetic progress will be discarded and your saved drive stays unchanged.',
      [
        {
          text: 'Keep testing',
          style: 'cancel',
          onPress: () => { exitPromptVisibleRef.current = false; },
        },
        {
          text: 'End test',
          style: 'destructive',
          onPress: () => {
            exitPromptVisibleRef.current = false;
            finishSimulationExit(navigateAfterStop);
          },
        },
      ],
      {
        cancelable: true,
        onDismiss: () => { exitPromptVisibleRef.current = false; },
      },
    );
  }, [
    closePlayer,
    finishSimulationExit,
    originalsAdminRuntime.privateReviewActive,
    originalsAdminRuntime.privateReviewCleanupPending,
    originalsAdminRuntime.privateReviewMode,
    originalsRuntime.simulation,
    requestPrivateReviewCleanup,
  ]);

  usePreventRemove(
    (simulateValue === '1' || privateFieldValue === '1') && !navigationAllowed,
    ({ data }) => {
    requestClosePlayer('android_back', () => navigation.dispatch(data.action));
    },
  );

  const runSimulation = useCallback(async (scenario: 'trigger' | 'poor_accuracy' | 'off_route') => {
    const manifest = originalsRuntime.manifest;
    const activeSession = originalsRuntime.session;
    if (!originalsRuntime.simulation || !manifest || !activeSession || simulationBusy) return;
    setSimulationBusy(true);
    try {
      const plan = originalSimulationSamplesForNextCue(manifest, activeSession, {
        start_timestamp_ms: Math.max(Date.now(), activeSession.updated_at_ms + 1_000),
        speed_mps: simulationSpeedMps,
      });
      if (!plan) {
        Alert.alert('Trigger test complete', 'There are no remaining cue windows in this simulation.');
        return;
      }
      if (scenario === 'poor_accuracy') {
        await originalsAdminRuntime.submitLocationSample({ ...plan.samples[0], accuracy_m: 150 });
      } else if (scenario === 'off_route') {
        await originalsAdminRuntime.submitLocationSample({
          ...plan.samples[0],
          lat: plan.samples[0].lat + 0.03,
          lng: plan.samples[0].lng + 0.03,
        });
      } else {
        for (const sample of plan.samples) await originalsAdminRuntime.submitLocationSample(sample);
      }
    } catch (error: any) {
      Alert.alert('Trigger test failed', error?.message || 'The synthetic GPS sample could not be processed.');
    } finally {
      setSimulationBusy(false);
    }
  }, [originalsAdminRuntime, originalsRuntime, simulationBusy, simulationSpeedMps]);

  const advanceSimulationCue = useCallback(async () => {
    if (simulationBusy) return;
    setSimulationBusy(true);
    try {
      await originalsAdminRuntime.skipSimulationCue();
    } catch (error: any) {
      Alert.alert('Cue could not be advanced', error?.message || 'Finish the playing story and try again.');
    } finally {
      setSimulationBusy(false);
    }
  }, [originalsAdminRuntime, simulationBusy]);

  const runValidationMatrix = useCallback(async () => {
    const manifest = originalsRuntime.manifest;
    if (!originalsRuntime.simulation || !manifest || validationBusy) return;
    setValidationBusy(true);
    try {
      // Let the loading state paint before the deterministic CPU-bound run begins.
      await new Promise(resolve => setTimeout(resolve, 16));
      setValidationReport(runOriginalRouteValidation(manifest));
    } catch (error: any) {
      Alert.alert('Virtual drive could not run', error?.message || 'The route validation matrix could not be completed.');
    } finally {
      setValidationBusy(false);
    }
  }, [originalsRuntime.manifest, originalsRuntime.simulation, validationBusy]);

  const reviewStory = useCallback(async (entry: OriginalAdminPreviewReviewEntry) => {
    if (reviewBusyId) return;
    setReviewBusyId(entry.id);
    try {
      await originalsAdminRuntime.reviewPreviewStory(entry.id);
      setReviewOpenedIds(current => current.includes(entry.id) ? current : [...current, entry.id]);
      setStoriesVisible(false);
    } catch (error: any) {
      Alert.alert('Story review could not start', error?.message || 'Finish the playing story and try again.');
    } finally {
      setReviewBusyId(null);
    }
  }, [originalsAdminRuntime, reviewBusyId]);

  const optionalCurrentStory = selectableManifestItemStory(
    originalsRuntime.selectablePlan,
    originalsRuntime.session?.long_form?.current_item_id,
    originalsRuntime.session,
  );
  const currentStory = optionalCurrentStory || session?.currentStory || session?.nextStory || playerDetail?.stories[0];
  const storyIsPlaying = Boolean(optionalCurrentStory || session?.currentStory);
  const nextStop = useMemo(() => {
    if (!originalsRuntime.manifest || originalsRuntime.manifest.pack_id !== id) return null;
    const nextId = session?.nextStory?.id;
    return nextId ? originalsRuntime.manifest.stops.find(stop => stop.id === nextId) ?? null : null;
  }, [id, originalsRuntime.manifest, session?.nextStory?.id]);
  const diagnosticStop = useMemo(() => {
    const stopId = originalsRuntime.lastTriggerEvaluation?.decision.stop_id;
    if (!stopId || !originalsRuntime.manifest) return null;
    return originalsRuntime.manifest.stops.find(stop => stop.id === stopId) ?? null;
  }, [originalsRuntime.lastTriggerEvaluation?.decision.stop_id, originalsRuntime.manifest]);
  const canAdvanceFailedCue = Boolean(
    !session?.currentStory
    && nextStop
    && originalsRuntime.lastTriggerEvaluation?.decision.stop_id === nextStop.id
    && originalVirtualDriveCueResultOutcome(
      originalsRuntime.lastTriggerEvaluation.decision.code,
    ) === 'failed'
  );
  const changeSimulationSpeed = useCallback((value: number) => {
    originalsAdminRuntime.clearSimulationDiagnostic();
    setSimulationSpeedMps(value);
    const manifest = runtimeRef.current.manifest;
    const current = driveLabStateRef.current;
    if (manifest && current && runtimeRef.current.simulation && isAdmin) {
      commitDriveLabState(updateOriginalVirtualDriveLabState(manifest, current, {
        speed_mps: value,
      }));
    }
  }, [commitDriveLabState, isAdmin, originalsAdminRuntime]);
  const updateDriveLab = useCallback((patch: Partial<Pick<
    OriginalVirtualDriveLabState,
    'playing' | 'direction' | 'gps_quality' | 'off_route_m'
  >>) => {
    const manifest = runtimeRef.current.manifest;
    const current = driveLabStateRef.current;
    if (!isAdmin || !runtimeRef.current.simulation || !manifest || !current) return;
    originalsAdminRuntime.clearSimulationDiagnostic();
    commitDriveLabState(updateOriginalVirtualDriveLabState(manifest, current, patch));
    setDriveLabError('');
  }, [commitDriveLabState, isAdmin, originalsAdminRuntime]);
  const seekDriveLab = useCallback((progressM: number) => {
    const manifest = runtimeRef.current.manifest;
    const current = driveLabStateRef.current;
    if (!isAdmin || !runtimeRef.current.simulation || !manifest || !current) return;
    originalsAdminRuntime.clearSimulationDiagnostic();
    commitDriveLabState(seekOriginalVirtualDriveLab(manifest, current, progressM));
    setDriveLabError('');
  }, [commitDriveLabState, isAdmin, originalsAdminRuntime]);
  const cycleDriveLabGps = useCallback(() => {
    const current = driveLabStateRef.current;
    if (!current) return;
    const order: OriginalVirtualDriveGpsQuality[] = ['precise', 'approximate', 'poor'];
    updateDriveLab({
      gps_quality: order[(order.indexOf(current.gps_quality) + 1) % order.length],
    });
  }, [updateDriveLab]);
  const seekDriveLabToNextCue = useCallback(() => {
    const manifest = runtimeRef.current.manifest;
    const activeSession = runtimeRef.current.session;
    const current = driveLabStateRef.current;
    if (!manifest || !activeSession || !current) return;
    const progressM = nextOriginalVirtualDriveCueProgress(manifest, activeSession, current);
    if (progressM != null) seekDriveLab(progressM);
  }, [seekDriveLab]);
  const driveLabCueStatuses = useMemo<readonly OriginalVirtualDriveCueStatus[]>(() => {
    if (!originalsRuntime.manifest || !originalsRuntime.session || !driveLabState) return [];
    return originalVirtualDriveCueStatuses(
      originalsRuntime.manifest,
      originalsRuntime.session,
      driveLabState,
    );
  }, [driveLabState, originalsRuntime.manifest, originalsRuntime.session]);
  useEffect(() => {
    if (
      !driveLabStateRef.current?.playing
      || (
        originalsRuntime.session?.status !== 'completed'
        && !originalsRuntime.session?.user_paused
      )
    ) return;
    commitDriveLabState({ ...driveLabStateRef.current, playing: false });
  }, [
    commitDriveLabState,
    originalsRuntime.session?.status,
    originalsRuntime.session?.user_paused,
  ]);
  const isPaused = Boolean(session?.userPaused || session?.status === 'paused');
  const status = session?.status || 'ready';
  const needsRedownload = Boolean(
    originalsRuntime.session
    && originalsRuntime.manifest
    && originalsRuntime.session.owner_scope === ownerScope
    && originalsRuntime.session.pack_id === originalsRuntime.manifest.pack_id
    && originalsRuntime.session.pack_id === id
    && (requestedVersion == null || originalsRuntime.session.version === requestedVersion)
    && sessionSelectionMatchesRequest(
      originalsRuntime.session.chapter_selection,
      requestedChapterId,
      requestedVariantId,
    )
    && originalsRuntime.session.download_state !== 'ready'
  );

  if (redirectConsumerToMainMap) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: C.bg }] }>
        <ActivityIndicator color={C.orange} />
        <Text style={[styles.centerText, { color: C.text2 }]}>Opening this Original on the Trailhead map</Text>
      </SafeAreaView>
    );
  }

  if ((simulateValue === '1' || privateFieldValue === '1') && !isAdmin) {
    const privateCleanupRequired = (
      originalsAdminRuntime.privateReviewActive
      || originalsAdminRuntime.privateReviewMode === 'field'
      || originalsAdminRuntime.privateReviewCleanupPending
    );
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: C.bg }] }>
        <Ionicons name="lock-closed-outline" size={34} color={C.orange} />
        <Text style={[styles.centerText, { color: C.text2 }]}>
          {privateCleanupRequired
            ? 'Admin access changed. Private playback is locked, but this exact local review can still be removed.'
            : 'Private draft testing is available only to Trailhead admins.'}
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => privateCleanupRequired
            ? requestPrivateReviewCleanup()
            : router.replace('/originals' as any)}
          style={[styles.recoveryButton, { borderColor: privateCleanupRequired ? C.red : C.border }]}
        >
          <Text style={[styles.recoveryText, { color: privateCleanupRequired ? C.red : C.orange }]}>
            {privateCleanupRequired ? 'Remove private review' : 'Back to Originals'}
          </Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (originalsAdminRuntime.privateReviewCleanupPending) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: C.bg }] }>
        <Ionicons name="shield-checkmark-outline" size={34} color={C.orange} />
        <Text style={[styles.centerText, { color: C.text2 }]}>Finish removing the preview credential and this exact private revision from the device.</Text>
        <TouchableOpacity
          testID="originals.private-review.retry-cleanup"
          accessibilityRole="button"
          accessibilityLabel="Retry exact private review cleanup"
          disabled={reviewCleanupBusy}
          onPress={() => requestPrivateReviewCleanup()}
          style={[styles.recoveryButton, { borderColor: C.red, opacity: reviewCleanupBusy ? 0.55 : 1 }]}
        >
          {reviewCleanupBusy ? <ActivityIndicator size="small" color={C.red} /> : null}
          <Text style={[styles.recoveryText, { color: C.red }]}>Retry exact cleanup</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (
    originalsRuntime.simulation
    &&
    originalsAdminRuntime.privateReviewActive
    && runtimeMatchesRequest
    && (adminReviewResolution.error || !rawAdminReviewEntries.length)
  ) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: C.bg }] }>
        <Ionicons name="images-outline" size={34} color={C.orange} />
        <Text style={[styles.centerText, { color: C.text2 }]}>
          {adminReviewResolution.error || 'The exact private review story list could not be verified.'}
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="End private review and remove this downloaded revision"
          disabled={reviewCleanupBusy}
          onPress={() => requestPrivateReviewCleanup()}
          style={[styles.recoveryButton, { borderColor: C.red, opacity: reviewCleanupBusy ? 0.55 : 1 }]}
        >
          <Text style={[styles.recoveryText, { color: C.red }]}>End private review</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (loading || !playerDetail || !session || needsRedownload) {
    const canResume = Boolean(
      originalsRuntime.state !== 'error'
      && runtimeMatchesRequest
    );
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: C.bg }] }>
        {loading ? <ActivityIndicator color={C.orange} /> : <Ionicons name="pause-circle-outline" size={32} color={C.text3} />}
        <Text style={[styles.centerText, { color: C.text2 }]}>{loading ? 'Restoring your Original' : needsRedownload ? 'This offline package needs to be downloaded again' : canResume ? 'Your drive is ready to resume' : 'No active Original for this account on this device'}</Text>
        {!loading ? (
          <TouchableOpacity accessibilityRole="button" onPress={() => canResume ? void originalsRuntime.resumeTour() : router.replace({ pathname: '/originals/[id]', params: detailRequestParams } as any)} style={[styles.recoveryButton, { borderColor: C.border }] }>
            <Text style={[styles.recoveryText, { color: C.orange }]}>{canResume ? 'Resume tour' : 'Return to Original'}</Text>
          </TouchableOpacity>
        ) : null}
      </SafeAreaView>
    );
  }

  if (status === 'completed') {
    return (
      <>
        <CompletionState
          detail={playerDetail}
          session={session}
          onStories={() => setStoriesVisible(true)}
          simulation={originalsRuntime.simulation}
          privateField={privateFieldActive}
          simulationResults={simulationResults}
          validationBusy={validationBusy}
          validationReport={validationReport}
          onRunValidation={() => void runValidationMatrix()}
          onFeedback={() => setFeedbackVisible(true)}
          onExit={() => requestClosePlayer('completion_exit')}
          onEndPrivateReview={privateFieldActive || adminReviewEntries.length ? () => requestPrivateReviewCleanup() : undefined}
          privateReviewCleanupBusy={reviewCleanupBusy}
        />
        <StoriesModal
          visible={storiesVisible}
          detail={playerDetail}
          onClose={() => setStoriesVisible(false)}
          onReplay={storyId => void originalsRuntime.replayStory(storyId)}
          adminReviewEntries={adminReviewEntries}
          reviewOpenedIds={reviewOpenedIds}
          reviewBusyId={reviewBusyId}
          onAdminReview={entry => void reviewStory(entry)}
        />
        {!originalsRuntime.simulation && !privateFieldActive ? <OriginalFeedbackSheet visible={feedbackVisible} packId={id} version={session.version} onClose={() => setFeedbackVisible(false)} /> : null}
      </>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: C.bg }]} testID="originals.legacy-player.screen">
      <LinearGradient colors={[C.s2, '#0D0F10', C.bg]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFillObject} />
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.safe}>
        <View style={styles.topBar}>
          <TouchableOpacity
            testID="originals.legacy-player.minimize"
            accessibilityRole="button"
            accessibilityLabel={originalsRuntime.simulation ? 'Close trigger test' : privateFieldActive ? 'End private GPS field test' : 'Minimize tour player'}
            onPress={() => requestClosePlayer('top_close')}
            style={styles.roundButton}
          >
            <Ionicons name="chevron-down" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={styles.topCopy}>
            <Text style={styles.topKicker}>{privateFieldActive ? 'ADMIN · UNPUBLISHED PRIVATE FIELD TEST' : 'TRAILHEAD ORIGINAL'}</Text>
            <Text style={styles.topTitle} numberOfLines={1}>{playerDetail.title}</Text>
          </View>
          <TouchableOpacity
            testID="originals.legacy-player.mute"
            accessibilityRole="button"
            accessibilityLabel={session.muted ? 'Unmute narration' : 'Mute narration'}
            onPress={() => void originalsRuntime.setMuted(!session.muted)}
            style={styles.roundButton}
          >
            <Ionicons name={session.muted ? 'volume-mute' : 'volume-high'} size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        <View style={styles.mapStage} testID="originals.legacy-player.map">
          <OriginalRouteMap
            route={originalsRuntime.manifest!.route}
            projectedProgressM={originalsRuntime.session!.last_projected_route_progress_m}
            currentStoryTitle={storyIsPlaying ? currentStory?.title : undefined}
            nextStop={nextStop}
          />
          <View style={styles.mapStatusRow}>
            <View style={styles.offlineBadge}>
              <Ionicons name="cloud-offline-outline" size={13} color="#FFFFFF" />
              <Text style={styles.offlineText}>DOWNLOADED</Text>
            </View>
            <View style={styles.gpsBadge}>
              <View style={[styles.gpsDot, { backgroundColor: status === 'location_unavailable' && !originalsRuntime.simulation ? C.red : C.orange }]} />
              <Text style={styles.offlineText}>{originalsRuntime.simulation ? 'SYNTHETIC GPS' : privateFieldActive ? status === 'location_unavailable' ? 'PRIVATE GPS PAUSED' : 'PRIVATE GPS · FOREGROUND' : status === 'location_unavailable' ? 'GPS PAUSED' : 'GPS ACTIVE'}</Text>
            </View>
          </View>
        </View>

        <View testID="originals.legacy-player.sheet" style={[styles.playerSheet, originalsRuntime.simulation && styles.simulationSheet, { backgroundColor: C.s1, borderColor: C.border }] }>
          <ScrollView
            testID="originals.legacy-player.scroll"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[styles.playerSheetContent, { paddingBottom: Math.max(insets.bottom, 14) }]}
          >
          <View style={[styles.handle, { backgroundColor: C.border2 }]} />
          {privateFieldActive ? (
            <View style={[styles.alert, { borderColor: C.orange + '70', backgroundColor: C.orange + '10' }] }>
              <Ionicons name="shield-checkmark-outline" size={18} color={C.orange} />
              <View style={styles.alertCopy}>
                <Text style={[styles.alertTitle, { color: C.text }]}>Private GPS field test · admin only</Text>
                <Text style={[styles.alertBody, { color: C.text2 }]}>Unpublished content. Foreground GPS only. No saved progress, analytics, background tracking, or car display. Operate only while parked or as a passenger.</Text>
                {privateFieldDiagnostic ? (
                  <View testID="originals.private-field.safe-diagnostic">
                    <Text style={[styles.alertBody, { color: C.text2 }]}>{privateFieldDiagnostic.region_label} · {privateFieldDiagnostic.region_code}</Text>
                    <Text style={[styles.alertBody, { color: C.text2 }]}>{privateFieldDiagnostic.map_bytes.toLocaleString()} exact map bytes · MAP COMPLETE · BUNDLE VERIFIED</Text>
                    <Text style={[styles.alertBody, { color: C.text2 }]}>Pack {privateFieldDiagnostic.pack_id} · v{privateFieldDiagnostic.version} · manifest {privateFieldDiagnostic.manifest_id}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          ) : null}
          {originalsRuntime.simulation ? (
            <TriggerSimulationPanel
              decision={originalsRuntime.lastTriggerEvaluation?.decision ?? null}
              diagnosticStop={diagnosticStop}
              nextStop={nextStop}
              busy={simulationBusy}
              speedMps={driveLabState?.speed_mps ?? simulationSpeedMps}
              canAdvance={canAdvanceFailedCue}
              results={simulationResults}
              driveLabState={driveLabState}
              driveLabError={driveLabError}
              cueStatuses={driveLabCueStatuses}
              routeDistanceM={originalsRuntime.manifest!.route.distance_m}
              audioPositionMs={originalsRuntime.audioPlaybackState?.position_ms ?? originalsRuntime.session?.current_audio_position_ms ?? 0}
              audioDurationMs={originalsRuntime.audioPlaybackState?.duration_ms ?? (
                originalsRuntime.manifest?.stops.find(stop => (
                  stop.id === originalsRuntime.session?.current_stop_id
                ))?.audio_duration_s ?? 0
              ) * 1_000}
              audioPlaying={Boolean(originalsRuntime.audioPlaybackState?.playing)}
              validationBusy={validationBusy}
              validationReport={validationReport}
              onTrigger={() => void runSimulation('trigger')}
              onPoorAccuracy={() => void runSimulation('poor_accuracy')}
              onOffRoute={() => void runSimulation('off_route')}
              onAdvance={() => void advanceSimulationCue()}
              onSpeedChange={changeSimulationSpeed}
              onDriveToggle={() => updateDriveLab({ playing: !driveLabStateRef.current?.playing })}
              onDirectionToggle={() => updateDriveLab({
                direction: driveLabStateRef.current?.direction === 'reverse' ? 'forward' : 'reverse',
              })}
              onGpsQuality={cycleDriveLabGps}
              onOffRouteToggle={() => updateDriveLab({
                off_route_m: driveLabStateRef.current?.off_route_m ? 0 : ORIGINAL_VIRTUAL_DRIVE_OFF_ROUTE_M,
              })}
              onSeek={seekDriveLab}
              onSeekNextCue={seekDriveLabToNextCue}
              onRunValidation={() => void runValidationMatrix()}
            />
          ) : null}
          {status === 'off_route' || status === 'location_unavailable' ? (
            <View style={[styles.alert, { borderColor: C.orange + '55', backgroundColor: C.orange + '10' }] }>
              <Ionicons name={status === 'off_route' ? 'git-compare-outline' : 'location-outline'} size={18} color={C.orange} />
              <View style={styles.alertCopy}>
                <Text style={[styles.alertTitle, { color: C.text }]}>{status === 'off_route' ? 'Auto-play paused off route' : 'Waiting for a reliable GPS fix'}</Text>
                <Text style={[styles.alertBody, { color: C.text2 }]}>{privateFieldActive && status === 'off_route'
                  ? 'Rejoin the selected private route and the next story will re-arm.'
                  : session.message || (status === 'off_route' ? `Rejoin the ${privateFieldActive ? 'selected private' : 'published'} route and the next story will re-arm.` : 'Stories remain queued and will not be skipped.')}</Text>
              </View>
            </View>
          ) : null}

          <View style={styles.progressHeader}>
            <Text style={[styles.progressLabel, { color: C.text2 }]}>{session.playedCount} of {session.totalCount} stories heard</Text>
            <TouchableOpacity testID="originals.legacy-player.stories" accessibilityRole="button" accessibilityLabel="Open all stories" onPress={() => setStoriesVisible(true)} style={styles.storiesAction}>
              <Text style={[styles.storiesActionText, { color: C.orange }]}>Stories</Text>
              <Ionicons name="list" size={15} color={C.orange} />
            </TouchableOpacity>
          </View>
          <View testID="originals.legacy-player.progress" style={[styles.progressTrack, { backgroundColor: C.s3 }] }>
            <View style={[styles.progressFill, { width: `${Math.max(1, Math.round(session.progress * 100))}%`, backgroundColor: C.orange }]} />
          </View>

          <View style={styles.nowPlaying}>
            <View style={[styles.storyIcon, { backgroundColor: C.orange + '18', borderColor: C.orange + '45' }] }>
              <Ionicons name={isPaused ? 'pause' : 'headset'} size={23} color={C.orange} />
            </View>
            <View style={styles.nowCopy}>
              <Text style={[styles.nowKicker, { color: C.orange }]}>{isPaused ? 'PAUSED BY YOU' : storyIsPlaying ? 'NOW PLAYING' : 'UP NEXT'}</Text>
              <Text style={[styles.nowTitle, { color: C.text }]} numberOfLines={2}>{currentStory?.title || 'Continue along the route'}</Text>
              <Text style={[styles.nowMeta, { color: C.text3 }]}>{currentStory?.durationLabel || 'Waiting for the next trigger'}</Text>
            </View>
          </View>

          {currentStory?.transcript && transcriptVisible ? (
            <ScrollView nestedScrollEnabled style={styles.transcript} contentContainerStyle={styles.transcriptContent} showsVerticalScrollIndicator={false}>
              <Text style={[styles.transcriptText, { color: C.text2 }]}>{currentStory.transcript}</Text>
            </ScrollView>
          ) : null}

          <View style={styles.controls}>
            <PlayerControl testID="originals.legacy-player.replay" icon="play-back" label="Replay" disabled={!currentStory?.replayable} onPress={() => currentStory?.replayable && void originalsRuntime.replayStory(currentStory.id)} />
            <TouchableOpacity
              testID="originals.legacy-player.pause-resume"
              accessibilityRole="button"
              accessibilityLabel={isPaused ? 'Resume narration' : 'Pause narration'}
              onPress={() => void togglePause()}
              style={[styles.playButton, { backgroundColor: C.orange }]}
            >
              <Ionicons name={isPaused ? 'play' : 'pause'} size={30} color="#FFFFFF" />
            </TouchableOpacity>
            <PlayerControl testID="originals.legacy-player.skip" icon="play-forward" label="Skip" onPress={() => void originalsRuntime.skipCurrentStory()} />
          </View>

          <View style={styles.secondaryControls}>
            <TouchableOpacity testID="originals.legacy-player.captions" accessibilityRole="button" accessibilityLabel={transcriptVisible ? 'Hide transcript' : 'Show transcript'} onPress={() => setTranscriptVisible(value => !value)} style={[styles.secondaryButton, { borderColor: C.border }] }>
              <Ionicons name="text-outline" size={16} color={C.text2} />
              <Text style={[styles.secondaryLabel, { color: C.text2 }]}>{transcriptVisible ? 'Hide captions' : 'Show captions'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="originals.legacy-player.end"
              accessibilityRole="button"
              accessibilityLabel={originalsRuntime.simulation ? 'End trigger test' : privateFieldActive ? 'End private GPS field test' : 'End tour'}
              onPress={() => originalsRuntime.simulation || privateFieldActive
                ? requestClosePlayer('end_test')
                : Alert.alert('End this tour?', 'GPS and narration will stop. Your download and story progress will stay saved.', [
                  { text: 'Keep touring', style: 'cancel' },
                  {
                    text: 'End tour',
                    style: 'destructive',
                    onPress: () => void originalsRuntime.stopTour()
                      .then(() => router.replace({ pathname: '/originals/[id]', params: {
                        ...detailRequestParams,
                        version: String(session.version),
                      } } as any))
                      .catch(error => Alert.alert('Couldn’t end tour', error instanceof Error ? error.message : 'Try again.')),
                  },
                ])}
              style={[styles.secondaryButton, { borderColor: C.border }]}
            >
              <Ionicons name="flag-outline" size={16} color={C.text2} />
              <Text style={[styles.secondaryLabel, { color: C.text2 }]}>{originalsRuntime.simulation ? 'End test' : privateFieldActive ? 'End field test' : 'End tour'}</Text>
            </TouchableOpacity>
          </View>
          {originalsAdminRuntime.privateReviewActive && (privateFieldActive || adminReviewEntries.length) ? (
            <TouchableOpacity
              testID="originals.private-review.end"
              accessibilityRole="button"
              accessibilityLabel="End private review and remove this downloaded revision"
              disabled={reviewCleanupBusy}
              onPress={() => requestPrivateReviewCleanup()}
              style={[styles.privateReviewCleanup, { borderColor: C.red, opacity: reviewCleanupBusy ? 0.55 : 1 }]}
            >
              {reviewCleanupBusy
                ? <ActivityIndicator size="small" color={C.red} />
                : <Ionicons name="trash-outline" size={16} color={C.red} />}
              <Text style={[styles.privateReviewCleanupText, { color: C.red }]}>End private review</Text>
            </TouchableOpacity>
          ) : null}
          {!originalsRuntime.simulation && !privateFieldActive ? (
            <TouchableOpacity testID="originals.legacy-player.feedback" accessibilityRole="button" accessibilityLabel="Share feedback about this Original" onPress={() => setFeedbackVisible(true)} style={[styles.feedbackButton, { borderColor: C.border }] }>
              <Ionicons name="chatbubble-ellipses-outline" size={16} color={C.orange} />
              <Text style={[styles.feedbackButtonText, { color: C.orange }]}>Share feedback</Text>
            </TouchableOpacity>
          ) : null}
          </ScrollView>
        </View>
      </SafeAreaView>

      <StoriesModal
        visible={storiesVisible}
        detail={playerDetail}
        onClose={() => setStoriesVisible(false)}
        onReplay={storyId => void originalsRuntime.replayStory(storyId)}
        adminReviewEntries={adminReviewEntries}
        reviewOpenedIds={reviewOpenedIds}
        reviewBusyId={reviewBusyId}
        onAdminReview={entry => void reviewStory(entry)}
      />
      {!originalsRuntime.simulation && !privateFieldActive ? <OriginalFeedbackSheet visible={feedbackVisible} packId={id} version={session.version} stopId={currentStory?.id} onClose={() => setFeedbackVisible(false)} /> : null}
    </View>
  );
}

function triggerDecisionTitle(decision: OriginalTriggerDecisionDiagnostic | null) {
  if (!decision) return 'READY FOR SYNTHETIC FIX';
  const titles: Partial<Record<OriginalTriggerDecisionDiagnostic['code'], string>> = {
    poor_accuracy: 'BLOCKED · GPS ACCURACY',
    route_unavailable: 'BLOCKED · ROUTE UNAVAILABLE',
    off_route: 'BLOCKED · OFF ROUTE',
    before_window: 'WAITING · BEFORE CUE WINDOW',
    after_window: 'BLOCKED · PAST CUE WINDOW',
    outside_radius: 'BLOCKED · OUTSIDE RADIUS',
    missing_bearing: 'BLOCKED · HEADING REQUIRED',
    wrong_bearing: 'BLOCKED · WRONG DIRECTION',
    armed: 'ARMED · FIX 1 RECEIVED',
    waiting_for_fixes: 'ARMED · WAITING FOR FIX 2',
    waiting_for_dwell: 'ARMED · WAITING FOR 3 SECONDS',
    triggered: 'PASSED · STORY TRIGGERED',
    queued: 'PASSED · STORY QUEUED',
    missed: 'EARLIER STORY MARKED MISSED',
    complete: 'SIMULATED ROUTE COMPLETE',
    no_remaining_stops: 'NO REMAINING STORIES',
  };
  return titles[decision.code] || decision.code.replace(/_/g, ' ').toUpperCase();
}

function compactTriggerDistance(value: number) {
  if (!Number.isFinite(value)) return '—';
  return value >= 1_000 ? `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)} KM` : `${Math.round(value)} M`;
}

function simulationResultConditions(result: SimulationCueResult) {
  const conditions = [
    `${Math.round(result.speedMps * 2.23694)} MPH`,
    result.projectedProgressM == null ? null : `FIX ${compactTriggerDistance(result.projectedProgressM)}`,
    `LIVE ${compactTriggerDistance(result.effectiveStartM)}–${compactTriggerDistance(result.endM)}`,
    result.distanceToStopM == null
      ? `RADIUS ≤ ${Math.round(result.enterRadiusM)} M`
      : `${Math.round(result.distanceToStopM)} / ${Math.round(result.enterRadiusM)} M RADIUS`,
    result.requiredBearingDeg == null
      ? 'NO BEARING GATE'
      : result.actualBearingDeg == null
        ? `HEADING REQUIRED · ${Math.round(result.requiredBearingDeg)}° ± ${Math.round(result.bearingToleranceDeg ?? 45)}°`
        : `HEADING ${Math.round(result.actualBearingDeg)}° / ${Math.round(result.requiredBearingDeg)}° ± ${Math.round(result.bearingToleranceDeg ?? 45)}°`,
  ];
  return conditions.filter(Boolean).join(' · ');
}

function formatLabClock(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function driveCueStatusLabel(status: OriginalVirtualDriveCueStatus['status']) {
  const labels: Record<OriginalVirtualDriveCueStatus['status'], string> = {
    completed: 'heard',
    skipped: 'skipped',
    missed: 'missed',
    playing: 'playing',
    queued: 'queued',
    in_window: 'window',
    passed_window: 'passed',
    ahead: 'ahead',
  };
  return labels[status];
}

function ContinuousDriveLabControls({
  state,
  error,
  cueStatuses,
  routeDistanceM,
  audioPositionMs,
  audioDurationMs,
  audioPlaying,
  disabled,
  onToggle,
  onDirectionToggle,
  onGpsQuality,
  onOffRouteToggle,
  onSeek,
  onSeekNextCue,
}: {
  state: OriginalVirtualDriveLabState;
  error: string;
  cueStatuses: readonly OriginalVirtualDriveCueStatus[];
  routeDistanceM: number;
  audioPositionMs: number;
  audioDurationMs: number;
  audioPlaying: boolean;
  disabled: boolean;
  onToggle: () => void;
  onDirectionToggle: () => void;
  onGpsQuality: () => void;
  onOffRouteToggle: () => void;
  onSeek: (progressM: number) => void;
  onSeekNextCue: () => void;
}) {
  const C = useTheme();
  const progress = routeDistanceM > 0 ? state.progress_m / routeDistanceM : 0;
  const seekStepM = Math.max(500, routeDistanceM * 0.05);
  const gpsAccuracy = state.gps_quality === 'precise' ? 10 : state.gps_quality === 'approximate' ? 75 : 150;
  return (
    <View style={[styles.driveLabController, { borderColor: C.border, backgroundColor: C.s1 }] }>
      <View style={styles.driveLabHeader}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={state.playing ? 'Pause continuous synthetic drive' : 'Play continuous synthetic drive'}
          disabled={disabled}
          onPress={onToggle}
          style={[styles.driveLabPlay, { backgroundColor: C.orange, opacity: disabled ? 0.5 : 1 }]}
        >
          <Ionicons name={state.playing ? 'pause' : 'play'} size={20} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={styles.driveLabHeaderCopy}>
          <Text style={[styles.driveLabKicker, { color: C.orange }]}>CONTINUOUS SYNTHETIC ROUTE</Text>
          <Text style={[styles.driveLabTitle, { color: C.text }]}>
            {compactTriggerDistance(state.progress_m)} / {compactTriggerDistance(routeDistanceM)} · {state.direction.toUpperCase()}
          </Text>
          <Text style={[styles.driveLabMeta, { color: C.text3 }]}>SIM {formatLabClock(state.elapsed_simulated_ms)} · {state.sample_count} FIXES</Text>
        </View>
        <View style={styles.driveLabAudioCopy}>
          <Text style={[styles.driveLabKicker, { color: C.text3 }]}>AUDIO CLOCK</Text>
          <Text style={[styles.driveLabAudio, { color: C.text }]}>{formatLabClock(audioPositionMs)} / {formatLabClock(audioDurationMs)}</Text>
          <Text style={[styles.driveLabAudioState, { color: C.text3 }]}>{audioPlaying ? 'PLAYING' : audioPositionMs > 0 ? 'PAUSED' : 'IDLE'}</Text>
        </View>
      </View>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Synthetic route progress"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
        accessibilityActions={[{ name: 'decrement' }, { name: 'increment' }]}
        onAccessibilityAction={event => onSeek(
          event.nativeEvent.actionName === 'decrement'
            ? state.progress_m - seekStepM
            : state.progress_m + seekStepM,
        )}
        style={[styles.driveLabTrack, { backgroundColor: C.s3 }]}
      >
        <View style={[styles.driveLabFill, { width: `${Math.max(1, Math.round(progress * 100))}%`, backgroundColor: C.orange }]} />
      </View>
      <View style={styles.driveLabSeekRow}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Seek backward on the synthetic route" disabled={disabled || state.progress_m <= 0} onPress={() => onSeek(state.progress_m - seekStepM)} style={[styles.driveLabSeek, { borderColor: C.border }] }>
          <Ionicons name="play-back" size={15} color={C.text2} />
          <Text style={[styles.driveLabSeekText, { color: C.text2 }]}>5%</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Seek to the next cue window" disabled={disabled} onPress={onSeekNextCue} style={[styles.driveLabSeekNext, { borderColor: C.orange + '66', backgroundColor: C.orange + '12' }] }>
          <Text style={[styles.driveLabSeekText, { color: C.orange }]}>Next cue window</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Seek forward on the synthetic route" disabled={disabled || state.progress_m >= routeDistanceM} onPress={() => onSeek(state.progress_m + seekStepM)} style={[styles.driveLabSeek, { borderColor: C.border }] }>
          <Text style={[styles.driveLabSeekText, { color: C.text2 }]}>5%</Text>
          <Ionicons name="play-forward" size={15} color={C.text2} />
        </TouchableOpacity>
      </View>
      <View style={styles.driveLabModes}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Synthetic direction ${state.direction}`} onPress={onDirectionToggle} style={[styles.driveLabMode, { borderColor: C.border }] }>
          <Ionicons name="swap-horizontal" size={15} color={C.orange} />
          <Text style={[styles.driveLabModeText, { color: C.text2 }]}>{state.direction === 'forward' ? 'Forward' : 'Reverse'}</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Synthetic GPS quality ${state.gps_quality}`} onPress={onGpsQuality} style={[styles.driveLabMode, { borderColor: C.border }] }>
          <Ionicons name="locate-outline" size={15} color={C.orange} />
          <Text style={[styles.driveLabModeText, { color: C.text2 }]}>{state.gps_quality} · {gpsAccuracy}m</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={state.off_route_m ? 'Disable off route injection' : 'Enable off route injection'} onPress={onOffRouteToggle} style={[styles.driveLabMode, { borderColor: C.border }] }>
          <Ionicons name="git-compare-outline" size={15} color={C.orange} />
          <Text style={[styles.driveLabModeText, { color: C.text2 }]}>{state.off_route_m ? `Off route · ${Math.round(state.off_route_m)}m` : 'On route'}</Text>
        </TouchableOpacity>
      </View>
      {error ? <Text accessibilityLiveRegion="polite" style={[styles.driveLabError, { color: C.orange }]}>{error}</Text> : null}
      <View style={styles.driveLabCueList}>
        {cueStatuses.map(cue => {
          const active = ['playing', 'queued', 'in_window'].includes(cue.status);
          return (
            <View key={cue.stop_id} style={[styles.driveLabCue, { borderColor: active ? C.orange + '66' : C.border, backgroundColor: active ? C.orange + '10' : C.s2 }] }>
              <Text style={[styles.driveLabCueTitle, { color: active ? C.orange : C.text2 }]} numberOfLines={1}>{cue.sequence}. {cue.title}</Text>
              <Text style={[styles.driveLabCueStatus, { color: active ? C.orange : C.text3 }]}>{driveCueStatusLabel(cue.status).toUpperCase()} · {compactTriggerDistance(cue.effective_start_m)}–{compactTriggerDistance(cue.end_m)}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function TriggerSimulationPanel({
  decision,
  diagnosticStop,
  nextStop,
  busy,
  speedMps,
  canAdvance,
  results,
  driveLabState,
  driveLabError,
  cueStatuses,
  routeDistanceM,
  audioPositionMs,
  audioDurationMs,
  audioPlaying,
  validationBusy,
  validationReport,
  onTrigger,
  onPoorAccuracy,
  onOffRoute,
  onAdvance,
  onSpeedChange,
  onDriveToggle,
  onDirectionToggle,
  onGpsQuality,
  onOffRouteToggle,
  onSeek,
  onSeekNextCue,
  onRunValidation,
}: {
  decision: OriginalTriggerDecisionDiagnostic | null;
  diagnosticStop: OriginalStopV1 | null;
  nextStop: OriginalStopV1 | null;
  busy: boolean;
  speedMps: number;
  canAdvance: boolean;
  results: SimulationCueResult[];
  driveLabState: OriginalVirtualDriveLabState | null;
  driveLabError: string;
  cueStatuses: readonly OriginalVirtualDriveCueStatus[];
  routeDistanceM: number;
  audioPositionMs: number;
  audioDurationMs: number;
  audioPlaying: boolean;
  validationBusy: boolean;
  validationReport: OriginalRouteValidationReportV1 | null;
  onTrigger: () => void;
  onPoorAccuracy: () => void;
  onOffRoute: () => void;
  onAdvance: () => void;
  onSpeedChange: (value: number) => void;
  onDriveToggle: () => void;
  onDirectionToggle: () => void;
  onGpsQuality: () => void;
  onOffRouteToggle: () => void;
  onSeek: (progressM: number) => void;
  onSeekNextCue: () => void;
  onRunValidation: () => void;
}) {
  const C = useTheme();
  const displayStop = diagnosticStop ?? nextStop;
  const trigger = displayStop?.trigger;
  const window = trigger ? {
    authoredStart: decision?.window?.authored_start_m ?? trigger.route_progress_start_m,
    effectiveStart: decision?.window?.effective_start_m ?? Math.max(
      0,
      trigger.route_progress_start_m - speedMps * Math.max(0, trigger.lead_time_s || 0),
    ),
    end: decision?.window?.end_m ?? trigger.route_progress_end_m,
  } : null;
  const exitRadius = trigger
    ? Math.max(trigger.exit_radius_m, trigger.enter_radius_m * 1.5, trigger.enter_radius_m + 50)
    : null;
  const speedMph = Math.round(speedMps * 2.23694);
  const passedCount = results.filter(item => item.outcome === 'passed').length;
  const failedCount = results.filter(item => item.outcome === 'failed').length;
  const showingPreviousResult = Boolean(diagnosticStop && nextStop && diagnosticStop.id !== nextStop.id);
  return (
    <View style={[styles.simulationPanel, { borderColor: C.orange + '55', backgroundColor: C.s2 }] }>
      <View style={styles.simulationHeading}>
        <View style={[styles.simulationIcon, { backgroundColor: C.orange + '18' }] }>
          <Ionicons name="speedometer-outline" size={17} color={C.orange} />
        </View>
        <View style={styles.simulationHeadingCopy}>
          <Text style={[styles.simulationKicker, { color: C.orange }]}>VIRTUAL DRIVE LAB · ADMIN</Text>
          <Text style={[styles.simulationTitle, { color: C.text }]}>{triggerDecisionTitle(decision)}</Text>
        </View>
      </View>
      <Text accessibilityLiveRegion="polite" style={[styles.simulationReason, { color: C.text2 }]}>
        {decision?.message || (nextStop ? `Next: ${nextStop.sequence}. ${nextStop.title}` : 'Every story cue has been exercised.')}
      </Text>
      {showingPreviousResult ? (
        <Text style={[styles.simulationNext, { color: C.orange }]}>NEXT · {nextStop!.sequence}. {nextStop!.title}</Text>
      ) : null}
      <Text style={[styles.simulationResultSummary, { color: C.text3 }]}>{passedCount} PASSED · {failedCount} BLOCKED · {results.length} REVIEWED</Text>
      {driveLabState ? (
        <ContinuousDriveLabControls
          state={driveLabState}
          error={driveLabError}
          cueStatuses={cueStatuses}
          routeDistanceM={routeDistanceM}
          audioPositionMs={audioPositionMs}
          audioDurationMs={audioDurationMs}
          audioPlaying={audioPlaying}
          disabled={busy}
          onToggle={onDriveToggle}
          onDirectionToggle={onDirectionToggle}
          onGpsQuality={onGpsQuality}
          onOffRouteToggle={onOffRouteToggle}
          onSeek={onSeek}
          onSeekNextCue={onSeekNextCue}
        />
      ) : null}
      <View style={[styles.simulationSpeed, { borderColor: C.border }] }>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Lower synthetic test speed" disabled={busy || speedMps <= 0} onPress={() => onSpeedChange(Math.max(0, speedMps - 4))} style={styles.simulationSpeedButton}>
          <Ionicons name="remove" size={18} color={speedMps <= 0 ? C.text3 : C.text2} />
        </TouchableOpacity>
        <View style={styles.simulationSpeedCopy}>
          <Text style={[styles.simulationSpeedLabel, { color: C.text3 }]}>SYNTHETIC TEST SPEED</Text>
          <Text style={[styles.simulationSpeedValue, { color: C.text }]}>{speedMph} MPH · {speedMps.toFixed(0)} M/S</Text>
        </View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Raise synthetic test speed" disabled={busy || speedMps >= 40} onPress={() => onSpeedChange(Math.min(40, speedMps + 4))} style={styles.simulationSpeedButton}>
          <Ionicons name="add" size={18} color={speedMps >= 40 ? C.text3 : C.text2} />
        </TouchableOpacity>
      </View>
      {trigger && window ? (
        <View style={styles.simulationGates}>
          <Text style={[styles.simulationGate, { color: C.text3, borderColor: C.border }]}>LIVE WINDOW {compactTriggerDistance(window.effectiveStart)}–{compactTriggerDistance(window.end)}</Text>
          {window.effectiveStart !== window.authoredStart ? <Text style={[styles.simulationGate, { color: C.text3, borderColor: C.border }]}>AUTHORED START {compactTriggerDistance(window.authoredStart)} · LEAD {Math.max(0, trigger.lead_time_s || 0).toFixed(0)} SEC</Text> : null}
          <Text style={[styles.simulationGate, { color: C.text3, borderColor: C.border }]}>RADIUS ≤ {Math.round(trigger.enter_radius_m)} M</Text>
          <Text style={[styles.simulationGate, { color: C.text3, borderColor: C.border }]}>EXIT ≥ {Math.round(exitRadius!)} M</Text>
          {decision?.route.projected_progress_m != null ? <Text style={[styles.simulationGate, { color: C.text3, borderColor: C.border }]}>FIX AT {compactTriggerDistance(decision.route.projected_progress_m)}</Text> : null}
          {decision?.radius ? <Text style={[styles.simulationGate, { color: C.text3, borderColor: C.border }]}>STOP DISTANCE {Math.round(decision.radius.distance_to_stop_m)} M</Text> : null}
          {trigger.approach_bearing_deg != null ? <Text style={[styles.simulationGate, { color: C.text3, borderColor: C.border }]}>BEARING {Math.round(trigger.approach_bearing_deg)}° ± {Math.round(trigger.bearing_tolerance_deg ?? 45)}°</Text> : null}
          <Text style={[styles.simulationGate, { color: C.text3, borderColor: C.border }]}>GPS ≤ 100 M · 2 FIXES / 3 SEC</Text>
        </View>
      ) : null}
      <View style={styles.simulationButtons}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Test poor GPS accuracy" disabled={busy || !nextStop} onPress={onPoorAccuracy} style={[styles.simulationSecondary, { borderColor: C.border }] }>
          <Text style={[styles.simulationSecondaryText, { color: C.text2 }]}>Poor GPS</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Test an off route location" disabled={busy || !nextStop} onPress={onOffRoute} style={[styles.simulationSecondary, { borderColor: C.border }] }>
          <Text style={[styles.simulationSecondaryText, { color: C.text2 }]}>Off route</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Send two valid fixes and trigger the next story" disabled={busy || !nextStop} onPress={onTrigger} style={[styles.simulationPrimary, { backgroundColor: C.orange, opacity: busy || !nextStop ? 0.45 : 1 }] }>
          {busy ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Ionicons name="play" size={15} color="#FFFFFF" />}
          <Text style={styles.simulationPrimaryText}>Trigger next</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Mark this failed cue and continue to the next cue" disabled={busy || !nextStop || !canAdvance} onPress={onAdvance} style={[styles.simulationAdvance, { borderColor: C.border, opacity: busy || !nextStop || !canAdvance ? 0.45 : 1 }] }>
        <Text style={[styles.simulationAdvanceText, { color: C.text2 }]}>{canAdvance ? 'Mark failed & continue' : 'Capture a cue-specific failure to continue'}</Text>
        <Ionicons name="arrow-forward" size={16} color={C.text2} />
      </TouchableOpacity>
      <ValidationMatrixPanel busy={validationBusy} report={validationReport} onRun={onRunValidation} />
    </View>
  );
}

function scenarioTitle(id: string) {
  return id
    .replace(/^baseline_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, character => character.toUpperCase());
}

function ValidationMatrixPanel({ busy, report, onRun }: {
  busy: boolean;
  report: OriginalRouteValidationReportV1 | null;
  onRun: () => void;
}) {
  const C = useTheme();
  return (
    <View style={[styles.validationMatrix, { borderColor: C.border, backgroundColor: C.s1 }] }>
      <View style={styles.validationMatrixHeader}>
        <View style={styles.validationMatrixCopy}>
          <Text style={[styles.validationMatrixKicker, { color: C.orange }]}>FULL ROUTE MATRIX</Text>
          <Text style={[styles.validationMatrixTitle, { color: C.text }]}>
            {report ? `${report.summary.passed} of ${report.summary.required} scenarios passed` : 'Exercise all 13 required scenarios'}
          </Text>
        </View>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={report ? 'Run the full virtual drive matrix again' : 'Run the full virtual drive matrix'}
          disabled={busy}
          onPress={onRun}
          style={[styles.validationMatrixButton, { backgroundColor: C.orange, opacity: busy ? 0.55 : 1 }]}
        >
          {busy ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Ionicons name="play" size={14} color="#FFFFFF" />}
          <Text style={styles.validationMatrixButtonText}>{busy ? 'Running' : report ? 'Run again' : 'Run matrix'}</Text>
        </TouchableOpacity>
      </View>
      <Text style={[styles.validationMatrixNote, { color: C.text3 }]}>This device report is informational. Originals Studio records the server validation that controls release readiness.</Text>
      {report ? (
        <>
          <View style={styles.validationRouteSummary}>
            <Text style={[styles.simulationGate, { color: C.text3, borderColor: C.border }]}>{Math.round(report.route_summary.distance_m / 1_000)} KM ROUTE</Text>
            <Text style={[styles.simulationGate, { color: C.text3, borderColor: C.border }]}>{report.route_summary.coordinate_count} POINTS</Text>
            <Text style={[styles.simulationGate, { color: C.text3, borderColor: C.border }]}>{report.route_summary.discontinuity_count} BREAKS</Text>
            <Text style={[styles.simulationGate, { color: C.text3, borderColor: C.border }]}>{report.route_summary.self_intersection_count} INTERSECTIONS</Text>
          </View>
          <View style={[styles.validationScenarioList, { borderTopColor: C.border }] }>
            {report.scenarios.map(scenario => (
              <View key={scenario.id} style={[styles.validationScenarioRow, { borderBottomColor: C.border }] }>
                <Ionicons name={scenario.passed ? 'checkmark-circle' : 'alert-circle'} size={17} color={C.orange} />
                <View style={styles.validationScenarioCopy}>
                  <Text style={[styles.validationScenarioTitle, { color: C.text }]}>{scenarioTitle(scenario.id)}</Text>
                  <Text style={[styles.validationScenarioMeta, { color: C.text3 }]}>
                    {scenario.passed ? 'PASSED' : `${scenario.issues.length} ISSUE${scenario.issues.length === 1 ? '' : 'S'}`} · {Number(scenario.metrics.sample_count ?? 0)} FIXES
                  </Text>
                  {!scenario.passed && scenario.issues[0] ? <Text style={[styles.validationScenarioIssue, { color: C.text2 }]}>{scenario.issues[0]}</Text> : null}
                </View>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

function PlayerControl({ testID, icon, label, disabled = false, onPress }: { testID: string; icon: keyof typeof Ionicons.glyphMap; label: string; disabled?: boolean; onPress: () => void }) {
  const C = useTheme();
  return (
    <TouchableOpacity testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={styles.smallControl}>
      <Ionicons name={icon} size={23} color={disabled ? C.text3 : C.text2} />
      <Text style={[styles.smallControlLabel, { color: disabled ? C.text3 : C.text2 }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function privateReviewDurationLabel(seconds: number) {
  const rounded = Math.max(1, Math.round(seconds));
  return rounded < 60 ? `${rounded} sec` : `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}

function StoriesModal({
  visible,
  detail,
  onClose,
  onReplay,
  adminReviewEntries = [],
  reviewOpenedIds = [],
  reviewBusyId = null,
  onAdminReview,
}: {
  visible: boolean;
  detail: OriginalUiDetail;
  onClose: () => void;
  onReplay: (storyId: string) => void;
  adminReviewEntries?: OriginalAdminPreviewRenderableReviewEntry[];
  reviewOpenedIds?: string[];
  reviewBusyId?: string | null;
  onAdminReview?: (entry: OriginalAdminPreviewRenderableReviewEntry) => void;
}) {
  const C = useTheme();
  const [artworkFailedIds, setArtworkFailedIds] = useState<string[]>([]);
  useEffect(() => {
    if (visible) setArtworkFailedIds([]);
  }, [adminReviewEntries, visible]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.storySheet, { backgroundColor: C.s1, borderColor: C.border }] }>
          <View style={styles.storySheetHeader}>
            <View style={styles.storySheetCopy}>
              <Text style={[styles.storySheetKicker, { color: C.orange }]}>DRIVE STORIES</Text>
              <Text style={[styles.storySheetTitle, { color: C.text }]}>{detail.title}</Text>
            </View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close stories" onPress={onClose} style={styles.storySheetClose}>
              <Ionicons name="close" size={21} color={C.text2} />
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            {adminReviewEntries.length ? (
              <>
                <Text style={[styles.privateReviewNote, { color: C.text3 }]}>PRIVATE CONTENT REVIEW · {adminReviewEntries.length} EXACT STORIES · Scheduling and release flags are unchanged.</Text>
                {adminReviewEntries.map(entry => {
                  const opened = reviewOpenedIds.includes(entry.id);
                  const busy = reviewBusyId === entry.id;
                  const artworkFailed = artworkFailedIds.includes(entry.id);
                  return (
                    <TouchableOpacity
                      key={entry.id}
                      testID={`originals.private-review.story.${entry.id}`}
                      accessibilityRole="button"
                      accessibilityLabel={`Review story ${entry.sequence}, ${entry.title}. ${entry.mode_label}`}
                      disabled={Boolean(reviewBusyId) || artworkFailed}
                      onPress={() => onAdminReview?.(entry)}
                      style={[styles.storyModalRow, { borderBottomColor: C.border, opacity: reviewBusyId && !busy ? 0.55 : 1 }]}
                    >
                      <View style={[styles.privateReviewArtworkFrame, { borderColor: artworkFailed ? C.red : C.orange + '50', backgroundColor: C.s2 }] }>
                        {artworkFailed ? (
                          <Ionicons name="alert-circle-outline" size={20} color={C.red} />
                        ) : (
                          <Image
                            accessibilityIgnoresInvertColors
                            source={{ uri: entry.artwork_uri }}
                            resizeMode="cover"
                            onError={() => setArtworkFailedIds(current => (
                              current.includes(entry.id) ? current : [...current, entry.id]
                            ))}
                            style={styles.privateReviewArtwork}
                          />
                        )}
                        {busy ? (
                          <View style={styles.privateReviewArtworkBusy}>
                            <ActivityIndicator size="small" color="#FFFFFF" />
                          </View>
                        ) : null}
                      </View>
                      <View style={styles.storyModalCopy}>
                        <Text style={[styles.storyModalTitle, { color: C.text }]}>{entry.sequence}. {entry.title}</Text>
                        <Text style={[styles.storyModalMeta, { color: artworkFailed ? C.red : C.text3 }]}>{artworkFailed ? 'APPROVED ARTWORK COULD NOT BE DISPLAYED' : `${entry.mode_label} · ${privateReviewDurationLabel(entry.audio_duration_s)}${opened ? ' · OPENED' : ''}`}</Text>
                      </View>
                      <Ionicons name="play-circle-outline" size={21} color={C.orange} />
                    </TouchableOpacity>
                  );
                })}
              </>
            ) : detail.stories.map(story => {
              const heard = Boolean(story.completed);
              const skipped = Boolean(story.skipped);
              const missed = Boolean(story.missed);
              const replayable = Boolean(story.replayable || heard || skipped || missed);
              const stateLabel = missed ? 'missed' : skipped ? 'skipped' : heard ? 'heard' : 'ahead';
              const stateIcon = heard ? 'checkmark' : missed ? 'play-skip-forward' : skipped ? 'play-forward' : 'headset-outline';
              return (
                <TouchableOpacity
                  key={story.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${replayable ? 'Replay' : 'Unavailable'} ${stateLabel} story ${story.sequence}, ${story.title}`}
                  accessibilityState={{ disabled: !replayable }}
                  disabled={!replayable}
                  onPress={() => replayable && onReplay(story.id)}
                  style={[styles.storyModalRow, { borderBottomColor: C.border }]}
                >
                  <View style={[styles.storyModalSequence, { backgroundColor: replayable ? C.orange + '18' : C.s2, borderColor: replayable ? C.orange + '50' : C.border }] }>
                    <Ionicons name={stateIcon} size={16} color={replayable ? C.orange : C.text3} />
                  </View>
                  <View style={styles.storyModalCopy}>
                    <Text style={[styles.storyModalTitle, { color: C.text }]}>{story.sequence}. {story.title}</Text>
                    <Text style={[styles.storyModalMeta, { color: C.text3 }]}>{missed ? 'Missed · tap to play safely' : skipped ? 'Skipped · tap to replay' : heard ? 'Heard · tap to replay' : `${story.durationLabel} · ahead`}</Text>
                  </View>
                  <Ionicons name="play-circle-outline" size={21} color={replayable ? C.orange : C.text3} />
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function CompletionState({
  detail,
  session,
  onStories,
  simulation = false,
  privateField = false,
  simulationResults = [],
  validationBusy = false,
  validationReport = null,
  onRunValidation,
  onFeedback,
  onExit,
  onEndPrivateReview,
  privateReviewCleanupBusy = false,
}: {
  detail: OriginalUiDetail;
  session: OriginalUiSession;
  onStories: () => void;
  simulation?: boolean;
  privateField?: boolean;
  simulationResults?: SimulationCueResult[];
  validationBusy?: boolean;
  validationReport?: OriginalRouteValidationReportV1 | null;
  onRunValidation?: () => void;
  onFeedback: () => void;
  onExit?: () => void;
  onEndPrivateReview?: () => void;
  privateReviewCleanupBusy?: boolean;
}) {
  const C = useTheme();
  const router = useRouter();
  const passedCount = simulationResults.filter(item => item.outcome === 'passed').length;
  const failedCount = simulationResults.filter(item => item.outcome === 'failed').length;
  return (
    <SafeAreaView style={[styles.completion, { backgroundColor: C.bg }] }>
      <LinearGradient colors={[C.s1, C.bg]} style={StyleSheet.absoluteFillObject} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.completionContent}>
        <View style={[styles.completionMark, { backgroundColor: C.orange + '18', borderColor: C.orange + '55' }] }>
          <Ionicons name="checkmark" size={39} color={C.orange} />
        </View>
        <Text style={[styles.completionKicker, { color: C.orange }]}>{simulation ? 'TRIGGER TEST COMPLETE' : privateField ? 'PRIVATE FIELD TEST COMPLETE' : 'ORIGINAL COMPLETE'}</Text>
        <Text style={[styles.completionTitle, { color: C.text }]}>{detail.title}</Text>
        <Text style={[styles.completionBody, { color: C.text2 }]}>{simulation ? 'The cue sequence is complete. Synthetic results did not change saved drive progress.' : privateField ? 'This unpublished foreground-GPS review did not save progress or emit release analytics.' : 'Progress is saved. Replay missed stories when parked.'}</Text>
        <View style={styles.completionMetrics}>
          <View style={[styles.completionMetric, { backgroundColor: C.s1, borderColor: C.border }] }>
            <Text style={[styles.completionValue, { color: C.text }]}>{simulation ? passedCount : session.playedCount}</Text>
            <Text style={[styles.completionLabel, { color: C.text3 }]}>{simulation ? 'PASSED' : 'HEARD'}</Text>
          </View>
          <View style={[styles.completionMetric, { backgroundColor: C.s1, borderColor: C.border }] }>
            <Text style={[styles.completionValue, { color: C.text }]}>{simulation ? failedCount : session.missedCount}</Text>
            <Text style={[styles.completionLabel, { color: C.text3 }]}>{simulation ? 'BLOCKED' : 'MISSED'}</Text>
          </View>
          <View style={[styles.completionMetric, { backgroundColor: C.s1, borderColor: C.border }] }>
            <Text style={[styles.completionValue, { color: C.text }]}>{simulation ? simulationResults.length : detail.distanceLabel}</Text>
            <Text style={[styles.completionLabel, { color: C.text3 }]}>{simulation ? 'REVIEWED' : 'ROUTE'}</Text>
          </View>
        </View>
        {simulation && simulationResults.length ? (
          <View style={[styles.simulationResults, { backgroundColor: C.s1, borderColor: C.border }] }>
            {simulationResults.map(result => (
              <View key={result.stopId} style={[styles.simulationResultRow, { borderBottomColor: C.border }] }>
                <Ionicons name={result.outcome === 'passed' ? 'checkmark-circle' : 'alert-circle'} size={18} color={C.orange} />
                <View style={styles.simulationResultCopy}>
                  <Text style={[styles.simulationResultTitle, { color: C.text }]}>{result.sequence}. {result.title} · {result.outcome.toUpperCase()}</Text>
                  <Text style={[styles.simulationResultMessage, { color: C.text2 }]}>{result.message}</Text>
                  <Text style={[styles.simulationResultConditions, { color: C.text3 }]}>{simulationResultConditions(result)}</Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}
        {simulation && onRunValidation ? (
          <ValidationMatrixPanel busy={validationBusy} report={validationReport} onRun={onRunValidation} />
        ) : null}
        <TouchableOpacity accessibilityRole="button" onPress={onStories} style={[styles.completionPrimary, { backgroundColor: C.orange }] }>
          <Ionicons name="headset-outline" size={18} color="#FFFFFF" />
          <Text style={styles.completionPrimaryText}>Review stories</Text>
        </TouchableOpacity>
        {!simulation && !privateField ? (
          <TouchableOpacity accessibilityRole="button" onPress={onFeedback} style={[styles.completionSecondary, { borderColor: C.border }] }>
            <Text style={[styles.completionSecondaryText, { color: C.orange }]}>Share feedback</Text>
          </TouchableOpacity>
        ) : null}
        {(simulation || privateField) && onEndPrivateReview ? (
          <TouchableOpacity
            testID="originals.private-review.end.completed"
            accessibilityRole="button"
            accessibilityLabel="End private review and remove this downloaded revision"
            disabled={privateReviewCleanupBusy}
            onPress={onEndPrivateReview}
            style={[styles.completionSecondary, { borderColor: C.red, opacity: privateReviewCleanupBusy ? 0.55 : 1 }]}
          >
            {privateReviewCleanupBusy ? <ActivityIndicator size="small" color={C.red} /> : null}
            <Text style={[styles.completionSecondaryText, { color: C.red }]}>End private review</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity accessibilityRole="button" onPress={() => simulation || privateField ? onExit?.() : router.replace('/(tabs)/trips' as any)} style={[styles.completionSecondary, { borderColor: C.border }] }>
          <Text style={[styles.completionSecondaryText, { color: C.text2 }]}>{simulation ? 'End trigger test' : privateField ? 'End private field test' : 'Back to Trips'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  centerText: { marginTop: 10, fontSize: 12, fontWeight: '700' },
  recoveryButton: { minHeight: 44, marginTop: 18, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  recoveryText: { fontSize: 11, fontWeight: '900' },
  topBar: { minHeight: 64, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  roundButton: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(5,5,5,0.48)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  topCopy: { flex: 1, minWidth: 0, alignItems: 'center' },
  topKicker: { color: '#F2A47C', fontSize: 8, lineHeight: 11, fontWeight: '900', letterSpacing: 0.9 },
  topTitle: { color: '#FFFFFF', marginTop: 2, fontSize: 15, lineHeight: 19, fontWeight: '900' },
  mapStage: { flex: 1, minHeight: 230, overflow: 'hidden' },
  mapStatusRow: { position: 'absolute', left: 16, right: 16, bottom: 12, flexDirection: 'row', gap: 7 },
  offlineBadge: { minHeight: 28, borderRadius: 999, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(8,8,8,0.72)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  gpsBadge: { minHeight: 28, borderRadius: 999, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(8,8,8,0.72)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  gpsDot: { width: 7, height: 7, borderRadius: 4 },
  offlineText: { color: '#FFFFFF', fontSize: 8, fontWeight: '900', letterSpacing: 0.6 },
  playerSheet: { maxHeight: '60%', flexShrink: 1, borderTopLeftRadius: 25, borderTopRightRadius: 25, borderWidth: 1, overflow: 'hidden' },
  playerSheetContent: { paddingHorizontal: 18, paddingTop: 9, gap: 10 },
  simulationSheet: { maxHeight: '62%', flexShrink: 1 },
  handle: { width: 42, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 1 },
  simulationPanel: { borderWidth: 1, borderRadius: 15, padding: 11, gap: 8 },
  simulationHeading: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  simulationIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  simulationHeadingCopy: { flex: 1, minWidth: 0 },
  simulationKicker: { fontSize: 10, lineHeight: 13, fontWeight: '900', letterSpacing: 0.7 },
  simulationTitle: { marginTop: 1, fontSize: 13, lineHeight: 17, fontWeight: '900' },
  simulationReason: { fontSize: 12, lineHeight: 17, fontWeight: '600' },
  simulationNext: { fontSize: 11, lineHeight: 15, fontWeight: '900', letterSpacing: 0.35 },
  simulationResultSummary: { fontSize: 10.5, lineHeight: 14, fontWeight: '900', letterSpacing: 0.35 },
  driveLabController: { borderWidth: 1, borderRadius: 13, padding: 10, gap: 9 },
  driveLabHeader: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  driveLabPlay: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  driveLabHeaderCopy: { flex: 1, minWidth: 0 },
  driveLabKicker: { fontSize: 8, lineHeight: 11, fontWeight: '900', letterSpacing: 0.65 },
  driveLabTitle: { marginTop: 1, fontSize: 11.5, lineHeight: 15, fontWeight: '900' },
  driveLabMeta: { marginTop: 1, fontSize: 9.5, lineHeight: 13, fontWeight: '800' },
  driveLabAudioCopy: { minWidth: 78, alignItems: 'flex-end' },
  driveLabAudio: { marginTop: 1, fontSize: 10.5, lineHeight: 14, fontWeight: '900' },
  driveLabAudioState: { marginTop: 1, fontSize: 8, lineHeight: 11, fontWeight: '900', letterSpacing: 0.55 },
  driveLabTrack: { height: 8, borderRadius: 999, overflow: 'hidden' },
  driveLabFill: { height: '100%', borderRadius: 999 },
  driveLabSeekRow: { flexDirection: 'row', gap: 6 },
  driveLabSeek: { minWidth: 58, minHeight: 44, paddingHorizontal: 8, borderWidth: 1, borderRadius: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  driveLabSeekNext: { flex: 1, minHeight: 44, paddingHorizontal: 10, borderWidth: 1, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  driveLabSeekText: { fontSize: 10.5, lineHeight: 14, fontWeight: '900' },
  driveLabModes: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  driveLabMode: { flexGrow: 1, minHeight: 44, paddingHorizontal: 9, borderWidth: 1, borderRadius: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  driveLabModeText: { fontSize: 10, lineHeight: 14, fontWeight: '900', textTransform: 'capitalize' },
  driveLabError: { fontSize: 10.5, lineHeight: 15, fontWeight: '800' },
  driveLabCueList: { gap: 5 },
  driveLabCue: { minHeight: 42, paddingHorizontal: 9, paddingVertical: 6, borderWidth: 1, borderRadius: 10, justifyContent: 'center' },
  driveLabCueTitle: { fontSize: 10.5, lineHeight: 14, fontWeight: '900' },
  driveLabCueStatus: { marginTop: 1, fontSize: 8.5, lineHeight: 12, fontWeight: '900', letterSpacing: 0.35 },
  simulationSpeed: { minHeight: 48, borderWidth: 1, borderRadius: 12, flexDirection: 'row', alignItems: 'center' },
  simulationSpeedButton: { width: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  simulationSpeedCopy: { flex: 1, alignItems: 'center' },
  simulationSpeedLabel: { fontSize: 10, lineHeight: 13, fontWeight: '900', letterSpacing: 0.4 },
  simulationSpeedValue: { marginTop: 1, fontSize: 12, lineHeight: 16, fontWeight: '900' },
  simulationGates: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  simulationGate: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 4, fontSize: 10.5, lineHeight: 14, fontWeight: '900', letterSpacing: 0.2 },
  simulationButtons: { flexDirection: 'row', gap: 7 },
  simulationSecondary: { minHeight: 44, paddingHorizontal: 10, borderWidth: 1, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  simulationSecondaryText: { fontSize: 11, fontWeight: '900' },
  simulationPrimary: { flex: 1, minHeight: 44, paddingHorizontal: 11, borderRadius: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  simulationPrimaryText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  simulationAdvance: { minHeight: 44, borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  simulationAdvanceText: { fontSize: 11, lineHeight: 15, fontWeight: '900' },
  validationMatrix: { borderWidth: 1, borderRadius: 13, padding: 10, gap: 9 },
  validationMatrixHeader: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  validationMatrixCopy: { flex: 1, minWidth: 0 },
  validationMatrixKicker: { fontSize: 9, lineHeight: 12, fontWeight: '900', letterSpacing: 0.65 },
  validationMatrixTitle: { marginTop: 2, fontSize: 12, lineHeight: 16, fontWeight: '900' },
  validationMatrixButton: { minHeight: 44, minWidth: 104, borderRadius: 11, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  validationMatrixButtonText: { color: '#FFFFFF', fontSize: 10.5, fontWeight: '900' },
  validationMatrixNote: { fontSize: 10, lineHeight: 15, fontWeight: '600' },
  validationRouteSummary: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  validationScenarioList: { borderTopWidth: StyleSheet.hairlineWidth },
  validationScenarioRow: { minHeight: 48, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  validationScenarioCopy: { flex: 1, minWidth: 0 },
  validationScenarioTitle: { fontSize: 10.5, lineHeight: 14, fontWeight: '900' },
  validationScenarioMeta: { marginTop: 1, fontSize: 9.5, lineHeight: 13, fontWeight: '800', letterSpacing: 0.25 },
  validationScenarioIssue: { marginTop: 3, fontSize: 10, lineHeight: 14, fontWeight: '600' },
  alert: { borderWidth: 1, borderRadius: 13, padding: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  alertCopy: { flex: 1, minWidth: 0 },
  alertTitle: { fontSize: 11.5, lineHeight: 15, fontWeight: '900' },
  alertBody: { marginTop: 2, fontSize: 10, lineHeight: 14, fontWeight: '600' },
  progressHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  progressLabel: { fontSize: 10.5, lineHeight: 14, fontWeight: '800' },
  storiesAction: { minHeight: 44, minWidth: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5 },
  storiesActionText: { fontSize: 10.5, fontWeight: '900' },
  progressTrack: { height: 6, borderRadius: 999, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 999 },
  nowPlaying: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  storyIcon: { width: 46, height: 46, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  nowCopy: { flex: 1, minWidth: 0 },
  nowKicker: { fontSize: 8, lineHeight: 11, fontWeight: '900', letterSpacing: 0.8 },
  nowTitle: { marginTop: 2, fontSize: 17, lineHeight: 21, fontWeight: '900' },
  nowMeta: { marginTop: 2, fontSize: 10, lineHeight: 14, fontWeight: '700' },
  transcript: { maxHeight: 88 },
  transcriptContent: { paddingVertical: 3 },
  transcriptText: { fontSize: 11.5, lineHeight: 18, fontWeight: '600' },
  controls: { minHeight: 69, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 30 },
  smallControl: { minWidth: 54, minHeight: 54, alignItems: 'center', justifyContent: 'center', gap: 3 },
  smallControlLabel: { fontSize: 9, fontWeight: '800' },
  playButton: { width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center' },
  secondaryControls: { flexDirection: 'row', gap: 8 },
  secondaryButton: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  secondaryLabel: { fontSize: 10, fontWeight: '800' },
  privateReviewCleanup: { minHeight: 44, borderWidth: 1, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  privateReviewCleanupText: { fontSize: 10.5, fontWeight: '900' },
  feedbackButton: { minHeight: 44, borderWidth: 1, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  feedbackButtonText: { fontSize: 10.5, fontWeight: '900' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.56)' },
  storySheet: { maxHeight: '82%', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 24 },
  storySheetHeader: { minHeight: 56, flexDirection: 'row', alignItems: 'center' },
  storySheetCopy: { flex: 1, minWidth: 0 },
  storySheetKicker: { fontSize: 8, lineHeight: 11, fontWeight: '900', letterSpacing: 0.8 },
  storySheetTitle: { marginTop: 2, fontSize: 18, lineHeight: 22, fontWeight: '900' },
  storySheetClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  privateReviewNote: { paddingVertical: 10, fontSize: 9, lineHeight: 14, fontWeight: '800', letterSpacing: 0.35 },
  storyModalRow: { minHeight: 66, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 10 },
  storyModalSequence: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  privateReviewArtworkFrame: { width: 64, height: 48, borderRadius: 9, borderWidth: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  privateReviewArtwork: { width: '100%', height: '100%' },
  privateReviewArtworkBusy: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: '#00000066' },
  storyModalCopy: { flex: 1, minWidth: 0 },
  storyModalTitle: { fontSize: 12.5, lineHeight: 17, fontWeight: '800' },
  storyModalMeta: { marginTop: 2, fontSize: 10, lineHeight: 14, fontWeight: '600' },
  completion: { flex: 1 },
  completionContent: { flexGrow: 1, paddingHorizontal: 24, paddingVertical: 28, alignItems: 'center', justifyContent: 'center' },
  completionMark: { width: 78, height: 78, borderRadius: 39, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  completionKicker: { marginTop: 20, fontSize: 9, lineHeight: 12, fontWeight: '900', letterSpacing: 1 },
  completionTitle: { marginTop: 6, fontSize: 28, lineHeight: 34, fontWeight: '900', textAlign: 'center', letterSpacing: -0.6 },
  completionBody: { marginTop: 8, maxWidth: 340, fontSize: 12, lineHeight: 19, fontWeight: '600', textAlign: 'center' },
  completionMetrics: { width: '100%', marginTop: 24, flexDirection: 'row', gap: 8 },
  completionMetric: { flex: 1, minHeight: 72, borderWidth: 1, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  completionValue: { fontSize: 17, lineHeight: 21, fontWeight: '900' },
  completionLabel: { marginTop: 3, fontSize: 8, lineHeight: 11, fontWeight: '900', letterSpacing: 0.7 },
  simulationResults: { width: '100%', marginTop: 14, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12 },
  simulationResultRow: { minHeight: 62, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  simulationResultCopy: { flex: 1, minWidth: 0 },
  simulationResultTitle: { fontSize: 11.5, lineHeight: 16, fontWeight: '900' },
  simulationResultMessage: { marginTop: 2, fontSize: 11, lineHeight: 16, fontWeight: '600' },
  simulationResultConditions: { marginTop: 4, fontSize: 9.5, lineHeight: 14, fontWeight: '800', letterSpacing: 0.2 },
  completionPrimary: { width: '100%', minHeight: 50, marginTop: 22, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  completionPrimaryText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  completionSecondary: { width: '100%', minHeight: 48, marginTop: 9, borderWidth: 1, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  completionSecondaryText: { fontSize: 11.5, fontWeight: '900' },
});
