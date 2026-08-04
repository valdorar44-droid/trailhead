import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/design';
import {
  originalAccessStore,
  originalBundleStore,
  originalsApi,
  useOriginalsAdminRuntime,
  useOriginalsRuntime,
} from '@/lib/originals';
import { useStore } from '@/lib/store';

export default function OriginalDraftPreviewScreen() {
  const C = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{
    id?: string | string[];
    chapter?: string | string[];
    variant?: string | string[];
  }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id || '';
  const chapter = Array.isArray(params.chapter) ? params.chapter[0] : params.chapter || '';
  const variant = Array.isArray(params.variant) ? params.variant[0] : params.variant || '';
  const user = useStore(state => state.user);
  const runtime = useOriginalsRuntime();
  const adminRuntime = useOriginalsAdminRuntime();
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  const adminRuntimeRef = useRef(adminRuntime);
  adminRuntimeRef.current = adminRuntime;
  const startedRef = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState('Preparing Studio draft');
  const [error, setError] = useState('');

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let active = true;
    let simulationStarted = false;
    let handedToPlayer = false;
    const abortController = new AbortController();
    void (async () => {
      if (!id) throw new Error('Choose a Studio draft to test.');
      if (!user?.id || !user.is_admin) throw new Error('An admin account is required for unpublished draft testing.');
      setError('');
      setPhase('Checking the latest saved revision');
      const selection: { chapter_id: string; variant_id: string } | undefined = chapter && variant
        ? { chapter_id: chapter, variant_id: variant }
        : undefined;
      const manifest = await originalsApi.adminPreviewManifest(id, selection);
      if (manifest.schema_version === 2 && !selection) {
        throw new Error('Choose a chapter and direction before opening this draft test.');
      }
      if (!active) return;
      const scope = `account:${String(user.id)}` as const;
      const previousPreviews = (await originalAccessStore.list(scope)).filter(item => (
        item.pack_id === manifest.pack_id
        && item.access_type === 'admin_preview'
        && item.version !== manifest.version
      ));
      await originalAccessStore.recordAdminPreview(manifest, user.id);
      setPhase('Downloading and verifying the draft');
      await runtimeRef.current.downloadOriginal(manifest, {
        signal: abortController.signal,
        pinVersion: false,
      });
      if (!active) return;
      await Promise.all(previousPreviews.map(async item => {
        await originalBundleStore.remove(scope, item.pack_id, item.version).catch(() => {});
        await originalAccessStore.remove(scope, item.pack_id, item.version).catch(() => {});
      }));
      setPhase('Opening the trigger test');
      await adminRuntimeRef.current.startSimulation(manifest, selection);
      simulationStarted = true;
      if (!active) {
        await runtimeRef.current.stopTour().catch(() => {});
        return;
      }
      handedToPlayer = true;
      router.replace({
        pathname: '/originals/player',
        params: {
          id: manifest.pack_id,
          version: String(manifest.version),
          simulate: '1',
          chapter: selection?.chapter_id,
          variant: selection?.variant_id,
        },
      } as any);
    })().catch((caught: any) => {
      if (!active) return;
      setError(caught?.message || 'The Studio draft could not be prepared on this device.');
    });
    return () => {
      active = false;
      abortController.abort();
      if (simulationStarted && !handedToPlayer) void runtimeRef.current.stopTour().catch(() => {});
    };
  }, [attempt, chapter, id, router, user?.id, user?.is_admin, variant]);

  const progress = runtime.downloadProgress;
  const progressLabel = progress
    ? `${Math.round(progress.percentage)}% · ${progress.phase.replace(/_/g, ' ')}`
    : phase;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: C.bg }] }>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.screenContent}>
        <View style={[styles.card, { backgroundColor: C.s1, borderColor: C.border }] }>
        <View style={[styles.icon, { backgroundColor: C.orange + '18' }] }>
          <Ionicons name={error ? 'alert-circle-outline' : 'speedometer-outline'} size={28} color={C.orange} />
        </View>
        <Text style={[styles.kicker, { color: C.orange }]}>ADMIN · DRAFT TRIGGER TEST</Text>
        <Text style={[styles.title, { color: C.text }]}>{error ? 'Draft test needs attention' : 'Preparing the no-driving test'}</Text>
        <Text accessibilityLiveRegion="polite" style={[styles.body, { color: C.text2 }]}>{error || progressLabel}</Text>
        {progress ? (
          <View style={[styles.track, { backgroundColor: C.s3 }] }>
            <View style={[styles.fill, { width: `${Math.max(2, Math.round(progress.percentage))}%`, backgroundColor: C.orange }]} />
          </View>
        ) : null}
        {!error ? (
          <View style={styles.preparingActions}>
            <ActivityIndicator color={C.orange} />
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancel draft preparation" onPress={() => router.back()} style={[styles.cancel, { borderColor: C.border }] }>
              <Text style={[styles.secondaryText, { color: C.text2 }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.actions}>
            <TouchableOpacity accessibilityRole="button" onPress={() => router.back()} style={[styles.secondary, { borderColor: C.border }] }>
              <Text style={[styles.secondaryText, { color: C.text2 }]}>Back</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => {
                startedRef.current = false;
                setAttempt(value => value + 1);
              }}
              style={[styles.primary, { backgroundColor: C.orange }]}
            >
              <Ionicons name="refresh" size={16} color="#FFFFFF" />
              <Text style={styles.primaryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        )}
        <Text style={[styles.note, { color: C.text3 }]}>The draft remains unpublished. Synthetic results and playback do not alter saved drive progress or release analytics.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  screenContent: { flexGrow: 1, paddingHorizontal: 22, paddingVertical: 24, alignItems: 'center', justifyContent: 'center' },
  card: { width: '100%', maxWidth: 460, borderWidth: 1, borderRadius: 24, padding: 22, alignItems: 'center' },
  icon: { width: 54, height: 54, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  kicker: { marginTop: 16, fontSize: 8.5, lineHeight: 12, fontWeight: '900', letterSpacing: 0.9 },
  title: { marginTop: 5, fontSize: 22, lineHeight: 27, fontWeight: '900', textAlign: 'center', letterSpacing: -0.35 },
  body: { marginTop: 8, fontSize: 12, lineHeight: 18, fontWeight: '700', textAlign: 'center' },
  track: { width: '100%', height: 7, marginTop: 17, borderRadius: 999, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 999 },
  actions: { width: '100%', marginTop: 18, flexDirection: 'row', gap: 9 },
  preparingActions: { width: '100%', marginTop: 18, gap: 14, alignItems: 'center' },
  cancel: { width: '100%', minHeight: 48, borderWidth: 1, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  secondary: { flex: 1, minHeight: 48, borderWidth: 1, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontSize: 11, fontWeight: '900' },
  primary: { flex: 1, minHeight: 48, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  primaryText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  note: { marginTop: 18, fontSize: 8.5, lineHeight: 13, fontWeight: '700', textAlign: 'center' },
});
