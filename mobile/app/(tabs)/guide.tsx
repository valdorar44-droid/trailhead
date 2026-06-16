import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator,
  Image, Modal, Linking, useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import TourTarget from '@/components/TourTarget';
import PaywallModal from '@/components/PaywallModal';
import PremiumPlaceSheet from '@/components/PremiumPlaceSheet';
import { TrailheadButton, TrailheadCard } from '@/components/TrailheadUI';
import {
  EXPLORE_CATEGORY_CHIPS,
  ExploreCategoryChips,
  ExploreDetailSheet,
  ExploreFilterRow,
  ExploreHero,
  ExploreModeTabs,
  ExplorePlaceCard,
  exploreCategoryFromQuery,
  exploreCategoryMatches,
  exploreQueryScore as scoreExploreQuery,
  exploreTrustScore as scoreExploreTrust,
  getExploreCategoryKey,
  mergeCuratedExplorePlaces,
  type ExploreCategoryKey,
  type ExploreDetailTab,
  type ExploreNearbyModule,
} from '@/components/explore';
import { useStore } from '@/lib/store';
import { api, PaywallError, type CampsitePin, type ExplorePlaceProfile, type ExploreTrailCard, type OsmPoi } from '@/lib/api';
import { storage } from '@/lib/storage';
import { useTheme, mono, ColorPalette } from '@/lib/design';
import { trackPhase0Once } from '@/lib/telemetry';
import { playTrailheadVoice, stopTrailheadVoice } from '@/lib/voice';

const EXPLORE_CACHE_KEY = 'trailhead_explore_catalog_v2';
const EXPLORE_CAMPGROUNDS_CACHE_PREFIX = 'trailhead_explore_campgrounds_v1:';
const EXPLORE_TRAIL_AREA_CACHE_PREFIX = 'trailhead_explore_trail_area_v1:';
const SAVED_EXPLORE_KEY = 'trailhead_saved_explore_places_v1';
const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.gettrailhead.app';

type ExploreSortMode = 'best' | 'nearest' | 'source';

const EXPLORE_SORT_LABELS: Record<ExploreSortMode, string> = {
  best: 'Best match',
  nearest: 'Nearest',
  source: 'Source quality',
};

const WMO_ICON: Record<number, keyof typeof Ionicons.glyphMap> = {
  0: 'sunny-outline', 1: 'partly-sunny-outline', 2: 'partly-sunny-outline', 3: 'cloud-outline',
  45: 'cloud-outline', 48: 'cloud-outline',
  51: 'rainy-outline', 53: 'rainy-outline', 55: 'rainy-outline',
  61: 'rainy-outline', 63: 'rainy-outline', 65: 'rainy-outline',
  71: 'snow-outline', 73: 'snow-outline', 75: 'snow-outline',
  80: 'rainy-outline', 81: 'rainy-outline', 82: 'rainy-outline',
  85: 'snow-outline', 86: 'snow-outline',
  95: 'thunderstorm-outline', 96: 'thunderstorm-outline', 99: 'thunderstorm-outline',
};

function wmoIcon(code: number) {
  const keys = Object.keys(WMO_ICON).map(Number).sort((a, b) => b - a);
  for (const k of keys) { if (code >= k) return WMO_ICON[k]; }
  return 'thermometer-outline';
}

function reversePlaceLabel(place?: any): string {
  if (!place) return '';
  const street = [place.name, place.street].filter(Boolean).join(' ').trim();
  const town = place.city || place.district || place.subregion;
  return [street, town, place.region, place.postalCode, place.country]
    .filter(Boolean)
    .filter((part, idx, arr) => arr.indexOf(part) === idx)
    .join(', ');
}

function distMi(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const la1 = a.lat * Math.PI / 180;
  const la2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

function fmtMi(mi?: number | null) {
  if (mi == null || !Number.isFinite(mi)) return '';
  return mi >= 10 ? `${Math.round(mi)} mi` : `${mi.toFixed(1)} mi`;
}

function groupForExplorePlace(place: ExplorePlaceProfile) {
  const key = getExploreCategoryKey(place);
  if (key === 'camp') return 'camping';
  if (key === 'glamping') return 'glamping';
  if (key === 'huts') return 'huts_lodging';
  if (['trails', 'trailheads', 'climb'].includes(key)) return 'trails';
  if (['water', 'waterfalls', 'springs', 'views', 'peaks', 'scenic'].includes(key)) return 'water';
  if (['fuel', 'resupply'].includes(key)) return 'services';
  if (key === 'land') return 'parks';
  const group = place.summary.explore_group;
  if (group === 'water_scenic') return 'water';
  if (group) return group;
  const c = (place.summary.category || '').toLowerCase();
  if (c.includes('camp')) return 'camping';
  if (c.includes('glamp')) return 'glamping';
  if (/hut|lodg|cabin|hotel|motel|stay/.test(c)) return 'huts_lodging';
  if (/trail|hike|ohv|climb/.test(c)) return 'trails';
  if (/water|lake|river|shore|beach|marina|boat/.test(c)) return 'water';
  if (/service|fuel|food|grocery|repair|medical|wifi|laundry|shower/.test(c)) return 'services';
  return 'parks';
}

function hasExploreTrailCards(place?: ExplorePlaceProfile | null) {
  return Array.isArray((place as any)?.trails) && (place as any).trails.length > 0;
}

function shouldHydrateExploreTrailArea(place?: ExplorePlaceProfile | null) {
  if (!place || hasExploreTrailCards(place)) return false;
  const key = getExploreCategoryKey(place);
  const text = [
    place.id,
    place.summary.title,
    place.summary.category,
    place.summary.explore_group,
    place.summary.region,
    place.summary.state,
    place.profile?.summary,
    ...(place.summary.tags ?? []),
    ...((place as any).search_aliases ?? []),
  ].join(' ').toLowerCase();
  return ['trails', 'trailheads', 'climb', 'peaks'].includes(key)
    || /\b(trail|hike|trek|trekking|glacier|karakoram|pakistan|k2|base camp|pass)\b/.test(text);
}

function mergeDynamicTrailArea(place: ExplorePlaceProfile, area: ExplorePlaceProfile): ExplorePlaceProfile {
  const trails = Array.isArray((area as any).trails) ? (area as any).trails : [];
  if (!trails.length) return place;
  const firstTrailPhoto = trails
    .map((trail: ExploreTrailCard) => trail.image_url || trail.photos?.find(photo => !!photo.url)?.url)
    .find(Boolean);
  const imageUrl = place.summary.image_url || area.summary.image_url || firstTrailPhoto || place.summary.thumbnail_url || area.summary.thumbnail_url || '';
  const imageCredit = place.summary.image_credit || area.summary.image_credit || trails.find((trail: ExploreTrailCard) => trail.image_credit)?.image_credit || '';
  return {
    ...place,
    category: area.category || place.category,
    subcategories: Array.from(new Set([...(place.subcategories ?? []), ...(area.subcategories ?? [])])),
    quality: area.quality || place.quality,
    quality_score: Math.max(Number((place as any).quality_score || 0), Number((area as any).quality_score || 0)),
    search_aliases: Array.from(new Set([...((place as any).search_aliases ?? []), ...((area as any).search_aliases ?? [])])),
    trails,
    sources: Array.from(new Set([...(place.sources ?? []), ...(area.sources ?? [])] as any[])) as any,
    card: {
      ...(area.card || {}),
      ...(place.card || {}),
      title: place.card?.title || place.summary.title || area.card?.title,
      region: place.card?.region || area.card?.region,
      headline: area.card?.headline || place.card?.headline,
      summary: area.card?.summary || place.card?.summary,
      highlight: area.card?.highlight || place.card?.highlight,
      facts: area.card?.facts || place.card?.facts,
    },
    summary: {
      ...place.summary,
      category: area.summary.category || place.summary.category,
      explore_group: area.summary.explore_group || place.summary.explore_group,
      region: place.summary.region || area.summary.region,
      tags: Array.from(new Set([...(place.summary.tags ?? []), ...(area.summary.tags ?? [])])),
      hook: area.summary.hook || place.summary.hook,
      short_description: area.summary.short_description || place.summary.short_description,
      image_url: imageUrl,
      thumbnail_url: imageUrl || place.summary.thumbnail_url,
      image_credit: imageCredit,
      image_license: place.summary.image_license || area.summary.image_license,
      source_url: place.summary.source_url || area.summary.source_url,
      source_title: place.summary.source_title || area.summary.source_title,
    },
    profile: {
      ...place.profile,
      why_it_matters: area.profile?.why_it_matters || place.profile.why_it_matters,
      what_to_know: area.profile?.what_to_know || place.profile.what_to_know,
      best_time_to_stop: area.profile?.best_time_to_stop || place.profile.best_time_to_stop,
      access_notes: area.profile?.access_notes || place.profile.access_notes,
      nearby_context: area.profile?.nearby_context || place.profile.nearby_context,
    },
    source_pack: {
      ...(place.source_pack || {}),
      ...(area.source_pack || {}),
      photos: [
        ...((place.source_pack?.photos ?? []) as any[]),
        ...((area.source_pack?.photos ?? []) as any[]),
      ].slice(0, 12),
      things_to_do: [
        ...((place.source_pack?.things_to_do ?? []) as any[]),
        ...trails.slice(0, 8).map((trail: ExploreTrailCard) => ({
          title: trail.title,
          description: [fmtMi(trail.distance_mi), trail.route_type, trail.difficulty].filter(Boolean).join(' · '),
          url: trail.source_url,
          lat: trail.lat,
          lng: trail.lng,
          image_url: trail.image_url || trail.photos?.find(photo => !!photo.url)?.url,
          image_credit: trail.image_credit || trail.photos?.find(photo => !!photo.url)?.credit,
        })),
      ],
    },
    facts: {
      ...place.facts,
      ...area.facts,
    },
    attribution: area.attribution || place.attribution,
  };
}

function storyTextForPlace(place: ExplorePlaceProfile) {
  return place.profile.story || place.audio_script || place.wiki_extract || '';
}

function splitStorySentences(text: string) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  return clean.match(/[^.!?]+[.!?]+["')\]]?|[^.!?]+$/g)?.map(s => s.trim()).filter(Boolean) ?? [clean];
}

function sentenceDurationMs(sentence: string) {
  const words = sentence.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(2200, Math.min(9500, words * 360));
}

function mediaUrl(url?: string | null) {
  if (!url) return '';
  return url.startsWith('/') ? `${API_BASE}${url}` : url;
}

function timeGreeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function campImageUrl(camp: CampsitePin) {
  const direct = camp.photo_url || camp.hero_photo_url || camp.primary_image || camp.image_url;
  if (direct) return mediaUrl(direct);
  for (const item of [...(camp.photos ?? []), ...(camp.photo_candidates ?? [])]) {
    if (typeof item === 'string' && item) return mediaUrl(item);
    if (item && typeof item === 'object' && item.url) return mediaUrl(item.url);
  }
  return '';
}

function campMetaLine(camp: CampsitePin) {
  return [
    camp.source_badge || camp.verified_source || camp.source,
    camp.land_type,
    typeof (camp as any).distance_mi === 'number' ? fmtMi((camp as any).distance_mi) : '',
  ].filter(Boolean).join(' · ');
}

function mergeCampPins(primary: CampsitePin[], fallback: CampsitePin[]) {
  const seen = new Set<string>();
  const merged: CampsitePin[] = [];
  for (const camp of [...primary, ...fallback]) {
    if (!camp?.lat || !camp?.lng) continue;
    const idKey = String(camp.id || '').trim();
    const fuzzyKey = `${String(camp.name || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40)}:${camp.lat.toFixed(3)}:${camp.lng.toFixed(3)}`;
    if ((idKey && seen.has(idKey)) || seen.has(fuzzyKey)) continue;
    if (idKey) seen.add(idKey);
    seen.add(fuzzyKey);
    merged.push(camp);
  }
  return merged;
}

function shouldLoadExploreCamps(place: ExplorePlaceProfile) {
  return ['camping', 'glamping', 'huts_lodging', 'trails', 'parks', 'water'].includes(groupForExplorePlace(place));
}

function shouldUseExploreCampgroundEndpoint(place: ExplorePlaceProfile) {
  return !place.id.startsWith('explore:waterfalls:') && !place.id.startsWith('explore:trails:');
}

function exploreCampRailTitle(place: ExplorePlaceProfile) {
  const group = groupForExplorePlace(place);
  if (group === 'glamping') return 'STAYS NEAR THIS AREA';
  if (group === 'huts_lodging') return 'HUTS, CABINS & CAMPS NEARBY';
  if (group === 'trails') return 'CAMPS NEAR THIS TRAIL AREA';
  if (group === 'water') return 'CAMPS AND STAYS NEARBY';
  return 'CAMPGROUNDS IN THIS AREA';
}

function exploreCampFallbackRadius(place: ExplorePlaceProfile) {
  const group = groupForExplorePlace(place);
  if (group === 'glamping' || group === 'huts_lodging') return 26;
  if (group === 'camping') return 24;
  if (group === 'trails') return 32;
  return 38;
}

export default function GuideScreen() {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const router = useRouter();
  const user = useStore(st => st.user);
  const activeTrip = useStore(st => st.activeTrip);
  const setActiveTrip = useStore(st => st.setActiveTrip);
  const userLoc = useStore(st => st.userLoc);
  const weatherUnitMode = useStore(st => st.weatherUnitMode);
  const setPendingNavigatePlace = useStore(st => st.setPendingNavigatePlace);
  const setPendingMapSelection = useStore(st => st.setPendingMapSelection);
  const [guide, setGuide] = useState<Record<string, string>>({});
  const [guideLoading, setGuideLoading] = useState(false);
  const [guideError, setGuideError] = useState('');
  const [playing, setPlaying] = useState<string | null>(null);
  const [nearbyNarration, setNearbyNarration] = useState('');
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [weatherByWp, setWeatherByWp] = useState<Record<string, any>>({});
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [tab, setTab] = useState<'explore' | 'narrations' | 'weather'>('explore');
  const [exploreMode, setExploreMode] = useState<'featured' | 'nearby' | 'trip'>('featured');
  const [exploreSortMode, setExploreSortMode] = useState<ExploreSortMode>('best');
  const [exploreCategory, setExploreCategory] = useState<ExploreCategoryKey>('all');
  const [exploreQuery, setExploreQuery] = useState('');
  const [profileReadMode, setProfileReadMode] = useState<ExploreDetailTab>('summary');
  const [explorePlaces, setExplorePlaces] = useState<ExplorePlaceProfile[]>([]);
  const [exploreTrailAreasById, setExploreTrailAreasById] = useState<Record<string, ExplorePlaceProfile>>({});
  const [exploreTrailAreaLoadingId, setExploreTrailAreaLoadingId] = useState<string | null>(null);
  const [exploreTrailAreaErrors, setExploreTrailAreaErrors] = useState<Record<string, string>>({});
  const [savedExploreIds, setSavedExploreIds] = useState<string[]>([]);
  const [exploreCampgroundsById, setExploreCampgroundsById] = useState<Record<string, CampsitePin[]>>({});
  const [exploreCampSourceById, setExploreCampSourceById] = useState<Record<string, 'official' | 'fallback'>>({});
  const [exploreCampLoadingId, setExploreCampLoadingId] = useState<string | null>(null);
  const [exploreCampErrors, setExploreCampErrors] = useState<Record<string, string>>({});
  const [exploreWeatherById, setExploreWeatherById] = useState<Record<string, any>>({});
  const [exploreWeatherLoadingId, setExploreWeatherLoadingId] = useState<string | null>(null);
  const [exploreWeatherErrors, setExploreWeatherErrors] = useState<Record<string, string>>({});
  const [liveExplorePlaces, setLiveExplorePlaces] = useState<OsmPoi[]>([]);
  const [exploreLoading, setExploreLoading] = useState(false);
  const [liveExploreLoading, setLiveExploreLoading] = useState(false);
  const [exploreError, setExploreError] = useState('');
  const [selectedExplore, setSelectedExplore] = useState<ExplorePlaceProfile | null>(null);
  const [selectedLivePlace, setSelectedLivePlace] = useState<OsmPoi | null>(null);
  const [paywallVisible, setPaywallVisible] = useState(false);
  const [paywallCode, setPaywallCode] = useState('');
  const [paywallMessage, setPaywallMessage] = useState('');
  const [autoPlay, setAutoPlay] = useState(false);
  const [highlightSentence, setHighlightSentence] = useState(-1);
  const locationSub = useRef<Location.LocationSubscription | null>(null);
  const storyScrollRef = useRef<ScrollView | null>(null);
  const storyTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    let cancelled = false;
    setExploreLoading(true);
    storage.get(EXPLORE_CACHE_KEY).then(raw => {
      if (cancelled || !raw) return;
      try {
        const cached = JSON.parse(raw);
        if (Array.isArray(cached?.places)) setExplorePlaces(cached.places);
      } catch {}
    }).catch(() => {});
    api.getExploreCatalog()
      .then(catalog => {
        if (cancelled) return;
        setExplorePlaces(catalog.places ?? []);
        storage.set(EXPLORE_CACHE_KEY, JSON.stringify(catalog)).catch(() => {});
        setExploreError('');
      })
      .catch(() => {
        if (!cancelled) setExploreError('Explore catalog unavailable offline until it has been loaded once.');
      })
      .finally(() => !cancelled && setExploreLoading(false));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    storage.get(SAVED_EXPLORE_KEY).then(raw => {
      if (cancelled || !raw) return;
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setSavedExploreIds(parsed.filter(Boolean).map(String));
      } catch {}
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (exploreMode !== 'nearby' || !userLoc) {
      setLiveExplorePlaces([]);
      return;
    }
    let cancelled = false;
    setLiveExploreLoading(true);
    api.getNearbyPlaces(userLoc.lat, userLoc.lng, 35, 'food,grocery,fuel,lodging,attraction,hardware,mechanic,medical,camping')
      .then(places => {
        if (!cancelled) setLiveExplorePlaces(places.slice(0, 18));
      })
      .catch(() => {
        if (!cancelled) setLiveExplorePlaces([]);
      })
      .finally(() => {
        if (!cancelled) setLiveExploreLoading(false);
      });
    return () => { cancelled = true; };
  }, [exploreMode, userLoc?.lat, userLoc?.lng]);

  useEffect(() => {
    const place = selectedExplore;
    const placeId = place?.summary.id;
    if (!place || !placeId || !shouldLoadExploreCamps(place)) return;
    if (exploreCampLoadingId === placeId) return;
    const camps = exploreCampgroundsById[placeId];
    const error = exploreCampErrors[placeId];
    if ((!Array.isArray(camps) || camps.length > 0) && !error) return;
    trackPhase0Once(`phase0:guide-empty:${placeId}:${error ? 'error' : 'none'}`, 'phase0_empty_state_seen', {
      surface: 'guide_explore_camp_rail',
      place_id: placeId,
      group: groupForExplorePlace(place),
      reason: error ? 'provider_error' : 'no_results',
    });
  }, [exploreCampErrors, exploreCampLoadingId, exploreCampgroundsById, selectedExplore]);

  useEffect(() => {
    if (!selectedExplore || !shouldLoadExploreCamps(selectedExplore)) return;
    const place = selectedExplore;
    const placeId = place.id;
    const fallbackLat = place.summary.lat;
    const fallbackLng = place.summary.lng;
    const fallbackRadius = exploreCampFallbackRadius(place);
    let cancelled = false;
    const cacheKey = `${EXPLORE_CAMPGROUNDS_CACHE_PREFIX}${placeId}`;
    storage.get(cacheKey).then(raw => {
      if (cancelled || !raw || exploreCampgroundsById[placeId]?.length) return;
      try {
        const cached = JSON.parse(raw);
        if (Array.isArray(cached?.campgrounds)) {
          setExploreCampgroundsById(prev => ({ ...prev, [placeId]: cached.campgrounds }));
          if (cached?.source_mode === 'official' || cached?.source_mode === 'fallback') {
            setExploreCampSourceById(prev => ({ ...prev, [placeId]: cached.source_mode }));
          }
        }
      } catch {}
    }).catch(() => {});
    setExploreCampLoadingId(placeId);
    const loadFallbackCamps = async () => {
      if (fallbackLat != null && fallbackLng != null) {
        const fallback = await api.getNearbyCamps(fallbackLat, fallbackLng, fallbackRadius, []).catch(() => []);
        if (cancelled) return true;
        if (fallback.length) {
          setExploreCampgroundsById(prev => ({ ...prev, [placeId]: fallback }));
          setExploreCampSourceById(prev => ({ ...prev, [placeId]: 'fallback' }));
          setExploreCampErrors(prev => ({ ...prev, [placeId]: '' }));
          storage.set(cacheKey, JSON.stringify({ campgrounds: fallback, source_mode: 'fallback', fetched_at: Date.now() })).catch(() => {});
          return true;
        }
      }
      return false;
    };
    if (!shouldUseExploreCampgroundEndpoint(place)) {
      loadFallbackCamps()
        .then(loaded => {
          if (!cancelled && !loaded) {
            setExploreCampErrors(prev => ({ ...prev, [placeId]: 'No camp cards loaded for this area. Open the area map to search wider.' }));
          }
        })
        .finally(() => {
          if (!cancelled) setExploreCampLoadingId(current => current === placeId ? null : current);
        });
      return () => { cancelled = true; };
    }
    api.getExploreCampgrounds(placeId)
      .then(async res => {
        if (cancelled) return;
        const primary = res.campgrounds ?? [];
        let merged = primary;
        let sourceMode: 'official' | 'fallback' = 'official';
        if (fallbackLat != null && fallbackLng != null && primary.length < 6) {
          const fallback = await api.getNearbyCamps(fallbackLat, fallbackLng, fallbackRadius, []).catch(() => []);
          if (cancelled) return;
          if (fallback.length) {
            merged = mergeCampPins(primary, fallback);
            if (primary.length === 0) sourceMode = 'fallback';
          }
        }
        setExploreCampgroundsById(prev => ({ ...prev, [placeId]: merged }));
        setExploreCampSourceById(prev => ({ ...prev, [placeId]: sourceMode }));
        setExploreCampErrors(prev => ({ ...prev, [placeId]: '' }));
        storage.set(cacheKey, JSON.stringify({ campgrounds: merged, source_mode: sourceMode, fetched_at: Date.now() })).catch(() => {});
      })
      .catch(async () => {
        if (cancelled) return;
        if (await loadFallbackCamps()) return;
        setExploreCampErrors(prev => ({ ...prev, [placeId]: 'No camp cards loaded for this area. Open the area map to search wider.' }));
      })
      .finally(() => {
        if (!cancelled) setExploreCampLoadingId(current => current === placeId ? null : current);
      });
    return () => { cancelled = true; };
  }, [selectedExplore?.id]);

  useEffect(() => {
    if (!activeTrip) {
      setGuide({});
      setWeatherByWp({});
      return;
    }
    setGuideError('');
    if (activeTrip.audio_guide) {
      setGuide(activeTrip.audio_guide);
    } else {
      setGuideLoading(true);
      api.getAudioGuide(activeTrip.trip_id, false)
        .then(setGuide)
        .catch(() => setGuide({}))
        .finally(() => setGuideLoading(false));
    }
    const wpsWithCoords = activeTrip.plan.waypoints.filter(w => w.lat && w.lng).slice(0, 6);
    if (wpsWithCoords.length > 0) {
      setWeatherLoading(true);
      const results: Record<string, any> = {};
      Promise.allSettled(wpsWithCoords.map(async wp => {
        try {
          const data = await api.getWeather(wp.lat!, wp.lng!, 3, weatherUnitMode);
          results[wp.name] = data;
        } catch {}
      })).finally(() => {
        setWeatherByWp(results);
        setWeatherLoading(false);
      });
    }
  }, [activeTrip?.trip_id, weatherUnitMode]);

  const waypoints = useMemo(() => activeTrip?.plan.waypoints.filter(w => w.lat && w.lng) ?? [], [activeTrip?.trip_id]);
  const displayName = useMemo(() => (user?.username || 'Explorer').trim().split(/\s+/)[0] || 'Explorer', [user?.username]);
  const enrichedExplorePlaces = useMemo(() => (
    mergeCuratedExplorePlaces(explorePlaces).map(place => exploreTrailAreasById[place.id] ?? place)
  ), [explorePlaces, exploreTrailAreasById]);
  const heroHeight = Math.max(280, Math.min(340, Math.round(windowHeight * 0.39)));
  const heroImage = useMemo(() => {
    const images = enrichedExplorePlaces
      .filter(place => ['camping', 'trails', 'parks'].includes(groupForExplorePlace(place)))
      .map(place => place.summary.image_url || place.summary.thumbnail_url)
      .filter(Boolean) as string[];
    if (!images.length) return '';
    const now = new Date();
    const dayKey = Math.floor((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(now.getFullYear(), 0, 0)) / 86400000);
    return mediaUrl(images[dayKey % images.length]);
  }, [enrichedExplorePlaces]);
  const hasExploreQuery = exploreQuery.trim().length > 0;
  const rankedExplore = useMemo(() => {
    const places = enrichedExplorePlaces.map(place => {
      const loc = place.summary.lat != null && place.summary.lng != null
        ? { lat: Number(place.summary.lat), lng: Number(place.summary.lng) }
        : null;
      let distance: number | null = null;
      let day: number | undefined;
      if (loc && userLoc && (exploreMode === 'nearby' || exploreSortMode === 'nearest')) {
        distance = distMi(userLoc, loc);
      }
      if (loc && exploreMode === 'trip' && waypoints.length > 0) {
        let best = Infinity;
        let bestDay: number | undefined;
        for (const wp of waypoints) {
          const d = distMi({ lat: wp.lat!, lng: wp.lng! }, loc);
          if (d < best) {
            best = d;
            bestDay = wp.day;
          }
        }
        distance = best;
        day = bestDay;
      }
      return { place, distance, day };
    });
    const query = exploreQuery.trim();
    const queryCategory = exploreCategory === 'all' ? exploreCategoryFromQuery(query) : null;
    const filtered = places.filter(({ place }) => {
      const categoryOk = exploreCategoryMatches(place, exploreCategory);
      if (!categoryOk) return false;
      if (queryCategory && getExploreCategoryKey(place) !== queryCategory) return false;
      if (!query) return true;
      return scoreExploreQuery(place, query) > 0;
    });
    const decorated = filtered.map(item => ({
      ...item,
      queryScore: scoreExploreQuery(item.place, query),
      trustScore: scoreExploreTrust(item.place),
    }));
    const sortByNearest = (a: typeof decorated[number], b: typeof decorated[number]) => {
      const aDist = a.distance ?? 99999;
      const bDist = b.distance ?? 99999;
      if (aDist !== bDist) return aDist - bDist;
      if (b.trustScore !== a.trustScore) return b.trustScore - a.trustScore;
      return a.place.summary.rank - b.place.summary.rank;
    };
    const sortBySource = (a: typeof decorated[number], b: typeof decorated[number]) => {
      if (b.trustScore !== a.trustScore) return b.trustScore - a.trustScore;
      if (query && b.queryScore !== a.queryScore) return b.queryScore - a.queryScore;
      const aDist = a.distance ?? 99999;
      const bDist = b.distance ?? 99999;
      if (aDist !== bDist) return aDist - bDist;
      return a.place.summary.rank - b.place.summary.rank;
    };
    if (exploreMode === 'featured') {
      return decorated.sort((a, b) => {
        if (exploreSortMode === 'nearest') return sortByNearest(a, b);
        if (exploreSortMode === 'source') return sortBySource(a, b);
        if (query && b.queryScore !== a.queryScore) return b.queryScore - a.queryScore;
        const aHero = a.place.summary.hero_rank ?? a.place.summary.rank;
        const bHero = b.place.summary.hero_rank ?? b.place.summary.rank;
        if (aHero !== bHero) return aHero - bHero;
        if (b.trustScore !== a.trustScore) return b.trustScore - a.trustScore;
        return a.place.summary.rank - b.place.summary.rank;
      });
    }
    return decorated
      .filter(item => item.distance == null || item.distance < (exploreMode === 'trip' ? 250 : 1200))
      .sort((a, b) => {
        if (exploreSortMode === 'nearest') return sortByNearest(a, b);
        if (exploreSortMode === 'source') return sortBySource(a, b);
        if (query && b.queryScore !== a.queryScore) return b.queryScore - a.queryScore;
        const aDist = a.distance ?? 99999;
        const bDist = b.distance ?? 99999;
        const distanceThreshold = exploreMode === 'trip' ? 10 : 20;
        if (Math.abs(aDist - bDist) > distanceThreshold) return aDist - bDist;
        if (b.trustScore !== a.trustScore) return b.trustScore - a.trustScore;
        return aDist - bDist;
      });
  }, [enrichedExplorePlaces, exploreCategory, exploreMode, exploreQuery, exploreSortMode, userLoc?.lat, userLoc?.lng, waypoints]);

  const featuredSections = useMemo(() => {
    if (hasExploreQuery || exploreCategory !== 'all' || exploreMode !== 'featured') return [];
    return EXPLORE_CATEGORY_CHIPS
      .filter(item => !['all', 'nearby', 'fuel', 'resupply'].includes(item.key))
      .map(item => ({
        item,
        rows: rankedExplore
          .filter(({ place }) => exploreCategoryMatches(place, item.key))
          .sort((a, b) => (a.place.summary.hero_rank ?? a.place.summary.rank) - (b.place.summary.hero_rank ?? b.place.summary.rank))
          .slice(0, 8),
      }))
      .filter(section => section.rows.length > 0);
  }, [exploreCategory, exploreMode, hasExploreQuery, rankedExplore]);
  const relatedExplore = useMemo(() => {
    if (selectedExplore?.summary.lat == null || selectedExplore?.summary.lng == null) return [];
    const selectedGroup = groupForExplorePlace(selectedExplore);
    const origin = { lat: Number(selectedExplore.summary.lat), lng: Number(selectedExplore.summary.lng) };
    return enrichedExplorePlaces
      .filter(place => place.id !== selectedExplore.id && place.summary.lat != null && place.summary.lng != null)
      .map(place => ({
        place,
        distance: distMi(origin, { lat: Number(place.summary.lat), lng: Number(place.summary.lng) }),
      }))
      .filter(item => item.distance < 90)
      .sort((a, b) => {
        const aSameGroup = groupForExplorePlace(a.place) === selectedGroup ? 1 : 0;
        const bSameGroup = groupForExplorePlace(b.place) === selectedGroup ? 1 : 0;
        if (bSameGroup !== aSameGroup) return bSameGroup - aSameGroup;
        const trustDelta = scoreExploreTrust(b.place) - scoreExploreTrust(a.place);
        if (trustDelta) return trustDelta;
        return (a.distance ?? 99999) - (b.distance ?? 99999);
      })
      .slice(0, 6);
  }, [enrichedExplorePlaces, selectedExplore?.id, selectedExplore?.summary.lat, selectedExplore?.summary.lng]);

  const applyHydratedTrailArea = useCallback((placeId: string, basePlace: ExplorePlaceProfile, area: ExplorePlaceProfile) => {
    const merged = mergeDynamicTrailArea(basePlace, area);
    setExploreTrailAreasById(prev => ({ ...prev, [placeId]: merged }));
    setSelectedExplore(current => current?.id === placeId ? mergeDynamicTrailArea(current, area) : current);
    return merged;
  }, []);

  const hydrateExploreTrailArea = useCallback(async (place: ExplorePlaceProfile, force = false) => {
    if (place.summary.lat == null || place.summary.lng == null) return null;
    if (!force && !shouldHydrateExploreTrailArea(place)) return place;
    if (!force && exploreTrailAreasById[place.id]) return exploreTrailAreasById[place.id];
    if (exploreTrailAreaLoadingId === place.id) return place;
    const cacheKey = `${EXPLORE_TRAIL_AREA_CACHE_PREFIX}${place.id}`;
    setExploreTrailAreaLoadingId(place.id);
    setExploreTrailAreaErrors(prev => ({ ...prev, [place.id]: '' }));
    try {
      if (!force) {
        const raw = await storage.get(cacheKey).catch(() => '');
        if (raw) {
          const cached = JSON.parse(raw);
          if (cached?.area?.trails?.length) {
            return applyHydratedTrailArea(place.id, place, cached.area);
          }
        }
      }
      const response = await api.discoverTrailArea({
        lat: Number(place.summary.lat),
        lng: Number(place.summary.lng),
        radius: /pakistan|karakoram|k2|glacier/i.test(JSON.stringify(place)) ? 80 : 45,
        limit: 24,
      });
      const area = response.area;
      if (area?.trails?.length) {
        await storage.set(cacheKey, JSON.stringify({ area, fetched_at: Date.now() })).catch(() => {});
        return applyHydratedTrailArea(place.id, place, area);
      }
      setExploreTrailAreaErrors(prev => ({ ...prev, [place.id]: 'No trail cards found near this stop yet.' }));
      return place;
    } catch {
      setExploreTrailAreaErrors(prev => ({ ...prev, [place.id]: 'Could not load trail cards right now.' }));
      return place;
    } finally {
      setExploreTrailAreaLoadingId(current => current === place.id ? null : current);
    }
  }, [applyHydratedTrailArea, exploreTrailAreaLoadingId, exploreTrailAreasById]);

  useEffect(() => {
    if (!selectedExplore || !shouldHydrateExploreTrailArea(selectedExplore)) return;
    hydrateExploreTrailArea(selectedExplore).catch(() => {});
  }, [selectedExplore?.id]);

  async function generateGuide() {
    if (!activeTrip || guideLoading) return;
    setGuideError('');
    setGuideLoading(true);
    try {
      const generated = await api.getAudioGuide(activeTrip.trip_id, true);
      setGuide(generated);
      setActiveTrip({ ...activeTrip, audio_guide: generated });
    } catch (e: any) {
      if (e instanceof PaywallError) {
        setGuideError(e.message || 'Audio guide needs credits or an active plan.');
        showPaywall(e);
      } else {
        setGuideError('Could not generate the audio guide right now.');
      }
    } finally {
      setGuideLoading(false);
    }
  }

  useEffect(() => {
    if (!autoPlay || !activeTrip) {
      locationSub.current?.remove();
      locationSub.current = null;
      return;
    }
    Location.requestForegroundPermissionsAsync().then(({ status }) => {
      if (status !== 'granted') return;
      Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 200 },
        loc => {
          const { latitude, longitude } = loc.coords;
          for (const wp of activeTrip.plan.waypoints.filter(w => w.lat && w.lng)) {
            const dist = Math.sqrt(
              Math.pow((wp.lat! - latitude) * 111, 2) +
              Math.pow((wp.lng! - longitude) * 111 * Math.cos(latitude * Math.PI / 180), 2)
            );
            if (dist < 1.0 && guide[wp.name] && playing !== wp.name) {
              playNarration(wp.name, guide[wp.name]);
              break;
            }
          }
        }
      ).then(sub => { locationSub.current = sub; });
    });
    return () => { locationSub.current?.remove(); locationSub.current = null; };
  }, [autoPlay, activeTrip?.trip_id, guide]);

  function playNarration(name: string, text: string, highlightText = false) {
    stopTrailheadVoice();
    stopStoryHighlight();
    if (playing === name) { setPlaying(null); return; }
    setPlaying(name);
    playTrailheadVoice(text, 'guide', { language: 'en-US', rate: 0.92 }, {
      onStart: () => {
        if (highlightText) startStoryHighlight(text);
      },
      onFinish: () => {
        stopStoryHighlight();
        setPlaying(current => current === name ? null : current);
      },
    });
    const fallbackTimer = setTimeout(() => {
      stopStoryHighlight();
      setPlaying(current => current === name ? null : current);
    }, Math.max(5000, Math.min(600000, text.length * 70)));
    storyTimers.current.push(fallbackTimer);
  }

  function stopStoryHighlight() {
    storyTimers.current.forEach(clearTimeout);
    storyTimers.current = [];
    setHighlightSentence(-1);
  }

  function startStoryHighlight(text: string) {
    stopStoryHighlight();
    const sentences = splitStorySentences(text);
    if (!sentences.length) return;
    let elapsed = 850;
    sentences.forEach((sentence, idx) => {
      const timer = setTimeout(() => {
        setHighlightSentence(idx);
        storyScrollRef.current?.scrollTo({ y: Math.max(0, idx * 58 - 24), animated: true });
      }, elapsed);
      storyTimers.current.push(timer);
      elapsed += sentenceDurationMs(sentence);
    });
  }

  useEffect(() => () => stopStoryHighlight(), []);

  function showPaywall(e: PaywallError) {
    setPaywallCode(e.code);
    setPaywallMessage(e.message);
    setPaywallVisible(true);
  }

  async function playExplore(place: ExplorePlaceProfile) {
    const audioMode = profileReadMode === 'story' ? 'story' : 'summary';
    const text = profileReadMode === 'story'
      ? storyTextForPlace(place)
      : (place.profile.summary || place.profile.hook || place.summary.short_description);
    try {
      await api.authorizeExploreAudio(place.id, audioMode);
      playNarration(`explore:${place.id}`, text, audioMode === 'story');
    } catch (e: any) {
      if (e instanceof PaywallError) showPaywall(e);
      else setExploreError(e?.message ?? 'Could not start audio right now.');
    }
  }

  function showExploreOnMap(place: ExplorePlaceProfile) {
    const { lat, lng, title } = place.summary;
    if (lat == null || lng == null) return;
    setPendingMapSelection({
      kind: 'place',
      place: {
        id: `explore-area:${place.id}`,
        name: title,
        lat: Number(lat),
        lng: Number(lng),
        icon: 'pin',
        note: place.summary.short_description || place.summary.hook || 'Explore area',
        createdAt: Date.now(),
      },
    });
    setSelectedExplore(null);
    router.push('/(tabs)/map');
  }

  function routeExplore(place: ExplorePlaceProfile) {
    const { lat, lng, title } = place.summary;
    if (lat == null || lng == null) return;
    setPendingNavigatePlace({ lat: Number(lat), lng: Number(lng), name: title });
    setSelectedExplore(null);
    router.push('/(tabs)/map');
  }

  function isExploreSaved(place: ExplorePlaceProfile) {
    return savedExploreIds.includes(place.id);
  }

  function toggleSavedExplore(place: ExplorePlaceProfile) {
    setSavedExploreIds(prev => {
      const next = prev.includes(place.id)
        ? prev.filter(id => id !== place.id)
        : [...prev, place.id];
      storage.set(SAVED_EXPLORE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }

  function showExploreCampOnMap(camp: CampsitePin) {
    setPendingMapSelection({ kind: 'camp', camp });
    setSelectedExplore(null);
    router.push('/(tabs)/map');
  }

  function showExploreTrailOnMap(place: ExplorePlaceProfile, trail: ExploreTrailCard) {
    const lat = trail.lat ?? place.summary.lat;
    const lng = trail.lng ?? place.summary.lng;
    if (lat == null || lng == null) return;
    const distance = Number.isFinite(trail.distance_mi) && trail.distance_mi > 0
      ? `${trail.distance_mi.toFixed(trail.distance_mi >= 10 ? 0 : 1)} mi`
      : 'Check distance';
    setPendingMapSelection({
      kind: 'trail',
      trail: {
        id: `explore-trail:${trail.trail_id || trail.id}`,
        name: trail.title,
        lat: Number(lat),
        lng: Number(lng),
        icon: 'flag',
        note: `${distance} · ${trail.route_type}`,
        trailId: trail.trail_id || trail.id,
        geometryRef: trail.geometry_ref,
        sourceLabel: trail.source_label || trail.source_pack?.primary,
        createdAt: Date.now(),
      },
    });
    setSelectedExplore(null);
    router.push('/(tabs)/map');
  }

  function routeExploreTrail(place: ExplorePlaceProfile, trail: ExploreTrailCard) {
    const target = trail.trekking_only && trail.route_target ? trail.route_target : null;
    const lat = target?.lat ?? trail.lat ?? place.summary.lat;
    const lng = target?.lng ?? trail.lng ?? place.summary.lng;
    if (lat == null || lng == null) return;
    setPendingNavigatePlace({ lat: Number(lat), lng: Number(lng), name: target?.name || trail.title });
    setSelectedExplore(null);
    router.push('/(tabs)/map');
  }

  async function fetchExploreWeather(place: ExplorePlaceProfile) {
    const { lat, lng } = place.summary;
    if (lat == null || lng == null) {
      setExploreWeatherErrors(prev => ({ ...prev, [place.id]: 'No coordinates for this stop.' }));
      return;
    }
    setExploreWeatherLoadingId(place.id);
    setExploreWeatherErrors(prev => ({ ...prev, [place.id]: '' }));
    try {
      const weather = await api.getWeather(Number(lat), Number(lng), 3, weatherUnitMode);
      setExploreWeatherById(prev => ({ ...prev, [place.id]: weather }));
    } catch {
      setExploreWeatherErrors(prev => ({ ...prev, [place.id]: 'Weather unavailable right now.' }));
    } finally {
      setExploreWeatherLoadingId(current => current === place.id ? null : current);
    }
  }

  function handleExploreNearbyAction(place: ExplorePlaceProfile, module: ExploreNearbyModule) {
    if (module.action === 'weather') {
      setProfileReadMode('summary');
      fetchExploreWeather(place);
      return;
    }
    if (module.action === 'trails') {
      setProfileReadMode('summary');
      if (!hasExploreTrailCards(place)) hydrateExploreTrailArea(place, true).catch(() => {});
      return;
    }
    if (module.action === 'route') {
      routeExplore(place);
      return;
    }
    const officialUrl = place.source_pack?.official_url || place.summary.source_url;
    if (module.action === 'hours' && officialUrl) {
      Linking.openURL(officialUrl);
      return;
    }
    showExploreOnMap(place);
  }

  function renderExploreWeather(place: ExplorePlaceProfile) {
    const weather = exploreWeatherById[place.id];
    const error = exploreWeatherErrors[place.id];
    const loading = exploreWeatherLoadingId === place.id;
    if (!weather && !error && !loading) return null;
    const daily = weather?.daily;
    const code = Number(weather?.current?.weather_code ?? daily?.weathercode?.[0] ?? 3);
    const units = weather?.trailhead_units;
    const tempLabel = units?.temperature_label ?? '°';
    const windLabel = units?.wind_label ?? 'mph';
    const hi = daily?.temperature_2m_max?.[0];
    const lo = daily?.temperature_2m_min?.[0];
    const wind = daily?.windspeed_10m_max?.[0];
    const precip = daily?.precipitation_probability_max?.[0] ?? daily?.precipitation_sum?.[0];
    return (
      <TrailheadCard style={s.exploreWeatherCard}>
        <View style={s.exploreWeatherTop}>
          <View>
            <Text style={s.profileLabel}>WEATHER AT THIS STOP</Text>
            <Text style={s.exploreWeatherSub}>{place.summary.title}</Text>
          </View>
          {loading ? <ActivityIndicator color={C.orange} size="small" /> : <Ionicons name={wmoIcon(code)} size={26} color={C.orange} />}
        </View>
        {loading ? (
          <Text style={s.exploreWeatherText}>Loading forecast...</Text>
        ) : error ? (
          <Text style={s.exploreWeatherText}>{error}</Text>
        ) : (
          <View style={s.exploreWeatherStats}>
            <View style={s.exploreWeatherStat}>
              <Text style={s.exploreWeatherValue}>
                {Number.isFinite(hi) ? Math.round(Number(hi)) : '--'}{tempLabel}/{Number.isFinite(lo) ? Math.round(Number(lo)) : '--'}{tempLabel}
              </Text>
              <Text style={s.exploreWeatherLabel}>HI/LO</Text>
            </View>
            <View style={s.exploreWeatherStat}>
              <Text style={s.exploreWeatherValue}>{Number.isFinite(wind) ? Math.round(Number(wind)) : '--'} {windLabel}</Text>
              <Text style={s.exploreWeatherLabel}>WIND</Text>
            </View>
            <View style={s.exploreWeatherStat}>
              <Text style={s.exploreWeatherValue}>{Number.isFinite(precip) ? Math.round(Number(precip)) : '--'}%</Text>
              <Text style={s.exploreWeatherLabel}>PRECIP</Text>
            </View>
          </View>
        )}
      </TrailheadCard>
    );
  }

  function renderExploreTrailStatus(place: ExplorePlaceProfile) {
    const loading = exploreTrailAreaLoadingId === place.id;
    const error = exploreTrailAreaErrors[place.id];
    if (!loading && !error) return null;
    if (hasExploreTrailCards(place) && !loading) return null;
    return (
      <TrailheadCard style={s.exploreTrailStatusCard}>
        <View style={s.exploreWeatherTop}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.profileLabel}>TRAIL CARDS</Text>
            <Text style={s.exploreWeatherSub}>{place.summary.title}</Text>
          </View>
          {loading ? <ActivityIndicator color={C.orange} size="small" /> : <Ionicons name="trail-sign-outline" size={24} color={C.orange} />}
        </View>
        <Text style={s.exploreWeatherText}>
          {loading ? 'Loading trails, treks, and glacier cards...' : error}
        </Text>
      </TrailheadCard>
    );
  }

  function renderExploreCard(
    item: { place: ExplorePlaceProfile; distance?: number | null; day?: number },
    idx: number,
    compact = false,
  ) {
    const { place, distance, day } = item;
    return (
      <ExplorePlaceCard
        key={place.id}
        place={place}
        compact={compact}
        lead={idx === 0}
        imageUrl={mediaUrl(place.summary.image_url || place.summary.thumbnail_url)}
        context={{
          distanceMi: distance,
          day,
          campCount: exploreCampgroundsById[place.id]?.length,
        }}
        saved={isExploreSaved(place)}
        canRoute={place.summary.lat != null && place.summary.lng != null}
        onOpen={() => {
          setProfileReadMode('summary');
          const hydrated = exploreTrailAreasById[place.id] ?? place;
          setSelectedExplore(hydrated);
          if (shouldHydrateExploreTrailArea(hydrated)) hydrateExploreTrailArea(hydrated).catch(() => {});
        }}
        onArea={() => showExploreOnMap(place)}
        onRoute={() => routeExplore(place)}
        onToggleSave={() => toggleSavedExplore(place)}
      />
    );
  }

  function renderExploreCampgrounds(place: ExplorePlaceProfile) {
    if (!shouldLoadExploreCamps(place)) return null;
    const camps = exploreCampgroundsById[place.id] ?? [];
    const sourceMode = exploreCampSourceById[place.id] || 'official';
    const loading = exploreCampLoadingId === place.id && camps.length === 0;
    const error = exploreCampErrors[place.id];
    return (
      <TrailheadCard style={s.campgroundSection}>
        <View style={s.campgroundSectionTop}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.profileLabel}>{exploreCampRailTitle(place)}</Text>
            <Text style={s.campgroundSectionSub}>
              {camps.length
                ? sourceMode === 'fallback'
                  ? `${camps.length} nearby camp cards from wider area search`
                  : `${camps.length} nearby campground cards`
                : 'Nearby campground cards with photos, fees, and official links'}
            </Text>
          </View>
          <TouchableOpacity style={s.campgroundAreaBtn} onPress={() => showExploreOnMap(place)}>
            <Ionicons name="map-outline" size={14} color={C.orange} />
            <Text style={s.campgroundAreaBtnText}>AREA</Text>
          </TouchableOpacity>
        </View>
        {loading ? (
          <View style={s.campgroundLoadRow}>
            <ActivityIndicator color={C.orange} size="small" />
            <Text style={s.campgroundLoadText}>Loading campgrounds...</Text>
          </View>
        ) : camps.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.campgroundRail}>
            {camps.slice(0, 12).map(camp => {
              const image = campImageUrl(camp);
              const officialUrl = camp.booking_url || camp.official_url || camp.url;
              const areaFallback = camp.photo_status === 'area_fallback';
              return (
                <TouchableOpacity
                  key={camp.id}
                  style={s.campgroundCard}
                  activeOpacity={0.88}
                  onPress={() => showExploreCampOnMap(camp)}
                >
                  <View style={s.campgroundImageWrap}>
                    {image ? (
                      <Image source={{ uri: image }} style={s.campgroundImage} resizeMode="cover" />
                    ) : (
                      <View style={s.campgroundImageFallback}>
                        <Ionicons name="bonfire-outline" size={28} color={C.orange} />
                      </View>
                    )}
                    <View style={s.campgroundImageShade} />
                    <View style={s.campgroundBadge}>
                      <Text style={s.campgroundBadgeText}>
                        {(camp.source_badge || camp.verified_source || camp.source || 'Camp').toUpperCase()}
                      </Text>
                    </View>
                    {areaFallback && (
                      <View style={s.campgroundPhotoNote}>
                        <Text style={s.campgroundPhotoNoteText}>AREA PHOTO</Text>
                      </View>
                    )}
                  </View>
                  <View style={s.campgroundBody}>
                    <Text style={s.campgroundName} numberOfLines={2}>{camp.name}</Text>
                    <Text style={s.campgroundMeta} numberOfLines={1}>{campMetaLine(camp)}</Text>
                    {!!camp.cost && <Text style={s.campgroundCost} numberOfLines={1}>{camp.cost}</Text>}
                    <View style={s.campgroundTags}>
                      {(camp.tags ?? []).slice(0, 3).map(tag => (
                        <View key={`${camp.id}-${tag}`} style={s.campgroundTag}>
                          <Text style={s.campgroundTagText}>{tag.replace(/_/g, ' ').toUpperCase()}</Text>
                        </View>
                      ))}
                    </View>
                    <View style={s.campgroundActions}>
                      <TouchableOpacity style={s.campgroundOpenBtn} onPress={() => showExploreCampOnMap(camp)}>
                        <Ionicons name="map-outline" size={13} color="#fff" />
                        <Text style={s.campgroundOpenText}>OPEN CAMP</Text>
                      </TouchableOpacity>
                      {!!officialUrl && (
                        <TouchableOpacity style={s.campgroundSourceBtn} onPress={() => Linking.openURL(officialUrl)}>
                          <Ionicons name="open-outline" size={13} color={C.text2} />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        ) : (
          <View style={s.campgroundEmpty}>
            <Ionicons name="map-outline" size={22} color={C.text3} />
            <Text style={s.campgroundEmptyText}>{error || 'No campground cards found nearby yet.'}</Text>
            <TouchableOpacity style={s.campgroundAreaBtn} onPress={() => showExploreOnMap(place)}>
              <Ionicons name="compass-outline" size={14} color={C.orange} />
              <Text style={s.campgroundAreaBtnText}>OPEN AREA MAP</Text>
            </TouchableOpacity>
          </View>
        )}
      </TrailheadCard>
    );
  }

  function renderLandingHeader() {
    return (
      <View style={s.landingHeader}>
        <ExploreHero
          greeting={timeGreeting()}
          displayName={displayName}
          heroImage={heroImage}
          height={heroHeight}
          query={exploreQuery}
          onQueryChange={setExploreQuery}
          onClearQuery={() => setExploreQuery('')}
        />

        <View style={s.tabs}>
          {(['explore', 'narrations', 'weather'] as const).map(t => (
            <TouchableOpacity key={t} style={[s.tab, tab === t && s.tabActive]} onPress={() => setTab(t)}>
              <View style={s.tabInner}>
                <Ionicons
                  name={t === 'explore' ? 'compass-outline' : t === 'narrations' ? 'mic-outline' : 'partly-sunny-outline'}
                  size={15}
                  color={tab === t ? C.orange : C.text3}
                />
                <Text style={[s.tabText, tab === t && s.tabTextActive]}>
                  {t === 'explore' ? 'EXPLORE' : t === 'narrations' ? 'GUIDES' : 'WEATHER'}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  async function whatIsHere() {
    setNearbyLoading(true);
    setNearbyNarration('');
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({});
      const places = await Location.reverseGeocodeAsync({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      }).catch(() => []);
      const placeLabel = reversePlaceLabel(places[0]);
      const coordLabel = `${loc.coords.latitude.toFixed(4)}, ${loc.coords.longitude.toFixed(4)}`;
      const res = await api.nearbyAudio(
        loc.coords.latitude,
        loc.coords.longitude,
        [placeLabel, `coordinates ${coordLabel}`].filter(Boolean).join('; '),
      );
      setNearbyNarration(res.narration);
      playTrailheadVoice(res.narration, 'guide', { language: 'en-US', rate: 0.92 });
    } catch (e: any) {
      if (e instanceof PaywallError) {
        showPaywall(e);
        setNearbyNarration('');
      } else {
        setNearbyNarration('Could not generate narration for this location.');
      }
    } finally {
      setNearbyLoading(false);
    }
  }

  return (
    <SafeAreaView style={s.container}>
      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
        {renderLandingHeader()}

        {tab === 'explore' && (
          <>
            <ExploreCategoryChips
              selected={exploreCategory}
              mode={exploreMode}
              onSelect={key => {
                if (key === 'nearby') {
                  setExploreMode('nearby');
                  setExploreCategory('all');
                } else {
                  setExploreMode(exploreMode === 'nearby' ? 'featured' : exploreMode);
                  setExploreCategory(exploreCategory === key ? 'all' : key);
                }
              }}
            />

            <ExploreModeTabs value={exploreMode} onChange={setExploreMode} />
            <ExploreFilterRow
              shownCount={rankedExplore.length}
              sourceLabel={exploreSortMode === 'source' ? 'Source first' : 'Sources'}
              sortLabel={EXPLORE_SORT_LABELS[exploreSortMode]}
              onCountPress={() => setExploreCategory('all')}
              onSourcePress={() => setExploreSortMode(current => current === 'source' ? 'best' : 'source')}
              onSortPress={() => setExploreSortMode(current => (
                current === 'best' ? 'nearest' : current === 'nearest' ? 'source' : 'best'
              ))}
            />

            {exploreCategory !== 'all' && (
              <TouchableOpacity style={s.clearCategoryBtn} onPress={() => setExploreCategory('all')}>
                <Ionicons name="close" size={14} color={C.orange} />
                <Text style={s.clearCategoryText}>Show all Explore places</Text>
              </TouchableOpacity>
            )}

            {exploreMode === 'nearby' && (
              <View style={s.livePlacesBlock}>
                <View style={s.livePlacesTop}>
                  <Text style={s.livePlacesTitle}>LIVE PLACES NEAR YOU</Text>
                  {liveExploreLoading && <ActivityIndicator color={C.orange} size="small" />}
                </View>
                {liveExplorePlaces.map(place => (
                  <TouchableOpacity key={place.id} style={s.livePlaceRow} activeOpacity={0.86} onPress={() => setSelectedLivePlace(place)}>
                    {place.photo_url ? (
                      <Image source={{ uri: mediaUrl(place.photo_url) }} style={s.livePlacePhoto} resizeMode="cover" />
                    ) : (
                      <View style={s.livePlaceIcon}>
                        <Ionicons name="business-outline" size={18} color={C.orange} />
                      </View>
                    )}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.livePlaceName} numberOfLines={1}>{place.name}</Text>
                      <Text style={s.livePlaceMeta} numberOfLines={1}>
                        {place.subtype || place.type}{place.rating ? ` · ${Number(place.rating).toFixed(1)}` : ''}{place.open_now === true ? ' · Open' : place.open_now === false ? ' · Closed' : ''}
                      </Text>
                    </View>
                    <Ionicons name="chevron-up-outline" size={16} color={C.text3} />
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <View style={s.exploreSectionHeader}>
              <Text style={s.exploreSectionTitle}>
                {exploreMode === 'nearby'
                  ? 'NEARBY PLACES'
                  : exploreMode === 'trip'
                    ? 'ALONG YOUR TRIP'
                    : hasExploreQuery
                      ? 'SEARCH RESULTS'
                    : exploreCategory === 'all'
                      ? 'FEATURED EXPLORER HUBS'
                      : `${EXPLORE_CATEGORY_CHIPS.find(item => item.key === exploreCategory)?.label ?? 'EXPLORE'} AREAS`.toUpperCase()}
              </Text>
              <Text style={s.exploreSectionSub}>{rankedExplore.length} shown</Text>
            </View>

            {exploreLoading && (
              <View style={s.loadRow}>
                <ActivityIndicator color={C.orange} />
                <Text style={s.loadText}>Loading featured places...</Text>
              </View>
            )}
            {!!exploreError && explorePlaces.length === 0 && (
              <View style={s.emptyState}>
                <Ionicons name="cloud-offline-outline" size={44} color={C.text3} />
                <Text style={s.emptySub}>{exploreError}</Text>
              </View>
            )}
            {featuredSections.length > 0 ? (
              featuredSections.map(section => (
                <View key={section.item.key} style={s.exploreRailSection}>
                  <View style={s.exploreSectionHeader}>
                    <Text style={s.exploreSectionTitle}>{section.item.label.toUpperCase()}</Text>
                    <TouchableOpacity onPress={() => setExploreCategory(section.item.key)}>
                      <Text style={s.exploreSectionLink}>VIEW ALL</Text>
                    </TouchableOpacity>
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.exploreRail}>
                    {section.rows.map((item, idx) => renderExploreCard(item, idx, true))}
                  </ScrollView>
                </View>
              ))
            ) : !exploreLoading && rankedExplore.length === 0 ? (
              <View style={s.emptyState}>
                <Ionicons name="search-outline" size={44} color={C.text3} />
                <Text style={s.emptyTitle}>No exact match</Text>
                <Text style={s.emptySub}>Try camp, trail, viewpoint, waterfall, hut, fuel, or hot spring.</Text>
              </View>
            ) : (
              rankedExplore.map((item, idx) => renderExploreCard(item, idx))
            )}
          </>
        )}

        {tab === 'narrations' && (
          <>
            {!!activeTrip && Object.keys(guide).length > 0 && (
              <View style={s.narrationToolbar}>
                <View>
                  <Text style={s.exploreSectionTitle}>TRIP GUIDES</Text>
                  <Text style={s.exploreSectionSub}>{Object.keys(guide).length} narrations ready</Text>
                </View>
                <TouchableOpacity
                  style={[s.autoBtn, autoPlay && s.autoBtnOn]}
                  onPress={() => setAutoPlay(p => !p)}
                >
                  <Ionicons name={autoPlay ? 'radio' : 'radio-outline'} size={14}
                    color={autoPlay ? C.orange : C.text3} />
                  <Text style={[s.autoBtnText, autoPlay && { color: C.orange }]}>AUTO</Text>
                </TouchableOpacity>
              </View>
            )}
            {!activeTrip && (
              <View style={s.emptyState}>
                <Ionicons name="mic-outline" size={48} color={C.text3} />
                <Text style={s.emptyTitle}>No Active Trip</Text>
                <Text style={s.emptySub}>Plan a trip on the PLAN tab to unlock waypoint narrations. Explore stories are ready now.</Text>
              </View>
            )}
            {!!activeTrip && guideLoading && (
              <View style={s.loadRow}>
                <ActivityIndicator color={C.orange} />
                <Text style={s.loadText}>Checking audio guide...</Text>
              </View>
            )}
            {!!activeTrip && !guideLoading && Object.keys(guide).length === 0 && (
              <TrailheadCard style={s.guidePromptCard}>
                <View style={s.guidePromptIcon}>
                  <Ionicons name="mic-outline" size={22} color={C.orange} />
                </View>
                <Text style={s.guidePromptTitle}>Generate trip narrations</Text>
                <Text style={s.guidePromptText}>
                  Creates short spoken notes for each mapped stop. Costs 10 credits unless you have Explorer. First-time audio can take up to a minute; cached guides are free to replay.
                </Text>
                {!!guideError && <Text style={s.guideError}>{guideError}</Text>}
                <TrailheadButton label="Generate Guide" icon="sparkles-outline" variant="primary" onPress={generateGuide} style={{ alignSelf: 'stretch' }} />
              </TrailheadCard>
            )}

            {!!activeTrip && Object.keys(guide).length > 0 && waypoints.map((wp, i) => {
              const narration = guide[wp.name] ?? '';
              const isPlaying = playing === wp.name;
              return (
                <View key={i} style={s.card}>
                  <View style={s.cardTop}>
                    <View style={s.dayBadge}>
                      <Text style={s.dayBadgeText}>{wp.day}</Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={s.wpName} numberOfLines={1}>{wp.name}</Text>
                      <Text style={s.wpMeta}>{wp.type} · {wp.land_type}</Text>
                    </View>
                    <TouchableOpacity
                      style={[s.playBtn, isPlaying && s.playBtnActive, !narration && s.playBtnDisabled]}
                      onPress={() => narration && playNarration(wp.name, narration)}
                      disabled={!narration}
                    >
                      <Ionicons
                        name={isPlaying ? 'stop' : 'play'}
                        size={18}
                        color={narration ? (isPlaying ? '#fff' : C.orange) : C.border}
                      />
                    </TouchableOpacity>
                  </View>
                  {narration
                    ? <Text style={s.narration}>{narration}</Text>
                    : !guideLoading && <Text style={s.narrationMissing}>Narration unavailable</Text>
                  }
                </View>
              );
            })}

            <TourTarget id="guide.audio">
              <View style={s.nearbyCard}>
                <Text style={s.nearbyLabel}>WHAT'S AROUND ME?</Text>
                <Text style={s.nearbySub}>Location narration for your current GPS position. Costs 5 credits unless you have Explorer and can take up to a minute to load.</Text>
                {!!nearbyNarration && <Text style={s.nearbyText}>{nearbyNarration}</Text>}
                <TouchableOpacity style={s.nearbyBtn} onPress={whatIsHere} disabled={nearbyLoading}>
                  {nearbyLoading
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <>
                        <Ionicons name="location" size={16} color="#fff" />
                        <Text style={s.nearbyBtnText}>TELL ME ABOUT HERE</Text>
                      </>
                  }
                </TouchableOpacity>
              </View>
            </TourTarget>
          </>
        )}

        {tab === 'weather' && (
          <>
            {!activeTrip && (
              <View style={s.emptyState}>
                <Ionicons name="partly-sunny-outline" size={48} color={C.text3} />
                <Text style={s.emptyTitle}>No Active Trip</Text>
                <Text style={s.emptySub}>Trip weather appears here once a route is active.</Text>
              </View>
            )}
            {!!activeTrip && weatherLoading && (
              <View style={s.loadRow}>
                <ActivityIndicator color={C.orange} />
                <Text style={s.loadText}>Loading forecasts for each stop...</Text>
              </View>
            )}
            {!!activeTrip && !weatherLoading && Object.keys(weatherByWp).length === 0 && (
              <View style={s.emptyState}>
                <Ionicons name="globe-outline" size={44} color={C.text3} />
                <Text style={s.emptySub}>Weather unavailable for this trip area</Text>
              </View>
            )}
            {!!activeTrip && waypoints.map((wp, i) => {
              const w = weatherByWp[wp.name];
              if (!w?.daily) return null;
              const code = w.daily.weathercode[0] ?? 0;
              const hi = Math.round(w.daily.temperature_2m_max[0] ?? 0);
              const lo = Math.round(w.daily.temperature_2m_min[0] ?? 0);
              const rain = w.daily.precipitation_sum[0] ?? 0;
              const wind = Math.round(w.daily.windspeed_10m_max[0] ?? 0);
              const units = w.trailhead_units;
              const tempLabel = units?.temperature_label ?? '°';
              const windLabel = units?.wind_label ?? 'mph';
              const rainLabel = units?.precipitation_label ?? '"';
              return (
                <View key={i} style={s.weatherCard}>
                  <View style={s.weatherCardTop}>
                    <View style={s.dayBadge}>
                      <Text style={s.dayBadgeText}>{wp.day}</Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={s.wpName} numberOfLines={1}>{wp.name}</Text>
                      <Text style={s.wpMeta}>{wp.type}</Text>
                    </View>
                    <Ionicons name={wmoIcon(code)} size={25} color={C.orange} />
                  </View>
                  <View style={s.weatherStatsRow}>
                    <View style={s.weatherStat}>
                      <Text style={s.weatherStatVal}>{hi}{tempLabel}/{lo}{tempLabel}</Text>
                      <Text style={s.weatherStatLabel}>HI/LO</Text>
                    </View>
                    <View style={s.weatherStat}>
                      <Text style={s.weatherStatVal}>{wind}{windLabel}</Text>
                      <Text style={s.weatherStatLabel}>WIND</Text>
                    </View>
                    {rain > 0 && (
                      <View style={s.weatherStat}>
                        <Text style={[s.weatherStatVal, { color: '#38bdf8' }]}>{rain.toFixed(units?.mode === 'metric' ? 0 : 1)}{rainLabel}</Text>
                        <Text style={s.weatherStatLabel}>RAIN</Text>
                      </View>
                    )}
                  </View>
                </View>
              );
            })}
          </>
        )}
      </ScrollView>

      <PaywallModal
        visible={paywallVisible}
        code={paywallCode}
        message={paywallMessage}
        onClose={() => setPaywallVisible(false)}
      />

      <PremiumPlaceSheet
        place={selectedLivePlace}
        visible={!!selectedLivePlace}
        initialStage="half"
        onClose={() => setSelectedLivePlace(null)}
        onNavigate={place => {
          setPendingNavigatePlace({ lat: place.lat, lng: place.lng, name: place.name });
          setSelectedLivePlace(null);
          router.push('/(tabs)/map');
        }}
      />

      <Modal visible={!!selectedExplore} animationType="slide" onRequestClose={() => setSelectedExplore(null)}>
        {selectedExplore && (
          <ExploreDetailSheet
            place={selectedExplore}
            tab={profileReadMode}
            onTabChange={setProfileReadMode}
            imageUrl={mediaUrl(selectedExplore.summary.image_url || selectedExplore.summary.thumbnail_url)}
            topInset={insets.top}
            saved={isExploreSaved(selectedExplore)}
            isPlaying={playing === `explore:${selectedExplore.id}`}
            context={{
              campCount: exploreCampgroundsById[selectedExplore.id]?.length,
              relatedCount: relatedExplore.length,
            }}
            storySentences={splitStorySentences(storyTextForPlace(selectedExplore))}
            highlightedSentence={highlightSentence}
            storyScrollRef={storyScrollRef}
            campgroundsSlot={renderExploreCampgrounds(selectedExplore)}
            trailStatusSlot={renderExploreTrailStatus(selectedExplore)}
            weatherSlot={renderExploreWeather(selectedExplore)}
            relatedSlot={relatedExplore.length > 0 ? (
              <TrailheadCard style={s.profileSection}>
                <Text style={s.profileLabel}>NEAR THIS STOP</Text>
                <Text style={s.profileTextMuted}>Nearby parks, camp areas, trails, and stops.</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.relatedExploreRail}>
                  {relatedExplore.map((item, idx) => renderExploreCard(item, idx, true))}
                </ScrollView>
              </TrailheadCard>
            ) : null}
            onClose={() => setSelectedExplore(null)}
            onPlayAudio={() => playExplore(selectedExplore)}
            onShowArea={() => showExploreOnMap(selectedExplore)}
            onRoute={() => routeExplore(selectedExplore)}
            onToggleSave={() => toggleSavedExplore(selectedExplore)}
            onNearbyAction={module => handleExploreNearbyAction(selectedExplore, module)}
            onTrailMap={trail => showExploreTrailOnMap(selectedExplore, trail)}
            onTrailRoute={trail => routeExploreTrail(selectedExplore, trail)}
            mediaUrl={mediaUrl}
          />
        )}
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (C: ColorPalette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderColor: C.border, backgroundColor: C.s1,
  },
  headerTitle: { color: C.text, fontSize: 14, fontWeight: '800', fontFamily: mono, letterSpacing: 0.5 },
  headerSub: { color: C.text3, fontSize: 11, marginTop: 2 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  betaPill: { borderWidth: 1, borderColor: C.orange + '55', backgroundColor: C.orangeGlow, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  betaPillText: { color: C.orange, fontSize: 9, fontFamily: mono, fontWeight: '900', letterSpacing: 0.7 },
  autoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.s2,
  },
  autoBtnOn: { borderColor: C.orange, backgroundColor: C.orangeGlow },
  autoBtnText: { color: C.text3, fontSize: 10, fontFamily: mono, fontWeight: '700' },
  landingHeader: { marginHorizontal: -14, marginTop: -14, backgroundColor: C.s1, borderBottomWidth: 1, borderColor: C.border },
  heroShell: { height: 330, backgroundColor: C.s1, overflow: 'hidden' },
  heroImage: { width: '100%', height: '100%' },
  heroImageFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1f2937' },
  heroOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.32)' },
  heroContent: { position: 'absolute', left: 18, right: 18, bottom: 18 },
  heroGreeting: { color: '#fff', fontSize: 16, lineHeight: 21, fontWeight: '800' },
  heroTitle: { color: '#fff', fontSize: 42, lineHeight: 44, fontWeight: '900', marginTop: 8 },
  heroSub: { color: 'rgba(255,255,255,0.92)', fontSize: 17, lineHeight: 24, fontWeight: '700', marginTop: 10, maxWidth: 330 },
  heroSearch: {
    minHeight: 58,
    marginTop: 24,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.96)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  heroSearchInput: { flex: 1, minWidth: 0, color: '#111827', fontSize: 16, paddingVertical: 13 },
  heroSearchIconBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  tabs: { flexDirection: 'row', backgroundColor: C.s1 },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: C.orange },
  tabInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tabText: { color: C.text3, fontSize: 11, fontFamily: mono, fontWeight: '900' },
  tabTextActive: { color: C.orange },
  scroll: { flex: 1 },
  scrollContent: { padding: 14, gap: 11, paddingBottom: 122 },
  loadRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 16, backgroundColor: C.s2, borderRadius: 12, borderWidth: 1, borderColor: C.border,
  },
  loadText: { color: C.text2, fontSize: 13 },
  exploreHero: {
    flexDirection: 'row', gap: 12, alignItems: 'center',
    paddingHorizontal: 2, paddingVertical: 4,
  },
  exploreHeroText: { flex: 1 },
  exploreEyebrow: { color: C.orange, fontSize: 10, fontFamily: mono, fontWeight: '900', letterSpacing: 0.8 },
  exploreTitle: { color: C.text, fontSize: 22, fontWeight: '900', marginTop: 5 },
  exploreSub: { color: C.text2, fontSize: 13, lineHeight: 19, marginTop: 6 },
  exploreSearch: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
    paddingHorizontal: 13,
  },
  exploreSearchInput: { flex: 1, minWidth: 0, color: C.text, fontSize: 15, paddingVertical: 12 },
  exploreSearchClear: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.s2,
  },
  modeRow: { flexDirection: 'row', backgroundColor: C.s1, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 4, gap: 4 },
  modeBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12 },
  modeBtnActive: { backgroundColor: C.orangeGlow },
  modeBtnText: { color: C.text3, fontSize: 10, fontFamily: mono, fontWeight: '800' },
  modeBtnTextActive: { color: C.orange },
  narrationToolbar: { minHeight: 58, borderRadius: 16, borderWidth: 1, borderColor: C.border, backgroundColor: C.s1, paddingHorizontal: 13, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  categoryStrip: { gap: 9, paddingRight: 8 },
  categoryPill: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    borderRadius: 13,
    backgroundColor: C.s1,
    borderWidth: 1,
    borderColor: C.border,
  },
  categoryPillText: { color: C.text, fontSize: 12, fontWeight: '900' },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  categoryTile: {
    width: '48%', minHeight: 92, borderRadius: 8,
    backgroundColor: C.s2, borderWidth: 1, borderColor: C.border,
    padding: 12, justifyContent: 'space-between',
  },
  categoryTileIcon: {
    width: 38, height: 38, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  categoryTileText: { color: C.text, fontSize: 14, lineHeight: 18, fontWeight: '900', marginTop: 10 },
  clearCategoryBtn: {
    alignSelf: 'flex-start', minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: 8, borderWidth: 1, borderColor: C.orange + '44',
    backgroundColor: C.orangeGlow, paddingHorizontal: 10,
  },
  clearCategoryText: { color: C.orange, fontSize: 11, fontFamily: mono, fontWeight: '900' },
  exploreSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 4,
  },
  exploreSectionTitle: { color: C.text3, fontSize: 11, fontFamily: mono, fontWeight: '900', letterSpacing: 0.8 },
  exploreSectionSub: { color: C.text3, fontSize: 10, fontFamily: mono },
  exploreSectionLink: { color: C.orange, fontSize: 10, fontFamily: mono, fontWeight: '900' },
  exploreRailSection: { gap: 9 },
  exploreRail: { gap: 12, paddingRight: 8 },
  categoryRow: { gap: 8, paddingVertical: 2 },
  categoryChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: C.border, backgroundColor: C.s1 },
  categoryChipActive: { borderColor: C.orange, backgroundColor: C.orangeGlow },
  categoryText: { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '800' },
  categoryTextActive: { color: C.orange },
  livePlacesBlock: { backgroundColor: C.glassStrong, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 10, gap: 8 },
  livePlacesTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2 },
  livePlacesTitle: { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '900', letterSpacing: 0.8 },
  livePlaceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.glass, borderRadius: 13, padding: 8 },
  livePlacePhoto: { width: 46, height: 46, borderRadius: 11, backgroundColor: C.s2 },
  livePlaceIcon: { width: 46, height: 46, borderRadius: 11, backgroundColor: C.s1, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  livePlaceName: { color: C.text, fontSize: 13, fontWeight: '900' },
  livePlaceMeta: { color: C.text3, fontSize: 10, fontFamily: mono, marginTop: 3 },
  exploreCard: { backgroundColor: C.s2, borderRadius: 16, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  exploreRailCard: { width: 264, backgroundColor: C.s2, borderRadius: 12, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  exploreCardLead: { borderColor: C.orange + '45' },
  exploreImageWrap: { height: 154, backgroundColor: C.s1 },
  exploreRailImageWrap: { height: 126 },
  exploreImage: { width: '100%', height: '100%' },
  exploreImageFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.s1 },
  exploreImageShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.18)' },
  exploreBadge: { position: 'absolute', left: 10, top: 10, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 6 },
  exploreBadgeText: { color: '#fff', fontSize: 8, fontFamily: mono, fontWeight: '900' },
  exploreBody: { flexDirection: 'row', gap: 12, padding: 14 },
  exploreName: { color: C.text, fontSize: 18, fontWeight: '900', lineHeight: 22 },
  exploreRailName: { fontSize: 15, lineHeight: 19 },
  exploreMeta: { color: C.orange, fontSize: 10, fontFamily: mono, marginTop: 5, fontWeight: '800' },
  exploreTrustLine: { color: C.text3, fontSize: 10.5, lineHeight: 15, marginTop: 5, fontWeight: '700' },
  exploreDesc: { color: C.text2, fontSize: 13, lineHeight: 19, marginTop: 8 },
  exploreMapLink: {
    alignSelf: 'flex-start',
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.orange + '44',
    backgroundColor: C.orangeGlow,
  },
  exploreMapLinkText: { color: C.orange, fontSize: 10, fontFamily: mono, fontWeight: '900' },
  exploreActions: { gap: 8, justifyContent: 'center' },
  circleBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.orange + '55', backgroundColor: C.s1 },
  circleBtnActive: { backgroundColor: C.orange, borderColor: C.orange },
  guidePromptCard: { backgroundColor: C.s2, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 18, alignItems: 'flex-start' },
  guidePromptIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: C.orangeGlow, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  guidePromptTitle: { color: C.text, fontSize: 17, fontWeight: '900', marginBottom: 8 },
  guidePromptText: { color: C.text2, fontSize: 13, lineHeight: 20, marginBottom: 14 },
  guideError: { color: C.red, fontSize: 12, lineHeight: 18, marginBottom: 12 },
  generateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, alignSelf: 'stretch', backgroundColor: C.orange, borderRadius: 12, paddingVertical: 13 },
  generateBtnText: { color: '#fff', fontSize: 12, fontFamily: mono, fontWeight: '900' },
  card: { backgroundColor: C.s2, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14 },
  cardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  dayBadge: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.orange, alignItems: 'center', justifyContent: 'center' },
  dayBadgeText: { color: '#fff', fontSize: 12, fontWeight: '800', fontFamily: mono },
  wpName: { color: C.text, fontSize: 13, fontWeight: '700' },
  wpMeta: { color: C.text3, fontSize: 10, fontFamily: mono, marginTop: 2 },
  playBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: C.orange, alignItems: 'center', justifyContent: 'center' },
  playBtnActive: { backgroundColor: C.orange, borderColor: C.orange },
  playBtnDisabled: { borderColor: C.border },
  narration: { color: C.text2, fontSize: 13, lineHeight: 20 },
  narrationMissing: { color: C.text3, fontSize: 12 },
  nearbyCard: { backgroundColor: C.s2, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 16, gap: 10 },
  nearbyLabel: { color: C.orange, fontSize: 10, fontFamily: mono, fontWeight: '700', letterSpacing: 0.5 },
  nearbySub: { color: C.text3, fontSize: 12 },
  nearbyText: { color: C.text2, fontSize: 13, lineHeight: 20 },
  nearbyBtn: { backgroundColor: C.orange, borderRadius: 10, padding: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, shadowColor: C.orange, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.35, shadowRadius: 8 },
  nearbyBtnText: { color: '#fff', fontWeight: '700', fontSize: 12, fontFamily: mono, letterSpacing: 0.3 },
  weatherCard: { backgroundColor: C.s2, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, gap: 12 },
  weatherCardTop: { flexDirection: 'row', alignItems: 'center' },
  weatherStatsRow: { flexDirection: 'row', gap: 0 },
  weatherStat: { flex: 1, alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderColor: C.border },
  weatherStatVal: { color: C.text, fontSize: 13, fontWeight: '700', fontFamily: mono },
  weatherStatLabel: { color: C.text3, fontSize: 8, fontFamily: mono, letterSpacing: 0.5, marginTop: 2 },
  exploreWeatherCard: { marginHorizontal: 20, marginBottom: 16, backgroundColor: C.s2, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, gap: 12 },
  exploreTrailStatusCard: { marginHorizontal: 20, marginBottom: 14, backgroundColor: C.s2, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, gap: 12 },
  exploreWeatherTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  exploreWeatherSub: { color: C.text3, fontSize: 12, fontWeight: '700' },
  exploreWeatherText: { color: C.text2, fontSize: 13, lineHeight: 19, fontWeight: '700' },
  exploreWeatherStats: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10 },
  exploreWeatherStat: { flex: 1, alignItems: 'center', minWidth: 0 },
  exploreWeatherValue: { color: C.text, fontSize: 13, fontWeight: '900', fontFamily: mono },
  exploreWeatherLabel: { color: C.text3, fontSize: 8, fontWeight: '900', fontFamily: mono, marginTop: 3 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 80 },
  emptyTitle: { color: C.text, fontSize: 17, fontWeight: '700' },
  emptySub: { color: C.text3, fontSize: 13, textAlign: 'center', maxWidth: 280, lineHeight: 20 },
  modal: { flex: 1, backgroundColor: C.bg },
  profileScroll: { paddingBottom: 34 },
  profileHero: { height: 310, backgroundColor: C.s1 },
  profileImage: { width: '100%', height: '100%' },
  profileImageFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.s1 },
  profileShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.28)' },
  profileHeroText: { position: 'absolute', left: 18, right: 18, bottom: 20 },
  profileHeroClose: { position: 'absolute', right: 14, width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(0,0,0,0.36)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.32)', alignItems: 'center', justifyContent: 'center' },
  profileCategory: { color: C.orange, fontSize: 11, fontFamily: mono, fontWeight: '900', letterSpacing: 0.7 },
  profileTitle: { color: '#fff', fontSize: 31, lineHeight: 36, fontWeight: '900', marginTop: 6 },
  profileActions: { flexDirection: 'row', gap: 10, padding: 14 },
  profileActionBtn: { flex: 1, backgroundColor: C.orange, borderRadius: 13, paddingVertical: 13, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  profileActionSecondary: { backgroundColor: C.s2, borderWidth: 1, borderColor: C.orange + '55' },
  profileActionText: { color: '#fff', fontSize: 11, fontFamily: mono, fontWeight: '900' },
  readModeRow: { flexDirection: 'row', marginHorizontal: 14, marginTop: 2, borderWidth: 1, borderColor: C.border, backgroundColor: C.s1, borderRadius: 13, padding: 4, gap: 4 },
  readModeBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10 },
  readModeBtnActive: { backgroundColor: C.orangeGlow },
  readModeText: { color: C.text3, fontSize: 10, fontFamily: mono, fontWeight: '900' },
  readModeTextActive: { color: C.orange },
  profileSection: { marginHorizontal: 14, marginTop: 10, backgroundColor: C.s2, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14 },
  campgroundSection: { marginHorizontal: 14, marginTop: 2, marginBottom: 8, backgroundColor: C.s2, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14 },
  campgroundSectionTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  campgroundSectionSub: { color: C.text3, fontSize: 12, lineHeight: 17 },
  campgroundAreaBtn: { height: 36, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: C.orange + '55', backgroundColor: C.orangeGlow, flexDirection: 'row', alignItems: 'center', gap: 5 },
  campgroundAreaBtnText: { color: C.orange, fontSize: 10, fontFamily: mono, fontWeight: '900' },
  campgroundLoadRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 18 },
  campgroundLoadText: { color: C.text3, fontSize: 12, fontWeight: '700' },
  campgroundRail: { gap: 12, paddingTop: 12, paddingRight: 2 },
  campgroundCard: { width: 236, backgroundColor: C.s1, borderRadius: 12, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  campgroundImageWrap: { height: 126, backgroundColor: C.s2 },
  campgroundImage: { width: '100%', height: '100%' },
  campgroundImageFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.s1 },
  campgroundImageShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.16)' },
  campgroundBadge: { position: 'absolute', left: 9, top: 9, maxWidth: 168, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(15,23,42,0.78)' },
  campgroundBadgeText: { color: '#fff', fontSize: 8, fontFamily: mono, fontWeight: '900', letterSpacing: 0.4 },
  campgroundPhotoNote: { position: 'absolute', right: 9, bottom: 9, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(15,23,42,0.72)' },
  campgroundPhotoNoteText: { color: '#fff', fontSize: 8, fontFamily: mono, fontWeight: '900', letterSpacing: 0.4 },
  campgroundBody: { padding: 11, gap: 7 },
  campgroundName: { color: C.text, fontSize: 15, lineHeight: 19, fontWeight: '900' },
  campgroundMeta: { color: C.text3, fontSize: 11, fontWeight: '700' },
  campgroundCost: { color: C.orange, fontSize: 12, fontWeight: '900' },
  campgroundTags: { minHeight: 24, flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  campgroundTag: { borderWidth: 1, borderColor: C.border, backgroundColor: C.s2, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 4 },
  campgroundTagText: { color: C.text3, fontSize: 8, fontFamily: mono, fontWeight: '900' },
  campgroundActions: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 2 },
  campgroundOpenBtn: { flex: 1, height: 34, borderRadius: 9, backgroundColor: C.orange, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  campgroundOpenText: { color: '#fff', fontSize: 10, fontFamily: mono, fontWeight: '900' },
  campgroundSourceBtn: { width: 34, height: 34, borderRadius: 9, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', backgroundColor: C.s2 },
  campgroundEmpty: { marginTop: 12, paddingVertical: 18, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.s1, alignItems: 'center', gap: 7 },
  campgroundEmptyText: { color: C.text3, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  profileHook: { color: C.text, fontSize: 17, lineHeight: 25, fontWeight: '800' },
  relatedExploreRail: { gap: 12, paddingTop: 12, paddingRight: 2 },
  storyReadBox: { maxHeight: 390, borderRadius: 12, backgroundColor: C.s1, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, paddingVertical: 10 },
  storySentence: { color: C.text2, fontSize: 17, lineHeight: 28, fontWeight: '600' },
  storySentenceActive: { color: C.text, backgroundColor: C.orange + '22', borderRadius: 8 },
  profileLabel: { color: C.orange, fontSize: 10, fontFamily: mono, fontWeight: '900', letterSpacing: 0.8, marginBottom: 7 },
  profileText: { color: C.text2, fontSize: 14, lineHeight: 22 },
  profileTextMuted: { color: C.text3, fontSize: 12.5, lineHeight: 18 },
  profileTrustGrid: { gap: 10 },
  profileTrustCell: { borderWidth: 1, borderColor: C.border, borderRadius: 12, backgroundColor: C.s1, padding: 12, gap: 5 },
  profileTrustHeading: { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '900', letterSpacing: 0.6 },
  profileTrustText: { color: C.text, fontSize: 13, lineHeight: 19, fontWeight: '700' },
  sourcePackTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  sourcePackBadge: { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '900', letterSpacing: 0.5 },
  sourcePackLabel: { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '900', letterSpacing: 0.6, marginTop: 13, marginBottom: 6 },
  sourcePillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  sourcePill: { borderWidth: 1, borderColor: C.border, backgroundColor: C.s1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  sourcePillText: { color: C.text2, fontSize: 11, fontWeight: '700' },
  npsRail: { gap: 10, paddingRight: 4 },
  npsMiniCard: { width: 218, backgroundColor: C.s1, borderRadius: 12, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  npsMiniImage: { width: '100%', height: 86, backgroundColor: C.s2 },
  npsMiniBody: { padding: 10 },
  npsMiniTitle: { color: C.text, fontSize: 13, lineHeight: 17, fontWeight: '800' },
  npsMiniDesc: { color: C.text3, fontSize: 11, lineHeight: 16, marginTop: 5 },
  alertRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 5 },
  alertText: { flex: 1, color: C.text2, fontSize: 13, lineHeight: 19 },
  sourceBtn: { margin: 14, flexDirection: 'row', gap: 8, alignItems: 'center', borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 12 },
  sourceText: { flex: 1, color: C.text3, fontSize: 11, lineHeight: 16 },
});
