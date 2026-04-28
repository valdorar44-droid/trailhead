/**
 * Offline Maps — Field Ops Terminal
 *
 * Two-track download system:
 *   1. FILE DOWNLOAD  — single HTTP stream of full PMTiles file (conus.pmtiles)
 *      Fast: 1 GB in ~2 min on wifi. Uses expo-file-system resumable download.
 *      Full offline tile serving requires the next binary build (local tile server).
 *   2. MLN PACK       — per-tile download via MapLibre offline manager.
 *      Best for states / trip corridors (small enough to complete quickly).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity, ScrollView,
  StyleSheet, Animated, Easing,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '@/lib/store';
import { useTheme, mono, type ColorPalette } from '@/lib/design';
import {
  useOfflineFiles, FILE_REGIONS, fmtBytes, fmtSpeed, fmtEta,
  type FileDownloadState,
} from '@/lib/useOfflineFiles';
import {
  downloadPack, deletePack, getInstalledPacks, pausePack,
  US_STATE_PACKS, routeCorriderBounds,
  type InstalledPack, type PackProgress,
} from './offlineManager';
import type { WP } from './types';


interface Props {
  visible:     boolean;
  onClose:     () => void;
  waypoints:   WP[];
  tripName:    string | null;
  useNativeMap: boolean;
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

// ── CONUS file download card ──────────────────────────────────────────────────
function ConusCard({ state, totalBytes, onStart, onPause, onResume, onDelete }: {
  state:      FileDownloadState;
  totalBytes: number;
  onStart:    () => void;
  onPause:    () => void;
  onResume:   () => void;
  onDelete:   () => void;
}) {
  const C = useTheme();
  const region = FILE_REGIONS.conus;
  const isActive   = state.status === 'downloading';
  const isPaused   = state.status === 'paused';
  const isComplete = state.status === 'complete';
  const isError    = state.status === 'error';
  const accentColor = isComplete ? C.green : isActive || isPaused ? C.orange : C.border;

  return (
    <View style={{ borderLeftWidth: 3, borderLeftColor: accentColor, backgroundColor: C.s1, borderRadius: 10, overflow: 'hidden' }}>
      {/* Header row */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', padding: 14, paddingBottom: isActive || isPaused ? 8 : 14 }}>
        <View style={{ width: 44, height: 44, backgroundColor: C.s2, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginRight: 12, borderWidth: 1, borderColor: C.border }}>
          <Text style={{ fontSize: 22 }}>🗺️</Text>
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
              <Text style={{ fontSize: 10 }}>⚡</Text>
              <Text style={{ color: C.text3, fontSize: 9, fontFamily: mono, flex: 1, lineHeight: 13 }}>
                Keep app open + screen on. If interrupted, tap RESUME — download continues from where it stopped.
              </Text>
            </View>
          )}
          {isPaused && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, backgroundColor: C.orangeGlow, borderRadius: 6, padding: 8 }}>
              <Text style={{ fontSize: 10 }}>⏸</Text>
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
            ✓ FILE ON DEVICE — FULL OFFLINE TILES IN NEXT BUILD
          </Text>
          <Text style={{ color: C.text3, fontSize: 9, fontFamily: mono, marginTop: 2 }}>
            The map file is downloaded. A native tile server (next app update) will activate full offline map rendering.
          </Text>
        </View>
      )}
    </View>
  );
}

// ── State pack row ────────────────────────────────────────────────────────────
function StateRow({ code, st, isCached, isDownloading, onDownload }: {
  code:          string;
  st:            { name: string; bounds: [[number,number],[number,number]]; emoji: string };
  isCached:      boolean;
  isDownloading: boolean;
  onDownload:    () => void;
}) {
  const C = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: C.border }}>
      <Text style={{ width: 28, fontSize: 14 }}>{st.emoji}</Text>
      <Text style={{ color: C.text, fontSize: 11, fontFamily: mono, fontWeight: '700', width: 26, marginRight: 6 }}>{code}</Text>
      <Text style={{ flex: 1, color: C.text2, fontSize: 10, fontFamily: mono }}>{st.name}</Text>
      {isCached ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name="checkmark-circle" size={12} color={C.green} />
          <Text style={{ color: C.green, fontSize: 9, fontFamily: mono, fontWeight: '700' }}>READY</Text>
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
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function OfflineModal({ visible, onClose, waypoints, tripName, useNativeMap }: Props) {
  const user        = useStore(st => st.user);
  const mapboxToken = useStore(st => st.mapboxToken);
  const C           = useTheme();
  const s           = makeStyles(C);

  // File-based download (CONUS)
  const { getState, startDownload, pauseDownload, resumeDownload, deleteDownload, getTotalBytes } = useOfflineFiles();
  const conusState    = getState('conus');
  const conusTotalBytes = getTotalBytes('conus');

  // MLN pack-based download (states + trip corridor)
  const [mlnPacks,       setMlnPacks]       = useState<InstalledPack[]>([]);
  const [activePackName, setActivePackName] = useState<string | null>(null);
  const [packProgress,   setPackProgress]   = useState<PackProgress | null>(null);
  const [packError,      setPackError]      = useState<string | null>(null);
  const [activeTab,      setActiveTab]      = useState<'areas' | 'states'>('areas');

  useEffect(() => {
    if (visible) getInstalledPacks().then(setMlnPacks).catch(() => {});
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

  const deleteMlnPack = useCallback(async (name: string) => {
    await deletePack(name);
    setMlnPacks(prev => prev.filter(p => p.name !== name));
  }, []);

  const corridorBounds = routeCorriderBounds(waypoints);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={onClose} />

        <View style={s.sheet}>
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
            {(['areas', 'states'] as const).map(tab => (
              <TouchableOpacity
                key={tab}
                style={[s.tab, activeTab === tab && s.tabActive]}
                onPress={() => setActiveTab(tab)}
              >
                <Text style={[s.tabText, activeTab === tab && s.tabTextActive]}>
                  {tab === 'areas' ? 'LARGE AREAS' : 'US STATES'}
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
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>

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
                    Download once, navigate forever.
                  </Text>
                  <ConusCard
                    state={conusState}
                    totalBytes={conusTotalBytes}
                    onStart={() => startDownload('conus')}
                    onPause={() => pauseDownload('conus')}
                    onResume={() => resumeDownload('conus')}
                    onDelete={() => deleteDownload('conus')}
                  />

                  {/* Trip corridor */}
                  <Section label="TRIP CORRIDOR — MLN PACK" />
                  {waypoints.length > 0 && corridorBounds ? (() => {
                    const name    = (tripName ?? 'Trip') + '-corridor';
                    const cached  = mlnPacks.some(p => p.name === name);
                    return (
                      <TouchableOpacity
                        disabled={!!activePackName}
                        style={[s.corridorCard, cached && { borderLeftColor: C.green }]}
                        onPress={() => startMlnPack(name, corridorBounds, 10, 16)}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: C.text, fontSize: 12, fontFamily: mono, fontWeight: '800' }}>
                            {(tripName ?? 'CURRENT TRIP').toUpperCase()}
                          </Text>
                          <Text style={{ color: C.text2, fontSize: 10, fontFamily: mono, marginTop: 2 }}>
                            20 km buffer · z10–z16 · trails + roads
                          </Text>
                        </View>
                        {cached
                          ? <StatusChip label="CACHED" color={C.green} />
                          : <StatusChip label={activePackName ? 'BUSY' : 'DOWNLOAD'} color={activePackName ? C.text3 : C.orange} />
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

              {/* ══════════════════ STATES TAB ══════════════════════════ */}
              {activeTab === 'states' && (
                <>
                  <Section label="STATE PACKS — MLN TILE CACHE · z10–z14" />
                  <Text style={s.hint}>
                    Individual state downloads. Good for regional trips where CONUS is overkill.
                  </Text>
                  {Object.entries(US_STATE_PACKS).map(([code, st]) => (
                    <StateRow
                      key={code}
                      code={code}
                      st={st}
                      isCached={mlnPacks.some(p => p.name === st.name)}
                      isDownloading={!!activePackName}
                      onDownload={() => startMlnPack(st.name, st.bounds, 10, 14)}
                    />
                  ))}
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
      paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4, maxHeight: '91%',
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
  });
}
