import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRootNavigationState, useRouter } from 'expo-router';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/design';
import { getOfflinePlacePackDiagnosticsInventory } from '@/lib/offlinePlacePacks';
import { createExpoOfflineV2Persistence } from '@/lib/offlineV2/expoAdapters';
import { useOriginalsRuntime } from '@/lib/originals/runtime';
import {
  buildQaDiagnosticsSnapshotV1,
  type QaDiagnosticsSnapshotV1,
} from '@/lib/qa/diagnostics';
import { getActiveTripStateFileBytes } from '@/lib/qa/storageFootprint';
import {
  getTripRepositoryOutbox,
  getTripRepositorySnapshot,
  tripRepositoryScopeKey,
} from '@/lib/tripRepository';
import { getTripRepositoryQaInstrumentation } from '@/lib/tripRepository/qaInstrumentation';
import {
  runSearchRaceQaCheck,
  type SearchRaceQaEvidence,
} from '@/lib/searchV2/qaAcceptance';
import { useStore } from '@/lib/store';
import {
  runTelemetryQaCheck,
  telemetryQaNativeCrashState,
  telemetryQaSurfaceIsAvailable,
} from '@/lib/telemetry/qa';
import { resolveTelemetryQaAccess } from '@/lib/telemetry/qaAccess';
import {
  NATIVE_CRASH_ACKNOWLEDGEMENT,
  type TelemetryQaCheck,
} from '@/lib/telemetry/qaPolicy';

type ProbeStatus = 'idle' | 'running' | 'delivered' | 'blocked';
type SearchRaceStatus = 'idle' | 'running' | 'passed' | 'failed';

function artifactCount(
  artifacts: readonly { kind: string; record_count?: number }[],
  kind: string,
): number {
  return artifacts
    .filter(artifact => artifact.kind === kind)
    .reduce((total, artifact) => total + Math.max(0, Number(artifact.record_count) || 0), 0);
}

export default function TelemetryQaScreen() {
  const C = useTheme();
  const router = useRouter();
  const rootNavigationState = useRootNavigationState();
  const user = useStore(state => state.user);
  const token = useStore(state => state.token);
  const authHydrated = useStore(state => state.authHydrated);
  const activeTrip = useStore(state => state.activeTrip);
  const originals = useOriginalsRuntime();
  const surfaceAllowed = telemetryQaSurfaceIsAvailable(Boolean(token && user?.is_admin));
  const access = resolveTelemetryQaAccess({
    authHydrated,
    navigationReady: Boolean(rootNavigationState?.key),
    surfaceAllowed,
  });
  const [snapshot, setSnapshot] = useState<QaDiagnosticsSnapshotV1 | null>(null);
  const [snapshotState, setSnapshotState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [probeStatus, setProbeStatus] = useState<ProbeStatus>('idle');
  const [nativeCrashAcknowledgement, setNativeCrashAcknowledgement] = useState('');
  const [searchRaceStatus, setSearchRaceStatus] = useState<SearchRaceStatus>('idle');
  const [searchRaceEvidence, setSearchRaceEvidence] = useState<SearchRaceQaEvidence | null>(null);
  const nativeCrashState = telemetryQaNativeCrashState();
  const releaseIdentity = useMemo(() => {
    const extra = (Constants.expoConfig?.extra || {}) as Record<string, unknown>;
    return {
      schema: 'qa_release_identity_v1',
      appVersion: Application.nativeApplicationVersion || Constants.expoConfig?.version || 'unknown',
      buildNumber: Application.nativeBuildVersion || 'unknown',
      channel: Updates.channel || 'embedded',
      commitSha: String(extra.releaseCommitSha || 'unknown'),
      platform: Platform.OS === 'ios' ? 'ios' as const : 'android' as const,
      runtimeVersion: String(Updates.runtimeVersion || Constants.expoConfig?.runtimeVersion || 'unknown'),
      updateId: Updates.updateId || 'embedded',
    };
  }, []);
  const releaseIdentityText = useMemo(() => JSON.stringify(releaseIdentity), [releaseIdentity]);

  useEffect(() => {
    if (access === 'redirect') router.replace('/(tabs)/profile' as any);
  }, [access, router]);

  const refreshSnapshot = useCallback(async () => {
    if (access !== 'allowed' || !user?.id) return;
    setSnapshotState('loading');
    try {
      const ownerScope = `account:${String(user.id)}`;
      const persistence = createExpoOfflineV2Persistence(ownerScope);
      const [
        serverDiagnostics,
        installations,
        offlinePlacePacksV1,
        activeTripStateFileBytes,
      ] = await Promise.all([
        api.adminQaDiagnostics(),
        persistence.repository.listCurrentInstallations(),
        getOfflinePlacePackDiagnosticsInventory(),
        getActiveTripStateFileBytes(),
      ]);
      const offlineBundles = await Promise.all(installations.map(async installation => {
        const manifest = await persistence.repository.getManifest(
          installation.bundle_id,
          installation.revision,
        );
        return {
          placeRecords: manifest ? artifactCount(manifest.artifacts, 'places') : 0,
          revision: installation.revision,
          searchRecords: manifest ? artifactCount(manifest.artifacts, 'search_index') : 0,
          state: manifest ? 'ready' : 'repair_required',
          trailRecords: manifest ? artifactCount(manifest.artifacts, 'trails') : 0,
        };
      }));
      const activeOriginal = originals.session || originals.manifest;
      const jsMemory = (globalThis as any)?.performance?.memory;
      const tripRepositorySnapshot = getTripRepositorySnapshot();
      const tripRepositoryInstrumentation = getTripRepositoryQaInstrumentation(
        tripRepositoryScopeKey(tripRepositorySnapshot.ownerScope),
      );
      setSnapshot(buildQaDiagnosticsSnapshotV1({
        release: releaseIdentity,
        accountRole: 'admin',
        features: {
          configured: {
            offlineV2: serverDiagnostics.configured.offline_v2,
            originals: serverDiagnostics.configured.originals,
            searchV2: serverDiagnostics.configured.search_v2,
            uiSystemV2: serverDiagnostics.configured.ui_system_v2,
          },
          effectiveAccess: {
            offlineV2: serverDiagnostics.effective_access.offline_v2,
            originals: serverDiagnostics.effective_access.originals,
            searchV2: serverDiagnostics.effective_access.search_v2,
            uiSystemV2: serverDiagnostics.effective_access.ui_system_v2,
          },
        },
        offlineBundles,
        offlinePlacePacksV1,
        runtimeMemory: {
          jsHeapTotalBytes: jsMemory?.totalJSHeapSize,
          jsHeapUsedBytes: jsMemory?.usedJSHeapSize,
        },
        tripRepository: {
          stateFileBytes: tripRepositoryInstrumentation.stateFileBytes,
          tripCount: tripRepositorySnapshot.trips.length,
          savedEntityCount: tripRepositorySnapshot.savedEntities.length,
          outboxCount: getTripRepositoryOutbox().length,
          hydration: tripRepositoryInstrumentation.hydration,
          persist: tripRepositoryInstrumentation.persist,
        },
        activeTrip: activeTrip
          ? {
              serializedBytes: activeTripStateFileBytes,
              audioGuideEntryCount: Object.keys(activeTrip.audio_guide || {}).length,
              routeCoordinateCount: activeTrip.route_geometry?.coords?.length || 0,
              routeStepCount: activeTrip.route_geometry?.steps?.length || 0,
              routeLegCount: activeTrip.route_geometry?.legs?.length || 0,
              waypointCount: activeTrip.plan?.waypoints?.length || 0,
            }
          : null,
        original: activeOriginal
          ? { packId: activeOriginal.pack_id, version: activeOriginal.version }
          : null,
      }));
      setSnapshotState('ready');
    } catch {
      setSnapshot(null);
      setSnapshotState('unavailable');
    }
  }, [access, activeTrip, originals.manifest, originals.session, releaseIdentity, user?.id]);

  useEffect(() => {
    void refreshSnapshot();
  }, [refreshSnapshot]);

  const runProbe = useCallback(async (check: TelemetryQaCheck) => {
    if (probeStatus === 'running') return;
    setProbeStatus('running');
    try {
      await runTelemetryQaCheck(check);
      setProbeStatus('delivered');
    } catch {
      setProbeStatus('blocked');
    }
  }, [probeStatus]);

  const requestNativeCrash = useCallback(() => {
    if (
      probeStatus === 'running'
      || nativeCrashState !== 'ready'
      || nativeCrashAcknowledgement !== NATIVE_CRASH_ACKNOWLEDGEMENT
    ) return;
    Alert.alert(
      'Crash this Android emulator?',
      'Trailhead will send one fixed, scrubbed QA marker, then close. Reopen the preview to continue.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Crash emulator',
          style: 'destructive',
          onPress: () => {
            setProbeStatus('running');
            void runTelemetryQaCheck('native_crash', { nativeCrashAcknowledgement })
              .then(() => setProbeStatus('delivered'))
              .catch(() => setProbeStatus('blocked'));
          },
        },
      ],
    );
  }, [nativeCrashAcknowledgement, nativeCrashState, probeStatus]);

  const runSearchRace = useCallback(async () => {
    if (searchRaceStatus === 'running') return;
    setSearchRaceStatus('running');
    setSearchRaceEvidence(null);
    try {
      setSearchRaceEvidence(await runSearchRaceQaCheck());
      setSearchRaceStatus('passed');
    } catch {
      setSearchRaceStatus('failed');
    }
  }, [searchRaceStatus]);

  const snapshotText = useMemo(
    () => snapshot ? JSON.stringify(snapshot, null, 2) : '',
    [snapshot],
  );

  if (access !== 'allowed') {
    return <SafeAreaView testID="qa.telemetry.blocked" style={{ flex: 1, backgroundColor: C.bg }} />;
  }

  return (
    <SafeAreaView testID="qa.telemetry.screen" style={[styles.safe, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { borderBottomColor: C.border }]}>
        <TouchableOpacity
          testID="qa.telemetry.close"
          accessibilityRole="button"
          accessibilityLabel="Close telemetry check"
          onPress={() => router.back()}
          style={[styles.close, { borderColor: C.border }]}
        >
          <Text style={[styles.closeText, { color: C.text }]}>Close</Text>
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: C.text }]}>Telemetry check</Text>
          <Text style={[styles.subtitle, { color: C.text2 }]}>Preview admin tools</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.identityCard, { backgroundColor: C.s1, borderColor: C.border }]}>
          <Text style={[styles.identityLabel, { color: C.text }]}>Build identity</Text>
          <Text testID="qa.telemetry.release-identity" selectable style={[styles.identityValue, { color: C.text2 }]}>
            {releaseIdentityText}
          </Text>
        </View>
        <View style={[styles.card, { backgroundColor: C.s1, borderColor: C.border }]}>
          <Text style={[styles.cardTitle, { color: C.text }]}>Delivery</Text>
          <Text testID="qa.telemetry.status" style={[styles.status, { color: C.text2 }]}>
            {probeStatus === 'running' ? 'Sending check…'
              : probeStatus === 'delivered' ? 'Delivery confirmed'
                : probeStatus === 'blocked' ? 'Check blocked'
                  : 'Ready'}
          </Text>
          <TouchableOpacity
            testID="qa.telemetry.javascript-exception"
            accessibilityRole="button"
            onPress={() => void runProbe('javascript_exception')}
            disabled={probeStatus === 'running'}
            style={[styles.primary, { backgroundColor: C.orange }]}
          >
            <Text style={styles.primaryText}>Send JavaScript exception</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="qa.telemetry.performance-span"
            accessibilityRole="button"
            onPress={() => void runProbe('performance_span')}
            disabled={probeStatus === 'running'}
            style={[styles.secondary, { borderColor: C.border }]}
          >
            <Text style={[styles.secondaryText, { color: C.text }]}>Send performance span</Text>
          </TouchableOpacity>
        </View>

        {Platform.OS === 'android' ? (
          <View testID="qa.telemetry.native-crash.state" style={[styles.card, { backgroundColor: C.s1, borderColor: C.border }]}>
            <Text style={[styles.cardTitle, { color: C.text }]}>Android emulator crash</Text>
            <Text style={[styles.body, { color: C.text2 }]}>
              {nativeCrashState === 'emulator_required'
                ? 'Available only on an Android emulator.'
                : nativeCrashState === 'privacy_boundary_unverified'
                  ? 'Unavailable because private native context could be attached.'
                  : nativeCrashState === 'native_module_unavailable'
                    ? 'Unavailable in this build.'
                    : `Type ${NATIVE_CRASH_ACKNOWLEDGEMENT} to enable this one-time check.`}
            </Text>
            <TextInput
              testID="qa.telemetry.native-crash.acknowledgement"
              accessibilityLabel="Native crash acknowledgement"
              autoCapitalize="characters"
              autoCorrect={false}
              editable={nativeCrashState === 'ready' && probeStatus !== 'running'}
              value={nativeCrashAcknowledgement}
              onChangeText={setNativeCrashAcknowledgement}
              placeholder={NATIVE_CRASH_ACKNOWLEDGEMENT}
              placeholderTextColor={C.text3}
              style={[styles.acknowledgement, { borderColor: C.border, color: C.text }]}
            />
            <TouchableOpacity
              testID="qa.telemetry.native-crash"
              accessibilityRole="button"
              accessibilityLabel="Crash Android emulator for telemetry check"
              onPress={requestNativeCrash}
              disabled={
                nativeCrashState !== 'ready'
                || nativeCrashAcknowledgement !== NATIVE_CRASH_ACKNOWLEDGEMENT
                || probeStatus === 'running'
              }
              style={[
                styles.danger,
                { borderColor: C.red },
                (nativeCrashState !== 'ready'
                  || nativeCrashAcknowledgement !== NATIVE_CRASH_ACKNOWLEDGEMENT
                  || probeStatus === 'running') && styles.disabled,
              ]}
            >
              <Text style={[styles.dangerText, { color: C.red }]}>Crash emulator</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={[styles.card, { backgroundColor: C.s1, borderColor: C.border }]}>
          <Text style={[styles.cardTitle, { color: C.text }]}>Search race check</Text>
          <Text testID="qa.search-race.status" style={[styles.status, { color: C.text2 }]}>
            {searchRaceStatus === 'running' ? 'Running deterministic check…'
              : searchRaceStatus === 'passed' ? 'All checks passed'
                : searchRaceStatus === 'failed' ? 'Check failed'
                  : 'Ready'}
          </Text>
          <TouchableOpacity
            testID="qa.search-race.run"
            accessibilityRole="button"
            accessibilityLabel="Run deterministic search race check"
            onPress={() => void runSearchRace()}
            disabled={searchRaceStatus === 'running'}
            style={[styles.secondary, { borderColor: C.border }]}
          >
            <Text style={[styles.secondaryText, { color: C.text }]}>Run search check</Text>
          </TouchableOpacity>
          {searchRaceEvidence ? (
            <View testID="qa.search-race.evidence" style={styles.evidenceList}>
              <Text testID="qa.search-race.stale" style={[styles.body, { color: C.text }]}>Late result rejected</Text>
              <Text testID="qa.search-race.no-auto-open" style={[styles.body, { color: C.text }]}>No result opened automatically</Text>
              <Text testID="qa.search-race.explicit-selection" style={[styles.body, { color: C.text }]}>Explicit selection confirmed</Text>
            </View>
          ) : null}
        </View>

        <View style={[styles.card, { backgroundColor: C.s1, borderColor: C.border }]}>
          <View style={styles.snapshotHeading}>
            <Text style={[styles.cardTitle, { color: C.text }]}>QA snapshot</Text>
            <TouchableOpacity
              testID="qa.telemetry.snapshot.refresh"
              accessibilityRole="button"
              onPress={() => void refreshSnapshot()}
            >
              <Text style={[styles.refresh, { color: C.orange }]}>Refresh</Text>
            </TouchableOpacity>
          </View>
          <Text testID="qa.telemetry.snapshot" selectable style={[styles.snapshot, { color: C.text2 }]}>
            {snapshotState === 'loading' ? 'Loading…'
              : snapshotState === 'unavailable' ? 'Snapshot unavailable'
                : snapshotText}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { minHeight: 72, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 14 },
  close: { minWidth: 48, minHeight: 48, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  closeText: { fontSize: 15, fontWeight: '700' },
  headerCopy: { flex: 1 },
  title: { fontSize: 25, lineHeight: 30, fontWeight: '900' },
  subtitle: { marginTop: 2, fontSize: 13, lineHeight: 18 },
  content: { padding: 16, paddingBottom: 48, gap: 14 },
  identityCard: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 6 },
  identityLabel: { fontSize: 15, lineHeight: 20, fontWeight: '800' },
  identityValue: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12, lineHeight: 18 },
  card: { borderWidth: 1, borderRadius: 20, padding: 16, gap: 12 },
  cardTitle: { fontSize: 19, lineHeight: 24, fontWeight: '800' },
  status: { fontSize: 14, lineHeight: 20 },
  body: { fontSize: 15, lineHeight: 21 },
  evidenceList: { gap: 6 },
  primary: { minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  secondary: { minHeight: 48, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  secondaryText: { fontSize: 15, fontWeight: '800' },
  danger: { minHeight: 48, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  dangerText: { fontSize: 15, fontWeight: '800' },
  acknowledgement: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, fontSize: 15 },
  disabled: { opacity: 0.4 },
  snapshotHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  refresh: { minHeight: 44, paddingHorizontal: 8, textAlignVertical: 'center', fontSize: 14, fontWeight: '800' },
  snapshot: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12, lineHeight: 18 },
});
