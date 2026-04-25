import { useState, useEffect, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  TextInput, Alert, Share, Linking, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { api, CreditPackage } from '@/lib/api';
import { useStore, RigProfile } from '@/lib/store';
import { useTheme, mono, ColorPalette } from '@/lib/design';

type ChecklistItem = { id: string; label: string; done: boolean };
type ChecklistSection = { title: string; emoji: string; items: ChecklistItem[] };

const DEFAULT_CHECKLIST: ChecklistSection[] = [
  { title: 'Vehicle', emoji: '🚙', items: [
    { id: 'fluids', label: 'Check all fluids (oil, coolant, brakes)', done: false },
    { id: 'tires', label: 'Tires inflated + spare checked', done: false },
    { id: 'brakes', label: 'Brakes & lights inspected', done: false },
    { id: 'battery', label: 'Battery tested', done: false },
  ]},
  { title: 'Recovery', emoji: '🪢', items: [
    { id: 'tow_strap', label: 'Recovery tow strap', done: false },
    { id: 'hi_lift', label: 'Hi-lift jack + base', done: false },
    { id: 'shovel', label: 'Folding shovel', done: false },
    { id: 'boards', label: 'Traction boards', done: false },
  ]},
  { title: 'Comms & Nav', emoji: '📡', items: [
    { id: 'garmin', label: 'Satellite comms (InReach / SPOT)', done: false },
    { id: 'radio', label: 'CB or GMRS radio', done: false },
    { id: 'offline', label: 'Offline maps downloaded', done: false },
    { id: 'paper', label: 'Paper maps / topo backup', done: false },
  ]},
  { title: 'Provisions', emoji: '🧃', items: [
    { id: 'water', label: '1 gal water per person per day', done: false },
    { id: 'food', label: 'Extra food (2-day buffer)', done: false },
    { id: 'filter', label: 'Water filter / purification tabs', done: false },
    { id: 'firstaid', label: 'First aid kit', done: false },
    { id: 'fire', label: 'Fire extinguisher', done: false },
  ]},
];

const VEHICLE_TYPES = ['Truck', 'Jeep', 'SUV', 'Van', 'Overlander', 'Moto'];
const DRIVE_TYPES   = ['2WD', 'AWD', '4x4 PT', '4x4 FT'];
const LIFT_OPTIONS  = ['Stock', '2"', '4"', '6"+'];

const DEFAULT_RIG: RigProfile = {
  vehicle_type: '', year: '', make: '', model: '',
  ground_clearance_in: '', lift_in: 'Stock', drive: '4x4 PT', length_ft: '',
};

export default function ProfileScreen() {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const { user, rigProfile, setAuth, clearAuth, setRigProfile } = useStore();
  const themeMode = useStore(st => st.themeMode);
  const setThemeMode = useStore(st => st.setThemeMode);
  const [view, setView] = useState<'main' | 'login' | 'register'>(!user ? 'login' : 'main');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [refCode, setRefCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [creditHistory, setCreditHistory] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [buyingPkg, setBuyingPkg] = useState<string | null>(null);
  const [gpxImporting, setGpxImporting] = useState(false);
  const [gpxResult, setGpxResult] = useState('');

  const [editingRig, setEditingRig] = useState(false);
  const [rigDraft, setRigDraft] = useState<RigProfile>(rigProfile ?? DEFAULT_RIG);
  const [checklist, setChecklist] = useState<ChecklistSection[]>(DEFAULT_CHECKLIST);
  const [showChecklist, setShowChecklist] = useState(false);

  // Update view once session is restored from SecureStore
  useEffect(() => {
    if (user && view !== 'main') setView('main');
  }, [user]);

  // Sync draft when rigProfile loads from SecureStore
  useEffect(() => {
    if (rigProfile && !editingRig) setRigDraft(rigProfile);
  }, [rigProfile]);

  // Load checklist from SecureStore on mount
  useEffect(() => {
    SecureStore.getItemAsync('trailhead_checklist').then(json => {
      if (json) setChecklist(JSON.parse(json));
    }).catch(() => {});
  }, []);

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
      Alert.alert('Welcome to Trailhead!', 'You\'ve been given 75 free credits — enough to plan your first few trips.');
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

  async function loadPackages() {
    if (packages.length > 0) return;
    try { setPackages(await api.getCreditPackages()); } catch {}
  }

  async function buyPackage(pkgId: string) {
    setBuyingPkg(pkgId);
    try {
      const res = await api.createCheckout(pkgId);
      await Linking.openURL(res.url);
    } catch (e: any) {
      Alert.alert('Checkout error', e.message);
    } finally {
      setBuyingPkg(null);
    }
  }

  function shareReferral() {
    if (!user) return;
    Share.share({
      message: `Join me on Trailhead — the AI adventure planner for overlanders!\nUse my code ${user.referral_code} to sign up and we both earn credits.\nhttps://trailhead-production-2049.up.railway.app`,
      title: 'Join Trailhead',
    });
  }

  function toggleCheckItem(sectionIdx: number, itemId: string) {
    setChecklist(prev => {
      const next = prev.map((sec, si) => si !== sectionIdx ? sec : {
        ...sec,
        items: sec.items.map(item => item.id === itemId ? { ...item, done: !item.done } : item),
      });
      SecureStore.setItemAsync('trailhead_checklist', JSON.stringify(next)).catch(() => {});
      return next;
    });
  }

  function resetChecklist() {
    const reset = checklist.map(sec => ({ ...sec, items: sec.items.map(i => ({ ...i, done: false })) }));
    setChecklist(reset);
    SecureStore.setItemAsync('trailhead_checklist', JSON.stringify(reset)).catch(() => {});
  }

  function saveRig() {
    if (!rigDraft.make || !rigDraft.model) { Alert.alert('Add at least a make and model'); return; }
    setRigProfile(rigDraft);
    setEditingRig(false);
  }

  async function importGpx() {
    setGpxImporting(true);
    setGpxResult('');
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (result.canceled) return;
      const file = result.assets[0];
      const content = await FileSystem.readAsStringAsync(file.uri);
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
        setGpxResult(`Imported ${Math.min(pins.length, 20)} waypoints as community pins. +${Math.min(pins.length, 20) * 3} credits`);
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
        <Text style={s.authSub}>Get 75 free credits on signup — enough for your first few AI trips.</Text>
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
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons name="flame" size={12} color={C.orange} />
                <Text style={s.streakText}>{user!.report_streak}-day reporting streak</Text>
              </View>
            )}
          </View>
          <TouchableOpacity onPress={() => { clearAuth(); setView('login'); }}
            style={s.logoutBtn}>
            <Ionicons name="log-out-outline" size={20} color={C.text3} />
          </TouchableOpacity>
        </View>

        {/* My Rig */}
        <View style={s.rigCard}>
          <View style={s.rigHeader}>
            <Ionicons name="car-sport-outline" size={18} color={C.orange} />
            <Text style={s.rigTitle}>MY RIG</Text>
            <TouchableOpacity style={s.rigEditBtn} onPress={() => {
              if (editingRig) { saveRig(); } else { setRigDraft(rigProfile ?? DEFAULT_RIG); setEditingRig(true); }
            }}>
              <Text style={s.rigEditText}>{editingRig ? 'SAVE' : rigProfile ? 'EDIT' : 'ADD RIG'}</Text>
            </TouchableOpacity>
          </View>

          {editingRig ? (
            <View style={s.rigForm}>
              {/* Vehicle type */}
              <Text style={s.rigFormLabel}>TYPE</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.rigPillRow}>
                {VEHICLE_TYPES.map(t => (
                  <TouchableOpacity key={t}
                    style={[s.rigPill, rigDraft.vehicle_type === t && s.rigPillActive]}
                    onPress={() => setRigDraft(d => ({ ...d, vehicle_type: t }))}>
                    <Text style={[s.rigPillText, rigDraft.vehicle_type === t && s.rigPillTextActive]}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Year / Make / Model */}
              <View style={s.rigRow}>
                <TextInput style={[s.rigInput, { width: 72 }]} placeholder="Year" placeholderTextColor={C.text3}
                  value={rigDraft.year} onChangeText={v => setRigDraft(d => ({ ...d, year: v }))}
                  keyboardType="numeric" maxLength={4} />
                <TextInput style={[s.rigInput, { flex: 1 }]} placeholder="Make (Toyota)" placeholderTextColor={C.text3}
                  value={rigDraft.make} onChangeText={v => setRigDraft(d => ({ ...d, make: v }))} />
              </View>
              <TextInput style={s.rigInput} placeholder="Model (Tacoma TRD Pro)" placeholderTextColor={C.text3}
                value={rigDraft.model} onChangeText={v => setRigDraft(d => ({ ...d, model: v }))} />

              {/* Drive */}
              <Text style={s.rigFormLabel}>DRIVE</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.rigPillRow}>
                {DRIVE_TYPES.map(d => (
                  <TouchableOpacity key={d}
                    style={[s.rigPill, rigDraft.drive === d && s.rigPillActive]}
                    onPress={() => setRigDraft(dr => ({ ...dr, drive: d }))}>
                    <Text style={[s.rigPillText, rigDraft.drive === d && s.rigPillTextActive]}>{d}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Lift + clearance + length */}
              <Text style={s.rigFormLabel}>LIFT</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.rigPillRow}>
                {LIFT_OPTIONS.map(l => (
                  <TouchableOpacity key={l}
                    style={[s.rigPill, rigDraft.lift_in === l && s.rigPillActive]}
                    onPress={() => setRigDraft(d => ({ ...d, lift_in: l }))}>
                    <Text style={[s.rigPillText, rigDraft.lift_in === l && s.rigPillTextActive]}>{l}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <View style={s.rigRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.rigFormLabel}>CLEARANCE (IN)</Text>
                  <TextInput style={s.rigInput} placeholder="9" placeholderTextColor={C.text3}
                    value={rigDraft.ground_clearance_in} onChangeText={v => setRigDraft(d => ({ ...d, ground_clearance_in: v }))}
                    keyboardType="decimal-pad" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.rigFormLabel}>LENGTH (FT)</Text>
                  <TextInput style={s.rigInput} placeholder="18" placeholderTextColor={C.text3}
                    value={rigDraft.length_ft} onChangeText={v => setRigDraft(d => ({ ...d, length_ft: v }))}
                    keyboardType="decimal-pad" />
                </View>
              </View>

              <TouchableOpacity style={s.rigCancelBtn} onPress={() => setEditingRig(false)}>
                <Text style={s.rigCancelText}>CANCEL</Text>
              </TouchableOpacity>
            </View>
          ) : rigProfile && (rigProfile.make || rigProfile.model) ? (
            <View style={s.rigDisplay}>
              <View style={s.rigDisplayTop}>
                <View>
                  <Text style={s.rigYear}>{rigProfile.year}</Text>
                  <Text style={s.rigMakeModel}>{rigProfile.make} {rigProfile.model}</Text>
                </View>
                <View style={s.rigTypeBadge}>
                  <Text style={s.rigTypeBadgeText}>{rigProfile.vehicle_type || 'VEHICLE'}</Text>
                </View>
              </View>
              <View style={s.rigStats}>
                {rigProfile.drive ? (
                  <View style={s.rigStat}>
                    <Text style={s.rigStatVal}>{rigProfile.drive}</Text>
                    <Text style={s.rigStatLabel}>DRIVE</Text>
                  </View>
                ) : null}
                {rigProfile.lift_in && rigProfile.lift_in !== 'Stock' ? (
                  <View style={s.rigStat}>
                    <Text style={s.rigStatVal}>{rigProfile.lift_in}</Text>
                    <Text style={s.rigStatLabel}>LIFT</Text>
                  </View>
                ) : null}
                {rigProfile.ground_clearance_in ? (
                  <View style={s.rigStat}>
                    <Text style={s.rigStatVal}>{rigProfile.ground_clearance_in}"</Text>
                    <Text style={s.rigStatLabel}>CLEARANCE</Text>
                  </View>
                ) : null}
                {rigProfile.length_ft ? (
                  <View style={s.rigStat}>
                    <Text style={s.rigStatVal}>{rigProfile.length_ft}'</Text>
                    <Text style={s.rigStatLabel}>LENGTH</Text>
                  </View>
                ) : null}
              </View>
            </View>
          ) : (
            <Text style={s.rigEmptyText}>Add your vehicle specs so Trailhead can tailor trail difficulty and logistics to your rig.</Text>
          )}
        </View>

        {/* Trip Prep Checklist */}
        <View style={s.checklistCard}>
          <TouchableOpacity style={s.checklistHeader} onPress={() => setShowChecklist(p => !p)}>
            <Ionicons name="checkmark-circle-outline" size={18} color={C.green} />
            <Text style={s.checklistTitle}>TRIP PREP</Text>
            <View style={s.checklistProgress}>
              {(() => {
                const total = checklist.reduce((n, s) => n + s.items.length, 0);
                const done  = checklist.reduce((n, s) => n + s.items.filter(i => i.done).length, 0);
                return (
                  <>
                    <Text style={[s.checklistProgressText, done === total && { color: C.green }]}>
                      {done}/{total}
                    </Text>
                    {done > 0 && done < total && (
                      <View style={s.checklistBar}>
                        <View style={[s.checklistFill, { width: `${(done / total) * 100}%` as any }]} />
                      </View>
                    )}
                    {done === total && <Text style={{ color: C.green, fontSize: 12 }}>READY!</Text>}
                  </>
                );
              })()}
            </View>
            <Ionicons name={showChecklist ? 'chevron-up' : 'chevron-down'} size={16} color={C.text3} />
          </TouchableOpacity>

          {showChecklist && (
            <>
              {checklist.map((section, si) => (
                <View key={section.title} style={s.checkSection}>
                  <Text style={s.checkSectionTitle}>{section.emoji} {section.title.toUpperCase()}</Text>
                  {section.items.map(item => (
                    <TouchableOpacity key={item.id} style={s.checkItem} onPress={() => toggleCheckItem(si, item.id)}>
                      <View style={[s.checkbox, item.done && s.checkboxDone]}>
                        {item.done && <Ionicons name="checkmark" size={13} color="#fff" />}
                      </View>
                      <Text style={[s.checkLabel, item.done && s.checkLabelDone]}>{item.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ))}
              <TouchableOpacity style={s.checkResetBtn} onPress={resetChecklist}>
                <Ionicons name="refresh-outline" size={13} color={C.text3} />
                <Text style={s.checkResetText}>RESET ALL</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Credits */}
        <View style={s.creditsCard}>
          <View style={s.creditsTop}>
            <View>
              <Text style={s.creditsLabel}>TRAIL CREDITS</Text>
              <Text style={s.creditsBalance}>{user?.credits ?? 0}</Text>
            </View>
            <View style={s.creditsBadge}>
              <Ionicons name="flash" size={22} color={C.orange} />
            </View>
          </View>
          <View style={s.divider} />
          <Text style={s.redemptionHeader}>BUY CREDITS</Text>
          {packages.length === 0 && (
            <TouchableOpacity style={s.loadPkgsBtn} onPress={loadPackages}>
              <Ionicons name="bag-add-outline" size={14} color={C.orange} />
              <Text style={s.loadPkgsBtnText}>SEE PACKAGES</Text>
            </TouchableOpacity>
          )}
          {packages.map(pkg => (
            <TouchableOpacity
              key={pkg.id}
              style={[s.pkgRow, pkg.popular && s.pkgRowPopular]}
              onPress={() => buyPackage(pkg.id)}
              disabled={buyingPkg !== null}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.pkgLabel}>{pkg.label}{pkg.popular ? '  ✦ Best Value' : ''}</Text>
                <Text style={s.pkgCredits}>{pkg.credits} credits</Text>
              </View>
              <View style={s.pkgPriceCol}>
                {buyingPkg === pkg.id
                  ? <ActivityIndicator size="small" color={C.orange} />
                  : <Text style={s.pkgPrice}>{pkg.price_display}</Text>
                }
              </View>
            </TouchableOpacity>
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

        {/* Theme toggle */}
        <TouchableOpacity
          style={s.themeToggle}
          onPress={() => setThemeMode(themeMode === 'dark' ? 'light' : 'dark')}
        >
          <Ionicons name={themeMode === 'dark' ? 'sunny-outline' : 'moon-outline'} size={18} color={C.orange} />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={s.themeToggleLabel}>{themeMode === 'dark' ? 'LIGHT MODE' : 'DARK MODE'}</Text>
            <Text style={s.themeToggleSub}>{themeMode === 'dark' ? 'Switch to outdoor-readable light theme' : 'Switch to dark theme'}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={C.text3} />
        </TouchableOpacity>

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
            Share your code — +20 credits when a friend signs up (both of you get it).
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
            ['+75', 'Signup welcome bonus (one-time)'],
            ['+5',  'Submit a community report (max 8/day)'],
            ['+10', 'Report with photo'],
            ['+2',  'Report confirmed by another user'],
            ['+5',  'Add a community pin'],
            ['+3',  'Import a GPX waypoint'],
            ['+20', 'Refer a friend who signs up'],
            ['+15', '3-day reporting streak bonus'],
            ['+30', '7-day streak bonus'],
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

const makeStyles = (C: ColorPalette) => StyleSheet.create({
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

  // MY RIG
  rigCard: {
    backgroundColor: C.s2, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 16,
  },
  rigHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  rigIcon: { fontSize: 18 },
  rigTitle: { color: C.text, fontSize: 13, fontWeight: '800', fontFamily: mono, letterSpacing: 0.5, flex: 1 },
  rigEditBtn: {
    backgroundColor: C.s3, borderRadius: 8, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  rigEditText: { color: C.orange, fontSize: 10, fontFamily: mono, fontWeight: '700' },
  rigEmptyText: { color: C.text3, fontSize: 12.5, lineHeight: 18 },

  rigDisplay: { gap: 12 },
  rigDisplayTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  rigYear: { color: C.text3, fontSize: 11, fontFamily: mono },
  rigMakeModel: { color: C.text, fontSize: 17, fontWeight: '800', marginTop: 1 },
  rigTypeBadge: {
    backgroundColor: C.orangeGlow, borderRadius: 8, borderWidth: 1, borderColor: C.orange,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  rigTypeBadgeText: { color: C.orange, fontSize: 10, fontFamily: mono, fontWeight: '700' },
  rigStats: { flexDirection: 'row', gap: 0 },
  rigStat: {
    flex: 1, alignItems: 'center', paddingVertical: 8,
    borderTopWidth: 1, borderColor: C.border,
  },
  rigStatVal: { color: C.text, fontSize: 14, fontWeight: '800', fontFamily: mono },
  rigStatLabel: { color: C.text3, fontSize: 8, fontFamily: mono, letterSpacing: 0.5, marginTop: 2 },

  rigForm: { gap: 10 },
  rigFormLabel: { color: C.text3, fontSize: 9, fontFamily: mono, letterSpacing: 1, marginBottom: 4, marginTop: 4 },
  rigPillRow: { flexDirection: 'row', gap: 6, paddingBottom: 2 },
  rigPill: {
    paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: C.s3, borderRadius: 20, borderWidth: 1, borderColor: C.border,
  },
  rigPillActive: { borderColor: C.orange, backgroundColor: C.orangeGlow },
  rigPillText: { color: C.text3, fontSize: 12, fontFamily: mono },
  rigPillTextActive: { color: C.orange },
  rigRow: { flexDirection: 'row', gap: 8 },
  rigInput: {
    backgroundColor: C.s3, borderWidth: 1, borderColor: C.border,
    borderRadius: 10, padding: 11, color: C.text, fontSize: 13,
  },
  rigCancelBtn: {
    borderWidth: 1, borderColor: C.border, borderRadius: 10,
    padding: 10, alignItems: 'center', marginTop: 4,
  },
  rigCancelText: { color: C.text3, fontSize: 11, fontFamily: mono },

  // TRIP PREP CHECKLIST
  checklistCard: {
    backgroundColor: C.s2, borderRadius: 16, borderWidth: 1, borderColor: C.border,
    overflow: 'hidden',
  },
  checklistHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8, padding: 16,
  },
  checklistIcon: { fontSize: 18 },
  checklistTitle: { color: C.text, fontSize: 13, fontWeight: '800', fontFamily: mono, letterSpacing: 0.5, flex: 1 },
  checklistProgress: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checklistProgressText: { color: C.orange, fontSize: 12, fontFamily: mono, fontWeight: '700' },
  checklistBar: {
    width: 48, height: 4, backgroundColor: C.s3, borderRadius: 2, overflow: 'hidden',
  },
  checklistFill: { height: 4, backgroundColor: C.orange, borderRadius: 2 },
  checkSection: { paddingHorizontal: 16, paddingBottom: 10 },
  checkSectionTitle: {
    color: C.text3, fontSize: 9, fontFamily: mono, letterSpacing: 1,
    marginBottom: 8, marginTop: 4,
    borderTopWidth: 1, borderColor: C.border, paddingTop: 10,
  },
  checkItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: C.border,
    backgroundColor: C.s3, alignItems: 'center', justifyContent: 'center',
  },
  checkboxDone: { backgroundColor: C.green, borderColor: C.green },
  checkLabel: { color: C.text2, fontSize: 13, flex: 1 },
  checkLabelDone: { color: C.text3, textDecorationLine: 'line-through' },
  checkResetBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, justifyContent: 'center',
    paddingVertical: 12, marginHorizontal: 16, marginBottom: 12,
    borderWidth: 1, borderColor: C.border, borderRadius: 10,
  },
  checkResetText: { color: C.text3, fontSize: 10, fontFamily: mono },

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
  loadPkgsBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10 },
  loadPkgsBtnText: { color: C.orange, fontSize: 12, fontFamily: mono, fontWeight: '700' },
  pkgRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderColor: C.border },
  pkgRowPopular: { backgroundColor: C.s2 + '88', borderRadius: 8, paddingHorizontal: 8 },
  pkgLabel: { color: C.text, fontSize: 13, fontWeight: '700' },
  pkgCredits: { color: C.text2, fontSize: 11, fontFamily: mono, marginTop: 2 },
  pkgPriceCol: { minWidth: 60, alignItems: 'flex-end' },
  pkgPrice: { color: C.orange, fontSize: 16, fontWeight: '800', fontFamily: mono },
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

  themeToggle: {
    backgroundColor: C.s1, borderRadius: 14, borderWidth: 1, borderColor: C.border,
    padding: 14, flexDirection: 'row', alignItems: 'center',
  },
  themeToggleLabel: { color: C.text, fontSize: 13, fontWeight: '700', fontFamily: mono },
  themeToggleSub: { color: C.text2, fontSize: 11, marginTop: 2 },
});
