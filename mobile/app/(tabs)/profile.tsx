import { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  TextInput, Alert, Share, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { C, mono } from '@/lib/design';

export default function ProfileScreen() {
  const { user, setAuth, clearAuth } = useStore();
  const [view, setView] = useState<'main' | 'login' | 'register'>(!user ? 'login' : 'main');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [refCode, setRefCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [creditHistory, setCreditHistory] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [gpxImporting, setGpxImporting] = useState(false);
  const [gpxResult, setGpxResult] = useState('');

  async function login() {
    if (!email || !password) { Alert.alert('Fill in all fields'); return; }
    setLoading(true);
    try {
      const res = await api.login(email, password);
      setAuth(res.token, res.user);
      setView('main');
    } catch (e: any) { Alert.alert('Login failed', e.message); }
    finally { setLoading(false); }
  }

  async function register() {
    if (!email || !username || !password) { Alert.alert('Fill in all fields'); return; }
    setLoading(true);
    try {
      const res = await api.register(email, username, password, refCode);
      setAuth(res.token, res.user);
      setView('main');
      Alert.alert('Welcome to Trailhead!', 'You\'ve been given 20 welcome credits to start.');
    } catch (e: any) { Alert.alert('Registration failed', e.message); }
    finally { setLoading(false); }
  }

  async function loadHistory() {
    try {
      const res = await api.getCredits();
      setCreditHistory(res.history);
      setShowHistory(true);
    } catch (e: any) { Alert.alert('Error', e.message); }
  }

  function shareReferral() {
    if (!user) return;
    Share.share({
      message: `Join me on Trailhead — the AI adventure planner for overlanders!\nUse my code ${user.referral_code} to sign up and we both earn credits.\nhttps://trailhead-production-2049.up.railway.app`,
      title: 'Join Trailhead',
    });
  }

  async function importGpx() {
    setGpxImporting(true);
    setGpxResult('');
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (result.canceled) return;
      const file = result.assets[0];
      const content = await FileSystem.readAsStringAsync(file.uri);
      // Parse GPX waypoints
      const nameMatches = [...content.matchAll(/<name>([\s\S]*?)<\/name>/g)];
      const wptMatches = [...content.matchAll(/<wpt\s+lat="([\d.\-]+)"\s+lon="([\d.\-]+)"([\s\S]*?)<\/wpt>/g)];
      const trkpts = [...content.matchAll(/<trkpt\s+lat="([\d.\-]+)"\s+lon="([\d.\-]+)"/g)];

      if (wptMatches.length === 0 && trkpts.length === 0) {
        setGpxResult('No waypoints or track points found in this GPX file.');
        return;
      }

      const pins = wptMatches.map((m, i) => ({
        lat: parseFloat(m[1]), lng: parseFloat(m[2]),
        name: nameMatches[i + 1]?.[1]?.trim() ?? `Waypoint ${i + 1}`,
        type: 'gpx_import',
        description: `Imported from GPX: ${file.name}`,
      }));

      if (pins.length > 0) {
        await Promise.all(pins.slice(0, 20).map(p => api.submitPin(p).catch(() => {})));
        setGpxResult(`Imported ${Math.min(pins.length, 20)} waypoints as community pins. +${Math.min(pins.length, 20) * 5} credits`);
      } else {
        setGpxResult(`GPX track loaded: ${trkpts.length} track points. No named waypoints to pin.`);
      }
    } catch (e: any) {
      setGpxResult(`Import failed: ${e.message}`);
    } finally {
      setGpxImporting(false);
    }
  }

  if (view === 'login') return (
    <SafeAreaView style={s.container}>
      <View style={s.authWrap}>
        <View style={s.authLogo}>
          <Text style={s.authLogoEmoji}>⛺</Text>
        </View>
        <Text style={s.authTitle}>Trailhead</Text>
        <Text style={s.authSub}>Sign in to earn credits, track reports, and save trips.</Text>
        <TextInput style={s.input} placeholder="Email" placeholderTextColor={C.text3}
          value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
        <TextInput style={s.input} placeholder="Password" placeholderTextColor={C.text3}
          value={password} onChangeText={setPassword} secureTextEntry />
        <TouchableOpacity style={[s.btn, loading && s.btnDisabled]} onPress={login} disabled={loading}>
          <Text style={s.btnText}>{loading ? 'SIGNING IN...' : 'SIGN IN'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setView('register')}>
          <Text style={s.switchText}>No account? Create one →</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );

  if (view === 'register') return (
    <SafeAreaView style={s.container}>
      <View style={s.authWrap}>
        <View style={s.authLogo}>
          <Text style={s.authLogoEmoji}>⛺</Text>
        </View>
        <Text style={s.authTitle}>Create Account</Text>
        <Text style={s.authSub}>Get 20 welcome credits just for signing up.</Text>
        <TextInput style={s.input} placeholder="Email" placeholderTextColor={C.text3}
          value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
        <TextInput style={s.input} placeholder="Username" placeholderTextColor={C.text3}
          value={username} onChangeText={setUsername} autoCapitalize="none" />
        <TextInput style={s.input} placeholder="Password" placeholderTextColor={C.text3}
          value={password} onChangeText={setPassword} secureTextEntry />
        <TextInput style={s.input} placeholder="Referral code (optional)" placeholderTextColor={C.text3}
          value={refCode} onChangeText={setRefCode} autoCapitalize="none" />
        <TouchableOpacity style={[s.btn, loading && s.btnDisabled]} onPress={register} disabled={loading}>
          <Text style={s.btnText}>{loading ? 'CREATING...' : 'CREATE ACCOUNT'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setView('login')}>
          <Text style={s.switchText}>Have an account? Sign in →</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={s.scroll}>
        {/* Profile */}
        <View style={s.profileCard}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>{user?.username?.[0]?.toUpperCase() ?? '?'}</Text>
          </View>
          <View style={s.profileInfo}>
            <Text style={s.profileName}>{user?.username}</Text>
            <Text style={s.profileEmail}>{user?.email}</Text>
            {(user?.report_streak ?? 0) > 1 && (
              <Text style={s.streakText}>🔥 {user!.report_streak}-day reporting streak</Text>
            )}
          </View>
          <TouchableOpacity onPress={() => { clearAuth(); setView('login'); }}
            style={s.logoutBtn}>
            <Ionicons name="log-out-outline" size={20} color={C.text3} />
          </TouchableOpacity>
        </View>

        {/* Credits */}
        <View style={s.creditsCard}>
          <View style={s.creditsTop}>
            <View>
              <Text style={s.creditsLabel}>TRAIL CREDITS</Text>
              <Text style={s.creditsBalance}>{user?.credits ?? 0}</Text>
            </View>
            <View style={s.creditsBadge}>
              <Text style={s.creditsBadgeIcon}>⚡</Text>
            </View>
          </View>
          <View style={s.divider} />
          <Text style={s.redemptionHeader}>REDEEM</Text>
          {[
            ['500', '$5 off monthly plan'],
            ['900', '$10 off annual plan'],
            ['200', 'Extra offline map region'],
          ].map(([cost, reward]) => (
            <View key={cost} style={s.redemptionRow}>
              <Text style={s.redemptionCost}>{cost} cr</Text>
              <Text style={s.redemptionArrow}>→</Text>
              <Text style={s.redemptionReward}>{reward}</Text>
            </View>
          ))}
          <TouchableOpacity style={s.historyBtn} onPress={loadHistory}>
            <Ionicons name="time-outline" size={14} color={C.text3} />
            <Text style={s.historyBtnText}>CREDIT HISTORY</Text>
          </TouchableOpacity>
        </View>

        {showHistory && creditHistory.length > 0 && (
          <View style={s.historyCard}>
            <Text style={s.sectionLabel}>RECENT ACTIVITY</Text>
            {creditHistory.map(tx => (
              <View key={tx.id} style={s.txRow}>
                <Text style={s.txReason} numberOfLines={1}>{tx.reason}</Text>
                <Text style={[s.txAmount, tx.amount > 0 ? s.txPos : s.txNeg]}>
                  {tx.amount > 0 ? '+' : ''}{tx.amount}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* GPX Import */}
        <View style={s.gpxCard}>
          <View style={s.gpxHeader}>
            <Ionicons name="map-outline" size={18} color={C.orange} />
            <Text style={s.gpxTitle}>Import GPX Track</Text>
          </View>
          <Text style={s.gpxDesc}>
            Import GPX files from Gaia, Garmin, or iOverlander. Named waypoints become community pins and earn you credits.
          </Text>
          {!!gpxResult && <Text style={s.gpxResult}>{gpxResult}</Text>}
          <TouchableOpacity style={[s.gpxBtn, gpxImporting && s.gpxBtnDisabled]}
            onPress={importGpx} disabled={gpxImporting}>
            <Ionicons name={gpxImporting ? 'hourglass-outline' : 'cloud-upload-outline'}
              size={16} color="#fff" />
            <Text style={s.gpxBtnText}>{gpxImporting ? 'IMPORTING...' : 'SELECT GPX FILE'}</Text>
          </TouchableOpacity>
        </View>

        {/* Referral */}
        <View style={s.referralCard}>
          <View style={s.referralHeader}>
            <Ionicons name="people-outline" size={18} color={C.orange} />
            <Text style={s.referralTitle}>Refer Friends</Text>
          </View>
          <Text style={s.referralDesc}>
            Share your code — +50 credits when a friend signs up, +100 more if they go Pro.
          </Text>
          <View style={s.codeBox}>
            <Text style={s.codeText}>{user?.referral_code ?? '...'}</Text>
          </View>
          <TouchableOpacity style={s.shareBtn} onPress={shareReferral}>
            <Ionicons name="share-outline" size={16} color="#fff" />
            <Text style={s.shareBtnText}>SHARE REFERRAL LINK</Text>
          </TouchableOpacity>
        </View>

        {/* How to earn */}
        <View style={s.earnCard}>
          <Text style={s.sectionLabel}>HOW TO EARN CREDITS</Text>
          {[
            ['+20', 'Welcome bonus'],
            ['+10', 'Submit a community report'],
            ['+20', 'Report with photo'],
            ['+15', 'Add a campsite pin'],
            ['+5',  'Import GPX waypoint'],
            ['+25', 'Plan and share a trip'],
            ['+50', 'Refer a friend who signs up'],
            ['+2',  'Your report gets upvoted'],
          ].map(([amount, action]) => (
            <View key={action} style={s.earnRow}>
              <Text style={s.earnAmount}>{amount}</Text>
              <Text style={s.earnAction}>{action}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 14, gap: 14, paddingBottom: 40 },

  authWrap: { flex: 1, justifyContent: 'center', padding: 24, gap: 14 },
  authLogo: {
    width: 64, height: 64, borderRadius: 18,
    backgroundColor: C.orange, alignItems: 'center', justifyContent: 'center',
    alignSelf: 'center', marginBottom: 4,
    shadowColor: C.orange, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10,
  },
  authLogoEmoji: { fontSize: 32 },
  authTitle: { color: C.text, fontSize: 26, fontWeight: '800', textAlign: 'center', letterSpacing: -0.3 },
  authSub: { color: C.text3, fontSize: 13.5, textAlign: 'center', lineHeight: 20, marginBottom: 4 },
  input: {
    backgroundColor: C.s2, borderWidth: 1.5, borderColor: C.border,
    borderRadius: 12, padding: 14, color: C.text, fontSize: 14,
  },
  btn: {
    backgroundColor: C.orange, borderRadius: 12, padding: 16, alignItems: 'center',
    shadowColor: C.orange, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.35, shadowRadius: 8,
  },
  btnDisabled: { backgroundColor: C.s3, shadowOpacity: 0 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 14, fontFamily: mono },
  switchText: { color: C.text3, textAlign: 'center', fontSize: 13 },

  profileCard: {
    backgroundColor: C.s2, borderRadius: 16, borderWidth: 1, borderColor: C.border,
    padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14,
  },
  avatar: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: C.orange, alignItems: 'center', justifyContent: 'center',
    shadowColor: C.orange, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 6,
  },
  avatarText: { color: '#fff', fontSize: 22, fontWeight: '800' },
  profileInfo: { flex: 1 },
  profileName: { color: C.text, fontSize: 16, fontWeight: '700' },
  profileEmail: { color: C.text3, fontSize: 12, marginTop: 1 },
  streakText: { color: C.orange, fontSize: 11, fontFamily: mono, marginTop: 4 },
  logoutBtn: { padding: 6 },

  creditsCard: {
    backgroundColor: C.s2, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 16,
  },
  creditsTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  creditsLabel: { color: C.text3, fontSize: 10, fontFamily: mono, letterSpacing: 1 },
  creditsBalance: { color: C.orange, fontSize: 52, fontWeight: '800', fontFamily: mono, lineHeight: 58 },
  creditsBadge: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: C.orangeGlow, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.orange,
  },
  creditsBadgeIcon: { fontSize: 26 },
  divider: { height: 1, backgroundColor: C.border, marginBottom: 12 },
  redemptionHeader: { color: C.text3, fontSize: 10, fontFamily: mono, letterSpacing: 1, marginBottom: 8 },
  redemptionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  redemptionCost: { color: C.orange, fontSize: 12, fontWeight: '700', fontFamily: mono, width: 60 },
  redemptionArrow: { color: C.text3 },
  redemptionReward: { color: C.text2, fontSize: 12, flex: 1 },
  historyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: C.border, borderRadius: 10,
    padding: 10, alignSelf: 'flex-start', marginTop: 8,
  },
  historyBtnText: { color: C.text3, fontSize: 11, fontFamily: mono },

  historyCard: {
    backgroundColor: C.s2, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14,
  },
  sectionLabel: { color: C.text3, fontSize: 10, fontFamily: mono, letterSpacing: 1, marginBottom: 10 },
  txRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 7, borderBottomWidth: 1, borderColor: C.border + '50',
  },
  txReason: { color: C.text2, fontSize: 12, flex: 1, marginRight: 8 },
  txAmount: { fontSize: 13, fontWeight: '700', fontFamily: mono },
  txPos: { color: C.green },
  txNeg: { color: C.red },

  gpxCard: {
    backgroundColor: C.s2, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 16, gap: 10,
  },
  gpxHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  gpxTitle: { color: C.text, fontSize: 15, fontWeight: '700' },
  gpxDesc: { color: C.text3, fontSize: 12.5, lineHeight: 18 },
  gpxResult: { color: C.green, fontSize: 12, fontFamily: mono },
  gpxBtn: {
    backgroundColor: C.s3, borderRadius: 10, padding: 13,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1, borderColor: C.border,
  },
  gpxBtnDisabled: { opacity: 0.5 },
  gpxBtnText: { color: C.text2, fontSize: 12, fontFamily: mono, fontWeight: '700' },

  referralCard: {
    backgroundColor: C.s2, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 16, gap: 10,
  },
  referralHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  referralTitle: { color: C.text, fontSize: 15, fontWeight: '700' },
  referralDesc: { color: C.text3, fontSize: 12.5, lineHeight: 18 },
  codeBox: {
    backgroundColor: C.bg, borderRadius: 10, padding: 14, alignItems: 'center',
    borderWidth: 1, borderColor: C.border,
  },
  codeText: { color: C.orange, fontSize: 18, fontWeight: '800', fontFamily: mono, letterSpacing: 3 },
  shareBtn: {
    backgroundColor: C.orange, borderRadius: 10, padding: 13,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    shadowColor: C.orange, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.35, shadowRadius: 8,
  },
  shareBtnText: { color: '#fff', fontWeight: '700', fontSize: 12, fontFamily: mono },

  earnCard: {
    backgroundColor: C.s2, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 16,
  },
  earnRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 5 },
  earnAmount: { color: C.green, fontSize: 13, fontWeight: '800', fontFamily: mono, width: 40 },
  earnAction: { color: C.text2, fontSize: 13 },
});
