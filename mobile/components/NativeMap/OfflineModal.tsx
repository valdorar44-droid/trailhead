/**
 * Offline maps download modal — works with both the WebView tile cache
 * (USE_NATIVE_MAP=false) and the native MLN offline pack system
 * (USE_NATIVE_MAP=true).
 *
 * When native: createPack / deletePack / listPacks via MLN OfflineStorage.
 * When WebView: same UI but drives the existing download_tiles_bbox messages.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '@/lib/store';
import { useTheme, mono } from '@/lib/design';
import {
  downloadPack, deletePack, getInstalledPacks, pausePack,
  CONUS_PACK, US_STATE_PACKS, routeCorriderBounds,
  type InstalledPack, type PackProgress,
} from './offlineManager';
import type { WP } from './types';

interface Props {
  visible: boolean;
  onClose: () => void;
  waypoints: WP[];
  tripName: string | null;
  useNativeMap: boolean;
  // WebView path props (used when useNativeMap=false)
  onWebDownloadBbox?: (opts: { n: number; s: number; e: number; w: number; minZ: number; maxZ: number; label: string; vectorOnly: boolean }) => void;
  onWebDownloadRoute?: (opts: { bufferKm: number; minZ: number; maxZ: number; label: string; vectorOnly: boolean }) => void;
  onWebCancelDownload?: () => void;
  onWebClearRegion?: (label: string) => void;
  webIsDownloading?: boolean;
  webDownloadProgress?: number;
  webDownloadSaved?: number;
  webDownloadTotal?: number;
  webDownloadMB?: string;
  webCachedRegions?: string[];
  onWebLoadRegion?: (lat: number, lng: number, zoom: number, name: string) => void;
}

export default function OfflineModal({
  visible, onClose, waypoints, tripName, useNativeMap,
  onWebDownloadBbox, onWebDownloadRoute, onWebCancelDownload, onWebClearRegion,
  webIsDownloading = false, webDownloadProgress = 0, webDownloadSaved = 0,
  webDownloadTotal = 0, webDownloadMB = '0', webCachedRegions = [],
  onWebLoadRegion,
}: Props) {
  const user = useStore(s => s.user);
  const mapboxToken = useStore(s => s.mapboxToken);
  const C = useTheme();
  const s = styles(C);

  // Native pack state
  const [nativePacks,     setNativePacks]     = useState<InstalledPack[]>([]);
  const [activePackName,  setActivePackName]  = useState<string | null>(null);
  const [packProgress,    setPackProgress]    = useState<PackProgress | null>(null);
  const [packError,       setPackError]       = useState<string | null>(null);
  const progressRef = useRef<PackProgress | null>(null);

  // Reload native packs when modal opens
  useEffect(() => {
    if (visible && useNativeMap) {
      getInstalledPacks().then(setNativePacks).catch(() => {});
    }
  }, [visible, useNativeMap]);

  const startNativePack = useCallback(async (
    name: string, bounds: [[number,number],[number,number]],
    minZoom: number, maxZoom: number,
  ) => {
    setActivePackName(name);
    setPackProgress(null);
    setPackError(null);
    onClose();

    await downloadPack(
      name, bounds, minZoom, maxZoom, mapboxToken || '',
      (progress) => {
        progressRef.current = progress;
        setPackProgress({ ...progress });
      },
      () => {
        setActivePackName(null);
        setPackProgress(null);
        getInstalledPacks().then(setNativePacks).catch(() => {});
      },
      (msg) => {
        setPackError(msg);
        setActivePackName(null);
        setPackProgress(null);
      },
    );
  }, [mapboxToken, onClose]);

  const deleteNativePack = useCallback(async (name: string) => {
    await deletePack(name);
    setNativePacks(prev => prev.filter(p => p.name !== name));
  }, []);

  const isDownloading = useNativeMap ? !!activePackName : webIsDownloading;

  return (
    <>
      {/* Active download progress bar (outside modal, always visible) */}
      {isDownloading && (
        <View style={s.progressBarWrapper}>
          <View style={s.progressBarBg}>
            <View style={[s.progressBarFill, {
              width: `${useNativeMap ? (packProgress?.percentage ?? 0) : webDownloadProgress}%` as any,
            }]} />
          </View>
          <Text style={s.progressBarText}>
            {useNativeMap
              ? `${Math.round(packProgress?.percentage ?? 0)}% · ${(packProgress?.sizeMb ?? 0).toFixed(1)} MB`
              : `${webDownloadProgress}% · ${webDownloadMB} MB`}
          </Text>
        </View>
      )}

      <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
        <View style={s.overlay}>
          <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={onClose} />
          <View style={s.sheet}>
            {/* Header */}
            <View style={s.header}>
              <Ionicons name="map-outline" size={18} color={C.orange} />
              <Text style={s.title}>OFFLINE MAPS</Text>
              <TouchableOpacity onPress={onClose} style={s.closeBtn}>
                <Ionicons name="close" size={18} color={C.text3} />
              </TouchableOpacity>
            </View>

            {/* Feature chips */}
            <View style={s.chips}>
              {['Trails & 4WD', 'Roads + towns', 'Parks & forests', 'Offline nav'].map(chip => (
                <View key={chip} style={s.chip}>
                  <Text style={s.chipText}>{chip}</Text>
                </View>
              ))}
            </View>

            {!user ? (
              <View style={s.noUser}>
                <Text style={s.noUserText}>Sign in to download offline maps.</Text>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>

                {/* Active download progress */}
                {isDownloading && (
                  <View style={s.progressCard}>
                    <View style={s.progressRow}>
                      <ActivityIndicator size="small" color={C.orange} />
                      <Text style={s.progressLabel}>
                        {activePackName ?? 'Downloading'} ·{' '}
                        {useNativeMap
                          ? `${Math.round(packProgress?.percentage ?? 0)}%`
                          : `${webDownloadProgress}%`}
                      </Text>
                      <TouchableOpacity onPress={useNativeMap
                        ? () => { activePackName && pausePack(activePackName); setActivePackName(null); }
                        : onWebCancelDownload}
                      >
                        <Text style={s.cancelText}>CANCEL</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={s.progressBg}>
                      <View style={[s.progressFill, {
                        width: `${useNativeMap ? (packProgress?.percentage ?? 0) : webDownloadProgress}%` as any,
                      }]} />
                    </View>
                  </View>
                )}

                {/* Pack error */}
                {packError && (
                  <View style={s.errorCard}>
                    <Ionicons name="alert-circle-outline" size={14} color="#ef4444" />
                    <Text style={s.errorText}>{packError}</Text>
                  </View>
                )}

                {/* ── CONUS download ─────────────────────────────────── */}
                {(() => {
                  const isCached = useNativeMap
                    ? nativePacks.some(p => p.name === CONUS_PACK.name)
                    : webCachedRegions.includes('Continental US');
                  return (
                    <TouchableOpacity
                      disabled={isDownloading}
                      style={[s.conusBtn, isCached && s.conusBtnCached]}
                      onPress={() => {
                        if (useNativeMap) {
                          startNativePack(CONUS_PACK.name, CONUS_PACK.bounds, CONUS_PACK.minZoom, CONUS_PACK.maxZoom);
                        } else {
                          onWebDownloadBbox?.({ n: 49.5, s: 24.5, e: -66.5, w: -125.0, minZ: 3, maxZ: 12, label: 'Continental US', vectorOnly: true });
                          onClose();
                        }
                      }}
                    >
                      <View style={s.conusIcon}>
                        <Ionicons name="globe-outline" size={22} color={isCached ? C.green : C.orange} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.conusTitle}>{isCached ? '✓ ' : ''}DOWNLOAD CONTINENTAL US</Text>
                        <Text style={s.conusMeta}>All roads · trails · towns · ~1 GB</Text>
                      </View>
                      <Ionicons name={isCached ? 'refresh-outline' : 'cloud-download-outline'} size={20} color={isCached ? C.green : C.orange} />
                    </TouchableOpacity>
                  );
                })()}

                {/* ── Trip corridor ──────────────────────────────────── */}
                <Text style={s.sectionLabel}>MY TRIP · 20KM BUFFER AROUND ROUTE</Text>
                {waypoints.length > 0 ? (() => {
                  const label = tripName ?? 'Trip';
                  const cb = routeCorriderBounds(waypoints);
                  const isCached = useNativeMap
                    ? nativePacks.some(p => p.name === label + '-trails')
                    : webCachedRegions.includes(label + '-vec');
                  return (
                    <View style={{ gap: 8 }}>
                      <TouchableOpacity
                        disabled={isDownloading || !cb}
                        style={[s.tripBtn, isCached && s.tripBtnCached]}
                        onPress={() => {
                          if (!cb) return;
                          const name = label + '-trails';
                          if (useNativeMap) {
                            startNativePack(name, cb, 10, 16);
                          } else {
                            onWebDownloadRoute?.({ bufferKm: 20, minZ: 10, maxZ: 16, label: label + '-vec', vectorOnly: true });
                            onClose();
                          }
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={s.tripName} numberOfLines={1}>{label.toUpperCase()}</Text>
                          <Text style={s.tripMeta}>TRAILS ONLY · fastest download{isCached ? ' · ✓ cached' : ''}</Text>
                        </View>
                        <Ionicons name={isCached ? 'refresh-outline' : 'trail-sign-outline'} size={20} color={isCached ? C.green : C.orange} />
                      </TouchableOpacity>
                    </View>
                  );
                })() : (
                  <Text style={s.noTrip}>Plan a trip first to download its trail corridor</Text>
                )}

                {/* ── State downloads ───────────────────────────────── */}
                <Text style={[s.sectionLabel, { marginTop: 16 }]}>US STATES</Text>
                <ScrollView style={{ maxHeight: 240 }} showsVerticalScrollIndicator={false}>
                  {Object.entries(US_STATE_PACKS).map(([code, st]) => {
                    const packName = st.name;
                    const isCached = useNativeMap
                      ? nativePacks.some(p => p.name === packName)
                      : webCachedRegions.includes(st.name);
                    return (
                      <View key={code} style={s.stateRow}>
                        <Text style={s.stateEmoji}>{st.emoji}</Text>
                        <Text style={s.stateName}>{st.name}</Text>
                        <TouchableOpacity
                          disabled={isDownloading}
                          style={[s.stateTierBtn, isCached && { borderColor: C.green }]}
                          onPress={() => {
                            if (useNativeMap) {
                              startNativePack(packName, st.bounds, 10, 14);
                            } else {
                              const [[w, s2], [e, n]] = st.bounds;
                              onWebDownloadBbox?.({ n, s: s2, e, w, minZ: 10, maxZ: 14, label: st.name, vectorOnly: true });
                              onClose();
                            }
                          }}
                        >
                          <Text style={[s.stateTierLabel, isCached && { color: C.green }]}>
                            {isCached ? '✓ CACHED' : 'DOWNLOAD'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </ScrollView>

                {/* ── Downloaded packs list ─────────────────────────── */}
                {(useNativeMap ? nativePacks.length > 0 : webCachedRegions.length > 0) && (
                  <View style={{ marginTop: 16 }}>
                    <Text style={s.sectionLabel}>DOWNLOADED · TAP TO DELETE</Text>
                    {(useNativeMap ? nativePacks : webCachedRegions.map(r => ({ name: r, percentage: 100, complete: true, sizeMb: 0 }))).map((pack) => (
                      <View key={pack.name} style={s.packRow}>
                        <Ionicons name="checkmark-circle" size={13} color={C.green} />
                        <Text style={s.packName} numberOfLines={1}>{pack.name}</Text>
                        {useNativeMap && (pack as InstalledPack).sizeMb > 0 && (
                          <Text style={s.packSize}>{(pack as InstalledPack).sizeMb.toFixed(0)} MB</Text>
                        )}
                        <TouchableOpacity
                          onPress={() => {
                            if (useNativeMap) {
                              deleteNativePack(pack.name);
                            } else {
                              onWebClearRegion?.(pack.name);
                            }
                          }}
                        >
                          <Ionicons name="close-circle" size={16} color={C.red} />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}

              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
function styles(C: any) {
  return StyleSheet.create({
    overlay:         { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.65)' },
    sheet:           { backgroundColor: C.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32, maxHeight: '88%' },
    header:          { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
    title:           { flex: 1, color: C.text, fontSize: 13, fontFamily: mono, fontWeight: '900', letterSpacing: 1 },
    closeBtn:        { padding: 4 },
    chips:           { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 },
    chip:            { backgroundColor: C.s2, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
    chipText:        { color: C.text3, fontSize: 10, fontFamily: mono },
    noUser:          { alignItems: 'center', paddingVertical: 20 },
    noUserText:      { color: C.text3, fontSize: 11 },
    sectionLabel:    { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '700', letterSpacing: 1, marginBottom: 8 },
    progressBarWrapper: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 9999, backgroundColor: C.bg, paddingHorizontal: 16, paddingVertical: 6 },
    progressBarBg:   { height: 3, backgroundColor: C.border, borderRadius: 2 },
    progressBarFill: { height: 3, backgroundColor: C.orange, borderRadius: 2 },
    progressBarText: { color: C.text3, fontSize: 9, fontFamily: mono, marginTop: 2, textAlign: 'center' },
    progressCard:    { backgroundColor: C.s2, borderRadius: 12, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: C.border },
    progressRow:     { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
    progressLabel:   { flex: 1, color: C.text2, fontSize: 10, fontFamily: mono },
    cancelText:      { color: C.red, fontSize: 10, fontFamily: mono, fontWeight: '700' },
    progressBg:      { height: 4, backgroundColor: C.border, borderRadius: 2 },
    progressFill:    { height: 4, backgroundColor: C.orange, borderRadius: 2 },
    errorCard:       { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#2a1515', borderRadius: 10, padding: 10, marginBottom: 10 },
    errorText:       { color: '#ef4444', fontSize: 11, fontFamily: mono, flex: 1 },
    conusBtn:        { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 2, borderColor: C.orange, backgroundColor: C.orange + '14', marginBottom: 4 },
    conusBtnCached:  { borderColor: C.green, backgroundColor: C.green + '14' },
    conusIcon:       { width: 36, height: 36, borderRadius: 18, backgroundColor: C.s2, alignItems: 'center', justifyContent: 'center' },
    conusTitle:      { color: C.text, fontSize: 12, fontFamily: mono, fontWeight: '900', letterSpacing: 0.5 },
    conusMeta:       { color: C.text3, fontSize: 10, fontFamily: mono, marginTop: 3 },
    tripBtn:         { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: C.orange + '55', backgroundColor: C.s2, marginBottom: 6 },
    tripBtnCached:   { borderColor: C.green + '66' },
    tripName:        { color: C.text, fontSize: 12, fontFamily: mono, fontWeight: '800' },
    tripMeta:        { color: C.text3, fontSize: 10, fontFamily: mono, marginTop: 2 },
    noTrip:          { color: C.text3, fontSize: 11, fontFamily: mono, textAlign: 'center', paddingVertical: 12 },
    stateRow:        { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 4, borderBottomWidth: 1, borderColor: C.border },
    stateEmoji:      { fontSize: 18 },
    stateName:       { flex: 1, color: C.text2, fontSize: 12, fontFamily: mono, fontWeight: '600' },
    stateTierBtn:    { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.s2 },
    stateTierLabel:  { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '700', letterSpacing: 0.5 },
    packRow:         { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 4, borderBottomWidth: 1, borderColor: C.border },
    packName:        { flex: 1, color: C.text2, fontSize: 11, fontFamily: mono },
    packSize:        { color: C.text3, fontSize: 10, fontFamily: mono },
  });
}
