import '@/lib/backgroundTasks'; // must be first — registers background location task
import '@/lib/telemetry/sentry';
import { useEffect, useRef, useState } from 'react';
import { Alert, Appearance, AppState, Linking, Platform, View, Text, TouchableOpacity } from 'react-native';
import { Stack, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { accountStorage, storage } from '@/lib/storage';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as Updates from 'expo-updates';
import {
  cancelActiveTripMirror,
  restoreLegacyAccountState,
  restoreSeparatedAnonymousLegacyState,
  separateAnonymousLegacyState,
  useStore,
} from '@/lib/store';
import { api } from '@/lib/api';
import { mono } from '@/lib/design';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import TrailheadLaunchLoader from '@/components/TrailheadLaunchLoader';
import WelcomeOnboardingModal from '@/components/WelcomeOnboardingModal';
import WelcomeGate from '@/components/WelcomeGate';
import {
  markWelcomeGateSeen,
  markWelcomeSetupSkipped,
  saveWelcomeSetupPreferences,
  shouldPreserveCompletedWelcomeSetup,
  shouldShowWelcomeGate,
  WELCOME_PENDING_ATTR_KEY,
  WELCOME_WALKTHROUGH_SEEN_KEY,
  type WelcomeGateChoice,
  type WelcomeSetupPreferences,
} from '@/lib/welcomeGate';
import {
  eraseTripRepositoryScope,
  getTripRepositorySnapshot,
  initializeTripRepository,
  inspectTripRepositoryScope,
  mergeTripRepositoryScope,
  migrateLegacyTripRepositoryData,
  switchTripRepositoryScope,
} from '@/lib/tripRepository';
import {
  cancelTripRepositorySync,
  setTripRepositorySyncIdentity,
  startTripRepositoryAutoSync,
  synchronizeTripRepository,
} from '@/lib/tripRepositorySync';
import { accountRecoveryContext } from '@/lib/tripRepository/accountRecovery';
import { routeBuilderRequestFromGeoUrl } from '@/lib/carNavigationIntent';
import { OriginalsRuntimeProvider } from '@/lib/originals/runtime';
import { consumeOriginalPreviewUrl } from '@/lib/originals/previewAccess';
import {
  referralCodeFromUrl,
  rememberReferralCode,
  startBranchReferralAttribution,
} from '@/lib/referrals/branchAttribution';
import { useTrailheadFonts } from '@/lib/typography';
import { withTrailheadTelemetry } from '@/lib/telemetry/sentry';
import { appLinkDestinationFromUrl } from '@/lib/appLinks';
import { handoffSharedTrailToken } from '@/lib/sharedTrailLinkHandoff';

const LAUNCH_LOADER_MIN_MS = 1200;
const LAUNCH_LOADER_MAX_MS = 4500;

function askToAddSignedOutTrips(count: number): Promise<boolean> {
  return new Promise(resolve => {
    Alert.alert(
      'Add trips to your account?',
      `${count} ${count === 1 ? 'item was' : 'items were'} saved while signed out. Add ${count === 1 ? 'it' : 'them'} to this account?`,
      [
        { text: 'Keep separate', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Add to account', onPress: () => resolve(true) },
      ],
      { cancelable: false },
    );
  });
}

function RootLayout() {
  const setAuth            = useStore(s => s.setAuth);
  const setAuthHydrated    = useStore(s => s.setAuthHydrated);
  const setPlan            = useStore(s => s.setPlan);
  const setActiveTrip      = useStore(s => s.setActiveTrip);
  const setUserLoc         = useStore(s => s.setUserLoc);
  const themeMode    = useStore(s => s.themeMode);
  const user         = useStore(s => s.user);
  const authToken    = useStore(s => s.token);
  const sessionId    = useStore(s => s.sessionId);
  const welcomePromptRunId = useStore(s => s.welcomePromptRunId);
  const welcomeSetupRunId = useStore(s => s.welcomeSetupRunId);
  const router       = useRouter();
  const pathname     = usePathname();
  const insets       = useSafeAreaInsets();
  const [updateBanner, setUpdateBanner] = useState(false);
  const [welcomeVisible, setWelcomeVisible] = useState(false);
  const [welcomeGateVisible, setWelcomeGateVisible] = useState(false);
  const [welcomeGateMode, setWelcomeGateMode] = useState<'welcome' | 'setup'>('welcome');
  const [welcomeGateSource, setWelcomeGateSource] = useState<'first_open' | 'profile'>('first_open');
  const [startupReady, setStartupReady] = useState(false);
  const [launchLoaderVisible, setLaunchLoaderVisible] = useState(true);
  const updateReady  = useRef(false);
  const checking     = useRef(false);
  const pushRegistered = useRef(false);
  const welcomeGateChecked = useRef(false);
  const lastRepositoryAccountId = useRef<number | null>(null);
  const repositoryTransitionRun = useRef(0);
  const tripGraphSyncEnabled = useRef(false);
  const stopTripRepositoryAutoSync = useRef<(() => void) | null>(null);
  const navigationLinkSequence = useRef(0);
  const [fontsLoaded, fontError] = useTrailheadFonts();
  const fontsReady = fontsLoaded || Boolean(fontError);

  useEffect(() => {
    if (!startupReady) return;
    const run = ++repositoryTransitionRun.current;
    const parsedAccountId = user?.id == null ? NaN : Number(user.id);
    const accountId = Number.isFinite(parsedAccountId) ? parsedAccountId : null;
    const previousAccountId = lastRepositoryAccountId.current;
    const startedInAnonymousScope = getTripRepositorySnapshot().ownerScope === 'anonymous';
    if (accountId != null) lastRepositoryAccountId.current = accountId;

    const transition = async () => {
      if (accountId == null) {
        tripGraphSyncEnabled.current = false;
        stopTripRepositoryAutoSync.current?.();
        stopTripRepositoryAutoSync.current = null;
        await cancelTripRepositorySync();
        await cancelActiveTripMirror();
        if (run !== repositoryTransitionRun.current) return;

        const currentScope = getTripRepositorySnapshot().ownerScope;
        const currentAccountId = currentScope.startsWith('account:')
          ? Number(currentScope.slice('account:'.length))
          : null;
        const accountToErase = previousAccountId ?? (Number.isFinite(currentAccountId) ? currentAccountId : null);
        try {
          if (accountToErase != null) await eraseTripRepositoryScope(accountToErase);
        } finally {
          if (run === repositoryTransitionRun.current) {
            await switchTripRepositoryScope();
            await restoreSeparatedAnonymousLegacyState().catch(() => false);
          }
        }
        if (run === repositoryTransitionRun.current) lastRepositoryAccountId.current = null;
        return;
      }

      stopTripRepositoryAutoSync.current?.();
      stopTripRepositoryAutoSync.current = null;
      await cancelTripRepositorySync();
      await cancelActiveTripMirror();
      if (run !== repositoryTransitionRun.current) return;
      if (previousAccountId != null && previousAccountId !== accountId) {
        await eraseTripRepositoryScope(previousAccountId).catch(() => {});
        if (run !== repositoryTransitionRun.current) return;
      }

      const anonymous = await inspectTripRepositoryScope();
      const anonymousCount = anonymous.tripCount + anonymous.savedEntityCount;
      const local = useStore.getState();
      const legacyCount = Number(Boolean(local.activeTrip))
        + Number(Boolean(local.rigProfile))
        + local.tripHistory.length
        + local.favoriteCamps.length
        + local.savedPlaces.length
        + local.waterSpots.length
        + local.catchLogs.length
        + local.waterRoutes.length
        + local.markerGroups.length;
      const recovery = accountRecoveryContext({
        accountId,
        anonymousRevision: anonymous.revision,
        anonymousCount,
        legacyCount,
        startedInAnonymousScope,
      });
      const priorDecision = recovery.count > 0
        ? await storage.get(recovery.decisionKey).catch(() => null)
        : null;
      let decision = priorDecision === 'merge' || priorDecision === 'separate'
        ? priorDecision
        : null;
      if (recovery.count > 0 && decision == null) {
        decision = await askToAddSignedOutTrips(recovery.count) ? 'merge' : 'separate';
      }
      if (run !== repositoryTransitionRun.current) return;
      if (recovery.count > 0 && decision === 'merge') {
        if (priorDecision === 'merge') await switchTripRepositoryScope(accountId);
        else await mergeTripRepositoryScope(null, accountId);
      } else {
        if (decision === 'separate' && recovery.legacyCount > 0) {
          await separateAnonymousLegacyState();
        }
        await switchTripRepositoryScope(accountId);
      }
      if (recovery.count > 0 && priorDecision == null && decision) {
        await storage.set(recovery.decisionKey, decision).catch(() => {});
      }

      const features = await api.productFeatures().catch(() => null);
      if (run !== repositoryTransitionRun.current) return;
      tripGraphSyncEnabled.current = Boolean(features?.trip_graph_v2);
      if (!tripGraphSyncEnabled.current || !authToken) {
        await cancelTripRepositorySync();
        return;
      }
      await setTripRepositorySyncIdentity(`account:${accountId}`, authToken);
      if (run !== repositoryTransitionRun.current) return;
      if (!stopTripRepositoryAutoSync.current) {
        stopTripRepositoryAutoSync.current = startTripRepositoryAutoSync();
      }
      await synchronizeTripRepository().catch(() => {});
    };
    transition().catch(() => {});
  }, [authToken, startupReady, user?.id]);

  useEffect(() => {
    if (Platform.OS === 'web') {
      if (typeof document !== 'undefined') document.documentElement.style.colorScheme = themeMode;
      return;
    }
    const setColorScheme = (Appearance as typeof Appearance & {
      setColorScheme?: (scheme: 'light' | 'dark') => void;
    }).setColorScheme;
    if (typeof setColorScheme === 'function') setColorScheme(themeMode);
  }, [themeMode]);

  // We auto-apply OTA updates that arrive within ~10s of launch (so users get
  // the latest code on every cold start with one short reload). After that
  // window we fall back to a banner so we don't interrupt active use.
  const launchAtRef = useRef(Date.now());

  function verificationTokenFromUrl(url: string | null | undefined) {
    if (!url || !url.includes('verify-email')) return '';
    try {
      const parsed = new URL(url);
      const token = parsed.searchParams.get('token');
      if (token) return token;
    } catch {}
    const match = url.match(/[?&]token=([^&#]+)/);
    return match ? decodeURIComponent(match[1].replace(/\+/g, '%20')) : '';
  }

  async function handleVerificationUrl(url: string | null | undefined) {
    const token = verificationTokenFromUrl(url);
    if (!token) return;
    const requestEpoch = accountStorage.epoch();
    const requestAccountId = useStore.getState().user?.id;
    try {
      const res = await api.verifyEmail(token);
      const currentAccountId = useStore.getState().user?.id;
      if (
        accountStorage.epoch() !== requestEpoch
        || String(currentAccountId ?? '') !== String(requestAccountId ?? '')
      ) return;
      if (accountStorage.isCleaning()) {
        Alert.alert('Please wait', 'Trailhead is still clearing the previous account from this device.');
        return;
      }
      if (requestAccountId != null && String(res.user.id) !== String(requestAccountId)) {
        Alert.alert('Sign out first', 'This confirmation link belongs to a different account. Sign out before confirming it.');
        return;
      }
      setAuth(res.token, res.user);
      Alert.alert('Email confirmed', 'Your Trailhead account is active.');
      router.push('/(tabs)/profile');
    } catch (e: any) {
      Alert.alert('Verification failed', e?.message ?? 'This verification link is invalid or expired.');
    }
  }

  async function handleIncomingUrl(url: string | null | undefined) {
    if (url?.includes('originals_preview_token')) {
      try {
        const previewRoute = await consumeOriginalPreviewUrl(url);
        if (previewRoute) {
          router.push(previewRoute as any);
          return;
        }
      } catch (error: any) {
        Alert.alert('Preview link unavailable', error?.message || 'This preview link is invalid or expired.');
        return;
      }
    }
    if (verificationTokenFromUrl(url)) {
      await handleVerificationUrl(url);
      return;
    }
    const referralCode = referralCodeFromUrl(url);
    if (referralCode) {
      if (!useStore.getState().user) {
        await rememberReferralCode(referralCode);
        router.push({
          pathname: '/(tabs)/profile',
          params: { auth: 'register', referral_code: referralCode },
        } as any);
      }
      return;
    }
    const appLink = appLinkDestinationFromUrl(url);
    if (appLink?.screen === 'support') {
      router.push({
        pathname: '/(tabs)/profile',
        params: {
          support: '1',
          ...(appLink.threadId ? { support_thread_id: appLink.threadId } : {}),
        },
      } as any);
      return;
    }
    if (appLink?.screen === 'prizes') {
      router.push({ pathname: '/(tabs)/profile', params: { prizes: '1' } } as any);
      return;
    }
    if (appLink?.screen === 'trips') {
      router.push({
        pathname: '/(tabs)/trips',
        params: appLink.tripId ? { trip_id: appLink.tripId } : {},
      } as any);
      return;
    }
    if (appLink?.screen === 'original') {
      router.push(`/originals/${encodeURIComponent(appLink.originalId)}` as any);
      return;
    }
    if (appLink?.screen === 'sharedTrail') {
      if (handoffSharedTrailToken(appLink.shareToken)) router.navigate('/shared-trails' as any);
      return;
    }
    const request = routeBuilderRequestFromGeoUrl(url);
    if (!request) return;
    navigationLinkSequence.current += 1;
    router.push({
      pathname: '/(tabs)/route-builder',
      params: {
        intent: request.action === 'add_a_stop' ? 'edit-active' : 'new',
        request: `${Date.now()}-${navigationLinkSequence.current}`,
        destination: request.destination,
        navigationAction: request.action,
      },
    } as any);
  }

  async function checkForUpdate() {
    if (checking.current) return;
    checking.current = true;
    try {
      const { isAvailable } = await Updates.checkForUpdateAsync();
      if (isAvailable) {
        await Updates.fetchUpdateAsync();
        if (Date.now() - launchAtRef.current < 10000) {
          // Still in launch window — apply immediately for a seamless update
          Updates.reloadAsync().catch(() => {});
          return;
        }
        updateReady.current = true;
        setUpdateBanner(true); // show "update ready" banner mid-session
      }
    } catch (e) {
      // silently ignore — network may be unavailable
    } finally {
      checking.current = false;
    }
  }

  async function refreshSubscriptionStatus() {
    const requestEpoch = accountStorage.epoch();
    const requestAccountId = useStore.getState().user?.id;
    const token = await storage.get('trailhead_token').catch(() => null);
    if (accountStorage.epoch() !== requestEpoch) return;
    if (!token) {
      setPlan(false, null);
      return;
    }
    const sub = await api.subscriptionStatus().catch(() => null);
    if (
      !sub
      || accountStorage.epoch() !== requestEpoch
      || String(useStore.getState().user?.id ?? '') !== String(requestAccountId ?? '')
    ) return;
    if (sub.is_active) {
      setPlan(true, sub.plan_expires_at ?? null);
      accountStorage.del('trailhead_iap_pending', requestEpoch).catch(() => {});
    } else {
      setPlan(false, null);
      accountStorage.del('trailhead_iap_pending', requestEpoch).catch(() => {});
    }
  }

  function applyUpdate() {
    setUpdateBanner(false);
    Updates.reloadAsync().catch(() => {});
  }

  function logWelcomeEvent(eventType: 'welcome_gate_seen' | 'welcome_gate_cta' | 'welcome_gate_cta_attributed' | 'welcome_walkthrough_seen' | 'welcome_walkthrough_cta', data: Record<string, unknown> = {}) {
    api.logAnalyticsEvent(eventType, sessionId, data).catch(() => {});
  }

  function closeWelcomeWalkthrough() {
    setWelcomeVisible(false);
    storage.set(WELCOME_WALKTHROUGH_SEEN_KEY, '1').catch(() => {});
  }

  function openWelcomeWalkthrough() {
    setWelcomeVisible(true);
    storage.set(WELCOME_WALKTHROUGH_SEEN_KEY, '1').catch(() => {});
    logWelcomeEvent('welcome_walkthrough_seen', { source: 'profile' });
  }

  function reviewSetupFromWalkthrough() {
    setWelcomeVisible(false);
    storage.set(WELCOME_WALKTHROUGH_SEEN_KEY, '1').catch(() => {});
    logWelcomeEvent('welcome_walkthrough_cta', { source: 'profile', signed_in: !!user });
    setWelcomeGateSource('profile');
    setWelcomeGateMode('setup');
    setWelcomeGateVisible(true);
  }

  function dismissWelcomeGate(choice: WelcomeGateChoice) {
    setWelcomeGateVisible(false);
    setWelcomeGateMode('welcome');
    markWelcomeGateSeen(choice).catch(() => {});
  }

  function shouldRouteWelcomeToGuide() {
    const path = String(pathname || '').toLowerCase();
    return !/(route-builder|map|profile|plan|report)/.test(path);
  }

  function signInFromWelcomeGate() {
    dismissWelcomeGate('sign_in');
    storage.set(WELCOME_PENDING_ATTR_KEY, '1').catch(() => {});
    logWelcomeEvent('welcome_gate_cta', { action: 'sign_in', signed_in: !!user });
    router.push({ pathname: '/(tabs)/profile', params: { auth: 'login' } } as any);
  }

  function continueFromWelcomeGate() {
    markWelcomeSetupSkipped().catch(() => {});
    dismissWelcomeGate('continue');
    logWelcomeEvent('welcome_gate_cta', { action: 'continue', signed_in: !!user });
    if (shouldRouteWelcomeToGuide()) router.push('/(tabs)/guide' as any);
  }

  function completeWelcomeSetup(preferences: WelcomeSetupPreferences) {
    saveWelcomeSetupPreferences(preferences).catch(() => {});
    logWelcomeEvent('welcome_gate_cta', {
      action: 'setup_complete',
      source: welcomeGateSource,
      signed_in: !!user,
      rental_interest: preferences.vehicle,
      camping: preferences.camping,
      camping_styles: preferences.campingStyles,
      party: preferences.party,
    });
    if (welcomeGateSource === 'first_open') {
      dismissWelcomeGate('continue');
      if (shouldRouteWelcomeToGuide()) router.push('/(tabs)/guide' as any);
      return;
    }
    setWelcomeGateVisible(false);
    setWelcomeGateMode('welcome');
  }

  function skipWelcomeSetup(preferences: WelcomeSetupPreferences) {
    const preserveCompletedSetup = shouldPreserveCompletedWelcomeSetup(
      welcomeGateSource,
      preferences.completedAt,
    );
    if (preserveCompletedSetup) {
      saveWelcomeSetupPreferences(preferences).catch(() => {});
    } else {
      markWelcomeSetupSkipped(preferences).catch(() => {});
    }
    logWelcomeEvent('welcome_gate_cta', {
      action: preserveCompletedSetup ? 'setup_close' : 'setup_skip',
      source: welcomeGateSource,
      signed_in: !!user,
    });
    if (welcomeGateSource === 'first_open') {
      dismissWelcomeGate('continue');
      if (shouldRouteWelcomeToGuide()) router.push('/(tabs)/guide' as any);
      return;
    }
    setWelcomeGateVisible(false);
    setWelcomeGateMode('welcome');
  }

  useEffect(() => {
    const maxTimer = setTimeout(() => setLaunchLoaderVisible(false), LAUNCH_LOADER_MAX_MS);
    return () => clearTimeout(maxTimer);
  }, []);

  useEffect(() => {
    if (!startupReady || !fontsReady || !launchLoaderVisible) return;
    const elapsed = Date.now() - launchAtRef.current;
    const releaseDelay = Math.max(0, LAUNCH_LOADER_MIN_MS - elapsed);
    const timer = setTimeout(() => setLaunchLoaderVisible(false), releaseDelay);
    return () => clearTimeout(timer);
  }, [fontsReady, launchLoaderVisible, startupReady]);

  useEffect(() => {
    let appStateSub: ReturnType<typeof AppState.addEventListener> | null = null;
    let launchCancelled = false;

    if (!__DEV__) {
      // Check immediately on launch
      checkForUpdate();

      // On every foreground: apply if ready, otherwise re-check for new deploys
      appStateSub = AppState.addEventListener('change', state => {
        if (state === 'active') {
          refreshSubscriptionStatus();
          const currentAuth = useStore.getState();
          if (currentAuth.user && currentAuth.token) {
            void api.productFeatures().then(async features => {
              const ownerScope = `account:${currentAuth.user!.id}`;
              if (!features.trip_graph_v2 || getTripRepositorySnapshot().ownerScope !== ownerScope) return;
              tripGraphSyncEnabled.current = true;
              await setTripRepositorySyncIdentity(ownerScope, currentAuth.token);
              if (!stopTripRepositoryAutoSync.current) {
                stopTripRepositoryAutoSync.current = startTripRepositoryAutoSync();
              }
              await synchronizeTripRepository();
            }).catch(() => {});
          }
          if (updateReady.current) {
            // Update was downloaded while app was backgrounded — apply now
            Updates.reloadAsync().catch(() => {});
          } else {
            checkForUpdate();
          }
        }
      });
    }

    // Resolve account ownership before touching legacy trip storage. Otherwise an
    // authenticated user's old files can be imported into the anonymous scope.
    void (async () => {
      const token = await storage.get('trailhead_token').catch(() => null);
      const hadStoredToken = Boolean(token);
      let restoredUser: Awaited<ReturnType<typeof api.me>> | null = null;
      if (token) {
        try {
          restoredUser = await api.me();
          await storage.set('trailhead_user', JSON.stringify(restoredUser)).catch(() => {});
        } catch (error: any) {
          const isNetworkError = !error?.message
            || error.message.includes('Network')
            || error.message.includes('fetch')
            || error instanceof TypeError;
          if (isNetworkError) {
            const cachedUser = await storage.get('trailhead_user').catch(() => null);
            if (cachedUser) {
              try {
                const parsed = JSON.parse(cachedUser);
                if (Number.isFinite(Number(parsed?.id))) restoredUser = parsed;
              } catch {}
            }
          } else {
            await Promise.all([
              storage.del('trailhead_token').catch(() => {}),
              storage.del('trailhead_user').catch(() => {}),
            ]);
          }
        }
      }

      if (restoredUser && token) {
        await restoreLegacyAccountState();
        await initializeTripRepository(restoredUser.id);
        await migrateLegacyTripRepositoryData().catch(() => {});
        if (!launchCancelled) {
          setAuth(token, restoredUser);
          await refreshSubscriptionStatus();
        }
      } else {
        await cancelTripRepositorySync();
        // A rejected credential never reclassifies unknown account files as
        // signed-out data. Only a separately stashed anonymous scope is restored.
        if (!hadStoredToken) {
          const restored = await restoreSeparatedAnonymousLegacyState().catch(() => false);
          if (!restored) await restoreLegacyAccountState();
          await initializeTripRepository();
          await migrateLegacyTripRepositoryData().catch(() => {});
        } else {
          await restoreSeparatedAnonymousLegacyState(true).catch(() => false);
          await initializeTripRepository();
        }
      }
    })().catch(async () => {
      await cancelTripRepositorySync().catch(() => {});
      await initializeTripRepository().catch(() => {});
    }).finally(() => {
      if (!launchCancelled) {
        setAuthHydrated(true);
        setStartupReady(true);
      }
    });

    // NOTE: Do NOT call iap.initConnection() / getAvailablePurchases() here.
    // That hits StoreKit on every cold launch and triggers the iOS "Sign into
    // Apple account" prompt. Subscription status comes from api.subscriptionStatus()
    // above. StoreKit is only called when the user explicitly opens the paywall.

    // Do not prompt on launch. Contextual notification UI owns permission requests.
    const pushTokenEpoch = accountStorage.epoch();
    Notifications.getPermissionsAsync().then(async ({ status }) => {
      if (status !== 'granted') return;
      try {
        const tokenData = await Notifications.getExpoPushTokenAsync({
          projectId: '92c016d2-6e63-480e-a483-a6898d7e77d5',
        });
        const token = tokenData.data;
        // Save token for use after login (user may not be loaded yet)
        await accountStorage.set('trailhead_push_token', token, pushTokenEpoch);
      } catch {}
    }).catch(() => {});

    const notifSub = Notifications.addNotificationResponseReceivedListener(async response => {
      const data = response.notification.request.content.data as any;
      if (typeof data?.deeplink === 'string' && data.deeplink.trim().startsWith('/')) {
        const base = data.deeplink.trim();
        if (data?.support_thread_id) {
          const joiner = base.includes('?') ? '&' : '?';
          router.push(`${base}${joiner}support_thread_id=${encodeURIComponent(String(data.support_thread_id))}` as any);
        } else {
          router.push(base as any);
        }
      } else if (data?.type === 'trip_ready' && data?.job_id) {
        // User tapped "your route is ready" notification — fetch and load the trip
        try {
          const requestEpoch = accountStorage.epoch();
          const requestAccountId = useStore.getState().user?.id;
          if (requestAccountId == null || !useStore.getState().token) return;
          const job = await api.getPlanJob(data.job_id);
          const current = useStore.getState();
          if (
            accountStorage.epoch() !== requestEpoch
            || String(current.user?.id ?? '') !== String(requestAccountId)
            || !current.token
          ) return;
          if (job.result) {
            setActiveTrip(job.result);
            router.push('/(tabs)/plan' as any);
          }
        } catch {}
      } else if (data?.type === 'trail_alert') {
        router.push('/(tabs)/report');
      } else if (data?.type === 'contest' || data?.type === 'credits_promo') {
        router.push('/(tabs)/profile');
      } else if (data?.type === 'community_event' || data?.type === 'admin_campaign') {
        router.push('/(tabs)/guide');
      } else {
        router.push('/(tabs)/guide');
      }
    });

    Linking.getInitialURL().then(handleIncomingUrl).catch(() => {});
    const linkSub = Linking.addEventListener('url', event => {
      handleIncomingUrl(event.url).catch(() => {});
    });
    const branchUnsubscribe = startBranchReferralAttribution(code => {
      if (useStore.getState().user) return false;
      router.push({
        pathname: '/(tabs)/profile',
        params: { auth: 'register', referral_code: code },
      } as any);
      return true;
    });

    return () => {
      launchCancelled = true;
      stopTripRepositoryAutoSync.current?.();
      stopTripRepositoryAutoSync.current = null;
      void cancelTripRepositorySync();
      notifSub.remove();
      linkSub.remove();
      branchUnsubscribe();
      appStateSub?.remove();
    };
  }, []);

  // Register push token with server whenever user signs in
  useEffect(() => {
    if (!user) {
      pushRegistered.current = false;
      return;
    }
    if (pushRegistered.current) return;
    pushRegistered.current = true;
    const registrationEpoch = accountStorage.epoch();
    const registrationAccountId = user.id;
    storage.get('trailhead_push_token').then(token => {
      if (
        !token
        || accountStorage.epoch() !== registrationEpoch
        || String(useStore.getState().user?.id ?? '') !== String(registrationAccountId)
      ) return;
      accountStorage.run(() => api.registerPushToken(token), registrationEpoch).catch(() => {});
    }).catch(() => {});
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    storage.get(WELCOME_PENDING_ATTR_KEY).then(value => {
      if (value !== '1') return;
      api.logAnalyticsEvent('welcome_gate_cta_attributed', sessionId, { source: 'post_sign_in', user_id: user.id }).catch(() => {});
      storage.del(WELCOME_PENDING_ATTR_KEY).catch(() => {});
    }).catch(() => {});
  }, [sessionId, user]);

  useEffect(() => {
    if (welcomePromptRunId <= 0) return;
    openWelcomeWalkthrough();
  }, [welcomePromptRunId]);

  useEffect(() => {
    if (welcomeSetupRunId <= 0) return;
    setWelcomeGateSource('profile');
    setWelcomeGateMode('setup');
    setWelcomeGateVisible(true);
    logWelcomeEvent('welcome_gate_seen', { source: 'profile_setup' });
  }, [welcomeSetupRunId]);

  useEffect(() => {
    if (!startupReady || launchLoaderVisible || welcomeGateChecked.current) return;
    welcomeGateChecked.current = true;
    shouldShowWelcomeGate(!!user).then(show => {
      if (!show) return;
      setWelcomeGateSource('first_open');
      setWelcomeGateMode('welcome');
      setWelcomeGateVisible(true);
      logWelcomeEvent('welcome_gate_seen', { source: 'first_open' });
    }).catch(() => {});
  }, [launchLoaderVisible, startupReady, user]);

  useEffect(() => {
    if (launchLoaderVisible) return;
    let cancelled = false;
    (async () => {
      const existing = await Location.getForegroundPermissionsAsync().catch(() => null);
      // Never interrupt first-run discovery with a permission prompt. Nearby,
      // Map, and active navigation request location in their own context.
      if (cancelled || existing?.status !== 'granted') return;
      const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
      if (!cancelled && fix?.coords) {
        setUserLoc({ lat: fix.coords.latitude, lng: fix.coords.longitude });
      }
    })();
    return () => { cancelled = true; };
  }, [launchLoaderVisible, setUserLoc]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <OriginalsRuntimeProvider>
      <StatusBar style={themeMode === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }} />
      <WelcomeGate
        key={`${welcomeGateMode}:${welcomeGateVisible ? 'visible' : 'hidden'}`}
        visible={welcomeGateVisible}
        initialMode={welcomeGateMode}
        onSignIn={signInFromWelcomeGate}
        onContinue={continueFromWelcomeGate}
        onSetupComplete={completeWelcomeSetup}
        onSetupSkip={skipWelcomeSetup}
      />
      <WelcomeOnboardingModal
        visible={welcomeVisible}
        onClose={closeWelcomeWalkthrough}
        onReviewSetup={reviewSetupFromWalkthrough}
      />
      {updateBanner && (
        <View style={{
          position: 'absolute', bottom: 90 + Math.max(insets.bottom, 0), left: 16, right: 16, zIndex: 9999,
          backgroundColor: '#1a2e1a', borderRadius: 12, borderWidth: 1, borderColor: '#22c55e',
          flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12,
        }}>
          <Ionicons name="arrow-up-outline" size={18} color="#22c55e" />
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800', fontFamily: mono }}>Update ready</Text>
            <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, fontFamily: mono, marginTop: 2 }}>
              New features are ready — restart to apply
            </Text>
          </View>
          <TouchableOpacity
            onPress={applyUpdate}
            style={{ backgroundColor: '#22c55e', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 }}
          >
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '900', fontFamily: mono }}>RESTART</Text>
          </TouchableOpacity>
        </View>
      )}
      {launchLoaderVisible ? <TrailheadLaunchLoader /> : null}
      </OriginalsRuntimeProvider>
    </GestureHandlerRootView>
  );
}

export default withTrailheadTelemetry(RootLayout);
