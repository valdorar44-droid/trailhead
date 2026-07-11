import { useMemo, useRef, useState } from 'react';
import { Keyboard, LayoutChangeEvent, PanResponder, StyleSheet, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/** Cinematic playback speeds. Effective scene duration = baseDuration / speed. */
export const PREVIEW_SPEED_PRESETS = [
  { label: 'Slow', value: 0.65 },
  { label: 'Normal', value: 1 },
  { label: 'Fast', value: 1.6 },
] as const;
export const PREVIEW_SPEEDS = PREVIEW_SPEED_PRESETS.map(preset => preset.value);
export type PreviewSpeed = number;
/** Default to cinematic normal, not raw route-distance playback. */
export const DEFAULT_PREVIEW_SPEED: PreviewSpeed = 1;
export const MIN_PREVIEW_SPEED = 0.1;
export const MAX_PREVIEW_SPEED = 3;

export function clampPreviewSpeed(speed: number): PreviewSpeed {
  if (!Number.isFinite(speed)) return DEFAULT_PREVIEW_SPEED;
  return Math.max(MIN_PREVIEW_SPEED, Math.min(MAX_PREVIEW_SPEED, speed));
}

export function formatPreviewSpeed(speed: number): string {
  const clamped = clampPreviewSpeed(speed);
  return `${Number.isInteger(clamped) ? clamped.toFixed(0) : clamped.toFixed(clamped < 1 ? 2 : 1).replace(/0$/, '')}x`;
}

export function labelPreviewSpeed(speed: number): string {
  const clamped = clampPreviewSpeed(speed);
  const preset = PREVIEW_SPEED_PRESETS.find(item => Math.abs(item.value - clamped) < 0.001);
  return preset?.label ?? formatPreviewSpeed(clamped);
}

export function nextPreviewSpeed(speed: number): PreviewSpeed {
  const clamped = clampPreviewSpeed(speed);
  const idx = PREVIEW_SPEEDS.findIndex(s => Math.abs(s - clamped) < 0.001);
  return PREVIEW_SPEEDS[(idx + 1) % PREVIEW_SPEEDS.length];
}

type Props = {
  layoutMode?: 'default' | 'compactFlyover';
  playing: boolean;
  paused: boolean;
  complete: boolean;
  /** Current playback speed. Speed control is only shown when onCycleSpeed is provided. */
  speed?: number;
  progress?: number;
  freeCamera?: boolean;
  viewPreset?: 'close' | 'standard' | 'wide';
  tiltPreset?: 'low' | 'trail' | 'high';
  showSkip?: boolean;
  onReplay: () => void;
  onPauseResume: () => void;
  onSkip?: () => void;
  onCycleSpeed?: () => void;
  onSeek?: (ratio: number) => void;
  onSeekStart?: (ratio: number) => void;
  onSeekMove?: (ratio: number) => void;
  onSeekEnd?: (ratio: number) => void;
  onSpeedChange?: (speed: number) => void;
  onExitToOverview?: () => void;
  onToggleFreeCamera?: () => void;
  onCameraPresetChange?: (view: 'close' | 'standard' | 'wide', tilt: 'low' | 'trail' | 'high') => void;
};

export function TripPreviewControls({
  layoutMode = 'default',
  playing,
  paused,
  complete,
  speed = DEFAULT_PREVIEW_SPEED,
  progress = 0,
  freeCamera = false,
  viewPreset = 'close',
  tiltPreset = 'trail',
  showSkip = true,
  onReplay,
  onPauseResume,
  onSkip,
  onCycleSpeed,
  onSeek,
  onSeekStart,
  onSeekMove,
  onSeekEnd,
  onSpeedChange,
  onExitToOverview,
  onToggleFreeCamera,
  onCameraPresetChange,
}: Props) {
  const { width: viewportWidth } = useWindowDimensions();
  const compactFlyover = layoutMode === 'compactFlyover';
  const smallCompact = compactFlyover && viewportWidth < 360;
  const speedLabel = compactFlyover ? labelPreviewSpeed(speed) : formatPreviewSpeed(speed);
  const [trackWidth, setTrackWidth] = useState(1);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
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
  const applyView = (view: 'close' | 'standard' | 'wide') => onCameraPresetChange?.(view, tiltPreset);
  const applyTilt = (tilt: 'low' | 'trail' | 'high') => onCameraPresetChange?.(viewPreset, tilt);
  const showCameraPanel = viewOpen && onCameraPresetChange;
  const showSpeedPanel = speedOpen && onSpeedChange;
  const openSpeedPanel = () => {
    if (onSpeedChange) {
      setSpeedOpen(open => !open);
      setViewOpen(false);
      setOverflowOpen(false);
      setCustomSpeedText(String(clampPreviewSpeed(speed)));
      return;
    }
    onCycleSpeed?.();
  };
  const openCameraPanel = () => {
    setViewOpen(open => !open);
    setSpeedOpen(false);
    setOverflowOpen(false);
  };

  if (compactFlyover) {
    const railButtons = [
      {
        key: 'replay',
        icon: 'refresh' as const,
        label: 'Replay flyover',
        onPress: onReplay,
        visible: true,
      },
      {
        key: 'pause',
        icon: (paused ? 'play' : 'pause') as keyof typeof Ionicons.glyphMap,
        label: paused ? 'Resume flyover' : 'Pause flyover',
        onPress: onPauseResume,
        visible: playing && !complete,
        active: playing && !paused,
      },
      {
        key: 'skip',
        icon: 'play-skip-forward' as const,
        label: 'Skip scene',
        onPress: onSkip,
        visible: showSkip && !!onSkip && playing && !complete,
      },
      {
        key: 'overview',
        icon: 'map-outline' as const,
        label: 'Back to trip overview',
        onPress: onExitToOverview,
        visible: !!onExitToOverview,
      },
      {
        key: 'route',
        icon: (freeCamera ? 'lock-open-outline' : 'locate-outline') as keyof typeof Ionicons.glyphMap,
        label: freeCamera ? 'Follow route camera' : 'Free camera',
        onPress: onToggleFreeCamera,
        visible: !!onToggleFreeCamera,
        active: freeCamera,
      },
      {
        key: 'camera',
        icon: 'camera-outline' as const,
        label: 'Camera view',
        onPress: openCameraPanel,
        visible: !!onCameraPresetChange && !smallCompact,
        active: viewOpen,
      },
      {
        key: 'speed',
        icon: 'speedometer-outline' as const,
        label: `Playback speed ${speedLabel}`,
        onPress: openSpeedPanel,
        visible: !!(onSpeedChange || onCycleSpeed) && !smallCompact,
        active: speedOpen,
      },
      {
        key: 'more',
        icon: 'ellipsis-horizontal' as const,
        label: 'More flyover controls',
        onPress: () => {
          setOverflowOpen(open => !open);
          setSpeedOpen(false);
          setViewOpen(false);
        },
        visible: smallCompact,
        active: overflowOpen,
      },
    ].filter(button => button.visible);

    return (
      <View style={[styles.wrap, styles.compactWrap]}>
        {showCameraPanel && !smallCompact ? (
          <View style={styles.compactCameraPanel}>
            <Text style={styles.compactPanelTitle}>Camera</Text>
            {(['close', 'standard', 'wide'] as const).map(item => {
              const active = viewPreset === item;
              return (
                <TouchableOpacity key={item} style={[styles.compactMenuRow, active && styles.compactMenuRowActive]} onPress={() => applyView(item)}>
                  <Text style={[styles.compactMenuText, active && styles.compactMenuTextActive]}>
                    {item === 'close' ? 'Near' : item === 'standard' ? 'Mid' : 'Wide'}
                  </Text>
                  {active ? <Ionicons name="checkmark" size={15} color="#101820" /> : null}
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}
        {showSpeedPanel && !smallCompact ? (
          <View style={styles.compactSpeedSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.compactPanelTitle}>Speed</Text>
            {PREVIEW_SPEED_PRESETS.map(item => {
              const active = Math.abs(clampPreviewSpeed(speed) - item.value) < 0.001;
              return (
                <TouchableOpacity key={item.label} style={[styles.compactMenuRow, active && styles.compactMenuRowActive]} onPress={() => applySpeed(item.value)}>
                  <Text style={[styles.compactMenuText, active && styles.compactMenuTextActive]}>{item.label}</Text>
                  {active ? <Ionicons name="checkmark" size={15} color="#101820" /> : null}
                </TouchableOpacity>
              );
            })}
            <View style={styles.compactCustomRow}>
              <Text style={styles.compactMenuText}>Custom</Text>
              <TextInput
                style={styles.compactSpeedInput}
                value={customSpeedText}
                onChangeText={setCustomSpeedText}
                onSubmitEditing={submitCustomSpeed}
                onBlur={submitCustomSpeed}
                keyboardType="decimal-pad"
                returnKeyType="done"
                selectTextOnFocus
                maxLength={4}
              />
            </View>
          </View>
        ) : null}
        {overflowOpen && smallCompact ? (
          <View style={styles.compactOverflowSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.compactPanelTitle}>Controls</Text>
            {onCameraPresetChange ? (
              <TouchableOpacity style={styles.compactMenuRow} onPress={openCameraPanel}>
                <Text style={styles.compactMenuText}>Camera</Text>
                <Text style={styles.compactMenuMeta}>{viewPreset === 'close' ? 'Near' : viewPreset === 'standard' ? 'Mid' : 'Wide'}</Text>
              </TouchableOpacity>
            ) : null}
            {onSpeedChange || onCycleSpeed ? (
              <TouchableOpacity style={styles.compactMenuRow} onPress={openSpeedPanel}>
                <Text style={styles.compactMenuText}>Speed</Text>
                <Text style={styles.compactMenuMeta}>{speedLabel}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
        {showCameraPanel && smallCompact ? (
          <View style={styles.compactOverflowSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.compactPanelTitle}>Camera</Text>
            {(['close', 'standard', 'wide'] as const).map(item => {
              const active = viewPreset === item;
              return (
                <TouchableOpacity key={item} style={[styles.compactMenuRow, active && styles.compactMenuRowActive]} onPress={() => applyView(item)}>
                  <Text style={[styles.compactMenuText, active && styles.compactMenuTextActive]}>
                    {item === 'close' ? 'Near' : item === 'standard' ? 'Mid' : 'Wide'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}
        {showSpeedPanel && smallCompact ? (
          <View style={styles.compactOverflowSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.compactPanelTitle}>Speed</Text>
            {PREVIEW_SPEED_PRESETS.map(item => {
              const active = Math.abs(clampPreviewSpeed(speed) - item.value) < 0.001;
              return (
                <TouchableOpacity key={item.label} style={[styles.compactMenuRow, active && styles.compactMenuRowActive]} onPress={() => applySpeed(item.value)}>
                  <Text style={[styles.compactMenuText, active && styles.compactMenuTextActive]}>{item.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}
        <View style={styles.compactRail}>
          {railButtons.map(button => (
            <TouchableOpacity
              key={button.key}
              style={[styles.compactBtn, button.active && styles.compactBtnActive]}
              onPress={button.onPress}
              accessibilityLabel={button.label}
            >
              <Ionicons name={button.icon} size={18} color={button.active ? '#101820' : '#f8fafc'} />
            </TouchableOpacity>
          ))}
        </View>
        {canSeek ? (
          <View
            style={styles.compactTrackHit}
            onLayout={onTrackLayout}
            {...panResponder.panHandlers}
            accessibilityRole="adjustable"
            accessibilityLabel="Flyover progress"
          >
            <View style={styles.compactTrack}>
              <View style={[styles.trackFill, { width: Math.max(8, clampedProgress * trackWidth) }]} />
              <View style={[styles.thumb, { left: Math.max(0, Math.min(trackWidth - 14, clampedProgress * trackWidth - 7)) }]} />
            </View>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {speedOpen && onSpeedChange ? (
        <View style={styles.speedPanel}>
          <View style={styles.speedGrid}>
            {PREVIEW_SPEED_PRESETS.map(item => {
              const active = Math.abs(clampPreviewSpeed(speed) - item.value) < 0.001;
              return (
                <TouchableOpacity
                  key={item.label}
                  style={[styles.speedChoice, active && styles.speedChoiceActive]}
                  onPress={() => applySpeed(item.value)}
                >
                  <Text style={[styles.speedChoiceText, active && styles.speedChoiceTextActive]}>{item.label}</Text>
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
      {viewOpen && onCameraPresetChange ? (
        <View style={styles.speedPanel}>
          <View style={styles.panelGroup}>
            <Text style={styles.customSpeedLabel}>Zoom</Text>
            <View style={styles.speedGrid}>
              {(['close', 'standard', 'wide'] as const).map(item => {
                const active = viewPreset === item;
                return (
                  <TouchableOpacity
                    key={item}
                    style={[styles.speedChoice, active && styles.speedChoiceActive]}
                    onPress={() => applyView(item)}
                  >
                    <Text style={[styles.speedChoiceText, active && styles.speedChoiceTextActive]}>
                      {item === 'close' ? 'Near' : item === 'standard' ? 'Mid' : 'Wide'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
          <View style={styles.panelGroup}>
            <Text style={styles.customSpeedLabel}>Tilt</Text>
            <View style={styles.speedGrid}>
              {(['low', 'trail', 'high'] as const).map(item => {
                const active = tiltPreset === item;
                return (
                  <TouchableOpacity
                    key={item}
                    style={[styles.speedChoice, active && styles.speedChoiceActive]}
                    onPress={() => applyTilt(item)}
                  >
                    <Text style={[styles.speedChoiceText, active && styles.speedChoiceTextActive]}>
                      {item === 'low' ? 'Low' : item === 'trail' ? 'Trail' : 'High'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
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
        {showSkip && onSkip && playing && !complete ? (
          <TouchableOpacity style={styles.btn} onPress={onSkip} accessibilityLabel="Skip scene">
            <Ionicons name="play-skip-forward" size={15} color="#f8fafc" />
          </TouchableOpacity>
        ) : null}
        {onExitToOverview ? (
          <TouchableOpacity
            style={[styles.btn, styles.overviewBtn]}
            onPress={onExitToOverview}
            accessibilityLabel="Back to trip overview"
          >
            <Ionicons name="return-up-back-outline" size={14} color="#fdba74" />
            <Text style={styles.overviewText}>Overview</Text>
          </TouchableOpacity>
        ) : null}
        {onToggleFreeCamera ? (
          <TouchableOpacity
            style={[styles.btn, styles.freeBtn, freeCamera && styles.freeBtnActive]}
            onPress={onToggleFreeCamera}
            accessibilityLabel={freeCamera ? 'Follow route camera' : 'Free camera'}
          >
            <Ionicons name={freeCamera ? 'lock-open-outline' : 'locate-outline'} size={14} color={freeCamera ? '#101820' : '#f8fafc'} />
            <Text style={[styles.freeText, freeCamera && styles.freeTextActive]}>{freeCamera ? 'Free' : 'Route'}</Text>
          </TouchableOpacity>
        ) : null}
        {onCameraPresetChange ? (
          <TouchableOpacity
            style={[styles.btn, styles.freeBtn]}
            onPress={() => {
              setViewOpen(open => !open);
              if (speedOpen) setSpeedOpen(false);
            }}
            accessibilityLabel="Camera view"
          >
            <Ionicons name="eye-outline" size={14} color="#f8fafc" />
            <Text style={styles.freeText}>{viewPreset === 'close' ? 'Near' : viewPreset === 'standard' ? 'Mid' : 'Wide'}</Text>
          </TouchableOpacity>
        ) : null}
        {onSpeedChange || onCycleSpeed ? (
          <TouchableOpacity
            style={[styles.btn, styles.speedBtn]}
            onPress={openSpeedPanel}
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
  compactWrap: {
    width: '100%',
    minWidth: 0,
    alignItems: 'center',
  },
  compactRail: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    gap: 6,
    minHeight: 62,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 28,
    backgroundColor: 'rgba(8,12,18,.93)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,.14)',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  compactBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,.08)',
  },
  compactBtnActive: {
    backgroundColor: '#bef995',
    borderColor: '#dcfce7',
  },
  compactCameraPanel: {
    position: 'absolute',
    right: 16,
    bottom: 78,
    width: 182,
    gap: 7,
    padding: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(8,12,18,.95)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,.14)',
    shadowColor: '#000',
    shadowOpacity: 0.32,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 11,
  },
  compactSpeedSheet: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 78,
    gap: 7,
    paddingHorizontal: 14,
    paddingTop: 13,
    paddingBottom: 14,
    borderRadius: 22,
    backgroundColor: 'rgba(8,12,18,.96)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,.14)',
    shadowColor: '#000',
    shadowOpacity: 0.32,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 11,
  },
  compactOverflowSheet: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 78,
    gap: 7,
    paddingHorizontal: 14,
    paddingTop: 13,
    paddingBottom: 14,
    borderRadius: 22,
    backgroundColor: 'rgba(8,12,18,.96)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,.14)',
    shadowColor: '#000',
    shadowOpacity: 0.32,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 11,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 2,
    marginBottom: 4,
    backgroundColor: 'rgba(255,255,255,.38)',
  },
  compactPanelTitle: {
    color: '#f8fafc',
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '900',
    letterSpacing: 0,
  },
  compactMenuRow: {
    minHeight: 34,
    borderRadius: 16,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,.045)',
  },
  compactMenuRowActive: {
    backgroundColor: '#bef995',
  },
  compactMenuText: {
    color: '#f8fafc',
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '800',
    letterSpacing: 0,
  },
  compactMenuTextActive: {
    color: '#101820',
  },
  compactMenuMeta: {
    color: 'rgba(248,250,252,.66)',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0,
  },
  compactCustomRow: {
    minHeight: 38,
    borderRadius: 16,
    paddingLeft: 12,
    paddingRight: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,.045)',
  },
  compactSpeedInput: {
    width: 72,
    height: 30,
    borderRadius: 12,
    paddingHorizontal: 10,
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '900',
    backgroundColor: 'rgba(255,255,255,.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,.12)',
  },
  compactTrackHit: {
    alignSelf: 'stretch',
    height: 22,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  compactTrack: {
    height: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(248,250,252,.20)',
    overflow: 'visible',
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 },
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
  panelGroup: {
    gap: 7,
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
  overviewBtn: {
    borderColor: 'rgba(251,146,60,.45)',
    backgroundColor: 'rgba(8,12,18,.9)',
  },
  overviewText: { color: '#fdba74', fontSize: 11, fontWeight: '900' },
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
