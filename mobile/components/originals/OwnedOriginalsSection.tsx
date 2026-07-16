import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '@/lib/design';
import { useStore } from '@/lib/store';
import { listOwnedOriginals, restoreOwnedOriginals } from './originalsUiService';
import type { OriginalUiSummary } from './types';

export default function OwnedOriginalsSection() {
  const C = useTheme();
  const router = useRouter();
  const accountId = useStore(state => state.user?.id ?? null);
  const [items, setItems] = useState<OriginalUiSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listOwnedOriginals());
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [accountId, load]);
  if (!loading && items.length === 0 && accountId == null) return null;

  const restore = async () => {
    setRestoring(true);
    setRestoreMessage('');
    try {
      const count = await restoreOwnedOriginals();
      await load();
      setRestoreMessage(count ? `${count} restored` : 'Up to date');
    } catch (error) {
      setRestoreMessage(error instanceof Error ? error.message : 'Restore failed');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <View style={styles.section}>
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <View style={styles.titleRow}>
            <Ionicons name="navigate-outline" size={15} color={C.orange} />
            <Text style={[styles.heading, { color: C.text }]}>Trailhead Originals</Text>
          </View>
          <Text style={[styles.subheading, { color: C.text2 }]}>Downloads and listening progress</Text>
        </View>
        <View style={styles.headerActions}>
          {accountId != null ? (
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Restore Trailhead Originals" accessibilityState={{ busy: restoring }} disabled={restoring} onPress={() => void restore()} style={styles.browse}>
              {restoring ? <ActivityIndicator size="small" color={C.orange} /> : <Ionicons name="refresh" size={14} color={C.orange} />}
              <Text style={[styles.browseText, { color: C.orange }]}>Restore</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Browse Trailhead Originals" onPress={() => router.push('/originals' as any)} style={styles.browse}>
            <Text style={[styles.browseText, { color: C.orange }]}>Browse</Text>
            <Ionicons name="arrow-forward" size={14} color={C.orange} />
          </TouchableOpacity>
        </View>
      </View>
      {restoreMessage ? <Text accessibilityLiveRegion="polite" style={[styles.restoreMessage, { color: C.text2 }]}>{restoreMessage}</Text> : null}
      <View style={[styles.list, { borderTopColor: C.border }] }>
        {loading ? (
          <View style={[styles.loading, { borderBottomColor: C.border }] }>
            <ActivityIndicator size="small" color={C.orange} />
            <Text style={[styles.loadingText, { color: C.text2 }]}>Checking downloaded Originals</Text>
          </View>
        ) : items.length === 0 ? (
          <View style={[styles.empty, { borderBottomColor: C.border }] }>
            <Text style={[styles.loadingText, { color: C.text2 }]}>No Originals found for this account.</Text>
          </View>
        ) : items.map(item => {
          const progress = Math.max(0, Math.min(1, item.progress || 0));
          const status = progress > 0
            ? `${Math.round(progress * 100)}% complete`
            : item.downloadState === 'ready'
              ? 'Downloaded · ready offline'
              : item.downloadState === 'update_available'
                ? 'Ready · update available'
                : 'Owned · download required';
          return (
            <TouchableOpacity
              key={`${item.id}:${item.version}`}
              accessibilityRole="button"
              accessibilityLabel={`Open ${item.title}. ${status}`}
              activeOpacity={0.72}
              onPress={() => router.push({ pathname: '/originals/[id]', params: { id: item.id, version: String(item.version) } } as any)}
              style={[styles.row, { borderBottomColor: C.border }]}
            >
              <View style={[styles.icon, { backgroundColor: C.orange + '14', borderColor: C.orange + '3D' }] }>
                <Ionicons name={progress > 0 ? 'play' : item.downloadState === 'ready' ? 'cloud-done-outline' : 'map-outline'} size={17} color={C.orange} />
              </View>
              <View style={styles.rowCopy}>
                <Text style={[styles.rowTitle, { color: C.text }]} numberOfLines={1}>{item.title}</Text>
                <Text style={[styles.rowMeta, { color: C.text2 }]} numberOfLines={1}>{status}</Text>
                {progress > 0 ? (
                  <View style={[styles.progressTrack, { backgroundColor: C.s3 }] }>
                    <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%`, backgroundColor: C.orange }]} />
                  </View>
                ) : null}
              </View>
              <Text style={[styles.action, { color: C.orange }]}>{progress > 0 ? 'RESUME' : 'OPEN'}</Text>
              <Ionicons name="chevron-forward" size={16} color={C.text3} />
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 11 },
  headingRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  headingCopy: { flex: 1, minWidth: 0 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heading: { fontSize: 18, lineHeight: 23, fontWeight: '800' },
  subheading: { marginTop: 2, fontSize: 11.5, lineHeight: 16, fontWeight: '600' },
  browse: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4 },
  browseText: { fontSize: 11.5, fontWeight: '900' },
  restoreMessage: { marginTop: -5, fontSize: 10.5, lineHeight: 14, fontWeight: '700', textAlign: 'right' },
  list: { borderTopWidth: StyleSheet.hairlineWidth },
  loading: { minHeight: 64, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 9 },
  loadingText: { fontSize: 11.5, fontWeight: '700' },
  empty: { minHeight: 54, borderBottomWidth: StyleSheet.hairlineWidth, justifyContent: 'center' },
  row: { minHeight: 72, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 9 },
  icon: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 13.5, lineHeight: 18, fontWeight: '800' },
  rowMeta: { marginTop: 2, fontSize: 10.5, lineHeight: 14, fontWeight: '600' },
  progressTrack: { height: 4, marginTop: 6, borderRadius: 999, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 999 },
  action: { fontSize: 8.5, lineHeight: 11, fontWeight: '900', letterSpacing: 0.7 },
});
