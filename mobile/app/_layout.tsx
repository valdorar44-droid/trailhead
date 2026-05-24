import '@/lib/backgroundTasks'; // must be first — registers background location task
import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Linking, Modal, ScrollView, View, Text, TouchableOpacity } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { storage } from '@/lib/storage';
import * as Notifications from 'expo-notifications';
import * as Updates from 'expo-updates';
import { useStore } from '@/lib/store';
import { api } from '@/lib/api';
import { useTheme, mono } from '@/lib/design';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function RootLayout() {
  const setAuth            = useStore(s => s.setAuth);
  const setPlan            = useStore(s => s.setPlan);
  const setActiveTrip      = useStore(s => s.setActiveTrip);
  const restoreActiveTrip  = useStore(s => s.restoreActiveTrip);
  const themeMode    = useStore(s => s.themeMode);
  const user         = useStore(s => s.user);
  const sessionId    = useStore(s => s.sessionId);
  const welcomePromptRunId = useStore(s => s.welcomePromptRunId);
  const router       = useRouter();
  const C            = useTheme();
  const insets       = useSafeAreaInsets();
  const [updateBanner, setUpdateBanner] = useState(false);
  const [welcomeVisible, setWelcomeVisible] = useState(false);
  const updateReady  = useRef(false);
  const checking     = useRef(false);
  const pushRegistered = useRef(false);

  // We auto-apply OTA updates that arrive within ~10s of launch (so users get
  // the latest code on every cold start with one short reload). After that
  // window we fall back to a banner so we don't interrupt active use.
  const launchAtRef = useRef(Date.now());
  const WELCOME_SEEN_KEY = 'trailhead_welcome_contest_seen_v1';
  const WELCOME_PENDING_ATTR_KEY = 'trailhead_welcome_contest_clicked_pending_v1';

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
    try {
      const res = await api.verifyEmail(token);
      setAuth(res.token, res.user);
      storage.set('trailhead_user', JSON.stringify(res.user)).catch(() => {});
      Alert.alert('Email confirmed', 'Your Trailhead account is active.');
      router.push('/(tabs)/profile');
    } catch (e: any) {
      Alert.alert('Verification failed', e?.message ?? 'This verification link is invalid or expired.');
    }
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
    const token = await storage.get('trailhead_token').catch(() => null);
    if (!token) {
      setPlan(false, null);
      return;
    }
    const sub = await api.subscriptionStatus().catch(() => null);
    if (!sub) return;
    if (sub.is_active) {
      setPlan(true, sub.plan_expires_at ?? null);
      storage.del('trailhead_iap_pending').catch(() => {});
    } else {
      setPlan(false, null);
      storage.del('trailhead_iap_pending').catch(() => {});
    }
  }

  function applyUpdate() {
    setUpdateBanner(false);
    Updates.reloadAsync().catch(() => {});
  }

  function logWelcomeEvent(eventType: 'welcome_contest_seen' | 'welcome_contest_cta' | 'welcome_contest_cta_attributed', data: Record<string, unknown> = {}) {
    api.logAnalyticsEvent(eventType, sessionId, data).catch(() => {});
  }

  function closeWelcomeContest() {
    setWelcomeVisible(false);
    storage.set(WELCOME_SEEN_KEY, '1').catch(() => {});
  }

  function openWelcomeContest() {
    setWelcomeVisible(true);
    storage.set(WELCOME_SEEN_KEY, '1').catch(() => {});
    logWelcomeEvent('welcome_contest_seen', { source: 'profile_reopen' });
  }

  function goToProfileFromWelcome() {
    setWelcomeVisible(false);
    storage.set(WELCOME_SEEN_KEY, '1').catch(() => {});
    storage.set(WELCOME_PENDING_ATTR_KEY, '1').catch(() => {});
    logWelcomeEvent('welcome_contest_cta', { source: 'first_open_modal', signed_in: !!user });
    router.push('/(tabs)/profile');
  }

  useEffect(() => {
    let appStateSub: ReturnType<typeof AppState.addEventListener> | null = null;

    if (!__DEV__) {
      // Check immediately on launch
      checkForUpdate();

      // On every foreground: apply if ready, otherwise re-check for new deploys
      appStateSub = AppState.addEventListener('change', state => {
        if (state === 'active') {
          refreshSubscriptionStatus();
          if (updateReady.current) {
            // Update was downloaded while app was backgrounded — apply now
            Updates.reloadAsync().catch(() => {});
          } else {
            checkForUpdate();
          }
        }
      });
    }

    // Restore session on launch
    storage.get('trailhead_token').then(async token => {
      if (!token) return;
      try {
        const user = await api.me();
        storage.set('trailhead_user', JSON.stringify(user)).catch(() => {});
        setAuth(token, user);
        restoreActiveTrip(); // setAuth clears activeTrip; restore from file
        await refreshSubscriptionStatus();
      } catch (e: any) {
        const isNetworkError = !e?.message || e.message.includes('Network') || e.message.includes('fetch') || e instanceof TypeError;
        if (isNetworkError) {
          const cachedUser = await storage.get('trailhead_user').catch(() => null);
          if (cachedUser) {
            try { setAuth(token, JSON.parse(cachedUser)); restoreActiveTrip(); } catch {}
          }
        } else {
          storage.del('trailhead_token');
          storage.del('trailhead_user');
        }
      }
    });

    // NOTE: Do NOT call iap.initConnection() / getAvailablePurchases() here.
    // That hits StoreKit on every cold launch and triggers the iOS "Sign into
    // Apple account" prompt. Subscription status comes from api.subscriptionStatus()
    // above. StoreKit is only called when the user explicitly opens the paywall.

    // Request push permissions and register token with server
    Notifications.requestPermissionsAsync().then(async ({ status }) => {
      if (status !== 'granted') return;
      try {
        const tokenData = await Notifications.getExpoPushTokenAsync({
          projectId: '92c016d2-6e63-480e-a483-a6898d7e77d5',
        });
        const token = tokenData.data;
        // Save token for use after login (user may not be loaded yet)
        storage.set('trailhead_push_token', token).catch(() => {});
      } catch {}
    }).catch(() => {});

    const notifSub = Notifications.addNotificationResponseReceivedListener(async response => {
      const data = response.notification.request.content.data as any;
      if (data?.type === 'trip_ready' && data?.job_id) {
        // User tapped "your route is ready" notification — fetch and load the trip
        try {
          const job = await api.getPlanJob(data.job_id);
          if (job.result) {
            setActiveTrip(job.result);
            router.push('/(tabs)');
          }
        } catch {}
      } else if (data?.type === 'trail_alert') {
        router.push('/(tabs)/report');
      } else {
        router.push('/(tabs)/guide');
      }
    });

    Linking.getInitialURL().then(handleVerificationUrl).catch(() => {});
    const linkSub = Linking.addEventListener('url', event => {
      handleVerificationUrl(event.url);
    });

    storage.get(WELCOME_SEEN_KEY).then(seen => {
      if (!seen) {
        setTimeout(() => {
          setWelcomeVisible(true);
          storage.set(WELCOME_SEEN_KEY, '1').catch(() => {});
          logWelcomeEvent('welcome_contest_seen', { source: 'first_open_modal' });
        }, 900);
      }
    }).catch(() => {});

    return () => {
      notifSub.remove();
      linkSub.remove();
      appStateSub?.remove();
    };
  }, []);

  // Register push token with server whenever user signs in
  useEffect(() => {
    if (!user || pushRegistered.current) return;
    pushRegistered.current = true;
    storage.get('trailhead_push_token').then(token => {
      if (token) api.registerPushToken(token).catch(() => {});
    }).catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!user) return;
    storage.get(WELCOME_PENDING_ATTR_KEY).then(value => {
      if (value !== '1') return;
      api.logAnalyticsEvent('welcome_contest_cta_attributed', sessionId, { source: 'post_sign_in', user_id: user.id }).catch(() => {});
      storage.del(WELCOME_PENDING_ATTR_KEY).catch(() => {});
    }).catch(() => {});
  }, [sessionId, user]);

  useEffect(() => {
    if (welcomePromptRunId <= 0) return;
    openWelcomeContest();
  }, [welcomePromptRunId]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style={themeMode === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }} />
      <Modal visible={welcomeVisible} animationType="fade" transparent onRequestClose={closeWelcomeContest}>
        <View style={{
          flex: 1, backgroundColor: 'rgba(0,0,0,0.66)', justifyContent: 'flex-end',
        }}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={closeWelcomeContest} />
          <View style={{
            margin: 12, marginBottom: Math.max(insets.bottom + 12, 18), borderRadius: 26,
            backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, overflow: 'hidden',
          }}>
            <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} showsVerticalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{
                  width: 48, height: 48, borderRadius: 18, backgroundColor: '#d4af3720',
                  borderWidth: 1, borderColor: '#d4af3755', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Ionicons name="trophy-outline" size={23} color="#f8d77a" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#d4af37', fontSize: 9, fontFamily: mono, fontWeight: '900', letterSpacing: 1.2 }}>WELCOME TO TRAILHEAD</Text>
                  <Text style={{ color: C.text, fontSize: 22, lineHeight: 26, fontWeight: '900', marginTop: 3 }}>
                    Plan smarter. Build the map. Win Trailhead prizes.
                  </Text>
                </View>
                <TouchableOpacity onPress={closeWelcomeContest} style={{
                  width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: C.s2, borderWidth: 1, borderColor: C.border,
                }}>
                  <Ionicons name="close" size={18} color={C.text2} />
                </TouchableOpacity>
              </View>

              <Text style={{ color: C.text2, fontSize: 14, lineHeight: 21 }}>
                Trailhead helps you find camps, trails, public-land context, weather, reports, route tools, offline packs, and field-ready navigation in one app.
              </Text>

              <View style={{ flexDirection: 'row', gap: 8 }}>
                {[
                  ['Camps', 'bonfire-outline'],
                  ['Trails', 'trail-sign-outline'],
                  ['Offline', 'download-outline'],
                ].map(([label, icon]) => (
                  <View key={label} style={{ flex: 1, backgroundColor: C.s2, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 10, gap: 7 }}>
                    <Ionicons name={icon as any} size={17} color={C.orange} />
                    <Text style={{ color: C.text, fontSize: 11, fontFamily: mono, fontWeight: '900' }}>{label.toUpperCase()}</Text>
                  </View>
                ))}
              </View>

              <View style={{ backgroundColor: C.s2, borderRadius: 18, borderWidth: 1, borderColor: '#d4af3744', padding: 14, gap: 8 }}>
                <Text style={{ color: '#d4af37', fontSize: 30, fontFamily: mono, fontWeight: '900' }}>$1,000</Text>
                <Text style={{ color: C.text, fontSize: 16, fontWeight: '900' }}>Register in Profile for the contributor contest.</Text>
                <Text style={{ color: C.text3, fontSize: 12.5, lineHeight: 18 }}>
                  Sign in or create a Profile account to join. Contest points come from useful reports, trail notes, camp updates, confirmations, and other map contributions.
                </Text>
                <Text style={{ color: C.text3, fontSize: 10.5, lineHeight: 15 }}>
                  No purchase necessary. Apple is not a sponsor or involved.
                </Text>
              </View>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity
                  onPress={closeWelcomeContest}
                  style={{ flex: 1, minHeight: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: C.s2, borderWidth: 1, borderColor: C.border }}
                >
                  <Text style={{ color: C.text2, fontSize: 12, fontFamily: mono, fontWeight: '900' }}>NOT NOW</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={goToProfileFromWelcome}
                  style={{ flex: 1.35, minHeight: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: C.orange }}
                >
                  <Text style={{ color: '#fff', fontSize: 12, fontFamily: mono, fontWeight: '900' }}>OPEN PROFILE</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
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
              New features downloaded — restart to apply
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
    </GestureHandlerRootView>
  );
}
