import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  testID?: string;
  visible?: boolean;
  initialStage?: TrailheadSnapStage;
  stage?: TrailheadSnapStage;
  onStageChange?: (stage: TrailheadSnapStage) => void;
  children: ReactNode;
  peekHeader?: ReactNode;
  peekHeight?: number;
  peekExpandsToFull?: boolean;
  hidePeekHeaderWhenExpanded?: boolean;
  expandedLoading?: boolean;
  expandedLoadingContent?: ReactNode;
  actionDock?: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  scrollContentStyle?: StyleProp<ViewStyle>;
  maxFullRatio?: number;
  halfRatio?: number;
  fullScreen?: boolean;
  initialScrollY?: number;
  scrollRestoreKey?: string | number;
  onScrollYChange?: (scrollY: number) => void;
};

export default function TrailheadSnapSheet({
  testID,
  visible = true,
  initialStage = 'half',
  stage: controlledStage,
  onStageChange,
  children,
  peekHeader,
  peekHeight,
  peekExpandsToFull = false,
  hidePeekHeaderWhenExpanded = false,
  expandedLoading = false,
  expandedLoadingContent,
  actionDock,
  style,
  contentStyle,
  scrollContentStyle,
  maxFullRatio = 0.84,
  halfRatio = 0.42,
  fullScreen = false,
  initialScrollY = 0,
  scrollRestoreKey,
  onScrollYChange,
}: Props) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [internalStage, setInternalStage] = useState<TrailheadSnapStage>(initialStage);
  const stage = controlledStage ?? internalStage;
  const dragY = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<ScrollView>(null);
  const pendingScrollRestoreRef = useRef<{ key: string; y: number } | null>(null);

  const updateStage = useCallback((next: TrailheadSnapStage) => {
    if (controlledStage == null) setInternalStage(next);
    onStageChange?.(next);
  }, [controlledStage, onStageChange]);

  useEffect(() => {
    if (stage === 'peek') return;
    const restore = {
      key: String(scrollRestoreKey ?? ''),
      y: Math.max(0, initialScrollY),
    };
    pendingScrollRestoreRef.current = restore;
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: restore.y, animated: false });
    });
    const expiry = setTimeout(() => {
      if (pendingScrollRestoreRef.current?.key === restore.key) {
        scrollRef.current?.scrollTo({ y: restore.y, animated: false });
        pendingScrollRestoreRef.current = null;
      }
    }, 750);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(expiry);
    };
  }, [initialScrollY, scrollRestoreKey, stage]);

  const restoreScrollAfterLayout = useCallback(() => {
    const pending = pendingScrollRestoreRef.current;
    if (!pending || stage === 'peek') return;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: pending.y, animated: false });
    });
  }, [stage]);

  const maxFull = fullScreen ? height : Math.min(height * maxFullRatio, height - Math.max(insets.top + 22, 54));
  const stageHeight = stage === 'full'
    ? maxFull
    : stage === 'half'
      ? Math.max(320, Math.min(height * halfRatio, 430))
      : peekHeight ?? Math.max(92, insets.bottom + 76);

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
        updateStage(stage === 'peek' ? (peekExpandsToFull ? 'full' : 'half') : 'full');
        return;
      }
      if (g.vy > 0.45 || g.dy > 90) {
        updateStage(stage === 'full' ? (peekExpandsToFull ? 'peek' : 'half') : 'peek');
        return;
      }
    },
  }), [dragY, peekExpandsToFull, stage, updateStage]);

  if (!visible) return null;

  return (
    <Animated.View
      testID={testID}
      pointerEvents="auto"
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
      <TrailheadSheet handle={false} style={[s.sheet, fullScreen && s.sheetFull, stage === 'peek' && s.sheetPeek]} contentStyle={[s.sheetContent, contentStyle]}>
        {peekHeader != null ? (
          <View style={s.grabberZone} {...pan.panHandlers}>
            <TouchableOpacity
              style={s.grabberTap}
              activeOpacity={0.78}
              onPress={() => updateStage(
                stage === 'full'
                  ? (peekExpandsToFull ? 'peek' : 'half')
                  : stage === 'half'
                    ? 'peek'
                    : (peekExpandsToFull ? 'full' : 'half'),
              )}
            >
              <View style={s.grabber} />
            </TouchableOpacity>
            {!hidePeekHeaderWhenExpanded || stage === 'peek' ? peekHeader : null}
          </View>
        ) : null}
        {stage !== 'peek' ? (
          expandedLoading ? (
            <View style={s.loadingContent}>{expandedLoadingContent}</View>
          ) : (
            <ScrollView
              ref={scrollRef}
              showsVerticalScrollIndicator={false}
              scrollEnabled
              keyboardShouldPersistTaps="handled"
              scrollEventThrottle={32}
              onScroll={onScrollYChange ? event => onScrollYChange(event.nativeEvent.contentOffset.y) : undefined}
              onContentSizeChange={restoreScrollAfterLayout}
              contentContainerStyle={[s.scrollContent, actionDock ? s.scrollWithDock : null, scrollContentStyle]}
            >
              {children}
            </ScrollView>
          )
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
  sheetFull: {
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
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
  loadingContent: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 10,
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
