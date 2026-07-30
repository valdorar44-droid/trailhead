import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  ActivityIndicator,
  AppState,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { NativeMapHandle } from '@/components/NativeMap';
import type { TrailPreviewManifest } from '@/lib/api';
import {
  interpolateTrailPreviewFrame,
  isFiniteTrailPreviewCoordinate,
  normalizeTrailPreviewKeyframes,
  normalizeTrailPreviewProgress,
  trailPreviewCardinalDirection,
  trailPreviewClockLabel,
  trailPreviewDurationMs,
  trailPreviewProgressFromPointer,
} from '@/lib/trailPreviewPlayback';
import type { TrailFeature } from '@/lib/trailEngine';
import { trailheadFonts } from '@/lib/typography';

type Props = {
  visible: boolean;
  trail: TrailFeature | null;
  manifest: TrailPreviewManifest | null;
  loading: boolean;
  mapRef: RefObject<NativeMapHandle | null>;
  pauseSignal?: number;
  renderCompass?: (bearing: number | null) => ReactNode;
  onBack: () => void;
  onClose: () => void;
  onProgress: (progress: number) => void;
};

function fmtDistance(meters?: number) {
  if (!Number.isFinite(meters ?? NaN)) return '--';
  const miles = (meters ?? 0) / 1609.344;
  return miles >= 10 ? `${miles.toFixed(0)} mi` : `${miles.toFixed(1)} mi`;
}

export default function TrailPreviewPlayer({
  visible,
  trail,
  manifest,
  loading,
  mapRef,
  pauseSignal = 0,
  renderCompass,
  onBack,
  onClose,
  onProgress,
}: Props) {
  const frames = useMemo(() => normalizeTrailPreviewKeyframes(manifest), [manifest]);
  const totalDuration = useMemo(() => trailPreviewDurationMs(frames), [frames]);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [scrubberWidth, setScrubberWidth] = useState(0);
  const startedAtRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastCameraAtRef = useRef(0);
  const scrubWasPlayingRef = useRef(false);
  const activeFrame = useMemo(
    () => interpolateTrailPreviewFrame(frames, progress),
    [frames, progress],
  );

  const applyCameraAtProgress = useCallback((nextProgress: number, duration = 230) => {
    const frame = interpolateTrailPreviewFrame(frames, nextProgress);
    if (!frame) return;
    mapRef.current?.flyToCamera({
      lat: frame.coordinate[1],
      lng: frame.coordinate[0],
      zoom: frame.zoom ?? 15,
      pitch: frame.pitch ?? 64,
      bearing: frame.bearing ?? 0,
      duration,
      mode: 'easeTo',
    });
  }, [frames, mapRef]);

  const commitProgress = useCallback((rawProgress: number, moveCamera = true) => {
    const nextProgress = normalizeTrailPreviewProgress(rawProgress);
    setProgress(nextProgress);
    onProgress(nextProgress);
    startedAtRef.current = Date.now() - nextProgress * totalDuration;
    if (moveCamera) applyCameraAtProgress(nextProgress, 120);
  }, [applyCameraAtProgress, onProgress, totalDuration]);

  useEffect(() => {
    if (!visible) return;
    setProgress(0);
    onProgress(0);
    lastCameraAtRef.current = 0;
    const center = manifest?.intro?.center ?? frames[0]?.coordinate;
    if (isFiniteTrailPreviewCoordinate(center)) {
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
      if (now - lastCameraAtRef.current > 180) {
        lastCameraAtRef.current = now;
        applyCameraAtProgress(nextProgress);
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
  }, [applyCameraAtProgress, frames.length, onProgress, playing, totalDuration, visible]);

  useEffect(() => {
    if (!visible) return undefined;
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') setPlaying(false);
    });
    return () => subscription.remove();
  }, [visible]);

  useEffect(() => {
    if (visible && pauseSignal > 0) setPlaying(false);
  }, [pauseSignal, visible]);

  if (!visible) return null;

  const available = manifest?.status === 'available' && frames.length >= 2;
  if (!loading && !available) return null;

  const distanceM = activeFrame?.cumulative_distance_m
    ?? (manifest?.distance_m ? Math.round(manifest.distance_m * progress) : undefined);
  const bearing = Number.isFinite(Number(activeFrame?.bearing)) ? Number(activeFrame?.bearing) : null;
  const currentTime = trailPreviewClockLabel(totalDuration * progress);
  const totalTime = trailPreviewClockLabel(totalDuration);
  const currentDistanceLabel = fmtDistance(distanceM);
  const totalDistanceLabel = fmtDistance(manifest?.distance_m);
  const progressLabel = totalDistanceLabel === '--'
    ? currentDistanceLabel === '--' ? 'Route preview' : currentDistanceLabel
    : `${currentDistanceLabel === '--' ? '0.0 mi' : currentDistanceLabel} of ${totalDistanceLabel}`;

  const seekFromEvent = (event: GestureResponderEvent) => {
    commitProgress(trailPreviewProgressFromPointer(event.nativeEvent.locationX, scrubberWidth));
  };

  const handleScrubStart = (event: GestureResponderEvent) => {
    scrubWasPlayingRef.current = playing;
    setPlaying(false);
    seekFromEvent(event);
  };

  const handleScrubEnd = (event: GestureResponderEvent) => {
    const nextProgress = trailPreviewProgressFromPointer(event.nativeEvent.locationX, scrubberWidth);
    commitProgress(nextProgress);
    if (scrubWasPlayingRef.current && nextProgress < 1) {
      startedAtRef.current = Date.now() - nextProgress * totalDuration;
      setPlaying(true);
    }
    scrubWasPlayingRef.current = false;
  };

  const handleScrubberLayout = (event: LayoutChangeEvent) => {
    setScrubberWidth(event.nativeEvent.layout.width);
  };

  return (
    <View style={styles.wrap} pointerEvents="box-none" testID="trail.preview.player">
      <View style={styles.topScrim} pointerEvents="none" />

      <TouchableOpacity
        testID="trail.preview.close"
        accessibilityRole="button"
        accessibilityLabel="Close trail preview"
        style={styles.closeButton}
        onPress={onClose}
        hitSlop={8}
      >
        <Ionicons name="close" size={25} color="#111412" />
      </TouchableOpacity>

      <View style={styles.titleBlock} pointerEvents="none">
        <Text style={styles.kicker}>3D PREVIEW</Text>
        <Text style={styles.title} numberOfLines={1}>{manifest?.trail_name || trail?.name || 'Trail'}</Text>
        <Text style={styles.subtitle} numberOfLines={1}>{progressLabel}</Text>
      </View>

      <TouchableOpacity
        testID="trail.preview.recenter"
        accessibilityRole="button"
        accessibilityLabel="Recenter trail preview"
        style={styles.compassButton}
        onPress={() => applyCameraAtProgress(progress, 480)}
      >
        {renderCompass?.(bearing)}
        <View style={styles.compassTextBlock}>
          <Text style={styles.compassDirection}>{trailPreviewCardinalDirection(bearing)}</Text>
          <Text style={styles.compassDegrees}>{bearing == null ? '--' : `${Math.round(bearing)}°`}</Text>
        </View>
      </TouchableOpacity>

      <View style={styles.bottomCard} pointerEvents="auto">
        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color="#AD5A33" />
            <Text style={styles.loadingText}>Preparing preview</Text>
          </View>
        ) : (
          <>
            <View style={styles.timelineRow}>
              <Text style={styles.timeLabel}>{currentTime}</Text>
              <View
                testID="trail.preview.scrubber"
                accessible
                accessibilityRole="adjustable"
                accessibilityLabel="Trail preview progress"
                accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
                accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
                onAccessibilityAction={event => {
                  const delta = event.nativeEvent.actionName === 'increment' ? 0.05 : -0.05;
                  commitProgress(progress + delta);
                }}
                style={styles.scrubberTouch}
                onLayout={handleScrubberLayout}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onResponderGrant={handleScrubStart}
                onResponderMove={seekFromEvent}
                onResponderRelease={handleScrubEnd}
                onResponderTerminate={handleScrubEnd}
              >
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
                </View>
              </View>
              <Text style={[styles.timeLabel, styles.timeLabelRight]}>{totalTime}</Text>
            </View>

            <View style={styles.controlRow}>
              <TouchableOpacity
                testID="trail.preview.restart"
                accessibilityRole="button"
                accessibilityLabel="Restart trail preview"
                style={styles.restartButton}
                onPress={() => {
                  commitProgress(0);
                  startedAtRef.current = Date.now();
                  setPlaying(true);
                }}
              >
                <Ionicons name="refresh" size={25} color="#111412" />
              </TouchableOpacity>

              <TouchableOpacity
                testID="trail.preview.play-pause"
                accessibilityRole="button"
                accessibilityLabel={playing ? 'Pause trail preview' : 'Play trail preview'}
                style={styles.playButton}
                onPress={() => {
                  if (progress >= 0.99) {
                    commitProgress(0);
                    startedAtRef.current = Date.now();
                    setPlaying(true);
                    return;
                  }
                  if (!playing) startedAtRef.current = Date.now() - progress * totalDuration;
                  setPlaying(value => !value);
                }}
              >
                <Ionicons name={playing ? 'pause' : 'play'} size={19} color="#FFFFFF" />
              </TouchableOpacity>

              <TouchableOpacity
                testID="trail.preview.back"
                accessibilityRole="button"
                accessibilityLabel="Back to trail details"
                style={styles.backButton}
                onPress={onBack}
              >
                <Text style={styles.backText}>Back</Text>
              </TouchableOpacity>
            </View>
          </>
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
  topScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 120,
    backgroundColor: 'rgba(17,20,18,0.34)',
  },
  closeButton: {
    position: 'absolute',
    top: 42,
    left: 14,
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D8DCD8',
  },
  titleBlock: {
    position: 'absolute',
    top: 45,
    left: 69,
    right: 112,
  },
  kicker: {
    color: '#FFFFFF',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 25,
    lineHeight: 31,
    fontFamily: trailheadFonts.displayBold,
  },
  subtitle: {
    color: '#FFFFFF',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  compassButton: {
    position: 'absolute',
    top: 43,
    right: 14,
    width: 84,
    height: 52,
    borderRadius: 26,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D8DCD8',
  },
  compassTextBlock: { flex: 1, minWidth: 0 },
  compassDirection: { color: '#111412', fontSize: 13, lineHeight: 16, fontWeight: '700' },
  compassDegrees: { color: '#4F5752', fontSize: 12, lineHeight: 15 },
  bottomCard: {
    position: 'absolute',
    left: 17,
    right: 17,
    bottom: 34,
    minHeight: 98,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D8DCD8',
  },
  loadingRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: '#4F5752', fontSize: 14, fontWeight: '600' },
  timelineRow: { height: 32, flexDirection: 'row', alignItems: 'center', gap: 8 },
  timeLabel: { width: 38, color: '#4F5752', fontSize: 12, fontWeight: '600' },
  timeLabelRight: { textAlign: 'right' },
  scrubberTouch: { flex: 1, height: 32, justifyContent: 'center' },
  progressTrack: { height: 4, borderRadius: 2, overflow: 'hidden', backgroundColor: '#D9DEDA' },
  progressFill: { height: '100%', borderRadius: 2, backgroundColor: '#AD5A33' },
  controlRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  restartButton: { width: 54, height: 44, alignItems: 'center', justifyContent: 'center' },
  playButton: {
    width: 54,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#AD5A33',
  },
  backButton: { width: 78, height: 44, alignItems: 'center', justifyContent: 'center' },
  backText: { color: '#984F2F', fontSize: 14, fontWeight: '700' },
});
