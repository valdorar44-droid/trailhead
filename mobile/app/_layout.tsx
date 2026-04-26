import '@/lib/backgroundTasks'; // must be first — registers background location task
import { useEffect, useRef, useState } from 'react';
import { AppState, View, Text, TouchableOpacity } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import * as Updates from 'expo-updates';
import { useStore } from '@/lib/store';
import { api } from '@/lib/api';
import { PRODUCT_IDS } from '@/lib/useSubscription';
import { useTheme, mono } from '@/lib/design';

export default function RootLayout() {
  const setAuth     = useStore(s => s.setAuth);
  const setPlan     = useStore(s => s.setPlan);
  const themeMode   = useStore(s => s.themeMode);
  const router      = useRouter();
  const C           = useTheme();
  const [updateBanner, setUpdateBanner] = useState(false);
  const updateReady  = useRef(false);
  const checking     = useRef(false);

  async function checkForUpdate() {
    if (checking.current) return;
    checking.current = true;
    try {
      const { isAvailable } = await Updates.checkForUpdateAsync();
      if (isAvailable) {
        await Updates.fetchUpdateAsync();
        updateReady.current = true;
        setUpdateBanner(true); // show "update ready" banner
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
    SecureStore.getItemAsync('trailhead_token').then(async token => {
      if (!token) return;
      try {
        const user = await api.me();
        setAuth(token, user);
        // Check subscription status from backend
        const sub = await api.subscriptionStatus().catch(() => null);
        if (sub?.is_active) setPlan(true, sub.plan_expires_at ?? null);
      } catch { SecureStore.deleteItemAsync('trailhead_token'); }
    });

    // Also verify via StoreKit on device — covers reinstalls where backend may lag
    // Lazy-require so old binaries without the native module don't crash
    try {
      const iap = require('expo-iap');
      iap.initConnection().then(async () => {
        try {
          const purchases = await iap.getAvailablePurchases();
          const active = purchases.some((p: any) => {
            const id = p.productId ?? p.id ?? '';
            return id === PRODUCT_IDS.monthly || id === PRODUCT_IDS.annual;
          });
          if (active) setPlan(true);
        } catch {}
        iap.endConnection().catch(() => {});
      }).catch(() => {});
    } catch {
      // Native module not in this binary — skip
    }

    Notifications.requestPermissionsAsync().catch(() => {});

    const notifSub = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data as any;
      if (data?.type === 'trail_alert') {
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
