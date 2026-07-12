import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api, type AvailabilityMonitor, type AvailabilityMonitorPolicy } from '@/lib/api';
import { useTheme, type ColorPalette } from '@/lib/design';

type IconName = keyof typeof Ionicons.glyphMap;
const WATCH_RENDER_BATCH = 20;

const STATUS_ORDER: Record<AvailabilityMonitor['status'], number> = {
  active: 0,
  failed: 1,
  expired: 2,
  cancelled: 3,
};

function timestamp(value: number) {
  const clean = Number(value);
  if (!Number.isFinite(clean) || clean <= 0) return null;
  return clean < 10_000_000_000 ? clean * 1000 : clean;
}

function dateLabel(value: number) {
  const clean = timestamp(value);
  if (!clean) return '';
  const date = new Date(clean);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function monitorTypeLabel(type: AvailabilityMonitor['monitor_type']) {
  switch (type) {
    case 'campground': return 'Campground';
    case 'permit': return 'Permit';
    case 'tour': return 'Tour';
    case 'route_reopening': return 'Route reopening';
    case 'closure': return 'Closure';
    case 'safety': return 'Safety and legal';
  }
}

function monitorIcon(type: AvailabilityMonitor['monitor_type']): IconName {
  switch (type) {
    case 'campground': return 'bonfire-outline';
    case 'permit': return 'document-text-outline';
    case 'tour': return 'ticket-outline';
    case 'route_reopening': return 'trail-sign-outline';
    case 'closure': return 'warning-outline';
    case 'safety': return 'shield-checkmark-outline';
  }
}

function statusLabel(status: AvailabilityMonitor['status']) {
  switch (status) {
    case 'active': return 'Active';
    case 'expired': return 'Expired';
    case 'cancelled': return 'Stopped';
    case 'failed': return 'Needs review';
  }
}

function statusColor(status: AvailabilityMonitor['status'], C: ColorPalette) {
  if (status === 'active') return C.green;
  if (status === 'failed') return C.yellow;
  return C.text2;
}

function billingLabel(monitor: AvailabilityMonitor) {
  switch (monitor.billing_kind) {
    case 'trial': return 'Trial watch';
    case 'explorer': return 'Included with Explorer';
    case 'credits': return monitor.credits_charged === 1 ? 'Paid with 1 credit' : `Paid with ${monitor.credits_charged} credits`;
    case 'safety_free': return 'Safety and legal watch';
    case 'legacy': return 'Existing account watch';
    default: return 'Account watch';
  }
}

function timingLabel(monitor: AvailabilityMonitor) {
  const expiry = dateLabel(monitor.expires_at);
  if (monitor.status === 'active') return expiry ? `Ends ${expiry}` : 'Active';
  if (monitor.status === 'expired') return expiry ? `Ended ${expiry}` : 'Expired';
  if (monitor.status === 'cancelled') {
    const cancelled = monitor.cancelled_at ? dateLabel(monitor.cancelled_at) : '';
    return cancelled ? `Stopped ${cancelled}` : 'Stopped';
  }
  return 'Review account status';
}

export default function AvailabilityWatchManager({
  signedIn,
  knownActiveCount,
}: {
  signedIn: boolean;
  knownActiveCount: number;
}) {
  const C = useTheme();
  const insets = useSafeAreaInsets();
  const requestSequence = useRef(0);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [monitors, setMonitors] = useState<AvailabilityMonitor[]>([]);
  const [policy, setPolicy] = useState<AvailabilityMonitorPolicy | null>(null);
  const [cancellingId, setCancellingId] = useState('');

  const load = useCallback(async () => {
    const request = ++requestSequence.current;
    setLoading(true);
    setError('');
    const policyRequest = api.getAvailabilityMonitorPolicy().catch(() => null);
    try {
      const collected: AvailabilityMonitor[] = [];
      const seenCursors = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await api.listAvailabilityMonitors({ limit: 100, cursor });
        collected.push(...(page.items ?? []));
        const next = page.next_cursor || undefined;
        if (next && seenCursors.has(next)) throw new Error('The account watch list could not finish loading.');
        if (next) seenCursors.add(next);
        cursor = next;
      } while (cursor);
      const nextPolicy = await policyRequest;
      if (request !== requestSequence.current) return;
      const unique = new Map<string, AvailabilityMonitor>();
      for (const monitor of collected) unique.set(monitor.id, monitor);
      setMonitors([...unique.values()].sort((left, right) => (
        STATUS_ORDER[left.status] - STATUS_ORDER[right.status] || right.updated_at - left.updated_at
      )));
      setPolicy(nextPolicy);
    } catch {
      if (request === requestSequence.current) {
        setError('Account watches could not be loaded.');
      }
    } finally {
      if (request === requestSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    void load();
    return () => { requestSequence.current += 1; };
  }, [load, visible]);

  const active = useMemo(() => monitors.filter(monitor => monitor.status === 'active'), [monitors]);
  const history = useMemo(() => monitors.filter(monitor => monitor.status !== 'active'), [monitors]);

  const cancelMonitor = (monitor: AvailabilityMonitor) => {
    Alert.alert(
      'Stop this watch?',
      `Trailhead will stop checking ${monitor.target_label}.`,
      [
        { text: 'Keep watching', style: 'cancel' },
        {
          text: 'Stop watch',
          style: 'destructive',
          onPress: () => {
            setCancellingId(monitor.id);
            void api.cancelAvailabilityMonitor(monitor.id)
              .then(updated => {
                setMonitors(current => current.map(item => item.id === updated.id ? updated : item));
                void api.getAvailabilityMonitorPolicy().then(setPolicy).catch(() => {});
              })
              .catch(() => Alert.alert('Watch not stopped', 'This watch could not be updated. Try again.'))
              .finally(() => setCancellingId(''));
          },
        },
      ],
    );
  };

  if (!signedIn) return null;
  return (
    <View style={styles.section}>
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <Text style={[styles.heading, { color: C.text }]}>Availability watches</Text>
          <Text style={[styles.subheading, { color: C.text2 }]}>Account activity</Text>
        </View>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Manage availability watches"
          activeOpacity={0.74}
          onPress={() => setVisible(true)}
          style={[styles.manageButton, { borderColor: C.border2 }]}
        >
          <Ionicons name="notifications-outline" size={16} color={C.orange} />
          <Text style={[styles.manageLabel, { color: C.text }]}>Manage</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`Open availability watches${knownActiveCount > 0 ? `, ${knownActiveCount} active in trip plans` : ''}`}
        activeOpacity={0.72}
        onPress={() => setVisible(true)}
        style={[styles.summaryRow, { borderTopColor: C.border, borderBottomColor: C.border }]}
      >
        <View style={[styles.summaryIcon, { backgroundColor: C.s2, borderColor: C.border }] }>
          <Ionicons name="eye-outline" size={18} color={knownActiveCount > 0 ? C.blueGlow : C.text3} />
        </View>
        <View style={styles.summaryCopy}>
          <Text style={[styles.summaryTitle, { color: C.text }]}>
            {knownActiveCount > 0 ? `${knownActiveCount} active in trip plans` : 'Manage account watches'}
          </Text>
          <Text style={[styles.summaryMeta, { color: C.text2 }]}>Current and past watches</Text>
        </View>
        <Ionicons name="chevron-forward" size={17} color={C.text3} />
      </TouchableOpacity>

      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={() => !cancellingId && setVisible(false)}
        accessibilityViewIsModal
      >
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close availability watches"
            disabled={Boolean(cancellingId)}
            onPress={() => setVisible(false)}
            style={styles.backdrop}
          />
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: C.s1,
                borderColor: C.border2,
                paddingBottom: Math.max(insets.bottom, 14),
              },
            ]}
          >
            <View style={[styles.handle, { backgroundColor: C.border2 }]} />
            <View style={styles.sheetHeader}>
              <View style={styles.headerCopy}>
                <Text accessibilityRole="header" style={[styles.sheetTitle, { color: C.text }]}>Availability watches</Text>
                <Text style={[styles.sheetSubtitle, { color: C.text2 }]}>Your account</Text>
              </View>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Close availability watches"
                activeOpacity={0.72}
                disabled={Boolean(cancellingId)}
                onPress={() => setVisible(false)}
                style={[styles.closeButton, { borderColor: C.border }]}
              >
                <Ionicons name="close" size={20} color={C.text2} />
              </TouchableOpacity>
            </View>

            {policy ? (
              <View style={[styles.policyRow, { borderTopColor: C.border, borderBottomColor: C.border }] }>
                <Ionicons name="person-circle-outline" size={18} color={C.text3} />
                <View style={styles.policyCopy}>
                  <Text style={[styles.policyTitle, { color: C.text }]}>
                    {policy.active_total > 0 ? `${policy.active_total} active across your account` : 'Account watches'}
                  </Text>
                  {policy.explorer.active && policy.explorer.included_limit > 0 ? (
                    <Text style={[styles.policyMeta, { color: C.text2 }]}>
                      {policy.explorer.included_active} of {policy.explorer.included_limit} included watches active
                    </Text>
                  ) : null}
                </View>
              </View>
            ) : null}

            <ScrollView
              style={styles.watchScroll}
              contentContainerStyle={styles.watchContent}
              showsVerticalScrollIndicator={false}
            >
              {loading ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator size="small" color={C.orange} />
                  <Text style={[styles.loadingText, { color: C.text2 }]}>Loading account watches</Text>
                </View>
              ) : error ? (
                <View style={[styles.errorRow, { borderBottomColor: C.border }] }>
                  <Ionicons name="alert-circle-outline" size={18} color={C.yellow} />
                  <Text style={[styles.errorText, { color: C.text2 }]}>{error}</Text>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Try loading availability watches again"
                    activeOpacity={0.74}
                    onPress={() => void load()}
                    style={[styles.retryButton, { borderColor: C.border2 }]}
                  >
                    <Text style={[styles.retryLabel, { color: C.orange }]}>Retry</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  {active.length > 0 ? <WatchGroup title="Active" monitors={active} cancellingId={cancellingId} onCancel={cancelMonitor} /> : null}
                  {history.length > 0 ? <WatchGroup title="History" monitors={history} cancellingId={cancellingId} onCancel={cancelMonitor} /> : null}
                  {monitors.length === 0 ? (
                    <View style={[styles.clearRow, { borderBottomColor: C.border }] }>
                      <Ionicons name="checkmark-circle-outline" size={18} color={C.green} />
                      <Text style={[styles.clearText, { color: C.text2 }]}>Your account watch list is clear</Text>
                    </View>
                  ) : null}
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function WatchGroup({
  title,
  monitors,
  cancellingId,
  onCancel,
}: {
  title: string;
  monitors: AvailabilityMonitor[];
  cancellingId: string;
  onCancel: (monitor: AvailabilityMonitor) => void;
}) {
  const C = useTheme();
  const [visibleCount, setVisibleCount] = useState(WATCH_RENDER_BATCH);
  const visibleMonitors = monitors.slice(0, visibleCount);
  return (
    <View style={styles.group}>
      <Text accessibilityRole="header" style={[styles.groupTitle, { color: C.text2 }]}>{title}</Text>
      <View style={[styles.watchList, { borderTopColor: C.border }] }>
        {visibleMonitors.map(monitor => {
          const cancelling = cancellingId === monitor.id;
          return (
            <View key={monitor.id} style={[styles.watchRow, { borderBottomColor: C.border }] }>
              <View style={[styles.watchIcon, { backgroundColor: C.s2, borderColor: C.border }] }>
                <Ionicons name={monitorIcon(monitor.monitor_type)} size={17} color={statusColor(monitor.status, C)} />
              </View>
              <View style={styles.watchCopy}>
                <View style={styles.watchTitleRow}>
                  <Text style={[styles.watchTitle, { color: C.text }]} numberOfLines={2}>{monitor.target_label}</Text>
                  <Text style={[styles.watchStatus, { color: statusColor(monitor.status, C) }]}>{statusLabel(monitor.status)}</Text>
                </View>
                <Text style={[styles.watchMeta, { color: C.text2 }]} numberOfLines={1}>
                  {monitorTypeLabel(monitor.monitor_type)} | {timingLabel(monitor)}
                </Text>
                <Text style={[styles.watchBilling, { color: C.text2 }]} numberOfLines={1}>{billingLabel(monitor)}</Text>
              </View>
              {monitor.status === 'active' ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={`Stop watching ${monitor.target_label}`}
                  activeOpacity={0.72}
                  disabled={Boolean(cancellingId)}
                  onPress={() => onCancel(monitor)}
                  style={[styles.stopButton, { borderColor: C.border2, opacity: cancellingId && !cancelling ? 0.45 : 1 }]}
                >
                  {cancelling ? (
                    <ActivityIndicator size="small" color={C.red} />
                  ) : (
                    <Ionicons name="stop-circle-outline" size={17} color={C.red} />
                  )}
                  <Text style={[styles.stopLabel, { color: C.red }]}>Stop</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          );
        })}
        {visibleMonitors.length < monitors.length ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Show more ${title.toLowerCase()} watches`}
            activeOpacity={0.74}
            onPress={() => setVisibleCount(count => count + WATCH_RENDER_BATCH)}
            style={[styles.showMoreRow, { borderBottomColor: C.border }]}
          >
            <Text style={[styles.showMoreLabel, { color: C.text2 }]}>Show more</Text>
            <Ionicons name="chevron-down" size={16} color={C.text2} />
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 11,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
  },
  headingCopy: {
    flex: 1,
    minWidth: 0,
  },
  heading: {
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '800',
    letterSpacing: 0,
  },
  subheading: {
    marginTop: 2,
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 0,
  },
  manageButton: {
    minHeight: 36,
    borderWidth: 1,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 11,
  },
  manageLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0,
  },
  summaryRow: {
    minHeight: 64,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 9,
  },
  summaryIcon: {
    width: 38,
    height: 38,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryCopy: {
    flex: 1,
    minWidth: 0,
  },
  summaryTitle: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
    letterSpacing: 0,
  },
  summaryMeta: {
    marginTop: 2,
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 0,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  sheet: {
    maxHeight: '90%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: 9,
    paddingHorizontal: 18,
    boxShadow: '0 -8px 30px rgba(0,0,0,0.16)',
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  sheetHeader: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  sheetTitle: {
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '800',
    letterSpacing: 0,
  },
  sheetSubtitle: {
    marginTop: 1,
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 0,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  policyRow: {
    minHeight: 58,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
  },
  policyCopy: {
    flex: 1,
    minWidth: 0,
  },
  policyTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    letterSpacing: 0,
  },
  policyMeta: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
    letterSpacing: 0,
  },
  watchScroll: {
    flexGrow: 0,
  },
  watchContent: {
    paddingVertical: 10,
    gap: 18,
  },
  loadingRow: {
    minHeight: 90,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 0,
  },
  errorRow: {
    minHeight: 64,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 9,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    letterSpacing: 0,
  },
  retryButton: {
    minWidth: 58,
    minHeight: 36,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  retryLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0,
  },
  clearRow: {
    minHeight: 64,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  clearText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    letterSpacing: 0,
  },
  group: {
    gap: 7,
  },
  groupTitle: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  watchList: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  watchRow: {
    minHeight: 84,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  watchIcon: {
    width: 38,
    height: 38,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  watchCopy: {
    flex: 1,
    minWidth: 0,
  },
  watchTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  watchTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 13.5,
    lineHeight: 18,
    fontWeight: '700',
    letterSpacing: 0,
  },
  watchStatus: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 0,
  },
  watchMeta: {
    marginTop: 3,
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '600',
    letterSpacing: 0,
  },
  watchBilling: {
    marginTop: 2,
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 0,
  },
  stopButton: {
    minWidth: 62,
    minHeight: 38,
    borderWidth: 1,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 8,
  },
  stopLabel: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
    letterSpacing: 0,
  },
  showMoreRow: {
    minHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  showMoreLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0,
  },
});
