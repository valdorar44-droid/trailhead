import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  TextInput, Platform, Alert, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { api, Report, LeaderboardEntry } from '@/lib/api';
import { useStore } from '@/lib/store';

const REPORT_TYPES = [
  { type: 'road_condition', label: 'Road',        icon: 'car-outline',          ttl: '7 days',
    subtypes: ['Clear & good', 'Muddy / soft', 'Washed out', 'Snow / ice', 'Rough / rocky', 'Flooded'] },
  { type: 'campsite',       label: 'Campsite',    icon: 'bonfire-outline',       ttl: '14 days',
    subtypes: ['Available & clean', 'Occupied', 'Trashed', 'Great condition', 'No water nearby'] },
  { type: 'hazard',         label: 'Hazard',      icon: 'warning-outline',       ttl: '7 days',
    subtypes: ['Downed tree', 'Rockfall', 'Wildlife', 'Fire / smoke', 'Flash flood risk'] },
  { type: 'closure',        label: 'Closure',     icon: 'lock-closed-outline',   ttl: '30 days',
    subtypes: ['Gate locked', 'Road closed', 'Seasonal closure', 'Fire closure', 'Now open!'] },
  { type: 'water',          label: 'Water',       icon: 'water-outline',         ttl: '3 days',
    subtypes: ['Source flowing well', 'Spring dry', 'Questionable quality', 'Filtered required'] },
  { type: 'police',         label: 'Patrol',      icon: 'shield-outline',        ttl: '2 hrs',
    subtypes: ['Ranger patrol', 'Fee checkpoint', 'OHV enforcement', 'Fire restriction check'] },
  { type: 'cell_signal',    label: 'Signal',      icon: 'cellular-outline',      ttl: '1 day',
    subtypes: ['Strong signal', 'Weak signal', 'No signal', 'Starlink only'] },
  { type: 'wildlife',       label: 'Wildlife',    icon: 'paw-outline',           ttl: '1 day',
    subtypes: ['Bear activity', 'Mountain lion', 'Elk / deer herd', 'Snake', 'Cool sighting'] },
];

const SEVERITY = [
  { val: 'low',      label: 'FYI',      color: '#27ae60' },
  { val: 'moderate', label: 'Heads up', color: '#f59e0b' },
  { val: 'high',     label: 'Caution',  color: '#e67e22' },
  { val: 'critical', label: 'AVOID',    color: '#dc2626' },
];

type TabView = 'submit' | 'nearby' | 'leaderboard';

export default function ReportScreen() {
  const { user, setAuth } = useStore();
  const [loc, setLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedType, setSelectedType] = useState<typeof REPORT_TYPES[0] | null>(null);
  const [selectedSubtype, setSelectedSubtype] = useState('');
  const [severity, setSeverity] = useState('moderate');
  const [description, setDescription] = useState('');
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [nearby, setNearby] = useState<Report[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [view, setView] = useState<TabView>('submit');

  useEffect(() => {
    Location.requestForegroundPermissionsAsync().then(({ status }) => {
      if (status !== 'granted') return;
      Location.getCurrentPositionAsync({}).then(l => {
        const c = { lat: l.coords.latitude, lng: l.coords.longitude };
        setLoc(c);
        refreshNearby(c.lat, c.lng);
      });
    });
    api.getLeaderboard().then(setLeaderboard).catch(() => {});
  }, []);

  const refreshNearby = (lat: number, lng: number) => {
    api.getNearbyReports(lat, lng).then(setNearby).catch(() => {});
  };

  async function pickPhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Photo access required'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, quality: 0.5, base64: true,
    });
    if (!result.canceled && result.assets[0].base64) {
      setPhotoBase64(result.assets[0].base64);
    }
  }

  async function takePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Camera access required'); return; }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true, quality: 0.5, base64: true,
    });
    if (!result.canceled && result.assets[0].base64) {
      setPhotoBase64(result.assets[0].base64);
    }
  }

  async function submit() {
    if (!user) { Alert.alert('Sign in required', 'Create an account to submit reports and earn credits.'); return; }
    if (!selectedType) { Alert.alert('Select a report type'); return; }
    if (!loc) { Alert.alert('Location unavailable'); return; }
    setSubmitting(true);
    try {
      const res = await api.submitReport({
        lat: loc.lat, lng: loc.lng,
        type: selectedType.type, subtype: selectedSubtype,
        description, severity,
        photo_data: photoBase64 ?? undefined,
      });

      let msg = `+${res.credits_earned} credits earned.\nReport expires in ${res.ttl_hours}h.`;
      if (res.streak > 1) msg += `\n\n🔥 ${res.streak}-day streak!`;
      if (res.streak_bonus) msg += `\n+${res.streak_bonus} streak bonus!`;

      Alert.alert('Report submitted! ✓', msg);
      setSelectedType(null); setSelectedSubtype('');
      setDescription(''); setPhotoBase64(null);

      // Refresh user credits
      api.me().then(u => setAuth(await getToken(), u)).catch(() => {});
      if (loc) refreshNearby(loc.lat, loc.lng);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSubmitting(false);
    }
  }

  const creditsEarned = photoBase64 ? 20 : 10;

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>Reports</Text>
        {user && (
          <View style={s.streakBadge}>
            {(user.report_streak ?? 0) > 1 && (
              <Text style={s.streakText}>🔥 {user.report_streak}d</Text>
            )}
            <Text style={s.credits}>⚡ {user.credits}</Text>
          </View>
        )}
      </View>

      <View style={s.tabs}>
        {([['submit','REPORT'],['nearby','NEARBY'],['leaderboard','LEADERS']] as const).map(([t, label]) => (
          <TouchableOpacity key={t} style={[s.tab, view === t && s.tabActive]} onPress={() => setView(t)}>
            <Text style={[s.tabText, view === t && s.tabTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {view === 'submit' && (
        <ScrollView contentContainerStyle={s.scroll}>
          <Text style={s.sectionLabel}>REPORT TYPE</Text>
          <View style={s.typeGrid}>
            {REPORT_TYPES.map(rt => (
              <TouchableOpacity key={rt.type}
                style={[s.typeBtn, selectedType?.type === rt.type && s.typeBtnActive]}
                onPress={() => { setSelectedType(rt); setSelectedSubtype(''); }}>
                <Ionicons name={rt.icon as any} size={22}
                  color={selectedType?.type === rt.type ? '#e67e22' : '#64748b'} />
                <Text style={[s.typeBtnText, selectedType?.type === rt.type && { color: '#e67e22' }]}>
                  {rt.label}
                </Text>
                <Text style={s.ttlText}>~{rt.ttl}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {selectedType && (
            <>
              <Text style={s.sectionLabel}>DETAILS</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
                {selectedType.subtypes.map(sub => (
                  <TouchableOpacity key={sub}
                    style={[s.chip, selectedSubtype === sub && s.chipActive]}
                    onPress={() => setSelectedSubtype(sub)}>
                    <Text style={[s.chipText, selectedSubtype === sub && s.chipTextActive]}>{sub}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={s.sectionLabel}>SEVERITY</Text>
              <View style={s.severityRow}>
                {SEVERITY.map(sv => (
                  <TouchableOpacity key={sv.val}
                    style={[s.sevBtn, severity === sv.val && { borderColor: sv.color, backgroundColor: sv.color + '20' }]}
                    onPress={() => setSeverity(sv.val)}>
                    <Text style={[s.sevText, severity === sv.val && { color: sv.color }]}>{sv.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={s.sectionLabel}>PHOTO <Text style={s.photoBadge}> +10 BONUS CREDITS </Text></Text>
              <View style={s.photoRow}>
                <TouchableOpacity style={s.photoBtn} onPress={takePhoto}>
                  <Ionicons name="camera-outline" size={20} color="#64748b" />
                  <Text style={s.photoBtnText}>Camera</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.photoBtn} onPress={pickPhoto}>
                  <Ionicons name="image-outline" size={20} color="#64748b" />
                  <Text style={s.photoBtnText}>Library</Text>
                </TouchableOpacity>
                {photoBase64 && (
                  <View style={s.photoThumb}>
                    <Image source={{ uri: `data:image/jpeg;base64,${photoBase64}` }} style={s.thumbImg} />
                    <TouchableOpacity style={s.removePhoto} onPress={() => setPhotoBase64(null)}>
                      <Ionicons name="close-circle" size={18} color="#dc2626" />
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              <Text style={s.sectionLabel}>NOTES (OPTIONAL)</Text>
              <TextInput
                style={s.notesInput}
                value={description} onChangeText={setDescription}
                placeholder="Any details travelers should know..."
                placeholderTextColor="#64748b" multiline numberOfLines={3}
              />

              <View style={s.creditHint}>
                <Ionicons name="flash" size={14} color="#e67e22" />
                <Text style={s.creditHintText}>
                  Submit → +{creditsEarned} credits{photoBase64 ? ' (photo bonus!)' : ''}
                  {'\n'}Report active for ~{selectedType.ttl} unless flagged
                </Text>
              </View>

              <TouchableOpacity style={[s.submitBtn, submitting && s.submitBtnDisabled]}
                onPress={submit} disabled={submitting}>
                <Text style={s.submitBtnText}>{submitting ? 'SUBMITTING...' : 'SUBMIT REPORT'}</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      )}

      {view === 'nearby' && (
        <ScrollView contentContainerStyle={s.scroll}>
          {nearby.length === 0 ? (
            <Text style={s.empty}>No active reports nearby.\nBe the first to report!</Text>
          ) : nearby.map(r => (
            <ReportCard key={r.id} report={r}
              onUpvote={() => api.upvoteReport(r.id).catch(() => {})}
              onDownvote={() => { api.downvoteReport(r.id).catch(() => {}); }}
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
            <View key={entry.username} style={s.leaderRow}>
              <Text style={[s.leaderRank, i < 3 && { color: '#e67e22' }]}>
                {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
              </Text>
              <View style={s.leaderInfo}>
                <Text style={s.leaderName}>{entry.username}</Text>
                <Text style={s.leaderMeta}>
                  {entry.report_count} reports · {entry.total_upvotes ?? 0} upvotes
                  {entry.streak > 1 ? ` · 🔥 ${entry.streak}d` : ''}
                </Text>
              </View>
              {user?.username === entry.username && (
                <Text style={s.leaderYou}>YOU</Text>
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
  const typeInfo = REPORT_TYPES.find(t => t.type === r.type);
  const sevColor = SEVERITY.find(s => s.val === r.severity)?.color ?? '#64748b';
  const age = Math.floor((Date.now() / 1000 - r.created_at) / 3600);
  const expiresIn = r.expires_at ? Math.max(0, Math.floor((r.expires_at - Date.now() / 1000) / 3600)) : null;

  return (
    <View style={rc.card}>
      {r.cluster_count > 1 && (
        <View style={rc.clusterBadge}>
          <Text style={rc.clusterText}>{r.cluster_count} reports here</Text>
        </View>
      )}
      <View style={rc.row}>
        <Ionicons name={(typeInfo?.icon ?? 'alert-circle-outline') as any} size={18} color={sevColor} />
        <View style={rc.info}>
          <Text style={rc.type}>{typeInfo?.label ?? r.type}</Text>
          {r.subtype && <Text style={rc.subtype}>{r.subtype}</Text>}
        </View>
        <View style={[rc.sevBadge, { backgroundColor: sevColor + '20', borderColor: sevColor }]}>
          <Text style={[rc.sevText, { color: sevColor }]}>
            {SEVERITY.find(s => s.val === r.severity)?.label ?? r.severity}
          </Text>
        </View>
      </View>
      {r.description ? <Text style={rc.desc}>{r.description}</Text> : null}
      <View style={rc.footer}>
        <Text style={rc.meta}>
          @{r.username} · {age < 1 ? 'just now' : `${age}h ago`}
          {expiresIn !== null ? ` · expires ${expiresIn}h` : ''}
          {r.has_photo ? ' · 📷' : ''}
          {r.confirmations > 0 ? ` · ✓ ${r.confirmations}` : ''}
        </Text>
        <View style={rc.actions}>
          <TouchableOpacity style={rc.actionBtn} onPress={onConfirm}>
            <Ionicons name="checkmark-circle-outline" size={16} color="#27ae60" />
            <Text style={[rc.actionText, { color: '#27ae60' }]}>Still there</Text>
          </TouchableOpacity>
          <TouchableOpacity style={rc.voteBtn} onPress={onUpvote}>
            <Ionicons name="thumbs-up-outline" size={14} color="#27ae60" />
            <Text style={[rc.voteCount, { color: '#27ae60' }]}>{r.upvotes}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={rc.voteBtn} onPress={onDownvote}>
            <Ionicons name="thumbs-down-outline" size={14} color="#dc2626" />
            <Text style={[rc.voteCount, { color: '#dc2626' }]}>{r.downvotes ?? 0}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const rc = StyleSheet.create({
  card: { backgroundColor: '#1a1f2a', borderRadius: 10, borderWidth: 1, borderColor: '#252b38', padding: 14, marginBottom: 10 },
  clusterBadge: { backgroundColor: '#e67e2220', borderRadius: 6, padding: 4, paddingHorizontal: 8, alignSelf: 'flex-start', marginBottom: 8 },
  clusterText: { color: '#e67e22', fontSize: 10, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  info: { flex: 1 },
  type: { color: '#e2e8f0', fontWeight: '600', fontSize: 13 },
  subtype: { color: '#94a3b8', fontSize: 11, marginTop: 1 },
  sevBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  sevText: { fontSize: 10, fontWeight: '700' },
  desc: { color: '#94a3b8', fontSize: 12, lineHeight: 17, marginBottom: 8 },
  footer: { gap: 6 },
  meta: { color: '#64748b', fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actionText: { fontSize: 12, fontWeight: '600' },
  votes: { flexDirection: 'row', gap: 12 },
  voteBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  voteCount: { fontSize: 12, fontWeight: '600' },
});

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0c0f14' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderColor: '#252b38' },
  title: { color: '#e2e8f0', fontSize: 18, fontWeight: '700' },
  streakBadge: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  streakText: { color: '#e67e22', fontSize: 13, fontWeight: '700' },
  credits: { color: '#e67e22', fontSize: 13, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', fontWeight: '700' },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#252b38' },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: '#e67e22' },
  tabText: { color: '#64748b', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', fontWeight: '700' },
  tabTextActive: { color: '#e67e22' },
  scroll: { padding: 16, gap: 12, paddingBottom: 40 },
  sectionLabel: { color: '#64748b', fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', letterSpacing: 1, marginBottom: 8 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  typeBtn: { width: '47%', backgroundColor: '#1a1f2a', borderWidth: 1, borderColor: '#252b38', borderRadius: 10, padding: 12, alignItems: 'center', gap: 4 },
  typeBtnActive: { borderColor: '#e67e22', backgroundColor: '#e67e2210' },
  typeBtnText: { color: '#64748b', fontSize: 12, fontWeight: '500' },
  ttlText: { color: '#374151', fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  chipRow: { gap: 8, paddingBottom: 4, marginBottom: 16 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, backgroundColor: '#1a1f2a', borderWidth: 1, borderColor: '#252b38', borderRadius: 20 },
  chipActive: { borderColor: '#e67e22', backgroundColor: '#e67e2215' },
  chipText: { color: '#94a3b8', fontSize: 12 },
  chipTextActive: { color: '#e67e22' },
  severityRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  sevBtn: { flex: 1, paddingVertical: 8, borderWidth: 1, borderColor: '#252b38', borderRadius: 8, alignItems: 'center', backgroundColor: '#1a1f2a' },
  sevText: { color: '#64748b', fontSize: 11, fontWeight: '700' },
  photoBadge: { backgroundColor: '#27ae6020', color: '#27ae60', fontSize: 9, borderRadius: 4, overflow: 'hidden', paddingHorizontal: 4 },
  photoRow: { flexDirection: 'row', gap: 10, marginBottom: 16, alignItems: 'center' },
  photoBtn: { backgroundColor: '#1a1f2a', borderWidth: 1, borderColor: '#252b38', borderRadius: 10, padding: 12, alignItems: 'center', gap: 4, flex: 1 },
  photoBtnText: { color: '#64748b', fontSize: 11 },
  photoThumb: { width: 60, height: 60, borderRadius: 8, overflow: 'visible', position: 'relative' },
  thumbImg: { width: 60, height: 60, borderRadius: 8 },
  removePhoto: { position: 'absolute', top: -8, right: -8 },
  notesInput: { backgroundColor: '#1a1f2a', borderWidth: 1, borderColor: '#252b38', borderRadius: 10, padding: 12, color: '#e2e8f0', fontSize: 13, minHeight: 70, textAlignVertical: 'top', marginBottom: 12 },
  creditHint: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: '#e67e2210', borderRadius: 8, padding: 10, marginBottom: 16 },
  creditHintText: { color: '#e67e22', fontSize: 12, lineHeight: 18, flex: 1 },
  submitBtn: { backgroundColor: '#e67e22', borderRadius: 12, padding: 16, alignItems: 'center' },
  submitBtnDisabled: { backgroundColor: '#252b38' },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 14, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  empty: { color: '#64748b', textAlign: 'center', marginTop: 60, lineHeight: 22 },
  leaderRow: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#1a1f2a', borderRadius: 10, borderWidth: 1, borderColor: '#252b38', padding: 14, marginBottom: 8 },
  leaderRank: { color: '#64748b', fontSize: 18, width: 30, textAlign: 'center' },
  leaderInfo: { flex: 1 },
  leaderName: { color: '#e2e8f0', fontWeight: '600', fontSize: 14 },
  leaderMeta: { color: '#64748b', fontSize: 11, marginTop: 2 },
  leaderYou: { color: '#e67e22', fontSize: 10, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
});
