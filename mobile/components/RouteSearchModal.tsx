/**
 * RouteSearchModal — full OsmAnd-style route search + destination picker.
 * Views: picker → searching → route-ready
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
  Modal, SafeAreaView, LayoutChangeEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useStore, SavedPlace, MarkerGroup, TripHistoryItem } from '@/lib/store';
import { CampsitePin, Pin } from '@/lib/api';
import { loadOfflineTrip } from '@/lib/offlineTrips';
import { useTheme, mono } from '@/lib/design';

export interface SearchPlace {
  name: string;
  lat: number;
  lng: number;
  dist?: number | null;
}

export interface RouteSearchModalProps {
  visible: boolean;
  userLoc: { lat: number; lng: number } | null;
  camps: CampsitePin[];
  gas: { lat: number; lng: number; name: string }[];
  pois: { lat: number; lng: number; name: string; type: string }[];
  communityPins: Pin[];
  routeOpts: { avoidHighways?: boolean; avoidTolls?: boolean; backRoads?: boolean };
  routeCoords?: [number, number][];  // [lng, lat] for elevation profile
  onCampTap?: (camp: CampsitePin) => void;  // opens camp detail card
  onLoadSavedTrip?: (tripId: string) => void;  // load a previously planned trip
  onSelectDest: (place: SearchPlace) => void;
  onStartNav: () => void;
  onSelectOnMap: () => void;
  onClose: () => void;
  routeCard: SearchPlace | null;
  onClearRoute: () => void;
  onOpenRouteOpts: () => void;
}

type ModalView = 'picker' | 'searching' | 'route';
type SearchTab = 'history' | 'nearby' | 'categories';

// Overpass API categories — overlander-focused supply stops
const CATEGORIES = [
  { id: 'camps',     label: 'Camps Nearby',  icon: 'bonfire-outline',      color: '#14b8a6', tags: [
    ['tourism','camp_site'], ['tourism','caravan_site'], ['tourism','camp_pitch'],
    ['amenity','camping'],   ['tourism','wilderness_hut'], ['tourism','alpine_hut'],
    ['leisure','nature_reserve'], ['boundary','national_park'],
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

async function searchOverpass(
  tags: readonly (readonly string[])[],
  lat: number, lng: number, radiusM = 25000
): Promise<SearchPlace[]> {
  // Search node + way + relation so we find both point markers AND polygon buildings
  // "out center" gives center coord for ways/relations, "out skel" for nodes
  const tagQueries = tags.flatMap(([k, v]) => [
    `node["${k}"="${v}"](around:${radiusM},${lat},${lng});`,
    `way["${k}"="${v}"](around:${radiusM},${lat},${lng});`,
    `relation["${k}"="${v}"](around:${radiusM},${lat},${lng});`,
  ]).join('\n');
  const query = `[out:json][timeout:15];\n(\n${tagQueries}\n);\nout center 30;`;
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: query,
    headers: { 'Content-Type': 'text/plain' },
  });
  const data = await res.json();
  const origin = { lat, lng };
  return (data.elements ?? [])
    .map((e: any) => {
      const elat = e.lat ?? e.center?.lat;
      const elng = e.lon ?? e.center?.lon;
      if (!elat || !elng) return null;
      const rawName = e.tags?.name ?? e.tags?.brand ?? e.tags?.operator ?? e.tags?.['name:en'];
      if (!rawName) return null; // skip unnamed features
      // Add type hint for camping areas
      const tourism = e.tags?.tourism ?? '';
      const suffix =
        tourism === 'camp_site'     ? ' Campground' :
        tourism === 'caravan_site'  ? ' RV Park' :
        tourism === 'camp_pitch'    ? ' Camp Pitch' :
        tourism === 'wilderness_hut'? ' Wilderness Hut' :
        e.tags?.boundary === 'national_park' ? ' (National Park)' :
        e.tags?.leisure === 'nature_reserve' ? ' (Nature Reserve)' : '';
      return {
        name: rawName + suffix,
        lat: elat, lng: elng,
        dist: haversineKm(origin, { lat: elat, lng: elng }),
      };
    })
    .filter(Boolean)
    .sort((a: SearchPlace, b: SearchPlace) => (a.dist ?? 999) - (b.dist ?? 999))
    // Dedupe by name+approximate position
    .filter((p: SearchPlace, i: number, arr: SearchPlace[]) =>
      arr.findIndex(x => x.name === p.name && Math.abs(x.lat - p.lat) < 0.001) === i
    )
    .slice(0, 15);
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function fmtDist(km: number) {
  if (km < 1) return `${Math.round(km * 1000)} ft`;
  if (km < 16) return `${km.toFixed(1)} mi`;
  return `${Math.round(km * 0.621371)} mi`;
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
  water: '#38bdf8', fuel: '#eab308', pin: '#a855f7',
};
const ICON_NAMES: Record<string, any> = {
  star: 'star', camp: 'bonfire-outline', flag: 'flag',
  water: 'water', fuel: 'car-sport-outline', pin: 'location',
};
const GROUP_ICONS = ['flag', 'star', 'bonfire-outline', 'water', 'car-sport-outline', 'leaf-outline', 'camera-outline', 'shield-outline'];
const GROUP_COLORS = ['#ef4444', '#f5a623', '#14b8a6', '#38bdf8', '#eab308', '#22c55e', '#a855f7', '#6366f1'];

export default function RouteSearchModal({
  visible, userLoc, camps, gas, pois, communityPins, routeOpts, routeCoords,
  onCampTap, onLoadSavedTrip, onSelectDest, onStartNav, onSelectOnMap, onClose,
  routeCard, onClearRoute, onOpenRouteOpts,
}: RouteSearchModalProps) {
  const C = useTheme();
  const s = styles(C);

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
  const [results, setResults]     = useState<SearchPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [catResults, setCatResults] = useState<SearchPlace[]>([]);
  const [catSearching, setCatSearching] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupColor, setNewGroupColor] = useState(GROUP_COLORS[0]);
  const [newGroupIcon, setNewGroupIcon] = useState(GROUP_ICONS[0]);
  const inputRef = useRef<TextInput>(null);

  // Switch to route view when a route card arrives
  useEffect(() => {
    if (routeCard && visible) setView('route');
  }, [routeCard, visible]);

  // Reset to picker when modal opens fresh with no route
  useEffect(() => {
    if (visible && !routeCard) { setView('picker'); setQuery(''); setResults([]); }
  }, [visible]);

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
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=8&countrycodes=us`,
        { headers: { 'User-Agent': 'Trailhead/1.0' } }
      );
      const data = await res.json();
      const places: SearchPlace[] = data.map((r: any) => {
        const lat = parseFloat(r.lat);
        const lng = parseFloat(r.lon);
        const dist = userLoc ? haversineKm(userLoc, { lat, lng }) : null;
        return { name: r.display_name, lat, lng, dist };
      });
      setResults(places);
    } catch { setResults([]); }
    setSearching(false);
  }, [query, userLoc]);

  const pickCategory = useCallback(async (catId: string) => {
    setActiveCat(catId);
    setCatResults([]);
    if (!userLoc) return;
    const cat = CATEGORIES.find(c => c.id === catId);
    if (!cat) return;
    setCatSearching(true);
    try {
      // Camps: broad Overpass search + merge local trip camps at top
      const radius = catId === 'camps' ? 80000 : 25000;
      const places = cat.tags.length > 0
        ? await searchOverpass(cat.tags, userLoc.lat, userLoc.lng, radius)
        : [];
      if (catId === 'camps') {
        // Prepend local trip campsites (already loaded, free, instant)
        const origin = userLoc;
        const localCamps = (camps ?? [])
          .filter(c => c.lat && c.lng)
          .map(c => ({ name: c.name, lat: c.lat, lng: c.lng, dist: haversineKm(origin, c), _camp: c }))
          .filter(lc => !places.some(p => Math.abs(p.lat - lc.lat) < 0.005 && Math.abs(p.lng - lc.lng) < 0.005));
        setCatResults([...localCamps, ...places] as any);
      } else {
        setCatResults(places);
      }
    } catch {}
    setCatSearching(false);
  }, [userLoc, camps]);

  const selectPlace = useCallback((place: SearchPlace) => {
    addSearchHistory({ name: place.name, lat: place.lat, lng: place.lng, searchedAt: Date.now() });
    onSelectDest(place);
    setQuery('');
    setResults([]);
    setView('route');
  }, [addSearchHistory, onSelectDest]);

  const saveCurrentPlace = useCallback((place: SearchPlace) => {
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

  const nearbyPlaces = userLoc ? [
    ...camps.slice(0, 5).map(c => ({ name: c.name, lat: c.lat, lng: c.lng, icon: 'camp', dist: haversineKm(userLoc, c) })),
    ...gas.slice(0, 3).map(g => ({ name: g.name, lat: g.lat, lng: g.lng, icon: 'fuel', dist: haversineKm(userLoc, g) })),
    ...pois.slice(0, 3).map(p => ({ name: p.name, lat: p.lat, lng: p.lng, icon: 'pin', dist: haversineKm(userLoc, p) })),
  ].sort((a, b) => (a.dist ?? 9999) - (b.dist ?? 9999)).slice(0, 10) : [];

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
      <Modal visible animationType="slide" transparent={false} statusBarTranslucent>
        <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={s.searchingSheet}>
          {/* Search input row */}
          <View style={s.searchInputRow}>
            <TouchableOpacity onPress={() => { setView('picker'); setQuery(''); setResults([]); setActiveCat(null); setCatResults([]); }} style={{ padding: 4 }}>
              <Ionicons name="arrow-back" size={20} color={C.text2} />
            </TouchableOpacity>
            <TextInput ref={inputRef} style={s.searchInput} value={query} onChangeText={setQuery}
              onSubmitEditing={doSearch} placeholder="Type to search all" placeholderTextColor={C.text3}
              returnKeyType="search" autoFocus />
            {searching
              ? <ActivityIndicator size="small" color={C.orange} />
              : <TouchableOpacity onPress={() => { setView('picker'); setQuery(''); setResults([]); setActiveCat(null); setCatResults([]); }}>
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

          <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" style={{ flex: 1 }}>
            {/* Geocoding results */}
            {results.length > 0 && results.map((r, i) => (
              <TouchableOpacity key={i} style={s.resultRow} onPress={() => selectPlace(r)}>
                <View style={s.resultIcon}><Ionicons name="location" size={14} color={C.orange} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.resultName} numberOfLines={1}>{r.name.split(',')[0]}</Text>
                  <Text style={s.resultSub} numberOfLines={1}>{r.name.split(',').slice(1, 3).join(',').trim()}</Text>
                </View>
                {r.dist != null && <Text style={s.resultDist}>{fmtDist(r.dist)}</Text>}
                <TouchableOpacity onPress={() => saveCurrentPlace(r)} style={{ padding: 6 }}>
                  <Ionicons name="star-outline" size={16} color={C.text3} />
                </TouchableOpacity>
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
                <Text style={[s.sectionHeaderText, { paddingHorizontal: 16, paddingTop: 12 }]}>NEARBY</Text>
                {nearbyPlaces.map((p, i) => (
                  <TouchableOpacity key={i} style={s.resultRow} onPress={() => selectPlace(p)}>
                    <View style={[s.resultIcon, { backgroundColor: ICON_COLORS[p.icon] + '22' }]}>
                      <Ionicons name={ICON_NAMES[p.icon]} size={14} color={ICON_COLORS[p.icon]} />
                    </View>
                    <Text style={s.resultName} numberOfLines={1}>{p.name}</Text>
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
                      const isCamp = activeCat === 'camps';
                      return (
                        <TouchableOpacity key={i} style={s.resultRow} onPress={() => selectPlace(r)}>
                          <View style={[s.resultIcon, { backgroundColor: (cat?.color ?? C.orange) + '22' }]}>
                            <Ionicons name={(cat?.icon ?? 'location') as any} size={14} color={cat?.color ?? C.orange} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={s.resultName} numberOfLines={1}>{r.name}</Text>
                            {isCamp && r._camp?.land_type && (
                              <Text style={s.resultSub} numberOfLines={1}>{r._camp.land_type}</Text>
                            )}
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
    return (
      <View style={s.sheet}>
        <View style={s.handle} />
        <View style={s.routeHeader}>
          <Ionicons name="car" size={24} color={C.text2} />
        </View>
        <View style={s.fromToBlock}>
          <View style={s.fromToLine}>
            <View style={s.dotLine}>
              <View style={[s.dot, { backgroundColor: C.sage }]} />
              <View style={s.dotConnector} />
              <View style={[s.dot, { backgroundColor: C.orange }]} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={s.fromToRow}>
                <Text style={s.fromToLabel}>FROM</Text>
                <Text style={s.fromToValue} numberOfLines={1}>My Position</Text>
              </View>
              <View style={[s.fromToRow, { marginTop: 10 }]}>
                <Text style={s.fromToLabel}>TO</Text>
                <Text style={s.fromToValue} numberOfLines={1}>{routeCard.name.split(',')[0]}</Text>
              </View>
            </View>
            <View style={{ gap: 8 }}>
              <TouchableOpacity style={s.swapBtn}
                onPress={() => {
                  // Swap: navigate FROM destination BACK to user position
                  if (routeCard && userLoc) {
                    const swapped: SearchPlace = { name: 'My Position', lat: userLoc.lat, lng: userLoc.lng };
                    onSelectDest({ ...routeCard }); // re-trigger route calc from new origin
                  }
                }}>
                <Ionicons name="swap-vertical" size={16} color={C.text2} />
              </TouchableOpacity>
              <TouchableOpacity style={s.swapBtn}
                onPress={() => { setView('searching'); setTab('history'); }}>
                <Ionicons name="add" size={16} color={C.text2} />
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
            <Text style={s.settingsBtnText}>Settings</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.settingsBtn}>
            <Ionicons name="volume-high-outline" size={14} color={C.orange} />
            <Text style={s.settingsBtnText}>Audio On</Text>
          </TouchableOpacity>
        </View>
        <View style={s.startCancelRow}>
          <TouchableOpacity style={s.cancelBtn} onPress={() => { onClearRoute(); setView('picker'); }}>
            <Text style={s.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.startBtn} onPress={onStartNav}>
            <Ionicons name="navigate" size={18} color="#fff" />
            <Text style={s.startBtnText}>Start</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── View: Picker (default "Add destination") ────────────────────────────────
  return (
    <View style={s.sheet}>
      <View style={s.handle} />

      <View style={s.pickerHeader}>
        <Text style={s.pickerTitle}>Add destination</Text>
        <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
          <Ionicons name="close" size={20} color={C.text3} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Search / Address quick actions */}
        <View style={s.quickCard}>
          <TouchableOpacity style={s.quickRow} onPress={() => { setView('searching'); setTab('history'); setTimeout(() => inputRef.current?.focus(), 100); }}>
            <Text style={s.quickRowText}>Search</Text>
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

        {/* Saved Trips */}
        {tripHistory.length > 0 && onLoadSavedTrip && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>MY TRIPS</Text>
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
              <TouchableOpacity style={s.chip} onPress={() => {}}>
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
                  onPress={() => {}}>
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

        {/* Swap */}
        <TouchableOpacity style={s.swapRow}
          onPress={() => { setView('searching'); setTab('history'); }}>
          <Text style={s.quickRowText}>Swap start and destination</Text>
          <Ionicons name="swap-vertical" size={18} color={C.orange} />
        </TouchableOpacity>

        <View style={{ height: 8 }} />
      </ScrollView>

      {/* Create group modal */}
      {showCreateGroup && (
        <View style={s.createGroupSheet}>
          <Text style={s.createGroupTitle}>New Marker Group</Text>
          <TextInput style={s.createGroupInput} value={newGroupName} onChangeText={setNewGroupName}
            placeholder="Group name..." placeholderTextColor={C.text3} autoFocus />
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
    </View>
  );
}

const styles = (C: ReturnType<typeof useTheme>) => StyleSheet.create({
  sheet: {
    backgroundColor: C.bg,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderTopWidth: 1, borderColor: C.border,
    paddingBottom: 28,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15, shadowRadius: 12, elevation: 16,
  },
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
  hideBtn: { color: C.text2, fontSize: 14 },
  tabRow: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 6, gap: 4, borderBottomWidth: 1, borderColor: C.border },
  tab: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20, backgroundColor: C.s2 },
  tabActive: { backgroundColor: C.s3 },
  tabText: { color: C.text2, fontSize: 13 },
  tabTextActive: { color: C.text, fontWeight: '600' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8 },
  sectionHeaderText: { color: C.text3, fontSize: 11, fontFamily: mono, fontWeight: '700', letterSpacing: 0.8 },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1, borderColor: C.border },
  resultIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.orangeGlow, alignItems: 'center', justifyContent: 'center' },
  resultName: { color: C.text, fontSize: 14, fontWeight: '500' },
  resultSub: { color: C.text3, fontSize: 11, marginTop: 1 },
  resultDist: { color: C.text3, fontSize: 11, fontFamily: mono },

  // Route view
  routeHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 },
  fromToBlock: { paddingHorizontal: 16, paddingBottom: 12 },
  fromToLine: { flexDirection: 'row', alignItems: 'stretch', gap: 12 },
  dotLine: { width: 20, alignItems: 'center', paddingTop: 4 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  dotConnector: { width: 2, flex: 1, backgroundColor: C.border, marginVertical: 4 },
  fromToRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
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
  startBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

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
