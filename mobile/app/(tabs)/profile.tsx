import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  TextInput, Alert, Share, Linking, ActivityIndicator, Image, Modal, Animated, Keyboard, Switch, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { storage } from '@/lib/storage';
import * as Updates from 'expo-updates';
import Constants from 'expo-constants';
import * as Application from 'expo-application';
import { api, ApiError, ContestStatus, ContributorProfile, SupportThread, TripResult } from '@/lib/api';
import { useStore, RigProfile, SavedPlace, TripHistoryItem } from '@/lib/store';
import PaywallModal from '@/components/PaywallModal';
import TourTarget from '@/components/TourTarget';
import ProfileLibraryOverview from '@/components/profile/ProfileLibraryOverview';
import { TrailheadButton, TrailheadCard, TrailheadMetricRow, TrailheadTopBar } from '@/components/TrailheadUI';
import { useSubscription } from '@/lib/useSubscription';
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
import {
  displayConsumptionToMpg,
  displayToMiles,
  milesToDisplay,
  mpgToDisplayConsumption,
  resolveUnitMode,
} from '@/lib/routeBuilder';

type AppleAuthModule = typeof import('expo-apple-authentication');
const AppleAuthentication: AppleAuthModule | null = (() => {
  try {
    return require('expo-apple-authentication') as AppleAuthModule;
  } catch {
    return null;
  }
})();

type ChecklistItem = { id: string; label: string; done: boolean };
type ChecklistSection = { title: string; icon: keyof typeof Ionicons.glyphMap; items: ChecklistItem[] };
type ExplorerPlanPoint = { icon: keyof typeof Ionicons.glyphMap; label: string };

const EXPLORER_PLAN_POINTS: ExplorerPlanPoint[] = [
  { icon: 'trail-sign-outline', label: 'Unlimited trip planner' },
  { icon: 'chatbubble-ellipses-outline', label: 'Map Co-Pilot' },
  { icon: 'bonfire-outline', label: 'Camp Briefs' },
  { icon: 'car-sport-outline', label: 'Voice and CarPlay' },
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

const AUTH_REQUEST_TIMEOUT_MS = 25_000;

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

const PROFILE_SECTIONS = [
  { id: 'account', label: 'Account', icon: 'person-circle-outline' },
  { id: 'booked', label: 'Booked', icon: 'ticket-outline' },
  { id: 'library', label: 'Library', icon: 'albums-outline' },
  { id: 'rig', label: 'Rig', icon: 'car-sport-outline' },
  { id: 'settings', label: 'Settings', icon: 'settings-outline' },
] as const;

type ProfileSectionId = typeof PROFILE_SECTIONS[number]['id'];

export default function ProfileScreen() {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const router = useRouter();
  const pathname = usePathname();
  const params = useLocalSearchParams<{ support?: string; support_thread_id?: string; auth?: string }>();
  const { user, rigProfile, setAuth, clearAuth, setRigProfile } = useStore();
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
  const [visibilitySaving, setVisibilitySaving] = useState(false);
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

  function clearCampCacheAdmin() {
    if (!user?.is_admin || adminClearingCampCache) return;
    Alert.alert('Clear camp cache?', 'This clears cached camp search/detail data so popular areas reload fresh source data.', [
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
    const authTarget = Array.isArray(params.auth) ? params.auth[0] : params.auth;
    if (authTarget !== 'register' && authTarget !== 'login') return;
    setProfileSection('account');
    setView(user ? 'main' : authTarget);
  }, [params.auth, user?.id]);

  useEffect(() => {
    if (!user) return;
    loadSupportInbox(false).catch(() => {});
  }, [user?.id]);

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
    const threadIdRaw = Array.isArray(params.support_thread_id) ? params.support_thread_id[0] : params.support_thread_id;
    const threadId = threadIdRaw ? parseInt(String(threadIdRaw), 10) : NaN;
    openSupportInbox(Number.isFinite(threadId) ? threadId : null).catch(() => {});
  }, [params.support, params.support_thread_id, user?.id]);

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

  // Load checklist from SecureStore on mount
  useEffect(() => {
    storage.get('trailhead_checklist').then(json => {
      if (json) setChecklist(JSON.parse(json));
    }).catch(() => {});
  }, []);

  const refreshOfflineTrips = useCallback(() => {
    getOfflineTripIndex().then(ids => {
      setOfflineCachedIds(new Set(ids));
    }).catch(() => {});
    getOfflineTripSummaries().then(setOfflineTripSummaries).catch(() => {});
  }, []);

  const refreshBookedTours = useCallback(() => {
    loadBookedTours()
      .then(tours => {
        setBookedTours(tours);
        setBookedToursLoaded(true);
      })
      .catch(() => {
        setBookedTours([]);
        setBookedToursLoaded(true);
      });
  }, []);

  // Load offline trip index to show cache badges
  useEffect(() => {
    refreshOfflineTrips();
    refreshBookedTours();
    loadGpxImportBatches().then(setGpxBatches).catch(() => {});
  }, [refreshBookedTours, refreshOfflineTrips]);

  useFocusEffect(useCallback(() => {
    refreshBookedTours();
  }, [refreshBookedTours]));

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
      await FileSystem.writeAsStringAsync(uri, ics);
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

  async function loadSupportInbox(openModal = false, preferredThreadId?: number | null) {
    if (!user) return;
    if (openModal) setShowSupportInbox(true);
    setSupportLoading(true);
    try {
      const inbox = await api.getSupportInbox();
      setSupportThreads(inbox.threads || []);
      setSupportUnreadCount(inbox.unread_count || 0);
      const nextThreadId = preferredThreadId
        ?? supportSelectedThreadId
        ?? inbox.threads?.[0]?.id
        ?? null;
      if (nextThreadId) {
        const detail = await api.getSupportThread(nextThreadId);
        setSupportThreads(prev => prev.map(thread => thread.id === detail.id ? detail : thread));
        setSupportSelectedThreadId(detail.id);
      } else {
        setSupportSelectedThreadId(null);
      }
    } catch (e: any) {
      if (openModal) Alert.alert('Inbox unavailable', e?.message ?? 'Could not load messages right now.');
    } finally {
      setSupportLoading(false);
    }
  }

  async function openSupportInbox(threadId?: number | null) {
    await loadSupportInbox(true, threadId ?? null);
  }

  async function openSupportThread(threadId: number) {
    setSupportSelectedThreadId(threadId);
    setSupportLoading(true);
    try {
      const detail = await api.getSupportThread(threadId);
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
      setSupportLoading(false);
    }
  }

  async function sendSupportReply() {
    const text = supportDraft.trim();
    if (!text || supportSending) return;
    setSupportSending(true);
    try {
      const selectedThread = supportThreads.find(thread => thread.id === supportSelectedThreadId) ?? null;
      const response = await api.sendSupportMessage({
        thread_id: selectedThread?.id,
        subject: selectedThread?.subject || 'Trailhead support',
        category: selectedThread?.category || 'support',
        body: text,
      });
      setSupportDraft('');
      await loadSupportInbox(true, response.thread_id);
    } catch (e: any) {
      Alert.alert('Message failed', e?.message ?? 'Could not send your message.');
    } finally {
      setSupportSending(false);
    }
  }

  async function login() {
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
    if (!identityToken) {
      Alert.alert('Sign in failed', `${provider === 'apple' ? 'Apple' : 'Google'} did not return a sign-in token.`);
      return;
    }
    Keyboard.dismiss();
    setLoading(true);
    try {
      const res = provider === 'apple'
        ? await api.oauthApple(identityToken, fullName, providerEmail)
        : await api.oauthGoogle(identityToken, fullName, providerEmail);
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
    Alert.alert('Google Sign In coming soon', 'Apple Sign In and email sign in are available now. Google needs the OAuth client IDs before it can be enabled.');
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
    if (creditHistoryLoaded) { setShowHistory(p => !p); return; }
    try {
      const res = await api.getCredits();
      setCreditHistory(Array.isArray(res.history) ? res.history : []);
      setCreditHistoryLoaded(true);
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
            refreshOfflineTrips();
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
      message: `Join me on Trailhead — the adventure planner for overlanders.\nUse my code ${user.referral_code} to sign up and we both earn credits.\nhttps://api.gettrailhead.app`,
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
      setContributorApplyResult('Application received. We will review it before field-check access is enabled.');
    } catch (e: any) {
      setContributorApplyResult(e?.message ?? 'Application failed. Please try again.');
    } finally {
      setContributorApplying(false);
    }
  }

  if (!pathname.includes('/profile')) return null;

  function renderVerificationPanel() {
    const target = pendingVerifyEmail || email.trim().toLowerCase();
    return (
      <ScrollView contentContainerStyle={s.authScroll} keyboardShouldPersistTaps="handled">
        <View style={s.authBrand}>
          <Image source={require('@/assets/icon.png')} style={s.authIcon} />
          <View>
            <Text style={s.authWordmark}>TRAILHEAD</Text>
            <Text style={s.authTagline}>OVERLAND PLANNER</Text>
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
                <Text style={s.authTagline}>OVERLAND PLANNER</Text>
              </View>
            </View>
            <Text style={s.authHeading}>Welcome back</Text>
            <Text style={s.authSub}>Sign in to save trips, downloads, reports, and Explorer.</Text>
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
              {false && (
                <TouchableOpacity style={s.socialAuthButton} onPress={signInWithGoogle} disabled={loading}>
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
            <Text style={s.authTagline}>OVERLAND PLANNER</Text>
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
                <Text style={s.authTagline}>OVERLAND PLANNER</Text>
              </View>
            </View>
            <Text style={s.authHeading}>Create account</Text>
            <View style={s.signupPerk}>
              <Ionicons name="flash" size={14} color={C.orange} />
              <Text style={s.signupPerkText}>Start with {CREDIT_REWARDS.signup} credits. Helpful reports can earn more.</Text>
            </View>
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
              {false && (
                <TouchableOpacity style={s.socialAuthButton} onPress={signInWithGoogle} disabled={loading}>
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
              <TextInput style={s.input} placeholder="Referral code (optional)" placeholderTextColor={C.text3}
                value={refCode} onChangeText={setRefCode} autoCapitalize="none" returnKeyType="done" onSubmitEditing={register} />
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
      <ScrollView contentContainerStyle={s.scroll}>

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
            <TouchableOpacity onPress={() => { clearAuth(); setView('login'); }}
              style={s.logoutBtn}>
              <Ionicons name="log-out-outline" size={20} color={C.text3} />
            </TouchableOpacity>
          </TrailheadCard>
        </TourTarget>

        <ScrollView
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
              >
                <Ionicons name={section.icon} size={15} color={active ? '#fff' : C.text3} />
                <Text style={[s.profileSectionChipText, active && s.profileSectionChipTextActive]}>{section.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {(() => {
          const actions = profileSection === 'account'
            ? [
                { icon: 'compass', label: 'PLAN TRIP', color: C.orange, onPress: () => { setActiveTrip(null); router.push('/(tabs)/plan' as any); } },
                { icon: 'mail-outline', label: 'INBOX', color: '#3b82f6', onPress: () => openSupportInbox() },
                { icon: 'help-buoy-outline', label: 'CONTACT', color: '#3b82f6', onPress: () => contactSupport('Trailhead question') },
                { icon: 'people', label: 'REFER', color: C.orange, onPress: shareReferral },
              ]
            : profileSection === 'booked'
              ? [
                  { icon: 'ticket-outline', label: 'TOURS', color: '#0f766e', onPress: () => router.push('/(tabs)/guide?view=explore' as any) },
                  { icon: 'map-outline', label: 'ROUTE', color: C.orange, onPress: () => router.push('/(tabs)/route-builder' as any) },
                  ...(upcomingBookedTour ? [{ icon: 'calendar-outline', label: 'CALENDAR', color: '#3b82f6', onPress: () => addBookedTourToCalendar(upcomingBookedTour) }] : []),
                ]
            : profileSection === 'library'
              ? [
                  { icon: 'compass', label: 'PLAN TRIP', color: C.orange, onPress: () => { setActiveTrip(null); router.push('/(tabs)/plan' as any); } },
                  { icon: 'map-outline', label: 'OPEN MAP', color: C.orange, onPress: () => router.push('/(tabs)/map') },
                  { icon: 'cloud-download-outline', label: 'DOWNLOADS', color: C.green, onPress: openOfflineMapsManager },
                ]
            : profileSection === 'rig'
              ? [
                  {
                    icon: 'car-sport-outline',
                    label: editingRig ? 'SAVE RIG' : rigProfile ? 'EDIT RIG' : 'ADD RIG',
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
                  { icon: 'checkmark-circle', label: 'TRIP PREP', color: C.green, onPress: () => setShowChecklist(true) },
                ]
              : [
                        { icon: 'options-outline', label: 'TRIP SETUP', color: '#14b8a6', onPress: startWelcomeSetup },
                        { icon: 'trail-sign-outline', label: 'WALKTHROUGH', color: '#d4af37', onPress: startWelcomePrompt },
                        { icon: 'mic-outline', label: 'TRIP AUDIO', color: '#3b82f6', onPress: () => router.push('/(tabs)/guide?view=narrations' as any) },
                        { icon: 'partly-sunny-outline', label: 'WEATHER', color: '#0ea5e9', onPress: () => router.push('/(tabs)/guide?view=weather' as any) },
                        { icon: 'alert-circle-outline', label: 'REPORT', color: C.red, onPress: () => setShowBugModal(true) },
                        ...(user?.is_admin ? [{ icon: 'refresh-circle-outline', label: adminClearingCampCache ? 'CLEARING' : 'CAMP CACHE', color: C.yellow, onPress: clearCampCacheAdmin }] : []),
                      ];
          return (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={s.quickActionsRow}
              contentContainerStyle={s.quickActionsContent}
            >
              {actions.map(({ icon, label, color, onPress }) => (
                <TouchableOpacity key={label} style={s.quickAction} onPress={onPress}>
                  <View style={[s.quickActionIcon, { borderColor: color + '44', backgroundColor: color + '18' }]}>
                    <Ionicons name={icon as any} size={22} color={color} />
                  </View>
                  <Text style={s.quickActionLabel}>{label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          );
        })()}

        {profileSection === 'booked' && (
          <View style={s.bookedScreen}>
            <View>
              <Text style={s.bookedScreenTitle}>Booked tours</Text>
              <Text style={s.bookedScreenSub}>Tickets and confirmed activities.</Text>
            </View>

            {!bookedToursLoaded ? (
              <TrailheadCard style={s.bookedEmptyCard}>
                <ActivityIndicator color={C.orange} />
              </TrailheadCard>
            ) : bookedTours.length > 0 ? (
              <>
                {bookedTours.map(renderBookedTourCard)}
                <View style={s.planAheadWrap}>
                  <Text style={s.planAheadTitle}>Plan ahead</Text>
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
        )}

        {profileSection === 'library' && (
          <ProfileLibraryOverview
            savedTripCount={tripHistory.length}
            offlineTripCount={offlineTripCount}
            offlineOnlyCount={offlineOnlyTrips.length}
            savedCampCount={favoriteCamps.length}
            savedPlaceCount={savedPlaces.length}
            importedRouteCount={importedRouteCount}
            importedPinCount={importedPinCount}
            onOpenDownloads={openOfflineMapsManager}
            onPlanTrip={() => { setActiveTrip(null); router.push('/(tabs)/plan' as any); }}
          />
        )}

        {profileSection === 'account' && (
        <TouchableOpacity style={s.supportCard} onPress={() => openSupportInbox()} activeOpacity={0.9}>
          <View style={s.supportCardTop}>
            <View style={s.supportCardIcon}>
              <Ionicons name="notifications-outline" size={18} color={C.orange} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.supportCardKicker}>NOTIFICATION BOARD</Text>
              <Text style={s.supportCardTitle}>Admin and customer service messages</Text>
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
              : 'Support replies, payout questions, contest follow-ups, and account messages will show up here.'}
          </Text>
          <View style={s.supportMetaRow}>
            <Text style={s.supportMetaText}>
              {supportThreads.length
                ? `${supportThreads.length} thread${supportThreads.length === 1 ? '' : 's'}`
                : 'Inbox ready'}
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
            <Ionicons name="checkmark-circle-outline" size={18} color={C.green} />
            <Text style={s.checklistTitle}>TRIP PREP</Text>
            <View style={s.checklistProgress}>
              {(() => {
                const total = checklist.reduce((n, s) => n + s.items.length, 0);
                const done  = checklist.reduce((n, s) => n + s.items.filter(i => i.done).length, 0);
                return (
                  <>
                    <Text style={[s.checklistProgressText, done === total && total > 0 && { color: C.green }]}>
                      {done === 0 ? 'Start prep' : `${done}/${total}`}
                    </Text>
                    {done > 0 && done < total && (
                      <View style={s.checklistBar}>
                        <View style={[s.checklistFill, { width: `${(done / total) * 100}%` as any }]} />
                      </View>
                    )}
                    {done === total && <Text style={{ color: C.green, fontSize: 12 }}>Done</Text>}
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
        <View style={s.creditsCard}>
          <View style={s.planSignupHeader}>
            <View style={[s.planSignupIcon, hasPlan && s.planSignupIconActive]}>
              <Ionicons name={hasPlan ? 'shield-checkmark' : 'compass-outline'} size={21} color={hasPlan ? C.green : C.orange} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.planSignupEyebrow}>Explorer</Text>
              <Text style={s.planSignupTitle}>{hasPlan ? 'Explorer active' : 'Plan better trips'}</Text>
              <Text style={s.planSignupText}>
                {hasPlan
                  ? 'Unlimited planning, Camp Briefs, Co-Pilot, and voice tools are ready.'
                  : 'Unlimited planning, Camp Briefs, Co-Pilot, packing lists, tour deals, and voice tools.'}
              </Text>
            </View>
          </View>

          {hasPlan ? (
            <>
              <View style={s.planActiveBanner}>
                <Ionicons name="checkmark-circle" size={16} color="#22c55e" />
                <Text style={s.planActiveText}>Active</Text>
              </View>
              <TouchableOpacity style={s.managePlanBtn} onPress={() => Linking.openURL('https://apps.apple.com/account/subscriptions')}>
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

        <Modal visible={showSupportInbox} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowSupportInbox(false)}>
          <SafeAreaView style={s.contestModal}>
            <TrailheadTopBar
              title="INBOX"
              subtitle="Support and admin messages"
              icon="mail-outline"
              style={s.contestModalHeader}
              right={(
                <TouchableOpacity style={s.contestClose} onPress={() => setShowSupportInbox(false)}>
                  <Ionicons name="close" size={20} color={C.text} />
                </TouchableOpacity>
              )}
            />
            {supportLoading && !supportThreads.length ? (
              <View style={s.contestLoading}>
                <ActivityIndicator color={C.orange} />
                <Text style={s.contestMuted}>Loading your message board...</Text>
              </View>
            ) : (
              <ScrollView contentContainerStyle={s.contestScroll}>
                <TrailheadCard style={s.supportModalCard}>
                  <Text style={s.sectionLabel}>THREADS</Text>
                  {(supportThreads || []).length ? supportThreads.map(thread => (
                    <TouchableOpacity key={thread.id} style={[s.supportThreadRow, selectedSupportThread?.id === thread.id && s.supportThreadRowActive]} onPress={() => openSupportThread(thread.id)}>
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
                      </View>
                    )) : (
                      <Text style={s.contestMuted}>Start a thread here for customer service, account help, or winner payout details.</Text>
                    )}
                  </View>
                  <TextInput
                    style={s.supportComposer}
                    placeholder={selectedSupportThread ? 'Reply to this thread…' : 'Write a message to Trailhead support…'}
                    placeholderTextColor={C.text3}
                    value={supportDraft}
                    onChangeText={setSupportDraft}
                    multiline
                    maxLength={1200}
                    textAlignVertical="top"
                  />
                  <TrailheadButton
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
        {profileSection === 'settings' && (
        <TouchableOpacity style={s.bugCard} onPress={() => setShowBugModal(true)}>
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
          <SafeAreaView style={s.contestModal}>
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
          <SafeAreaView style={s.contestModal}>
            <TrailheadTopBar
              title="TRAILHEAD"
              subtitle="Contributor Contest"
              icon="trophy-outline"
              style={s.contestModalHeader}
              right={(
                <TouchableOpacity style={s.contestClose} onPress={() => setShowContest(false)}>
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
                </TrailheadCard>

                <View style={s.contestPrizeGrid}>
                  {[
                    ['$1,000', 'New Year winner', 'Top total contest points for the calendar year.'],
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
                </TrailheadCard>

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
                    <Text style={s.contestRuleLine}>Rules are loading.</Text>
                  )}
                </TrailheadCard>
              </ScrollView>
            )}
          </SafeAreaView>
        </Modal>

        {/* Contributions */}
        {profileSection === 'account' && (
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
        )}

        {/* Contest */}
        {profileSection === 'account' && (
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
        )}

        {/* Referral */}
        {profileSection === 'account' && (
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
            [CREDIT_REWARDS.referral, 'Refer a friend who signs up'],
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
        </View>
        )}
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

  profileSectionNav: { marginHorizontal: -14 },
  profileSectionNavContent: { paddingHorizontal: 14, gap: 8 },
  profileSectionChip: {
    height: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s2,
  },
  profileSectionChipActive: { backgroundColor: C.orange, borderColor: C.orange },
  profileSectionChipText: { color: C.text3, fontSize: 10, fontFamily: mono, fontWeight: '800' },
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
  quickAction: { alignItems: 'center', gap: 6, width: 70 },
  quickActionIcon: {
    width: 54, height: 54, borderRadius: 20,
    borderWidth: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.s2,
  },
  quickActionLabel: { color: C.text3, fontSize: 8.5, fontFamily: mono, letterSpacing: 0.5, textAlign: 'center' },
  bookedScreen: { gap: 14 },
  bookedScreenTitle: { color: C.text, fontSize: 30, lineHeight: 35, fontWeight: '900', letterSpacing: 0 },
  bookedScreenSub: { color: C.text3, fontSize: 13, lineHeight: 18, marginTop: 3 },
  bookedTourCard: {
    backgroundColor: C.s2,
    borderRadius: 18,
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
  planAheadWrap: { gap: 10, marginTop: 4 },
  planAheadTitle: { color: C.text, fontSize: 25, lineHeight: 30, fontWeight: '900', letterSpacing: 0 },
  planAheadCard: {
    backgroundColor: C.s2,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    overflow: 'hidden',
  },
  planAheadRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  planAheadIcon: { width: 34, alignItems: 'center' },
  planAheadText: { flex: 1, color: C.text, fontSize: 17, lineHeight: 22, fontWeight: '900' },
  bookedEmptyCard: {
    backgroundColor: C.s2,
    borderRadius: 20,
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
  supportCardTitle: { color: C.text, fontSize: 16, fontWeight: '900', marginTop: 2 },
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
  supportComposer: { minHeight: 96, borderRadius: 16, borderWidth: 1, borderColor: C.border, backgroundColor: C.s3, color: C.text, padding: 12, fontSize: 14 },

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
    backgroundColor: C.s2, borderRadius: 20, borderWidth: 1, borderColor: C.border, padding: 16, gap: 12,
  },
  planSignupHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  planSignupIcon: {
    width: 42, height: 42, borderRadius: 14,
    backgroundColor: C.orangeGlow, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.orange + '55',
  },
  planSignupIconActive: { backgroundColor: C.green + '18', borderColor: C.green + '55' },
  planSignupEyebrow: { color: C.orange, fontSize: 11, fontWeight: '800', marginBottom: 2 },
  planSignupTitle: { color: C.text, fontSize: 23, lineHeight: 27, fontWeight: '900' },
  planSignupText: { color: C.text2, fontSize: 13, lineHeight: 18, marginTop: 4 },
  planSignupList: { gap: 9 },
  planSignupPoint: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  planSignupPointText: { color: C.text2, fontSize: 13, flex: 1 },
  divider: { height: 1, backgroundColor: C.border },
  planActiveBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.green + '18', borderRadius: 10, borderWidth: 1, borderColor: C.green + '44',
    paddingHorizontal: 12, paddingVertical: 10,
  },
  planActiveText: { color: C.green, fontSize: 13, fontWeight: '700' },
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
