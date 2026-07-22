import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/design';
import { createExpoOfflineV2Persistence } from '@/lib/offlineV2/expoAdapters';
import type { OfflineBundleDownloadJobV2 } from '@/lib/offlineV2/jobStore';
import type { OfflineBundleInstallationV2 } from '@/lib/offlineV2/types';

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'Size unavailable';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function statusLabel(job: OfflineBundleDownloadJobV2) {
  if (job.status === 'preparing') return `Preparing${job.preparation ? ` ${Math.round(job.preparation.progress)}%` : ''}`;
  if (job.status === 'downloading') return 'Downloading';
  if (job.status === 'verifying') return 'Verifying';
  if (job.status === 'paused') return 'Paused';
  if (job.status === 'ready') return 'Ready offline';
  if (job.status === 'repair_required') return 'Repair required';
  if (job.status === 'error') return job.error?.message || 'Download incomplete';
  return 'Queued';
}

function progressFor(job: OfflineBundleDownloadJobV2) {
  const states = Object.values(job.artifact_states);
  const total = states.reduce((sum, state) => sum + state.total_bytes, 0);
  const received = states.reduce((sum, state) => sum + state.received_bytes, 0);
  return { total, received, percentage: total > 0 ? Math.min(100, received / total * 100) : 0 };
}

export default function OfflineDownloadsSection({ ownerScope }: { ownerScope: string }) {
  const C = useTheme();
  const persistence = useMemo(() => createExpoOfflineV2Persistence(ownerScope), [ownerScope]);
  const [jobs, setJobs] = useState<readonly OfflineBundleDownloadJobV2[]>([]);
  const [installations, setInstallations] = useState<readonly OfflineBundleInstallationV2[]>([]);
  const [busyId, setBusyId] = useState('');

  const reload = useCallback(async () => {
    const [nextJobs, nextInstallations] = await Promise.all([
      persistence.jobs.list(ownerScope),
      persistence.repository.listCurrentInstallations(),
    ]);
    setJobs(nextJobs);
    setInstallations(nextInstallations);
  }, [ownerScope, persistence]);

  useEffect(() => {
    let active = true;
    void reload();
    const timer = setInterval(() => {
      if (active) void reload();
    }, jobs.some(job => ['preparing', 'queued', 'downloading', 'verifying'].includes(job.status)) ? 900 : 5_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [jobs, reload]);

  const installedKeys = useMemo(
    () => new Set(installations.map(item => `${item.bundle_id}@${item.revision}`)),
    [installations],
  );
  const visibleJobs = useMemo(() => jobs.filter(job => (
    job.status !== 'ready'
    || !job.manifest
    || installedKeys.has(`${job.manifest.bundle_id}@${job.manifest.revision}`)
  )), [installedKeys, jobs]);

  const act = useCallback(async (job: OfflineBundleDownloadJobV2, action: 'pause' | 'resume' | 'cancel' | 'remove') => {
    if (busyId) return;
    setBusyId(job.job_id);
    try {
      const { getExpoOfflineV2Runtime } = await import('@/lib/offlineV2/expoRuntime');
      const runtime = getExpoOfflineV2Runtime(ownerScope);
      if (action === 'pause') await runtime.pause(job.job_id);
      else if (action === 'resume') void runtime.resume(job.job_id);
      else if (action === 'remove' && job.manifest) await runtime.remove(job.manifest.bundle_id);
      else await runtime.cancel(job.job_id);
      await reload();
    } finally {
      setBusyId('');
    }
  }, [busyId, ownerScope, reload]);

  const removeInstallation = useCallback(async (installation: OfflineBundleInstallationV2) => {
    if (busyId) return;
    setBusyId(installation.bundle_id);
    try {
      const { getExpoOfflineV2Runtime } = await import('@/lib/offlineV2/expoRuntime');
      await getExpoOfflineV2Runtime(ownerScope).remove(installation.bundle_id);
      await reload();
    } finally {
      setBusyId('');
    }
  }, [busyId, ownerScope, reload]);

  if (visibleJobs.length === 0 && installations.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.headingRow}>
        <Text style={[styles.heading, { color: C.text }]}>Downloads</Text>
        <Text style={[styles.count, { color: C.text2 }]}>{installations.length || visibleJobs.length}</Text>
      </View>
      <View style={[styles.list, { borderColor: C.border, backgroundColor: C.s1 }]}>
        {visibleJobs.map((job, index) => {
          const progress = progressFor(job);
          const active = ['preparing', 'queued', 'downloading', 'verifying'].includes(job.status);
          const canResume = ['paused', 'error', 'repair_required'].includes(job.status);
          return (
            <View
              key={job.job_id}
              style={[styles.row, index > 0 && { borderTopColor: C.border, borderTopWidth: StyleSheet.hairlineWidth }]}
            >
              <View style={[styles.icon, { backgroundColor: `${C.orange}18` }]}>
                <Ionicons name="download-outline" size={19} color={C.orange} />
              </View>
              <View style={styles.copy}>
                <Text style={[styles.title, { color: C.text }]} numberOfLines={1}>{job.label}</Text>
                <Text style={[styles.meta, { color: C.text2 }]} numberOfLines={2}>
                  {statusLabel(job)} · {formatBytes(job.manifest?.required_storage_bytes || progress.total)}
                </Text>
                {(active || job.status === 'paused') && progress.total > 0 ? (
                  <View style={[styles.progressTrack, { backgroundColor: C.border }] }>
                    <View style={[styles.progressFill, { backgroundColor: C.orange, width: `${progress.percentage}%` }]} />
                  </View>
                ) : null}
              </View>
              {busyId === job.job_id ? <ActivityIndicator size="small" color={C.orange} /> : active ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={`Pause ${job.label}`}
                  onPress={() => void act(job, 'pause')}
                  style={styles.action}
                >
                  <Ionicons name="pause" size={18} color={C.text} />
                </TouchableOpacity>
              ) : canResume ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={`${job.status === 'repair_required' ? 'Repair' : 'Resume'} ${job.label}`}
                  onPress={() => void act(job, 'resume')}
                  style={styles.action}
                >
                  <Ionicons name={job.status === 'repair_required' ? 'build-outline' : 'play'} size={18} color={C.text} />
                </TouchableOpacity>
              ) : job.status === 'ready' && job.manifest ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${job.label} download`}
                  onPress={() => Alert.alert(
                    `Remove ${job.label}?`,
                    'The downloaded offline content is removed from this device.',
                    [
                      { text: 'Keep download', style: 'cancel' },
                      { text: 'Remove download', style: 'destructive', onPress: () => void act(job, 'remove') },
                    ],
                  )}
                  style={styles.action}
                >
                  <Ionicons name="trash-outline" size={18} color={C.red} />
                </TouchableOpacity>
              ) : null}
            </View>
          );
        })}
        {visibleJobs.length === 0 && installations.map((installation, index) => (
          <View
            key={`${installation.bundle_id}@${installation.revision}`}
            style={[styles.row, index > 0 && { borderTopColor: C.border, borderTopWidth: StyleSheet.hairlineWidth }]}
          >
            <View style={[styles.icon, { backgroundColor: `${C.orange}18` }]}>
              <Ionicons name="checkmark" size={19} color={C.orange} />
            </View>
            <View style={styles.copy}>
              <Text style={[styles.title, { color: C.text }]} numberOfLines={1}>Offline area</Text>
              <Text style={[styles.meta, { color: C.text2 }]}>Ready offline</Text>
            </View>
            {busyId === installation.bundle_id ? <ActivityIndicator size="small" color={C.orange} /> : (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Remove offline area download"
                onPress={() => Alert.alert(
                  'Remove offline area?',
                  'The downloaded offline content is removed from this device.',
                  [
                    { text: 'Keep download', style: 'cancel' },
                    { text: 'Remove download', style: 'destructive', onPress: () => void removeInstallation(installation) },
                  ],
                )}
                style={styles.action}
              >
                <Ionicons name="trash-outline" size={18} color={C.red} />
              </TouchableOpacity>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 28 },
  headingRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 12 },
  heading: { fontSize: 22, lineHeight: 27, fontWeight: '800' },
  count: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  list: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  row: { minHeight: 76, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, gap: 12 },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, lineHeight: 20, fontWeight: '700' },
  meta: { marginTop: 2, fontSize: 12, lineHeight: 17, fontWeight: '500' },
  progressTrack: { height: 3, borderRadius: 2, marginTop: 8, overflow: 'hidden' },
  progressFill: { height: 3, borderRadius: 2 },
  action: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
