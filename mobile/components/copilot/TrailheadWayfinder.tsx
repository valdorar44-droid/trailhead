import { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTheme, type ColorPalette } from '@/lib/design';
import {
  resolveWayfinderVisualState,
  shouldAnimateWayfinderEntry,
  type TrailheadWayfinderState,
  type TrailheadWayfinderVisualState,
} from './wayfinderState';

export type { TrailheadWayfinderState } from './wayfinderState';

type Props = {
  state: TrailheadWayfinderState;
  size?: number;
  colors?: ColorPalette;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

type StateAppearance = {
  tone: string;
  dashed?: boolean;
  signal?: 'level' | 'voice';
  badge?: 'alert' | 'blocked' | 'offline' | 'paused' | 'complete';
};

function appearanceForState(
  state: TrailheadWayfinderVisualState,
  colors: ColorPalette,
): StateAppearance {
  switch (state) {
    case 'listening':
      return { tone: colors.blueGlow };
    case 'userSpeaking':
      return { tone: colors.green, signal: 'level' };
    case 'thinking':
      return { tone: colors.text2, dashed: true };
    case 'speaking':
      return { tone: colors.orange, signal: 'voice' };
    case 'error':
      return { tone: colors.red, badge: 'alert' };
    case 'noMicPermission':
      return { tone: colors.red, badge: 'blocked' };
    case 'disconnected':
      return { tone: colors.text3, badge: 'offline' };
    case 'flying':
      return { tone: colors.orange };
    case 'warning':
      return { tone: colors.orange, badge: 'alert' };
    case 'paused':
      return { tone: colors.text3, badge: 'paused' };
    case 'complete':
      return { tone: colors.green, badge: 'complete' };
    default:
      return { tone: colors.text3 };
  }
}

function TrailAndNorthMark({ size, colors }: { size: number; colors: ColorPalette }) {
  const unit = size / 34;
  const line = Math.max(2.4, 3.4 * unit);
  const arrowLine = Math.max(2.2, 3 * unit);

  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      <View
        style={[
          styles.trailSegment,
          {
            left: 4 * unit,
            top: 24 * unit,
            width: 13 * unit,
            height: line,
            borderRadius: line / 2,
            backgroundColor: colors.orange,
            transform: [{ rotate: '-47deg' }],
          },
        ]}
      />
      <View
        style={[
          styles.trailSegment,
          {
            left: 11 * unit,
            top: 17 * unit,
            width: 12 * unit,
            height: line,
            borderRadius: line / 2,
            backgroundColor: colors.orange,
            transform: [{ rotate: '-38deg' }],
          },
        ]}
      />
      <View
        style={[
          styles.trailSegment,
          {
            left: 19 * unit,
            top: 11 * unit,
            width: 8 * unit,
            height: line,
            borderRadius: line / 2,
            backgroundColor: colors.orange,
            transform: [{ rotate: '-58deg' }],
          },
        ]}
      />
      <View
        style={{
          position: 'absolute',
          left: 2 * unit,
          top: 27 * unit,
          width: 6 * unit,
          height: 6 * unit,
          borderRadius: 3 * unit,
          backgroundColor: colors.text,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: 23 * unit,
          top: 4 * unit,
          width: arrowLine,
          height: 26 * unit,
          borderRadius: arrowLine / 2,
          backgroundColor: colors.text,
        }}
      />
      <View
        style={[
          styles.arrowWing,
          {
            left: 18 * unit,
            top: 6 * unit,
            width: 9 * unit,
            height: arrowLine,
            borderRadius: arrowLine / 2,
            backgroundColor: colors.text,
            transform: [{ rotate: '-45deg' }],
          },
        ]}
      />
      <View
        style={[
          styles.arrowWing,
          {
            left: 24 * unit,
            top: 6 * unit,
            width: 9 * unit,
            height: arrowLine,
            borderRadius: arrowLine / 2,
            backgroundColor: colors.text,
            transform: [{ rotate: '45deg' }],
          },
        ]}
      />
    </View>
  );
}

function StateSignal({ kind, tone, size }: { kind: 'level' | 'voice'; tone: string; size: number }) {
  const scale = size / 56;
  const heights = kind === 'level' ? [7, 13, 18, 10] : [9, 17, 13, 20];

  return (
    <View
      pointerEvents="none"
      style={[
        styles.signal,
        {
          right: -4 * scale,
          top: size / 2 - 11 * scale,
          height: 22 * scale,
          gap: Math.max(2, 3 * scale),
        },
      ]}
    >
      {heights.map((height, index) => (
        <View
          key={`${kind}-${index}`}
          style={{
            width: Math.max(1.5, 2 * scale),
            height: height * scale,
            borderRadius: scale,
            backgroundColor: tone,
          }}
        />
      ))}
    </View>
  );
}

function StateBadge({
  kind,
  tone,
  size,
  surface,
  foreground,
}: {
  kind: NonNullable<StateAppearance['badge']>;
  tone: string;
  size: number;
  surface: string;
  foreground: string;
}) {
  const badgeSize = Math.max(15, size * 0.3);
  const stroke = Math.max(1.5, size * 0.036);

  return (
    <View
      pointerEvents="none"
      style={[
        styles.badge,
        {
          width: badgeSize,
          height: badgeSize,
          borderRadius: badgeSize / 2,
          right: 0,
          top: 0,
          backgroundColor: tone,
          borderColor: surface,
        },
      ]}
    >
      {(kind === 'alert') && (
        <>
          <View style={{ width: stroke, height: badgeSize * 0.38, borderRadius: stroke, backgroundColor: foreground }} />
          <View style={{ width: stroke * 1.2, height: stroke * 1.2, borderRadius: stroke, marginTop: stroke, backgroundColor: foreground }} />
        </>
      )}
      {kind === 'blocked' && (
        <>
          <View style={[styles.badgeDiagonal, { width: badgeSize * 0.52, height: stroke, backgroundColor: foreground, transform: [{ rotate: '45deg' }] }]} />
          <View style={[styles.badgeDiagonal, { width: badgeSize * 0.52, height: stroke, backgroundColor: foreground, transform: [{ rotate: '-45deg' }] }]} />
        </>
      )}
      {kind === 'offline' && (
        <View style={{ width: badgeSize * 0.48, height: stroke, borderRadius: stroke, backgroundColor: foreground }} />
      )}
      {kind === 'paused' && (
        <View style={{ flexDirection: 'row', gap: Math.max(2, stroke), alignItems: 'center' }}>
          <View style={{ width: stroke, height: badgeSize * 0.45, borderRadius: stroke, backgroundColor: foreground }} />
          <View style={{ width: stroke, height: badgeSize * 0.45, borderRadius: stroke, backgroundColor: foreground }} />
        </View>
      )}
      {kind === 'complete' && (
        <View style={{ width: badgeSize * 0.48, height: badgeSize * 0.4 }}>
          <View style={{ position: 'absolute', left: 0, bottom: badgeSize * 0.08, width: badgeSize * 0.23, height: stroke, borderRadius: stroke, backgroundColor: foreground, transform: [{ rotate: '42deg' }] }} />
          <View style={{ position: 'absolute', right: 0, top: badgeSize * 0.11, width: badgeSize * 0.42, height: stroke, borderRadius: stroke, backgroundColor: foreground, transform: [{ rotate: '-48deg' }] }} />
        </View>
      )}
    </View>
  );
}

export function TrailheadWayfinder({
  state,
  size = 56,
  colors,
  style,
  testID,
}: Props) {
  const themeColors = useTheme();
  const C = colors ?? themeColors;
  const targetSize = Math.max(40, size);
  const visualState = resolveWayfinderVisualState(state);
  const appearance = appearanceForState(visualState, C);
  const transition = useRef(new Animated.Value(1)).current;
  const shouldAnimate = shouldAnimateWayfinderEntry(state);

  useEffect(() => {
    transition.stopAnimation();
    if (!shouldAnimate) {
      transition.setValue(1);
      return;
    }
    transition.setValue(0);
    const entry = Animated.timing(transition, {
      toValue: 1,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    entry.start();
    return () => entry.stop();
  }, [shouldAnimate, state, transition]);

  const ringSize = targetSize - 8;
  const coreSize = targetSize - 15;
  const markSize = targetSize - 24;
  const entryScale = transition.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] });
  const entryOpacity = transition.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });

  return (
    <Animated.View
      testID={testID}
      accessible={false}
      pointerEvents="none"
      style={[
        styles.root,
        { width: targetSize, height: targetSize, opacity: entryOpacity, transform: [{ scale: entryScale }] },
        style,
      ]}
    >
      <View
        style={{
          position: 'absolute',
          width: ringSize,
          height: ringSize,
          borderRadius: ringSize / 2,
          borderWidth: visualState === 'idle' ? 1.5 : 2.4,
          borderStyle: appearance.dashed ? 'dashed' : 'solid',
          borderColor: appearance.tone,
        }}
      />
      <View
        style={{
          width: coreSize,
          height: coreSize,
          borderRadius: coreSize / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: C.s1,
          borderWidth: 1,
          borderColor: C.border,
        }}
      >
        <TrailAndNorthMark size={markSize} colors={C} />
      </View>
      {appearance.signal && <StateSignal kind={appearance.signal} tone={appearance.tone} size={targetSize} />}
      {appearance.badge && (
        <StateBadge
          kind={appearance.badge}
          tone={appearance.tone}
          size={targetSize}
          surface={C.s1}
          foreground={C.white}
        />
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  trailSegment: {
    position: 'absolute',
  },
  arrowWing: {
    position: 'absolute',
  },
  signal: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  badgeDiagonal: {
    position: 'absolute',
    borderRadius: 2,
  },
});
