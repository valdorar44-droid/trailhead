import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '@/lib/design';
import { findAuthorizedPlanItem } from '@/lib/planDeepLinks';
import { useStore } from '@/lib/store';
import { listOwnedOriginals, restoreOwnedOriginals } from './originalsUiService';
import type { OriginalUiSummary } from './types';

type OwnedOriginalsSectionProps = Readonly<{
  requestedOriginalId?: string;
  onRequestedOriginalHandled?: (result: 'opened' | 'not_owned') => void;
}>;

export default function OwnedOriginalsSection({
  requestedOriginalId,
  onRequestedOriginalHandled,
}: OwnedOriginalsSectionProps = {}) {
  const C = useTheme();
  const router = useRouter();
  const accountId = useStore(state => state.user?.id ?? null);
  const accountScope = accountId == null ? 'guest' : `account:${String(accountId)}`;
  const currentScopeRef = useRef(accountScope);
  currentScopeRef.current = accountScope;
  const requestRef = useRef(0);
  const handledRequestRef = useRef('');
  const [view, setView] = useState<{
    scope: string;
    items: OriginalUiSummary[];
    verified: boolean;
    loaded: boolean;
    error: string;
  }>({ scope: '', items: [], verified: false, loaded: false, error: '' });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState('');

  const load = useCallback(async (scope: string, initial = false) => {
    const request = ++requestRef.current;
    if (initial) setLoading(true);
    else setRefreshing(true);
    try {
      const result = await listOwnedOriginals();
      if (request !== requestRef.current || currentScopeRef.current !== scope || result.stale) return;
      setView({
        scope,
        items: result.items,
        verified: result.verified,
        loaded: true,
        error: result.error ?? '',
      });
    } catch {
      if (request !== requestRef.current || currentScopeRef.current !== scope) return;
      setView(previous => ({
        scope,
        items: previous.scope === scope ? previous.items : [],
        verified: false,
        loaded: true,
        error: 'Your Originals could not refresh. Check your connection and retry.',
      }));
    } finally {
      if (request === requestRef.current && currentScopeRef.current === scope) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    requestRef.current += 1;
    setRestoreMessage('');
    setRestoring(false);
    void load(accountScope, true);
    return () => { requestRef.current += 1; };
  }, [accountScope, load]);

  const scopedView = view.scope === accountScope
    ? view
    : { items: [] as OriginalUiSummary[], verified: false, loaded: false, error: '' };
  const items = scopedView.items;

  useEffect(() => {
    if (!requestedOriginalId) {
      handledRequestRef.current = '';
      return;
    }
    if (!scopedView.loaded || !scopedView.verified) return;
    const requestKey = `${accountScope}:${requestedOriginalId}`;
    if (handledRequestRef.current === requestKey) return;
    handledRequestRef.current = requestKey;
    // The external identifier never drives a detail fetch. It must first
    // resolve against this scope's verified entitlement list.
    const owned = findAuthorizedPlanItem(requestedOriginalId, items);
    if (!owned) {
      onRequestedOriginalHandled?.('not_owned');
      return;
    }
    onRequestedOriginalHandled?.('opened');
    router.push({
      pathname: '/originals/[id]',
      params: { id: owned.id, version: String(owned.version) },
    } as any);
  }, [accountScope, items, onRequestedOriginalHandled, requestedOriginalId, router, scopedView.loaded, scopedView.verified]);

  // Trips is an ownership surface, not another Originals acquisition entry.
  // A verified empty library stays hidden; a failed check retains recovery controls.
  if (items.length === 0 && !scopedView.error) return null;

  const restore = async () => {
    const restoreScope = accountScope;
    setRestoring(true);
    setRestoreMessage('');
    try {
      const count = await restoreOwnedOriginals();
      if (currentScopeRef.current !== restoreScope) return;
      await load(restoreScope);
      if (currentScopeRef.current !== restoreScope) return;
      setRestoreMessage(count ? `${count} restored` : 'Up to date');
    } catch (error) {
      if (currentScopeRef.current !== restoreScope) return;
      setRestoreMessage(error instanceof Error ? error.message : 'Restore failed');
    } finally {
      if (currentScopeRef.current === restoreScope) setRestoring(false);
    }
  };

  return (
    <View style={styles.section} testID="plan.originals.section">
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <View style={styles.titleRow}>
            <Ionicons name="navigate-outline" size={15} color={C.orange} />
            <Text style={[styles.heading, { color: C.text }]}>Your Originals</Text>
          </View>
          <Text style={[styles.subheading, { color: C.text2 }]}>Downloads and listening progress</Text>
        </View>
        <View style={styles.headerActions}>
          {scopedView.error ? (
            <TouchableOpacity
              testID="plan.originals.retry"
              accessibilityRole="button"
              accessibilityLabel="Try loading your Trailhead Originals again"
              accessibilityState={{ busy: refreshing || loading }}
              disabled={refreshing || loading}
              onPress={() => void load(accountScope)}
              style={styles.browse}
            >
              {refreshing || loading ? <ActivityIndicator size="small" color={C.orange} /> : <Ionicons name="reload" size={14} color={C.orange} />}
              <Text style={[styles.browseText, { color: C.orange }]}>Try again</Text>
            </TouchableOpacity>
          ) : null}
          {accountId != null ? (
            <TouchableOpacity testID="plan.originals.restore" accessibilityRole="button" accessibilityLabel="Restore Trailhead Originals" accessibilityState={{ busy: restoring }} disabled={restoring} onPress={() => void restore()} style={styles.browse}>
              {restoring ? <ActivityIndicator size="small" color={C.orange} /> : <Ionicons name="refresh" size={14} color={C.orange} />}
              <Text style={[styles.browseText, { color: C.orange }]}>Restore</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
      {scopedView.error ? (
        <Text accessibilityLiveRegion="polite" style={[styles.loadError, { color: C.text2 }]}>{scopedView.error}</Text>
      ) : null}
      {restoreMessage ? <Text accessibilityLiveRegion="polite" style={[styles.restoreMessage, { color: C.text2 }]}>{restoreMessage}</Text> : null}
      {items.length > 0 ? <View style={[styles.list, { borderTopColor: C.border }] }>
        {items.map(item => {
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
              testID={`plan.originals.item.${item.id}.${item.version}`}
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
      </View> : null}
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
  loadError: { marginTop: -4, fontSize: 11, lineHeight: 16, fontWeight: '600' },
  list: { borderTopWidth: StyleSheet.hairlineWidth },
  row: { minHeight: 72, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 9 },
  icon: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 13.5, lineHeight: 18, fontWeight: '800' },
  rowMeta: { marginTop: 2, fontSize: 10.5, lineHeight: 14, fontWeight: '600' },
  progressTrack: { height: 4, marginTop: 6, borderRadius: 999, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 999 },
  action: { fontSize: 8.5, lineHeight: 11, fontWeight: '900', letterSpacing: 0.7 },
});
