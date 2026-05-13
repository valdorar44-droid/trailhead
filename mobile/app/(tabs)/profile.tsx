import { useState, useEffect, useMemo, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  TextInput, Alert, Share, Linking, ActivityIndicator, Image, Modal, Animated, Keyboard, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { storage } from '@/lib/storage';
import * as Updates from 'expo-updates';
import Constants from 'expo-constants';
import * as Application from 'expo-application';
import { api, ApiError, ContestStatus, ContributorProfile } from '@/lib/api';
import { useStore, RigProfile, TripHistoryItem } from '@/lib/store';
import PaywallModal from '@/components/PaywallModal';
import TourTarget from '@/components/TourTarget';
import { freeTrialLabel, useSubscription } from '@/lib/useSubscription';
import { useTheme, mono, ColorPalette } from '@/lib/design';
import { deleteOfflineTrip, getOfflineTripIndex, loadOfflineTrip, saveOfflineTrip } from '@/lib/offlineTrips';
import { deleteRouteGeometry, saveRouteGeometry } from '@/lib/offlineRoutes';
import {
  buildTripFromGpxTrack,
  gpxTrackDistanceMiles,
  loadGpxImportBatches,
  parseGpx,
  removeGpxImportBatch,
  saveGpxImportBatch,
  thinTrackCoords,
  type GpxImportBatch,
} from '@/lib/gpxImport';
import { CREDIT_REWARDS } from '@/lib/credits';

type ChecklistItem = { id: string; label: string; done: boolean };
type ChecklistSection = { title: string; icon: keyof typeof Ionicons.glyphMap; items: ChecklistItem[] };

const DEFAULT_CHECKLIST: ChecklistSection[] = [
  { title: 'Vehicle', icon: 'car-sport-outline', items: [
    { id: 'fluids', label: 'Check all fluids (oil, coolant, brakes)', done: false },
    { id: 'tires', label: 'Tires inflated + spare checked', done: false },
    { id: 'brakes', label: 'Brakes & lights inspected', done: false },
    { id: 'battery', label: 'Battery tested', done: false },
  ]},
  { title: 'Recovery', icon: 'construct-outline', items: [
    { id: 'tow_strap', label: 'Recovery tow strap', done: false },
    { id: 'hi_lift', label: 'Hi-lift jack + base', done: false },
    { id: 'shovel', label: 'Folding shovel', done: false },
    { id: 'boards', label: 'Traction boards', done: false },
  ]},
  { title: 'Comms & Nav', icon: 'radio-outline', items: [
    { id: 'garmin', label: 'Satellite comms (InReach / SPOT)', done: false },
    { id: 'radio', label: 'CB or GMRS radio', done: false },
    { id: 'offline', label: 'Offline maps downloaded', done: false },
    { id: 'paper', label: 'Paper maps / topo backup', done: false },
  ]},
  { title: 'Provisions', icon: 'water-outline', items: [
    { id: 'water', label: '1 gal water per person per day', done: false },
    { id: 'food', label: 'Extra food (2-day buffer)', done: false },
    { id: 'filter', label: 'Water filter / purification tabs', done: false },
    { id: 'firstaid', label: 'First aid kit', done: false },
    { id: 'fire', label: 'Fire extinguisher', done: false },
  ]},
];

const VEHICLE_TYPES = ['Truck', 'Jeep', 'SUV', 'Van/Camper', 'Moto', 'Other'];
const DRIVE_TYPES   = ['2WD', 'AWD', '4x4 PT', '4x4 FT'];
const SUSP_TYPES    = ['Stock', 'Leveling Kit', 'Lift Kit', 'Coilovers', 'Long Travel'];
const DIFF_LOCK     = ['None', 'Rear Locker', 'Front + Rear'];

const MAKES_DATA: Record<string, string[]> = {
  'Toyota':     ['Tacoma', '4Runner', 'Land Cruiser', 'Tundra', 'Sequoia', 'FJ Cruiser', 'Hilux', 'RAV4'],
  'Jeep':       ['Wrangler', 'Gladiator', 'Grand Cherokee', 'Cherokee', 'Renegade', 'Compass'],
  'Ford':       ['Bronco', 'Bronco Sport', 'F-150', 'F-250', 'F-350', 'Ranger', 'Expedition', 'Explorer'],
  'Chevrolet':  ['Colorado', 'Silverado 1500', 'Silverado 2500HD', 'Silverado 3500HD', 'Suburban', 'Tahoe', 'Blazer'],
  'GMC':        ['Canyon', 'Sierra 1500', 'Sierra 2500HD', 'Sierra 3500HD', 'Yukon', 'Envoy'],
  'Ram':        ['1500', '2500', '3500', 'Rebel', 'TRX', 'ProMaster'],
  'Nissan':     ['Frontier', 'Titan', 'Xterra', 'Pathfinder', 'Armada', 'Patrol'],
  'Subaru':     ['Outback', 'Forester', 'Crosstrek', 'Ascent', 'Wilderness'],
  'Land Rover': ['Defender', 'Discovery', 'Discovery Sport', 'Range Rover Sport', 'LR4'],
  'Mercedes':   ['Sprinter', 'G-Class', 'Unimog'],
  'Rivian':     ['R1T', 'R1S'],
  'Scout':      ['Terra', 'Traveler'],
  'Honda':      ['Ridgeline', 'Passport', 'Pilot'],
  'Mitsubishi': ['Outlander', 'Eclipse Cross', 'Pajero', 'L200'],
  'Custom / Other': [],
};

const ALL_MAKES = Object.keys(MAKES_DATA);

const DEFAULT_RIG: RigProfile = {
  vehicle_type: '', year: '', make: '', model: '', trim: '',
  ground_clearance_in: '', lift_in: '', drive: '4x4 PT', length_ft: '',
  suspension: 'Stock', tire_size: '', fuel_range_miles: '', fuel_mpg: '',
  has_winch: false, winch_lbs: '', locking_diffs: 'None',
  has_skids: false, has_rack: false,
  is_towing: false, trailer_length_ft: '', tow_capacity_lbs: '',
};

export default function ProfileScreen() {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const router = useRouter();
  const { user, rigProfile, setAuth, clearAuth, setRigProfile } = useStore();
  const tripHistory    = useStore(st => st.tripHistory);
  const removeTripFromHistory = useStore(st => st.removeTripFromHistory);
  const themeMode      = useStore(st => st.themeMode);
  const setThemeMode   = useStore(st => st.setThemeMode);
  const favoriteCamps  = useStore(st => st.favoriteCamps);
  const toggleFavorite = useStore(st => st.toggleFavorite);
  const [view, setView] = useState<'main' | 'login' | 'register' | 'forgot'>(!user ? 'login' : 'main');
  const [authSuccess, setAuthSuccess] = useState('');  // brief success message before switching to main
  const authFade = useRef(new Animated.Value(1)).current;
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [refCode, setRefCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingVerifyEmail, setPendingVerifyEmail] = useState('');
  const [resendingVerify, setResendingVerify] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [creditHistory, setCreditHistory] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const hasPlan     = useStore(st => st.hasPlan);
  const setPlan     = useStore(st => st.setPlan);
  const { purchase, restore, openPaywall, monthlyProduct, annualProduct, purchasing, restoring } = useSubscription();
  const planTrial = freeTrialLabel(annualProduct) || freeTrialLabel(monthlyProduct);
  const [gpxImporting, setGpxImporting] = useState(false);
  const [gpxResult, setGpxResult] = useState('');
  const [gpxBatches, setGpxBatches] = useState<GpxImportBatch[]>([]);
  const [showContributorApply, setShowContributorApply] = useState(false);
  const [contributorExperience, setContributorExperience] = useState('');
  const [contributorRegions, setContributorRegions] = useState('');
  const [contributorSample, setContributorSample] = useState('');
  const [contributorApplying, setContributorApplying] = useState(false);
  const [contributorApplyResult, setContributorApplyResult] = useState('');
  const [showBugModal, setShowBugModal] = useState(false);
  const [bugTitle, setBugTitle] = useState('');
  const [bugDesc, setBugDesc] = useState('');
  const [bugSubmitting, setBugSubmitting] = useState(false);
  const [bugSent, setBugSent] = useState(false);
  const [showContest, setShowContest] = useState(false);
  const [contest, setContest] = useState<ContestStatus | null>(null);
  const [contestLoading, setContestLoading] = useState(false);
  const [contestEntering, setContestEntering] = useState(false);
  const [showContributions, setShowContributions] = useState(false);
  const [contributions, setContributions] = useState<ContributorProfile | null>(null);
  const [contributionsLoading, setContributionsLoading] = useState(false);
  const [visibilitySaving, setVisibilitySaving] = useState(false);

  const [editingRig, setEditingRig] = useState(false);
  const [rigDraft, setRigDraft] = useState<RigProfile>(rigProfile ?? DEFAULT_RIG);
  const [rigSection, setRigSection] = useState<'vehicle' | 'build' | 'advanced'>('vehicle');
  const [checklist, setChecklist] = useState<ChecklistSection[]>(DEFAULT_CHECKLIST);
  const [showChecklist, setShowChecklist] = useState(false);

  // Offline cache state
  const [offlineCachedIds, setOfflineCachedIds] = useState<Set<string>>(new Set());
  const setActiveTrip = useStore(st => st.setActiveTrip);
  const addTripToHistory = useStore(st => st.addTripToHistory);
  const startGuidedTour = useStore(st => st.startGuidedTour);

  // Smooth auth → main transition: dismiss keyboard, show success flash, fade out, switch view
  function transitionToMain(successMsg: string) {
    Keyboard.dismiss();
    setAuthSuccess(successMsg);
    setLoading(false);
    setTimeout(() => {
      Animated.timing(authFade, { toValue: 0, duration: 280, useNativeDriver: true }).start(() => {
        setView('main');
        authFade.setValue(1);
        setAuthSuccess('');
      });
    }, 700);
  }

  // If user session restores from SecureStore after mount, skip the login screen
  useEffect(() => {
    if (user && view !== 'main') setView('main');
  }, [user]);

  // Sync draft when rigProfile loads from SecureStore
  useEffect(() => {
    if (rigProfile && !editingRig) setRigDraft(rigProfile);
  }, [rigProfile]);

  // Load checklist from SecureStore on mount
  useEffect(() => {
    storage.get('trailhead_checklist').then(json => {
      if (json) setChecklist(JSON.parse(json));
    }).catch(() => {});
  }, []);

  // Load offline trip index to show cache badges
  useEffect(() => {
    getOfflineTripIndex().then(ids => {
      setOfflineCachedIds(new Set(ids));
    }).catch(() => {});
    loadGpxImportBatches().then(setGpxBatches).catch(() => {});
  }, []);

  async function openContest() {
    setShowContest(true);
    setContestLoading(true);
    try {
      setContest(await api.getContestStatus());
    } catch (e: any) {
      Alert.alert('Contest unavailable', e?.message ?? 'Could not load contest standings.');
    } finally {
      setContestLoading(false);
    }
  }

  async function enterContestDrawing() {
    setContestEntering(true);
    try {
      const res = await api.enterContestDrawing();
      setContest(prev => prev ? { ...prev, ...res.status } : prev);
      Alert.alert('Entry saved', 'You are entered in this month’s drawing. No purchase is required and a purchase does not improve your odds.');
    } catch (e: any) {
      Alert.alert('Entry failed', e?.message ?? 'Could not save your entry.');
    } finally {
      setContestEntering(false);
    }
  }

  async function openContributions() {
    setShowContributions(true);
    setContributionsLoading(true);
    try {
      setContributions(await api.getMyContributions());
    } catch (e: any) {
      Alert.alert('Contributions unavailable', e?.message ?? 'Could not load your contribution profile.');
    } finally {
      setContributionsLoading(false);
    }
  }

  async function toggleContributionVisibility() {
    if (!contributions) return;
    setVisibilitySaving(true);
    try {
      setContributions(await api.setContributionVisibility(!contributions.public_profile_visible));
    } catch (e: any) {
      Alert.alert('Privacy update failed', e?.message ?? 'Could not update profile visibility.');
    } finally {
      setVisibilitySaving(false);
    }
  }

  async function login() {
    if (!email || !password) { Alert.alert('Fill in all fields'); return; }
    setLoading(true);
    try {
      const cleanEmail = email.trim().toLowerCase();
      const res = await api.login(cleanEmail, password);
      setAuth(res.token, res.user);
      transitionToMain(`Welcome back, ${res.user.username}!`);
    } catch (e: any) {
      setLoading(false);
      if (e instanceof ApiError && e.status === 403 && String(e.message).toLowerCase().includes('email not verified')) {
        setPendingVerifyEmail(email.trim().toLowerCase());
        Alert.alert('Verify your email', 'Check your inbox for the Trailhead verification email, or resend it here.');
        return;
      }
      Alert.alert('Login failed', e.message);
    }
  }

  async function register() {
    const cleanEmail = email.trim().toLowerCase();
    const cleanUsername = username.trim();
    if (!cleanEmail || !cleanUsername || !password || !confirmPassword) { Alert.alert('Fill in all fields'); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) { Alert.alert('Email needed', 'Enter a valid email address so you can recover your account later.'); return; }
    if (password.length < 8) { Alert.alert('Password too short', 'Use at least 8 characters.'); return; }
    if (password !== confirmPassword) { Alert.alert('Passwords do not match', 'Re-enter your password so both fields match.'); return; }
    setLoading(true);
    try {
      const res = await api.register(cleanEmail, cleanUsername, password, refCode.trim());
      if (res.token && res.user) {
        setAuth(res.token, res.user);
        transitionToMain(`Welcome to Trailhead, ${res.user.username}! ${CREDIT_REWARDS.signup} credits added.`);
        return;
      }
      setLoading(false);
      setPendingVerifyEmail(res.email ?? cleanEmail);
    } catch (e: any) {
      setLoading(false);
      Alert.alert('Registration failed', e.message);
    }
  }

  async function resendVerification() {
    const target = (pendingVerifyEmail || email).trim().toLowerCase();
    if (!target) { Alert.alert('Email needed', 'Enter the email used for your Trailhead account.'); return; }
    setResendingVerify(true);
    try {
      const res = await api.resendVerification(target);
      setPendingVerifyEmail(target);
      Alert.alert('Email sent', res.message);
    } catch (e: any) {
      Alert.alert('Could not resend', e.message);
    } finally {
      setResendingVerify(false);
    }
  }

  async function forgotPassword() {
    const target = email.trim().toLowerCase();
    if (!target) { Alert.alert('Email needed', 'Enter the email used for your Trailhead account.'); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(target)) { Alert.alert('Email needed', 'Enter a valid email address.'); return; }
    setLoading(true);
    try {
      const res = await api.forgotPassword(target);
      setResetSent(true);
      Alert.alert('Check your email', res.message);
    } catch (e: any) {
      Alert.alert('Reset failed', e.message);
    } finally {
      setLoading(false);
    }
  }

  function contactSupport(subject = 'Trailhead support') {
    Linking.openURL(`mailto:hello@gettrailhead.app?subject=${encodeURIComponent(subject)}`);
  }

  async function loadHistory() {
    if (creditHistory.length > 0) { setShowHistory(p => !p); return; }
    try {
      const res = await api.getCredits();
      setCreditHistory(res.history);
      setShowHistory(true);
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 401) {
        Alert.alert('Sign in again', 'Your session expired. Sign out, then sign back in to refresh credits and purchases.');
        return;
      }
      Alert.alert('Error', e.message);
    }
  }

  async function openTripFromProfile(t: TripHistoryItem) {
    try {
      const cached = await loadOfflineTrip(t.trip_id);
      if (cached) {
        setActiveTrip(cached, true);
        router.push('/(tabs)/map');
        return;
      }

      const trip = await api.getTrip(t.trip_id);
      setActiveTrip(trip);
      saveOfflineTrip(trip)
        .then(() => getOfflineTripIndex())
        .then(ids => setOfflineCachedIds(new Set(ids)))
        .catch(() => {});
      router.push('/(tabs)/map');
    } catch (e: any) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        Alert.alert('Trip unavailable', 'This trip is not available for the current signed-in account. Sign in again or open an offline-saved copy.');
        return;
      }
      if (e instanceof ApiError && e.status === 404) {
        Alert.alert('Trip unavailable', 'This saved trip was not found on the server and is not saved offline on this device.');
        return;
      }
      Alert.alert('Trip unavailable', e?.message ?? 'Could not open this trip.');
    }
  }

  function confirmDeleteTrip(t: TripHistoryItem) {
    Alert.alert(
      'Delete saved trip?',
      `${t.trip_name} will be removed from this device and your Profile trip list.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            removeTripFromHistory(t.trip_id);
            await deleteOfflineTrip(t.trip_id);
            setOfflineCachedIds(prev => {
              const next = new Set(prev);
              next.delete(t.trip_id);
              return next;
            });
          },
        },
      ],
    );
  }

  async function openGpxBatch(batch: GpxImportBatch) {
    const tripId = batch.routeTripId || batch.routeTripIds?.[0];
    if (!tripId) {
      setGpxResult('This GPX import only added waypoint pins. Enable GPX in map filters to view them.');
      return;
    }
    try {
      const trip = await loadOfflineTrip(tripId);
      if (!trip) {
        setGpxResult('That imported route is no longer saved offline on this device.');
        return;
      }
      setActiveTrip(trip, true);
      router.push('/(tabs)/map');
    } catch (e: any) {
      setGpxResult(`Could not open GPX route: ${e?.message ?? 'unknown error'}`);
    }
  }

  function confirmDeleteGpxBatch(batch: GpxImportBatch) {
    Alert.alert(
      'Remove GPX import?',
      `${batch.routeName || batch.fileName} will be removed from GPX import history${batch.routeTripIds?.length ? ' and its saved route previews will be deleted from this device' : ''}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const tripIds = batch.routeTripIds ?? (batch.routeTripId ? [batch.routeTripId] : []);
            await Promise.all(tripIds.map(async id => {
              removeTripFromHistory(id);
              await deleteOfflineTrip(id);
              await deleteRouteGeometry(id);
            }));
            const next = await removeGpxImportBatch(batch.id);
            setGpxBatches(next);
            setOfflineCachedIds(prev => {
              const out = new Set(prev);
              tripIds.forEach(id => out.delete(id));
              return out;
            });
          },
        },
      ],
    );
  }

  async function submitBug() {
    if (!bugTitle.trim() || !bugDesc.trim()) { Alert.alert('Fill in both fields'); return; }
    setBugSubmitting(true);
    try {
      await api.submitBugReport({ title: bugTitle.trim(), description: bugDesc.trim(), app_version: '1.0' });
      setBugSent(true);
      setBugTitle(''); setBugDesc('');
      setTimeout(() => { setShowBugModal(false); setBugSent(false); }, 2500);
    } catch (e: any) { Alert.alert('Submission failed', e.message); }
    finally { setBugSubmitting(false); }
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
      storage.set('trailhead_checklist', JSON.stringify(next)).catch(() => {});
      return next;
    });
  }

  function resetChecklist() {
    const reset = checklist.map(sec => ({ ...sec, items: sec.items.map(i => ({ ...i, done: false })) }));
    setChecklist(reset);
    storage.set('trailhead_checklist', JSON.stringify(reset)).catch(() => {});
  }

  function saveRig() {
    const m = rigDraft.make;
    if (!m || m === 'Custom / Other' || !rigDraft.model) {
      Alert.alert('Add a make and model to save');
      return;
    }
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
      const parsed = parseGpx(content, file.name);
      if (parsed.waypoints.length === 0 && parsed.tracks.length === 0) {
        setGpxResult('No waypoints or track points found in this GPX file.');
        return;
      }

      const pins = parsed.waypoints
        .map((point, i) => ({
          lat: point.lat,
          lng: point.lng,
          name: (point.name || `Waypoint ${i + 1}`).slice(0, 80),
          type: 'gpx_import',
          description: [point.desc, `Imported from GPX: ${file.name}`].filter(Boolean).join('\n'),
          details: {
            import_name: parsed.name,
            ...(point.ele != null ? { elevation_m: String(Math.round(point.ele)) } : {}),
            ...(point.time ? { recorded_at: point.time } : {}),
          },
        }))
        .filter(p => isFinite(p.lat) && isFinite(p.lng) &&
          p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180);

      const pinLimit = user?.is_admin ? 250 : 15;
      let importedPins = 0;
      let duplicatePins = 0;
      if (pins.length > 0) {
        const results = await Promise.all(pins.slice(0, pinLimit).map(p => api.submitPin(p).catch(() => null)));
        importedPins = results.filter((res: any) => res?.status === 'ok' || res?.id).length;
        duplicatePins = results.filter((res: any) => res?.status === 'duplicate').length;
      }

      const savedTripIds: string[] = [];
      let primaryTripId = '';
      let primaryRoutePoints = 0;
      let totalDistance = 0;
      const tracks = [...parsed.tracks].sort((a, b) => b.distanceMiles - a.distanceMiles);
      for (const [idx, track] of tracks.entries()) {
        const tripId = `gpx_${Date.now()}_${idx + 1}`;
        const routeCoords = thinTrackCoords(track.coords);
        const trip = buildTripFromGpxTrack({ ...track, coords: routeCoords }, tripId);
        await saveOfflineTrip(trip);
        await saveRouteGeometry(trip.trip_id, {
          coords: routeCoords,
          steps: [],
          legs: [],
          totalDistance: gpxTrackDistanceMiles(routeCoords) * 1609.344,
          totalDuration: Math.max(600, gpxTrackDistanceMiles(routeCoords) / 18 * 3600),
        });
        if (idx === 0) {
          setActiveTrip(trip, true);
          primaryTripId = trip.trip_id;
          primaryRoutePoints = routeCoords.length;
        }
        savedTripIds.push(trip.trip_id);
        totalDistance += trip.plan.total_est_miles || 0;
        addTripToHistory({
          trip_id: trip.trip_id,
          trip_name: trip.plan.trip_name,
          states: [],
          duration_days: 1,
          est_miles: trip.plan.total_est_miles,
          planned_at: Date.now(),
        });
      }
      if (savedTripIds.length > 0) {
        setOfflineCachedIds(prev => new Set([...savedTripIds, ...prev]));
        const batch: GpxImportBatch = {
          id: `gpx_batch_${Date.now()}`,
          fileName: file.name,
          routeTripId: primaryTripId,
          routeTripIds: savedTripIds,
          routeName: parsed.name,
          importedAt: Date.now(),
          trackCount: parsed.sourceStats.trackCount || parsed.tracks.length,
          routeCount: parsed.sourceStats.routeCount,
          waypointCount: parsed.waypoints.length,
          importedPins,
          skippedPins: Math.max(0, pins.length - importedPins - duplicatePins),
          pinLimit,
          routePointCount: primaryRoutePoints,
          distanceMiles: totalDistance,
          status: 'review',
        };
        const batches = await saveGpxImportBatch(batch);
        setGpxBatches(batches);
        setGpxResult(`Imported ${savedTripIds.length} GPX route${savedTripIds.length === 1 ? '' : 's'} and ${importedPins} new waypoint pin${importedPins === 1 ? '' : 's'}.${duplicatePins ? ` ${duplicatePins} duplicate waypoint${duplicatePins === 1 ? '' : 's'} grouped with existing pins.` : ''}${batch.skippedPins ? ` ${batch.skippedPins} waypoints held back by the current import limit.` : ''}`);
        router.push('/(tabs)/map');
      } else {
        const batch: GpxImportBatch = {
          id: `gpx_batch_${Date.now()}`,
          fileName: file.name,
          routeName: parsed.name,
          importedAt: Date.now(),
          trackCount: 0,
          routeCount: parsed.sourceStats.routeCount,
          waypointCount: parsed.waypoints.length,
          importedPins,
          skippedPins: Math.max(0, pins.length - importedPins - duplicatePins),
          pinLimit,
          routePointCount: 0,
          distanceMiles: 0,
          status: 'review',
        };
        const batches = await saveGpxImportBatch(batch);
        setGpxBatches(batches);
        setGpxResult(`Imported ${importedPins} new GPX waypoint pin${importedPins === 1 ? '' : 's'}.${duplicatePins ? ` ${duplicatePins} duplicate waypoint${duplicatePins === 1 ? '' : 's'} grouped with existing pins.` : ''}${batch.skippedPins ? ` ${batch.skippedPins} waypoints held back by the current import limit.` : ''} Enable GPX in map filters to see them.`);
      }
    } catch (e: any) {
      setGpxResult(`Import failed: ${e.message}`);
    } finally {
      setGpxImporting(false);
    }
  }

  async function applyMapContributor() {
    const regions = contributorRegions.split(',').map(r => r.trim()).filter(Boolean);
    if (contributorExperience.trim().length < 20 || regions.length === 0) {
      Alert.alert('Add a little more detail', 'Tell us your mapping experience and at least one region you know well.');
      return;
    }
    setContributorApplying(true);
    setContributorApplyResult('');
    try {
      await api.applyMapContributor({
        experience: contributorExperience.trim(),
        regions,
        sample_note: contributorSample.trim() || undefined,
      });
      setContributorApplyResult('Application received. Imports still stay untrusted until review, verification, or trusted contributor approval.');
    } catch (e: any) {
      setContributorApplyResult(e?.message ?? 'Application failed. Please try again.');
    } finally {
      setContributorApplying(false);
    }
  }

  function renderVerificationPanel() {
    const target = pendingVerifyEmail || email.trim().toLowerCase();
    return (
      <ScrollView contentContainerStyle={s.authScroll} keyboardShouldPersistTaps="handled">
        <View style={s.authBrand}>
          <Image source={require('@/assets/icon.png')} style={s.authIcon} />
          <View>
            <Text style={s.authWordmark}>TRAILHEAD</Text>
            <Text style={s.authTagline}>AI OVERLAND GUIDE</Text>
          </View>
        </View>
        <View style={s.verifyCard}>
          <Ionicons name="mail-unread-outline" size={34} color={C.orange} />
          <Text style={s.authHeading}>Check your email</Text>
          <Text style={s.authSub}>
            We sent a Trailhead confirmation link to {target || 'your email'}. Open it to activate your account and unlock signup credits.
          </Text>
          <TouchableOpacity
            style={[s.btn, resendingVerify && s.btnDisabled]}
            onPress={resendVerification}
            disabled={resendingVerify}
          >
            <Text style={s.btnText}>{resendingVerify ? 'SENDING...' : 'RESEND EMAIL'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.secondaryAuthBtn} onPress={() => { setPendingVerifyEmail(''); setView('login'); }}>
            <Text style={s.secondaryAuthText}>Back to sign in</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.secondaryAuthBtn} onPress={() => contactSupport('Trailhead email verification help')}>
            <Text style={s.secondaryAuthText}>Contact hello@gettrailhead.app</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  if (view === 'login') return (
    <SafeAreaView style={s.container}>
      <Animated.View style={{ flex: 1, opacity: authFade }}>
        {authSuccess ? (
          <View style={s.authSuccessWrap}>
            <Ionicons name="checkmark-circle" size={52} color="#22c55e" />
            <Text style={s.authSuccessText}>{authSuccess}</Text>
          </View>
        ) : pendingVerifyEmail ? (
          renderVerificationPanel()
        ) : (
          <ScrollView contentContainerStyle={s.authScroll} keyboardShouldPersistTaps="handled">
            <View style={s.authBrand}>
              <Image source={require('@/assets/icon.png')} style={s.authIcon} />
              <View>
                <Text style={s.authWordmark}>TRAILHEAD</Text>
                <Text style={s.authTagline}>AI OVERLAND GUIDE</Text>
              </View>
            </View>
            <Text style={s.authHeading}>Welcome back</Text>
            <Text style={s.authSub}>Sign in to plan trips, sync downloads, manage Explorer, and track your field reports.</Text>
            <View style={s.authFields}>
              <TextInput style={s.input} placeholder="Email" placeholderTextColor={C.text3}
                value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
              <TextInput style={s.input} placeholder="Password" placeholderTextColor={C.text3}
                value={password} onChangeText={setPassword} secureTextEntry />
            </View>
            <TouchableOpacity style={[s.btn, loading && s.btnDisabled]} onPress={login} disabled={loading}>
              <Text style={s.btnText}>{loading ? 'SIGNING IN...' : 'SIGN IN'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.forgotBtn} onPress={() => { setResetSent(false); setView('forgot'); }}>
              <Ionicons name="key-outline" size={14} color={C.orange} />
              <Text style={s.forgotText}>Forgot your password?</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.switchRow} onPress={() => setView('register')}>
              <Text style={s.switchText}>No account?</Text>
              <Text style={s.switchLink}> Create one →</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.secondaryAuthBtn} onPress={() => { openPaywall(); setShowPaywall(true); }}>
              <Text style={s.secondaryAuthText}>View Explorer plans without an account</Text>
            </TouchableOpacity>
            <PaywallModal visible={showPaywall} onClose={() => setShowPaywall(false)} />
          </ScrollView>
        )}
      </Animated.View>
    </SafeAreaView>
  );

  if (view === 'forgot') return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={s.authScroll} keyboardShouldPersistTaps="handled">
        <View style={s.authBrand}>
          <Image source={require('@/assets/icon.png')} style={s.authIcon} />
          <View>
            <Text style={s.authWordmark}>TRAILHEAD</Text>
            <Text style={s.authTagline}>AI OVERLAND GUIDE</Text>
          </View>
        </View>
        <Text style={s.authHeading}>Reset password</Text>
        <Text style={s.authSub}>
          Enter your account email. Trailhead will send a secure reset link that expires in 1 hour.
        </Text>
        <View style={s.authFields}>
          <TextInput style={s.input} placeholder="Email" placeholderTextColor={C.text3}
            value={email} onChangeText={(v) => { setEmail(v); setResetSent(false); }} autoCapitalize="none" keyboardType="email-address" />
        </View>
        {resetSent ? (
          <View style={s.verifyCard}>
            <Ionicons name="mail" size={24} color={C.orange} />
            <Text style={s.authSub}>If that email has a Trailhead account, a reset link has been sent.</Text>
          </View>
        ) : null}
        <TouchableOpacity style={[s.btn, loading && s.btnDisabled]} onPress={forgotPassword} disabled={loading}>
          <Text style={s.btnText}>{loading ? 'SENDING...' : 'SEND RESET LINK'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.secondaryAuthBtn} onPress={() => setView('login')}>
          <Text style={s.secondaryAuthText}>Back to sign in</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.secondaryAuthBtn} onPress={() => contactSupport('Trailhead password help')}>
          <Text style={s.secondaryAuthText}>Contact hello@gettrailhead.app</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );

  if (view === 'register') return (
    <SafeAreaView style={s.container}>
      <Animated.View style={{ flex: 1, opacity: authFade }}>
        {authSuccess ? (
          <View style={s.authSuccessWrap}>
            <Ionicons name="checkmark-circle" size={52} color="#22c55e" />
            <Text style={s.authSuccessText}>{authSuccess}</Text>
          </View>
        ) : pendingVerifyEmail ? (
          renderVerificationPanel()
        ) : (
          <ScrollView contentContainerStyle={s.authScroll} keyboardShouldPersistTaps="handled">
            <View style={s.authBrand}>
              <Image source={require('@/assets/icon.png')} style={s.authIcon} />
              <View>
                <Text style={s.authWordmark}>TRAILHEAD</Text>
                <Text style={s.authTagline}>AI OVERLAND GUIDE</Text>
              </View>
            </View>
            <Text style={s.authHeading}>Create account</Text>
            <View style={s.signupPerk}>
              <Ionicons name="flash" size={14} color={C.orange} />
              <Text style={s.signupPerkText}>{CREDIT_REWARDS.signup} free credits on signup + earn more by contributing to the map</Text>
            </View>
            <View style={s.authFields}>
              <TextInput style={s.input} placeholder="Email" placeholderTextColor={C.text3}
                value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
              <TextInput style={s.input} placeholder="Username" placeholderTextColor={C.text3}
                value={username} onChangeText={setUsername} autoCapitalize="none" />
              <TextInput style={s.input} placeholder="Password" placeholderTextColor={C.text3}
                value={password} onChangeText={setPassword} secureTextEntry />
              <TextInput style={s.input} placeholder="Confirm password" placeholderTextColor={C.text3}
                value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry />
              <TextInput style={s.input} placeholder="Referral code (optional)" placeholderTextColor={C.text3}
                value={refCode} onChangeText={setRefCode} autoCapitalize="none" />
            </View>
            <TouchableOpacity style={[s.btn, loading && s.btnDisabled]} onPress={register} disabled={loading}>
              <Text style={s.btnText}>{loading ? 'CREATING...' : 'CREATE ACCOUNT'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.switchRow} onPress={() => setView('login')}>
          <Text style={s.switchText}>Have an account?</Text>
          <Text style={s.switchLink}> Sign in →</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.secondaryAuthBtn} onPress={() => { openPaywall(); setShowPaywall(true); }}>
          <Text style={s.secondaryAuthText}>View Explorer plans without an account</Text>
        </TouchableOpacity>
        <PaywallModal visible={showPaywall} onClose={() => setShowPaywall(false)} />
      </ScrollView>
        )}
      </Animated.View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={s.scroll}>

        {/* Profile */}
        <TourTarget id="profile.main">
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
        </TourTarget>

        {/* Stats row */}
        {(() => {
          const totalMiles = tripHistory.reduce((sum, t) => sum + (t.est_miles || 0), 0);
          const states = [...new Set(tripHistory.flatMap(t => t.states || []))];
          return (
            <View>
              <View style={s.statsRow}>
                <View style={s.statCell}>
                  <Text style={s.statBig}>{user?.credits ?? 0}</Text>
                  <Text style={s.statLabel}>CREDITS</Text>
                </View>
                <View style={s.statDivider} />
                <View style={s.statCell}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                    {(user?.report_streak ?? 0) > 0 && <Ionicons name="flame" size={14} color={C.orange} />}
                    <Text style={s.statBig}>{user?.report_streak ?? 0}</Text>
                  </View>
                  <Text style={s.statLabel}>DAY STREAK</Text>
                </View>
                <View style={s.statDivider} />
                <View style={s.statCell}>
                  <Text style={s.statBig}>{tripHistory.length}</Text>
                  <Text style={s.statLabel}>TRIPS</Text>
                </View>
              </View>
              {tripHistory.length > 0 && (
                <View style={[s.statsRow, { marginTop: 6 }]}>
                  <View style={s.statCell}>
                    <Text style={s.statBig}>{totalMiles > 0 ? `${totalMiles.toLocaleString()}` : '—'}</Text>
                    <Text style={s.statLabel}>MILES PLANNED</Text>
                  </View>
                  <View style={s.statDivider} />
                  <View style={s.statCell}>
                    <Text style={s.statBig}>{states.length}</Text>
                    <Text style={s.statLabel}>STATES EXPLORED</Text>
                  </View>
                  <View style={s.statDivider} />
                  <View style={s.statCell}>
                    <Text numberOfLines={1} style={[s.statBig, { fontSize: 10 }]}>
                      {states.slice(0, 5).join(' · ') || '—'}
                    </Text>
                    <Text style={s.statLabel}>REGIONS</Text>
                  </View>
                </View>
              )}
            </View>
          );
        })()}

        {/* My Trips — with offline cache badges */}
        {tripHistory.length > 0 && (
          <View style={s.tripsCard}>
            <Text style={s.sectionLabel}>MY TRIPS</Text>
            {tripHistory.map(t => {
              const isCached = offlineCachedIds.has(t.trip_id);
              return (
                <View key={t.trip_id} style={s.tripRow}>
                  <TouchableOpacity style={s.tripRowOpen} onPress={() => { openTripFromProfile(t); }}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.tripRowName} numberOfLines={1}>{t.trip_name}</Text>
                      <Text style={s.tripRowMeta}>{(t.states ?? []).join(' · ')}  ·  {t.duration_days}D  ·  {t.est_miles}MI</Text>
                    </View>
                    {isCached && (
                      <View style={s.offlineBadge}>
                        <Ionicons name="download-outline" size={10} color="#22c55e" />
                        <Text style={s.offlineBadgeText}>OFFLINE</Text>
                      </View>
                    )}
                    <Ionicons name="chevron-forward" size={14} color={C.text3} style={{ marginLeft: 4 }} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={s.tripDeleteBtn}
                    onPress={() => confirmDeleteTrip(t)}
                    accessibilityLabel={`Delete ${t.trip_name}`}
                  >
                    <Ionicons name="trash-outline" size={15} color={C.red} />
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        )}

        {/* Quick actions */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.quickActionsRow}
          contentContainerStyle={s.quickActionsContent}
        >
          {[
            { icon: 'compass', label: 'PLAN TRIP',   color: C.orange, onPress: () => { setActiveTrip(null); router.push('/(tabs)'); } },
            { icon: 'trophy-outline', label: 'CONTEST', color: '#d4af37', onPress: openContest },
            { icon: 'ribbon-outline', label: 'CONTRIB', color: '#14b8a6', onPress: openContributions },
            { icon: 'people',  label: 'REFER',       color: C.orange, onPress: shareReferral },
            { icon: 'checkmark-circle', label: 'TRIP PREP', color: C.green,  onPress: () => setShowChecklist(true) },
            { icon: 'help-buoy-outline', label: 'APP TOUR', color: '#3b82f6', onPress: startGuidedTour },
            { icon: 'mail-outline', label: 'CONTACT', color: '#3b82f6', onPress: () => contactSupport('Trailhead question') },
            { icon: 'cloud-upload-outline', label: 'IMPORT GPX', color: C.text3, onPress: importGpx },
            { icon: 'bug-outline', label: 'BUG',     color: C.red,   onPress: () => setShowBugModal(true) },
          ].map(({ icon, label, color, onPress }) => (
            <TouchableOpacity key={label} style={s.quickAction} onPress={onPress}>
              <View style={[s.quickActionIcon, { borderColor: color + '44', backgroundColor: color + '18' }]}>
                <Ionicons name={icon as any} size={22} color={color} />
              </View>
              <Text style={s.quickActionLabel}>{label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* My Rig */}
        <View style={s.rigCard}>
          <View style={s.rigHeader}>
            <Ionicons name="car-sport-outline" size={18} color={C.orange} />
            <Text style={s.rigTitle}>MY RIG</Text>
            <TouchableOpacity style={s.rigEditBtn} onPress={() => {
              if (editingRig) { saveRig(); } else { setRigDraft(rigProfile ?? DEFAULT_RIG); setRigSection('vehicle'); setEditingRig(true); }
            }}>
              <Text style={s.rigEditText}>{editingRig ? 'SAVE' : rigProfile ? 'EDIT' : 'ADD RIG'}</Text>
            </TouchableOpacity>
          </View>

          {editingRig ? (
            <View style={s.rigForm}>

              {/* Section tabs */}
              <View style={s.rigTabRow}>
                {(['vehicle', 'build', 'advanced'] as const).map(tab => (
                  <TouchableOpacity key={tab} style={[s.rigTab, rigSection === tab && s.rigTabActive]}
                    onPress={() => setRigSection(tab)}>
                    <Text style={[s.rigTabText, rigSection === tab && s.rigTabTextActive]}>
                      {tab === 'vehicle' ? 'VEHICLE' : tab === 'build' ? 'BUILD' : 'ADVANCED'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* ── VEHICLE TAB ───────────────────────────────────── */}
              {rigSection === 'vehicle' && (
                <>
                  {/* Category */}
                  <Text style={s.rigFormLabel}>CATEGORY</Text>
                  <View style={s.rigPillGrid}>
                    {VEHICLE_TYPES.map(t => (
                      <TouchableOpacity key={t}
                        style={[s.rigPill, rigDraft.vehicle_type === t && s.rigPillActive]}
                        onPress={() => setRigDraft(d => ({ ...d, vehicle_type: t }))}>
                        <Text style={[s.rigPillText, rigDraft.vehicle_type === t && s.rigPillTextActive]}>{t}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* Make */}
                  <Text style={s.rigFormLabel}>MAKE</Text>
                  <View style={s.rigPillGrid}>
                    {ALL_MAKES.map(m => (
                      <TouchableOpacity key={m}
                        style={[s.rigPill, rigDraft.make === m && s.rigPillActive]}
                        onPress={() => setRigDraft(d => ({ ...d, make: m, model: '' }))}>
                        <Text style={[s.rigPillText, rigDraft.make === m && s.rigPillTextActive]}>{m}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* Model — cascades from make */}
                  {rigDraft.make && MAKES_DATA[rigDraft.make]?.length > 0 && (
                    <>
                      <Text style={s.rigFormLabel}>MODEL</Text>
                      <View style={s.rigPillGrid}>
                        {MAKES_DATA[rigDraft.make].map(mod => (
                          <TouchableOpacity key={mod}
                            style={[s.rigPill, rigDraft.model === mod && s.rigPillActive]}
                            onPress={() => setRigDraft(d => ({ ...d, model: mod }))}>
                            <Text style={[s.rigPillText, rigDraft.model === mod && s.rigPillTextActive]}>{mod}</Text>
                          </TouchableOpacity>
                        ))}
                        <TouchableOpacity
                          style={[s.rigPill, !MAKES_DATA[rigDraft.make].includes(rigDraft.model) && rigDraft.model ? s.rigPillActive : null]}
                          onPress={() => setRigDraft(d => ({ ...d, model: '' }))}>
                          <Text style={[s.rigPillText, !MAKES_DATA[rigDraft.make].includes(rigDraft.model) && rigDraft.model ? s.rigPillTextActive : null]}>Other</Text>
                        </TouchableOpacity>
                      </View>
                      {/* Custom model text field if "Other" or no match */}
                      {(!MAKES_DATA[rigDraft.make].includes(rigDraft.model)) && (
                        <TextInput style={s.rigInput} placeholder="Enter model (e.g. 80 Series, Patrol GR)" placeholderTextColor={C.text3}
                          value={rigDraft.model} onChangeText={v => setRigDraft(d => ({ ...d, model: v }))} />
                      )}
                    </>
                  )}
                  {/* Fully custom make — show text fields when no recognized make selected */}
                  {(!rigDraft.make || !ALL_MAKES.includes(rigDraft.make) || rigDraft.make === 'Custom / Other') && (
                    <>
                      <Text style={s.rigFormLabel}>MAKE</Text>
                      <TextInput style={s.rigInput} placeholder="e.g. Toyota, Scout, Bollinger…" placeholderTextColor={C.text3}
                        value={rigDraft.make === 'Custom / Other' ? '' : rigDraft.make}
                        onChangeText={v => setRigDraft(d => ({ ...d, make: v }))} />
                      <Text style={s.rigFormLabel}>MODEL</Text>
                      <TextInput style={s.rigInput} placeholder="e.g. Tacoma TRD Pro, 80 Series…" placeholderTextColor={C.text3}
                        value={rigDraft.model} onChangeText={v => setRigDraft(d => ({ ...d, model: v }))} />
                    </>
                  )}

                  {/* Year + Trim */}
                  <View style={s.rigRow}>
                    <View style={{ width: 90 }}>
                      <Text style={s.rigFormLabel}>YEAR</Text>
                      <TextInput style={s.rigInput} placeholder="2022" placeholderTextColor={C.text3}
                        value={rigDraft.year} onChangeText={v => setRigDraft(d => ({ ...d, year: v }))}
                        keyboardType="numeric" maxLength={4} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.rigFormLabel}>TRIM / PACKAGE</Text>
                      <TextInput style={s.rigInput} placeholder="TRD Pro, Rubicon, Raptor…" placeholderTextColor={C.text3}
                        value={rigDraft.trim ?? ''} onChangeText={v => setRigDraft(d => ({ ...d, trim: v }))} />
                    </View>
                  </View>
                </>
              )}

              {/* ── BUILD TAB ─────────────────────────────────────── */}
              {rigSection === 'build' && (
                <>
                  <Text style={s.rigFormLabel}>DRIVE</Text>
                  <View style={s.rigPillGrid}>
                    {DRIVE_TYPES.map(d => (
                      <TouchableOpacity key={d}
                        style={[s.rigPill, rigDraft.drive === d && s.rigPillActive]}
                        onPress={() => setRigDraft(dr => ({ ...dr, drive: d }))}>
                        <Text style={[s.rigPillText, rigDraft.drive === d && s.rigPillTextActive]}>{d}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={s.rigFormLabel}>SUSPENSION</Text>
                  <View style={s.rigPillGrid}>
                    {SUSP_TYPES.map(sus => (
                      <TouchableOpacity key={sus}
                        style={[s.rigPill, rigDraft.suspension === sus && s.rigPillActive]}
                        onPress={() => setRigDraft(d => ({ ...d, suspension: sus }))}>
                        <Text style={[s.rigPillText, rigDraft.suspension === sus && s.rigPillTextActive]}>{sus}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <View style={s.rigRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.rigFormLabel}>LIFT HEIGHT (IN)</Text>
                      <TextInput style={s.rigInput} placeholder='e.g. 2.5' placeholderTextColor={C.text3}
                        value={rigDraft.lift_in} onChangeText={v => setRigDraft(d => ({ ...d, lift_in: v }))}
                        keyboardType="decimal-pad" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.rigFormLabel}>GROUND CLEARANCE (IN)</Text>
                      <TextInput style={s.rigInput} placeholder='e.g. 9.4' placeholderTextColor={C.text3}
                        value={rigDraft.ground_clearance_in} onChangeText={v => setRigDraft(d => ({ ...d, ground_clearance_in: v }))}
                        keyboardType="decimal-pad" />
                    </View>
                  </View>

                  <Text style={s.rigFormLabel}>TIRE SIZE</Text>
                  <TextInput style={s.rigInput} placeholder="e.g. 285/75R17 or 35x12.5R17" placeholderTextColor={C.text3}
                    value={rigDraft.tire_size ?? ''} onChangeText={v => setRigDraft(d => ({ ...d, tire_size: v }))} />

                  <Text style={s.rigFormLabel}>VEHICLE LENGTH (FT)</Text>
                  <TextInput style={s.rigInput} placeholder="e.g. 18.5" placeholderTextColor={C.text3}
                    value={rigDraft.length_ft} onChangeText={v => setRigDraft(d => ({ ...d, length_ft: v }))}
                    keyboardType="decimal-pad" />
                </>
              )}

              {/* ── ADVANCED TAB ──────────────────────────────────── */}
              {rigSection === 'advanced' && (
                <>
                  {/* Fuel range */}
                  <Text style={s.rigFormLabel}>FUEL RANGE (MILES)</Text>
                  <TextInput style={s.rigInput} placeholder="e.g. 400 — AI uses this for fuel stop planning"
                    placeholderTextColor={C.text3}
                    value={rigDraft.fuel_range_miles ?? ''}
                    onChangeText={v => setRigDraft(d => ({ ...d, fuel_range_miles: v }))}
                    keyboardType="numeric" />

                  <Text style={s.rigFormLabel}>REAL-WORLD MPG</Text>
                  <TextInput style={s.rigInput} placeholder="e.g. 14.5 — used for route fuel estimates"
                    placeholderTextColor={C.text3}
                    value={rigDraft.fuel_mpg ?? ''}
                    onChangeText={v => setRigDraft(d => ({ ...d, fuel_mpg: v }))}
                    keyboardType="decimal-pad" />

                  {/* Locking diffs */}
                  <Text style={s.rigFormLabel}>LOCKING DIFFERENTIALS</Text>
                  <View style={s.rigPillGrid}>
                    {DIFF_LOCK.map(d => (
                      <TouchableOpacity key={d}
                        style={[s.rigPill, rigDraft.locking_diffs === d && s.rigPillActive]}
                        onPress={() => setRigDraft(dr => ({ ...dr, locking_diffs: d }))}>
                        <Text style={[s.rigPillText, rigDraft.locking_diffs === d && s.rigPillTextActive]}>{d}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* Winch */}
                  <View style={s.rigToggleRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.rigToggleLabel}>WINCH</Text>
                      <Text style={s.rigToggleSub}>Self-recovery rated</Text>
                    </View>
                    <TouchableOpacity
                      style={[s.rigToggleBtn, rigDraft.has_winch && s.rigToggleBtnOn]}
                      onPress={() => setRigDraft(d => ({ ...d, has_winch: !d.has_winch }))}>
                      <Text style={[s.rigToggleBtnText, rigDraft.has_winch && s.rigToggleBtnTextOn]}>
                        {rigDraft.has_winch ? 'YES' : 'NO'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  {rigDraft.has_winch && (
                    <>
                      <Text style={s.rigFormLabel}>WINCH RATING (LBS)</Text>
                      <TextInput style={s.rigInput} placeholder="e.g. 10000" placeholderTextColor={C.text3}
                        value={rigDraft.winch_lbs ?? ''} onChangeText={v => setRigDraft(d => ({ ...d, winch_lbs: v }))}
                        keyboardType="numeric" />
                    </>
                  )}

                  {/* Skid plates */}
                  <View style={s.rigToggleRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.rigToggleLabel}>SKID PLATES</Text>
                      <Text style={s.rigToggleSub}>Transfer case, diff, fuel tank</Text>
                    </View>
                    <TouchableOpacity
                      style={[s.rigToggleBtn, rigDraft.has_skids && s.rigToggleBtnOn]}
                      onPress={() => setRigDraft(d => ({ ...d, has_skids: !d.has_skids }))}>
                      <Text style={[s.rigToggleBtnText, rigDraft.has_skids && s.rigToggleBtnTextOn]}>
                        {rigDraft.has_skids ? 'YES' : 'NO'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Roof rack */}
                  <View style={s.rigToggleRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.rigToggleLabel}>ROOF RACK</Text>
                      <Text style={s.rigToggleSub}>Overland-style cargo platform</Text>
                    </View>
                    <TouchableOpacity
                      style={[s.rigToggleBtn, rigDraft.has_rack && s.rigToggleBtnOn]}
                      onPress={() => setRigDraft(d => ({ ...d, has_rack: !d.has_rack }))}>
                      <Text style={[s.rigToggleBtnText, rigDraft.has_rack && s.rigToggleBtnTextOn]}>
                        {rigDraft.has_rack ? 'YES' : 'NO'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Towing */}
                  <View style={s.rigToggleRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.rigToggleLabel}>CURRENTLY TOWING</Text>
                      <Text style={s.rigToggleSub}>Trailer, toy hauler, camper</Text>
                    </View>
                    <TouchableOpacity
                      style={[s.rigToggleBtn, rigDraft.is_towing && s.rigToggleBtnOn]}
                      onPress={() => setRigDraft(d => ({ ...d, is_towing: !d.is_towing }))}>
                      <Text style={[s.rigToggleBtnText, rigDraft.is_towing && s.rigToggleBtnTextOn]}>
                        {rigDraft.is_towing ? 'YES' : 'NO'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  {rigDraft.is_towing && (
                    <View style={s.rigRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.rigFormLabel}>TRAILER LENGTH (FT)</Text>
                        <TextInput style={s.rigInput} placeholder="e.g. 20" placeholderTextColor={C.text3}
                          value={rigDraft.trailer_length_ft ?? ''} onChangeText={v => setRigDraft(d => ({ ...d, trailer_length_ft: v }))}
                          keyboardType="decimal-pad" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.rigFormLabel}>TOW CAPACITY (LBS)</Text>
                        <TextInput style={s.rigInput} placeholder="e.g. 7700" placeholderTextColor={C.text3}
                          value={rigDraft.tow_capacity_lbs ?? ''} onChangeText={v => setRigDraft(d => ({ ...d, tow_capacity_lbs: v }))}
                          keyboardType="numeric" />
                      </View>
                    </View>
                  )}
                </>
              )}

              <TouchableOpacity style={s.rigCancelBtn} onPress={() => setEditingRig(false)}>
                <Text style={s.rigCancelText}>CANCEL</Text>
              </TouchableOpacity>
            </View>

          ) : rigProfile && (rigProfile.make || rigProfile.model) ? (
            <View style={s.rigDisplay}>
              {/* Header */}
              <View style={s.rigDisplayTop}>
                <View style={{ flex: 1 }}>
                  <Text style={s.rigYear}>{rigProfile.year}{rigProfile.trim ? '  ·  ' + rigProfile.trim : ''}</Text>
                  <Text style={s.rigMakeModel}>{rigProfile.make} {rigProfile.model}</Text>
                </View>
                {rigProfile.vehicle_type ? (
                  <View style={s.rigTypeBadge}>
                    <Text style={s.rigTypeBadgeText}>{rigProfile.vehicle_type.toUpperCase()}</Text>
                  </View>
                ) : null}
              </View>

              {/* Spec grid */}
              <View style={s.rigSpecGrid}>
                {[
                  rigProfile.drive          && { label: 'DRIVE',     val: rigProfile.drive },
                  rigProfile.lift_in        && { label: 'LIFT',      val: rigProfile.lift_in + '"' },
                  rigProfile.suspension && rigProfile.suspension !== 'Stock'
                                            && { label: 'SUSPENSION',val: rigProfile.suspension },
                  rigProfile.ground_clearance_in && { label: 'CLEARANCE', val: rigProfile.ground_clearance_in + '"' },
                  rigProfile.tire_size      && { label: 'TIRES',     val: rigProfile.tire_size },
                  rigProfile.length_ft      && { label: 'LENGTH',    val: rigProfile.length_ft + "'" },
                ].filter(Boolean).map((item: any) => (
                  <View key={item.label} style={s.rigSpecCell}>
                    <Text style={s.rigSpecVal}>{item.val}</Text>
                    <Text style={s.rigSpecLabel}>{item.label}</Text>
                  </View>
                ))}
              </View>

              {/* Capability badges */}
              {(rigProfile.has_winch || rigProfile.has_skids || rigProfile.has_rack ||
                (rigProfile.locking_diffs && rigProfile.locking_diffs !== 'None') || rigProfile.is_towing) && (
                <View style={s.rigBadgeRow}>
                  {rigProfile.has_winch && (
                    <View style={s.rigCapBadge}>
                      <Ionicons name="link-outline" size={11} color={C.orange} />
                      <Text style={s.rigCapBadgeText}>WINCH{rigProfile.winch_lbs ? ' ' + Number(rigProfile.winch_lbs).toLocaleString() + 'lb' : ''}</Text>
                    </View>
                  )}
                  {rigProfile.locking_diffs && rigProfile.locking_diffs !== 'None' && (
                    <View style={s.rigCapBadge}>
                      <Ionicons name="settings-outline" size={11} color={C.orange} />
                      <Text style={s.rigCapBadgeText}>{rigProfile.locking_diffs.toUpperCase()}</Text>
                    </View>
                  )}
                  {rigProfile.has_skids && (
                    <View style={s.rigCapBadge}>
                      <Ionicons name="shield-outline" size={11} color={C.orange} />
                      <Text style={s.rigCapBadgeText}>SKIDS</Text>
                    </View>
                  )}
                  {rigProfile.has_rack && (
                    <View style={s.rigCapBadge}>
                      <Ionicons name="grid-outline" size={11} color={C.orange} />
                      <Text style={s.rigCapBadgeText}>RACK</Text>
                    </View>
                  )}
                  {rigProfile.is_towing && (
                    <View style={s.rigCapBadge}>
                      <Ionicons name="git-commit-outline" size={11} color={C.orange} />
                      <Text style={s.rigCapBadgeText}>TOWING{rigProfile.trailer_length_ft ? ' ' + rigProfile.trailer_length_ft + "'" : ''}</Text>
                    </View>
                  )}
                </View>
              )}
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
                  <View style={s.checkSectionTitleRow}>
                    <Ionicons name={section.icon} size={13} color={C.orange} />
                    <Text style={s.checkSectionTitle}>{section.title.toUpperCase()}</Text>
                  </View>
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

        {/* Plan + Credits */}
        <View style={s.creditsCard}>
          <View style={s.creditsTop}>
            <View>
              <Text style={s.creditsLabel}>TRAIL CREDITS</Text>
              <Text style={s.creditsBalance}>{user?.credits ?? 0}</Text>
            </View>
            <View style={[s.creditsBadge, hasPlan && s.creditsBadgeActive]}>
              <Ionicons name={hasPlan ? 'shield-checkmark' : 'flash'} size={22} color={C.orange} />
            </View>
          </View>

          {hasPlan ? (
            <>
              <View style={s.planActiveBanner}>
                <Ionicons name="checkmark-circle" size={16} color="#22c55e" />
                <Text style={s.planActiveText}>Explorer Plan active</Text>
              </View>
              <TouchableOpacity style={s.managePlanBtn} onPress={() => Linking.openURL('https://apps.apple.com/account/subscriptions')}>
                <Text style={s.managePlanBtnText}>Manage subscription</Text>
                <Ionicons name="open-outline" size={12} color={C.text3} />
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={s.divider} />
              <TouchableOpacity style={s.getPlanBtn} onPress={() => { openPaywall(); setShowPaywall(true); }} activeOpacity={0.85}>
                <View>
                  <Text style={s.getPlanBtnLabel}>Get Explorer Plan</Text>
                  <Text style={s.getPlanBtnSub}>
                    {annualProduct?.localizedPrice ?? '$49.99'}/yr · {monthlyProduct?.localizedPrice ?? '$7.99'}/mo{planTrial ? ` · ${planTrial}` : ''}
                  </Text>
                </View>
                <Ionicons name="arrow-forward" size={18} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity style={s.restoreRow} onPress={() => { openPaywall(); setTimeout(restore, 300); }} disabled={restoring}>
                {restoring
                  ? <ActivityIndicator size="small" color={C.text3} />
                  : <Text style={s.restoreRowText}>Restore purchases</Text>
                }
              </TouchableOpacity>
            </>
          )}

          <View style={s.divider} />
          <TouchableOpacity style={s.historyBtn} onPress={loadHistory}>
            <Ionicons name="time-outline" size={14} color={C.text3} />
            <Text style={s.historyBtnText}>CREDIT HISTORY</Text>
          </TouchableOpacity>
        </View>

        <PaywallModal
          visible={showPaywall}
          onClose={() => setShowPaywall(false)}
        />

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

        {/* Saved Camps */}
        {favoriteCamps.length > 0 && (
          <View style={s.historyCard}>
            <View style={s.sectionLabelRow}>
              <Ionicons name="heart" size={13} color="#ef4444" />
              <Text style={s.sectionLabel}>SAVED CAMPS</Text>
            </View>
            {favoriteCamps.map(camp => (
              <View key={camp.id} style={[s.txRow, { alignItems: 'flex-start', paddingVertical: 8 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.txReason, { fontWeight: '700', fontSize: 13 }]} numberOfLines={1}>{camp.name}</Text>
                  <Text style={{ color: C.text3, fontSize: 10, fontFamily: 'monospace', marginTop: 2 }}>
                    {camp.land_type || 'Camp'}{camp.cost ? ` · ${camp.cost}` : ''}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => toggleFavorite(camp)} style={{ padding: 4 }}>
                  <Ionicons name="heart" size={16} color="#ef4444" />
                </TouchableOpacity>
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
            <Text style={s.gpxTitle}>Import GPX</Text>
          </View>
          <Text style={s.gpxDesc}>
            Import GPX tracks as saved route previews and GPX waypoints as map pins. Normal accounts can add 15 waypoint pins per import. Imported points stay untrusted until review, verification, or trusted contributor approval.
          </Text>
          {!!gpxResult && (
            <Text style={[s.gpxResult, gpxResult.startsWith('Import failed') && { color: C.red }]}>
              {gpxResult}
            </Text>
          )}
          <TouchableOpacity style={[s.gpxBtn, gpxImporting && s.gpxBtnDisabled]}
            onPress={importGpx} disabled={gpxImporting}>
            <Ionicons name={gpxImporting ? 'hourglass-outline' : 'cloud-upload-outline'}
              size={16} color="#fff" />
            <Text style={s.gpxBtnText}>{gpxImporting ? 'IMPORTING...' : 'SELECT GPX FILE'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.contributorApplyBtn} onPress={() => setShowContributorApply(true)}>
            <Ionicons name="shield-checkmark-outline" size={16} color={C.green} />
            <Text style={s.contributorApplyText}>APPLY AS MAP CONTRIBUTOR</Text>
          </TouchableOpacity>
          {gpxBatches.length > 0 && (
            <View style={s.gpxBatchList}>
              <Text style={s.gpxBatchHeader}>RECENT GPX IMPORTS</Text>
              {gpxBatches.slice(0, 5).map(batch => {
                const hasRoute = !!(batch.routeTripId || batch.routeTripIds?.length);
                return (
                  <View key={batch.id} style={s.gpxBatchRow}>
                    <TouchableOpacity style={s.gpxBatchMain} onPress={() => openGpxBatch(batch)} disabled={!hasRoute}>
                      <View style={[s.gpxBatchIcon, { borderColor: hasRoute ? C.orange + '55' : C.border }]}>
                        <Ionicons name={hasRoute ? 'map-outline' : 'location-outline'} size={15} color={hasRoute ? C.orange : C.text3} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.gpxBatchName} numberOfLines={1}>{batch.routeName || batch.fileName}</Text>
                        <Text style={s.gpxBatchMeta} numberOfLines={1}>
                          {batch.routeTripIds?.length || (batch.routeTripId ? 1 : 0)} routes · {batch.importedPins}/{batch.waypointCount} pins · {Math.round(batch.distanceMiles)} mi · review
                        </Text>
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.gpxBatchDelete} onPress={() => confirmDeleteGpxBatch(batch)}>
                      <Ionicons name="trash-outline" size={15} color={C.red} />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        <Modal visible={showContributorApply} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowContributorApply(false)}>
          <SafeAreaView style={[s.container, { padding: 0 }]}>
            <View style={s.bugModal}>
              <View style={s.bugModalHeader}>
                <Text style={s.bugModalTitle}>Map Contributor</Text>
                <TouchableOpacity onPress={() => setShowContributorApply(false)}>
                  <Ionicons name="close" size={22} color={C.text3} />
                </TouchableOpacity>
              </View>
              <Text style={s.contributorIntro}>
                Apply for higher reviewed import limits. Approved contributors can help upgrade imported points, but new GPX imports still start untrusted.
              </Text>
              <Text style={s.bugFieldLabel}>REGIONS YOU KNOW</Text>
              <TextInput
                style={s.bugTitleInput}
                placeholder="Colorado Front Range, Moab, Ozarks..."
                placeholderTextColor={C.text3}
                value={contributorRegions}
                onChangeText={setContributorRegions}
                maxLength={180}
              />
              <Text style={s.bugFieldLabel}>MAPPING EXPERIENCE</Text>
              <TextInput
                style={s.bugDescInput}
                placeholder="Trail scouting, land access checks, GPX cleanup, local club work, agency maps used..."
                placeholderTextColor={C.text3}
                value={contributorExperience}
                onChangeText={setContributorExperience}
                multiline
                maxLength={900}
                textAlignVertical="top"
              />
              <Text style={s.bugFieldLabel}>SAMPLE NOTE</Text>
              <TextInput
                style={[s.bugTitleInput, { minHeight: 70, textAlignVertical: 'top' }]}
                placeholder="Optional example of how you would verify a campsite, water source, or trailhead."
                placeholderTextColor={C.text3}
                value={contributorSample}
                onChangeText={setContributorSample}
                multiline
                maxLength={500}
              />
              {!!contributorApplyResult && (
                <Text style={[s.gpxResult, contributorApplyResult.startsWith('Application received') ? { color: C.green } : { color: C.red }]}>
                  {contributorApplyResult}
                </Text>
              )}
              <TouchableOpacity style={[s.bugSubmitBtn, contributorApplying && { opacity: 0.6 }]} onPress={applyMapContributor} disabled={contributorApplying}>
                {contributorApplying ? <ActivityIndicator color="#fff" /> : <Text style={s.bugSubmitText}>SUBMIT APPLICATION</Text>}
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </Modal>

        {/* Bug Report */}
        <TouchableOpacity style={s.bugCard} onPress={() => setShowBugModal(true)}>
          <View style={s.bugCardLeft}>
            <Ionicons name="bug-outline" size={20} color={C.red} />
            <View style={{ flex: 1 }}>
              <Text style={s.bugCardTitle}>Found a bug?</Text>
              <Text style={s.bugCardSub}>Report it and earn credits if it's legit</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={16} color={C.text3} />
        </TouchableOpacity>

        {/* Bug report modal */}
        <Modal visible={showBugModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowBugModal(false)}>
          <SafeAreaView style={[s.container, { padding: 0 }]}>
            <View style={s.bugModal}>
              <View style={s.bugModalHeader}>
                <Text style={s.bugModalTitle}>Report a Bug</Text>
                <TouchableOpacity onPress={() => setShowBugModal(false)}>
                  <Ionicons name="close" size={22} color={C.text3} />
                </TouchableOpacity>
              </View>

              {bugSent ? (
                <View style={s.bugSentWrap}>
                  <Ionicons name="checkmark-circle" size={52} color={C.green} />
                  <Text style={s.bugSentTitle}>Report received!</Text>
                  <Text style={s.bugSentSub}>We'll review it. If it's a real bug you'll earn credits — thanks for helping make Trailhead better.</Text>
                </View>
              ) : (
                <>
                  <View style={s.bugCreditBanner}>
                    <Ionicons name="flash" size={14} color={C.orange} />
                    <Text style={s.bugCreditText}>Verified bugs earn generous credits. You must be logged in to receive them.</Text>
                  </View>
                  <Text style={s.bugFieldLabel}>WHAT WENT WRONG</Text>
                  <TextInput
                    style={s.bugTitleInput}
                    placeholder="Short summary (e.g. Map crashes when tapping Day 2 route)"
                    placeholderTextColor={C.text3}
                    value={bugTitle}
                    onChangeText={setBugTitle}
                    maxLength={120}
                  />
                  <Text style={s.bugFieldLabel}>DETAILS</Text>
                  <TextInput
                    style={s.bugDescInput}
                    placeholder="Steps to reproduce, what you expected vs what happened, how often it occurs..."
                    placeholderTextColor={C.text3}
                    value={bugDesc}
                    onChangeText={setBugDesc}
                    multiline
                    maxLength={1000}
                    textAlignVertical="top"
                  />
                  <TouchableOpacity
                    style={[s.bugSubmitBtn, bugSubmitting && { opacity: 0.6 }]}
                    onPress={submitBug}
                    disabled={bugSubmitting}
                  >
                    {bugSubmitting
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <><Ionicons name="send-outline" size={15} color="#fff" /><Text style={s.bugSubmitText}>SUBMIT REPORT</Text></>
                    }
                  </TouchableOpacity>
                </>
              )}
            </View>
          </SafeAreaView>
        </Modal>

        <Modal visible={showContributions} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowContributions(false)}>
          <SafeAreaView style={s.contestModal}>
            <View style={s.contestModalHeader}>
              <TouchableOpacity style={s.contestClose} onPress={() => setShowContributions(false)}>
                <Ionicons name="close" size={20} color={C.text} />
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Text style={s.contestModalKicker}>PROFILE</Text>
                <Text style={s.contestModalTitle}>Contributions</Text>
              </View>
              <View style={s.betaBadge}><Text style={s.betaBadgeText}>LIVE</Text></View>
            </View>
            {contributionsLoading ? (
              <View style={s.contestLoading}>
                <ActivityIndicator color={C.orange} />
                <Text style={s.contestMuted}>Loading your contributor profile...</Text>
              </View>
            ) : (
              <ScrollView contentContainerStyle={s.contestScroll}>
                <View style={s.contributionHero}>
                  <View style={[s.contributionAvatar, { backgroundColor: contributions?.avatar_color ?? C.orange }]}>
                    <Text style={s.contributionAvatarText}>{contributions?.display_name?.[0]?.toUpperCase() ?? user?.username?.[0]?.toUpperCase() ?? '?'}</Text>
                  </View>
                  <Text style={s.contributionName}>{contributions?.display_name ?? user?.username}</Text>
                  <Text style={s.contributionTitle}>{contributions?.title ?? 'First Tracks'}</Text>
                  <View style={s.contestHeroStats}>
                    <View style={s.contestHeroStat}>
                      <Text style={s.contestHeroNumber}>{contributions?.points.month ?? 0}</Text>
                      <Text style={s.contestHeroLabel}>MONTH</Text>
                    </View>
                    <View style={s.contestHeroStat}>
                      <Text style={s.contestHeroNumber}>{contributions?.points.year ?? 0}</Text>
                      <Text style={s.contestHeroLabel}>YEAR</Text>
                    </View>
                    <View style={s.contestHeroStat}>
                      <Text style={s.contestHeroNumber}>{contributions?.rank.year ? `#${contributions.rank.year}` : '—'}</Text>
                      <Text style={s.contestHeroLabel}>YEAR RANK</Text>
                    </View>
                  </View>
                  <View style={s.contributionProgress}>
                    <View style={[s.contributionProgressFill, { width: `${Math.round(((contributions?.tier.progress ?? 0) * 100))}%` }]} />
                  </View>
                  <Text style={s.contestMuted}>
                    {contributions?.tier.next_label
                      ? `${contributions.tier.next_label} unlocks at ${contributions.tier.next_points?.toLocaleString()} points.`
                      : 'Top contributor tier unlocked.'}
                  </Text>
                </View>

                <View style={s.contributionPrivacyCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.contestEntryTitle}>Public contributor profile</Text>
                    <Text style={s.contestEntryText}>Shows badges, ranks, and stats. Exact places and account details stay hidden.</Text>
                  </View>
                  <Switch
                    value={!!contributions?.public_profile_visible}
                    onValueChange={toggleContributionVisibility}
                    disabled={!contributions || visibilitySaving}
                    trackColor={{ false: C.s3, true: C.orangeGlow }}
                    thumbColor={contributions?.public_profile_visible ? C.orange : C.text3}
                  />
                </View>

                <View style={s.contestBoardCard}>
                  <Text style={s.sectionLabel}>BADGE SHELF</Text>
                  <View style={s.contributionBadgeGrid}>
                    {(contributions?.badges ?? []).length ? contributions!.badges.map(badge => (
                      <View key={badge.id} style={s.contributionBadge}>
                        <Ionicons name="ribbon-outline" size={18} color="#f8d77a" />
                        <Text style={s.contributionBadgeTitle}>{badge.label}</Text>
                        <Text style={s.contributionBadgeDesc}>{badge.description}</Text>
                      </View>
                    )) : <Text style={s.contestMuted}>Earn badges by submitting useful reports, photos, confirmations, and trail notes.</Text>}
                  </View>
                </View>

                <View style={s.contestBoardCard}>
                  <Text style={s.sectionLabel}>FIELD IMPACT</Text>
                  {[
                    ['Camp reports', contributions?.stats.camp_reports ?? 0],
                    ['Trail reports', contributions?.stats.trail_reports ?? 0],
                    ['Photo-backed reports', contributions?.stats.photos ?? 0],
                    ['Confirmed reports', contributions?.stats.confirmations ?? 0],
                  ].map(([label, value]) => (
                    <View key={label} style={s.contestLeaderRow}>
                      <Text style={s.contributionMetricLabel}>{label}</Text>
                      <Text style={s.contestLeaderPoints}>{Number(value).toLocaleString()}</Text>
                    </View>
                  ))}
                </View>

                <View style={s.contestBoardCard}>
                  <Text style={s.sectionLabel}>RECENT POINT SOURCES</Text>
                  {(contributions?.recent_activity ?? []).length ? contributions!.recent_activity.map(item => (
                    <View key={item.label} style={s.contestLeaderRow}>
                      <Text style={s.contributionMetricLabel}>{item.label}</Text>
                      <Text style={s.contestLeaderPoints}>{item.points.toLocaleString()} pts</Text>
                    </View>
                  )) : <Text style={s.contestMuted}>No contribution points yet.</Text>}
                </View>
              </ScrollView>
            )}
          </SafeAreaView>
        </Modal>

        <Modal visible={showContest} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowContest(false)}>
          <SafeAreaView style={s.contestModal}>
            <View style={s.contestModalHeader}>
              <TouchableOpacity style={s.contestClose} onPress={() => setShowContest(false)}>
                <Ionicons name="close" size={20} color={C.text} />
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Text style={s.contestModalKicker}>TRAILHEAD</Text>
                <Text style={s.contestModalTitle}>Contributor Contest</Text>
              </View>
            </View>
            {contestLoading ? (
              <View style={s.contestLoading}>
                <ActivityIndicator color={C.orange} />
                <Text style={s.contestMuted}>Loading contest standings...</Text>
              </View>
            ) : (
              <ScrollView contentContainerStyle={s.contestScroll}>
                <View style={s.contestHero}>
                  <Text style={s.contestHeroTitle}>Build the map. Share what matters.</Text>
                  <Text style={s.contestHeroText}>Contest points come from useful contributions across Trailhead. Your spendable credits stay separate.</Text>
                  <View style={s.contestHeroStats}>
                    <View style={s.contestHeroStat}>
                      <Text style={s.contestHeroNumber}>{contest?.month_points ?? 0}</Text>
                      <Text style={s.contestHeroLabel}>THIS MONTH</Text>
                    </View>
                    <View style={s.contestHeroStat}>
                      <Text style={s.contestHeroNumber}>{contest?.year_points ?? 0}</Text>
                      <Text style={s.contestHeroLabel}>THIS YEAR</Text>
                    </View>
                    <View style={s.contestHeroStat}>
                      <Text style={s.contestHeroNumber}>{contest?.year_rank ? `#${contest.year_rank}` : '—'}</Text>
                      <Text style={s.contestHeroLabel}>YEAR RANK</Text>
                    </View>
                  </View>
                </View>

                <View style={s.contestPrizeGrid}>
                  {[
                    ['$1,000', 'New Year winner', 'Top total contest points for the calendar year.'],
                    ['$100', 'Monthly leader', 'Top contributor at the end of each calendar month.'],
                    ['$50', 'Monthly drawing', 'Subscribers enter automatically. Free entry is available here.'],
                  ].map(([amount, title, desc]) => (
                    <View key={title} style={s.contestPrizeCard}>
                      <Text style={s.contestPrizeCardAmount}>{amount}</Text>
                      <Text style={s.contestPrizeCardTitle}>{title}</Text>
                      <Text style={s.contestPrizeCardDesc}>{desc}</Text>
                    </View>
                  ))}
                </View>

                <View style={s.contestEntryCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.contestEntryTitle}>Monthly drawing</Text>
                    <Text style={s.contestEntryText}>
                      {contest?.drawing_entered
                        ? `Entered for ${contest.period_month}${contest.drawing_entry_type ? ` via ${contest.drawing_entry_type}` : ''}.`
                        : 'No purchase necessary. One free entry per eligible user each month.'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[s.contestEntryBtn, contest?.drawing_entered && s.contestEntryBtnDone]}
                    onPress={enterContestDrawing}
                    disabled={contestEntering || contest?.drawing_entered}
                  >
                    <Text style={s.contestEntryBtnText}>{contestEntering ? 'SAVING' : contest?.drawing_entered ? 'ENTERED' : 'ENTER FREE'}</Text>
                  </TouchableOpacity>
                </View>

                <View style={s.contestBoardCard}>
                  <Text style={s.sectionLabel}>MONTHLY LEADERS</Text>
                  {(contest?.month_leaders ?? []).slice(0, 8).map(row => (
                    <View key={`m-${row.user_id}`} style={s.contestLeaderRow}>
                      <Text style={s.contestRank}>#{row.rank}</Text>
                      <Text style={s.contestLeaderName}>{row.display_name}</Text>
                      <Text style={s.contestLeaderPoints}>{row.points.toLocaleString()}</Text>
                    </View>
                  ))}
                  {!contest?.month_leaders?.length && <Text style={s.contestMuted}>No contributions yet this month.</Text>}
                </View>

                <View style={s.contestBoardCard}>
                  <Text style={s.sectionLabel}>YEARLY LEADERS</Text>
                  {(contest?.year_leaders ?? []).slice(0, 8).map(row => (
                    <View key={`y-${row.user_id}`} style={s.contestLeaderRow}>
                      <Text style={s.contestRank}>#{row.rank}</Text>
                      <Text style={s.contestLeaderName}>{row.display_name}</Text>
                      <Text style={s.contestLeaderPoints}>{row.points.toLocaleString()}</Text>
                    </View>
                  ))}
                  {!contest?.year_leaders?.length && <Text style={s.contestMuted}>No yearly standings yet.</Text>}
                </View>

                <View style={s.contestRulesCard}>
                  <Text style={s.contestRulesTitle}>Official rules</Text>
                  {contest?.rules ? [
                    contest.rules.eligibility,
                    contest.rules.entries,
                    contest.rules.odds,
                    contest.rules.points,
                    contest.rules.sponsor,
                    contest.rules.contact,
                  ].map((line, idx) => <Text key={idx} style={s.contestRuleLine}>{line}</Text>) : (
                    <Text style={s.contestRuleLine}>Rules are loading.</Text>
                  )}
                </View>
              </ScrollView>
            )}
          </SafeAreaView>
        </Modal>

        {/* Contributions */}
        <TouchableOpacity style={s.contributionCard} onPress={openContributions} activeOpacity={0.9}>
          <View style={s.contributionGlow} />
          <View style={s.contestHeader}>
            <View style={s.contributionIcon}>
              <Ionicons name="ribbon-outline" size={20} color="#7dd3fc" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.contributionKicker}>CONTRIBUTIONS</Text>
              <Text style={s.contestTitle}>Badges, streaks, and public profile.</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.text3} />
          </View>
          <View style={s.contributionMiniRow}>
            <View style={s.contributionMini}>
              <Ionicons name="medal-outline" size={16} color="#d4af37" />
              <Text style={s.contributionMiniText}>tier badges</Text>
            </View>
            <View style={s.contributionMini}>
              <Ionicons name="flame-outline" size={16} color={C.orange} />
              <Text style={s.contributionMiniText}>streaks</Text>
            </View>
            <View style={s.contributionMini}>
              <Ionicons name="people-outline" size={16} color="#14b8a6" />
              <Text style={s.contributionMiniText}>leaderboards</Text>
            </View>
          </View>
        </TouchableOpacity>

        {/* Contest */}
        <TouchableOpacity style={s.contestCard} onPress={openContest} activeOpacity={0.9}>
          <View style={s.contestGlow} />
          <View style={s.contestHeader}>
            <View style={s.contestIcon}>
              <Ionicons name="trophy-outline" size={20} color="#f8d77a" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.contestKicker}>CONTRIBUTOR CONTEST</Text>
              <Text style={s.contestTitle}>Earn points. Win Trailhead prizes.</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.text3} />
          </View>
          <View style={s.contestPrizeRow}>
            <View style={s.contestPrize}>
              <Text style={s.contestPrizeAmount}>$100</Text>
              <Text style={s.contestPrizeLabel}>monthly top</Text>
            </View>
            <View style={s.contestPrize}>
              <Text style={s.contestPrizeAmount}>$1,000</Text>
              <Text style={s.contestPrizeLabel}>yearly top</Text>
            </View>
            <View style={s.contestPrize}>
              <Text style={s.contestPrizeAmount}>$50</Text>
              <Text style={s.contestPrizeLabel}>monthly drawing</Text>
            </View>
          </View>
          <Text style={s.contestFinePrint}>No purchase necessary. Apple is not a sponsor or involved.</Text>
        </TouchableOpacity>

        {/* Referral */}
        <View style={s.referralCard}>
          <View style={s.referralHeader}>
            <Ionicons name="people-outline" size={18} color={C.orange} />
            <Text style={s.referralTitle}>Refer Friends</Text>
          </View>
          <Text style={s.referralDesc}>
            Share your code — +{CREDIT_REWARDS.referral} credits when a friend signs up.
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
            [`+${CREDIT_REWARDS.signup}`, 'Signup welcome bonus (after email verification)'],
            [`+${CREDIT_REWARDS.communityReport}`,  'Submit a community report (max 8/day)'],
            [`+${CREDIT_REWARDS.reportPhotoBonus}`, 'Add a photo to a report'],
            [`+${CREDIT_REWARDS.confirmReport}`,  'Confirm another user report'],
            [`+${CREDIT_REWARDS.communityPin}`,  'Add a manual community pin'],
            [`+${CREDIT_REWARDS.gpxImport}`,  'Import GPX pins (unverified)'],
            [`+${CREDIT_REWARDS.referral}`, 'Refer a friend who signs up'],
            [`+${CREDIT_REWARDS.campEditSuggestion}`, 'Suggest a camp profile edit'],
            [`+${CREDIT_REWARDS.streak3}`, '3-day reporting streak bonus'],
            [`+${CREDIT_REWARDS.streak7}`, '7-day reporting streak bonus'],
            [`+${CREDIT_REWARDS.streak30}`, '30-day reporting streak bonus'],
          ].map(([amount, action]) => (
            <View key={action} style={s.earnRow}>
              <Text style={s.earnAmount}>{amount}</Text>
              <Text style={s.earnAction}>{action}</Text>
            </View>
          ))}
        </View>

        {/* Delete account — required by App Store guideline 5.1.1(v) */}
        <TouchableOpacity
          style={s.deleteAccountBtn}
          onPress={() => {
            Alert.alert(
              'Delete Account',
              'This permanently deletes your account, all trips, reports, and credits. This cannot be undone.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete My Account',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await api.deleteAccount();
                      // Only clear local auth AFTER server confirms deletion
                      clearAuth();
                      setView('login');
                    } catch (e: any) {
                      Alert.alert(
                        'Deletion Failed',
                        'Could not delete your account. Please check your connection and try again.',
                        [{ text: 'OK' }]
                      );
                    }
                  },
                },
              ],
            );
          }}
        >
          <Ionicons name="trash-outline" size={14} color="#ef4444" />
          <Text style={s.deleteAccountText}>Delete Account</Text>
        </TouchableOpacity>

        {/* App version info */}
        <View style={s.versionCard}>
          <Text style={[s.versionLabel, { marginBottom: 8, letterSpacing: 0.5 }]}>TRAILHEAD</Text>
          <View style={s.versionRow}>
            <Text style={s.versionLabel}>BINARY</Text>
            <Text style={s.versionValue}>
              {Application.nativeApplicationVersion ?? Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? '—'}
              {' '}(build {Application.nativeBuildVersion ?? Constants.nativeBuildVersion ?? '?'})
            </Text>
          </View>
          <View style={s.versionRow}>
            <Text style={s.versionLabel}>OTA UPDATE</Text>
            <Text style={s.versionValue}>{Updates.updateId ? Updates.updateId.slice(0, 8) : 'base build'}</Text>
          </View>
          <View style={s.versionRow}>
            <Text style={s.versionLabel}>UPDATED</Text>
            <Text style={s.versionValue}>
              {Updates.createdAt ? Updates.createdAt.toLocaleDateString() : '—'}
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (C: ColorPalette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 14, gap: 14, paddingBottom: 104 },

  authSuccessWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 },
  authSuccessText: { color: C.green, fontSize: 17, fontWeight: '700', textAlign: 'center', lineHeight: 24 },
  authScroll: { flexGrow: 1, justifyContent: 'center', padding: 28, gap: 14 },
  authBrand: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8,
  },
  authIcon: { width: 52, height: 52, borderRadius: 14 },
  authWordmark: { color: C.text, fontSize: 18, fontWeight: '900', fontFamily: mono, letterSpacing: 1.5 },
  authTagline: { color: C.text3, fontSize: 9, fontFamily: mono, letterSpacing: 1.5, marginTop: 2 },
  authHeading: { color: C.text, fontSize: 28, fontWeight: '800', letterSpacing: 0 },
  authSub: { color: C.text3, fontSize: 13.5, lineHeight: 20, marginTop: -4 },
  verifyCard: {
    gap: 14, backgroundColor: C.s2, borderRadius: 22, borderWidth: 1, borderColor: C.border,
    padding: 18,
  },
  secondaryAuthBtn: { alignItems: 'center', paddingVertical: 8 },
  secondaryAuthText: { color: C.text3, fontSize: 13, fontWeight: '700' },
  forgotBtn: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 999, backgroundColor: C.orangeGlow, borderWidth: 1, borderColor: C.orange + '55' },
  forgotText: { color: C.orange, fontSize: 13, fontWeight: '800' },
  signupPerk: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.orangeGlow, borderRadius: 10, borderWidth: 1, borderColor: C.orange,
    paddingHorizontal: 12, paddingVertical: 10, marginTop: -4,
  },
  signupPerkText: { color: C.orange, fontSize: 12.5, flex: 1, lineHeight: 18 },
  authFields: { gap: 10 },
  input: {
    backgroundColor: C.s2, borderWidth: 1, borderColor: C.border,
    borderRadius: 16, padding: 14, color: C.text, fontSize: 14,
  },
  btn: {
    backgroundColor: C.orange, borderRadius: 16, padding: 16, alignItems: 'center',
    shadowColor: C.orange, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.16, shadowRadius: 18,
  },
  btnDisabled: { backgroundColor: C.s3, shadowOpacity: 0 },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 12, fontFamily: mono, letterSpacing: 1 },
  switchRow: { flexDirection: 'row', justifyContent: 'center', marginTop: -4 },
  switchText: { color: C.text3, fontSize: 13 },
  switchLink: { color: C.orange, fontSize: 13, fontWeight: '600' },

  profileCard: {
    backgroundColor: C.s2, borderRadius: 24, borderWidth: 1, borderColor: C.border,
    padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14,
    shadowColor: '#000', shadowOpacity: 0.32, shadowRadius: 24, shadowOffset: { width: 0, height: 12 },
  },
  avatar: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: C.s3, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#E5E7EB', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.18, shadowRadius: 16,
  },
  avatarText: { color: C.text, fontSize: 22, fontWeight: '800' },
  profileInfo: { flex: 1 },
  profileName: { color: C.text, fontSize: 16, fontWeight: '700' },
  profileEmail: { color: C.text3, fontSize: 12, marginTop: 1 },
  streakText: { color: C.orange, fontSize: 11, fontFamily: mono, marginTop: 4 },
  logoutBtn: { padding: 6 },
  deleteAccountBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12, borderRadius: 12,
    borderWidth: 1, borderColor: '#ef444433', backgroundColor: '#ef444411',
  },
  deleteAccountText: { color: '#ef4444', fontSize: 13, fontFamily: 'Courier', fontWeight: '600' },

  // Stats row
  statsRow: {
    backgroundColor: C.s2, borderRadius: 22, borderWidth: 1, borderColor: C.border,
    flexDirection: 'row', alignItems: 'stretch',
  },
  statCell: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  statDivider: { width: 1, backgroundColor: C.border, marginVertical: 10 },
  statBig: { color: C.text, fontSize: 26, fontWeight: '900', fontFamily: mono, lineHeight: 28 },
  statLabel: { color: C.text3, fontSize: 8, fontFamily: mono, letterSpacing: 0.8, marginTop: 3 },

  // Quick actions
  quickActionsRow: { marginHorizontal: -14 },
  quickActionsContent: { flexDirection: 'row', paddingHorizontal: 14, gap: 10 },
  quickAction: { alignItems: 'center', gap: 6, width: 70 },
  quickActionIcon: {
    width: 54, height: 54, borderRadius: 20,
    borderWidth: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.s2,
  },
  quickActionLabel: { color: C.text3, fontSize: 8.5, fontFamily: mono, letterSpacing: 0.5, textAlign: 'center' },

  contributionCard: {
    backgroundColor: C.s2, borderRadius: 24, borderWidth: 1, borderColor: '#14b8a655',
    padding: 16, overflow: 'hidden', gap: 14,
    shadowColor: '#14b8a6', shadowOpacity: 0.12, shadowRadius: 24, shadowOffset: { width: 0, height: 12 },
  },
  contributionGlow: { position: 'absolute', right: -44, top: -60, width: 162, height: 162, borderRadius: 81, backgroundColor: '#14b8a61f' },
  contributionIcon: { width: 42, height: 42, borderRadius: 16, backgroundColor: '#14b8a61f', borderWidth: 1, borderColor: '#14b8a666', alignItems: 'center', justifyContent: 'center' },
  contributionKicker: { color: '#14b8a6', fontSize: 9, fontFamily: mono, fontWeight: '900', letterSpacing: 1 },
  contributionMiniRow: { flexDirection: 'row', gap: 8 },
  contributionMini: { flex: 1, borderRadius: 16, backgroundColor: C.s3, borderWidth: 1, borderColor: C.border, padding: 10, minHeight: 62, alignItems: 'center', justifyContent: 'center', gap: 5 },
  contributionMiniText: { color: C.text3, fontSize: 9, fontFamily: mono, textAlign: 'center' },
  contributionHero: { backgroundColor: C.s2, borderRadius: 26, borderWidth: 1, borderColor: '#14b8a655', padding: 18, gap: 12, alignItems: 'center' },
  contributionAvatar: { width: 76, height: 76, borderRadius: 26, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#ffffff44' },
  contributionAvatarText: { color: '#fff', fontSize: 32, fontWeight: '900' },
  contributionName: { color: C.text, fontSize: 25, fontWeight: '900', letterSpacing: 0 },
  contributionTitle: { color: '#14b8a6', fontSize: 12, fontFamily: mono, fontWeight: '900' },
  contributionProgress: { width: '100%', height: 9, borderRadius: 999, backgroundColor: C.s3, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  contributionProgressFill: { height: '100%', borderRadius: 999, backgroundColor: '#14b8a6' },
  contributionPrivacyCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.s2, borderRadius: 20, borderWidth: 1, borderColor: C.border, padding: 14 },
  contributionBadgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  contributionBadge: { width: '48%', minHeight: 106, borderRadius: 16, backgroundColor: C.s3, borderWidth: 1, borderColor: '#d4af3738', padding: 10, gap: 5 },
  contributionBadgeTitle: { color: C.text, fontSize: 12, fontWeight: '900' },
  contributionBadgeDesc: { color: C.text3, fontSize: 10.5, lineHeight: 14 },
  contributionMetricLabel: { color: C.text2, flex: 1, fontSize: 13 },

  contestCard: {
    backgroundColor: C.s2, borderRadius: 24, borderWidth: 1, borderColor: '#d4af3744',
    padding: 16, overflow: 'hidden', gap: 14,
    shadowColor: '#d4af37', shadowOpacity: 0.13, shadowRadius: 24, shadowOffset: { width: 0, height: 12 },
  },
  contestGlow: { position: 'absolute', right: -42, top: -58, width: 160, height: 160, borderRadius: 80, backgroundColor: '#d4af3722' },
  contestHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  contestIcon: { width: 42, height: 42, borderRadius: 16, backgroundColor: '#d4af3720', borderWidth: 1, borderColor: '#d4af3755', alignItems: 'center', justifyContent: 'center' },
  contestKicker: { color: '#d4af37', fontSize: 9, fontFamily: mono, fontWeight: '900', letterSpacing: 1 },
  contestTitle: { color: C.text, fontSize: 18, fontWeight: '900', marginTop: 3, letterSpacing: 0 },
  contestPrizeRow: { flexDirection: 'row', gap: 8 },
  contestPrize: { flex: 1, borderRadius: 16, backgroundColor: C.s3, borderWidth: 1, borderColor: C.border, padding: 10, minHeight: 76, justifyContent: 'center' },
  contestPrizeAmount: { color: C.text, fontSize: 19, fontFamily: mono, fontWeight: '900' },
  contestPrizeLabel: { color: C.text3, fontSize: 10, lineHeight: 14, marginTop: 3 },
  contestFinePrint: { color: C.text3, fontSize: 10.5, lineHeight: 15 },
  contestModal: { flex: 1, backgroundColor: C.bg },
  contestModalHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.s2 },
  contestClose: { width: 38, height: 38, borderRadius: 14, backgroundColor: C.s3, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  contestModalKicker: { color: C.orange, fontSize: 9, fontFamily: mono, fontWeight: '900', letterSpacing: 1.2 },
  contestModalTitle: { color: C.text, fontSize: 22, fontWeight: '900', letterSpacing: 0 },
  betaBadge: { borderRadius: 999, borderWidth: 1, borderColor: '#d4af3766', backgroundColor: '#d4af371c', paddingHorizontal: 10, paddingVertical: 5 },
  betaBadgeText: { color: '#d4af37', fontSize: 9, fontFamily: mono, fontWeight: '900' },
  contestScroll: { padding: 16, gap: 14, paddingBottom: 40 },
  contestLoading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  contestHero: { backgroundColor: C.s2, borderRadius: 26, borderWidth: 1, borderColor: C.border, padding: 18, gap: 14 },
  contestHeroTitle: { color: C.text, fontSize: 27, lineHeight: 31, fontWeight: '900', letterSpacing: 0 },
  contestHeroText: { color: C.text2, fontSize: 14, lineHeight: 21 },
  contestHeroStats: { flexDirection: 'row', gap: 8 },
  contestHeroStat: { flex: 1, borderRadius: 16, backgroundColor: C.s3, borderWidth: 1, borderColor: C.border, padding: 10, alignItems: 'center' },
  contestHeroNumber: { color: C.text, fontSize: 20, fontFamily: mono, fontWeight: '900' },
  contestHeroLabel: { color: C.text3, fontSize: 8, fontFamily: mono, marginTop: 4, textAlign: 'center' },
  contestPrizeGrid: { gap: 10 },
  contestPrizeCard: { backgroundColor: C.s2, borderRadius: 20, borderWidth: 1, borderColor: C.border, padding: 15 },
  contestPrizeCardAmount: { color: '#d4af37', fontSize: 28, fontFamily: mono, fontWeight: '900' },
  contestPrizeCardTitle: { color: C.text, fontSize: 15, fontWeight: '900', marginTop: 3 },
  contestPrizeCardDesc: { color: C.text3, fontSize: 12.5, lineHeight: 18, marginTop: 5 },
  contestEntryCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.s2, borderRadius: 20, borderWidth: 1, borderColor: '#d4af3744', padding: 14 },
  contestEntryTitle: { color: C.text, fontSize: 15, fontWeight: '900' },
  contestEntryText: { color: C.text3, fontSize: 12, lineHeight: 17, marginTop: 3 },
  contestEntryBtn: { borderRadius: 14, backgroundColor: C.orange, paddingHorizontal: 14, paddingVertical: 11, minWidth: 98, alignItems: 'center' },
  contestEntryBtnDone: { backgroundColor: C.green },
  contestEntryBtnText: { color: '#fff', fontSize: 10, fontFamily: mono, fontWeight: '900' },
  contestBoardCard: { backgroundColor: C.s2, borderRadius: 20, borderWidth: 1, borderColor: C.border, padding: 14 },
  contestLeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  contestRank: { color: '#d4af37', width: 38, fontSize: 13, fontFamily: mono, fontWeight: '900' },
  contestLeaderName: { color: C.text, flex: 1, fontSize: 14, fontWeight: '700' },
  contestLeaderPoints: { color: C.text, fontSize: 14, fontFamily: mono, fontWeight: '900' },
  contestMuted: { color: C.text3, fontSize: 12, lineHeight: 18 },
  contestRulesCard: { backgroundColor: C.s2, borderRadius: 20, borderWidth: 1, borderColor: C.border, padding: 14, gap: 8 },
  contestRulesTitle: { color: C.text, fontSize: 16, fontWeight: '900' },
  contestRuleLine: { color: C.text3, fontSize: 12, lineHeight: 18 },

  // MY RIG
  rigCard: {
    backgroundColor: C.s2, borderRadius: 24, borderWidth: 1, borderColor: C.border, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 24, shadowOffset: { width: 0, height: 12 },
  },
  rigHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  rigIcon: { fontSize: 18 },
  rigTitle: { color: C.text, fontSize: 13, fontWeight: '800', fontFamily: mono, letterSpacing: 0.5, flex: 1 },
  rigEditBtn: {
    backgroundColor: C.s3, borderRadius: 12, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  rigEditText: { color: C.orange, fontSize: 10, fontFamily: mono, fontWeight: '700' },
  rigEmptyText: { color: C.text3, fontSize: 12.5, lineHeight: 18 },

  // Display card
  rigDisplay: { gap: 12 },
  rigDisplayTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rigYear: { color: C.text3, fontSize: 11, fontFamily: mono, letterSpacing: 0.5 },
  rigMakeModel: { color: C.text, fontSize: 19, fontWeight: '800', marginTop: 1, letterSpacing: 0 },
  rigTypeBadge: {
    backgroundColor: C.orangeGlow, borderRadius: 8, borderWidth: 1, borderColor: C.orange,
    paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start',
  },
  rigTypeBadgeText: { color: C.orange, fontSize: 10, fontFamily: mono, fontWeight: '700' },
  rigSpecGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 0,
    borderTopWidth: 1, borderColor: C.border, marginTop: 4,
  },
  rigSpecCell: {
    width: '33.33%', alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 1, borderColor: C.border,
  },
  rigSpecVal: { color: C.text, fontSize: 13, fontWeight: '800', fontFamily: mono },
  rigSpecLabel: { color: C.text3, fontSize: 8, fontFamily: mono, letterSpacing: 0.5, marginTop: 2 },
  rigBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  rigCapBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.orangeGlow, borderRadius: 6, borderWidth: 1, borderColor: C.orange + '55',
    paddingHorizontal: 8, paddingVertical: 4,
  },
  rigCapBadgeText: { color: C.orange, fontSize: 9, fontFamily: mono, fontWeight: '700', letterSpacing: 0.3 },

  // Edit form
  rigForm: { gap: 10 },
  rigTabRow: {
    flexDirection: 'row', borderRadius: 10, backgroundColor: C.s3,
    borderWidth: 1, borderColor: C.border, overflow: 'hidden', marginBottom: 4,
  },
  rigTab: { flex: 1, paddingVertical: 9, alignItems: 'center' },
  rigTabActive: { backgroundColor: C.orange },
  rigTabText: { color: C.text3, fontSize: 10, fontFamily: mono, fontWeight: '700', letterSpacing: 0.5 },
  rigTabTextActive: { color: '#fff' },
  rigFormLabel: { color: C.text3, fontSize: 9, fontFamily: mono, letterSpacing: 1, marginBottom: 4, marginTop: 6 },
  rigPillGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 2 },
  rigPill: {
    paddingHorizontal: 12, paddingVertical: 7,
    backgroundColor: C.s3, borderRadius: 20, borderWidth: 1, borderColor: C.border,
  },
  rigPillActive: { borderColor: C.orange, backgroundColor: C.orangeGlow },
  rigPillText: { color: C.text3, fontSize: 12, fontFamily: mono },
  rigPillTextActive: { color: C.orange, fontWeight: '700' },
  rigRow: { flexDirection: 'row', gap: 8 },
  rigInput: {
    backgroundColor: C.s3, borderWidth: 1, borderColor: C.border,
    borderRadius: 10, padding: 11, color: C.text, fontSize: 13,
  },
  rigToggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 12, borderTopWidth: 1, borderColor: C.border,
  },
  rigToggleLabel: { color: C.text, fontSize: 12, fontWeight: '700', fontFamily: mono },
  rigToggleSub: { color: C.text3, fontSize: 10, marginTop: 2 },
  rigToggleBtn: {
    paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20,
    borderWidth: 1.5, borderColor: C.border, backgroundColor: C.s3,
  },
  rigToggleBtnOn: { borderColor: C.orange, backgroundColor: C.orange },
  rigToggleBtnText: { color: C.text3, fontSize: 11, fontFamily: mono, fontWeight: '700' },
  rigToggleBtnTextOn: { color: '#fff' },
  rigCancelBtn: {
    borderWidth: 1, borderColor: C.border, borderRadius: 10,
    padding: 10, alignItems: 'center', marginTop: 6,
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
  checkSectionTitleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    marginBottom: 8, marginTop: 4,
    borderTopWidth: 1, borderColor: C.border, paddingTop: 10,
  },
  checkSectionTitle: {
    color: C.text3, fontSize: 9, fontFamily: mono, letterSpacing: 1,
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
  creditsBadgeActive: { backgroundColor: C.green + '20', borderColor: C.green },
  divider: { height: 1, backgroundColor: C.border, marginBottom: 12, marginTop: 4 },
  planActiveBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.green + '18', borderRadius: 10, borderWidth: 1, borderColor: C.green + '44',
    paddingHorizontal: 12, paddingVertical: 10, marginTop: 8,
  },
  planActiveText: { color: C.green, fontSize: 13, fontWeight: '700' },
  managePlanBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, marginTop: 4,
  },
  managePlanBtnText: { color: C.text3, fontSize: 12 },
  getPlanBtn: {
    backgroundColor: C.orange, borderRadius: 14, padding: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 8,
    shadowColor: C.orange, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 8,
  },
  getPlanBtnLabel: { color: '#fff', fontSize: 15, fontWeight: '700' },
  getPlanBtnSub: { color: 'rgba(255,255,255,0.75)', fontSize: 11, marginTop: 2 },
  restoreRow: { alignItems: 'center', paddingVertical: 8, marginBottom: 4 },
  restoreRowText: { color: C.text3, fontSize: 12 },
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
  sectionLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10 },
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
  gpxBatchList: {
    marginTop: 4,
    borderTopWidth: 1,
    borderColor: C.border,
    paddingTop: 10,
    gap: 8,
  },
  gpxBatchHeader: { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '900', letterSpacing: 1 },
  gpxBatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: C.border + '66',
  },
  gpxBatchMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 9 },
  gpxBatchIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.bg,
  },
  gpxBatchName: { color: C.text, fontSize: 12.5, fontWeight: '800' },
  gpxBatchMeta: { color: C.text3, fontSize: 10.5, marginTop: 2, fontFamily: mono },
  gpxBatchDelete: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.red + '33',
    alignItems: 'center',
    justifyContent: 'center',
  },
  contributorApplyBtn: {
    borderRadius: 10, padding: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1, borderColor: C.green + '55', backgroundColor: C.green + '12',
  },
  contributorApplyText: { color: C.green, fontSize: 11, fontFamily: mono, fontWeight: '800', letterSpacing: 0.5 },
  contributorIntro: { color: C.text2, fontSize: 13, lineHeight: 20, marginBottom: 18 },

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

  versionCard: {
    backgroundColor: C.s2, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12, gap: 6,
  },
  versionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  versionLabel: { color: C.text3, fontSize: 10, fontWeight: '700', fontFamily: mono, letterSpacing: 1 },
  versionValue: { color: C.text2, fontSize: 11, fontFamily: mono, flex: 1, textAlign: 'right' },

  bugCard: {
    backgroundColor: C.s2, borderRadius: 16, borderWidth: 1, borderColor: C.border,
    padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  bugCardLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  bugCardTitle: { color: C.text, fontSize: 14, fontWeight: '700' },
  bugCardSub: { color: C.text3, fontSize: 11, marginTop: 1 },
  bugModal: { flex: 1, padding: 20, gap: 12 },
  bugModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  bugModalTitle: { color: C.text, fontSize: 18, fontWeight: '800' },
  bugCreditBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.orangeGlow, borderRadius: 10, borderWidth: 1, borderColor: C.orange,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  bugCreditText: { color: C.orange, fontSize: 12.5, flex: 1, lineHeight: 18 },
  bugFieldLabel: { color: C.text3, fontSize: 9, fontFamily: mono, letterSpacing: 1, marginBottom: 4, marginTop: 4 },
  bugTitleInput: {
    backgroundColor: C.s2, borderWidth: 1.5, borderColor: C.border,
    borderRadius: 12, padding: 13, color: C.text, fontSize: 14,
  },
  bugDescInput: {
    backgroundColor: C.s2, borderWidth: 1.5, borderColor: C.border,
    borderRadius: 12, padding: 13, color: C.text, fontSize: 14,
    minHeight: 140,
  },
  bugSubmitBtn: {
    backgroundColor: C.orange, borderRadius: 12, padding: 15,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 4,
  },
  bugSubmitText: { color: '#fff', fontSize: 13, fontFamily: mono, fontWeight: '800', letterSpacing: 0.5 },
  bugSentWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 20 },
  bugSentTitle: { color: C.text, fontSize: 22, fontWeight: '800' },
  bugSentSub: { color: C.text3, fontSize: 14, textAlign: 'center', lineHeight: 22 },

  themeToggle: {
    backgroundColor: C.s1, borderRadius: 14, borderWidth: 1, borderColor: C.border,
    padding: 14, flexDirection: 'row', alignItems: 'center',
  },
  themeToggleLabel: { color: C.text, fontSize: 13, fontWeight: '700', fontFamily: mono },
  themeToggleSub: { color: C.text2, fontSize: 11, marginTop: 2 },

  // My Trips section
  tripsCard: {
    backgroundColor: C.s2, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 14,
  },
  tripRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 9,
    borderBottomWidth: 1, borderColor: C.border + '50',
  },
  tripRowOpen: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  tripDeleteBtn: {
    width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    marginLeft: 8, borderWidth: 1, borderColor: C.red + '35', backgroundColor: C.red + '10',
  },
  tripRowName: { color: C.text, fontSize: 13, fontWeight: '700' },
  tripRowMeta: { color: C.text3, fontSize: 10, fontFamily: mono, marginTop: 2 },
  offlineBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: C.green + '20', borderRadius: 5, borderWidth: 1, borderColor: C.green + '44',
    paddingHorizontal: 6, paddingVertical: 3,
  },
  offlineBadgeText: { color: C.green, fontSize: 8, fontFamily: mono, fontWeight: '700', letterSpacing: 0.5 },
});
