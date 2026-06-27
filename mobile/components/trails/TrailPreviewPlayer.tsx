import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ActivityIndicator, AppState, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeMapHandle } from '@/components/NativeMap';
import type { TrailPreviewKeyframe, TrailPreviewManifest } from '@/lib/api';
import type { TrailFeature } from '@/lib/trailEngine';

type Props = {
  visible: boolean;
  trail: TrailFeature | null;
  manifest: TrailPreviewManifest | null;
  loading: boolean;
  mapRef: RefObject<NativeMapHandle | null>;
  tone: 'cyan' | 'gold';
  pauseSignal?: number;
  onClose: () => void;
  onProgress: (progress: number) => void;
};

function isFiniteCoord(coord?: [number, number] | null): coord is [number, number] {
  return Array.isArray(coord)
    && coord.length >= 2
    && Number.isFinite(coord[0])
    && Number.isFinite(coord[1]);
}

function normalizeKeyframes(manifest: TrailPreviewManifest | null): TrailPreviewKeyframe[] {
  const raw = manifest?.keyframes ?? [];
  return raw
    .filter(frame => Number.isFinite(frame.progress) && isFiniteCoord(frame.coordinate))
    .sort((a, b) => a.progress - b.progress);
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function interpolateFrame(frames: TrailPreviewKeyframe[], progress: number): TrailPreviewKeyframe | null {
  if (!frames.length) return null;
  if (frames.length === 1 || progress <= frames[0].progress) return frames[0];
  for (let idx = 1; idx < frames.length; idx += 1) {
    const prev = frames[idx - 1];
    const next = frames[idx];
    if (progress <= next.progress) {
      const span = Math.max(0.0001, next.progress - prev.progress);
      const t = Math.max(0, Math.min(1, (progress - prev.progress) / span));
      const coord: [number, number] = [
        lerp(prev.coordinate[0], next.coordinate[0], t),
        lerp(prev.coordinate[1], next.coordinate[1], t),
      ];
      const look = isFiniteCoord(prev.look_at) && isFiniteCoord(next.look_at)
        ? [lerp(prev.look_at[0], next.look_at[0], t), lerp(prev.look_at[1], next.look_at[1], t)] as [number, number]
        : next.look_at;
      return {
        ...next,
        coordinate: coord,
        look_at: look,
        bearing: lerp(Number(prev.bearing ?? next.bearing ?? 0), Number(next.bearing ?? prev.bearing ?? 0), t),
        pitch: lerp(Number(prev.pitch ?? next.pitch ?? 62), Number(next.pitch ?? prev.pitch ?? 62), t),
        zoom: lerp(Number(prev.zoom ?? next.zoom ?? 15), Number(next.zoom ?? prev.zoom ?? 15), t),
        cumulative_distance_m: Math.round(lerp(Number(prev.cumulative_distance_m ?? 0), Number(next.cumulative_distance_m ?? 0), t)),
      };
    }
  }
  return frames[frames.length - 1];
}

function durationFor(frames: TrailPreviewKeyframe[]) {
  return Math.max(5200, frames.reduce((sum, frame) => sum + Math.max(650, Number(frame.duration_ms ?? 1200)), 0));
}

function fmtDistance(meters?: number) {
  if (!Number.isFinite(meters ?? NaN)) return '--';
  const miles = (meters ?? 0) / 1609.344;
  return miles >= 10 ? `${miles.toFixed(0)} mi` : `${miles.toFixed(1)} mi`;
}

export default function TrailPreviewPlayer({ visible, trail, manifest, loading, mapRef, tone, pauseSignal = 0, onClose, onProgress }: Props) {
  const frames = useMemo(() => normalizeKeyframes(manifest), [manifest]);
  const totalDuration = useMemo(() => durationFor(frames), [frames]);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const startedAtRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastCameraAtRef = useRef(0);
  const accent = tone === 'gold' ? '#f5c84b' : '#22d3ee';
  const secondary = tone === 'gold' ? '#22d3ee' : '#f5c84b';
  const activeFrame = useMemo(() => interpolateFrame(frames, progress), [frames, progress]);

  useEffect(() => {
    if (!visible) return;
    setProgress(0);
    onProgress(0);
    const center = manifest?.intro?.center ?? frames[0]?.coordinate;
    if (isFiniteCoord(center)) {
      mapRef.current?.flyToCamera({
        lat: center[1],
        lng: center[0],
        zoom: manifest?.intro?.zoom ?? 13,
        pitch: manifest?.intro?.pitch ?? 48,
        bearing: manifest?.intro?.bearing ?? frames[0]?.bearing ?? 0,
        duration: manifest?.intro?.duration_ms ?? 900,
        mode: 'easeTo',
      });
    }
    if (manifest?.status === 'available' && frames.length >= 2) {
      startedAtRef.current = Date.now() + 650;
      setPlaying(true);
    } else {
      setPlaying(false);
    }
  }, [frames, manifest, mapRef, onProgress, visible]);

  useEffect(() => {
    if (!visible || !playing || !frames.length) return;
    const tick = () => {
      const now = Date.now();
      const elapsed = Math.max(0, now - startedAtRef.current);
      const nextProgress = Math.min(1, elapsed / totalDuration);
      setProgress(nextProgress);
      onProgress(nextProgress);
      const frame = interpolateFrame(frames, nextProgress);
      if (frame && now - lastCameraAtRef.current > 180) {
        lastCameraAtRef.current = now;
        mapRef.current?.flyToCamera({
          lat: frame.coordinate[1],
          lng: frame.coordinate[0],
          zoom: frame.zoom ?? 15,
          pitch: frame.pitch ?? 64,
          bearing: frame.bearing ?? 0,
          duration: 230,
          mode: 'easeTo',
        });
      }
      if (nextProgress >= 1) {
        setPlaying(false);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [frames, mapRef, onProgress, playing, totalDuration, visible]);

  useEffect(() => {
    if (!visible) return undefined;
    const sub = AppState.addEventListener('change', state => {
      if (state !== 'active') setPlaying(false);
    });
    return () => sub.remove();
  }, [visible]);

  useEffect(() => {
    if (visible && pauseSignal > 0) setPlaying(false);
  }, [pauseSignal, visible]);

  if (!visible) return null;

  const available = manifest?.status === 'available' && frames.length >= 2;
  const distanceM = activeFrame?.cumulative_distance_m ?? (manifest?.distance_m ? Math.round(manifest.distance_m * progress) : undefined);

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.topBar} pointerEvents="auto">
        <TouchableOpacity style={styles.iconBtn} onPress={onClose} hitSlop={12}>
          <Ionicons name="close" size={18} color="#f8fafc" />
        </TouchableOpacity>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.kicker}>TRAIL PREVIEW</Text>
          <Text style={styles.title} numberOfLines={1}>{manifest?.trail_name || trail?.name || 'Trail'}</Text>
        </View>
        <View style={[styles.livePill, { borderColor: accent + '88', backgroundColor: accent + '1f' }]}>
          <Text style={[styles.livePillText, { color: accent }]}>{available ? '3D' : 'GUIDE'}</Text>
        </View>
      </View>

      <View style={styles.bottomCard} pointerEvents="auto">
        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={accent} />
            <Text style={styles.loadingText}>Preparing preview</Text>
          </View>
        ) : available ? (
          <>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.max(2, progress * 100)}%`, backgroundColor: accent }]} />
            </View>
            <View style={styles.controlRow}>
              <TouchableOpacity
                style={[styles.playBtn, { backgroundColor: accent }]}
                onPress={() => {
                  if (progress >= 0.99) {
                    setProgress(0);
                    onProgress(0);
                    startedAtRef.current = Date.now();
                  } else if (!playing) {
                    startedAtRef.current = Date.now() - progress * totalDuration;
                  }
                  setPlaying(v => !v || progress >= 0.99);
                }}
              >
                <Ionicons name={playing ? 'pause' : 'play'} size={18} color="#061018" />
              </TouchableOpacity>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.statValue}>{fmtDistance(distanceM)}</Text>
                <Text style={styles.statLabel} numberOfLines={1}>route progress</Text>
              </View>
              <TouchableOpacity
                style={styles.restartBtn}
                onPress={() => {
                  startedAtRef.current = Date.now();
                  setProgress(0);
                  onProgress(0);
                  setPlaying(true);
                }}
              >
                <Ionicons name="refresh" size={16} color={secondary} />
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <View style={styles.unavailable}>
            <Ionicons name="map-outline" size={19} color={accent} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.unavailableTitle}>Map highlight ready</Text>
              <Text style={styles.unavailableText} numberOfLines={3}>
                {(manifest?.warnings ?? [])[0] || 'Flyover starts when this trail has route geometry.'}
              </Text>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 970,
    elevation: 80,
  },
  topBar: {
    position: 'absolute',
    top: 54,
    left: 14,
    right: 14,
    minHeight: 58,
    borderRadius: 14,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(5, 10, 14, 0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  kicker: { color: '#cbd5e1', fontSize: 9, fontWeight: '900', letterSpacing: 0 },
  title: { color: '#f8fafc', fontSize: 16, fontWeight: '900', marginTop: 2 },
  livePill: {
    minWidth: 46,
    minHeight: 28,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 9,
  },
  livePillText: { fontSize: 10, fontWeight: '900', letterSpacing: 0 },
  bottomCard: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 30,
    borderRadius: 16,
    padding: 14,
    backgroundColor: 'rgba(5, 10, 14, 0.86)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.13)',
  },
  loadingRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 12 },
  loadingText: { color: '#e2e8f0', fontSize: 13, fontWeight: '800' },
  progressTrack: {
    height: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
    marginBottom: 14,
  },
  progressFill: { height: '100%', borderRadius: 999 },
  controlRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  playBtn: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  restartBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  statValue: { color: '#f8fafc', fontSize: 19, fontWeight: '900' },
  statLabel: { color: '#94a3b8', fontSize: 11, fontWeight: '800', marginTop: 2 },
  unavailable: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 12 },
  unavailableTitle: { color: '#f8fafc', fontSize: 15, fontWeight: '900' },
  unavailableText: { color: '#cbd5e1', fontSize: 12, lineHeight: 17, marginTop: 3 },
});
