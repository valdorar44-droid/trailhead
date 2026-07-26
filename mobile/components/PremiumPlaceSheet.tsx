import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  Image,
  Linking,
  PanResponder,
  Platform,
  Share,
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
import { TRAILHEAD_API_BASE } from '@/lib/apiBase';
import { useTheme, mono, type ColorPalette } from '@/lib/design';
import {
  classifyRelatedPlaceSheetKind,
  cleanExploreSourceLabel,
  relatedPlaceCanShow,
  relatedPlaceNameKey,
  relatedTrailCanShow,
  relatedThingToDoCanShow,
  relatedThingToSeeCanShow,
  uniqueRelatedPlaces,
} from '@/lib/exploreContextFilters';
import { TrailheadButton, TrailheadButtonDock, TrailheadLoadingRow, TrailheadRailSkeleton, TrailheadSheet } from '@/components/TrailheadUI';
import TrailheadPhotoGallery, { type TrailheadGalleryPhoto } from '@/components/TrailheadPhotoGallery';
import PlaceSheetShell, { PlaceSheetHeroChrome, PlaceSheetShellHeader } from '@/components/map/PlaceSheetShell';
import FirstPartyRatingSection from '@/components/map/FirstPartyRatingSection';
import {
  adaptGenericPlaceSheet,
  cleanPlaceSheetDisplayText,
  formatPlaceSheetDistanceLabel,
  isPlaceSheetSummaryRedundant,
} from '@/lib/placeSheetAdapters';
import { communityRatingTarget } from '@/lib/communityRatingEligibility';
import { boundedExploreImageUrl, EXPLORE_IMAGE_BOUNDS, exploreImageSource } from '@/lib/mediaPolicy';
import {
  inferSheetActionEntityKindV1,
  resolveSheetActionDescriptorsV1,
  sheetActionByIdV1,
  sheetActionTestIDV1,
  type SheetActionIdV1,
} from '@/lib/sheetActions';
import type { SheetReturnContext } from '@/lib/sheetCoordinator';

type Stage = 'full' | 'half' | 'peek';
const API_BASE = TRAILHEAD_API_BASE;

function boundedPlaceMediaUrl(value?: string | null) {
  const resolved = mediaUrl(value);
  return boundedExploreImageUrl(resolved, EXPLORE_IMAGE_BOUNDS.detail);
}

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
  display_type?: string;
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
  description?: string;
  details?: string;
  access_note?: string;
  registration_url?: string;
  start_date?: string;
  end_date?: string;
  price?: string;
  distance_mi?: number;
  route_distance_mi?: number;
  confidence?: string;
  rich_detail_available?: boolean;
  rich_detail_locked?: boolean;
  rich_detail_reason?: string;
  source_badge?: string;
  source_freshness?: string;
  photo_status?: string;
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
  display_type?: string;
  source?: string;
  source_label?: string;
  distance_mi?: number;
  route_distance_mi?: number;
  photo_url?: string | null;
  photo_status?: string;
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
    things_to_see?: RelatedItem[];
    visitor_centers?: RelatedItem[];
    campgrounds_nearby?: RelatedItem[];
    trip_services?: RelatedItem[];
    trails?: RelatedItem[];
    error?: string;
  };
  onBack?: () => void;
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
  communityRatingsEnabled?: boolean;
  canRate?: boolean;
  returnContext?: SheetReturnContext | null;
};

function titleCase(value?: string) {
  return (value || 'Place').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function titleCaseOrEmpty(value?: string | null) {
  const clean = String(value ?? '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  return clean.replace(/\b\w/g, c => c.toUpperCase());
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
  const metadata = place as any;
  if (
    metadata?.persistence_policy === 'temporary'
    || metadata?.temporary_use_only === true
    || metadata?._trailhead?.temporary_use_only === true
  ) {
    return true;
  }
  const source = String(place?.source || '').toLowerCase();
  return source === 'rendered_mapbox_standard' || source === 'mapbox_feature' || source === 'rendered_map' || source === 'mapbox_search';
}

function isBroadDestinationCard(place: PlaceLike | null | undefined) {
  const type = String(place?.type || '').toLowerCase().replace(/[\s-]+/g, '_');
  const subtype = String(place?.subtype || place?.display_type || '').toLowerCase().replace(/[\s-]+/g, '_');
  const source = String(place?.source || place?.source_label || '').toLowerCase();
  const broadTypes = new Set(['place', 'locality', 'city', 'town', 'village', 'hamlet', 'municipality', 'neighborhood', 'suburb', 'district', 'region']);
  if (broadTypes.has(type) || broadTypes.has(subtype)) return true;
  return source.includes('map search') && String(place?.name || '').includes(',');
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

function cleanDetailText(value?: string | null) {
  const clean = String(value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(
      /^Selected\s+([a-z\s_-]+)\s+with nearby camps, trails, scenic places, events, and trip services from open source data\.?$/i,
      (_, kind) => `Nearby camps, trails, scenic stops, events, and services around this ${String(kind || 'place').trim().toLowerCase()}.`,
    )
    .replace(/\s+/g, ' ')
    .trim();
  return /^selected\s+place\.?$/i.test(clean)
    ? 'Search nearby camps, trails, stays, fuel, and services from here.'
    : clean;
}

function cleanSourceFreshnessText(value?: string | null) {
  return cleanDetailText(value)
    .replace(/Official RIDB source data cached by Trailhead;?\s*/gi, 'Recreation.gov listing. ')
    .replace(/Official BLM recreation layer cached by Trailhead;?\s*/gi, 'BLM recreation listing. ')
    .replace(/Official\/open source data cached by Trailhead;?\s*/gi, 'Check current details before you go. ')
    .replace(/Camp source data cached by Trailhead;?\s*/gi, 'Check current camp details before you go. ')
    .replace(/OpenStreetMap\/Nominatim place identity cached by Trailhead;?\s*/gi, 'Local place details. ')
    .replace(/Wikipedia\/Wikimedia context cached by Trailhead;?\s*/gi, 'Reference details. ')
    .replace(/GeoNames\/Wikipedia context cached by Trailhead;?\s*/gi, 'Reference details. ')
    .replace(/Open town profile data cached by Trailhead;?\s*/gi, 'Town profile. ')
    .replace(/Check current local conditions with official sources\.?/gi, 'Check current access and conditions before you go.')
    .replace(/Check current local conditions with current local updates\.?/gi, 'Check current access and conditions before you go.')
    .replace(/Check current local conditions with local updates\.?/gi, 'Check current access and conditions before you go.')
    .replace(/Verify current local conditions before you go\.?/gi, 'Check current access and conditions before you go.')
    .replace(/Check current local conditions before you go\.?/gi, 'Check current access and conditions before you go.')
    .replace(/cached by Trailhead;?\s*/gi, '')
    .replace(/\bdownloaded source checked\b/gi, 'Checked')
    .replace(/\bsource data\b/gi, 'listing')
    .replace(/\bopen source data\b/gi, 'public information')
    .replace(/\bofficial sources\b/gi, 'current local updates')
    .replace(/Check current local conditions with current local updates\.?/gi, 'Check current access and conditions before you go.')
    .replace(/\bapi\b/gi, '')
    .replace(/\bendpoint\b/gi, '')
    .replace(/\bverify current\b/gi, 'Check current')
    .replace(/\bverify\b/gi, 'Check')
    .replace(/\.\s*check\b/g, '. Check')
    .replace(/\s+/g, ' ')
    .trim();
}

function ExpandableText({
  text,
  style,
  linkColor,
  previewChars = 460,
  previewLines = 6,
}: {
  text?: string | null;
  style: any;
  linkColor: string;
  previewChars?: number;
  previewLines?: number;
}) {
  const clean = cleanDetailText(text);
  const [expanded, setExpanded] = useState(false);
  if (!clean) return null;
  const shouldClamp = clean.length > previewChars;
  const preview = shouldClamp && !expanded ? clean.slice(0, previewChars).replace(/\s+\S*$/, '').trim() : clean;
  return (
    <View>
      <Text style={style}>{preview}</Text>
      {shouldClamp ? (
        <TouchableOpacity style={{ alignSelf: 'flex-start', marginTop: 6 }} onPress={() => setExpanded(value => !value)} activeOpacity={0.78}>
          <Text style={{ color: linkColor, fontSize: 11, fontFamily: mono, fontWeight: '900' }}>{expanded ? 'Less' : 'More'}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
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

function formatSheetMiles(mi?: number | null) {
  if (mi == null || !Number.isFinite(Number(mi))) return '';
  const value = Number(mi);
  if (value <= 0) return '';
  if (value < 1) return 'Under 1 mi';
  if (value >= 10) return `${Math.round(value)} mi`;
  const rounded = Number(value.toFixed(1));
  return `${Number.isInteger(rounded) ? Math.round(rounded) : rounded} mi`;
}

function itemMeta(item: RelatedItem) {
  const distance = item.route_distance_mi ?? item.distance_mi;
  const label = cleanExploreSourceLabel(item.source_label || item.display_type, titleCase(item.subtype || item.type));
  return [
    item.length_mi != null ? `${formatSheetMiles(item.length_mi)} trail` : label,
    formatSheetMiles(distance),
  ].filter(Boolean).join(' · ');
}

export default function PremiumPlaceSheet({
  place,
  visible = !!place,
  initialStage = 'full',
  related,
  onBack,
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
  communityRatingsEnabled = false,
  canRate = false,
  returnContext,
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
  const [failedPhotoUrls, setFailedPhotoUrls] = useState<string[]>([]);
  const dragY = useRef(new Animated.Value(0)).current;
  const contentScrollRef = useRef<ScrollView>(null);
  const transientPlace = place ? isTransientMapboxPlace(place) : false;
  const sheetModel = useMemo(
    () => adaptGenericPlaceSheet(place ?? { name: 'Place', type: 'place' }),
    [place?.id, place?.place_id, place?.provider_place_id, place?.name, place?.lat, place?.lng, place?.type, place?.subtype, place?.source_label],
  );
  const ratingTarget = useMemo(() => communityRatingTarget({
    enabled: communityRatingsEnabled,
    signedIn: canRate,
    kind: sheetModel.identity.kind,
    canonicalEntityId: canonical?.trailhead_place_id,
    source: place?.source || place?.source_label,
    type: place?.type,
    persistencePolicy: (place as any)?.persistence_policy,
    temporaryUseOnly: transientPlace,
  }), [
    canRate,
    canonical?.trailhead_place_id,
    communityRatingsEnabled,
    place?.source,
    place?.source_label,
    place?.type,
    (place as any)?.persistence_policy,
    sheetModel.identity.kind,
    transientPlace,
  ]);

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
    setFailedPhotoUrls([]);
    setLoading(false);
    contentScrollRef.current?.scrollTo({ y: 0, animated: false });
    if (transientPlace) return;
    let canonicalCancelled = false;
    api.canonicalizePlace(canonicalPayload(place))
      .then(({ place: canonicalPlace }) => {
        if (canonicalCancelled) return;
        setCanonical(canonicalPlace);
        setComments(canonicalPlace.comments ?? []);
        if (classifyRelatedPlaceSheetKind(place) === 'camp') {
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
  }, [place?.id, place?.name, place?.lat, place?.lng, initialStage, transientPlace]);

  const data = detail ?? place;
  const actionEntityKind = inferSheetActionEntityKindV1(data ?? {}, sheetModel.identity.kind);
  const sheetActions = resolveSheetActionDescriptorsV1({
    entityKind: actionEntityKind,
    capabilities: {
      coordinates: Boolean(data && Number.isFinite(data.lat) && Number.isFinite(data.lng)),
      savable: Boolean(onSave && !transientPlace),
      trip_edit: Boolean(onAddToRoute && !transientPlace),
      official_url: Boolean(data?.official_url || data?.website),
      booking_url: Boolean(data?.registration_url || data?.booking_url),
      phone_number: Boolean(data?.phone),
      shareable: Boolean(data),
      comments: Boolean(canonical && !transientPlace),
      ratings: Boolean(ratingTarget),
      reporting: Boolean(onReport && !transientPlace),
      suggest_edit: Boolean(!transientPlace),
    },
    returnContext,
  });
  const sheetAction = (id: SheetActionIdV1) => {
    const action = sheetActionByIdV1(sheetActions, id);
    return action?.available ? action : undefined;
  };
  const maxFull = Math.min(height * 0.84, height - Math.max(insets.top + 22, 54));
  const stageHeight = stage === 'full'
    ? maxFull
    : stage === 'half'
      ? Math.max(260, Math.min(height * 0.38, 360))
      : Math.max(78, insets.bottom + 70);

  useEffect(() => {
    if (!visible || !place) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (galleryIndex !== null) {
        setGalleryIndex(null);
        return true;
      }
      if (showCommentForm) {
        setShowCommentForm(false);
        return true;
      }
      if (showEditForm) {
        setShowEditForm(false);
        return true;
      }
      if (onBack) {
        onBack();
        return true;
      }
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [
    galleryIndex,
    onBack,
    onClose,
    place?.id,
    showCommentForm,
    showEditForm,
    visible,
  ]);

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
  const sharePlace = () => {
    const location = Number.isFinite(data.lat) && Number.isFinite(data.lng)
      ? `\n${data.lat.toFixed(5)}, ${data.lng.toFixed(5)}`
      : '';
    Share.share({ message: `${data.name}${location}` }).catch(() => {});
  };
  const richDetailLocked = (hasPaidProviderSource(place) || !!place.rich_detail_locked) && !detail;

  const officialPhotos: TrailheadGalleryPhoto[] = detail?.photos?.length
    ? detail.photos.map(photo => ({ ...photo, url: boundedPlaceMediaUrl(photo.url) }))
    : data.photos?.length
      ? data.photos.map(photo => ({ ...photo, url: boundedPlaceMediaUrl(photo.url) }))
    : data.photo_url
      ? [{ url: boundedPlaceMediaUrl(data.photo_url), source: data.source_label || data.source || '' }]
      : [];
  const mapboxPhotos: TrailheadGalleryPhoto[] = [
    data.primary_image,
    ...(data.other_images ?? []),
  ]
    .map(url => boundedPlaceMediaUrl(url))
    .filter(Boolean)
    .map((url, idx) => ({ id: -1000 - idx, url, source: data.source_label || data.enrichment_source || 'Mapbox' }));
  const canonicalHero: TrailheadGalleryPhoto[] = canonical?.hero_photo_url
    ? [{ url: boundedPlaceMediaUrl(canonical.hero_photo_url), source: canonical.hero_photo_source === 'community' ? 'Trailhead community' : canonical.source_label || canonical.source }]
    : [];
  const userPhotos: TrailheadGalleryPhoto[] = (canonical?.photos ?? [])
    .map(photo => ({ url: boundedPlaceMediaUrl(photo.url), caption: photo.caption || undefined, source: photo.username ? `Trailhead photo by ${photo.username}` : 'Trailhead community' }))
    .filter(photo => !!photo.url);
  const photos = officialPhotos.length || mapboxPhotos.length
    ? [...officialPhotos, ...mapboxPhotos.filter(photo => !officialPhotos.some(existing => existing.url === photo.url)), ...userPhotos.filter(photo => ![...officialPhotos, ...mapboxPhotos].some(existing => existing.url === photo.url))]
    : canonicalHero.length
      ? [...canonicalHero, ...userPhotos.filter(photo => photo.url !== canonicalHero[0].url)]
      : userPhotos;
  const reviews = (detail?.reviews ?? []).filter(review => !['google', 'foursquare'].includes(String(review.source || '').toLowerCase()));
  const broadDestination = isBroadDestinationCard(data);
  const relatedThingsToSee = uniqueRelatedPlaces((related?.things_to_see ?? []).filter(relatedThingToSeeCanShow));
  const relatedThingsToSeeNames = new Set(relatedThingsToSee.map(relatedPlaceNameKey).filter(Boolean));
  const relatedThingsToDo = uniqueRelatedPlaces((related?.things_to_do ?? related?.places ?? [])
    .filter(relatedThingToDoCanShow)
    .filter(item => !relatedThingsToSeeNames.has(relatedPlaceNameKey(item))));
  const relatedVisitorCenters = uniqueRelatedPlaces((related?.visitor_centers ?? []).filter(relatedPlaceCanShow));
  const relatedCampgrounds = related?.campgrounds_nearby ?? related?.camps ?? [];
  const relatedTrails = uniqueRelatedPlaces((related?.trails ?? []).filter(relatedTrailCanShow))
    .filter((item, index, items) => {
      const name = relatedPlaceNameKey(item);
      if (!name) return true;
      return items.findIndex(candidate => relatedPlaceNameKey(candidate) === name) === index;
    });
  const relatedTripServices = related?.trip_services ?? [];
  const relatedHasContext = !!(
    related?.loading ||
    relatedThingsToDo.length ||
    relatedThingsToSee.length ||
    relatedVisitorCenters.length ||
    relatedCampgrounds.length ||
    relatedTrails.length ||
    relatedTripServices.length ||
    related?.error
  );
  const visiblePhotos = photos.filter(photo => !!photo.url && !failedPhotoUrls.includes(photo.url));
  // A related-place photo must never represent the selected place. If this
  // entity has no licensed, bounded media of its own, retain the text-first
  // sheet instead of showing a plausible-but-wrong hero.
  const hero = visiblePhotos[0]?.url || '';
  const markPhotoFailed = (url?: string | null) => {
    if (!url) return;
    setFailedPhotoUrls(prev => prev.includes(url) ? prev : [...prev, url]);
  };
  const typeLabel = cleanPlaceSheetDisplayText(data.display_type) || titleCaseOrEmpty(data.subtype || data.type) || 'Place';
  const sourceLabel = cleanExploreSourceLabel(data.source_label || data.attribution || data.source, typeLabel);
  const sourceFooterLabel = cleanExploreSourceLabel(data.source_label || data.attribution || data.source, '');
  const footerSourceKey = sourceFooterLabel.toLowerCase();
  const meaningfulSourceFooterLabel = !sourceFooterLabel || footerSourceKey === typeLabel.toLowerCase() || /^(place|places|city|town|region|neighborhood)$/i.test(sourceFooterLabel)
    ? ''
    : sourceFooterLabel;
  const addToRoute = () => onAddToRoute?.({ name: place.name, lat: place.lat, lng: place.lng, note: data.summary || subtitle });
  const promoteToRoute = () => onPromoteToRoute?.({ name: place.name, lat: place.lat, lng: place.lng, note: data.summary || subtitle });
  const distanceLabel = formatPlaceSheetDistanceLabel(
    data.route_distance_mi,
    data.distance_mi,
  );
  const ratingCount = Number(data.rating_count ?? data.review_count);
  const subtitle = [
    data.brand || typeLabel,
    distanceLabel,
    data.rating || data.average_rating ? [Number(data.rating ?? data.average_rating).toFixed(1), Number.isFinite(ratingCount) && ratingCount > 0 ? `(${ratingCount})` : ''].filter(Boolean).join(' ') : '',
    openNowLabel(data.open_now),
  ].filter(Boolean).join(' · ');
  const sourceFooterParts = [
    meaningfulSourceFooterLabel,
    visiblePhotos[0]?.credit ? `Photo: ${visiblePhotos[0].credit}` : '',
  ].filter(Boolean);
  const hours = detail?.hours?.length ? detail.hours : data.hours?.length ? data.hours : normalizeHours(data.open_hours, data.hours_label);
  const sourceFreshness = cleanSourceFreshnessText(data.source_freshness || (data.last_checked ? `Checked ${new Date(Number(data.last_checked) * 1000).toLocaleDateString()}. Check current access before you go.` : ''))
    .replace(/Check current local conditions with current local updates\.?/gi, 'Check current access and conditions before you go.');
  const providerDetails = cleanDetailText(data.description || data.details);
  const summaryText = cleanDetailText(data.summary);
  const showProviderDetails = providerDetails && providerDetails !== summaryText;
  const showSummaryText = summaryText && (stage !== 'full' || !isPlaceSheetSummaryRedundant(summaryText, providerDetails));
  const eventFacts = [
    data.start_date ? ['Date', data.end_date && data.end_date !== data.start_date ? `${data.start_date} to ${data.end_date}` : data.start_date] : null,
    data.price ? ['Price', String(data.price)] : null,
  ].filter(Boolean) as [string, string][];
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
      if (res.alert) {
        setReservation(prev => prev ? { ...prev, alerts: [res.alert!, ...(prev.alerts ?? []).filter(a => a.id !== res.alert!.id)] } : prev);
      }
      if (res.monitor) {
        const billing = res.monitor.billing_kind;
        const detail = billing === 'trial'
          ? 'Your seven-day availability watch is active.'
          : billing === 'explorer'
            ? 'This availability watch is included with Explorer for 30 days.'
            : billing === 'credits'
              ? `${res.monitor.credits_charged} credits were used for a 30-day availability watch.`
              : `Your availability watch is active for ${res.monitor.duration_days} days.`;
        Alert.alert('Availability watch active', detail);
      } else {
        Alert.alert('Availability alert saved', 'Trailhead will keep this campground in your booking alerts.');
      }
    } catch (err: any) {
      if (err instanceof PaywallError && err.code === 'availability_monitor_credits') {
        Alert.alert('50 credits needed', 'Add credits in Profile to start another 30-day availability watch.');
      } else {
        Alert.alert('Could not start watch', err?.status === 401 || err?.status === 403 ? 'Sign in to watch availability.' : (err?.message ?? 'Try again in a moment.'));
      }
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
        <PlaceSheetShell model={sheetModel}>
          <View {...pan.panHandlers}>
            <PlaceSheetShellHeader
              model={{ ...sheetModel, subtitle: subtitle || data.display_type || sourceLabel }}
              loading={loading}
              onToggleStage={cycleStage}
              onBack={onBack}
              onClose={onClose}
            />
          </View>

        {stage !== 'peek' && (
          <ScrollView
            ref={contentScrollRef}
            style={s.contentScroll}
            showsVerticalScrollIndicator={false}
            scrollEnabled={stage === 'full'}
            contentContainerStyle={[s.content, addToRoutePrimary && !!onAddToRoute && !transientPlace && s.contentWithStickyAction]}
            testID={`${sheetModel.testID}-content`}
          >
            {hero ? (
              <TouchableOpacity style={s.hero} activeOpacity={0.9} onPress={() => setGalleryIndex(0)}>
                <Image source={exploreImageSource(hero)} style={s.heroImage} resizeMode="cover" resizeMethod="resize" onError={() => markPhotoFailed(hero)} />
                <View style={s.heroShade} />
                <PlaceSheetHeroChrome model={{ ...sheetModel, title: data.name, subtitle: typeLabel }} />
              </TouchableOpacity>
            ) : null}

            <View style={s.body}>
              {!!routeContextLabel && (
                <View style={s.routeContextPill}>
                  <Ionicons name="git-branch-outline" size={13} color={C.orange} />
                  <Text style={s.routeContextText}>{routeContextLabel}</Text>
                </View>
              )}
              {!!data.address && (
                <View style={s.infoRow}>
                  <Ionicons name="location-outline" size={15} color={C.text3} />
                  <Text style={s.infoText}>{data.address}</Text>
                </View>
              )}
              {!!showSummaryText && (
                <ExpandableText
                  text={summaryText}
                  style={s.summaryText}
                  linkColor={C.orange}
                  previewLines={stage === 'full' ? 6 : 3}
                  previewChars={stage === 'full' ? 520 : 260}
                />
              )}
              {stage === 'full' && eventFacts.map(([label, value]) => (
                <View key={label} style={s.infoRow}>
                  <Ionicons name={label === 'Price' ? 'cash-outline' : 'calendar-outline'} size={15} color={C.text3} />
                  <Text style={s.infoText}>{label}: {value}</Text>
                </View>
              ))}
              {stage === 'full' && !!showProviderDetails && (
                <View style={s.section}>
                  <Text style={s.sectionLabel}>Details</Text>
                  <ExpandableText text={providerDetails} style={s.sectionText} linkColor={C.orange} previewChars={720} previewLines={7} />
                </View>
              )}
              {!!data.access_note && (
                <View style={s.infoRow}>
                  <Ionicons name="alert-circle-outline" size={15} color={C.orange} />
                  <Text style={s.infoText}>{data.access_note}</Text>
                </View>
              )}
              {stage === 'full' && waterFacts.length > 0 ? (
                <View style={s.section}>
                  <Text style={s.sectionLabel}>Water access</Text>
                  {waterFacts.map(([label, value]) => (
                    <View key={label} style={s.infoRow}>
                      <Ionicons name={label === 'Fishing evidence' || label === 'Species' ? 'fish-outline' : label === 'Craft' || label === 'Navigation feature' ? 'boat-outline' : label === 'Hazard' ? 'warning-outline' : label === 'Depth' ? 'analytics-outline' : 'water-outline'} size={15} color={C.text3} />
                      <Text style={s.infoText}>{label}: {value}</Text>
                    </View>
                  ))}
                  {!!data.navigation_note && (
                    <View style={s.infoRow}>
                      <Ionicons name="warning-outline" size={15} color={C.orange} />
                      <Text style={s.infoText}>{data.navigation_note}</Text>
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
                  <Text style={s.infoText}>{sourceFreshness}</Text>
                </View>
              )}
              {stage === 'full' && relatedHasContext ? (
                <View style={s.relatedBlock}>
                  <View style={s.relatedHeader}>
                    <Text style={s.sectionLabel}>Nearby</Text>
                    {related?.loading ? <ActivityIndicator color={C.orange} size="small" /> : null}
                  </View>
                  {related?.loading ? (
                    <View style={s.relatedLoadingBody}>
                      <TrailheadLoadingRow
                        label="Loading nearby"
                        sub="Camps, trails and services."
                        icon="location-outline"
                      />
                      <TrailheadRailSkeleton count={3} cardWidth={174} />
                    </View>
                  ) : null}
                  {!!related?.error && !related?.loading && (
                    <Text style={s.sectionText}>{related.error}</Text>
                  )}
                  {broadDestination ? (
                    <>
                      <RelatedRail testIDPrefix={sheetModel.testID} title="Things to see" items={relatedThingsToSee.slice(0, 8)} onPress={onOpenRelatedPlace} C={C} styles={s} />
                      <RelatedRail testIDPrefix={sheetModel.testID} title="Visitor centers" items={relatedVisitorCenters.slice(0, 8)} onPress={onOpenRelatedPlace} C={C} styles={s} />
                      <RelatedRail testIDPrefix={sheetModel.testID} title="Things to do" items={relatedThingsToDo.slice(0, 8)} onPress={onOpenRelatedPlace} C={C} styles={s} />
                    </>
                  ) : (
                    <>
                      <RelatedRail testIDPrefix={sheetModel.testID} title="Things to do" items={relatedThingsToDo.slice(0, 8)} onPress={onOpenRelatedPlace} C={C} styles={s} />
                      <RelatedRail testIDPrefix={sheetModel.testID} title="Things to see" items={relatedThingsToSee.slice(0, 8)} onPress={onOpenRelatedPlace} C={C} styles={s} />
                      <RelatedRail testIDPrefix={sheetModel.testID} title="Visitor centers" items={relatedVisitorCenters.slice(0, 8)} onPress={onOpenRelatedPlace} C={C} styles={s} />
                    </>
                  )}
                  <RelatedRail testIDPrefix={sheetModel.testID} title="Campgrounds nearby" items={relatedCampgrounds.slice(0, 8)} onPress={onOpenRelatedCamp} C={C} styles={s} />
                  <RelatedRail testIDPrefix={sheetModel.testID} title="Trails" items={relatedTrails.slice(0, 8)} onPress={onOpenRelatedTrail} C={C} styles={s} />
                  <RelatedRail testIDPrefix={sheetModel.testID} title="Trip services" items={relatedTripServices.slice(0, 8)} onPress={onOpenRelatedPlace} C={C} styles={s} />
                </View>
              ) : null}
              {stage === 'full' && !!hours.length && (
                <View style={s.section}>
                  <Text style={s.sectionLabel}>Hours</Text>
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
                      <Text style={s.richLockedText}>Photos, contact details, and weekly hours.</Text>
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
                {addToRoutePrimary && !!onAddToRoute && !transientPlace ? (
                  <>
                    <TrailheadButton
                      testID={sheetActionTestIDV1(sheetModel.testID, 'add_to_trip')}
                      label={addToRouteLabel || sheetAction('add_to_trip')?.label || 'Add to trip'}
                      icon="add-circle-outline"
                      variant="primary"
                      onPress={addToRoute}
                      style={{ flex: 1 }}
                    />
                    <TouchableOpacity
                      testID={sheetActionTestIDV1(sheetModel.testID, 'navigate')}
                      style={s.secondaryBtn}
                      onPress={() => onNavigate(place)}
                    >
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
                    testID={sheetActionTestIDV1(sheetModel.testID, 'navigate')}
                    label={sheetAction('navigate')?.label || 'Navigate'}
                    icon="navigate"
                    variant="primary"
                    onPress={() => onNavigate(place)}
                    style={{ flex: 1 }}
                  />
                )}
                {!!data.phone && (
                  <TouchableOpacity
                    testID={sheetActionTestIDV1(sheetModel.testID, 'phone')}
                    style={s.secondaryBtn}
                    onPress={() => Linking.openURL(`tel:${data.phone}`)}
                  >
                    <Ionicons name="call-outline" size={15} color={C.text2} />
                  </TouchableOpacity>
                )}
                {!!(data.registration_url || data.booking_url || data.official_url || data.website) && (
                  <TouchableOpacity
                    testID={sheetActionTestIDV1(
                      sheetModel.testID,
                      data.registration_url || data.booking_url ? 'booking' : 'official_website',
                    )}
                    style={s.secondaryBtn}
                    onPress={() => Linking.openURL(String(data.registration_url || data.booking_url || data.official_url || data.website))}
                  >
                    <Ionicons name="globe-outline" size={15} color={C.text2} />
                  </TouchableOpacity>
                )}
                {!!onSave && !transientPlace && (
                  <TouchableOpacity
                    testID={sheetActionTestIDV1(sheetModel.testID, 'save')}
                    style={s.secondaryBtn}
                    onPress={() => onSave({ name: place.name, lat: place.lat, lng: place.lng, note: subtitle })}
                  >
                    <Ionicons name="bookmark-outline" size={15} color={C.text2} />
                  </TouchableOpacity>
                )}
                {!!onAddToRoute && !addToRoutePrimary && !transientPlace && (
                  <TouchableOpacity
                    testID={sheetActionTestIDV1(sheetModel.testID, 'add_to_trip')}
                    style={s.secondaryBtn}
                    onPress={addToRoute}
                  >
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
                  {!!onReport && !transientPlace && (
                    <TouchableOpacity
                      testID={sheetActionTestIDV1(sheetModel.testID, 'report')}
                      style={s.linkBtn}
                      onPress={onReport}
                    >
                      <Ionicons name="warning-outline" size={14} color={C.orange} />
                      <Text style={[s.linkText, { color: C.orange }]}>{sheetAction('report')?.label || 'Report'}</Text>
                    </TouchableOpacity>
                  )}
                  {!!sheetAction('share') && (
                    <TouchableOpacity
                      testID={sheetActionTestIDV1(sheetModel.testID, 'share')}
                      style={s.linkBtn}
                      onPress={sharePlace}
                    >
                      <Ionicons name="share-outline" size={14} color={C.text2} />
                      <Text style={s.linkText}>{sheetAction('share')?.label}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {stage === 'full' && reservation && (reservation.reservable || reservation.booking_url) ? (
                <View style={s.communityBlock}>
                  <View style={s.communityHeader}>
                    <Text style={s.sectionLabel}>Reservations</Text>
                    <Text style={s.communityCount}>{cleanExploreSourceLabel(reservation.source_label, 'Booking')}</Text>
                  </View>
                  <Text style={s.sectionText}>{cleanSourceFreshnessText(reservation.notes || reservation.source_freshness)}</Text>
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
                        <Text style={s.smallPrimaryText}>{reservation.link_label || 'Check availability'}</Text>
                      </TouchableOpacity>
                    )}
                    {reservation.alert_supported ? (
                      <TouchableOpacity style={s.smallSecondaryBtn} onPress={saveAvailabilityAlert} disabled={communityBusy}>
                        <Ionicons name="notifications-outline" size={13} color={C.orange} />
                        <Text style={s.smallSecondaryText}>Watch openings</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              ) : null}

              {stage === 'full' ? (
                <FirstPartyRatingSection
                  target={ratingTarget}
                  testID={sheetActionTestIDV1(sheetModel.testID, 'rating')}
                />
              ) : null}

              {stage === 'full' && !transientPlace && (
                <View
                  testID={sheetActionTestIDV1(sheetModel.testID, 'comments')}
                  style={s.communityBlock}
                >
                  <View style={s.communityHeader}>
                    <Text style={s.sectionLabel}>Community notes</Text>
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
                            <Image key={photo.id} source={exploreImageSource(boundedPlaceMediaUrl(photo.url))} style={s.inlinePhoto} resizeMode="cover" resizeMethod="resize" />
                          ))}
                        </ScrollView>
                      )}
                    </View>
                  ))}
                  {!comments.length && !showCommentForm ? <Text style={s.sectionText}>Ask a question or leave a recent access note.</Text> : null}
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
                        <Ionicons name={commentPhoto ? 'checkmark-circle-outline' : 'camera-outline'} size={14} color={commentPhoto ? C.orange : C.text3} />
                        <Text style={[s.photoAttachText, commentPhoto && { color: C.orange }]}>{commentPhoto ? 'Photo attached (+5 credits)' : 'Add photo (+5 credits)'}</Text>
                      </TouchableOpacity>
                      <View style={s.inlineActions}>
                        <TouchableOpacity style={s.smallSecondaryBtn} onPress={() => { setShowCommentForm(false); setCommentText(''); setCommentPhoto(null); }}>
                          <Text style={s.smallSecondaryText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[s.smallPrimaryBtn, (commentText.trim().length < 2 || communityBusy) && { opacity: 0.55 }]} onPress={submitComment} disabled={commentText.trim().length < 2 || communityBusy}>
                          {communityBusy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.smallPrimaryText}>Post</Text>}
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

              {stage === 'full' && !transientPlace && (
                <View
                  testID={sheetActionTestIDV1(sheetModel.testID, 'suggest_edit')}
                  style={s.communityBlock}
                >
                  <View style={s.communityHeader}>
                    <Text style={s.sectionLabel}>Suggest an edit</Text>
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
                          <Text style={s.smallSecondaryText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[s.smallPrimaryBtn, (editValue.trim().length < 2 || communityBusy) && { opacity: 0.55 }]} onPress={submitEdit} disabled={editValue.trim().length < 2 || communityBusy}>
                          {communityBusy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.smallPrimaryText}>Send edit</Text>}
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <TouchableOpacity
                      testID={`${sheetActionTestIDV1(sheetModel.testID, 'suggest_edit')}-open`}
                      style={s.linkBtn}
                      onPress={() => setShowEditForm(true)}
                    >
                      <Ionicons name="create-outline" size={14} color={C.text2} />
                      <Text style={s.linkText}>{sheetAction('suggest_edit')?.label || 'Suggest edit'}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {stage === 'full' && visiblePhotos.length > 1 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.photoRail}>
                  {visiblePhotos.slice(1, 7).map((photo, idx) => (
                    <TouchableOpacity key={`${photo.url}-${idx}`} activeOpacity={0.86} onPress={() => setGalleryIndex(idx + 1)}>
                      <Image source={exploreImageSource(photo.url)} style={s.railPhoto} resizeMode="cover" resizeMethod="resize" onError={() => markPhotoFailed(photo.url)} />
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}

              {stage === 'full' && !!detail && (
                <View style={s.section}>
                  <Text style={s.sectionLabel}>Notes</Text>
                  {reviews.length ? reviews.slice(0, 3).map((review, idx) => (
                    <View key={`${review.authorName}-${idx}`} style={s.reviewCard}>
                      <View style={s.reviewTop}>
                        <Text style={s.reviewAuthor} numberOfLines={1}>{review.authorName || 'Trailhead user'}</Text>
                        <Text style={s.reviewRating}>{review.rating ? `${review.rating}/5` : 'Trailhead'}</Text>
                      </View>
                      {!!review.relativeTime && <Text style={s.reviewMeta}>{review.relativeTime}</Text>}
                      {!!review.text && <Text style={s.reviewText}>{review.text}</Text>}
                    </View>
                  )) : <Text style={s.sectionText}>No notes yet — be the first to add one.</Text>}
                </View>
              )}

              {sourceFooterParts.length ? (
                <View style={s.sourceFooter}>
                  <Text style={s.sourceText}>{sourceFooterParts.join(' · ')}</Text>
                </View>
              ) : null}
            </View>
          </ScrollView>
        )}
        {stage !== 'peek' && addToRoutePrimary && !!onAddToRoute && !transientPlace && (
          <TrailheadButtonDock style={[s.stickyRouteAction, { paddingBottom: Math.max(insets.bottom, 10) }]}>
            <TrailheadButton
              testID={sheetActionTestIDV1(sheetModel.testID, 'add_to_trip')}
              label={addToRouteLabel || sheetAction('add_to_trip')?.label || 'Add to trip'}
              icon="add-circle-outline"
              variant="primary"
              onPress={addToRoute}
              style={{ flex: 1 }}
            />
            <TouchableOpacity
              testID={sheetActionTestIDV1(sheetModel.testID, 'navigate')}
              style={s.secondaryBtn}
              onPress={() => onNavigate(place)}
            >
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
        </PlaceSheetShell>
      </TrailheadSheet>
      <TrailheadPhotoGallery
        visible={galleryIndex !== null}
        photos={visiblePhotos}
        initialIndex={galleryIndex ?? 0}
        title={data.name}
        onClose={() => setGalleryIndex(null)}
      />
    </Animated.View>
  );
}

function RelatedRail({
  testIDPrefix,
  title,
  items,
  onPress,
  C,
  styles,
}: {
  testIDPrefix: string;
  title: string;
  items: RelatedItem[];
  onPress?: (item: RelatedItem) => void;
  C: ColorPalette;
  styles: ReturnType<typeof makeStyles>;
}) {
  if (!items.length) return null;
  const railTestID = `${testIDPrefix}-related.${relatedTestIDPart(title)}`;
  return (
    <View style={styles.relatedSection} testID={railTestID}>
      <Text style={styles.relatedTitle}>{title}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.relatedRail}>
        {items.map((item, idx) => (
          <TouchableOpacity
            key={`${item.id || item.name || title}-${idx}`}
            testID={`${railTestID}.item.${relatedTestIDPart(item.id || item.name || idx)}`}
            accessibilityLabel={item.name || titleCase(item.type)}
            style={styles.relatedCard}
            activeOpacity={0.86}
            onPress={() => onPress?.(item)}
          >
            {item.photo_url ? (
              <Image source={exploreImageSource(boundedPlaceMediaUrl(item.photo_url))} style={styles.relatedPhoto} resizeMode="cover" resizeMethod="resize" />
            ) : (
              <View style={styles.relatedIcon}>
                <Ionicons name={itemIcon(item.type)} size={17} color={C.orange} />
              </View>
            )}
            <Text style={styles.relatedName}>{item.name || titleCase(item.type)}</Text>
            <Text style={styles.relatedMeta}>{itemMeta(item)}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

function relatedTestIDPart(value: unknown) {
  return String(value || 'item')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || 'item';
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
  // TrailheadSheet wraps content in an inner View. Both that wrapper and the
  // body scroller need a bounded flex height; otherwise React Native can
  // measure the flexing PlaceSheetShell at header height and collapse the
  // result body to zero (the visible symptom is a titled, entirely blank
  // sheet after selecting a Search V2 row).
  sheetContent: { padding: 0, flex: 1, minHeight: 0 },
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
  contentScroll: { flex: 1, minHeight: 0 },
  content: { paddingBottom: 22 },
  contentWithStickyAction: { paddingBottom: 102 },
  hero: { height: 164, marginHorizontal: 12, borderRadius: 22, overflow: 'hidden', backgroundColor: C.s2 },
  heroImage: { width: '100%', height: '100%' },
  heroFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.glassStrong },
  heroShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.22)' },
  heroText: { position: 'absolute', left: 16, right: 16, bottom: 14 },
  kicker: { color: '#fff', fontSize: 9, fontFamily: mono, fontWeight: '900', letterSpacing: 0, opacity: 0.88 },
  title: { color: '#fff', fontSize: 23, lineHeight: 27, fontWeight: '900', marginTop: 4 },
  body: { padding: 14, gap: 10 },
  meta: { color: C.text2, fontSize: 12, fontFamily: mono, fontWeight: '700' },
  routeContextPill: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, borderWidth: 1, borderColor: C.orange + '45', backgroundColor: C.orange + '10', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8 },
  routeContextText: { flex: 1, color: C.orange, fontSize: 11, lineHeight: 15, fontFamily: mono, fontWeight: '800' },
  summaryText: { color: C.text2, fontSize: 13, lineHeight: 19 },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  infoText: { flex: 1, color: C.text2, fontSize: 13, lineHeight: 19 },
  section: { marginTop: 4, borderTopWidth: 1, borderColor: C.border, paddingTop: 10 },
  sectionLabel: { color: C.text3, fontSize: 10, fontFamily: mono, fontWeight: '900', letterSpacing: 0, marginBottom: 5 },
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
  relatedLoadingBody: { gap: 10 },
  relatedSection: { gap: 7 },
  relatedTitle: { color: C.text3, fontSize: 10, fontFamily: mono, letterSpacing: 0, fontWeight: '900' },
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
