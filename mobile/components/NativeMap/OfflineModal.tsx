/**
 * Offline Maps — Field Ops Terminal
 *
 * Two-track download system:
 *   1. FILE DOWNLOAD  — single HTTP stream of full PMTiles file (conus.pmtiles)
 *      Fast: 1 GB in ~2 min on wifi. Uses expo-file-system resumable download.
 *      Full offline tile serving requires the next binary build (local tile server).
 *   2. MLN PACK       — per-tile download via MapLibre offline manager.
 *      Best for regions / trip corridors (small enough to complete quickly).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Modal, View, Text, TouchableOpacity, ScrollView,
  StyleSheet, Animated, Easing, Platform, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '@/lib/store';
import { useTheme, mono, type ColorPalette } from '@/lib/design';
import {
  useOfflineFiles, FILE_REGIONS, ROUTING_REGIONS, CONTOUR_REGIONS, TRAIL_REGIONS, fmtBytes, fmtSpeed, fmtEta,
  type FileDownloadState,
} from '@/lib/useOfflineFiles';
import {
  downloadPack, deletePack, getInstalledPacks, pausePack,
  routeCorridorBounds, US_STATE_PACKS,
  type InstalledPack, type PackProgress,
} from './offlineManager';
import type { WP } from './types';
import { api, PaywallError, type OfflineAssetType, type PlacePackManifest } from '@/lib/api';
import {
  deleteOfflinePlacePack,
  listOfflinePlacePacks,
  saveOfflinePlacePack,
  type OfflinePlacePackSummary,
} from '@/lib/offlinePlacePacks';


interface WebDownloadOpts { bufferKm?: number; minZ?: number; maxZ?: number; vectorOnly?: boolean; label: string; n?: number; s?: number; e?: number; w?: number; }

type RegionGroupKey = 'west' | 'central' | 'southeast' | 'northeastMidwest' | 'international';

const REGION_GROUPS: Array<{
  key: RegionGroupKey;
  label: string;
  title: string;
  subtitle: string;
  ids: string[];
}> = [
  {
    key: 'west',
    label: 'WEST',
    title: 'Western U.S.',
    subtitle: 'Mountain states, coast, desert, Alaska, Hawaii',
    ids: ['ak', 'az', 'ca', 'co', 'hi', 'id', 'mt', 'nm', 'nv', 'or', 'ut', 'wa', 'wy'],
  },
  {
    key: 'central',
    label: 'CENTRAL',
    title: 'Central / Plains / South',
    subtitle: 'Great Plains, Texas, Ozarks, upper Mississippi',
    ids: ['ks', 'mn', 'mo', 'nd', 'ne', 'ok', 'sd', 'tx'],
  },
  {
    key: 'southeast',
    label: 'SOUTHEAST',
    title: 'Southeast / Appalachia',
    subtitle: 'Gulf states, Appalachians, Atlantic South',
    ids: ['al', 'ar', 'fl', 'ga', 'ky', 'la', 'ms', 'nc', 'sc', 'tn', 'va', 'wv'],
  },
  {
    key: 'northeastMidwest',
    label: 'NE / MIDWEST',
    title: 'Northeast / Midwest',
    subtitle: 'Great Lakes, New England, Mid-Atlantic',
    ids: ['ct', 'de', 'ia', 'il', 'in', 'ma', 'md', 'me', 'mi', 'nh', 'nj', 'ny', 'oh', 'pa', 'ri', 'vt', 'wi'],
  },
  {
    key: 'international',
    label: 'CAN / MEX',
    title: 'Canada / Mexico',
    subtitle: 'Cross-border overland regions',
    ids: ['canada', 'mexico'],
  },
];

function regionGroupFor(id: string): RegionGroupKey {
  return REGION_GROUPS.find(group => group.ids.includes(id))?.key ?? 'west';
}

interface Props {
  visible:     boolean;
  onClose:     () => void;
  waypoints:   WP[];
  routeCoords?: [number, number][];
  tripId?:      string | null;
  tripName:    string | null;
  useNativeMap: boolean;
  onOfflinePlacesChanged?: () => void;
  onWebDownloadBbox?:   (opts: WebDownloadOpts) => void;
  onWebDownloadRoute?:  (opts: WebDownloadOpts) => void;
  onWebCancelDownload?: () => void;
  onWebClearRegion?:    (label: string) => void;
  webIsDownloading?:    boolean;
  webDownloadProgress?: number;
  webDownloadSaved?:    number;
  webDownloadTotal?:    number;
  webDownloadMB?:       string;
  webCachedRegions?:    string[];
  webDownloadLabel?:    string;
}

// ── Shimmer animation for active progress bar ────────────────────────────────
function ShimmerBar({ pct }: { pct: number }) {
  const C = useTheme();
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(anim, { toValue: 1, duration: 1400, useNativeDriver: true, easing: Easing.linear })
    );
    loop.start();
    return () => loop.stop();
  }, []);
  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [-80, 200] });
  return (
    <View style={{ height: 6, backgroundColor: C.border, borderRadius: 3, overflow: 'hidden' }}>
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, backgroundColor: C.orange, borderRadius: 3 }} />
      <Animated.View style={{
        position: 'absolute', top: 0, bottom: 0, width: 80,
        transform: [{ translateX }],
        backgroundColor: 'rgba(255,255,255,0.10)',
      }} />
    </View>
  );
}

// ── Static progress bar ───────────────────────────────────────────────────────
function StaticBar({ pct, accent }: { pct: number; accent?: string }) {
  const C = useTheme();
  return (
    <View style={{ height: 4, backgroundColor: C.border, borderRadius: 2 }}>
      <View style={{ height: 4, width: `${pct}%`, backgroundColor: accent ?? C.orange, borderRadius: 2 }} />
    </View>
  );
}

// ── Section header ────────────────────────────────────────────────────────────
function Section({ label }: { label: string }) {
  const C = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20, marginBottom: 10 }}>
      <View style={{ width: 3, height: 12, backgroundColor: C.orange, borderRadius: 1 }} />
      <Text style={{ color: C.text3, fontSize: 8, fontFamily: mono, fontWeight: '800', letterSpacing: 2 }}>
        {label}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: C.border }} />
    </View>
  );
}

// ── Status chip ───────────────────────────────────────────────────────────────
function StatusChip({ label, color }: { label: string; color: string }) {
  return (
    <View style={{ paddingHorizontal: 7, paddingVertical: 3, borderRadius: 3, borderWidth: 1, borderColor: color + '60', backgroundColor: color + '18' }}>
      <Text style={{ color, fontSize: 8, fontFamily: mono, fontWeight: '900', letterSpacing: 1.5 }}>{label}</Text>
    </View>
  );
}

function ReadinessRow({ icon, label, ready }: { icon: keyof typeof Ionicons.glyphMap; label: string; ready: boolean }) {
  const C = useTheme();
  const color = ready ? C.green : C.text3;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
      <Ionicons name={ready ? 'checkmark-circle' : icon} size={13} color={color} />
      <Text style={{ color, fontSize: 9, fontFamily: mono, fontWeight: '800' }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function StateReadinessPanel({
  mapReady, routeReady, contourReady, contourAvailable, trailReady, trailAvailable, placeReady, placeAvailable, placeLabel, mapBusy, routeBusy, contourBusy, trailBusy, available, onDownloadMissing,
}: {
  mapReady: boolean;
  routeReady: boolean;
  contourReady: boolean;
  contourAvailable: boolean;
  trailReady: boolean;
  trailAvailable: boolean;
  placeReady: boolean;
  placeAvailable: boolean;
  placeLabel: string;
  mapBusy: boolean;
  routeBusy: boolean;
  contourBusy: boolean;
  trailBusy: boolean;
  available: boolean;
  onDownloadMissing: () => void;
}) {
  const C = useTheme();
  const navReady = mapReady && routeReady;
  const ready = navReady && (!trailAvailable || trailReady) && (!placeAvailable || placeReady);
  const busy = mapBusy || routeBusy || contourBusy || trailBusy;
  return (
    <View style={{ backgroundColor: ready ? C.green + '12' : C.s1, borderColor: ready ? C.green + '35' : C.border, borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: ready ? C.green : C.text, fontSize: 11, fontFamily: mono, fontWeight: '900', letterSpacing: 0.8 }}>
            {ready ? 'REGION OFFLINE READY' : navReady ? 'NAV READY · PLACES OPTIONAL' : available ? 'REGION NEEDS DOWNLOADS' : 'REGION PACKS COMING SOON'}
          </Text>
          <Text style={{ color: C.text3, fontSize: 9, fontFamily: mono, marginTop: 3, lineHeight: 13 }}>
            {available
              ? 'Maps, routing, and trail systems are saved separately so you can choose only what you need.'
              : 'This region is coming soon. Download buttons will appear when the packs are ready.'}
          </Text>
        </View>
        {!navReady && available && (
          <TouchableOpacity
            disabled={busy}
            onPress={onDownloadMissing}
            style={{ borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: busy ? C.s2 : C.orangeGlow, borderWidth: 1, borderColor: busy ? C.border : C.orange + '55' }}
          >
            <Text style={{ color: busy ? C.text3 : C.orange, fontSize: 9, fontFamily: mono, fontWeight: '900' }}>
              {busy ? 'BUSY' : 'GET MISSING'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
        <ReadinessRow icon="map-outline" label={mapReady ? 'MAP ON DEVICE' : available ? 'MAP MISSING' : 'MAP PLANNED'} ready={mapReady} />
        <ReadinessRow icon="git-branch-outline" label={routeReady ? 'ROUTE ON DEVICE' : available ? 'ROUTE MISSING' : 'ROUTE PLANNED'} ready={routeReady} />
        <ReadinessRow icon="trail-sign-outline" label={trailReady ? 'TRAILS ON DEVICE' : trailAvailable ? 'TRAILS OPTIONAL' : 'TRAILS PLANNED'} ready={trailReady} />
        <ReadinessRow icon="analytics-outline" label={contourReady ? 'CONTOURS ON DEVICE' : contourAvailable ? 'CONTOURS OPTIONAL' : 'CONTOURS PLANNED'} ready={contourReady} />
        <ReadinessRow icon="location-outline" label={placeLabel} ready={placeReady} />
      </View>
    </View>
  );
}

// ── File download card (used for CONUS + all states) ─────────────────────────
function ConusCard({
  state, totalBytes, region: regionProp, code,
  onStart, onPause, onResume, onDelete,
  completeTitle, completeText,
}: {
  state:       FileDownloadState;
  totalBytes:  number;
  region?:     { name: string; description: string; estimatedGb: number };
  code?:       string;
  onStart:     () => void;
  onPause:     () => void;
  onResume:    () => void;
  onDelete:    () => void;
  completeTitle?: string;
  completeText?:  string;
}) {
  const C = useTheme();
  const region = regionProp ?? FILE_REGIONS.conus;
  const isActive   = state.status === 'downloading';
  const isPaused   = state.status === 'paused';
  const isComplete = state.status === 'complete';
  const isError    = state.status === 'error';
  const accentColor = isComplete ? C.green : isActive || isPaused ? C.orange : C.border;
  const iconBorderColor = code ? (accentColor === C.border ? C.orange + '40' : accentColor + '80') : C.border;

  return (
    <View style={{ borderLeftWidth: 3, borderLeftColor: accentColor, backgroundColor: C.s1, borderRadius: 10, overflow: 'hidden' }}>
      {/* Header row */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', padding: 14, paddingBottom: isActive || isPaused ? 8 : 14 }}>
        <View style={{ width: 44, height: 44, backgroundColor: C.s2, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginRight: 12, borderWidth: 1, borderColor: iconBorderColor }}>
          {code ? (
            <Text style={{ fontSize: 13, fontFamily: mono, fontWeight: '900', color: isComplete ? C.green : C.orange, letterSpacing: 1 }}>{code}</Text>
          ) : (
            <Ionicons name="earth-outline" size={22} color={C.text2} />
          )}
        </View>

        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <Text style={{ color: C.text, fontSize: 13, fontFamily: mono, fontWeight: '900' }}>{region.name.toUpperCase()}</Text>
            {isComplete && <StatusChip label="OFFLINE READY" color={C.green} />}
            {isActive   && <StatusChip label="DOWNLOADING"   color={C.orange} />}
            {isPaused   && <StatusChip label="PAUSED"        color={C.orange} />}
            {isError    && <StatusChip label="ERROR"         color={C.red} />}
          </View>
          <Text style={{ color: C.text2, fontSize: 10, fontFamily: mono }}>{region.description}</Text>
          {state.details ? (
            <Text style={{ color: C.text3, fontSize: 9, fontFamily: mono, marginTop: 3 }} numberOfLines={2}>
              {state.details}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
            {isComplete ? (
              <Text style={{ color: C.green, fontSize: 10, fontFamily: mono, fontWeight: '700' }}>
                {fmtBytes(state.fileSizeMb * 1_048_576)} on device
              </Text>
            ) : (
              <Text style={{ color: C.text3, fontSize: 10, fontFamily: mono }}>
                {totalBytes > 0 ? fmtBytes(totalBytes) : `~${region.estimatedGb} GB`}
              </Text>
            )}
          </View>
        </View>

        {/* Action buttons */}
        <View style={{ gap: 8 }}>
          {isComplete ? (
            <TouchableOpacity onPress={onDelete} style={{ padding: 6 }}>
              <Ionicons name="trash-outline" size={16} color={C.red} />
            </TouchableOpacity>
          ) : isActive ? (
            <TouchableOpacity onPress={onPause} style={{ padding: 6 }}>
              <Ionicons name="pause-circle-outline" size={22} color={C.orange} />
            </TouchableOpacity>
          ) : isPaused ? (
            <TouchableOpacity onPress={onResume} style={{ backgroundColor: C.orangeGlow, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 }}>
              <Text style={{ color: C.orange, fontSize: 10, fontFamily: mono, fontWeight: '900' }}>RESUME</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <TouchableOpacity onPress={onStart} style={{ backgroundColor: C.orangeGlow, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: C.orange + '55' }}>
                <Text style={{ color: C.orange, fontSize: 10, fontFamily: mono, fontWeight: '900' }}>DOWNLOAD</Text>
              </TouchableOpacity>
              <Text style={{ color: C.text3, fontSize: 8, fontFamily: mono }}>wifi recommended</Text>
            </View>
          )}
        </View>
      </View>

      {/* Progress row */}
      {(isActive || isPaused) && (
        <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>
          <View style={{ marginBottom: 8 }}>
            {isActive ? <ShimmerBar pct={state.progress} /> : <StaticBar pct={state.progress} />}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <View>
              <Text style={{ color: C.orange, fontSize: 20, fontFamily: mono, fontWeight: '900', lineHeight: 22 }}>
                {isActive ? fmtSpeed(state.speedBps).split('/')[0].trim() : '─'}
              </Text>
              <Text style={{ color: C.text3, fontSize: 8, fontFamily: mono, letterSpacing: 1 }}>
                {isActive ? (fmtSpeed(state.speedBps).includes('MB') ? 'MB/s' : 'KB/s') : 'PAUSED'}
              </Text>
            </View>
            <View style={{ width: 1, height: 28, backgroundColor: C.border }} />
            {isActive && (
              <View>
                <Text style={{ color: C.text, fontSize: 14, fontFamily: mono, fontWeight: '700', lineHeight: 16 }}>
                  {fmtEta(state.etaSec)}
                </Text>
                <Text style={{ color: C.text3, fontSize: 8, fontFamily: mono, letterSpacing: 1 }}>ETA</Text>
              </View>
            )}
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <Text style={{ color: C.text2, fontSize: 10, fontFamily: mono }}>
                {fmtBytes(state.downloadedBytes)} / {fmtBytes(state.totalBytes || totalBytes || region.estimatedGb * 1_073_741_824)}
              </Text>
              <Text style={{ color: C.orange, fontSize: 10, fontFamily: mono, fontWeight: '700' }}>
                {state.progress.toFixed(1)}%
              </Text>
            </View>
          </View>
          {isActive && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, backgroundColor: C.s2, borderRadius: 6, padding: 8 }}>
              <Ionicons name="flash-outline" size={12} color={C.orange} />
              <Text style={{ color: C.text3, fontSize: 9, fontFamily: mono, flex: 1, lineHeight: 13 }}>
                Keep app open + screen on. If interrupted, tap RESUME — download continues from where it stopped.
              </Text>
            </View>
          )}
          {isPaused && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, backgroundColor: C.orangeGlow, borderRadius: 6, padding: 8 }}>
              <Ionicons name="pause-outline" size={12} color={C.orange} />
              <Text style={{ color: C.orange, fontSize: 9, fontFamily: mono, flex: 1, lineHeight: 13 }}>
                Paused at {state.progress.toFixed(1)}%. Tap RESUME — continues from this point, no restart.
              </Text>
            </View>
          )}
        </View>
      )}

      {isError && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, paddingTop: 0 }}>
          <Ionicons name="alert-circle-outline" size={12} color={C.red} />
          <Text style={{ color: C.red, fontSize: 10, fontFamily: mono, flex: 1 }}>{state.error}</Text>
          <TouchableOpacity onPress={onStart}>
            <Text style={{ color: C.orange, fontSize: 10, fontFamily: mono, fontWeight: '700' }}>RETRY</Text>
          </TouchableOpacity>
        </View>
      )}

      {isComplete && (
        <View style={{ margin: 12, marginTop: 0, padding: 10, backgroundColor: C.green + '15', borderRadius: 6, borderWidth: 1, borderColor: C.green + '30' }}>
          <Text style={{ color: C.green, fontSize: 9, fontFamily: mono, fontWeight: '700', letterSpacing: 0.5 }}>
            {completeTitle ?? '✓ FILE ON DEVICE — READY OFFLINE'}
          </Text>
          <Text style={{ color: C.text3, fontSize: 9, fontFamily: mono, marginTop: 2 }}>
            {completeText ?? 'File downloaded. Trailhead can use this pack when the matching offline engine is available.'}
          </Text>
        </View>
      )}
    </View>
  );
}

// ── State pack row ────────────────────────────────────────────────────────────
function StateRow({ code, st, isCached, isDownloading, isActive, progress, onDownload, onDelete }: {
  code:          string;
  st:            { name: string; bounds: [[number,number],[number,number]]; icon: string };
  isCached:      boolean;
  isDownloading: boolean;
  isActive?:     boolean;
  progress?:     number;
  onDownload:    () => void;
  onDelete?:     () => void;
}) {
  const C = useTheme();
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: C.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 4 }}>
        <Ionicons name={st.icon as keyof typeof Ionicons.glyphMap} size={15} color={C.text2} style={{ width: 28 }} />
        <Text style={{ color: C.text, fontSize: 11, fontFamily: mono, fontWeight: '700', width: 26, marginRight: 6 }}>{code}</Text>
        <Text style={{ flex: 1, color: C.text2, fontSize: 10, fontFamily: mono }}>{st.name}</Text>
        {isCached ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="checkmark-circle" size={12} color={C.green} />
            <Text style={{ color: C.green, fontSize: 9, fontFamily: mono, fontWeight: '700' }}>CACHED</Text>
            <TouchableOpacity onPress={onDelete} style={{ padding: 4 }}>
              <Ionicons name="trash-outline" size={14} color={C.red} />
            </TouchableOpacity>
          </View>
        ) : isActive ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ color: C.orange, fontSize: 9, fontFamily: mono, fontWeight: '900' }}>
              {Math.round(progress ?? 0)}%
            </Text>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.orange }} />
          </View>
        ) : (
          <TouchableOpacity
            disabled={isDownloading}
            onPress={onDownload}
            style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 4, borderWidth: 1, borderColor: isDownloading ? C.border : C.orange + '55', backgroundColor: isDownloading ? 'transparent' : C.orangeGlow }}
          >
            <Text style={{ color: isDownloading ? C.text3 : C.orange, fontSize: 9, fontFamily: mono, fontWeight: '700' }}>
              {isDownloading ? 'BUSY' : 'GET'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
      {isActive && (
        <View style={{ paddingHorizontal: 4, paddingBottom: 8 }}>
          <ShimmerBar pct={progress ?? 0} />
          <Text style={{ color: C.text3, fontSize: 8, fontFamily: mono, marginTop: 4 }}>
            Downloading tiles — keep app open
          </Text>
        </View>
      )}
    </View>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function OfflineModal({
  visible, onClose, waypoints, routeCoords = [], tripId, tripName, useNativeMap,
  onOfflinePlacesChanged,
  onWebDownloadBbox, onWebDownloadRoute, onWebCancelDownload, onWebClearRegion,
  webIsDownloading, webDownloadProgress, webDownloadMB, webCachedRegions, webDownloadLabel,
}: Props) {
  const user        = useStore(st => st.user);
  const mapboxToken = useStore(st => st.mapboxToken);
  const C           = useTheme();
  const s           = makeStyles(C);
  const insets      = useSafeAreaInsets();
  const { height }  = useWindowDimensions();
  const bottomPad   = Math.max(insets.bottom, Platform.OS === 'android' ? 16 : 18);
  const sheetMaxHeight = Math.min(height * 0.91, height - Math.max(insets.top + 28, 64));

  // File-based download (CONUS + all states)
  const {
    getState, startDownload, pauseDownload, resumeDownload, deleteDownload, getTotalBytes,
    getRoutingState, startRoutingDownload, pauseRoutingDownload, resumeRoutingDownload,
    deleteRoutingDownload, getRoutingTotalBytes,
    getContourState, startContourDownload, pauseContourDownload, resumeContourDownload,
    deleteContourDownload, getContourTotalBytes,
    getTrailState, startTrailDownload, pauseTrailDownload, resumeTrailDownload,
    deleteTrailDownload, getTrailTotalBytes,
    isFilePublished, isRoutingPublished, isContourPublished, isTrailPublished,
  } = useOfflineFiles();
  const conusState      = getState('conus');
  const conusTotalBytes = getTotalBytes('conus');

  // MLN packs still used for legacy corridor fallback (can be removed later)
  const [mlnPacks,       setMlnPacks]       = useState<InstalledPack[]>([]);
  const [packError,      setPackError]      = useState<string | null>(null);
  const [activePackName, setActivePackName] = useState<string | null>(null);
  const [packProgress,   setPackProgress]   = useState<PackProgress | null>(null);
  const [activeTab,      setActiveTab]      = useState<'areas' | 'regions'>('areas');
  const [selectedState,  setSelectedState]  = useState('ks');
  const [selectedRegionGroup, setSelectedRegionGroup] = useState<RegionGroupKey>('central');
  const [authorizing,    setAuthorizing]    = useState<string | null>(null);
  const [placePacks,     setPlacePacks]     = useState<OfflinePlacePackSummary[]>([]);
  const [placeManifest,  setPlaceManifest]  = useState<PlacePackManifest | null>(null);
  const [placeBusy,      setPlaceBusy]      = useState(false);
  const [placeError,     setPlaceError]     = useState<string | null>(null);

  useEffect(() => {
    if (visible) getInstalledPacks().then(setMlnPacks).catch(() => {});
  }, [visible]);

  const reloadPlacePacks = useCallback(async () => {
    const packs = await listOfflinePlacePacks().catch(() => []);
    setPlacePacks(packs);
  }, []);

  useEffect(() => {
    if (visible) reloadPlacePacks();
  }, [visible, reloadPlacePacks]);

  useEffect(() => {
    if (!visible) return;
    api.getPlacePackManifest().then(setPlaceManifest).catch(() => setPlaceManifest(null));
  }, [visible]);

  const startMlnPack = useCallback(async (
    name: string, bounds: [[number,number],[number,number]], minZoom: number, maxZoom: number
  ) => {
    setActivePackName(name);
    setPackProgress(null);
    setPackError(null);
    await downloadPack(
      name, bounds, minZoom, maxZoom, mapboxToken || '',
      p  => setPackProgress({ ...p }),
      () => { setActivePackName(null); setPackProgress(null); getInstalledPacks().then(setMlnPacks).catch(() => {}); },
      msg => { setPackError(msg); setActivePackName(null); setPackProgress(null); },
    );
  }, [mapboxToken]);

  const startTripCorridor = useCallback((name: string) => {
    if (!useNativeMap) {
      onWebDownloadRoute?.({ bufferKm: 16, minZ: 10, maxZ: 15, vectorOnly: true, label: name });
      return;
    }

    const routePoints = routeCoords.map(([lng, lat]) => ({ lat, lng }));
    const points = routePoints.length >= 2 ? routePoints : waypoints;
    const bounds = routeCorridorBounds(points, 0.22);
    if (!bounds) {
      setPackError('Route corridor needs at least two mapped trip points.');
      return;
    }
    startMlnPack(name, bounds, 10, 15);
  }, [onWebDownloadRoute, routeCoords, startMlnPack, useNativeMap, waypoints]);

  const authorizeAndRun = useCallback(async (
    key: string,
    assetType: OfflineAssetType,
    regionId: string,
    label: string,
    action: () => void | Promise<void>,
  ) => {
    if (authorizing) return;
    setAuthorizing(key);
    try {
      await api.authorizeOfflineDownload(assetType, regionId, label);
      await action();
    } catch (e: any) {
      if (e instanceof PaywallError) {
        Alert.alert('Download unavailable', e.message);
      } else {
        Alert.alert('Download unavailable', e?.message ?? 'Could not authorize this download.');
      }
    } finally {
      setAuthorizing(null);
    }
  }, [authorizing]);

  const deleteMlnPack = useCallback(async (name: string) => {
    await deletePack(name);
    setMlnPacks(prev => prev.filter(p => p.name !== name));
  }, []);

  const downloadTripEssentials = useCallback(async () => {
    if (placeBusy) return;
    const mappedWaypoints = waypoints.filter(w => Number.isFinite(w.lat) && Number.isFinite(w.lng));
    const usableRoute = routeCoords.filter(c => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]));
    if (mappedWaypoints.length < 2 && usableRoute.length < 2) {
      setPlaceError('Essentials need at least two mapped trip points.');
      return;
    }
    setPlaceBusy(true);
    setPlaceError(null);
    try {
      const pack = await api.buildTripEssentialsPack({
        trip_id: tripId ?? '',
        trip_name: tripName ?? 'Current Trip',
        waypoints: mappedWaypoints.map(w => ({ lat: w.lat, lng: w.lng, name: w.name, day: w.day, type: w.type })),
        route_coords: usableRoute,
      });
      await saveOfflinePlacePack(pack);
      await reloadPlacePacks();
      onOfflinePlacesChanged?.();
      Alert.alert('Essentials saved', `${pack.points.length} places are now available with this trip offline.`);
    } catch (e: any) {
      setPlaceError(e?.message ?? 'Could not save trip essentials.');
    } finally {
      setPlaceBusy(false);
    }
  }, [onOfflinePlacesChanged, placeBusy, reloadPlacePacks, routeCoords, tripId, tripName, waypoints]);

  const deleteTripEssentials = useCallback(async (packId: string) => {
    await deleteOfflinePlacePack(packId);
    await reloadPlacePacks();
    onOfflinePlacesChanged?.();
  }, [onOfflinePlacesChanged, reloadPlacePacks]);

  const currentPlacePack = placePacks.find(pack => tripId && pack.trip_id === tripId);
  const currentManifestPlacePacks = Object.entries(placeManifest?.packs ?? {})
    .filter(([, entry]) => entry.region_id === selectedState)
    .sort(([, a], [, b]) => a.pack_id.localeCompare(b.pack_id));
  const selectRegion = useCallback((id: string) => {
    setSelectedState(id);
    setSelectedRegionGroup(regionGroupFor(id));
  }, []);

  const downloadRegionPlacePack = useCallback(async (packId: string) => {
    if (placeBusy) return;
    setPlaceBusy(true);
    setPlaceError(null);
    try {
      const pack = await api.getPlacePack(selectedState, packId);
      await saveOfflinePlacePack(pack);
      await reloadPlacePacks();
      onOfflinePlacesChanged?.();
      Alert.alert('Places saved', `${pack.name} saved ${pack.points.length} places for offline use.`);
    } catch (e: any) {
      setPlaceError(e?.message ?? 'Could not download this places pack.');
    } finally {
      setPlaceBusy(false);
    }
  }, [onOfflinePlacesChanged, placeBusy, reloadPlacePacks, selectedState]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={onClose} />

        <View style={[s.sheet, { maxHeight: sheetMaxHeight, paddingBottom: bottomPad }]}>
          {/* ── Header ───────────────────────────────────────────────────── */}
          <View style={s.header}>
            <View style={s.headerAccent} />
            <View style={{ flex: 1 }}>
              <Text style={s.title}>OFFLINE MAPS</Text>
              <Text style={s.subtitle}>Download territories for dead-zone navigation</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={s.closeBtn}>
              <Ionicons name="close" size={18} color={C.text3} />
            </TouchableOpacity>
          </View>

          {/* ── Tabs ─────────────────────────────────────────────────────── */}
          <View style={s.tabs}>
            {(['areas', 'regions'] as const).map(tab => (
              <TouchableOpacity
                key={tab}
                style={[s.tab, activeTab === tab && s.tabActive]}
                onPress={() => setActiveTab(tab)}
              >
                <Text style={[s.tabText, activeTab === tab && s.tabTextActive]}>
                  {tab === 'areas' ? 'LARGE AREAS' : 'REGIONS'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {!user ? (
            <View style={s.noUser}>
              <Ionicons name="lock-closed-outline" size={24} color={C.text3} />
              <Text style={s.noUserText}>SIGN IN TO DOWNLOAD OFFLINE MAPS</Text>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: bottomPad + 28 }}>

              {/* ── Active MLN pack progress ────────────────────────────── */}
              {activePackName && (
                <View style={s.packProgressCard}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <View style={s.pingDot} />
                    <Text style={{ color: C.orange, fontSize: 11, fontFamily: mono, fontWeight: '700', flex: 1 }}>
                      {activePackName.toUpperCase()}
                    </Text>
                    <Text style={{ color: C.orange, fontSize: 13, fontFamily: mono, fontWeight: '900' }}>
                      {Math.round(packProgress?.percentage ?? 0)}%
                    </Text>
                    <TouchableOpacity onPress={() => { activePackName && pausePack(activePackName); setActivePackName(null); }}>
                      <Text style={{ color: C.red, fontSize: 9, fontFamily: mono, fontWeight: '900' }}>■ STOP</Text>
                    </TouchableOpacity>
                  </View>
                  <ShimmerBar pct={packProgress?.percentage ?? 0} />
                  <Text style={{ color: C.text3, fontSize: 9, fontFamily: mono, marginTop: 4 }}>
                    {packProgress?.completedTiles ?? 0} / {packProgress?.expectedTiles ?? '?'} tiles
                    {(packProgress?.sizeMb ?? 0) > 0 ? `  ·  ${packProgress?.sizeMb.toFixed(1)} MB` : ''}
                  </Text>
                </View>
              )}

              {packError && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.red + '18', borderRadius: 6, padding: 10, marginBottom: 10 }}>
                  <Ionicons name="alert-circle-outline" size={12} color={C.red} />
                  <Text style={{ color: C.red, fontSize: 10, fontFamily: mono, flex: 1 }}>{packError}</Text>
                </View>
              )}

              {/* ══════════════════ AREAS TAB ═══════════════════════════ */}
              {activeTab === 'areas' && (
                <>
                  <Section label="CONTINENTAL US — FILE DOWNLOAD" />
                  <Text style={s.hint}>
                    Single-stream download — 100× faster than tile-by-tile.
                    All offline downloads are included. Use Wi-Fi for large packs and keep the app open for the fastest transfer.
                  </Text>
                  <ConusCard
                    state={conusState}
                    totalBytes={conusTotalBytes}
                    region={FILE_REGIONS.conus}
                    onStart={() => authorizeAndRun('conus_map', 'conus_map', 'conus', 'Continental US', () => startDownload('conus'))}
                    onPause={() => pauseDownload('conus')}
                    onResume={() => resumeDownload('conus')}
                    onDelete={() => deleteDownload('conus')}
                  />

                  {/* Trip corridor */}
                  <Section label="TRIP CORRIDOR — ROUTE LINE DOWNLOAD" />
                  {waypoints.length > 0 ? (() => {
                    const name   = (tripName ?? 'Trip') + '-corridor';
                    const cached = useNativeMap
                      ? mlnPacks.some(pack => pack.name === name && pack.complete)
                      : webCachedRegions?.includes(name) ?? false;
                    const busy   = useNativeMap ? activePackName === name : !!webIsDownloading;
                    return (
                      <TouchableOpacity
                        disabled={busy}
                        style={[s.corridorCard, cached && { borderLeftColor: C.green }]}
                        onPress={() => {
                          authorizeAndRun(`corridor:${name}`, 'trip_corridor', name, tripName ?? 'Trip corridor', () => startTripCorridor(name));
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: C.text, fontSize: 12, fontFamily: mono, fontWeight: '800' }}>
                            {(tripName ?? 'CURRENT TRIP').toUpperCase()}
                          </Text>
                          <Text style={{ color: C.text2, fontSize: 10, fontFamily: mono, marginTop: 2 }}>
                            ~10 mi corridor · z10–z15 · vector tiles · trails + roads
                          </Text>
                          {busy && (
                            <Text style={{ color: C.orange, fontSize: 9, fontFamily: mono, marginTop: 3 }}>
                              {useNativeMap
                                ? `${Math.round(packProgress?.percentage ?? 0)}% downloaded`
                                : `${webDownloadProgress ?? 0}% downloaded — check map`}
                            </Text>
                          )}
                        </View>
                        {cached
                          ? <StatusChip label="CACHED" color={C.green} />
                          : <StatusChip label={busy ? 'BUSY' : 'DOWNLOAD'} color={busy ? C.text3 : C.orange} />
                        }
                      </TouchableOpacity>
                    );
                  })() : (
                    <View style={s.noTrip}>
                      <Text style={{ color: C.text3, fontSize: 10, fontFamily: mono, textAlign: 'center' }}>
                        PLAN A TRIP FIRST TO DOWNLOAD ITS CORRIDOR
                      </Text>
                    </View>
                  )}

                  <Section label="TRIP ESSENTIALS — PLACES DOWNLOAD" />
                  {waypoints.length > 0 ? (
                    <View style={[s.corridorCard, currentPlacePack && { borderLeftColor: C.green }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: C.text, fontSize: 12, fontFamily: mono, fontWeight: '800' }}>
                          {(tripName ?? 'CURRENT TRIP').toUpperCase()} PLACES
                        </Text>
                        <Text style={{ color: C.text2, fontSize: 10, fontFamily: mono, marginTop: 2, lineHeight: 14 }}>
                          Fuel, water, trailheads, viewpoints, peaks, and hot springs near the route. Saves to the map for offline use.
                        </Text>
                        {currentPlacePack && (
                          <Text style={{ color: C.green, fontSize: 9, fontFamily: mono, marginTop: 4 }}>
                            {currentPlacePack.point_count} places saved · {currentPlacePack.categories.slice(0, 4).join(', ')}
                          </Text>
                        )}
                        {placeError && (
                          <Text style={{ color: C.red, fontSize: 9, fontFamily: mono, marginTop: 4 }}>{placeError}</Text>
                        )}
                      </View>
                      <View style={{ gap: 8, alignItems: 'flex-end' }}>
                        {currentPlacePack && <StatusChip label="SAVED" color={C.green} />}
                        <TouchableOpacity
                          disabled={placeBusy}
                          onPress={downloadTripEssentials}
                          style={{ borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: placeBusy ? C.s2 : C.orangeGlow, borderWidth: 1, borderColor: placeBusy ? C.border : C.orange + '55' }}
                        >
                          <Text style={{ color: placeBusy ? C.text3 : C.orange, fontSize: 9, fontFamily: mono, fontWeight: '900' }}>
                            {placeBusy ? 'SAVING' : currentPlacePack ? 'REFRESH' : 'DOWNLOAD'}
                          </Text>
                        </TouchableOpacity>
                        {currentPlacePack && (
                          <TouchableOpacity onPress={() => deleteTripEssentials(currentPlacePack.pack_id)} style={{ padding: 4 }}>
                            <Ionicons name="trash-outline" size={16} color={C.red} />
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  ) : (
                    <View style={s.noTrip}>
                      <Text style={{ color: C.text3, fontSize: 10, fontFamily: mono, textAlign: 'center' }}>
                        PLAN A TRIP FIRST TO SAVE ITS OFFLINE PLACES
                      </Text>
                    </View>
                  )}

                  {/* Downloaded packs */}
                  {mlnPacks.length > 0 && (
                    <>
                      <Section label="DOWNLOADED PACKS — TAP TO DELETE" />
                      {mlnPacks.map(pack => (
                        <View key={pack.name} style={s.packRow}>
                          <Ionicons name="checkmark-circle" size={12} color={C.green} />
                          <Text style={s.packName} numberOfLines={1}>{pack.name}</Text>
                          {pack.sizeMb > 0 && (
                            <Text style={s.packSize}>{pack.sizeMb.toFixed(0)} MB</Text>
                          )}
                          <TouchableOpacity onPress={() => deleteMlnPack(pack.name)} style={{ padding: 4 }}>
                            <Ionicons name="close-circle" size={16} color={C.red} />
                          </TouchableOpacity>
                        </View>
                      ))}
                    </>
                  )}
                </>
              )}

              {/* ══════════════════ REGIONS TAB ═════════════════════════ */}
              {activeTab === 'regions' && (
                <>
                  <Section label="REGIONS — MAP + ROUTING PACKS" />
                  <Text style={s.hint}>
                    Pick a region, then download the map file and routing graph separately. U.S. states, Canada, and Mexico are available now.
                    Offline maps, routing, contours, trail systems, and place packs are included. Use Wi-Fi for large regions.
                  </Text>

                  <View style={s.featuredRegionRow}>
                    {(['canada', 'mexico'] as const).map(id => {
                      const region = FILE_REGIONS[id];
                      const mapDone = getState(id).status === 'complete';
                      const routeDone = getRoutingState(id).status === 'complete';
                      const contourDone = getContourState(id).status === 'complete';
                      const selected = selectedState === id;
                      return (
                        <TouchableOpacity
                          key={id}
                          onPress={() => selectRegion(id)}
                          style={[s.featuredRegionCard, selected && s.featuredRegionCardActive]}
                        >
                          <View style={s.featuredRegionIcon}>
                            <Text style={[s.featuredRegionCode, selected && { color: C.orange }]}>{id === 'canada' ? 'CAN' : 'MEX'}</Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={s.featuredRegionTitle}>{region.name}</Text>
                            <Text style={s.featuredRegionSub} numberOfLines={2}>{region.description}</Text>
                            <Text style={[s.featuredRegionStatus, mapDone && routeDone && { color: C.green }]}>
                              {mapDone && routeDone ? `READY${contourDone ? ' · TOPO' : ''}` : `MAP ${mapDone ? 'ON' : 'OFF'} · ROUTE ${routeDone ? 'ON' : 'OFF'}`}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.regionGroupTabs}>
                    {REGION_GROUPS.map(group => {
                      const active = selectedRegionGroup === group.key;
                      return (
                        <TouchableOpacity
                          key={group.key}
                          onPress={() => {
                            setSelectedRegionGroup(group.key);
                            if (!group.ids.includes(selectedState)) setSelectedState(group.ids[0]);
                          }}
                          style={[s.regionGroupTab, active && s.regionGroupTabActive]}
                        >
                          <Text style={[s.regionGroupTabText, active && { color: C.orange }]}>{group.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>

                  {(() => {
                    const group = REGION_GROUPS.find(g => g.key === selectedRegionGroup) ?? REGION_GROUPS[0];
                    return (
                      <View style={s.regionPickerPanel}>
                        <View style={s.regionPickerHead}>
                          <View>
                            <Text style={s.regionPickerTitle}>{group.title}</Text>
                            <Text style={s.regionPickerSub}>{group.subtitle}</Text>
                          </View>
                          <Text style={s.regionPickerCount}>{group.ids.length}</Text>
                        </View>
                        <View style={s.stateGrid}>
                          {group.ids.map(id => {
                            const region = FILE_REGIONS[id as keyof typeof FILE_REGIONS];
                            if (!region) return null;
                            const mapDone = getState(id).status === 'complete';
                            const routeDone = getRoutingState(id).status === 'complete';
                            const contourDone = getContourState(id).status === 'complete';
                            const trailDone = getTrailState(id).status === 'complete';
                            const placesDone = placePacks.some(pack => pack.region_id === id);
                            const placesPublished = Object.values(placeManifest?.packs ?? {}).some(entry => entry.region_id === id);
                            const mapPublished = isFilePublished(id);
                            const routePublished = isRoutingPublished(id);
                            const contourPublished = isContourPublished(id);
                            const trailPublished = isTrailPublished(id);
                            const available = mapPublished && routePublished;
                            const selected = selectedState === id;
                            const code = id === 'canada' ? 'CAN' : id === 'mexico' ? 'MEX' : id.toUpperCase();
                            return (
                              <TouchableOpacity
                                key={id}
                                onPress={() => selectRegion(id)}
                                style={[
                                  s.statePick,
                                  !available && { opacity: 0.72 },
                                  selected && { borderColor: C.orange, backgroundColor: C.orangeGlow },
                                ]}
                              >
                                <View style={s.statePickTop}>
                                  <Text style={[s.statePickCode, selected && { color: C.orange }]}>{code}</Text>
                                  {(mapDone || routeDone) && <Ionicons name="checkmark-circle" size={13} color={C.green} />}
                                </View>
                                <Text style={s.statePickName} numberOfLines={1}>{region.name}</Text>
                                <Text style={{ color: mapDone && routeDone ? C.green : C.text3, fontSize: 8, fontFamily: mono, marginTop: 4 }}>
                                  {`${mapDone || mapPublished ? 'MAP' : '--'} · ${routeDone || routePublished ? 'ROUTE' : '--'} · ${trailDone || trailPublished ? 'TRAILS' : '--'} · ${contourDone || contourPublished ? 'TOPO' : '--'} · ${placesDone || placesPublished ? 'PLACES' : '--'}`}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </View>
                    );
                  })()}

                  {(() => {
                    const mapRegion = FILE_REGIONS[selectedState as keyof typeof FILE_REGIONS];
                    const routingRegion = ROUTING_REGIONS[selectedState as keyof typeof ROUTING_REGIONS];
                    const contourRegion = CONTOUR_REGIONS[selectedState as keyof typeof CONTOUR_REGIONS];
                    const trailRegion = TRAIL_REGIONS[selectedState];
                    const mapState = getState(selectedState);
                    const routingState = getRoutingState(selectedState);
                    const contourState = getContourState(selectedState);
                    const trailState = getTrailState(selectedState);
                    const mapPublished = isFilePublished(selectedState);
                    const routePublished = isRoutingPublished(selectedState);
                    const contourPublished = isContourPublished(selectedState);
                    const trailPublished = isTrailPublished(selectedState);
                    const regionAvailable = mapPublished && routePublished;
                    const mapBusy = mapState.status === 'downloading' || mapState.status === 'paused';
                    const routeBusy = routingState.status === 'downloading' || routingState.status === 'paused';
                    const contourBusy = contourState.status === 'downloading' || contourState.status === 'paused';
                    const trailBusy = trailState.status === 'downloading' || trailState.status === 'paused';
                    const selectedCode = selectedState === 'canada' ? 'CAN' : selectedState === 'mexico' ? 'MEX' : selectedState.toUpperCase();
                    const savedRegionPlacePacks = placePacks.filter(pack => pack.region_id === selectedState);
                    const savedRegionPlaceCount = savedRegionPlacePacks.reduce((sum, pack) => sum + (pack.point_count || 0), 0);
                    const regionPlacesAvailable = currentManifestPlacePacks.length > 0;
                    const regionPlacesReady = savedRegionPlacePacks.length > 0;
                    const regionPlacesLabel = regionPlacesReady
                      ? `PLACES ${savedRegionPlaceCount}`
                      : regionPlacesAvailable ? 'PLACES MISSING' : 'PLACES PLANNED';
                    return (
                      <>
                        <StateReadinessPanel
                          mapReady={mapState.status === 'complete'}
                          routeReady={routingState.status === 'complete'}
                          contourReady={contourState.status === 'complete'}
                          contourAvailable={contourPublished}
                          trailReady={trailState.status === 'complete'}
                          trailAvailable={trailPublished}
                          placeReady={regionPlacesReady}
                          placeAvailable={regionPlacesAvailable}
                          placeLabel={regionPlacesLabel}
                          mapBusy={mapBusy}
                          routeBusy={routeBusy}
                          contourBusy={contourBusy}
                          trailBusy={trailBusy}
                          available={regionAvailable}
                          onDownloadMissing={() => {
                            const label = FILE_REGIONS[selectedState as keyof typeof FILE_REGIONS]?.name ?? selectedState.toUpperCase();
                            if (mapState.status === 'idle' || mapState.status === 'error') {
                              authorizeAndRun(`map:${selectedState}`, 'state_map', selectedState, `${label} map`, () => startDownload(selectedState));
                            }
                            if (routingState.status === 'idle' || routingState.status === 'error') {
                              authorizeAndRun(`route:${selectedState}`, 'state_route', selectedState, `${label} routing`, () => startRoutingDownload(selectedState));
                            }
                            if (mapState.status === 'paused') resumeDownload(selectedState);
                            if (routingState.status === 'paused') resumeRoutingDownload(selectedState);
                          }}
                        />
                        {!regionAvailable ? (
                          <View style={{ backgroundColor: C.s1, borderRadius: 10, borderWidth: 1, borderColor: C.border, padding: 14 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                              <View style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: C.s2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.orange + '35' }}>
                                <Text style={{ color: C.orange, fontSize: 12, fontFamily: mono, fontWeight: '900' }}>{selectedCode}</Text>
                              </View>
                              <View style={{ flex: 1 }}>
                                <Text style={{ color: C.text, fontSize: 12, fontFamily: mono, fontWeight: '900' }}>
                                  {mapRegion.name.toUpperCase()} PACKS ARE BEING PREPARED
                                </Text>
                                <Text style={{ color: C.text3, fontSize: 9, fontFamily: mono, marginTop: 3, lineHeight: 13 }}>
                                  Download buttons will appear as soon as this region is ready.
                                </Text>
                              </View>
                            </View>
                            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                              <StatusChip label={mapPublished ? 'MAP READY' : `MAP ~${mapRegion.estimatedGb} GB`} color={mapPublished ? C.green : C.text3} />
                              <StatusChip label={routePublished ? 'ROUTE READY' : `ROUTE ~${routingRegion?.estimatedGb ?? 0} GB`} color={routePublished ? C.green : C.text3} />
                            </View>
                            {'storageNote' in mapRegion && (
                              <Text style={{ color: C.text3, fontSize: 9, fontFamily: mono, marginTop: 10 }}>
                                {(mapRegion as any).storageNote}
                              </Text>
                            )}
                          </View>
                        ) : (
                          <>
                        <Section label={`${mapRegion.name.toUpperCase()} — MAP DETAILS`} />
                        <ConusCard
                          state={mapState}
                          totalBytes={getTotalBytes(selectedState)}
                          region={mapRegion as any}
                          code={selectedCode}
                          onStart={() => authorizeAndRun(`map:${selectedState}`, 'state_map', selectedState, `${mapRegion.name} map`, () => startDownload(selectedState))}
                          onPause={() => pauseDownload(selectedState)}
                          onResume={() => resumeDownload(selectedState)}
                          onDelete={() => deleteDownload(selectedState)}
                          completeTitle="MAP SAVED"
                          completeText="Roads, trails, towns, parks, and labels are available offline for this region."
                        />

                        <Section label={`${mapRegion.name.toUpperCase()} — ROUTING DETAILS`} />
                        <ConusCard
                          state={routingState}
                          totalBytes={getRoutingTotalBytes(selectedState)}
                          region={routingRegion as any}
                          code={selectedCode}
                          onStart={() => authorizeAndRun(`route:${selectedState}`, 'state_route', selectedState, `${mapRegion.name} routing`, () => startRoutingDownload(selectedState))}
                          onPause={() => pauseRoutingDownload(selectedState)}
                          onResume={() => resumeRoutingDownload(selectedState)}
                          onDelete={() => deleteRoutingDownload(selectedState)}
                          completeTitle="ROUTING SAVED"
                          completeText="Offline driving routes can use this region without needing signal."
                        />
                        <Section label={`${mapRegion.name.toUpperCase()} — TRAIL SYSTEMS`} />
                        {trailPublished ? (
                          <ConusCard
                            state={trailState}
                            totalBytes={getTrailTotalBytes(selectedState)}
                            region={trailRegion as any}
                            code={selectedCode}
                            onStart={() => authorizeAndRun(`trail:${selectedState}`, 'state_trails' as OfflineAssetType, selectedState, `${mapRegion.name} trail systems`, () => startTrailDownload(selectedState))}
                            onPause={() => pauseTrailDownload(selectedState)}
                            onResume={() => resumeTrailDownload(selectedState)}
                            onDelete={() => deleteTrailDownload(selectedState)}
                            completeTitle="TRAILS SAVED"
                            completeText="Trail lines and follow mode are available offline for this region."
                          />
                        ) : (
                          <View style={s.contourPlannedCard}>
                            <View style={s.contourIcon}>
                              <Ionicons name="trail-sign-outline" size={18} color={C.orange} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={s.contourPlannedTitle}>TRAIL PACK PLANNED</Text>
                              <Text style={s.contourPlannedText}>
                                Downloadable trail systems for this region are coming soon. The MVUM layer can still help check legal motorized access where available.
                              </Text>
                              <Text style={s.contourPlannedMeta}>Estimated starting size: ~{trailRegion?.estimatedGb ?? 0.1} GB</Text>
                            </View>
                          </View>
                        )}
                          </>
                        )}
                        {currentManifestPlacePacks.length > 0 && (
                          <>
                            <Section label={`${mapRegion.name.toUpperCase()} — PLACES DETAILS`} />
                            {currentManifestPlacePacks.map(([manifestKey, manifestEntry]) => {
                              const saved = placePacks.find(pack => pack.region_id === selectedState && pack.pack_id === `${selectedState}-${manifestEntry.pack_id}`);
                              const def = placeManifest?.definitions?.[manifestEntry.pack_id];
                              return (
                                <View key={manifestKey} style={[s.corridorCard, { marginBottom: 10 }, saved && { borderLeftColor: C.green }]}>
                                  <View style={{ flex: 1 }}>
                                    <Text style={{ color: C.text, fontSize: 12, fontFamily: mono, fontWeight: '800' }}>
                                      {(def?.name ?? manifestEntry.pack_id).toUpperCase()} PLACES
                                    </Text>
                                    <Text style={{ color: C.text2, fontSize: 10, fontFamily: mono, marginTop: 2, lineHeight: 14 }}>
                                      {def?.description ?? 'Offline places saved as map pins.'}
                                    </Text>
                                    <Text style={{ color: saved ? C.green : C.text3, fontSize: 9, fontFamily: mono, marginTop: 4 }}>
                                      {saved
                                        ? `${saved.point_count} places on device`
                                        : `${manifestEntry.point_count} places · ${fmtBytes(manifestEntry.size)}`}
                                    </Text>
                                    {placeError && (
                                      <Text style={{ color: C.red, fontSize: 9, fontFamily: mono, marginTop: 4 }}>{placeError}</Text>
                                    )}
                                  </View>
                                  <View style={{ gap: 8, alignItems: 'flex-end' }}>
                                    {saved && <StatusChip label="SAVED" color={C.green} />}
                                    <TouchableOpacity
                                      disabled={placeBusy}
                                      onPress={() => downloadRegionPlacePack(manifestEntry.pack_id)}
                                      style={{ borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: placeBusy ? C.s2 : C.orangeGlow, borderWidth: 1, borderColor: placeBusy ? C.border : C.orange + '55' }}
                                    >
                                      <Text style={{ color: placeBusy ? C.text3 : C.orange, fontSize: 9, fontFamily: mono, fontWeight: '900' }}>
                                        {placeBusy ? 'SAVING' : saved ? 'REFRESH' : 'DOWNLOAD'}
                                      </Text>
                                    </TouchableOpacity>
                                    {saved && (
                                      <TouchableOpacity onPress={() => deleteTripEssentials(saved.pack_id)} style={{ padding: 4 }}>
                                        <Ionicons name="trash-outline" size={16} color={C.red} />
                                      </TouchableOpacity>
                                    )}
                                  </View>
                                </View>
                              );
                            })}
                          </>
                        )}
                        <Section label={`${mapRegion.name.toUpperCase()} — TOPO CONTOURS`} />
                        {contourPublished ? (
                          <ConusCard
                            state={contourState}
                            totalBytes={getContourTotalBytes(selectedState)}
                            region={contourRegion as any}
                            code={selectedCode}
                            onStart={() => authorizeAndRun(`contour:${selectedState}`, 'state_contours', selectedState, `${mapRegion.name} contours`, () => startContourDownload(selectedState))}
                            onPause={() => pauseContourDownload(selectedState)}
                            onResume={() => resumeContourDownload(selectedState)}
                            onDelete={() => deleteContourDownload(selectedState)}
                            completeTitle="✓ CONTOURS ON DEVICE"
                            completeText="Topo contour lines are saved as a separate overlay pack, so base maps stay lean."
                          />
                        ) : (
                          <View style={s.contourPlannedCard}>
                            <View style={s.contourIcon}>
                              <Ionicons name="analytics-outline" size={18} color={C.orange} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={s.contourPlannedTitle}>CONTOUR PACK PLANNED</Text>
                              <Text style={s.contourPlannedText}>
                                Topo contour downloads for this region are coming soon. They will appear as an optional map layer.
                              </Text>
                              <Text style={s.contourPlannedMeta}>Estimated starting size: ~{contourRegion?.estimatedGb ?? 0.1} GB</Text>
                            </View>
                          </View>
                        )}
                      </>
                    );
                  })()}
                </>
              )}

            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ── Styles — built with C from useTheme() in main component ──────────────────
function makeStyles(C: ColorPalette) {
  return StyleSheet.create({
    overlay:       { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
    sheet: {
      backgroundColor: C.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20,
      paddingHorizontal: 16, paddingTop: 16,
      borderTopWidth: 1, borderTopColor: C.border,
    },
    header:        { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
    headerAccent:  { width: 4, height: 32, backgroundColor: C.orange, borderRadius: 2 },
    title:         { color: C.text, fontSize: 15, fontFamily: mono, fontWeight: '900', letterSpacing: 1.5 },
    subtitle:      { color: C.text3, fontSize: 9, fontFamily: mono, letterSpacing: 0.5, marginTop: 2 },
    closeBtn:      { padding: 6 },
    tabs: {
      flexDirection: 'row', backgroundColor: C.s1, borderRadius: 8, padding: 3, marginBottom: 4, borderWidth: 1, borderColor: C.border,
    },
    tab:           { flex: 1, paddingVertical: 7, alignItems: 'center', borderRadius: 6 },
    tabActive:     { backgroundColor: C.s2 },
    tabText:       { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '800', letterSpacing: 1 },
    tabTextActive: { color: C.orange },
    noUser:        { alignItems: 'center', paddingVertical: 40, gap: 12 },
    noUserText:    { color: C.text3, fontSize: 10, fontFamily: mono, letterSpacing: 1 },
    hint: {
      color: C.text3, fontSize: 9, fontFamily: mono, lineHeight: 14,
      marginBottom: 10, paddingLeft: 4,
    },
    packProgressCard: {
      backgroundColor: C.s1, borderRadius: 10, padding: 12, marginBottom: 10,
      borderWidth: 1, borderColor: C.orange + '40', borderLeftWidth: 3, borderLeftColor: C.orange,
    },
    pingDot: {
      width: 6, height: 6, borderRadius: 3, backgroundColor: C.orange,
    },
    corridorCard: {
      flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14,
      backgroundColor: C.s1, borderRadius: 10, borderLeftWidth: 3, borderLeftColor: C.orange,
    },
    noTrip: {
      padding: 20, backgroundColor: C.s1, borderRadius: 10, alignItems: 'center',
      borderWidth: 1, borderColor: C.border, borderStyle: 'dashed',
    },
    packRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingVertical: 9, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: C.border,
    },
    packName:      { flex: 1, color: C.text2, fontSize: 11, fontFamily: mono },
    packSize:      { color: C.text3, fontSize: 10, fontFamily: mono },
    featuredRegionRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
    featuredRegionCard: {
      flex: 1, minHeight: 104, flexDirection: 'row', gap: 10,
      borderWidth: 1, borderColor: C.border, borderRadius: 12,
      backgroundColor: C.s1, padding: 12,
    },
    featuredRegionCardActive: { borderColor: C.orange, backgroundColor: C.orangeGlow },
    featuredRegionIcon: {
      width: 42, height: 42, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: C.orange + '45', backgroundColor: C.s2,
    },
    featuredRegionCode: { color: C.text, fontSize: 11, fontFamily: mono, fontWeight: '900', letterSpacing: 1 },
    featuredRegionTitle: { color: C.text, fontSize: 12, fontFamily: mono, fontWeight: '900' },
    featuredRegionSub: { color: C.text3, fontSize: 9, fontFamily: mono, lineHeight: 13, marginTop: 3 },
    featuredRegionStatus: { color: C.text3, fontSize: 8, fontFamily: mono, fontWeight: '900', marginTop: 6 },
    regionGroupTabs: { gap: 8, paddingBottom: 10 },
    regionGroupTab: {
      paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
      borderWidth: 1, borderColor: C.border, backgroundColor: C.s1,
    },
    regionGroupTabActive: { borderColor: C.orange, backgroundColor: C.orangeGlow },
    regionGroupTabText: { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '900', letterSpacing: 0.6 },
    regionPickerPanel: {
      borderWidth: 1, borderColor: C.border, borderRadius: 14,
      backgroundColor: C.s1, padding: 12, marginBottom: 12,
    },
    regionPickerHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginBottom: 10 },
    regionPickerTitle: { color: C.text, fontSize: 13, fontFamily: mono, fontWeight: '900' },
    regionPickerSub: { color: C.text3, fontSize: 9, fontFamily: mono, marginTop: 3 },
    regionPickerCount: { color: C.orange, fontSize: 11, fontFamily: mono, fontWeight: '900' },
    stateGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    statePick: {
      width: '31%', minWidth: 86, paddingVertical: 9, paddingHorizontal: 8,
      borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.s1,
    },
    statePickTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
    statePickCode: { color: C.text, fontSize: 12, fontFamily: mono, fontWeight: '900', letterSpacing: 1 },
    statePickName: { color: C.text2, fontSize: 9, fontFamily: mono, marginTop: 2 },
    contourPlannedCard: {
      flexDirection: 'row', gap: 12, padding: 14,
      borderRadius: 12, borderWidth: 1, borderColor: C.orange + '30',
      backgroundColor: C.orangeGlow,
    },
    contourIcon: {
      width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
      backgroundColor: C.s1, borderWidth: 1, borderColor: C.orange + '45',
    },
    contourPlannedTitle: { color: C.orange, fontSize: 11, fontFamily: mono, fontWeight: '900', letterSpacing: 0.6 },
    contourPlannedText: { color: C.text2, fontSize: 10, fontFamily: mono, lineHeight: 14, marginTop: 4 },
    contourPlannedMeta: { color: C.text3, fontSize: 9, fontFamily: mono, marginTop: 6 },
  });
}
