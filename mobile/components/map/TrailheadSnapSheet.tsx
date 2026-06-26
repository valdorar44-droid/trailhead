import React, { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme, type ColorPalette } from '@/lib/design';
import { TrailheadSheet } from '@/components/TrailheadUI';

export type TrailheadSnapStage = 'peek' | 'half' | 'full';

type Props = {
  visible?: boolean;
  initialStage?: TrailheadSnapStage;
  children: ReactNode;
  peekHeader: ReactNode;
  actionDock?: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  scrollContentStyle?: StyleProp<ViewStyle>;
  maxFullRatio?: number;
  halfRatio?: number;
};

export default function TrailheadSnapSheet({
  visible = true,
  initialStage = 'half',
  children,
  peekHeader,
  actionDock,
  style,
  contentStyle,
  scrollContentStyle,
  maxFullRatio = 0.84,
  halfRatio = 0.42,
}: Props) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [stage, setStage] = useState<TrailheadSnapStage>(initialStage);
  const dragY = useRef(new Animated.Value(0)).current;

  const maxFull = Math.min(height * maxFullRatio, height - Math.max(insets.top + 22, 54));
  const stageHeight = stage === 'full'
    ? maxFull
    : stage === 'half'
      ? Math.max(320, Math.min(height * halfRatio, 430))
      : Math.max(92, insets.bottom + 76);

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 7 && Math.abs(g.dy) > Math.abs(g.dx),
    onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dy) > 9 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderMove: (_, g) => {
      const next = stage === 'full' ? Math.max(0, g.dy) : g.dy;
      dragY.setValue(Math.max(-220, Math.min(260, next)));
    },
    onPanResponderTerminationRequest: () => false,
    onPanResponderRelease: (_, g) => {
      dragY.setValue(0);
      if (g.vy < -0.45 || g.dy < -90) {
        setStage(stage === 'peek' ? 'half' : 'full');
        return;
      }
      if (g.vy > 0.45 || g.dy > 90) {
        setStage(stage === 'full' ? 'half' : 'peek');
        return;
      }
      setStage(current => current);
    },
  }), [dragY, stage]);

  if (!visible) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        s.wrap,
        {
          height: stageHeight,
          paddingBottom: Math.max(insets.bottom, 10),
          transform: [{ translateY: dragY }],
        },
        style,
      ]}
    >
      <TrailheadSheet handle={false} style={[s.sheet, stage === 'peek' && s.sheetPeek]} contentStyle={[s.sheetContent, contentStyle]}>
        <View style={s.grabberZone} {...pan.panHandlers}>
          <TouchableOpacity
            style={s.grabberTap}
            activeOpacity={0.78}
            onPress={() => setStage(current => current === 'full' ? 'half' : current === 'half' ? 'peek' : 'half')}
          >
            <View style={s.grabber} />
          </TouchableOpacity>
          {peekHeader}
        </View>
        {stage !== 'peek' ? (
          <ScrollView
            showsVerticalScrollIndicator={false}
            scrollEnabled
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[s.scrollContent, actionDock ? s.scrollWithDock : null, scrollContentStyle]}
          >
            {children}
          </ScrollView>
        ) : null}
        {stage !== 'peek' && actionDock ? <View style={s.actionDock}>{actionDock}</View> : null}
      </TrailheadSheet>
    </Animated.View>
  );
}

const makeStyles = (C: ColorPalette) => StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 60,
  },
  sheet: {
    flex: 1,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  sheetPeek: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
  },
  sheetContent: {
    flex: 1,
    padding: 0,
    overflow: 'hidden',
  },
  grabberZone: {
    paddingTop: 8,
    paddingHorizontal: 14,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
  },
  grabberTap: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  grabber: {
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: C.border2,
  },
  scrollContent: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 28,
    gap: 12,
  },
  scrollWithDock: {
    paddingBottom: 104,
  },
  actionDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 28 : 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    backgroundColor: C.bg,
  },
});
