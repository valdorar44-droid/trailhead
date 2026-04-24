import { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  TextInput, Alert, Image, Animated, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import { Ionicons } from '@expo/vector-icons';
import { api, Report, LeaderboardEntry } from '@/lib/api';
import { useStore } from '@/lib/store';
import { useTheme, mono, ColorPalette, LIGHT_C } from '@/lib/design';

// Module-level C for static color arrays (always light — good contrast both modes)
const C = LIGHT_C;

const REPORT_TYPES = [
  { type: 'hazard',      label: 'HAZARD',   icon: '⚠️',  color: C.red,    ttl: '7d',
    subtypes: ['Downed tree', 'Rockfall', 'Wildlife', 'Fire / smoke', 'Flash flood'] },
  { type: 'police',      label: 'PATROL',   icon: '🛡️',  color: C.yellow, ttl: '2h',
    subtypes: ['Ranger patrol', 'Fee checkpoint', 'OHV enforcement', 'Fire restriction'] },
  { type: 'road_condition', label: 'ROAD',  icon: '🛤️',  color: C.orange, ttl: '7d',
    subtypes: ['Clear & good', 'Muddy / soft', 'Washed out', 'Snow / ice', 'Flooded'] },
  { type: 'water',       label: 'WATER',    icon: '💧',  color: '#38bdf8', ttl: '3d',
    subtypes: ['Flowing well', 'Spring dry', 'Questionable quality', 'Filter required'] },
  { type: 'cell_signal', label: 'SIGNAL',   icon: '📶',  color: C.green,  ttl: '1d',
    subtypes: ['Strong signal', 'Weak signal', 'No signal', 'Starlink only'] },
  { type: 'wildlife',    label: 'WILDLIFE', icon: '🐻',  color: '#a78bfa', ttl: '1d',
    subtypes: ['Bear activity', 'Mountain lion', 'Elk / deer', 'Snake', 'Cool sighting'] },
  { type: 'campsite',    label: 'CAMPSITE', icon: '⛺',  color: C.orange, ttl: '14d',
    subtypes: ['Available & clean', 'Occupied', 'Trashed', 'Great condition', 'No water'] },
  { type: 'closure',     label: 'CLOSURE',  icon: '🚫',  color: C.red,    ttl: '30d',
    subtypes: ['Gate locked', 'Road closed', 'Seasonal', 'Fire closure', 'Now open!'] },
  { type: 'fuel',        label: 'FUEL',     icon: '⛽',  color: C.yellow,  ttl: '12h',
    subtypes: ['Diesel available', 'Gas available', 'Propane available', 'Fuel out', 'Price info'] },
  { type: 'viewpoint',   label: 'VIEW',     icon: '🏔️',  color: '#38bdf8', ttl: '90d',
    subtypes: ['Epic vista', 'Sunrise spot', 'Sunset spot', 'Photo opportunity', 'Hidden gem'] },
  { type: 'service',     label: 'SERVICE',  icon: '🔧',  color: '#94a3b8', ttl: '30d',
    subtypes: ['Mechanic nearby', 'Tire repair', 'Tow available', 'Auto parts', 'Dump station'] },
];

const SEVERITY = [
  { val: 'low',      label: 'FYI',     color: C.green  },
  { val: 'moderate', label: 'HEADS UP', color: C.yellow },
  { val: 'high',     label: 'CAUTION', color: C.orange  },
  { val: 'critical', label: 'AVOID',   color: C.red     },
];

type TabView = 'submit' | 'nearby' | 'leaderboard';

export default function ReportScreen() {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const { user, setAuth } = useStore();
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

  const [drivingWarning, setDrivingWarning] = useState(false);
  const [campsiteRating, setCampsiteRating] = useState(0);
  const successAnim = useRef(new Animated.Value(0)).current;
  const typeAnims = useRef(REPORT_TYPES.map(() => new Animated.Value(1))).current;

  useEffect(() => {
    Location.requestForegroundPermissionsAsync().then(({ status }) => {
      if (status !== 'granted') return;
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).then(l => {
        const c = { lat: l.coords.latitude, lng: l.coords.longitude };
        setLoc(c);
        // Warn if moving faster than ~5 mph (2.2 m/s)
        if (l.coords.speed !== null && l.coords.speed > 2.2) setDrivingWarning(true);
        api.getNearbyReports(c.lat, c.lng).then(reports => {
          setNearby(reports);
          const critical = reports.filter(r => r.severity === 'critical');
          if (critical.length > 0) {
            Notifications.scheduleNotificationAsync({
              content: {
                title: '⚠️ Trail Alert Nearby',
                body: `${critical.length} critical condition${critical.length > 1 ? 's' : ''} within 0.5 mi of you`,
                data: { type: 'trail_alert' },
              },
              trigger: null,
            }).catch(() => {});
          }
        }).catch(() => {});
      });
    });
    api.getLeaderboard().then(setLeaderboard).catch(() => {});
  }, []);

  function selectType(rt: typeof REPORT_TYPES[0], idx: number) {
    setSelectedType(rt);
    setSelectedSubtype('');
    setCampsiteRating(0);
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
      setCreditsGained(res.credits_earned + (res.streak_bonus ?? 0));
      setSubmitted(true);
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
            <Text style={s.drivingIcon}>🚗</Text>
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
              <Text style={s.streak}>🔥 {user.report_streak}d</Text>
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
          <View style={s.typeGrid}>
            {REPORT_TYPES.map((rt, idx) => {
              const active = selectedType?.type === rt.type;
              return (
                <Animated.View key={rt.type} style={{ transform: [{ scale: typeAnims[idx] }], width: '23%' }}>
                  <TouchableOpacity
                    style={[s.typeBtn, active && { borderColor: rt.color, backgroundColor: rt.color + '18' }]}
                    onPress={() => selectType(rt, idx)}
                  >
                    <Text style={s.typeEmoji}>{rt.icon}</Text>
                    <Text style={[s.typeLabel, active && { color: rt.color }]}>{rt.label}</Text>
                    <Text style={[s.typeTtl, active && { color: rt.color + 'aa' }]}>{rt.ttl}</Text>
                  </TouchableOpacity>
                </Animated.View>
              );
            })}
          </View>

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
                  PHOTO <Text style={s.bonusBadge}>+10 BONUS</Text>
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
                  +{photoBase64 ? 20 : 10} credits · active ~{selectedType.ttl}
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

      {view === 'nearby' && (
        <ScrollView contentContainerStyle={s.scroll}>
          {nearby.length === 0 ? (
            <View style={s.emptyWrap}>
              <Text style={s.emptyIcon}>📍</Text>
              <Text style={s.emptyText}>No active reports nearby</Text>
              <Text style={s.emptySub}>Be the first to report a condition</Text>
            </View>
          ) : nearby.map(r => (
            <ReportCard key={r.id} report={r}
              onUpvote={() => api.upvoteReport(r.id).catch(() => {})}
              onDownvote={() => api.downvoteReport(r.id).catch(() => {})}
              onConfirm={() => api.confirmReport(r.id).then(res => {
                Alert.alert('Confirmed ✓', `+${res.credits_earned} credit earned`);
              }).catch((e: any) => Alert.alert('Error', e.message))}
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
    </SafeAreaView>
  );
}

async function getToken() {
  const { default: SecureStore } = await import('expo-secure-store');
  return (await SecureStore.getItemAsync('trailhead_token')) ?? '';
}

function ReportCard({ report: r, onUpvote, onDownvote, onConfirm }:
  { report: Report; onUpvote: () => void; onDownvote: () => void; onConfirm: () => void }) {
  const C = useTheme();
  const rc = useMemo(() => makeRcStyles(C), [C]);
  const typeInfo = REPORT_TYPES.find(t => t.type === r.type);
  const sevInfo = SEVERITY.find(sv => sv.val === r.severity);
  const age = Math.floor((Date.now() / 1000 - r.created_at) / 3600);
  const expiresIn = r.expires_at ? Math.max(0, Math.floor((r.expires_at - Date.now() / 1000) / 3600)) : null;

  return (
    <View style={rc.card}>
      {r.cluster_count > 1 && (
        <View style={rc.clusterBadge}>
          <Text style={rc.clusterText}>{r.cluster_count} REPORTS HERE</Text>
        </View>
      )}
      <View style={rc.top}>
        <Text style={rc.icon}>{typeInfo?.icon ?? '⚠️'}</Text>
        <View style={rc.meta}>
          <Text style={rc.type}>{typeInfo?.label ?? r.type}</Text>
          {r.subtype && <Text style={rc.subtype}>{r.subtype}</Text>}
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
        </View>
      </View>
    </View>
  );
}

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
