import '@/lib/backgroundTasks'; // must be first — registers background location task
import { useEffect, useRef, useState } from 'react';
import { AppState, View, Text, TouchableOpacity } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { storage } from '@/lib/storage';
import * as Notifications from 'expo-notifications';
import * as Updates from 'expo-updates';
import { useStore } from '@/lib/store';
import { api } from '@/lib/api';
import { PRODUCT_IDS } from '@/lib/useSubscription';
import { useTheme, mono } from '@/lib/design';

export default function RootLayout() {
  const setAuth      = useStore(s => s.setAuth);
  const setPlan      = useStore(s => s.setPlan);
  const setActiveTrip = useStore(s => s.setActiveTrip);
  const themeMode    = useStore(s => s.themeMode);
  const user         = useStore(s => s.user);
  const router       = useRouter();
  const C            = useTheme();
  const [updateBanner, setUpdateBanner] = useState(false);
  const updateReady  = useRef(false);
  const checking     = useRef(false);
  const pushRegistered = useRef(false);

  // We auto-apply OTA updates that arrive within ~10s of launch (so users get
  // the latest code on every cold start with one short reload). After that
  // window we fall back to a banner so we don't interrupt active use.
  const launchAtRef = useRef(Date.now());

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

  function applyUpdate() {
    setUpdateBanner(false);
    Updates.reloadAsync().catch(() => {});
  }

  useEffect(() => {
    let appStateSub: ReturnType<typeof AppState.addEventListener> | null = null;

    if (!__DEV__) {
      // Check immediately on launch
      checkForUpdate();

      // On every foreground: apply if ready, otherwise re-check for new deploys
      appStateSub = AppState.addEventListener('change', state => {
        if (state === 'active') {
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
        const sub = await api.subscriptionStatus().catch(() => null);
        if (sub?.is_active) setPlan(true, sub.plan_expires_at ?? null);
      } catch (e: any) {
        const isNetworkError = !e?.message || e.message.includes('Network') || e.message.includes('fetch') || e instanceof TypeError;
        if (isNetworkError) {
          const cachedUser = await storage.get('trailhead_user').catch(() => null);
          if (cachedUser) {
            try { setAuth(token, JSON.parse(cachedUser)); } catch {}
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
            router.push('/(tabs)/');
          }
        } catch {}
      } else if (data?.type === 'trail_alert') {
        router.push('/report');
      } else {
        router.push('/guide');
      }
    });

    return () => {
      notifSub.remove();
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

  return (
    <>
      <StatusBar style={themeMode === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }} />
      {updateBanner && (
        <View style={{
          position: 'absolute', bottom: 90, left: 16, right: 16, zIndex: 9999,
          backgroundColor: '#1a2e1a', borderRadius: 12, borderWidth: 1, borderColor: '#22c55e',
          flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12,
        }}>
          <Text style={{ color: '#22c55e', fontSize: 16 }}>⬆</Text>
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
    </>
  );
}
