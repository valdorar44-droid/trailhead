import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import { useStore } from '@/lib/store';
import { useTheme, type ColorPalette } from '@/lib/design';
import {
  CONTOUR_REGIONS,
  FILE_REGIONS,
  ROUTING_REGIONS,
  TRAIL_REGIONS,
  fmtBytes,
  useOfflineFiles,
  type FileDownloadState,
} from '@/lib/useOfflineFiles';
import {
  deletePack,
  downloadPack,
  getInstalledPacks,
  pausePack,
  resumePack,
  routeCorridorBounds,
  type InstalledPack,
  type NativeOfflineRenderer,
  type PackProgress,
} from './offlineManager';
import type { WP } from './types';
import { api, PaywallError, type OfflineAssetType, type PlacePackManifest, type TripResult } from '@/lib/api';
import {
  deleteOfflinePlacePack,
  getOfflinePlacePackStorageBytes,
  listOfflinePlacePacks,
  saveOfflinePlacePack,
  type OfflinePlacePackSummary,
} from '@/lib/offlinePlacePacks';
import {
  deleteOfflineTrip,
  getOfflineTripStorageBytes,
  getOfflineTripSummaries,
  loadOfflineTrip,
  saveOfflineTrip,
} from '@/lib/offlineTrips';
import { accountStorage, type AccountStorageEpoch } from '@/lib/storage';
import { useProductFeatures } from '@/lib/useProductFeatures';
import { getExpoOfflineV2Runtime } from '@/lib/offlineV2/expoRuntime';
import type { OfflineBundleDownloadJobV2 } from '@/lib/offlineV2/jobStore';
import type { OfflineArtifactKind } from '@/lib/offlineV2/types';
import { isTrailPackClientRefV2 } from '@/lib/offlineV2/trailPack';
import {
  offlineV2ArtifactsConsumed,
  subscribeOfflineV2Consumption,
} from '@/lib/offlineV2/consumption';
import {
  displayOfflineDownloadName,
  missingRegionPlacePackEntries,
  offlineRegionIdsForPoints,
  offlineStateStoredBytes,
  regionPlacePackEntries,
  summarizeOfflineRegion,
  type OfflineRegionSummary,
} from './offlineHubModel';
import type { OfflineManagerCloseReason } from '@/lib/planLibraryPresentation';

interface WebDownloadOpts {
  bufferKm?: number;
  minZ?: number;
  maxZ?: number;
  vectorOnly?: boolean;
  label: string;
  routeCoords?: [number, number][];
  n?: number;
  s?: number;
  e?: number;
  w?: number;
}

type OfflineAccountScope = {
  epoch: AccountStorageEpoch;
  accountId: string;
};

function currentOfflineAccountScope(): OfflineAccountScope {
  return {
    epoch: accountStorage.epoch(),
    accountId: String(useStore.getState().user?.id ?? ''),
  };
}

function offlineAccountScopeIsCurrent(scope: OfflineAccountScope) {
  return !accountStorage.isCleaning()
    && accountStorage.epoch() === scope.epoch
    && String(useStore.getState().user?.id ?? '') === scope.accountId;
}

export interface OfflineAreaSelection {
  id: string;
  label: string;
  bounds: [[number, number], [number, number]];
  n: number;
  s: number;
  e: number;
  w: number;
  minZoom: number;
  maxZoom: number;
  detail: 'standard' | 'high';
  estimatedItems: number;
  estimatedMb: number;
  spanMi: number;
  areaSqMi: number;
  createdAt?: number;
  updatedAt?: number;
}

interface Props {
  visible: boolean;
  onClose: (reason?: OfflineManagerCloseReason) => void;
  waypoints: WP[];
  routeCoords?: [number, number][];
  requestedTrip?: TripResult | null;
  tripId?: string | null;
  tripName: string | null;
  useNativeMap: boolean;
  /** Physical native renderer currently mounted by the visible map surface. */
  activeNativeRenderer?: NativeOfflineRenderer;
  /** True only when the legacy Trailhead vector pack feeds the visible style. */
  legacyNativePackCompatible?: boolean;
  /** Exact server-approved style used by the visible RNMapbox surface. */
  activeRendererStyleId?: string | null;
  onOfflinePlacesChanged?: () => void;
  onWebDownloadBbox?: (opts: WebDownloadOpts) => void;
  onWebDownloadRoute?: (opts: WebDownloadOpts) => void;
  onWebCancelDownload?: () => void;
  onWebClearRegion?: (label: string) => void;
  webIsDownloading?: boolean;
  webDownloadProgress?: number;
  webDownloadSaved?: number;
  webDownloadTotal?: number;
  webDownloadMB?: string;
  webCachedRegions?: string[];
  webDownloadLabel?: string;
  selectedArea?: OfflineAreaSelection | null;
  savedAreas?: OfflineAreaSelection[];
  onStartAreaSelect?: (area?: OfflineAreaSelection | null) => void;
  onSelectArea?: (area: OfflineAreaSelection) => void;
  onRenameArea?: (areaId: string, label: string) => void;
  onSaveArea?: (area: OfflineAreaSelection) => void;
  onDeleteArea?: (areaId: string) => void;
  onOpenRegion?: (target: { lat: number; lng: number; zoom: number; label: string }) => void;
}

type OfflineView = 'home' | 'regions' | 'region' | 'area' | 'trip' | 'storage';
type IconName = keyof typeof Ionicons.glyphMap;

type TripTarget = {
  id: string;
  name: string;
  waypoints: WP[];
  routeCoords: [number, number][];
  trip?: TripResult;
};

type TripRuntime = {
  target: TripTarget;
  pack?: InstalledPack;
  placePacks: OfflinePlacePackSummary[];
  hasDownload: boolean;
  mapReady: boolean;
  directionsReady: boolean;
  notesReady: boolean;
  placesReady: boolean;
  trailsReady: boolean;
  ready: boolean;
  active: boolean;
  progress: number;
  storedBytes: number;
  status: string;
};

type DeviceItem = {
  id: string;
  kind: 'region' | 'trip' | 'area' | 'trail' | 'map' | 'places';
  title: string;
  status: string;
  bytes: number;
  active: boolean;
  progress?: number;
  icon: IconName;
  onPress: () => void;
};

const REGION_GROUPS = [
  { title: 'Full country', ids: ['conus', 'canada', 'mexico'] },
  { title: 'West', ids: ['ak', 'az', 'ca', 'co', 'hi', 'id', 'mt', 'nm', 'nv', 'or', 'ut', 'wa', 'wy'] },
  { title: 'Central', ids: ['ks', 'mn', 'mo', 'nd', 'ne', 'ok', 'sd', 'tx'] },
  { title: 'Southeast', ids: ['al', 'ar', 'fl', 'ga', 'ky', 'la', 'ms', 'nc', 'sc', 'tn', 'va', 'wv'] },
  { title: 'Northeast & Midwest', ids: ['ct', 'de', 'ia', 'il', 'in', 'ma', 'md', 'me', 'mi', 'nh', 'nj', 'ny', 'oh', 'pa', 'ri', 'vt', 'wi'] },
  { title: 'International', ids: ['fi', 'pk'] },
] as const;

const PLACE_PACK_ORDER = ['essentials', 'services', 'outdoors', 'camps', 'water', 'trek_places'];

function safePackId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'download';
}

function tripPackKey(target: Pick<TripTarget, 'id' | 'name'>) {
  return `trailhead-trip-${safePackId(target.id || target.name)}`;
}

function legacyTripPackKey(name: string) {
  return `${name || 'Trip'}-corridor`;
}

function areaPackKey(area: OfflineAreaSelection) {
  return `trailhead-area-${safePackId(area.id)}`;
}

function regionCode(id: string) {
  if (id === 'canada') return 'CAN';
  if (id === 'mexico') return 'MEX';
  if (id === 'fi') return 'FIN';
  if (id === 'pk') return 'PAK';
  if (id === 'conus') return 'US';
  return id.toUpperCase();
}

function validCoords(coords?: [number, number][]) {
  return (coords ?? []).filter(coord => (
    Array.isArray(coord)
    && Number.isFinite(coord[0])
    && Number.isFinite(coord[1])
  ));
}

function normalizedOfflineBounds(bounds: [[number, number], [number, number]]) {
  const lngs = [Number(bounds[0][0]), Number(bounds[1][0])];
  const lats = [Number(bounds[0][1]), Number(bounds[1][1])];
  return {
    west: Math.min(...lngs),
    south: Math.min(...lats),
    east: Math.max(...lngs),
    north: Math.max(...lats),
  };
}

function v2ArtifactKindsReady(
  job: OfflineBundleDownloadJobV2 | undefined,
  kinds: readonly OfflineArtifactKind[],
) {
  if (!job?.manifest) return false;
  const artifacts = job.manifest.artifacts.filter(artifact => kinds.includes(artifact.kind));
  return artifacts.length > 0 && artifacts.every(artifact => job.artifact_states[artifact.id]?.status === 'ready');
}

function v2StyleMatches(
  job: OfflineBundleDownloadJobV2 | undefined,
  activeRendererStyleId: string | null | undefined,
) {
  return Boolean(
    job?.status === 'ready'
    && activeRendererStyleId
    && job.manifest?.renderer.id === 'rnmapbox'
    && job.manifest.renderer.style_id === activeRendererStyleId,
  );
}

function v2ConsumerKindsReady(
  job: OfflineBundleDownloadJobV2 | undefined,
  ownerScope: string,
  kinds: readonly OfflineArtifactKind[],
) {
  return Boolean(
    job?.status === 'ready'
    && job.manifest
    && v2ArtifactKindsReady(job, kinds)
    && offlineV2ArtifactsConsumed(
      ownerScope,
      job.manifest.bundle_id,
      job.manifest.revision,
      kinds,
    ),
  );
}

function showOfflineRemovalError(error: unknown) {
  Alert.alert(
    'Download not removed',
    error instanceof Error && error.message
      ? error.message
      : 'Trailhead could not remove this download. Try again.',
  );
}

function validWaypoints(points?: Array<Partial<WP>>) {
  return (points ?? []).filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng)).map(point => ({
    lat: Number(point.lat),
    lng: Number(point.lng),
    name: String(point.name || 'Stop'),
    day: Number(point.day || 1),
    type: String(point.type || 'waypoint'),
  }));
}

function targetFromTrip(trip: TripResult): TripTarget {
  return {
    id: trip.trip_id,
    name: trip.plan.trip_name || 'Saved trip',
    waypoints: validWaypoints(trip.plan.waypoints),
    routeCoords: validCoords(trip.route_geometry?.coords),
    trip,
  };
}

function tripDays(target: TripTarget) {
  const planDays = target.trip?.plan.duration_days || target.trip?.plan.daily_itinerary?.length || 0;
  if (planDays > 0) return planDays;
  return target.waypoints.reduce((max, point) => Math.max(max, Number(point.day || 0)), 0);
}

function tripMiles(target: TripTarget) {
  return Math.round(Number(target.trip?.plan.total_est_miles || 0));
}

function formatTripMeta(target: TripTarget) {
  const days = tripDays(target);
  const miles = tripMiles(target);
  return [days > 0 ? `${days} days` : null, miles > 0 ? `${miles.toLocaleString()} mi` : null]
    .filter(Boolean)
    .join(' · ');
}

function artifactStatus(state: FileDownloadState) {
  if (state.status === 'complete') return 'Downloaded';
  if (state.status === 'downloading') return `Downloading ${Math.round(state.progress)}%`;
  if (state.status === 'paused') return 'Paused';
  if (state.status === 'error') return 'Download incomplete';
  return 'Not downloaded';
}

function artifactActionLabel(state: FileDownloadState) {
  if (state.status === 'complete') return '';
  if (state.status === 'downloading') return 'Pause';
  if (state.status === 'paused') return 'Resume';
  if (state.status === 'error') return 'Retry';
  return 'Download';
}

function statusColor(C: ColorPalette, status: string) {
  if (status === 'Ready offline' || status === 'Downloaded') return C.orange;
  if (/incomplete/i.test(status)) return C.red;
  if (/Downloading|Paused/i.test(status)) return C.orange;
  return C.text2;
}

function SectionHeading({ label, actionLabel, onAction }: { label: string; actionLabel?: string; onAction?: () => void }) {
  const C = useTheme();
  return (
    <View style={shared.sectionHeading}>
      <Text style={[shared.sectionLabel, { color: C.text }]}>{label}</Text>
      {actionLabel && onAction ? (
        <TouchableOpacity style={shared.sectionAction} onPress={onAction} accessibilityRole="button">
          <Text style={[shared.sectionActionText, { color: C.orange }]}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function MapArtwork({ height = 58, route = false, wide = false }: { height?: number; route?: boolean; wide?: boolean }) {
  const C = useTheme();
  return (
    <View style={[shared.mapArtwork, wide && shared.mapArtworkWide, { height, backgroundColor: C.s2 }]}>
      <View style={[shared.mapRoad, shared.mapRoadOne, { backgroundColor: C.border2 }]} />
      <View style={[shared.mapRoad, shared.mapRoadTwo, { backgroundColor: C.border2 }]} />
      <View style={[shared.mapRoad, shared.mapRoadThree, { backgroundColor: C.border }]} />
      {route ? (
        <>
          <View style={[shared.routeLine, { backgroundColor: C.orange }]} />
          <View style={[shared.routeDot, shared.routeDotStart, { borderColor: C.orange, backgroundColor: C.s1 }]} />
          <View style={[shared.routeDot, shared.routeDotEnd, { borderColor: C.orange, backgroundColor: C.s1 }]} />
        </>
      ) : (
        <Ionicons name="map-outline" size={20} color={C.text3} />
      )}
    </View>
  );
}

function StatusLine({ label, icon, testID }: { label: string; icon?: IconName; testID?: string }) {
  const C = useTheme();
  const color = statusColor(C, label);
  return (
    <View style={shared.statusLine} testID={testID} accessibilityLiveRegion="polite">
      <Ionicons
        name={icon ?? (label === 'Ready offline' ? 'checkmark-circle' : /incomplete/i.test(label) ? 'alert-circle' : 'ellipse')}
        size={label === 'Ready offline' || icon ? 16 : 8}
        color={color}
      />
      <Text style={[shared.statusText, { color }]}>{label}</Text>
    </View>
  );
}

function ProgressBar({ progress, testID }: { progress: number; testID?: string }) {
  const C = useTheme();
  return (
    <View testID={testID} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(Math.max(0, Math.min(100, progress))) }} style={[shared.progressTrack, { backgroundColor: C.border }]}>
      <View style={[shared.progressFill, { backgroundColor: C.orange, width: `${Math.max(0, Math.min(100, progress))}%` }]} />
    </View>
  );
}

function IconButton({ icon, label, onPress, disabled, danger, testID }: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
  testID?: string;
}) {
  const C = useTheme();
  return (
    <TouchableOpacity
      testID={testID}
      style={[shared.iconButton, { backgroundColor: C.s2, borderColor: C.border }, disabled && shared.disabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={21} color={danger ? C.red : C.text} />
    </TouchableOpacity>
  );
}

function PrimaryButton({ label, onPress, disabled, icon, testID }: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  icon?: IconName;
  testID?: string;
}) {
  const C = useTheme();
  return (
    <TouchableOpacity
      testID={testID}
      style={[shared.primaryButton, { backgroundColor: C.text }, disabled && shared.disabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {icon ? <Ionicons name={icon} size={18} color={C.bg} /> : null}
      <Text style={[shared.primaryButtonText, { color: C.bg }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function SecondaryButton({ label, onPress, disabled, danger, testID }: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
  testID?: string;
}) {
  const C = useTheme();
  return (
    <TouchableOpacity
      testID={testID}
      style={[shared.secondaryButton, { borderColor: danger ? C.red + '66' : C.border2 }, disabled && shared.disabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={[shared.secondaryButtonText, { color: danger ? C.red : C.text }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function DeviceRow({ item, selected, selectionMode, onToggle }: {
  item: DeviceItem;
  selected?: boolean;
  selectionMode?: boolean;
  onToggle?: () => void;
}) {
  const C = useTheme();
  const rowPress = selectionMode ? onToggle : item.onPress;
  return (
    <TouchableOpacity
      testID={`offline.downloads.item.${safePackId(item.id)}`}
      style={[shared.deviceRow, { borderBottomColor: C.border }]}
      onPress={rowPress}
      disabled={selectionMode && item.active}
      activeOpacity={0.78}
    >
      {selectionMode ? (
        <View style={[shared.selectionBox, { borderColor: selected ? C.orange : C.border2, backgroundColor: selected ? C.orange : 'transparent' }]}>
          {selected ? <Ionicons name="checkmark" size={15} color="#fff" /> : null}
        </View>
      ) : (
        <MapArtwork height={54} route={item.kind === 'trip' || item.kind === 'area'} />
      )}
      <View style={shared.deviceCopy}>
        <Text style={[shared.deviceTitle, { color: C.text }]} numberOfLines={1}>{item.title}</Text>
        <Text style={[shared.deviceMeta, { color: statusColor(C, item.status) }]} numberOfLines={1}>
          {[item.status, item.bytes > 0 ? fmtBytes(item.bytes) : null].filter(Boolean).join(' · ')}
        </Text>
        {item.active && item.progress != null ? <ProgressBar progress={item.progress} /> : null}
      </View>
      {!selectionMode ? <Ionicons name="chevron-forward" size={19} color={C.text3} /> : null}
    </TouchableOpacity>
  );
}

function CheckRow({ label, ready }: { label: string; ready: boolean }) {
  const C = useTheme();
  return (
    <View style={shared.checkRow}>
      <Ionicons name={ready ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={ready ? C.orange : C.text3} />
      <Text style={[shared.checkLabel, { color: ready ? C.text : C.text2 }]}>{label}</Text>
    </View>
  );
}

function ArtifactRow({ label, state, onAction, available = true }: {
  label: string;
  state: FileDownloadState;
  onAction: () => void;
  available?: boolean;
}) {
  const C = useTheme();
  const action = available ? artifactActionLabel(state) : '';
  const status = available ? artifactStatus(state) : 'Not available';
  return (
    <View style={[shared.artifactRow, { borderBottomColor: C.border }]}>
      <Ionicons name={state.status === 'complete' ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={state.status === 'complete' ? C.orange : C.text3} />
      <View style={shared.artifactCopy}>
        <Text style={[shared.artifactTitle, { color: C.text }]}>{label}</Text>
        <Text style={[shared.artifactStatus, { color: statusColor(C, status) }]}>{status}</Text>
        {state.status === 'downloading' ? <ProgressBar progress={state.progress} /> : null}
      </View>
      {action ? (
        <TouchableOpacity style={shared.textAction} onPress={onAction} accessibilityRole="button">
          <Text style={[shared.textActionLabel, { color: C.orange }]}>{action}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export default function OfflineModal({
  visible,
  onClose,
  waypoints,
  routeCoords = [],
  requestedTrip,
  tripId,
  tripName,
  useNativeMap,
  activeNativeRenderer = 'maplibre',
  legacyNativePackCompatible = true,
  activeRendererStyleId,
  onOfflinePlacesChanged,
  onWebDownloadBbox,
  onWebDownloadRoute,
  onWebCancelDownload,
  onWebClearRegion,
  webIsDownloading,
  webDownloadProgress,
  webDownloadMB,
  webCachedRegions = [],
  webDownloadLabel,
  selectedArea,
  savedAreas = [],
  onStartAreaSelect,
  onSelectArea,
  onRenameArea,
  onSaveArea,
  onDeleteArea,
  onOpenRegion,
}: Props) {
  const C = useTheme();
  const s = makeStyles(C);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const user = useStore(state => state.user);
  const userLoc = useStore(state => state.userLoc);
  const mapboxToken = useStore(state => state.mapboxToken);
  const activeTrip = useStore(state => state.activeTrip);
  const setActiveTrip = useStore(state => state.setActiveTrip);
  const { features } = useProductFeatures(Boolean(user));
  const offlineV2Available = Boolean(features?.offline_bundle_v2 && user && useNativeMap && mapboxToken);
  const offlineV2DownloadEnabled = Boolean(offlineV2Available && activeRendererStyleId);
  const offlineV2OwnerScope = user ? `account:${String(user.id)}` : 'anonymous';
  const bottomPad = Math.max(insets.bottom, Platform.OS === 'android' ? 16 : 18);
  const sheetMaxHeight = Math.min(height * 0.94, height - Math.max(insets.top + 16, 48));

  const {
    states,
    routingStates,
    contourStates,
    trailStates,
    getState,
    getRoutingState,
    getContourState,
    getTrailState,
    startDownload,
    pauseDownload,
    resumeDownload,
    deleteDownload,
    startRoutingDownload,
    pauseRoutingDownload,
    resumeRoutingDownload,
    deleteRoutingDownload,
    startContourDownload,
    pauseContourDownload,
    resumeContourDownload,
    deleteContourDownload,
    startTrailDownload,
    pauseTrailDownload,
    resumeTrailDownload,
    deleteTrailDownload,
    getTotalBytes,
    getRoutingTotalBytes,
    getContourTotalBytes,
    getTrailTotalBytes,
    isFilePublished,
    isRoutingPublished,
    isContourPublished,
    isTrailPublished,
  } = useOfflineFiles();

  const [view, setView] = useState<OfflineView>('home');
  const [selectedRegionId, setSelectedRegionId] = useState('');
  const [selectedTripId, setSelectedTripId] = useState('');
  const [search, setSearch] = useState('');
  const [regionSearch, setRegionSearch] = useState('');
  const [selectedForRemoval, setSelectedForRemoval] = useState<string[]>([]);
  const [confirmRemoval, setConfirmRemoval] = useState<{ ids: string[]; bytes: number } | null>(null);
  const [mlnPacks, setMlnPacks] = useState<InstalledPack[]>([]);
  const [activePackName, setActivePackName] = useState('');
  const [activePackLabel, setActivePackLabel] = useState('');
  const [activePackProgress, setActivePackProgress] = useState<PackProgress | null>(null);
  const [activePackPaused, setActivePackPaused] = useState(false);
  const [packError, setPackError] = useState<{ key: string; message: string } | null>(null);
  const [authorizing, setAuthorizing] = useState('');
  const [placePacks, setPlacePacks] = useState<OfflinePlacePackSummary[]>([]);
  const [offlineTrips, setOfflineTrips] = useState<Array<TripResult & { cached_at: number }>>([]);
  const [placeManifest, setPlaceManifest] = useState<PlacePackManifest | null>(null);
  const [placeBusy, setPlaceBusy] = useState(false);
  const [placeError, setPlaceError] = useState('');
  const [freeDiskBytes, setFreeDiskBytes] = useState<number | null>(null);
  const [tripStorageBytes, setTripStorageBytes] = useState<Record<string, number>>({});
  const [placeStorageBytes, setPlaceStorageBytes] = useState<Record<string, number>>({});
  const [offlineV2Jobs, setOfflineV2Jobs] = useState<readonly OfflineBundleDownloadJobV2[]>([]);
  const [, setOfflineV2ConsumptionRevision] = useState(0);
  const wasVisible = useRef(false);

  const reloadNativePacks = useCallback(async () => {
    // Each native SDK initializes process-wide offline state when getPacks is
    // called. Querying the inactive renderer can race its unmounted map and,
    // on Android, abort in MapLibre FileSource initialization. Preserve every
    // pack on disk, but enumerate it only while its renderer is active.
    const activePacks = await getInstalledPacks(activeNativeRenderer).catch(() => []);
    // Originals owns its immutable map packs and removal/repair lifecycle.
    // Do not expose those raw native packs as generic maps here.
    setMlnPacks(activePacks.filter(
      pack => !pack.name.startsWith('trailhead-original:'),
    ));
  }, [activeNativeRenderer]);

  const reloadPlacePacks = useCallback(async (scope = currentOfflineAccountScope()) => {
    const [packs, bytes] = await Promise.all([
      listOfflinePlacePacks().catch(() => []),
      getOfflinePlacePackStorageBytes().catch(() => ({})),
    ]);
    if (!offlineAccountScopeIsCurrent(scope)) return;
    setPlacePacks(packs);
    setPlaceStorageBytes(bytes);
  }, []);

  const reloadOfflineTrips = useCallback(async (scope = currentOfflineAccountScope()) => {
    const [trips, bytes] = await Promise.all([
      getOfflineTripSummaries().catch(() => []),
      getOfflineTripStorageBytes().catch(() => ({})),
    ]);
    if (!offlineAccountScopeIsCurrent(scope)) return;
    setOfflineTrips(trips);
    setTripStorageBytes(bytes);
  }, []);

  const reloadStorage = useCallback(async () => {
    const bytes = await FileSystem.getFreeDiskStorageAsync().catch(() => null);
    setFreeDiskBytes(bytes);
  }, []);

  const reloadOfflineV2Jobs = useCallback(async () => {
    if (!offlineV2Available) {
      setOfflineV2Jobs([]);
      return;
    }
    let runtime: ReturnType<typeof getExpoOfflineV2Runtime>;
    try {
      runtime = getExpoOfflineV2Runtime(offlineV2OwnerScope);
    } catch {
      setOfflineV2Jobs([]);
      return;
    }
    const persisted = await runtime.list(offlineV2OwnerScope).catch(() => []);
    // Inspection validates live files, SQLite, and RNMapbox. It never starts
    // a transfer; failed checks become an explicit Repair required state.
    for (const job of persisted.filter(item => item.status === 'ready')) {
      await runtime.inspect(job.job_id).catch(() => undefined);
    }
    const jobs = await runtime.list(offlineV2OwnerScope).catch(() => persisted);
    setOfflineV2Jobs(jobs);
  }, [offlineV2Available, offlineV2OwnerScope]);

  useEffect(() => {
    if (!offlineV2Available) {
      setOfflineV2Jobs([]);
      return;
    }
    let runtime: ReturnType<typeof getExpoOfflineV2Runtime>;
    try {
      runtime = getExpoOfflineV2Runtime(offlineV2OwnerScope);
    } catch {
      setOfflineV2Jobs([]);
      return;
    }
    void reloadOfflineV2Jobs();
    return runtime.subscribe(job => {
      if (job.owner_scope !== offlineV2OwnerScope) return;
      setOfflineV2Jobs(current => [job, ...current.filter(item => item.job_id !== job.job_id)]);
      if (job.status === 'ready') void Promise.resolve(onOfflinePlacesChanged?.());
    });
  }, [offlineV2Available, offlineV2OwnerScope, onOfflinePlacesChanged, reloadOfflineV2Jobs]);

  useEffect(() => subscribeOfflineV2Consumption(ownerScope => {
    if (ownerScope === offlineV2OwnerScope) setOfflineV2ConsumptionRevision(value => value + 1);
  }), [offlineV2OwnerScope]);

  useEffect(() => {
    if (!visible) {
      wasVisible.current = false;
      return;
    }
    if (!wasVisible.current) {
      const recentArea = selectedArea?.updatedAt && Date.now() - selectedArea.updatedAt < 15_000;
      setSelectedTripId(requestedTrip?.trip_id ?? '');
      setView(requestedTrip ? 'trip' : recentArea ? 'area' : 'home');
      setSearch('');
      setRegionSearch('');
      setSelectedForRemoval([]);
      setConfirmRemoval(null);
    }
    wasVisible.current = true;
    const scope = currentOfflineAccountScope();
    reloadNativePacks();
    reloadPlacePacks(scope);
    reloadOfflineTrips(scope);
    reloadStorage();
    reloadOfflineV2Jobs();
    api.getPlacePackManifest().then(setPlaceManifest).catch(() => setPlaceManifest(null));
  }, [reloadNativePacks, reloadOfflineTrips, reloadOfflineV2Jobs, reloadPlacePacks, reloadStorage, requestedTrip, selectedArea?.updatedAt, visible]);

  useEffect(() => accountStorage.subscribe((cleaning, epoch) => {
    setPlacePacks([]);
    setOfflineTrips([]);
    setPlaceStorageBytes({});
    setTripStorageBytes({});
    if (cleaning || !visible) return;
    const scope = currentOfflineAccountScope();
    if (scope.epoch !== epoch) return;
    reloadPlacePacks(scope);
    reloadOfflineTrips(scope);
  }), [reloadOfflineTrips, reloadPlacePacks, visible]);

  const currentTripTarget = useMemo<TripTarget | null>(() => {
    if (requestedTrip) return targetFromTrip(requestedTrip);
    if (activeTrip && (!tripId || activeTrip.trip_id === tripId)) {
      const target = targetFromTrip(activeTrip);
      if (routeCoords.length > target.routeCoords.length) target.routeCoords = validCoords(routeCoords);
      if (waypoints.length > target.waypoints.length) target.waypoints = validWaypoints(waypoints);
      return target;
    }
    if (!tripId && !tripName && waypoints.length === 0) return null;
    return {
      id: String(tripId || safePackId(tripName || 'current-trip')),
      name: tripName || 'Current trip',
      waypoints: validWaypoints(waypoints),
      routeCoords: validCoords(routeCoords),
    };
  }, [activeTrip, requestedTrip, routeCoords, tripId, tripName, waypoints]);

  const authorizeAndRun = useCallback(async (
    key: string,
    assetType: OfflineAssetType,
    regionId: string,
    label: string,
    action: () => void | Promise<void>,
  ) => {
    if (!user) {
      Alert.alert('Sign in required', 'Sign in from Profile to download maps and trips.');
      return false;
    }
    if (authorizing) return false;
    const scope = currentOfflineAccountScope();
    if (!offlineAccountScopeIsCurrent(scope)) return false;
    setAuthorizing(key);
    try {
      await api.authorizeOfflineDownload(assetType, regionId, label);
      if (!offlineAccountScopeIsCurrent(scope)) return false;
      await action();
      return true;
    } catch (error: any) {
      if (!offlineAccountScopeIsCurrent(scope)) return false;
      const message = error instanceof PaywallError ? error.message : error?.message || 'Could not start this download.';
      Alert.alert('Download unavailable', message);
      return false;
    } finally {
      if (offlineAccountScopeIsCurrent(scope)) setAuthorizing('');
    }
  }, [authorizing, user]);

  const startMlnPack = useCallback(async (
    key: string,
    label: string,
    bounds: [[number, number], [number, number]],
    minZoom: number,
    maxZoom: number,
    onComplete?: () => void,
  ) => {
    setActivePackName(key);
    setActivePackLabel(label);
    setActivePackProgress(null);
    setActivePackPaused(false);
    setPackError(null);
    const fail = (message: string) => {
      setPackError({ key, message });
      setActivePackName('');
      setActivePackLabel('');
      setActivePackProgress(null);
      setActivePackPaused(false);
      reloadNativePacks();
    };
    try {
      await downloadPack(
        key,
        bounds,
        minZoom,
        maxZoom,
        mapboxToken || '',
        progress => setActivePackProgress({ ...progress }),
        () => {
          setActivePackName('');
          setActivePackLabel('');
          setActivePackProgress(null);
          setActivePackPaused(false);
          reloadNativePacks();
          onComplete?.();
        },
        fail,
        activeNativeRenderer,
      );
    } catch (error: any) {
      fail(error?.message || 'Could not start this offline map download.');
    }
  }, [activeNativeRenderer, mapboxToken, reloadNativePacks]);

  const pauseActivePack = useCallback(async () => {
    if (!activePackName) return;
    await pausePack(activePackName, activeNativeRenderer);
    setActivePackPaused(true);
  }, [activeNativeRenderer, activePackName]);

  const resumeActivePack = useCallback(async () => {
    if (!activePackName) return;
    await resumePack(activePackName, activeNativeRenderer);
    setActivePackPaused(false);
  }, [activeNativeRenderer, activePackName]);

  const deleteMlnPack = useCallback(async (
    name: string,
    renderer: NativeOfflineRenderer = activeNativeRenderer,
  ) => {
    if (activePackName === name) return;
    try {
      await deletePack(name, renderer);
      setMlnPacks(previous => previous.filter(pack => !(pack.name === name && pack.renderer === renderer)));
    } catch (error: any) {
      setPackError({ key: name, message: error?.message || 'Could not remove this offline map.' });
      throw error;
    }
  }, [activeNativeRenderer, activePackName]);

  const tripPackFor = useCallback((target: TripTarget) => {
    const names = [tripPackKey(target), legacyTripPackKey(target.name)];
    const matching = mlnPacks.filter(pack => names.includes(pack.name));
    return matching.find(pack => pack.renderer === activeNativeRenderer) ?? matching[0];
  }, [activeNativeRenderer, mlnPacks]);

  const startTripCorridor = useCallback((target: TripTarget) => {
    const coords = validCoords(target.routeCoords);
    const points = coords.length >= 2
      ? coords.map(([lng, lat]) => ({ lat, lng }))
      : target.waypoints;
    if (points.length < 2) {
      setPackError({ key: tripPackKey(target), message: 'This trip needs at least two mapped stops.' });
      return;
    }
    if (!useNativeMap) {
      onWebDownloadRoute?.({
        bufferKm: 16,
        minZ: 10,
        maxZ: 15,
        vectorOnly: true,
        label: target.name,
        routeCoords: coords,
      });
      return;
    }
    const bounds = routeCorridorBounds(points, 0.22);
    if (!bounds) return;
    void startMlnPack(tripPackKey(target), target.name, bounds, 10, 15);
  }, [onWebDownloadRoute, startMlnPack, useNativeMap]);

  const downloadTripPlaces = useCallback(async (target: TripTarget) => {
    if (placeBusy) return;
    const mappedWaypoints = validWaypoints(target.waypoints);
    const coords = validCoords(target.routeCoords);
    if (mappedWaypoints.length < 2 && coords.length < 2) {
      setPlaceError('This trip needs at least two mapped stops.');
      return;
    }
    const scope = currentOfflineAccountScope();
    if (!offlineAccountScopeIsCurrent(scope)) return;
    setPlaceBusy(true);
    setPlaceError('');
    try {
      const pack = await api.buildTripEssentialsPack({
        trip_id: target.id,
        trip_name: target.name,
        waypoints: mappedWaypoints.map(point => ({
          lat: point.lat,
          lng: point.lng,
          name: point.name,
          day: point.day,
          type: point.type,
        })),
        route_coords: coords,
      });
      if (!offlineAccountScopeIsCurrent(scope)) return;
      await saveOfflinePlacePack(pack, placePacks.filter(item => item.trip_id === target.id).map(item => item.pack_id));
      if (!offlineAccountScopeIsCurrent(scope)) return;
      await reloadPlacePacks(scope);
      onOfflinePlacesChanged?.();
    } catch (error: any) {
      if (offlineAccountScopeIsCurrent(scope)) setPlaceError(error?.message || 'Could not download camps and essentials.');
    } finally {
      if (offlineAccountScopeIsCurrent(scope)) setPlaceBusy(false);
    }
  }, [onOfflinePlacesChanged, placeBusy, placePacks, reloadPlacePacks]);

  const downloadTripBundle = useCallback(async (target: TripTarget) => {
    if (target.trip) {
      await saveOfflineTrip(target.trip);
      await reloadOfflineTrips(currentOfflineAccountScope());
    }
    if (offlineV2DownloadEnabled) {
      const coords = validCoords(target.routeCoords);
      const points = coords.length >= 2
        ? coords.map(([lng, lat]) => ({ lat, lng }))
        : target.waypoints;
      const bounds = routeCorridorBounds(points, 0.22);
      if (!bounds) {
        setPackError({ key: tripPackKey(target), message: 'This trip needs at least two mapped stops.' });
        return;
      }
      const v2Bounds = normalizedOfflineBounds(bounds);
      // V2 preparation deliberately caps one immutable region at 12 degrees.
      // Until route bundles can contain multiple regions, keep long trips on
      // the proven corridor downloader instead of sending a request the server
      // must reject.
      const v2BoundsSupported = v2Bounds.east - v2Bounds.west <= 12
        && v2Bounds.north - v2Bounds.south <= 12;
      if (v2BoundsSupported) {
        // V2 canonical places are additive in 1.0.10. Preserve the existing
        // trip-essentials pack (camps, fuel, water, dump stations and services)
        // until artifact parity is proven field-for-field.
        void downloadTripPlaces(target);
        const runtime = getExpoOfflineV2Runtime(offlineV2OwnerScope);
        const existing = offlineV2Jobs.find(item => item.client_ref === `trip:${target.id}`);
        if (existing && ['paused', 'error', 'repair_required'].includes(existing.status)) {
          void runtime.resume(existing.job_id);
          setView('home');
          return;
        }
        if (existing && ['preparing', 'queued', 'downloading', 'verifying', 'ready'].includes(existing.status)) {
          setView('home');
          return;
        }
        await runtime.create({
          owner_scope: offlineV2OwnerScope,
          client_ref: `trip:${target.id}`,
          label: target.name,
          request: {
            bounds: v2Bounds,
            min_zoom: 8,
            max_zoom: 15,
            renderer_style_id: activeRendererStyleId!,
          },
        });
        setView('home');
        return;
      }
    }
    if (useNativeMap && (activeRendererStyleId || !legacyNativePackCompatible)) {
      setPackError({
        key: tripPackKey(target),
        message: 'Offline download is not available for this map style yet. Choose a Trailhead map style and try again.',
      });
      return;
    }
    const key = tripPackKey(target);
    const started = await authorizeAndRun(key, 'trip_corridor', target.id, target.name, () => startTripCorridor(target));
    if (!started) return;
    void downloadTripPlaces(target);
    setView('home');
  }, [activeRendererStyleId, authorizeAndRun, downloadTripPlaces, legacyNativePackCompatible, offlineV2DownloadEnabled, offlineV2Jobs, offlineV2OwnerScope, reloadOfflineTrips, startTripCorridor, useNativeMap]);

  const downloadSelectedArea = useCallback(async () => {
    if (!selectedArea) return;
    if (offlineV2DownloadEnabled) {
      // Persist the user-created area before starting native preparation. A
      // process kill between create() and the old onSaveArea() call otherwise
      // left a durable V2 job that Plan could not name or reopen.
      onSaveArea?.(selectedArea);
      const runtime = getExpoOfflineV2Runtime(offlineV2OwnerScope);
      const existing = offlineV2Jobs.find(item => item.client_ref === `area:${selectedArea.id}`);
      if (existing && ['paused', 'error', 'repair_required'].includes(existing.status)) {
        void runtime.resume(existing.job_id);
        setView('home');
        return;
      }
      if (existing && ['preparing', 'queued', 'downloading', 'verifying', 'ready'].includes(existing.status)) {
        setView('home');
        return;
      }
      await runtime.create({
        owner_scope: offlineV2OwnerScope,
        client_ref: `area:${selectedArea.id}`,
        label: selectedArea.label,
        request: {
          bounds: {
            west: selectedArea.w,
            south: selectedArea.s,
            east: selectedArea.e,
            north: selectedArea.n,
          },
          min_zoom: selectedArea.minZoom,
          max_zoom: selectedArea.maxZoom,
          renderer_style_id: activeRendererStyleId!,
        },
      });
      setView('home');
      return;
    }
    if (useNativeMap && (activeRendererStyleId || !legacyNativePackCompatible)) {
      setPackError({
        key: areaPackKey(selectedArea),
        message: 'Offline download is not available for this map style yet. Choose a Trailhead map style and try again.',
      });
      return;
    }
    const key = areaPackKey(selectedArea);
    const started = await authorizeAndRun(key, 'trip_corridor', selectedArea.id, selectedArea.label, () => {
      if (!useNativeMap) {
        onWebDownloadBbox?.({
          label: selectedArea.label,
          n: selectedArea.n,
          s: selectedArea.s,
          e: selectedArea.e,
          w: selectedArea.w,
          minZ: selectedArea.minZoom,
          maxZ: selectedArea.maxZoom,
          vectorOnly: true,
        });
        return;
      }
      return startMlnPack(
        key,
        selectedArea.label,
        selectedArea.bounds,
        selectedArea.minZoom,
        selectedArea.maxZoom,
        () => onSaveArea?.(selectedArea),
      );
    });
    if (started) setView('home');
  }, [activeRendererStyleId, authorizeAndRun, legacyNativePackCompatible, offlineV2DownloadEnabled, offlineV2Jobs, offlineV2OwnerScope, onSaveArea, onWebDownloadBbox, selectedArea, startMlnPack, useNativeMap]);

  const downloadRegionPlaces = useCallback(async (regionId: string) => {
    if (placeBusy) return;
    const missing = missingRegionPlacePackEntries(
      placeManifest?.packs,
      placePacks,
      regionId,
      PLACE_PACK_ORDER,
    );
    if (!missing.length) return;
    const scope = currentOfflineAccountScope();
    setPlaceBusy(true);
    setPlaceError('');
    try {
      for (const entry of missing) {
        const pack = await api.getPlacePack(regionId, entry.pack_id);
        if (!offlineAccountScopeIsCurrent(scope)) return;
        await saveOfflinePlacePack(pack, placePacks.map(item => item.pack_id));
      }
      await reloadPlacePacks(scope);
      onOfflinePlacesChanged?.();
    } catch (error: any) {
      if (offlineAccountScopeIsCurrent(scope)) setPlaceError(error?.message || 'Could not download camps and essentials.');
    } finally {
      if (offlineAccountScopeIsCurrent(scope)) setPlaceBusy(false);
    }
  }, [onOfflinePlacesChanged, placeBusy, placeManifest, placePacks, reloadPlacePacks]);

  const downloadRegionBundle = useCallback(async (regionId: string) => {
    if (authorizing) return;
    const region = FILE_REGIONS[regionId as keyof typeof FILE_REGIONS];
    if (!region) return;
    const scope = currentOfflineAccountScope();
    if (!offlineAccountScopeIsCurrent(scope)) return;
    const schedule = async (assetType: OfflineAssetType, label: string, action: () => void | Promise<void>) => {
      await api.authorizeOfflineDownload(assetType, regionId, label);
      if (offlineAccountScopeIsCurrent(scope)) void Promise.resolve(action()).catch(() => {});
    };
    setAuthorizing(`region:${regionId}`);
    try {
      const mapState = getState(regionId);
      const routingState = getRoutingState(regionId);
      const trailState = getTrailState(regionId);
      if (isFilePublished(regionId)) {
        if (mapState.status === 'idle' || mapState.status === 'error') {
          await schedule(regionId === 'conus' ? 'conus_map' : 'state_map', `${region.name} map`, () => startDownload(regionId));
        } else if (mapState.status === 'paused') {
          resumeDownload(regionId);
        }
      }
      if (regionId !== 'conus' && isRoutingPublished(regionId)) {
        if (routingState.status === 'idle' || routingState.status === 'error') {
          await schedule('state_route', `${region.name} directions`, () => startRoutingDownload(regionId));
        } else if (routingState.status === 'paused') {
          resumeRoutingDownload(regionId);
        }
      }
      if (regionId !== 'conus' && isTrailPublished(regionId)) {
        if (trailState.status === 'idle' || trailState.status === 'error') {
          await schedule('state_trails', `${region.name} trails`, () => startTrailDownload(regionId));
        } else if (trailState.status === 'paused') {
          resumeTrailDownload(regionId);
        }
      }
      void downloadRegionPlaces(regionId);
    } catch (error: any) {
      const message = error instanceof PaywallError ? error.message : error?.message || `Could not start ${region.name}.`;
      Alert.alert('Download unavailable', message);
    } finally {
      if (offlineAccountScopeIsCurrent(scope)) setAuthorizing('');
    }
  }, [
    authorizing,
    downloadRegionPlaces,
    getRoutingState,
    getState,
    getTrailState,
    isFilePublished,
    isRoutingPublished,
    isTrailPublished,
    resumeDownload,
    resumeRoutingDownload,
    resumeTrailDownload,
    startDownload,
    startRoutingDownload,
    startTrailDownload,
  ]);

  const regionSummaries = useMemo(() => {
    const summaries: Record<string, OfflineRegionSummary> = {};
    Object.keys(FILE_REGIONS).forEach(id => {
      const expectedPlacePacks = regionPlacePackEntries(placeManifest?.packs, id, PLACE_PACK_ORDER);
      const placesComplete = expectedPlacePacks.every(entry => placePacks.some(pack => (
        pack.region_id === id && pack.pack_id === `${id}-${entry.pack_id}`
      )));
      const placeCount = placePacks
        .filter(pack => pack.region_id === id)
        .reduce((total, pack) => total + pack.point_count, 0);
      summaries[id] = summarizeOfflineRegion({
        map: states[id] ?? getState(id),
        routing: id === 'conus' ? undefined : routingStates[id] ?? getRoutingState(id),
        contour: id === 'conus' ? undefined : contourStates[id] ?? getContourState(id),
        trails: id === 'conus' ? undefined : trailStates[id] ?? getTrailState(id),
        placeCount,
        requiresRouting: id !== 'conus',
        requiresPlaces: expectedPlacePacks.length > 0,
        placesComplete,
        requiresTrails: id !== 'conus' && isTrailPublished(id),
      });
    });
    return summaries;
  }, [
    contourStates,
    getContourState,
    getRoutingState,
    getState,
    getTrailState,
    isTrailPublished,
    placeManifest?.packs,
    placePacks,
    routingStates,
    states,
    trailStates,
  ]);

  const inferredRegionIds = useMemo(() => {
    const routePoints = currentTripTarget?.routeCoords.map(([lng, lat]) => ({ lat, lng })) ?? [];
    const tripPoints = currentTripTarget?.waypoints ?? [];
    const location = userLoc ? [userLoc] : [];
    return offlineRegionIdsForPoints([...routePoints, ...tripPoints, ...location], FILE_REGIONS);
  }, [currentTripTarget, userLoc]);

  const tripRuntime = useCallback((target: TripTarget): TripRuntime => {
    const pack = tripPackFor(target);
    const v2Job = offlineV2Jobs.find(item => item.client_ref === `trip:${target.id}`);
    const v2States = Object.values(v2Job?.artifact_states ?? {});
    const v2Total = v2States.reduce((sum, state) => sum + state.total_bytes, 0);
    const v2Received = v2States.reduce((sum, state) => sum + state.received_bytes, 0);
    const v2Progress = v2Total > 0 ? v2Received / v2Total * 100 : v2Job?.preparation?.progress ?? 0;
    const v2Ready = v2Job?.status === 'ready';
    const v2MapReady = v2Ready
      && v2StyleMatches(v2Job, activeRendererStyleId)
      && v2ArtifactKindsReady(v2Job, ['map_style', 'map_tiles']);
    const v2PlacesReady = v2ConsumerKindsReady(v2Job, offlineV2OwnerScope, ['places']);
    const v2TrailsReady = v2ConsumerKindsReady(v2Job, offlineV2OwnerScope, ['trails']);
    const v2Active = Boolean(v2Job && ['preparing', 'queued', 'downloading', 'verifying'].includes(v2Job.status));
    const v2Paused = v2Job?.status === 'paused';
    const matchingPlacePacks = placePacks.filter(item => item.trip_id === target.id);
    const storedTrip = offlineTrips.find(trip => trip.trip_id === target.id);
    const active = Boolean(v2Active || v2Paused ||
      activePackName === tripPackKey(target)
      || (!useNativeMap && webIsDownloading && webDownloadLabel === target.name),
    );
    const progress = v2Job ? v2Progress : useNativeMap
      ? activePackProgress?.percentage ?? 0
      : webDownloadProgress ?? 0;
    const routeRegions = offlineRegionIdsForPoints(
      (target.routeCoords.length ? target.routeCoords.map(([lng, lat]) => ({ lat, lng })) : target.waypoints),
      FILE_REGIONS,
    );
    const conusCoversRoute = routeRegions.length > 0
      && routeRegions.every(id => id.length === 2 && id !== 'ak' && id !== 'hi')
      && getState('conus').status === 'complete';
    const regionMapsCoverRoute = routeRegions.length > 0
      && routeRegions.every(id => getState(id).status === 'complete');
    const webMapReady = !useNativeMap && webCachedRegions.includes(target.name);
    const legacyPackMatchesRenderer = legacyNativePackCompatible
      && pack?.renderer === activeNativeRenderer;
    const mapReady = Boolean(v2Job?.manifest?.capabilities.map && v2MapReady)
      || Boolean(pack?.complete && legacyPackMatchesRenderer)
      || conusCoversRoute || regionMapsCoverRoute || webMapReady;
    const storedCoords = validCoords(storedTrip?.route_geometry?.coords ?? target.trip?.route_geometry?.coords);
    // V2 routing is not requested until navigation has a real, verified
    // artifact consumer. The saved route is the only truthful offline signal.
    const directionsReady = Boolean(storedTrip && storedCoords.length >= 2);
    const notesReady = Boolean(storedTrip);
    const placesReady = Boolean(v2Job?.manifest?.capabilities.places && v2PlacesReady) || matchingPlacePacks.length > 0;
    const hasDownload = Boolean(v2Job || pack || matchingPlacePacks.length > 0 || active || webMapReady);
    const trailsReady = Boolean(v2Job?.manifest?.capabilities.trails && v2TrailsReady)
      || routeRegions.length > 0 && routeRegions.every(id => getTrailState(id).status === 'complete');
    const ready = mapReady && directionsReady && notesReady && placesReady;
    const storedBytes = (v2Ready ? v2Job?.manifest?.required_storage_bytes ?? 0 : 0)
      + (pack?.sizeMb ?? 0) * 1_048_576
      + Number(tripStorageBytes[target.id] ?? 0)
      + matchingPlacePacks.reduce((total, item) => total + Number(placeStorageBytes[item.pack_id] ?? 0), 0);
    let status = '';
    if (active) status = v2Paused || activePackPaused ? 'Paused' : `Downloading ${Math.round(progress)}%`;
    else if (pack?.complete && !legacyPackMatchesRenderer) status = 'Repair required';
    else if (v2Job?.status === 'error' || v2Job?.status === 'repair_required') status = 'Download incomplete';
    else if (packError?.key === tripPackKey(target)) status = 'Download incomplete';
    else if (ready) status = 'Ready offline';
    else if (mapReady && placesReady) status = 'Map and places saved';
    else if (mapReady) status = 'Map saved';
    else if (placesReady) status = 'Places saved';
    else if (notesReady) status = 'Trip saved';
    else status = 'Not downloaded';
    return {
      target,
      pack,
      placePacks: matchingPlacePacks,
      hasDownload,
      mapReady,
      directionsReady,
      notesReady,
      placesReady,
      trailsReady,
      ready,
      active,
      progress,
      storedBytes,
      status,
    };
  }, [
    activePackName,
    activePackPaused,
    activePackProgress?.percentage,
    getState,
    getTrailState,
    offlineTrips,
    offlineV2Jobs,
    offlineV2OwnerScope,
    activeRendererStyleId,
    activeNativeRenderer,
    legacyNativePackCompatible,
    packError?.key,
    placePacks,
    placeStorageBytes,
    tripPackFor,
    tripStorageBytes,
    useNativeMap,
    webCachedRegions,
    webDownloadLabel,
    webDownloadProgress,
    webIsDownloading,
  ]);

  const currentTripRuntime = useMemo(
    () => currentTripTarget ? tripRuntime(currentTripTarget) : null,
    [currentTripTarget, tripRuntime],
  );

  const areaCatalog = useMemo(() => {
    const candidates = selectedArea && !savedAreas.some(area => area.id === selectedArea.id)
      ? [selectedArea, ...savedAreas]
      : savedAreas;
    return candidates.map(area => {
      const key = areaPackKey(area);
      const matchingPacks = mlnPacks.filter(item => item.name === key || item.name === area.label);
      const pack = matchingPacks.find(item => item.renderer === activeNativeRenderer) ?? matchingPacks[0];
      const v2Job = offlineV2Jobs.find(item => item.client_ref === `area:${area.id}`);
      const v2States = Object.values(v2Job?.artifact_states ?? {});
      const v2Total = v2States.reduce((sum, state) => sum + state.total_bytes, 0);
      const v2Received = v2States.reduce((sum, state) => sum + state.received_bytes, 0);
      const active = Boolean(
        v2Job && ['preparing', 'queued', 'downloading', 'paused', 'verifying'].includes(v2Job.status)
        || activePackName === key
        || (!useNativeMap && webIsDownloading && webDownloadLabel === area.label),
      );
      const v2MapReady = v2StyleMatches(v2Job, activeRendererStyleId)
        && v2ArtifactKindsReady(v2Job, ['map_style', 'map_tiles']);
      const requiredConsumerKinds: OfflineArtifactKind[] = [
        ...(v2Job?.manifest?.capabilities.places ? ['places' as const] : []),
        ...(v2Job?.manifest?.capabilities.trails ? ['trails' as const] : []),
        ...(v2Job?.manifest?.capabilities.search ? ['search_index' as const] : []),
      ];
      const v2ConsumersReady = requiredConsumerKinds.every(kind => (
        v2ConsumerKindsReady(v2Job, offlineV2OwnerScope, [kind])
      ));
      const legacyPackMatchesRenderer = legacyNativePackCompatible
        && pack?.renderer === activeNativeRenderer;
      const v2Ready = v2MapReady && v2ConsumersReady;
      const mapReady = v2MapReady
        || Boolean(pack?.complete && legacyPackMatchesRenderer)
        || (!useNativeMap && webCachedRegions.includes(area.label));
      return {
        area,
        pack,
        v2Job,
        active,
        ready: v2Ready,
        mapReady,
        repairRequired: Boolean(pack?.complete && !legacyPackMatchesRenderer),
        progress: v2Job
          ? (v2Total > 0 ? v2Received / v2Total * 100 : v2Job.preparation?.progress ?? 0)
          : useNativeMap ? activePackProgress?.percentage ?? 0 : webDownloadProgress ?? 0,
        bytes: (v2Job?.status === 'ready' ? v2Job.manifest?.required_storage_bytes ?? 0 : 0)
          + (pack?.sizeMb ?? 0) * 1_048_576,
      };
    }).filter(item => item.v2Job || item.pack || item.active || item.mapReady || item.ready);
  }, [
    activePackName,
    activePackProgress?.percentage,
    mlnPacks,
    offlineV2Jobs,
    offlineV2OwnerScope,
    activeRendererStyleId,
    activeNativeRenderer,
    legacyNativePackCompatible,
    savedAreas,
    selectedArea,
    useNativeMap,
    webCachedRegions,
    webDownloadLabel,
    webDownloadProgress,
    webIsDownloading,
  ]);

  const linkedPackNames = useMemo(() => {
    const names = new Set<string>();
    offlineTrips.forEach(trip => {
      const target = targetFromTrip(trip);
      names.add(tripPackKey(target));
      names.add(legacyTripPackKey(target.name));
    });
    if (currentTripTarget) {
      names.add(tripPackKey(currentTripTarget));
      names.add(legacyTripPackKey(currentTripTarget.name));
    }
    savedAreas.forEach(area => {
      names.add(areaPackKey(area));
      names.add(area.label);
    });
    return names;
  }, [currentTripTarget, offlineTrips, savedAreas]);

  const deviceItems = useMemo<DeviceItem[]>(() => {
    const rows: DeviceItem[] = [];
    Object.entries(regionSummaries).forEach(([id, summary]) => {
      if (!summary.hasContent) return;
      const region = FILE_REGIONS[id as keyof typeof FILE_REGIONS];
      rows.push({
        id: `region:${id}`,
        kind: 'region',
        title: region.name,
        status: summary.status,
        bytes: summary.storedBytes + placePacks.filter(pack => pack.region_id === id).reduce((total, pack) => total + Number(placeStorageBytes[pack.pack_id] ?? 0), 0),
        active: summary.active,
        progress: summary.active ? summary.progress : undefined,
        icon: 'map-outline',
        onPress: () => {
          setSelectedRegionId(id);
          setView('region');
        },
      });
    });
    offlineTrips.forEach(trip => {
      const runtime = tripRuntime(targetFromTrip(trip));
      if (!runtime.hasDownload) return;
      rows.push({
        id: `trip:${trip.trip_id}`,
        kind: 'trip',
        title: runtime.target.name,
        status: runtime.status,
        bytes: runtime.storedBytes,
        active: runtime.active,
        progress: runtime.active ? runtime.progress : undefined,
        icon: 'navigate-outline',
        onPress: () => {
          setSelectedTripId(trip.trip_id);
          setView('trip');
        },
      });
    });
    areaCatalog.forEach(item => rows.push({
      id: `area:${item.area.id}`,
      kind: 'area',
      title: item.area.label,
      status: item.v2Job?.status === 'paused'
        ? 'Paused'
        : item.v2Job?.status === 'verifying'
          ? 'Verifying'
          : item.v2Job?.status === 'repair_required'
            ? 'Repair required'
            : item.v2Job?.status === 'error'
              ? 'Download incomplete'
              : item.repairRequired
                ? 'Repair required'
              : item.active
                ? `Downloading ${Math.round(item.progress)}%`
                : item.ready
                  ? 'Ready offline'
                  : item.mapReady ? 'Map saved' : 'Download incomplete',
      bytes: item.bytes,
      active: item.active,
      progress: item.active ? item.progress : undefined,
      icon: 'scan-outline',
      onPress: () => {
        onSelectArea?.(item.area);
        setView('area');
      },
    }));
    offlineV2Jobs.filter(job => isTrailPackClientRefV2(job.client_ref)).forEach(job => {
      const states = Object.values(job.artifact_states ?? {});
      const total = states.reduce((sum, state) => sum + state.total_bytes, 0);
      const received = states.reduce((sum, state) => sum + state.received_bytes, 0);
      const bounds = job.manifest?.bounds;
      const regionIds = bounds ? offlineRegionIdsForPoints([
        { lat: bounds.south, lng: bounds.west },
        { lat: bounds.north, lng: bounds.east },
        { lat: (bounds.south + bounds.north) / 2, lng: (bounds.west + bounds.east) / 2 },
      ], FILE_REGIONS) : [];
      const supportStates = regionIds.flatMap(id => [
        isRoutingPublished(id) ? { kind: 'routing' as const, id, state: routingStates[id] ?? getRoutingState(id) } : null,
        isContourPublished(id) ? { kind: 'contour' as const, id, state: contourStates[id] ?? getContourState(id) } : null,
        isTrailPublished(id) ? { kind: 'trail' as const, id, state: trailStates[id] ?? getTrailState(id) } : null,
      ].filter((value): value is NonNullable<typeof value> => Boolean(value)));
      const v2Active = ['preparing', 'queued', 'downloading', 'verifying'].includes(job.status);
      const supportActive = supportStates.some(item => item.state.status === 'downloading');
      const active = v2Active || supportActive;
      const v2Progress = total > 0 ? received / total * 100 : job.preparation?.progress ?? 0;
      const supportProgress = supportStates.length
        ? supportStates.reduce((sum, item) => sum + item.state.progress, 0) / supportStates.length
        : 100;
      const progress = v2Active ? v2Progress : supportActive ? supportProgress : v2Progress;
      const supportReady = supportStates.every(item => item.state.status === 'complete');
      const supportPaused = supportStates.some(item => item.state.status === 'paused');
      const status = job.status === 'ready' && supportReady
        ? 'Ready offline'
        : job.status === 'ready' && supportActive
          ? `Finishing routing and terrain ${Math.round(supportProgress)}%`
          : job.status === 'ready' && supportPaused
            ? 'Routing and terrain paused'
            : job.status === 'ready'
              ? 'Routing or terrain needs attention'
        : job.status === 'paused'
          ? 'Paused'
          : job.status === 'verifying'
            ? 'Verifying'
            : job.status === 'repair_required'
              ? 'Repair required'
              : job.status === 'error'
                ? 'Download incomplete'
                : `Downloading ${Math.round(progress)}%`;
      rows.push({
        id: `trailpack:${job.job_id}`,
        kind: 'trail',
        title: job.label,
        status,
        bytes: job.status === 'ready' ? job.manifest?.required_storage_bytes ?? total : total,
        active,
        progress: active ? progress : undefined,
        icon: 'trail-sign-outline',
        onPress: () => {
          const runtime = getExpoOfflineV2Runtime(offlineV2OwnerScope);
          const supportOperations: Promise<unknown>[] = [];
          if (active) {
            supportStates.forEach(item => {
              if (item.state.status !== 'downloading') return;
              if (item.kind === 'routing') supportOperations.push(pauseRoutingDownload(item.id));
              if (item.kind === 'contour') supportOperations.push(pauseContourDownload(item.id));
              if (item.kind === 'trail') supportOperations.push(pauseTrailDownload(item.id));
            });
          } else if (supportPaused) {
            supportStates.forEach(item => {
              if (item.state.status !== 'paused') return;
              if (item.kind === 'routing') supportOperations.push(resumeRoutingDownload(item.id));
              if (item.kind === 'contour') supportOperations.push(resumeContourDownload(item.id));
              if (item.kind === 'trail') supportOperations.push(resumeTrailDownload(item.id));
            });
          }
          const v2Operation = v2Active
            ? runtime.pause(job.job_id)
            : job.status === 'ready'
              ? runtime.inspect(job.job_id)
              : runtime.resume(job.job_id);
          const operation = Promise.all([v2Operation, ...supportOperations]);
          void operation
            .then(() => reloadOfflineV2Jobs())
            .catch(error => Alert.alert(
              'Download unavailable',
              error instanceof Error && error.message ? error.message : 'Try again.',
            ));
        },
      });
    });
    mlnPacks.filter(pack => !linkedPackNames.has(pack.name)).forEach(pack => rows.push({
      id: `map:${pack.renderer}:${encodeURIComponent(pack.name)}`,
      kind: 'map',
      title: displayOfflineDownloadName(pack.name),
      status: pack.complete && (!legacyNativePackCompatible || pack.renderer !== activeNativeRenderer)
        ? 'Repair required'
        : pack.complete ? 'Map saved' : 'Download incomplete',
      bytes: pack.sizeMb * 1_048_576,
      active: activePackName === pack.name,
      progress: pack.percentage,
      icon: 'map-outline',
      onPress: () => {},
    }));
    placePacks.filter(pack => !pack.region_id && !pack.trip_id).forEach(pack => rows.push({
      id: `places:${pack.pack_id}`,
      kind: 'places',
      title: pack.name,
      status: `${pack.point_count.toLocaleString()} places saved`,
      bytes: Number(placeStorageBytes[pack.pack_id] ?? 0),
      active: false,
      icon: 'location-outline',
      onPress: () => {},
    }));
    return rows.sort((a, b) => Number(b.active) - Number(a.active) || a.title.localeCompare(b.title));
  }, [
    activePackName,
    activeNativeRenderer,
    legacyNativePackCompatible,
    areaCatalog,
    linkedPackNames,
    mlnPacks,
    offlineTrips,
    offlineV2Jobs,
    offlineV2OwnerScope,
    onSelectArea,
    contourStates,
    getContourState,
    getRoutingState,
    getTrailState,
    isContourPublished,
    isRoutingPublished,
    isTrailPublished,
    pauseContourDownload,
    pauseRoutingDownload,
    pauseTrailDownload,
    placePacks,
    placeStorageBytes,
    regionSummaries,
    reloadOfflineV2Jobs,
    resumeContourDownload,
    resumeRoutingDownload,
    resumeTrailDownload,
    routingStates,
    trailStates,
    tripRuntime,
  ]);

  const visibleDeviceItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return deviceItems;
    return deviceItems.filter(item => `${item.title} ${item.status}`.toLowerCase().includes(query));
  }, [deviceItems, search]);

  const totalStoredBytes = useMemo(
    () => deviceItems.reduce((total, item) => total + item.bytes, 0),
    [deviceItems],
  );
  const activeCount = deviceItems.filter(item => item.active).length;

  const selectedTripRuntime = useMemo(() => {
    if (selectedTripId && currentTripTarget?.id === selectedTripId) return currentTripRuntime;
    const trip = offlineTrips.find(item => item.trip_id === selectedTripId);
    return trip ? tripRuntime(targetFromTrip(trip)) : currentTripRuntime;
  }, [currentTripRuntime, currentTripTarget?.id, offlineTrips, selectedTripId, tripRuntime]);

  const openOfflineTrip = useCallback(async (target: TripTarget) => {
    if (activeTrip?.trip_id === target.id) {
      onClose('open_map');
      return;
    }
    const scope = currentOfflineAccountScope();
    const trip = await loadOfflineTrip(target.id);
    if (!offlineAccountScopeIsCurrent(scope)) return;
    if (!trip) {
      Alert.alert('Trip unavailable', 'This offline copy is no longer on this device.');
      await reloadOfflineTrips(scope);
      return;
    }
    setActiveTrip({ ...trip, updated_at: Date.now() }, true);
    onClose('open_map');
  }, [activeTrip?.trip_id, onClose, reloadOfflineTrips, setActiveTrip]);

  const openRegion = useCallback((id: string) => {
    const region = FILE_REGIONS[id as keyof typeof FILE_REGIONS];
    if (!region) return;
    onOpenRegion?.({
      lat: (region.bounds.n + region.bounds.s) / 2,
      lng: (region.bounds.e + region.bounds.w) / 2,
      zoom: id === 'conus' || id.length > 2 ? 4 : 6,
      label: region.name,
    });
    onClose('open_map');
  }, [onClose, onOpenRegion]);

  const artifactAction = useCallback((state: FileDownloadState, actions: {
    start: () => void;
    pause: () => void;
    resume: () => void;
  }) => {
    if (state.status === 'downloading') actions.pause();
    else if (state.status === 'paused') actions.resume();
    else if (state.status !== 'complete') actions.start();
  }, []);

  const removeRegionNow = useCallback(async (id: string) => {
    const summary = regionSummaries[id];
    if (summary?.active) return;
    await Promise.all([
      deleteDownload(id),
      id === 'conus' ? Promise.resolve() : deleteRoutingDownload(id),
      id === 'conus' ? Promise.resolve() : deleteContourDownload(id),
      id === 'conus' ? Promise.resolve() : deleteTrailDownload(id),
      ...placePacks.filter(pack => pack.region_id === id).map(pack => deleteOfflinePlacePack(pack.pack_id)),
    ]);
    await reloadPlacePacks(currentOfflineAccountScope());
    onOfflinePlacesChanged?.();
  }, [
    deleteContourDownload,
    deleteDownload,
    deleteRoutingDownload,
    deleteTrailDownload,
    onOfflinePlacesChanged,
    placePacks,
    regionSummaries,
    reloadPlacePacks,
  ]);

  const removeTripNow = useCallback(async (target: TripTarget) => {
    const runtime = tripRuntime(target);
    if (runtime.active) return;
    const v2Job = offlineV2Jobs.find(item => item.client_ref === `trip:${target.id}`);
    if (v2Job) {
      const offlineRuntime = getExpoOfflineV2Runtime(offlineV2OwnerScope);
      if (v2Job.manifest) await offlineRuntime.remove(v2Job.manifest.bundle_id);
      else await offlineRuntime.cancel(v2Job.job_id);
      await reloadOfflineV2Jobs();
    }
    if (runtime.pack) await deleteMlnPack(runtime.pack.name, runtime.pack.renderer);
    await Promise.all([
      deleteOfflineTrip(target.id),
      ...runtime.placePacks.map(pack => deleteOfflinePlacePack(pack.pack_id)),
    ]);
    await Promise.all([
      reloadOfflineTrips(currentOfflineAccountScope()),
      reloadPlacePacks(currentOfflineAccountScope()),
    ]);
    onOfflinePlacesChanged?.();
  }, [deleteMlnPack, offlineV2Jobs, offlineV2OwnerScope, onOfflinePlacesChanged, reloadOfflineTrips, reloadOfflineV2Jobs, reloadPlacePacks, tripRuntime]);

  const removeAreaNow = useCallback(async (area: OfflineAreaSelection) => {
    const entry = areaCatalog.find(item => item.area.id === area.id);
    if (entry?.active) return;
    if (entry?.pack) await deleteMlnPack(entry.pack.name, entry.pack.renderer);
    onWebClearRegion?.(area.label);
    onDeleteArea?.(area.id);
  }, [areaCatalog, deleteMlnPack, onDeleteArea, onWebClearRegion]);

  const removeAreaDownloadNow = useCallback(async (area: OfflineAreaSelection) => {
    const v2Job = offlineV2Jobs.find(item => item.client_ref === `area:${area.id}`);
    if (v2Job) {
      const runtime = getExpoOfflineV2Runtime(offlineV2OwnerScope);
      if (v2Job.manifest) await runtime.remove(v2Job.manifest.bundle_id);
      else await runtime.cancel(v2Job.job_id);
      await reloadOfflineV2Jobs();
    }
    // A selected area can have both a legacy Mapbox pack and a V2 bundle
    // during migration. Explicit removal clears both; merely inspecting the
    // area never deletes either format.
    await removeAreaNow(area);
  }, [offlineV2Jobs, offlineV2OwnerScope, reloadOfflineV2Jobs, removeAreaNow]);

  const removeDeviceItem = useCallback(async (id: string) => {
    const separator = id.indexOf(':');
    const kind = separator >= 0 ? id.slice(0, separator) : id;
    const value = separator >= 0 ? id.slice(separator + 1) : '';
    if (kind === 'region') return removeRegionNow(value);
    if (kind === 'trip') {
      const trip = offlineTrips.find(item => item.trip_id === value);
      if (trip) return removeTripNow(targetFromTrip(trip));
      return;
    }
    if (kind === 'area') {
      const area = savedAreas.find(item => item.id === value);
      if (area) return removeAreaDownloadNow(area);
      return;
    }
    if (kind === 'trailpack') {
      const job = offlineV2Jobs.find(item => item.job_id === value);
      if (!job) return;
      const runtime = getExpoOfflineV2Runtime(offlineV2OwnerScope);
      if (job.manifest) await runtime.remove(job.manifest.bundle_id);
      else await runtime.cancel(job.job_id);
      await reloadOfflineV2Jobs();
      return;
    }
    if (kind === 'map') {
      const rendererSeparator = value.indexOf(':');
      const renderer = value.slice(0, rendererSeparator) as NativeOfflineRenderer;
      const name = decodeURIComponent(value.slice(rendererSeparator + 1));
      if ((renderer === 'maplibre' || renderer === 'rnmapbox') && name) {
        return deleteMlnPack(name, renderer);
      }
      return;
    }
    if (kind === 'places') {
      await deleteOfflinePlacePack(value);
      await reloadPlacePacks(currentOfflineAccountScope());
      onOfflinePlacesChanged?.();
    }
  }, [deleteMlnPack, offlineTrips, offlineV2Jobs, offlineV2OwnerScope, onOfflinePlacesChanged, reloadOfflineV2Jobs, reloadPlacePacks, removeAreaDownloadNow, removeRegionNow, removeTripNow, savedAreas]);

  const removeConfirmedItems = useCallback(async () => {
    const pending = confirmRemoval;
    if (!pending) return;
    setConfirmRemoval(null);
    try {
      for (const id of pending.ids) await removeDeviceItem(id);
      setSelectedForRemoval([]);
      await Promise.all([reloadNativePacks(), reloadStorage()]);
    } catch (error) {
      showOfflineRemovalError(error);
      await Promise.all([reloadNativePacks(), reloadOfflineV2Jobs(), reloadStorage()]);
    }
  }, [confirmRemoval, reloadNativePacks, reloadOfflineV2Jobs, reloadStorage, removeDeviceItem]);

  const askToRemoveTrip = useCallback((runtime: TripRuntime) => {
    if (runtime.active) return;
    Alert.alert(
      `Remove ${runtime.target.name}?`,
      'The trip stays in your plans. Its downloaded maps, route details, and places are removed from this device.',
      [
        { text: 'Keep download', style: 'cancel' },
        {
          text: 'Remove download',
          style: 'destructive',
          onPress: () => void removeTripNow(runtime.target).catch(showOfflineRemovalError),
        },
      ],
    );
  }, [removeTripNow]);

  const askToRemoveRegion = useCallback((id: string) => {
    const region = FILE_REGIONS[id as keyof typeof FILE_REGIONS];
    if (!region || regionSummaries[id]?.active) return;
    Alert.alert(
      `Remove ${region.name}?`,
      'Its downloaded map, directions, trails, and places are removed from this device.',
      [
        { text: 'Keep download', style: 'cancel' },
        { text: 'Remove download', style: 'destructive', onPress: () => void removeRegionNow(id) },
      ],
    );
  }, [regionSummaries, removeRegionNow]);

  const headerTitle = view === 'home'
    ? 'Offline'
    : view === 'regions'
      ? 'Choose a region'
      : view === 'region'
        ? FILE_REGIONS[selectedRegionId as keyof typeof FILE_REGIONS]?.name || 'Region'
        : view === 'area'
          ? selectedArea && areaCatalog.some(item => item.area.id === selectedArea.id) ? selectedArea.label : 'Download this area'
          : view === 'trip'
            ? selectedTripRuntime?.target.name || 'Trip download'
            : 'Offline storage';

  const renderHeader = () => (
    <View style={s.header}>
      {view !== 'home' ? (
        <IconButton testID="offline.downloads.back" icon="chevron-back" label="Back" onPress={() => setView('home')} />
      ) : null}
      <Text style={s.title} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8}>{headerTitle}</Text>
      {view === 'home' ? (
        <IconButton testID="offline.downloads.add-area" icon="add" label="Download an area" onPress={() => onStartAreaSelect?.(null)} />
      ) : <View style={shared.iconButtonSpacer} />}
      <IconButton testID="offline.downloads.close" icon="close" label="Close" onPress={() => onClose('dismiss')} />
    </View>
  );

  const renderHome = () => {
    const suggestedRegions = inferredRegionIds.filter(id => !regionSummaries[id]?.ready).slice(0, 2);
    const storageMeta = [
      totalStoredBytes > 0 ? `${fmtBytes(totalStoredBytes)} stored` : null,
      freeDiskBytes != null ? `${fmtBytes(freeDiskBytes)} free` : null,
    ].filter(Boolean).join(' · ');
    return (
      <>
        {deviceItems.length > 0 ? (
          <Text style={s.summary}>
            {activeCount > 0
              ? `${activeCount} active · ${fmtBytes(totalStoredBytes)} on this device`
              : `${deviceItems.length} download${deviceItems.length === 1 ? '' : 's'} · ${fmtBytes(totalStoredBytes)}`}
          </Text>
        ) : null}

        {!user ? (
          <View style={s.signInRow}>
            <Ionicons name="person-outline" size={20} color={C.text2} />
            <Text style={s.signInText}>Sign in from Profile to download maps and trips.</Text>
          </View>
        ) : null}

        {currentTripRuntime ? (
          <>
            <SectionHeading label="Upcoming trips" />
            <TouchableOpacity
              testID="offline.downloads.upcoming-trip"
              style={s.tripFeature}
              onPress={() => {
                setSelectedTripId(currentTripRuntime.target.id);
                setView('trip');
              }}
              activeOpacity={0.86}
            >
              <MapArtwork height={122} route wide />
              <View style={s.tripFeatureInfo}>
                <View style={s.tripFeatureCopy}>
                  <Text style={s.tripFeatureTitle}>{currentTripRuntime.target.name}</Text>
                  {formatTripMeta(currentTripRuntime.target) ? (
                    <Text style={s.tripFeatureMeta}>{formatTripMeta(currentTripRuntime.target)}</Text>
                  ) : null}
                  <StatusLine label={currentTripRuntime.status} />
                </View>
                <Ionicons name="chevron-forward" size={20} color={C.text3} />
              </View>
            </TouchableOpacity>
          </>
        ) : null}

        {deviceItems.length > 0 ? (
          <>
            <SectionHeading
              label="On this device"
              actionLabel={deviceItems.length > 4 ? 'View all' : undefined}
              onAction={deviceItems.length > 4 ? () => setView('storage') : undefined}
            />
            {deviceItems.slice(0, 4).map(item => <DeviceRow key={item.id} item={item} />)}
          </>
        ) : null}

        <SectionHeading label="Suggested downloads" />
        {suggestedRegions.map(id => {
          const region = FILE_REGIONS[id as keyof typeof FILE_REGIONS];
          const bytes = getTotalBytes(id) + getRoutingTotalBytes(id);
          return (
            <TouchableOpacity
              key={id}
              testID={`offline.downloads.suggested-region.${id}`}
              style={[s.suggestionRow, { borderBottomColor: C.border }]}
              onPress={() => {
                setSelectedRegionId(id);
                setView('region');
              }}
            >
              <MapArtwork height={46} />
              <View style={s.suggestionCopy}>
                <Text style={s.suggestionTitle}>{region.name}</Text>
                <Text style={s.suggestionMeta}>About {fmtBytes(bytes)}</Text>
              </View>
              <Ionicons name="download-outline" size={21} color={C.orange} />
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity testID="offline.downloads.current-area" style={[s.suggestionRow, { borderBottomColor: C.border }]} onPress={() => onStartAreaSelect?.(null)}>
          <MapArtwork height={46} route />
          <View style={s.suggestionCopy}>
            <Text style={s.suggestionTitle}>Current map area</Text>
            <Text style={s.suggestionMeta}>Choose the exact area</Text>
          </View>
          <Ionicons name="download-outline" size={21} color={C.orange} />
        </TouchableOpacity>
        <TouchableOpacity testID="offline.downloads.browse-regions" style={[s.suggestionRow, { borderBottomColor: C.border }]} onPress={() => setView('regions')}>
          <MapArtwork height={46} />
          <View style={s.suggestionCopy}>
            <Text style={s.suggestionTitle}>Browse regions</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={C.text3} />
        </TouchableOpacity>

        <TouchableOpacity testID="offline.downloads.storage" style={[s.storageLink, { borderTopColor: C.border }]} onPress={() => setView('storage')}>
          <Ionicons name="phone-portrait-outline" size={22} color={C.text2} />
          <View style={s.storageLinkCopy}>
            <Text style={s.storageLinkTitle}>Offline storage</Text>
            {storageMeta ? <Text style={s.storageLinkMeta}>{storageMeta}</Text> : null}
          </View>
          <Ionicons name="chevron-forward" size={20} color={C.text3} />
        </TouchableOpacity>
      </>
    );
  };

  const renderRegionBrowser = () => {
    const query = regionSearch.trim().toLowerCase();
    return (
      <>
        <View style={s.searchBox}>
          <Ionicons name="search-outline" size={19} color={C.text3} />
          <TextInput
            testID="offline.downloads.region-search"
            value={regionSearch}
            onChangeText={setRegionSearch}
            placeholder="Search regions"
            placeholderTextColor={C.text3}
            style={s.searchInput}
            autoCorrect={false}
            returnKeyType="search"
          />
          {query ? (
            <TouchableOpacity testID="offline.downloads.region-search.clear" style={shared.clearButton} onPress={() => setRegionSearch('')} accessibilityLabel="Clear search">
              <Ionicons name="close" size={17} color={C.text3} />
            </TouchableOpacity>
          ) : null}
        </View>
        {REGION_GROUPS.map(group => {
          const ids = group.ids.filter(id => {
            const region = FILE_REGIONS[id as keyof typeof FILE_REGIONS];
            return region && (!query || `${region.name} ${regionCode(id)}`.toLowerCase().includes(query));
          });
          if (!ids.length) return null;
          return (
            <View key={group.title}>
              <SectionHeading label={group.title} />
              {ids.map(id => {
                const region = FILE_REGIONS[id as keyof typeof FILE_REGIONS];
                const summary = regionSummaries[id];
                const status = summary?.status || `About ${fmtBytes(getTotalBytes(id) + getRoutingTotalBytes(id))}`;
                return (
                  <TouchableOpacity
                    key={id}
                    testID={`offline.downloads.region.${id}`}
                    style={[s.regionRow, { borderBottomColor: C.border }]}
                    onPress={() => {
                      setSelectedRegionId(id);
                      setView('region');
                    }}
                  >
                    <View style={s.regionCodeBox}><Text style={s.regionCode}>{regionCode(id)}</Text></View>
                    <View style={s.regionCopy}>
                      <Text style={s.regionTitle}>{region.name}</Text>
                      <Text style={[s.regionMeta, { color: statusColor(C, status) }]}>{status}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={19} color={C.text3} />
                  </TouchableOpacity>
                );
              })}
            </View>
          );
        })}
      </>
    );
  };

  const renderRegionDetail = () => {
    const id = selectedRegionId;
    const region = FILE_REGIONS[id as keyof typeof FILE_REGIONS];
    if (!region) return null;
    const mapState = getState(id);
    const routingState = getRoutingState(id);
    const contourState = getContourState(id);
    const trailsState = getTrailState(id);
    const summary = regionSummaries[id];
    const regionPlacePacks = placePacks.filter(pack => pack.region_id === id);
    const regionPlaceCount = regionPlacePacks.reduce((total, pack) => total + pack.point_count, 0);
    const placesAvailable = Object.values(placeManifest?.packs ?? {}).some(entry => entry.region_id === id);
    const regionBusy = Boolean(summary?.active || authorizing === `region:${id}` || placeBusy);
    return (
      <>
        <MapArtwork height={184} wide />
        <View style={s.detailIntro}>
          <Text style={s.detailTitle}>{region.name}</Text>
          <StatusLine testID="offline.downloads.region.status" label={summary?.status || 'Not downloaded'} />
        </View>

        <SectionHeading label="Offline content" />
        <ArtifactRow
          label="Map & terrain"
          state={mapState}
          available={isFilePublished(id)}
          onAction={() => artifactAction(mapState, {
            start: () => void authorizeAndRun(`map:${id}`, id === 'conus' ? 'conus_map' : 'state_map', id, `${region.name} map`, () => startDownload(id)),
            pause: () => void pauseDownload(id),
            resume: () => void resumeDownload(id),
          })}
        />
        {id !== 'conus' ? (
          <ArtifactRow
            label="Directions"
            state={routingState}
            available={isRoutingPublished(id)}
            onAction={() => artifactAction(routingState, {
              start: () => void authorizeAndRun(`route:${id}`, 'state_route', id, `${region.name} directions`, () => startRoutingDownload(id)),
              pause: () => void pauseRoutingDownload(id),
              resume: () => void resumeRoutingDownload(id),
            })}
          />
        ) : null}
        {id !== 'conus' && isTrailPublished(id) ? (
          <ArtifactRow
            label="Trails"
            state={trailsState}
            onAction={() => artifactAction(trailsState, {
              start: () => void authorizeAndRun(`trails:${id}`, 'state_trails', id, `${region.name} trails`, () => startTrailDownload(id)),
              pause: () => void pauseTrailDownload(id),
              resume: () => void resumeTrailDownload(id),
            })}
          />
        ) : null}
        {placesAvailable || regionPlacePacks.length > 0 ? (
          <View style={[shared.artifactRow, { borderBottomColor: C.border }]}>
            <Ionicons name={regionPlacePacks.length ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={regionPlacePacks.length ? C.orange : C.text3} />
            <View style={shared.artifactCopy}>
              <Text style={[shared.artifactTitle, { color: C.text }]}>Camps & essentials</Text>
              <Text style={[shared.artifactStatus, { color: regionPlacePacks.length ? C.orange : C.text2 }]}>
                {placeBusy ? 'Downloading' : regionPlacePacks.length ? `${regionPlaceCount.toLocaleString()} places downloaded` : 'Not downloaded'}
              </Text>
            </View>
            {!regionPlacePacks.length ? (
              <TouchableOpacity style={shared.textAction} onPress={() => void downloadRegionPlaces(id)} disabled={placeBusy}>
                <Text style={[shared.textActionLabel, { color: C.orange }]}>Download</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
        {id !== 'conus' && isContourPublished(id) ? (
          <ArtifactRow
            label="Topographic lines"
            state={contourState}
            onAction={() => artifactAction(contourState, {
              start: () => void authorizeAndRun(`topo:${id}`, 'state_contours', id, `${region.name} topographic lines`, () => startContourDownload(id)),
              pause: () => void pauseContourDownload(id),
              resume: () => void resumeContourDownload(id),
            })}
          />
        ) : null}
        {placeError ? <Text style={s.errorText}>{placeError}</Text> : null}

        <View style={s.detailActions}>
          {summary?.ready ? (
            <PrimaryButton testID="offline.downloads.region.open" label="Open map" icon="map-outline" onPress={() => openRegion(id)} />
          ) : (
            <PrimaryButton
              testID="offline.downloads.region.download"
              label={regionBusy ? 'Downloading' : summary?.hasContent ? 'Download remaining' : 'Download'}
              icon="download-outline"
              onPress={() => void downloadRegionBundle(id)}
              disabled={regionBusy}
            />
          )}
          {!summary?.ready && summary?.mapReady ? (
            <SecondaryButton testID="offline.downloads.region.open-partial" label="Open downloaded map" onPress={() => openRegion(id)} />
          ) : null}
          {summary?.hasContent ? (
            <SecondaryButton testID="offline.downloads.region.remove" label="Remove download" danger disabled={regionBusy} onPress={() => askToRemoveRegion(id)} />
          ) : null}
        </View>
      </>
    );
  };

  const renderAreaDetail = () => {
    if (!selectedArea) {
      return (
        <View style={s.areaStart}>
          <MapArtwork height={210} route wide />
          <PrimaryButton testID="offline.downloads.area.choose" label="Choose an area" icon="scan-outline" onPress={() => onStartAreaSelect?.(null)} />
        </View>
      );
    }
    const entry = areaCatalog.find(item => item.area.id === selectedArea.id);
    const v2Job = offlineV2Jobs.find(item => item.client_ref === `area:${selectedArea.id}`);
    const v2States = Object.values(v2Job?.artifact_states ?? {});
    const v2Total = v2States.reduce((sum, state) => sum + state.total_bytes, 0);
    const v2Received = v2States.reduce((sum, state) => sum + state.received_bytes, 0);
    const v2Progress = v2Total > 0 ? v2Received / v2Total * 100 : v2Job?.preparation?.progress ?? 0;
    const v2Active = Boolean(v2Job && ['preparing', 'queued', 'downloading', 'verifying'].includes(v2Job.status));
    const v2Paused = v2Job?.status === 'paused';
    const isActive = Boolean(entry?.active || activePackName === areaPackKey(selectedArea) || v2Active || v2Paused);
    const isReady = Boolean(entry?.ready);
    const isMapReady = Boolean(entry?.mapReady);
    const v2Capabilities = v2Job?.manifest?.capabilities;
    const mapContentReady = v2Job
      ? v2StyleMatches(v2Job, activeRendererStyleId)
        && v2ArtifactKindsReady(v2Job, ['map_style', 'map_tiles'])
      : isMapReady;
    const placeTrailKinds: OfflineArtifactKind[] = [
      ...(v2Capabilities?.places ? ['places' as const] : []),
      ...(v2Capabilities?.trails ? ['trails' as const] : []),
    ];
    const showPlaceTrailRow = v2Job?.manifest
      ? placeTrailKinds.length > 0
      : offlineV2DownloadEnabled;
    const placeTrailReady = placeTrailKinds.length > 0
      && placeTrailKinds.every(kind => v2ConsumerKindsReady(v2Job, offlineV2OwnerScope, [kind]));
    const showSearchRow = v2Job?.manifest
      ? Boolean(v2Capabilities?.search)
      : offlineV2DownloadEnabled;
    const searchReady = Boolean(v2Capabilities?.search)
      && v2ConsumerKindsReady(v2Job, offlineV2OwnerScope, ['search_index']);
    const progress = v2Job ? v2Progress : entry?.progress ?? activePackProgress?.percentage ?? 0;
    const downloadLabel = isActive
      ? v2Paused || activePackPaused ? 'Paused' : 'Downloading'
      : v2Job?.status === 'repair_required'
        ? 'Repair download'
        : v2Job?.status === 'error'
          ? 'Try download again'
          : 'Download';
    const pauseOrResume = async () => {
      if (!v2Job) {
        if (activePackPaused) await resumeActivePack();
        else await pauseActivePack();
        return;
      }
      const runtime = getExpoOfflineV2Runtime(offlineV2OwnerScope);
      if (v2Paused) void runtime.resume(v2Job.job_id);
      else await runtime.pause(v2Job.job_id);
    };
    return (
      <>
        <MapArtwork height={210} route wide />
        <View style={s.areaSheet}>
          {!isReady && !isMapReady ? (
            <TextInput
              testID="offline.downloads.area.name"
              value={selectedArea.label}
              onChangeText={value => onRenameArea?.(selectedArea.id, value)}
              style={s.areaNameInput}
              placeholder="Area name"
              placeholderTextColor={C.text3}
              maxLength={42}
            />
          ) : <Text style={s.detailTitle}>{selectedArea.label}</Text>}
          <Text style={s.areaMeta}>
            {`${Math.round(selectedArea.areaSqMi).toLocaleString()} sq mi · about ${Math.max(1, Math.round(selectedArea.estimatedMb)).toLocaleString()} MB`}
          </Text>
          <View style={s.detailChoice}>
            <Text style={s.detailChoiceLabel}>Detail</Text>
            <Text style={s.detailChoiceValue}>{selectedArea.detail === 'high' ? 'High detail' : 'Standard'}</Text>
            {!isReady && !isMapReady && !isActive ? (
              <TouchableOpacity testID="offline.downloads.area.adjust" style={shared.textAction} onPress={() => onStartAreaSelect?.(selectedArea)}>
                <Text style={[shared.textActionLabel, { color: C.orange }]}>Adjust</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <SectionHeading label={isReady ? 'Available offline' : isMapReady ? 'Offline content' : 'Download includes'} />
          <CheckRow
            label={v2Job?.manifest || offlineV2DownloadEnabled ? 'Map & terrain' : 'Map only'}
            ready={mapContentReady}
          />
          {showPlaceTrailRow ? (
            <CheckRow
              label={v2Capabilities?.places && !v2Capabilities.trails
                ? 'Places'
                : !v2Capabilities?.places && v2Capabilities?.trails
                  ? 'Trails'
                  : 'Places & trails'}
              ready={placeTrailReady}
            />
          ) : null}
          {showSearchRow ? <CheckRow label="Offline search" ready={searchReady} /> : null}
          {isActive ? (
            <View style={s.activeArea} testID="offline.downloads.area.active">
              <StatusLine testID="offline.downloads.area.status" label={v2Paused || activePackPaused ? 'Paused' : `Downloading ${Math.round(progress)}%`} />
              <ProgressBar testID="offline.downloads.area.progress" progress={progress} />
              <TouchableOpacity testID="offline.downloads.area.pause-resume" accessibilityRole="button" accessibilityLabel={v2Paused || activePackPaused ? 'Resume download' : 'Pause download'} style={shared.textAction} onPress={() => void pauseOrResume()}>
                <Text style={[shared.textActionLabel, { color: C.orange }]}>{v2Paused || activePackPaused ? 'Resume' : 'Pause'}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {v2Job?.status === 'error' || v2Job?.status === 'repair_required' ? (
            <Text style={s.errorText}>{v2Job.error?.message || 'This download needs repair.'}</Text>
          ) : null}
          {packError?.key === areaPackKey(selectedArea) ? (
            <Text style={s.errorText}>{packError.message}</Text>
          ) : null}
          <View style={s.detailActions}>
            {isReady ? (
              <PrimaryButton testID="offline.downloads.area.open" label="Open map" icon="map-outline" onPress={() => { onSelectArea?.(selectedArea); onClose('open_map'); }} />
            ) : isMapReady && !offlineV2DownloadEnabled ? (
              <PrimaryButton testID="offline.downloads.area.open" label="Open map" icon="map-outline" onPress={() => { onSelectArea?.(selectedArea); onClose('open_map'); }} />
            ) : (
              <PrimaryButton
                testID="offline.downloads.area.download"
                label={isMapReady ? 'Download remaining' : downloadLabel}
                icon="download-outline"
                onPress={() => void downloadSelectedArea()}
                disabled={Boolean(isActive || authorizing)}
              />
            )}
            {!isReady && isMapReady && offlineV2DownloadEnabled ? (
              <SecondaryButton testID="offline.downloads.area.open-partial" label="Open downloaded map" onPress={() => { onSelectArea?.(selectedArea); onClose('open_map'); }} />
            ) : null}
            {isReady || isMapReady ? (
              <SecondaryButton testID="offline.downloads.area.remove" label="Remove download" danger onPress={() => {
                Alert.alert(
                  `Remove ${selectedArea.label}?`,
                  'The downloaded offline content is removed from this device.',
                  [
                    { text: 'Keep download', style: 'cancel' },
                    {
                      text: 'Remove download',
                      style: 'destructive',
                      onPress: () => void removeAreaDownloadNow(selectedArea).catch(showOfflineRemovalError),
                    },
                  ],
                );
              }} />
            ) : null}
          </View>
        </View>
      </>
    );
  };

  const renderTripDetail = () => {
    const runtime = selectedTripRuntime;
    if (!runtime) return null;
    const v2Job = offlineV2Jobs.find(item => item.client_ref === `trip:${runtime.target.id}`);
    const v2Paused = v2Job?.status === 'paused';
    const pauseOrResume = async () => {
      if (!v2Job) {
        if (activePackPaused) await resumeActivePack();
        else await pauseActivePack();
        return;
      }
      const offlineRuntime = getExpoOfflineV2Runtime(offlineV2OwnerScope);
      if (v2Paused) void offlineRuntime.resume(v2Job.job_id);
      else await offlineRuntime.pause(v2Job.job_id);
    };
    const meta = formatTripMeta(runtime.target);
    const tripDownloadLabel = v2Job?.status === 'repair_required'
      ? 'Repair download'
      : v2Job?.status === 'error'
        ? 'Try download again'
        : placeBusy || authorizing
          ? 'Downloading'
          : 'Download';
    return (
      <>
        <MapArtwork height={220} route wide />
        <View style={s.detailIntro}>
          <Text style={s.detailTitle}>{runtime.target.name}</Text>
          {meta ? <Text style={s.detailMeta}>{meta}</Text> : null}
          <StatusLine testID="offline.downloads.trip.status" label={runtime.status} />
          {runtime.active ? <ProgressBar testID="offline.downloads.trip.progress" progress={runtime.progress} /> : null}
        </View>
        <SectionHeading label={runtime.ready ? 'Available offline' : 'Offline content'} />
        <CheckRow label="Map & terrain" ready={runtime.mapReady} />
        <CheckRow label="Directions" ready={runtime.directionsReady} />
        {runtime.trailsReady ? <CheckRow label="Trails" ready /> : null}
        <CheckRow label="Camps & essentials" ready={runtime.placesReady} />
        <CheckRow label="Trip notes & saved places" ready={runtime.notesReady} />
        {packError?.key === tripPackKey(runtime.target) ? <Text style={s.errorText}>{packError.message}</Text> : null}
        {v2Job?.status === 'error' || v2Job?.status === 'repair_required' ? (
          <Text style={s.errorText}>{v2Job.error?.message || 'This download needs repair.'}</Text>
        ) : null}
        {placeError ? <Text style={s.errorText}>{placeError}</Text> : null}
        <View style={s.detailActions}>
          {runtime.active ? (
            <PrimaryButton
              testID="offline.downloads.trip.pause-resume"
              label={v2Paused || activePackPaused ? 'Resume' : 'Pause'}
              icon={v2Paused || activePackPaused ? 'play-outline' : 'pause-outline'}
              onPress={() => void pauseOrResume()}
            />
          ) : runtime.ready ? (
            <PrimaryButton testID="offline.downloads.trip.open-map" label="Open map" icon="map-outline" onPress={() => void openOfflineTrip(runtime.target)} />
          ) : (
            <PrimaryButton
              testID="offline.downloads.trip.download"
              label={tripDownloadLabel}
              icon="download-outline"
              onPress={() => void downloadTripBundle(runtime.target)}
              disabled={Boolean(placeBusy || authorizing)}
            />
          )}
          {runtime.notesReady ? (
            <SecondaryButton testID="offline.downloads.trip.open" label="Open trip" onPress={() => void openOfflineTrip(runtime.target)} />
          ) : null}
          {runtime.hasDownload ? (
            <SecondaryButton testID="offline.downloads.trip.remove" label="Remove download" danger disabled={runtime.active} onPress={() => askToRemoveTrip(runtime)} />
          ) : null}
        </View>
      </>
    );
  };

  const renderStorage = () => {
    const selectedBytes = deviceItems
      .filter(item => selectedForRemoval.includes(item.id))
      .reduce((total, item) => total + item.bytes, 0);
    return (
      <>
        <View style={s.storageSummary}>
          <View>
            <Text style={s.storageValue}>{fmtBytes(totalStoredBytes)}</Text>
            <Text style={s.storageCaption}>Trailhead downloads</Text>
          </View>
          <View style={s.storageSummaryRight}>
            <Text style={s.storageValue}>{freeDiskBytes != null ? fmtBytes(freeDiskBytes) : '—'}</Text>
            <Text style={s.storageCaption}>Free on device</Text>
          </View>
        </View>
        {deviceItems.length > 7 ? (
          <View style={s.searchBox}>
            <Ionicons name="search-outline" size={19} color={C.text3} />
            <TextInput
              testID="offline.downloads.storage.search"
              value={search}
              onChangeText={setSearch}
              placeholder="Search downloads"
              placeholderTextColor={C.text3}
              style={s.searchInput}
              autoCorrect={false}
              returnKeyType="search"
            />
            {search ? (
              <TouchableOpacity testID="offline.downloads.storage.search.clear" style={shared.clearButton} onPress={() => setSearch('')} accessibilityLabel="Clear search">
                <Ionicons name="close" size={17} color={C.text3} />
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
        {visibleDeviceItems.length > 0 ? <SectionHeading label="Manage downloads" /> : null}
        {visibleDeviceItems.map(item => (
          <DeviceRow
            key={item.id}
            item={item}
            selectionMode
            selected={selectedForRemoval.includes(item.id)}
            onToggle={() => setSelectedForRemoval(previous => (
              previous.includes(item.id) ? previous.filter(id => id !== item.id) : [...previous, item.id]
            ))}
          />
        ))}
        <View style={s.storageActions}>
          <SecondaryButton
            testID="offline.downloads.storage.remove-selection"
            label={selectedForRemoval.length
              ? `Remove ${selectedForRemoval.length} download${selectedForRemoval.length === 1 ? '' : 's'} · ${fmtBytes(selectedBytes)}`
              : 'Select downloads to remove'}
            danger={selectedForRemoval.length > 0}
            disabled={!selectedForRemoval.length}
            onPress={() => setConfirmRemoval({ ids: selectedForRemoval, bytes: selectedBytes })}
          />
        </View>
      </>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={() => onClose('dismiss')}>
      <View style={s.overlay} testID="offline.downloads.modal">
        <TouchableOpacity testID="offline.downloads.backdrop" accessibilityRole="button" accessibilityLabel="Close offline downloads" style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={() => onClose('dismiss')} />
        <View style={[s.sheet, { maxHeight: sheetMaxHeight, paddingBottom: bottomPad }]} testID={`offline.downloads.view.${view}`}>
          {renderHeader()}
          <ScrollView
            testID="offline.downloads.scroll"
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[s.content, { paddingBottom: bottomPad + 30 }]}
          >
            {view === 'home' ? renderHome() : null}
            {view === 'regions' ? renderRegionBrowser() : null}
            {view === 'region' ? renderRegionDetail() : null}
            {view === 'area' ? renderAreaDetail() : null}
            {view === 'trip' ? renderTripDetail() : null}
            {view === 'storage' ? renderStorage() : null}
          </ScrollView>
        </View>

        {confirmRemoval ? (
          <View style={s.confirmOverlay}>
            <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={() => setConfirmRemoval(null)} />
            <View style={[s.confirmSheet, { paddingBottom: bottomPad + 8 }]} testID="offline.downloads.remove-confirmation">
              <Text style={s.confirmTitle}>
                Remove {confirmRemoval.ids.length} download{confirmRemoval.ids.length === 1 ? '' : 's'}?
              </Text>
              <Text style={s.confirmText}>
                {fmtBytes(confirmRemoval.bytes)} will be removed from this device. Trips and saved places remain in your account.
              </Text>
              <View style={s.confirmActions}>
                <SecondaryButton testID="offline.downloads.remove-confirmation.keep" label="Keep downloads" onPress={() => setConfirmRemoval(null)} />
                <TouchableOpacity testID="offline.downloads.remove-confirmation.remove" accessibilityRole="button" accessibilityLabel="Remove downloads" style={[shared.primaryButton, { backgroundColor: C.red }]} onPress={() => void removeConfirmedItems()}>
                  <Text style={[shared.primaryButtonText, { color: '#fff' }]}>Remove downloads</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const shared = StyleSheet.create({
  sectionHeading: { minHeight: 44, flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  sectionLabel: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  sectionAction: { minHeight: 44, justifyContent: 'center', paddingLeft: 16 },
  sectionActionText: { fontSize: 13, fontWeight: '700' },
  mapArtwork: { width: 78, borderRadius: 4, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  mapArtworkWide: { width: '100%' },
  mapRoad: { position: 'absolute', height: 2, borderRadius: 2 },
  mapRoadOne: { width: '130%', top: '32%', left: '-15%', transform: [{ rotate: '-13deg' }] },
  mapRoadTwo: { width: '105%', top: '66%', left: '-4%', transform: [{ rotate: '16deg' }] },
  mapRoadThree: { width: '82%', top: '48%', left: '24%', transform: [{ rotate: '62deg' }] },
  routeLine: { position: 'absolute', width: '82%', height: 3, left: '8%', top: '53%', borderRadius: 2, transform: [{ rotate: '-8deg' }] },
  routeDot: { position: 'absolute', width: 9, height: 9, borderRadius: 5, borderWidth: 2 },
  routeDotStart: { left: '7%', top: '55%' },
  routeDotEnd: { right: '8%', top: '40%' },
  statusLine: { minHeight: 22, flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusText: { fontSize: 12, lineHeight: 17, fontWeight: '600' },
  progressTrack: { height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 7 },
  progressFill: { height: 4, borderRadius: 2 },
  iconButton: { width: 44, height: 44, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  iconButtonSpacer: { width: 44, height: 44 },
  disabled: { opacity: 0.45 },
  primaryButton: { minHeight: 48, borderRadius: 6, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 18 },
  primaryButtonText: { fontSize: 14, lineHeight: 20, fontWeight: '700', textAlign: 'center' },
  secondaryButton: { minHeight: 46, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  secondaryButtonText: { fontSize: 13, lineHeight: 18, fontWeight: '700', textAlign: 'center' },
  deviceRow: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, paddingVertical: 8 },
  deviceCopy: { flex: 1, minWidth: 0 },
  deviceTitle: { fontSize: 15, lineHeight: 20, fontWeight: '700' },
  deviceMeta: { fontSize: 12, lineHeight: 17, marginTop: 3 },
  selectionBox: { width: 28, height: 28, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginHorizontal: 8 },
  checkRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkLabel: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  artifactRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, paddingVertical: 10 },
  artifactCopy: { flex: 1, minWidth: 0 },
  artifactTitle: { fontSize: 14, lineHeight: 19, fontWeight: '700' },
  artifactStatus: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  textAction: { minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
  textActionLabel: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  clearButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});

function makeStyles(C: ColorPalette) {
  return StyleSheet.create({
    overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.48)' },
    sheet: { width: '100%', minHeight: 420, borderTopLeftRadius: 16, borderTopRightRadius: 16, backgroundColor: C.s1, overflow: 'hidden' },
    header: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 10, borderBottomWidth: 1, borderBottomColor: C.border },
    title: { flex: 1, color: C.text, fontSize: 26, lineHeight: 32, fontWeight: '800' },
    content: { paddingHorizontal: 20 },
    summary: { color: C.text2, fontSize: 13, lineHeight: 18, marginTop: 12 },
    signInRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.s2, borderRadius: 6, paddingHorizontal: 14, marginTop: 16 },
    signInText: { flex: 1, color: C.text2, fontSize: 13, lineHeight: 18 },
    tripFeature: { borderBottomWidth: 1, borderBottomColor: C.border, paddingBottom: 16 },
    tripFeatureInfo: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 10 },
    tripFeatureCopy: { flex: 1, minWidth: 0 },
    tripFeatureTitle: { color: C.text, fontSize: 18, lineHeight: 24, fontWeight: '700' },
    tripFeatureMeta: { color: C.text2, fontSize: 12, lineHeight: 17, marginTop: 3 },
    suggestionRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 14, borderBottomWidth: 1, paddingVertical: 8 },
    suggestionCopy: { flex: 1, minWidth: 0 },
    suggestionTitle: { color: C.text, fontSize: 14, lineHeight: 19, fontWeight: '700' },
    suggestionMeta: { color: C.text2, fontSize: 12, lineHeight: 17, marginTop: 2 },
    storageLink: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, marginTop: 14 },
    storageLinkCopy: { flex: 1 },
    storageLinkTitle: { color: C.text, fontSize: 14, lineHeight: 20, fontWeight: '700' },
    storageLinkMeta: { color: C.text2, fontSize: 12, lineHeight: 16, marginTop: 2 },
    searchBox: { minHeight: 48, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.border, borderRadius: 6, backgroundColor: C.s2, paddingLeft: 13, marginTop: 10 },
    searchInput: { flex: 1, minHeight: 46, color: C.text, fontSize: 14, paddingHorizontal: 10, paddingVertical: 0 },
    regionRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, paddingVertical: 8 },
    regionCodeBox: { width: 54, height: 48, borderRadius: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: C.s2, borderWidth: 1, borderColor: C.border },
    regionCode: { color: C.orange, fontSize: 16, lineHeight: 20, fontWeight: '800' },
    regionCopy: { flex: 1, minWidth: 0 },
    regionTitle: { color: C.text, fontSize: 15, lineHeight: 20, fontWeight: '700' },
    regionMeta: { fontSize: 12, lineHeight: 17, marginTop: 3 },
    detailIntro: { paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.border },
    detailTitle: { color: C.text, fontSize: 22, lineHeight: 28, fontWeight: '800' },
    detailMeta: { color: C.text2, fontSize: 12, lineHeight: 17, marginTop: 4 },
    detailActions: { gap: 10, marginTop: 24 },
    errorText: { color: C.red, fontSize: 12, lineHeight: 17, marginTop: 10 },
    areaStart: { gap: 18, paddingTop: 12 },
    areaSheet: { paddingTop: 18 },
    areaNameInput: { color: C.text, fontSize: 22, lineHeight: 28, fontWeight: '800', borderBottomWidth: 1, borderBottomColor: C.border, paddingVertical: 8 },
    areaMeta: { color: C.text2, fontSize: 12, lineHeight: 17, marginTop: 7 },
    detailChoice: { minHeight: 58, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: C.border, marginTop: 8 },
    detailChoiceLabel: { color: C.text2, fontSize: 12, fontWeight: '600', width: 72 },
    detailChoiceValue: { flex: 1, color: C.text, fontSize: 13, fontWeight: '700' },
    activeArea: { marginTop: 14, padding: 14, borderRadius: 6, backgroundColor: C.s2 },
    storageSummary: { minHeight: 98, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: C.s2, borderRadius: 6, paddingHorizontal: 16, marginTop: 10 },
    storageSummaryRight: { alignItems: 'flex-end' },
    storageValue: { color: C.text, fontSize: 20, lineHeight: 26, fontWeight: '800' },
    storageCaption: { color: C.text2, fontSize: 11, lineHeight: 16, marginTop: 2 },
    storageActions: { marginTop: 20 },
    confirmOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 20, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
    confirmSheet: { backgroundColor: C.s1, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20 },
    confirmTitle: { color: C.text, fontSize: 20, lineHeight: 26, fontWeight: '800' },
    confirmText: { color: C.text2, fontSize: 13, lineHeight: 19, marginTop: 8 },
    confirmActions: { gap: 10, marginTop: 22 },
  });
}
