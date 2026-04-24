import '@/lib/backgroundTasks'; // must be first — registers background location task
import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import { useStore } from '@/lib/store';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/design';

export default function RootLayout() {
  const setAuth = useStore(s => s.setAuth);
  const themeMode = useStore(s => s.themeMode);
  const router = useRouter();

  useEffect(() => {
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
    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data as any;
      if (data?.type === 'trail_alert') {
        router.push('/report');
      } else {
        router.push('/guide');
      }
    });
    return () => sub.remove();
  }, []);

  return (
    <>
      <StatusBar style={themeMode === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}
