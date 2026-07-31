import { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { TrailheadButton, TrailheadCard } from '@/components/TrailheadUI';
import PrivateTrailRouteMap from '@/components/trails/PrivateTrailRouteMap';
import { accountInventoryRequestIsCurrent, accountInventoryScope } from '@/lib/accountInventoryScope';
import { api, ApiError } from '@/lib/api';
import { useTheme, type ColorPalette } from '@/lib/design';
import { saveOfflineTrailForAccountScope } from '@/lib/offlineTrails';
import {
  isSharedTrailRouteV1,
  offlineTrailFromSharedRoute,
  trailLineDistanceM,
  type SharedTrailRecipientStateV1,
  type SharedTrailRouteV1,
} from '@/lib/trailRouteSharing';
import {
  clearSharedTrailRecipientRoute,
  consumeSharedTrailToken,
  readSharedTrailRecipientRoute,
  rememberSharedTrailRecipientRoute,
  setSharedTrailRecipientFocused,
  settleSharedTrailTokenResolution,
  subscribeSharedTrailToken,
} from '@/lib/sharedTrailLinkHandoff';
import { useStore } from '@/lib/store';
import { accountStorage } from '@/lib/storage';
import { trailheadFonts } from '@/lib/typography';

function distanceLabel(route: SharedTrailRouteV1): string {
  const metres = trailLineDistanceM(route.geometry.coordinates);
  if (!Number.isFinite(metres) || metres <= 0) return '';
  const miles = metres / 1609.344;
  return miles >= 10 ? `${miles.toFixed(0)} mi` : `${miles.toFixed(1)} mi`;
}

export default function SharedTrailRouteScreen() {
  const C = useTheme();
  const s = styles(C);
  const router = useRouter();
  const user = useStore(state => state.user);
  const setPendingSharedTrailRoute = useStore(state => state.setPendingSharedTrailRoute);
  const [recipient, setRecipient] = useState<SharedTrailRecipientStateV1>(() => {
    const remembered = readSharedTrailRecipientRoute();
    return remembered ? { status: 'ready', route: remembered } : { status: 'loading' };
  });
  const [saved, setSaved] = useState(false);
  const retryTokenRef = useRef('');
  const resolutionGenerationRef = useRef(0);

  const resolveHandoff = useCallback(async (retry = false) => {
    const token = retry ? retryTokenRef.current : consumeSharedTrailToken();
    if (!token) {
      if (retryTokenRef.current) return;
      setRecipient(current => current.status === 'ready' ? current : { status: 'unavailable' });
      return;
    }
    retryTokenRef.current = token;
    const generation = ++resolutionGenerationRef.current;
    setRecipient({ status: 'loading' });
    try {
      const route = await api.resolveSharedTrailRoute(token);
      if (generation !== resolutionGenerationRef.current) return;
      if (!isSharedTrailRouteV1(route)) throw new Error('invalid_shared_route');
      retryTokenRef.current = '';
      rememberSharedTrailRecipientRoute(route);
      settleSharedTrailTokenResolution(true);
      setRecipient({ status: 'ready', route });
    } catch (error) {
      if (generation !== resolutionGenerationRef.current) return;
      settleSharedTrailTokenResolution(false);
      if (error instanceof ApiError && (error.status === 400 || error.status === 404)) {
        retryTokenRef.current = '';
        setRecipient({ status: 'unavailable' });
      } else if (error instanceof Error && error.message === 'invalid_shared_route') {
        retryTokenRef.current = '';
        setRecipient({ status: 'unavailable' });
      } else {
        setRecipient({ status: 'offline' });
      }
    }
  }, []);

  useFocusEffect(useCallback(() => {
    setSharedTrailRecipientFocused(true);
    const unsubscribe = subscribeSharedTrailToken(() => void resolveHandoff());
    void resolveHandoff();
    return () => {
      resolutionGenerationRef.current += 1;
      unsubscribe();
      setSharedTrailRecipientFocused(false);
    };
  }, [resolveHandoff]));

  const route = recipient.status === 'ready' ? recipient.route : null;

  const close = () => {
    clearSharedTrailRecipientRoute();
    router.replace('/(tabs)/guide?view=trails' as any);
  };
  const back = () => {
    clearSharedTrailRecipientRoute();
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/guide?view=trails' as any);
  };

  const openOnMap = () => {
    if (!route) return;
    rememberSharedTrailRecipientRoute(route);
    setPendingSharedTrailRoute(route);
    router.push('/(tabs)/map');
  };

  const saveCopy = async () => {
    if (!route || !user) return;
    const requestedScope = accountInventoryScope(accountStorage.epoch(), user.id);
    const isCurrent = () => accountInventoryRequestIsCurrent(
      requestedScope,
      accountStorage.epoch(),
      useStore.getState().user?.id,
      accountStorage.isCleaning(),
    );
    const didSave = await saveOfflineTrailForAccountScope(
      offlineTrailFromSharedRoute(route),
      requestedScope.epoch,
      isCurrent,
    );
    if (didSave && isCurrent()) setSaved(true);
  };

  const openSupport = () => router.push({ pathname: '/(tabs)/profile', params: { support: '1' } } as any);

  const topBar = (
    <View style={s.topBar}>
      <TouchableOpacity testID="shared-trail.back" style={s.iconButton} onPress={back} accessibilityRole="button" accessibilityLabel="Back">
        <Ionicons name="chevron-back" size={22} color={C.text} />
      </TouchableOpacity>
      <Text style={s.wordmark}>Trailhead</Text>
      <TouchableOpacity testID="shared-trail.close" style={s.iconButton} onPress={close} accessibilityRole="button" accessibilityLabel="Close">
        <Ionicons name="close" size={22} color={C.text} />
      </TouchableOpacity>
    </View>
  );

  if (recipient.status !== 'ready') {
    const offline = recipient.status === 'offline';
    const loading = recipient.status === 'loading';
    return (
      <SafeAreaView style={s.screen}>
        {topBar}
        <View style={s.centerState}>
          <View style={s.stateIcon}>
            <Ionicons name={loading ? 'hourglass-outline' : offline ? 'cloud-offline-outline' : 'link-outline'} size={28} color={C.orange} />
          </View>
          <Text style={s.stateTitle}>{loading ? 'Opening shared route' : 'Shared route unavailable'}</Text>
          {!loading ? (
            <Text style={s.stateText}>
              {offline ? 'Connect to open this route. Routes already saved on this device still work offline.' : 'This link is not available. Ask the owner for a new link.'}
            </Text>
          ) : null}
          {offline ? <TrailheadButton testID="shared-trail.retry" label="Retry" icon="refresh-outline" variant="primary" onPress={() => void resolveHandoff(true)} style={s.stateButton} /> : null}
          {!loading ? <TrailheadButton label="Explore trails" variant="ghost" onPress={close} style={s.stateButton} /> : null}
        </View>
      </SafeAreaView>
    );
  }

  const length = distanceLabel(recipient.route);
  return (
    <SafeAreaView style={s.screen}>
      {topBar}
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <Text style={s.eyebrow}>SHARED ROUTE</Text>
        <Text style={s.title}>{recipient.route.title}</Text>
        {recipient.route.description ? <Text style={s.description}>{recipient.route.description}</Text> : null}
        <TrailheadCard style={s.previewCard}>
          <PrivateTrailRouteMap coordinates={recipient.route.geometry.coordinates} />
          {length ? <Text style={s.distance}>{length}</Text> : null}
        </TrailheadCard>
        <View style={s.trustRows}>
          <View style={s.trustRow}><Ionicons name="eye-outline" size={18} color={C.orange} /><Text style={s.trustText}>View-only. Save a copy to edit.</Text></View>
          <View style={s.trustRow}><Ionicons name="eye-off-outline" size={18} color={C.orange} /><Text style={s.trustText}>Not listed in public trail discovery.</Text></View>
          <View style={s.trustRow}><Ionicons name="git-branch-outline" size={18} color={C.orange} /><Text style={s.trustText}>Owner edits do not change this shared revision.</Text></View>
        </View>
        <TrailheadButton testID="shared-trail.open-map" label="Open on map" icon="map-outline" variant="primary" onPress={openOnMap} style={s.fullButton} />
        {user ? (
          <TrailheadButton testID="shared-trail.save-copy" label={saved ? 'Saved to Trails' : 'Save a copy'} icon={saved ? 'checkmark-outline' : 'bookmark-outline'} onPress={() => void saveCopy()} disabled={saved} style={s.fullButton} />
        ) : (
          <>
            <Text style={s.signInText}>No account is needed to preview. Sign in to save a copy.</Text>
            <TrailheadButton testID="shared-trail.sign-in" label="Sign in to save" onPress={() => router.push({ pathname: '/(tabs)/profile', params: { auth: 'login' } } as any)} style={s.fullButton} />
          </>
        )}
        <TrailheadButton testID="shared-trail.report" label="Report route" icon="flag-outline" variant="ghost" onPress={openSupport} style={s.fullButton} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = (C: ColorPalette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  topBar: { minHeight: 66, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconButton: { width: 48, height: 48, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.s1, alignItems: 'center', justifyContent: 'center' },
  wordmark: { color: C.text, fontFamily: trailheadFonts.displayBold, fontSize: 22, lineHeight: 24 },
  content: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 42, gap: 16 },
  eyebrow: { color: C.orange, fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  title: { color: C.text, fontFamily: trailheadFonts.displayBold, fontSize: 36, lineHeight: 38 },
  description: { color: C.text2, fontSize: 15, lineHeight: 22 },
  previewCard: { padding: 0, overflow: 'hidden', alignItems: 'center' },
  distance: { alignSelf: 'stretch', padding: 14, color: C.text, fontSize: 14, fontWeight: '800', borderTopWidth: 1, borderTopColor: C.border },
  trustRows: { gap: 8 },
  trustRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12 },
  trustText: { flex: 1, color: C.text2, fontSize: 14, lineHeight: 20 },
  fullButton: { alignSelf: 'stretch', minHeight: 52 },
  signInText: { color: C.text2, fontSize: 14, lineHeight: 20, textAlign: 'center', paddingHorizontal: 18 },
  centerState: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28, gap: 14 },
  stateIcon: { width: 58, height: 58, borderRadius: 20, borderWidth: 1, borderColor: C.border, backgroundColor: C.s1, alignItems: 'center', justifyContent: 'center' },
  stateTitle: { color: C.text, fontFamily: trailheadFonts.displayBold, fontSize: 30, lineHeight: 33, textAlign: 'center' },
  stateText: { maxWidth: 340, color: C.text2, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  stateButton: { width: '100%', maxWidth: 340, minHeight: 52 },
});
