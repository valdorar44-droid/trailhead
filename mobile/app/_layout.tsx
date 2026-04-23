import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import { useStore } from '@/lib/store';
import { api } from '@/lib/api';

export default function RootLayout() {
  const setAuth = useStore(s => s.setAuth);

  useEffect(() => {
    // Restore session on launch
    SecureStore.getItemAsync('trailhead_token').then(async token => {
      if (!token) return;
      try {
        const user = await api.me();
        setAuth(token, user);
      } catch { SecureStore.deleteItemAsync('trailhead_token'); }
    });
  }, []);

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}
