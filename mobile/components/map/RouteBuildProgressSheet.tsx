import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme, type ColorPalette } from '@/lib/design';
import type { RouteBuildSession } from '@/lib/routeBuildSession';

export type RouteBuildProgressSheetProps = {
  session: RouteBuildSession;
  bottomInset: number;
  onCancel: () => void;
  onRetry?: () => void;
  onDismiss?: () => void;
};

type ProgressRowState = 'active' | 'complete' | 'pending' | 'failed';

type ProgressRow = {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  state: ProgressRowState;
};

const COLLAPSED_HEIGHT = 106;

function phaseTitle(session: RouteBuildSession) {
  if (session.status === 'failed' || session.phase === 'failed') return "Couldn't finish this trip";
  if (session.status === 'cancelled' || session.phase === 'cancelled') return 'Trip setup stopped';
  if (session.status === 'complete' || session.phase === 'complete') return 'Your trip is ready';

  switch (session.phase) {
    case 'routing':
      return 'Building your route';
    case 'camps':
      return 'Finding overnight stops';
    case 'fuel':
      return 'Checking fuel stops';
    case 'activities':
      return session.activityChoice === 'browse' ? 'Finding things to do' : 'Choose your stops';
    case 'saving':
      return 'Saving your trip';
    default:
      return 'Preparing your trip';
  }
}

function formatDistance(distanceMi: number | null) {
  if (!Number.isFinite(distanceMi) || distanceMi == null || distanceMi <= 0) return '';
  return `${Math.round(distanceMi).toLocaleString()} mi`;
}

function formatDuration(durationHours: number | null) {
  if (!Number.isFinite(durationHours) || durationHours == null || durationHours <= 0) return '';
  const totalMinutes = Math.round(durationHours * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) return `${minutes} min`;
  if (!minutes) return `${hours} hr`;
  return `${hours} hr ${minutes} min`;
}

function progressCount(completed: number, total: number, noun: string) {
  const safeCompleted = Math.max(0, Math.round(completed));
  const safeTotal = Math.max(0, Math.round(total));
  if (!safeTotal) return `Checking ${noun}`;
  if (safeCompleted >= safeTotal) return `${safeTotal} found`;
  return `${Math.min(safeCompleted, safeTotal)} of ${safeTotal}`;
}

function phaseHasPassed(session: RouteBuildSession, phase: RouteBuildSession['phase']) {
  const order: RouteBuildSession['phase'][] = [
    'routing',
    'camps',
    'fuel',
    'activities',
    'saving',
    'complete',
  ];
  const current = order.indexOf(session.phase);
  const target = order.indexOf(phase);
  return current > target || session.status === 'complete';
}

function rowState(
  session: RouteBuildSession,
  phase: 'routing' | 'camps' | 'fuel',
  complete: boolean,
): ProgressRowState {
  if (complete || phaseHasPassed(session, phase)) return 'complete';
  if (session.status === 'failed') return 'failed';
  if (session.status === 'running' && session.phase === phase) return 'active';
  return 'pending';
}

function buildRows(session: RouteBuildSession): ProgressRow[] {
  const routeReady = session.routeCoords.length >= 2;
  const routeMetrics = [
    formatDistance(session.totalDistanceMi),
    formatDuration(session.totalDurationHours),
  ].filter(Boolean).join('  ·  ');
  const rows: ProgressRow[] = [{
    id: 'route',
    icon: 'navigate-outline',
    label: 'Route',
    value: routeMetrics || (routeReady ? 'Ready' : 'Finding roads'),
    state: rowState(session, 'routing', routeReady),
  }];

  const showCamps = session.camps.total > 0
    || session.camps.completed > 0
    || session.phase === 'camps'
    || phaseHasPassed(session, 'camps');
  if (showCamps) {
    rows.push({
      id: 'camps',
      icon: 'moon-outline',
      label: 'Overnight stops',
      value: progressCount(session.camps.completed, session.camps.total, 'stops'),
      state: rowState(
        session,
        'camps',
        session.camps.total > 0 && session.camps.completed >= session.camps.total,
      ),
    });
  }

  const showFuel = session.fuel.total > 0
    || session.fuel.completed > 0
    || session.phase === 'fuel';
  if (showFuel) {
    rows.push({
      id: 'fuel',
      icon: 'flash-outline',
      label: 'Fuel stops',
      value: progressCount(session.fuel.completed, session.fuel.total, 'stops'),
      state: rowState(
        session,
        'fuel',
        session.fuel.total > 0 && session.fuel.completed >= session.fuel.total,
      ),
    });
  }

  return rows;
}

function StatusMark({ state, colors }: { state: ProgressRowState; colors: ColorPalette }) {
  if (state === 'active') {
    return <ActivityIndicator size="small" color={colors.orange} />;
  }
  const icon = state === 'complete'
    ? 'checkmark-circle'
    : state === 'failed'
      ? 'alert-circle'
      : 'ellipse-outline';
  const color = state === 'complete'
    ? colors.green
    : state === 'failed'
      ? colors.red
      : colors.text3;
  return <Ionicons name={icon} size={19} color={color} />;
}

export default function RouteBuildProgressSheet({
  session,
  bottomInset,
  onCancel,
  onRetry,
  onDismiss,
}: RouteBuildProgressSheetProps) {
  const C = useTheme();
  const styles = useMemo(() => makeStyles(C), [C]);
  const [expanded, setExpanded] = useState(true);
  const dragY = useRef(new Animated.Value(0)).current;
  const height = useRef(new Animated.Value(COLLAPSED_HEIGHT)).current;
  const rows = useMemo(() => buildRows(session), [session]);
  const title = phaseTitle(session);
  const finished = session.status !== 'running';
  const failed = session.status === 'failed' || session.phase === 'failed';
  const expandedHeight = Math.min(338, 206 + rows.length * 48 + (failed ? 40 : 0));

  useEffect(() => {
    Animated.spring(height, {
      toValue: expanded ? expandedHeight : COLLAPSED_HEIGHT,
      damping: 24,
      stiffness: 240,
      mass: 0.8,
      useNativeDriver: false,
    }).start();
  }, [expanded, expandedHeight, height]);

  useEffect(() => {
    if (failed) setExpanded(true);
  }, [failed]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) => (
      Math.abs(gesture.dy) > 7 && Math.abs(gesture.dy) > Math.abs(gesture.dx)
    ),
    onMoveShouldSetPanResponderCapture: (_, gesture) => (
      Math.abs(gesture.dy) > 9 && Math.abs(gesture.dy) > Math.abs(gesture.dx)
    ),
    onPanResponderMove: (_, gesture) => {
      dragY.setValue(Math.max(-26, Math.min(110, gesture.dy)));
    },
    onPanResponderTerminationRequest: () => false,
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dy > 48 || gesture.vy > 0.45) setExpanded(false);
      if (gesture.dy < -42 || gesture.vy < -0.45) setExpanded(true);
      Animated.spring(dragY, {
        toValue: 0,
        damping: 23,
        stiffness: 260,
        mass: 0.7,
        useNativeDriver: true,
      }).start();
    },
    onPanResponderTerminate: () => {
      Animated.spring(dragY, {
        toValue: 0,
        useNativeDriver: true,
      }).start();
    },
  }), [dragY]);

  const primaryAction = failed && onRetry
    ? { label: 'Edit trip', icon: 'create' as const, onPress: onRetry }
    : finished && onDismiss
      ? { label: 'Close', icon: 'close' as const, onPress: onDismiss }
      : null;

  return (
    <Animated.View
      style={[
        styles.positioner,
        {
          bottom: Math.max(bottomInset + 10, 14),
          height,
          transform: [{ translateY: dragY }],
        },
      ]}
      pointerEvents="box-none"
    >
      <View style={styles.sheet} accessibilityRole="summary">
        <View style={styles.dragZone} {...panResponder.panHandlers}>
          <TouchableOpacity
            style={styles.handleButton}
            activeOpacity={0.82}
            onPress={() => setExpanded(value => !value)}
            accessibilityRole="button"
            accessibilityLabel={expanded ? 'Collapse trip progress' : 'Expand trip progress'}
          >
            <View style={styles.handle} />
          </TouchableOpacity>

          <View style={styles.headingRow}>
            <View style={styles.headingCopy}>
              <Text style={styles.routeName} numberOfLines={1}>{session.routeName || 'New trip'}</Text>
              <Text style={styles.phaseTitle} numberOfLines={1}>{title}</Text>
            </View>
            <TouchableOpacity
              style={styles.expandButton}
              activeOpacity={0.78}
              onPress={() => setExpanded(value => !value)}
              accessibilityRole="button"
              accessibilityLabel={expanded ? 'Collapse trip progress' : 'Expand trip progress'}
            >
              <Ionicons name={expanded ? 'chevron-down' : 'chevron-up'} size={19} color={C.text2} />
            </TouchableOpacity>
          </View>
        </View>

        {expanded ? (
          <View style={styles.details}>
            <View style={styles.rows}>
              {rows.map((row, index) => (
                <View
                  key={row.id}
                  style={[styles.progressRow, index < rows.length - 1 && styles.rowDivider]}
                  accessible
                  accessibilityLabel={`${row.label}, ${row.value}`}
                >
                  <Ionicons name={row.icon} size={18} color={C.text2} />
                  <Text style={styles.rowLabel} numberOfLines={1}>{row.label}</Text>
                  <Text style={styles.rowValue} numberOfLines={1}>{row.value}</Text>
                  <View style={styles.statusMark}>
                    <StatusMark state={row.state} colors={C} />
                  </View>
                </View>
              ))}
            </View>

            {failed ? (
              <Text style={styles.failureCopy}>Review the trip details and try again.</Text>
            ) : null}

            <View style={styles.actions}>
              {session.status === 'running' ? (
                <TouchableOpacity
                  style={styles.secondaryButton}
                  activeOpacity={0.78}
                  onPress={onCancel}
                  accessibilityRole="button"
                  accessibilityLabel={session.phase === 'activities' ? 'Skip tours' : 'Stop trip setup'}
                >
                  <Ionicons name="close" size={17} color={C.text2} />
                  <Text style={styles.secondaryButtonText}>{session.phase === 'activities' ? 'Skip tours' : 'Stop'}</Text>
                </TouchableOpacity>
              ) : null}
              {failed && onDismiss ? (
                <TouchableOpacity
                  style={styles.secondaryButton}
                  activeOpacity={0.78}
                  onPress={onDismiss}
                  accessibilityRole="button"
                  accessibilityLabel="Close trip progress"
                >
                  <Text style={styles.secondaryButtonText}>Close</Text>
                </TouchableOpacity>
              ) : null}
              {primaryAction ? (
                <TouchableOpacity
                  style={styles.primaryButton}
                  activeOpacity={0.82}
                  onPress={primaryAction.onPress}
                  accessibilityRole="button"
                  accessibilityLabel={primaryAction.label}
                >
                  <Ionicons name={primaryAction.icon} size={17} color={styles.primaryButtonText.color} />
                  <Text style={styles.primaryButtonText}>{primaryAction.label}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

const makeStyles = (C: ColorPalette) => {
  const light = String(C.bg).toLowerCase() !== '#050505';
  const primaryText = light ? '#FFFFFF' : '#111418';

  return StyleSheet.create({
    positioner: {
      position: 'absolute',
      left: 12,
      right: 12,
      zIndex: 145,
      elevation: 145,
    },
    sheet: {
      flex: 1,
      overflow: 'hidden',
      borderRadius: 16,
      borderWidth: 1,
      borderColor: C.border2,
      backgroundColor: C.s1,
      shadowColor: '#000000',
      shadowOpacity: light ? 0.2 : 0.34,
      shadowRadius: 22,
      shadowOffset: { width: 0, height: 10 },
      elevation: 18,
    },
    dragZone: {
      minHeight: COLLAPSED_HEIGHT,
      paddingHorizontal: 16,
      paddingBottom: 13,
    },
    handleButton: {
      minHeight: 28,
      alignItems: 'center',
      justifyContent: 'center',
    },
    handle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: C.border2,
    },
    headingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    headingCopy: {
      flex: 1,
      minWidth: 0,
    },
    routeName: {
      color: C.text,
      fontSize: 18,
      lineHeight: 22,
      fontWeight: '800',
      letterSpacing: 0,
    },
    phaseTitle: {
      marginTop: 3,
      color: C.text2,
      fontSize: 13,
      lineHeight: 17,
      fontWeight: '600',
      letterSpacing: 0,
    },
    expandButton: {
      width: 42,
      height: 42,
      alignItems: 'center',
      justifyContent: 'center',
    },
    details: {
      flex: 1,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: C.border,
      paddingHorizontal: 16,
      paddingBottom: 14,
    },
    rows: {
      flexShrink: 1,
    },
    progressRow: {
      minHeight: 47,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    rowDivider: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: C.border,
    },
    rowLabel: {
      flex: 1,
      minWidth: 0,
      color: C.text,
      fontSize: 14,
      lineHeight: 18,
      fontWeight: '700',
      letterSpacing: 0,
    },
    rowValue: {
      maxWidth: '44%',
      color: C.text2,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '600',
      textAlign: 'right',
      letterSpacing: 0,
    },
    statusMark: {
      width: 22,
      alignItems: 'center',
      justifyContent: 'center',
    },
    failureCopy: {
      color: C.text2,
      fontSize: 13,
      lineHeight: 18,
      letterSpacing: 0,
      paddingTop: 10,
    },
    actions: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 8,
      paddingTop: 10,
    },
    secondaryButton: {
      minHeight: 42,
      paddingHorizontal: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: C.border2,
      backgroundColor: C.s2,
    },
    secondaryButtonText: {
      color: C.text2,
      fontSize: 14,
      lineHeight: 18,
      fontWeight: '700',
      letterSpacing: 0,
    },
    primaryButton: {
      minHeight: 42,
      paddingHorizontal: 16,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      borderRadius: 8,
      backgroundColor: C.orange,
    },
    primaryButtonText: {
      color: primaryText,
      fontSize: 14,
      lineHeight: 18,
      fontWeight: '800',
      letterSpacing: 0,
    },
  });
};
