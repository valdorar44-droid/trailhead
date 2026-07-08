import { useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, PanResponder, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/** Cinematic playback speeds. Effective scene duration = baseDuration / speed. */
export const PREVIEW_SPEEDS = [0.5, 1, 2] as const;
export type PreviewSpeed = (typeof PREVIEW_SPEEDS)[number];
/** Default to a slow, cinematic pace. */
export const DEFAULT_PREVIEW_SPEED: PreviewSpeed = 0.5;

const SPEED_LABEL: Record<PreviewSpeed, string> = {
  0.5: 'SLOW',
  1: '1×',
  2: 'FAST',
};

export function nextPreviewSpeed(speed: number): PreviewSpeed {
  const idx = PREVIEW_SPEEDS.findIndex(s => s === speed);
  return PREVIEW_SPEEDS[(idx + 1) % PREVIEW_SPEEDS.length];
}

type Props = {
  playing: boolean;
  paused: boolean;
  complete: boolean;
  /** Current playback speed. Speed control is only shown when onCycleSpeed is provided. */
  speed?: number;
  progress?: number;
  freeCamera?: boolean;
  onReplay: () => void;
  onPauseResume: () => void;
  onSkip: () => void;
  onCycleSpeed?: () => void;
  onSeek?: (ratio: number) => void;
  onToggleFreeCamera?: () => void;
};

export function TripPreviewControls({
  playing,
  paused,
  complete,
  speed = DEFAULT_PREVIEW_SPEED,
  progress = 0,
  freeCamera = false,
  onReplay,
  onPauseResume,
  onSkip,
  onCycleSpeed,
  onSeek,
  onToggleFreeCamera,
}: Props) {
  const speedLabel = SPEED_LABEL[(speed as PreviewSpeed)] ?? `${speed}×`;
  const [trackWidth, setTrackWidth] = useState(1);
  const trackWidthRef = useRef(1);
  const seekFromX = (x: number) => {
    if (!onSeek) return;
    const width = Math.max(1, trackWidthRef.current);
    onSeek(Math.max(0, Math.min(1, x / width)));
  };
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !!onSeek,
    onMoveShouldSetPanResponder: () => !!onSeek,
    onPanResponderGrant: event => seekFromX(event.nativeEvent.locationX),
    onPanResponderMove: event => seekFromX(event.nativeEvent.locationX),
  }), [onSeek]);
  const onTrackLayout = (event: LayoutChangeEvent) => {
    const width = Math.max(1, event.nativeEvent.layout.width);
    setTrackWidth(width);
    trackWidthRef.current = width;
  };
  const clampedProgress = Math.max(0, Math.min(1, Number(progress) || 0));

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <TouchableOpacity style={styles.btn} onPress={onReplay} accessibilityLabel="Replay flyover">
          <Ionicons name="refresh" size={15} color="#f8fafc" />
          {complete ? <Text style={styles.btnText}>Replay</Text> : null}
        </TouchableOpacity>
        {playing && !complete ? (
          <TouchableOpacity
            style={styles.btn}
            onPress={onPauseResume}
            accessibilityLabel={paused ? 'Resume flyover' : 'Pause flyover'}
          >
            <Ionicons name={paused ? 'play' : 'pause'} size={15} color="#f8fafc" />
          </TouchableOpacity>
        ) : null}
        {playing && !complete ? (
          <TouchableOpacity style={styles.btn} onPress={onSkip} accessibilityLabel="Skip scene">
            <Ionicons name="play-skip-forward" size={15} color="#f8fafc" />
          </TouchableOpacity>
        ) : null}
        {onToggleFreeCamera ? (
          <TouchableOpacity
            style={[styles.btn, styles.freeBtn, freeCamera && styles.freeBtnActive]}
            onPress={onToggleFreeCamera}
            accessibilityLabel={freeCamera ? 'Follow route camera' : 'Free camera'}
          >
            <Ionicons name={freeCamera ? 'lock-open-outline' : 'locate-outline'} size={14} color={freeCamera ? '#101820' : '#f8fafc'} />
            <Text style={[styles.freeText, freeCamera && styles.freeTextActive]}>{freeCamera ? 'Free' : 'Follow'}</Text>
          </TouchableOpacity>
        ) : null}
        {onCycleSpeed ? (
          <TouchableOpacity
            style={[styles.btn, styles.speedBtn]}
            onPress={onCycleSpeed}
            accessibilityLabel={`Playback speed ${speedLabel}. Tap to change.`}
          >
            <Ionicons name="speedometer-outline" size={14} color="#fdba74" />
            <Text style={styles.speedText}>{speedLabel}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {onSeek ? (
        <View
          style={styles.trackHit}
          onLayout={onTrackLayout}
          {...panResponder.panHandlers}
          accessibilityRole="adjustable"
          accessibilityLabel="Flyover progress"
        >
          <View style={styles.track}>
            <View style={[styles.trackFill, { width: Math.max(8, clampedProgress * trackWidth) }]} />
            <View style={[styles.thumb, { left: Math.max(0, Math.min(trackWidth - 14, clampedProgress * trackWidth - 7)) }]} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    minWidth: 210,
    gap: 7,
  },
  row: { flexDirection: 'row', gap: 8 },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 38,
    height: 38,
    paddingHorizontal: 11,
    borderRadius: 13,
    justifyContent: 'center',
    backgroundColor: 'rgba(8,12,18,.85)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,.16)',
  },
  btnText: { color: '#f8fafc', fontSize: 12, fontWeight: '800' },
  speedBtn: {
    gap: 5,
    borderColor: 'rgba(251,146,60,.45)',
  },
  speedText: { color: '#fdba74', fontSize: 11, fontWeight: '900', letterSpacing: 0.5 },
  freeBtn: {
    gap: 5,
  },
  freeBtnActive: {
    backgroundColor: '#fdba74',
    borderColor: '#fed7aa',
  },
  freeText: { color: '#f8fafc', fontSize: 11, fontWeight: '900' },
  freeTextActive: { color: '#101820' },
  trackHit: {
    height: 24,
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  track: {
    height: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(248,250,252,.22)',
    overflow: 'visible',
  },
  trackFill: {
    height: 5,
    borderRadius: 999,
    backgroundColor: '#fdba74',
  },
  thumb: {
    position: 'absolute',
    top: -5,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#fff7ed',
    borderWidth: 2,
    borderColor: '#fb923c',
  },
});
