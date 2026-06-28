import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { TrailheadSkeletonLine } from '@/components/TrailheadUI';
import { mono, useTheme, type ColorPalette } from '@/lib/design';
import type { RouteScoutState, RouteScoutStop } from '@/lib/api';

type Props = {
  visible: boolean;
  routeScout: RouteScoutState | null;
  onClose: () => void;
  onRescout: () => void;
  onOpenBuilder: () => void;
  onStopPress: (stop: RouteScoutStop) => void;
};

export default function RouteScoutPanel({
  visible,
  routeScout,
  onClose,
  onRescout,
  onOpenBuilder,
  onStopPress,
}: Props) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const primaryActionTextColor = C.bg === '#F7F8F6' ? '#101820' : '#fff';

  if (!visible || !routeScout || routeScout.status === 'idle') return null;

  const statusIcon = routeScout.status === 'scouting'
    ? 'scan-outline'
    : routeScout.status === 'failed'
      ? 'alert-circle-outline'
      : 'map-outline';
  const statusColor = routeScout.status === 'failed' ? C.red : C.orange;
  const progressWidth = `${Math.max(6, Math.min(100, routeScout.progressPct ?? 8))}%` as const;
  const stops = (routeScout.stops ?? routeScout.previewStops ?? []).slice(0, 10);
  const subtitle = [routeScout.startName, routeScout.destinationName].filter(Boolean).join(' -> ') || routeScout.message;

  return (
    <View style={s.panel} pointerEvents="auto">
      <View style={s.top}>
        <View style={s.titleWrap}>
          <Ionicons name={statusIcon} size={14} color={statusColor} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.title}>ROUTE SCOUT</Text>
            <Text style={s.sub} numberOfLines={1}>{subtitle}</Text>
          </View>
        </View>
        <TouchableOpacity onPress={onClose} hitSlop={10}>
          <Ionicons name="close" size={15} color={C.text3} />
        </TouchableOpacity>
      </View>

      {routeScout.status === 'scouting' ? (
        <View style={s.progressWrap}>
          <View style={s.progressTrack}>
            <View style={[s.progressFill, { width: progressWidth }]} />
          </View>
          <Text style={s.phaseText} numberOfLines={1}>{routeScout.phaseLabel || routeScout.message}</Text>
        </View>
      ) : null}

      <Text style={s.message} numberOfLines={routeScout.status === 'scouting' ? 2 : 6}>
        {routeScout.message}
      </Text>

      <View style={s.stats}>
        <Text style={s.stat}>{routeScout.days ? `${routeScout.days} days` : 'Days TBD'}</Text>
        <Text style={s.stat}>{routeScout.driveHours ? `${routeScout.driveHours}h/day` : 'Drive time TBD'}</Text>
        <Text style={s.stat}>{routeScout.totalMiles ? `${Math.round(routeScout.totalMiles)} mi` : 'Routing'}</Text>
      </View>

      {stops.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.stops}>
          {stops.map((stop, idx) => {
            const tone = stop.type === 'review' ? C.red : stop.type === 'camp' ? '#22c55e' : C.orange;
            return (
              <TouchableOpacity
                key={`${stop.type}-${stop.day}-${stop.lat}-${stop.lng}-${idx}`}
                style={[s.stop, stop.type === 'review' && s.stopReview]}
                onPress={() => onStopPress(stop)}
              >
                <Ionicons
                  name={stop.type === 'camp'
                    ? 'bonfire-outline'
                    : stop.type === 'destination'
                      ? 'flag-outline'
                      : stop.type === 'review'
                        ? 'help-circle-outline'
                        : 'radio-button-on-outline'}
                  size={13}
                  color={tone}
                />
                <Text style={s.stopName} numberOfLines={1}>{stop.name}</Text>
                <Text style={s.stopMeta} numberOfLines={1}>{stop.label || (stop.day ? `Day ${stop.day}` : 'Start')}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      ) : routeScout.status === 'scouting' ? (
        <View style={s.scoutSkeleton}>
          <TrailheadSkeletonLine width={118} height={54} style={s.scoutSkeletonCard} />
          <TrailheadSkeletonLine width={118} height={54} style={s.scoutSkeletonCard} />
          <TrailheadSkeletonLine width={118} height={54} style={s.scoutSkeletonCard} />
        </View>
      ) : null}

      <View style={s.actions}>
        <TouchableOpacity style={s.action} onPress={onRescout}>
          <Ionicons name="refresh-outline" size={13} color={C.text2} />
          <Text style={s.actionText}>Rescout</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.action, s.actionPrimary]} onPress={onOpenBuilder}>
          <Ionicons name="git-branch-outline" size={13} color={primaryActionTextColor} />
          <Text style={[s.actionText, s.actionPrimaryText]}>Builder</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = (C: ColorPalette) => {
  const light = C.bg === '#F7F8F6';
  const panelBg = light ? 'rgba(255,255,255,0.96)' : 'rgba(5, 9, 12, 0.92)';
  const softBg = light ? 'rgba(15,23,42,0.045)' : 'rgba(255,255,255,0.055)';
  const progressTrackBg = light ? 'rgba(15,23,42,0.08)' : 'rgba(255,255,255,0.08)';
  const primaryText = light ? '#101820' : '#fff';
  return StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 118,
    backgroundColor: panelBg,
    borderWidth: 1,
    borderColor: C.orange + '66',
    borderRadius: 14,
    padding: 11,
    zIndex: 9050,
    elevation: 95,
    shadowColor: '#000',
    shadowOpacity: light ? 0.16 : 0.3,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 9 },
  },
  top: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  titleWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  title: {
    color: C.orange,
    fontSize: 10,
    fontFamily: mono,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  sub: {
    color: C.text3,
    fontSize: 10,
    fontFamily: mono,
    marginTop: 2,
  },
  progressWrap: {
    marginTop: 9,
    gap: 6,
  },
  progressTrack: {
    height: 4,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: progressTrackBg,
    borderWidth: 1,
    borderColor: C.border2,
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: C.orange,
  },
  phaseText: {
    color: C.orange,
    fontSize: 10,
    fontFamily: mono,
    fontWeight: '900',
  },
  message: {
    color: C.text2,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8,
  },
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 9,
  },
  stat: {
    color: C.text2,
    fontSize: 9,
    fontFamily: mono,
    fontWeight: '800',
    borderWidth: 1,
    borderColor: C.border2,
    backgroundColor: softBg,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  stops: {
    gap: 8,
    paddingTop: 10,
    paddingRight: 4,
  },
  scoutSkeleton: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 10,
    overflow: 'hidden',
  },
  scoutSkeletonCard: {
    borderRadius: 10,
  },
  stop: {
    width: 146,
    minHeight: 62,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border2,
    backgroundColor: softBg,
    padding: 8,
    justifyContent: 'center',
  },
  stopReview: {
    borderColor: C.red + '66',
    backgroundColor: C.red + '12',
  },
  stopName: {
    color: C.text,
    fontSize: 11,
    fontWeight: '900',
    marginTop: 5,
  },
  stopMeta: {
    color: C.text3,
    fontSize: 9,
    fontFamily: mono,
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  action: {
    minHeight: 34,
    paddingHorizontal: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border2,
    backgroundColor: softBg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  actionPrimary: {
    backgroundColor: C.orange,
    borderColor: C.orange,
  },
  actionText: {
    color: C.text2,
    fontSize: 10,
    fontFamily: mono,
    fontWeight: '900',
  },
  actionPrimaryText: {
    color: primaryText,
  },
  });
};
