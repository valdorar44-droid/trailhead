import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { api, Report } from '@/lib/api';
import { useStore } from '@/lib/store';

const REPORT_TYPES = [
  { type: 'road_condition', label: 'Road Condition', icon: 'car-outline',
    subtypes: ['Clear & good', 'Muddy / soft', 'Washed out', 'Snow / ice', 'Rough / rocky', 'Flooded'] },
  { type: 'campsite',       label: 'Campsite',       icon: 'bonfire-outline',
    subtypes: ['Available & clean', 'Occupied', 'Trashed / needs cleanup', 'Great condition', 'No water nearby'] },
  { type: 'hazard',         label: 'Hazard',         icon: 'warning-outline',
    subtypes: ['Downed tree', 'Rockfall', 'Wildlife', 'Fire / smoke', 'Flash flood risk'] },
  { type: 'closure',        label: 'Gate / Closure', icon: 'lock-closed-outline',
    subtypes: ['Gate locked', 'Road closed', 'Seasonal closure', 'Fire closure', 'Now open'] },
  { type: 'water',          label: 'Water Source',   icon: 'water-outline',
    subtypes: ['Water available', 'Spring dry', 'Questionable quality', 'Creek flowing well'] },
  { type: 'police',         label: 'Law Enforcement', icon: 'shield-outline',
    subtypes: ['Ranger patrol', 'Fee checkpoint', 'OHV enforcement', 'Fire restrictions check'] },
  { type: 'cell_signal',    label: 'Cell Signal',    icon: 'cellular-outline',
    subtypes: ['Strong signal', 'Weak signal', 'No signal', 'Starlink required'] },
  { type: 'wildlife',       label: 'Wildlife',       icon: 'paw-outline',
    subtypes: ['Bear activity', 'Mountain lion', 'Deer / elk herd', 'Snake', 'Cool sighting'] },
];

const SEVERITY = [
  { val: 'low',      label: 'FYI',      color: '#27ae60' },
  { val: 'moderate', label: 'Heads up', color: '#f59e0b' },
  { val: 'high',     label: 'Caution',  color: '#e67e22' },
  { val: 'critical', label: 'AVOID',    color: '#dc2626' },
];

export default function ReportScreen() {
  const user = useStore(s => s.user);
  const [loc, setLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedType, setSelectedType] = useState<typeof REPORT_TYPES[0] | null>(null);
  const [selectedSubtype, setSelectedSubtype] = useState('');
  const [severity, setSeverity] = useState('moderate');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [nearby, setNearby] = useState<Report[]>([]);
  const [view, setView] = useState<'submit' | 'nearby'>('submit');

  useEffect(() => {
    Location.requestForegroundPermissionsAsync().then(({ status }) => {
      if (status !== 'granted') return;
      Location.getCurrentPositionAsync({}).then(l => {
        const coords = { lat: l.coords.latitude, lng: l.coords.longitude };
        setLoc(coords);
        api.getNearbyReports(coords.lat, coords.lng).then(setNearby).catch(() => {});
      });
    });
  }, []);

  async function submit() {
    if (!user) { Alert.alert('Sign in required', 'Create an account to submit reports and earn credits.'); return; }
    if (!selectedType) { Alert.alert('Select a report type'); return; }
    if (!loc) { Alert.alert('Location unavailable', 'Enable location access to report.'); return; }
    setSubmitting(true);
    try {
      const res = await api.submitReport({
        lat: loc.lat, lng: loc.lng,
        type: selectedType.type, subtype: selectedSubtype,
        description, severity,
      });
      Alert.alert('Report submitted! ⛺', `+${res.credits_earned} credits earned.\nBalance: ${res.new_balance} credits.`);
      setSelectedType(null); setSelectedSubtype(''); setDescription('');
      api.getNearbyReports(loc.lat, loc.lng).then(setNearby).catch(() => {});
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>Community Reports</Text>
        {user && <Text style={s.credits}>⚡ {user.credits} credits</Text>}
      </View>

      <View style={s.tabs}>
        {(['submit', 'nearby'] as const).map(t => (
          <TouchableOpacity key={t} style={[s.tab, view === t && s.tabActive]} onPress={() => setView(t)}>
            <Text style={[s.tabText, view === t && s.tabTextActive]}>{t === 'submit' ? 'REPORT' : 'NEARBY'}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {view === 'submit' ? (
        <ScrollView contentContainerStyle={s.scroll}>
          <Text style={s.sectionLabel}>WHAT ARE YOU REPORTING?</Text>
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
              </TouchableOpacity>
            ))}
          </View>

          {selectedType && (
            <>
              <Text style={s.sectionLabel}>DETAILS</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.subtypeRow}>
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

              <Text style={s.sectionLabel}>NOTES (OPTIONAL)</Text>
              <TextInput
                style={s.notesInput}
                value={description}
                onChangeText={setDescription}
                placeholder="Any extra details..."
                placeholderTextColor="#64748b"
                multiline
                numberOfLines={3}
              />

              <View style={s.creditHint}>
                <Ionicons name="flash" size={14} color="#e67e22" />
                <Text style={s.creditHintText}>Submit this report → earn +10 credits</Text>
              </View>

              <TouchableOpacity style={[s.submitBtn, submitting && s.submitBtnDisabled]} onPress={submit} disabled={submitting}>
                <Text style={s.submitBtnText}>{submitting ? 'SUBMITTING...' : 'SUBMIT REPORT'}</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={s.scroll}>
          {nearby.length === 0 ? (
            <Text style={s.empty}>No recent reports in this area.\nBe the first to report!</Text>
          ) : nearby.map(r => (
            <ReportCard key={r.id} report={r} onVote={(up) => {
              if (up) api.upvoteReport(r.id).catch(() => {});
              else api.downvoteReport(r.id).catch(() => {});
            }} />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function ReportCard({ report: r, onVote }: { report: Report; onVote: (up: boolean) => void }) {
  const typeInfo = REPORT_TYPES.find(t => t.type === r.type);
  const sevColor = SEVERITY.find(s => s.val === r.severity)?.color ?? '#64748b';
  const age = Math.floor((Date.now() / 1000 - r.created_at) / 3600);

  return (
    <View style={rc.card}>
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
      {r.description && <Text style={rc.desc}>{r.description}</Text>}
      <View style={rc.footer}>
        <Text style={rc.meta}>@{r.username} · {age < 1 ? 'just now' : `${age}h ago`}</Text>
        <View style={rc.votes}>
          <TouchableOpacity style={rc.voteBtn} onPress={() => onVote(true)}>
            <Ionicons name="thumbs-up-outline" size={14} color="#27ae60" />
            <Text style={[rc.voteCount, { color: '#27ae60' }]}>{r.upvotes}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={rc.voteBtn} onPress={() => onVote(false)}>
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  info: { flex: 1 },
  type: { color: '#e2e8f0', fontWeight: '600', fontSize: 13 },
  subtype: { color: '#94a3b8', fontSize: 11, marginTop: 1 },
  sevBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  sevText: { fontSize: 10, fontWeight: '700' },
  desc: { color: '#94a3b8', fontSize: 12, lineHeight: 17, marginBottom: 8 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  meta: { color: '#64748b', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  votes: { flexDirection: 'row', gap: 12 },
  voteBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  voteCount: { fontSize: 12, fontWeight: '600' },
});

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0c0f14' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderColor: '#252b38' },
  title: { color: '#e2e8f0', fontSize: 18, fontWeight: '700' },
  credits: { color: '#e67e22', fontSize: 13, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', fontWeight: '700' },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#252b38' },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: '#e67e22' },
  tabText: { color: '#64748b', fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', fontWeight: '700' },
  tabTextActive: { color: '#e67e22' },
  scroll: { padding: 16, gap: 12, paddingBottom: 40 },
  sectionLabel: { color: '#64748b', fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', letterSpacing: 1, marginBottom: 8, marginTop: 4 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  typeBtn: { width: '47%', backgroundColor: '#1a1f2a', borderWidth: 1, borderColor: '#252b38', borderRadius: 10, padding: 14, alignItems: 'center', gap: 6 },
  typeBtnActive: { borderColor: '#e67e22', backgroundColor: '#e67e2210' },
  typeBtnText: { color: '#64748b', fontSize: 12, fontWeight: '500', textAlign: 'center' },
  subtypeRow: { gap: 8, paddingBottom: 4, marginBottom: 16 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, backgroundColor: '#1a1f2a', borderWidth: 1, borderColor: '#252b38', borderRadius: 20 },
  chipActive: { borderColor: '#e67e22', backgroundColor: '#e67e2215' },
  chipText: { color: '#94a3b8', fontSize: 12 },
  chipTextActive: { color: '#e67e22' },
  severityRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  sevBtn: { flex: 1, paddingVertical: 8, borderWidth: 1, borderColor: '#252b38', borderRadius: 8, alignItems: 'center', backgroundColor: '#1a1f2a' },
  sevText: { color: '#64748b', fontSize: 11, fontWeight: '700' },
  notesInput: { backgroundColor: '#1a1f2a', borderWidth: 1, borderColor: '#252b38', borderRadius: 10, padding: 12, color: '#e2e8f0', fontSize: 13, minHeight: 80, textAlignVertical: 'top', marginBottom: 12 },
  creditHint: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#e67e2210', borderRadius: 8, padding: 10, marginBottom: 16 },
  creditHintText: { color: '#e67e22', fontSize: 12 },
  submitBtn: { backgroundColor: '#e67e22', borderRadius: 12, padding: 16, alignItems: 'center' },
  submitBtnDisabled: { backgroundColor: '#252b38' },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 14, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  empty: { color: '#64748b', textAlign: 'center', marginTop: 60, lineHeight: 22 },
});
