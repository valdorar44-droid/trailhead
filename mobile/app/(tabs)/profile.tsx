import { useState, useEffect, useMemo, useRef, useCallback, type ComponentProps } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  TextInput, Alert, Share, Linking, ActivityIndicator, Image, Modal, Animated, Keyboard, Switch, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons as ExpoIonicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { accountStorage, storage } from '@/lib/storage';
import * as Updates from 'expo-updates';
import Constants from 'expo-constants';
import * as Application from 'expo-application';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import {
  api,
  ApiError,
  ContestStatus,
  ContributorProfile,
  SupportThread,
  TripResult,
  type SupportAttachment,
  type SupportAttachmentContentType,
  type SupportDiagnosticAllowlist,
} from '@/lib/api';
import { cancelActiveTripMirror, useStore, RigProfile, SavedPlace, TripHistoryItem } from '@/lib/store';
import PaywallModal from '@/components/PaywallModal';
import TourTarget from '@/components/TourTarget';
import ProfileLibraryOverview from '@/components/profile/ProfileLibraryOverview';
import CommunicationPreferencesSection from '@/components/profile/CommunicationPreferencesSection';
import AccountDeletionSheet from '@/components/profile/AccountDeletionSheet';
import { TrailheadButton, TrailheadCard, TrailheadMetricRow, TrailheadTopBar } from '@/components/TrailheadUI';
import { useSubscription } from '@/lib/useSubscription';
import { subscriptionManagementUrl } from '@/lib/subscriptionManagement';
import { useTheme, mono, ColorPalette } from '@/lib/design';
import { deleteOfflineTrip, getOfflineTripIndex, getOfflineTripSummaries, loadOfflineTrip, saveOfflineTrip } from '@/lib/offlineTrips';
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
import { trackPhase0Event } from '@/lib/telemetry';
import { BookedTour, loadBookedTours } from '@/lib/bookedTours';
import { eraseTripRepositoryScope } from '@/lib/tripRepository';
import { clearExpoOfflineV2Scope } from '@/lib/offlineV2/expoRuntime';
import { AUDIO_LOCATION_TASK } from '@/lib/backgroundTasks';
import { clearOriginalsAccountScope, stopOriginalsForAccountDeparture } from '@/lib/originals/accountCleanup';
import { removeAccountPushToken, removeLocalPushRegistration } from '@/lib/deviceNotifications';
import { cancelTripRepositorySync } from '@/lib/tripRepositorySync';
import { accountDeletionAuthMethod } from '@/lib/accountDeletion';
import {
  canonicalReferralUrl,
  clearPendingReferralCode,
  getReferralAttributionEnabled,
  getPendingReferralCode,
  normalizeReferralCode,
  setReferralAttributionEnabled,
} from '@/lib/referrals/branchAttribution';
import {
  displayConsumptionToMpg,
  displayToMiles,
  milesToDisplay,
  mpgToDisplayConsumption,
  resolveUnitMode,
} from '@/lib/routeBuilder';
import { telemetryQaSurfaceIsAvailable } from '@/lib/telemetry/qa';
import {
  contestAwardPeriodLabel,
  contestAwardPresentation,
  PROFILE_SECTIONS,
  profileSectionScrollOffset,
  supportThreadIdForContestAward,
  type ProfileSectionId,
} from '@/lib/profilePresentation';
import { trailheadFonts } from '@/lib/typography';

type AppleAuthModule = typeof import('expo-apple-authentication');
WebBrowser.maybeCompleteAuthSession();

const AppleAuthentication: AppleAuthModule | null = (() => {
  try {
    return require('expo-apple-authentication') as AppleAuthModule;
  } catch {
    return null;
  }
})();

const Ionicons = Object.assign(
  (props: ComponentProps<typeof ExpoIonicons>) => (
    <ExpoIonicons {...props} accessible={false} importantForAccessibility="no" />
  ),
  { glyphMap: ExpoIonicons.glyphMap },
);

type ChecklistItem = { id: string; label: string; done: boolean };
type ChecklistSection = { title: string; icon: keyof typeof Ionicons.glyphMap; items: ChecklistItem[] };
type ExplorerPlanPoint = { icon: keyof typeof Ionicons.glyphMap; label: string };
type SupportDraftAttachment = SupportAttachment & { name: string };

const EXPLORER_PLAN_POINTS: ExplorerPlanPoint[] = [
  { icon: 'trail-sign-outline', label: 'Trip planning tools' },
  { icon: 'chatbubble-ellipses-outline', label: 'Co-Pilot voice assistant (Explorer)' },
  { icon: 'bonfire-outline', label: 'Camp Briefs' },
  { icon: 'shield-checkmark-outline', label: 'Trip and packing briefs' },
];

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
    { id: 'offline', label: 'Offline maps saved', done: false },
    { id: 'paper', label: 'Paper maps / topo backup', done: false },
  ]},
  { title: 'Provisions', icon: 'water-outline', items: [
    { id: 'water', label: 'Water supply planned for route and conditions', done: false },
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
  nickname: '', vehicle_type: '', year: '', make: '', model: '', trim: '',
  ground_clearance_in: '', lift_in: '', drive: '4x4 PT', length_ft: '',
  has_low_range: false, suspension: 'Stock', tire_size: '', tire_diameter_in: '', tire_type: '',
  full_size_spare: false, spare_count: '',
  width_in: '', height_ft: '', wheelbase_in: '',
  approach_angle_deg: '', departure_angle_deg: '', breakover_angle_deg: '',
  fuel_range_miles: '', fuel_mpg: '', tank_capacity_gal: '', water_capacity_gal: '', payload_lbs: '',
  has_winch: false, winch_lbs: '', locking_diffs: 'None',
  has_skids: false, has_rack: false, has_recovery_points: false,
  has_traction_boards: false, has_air_compressor: false, has_rock_sliders: false,
  max_trail_difficulty: '', max_water_depth_in: '', avoid_narrow_trails: false, avoid_body_damage: false,
  is_towing: false, trailer_length_ft: '', tow_capacity_lbs: '',
};

const AUTH_REQUEST_TIMEOUT_MS = 25_000;
const GOOGLE_AUTH_SCOPES = ['openid', 'profile', 'email'];

function expoExtraValue(key: string) {
  const extra = Constants.expoConfig?.extra as Record<string, unknown> | undefined;
  return typeof extra?.[key] === 'string' ? extra[key] : '';
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
    promise
      .then(value => resolve(value))
      .catch(reject)
      .finally(() => {
        if (timer) clearTimeout(timer);
      });
  });
}

function parseTourDate(value?: string) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function formatTourDate(value?: string, timezone?: string) {
  const date = parseTourDate(value);
  if (!date) return 'Date to be confirmed';
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone || undefined,
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function formatShortTourDate(value?: string) {
  const date = parseTourDate(value);
  if (!date) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  } catch {
    return '';
  }
}

function formatTourPrice(tour: BookedTour) {
  const price = String(tour.totalPrice || '').trim();
  if (!price) return '';
  if (/^[A-Z]{3}\s/i.test(price) || price.startsWith('$')) return `Total ${price}`;
  return `Total ${[tour.currency, price].filter(Boolean).join(' ')}`;
}

function icsDate(date: Date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function icsText(value?: string) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function supportAttachmentContentType(mimeType: string | null | undefined, name: string): SupportAttachmentContentType | null {
  const mime = String(mimeType || '').trim().toLowerCase();
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'image/jpeg';
  if (mime === 'image/png') return 'image/png';
  if (mime === 'image/heic') return 'image/heic';
  if (mime === 'image/heif') return 'image/heif';
  const extension = name.toLowerCase().split('.').pop();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'heic') return 'image/heic';
  if (extension === 'heif') return 'image/heif';
  return null;
}

export default function ProfileScreen() {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const router = useRouter();
  const params = useLocalSearchParams<{ support?: string; support_thread_id?: string; prizes?: string; auth?: string; referral_code?: string }>();
  const { user, rigProfile, setAuth, signOut, clearAuthAndLocalData, setRigProfile } = useStore();

  function accountRequestIsCurrent(epoch: number, accountId: string | number | null | undefined) {
    return accountStorage.epoch() === epoch
      && String(useStore.getState().user?.id ?? '') === String(accountId ?? '');
  }
  const tripHistory    = useStore(st => st.tripHistory);
  const removeTripFromHistory = useStore(st => st.removeTripFromHistory);
  const themeMode      = useStore(st => st.themeMode);
  const setThemeMode   = useStore(st => st.setThemeMode);
  const weatherUnitMode = useStore(st => st.weatherUnitMode);
  const setWeatherUnitMode = useStore(st => st.setWeatherUnitMode);
  const resolvedUnitMode = resolveUnitMode(weatherUnitMode);
  const favoriteCamps  = useStore(st => st.favoriteCamps);
  const toggleFavorite = useStore(st => st.toggleFavorite);
  const savedPlaces = useStore(st => st.savedPlaces);
  const removeSavedPlace = useStore(st => st.removeSavedPlace);
  const setPendingMapSelection = useStore(st => st.setPendingMapSelection);
  const setPendingSavedTrailId = useStore(st => st.setPendingSavedTrailId);
  const [profileSection, setProfileSection] = useState<ProfileSectionId>('account');
  const profileSectionNavRef = useRef<ScrollView>(null);
  const [view, setView] = useState<'main' | 'login' | 'register' | 'forgot'>('main');
  const [authSuccess, setAuthSuccess] = useState('');  // brief success message before switching to main
  const authFade = useRef(new Animated.Value(1)).current;
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [refCode, setRefCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingVerifyEmail, setPendingVerifyEmail] = useState('');
  const [appleAuthAvailable, setAppleAuthAvailable] = useState(false);
  const [resendingVerify, setResendingVerify] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [creditHistory, setCreditHistory] = useState<any[]>([]);
  const [creditHistoryLoaded, setCreditHistoryLoaded] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const hasPlan     = useStore(st => st.hasPlan);
  const setPlan     = useStore(st => st.setPlan);
  const { purchase, restore, openPaywall, monthlyProduct, annualProduct, purchasing, restoring } = useSubscription();
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
  const [showSupportInbox, setShowSupportInbox] = useState(false);
  const [supportThreads, setSupportThreads] = useState<SupportThread[]>([]);
  const [supportUnreadCount, setSupportUnreadCount] = useState(0);
  const [supportLoading, setSupportLoading] = useState(false);
  const [supportSelectedThreadId, setSupportSelectedThreadId] = useState<number | null>(null);
  const [supportDraft, setSupportDraft] = useState('');
  const [supportSending, setSupportSending] = useState(false);
  const [supportAttachments, setSupportAttachments] = useState<SupportDraftAttachment[]>([]);
  const [supportUploading, setSupportUploading] = useState(false);
  const [supportDiagnosticConsent, setSupportDiagnosticConsent] = useState(false);
  const [visibilitySaving, setVisibilitySaving] = useState(false);
  const [accountLifecycleBusy, setAccountLifecycleBusy] = useState(false);
  const [showAccountDeletion, setShowAccountDeletion] = useState(false);
  const [deletionAuthMethod, setDeletionAuthMethod] = useState(accountDeletionAuthMethod(user?.auth_method));
  const [referralAttributionEnabled, setReferralAttributionEnabledState] = useState(true);
  const [referralAttributionSaving, setReferralAttributionSaving] = useState(false);
  const accountLifecycleBusyRef = useRef(false);
  const deletedAccountPendingCleanupRef = useRef<number | null>(null);
  const [bookedTours, setBookedTours] = useState<BookedTour[]>([]);
  const [bookedToursLoaded, setBookedToursLoaded] = useState(false);
  const [adminClearingCampCache, setAdminClearingCampCache] = useState(false);

  const [editingRig, setEditingRig] = useState(false);
  const [rigDraft, setRigDraft] = useState<RigProfile>(rigProfile ?? DEFAULT_RIG);
  const [rigSection, setRigSection] = useState<'vehicle' | 'build' | 'advanced'>('vehicle');
  const [checklist, setChecklist] = useState<ChecklistSection[]>(DEFAULT_CHECKLIST);
  const [showChecklist, setShowChecklist] = useState(false);

  // Offline cache state
  const [offlineCachedIds, setOfflineCachedIds] = useState<Set<string>>(new Set());
  const setActiveTrip = useStore(st => st.setActiveTrip);
  const setPendingOpenOfflineModal = useStore(st => st.setPendingOpenOfflineModal);
  const addTripToHistory = useStore(st => st.addTripToHistory);
  const startWelcomePrompt = useStore(st => st.startWelcomePrompt);
  const startWelcomeSetup = useStore(st => st.startWelcomeSetup);
  const [offlineTripSummaries, setOfflineTripSummaries] = useState<Array<TripResult & { cached_at: number }>>([]);
  const googleClientIds = useMemo(() => ({
    iosClientId: expoExtraValue('googleIosClientId'),
    androidClientId: expoExtraValue('googleAndroidClientId'),
    webClientId: expoExtraValue('googleWebClientId'),
  }), []);
  const googleClientIdForPlatform = Platform.select({
    ios: googleClientIds.iosClientId,
    android: googleClientIds.androidClientId,
    default: googleClientIds.webClientId,
  }) || '';
  const googleAuthAvailable = Boolean(googleClientIdForPlatform);
  const googleAuthHandledRef = useRef('');
  const googleAuthConfig = useMemo(() => ({
    iosClientId: googleClientIds.iosClientId || undefined,
    androidClientId: googleClientIds.androidClientId || undefined,
    webClientId: googleClientIds.webClientId || undefined,
    clientId: googleClientIdForPlatform || googleClientIds.androidClientId || googleClientIds.iosClientId || undefined,
    scopes: GOOGLE_AUTH_SCOPES,
    selectAccount: true,
  }), [googleClientIds, googleClientIdForPlatform]);
  const [googleRequest, googleResponse, promptGoogleAsync] = Google.useAuthRequest({
    ...googleAuthConfig,
  });
  const [deletionGoogleRequest, , promptDeletionGoogleAsync] = Google.useAuthRequest({
    ...googleAuthConfig,
  });

  function openSavedCampOnMap(camp: typeof favoriteCamps[number]) {
    setPendingMapSelection({ kind: 'camp', camp });
    router.push('/(tabs)/map');
  }

  function openSavedPlaceOnMap(place: SavedPlace) {
    if (place.id.startsWith('captured:') || place.id.startsWith('trail:')) {
      setPendingSavedTrailId(place.id);
      router.push('/(tabs)/map');
      return;
    }
    setPendingMapSelection({ kind: 'place', place });
    router.push('/(tabs)/map');
  }

  async function stopAccountBackgroundLocation() {
    const errors: string[] = [];
    try { await stopOriginalsForAccountDeparture(); } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
    if (Platform.OS !== 'web') {
      try {
        const active = await Location.hasStartedLocationUpdatesAsync(AUDIO_LOCATION_TASK);
        if (active) await Location.stopLocationUpdatesAsync(AUDIO_LOCATION_TASK);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (errors.length > 0) throw new Error(errors.join('\n'));
  }

  function showCleanupIncomplete(accountId: number) {
    Alert.alert(
      'Signed Out',
      'Trailhead could not confirm that all saved account data was cleared from this device. Try clearing it again, or close and reopen Trailhead before anyone else uses this device.',
      [
        { text: 'Close', style: 'cancel' },
        { text: 'Try Again', onPress: () => { void retryAccountCleanup(accountId); } },
      ],
    );
  }

  async function retryAccountCleanup(accountId: number) {
    if (accountLifecycleBusyRef.current) return;
    accountLifecycleBusyRef.current = true;
    setAccountLifecycleBusy(true);
    try {
      await stopAccountBackgroundLocation();
      await cancelTripRepositorySync();
      await cancelActiveTripMirror();
      await clearExpoOfflineV2Scope(`account:${String(accountId)}`);
      await eraseTripRepositoryScope(accountId);
      await clearOriginalsAccountScope(accountId);
      await clearAuthAndLocalData();
      const pushCleanupDrained = accountStorage.beginCleanup();
      try {
        await pushCleanupDrained;
        await removeLocalPushRegistration();
      } finally {
        accountStorage.endCleanup();
      }
      deletedAccountPendingCleanupRef.current = null;
      Alert.alert('Device Data Cleared', 'Saved account data has been cleared from this device.');
    } catch {
      Alert.alert('Cleanup Not Finished', 'Close and reopen Trailhead before anyone else uses this device.');
    } finally {
      accountLifecycleBusyRef.current = false;
      setAccountLifecycleBusy(false);
    }
  }

  async function signOutFromDevice() {
    const accountId = user?.id;
    if (accountId == null || accountLifecycleBusyRef.current) return;
    const authToken = useStore.getState().token || undefined;
    const finishingDeletedAccount = deletedAccountPendingCleanupRef.current === accountId;
    accountLifecycleBusyRef.current = true;
    setAccountLifecycleBusy(true);
    let cleanupIncomplete = false;
    try { await stopAccountBackgroundLocation(); } catch { cleanupIncomplete = true; }
    try { await cancelTripRepositorySync(); } catch { cleanupIncomplete = true; }
    try { await cancelActiveTripMirror(); } catch { cleanupIncomplete = true; }
    try { await clearExpoOfflineV2Scope(`account:${String(accountId)}`); } catch { cleanupIncomplete = true; }
    try { await eraseTripRepositoryScope(accountId); } catch { cleanupIncomplete = true; }
    try { await clearOriginalsAccountScope(accountId); } catch { cleanupIncomplete = true; }
    try {
      // Clear the account identity only after its V2 transfer/removal barrier.
      await (finishingDeletedAccount ? clearAuthAndLocalData() : signOut());
      setView(finishingDeletedAccount ? 'login' : 'main');
      if (finishingDeletedAccount) deletedAccountPendingCleanupRef.current = null;
    } catch {
      cleanupIncomplete = true;
    }
    const pushCleanupDrained = accountStorage.beginCleanup();
    try {
      await pushCleanupDrained;
      if (!finishingDeletedAccount) {
        await removeAccountPushToken(authToken);
      }
    } catch {
      cleanupIncomplete = true;
    } finally {
      accountStorage.endCleanup();
    }
    accountLifecycleBusyRef.current = false;
    setAccountLifecycleBusy(false);
    if (cleanupIncomplete) showCleanupIncomplete(accountId);
  }

  async function deleteAccountAndClearDevice(authorizationToken: string) {
    const accountId = user?.id;
    if (accountId == null || accountLifecycleBusyRef.current) return;
    accountLifecycleBusyRef.current = true;
    setAccountLifecycleBusy(true);
    try {
      await stopAccountBackgroundLocation();
      if (deletedAccountPendingCleanupRef.current !== accountId) {
        await removeAccountPushToken();
        await api.deleteAccount(authorizationToken);
        deletedAccountPendingCleanupRef.current = accountId;
      }
      let cleanupIncomplete = false;
      try { await cancelTripRepositorySync(); } catch { cleanupIncomplete = true; }
      try { await cancelActiveTripMirror(); } catch { cleanupIncomplete = true; }
      try { await clearExpoOfflineV2Scope(`account:${String(accountId)}`); } catch { cleanupIncomplete = true; }
      try { await eraseTripRepositoryScope(accountId); } catch { cleanupIncomplete = true; }
      try { await clearOriginalsAccountScope(accountId); } catch { cleanupIncomplete = true; }
      try { await clearAuthAndLocalData(); } catch { cleanupIncomplete = true; }
      const cleanupDrained = accountStorage.beginCleanup();
      try { await cleanupDrained; } catch { cleanupIncomplete = true; } finally { accountStorage.endCleanup(); }
      setShowAccountDeletion(false);
      setView('login');
      if (cleanupIncomplete) showCleanupIncomplete(accountId);
      else deletedAccountPendingCleanupRef.current = null;
    } catch (error) {
      throw error;
    } finally {
      accountLifecycleBusyRef.current = false;
      setAccountLifecycleBusy(false);
    }
  }

  async function confirmAccountDeletion() {
    if (accountLifecycleBusyRef.current) return;
    let method = accountDeletionAuthMethod(user?.auth_method);
    if (!user?.auth_method) {
      try {
        const freshUser = await api.me();
        method = accountDeletionAuthMethod(freshUser.auth_method);
      } catch (error: any) {
        Alert.alert('Account unavailable', error?.message || 'Connect to the internet and try again.');
        return;
      }
    }
    setDeletionAuthMethod(method);
    setShowAccountDeletion(true);
  }

  async function authorizePasswordAccountDeletion(currentPassword: string) {
    const authorization = await api.authorizeAccountDeletion({ password: currentPassword });
    return authorization.authorization_token;
  }

  async function authorizeProviderAccountDeletion(provider: 'apple' | 'google') {
    let identityToken = '';
    if (provider === 'apple') {
      if (Platform.OS !== 'ios' || !AppleAuthentication || !appleAuthAvailable) {
        throw new Error('Apple sign-in is not available on this device.');
      }
      const credential = await AppleAuthentication.signInAsync({ requestedScopes: [] });
      identityToken = credential.identityToken || '';
    } else {
      if (!deletionGoogleRequest || !googleAuthAvailable) {
        throw new Error('Google sign-in is not available on this device.');
      }
      const result = await promptDeletionGoogleAsync();
      if (result.type !== 'success') {
        throw new Error(result.type === 'cancel' || result.type === 'dismiss'
          ? 'Google sign-in was cancelled.'
          : 'Could not confirm your Google account.');
      }
      identityToken = result.params?.id_token || result.authentication?.idToken || '';
    }
    if (!identityToken) throw new Error(`${provider === 'apple' ? 'Apple' : 'Google'} did not return a sign-in token.`);
    const authorization = await api.authorizeAccountDeletion({
      provider,
      identity_token: identityToken,
    });
    return authorization.authorization_token;
  }

  function clearCampCacheAdmin() {
    if (!user?.is_admin || adminClearingCampCache) return;
    Alert.alert('Clear camp cache?', 'This clears saved camp search details so popular areas reload fresh place details.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          setAdminClearingCampCache(true);
          try {
            await api.adminClearCampCache({ scope: 'all' });
            Alert.alert('Camp cache cleared', 'Camp profiles will reload fresh details as needed.');
          } catch (e: any) {
            Alert.alert('Could not clear cache', e?.message || 'Try again in a moment.');
          } finally {
            setAdminClearingCampCache(false);
          }
        },
      },
    ]);
  }

  // Smooth auth → main transition: dismiss keyboard, show success flash, fade out, switch view
  function transitionToMain(successMsg: string) {
    Keyboard.dismiss();
    setAuthSuccess(successMsg);
    setLoading(false);
    if (Platform.OS === 'web') {
      setView('main');
      authFade.setValue(1);
      setAuthSuccess('');
      return;
    }
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

  useEffect(() => {
    const timer = setTimeout(() => {
      profileSectionNavRef.current?.scrollTo({
        x: profileSectionScrollOffset(profileSection),
        animated: true,
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [profileSection]);

  useEffect(() => {
    const authTarget = Array.isArray(params.auth) ? params.auth[0] : params.auth;
    if (authTarget !== 'register' && authTarget !== 'login') return;
    setProfileSection('account');
    setView(user ? 'main' : authTarget);
  }, [params.auth, user?.id]);

  useEffect(() => {
    if (user) return;
    let alive = true;
    const directCode = normalizeReferralCode(Array.isArray(params.referral_code)
      ? params.referral_code[0]
      : params.referral_code);
    if (directCode) {
      setRefCode(directCode);
      return () => { alive = false; };
    }
    getPendingReferralCode().then(code => {
      if (alive && code) setRefCode(current => current || code);
    }).catch(() => {});
    return () => { alive = false; };
  }, [params.referral_code, user?.id]);

  useEffect(() => {
    let alive = true;
    getReferralAttributionEnabled()
      .then(enabled => { if (alive) setReferralAttributionEnabledState(enabled); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!user) return;
    loadSupportInbox(false).catch(() => {});
  }, [user?.id]);

  useEffect(() => {
    if (!googleResponse) return;
    if (googleResponse.type === 'success') {
      const identityToken = googleResponse.params?.id_token || googleResponse.authentication?.idToken || '';
      if (!identityToken) {
        setLoading(false);
        Alert.alert('Google Sign In failed', 'Google did not return an identity token.');
        return;
      }
      if (googleAuthHandledRef.current === identityToken) return;
      googleAuthHandledRef.current = identityToken;
      handleProviderLogin('google', identityToken);
      return;
    }
    if (googleResponse.type === 'error') {
      setLoading(false);
      Alert.alert('Google Sign In failed', googleResponse.error?.message || 'Could not sign in with Google.');
      return;
    }
    if (googleResponse.type === 'cancel' || googleResponse.type === 'dismiss') {
      setLoading(false);
    }
  }, [googleResponse]);

  useEffect(() => {
    let alive = true;
    if (!user) {
      setPlan(false, null);
      return () => { alive = false; };
    }
    api.subscriptionStatus()
      .then(sub => {
        if (!alive) return;
        setPlan(Boolean(sub.is_active), sub.is_active ? sub.plan_expires_at ?? null : null);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [setPlan, user?.id]);

  useEffect(() => {
    if (!user || params.support !== '1') return;
    setProfileSection('support');
    const threadIdRaw = Array.isArray(params.support_thread_id) ? params.support_thread_id[0] : params.support_thread_id;
    const threadId = threadIdRaw ? parseInt(String(threadIdRaw), 10) : NaN;
    openSupportInbox(Number.isFinite(threadId) ? threadId : null).catch(() => {});
  }, [params.support, params.support_thread_id, user?.id]);

  useEffect(() => {
    if (!user || params.prizes !== '1') return;
    setProfileSection('community');
    void openContest();
  }, [params.prizes, user?.id]);

  const selectedSupportThread = supportThreads.find(thread => thread.id === supportSelectedThreadId) ?? null;

  useEffect(() => {
    let alive = true;
    if (Platform.OS !== 'ios' || !AppleAuthentication) {
      setAppleAuthAvailable(false);
      return;
    }
    AppleAuthentication.isAvailableAsync()
      .then(available => { if (alive) setAppleAuthAvailable(available); })
      .catch(() => { if (alive) setAppleAuthAvailable(false); });
    return () => { alive = false; };
  }, []);

  // Sync draft when rigProfile loads from SecureStore
  useEffect(() => {
    if (rigProfile && !editingRig) setRigDraft(rigProfile);
  }, [rigProfile]);

  // Component-local account data must not survive a sign-out or account change.
  useEffect(() => {
    const accountId = user?.id;
    const storageEpoch = accountStorage.epoch();
    setChecklist(DEFAULT_CHECKLIST);
    setRigDraft(rigProfile ?? DEFAULT_RIG);
    setEditingRig(false);
    setCreditHistory([]);
    setCreditHistoryLoaded(false);
    setShowHistory(false);
    setSupportThreads([]);
    setSupportUnreadCount(0);
    setSupportSelectedThreadId(null);
    setSupportDraft('');
    setSupportLoading(false);
    setSupportSending(false);
    setShowSupportInbox(false);
    setBookedTours([]);
    setBookedToursLoaded(false);
    setGpxBatches([]);
    setGpxResult('');
    setGpxImporting(false);
    setOfflineCachedIds(new Set());
    setOfflineTripSummaries([]);
    setContributions(null);
    setContest(null);
    setShowContributions(false);
    setShowContest(false);
    setContributorExperience('');
    setContributorRegions('');
    setContributorSample('');
    setContributorApplyResult('');
    setShowContributorApply(false);
    setBugTitle('');
    setBugDesc('');
    setBugSent(false);
    setShowBugModal(false);
    setEmail('');
    setUsername('');
    setPassword('');
    setConfirmPassword('');
    setRefCode('');
    setPendingVerifyEmail('');
    setResetSent(false);
    if (accountId == null) return;
    accountStorage.get('trailhead_checklist').then(json => {
      if (
        accountStorage.epoch() === storageEpoch
        && String(useStore.getState().user?.id ?? '') === String(accountId)
        && json
      ) setChecklist(JSON.parse(json));
    }).catch(() => {});
  }, [user?.id]);

  const refreshOfflineTrips = useCallback(() => {
    if (accountStorage.isCleaning()) return;
    const storageEpoch = accountStorage.epoch();
    const accountId = useStore.getState().user?.id;
    const requestIsCurrent = () => !accountStorage.isCleaning()
      && accountStorage.epoch() === storageEpoch
      && String(useStore.getState().user?.id ?? '') === String(accountId ?? '');
    getOfflineTripIndex().then(ids => {
      if (requestIsCurrent()) setOfflineCachedIds(new Set(ids));
    }).catch(() => {});
    getOfflineTripSummaries().then(trips => {
      if (requestIsCurrent()) setOfflineTripSummaries(trips);
    }).catch(() => {});
  }, []);

  const refreshBookedTours = useCallback(() => {
    const accountId = useStore.getState().user?.id;
    const storageEpoch = accountStorage.epoch();
    loadBookedTours({ includeRemote: !!user })
      .then(tours => {
        if (
          accountStorage.epoch() !== storageEpoch
          || String(useStore.getState().user?.id ?? '') !== String(accountId ?? '')
        ) return;
        setBookedTours(tours);
        setBookedToursLoaded(true);
      })
      .catch(() => {
        if (
          accountStorage.epoch() !== storageEpoch
          || String(useStore.getState().user?.id ?? '') !== String(accountId ?? '')
        ) return;
        setBookedTours([]);
        setBookedToursLoaded(true);
      });
  }, [user?.id]);

  // Load offline trip index to show cache badges
  useEffect(() => {
    refreshOfflineTrips();
    refreshBookedTours();
    if (accountStorage.isCleaning()) return;
    const storageEpoch = accountStorage.epoch();
    const accountId = useStore.getState().user?.id;
    loadGpxImportBatches().then(batches => {
      if (
        !accountStorage.isCleaning()
        && accountStorage.epoch() === storageEpoch
        && String(useStore.getState().user?.id ?? '') === String(accountId ?? '')
      ) setGpxBatches(batches);
    }).catch(() => {});
  }, [refreshBookedTours, refreshOfflineTrips]);

  useFocusEffect(useCallback(() => {
    refreshOfflineTrips();
    refreshBookedTours();
  }, [refreshBookedTours, refreshOfflineTrips]));

  useEffect(() => accountStorage.subscribe((cleaning, storageEpoch) => {
    if (cleaning) {
      setChecklist(DEFAULT_CHECKLIST);
      setBookedTours([]);
      setBookedToursLoaded(false);
      setGpxBatches([]);
      setOfflineCachedIds(new Set());
      setOfflineTripSummaries([]);
      setSupportThreads([]);
      setSupportUnreadCount(0);
      setSupportSelectedThreadId(null);
      return;
    }
    const accountId = useStore.getState().user?.id;
    if (accountId == null) return;
    accountStorage.get('trailhead_checklist').then(json => {
      if (
        accountStorage.epoch() === storageEpoch
        && String(useStore.getState().user?.id ?? '') === String(accountId)
        && json
      ) setChecklist(JSON.parse(json));
    }).catch(() => {});
    refreshOfflineTrips();
    refreshBookedTours();
    loadGpxImportBatches().then(batches => {
      if (
        accountStorage.epoch() === storageEpoch
        && String(useStore.getState().user?.id ?? '') === String(accountId)
      ) setGpxBatches(batches);
    }).catch(() => {});
    loadSupportInbox(false).catch(() => {});
  }), [refreshBookedTours, refreshOfflineTrips]);

  const offlineTripCount = useMemo(
    () => tripHistory.filter(trip => offlineCachedIds.has(trip.trip_id)).length,
    [offlineCachedIds, tripHistory],
  );
  const importedRouteCount = useMemo(
    () => gpxBatches.filter(batch => !!(batch.routeTripId || batch.routeTripIds?.length)).length,
    [gpxBatches],
  );
  const importedPinCount = useMemo(
    () => gpxBatches.reduce((sum, batch) => sum + (batch.importedPins || 0), 0),
    [gpxBatches],
  );
  const offlineOnlyTrips = useMemo(
    () => offlineTripSummaries.filter(summary => !tripHistory.some(trip => trip.trip_id === summary.trip_id)),
    [offlineTripSummaries, tripHistory],
  );

  function openOfflineMapsManager() {
    setPendingOpenOfflineModal(true);
    router.push('/(tabs)/map');
  }

  function openBookedTourDetails(tour: BookedTour) {
    const url = tour.ticketUrl || tour.detailsUrl;
    if (url) {
      Linking.openURL(url).catch(() => Alert.alert('Tickets', 'Could not open this booking.'));
      return;
    }
    Alert.alert('Tickets', 'Tickets will appear here when checkout is complete.');
  }

  async function addBookedTourToCalendar(tour: BookedTour) {
    const storageEpoch = accountStorage.epoch();
    const start = parseTourDate(tour.startAt);
    if (!start) {
      Alert.alert('Calendar', 'Date is not ready for this booking.');
      return;
    }
    const end = parseTourDate(tour.endAt) ?? new Date(start.getTime() + 2 * 60 * 60 * 1000);
    const uid = `${tour.id}@gettrailhead.app`;
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Trailhead//Booked Tours//EN',
      'BEGIN:VEVENT',
      `UID:${icsText(uid)}`,
      `DTSTAMP:${icsDate(new Date())}`,
      `DTSTART:${icsDate(start)}`,
      `DTEND:${icsDate(end)}`,
      `SUMMARY:${icsText(tour.title)}`,
      tour.location ? `LOCATION:${icsText(tour.location)}` : '',
      tour.calendarNote || tour.confirmationCode ? `DESCRIPTION:${icsText([tour.calendarNote, tour.confirmationCode ? `Confirmation ${tour.confirmationCode}` : ''].filter(Boolean).join('\\n'))}` : '',
      'END:VEVENT',
      'END:VCALENDAR',
    ].filter(Boolean).join('\r\n');
    try {
      const baseDir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
      if (!baseDir) throw new Error('Missing calendar export directory');
      const safeId = tour.id.replace(/[^a-z0-9_-]/gi, '-').slice(0, 80) || 'tour';
      const uri = `${baseDir}trailhead-${safeId}.ics`;
      const stored = await accountStorage.run(async () => {
        await FileSystem.writeAsStringAsync(uri, ics);
        return true;
      }, storageEpoch);
      if (!stored) return;
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'text/calendar', dialogTitle: 'Add to calendar', UTI: 'com.apple.ical.ics' });
      } else {
        await Share.share({ message: `${tour.title}\n${formatTourDate(tour.startAt, tour.timezone)}` });
      }
    } catch {
      Alert.alert('Calendar', 'Could not prepare this event.');
    }
  }

  const upcomingBookedTour = useMemo(
    () => bookedTours.find(tour => tour.status !== 'cancelled') ?? bookedTours[0] ?? null,
    [bookedTours],
  );

  function renderBookedTourCard(tour: BookedTour) {
    const price = formatTourPrice(tour);
    const dateLabel = formatTourDate(tour.startAt, tour.timezone);
    const cancellationDate = formatShortTourDate(tour.cancellationUntil);
    const status = tour.status || 'confirmed';
    const cancelled = status === 'cancelled';
    const pending = status === 'pending';
    const cancellationTitle = cancelled
      ? 'Booking cancelled'
      : pending
        ? 'Booking pending'
        : 'Free cancellation available';
    const cancellationSub = cancelled
      ? ''
      : cancellationDate
        ? `Cancel before ${cancellationDate}`
        : tour.cancellationSummary || '';
    return (
      <View key={tour.id} style={s.bookedTourCard}>
        <View style={s.bookedTourHead}>
          {tour.imageUrl ? (
            <Image source={{ uri: tour.imageUrl }} style={s.bookedTourImage} resizeMode="cover" />
          ) : (
            <View style={s.bookedTourImageFallback}>
              <Ionicons name="ticket-outline" size={30} color={C.orange} />
            </View>
          )}
          <View style={s.bookedTourTitleWrap}>
            <Text style={s.bookedTourTitle} numberOfLines={2}>{tour.title}</Text>
            {!!price && <Text style={s.bookedTourPrice} numberOfLines={1}>{price}</Text>}
            {!!tour.location && <Text style={s.bookedTourLocation} numberOfLines={1}>{tour.location}</Text>}
          </View>
        </View>

        <View style={s.bookedInfoRow}>
          <Ionicons name="calendar-outline" size={20} color={C.text} />
          <Text style={s.bookedInfoText} numberOfLines={2}>{dateLabel}</Text>
        </View>
        <View style={s.bookedInfoRow}>
          <Ionicons name="ticket-outline" size={20} color={C.text} />
          <Text style={s.bookedInfoText} numberOfLines={2}>{tour.quantity || 1} x {tour.productTitle || tour.title}</Text>
        </View>
        <View style={s.bookedCancelRow}>
          <Ionicons
            name={cancelled ? 'close-outline' : pending ? 'time-outline' : 'checkmark-outline'}
            size={20}
            color={cancelled ? C.red : pending ? C.orange : C.green}
          />
          <View style={{ flex: 1 }}>
            <Text style={[s.bookedCancelTitle, { color: cancelled ? C.red : pending ? C.orange : C.green }]} numberOfLines={1}>
              {cancellationTitle}
            </Text>
            {!!cancellationSub && <Text style={s.bookedCancelSub} numberOfLines={2}>{cancellationSub}</Text>}
          </View>
        </View>

        <View style={s.bookedDivider} />
        <TouchableOpacity style={s.bookedDetailsButton} onPress={() => openBookedTourDetails(tour)} activeOpacity={0.84}>
          <Text style={s.bookedDetailsText}>View tickets and details</Text>
        </TouchableOpacity>
      </View>
    );
  }

  useFocusEffect(useCallback(() => {
    trackPhase0Event('phase0_profile_opened', {
      signed_in: !!user,
      has_plan: !!hasPlan,
      saved_trips: tripHistory.length,
      favorite_camps: favoriteCamps.length,
      saved_places: savedPlaces.length,
    });
  }, [favoriteCamps.length, hasPlan, savedPlaces.length, tripHistory.length, user]));

  async function openContest() {
    const requestEpoch = accountStorage.epoch();
    const requestAccountId = user?.id;
    setShowContest(true);
    setContestLoading(true);
    const [contestResult, contributionsResult] = await Promise.allSettled([
      api.getContestStatus(),
      contributions ? Promise.resolve(contributions) : api.getMyContributions(),
    ]);
    if (!accountRequestIsCurrent(requestEpoch, requestAccountId)) return;
    if (contestResult.status === 'fulfilled') setContest(contestResult.value);
    else Alert.alert(
      'Contest unavailable',
      (contestResult.reason as any)?.message ?? 'Could not load contest standings.',
    );
    if (contributionsResult.status === 'fulfilled') setContributions(contributionsResult.value);
    setContestLoading(false);
  }

  async function openPrizeMessage(awardId: number) {
    const requestEpoch = accountStorage.epoch();
    const requestAccountId = user?.id;
    setSupportLoading(true);
    try {
      const inbox = await api.getSupportInbox();
      if (!accountRequestIsCurrent(requestEpoch, requestAccountId)) return;
      setSupportThreads(inbox.threads || []);
      setSupportUnreadCount(inbox.unread_count || 0);
      const threadId = supportThreadIdForContestAward(inbox.threads || [], awardId);
      if (!threadId) {
        Alert.alert('Prize message pending', 'Trailhead will send a private message when payout coordination is ready.');
        return;
      }
      setShowContest(false);
      setProfileSection('support');
      await openSupportInbox(threadId);
    } catch (error: any) {
      if (accountRequestIsCurrent(requestEpoch, requestAccountId)) {
        Alert.alert('Inbox unavailable', error?.message ?? 'Could not open the prize message.');
      }
    } finally {
      if (accountRequestIsCurrent(requestEpoch, requestAccountId)) setSupportLoading(false);
    }
  }

  async function enterContestDrawing() {
    const requestEpoch = accountStorage.epoch();
    const requestAccountId = user?.id;
    setContestEntering(true);
    try {
      const res = await api.enterContestDrawing();
      if (!accountRequestIsCurrent(requestEpoch, requestAccountId)) return;
      setContest(prev => prev ? { ...prev, ...res.status } : prev);
      Alert.alert('Entry saved', 'You are entered in this month’s drawing. No purchase is required and a purchase does not improve your odds.');
    } catch (e: any) {
      Alert.alert('Entry failed', e?.message ?? 'Could not save your entry.');
    } finally {
      if (accountRequestIsCurrent(requestEpoch, requestAccountId)) setContestEntering(false);
    }
  }

  async function openContributions() {
    const requestEpoch = accountStorage.epoch();
    const requestAccountId = user?.id;
    setShowContributions(true);
    setContributionsLoading(true);
    try {
      const nextContributions = await api.getMyContributions();
      if (!accountRequestIsCurrent(requestEpoch, requestAccountId)) return;
      setContributions(nextContributions);
    } catch (e: any) {
      Alert.alert('Contributions unavailable', e?.message ?? 'Could not load your contribution profile.');
    } finally {
      if (accountRequestIsCurrent(requestEpoch, requestAccountId)) setContributionsLoading(false);
    }
  }

  async function toggleContributionVisibility() {
    if (!contributions) return;
    const requestEpoch = accountStorage.epoch();
    const requestAccountId = user?.id;
    setVisibilitySaving(true);
    try {
      const nextContributions = await api.setContributionVisibility(!contributions.public_profile_visible);
      if (!accountRequestIsCurrent(requestEpoch, requestAccountId)) return;
      setContributions(nextContributions);
    } catch (e: any) {
      Alert.alert('Privacy update failed', e?.message ?? 'Could not update profile visibility.');
    } finally {
      if (accountRequestIsCurrent(requestEpoch, requestAccountId)) setVisibilitySaving(false);
    }
  }

  async function loadSupportInbox(openModal = false, preferredThreadId?: number | null) {
    if (!user) return;
    const requestEpoch = accountStorage.epoch();
    const requestAccountId = user.id;
    if (openModal) setShowSupportInbox(true);
    setSupportLoading(true);
    try {
      const inbox = await api.getSupportInbox();
      if (!accountRequestIsCurrent(requestEpoch, requestAccountId)) return;
      setSupportThreads(inbox.threads || []);
      setSupportUnreadCount(inbox.unread_count || 0);
      const nextThreadId = preferredThreadId
        ?? supportSelectedThreadId
        ?? inbox.threads?.[0]?.id
        ?? null;
      if (nextThreadId) {
        const detail = await api.getSupportThread(nextThreadId);
        if (!accountRequestIsCurrent(requestEpoch, requestAccountId)) return;
        setSupportThreads(prev => prev.map(thread => thread.id === detail.id ? detail : thread));
        setSupportSelectedThreadId(detail.id);
      } else {
        setSupportSelectedThreadId(null);
      }
    } catch (e: any) {
      if (openModal) Alert.alert('Inbox unavailable', e?.message ?? 'Could not load messages right now.');
    } finally {
      if (accountRequestIsCurrent(requestEpoch, requestAccountId)) setSupportLoading(false);
    }
  }

  async function openSupportInbox(threadId?: number | null) {
    await loadSupportInbox(true, threadId ?? null);
  }

  async function openSupportThread(threadId: number) {
    const requestEpoch = accountStorage.epoch();
    const requestAccountId = user?.id;
    setSupportSelectedThreadId(threadId);
    setSupportLoading(true);
    try {
      const detail = await api.getSupportThread(threadId);
      if (!accountRequestIsCurrent(requestEpoch, requestAccountId)) return;
      setSupportThreads(prev => {
        const others = prev.filter(thread => thread.id !== detail.id);
        return [detail, ...others];
      });
      setSupportUnreadCount(prev => {
        const prior = supportThreads.find(thread => thread.id === threadId);
        return Math.max(0, prev - Number(prior?.unread_count || 0));
      });
    } catch (e: any) {
      Alert.alert('Thread unavailable', e?.message ?? 'Could not open that message thread.');
    } finally {
      if (accountRequestIsCurrent(requestEpoch, requestAccountId)) setSupportLoading(false);
    }
  }

  async function addSupportScreenshots() {
    if (supportUploading || supportAttachments.length >= 3) return;
    const selection = await DocumentPicker.getDocumentAsync({
      type: ['image/jpeg', 'image/png', 'image/heic', 'image/heif'],
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (selection.canceled) return;
    const remaining = Math.max(0, 3 - supportAttachments.length);
    const selected = selection.assets.slice(0, remaining);
    if (selection.assets.length > remaining) {
      Alert.alert('Three screenshots maximum', `You can add ${remaining || 'no'} more screenshot${remaining === 1 ? '' : 's'} to this message.`);
    }
    setSupportUploading(true);
    const uploaded: SupportDraftAttachment[] = [];
    try {
      for (const asset of selected) {
        if (Number(asset.size || 0) > 8 * 1024 * 1024) {
          Alert.alert('Screenshot too large', `${asset.name} is over 8 MB.`);
          continue;
        }
        const contentType = supportAttachmentContentType(asset.mimeType, asset.name);
        if (!contentType) {
          Alert.alert('Unsupported image', `${asset.name} must be JPEG, PNG, HEIC or HEIF.`);
          continue;
        }
        const dataBase64 = await FileSystem.readAsStringAsync(asset.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const attachment = await api.uploadSupportAttachment({
          content_type: contentType,
          data_base64: dataBase64,
        });
        uploaded.push({ ...attachment, name: asset.name });
      }
      if (uploaded.length) setSupportAttachments(current => [...current, ...uploaded].slice(0, 3));
    } catch (error: any) {
      Alert.alert('Screenshot not added', error?.message || 'Try again on a stable connection.');
    } finally {
      setSupportUploading(false);
    }
  }

  async function collectSupportDiagnostics(): Promise<SupportDiagnosticAllowlist> {
    const diagnostics: SupportDiagnosticAllowlist = {
      platform: Platform.OS,
      app_version: Application.nativeApplicationVersion || Constants.expoConfig?.version || undefined,
      runtime_version: String(Updates.runtimeVersion || Constants.expoConfig?.runtimeVersion || ''),
      device_class: Platform.OS === 'ios' && Platform.isPad ? 'tablet' : 'phone',
      error_codes: [],
    };
    const [locationPermission, notificationPermission, freeStorage] = await Promise.all([
      Location.getForegroundPermissionsAsync().catch(() => null),
      Notifications.getPermissionsAsync().catch(() => null),
      FileSystem.getFreeDiskStorageAsync().catch(() => null),
    ]);
    if (locationPermission?.status) diagnostics.location_permission = locationPermission.status;
    if (notificationPermission?.status) diagnostics.notification_permission = notificationPermission.status;
    if (typeof freeStorage === 'number') {
      diagnostics.storage_state = freeStorage < 500 * 1024 * 1024 ? 'low' : 'available';
    }
    return diagnostics;
  }

  async function sendSupportReply() {
    const text = supportDraft.trim();
    if (!text || supportSending) return;
    const requestEpoch = accountStorage.epoch();
    const requestAccountId = user?.id;
    setSupportSending(true);
    try {
      const selectedThread = supportThreads.find(thread => thread.id === supportSelectedThreadId) ?? null;
      const diagnostics = supportDiagnosticConsent ? await collectSupportDiagnostics() : undefined;
      const response = await api.sendSupportMessage({
        thread_id: selectedThread?.id,
        subject: selectedThread?.subject || 'Trailhead support',
        category: selectedThread?.category || 'support',
        body: text,
        attachment_refs: supportAttachments.map(attachment => attachment.attachment_ref),
        diagnostic_consent: supportDiagnosticConsent,
        diagnostics,
      });
      if (!accountRequestIsCurrent(requestEpoch, requestAccountId)) return;
      setSupportDraft('');
      setSupportAttachments([]);
      setSupportDiagnosticConsent(false);
      await loadSupportInbox(true, response.thread_id);
    } catch (e: any) {
      Alert.alert('Message failed', e?.message ?? 'Could not send your message.');
    } finally {
      if (accountRequestIsCurrent(requestEpoch, requestAccountId)) setSupportSending(false);
    }
  }

  async function login() {
    if (accountLifecycleBusyRef.current) return;
    if (!email || !password) { Alert.alert('Fill in all fields'); return; }
    setLoading(true);
    try {
      const cleanEmail = email.trim().toLowerCase();
      const res = await withTimeout(
        api.login(cleanEmail, password),
        AUTH_REQUEST_TIMEOUT_MS,
        'Sign in is taking too long. Check your connection and try again.',
      );
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

  async function handleProviderLogin(provider: 'apple' | 'google', identityToken: string, fullName = '', providerEmail = '') {
    if (accountLifecycleBusyRef.current) return;
    if (!identityToken) {
      Alert.alert('Sign in failed', `${provider === 'apple' ? 'Apple' : 'Google'} did not return a sign-in token.`);
      return;
    }
    Keyboard.dismiss();
    setLoading(true);
    try {
      const res = provider === 'apple'
        ? await api.oauthApple(identityToken, fullName, providerEmail, refCode.trim())
        : await api.oauthGoogle(identityToken, fullName, providerEmail, refCode.trim());
      await clearPendingReferralCode();
      setAuth(res.token, res.user);
      transitionToMain(`Welcome, ${res.user.username}!`);
    } catch (e: any) {
      setLoading(false);
      Alert.alert('Sign in failed', e?.message ?? `Could not sign in with ${provider}.`);
    }
  }

  async function signInWithApple() {
    if (Platform.OS !== 'ios' || !AppleAuthentication || !appleAuthAvailable) return;
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      const fullName = [credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(' ');
      await handleProviderLogin('apple', credential.identityToken ?? '', fullName, credential.email ?? '');
    } catch (e: any) {
      if (e?.code !== 'ERR_REQUEST_CANCELED') {
        Alert.alert('Apple Sign In failed', e?.message ?? 'Could not sign in with Apple.');
      }
    }
  }

  async function signInWithGoogle() {
    if (!googleAuthAvailable) {
      Alert.alert('Google Sign In unavailable', 'Google Sign In is not configured for this platform yet.');
      return;
    }
    if (!googleRequest) {
      Alert.alert('Google Sign In unavailable', 'Google Sign In is still loading. Try again in a moment.');
      return;
    }
    Keyboard.dismiss();
    setLoading(true);
    try {
      const result = await promptGoogleAsync();
      if (result.type === 'cancel' || result.type === 'dismiss' || result.type === 'locked') {
        setLoading(false);
      } else if (result.type === 'error') {
        setLoading(false);
        Alert.alert('Google Sign In failed', result.error?.message || 'Could not sign in with Google.');
      }
    } catch (e: any) {
      setLoading(false);
      Alert.alert('Google Sign In failed', e?.message ?? 'Could not open Google Sign In.');
    }
  }

  async function register() {
    if (accountLifecycleBusyRef.current) return;
    const cleanEmail = email.trim().toLowerCase();
    const cleanUsername = username.trim();
    if (!cleanEmail || !cleanUsername || !password || !confirmPassword) { Alert.alert('Fill in all fields'); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) { Alert.alert('Email needed', 'Enter a valid email address so you can recover your account later.'); return; }
    if (password.length < 8) { Alert.alert('Password too short', 'Use at least 8 characters.'); return; }
    if (password !== confirmPassword) { Alert.alert('Passwords do not match', 'Re-enter your password so both fields match.'); return; }
    setLoading(true);
    try {
      const res = await api.register(cleanEmail, cleanUsername, password, refCode.trim());
      await clearPendingReferralCode();
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
    if (creditHistoryLoaded) { setShowHistory(p => !p); return; }
    const requestEpoch = accountStorage.epoch();
    const requestAccountId = useStore.getState().user?.id;
    try {
      const res = await api.getCredits();
      if (
        accountStorage.epoch() !== requestEpoch
        || String(useStore.getState().user?.id ?? '') !== String(requestAccountId ?? '')
      ) return;
      setCreditHistory(Array.isArray(res.history) ? res.history : []);
      setCreditHistoryLoaded(true);
      setShowHistory(true);
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 401) {
        Alert.alert('Sign in again', 'Your session expired. Sign out, then sign back in to refresh credits and purchases.');
        return;
      }
      Alert.alert('Could not load credit history', e?.message ?? 'Check your connection and try again.');
    }
  }

  async function openTripFromProfile(t: TripHistoryItem) {
    const requestEpoch = accountStorage.epoch();
    const requestAccountId = useStore.getState().user?.id;
    try {
      const cached = await loadOfflineTrip(t.trip_id);
      if (
        accountStorage.epoch() !== requestEpoch
        || String(useStore.getState().user?.id ?? '') !== String(requestAccountId ?? '')
      ) return;
      if (cached) {
        setActiveTrip({ ...cached, updated_at: Date.now() }, true);
        trackPhase0Event('phase0_saved_trip_opened', {
          trip_id: t.trip_id,
          source: 'offline',
          has_active_user: !!user,
        });
        router.push('/(tabs)/map');
        return;
      }

      const trip = await api.getTrip(t.trip_id);
      if (
        accountStorage.epoch() !== requestEpoch
        || String(useStore.getState().user?.id ?? '') !== String(requestAccountId ?? '')
      ) return;
      setActiveTrip({ ...trip, updated_at: Date.now() });
      trackPhase0Event('phase0_saved_trip_opened', {
        trip_id: t.trip_id,
        source: 'server',
        has_active_user: !!user,
      });
      saveOfflineTrip(trip)
        .then(() => refreshOfflineTrips())
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
            refreshOfflineTrips();
          },
        },
      ],
    );
  }

  async function openGpxBatch(batch: GpxImportBatch) {
    const requestEpoch = accountStorage.epoch();
    const requestAccountId = useStore.getState().user?.id;
    const tripId = batch.routeTripId || batch.routeTripIds?.[0];
    if (!tripId) {
      setGpxResult('This GPX import only added waypoint pins. Enable GPX in map filters to view them.');
      return;
    }
    try {
      const trip = await loadOfflineTrip(tripId);
      if (
        accountStorage.epoch() !== requestEpoch
        || String(useStore.getState().user?.id ?? '') !== String(requestAccountId ?? '')
      ) return;
      if (!trip) {
        setGpxResult('That imported route is no longer saved offline on this device.');
        return;
      }
      setActiveTrip(trip, true);
      router.push('/(tabs)/map');
    } catch (e: any) {
      if (accountRequestIsCurrent(requestEpoch, requestAccountId)) {
        setGpxResult('Could not open this GPX route. Try re-importing the file.');
      }
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
            const requestEpoch = accountStorage.epoch();
            const requestAccountId = useStore.getState().user?.id;
            const requestIsCurrent = () => accountRequestIsCurrent(requestEpoch, requestAccountId);
            const tripIds = batch.routeTripIds ?? (batch.routeTripId ? [batch.routeTripId] : []);
            await Promise.all(tripIds.map(async id => {
              if (!requestIsCurrent()) return;
              removeTripFromHistory(id);
              await deleteOfflineTrip(id);
              if (!requestIsCurrent()) return;
              await deleteRouteGeometry(id);
            }));
            if (!requestIsCurrent()) return;
            const next = await removeGpxImportBatch(batch.id);
            if (!requestIsCurrent()) return;
            setGpxBatches(next);
            refreshOfflineTrips();
          },
        },
      ],
    );
  }

  async function submitBug() {
    if (!bugTitle.trim() || !bugDesc.trim()) { Alert.alert('Fill in both fields'); return; }
    const requestEpoch = accountStorage.epoch();
    const requestAccountId = user?.id;
    setBugSubmitting(true);
    try {
      await api.submitBugReport({ title: bugTitle.trim(), description: bugDesc.trim(), app_version: '1.0' });
      if (!accountRequestIsCurrent(requestEpoch, requestAccountId)) return;
      setBugSent(true);
      setBugTitle(''); setBugDesc('');
      setTimeout(() => {
        if (!accountRequestIsCurrent(requestEpoch, requestAccountId)) return;
        setShowBugModal(false);
        setBugSent(false);
      }, 2500);
    } catch (e: any) {
      if (accountRequestIsCurrent(requestEpoch, requestAccountId)) Alert.alert('Submission failed', e.message);
    } finally {
      if (accountRequestIsCurrent(requestEpoch, requestAccountId)) setBugSubmitting(false);
    }
  }

  function shareReferral() {
    if (!user) return;
    const shareUrl = canonicalReferralUrl(user.referral_code);
    Share.share({
      message: `Join me on Trailhead. Use code ${user.referral_code} when you create your account. You get the welcome credits, and I get ${CREDIT_REWARDS.referral} referral credits.\n${shareUrl}`,
      title: 'Join Trailhead',
    });
  }

  async function updateReferralAttribution(enabled: boolean) {
    if (referralAttributionSaving) return;
    setReferralAttributionSaving(true);
    try {
      await setReferralAttributionEnabled(enabled);
      setReferralAttributionEnabledState(enabled);
    } catch (error: any) {
      Alert.alert('Setting not saved', error?.message || 'Try again in a moment.');
    } finally {
      setReferralAttributionSaving(false);
    }
  }

  function toggleCheckItem(sectionIdx: number, itemId: string) {
    const storageEpoch = accountStorage.epoch();
    setChecklist(prev => {
      const next = prev.map((sec, si) => si !== sectionIdx ? sec : {
        ...sec,
        items: sec.items.map(item => item.id === itemId ? { ...item, done: !item.done } : item),
      });
      accountStorage.set('trailhead_checklist', JSON.stringify(next), storageEpoch).catch(() => {});
      return next;
    });
  }

  function resetChecklist() {
    const reset = checklist.map(sec => ({ ...sec, items: sec.items.map(i => ({ ...i, done: false })) }));
    setChecklist(reset);
    accountStorage.set('trailhead_checklist', JSON.stringify(reset)).catch(() => {});
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
    const requestEpoch = accountStorage.epoch();
    const requestAccountId = useStore.getState().user?.id;
    const requestIsCurrent = () => accountStorage.epoch() === requestEpoch
      && String(useStore.getState().user?.id ?? '') === String(requestAccountId ?? '');
    setGpxImporting(true);
    setGpxResult('');
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (result.canceled) return;
      const file = result.assets[0];
      const content = await FileSystem.readAsStringAsync(file.uri);
      if (!requestIsCurrent()) return;
      const parsed = parseGpx(content, file.name);
      if (parsed.waypoints.length === 0 && parsed.tracks.length === 0) {
        setGpxResult('This GPX file did not include waypoints or track points.');
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
        if (!requestIsCurrent()) return;
        importedPins = results.filter((res: any) => res?.status === 'ok' || res?.id).length;
        duplicatePins = results.filter((res: any) => res?.status === 'duplicate').length;
      }

      const savedTripIds: string[] = [];
      let primaryTripId = '';
      let primaryRoutePoints = 0;
      let totalDistance = 0;
      const tracks = [...parsed.tracks].sort((a, b) => b.distanceMiles - a.distanceMiles);
      for (const [idx, track] of tracks.entries()) {
        if (!requestIsCurrent()) return;
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
        if (!requestIsCurrent()) return;
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
      if (!requestIsCurrent()) return;
      if (savedTripIds.length > 0) {
        refreshOfflineTrips();
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
        if (!requestIsCurrent()) return;
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
        if (!requestIsCurrent()) return;
        setGpxBatches(batches);
        setGpxResult(`Imported ${importedPins} new GPX waypoint pin${importedPins === 1 ? '' : 's'}.${duplicatePins ? ` ${duplicatePins} duplicate waypoint${duplicatePins === 1 ? '' : 's'} grouped with existing pins.` : ''}${batch.skippedPins ? ` ${batch.skippedPins} waypoints held back by the current import limit.` : ''} Enable GPX in map filters to see them.`);
      }
    } catch (e: any) {
      if (requestIsCurrent()) setGpxResult(`Import failed: ${e.message}`);
    } finally {
      if (requestIsCurrent()) setGpxImporting(false);
    }
  }

  async function applyMapContributor() {
    const regions = contributorRegions.split(',').map(r => r.trim()).filter(Boolean);
    if (contributorExperience.trim().length < 20 || regions.length === 0) {
      Alert.alert('Add a little more detail', 'Tell us your mapping experience and at least one region you know well.');
      return;
    }
    const requestEpoch = accountStorage.epoch();
    const requestAccountId = user?.id;
    setContributorApplying(true);
    setContributorApplyResult('');
    try {
      await api.applyMapContributor({
        experience: contributorExperience.trim(),
        regions,
        sample_note: contributorSample.trim() || undefined,
      });
      if (!accountRequestIsCurrent(requestEpoch, requestAccountId)) return;
      setContributorApplyResult('Application received. We will review it before field-check access is enabled.');
    } catch (e: any) {
      if (accountRequestIsCurrent(requestEpoch, requestAccountId)) {
        setContributorApplyResult(e?.message ?? 'Application failed. Please try again.');
      }
    } finally {
      if (accountRequestIsCurrent(requestEpoch, requestAccountId)) setContributorApplying(false);
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
            <Text style={s.authTagline}>TRIP TOOLS</Text>
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

  if (!user && view === 'main') {
    const localRows: Array<{
      icon: keyof typeof Ionicons.glyphMap;
      title: string;
      detail?: string;
      onPress: () => void;
    }> = [
      {
        icon: 'bookmark-outline',
        title: 'Saved places',
        detail: `${savedPlaces.length} on this device`,
        onPress: () => router.push('/(tabs)/guide'),
      },
      {
        icon: 'git-branch-outline',
        title: 'Draft trips',
        detail: `${tripHistory.length} available locally`,
        onPress: () => router.push('/(tabs)/route-builder'),
      },
      {
        icon: 'download-outline',
        title: 'Offline',
        ...(offlineTripCount > 0
          ? { detail: `${offlineTripCount} trip ${offlineTripCount === 1 ? 'pack' : 'packs'}` }
          : {}),
        onPress: openOfflineMapsManager,
      },
    ];
    const preferenceRows: Array<{
      icon: keyof typeof Ionicons.glyphMap;
      title: string;
      detail: string;
      onPress: () => void;
    }> = [
      {
        icon: 'car-sport-outline',
        title: 'Vehicle and routing',
        detail: rigProfile ? [rigProfile.year, rigProfile.make, rigProfile.model].filter(Boolean).join(' ') || 'Vehicle saved' : 'Set up your rig',
        onPress: startWelcomeSetup,
      },
      {
        icon: themeMode === 'dark' ? 'sunny-outline' : 'moon-outline',
        title: 'Appearance',
        detail: themeMode === 'dark' ? 'Dark mode' : 'Light mode',
        onPress: () => setThemeMode(themeMode === 'dark' ? 'light' : 'dark'),
      },
      {
        icon: 'help-circle-outline',
        title: 'Help and support',
        detail: 'Contact Trailhead',
        onPress: () => contactSupport('Trailhead help'),
      },
      {
        icon: 'shield-checkmark-outline',
        title: 'Privacy',
        detail: 'Permissions and data policy',
        onPress: () => Linking.openURL('https://api.gettrailhead.app/privacy'),
      },
    ];

    const renderGuestRow = (row: typeof localRows[number], index: number, total: number) => (
      <TouchableOpacity
        key={row.title}
        style={[s.guestRow, index === total - 1 && s.guestRowLast]}
        onPress={row.onPress}
        accessibilityRole="button"
      >
        <View style={s.guestRowIcon}>
          <Ionicons name={row.icon} size={20} color={C.orange} />
        </View>
        <View style={s.guestRowCopy}>
          <Text style={s.guestRowTitle}>{row.title}</Text>
          {row.detail ? <Text style={s.guestRowDetail}>{row.detail}</Text> : null}
        </View>
        <Ionicons name="chevron-forward" size={18} color={C.text3} />
      </TouchableOpacity>
    );

    return (
      <SafeAreaView style={s.container}>
        <ScrollView contentContainerStyle={s.guestScroll}>
          <View style={s.guestHeader}>
            <View>
              <Text style={s.guestTitle}>Profile</Text>
              <Text style={s.guestSubtitle}>Your plans stay useful on this device.</Text>
            </View>
            <TouchableOpacity
              style={s.guestThemeButton}
              onPress={() => setThemeMode(themeMode === 'dark' ? 'light' : 'dark')}
              accessibilityLabel={themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              <Ionicons name={themeMode === 'dark' ? 'sunny-outline' : 'moon-outline'} size={20} color={C.text} />
            </TouchableOpacity>
          </View>

          <View style={s.guestAccountCard}>
            <Text style={s.guestAccountTitle}>Sign in to Trailhead</Text>
            <Text style={s.guestAccountBody}>Use your account and Explorer plan while keeping local trips and saved places on this device.</Text>
            <View style={s.guestAuthActions}>
              <TouchableOpacity style={s.guestPrimaryAction} onPress={() => setView('login')}>
                <Text style={s.guestPrimaryActionText}>Sign in</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.guestSecondaryAction} onPress={() => setView('register')}>
                <Text style={s.guestSecondaryActionText}>Create account</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={s.guestSection}>
            <Text style={s.guestSectionLabel}>ON THIS DEVICE</Text>
            <View style={s.guestList}>{localRows.map((row, index) => renderGuestRow(row, index, localRows.length))}</View>
          </View>

          <View style={s.guestSection}>
            <Text style={s.guestSectionLabel}>PREFERENCES AND SUPPORT</Text>
            <View style={s.guestList}>{preferenceRows.map((row, index) => renderGuestRow(row, index, preferenceRows.length))}</View>
          </View>
        </ScrollView>
      </SafeAreaView>
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
            <TouchableOpacity style={s.authBackButton} onPress={() => setView('main')} accessibilityRole="button">
              <Ionicons name="chevron-back" size={18} color={C.text} />
              <Text style={s.authBackText}>Profile</Text>
            </TouchableOpacity>
            <View style={s.authBrand}>
              <Image source={require('@/assets/icon.png')} style={s.authIcon} />
              <View>
                <Text style={s.authWordmark}>TRAILHEAD</Text>
                <Text style={s.authTagline}>TRIP TOOLS</Text>
              </View>
            </View>
            <Text style={s.authHeading}>Welcome back</Text>
            <Text style={s.authSub}>Sign in to save trips, saved areas, reports, and Explorer.</Text>
            <View style={s.socialAuthStack}>
              {appleAuthAvailable && AppleAuthentication ? (
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                  buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
                  cornerRadius={14}
                  style={s.appleAuthButton}
                  onPress={signInWithApple}
                />
              ) : null}
              {googleAuthAvailable && (
                <TouchableOpacity style={s.socialAuthButton} onPress={signInWithGoogle} disabled={loading || !googleRequest}>
                  <Ionicons name="logo-google" size={18} color={C.text} />
                  <Text style={s.socialAuthText}>Continue with Google</Text>
                </TouchableOpacity>
              )}
              <View style={s.authDivider}><View style={s.authDividerLine} /><Text style={s.authDividerText}>or</Text><View style={s.authDividerLine} /></View>
            </View>
            <View style={s.authFields}>
              <TextInput style={s.input} placeholder="Email" placeholderTextColor={C.text3}
                value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address"
                returnKeyType="next" blurOnSubmit />
              <TextInput style={s.input} placeholder="Password" placeholderTextColor={C.text3}
                value={password} onChangeText={setPassword} secureTextEntry returnKeyType="done"
                onSubmitEditing={login} />
            </View>
            <TouchableOpacity style={[s.btn, loading && s.btnDisabled]} onPress={login} disabled={loading}>
              <Text style={s.btnText}>{loading ? 'SIGNING IN...' : 'SIGN IN'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.forgotBtn} onPress={() => { setResetSent(false); setView('forgot'); }}>
              <Ionicons name="key-outline" size={14} color={C.orange} />
              <Text style={s.forgotText}>Forgot your password?</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.switchRow} onPress={() => setView('register')}>
              <Text style={s.switchText}>New here?</Text>
              <Text style={s.switchLink}> Create one →</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.secondaryAuthBtn} onPress={() => { openPaywall(); setShowPaywall(true); }}>
              <Text style={s.secondaryAuthText}>See Explorer plans</Text>
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
            <Text style={s.authTagline}>TRIP TOOLS</Text>
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
            <TouchableOpacity style={s.authBackButton} onPress={() => setView('main')} accessibilityRole="button">
              <Ionicons name="chevron-back" size={18} color={C.text} />
              <Text style={s.authBackText}>Profile</Text>
            </TouchableOpacity>
            <View style={s.authBrand}>
              <Image source={require('@/assets/icon.png')} style={s.authIcon} />
              <View>
                <Text style={s.authWordmark}>TRAILHEAD</Text>
                <Text style={s.authTagline}>TRIP TOOLS</Text>
              </View>
            </View>
            <Text style={s.authHeading}>Create account</Text>
            <View style={s.signupPerk}>
              <Ionicons name="flash" size={14} color={C.orange} />
              <Text style={s.signupPerkText}>Start with {CREDIT_REWARDS.signup} credits. Helpful reports can earn more.</Text>
            </View>
            <TextInput style={s.input} placeholder="Referral code (optional)" placeholderTextColor={C.text3}
              value={refCode} onChangeText={setRefCode} autoCapitalize="none" autoCorrect={false} returnKeyType="done" />
            <View style={s.socialAuthStack}>
              {appleAuthAvailable && AppleAuthentication ? (
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP}
                  buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
                  cornerRadius={14}
                  style={s.appleAuthButton}
                  onPress={signInWithApple}
                />
              ) : null}
              {googleAuthAvailable && (
                <TouchableOpacity style={s.socialAuthButton} onPress={signInWithGoogle} disabled={loading || !googleRequest}>
                  <Ionicons name="logo-google" size={18} color={C.text} />
                  <Text style={s.socialAuthText}>Continue with Google</Text>
                </TouchableOpacity>
              )}
              <View style={s.authDivider}><View style={s.authDividerLine} /><Text style={s.authDividerText}>or create with email</Text><View style={s.authDividerLine} /></View>
            </View>
            <View style={s.authFields}>
              <TextInput style={s.input} placeholder="Email" placeholderTextColor={C.text3}
                value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address"
                returnKeyType="next" blurOnSubmit />
              <TextInput style={s.input} placeholder="Username" placeholderTextColor={C.text3}
                value={username} onChangeText={setUsername} autoCapitalize="none" returnKeyType="next" blurOnSubmit />
              <TextInput style={s.input} placeholder="Password" placeholderTextColor={C.text3}
                value={password} onChangeText={setPassword} secureTextEntry returnKeyType="next" blurOnSubmit />
              <TextInput style={s.input} placeholder="Confirm password" placeholderTextColor={C.text3}
                value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry returnKeyType="next" blurOnSubmit />
            </View>
            <TouchableOpacity style={[s.btn, loading && s.btnDisabled]} onPress={register} disabled={loading}>
              <Text style={s.btnText}>{loading ? 'CREATING...' : 'CREATE ACCOUNT'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.switchRow} onPress={() => setView('login')}>
          <Text style={s.switchText}>Have an account?</Text>
          <Text style={s.switchLink}> Sign in →</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.secondaryAuthBtn} onPress={() => { openPaywall(); setShowPaywall(true); }}>
          <Text style={s.secondaryAuthText}>See Explorer plans</Text>
        </TouchableOpacity>
        <PaywallModal visible={showPaywall} onClose={() => setShowPaywall(false)} />
      </ScrollView>
        )}
      </Animated.View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={s.scroll} testID="profile.screen">

        {/* Profile */}
        <TourTarget id="profile.main">
          <TrailheadCard style={s.profileCard}>
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
            <TouchableOpacity
              onPress={() => { void signOutFromDevice(); }}
              style={[s.logoutBtn, accountLifecycleBusy && s.actionDisabled]}
              disabled={accountLifecycleBusy}
              accessibilityRole="button"
              accessibilityLabel="Sign out"
            >
              {accountLifecycleBusy
                ? <ActivityIndicator size="small" color={C.text3} />
                : <Ionicons name="log-out-outline" size={20} color={C.text3} />}
            </TouchableOpacity>
          </TrailheadCard>
        </TourTarget>

        <ScrollView
          ref={profileSectionNavRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.profileSectionNav}
          contentContainerStyle={s.profileSectionNavContent}
        >
          {PROFILE_SECTIONS.map(section => {
            const active = profileSection === section.id;
            return (
              <TouchableOpacity
                key={section.id}
                style={[s.profileSectionChip, active && s.profileSectionChipActive]}
                onPress={() => setProfileSection(section.id)}
                testID={`profile.section.${section.id}`}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
              >
                <Ionicons name={section.icon as keyof typeof Ionicons.glyphMap} size={15} color={active ? '#fff' : C.text3} />
                <Text style={[s.profileSectionChipText, active && s.profileSectionChipTextActive]}>{section.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {(() => {
          const actions = profileSection === 'account'
            ? [
                { id: 'plan', icon: 'compass', label: 'Plan trip', color: C.orange, onPress: () => router.push({ pathname: '/(tabs)/route-builder', params: { intent: 'new', request: String(Date.now()) } } as any) },
                { id: 'refer', icon: 'people', label: 'Refer', color: C.orange, onPress: shareReferral },
                { id: 'credits', icon: 'wallet-outline', label: 'Credits', color: C.orange, onPress: loadHistory },
              ]
            : profileSection === 'trips'
              ? [
                  { id: 'plan', icon: 'compass', label: 'Plan trip', color: C.orange, onPress: () => router.push({ pathname: '/(tabs)/route-builder', params: { intent: 'new', request: String(Date.now()) } } as any) },
                  { id: 'map', icon: 'map-outline', label: 'Open map', color: C.orange, onPress: () => router.push('/(tabs)/map') },
                  { id: 'offline', icon: 'cloud-download-outline', label: 'Offline', color: C.orange, onPress: openOfflineMapsManager },
                  { id: 'tours', icon: 'ticket-outline', label: 'Tours', color: C.orange, onPress: () => router.push('/(tabs)/guide?view=explore' as any) },
                  ...(upcomingBookedTour ? [{ id: 'calendar', icon: 'calendar-outline', label: 'Calendar', color: C.orange, onPress: () => addBookedTourToCalendar(upcomingBookedTour) }] : []),
                ]
            : profileSection === 'rig'
              ? [
                  {
                    id: 'rig',
                    icon: 'car-sport-outline',
                    label: editingRig ? 'Save rig' : rigProfile ? 'Edit rig' : 'Add rig',
                    color: C.orange,
                    onPress: () => {
                      if (editingRig) saveRig();
                      else {
                        setRigDraft(rigProfile ?? DEFAULT_RIG);
                        setRigSection('vehicle');
                        setEditingRig(true);
                      }
                    },
                  },
                  { id: 'trip-prep', icon: 'checkmark-circle', label: 'Trip prep', color: C.orange, onPress: () => setShowChecklist(true) },
                ]
              : profileSection === 'community'
                ? [
                    { id: 'contributions', icon: 'ribbon-outline', label: 'Contributions', color: C.orange, onPress: openContributions },
                    { id: 'prizes', icon: 'trophy-outline', label: 'Prizes', color: C.orange, onPress: openContest },
                    { id: 'reports', icon: 'alert-circle-outline', label: 'Reports', color: C.orange, onPress: () => router.push('/(tabs)/report') },
                  ]
                : profileSection === 'support'
                  ? [
                      { id: 'inbox', icon: 'mail-outline', label: 'Messages', color: C.orange, onPress: () => openSupportInbox() },
                      { id: 'new-message', icon: 'create-outline', label: 'New message', color: C.orange, onPress: () => { setSupportSelectedThreadId(null); setSupportDraft(''); void openSupportInbox(); } },
                      { id: 'report-problem', icon: 'alert-circle-outline', label: 'Report issue', color: C.red, onPress: () => setShowBugModal(true) },
                      { id: 'email', icon: 'at-outline', label: 'Email', color: C.orange, onPress: () => contactSupport('Trailhead question') },
                    ]
                  : [
                      { id: 'trip-setup', icon: 'options-outline', label: 'Trip setup', color: C.orange, onPress: startWelcomeSetup },
                      { id: 'walkthrough', icon: 'trail-sign-outline', label: 'Walkthrough', color: C.orange, onPress: startWelcomePrompt },
                      { id: 'trip-audio', icon: 'mic-outline', label: 'Trip audio', color: C.orange, onPress: () => router.push('/(tabs)/guide?view=narrations' as any) },
                      { id: 'weather', icon: 'partly-sunny-outline', label: 'Weather', color: C.orange, onPress: () => router.push('/(tabs)/guide?view=weather' as any) },
                      ...(user?.is_admin ? [{ id: 'camp-cache', icon: 'refresh-circle-outline', label: adminClearingCampCache ? 'Clearing' : 'Camp cache', color: C.orange, onPress: clearCampCacheAdmin }] : []),
                    ];
          return (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={s.quickActionsRow}
              contentContainerStyle={s.quickActionsContent}
            >
              {actions.map(({ id, icon, label, color, onPress }) => (
                <TouchableOpacity key={id} style={s.quickAction} onPress={onPress} testID={`profile.quick.${id}`}>
                  <View style={[s.quickActionIcon, { borderColor: color + '44', backgroundColor: color + '18' }]}>
                    <Ionicons name={icon as any} size={22} color={color} />
                  </View>
                  <Text style={s.quickActionLabel} numberOfLines={1}>{label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          );
        })()}

        {profileSection === 'trips' && (
          <>
          <ProfileLibraryOverview
            savedTripCount={tripHistory.length}
            offlineTripCount={offlineTripCount}
            offlineOnlyCount={offlineOnlyTrips.length}
            savedCampCount={favoriteCamps.length}
            savedPlaceCount={savedPlaces.length}
            importedRouteCount={importedRouteCount}
            importedPinCount={importedPinCount}
            onOpenDownloads={openOfflineMapsManager}
            onPlanTrip={() => router.push({ pathname: '/(tabs)/route-builder', params: { intent: 'new', request: String(Date.now()) } } as any)}
          />

          <View style={s.bookedScreen}>
            <View style={s.sectionHeaderCompact}>
              <Text style={s.sectionEyebrow}>TOURS</Text>
              <Text style={s.bookedScreenTitle}>Booked tours</Text>
            </View>

            {!bookedToursLoaded ? (
              <TrailheadCard style={s.bookedEmptyCard}>
                <ActivityIndicator color={C.orange} />
                <Text style={s.contestMuted}>Loading your tours...</Text>
              </TrailheadCard>
            ) : bookedTours.length > 0 ? (
              <>
                {bookedTours.map(renderBookedTourCard)}
                <View style={s.planAheadWrap}>
                  <Text style={s.planAheadTitle}>Next</Text>
                  <View style={s.planAheadCard}>
                    {!!upcomingBookedTour && (
                      <TouchableOpacity style={s.planAheadRow} onPress={() => addBookedTourToCalendar(upcomingBookedTour)} activeOpacity={0.84}>
                        <View style={s.planAheadIcon}>
                          <Ionicons name="calendar-outline" size={22} color={C.text} />
                        </View>
                        <Text style={s.planAheadText}>Add to calendar</Text>
                        <Ionicons name="chevron-forward" size={18} color={C.text3} />
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity style={s.planAheadRow} onPress={() => router.push('/(tabs)/guide?view=explore' as any)} activeOpacity={0.84}>
                      <View style={s.planAheadIcon}>
                        <Ionicons name="compass-outline" size={22} color={C.text} />
                      </View>
                      <Text style={s.planAheadText}>Find more things to do</Text>
                      <Ionicons name="chevron-forward" size={18} color={C.text3} />
                    </TouchableOpacity>
                  </View>
                </View>
              </>
            ) : (
              <View style={s.bookedEmptyCard}>
                <View style={s.bookedEmptyIcon}>
                  <Ionicons name="ticket-outline" size={30} color={C.orange} />
                </View>
                <Text style={s.bookedEmptyTitle}>No tours booked yet</Text>
                <Text style={s.bookedEmptyText}>Confirmed activities will show here.</Text>
                <View style={s.planAheadCard}>
                  <TouchableOpacity style={s.planAheadRow} onPress={() => router.push('/(tabs)/guide?view=explore' as any)} activeOpacity={0.84}>
                    <View style={s.planAheadIcon}>
                      <Ionicons name="compass-outline" size={22} color={C.text} />
                    </View>
                    <Text style={s.planAheadText}>Find things to do</Text>
                    <Ionicons name="chevron-forward" size={18} color={C.text3} />
                  </TouchableOpacity>
                  <TouchableOpacity style={s.planAheadRow} onPress={() => router.push('/(tabs)/route-builder' as any)} activeOpacity={0.84}>
                    <View style={s.planAheadIcon}>
                      <Ionicons name="map-outline" size={22} color={C.text} />
                    </View>
                    <Text style={s.planAheadText}>Open Route Builder</Text>
                    <Ionicons name="chevron-forward" size={18} color={C.text3} />
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
          </>
        )}

        {profileSection === 'support' && (
        <TouchableOpacity
          style={s.supportCard}
          onPress={() => openSupportInbox()}
          activeOpacity={0.9}
          testID="profile.support.inbox"
        >
          <View style={s.supportCardTop}>
            <View style={s.supportCardIcon}>
              <Ionicons name="notifications-outline" size={18} color={C.orange} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.supportCardKicker}>INBOX</Text>
              <Text style={s.supportCardTitle}>Messages</Text>
            </View>
            {supportUnreadCount > 0 ? (
              <View style={s.supportUnreadBadge}>
                <Text style={s.supportUnreadText}>{supportUnreadCount}</Text>
              </View>
            ) : null}
          </View>
          <Text style={s.supportCardBody}>
            {supportThreads[0]?.last_message_body
              ? supportThreads[0].last_message_body
              : 'No messages yet.'}
          </Text>
          <View style={s.supportMetaRow}>
            <Text style={s.supportMetaText}>
              {supportThreads.length
                ? `${supportThreads.length} thread${supportThreads.length === 1 ? '' : 's'}`
                : 'No messages'}
            </Text>
            <Text style={s.supportMetaAction}>OPEN</Text>
          </View>
        </TouchableOpacity>
        )}

        {/* My Rig */}
        {profileSection === 'rig' && (
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
                  <Text style={s.rigFormLabel}>FUEL RANGE ({resolvedUnitMode === 'metric' ? 'KM' : 'MILES'})</Text>
                  <TextInput style={s.rigInput} placeholder={resolvedUnitMode === 'metric' ? 'e.g. 640 — used for fuel stop planning' : 'e.g. 400 — used for fuel stop planning'}
                    placeholderTextColor={C.text3}
                    value={rigDraft.fuel_range_miles ? String(Math.round(milesToDisplay(Number(rigDraft.fuel_range_miles), weatherUnitMode))) : ''}
                    onChangeText={v => setRigDraft(d => ({ ...d, fuel_range_miles: displayToMiles(v, weatherUnitMode) }))}
                    keyboardType="numeric" />

                  <Text style={s.rigFormLabel}>{resolvedUnitMode === 'metric' ? 'REAL-WORLD L/100KM' : 'REAL-WORLD MPG'}</Text>
                  <TextInput style={s.rigInput} placeholder={resolvedUnitMode === 'metric' ? 'e.g. 16.2 — used for route fuel estimates' : 'e.g. 14.5 — used for route fuel estimates'}
                    placeholderTextColor={C.text3}
                    value={rigDraft.fuel_mpg ? mpgToDisplayConsumption(Number(rigDraft.fuel_mpg), weatherUnitMode) : ''}
                    onChangeText={v => setRigDraft(d => ({ ...d, fuel_mpg: displayConsumptionToMpg(v, weatherUnitMode) }))}
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
        )}

        {/* Trip Prep Checklist */}
        {profileSection === 'rig' && (
        <View style={s.checklistCard}>
          <TouchableOpacity style={s.checklistHeader} onPress={() => setShowChecklist(p => !p)}>
            <Ionicons name="checkmark-circle-outline" size={18} color={C.orange} />
            <Text style={s.checklistTitle}>TRIP PREP</Text>
            <View style={s.checklistProgress}>
              {(() => {
                const total = checklist.reduce((n, s) => n + s.items.length, 0);
                const done  = checklist.reduce((n, s) => n + s.items.filter(i => i.done).length, 0);
                return (
                  <>
                    <Text style={[s.checklistProgressText, done === total && total > 0 && { color: C.orange }]}>
                      {done === 0 ? 'Start prep' : `${done}/${total}`}
                    </Text>
                    {done > 0 && done < total && (
                      <View style={s.checklistBar}>
                        <View style={[s.checklistFill, { width: `${(done / total) * 100}%` as any }]} />
                      </View>
                    )}
                    {done === total && <Text style={{ color: C.orange, fontSize: 12 }}>Done</Text>}
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
        )}

        {/* Plan + Credits */}
        {profileSection === 'account' && (
        <View style={s.creditsCard} testID="profile.account.membership">
          <View style={s.planSignupHeader}>
            <View style={[s.planSignupIcon, hasPlan && s.planSignupIconActive]}>
              <Ionicons name={hasPlan ? 'shield-checkmark' : 'compass-outline'} size={21} color={C.orange} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.planSignupEyebrow}>Explorer</Text>
              <Text style={s.planSignupTitle}>{hasPlan ? 'Explorer active' : 'Plan better trips'}</Text>
              <Text style={s.planSignupText}>
                {hasPlan
                  ? 'Includes Trip Planner, Camp Briefs, Co-Pilot voice assistant and route tools.'
                  : 'Trip Planner, Camp Briefs, Co-Pilot voice assistant, packing lists and route briefs.'}
              </Text>
            </View>
          </View>

          {hasPlan ? (
            <>
              <View style={s.planActiveBanner}>
                <Ionicons name="checkmark-circle" size={16} color={C.orange} />
                <Text style={s.planActiveText}>Active</Text>
              </View>
              <TouchableOpacity
                style={s.managePlanBtn}
                onPress={() => Linking.openURL(subscriptionManagementUrl(Platform.OS)).catch(() => {
                  Alert.alert('Unable to open subscriptions', 'Open your device store account to manage the plan.');
                })}
              >
                <Text style={s.managePlanBtnText}>Manage subscription</Text>
                <Ionicons name="open-outline" size={12} color={C.text3} />
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={s.planSignupList}>
                {EXPLORER_PLAN_POINTS.map(item => (
                  <View key={item.label} style={s.planSignupPoint}>
                    <Ionicons name={item.icon} size={14} color={C.orange} />
                    <Text style={s.planSignupPointText}>{item.label}</Text>
                  </View>
                ))}
              </View>
              <TouchableOpacity style={s.getPlanBtn} onPress={() => { openPaywall(); setShowPaywall(true); }} activeOpacity={0.85}>
                <View>
                  <Text style={s.getPlanBtnLabel}>Start Explorer</Text>
                  <Text style={s.getPlanBtnSub}>
                    {annualProduct?.localizedPrice ?? '$49.99'}/yr · {monthlyProduct?.localizedPrice ?? '$7.99'}/mo
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
          <View style={s.creditMiniRow}>
            <Text style={s.creditMiniLabel}>Trail credits</Text>
            <Text style={s.creditMiniValue}>{(user?.credits ?? 0) > 0 ? user?.credits : 'Earn'}</Text>
          </View>
          <TouchableOpacity style={s.historyBtn} onPress={loadHistory}>
            <Ionicons name="time-outline" size={14} color={C.text3} />
            <Text style={s.historyBtnText}>Credit history</Text>
          </TouchableOpacity>
        </View>
        )}

        <PaywallModal
          visible={showPaywall}
          onClose={() => setShowPaywall(false)}
        />

        {profileSection === 'account' && showHistory && creditHistoryLoaded && (
          <View style={s.historyCard}>
            <Text style={s.sectionLabel}>RECENT ACTIVITY</Text>
            {creditHistory.length > 0 ? (
              creditHistory.map(tx => (
                <View key={tx.id} style={s.txRow}>
                  <Text style={s.txReason} numberOfLines={1}>{tx.reason}</Text>
                  <Text style={[s.txAmount, tx.amount > 0 ? s.txPos : s.txNeg]}>
                    {tx.amount > 0 ? '+' : ''}{tx.amount}
                  </Text>
                </View>
              ))
            ) : (
              <View style={s.emptyMiniCard}>
                <Text style={s.emptyMiniTitle}>Credit activity starts here</Text>
                <Text style={s.emptyMiniSub}>Reports, confirmations, and referrals will show here.</Text>
              </View>
            )}
          </View>
        )}

        {/* Theme toggle */}
        {profileSection === 'settings' && (
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
        )}

        {profileSection === 'settings' && (
        <View style={s.weatherUnitsCard}>
          <View style={{ flex: 1 }}>
            <Text style={s.themeToggleLabel}>UNITS</Text>
            <Text style={s.themeToggleSub}>Auto uses miles, gallons, and °F in the U.S.; metric elsewhere</Text>
          </View>
          <View style={s.weatherUnitsSegment}>
            {[
              ['auto', 'AUTO'],
              ['imperial', 'MI'],
              ['metric', 'KM'],
            ].map(([mode, label]) => {
              const active = weatherUnitMode === mode;
              return (
                <TouchableOpacity
                  key={mode}
                  style={[s.weatherUnitsOption, active && s.weatherUnitsOptionActive]}
                  onPress={() => setWeatherUnitMode(mode as 'auto' | 'imperial' | 'metric')}
                >
                  <Text style={[s.weatherUnitsOptionText, active && s.weatherUnitsOptionTextActive]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
        )}

        {profileSection === 'settings' && (
        <View style={s.referralPrivacyCard}>
          <View style={s.referralPrivacyCopy}>
            <Text style={s.themeToggleLabel}>REFERRAL LINKS</Text>
            <Text style={s.themeToggleSub}>Credit referral links after install. Manual codes still work when this is off.</Text>
          </View>
          {referralAttributionSaving ? (
            <ActivityIndicator size="small" color={C.orange} />
          ) : (
            <Switch
              value={referralAttributionEnabled}
              onValueChange={enabled => { void updateReferralAttribution(enabled); }}
              trackColor={{ false: C.s3, true: C.orange + '88' }}
              thumbColor={referralAttributionEnabled ? C.orange : C.text3}
              accessibilityLabel="Referral link attribution"
              testID="profile.settings.referralAttribution"
            />
          )}
        </View>
        )}

        <CommunicationPreferencesSection
          active={profileSection === 'settings'}
          signedIn={Boolean(user)}
        />

        <AccountDeletionSheet
          visible={showAccountDeletion}
          authMethod={deletionAuthMethod}
          hasActiveSubscription={hasPlan}
          deleting={accountLifecycleBusy}
          onClose={() => setShowAccountDeletion(false)}
          onManageSubscription={() => {
            Linking.openURL(subscriptionManagementUrl(Platform.OS)).catch(() => {
              Alert.alert('Unable to open subscriptions', 'Open your device store account to manage the plan.');
            });
          }}
          onAuthorizePassword={authorizePasswordAccountDeletion}
          onAuthorizeProvider={authorizeProviderAccountDeletion}
          onDelete={deleteAccountAndClearDevice}
        />

        <Modal visible={showSupportInbox} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowSupportInbox(false)}>
          <SafeAreaView style={s.contestModal} testID="profile.support.modal">
            <TrailheadTopBar
              title="INBOX"
              subtitle="Support and account messages"
              icon="mail-outline"
              style={s.contestModalHeader}
              right={(
                <TouchableOpacity
                  style={s.contestClose}
                  onPress={() => setShowSupportInbox(false)}
                  testID="profile.support.close"
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel="Close messages"
                >
                  <Ionicons name="close" size={20} color={C.text} />
                </TouchableOpacity>
              )}
            />
            {supportLoading && !supportThreads.length ? (
              <View style={s.contestLoading}>
                <ActivityIndicator color={C.orange} />
                <Text style={s.contestMuted}>Loading messages...</Text>
              </View>
            ) : (
              <ScrollView contentContainerStyle={s.contestScroll}>
                <TrailheadCard style={s.supportModalCard}>
                  <Text style={s.sectionLabel}>THREADS</Text>
                  {(supportThreads || []).length ? supportThreads.map(thread => (
                    <TouchableOpacity
                      key={thread.id}
                      style={[s.supportThreadRow, selectedSupportThread?.id === thread.id && s.supportThreadRowActive]}
                      onPress={() => openSupportThread(thread.id)}
                      testID={`profile.support.thread.${thread.id}`}
                      accessible
                      accessibilityRole="button"
                      accessibilityLabel={`${thread.subject}${Number(thread.unread_count || 0) > 0 ? `, ${thread.unread_count} unread` : ''}`}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={s.supportThreadSubject} numberOfLines={1}>{thread.subject}</Text>
                        <Text style={s.supportThreadMeta} numberOfLines={2}>
                          {thread.last_message_body || 'Open this thread to read the latest message.'}
                        </Text>
                      </View>
                      {Number(thread.unread_count || 0) > 0 ? (
                        <View style={s.supportUnreadBadge}>
                          <Text style={s.supportUnreadText}>{thread.unread_count}</Text>
                        </View>
                      ) : null}
                    </TouchableOpacity>
                  )) : (
                    <Text style={s.contestMuted}>Start a support thread below.</Text>
                  )}
                </TrailheadCard>

                <TrailheadCard style={s.supportModalCard}>
                  <Text style={s.sectionLabel}>{selectedSupportThread?.subject || 'NEW SUPPORT MESSAGE'}</Text>
                  <View style={s.supportMessageList}>
                    {(selectedSupportThread?.messages || []).length ? selectedSupportThread!.messages!.map(msg => (
                      <View key={msg.id} style={[s.supportBubble, msg.sender_role === 'admin' ? s.supportBubbleAdmin : s.supportBubbleUser]}>
                        <Text style={s.supportBubbleRole}>{msg.sender_role === 'admin' ? 'Trailhead' : 'You'}</Text>
                        <Text style={s.supportBubbleBody}>{msg.body}</Text>
                        {(msg.attachments || []).length ? (
                          <View style={s.supportMessageAttachmentRow}>
                            <Ionicons name="images-outline" size={15} color={C.text2} />
                            <Text style={s.supportMessageAttachmentText}>
                              {msg.attachments!.length} screenshot{msg.attachments!.length === 1 ? '' : 's'} attached
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    )) : (
                      <Text style={s.contestMuted}>Start a thread for account help, app support, or a prize message.</Text>
                    )}
                  </View>
                  <Text style={s.contestMuted}>For your security, never send passwords, bank account or routing numbers, card details, or identity documents in chat.</Text>
                  {supportAttachments.length ? (
                    <View style={s.supportAttachmentList}>
                      {supportAttachments.map(attachment => (
                        <View key={attachment.attachment_ref} style={s.supportAttachmentRow}>
                          <Ionicons name="image-outline" size={17} color={C.orange} />
                          <View style={s.supportAttachmentCopy}>
                            <Text style={s.supportAttachmentName} numberOfLines={1}>{attachment.name}</Text>
                            <Text style={s.supportAttachmentMeta}>{Math.max(1, Math.round(attachment.byte_count / 1024))} KB</Text>
                          </View>
                          <TouchableOpacity
                            accessibilityRole="button"
                            accessibilityLabel={`Remove ${attachment.name}`}
                            onPress={() => setSupportAttachments(current => current.filter(item => item.attachment_ref !== attachment.attachment_ref))}
                            style={s.supportAttachmentRemove}
                          >
                            <Ionicons name="close" size={18} color={C.text2} />
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  ) : null}
                  <View style={s.supportComposerTools}>
                    <TouchableOpacity
                      accessibilityRole="button"
                      disabled={supportUploading || supportAttachments.length >= 3}
                      onPress={() => void addSupportScreenshots()}
                      style={[s.supportAttachButton, (supportUploading || supportAttachments.length >= 3) && s.actionDisabled]}
                      testID="profile.support.attach"
                    >
                      {supportUploading
                        ? <ActivityIndicator size="small" color={C.orange} />
                        : <Ionicons name="attach-outline" size={18} color={C.orange} />}
                      <Text style={s.supportAttachText}>
                        {supportAttachments.length ? `Screenshots ${supportAttachments.length}/3` : 'Add screenshots'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <TextInput
                    testID="profile.support.composer"
                    accessibilityLabel={selectedSupportThread ? 'Reply to support thread' : 'New support message'}
                    style={s.supportComposer}
                    placeholder={selectedSupportThread ? 'Reply to this thread…' : 'Write a message to Trailhead support…'}
                    placeholderTextColor={C.text3}
                    value={supportDraft}
                    onChangeText={setSupportDraft}
                    multiline
                    maxLength={1200}
                    textAlignVertical="top"
                  />
                  <View style={s.supportDiagnosticRow}>
                    <View style={s.supportDiagnosticCopy}>
                      <Text style={s.supportDiagnosticTitle}>Include app diagnostics</Text>
                      <Text style={s.supportDiagnosticBody}>App version, permissions and storage state. No messages or location.</Text>
                    </View>
                    <Switch
                      value={supportDiagnosticConsent}
                      onValueChange={setSupportDiagnosticConsent}
                      trackColor={{ false: C.s3, true: C.orange + '88' }}
                      thumbColor={supportDiagnosticConsent ? C.orange : C.text3}
                      accessibilityLabel="Include app diagnostics"
                      testID="profile.support.diagnostics"
                    />
                  </View>
                  <TrailheadButton
                    testID="profile.support.send"
                    label={supportSending ? 'SENDING...' : 'SEND MESSAGE'}
                    icon="send-outline"
                    variant="primary"
                    loading={supportSending}
                    onPress={sendSupportReply}
                    disabled={supportSending || !supportDraft.trim()}
                  />
                </TrailheadCard>
              </ScrollView>
            )}
          </SafeAreaView>
        </Modal>

        <Modal visible={showContributorApply} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowContributorApply(false)}>
          <SafeAreaView style={[s.container, { padding: 0 }]}>
            <View style={s.bugModal}>
              <TrailheadTopBar
                title="MAP CONTRIBUTOR"
                subtitle="Field review access"
                icon="ribbon-outline"
                style={s.bugModalHeader}
                right={<TouchableOpacity onPress={() => setShowContributorApply(false)}><Ionicons name="close" size={22} color={C.text3} /></TouchableOpacity>}
              />
              <Text style={s.contributorIntro}>
                Apply to help review field-check camp leads. Approved contributors can see private leads, confirm what is still there, and flag bad locations before anything goes public.
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
              <TrailheadButton label="Submit Application" variant="primary" loading={contributorApplying} onPress={applyMapContributor} disabled={contributorApplying} />
            </View>
          </SafeAreaView>
        </Modal>

        {/* Bug Report */}
        {profileSection === 'support' && (
        <TouchableOpacity style={s.bugCard} onPress={() => setShowBugModal(true)} testID="profile.support.reportProblem">
          <View style={s.bugCardLeft}>
            <Ionicons name="alert-circle-outline" size={20} color={C.red} />
            <View style={{ flex: 1 }}>
              <Text style={s.bugCardTitle}>Report a problem</Text>
              <Text style={s.bugCardSub}>Send details so support can review it.</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={16} color={C.text3} />
        </TouchableOpacity>
        )}

        {/* Bug report modal */}
        <Modal visible={showBugModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowBugModal(false)}>
          <SafeAreaView style={[s.container, { padding: 0 }]}>
            <View style={s.bugModal}>
              <TrailheadTopBar
                title="REPORT A PROBLEM"
                subtitle="Describe what happened"
                icon="alert-circle-outline"
                style={s.bugModalHeader}
                right={<TouchableOpacity onPress={() => setShowBugModal(false)}><Ionicons name="close" size={22} color={C.text3} /></TouchableOpacity>}
              />

              {bugSent ? (
                <View style={s.bugSentWrap}>
                  <Ionicons name="checkmark-circle" size={52} color={C.green} />
                  <Text style={s.bugSentTitle}>Report received!</Text>
                  <Text style={s.bugSentSub}>We'll review it. Verified reports may earn credits.</Text>
                </View>
              ) : (
                <>
                  <TrailheadCard style={s.bugCreditBanner}>
                    <Ionicons name="flash" size={14} color={C.orange} />
                    <Text style={s.bugCreditText}>Verified reports may earn credits. You must be logged in to receive them.</Text>
                  </TrailheadCard>
                  <Text style={s.bugFieldLabel}>WHAT HAPPENED</Text>
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
                  <TrailheadButton label="Submit Report" icon="send-outline" variant="primary" loading={bugSubmitting} onPress={submitBug} disabled={bugSubmitting} />
                </>
              )}
            </View>
          </SafeAreaView>
        </Modal>

        <Modal visible={showContributions} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowContributions(false)}>
          <SafeAreaView style={s.contestModal} testID="profile.contributions.modal">
            <TrailheadTopBar
              title="PROFILE"
              subtitle="Contributions"
              icon="ribbon-outline"
              style={s.contestModalHeader}
              right={(
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={s.betaBadge}><Text style={s.betaBadgeText}>LIVE</Text></View>
                  <TouchableOpacity style={s.contestClose} onPress={() => setShowContributions(false)}>
                    <Ionicons name="close" size={20} color={C.text} />
                  </TouchableOpacity>
                </View>
              )}
            />
            {contributionsLoading ? (
              <View style={s.contestLoading}>
                <ActivityIndicator color={C.orange} />
                <Text style={s.contestMuted}>Loading your contributor profile...</Text>
              </View>
            ) : (
              <ScrollView contentContainerStyle={s.contestScroll}>
                <TrailheadCard style={s.contributionHero}>
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
                </TrailheadCard>

                <TrailheadCard style={s.contributionPrivacyCard}>
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
                </TrailheadCard>

                <TrailheadCard style={s.contestBoardCard}>
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
                </TrailheadCard>

                <TrailheadCard style={s.contestBoardCard}>
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
                </TrailheadCard>

                <TrailheadCard style={s.contestBoardCard}>
                  <Text style={s.sectionLabel}>RECENT POINT SOURCES</Text>
                  {(contributions?.recent_activity ?? []).length ? contributions!.recent_activity.map(item => (
                    <View key={item.label} style={s.contestLeaderRow}>
                      <Text style={s.contributionMetricLabel}>{item.label}</Text>
                      <Text style={s.contestLeaderPoints}>{item.points.toLocaleString()} pts</Text>
                    </View>
                  )) : <Text style={s.contestMuted}>Contribution points start with field updates.</Text>}
                </TrailheadCard>
              </ScrollView>
            )}
          </SafeAreaView>
        </Modal>

        <Modal visible={showContest} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowContest(false)}>
          <SafeAreaView style={s.contestModal} testID="profile.prizes.modal">
            <TrailheadTopBar
              title="TRAILHEAD"
              subtitle="Contributor prizes"
              icon="trophy-outline"
              style={s.contestModalHeader}
              right={(
                <TouchableOpacity style={s.contestClose} onPress={() => setShowContest(false)} testID="profile.prizes.close">
                  <Ionicons name="close" size={20} color={C.text} />
                </TouchableOpacity>
              )}
            />
            {contestLoading ? (
              <View style={s.contestLoading}>
                <ActivityIndicator color={C.orange} />
                <Text style={s.contestMuted}>Loading contest standings...</Text>
              </View>
            ) : (
              <ScrollView contentContainerStyle={s.contestScroll}>
                <TrailheadCard style={s.contestHero}>
                  <Text style={s.contestHeroTitle}>Earn points for useful contributions</Text>
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
                </TrailheadCard>

                <View style={s.contestPrizeGrid}>
                  {[
                    ['$1,000', 'Yearly leader', 'Top total contest points for the calendar year.'],
                    ['$100', 'Monthly leader', 'Top contributor at the end of each calendar month.'],
                    ['$50', 'Monthly drawing', 'Subscribers enter automatically. Free entry is available here.'],
                  ].map(([amount, title, desc]) => (
                    <TrailheadCard key={title} style={s.contestPrizeCard}>
                      <Text style={s.contestPrizeCardAmount}>{amount}</Text>
                      <Text style={s.contestPrizeCardTitle}>{title}</Text>
                      <Text style={s.contestPrizeCardDesc}>{desc}</Text>
                    </TrailheadCard>
                  ))}
                </View>

                <TrailheadCard style={s.contestEntryCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.contestEntryTitle}>Monthly drawing</Text>
                    <Text style={s.contestEntryText}>
                      {contest?.drawing_entered
                        ? `Entered for ${contest.period_month}${contest.drawing_entry_type === 'subscriber' ? ' with Explorer' : contest.drawing_entry_type === 'free' ? ' with a free entry' : ''}.`
                        : 'No purchase necessary. One free entry per eligible user each month.'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[s.contestEntryBtn, contest?.drawing_entered && s.contestEntryBtnDone]}
                    onPress={enterContestDrawing}
                    disabled={contestEntering || contest?.drawing_entered}
                    testID="profile.prizes.enter"
                  >
                    <Text style={s.contestEntryBtnText}>{contestEntering ? 'SAVING' : contest?.drawing_entered ? 'ENTERED' : 'ENTER FREE'}</Text>
                  </TouchableOpacity>
                </TrailheadCard>

                {!!contributions?.awards?.length && (
                  <View testID="profile.prizes.history">
                    <TrailheadCard style={s.contestBoardCard}>
                      <Text style={s.sectionLabel}>YOUR PRIZES</Text>
                      {contributions.awards.map(award => {
                        const status = contestAwardPresentation(award.status);
                        const period = contestAwardPeriodLabel(award.period_month, award.period_year);
                        return (
                          <View key={award.id} style={s.prizeStatusRow} testID={`profile.prizes.award.${award.id}`}>
                            <View style={s.prizeStatusCopy}>
                              <Text style={s.prizeStatusTitle}>{award.prize_label}</Text>
                              {!!period && <Text style={s.prizeStatusPeriod}>{period}</Text>}
                              <Text style={s.prizeStatusLabel}>{status.label}</Text>
                              <Text style={s.prizeStatusDetail}>{status.detail}</Text>
                            </View>
                            {status.canOpenMessage ? (
                              <TouchableOpacity
                                style={s.prizeMessageButton}
                                onPress={() => void openPrizeMessage(award.id)}
                                testID={`profile.prizes.message.${award.id}`}
                                accessibilityRole="button"
                                accessibilityLabel={`Open private prize message for ${award.prize_label}`}
                              >
                                <Ionicons name="mail-outline" size={17} color={C.orange} />
                                <Text style={s.prizeMessageButtonText}>Message</Text>
                              </TouchableOpacity>
                            ) : null}
                          </View>
                        );
                      })}
                    </TrailheadCard>
                  </View>
                )}

                <TrailheadCard style={s.contestBoardCard}>
                  <Text style={s.sectionLabel}>MONTHLY LEADERS</Text>
                  {(contest?.month_leaders ?? []).slice(0, 8).map(row => (
                    <View key={`m-${row.user_id}`} style={s.contestLeaderRow}>
                      <Text style={s.contestRank}>#{row.rank}</Text>
                      <Text style={s.contestLeaderName}>{row.display_name}</Text>
                      <Text style={s.contestLeaderPoints}>{row.points.toLocaleString()}</Text>
                    </View>
                  ))}
                  {!contest?.month_leaders?.length && <Text style={s.contestMuted}>Monthly standings start with field updates.</Text>}
                </TrailheadCard>

                <TrailheadCard style={s.contestBoardCard}>
                  <Text style={s.sectionLabel}>YEARLY LEADERS</Text>
                  {(contest?.year_leaders ?? []).slice(0, 8).map(row => (
                    <View key={`y-${row.user_id}`} style={s.contestLeaderRow}>
                      <Text style={s.contestRank}>#{row.rank}</Text>
                      <Text style={s.contestLeaderName}>{row.display_name}</Text>
                      <Text style={s.contestLeaderPoints}>{row.points.toLocaleString()}</Text>
                    </View>
                  ))}
                  {!contest?.year_leaders?.length && <Text style={s.contestMuted}>Yearly standings start with field updates.</Text>}
                </TrailheadCard>

                <TrailheadCard style={s.contestRulesCard}>
                  <Text style={s.contestRulesTitle}>Official rules</Text>
                  {contest?.rules ? [
                    contest.rules.eligibility,
                    contest.rules.entries,
                    contest.rules.odds,
                    contest.rules.points,
                    contest.rules.sponsor,
                    contest.rules.contact,
                  ].map((line, idx) => <Text key={idx} style={s.contestRuleLine}>{line}</Text>) : (
                    <Text style={s.contestRuleLine}>Official rules are not available right now.</Text>
                  )}
                </TrailheadCard>
              </ScrollView>
            )}
          </SafeAreaView>
        </Modal>

        {/* Contributions */}
        {profileSection === 'community' && (
        <TouchableOpacity
          style={s.contributionCard}
          onPress={openContributions}
          activeOpacity={0.9}
          testID="profile.community.contributions"
        >
          <View style={s.contributionGlow} />
          <View style={s.contestHeader}>
            <View style={s.contributionIcon}>
              <Ionicons name="ribbon-outline" size={20} color={C.orange} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.contributionKicker}>CONTRIBUTIONS</Text>
              <Text style={s.contestTitle}>Your field contributions</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.text3} />
          </View>
          <View style={s.contributionMiniRow}>
            <View style={s.contributionMini}>
              <Ionicons name="medal-outline" size={16} color={C.orange} />
              <Text style={s.contributionMiniText}>tier badges</Text>
            </View>
            <View style={s.contributionMini}>
              <Ionicons name="flame-outline" size={16} color={C.orange} />
              <Text style={s.contributionMiniText}>streaks</Text>
            </View>
            <View style={s.contributionMini}>
              <Ionicons name="people-outline" size={16} color={C.orange} />
              <Text style={s.contributionMiniText}>leaderboards</Text>
            </View>
          </View>
        </TouchableOpacity>
        )}

        {/* Contest */}
        {profileSection === 'community' && (
        <TouchableOpacity
          style={s.contestCard}
          onPress={openContest}
          activeOpacity={0.9}
          testID="profile.community.prizes"
        >
          <View style={s.contestGlow} />
          <View style={s.contestHeader}>
            <View style={s.contestIcon}>
              <Ionicons name="trophy-outline" size={20} color={C.orange} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.contestKicker}>TRAILHEAD PRIZES</Text>
              <Text style={s.contestTitle}>Contributor prizes</Text>
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
        )}

        {/* Referral */}
        {profileSection === 'account' && (
        <View style={s.referralCard} testID="profile.account.referral">
          <View style={s.referralHeader}>
            <Ionicons name="people-outline" size={18} color={C.orange} />
            <Text style={s.referralTitle}>Refer Friends</Text>
          </View>
          <Text style={s.referralDesc}>
            Share your code — +{CREDIT_REWARDS.referral} credits after a friend creates and verifies an account.
          </Text>
          <View style={s.codeBox}>
            <Text style={s.codeText}>{user?.referral_code ?? 'Generating...'}</Text>
          </View>
          <TouchableOpacity style={s.shareBtn} onPress={shareReferral} testID="profile.account.referral.share">
            <Ionicons name="share-outline" size={16} color="#fff" />
            <Text style={s.shareBtnText}>SHARE REFERRAL CODE</Text>
          </TouchableOpacity>
        </View>
        )}

        {/* How to earn */}
        {profileSection === 'account' && (
        <View style={s.earnCard}>
          <Text style={s.sectionLabel}>HOW TO EARN CREDITS</Text>
          {[
            [CREDIT_REWARDS.signup, 'Signup welcome bonus (after email verification)'],
            [CREDIT_REWARDS.communityReport,  'Submit a community report (max 8/day)'],
            [CREDIT_REWARDS.reportPhotoBonus, 'Add a photo to a report'],
            [CREDIT_REWARDS.confirmReport,  'Confirm another user report'],
            [CREDIT_REWARDS.communityPin,  'Add a manual community pin'],
            [CREDIT_REWARDS.gpxImport,  'Import GPX pins (unverified)'],
            [CREDIT_REWARDS.referral, 'Refer a friend who verifies an account'],
            [CREDIT_REWARDS.campEditSuggestion, 'Suggest a camp profile edit'],
            [CREDIT_REWARDS.streak3, '3-day reporting streak bonus'],
            [CREDIT_REWARDS.streak7, '7-day reporting streak bonus'],
            [CREDIT_REWARDS.streak30, '30-day reporting streak bonus'],
          ].filter(([amount]) => Number(amount) > 0).map(([amount, action]) => (
            <View key={action} style={s.earnRow}>
              <Text style={s.earnAmount}>+{amount}</Text>
              <Text style={s.earnAction}>{action}</Text>
            </View>
          ))}
        </View>
        )}

        {/* Delete account — required by App Store guideline 5.1.1(v) */}
        {profileSection === 'settings' && (
        <TouchableOpacity
          style={[s.deleteAccountBtn, accountLifecycleBusy && s.actionDisabled]}
          onPress={confirmAccountDeletion}
          disabled={accountLifecycleBusy}
          testID="profile.settings.deleteAccount"
        >
          {accountLifecycleBusy
            ? <ActivityIndicator size="small" color="#ef4444" />
            : <Ionicons name="trash-outline" size={14} color="#ef4444" />}
          <Text style={s.deleteAccountText}>{accountLifecycleBusy ? 'Clearing account...' : 'Delete Account'}</Text>
        </TouchableOpacity>
        )}

        {/* App version info */}
        {profileSection === 'settings' && (
        <View style={s.versionCard}>
          <Text style={[s.versionLabel, { marginBottom: 8, letterSpacing: 0.5 }]}>TRAILHEAD</Text>
          <View style={s.versionRow}>
            <Text style={s.versionLabel}>APP VERSION</Text>
            <Text style={s.versionValue}>
              {Application.nativeApplicationVersion ?? Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? '—'}
              {Application.nativeBuildVersion || Constants.nativeBuildVersion ? ` (${Application.nativeBuildVersion ?? Constants.nativeBuildVersion})` : ''}
            </Text>
          </View>
          <View style={s.versionRow}>
            <Text style={s.versionLabel}>RELEASE</Text>
            <Text style={s.versionValue}>{Updates.updateId ? Updates.updateId.slice(0, 8) : 'Current'}</Text>
          </View>
          <View style={s.versionRow}>
            <Text style={s.versionLabel}>UPDATED</Text>
            <Text style={s.versionValue}>
              {Updates.createdAt ? Updates.createdAt.toLocaleDateString() : '—'}
            </Text>
          </View>
          {telemetryQaSurfaceIsAvailable(Boolean(user?.is_admin)) ? (
            <TouchableOpacity
              testID="profile.qa.telemetry.open"
              accessibilityRole="button"
              accessibilityLabel="Open telemetry check"
              onPress={() => router.push('/qa/telemetry' as any)}
              style={[s.telemetryQaButton, { borderColor: C.border }]}
            >
              <Ionicons name="pulse-outline" size={18} color={C.orange} />
              <Text style={[s.telemetryQaButtonText, { color: C.text }]}>Telemetry check</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (C: ColorPalette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 14, gap: 14, paddingBottom: 104 },

  guestScroll: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 116, gap: 22 },
  guestHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  guestTitle: { color: C.text, fontSize: 30, lineHeight: 36, fontWeight: '900', letterSpacing: 0 },
  guestSubtitle: { color: C.text3, fontSize: 13, lineHeight: 18, marginTop: 3 },
  guestThemeButton: {
    width: 48, height: 48, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.s1, borderWidth: 1, borderColor: C.border,
  },
  guestAccountCard: {
    gap: 10, padding: 16, borderRadius: 8, backgroundColor: C.s1,
    borderWidth: 1, borderColor: C.border,
  },
  guestAccountTitle: { color: C.text, fontSize: 19, lineHeight: 24, fontWeight: '900', letterSpacing: 0 },
  guestAccountBody: { color: C.text2, fontSize: 13, lineHeight: 19 },
  guestAuthActions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  guestPrimaryAction: {
    minHeight: 48, minWidth: 112, paddingHorizontal: 20, borderRadius: 8,
    backgroundColor: C.orange, alignItems: 'center', justifyContent: 'center',
  },
  guestPrimaryActionText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  guestSecondaryAction: {
    minHeight: 48, paddingHorizontal: 14, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  guestSecondaryActionText: { color: C.orange, fontSize: 14, fontWeight: '900' },
  guestSection: { gap: 9 },
  guestSectionLabel: { color: C.text3, fontSize: 10, fontFamily: mono, fontWeight: '900', letterSpacing: 0 },
  guestList: { borderRadius: 8, overflow: 'hidden', backgroundColor: C.s1, borderWidth: 1, borderColor: C.border },
  guestRow: {
    minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border,
  },
  guestRowLast: { borderBottomWidth: 0 },
  guestRowIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  guestRowCopy: { flex: 1, minWidth: 0 },
  guestRowTitle: { color: C.text, fontSize: 15, lineHeight: 20, fontWeight: '800' },
  guestRowDetail: { color: C.text3, fontSize: 11.5, lineHeight: 16, marginTop: 2 },

  authSuccessWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 },
  authSuccessText: { color: C.green, fontSize: 17, fontWeight: '700', textAlign: 'center', lineHeight: 24 },
  authScroll: { flexGrow: 1, justifyContent: 'center', padding: 28, gap: 14 },
  authBackButton: { alignSelf: 'flex-start', minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4, paddingRight: 12 },
  authBackText: { color: C.text, fontSize: 14, fontWeight: '800' },
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
  socialAuthStack: { gap: 10 },
  appleAuthButton: { height: 50, width: '100%' },
  socialAuthButton: {
    height: 50, borderRadius: 14, borderWidth: 1, borderColor: C.border,
    backgroundColor: C.s2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  socialAuthText: { color: C.text, fontSize: 14, fontWeight: '800' },
  authDivider: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 2 },
  authDividerLine: { flex: 1, height: 1, backgroundColor: C.border },
  authDividerText: { color: C.text3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', fontFamily: mono },
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
    backgroundColor: C.s2, borderRadius: 18, borderWidth: 1, borderColor: C.border,
    padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12,
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 18, shadowOffset: { width: 0, height: 8 },
  },
  avatar: {
    width: 48, height: 48, borderRadius: 18,
    backgroundColor: C.s3, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#E5E7EB', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.12, shadowRadius: 12,
  },
  avatarText: { color: C.text, fontSize: 20, fontWeight: '800' },
  profileInfo: { flex: 1 },
  profileName: {
    color: C.text,
    fontSize: 21,
    lineHeight: 23,
    fontFamily: trailheadFonts.displayBold,
    letterSpacing: 0,
  },
  profileEmail: { color: C.text3, fontSize: 12, marginTop: 1 },
  streakText: { color: C.orange, fontSize: 11, fontFamily: mono, marginTop: 4 },
  logoutBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  actionDisabled: { opacity: 0.55 },
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

  profileSectionNav: { marginHorizontal: -14 },
  profileSectionNavContent: { paddingHorizontal: 14, gap: 8 },
  profileSectionChip: {
    minHeight: Platform.OS === 'android' ? 48 : 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s2,
  },
  profileSectionChipActive: { backgroundColor: C.orange, borderColor: C.orange },
  profileSectionChipText: { color: C.text3, fontSize: 11, fontWeight: '800', letterSpacing: 0 },
  profileSectionChipTextActive: { color: '#fff' },
  emptySectionText: { color: C.text3, fontSize: 12.5, lineHeight: 18 },
  tripSummaryCard: {
    backgroundColor: C.s2,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    gap: 8,
  },
  tripSummaryAction: {
    alignSelf: 'flex-start',
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.orange + '44',
    backgroundColor: C.orangeGlow,
  },
  tripSummaryActionText: { color: C.orange, fontSize: 10, fontFamily: mono, fontWeight: '900' },
  tripSummaryMeta: { color: C.text3, fontSize: 11, fontFamily: mono, lineHeight: 16 },

  // Quick actions
  quickActionsRow: { marginHorizontal: -14 },
  quickActionsContent: { flexDirection: 'row', paddingHorizontal: 14, gap: 10 },
  quickAction: { alignItems: 'center', gap: 6, width: 84 },
  quickActionIcon: {
    width: 50, height: 50, borderRadius: 16,
    borderWidth: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.s2,
  },
  quickActionLabel: { color: C.text2, fontSize: 11, lineHeight: 14, fontWeight: '700', letterSpacing: 0, textAlign: 'center' },
  bookedScreen: { gap: 12 },
  sectionHeaderCompact: { gap: 2, marginTop: 2 },
  sectionEyebrow: { color: C.orange, fontSize: 9, lineHeight: 12, fontFamily: mono, fontWeight: '900', letterSpacing: 0 },
  bookedScreenTitle: { color: C.text, fontSize: 19, lineHeight: 24, fontWeight: '900', letterSpacing: 0 },
  bookedScreenSub: { color: C.text3, fontSize: 13, lineHeight: 18, marginTop: 3 },
  bookedTourCard: {
    backgroundColor: C.s2,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    gap: 13,
    shadowColor: '#000',
    shadowOpacity: 0.13,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  bookedTourHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bookedTourImage: { width: 76, height: 76, borderRadius: 12, backgroundColor: C.s3 },
  bookedTourImageFallback: {
    width: 76,
    height: 76,
    borderRadius: 12,
    backgroundColor: C.orangeGlow,
    borderWidth: 1,
    borderColor: C.orange + '44',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bookedTourTitleWrap: { flex: 1, minWidth: 0, gap: 3 },
  bookedTourTitle: { color: C.text, fontSize: 19, lineHeight: 23, fontWeight: '900', letterSpacing: 0 },
  bookedTourPrice: { color: C.text, fontSize: 14, lineHeight: 18, fontWeight: '800' },
  bookedTourLocation: { color: C.text3, fontSize: 12, lineHeight: 16 },
  bookedInfoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  bookedInfoText: { flex: 1, color: C.text, fontSize: 16, lineHeight: 22, fontWeight: '700' },
  bookedCancelRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  bookedCancelTitle: { fontSize: 16, lineHeight: 21, fontWeight: '800' },
  bookedCancelSub: { color: C.text3, fontSize: 13, lineHeight: 19, marginTop: 2 },
  bookedDivider: { height: 1, backgroundColor: C.border, marginTop: 2 },
  bookedDetailsButton: { minHeight: 42, alignItems: 'center', justifyContent: 'center' },
  bookedDetailsText: { color: C.blueGlow, fontSize: 16, lineHeight: 21, fontWeight: '800' },
  planAheadWrap: { gap: 8, marginTop: 2 },
  planAheadTitle: { color: C.text, fontSize: 17, lineHeight: 22, fontWeight: '900', letterSpacing: 0 },
  planAheadCard: {
    backgroundColor: C.s2,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    overflow: 'hidden',
  },
  planAheadRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  planAheadIcon: { width: 34, alignItems: 'center' },
  planAheadText: { flex: 1, color: C.text, fontSize: 15, lineHeight: 20, fontWeight: '800' },
  bookedEmptyCard: {
    backgroundColor: C.s2,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    gap: 12,
  },
  bookedEmptyIcon: {
    width: 58,
    height: 58,
    borderRadius: 20,
    backgroundColor: C.orangeGlow,
    borderWidth: 1,
    borderColor: C.orange + '44',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bookedEmptyTitle: { color: C.text, fontSize: 21, lineHeight: 26, fontWeight: '900', letterSpacing: 0 },
  bookedEmptyText: { color: C.text3, fontSize: 13, lineHeight: 18 },
  supportCard: { backgroundColor: C.s2, borderRadius: 18, borderWidth: 1, borderColor: C.border, padding: 14, gap: 10 },
  supportCardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  supportCardIcon: { width: 38, height: 38, borderRadius: 14, backgroundColor: C.orangeGlow, borderWidth: 1, borderColor: C.orange + '44', alignItems: 'center', justifyContent: 'center' },
  supportCardKicker: { color: C.orange, fontSize: 9, fontFamily: mono, fontWeight: '900', letterSpacing: 0.9 },
  supportCardTitle: { color: C.text, fontSize: 20, lineHeight: 22, fontFamily: trailheadFonts.displayBold, marginTop: 2 },
  supportCardBody: { color: C.text2, fontSize: 12.5, lineHeight: 18 },
  supportMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  supportMetaText: { color: C.text3, fontSize: 11, fontFamily: mono },
  supportMetaAction: { color: C.orange, fontSize: 11, fontFamily: mono, fontWeight: '900' },
  supportUnreadBadge: { minWidth: 24, height: 24, paddingHorizontal: 7, borderRadius: 999, backgroundColor: C.orange, alignItems: 'center', justifyContent: 'center' },
  supportUnreadText: { color: '#fff', fontSize: 10, fontFamily: mono, fontWeight: '900' },
  supportModalCard: { backgroundColor: C.s2, borderRadius: 20, borderWidth: 1, borderColor: C.border, padding: 14, gap: 12 },
  supportThreadRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  supportThreadRowActive: { backgroundColor: C.s3, borderRadius: 14, paddingHorizontal: 10, marginHorizontal: -4 },
  supportThreadSubject: { color: C.text, fontSize: 13, fontWeight: '800' },
  supportThreadMeta: { color: C.text3, fontSize: 11, lineHeight: 16, marginTop: 3 },
  supportMessageList: { gap: 10 },
  supportBubble: { borderRadius: 16, padding: 12, borderWidth: 1 },
  supportBubbleAdmin: { backgroundColor: C.orangeGlow, borderColor: C.orange + '33' },
  supportBubbleUser: { backgroundColor: C.s3, borderColor: C.border },
  supportBubbleRole: { color: C.orange, fontSize: 9, fontFamily: mono, fontWeight: '900', letterSpacing: 0.7, marginBottom: 5 },
  supportBubbleBody: { color: C.text, fontSize: 13, lineHeight: 19 },
  supportMessageAttachmentRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 9 },
  supportMessageAttachmentText: { color: C.text2, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  supportAttachmentList: { gap: 8 },
  supportAttachmentRow: { minHeight: 52, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.s3, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  supportAttachmentCopy: { flex: 1, minWidth: 0 },
  supportAttachmentName: { color: C.text, fontSize: 13, lineHeight: 18, fontWeight: '800' },
  supportAttachmentMeta: { color: C.text3, fontSize: 11, lineHeight: 15 },
  supportAttachmentRemove: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  supportComposerTools: { flexDirection: 'row', alignItems: 'center' },
  supportAttachButton: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  supportAttachText: { color: C.orange, fontSize: 13, lineHeight: 18, fontWeight: '800' },
  supportComposer: { minHeight: 96, borderRadius: 16, borderWidth: 1, borderColor: C.border, backgroundColor: C.s3, color: C.text, padding: 12, fontSize: 14 },
  supportDiagnosticRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12 },
  supportDiagnosticCopy: { flex: 1, minWidth: 0 },
  supportDiagnosticTitle: { color: C.text, fontSize: 13, lineHeight: 18, fontWeight: '800' },
  supportDiagnosticBody: { color: C.text3, fontSize: 11, lineHeight: 16, marginTop: 2 },

  contributionCard: {
    backgroundColor: C.s2, borderRadius: 20, borderWidth: 1, borderColor: C.border,
    padding: 16, overflow: 'hidden', gap: 14,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 18, shadowOffset: { width: 0, height: 8 },
  },
  contributionGlow: { position: 'absolute', right: -44, top: -60, width: 162, height: 162, borderRadius: 81, backgroundColor: C.orangeGlow },
  contributionIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: C.orangeGlow, borderWidth: 1, borderColor: C.orange + '44', alignItems: 'center', justifyContent: 'center' },
  contributionKicker: { color: C.orange, fontSize: 9, fontFamily: mono, fontWeight: '900', letterSpacing: 1 },
  contributionMiniRow: { flexDirection: 'row', gap: 8 },
  contributionMini: { flex: 1, borderRadius: 16, backgroundColor: C.s3, borderWidth: 1, borderColor: C.border, padding: 10, minHeight: 62, alignItems: 'center', justifyContent: 'center', gap: 5 },
  contributionMiniText: { color: C.text3, fontSize: 9, fontFamily: mono, textAlign: 'center' },
  contributionHero: { backgroundColor: C.s2, borderRadius: 20, borderWidth: 1, borderColor: C.border, padding: 18, gap: 12, alignItems: 'center' },
  contributionAvatar: { width: 76, height: 76, borderRadius: 26, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#ffffff44' },
  contributionAvatarText: { color: '#fff', fontSize: 32, fontWeight: '900' },
  contributionName: { color: C.text, fontSize: 29, lineHeight: 31, fontFamily: trailheadFonts.displayBold, letterSpacing: 0 },
  contributionTitle: { color: C.orange, fontSize: 12, fontFamily: mono, fontWeight: '900' },
  contributionProgress: { width: '100%', height: 9, borderRadius: 999, backgroundColor: C.s3, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  contributionProgressFill: { height: '100%', borderRadius: 999, backgroundColor: C.orange },
  contributionPrivacyCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.s2, borderRadius: 20, borderWidth: 1, borderColor: C.border, padding: 14 },
  contributionBadgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  contributionBadge: { width: '48%', minHeight: 106, borderRadius: 12, backgroundColor: C.s3, borderWidth: 1, borderColor: C.border, padding: 10, gap: 5 },
  contributionBadgeTitle: { color: C.text, fontSize: 12, fontWeight: '900' },
  contributionBadgeDesc: { color: C.text3, fontSize: 10.5, lineHeight: 14 },
  contributionMetricLabel: { color: C.text2, flex: 1, fontSize: 13 },

  contestCard: {
    backgroundColor: C.s2, borderRadius: 20, borderWidth: 1, borderColor: C.border,
    padding: 16, overflow: 'hidden', gap: 14,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 18, shadowOffset: { width: 0, height: 8 },
  },
  contestGlow: { position: 'absolute', right: -42, top: -58, width: 160, height: 160, borderRadius: 80, backgroundColor: C.orangeGlow },
  contestHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  contestIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: C.orangeGlow, borderWidth: 1, borderColor: C.orange + '44', alignItems: 'center', justifyContent: 'center' },
  contestKicker: { color: C.orange, fontSize: 9, fontFamily: mono, fontWeight: '900', letterSpacing: 1 },
  contestTitle: { color: C.text, fontSize: 22, lineHeight: 24, fontFamily: trailheadFonts.displayBold, marginTop: 3, letterSpacing: 0 },
  contestPrizeRow: { flexDirection: 'row', gap: 8 },
  contestPrize: { flex: 1, borderRadius: 16, backgroundColor: C.s3, borderWidth: 1, borderColor: C.border, padding: 10, minHeight: 76, justifyContent: 'center' },
  contestPrizeAmount: { color: C.text, fontSize: 19, fontFamily: mono, fontWeight: '900' },
  contestPrizeLabel: { color: C.text3, fontSize: 10, lineHeight: 14, marginTop: 3 },
  contestFinePrint: { color: C.text3, fontSize: 10.5, lineHeight: 15 },
  contestModal: { flex: 1, backgroundColor: C.bg },
  contestModalHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.s2 },
  contestClose: { width: 44, height: 44, borderRadius: 14, backgroundColor: C.s3, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  contestModalKicker: { color: C.orange, fontSize: 9, fontFamily: mono, fontWeight: '900', letterSpacing: 1.2 },
  contestModalTitle: { color: C.text, fontSize: 22, fontWeight: '900', letterSpacing: 0 },
  betaBadge: { borderRadius: 999, borderWidth: 1, borderColor: C.orange + '55', backgroundColor: C.orangeGlow, paddingHorizontal: 10, paddingVertical: 5 },
  betaBadgeText: { color: C.orange, fontSize: 9, fontFamily: mono, fontWeight: '900' },
  contestScroll: { padding: 16, gap: 14, paddingBottom: 40 },
  contestLoading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  contestHero: { backgroundColor: C.s2, borderRadius: 26, borderWidth: 1, borderColor: C.border, padding: 18, gap: 14 },
  contestHeroTitle: { color: C.text, fontSize: 31, lineHeight: 33, fontFamily: trailheadFonts.displayBold, letterSpacing: 0 },
  contestHeroText: { color: C.text2, fontSize: 14, lineHeight: 21 },
  contestHeroStats: { flexDirection: 'row', gap: 8 },
  contestHeroStat: { flex: 1, borderRadius: 16, backgroundColor: C.s3, borderWidth: 1, borderColor: C.border, padding: 10, alignItems: 'center' },
  contestHeroNumber: { color: C.text, fontSize: 20, fontFamily: mono, fontWeight: '900' },
  contestHeroLabel: { color: C.text3, fontSize: 8, fontFamily: mono, marginTop: 4, textAlign: 'center' },
  contestPrizeGrid: { gap: 10 },
  contestPrizeCard: { backgroundColor: C.s2, borderRadius: 20, borderWidth: 1, borderColor: C.border, padding: 15 },
  contestPrizeCardAmount: { color: C.orange, fontSize: 28, fontFamily: trailheadFonts.displayBold },
  contestPrizeCardTitle: { color: C.text, fontSize: 15, fontWeight: '900', marginTop: 3 },
  contestPrizeCardDesc: { color: C.text3, fontSize: 12.5, lineHeight: 18, marginTop: 5 },
  contestEntryCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.s2, borderRadius: 20, borderWidth: 1, borderColor: '#d4af3744', padding: 14 },
  contestEntryTitle: { color: C.text, fontSize: 15, fontWeight: '900' },
  contestEntryText: { color: C.text3, fontSize: 12, lineHeight: 17, marginTop: 3 },
  contestEntryBtn: { borderRadius: 14, backgroundColor: C.orange, paddingHorizontal: 14, paddingVertical: 11, minWidth: 98, alignItems: 'center' },
  contestEntryBtnDone: { backgroundColor: C.orange2 },
  contestEntryBtnText: { color: '#fff', fontSize: 10, fontFamily: mono, fontWeight: '900' },
  contestBoardCard: { backgroundColor: C.s2, borderRadius: 20, borderWidth: 1, borderColor: C.border, padding: 14 },
  contestLeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  contestRank: { color: '#d4af37', width: 38, fontSize: 13, fontFamily: mono, fontWeight: '900' },
  contestLeaderName: { color: C.text, flex: 1, fontSize: 14, fontWeight: '700' },
  contestLeaderPoints: { color: C.text, fontSize: 14, fontFamily: mono, fontWeight: '900' },
  contestMuted: { color: C.text3, fontSize: 12, lineHeight: 18 },
  prizeStatusRow: {
    minHeight: 94,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  prizeStatusCopy: { flex: 1, minWidth: 0 },
  prizeStatusTitle: { color: C.text, fontSize: 16, lineHeight: 20, fontWeight: '900' },
  prizeStatusPeriod: { color: C.text3, fontSize: 11, lineHeight: 15, marginTop: 2 },
  prizeStatusLabel: { color: C.orange, fontSize: 12, lineHeight: 16, fontWeight: '900', marginTop: 7 },
  prizeStatusDetail: { color: C.text3, fontSize: 11.5, lineHeight: 16, marginTop: 2 },
  prizeMessageButton: {
    minHeight: 44,
    minWidth: 88,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.orange + '55',
    backgroundColor: C.orangeGlow,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  prizeMessageButtonText: { color: C.orange, fontSize: 12, fontWeight: '900' },
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
  checkboxDone: { backgroundColor: C.orange, borderColor: C.orange },
  checkLabel: { color: C.text2, fontSize: 13, flex: 1 },
  checkLabelDone: { color: C.text3, textDecorationLine: 'line-through' },
  checkResetBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, justifyContent: 'center',
    paddingVertical: 12, marginHorizontal: 16, marginBottom: 12,
    borderWidth: 1, borderColor: C.border, borderRadius: 10,
  },
  checkResetText: { color: C.text3, fontSize: 10, fontFamily: mono },

  creditsCard: {
    backgroundColor: C.s2, borderRadius: 20, borderWidth: 1, borderColor: C.border, padding: 16, gap: 12,
  },
  planSignupHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  planSignupIcon: {
    width: 42, height: 42, borderRadius: 14,
    backgroundColor: C.orangeGlow, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.orange + '55',
  },
  planSignupIconActive: { backgroundColor: C.orangeGlow, borderColor: C.orange + '44' },
  planSignupEyebrow: { color: C.orange, fontSize: 11, fontWeight: '800', marginBottom: 2 },
  planSignupTitle: { color: C.text, fontSize: 23, lineHeight: 27, fontWeight: '900' },
  planSignupText: { color: C.text2, fontSize: 13, lineHeight: 18, marginTop: 4 },
  planSignupList: { gap: 9 },
  planSignupPoint: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  planSignupPointText: { color: C.text2, fontSize: 13, flex: 1 },
  divider: { height: 1, backgroundColor: C.border },
  planActiveBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.orangeGlow, borderRadius: 10, borderWidth: 1, borderColor: C.orange + '44',
    paddingHorizontal: 12, paddingVertical: 10,
  },
  planActiveText: { color: C.orange, fontSize: 13, fontWeight: '700' },
  managePlanBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 6,
  },
  managePlanBtnText: { color: C.text3, fontSize: 12 },
  getPlanBtn: {
    backgroundColor: C.orange, borderRadius: 16, padding: 15,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    shadowColor: C.orange, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 8,
  },
  getPlanBtnLabel: { color: '#fff', fontSize: 16, fontWeight: '800' },
  getPlanBtnSub: { color: 'rgba(255,255,255,0.78)', fontSize: 12, marginTop: 2 },
  restoreRow: { alignItems: 'center', paddingVertical: 4 },
  restoreRowText: { color: C.text3, fontSize: 12 },
  creditMiniRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  creditMiniLabel: { color: C.text3, fontSize: 12 },
  creditMiniValue: { color: C.orange, fontSize: 14, fontWeight: '800' },
  historyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: C.border, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 9, alignSelf: 'flex-start',
  },
  historyBtnText: { color: C.text3, fontSize: 12 },

  historyCard: {
    backgroundColor: C.s2, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14,
  },
  sectionLabel: { color: C.text3, fontSize: 10, fontFamily: mono, letterSpacing: 1, marginBottom: 10 },
  sectionLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10 },
  emptyMiniCard: {
    borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.s3, padding: 12, gap: 4,
  },
  emptyMiniTitle: { color: C.text, fontSize: 13, fontWeight: '700' },
  emptyMiniSub: { color: C.text3, fontSize: 12, lineHeight: 17 },
  txRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 7, borderBottomWidth: 1, borderColor: C.border,
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
    borderColor: C.border,
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
  telemetryQaButton: {
    minHeight: 48, marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  telemetryQaButtonText: { fontSize: 14, fontWeight: '800' },

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
  weatherUnitsCard: {
    backgroundColor: C.s1, borderRadius: 14, borderWidth: 1, borderColor: C.border,
    padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  referralPrivacyCard: {
    minHeight: 76,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  referralPrivacyCopy: { flex: 1, minWidth: 0, gap: 3 },
  weatherUnitsSegment: {
    flexDirection: 'row', alignItems: 'center', padding: 3, borderRadius: 12,
    backgroundColor: C.s3, borderWidth: 1, borderColor: C.border,
  },
  weatherUnitsOption: {
    height: 30, minWidth: 42, paddingHorizontal: 10, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
  },
  weatherUnitsOptionActive: { backgroundColor: C.orange },
  weatherUnitsOptionText: { color: C.text3, fontSize: 10, fontFamily: mono, fontWeight: '800' },
  weatherUnitsOptionTextActive: { color: '#fff' },

  // My Trips section
  tripsCard: {
    backgroundColor: C.s2, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 14,
  },
  tripRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 9,
    borderBottomWidth: 1, borderColor: C.border,
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
