import { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  TextInput, Alert, Image, Animated, Modal, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import { storage } from '@/lib/storage';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import TourTarget from '@/components/TourTarget';
import { api, Report, LeaderboardEntry } from '@/lib/api';
import { useStore } from '@/lib/store';
import { useTheme, mono, ColorPalette } from '@/lib/design';
import { CREDIT_REWARDS } from '@/lib/credits';

// ── Alert notification helpers ────────────────────────────────────────────────
// Seen IDs: { [reportId]: expiresAt (unix sec) } — auto-prune on load
async function loadSeenAlertIds(): Promise<Record<number, number>> {
  try {
    const raw = await storage.get('trailhead_alert_seen');
    if (!raw) return {};
    const parsed: Record<string, number> = JSON.parse(raw);
    const now = Date.now() / 1000;
    const pruned: Record<number, number> = {};
    for (const [id, exp] of Object.entries(parsed)) {
      if (exp > now) pruned[Number(id)] = exp;
    }
    return pruned;
  } catch { return {}; }
}
async function saveSeenAlertIds(seen: Record<number, number>): Promise<void> {
  try { await storage.set('trailhead_alert_seen', JSON.stringify(seen)); } catch {}
}
// Prefs: { [type]: boolean } — true = notify (default), false = muted
async function loadAlertPrefs(): Promise<Record<string, boolean>> {
  try {
    const raw = await storage.get('trailhead_alert_prefs');
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
async function saveAlertPrefs(prefs: Record<string, boolean>): Promise<void> {
  try { await storage.set('trailhead_alert_prefs', JSON.stringify(prefs)); } catch {}
}

// Semantic category colors — chosen to read well on both light and dark backgrounds
const REPORT_TYPES = [
  { type: 'hazard',      label: 'HAZARD',   icon: 'warning-outline',      color: '#ef4444', ttl: '7d',
    subtypes: ['Downed tree', 'Rockfall', 'Wildlife', 'Fire / smoke', 'Flash flood'] },
  { type: 'police',      label: 'PATROL',   icon: 'shield-outline',        color: '#f59e0b', ttl: '2h',
    subtypes: ['Ranger patrol', 'Fee checkpoint', 'OHV enforcement', 'Fire restriction'] },
  { type: 'road_condition', label: 'ROAD',  icon: 'trail-sign-outline',    color: '#f97316', ttl: '7d',
    subtypes: ['Clear & good', 'Muddy / soft', 'Washed out', 'Snow / ice', 'Flooded'] },
  { type: 'water',       label: 'WATER',    icon: 'water-outline',         color: '#38bdf8', ttl: '3d',
    subtypes: ['Flowing well', 'Spring dry', 'Questionable quality', 'Filter required'] },
  { type: 'cell_signal', label: 'SIGNAL',   icon: 'cellular-outline',      color: '#22c55e', ttl: '1d',
    subtypes: ['Strong signal', 'Weak signal', 'No signal', 'Starlink only'] },
  { type: 'wildlife',    label: 'WILDLIFE', icon: 'paw-outline',           color: '#a78bfa', ttl: '1d',
    subtypes: ['Bear activity', 'Mountain lion', 'Elk / deer', 'Snake', 'Cool sighting'] },
  { type: 'campsite',    label: 'CAMPSITE', icon: 'bonfire-outline',       color: '#14b8a6', ttl: '14d',
    subtypes: ['Available & clean', 'Occupied', 'Trashed', 'Great condition', 'No water'] },
  { type: 'closure',     label: 'CLOSURE',  icon: 'remove-circle-outline', color: '#ef4444', ttl: '30d',
    subtypes: ['Gate locked', 'Road closed', 'Seasonal', 'Fire closure', 'Now open!'] },
  { type: 'fuel',        label: 'FUEL',     icon: 'flash-outline',         color: '#eab308', ttl: '12h',
    subtypes: ['Diesel available', 'Gas available', 'Propane available', 'Fuel out', 'Price info'] },
  { type: 'viewpoint',   label: 'VIEW',     icon: 'flag-outline',          color: '#38bdf8', ttl: '90d',
    subtypes: ['Epic vista', 'Sunrise spot', 'Sunset spot', 'Photo opportunity', 'Hidden gem'] },
  { type: 'service',     label: 'SERVICE',  icon: 'construct-outline',     color: '#94a3b8', ttl: '30d',
    subtypes: ['Mechanic nearby', 'Tire repair', 'Tow available', 'Auto parts', 'Dump station'] },
];

const SEVERITY = [
  { val: 'low',      label: 'FYI',      color: '#22c55e' },
  { val: 'moderate', label: 'HEADS UP', color: '#f59e0b' },
  { val: 'high',     label: 'CAUTION',  color: '#f97316' },
  { val: 'critical', label: 'AVOID',    color: '#ef4444' },
];

const PHOTO_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://trailhead-production-2049.up.railway.app';

type TabView = 'submit' | 'nearby' | 'leaderboard';

export default function ReportScreen() {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const { user, setAuth, addLiveReport } = useStore();
  const [loc, setLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedType, setSelectedType] = useState<typeof REPORT_TYPES[0] | null>(null);
  const [selectedSubtype, setSelectedSubtype] = useState('');
  const [severity, setSeverity] = useState('moderate');
  const [description, setDescription] = useState('');
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [creditsGained, setCreditsGained] = useState(0);
  const [nearby, setNearby] = useState<Report[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [view, setView] = useState<TabView>('submit');
  const [notifPrefs, setNotifPrefs] = useState<Record<string, boolean>>({});
  const [showNotifSettings, setShowNotifSettings] = useState(false);

  const [detailReport, setDetailReport] = useState<Report | null>(null);
  const [drivingWarning, setDrivingWarning] = useState(false);
  const [campsiteRating, setCampsiteRating] = useState(0);
  const successAnim = useRef(new Animated.Value(0)).current;
  const typeAnims = useRef(REPORT_TYPES.map(() => new Animated.Value(1))).current;
  // Refs so async callbacks always read latest values without stale closures
  const seenIdsRef = useRef<Record<number, number>>({});
  const notifPrefsRef = useRef<Record<string, boolean>>({});
  const locRef = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => { notifPrefsRef.current = notifPrefs; }, [notifPrefs]);
  useEffect(() => { locRef.current = loc; }, [loc]);

  // Fire deduplicated notifications for unseen critical reports
  async function checkAndNotify(reports: Report[]) {
    const critical = reports.filter(r => r.severity === 'critical');
    if (critical.length === 0) return;
    const seen = seenIdsRef.current;
    const prefs = notifPrefsRef.current;
    const fresh = critical.filter(r => !seen[r.id] && prefs[r.type] !== false);
    if (fresh.length === 0) return;

    const typeInfo = REPORT_TYPES.find(t => t.type === fresh[0].type);
    const title = fresh.length === 1
      ? `⚠️ ${typeInfo?.label ?? 'Alert'} Nearby`
      : `⚠️ ${fresh.length} Trail Alerts Nearby`;
    const body = fresh.length === 1
      ? (fresh[0].description || `Critical ${typeInfo?.label ?? fresh[0].type} within 0.5 mi`)
      : `${fresh.length} critical conditions within 0.5 mi of you`;

    Notifications.scheduleNotificationAsync({
      content: { title, body, data: { type: 'trail_alert' } },
      trigger: null,
    }).catch(() => {});

    const updated = { ...seen };
    for (const r of fresh) {
      updated[r.id] = r.expires_at || (Date.now() / 1000 + 86400);
    }
    seenIdsRef.current = updated;
    saveSeenAlertIds(updated);
  }

  // Load prefs + seen IDs, then request location once on mount
  useEffect(() => {
    loadAlertPrefs().then(prefs => {
      setNotifPrefs(prefs);
      notifPrefsRef.current = prefs;
    });
    loadSeenAlertIds().then(seen => { seenIdsRef.current = seen; });

    Location.requestForegroundPermissionsAsync().then(({ status }) => {
      if (status !== 'granted') return;
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
        .then(l => {
          const c = { lat: l.coords.latitude, lng: l.coords.longitude };
          setLoc(c);
          locRef.current = c;
          if (l.coords.speed !== null && l.coords.speed > 2.2) setDrivingWarning(true);
          api.getNearbyReports(c.lat, c.lng).then(reports => {
            setNearby(reports);
            checkAndNotify(reports);
          }).catch(() => {});
        })
        .catch(() => {}); // prevent unhandled rejection crash
    }).catch(() => {});

    api.getLeaderboard().then(setLeaderboard).catch(() => {});
  }, []);

  // Refresh nearby reports each time user opens the NEARBY tab
  useEffect(() => {
    if (view !== 'nearby') return;
    const c = locRef.current;
    if (!c) return;
    api.getNearbyReports(c.lat, c.lng).then(reports => {
      setNearby(reports);
      checkAndNotify(reports);
    }).catch(() => {});
  }, [view]);

  async function toggleNotifPref(type: string, enabled: boolean) {
    const updated = { ...notifPrefsRef.current, [type]: enabled };
    setNotifPrefs(updated);
    notifPrefsRef.current = updated;
    saveAlertPrefs(updated);
  }

  function selectType(rt: typeof REPORT_TYPES[0], idx: number) {
    setSelectedType(rt);
    setSelectedSubtype('');
    setCampsiteRating(0);
    Haptics.selectionAsync();
    Animated.sequence([
      Animated.timing(typeAnims[idx], { toValue: 0.88, duration: 80, useNativeDriver: true }),
      Animated.spring(typeAnims[idx], { toValue: 1, tension: 200, friction: 6, useNativeDriver: true }),
    ]).start();
  }

  async function pickPhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Photo access required'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, quality: 0.5, base64: true,
    });
    if (!result.canceled && result.assets[0].base64) setPhotoBase64(result.assets[0].base64);
  }

  async function takePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Camera access required'); return; }
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.5, base64: true });
    if (!result.canceled && result.assets[0].base64) setPhotoBase64(result.assets[0].base64);
  }

  async function submit() {
    if (!user) { Alert.alert('Sign in required', 'Create an account to earn credits.'); return; }
    if (!selectedType) { Alert.alert('Select a report type first'); return; }
    if (!loc) { Alert.alert('Location unavailable'); return; }
    setSubmitting(true);
    try {
      const fullDesc = (campsiteRating > 0 && selectedType.type === 'campsite')
        ? `${campsiteRating}/5 stars.${description ? ' ' + description : ''}`
        : description;
      const res = await api.submitReport({
        lat: loc.lat, lng: loc.lng,
        type: selectedType.type, subtype: selectedSubtype,
        description: fullDesc, severity,
        photo_data: photoBase64 ?? undefined,
      });
      setCreditsGained(res.credits_earned);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSubmitted(true);
      // Push report to shared store so map tab shows the pin immediately
      addLiveReport({
        id: res.report_id, lat: loc!.lat, lng: loc!.lng,
        type: selectedType!.type, subtype: selectedSubtype,
        description: fullDesc ?? '', severity,
        upvotes: 0, downvotes: 0, confirmations: 0,
        has_photo: photoBase64 ? 1 : 0, cluster_count: 1,
        username: user?.username ?? 'me',
        created_at: Date.now() / 1000,
        expires_at: Date.now() / 1000 + res.ttl_hours * 3600,
      });
      Animated.spring(successAnim, { toValue: 1, tension: 60, friction: 7, useNativeDriver: true }).start();
      setTimeout(() => {
        Animated.timing(successAnim, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => setSubmitted(false));
        setSelectedType(null); setSelectedSubtype('');
        setDescription(''); setPhotoBase64(null);
      }, 3000);
      api.me().then(async u => setAuth(await getToken(), u)).catch(() => {});
      if (loc) api.getNearbyReports(loc.lat, loc.lng).then(setNearby).catch(() => {});
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={s.container}>
      {/* Driving safety modal */}
      <Modal visible={drivingWarning} transparent animationType="fade" statusBarTranslucent>
        <View style={s.drivingOverlay}>
          <View style={s.drivingModal}>
            <Ionicons name="car-outline" size={46} color={C.orange} style={{ marginBottom: 4 }} />
            <Text style={s.drivingTitle}>YOU APPEAR TO BE MOVING</Text>
            <Text style={s.drivingBody}>
              Never use your phone while driving. Pull over safely before submitting a trail report.
            </Text>
            <TouchableOpacity style={s.drivingParkedBtn} onPress={() => setDrivingWarning(false)}>
              <Text style={s.drivingParkedText}>I'M PARKED / STOPPED</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.drivingPassengerBtn} onPress={() => setDrivingWarning(false)}>
              <Text style={s.drivingPassengerText}>I'M A PASSENGER</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.title}>FIELD REPORTS</Text>
          <Text style={s.subtitle}>Warn the trail community</Text>
        </View>
        {user && (
          <View style={s.creditsBox}>
            <Text style={s.creditsVal}>{user.credits ?? 0}</Text>
            <Text style={s.creditsLabel}>CREDITS</Text>
            {(user.report_streak ?? 0) > 1 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 }}>
                <Ionicons name="flame" size={11} color={C.orange} />
                <Text style={s.streak}>{user.report_streak}d</Text>
              </View>
            )}
          </View>
        )}
      </View>

      {/* Success banner */}
      {submitted && (
        <Animated.View style={[s.successBanner, {
          opacity: successAnim,
          transform: [{ scale: successAnim.interpolate({ inputRange: [0,1], outputRange: [0.95, 1] }) }],
        }]}>
          <Text style={s.successIcon}>✓</Text>
          <View>
            <Text style={s.successTitle}>REPORT SUBMITTED</Text>
            <Text style={s.successSub}>+{creditsGained} credits earned</Text>
          </View>
        </Animated.View>
      )}

      {/* Tabs */}
      <View style={s.tabs}>
        {([['submit','REPORT'],['nearby','NEARBY'],['leaderboard','TOP']] as const).map(([t, label]) => (
          <TouchableOpacity key={t} style={[s.tab, view === t && s.tabActive]} onPress={() => setView(t)}>
            <Text style={[s.tabText, view === t && s.tabTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {view === 'submit' && (
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <View style={s.safetyBanner}>
            <Ionicons name="car-outline" size={13} color={C.text3} />
            <Text style={s.safetyText}>Report only when safely stopped</Text>
          </View>
          <Text style={s.sectionLabel}>TYPE</Text>
          <TourTarget id="report.types">
            <View style={s.typeGrid}>
              {REPORT_TYPES.map((rt, idx) => {
                const active = selectedType?.type === rt.type;
                return (
                  <Animated.View key={rt.type} style={{ transform: [{ scale: typeAnims[idx] }], width: '23%' }}>
                    <TouchableOpacity
                      style={[s.typeBtn, active && { borderColor: rt.color, backgroundColor: rt.color + '18' }]}
                      onPress={() => selectType(rt, idx)}
                    >
                      {(rt.icon.codePointAt(0) ?? 0) > 127
                        ? <Text style={s.typeEmoji}>{rt.icon}</Text>
                        : <Ionicons name={rt.icon as any} size={22} color={active ? rt.color : C.text3} />
                      }
                      <Text style={[s.typeLabel, active && { color: rt.color }]}>{rt.label}</Text>
                      <Text style={[s.typeTtl, active && { color: rt.color + 'aa' }]}>{rt.ttl}</Text>
                    </TouchableOpacity>
                  </Animated.View>
                );
              })}
            </View>
          </TourTarget>

          {selectedType && (
            <>
              <Text style={s.sectionLabel}>DETAILS</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
                {selectedType.subtypes.map(sub => (
                  <TouchableOpacity key={sub}
                    style={[s.chip, selectedSubtype === sub && { borderColor: selectedType.color, backgroundColor: selectedType.color + '18' }]}
                    onPress={() => setSelectedSubtype(sub)}
                  >
                    <Text style={[s.chipText, selectedSubtype === sub && { color: selectedType.color }]}>{sub}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={s.sectionLabel}>SEVERITY</Text>
              <View style={s.severityRow}>
                {SEVERITY.map(sv => (
                  <TouchableOpacity key={sv.val}
                    style={[s.sevBtn, severity === sv.val && { borderColor: sv.color, backgroundColor: sv.color + '20' }]}
                    onPress={() => setSeverity(sv.val)}
                  >
                    <Text style={[s.sevText, severity === sv.val && { color: sv.color }]}>{sv.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={s.photoSection}>
                <Text style={s.sectionLabel}>
                  PHOTO <Text style={s.bonusBadge}>+{CREDIT_REWARDS.reportPhotoBonus} BONUS</Text>
                </Text>
                <View style={s.photoRow}>
                  <TouchableOpacity style={s.photoBtn} onPress={takePhoto}>
                    <Ionicons name="camera-outline" size={22} color={C.text3} />
                    <Text style={s.photoBtnText}>CAMERA</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.photoBtn} onPress={pickPhoto}>
                    <Ionicons name="image-outline" size={22} color={C.text3} />
                    <Text style={s.photoBtnText}>LIBRARY</Text>
                  </TouchableOpacity>
                  {photoBase64 && (
                    <View style={s.thumbWrap}>
                      <Image source={{ uri: `data:image/jpeg;base64,${photoBase64}` }} style={s.thumbImg} />
                      <TouchableOpacity style={s.removeBtn} onPress={() => setPhotoBase64(null)}>
                        <Ionicons name="close-circle" size={20} color={C.red} />
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              </View>

              {selectedType?.type === 'campsite' && (
                <>
                  <Text style={s.sectionLabel}>CAMPSITE RATING</Text>
                  <View style={s.starRow}>
                    {[1, 2, 3, 4, 5].map(star => (
                      <TouchableOpacity key={star} onPress={() => setCampsiteRating(star)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Text style={[s.star, star <= campsiteRating && s.starActive]}>★</Text>
                      </TouchableOpacity>
                    ))}
                    {campsiteRating > 0 && (
                      <TouchableOpacity onPress={() => setCampsiteRating(0)}>
                        <Text style={s.starReset}>CLEAR</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </>
              )}

              <Text style={s.sectionLabel}>NOTES (OPTIONAL)</Text>
              <TextInput
                style={s.notes}
                value={description} onChangeText={setDescription}
                placeholder="Details travelers should know..."
                placeholderTextColor={C.text3}
                multiline numberOfLines={3}
                textAlignVertical="top"
              />

              <View style={s.earnRow}>
                <Ionicons name="flash" size={14} color={C.orange} />
                <Text style={s.earnText}>
                  +{photoBase64 ? CREDIT_REWARDS.reportWithPhotoTotal : CREDIT_REWARDS.communityReport} credits · active ~{selectedType.ttl}
                </Text>
              </View>

              <TouchableOpacity
                style={[s.submitBtn, submitting && s.submitBtnDisabled]}
                onPress={submit} disabled={submitting}
              >
                <Text style={s.submitBtnText}>{submitting ? 'SUBMITTING...' : 'SUBMIT REPORT'}</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      )}

      {/* Notification settings modal */}
      <Modal visible={showNotifSettings} transparent animationType="slide" onRequestClose={() => setShowNotifSettings(false)}>
        <View style={s.notifOverlay}>
          <View style={s.notifModal}>
            <View style={s.notifHeader}>
              <Text style={s.notifTitle}>ALERT NOTIFICATIONS</Text>
              <TouchableOpacity onPress={() => setShowNotifSettings(false)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Ionicons name="close" size={20} color={C.text2} />
              </TouchableOpacity>
            </View>
            <Text style={s.notifSub}>Choose which report types send you a push alert when critical conditions are nearby.</Text>
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 380 }}>
              {REPORT_TYPES.map(rt => {
                const enabled = notifPrefs[rt.type] !== false;
                return (
                  <View key={rt.type} style={s.notifRow}>
                    <View style={[s.notifDot, { backgroundColor: rt.color }]} />
                    <Ionicons name={rt.icon as any} size={16} color={enabled ? rt.color : C.text3} style={{ width: 20 }} />
                    <Text style={[s.notifLabel, !enabled && { color: C.text3 }, { flex: 1 }]}>{rt.label}</Text>
                    <Switch
                      value={enabled}
                      onValueChange={v => toggleNotifPref(rt.type, v)}
                      trackColor={{ false: C.border, true: rt.color + '88' }}
                      thumbColor={enabled ? rt.color : C.text3}
                    />
                  </View>
                );
              })}
            </ScrollView>
            <Text style={s.notifNote}>Only critical-severity reports trigger alerts. Seen alerts won't repeat.</Text>
          </View>
        </View>
      </Modal>

      {view === 'nearby' && (
        <ScrollView contentContainerStyle={s.scroll}>
          {/* Alert settings row */}
          <TouchableOpacity style={s.notifSettingsBtn} onPress={() => setShowNotifSettings(true)}>
            <Ionicons name="notifications-outline" size={14} color={C.text3} />
            <Text style={[s.notifSettingsBtnText, { flex: 1 }]}>Alert Settings</Text>
            <Ionicons name="chevron-forward" size={12} color={C.text3} />
          </TouchableOpacity>

          {nearby.length === 0 ? (
            <View style={s.emptyWrap}>
              <Ionicons name="location-outline" size={40} color={C.text3} />
              <Text style={s.emptyText}>No active reports nearby</Text>
              <Text style={s.emptySub}>Be the first to report a condition</Text>
            </View>
          ) : nearby.map(r => (
            <ReportCard key={r.id} report={r}
              onPress={() => setDetailReport(r)}
              onUpvote={() => api.upvoteReport(r.id).catch(() => {})}
              onDownvote={() => api.downvoteReport(r.id).catch(() => {})}
              onConfirm={() => api.confirmReport(r.id).then(res => {
                Alert.alert('Confirmed ✓', `+${res.credits_earned} credit earned`);
              }).catch((e: any) => Alert.alert('Error', e.message))}
              onAdminDelete={user?.is_admin ? () => Alert.alert('Delete Report', 'Permanently remove this report?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => api.adminDeleteReport(r.id).then(() => setNearby(prev => prev.filter(x => x.id !== r.id))).catch(() => {}) },
              ]) : undefined}
              onAdminRemovePhoto={user?.is_admin ? () => api.adminRemovePhoto(r.id).then(() => setNearby(prev => prev.map(x => x.id === r.id ? { ...x, has_photo: 0 } : x))).catch(() => {}) : undefined}
            />
          ))}
        </ScrollView>
      )}

      {view === 'leaderboard' && (
        <ScrollView contentContainerStyle={s.scroll}>
          <Text style={s.sectionLabel}>TOP REPORTERS — LAST 30 DAYS</Text>
          {leaderboard.map((entry, i) => (
            <View key={entry.username} style={[s.leaderRow, i === 0 && s.leaderGold]}>
              <Text style={s.leaderRank}>
                {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`}
              </Text>
              <View style={s.leaderInfo}>
                <Text style={s.leaderName}>{entry.username}</Text>
                <Text style={s.leaderMeta}>
                  {entry.report_count} reports · {entry.total_upvotes ?? 0} upvotes
                  {entry.streak > 1 ? ` · 🔥 ${entry.streak}d` : ''}
                </Text>
              </View>
              {user?.username === entry.username && (
                <View style={s.youBadge}><Text style={s.youText}>YOU</Text></View>
              )}
            </View>
          ))}
        </ScrollView>
      )}
      {/* Report detail modal */}
      {detailReport && (
        <ReportDetailModal
          report={detailReport}
          onClose={() => setDetailReport(null)}
          onUpvote={() => { api.upvoteReport(detailReport.id).catch(() => {}); setDetailReport(null); }}
          onDownvote={() => { api.downvoteReport(detailReport.id).catch(() => {}); setDetailReport(null); }}
          onConfirm={() => api.confirmReport(detailReport.id).then(res => {
            Alert.alert('Confirmed ✓', `+${res.credits_earned} credit earned`);
            setDetailReport(null);
          }).catch((e: any) => Alert.alert('Error', e.message))}
        />
      )}
    </SafeAreaView>
  );
}

async function getToken() {
  return (await storage.get('trailhead_token')) ?? '';
}

function ReportCard({ report: r, onPress, onUpvote, onDownvote, onConfirm, onAdminDelete, onAdminRemovePhoto }:
  { report: Report; onPress: () => void; onUpvote: () => void; onDownvote: () => void; onConfirm: () => void;
    onAdminDelete?: () => void; onAdminRemovePhoto?: () => void; }) {
  const C = useTheme();
  const rc = useMemo(() => makeRcStyles(C), [C]);
  if (!r || r.id == null) return null; // guard against malformed API data
  const typeInfo = REPORT_TYPES.find(t => t.type === r.type);
  const sevInfo = SEVERITY.find(sv => sv.val === r.severity);
  const createdAt = typeof r.created_at === 'number' ? r.created_at : 0;
  const age = Math.floor((Date.now() / 1000 - createdAt) / 3600);
  const expiresIn = r.expires_at ? Math.max(0, Math.floor((r.expires_at - Date.now() / 1000) / 3600)) : null;

  return (
    <TouchableOpacity style={rc.card} onPress={onPress} activeOpacity={0.85}>
      {r.cluster_count > 1 && (
        <View style={rc.clusterBadge}>
          <Text style={rc.clusterText}>{r.cluster_count} REPORTS HERE</Text>
        </View>
      )}
      <View style={rc.top}>
        {(() => {
          const icon = typeInfo?.icon ?? 'warning-outline';
          return (icon.codePointAt(0) ?? 0) > 127
            ? <Text style={rc.icon}>{icon}</Text>
            : <Ionicons name={icon as any} size={22} color={typeInfo?.color ?? '#f97316'} />;
        })()}
        <View style={rc.meta}>
          <Text style={rc.type}>{typeInfo?.label ?? r.type}</Text>
          {!!r.subtype && <Text style={rc.subtype}>{r.subtype}</Text>}
        </View>
        {sevInfo && (
          <View style={[rc.sevPill, { backgroundColor: sevInfo.color + '22', borderColor: sevInfo.color }]}>
            <Text style={[rc.sevText, { color: sevInfo.color }]}>{sevInfo.label}</Text>
          </View>
        )}
      </View>
      {r.description ? <Text style={rc.desc}>{r.description}</Text> : null}
      <View style={rc.footer}>
        <Text style={rc.age}>
          @{r.username} · {age < 1 ? 'just now' : `${age}h ago`}
          {expiresIn !== null ? ` · exp ${expiresIn}h` : ''}
          {r.has_photo ? ' · 📷' : ''}
          {r.confirmations > 0 ? ` · ✓${r.confirmations}` : ''}
        </Text>
        <View style={rc.actions}>
          <TouchableOpacity style={rc.confirmBtn} onPress={onConfirm}>
            <Ionicons name="checkmark-circle-outline" size={15} color={C.green} />
            <Text style={[rc.actionText, { color: C.green }]}>Still there</Text>
          </TouchableOpacity>
          <TouchableOpacity style={rc.voteBtn} onPress={onUpvote}>
            <Ionicons name="thumbs-up-outline" size={13} color={C.text3} />
            <Text style={rc.voteCount}>{r.upvotes}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={rc.voteBtn} onPress={onDownvote}>
            <Ionicons name="thumbs-down-outline" size={13} color={C.text3} />
            <Text style={rc.voteCount}>{r.downvotes ?? 0}</Text>
          </TouchableOpacity>
          {/* Admin-only controls — hidden from regular users */}
          {onAdminDelete && (
            <TouchableOpacity style={[rc.voteBtn, { marginLeft: 4 }]} onPress={onAdminDelete}>
              <Ionicons name="trash-outline" size={13} color="#ef4444" />
            </TouchableOpacity>
          )}
          {onAdminRemovePhoto && !!r.has_photo && (
            <TouchableOpacity style={rc.voteBtn} onPress={onAdminRemovePhoto}>
              <Ionicons name="image-outline" size={13} color="#f97316" />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── Report detail modal ────────────────────────────────────────────────────────
function ReportDetailModal({ report: r, onClose, onUpvote, onDownvote, onConfirm }:
  { report: Report; onClose: () => void; onUpvote: () => void; onDownvote: () => void; onConfirm: () => void }) {
  const C = useTheme();
  const dm = useMemo(() => makeDmStyles(C), [C]);
  const typeInfo = REPORT_TYPES.find(t => t.type === r.type);
  const sevInfo = SEVERITY.find(sv => sv.val === r.severity);
  const age = Math.floor((Date.now() / 1000 - r.created_at) / 3600);
  const expiresIn = r.expires_at ? Math.max(0, Math.floor((r.expires_at - Date.now() / 1000) / 3600)) : null;
  const photoUri = r.has_photo ? `${PHOTO_BASE}/api/reports/${r.id}/photo` : null;

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={dm.container}>
        {/* Header bar */}
        <View style={dm.header}>
          <TouchableOpacity onPress={onClose} style={dm.closeBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="close" size={22} color={C.text2} />
          </TouchableOpacity>
          <Text style={dm.headerTitle}>REPORT DETAIL</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={dm.scroll} showsVerticalScrollIndicator={false}>
          {/* Type + severity row */}
          <View style={dm.typeRow}>
            <View style={[dm.typeIconWrap, { backgroundColor: (typeInfo?.color ?? '#f97316') + '20' }]}>
              {(() => {
                const icon = typeInfo?.icon ?? 'warning-outline';
                return (icon.codePointAt(0) ?? 0) > 127
                  ? <Text style={{ fontSize: 32 }}>{icon}</Text>
                  : <Ionicons name={icon as any} size={32} color={typeInfo?.color ?? '#f97316'} />;
              })()}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={dm.typeLabel}>{typeInfo?.label ?? r.type}</Text>
              {r.subtype ? <Text style={dm.subtype}>{r.subtype}</Text> : null}
            </View>
            {sevInfo && (
              <View style={[dm.sevPill, { backgroundColor: sevInfo.color + '22', borderColor: sevInfo.color }]}>
                <Text style={[dm.sevText, { color: sevInfo.color }]}>{sevInfo.label}</Text>
              </View>
            )}
          </View>

          {/* Photo */}
          {photoUri && (
            <Image
              source={{ uri: photoUri }}
              style={dm.photo}
              resizeMode="cover"
            />
          )}

          {/* Description */}
          {r.description ? (
            <View style={dm.descBox}>
              <Text style={dm.descText}>{r.description}</Text>
            </View>
          ) : null}

          {/* Meta */}
          <View style={dm.metaBox}>
            <View style={dm.metaRow}>
              <Ionicons name="person-circle-outline" size={16} color={C.text3} />
              <Text style={dm.metaText}>@{r.username}</Text>
            </View>
            <View style={dm.metaRow}>
              <Ionicons name="time-outline" size={16} color={C.text3} />
              <Text style={dm.metaText}>{age < 1 ? 'Just now' : `${age}h ago`}</Text>
            </View>
            {expiresIn !== null && (
              <View style={dm.metaRow}>
                <Ionicons name="hourglass-outline" size={16} color={C.text3} />
                <Text style={dm.metaText}>Expires in {expiresIn}h</Text>
              </View>
            )}
            {r.confirmations > 0 && (
              <View style={dm.metaRow}>
                <Ionicons name="checkmark-done-circle-outline" size={16} color={C.green} />
                <Text style={[dm.metaText, { color: C.green }]}>{r.confirmations} confirmation{r.confirmations !== 1 ? 's' : ''}</Text>
              </View>
            )}
          </View>

          {/* Actions */}
          <View style={dm.actionsRow}>
            <TouchableOpacity style={dm.confirmBtn} onPress={onConfirm}>
              <Ionicons name="checkmark-circle-outline" size={18} color={C.green} />
              <Text style={[dm.btnText, { color: C.green }]}>STILL THERE</Text>
            </TouchableOpacity>
            <TouchableOpacity style={dm.voteBtn} onPress={onUpvote}>
              <Ionicons name="thumbs-up-outline" size={18} color={C.text2} />
              <Text style={dm.voteTxt}>{r.upvotes}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={dm.voteBtn} onPress={onDownvote}>
              <Ionicons name="thumbs-down-outline" size={18} color={C.text2} />
              <Text style={dm.voteTxt}>{r.downvotes ?? 0}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const makeDmStyles = (C: ColorPalette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderColor: C.border, backgroundColor: C.s1,
  },
  closeBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: C.text, fontSize: 12, fontWeight: '700', fontFamily: mono, letterSpacing: 1 },
  scroll: { padding: 20, gap: 16, paddingBottom: 60 },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  typeIconWrap: { width: 64, height: 64, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  typeLabel: { color: C.text, fontSize: 18, fontWeight: '800', fontFamily: mono },
  subtype: { color: C.text2, fontSize: 13, marginTop: 3 },
  sevPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  sevText: { fontSize: 10, fontFamily: mono, fontWeight: '700', letterSpacing: 0.5 },
  photo: { width: '100%', height: 240, borderRadius: 14, backgroundColor: C.s2 },
  descBox: { backgroundColor: C.s2, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: C.border },
  descText: { color: C.text, fontSize: 14, lineHeight: 21 },
  metaBox: { backgroundColor: C.s2, borderRadius: 12, padding: 14, gap: 10, borderWidth: 1, borderColor: C.border },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metaText: { color: C.text2, fontSize: 13 },
  actionsRow: { flexDirection: 'row', gap: 10 },
  confirmBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: C.green + '18', borderWidth: 1, borderColor: C.green,
    borderRadius: 12, paddingVertical: 13,
  },
  voteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: C.s2, borderWidth: 1, borderColor: C.border,
    borderRadius: 12, paddingVertical: 13, paddingHorizontal: 18,
  },
  btnText: { fontSize: 12, fontWeight: '700', fontFamily: mono },
  voteTxt: { color: C.text2, fontSize: 14, fontWeight: '700', fontFamily: mono },
});

const makeRcStyles = (C: ColorPalette) => StyleSheet.create({
  card: {
    backgroundColor: C.s2, borderRadius: 12, borderWidth: 1, borderColor: C.border,
    padding: 14, marginBottom: 10,
  },
  clusterBadge: {
    backgroundColor: C.orangeGlow, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
    alignSelf: 'flex-start', marginBottom: 8,
  },
  clusterText: { color: C.orange, fontSize: 9, fontFamily: mono, fontWeight: '700', letterSpacing: 0.5 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  icon: { fontSize: 22 },
  meta: { flex: 1 },
  type: { color: C.text, fontWeight: '700', fontSize: 13 },
  subtype: { color: C.text2, fontSize: 11, marginTop: 1 },
  sevPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, borderWidth: 1 },
  sevText: { fontSize: 9, fontFamily: mono, fontWeight: '700', letterSpacing: 0.5 },
  desc: { color: C.text2, fontSize: 12, lineHeight: 17, marginBottom: 10 },
  footer: { gap: 8 },
  age: { color: C.text3, fontSize: 10, fontFamily: mono },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  confirmBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actionText: { fontSize: 12, fontWeight: '600' },
  voteBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  voteCount: { color: C.text3, fontSize: 12, fontWeight: '600', fontFamily: mono },
});

const makeStyles = (C: ColorPalette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderColor: C.border, backgroundColor: C.s1,
  },
  title: { color: C.text, fontSize: 15, fontWeight: '800', fontFamily: mono, letterSpacing: 0.5 },
  subtitle: { color: C.text3, fontSize: 11, marginTop: 2 },
  creditsBox: { alignItems: 'center' },
  creditsVal: { color: C.orange, fontSize: 22, fontWeight: '800', fontFamily: mono },
  creditsLabel: { color: C.text3, fontSize: 9, fontFamily: mono, letterSpacing: 0.5 },
  streak: { color: C.orange, fontSize: 11, fontFamily: mono, marginTop: 2 },
  successBanner: {
    margin: 12, borderRadius: 12, padding: 14,
    backgroundColor: C.green + '20', borderWidth: 1, borderColor: C.green,
    flexDirection: 'row', alignItems: 'center', gap: 14,
  },
  successIcon: { fontSize: 28, color: C.green },
  successTitle: { color: C.green, fontSize: 13, fontWeight: '800', fontFamily: mono },
  successSub: { color: C.green, fontSize: 11, marginTop: 2 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderColor: C.border, backgroundColor: C.s1 },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: C.orange },
  tabText: { color: C.text3, fontSize: 10, fontFamily: mono, fontWeight: '700', letterSpacing: 0.5 },
  tabTextActive: { color: C.orange },
  scroll: { padding: 14, gap: 12, paddingBottom: 40 },
  sectionLabel: { color: C.text3, fontSize: 10, fontFamily: mono, letterSpacing: 1, marginBottom: 8 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16 },
  typeBtn: {
    backgroundColor: C.s2, borderWidth: 1, borderColor: C.border,
    borderRadius: 12, padding: 10, alignItems: 'center', gap: 4,
  },
  typeEmoji: { fontSize: 24 },
  typeLabel: { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '700', letterSpacing: 0.3 },
  typeTtl: { color: C.border, fontSize: 8, fontFamily: mono },
  chipRow: { gap: 8, paddingBottom: 4, marginBottom: 16 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 7,
    backgroundColor: C.s2, borderWidth: 1, borderColor: C.border, borderRadius: 20,
  },
  chipText: { color: C.text2, fontSize: 12 },
  severityRow: { flexDirection: 'row', gap: 6, marginBottom: 16 },
  sevBtn: {
    flex: 1, paddingVertical: 9, borderWidth: 1, borderColor: C.border,
    borderRadius: 8, alignItems: 'center', backgroundColor: C.s2,
  },
  sevText: { color: C.text3, fontSize: 10, fontFamily: mono, fontWeight: '700' },
  photoSection: { marginBottom: 4 },
  bonusBadge: {
    color: C.green, fontSize: 9, fontFamily: mono,
    backgroundColor: C.green + '20',
  },
  photoRow: { flexDirection: 'row', gap: 8, marginBottom: 16, alignItems: 'center' },
  photoBtn: {
    backgroundColor: C.s2, borderWidth: 1, borderColor: C.border,
    borderRadius: 10, padding: 14, alignItems: 'center', gap: 5, flex: 1,
  },
  photoBtnText: { color: C.text3, fontSize: 10, fontFamily: mono },
  thumbWrap: { width: 64, height: 64, position: 'relative' },
  thumbImg: { width: 64, height: 64, borderRadius: 10 },
  removeBtn: { position: 'absolute', top: -8, right: -8 },
  notes: {
    backgroundColor: C.s2, borderWidth: 1, borderColor: C.border,
    borderRadius: 10, padding: 12, color: C.text, fontSize: 13,
    minHeight: 70, marginBottom: 12,
  },
  earnRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.orangeGlow, borderRadius: 8, padding: 10, marginBottom: 16,
  },
  earnText: { color: C.orange, fontSize: 12, fontFamily: mono },
  submitBtn: {
    backgroundColor: C.orange, borderRadius: 12, padding: 16, alignItems: 'center',
    shadowColor: C.orange, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.35, shadowRadius: 8,
  },
  submitBtnDisabled: { backgroundColor: C.s3, shadowOpacity: 0 },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 13, fontFamily: mono, letterSpacing: 0.5 },
  // Driving safety
  drivingOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  drivingModal: {
    backgroundColor: C.s2, borderRadius: 20, borderWidth: 1, borderColor: C.border,
    padding: 28, alignItems: 'center', gap: 12, width: '100%', maxWidth: 360,
  },
  drivingIcon: { fontSize: 48, marginBottom: 4 },
  drivingTitle: {
    color: C.text, fontSize: 15, fontWeight: '800', fontFamily: mono,
    letterSpacing: 0.5, textAlign: 'center',
  },
  drivingBody: { color: C.text2, fontSize: 13.5, lineHeight: 20, textAlign: 'center' },
  drivingParkedBtn: {
    backgroundColor: C.orange, borderRadius: 12, padding: 15,
    width: '100%', alignItems: 'center', marginTop: 6,
    shadowColor: C.orange, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.35, shadowRadius: 8,
  },
  drivingParkedText: { color: '#fff', fontWeight: '700', fontSize: 13, fontFamily: mono },
  drivingPassengerBtn: {
    borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 13,
    width: '100%', alignItems: 'center',
  },
  drivingPassengerText: { color: C.text3, fontSize: 12, fontFamily: mono },

  safetyBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.s2, borderRadius: 8, padding: 9, marginBottom: 4,
    borderWidth: 1, borderColor: C.border,
  },
  safetyText: { color: C.text3, fontSize: 11, fontFamily: mono },
  starRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 },
  star: { color: C.border, fontSize: 32 },
  starActive: { color: '#f59e0b' },
  starReset: { color: C.text3, fontSize: 9, fontFamily: mono, marginLeft: 4 },

  emptyWrap: { alignItems: 'center', marginTop: 60, gap: 8 },
  emptyIcon: { fontSize: 40 },
  emptyText: { color: C.text2, fontSize: 15, fontWeight: '600' },
  emptySub: { color: C.text3, fontSize: 12 },
  // Alert settings button
  notifSettingsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.s2, borderWidth: 1, borderColor: C.border,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 4,
  },
  notifSettingsBtnText: { color: C.text3, fontSize: 11, fontFamily: mono },
  // Notification settings modal
  notifOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  notifModal: {
    backgroundColor: C.s1, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderWidth: 1, borderColor: C.border, padding: 20, paddingBottom: 40, gap: 14,
  },
  notifHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  notifTitle: { color: C.text, fontSize: 13, fontWeight: '800', fontFamily: mono, letterSpacing: 0.5 },
  notifSub: { color: C.text3, fontSize: 12, lineHeight: 17 },
  notifRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 11, borderBottomWidth: 1, borderColor: C.border,
  },
  notifDot: { width: 6, height: 6, borderRadius: 3 },
  notifLabel: { color: C.text, fontSize: 13, fontFamily: mono, fontWeight: '600' },
  notifNote: { color: C.text3, fontSize: 11, lineHeight: 16, marginTop: 4 },
  leaderRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: C.s2, borderRadius: 12, borderWidth: 1, borderColor: C.border,
    padding: 14, marginBottom: 8,
  },
  leaderGold: { borderColor: '#f59e0b', backgroundColor: '#f59e0b0a' },
  leaderRank: { fontSize: 20, width: 32, textAlign: 'center' },
  leaderInfo: { flex: 1 },
  leaderName: { color: C.text, fontWeight: '700', fontSize: 14 },
  leaderMeta: { color: C.text3, fontSize: 11, fontFamily: mono, marginTop: 2 },
  youBadge: {
    backgroundColor: C.orangeGlow, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: C.orange,
  },
  youText: { color: C.orange, fontSize: 9, fontFamily: mono, fontWeight: '700' },
});
