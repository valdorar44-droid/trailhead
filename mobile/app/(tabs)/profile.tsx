import { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  TextInput, Alert, Share, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';

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
      Alert.alert('Welcome to Trailhead! ⛺', `You've been given 20 welcome credits to start.`);
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
      message: `Join me on Trailhead — the AI adventure planner for overlanders! Use my code ${user.referral_code} to sign up and we both get credits.\nhttps://trailhead-production-2049.up.railway.app`,
      title: 'Join Trailhead',
    });
  }

  if (view === 'login') return (
    <SafeAreaView style={s.container}>
      <View style={s.authWrap}>
        <Text style={s.authTitle}>⛺ Trailhead</Text>
        <Text style={s.authSub}>Sign in to earn credits, track reports, and save trips.</Text>
        <TextInput style={s.input} placeholder="Email" placeholderTextColor="#64748b" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
        <TextInput style={s.input} placeholder="Password" placeholderTextColor="#64748b" value={password} onChangeText={setPassword} secureTextEntry />
        <TouchableOpacity style={s.btn} onPress={login} disabled={loading}>
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
        <Text style={s.authTitle}>Create Account</Text>
        <Text style={s.authSub}>Get 20 welcome credits just for signing up.</Text>
        <TextInput style={s.input} placeholder="Email" placeholderTextColor="#64748b" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
        <TextInput style={s.input} placeholder="Username" placeholderTextColor="#64748b" value={username} onChangeText={setUsername} autoCapitalize="none" />
        <TextInput style={s.input} placeholder="Password" placeholderTextColor="#64748b" value={password} onChangeText={setPassword} secureTextEntry />
        <TextInput style={s.input} placeholder="Referral code (optional)" placeholderTextColor="#64748b" value={refCode} onChangeText={setRefCode} autoCapitalize="none" />
        <TouchableOpacity style={s.btn} onPress={register} disabled={loading}>
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
        {/* Profile card */}
        <View style={s.profileCard}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>{user?.username?.[0]?.toUpperCase() ?? '?'}</Text>
          </View>
          <View style={s.profileInfo}>
            <Text style={s.profileName}>{user?.username}</Text>
            <Text style={s.profileEmail}>{user?.email}</Text>
          </View>
          <TouchableOpacity onPress={() => { clearAuth(); setView('login'); }}>
            <Ionicons name="log-out-outline" size={22} color="#64748b" />
          </TouchableOpacity>
        </View>

        {/* Credits card */}
        <View style={s.creditsCard}>
          <View style={s.creditsTop}>
            <View>
              <Text style={s.creditsLabel}>TRAIL CREDITS</Text>
              <Text style={s.creditsBalance}>{user?.credits ?? 0}</Text>
            </View>
            <Ionicons name="flash" size={40} color="#e67e22" />
          </View>
          <View style={s.creditRedemptions}>
            <Text style={s.creditRedemptionTitle}>Redeem credits:</Text>
            {[
              ['500 credits', '$5 off monthly plan'],
              ['900 credits', '$10 off annual plan'],
              ['200 credits', 'Extra offline map region'],
            ].map(([cost, reward]) => (
              <View key={cost} style={s.redemptionRow}>
                <Text style={s.redemptionCost}>{cost}</Text>
                <Text style={s.redemptionArrow}>→</Text>
                <Text style={s.redemptionReward}>{reward}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity style={s.historyBtn} onPress={loadHistory}>
            <Text style={s.historyBtnText}>VIEW CREDIT HISTORY</Text>
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

        {/* Referral card */}
        <View style={s.referralCard}>
          <View style={s.referralTop}>
            <Ionicons name="people-outline" size={20} color="#e67e22" />
            <Text style={s.referralTitle}>Refer Friends</Text>
          </View>
          <Text style={s.referralDesc}>
            Share your code — you get +50 credits when a friend signs up, +100 more if they go Pro.
          </Text>
          <View style={s.referralCode}>
            <Text style={s.referralCodeText}>{user?.referral_code ?? '...'}</Text>
          </View>
          <TouchableOpacity style={s.shareBtn} onPress={shareReferral}>
            <Ionicons name="share-outline" size={18} color="#fff" />
            <Text style={s.shareBtnText}>SHARE REFERRAL LINK</Text>
          </TouchableOpacity>
        </View>

        {/* How to earn */}
        <View style={s.earnCard}>
          <Text style={s.sectionLabel}>HOW TO EARN CREDITS</Text>
          {[
            ['+20', 'Welcome bonus (done ✓)'],
            ['+10', 'Submit a community report'],
            ['+15', 'Add a campsite pin'],
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
  container: { flex: 1, backgroundColor: '#0c0f14' },
  scroll: { padding: 16, gap: 14, paddingBottom: 40 },
  authWrap: { flex: 1, justifyContent: 'center', padding: 24, gap: 14 },
  authTitle: { color: '#e2e8f0', fontSize: 28, fontWeight: '700', textAlign: 'center' },
  authSub: { color: '#64748b', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  input: { backgroundColor: '#1a1f2a', borderWidth: 1, borderColor: '#252b38', borderRadius: 12, padding: 14, color: '#e2e8f0', fontSize: 14 },
  btn: { backgroundColor: '#e67e22', borderRadius: 12, padding: 16, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 14, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  switchText: { color: '#64748b', textAlign: 'center', fontSize: 13 },
  profileCard: { backgroundColor: '#1a1f2a', borderRadius: 14, borderWidth: 1, borderColor: '#252b38', padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#e67e22', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  profileInfo: { flex: 1 },
  profileName: { color: '#e2e8f0', fontSize: 16, fontWeight: '600' },
  profileEmail: { color: '#64748b', fontSize: 12 },
  creditsCard: { backgroundColor: '#1a1f2a', borderRadius: 14, borderWidth: 1, borderColor: '#252b38', padding: 16 },
  creditsTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  creditsLabel: { color: '#64748b', fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', letterSpacing: 1 },
  creditsBalance: { color: '#e67e22', fontSize: 48, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  creditRedemptions: { gap: 8, marginBottom: 14 },
  creditRedemptionTitle: { color: '#94a3b8', fontSize: 12, marginBottom: 4 },
  redemptionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  redemptionCost: { color: '#e67e22', fontSize: 12, fontWeight: '700', width: 100 },
  redemptionArrow: { color: '#64748b' },
  redemptionReward: { color: '#e2e8f0', fontSize: 12, flex: 1 },
  historyBtn: { borderWidth: 1, borderColor: '#252b38', borderRadius: 8, padding: 10, alignItems: 'center' },
  historyBtnText: { color: '#64748b', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  historyCard: { backgroundColor: '#1a1f2a', borderRadius: 14, borderWidth: 1, borderColor: '#252b38', padding: 16 },
  sectionLabel: { color: '#64748b', fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', letterSpacing: 1, marginBottom: 10 },
  txRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderColor: '#252b3830' },
  txReason: { color: '#94a3b8', fontSize: 12, flex: 1, marginRight: 8 },
  txAmount: { fontSize: 13, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  txPos: { color: '#27ae60' },
  txNeg: { color: '#dc2626' },
  referralCard: { backgroundColor: '#1a1f2a', borderRadius: 14, borderWidth: 1, borderColor: '#252b38', padding: 16, gap: 10 },
  referralTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  referralTitle: { color: '#e2e8f0', fontSize: 15, fontWeight: '600' },
  referralDesc: { color: '#94a3b8', fontSize: 12.5, lineHeight: 18 },
  referralCode: { backgroundColor: '#0c0f14', borderRadius: 8, padding: 12, alignItems: 'center' },
  referralCodeText: { color: '#e67e22', fontSize: 16, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', letterSpacing: 2 },
  shareBtn: { backgroundColor: '#e67e22', borderRadius: 10, padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  shareBtnText: { color: '#fff', fontWeight: '700', fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  earnCard: { backgroundColor: '#1a1f2a', borderRadius: 14, borderWidth: 1, borderColor: '#252b38', padding: 16 },
  earnRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  earnAmount: { color: '#27ae60', fontSize: 13, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', width: 36 },
  earnAction: { color: '#94a3b8', fontSize: 13 },
});
