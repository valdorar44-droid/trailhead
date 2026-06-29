import React, { useEffect, useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { TrailheadSkeletonLine } from '@/components/TrailheadUI';
import { mono, useTheme, type ColorPalette } from '@/lib/design';
import type { RouteScoutDayPlan, RouteScoutState, RouteScoutStop } from '@/lib/api';

export type RouteScoutDayActionKind = 'camp' | 'fuel' | 'places' | 'tours';

export type RouteScoutDayActionItem = {
  id: string;
  title: string;
  meta?: string | null;
  photoUrl?: string | null;
  icon?: keyof typeof Ionicons.glyphMap;
  color?: string;
  lat?: number | null;
  lng?: number | null;
  url?: string | null;
  payload?: unknown;
};

export type RouteScoutDayActionState = {
  day: number;
  kind: RouteScoutDayActionKind;
  loading: boolean;
  title: string;
  subtitle?: string | null;
  message?: string | null;
  items: RouteScoutDayActionItem[];
};

type Props = {
  visible: boolean;
  routeScout: RouteScoutState | null;
  dayActionState?: RouteScoutDayActionState | null;
  onClose: () => void;
  onRescout: () => void;
  onOpenBuilder: () => void;
  onStopPress: (stop: RouteScoutStop) => void;
  onDayAction: (plan: RouteScoutDayPlan, kind: RouteScoutDayActionKind) => void;
  onDayActionItemPress: (item: RouteScoutDayActionItem) => void;
};

type Tier = 'peek' | 'half' | 'full';

const tierOrder: Tier[] = ['peek', 'half', 'full'];

function nextTier(tier: Tier): Tier {
  const idx = tierOrder.indexOf(tier);
  return tierOrder[(idx + 1) % tierOrder.length] ?? 'half';
}

function fallbackDayPlans(routeScout: RouteScoutState): RouteScoutDayPlan[] {
  const stops = routeScout.stops ?? routeScout.previewStops ?? [];
  const days = Math.max(1, Math.round(Number(routeScout.days) || Math.max(1, ...stops.map(stop => Number(stop.day) || 1))));
  return Array.from({ length: days }, (_, idx) => {
    const day = idx + 1;
    const stop = stops.find(item => Number(item.day) === day && item.type !== 'start') ?? null;
    const isReview = stop?.type === 'review';
    const isCamp = stop?.type === 'camp';
    return {
      day,
      title: stop?.label || `Day ${day}`,
      status: routeScout.status === 'scouting' && !stop ? 'loading' : isCamp ? 'locked' : isReview ? 'review' : day === days ? 'finish' : 'missing',
      driveSummary: routeScout.totalMiles ? `~${Math.round(routeScout.totalMiles / Math.max(1, days))} mi` : 'Route window',
      startName: day === 1 ? routeScout.startName || 'Start' : `Day ${day - 1}`,
      endName: day === days ? routeScout.destinationName || stop?.name || 'Finish' : stop?.name || `Day ${day}`,
      campName: stop?.name ?? (routeScout.status === 'scouting' ? 'Checking camps' : null),
      campStatus: isCamp ? 'locked' : isReview ? 'review' : routeScout.status === 'scouting' ? 'loading' : 'missing',
      campMeta: stop?.description || stop?.reason || null,
      camp: stop?.camp ?? null,
      fuelStops: [],
      poiStops: [],
      reviewNotes: stop?.reason ? [stop.reason] : [],
    };
  });
}

function planTone(C: ColorPalette, status?: string | null) {
  const clean = String(status || '').toLowerCase();
  if (clean === 'locked' || clean === 'ready' || clean === 'finish') return C.green;
  if (clean === 'loading' || clean === 'scouting') return C.orange;
  if (clean === 'review') return C.yellow;
  return C.red;
}

function shortPlaceName(value?: string | null, headline = false) {
  const text = String(value || '').trim();
  if (!text) return '';
  const withoutCountry = text
    .replace(/\s*,\s*United States(?: of America)?$/i, '')
    .replace(/\s*,\s*USA$/i, '');
  const parts = withoutCountry.split(',').map(part => part.trim()).filter(Boolean);
  if (!parts.length) return withoutCountry || text;
  return headline ? parts[0] : parts.slice(0, 2).join(', ');
}

function cleanDriveSummary(value?: string | null) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text
    .replace(/\s*drive target\b/i, '')
    .replace(/\s*target\b/i, '')
    .replace(/^Destination area$/i, 'Finish area')
    .replace(/^Route window$/i, 'Route leg');
}

function dayStatusLabel(status?: string | null) {
  const clean = String(status || '').toLowerCase();
  if (clean === 'locked' || clean === 'ready' || clean === 'finish') return 'overnight set';
  if (clean === 'loading' || clean === 'scouting') return 'finding camp';
  if (clean === 'review') return 'review camp';
  return 'needs camp';
}

function campMetaText(plan: RouteScoutDayPlan) {
  const raw = String(plan.campMeta || '').trim();
  const campStatus = String(plan.campStatus || plan.status || '').toLowerCase();
  const sourcePattern = /^(ridb|osm|openstreetmap|geoapify|geoapify places|map data|recreation\.gov|route_scout_preview)$/i;
  const parts = raw
    .split(/\s*·\s*/)
    .map(part => part.trim())
    .filter(Boolean)
    .filter(part => !sourcePattern.test(part))
    .filter(part => !/slots? (are )?loading/i.test(part))
    .filter(part => !/^camp$/i.test(part))
    .slice(0, 3);
  if (parts.length) return parts.join(' · ');
  if (campStatus === 'loading' || String(plan.status || '').toLowerCase() === 'loading') return 'Finding overnight options';
  if (campStatus === 'review' || campStatus === 'missing') return 'Choose an overnight before starting';
  return 'Verify access, rules, and fit before you go';
}

function campPhotoUri(plan: RouteScoutDayPlan) {
  const camp = plan.camp as (NonNullable<RouteScoutDayPlan['camp']> & Record<string, any>) | null | undefined;
  if (!camp) return null;
  const candidates = [
    camp.hero_photo_url,
    camp.photo_url,
    camp.primary_image,
    camp.image_url,
    Array.isArray(camp.images) ? camp.images[0] : null,
    Array.isArray(camp.photos) ? camp.photos[0] : null,
    Array.isArray(camp.photo_candidates) ? camp.photo_candidates[0] : null,
  ];
  for (const item of candidates) {
    if (typeof item === 'string' && /^https?:\/\//i.test(item)) return item;
    if (item && typeof item === 'object' && typeof item.url === 'string' && /^https?:\/\//i.test(item.url)) return item.url;
  }
  return null;
}

function actionCopy(kind: RouteScoutDayActionKind) {
  if (kind === 'camp') return { icon: 'bonfire-outline' as const, label: 'Camp' };
  if (kind === 'fuel') return { icon: 'flash-outline' as const, label: 'Fuel' };
  if (kind === 'places') return { icon: 'trail-sign-outline' as const, label: 'Places' };
  return { icon: 'ticket-outline' as const, label: 'Tours' };
}

function reviewNotes(plan: RouteScoutDayPlan) {
  const campStatus = String(plan.campStatus || plan.status || '').toLowerCase();
  if (campStatus === 'locked' || campStatus === 'finish') return [];
  return (plan.reviewNotes ?? [])
    .map(note => String(note || '').trim())
    .filter(Boolean)
    .filter(note => !/^locked\b/i.test(note))
    .filter(note => !/route_scout|ridb|geoapify|openstreetmap|\bOSM\b/i.test(note))
    .filter(note => !/slots? (are )?loading/i.test(note))
    .slice(0, 2);
}

function planIcon(status?: string | null) {
  const clean = String(status || '').toLowerCase();
  if (clean === 'locked' || clean === 'ready') return 'checkmark-circle-outline' as const;
  if (clean === 'finish') return 'flag-outline' as const;
  if (clean === 'loading' || clean === 'scouting') return 'scan-outline' as const;
  if (clean === 'review') return 'help-circle-outline' as const;
  return 'alert-circle-outline' as const;
}

function stopFromDayPlan(plan: RouteScoutDayPlan): RouteScoutStop | null {
  const camp = plan.camp;
  if (camp?.lat && camp?.lng && plan.campName) {
    return {
      day: plan.day,
      name: plan.campName,
      lat: camp.lat,
      lng: camp.lng,
      type: plan.campStatus === 'locked' ? 'camp' : 'review',
      label: plan.title,
      description: plan.campMeta || undefined,
      camp,
    };
  }
  return null;
}

export default function RouteScoutPanel({
  visible,
  routeScout,
  dayActionState,
  onClose,
  onRescout,
  onOpenBuilder,
  onStopPress,
  onDayAction,
  onDayActionItemPress,
}: Props) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const [tier, setTier] = useState<Tier>('half');

  useEffect(() => {
    if (!routeScout || routeScout.status === 'idle') return;
    const status = String(routeScout.status || '').toLowerCase();
    setTier(status === 'scouting' || status === 'needs_input' ? 'half' : 'full');
  }, [routeScout?.operationId, routeScout?.status]);

  if (!visible || !routeScout || routeScout.status === 'idle') return null;

  const plans = routeScout.dayPlans?.length ? routeScout.dayPlans : fallbackDayPlans(routeScout);
  const lockedCount = plans.filter(plan => String(plan.campStatus || plan.status).toLowerCase() === 'locked').length;
  const reviewCount = plans.filter(plan => ['review', 'missing'].includes(String(plan.campStatus || plan.status).toLowerCase())).length;
  const statusColor = routeScout.status === 'failed' ? C.red : routeScout.status === 'review' ? C.yellow : routeScout.status === 'scouting' ? C.orange : C.green;
  const progressWidth = `${Math.max(6, Math.min(100, routeScout.progressPct ?? 8))}%` as const;
  const tripTitle = routeScout.startName || routeScout.destinationName
    ? `${shortPlaceName(routeScout.startName, true) || 'Start'} to ${shortPlaceName(routeScout.destinationName, true) || 'Finish'}`
    : 'Trip overview';
  const statText = [
    routeScout.days ? `${routeScout.days} days` : null,
    routeScout.totalMiles ? `${Math.round(routeScout.totalMiles)} mi` : null,
    lockedCount ? `${lockedCount} camps` : null,
    reviewCount ? `${reviewCount} to review` : null,
  ].filter(Boolean).join(' · ');
  const overviewText = routeScout.status === 'failed'
    ? routeScout.message
    : routeScout.status === 'scouting'
      ? routeScout.phaseLabel || 'Finding overnight stops'
      : reviewCount
        ? `${lockedCount} overnight ${lockedCount === 1 ? 'stop' : 'stops'} set. Review ${reviewCount} before starting.`
        : `${lockedCount || plans.length} overnight ${lockedCount === 1 ? 'stop' : 'stops'} set for the route.`;
  const visiblePlans = tier === 'half' ? plans.slice(0, 4) : plans;
  const primaryActionTextColor = C.bg === '#F7F8F6' ? '#101820' : '#fff';
  const headerIcon = routeScout.status === 'failed' ? 'alert-circle-outline' : routeScout.status === 'scouting' ? 'time-outline' : 'map-outline';

  const renderDay = (plan: RouteScoutDayPlan) => {
    const tone = planTone(C, plan.campStatus || plan.status);
    const loading = String(plan.status || '').toLowerCase() === 'loading' || String(plan.campStatus || '').toLowerCase() === 'loading';
    const stop = stopFromDayPlan(plan);
    const fuelCount = plan.fuelStops?.length ?? 0;
    const poiCount = plan.poiStops?.length ?? 0;
    const photoUri = campPhotoUri(plan);
    const notes = reviewNotes(plan);
    const cleanDrive = cleanDriveSummary(plan.driveSummary);
    const statusLabel = dayStatusLabel(plan.campStatus || plan.status);
    const metaParts = [cleanDrive, statusLabel].filter(Boolean).join(' · ');
    const startName = shortPlaceName(plan.startName, true) || 'Start';
    const endName = shortPlaceName(plan.endName || plan.campName || plan.title, true) || 'Finish';
    const campStatus = String(plan.campStatus || plan.status || '').toLowerCase();
    const dayAction = dayActionState?.day === plan.day ? dayActionState : null;
    return (
      <TouchableOpacity
        key={`route-scout-day-${plan.day}`}
        style={s.dayRow}
        activeOpacity={stop ? 0.84 : 1}
        onPress={() => { if (stop) onStopPress(stop); }}
      >
        <View style={s.rail}>
          <View style={[s.dot, { borderColor: tone }, (plan.campStatus === 'locked' || plan.status === 'finish') && { backgroundColor: tone }]} />
          <View style={s.stem} />
        </View>
        <View style={s.dayBody}>
          <View style={s.dayHead}>
            <View style={s.flex}>
              <Text style={s.dayTitle}>Day {plan.day}</Text>
              <Text style={s.dayMeta} numberOfLines={1}>{metaParts || plan.title || 'Route leg'}</Text>
            </View>
            <View style={[s.statusPill, { borderColor: tone + '66', backgroundColor: tone + '12' }]}>
              <Ionicons name={planIcon(plan.campStatus || plan.status)} size={12} color={tone} />
              <Text style={[s.statusText, { color: tone }]} numberOfLines={1}>
                {statusLabel}
              </Text>
            </View>
          </View>

          <Text style={s.routeLine} numberOfLines={2}>{startName} to {endName}</Text>

          {loading ? (
            <View style={s.loadingBlock}>
              <TrailheadSkeletonLine width="94%" height={12} style={s.skeletonLine} />
              <TrailheadSkeletonLine width="72%" height={12} style={s.skeletonLine} />
            </View>
          ) : null}

          <View style={s.stopRows}>
            <View style={s.campBlock}>
              {photoUri ? (
                <Image source={{ uri: photoUri }} style={s.campPhoto} resizeMode="cover" />
              ) : (
                <View style={[s.campFallback, { borderColor: tone + '55', backgroundColor: tone + '12' }]}>
                  <Ionicons name={campStatus === 'loading' ? 'time-outline' : 'bonfire-outline'} size={26} color={tone} />
                </View>
              )}
              <View style={s.campCopy}>
                <Text style={s.campLabel}>{campStatus === 'review' || campStatus === 'missing' ? 'CAMP TO REVIEW' : 'OVERNIGHT CAMP'}</Text>
                <Text style={s.stopName} numberOfLines={2}>{loading ? 'Finding overnight' : plan.campName || 'Choose overnight'}</Text>
                <Text style={s.stopMeta} numberOfLines={2}>{campMetaText(plan)}</Text>
              </View>
            </View>

            {fuelCount || poiCount ? (
              <View style={s.slotGrid}>
                {fuelCount ? (
                  <View style={s.slot}>
                    <Ionicons name="flash-outline" size={12} color={C.yellow} />
                    <Text style={s.slotText} numberOfLines={1}>{fuelCount} fuel</Text>
                  </View>
                ) : null}
                {poiCount ? (
                  <View style={s.slot}>
                    <Ionicons name="trail-sign-outline" size={12} color="#38bdf8" />
                    <Text style={s.slotText} numberOfLines={1}>{poiCount} places</Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {tier === 'full' && notes.length > 0 ? (
              <View style={s.notes}>
                {notes.map((note, idx) => (
                  <Text key={`${plan.day}-note-${idx}`} style={s.note} numberOfLines={2}>{note}</Text>
                ))}
              </View>
            ) : null}

            <View style={s.dayActionRail}>
              {(['camp', 'fuel', 'places', 'tours'] as const).map(kind => {
                const copy = actionCopy(kind);
                const active = dayAction?.kind === kind;
                return (
                  <TouchableOpacity
                    key={`day-${plan.day}-${kind}`}
                    style={[s.dayActionButton, active && s.dayActionButtonActive]}
                    onPress={() => onDayAction(plan, kind)}
                    activeOpacity={0.84}
                  >
                    <Ionicons name={copy.icon} size={13} color={active ? C.orange : C.text2} />
                    <Text style={[s.dayActionText, active && s.dayActionTextActive]}>{copy.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {dayAction ? (
              <View style={s.inlineResults}>
                <View style={s.inlineHead}>
                  <Text style={s.inlineTitle}>{dayAction.title}</Text>
                  {dayAction.loading ? <Text style={s.inlineLoading}>Searching</Text> : null}
                </View>
                {dayAction.subtitle ? <Text style={s.inlineSubtitle} numberOfLines={2}>{dayAction.subtitle}</Text> : null}
                {dayAction.loading ? (
                  <View style={s.inlineSkeletons}>
                    <TrailheadSkeletonLine width="96%" height={54} style={s.inlineSkeleton} />
                    <TrailheadSkeletonLine width="88%" height={54} style={s.inlineSkeleton} />
                  </View>
                ) : dayAction.items.length ? (
                  <View style={s.inlineList}>
                    {dayAction.items.slice(0, 4).map(item => (
                      <TouchableOpacity key={item.id} style={s.inlineItem} onPress={() => onDayActionItemPress(item)} activeOpacity={0.84}>
                        {item.photoUrl ? (
                          <Image source={{ uri: item.photoUrl }} style={s.inlinePhoto} resizeMode="cover" />
                        ) : (
                          <View style={[s.inlineIcon, { borderColor: (item.color || C.orange) + '55', backgroundColor: (item.color || C.orange) + '12' }]}>
                            <Ionicons name={item.icon || 'location-outline'} size={16} color={item.color || C.orange} />
                          </View>
                        )}
                        <View style={s.flex}>
                          <Text style={s.inlineItemTitle} numberOfLines={1}>{item.title}</Text>
                          <Text style={s.inlineItemMeta} numberOfLines={2}>{item.meta || 'Tap to inspect'}</Text>
                        </View>
                        <Ionicons name={item.url ? 'open-outline' : 'chevron-forward'} size={14} color={C.text3} />
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : (
                  <Text style={s.inlineEmpty}>{dayAction.message || 'Try a wider search from this leg.'}</Text>
                )}
              </View>
            ) : null}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[s.panel, tier === 'peek' ? s.peekPanel : tier === 'full' ? s.fullPanel : s.halfPanel]} pointerEvents="auto">
      <TouchableOpacity style={s.handleArea} onPress={() => setTier(nextTier(tier))} activeOpacity={0.82}>
        <View style={s.handle} />
      </TouchableOpacity>

      <View style={s.top}>
        <View style={s.titleWrap}>
          <View style={[s.titleIcon, { borderColor: statusColor + '66', backgroundColor: statusColor + '12' }]}>
            <Ionicons name={headerIcon} size={15} color={statusColor} />
          </View>
          <View style={s.flex}>
            <Text style={s.title}>TRIP OVERVIEW</Text>
            <Text style={s.headline} numberOfLines={1}>{tripTitle}</Text>
            <Text style={s.sub} numberOfLines={1}>{statText || shortPlaceName(routeScout.message)}</Text>
          </View>
        </View>
        <View style={s.topActions}>
          <TouchableOpacity style={s.iconBtn} onPress={() => setTier(tier === 'full' ? 'half' : 'full')} accessibilityLabel="Expand trip overview">
            <Ionicons name={tier === 'full' ? 'chevron-down-outline' : 'chevron-up-outline'} size={15} color={C.text2} />
          </TouchableOpacity>
          <TouchableOpacity style={s.iconBtn} onPress={onClose} accessibilityLabel="Close trip overview">
            <Ionicons name="close" size={15} color={C.text3} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={s.progressWrap}>
        <View style={s.progressTrack}>
          <View style={[s.progressFill, { width: progressWidth, backgroundColor: statusColor }]} />
        </View>
        <View style={s.statRow}>
          <Text style={s.stat}>{routeScout.days ? `${routeScout.days} days` : 'Set days'}</Text>
          <Text style={s.stat}>{routeScout.driveHours ? `${routeScout.driveHours}h/day` : 'Set drive'}</Text>
          <Text style={s.stat}>{routeScout.totalMiles ? `${Math.round(routeScout.totalMiles)} mi` : 'Routing'}</Text>
          <Text style={s.stat}>{lockedCount} set</Text>
          {reviewCount ? <Text style={[s.stat, s.reviewStat]}>{reviewCount} review</Text> : null}
        </View>
      </View>

      {tier !== 'peek' ? (
        <>
          <Text style={s.message} numberOfLines={tier === 'full' ? 5 : 2}>
            {overviewText}
          </Text>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.timeline}>
            {visiblePlans.map(renderDay)}
            {routeScout.status === 'scouting' && visiblePlans.length === 0 ? (
              <View style={s.emptyLoading}>
                <TrailheadSkeletonLine width="92%" height={58} style={s.skeletonCard} />
                <TrailheadSkeletonLine width="86%" height={58} style={s.skeletonCard} />
              </View>
            ) : null}
          </ScrollView>
        </>
      ) : null}

      <View style={s.actions}>
        <TouchableOpacity style={s.action} onPress={onRescout}>
          <Ionicons name="refresh-outline" size={13} color={C.text2} />
          <Text style={s.actionText}>Refresh</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.action, s.actionPrimary]} onPress={onOpenBuilder}>
          <Ionicons name="create-outline" size={13} color={primaryActionTextColor} />
          <Text style={[s.actionText, s.actionPrimaryText]}>Full editor</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = (C: ColorPalette) => {
  const light = C.bg === '#F7F8F6';
  const panelBg = light ? 'rgba(255,255,255,0.97)' : 'rgba(7, 11, 14, 0.94)';
  const softBg = light ? 'rgba(15,23,42,0.045)' : 'rgba(255,255,255,0.055)';
  const progressTrackBg = light ? 'rgba(15,23,42,0.08)' : 'rgba(255,255,255,0.08)';
  const primaryText = light ? '#101820' : '#fff';
  return StyleSheet.create({
    panel: {
      position: 'absolute',
      left: 10,
      right: 10,
      bottom: 104,
      backgroundColor: panelBg,
      borderWidth: 1,
      borderColor: light ? 'rgba(15,23,42,0.12)' : 'rgba(255,255,255,0.14)',
      borderRadius: 18,
      paddingHorizontal: 12,
      paddingTop: 6,
      paddingBottom: 12,
      zIndex: 9050,
      elevation: 95,
      shadowColor: '#000',
      shadowOpacity: light ? 0.17 : 0.32,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 9 },
    },
    peekPanel: {
      maxHeight: 176,
    },
    halfPanel: {
      maxHeight: 430,
    },
    fullPanel: {
      top: 94,
    },
    handleArea: {
      alignItems: 'center',
      paddingVertical: 5,
    },
    handle: {
      width: 42,
      height: 4,
      borderRadius: 999,
      backgroundColor: light ? 'rgba(15,23,42,0.18)' : 'rgba(255,255,255,0.22)',
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
      alignItems: 'center',
      gap: 9,
      minWidth: 0,
    },
    titleIcon: {
      width: 32,
      height: 32,
      borderRadius: 16,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: {
      color: C.orange,
      fontSize: 10,
      fontFamily: mono,
      fontWeight: '900',
      letterSpacing: 0,
    },
    headline: {
      color: C.text,
      fontSize: 17,
      fontWeight: '900',
      marginTop: 1,
    },
    sub: {
      color: C.text3,
      fontSize: 10,
      fontFamily: mono,
      marginTop: 2,
    },
    topActions: {
      flexDirection: 'row',
      gap: 6,
    },
    iconBtn: {
      width: 31,
      height: 31,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: C.border2,
      backgroundColor: softBg,
    },
    progressWrap: {
      marginTop: 10,
      gap: 7,
    },
    progressTrack: {
      height: 5,
      borderRadius: 999,
      overflow: 'hidden',
      backgroundColor: progressTrackBg,
      borderWidth: 1,
      borderColor: C.border2,
    },
    progressFill: {
      height: '100%',
      borderRadius: 999,
    },
    statRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
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
    reviewStat: {
      color: C.yellow,
      borderColor: C.yellow + '55',
      backgroundColor: C.yellow + '10',
    },
    message: {
      color: C.text2,
      fontSize: 12,
      lineHeight: 17,
      marginTop: 10,
      fontWeight: '700',
    },
    timeline: {
      paddingTop: 12,
      paddingBottom: 4,
      gap: 12,
    },
    dayRow: {
      flexDirection: 'row',
      gap: 10,
      paddingBottom: 2,
    },
    rail: {
      width: 18,
      alignItems: 'center',
      paddingTop: 3,
    },
    dot: {
      width: 14,
      height: 14,
      borderRadius: 7,
      borderWidth: 2,
      backgroundColor: panelBg,
    },
    stem: {
      flex: 1,
      minHeight: 72,
      width: 2,
      marginTop: 4,
      backgroundColor: light ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.12)',
      borderRadius: 999,
    },
    dayBody: {
      flex: 1,
      minWidth: 0,
      borderWidth: 1,
      borderColor: C.border2,
      borderRadius: 8,
      padding: 10,
      backgroundColor: softBg,
    },
    dayHead: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
    },
    dayTitle: {
      color: C.text,
      fontSize: 14,
      fontWeight: '900',
    },
    dayMeta: {
      color: C.text3,
      fontSize: 10,
      fontFamily: mono,
      marginTop: 2,
    },
    statusPill: {
      maxWidth: 110,
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 7,
      paddingVertical: 4,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    statusText: {
      fontSize: 9,
      fontFamily: mono,
      fontWeight: '900',
      textTransform: 'uppercase',
    },
    routeLine: {
      color: C.text2,
      fontSize: 12,
      lineHeight: 17,
      marginTop: 7,
      fontWeight: '800',
    },
    loadingBlock: {
      gap: 7,
      marginTop: 9,
    },
    skeletonLine: {
      borderRadius: 8,
    },
    stopRows: {
      gap: 9,
      marginTop: 10,
    },
    campBlock: {
      gap: 9,
    },
    campPhoto: {
      width: '100%',
      height: 158,
      borderRadius: 8,
      backgroundColor: softBg,
    },
    campFallback: {
      width: '100%',
      height: 132,
      borderRadius: 8,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    campCopy: {
      flex: 1,
      minWidth: 0,
    },
    campLabel: {
      color: C.text3,
      fontSize: 9,
      fontFamily: mono,
      fontWeight: '900',
      marginBottom: 3,
    },
    stopName: {
      color: C.text,
      fontSize: 12,
      fontWeight: '900',
    },
    stopMeta: {
      color: C.text3,
      fontSize: 10,
      lineHeight: 14,
      marginTop: 1,
    },
    slotGrid: {
      flexDirection: 'row',
      gap: 8,
    },
    slot: {
      flex: 1,
      minHeight: 30,
      borderWidth: 1,
      borderColor: C.border2,
      borderRadius: 8,
      backgroundColor: light ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.04)',
      paddingHorizontal: 8,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    slotText: {
      flex: 1,
      minWidth: 0,
      color: C.text3,
      fontSize: 10,
      fontFamily: mono,
      fontWeight: '800',
    },
    notes: {
      gap: 5,
      borderTopWidth: 1,
      borderTopColor: C.border2,
      paddingTop: 8,
    },
    note: {
      color: C.text2,
      fontSize: 11,
      lineHeight: 15,
    },
    dayActionRail: {
      flexDirection: 'row',
      gap: 7,
    },
    dayActionButton: {
      flex: 1,
      minHeight: 40,
      borderWidth: 1,
      borderColor: C.border2,
      borderRadius: 8,
      backgroundColor: light ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.04)',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
    },
    dayActionButtonActive: {
      borderColor: C.orange + '77',
      backgroundColor: C.orange + '12',
    },
    dayActionText: {
      color: C.text2,
      fontSize: 8,
      fontFamily: mono,
      fontWeight: '900',
    },
    dayActionTextActive: {
      color: C.orange,
    },
    inlineResults: {
      gap: 8,
      borderWidth: 1,
      borderColor: C.border2,
      borderRadius: 8,
      padding: 9,
      backgroundColor: light ? 'rgba(255,255,255,0.64)' : 'rgba(255,255,255,0.045)',
    },
    inlineHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    inlineTitle: {
      flex: 1,
      color: C.text,
      fontSize: 12,
      fontWeight: '900',
    },
    inlineLoading: {
      color: C.orange,
      fontSize: 9,
      fontFamily: mono,
      fontWeight: '900',
    },
    inlineSubtitle: {
      color: C.text3,
      fontSize: 10,
      lineHeight: 14,
    },
    inlineSkeletons: {
      gap: 8,
    },
    inlineSkeleton: {
      borderRadius: 8,
    },
    inlineList: {
      gap: 7,
    },
    inlineItem: {
      minHeight: 58,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      borderWidth: 1,
      borderColor: C.border2,
      borderRadius: 8,
      padding: 7,
      backgroundColor: softBg,
    },
    inlinePhoto: {
      width: 44,
      height: 44,
      borderRadius: 8,
      backgroundColor: softBg,
    },
    inlineIcon: {
      width: 44,
      height: 44,
      borderRadius: 8,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    inlineItemTitle: {
      color: C.text,
      fontSize: 11,
      fontWeight: '900',
    },
    inlineItemMeta: {
      color: C.text3,
      fontSize: 9,
      lineHeight: 13,
      marginTop: 2,
    },
    inlineEmpty: {
      color: C.text3,
      fontSize: 10,
      lineHeight: 14,
    },
    emptyLoading: {
      gap: 10,
    },
    skeletonCard: {
      borderRadius: 8,
    },
    actions: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 10,
    },
    action: {
      minHeight: 34,
      paddingHorizontal: 11,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: C.border2,
      backgroundColor: softBg,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    actionPrimary: {
      flex: 1,
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
    flex: {
      flex: 1,
      minWidth: 0,
    },
  });
};
