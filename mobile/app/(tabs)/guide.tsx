import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, Animated,
  Image, Modal, Linking, TextInput, useWindowDimensions, Alert, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import TourTarget from '@/components/TourTarget';
import PaywallModal from '@/components/PaywallModal';
import PremiumPlaceSheet from '@/components/PremiumPlaceSheet';
import { TrailheadButton, TrailheadCard, TrailheadCardSkeleton, TrailheadLoadingRow } from '@/components/TrailheadUI';
import {
  EXPLORE_CATEGORY_CHIPS,
  ExploreCategoryFilterSheet,
  ExploreDetailSheet,
  ExploreExperiencesRail,
  ExploreHero,
  ExploreHomeControls,
  ExplorePlaceCard,
  GUIDED_DESTINATIONS,
  GuidedDestinationBrowser,
  GuidedTripDetailModal,
  exploreCategoryFromQuery,
  exploreCategoryMatches,
  exploreContentQualityScore,
  exploreQueryScore as scoreExploreQuery,
  exploreTrustScore as scoreExploreTrust,
  getExploreCategoryKey,
  getExploreCardSummary,
  getExplorePrimarySourceLabel,
  getExploreTrailCards,
  isExploreThinOpenReference,
  mergeCuratedExplorePlaces,
  type ExploreCategoryKey,
  type ExploreDetailTab,
  type ExploreDetailWeather,
  type ExploreNearbyModule,
  type ExploreSortMode,
  type GuidedDestination,
} from '@/components/explore';
import { useStore } from '@/lib/store';
import { api, PaywallError, type BookableExperience, type CampsitePin, type ExploreCatalogIndexItem, type ExploreExperienceQueryOptions, type ExploreExperiencesResponse, type ExploreGuidedDestination, type ExploreGuidedDestinationResponse, type ExplorePlaceProfile, type ExploreSourcePackItem, type ExploreTrailCard, type OsmPoi, type TrailProfile } from '@/lib/api';
import { TRAILHEAD_API_BASE } from '@/lib/apiBase';
import { accountStorage, storage } from '@/lib/storage';
import { useTheme, mono, ColorPalette } from '@/lib/design';
import { trackPhase0Once } from '@/lib/telemetry';
import { playTrailheadVoice, stopTrailheadVoice } from '@/lib/voice';
import {
  addEntityToTrip,
  createTripFromEntity,
  getSavedEntity,
  getTrip,
  getTripRepositorySnapshot,
  removeEntity,
  saveEntity,
  upsertTrip,
  useTripRepositorySnapshot,
  type SavedEntityV1,
} from '@/lib/tripRepository';
import {
  addSavedEntityToTripResult,
  canonicalSavedEntityId,
  savedEntityFromExperience,
  savedEntityFromExplorePlace,
  starterTripResult,
  tripDocumentFromTripResult,
} from '@/lib/tripCompatibility';
import {
  cleanExploreSourceLabel,
  sourcePackItemCanShow,
  sourcePackThingToDoCanShow,
  sourcePackThingToSeeCanShow,
  uniqueRelatedPlaces,
} from '@/lib/exploreContextFilters';
import {
  resolveExploreNearbySearchCenter,
  serviceDestinationQueryFromExploreQuery,
} from '@/lib/exploreNearbyContext';

const EXPLORE_CACHE_KEY = 'trailhead_explore_catalog_index_v3';
const EXPLORE_CAMPGROUNDS_CACHE_PREFIX = 'trailhead_explore_campgrounds_v1:';
const EXPLORE_TRAIL_AREA_CACHE_PREFIX = 'trailhead_explore_trail_area_v2:';
const EXPLORE_EXPERIENCES_CACHE_PREFIX = 'trailhead_explore_experiences_v1:';
const EXPLORE_GUIDED_FALLBACK_CACHE_PREFIX = 'trailhead_explore_guided_fallback_v1:';
const EXPLORE_INITIAL_VISIBLE = 48;
const EXPLORE_VISIBLE_STEP = 48;
const API_BASE = TRAILHEAD_API_BASE;
const BOOKABLE_EXPERIENCES_ENABLED = true;

type ExploreCatalogPageSpec = {
  key: string;
  q: string;
  category: string;
  sort: string;
  lat?: number;
  lng?: number;
};

type ExploreCatalogPageState = {
  nextCursor: number | null;
  totalCount: number;
  loading: boolean;
};

function exploreCatalogPageSpec(
  q: string,
  category: string,
  sort: ExploreSortMode,
  lat?: number,
  lng?: number,
): ExploreCatalogPageSpec {
  const cleanQuery = q.trim();
  const cleanCategory = category.trim();
  const serverSort = sort === 'source' ? 'ready' : sort;
  const located = serverSort === 'nearest' && lat != null && lng != null;
  const cleanLat = located ? Number(lat) : undefined;
  const cleanLng = located ? Number(lng) : undefined;
  return {
    key: [
      normalizeExploreText(cleanQuery),
      cleanCategory,
      serverSort,
      cleanLat == null ? '' : cleanLat.toFixed(5),
      cleanLng == null ? '' : cleanLng.toFixed(5),
    ].join('|'),
    q: cleanQuery,
    category: cleanCategory,
    sort: serverSort,
    lat: cleanLat,
    lng: cleanLng,
  };
}

function livePlaceMatchesCategory(place: OsmPoi, category: ExploreCategoryKey) {
  if (category !== 'fuel' && category !== 'resupply') return true;
  const details = place as OsmPoi & { category?: string; tags?: string[] };
  const text = [place.type, place.subtype, place.name, details.category, details.tags?.join(' ')]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (category === 'fuel') return /\b(fuel|gas|diesel|petrol|service station)\b/.test(text);
  return /\b(grocery|market|food|hardware|mechanic|repair|medical|pharmacy|parts|supplies|resupply)\b/.test(text);
}

function safelyRemoveSubscription(subscription: { remove?: () => unknown } | null | undefined) {
  try {
    subscription?.remove?.();
  } catch {}
}

type GuidedTourCategory = 'all' | 'outdoor' | 'water' | 'short' | 'private' | 'family';
type GuidedTourSort = 'top_rated' | 'price';
type GuidedTourDate = 'any' | 'today' | 'weekend' | 'custom';

const GUIDED_CATEGORY_OPTIONS: Array<{ key: GuidedTourCategory; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { key: 'all', label: 'All', icon: 'compass-outline' },
  { key: 'outdoor', label: 'Outdoors', icon: 'trail-sign-outline' },
  { key: 'water', label: 'Water', icon: 'water-outline' },
  { key: 'short', label: 'Half-day', icon: 'time-outline' },
  { key: 'private', label: 'Private', icon: 'person-outline' },
  { key: 'family', label: 'Family', icon: 'happy-outline' },
];

const GUIDED_SORT_OPTIONS: Array<{ key: GuidedTourSort; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { key: 'top_rated', label: 'Recommended', icon: 'star-outline' },
  { key: 'price', label: 'Lowest price', icon: 'pricetag-outline' },
];

const GUIDED_DATE_OPTIONS: Array<{ key: GuidedTourDate; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { key: 'any', label: 'Any', icon: 'calendar-outline' },
  { key: 'today', label: 'Today', icon: 'sunny-outline' },
  { key: 'weekend', label: 'Weekend', icon: 'calendar-number-outline' },
];
const FEATURED_SECTION_ORDER: ExploreCategoryKey[] = [
  'camp',
  'glamping',
  'trails',
  'huts',
  'views',
  'waterfalls',
  'peaks',
  'springs',
  'climb',
  'water',
  'scenic',
  'parks',
  'land',
  'trailheads',
  'things',
  'guided',
];

const HOME_SHELF_ASSIGNMENT_ORDER: ExploreCategoryKey[] = [
  'parks',
  'land',
  'trails',
  'trailheads',
  'camp',
  'glamping',
  'huts',
  'views',
  'waterfalls',
  'peaks',
  'springs',
  'things',
  'guided',
  'climb',
  'water',
  'scenic',
];

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

function exploreCategoryLabel(key: ExploreCategoryKey) {
  if (key === 'huts') return 'Cabins';
  if (key === 'parks') return 'National Parks';
  return EXPLORE_CATEGORY_CHIPS.find(item => item.key === key)?.label ?? 'Explore';
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
  if (mi <= 0) return '';
  if (mi < 1) return 'Under 1 mi';
  if (mi >= 10) return `${Math.round(mi)} mi`;
  const rounded = Number(mi.toFixed(1));
  return `${Number.isInteger(rounded) ? Math.round(rounded) : rounded} mi`;
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
  if (isPakistanCuratedExplorePlace(place)) return false;
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

function shouldSearchBookableExperiences(query: string, category: ExploreCategoryKey) {
  if (!BOOKABLE_EXPERIENCES_ENABLED) return false;
  if (category === 'guided' || category === 'tours') return true;
  return /\b(tour|tours|experience|experiences|ticket|tickets|guide|guided|book|booking|jeep tour|rafting tour|boat tour|shuttle)\b/i.test(query);
}

function isExplicitTourOnlyQuery(query: string) {
  return /\b(tour|tours|ticket|tickets|guide|guided|booking|book)\b/i.test(query);
}

function isThingsToDoExploreQuery(query: string) {
  return /\b(things to do|what to do|activity|activities|see and do)\b/i.test(query) && !isExplicitTourOnlyQuery(query);
}

function placeQueryFromExploreQuery(query: string) {
  return query
    .replace(/\b(things to do|what to do|see and do|tour|tours|experience|experiences|activity|activities|ticket|tickets|guide|guided|book|booking)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type GuidedSearchCenter = { lat: number; lng: number; name: string };

const GUIDED_TOUR_DESTINATION_CENTERS: Array<GuidedSearchCenter & { terms: string[] }> = [
  ...GUIDED_DESTINATIONS.map(destination => ({
    name: destination.name,
    lat: destination.lat,
    lng: destination.lng,
    terms: destination.terms,
  })),
];

function guidedDestinationsFromApi(items?: ExploreGuidedDestination[]) {
  if (!Array.isArray(items)) return [];
  return items.map(item => {
    const rawGroup = String(item.collection || '').toLowerCase();
    const group: GuidedDestination['group'] = rawGroup === 'mountain'
      ? 'Mountain'
      : rawGroup === 'desert'
        ? 'Desert'
        : rawGroup === 'water'
          ? 'Water'
          : 'Worldwide';
    const searchQuery = String(item.search_query || item.name || '').trim();
    return {
      id: String(item.id || item.slug || searchQuery),
      name: String(item.name || searchQuery),
      region: String(item.region || item.country || ''),
      group,
      lat: Number(item.lat),
      lng: Number(item.lng),
      searchQuery,
      imageUrl: mediaUrl(item.image_url),
      imageAlt: String(item.image_alt || item.name || '').trim(),
      imageCredit: String(item.image_credit || '').trim(),
      imageLicense: String(item.image_license || '').trim(),
      imageLicenseUrl: String(item.image_license_url || '').trim(),
      imageSourceUrl: String(item.image_source_url || '').trim(),
      terms: [searchQuery, item.name, ...(item.aliases ?? [])].map(value => String(value || '').toLowerCase()).filter(Boolean),
    };
  }).filter(item => item.id && item.name && Number.isFinite(item.lat) && Number.isFinite(item.lng)).slice(0, 25);
}

function guidedTourKnownDestinationCenter(query: string): GuidedSearchCenter | null {
  const clean = normalizeExploreText(placeQueryFromExploreQuery(query));
  if (clean.length < 2) return null;
  const found = GUIDED_TOUR_DESTINATION_CENTERS.find(center =>
    center.terms.some(term => clean === term || clean.includes(term)),
  );
  return found ? { lat: found.lat, lng: found.lng, name: found.name } : null;
}

function formatTourDate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addTourDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function parseTourDate(value?: string) {
  const clean = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return null;
  const parsed = new Date(`${clean}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function tourDateLabel(value?: string) {
  const parsed = parseTourDate(value);
  if (!parsed) return '';
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function guidedTourDateWindow(value: GuidedTourDate, customDate = '') {
  const today = new Date();
  if (value === 'today') {
    const date = formatTourDate(today);
    return { startDate: date, endDate: date };
  }
  if (value === 'weekend') {
    const start = new Date(today);
    const day = start.getDay();
    const daysUntilSaturday = (6 - day + 7) % 7;
    start.setDate(start.getDate() + daysUntilSaturday);
    const end = new Date(start);
    end.setDate(start.getDate() + 1);
    return { startDate: formatTourDate(start), endDate: formatTourDate(end) };
  }
  if (value === 'custom') {
    const date = parseTourDate(customDate);
    const clean = date ? formatTourDate(date) : '';
    return { startDate: clean, endDate: clean };
  }
  return { startDate: '', endDate: '' };
}

function guidedTourQueryOptions(category: GuidedTourCategory, sort: GuidedTourSort, date: GuidedTourDate, customDate: string, freeCancel: boolean): ExploreExperienceQueryOptions {
  const window = guidedTourDateWindow(date, customDate);
  return {
    category: category === 'all' ? '' : category,
    free_cancel: freeCancel,
    start_date: window.startDate,
    end_date: window.endDate,
    sort: sort === 'price' ? 'price_low_to_high' : 'top_rated',
    order: sort === 'price' ? 'ascending' : 'descending',
  };
}

function guidedTourDateLabel(date: GuidedTourDate, customDate = '') {
  if (date === 'today') return 'Today';
  if (date === 'weekend') return 'This weekend';
  if (date === 'custom') return tourDateLabel(customDate) || 'Pick a date';
  return 'Any date';
}

function guidedTourFilterSummary(category: GuidedTourCategory, sort: GuidedTourSort, freeCancel: boolean, englishOnly: boolean) {
  const categoryLabel = GUIDED_CATEGORY_OPTIONS.find(item => item.key === category)?.label || 'All';
  const sortLabel = GUIDED_SORT_OPTIONS.find(item => item.key === sort)?.label || 'Recommended';
  const details = [categoryLabel, sortLabel];
  if (freeCancel) details.push('Free cancellation');
  if (englishOnly) details.push('English');
  return details.join(' · ');
}

function experienceMatchesEnglishFilter(experience: BookableExperience) {
  const languages = Array.isArray(experience.languages) ? experience.languages.map(value => String(value || '').toLowerCase()) : [];
  if (!languages.length) return true;
  return languages.some(language => /\b(en|eng|english)\b/.test(language));
}

function mergeMatchedExplorePlaces(current: ExplorePlaceProfile[], remotePlaces: ExplorePlaceProfile[]) {
  const seen = new Set(current.map(place => place.id));
  const merged = [...current];
  for (const place of remotePlaces) {
    if (!place?.id) continue;
    if (seen.has(place.id)) {
      const index = merged.findIndex(item => item.id === place.id);
      if (index >= 0) {
        const previousRank = Number((merged[index] as any).matched_explore_rank);
        const nextRank = Number((place as any).matched_explore_rank);
        merged[index] = {
          ...merged[index],
          matched_explore_query: (place as any).matched_explore_query || (merged[index] as any).matched_explore_query,
          matched_explore_rank: Number.isFinite(previousRank) && Number.isFinite(nextRank) ? Math.min(previousRank, nextRank) : Number.isFinite(nextRank) ? nextRank : previousRank,
        } as ExplorePlaceProfile;
      }
      continue;
    }
    seen.add(place.id);
    merged.push(place);
  }
  return merged;
}

function experienceSearchMessage(res: ExploreExperiencesResponse, areaName: string) {
  const status = String(res.live_status || '').toLowerCase();
  const message = String(res.live_message || '').trim();
  if (status === 'provider_error' || status === 'disabled') return 'Guided trips are not available right now.';
  if (status === 'processing') {
    return areaName === 'this area'
      ? 'Checking guided trip availability for this area.'
      : `Checking guided trip availability near ${areaName}.`;
  }
  return message || `No bookable trips were returned near ${areaName}. Try another date or destination.`;
}

function guidedDestinationSearchMessage(res: ExploreGuidedDestinationResponse, areaName: string) {
  const status = String(res.provider_status?.status || '').toLowerCase();
  if (!res.live_enabled || status === 'disabled') {
    return `Guided trips are unavailable near ${areaName} right now. Nearby places are shown below.`;
  }
  if (status === 'timeout' || status === 'error') {
    return `Guided trips could not refresh near ${areaName}. Nearby places are shown below.`;
  }
  if (status === 'processing' || status === 'queued') {
    return `Checking guided trip availability near ${areaName}.`;
  }
  return `No guided trips matched near ${areaName}. Try another date or browse the nearby places below.`;
}

function exploreFacetKey(value: string): ExploreCategoryKey | null {
  const clean = normalizeExploreText(value).replace(/\s+/g, '_');
  const direct = EXPLORE_CATEGORY_CHIPS.find(item => item.key === clean)?.key;
  if (direct) return direct;
  const aliases: Record<string, ExploreCategoryKey> = {
    camping: 'camp',
    campground: 'camp',
    campgrounds: 'camp',
    huts_lodging: 'huts',
    lodging: 'huts',
    trail: 'trails',
    trail_area: 'trails',
    parks_land: 'parks',
    public_land: 'land',
    water_scenic: 'water',
    services: 'resupply',
    experience: 'guided',
    experiences: 'guided',
    tour: 'guided',
    tours: 'guided',
  };
  return aliases[clean] ?? null;
}

function exploreFacetCountsFromCatalog(
  catalog: Awaited<ReturnType<typeof api.getExploreCatalogIndex>>,
  places: ExplorePlaceProfile[],
) {
  const raw = catalog.facets?.categories ?? catalog.category_counts ?? {};
  const counts: Partial<Record<ExploreCategoryKey, number>> = {};
  Object.entries(raw).forEach(([key, value]) => {
    const category = exploreFacetKey(key);
    const count = Number(value);
    if (!category || !Number.isFinite(count) || count <= 0) return;
    counts[category] = Math.max(counts[category] ?? 0, count);
  });
  if (Object.keys(counts).length === 0) {
    places.forEach(place => {
      const category = getExploreCategoryKey(place);
      counts[category] = (counts[category] ?? 0) + 1;
    });
  }
  const globalCount = Number(raw.all ?? 0);
  counts.all = globalCount > 0
    ? globalCount
    : Number(catalog.total_count || catalog.count || places.length || 0);
  return counts;
}

function exploreFacetCountsFromPlaces(places: ExplorePlaceProfile[]) {
  const counts: Partial<Record<ExploreCategoryKey, number>> = { all: places.length };
  places.forEach(place => {
    const category = getExploreCategoryKey(place);
    counts[category] = (counts[category] ?? 0) + 1;
  });
  return counts;
}

function exploreRankReason(
  place: ExplorePlaceProfile,
  context: { mode: 'featured' | 'nearby' | 'trip'; query: string; distance?: number | null; day?: number; sort: ExploreSortMode; nearbyName?: string },
) {
  if (context.day != null) return `Close to day ${context.day} of your trip`;
  if (context.mode === 'nearby' && context.distance != null) {
    return `${fmtMi(context.distance)} from ${context.nearbyName || 'your location'}`;
  }
  const query = placeQueryFromExploreQuery(context.query).trim();
  if (query) return `Matches ${query}`;
  const expectedSort = context.sort === 'source' ? 'ready' : context.sort;
  const serverReason = String(place.ranking?.sort || '') === expectedSort
    ? String(place.ranking?.reason || '').trim()
    : '';
  if (serverReason) return serverReason;
  const record = place as ExplorePlaceProfile & {
    verified?: boolean;
    quality_score?: number;
    source_quality?: { label?: string; primary_name?: string; primary_provider?: string };
  };
  const sourceQuality = [record.quality, record.source_quality?.label, place.source_pack?.quality].filter(Boolean).join(' ');
  if (record.verified || /official/i.test(sourceQuality)) {
    const provider = record.source_quality?.primary_name || record.source_quality?.primary_provider || place.source_pack?.primary || place.summary.source_title;
    return provider ? `Official details from ${provider}` : 'Official place details';
  }
  if (context.sort === 'source' && (place.sources?.length || place.source_pack?.sources?.length)) return 'Cross-checked sources';
  if (Number(record.quality_score || 0) >= 80) return 'Strong details for planning';
  if (Array.isArray(record.card?.facts) && record.card.facts.length >= 2) return 'Trip details included';
  return '';
}

function normalizeExploreText(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[’']/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function exploreCatalogQueryForDestinationContext(
  visibleQuery: string,
  category: ExploreCategoryKey,
  guidedQuery: string,
  destinationKey: string | null,
  center: GuidedSearchCenter | null,
) {
  const query = visibleQuery.trim();
  if (
    !query
    || category === 'guided'
    || category === 'tours'
    || !destinationKey
    || !center?.name.trim()
    || normalizeExploreText(query) !== normalizeExploreText(guidedQuery)
  ) {
    return query;
  }
  return center.name.trim();
}

function destinationRootFromTitle(title?: string | null) {
  let clean = normalizeExploreText(String(title || ''));
  if (!clean) return '';
  clean = clean
    .replace(/\b(and\s+(preserve|reserve))\b/g, ' ')
    .replace(/\b(national|state|provincial|regional|county|territorial)\s+(park|monument|preserve|seashore|lakeshore|forest|wilderness|reserve|historic site|historical park|historic park|recreation area)\b/g, ' ')
    .replace(/\b(campgrounds?|campsites?|camping|glamping|huts?|cabins?|lodges?|lodging|base camp|corridor trails?|canyon trails?|high country trails?|coastal trails?|trails?|trailheads?|visitor centers?|parking lots?|parking|things to do|places to stay|where to stay|tours?|activities)\b.*$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean;
}

const EXPLORE_US_STATE_NAMES: Record<string, string> = {
  alabama: 'al',
  alaska: 'ak',
  arizona: 'az',
  arkansas: 'ar',
  california: 'ca',
  colorado: 'co',
  connecticut: 'ct',
  delaware: 'de',
  florida: 'fl',
  georgia: 'ga',
  hawaii: 'hi',
  idaho: 'id',
  illinois: 'il',
  indiana: 'in',
  iowa: 'ia',
  kansas: 'ks',
  kentucky: 'ky',
  louisiana: 'la',
  maine: 'me',
  maryland: 'md',
  massachusetts: 'ma',
  michigan: 'mi',
  minnesota: 'mn',
  mississippi: 'ms',
  missouri: 'mo',
  montana: 'mt',
  nebraska: 'ne',
  nevada: 'nv',
  newhampshire: 'nh',
  newjersey: 'nj',
  newmexico: 'nm',
  newyork: 'ny',
  northcarolina: 'nc',
  northdakota: 'nd',
  ohio: 'oh',
  oklahoma: 'ok',
  oregon: 'or',
  pennsylvania: 'pa',
  rhodeisland: 'ri',
  southcarolina: 'sc',
  southdakota: 'sd',
  tennessee: 'tn',
  texas: 'tx',
  utah: 'ut',
  vermont: 'vt',
  virginia: 'va',
  washington: 'wa',
  westvirginia: 'wv',
  wisconsin: 'wi',
  wyoming: 'wy',
};

function exploreRegionDedupeKey(place: ExplorePlaceProfile) {
  const raw = normalizeExploreText([
    place.summary.state,
    place.summary.region,
  ].filter(Boolean).join(' '));
  if (!raw) return '';
  const firstToken = raw.split(/\s+/)[0] || '';
  if (/^[a-z]{2}$/.test(firstToken)) return firstToken;
  const compact = raw.replace(/\s+/g, '');
  if (/^[a-z]{2}$/.test(compact)) return compact;
  for (const [name, code] of Object.entries(EXPLORE_US_STATE_NAMES)) {
    if (compact.includes(name)) return code;
  }
  return raw;
}

function exploreDisplayDedupeKey(place: ExplorePlaceProfile) {
  const key = getExploreCategoryKey(place);
  const group = key === 'land' ? 'parks' : key;
  if (!['parks', 'camp', 'glamping', 'huts', 'trails', 'trailheads', 'views', 'waterfalls', 'peaks', 'scenic', 'things'].includes(group)) {
    return '';
  }
  const root = destinationRootFromTitle(place.summary.title);
  if (root.length < 4) return '';
  const region = exploreRegionDedupeKey(place);
  if (group === 'parks') return `${group}:${root}:${region || 'global'}`;
  const lat = Number(place.summary.lat);
  const lng = Number(place.summary.lng);
  const area = Number.isFinite(lat) && Number.isFinite(lng) ? `${lat.toFixed(2)}:${lng.toFixed(2)}` : region;
  return area ? `${group}:${root}:${area}` : '';
}

function exploreDedupePreference(place: ExplorePlaceProfile) {
  const title = normalizeExploreText(place.summary.title || '');
  const descriptionLength = String(place.summary.short_description || place.profile?.summary || '').length;
  const designationBonus = /\bnational park and preserve\b/.test(title) ? 35
    : /\bnational park\b/.test(title) ? 20
      : /\bnational monument\b/.test(title) ? 16
        : 0;
  return designationBonus
    + scoreExploreTrust(place)
    + exploreContentQualityScore(place)
    + Math.min(descriptionLength / 12, 28)
    - Math.min(Number(place.summary.rank ?? 999999), 999999) / 100000;
}

function stableMatchedExploreRank(place: ExplorePlaceProfile) {
  const rank = Number((place as any).matched_explore_rank);
  return Number.isFinite(rank) ? rank : Number.POSITIVE_INFINITY;
}

function dedupeRankedExploreItems<T extends { place: ExplorePlaceProfile }>(items: T[]) {
  const deduped: T[] = [];
  const indexByKey = new Map<string, number>();
  for (const item of items) {
    const key = exploreDisplayDedupeKey(item.place);
    if (!key) {
      deduped.push(item);
      continue;
    }
    const existingIndex = indexByKey.get(key);
    if (existingIndex == null) {
      indexByKey.set(key, deduped.length);
      deduped.push(item);
      continue;
    }
    const current = deduped[existingIndex];
    if (exploreDedupePreference(item.place) > exploreDedupePreference(current.place)) {
      deduped[existingIndex] = item;
    }
  }
  return deduped;
}

function explorePlaceSearchText(place: ExplorePlaceProfile) {
  const pack = place.source_pack ?? {};
  const nestedTitles = [
    ...((pack.things_to_do ?? []) as ExploreSourcePackItem[]),
    ...((pack.things_to_see ?? []) as ExploreSourcePackItem[]),
    ...((pack.visitor_centers ?? []) as ExploreSourcePackItem[]),
    ...((pack.campgrounds ?? []) as ExploreSourcePackItem[]),
  ].flatMap(item => [item?.title, item?.description, item?.url]);
  return normalizeExploreText([
    place.id,
    place.category,
    place.summary.title,
    place.summary.category,
    place.summary.explore_group,
    place.summary.state,
    place.summary.region,
    place.summary.hook,
    place.summary.short_description,
    (place as any).canonical_role,
    (place as any).parent_hub_id,
    (place as any).parent_hub_title,
    (place as any).module_target,
    place.profile?.summary,
    place.profile?.why_it_matters,
    (place as any).search_blob,
    ...(place.subcategories ?? []),
    ...(place.summary.tags ?? []),
    ...((place as any).search_aliases ?? []),
    ...nestedTitles,
  ].filter(Boolean).join(' '));
}

function canonicalExploreModuleTarget(place: ExplorePlaceProfile): ExploreDetailTab | null {
  const target = String((place as any).module_target || '').toLowerCase().trim();
  const valid: ExploreDetailTab[] = ['summary', 'see', 'do', 'stay', 'visitor', 'trails', 'amenities', 'fees', 'alerts', 'calendar', 'weather', 'map', 'story', 'nearby'];
  return valid.includes(target as ExploreDetailTab) ? target as ExploreDetailTab : null;
}

function canonicalExploreParentId(place: ExplorePlaceProfile) {
  return String((place as any).parent_hub_id || '').trim();
}

function canonicalExploreParentTitle(place: ExplorePlaceProfile) {
  return String((place as any).parent_hub_title || '').trim();
}

function isDestinationExploreHub(place: ExplorePlaceProfile) {
  const role = String((place as any).canonical_role || '').toLowerCase();
  if (role === 'hub') return true;
  if (role === 'child' || canonicalExploreParentId(place)) return false;
  const title = normalizeExploreText(place.summary.title || '');
  const categoryText = normalizeExploreText([
    place.category,
    place.summary.category,
    place.summary.explore_group,
    ...(place.subcategories ?? []),
  ].filter(Boolean).join(' '));
  const key = getExploreCategoryKey(place);
  if (place.id.startsWith('place:nps:')) return true;
  if (/\b(national|state|provincial|regional|county|territorial)\s+(park|monument|preserve|seashore|lakeshore|forest|wilderness|reserve|historic site|historical park|recreation area)\b/.test(title)) {
    return true;
  }
  if (/\b(campgrounds?|campsites?|camping|glamping|huts?|cabins?|lodging|trails?|trailheads?|visitor centers?|parking|tours?|guided|activities|things to do|climb|climbing)\b/.test(categoryText)) {
    return false;
  }
  if (['parks', 'land'].includes(key) && /\b(park|monument|preserve|forest|wilderness|reserve|seashore|lakeshore)\b/.test(title)) {
    return true;
  }
  if (key === 'peaks' && !/\b(base camp|trek|trail|campground|hut|cabin)\b/.test(title)) return true;
  if (/\bglacier\b/.test(title) && !/\b(trail|campground|hut|cabin)\b/.test(title)) return true;
  return false;
}

function isNestedExploreChildCandidate(place: ExplorePlaceProfile) {
  const role = String((place as any).canonical_role || '').toLowerCase();
  if (role === 'hub') return false;
  if (role === 'child' || canonicalExploreParentId(place)) return true;
  if (isDestinationExploreHub(place)) return false;
  const key = getExploreCategoryKey(place);
  if (['camp', 'glamping', 'huts', 'trails', 'trailheads', 'climb', 'things', 'guided', 'tours'].includes(key)) return true;
  const text = normalizeExploreText([
    place.id,
    place.summary.title,
    place.summary.category,
    place.summary.explore_group,
    place.category,
    ...(place.subcategories ?? []),
    ...(place.summary.tags ?? []),
  ].filter(Boolean).join(' '));
  return /\b(campgrounds?|campsites?|camping|glamping|huts?|cabins?|lodges?|lodging|trails?|trailheads?|visitor centers?|parking|tours?|guided|activities|things to do|places to stay|base camp|trek)\b/.test(text);
}

function isLegacyExploreAreaWrapper(place: ExplorePlaceProfile) {
  if (!place.id.startsWith('explore:')) return false;
  const title = normalizeExploreText(place.summary.title || '');
  const group = normalizeExploreText(place.summary.explore_group || place.category || place.summary.category || '');
  if (group === 'camping' && /\b(campgrounds?|campsites?|camping)\b/.test(title)) return true;
  if (group === 'glamping' && /\b(glamping|basecamps?|stays?)\b/.test(title)) return true;
  if (group === 'huts lodging' && /\b(lodging|stays?|huts?|cabins?|camps?)\b/.test(title)) return true;
  if (group === 'trails' && /\b(trails?|hikes?|treks?)\b/.test(title)) return true;
  return false;
}

function shouldHideExploreHomeWrapper(place: ExplorePlaceProfile) {
  if (isDestinationExploreHub(place)) return false;
  if ((place as any).hidden_from_featured) return true;
  const role = String((place as any).canonical_role || '').toLowerCase();
  if (role === 'child') return true;
  return isLegacyExploreAreaWrapper(place);
}

function exploreHubMatchDistanceOk(child: ExplorePlaceProfile, hub: ExplorePlaceProfile) {
  if (child.summary.lat == null || child.summary.lng == null || hub.summary.lat == null || hub.summary.lng == null) return true;
  return distMi(
    { lat: Number(child.summary.lat), lng: Number(child.summary.lng) },
    { lat: Number(hub.summary.lat), lng: Number(hub.summary.lng) },
  ) < 180;
}

function findExploreParentHub(child: ExplorePlaceProfile, hubs: ExplorePlaceProfile[]) {
  const explicitParentId = canonicalExploreParentId(child);
  if (explicitParentId) {
    const byId = hubs.find(hub => hub.id === explicitParentId);
    if (byId) return byId;
  }
  const explicitParentTitle = normalizeExploreText(canonicalExploreParentTitle(child));
  if (explicitParentTitle) {
    const byTitle = hubs.find(hub => normalizeExploreText(hub.summary.title || '') === explicitParentTitle);
    if (byTitle) return byTitle;
  }
  const childTitle = normalizeExploreText(child.summary.title || '');
  const childText = explorePlaceSearchText(child);
  const childRoot = destinationRootFromTitle(child.summary.title);
  const childRegionRoot = destinationRootFromTitle(child.summary.region || child.summary.state);
  let best: { hub: ExplorePlaceProfile; score: number } | null = null;
  for (const hub of hubs) {
    const hubRoot = destinationRootFromTitle(hub.summary.title);
    if (hubRoot.length < 3 && !/[a-z]\d|\d/.test(hubRoot)) continue;
    const titleMatch = childTitle.startsWith(`${hubRoot} `) || childRoot === hubRoot || childRoot.startsWith(`${hubRoot} `) || hubRoot.startsWith(`${childRoot} `);
    const textMatch = childText.includes(` ${hubRoot} `) || childText.startsWith(`${hubRoot} `);
    const regionMatch = childRegionRoot && (childRegionRoot === hubRoot || childRegionRoot.startsWith(`${hubRoot} `) || hubRoot.startsWith(`${childRegionRoot} `));
    if (!titleMatch && !textMatch && !regionMatch) continue;
    if (!exploreHubMatchDistanceOk(child, hub)) continue;
    const score = (titleMatch ? 60 : 0) + (regionMatch ? 35 : 0) + (textMatch ? 20 : 0) - Math.min(Number(hub.summary.rank ?? 999999), 999999) / 100000;
    if (!best || score > best.score) best = { hub, score };
  }
  return best?.hub ?? null;
}

function categoryKeysForNestedPlace(place: ExplorePlaceProfile) {
  const keys = new Set<ExploreCategoryKey>([getExploreCategoryKey(place)]);
  const explicitTarget = canonicalExploreModuleTarget(place);
  if (explicitTarget === 'stay') keys.add('camp');
  if (explicitTarget === 'trails') keys.add('trails');
  if (explicitTarget === 'do') keys.add('things');
  if (explicitTarget === 'see') keys.add('views');
  if (explicitTarget === 'visitor') keys.add('parks');
  for (const key of FEATURED_SECTION_ORDER) {
    if (exploreCategoryMatches(place, key)) keys.add(key);
  }
  const text = explorePlaceSearchText(place);
  if (/\b(campgrounds?|campsites?|camping|rv|tent)\b/.test(text)) keys.add('camp');
  if (/\b(glamping|yurt|private stay)\b/.test(text)) keys.add('glamping');
  if (/\b(huts?|cabins?|lodges?|lodging|refuge|shelter)\b/.test(text)) keys.add('huts');
  if (/\b(trails?|hiking|hike|trek|trekking)\b/.test(text)) keys.add('trails');
  if (/\b(trailheads?|access point)\b/.test(text)) keys.add('trailheads');
  if (/\b(visitor center|visitor centres?)\b/.test(text)) keys.add('parks');
  if (/\b(activities|things to do|what to do|see and do)\b/.test(text)) keys.add('things');
  if (/\b(tours?|tickets?|guided|booking|book)\b/.test(text)) keys.add('guided');
  return keys;
}

function exploreTabForNestedPlace(place: ExplorePlaceProfile): ExploreDetailTab {
  const explicitTarget = canonicalExploreModuleTarget(place);
  if (explicitTarget) return explicitTarget;
  const keys = categoryKeysForNestedPlace(place);
  const text = explorePlaceSearchText(place);
  if (/\bvisitor centers?|ranger station|information center\b/.test(text)) return 'visitor';
  if (keys.has('camp') || keys.has('glamping') || keys.has('huts')) return 'stay';
  if (keys.has('trails') || keys.has('trailheads') || keys.has('climb')) return 'trails';
  if (keys.has('things') || keys.has('guided') || keys.has('tours')) return 'do';
  if (keys.has('views') || keys.has('waterfalls') || keys.has('peaks') || keys.has('springs') || keys.has('water') || keys.has('scenic')) return 'see';
  return 'summary';
}

function exploreTabForBrowseIntent(query: string, category: ExploreCategoryKey): ExploreDetailTab {
  const text = normalizeExploreText(`${query} ${category}`);
  if (/\b(camp|campground|campgrounds|camping|glamping|hut|huts|cabin|cabins|lodging|stay|stays)\b/.test(text)) {
    return 'stay';
  }
  if (/\b(trail|trails|trailhead|trailheads|hike|hiking|trek|trekking|climb|climbing)\b/.test(text)) {
    return 'trails';
  }
  if (/\b(tour|tours|activity|activities|ticket|tickets|guided|things to do|what to do|see and do)\b/.test(text)) {
    return 'do';
  }
  if (/\b(view|views|waterfall|waterfalls|scenic|spring|springs|water|mountain|mountains)\b/.test(text)) {
    return 'see';
  }
  return 'summary';
}

function protectedDestinationTitleForExplorePlace(place: ExplorePlaceProfile) {
  const text = explorePlaceSearchText(place);
  const root = destinationRootFromTitle(place.summary.title);
  const designations = [
    'national park and preserve',
    'national park preserve',
    'national park',
    'national monument',
    'national forest',
    'national recreation area',
    'national seashore',
    'national lakeshore',
    'state park',
    'provincial park',
  ];
  if (root && root.length >= 3) {
    for (const designation of designations) {
      const phrase = `${root} ${designation}`;
      if (text.includes(phrase)) return titleCaseExploreDestination(phrase);
    }
  }
  const matches = text.matchAll(/\b(national park|national monument|national forest|national recreation area|national seashore|national lakeshore)\b/g);
  const stopWords = new Set([
    'wikipedia',
    'wikimedia',
    'encyclopedia',
    'source',
    'official',
    'agency',
    'enrichment',
    'added',
    'when',
    'matching',
    'available',
    'near',
    'around',
    'in',
    'and',
    'the',
    'open',
    'linked',
    'for',
    'current',
    'access',
    'pricing',
    'reservation',
    'rules',
    'availability',
    'is',
    'a',
    'an',
  ]);
  for (const match of matches) {
    const words = text.slice(0, match.index).trim().split(/\s+/).slice(-6);
    while (words.length && stopWords.has(words[0])) words.shift();
    const root = words.filter(word => !stopWords.has(word)).join(' ').trim();
    if (!root || root.length < 3 || root.split(' ').length > 5) continue;
    return `${titleCaseExploreDestination(root)} ${titleCaseExploreDestination(match[1])}`;
  }
  return '';
}

function destinationSearchTitlesForExploreChild(place: ExplorePlaceProfile) {
  const terms = new Set<string>();
  const parentTitle = canonicalExploreParentTitle(place);
  if (parentTitle) terms.add(parentTitle);
  const protectedTitle = protectedDestinationTitleForExplorePlace(place);
  if (protectedTitle) terms.add(protectedTitle);
  const text = explorePlaceSearchText(place);
  const root = destinationRootFromTitle(place.summary.title);
  if (root && root.length >= 3 && !/^(ca|ut|az|co|wy|mt|or|wa|nv|id|nm)$/i.test(root)) {
    if (text.includes(`${root} np`) || text.includes(`${root} national park`) || /\bnps\.gov\b/.test(text)) {
      terms.add(`${titleCaseExploreDestination(root)} National Park`);
    }
  }
  [
    destinationRootFromTitle(place.summary.title),
    destinationRootFromTitle(place.summary.region || ''),
    destinationRootFromTitle(place.summary.state || ''),
  ].forEach(term => {
    if (term && term.length >= 3 && !/^(ca|ut|az|co|wy|mt|or|wa|nv|id|nm)$/i.test(term)) {
      terms.add(titleCaseExploreDestination(term));
    }
  });
  return Array.from(terms).slice(0, 3);
}

function shouldResolveExploreWrapperBeforeOpen(place: ExplorePlaceProfile) {
  return isLegacyExploreAreaWrapper(place);
}

function titleCaseExploreDestination(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function buildExploreHubMeta(places: ExplorePlaceProfile[]) {
  const hubs = places.filter(isDestinationExploreHub);
  const parentByChildId = new Map<string, string>();
  const searchTextByHubId = new Map<string, string>();
  const categoryKeysByHubId = new Map<string, Set<ExploreCategoryKey>>();
  for (const child of places) {
    if (!isNestedExploreChildCandidate(child)) continue;
    const parent = findExploreParentHub(child, hubs);
    if (!parent) continue;
    parentByChildId.set(child.id, parent.id);
    searchTextByHubId.set(parent.id, `${searchTextByHubId.get(parent.id) || ''} ${explorePlaceSearchText(child)}`.trim());
    const keys = categoryKeysByHubId.get(parent.id) ?? new Set<ExploreCategoryKey>();
    categoryKeysForNestedPlace(child).forEach(key => keys.add(key));
    categoryKeysByHubId.set(parent.id, keys);
  }
  return { parentByChildId, searchTextByHubId, categoryKeysByHubId };
}

function scoreExploreHubExtraText(place: ExplorePlaceProfile, query: string, extraTextById: Map<string, string>) {
  const normalized = normalizeExploreText(query);
  if (!normalized) return 0;
  const extra = extraTextById.get(place.id);
  if (!extra) return 0;
  const tokens = normalized.split(/\s+/).filter(token => token.length >= 2);
  if (!tokens.length || tokens.some(token => !exploreSearchTextIncludesToken(extra, token))) return 0;
  return 35 + Math.min(tokens.length * 8, 40) + (extra.includes(normalized) ? 20 : 0);
}

function exploreSearchTokenVariants(token: string) {
  const variants = new Set([token]);
  if (token.endsWith('ies') && token.length > 4) variants.add(`${token.slice(0, -3)}y`);
  if (token.endsWith('es') && token.length > 4) variants.add(token.slice(0, -2));
  if (token.endsWith('s') && token.length > 3) variants.add(token.slice(0, -1));
  return Array.from(variants);
}

function exploreSearchTextIncludesToken(text: string, token: string) {
  return exploreSearchTokenVariants(token).some(variant => text.includes(variant));
}

const EXPLORE_QUERY_INTENT_TOKENS = new Set([
  'activity',
  'activities',
  'cabin',
  'cabins',
  'camp',
  'campground',
  'campgrounds',
  'camping',
  'camps',
  'campsite',
  'campsites',
  'do',
  'glamping',
  'guided',
  'hike',
  'hikes',
  'hiking',
  'hotel',
  'hotels',
  'hut',
  'huts',
  'lodge',
  'lodges',
  'lodging',
  'overlook',
  'overlooks',
  'peak',
  'peaks',
  'scenic',
  'spring',
  'springs',
  'stay',
  'stays',
  'tent',
  'things',
  'ticket',
  'tickets',
  'tour',
  'tours',
  'trail',
  'trailhead',
  'trailheads',
  'trails',
  'trek',
  'trekking',
  'view',
  'views',
  'waterfall',
  'waterfalls',
]);

const EXPLORE_QUERY_STOP_TOKENS = new Set([
  'a',
  'an',
  'and',
  'around',
  'at',
  'best',
  'by',
  'for',
  'in',
  'me',
  'my',
  'near',
  'nearby',
  'of',
  'open',
  'the',
  'to',
  'top',
]);

function exploreQueryHasDestinationTerms(query: string) {
  const tokens = normalizeExploreText(query).split(/\s+/).filter(Boolean);
  return tokens.some(token => (
    token.length >= 2
    && !EXPLORE_QUERY_STOP_TOKENS.has(token)
    && !EXPLORE_QUERY_INTENT_TOKENS.has(token)
  ));
}

function exploreQueryDestinationPhrase(query: string) {
  return normalizeExploreText(query)
    .split(/\s+/)
    .filter(token => (
      token.length >= 2
      && !EXPLORE_QUERY_STOP_TOKENS.has(token)
      && !EXPLORE_QUERY_INTENT_TOKENS.has(token)
    ))
    .join(' ');
}

function exploreQueryHasBrowseIntent(query: string) {
  return normalizeExploreText(query)
    .split(/\s+/)
    .filter(Boolean)
    .some(token => EXPLORE_QUERY_INTENT_TOKENS.has(token));
}

function isStayExploreQuery(query: string) {
  return /\b(lodge|lodges|lodging|hotel|hotels|cabin|cabins|hut|huts|stay|stays)\b/.test(normalizeExploreText(query));
}

function explorePlaceIdentitySearchText(place: ExplorePlaceProfile) {
  return normalizeExploreText([
    place.id,
    place.summary.title,
    place.summary.state,
    place.summary.region,
    canonicalExploreParentTitle(place),
    protectedDestinationTitleForExplorePlace(place),
    ...((place as any).search_aliases ?? []),
  ].filter(Boolean).join(' '));
}

const EXPLORE_EXACT_DESTINATION_PHRASES = [
  'moab',
  'grand canyon',
  'grand teton',
  'big sur',
];

function exactExploreDestinationPhraseFromQuery(query: string) {
  const normalized = ` ${normalizeExploreText(query)} `;
  return EXPLORE_EXACT_DESTINATION_PHRASES.find(phrase => normalized.includes(` ${phrase} `)) || '';
}

function explorePlaceIdentityMatchesDestination(place: ExplorePlaceProfile, phrase: string) {
  const normalized = normalizeExploreText(phrase);
  if (!normalized) return false;
  const text = explorePlaceIdentitySearchText(place);
  if (text.includes(normalized)) return true;
  const tokens = normalized
    .split(/\s+/)
    .filter(token => token.length >= 2 && !EXPLORE_QUERY_STOP_TOKENS.has(token));
  return tokens.length > 1 && tokens.every(token => exploreSearchTextIncludesToken(text, token));
}

function explorePlaceStrictlyMatchesDestination(place: ExplorePlaceProfile, phrase: string) {
  const normalized = normalizeExploreText(phrase);
  if (!normalized) return true;
  const tokens = normalized
    .split(/\s+/)
    .filter(token => token.length >= 2 && !EXPLORE_QUERY_STOP_TOKENS.has(token));
  if (tokens.length <= 1) return true;
  return explorePlaceIdentityMatchesDestination(place, normalized);
}

function explorePlaceTitleMatchesDestination(place: ExplorePlaceProfile, phrase: string) {
  const normalized = normalizeExploreText(phrase);
  if (!normalized) return false;
  const title = normalizeExploreText(place.summary.title || '');
  if (title.includes(normalized)) return true;
  const tokens = normalized
    .split(/\s+/)
    .filter(token => token.length >= 2 && !EXPLORE_QUERY_STOP_TOKENS.has(token));
  return tokens.length > 1 && tokens.every(token => exploreSearchTextIncludesToken(title, token));
}

function explorePlaceMatchedActiveSearch(place: ExplorePlaceProfile, query: string) {
  const matchedQuery = normalizeExploreText(String((place as any).matched_explore_query || ''));
  return !!matchedQuery && matchedQuery === normalizeExploreText(query);
}

function explorePlacePrimaryCategoryMatchesBrowseIntent(place: ExplorePlaceProfile, query: string) {
  const text = normalizeExploreText(query);
  const primary = getExploreCategoryKey(place);
  if (/\b(camp|camps|campground|campgrounds|campsite|campsites|rv|tent)\b/.test(text)) {
    const strictCampQuery = /\b(campground|campgrounds|campsite|campsites)\b/.test(text);
    return primary === 'camp' || (!strictCampQuery && (primary === 'glamping' || primary === 'huts'));
  }
  if (/\b(lodge|lodges|lodging|hotel|hotels|cabin|cabins|hut|huts|stay|stays)\b/.test(text)) {
    return primary === 'huts' || primary === 'glamping' || primary === 'camp';
  }
  if (/\b(trail|trails|trailhead|trailheads|hike|hikes|hiking|trek|trekking)\b/.test(text)) {
    return primary === 'trails' || primary === 'trailheads' || primary === 'climb';
  }
  if (/\b(activity|activities|things to do|what to do|see and do)\b/.test(text)) {
    return primary === 'things' || primary === 'parks' || primary === 'land' || primary === 'trails' || primary === 'views' || primary === 'waterfalls' || primary === 'scenic';
  }
  if (/\b(tour|tours|guided|ticket|tickets)\b/.test(text)) {
    return primary === 'guided' || primary === 'tours';
  }
  if (/\b(view|views|overlook|overlooks|waterfall|waterfalls|scenic|spring|springs|peak|peaks)\b/.test(text)) {
    return primary === 'views' || primary === 'waterfalls' || primary === 'peaks' || primary === 'springs' || primary === 'scenic' || primary === 'trails';
  }
  return true;
}

function isExactWaterfallBrowseQuery(query: string) {
  return /^(waterfall|waterfalls|fall|falls|cascade|cascades)$/.test(normalizeExploreText(query));
}

function explorePlaceStronglyMatchesWaterfall(place: ExplorePlaceProfile) {
  if (getExploreCategoryKey(place) !== 'waterfalls') return false;
  const text = normalizeExploreText([
    place.summary.title,
    (place.summary as any).subcategory,
  ].filter(Boolean).join(' '));
  return /\b(waterfall|waterfalls|fall|falls|cascade|cascades)\b/.test(text);
}

function exploreCategoryFetchParamFromQuery(query: string, category: ExploreCategoryKey) {
  if (category !== 'all' && category !== 'nearby') return category;
  const text = normalizeExploreText(query);
  if (/\b(camp|camps|campground|campgrounds|campsite|campsites|rv|tent)\b/.test(text)) return 'camp';
  if (/\b(glamping|yurt|basecamp)\b/.test(text)) return 'glamping';
  if (/\b(lodge|lodges|lodging|hotel|hotels|cabin|cabins|hut|huts|stay|stays)\b/.test(text)) return 'huts';
  if (/\b(trail|trails|trailhead|trailheads|hike|hikes|hiking|trek|trekking)\b/.test(text)) return 'trails';
  if (/\b(activity|activities|things to do|what to do|see and do)\b/.test(text)) return 'things';
  if (/\b(tour|tours|guided|ticket|tickets|book|booking)\b/.test(text)) return 'guided';
  if (/\b(waterfall|waterfalls)\b/.test(text)) return 'waterfalls';
  if (/\b(view|views|overlook|overlooks|scenic)\b/.test(text)) return 'views';
  if (/\b(spring|springs)\b/.test(text)) return 'springs';
  if (/\b(peak|peaks|mountain|mountains)\b/.test(text)) return 'peaks';
  return '';
}

function explorePlaceActiveSearchCanSatisfyIdentity(place: ExplorePlaceProfile, query: string) {
  if (!explorePlaceMatchedActiveSearch(place, query)) return false;
  if (isDestinationExploreHub(place) || isLegacyExploreAreaWrapper(place)) return false;
  if (isExploreThinOpenReference(place)) return false;
  if (!explorePlacePrimaryCategoryMatchesBrowseIntent(place, query)) return false;
  const rank = Number((place as any).matched_explore_rank);
  return Number.isFinite(rank) && rank < 16;
}

function scoreExploreRichText(place: ExplorePlaceProfile, query: string) {
  const normalized = normalizeExploreText(query);
  if (!normalized) return 0;
  const text = explorePlaceSearchText(place);
  if (!text) return 0;
  let score = text.includes(normalized) ? 28 : 0;
  const tokens = normalized.split(/\s+/).filter(token => token.length >= 2);
  if (!tokens.length) return score;
  const matched = tokens.filter(token => exploreSearchTextIncludesToken(text, token));
  if (matched.length === tokens.length) {
    score += 24 + Math.min(tokens.length * 8, 40);
  }
  return score;
}

function exploreCategoryMatchesWithHub(place: ExplorePlaceProfile, key: ExploreCategoryKey, hubCategories: Map<string, Set<ExploreCategoryKey>>) {
  if (key === 'all' || key === 'nearby') return true;
  if (exploreCategoryMatches(place, key)) return true;
  return hubCategories.get(place.id)?.has(key) ?? false;
}

function exploreCategoryAffinity(place: ExplorePlaceProfile, key: ExploreCategoryKey, hubCategories: Map<string, Set<ExploreCategoryKey>>) {
  if (key === 'all' || key === 'nearby') return 0;
  if (exploreCategoryMatches(place, key)) return 2;
  return hubCategories.get(place.id)?.has(key) ? 1 : 0;
}

function explorePlaceMatchesThingsToDo(place: ExplorePlaceProfile, hubCategories: Map<string, Set<ExploreCategoryKey>>) {
  const blocked = new Set<ExploreCategoryKey>(['camp', 'glamping', 'huts', 'fuel', 'resupply']);
  const allowed = new Set<ExploreCategoryKey>(['things', 'parks', 'land', 'trails', 'trailheads', 'views', 'waterfalls', 'peaks', 'springs', 'climb', 'water', 'scenic']);
  if (Array.isArray(place.source_pack?.things_to_do) && place.source_pack.things_to_do.length > 0) return true;
  const primary = getExploreCategoryKey(place);
  if (blocked.has(primary)) return false;
  if (allowed.has(primary)) return true;
  return Array.from(hubCategories.get(place.id) ?? []).some(key => allowed.has(key) && !blocked.has(key));
}

function explorePlaceLooksLikeStandaloneThing(place: ExplorePlaceProfile) {
  if (canonicalExploreModuleTarget(place) === 'do') return true;
  const key = getExploreCategoryKey(place);
  if (key === 'things') return true;
  if (isDestinationExploreHub(place) || isLegacyExploreAreaWrapper(place)) return false;
  if (['views', 'waterfalls', 'springs', 'water', 'scenic', 'climb'].includes(key)) return true;
  const text = normalizeExploreText([
    place.summary.title,
    place.summary.category,
    place.summary.explore_group,
    place.category,
    ...(place.summary.tags ?? []),
    ...(place.subcategories ?? []),
  ].filter(Boolean).join(' '));
  if (/\b(day use|activities|things to do|what to do|see and do|attraction|historic site|historic district|history|museum|landmark|ranger program|visitor center|picnic|wildlife viewing|fishing|boating|paddling|kayak|scenic drive|overlook|viewpoint)\b/.test(text)) {
    return !/\b(campgrounds?|campsites?|lodging|hotels?|cabins?|trails?|trailheads?)\b/.test(text);
  }
  if (['camp', 'glamping', 'huts', 'fuel', 'resupply', 'parks', 'land', 'trails', 'trailheads', 'guided', 'tours'].includes(key)) {
    return false;
  }
  return false;
}

function scoreExploreBrowseIntent(
  place: ExplorePlaceProfile,
  query: string,
  hubCategories: Map<string, Set<ExploreCategoryKey>>,
  includeHubCategories = true,
) {
  const text = normalizeExploreText(query);
  if (!text) return 0;
  const primaryKey = getExploreCategoryKey(place);
  const keys = new Set<ExploreCategoryKey>([primaryKey]);
  const titleIntentText = normalizeExploreText([
    place.summary.title,
    place.summary.category,
    place.summary.explore_group,
    place.category,
    ...(place.summary.tags ?? []),
    ...(place.subcategories ?? []),
  ].filter(Boolean).join(' '));
  const campIntent = /\b(campgrounds?|campsites?|camping|rv|tent|horse camp)\b/.test(titleIntentText);
  const glampingIntent = /\b(glamping|airstream|yurt|canvas cabin|basecamp)\b/.test(titleIntentText);
  const lodgingIntent = /\b(huts?|cabins?|lodges?|lodging|hotels?|inn|shelter)\b/.test(titleIntentText);
  const trailIntent = /\b(trails?|trailheads?|hikes?|hiking|trek|trekking|climb|climbing)\b/.test(titleIntentText);
  const viewIntent = /\b(views?|overlooks?|waterfalls?|scenic|springs?|peaks?)\b/.test(titleIntentText);
  const thingsIntent = /\b(activities|things to do|what to do|see and do|attractions?)\b/.test(titleIntentText);
  const guidedIntent = /\b(tours?|guided|tickets?|booking|book)\b/.test(titleIntentText);
  const explicitTarget = canonicalExploreModuleTarget(place);
  if (explicitTarget === 'stay') {
    if (campIntent) keys.add('camp');
    if (glampingIntent) keys.add('glamping');
    if (lodgingIntent) keys.add('huts');
  }
  if (explicitTarget === 'trails') keys.add('trails');
  if (explicitTarget === 'do') keys.add('things');
  if (explicitTarget === 'see') keys.add('views');
  if (includeHubCategories && isDestinationExploreHub(place)) {
    (hubCategories.get(place.id) ?? new Set<ExploreCategoryKey>()).forEach(key => keys.add(key));
  }
  const stayFamily = explicitTarget === 'stay' || keys.has('camp') || keys.has('glamping') || keys.has('huts');
  if (/\b(lodge|lodges|lodging|hotel|hotels|cabin|cabins|hut|huts|stay|stays)\b/.test(text)) {
    if (!stayFamily) {
      if (keys.has('trails') || keys.has('trailheads') || keys.has('climb')) return -28;
      return 0;
    }
    if (lodgingIntent || keys.has('huts')) return 90;
    if (glampingIntent || keys.has('glamping')) return 55;
    if (campIntent || keys.has('camp')) return 22;
    if (keys.has('trails') || keys.has('trailheads')) return -28;
  }
  if (/\b(camp|camps|campground|campgrounds|campsite|campsites|rv|tent)\b/.test(text)) {
    const strictCampQuery = /\b(campground|campgrounds|campsite|campsites)\b/.test(text);
    if (campIntent) return 90;
    if ((glampingIntent || keys.has('glamping')) && !strictCampQuery) return 36;
    if ((lodgingIntent || keys.has('huts')) && !strictCampQuery) return 18;
    if (keys.has('trails') || keys.has('trailheads')) return -22;
  }
  if (/\b(trail|trails|trailhead|trailheads|hike|hikes|hiking|trek|trekking)\b/.test(text)) {
    if (trailIntent || keys.has('trails') || keys.has('trailheads')) return 90;
    if (viewIntent || keys.has('views') || keys.has('waterfalls') || keys.has('peaks')) return 20;
    if (keys.has('huts') || keys.has('camp')) return -16;
  }
  if (/\b(activity|activities|things to do|what to do|see and do)\b/.test(text)) {
    if (thingsIntent || keys.has('things')) return 80;
    if (keys.has('parks')) return 48;
  }
  if (/\b(tour|tours|guided|ticket|tickets)\b/.test(text)) {
    if (guidedIntent || keys.has('guided') || keys.has('tours')) return 80;
  }
  if (/\b(view|views|overlook|overlooks|waterfall|waterfalls|scenic|spring|springs|peak|peaks)\b/.test(text)) {
    if (viewIntent || keys.has('views') || keys.has('waterfalls') || keys.has('peaks') || keys.has('springs') || keys.has('scenic')) return 80;
    if (keys.has('trails')) return 16;
  }
  return 0;
}

function exploreHomeShelfKey(place: ExplorePlaceProfile, hubCategories: Map<string, Set<ExploreCategoryKey>>) {
  const primary = getExploreCategoryKey(place);
  const assignmentOrder = isDestinationExploreHub(place)
    ? HOME_SHELF_ASSIGNMENT_ORDER
    : [primary, ...HOME_SHELF_ASSIGNMENT_ORDER.filter(key => key !== primary)];
  return assignmentOrder.find(key => exploreCategoryMatchesWithHub(place, key, hubCategories)) ?? null;
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
    category: place.category || area.category,
    subcategories: Array.from(new Set([...(place.subcategories ?? []), ...(area.subcategories ?? [])])),
    quality: place.quality || area.quality,
    quality_score: Math.max(Number((place as any).quality_score || 0), Number((area as any).quality_score || 0)),
    search_aliases: Array.from(new Set([...((place as any).search_aliases ?? []), ...((area as any).search_aliases ?? [])])),
    trails,
    sources: Array.from(new Set([...(place.sources ?? []), ...(area.sources ?? [])] as any[])) as any,
    card: {
      ...(area.card || {}),
      ...(place.card || {}),
      title: place.card?.title || place.summary.title || area.card?.title,
      region: place.card?.region || area.card?.region,
      headline: place.card?.headline || area.card?.headline,
      summary: place.card?.summary || area.card?.summary,
      highlight: place.card?.highlight || area.card?.highlight,
      facts: place.card?.facts || area.card?.facts,
    },
    summary: {
      ...place.summary,
      category: place.summary.category || area.summary.category,
      explore_group: place.summary.explore_group || area.summary.explore_group,
      region: place.summary.region || area.summary.region,
      tags: Array.from(new Set([...(place.summary.tags ?? []), ...(area.summary.tags ?? [])])),
      hook: place.summary.hook || area.summary.hook,
      short_description: place.summary.short_description || area.summary.short_description,
      image_url: imageUrl,
      thumbnail_url: imageUrl || place.summary.thumbnail_url,
      image_credit: imageCredit,
      image_license: place.summary.image_license || area.summary.image_license,
      source_url: place.summary.source_url || area.summary.source_url,
      source_title: place.summary.source_title || area.summary.source_title,
    },
    profile: {
      ...place.profile,
      why_it_matters: place.profile.why_it_matters || area.profile?.why_it_matters,
      what_to_know: place.profile.what_to_know || area.profile?.what_to_know,
      best_time_to_stop: place.profile.best_time_to_stop || area.profile?.best_time_to_stop,
      access_notes: place.profile.access_notes || area.profile?.access_notes,
      nearby_context: place.profile.nearby_context || area.profile?.nearby_context,
    },
    source_pack: {
      ...(area.source_pack || {}),
      ...(place.source_pack || {}),
      primary: place.source_pack?.primary || area.source_pack?.primary,
      quality: place.source_pack?.quality || area.source_pack?.quality,
      source_note: place.source_pack?.source_note || area.source_pack?.source_note,
      official_url: place.source_pack?.official_url || area.source_pack?.official_url,
      booking_url: place.source_pack?.booking_url || area.source_pack?.booking_url,
      sources: place.source_pack?.sources || area.source_pack?.sources,
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
      ...area.facts,
      ...place.facts,
    },
    attribution: place.attribution || area.attribution,
  };
}

function exploreIndexItemToProfile(item: ExploreCatalogIndexItem): ExplorePlaceProfile {
  const title = String(item.title || '').trim();
  const category = item.category || 'Explore';
  const region = item.region || '';
  const hook = item.hook || item.short_description || '';
  const short = item.short_description || item.hook || '';
  const accessNotes = typeof item.access === 'string' ? item.access : '';
  const safetyNotes = typeof item.safety === 'string' ? item.safety : '';
  const sourceTitle = cleanExploreSourceLabel(item.source_title || '', '');
  const cleanSources = (item.sources ?? []).map(source => {
    const rawTitle = String((source as any)?.title || '').trim();
    const rawPublisher = String((source as any)?.publisher || '').trim();
    const publisher = cleanExploreSourceLabel(rawPublisher || rawTitle, '');
    const sourceName = cleanExploreSourceLabel(rawTitle, rawTitle || publisher);
    return {
      ...(source as any),
      title: sourceName || publisher,
      publisher: publisher || sourceName,
    };
  }).filter(source => source.title || source.publisher || source.url);
  return {
    id: item.id,
    category: item.v3_category || item.category,
    canonical_role: item.canonical_role || '',
    parent_hub_id: item.parent_hub_id || '',
    parent_hub_title: item.parent_hub_title || '',
    module_target: item.module_target || '',
    hidden_from_featured: Boolean((item as any).hidden_from_featured),
    subcategories: item.subcategories ?? [],
    sources: cleanSources,
    source_ids: item.source_ids ?? [],
    quality: item.quality || item.source_quality,
    quality_score: item.quality_score,
    verified: item.verified,
    enrichment: item.enrichment,
    provenance: item.provenance,
    ranking: item.ranking,
    search_aliases: item.search_aliases ?? [],
    search_blob: item.search_blob || '',
    best_season: item.best_season || '',
    access: item.access,
    safety: item.safety,
    amenities: item.amenities ?? [],
    media: item.media ?? [],
    card: item.card,
    linked_trail_ids: item.linked_trail_ids ?? [],
    summary: {
      id: item.id,
      title,
      category,
      explore_group: item.explore_group,
      state: region,
      region,
      lat: item.lat,
      lng: item.lng,
      rank: item.rank ?? 999999,
      hero_rank: item.hero_rank ?? item.rank ?? 999999,
      tags: item.tags ?? [],
      badges: [category],
      hook,
      short_description: short,
      thumbnail_url: item.thumbnail_url || item.image_url || '',
      image_url: item.image_url || item.thumbnail_url || '',
      image_credit: item.image_credit || '',
      image_license: item.image_license || '',
      source_url: item.source_url || '',
      source_title: sourceTitle,
    },
    profile: {
      hook,
      summary: short,
      story: '',
      why_it_matters: item.card?.highlight || '',
      what_to_know: safetyNotes,
      best_time_to_stop: item.best_season || '',
      access_notes: accessNotes,
      nearby_context: '',
    },
    audio_script: '',
    wiki_extract: '',
    source_pack: {
      quality: item.source_quality || '',
      primary: sourceTitle,
      official_url: /official/i.test(String(item.source_quality || '')) ? item.source_url || '' : '',
      sources: cleanSources.length ? cleanSources : item.source_url ? [{
        title,
        publisher: sourceTitle,
        url: item.source_url,
        kind: item.source_quality || '',
      }] : [],
      photos: item.media?.length ? item.media.map(photo => ({
        url: photo.url,
        caption: photo.caption || '',
        credit: photo.credit || item.image_credit || '',
      })) : (item.image_url || item.thumbnail_url) ? [{
        url: item.image_url || item.thumbnail_url,
        caption: '',
        credit: item.image_credit || '',
      }] : [],
      topics: item.tags ?? [],
      source_note: '',
    },
    facts: {
      coordinates: item.lat != null && item.lng != null ? `${Number(item.lat).toFixed(5)}, ${Number(item.lng).toFixed(5)}` : '',
      source_url: item.source_url || '',
      source_title: sourceTitle,
      official_url: /official/i.test(String(item.source_quality || '')) ? item.source_url || '' : '',
      source_quality: item.source_quality || '',
    },
    attribution: sourceTitle || cleanExploreSourceLabel(cleanSources[0]?.publisher || cleanSources[0]?.title || '', ''),
  };
}

function storyTextForPlace(place: ExplorePlaceProfile) {
  return place.profile.story || place.audio_script || getExploreCardSummary(place) || place.wiki_extract || '';
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
  if (url.startsWith('/common/uploads')) return `https://www.nps.gov${url}`;
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

function cleanCampTypeLabel(raw?: string | null) {
  const clean = String(raw || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  if (/^(community listing|camp listing|map contributors|map data|source|recreation\.gov|ridb|geoapify|mapbox)$/i.test(clean)) return '';
  if (/rv\s*\/?\s*caravan|caravan/i.test(clean)) return 'RV site';
  if (/dispersed|primitive/i.test(clean)) return 'Dispersed camp';
  if (/federal campground/i.test(clean)) return 'Federal campground';
  if (/tent camp/i.test(clean)) return 'Tent camp';
  if (/private/i.test(clean)) return 'Private campground';
  return clean
    .toLowerCase()
    .replace(/\b\w/g, char => char.toUpperCase())
    .replace(/\b(Rv|Ada|Blm|Usfs|Nps)\b/g, match => match.toUpperCase());
}

function campCostLabel(raw?: string | null) {
  const clean = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  if (/^see\s+(?:blm|usfs|nps|official|agency)\s+site$/i.test(clean)) return 'Check fees';
  if (/^(official link|explore seed|explore)$/i.test(clean)) return '';
  return clean
    .replace(/Free\s*\/\s*Self[- ]Issued/gi, 'Free or self-issued')
    .replace(/Verify fee/gi, 'Check fee');
}

function campMetaLine(camp: CampsitePin) {
  return [
    cleanCampTypeLabel(camp.land_type),
    typeof (camp as any).distance_mi === 'number' ? fmtMi((camp as any).distance_mi) : '',
    camp.reservable ? 'Reservable' : '',
  ].filter(Boolean).join(' · ');
}

function campTagLabel(tag: string) {
  const clean = String(tag || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean || clean.length < 3) return '';
  if (/^[A-Z0-9]{2,5}$/.test(clean)) return '';
  if (/^(camp|campgrounds?|national park|glacier national park|nearby|area|official|official link|explore seed|explore|nps|place|community listing|camp listing|map contributors|map data|source)$/i.test(clean)) return '';
  if (/^(glac|yose|seki|grca|romo|zion|grte|arch|cany|care|deva|jotr|olym|yell)$/i.test(clean)) return '';
  if (/rv\s*\/?\s*caravan|caravan/i.test(clean)) return 'RV site';
  if (/dispersed|primitive/i.test(clean)) return 'Dispersed camp';
  if (/federal campground/i.test(clean)) return 'Federal campground';
  if (/tent camp/i.test(clean)) return 'Tent camp';
  return clean
    .toLowerCase()
    .replace(/\b\w/g, char => char.toUpperCase())
    .replace(/\b(Rv|Ada|Blm|Usfs|Nps)\b/g, match => match.toUpperCase());
}

function isLowQualityExploreCampName(camp: CampsitePin) {
  const name = String(camp.name || '').replace(/\s+/g, ' ').trim();
  if (!name) return true;
  const lower = name.toLowerCase();
  if (/^[a-z]?\d+[a-z]?$/i.test(name)) return true;
  if (/^(?:camping\s+area|camp\s+area|area|loop|site)\s*[a-z0-9-]{1,4}$/i.test(name)) return true;
  if (/^(?:tent\s+)?camp(?:site)?\s*[a-z0-9-]{1,4}$/i.test(name)) return true;
  if (/^camping\s+area\b/i.test(lower)) return true;
  return false;
}

function campBadgeLabel(camp: CampsitePin) {
  const raw = String(camp.source_badge || camp.verified_source || camp.source || camp.feature_source || '').trim();
  if (/national park service|nps/i.test(raw)) return 'Park';
  if (/recreation\.gov|ridb/i.test(raw)) return camp.reservable ? 'Reserve' : 'Camp';
  if (/blm/i.test(raw)) return 'BLM';
  if (/usfs|forest/i.test(raw)) return 'USFS';
  if (/geoapify|mapbox|map data/i.test(raw)) return 'Camp';
  return cleanCampTypeLabel(camp.land_type) || 'Camp';
}

function explorePlaceAsCampPin(place: ExplorePlaceProfile): CampsitePin | null {
  const group = groupForExplorePlace(place);
  if (!['camping', 'glamping', 'huts_lodging'].includes(group)) return null;
  const lat = Number(place.summary.lat);
  const lng = Number(place.summary.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const title = place.summary.title.trim();
  if (!title) return null;
  const image = mediaUrl(place.summary.image_url || place.summary.thumbnail_url || '');
  return {
    id: `explore-current:${place.id}`,
    name: title,
    lat,
    lng,
    tags: (place.summary.tags ?? []).map(campTagLabel).filter(Boolean).slice(0, 3),
    land_type: group === 'glamping'
      ? 'Glamping'
      : group === 'huts_lodging'
        ? 'Cabin or lodge'
        : 'Campground',
    description: getExploreCardSummary(place) || place.summary.short_description || place.summary.hook || '',
    photos: image ? [image] : [],
    photo_url: image || undefined,
    reservable: /reservation|reserve|book/i.test(`${place.summary.hook} ${place.summary.short_description}`),
    cost: undefined,
    url: place.summary.source_url || '',
    ada: false,
    official_url: place.summary.source_url || undefined,
    source_badge: place.summary.source_title || cleanExploreSourceLabel(place.sources?.[0]?.publisher || place.sources?.[0]?.title || ''),
    source: place.summary.source_title || undefined,
  };
}

function sourcePackItemToRelatedPoi(item: ExploreSourcePackItem, fallbackType: OsmPoi['type'] = 'poi'): OsmPoi | null {
  if (!sourcePackItemCanShow(item)) return null;
  const title = String(item.title || '').replace(/\s+/g, ' ').trim();
  if (!title || /^(places?|things to do|details?|overview)$/i.test(title)) return null;
  const lat = Number(item.lat);
  const lng = Number(item.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const kind = String(item.kind || '').toLowerCase();
  const type: OsmPoi['type'] = /trail/.test(kind)
    ? 'trail'
    : /view|overlook|vista/.test(kind)
      ? 'viewpoint'
      : /visitor|center|centre/.test(kind)
        ? 'poi'
        : fallbackType;
  return {
    id: String(item.source_id || item.url || title || `${lat.toFixed(5)},${lng.toFixed(5)}`),
    name: title,
    lat,
    lng,
    type,
    subtype: item.kind || item.source_label,
    display_type: item.kind || item.source_label,
    source: item.source,
    source_label: item.source_label || item.source,
    website: item.url,
    official_url: item.url,
    summary: item.description,
    description: item.description,
    photo_url: item.image_url ? mediaUrl(item.image_url) : null,
  };
}

function exploreTrailCardToRelatedProfile(trail: ExploreTrailCard): TrailProfile | null {
  const lat = Number(trail.lat ?? trail.route_target?.lat);
  const lng = Number(trail.lng ?? trail.route_target?.lng);
  const title = String(trail.title || trail.route_target?.name || '').replace(/\s+/g, ' ').trim();
  if (!title || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (exploreTrailCardLooksLikeRoad(trail, title)) return null;
  const photoUrl = trail.image_url || trail.photos?.find(photo => !!photo.url)?.url || '';
  const source = trail.source_label || trail.source_pack?.primary || 'Trailhead Trails';
  return {
    id: String(trail.trail_id || trail.id || title),
    name: title,
    summary: trail.summary,
    description: trail.description || trail.summary,
    lat,
    lng,
    length_mi: trail.distance_mi,
    difficulty: trail.difficulty,
    route_type: trail.route_type,
    elevation_gain_ft: trail.elevation_gain_ft,
    best_season: trail.best_season || trail.season_window,
    feature_type: trail.feature_type,
    feature_label: trail.feature_label,
    trekking_only: trail.trekking_only,
    guide_required: trail.guide_required,
    permit_note: trail.permit_note,
    glacier_crossing: trail.glacier_crossing,
    altitude_ft: trail.altitude_ft,
    season_window: trail.season_window,
    route_target: trail.route_target,
    geometry_ref: trail.geometry_ref,
    area_name: trail.area,
    activities: ['hiking'],
    trailheads: [{ name: title, lat, lng, source }],
    official_url: trail.source_url,
    photos: photoUrl ? [{ url: mediaUrl(photoUrl), credit: trail.image_credit, source, license: trail.image_license }] : [],
    source,
    source_label: source,
    source_pack: trail.source_pack,
    provenance: {},
    last_checked: Math.floor(Date.now() / 1000),
  };
}

function exploreTrailCardLooksLikeRoad(trail: ExploreTrailCard, title: string) {
  const name = title.toLowerCase();
  if (/\b(?:national forest development road|forest(?: service)? road|nf-?\d|fs-?\d|fr\s*\d|road\s*\d+[a-z]?|rd\s*\d)\b/.test(name)) {
    return true;
  }
  if (!/\b(?:road|rd|route|highway|hwy|drive|dr|byway)\b/.test(name)) return false;
  if (/\b(?:trail|trailhead|path|walk|loop|overlook|viewpoint|falls?|waterfall|summit|pass)\b/.test(name)) {
    return false;
  }
  const context = [
    trail.summary,
    trail.description,
    trail.feature_type,
    trail.feature_label,
    trail.route_type,
    trail.source_label,
    ...(trail.tags ?? []),
  ].join(' ').toLowerCase();
  return !/\b(?:hike|hiking|footpath|singletrack|trailhead|walking route)\b/.test(context);
}

function exploreMapRelatedContext(place: ExplorePlaceProfile, campgrounds: CampsitePin[] = []) {
  const pack = place.source_pack ?? {};
  const thingsToDo = uniqueRelatedPlaces((pack.things_to_do ?? [])
    .filter(sourcePackThingToDoCanShow)
    .map(item => sourcePackItemToRelatedPoi(item, 'poi'))
    .filter((item): item is OsmPoi => !!item));
  const thingsToSee = uniqueRelatedPlaces((pack.things_to_see ?? [])
    .filter(sourcePackThingToSeeCanShow)
    .map(item => sourcePackItemToRelatedPoi(item, 'viewpoint'))
    .filter((item): item is OsmPoi => !!item));
  const visitorCenters = uniqueRelatedPlaces((pack.visitor_centers ?? [])
    .map(item => sourcePackItemToRelatedPoi(item, 'poi'))
    .filter((item): item is OsmPoi => !!item));
  const trails = getExploreTrailCards(place)
    .map(exploreTrailCardToRelatedProfile)
    .filter((item): item is TrailProfile => !!item);
  return {
    places: uniqueRelatedPlaces([...thingsToDo, ...thingsToSee, ...visitorCenters]).slice(0, 18),
    things_to_do: thingsToDo.slice(0, 12),
    things_to_see: thingsToSee.slice(0, 12),
    visitor_centers: visitorCenters.slice(0, 8),
    trails: trails.slice(0, 24),
    campgrounds_nearby: campgrounds.slice(0, 12),
    trip_services: [],
  };
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
  if (isPakistanCuratedExplorePlace(place)) return false;
  return ['camping', 'glamping', 'huts_lodging', 'trails', 'parks', 'water'].includes(groupForExplorePlace(place));
}

function isPakistanCuratedExplorePlace(place: ExplorePlaceProfile) {
  return place.id.startsWith('explore:pk:');
}

function isLocalCuratedExplorePlace(place: ExplorePlaceProfile) {
  return place.id === 'place:nps:yose'
    || place.id === 'explore:trails:yosemite-trails'
    || place.id.startsWith('guided:')
    || isPakistanCuratedExplorePlace(place)
    || place.id.startsWith('explore:waterfalls:');
}

function exploreCountLabel(count: number, singular: string, plural: string) {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

function withExploreTimeout<T>(promise: Promise<T>, ms = 9000) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Explore request timeout')), ms);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function guidedOrganicFallbackFromPlaces(
  places: ExplorePlaceProfile[],
  center: GuidedSearchCenter | null,
  query: string,
  limit = 6,
) {
  const blocked = new Set<ExploreCategoryKey>(['camp', 'glamping', 'huts', 'fuel', 'resupply', 'guided', 'tours']);
  const normalizedQuery = normalizeExploreText(query);
  return places
    .filter(place => !blocked.has(getExploreCategoryKey(place)))
    .map(place => {
      const lat = place.summary.lat;
      const lng = place.summary.lng;
      const hasCoordinates = lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
      const distance = center && hasCoordinates
        ? distMi(center, { lat: Number(lat), lng: Number(lng) })
        : null;
      const queryScore = normalizedQuery
        ? Math.max(
          explorePlaceIdentitySearchText(place).includes(normalizedQuery) ? 140 : 0,
          scoreExploreQuery(place, normalizedQuery),
          scoreExploreRichText(place, normalizedQuery),
        )
        : 0;
      return {
        place,
        distance,
        queryScore,
        quality: exploreContentQualityScore(place) + scoreExploreTrust(place),
      };
    })
    .filter(item => (item.distance != null && item.distance <= 140) || item.queryScore > 0)
    .sort((a, b) => {
      const aNearby = a.distance != null && a.distance <= 140;
      const bNearby = b.distance != null && b.distance <= 140;
      if (aNearby !== bNearby) return aNearby ? -1 : 1;
      if (aNearby && bNearby && a.distance !== b.distance) return Number(a.distance) - Number(b.distance);
      if (b.queryScore !== a.queryScore) return b.queryScore - a.queryScore;
      return b.quality - a.quality;
    })
    .slice(0, Math.max(1, limit))
    .map((item, index) => ({
      ...item.place,
      matched_explore_query: normalizedQuery,
      matched_explore_rank: index,
    } as ExplorePlaceProfile));
}

function shouldUseExploreCampgroundEndpoint(place: ExplorePlaceProfile) {
  if (place.id.startsWith('explore:hub:')) return false;
  if (isLocalCuratedExplorePlace(place)) return false;
  return !place.id.startsWith('explore:waterfalls:') && !place.id.startsWith('explore:trails:');
}

function shouldUseExploreDetailEndpoint(place: ExplorePlaceProfile) {
  if (place.id.startsWith('explore:hub:')) return false;
  if (isLocalCuratedExplorePlace(place)) return false;
  return true;
}

function shouldPrefetchExploreDetail(place: ExplorePlaceProfile) {
  return shouldUseExploreDetailEndpoint(place);
}

function exploreCampRailTitle(place: ExplorePlaceProfile) {
  const group = groupForExplorePlace(place);
  if (group === 'glamping') return 'Stays near this area';
  if (group === 'huts_lodging') return 'Huts, cabins & camps nearby';
  if (group === 'camping') {
    const title = place.summary.title || '';
    if (/\bcampground\b/i.test(title) && !/\bcampgrounds\b/i.test(title)) return 'Campground details';
    return 'Campgrounds nearby';
  }
  if (group === 'trails') return 'Camps near this trail area';
  if (group === 'water') return 'Camps and stays nearby';
  return 'Campgrounds in this area';
}

function exploreCampFallbackRadius(place: ExplorePlaceProfile) {
  const group = groupForExplorePlace(place);
  if (group === 'glamping' || group === 'huts_lodging') return 26;
  if (group === 'camping') return 24;
  if (group === 'trails') return 32;
  return 38;
}

function GuideScreenContent() {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const router = useRouter();
  const params = useLocalSearchParams<{ view?: string | string[] }>();
  const user = useStore(st => st.user);
  const activeTrip = useStore(st => st.activeTrip);
  const setActiveTrip = useStore(st => st.setActiveTrip);
  const userLoc = useStore(st => st.userLoc);
  const setUserLoc = useStore(st => st.setUserLoc);
  const weatherUnitMode = useStore(st => st.weatherUnitMode);
  const setWeatherUnitMode = useStore(st => st.setWeatherUnitMode);
  const mapboxToken = useStore(st => st.mapboxToken);
  const setMapboxToken = useStore(st => st.setMapboxToken);
  const setPendingNavigatePlace = useStore(st => st.setPendingNavigatePlace);
  const setPendingMapSelection = useStore(st => st.setPendingMapSelection);
  const tripRepository = useTripRepositorySnapshot();
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
  const [exploreFilterSheetOpen, setExploreFilterSheetOpen] = useState(false);
  const [guidedTourCategory, setGuidedTourCategory] = useState<GuidedTourCategory>('all');
  const [guidedTourSort, setGuidedTourSort] = useState<GuidedTourSort>('top_rated');
  const [guidedTourDate, setGuidedTourDate] = useState<GuidedTourDate>('any');
  const [guidedTourCustomDate, setGuidedTourCustomDate] = useState('');
  const [guidedTourFreeCancel, setGuidedTourFreeCancel] = useState(false);
  const [guidedTourEnglishOnly, setGuidedTourEnglishOnly] = useState(false);
  const [guidedTourCategoryDraft, setGuidedTourCategoryDraft] = useState<GuidedTourCategory>('all');
  const [guidedTourSortDraft, setGuidedTourSortDraft] = useState<GuidedTourSort>('top_rated');
  const [guidedTourFreeCancelDraft, setGuidedTourFreeCancelDraft] = useState(false);
  const [guidedTourEnglishOnlyDraft, setGuidedTourEnglishOnlyDraft] = useState(false);
  const [guidedDateSheetOpen, setGuidedDateSheetOpen] = useState(false);
  const [guidedFilterSheetOpen, setGuidedFilterSheetOpen] = useState(false);
  const [guidedCalendarMonth, setGuidedCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [guidedTourDraft, setGuidedTourDraft] = useState('');
  const [guidedTourSearchQuery, setGuidedTourSearchQuery] = useState('');
  const [guidedTourSelectedCenter, setGuidedTourSelectedCenter] = useState<GuidedSearchCenter | null>(null);
  const [guidedTourSelectedDestinationKey, setGuidedTourSelectedDestinationKey] = useState<string | null>(null);
  const [guidedTourSearchRunId, setGuidedTourSearchRunId] = useState(0);
  const [guidedDestinations, setGuidedDestinations] = useState<GuidedDestination[]>(GUIDED_DESTINATIONS);
  const [guidedFallbackExplorePlaces, setGuidedFallbackExplorePlaces] = useState<ExplorePlaceProfile[]>([]);
  const [exploreSavedOnly, setExploreSavedOnly] = useState(false);
  const [exploreQuery, setExploreQuery] = useState('');
  const [exploreServiceDestinationResolution, setExploreServiceDestinationResolution] = useState<{
    query: string;
    status: 'resolving' | 'resolved' | 'failed';
    center: GuidedSearchCenter | null;
  }>({ query: '', status: 'failed', center: null });
  const [exploreVisibleLimit, setExploreVisibleLimit] = useState(EXPLORE_INITIAL_VISIBLE);
  const [profileReadMode, setProfileReadMode] = useState<ExploreDetailTab>('summary');
  const [explorePlaces, setExplorePlaces] = useState<ExplorePlaceProfile[]>([]);
  const [exploreTrailAreasById, setExploreTrailAreasById] = useState<Record<string, ExplorePlaceProfile>>({});
  const [exploreTrailAreaLoadingId, setExploreTrailAreaLoadingId] = useState<string | null>(null);
  const [exploreTrailAreaErrors, setExploreTrailAreaErrors] = useState<Record<string, string>>({});
  const savedExploreIds = useMemo(
    () => tripRepository.savedEntities.map(entity => entity.id),
    [tripRepository.savedEntities],
  );

  useEffect(() => {
    if (!tripRepository.initialized || explorePlaces.length === 0) return;
    const storageEpoch = accountStorage.epoch();
    const accountId = useStore.getState().user?.id;
    const ownerScope = getTripRepositorySnapshot().ownerScope;
    const repositoryIsCurrent = () => accountStorage.epoch() === storageEpoch
      && String(useStore.getState().user?.id ?? '') === String(accountId ?? '')
      && getTripRepositorySnapshot().ownerScope === ownerScope;
    const profiles = new Map<string, ExplorePlaceProfile>();
    explorePlaces.forEach(place => {
      profiles.set(place.id, place);
      profiles.set(canonicalSavedEntityId(place.id, 'place'), place);
    });
    const placeholders = tripRepository.savedEntities.filter(entity =>
      entity.title === 'Saved Explorer place' && profiles.has(entity.id),
    );
    placeholders.forEach(entity => {
      const profile = profiles.get(entity.id);
      if (!profile) return;
      const enriched = savedEntityFromExplorePlace(profile);
      const write = enriched.id === entity.id
        ? saveEntity(enriched, { expectedRevision: entity.revision })
        : saveEntity(enriched).then(() => {
            if (!repositoryIsCurrent()) return;
            return removeEntity(entity.id, { expectedRevision: entity.revision });
          });
      write.catch(() => {});
    });
  }, [explorePlaces, tripRepository.initialized, tripRepository.revision]);
  const [exploreCampgroundsById, setExploreCampgroundsById] = useState<Record<string, CampsitePin[]>>({});
  const [exploreCampSourceById, setExploreCampSourceById] = useState<Record<string, 'official' | 'fallback'>>({});
  const [exploreCampLoadingId, setExploreCampLoadingId] = useState<string | null>(null);
  const [exploreCampErrors, setExploreCampErrors] = useState<Record<string, string>>({});
  const [exploreWeatherById, setExploreWeatherById] = useState<Record<string, any>>({});
  const [exploreWeatherLoadingId, setExploreWeatherLoadingId] = useState<string | null>(null);
  const [exploreWeatherErrors, setExploreWeatherErrors] = useState<Record<string, string>>({});
  const [exploreExperiencesById, setExploreExperiencesById] = useState<Record<string, BookableExperience[]>>({});
  const [exploreExperienceLoadingId, setExploreExperienceLoadingId] = useState<string | null>(null);
  const [exploreExperienceErrors, setExploreExperienceErrors] = useState<Record<string, string>>({});
  const [exploreSearchExperiences, setExploreSearchExperiences] = useState<BookableExperience[]>([]);
  const [exploreSearchExperienceLoading, setExploreSearchExperienceLoading] = useState(false);
  const [exploreSearchExperiencePending, setExploreSearchExperiencePending] = useState(false);
  const [exploreSearchExperienceError, setExploreSearchExperienceError] = useState('');
  const [exploreSearchExperienceAttribution, setExploreSearchExperienceAttribution] = useState('');
  const [selectedExperience, setSelectedExperience] = useState<BookableExperience | null>(null);
  const [selectedExperienceLoading, setSelectedExperienceLoading] = useState(false);
  const [exploreHomeWeather, setExploreHomeWeather] = useState<any>(null);
  const [exploreHomeWeatherLoading, setExploreHomeWeatherLoading] = useState(false);
  const [exploreHomeWeatherError, setExploreHomeWeatherError] = useState('');
  const [liveExplorePlaces, setLiveExplorePlaces] = useState<OsmPoi[]>([]);
  const [liveExploreError, setLiveExploreError] = useState('');
  const [exploreLoading, setExploreLoading] = useState(false);
  const [exploreSearchResolving, setExploreSearchResolving] = useState(false);
  const [liveExploreLoading, setLiveExploreLoading] = useState(false);
  const [exploreError, setExploreError] = useState('');
  const [exploreCatalogNotice, setExploreCatalogNotice] = useState('');
  const [exploreFacetCounts, setExploreFacetCounts] = useState<Partial<Record<ExploreCategoryKey, number>>>({});
  const [exploreCatalogPages, setExploreCatalogPages] = useState<Record<string, ExploreCatalogPageState>>({});
  const [exploreCatalogReloadId, setExploreCatalogReloadId] = useState(0);
  const [exploreLocationRequestId, setExploreLocationRequestId] = useState(0);
  const [exploreLocationState, setExploreLocationState] = useState<'idle' | 'requesting' | 'denied' | 'blocked' | 'error'>('idle');
  const [selectedExplore, setSelectedExplore] = useState<ExplorePlaceProfile | null>(null);
  const [selectedLivePlace, setSelectedLivePlace] = useState<OsmPoi | null>(null);
  const [paywallVisible, setPaywallVisible] = useState(false);
  const [paywallCode, setPaywallCode] = useState('');
  const [paywallMessage, setPaywallMessage] = useState('');
  const [autoPlay, setAutoPlay] = useState(false);
  const [highlightSentence, setHighlightSentence] = useState(-1);
  const locationSub = useRef<Location.LocationSubscription | null>(null);
  const exploreSearchRefinementKeys = useRef<Set<string>>(new Set());
  const exploreEnrichmentKeys = useRef<Set<string>>(new Set());
  const exploreDetailPrefetchKeys = useRef<Set<string>>(new Set());
  const explorePlacesRef = useRef<ExplorePlaceProfile[]>([]);
  const exploreCatalogPagesRef = useRef<Record<string, ExploreCatalogPageState>>({});
  const storyScrollRef = useRef<ScrollView | null>(null);
  const storyTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const requestedView = Array.isArray(params.view) ? params.view[0] : params.view;
  const guidedDestinationContextActive = !!guidedTourSelectedDestinationKey
    && !!guidedTourSelectedCenter
    && normalizeExploreText(exploreQuery) === normalizeExploreText(guidedTourSearchQuery);
  const exploreServiceDestinationQuery = serviceDestinationQueryFromExploreQuery(exploreQuery, exploreCategory);
  const knownServiceDestinationCenter = exploreServiceDestinationQuery
    ? guidedTourKnownDestinationCenter(exploreServiceDestinationQuery)
    : null;
  const serviceResolutionMatchesQuery = !!exploreServiceDestinationQuery
    && normalizeExploreText(exploreServiceDestinationResolution.query) === normalizeExploreText(exploreServiceDestinationQuery);
  const resolvedServiceDestinationCenter = knownServiceDestinationCenter
    ?? (serviceResolutionMatchesQuery && exploreServiceDestinationResolution.status === 'resolved'
      ? exploreServiceDestinationResolution.center
      : null);
  const exploreServiceDestinationResolving = !!exploreServiceDestinationQuery
    && !knownServiceDestinationCenter
    && (!serviceResolutionMatchesQuery || exploreServiceDestinationResolution.status === 'resolving');
  const exploreServiceDestinationFailed = !!exploreServiceDestinationQuery
    && !knownServiceDestinationCenter
    && serviceResolutionMatchesQuery
    && exploreServiceDestinationResolution.status === 'failed';
  const preferredNearbyDestinationCenter = guidedDestinationContextActive
    ? guidedTourSelectedCenter
    : resolvedServiceDestinationCenter;
  const exploreNearbySearchCenter = resolveExploreNearbySearchCenter(
    exploreCategory,
    guidedDestinationContextActive || !!resolvedServiceDestinationCenter,
    preferredNearbyDestinationCenter,
    exploreServiceDestinationQuery ? null : userLoc,
  );

  useEffect(() => {
    const query = exploreServiceDestinationQuery;
    if (
      tab !== 'explore'
      || exploreMode !== 'nearby'
      || guidedDestinationContextActive
      || !query
      || knownServiceDestinationCenter
    ) return;

    let cancelled = false;
    setExploreServiceDestinationResolution({ query, status: 'resolving', center: null });
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const resolved = await api.resolveGeocodePlace(query, 5, { prefer: 'search_center' });
          let candidate = resolved.selected ?? resolved.alternatives?.[0] ?? null;
          if (!candidate) {
            const fallback = await api.geocodePlaces(query, 1, { prefer: 'search_center' });
            candidate = fallback[0] ?? null;
          }
          if (cancelled) return;
          if (candidate && Number.isFinite(candidate.lat) && Number.isFinite(candidate.lng)) {
            setExploreServiceDestinationResolution({
              query,
              status: 'resolved',
              center: { lat: candidate.lat, lng: candidate.lng, name: candidate.name || query },
            });
          } else {
            setExploreServiceDestinationResolution({ query, status: 'failed', center: null });
          }
        } catch {
          if (!cancelled) setExploreServiceDestinationResolution({ query, status: 'failed', center: null });
        }
      })();
    }, 240);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    exploreLocationRequestId,
    exploreMode,
    exploreServiceDestinationQuery,
    guidedDestinationContextActive,
    knownServiceDestinationCenter?.lat,
    knownServiceDestinationCenter?.lng,
    tab,
  ]);
  const exploreCatalogRequestQuery = useMemo(() => exploreCatalogQueryForDestinationContext(
    exploreQuery,
    exploreCategory,
    guidedTourSearchQuery,
    guidedTourSelectedDestinationKey,
    guidedTourSelectedCenter,
  ), [exploreCategory, exploreQuery, guidedTourSearchQuery, guidedTourSelectedCenter, guidedTourSelectedDestinationKey]);
  const activeExploreCatalogPageSpec = useMemo(() => {
    if (tab !== 'explore' || exploreMode !== 'featured' || exploreSavedOnly) return null;
    const visibleQuery = exploreQuery.trim();
    const category = exploreCategoryFetchParamFromQuery(visibleQuery, exploreCategory);
    if (category === 'guided' || category === 'tours') return null;
    return exploreCatalogPageSpec(
      exploreCatalogRequestQuery,
      category,
      exploreSortMode,
      userLoc?.lat,
      userLoc?.lng,
    );
  }, [exploreCatalogRequestQuery, exploreCategory, exploreMode, exploreQuery, exploreSavedOnly, exploreSortMode, tab, userLoc?.lat, userLoc?.lng]);
  const activeExploreCatalogPage = activeExploreCatalogPageSpec
    ? exploreCatalogPages[activeExploreCatalogPageSpec.key]
    : undefined;

  const updateExploreCatalogPage = useCallback((
    key: string,
    next: ExploreCatalogPageState | ((current: ExploreCatalogPageState) => ExploreCatalogPageState),
  ) => {
    const current = exploreCatalogPagesRef.current[key] ?? { nextCursor: null, totalCount: 0, loading: false };
    const value = typeof next === 'function' ? next(current) : next;
    const updated = { ...exploreCatalogPagesRef.current, [key]: value };
    exploreCatalogPagesRef.current = updated;
    setExploreCatalogPages(updated);
    return value;
  }, []);

  useEffect(() => {
    explorePlacesRef.current = explorePlaces;
  }, [explorePlaces]);

  useEffect(() => {
    if (mapboxToken) return;
    let cancelled = false;
    storage.get('trailhead_mapbox_token').then(token => {
      if (!cancelled && token) setMapboxToken(token);
    }).catch(() => {});
    api.getConfig().then(cfg => {
      const token = cfg.mapbox_token || '';
      if (!token || cancelled) return;
      setMapboxToken(token);
      storage.set('trailhead_mapbox_token', token).catch(() => {});
    }).catch(() => {
      // Cached token was already attempted; keep the preview quiet if offline.
    });
    return () => { cancelled = true; };
  }, [mapboxToken, setMapboxToken]);

  useEffect(() => {
    if (requestedView === 'narrations' || requestedView === 'trip-audio') {
      setTab('narrations');
      return;
    }
    if (requestedView === 'weather' || requestedView === 'trip-weather') {
      setTab('weather');
      return;
    }
    setTab('explore');
  }, [requestedView]);

  useEffect(() => {
    if (guidedTourDraft.trim()) return;
    if (exploreCategory !== 'guided' && exploreCategory !== 'tours' && !isExplicitTourOnlyQuery(exploreQuery)) return;
    const seed = placeQueryFromExploreQuery(exploreQuery);
    if (seed) setGuidedTourDraft(seed);
  }, [exploreCategory, exploreQuery, guidedTourDraft]);

  useEffect(() => {
    let cancelled = false;
    let backgroundTimer: ReturnType<typeof setTimeout> | null = null;
    const homePageSpec = exploreCatalogPageSpec('', '', 'best');

    const mergeById = (base: ExplorePlaceProfile[], next: ExplorePlaceProfile[]) => {
      const seen = new Set(base.map(place => place.id));
      const merged = [...base];
      for (const place of next) {
        if (!place?.id || seen.has(place.id)) continue;
        seen.add(place.id);
        merged.push(place);
      }
      return merged;
    };

    const withExploreTimeout = <T,>(promise: Promise<T>, ms = 5200) => new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Explore catalog timeout')), ms);
      promise.then(
        value => {
          clearTimeout(timer);
          resolve(value);
        },
        error => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });

    const readCachedCatalog = async () => {
      const raw = await storage.get(EXPLORE_CACHE_KEY).catch(() => '');
      if (!raw) return { places: [] as ExplorePlaceProfile[], nextCursor: null as number | null, totalCount: 0 };
      try {
        const cached = JSON.parse(raw);
        const places = Array.isArray(cached?.places) ? cached.places as ExplorePlaceProfile[] : [];
        const nextCursor = cached?.next_cursor != null && Number.isFinite(Number(cached.next_cursor))
          ? Number(cached.next_cursor)
          : null;
        const totalCount = Number(cached?.total_count || places.length || 0);
        return { places, nextCursor, totalCount };
      } catch {
        return { places: [] as ExplorePlaceProfile[], nextCursor: null as number | null, totalCount: 0 };
      }
    };

    const hydrateRemainingCatalog = async (cursor: number | null | undefined, seededPlaces: ExplorePlaceProfile[]) => {
      if (cursor == null) return;
      const currentPage = exploreCatalogPagesRef.current[homePageSpec.key];
      if (currentPage?.loading || currentPage?.nextCursor !== cursor) return;
      updateExploreCatalogPage(homePageSpec.key, current => ({ ...current, loading: true }));
      let nextCursor: number | null = cursor;
      let allPlaces = seededPlaces;
      let totalCount = currentPage?.totalCount || seededPlaces.length;
      try {
        for (let page = 0; nextCursor != null && page < 2; page += 1) {
          const requestedCursor: number = nextCursor;
          const catalog = await api.getExploreCatalogIndex({ limit: 180, cursor: requestedCursor });
          if (cancelled) return;
          const pagePlaces = (catalog.places ?? []).map(exploreIndexItemToProfile);
          allPlaces = mergeById(allPlaces, pagePlaces);
          setExplorePlaces(current => mergeById(current, pagePlaces));
          totalCount = Number(catalog.total_count || catalog.count || totalCount || allPlaces.length);
          nextCursor = catalog.next_cursor === requestedCursor ? null : catalog.next_cursor ?? null;
          updateExploreCatalogPage(homePageSpec.key, {
            nextCursor,
            totalCount,
            loading: nextCursor != null && page < 1,
          });
          if (nextCursor != null) await new Promise(resolve => setTimeout(resolve, 220));
        }
      } finally {
        if (!cancelled) {
          updateExploreCatalogPage(homePageSpec.key, current => ({ ...current, nextCursor, totalCount, loading: false }));
          storage.set(EXPLORE_CACHE_KEY, JSON.stringify({
            places: allPlaces,
            next_cursor: nextCursor,
            total_count: totalCount,
            fetched_at: Date.now(),
          })).catch(() => {});
        }
      }
    };

    // Compact home load: show a curated first page, keep source-rich data findable through search/filter.
    setExploreLoading(true);
    (async () => {
      const applyFirstPage = (firstPage: Awaited<ReturnType<typeof api.getExploreHome>>) => {
        const firstPlaces = (firstPage.places ?? []).map(exploreIndexItemToProfile);
        const remoteDestinations = guidedDestinationsFromApi(firstPage.guided_destinations ?? firstPage.guided?.destinations);
        if (remoteDestinations.length) setGuidedDestinations(remoteDestinations);
        setExplorePlaces(current => current.length ? mergeById(current, firstPlaces) : firstPlaces);
        setExploreFacetCounts(exploreFacetCountsFromCatalog(firstPage, firstPlaces));
        const totalCount = Number(firstPage.total_count || firstPage.count || firstPlaces.length);
        const nextCursor = firstPage.next_cursor ?? null;
        updateExploreCatalogPage(homePageSpec.key, { nextCursor, totalCount, loading: false });
        storage.set(EXPLORE_CACHE_KEY, JSON.stringify({
          places: firstPlaces,
          next_cursor: nextCursor,
          total_count: totalCount,
          fetched_at: Date.now(),
        })).catch(() => {});
        setExploreError('');
        setExploreCatalogNotice('');
        setExploreLoading(false);
        backgroundTimer = setTimeout(() => {
          hydrateRemainingCatalog(nextCursor, firstPlaces).catch(() => {
            updateExploreCatalogPage(homePageSpec.key, current => ({ ...current, loading: false }));
          });
        }, 1200);
      };
      const firstPageRequest = api.getExploreHome({ mode: 'featured', sort: 'best', limit: 120 });
      try {
        const firstPage = await withExploreTimeout(firstPageRequest);
        if (cancelled) return;
        applyFirstPage(firstPage);
      } catch {
        const cached = await readCachedCatalog();
        if (cancelled) return;
        if (cached.places.length) {
          setExplorePlaces(current => current.length ? mergeById(current, cached.places) : cached.places);
          setExploreFacetCounts(current => Object.keys(current).length ? current : exploreFacetCountsFromPlaces(cached.places));
          updateExploreCatalogPage(homePageSpec.key, {
            nextCursor: cached.nextCursor,
            totalCount: cached.totalCount,
            loading: false,
          });
          setExploreError('');
          setExploreCatalogNotice('Offline: showing saved Explore data.');
          setExploreLoading(false);
        } else {
          setExploreError('');
          setExploreLoading(true);
          try {
            const firstPage = await firstPageRequest;
            if (cancelled) return;
            applyFirstPage(firstPage);
            return;
          } catch {
            if (cancelled) return;
            setExploreError('Places could not load. Try again when connected.');
            setExploreCatalogNotice('');
            setExploreLoading(false);
          }
        }
      }
    })();

    return () => {
      cancelled = true;
      if (backgroundTimer) clearTimeout(backgroundTimer);
    };
  }, [exploreCatalogReloadId, updateExploreCatalogPage]);



  useEffect(() => {
    const visibleQuery = exploreQuery.trim();
    const requestQuery = exploreCatalogRequestQuery;
    const category = exploreCategoryFetchParamFromQuery(visibleQuery, exploreCategory);
    const shouldFetch = tab === 'explore'
      && exploreMode === 'featured'
      && !exploreSavedOnly
      && (visibleQuery.length >= 2 || !!category);
    if (!shouldFetch) {
      setExploreSearchResolving(false);
      return;
    }

    let cancelled = false;
    const pageSpec = category === 'guided' || category === 'tours'
      ? null
      : exploreCatalogPageSpec(requestQuery, category, exploreSortMode, userLoc?.lat, userLoc?.lng);
    if (pageSpec) {
      updateExploreCatalogPage(pageSpec.key, { nextCursor: null, totalCount: 0, loading: true });
    }
    setExploreSearchResolving(true);
    const timer = setTimeout(() => {
      withExploreTimeout(api.getExploreCatalogIndex({
        q: requestQuery.length >= 2 ? requestQuery : undefined,
        category: category || undefined,
        mode: 'featured',
        sort: exploreSortMode === 'source' ? 'ready' : exploreSortMode,
        lat: exploreSortMode === 'nearest' ? userLoc?.lat : undefined,
        lng: exploreSortMode === 'nearest' ? userLoc?.lng : undefined,
        limit: 420,
        cursor: 0,
      }), 12000)
        .then(catalog => {
          if (cancelled) return;
          const matchedQuery = normalizeExploreText(visibleQuery);
          const remotePlaces = (catalog.places ?? []).map((item, index) => ({
            ...exploreIndexItemToProfile(item),
            matched_explore_query: matchedQuery,
            matched_explore_rank: index,
          }));
          if (pageSpec) {
            updateExploreCatalogPage(pageSpec.key, {
              nextCursor: catalog.next_cursor ?? null,
              totalCount: Number(catalog.total_count || catalog.count || remotePlaces.length),
              loading: false,
            });
          }
          setExploreFacetCounts(current => ({
            ...current,
            ...exploreFacetCountsFromCatalog(catalog, remotePlaces),
          }));
          if (remotePlaces.length) setExplorePlaces(current => mergeMatchedExplorePlaces(current, remotePlaces));
        })
        .catch(() => {
          if (!cancelled && pageSpec) {
            updateExploreCatalogPage(pageSpec.key, current => ({ ...current, loading: false }));
          }
        })
        .finally(() => {
          if (!cancelled) {
            setExploreSearchResolving(false);
            if (pageSpec) updateExploreCatalogPage(pageSpec.key, current => ({ ...current, loading: false }));
          }
        });
    }, 280);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (pageSpec) updateExploreCatalogPage(pageSpec.key, current => ({ ...current, loading: false }));
    };
  }, [tab, exploreMode, exploreQuery, exploreCatalogRequestQuery, exploreCategory, exploreSavedOnly, exploreSortMode, updateExploreCatalogPage, userLoc?.lat, userLoc?.lng]);

  useEffect(() => {
    if (exploreMode !== 'nearby' || !exploreNearbySearchCenter) {
      setLiveExplorePlaces([]);
      setLiveExploreError('');
      setLiveExploreLoading(false);
      return;
    }
    let cancelled = false;
    setLiveExploreLoading(true);
    setLiveExploreError('');
    const serviceCategory = exploreCategory === 'fuel' || exploreCategory === 'resupply' ? exploreCategory : null;
    const categories = serviceCategory === 'fuel'
      ? 'fuel'
      : serviceCategory === 'resupply'
        ? 'food,grocery,hardware,mechanic,medical,parts'
        : 'food,grocery,fuel,lodging,attraction,hardware,mechanic,medical,camping';
    const radii = serviceCategory ? [35, 100, 250] : [35];
    (async () => {
      let places: OsmPoi[] = [];
      for (const radius of radii) {
        const candidates = await api.getNearbyPlaces(exploreNearbySearchCenter.lat, exploreNearbySearchCenter.lng, radius, categories);
        places = serviceCategory
          ? candidates.filter(place => livePlaceMatchesCategory(place, serviceCategory))
          : candidates;
        if (places.length > 0) break;
      }
      return places;
    })()
      .then(places => {
        if (!cancelled) setLiveExplorePlaces(places.slice(0, serviceCategory ? 36 : 18));
      })
      .catch(() => {
        if (!cancelled) {
          setLiveExplorePlaces([]);
          setLiveExploreError('Nearby places could not refresh. Check your connection and try again.');
        }
      })
      .finally(() => {
        if (!cancelled) setLiveExploreLoading(false);
      });
    return () => { cancelled = true; };
  }, [exploreCategory, exploreMode, exploreLocationRequestId, exploreNearbySearchCenter?.lat, exploreNearbySearchCenter?.lng]);

  useEffect(() => {
    if (
      tab !== 'explore'
      || exploreMode !== 'nearby'
      || exploreNearbySearchCenter
      || exploreServiceDestinationQuery
    ) return;
    let cancelled = false;
    setExploreLocationState('requesting');
    setExploreHomeWeatherError('');
    (async () => {
      const existing = await Location.getForegroundPermissionsAsync().catch(() => null);
      if (cancelled) return;
      const permission = existing?.status === 'granted'
        ? existing
        : await Location.requestForegroundPermissionsAsync().catch(() => null);
      if (cancelled) return;
      if (permission?.status !== 'granted') {
        setExploreHomeWeather(null);
        setExploreLocationState(permission?.status === 'denied' && permission.canAskAgain === false ? 'blocked' : permission ? 'denied' : 'error');
        return;
      }
      const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
      if (cancelled) return;
      if (fix?.coords) {
        setUserLoc({ lat: fix.coords.latitude, lng: fix.coords.longitude });
        setExploreLocationState('idle');
      } else {
        setExploreHomeWeather(null);
        setExploreLocationState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [tab, exploreMode, exploreLocationRequestId, exploreNearbySearchCenter?.lat, exploreNearbySearchCenter?.lng, exploreServiceDestinationQuery, setUserLoc]);

  async function openExploreLocationSettings() {
    const permission = await Location.getForegroundPermissionsAsync().catch(() => null);
    if (permission?.status === 'granted') {
      setExploreLocationState('requesting');
      setExploreLocationRequestId(value => value + 1);
      return;
    }
    if (Platform.OS === 'web') {
      Alert.alert(
        'Location is blocked',
        "Allow location from this site's browser controls, then tap Use my location again.",
      );
      return;
    }
    Linking.openSettings().catch(() => {});
  }

  useEffect(() => {
    if (tab !== 'explore' || exploreMode !== 'nearby' || !exploreNearbySearchCenter) {
      setExploreHomeWeather(null);
      setExploreHomeWeatherError('');
      setExploreHomeWeatherLoading(false);
      return;
    }
    let cancelled = false;
    setExploreHomeWeatherLoading(true);
    setExploreHomeWeatherError('');
    api.getWeather(exploreNearbySearchCenter.lat, exploreNearbySearchCenter.lng, 3, weatherUnitMode)
      .then(weather => {
        if (!cancelled) setExploreHomeWeather(weather);
      })
      .catch(() => {
        if (!cancelled) setExploreHomeWeatherError('Weather is not loading right now.');
      })
      .finally(() => {
        if (!cancelled) setExploreHomeWeatherLoading(false);
      });
    return () => { cancelled = true; };
  }, [tab, exploreMode, exploreNearbySearchCenter?.lat, exploreNearbySearchCenter?.lng, weatherUnitMode]);

  useEffect(() => {
    setSelectedExplore(null);
    setSelectedLivePlace(null);
  }, [exploreQuery]);

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
    const withCampTimeout = <T,>(promise: Promise<T>, ms = 8000) => new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Explore campgrounds timeout')), ms);
      promise.then(
        value => {
          clearTimeout(timer);
          resolve(value);
        },
        error => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
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
        const fallback = await withCampTimeout(
          api.getDiscoveryCamps(fallbackLat, fallbackLng, fallbackRadius, [], {
            limit: 140,
            mode: 'light',
            stays: true,
            surface: 'explore_camp_rail',
            stale_after_hours: 12,
          }),
          9000,
        ).catch(() => []);
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
            setExploreCampErrors(prev => ({ ...prev, [placeId]: 'Search a wider area.' }));
          }
        })
        .finally(() => {
          if (!cancelled) setExploreCampLoadingId(current => current === placeId ? null : current);
      });
      return () => { cancelled = true; };
    }
    withCampTimeout(api.getExploreCampgrounds(placeId), 7000)
      .then(async res => {
        if (cancelled) return;
        const primary = res.campgrounds ?? [];
        let merged = primary;
        let sourceMode: 'official' | 'fallback' = 'official';
        if (fallbackLat != null && fallbackLng != null && primary.length < 6) {
          const fallback = await withCampTimeout(
            api.getDiscoveryCamps(fallbackLat, fallbackLng, fallbackRadius, [], {
              limit: 140,
              mode: 'light',
              stays: true,
              surface: 'explore_camp_rail',
              stale_after_hours: 12,
            }),
            9000,
          ).catch(() => []);
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
        setExploreCampErrors(prev => ({ ...prev, [placeId]: 'Search a wider area.' }));
      })
      .finally(() => {
        if (!cancelled) setExploreCampLoadingId(current => current === placeId ? null : current);
      });
    return () => { cancelled = true; };
  }, [selectedExplore?.id]);

  useEffect(() => {
    if (!selectedExplore) return;
    const place = selectedExplore;
    const placeId = place.id;
    if (!BOOKABLE_EXPERIENCES_ENABLED) {
      setExploreExperiencesById(prev => prev[placeId] ? prev : ({ ...prev, [placeId]: [] }));
      setExploreExperienceErrors(prev => ({ ...prev, [placeId]: '' }));
      setExploreExperienceLoadingId(current => current === placeId ? null : current);
      return;
    }
    if (isLocalCuratedExplorePlace(place)) {
      setExploreExperiencesById(prev => prev[placeId] ? prev : ({ ...prev, [placeId]: [] }));
      setExploreExperienceErrors(prev => ({ ...prev, [placeId]: '' }));
      setExploreExperienceLoadingId(current => current === placeId ? null : current);
      return;
    }
    let cancelled = false;
    const cacheKey = `${EXPLORE_EXPERIENCES_CACHE_PREFIX}${placeId}`;
    storage.get(cacheKey).then(raw => {
      if (cancelled || !raw || exploreExperiencesById[placeId]?.length) return;
      try {
        const cached = JSON.parse(raw);
        if (Array.isArray(cached?.experiences)) {
          setExploreExperiencesById(prev => ({ ...prev, [placeId]: cached.experiences }));
        }
      } catch {}
    }).catch(() => {});
    setExploreExperienceLoadingId(placeId);
    setExploreExperienceErrors(prev => ({ ...prev, [placeId]: '' }));
    api.getExplorePlaceExperiences(placeId, 24)
      .then(res => {
        if (cancelled) return;
        const experiences = res.results ?? [];
        setExploreExperiencesById(prev => ({ ...prev, [placeId]: experiences }));
        storage.set(cacheKey, JSON.stringify({ experiences, fetched_at: Date.now() })).catch(() => {});
      })
      .catch(() => {
        if (!cancelled) setExploreExperienceErrors(prev => ({ ...prev, [placeId]: 'Guided trips are not available right now.' }));
      })
      .finally(() => {
        if (!cancelled) setExploreExperienceLoadingId(current => current === placeId ? null : current);
      });
    return () => { cancelled = true; };
  }, [selectedExplore?.id]);

  useEffect(() => {
    const guidedCategoryActive = exploreCategory === 'guided' || exploreCategory === 'tours';
    const shouldLoad = tab === 'explore'
      && shouldSearchBookableExperiences(exploreQuery, exploreCategory)
      && (!guidedCategoryActive || guidedTourSearchRunId > 0 || isExplicitTourOnlyQuery(exploreQuery));
    if (!shouldLoad) {
      setExploreSearchExperiences([]);
      setExploreSearchExperienceError('');
      setExploreSearchExperienceAttribution('');
      setExploreSearchExperienceLoading(false);
      setExploreSearchExperiencePending(false);
      return;
    }
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const maxLiveRetries = 3;
    const loadTours = async (retryAttempt = 0) => {
      setExploreSearchExperienceLoading(true);
      if (retryAttempt === 0) {
        setExploreSearchExperienceError('');
        setExploreSearchExperiencePending(false);
      }
      const effectiveQuery = guidedCategoryActive ? (guidedTourSearchQuery || exploreQuery) : exploreQuery;
      const placeQuery = placeQueryFromExploreQuery(effectiveQuery);
      let center = userLoc ? { ...userLoc, name: 'this area' } : null;
      const knownCenter = guidedCategoryActive
        ? guidedTourSelectedCenter || guidedTourKnownDestinationCenter(placeQuery)
        : null;
      if (knownCenter) center = knownCenter;
      if (!center && placeQuery.length < 2) {
        setExploreSearchExperiences([]);
        setExploreSearchExperienceError('Search a destination to compare guided trips.');
        setExploreSearchExperienceLoading(false);
        setExploreSearchExperiencePending(false);
        return;
      }
      if (!knownCenter && placeQuery.length >= 2) {
        const [resolved] = await api.geocodePlaces(placeQuery, 1, { prefer: 'search_center' }).catch(() => []);
        if (cancelled) return;
        if (resolved?.lat != null && resolved?.lng != null) {
          center = { lat: Number(resolved.lat), lng: Number(resolved.lng), name: resolved.name || placeQuery };
        }
      }
      const tourOptions = guidedTourQueryOptions(guidedTourCategory, guidedTourSort, guidedTourDate, guidedTourCustomDate, guidedTourFreeCancel);
      if (guidedCategoryActive && guidedTourSelectedDestinationKey) {
        try {
          const res = await withExploreTimeout(
            api.getExploreGuidedDestination(guidedTourSelectedDestinationKey, effectiveQuery, 24, tourOptions),
            50000,
          );
          if (cancelled) return;
          const results = res.experiences ?? [];
          const matchedQuery = normalizeExploreText(effectiveQuery);
          const organicPlaces = (res.organic_places ?? []).map((item, index) => ({
            ...exploreIndexItemToProfile(item),
            matched_explore_query: matchedQuery,
            matched_explore_rank: index,
          }));
          const providerStatus = String(res.provider_status?.status || '').toLowerCase();
          const processing = providerStatus === 'processing' || providerStatus === 'queued';
          const shouldRetryLive = results.length === 0 && processing && retryAttempt < maxLiveRetries;
          setExploreSearchExperiences(results);
          setGuidedFallbackExplorePlaces(organicPlaces);
          if (organicPlaces.length) {
            setExplorePlaces(current => mergeMatchedExplorePlaces(current, organicPlaces));
            storage.set(
              `${EXPLORE_GUIDED_FALLBACK_CACHE_PREFIX}${guidedTourSelectedDestinationKey}`,
              JSON.stringify({ places: organicPlaces, fetched_at: Date.now() }),
            ).catch(() => {});
          }
          setExploreSearchExperienceAttribution(String(res.source || 'Viator'));
          setExploreSearchExperienceError(results.length ? '' : guidedDestinationSearchMessage(res, res.destination?.name || center?.name || 'this area'));
          setExploreSearchExperiencePending(shouldRetryLive);
          if (shouldRetryLive) retryTimer = setTimeout(() => loadTours(retryAttempt + 1), 6000);
        } catch {
          if (!cancelled) {
            const fallbackCenter = center
              ? { lat: Number(center.lat), lng: Number(center.lng), name: center.name }
              : null;
            const cachedFallback = guidedOrganicFallbackFromPlaces(
              explorePlacesRef.current,
              fallbackCenter,
              placeQuery,
            );
            setExploreSearchExperiences([]);
            setGuidedFallbackExplorePlaces(cachedFallback);
            setExploreSearchExperienceAttribution('');
            setExploreSearchExperienceError(cachedFallback.length
              ? `Guided trips are unavailable near ${fallbackCenter?.name || placeQuery || 'this area'} right now. Nearby places are shown below.`
              : 'Guided trips are not available right now.');
            setExploreSearchExperiencePending(false);
            storage.get(`${EXPLORE_GUIDED_FALLBACK_CACHE_PREFIX}${guidedTourSelectedDestinationKey}`)
              .then(raw => {
                if (cancelled || !raw) return;
                try {
                  const cached = JSON.parse(raw);
                  const places = Array.isArray(cached?.places)
                    ? cached.places.filter((place: ExplorePlaceProfile) => !!place?.id).slice(0, 6)
                    : [];
                  if (!places.length) return;
                  setGuidedFallbackExplorePlaces(places);
                  setExplorePlaces(current => mergeMatchedExplorePlaces(current, places));
                  setExploreSearchExperienceError(
                    `Guided trips are unavailable near ${fallbackCenter?.name || placeQuery || 'this area'} right now. Nearby places are shown below.`,
                  );
                } catch {}
              })
              .catch(() => {});
            if (placeQuery.length >= 2) {
              withExploreTimeout(api.getExploreCatalogIndex({ q: placeQuery, limit: 120, cursor: 0 }), 9000)
                .then(catalog => {
                  if (cancelled) return;
                  const catalogPlaces = (catalog.places ?? []).map(exploreIndexItemToProfile);
                  const organicPlaces = guidedOrganicFallbackFromPlaces(catalogPlaces, fallbackCenter, placeQuery);
                  if (!organicPlaces.length) return;
                  setGuidedFallbackExplorePlaces(organicPlaces);
                  setExplorePlaces(current => mergeMatchedExplorePlaces(current, organicPlaces));
                  setExploreSearchExperienceError(
                    `Guided trips are unavailable near ${fallbackCenter?.name || placeQuery}. Nearby places are shown below.`,
                  );
                })
                .catch(() => {});
            }
          }
        } finally {
          if (!cancelled) setExploreSearchExperienceLoading(false);
        }
        return;
      }
      withExploreTimeout(api.getExploreExperiences(center?.lat, center?.lng, center ? 60 : 100, 'viator', 48, effectiveQuery, tourOptions), 30000)
        .then(res => {
          if (cancelled) return;
          const results = res.results ?? [];
          const processing = String(res.live_status || '').toLowerCase() === 'processing';
          const shouldRetryLive = results.length === 0 && processing && retryAttempt < maxLiveRetries;
          setExploreSearchExperiences(results);
          setExploreSearchExperienceAttribution(String(res.attribution || res.source || 'Viator'));
          setExploreSearchExperienceError(results.length ? '' : experienceSearchMessage(res, center?.name || 'this area'));
          setExploreSearchExperiencePending(shouldRetryLive);
          if (shouldRetryLive) {
            retryTimer = setTimeout(() => loadTours(retryAttempt + 1), 6000);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setExploreSearchExperienceError('Guided trips are not available right now.');
            setExploreSearchExperiencePending(false);
          }
        })
        .finally(() => {
          if (!cancelled) setExploreSearchExperienceLoading(false);
        });
    };
    loadTours();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [tab, exploreCategory, exploreQuery, guidedTourCategory, guidedTourCustomDate, guidedTourDate, guidedTourFreeCancel, guidedTourSearchQuery, guidedTourSearchRunId, guidedTourSelectedCenter, guidedTourSelectedDestinationKey, guidedTourSort, userLoc?.lat, userLoc?.lng]);

  useEffect(() => {
    let cancelled = false;
    const requestEpoch = accountStorage.epoch();
    const requestAccountId = useStore.getState().user?.id;
    const requestTripId = activeTrip?.trip_id;
    const requestIsCurrent = () => !cancelled
      && accountStorage.epoch() === requestEpoch
      && String(useStore.getState().user?.id ?? '') === String(requestAccountId ?? '')
      && useStore.getState().activeTrip?.trip_id === requestTripId;
    if (!activeTrip) {
      setGuide({});
      setWeatherByWp({});
      setGuideLoading(false);
      setWeatherLoading(false);
      return () => { cancelled = true; };
    }
    setGuideError('');
    if (activeTrip.audio_guide) {
      setGuide(activeTrip.audio_guide);
    } else {
      setGuideLoading(true);
      api.getAudioGuide(activeTrip.trip_id, false)
        .then(nextGuide => { if (requestIsCurrent()) setGuide(nextGuide); })
        .catch(() => { if (requestIsCurrent()) setGuide({}); })
        .finally(() => { if (requestIsCurrent()) setGuideLoading(false); });
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
        if (!requestIsCurrent()) return;
        setWeatherByWp(results);
        setWeatherLoading(false);
      });
    }
    return () => { cancelled = true; };
  }, [activeTrip?.trip_id, activeTrip?.updated_at, user?.id, weatherUnitMode]);

  const waypoints = useMemo(() => activeTrip?.plan.waypoints.filter(w => w.lat && w.lng) ?? [], [activeTrip?.trip_id, activeTrip?.updated_at]);
  const displayName = useMemo(() => (user?.username || '').trim().split(/\s+/)[0] || '', [user?.username]);
  const enrichedExplorePlaces = useMemo(() => (
    mergeCuratedExplorePlaces(explorePlaces).map(place => exploreTrailAreasById[place.id] ?? place)
  ), [explorePlaces, exploreTrailAreasById]);
  const filteredLiveExplorePlaces = useMemo(
    () => liveExplorePlaces.filter(place => livePlaceMatchesCategory(place, exploreCategory)),
    [exploreCategory, liveExplorePlaces],
  );
  const exploreHubMeta = useMemo(() => buildExploreHubMeta(enrichedExplorePlaces), [enrichedExplorePlaces]);
  const availableExploreCategoryCounts = useMemo(() => {
    const serverHasCategories = Object.entries(exploreFacetCounts).some(([key, count]) => key !== 'all' && Number(count) > 0);
    const counts = serverHasCategories
      ? { ...exploreFacetCounts }
      : exploreFacetCountsFromPlaces(enrichedExplorePlaces);
    counts.all = Number(exploreFacetCounts.all || enrichedExplorePlaces.length || 0);
    counts.guided = guidedDestinations.length;
    return counts;
  }, [enrichedExplorePlaces, exploreFacetCounts, guidedDestinations.length]);
  const heroHeight = Math.max(310, Math.min(370, Math.round(windowHeight * 0.4)));
  const hasExploreQuery = exploreQuery.trim().length > 0;
  const guidedCategoryActive = exploreCategory === 'guided' || exploreCategory === 'tours';
  const showGuidedDestinations = guidedCategoryActive
    && guidedTourSearchRunId <= 0
    && !isExplicitTourOnlyQuery(exploreQuery);
  const guidedPanelQuery = guidedTourSearchQuery || guidedTourDraft || exploreQuery;
  const experienceDestinationLabel = placeQueryFromExploreQuery(guidedCategoryActive ? guidedPanelQuery : exploreQuery);
  const guidedVisibleExperiences = useMemo(() => (
    guidedTourEnglishOnly
      ? exploreSearchExperiences.filter(experienceMatchesEnglishFilter)
      : exploreSearchExperiences
  ), [exploreSearchExperiences, guidedTourEnglishOnly]);
  const guidedResultsError = guidedTourEnglishOnly && exploreSearchExperiences.length > 0 && guidedVisibleExperiences.length === 0
    ? 'No guided trips match these filters.'
    : exploreSearchExperienceError;
  const guidedExperienceSearchLoading = guidedCategoryActive
    ? exploreSearchExperienceLoading || exploreSearchExperiencePending
    : exploreSearchExperienceLoading;
  const guidedFallbackDisplayPlaces = useMemo(() => {
    if (!guidedCategoryActive || guidedTourSearchRunId <= 0 || guidedVisibleExperiences.length > 0) return [];
    if (guidedTourSelectedDestinationKey && guidedFallbackExplorePlaces.length) {
      return guidedFallbackExplorePlaces.slice(0, 6);
    }
    const query = normalizeExploreText(placeQueryFromExploreQuery(guidedTourSearchQuery || exploreQuery));
    if (query.length < 2) return [];
    const sourcePlaces = guidedFallbackExplorePlaces.length ? guidedFallbackExplorePlaces : enrichedExplorePlaces;
    return sourcePlaces
      .map(place => {
        const identityScore = explorePlaceIdentitySearchText(place).includes(query) ? 130 : 0;
        const queryScore = Math.max(
          identityScore,
          scoreExploreQuery(place, query),
          scoreExploreRichText(place, query),
        );
        return { place, queryScore };
      })
      .filter(item => item.queryScore > 0)
      .sort((a, b) => {
        if (b.queryScore !== a.queryScore) return b.queryScore - a.queryScore;
        const aRank = Number((a.place as any).matched_explore_rank ?? a.place.summary.hero_rank ?? a.place.summary.rank ?? 999999);
        const bRank = Number((b.place as any).matched_explore_rank ?? b.place.summary.hero_rank ?? b.place.summary.rank ?? 999999);
        return aRank - bRank;
      })
      .map(item => item.place)
      .slice(0, 6);
  }, [enrichedExplorePlaces, exploreQuery, guidedCategoryActive, guidedFallbackExplorePlaces, guidedTourSearchQuery, guidedTourSearchRunId, guidedTourSelectedDestinationKey, guidedVisibleExperiences.length]);
  const hasGuidedFallbackPlaces = guidedCategoryActive
    && guidedTourSearchRunId > 0
    && guidedVisibleExperiences.length === 0
    && guidedFallbackDisplayPlaces.length > 0;
  const showGuidedFallbackPlaces = hasGuidedFallbackPlaces && !guidedExperienceSearchLoading;
  const guidedExperienceRailError = guidedResultsError;
  const showExperienceSearch = shouldSearchBookableExperiences(exploreQuery, exploreCategory);
  const holdGuidedExploreResults = showExperienceSearch
    && guidedCategoryActive
    && guidedExperienceSearchLoading
    && guidedVisibleExperiences.length === 0;
  const tourSearchPaused = !BOOKABLE_EXPERIENCES_ENABLED && ((exploreCategory === 'guided' || exploreCategory === 'tours') || isExplicitTourOnlyQuery(exploreQuery));
  const browseExploreCategory: ExploreCategoryKey = tourSearchPaused ? 'things' : ((exploreCategory === 'guided' || exploreCategory === 'tours') && guidedVisibleExperiences.length === 0) ? 'all' : exploreCategory;
  const exploreTripNeedsRoute = exploreMode === 'trip' && waypoints.length === 0;
  const exploreNearbyNeedsLocation = exploreMode === 'nearby'
    && !exploreNearbySearchCenter
    && !exploreServiceDestinationQuery;
  const rankedExplore = useMemo(() => {
    if (exploreNearbyNeedsLocation || exploreServiceDestinationResolving || exploreServiceDestinationFailed) return [];
    if (exploreMode === 'trip' && waypoints.length === 0) return [];
    if ((exploreCategory === 'guided' || exploreCategory === 'tours') && guidedTourSearchRunId <= 0 && !isExplicitTourOnlyQuery(exploreQuery)) return [];
    if (!tourSearchPaused
      && showExperienceSearch
      && ((exploreCategory === 'guided' || exploreCategory === 'tours') || isExplicitTourOnlyQuery(exploreQuery))
      && guidedVisibleExperiences.length > 0
    ) return [];
    const places = enrichedExplorePlaces.map(place => {
      const loc = place.summary.lat != null && place.summary.lng != null
        ? { lat: Number(place.summary.lat), lng: Number(place.summary.lng) }
        : null;
      let distance: number | null = null;
      let day: number | undefined;
      const distanceCenter = exploreMode === 'nearby' ? exploreNearbySearchCenter : userLoc;
      if (loc && distanceCenter && (exploreMode === 'nearby' || exploreSortMode === 'nearest')) {
        distance = distMi(distanceCenter, loc);
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
    const normalizedActiveQuery = normalizeExploreText(query);
    const placeQuery = showExperienceSearch || isThingsToDoExploreQuery(query) ? placeQueryFromExploreQuery(query) : query;
    const queryCategory = exploreCategory === 'all' ? exploreCategoryFromQuery(query) : null;
    const queryHasDestinationTerms = exploreQueryHasDestinationTerms(placeQuery);
    const queryDestinationPhrase = exploreQueryDestinationPhrase(placeQuery);
    const exactDestinationPhrase = exactExploreDestinationPhraseFromQuery(query);
    const queryHasBrowseIntent = exploreQueryHasBrowseIntent(placeQuery);
    const thingsToDoQuery = isThingsToDoExploreQuery(query);
    const stayDestinationQuery = isStayExploreQuery(query) && queryHasDestinationTerms && !!queryDestinationPhrase;
    const browseIntentNeedsPrimaryMatch = browseExploreCategory === 'all' && queryHasBrowseIntent && queryHasDestinationTerms && !thingsToDoQuery;
    const queryRequiresIdentityMatch = queryDestinationPhrase.split(/\s+/).filter(Boolean).length > 1
      || (thingsToDoQuery && queryHasDestinationTerms)
      || (queryHasBrowseIntent && queryHasDestinationTerms && !!queryDestinationPhrase);
    const selectedCategoryDestinationSearch = browseExploreCategory !== 'all'
      && queryHasBrowseIntent
      && queryHasDestinationTerms
      && !!queryDestinationPhrase;
    const categorySearchQuery = selectedCategoryDestinationSearch ? queryDestinationPhrase : placeQuery;
    const hasCurrentRemoteSearchMatches = !!normalizedActiveQuery
      && enrichedExplorePlaces.some(place => normalizeExploreText(String((place as any).matched_explore_query || '')) === normalizedActiveQuery);
    const queryScoreForPlace = (place: ExplorePlaceProfile) => {
      const exactIdentityMatch = queryDestinationPhrase
        ? explorePlaceIdentitySearchText(place).includes(queryDestinationPhrase)
        : false;
      const identityMatch = queryDestinationPhrase
        ? exactIdentityMatch || explorePlaceIdentityMatchesDestination(place, queryDestinationPhrase)
        : false;
      const titleIdentityMatch = queryDestinationPhrase
        ? explorePlaceTitleMatchesDestination(place, queryDestinationPhrase)
        : false;
      const identityScore = identityMatch ? (titleIdentityMatch ? 118 : exactIdentityMatch ? 85 : 72) : 0;
      const activeSearchScore = Math.max(
        explorePlaceActiveSearchCanSatisfyIdentity(place, query) ? 70 : 0,
        selectedCategoryDestinationSearch && explorePlaceActiveSearchCanSatisfyIdentity(place, categorySearchQuery) ? 55 : 0,
      );
      const baseScore = Math.max(
        identityScore,
        activeSearchScore,
        scoreExploreQuery(place, categorySearchQuery),
        scoreExploreRichText(place, categorySearchQuery),
        scoreExploreHubExtraText(place, categorySearchQuery, exploreHubMeta.searchTextByHubId),
      );
      const directStayDestinationHub = stayDestinationQuery
        && isDestinationExploreHub(place)
        && !!queryDestinationPhrase
        && explorePlaceIdentityMatchesDestination(place, queryDestinationPhrase);
      if (directStayDestinationHub && identityScore > 0) return baseScore + 70;
      if (queryHasDestinationTerms && queryRequiresIdentityMatch && identityScore <= 0 && activeSearchScore <= 0) return 0;
      const intentScore = scoreExploreBrowseIntent(place, placeQuery, exploreHubMeta.categoryKeysByHubId, false);
      if (queryHasDestinationTerms && baseScore <= 0) return 0;
      if (!selectedCategoryDestinationSearch && queryHasBrowseIntent && intentScore < 35 && !(stayDestinationQuery && explorePlaceActiveSearchCanSatisfyIdentity(place, query))) return 0;
      return baseScore + intentScore;
    };
    const concreteBrowseMatchesExist = browseIntentNeedsPrimaryMatch && places.some(({ place }) => (
      !isLegacyExploreAreaWrapper(place)
      && explorePlacePrimaryCategoryMatchesBrowseIntent(place, placeQuery)
      && queryScoreForPlace(place) > 0
    ));
    const filtered = places.filter(({ place }) => {
      if (exploreSavedOnly && !savedExploreIds.includes(canonicalSavedEntityId(place.id, 'place'))) return false;
      if (!exploreSavedOnly && !placeQuery && exploreCategory === 'all' && shouldHideExploreHomeWrapper(place)) return false;
      if (!exploreSavedOnly && !placeQuery && exploreCategory === 'all' && exploreHubMeta.parentByChildId.has(place.id)) return false;
      if (!exploreSavedOnly && placeQuery && concreteBrowseMatchesExist && isLegacyExploreAreaWrapper(place)) return false;
      const directThingsToDoDestinationWrapper = thingsToDoQuery
        && !!queryDestinationPhrase
        && explorePlaceIdentityMatchesDestination(place, queryDestinationPhrase);
      const directStayDestinationHub = stayDestinationQuery
        && !!queryDestinationPhrase
        && isDestinationExploreHub(place)
        && explorePlaceIdentityMatchesDestination(place, queryDestinationPhrase);
      const directQueryIdentityMatch = !!queryDestinationPhrase
        && explorePlaceIdentityMatchesDestination(place, queryDestinationPhrase);
      const matchedCurrentRemoteSearch = !!normalizedActiveQuery
        && normalizeExploreText(String((place as any).matched_explore_query || '')) === normalizedActiveQuery;
      const matchedCurrentStayRemoteSearch = stayDestinationQuery
        && matchedCurrentRemoteSearch
        && explorePlacePrimaryCategoryMatchesBrowseIntent(place, placeQuery);
      if (exactDestinationPhrase && !matchedCurrentStayRemoteSearch && !explorePlaceIdentitySearchText(place).includes(exactDestinationPhrase)) return false;
      if (queryRequiresIdentityMatch && hasCurrentRemoteSearchMatches && !matchedCurrentRemoteSearch && !directQueryIdentityMatch) return false;
      if (queryRequiresIdentityMatch && !directQueryIdentityMatch && !matchedCurrentStayRemoteSearch && !explorePlaceStrictlyMatchesDestination(place, queryDestinationPhrase)) return false;
	      if (!exploreSavedOnly && placeQuery && isLegacyExploreAreaWrapper(place) && exploreHubMeta.parentByChildId.has(place.id) && !directThingsToDoDestinationWrapper && !directQueryIdentityMatch) return false;
	      const standaloneThingsBrowse = !placeQuery && browseExploreCategory === 'things';
	      const categoryOk = standaloneThingsBrowse
	        ? explorePlaceLooksLikeStandaloneThing(place)
	        : browseExploreCategory === 'all'
	          ? exploreCategoryMatchesWithHub(place, browseExploreCategory, exploreHubMeta.categoryKeysByHubId)
	          : exploreCategoryMatches(place, browseExploreCategory);
	      if (!categoryOk && !directStayDestinationHub) return false;
	      if (!queryHasDestinationTerms && isExactWaterfallBrowseQuery(placeQuery) && !explorePlaceStronglyMatchesWaterfall(place)) return false;
	      if (thingsToDoQuery && !explorePlaceMatchesThingsToDo(place, exploreHubMeta.categoryKeysByHubId)) return false;
      if (browseIntentNeedsPrimaryMatch && !directStayDestinationHub && !directQueryIdentityMatch && !matchedCurrentStayRemoteSearch && !explorePlacePrimaryCategoryMatchesBrowseIntent(place, placeQuery)) return false;
      if (browseExploreCategory === 'all' && queryCategory && queryCategory !== 'guided' && queryCategory !== 'tours' && !directStayDestinationHub && !matchedCurrentStayRemoteSearch && !exploreCategoryMatchesWithHub(place, queryCategory, exploreHubMeta.categoryKeysByHubId)) return false;
      if (!placeQuery) return true;
      return queryScoreForPlace(place) > 0;
    });
    const decorated = filtered.map(item => {
      const destinationHubBoost = thingsToDoQuery
        && !!queryDestinationPhrase
        && isDestinationExploreHub(item.place)
        && explorePlaceIdentityMatchesDestination(item.place, queryDestinationPhrase)
        ? 120
        : 0;
      return {
        ...item,
        queryScore: queryScoreForPlace(item.place) + destinationHubBoost,
        trustScore: scoreExploreTrust(item.place),
        contentScore: exploreContentQualityScore(item.place),
        categoryAffinity: exploreCategoryAffinity(item.place, browseExploreCategory, exploreHubMeta.categoryKeysByHubId),
      };
    });
    const sortByCategoryAffinity = (a: typeof decorated[number], b: typeof decorated[number]) => (
      browseExploreCategory === 'all' ? 0 : b.categoryAffinity - a.categoryAffinity
    );
    const sortByNearest = (a: typeof decorated[number], b: typeof decorated[number]) => {
      const aDist = a.distance ?? 99999;
      const bDist = b.distance ?? 99999;
      if (aDist !== bDist) return aDist - bDist;
      const categoryDiff = sortByCategoryAffinity(a, b);
      if (categoryDiff !== 0) return categoryDiff;
      if (b.trustScore !== a.trustScore) return b.trustScore - a.trustScore;
      return a.place.summary.rank - b.place.summary.rank;
    };
    const sortBySource = (a: typeof decorated[number], b: typeof decorated[number]) => {
      if (!query) {
        const categoryDiff = sortByCategoryAffinity(a, b);
        if (categoryDiff !== 0) return categoryDiff;
      }
      if (b.contentScore !== a.contentScore) return b.contentScore - a.contentScore;
      if (b.trustScore !== a.trustScore) return b.trustScore - a.trustScore;
      if (query && b.queryScore !== a.queryScore) return b.queryScore - a.queryScore;
      const categoryDiff = sortByCategoryAffinity(a, b);
      if (categoryDiff !== 0) return categoryDiff;
      const aDist = a.distance ?? 99999;
      const bDist = b.distance ?? 99999;
      if (aDist !== bDist) return aDist - bDist;
      return a.place.summary.rank - b.place.summary.rank;
    };
    if (exploreMode === 'featured') {
      const sorted = decorated.sort((a, b) => {
        if (exploreSortMode === 'nearest') return sortByNearest(a, b);
        if (exploreSortMode === 'source') return sortBySource(a, b);
        if (query && b.queryScore !== a.queryScore) return b.queryScore - a.queryScore;
        if (query) {
          const aMatchedRank = stableMatchedExploreRank(a.place);
          const bMatchedRank = stableMatchedExploreRank(b.place);
          if (aMatchedRank !== bMatchedRank) return aMatchedRank - bMatchedRank;
        }
        if (query && b.contentScore !== a.contentScore) return b.contentScore - a.contentScore;
        const categoryDiff = sortByCategoryAffinity(a, b);
        if (categoryDiff !== 0) return categoryDiff;
        const aServingPosition = Number(a.place.ranking?.position);
        const bServingPosition = Number(b.place.ranking?.position);
        if (Number.isFinite(aServingPosition) && Number.isFinite(bServingPosition) && aServingPosition !== bServingPosition) {
          return aServingPosition - bServingPosition;
        }
        const aHero = a.place.summary.hero_rank ?? a.place.summary.rank;
        const bHero = b.place.summary.hero_rank ?? b.place.summary.rank;
        if (aHero !== bHero) return aHero - bHero;
        if (b.trustScore !== a.trustScore) return b.trustScore - a.trustScore;
        return a.place.summary.rank - b.place.summary.rank;
      });
      return dedupeRankedExploreItems(sorted);
    }
    const sorted = decorated
      .filter(item => item.distance == null || item.distance < (exploreMode === 'trip' ? 250 : 1200))
      .sort((a, b) => {
        if (exploreSortMode === 'nearest') return sortByNearest(a, b);
        if (exploreSortMode === 'source') return sortBySource(a, b);
        if (query && b.queryScore !== a.queryScore) return b.queryScore - a.queryScore;
        if (query) {
          const aMatchedRank = stableMatchedExploreRank(a.place);
          const bMatchedRank = stableMatchedExploreRank(b.place);
          if (aMatchedRank !== bMatchedRank) return aMatchedRank - bMatchedRank;
        }
        if (query && b.contentScore !== a.contentScore) return b.contentScore - a.contentScore;
        const categoryDiff = sortByCategoryAffinity(a, b);
        if (categoryDiff !== 0) return categoryDiff;
        const aDist = a.distance ?? 99999;
        const bDist = b.distance ?? 99999;
        const distanceThreshold = exploreMode === 'trip' ? 10 : 20;
        if (Math.abs(aDist - bDist) > distanceThreshold) return aDist - bDist;
        if (b.trustScore !== a.trustScore) return b.trustScore - a.trustScore;
        return aDist - bDist;
      });
    return dedupeRankedExploreItems(sorted);
  }, [browseExploreCategory, enrichedExplorePlaces, exploreCategory, exploreHubMeta, exploreMode, exploreNearbyNeedsLocation, exploreNearbySearchCenter?.lat, exploreNearbySearchCenter?.lng, exploreNearbySearchCenter?.name, exploreQuery, exploreSavedOnly, exploreServiceDestinationFailed, exploreServiceDestinationResolving, exploreSortMode, guidedTourSearchRunId, guidedVisibleExperiences.length, savedExploreIds, showExperienceSearch, tourSearchPaused, userLoc?.lat, userLoc?.lng, waypoints]);

  useEffect(() => {
    setExploreVisibleLimit(EXPLORE_INITIAL_VISIBLE);
  }, [exploreCategory, exploreMode, exploreQuery, exploreSavedOnly]);

  useEffect(() => {
    const query = exploreQuery.trim();
    if (
      tab !== 'explore'
      || exploreMode !== 'featured'
      || exploreSavedOnly
      || exploreSearchResolving
      || query.length < 2
      || !exploreQueryHasBrowseIntent(query)
      || isStayExploreQuery(query)
      || rankedExplore.length !== 1
    ) {
      return;
    }
    const wrapper = rankedExplore[0]?.place;
    if (!wrapper || !isLegacyExploreAreaWrapper(wrapper)) return;
    const destination = canonicalExploreParentTitle(wrapper)
      || protectedDestinationTitleForExplorePlace(wrapper)
      || query;
    const category = exploreCategoryFetchParamFromQuery(query, exploreCategory);
    const key = `${normalizeExploreText(query)}:${normalizeExploreText(destination)}:${category || 'all'}`;
    if (exploreSearchRefinementKeys.current.has(key)) return;
    exploreSearchRefinementKeys.current.add(key);

    let cancelled = false;
    setExploreSearchResolving(true);
    withExploreTimeout(api.getExploreCatalogIndex({
      q: destination,
      category: category || undefined,
      limit: 420,
      cursor: 0,
    }), 9000)
      .then(catalog => {
        if (cancelled) return;
        const matchedQuery = normalizeExploreText(query);
        const remotePlaces = (catalog.places ?? []).map((item, index) => ({
          ...exploreIndexItemToProfile(item),
          matched_explore_query: matchedQuery,
          matched_explore_rank: index,
        }));
        if (!remotePlaces.length) return;
        setExplorePlaces(current => mergeMatchedExplorePlaces(current, remotePlaces));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setExploreSearchResolving(false);
      });
    return () => {
      cancelled = true;
      setExploreSearchResolving(false);
    };
  }, [exploreCategory, exploreMode, exploreQuery, exploreSavedOnly, rankedExplore, tab]);

  useEffect(() => {
    const guidedCategoryActiveNow = exploreCategory === 'guided' || exploreCategory === 'tours';
    const query = (guidedTourSearchQuery || exploreQuery).trim();
    const destination = placeQueryFromExploreQuery(query);
    if (guidedTourSelectedDestinationKey) return;
    if (
      tab !== 'explore'
      || exploreMode !== 'featured'
      || exploreSavedOnly
      || !guidedCategoryActiveNow
      || guidedTourSearchRunId <= 0
      || destination.length < 2
    ) {
      setGuidedFallbackExplorePlaces([]);
      return;
    }
    let cancelled = false;
    const matchedQuery = normalizeExploreText(query);
    withExploreTimeout(api.getExploreCatalogIndex({
      q: destination,
      limit: 120,
      cursor: 0,
    }), 9000)
      .then(catalog => {
        if (cancelled) return;
        const remotePlaces = (catalog.places ?? []).map((item, index) => ({
          ...exploreIndexItemToProfile(item),
          matched_explore_query: matchedQuery,
          matched_explore_rank: index,
        }));
        setGuidedFallbackExplorePlaces(remotePlaces.slice(0, 6));
        if (remotePlaces.length) setExplorePlaces(current => mergeMatchedExplorePlaces(current, remotePlaces));
      })
      .catch(() => {
        if (!cancelled) setGuidedFallbackExplorePlaces([]);
      });
    return () => {
      cancelled = true;
    };
  }, [exploreCategory, exploreMode, exploreQuery, exploreSavedOnly, guidedTourSearchQuery, guidedTourSearchRunId, guidedTourSelectedDestinationKey, tab]);

  const holdLegacySearchWrapper = exploreSearchResolving
    && exploreQueryHasBrowseIntent(exploreQuery)
    && rankedExplore.length === 1
    && isLegacyExploreAreaWrapper(rankedExplore[0].place);

  useEffect(() => {
    const query = exploreQuery.trim();
    if (
      tab !== 'explore'
      || exploreMode !== 'featured'
      || exploreSavedOnly
      || exploreLoading
      || exploreSearchResolving
      || tourSearchPaused
      || showExperienceSearch
      || query.length < 3
    ) {
      return;
    }
    const category = exploreCategoryFetchParamFromQuery(query, exploreCategory);
    const enrichmentQuery = isThingsToDoExploreQuery(query) ? placeQueryFromExploreQuery(query) : query;
    if (enrichmentQuery.length < 2) return;
    const shouldEnrich = rankedExplore.length === 0 || (category === 'things' && rankedExplore.length < 4);
    if (!shouldEnrich) return;
    const key = `${normalizeExploreText(enrichmentQuery)}:${category || 'all'}`;
    if (exploreEnrichmentKeys.current.has(key)) return;
    exploreEnrichmentKeys.current.add(key);

    let cancelled = false;
    api.getExploreEnrichment({
      q: enrichmentQuery,
      category: category || undefined,
      limit: 8,
    })
      .then(res => {
        if (cancelled || !Array.isArray(res.places) || res.places.length === 0) return;
        const matchedQuery = normalizeExploreText(enrichmentQuery);
        setExplorePlaces(current => {
          const seen = new Set(current.map(place => place.id));
          const merged = [...current];
          res.places.forEach((place, index) => {
            if (!place?.id) return;
            const enriched = {
              ...place,
              matched_explore_query: matchedQuery,
              matched_explore_rank: index,
            } as ExplorePlaceProfile;
            const existingIndex = merged.findIndex(item => item.id === place.id);
            if (existingIndex >= 0) {
              merged[existingIndex] = {
                ...merged[existingIndex],
                ...enriched,
              } as ExplorePlaceProfile;
              return;
            }
            if (seen.has(place.id)) return;
            seen.add(place.id);
            merged.push(enriched);
          });
          return merged;
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [exploreCategory, exploreLoading, exploreMode, exploreQuery, exploreSavedOnly, exploreSearchResolving, rankedExplore.length, showExperienceSearch, tab, tourSearchPaused]);

  const visibleRankedExplore = useMemo(
    () => holdLegacySearchWrapper ? [] : rankedExplore.slice(0, exploreVisibleLimit),
    [holdLegacySearchWrapper, rankedExplore, exploreVisibleLimit],
  );
  const canLoadMoreExploreCatalog = !!activeExploreCatalogPageSpec && activeExploreCatalogPage?.nextCursor != null;
  const exploreCatalogPageLoading = !!activeExploreCatalogPage?.loading;
  const exploreLocalRemaining = Math.max(0, rankedExplore.length - visibleRankedExplore.length);
  const detailHydrationWindow = useMemo(
    () => rankedExplore.slice(0, Math.min(rankedExplore.length, exploreVisibleLimit + EXPLORE_VISIBLE_STEP)),
    [exploreVisibleLimit, rankedExplore],
  );
  const visibleExplorePrefetchKey = detailHydrationWindow.map(({ place }) => place.id).join('|');

  useEffect(() => {
    if (tab !== 'explore' || exploreLoading || exploreSearchResolving || holdLegacySearchWrapper) return;
    const candidates = detailHydrationWindow
      .map(({ place }) => place)
      .filter(place => {
        if (!place?.id || !shouldPrefetchExploreDetail(place)) return false;
        if (exploreDetailPrefetchKeys.current.has(place.id)) return false;
        exploreDetailPrefetchKeys.current.add(place.id);
        return true;
      });
    if (!candidates.length) return;
    let cancelled = false;
    const chunks: string[][] = [];
    for (let index = 0; index < candidates.length; index += 24) {
      chunks.push(candidates.slice(index, index + 24).map(place => place.id));
    }
    Promise.allSettled(chunks.map(ids => api.getExplorePlacesBulk(ids))).then(results => {
      if (cancelled) return;
      const details = results
        .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof api.getExplorePlacesBulk>>> => result.status === 'fulfilled' && Array.isArray(result.value?.places))
        .flatMap(result => result.value.places)
        .filter((place): place is ExplorePlaceProfile => !!place?.id);
      if (!details.length) return;
      setExplorePlaces(current => {
        let changed = false;
        const byId = new Map(details.map(place => [place.id, place]));
        const merged = current.map(place => {
          const detail = byId.get(place.id);
          if (!detail) return place;
          changed = true;
          return hasExploreTrailCards(place) && !hasExploreTrailCards(detail)
            ? mergeDynamicTrailArea(detail, place)
            : { ...place, ...detail } as ExplorePlaceProfile;
        });
        return changed ? merged : current;
      });
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [exploreLoading, exploreSearchResolving, holdLegacySearchWrapper, tab, visibleExplorePrefetchKey]);

  const showExploreHome = !hasExploreQuery && !exploreSavedOnly && exploreCategory === 'all' && exploreMode === 'featured';
  const featuredLead = useMemo(() => {
    if (!showExploreHome) return null;
    return rankedExplore.find(({ place }) => !!(place.summary.image_url || place.summary.thumbnail_url)) ?? rankedExplore[0] ?? null;
  }, [rankedExplore, showExploreHome]);
  const trendingExplore = useMemo(() => {
    if (!showExploreHome) return [];
    const used = new Set<string>();
    if (featuredLead?.place.id) used.add(featuredLead.place.id);
    const candidates = rankedExplore
      .filter(({ place }) => !used.has(place.id) && !!(place.summary.image_url || place.summary.thumbnail_url))
      .sort((a, b) => {
        const aHero = a.place.summary.hero_rank ?? a.place.summary.rank;
        const bHero = b.place.summary.hero_rank ?? b.place.summary.rank;
        if (aHero !== bHero) return aHero - bHero;
        return scoreExploreTrust(b.place) - scoreExploreTrust(a.place);
      });
    const picks: typeof candidates = [];
    const textFor = (place: ExplorePlaceProfile) => [
      place.id,
      place.summary.title,
      place.summary.state,
      place.summary.region,
      place.summary.category,
      place.summary.short_description,
      place.summary.hook,
      ...(place.summary.tags ?? []),
    ].filter(Boolean).join(' ').toLowerCase();
    const pick = (match: (text: string) => boolean) => {
      const item = candidates.find(candidate => !used.has(candidate.place.id) && match(textFor(candidate.place)));
      if (item) {
        used.add(item.place.id);
        picks.push(item);
      }
    };
    pick(text => /pakistan|gilgit|karakoram|hunza|k2|baltistan/.test(text));
    pick(text => /\b(ca|ut|az|wy|mt|co|wa|or|id|tn|nc|me|usa|united states|yosemite|zion|glacier|teton|moab)\b/.test(text));
    pick(text => /italy|italia|dolomite|dolomites|alps|switzerland|france|norway|iceland|slovenia|austria|scotland|spain|portugal/.test(text));
    for (const item of candidates) {
      if (picks.length >= 4) break;
      if (used.has(item.place.id)) continue;
      used.add(item.place.id);
      picks.push(item);
    }
    return picks.slice(0, 4);
  }, [featuredLead?.place.id, rankedExplore, showExploreHome]);
  const trendingExploreCategory = useMemo<ExploreCategoryKey>(() => {
    return trendingExplore
      .map(({ place }) => getExploreCategoryKey(place))
      .find(key => key !== 'all') ?? 'parks';
  }, [trendingExplore]);
  const featuredReservedExploreIds = useMemo(() => {
    const used = new Set<string>();
    if (featuredLead?.place.id) used.add(featuredLead.place.id);
    trendingExplore.forEach(item => used.add(item.place.id));
    return used;
  }, [featuredLead?.place.id, trendingExplore]);
  const heroWeather = useMemo(() => {
    const daily = exploreHomeWeather?.daily;
    const current = exploreHomeWeather?.current;
    const units = exploreHomeWeather?.trailhead_units;
    const tempLabel = units?.temperature_label ?? (weatherUnitMode === 'metric' ? '°C' : '°F');
    const windLabel = units?.wind_label ?? (weatherUnitMode === 'metric' ? 'km/h' : 'mph');
    const code = Number(current?.weather_code ?? daily?.weathercode?.[0] ?? 3);
    const currentTemp = Number(current?.temperature_2m);
    const hi = Number(daily?.temperature_2m_max?.[0]);
    const lo = Number(daily?.temperature_2m_min?.[0]);
    const wind = Number(current?.wind_speed_10m ?? daily?.windspeed_10m_max?.[0]);
    const temp = Number.isFinite(currentTemp)
      ? `${Math.round(currentTemp)}${tempLabel}`
      : Number.isFinite(hi)
        ? `${Math.round(hi)}${tempLabel}`
        : exploreHomeWeatherLoading
          ? ''
          : 'Weather';
    const hiLo = Number.isFinite(hi) && Number.isFinite(lo)
      ? `${Math.round(hi)}/${Math.round(lo)}${tempLabel}`
      : '';
    const windText = Number.isFinite(wind) ? `${Math.round(wind)} ${windLabel}` : '';
    const detail = exploreHomeWeather
      ? [hiLo, windText].filter(Boolean).join(' · ') || 'Current area'
      : exploreHomeWeatherError || 'Current area';
    return {
      loading: exploreHomeWeatherLoading,
      unavailable: !exploreHomeWeather && !exploreHomeWeatherLoading,
      icon: wmoIcon(code),
      temp,
      detail,
      unitMode: weatherUnitMode,
      onUnitChange: setWeatherUnitMode,
    };
  }, [exploreHomeWeather, exploreHomeWeatherError, exploreHomeWeatherLoading, setWeatherUnitMode, weatherUnitMode]);

  const featuredSections = useMemo(() => {
    if (hasExploreQuery || exploreSavedOnly || exploreCategory !== 'all' || exploreMode !== 'featured') return [];
    const used = new Set(featuredReservedExploreIds);
    return FEATURED_SECTION_ORDER.slice(0, 6)
      .map(key => {
        const rows = rankedExplore
          .filter(({ place }) => {
            if (used.has(place.id)) return false;
            return exploreHomeShelfKey(place, exploreHubMeta.categoryKeysByHubId) === key;
          })
          .sort((a, b) => (a.place.summary.hero_rank ?? a.place.summary.rank) - (b.place.summary.hero_rank ?? b.place.summary.rank))
          .slice(0, 3);
        rows.forEach(({ place }) => used.add(place.id));
        return {
          key,
          label: exploreCategoryLabel(key),
          rows,
        };
      })
      .filter(section => section.rows.length > 0);
  }, [exploreCategory, exploreHubMeta.categoryKeysByHubId, exploreMode, exploreSavedOnly, featuredReservedExploreIds, hasExploreQuery, rankedExplore]);
  const featuredHomeMoreExplore = useMemo(() => {
    if (!showExploreHome || exploreVisibleLimit <= EXPLORE_INITIAL_VISIBLE) return [];
    const displayed = new Set(featuredReservedExploreIds);
    featuredSections.forEach(section => section.rows.forEach(({ place }) => displayed.add(place.id)));
    const limit = exploreVisibleLimit - EXPLORE_INITIAL_VISIBLE;
    return rankedExplore.filter(({ place }) => !displayed.has(place.id)).slice(0, limit);
  }, [exploreVisibleLimit, featuredReservedExploreIds, featuredSections, rankedExplore, showExploreHome]);
  const exploreHomeCountLabel = useMemo(() => {
    if (tourSearchPaused) return 'Free ideas';
    if (holdLegacySearchWrapper) return 'Searching';
    if (exploreSearchResolving && rankedExplore.length <= 0) return 'Searching';
    if (showExperienceSearch) {
      if (guidedCategoryActive && guidedTourSearchRunId <= 0 && !isExplicitTourOnlyQuery(exploreQuery)) return 'Search trips';
      if (guidedVisibleExperiences.length > 0) return exploreCountLabel(guidedVisibleExperiences.length, 'guided trip', 'guided trips');
      if (guidedExperienceSearchLoading) return experienceDestinationLabel ? 'Finding guided trips' : 'Search destination';
      if (showGuidedFallbackPlaces) return exploreCountLabel(guidedFallbackDisplayPlaces.length, 'place', 'places');
      if (guidedResultsError) {
        if (!experienceDestinationLabel) return 'Search destination';
        return /unavailable|failed/i.test(guidedResultsError) ? 'Try again' : 'Try a new search';
      }
      return experienceDestinationLabel ? 'Try a new search' : 'Search destination';
    }
    if (!showExploreHome) {
      if (exploreMode === 'nearby' && filteredLiveExplorePlaces.length > 0) {
        return exploreCountLabel(filteredLiveExplorePlaces.length, 'nearby place', 'nearby places');
      }
      if (rankedExplore.length <= 0) {
        if (exploreSavedOnly) return 'Save places here';
        if (exploreNearbyNeedsLocation) return 'Location needed';
        if (exploreTripNeedsRoute) return 'Open a trip first';
        return 'Search places';
      }
      return exploreCountLabel(rankedExplore.length, 'place', 'places');
    }
    const count = (featuredLead ? 1 : 0)
      + trendingExplore.length
      + featuredSections.reduce((total, section) => total + section.rows.length, 0)
      + featuredHomeMoreExplore.length;
    return exploreCountLabel(count, 'featured pick', 'featured picks');
  }, [exploreMode, exploreNearbyNeedsLocation, exploreSavedOnly, exploreSearchResolving, exploreTripNeedsRoute, experienceDestinationLabel, featuredHomeMoreExplore.length, featuredLead, featuredSections, filteredLiveExplorePlaces.length, guidedCategoryActive, guidedExperienceSearchLoading, guidedFallbackDisplayPlaces.length, guidedResultsError, guidedTourSearchRunId, guidedVisibleExperiences.length, holdLegacySearchWrapper, rankedExplore.length, showExperienceSearch, showExploreHome, showGuidedFallbackPlaces, tourSearchPaused, trendingExplore.length, exploreQuery]);
  const relatedExplore = useMemo(() => {
    if (selectedExplore?.summary.lat == null || selectedExplore?.summary.lng == null) return [];
    const selectedGroup = groupForExplorePlace(selectedExplore);
    const origin = { lat: Number(selectedExplore.summary.lat), lng: Number(selectedExplore.summary.lng) };
    return enrichedExplorePlaces
      .filter(place => place.id !== selectedExplore.id && !exploreHubMeta.parentByChildId.has(place.id) && place.summary.lat != null && place.summary.lng != null)
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
  }, [enrichedExplorePlaces, exploreHubMeta.parentByChildId, selectedExplore?.id, selectedExplore?.summary.lat, selectedExplore?.summary.lng]);

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
      setExploreTrailAreaErrors(prev => ({ ...prev, [place.id]: 'Nearby trails will appear when this area has enough detail.' }));
      return place;
    } catch {
      setExploreTrailAreaErrors(prev => ({ ...prev, [place.id]: 'Could not load trails right now.' }));
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
    const requestEpoch = accountStorage.epoch();
    const requestAccountId = useStore.getState().user?.id;
    const requestTripId = activeTrip.trip_id;
    const requestIsCurrent = () => {
      const current = useStore.getState();
      return accountStorage.epoch() === requestEpoch
        && String(current.user?.id ?? '') === String(requestAccountId ?? '')
        && current.activeTrip?.trip_id === requestTripId;
    };
    setGuideError('');
    setGuideLoading(true);
    try {
      const generated = await api.getAudioGuide(activeTrip.trip_id, true);
      if (!requestIsCurrent()) return;
      setGuide(generated);
      setActiveTrip({ ...activeTrip, audio_guide: generated });
    } catch (e: any) {
      if (!requestIsCurrent()) return;
      if (e instanceof PaywallError) {
        setGuideError(e.message || 'Explorer is required for new trip audio.');
        showPaywall(e);
      } else {
        setGuideError('Could not generate the audio guide right now.');
      }
    } finally {
      if (requestIsCurrent()) setGuideLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const requestEpoch = accountStorage.epoch();
    const requestAccountId = useStore.getState().user?.id;
    const requestTripId = activeTrip?.trip_id;
    const requestIsCurrent = () => !cancelled
      && accountStorage.epoch() === requestEpoch
      && String(useStore.getState().user?.id ?? '') === String(requestAccountId ?? '')
      && useStore.getState().activeTrip?.trip_id === requestTripId;
    if (!autoPlay || !activeTrip) {
      safelyRemoveSubscription(locationSub.current);
      locationSub.current = null;
      return () => { cancelled = true; };
    }
    Location.requestForegroundPermissionsAsync().then(({ status }) => {
      if (status !== 'granted' || !requestIsCurrent()) return;
      Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 200 },
        loc => {
          if (!requestIsCurrent()) return;
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
      ).then(sub => {
        if (!requestIsCurrent()) {
          safelyRemoveSubscription(sub);
          return;
        }
        locationSub.current = sub;
      });
    });
    return () => {
      cancelled = true;
      safelyRemoveSubscription(locationSub.current);
      locationSub.current = null;
    };
  }, [autoPlay, activeTrip?.trip_id, guide, user?.id]);

  useEffect(() => {
    stopTrailheadVoice();
    stopStoryHighlight();
    setPlaying(null);
  }, [activeTrip?.trip_id, user?.id]);

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
    if (lat == null || lng == null) {
      const url = place.source_pack?.official_url || place.summary.source_url || place.facts?.source_url;
      if (url) Linking.openURL(url).catch(() => {});
      return;
    }
    const mapCategory = getExploreCategoryKey(place);
    const photos = [
      ...(place.summary.image_url ? [{ url: mediaUrl(place.summary.image_url), source: place.attribution || place.source_pack?.primary }] : []),
      ...(place.summary.thumbnail_url ? [{ url: mediaUrl(place.summary.thumbnail_url), source: place.attribution || place.source_pack?.primary }] : []),
      ...((place.source_pack?.photos ?? []).map(photo => ({
        url: mediaUrl(photo.url),
        credit: photo.credit,
        caption: photo.caption,
        source: place.source_pack?.primary || place.attribution,
        license: photo.license,
      }))),
    ].filter(photo => !!photo.url);
    setPendingMapSelection({
      kind: 'explorePlace',
      place: {
        id: place.id,
        name: title,
        lat: Number(lat),
        lng: Number(lng),
        category: mapCategory,
        region: place.card?.region,
        summary: place.profile.summary || place.profile.hook || place.summary.short_description || place.summary.hook,
        note: place.summary.short_description || place.summary.hook || '',
        imageUrl: mediaUrl(place.summary.image_url || place.summary.thumbnail_url),
        photos,
        sourceLabel: cleanExploreSourceLabel(place.source_quality?.primary_name || place.source_pack?.primary || place.attribution, ''),
        sourceUrl: place.summary.source_url || place.facts?.source_url,
        officialUrl: place.source_pack?.official_url || place.facts?.official_url,
        freshnessLabel: place.source_quality?.freshness_label || (place.facts?.last_updated ? `Updated ${new Date(Number(place.facts.last_updated) * 1000).toLocaleDateString()}` : ''),
        relatedContext: exploreMapRelatedContext(place, exploreCampgroundsById[place.id] ?? []),
      },
    });
    setSelectedExplore(null);
    router.push('/(tabs)/map');
  }

  function showSourcePackItemOnMap(item: ExploreSourcePackItem) {
    const lat = Number(item.lat);
    const lng = Number(item.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      if (item.url) Linking.openURL(item.url);
      return;
    }
    const sourceKey = String(item.source_id || item.title || item.kind || 'detail')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'detail';
    setPendingMapSelection({
      kind: 'place',
      place: {
        id: `source-pack:${selectedExplore?.id || 'explore'}:${sourceKey}`,
        name: item.title || 'Explore stop',
        lat,
        lng,
        icon: item.kind === 'campground' ? 'camp' : 'pin',
        note: item.description || item.kind || item.source_label || '',
        sourceLabel: item.source_label || item.source || selectedExplore?.source_pack?.primary,
        createdAt: Date.now(),
      },
    });
    setSelectedExplore(null);
    router.push('/(tabs)/map');
  }

  function routeExplore(place: ExplorePlaceProfile) {
    const { lat, lng, title } = place.summary;
    if (lat == null || lng == null) {
      showExploreOnMap(place);
      return;
    }
    if (!userLoc) {
      showExploreOnMap(place);
      return;
    }
    setPendingNavigatePlace({ lat: Number(lat), lng: Number(lng), name: title });
    setSelectedExplore(null);
    router.push('/(tabs)/map');
  }

  function isExploreSaved(place: ExplorePlaceProfile) {
    return savedExploreIds.includes(canonicalSavedEntityId(place.id, 'place'));
  }

  function isExploreAddedToTrip(place: ExplorePlaceProfile) {
    if (!activeTrip) return false;
    const canonicalTrip = getTrip(activeTrip.trip_id);
    if (canonicalTrip?.items.some(item => item.entityId === canonicalSavedEntityId(place.id, 'place'))) return true;
    const title = normalizeExploreText(place.summary.title);
    const lat = Number(place.summary.lat);
    const lng = Number(place.summary.lng);
    return activeTrip.plan.waypoints.some(waypoint => {
      if (normalizeExploreText(waypoint.name) === title) return true;
      return Number.isFinite(lat)
        && Number.isFinite(lng)
        && Number.isFinite(Number(waypoint.lat))
        && Number.isFinite(Number(waypoint.lng))
        && Math.abs(Number(waypoint.lat) - lat) < 0.0001
        && Math.abs(Number(waypoint.lng) - lng) < 0.0001;
    });
  }

  async function canonicalSavedEntity(entity: SavedEntityV1) {
    return getSavedEntity(entity.id) ?? saveEntity(entity);
  }

  async function canonicalActiveTrip() {
    if (!activeTrip) return null;
    return getTrip(activeTrip.trip_id) ?? upsertTrip(tripDocumentFromTripResult(activeTrip));
  }

  async function addSavedEntityToActiveTrip(entity: SavedEntityV1) {
    if (!activeTrip) return false;
    const requestEpoch = accountStorage.epoch();
    const requestAccountId = useStore.getState().user?.id;
    const requestTripId = activeTrip.trip_id;
    const requestIsCurrent = () => accountStorage.epoch() === requestEpoch
      && String(useStore.getState().user?.id ?? '') === String(requestAccountId ?? '')
      && useStore.getState().activeTrip?.trip_id === requestTripId;
    const saved = await canonicalSavedEntity(entity);
    if (!requestIsCurrent()) return false;
    const trip = await canonicalActiveTrip();
    if (!requestIsCurrent()) return false;
    if (!trip) return false;
    if (!trip.items.some(item => item.entityId === saved.id)) {
      const lastDay = activeTrip.plan.waypoints.reduce((day, waypoint) => Math.max(day, Number(waypoint.day) || 1), 1);
      await addEntityToTrip(trip.id, saved.id, { day: lastDay });
      if (!requestIsCurrent()) return false;
    }
    setActiveTrip(addSavedEntityToTripResult(activeTrip, saved));
    return true;
  }

  async function addExplorePlaceToTrip(place: ExplorePlaceProfile) {
    if (!activeTrip || isExploreAddedToTrip(place)) return;
    try {
      await addSavedEntityToActiveTrip(savedEntityFromExplorePlace(place));
    } catch {
      Alert.alert('Place not added', 'This place is still saved in Explore. Try adding it to the trip again.');
    }
  }

  async function startTripWithEntity(entity: SavedEntityV1) {
    const requestEpoch = accountStorage.epoch();
    const requestAccountId = useStore.getState().user?.id;
    try {
      const saved = await canonicalSavedEntity(entity);
      if (
        accountStorage.epoch() !== requestEpoch
        || String(useStore.getState().user?.id ?? '') !== String(requestAccountId ?? '')
      ) return;
      const document = await createTripFromEntity(saved, `Trip to ${saved.title}`);
      if (
        accountStorage.epoch() !== requestEpoch
        || String(useStore.getState().user?.id ?? '') !== String(requestAccountId ?? '')
      ) return;
      setActiveTrip(starterTripResult(document, saved));
      setSelectedExplore(null);
      closeExperienceDetail();
      router.push({
        pathname: '/(tabs)/route-builder',
        params: { intent: 'edit-active', request: String(Date.now()) },
      });
    } catch {
      Alert.alert('Trip not started', 'Your saved items are unchanged. Try starting the trip again.');
    }
  }

  function startTripFromExplore(place: ExplorePlaceProfile) {
    return startTripWithEntity(savedEntityFromExplorePlace(place));
  }

  async function toggleSavedExplore(place: ExplorePlaceProfile) {
    try {
      const existing = getSavedEntity(canonicalSavedEntityId(place.id, 'place'));
      if (existing) await removeEntity(existing.id, { expectedRevision: existing.revision });
      else await saveEntity(savedEntityFromExplorePlace(place));
    } catch {
      Alert.alert('Save not updated', 'Your saved places could not be changed right now.');
    }
  }

  function showExploreCampOnMap(camp: CampsitePin) {
    setPendingMapSelection({ kind: 'camp', camp });
    setSelectedExplore(null);
    router.push('/(tabs)/map');
  }

  function showExploreTrailOnMap(place: ExplorePlaceProfile, trail: ExploreTrailCard) {
    const lat = trail.lat ?? place.summary.lat;
    const lng = trail.lng ?? place.summary.lng;
    if (lat == null || lng == null) {
      if (trail.source_url) Linking.openURL(trail.source_url).catch(() => {});
      return;
    }
    const distance = fmtMi(trail.distance_mi) || 'Check route';
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

  function directionsToExploreTrailhead(place: ExplorePlaceProfile, trail: ExploreTrailCard) {
    const target = trail.trekking_only && trail.route_target ? trail.route_target : null;
    const lat = target?.lat ?? trail.lat ?? place.summary.lat;
    const lng = target?.lng ?? trail.lng ?? place.summary.lng;
    if (lat == null || lng == null) {
      if (trail.source_url) Linking.openURL(trail.source_url).catch(() => {});
      return;
    }
    setPendingNavigatePlace({ lat: Number(lat), lng: Number(lng), name: target?.name || trail.title });
    setSelectedExplore(null);
    router.push('/(tabs)/map');
  }

  function showExperienceOnMap(experience: BookableExperience) {
    if (experience.lat == null || experience.lng == null) {
      const url = experience.booking_url || experience.affiliate_url || experience.source_url;
      if (url) Linking.openURL(url).catch(() => {});
      return;
    }
    setPendingMapSelection({
      kind: 'place',
      place: {
        id: `experience:${experience.id}`,
        name: experience.title,
        lat: Number(experience.lat),
        lng: Number(experience.lng),
        icon: 'star',
        note: experience.summary || experience.description || '',
        createdAt: Date.now(),
      },
    });
    setSelectedExplore(null);
    router.push('/(tabs)/map');
  }

  function openExperienceDetail(experience: BookableExperience) {
    setSelectedExperience(experience);
    setSelectedExperienceLoading(true);
    api.getExploreExperience(experience.id)
      .then(detail => {
        setSelectedExperience(current => {
          if (!current || current.id !== experience.id) return current;
          return { ...current, ...detail };
        });
      })
      .catch(() => {})
      .finally(() => {
        setSelectedExperienceLoading(false);
      });
  }

  function closeExperienceDetail() {
    setSelectedExperience(null);
    setSelectedExperienceLoading(false);
  }

  function showSelectedExperienceOnMap(experience: BookableExperience) {
    closeExperienceDetail();
    showExperienceOnMap(experience);
  }

  async function saveExperienceToPlanner(experience: BookableExperience) {
    const entity = savedEntityFromExperience(experience);
    if (!activeTrip) {
      await startTripWithEntity(entity);
      return;
    }
    try {
      await addSavedEntityToActiveTrip(entity);
    } catch {
      Alert.alert('Trip not updated', 'The guided trip is still available here. Try adding it again.');
    }
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
      setExploreWeatherErrors(prev => ({ ...prev, [place.id]: 'Weather is not loading right now.' }));
    } finally {
      setExploreWeatherLoadingId(current => current === place.id ? null : current);
    }
  }

  async function resolveExploreParentHubForChild(place: ExplorePlaceProfile) {
    if (!isNestedExploreChildCandidate(place)) return null;
    const localHub = findExploreParentHub(place, enrichedExplorePlaces.filter(item => item.id !== place.id && isDestinationExploreHub(item)));
    if (localHub) return localHub;
    const searchTitles = destinationSearchTitlesForExploreChild(place);
    if (!searchTitles.length) return null;
    try {
      for (const title of searchTitles) {
        const catalog = await api.getExploreCatalogIndex({ q: title, category: 'parks', limit: 10 });
        const remoteHubs = (catalog.places ?? [])
          .map(exploreIndexItemToProfile)
          .filter(item => isDestinationExploreHub(item));
        const remoteHub = findExploreParentHub(place, remoteHubs) ?? remoteHubs.find(item => normalizeExploreText(item.summary.title).includes(normalizeExploreText(title)));
        if (!remoteHub) continue;
        setExplorePlaces(prev => prev.some(item => item.id === remoteHub.id) ? prev : [remoteHub, ...prev]);
        return remoteHub;
      }
      return null;
    } catch {
      return null;
    }
  }

  function showExploreSheet(place: ExplorePlaceProfile, initialTab: ExploreDetailTab) {
    setProfileReadMode(initialTab);
    const local = exploreTrailAreasById[place.id] ?? place;
    setSelectedExplore(local);
    if (!exploreWeatherById[local.id] && exploreWeatherLoadingId !== local.id) {
      fetchExploreWeather(local).catch(() => {});
    }
    return local;
  }

  async function openExplorePlace(place: ExplorePlaceProfile, initialTab: ExploreDetailTab = 'summary') {
    if (place.id.startsWith('guided:')) {
      const destination = [...guidedDestinations, ...GUIDED_DESTINATIONS]
        .find(item => item.id === place.id);
      if (destination) {
        setSelectedExplore(null);
        selectGuidedDestination(destination);
        return;
      }
    }
    const parentTab = initialTab === 'summary' ? exploreTabForNestedPlace(place) : initialTab;
    const resolvesBeforeOpen = shouldResolveExploreWrapperBeforeOpen(place);
    const parentHubId = exploreHubMeta.parentByChildId.get(place.id);
    if (resolvesBeforeOpen && parentHubId && parentHubId !== place.id) {
      const parentHub = enrichedExplorePlaces.find(item => item.id === parentHubId)
        ?? explorePlaces.find(item => item.id === parentHubId);
      if (parentHub) {
        await openExplorePlace(parentHub, parentTab);
        return;
      }
    }
    if (resolvesBeforeOpen) {
      const resolvedParentHub = await resolveExploreParentHubForChild(place);
      if (resolvedParentHub && resolvedParentHub.id !== place.id) {
        await openExplorePlace(resolvedParentHub, parentTab);
        return;
      }
    }
    const local = showExploreSheet(place, initialTab);
    if (!shouldUseExploreDetailEndpoint(place)) {
      if (shouldHydrateExploreTrailArea(local)) hydrateExploreTrailArea(local).catch(() => {});
      return;
    }
    try {
      const detail = await api.getExplorePlace(place.id);
      setExplorePlaces(prev => prev.map(item => item.id === detail.id ? detail : item));
      const hydrated = exploreTrailAreasById[detail.id] ?? detail;
      setSelectedExplore(current => {
        if (current?.id !== place.id) return current;
        if (exploreTrailAreasById[detail.id]) return exploreTrailAreasById[detail.id];
        if (hasExploreTrailCards(current) && !hasExploreTrailCards(detail)) {
          return mergeDynamicTrailArea(detail, current);
        }
        return hydrated;
      });
      setProfileReadMode(initialTab);
      if (!exploreWeatherById[hydrated.id] && exploreWeatherLoadingId !== hydrated.id) {
        fetchExploreWeather(hydrated).catch(() => {});
      }
      if (shouldHydrateExploreTrailArea(hydrated)) hydrateExploreTrailArea(hydrated).catch(() => {});
    } catch {
      if (shouldHydrateExploreTrailArea(local)) hydrateExploreTrailArea(local).catch(() => {});
    }
  }

  function exploreTabForResultCardOpen(place: ExplorePlaceProfile): ExploreDetailTab {
    return shouldResolveExploreWrapperBeforeOpen(place)
      ? exploreTabForBrowseIntent(exploreQuery, exploreCategory)
      : 'summary';
  }

  function handleExploreNearbyAction(place: ExplorePlaceProfile, module: ExploreNearbyModule) {
    if (module.action === 'weather') {
      fetchExploreWeather(place);
      return;
    }
    if (module.action === 'trails') {
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

  function getExploreDetailWeather(place: ExplorePlaceProfile): ExploreDetailWeather | null {
    const weather = exploreWeatherById[place.id];
    const error = exploreWeatherErrors[place.id];
    const loading = exploreWeatherLoadingId === place.id;
    if (loading) {
      return { loading: true, icon: 'partly-sunny-outline', temp: '--', detail: 'Loading forecast' };
    }
    if (error) {
      return { unavailable: true, icon: 'cloud-offline-outline', temp: '--', detail: 'Forecast unavailable' };
    }
    if (!weather) {
      return place.summary.lat != null && place.summary.lng != null
        ? { icon: 'partly-sunny-outline', temp: '--', detail: 'Forecast' }
        : null;
    }
    if (weather.available === false) {
      return { unavailable: true, icon: 'cloud-offline-outline', temp: '--', detail: 'Forecast unavailable' };
    }
    const daily = weather.daily;
    const code = Number(weather?.current?.weather_code ?? daily?.weathercode?.[0] ?? 3);
    const units = weather?.trailhead_units;
    const tempLabel = units?.temperature_label ?? '°';
    const windLabel = units?.wind_label ?? 'mph';
    const hi = daily?.temperature_2m_max?.[0];
    const lo = daily?.temperature_2m_min?.[0];
    const wind = daily?.windspeed_10m_max?.[0];
    const hiLabel = Number.isFinite(hi) ? `${Math.round(Number(hi))}${tempLabel}` : '--';
    const loLabel = Number.isFinite(lo) ? `${Math.round(Number(lo))}${tempLabel}` : '--';
    const windText = Number.isFinite(wind) ? `${Math.round(Number(wind))} ${windLabel}` : 'Wind --';
    return {
      icon: wmoIcon(code),
      temp: `${hiLabel}/${loLabel}`,
      detail: windText,
    };
  }

  function renderExploreWeather(place: ExplorePlaceProfile) {
    const weather = exploreWeatherById[place.id];
    const error = exploreWeatherErrors[place.id];
    const loading = exploreWeatherLoadingId === place.id;
    if (!weather && !error && !loading) return null;
    const unavailable = weather?.available === false;
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
            <Text style={s.profileLabel}>Weather at this stop</Text>
            <Text style={s.exploreWeatherSub}>{place.summary.title}</Text>
          </View>
          {loading ? <ActivityIndicator color={C.orange} size="small" /> : <Ionicons name={wmoIcon(code)} size={26} color={C.orange} />}
        </View>
        {loading ? (
          <Text style={s.exploreWeatherText}>Loading forecast...</Text>
        ) : error || unavailable ? (
          <Text style={s.exploreWeatherText}>{error || 'Weather is not loading right now.'}</Text>
        ) : (
          <View style={s.exploreWeatherStats}>
            <View style={s.exploreWeatherStat}>
              <Text style={s.exploreWeatherValue}>
                {Number.isFinite(hi) ? Math.round(Number(hi)) : '--'}{tempLabel}/{Number.isFinite(lo) ? Math.round(Number(lo)) : '--'}{tempLabel}
              </Text>
              <Text style={s.exploreWeatherLabel}>Hi/Lo</Text>
            </View>
            <View style={s.exploreWeatherStat}>
              <Text style={s.exploreWeatherValue}>{Number.isFinite(wind) ? Math.round(Number(wind)) : '--'} {windLabel}</Text>
              <Text style={s.exploreWeatherLabel}>Wind</Text>
            </View>
            <View style={s.exploreWeatherStat}>
              <Text style={s.exploreWeatherValue}>{Number.isFinite(precip) ? Math.round(Number(precip)) : '--'}%</Text>
              <Text style={s.exploreWeatherLabel}>Precip</Text>
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
            <Text style={s.profileLabel}>Trails</Text>
            <Text style={s.exploreWeatherSub}>{place.summary.title}</Text>
          </View>
          {loading ? <ActivityIndicator color={C.orange} size="small" /> : <Ionicons name="trail-sign-outline" size={24} color={C.orange} />}
        </View>
        <Text style={s.exploreWeatherText}>
          {loading ? 'Loading trails...' : error}
        </Text>
        {loading ? <TrailheadCardSkeleton lines={2} style={s.exploreTrailSkeleton} /> : null}
      </TrailheadCard>
    );
  }

  function renderExploreCard(
    item: { place: ExplorePlaceProfile; distance?: number | null; day?: number },
    idx: number,
    compact = false,
  ) {
    const { place, distance, day } = item;
    const addedToTrip = isExploreAddedToTrip(place);
    const canOpenMap = place.summary.lat != null && place.summary.lng != null;
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
        primaryLabel={activeTrip ? (addedToTrip ? 'Added to trip' : 'Add to trip') : 'Start trip'}
        primaryIcon={activeTrip ? (addedToTrip ? 'checkmark-circle' : 'add-circle-outline') : 'add-circle-outline'}
        primaryDisabled={activeTrip ? addedToTrip : !canOpenMap}
        rankReason={exploreRankReason(place, {
          mode: exploreMode,
          query: exploreQuery,
          distance,
          day,
          sort: exploreSortMode,
          nearbyName: exploreNearbySearchCenter?.source === 'destination' ? exploreNearbySearchCenter.name : undefined,
        })}
        onOpen={() => openExplorePlace(place, exploreTabForResultCardOpen(place))}
        onPrimary={() => activeTrip ? addExplorePlaceToTrip(place) : startTripFromExplore(place)}
        onToggleSave={() => toggleSavedExplore(place)}
      />
    );
  }

  function renderExploreCampgrounds(place: ExplorePlaceProfile) {
    if (!shouldLoadExploreCamps(place)) return null;
    const camps = exploreCampgroundsById[place.id] ?? [];
    const currentCamp = explorePlaceAsCampPin(place);
    const displayCamps = (currentCamp ? mergeCampPins([currentCamp], camps) : camps)
      .filter(camp => !isLowQualityExploreCampName(camp));
    const fetchedCount = camps.length;
    const sourceMode = exploreCampSourceById[place.id] || 'official';
    const loading = exploreCampLoadingId === place.id && displayCamps.length === 0;
    const error = exploreCampErrors[place.id];
    return (
      <TrailheadCard style={s.campgroundSection}>
        <View style={s.campgroundSectionTop}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.profileLabel}>{exploreCampRailTitle(place)}</Text>
            <Text style={s.campgroundSectionSub}>
              {displayCamps.length
                ? fetchedCount === 0 && currentCamp
                  ? 'Current place'
                  : sourceMode === 'fallback'
                    ? exploreCountLabel(displayCamps.length, 'nearby option', 'nearby options')
                    : exploreCountLabel(displayCamps.length, 'nearby campground', 'nearby campgrounds')
                : 'Photos, fees, reservations, and access can change by season.'}
            </Text>
          </View>
          <TouchableOpacity style={s.campgroundAreaBtn} onPress={() => showExploreOnMap(place)}>
            <Ionicons name="map-outline" size={14} color={C.orange} />
            <Text style={s.campgroundAreaBtnText}>Area</Text>
          </TouchableOpacity>
        </View>
        {loading ? (
          <View style={s.campgroundListSkeleton}>
            <ExploreCampgroundSkeletonCard C={C} styles={s} />
            <ExploreCampgroundSkeletonCard C={C} styles={s} />
          </View>
        ) : displayCamps.length ? (
          <View style={s.campgroundList}>
            {displayCamps.slice(0, 12).map(camp => {
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
                      <Text style={s.campgroundBadgeText}>{campBadgeLabel(camp)}</Text>
                    </View>
                    {areaFallback && (
                      <View style={s.campgroundPhotoNote}>
                        <Text style={s.campgroundPhotoNoteText}>Area photo</Text>
                      </View>
                    )}
                  </View>
                  <View style={s.campgroundBody}>
                    <Text style={s.campgroundName} numberOfLines={2}>{camp.name}</Text>
                    <Text style={s.campgroundMeta} numberOfLines={2}>{campMetaLine(camp)}</Text>
                    {!!campCostLabel(camp.cost) && <Text style={s.campgroundCost} numberOfLines={1}>{campCostLabel(camp.cost)}</Text>}
                    <View style={s.campgroundActions}>
                      <TouchableOpacity style={s.campgroundOpenBtn} onPress={() => showExploreCampOnMap(camp)}>
                        <Ionicons name="bonfire-outline" size={13} color="#fff" />
                        <Text style={s.campgroundOpenText}>View</Text>
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
          </View>
        ) : (
          <View style={s.campgroundEmpty}>
            <Ionicons name="compass-outline" size={22} color={C.text3} />
            <Text style={s.campgroundEmptyText}>{error || 'Search a wider area.'}</Text>
            <TouchableOpacity style={s.campgroundAreaBtn} onPress={() => showExploreOnMap(place)}>
              <Ionicons name="compass-outline" size={14} color={C.orange} />
              <Text style={s.campgroundAreaBtnText}>Wider area</Text>
            </TouchableOpacity>
          </View>
        )}
      </TrailheadCard>
    );
  }

  function renderExploreExperiences(place: ExplorePlaceProfile) {
    const experiences = exploreExperiencesById[place.id] ?? [];
    const loading = exploreExperienceLoadingId === place.id && experiences.length === 0;
    const error = exploreExperienceErrors[place.id];
    if (!loading && !error && experiences.length === 0) return null;
    return (
      <ExploreExperiencesRail
        experiences={experiences}
        loading={loading}
        error={error}
        emptySubtitle={`Near ${place.summary.title}`}
        mediaUrl={mediaUrl}
        onOpen={openExperienceDetail}
        onSave={saveExperienceToPlanner}
        saveActionLabel={activeTrip ? 'Add to trip' : 'Start trip'}
        onShowArea={showExperienceOnMap}
        initialVisible={12}
        showMoreStep={12}
      />
    );
  }

  function submitGuidedTourSearch() {
    const query = guidedTourDraft.trim();
    const normalizedQuery = normalizeExploreText(query);
    const destination = guidedDestinations.find(item => (
      [item.name, item.searchQuery, ...item.terms]
        .filter(Boolean)
        .some(term => normalizedQuery === normalizeExploreText(String(term)))
    ));
    setGuidedTourSelectedDestinationKey(destination?.id ?? null);
    setGuidedTourSelectedCenter(destination ? { lat: destination.lat, lng: destination.lng, name: destination.name } : null);
    setExploreMode(exploreMode === 'nearby' ? 'featured' : exploreMode);
    setExploreCategory('guided');
    setGuidedTourSearchQuery(query);
    if (query) setExploreQuery(query);
    setGuidedFallbackExplorePlaces([]);
    setExploreSearchExperiences([]);
    setExploreSearchExperienceError('');
    setGuidedTourSearchRunId(value => value + 1);
  }

  function selectGuidedDestination(destination: GuidedDestination) {
    const query = destination.searchQuery || destination.name;
    setExploreMode('featured');
    setExploreSavedOnly(false);
    setExploreCategory('guided');
    setGuidedTourDraft(query);
    setGuidedTourSearchQuery(query);
    setExploreQuery(query);
    setGuidedTourSelectedCenter({ lat: destination.lat, lng: destination.lng, name: destination.name });
    setGuidedTourSelectedDestinationKey(destination.id);
    setGuidedFallbackExplorePlaces([]);
    setExploreSearchExperiences([]);
    setExploreSearchExperienceError('');
    setGuidedTourSearchRunId(value => value + 1);
  }

  function handleExploreModeChange(mode: 'featured' | 'nearby' | 'trip') {
    setExploreSavedOnly(false);
    setExploreMode(mode);
    if (mode !== 'nearby' && (exploreCategory === 'fuel' || exploreCategory === 'resupply')) {
      setExploreCategory('all');
    }
    if (mode !== 'featured' && (exploreCategory === 'guided' || exploreCategory === 'tours')) {
      setExploreCategory('all');
      setExploreQuery('');
      setGuidedTourSelectedCenter(null);
      setGuidedTourSelectedDestinationKey(null);
      setGuidedTourSearchRunId(0);
    }
  }

  async function loadNextExploreCatalogPage() {
    const spec = activeExploreCatalogPageSpec;
    if (!spec) return false;
    const pageState = exploreCatalogPagesRef.current[spec.key];
    const cursor = pageState?.nextCursor;
    if (cursor == null || pageState.loading) return false;
    updateExploreCatalogPage(spec.key, current => ({ ...current, loading: true }));
    try {
      const catalog = await withExploreTimeout(api.getExploreCatalogIndex({
        q: spec.q || undefined,
        category: spec.category || undefined,
        mode: 'featured',
        sort: spec.sort,
        lat: spec.lat,
        lng: spec.lng,
        limit: 180,
        cursor,
      }), 12000);
      const matchedQuery = normalizeExploreText(exploreQuery);
      const remotePlaces = (catalog.places ?? []).map((item, index) => ({
        ...exploreIndexItemToProfile(item),
        ...(matchedQuery ? {
          matched_explore_query: matchedQuery,
          matched_explore_rank: cursor + index,
        } : {}),
      } as ExplorePlaceProfile));
      if (remotePlaces.length) {
        const cachedPlaces = mergeMatchedExplorePlaces(explorePlacesRef.current, remotePlaces);
        setExplorePlaces(current => mergeMatchedExplorePlaces(current, remotePlaces));
        if (!spec.q && !spec.category && spec.sort === 'best') {
          storage.set(EXPLORE_CACHE_KEY, JSON.stringify({
            places: cachedPlaces,
            next_cursor: catalog.next_cursor ?? null,
            total_count: Number(catalog.total_count || catalog.count || cachedPlaces.length),
            fetched_at: Date.now(),
          })).catch(() => {});
        }
      }
      setExploreFacetCounts(current => ({
        ...current,
        ...exploreFacetCountsFromCatalog(catalog, remotePlaces),
      }));
      const nextCursor = catalog.next_cursor === cursor ? null : catalog.next_cursor ?? null;
      updateExploreCatalogPage(spec.key, {
        nextCursor,
        totalCount: Number(catalog.total_count || catalog.count || pageState.totalCount || remotePlaces.length),
        loading: false,
      });
      return remotePlaces.length > 0;
    } catch {
      updateExploreCatalogPage(spec.key, current => ({ ...current, loading: false }));
      return false;
    }
  }

  function showMoreExplorePlaces() {
    const localRemaining = Math.max(0, rankedExplore.length - exploreVisibleLimit);
    setExploreVisibleLimit(limit => limit + EXPLORE_VISIBLE_STEP);
    if (localRemaining <= EXPLORE_VISIBLE_STEP && activeExploreCatalogPage?.nextCursor != null) {
      loadNextExploreCatalogPage().catch(() => {});
    }
  }

  function cycleExploreSort() {
    setExploreSortMode(current => {
      if (current === 'best') return 'source';
      if (current === 'source') {
        if (!userLoc) setExploreMode('nearby');
        return 'nearest';
      }
      return 'best';
    });
  }

  function changeGuidedTourDraft(value: string) {
    setGuidedTourDraft(value);
    setGuidedTourSelectedCenter(null);
    setGuidedTourSelectedDestinationKey(null);
    if (guidedTourSelectedDestinationKey) {
      setGuidedTourSearchQuery('');
      setExploreQuery('');
      setGuidedTourSearchRunId(0);
      setExploreSearchExperiences([]);
      setGuidedFallbackExplorePlaces([]);
    }
  }

  function openGuidedFilters() {
    setGuidedTourCategoryDraft(guidedTourCategory);
    setGuidedTourSortDraft(guidedTourSort);
    setGuidedTourFreeCancelDraft(guidedTourFreeCancel);
    setGuidedTourEnglishOnlyDraft(guidedTourEnglishOnly);
    setGuidedFilterSheetOpen(true);
  }

  function closeGuidedFilters() {
    setGuidedFilterSheetOpen(false);
  }

  function applyGuidedFilters() {
    setGuidedTourCategory(guidedTourCategoryDraft);
    setGuidedTourSort(guidedTourSortDraft);
    setGuidedTourFreeCancel(guidedTourFreeCancelDraft);
    setGuidedTourEnglishOnly(guidedTourEnglishOnlyDraft);
    setGuidedFilterSheetOpen(false);
  }

  function renderGuidedTourControls() {
    const dateLabel = guidedTourDateLabel(guidedTourDate, guidedTourCustomDate);
    const filterLabel = guidedTourFilterSummary(guidedTourCategory, guidedTourSort, guidedTourFreeCancel, guidedTourEnglishOnly);
    const canSearch = guidedTourDraft.trim().length >= 2 || !!userLoc;
    const renderSelector = (
      label: string,
      value: string,
      icon: keyof typeof Ionicons.glyphMap,
      onPress: () => void,
    ) => (
      <TouchableOpacity
        style={s.guidedSelector}
        activeOpacity={0.82}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <View style={s.guidedSelectorIcon}>
          <Ionicons name={icon} size={18} color={C.orange} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.guidedFieldLabel}>{label}</Text>
          <Text style={s.guidedSelectorValue} numberOfLines={2}>{value}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={C.text3} />
      </TouchableOpacity>
    );
    return (
      <View style={s.guidedSearchPanel}>
        <View style={s.guidedPanelTop}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.guidedPanelTitle}>Find guided trips</Text>
          </View>
          {guidedExperienceSearchLoading ? <ActivityIndicator color={C.orange} size="small" /> : null}
        </View>

        <View style={s.guidedField}>
          <Ionicons name="search-outline" size={20} color={C.text3} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.guidedFieldLabel}>Where</Text>
            <TextInput
              value={guidedTourDraft}
              onChangeText={changeGuidedTourDraft}
              onSubmitEditing={submitGuidedTourSearch}
              returnKeyType="search"
              placeholder="Moab, Yosemite, Big Sur"
              placeholderTextColor={C.text3}
              style={s.guidedInput}
              autoCorrect={false}
              clearButtonMode="while-editing"
            />
          </View>
        </View>

        {renderSelector('Date', dateLabel, 'calendar-outline', () => setGuidedDateSheetOpen(true))}
        {renderSelector('Filters', filterLabel, 'options-outline', openGuidedFilters)}

        <TouchableOpacity
          style={[s.guidedSearchButton, { opacity: canSearch ? 1 : 0.55 }]}
          activeOpacity={0.86}
          disabled={!canSearch}
          onPress={submitGuidedTourSearch}
        >
          <Ionicons name="search-outline" size={17} color="#fff" />
          <Text style={s.guidedSearchButtonText}>Search</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function setGuidedPresetDate(date: GuidedTourDate) {
    setGuidedTourDate(date);
    if (date !== 'custom') setGuidedTourCustomDate('');
    setGuidedDateSheetOpen(false);
  }

  function setGuidedCalendarDate(date: Date) {
    setGuidedTourDate('custom');
    setGuidedTourCustomDate(formatTourDate(date));
    setGuidedDateSheetOpen(false);
  }

  function renderGuidedDateSheet() {
    const today = new Date();
    const monthStart = new Date(guidedCalendarMonth.getFullYear(), guidedCalendarMonth.getMonth(), 1);
    const daysInMonth = new Date(guidedCalendarMonth.getFullYear(), guidedCalendarMonth.getMonth() + 1, 0).getDate();
    const blanks = monthStart.getDay();
    const selectedDate = guidedTourDate === 'custom' ? parseTourDate(guidedTourCustomDate) : null;
    const cells: Array<Date | null> = [
      ...Array.from({ length: blanks }, () => null),
      ...Array.from({ length: daysInMonth }, (_, index) => new Date(guidedCalendarMonth.getFullYear(), guidedCalendarMonth.getMonth(), index + 1)),
    ];
    while (cells.length % 7 !== 0) cells.push(null);
    const monthLabel = guidedCalendarMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const renderPreset = (item: typeof GUIDED_DATE_OPTIONS[number]) => {
      const active = guidedTourDate === item.key;
      return (
        <TouchableOpacity key={item.key} style={s.sheetRow} onPress={() => setGuidedPresetDate(item.key)} activeOpacity={0.82}>
          <Ionicons name={item.icon} size={19} color={active ? C.orange : C.text2} />
          <Text style={s.sheetRowText}>{item.key === 'weekend' ? 'This weekend' : item.label === 'Any' ? 'Any date' : item.label}</Text>
          {active ? <Ionicons name="checkmark" size={19} color={C.orange} /> : null}
        </TouchableOpacity>
      );
    };
    return (
      <Modal visible={guidedDateSheetOpen} animationType="slide" transparent onRequestClose={() => setGuidedDateSheetOpen(false)}>
        <View style={s.sheetBackdrop}>
          <View style={[s.sheet, { paddingBottom: Math.max(16, insets.bottom + 12) }]}>
            <View style={s.sheetHeader}>
              <Text style={s.sheetTitle}>Choose date</Text>
              <TouchableOpacity style={s.sheetClose} onPress={() => setGuidedDateSheetOpen(false)} accessibilityLabel="Close date picker">
                <Ionicons name="close" size={18} color={C.text} />
              </TouchableOpacity>
            </View>
            <View style={s.sheetRows}>
              {GUIDED_DATE_OPTIONS.map(renderPreset)}
            </View>
            <View style={s.calendarHeader}>
              <TouchableOpacity style={s.calendarNav} onPress={() => setGuidedCalendarMonth(month => new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
                <Ionicons name="chevron-back" size={18} color={C.text2} />
              </TouchableOpacity>
              <Text style={s.calendarMonth}>{monthLabel}</Text>
              <TouchableOpacity style={s.calendarNav} onPress={() => setGuidedCalendarMonth(month => new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
                <Ionicons name="chevron-forward" size={18} color={C.text2} />
              </TouchableOpacity>
            </View>
            <View style={s.weekdayRow}>
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
                <Text key={`${day}:${index}`} style={s.weekdayText}>{day}</Text>
              ))}
            </View>
            <View style={s.calendarGrid}>
              {cells.map((date, index) => {
                const dateKey = date ? formatTourDate(date) : `blank:${index}`;
                const disabled = !!date && formatTourDate(date) < formatTourDate(today);
                const selected = !!date && !!selectedDate && formatTourDate(date) === formatTourDate(selectedDate);
                return (
                  <TouchableOpacity
                    key={dateKey}
                    style={[s.calendarCell, selected && s.calendarCellSelected, disabled && s.calendarCellDisabled]}
                    disabled={!date || disabled}
                    onPress={() => date && setGuidedCalendarDate(date)}
                    activeOpacity={0.82}
                  >
                    <Text style={[s.calendarCellText, selected && s.calendarCellTextSelected, disabled && s.calendarCellTextDisabled]}>
                      {date ? date.getDate() : ''}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  function renderGuidedFilterSheet() {
    const renderRadio = (
      label: string,
      icon: keyof typeof Ionicons.glyphMap,
      active: boolean,
      onPress: () => void,
    ) => (
      <TouchableOpacity key={label} style={s.sheetRow} onPress={onPress} activeOpacity={0.82}>
        <Ionicons name={icon} size={19} color={active ? C.orange : C.text2} />
        <Text style={s.sheetRowText}>{label}</Text>
        {active ? <Ionicons name="checkmark" size={19} color={C.orange} /> : null}
      </TouchableOpacity>
    );
    const renderToggle = (
      label: string,
      icon: keyof typeof Ionicons.glyphMap,
      active: boolean,
      onPress: () => void,
    ) => (
      <TouchableOpacity key={label} style={s.sheetRow} onPress={onPress} activeOpacity={0.82}>
        <Ionicons name={icon} size={19} color={active ? C.orange : C.text2} />
        <Text style={s.sheetRowText}>{label}</Text>
        <View style={[s.sheetCheckBox, active && s.sheetCheckBoxActive]}>
          {active ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
        </View>
      </TouchableOpacity>
    );
    return (
      <Modal visible={guidedFilterSheetOpen} animationType="slide" transparent onRequestClose={closeGuidedFilters}>
        <View style={s.sheetBackdrop}>
          <View style={[s.sheet, { paddingBottom: Math.max(16, insets.bottom + 12) }]}>
            <View style={s.sheetHeader}>
              <Text style={s.sheetTitle}>Filters</Text>
              <TouchableOpacity style={s.sheetClose} onPress={closeGuidedFilters} accessibilityLabel="Close filters">
                <Ionicons name="close" size={18} color={C.text} />
              </TouchableOpacity>
            </View>
            <Text style={s.sheetSectionTitle}>Trip style</Text>
            <View style={s.sheetRows}>
              {GUIDED_CATEGORY_OPTIONS.map(item => renderRadio(
                item.label,
                item.icon,
                guidedTourCategoryDraft === item.key,
                () => setGuidedTourCategoryDraft(item.key),
              ))}
            </View>
            <Text style={s.sheetSectionTitle}>Sort</Text>
            <View style={s.sheetRows}>
              {GUIDED_SORT_OPTIONS.map(item => renderRadio(
                item.label,
                item.icon,
                guidedTourSortDraft === item.key,
                () => setGuidedTourSortDraft(item.key),
              ))}
            </View>
            <Text style={s.sheetSectionTitle}>Details</Text>
            <View style={s.sheetRows}>
              {renderToggle('Free cancellation', 'shield-checkmark-outline', guidedTourFreeCancelDraft, () => setGuidedTourFreeCancelDraft(value => !value))}
              {renderToggle('English', 'language-outline', guidedTourEnglishOnlyDraft, () => setGuidedTourEnglishOnlyDraft(value => !value))}
            </View>
            <TouchableOpacity style={s.sheetApplyButton} onPress={applyGuidedFilters} activeOpacity={0.86}>
              <Text style={s.sheetApplyText}>Apply filters</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  function selectExploreHomeCategory(key: ExploreCategoryKey) {
    setExploreSavedOnly(false);
    if (key === 'nearby') {
      setExploreCategory('all');
      setExploreMode('nearby');
      return;
    }
    if (key === 'fuel' || key === 'resupply') {
      setExploreCategory(exploreCategory === key ? 'all' : key);
      setExploreMode('nearby');
      return;
    }
    if ((key === 'guided' || key === 'tours') && exploreCategory !== key && !guidedDestinationContextActive) {
      setGuidedTourDraft('');
      setGuidedTourSearchQuery('');
      setGuidedTourSelectedCenter(null);
      setGuidedTourSelectedDestinationKey(null);
      setGuidedTourSearchRunId(0);
    }
    if (key === 'all') {
      setExploreMode(exploreMode === 'nearby' ? 'featured' : exploreMode);
      setExploreCategory('all');
      return;
    }
    setExploreMode(exploreMode === 'nearby' ? 'featured' : exploreMode);
    setExploreCategory(exploreCategory === key ? 'all' : key);
  }

  function handleExploreQueryChange(value: string) {
    setExploreQuery(value);
    const keepsGuidedDestination = !!guidedTourSelectedDestinationKey
      && !!guidedTourSelectedCenter
      && normalizeExploreText(value) === normalizeExploreText(guidedTourSearchQuery);
    if (!keepsGuidedDestination) {
      setGuidedTourDraft('');
      setGuidedTourSearchQuery('');
      setGuidedTourSelectedCenter(null);
      setGuidedTourSelectedDestinationKey(null);
      setGuidedTourSearchRunId(0);
    }
    const nextCategory = exploreCategoryFetchParamFromQuery(value, 'all');
    if (nextCategory && exploreCategory !== 'all' && exploreCategory !== nextCategory) {
      setExploreMode(exploreMode === 'nearby' ? 'featured' : exploreMode);
      setExploreCategory(nextCategory);
    }
  }

  function renderLandingHeader() {
    return (
      <View style={s.landingHeader}>
        <ExploreHero
          greeting={timeGreeting()}
          displayName={displayName}
          height={heroHeight + insets.top}
          topInset={insets.top}
          query={exploreQuery}
          selectedCategory={exploreCategory}
          mode={exploreMode}
          weather={heroWeather}
          hideSearch={guidedCategoryActive}
	          hideCategories
	          showWeather={exploreMode === 'nearby' && !!exploreNearbySearchCenter}
	          onQueryChange={handleExploreQueryChange}
          onClearQuery={() => handleExploreQueryChange('')}
          onCategorySelect={selectExploreHomeCategory}
        />
      </View>
    );
  }

  function openExploreFeed() {
    setTab('explore');
    router.replace('/(tabs)/guide' as any);
  }

  function renderUtilityHeader() {
    const isWeather = tab === 'weather';
    return (
      <View style={[s.utilityHeader, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity style={s.utilityBack} onPress={openExploreFeed}>
          <Ionicons name="chevron-back" size={16} color={C.text2} />
          <Text style={s.utilityBackText}>Explore</Text>
        </TouchableOpacity>
        <View style={s.utilityTitleRow}>
          <View style={s.utilityIcon}>
            <Ionicons name={isWeather ? 'partly-sunny-outline' : 'mic-outline'} size={22} color={C.orange} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.utilityKicker}>{isWeather ? 'Trip Weather' : 'Trip Audio'}</Text>
            <Text style={s.utilityTitle}>{isWeather ? 'Forecasts for route stops' : 'Narrations for route stops'}</Text>
          </View>
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
    <SafeAreaView style={s.container} edges={['left', 'right', 'bottom']}>
      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
        {tab === 'explore' ? renderLandingHeader() : renderUtilityHeader()}

        {tab === 'explore' && (
          <View style={s.exploreFeedSheet}>
            <ExploreHomeControls
              category={exploreCategory}
              mode={exploreMode}
              savedOnly={exploreSavedOnly}
              hasQuery={hasExploreQuery}
              shownCount={rankedExplore.length}
              countLabel={exploreHomeCountLabel}
              categoryCounts={availableExploreCategoryCounts}
              sortMode={exploreSortMode}
              guidedMode={guidedCategoryActive}
              onModeChange={handleExploreModeChange}
              onCategorySelect={selectExploreHomeCategory}
              onOpenFilters={() => setExploreFilterSheetOpen(true)}
              onClearCategory={() => {
                setExploreCategory('all');
                setGuidedTourSearchQuery('');
                setGuidedTourSelectedCenter(null);
                setGuidedTourSelectedDestinationKey(null);
                setGuidedTourSearchRunId(0);
              }}
              onClearSaved={() => setExploreSavedOnly(false)}
              onShowMore={!guidedCategoryActive && (visibleRankedExplore.length < rankedExplore.length || canLoadMoreExploreCatalog)
                ? showMoreExplorePlaces
                : undefined}
              onSortCycle={cycleExploreSort}
            />
            {!!exploreCatalogNotice && (
              <View style={s.catalogNotice}>
                <Ionicons name="cloud-offline-outline" size={16} color={C.text3} />
                <Text style={s.catalogNoticeText}>{exploreCatalogNotice}</Text>
                <TouchableOpacity onPress={() => setExploreCatalogReloadId(value => value + 1)} hitSlop={8} accessibilityLabel="Retry Explore catalog">
                  <Ionicons name="refresh" size={17} color={C.orange} />
                </TouchableOpacity>
              </View>
            )}
            {(showExperienceSearch || tourSearchPaused) && (
              <>
                {renderGuidedTourControls()}
                {showGuidedDestinations ? <GuidedDestinationBrowser destinations={guidedDestinations} onSelect={selectGuidedDestination} /> : null}
                <ExploreExperiencesRail
                  experiences={guidedVisibleExperiences}
                  loading={tourSearchPaused ? false : guidedExperienceSearchLoading}
                  error={tourSearchPaused ? 'Guided trips are not available right now.' : guidedExperienceRailError}
                  title="Available trips"
                  attribution={exploreSearchExperienceAttribution || 'Viator'}
                  variant="list"
                  emptySubtitle={
                    tourSearchPaused
                      ? 'Free things to do still show below'
                      : (
                    experienceDestinationLabel
                      ? guidedExperienceSearchLoading
                        ? `Checking options near ${experienceDestinationLabel}`
                        : `Near ${experienceDestinationLabel}`
                      : 'Search a destination to compare options'
                      )
                  }
                  mediaUrl={mediaUrl}
                  onOpen={openExperienceDetail}
                  onSave={saveExperienceToPlanner}
                  saveActionLabel={activeTrip ? 'Add to trip' : 'Start trip'}
                  onShowArea={showExperienceOnMap}
                  initialVisible={12}
                  showMoreStep={12}
                  onRetry={() => setGuidedTourSearchRunId(value => value + 1)}
                />
              </>
            )}

            {exploreMode === 'nearby' && (
              <View style={s.livePlacesBlock}>
                <View style={s.livePlacesTop}>
                  <Text style={s.livePlacesTitle} numberOfLines={1}>
                    {exploreNearbySearchCenter?.source === 'destination' && exploreNearbySearchCenter.name
                      ? `Near ${exploreNearbySearchCenter.name}`
                      : exploreServiceDestinationQuery
                        ? `Near ${exploreServiceDestinationQuery}`
                      : 'Places near you'}
                  </Text>
                  {(liveExploreLoading || exploreServiceDestinationResolving) && <ActivityIndicator color={C.orange} size="small" />}
                </View>
                {exploreNearbyNeedsLocation ? (
                  <View style={s.nearbyPermissionState}>
                    {exploreLocationState === 'requesting' ? <ActivityIndicator color={C.orange} size="small" /> : <Ionicons name="location-outline" size={22} color={C.text3} />}
                    <Text style={s.livePlacesEmpty}>
                      {exploreLocationState === 'requesting'
                        ? 'Getting your location...'
                        : exploreLocationState === 'blocked'
                          ? `Location is blocked. Allow it in ${Platform.OS === 'web' ? 'your browser' : 'Settings'} to rank nearby places.`
                          : exploreLocationState === 'denied'
                          ? 'Location access is off. Enable it to rank nearby places.'
                          : 'Use your location to rank nearby services and trail stops.'}
                    </Text>
                    {exploreLocationState !== 'requesting' ? (
                      <TouchableOpacity
                        style={s.stateAction}
                        onPress={exploreLocationState === 'blocked' ? openExploreLocationSettings : () => setExploreLocationRequestId(value => value + 1)}
                        activeOpacity={0.84}
                      >
                        <Ionicons name={exploreLocationState === 'blocked' ? 'settings-outline' : 'locate-outline'} size={15} color="#fff" />
                        <Text style={s.stateActionText}>
                          {exploreLocationState === 'blocked' ? (Platform.OS === 'web' ? 'How to enable' : 'Open settings') : 'Use my location'}
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ) : exploreServiceDestinationFailed ? (
                  <View style={s.nearbyPermissionState}>
                    <Text style={s.livePlacesEmpty}>That destination could not be found.</Text>
                    <TouchableOpacity style={s.stateAction} onPress={() => setExploreLocationRequestId(value => value + 1)} activeOpacity={0.84}>
                      <Ionicons name="refresh" size={15} color="#fff" />
                      <Text style={s.stateActionText}>Try again</Text>
                    </TouchableOpacity>
                  </View>
                ) : (liveExploreLoading || exploreServiceDestinationResolving) && filteredLiveExplorePlaces.length === 0 ? (
                  <>
                    <TrailheadCardSkeleton media lines={2} style={s.livePlaceSkeleton} />
                    <TrailheadCardSkeleton media lines={2} style={s.livePlaceSkeleton} />
                  </>
                ) : liveExploreError ? (
                  <View style={s.nearbyPermissionState}>
                    <Text style={s.livePlacesEmpty}>{liveExploreError}</Text>
                    <TouchableOpacity style={s.stateAction} onPress={() => setExploreLocationRequestId(value => value + 1)} activeOpacity={0.84}>
                      <Ionicons name="refresh" size={15} color="#fff" />
                      <Text style={s.stateActionText}>Try again</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
                {filteredLiveExplorePlaces.map(place => (
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

            {(!showExperienceSearch || showGuidedFallbackPlaces) && !showGuidedDestinations && <View style={s.exploreHomeHeading}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.exploreHomeTitle}>
                  {exploreMode === 'nearby'
                    ? 'Nearby Places'
                    : exploreMode === 'trip'
                      ? 'Along Your Trip'
                      : exploreSavedOnly
                        ? 'Saved Places'
                        : isThingsToDoExploreQuery(exploreQuery)
                        ? 'Things To Do'
	                        : showGuidedFallbackPlaces
	                          ? 'Related places'
	                        : showExperienceSearch || tourSearchPaused
	                          ? 'Guided Trips'
                        : hasExploreQuery
                          ? 'Search Results'
                          : exploreCategory === 'all'
                          ? 'Featured Places'
                            : exploreCategoryLabel(exploreCategory)}
                </Text>
                <Text style={s.exploreHomeCount}>{exploreHomeCountLabel}</Text>
              </View>
            </View>}

            {(exploreLoading || exploreSearchResolving) && !tourSearchPaused && !exploreNearbyNeedsLocation && (rankedExplore.length === 0 || holdLegacySearchWrapper) && featuredSections.length === 0 && !featuredLead && (
              <View style={s.exploreLoadingBlock}>
                <TrailheadLoadingRow
                  label={exploreSearchResolving ? 'Searching places' : 'Finding the best places'}
                  sub={exploreSearchResolving ? 'Checking matches for this area.' : 'Loading parks, trails, stays, water, and trip ideas.'}
                  icon={exploreSearchResolving ? 'search-outline' : 'compass-outline'}
                />
                {rankedExplore.length === 0 || holdLegacySearchWrapper ? (
                  <>
                    <TrailheadCardSkeleton media lines={3} />
                    <TrailheadCardSkeleton media lines={3} />
                    <TrailheadCardSkeleton media lines={3} />
                  </>
                ) : null}
              </View>
            )}
            {!!exploreError && !exploreLoading && !exploreSearchResolving && rankedExplore.length === 0 && featuredSections.length === 0 && !featuredLead && (
              <View style={s.emptyState}>
                <Ionicons name="cloud-offline-outline" size={44} color={C.text3} />
                <Text style={s.emptyTitle}>Explore is offline</Text>
                <Text style={s.emptySub}>{exploreError}</Text>
                <TouchableOpacity style={s.stateAction} onPress={() => setExploreCatalogReloadId(value => value + 1)} activeOpacity={0.84}>
                  <Ionicons name="refresh" size={15} color="#fff" />
                  <Text style={s.stateActionText}>Try again</Text>
                </TouchableOpacity>
              </View>
            )}
            {showGuidedFallbackPlaces ? (
              <View style={s.guidedFallbackBlock}>
                {guidedFallbackDisplayPlaces.map((place, idx) => renderExploreCard({ place, distance: null }, idx))}
              </View>
            ) : holdGuidedExploreResults ? null
            : featuredSections.length > 0 ? (
              <>
                {!!featuredLead && (
                  <View style={s.exploreLeadBlock}>
                    {renderExploreCard(featuredLead, 0)}
                  </View>
                )}
                {trendingExplore.length > 0 && (
                  <View style={s.trendingSection}>
                    <View style={s.trendingHeader}>
                      <Text style={s.trendingTitle}>Trending This Week</Text>
                      <TouchableOpacity onPress={() => setExploreCategory(trendingExploreCategory)} activeOpacity={0.8}>
                        <Text style={s.trendingLink}>View all</Text>
                      </TouchableOpacity>
                    </View>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.trendingRail}>
                      {trendingExplore.map((item, idx) => renderExploreCard(item, idx, true))}
                    </ScrollView>
                  </View>
                )}
                {featuredSections.map(section => (
                  <View key={section.key} style={s.explorePreviewSection}>
                  <View style={s.exploreSectionHeader}>
                    <Text style={s.exploreSectionTitle}>{section.label}</Text>
                    <TouchableOpacity onPress={() => setExploreCategory(section.key)}>
                      <Text style={s.exploreSectionLink}>View all</Text>
                    </TouchableOpacity>
                  </View>
                  {section.rows.map((item, idx) => renderExploreCard(item, idx))}
                  <TouchableOpacity
                    style={s.exploreSectionMoreBtn}
                    onPress={() => setExploreCategory(section.key)}
                    activeOpacity={0.84}
                  >
                    <Text style={s.exploreSectionMoreText}>More {section.label}</Text>
                    <Ionicons name="arrow-forward" size={14} color={C.orange} />
                  </TouchableOpacity>
                </View>
                ))}
                {featuredHomeMoreExplore.length > 0 ? (
                  <View style={s.explorePreviewSection}>
                    <View style={s.exploreSectionHeader}>
                      <Text style={s.exploreSectionTitle}>More places</Text>
                    </View>
                    {featuredHomeMoreExplore.map((item, idx) => renderExploreCard(item, idx))}
                  </View>
                ) : null}
                {(exploreLocalRemaining > 0 || canLoadMoreExploreCatalog || exploreCatalogPageLoading) ? (
                  <TouchableOpacity
                    style={s.exploreLoadMoreBtn}
                    onPress={showMoreExplorePlaces}
                    disabled={exploreCatalogPageLoading && exploreLocalRemaining <= 0}
                    activeOpacity={0.84}
                  >
                    {exploreCatalogPageLoading && exploreLocalRemaining <= 0 ? <ActivityIndicator color={C.orange} size="small" /> : null}
                    <Text style={s.exploreLoadMoreText}>
                      {exploreLocalRemaining > 0
                        ? `Show ${Math.min(EXPLORE_VISIBLE_STEP, exploreLocalRemaining)} more`
                        : exploreCatalogPageLoading
                          ? 'Finding more places'
                          : 'Show more places'}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </>
            ) : !exploreError && !tourSearchPaused && !showExperienceSearch && !exploreServiceDestinationResolving && !exploreServiceDestinationFailed && ((!exploreLoading && !exploreSearchResolving) || exploreNearbyNeedsLocation) && rankedExplore.length === 0 && filteredLiveExplorePlaces.length === 0 ? (
              <View style={s.emptyState}>
                <Ionicons name={exploreSavedOnly ? 'bookmark-outline' : exploreTripNeedsRoute ? 'map-outline' : 'search-outline'} size={44} color={C.text3} />
                <Text style={s.emptyTitle}>
                  {exploreSavedOnly
                    ? 'Saved places start here'
                    : exploreNearbyNeedsLocation
                      ? 'Location needed'
                      : exploreTripNeedsRoute
                        ? 'Open a trip first'
                        : exploreCategory === 'fuel'
                          ? 'Search fuel near a place'
                          : exploreCategory === 'resupply'
                            ? 'Search supplies near a place'
                            : 'Keep exploring'}
                </Text>
                <Text style={s.emptySub}>
                  {exploreSavedOnly
                    ? 'Save places to build a short list for your route.'
                    : exploreNearbyNeedsLocation
                      ? 'Turn on location or search a destination to explore nearby places.'
                      : exploreTripNeedsRoute
                        ? 'Open or build a route to rank Explore places around your trip stops.'
                        : exploreCategory === 'fuel'
                          ? 'Enter a destination or route to find nearby fuel stops.'
                          : exploreCategory === 'resupply'
                            ? 'Enter a destination or route to find groceries, repair, water, and services.'
                            : 'Try a town, park, trail, waterfall, or hot spring nearby.'}
                </Text>
                {exploreTripNeedsRoute ? (
                  <TouchableOpacity
                    style={s.stateAction}
                    onPress={() => router.push('/(tabs)/route-builder')}
                    activeOpacity={0.84}
                  >
                    <Ionicons name="map-outline" size={15} color="#fff" />
                    <Text style={s.stateActionText}>Open route builder</Text>
                  </TouchableOpacity>
                ) : !exploreSavedOnly && !exploreNearbyNeedsLocation ? (
                  <TouchableOpacity
                    style={s.stateAction}
                    onPress={() => {
                      setExploreQuery('');
                      setExploreCategory('all');
                      setExploreSortMode('best');
                    }}
                    activeOpacity={0.84}
                  >
                    <Ionicons name="refresh" size={15} color="#fff" />
                    <Text style={s.stateActionText}>Reset search</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : (
              <>
                {visibleRankedExplore.map((item, idx) => renderExploreCard(item, idx))}
                {!holdLegacySearchWrapper && (exploreLocalRemaining > 0 || canLoadMoreExploreCatalog || exploreCatalogPageLoading) && (
                  <TouchableOpacity
                    style={s.exploreLoadMoreBtn}
                    onPress={showMoreExplorePlaces}
                    disabled={exploreCatalogPageLoading && exploreLocalRemaining <= 0}
                    activeOpacity={0.84}
                  >
                    {exploreCatalogPageLoading && exploreLocalRemaining <= 0 ? <ActivityIndicator color={C.orange} size="small" /> : null}
                    <Text style={s.exploreLoadMoreText}>
                      {exploreLocalRemaining > 0
                        ? `Show ${Math.min(EXPLORE_VISIBLE_STEP, exploreLocalRemaining)} more`
                        : exploreCatalogPageLoading
                          ? 'Finding more places'
                          : 'Show more places'}
                    </Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        )}

        {tab === 'narrations' && (
          <>
            {!!activeTrip && Object.keys(guide).length > 0 && (
              <View style={s.narrationToolbar}>
                <View>
                  <Text style={s.exploreSectionTitle}>Trip Audio</Text>
                  <Text style={s.exploreSectionSub}>{exploreCountLabel(Object.keys(guide).length, 'narration', 'narrations')} ready</Text>
                </View>
                <TouchableOpacity
                  style={[s.autoBtn, autoPlay && s.autoBtnOn]}
                  onPress={() => setAutoPlay(p => !p)}
                >
                  <Ionicons name={autoPlay ? 'radio' : 'radio-outline'} size={14}
                    color={autoPlay ? C.orange : C.text3} />
                  <Text style={[s.autoBtnText, autoPlay && { color: C.orange }]}>Auto</Text>
                </TouchableOpacity>
              </View>
            )}
            {!activeTrip && (
              <View style={s.emptyState}>
                <Ionicons name="map-outline" size={48} color={C.text3} />
                <Text style={s.emptyTitle}>No Active Trip</Text>
                <Text style={s.emptySub}>Plan a trip first to use waypoint tools and route audio.</Text>
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
                <Text style={s.guidePromptTitle}>Build trip narrations</Text>
                <Text style={s.guidePromptText}>
                  Creates short spoken notes for each stop. Explorer covers new narration, and saved guides replay instantly.
                </Text>
                {!!guideError && <Text style={s.guideError}>{guideError}</Text>}
                <TrailheadButton label="Build Guide" icon="mic-outline" variant="primary" onPress={generateGuide} style={{ alignSelf: 'stretch' }} />
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
                    : !guideLoading && <Text style={s.narrationMissing}>Narration will appear after a trip has stops.</Text>
                  }
                </View>
              );
            })}

            <TourTarget id="guide.audio">
              <View style={s.nearbyCard}>
                <Text style={s.nearbyLabel}>What's around me?</Text>
                <Text style={s.nearbySub}>Location narration for your current position. Explorer covers new narration.</Text>
                {!!nearbyNarration && <Text style={s.nearbyText}>{nearbyNarration}</Text>}
                <TouchableOpacity style={s.nearbyBtn} onPress={whatIsHere} disabled={nearbyLoading}>
                  {nearbyLoading
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <>
                        <Ionicons name="location" size={16} color="#fff" />
                        <Text style={s.nearbyBtnText}>Tell me about here</Text>
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
                <Text style={s.emptySub}>Weather will appear when this trip area has a forecast.</Text>
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
                      <Text style={s.weatherStatLabel}>Hi/Lo</Text>
                    </View>
                    <View style={s.weatherStat}>
                      <Text style={s.weatherStatVal}>{wind}{windLabel}</Text>
                      <Text style={s.weatherStatLabel}>Wind</Text>
                    </View>
                    {rain > 0 && (
                      <View style={s.weatherStat}>
                        <Text style={[s.weatherStatVal, { color: '#38bdf8' }]}>{rain.toFixed(units?.mode === 'metric' ? 0 : 1)}{rainLabel}</Text>
                        <Text style={s.weatherStatLabel}>Rain</Text>
                      </View>
                    )}
                  </View>
                </View>
              );
            })}
          </>
        )}
      </ScrollView>

      {renderGuidedDateSheet()}
      {renderGuidedFilterSheet()}
      <ExploreCategoryFilterSheet
        visible={exploreFilterSheetOpen}
        selected={exploreCategory}
        counts={availableExploreCategoryCounts}
        onSelect={selectExploreHomeCategory}
        onClose={() => setExploreFilterSheetOpen(false)}
      />

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

      <GuidedTripDetailModal
        visible={!!selectedExperience}
        experience={selectedExperience}
        loading={selectedExperienceLoading}
        topInset={insets.top}
        mediaUrl={mediaUrl}
        onClose={closeExperienceDetail}
        onSave={saveExperienceToPlanner}
        saveLabel={activeTrip ? 'Add to trip' : 'Start trip'}
        onShowArea={showSelectedExperienceOnMap}
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
            experiencesSlot={renderExploreExperiences(selectedExplore)}
            trailStatusSlot={renderExploreTrailStatus(selectedExplore)}
            weather={getExploreDetailWeather(selectedExplore)}
            weatherSlot={renderExploreWeather(selectedExplore)}
            relatedSlot={relatedExplore.length > 0 ? (
              <View style={s.relatedExploreSection}>
                <Text style={s.profileLabel}>Near this stop</Text>
                <Text style={s.profileTextMuted}>Nearby parks, camp areas, trails, and stops around this destination.</Text>
                <View style={s.relatedExploreList}>
                  {relatedExplore.slice(0, 4).map((item, idx) => renderExploreCard(item, idx, false))}
                </View>
              </View>
            ) : null}
            onClose={() => setSelectedExplore(null)}
            onPlayAudio={() => playExplore(selectedExplore)}
            onShowArea={() => showExploreOnMap(selectedExplore)}
            onRoute={() => activeTrip ? addExplorePlaceToTrip(selectedExplore) : startTripFromExplore(selectedExplore)}
            routeLabel={activeTrip ? (isExploreAddedToTrip(selectedExplore) ? 'Added to trip' : 'Add to trip') : 'Start trip'}
            routeDisabled={!!activeTrip && isExploreAddedToTrip(selectedExplore)}
            onToggleSave={() => toggleSavedExplore(selectedExplore)}
            onNearbyAction={module => handleExploreNearbyAction(selectedExplore, module)}
            onSourcePackItem={showSourcePackItemOnMap}
            onTrailMap={trail => showExploreTrailOnMap(selectedExplore, trail)}
            onTrailRoute={trail => directionsToExploreTrailhead(selectedExplore, trail)}
            mediaUrl={mediaUrl}
          />
        )}
      </Modal>
    </SafeAreaView>
  );
}

function ExploreCampgroundSkeletonCard({
  C,
  styles,
}: {
  C: ColorPalette;
  styles: ReturnType<typeof makeStyles>;
}) {
  const pulse = useRef(new Animated.Value(0.58)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 760, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.58, duration: 760, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <View style={[styles.campgroundCard, { borderColor: C.border, backgroundColor: C.s1 }]}>
      <Animated.View style={[styles.campgroundSkeletonImage, { opacity: pulse, backgroundColor: C.s2 }]} />
      <View style={styles.campgroundSkeletonBody}>
        <Animated.View style={[styles.campgroundSkeletonLine, styles.campgroundSkeletonTitle, { opacity: pulse, backgroundColor: C.s2 }]} />
        <Animated.View style={[styles.campgroundSkeletonLine, { opacity: pulse, backgroundColor: C.s2 }]} />
        <Animated.View style={[styles.campgroundSkeletonLine, styles.campgroundSkeletonShort, { opacity: pulse, backgroundColor: C.s2 }]} />
        <View style={styles.campgroundSkeletonActions}>
          <Animated.View style={[styles.campgroundSkeletonButton, { opacity: pulse, backgroundColor: C.orange + '22' }]} />
          <Animated.View style={[styles.campgroundSkeletonIcon, { opacity: pulse, backgroundColor: C.s2 }]} />
        </View>
      </View>
    </View>
  );
}

export default function GuideScreen() {
  const pathname = usePathname();
  if (pathname !== '/' && !pathname.includes('/guide')) return null;
  return <GuideScreenContent />;
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
  landingHeader: { marginHorizontal: -14, marginTop: -14, backgroundColor: C.s1 },
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
  utilityHeader: {
    marginHorizontal: -14,
    marginTop: -14,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 18,
    borderBottomWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
    gap: 16,
  },
  utilityBack: {
    alignSelf: 'flex-start',
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s2,
    paddingHorizontal: 10,
  },
  utilityBackText: { color: C.text2, fontSize: 11, fontFamily: mono, fontWeight: '900' },
  utilityTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  utilityIcon: {
    width: 46,
    height: 46,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.orange + '44',
    backgroundColor: C.orangeGlow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  utilityKicker: { color: C.orange, fontSize: 10, fontFamily: mono, fontWeight: '900', letterSpacing: 0 },
  utilityTitle: { color: C.text, fontSize: 22, lineHeight: 27, fontWeight: '900', marginTop: 3 },
  scroll: { flex: 1 },
  scrollContent: { padding: 14, gap: 0, paddingBottom: 122 },
  loadRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 16, backgroundColor: C.s2, borderRadius: 12, borderWidth: 1, borderColor: C.border,
  },
  loadText: { color: C.text2, fontSize: 13 },
  exploreLoadingBlock: { gap: 10, marginHorizontal: 20, marginBottom: 14 },
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
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  categoryTile: {
    flexBasis: '48%', maxWidth: '48%', minHeight: 104, borderRadius: 8,
    backgroundColor: C.s2, borderWidth: 1, borderColor: C.border,
    padding: 12, justifyContent: 'space-between',
  },
  categoryTileIcon: {
    width: 38, height: 38, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  categoryTileText: { color: C.text, fontSize: 14, lineHeight: 18, fontWeight: '900', marginTop: 10 },
  exploreFeedSheet: {
    marginHorizontal: -14,
    marginTop: 0,
    paddingTop: 22,
    paddingHorizontal: 14,
    paddingBottom: 18,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    backgroundColor: C.bg,
    gap: 14,
  },
  exploreHomeHeading: {
    marginHorizontal: 20,
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  exploreHomeTitle: { color: C.text, fontSize: 23, lineHeight: 28, fontWeight: '900', letterSpacing: 0 },
  exploreHomeCount: { color: C.text3, fontSize: 12, lineHeight: 16, fontWeight: '800', marginTop: 3 },
  catalogNotice: { minHeight: 42, marginHorizontal: 20, borderWidth: 1, borderColor: C.border, borderRadius: 10, backgroundColor: C.s1, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  catalogNoticeText: { flex: 1, minWidth: 0, color: C.text2, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  guidedSearchPanel: {
    marginHorizontal: 20,
    marginBottom: 0,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
    padding: 14,
    gap: 12,
  },
  guidedPanelTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  guidedPanelTitle: {
    color: C.text,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '900',
    letterSpacing: 0,
  },
  guidedField: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s2,
    paddingHorizontal: 13,
  },
  guidedFieldLabel: {
    color: C.text3,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '900',
    letterSpacing: 0,
  },
  guidedInput: {
    minHeight: 34,
    color: C.text,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '800',
    paddingVertical: 4,
  },
  guidedSelector: {
    minHeight: 64,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s2,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  guidedSelectorIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.orangeGlow,
  },
  guidedSelectorValue: {
    color: C.text,
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '900',
    marginTop: 2,
  },
  guidedSearchButton: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: C.orange,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  guidedSearchButtonText: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '900',
  },
  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15,23,42,0.34)',
  },
  sheet: {
    maxHeight: '88%',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    backgroundColor: C.bg,
    paddingHorizontal: 18,
    paddingTop: 16,
    gap: 12,
  },
  sheetHeader: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sheetTitle: {
    color: C.text,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '900',
    letterSpacing: 0,
  },
  sheetClose: {
    width: 36,
    height: 36,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.s2,
    borderWidth: 1,
    borderColor: C.border,
  },
  sheetSectionTitle: {
    color: C.text3,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
    marginTop: 4,
    letterSpacing: 0,
  },
  sheetRows: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
    overflow: 'hidden',
  },
  sheetRow: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  sheetRowText: {
    flex: 1,
    minWidth: 0,
    color: C.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  sheetCheckBox: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.s2,
  },
  sheetCheckBoxActive: {
    borderColor: C.orange,
    backgroundColor: C.orange,
  },
  sheetApplyButton: {
    minHeight: 50,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.orange,
  },
  sheetApplyText: {
    color: '#fff',
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '900',
  },
  calendarHeader: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  calendarNav: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.s1,
    borderWidth: 1,
    borderColor: C.border,
  },
  calendarMonth: {
    color: C.text,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '900',
  },
  weekdayRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  weekdayText: {
    flex: 1,
    textAlign: 'center',
    color: C.text3,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '900',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingBottom: 4,
  },
  calendarCell: {
    width: '14.2857%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
  },
  calendarCellSelected: {
    backgroundColor: C.orange,
  },
  calendarCellDisabled: {
    opacity: 0.35,
  },
  calendarCellText: {
    color: C.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
  },
  calendarCellTextSelected: {
    color: '#fff',
  },
  calendarCellTextDisabled: {
    color: C.text3,
  },
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
  exploreLeadBlock: { marginHorizontal: 20 },
  guidedFallbackBlock: { marginHorizontal: 20, gap: 14 },
  trendingSection: { gap: 12, marginBottom: 10 },
  trendingHeader: { marginHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  trendingTitle: { color: C.text, fontSize: 20, lineHeight: 24, fontWeight: '900', letterSpacing: 0 },
  trendingLink: { color: C.text2, fontSize: 13, fontWeight: '900' },
  trendingRail: { gap: 12, paddingHorizontal: 20, paddingBottom: 2, paddingRight: 34 },
  explorePreviewSection: { gap: 0, marginBottom: 6, marginHorizontal: 20 },
  exploreRailSection: { gap: 9 },
  exploreRail: { gap: 12, paddingRight: 8 },
  exploreSectionMoreBtn: {
    minHeight: 44,
    marginBottom: 18,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: C.orange + '55',
    backgroundColor: C.orangeGlow,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  exploreSectionMoreText: { color: C.orange, fontSize: 11, fontFamily: mono, fontWeight: '900', letterSpacing: 0 },
  exploreLoadMoreBtn: {
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.orange + '55',
    backgroundColor: C.orangeGlow,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 20,
    marginBottom: 12,
  },
  exploreLoadMoreText: { color: C.orange, fontSize: 11, fontFamily: mono, fontWeight: '900' },
  categoryRow: { gap: 8, paddingVertical: 2 },
  categoryChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: C.border, backgroundColor: C.s1 },
  categoryChipActive: { borderColor: C.orange, backgroundColor: C.orangeGlow },
  categoryText: { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '800' },
  categoryTextActive: { color: C.orange },
  livePlacesBlock: { marginHorizontal: 20, backgroundColor: C.glassStrong, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 10, gap: 8 },
  livePlacesTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2 },
  livePlacesTitle: { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '900', letterSpacing: 0.8 },
  livePlacesEmpty: { color: C.text3, fontSize: 12, lineHeight: 18, paddingHorizontal: 2, paddingBottom: 2 },
  nearbyPermissionState: { minHeight: 96, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 12 },
  livePlaceSkeleton: { minHeight: 64, padding: 8 },
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
  exploreTrailSkeleton: { minHeight: 62, padding: 10 },
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
  stateAction: { minHeight: 42, borderRadius: 10, paddingHorizontal: 14, backgroundColor: C.orange, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  stateActionText: { color: '#fff', fontSize: 12, fontWeight: '900' },
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
  campgroundListSkeleton: { gap: 12, paddingTop: 12 },
  campgroundLoadingSkeleton: { marginHorizontal: 0 },
  campgroundList: { gap: 12, paddingTop: 12 },
  campgroundCard: { width: '100%', minHeight: 326, backgroundColor: C.s1, borderRadius: 16, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  campgroundImageWrap: { width: '100%', height: 190, backgroundColor: C.s2 },
  campgroundImage: { width: '100%', height: '100%' },
  campgroundImageFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.s1 },
  campgroundImageShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.16)' },
  campgroundBadge: { position: 'absolute', left: 11, top: 11, maxWidth: 178, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(15,23,42,0.78)' },
  campgroundBadgeText: { color: '#fff', fontSize: 8, fontFamily: mono, fontWeight: '900' },
  campgroundPhotoNote: { position: 'absolute', right: 11, bottom: 11, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(15,23,42,0.72)' },
  campgroundPhotoNoteText: { color: '#fff', fontSize: 8, fontFamily: mono, fontWeight: '900' },
  campgroundBody: { minWidth: 0, padding: 13, gap: 8, justifyContent: 'center' },
  campgroundName: { color: C.text, fontSize: 18, lineHeight: 23, fontWeight: '900' },
  campgroundMeta: { color: C.text3, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  campgroundCost: { color: C.orange, fontSize: 12, fontWeight: '900' },
  campgroundActions: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 2 },
  campgroundOpenBtn: { flex: 1, height: 40, borderRadius: 12, backgroundColor: C.orange, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  campgroundOpenText: { color: '#fff', fontSize: 10, fontFamily: mono, fontWeight: '900' },
  campgroundSourceBtn: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', backgroundColor: C.s2 },
  campgroundSkeletonImage: { width: '100%', height: 190 },
  campgroundSkeletonBody: { padding: 13, gap: 10 },
  campgroundSkeletonLine: { height: 12, width: '88%', borderRadius: 999 },
  campgroundSkeletonTitle: { height: 18, width: '66%' },
  campgroundSkeletonShort: { width: '52%' },
  campgroundSkeletonActions: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 4 },
  campgroundSkeletonButton: { flex: 1, height: 40, borderRadius: 12 },
  campgroundSkeletonIcon: { width: 40, height: 40, borderRadius: 12 },
  campgroundEmpty: { marginTop: 12, paddingVertical: 18, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.s1, alignItems: 'center', gap: 7 },
  campgroundEmptyText: { color: C.text3, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  profileHook: { color: C.text, fontSize: 17, lineHeight: 25, fontWeight: '800' },
  relatedExploreSection: { marginHorizontal: 14, marginTop: 10, gap: 10 },
  relatedExploreList: { gap: 12 },
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
