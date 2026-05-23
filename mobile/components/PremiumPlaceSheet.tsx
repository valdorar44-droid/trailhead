import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Linking,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, type PlaceDetail } from '@/lib/api';
import { useTheme, mono, type ColorPalette } from '@/lib/design';
import { TrailheadButton, TrailheadButtonDock, TrailheadSheet } from '@/components/TrailheadUI';
import TrailheadPhotoGallery, { type TrailheadGalleryPhoto } from '@/components/TrailheadPhotoGallery';

type Stage = 'full' | 'half' | 'peek';
const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.gettrailhead.app';

type PlaceLike = {
  name: string;
  lat: number;
  lng: number;
  id?: string;
  source?: string;
  source_label?: string;
  provider_place_id?: string;
  place_id?: string;
  type?: string;
  subtype?: string;
  address?: string;
  phone?: string;
  website?: string;
  open_now?: boolean | null;
  rating?: number;
  rating_count?: number;
  photo_url?: string | null;
  google_maps_uri?: string;
  attribution?: string;
  summary?: string;
  access_note?: string;
  distance_mi?: number;
  route_distance_mi?: number;
  confidence?: string;
};

type Props = {
  place: PlaceLike | null;
  visible?: boolean;
  initialStage?: Stage;
  onClose: () => void;
  onNavigate: (place: { name: string; lat: number; lng: number }) => void;
  onSave?: (place: { name: string; lat: number; lng: number; note?: string }) => void;
  onReport?: () => void;
  onNearbyCamps?: (place: { name: string; lat: number; lng: number }) => void;
  onAddToRoute?: (place: { name: string; lat: number; lng: number; note?: string }) => void;
};

function titleCase(value?: string) {
  return (value || 'Place').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function sourceId(place: PlaceLike) {
  const source = place.source || (String(place.id || '').startsWith('google:') ? 'google' : '');
  const id = place.provider_place_id || place.place_id || String(place.id || '').replace(/^google:/, '');
  return source && id ? { source, id } : null;
}

function openNowLabel(openNow?: boolean | null) {
  if (openNow === true) return 'Open now';
  if (openNow === false) return 'Closed now';
  return '';
}

function mediaUrl(url?: string | null) {
  if (!url) return '';
  return url.startsWith('/') ? `${API_BASE}${url}` : url;
}

export default function PremiumPlaceSheet({
  place,
  visible = !!place,
  initialStage = 'full',
  onClose,
  onNavigate,
  onSave,
  onReport,
  onNearbyCamps,
  onAddToRoute,
}: Props) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [stage, setStage] = useState<Stage>(initialStage);
  const [detail, setDetail] = useState<PlaceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null);
  const dragY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!place) {
      setDetail(null);
      return;
    }
    setStage(initialStage);
    setDetail(null);
    setGalleryIndex(null);
    const sid = sourceId(place);
    if (!sid) return;
    let cancelled = false;
    setLoading(true);
    api.getPlaceDetail(sid.source, sid.id)
      .then(next => {
        if (!cancelled) setDetail(next);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [place?.id, place?.provider_place_id, place?.place_id, place?.lat, place?.lng, initialStage]);

  const data = detail ?? place;
  const maxFull = Math.min(height * 0.84, height - Math.max(insets.top + 22, 54));
  const stageHeight = stage === 'full'
    ? maxFull
    : stage === 'half'
      ? Math.max(260, Math.min(height * 0.38, 360))
      : Math.max(78, insets.bottom + 70);

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
      setStage(prev => prev);
    },
  }), [dragY, stage]);

  if (!visible || !place || !data) return null;

  const photos: TrailheadGalleryPhoto[] = detail?.photos?.length
    ? detail.photos.map(photo => ({ ...photo, url: mediaUrl(photo.url) }))
    : data.photo_url
      ? [{ url: mediaUrl(data.photo_url), source: data.source_label || data.source || '' }]
      : [];
  const hero = photos[0]?.url;
  const sourceLabel = data.source_label || data.attribution || (data.source === 'google' ? 'Google' : data.source || 'Trailhead');
  const distanceLabel = data.route_distance_mi != null && Number.isFinite(data.route_distance_mi)
    ? `${Number(data.route_distance_mi).toFixed(1)} mi off route`
    : data.distance_mi != null && Number.isFinite(data.distance_mi)
      ? `${Number(data.distance_mi).toFixed(1)} mi away`
      : '';
  const subtitle = [
    titleCase(data.subtype || data.type),
    distanceLabel,
    data.rating ? `${Number(data.rating).toFixed(1)} (${data.rating_count || 0})` : '',
    openNowLabel(data.open_now),
  ].filter(Boolean).join(' · ');

  const cycleStage = () => {
    setStage(current => current === 'full' ? 'half' : current === 'half' ? 'peek' : 'half');
  };

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[s.wrap, { height: stageHeight, paddingBottom: Math.max(insets.bottom, 10), transform: [{ translateY: dragY }] }]}
    >
      <TrailheadSheet
        handle={false}
        style={[s.sheet, stage === 'peek' && s.sheetTip]}
        contentStyle={s.sheetContent}
      >
        <View style={s.grabberZone} {...pan.panHandlers}>
          <TouchableOpacity style={s.grabberTap} onPress={cycleStage} activeOpacity={0.78}>
            <View style={s.grabber} />
          </TouchableOpacity>
          <View style={s.tipRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.tipTitle} numberOfLines={1}>{data.name}</Text>
              <Text style={s.tipMeta} numberOfLines={1}>{subtitle || sourceLabel}</Text>
            </View>
            {loading ? <ActivityIndicator color={C.orange} size="small" /> : null}
            <TouchableOpacity style={s.iconBtn} onPress={onClose}>
              <Ionicons name="close" size={17} color={C.text2} />
            </TouchableOpacity>
          </View>
        </View>

        {stage !== 'peek' && (
          <ScrollView
            showsVerticalScrollIndicator={false}
            scrollEnabled={stage === 'full'}
            contentContainerStyle={s.content}
          >
            <TouchableOpacity style={s.hero} activeOpacity={hero ? 0.9 : 1} onPress={() => hero && setGalleryIndex(0)}>
              {hero ? (
                <Image source={{ uri: hero }} style={s.heroImage} resizeMode="cover" />
              ) : (
                <View style={s.heroFallback}>
                  <Ionicons name="business-outline" size={34} color={C.silverBright} />
                </View>
              )}
              <View style={s.heroShade} />
              <View style={s.heroText}>
                <Text style={s.kicker}>{sourceLabel.toUpperCase()}</Text>
                <Text style={s.title} numberOfLines={2}>{data.name}</Text>
              </View>
            </TouchableOpacity>

            <View style={s.body}>
              {!!subtitle && <Text style={s.meta}>{subtitle}</Text>}
              {!!data.address && (
                <View style={s.infoRow}>
                  <Ionicons name="location-outline" size={15} color={C.text3} />
                  <Text style={s.infoText} numberOfLines={2}>{data.address}</Text>
                </View>
              )}
              {!!data.summary && (
                <Text style={s.summaryText} numberOfLines={stage === 'full' ? 6 : 3}>{data.summary}</Text>
              )}
              {!!data.access_note && (
                <View style={s.infoRow}>
                  <Ionicons name="alert-circle-outline" size={15} color={C.orange} />
                  <Text style={s.infoText} numberOfLines={3}>{data.access_note}</Text>
                </View>
              )}
              {stage === 'full' && !!detail?.hours?.length && (
                <View style={s.section}>
                  <Text style={s.sectionLabel}>HOURS</Text>
                  {detail.hours.slice(0, 7).map(line => (
                    <Text key={line} style={s.sectionText}>{line}</Text>
                  ))}
                </View>
              )}

              <TrailheadButtonDock style={s.actions}>
                <TrailheadButton
                  label="Navigate"
                  icon="navigate"
                  variant="primary"
                  onPress={() => onNavigate(place)}
                  style={{ flex: 1 }}
                />
                {!!data.phone && (
                  <TouchableOpacity style={s.secondaryBtn} onPress={() => Linking.openURL(`tel:${data.phone}`)}>
                    <Ionicons name="call-outline" size={15} color={C.text2} />
                  </TouchableOpacity>
                )}
                {!!data.website && (
                  <TouchableOpacity style={s.secondaryBtn} onPress={() => Linking.openURL(String(data.website))}>
                    <Ionicons name="globe-outline" size={15} color={C.text2} />
                  </TouchableOpacity>
                )}
                {!!onSave && (
                  <TouchableOpacity style={s.secondaryBtn} onPress={() => onSave({ name: place.name, lat: place.lat, lng: place.lng, note: subtitle })}>
                    <Ionicons name="bookmark-outline" size={15} color={C.text2} />
                  </TouchableOpacity>
                )}
                {!!onAddToRoute && (
                  <TouchableOpacity style={s.secondaryBtn} onPress={() => onAddToRoute({ name: place.name, lat: place.lat, lng: place.lng, note: data.summary || subtitle })}>
                    <Ionicons name="add-circle-outline" size={15} color={C.text2} />
                  </TouchableOpacity>
                )}
              </TrailheadButtonDock>

              {stage === 'full' && (
                <View style={s.deepActions}>
                  {!!onNearbyCamps && (
                    <TouchableOpacity style={s.linkBtn} onPress={() => onNearbyCamps(place)}>
                      <Ionicons name="bonfire-outline" size={14} color={C.orange} />
                      <Text style={[s.linkText, { color: C.orange }]}>Nearby camps</Text>
                    </TouchableOpacity>
                  )}
                  {!!data.google_maps_uri && (
                    <TouchableOpacity style={s.linkBtn} onPress={() => Linking.openURL(String(data.google_maps_uri))}>
                      <Ionicons name="map-outline" size={14} color={C.text2} />
                      <Text style={s.linkText}>Open in Google Maps</Text>
                    </TouchableOpacity>
                  )}
                  {!!onReport && (
                    <TouchableOpacity style={s.linkBtn} onPress={onReport}>
                      <Ionicons name="warning-outline" size={14} color={C.orange} />
                      <Text style={[s.linkText, { color: C.orange }]}>Report / update</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {stage === 'full' && photos.length > 1 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.photoRail}>
                  {photos.slice(1, 7).map((photo, idx) => (
                    <TouchableOpacity key={`${photo.url}-${idx}`} activeOpacity={0.86} onPress={() => setGalleryIndex(idx + 1)}>
                      <Image source={{ uri: photo.url }} style={s.railPhoto} resizeMode="cover" />
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}

              {stage === 'full' && !!detail?.reviews?.length && (
                <View style={s.section}>
                  <Text style={s.sectionLabel}>GOOGLE REVIEWS</Text>
                  {detail.reviews.slice(0, 3).map((review, idx) => (
                    <View key={`${review.authorName}-${idx}`} style={s.reviewCard}>
                      <View style={s.reviewTop}>
                        <Text style={s.reviewAuthor} numberOfLines={1}>{review.authorName || 'Google user'}</Text>
                        <Text style={s.reviewRating}>{review.rating ? `${review.rating}/5` : 'Google'}</Text>
                      </View>
                      {!!review.relativeTime && <Text style={s.reviewMeta}>{review.relativeTime}</Text>}
                      {!!review.text && <Text style={s.reviewText} numberOfLines={4}>{review.text}</Text>}
                    </View>
                  ))}
                </View>
              )}

              <View style={s.sourceFooter}>
                <Text style={s.sourceText} numberOfLines={2}>
                  {data.source === 'google' || data.attribution === 'Google'
                    ? 'Google'
                    : sourceLabel}{photos[0]?.credit ? ` · Photo: ${photos[0].credit}` : ''}
                </Text>
              </View>
            </View>
          </ScrollView>
        )}
      </TrailheadSheet>
      <TrailheadPhotoGallery
        visible={galleryIndex !== null}
        photos={photos}
        initialIndex={galleryIndex ?? 0}
        title={data.name}
        onClose={() => setGalleryIndex(null)}
      />
    </Animated.View>
  );
}

const makeStyles = (C: ColorPalette) => StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 0,
    zIndex: 140,
  },
  sheet: {
    flex: 1,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
  },
  sheetContent: { padding: 0 },
  sheetTip: {
    borderRadius: 24,
  },
  grabberZone: { paddingTop: 7, paddingHorizontal: 14 },
  grabberTap: { alignItems: 'center', minHeight: 20, justifyContent: 'center' },
  grabber: { width: 46, height: 5, borderRadius: 5, backgroundColor: C.border2 },
  tipRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 10 },
  tipTitle: { color: C.text, fontSize: 15, fontWeight: '900' },
  tipMeta: { color: C.text3, fontSize: 10, fontFamily: mono, marginTop: 2 },
  iconBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: C.glassStrong, borderWidth: 1, borderColor: C.border },
  content: { paddingBottom: 22 },
  hero: { height: 164, marginHorizontal: 12, borderRadius: 22, overflow: 'hidden', backgroundColor: C.s2 },
  heroImage: { width: '100%', height: '100%' },
  heroFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.glassStrong },
  heroShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.22)' },
  heroText: { position: 'absolute', left: 16, right: 16, bottom: 14 },
  kicker: { color: '#fff', fontSize: 9, fontFamily: mono, fontWeight: '900', letterSpacing: 0.8, opacity: 0.88 },
  title: { color: '#fff', fontSize: 23, lineHeight: 27, fontWeight: '900', marginTop: 4 },
  body: { padding: 14, gap: 10 },
  meta: { color: C.text2, fontSize: 12, fontFamily: mono, fontWeight: '700' },
  summaryText: { color: C.text2, fontSize: 13, lineHeight: 19 },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  infoText: { flex: 1, color: C.text2, fontSize: 13, lineHeight: 19 },
  section: { marginTop: 4, borderTopWidth: 1, borderColor: C.border, paddingTop: 10 },
  sectionLabel: { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '900', letterSpacing: 0.8, marginBottom: 5 },
  sectionText: { color: C.text2, fontSize: 12, lineHeight: 18 },
  reviewCard: { borderWidth: 1, borderColor: C.border, backgroundColor: C.s2, borderRadius: 14, padding: 11, gap: 5, marginBottom: 8 },
  reviewTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reviewAuthor: { flex: 1, color: C.text, fontSize: 12, fontWeight: '800' },
  reviewRating: { color: C.gold, fontSize: 10, fontFamily: mono, fontWeight: '900' },
  reviewMeta: { color: C.text3, fontSize: 10, fontFamily: mono },
  reviewText: { color: C.text2, fontSize: 12, lineHeight: 17 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 2 },
  secondaryBtn: { width: 45, height: 45, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: C.glassStrong, borderWidth: 1, borderColor: C.border },
  deepActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: C.border, backgroundColor: C.glass, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 8 },
  linkText: { color: C.text2, fontSize: 11, fontWeight: '700' },
  photoRail: { gap: 9, paddingVertical: 4 },
  railPhoto: { width: 118, height: 84, borderRadius: 14, backgroundColor: C.s2 },
  sourceFooter: { borderTopWidth: 1, borderColor: C.border, paddingTop: 9, marginTop: 2 },
  sourceText: { color: C.text3, fontSize: Platform.OS === 'web' ? 12 : 12, lineHeight: 16 },
});
