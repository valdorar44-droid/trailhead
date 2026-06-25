/**
 * RouteSearchModal — full OsmAnd-style route search + destination picker.
 * Views: picker → searching → route-ready
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Keyboard, KeyboardAvoidingView, Platform, ActivityIndicator, useWindowDimensions,
  Modal, SafeAreaView, LayoutChangeEvent, Image, InteractionManager,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useStore, SavedPlace, MarkerGroup, TripHistoryItem } from '@/lib/store';
import { api, CampsitePin, Pin, type ExploreCatalogIndexItem } from '@/lib/api';
import { getOfflineTripSummaries, loadOfflineTrip } from '@/lib/offlineTrips';
import { useTheme, mono } from '@/lib/design';
import { TrailheadSheet } from '@/components/TrailheadUI';

export interface SearchPlace {
  name: string;
  lat: number;
  lng: number;
  isCurrentLocation?: boolean;
  dist?: number | null;
  id?: string;
  source?: string;
  source_label?: string;
  place_id?: string;
  provider_place_id?: string;
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
  mapbox_id?: string | null;
  mapbox_categories?: string[];
  icon?: string;
  summary?: string;
  _camp?: CampsitePin;
}

export interface RouteSearchModalProps {
  visible: boolean;
  mode?: 'browse' | 'route_pick';
  userLoc: { lat: number; lng: number } | null;
  camps: CampsitePin[];
  gas: { lat: number; lng: number; name: string }[];
  pois: SearchPlace[];
  communityPins: Pin[];
  routeOpts: { avoidHighways?: boolean; avoidTolls?: boolean; backRoads?: boolean };
  routeCoords?: [number, number][];  // [lng, lat] for elevation profile
  contextLoading?: boolean;
  extremeSearchEnabled?: boolean;
  onCampTap?: (camp: CampsitePin) => void;  // opens camp detail card
  onLoadSavedTrip?: (tripId: string) => void;  // load a previously planned trip
  onSelectDest: (place: SearchPlace) => void;
  onPreviewRoute?: (origin: SearchPlace, destination: SearchPlace) => void;
  onStartNav: () => void;
  onSelectOnMap: () => void;
  onClose: () => void;
  routeCard: SearchPlace | null;
  onClearRoute: () => void;
  onOpenRouteOpts: () => void;
}

type ModalView = 'picker' | 'searching' | 'route';
type SearchTab = 'history' | 'nearby' | 'categories';
type RouteEndpoint = 'origin' | 'destination';

// Overpass API categories — overlander-focused supply stops
const CATEGORIES = [
  { id: 'trails',    label: 'Trails in View', icon: 'trail-sign-outline',  color: '#f97316', tags: [
    ['highway','path'], ['highway','track'], ['tourism','viewpoint'], ['natural','peak'],
  ] as string[][] },
  { id: 'camps',     label: 'Camps Nearby',  icon: 'bonfire-outline',      color: '#14b8a6', tags: [
    ['tourism','camp_site'], ['tourism','caravan_site'], ['tourism','camp_pitch'],
    ['amenity','camping'],   ['tourism','wilderness_hut'], ['tourism','alpine_hut'],
    ['leisure','nature_reserve'], ['boundary','national_park'],
  ] as string[][] },
  { id: 'private_stays', label: 'Private Stays', icon: 'home-outline', color: '#0ea5e9', tags: [
    ['tourism','camp_site'], ['tourism','guest_house'], ['tourism','chalet'], ['tourism','apartment'],
  ] as string[][] },
  { id: 'fuel',      label: 'Fuel',          icon: 'flash-outline',        color: '#eab308', tags: [['amenity','fuel']] },
  { id: 'grocery',   label: 'Grocery',        icon: 'cart-outline',         color: '#22c55e', tags: [['shop','supermarket'],['shop','grocery'],['shop','convenience']] },
  { id: 'mechanic',  label: 'Mechanic',       icon: 'build-outline',        color: '#f97316', tags: [['shop','car_repair'],['shop','vehicle']] },
  { id: 'hardware',  label: 'Hardware',       icon: 'hammer-outline',       color: '#a78bfa', tags: [['shop','hardware'],['shop','doityourself']] },
  { id: 'propane',   label: 'Propane',        icon: 'flame-outline',        color: '#fb923c', tags: [['shop','gas'],['amenity','fuel']] },
  { id: 'tires',     label: 'Tires',          icon: 'settings-outline',     color: '#94a3b8', tags: [['shop','tyres'],['shop','car_parts']] },
  { id: 'camping',   label: 'Camping Gear',   icon: 'bonfire-outline',      color: '#14b8a6', tags: [['shop','outdoor'],['shop','sports']] },
  { id: 'laundry',   label: 'Laundry',        icon: 'water-outline',        color: '#38bdf8', tags: [['amenity','laundry'],['shop','laundry']] },
  { id: 'medical',   label: 'Medical',        icon: 'medkit-outline',       color: '#ef4444', tags: [['amenity','hospital'],['amenity','clinic'],['amenity','pharmacy']] },
  { id: 'parts',     label: 'Auto Parts',     icon: 'construct-outline',    color: '#f59e0b', tags: [['shop','car_parts'],['shop','auto']] },
  { id: 'water',     label: 'Water Fill',     icon: 'water',                color: '#06b6d4', tags: [['amenity','drinking_water'],['man_made','water_tap']] },
  { id: 'wifi',      label: 'WiFi / Library', icon: 'wifi-outline',         color: '#8b5cf6', tags: [['amenity','library'],['amenity','cafe']] },
] as const;

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function fmtDist(km: number) {
  const mi = km * 0.621371;
  if (mi < 0.1) return `${Math.round(mi * 5280)} ft`;
  if (mi < 10) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi)} mi`;
}

const NEARBY_RADIUS_MI = 45;
const DEFAULT_CATEGORY_RADIUS_MI = 25;
const WIDE_CATEGORY_RADIUS_MI = 45;

function distanceMi(origin: { lat: number; lng: number }, point: { lat: number; lng: number }) {
  return haversineKm(origin, point) * 0.621371;
}

function hasUsableCoordinate(place: { lat?: number; lng?: number } | null | undefined) {
  return !!place
    && Number.isFinite(place.lat)
    && Number.isFinite(place.lng)
    && Math.abs(place.lat as number) <= 90
    && Math.abs(place.lng as number) <= 180;
}

function scopedNearby<T extends { lat: number; lng: number; name?: string }>(
  origin: { lat: number; lng: number },
  items: T[],
  radiusMi: number,
  label: (item: T) => string,
): SearchPlace[] {
  return items
    .filter(item => item?.lat != null && item?.lng != null && Number.isFinite(item.lat) && Number.isFinite(item.lng))
    .map(item => ({ name: label(item), lat: item.lat, lng: item.lng, dist: haversineKm(origin, item) }))
    .filter(item => item.dist != null && item.dist * 0.621371 <= radiusMi)
    .sort((a, b) => (a.dist ?? 999) - (b.dist ?? 999));
}

function dedupePlaces<T extends SearchPlace>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = `${item.name.toLowerCase().trim()}:${item.lat.toFixed(4)}:${item.lng.toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isTemporaryMapboxPlace(place: SearchPlace | null | undefined) {
  return place?.source === 'mapbox_search' || place?.source_label === 'Mapbox Search' || place?.attribution === 'Mapbox';
}

function categoryTypes(catId: string) {
  const map: Record<string, string[]> = {
    fuel: ['fuel', 'propane'],
    propane: ['propane', 'fuel'],
    water: ['water'],
    grocery: ['grocery'],
    mechanic: ['mechanic'],
    hardware: ['hardware'],
    tires: ['mechanic', 'parts'],
    parts: ['parts', 'mechanic'],
    trails: ['trail', 'trailhead', 'viewpoint', 'peak', 'hot_spring'],
    camping: ['camping'],
    private_stays: ['private_stay', 'farm_stay', 'ranch', 'winery', 'glamping', 'private_camp'],
    laundry: ['laundromat'],
    medical: ['medical'],
    wifi: ['wifi', 'food'],
  };
  return map[catId] ?? [catId];
}

function parseCoordinateQuery(raw: string): { lat: number; lng: number; name: string } | null {
  const nums = raw.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (nums.length < 2) return null;
  const [a, b] = nums;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  let lat: number;
  let lng: number;
  if (Math.abs(a) <= 90 && Math.abs(b) <= 180) {
    lat = a; lng = b; // common "lat, lng"
  } else if (Math.abs(a) <= 180 && Math.abs(b) <= 90) {
    lng = a; lat = b; // "lng, lat"
  } else {
    return null;
  }

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return {
    lat,
    lng,
    name: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
  };
}

function normalizeSearchText(raw: string) {
  return String(raw || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function exploreItemToSearchPlace(item: ExploreCatalogIndexItem, userLoc: { lat: number; lng: number } | null): SearchPlace | null {
  const lat = Number(item.lat);
  const lng = Number(item.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const title = (item.title || item.card?.title || item.card?.headline || 'Trailhead place').trim();
  const region = [item.region, item.category || item.v3_category].filter(Boolean).join(' · ');
  const type = String(item.explore_group || item.v3_category || item.category || 'place').toLowerCase().replace(/[^a-z0-9_]+/g, '_');
  return {
    id: item.id,
    place_id: item.id,
    provider_place_id: item.id,
    name: title,
    lat,
    lng,
    dist: userLoc ? haversineKm(userLoc, { lat, lng }) : null,
    source: 'trailhead_explore',
    source_label: item.verified ? 'Trailhead verified' : 'Trailhead Explore',
    type,
    subtype: region || undefined,
    address: region || undefined,
    photo_url: item.thumbnail_url || item.image_url || item.media?.find(media => media.url)?.url || null,
    website: item.source_url || item.sources?.find(source => source.url)?.url,
    attribution: item.source_title || item.quality || item.source_quality || 'Trailhead Explore',
    icon: type.includes('trail') ? 'trail' : type.includes('camp') ? 'camp' : 'pin',
    summary: item.short_description || item.hook || item.card?.summary || item.card?.highlight,
  };
}

function exploreSearchScore(place: SearchPlace, query: string) {
  const q = normalizeSearchText(query);
  const name = normalizeSearchText(place.name);
  const meta = normalizeSearchText(`${place.subtype || ''} ${place.address || ''} ${place.summary || ''}`);
  if (!q) return 0;
  let score = 0;
  if (name === q) score += 120;
  if (name.startsWith(q)) score += 90;
  if (name.includes(q)) score += 70;
  const terms = q.split(/\s+/).filter(Boolean);
  score += terms.filter(term => name.includes(term)).length * 12;
  score += terms.filter(term => meta.includes(term)).length * 4;
  if (place.source === 'trailhead_explore') score += 35;
  if (place.source === 'mapbox_search') score += 8;
  if (place.dist != null) score -= Math.min(place.dist, 2000) / 500;
  return score;
}

function dedupeSearchResults<T extends SearchPlace>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const source = String(item.source || '').toLowerCase();
    const name = normalizeSearchText(item.name);
    const key = source === 'trailhead_explore' && name
      ? `trailhead:${name}`
      : `${name}:${Number(item.lat).toFixed(4)}:${Number(item.lng).toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Elevation profile ─────────────────────────────────────────────────────────
// Fetches SRTM elevation for sampled route coords, renders as bar chart.
// Uses OpenTopoData (free, no key). Styled in Trailhead orange — not a copy of OsmAnd.
function ElevationProfile({ coords }: { coords: [number, number][] }) {
  const C = useTheme();
  const [elevs, setElevs] = useState<number[] | null>(null);
  const [chartW, setChartW] = useState(0);

  useEffect(() => {
    if (!coords || coords.length < 2) return;
    const SAMPLES = 40;
    const step = Math.max(1, Math.floor(coords.length / SAMPLES));
    const pts = Array.from({ length: SAMPLES }, (_, i) => coords[Math.min(i * step, coords.length - 1)]);
    const locs = pts.map(([lng, lat]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join('|');
    fetch(`https://api.opentopodata.org/v1/srtm30m?locations=${locs}`)
      .then(r => r.json())
      .then(d => {
        if (d.results) setElevs(d.results.map((r: any) => r.elevation ?? 0));
      })
      .catch(() => {});
  }, [coords]);

  if (!elevs || elevs.length < 2 || chartW === 0) {
    return (
      <View onLayout={(e: LayoutChangeEvent) => setChartW(e.nativeEvent.layout.width)}
        style={[epS.wrap, { backgroundColor: C.s2 }]}>
        {!elevs && <ActivityIndicator size="small" color={C.orange} style={{ alignSelf: 'center' }} />}
      </View>
    );
  }

  const minE = Math.min(...elevs);
  const maxE = Math.max(...elevs);
  const rangeE = Math.max(maxE - minE, 1);
  const maxBarH = 44;
  const barW = chartW / elevs.length;

  // Compute ascent/descent
  let ascent = 0, descent = 0;
  for (let i = 1; i < elevs.length; i++) {
    const d = elevs[i] - elevs[i - 1];
    if (d > 0) ascent += d; else descent -= d;
  }
  const toFt = (m: number) => `${Math.round(m * 3.28084).toLocaleString()} ft`;
  const minFt = toFt(minE); const maxFt = toFt(maxE);

  return (
    <View onLayout={(e: LayoutChangeEvent) => setChartW(e.nativeEvent.layout.width)} style={[epS.wrap, { backgroundColor: C.s2 }]}>
      {/* Stats row */}
      <View style={epS.statsRow}>
        <View style={epS.stat}>
          <Text style={[epS.statIcon, { color: C.orange }]}>↑</Text>
          <Text style={[epS.statVal, { color: C.text2 }]}>{toFt(ascent)}</Text>
        </View>
        <View style={epS.stat}>
          <Text style={[epS.statIcon, { color: C.sage }]}>↓</Text>
          <Text style={[epS.statVal, { color: C.text2 }]}>{toFt(descent)}</Text>
        </View>
        <View style={epS.stat}>
          <Text style={[epS.statLabel, { color: C.text3 }]}>LOW</Text>
          <Text style={[epS.statVal, { color: C.text2 }]}>{minFt}</Text>
        </View>
        <View style={epS.stat}>
          <Text style={[epS.statLabel, { color: C.text3 }]}>HIGH</Text>
          <Text style={[epS.statVal, { color: C.text2 }]}>{maxFt}</Text>
        </View>
      </View>
      {/* Chart */}
      <View style={[epS.chart, { height: maxBarH + 4 }]}>
        {elevs.map((e, i) => {
          const pct = (e - minE) / rangeE;
          const h = Math.max(3, pct * maxBarH);
          // Color: low=#1e4060, high=#f5a623 — Trailhead's orange-to-teal gradient
          const r = Math.round(30  + pct * (245 - 30));
          const g = Math.round(64  + pct * (164 - 64));
          const b = Math.round(96  + pct * (35  - 96));
          return (
            <View key={i} style={{ width: barW - 1, height: h, backgroundColor: `rgb(${r},${g},${b})`,
              alignSelf: 'flex-end', borderTopLeftRadius: 2, borderTopRightRadius: 2 }} />
          );
        })}
      </View>
    </View>
  );
}
const epS = StyleSheet.create({
  wrap: { marginHorizontal: 16, marginTop: 6, borderRadius: 12, padding: 12, minHeight: 60 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 8 },
  stat: { alignItems: 'center' },
  statIcon: { fontSize: 14, fontWeight: '700' },
  statLabel: { fontSize: 9, fontFamily: mono, fontWeight: '700' },
  statVal: { fontSize: 11, fontFamily: mono, marginTop: 1 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 1, overflow: 'hidden' },
});

const ICON_COLORS: Record<string, string> = {
  star: '#f5a623', camp: '#14b8a6', flag: '#ef4444',
  water: '#38bdf8', fuel: '#eab308', pin: '#a855f7', trail: '#f97316',
};
const ICON_NAMES: Record<string, any> = {
  star: 'star', camp: 'bonfire-outline', flag: 'flag',
  water: 'water', fuel: 'car-sport-outline', pin: 'location', trail: 'trail-sign-outline',
};
const GROUP_ICONS = ['flag', 'star', 'bonfire-outline', 'water', 'car-sport-outline', 'leaf-outline', 'camera-outline', 'shield-outline'];
const GROUP_COLORS = ['#ef4444', '#f5a623', '#14b8a6', '#38bdf8', '#eab308', '#22c55e', '#a855f7', '#6366f1'];

export default function RouteSearchModal({
  visible, mode = 'route_pick', userLoc, camps, gas, pois, communityPins, routeOpts, routeCoords, contextLoading = false,
  extremeSearchEnabled = false,
  onCampTap, onLoadSavedTrip, onSelectDest, onPreviewRoute, onStartNav, onSelectOnMap, onClose,
  routeCard, onClearRoute, onOpenRouteOpts,
}: RouteSearchModalProps) {
  const C = useTheme();
  const s = styles(C);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const bottomPad = Math.max(insets.bottom, Platform.OS === 'android' ? 16 : 18);
  const searchModalTopPad = Platform.OS === 'android' ? Math.max(insets.top + 12, 36) : 0;
  const sheetMaxHeight = Math.min(height * (Platform.OS === 'android' ? 0.84 : 0.78), height - Math.max(insets.top + 36, 72));

  const savedPlaces   = useStore(st => st.savedPlaces);
  const markerGroups  = useStore(st => st.markerGroups);
  const searchHistory = useStore(st => st.searchHistory);
  const favoriteCamps = useStore(st => st.favoriteCamps);
  const tripHistory   = useStore(st => st.tripHistory);
  const addSavedPlace    = useStore(st => st.addSavedPlace);
  const removeSavedPlace = useStore(st => st.removeSavedPlace);
  const addMarkerGroup   = useStore(st => st.addMarkerGroup);
  const updateMarkerGroup = useStore(st => st.updateMarkerGroup);
  const removeMarkerGroup = useStore(st => st.removeMarkerGroup);
  const addSearchHistory  = useStore(st => st.addSearchHistory);
  const clearSearchHistory = useStore(st => st.clearSearchHistory);

  const [view, setView]           = useState<ModalView>('picker');
  const [tab, setTab]             = useState<SearchTab>('history');
  const [query, setQuery]         = useState('');
  const [activeEndpoint, setActiveEndpoint] = useState<RouteEndpoint>('destination');
  const [routeOrigin, setRouteOrigin] = useState<SearchPlace | null>(null);
  const [results, setResults]     = useState<SearchPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [catResults, setCatResults] = useState<SearchPlace[]>([]);
  const [catSearching, setCatSearching] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupColor, setNewGroupColor] = useState(GROUP_COLORS[0]);
  const [newGroupIcon, setNewGroupIcon] = useState(GROUP_ICONS[0]);
  const [offlineTrips, setOfflineTrips] = useState<Array<{ trip_id: string; plan: { trip_name: string; states?: string[]; duration_days?: number } }>>([]);
  const inputRef = useRef<TextInput>(null);
  const currentLocationPlace = userLoc ? {
    name: 'My Location',
    lat: userLoc.lat,
    lng: userLoc.lng,
    isCurrentLocation: true,
  } : null;
  const activeOrigin = routeOrigin ?? currentLocationPlace;

  // Switch to route view when a route card arrives
  useEffect(() => {
    if (routeCard && visible) setView('route');
  }, [routeCard, visible]);

  // Reset to picker when modal opens fresh with no route
  useEffect(() => {
    if (visible && !routeCard) { setView('picker'); setQuery(''); setResults([]); }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    if (currentLocationPlace && (!routeOrigin || routeOrigin.isCurrentLocation)) setRouteOrigin(currentLocationPlace);
  }, [visible, userLoc?.lat, userLoc?.lng]);

  useEffect(() => {
    if (!visible) return;
    getOfflineTripSummaries()
      .then(trips => setOfflineTrips(trips.map(t => ({
        trip_id: t.trip_id,
        plan: {
          trip_name: (t.plan.trip_name || '').trim() || (t.trip_id.startsWith('manual_') ? 'Manual Route' : 'Downloaded Trip'),
          states: t.plan.states,
          duration_days: t.plan.duration_days,
        },
      }))))
      .catch(() => setOfflineTrips([]));
  }, [visible]);

  const focusSearchInput = useCallback(() => {
    const delays = Platform.OS === 'android' ? [80, 220, 420] : [60, 160];
    inputRef.current?.focus();
    delays.forEach(delay => {
      setTimeout(() => inputRef.current?.focus(), delay);
    });
  }, []);

  useEffect(() => {
    if (!visible || view !== 'searching') return;
    const interaction = InteractionManager.runAfterInteractions(() => {
      focusSearchInput();
    });
    return () => interaction.cancel();
  }, [focusSearchInput, visible, view]);

  const mapContextPlaceToPlace = useCallback((place: any): SearchPlace | null => {
    const lat = Number(place?.lat);
    const lng = Number(place?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return {
      name: String(place.name || 'Mapbox place'),
      lat,
      lng,
      dist: userLoc ? haversineKm(userLoc, { lat, lng }) : null,
      source: 'mapbox_search',
      source_label: 'Mapbox Search',
      place_id: place.place_id || place.mapbox_id || place.id,
      provider_place_id: place.provider_place_id || place.mapbox_id || place.id,
      type: place.type || place.feature_type || place.mapbox_categories?.[0] || 'poi',
      address: place.address,
      attribution: 'Mapbox',
      mapbox_id: place.mapbox_id,
      mapbox_categories: place.mapbox_categories || place.categories,
      rating: place.rating,
      rating_count: place.rating_count,
      phone: place.phone,
      website: place.website,
    };
  }, [userLoc]);

  const searchExtremePlaces = useCallback(async (text: string) => {
    const proximity = userLoc ? `${userLoc.lng},${userLoc.lat}` : '';
    const data = await api.mapContextSearch({
      q: text,
      category: 'poi',
      center: userLoc || undefined,
      proximity,
      origin: proximity,
      limit: 6,
      language: 'en',
      metadata: { surface: 'route_search_modal', source: 'route_search_text' },
    });
    return dedupePlaces((data.places ?? []).map(mapContextPlaceToPlace).filter(Boolean) as SearchPlace[])
      .filter(hasUsableCoordinate)
      .sort((a, b) => (a.dist ?? 9999) - (b.dist ?? 9999));
  }, [mapContextPlaceToPlace, userLoc]);

  const searchExplorePlaces = useCallback(async (text: string) => {
    const clean = text.trim();
    if (clean.length < 2) return [] as SearchPlace[];
    const index = await api.getExploreCatalogIndex({ q: clean, limit: 12 }).catch(() => null);
    return (index?.places ?? [])
      .map(item => exploreItemToSearchPlace(item, userLoc))
      .filter(Boolean)
      .filter(hasUsableCoordinate) as SearchPlace[];
  }, [userLoc]);

  const searchFallbackPlaces = useCallback(async (text: string) => {
    const places = await api.geocodePlaces(text.trim(), 8).catch(() => []);
    return places
      .map(place => {
        const sourceLabel = place.source_label && !/mapbox/i.test(place.source_label)
          ? place.source_label
          : 'Map result';
        return {
          name: place.name,
          lat: place.lat,
          lng: place.lng,
          dist: userLoc ? haversineKm(userLoc, place) : null,
          source: place.source,
          source_label: sourceLabel,
          place_id: place.place_id,
          provider_place_id: place.provider_place_id,
          type: place.feature_type || place.category || 'poi',
          address: [place.region, place.country].filter(Boolean).join(', ') || undefined,
        };
      })
      .filter(hasUsableCoordinate)
      .sort((a, b) => (a.dist ?? 9999) - (b.dist ?? 9999));
  }, [userLoc]);

  const searchExtremeCategory = useCallback(async (catId: string) => {
    if (!extremeSearchEnabled || !userLoc) return [] as SearchPlace[];
    const categoryMap: Record<string, string> = {
      camps: 'campground',
      private_stays: 'campground',
      fuel: 'gas station',
      grocery: 'grocery',
      mechanic: 'mechanic',
      hardware: 'hardware',
      propane: 'propane',
      tires: 'tire shop',
      parts: 'auto parts',
      trails: 'trailhead',
      camping: 'outdoor gear',
      laundry: 'laundry',
      medical: 'pharmacy',
      water: 'drinking water',
      wifi: 'library',
    };
    const data = await api.mapContextSearch({
      category: categoryMap[catId] ?? catId,
      center: userLoc,
      proximity: `${userLoc.lng},${userLoc.lat}`,
      limit: 10,
      language: 'en',
      metadata: { surface: 'route_search_modal', source: 'route_search_category', category: catId },
    });
    return (data.places ?? [])
      .map(mapContextPlaceToPlace)
      .filter(Boolean)
      .filter(hasUsableCoordinate) as SearchPlace[];
  }, [extremeSearchEnabled, mapContextPlaceToPlace, userLoc]);

  const doSearch = useCallback(async () => {
    if (!query.trim()) return;
    const coord = parseCoordinateQuery(query);
    if (coord) {
      const dist = userLoc ? haversineKm(userLoc, coord) : null;
      setResults([{ ...coord, dist }]);
      setView('searching');
      return;
    }
    setSearching(true);
    try {
      const cleanQuery = query.trim();
      const explorePlaces = await searchExplorePlaces(cleanQuery);
      let providerPlaces: SearchPlace[] = [];
      if (extremeSearchEnabled) {
        providerPlaces = await searchExtremePlaces(cleanQuery).catch(() => []);
      } else {
        providerPlaces = await searchFallbackPlaces(cleanQuery);
      }
      const fallbackPlaces = extremeSearchEnabled && providerPlaces.length < 4
        ? await searchFallbackPlaces(cleanQuery)
        : [];
      setResults(dedupeSearchResults([...explorePlaces, ...providerPlaces, ...fallbackPlaces])
        .sort((a, b) => {
          const scoreDelta = exploreSearchScore(b, query) - exploreSearchScore(a, query);
          if (Math.abs(scoreDelta) > 0.01) return scoreDelta;
          return (a.dist ?? 9999) - (b.dist ?? 9999);
        })
        .slice(0, 18));
    } catch { setResults([]); }
    setSearching(false);
  }, [query, userLoc, extremeSearchEnabled, searchExtremePlaces, searchExplorePlaces, searchFallbackPlaces]);

  const pickCategory = useCallback(async (catId: string) => {
    setActiveCat(catId);
    setCatResults([]);
    if (!userLoc) return;
    const cat = CATEGORIES.find(c => c.id === catId);
    if (!cat) return;
    setCatSearching(true);
    try {
      const radiusMi = ['camps', 'private_stays', 'fuel', 'propane', 'mechanic', 'hardware', 'tires', 'parts', 'camping', 'medical'].includes(catId)
        ? WIDE_CATEGORY_RADIUS_MI
        : DEFAULT_CATEGORY_RADIUS_MI;
      const extremeCategoryResults = await searchExtremeCategory(catId).catch(() => [] as SearchPlace[]);
      if (catId === 'fuel') {
        const loadedFuel = scopedNearby(userLoc, gas, radiusMi, g => g.name || 'Fuel');
        const liveFuel = await api.getGas(userLoc.lat, userLoc.lng, radiusMi);
        setCatResults(dedupePlaces([...extremeCategoryResults, ...loadedFuel, ...liveFuel
          .map(g => ({
            name: g.name || 'Fuel',
            lat: g.lat,
            lng: g.lng,
            dist: haversineKm(userLoc, g),
          }))
          .filter(g => Number.isFinite(g.lat) && Number.isFinite(g.lng) && distanceMi(userLoc, g) <= radiusMi)])
          .sort((a, b) => (a.dist ?? 999) - (b.dist ?? 999))
          .slice(0, 30));
        return;
      }
      if (catId === 'water') {
        const loadedWater = pois
          .filter(p => p.type === 'water' && distanceMi(userLoc, p) <= radiusMi)
          .map(p => ({ ...p, name: p.name || (p.subtype === 'fountain' ? 'Fountain' : 'Water Source'), dist: haversineKm(userLoc, p) }));
        const liveWater = await api.getOsmPois(userLoc.lat, userLoc.lng, radiusMi, 'water');
        setCatResults(dedupePlaces([...extremeCategoryResults, ...loadedWater, ...liveWater
          .map(p => ({
            name: p.name || (p.subtype === 'fountain' ? 'Fountain' : 'Water Source'),
            lat: p.lat,
            lng: p.lng,
            dist: haversineKm(userLoc, p),
            id: p.id,
            source: p.source,
            source_label: p.source_label,
            type: p.type,
            subtype: p.subtype,
            photo_url: p.photo_url,
          }))
          .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng) && distanceMi(userLoc, p) <= radiusMi)])
          .sort((a, b) => (a.dist ?? 999) - (b.dist ?? 999))
          .slice(0, 30));
        return;
      }
      if (catId === 'camps') {
        const localCamps = (camps ?? [])
          .filter(c => c.lat && c.lng && distanceMi(userLoc, c) <= radiusMi)
          .map(c => ({ name: c.name || 'Camp', lat: c.lat, lng: c.lng, dist: haversineKm(userLoc, c), _camp: c }));
        const liveCamps = await api.getNearbyCamps(userLoc.lat, userLoc.lng, radiusMi, []);
        setCatResults(dedupePlaces([...extremeCategoryResults, ...localCamps, ...liveCamps
          .filter(c => c.lat && c.lng && distanceMi(userLoc, c) <= radiusMi)
          .map(c => ({ name: c.name || 'Camp', lat: c.lat, lng: c.lng, dist: haversineKm(userLoc, c), _camp: c }))] as any)
          .sort((a, b) => (a.dist ?? 999) - (b.dist ?? 999))
          .slice(0, 30));
      } else if (catId === 'private_stays') {
        const types = categoryTypes(catId);
        const localPlaces = pois
          .filter(p => types.includes(p.type || '') && distanceMi(userLoc, p) <= radiusMi)
          .map(p => ({ ...p, name: p.name || 'Private Stay', dist: haversineKm(userLoc, p) }));
        const liveCamps = await api.getNearbyCamps(userLoc.lat, userLoc.lng, radiusMi, ['private', 'farm', 'ranch', 'winery', 'glamping', 'private_camp']);
        const livePlaces = await api.getNearbyPlaces(userLoc.lat, userLoc.lng, radiusMi, types.join(','));
        setCatResults(dedupePlaces([
          ...extremeCategoryResults,
          ...liveCamps
            .filter(c => c.lat && c.lng && distanceMi(userLoc, c) <= radiusMi)
            .map(c => ({ name: c.name || 'Private Stay', lat: c.lat, lng: c.lng, dist: haversineKm(userLoc, c), _camp: c, type: 'private_stay', source: c.source, source_label: c.source_badge || c.verified_source })),
          ...localPlaces,
          ...livePlaces
            .filter(p => p.lat != null && p.lng != null && distanceMi(userLoc, p) <= radiusMi)
            .map(p => ({
              name: p.name || p.type.replace('_', ' '),
              lat: p.lat,
              lng: p.lng,
              dist: haversineKm(userLoc, p),
              id: p.id,
              source: p.source,
              source_label: p.source_label,
              place_id: p.place_id,
              provider_place_id: p.provider_place_id,
              type: p.type,
              subtype: p.subtype,
              address: p.address,
              phone: p.phone,
              website: p.website,
              open_now: p.open_now,
              rating: p.rating,
              rating_count: p.rating_count,
              photo_url: p.photo_url,
              google_maps_uri: p.google_maps_uri,
              attribution: p.attribution,
            })),
        ]).sort((a, b) => (a.dist ?? 999) - (b.dist ?? 999)).slice(0, 30));
      } else {
        const types = categoryTypes(catId);
        const local = pois
          .filter(p => types.includes(p.type || '') && distanceMi(userLoc, p) <= radiusMi)
          .map(p => ({ ...p, name: p.name || (p.type || 'place').replace('_', ' '), dist: haversineKm(userLoc, p) }));
        const exploreTrails = catId === 'trails'
          ? ((await api.getExploreCatalogIndex({ category: 'trails', limit: 120 }).catch(() => null))?.places ?? [])
            .map(item => exploreItemToSearchPlace(item, userLoc))
            .filter((place): place is SearchPlace => !!place)
            .filter(hasUsableCoordinate)
            .filter(place => distanceMi(userLoc, place) <= radiusMi)
          : [];
        const live = await api.getNearbyPlaces(userLoc.lat, userLoc.lng, radiusMi, types.join(','));
        setCatResults(dedupePlaces([...extremeCategoryResults, ...exploreTrails, ...local, ...live
          .filter(p => p.lat != null && p.lng != null && distanceMi(userLoc, p) <= radiusMi)
            .map(p => ({
              name: p.name || p.type.replace('_', ' '),
              lat: p.lat,
              lng: p.lng,
              dist: haversineKm(userLoc, p),
              id: p.id,
              source: p.source,
              source_label: p.source_label,
              place_id: p.place_id,
              provider_place_id: p.provider_place_id,
              type: p.type,
              subtype: p.subtype,
              address: p.address,
              phone: p.phone,
              website: p.website,
              open_now: p.open_now,
              rating: p.rating,
              rating_count: p.rating_count,
              photo_url: p.photo_url,
              google_maps_uri: p.google_maps_uri,
              attribution: p.attribution,
            }))])
          .sort((a, b) => (a.dist ?? 999) - (b.dist ?? 999))
          .slice(0, 30));
      }
    } catch {
      setCatResults([]);
    } finally {
      setCatSearching(false);
    }
  }, [userLoc, camps, gas, pois, searchExtremeCategory]);

  const previewRoute = useCallback((origin: SearchPlace | null, destination: SearchPlace) => {
    const previewOrigin = origin ?? currentLocationPlace;
    if (!previewOrigin) {
      onSelectDest(destination);
      return;
    }
    if (onPreviewRoute) onPreviewRoute(previewOrigin, destination);
    else onSelectDest(destination);
  }, [currentLocationPlace, onPreviewRoute, onSelectDest]);

  const selectPlace = useCallback((place: SearchPlace) => {
    if (!hasUsableCoordinate(place)) return;
    if (!isTemporaryMapboxPlace(place)) {
      addSearchHistory({ name: place.name, lat: place.lat, lng: place.lng, searchedAt: Date.now() });
    }
    if (mode === 'browse') {
      onSelectDest(place);
      setQuery('');
      setResults([]);
      setCatResults([]);
      setActiveCat(null);
      return;
    }
    if (activeEndpoint === 'origin') {
      setRouteOrigin(place);
      if (routeCard) previewRoute(place, routeCard);
    } else {
      previewRoute(activeOrigin, place);
    }
    setQuery('');
    setResults([]);
    setView('route');
  }, [activeEndpoint, activeOrigin, addSearchHistory, mode, onSelectDest, previewRoute, routeCard]);

  const saveCurrentPlace = useCallback((place: SearchPlace) => {
    if (isTemporaryMapboxPlace(place)) return;
    const p: SavedPlace = {
      id: `sp_${Date.now()}`,
      name: place.name.split(',')[0],
      lat: place.lat, lng: place.lng,
      icon: 'star', createdAt: Date.now(),
    };
    addSavedPlace(p);
  }, [addSavedPlace]);

  const createGroup = () => {
    if (!newGroupName.trim()) return;
    addMarkerGroup({
      id: `mg_${Date.now()}`,
      name: newGroupName.trim(),
      color: newGroupColor,
      icon: newGroupIcon,
      visible: true,
      createdAt: Date.now(),
    });
    setNewGroupName(''); setShowCreateGroup(false);
  };

  const nearbyPlaces = userLoc ? dedupePlaces([
    ...camps
      .filter(c => c.lat && c.lng && distanceMi(userLoc, c) <= NEARBY_RADIUS_MI)
      .map(c => ({ name: c.name || 'Camp', lat: c.lat, lng: c.lng, dist: haversineKm(userLoc, c), icon: 'camp', type: 'camp', photo_url: (c as any).photo_url, _camp: c })),
    ...gas
      .filter(g => g.lat && g.lng && distanceMi(userLoc, g) <= NEARBY_RADIUS_MI)
      .map(g => ({ name: g.name || 'Fuel', lat: g.lat, lng: g.lng, dist: haversineKm(userLoc, g), icon: 'fuel', type: 'fuel' })),
    ...pois
      .filter(p => p.lat && p.lng && distanceMi(userLoc, p) <= NEARBY_RADIUS_MI)
      .map(p => ({ ...p, name: p.name || (p.type || 'place').replace('_', ' '), dist: haversineKm(userLoc, p), icon: p.type === 'trail' || p.type === 'trailhead' ? 'trail' : 'pin' })),
  ] as SearchPlace[]).sort((a, b) => (a.dist ?? 9999) - (b.dist ?? 9999)).slice(0, 18) : [];

  if (!visible) return null;

  // ── View: Searching ─────────────────────────────────────────────────────────
  if (view === 'searching') {
    const grouped = searchHistory.reduce((acc, h) => {
      const d = new Date(h.searchedAt);
      const today = new Date();
      const isToday = d.toDateString() === today.toDateString();
      const key = isToday ? 'TODAY' : d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();
      if (!acc[key]) acc[key] = [];
      acc[key].push(h);
      return acc;
    }, {} as Record<string, typeof searchHistory>);

    return (
      <Modal visible animationType="slide" transparent={false} statusBarTranslucent onShow={focusSearchInput}>
        <SafeAreaView style={{ flex: 1, backgroundColor: C.bg, paddingTop: searchModalTopPad }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'android' ? searchModalTopPad : 0}
          style={{ flex: 1 }}
        >
        <View style={s.searchingSheet}>
          {/* Search input row */}
          <View style={s.searchInputRow}>
            <TouchableOpacity onPress={() => { Keyboard.dismiss(); setView('picker'); setQuery(''); setResults([]); setActiveCat(null); setCatResults([]); }} style={{ padding: 4 }}>
              <Ionicons name="arrow-back" size={20} color={C.text2} />
            </TouchableOpacity>
            <TextInput ref={inputRef} style={s.searchInput} value={query} onChangeText={setQuery}
              onPressIn={focusSearchInput}
              onSubmitEditing={() => { Keyboard.dismiss(); doSearch(); }}
              placeholder={activeEndpoint === 'origin' ? 'Start address or place' : 'Destination address or place'} placeholderTextColor={C.text3}
              returnKeyType="search" blurOnSubmit autoFocus showSoftInputOnFocus />
            {searching
              ? <ActivityIndicator size="small" color={C.orange} />
                : <TouchableOpacity onPress={() => { Keyboard.dismiss(); setView('picker'); setQuery(''); setResults([]); setActiveCat(null); setCatResults([]); }}>
                  <Text style={s.hideBtn}>Hide</Text>
                </TouchableOpacity>
            }
          </View>

          {/* Tabs */}
          {results.length === 0 && (
            <View style={s.tabRow}>
              {(['history', 'nearby', 'categories'] as SearchTab[]).map(t => (
                <TouchableOpacity key={t} style={[s.tab, tab === t && s.tabActive]}
                  onPress={() => { setTab(t); setActiveCat(null); setCatResults([]); }}>
                  <Text style={[s.tabText, tab === t && s.tabTextActive]}>
                    {t === 'history' ? 'History' : t === 'nearby' ? 'Nearby' : 'Categories'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            style={{ flex: 1 }}
            contentContainerStyle={[s.searchScrollContent, { paddingBottom: bottomPad + (Platform.OS === 'android' ? 96 : 24) }]}
          >
            {/* Search results */}
            {results.length > 0 && results.map((r, i) => (
              <TouchableOpacity key={i} style={s.resultRow} onPress={() => selectPlace(r)}>
                <View style={s.resultIcon}><Ionicons name="location" size={14} color={C.orange} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.resultName} numberOfLines={1}>{r.name.split(',')[0]}</Text>
                  <Text style={s.resultSub} numberOfLines={1}>
                    {r.address || r.subtype || r.source_label || r.name.split(',').slice(1, 3).join(',').trim()}
                  </Text>
                </View>
                {r.dist != null && <Text style={s.resultDist}>{fmtDist(r.dist)}</Text>}
                {!isTemporaryMapboxPlace(r) && (
                  <TouchableOpacity onPress={() => saveCurrentPlace(r)} style={{ padding: 6 }}>
                    <Ionicons name="star-outline" size={16} color={C.text3} />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            ))}

            {/* History tab */}
            {results.length === 0 && tab === 'history' && Object.entries(grouped).map(([dateKey, items]) => (
              <View key={dateKey}>
                <View style={s.sectionHeader}>
                  <Text style={s.sectionHeaderText}>{dateKey}</Text>
                  {dateKey === 'TODAY' && (
                    <TouchableOpacity onPress={clearSearchHistory}>
                      <Text style={s.clearBtn}>Clear</Text>
                    </TouchableOpacity>
                  )}
                </View>
                {items.map((h, i) => {
                  const dist = userLoc ? haversineKm(userLoc, h) : null;
                  return (
                    <TouchableOpacity key={i} style={s.resultRow} onPress={() => selectPlace(h)}>
                      <View style={s.resultIcon}><Ionicons name="time-outline" size={14} color={C.orange} /></View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.resultName} numberOfLines={1}>{h.name.split(',')[0]}</Text>
                        <Text style={s.resultSub} numberOfLines={1}>{h.name.split(',').slice(1, 2).join(',').trim()}</Text>
                      </View>
                      {dist != null && <Text style={s.resultDist}>{fmtDist(dist)}</Text>}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}

            {/* Nearby tab */}
            {results.length === 0 && tab === 'nearby' && (
              <View>
                <View style={s.liveNearbyHeader}>
                  <Text style={s.sectionHeaderText}>NEARBY</Text>
                  {contextLoading && (
                    <View style={s.liveNearbyPill}>
                      <Ionicons name="search" size={11} color={C.orange} />
                      <Text style={s.liveNearbyPillText}>SEARCHING LIVE PLACES</Text>
                    </View>
                  )}
                </View>
                {nearbyPlaces.map((p, i) => (
                  <TouchableOpacity key={i} style={s.resultRow} onPress={() => selectPlace(p)}>
                    {p.photo_url ? (
                      <Image source={{ uri: p.photo_url }} style={s.resultThumb} resizeMode="cover" />
                    ) : (
                      <View style={[s.resultIcon, { backgroundColor: ICON_COLORS[p.icon || 'pin'] + '22' }]}>
                        <Ionicons name={ICON_NAMES[p.icon || 'pin']} size={14} color={ICON_COLORS[p.icon || 'pin']} />
                      </View>
                    )}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.resultName} numberOfLines={1}>{p.name}</Text>
                      <Text style={s.resultSub} numberOfLines={1}>{[p.type?.replace(/_/g, ' '), p.source_label || p.source].filter(Boolean).join(' · ')}</Text>
                    </View>
                    {p.dist != null && <Text style={s.resultDist}>{fmtDist(p.dist)}</Text>}
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Categories tab */}
            {results.length === 0 && tab === 'categories' && (
              <View>
                {/* Category grid */}
                {!activeCat && (
                  <View style={s.catGrid}>
                    {CATEGORIES.map(cat => (
                      <TouchableOpacity key={cat.id} style={s.catTile}
                        onPress={() => pickCategory(cat.id)} disabled={!userLoc}>
                        <View style={[s.catIconWrap, { backgroundColor: cat.color + '22' }]}>
                          <Ionicons name={cat.icon as any} size={22} color={cat.color} />
                        </View>
                        <Text style={s.catLabel}>{cat.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* Category results */}
                {activeCat && (
                  <View>
                    <View style={s.catResultsHeader}>
                      <TouchableOpacity onPress={() => { setActiveCat(null); setCatResults([]); }} style={{ padding: 4 }}>
                        <Ionicons name="arrow-back" size={16} color={C.text2} />
                      </TouchableOpacity>
                      <Text style={s.catResultsTitle}>
                        {CATEGORIES.find(c => c.id === activeCat)?.label ?? activeCat}
                      </Text>
                      {catSearching && <ActivityIndicator size="small" color={C.orange} />}
                    </View>
                    {!catSearching && catResults.length === 0 && (
                      <Text style={s.catEmpty}>None found within 25 miles</Text>
                    )}
                    {catResults.map((r: any, i: number) => {
                      const cat = CATEGORIES.find(c => c.id === activeCat);
                      const isCamp = activeCat === 'camps' || activeCat === 'private_stays';
                      return (
                        <TouchableOpacity key={i} style={s.resultRow} onPress={() => selectPlace(r)}>
                          {r.photo_url ? (
                            <Image source={{ uri: r.photo_url }} style={s.resultThumb} resizeMode="cover" />
                          ) : (
                            <View style={[s.resultIcon, { backgroundColor: (cat?.color ?? C.orange) + '22' }]}>
                              <Ionicons name={(cat?.icon ?? 'location') as any} size={14} color={cat?.color ?? C.orange} />
                            </View>
                          )}
                          <View style={{ flex: 1 }}>
                            <Text style={s.resultName} numberOfLines={1}>{r.name}</Text>
                            <Text style={s.resultSub} numberOfLines={1}>{isCamp && r._camp?.land_type ? r._camp.land_type : [r.type?.replace(/_/g, ' '), r.source_label || r.source].filter(Boolean).join(' · ')}</Text>
                          </View>
                          {r.dist != null && <Text style={s.resultDist}>{fmtDist(r.dist)}</Text>}
                          {isCamp && onCampTap && r._camp && (
                            <TouchableOpacity
                              onPress={() => { onCampTap(r._camp); }}
                              style={s.campDetailBtn}
                            >
                              <Ionicons name="information-circle-outline" size={20} color={C.orange} />
                            </TouchableOpacity>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </View>
            )}
          </ScrollView>
        </View>
        </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    );
  }

  // ── View: Route ready ────────────────────────────────────────────────────────
  if (view === 'route' && routeCard) {
    const canStart = Boolean(activeOrigin?.isCurrentLocation);
    return (
      <TrailheadSheet handle={false} style={[s.sheet, { maxHeight: sheetMaxHeight }]} contentStyle={[s.sheetContent, { paddingBottom: bottomPad }]}>
        <View style={s.handle} />
        <View style={s.routeHeader}>
          <View style={s.routeHeaderIcon}>
            <Ionicons name="navigate" size={18} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.routeTitle}>Route preview</Text>
            <Text style={s.routeSubtitle}>{canStart ? 'Ready from your current location' : 'Preview from a custom start'}</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={s.routeCloseBtn}>
            <Ionicons name="close" size={18} color={C.text3} />
          </TouchableOpacity>
        </View>
        <View style={s.fromToBlock}>
          <View style={s.fromToLine}>
            <View style={s.dotLine}>
              <View style={[s.dot, { backgroundColor: C.sage }]} />
              <View style={s.dotConnector} />
              <View style={[s.dot, { backgroundColor: C.orange }]} />
            </View>
            <View style={{ flex: 1 }}>
              <TouchableOpacity style={s.fromToRow} onPress={() => { setActiveEndpoint('origin'); setView('searching'); setTab('history'); setQuery(''); setResults([]); setTimeout(() => inputRef.current?.focus(), 100); }}>
                <Text style={s.fromToLabel}>FROM</Text>
                <Text style={s.fromToValue} numberOfLines={1}>{activeOrigin?.name ?? 'Choose start'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.fromToRow, { marginTop: 10 }]} onPress={() => { setActiveEndpoint('destination'); setView('searching'); setTab('history'); setQuery(''); setResults([]); setTimeout(() => inputRef.current?.focus(), 100); }}>
                <Text style={s.fromToLabel}>TO</Text>
                <Text style={s.fromToValue} numberOfLines={1}>{routeCard.name.split(',')[0]}</Text>
              </TouchableOpacity>
            </View>
            <View style={{ gap: 8 }}>
              <TouchableOpacity style={s.swapBtn}
                onPress={() => {
                  if (routeCard && activeOrigin) {
                    const nextOrigin = { ...routeCard };
                    const nextDest = { ...activeOrigin, isCurrentLocation: activeOrigin.isCurrentLocation };
                    setRouteOrigin(nextOrigin);
                    previewRoute(nextOrigin, nextDest);
                  }
                }}>
                <Ionicons name="swap-vertical" size={16} color={C.text2} />
              </TouchableOpacity>
              <TouchableOpacity style={s.swapBtn}
                onPress={() => {
                  setRouteOrigin(currentLocationPlace);
                  if (currentLocationPlace) previewRoute(currentLocationPlace, routeCard);
                }}
                disabled={!currentLocationPlace}
              >
                <Ionicons name="locate" size={16} color={C.text2} />
              </TouchableOpacity>
            </View>
          </View>
          {routeCard.dist != null && (
            <Text style={s.routeDist}>
              {fmtDist(routeCard.dist)} away
              {routeOpts.backRoads ? '  ·  BACK ROADS' : routeOpts.avoidHighways ? '  ·  NO HWY' : ''}
              {routeOpts.avoidTolls ? '  ·  NO TOLL' : ''}
            </Text>
          )}
        </View>
        {/* Elevation profile */}
        {routeCoords && routeCoords.length > 2 && (
          <ElevationProfile coords={routeCoords} />
        )}

        <View style={s.routeActions}>
          <TouchableOpacity style={s.settingsBtn} onPress={onOpenRouteOpts}>
            <Ionicons name="options-outline" size={14} color={C.orange} />
            <Text style={s.settingsBtnText}>Route options</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.settingsBtn}>
            <Ionicons name="volume-high-outline" size={14} color={C.orange} />
            <Text style={s.settingsBtnText}>Audio On</Text>
          </TouchableOpacity>
        </View>
        {!canStart && (
          <View style={s.previewNotice}>
            <Ionicons name="information-circle-outline" size={14} color={C.text3} />
            <Text style={s.previewNoticeText}>Start is available when FROM is My Location. Custom starts are route previews.</Text>
          </View>
        )}
        <View style={[s.startCancelRow, { paddingBottom: Math.max(bottomPad - 8, 10) }]}>
          <TouchableOpacity style={s.cancelBtn} onPress={() => { onClearRoute(); setView('picker'); }}>
            <Text style={s.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.startBtn, !canStart && s.startBtnDisabled]} onPress={canStart ? onStartNav : undefined} disabled={!canStart}>
            <Ionicons name="navigate" size={18} color="#fff" />
            <Text style={s.startBtnText}>{canStart ? 'Start' : 'Preview only'}</Text>
          </TouchableOpacity>
        </View>
      </TrailheadSheet>
    );
  }

  // ── View: Picker (default "Add destination") ────────────────────────────────
  return (
    <TrailheadSheet handle={false} style={[s.sheet, { maxHeight: sheetMaxHeight }]} contentStyle={[s.sheetContent, { paddingBottom: bottomPad }]}>
      <View style={s.handle} />

      <View style={s.pickerHeader}>
        <Text style={s.pickerTitle}>Add destination</Text>
        <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
          <Ionicons name="close" size={20} color={C.text3} />
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        style={s.pickerScroll}
        contentContainerStyle={{ paddingBottom: bottomPad + 22 }}
      >
        {/* Search / Address quick actions */}
        <View style={s.quickCard}>
          <TouchableOpacity style={s.quickRow} onPress={() => { setActiveEndpoint('destination'); setView('searching'); setTab('history'); setTimeout(() => inputRef.current?.focus(), 100); }}>
            <Text style={s.quickRowText}>Plan a route</Text>
            <Ionicons name="search" size={18} color={C.orange} />
          </TouchableOpacity>
          <View style={s.quickDivider} />
          <TouchableOpacity style={s.quickRow} onPress={() => { setView('searching'); setTab('nearby'); }}>
            <Text style={s.quickRowText}>Nearby places</Text>
            <Ionicons name="compass-outline" size={18} color={C.orange} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={s.selectOnMapBtn} onPress={onSelectOnMap}>
          <Text style={s.quickRowText}>Select on map</Text>
          <Ionicons name="map-outline" size={18} color={C.orange} />
        </TouchableOpacity>

        {/* Downloaded trip corridors */}
        {offlineTrips.length > 0 && onLoadSavedTrip && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>DOWNLOADED TRIP CORRIDORS</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
              {offlineTrips.slice(0, 8).map(t => (
                <TouchableOpacity
                  key={t.trip_id}
                  style={[s.chip, { minWidth: 170, maxWidth: 260, borderColor: C.green + '66' }]}
                  onPress={() => { onLoadSavedTrip(t.trip_id); onClose(); }}
                >
                  <Ionicons name={t.trip_id.startsWith('manual_') ? 'trail-sign-outline' : 'cloud-done-outline'} size={14} color={C.green} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.chipText, { fontSize: 11, fontWeight: '700' }]} numberOfLines={1}>{t.plan.trip_name}</Text>
                    <Text style={[s.chipText, { fontSize: 9, color: C.text3 }]}>
                      {t.trip_id.startsWith('manual_') ? 'Manual route' : 'Offline trip'} · {t.plan.duration_days ?? 0}d{(t.plan.states ?? []).length ? ` · ${(t.plan.states ?? []).slice(0, 3).join(', ')}` : ''}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Saved Trips */}
        {tripHistory.length > 0 && onLoadSavedTrip && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>SAVED TRIPS</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
              {tripHistory.slice(0, 6).map(t => (
                <TouchableOpacity
                  key={t.trip_id}
                  style={[s.chip, { maxWidth: 180 }]}
                  onPress={() => { onLoadSavedTrip(t.trip_id); onClose(); }}
                >
                  <Ionicons name="map-outline" size={14} color={C.orange} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.chipText, { fontSize: 11, fontWeight: '600' }]} numberOfLines={1}>{t.trip_name}</Text>
                    <Text style={[s.chipText, { fontSize: 9, color: C.text3 }]}>{t.duration_days}d · {t.states?.slice(0,3).join(', ')}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Favorites */}
        {(savedPlaces.length > 0 || favoriteCamps.length > 0) && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>FAVORITES</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
              <TouchableOpacity
                style={s.chip}
                onPress={() => {
                  const firstSaved = savedPlaces[0];
                  const firstCamp = favoriteCamps[0];
                  if (firstSaved) selectPlace({ name: firstSaved.name, lat: firstSaved.lat, lng: firstSaved.lng });
                  else if (firstCamp) selectPlace({ name: firstCamp.name, lat: firstCamp.lat, lng: firstCamp.lng });
                }}
              >
                <Ionicons name="star" size={16} color={C.gold} />
                <Text style={s.chipText}>All Saved</Text>
              </TouchableOpacity>
              {savedPlaces.slice(0, 6).map(p => (
                <TouchableOpacity key={p.id} style={s.chip}
                  onPress={() => selectPlace({ name: p.name, lat: p.lat, lng: p.lng })}>
                  <Ionicons name={ICON_NAMES[p.icon] ?? 'location'} size={14} color={ICON_COLORS[p.icon] ?? C.orange} />
                  <Text style={s.chipText} numberOfLines={1}>{p.name}</Text>
                </TouchableOpacity>
              ))}
              {favoriteCamps.slice(0, 4).map(c => (
                <TouchableOpacity key={c.id} style={s.chip}
                  onPress={() => selectPlace({ name: c.name, lat: c.lat, lng: c.lng })}>
                  <Ionicons name="bonfire-outline" size={14} color="#14b8a6" />
                  <Text style={s.chipText} numberOfLines={1}>{c.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Marker groups */}
        <View style={s.section}>
          <View style={s.sectionRow}>
            <Text style={s.sectionTitle}>MAP MARKERS</Text>
            <TouchableOpacity onPress={() => setShowCreateGroup(true)} style={s.addGroupBtn}>
              <Ionicons name="add" size={14} color={C.orange} />
              <Text style={s.addGroupBtnText}>New group</Text>
            </TouchableOpacity>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
            {/* Built-in marker types */}
            {camps.slice(0, 4).map((c, i) => {
              const dist = userLoc ? haversineKm(userLoc, c) : null;
              return (
                <TouchableOpacity key={`c${i}`} style={s.chip}
                  onPress={() => selectPlace({ name: c.name, lat: c.lat, lng: c.lng, dist: dist ?? undefined })}>
                  <Ionicons name="bonfire-outline" size={14} color="#14b8a6" />
                  <Text style={s.chipText} numberOfLines={1}>{c.name}</Text>
                </TouchableOpacity>
              );
            })}
            {gas.slice(0, 3).map((g, i) => {
              const dist = userLoc ? haversineKm(userLoc, g) : null;
              return (
                <TouchableOpacity key={`g${i}`} style={[s.chip, { borderColor: '#eab308' + '44' }]}
                  onPress={() => selectPlace({ name: g.name, lat: g.lat, lng: g.lng, dist: dist ?? undefined })}>
                  <Ionicons name="car-sport-outline" size={14} color="#eab308" />
                  <Text style={s.chipText} numberOfLines={1}>{g.name}</Text>
                </TouchableOpacity>
              );
            })}
            {/* User marker groups */}
            {markerGroups.map(g => {
              const groupPlaces = savedPlaces.filter(p => p.groupId === g.id);
              return (
                <TouchableOpacity key={g.id} style={[s.chip, { borderColor: g.color + '55' }]}
                  onPress={() => {
                    const first = groupPlaces[0];
                    if (first) selectPlace({ name: first.name, lat: first.lat, lng: first.lng });
                    else setShowCreateGroup(true);
                  }}>
                  <Ionicons name={g.icon as any} size={14} color={g.color} />
                  <Text style={s.chipText} numberOfLines={1}>{g.name}</Text>
                  {groupPlaces.length > 0 && (
                    <View style={[s.groupBadge, { backgroundColor: g.color }]}>
                      <Text style={s.groupBadgeText}>{groupPlaces.length}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
            {markerGroups.length === 0 && (
              <TouchableOpacity style={[s.chip, s.chipDashed]} onPress={() => setShowCreateGroup(true)}>
                <Ionicons name="add" size={14} color={C.text3} />
                <Text style={[s.chipText, { color: C.text3 }]}>Create group</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>

        {/* Recent searches */}
        {searchHistory.length > 0 && (
          <View style={s.section}>
            <View style={s.sectionRow}>
              <Text style={s.sectionTitle}>RECENT</Text>
              <TouchableOpacity onPress={clearSearchHistory}>
                <Text style={s.clearBtn}>Clear</Text>
              </TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
              {searchHistory.slice(0, 8).map((h, i) => (
                <TouchableOpacity key={i} style={s.chip}
                  onPress={() => selectPlace({ name: h.name, lat: h.lat, lng: h.lng })}>
                  <Ionicons name="time-outline" size={14} color={C.text3} />
                  <Text style={s.chipText} numberOfLines={1}>{h.name.split(',')[0]}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Change destination */}
        <TouchableOpacity style={s.swapRow}
          onPress={() => { setActiveEndpoint('destination'); setView('searching'); setTab('history'); }}>
          <Text style={s.quickRowText}>Change destination</Text>
          <Ionicons name="search" size={18} color={C.orange} />
        </TouchableOpacity>

        <View style={{ height: 8 }} />
      </ScrollView>

      {/* Create group modal */}
      {showCreateGroup && (
        <View style={s.createGroupSheet}>
          <Text style={s.createGroupTitle}>New Marker Group</Text>
          <TextInput style={s.createGroupInput} value={newGroupName} onChangeText={setNewGroupName}
            placeholder="Group name..." placeholderTextColor={C.text3} returnKeyType="done" blurOnSubmit onSubmitEditing={Keyboard.dismiss} autoFocus />
          <Text style={s.createGroupSubtitle}>Color</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
            {GROUP_COLORS.map(color => (
              <TouchableOpacity key={color} onPress={() => setNewGroupColor(color)}
                style={[s.colorSwatch, { backgroundColor: color, borderWidth: newGroupColor === color ? 3 : 0, borderColor: '#fff' }]} />
            ))}
          </ScrollView>
          <Text style={s.createGroupSubtitle}>Icon</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
            {GROUP_ICONS.map(icon => (
              <TouchableOpacity key={icon} onPress={() => setNewGroupIcon(icon)}
                style={[s.iconSwatch, newGroupIcon === icon && { backgroundColor: newGroupColor + '33', borderColor: newGroupColor }]}>
                <Ionicons name={icon as any} size={18} color={newGroupIcon === icon ? newGroupColor : C.text3} />
              </TouchableOpacity>
            ))}
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            <TouchableOpacity style={[s.cancelBtn, { flex: 1 }]} onPress={() => setShowCreateGroup(false)}>
              <Text style={s.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.startBtn, { flex: 1 }]} onPress={createGroup} disabled={!newGroupName.trim()}>
              <Text style={s.startBtnText}>Create</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </TrailheadSheet>
  );
}

const styles = (C: ReturnType<typeof useTheme>) => StyleSheet.create({
  sheet: {
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
  },
  sheetContent: { padding: 0 },
  pickerScroll: { flexGrow: 0 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginTop: 10, marginBottom: 6 },

  pickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8 },
  pickerTitle: { color: C.text, fontSize: 17, fontWeight: '700' },

  quickCard: { marginHorizontal: 16, marginVertical: 6, backgroundColor: C.s2, borderRadius: 14, overflow: 'hidden' },
  quickRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  quickRowText: { color: C.text, fontSize: 15 },
  quickDivider: { height: 1, backgroundColor: C.border, marginHorizontal: 16 },
  selectOnMapBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 16, marginVertical: 6, backgroundColor: C.s2, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14 },
  swapRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 16, marginVertical: 6, backgroundColor: C.s2, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14 },

  section: { marginTop: 8, paddingHorizontal: 16 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  sectionTitle: { color: C.text3, fontSize: 11, fontFamily: mono, fontWeight: '700', letterSpacing: 0.8, marginBottom: 8 },
  addGroupBtn: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  addGroupBtnText: { color: C.orange, fontSize: 11, fontFamily: mono },

  chipRow: { gap: 8, paddingBottom: 4 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: C.s2, borderRadius: 20, borderWidth: 1, borderColor: C.border, maxWidth: 160 },
  chipDashed: { borderStyle: 'dashed', borderColor: C.border2 },
  chipText: { color: C.text2, fontSize: 12, maxWidth: 100 },
  groupBadge: { width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  groupBadgeText: { color: '#fff', fontSize: 9, fontWeight: '700' },

  clearBtn: { color: C.orange, fontSize: 11, fontFamily: mono },

  // Searching view — full screen, content scrolls above keyboard
  searchingSheet: { backgroundColor: C.bg, flex: 1 },
  searchInputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: C.border },
  searchInput: { flex: 1, color: C.text, fontSize: 15, fontFamily: mono },
  searchScrollContent: { paddingBottom: 24 },
  hideBtn: { color: C.text2, fontSize: 14 },
  tabRow: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 6, gap: 4, borderBottomWidth: 1, borderColor: C.border },
  tab: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20, backgroundColor: C.s2 },
  tabActive: { backgroundColor: C.s3 },
  tabText: { color: C.text2, fontSize: 13 },
  tabTextActive: { color: C.text, fontWeight: '600' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8 },
  sectionHeaderText: { color: C.text3, fontSize: 11, fontFamily: mono, fontWeight: '700', letterSpacing: 0.8 },
  liveNearbyHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  liveNearbyPill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: C.orange + '44', backgroundColor: C.orange + '12', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  liveNearbyPillText: { color: C.orange, fontSize: 8.5, fontFamily: mono, fontWeight: '900', letterSpacing: 0.8 },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1, borderColor: C.border },
  resultIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.orangeGlow, alignItems: 'center', justifyContent: 'center' },
  resultThumb: { width: 42, height: 42, borderRadius: 12, backgroundColor: C.s2 },
  resultName: { color: C.text, fontSize: 14, fontWeight: '500' },
  resultSub: { color: C.text3, fontSize: 11, marginTop: 1 },
  resultDist: { color: C.text3, fontSize: 11, fontFamily: mono },

  // Route view
  routeHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10 },
  routeHeaderIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: C.orange, shadowColor: C.orange, shadowOpacity: 0.28, shadowRadius: 14 },
  routeTitle: { color: C.text, fontSize: 17, fontWeight: '800' },
  routeSubtitle: { color: C.text3, fontSize: 11, marginTop: 2 },
  routeCloseBtn: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.s2, borderWidth: 1, borderColor: C.border },
  fromToBlock: { marginHorizontal: 16, marginBottom: 12, padding: 12, borderRadius: 16, backgroundColor: C.s2, borderWidth: 1, borderColor: C.border },
  fromToLine: { flexDirection: 'row', alignItems: 'stretch', gap: 12 },
  dotLine: { width: 20, alignItems: 'center', paddingTop: 4 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  dotConnector: { width: 2, flex: 1, backgroundColor: C.border, marginVertical: 4 },
  fromToRow: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 8 },
  fromToLabel: { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '700', width: 34 },
  fromToValue: { color: C.text, fontSize: 14, fontWeight: '500', flex: 1 },
  swapBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.s2, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  routeDist: { color: C.text3, fontSize: 10, fontFamily: mono, marginTop: 8 },
  routeActions: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingBottom: 12 },
  settingsBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: C.border },
  settingsBtnText: { color: C.text2, fontSize: 12 },
  startCancelRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16 },
  cancelBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: C.s2, alignItems: 'center', borderWidth: 1, borderColor: C.border },
  cancelBtnText: { color: C.text2, fontSize: 14, fontWeight: '600' },
  startBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 13, borderRadius: 12, backgroundColor: C.orange },
  startBtnDisabled: { backgroundColor: C.s3, opacity: 0.72 },
  startBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  previewNotice: { marginHorizontal: 16, marginBottom: 12, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.s2, flexDirection: 'row', alignItems: 'center', gap: 8 },
  previewNoticeText: { flex: 1, color: C.text3, fontSize: 11, lineHeight: 15 },

  // Categories
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 10 },
  catTile: { width: '22%', alignItems: 'center', gap: 6, paddingVertical: 10 },
  catIconWrap: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  catLabel: { color: C.text2, fontSize: 10, textAlign: 'center', fontFamily: mono },
  catResultsHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: C.border },
  catResultsTitle: { color: C.text, fontSize: 15, fontWeight: '600', flex: 1 },
  catEmpty: { color: C.text3, fontSize: 13, textAlign: 'center', paddingVertical: 32 },
  campDetailBtn: { padding: 6, marginLeft: 4 },

  // Create group overlay
  createGroupSheet: { margin: 16, backgroundColor: C.s2, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.border },
  createGroupTitle: { color: C.text, fontSize: 15, fontWeight: '700', marginBottom: 10 },
  createGroupInput: { backgroundColor: C.bg, color: C.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, marginBottom: 12, borderWidth: 1, borderColor: C.border },
  createGroupSubtitle: { color: C.text3, fontSize: 11, fontFamily: mono, marginBottom: 6 },
  colorSwatch: { width: 28, height: 28, borderRadius: 14 },
  iconSwatch: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
});
