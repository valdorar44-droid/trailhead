import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Linking,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, PaywallError, type PlaceComment, type PlaceDetail, type PlaceReservationStatus, type TrailheadPlace } from '@/lib/api';
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
  official_url?: string;
  booking_url?: string;
  open_now?: boolean | null;
  hours?: string[];
  open_hours?: string[] | string | Record<string, unknown> | null;
  hours_label?: string | null;
  rating?: number;
  rating_count?: number;
  average_rating?: number;
  review_count?: number;
  photo_url?: string | null;
  photos?: TrailheadGalleryPhoto[];
  primary_image?: string | null;
  other_images?: string[];
  mapbox_categories?: string[];
  brand?: string | null;
  enrichment_source?: string;
  enrichment_status?: string;
  google_maps_uri?: string;
  attribution?: string;
  summary?: string;
  access_note?: string;
  distance_mi?: number;
  route_distance_mi?: number;
  confidence?: string;
  rich_detail_available?: boolean;
  rich_detail_locked?: boolean;
  rich_detail_reason?: string;
  source_badge?: string;
  source_freshness?: string;
  last_checked?: number;
  waterbody_name?: string;
  waterbody_type?: string;
  access?: string;
  craft?: string;
  fishing_score?: number;
  fishing_score_label?: string;
  fish_species?: string[] | string;
  stocking_notes?: string;
  regulations_url?: string;
  gauge_id?: string;
  gauge_url?: string;
  flow_cfs?: number;
  gage_height_ft?: number;
  observed_at?: number | string;
  chart_source?: string;
  chart_url?: string;
  weather_url?: string;
  tides_url?: string;
  safety_url?: string;
  navigation_feature?: string;
  hazard_type?: string;
  mark_color?: string;
  mark_shape?: string;
  light_character?: string;
  depth_ft?: number;
  max_draft_ft?: number;
  navigation_note?: string;
};

type RelatedItem = {
  id?: string | number;
  name?: string;
  lat: number;
  lng: number;
  type?: string;
  subtype?: string;
  source_label?: string;
  distance_mi?: number;
  route_distance_mi?: number;
  photo_url?: string | null;
  length_mi?: number | null;
};

type Props = {
  place: PlaceLike | null;
  visible?: boolean;
  initialStage?: Stage;
  related?: {
    loading?: boolean;
    places?: RelatedItem[];
    camps?: RelatedItem[];
    things_to_do?: RelatedItem[];
    campgrounds_nearby?: RelatedItem[];
    trip_services?: RelatedItem[];
    trails?: RelatedItem[];
    error?: string;
  };
  onClose: () => void;
  onNavigate: (place: { name: string; lat: number; lng: number }) => void;
  onSave?: (place: { name: string; lat: number; lng: number; note?: string }) => void;
  onReport?: () => void;
  onNearbyCamps?: (place: { name: string; lat: number; lng: number }) => void;
  onAddToRoute?: (place: { name: string; lat: number; lng: number; note?: string }) => void;
  onPromoteToRoute?: (place: { name: string; lat: number; lng: number; note?: string }) => void;
  addToRouteLabel?: string;
  promoteToRouteLabel?: string;
  addToRoutePrimary?: boolean;
  routeContextLabel?: string;
  onRichDetailLocked?: (place: PlaceLike) => void;
  onOpenRelatedPlace?: (place: RelatedItem) => void;
  onOpenRelatedCamp?: (place: RelatedItem) => void;
  onOpenRelatedTrail?: (place: RelatedItem) => void;
};

function titleCase(value?: string) {
  return (value || 'Place').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function sourceId(place: PlaceLike) {
  const rawId = String(place.id || '');
  const source = place.source || (rawId.startsWith('google:') ? 'google' : rawId.startsWith('foursquare:') ? 'foursquare' : '');
  const id = place.provider_place_id || place.place_id || rawId.replace(/^google:/, '').replace(/^foursquare:/, '');
  const cleanSource = String(source || '').toLowerCase();
  return cleanSource && ['google', 'foursquare', 'fsq'].includes(cleanSource) && id ? { source: cleanSource, id } : null;
}

function canonicalPayload(place: PlaceLike) {
  return {
    id: place.id,
    name: place.name,
    lat: place.lat,
    lng: place.lng,
    source: place.source || place.attribution || place.source_label || 'map',
    source_label: place.source_label || place.attribution,
    provider_place_id: place.provider_place_id,
    place_id: place.place_id,
    category: place.type,
    type: place.type,
    subtype: place.subtype,
    official_url: place.official_url || place.booking_url || place.website,
    website: place.website || place.official_url || place.booking_url,
    photo_url: place.photo_url,
    summary: place.summary,
    address: place.address,
    phone: place.phone,
    rating: place.rating,
    rating_count: place.rating_count,
    photos: place.photos,
  };
}

function hasPaidProviderSource(place: PlaceLike | null | undefined) {
  return false;
}

function isTransientMapboxPlace(place: PlaceLike | null | undefined) {
  const source = String(place?.source || '').toLowerCase();
  return source === 'rendered_mapbox_standard' || source === 'mapbox_feature' || source === 'rendered_map' || source === 'mapbox_search';
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

function normalizeHours(value: PlaceLike['open_hours'], label?: string | null) {
  if (Array.isArray(value)) return value.map(line => String(line || '').trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(/\n|;/).map(line => line.trim()).filter(Boolean);
  if (value && typeof value === 'object') {
    const raw = (value as any).weekday_text || (value as any).periods || (value as any).data || [];
    if (Array.isArray(raw)) return raw.map(line => String(line || '').trim()).filter(Boolean);
  }
  return label ? [label] : [];
}

function itemIcon(type?: string): keyof typeof Ionicons.glyphMap {
  const clean = String(type || '').toLowerCase();
  if (clean === 'camp') return 'bonfire-outline';
  if (clean === 'trail' || clean === 'trailhead') return 'trail-sign-outline';
  if (clean === 'viewpoint') return 'flag-outline';
  if (clean === 'peak') return 'triangle-outline';
  if (clean === 'hot_spring') return 'flame-outline';
  if (clean === 'fuel') return 'flash-outline';
  if (clean === 'water') return 'water-outline';
  if (clean === 'food') return 'restaurant-outline';
  if (clean === 'grocery') return 'cart-outline';
  return 'location-outline';
}

function itemMeta(item: RelatedItem) {
  const distance = item.route_distance_mi ?? item.distance_mi;
  return [
    item.length_mi != null ? `${Number(item.length_mi).toFixed(Number(item.length_mi) >= 10 ? 0 : 1)} mi trail` : titleCase(item.subtype || item.type),
    distance != null && Number.isFinite(Number(distance)) ? `${Number(distance).toFixed(1)} mi` : '',
  ].filter(Boolean).join(' · ');
}

export default function PremiumPlaceSheet({
  place,
  visible = !!place,
  initialStage = 'full',
  related,
  onClose,
  onNavigate,
  onSave,
  onReport,
  onNearbyCamps,
  onAddToRoute,
  onPromoteToRoute,
  addToRouteLabel = 'Add to route',
  promoteToRouteLabel = 'Route through this',
  addToRoutePrimary = false,
  routeContextLabel,
  onRichDetailLocked,
  onOpenRelatedPlace,
  onOpenRelatedCamp,
  onOpenRelatedTrail,
}: Props) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [stage, setStage] = useState<Stage>(initialStage);
  const [detail, setDetail] = useState<PlaceDetail | null>(null);
  const [canonical, setCanonical] = useState<TrailheadPlace | null>(null);
  const [comments, setComments] = useState<PlaceComment[]>([]);
  const [reservation, setReservation] = useState<PlaceReservationStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [communityBusy, setCommunityBusy] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null);
  const [showCommentForm, setShowCommentForm] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [commentPhoto, setCommentPhoto] = useState<string | null>(null);
  const [showEditForm, setShowEditForm] = useState(false);
  const [editField, setEditField] = useState('access_notes');
  const [editValue, setEditValue] = useState('');
  const [editNote, setEditNote] = useState('');
  const [alertStart, setAlertStart] = useState('');
  const [alertEnd, setAlertEnd] = useState('');
  const dragY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!place) {
      setDetail(null);
      setCanonical(null);
      setComments([]);
      setReservation(null);
      return;
    }
    setStage(initialStage);
    setDetail(null);
    setCanonical(null);
    setComments([]);
    setReservation(null);
    setShowCommentForm(false);
    setShowEditForm(false);
    setCommentText('');
    setCommentPhoto(null);
    setEditValue('');
    setEditNote('');
    setGalleryIndex(null);
    setLoading(false);
    if (isTransientMapboxPlace(place)) return;
    let canonicalCancelled = false;
    api.canonicalizePlace(canonicalPayload(place))
      .then(({ place: canonicalPlace }) => {
        if (canonicalCancelled) return;
        setCanonical(canonicalPlace);
        setComments(canonicalPlace.comments ?? []);
        const type = String(place.type || canonicalPlace.category || '').toLowerCase();
        const reservable = Boolean((place as any).reservable || (canonicalPlace.display_metadata as any)?.reservable);
        if (type === 'camp' || type === 'camping' || reservable) {
          api.getPlaceReservationStatus(canonicalPlace.trailhead_place_id)
            .then(status => { if (!canonicalCancelled) setReservation(status); })
            .catch(() => {});
        }
      })
      .catch(() => {});
    const sid = sourceId(place);
    if (!sid || hasPaidProviderSource(place)) return () => { canonicalCancelled = true; };
    let cancelled = false;
    setLoading(true);
    api.getPlaceDetail(sid.source, sid.id, place.type || '')
      .then(next => {
        if (!cancelled) setDetail(next);
      })
      .catch(err => {
        if (!cancelled && err instanceof PaywallError) onRichDetailLocked?.(place);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; canonicalCancelled = true; };
  }, [place?.id, place?.name, place?.lat, place?.lng, initialStage]);

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
  const richDetailLocked = (hasPaidProviderSource(place) || !!place.rich_detail_locked) && !detail;

  const officialPhotos: TrailheadGalleryPhoto[] = detail?.photos?.length
    ? detail.photos.map(photo => ({ ...photo, url: mediaUrl(photo.url) }))
    : data.photos?.length
      ? data.photos.map(photo => ({ ...photo, url: mediaUrl(photo.url) }))
    : data.photo_url
      ? [{ url: mediaUrl(data.photo_url), source: data.source_label || data.source || '' }]
      : [];
  const mapboxPhotos: TrailheadGalleryPhoto[] = [
    data.primary_image,
    ...(data.other_images ?? []),
  ]
    .map(url => mediaUrl(url))
    .filter(Boolean)
    .map((url, idx) => ({ id: -1000 - idx, url, source: data.source_label || data.enrichment_source || 'Mapbox' }));
  const canonicalHero: TrailheadGalleryPhoto[] = canonical?.hero_photo_url
    ? [{ url: mediaUrl(canonical.hero_photo_url), source: canonical.hero_photo_source === 'community' ? 'Trailhead community' : canonical.source_label || canonical.source }]
    : [];
  const userPhotos: TrailheadGalleryPhoto[] = (canonical?.photos ?? [])
    .map(photo => ({ url: mediaUrl(photo.url), caption: photo.caption || undefined, source: photo.username ? `Trailhead photo by ${photo.username}` : 'Trailhead community' }))
    .filter(photo => !!photo.url);
  const photos = officialPhotos.length || mapboxPhotos.length
    ? [...officialPhotos, ...mapboxPhotos.filter(photo => !officialPhotos.some(existing => existing.url === photo.url)), ...userPhotos.filter(photo => ![...officialPhotos, ...mapboxPhotos].some(existing => existing.url === photo.url))]
    : canonicalHero.length
      ? [...canonicalHero, ...userPhotos.filter(photo => photo.url !== canonicalHero[0].url)]
      : userPhotos;
  const reviews = (detail?.reviews ?? []).filter(review => !['google', 'foursquare'].includes(String(review.source || '').toLowerCase()));
  const relatedHero = [
    ...(related?.things_to_do ?? []),
    ...(related?.places ?? []),
    ...(related?.campgrounds_nearby ?? []),
    ...(related?.camps ?? []),
    ...(related?.trails ?? []),
  ].map(item => mediaUrl(item.photo_url)).find(Boolean);
  const hero = photos[0]?.url || relatedHero;
  const sourceLabel = data.source_label || data.attribution || data.source || 'Trailhead';
  const addToRoute = () => onAddToRoute?.({ name: place.name, lat: place.lat, lng: place.lng, note: data.summary || subtitle });
  const promoteToRoute = () => onPromoteToRoute?.({ name: place.name, lat: place.lat, lng: place.lng, note: data.summary || subtitle });
  const distanceLabel = data.route_distance_mi != null && Number.isFinite(data.route_distance_mi)
    ? `${Number(data.route_distance_mi).toFixed(1)} mi off route`
    : data.distance_mi != null && Number.isFinite(data.distance_mi)
      ? `${Number(data.distance_mi).toFixed(1)} mi away`
      : '';
  const subtitle = [
    data.brand || titleCase(data.subtype || data.type),
    distanceLabel,
    data.rating || data.average_rating ? `${Number(data.rating ?? data.average_rating).toFixed(1)} (${data.rating_count ?? data.review_count ?? 0})` : '',
    openNowLabel(data.open_now),
  ].filter(Boolean).join(' · ');
  const hours = detail?.hours?.length ? detail.hours : data.hours?.length ? data.hours : normalizeHours(data.open_hours, data.hours_label);
  const sourceFreshness = data.source_freshness || (data.last_checked ? `Downloaded source checked ${new Date(Number(data.last_checked) * 1000).toLocaleDateString()}. Verify current access before relying on it.` : '');
  const fishSpecies = Array.isArray(data.fish_species) ? data.fish_species.join(', ') : String(data.fish_species || '');
  const waterFacts = data.type === 'water' ? [
    data.waterbody_name ? ['Waterbody', data.waterbody_name] : null,
    data.access ? ['Access', titleCase(data.access)] : null,
    data.craft ? ['Craft', titleCase(data.craft)] : null,
    data.fishing_score_label ? ['Fishing evidence', `${data.fishing_score_label}${data.fishing_score != null ? ` · ${data.fishing_score}/100` : ''}`] : null,
    fishSpecies ? ['Species', fishSpecies] : null,
    data.stocking_notes ? ['Stocking', String(data.stocking_notes)] : null,
    data.navigation_feature ? ['Navigation feature', String(data.navigation_feature)] : null,
    data.hazard_type ? ['Hazard', String(data.hazard_type)] : null,
    data.mark_color ? ['Marker color', String(data.mark_color)] : null,
    data.mark_shape ? ['Marker shape', String(data.mark_shape)] : null,
    data.light_character ? ['Light', String(data.light_character)] : null,
    data.depth_ft != null ? ['Depth', `${Number(data.depth_ft).toFixed(1)} ft`] : null,
    data.max_draft_ft != null ? ['Max draft', `${Number(data.max_draft_ft).toFixed(1)} ft`] : null,
    data.flow_cfs != null ? ['Flow', `${Number(data.flow_cfs).toLocaleString()} cfs`] : null,
    data.gage_height_ft != null ? ['Gauge height', `${Number(data.gage_height_ft).toFixed(2)} ft`] : null,
    data.chart_source ? ['Chart context', data.chart_source] : null,
  ].filter(Boolean) as [string, string][] : [];

  const cycleStage = () => {
    setStage(current => current === 'full' ? 'half' : current === 'half' ? 'peek' : 'half');
  };

  const unlockRichDetail = async () => {
    if (!place || loading) return;
    const sid = sourceId(place);
    if (!sid) return;
    setLoading(true);
    try {
      await api.authorizePlaceDetail(sid.source, sid.id, place.type || '');
      const next = await api.getPlaceDetail(sid.source, sid.id, place.type || '');
      setDetail(next);
    } catch (err) {
      if (err instanceof PaywallError) onRichDetailLocked?.(place);
    } finally {
      setLoading(false);
    }
  };

  const pickCommunityPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.58,
      base64: true,
    });
    if (!result.canceled && result.assets[0]?.base64) setCommentPhoto(result.assets[0].base64);
  };

  const submitComment = async () => {
    if (!canonical || communityBusy || commentText.trim().length < 2) return;
    setCommunityBusy(true);
    try {
      const res = await api.submitPlaceComment(canonical.trailhead_place_id, {
        body: commentText.trim(),
        photo_data: commentPhoto ?? undefined,
        photo_caption: commentText.trim().slice(0, 120),
      });
      setComments(prev => [res.comment, ...prev]);
      if (res.photo) {
        setCanonical(prev => prev ? { ...prev, photos: [...(prev.photos ?? []), res.photo!] } : prev);
      }
      setCommentText('');
      setCommentPhoto(null);
      setShowCommentForm(false);
    } catch (err: any) {
      Alert.alert('Could not post', err?.status === 401 || err?.status === 403 ? 'Sign in to add place comments.' : (err?.message ?? 'Try again in a moment.'));
    } finally {
      setCommunityBusy(false);
    }
  };

  const submitEdit = async () => {
    if (!canonical || communityBusy || editValue.trim().length < 2) return;
    setCommunityBusy(true);
    try {
      const res = await api.suggestPlaceEdit(canonical.trailhead_place_id, {
        place_name: data.name,
        field: editField,
        value: editValue.trim(),
        note: editNote.trim() || undefined,
      });
      setEditValue('');
      setEditNote('');
      setShowEditForm(false);
      Alert.alert('Edit sent', `Thanks. +${res.credits_earned ?? 0} credits.`);
    } catch (err: any) {
      Alert.alert('Could not send edit', err?.status === 401 || err?.status === 403 ? 'Sign in to suggest place edits.' : (err?.message ?? 'Try again in a moment.'));
    } finally {
      setCommunityBusy(false);
    }
  };

  const saveAvailabilityAlert = async () => {
    if (!canonical || !reservation?.alert_supported || communityBusy) return;
    setCommunityBusy(true);
    try {
      const res = await api.savePlaceReservationAlert(canonical.trailhead_place_id, {
        start_date: alertStart.trim() || undefined,
        end_date: alertEnd.trim() || undefined,
        party_size: 1,
      });
      setReservation(prev => prev ? { ...prev, alerts: [res.alert, ...(prev.alerts ?? []).filter(a => a.id !== res.alert.id)] } : prev);
      Alert.alert('Alert saved', 'Trailhead will hand off to the official booking source when availability is checked.');
    } catch (err: any) {
      Alert.alert('Could not save alert', err?.status === 401 || err?.status === 403 ? 'Sign in to save availability alerts.' : (err?.message ?? 'Try again in a moment.'));
    } finally {
      setCommunityBusy(false);
    }
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
            contentContainerStyle={[s.content, addToRoutePrimary && !!onAddToRoute && s.contentWithStickyAction]}
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
              {!!routeContextLabel && (
                <View style={s.routeContextPill}>
                  <Ionicons name="git-branch-outline" size={13} color={C.orange} />
                  <Text style={s.routeContextText} numberOfLines={2}>{routeContextLabel}</Text>
                </View>
              )}
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
              {stage === 'full' && waterFacts.length > 0 ? (
                <View style={s.section}>
                  <Text style={s.sectionLabel}>WATER ACCESS</Text>
                  {waterFacts.map(([label, value]) => (
                    <View key={label} style={s.infoRow}>
                      <Ionicons name={label === 'Fishing evidence' || label === 'Species' ? 'fish-outline' : label === 'Craft' || label === 'Navigation feature' ? 'boat-outline' : label === 'Hazard' ? 'warning-outline' : label === 'Depth' ? 'analytics-outline' : 'water-outline'} size={15} color={C.text3} />
                      <Text style={s.infoText}>{label}: {value}</Text>
                    </View>
                  ))}
                  {!!data.navigation_note && (
                    <View style={s.infoRow}>
                      <Ionicons name="warning-outline" size={15} color={C.orange} />
                      <Text style={s.infoText} numberOfLines={4}>{data.navigation_note}</Text>
                    </View>
                  )}
                  {!!data.regulations_url && (
                    <TouchableOpacity style={s.linkBtn} onPress={() => Linking.openURL(String(data.regulations_url))}>
                      <Ionicons name="document-text-outline" size={14} color={C.orange} />
                      <Text style={[s.linkText, { color: C.orange }]}>Fishing regulations</Text>
                    </TouchableOpacity>
                  )}
                  {!!data.gauge_url && (
                    <TouchableOpacity style={s.linkBtn} onPress={() => Linking.openURL(String(data.gauge_url))}>
                      <Ionicons name="speedometer-outline" size={14} color={C.text2} />
                      <Text style={s.linkText}>USGS gauge</Text>
                    </TouchableOpacity>
                  )}
                  {!!data.weather_url && (
                    <TouchableOpacity style={s.linkBtn} onPress={() => Linking.openURL(String(data.weather_url))}>
                      <Ionicons name="thunderstorm-outline" size={14} color={C.text2} />
                      <Text style={s.linkText}>NWS forecast / alerts</Text>
                    </TouchableOpacity>
                  )}
                  {!!data.tides_url && (
                    <TouchableOpacity style={s.linkBtn} onPress={() => Linking.openURL(String(data.tides_url))}>
                      <Ionicons name="analytics-outline" size={14} color={C.text2} />
                      <Text style={s.linkText}>NOAA tides / currents</Text>
                    </TouchableOpacity>
                  )}
                  {!!data.chart_url && (
                    <TouchableOpacity style={s.linkBtn} onPress={() => Linking.openURL(String(data.chart_url))}>
                      <Ionicons name="map-outline" size={14} color={C.text2} />
                      <Text style={s.linkText}>Official chart context</Text>
                    </TouchableOpacity>
                  )}
                  {!!data.safety_url && (
                    <TouchableOpacity style={s.linkBtn} onPress={() => Linking.openURL(String(data.safety_url))}>
                      <Ionicons name="shield-checkmark-outline" size={14} color={C.text2} />
                      <Text style={s.linkText}>Boating safety</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ) : null}
              {stage === 'full' && !!sourceFreshness && (
                <View style={s.infoRow}>
                  <Ionicons name="cloud-done-outline" size={15} color={C.text3} />
                  <Text style={s.infoText} numberOfLines={4}>{sourceFreshness}</Text>
                </View>
              )}
              {stage === 'full' && (related?.loading || related?.things_to_do?.length || related?.places?.length || related?.campgrounds_nearby?.length || related?.camps?.length || related?.trip_services?.length || related?.trails?.length || related?.error) ? (
                <View style={s.relatedBlock}>
                  <View style={s.relatedHeader}>
                    <Text style={s.sectionLabel}>NEARBY CONTEXT</Text>
                    {related?.loading ? <ActivityIndicator color={C.orange} size="small" /> : null}
                  </View>
                  {!!related?.error && !related?.loading && (
                    <Text style={s.sectionText}>{related.error}</Text>
                  )}
                  <RelatedRail title="Things to do" items={(related?.things_to_do ?? related?.places ?? []).slice(0, 8)} onPress={onOpenRelatedPlace} C={C} styles={s} />
                  <RelatedRail title="Campgrounds nearby" items={(related?.campgrounds_nearby ?? related?.camps ?? []).slice(0, 8)} onPress={onOpenRelatedCamp} C={C} styles={s} />
                  <RelatedRail title="Trails" items={(related?.trails ?? []).slice(0, 8)} onPress={onOpenRelatedTrail} C={C} styles={s} />
                  <RelatedRail title="Trip services" items={(related?.trip_services ?? []).slice(0, 8)} onPress={onOpenRelatedPlace} C={C} styles={s} />
                </View>
              ) : null}
              {stage === 'full' && !!hours.length && (
                <View style={s.section}>
                  <Text style={s.sectionLabel}>HOURS</Text>
                  {hours.slice(0, 7).map(line => (
                    <Text key={line} style={s.sectionText}>{line}</Text>
                  ))}
                </View>
              )}
              {stage === 'full' && richDetailLocked && (
                <TouchableOpacity
                  style={s.richLockedCard}
                  activeOpacity={0.86}
                  onPress={unlockRichDetail}
                >
                  <View style={s.richLockedTop}>
                    <View style={s.richLockedIcon}>
                      <Ionicons name="lock-closed-outline" size={15} color={C.orange} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.richLockedTitle}>Show details · 5 credits</Text>
                      <Text style={s.richLockedText}>Provider photo, contact details, and weekly hours load only when requested.</Text>
                    </View>
                  </View>
                  <View style={s.richLockedPreview}>
                    <View style={[s.richLockedLine, { width: '82%' }]} />
                    <View style={[s.richLockedLine, { width: '64%' }]} />
                    <View style={s.richLockedPills}>
                      <View style={[s.richLockedPill, { width: 72 }]} />
                      <View style={[s.richLockedPill, { width: 98 }]} />
                    </View>
                  </View>
                </TouchableOpacity>
              )}

              <TrailheadButtonDock style={s.actions}>
                {addToRoutePrimary && !!onAddToRoute ? (
                  <>
                    <TrailheadButton
                      label={addToRouteLabel}
                      icon="add-circle-outline"
                      variant="primary"
                      onPress={addToRoute}
                      style={{ flex: 1 }}
                    />
                    <TouchableOpacity style={s.secondaryBtn} onPress={() => onNavigate(place)}>
                      <Ionicons name="navigate-outline" size={15} color={C.text2} />
                    </TouchableOpacity>
                    {!!onPromoteToRoute && (
                      <TouchableOpacity style={s.secondaryWideBtn} onPress={promoteToRoute}>
                        <Ionicons name="git-branch-outline" size={14} color={C.orange} />
                        <Text style={s.secondaryWideText}>{promoteToRouteLabel}</Text>
                      </TouchableOpacity>
                    )}
                  </>
                ) : (
                  <TrailheadButton
                    label="Navigate"
                    icon="navigate"
                    variant="primary"
                    onPress={() => onNavigate(place)}
                    style={{ flex: 1 }}
                  />
                )}
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
                {!!onAddToRoute && !addToRoutePrimary && (
                  <TouchableOpacity style={s.secondaryBtn} onPress={addToRoute}>
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
                  {!!onReport && (
                    <TouchableOpacity style={s.linkBtn} onPress={onReport}>
                      <Ionicons name="warning-outline" size={14} color={C.orange} />
                      <Text style={[s.linkText, { color: C.orange }]}>Report / update</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {stage === 'full' && reservation && (reservation.reservable || reservation.booking_url) ? (
                <View style={s.communityBlock}>
                  <View style={s.communityHeader}>
                    <Text style={s.sectionLabel}>RESERVATIONS</Text>
                    <Text style={s.communityCount}>{reservation.source_label || 'Official source'}</Text>
                  </View>
                  <Text style={s.sectionText}>{reservation.notes || reservation.source_freshness}</Text>
                  <View style={s.dateRow}>
                    <TextInput
                      value={alertStart}
                      onChangeText={setAlertStart}
                      placeholder="Start YYYY-MM-DD"
                      placeholderTextColor={C.text3}
                      style={s.dateInput}
                    />
                    <TextInput
                      value={alertEnd}
                      onChangeText={setAlertEnd}
                      placeholder="End YYYY-MM-DD"
                      placeholderTextColor={C.text3}
                      style={s.dateInput}
                    />
                  </View>
                  <View style={s.inlineActions}>
                    {!!reservation.check_availability_url && (
                      <TouchableOpacity style={s.smallPrimaryBtn} onPress={() => Linking.openURL(String(reservation.check_availability_url))}>
                        <Ionicons name="calendar-outline" size={13} color="#fff" />
                        <Text style={s.smallPrimaryText}>{(reservation.link_label || 'Check availability').toUpperCase()}</Text>
                      </TouchableOpacity>
                    )}
                    {reservation.alert_supported ? (
                      <TouchableOpacity style={s.smallSecondaryBtn} onPress={saveAvailabilityAlert} disabled={communityBusy}>
                        <Ionicons name="notifications-outline" size={13} color={C.orange} />
                        <Text style={s.smallSecondaryText}>SAVE ALERT</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              ) : null}

              {stage === 'full' && (
                <View style={s.communityBlock}>
                  <View style={s.communityHeader}>
                    <Text style={s.sectionLabel}>TRAILHEAD COMMUNITY</Text>
                    {comments.length > 0 ? <Text style={s.communityCount}>{comments.length}</Text> : null}
                  </View>
                  {comments.slice(0, 5).map(comment => (
                    <View key={comment.id} style={s.commentCard}>
                      <View style={s.commentTop}>
                        <Text style={s.commentAuthor} numberOfLines={1}>{comment.username}</Text>
                        <Text style={s.commentDate}>{new Date(comment.created_at * 1000).toLocaleDateString()}</Text>
                      </View>
                      <Text style={s.commentBody}>{comment.body}</Text>
                      {!!comment.photos?.length && (
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.inlinePhotoRail}>
                          {comment.photos.map(photo => (
                            <Image key={photo.id} source={{ uri: mediaUrl(photo.url) }} style={s.inlinePhoto} resizeMode="cover" />
                          ))}
                        </ScrollView>
                      )}
                    </View>
                  ))}
                  {!comments.length && !showCommentForm ? <Text style={s.sectionText}>No comments yet.</Text> : null}
                  {showCommentForm ? (
                    <View style={s.formCard}>
                      <TextInput
                        value={commentText}
                        onChangeText={v => setCommentText(v.slice(0, 1200))}
                        placeholder="Ask a question or leave a current access note..."
                        placeholderTextColor={C.text3}
                        style={s.textArea}
                        multiline
                      />
                      <TouchableOpacity style={s.photoAttachBtn} onPress={pickCommunityPhoto}>
                        <Ionicons name={commentPhoto ? 'checkmark-circle-outline' : 'camera-outline'} size={14} color={commentPhoto ? C.green : C.text3} />
                        <Text style={[s.photoAttachText, commentPhoto && { color: C.green }]}>{commentPhoto ? 'Photo attached (+5 credits)' : 'Add photo (+5 credits)'}</Text>
                      </TouchableOpacity>
                      <View style={s.inlineActions}>
                        <TouchableOpacity style={s.smallSecondaryBtn} onPress={() => { setShowCommentForm(false); setCommentText(''); setCommentPhoto(null); }}>
                          <Text style={s.smallSecondaryText}>CANCEL</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[s.smallPrimaryBtn, (commentText.trim().length < 2 || communityBusy) && { opacity: 0.55 }]} onPress={submitComment} disabled={commentText.trim().length < 2 || communityBusy}>
                          {communityBusy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.smallPrimaryText}>POST</Text>}
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <TouchableOpacity style={s.linkBtn} onPress={() => setShowCommentForm(true)}>
                      <Ionicons name="chatbubble-ellipses-outline" size={14} color={C.orange} />
                      <Text style={[s.linkText, { color: C.orange }]}>Add comment</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {stage === 'full' && (
                <View style={s.communityBlock}>
                  <View style={s.communityHeader}>
                    <Text style={s.sectionLabel}>SUGGEST EDIT</Text>
                  </View>
                  {showEditForm ? (
                    <View style={s.formCard}>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.editFieldRail}>
                        {[
                          ['name', 'Name'], ['category', 'Type'], ['hours', 'Hours'], ['phone', 'Phone'],
                          ['website', 'Website'], ['address', 'Address'], ['access_notes', 'Access'],
                          ['amenities', 'Amenities'], ['reservation_info', 'Reservation'], ['closure_status', 'Status'],
                          ['duplicate', 'Duplicate'], ['location', 'Location'],
                        ].map(([field, label]) => (
                          <TouchableOpacity key={field} style={[s.editFieldPill, editField === field && s.editFieldPillOn]} onPress={() => setEditField(field)}>
                            <Text style={[s.editFieldText, editField === field && s.editFieldTextOn]}>{label}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                      <TextInput
                        value={editValue}
                        onChangeText={v => setEditValue(v.slice(0, 1600))}
                        placeholder="Suggested value"
                        placeholderTextColor={C.text3}
                        style={s.textArea}
                        multiline
                      />
                      <TextInput
                        value={editNote}
                        onChangeText={v => setEditNote(v.slice(0, 500))}
                        placeholder="Optional note"
                        placeholderTextColor={C.text3}
                        style={s.input}
                      />
                      <View style={s.inlineActions}>
                        <TouchableOpacity style={s.smallSecondaryBtn} onPress={() => { setShowEditForm(false); setEditValue(''); setEditNote(''); }}>
                          <Text style={s.smallSecondaryText}>CANCEL</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[s.smallPrimaryBtn, (editValue.trim().length < 2 || communityBusy) && { opacity: 0.55 }]} onPress={submitEdit} disabled={editValue.trim().length < 2 || communityBusy}>
                          {communityBusy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.smallPrimaryText}>SEND EDIT</Text>}
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <TouchableOpacity style={s.linkBtn} onPress={() => setShowEditForm(true)}>
                      <Ionicons name="create-outline" size={14} color={C.text2} />
                      <Text style={s.linkText}>Suggest name, hours, access, photo, duplicate, or location fix</Text>
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

              {stage === 'full' && !!reviews.length && (
                <View style={s.section}>
                  <Text style={s.sectionLabel}>COMMUNITY NOTES</Text>
                  {reviews.slice(0, 3).map((review, idx) => (
                    <View key={`${review.authorName}-${idx}`} style={s.reviewCard}>
                      <View style={s.reviewTop}>
                        <Text style={s.reviewAuthor} numberOfLines={1}>{review.authorName || 'Trailhead user'}</Text>
                        <Text style={s.reviewRating}>{review.rating ? `${review.rating}/5` : review.source || 'Trailhead'}</Text>
                      </View>
                      {!!review.relativeTime && <Text style={s.reviewMeta}>{review.relativeTime}</Text>}
                      {!!review.text && <Text style={s.reviewText} numberOfLines={4}>{review.text}</Text>}
                    </View>
                  ))}
                </View>
              )}

              <View style={s.sourceFooter}>
                <Text style={s.sourceText} numberOfLines={2}>
                  {sourceLabel}{photos[0]?.credit ? ` · Photo: ${photos[0].credit}` : ''}
                </Text>
              </View>
            </View>
          </ScrollView>
        )}
        {stage !== 'peek' && addToRoutePrimary && !!onAddToRoute && (
          <TrailheadButtonDock style={[s.stickyRouteAction, { paddingBottom: Math.max(insets.bottom, 10) }]}>
            <TrailheadButton
              label={addToRouteLabel}
              icon="add-circle-outline"
              variant="primary"
              onPress={addToRoute}
              style={{ flex: 1 }}
            />
            <TouchableOpacity style={s.secondaryBtn} onPress={() => onNavigate(place)}>
              <Ionicons name="navigate-outline" size={15} color={C.text2} />
            </TouchableOpacity>
            {!!onPromoteToRoute && (
              <TouchableOpacity style={s.secondaryWideBtn} onPress={promoteToRoute}>
                <Ionicons name="git-branch-outline" size={14} color={C.orange} />
                <Text style={s.secondaryWideText}>{promoteToRouteLabel}</Text>
              </TouchableOpacity>
            )}
          </TrailheadButtonDock>
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

function RelatedRail({
  title,
  items,
  onPress,
  C,
  styles,
}: {
  title: string;
  items: RelatedItem[];
  onPress?: (item: RelatedItem) => void;
  C: ColorPalette;
  styles: ReturnType<typeof makeStyles>;
}) {
  if (!items.length) return null;
  return (
    <View style={styles.relatedSection}>
      <Text style={styles.relatedTitle}>{title.toUpperCase()}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.relatedRail}>
        {items.map((item, idx) => (
          <TouchableOpacity
            key={`${item.id || item.name || title}-${idx}`}
            style={styles.relatedCard}
            activeOpacity={0.86}
            onPress={() => onPress?.(item)}
          >
            {item.photo_url ? (
              <Image source={{ uri: mediaUrl(item.photo_url) }} style={styles.relatedPhoto} resizeMode="cover" />
            ) : (
              <View style={styles.relatedIcon}>
                <Ionicons name={itemIcon(item.type)} size={17} color={C.orange} />
              </View>
            )}
            <Text style={styles.relatedName} numberOfLines={2}>{item.name || titleCase(item.type)}</Text>
            <Text style={styles.relatedMeta} numberOfLines={1}>{itemMeta(item)}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
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
  contentWithStickyAction: { paddingBottom: 102 },
  hero: { height: 164, marginHorizontal: 12, borderRadius: 22, overflow: 'hidden', backgroundColor: C.s2 },
  heroImage: { width: '100%', height: '100%' },
  heroFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.glassStrong },
  heroShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.22)' },
  heroText: { position: 'absolute', left: 16, right: 16, bottom: 14 },
  kicker: { color: '#fff', fontSize: 9, fontFamily: mono, fontWeight: '900', letterSpacing: 0.8, opacity: 0.88 },
  title: { color: '#fff', fontSize: 23, lineHeight: 27, fontWeight: '900', marginTop: 4 },
  body: { padding: 14, gap: 10 },
  meta: { color: C.text2, fontSize: 12, fontFamily: mono, fontWeight: '700' },
  routeContextPill: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, borderWidth: 1, borderColor: C.orange + '45', backgroundColor: C.orange + '10', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8 },
  routeContextText: { flex: 1, color: C.orange, fontSize: 11, lineHeight: 15, fontFamily: mono, fontWeight: '800' },
  summaryText: { color: C.text2, fontSize: 13, lineHeight: 19 },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  infoText: { flex: 1, color: C.text2, fontSize: 13, lineHeight: 19 },
  section: { marginTop: 4, borderTopWidth: 1, borderColor: C.border, paddingTop: 10 },
  sectionLabel: { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '900', letterSpacing: 0.8, marginBottom: 5 },
  sectionText: { color: C.text2, fontSize: 12, lineHeight: 18 },
  richLockedCard: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: C.orange + '45',
    backgroundColor: C.orange + '10',
    borderRadius: 14,
    padding: 12,
    gap: 12,
    overflow: 'hidden',
  },
  richLockedTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  richLockedIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.orange + '18',
    borderWidth: 1,
    borderColor: C.orange + '42',
  },
  richLockedTitle: { color: C.text, fontSize: 13, fontWeight: '900' },
  richLockedText: { color: C.text3, fontSize: 11, lineHeight: 15, marginTop: 2 },
  richLockedPreview: { gap: 8, opacity: 0.46 },
  richLockedLine: { height: 11, borderRadius: 6, backgroundColor: C.text2 },
  richLockedPills: { flexDirection: 'row', gap: 8, marginTop: 2 },
  richLockedPill: { height: 22, borderRadius: 11, backgroundColor: C.text3 },
  relatedBlock: { gap: 10, paddingVertical: 2 },
  relatedHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  relatedSection: { gap: 7 },
  relatedTitle: { color: C.text3, fontSize: 9, fontFamily: mono, letterSpacing: 0.9, fontWeight: '900' },
  relatedRail: { gap: 8, paddingRight: 12 },
  relatedCard: {
    width: 128,
    minHeight: 116,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
    padding: 9,
    gap: 7,
  },
  relatedPhoto: { width: '100%', height: 44, borderRadius: 8, backgroundColor: C.s2 },
  relatedIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: C.orange + '18',
    alignItems: 'center',
    justifyContent: 'center',
  },
  relatedName: { color: C.text, fontSize: 12, fontWeight: '800', lineHeight: 15 },
  relatedMeta: { color: C.text3, fontSize: 10, fontFamily: mono },
  reviewCard: { borderWidth: 1, borderColor: C.border, backgroundColor: C.s2, borderRadius: 14, padding: 11, gap: 5, marginBottom: 8 },
  reviewTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reviewAuthor: { flex: 1, color: C.text, fontSize: 12, fontWeight: '800' },
  reviewRating: { color: C.gold, fontSize: 10, fontFamily: mono, fontWeight: '900' },
  reviewMeta: { color: C.text3, fontSize: 10, fontFamily: mono },
  reviewText: { color: C.text2, fontSize: 12, lineHeight: 17 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 2 },
  stickyRouteAction: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderColor: C.border,
    backgroundColor: C.glassStrong,
  },
  secondaryBtn: { width: 45, height: 45, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: C.glassStrong, borderWidth: 1, borderColor: C.border },
  secondaryWideBtn: { minHeight: 45, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 16, paddingHorizontal: 11, backgroundColor: C.glassStrong, borderWidth: 1, borderColor: C.orange + '55' },
  secondaryWideText: { color: C.orange, fontSize: 10, fontFamily: mono, fontWeight: '900' },
  deepActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: C.border, backgroundColor: C.glass, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 8 },
  linkText: { color: C.text2, fontSize: 11, fontWeight: '700' },
  communityBlock: { borderTopWidth: 1, borderColor: C.border, paddingTop: 10, gap: 9 },
  communityHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  communityCount: { color: C.text3, fontSize: 10, fontFamily: mono, fontWeight: '900' },
  commentCard: { borderWidth: 1, borderColor: C.border, backgroundColor: C.s2, borderRadius: 12, padding: 10, gap: 6 },
  commentTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  commentAuthor: { flex: 1, color: C.text, fontSize: 12, fontWeight: '800' },
  commentDate: { color: C.text3, fontSize: 10, fontFamily: mono },
  commentBody: { color: C.text2, fontSize: 12, lineHeight: 17 },
  inlinePhotoRail: { gap: 8, paddingTop: 3 },
  inlinePhoto: { width: 86, height: 62, borderRadius: 9, backgroundColor: C.s1 },
  formCard: { borderWidth: 1, borderColor: C.border, backgroundColor: C.s1, borderRadius: 12, padding: 10, gap: 9 },
  textArea: { minHeight: 88, color: C.text, fontSize: 13, lineHeight: 18, borderWidth: 1, borderColor: C.border, backgroundColor: C.glass, borderRadius: 10, padding: 10, textAlignVertical: 'top' },
  input: { color: C.text, fontSize: 13, borderWidth: 1, borderColor: C.border, backgroundColor: C.glass, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9 },
  photoAttachBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', borderWidth: 1, borderColor: C.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 8 },
  photoAttachText: { color: C.text3, fontSize: 11, fontWeight: '800' },
  inlineActions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  smallPrimaryBtn: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: C.orange },
  smallPrimaryText: { color: '#fff', fontSize: 10, fontFamily: mono, fontWeight: '900' },
  smallSecondaryBtn: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.glass },
  smallSecondaryText: { color: C.orange, fontSize: 10, fontFamily: mono, fontWeight: '900' },
  editFieldRail: { gap: 7, paddingRight: 8 },
  editFieldPill: { borderWidth: 1, borderColor: C.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: C.glass },
  editFieldPillOn: { borderColor: C.orange, backgroundColor: C.orange + '16' },
  editFieldText: { color: C.text3, fontSize: 10, fontWeight: '800' },
  editFieldTextOn: { color: C.orange },
  dateRow: { flexDirection: 'row', gap: 8 },
  dateInput: { flex: 1, minWidth: 0, color: C.text, fontSize: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.glass, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9 },
  photoRail: { gap: 9, paddingVertical: 4 },
  railPhoto: { width: 118, height: 84, borderRadius: 14, backgroundColor: C.s2 },
  sourceFooter: { borderTopWidth: 1, borderColor: C.border, paddingTop: 9, marginTop: 2 },
  sourceText: { color: C.text3, fontSize: Platform.OS === 'web' ? 12 : 12, lineHeight: 16 },
});
