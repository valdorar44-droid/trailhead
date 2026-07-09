import { useMemo, useRef, useState } from 'react';
import { Keyboard, LayoutChangeEvent, PanResponder, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/** Cinematic playback speeds. Effective scene duration = baseDuration / speed. */
export const PREVIEW_SPEEDS = [0.1, 0.25, 0.5, 1, 1.5, 2] as const;
export type PreviewSpeed = number;
/** Default to a slow, cinematic pace. */
export const DEFAULT_PREVIEW_SPEED: PreviewSpeed = 0.5;
export const MIN_PREVIEW_SPEED = 0.1;
export const MAX_PREVIEW_SPEED = 3;

export function clampPreviewSpeed(speed: number): PreviewSpeed {
  if (!Number.isFinite(speed)) return DEFAULT_PREVIEW_SPEED;
  return Math.max(MIN_PREVIEW_SPEED, Math.min(MAX_PREVIEW_SPEED, speed));
}

export function formatPreviewSpeed(speed: number): string {
  const clamped = clampPreviewSpeed(speed);
  return `${Number.isInteger(clamped) ? clamped.toFixed(0) : clamped.toFixed(clamped < 1 ? 2 : 1).replace(/0$/, '')}×`;
}

export function nextPreviewSpeed(speed: number): PreviewSpeed {
  const clamped = clampPreviewSpeed(speed);
  const idx = PREVIEW_SPEEDS.findIndex(s => Math.abs(s - clamped) < 0.001);
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
  onSeekStart?: (ratio: number) => void;
  onSeekMove?: (ratio: number) => void;
  onSeekEnd?: (ratio: number) => void;
  onSpeedChange?: (speed: number) => void;
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
  onSeekStart,
  onSeekMove,
  onSeekEnd,
  onSpeedChange,
  onToggleFreeCamera,
}: Props) {
  const speedLabel = formatPreviewSpeed(speed);
  const [trackWidth, setTrackWidth] = useState(1);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [customSpeedText, setCustomSpeedText] = useState(() => String(clampPreviewSpeed(speed)));
  const trackWidthRef = useRef(1);
  const lastSeekRatioRef = useRef(0);
  const seekFromX = (x: number, mode: 'start' | 'move' | 'end') => {
    if (!onSeek && !onSeekStart && !onSeekMove && !onSeekEnd) return 0;
    const width = Math.max(1, trackWidthRef.current);
    const ratio = Math.max(0, Math.min(1, x / width));
    lastSeekRatioRef.current = ratio;
    if (mode === 'start') {
      (onSeekStart ?? onSeek)?.(ratio);
    } else if (mode === 'move') {
      (onSeekMove ?? onSeek)?.(ratio);
    } else {
      (onSeekEnd ?? onSeek)?.(ratio);
    }
    return ratio;
  };
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !!(onSeek || onSeekStart || onSeekMove || onSeekEnd),
    onMoveShouldSetPanResponder: () => !!(onSeek || onSeekStart || onSeekMove || onSeekEnd),
    onPanResponderGrant: event => seekFromX(event.nativeEvent.locationX, 'start'),
    onPanResponderMove: event => seekFromX(event.nativeEvent.locationX, 'move'),
    onPanResponderRelease: event => seekFromX(event.nativeEvent.locationX ?? lastSeekRatioRef.current * trackWidthRef.current, 'end'),
    onPanResponderTerminate: () => {
      (onSeekEnd ?? onSeek)?.(lastSeekRatioRef.current);
    },
  }), [onSeek, onSeekStart, onSeekMove, onSeekEnd]);
  const onTrackLayout = (event: LayoutChangeEvent) => {
    const width = Math.max(1, event.nativeEvent.layout.width);
    setTrackWidth(width);
    trackWidthRef.current = width;
  };
  const canSeek = !!(onSeek || onSeekStart || onSeekMove || onSeekEnd);
  const clampedProgress = Math.max(0, Math.min(1, Number(progress) || 0));
  const applySpeed = (next: number) => {
    const clamped = clampPreviewSpeed(next);
    setCustomSpeedText(String(clamped));
    onSpeedChange?.(clamped);
  };
  const submitCustomSpeed = () => {
    const parsed = Number.parseFloat(customSpeedText.replace(/[^\d.]/g, ''));
    applySpeed(parsed);
    Keyboard.dismiss();
  };

  return (
    <View style={styles.wrap}>
      {speedOpen && onSpeedChange ? (
        <View style={styles.speedPanel}>
          <View style={styles.speedGrid}>
            {PREVIEW_SPEEDS.map(item => {
              const active = Math.abs(clampPreviewSpeed(speed) - item) < 0.001;
              return (
                <TouchableOpacity
                  key={item}
                  style={[styles.speedChoice, active && styles.speedChoiceActive]}
                  onPress={() => applySpeed(item)}
                >
                  <Text style={[styles.speedChoiceText, active && styles.speedChoiceTextActive]}>{formatPreviewSpeed(item)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={styles.customSpeedRow}>
            <Text style={styles.customSpeedLabel}>Speed</Text>
            <TextInput
              style={styles.customSpeedInput}
              value={customSpeedText}
              onChangeText={setCustomSpeedText}
              onSubmitEditing={submitCustomSpeed}
              onBlur={submitCustomSpeed}
              keyboardType="decimal-pad"
              returnKeyType="done"
              selectTextOnFocus
              maxLength={4}
            />
            <TouchableOpacity style={styles.customSpeedDone} onPress={submitCustomSpeed}>
              <Text style={styles.customSpeedDoneText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
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
        {onSpeedChange || onCycleSpeed ? (
          <TouchableOpacity
            style={[styles.btn, styles.speedBtn]}
            onPress={() => {
              if (onSpeedChange) {
                setSpeedOpen(open => !open);
                setCustomSpeedText(String(clampPreviewSpeed(speed)));
                return;
              }
              onCycleSpeed?.();
            }}
            accessibilityLabel={`Playback speed ${speedLabel}. Tap to change.`}
          >
            <Ionicons name="speedometer-outline" size={14} color="#fdba74" />
            <Text style={styles.speedText}>{speedLabel}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {canSeek ? (
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
  speedPanel: {
    alignSelf: 'flex-end',
    width: 244,
    gap: 8,
    padding: 10,
    borderRadius: 16,
    backgroundColor: 'rgba(8,12,18,.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,.16)',
  },
  speedGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  speedChoice: {
    width: 66,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    backgroundColor: 'rgba(248,250,252,.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,.12)',
  },
  speedChoiceActive: {
    backgroundColor: '#fdba74',
    borderColor: '#fed7aa',
  },
  speedChoiceText: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '900',
  },
  speedChoiceTextActive: {
    color: '#101820',
  },
  customSpeedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  customSpeedLabel: {
    color: 'rgba(248,250,252,.72)',
    fontSize: 12,
    fontWeight: '800',
  },
  customSpeedInput: {
    flex: 1,
    height: 36,
    paddingHorizontal: 10,
    borderRadius: 10,
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '900',
    backgroundColor: 'rgba(248,250,252,.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,.14)',
  },
  customSpeedDone: {
    height: 36,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: 'rgba(253,186,116,.16)',
    borderWidth: 1,
    borderColor: 'rgba(253,186,116,.38)',
  },
  customSpeedDoneText: {
    color: '#fdba74',
    fontSize: 12,
    fontWeight: '900',
  },
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
