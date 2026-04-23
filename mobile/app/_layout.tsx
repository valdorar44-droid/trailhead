import '@/lib/backgroundTasks'; // must be first — registers background location task
import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import { useStore } from '@/lib/store';
import { api } from '@/lib/api';

export default function RootLayout() {
  const setAuth = useStore(s => s.setAuth);
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

    // When user taps an audio guide notification, open guide tab
    const sub = Notifications.addNotificationResponseReceivedListener(() => {
      router.push('/guide');
    });
    return () => sub.remove();
  }, []);

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}
