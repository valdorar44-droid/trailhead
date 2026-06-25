import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator,
  Image, Modal, Linking, useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import TourTarget from '@/components/TourTarget';
import PaywallModal from '@/components/PaywallModal';
import PremiumPlaceSheet from '@/components/PremiumPlaceSheet';
import { TrailheadButton, TrailheadCard, TrailheadCardSkeleton, TrailheadLoadingRow, TrailheadRailSkeleton } from '@/components/TrailheadUI';
import {
  EXPLORE_CATEGORY_CHIPS,
  ExploreDetailSheet,
  ExploreExperiencesRail,
  ExploreHero,
  ExploreHomeControls,
  ExplorePlaceCard,
  exploreCategoryFromQuery,
  exploreCategoryMatches,
  exploreQueryScore as scoreExploreQuery,
  exploreTrustScore as scoreExploreTrust,
  getExploreCategoryKey,
  mergeCuratedExplorePlaces,
  type ExploreCategoryKey,
  type ExploreDetailTab,
  type ExploreDetailWeather,
  type ExploreNearbyModule,
  type ExploreSortMode,
} from '@/components/explore';
import { useStore } from '@/lib/store';
import { api, PaywallError, type BookableExperience, type CampsitePin, type ExploreCatalogIndexItem, type ExplorePlaceProfile, type ExploreSourcePackItem, type ExploreTrailCard, type OsmPoi } from '@/lib/api';
import { storage } from '@/lib/storage';
import { useTheme, mono, ColorPalette } from '@/lib/design';
import { trackPhase0Once } from '@/lib/telemetry';
import { playTrailheadVoice, stopTrailheadVoice } from '@/lib/voice';

const EXPLORE_CACHE_KEY = 'trailhead_explore_catalog_index_v3';
const EXPLORE_CAMPGROUNDS_CACHE_PREFIX = 'trailhead_explore_campgrounds_v1:';
const EXPLORE_TRAIL_AREA_CACHE_PREFIX = 'trailhead_explore_trail_area_v1:';
const EXPLORE_EXPERIENCES_CACHE_PREFIX = 'trailhead_explore_experiences_v1:';
const SAVED_EXPLORE_KEY = 'trailhead_saved_explore_places_v1';
const LOCATION_WARMUP_PROMPT_KEY = 'trailhead_foreground_location_prompt_v1';
const EXPLORE_INITIAL_VISIBLE = 48;
const EXPLORE_VISIBLE_STEP = 48;
const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.gettrailhead.app';
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
  'tours',
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
  'tours',
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

function shouldSearchBookableExperiences(query: string, category: ExploreCategoryKey) {
  if (category === 'tours') return true;
  return /\b(tour|tours|experience|experiences|things to do|activity|activities|ticket|tickets|guide|guided|jeep|rafting|boat|shuttle)\b/i.test(query);
}

function placeQueryFromExploreQuery(query: string) {
  return query
    .replace(/\b(things to do|tour|tours|experience|experiences|activity|activities|ticket|tickets|guide|guided|book|booking)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
    place.profile?.summary,
    place.profile?.why_it_matters,
    (place as any).search_blob,
    ...(place.subcategories ?? []),
    ...(place.summary.tags ?? []),
    ...((place as any).search_aliases ?? []),
    ...nestedTitles,
  ].filter(Boolean).join(' '));
}

function isDestinationExploreHub(place: ExplorePlaceProfile) {
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
  if (/\b(campgrounds?|campsites?|camping|glamping|huts?|cabins?|lodging|trails?|trailheads?|visitor centers?|parking|tours?|activities|climb|climbing)\b/.test(categoryText)) {
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
  if (isDestinationExploreHub(place)) return false;
  const key = getExploreCategoryKey(place);
  if (['camp', 'glamping', 'huts', 'trails', 'trailheads', 'climb', 'tours'].includes(key)) return true;
  const text = normalizeExploreText([
    place.id,
    place.summary.title,
    place.summary.category,
    place.summary.explore_group,
    place.category,
    ...(place.subcategories ?? []),
    ...(place.summary.tags ?? []),
  ].filter(Boolean).join(' '));
  return /\b(campgrounds?|campsites?|camping|glamping|huts?|cabins?|lodges?|lodging|trails?|trailheads?|visitor centers?|parking|tours?|activities|things to do|places to stay|base camp|trek)\b/.test(text);
}

function exploreHubMatchDistanceOk(child: ExplorePlaceProfile, hub: ExplorePlaceProfile) {
  if (child.summary.lat == null || child.summary.lng == null || hub.summary.lat == null || hub.summary.lng == null) return true;
  return distMi(
    { lat: Number(child.summary.lat), lng: Number(child.summary.lng) },
    { lat: Number(hub.summary.lat), lng: Number(hub.summary.lng) },
  ) < 180;
}

function findExploreParentHub(child: ExplorePlaceProfile, hubs: ExplorePlaceProfile[]) {
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
  if (/\b(tours?|tickets?|guided|activities|things to do)\b/.test(text)) keys.add('tours');
  return keys;
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
  if (!tokens.length || tokens.some(token => !extra.includes(token))) return 0;
  return 35 + Math.min(tokens.length * 8, 40) + (extra.includes(normalized) ? 20 : 0);
}

function exploreCategoryMatchesWithHub(place: ExplorePlaceProfile, key: ExploreCategoryKey, hubCategories: Map<string, Set<ExploreCategoryKey>>) {
  if (key === 'all' || key === 'nearby') return true;
  if (exploreCategoryMatches(place, key)) return true;
  return hubCategories.get(place.id)?.has(key) ?? false;
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
  const preserveHubIdentity = isDestinationExploreHub(place);
  return {
    ...place,
    category: preserveHubIdentity ? place.category : area.category || place.category,
    subcategories: preserveHubIdentity
      ? (place.subcategories ?? [])
      : Array.from(new Set([...(place.subcategories ?? []), ...(area.subcategories ?? [])])),
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
      category: preserveHubIdentity ? place.summary.category : area.summary.category || place.summary.category,
      explore_group: preserveHubIdentity ? place.summary.explore_group : area.summary.explore_group || place.summary.explore_group,
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

function exploreIndexItemToProfile(item: ExploreCatalogIndexItem): ExplorePlaceProfile {
  const title = String(item.title || 'Explore stop').trim();
  const category = item.category || 'Explore';
  const region = item.region || '';
  const hook = item.hook || item.short_description || `${title} is a mapped Explore stop.`;
  const short = item.short_description || item.hook || 'Open the card for source details, nearby stops, weather, and map context.';
  return {
    id: item.id,
    category: item.v3_category || item.category,
    subcategories: item.subcategories ?? [],
    sources: item.sources ?? [],
    source_ids: item.source_ids ?? [],
    quality: item.quality || item.source_quality,
    quality_score: item.quality_score,
    verified: item.verified,
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
      source_title: item.source_title || '',
    },
    profile: {
      hook,
      summary: short,
      story: short,
      why_it_matters: short,
      what_to_know: 'Check current access, fees, closures, permits, and local rules before you go.',
      best_time_to_stop: 'Check season and current conditions.',
      access_notes: 'Open the source link and map before committing to the stop.',
      nearby_context: 'Use nearby camps, trails, services, weather, and map context from this stop.',
    },
    audio_script: short,
    wiki_extract: '',
    source_pack: {
      quality: item.source_quality || 'open',
      primary: item.source_title || '',
      official_url: item.source_url || '',
      sources: item.sources?.length ? item.sources : item.source_url ? [{
        title,
        publisher: item.source_title || 'Open source',
        url: item.source_url,
        kind: item.source_quality || 'open',
      }] : [],
      photos: item.media?.length ? item.media.map(photo => ({
        url: photo.url,
        caption: photo.caption || title,
        credit: photo.credit || item.image_credit || item.source_title || '',
      })) : (item.image_url || item.thumbnail_url) ? [{
        url: item.image_url || item.thumbnail_url,
        caption: title,
        credit: item.image_credit || item.source_title || '',
      }] : [],
      topics: item.tags ?? [],
      source_note: 'Open the full card for more details.',
    },
    facts: {
      coordinates: item.lat != null && item.lng != null ? `${Number(item.lat).toFixed(5)}, ${Number(item.lng).toFixed(5)}` : '',
      source_url: item.source_url || '',
      source_title: item.source_title || '',
      official_url: item.source_url || '',
      source_quality: item.source_quality || '',
    },
    attribution: item.source_title || 'Open source details',
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

function shouldUseExploreDetailEndpoint(place: ExplorePlaceProfile) {
  return !place.id.startsWith('explore:waterfalls:') && place.id !== 'explore:trails:yosemite-trails';
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
  const params = useLocalSearchParams<{ view?: string | string[] }>();
  const user = useStore(st => st.user);
  const activeTrip = useStore(st => st.activeTrip);
  const setActiveTrip = useStore(st => st.setActiveTrip);
  const userLoc = useStore(st => st.userLoc);
  const setUserLoc = useStore(st => st.setUserLoc);
  const weatherUnitMode = useStore(st => st.weatherUnitMode);
  const setWeatherUnitMode = useStore(st => st.setWeatherUnitMode);
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
  const [exploreSavedOnly, setExploreSavedOnly] = useState(false);
  const [exploreQuery, setExploreQuery] = useState('');
  const [exploreVisibleLimit, setExploreVisibleLimit] = useState(EXPLORE_INITIAL_VISIBLE);
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
  const [exploreExperiencesById, setExploreExperiencesById] = useState<Record<string, BookableExperience[]>>({});
  const [exploreExperienceLoadingId, setExploreExperienceLoadingId] = useState<string | null>(null);
  const [exploreExperienceErrors, setExploreExperienceErrors] = useState<Record<string, string>>({});
  const [exploreSearchExperiences, setExploreSearchExperiences] = useState<BookableExperience[]>([]);
  const [exploreSearchExperienceLoading, setExploreSearchExperienceLoading] = useState(false);
  const [exploreSearchExperienceError, setExploreSearchExperienceError] = useState('');
  const [exploreHomeWeather, setExploreHomeWeather] = useState<any>(null);
  const [exploreHomeWeatherLoading, setExploreHomeWeatherLoading] = useState(false);
  const [exploreHomeWeatherError, setExploreHomeWeatherError] = useState('');
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
  const exploreLocationPrompted = useRef(false);
  const storyScrollRef = useRef<ScrollView | null>(null);
  const storyTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const requestedView = Array.isArray(params.view) ? params.view[0] : params.view;

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
    let cancelled = false;
    let backgroundTimer: ReturnType<typeof setTimeout> | null = null;

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
      if (!raw) return [] as ExplorePlaceProfile[];
      try {
        const cached = JSON.parse(raw);
        return Array.isArray(cached?.places) ? cached.places as ExplorePlaceProfile[] : [];
      } catch {
        return [] as ExplorePlaceProfile[];
      }
    };

    const hydrateRemainingCatalog = async (cursor: number | null | undefined, seededPlaces: ExplorePlaceProfile[]) => {
      let nextCursor = cursor;
      let allPlaces = seededPlaces;
      for (let page = 0; nextCursor != null && page < 8; page += 1) {
        const catalog = await api.getExploreCatalogIndex({ limit: 500, cursor: nextCursor });
        const pagePlaces = (catalog.places ?? []).map(exploreIndexItemToProfile);
        allPlaces = mergeById(allPlaces, pagePlaces);
        nextCursor = catalog.next_cursor;
        if (cancelled) return;
        await new Promise(resolve => setTimeout(resolve, 120));
      }
      if (!cancelled && allPlaces.length > seededPlaces.length) {
        storage.set(EXPLORE_CACHE_KEY, JSON.stringify({ places: allPlaces, fetched_at: Date.now() })).catch(() => {});
      }
    };

    // Compact home load: show a curated first page, keep source-rich data findable through search/filter.
    setExploreLoading(true);
    (async () => {
      try {
        const firstPage = await withExploreTimeout(api.getExploreCatalogIndex({ limit: 120, cursor: 0 }));
        const firstPlaces = (firstPage.places ?? []).map(exploreIndexItemToProfile);
        if (cancelled) return;
        setExplorePlaces(firstPlaces);
        setExploreError('');
        setExploreLoading(false);
        backgroundTimer = setTimeout(() => {
          hydrateRemainingCatalog(firstPage.next_cursor, firstPlaces).catch(() => {});
        }, 3200);
      } catch {
        const cached = await readCachedCatalog();
        if (cancelled) return;
        if (cached.length) {
          setExplorePlaces(cached.slice(0, 160));
          setExploreError('');
        } else {
          setExploreError('Explore catalog unavailable offline until it has been loaded once.');
        }
        setExploreLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (backgroundTimer) clearTimeout(backgroundTimer);
    };
  }, []);



  useEffect(() => {
    const query = exploreQuery.trim();
    const category = exploreCategory !== 'all' ? exploreCategory : '';
    const shouldFetch = tab === 'explore'
      && exploreMode === 'featured'
      && !exploreSavedOnly
      && (query.length >= 2 || !!category);
    if (!shouldFetch) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      api.getExploreCatalogIndex({
        q: query.length >= 2 ? query : undefined,
        category: category || undefined,
        limit: 420,
        cursor: 0,
      })
        .then(catalog => {
          if (cancelled) return;
          const remotePlaces = (catalog.places ?? []).map(exploreIndexItemToProfile);
          if (!remotePlaces.length) return;
          setExplorePlaces(current => {
            const seen = new Set(current.map(place => place.id));
            const merged = [...current];
            for (const place of remotePlaces) {
              if (!place?.id || seen.has(place.id)) continue;
              seen.add(place.id);
              merged.push(place);
            }
            return merged;
          });
        })
        .catch(() => {});
    }, 280);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tab, exploreMode, exploreQuery, exploreCategory, exploreSavedOnly]);

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
    if (tab !== 'explore' || userLoc || exploreLocationPrompted.current) return;
    let cancelled = false;
    exploreLocationPrompted.current = true;
    setExploreHomeWeatherLoading(true);
    setExploreHomeWeatherError('');
    (async () => {
      const existing = await Location.getForegroundPermissionsAsync().catch(() => null);
      const alreadyPrompted = await storage.get(LOCATION_WARMUP_PROMPT_KEY).catch(() => null);
      if (cancelled) return;
      if (existing?.status !== 'granted' && alreadyPrompted) {
        setExploreHomeWeather(null);
        setExploreHomeWeatherError('Location unavailable');
        setExploreHomeWeatherLoading(false);
        return;
      }
      const permission = existing?.status === 'granted'
        ? existing
        : await Location.requestForegroundPermissionsAsync().catch(() => null);
      if (cancelled) return;
      if (permission?.status !== 'granted') {
        storage.set(LOCATION_WARMUP_PROMPT_KEY, '1').catch(() => {});
        setExploreHomeWeather(null);
        setExploreHomeWeatherError('Location unavailable');
        setExploreHomeWeatherLoading(false);
        return;
      }
      const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
      if (cancelled) return;
      if (fix?.coords) {
        setUserLoc({ lat: fix.coords.latitude, lng: fix.coords.longitude });
      } else {
        setExploreHomeWeather(null);
        setExploreHomeWeatherError('Location unavailable');
        setExploreHomeWeatherLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tab, userLoc?.lat, userLoc?.lng, setUserLoc]);

  useEffect(() => {
    if (tab !== 'explore' || !userLoc) {
      setExploreHomeWeather(null);
      setExploreHomeWeatherError(userLoc ? '' : '');
      setExploreHomeWeatherLoading(false);
      return;
    }
    let cancelled = false;
    setExploreHomeWeatherLoading(true);
    setExploreHomeWeatherError('');
    api.getWeather(userLoc.lat, userLoc.lng, 3, weatherUnitMode)
      .then(weather => {
        if (!cancelled) setExploreHomeWeather(weather);
      })
      .catch(() => {
        if (!cancelled) setExploreHomeWeatherError('Weather unavailable');
      })
      .finally(() => {
        if (!cancelled) setExploreHomeWeatherLoading(false);
      });
    return () => { cancelled = true; };
  }, [tab, userLoc?.lat, userLoc?.lng, weatherUnitMode]);

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
    if (!selectedExplore) return;
    const place = selectedExplore;
    const placeId = place.id;
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
    api.getExplorePlaceExperiences(placeId, 12)
      .then(res => {
        if (cancelled) return;
        const experiences = res.results ?? [];
        setExploreExperiencesById(prev => ({ ...prev, [placeId]: experiences }));
        storage.set(cacheKey, JSON.stringify({ experiences, fetched_at: Date.now() })).catch(() => {});
      })
      .catch(() => {
        if (!cancelled) setExploreExperienceErrors(prev => ({ ...prev, [placeId]: 'Tours unavailable right now.' }));
      })
      .finally(() => {
        if (!cancelled) setExploreExperienceLoadingId(current => current === placeId ? null : current);
      });
    return () => { cancelled = true; };
  }, [selectedExplore?.id]);

  useEffect(() => {
    const shouldLoad = tab === 'explore' && shouldSearchBookableExperiences(exploreQuery, exploreCategory);
    if (!shouldLoad) {
      setExploreSearchExperiences([]);
      setExploreSearchExperienceError('');
      return;
    }
    let cancelled = false;
    setExploreSearchExperienceLoading(true);
    setExploreSearchExperienceError('');
    api.getExploreExperiences(userLoc?.lat, userLoc?.lng, userLoc ? 45 : 100, 'viator', 16, exploreQuery)
      .then(res => {
        if (!cancelled) setExploreSearchExperiences(res.results ?? []);
      })
      .catch(() => {
        if (!cancelled) setExploreSearchExperienceError('Tours unavailable right now.');
      })
      .finally(() => {
        if (!cancelled) setExploreSearchExperienceLoading(false);
      });
    return () => { cancelled = true; };
  }, [tab, exploreCategory, exploreQuery, userLoc?.lat, userLoc?.lng]);

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
  const exploreHubMeta = useMemo(() => buildExploreHubMeta(enrichedExplorePlaces), [enrichedExplorePlaces]);
  const heroHeight = Math.max(480, Math.min(560, Math.round(windowHeight * 0.58)));
  const hasExploreQuery = exploreQuery.trim().length > 0;
  const showExperienceSearch = shouldSearchBookableExperiences(exploreQuery, exploreCategory);
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
    const placeQuery = showExperienceSearch ? placeQueryFromExploreQuery(query) : query;
    const queryCategory = exploreCategory === 'all' ? exploreCategoryFromQuery(query) : null;
    const filtered = places.filter(({ place }) => {
      if (exploreSavedOnly && !savedExploreIds.includes(place.id)) return false;
      if (!exploreSavedOnly && exploreHubMeta.parentByChildId.has(place.id)) return false;
      const categoryOk = exploreCategoryMatchesWithHub(place, exploreCategory, exploreHubMeta.categoryKeysByHubId);
      if (!categoryOk) return false;
      if (queryCategory && queryCategory !== 'tours' && !exploreCategoryMatchesWithHub(place, queryCategory, exploreHubMeta.categoryKeysByHubId)) return false;
      if (!placeQuery) return true;
      return Math.max(
        scoreExploreQuery(place, placeQuery),
        scoreExploreHubExtraText(place, placeQuery, exploreHubMeta.searchTextByHubId),
      ) > 0;
    });
    const decorated = filtered.map(item => ({
      ...item,
      queryScore: Math.max(
        scoreExploreQuery(item.place, placeQuery),
        scoreExploreHubExtraText(item.place, placeQuery, exploreHubMeta.searchTextByHubId),
      ),
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
  }, [enrichedExplorePlaces, exploreCategory, exploreHubMeta, exploreMode, exploreQuery, exploreSavedOnly, exploreSortMode, savedExploreIds, showExperienceSearch, userLoc?.lat, userLoc?.lng, waypoints]);

  useEffect(() => {
    setExploreVisibleLimit(EXPLORE_INITIAL_VISIBLE);
  }, [exploreCategory, exploreMode, exploreQuery, exploreSavedOnly, exploreSortMode]);

  const visibleRankedExplore = useMemo(
    () => rankedExplore.slice(0, exploreVisibleLimit),
    [rankedExplore, exploreVisibleLimit],
  );
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
  const exploreHomeCountLabel = useMemo(() => {
    if (!showExploreHome) return `${rankedExplore.length.toLocaleString()} places`;
    const count = (featuredLead ? 1 : 0)
      + trendingExplore.length
      + featuredSections.reduce((total, section) => total + section.rows.length, 0);
    return `${count.toLocaleString()} featured picks`;
  }, [featuredLead, featuredSections, rankedExplore.length, showExploreHome, trendingExplore.length]);
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
        note: item.description || item.kind || item.source_label || 'Explore detail',
        sourceLabel: item.source_label || item.source || selectedExplore?.source_pack?.primary,
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

  function showExperienceOnMap(experience: BookableExperience) {
    if (experience.lat == null || experience.lng == null) return;
    setPendingMapSelection({
      kind: 'place',
      place: {
        id: `experience:${experience.id}`,
        name: experience.title,
        lat: Number(experience.lat),
        lng: Number(experience.lng),
        icon: 'star',
        note: experience.summary || 'Bookable tour or local experience',
        createdAt: Date.now(),
      },
    });
    setSelectedExplore(null);
    router.push('/(tabs)/map');
  }

  function saveExperienceToPlanner(experience: BookableExperience) {
    if (!activeTrip) {
      showExperienceOnMap(experience);
      return;
    }
    const waypoint = {
      day: activeTrip.plan.waypoints[0]?.day ?? 1,
      name: experience.title,
      type: 'bookable_experience',
      description: experience.summary || experience.description || 'Partner experience saved for external checkout.',
      land_type: 'external_booking',
      notes: [
        experience.duration_label,
        experience.price_from ? `From ${experience.currency || 'USD'} ${experience.price_from}` : '',
        'Status: checkout with partner',
      ].filter(Boolean).join(' · '),
      lat: experience.lat ?? undefined,
      lng: experience.lng ?? undefined,
      verified_source: 'Viator',
      needs_review: true,
      verification_note: experience.booking_url || experience.affiliate_url || experience.source_url || '',
    };
    setActiveTrip({
      ...activeTrip,
      plan: {
        ...activeTrip.plan,
        waypoints: [...activeTrip.plan.waypoints, waypoint],
      },
      updated_at: Date.now(),
    });
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

  async function openExplorePlace(place: ExplorePlaceProfile, initialTab: ExploreDetailTab = 'summary') {
    setProfileReadMode(initialTab);
    const local = exploreTrailAreasById[place.id] ?? place;
    setSelectedExplore(local);
    if (!exploreWeatherById[local.id] && exploreWeatherLoadingId !== local.id) {
      fetchExploreWeather(local).catch(() => {});
    }
    if (!shouldUseExploreDetailEndpoint(place)) {
      if (shouldHydrateExploreTrailArea(local)) hydrateExploreTrailArea(local).catch(() => {});
      return;
    }
    try {
      const detail = await api.getExplorePlace(place.id);
      setExplorePlaces(prev => prev.map(item => item.id === detail.id ? detail : item));
      const hydrated = exploreTrailAreasById[detail.id] ?? detail;
      setSelectedExplore(current => current?.id === place.id ? hydrated : current);
      setProfileReadMode(initialTab);
      if (!exploreWeatherById[hydrated.id] && exploreWeatherLoadingId !== hydrated.id) {
        fetchExploreWeather(hydrated).catch(() => {});
      }
      if (shouldHydrateExploreTrailArea(hydrated)) hydrateExploreTrailArea(hydrated).catch(() => {});
    } catch {
      if (shouldHydrateExploreTrailArea(local)) hydrateExploreTrailArea(local).catch(() => {});
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

  function getExploreDetailWeather(place: ExplorePlaceProfile): ExploreDetailWeather | null {
    const weather = exploreWeatherById[place.id];
    const error = exploreWeatherErrors[place.id];
    const loading = exploreWeatherLoadingId === place.id;
    if (loading) {
      return { loading: true, icon: 'partly-sunny-outline', temp: 'Loading', detail: 'Forecast' };
    }
    if (error) {
      return { unavailable: true, icon: 'cloud-offline-outline', temp: 'Weather', detail: 'Unavailable' };
    }
    if (!weather) {
      return place.summary.lat != null && place.summary.lng != null
        ? { icon: 'partly-sunny-outline', temp: 'Weather', detail: 'Forecast' }
        : null;
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
        onOpen={() => openExplorePlace(place)}
        onArea={() => showExploreOnMap(place)}
        onRoute={() => routeExplore(place)}
        onNearby={() => openExplorePlace(place, 'nearby')}
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
          <TrailheadRailSkeleton label="Loading nearby options" count={3} cardWidth={190} style={s.campgroundLoadingSkeleton} />
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

  function renderExploreExperiences(place: ExplorePlaceProfile) {
    const experiences = exploreExperiencesById[place.id] ?? [];
    const loading = exploreExperienceLoadingId === place.id && experiences.length === 0;
    const error = exploreExperienceErrors[place.id];
    return (
      <ExploreExperiencesRail
        experiences={experiences}
        loading={loading}
        error={error}
        mediaUrl={mediaUrl}
        onSave={saveExperienceToPlanner}
        onShowArea={showExperienceOnMap}
      />
    );
  }

  function selectExploreHomeCategory(key: ExploreCategoryKey) {
    setExploreSavedOnly(false);
    if (key === 'nearby') {
      setExploreCategory('all');
      setExploreMode('nearby');
      return;
    }
    if (key === 'all') {
      setExploreMode(exploreMode === 'nearby' ? 'featured' : exploreMode);
      setExploreCategory('all');
      return;
    }
    setExploreMode(exploreMode === 'nearby' ? 'featured' : exploreMode);
    setExploreCategory(exploreCategory === key ? 'all' : key);
  }

  function cycleExploreSortMode() {
    setExploreSortMode(current => {
      if (current === 'best') return 'nearest';
      if (current === 'nearest') return 'source';
      return 'best';
    });
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
          onQueryChange={setExploreQuery}
          onClearQuery={() => setExploreQuery('')}
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
            <Text style={s.utilityKicker}>{isWeather ? 'TRIP WEATHER' : 'TRIP AUDIO'}</Text>
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
              mode={exploreMode}
              category={exploreCategory}
              savedOnly={exploreSavedOnly}
              shownCount={rankedExplore.length}
              sortMode={exploreSortMode}
              onModeChange={mode => {
                setExploreSavedOnly(false);
                setExploreMode(mode);
              }}
              onCategorySelect={selectExploreHomeCategory}
              onClearCategory={() => setExploreCategory('all')}
              onClearSaved={() => setExploreSavedOnly(false)}
              onSortCycle={cycleExploreSortMode}
            />

            {showExperienceSearch && (
              <ExploreExperiencesRail
                experiences={exploreSearchExperiences}
                loading={exploreSearchExperienceLoading}
                error={exploreSearchExperienceError}
                mediaUrl={mediaUrl}
                onSave={saveExperienceToPlanner}
                onShowArea={showExperienceOnMap}
              />
            )}

            {exploreMode === 'nearby' && (
              <View style={s.livePlacesBlock}>
                <View style={s.livePlacesTop}>
                  <Text style={s.livePlacesTitle}>LIVE PLACES NEAR YOU</Text>
                  {liveExploreLoading && <ActivityIndicator color={C.orange} size="small" />}
                </View>
                {liveExploreLoading && liveExplorePlaces.length === 0 ? (
                  <>
                    <TrailheadCardSkeleton media lines={2} style={s.livePlaceSkeleton} />
                    <TrailheadCardSkeleton media lines={2} style={s.livePlaceSkeleton} />
                  </>
                ) : null}
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

            <View style={s.exploreHomeHeading}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.exploreHomeTitle}>
                  {exploreMode === 'nearby'
                    ? 'Nearby Places'
                    : exploreMode === 'trip'
                      ? 'Along Your Trip'
                      : exploreSavedOnly
                        ? 'Saved Places'
                        : hasExploreQuery
                          ? 'Search Results'
                          : exploreCategory === 'all'
                            ? 'Featured Explorer Hubs'
                            : `${exploreCategoryLabel(exploreCategory)} Areas`}
                </Text>
                <Text style={s.exploreHomeCount}>{exploreHomeCountLabel}</Text>
              </View>
            </View>

            {exploreLoading && (
              <View style={s.exploreLoadingBlock}>
                <TrailheadLoadingRow
                  label="Ranking official sources"
                  sub="Loading parks, trails, stays, water, and route-ready Explore cards."
                  icon="sparkles-outline"
                />
                {explorePlaces.length === 0 ? (
                  <>
                    <TrailheadCardSkeleton media lines={3} />
                    <TrailheadCardSkeleton media lines={3} />
                    <TrailheadCardSkeleton media lines={3} />
                  </>
                ) : null}
              </View>
            )}
            {!!exploreError && explorePlaces.length === 0 && (
              <View style={s.emptyState}>
                <Ionicons name="cloud-offline-outline" size={44} color={C.text3} />
                <Text style={s.emptySub}>{exploreError}</Text>
              </View>
            )}
            {featuredSections.length > 0 ? (
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
                      <TouchableOpacity onPress={() => setExploreCategory('views')} activeOpacity={0.8}>
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
                    <Text style={s.exploreSectionTitle}>{section.label.toUpperCase()}</Text>
                    <TouchableOpacity onPress={() => setExploreCategory(section.key)}>
                      <Text style={s.exploreSectionLink}>VIEW ALL</Text>
                    </TouchableOpacity>
                  </View>
                  {section.rows.map((item, idx) => renderExploreCard(item, idx))}
                  <TouchableOpacity
                    style={s.exploreSectionMoreBtn}
                    onPress={() => setExploreCategory(section.key)}
                    activeOpacity={0.84}
                  >
                    <Text style={s.exploreSectionMoreText}>MORE {section.label.toUpperCase()}</Text>
                    <Ionicons name="arrow-forward" size={14} color={C.orange} />
                  </TouchableOpacity>
                </View>
                ))}
              </>
            ) : !exploreLoading && rankedExplore.length === 0 && (!showExperienceSearch || (!exploreSearchExperienceLoading && exploreSearchExperiences.length === 0)) ? (
              <View style={s.emptyState}>
                <Ionicons name={exploreSavedOnly ? 'bookmark-outline' : 'search-outline'} size={44} color={C.text3} />
                <Text style={s.emptyTitle}>{exploreSavedOnly ? 'No saved places yet' : 'No exact match'}</Text>
                <Text style={s.emptySub}>
                  {exploreSavedOnly
                    ? 'Save Explore cards to build a short list for your route.'
                    : 'Try camp, trail, viewpoint, waterfall, hut, fuel, tour, or hot spring.'}
                </Text>
              </View>
            ) : (
              <>
                {visibleRankedExplore.map((item, idx) => renderExploreCard(item, idx))}
                {visibleRankedExplore.length < rankedExplore.length && (
                  <TouchableOpacity
                    style={s.exploreLoadMoreBtn}
                    onPress={() => setExploreVisibleLimit(limit => limit + EXPLORE_VISIBLE_STEP)}
                  >
                    <Text style={s.exploreLoadMoreText}>
                      SHOW {Math.min(EXPLORE_VISIBLE_STEP, rankedExplore.length - visibleRankedExplore.length)} MORE
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
                  <Text style={s.exploreSectionTitle}>TRIP AUDIO</Text>
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
                <Ionicons name="map-outline" size={48} color={C.text3} />
                <Text style={s.emptyTitle}>No Active Trip</Text>
                <Text style={s.emptySub}>Plan a trip on the PLAN tab to unlock waypoint tools and narrations. Tours now live in Explore search and place details.</Text>
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
            experiencesSlot={renderExploreExperiences(selectedExplore)}
            trailStatusSlot={renderExploreTrailStatus(selectedExplore)}
            weather={getExploreDetailWeather(selectedExplore)}
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
            onSourcePackItem={showSourcePackItemOnMap}
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
  campgroundLoadingSkeleton: { paddingTop: 4 },
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
