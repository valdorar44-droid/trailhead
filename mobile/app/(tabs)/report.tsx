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
import { TrailheadButton, TrailheadCard, TrailheadCardSkeleton, TrailheadLoadingRow, TrailheadSheet, TrailheadTopBar } from '@/components/TrailheadUI';
import { api, Report, ReportPayload, ContributorLeader, ContributorProfile, ContributionPeriod } from '@/lib/api';
import { useStore } from '@/lib/store';
import { useTheme, mono, ColorPalette } from '@/lib/design';
import { CREDIT_REWARDS } from '@/lib/credits';
import { trackPhase0Once } from '@/lib/telemetry';
import Reanimated, { FadeInDown, ZoomIn } from 'react-native-reanimated';

// ── Alert notification helpers ────────────────────────────────────────────────
// Seen IDs: { [reportId]: expiresAt (unix sec) } — auto-prune on load
async function loadSeenAlertIds(): Promise<Record<string, number>> {
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
async function saveSeenAlertIds(seen: Record<string, number>): Promise<void> {
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
  { type: 'road_condition', label: 'ROAD', icon: 'trail-sign-outline', color: '#f97316', ttl: '7d',
    subtypes: ['Washout', 'Mud', 'Snow / ice', 'High clearance needed', '4WD needed', 'Shelf road', 'Deep sand', 'Low bridge'] },
  { type: 'road_closure', label: 'CLOSED', icon: 'remove-circle-outline', color: '#ef4444', ttl: '30d',
    subtypes: ['Road closed', 'Gate closed', 'Construction', 'Ferry / bridge issue', 'Seasonal closure', 'Now open'] },
  { type: 'campsite', label: 'CAMP', icon: 'bonfire-outline', color: '#14b8a6', ttl: '14d',
    subtypes: ['Camp full', 'Camp closed', 'Fee changed', 'Water unavailable', 'Toilet / trash issue', 'Noisy / unsafe', 'Access road issue', 'Reservation issue'] },
  { type: 'trail_condition', label: 'TRAIL', icon: 'walk-outline', color: '#22c55e', ttl: '7d',
    subtypes: ['Trail closed', 'Washed out', 'Downed trees', 'Snow', 'Muddy', 'Crowded', 'Wildlife', 'Water crossing', 'Parking full', 'Access restriction'] },
  { type: 'weather', label: 'WEATHER', icon: 'thunderstorm-outline', color: '#6DA8FF', ttl: '12h',
    subtypes: ['Flash flood', 'Avalanche / slope', 'Heat', 'High wind', 'Winter storm', 'Severe storm'] },
  { type: 'fire', label: 'FIRE', icon: 'flame-outline', color: '#ef4444', ttl: '14d',
    subtypes: ['Active wildfire', 'Fire closure', 'Evacuation', 'Fire restriction', 'Smoke visible'] },
  { type: 'smoke', label: 'SMOKE', icon: 'cloud-outline', color: '#a78bfa', ttl: '12h',
    subtypes: ['Unhealthy AQI', 'Heavy smoke', 'Low visibility', 'Sensitive groups', 'Clearing'] },
  { type: 'water', label: 'WATER', icon: 'water-outline', color: '#38bdf8', ttl: '3d',
    subtypes: ['Water source dry', 'Flowing well', 'Unsafe water', 'Algae bloom', 'Filter required', 'Flooded crossing'] },
  { type: 'fuel', label: 'FUEL', icon: 'flash-outline', color: '#eab308', ttl: '12h',
    subtypes: ['Fuel unavailable', 'Diesel available', 'Gas available', 'Propane unavailable', 'Price info', 'Payment issue'] },
  { type: 'service', label: 'SERVICE', icon: 'construct-outline', color: '#94a3b8', ttl: '30d',
    subtypes: ['Dump closed', 'Water fill closed', 'Repair / tire service', 'Medical', 'Wifi good', 'Cell bad', 'Auto parts'] },
  { type: 'cell_signal', label: 'SIGNAL', icon: 'cellular-outline', color: '#22c55e', ttl: '1d',
    subtypes: ['Strong signal', 'Weak signal', 'No signal', 'Starlink only'] },
  { type: 'wildlife', label: 'WILDLIFE', icon: 'paw-outline', color: '#a78bfa', ttl: '1d',
    subtypes: ['Bear activity', 'Mountain lion', 'Elk / deer', 'Snake', 'Cool sighting'] },
  { type: 'hazard', label: 'HAZARD', icon: 'warning-outline', color: '#ef4444', ttl: '7d',
    subtypes: ['Rockfall', 'Downed tree', 'Unsafe pullout', 'Debris', 'Sketchy area'] },
  { type: 'traffic', label: 'TRAFFIC', icon: 'car-outline', color: '#38bdf8', ttl: '6h',
    subtypes: ['Crash', 'Congestion', 'Lane closed', 'Disabled vehicle', 'Delay'] },
  { type: 'viewpoint', label: 'VIEW', icon: 'flag-outline', color: '#38bdf8', ttl: '90d',
    subtypes: ['Epic vista', 'Sunrise spot', 'Sunset spot', 'Photo opportunity', 'Hidden gem'] },
  { type: 'closure', label: 'ACCESS', icon: 'lock-closed-outline', color: '#ef4444', ttl: '30d',
    subtypes: ['Gate locked', 'Area closed', 'Permit issue', 'Seasonal', 'Fire closure'] },
  { type: 'police', label: 'PATROL', icon: 'shield-outline', color: '#f59e0b', ttl: '2h',
    subtypes: ['Ranger patrol', 'Fee checkpoint', 'OHV enforcement', 'Fire restriction'] },
];

const SEVERITY = [
  { val: 'low',      label: 'FYI',      color: '#22c55e' },
  { val: 'moderate', label: 'HEADS UP', color: '#f59e0b' },
  { val: 'high',     label: 'CAUTION',  color: '#f97316' },
  { val: 'critical', label: 'AVOID',    color: '#ef4444' },
];

const PHOTO_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.gettrailhead.app';
const OFFLINE_REPORT_QUEUE_KEY = 'trailhead_report_queue_v1';

type TabView = 'route' | 'camp' | 'nearby' | 'submit' | 'leaderboard';
type SourceConfidence = 'observed' | 'reported';
type QueuedReport = {
  id: string;
  payload: ReportPayload;
  label: string;
  created_at: number;
  had_photo: boolean;
};

function tripWaypointsForConditions(activeTrip: ReturnType<typeof useStore.getState>['activeTrip']) {
  return activeTrip?.plan.waypoints.filter(wp => wp.lat != null && wp.lng != null) ?? [];
}

function distanceMiBetween(a: { lat?: number | null; lng?: number | null }, b: { lat: number; lng: number }) {
  const dLat = ((a.lat ?? 0) - b.lat) * Math.PI / 180;
  const dLng = ((a.lng ?? 0) - b.lng) * Math.PI / 180;
  const lat1 = (a.lat ?? 0) * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

function isOvernightWaypoint(type: string | null | undefined) {
  return ['camp', 'motel', 'town'].includes(String(type || '').toLowerCase());
}

async function loadQueuedReports(): Promise<QueuedReport[]> {
  try {
    const raw = await storage.get(OFFLINE_REPORT_QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(item => item?.payload?.lat != null && item?.payload?.lng != null) : [];
  } catch {
    return [];
  }
}

async function saveQueuedReports(items: QueuedReport[]) {
  try {
    await storage.set(OFFLINE_REPORT_QUEUE_KEY, JSON.stringify(items.slice(-20)));
  } catch {}
}

function isOfflineSubmitError(error: any) {
  const message = String(error?.message || error || '').toLowerCase();
  return !message || /network|offline|failed to fetch|timeout|connection|temporarily unavailable/.test(message);
}

function sourceConfidenceCopy(source: SourceConfidence) {
  return source === 'observed' ? 'Source: firsthand observation.' : 'Source: reported by another traveler or local staff.';
}

function reportDescriptionWithSource(description: string, source: SourceConfidence) {
  const note = sourceConfidenceCopy(source);
  const trimmed = description.trim();
  return trimmed ? `${note} ${trimmed}` : note;
}

function ttlHoursForType(type: string) {
  const ttl = REPORT_TYPES.find(rt => rt.type === type)?.ttl ?? '7d';
  const match = ttl.match(/^(\d+)([hd])$/);
  if (!match) return 7 * 24;
  const value = Number(match[1]);
  return match[2] === 'd' ? value * 24 : value;
}

function formatReportDuration(hours: number | null) {
  if (hours == null) return '';
  if (hours <= 0) return 'now';
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const rem = hours % 24;
  return rem > 0 ? `${days}d ${rem}h` : `${days}d`;
}

function reportAgeLabel(createdAt?: number) {
  if (!createdAt) return 'age unknown';
  const minutes = Math.max(0, Math.floor((Date.now() / 1000 - createdAt) / 60));
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  return `${formatReportDuration(Math.floor(minutes / 60))} ago`;
}

function reportExpiresLabel(expiresAt?: number | null) {
  if (!expiresAt) return '';
  const hours = Math.max(0, Math.floor((expiresAt - Date.now() / 1000) / 3600));
  return `expires ${formatReportDuration(hours)}`;
}

function reportTrustLabel(r: Report) {
  if (r.source === 'provider') {
    const confidence = typeof r.confidence === 'number' ? ` · ${Math.round(r.confidence * 100)}%` : '';
    return `Provider signal${confidence}`;
  }
  if ((r.downvotes ?? 0) >= 3) return 'Needs review';
  if ((r.confirmations ?? 0) > 0) return `${r.confirmations} still-there check${r.confirmations === 1 ? '' : 's'}`;
  if (r.has_photo) return 'Photo evidence';
  return 'New community report';
}

function sourceLabelForReport(r: Report) {
  if (r.source === 'provider') return conditionSourceLabel(r);
  if (/source:\s*reported/i.test(r.description || '')) return 'Heard report';
  if (/source:\s*firsthand/i.test(r.description || '')) return 'Firsthand';
  return r.username ? `@${r.username}` : 'Community';
}

function displayReportDescription(description?: string | null) {
  return String(description || '')
    .replace(/^source:\s*firsthand observation\.\s*/i, '')
    .replace(/^source:\s*reported by another traveler or local staff\.\s*/i, '')
    .trim();
}

function tonightAnchorForTrip(
  activeTrip: ReturnType<typeof useStore.getState>['activeTrip'],
  loc: { lat: number; lng: number } | null,
) {
  const orderedWaypoints = (activeTrip?.plan.waypoints ?? [])
    .filter(wp => wp.lat != null && wp.lng != null)
    .map((wp, index) => ({ wp, index }));
  const overnights = orderedWaypoints.filter(({ wp }) => isOvernightWaypoint(wp.type));
  if (overnights.length === 0) return null;
  if (!loc) return overnights[0].wp;

  let nearestRoutePoint = orderedWaypoints[0];
  let nearestRouteDistance = Infinity;
  for (const candidate of orderedWaypoints) {
    const dist = distanceMiBetween(candidate.wp, loc);
    if (dist < nearestRouteDistance) {
      nearestRouteDistance = dist;
      nearestRoutePoint = candidate;
    }
  }

  if (nearestRouteDistance > 35) {
    return overnights
      .slice()
      .sort((a, b) => distanceMiBetween(a.wp, loc) - distanceMiBetween(b.wp, loc))[0]?.wp ?? overnights[0].wp;
  }

  const upcomingByOrder = overnights.find(({ index }) => index >= nearestRoutePoint.index);
  if (upcomingByOrder) return upcomingByOrder.wp;

  const currentDay = nearestRoutePoint.wp.day ?? 0;
  const upcomingByDay = overnights.find(({ wp }) => (wp.day ?? 0) >= currentDay);
  if (upcomingByDay) return upcomingByDay.wp;

  return overnights[overnights.length - 1].wp;
}

export default function ReportScreen() {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const { user, setAuth, addLiveReport } = useStore();
  const activeTrip = useStore(st => st.activeTrip);
  const [loc, setLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedType, setSelectedType] = useState<typeof REPORT_TYPES[0] | null>(null);
  const [selectedSubtype, setSelectedSubtype] = useState('');
  const [severity, setSeverity] = useState('moderate');
  const [sourceConfidence, setSourceConfidence] = useState<SourceConfidence>('observed');
  const [description, setDescription] = useState('');
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [creditsGained, setCreditsGained] = useState(0);
  const [queuedReports, setQueuedReports] = useState<QueuedReport[]>([]);
  const [queueFlushing, setQueueFlushing] = useState(false);
  const [nearby, setNearby] = useState<Report[]>([]);
  const [routeReports, setRouteReports] = useState<Report[]>([]);
  const [campReports, setCampReports] = useState<Report[]>([]);
  const [routeLoading, setRouteLoading] = useState(false);
  const [campLoading, setCampLoading] = useState(false);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [topUsers, setTopUsers] = useState<ContributorLeader[]>([]);
  const [topPeriod, setTopPeriod] = useState<ContributionPeriod>('month');
  const [selectedContributor, setSelectedContributor] = useState<ContributorProfile | null>(null);
  const [contributorLoading, setContributorLoading] = useState(false);
  const [view, setView] = useState<TabView>('route');
  const [notifPrefs, setNotifPrefs] = useState<Record<string, boolean>>({});
  const [showNotifSettings, setShowNotifSettings] = useState(false);

  const [detailReport, setDetailReport] = useState<Report | null>(null);
  const [drivingWarning, setDrivingWarning] = useState(false);
  const [campsiteRating, setCampsiteRating] = useState(0);
  const successAnim = useRef(new Animated.Value(0)).current;
  const typeAnims = useRef(REPORT_TYPES.map(() => new Animated.Value(1))).current;
  const routeWaypoints = useMemo(() => tripWaypointsForConditions(activeTrip), [activeTrip?.trip_id, activeTrip?.updated_at]);
  const tonightAnchor = useMemo(() => tonightAnchorForTrip(activeTrip, loc), [activeTrip?.trip_id, activeTrip?.updated_at, loc?.lat, loc?.lng]);
  // Refs so async callbacks always read latest values without stale closures
  const seenIdsRef = useRef<Record<string, number>>({});
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
    const fresh = critical.filter(r => !seen[String(r.id)] && prefs[r.type] !== false);
    if (fresh.length === 0) return;

    const typeInfo = REPORT_TYPES.find(t => t.type === fresh[0].type);
    const title = fresh.length === 1
      ? `${typeInfo?.label ?? 'Alert'} Nearby`
      : `${fresh.length} Trail Alerts Nearby`;
    const body = fresh.length === 1
      ? (fresh[0].description || `Critical ${typeInfo?.label ?? fresh[0].type} within 0.5 mi`)
      : `${fresh.length} critical conditions within 0.5 mi of you`;

    Notifications.scheduleNotificationAsync({
      content: { title, body, data: { type: 'trail_alert' } },
      trigger: null,
    }).catch(() => {});

    const updated = { ...seen };
    for (const r of fresh) {
      updated[String(r.id)] = r.expires_at || (Date.now() / 1000 + 86400);
    }
    seenIdsRef.current = updated;
    saveSeenAlertIds(updated);
  }

  async function refreshQueuedReports() {
    const items = await loadQueuedReports();
    setQueuedReports(items);
    return items;
  }

  async function queueReportForRetry(payload: ReportPayload, label: string, hadPhoto: boolean) {
    const queuedPayload = { ...payload, photo_data: undefined };
    const item: QueuedReport = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      payload: queuedPayload,
      label,
      created_at: Date.now() / 1000,
      had_photo: hadPhoto,
    };
    const next = [...await loadQueuedReports(), item].slice(-20);
    await saveQueuedReports(next);
    setQueuedReports(next);
  }

  async function flushQueuedReports(showResult = false) {
    if (!user || queueFlushing) return;
    const items = await loadQueuedReports();
    if (items.length === 0) {
      setQueuedReports([]);
      if (showResult) Alert.alert('Queue empty', 'No saved reports are waiting.');
      return;
    }
    setQueueFlushing(true);
    let sent = 0;
    let dropped = 0;
    let remaining: QueuedReport[] = [];
    try {
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        try {
          const res = await api.submitReport(item.payload);
          sent += 1;
          addLiveReport({
            id: res.report_id,
            lat: item.payload.lat,
            lng: item.payload.lng,
            type: item.payload.type,
            subtype: item.payload.subtype ?? '',
            description: item.payload.description ?? '',
            severity: item.payload.severity ?? 'moderate',
            upvotes: 0,
            downvotes: 0,
            confirmations: 0,
            has_photo: 0,
            cluster_count: 1,
            username: user?.username ?? 'me',
            created_at: Date.now() / 1000,
            expires_at: Date.now() / 1000 + res.ttl_hours * 3600,
          });
        } catch (e: any) {
          if (isOfflineSubmitError(e)) {
            remaining = [item, ...items.slice(i + 1)];
            break;
          }
          dropped += 1;
        }
      }
      await saveQueuedReports(remaining);
      setQueuedReports(remaining);
      if (locRef.current && sent > 0) {
        api.getNearbyAlerts(locRef.current.lat, locRef.current.lng).then(setNearby).catch(() => {});
      }
      if (showResult) {
        const parts = [
          sent ? `${sent} sent` : '',
          remaining.length ? `${remaining.length} still waiting` : '',
          dropped ? `${dropped} dropped` : '',
        ].filter(Boolean);
        Alert.alert('Offline queue', parts.join(' · ') || 'No changes.');
      }
    } finally {
      setQueueFlushing(false);
    }
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
          setNearbyLoading(true);
          api.getNearbyAlerts(c.lat, c.lng).then(reports => {
            setNearby(reports);
            checkAndNotify(reports);
          }).catch(() => {}).finally(() => setNearbyLoading(false));
        })
        .catch(() => {}); // prevent unhandled rejection crash
    }).catch(() => {});

    api.getContributionsLeaderboard('month').then(res => setTopUsers(res.leaders)).catch(() => {});
  }, []);

  useEffect(() => {
    refreshQueuedReports().then(items => {
      if (user && items.length > 0) flushQueuedReports(false);
    });
  }, [user?.id]);

  useEffect(() => {
    if (view === 'route' && routeWaypoints.length === 0) setView('nearby');
  }, [routeWaypoints.length, view]);

  useEffect(() => {
    if (view !== 'leaderboard') return;
    api.getContributionsLeaderboard(topPeriod).then(res => setTopUsers(res.leaders)).catch(() => {});
  }, [view, topPeriod]);

  // Refresh route alerts each time user opens the route tab
  useEffect(() => {
    if (view !== 'route' || routeWaypoints.length === 0) return;
    setRouteLoading(true);
    api.getAlertsAlongRoute(routeWaypoints).then(reports => {
      setRouteReports(reports);
      checkAndNotify(reports);
    }).catch(() => {
      setRouteReports([]);
    }).finally(() => setRouteLoading(false));
  }, [routeWaypoints, view]);

  // Refresh tonight camp context each time user opens the tonight tab
  useEffect(() => {
    if (view !== 'camp' || !tonightAnchor?.lat || !tonightAnchor?.lng) return;
    setCampLoading(true);
    api.getNearbyAlerts(tonightAnchor.lat, tonightAnchor.lng, 8).then(reports => {
      setCampReports(reports);
      checkAndNotify(reports);
    }).catch(() => {
      setCampReports([]);
    }).finally(() => setCampLoading(false));
  }, [tonightAnchor?.day, tonightAnchor?.lat, tonightAnchor?.lng, view]);

  // Refresh nearby reports each time user opens the nearby tab
  useEffect(() => {
    if (view !== 'nearby') return;
    const c = locRef.current;
    if (!c) return;
    setNearbyLoading(true);
    api.getNearbyAlerts(c.lat, c.lng).then(reports => {
      setNearby(reports);
      checkAndNotify(reports);
    }).catch(() => {}).finally(() => setNearbyLoading(false));
  }, [view]);

  useEffect(() => {
    if (view !== 'nearby' || !loc || nearby.length > 0) return;
    const latBucket = loc.lat.toFixed(2);
    const lngBucket = loc.lng.toFixed(2);
    trackPhase0Once(`phase0:report-empty:${latBucket}:${lngBucket}`, 'phase0_empty_state_seen', {
      surface: 'report_nearby',
      lat_bucket: latBucket,
      lng_bucket: lngBucket,
    });
  }, [loc, nearby.length, view]);

  async function openContributor(userId: number) {
    setContributorLoading(true);
    try {
      setSelectedContributor(await api.getContributorProfile(userId));
    } catch (e: any) {
      Alert.alert('Profile unavailable', e?.message ?? 'This contributor profile is private.');
    } finally {
      setContributorLoading(false);
    }
  }

  async function toggleNotifPref(type: string, enabled: boolean) {
    const updated = { ...notifPrefsRef.current, [type]: enabled };
    setNotifPrefs(updated);
    notifPrefsRef.current = updated;
    saveAlertPrefs(updated);
  }

  function patchReport(reportId: Report['id'], updater: (report: Report) => Report) {
    const apply = (items: Report[]) => items.map(item => item.id === reportId ? updater(item) : item);
    setRouteReports(apply);
    setCampReports(apply);
    setNearby(apply);
    setDetailReport(current => current?.id === reportId ? updater(current) : current);
  }

  async function handleStillThere(report: Report) {
    if (report.source === 'provider' || typeof report.id !== 'number') return;
    try {
      const res = await api.confirmReport(report.id);
      const ttlHours = ttlHoursForType(report.type);
      patchReport(report.id, item => ({
        ...item,
        confirmations: (item.confirmations ?? 0) + 1,
        expires_at: Date.now() / 1000 + ttlHours * 3600,
      }));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert('Still there', `+${res.credits_earned} credit earned`);
    } catch (e: any) {
      Alert.alert('Could not confirm', e?.message ?? 'Try again when you have signal.');
    }
  }

  async function handleUpvote(report: Report) {
    if (report.source === 'provider' || typeof report.id !== 'number') return;
    try {
      await api.upvoteReport(report.id);
      patchReport(report.id, item => ({ ...item, upvotes: (item.upvotes ?? 0) + 1 }));
    } catch {}
  }

  function handleNotThere(report: Report) {
    if (report.source === 'provider' || typeof report.id !== 'number') return;
    Alert.alert('Mark not there?', 'This helps hide stale or inaccurate reports.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Not there',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.downvoteReport(report.id as number);
            patchReport(report.id, item => ({ ...item, downvotes: (item.downvotes ?? 0) + 1 }));
          } catch (e: any) {
            Alert.alert('Could not mark it', e?.message ?? 'Try again when you have signal.');
          }
        },
      },
    ]);
  }

  function distanceLabelForReport(report: Report, mode: 'route' | 'camp' | 'nearby') {
    const point = { lat: report.lat, lng: report.lng };
    let target: { lat?: number | null; lng?: number | null } | null = null;
    let suffix = 'away';
    if (mode === 'nearby') {
      target = loc;
      suffix = 'from you';
    } else if (mode === 'camp') {
      target = tonightAnchor;
      suffix = 'from camp';
    } else if (routeWaypoints.length > 0) {
      target = routeWaypoints
        .slice()
        .sort((a, b) => distanceMiBetween(a, point) - distanceMiBetween(b, point))[0];
      suffix = 'from route';
    }
    if (!target?.lat || !target?.lng) return '';
    const miles = distanceMiBetween(target, point);
    const label = miles < 0.1 ? '<0.1 mi' : miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
    return `${label} ${suffix}`;
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
    const reportLabel = selectedSubtype || selectedType.label;
    const descriptionWithSource = reportDescriptionWithSource(description, sourceConfidence);
    try {
      const fullDesc = (campsiteRating > 0 && selectedType.type === 'campsite')
        ? `${campsiteRating}/5 stars. ${descriptionWithSource}`
        : descriptionWithSource;
      const payload: ReportPayload = {
        lat: loc.lat, lng: loc.lng,
        type: selectedType.type, subtype: selectedSubtype,
        description: fullDesc, severity,
        photo_data: photoBase64 ?? undefined,
      };
      const res = await api.submitReport(payload);
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
        setDescription(''); setPhotoBase64(null); setSourceConfidence('observed');
      }, 3000);
      api.me().then(async u => setAuth(await getToken(), u)).catch(() => {});
      if (loc) api.getNearbyAlerts(loc.lat, loc.lng).then(setNearby).catch(() => {});
    } catch (e: any) {
      const fullDesc = (campsiteRating > 0 && selectedType.type === 'campsite')
        ? `${campsiteRating}/5 stars. ${descriptionWithSource}`
        : descriptionWithSource;
      const payload: ReportPayload = {
        lat: loc.lat, lng: loc.lng,
        type: selectedType.type, subtype: selectedSubtype,
        description: fullDesc, severity,
      };
      if (isOfflineSubmitError(e)) {
        await queueReportForRetry(payload, reportLabel, Boolean(photoBase64));
        Alert.alert(
          'Saved for retry',
          photoBase64
            ? 'The report was queued without the photo and will retry when the app has signal.'
            : 'The report will retry when the app has signal.',
        );
      } else {
        Alert.alert('Error', e.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function renderConditionsFeed(
    mode: 'route' | 'camp' | 'nearby',
    reports: Report[],
    options: {
      title: string;
      kicker: string;
      subtitle: string;
      countLabel: string;
      loading?: boolean;
      emptyTitle: string;
      emptySub: string;
      primaryActionLabel: string;
      primaryAction: () => void;
    },
  ) {
    return (
      <ScrollView contentContainerStyle={s.scroll}>
        <View style={s.nearbyHero}>
          <View style={{ flex: 1 }}>
            <Text style={s.nearbyKicker}>{options.kicker}</Text>
            <Text style={s.nearbyTitle}>{options.title}</Text>
            <Text style={s.nearbySubtitle}>{options.subtitle}</Text>
          </View>
          <View style={s.nearbyCount}>
            <Text style={s.nearbyCountNum}>{options.loading ? '…' : reports.length}</Text>
            <Text style={s.nearbyCountLabel}>{options.countLabel}</Text>
          </View>
        </View>

        <TouchableOpacity style={s.notifSettingsBtn} onPress={() => setShowNotifSettings(true)}>
          <View style={s.notifSettingsIcon}>
            <Ionicons name="notifications-outline" size={14} color={C.orange} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.notifSettingsBtnText}>Critical alert settings</Text>
            <Text style={s.notifSettingsSub}>Choose which warnings can notify you while you travel.</Text>
          </View>
          <Ionicons name="chevron-forward" size={13} color={C.text3} />
        </TouchableOpacity>

        <TouchableOpacity style={s.notifSettingsBtn} onPress={() => setView('leaderboard')}>
          <View style={s.notifSettingsIcon}>
            <Ionicons name="trophy-outline" size={14} color={C.orange} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.notifSettingsBtnText}>Community standings</Text>
            <Text style={s.notifSettingsSub}>Leaderboard moved out of the main report flow, but it is still here.</Text>
          </View>
          <Ionicons name="chevron-forward" size={13} color={C.text3} />
        </TouchableOpacity>

        {options.loading && reports.length === 0 ? (
          <View style={s.feedLoadingBlock}>
            <TrailheadLoadingRow
              label={mode === 'route' ? 'Checking route context' : mode === 'camp' ? 'Checking tonight’s stop' : 'Loading nearby options'}
              sub={mode === 'route' ? 'Ranking reports that affect the active route.' : mode === 'camp' ? 'Looking for current reports near the overnight area.' : 'Checking recent field reports around you.'}
              icon={mode === 'camp' ? 'bonfire-outline' : mode === 'route' ? 'trail-sign-outline' : 'location-outline'}
            />
            <TrailheadCardSkeleton lines={3} />
            <TrailheadCardSkeleton lines={3} />
          </View>
        ) : !options.loading && reports.length === 0 ? (
          <View style={s.emptyWrap}>
            <View style={s.emptyIconWrap}>
              <Ionicons name={mode === 'route' ? 'trail-sign-outline' : mode === 'camp' ? 'bonfire-outline' : 'location-outline'} size={30} color={C.text3} />
            </View>
            <Text style={s.emptyText}>{options.emptyTitle}</Text>
            <Text style={s.emptySub}>{options.emptySub}</Text>
            <TouchableOpacity style={s.emptyAction} onPress={options.primaryAction}>
              <Ionicons name={mode === 'nearby' ? 'add-circle-outline' : 'compass-outline'} size={14} color={C.orange} />
              <Text style={s.emptyActionText}>{options.primaryActionLabel}</Text>
            </TouchableOpacity>
          </View>
        ) : reports.map(r => (
          <ReportCard key={`${mode}-${r.id}`} report={r}
            distanceLabel={distanceLabelForReport(r, mode)}
            onPress={() => setDetailReport(r)}
            onUpvote={() => handleUpvote(r)}
            onDownvote={() => handleNotThere(r)}
            onConfirm={() => handleStillThere(r)}
            onReportMore={() => setView('submit')}
            onAdminDelete={user?.is_admin ? () => Alert.alert('Delete Report', 'Permanently remove this report?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => typeof r.id === 'number' && api.adminDeleteReport(r.id).then(() => {
                const drop = (items: Report[]) => items.filter(x => x.id !== r.id);
                if (mode === 'route') setRouteReports(prev => drop(prev));
                else if (mode === 'camp') setCampReports(prev => drop(prev));
                else setNearby(prev => drop(prev));
              }).catch(() => {}) },
            ]) : undefined}
            onAdminRemovePhoto={user?.is_admin ? () => typeof r.id === 'number' && api.adminRemovePhoto(r.id).then(() => {
              const strip = (items: Report[]) => items.map(x => x.id === r.id ? { ...x, has_photo: 0 } : x);
              if (mode === 'route') setRouteReports(prev => strip(prev));
              else if (mode === 'camp') setCampReports(prev => strip(prev));
              else setNearby(prev => strip(prev));
            }).catch(() => {}) : undefined}
          />
        ))}
      </ScrollView>
    );
  }

  return (
    <SafeAreaView style={s.container}>
      {/* Driving safety modal */}
      <Modal visible={drivingWarning} transparent animationType="fade" statusBarTranslucent>
        <View style={s.drivingOverlay}>
          <TrailheadSheet handle={false} style={s.drivingModal}>
            <Ionicons name="car-outline" size={46} color={C.orange} style={{ marginBottom: 4 }} />
            <Text style={s.drivingTitle}>YOU APPEAR TO BE MOVING</Text>
            <Text style={s.drivingBody}>
              Never use your phone while driving. Pull over safely before submitting a trail report.
            </Text>
            <TrailheadButton label="I'm Parked / Stopped" variant="primary" onPress={() => setDrivingWarning(false)} style={{ alignSelf: 'stretch' }} />
            <TrailheadButton label="I'm a Passenger" variant="secondary" onPress={() => setDrivingWarning(false)} style={{ alignSelf: 'stretch' }} />
          </TrailheadSheet>
        </View>
      </Modal>

      {/* Header */}
      <TrailheadTopBar
        title="FIELD REPORTS"
        subtitle="Warn the trail community"
        icon="warning-outline"
        style={s.header}
        right={user ? (
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
        ) : null}
      />

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
        {([
          ['route', 'ROUTE'],
          ['camp', 'TONIGHT'],
          ['nearby', 'NEAR ME'],
          ['submit', 'SUBMIT'],
        ] as const).map(([t, label]) => (
          <TouchableOpacity key={t} style={[s.tab, view === t && s.tabActive]} onPress={() => setView(t)}>
            <Text style={[s.tabText, view === t && s.tabTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {view === 'submit' && (
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <TrailheadCard style={s.reportHero}>
            <View style={s.reportHeroIcon}>
              <Ionicons name="radio-outline" size={19} color={C.orange} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.reportHeroTitle}>What changed out here?</Text>
              <Text style={s.reportHeroText}>Pick one condition, add useful details, and help the next rig make a better call.</Text>
            </View>
          </TrailheadCard>
          <TrailheadCard style={s.safetyBanner}>
            <Ionicons name="car-outline" size={13} color={C.orange} />
            <Text style={s.safetyText}>Pull over before posting. Reports use your current location.</Text>
          </TrailheadCard>
          {queuedReports.length > 0 && (
            <TrailheadCard style={s.queueBanner}>
              <View style={s.queueIcon}>
                <Ionicons name="cloud-upload-outline" size={17} color={C.orange} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.queueTitle}>{queuedReports.length} report{queuedReports.length === 1 ? '' : 's'} waiting</Text>
                <Text style={s.queueText} numberOfLines={2}>
                  Saved reports retry when you have signal. Photos stay live-only.
                </Text>
              </View>
              <TouchableOpacity style={s.queueRetry} onPress={() => flushQueuedReports(true)} disabled={queueFlushing}>
                <Text style={s.queueRetryText}>{queueFlushing ? 'SENDING' : 'RETRY'}</Text>
              </TouchableOpacity>
            </TrailheadCard>
          )}
          <Text style={s.sectionLabel}>TYPE</Text>
          <TourTarget id="report.types">
            <View style={s.typeGrid}>
              {REPORT_TYPES.map((rt, idx) => {
                const active = selectedType?.type === rt.type;
                return (
                  <Animated.View key={rt.type} style={{ transform: [{ scale: typeAnims[idx] }], width: '31.5%' }}>
                    <TouchableOpacity
                      style={[s.typeBtn, active && { borderColor: rt.color, backgroundColor: rt.color + '18' }]}
                      onPress={() => selectType(rt, idx)}
                    >
                      <View style={[s.typeAccent, { backgroundColor: rt.color }]} />
                      <View style={[s.typeIconWrap, { backgroundColor: rt.color + '16' }, active && { backgroundColor: rt.color + '26' }]}>
                        <Ionicons name={rt.icon as any} size={21} color={active ? rt.color : C.text3} />
                      </View>
                      <Text style={[s.typeLabel, active && { color: rt.color }]}>{rt.label}</Text>
                      <Text style={[s.typeTtl, active && { color: rt.color + 'cc' }]}>{rt.ttl} active</Text>
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

              <Text style={s.sectionLabel}>SOURCE</Text>
              <View style={s.sourceConfidenceRow}>
                {([
                  ['observed', 'I saw this', 'Best confidence'],
                  ['reported', 'I heard this', 'Needs follow-up'],
                ] as const).map(([value, label, sub]) => {
                  const active = sourceConfidence === value;
                  return (
                    <TouchableOpacity
                      key={value}
                      style={[s.sourceConfidenceBtn, active && { borderColor: selectedType.color, backgroundColor: selectedType.color + '16' }]}
                      onPress={() => setSourceConfidence(value)}
                    >
                      <Ionicons name={value === 'observed' ? 'eye-outline' : 'chatbubble-ellipses-outline'} size={16} color={active ? selectedType.color : C.text3} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[s.sourceConfidenceText, active && { color: selectedType.color }]}>{label}</Text>
                        <Text style={s.sourceConfidenceSub}>{sub}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
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
                        <Ionicons
                          name={star <= campsiteRating ? 'star' : 'star-outline'}
                          size={30}
                          color={star <= campsiteRating ? C.yellow : C.border}
                        />
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

      {view === 'route' && (
        routeWaypoints.length > 0
          ? renderConditionsFeed('route', routeReports, {
              title: 'Reports on my route',
              kicker: 'ROUTE CONTEXT',
              subtitle: activeTrip?.plan.trip_name || 'Active route',
              countLabel: 'ON ROUTE',
              loading: routeLoading,
              emptyTitle: 'No active route reports',
              emptySub: 'Your saved route is clear right now. If you hit a closure, washed road, or fuel issue, post it from Submit.',
              primaryActionLabel: 'SUBMIT REPORT',
              primaryAction: () => setView('submit'),
            })
          : (
            <ScrollView contentContainerStyle={s.scroll}>
              <View style={s.emptyWrap}>
                <View style={s.emptyIconWrap}>
                  <Ionicons name="trail-sign-outline" size={30} color={C.text3} />
                </View>
                <Text style={s.emptyText}>No active route yet</Text>
                <Text style={s.emptySub}>Build or open a trip first, then Report can show what affects the route instead of just what is nearby.</Text>
                <TouchableOpacity style={s.emptyAction} onPress={() => setView('nearby')}>
                  <Ionicons name="locate-outline" size={14} color={C.orange} />
                  <Text style={s.emptyActionText}>USE NEAR ME</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          )
      )}

      {view === 'camp' && (
        tonightAnchor?.lat && tonightAnchor?.lng
          ? renderConditionsFeed('camp', campReports, {
              title: tonightAnchor.camp_window_label || `Night ${tonightAnchor.day || 1} stop`,
              kicker: 'TONIGHT',
              subtitle: tonightAnchor.name || 'Camp area',
              countLabel: 'NEAR CAMP',
              loading: campLoading,
              emptyTitle: 'No active reports near camp tonight',
              emptySub: 'This stop looks quiet. If the camp is full, trashed, closed, or sketchy, add the update before the next rig rolls in.',
              primaryActionLabel: 'ADD CAMP REPORT',
              primaryAction: () => {
                setSelectedType(REPORT_TYPES.find(rt => rt.type === 'campsite') ?? null);
                setView('submit');
              },
            })
          : (
            <ScrollView contentContainerStyle={s.scroll}>
              <View style={s.emptyWrap}>
                <View style={s.emptyIconWrap}>
                  <Ionicons name="bonfire-outline" size={30} color={C.text3} />
                </View>
                <Text style={s.emptyText}>No camp stop selected yet</Text>
                <Text style={s.emptySub}>Once your trip has an overnight stop, this view will focus on what matters around tonight’s camp.</Text>
                <TouchableOpacity style={s.emptyAction} onPress={() => setView('route')}>
                  <Ionicons name="trail-sign-outline" size={14} color={C.orange} />
                  <Text style={s.emptyActionText}>VIEW ROUTE</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          )
      )}

      {view === 'nearby' && renderConditionsFeed('nearby', nearby, {
        title: 'Nearby trail reports',
        kicker: 'NEAR ME',
        subtitle: 'Local conditions around your current position',
        countLabel: 'ACTIVE',
        loading: nearbyLoading,
        emptyTitle: 'No active reports nearby',
        emptySub: 'This area looks quiet. If you spot a closure, washed road, full camp, or fuel issue, add the first report.',
        primaryActionLabel: 'ADD REPORT',
        primaryAction: () => setView('submit'),
      })}

      {view === 'leaderboard' && (
        <ScrollView contentContainerStyle={s.scroll}>
          <View style={s.contributorHero}>
            <View style={s.contributorHeroTop}>
              <View>
                <Text style={s.sectionLabel}>COMMUNITY STANDINGS</Text>
                <Text style={s.contributorTitle}>Top Contributors</Text>
              </View>
              <Reanimated.View entering={ZoomIn.springify()} style={s.contributorTrophy}>
                <Ionicons name="trophy" size={24} color="#f8d77a" />
              </Reanimated.View>
            </View>
            <Text style={s.contributorHeroText}>Points come from useful reports, trail notes, camp updates, confirmations, and contest activity.</Text>
            <View style={s.periodRow}>
              {([
                ['month', 'MONTH'],
                ['year', 'YEAR'],
                ['all', 'ALL-TIME'],
              ] as const).map(([period, label]) => (
                <TouchableOpacity
                  key={period}
                  style={[s.periodBtn, topPeriod === period && s.periodBtnActive]}
                  onPress={() => setTopPeriod(period)}
                >
                  <Text style={[s.periodText, topPeriod === period && s.periodTextActive]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {topUsers.length === 0 ? (
            <View style={s.emptyWrap}>
              <Ionicons name="trophy-outline" size={42} color={C.text3} />
              <Text style={s.emptyText}>No contribution points yet</Text>
              <Text style={s.emptySub}>Useful reports and field updates will rank here.</Text>
            </View>
          ) : (
            <>
              <View style={s.podiumRow}>
                {topUsers.slice(0, 3).map((entry, i) => (
                  <TouchableOpacity
                    key={`podium-${entry.user_id}`}
                    style={[s.podiumCard, i === 0 && s.podiumGold]}
                    onPress={() => openContributor(entry.user_id)}
                    activeOpacity={0.9}
                  >
                    <Text style={s.podiumRank}>#{entry.rank_number}</Text>
                    <View style={[s.podiumAvatar, { backgroundColor: entry.avatar_color }]}>
                      <Text style={s.podiumInitial}>{entry.display_name?.[0]?.toUpperCase() ?? '?'}</Text>
                    </View>
                    <Text style={s.podiumName} numberOfLines={1}>{entry.display_name}</Text>
                    <Text style={s.podiumPoints}>{entry.points_for_period.toLocaleString()}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {topUsers.map((entry, i) => (
                <Reanimated.View key={entry.user_id} entering={FadeInDown.delay(Math.min(i * 40, 300))}>
                  <TouchableOpacity
                    style={[s.leaderRow, i === 0 && s.leaderGold]}
                    onPress={() => openContributor(entry.user_id)}
                    activeOpacity={0.88}
                  >
                    <Text style={s.leaderRank}>#{entry.rank_number}</Text>
                    <View style={[s.leaderAvatar, { backgroundColor: entry.avatar_color }]}>
                      <Text style={s.leaderAvatarText}>{entry.display_name?.[0]?.toUpperCase() ?? '?'}</Text>
                    </View>
                    <View style={s.leaderInfo}>
                      <View style={s.leaderNameRow}>
                        <Text style={s.leaderName}>{entry.display_name}</Text>
                        {entry.is_self && <View style={s.youBadge}><Text style={s.youText}>YOU</Text></View>}
                      </View>
                      <Text style={s.leaderMeta}>
                        {entry.title} · {entry.event_count} actions{entry.streak > 1 ? ` · ${entry.streak}d streak` : ''}
                      </Text>
                      <View style={s.badgeRow}>
                        {entry.badges.slice(0, 3).map(b => (
                          <View key={`${entry.user_id}-${b.id}`} style={s.miniBadge}>
                            <Text style={s.miniBadgeText}>{b.label}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                    <View style={s.leaderPointsBox}>
                      <Text style={s.leaderPoints}>{entry.points_for_period.toLocaleString()}</Text>
                      <Text style={s.leaderPointsLabel}>PTS</Text>
                    </View>
                  </TouchableOpacity>
                </Reanimated.View>
              ))}
            </>
          )}
        </ScrollView>
      )}
      {/* Report detail modal */}
      {detailReport && (
        <ReportDetailModal
          report={detailReport}
          distanceLabel={distanceLabelForReport(detailReport, view === 'leaderboard' || view === 'submit' ? 'nearby' : view)}
          onClose={() => setDetailReport(null)}
          onUpvote={() => handleUpvote(detailReport)}
          onDownvote={() => handleNotThere(detailReport)}
          onConfirm={() => handleStillThere(detailReport)}
          onReportMore={() => {
            setDetailReport(null);
            setView('submit');
          }}
        />
      )}
      {selectedContributor && (
        <ContributorProfileModal
          profile={selectedContributor}
          loading={contributorLoading}
          onClose={() => setSelectedContributor(null)}
        />
      )}
    </SafeAreaView>
  );
}

async function getToken() {
  return (await storage.get('trailhead_token')) ?? '';
}

function ContributorProfileModal({ profile, onClose }:
  { profile: ContributorProfile; loading: boolean; onClose: () => void }) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const badgeIcon = (icon: string) => {
    const map: Record<string, keyof typeof Ionicons.glyphMap> = {
      trophy: 'trophy-outline', ribbon: 'ribbon-outline', medal: 'medal-outline',
      camera: 'camera-outline', map: 'map-outline', radio: 'radio-outline',
      bonfire: 'bonfire-outline', sparkles: 'sparkles-outline', 'trail-sign': 'trail-sign-outline',
    };
    return map[icon] ?? 'ribbon-outline';
  };
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.contribModal}>
        <View style={s.contribHeader}>
          <TouchableOpacity style={s.contribClose} onPress={onClose}>
            <Ionicons name="close" size={22} color={C.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.contribKicker}>CONTRIBUTOR PROFILE</Text>
            <Text style={s.contribHeaderTitle}>{profile.display_name}</Text>
          </View>
        </View>
        <ScrollView contentContainerStyle={s.contribScroll}>
          <View style={s.contribHeroCard}>
            <View style={[s.contribAvatar, { backgroundColor: profile.avatar_color }]}>
              <Text style={s.contribAvatarText}>{profile.display_name?.[0]?.toUpperCase() ?? '?'}</Text>
            </View>
            <Text style={s.contribName}>{profile.display_name}</Text>
            <Text style={s.contribTitle}>{profile.title}</Text>
            <View style={s.contribStatsGrid}>
              <View style={s.contribStat}><Text style={s.contribStatValue}>{profile.points.month.toLocaleString()}</Text><Text style={s.contribStatLabel}>MONTH</Text></View>
              <View style={s.contribStat}><Text style={s.contribStatValue}>{profile.points.year.toLocaleString()}</Text><Text style={s.contribStatLabel}>YEAR</Text></View>
              <View style={s.contribStat}><Text style={s.contribStatValue}>{profile.points.all.toLocaleString()}</Text><Text style={s.contribStatLabel}>ALL TIME</Text></View>
            </View>
            <View style={s.tierBarOuter}><View style={[s.tierBarInner, { width: `${Math.round((profile.tier.progress ?? 0) * 100)}%` }]} /></View>
            <Text style={s.contribMuted}>
              {profile.tier.next_label ? `${profile.tier.next_label} at ${profile.tier.next_points?.toLocaleString()} points` : 'Top tier unlocked'}
            </Text>
          </View>

          <View style={s.contribSection}>
            <Text style={s.contribSectionTitle}>Badges</Text>
            <View style={s.contribBadgeGrid}>
              {profile.badges.length ? profile.badges.map(badge => (
                <View key={badge.id} style={s.contribBadge}>
                  <Ionicons name={badgeIcon(badge.icon)} size={18} color="#f8d77a" />
                  <Text style={s.contribBadgeTitle}>{badge.label}</Text>
                  <Text style={s.contribBadgeText}>{badge.description}</Text>
                </View>
              )) : <Text style={s.contribMuted}>Badges unlock as contributions grow.</Text>}
            </View>
          </View>

          <View style={s.contribSection}>
            <Text style={s.contribSectionTitle}>Field Impact</Text>
            {[
              ['Camp reports', profile.stats.camp_reports],
              ['Trail reports', profile.stats.trail_reports],
              ['Photos', profile.stats.photos],
              ['Confirmations', profile.stats.confirmations],
            ].map(([label, value]) => (
              <View key={label} style={s.contribActivityRow}>
                <Text style={s.contribActivityLabel}>{label}</Text>
                <Text style={s.contribActivityValue}>{Number(value).toLocaleString()}</Text>
              </View>
            ))}
          </View>

          {profile.awards.length > 0 && (
            <View style={s.contribSection}>
              <Text style={s.contribSectionTitle}>Winnings</Text>
              {profile.awards.map(award => (
                <View key={award.id} style={s.contribActivityRow}>
                  <Text style={s.contribActivityLabel}>{award.prize_label}</Text>
                  <Text style={s.contribActivityValue}>{award.status.toUpperCase()}</Text>
                </View>
              ))}
            </View>
          )}
          <Text style={s.contribPrivacy}>Public profiles hide exact report places and private account details.</Text>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function conditionSourceLabel(r: Report): string {
  const provider = String(r.provider ?? '').toLowerCase();
  if (provider === 'tomtom') return 'LIVE TRAFFIC · TOMTOM';
  if (provider === 'nws') return 'WEATHER ALERT · NWS';
  if (provider === 'airnow') return 'AIR QUALITY · AIRNOW';
  if (provider === 'wfigs') return 'WILDFIRE · WFIGS';
  if (provider === 'firms') return 'FIRE DETECTION · NASA FIRMS';
  return `LIVE CONDITION · ${(r.provider ?? 'provider').toUpperCase()}`;
}

function ReportCard({ report: r, distanceLabel, onPress, onUpvote, onDownvote, onConfirm, onReportMore, onAdminDelete, onAdminRemovePhoto }:
  { report: Report; distanceLabel?: string; onPress: () => void; onUpvote: () => void; onDownvote: () => void; onConfirm: () => void; onReportMore: () => void;
    onAdminDelete?: () => void; onAdminRemovePhoto?: () => void; }) {
  const C = useTheme();
  const rc = useMemo(() => makeRcStyles(C), [C]);
  if (!r || r.id == null) return null; // guard against malformed API data
  const typeInfo = REPORT_TYPES.find(t => t.type === r.type);
  const sevInfo = SEVERITY.find(sv => sv.val === r.severity);
  const isProvider = r.source === 'provider';
  const sourceLabel = sourceLabelForReport(r);
  const age = reportAgeLabel(r.created_at);
  const expires = reportExpiresLabel(r.expires_at);
  const trust = reportTrustLabel(r);
  const description = displayReportDescription(r.description);
  const metaParts = [sourceLabel, distanceLabel, age, expires, trust, r.has_photo ? 'photo' : ''].filter(Boolean);

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
          return (
            <View style={[rc.iconWrap, { backgroundColor: (typeInfo?.color ?? '#f97316') + '18' }]}>
              <Ionicons name={icon as any} size={18} color={typeInfo?.color ?? '#f97316'} />
            </View>
          );
        })()}
        <View style={rc.meta}>
          <Text style={rc.type}>{typeInfo?.label ?? r.type}</Text>
          {!!r.subtype && <Text style={rc.subtype}>{r.subtype}</Text>}
          {isProvider && (
            <Text style={rc.provider}>
              {conditionSourceLabel(r)}{r.road_name ? ` · ${r.road_name}` : ''}
            </Text>
          )}
        </View>
        {sevInfo && (
          <View style={[rc.sevPill, { backgroundColor: sevInfo.color + '22', borderColor: sevInfo.color }]}>
            <Text style={[rc.sevText, { color: sevInfo.color }]}>{sevInfo.label}</Text>
          </View>
        )}
      </View>
      {description ? <Text style={rc.desc}>{description}</Text> : null}
      <View style={rc.signalRow}>
        <Ionicons name={isProvider ? 'radio-outline' : 'shield-checkmark-outline'} size={13} color={isProvider ? '#38bdf8' : C.text3} />
        <Text style={rc.signalText} numberOfLines={2}>{metaParts.join(' · ')}</Text>
      </View>
      <View style={rc.footer}>
        {!isProvider ? <View style={rc.actions}>
          <TouchableOpacity style={rc.confirmBtn} onPress={onConfirm}>
            <Ionicons name="checkmark-circle-outline" size={15} color={C.green} />
            <Text style={[rc.actionText, { color: C.green }]}>Still there</Text>
          </TouchableOpacity>
          <TouchableOpacity style={rc.notThereBtn} onPress={onDownvote}>
            <Ionicons name="close-circle-outline" size={15} color={C.red} />
            <Text style={[rc.actionText, { color: C.red }]}>Not there</Text>
          </TouchableOpacity>
          <TouchableOpacity style={rc.voteBtn} onPress={onUpvote}>
            <Ionicons name="thumbs-up-outline" size={13} color={C.text3} />
            <Text style={rc.voteCount}>{r.upvotes}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={rc.reportMoreBtn} onPress={onReportMore}>
            <Ionicons name="add-circle-outline" size={15} color={C.orange} />
            <Text style={[rc.actionText, { color: C.orange }]}>Report more</Text>
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
        </View> : (
          <View style={rc.providerPill}><Text style={rc.providerPillText}>READ ONLY</Text></View>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ── Report detail modal ────────────────────────────────────────────────────────
function ReportDetailModal({ report: r, distanceLabel, onClose, onUpvote, onDownvote, onConfirm, onReportMore }:
  { report: Report; distanceLabel?: string; onClose: () => void; onUpvote: () => void; onDownvote: () => void; onConfirm: () => void; onReportMore: () => void }) {
  const C = useTheme();
  const dm = useMemo(() => makeDmStyles(C), [C]);
  const typeInfo = REPORT_TYPES.find(t => t.type === r.type);
  const sevInfo = SEVERITY.find(sv => sv.val === r.severity);
  const isProvider = r.source === 'provider';
  const sourceLabel = sourceLabelForReport(r);
  const age = reportAgeLabel(r.created_at);
  const expires = reportExpiresLabel(r.expires_at);
  const trust = reportTrustLabel(r);
  const description = displayReportDescription(r.description);
  const photoUri = !isProvider && r.has_photo ? `${PHOTO_BASE}/api/reports/${r.id}/photo` : null;

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
                return <Ionicons name={icon as any} size={30} color={typeInfo?.color ?? '#f97316'} />;
              })()}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={dm.typeLabel}>{typeInfo?.label ?? r.type}</Text>
              {r.subtype ? <Text style={dm.subtype}>{r.subtype}</Text> : null}
              {isProvider ? <Text style={dm.provider}>{conditionSourceLabel(r)}</Text> : null}
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
          {description ? (
            <View style={dm.descBox}>
              <Text style={dm.descText}>{description}</Text>
            </View>
          ) : null}

          {/* Meta */}
          <View style={dm.metaBox}>
            <View style={dm.metaRow}>
              <Ionicons name={isProvider ? "radio-outline" : "person-circle-outline"} size={16} color={C.text3} />
              <Text style={dm.metaText}>{isProvider ? sourceLabel : `@${r.username}`}</Text>
            </View>
            {distanceLabel ? (
              <View style={dm.metaRow}>
                <Ionicons name="navigate-outline" size={16} color={C.text3} />
                <Text style={dm.metaText}>{distanceLabel}</Text>
              </View>
            ) : null}
            {r.road_name ? (
              <View style={dm.metaRow}>
                <Ionicons name="map-outline" size={16} color={C.text3} />
                <Text style={dm.metaText}>{r.road_name}</Text>
              </View>
            ) : null}
            <View style={dm.metaRow}>
              <Ionicons name="time-outline" size={16} color={C.text3} />
              <Text style={dm.metaText}>{age}</Text>
            </View>
            {expires ? (
              <View style={dm.metaRow}>
                <Ionicons name="hourglass-outline" size={16} color={C.text3} />
                <Text style={dm.metaText}>{expires}</Text>
              </View>
            ) : null}
            <View style={dm.metaRow}>
              <Ionicons name="shield-checkmark-outline" size={16} color={C.text3} />
              <Text style={dm.metaText}>{trust}</Text>
            </View>
            {!isProvider && r.confirmations > 0 ? (
              <View style={dm.metaRow}>
                <Ionicons name="checkmark-done-circle-outline" size={16} color={C.green} />
                <Text style={[dm.metaText, { color: C.green }]}>{r.confirmations} confirmation{r.confirmations !== 1 ? 's' : ''}</Text>
              </View>
            ) : null}
          </View>

          {/* Actions */}
          {!isProvider ? <View style={dm.actionsRow}>
            <TouchableOpacity style={dm.confirmBtn} onPress={onConfirm}>
              <Ionicons name="checkmark-circle-outline" size={18} color={C.green} />
              <Text style={[dm.btnText, { color: C.green }]}>STILL THERE</Text>
            </TouchableOpacity>
            <TouchableOpacity style={dm.notThereBtn} onPress={onDownvote}>
              <Ionicons name="close-circle-outline" size={18} color={C.red} />
              <Text style={[dm.btnText, { color: C.red }]}>NOT THERE</Text>
            </TouchableOpacity>
            <TouchableOpacity style={dm.voteBtn} onPress={onUpvote}>
              <Ionicons name="thumbs-up-outline" size={18} color={C.text2} />
              <Text style={dm.voteTxt}>{r.upvotes}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={dm.reportMoreBtn} onPress={onReportMore}>
              <Ionicons name="add-circle-outline" size={18} color={C.orange} />
              <Text style={[dm.btnText, { color: C.orange }]}>MORE</Text>
            </TouchableOpacity>
          </View> : null}
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
  provider: { color: '#38bdf8', fontSize: 10, marginTop: 5, fontFamily: mono, fontWeight: '800' },
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
  notThereBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: C.red + '12', borderWidth: 1, borderColor: C.red + '88',
    borderRadius: 12, paddingVertical: 13,
  },
  voteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: C.s2, borderWidth: 1, borderColor: C.border,
    borderRadius: 12, paddingVertical: 13, paddingHorizontal: 18,
  },
  reportMoreBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: C.orange + '12', borderWidth: 1, borderColor: C.orange + '66',
    borderRadius: 12, paddingVertical: 13, paddingHorizontal: 14,
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
  iconWrap: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  meta: { flex: 1 },
  type: { color: C.text, fontWeight: '700', fontSize: 13 },
  subtype: { color: C.text2, fontSize: 11, marginTop: 1 },
  provider: { color: '#38bdf8', fontSize: 9, marginTop: 3, fontFamily: mono, fontWeight: '800' },
  sevPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, borderWidth: 1 },
  sevText: { fontSize: 9, fontFamily: mono, fontWeight: '700', letterSpacing: 0.5 },
  desc: { color: C.text2, fontSize: 12, lineHeight: 17, marginBottom: 10 },
  signalRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 10 },
  signalText: { flex: 1, color: C.text3, fontSize: 10, lineHeight: 14, fontFamily: mono, fontWeight: '700' },
  footer: { gap: 8 },
  age: { color: C.text3, fontSize: 10, fontFamily: mono },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  providerPill: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: '#38bdf855', backgroundColor: '#38bdf814', alignSelf: 'flex-start' },
  providerPillText: { color: '#38bdf8', fontSize: 9, fontFamily: mono, fontWeight: '800' },
  confirmBtn: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 10, paddingHorizontal: 8, backgroundColor: C.green + '12' },
  notThereBtn: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 10, paddingHorizontal: 8, backgroundColor: C.red + '10' },
  reportMoreBtn: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 10, paddingHorizontal: 8, backgroundColor: C.orange + '10' },
  actionText: { fontSize: 11, fontWeight: '700' },
  voteBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  voteCount: { color: C.text3, fontSize: 12, fontWeight: '600', fontFamily: mono },
});

const makeStyles = (C: ColorPalette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderColor: C.border, backgroundColor: C.glassStrong,
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
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderColor: C.border, backgroundColor: C.glass },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: C.orange },
  tabText: { color: C.text3, fontSize: 10, fontFamily: mono, fontWeight: '700', letterSpacing: 0.5 },
  tabTextActive: { color: C.orange },
  scroll: { padding: 16, gap: 12, paddingBottom: 112 },
  reportHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 18,
    backgroundColor: C.s2,
    padding: 14,
  },
  reportHeroIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.orange + '44',
    backgroundColor: C.orange + '12',
  },
  reportHeroTitle: { color: C.text, fontSize: 18, lineHeight: 22, fontWeight: '900' },
  reportHeroText: { color: C.text3, fontSize: 12, lineHeight: 17, marginTop: 3 },
  sectionLabel: { color: C.text3, fontSize: 10, fontFamily: mono, letterSpacing: 1, marginBottom: 8 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  typeBtn: {
    backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16, padding: 10, alignItems: 'flex-start', gap: 7, minHeight: 108,
    overflow: 'hidden',
  },
  typeAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, opacity: 0.82 },
  typeIconWrap: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.055)' },
  typeLabel: { color: C.text2, fontSize: 10, fontFamily: mono, fontWeight: '900' },
  typeTtl: { color: C.text3, fontSize: 8, fontFamily: mono },
  chipRow: { gap: 8, paddingBottom: 4, marginBottom: 16 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 7,
    backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 999,
  },
  chipText: { color: C.text2, fontSize: 12 },
  severityRow: { flexDirection: 'row', gap: 6, marginBottom: 16 },
  sevBtn: {
    flex: 1, paddingVertical: 9, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)',
  },
  sevText: { color: C.text3, fontSize: 10, fontFamily: mono, fontWeight: '700' },
  sourceConfidenceRow: { flexDirection: 'row', gap: 9, marginBottom: 16 },
  sourceConfidenceBtn: {
    flex: 1,
    minHeight: 58,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s2,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sourceConfidenceText: { color: C.text2, fontSize: 12, fontWeight: '900' },
  sourceConfidenceSub: { color: C.text3, fontSize: 10, marginTop: 2 },
  photoSection: { marginBottom: 4 },
  bonusBadge: {
    color: C.green, fontSize: 9, fontFamily: mono,
    backgroundColor: C.green + '20',
  },
  photoRow: { flexDirection: 'row', gap: 8, marginBottom: 16, alignItems: 'center' },
  photoBtn: {
    backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16, padding: 14, alignItems: 'center', gap: 5, flex: 1,
  },
  photoBtnText: { color: C.text3, fontSize: 10, fontFamily: mono },
  thumbWrap: { width: 64, height: 64, position: 'relative' },
  thumbImg: { width: 64, height: 64, borderRadius: 10 },
  removeBtn: { position: 'absolute', top: -8, right: -8 },
  notes: {
    backgroundColor: 'rgba(255,255,255,0.055)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16, padding: 12, color: C.text, fontSize: 13,
    minHeight: 70, marginBottom: 12,
  },
  earnRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.orangeGlow, borderRadius: 8, padding: 10, marginBottom: 16,
  },
  earnText: { color: C.orange, fontSize: 12, fontFamily: mono },
  submitBtn: {
    backgroundColor: C.bg === '#050505' ? C.silverBright : C.orange, borderRadius: 16, padding: 16, alignItems: 'center',
    shadowColor: C.orange, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.16, shadowRadius: 18,
  },
  submitBtnDisabled: { backgroundColor: C.s3, shadowOpacity: 0 },
  submitBtnText: { color: C.bg === '#050505' ? '#050505' : '#fff', fontWeight: '900', fontSize: 12, fontFamily: mono, letterSpacing: 0.8 },
  // Driving safety
  drivingOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  drivingModal: {
    backgroundColor: 'rgba(255,255,255,0.055)', borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)',
    padding: 28, alignItems: 'center', gap: 12, width: '100%', maxWidth: 360,
  },
  drivingIcon: { fontSize: 48, marginBottom: 4 },
  drivingTitle: {
    color: C.text, fontSize: 15, fontWeight: '800', fontFamily: mono,
    letterSpacing: 0.5, textAlign: 'center',
  },
  drivingBody: { color: C.text2, fontSize: 13.5, lineHeight: 20, textAlign: 'center' },
  drivingParkedBtn: {
    backgroundColor: C.bg === '#050505' ? C.silverBright : C.orange, borderRadius: 16, padding: 15,
    width: '100%', alignItems: 'center', marginTop: 6,
    shadowColor: C.orange, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.35, shadowRadius: 8,
  },
  drivingParkedText: { color: C.bg === '#050505' ? '#050505' : '#fff', fontWeight: '900', fontSize: 12, fontFamily: mono },
  drivingPassengerBtn: {
    borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 13,
    width: '100%', alignItems: 'center',
  },
  drivingPassengerText: { color: C.text3, fontSize: 12, fontFamily: mono },

  safetyBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.orange + '0c', borderRadius: 14, padding: 10, marginBottom: 4,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  safetyText: { color: C.text2, fontSize: 11, fontFamily: mono, flex: 1 },
  queueBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: C.orange + '44',
    borderRadius: 14,
    backgroundColor: C.orange + '10',
    padding: 12,
  },
  queueIcon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.orange + '16' },
  queueTitle: { color: C.text, fontSize: 13, fontWeight: '900' },
  queueText: { color: C.text3, fontSize: 11, lineHeight: 15, marginTop: 2 },
  queueRetry: { minHeight: 32, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: C.orange + '66', alignItems: 'center', justifyContent: 'center' },
  queueRetryText: { color: C.orange, fontSize: 10, fontWeight: '900', fontFamily: mono },
  starRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 },
  star: { color: C.border, fontSize: 32 },
  starActive: { color: '#f59e0b' },
  starReset: { color: C.text3, fontSize: 9, fontFamily: mono, marginLeft: 4 },

  nearbyHero: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 18,
    backgroundColor: C.s2,
    padding: 14,
  },
  nearbyKicker: { color: C.orange, fontSize: 8, fontFamily: mono, fontWeight: '900' },
  nearbyTitle: { color: C.text, fontSize: 19, lineHeight: 23, fontWeight: '900', marginTop: 3 },
  nearbySubtitle: { color: C.text3, fontSize: 11.5, lineHeight: 16, marginTop: 5 },
  nearbyCount: {
    minWidth: 62,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.orange + '44',
    borderRadius: 16,
    backgroundColor: C.orange + '10',
  },
  nearbyCountNum: { color: C.orange, fontSize: 21, fontFamily: mono, fontWeight: '900' },
  nearbyCountLabel: { color: C.text3, fontSize: 7, fontFamily: mono, fontWeight: '900', marginTop: 1 },
  feedLoadingBlock: {
    gap: 10,
    marginTop: 6,
  },
  emptyWrap: {
    alignItems: 'center',
    marginTop: 34,
    gap: 9,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 20,
    backgroundColor: C.s1,
    padding: 22,
  },
  emptyIconWrap: {
    width: 58,
    height: 58,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s2,
  },
  emptyIcon: { fontSize: 40 },
  emptyText: { color: C.text2, fontSize: 15, fontWeight: '600' },
  emptySub: { color: C.text3, fontSize: 12, lineHeight: 18, textAlign: 'center', maxWidth: 310 },
  emptyAction: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: C.orange + '44',
    borderRadius: 999,
    backgroundColor: C.orange + '10',
    paddingHorizontal: 13,
    marginTop: 4,
  },
  emptyActionText: { color: C.orange, fontSize: 9, fontFamily: mono, fontWeight: '900' },
  // Alert settings button
  notifSettingsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 4,
  },
  notifSettingsIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.orange + '10',
    borderWidth: 1,
    borderColor: C.orange + '33',
  },
  notifSettingsBtnText: { color: C.text, fontSize: 12, fontFamily: mono, fontWeight: '900' },
  notifSettingsSub: { color: C.text3, fontSize: 10.5, lineHeight: 14, marginTop: 2 },
  // Notification settings modal
  notifOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  notifModal: {
    backgroundColor: 'rgba(8,8,10,0.94)', borderTopLeftRadius: 28, borderTopRightRadius: 28,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', padding: 20, paddingBottom: 40, gap: 14,
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
  contributorHero: { backgroundColor: C.s2, borderRadius: 24, borderWidth: 1, borderColor: '#d4af3744', padding: 16, gap: 12, overflow: 'hidden' },
  contributorHeroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  contributorTitle: { color: C.text, fontSize: 28, fontWeight: '900', letterSpacing: 0 },
  contributorHeroText: { color: C.text3, fontSize: 12.5, lineHeight: 18 },
  contributorTrophy: { width: 52, height: 52, borderRadius: 18, backgroundColor: '#d4af3720', borderWidth: 1, borderColor: '#d4af3766', alignItems: 'center', justifyContent: 'center' },
  periodRow: { flexDirection: 'row', gap: 8 },
  periodBtn: { flex: 1, borderRadius: 999, borderWidth: 1, borderColor: C.border, backgroundColor: C.s3, paddingVertical: 9, alignItems: 'center' },
  periodBtnActive: { backgroundColor: C.orangeGlow, borderColor: C.orange },
  periodText: { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '900', letterSpacing: 0.8 },
  periodTextActive: { color: C.orange },
  podiumRow: { flexDirection: 'row', gap: 8, alignItems: 'stretch' },
  podiumCard: { flex: 1, backgroundColor: C.s2, borderWidth: 1, borderColor: C.border, borderRadius: 18, padding: 10, alignItems: 'center', gap: 6, minHeight: 142 },
  podiumGold: { borderColor: '#d4af37', backgroundColor: '#d4af3711' },
  podiumRank: { color: '#d4af37', fontSize: 13, fontFamily: mono, fontWeight: '900' },
  podiumAvatar: { width: 42, height: 42, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  podiumInitial: { color: '#fff', fontSize: 17, fontWeight: '900' },
  podiumName: { color: C.text, fontSize: 12, fontWeight: '800', textAlign: 'center', width: '100%' },
  podiumPoints: { color: C.text3, fontSize: 11, fontFamily: mono, fontWeight: '800' },
  leaderRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.s2, borderRadius: 18, borderWidth: 1, borderColor: C.border,
    padding: 12, marginBottom: 8,
  },
  leaderGold: { borderColor: '#d4af37', backgroundColor: '#d4af3710' },
  leaderRank: { color: '#d4af37', fontSize: 13, width: 34, textAlign: 'center', fontFamily: mono, fontWeight: '900' },
  leaderAvatar: { width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  leaderAvatarText: { color: '#fff', fontSize: 16, fontWeight: '900' },
  leaderInfo: { flex: 1 },
  leaderNameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  leaderName: { color: C.text, fontWeight: '900', fontSize: 14 },
  leaderMeta: { color: C.text3, fontSize: 11, fontFamily: mono, marginTop: 2 },
  badgeRow: { flexDirection: 'row', gap: 5, flexWrap: 'wrap', marginTop: 7 },
  miniBadge: { borderRadius: 999, backgroundColor: '#d4af3718', borderWidth: 1, borderColor: '#d4af3738', paddingHorizontal: 7, paddingVertical: 3 },
  miniBadgeText: { color: '#d4af37', fontSize: 8, fontFamily: mono, fontWeight: '900' },
  leaderPointsBox: { alignItems: 'flex-end', minWidth: 58 },
  leaderPoints: { color: C.text, fontSize: 15, fontFamily: mono, fontWeight: '900' },
  leaderPointsLabel: { color: C.text3, fontSize: 8, fontFamily: mono, fontWeight: '900' },
  youBadge: {
    backgroundColor: C.orangeGlow, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: C.orange,
  },
  youText: { color: C.orange, fontSize: 9, fontFamily: mono, fontWeight: '700' },
  contribModal: { flex: 1, backgroundColor: C.bg },
  contribHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, backgroundColor: C.s2, borderBottomWidth: 1, borderBottomColor: C.border },
  contribClose: { width: 38, height: 38, borderRadius: 14, backgroundColor: C.s3, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  contribKicker: { color: '#d4af37', fontSize: 9, fontFamily: mono, fontWeight: '900', letterSpacing: 1.2 },
  contribHeaderTitle: { color: C.text, fontSize: 22, fontWeight: '900', letterSpacing: 0 },
  contribScroll: { padding: 16, gap: 14, paddingBottom: 44 },
  contribHeroCard: { backgroundColor: C.s2, borderRadius: 24, borderWidth: 1, borderColor: '#d4af3744', padding: 18, alignItems: 'center', gap: 10 },
  contribAvatar: { width: 78, height: 78, borderRadius: 26, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#ffffff44' },
  contribAvatarText: { color: '#fff', fontSize: 34, fontWeight: '900' },
  contribName: { color: C.text, fontSize: 24, fontWeight: '900', letterSpacing: 0 },
  contribTitle: { color: '#d4af37', fontSize: 12, fontFamily: mono, fontWeight: '900' },
  contribStatsGrid: { flexDirection: 'row', gap: 8, width: '100%' },
  contribStat: { flex: 1, borderRadius: 16, backgroundColor: C.s3, borderWidth: 1, borderColor: C.border, padding: 10, alignItems: 'center' },
  contribStatValue: { color: C.text, fontSize: 17, fontFamily: mono, fontWeight: '900' },
  contribStatLabel: { color: C.text3, fontSize: 8, fontFamily: mono, marginTop: 3 },
  tierBarOuter: { width: '100%', height: 8, borderRadius: 999, backgroundColor: C.s3, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  tierBarInner: { height: '100%', backgroundColor: '#d4af37', borderRadius: 999 },
  contribMuted: { color: C.text3, fontSize: 12, lineHeight: 18 },
  contribSection: { backgroundColor: C.s2, borderRadius: 20, borderWidth: 1, borderColor: C.border, padding: 14, gap: 10 },
  contribSectionTitle: { color: C.text, fontSize: 16, fontWeight: '900' },
  contribBadgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  contribBadge: { width: '48%', minHeight: 104, borderRadius: 16, backgroundColor: C.s3, borderWidth: 1, borderColor: '#d4af3738', padding: 10, gap: 5 },
  contribBadgeTitle: { color: C.text, fontSize: 12, fontWeight: '900' },
  contribBadgeText: { color: C.text3, fontSize: 10.5, lineHeight: 14 },
  contribActivityRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.border },
  contribActivityLabel: { color: C.text2, fontSize: 13, flex: 1 },
  contribActivityValue: { color: C.text, fontSize: 13, fontFamily: mono, fontWeight: '900' },
  contribPrivacy: { color: C.text3, fontSize: 11, lineHeight: 16, textAlign: 'center', paddingHorizontal: 12 },
});
