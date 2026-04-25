import '@/lib/backgroundTasks'; // must be first — registers background location task
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import * as Updates from 'expo-updates';
import { useStore } from '@/lib/store';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/design';

export default function RootLayout() {
  const setAuth = useStore(s => s.setAuth);
  const themeMode = useStore(s => s.themeMode);
  const router = useRouter();

  useEffect(() => {
    let appStateSub: ReturnType<typeof AppState.addEventListener> | null = null;

    if (!__DEV__) {
      const updateReady = { current: false };
      const firstActive = { current: true };

      // Download update in background — don't restart during launch
      Updates.checkForUpdateAsync().then(async result => {
        if (result.isAvailable) {
          await Updates.fetchUpdateAsync();
          updateReady.current = true;
        }
      }).catch(() => {});

      // Apply only when user returns from background (not mid-session)
      appStateSub = AppState.addEventListener('change', state => {
        if (state === 'active') {
          if (firstActive.current) { firstActive.current = false; return; }
          if (updateReady.current) { Updates.reloadAsync().catch(() => {}); }
        }
      });
    }

    // Restore session on launch
    SecureStore.getItemAsync('trailhead_token').then(async token => {
      if (!token) return;
      try {
        const user = await api.me();
        setAuth(token, user);
      } catch { SecureStore.deleteItemAsync('trailhead_token'); }
    });

    // Request notification permissions on first launch
    Notifications.requestPermissionsAsync().catch(() => {});

    // Route notification taps: trail alerts → report tab, audio guide → guide tab
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
    </>
  );
}
