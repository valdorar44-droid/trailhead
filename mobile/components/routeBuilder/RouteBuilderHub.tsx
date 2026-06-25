import type { ReactNode } from 'react';
import { Image, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { TrailheadButton, TrailheadCard, TrailheadSheet, TrailheadTopBar } from '@/components/TrailheadUI';
import { mono, useTheme, type ColorPalette } from '@/lib/design';
import type { OfflineTrail } from '@/lib/offlineTrails';
import type { TripHistoryItem } from '@/lib/store';

type RouteTripCardData = {
  coverUrl: string;
  stats: string;
};

type RigRouteSummary = {
  ready: boolean;
  title: string;
  meta: string;
};

type RouteBuilderHubProps = {
  bottomInset: number;
  heroPhoto: string;
  routeSaving: boolean;
  rigRouteSummary: RigRouteSummary;
  savedRoutes: TripHistoryItem[];
  savedTrails: OfflineTrail[];
  showOpenActive: boolean;
  showNewRouteConfirm: boolean;
  paywallModal?: ReactNode;
  routeTripCardData: (route: TripHistoryItem) => RouteTripCardData;
  savedTrailDistance: (trail: OfflineTrail) => string;
  onStartNewRoute: () => void;
  onOpenProfile: () => void;
  onOpenActiveMap: () => void;
  onOpenSavedRoute: (tripId: string) => void;
  onOpenSavedTrailRoute: (trail: OfflineTrail) => void;
  onDeleteSavedTrailRoute: (trail: OfflineTrail) => void;
  onCloseNewRouteConfirm: () => void;
  onSaveCloseAndStartNewRoute: () => void;
  onDiscardCloseAndStartNewRoute: () => void;
};

export default function RouteBuilderHub({
  bottomInset,
  heroPhoto,
  routeSaving,
  rigRouteSummary,
  savedRoutes,
  savedTrails,
  showOpenActive,
  showNewRouteConfirm,
  paywallModal,
  routeTripCardData,
  savedTrailDistance,
  onStartNewRoute,
  onOpenProfile,
  onOpenActiveMap,
  onOpenSavedRoute,
  onOpenSavedTrailRoute,
  onDeleteSavedTrailRoute,
  onCloseNewRouteConfirm,
  onSaveCloseAndStartNewRoute,
  onDiscardCloseAndStartNewRoute,
}: RouteBuilderHubProps) {
  const C = useTheme();
  const s = styles(C);

  return (
    <SafeAreaView style={s.screen}>
      <TrailheadTopBar
        title="ROUTE BUILDER"
        subtitle="Recent Adventures"
        icon="trail-sign-outline"
        style={s.topBar}
      />
      <ScrollView
        style={s.body}
        contentContainerStyle={[s.content, { paddingBottom: 120 + bottomInset }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <TrailheadCard style={s.hero}>
          <Image source={{ uri: heroPhoto }} style={s.heroImage} resizeMode="cover" />
          <LinearGradient colors={['rgba(3,7,18,0.04)', 'rgba(3,7,18,0.76)']} style={s.fill} />
          <View style={s.heroContent}>
            <Text style={s.heroTitle}>Plan a Route</Text>
            <TrailheadButton label="Build New Route" icon="add" variant="primary" onPress={onStartNewRoute} disabled={routeSaving} />
          </View>
        </TrailheadCard>

        <TrailheadCard style={[s.rigCard, rigRouteSummary.ready && s.rigCardReady]}>
          <View style={s.rigIcon}>
            <Ionicons name={rigRouteSummary.ready ? 'car-sport-outline' : 'alert-circle-outline'} size={17} color={rigRouteSummary.ready ? C.green : C.yellow} />
          </View>
          <View style={s.flex}>
            <Text style={s.rigTitle}>{rigRouteSummary.title}</Text>
            <Text style={s.rigMeta}>{rigRouteSummary.meta}</Text>
          </View>
          <TouchableOpacity style={s.smallButton} onPress={onOpenProfile} activeOpacity={0.82}>
            <Text style={s.smallButtonText}>{rigRouteSummary.ready ? 'EDIT' : 'ADD'}</Text>
          </TouchableOpacity>
        </TrailheadCard>

        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>Recent Adventures</Text>
          {showOpenActive ? (
            <TouchableOpacity style={s.tinyAction} onPress={onOpenActiveMap} activeOpacity={0.82}>
              <Ionicons name="map-outline" size={12} color={C.orange} />
              <Text style={s.tinyActionText}>OPEN ACTIVE</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {savedRoutes.length ? (
          savedRoutes.map(route => {
            const card = routeTripCardData(route);
            return (
              <TrailheadCard key={route.trip_id} style={s.savedRouteCard} onPress={() => onOpenSavedRoute(route.trip_id)}>
                <Image source={{ uri: card.coverUrl }} style={s.savedRouteImage} resizeMode="cover" />
                <LinearGradient colors={['rgba(2,6,23,0.05)', 'rgba(2,6,23,0.78)']} style={s.fill} />
                <View style={s.savedRouteOverlay}>
                  <Text style={s.savedTripName} numberOfLines={2}>{route.trip_name}</Text>
                  {card.stats ? <Text style={s.savedTripMeta} numberOfLines={2}>{card.stats}</Text> : null}
                  <View style={s.savedRouteContinue}>
                    <Text style={s.savedRouteOpenText}>Continue</Text>
                    <Ionicons name="chevron-forward" size={13} color="#fff" />
                  </View>
                </View>
              </TrailheadCard>
            );
          })
        ) : (
          <TrailheadCard style={s.emptyCard}>
            <Ionicons name="map-outline" size={20} color={C.text3} />
            <Text style={s.emptyTitle}>No adventures yet</Text>
          </TrailheadCard>
        )}

        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>Trails</Text>
          <Text style={s.sectionMeta}>{savedTrails.length ? `${savedTrails.length} saved` : 'Saved'}</Text>
        </View>

        {savedTrails.length ? (
          savedTrails.map(item => (
            <TrailheadCard key={item.id} style={s.savedTrailCard} onPress={() => onOpenSavedTrailRoute(item)}>
              <View style={s.savedTrailPreview}>
                <Ionicons name="git-branch-outline" size={19} color={C.green} />
              </View>
              <View style={s.savedTrailMain}>
                <Text style={s.savedRouteName} numberOfLines={2}>{item.trail.name}</Text>
                <Text style={s.savedRouteMeta} numberOfLines={1}>{savedTrailDistance(item)}</Text>
                <View style={s.savedTrailPills}>
                  <Text style={s.savedTrailPill}>TRAIL</Text>
                  <Text style={s.savedTrailPill}>SAVED</Text>
                </View>
              </View>
              <View style={s.savedTrailActions}>
                <TouchableOpacity
                  style={s.savedTrailDelete}
                  onPress={(event: any) => {
                    event.stopPropagation?.();
                    onDeleteSavedTrailRoute(item);
                  }}
                  activeOpacity={0.82}
                >
                  <Ionicons name="trash-outline" size={15} color={C.red} />
                </TouchableOpacity>
                <Ionicons name="chevron-forward" size={17} color={C.text3} />
              </View>
            </TrailheadCard>
          ))
        ) : (
          <TrailheadCard style={s.emptyCompact}>
            <Ionicons name="git-branch-outline" size={18} color={C.text3} />
            <Text style={s.emptyText}>Saved pinned trail routes will appear here after you tap SAVE in the trail planner.</Text>
          </TrailheadCard>
        )}
      </ScrollView>

      <Modal visible={showNewRouteConfirm} transparent animationType="fade" onRequestClose={onCloseNewRouteConfirm}>
        <View style={s.confirmOverlay}>
          <TrailheadSheet handle={false} style={s.confirmCard} contentStyle={s.confirmContent}>
            <View style={s.confirmIcon}>
              <Ionicons name="trail-sign-outline" size={22} color={C.orange} />
            </View>
            <Text style={s.confirmTitle}>Start a new route?</Text>
            <Text style={s.confirmText}>
              You already have an active route open. Save and close it before starting fresh, or discard it and clear the workspace.
            </Text>
            <TrailheadButton label="Save & Close" icon="save-outline" variant="primary" onPress={onSaveCloseAndStartNewRoute} loading={routeSaving} disabled={routeSaving} style={s.stretch} />
            <TrailheadButton label="Discard & Close" icon="trash-outline" variant="danger" onPress={onDiscardCloseAndStartNewRoute} disabled={routeSaving} style={s.stretch} />
            <TrailheadButton label="Cancel" variant="ghost" onPress={onCloseNewRouteConfirm} disabled={routeSaving} style={s.stretch} />
          </TrailheadSheet>
        </View>
      </Modal>
      {paywallModal}
    </SafeAreaView>
  );
}

const styles = (C: ColorPalette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 14, paddingTop: 8 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 6,
    paddingBottom: 14,
  },
  body: { flex: 1 },
  content: { paddingBottom: 120, gap: 14 },
  flex: { flex: 1 },
  fill: { ...StyleSheet.absoluteFillObject },
  hero: {
    minHeight: 220,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 26,
    backgroundColor: C.glassStrong,
    padding: 0,
    shadowColor: '#000',
    shadowOpacity: 0.34,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 14 },
  },
  heroImage: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  heroContent: {
    minHeight: 220,
    justifyContent: 'flex-end',
    padding: 18,
    gap: 12,
  },
  heroTitle: { color: '#fff', fontSize: 34, lineHeight: 38, fontWeight: '900' },
  rigCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 18,
    backgroundColor: C.s2,
    padding: 11,
  },
  rigCardReady: { borderColor: C.green + '44', backgroundColor: C.green + '10' },
  rigIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rigTitle: { color: C.text, fontSize: 12, fontWeight: '900' },
  rigMeta: { color: C.text3, fontSize: 10, lineHeight: 14, marginTop: 2 },
  smallButton: {
    minHeight: 32,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.orange + '55',
    backgroundColor: C.orange + '10',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  smallButtonText: { color: C.orange, fontSize: 8, fontFamily: mono, fontWeight: '900' },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 4,
  },
  sectionTitle: { color: C.text, fontSize: 15, fontWeight: '900' },
  sectionMeta: { color: C.text3, fontSize: 10, fontFamily: mono, fontWeight: '800' },
  tinyAction: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: C.orange + '44',
    borderRadius: 999,
    backgroundColor: C.orange + '10',
    paddingHorizontal: 10,
  },
  tinyActionText: { color: C.orange, fontSize: 8, fontFamily: mono, fontWeight: '900' },
  savedRouteCard: {
    minHeight: 214,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 22,
    backgroundColor: C.s1,
    padding: 0,
    shadowColor: '#000',
    shadowOpacity: 0.24,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
  },
  savedRouteImage: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  savedRouteOverlay: {
    minHeight: 214,
    justifyContent: 'flex-end',
    padding: 14,
    gap: 8,
  },
  savedTripName: { color: '#fff', fontSize: 22, lineHeight: 26, fontWeight: '900' },
  savedTripMeta: { color: 'rgba(255,255,255,0.86)', fontSize: 12, lineHeight: 17, fontFamily: mono, fontWeight: '800' },
  savedRouteContinue: {
    alignSelf: 'flex-start',
    minHeight: 32,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  savedRouteOpenText: { color: '#fff', fontSize: 9, fontFamily: mono, fontWeight: '900' },
  savedRouteName: { color: C.text, fontSize: 15, lineHeight: 20, fontWeight: '900' },
  savedRouteMeta: { color: C.text3, fontSize: 10, fontFamily: mono, marginTop: 3 },
  savedTrailCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderWidth: 1,
    borderColor: C.green + '33',
    borderRadius: 18,
    backgroundColor: C.green + '0d',
    padding: 11,
  },
  savedTrailPreview: {
    width: 52,
    height: 52,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: C.green + '55',
    backgroundColor: C.green + '16',
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedTrailMain: { flex: 1, minWidth: 0 },
  savedTrailActions: { alignItems: 'center', gap: 8 },
  savedTrailDelete: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.red + '44',
    backgroundColor: C.red + '12',
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedTrailPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  savedTrailPill: {
    color: C.green,
    fontSize: 8,
    fontFamily: mono,
    fontWeight: '900',
    borderWidth: 1,
    borderColor: C.green + '44',
    backgroundColor: C.green + '12',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  emptyCard: {
    minHeight: 150,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    backgroundColor: C.s1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  emptyCompact: {
    minHeight: 92,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    backgroundColor: C.s1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
  },
  emptyTitle: { color: C.text, fontSize: 15, fontWeight: '900', marginTop: 8 },
  emptyText: { color: C.text3, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 5 },
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.62)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  confirmCard: { width: '100%', borderRadius: 24 },
  confirmContent: { padding: 18, gap: 11 },
  confirmIcon: {
    width: 44,
    height: 44,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.orange + '44',
    backgroundColor: C.orange + '12',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmTitle: { color: C.text, fontSize: 22, lineHeight: 27, fontWeight: '900' },
  confirmText: { color: C.text2, fontSize: 13, lineHeight: 19, marginBottom: 2 },
  stretch: { alignSelf: 'stretch' },
});
