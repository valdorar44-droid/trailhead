import { useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput,
  ActivityIndicator, Modal, Alert, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import NativeMap, { NativeMapHandle } from '@/components/NativeMap';
import PaywallModal from '@/components/PaywallModal';
import TourTarget from '@/components/TourTarget';
import { api, CampFullness, CampsiteDetail, CampsiteInsight, CampsitePin, GasStation, OsmPoi, PaywallError, TripResult, Waypoint, WeatherForecast } from '@/lib/api';
import { saveOfflineTrip } from '@/lib/offlineTrips';
import { useStore } from '@/lib/store';
import { useTheme, mono, ColorPalette } from '@/lib/design';

type BuilderStopType = 'start' | 'fuel' | 'waypoint' | 'camp' | 'motel';
type BuilderStop = {
  id: string;
  day: number;
  name: string;
  lat: number;
  lng: number;
  type: BuilderStopType;
  description: string;
  land_type: string;
  source?: 'search' | 'camp' | 'gas' | 'poi' | 'map';
  camp?: CampsitePin;
  gas?: GasStation;
  poi?: OsmPoi;
};
type SearchPlace = { name: string; lat: number; lng: number };
type DiscoveryTab = 'camps' | 'gas' | 'poi';

function haversineMi(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 3958.8;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function midpoint(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
}

function pointSegmentDistanceMi(point: { lat: number; lng: number }, a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const refLat = ((point.lat + a.lat + b.lat) / 3) * Math.PI / 180;
  const px = point.lng * Math.cos(refLat), py = point.lat;
  const ax = a.lng * Math.cos(refLat), ay = a.lat;
  const bx = b.lng * Math.cos(refLat), by = b.lat;
  const dx = bx - ax, dy = by - ay;
  if (dx === 0 && dy === 0) return haversineMi(point, a);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  const projected = { lat: ay + t * dy, lng: (ax + t * dx) / Math.cos(refLat) };
  return haversineMi(point, projected);
}

function fmtMi(mi: number) {
  if (!Number.isFinite(mi)) return '-';
  return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`;
}

function stopColor(type: string) {
  if (type === 'start') return '#22c55e';
  if (type === 'camp') return '#14b8a6';
  if (type === 'fuel') return '#eab308';
  if (type === 'motel') return '#6366f1';
  return '#f97316';
}

function stopIcon(type: string): keyof typeof Ionicons.glyphMap {
  if (type === 'start') return 'flag-outline';
  if (type === 'camp') return 'bonfire-outline';
  if (type === 'fuel') return 'flash-outline';
  if (type === 'motel') return 'bed-outline';
  return 'navigate-outline';
}

function stopLabel(type: string) {
  if (type === 'start') return 'Start';
  if (type === 'fuel') return 'Fuel';
  if (type === 'camp') return 'Camp';
  if (type === 'motel') return 'Lodging';
  return 'Stop';
}

function sourceLabel(source?: BuilderStop['source']) {
  if (source === 'camp') return 'verified camp';
  if (source === 'gas') return 'fuel search';
  if (source === 'poi') return 'poi search';
  if (source === 'search') return 'search';
  if (source === 'map') return 'map tap';
  return 'manual';
}

function landColor(lt?: string | null) {
  if (!lt) return { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' };
  const l = lt.toLowerCase();
  if (l.includes('national forest') || l.includes('usfs') || l.includes('forest service') || l.includes('ranger'))
    return { bg: '#dcfce7', text: '#15803d', border: '#86efac' };
  if (l.includes('national park') || l.includes('nps') || l.includes('national monument') || l.includes('national recreation'))
    return { bg: '#dbeafe', text: '#1d4ed8', border: '#93c5fd' };
  if (l.includes('blm') || l.includes('bureau of land'))
    return { bg: '#fef3c7', text: '#92400e', border: '#fcd34d' };
  if (l.includes('state park') || l.includes('state forest') || l.includes('state beach'))
    return { bg: '#ede9fe', text: '#6d28d9', border: '#c4b5fd' };
  if (l.includes('koa') || l.includes('resort') || l.includes('rv park') || l.includes('private'))
    return { bg: '#f1f5f9', text: '#475569', border: '#94a3b8' };
  return { bg: '#ecfdf5', text: '#065f46', border: '#6ee7b7' };
}

function tagEmoji(tag: string): string {
  const t = tag.toLowerCase();
  if (t === 'rv' || t === 'hookups') return 'RV';
  if (t === 'tent') return 'TENT';
  if (t === 'dispersed') return 'WILD';
  if (t === 'water') return 'H2O';
  if (t === 'showers') return 'SHWR';
  if (t === 'ada') return 'ADA';
  if (t === 'dogs' || t === 'dog friendly') return 'PET';
  if (t === 'free') return 'FREE';
  if (t === 'reservable') return 'RSV';
  if (t === 'usfs') return 'USFS';
  if (t === 'blm') return 'BLM';
  if (t === 'nps') return 'NPS';
  return '';
}

function stripHtml(text?: string | null) {
  if (!text) return '';
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function amenityIcon(name: string): keyof typeof Ionicons.glyphMap {
  const n = name.toLowerCase();
  if (n.includes('water')) return 'water-outline';
  if (n.includes('shower')) return 'rainy-outline';
  if (n.includes('toilet') || n.includes('restroom')) return 'male-female-outline';
  if (n.includes('electric') || n.includes('hookup')) return 'flash-outline';
  if (n.includes('dump') || n.includes('trash')) return 'trash-outline';
  if (n.includes('fire')) return 'flame-outline';
  if (n.includes('picnic')) return 'restaurant-outline';
  if (n.includes('wifi') || n.includes('internet')) return 'wifi-outline';
  if (n.includes('rv')) return 'car-outline';
  if (n.includes('pet') || n.includes('dog')) return 'paw-outline';
  return 'checkmark-circle-outline';
}

async function geocodePlaces(query: string): Promise<SearchPlace[]> {
  const coord = query.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
  if (coord && coord.length >= 2 && Math.abs(coord[0]) <= 90 && Math.abs(coord[1]) <= 180) {
    return [{ name: `${coord[0].toFixed(5)}, ${coord[1].toFixed(5)}`, lat: coord[0], lng: coord[1] }];
  }
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=8&countrycodes=us&q=${encodeURIComponent(query)}`,
    { headers: { 'User-Agent': 'TrailheadRouteBuilder/1.0' } }
  );
  const data = await res.json();
  return (data ?? []).map((p: any) => ({
    name: p.display_name?.split(',').slice(0, 3).join(',') ?? query,
    lat: Number(p.lat),
    lng: Number(p.lon),
  })).filter((p: SearchPlace) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
}

export default function RouteBuilderScreen() {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const router = useRouter();
  const mapRef = useRef<NativeMapHandle>(null);
  const setActiveTrip = useStore(st => st.setActiveTrip);
  const addTripToHistory = useStore(st => st.addTripToHistory);
  const userLoc = useStore(st => st.userLoc);
  const hasPlan = useStore(st => st.hasPlan);

  const [activeDay, setActiveDay] = useState(1);
  const [days, setDays] = useState([1]);
  const [stops, setStops] = useState<BuilderStop[]>([]);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [routeName, setRouteName] = useState('');
  const [searchResults, setSearchResults] = useState<SearchPlace[]>([]);
  const [pendingType, setPendingType] = useState<BuilderStopType>('waypoint');
  const [discoverTab, setDiscoverTab] = useState<DiscoveryTab>('camps');
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [camps, setCamps] = useState<CampsitePin[]>([]);
  const [gas, setGas] = useState<GasStation[]>([]);
  const [pois, setPois] = useState<OsmPoi[]>([]);
  const [selectedCamp, setSelectedCamp] = useState<CampsitePin | null>(null);
  const [campDetail, setCampDetail] = useState<CampsiteDetail | null>(null);
  const [campWeather, setCampWeather] = useState<WeatherForecast | null>(null);
  const [campFullness, setCampFullness] = useState<CampFullness | null>(null);
  const [campInsight, setCampInsight] = useState<CampsiteInsight | null>(null);
  const [showCampDetail, setShowCampDetail] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [paywallVisible, setPaywallVisible] = useState(false);
  const [paywallCode, setPaywallCode] = useState('camp_detail');
  const [paywallMessage, setPaywallMessage] = useState('Use credits or Explorer to open full campsite profiles. You can still add this camp to your route from the free preview.');

  const dayStops = stops.filter(st => st.day === activeDay);
  const orderedStops = [...stops].sort((a, b) => a.day - b.day || stops.indexOf(a) - stops.indexOf(b));
  const mapWaypoints = orderedStops.map(st => ({ lat: st.lat, lng: st.lng, name: st.name, day: st.day, type: st.type }));
  const anchor = [...dayStops].reverse()[0] ?? [...stops].reverse()[0] ?? (userLoc ? { lat: userLoc.lat, lng: userLoc.lng, name: 'Current location' } : null);
  const previousDayEnd = [...orderedStops].reverse().find(st => st.day < activeDay) ?? null;
  const activeDayDestination = [...dayStops].reverse().find(st => st.type !== 'fuel' && st.type !== 'waypoint') ?? [...dayStops].reverse()[0] ?? null;
  const legContext = previousDayEnd && activeDayDestination
    ? {
        from: previousDayEnd,
        to: activeDayDestination,
        miles: haversineMi(previousDayEnd, activeDayDestination),
        center: midpoint(previousDayEnd, activeDayDestination),
      }
    : null;
  const discoverContextLabel = legContext && (discoverTab === 'gas' || discoverTab === 'poi')
    ? `Day ${Math.max(1, activeDay - 1)} to Day ${activeDay} · ${fmtMi(legContext.miles)}`
    : anchor ? anchor.name.split(',')[0] : 'add a stop first';

  const totals = useMemo(() => {
    let miles = 0;
    for (let i = 1; i < orderedStops.length; i++) miles += haversineMi(orderedStops[i - 1], orderedStops[i]);
    return { miles, stops: orderedStops.length, camps: orderedStops.filter(st => st.type === 'camp').length };
  }, [orderedStops]);
  const dayMileage = useMemo(() => {
    const out: Record<number, number> = {};
    for (const day of days) {
      const wps = orderedStops.filter(st => st.day === day);
      let miles = 0;
      for (let i = 1; i < wps.length; i++) miles += haversineMi(wps[i - 1], wps[i]);
      out[day] = miles;
    }
    return out;
  }, [days, orderedStops]);
  const routeChecks = useMemo(() => {
    const checks: { level: 'ok' | 'warn'; label: string; text: string }[] = [];
    if (orderedStops.length < 2) {
      checks.push({ level: 'warn', label: 'Need route', text: 'Add a start and at least one destination.' });
    }
    const noCampDays = days.filter(day => !orderedStops.some(st => st.day === day && (st.type === 'camp' || st.type === 'motel')));
    if (noCampDays.length) {
      checks.push({ level: 'warn', label: 'Overnight', text: `Add camp/lodging for day ${noCampDays[0]}.` });
    } else if (orderedStops.length) {
      checks.push({ level: 'ok', label: 'Overnight', text: 'Each day has an overnight stop.' });
    }
    const longDays = days.filter(day => (dayMileage[day] ?? 0) > 220);
    if (longDays.length) {
      checks.push({ level: 'warn', label: 'Long day', text: `Day ${longDays[0]} is ${fmtMi(dayMileage[longDays[0]])}. Add fuel or split it.` });
    } else if (orderedStops.length > 1) {
      checks.push({ level: 'ok', label: 'Pace', text: 'Day mileage looks manageable.' });
    }
    const fuelCount = orderedStops.filter(st => st.type === 'fuel').length;
    if (totals.miles > 160 && fuelCount === 0) {
      checks.push({ level: 'warn', label: 'Fuel', text: 'Add at least one fuel stop before remote stretches.' });
    } else if (fuelCount > 0) {
      checks.push({ level: 'ok', label: 'Fuel', text: `${fuelCount} fuel stop${fuelCount === 1 ? '' : 's'} added.` });
    }
    return checks.slice(0, 3);
  }, [days, orderedStops, dayMileage, totals.miles]);
  const discoverEmptyText = discoverTab === 'camps'
    ? 'Tap scan to find legal camps around your current route anchor.'
    : discoverTab === 'gas'
      ? 'Tap scan to find fuel near the current leg. Build Day 1 then Day 2 first for between-days search.'
      : 'Tap scan to find water, trailheads, viewpoints, peaks, and hot springs near this route.';

  function fly(lat: number, lng: number, zoom = 11) {
    mapRef.current?.flyTo(lat, lng, zoom);
  }

  function addStop(input: Omit<BuilderStop, 'id' | 'day'> & { day?: number }) {
    const stop: BuilderStop = {
      ...input,
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      day: input.day ?? activeDay,
    };
    setStops(prev => [...prev, stop]);
    fly(stop.lat, stop.lng, stop.type === 'camp' ? 12 : 11);
  }

  function addPlace(place: SearchPlace, type = pendingType) {
    addStop({
      name: place.name,
      lat: place.lat,
      lng: place.lng,
      type,
      description: type === 'start' ? 'Manual route start.' : 'Manual route stop.',
      land_type: type === 'fuel' || type === 'motel' ? 'town' : 'route',
      source: 'search',
    });
    setSearchResults([]);
    setQuery('');
  }

  async function runSearch() {
    if (!query.trim()) return;
    setSearching(true);
    try {
      setSearchResults(await geocodePlaces(query.trim()));
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }

  async function discover() {
    const useLeg = !!legContext && (discoverTab === 'gas' || discoverTab === 'poi');
    const target = useLeg ? legContext!.center : anchor;
    if (!target) {
      Alert.alert('Add a stop first', 'Start with a city, address, or map point, then discover camps, fuel, and POIs nearby.');
      return;
    }
    setDiscoverLoading(true);
    fly(target.lat, target.lng, useLeg ? 8 : 9);
    try {
      if (discoverTab === 'camps') {
        setCamps(await api.getNearbyCamps(target.lat, target.lng, 65, []));
      } else if (discoverTab === 'gas') {
        const radius = useLeg ? Math.min(90, Math.max(35, legContext!.miles / 2 + 12)) : 35;
        const stations = await api.getGas(target.lat, target.lng, radius);
        setGas(useLeg
          ? stations
              .map(st => ({ ...st, route_distance_mi: pointSegmentDistanceMi(st, legContext!.from, legContext!.to) }))
              .filter(st => (st.route_distance_mi ?? 999) <= Math.max(18, Math.min(45, legContext!.miles * 0.45)))
              .sort((a, b) => (a.route_distance_mi ?? 999) - (b.route_distance_mi ?? 999))
          : stations);
      } else {
        const radius = useLeg ? Math.min(85, Math.max(35, legContext!.miles / 2 + 16)) : 40;
        const found = await api.getOsmPois(target.lat, target.lng, radius, 'water,trailhead,viewpoint,peak,hot_spring');
        setPois(useLeg
          ? found
              .map(poi => ({ ...poi, route_distance_mi: pointSegmentDistanceMi(poi, legContext!.from, legContext!.to) } as OsmPoi & { route_distance_mi: number }))
              .filter(poi => poi.route_distance_mi <= Math.max(20, Math.min(50, legContext!.miles * 0.5)))
              .sort((a, b) => a.route_distance_mi - b.route_distance_mi)
          : found);
      }
    } catch {
      Alert.alert('Search failed', 'Could not load nearby stops right now.');
    } finally {
      setDiscoverLoading(false);
    }
  }

  function addCamp(camp: CampsitePin) {
    addStop({
      name: camp.name,
      lat: camp.lat,
      lng: camp.lng,
      type: 'camp',
      description: camp.description || 'Camp selected in Route Builder.',
      land_type: camp.land_type || 'camp',
      source: 'camp',
      camp,
    });
  }

  function addGas(station: GasStation) {
    addStop({
      name: station.name,
      lat: station.lat,
      lng: station.lng,
      type: 'fuel',
      description: station.address || 'Fuel stop selected in Route Builder.',
      land_type: 'town',
      source: 'gas',
      gas: station,
    });
  }

  function addPoi(poi: OsmPoi) {
    addStop({
      name: poi.name || poi.type,
      lat: poi.lat,
      lng: poi.lng,
      type: 'waypoint',
      description: `${poi.type.replace(/_/g, ' ')} stop selected in Route Builder.`,
      land_type: 'route',
      source: 'poi',
      poi,
    });
  }

  function removeStop(id: string) {
    setStops(prev => prev.filter(st => st.id !== id));
  }

  function moveStop(id: string, dir: -1 | 1) {
    setStops(prev => {
      const dayList = prev.filter(st => st.day === activeDay);
      const idx = dayList.findIndex(st => st.id === id);
      const swap = idx + dir;
      if (idx < 0 || swap < 0 || swap >= dayList.length) return prev;
      const nextDayList = [...dayList];
      [nextDayList[idx], nextDayList[swap]] = [nextDayList[swap], nextDayList[idx]];
      const next: BuilderStop[] = [];
      for (const st of prev) {
        if (st.day === activeDay) {
          const replacement = nextDayList.shift();
          if (replacement) next.push(replacement);
        } else {
          next.push(st);
        }
      }
      return next;
    });
  }

  async function openCampDetail(camp: CampsitePin) {
    setSelectedCamp(camp);
    setCampDetail(null);
    setCampInsight(null);
    setShowCampDetail(false);
    setCampWeather(null);
    setCampFullness(null);
    fly(camp.lat, camp.lng, 13);
    api.getWeather(camp.lat, camp.lng, 3).then(setCampWeather).catch(() => {});
    if (camp.id) api.getCampFullness(camp.id).then(setCampFullness).catch(() => {});
  }

  async function loadFullCampDetail() {
    if (!selectedCamp) return;
    setDetailLoading(true);
    try {
      const detail = await api.getCampsiteDetail(selectedCamp.id);
      const insight = await api.getCampsiteInsight({
        name: selectedCamp.name,
        lat: selectedCamp.lat,
        lng: selectedCamp.lng,
        description: stripHtml(detail.description || selectedCamp.description),
        land_type: detail.land_type || selectedCamp.land_type,
        amenities: detail.amenities ?? [],
        facility_id: selectedCamp.id ?? '',
      });
      setCampDetail({ ...detail, description: stripHtml(detail.description) });
      setCampInsight(insight);
      setShowCampDetail(true);
    } catch (e: any) {
      if (e instanceof PaywallError) {
        setPaywallCode(e.code || 'camp_detail');
        setPaywallMessage(e.message || 'Use credits or Explorer to open full campsite profiles. You can still add this camp to your route from the free preview.');
        setPaywallVisible(true);
      } else {
        Alert.alert('Camp details unavailable', 'This camp does not have a full profile yet.');
      }
    } finally {
      setDetailLoading(false);
    }
  }

  function addDay() {
    const next = Math.max(...days) + 1;
    setDays(prev => [...prev, next]);
    setActiveDay(next);
  }

  function resolvedRouteName() {
    const clean = routeName.trim();
    if (clean) return clean;
    const first = orderedStops[0]?.name?.split(',')[0]?.trim();
    const last = orderedStops[orderedStops.length - 1]?.name?.split(',')[0]?.trim();
    if (first && last && first !== last) return `${first} to ${last}`;
    if (last) return `${last} Route`;
    return 'Manual Route';
  }

  function buildTrip(): TripResult {
    const sorted = orderedStops;
    const waypoints: Waypoint[] = sorted.map(st => ({
      day: st.day,
      name: st.name,
      type: st.type,
      description: st.description,
      land_type: st.land_type,
      lat: st.lat,
      lng: st.lng,
      verified_source: st.source === 'camp' ? st.camp?.verified_source ?? 'manual' : 'manual',
      verified_match: true,
    }));
    const daily_itinerary = days.map(day => {
      const wps = sorted.filter(st => st.day === day);
      let miles = 0;
      for (let i = 1; i < wps.length; i++) miles += haversineMi(wps[i - 1], wps[i]);
      const first = wps[0]?.name?.split(',')[0] ?? 'Start';
      const last = wps[wps.length - 1]?.name?.split(',')[0] ?? 'Finish';
      return {
        day,
        title: `Day ${day}: ${first} to ${last}`,
        description: wps.length
          ? `Manual route day with ${wps.length} planned stop${wps.length === 1 ? '' : 's'}.`
          : 'Open day. Add a destination, fuel, POIs, and camp.',
        est_miles: Math.round(miles),
        road_type: 'mixed',
        highlights: wps.filter(st => st.type === 'waypoint' || st.type === 'camp').slice(0, 3).map(st => st.name),
      };
    });
    const campsites = sorted.filter(st => st.camp).map(st => ({ ...st.camp!, recommended_day: st.day }));
    const gas_stations = sorted.filter(st => st.gas).map(st => ({ ...st.gas!, recommended_day: st.day }));
    return {
      trip_id: `manual_${Date.now()}`,
      plan: {
        trip_name: resolvedRouteName(),
        overview: 'A manually built Trailhead route with user-selected stops, fuel, POIs, and camps.',
        duration_days: days.length,
        states: [],
        total_est_miles: Math.round(totals.miles),
        waypoints,
        daily_itinerary,
        logistics: {
          vehicle_recommendation: 'User-built route. Review road surfaces before departure.',
          fuel_strategy: 'Fuel stops are manually selected. Add fuel before remote stretches.',
          water_strategy: 'Carry water for each day and add water POIs where needed.',
          permits_needed: 'Check local land manager rules for selected camps and trailheads.',
          best_season: 'Verify seasonal closures and weather before departure.',
        },
      },
      campsites,
      gas_stations,
      route_pois: sorted.filter(st => st.poi).map(st => st.poi!),
    };
  }

  async function saveRoute(openMap = true) {
    if (orderedStops.length < 2) {
      Alert.alert('Add more stops', 'Add at least a start and one destination before saving the route.');
      return;
    }
    const trip = buildTrip();
    setRouteName(trip.plan.trip_name);
    setActiveTrip(trip);
    addTripToHistory({
      trip_id: trip.trip_id,
      trip_name: trip.plan.trip_name,
      states: [],
      duration_days: trip.plan.duration_days,
      est_miles: trip.plan.total_est_miles,
      planned_at: Date.now(),
    });
    await saveOfflineTrip(trip).catch(() => {});
    if (openMap) router.push('/map');
  }

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <View>
          <Text style={s.kicker}>MANUAL PLANNER</Text>
          <Text style={s.title}>Route Builder</Text>
        </View>
        <TouchableOpacity style={s.headerBtn} onPress={() => saveRoute(false)}>
          <Ionicons name="save-outline" size={16} color={C.orange} />
          <Text style={s.headerBtnText}>SAVE</Text>
        </TouchableOpacity>
      </View>

      <View style={s.nameBar}>
        <Ionicons name="trail-sign-outline" size={15} color={C.orange} />
        <TextInput
          style={s.nameInput}
          value={routeName}
          onChangeText={setRouteName}
          placeholder="Name this route"
          placeholderTextColor={C.text3}
          returnKeyType="done"
        />
      </View>

      <View style={s.mapWrap}>
        <NativeMap
          ref={mapRef}
          waypoints={mapWaypoints}
          camps={camps}
          gas={gas.map(g => ({ lat: g.lat, lng: g.lng, name: g.name }))}
          pois={pois}
          reports={[]}
          communityPins={[]}
          searchMarker={anchor ? { lat: anchor.lat, lng: anchor.lng, name: anchor.name } : null}
          userLoc={userLoc}
          navMode={false}
          navIdx={0}
          navHeading={null}
          navSpeed={null}
          mapLayer="topo"
          routeOpts={{ avoidTolls: false, avoidHighways: false, backRoads: true, noFerries: true }}
          showLandOverlay={false}
          showUsgsOverlay={false}
          showTerrain={false}
          showMvum={false}
          showFire={false}
          showAva={false}
          showRadar={false}
          onMapReady={() => {
            if (anchor) fly(anchor.lat, anchor.lng, 8);
            else if (userLoc) fly(userLoc.lat, userLoc.lng, 9);
          }}
          onBoundsChange={() => {}}
          onMapTap={(lat, lng) => {
            if (lat == null || lng == null) return;
            addStop({
              name: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
              lat, lng,
              type: pendingType,
              description: 'Map-selected route stop.',
              land_type: pendingType === 'fuel' || pendingType === 'motel' ? 'town' : 'route',
              source: 'map',
            });
          }}
          onMapLongPress={() => {}}
          onCampTap={openCampDetail}
          onGasTap={station => addGas({ id: `gas_${station.lat}_${station.lng}`, name: station.name, lat: station.lat, lng: station.lng, fuel_types: '', address: '' })}
          onPoiTap={poi => addPoi({ id: `poi_${poi.lat}_${poi.lng}`, name: poi.name, lat: poi.lat, lng: poi.lng, type: poi.type as OsmPoi['type'] })}
          onTileCampTap={(name, _kind, lat, lng) => addStop({ name, lat, lng, type: 'camp', description: 'Map camp selected in Route Builder.', land_type: 'camp', source: 'map' })}
          onBaseCampTap={(name, lat, lng, landType) => addStop({ name, lat, lng, type: 'camp', description: 'Map camp selected in Route Builder.', land_type: landType, source: 'map' })}
          onTrailTap={(name, lat, lng) => addStop({ name, lat, lng, type: 'waypoint', description: 'Trail stop selected in Route Builder.', land_type: 'route', source: 'map' })}
          onWaypointTap={(idx) => {
            const st = orderedStops[idx];
            if (st) fly(st.lat, st.lng, 13);
          }}
          onRouteReady={() => {}}
          onRoutePersist={() => {}}
          onError={() => {}}
        />
        <View style={s.mapHint}>
          <Ionicons name="hand-left-outline" size={12} color="#fff" />
          <Text style={s.mapHintText}>Tap map to add selected stop type</Text>
        </View>
      </View>

      <ScrollView style={s.body} contentContainerStyle={s.bodyContent} showsVerticalScrollIndicator={false}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.dayTabs}>
          {days.map(day => (
            <TouchableOpacity key={day} style={[s.dayTab, activeDay === day && s.dayTabActive]} onPress={() => setActiveDay(day)}>
              <Text style={[s.dayTabText, activeDay === day && s.dayTabTextActive]}>DAY {day}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={s.dayAdd} onPress={addDay}>
            <Ionicons name="add" size={14} color={C.orange} />
          </TouchableOpacity>
        </ScrollView>

        <View style={s.typeRow}>
          {(['start', 'fuel', 'waypoint', 'camp', 'motel'] as BuilderStopType[]).map(type => (
            <TouchableOpacity key={type} style={[s.typeChip, pendingType === type && { borderColor: stopColor(type), backgroundColor: stopColor(type) + '18' }]} onPress={() => setPendingType(type)}>
              <Ionicons name={stopIcon(type)} size={13} color={pendingType === type ? stopColor(type) : C.text3} />
              <Text style={[s.typeChipText, pendingType === type && { color: stopColor(type) }]}>{type.toUpperCase()}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TourTarget id="routeBuilder.search">
          <View style={s.searchBox}>
            <Ionicons name="search" size={17} color={C.text3} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={runSearch}
              placeholder="Search city, address, trailhead, coordinates"
              placeholderTextColor={C.text3}
              style={s.searchInput}
              returnKeyType="search"
            />
            <TouchableOpacity style={s.searchBtn} onPress={runSearch} disabled={searching}>
              {searching ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.searchBtnText}>ADD</Text>}
            </TouchableOpacity>
          </View>
        </TourTarget>

        <View style={s.readinessCard}>
          <View style={s.readinessTop}>
            <View>
              <Text style={s.readinessTitle}>Route readiness</Text>
              <Text style={s.readinessSub}>Saved routes are available offline from search and trip history.</Text>
            </View>
            <View style={[s.readinessBadge, routeChecks.some(c => c.level === 'warn') ? s.readinessBadgeWarn : s.readinessBadgeOk]}>
              <Text style={[s.readinessBadgeText, routeChecks.some(c => c.level === 'warn') ? { color: C.yellow } : { color: C.green }]}>
                {routeChecks.some(c => c.level === 'warn') ? 'CHECK' : 'READY'}
              </Text>
            </View>
          </View>
          <View style={s.checkGrid}>
            {(routeChecks.length ? routeChecks : [{ level: 'warn' as const, label: 'Start', text: 'Add your first route stop.' }]).map(check => (
              <View key={`${check.label}-${check.text}`} style={s.checkRow}>
                <Ionicons name={check.level === 'ok' ? 'checkmark-circle-outline' : 'alert-circle-outline'} size={15} color={check.level === 'ok' ? C.green : C.yellow} />
                <View style={{ flex: 1 }}>
                  <Text style={s.checkLabel}>{check.label.toUpperCase()}</Text>
                  <Text style={s.checkText}>{check.text}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {searchResults.length > 0 && (
          <View style={s.resultsBox}>
            {searchResults.map(place => (
              <TouchableOpacity key={`${place.name}_${place.lat}`} style={s.resultRow} onPress={() => addPlace(place)}>
                <Ionicons name={stopIcon(pendingType)} size={15} color={stopColor(pendingType)} />
                <View style={{ flex: 1 }}>
                  <Text style={s.resultName} numberOfLines={1}>{place.name}</Text>
                  <Text style={s.resultMeta}>{place.lat.toFixed(4)}, {place.lng.toFixed(4)}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>DISCOVER NEAR ROUTE</Text>
          <Text style={s.sectionMeta}>{discoverContextLabel}</Text>
        </View>
        <View style={s.discoverHint}>
          <Ionicons name={legContext ? 'git-commit-outline' : 'locate-outline'} size={13} color={C.text3} />
          <Text style={s.discoverHintText}>
            {legContext && (discoverTab === 'gas' || discoverTab === 'poi')
              ? 'Searching between the previous day end and this day destination.'
              : 'Searching around the latest route anchor. Add another day to unlock between-days fuel and POI search.'}
          </Text>
        </View>
        <View style={s.discoverTabs}>
          {(['camps', 'gas', 'poi'] as DiscoveryTab[]).map(tab => (
            <TouchableOpacity key={tab} style={[s.discoverTab, discoverTab === tab && s.discoverTabActive]} onPress={() => setDiscoverTab(tab)}>
              <Text style={[s.discoverTabText, discoverTab === tab && s.discoverTabTextActive]}>{tab.toUpperCase()}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={s.discoverBtn} onPress={discover} disabled={discoverLoading}>
            {discoverLoading ? <ActivityIndicator size="small" color={C.orange} /> : <Ionicons name="scan-outline" size={15} color={C.orange} />}
          </TouchableOpacity>
        </View>

        {discoverTab === 'camps' && camps.slice(0, 12).map(camp => (
          <TouchableOpacity key={camp.id} style={s.candidateRow} onPress={() => openCampDetail(camp)}>
            <View style={[s.candidateIcon, { borderColor: '#14b8a666', backgroundColor: '#14b8a618' }]}>
              <Ionicons name="bonfire-outline" size={16} color="#14b8a6" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.candidateName} numberOfLines={1}>{camp.name}</Text>
              <Text style={s.candidateMeta} numberOfLines={1}>{camp.land_type || 'Camp'} · {camp.cost || 'See site'}</Text>
            </View>
            <TouchableOpacity style={s.useBtn} onPress={() => addCamp(camp)}>
              <Text style={s.useBtnText}>USE</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        ))}
        {discoverTab === 'camps' && camps.length === 0 && !discoverLoading && (
          <View style={s.emptyState}><Text style={s.emptyTitle}>No camp results loaded</Text><Text style={s.emptyText}>{discoverEmptyText}</Text></View>
        )}
        {discoverTab === 'gas' && gas.slice(0, 12).map(station => (
          <TouchableOpacity key={String(station.id)} style={s.candidateRow} onPress={() => { addGas(station); fly(station.lat, station.lng, 13); }}>
            <View style={[s.candidateIcon, { borderColor: '#eab30866', backgroundColor: '#eab30818' }]}>
              <Ionicons name="flash-outline" size={16} color="#eab308" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.candidateName} numberOfLines={1}>{station.name}</Text>
              <Text style={s.candidateMeta} numberOfLines={1}>
                {station.route_distance_mi != null ? `${fmtMi(station.route_distance_mi)} off leg · ` : ''}
                {station.address || station.fuel_types || 'Fuel stop'}
              </Text>
            </View>
          </TouchableOpacity>
        ))}
        {discoverTab === 'gas' && gas.length === 0 && !discoverLoading && (
          <View style={s.emptyState}><Text style={s.emptyTitle}>No fuel results loaded</Text><Text style={s.emptyText}>{discoverEmptyText}</Text></View>
        )}
        {discoverTab === 'poi' && pois.slice(0, 12).map(poi => (
          <TouchableOpacity key={poi.id} style={s.candidateRow} onPress={() => { addPoi(poi); fly(poi.lat, poi.lng, 13); }}>
            <View style={[s.candidateIcon, { borderColor: '#f9731666', backgroundColor: '#f9731618' }]}>
              <Ionicons name="navigate-outline" size={16} color="#f97316" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.candidateName} numberOfLines={1}>{poi.name || poi.type}</Text>
              <Text style={s.candidateMeta}>
                {(poi as any).route_distance_mi != null ? `${fmtMi((poi as any).route_distance_mi)} off leg · ` : ''}
                {poi.type.replace(/_/g, ' ')}
              </Text>
            </View>
          </TouchableOpacity>
        ))}
        {discoverTab === 'poi' && pois.length === 0 && !discoverLoading && (
          <View style={s.emptyState}><Text style={s.emptyTitle}>No POI results loaded</Text><Text style={s.emptyText}>{discoverEmptyText}</Text></View>
        )}

        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>DAY {activeDay} STOPS</Text>
          <Text style={s.sectionMeta}>{dayStops.length} stops</Text>
        </View>
        {dayStops.length === 0 ? (
          <View style={s.emptyState}>
            <Text style={s.emptyTitle}>Build the day in order</Text>
            <Text style={s.emptyText}>Start with a destination, then add fuel, POIs, and a camp. Tapping a stop flies the map to it.</Text>
          </View>
        ) : dayStops.map((st, idx) => (
          <TouchableOpacity key={st.id} style={s.stopRow} onPress={() => fly(st.lat, st.lng, 13)}>
            <View style={[s.stopNum, { backgroundColor: stopColor(st.type) }]}>
              <Text style={s.stopNumText}>{idx + 1}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.stopName} numberOfLines={1}>{st.name}</Text>
              <Text style={s.stopMeta}>{stopLabel(st.type).toUpperCase()} · {sourceLabel(st.source)}</Text>
            </View>
            <TouchableOpacity style={s.iconBtn} onPress={() => moveStop(st.id, -1)}>
              <Ionicons name="chevron-up" size={15} color={C.text3} />
            </TouchableOpacity>
            <TouchableOpacity style={s.iconBtn} onPress={() => moveStop(st.id, 1)}>
              <Ionicons name="chevron-down" size={15} color={C.text3} />
            </TouchableOpacity>
            <TouchableOpacity style={s.iconBtn} onPress={() => removeStop(st.id)}>
              <Ionicons name="trash-outline" size={15} color={C.red} />
            </TouchableOpacity>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={s.footer}>
        <View>
          <Text style={s.footerMiles}>{fmtMi(totals.miles)}</Text>
          <Text style={s.footerSub}>{totals.stops} stops · {totals.camps} camps · {days.length} days · offline saved</Text>
        </View>
        <TouchableOpacity style={s.previewBtn} onPress={() => saveRoute(true)}>
          <Ionicons name="map-outline" size={16} color="#fff" />
          <Text style={s.previewText}>SAVE & OPEN</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={!!selectedCamp} transparent animationType="slide" onRequestClose={() => setSelectedCamp(null)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setSelectedCamp(null)}>
          <View style={s.quickCard}>
            <View style={s.quickCardImg}>
              {selectedCamp?.photo_url ? (
                <Image source={{ uri: selectedCamp.photo_url }} style={s.quickCardPhoto} resizeMode="cover" />
              ) : (
                <View style={[s.quickCardPhotoPlaceholder, { backgroundColor: landColor(selectedCamp?.land_type).bg }]}>
                  <Ionicons name="bonfire-outline" size={34} color={landColor(selectedCamp?.land_type).text} />
                  <Text style={[s.placeholderLand, { color: landColor(selectedCamp?.land_type).text }]}>
                    {(selectedCamp?.land_type || 'CAMP').toUpperCase().slice(0, 12)}
                  </Text>
                </View>
              )}
            </View>
            <View style={s.quickCardBody}>
              <View style={s.quickCardHeader}>
                <Text style={s.quickCardName} numberOfLines={2}>{selectedCamp?.name}</Text>
                <TouchableOpacity style={s.quickCardClose} onPress={() => setSelectedCamp(null)}>
                  <Ionicons name="close" size={16} color={C.text3} />
                </TouchableOpacity>
              </View>
              {selectedCamp?.land_type ? (
                <View style={[s.landBadge, { backgroundColor: landColor(selectedCamp.land_type).bg, borderColor: landColor(selectedCamp.land_type).border }]}>
                  <Text style={[s.landBadgeText, { color: landColor(selectedCamp.land_type).text }]}>
                    {selectedCamp.land_type.toUpperCase()}
                  </Text>
                </View>
              ) : null}
              <View style={s.quickCardTags}>
                {(selectedCamp?.tags ?? []).slice(0, 5).map(t => (
                  <View key={t} style={s.qTag}>
                    <Text style={s.qTagText}>{tagEmoji(t) ? `${tagEmoji(t)} ` : ''}{t.toUpperCase()}</Text>
                  </View>
                ))}
                {selectedCamp?.ada && (
                  <View style={[s.qTag, { borderColor: '#3b82f6', backgroundColor: '#eff6ff' }]}>
                    <Text style={[s.qTagText, { color: '#1d4ed8' }]}>ADA</Text>
                  </View>
                )}
              </View>
              {selectedCamp?.cost ? (
                <Text style={s.quickCardCost}>{selectedCamp.reservable ? 'Reservable · ' : ''}{selectedCamp.cost}</Text>
              ) : null}
              <Text style={s.quickCardDesc} numberOfLines={3}>
                {stripHtml(selectedCamp?.description) || 'Camp profile preview. Full profile shows access notes, amenities, coordinates, and Trailhead camp brief.'}
              </Text>
            {campWeather?.daily?.time?.length ? (
              <View style={s.weatherStrip}>
                {[0, 1, 2].map(i => (
                  <View key={i} style={s.weatherDay}>
                    <Ionicons name={weatherIcon(campWeather.daily.weathercode?.[i] ?? 1)} size={18} color={C.orange} />
                    <Text style={s.weatherHiLo}>
                      {Math.round(campWeather.daily.temperature_2m_max?.[i] ?? 0)}°/{Math.round(campWeather.daily.temperature_2m_min?.[i] ?? 0)}°
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
            {campFullness?.status === 'full' ? (
              <View style={s.fullnessBanner}>
                <View style={s.fullnessBannerTop}>
                  <Ionicons name="warning" size={13} color={C.red} />
                  <Text style={s.fullnessBannerText}>REPORTED FULL · {campFullness.confirmations} confirmed</Text>
                </View>
              </View>
            ) : (
              <View style={s.reportFullBtn}>
                <Ionicons name="checkmark-circle-outline" size={13} color={C.green} />
                <Text style={[s.reportFullText, { color: C.green }]}>NO RECENT FULL REPORTS</Text>
              </View>
            )}
              <View style={s.quickCardActions}>
              <TouchableOpacity style={s.quickCardNav} onPress={() => { if (selectedCamp) addCamp(selectedCamp); setSelectedCamp(null); }}>
                <Ionicons name="add-circle-outline" size={13} color="#fff" />
                <Text style={s.quickCardNavText}>USE AS CAMP</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.quickCardFull} onPress={loadFullCampDetail} disabled={detailLoading}>
                {detailLoading ? <ActivityIndicator size="small" color={C.orange} /> : <Text style={s.quickCardFullText}>FULL PROFILE →</Text>}
              </TouchableOpacity>
              </View>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showCampDetail} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowCampDetail(false)}>
        <View style={s.detailModal}>
          {campDetail && (
            <ScrollView showsVerticalScrollIndicator={false}>
              {(campDetail.photos ?? []).length > 0 ? (
                <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={s.photoGallery}>
                  {(campDetail.photos ?? []).map((uri, i) => (
                    <Image key={i} source={{ uri }} style={s.galleryPhoto} resizeMode="cover" />
                  ))}
                </ScrollView>
              ) : (
                <View style={s.galleryPlaceholder}>
                  <Ionicons name="bonfire-outline" size={48} color={C.orange} />
                </View>
              )}

              <View style={s.detailContent}>
                <View style={s.detailHeader}>
                  <Text style={s.detailName}>{campDetail.name}</Text>
                  <TouchableOpacity style={s.detailClose} onPress={() => setShowCampDetail(false)}>
                    <Ionicons name="close" size={22} color={C.text} />
                  </TouchableOpacity>
                </View>
                <View style={s.detailTags}>
                  {campDetail.land_type ? (
                    <View style={[s.detailLandBadge, { backgroundColor: landColor(campDetail.land_type).bg, borderColor: landColor(campDetail.land_type).border }]}>
                      <Text style={[s.detailLandText, { color: landColor(campDetail.land_type).text }]}>{campDetail.land_type.toUpperCase()}</Text>
                    </View>
                  ) : null}
                  {(campDetail.tags ?? []).map(t => (
                    <View key={t} style={s.qTag}><Text style={s.qTagText}>{tagEmoji(t) ? `${tagEmoji(t)} ` : ''}{t.toUpperCase()}</Text></View>
                  ))}
                  {campDetail.ada && (
                    <View style={[s.qTag, { borderColor: '#3b82f6', backgroundColor: '#eff6ff' }]}>
                      <Text style={[s.qTagText, { color: '#1d4ed8' }]}>ADA</Text>
                    </View>
                  )}
                </View>
                <View style={s.detailMeta}>
                  <Text style={s.detailCost}>{campDetail.cost || 'See site'}</Text>
                  {(campDetail.verified_source || campDetail.source) ? (
                    <Text style={s.detailSiteCount}>{(campDetail.verified_source || campDetail.source || '').toUpperCase()}</Text>
                  ) : null}
                  {campDetail.campsites_count > 0 && <Text style={s.detailSiteCount}>{campDetail.campsites_count} sites</Text>}
                </View>
                {campDetail.description ? (
                  <View style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>ABOUT</Text>
                    <Text style={s.detailDesc}>{stripHtml(campDetail.description)}</Text>
                  </View>
                ) : null}
                {(campDetail.amenities ?? []).length > 0 && (
                  <View style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>AMENITIES</Text>
                    <View style={s.amenityGrid}>
                      {(campDetail.amenities ?? []).map(a => (
                        <View key={a} style={s.amenityItem}>
                          <Ionicons name={amenityIcon(a)} size={13} color={C.text2} />
                          <Text style={s.amenityText}>{a}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}
                {(campDetail.site_types ?? []).length > 0 && (
                  <View style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>SITE TYPES</Text>
                    <View style={s.amenityGrid}>
                      {(campDetail.site_types ?? []).map(st => (
                        <View key={st} style={[s.amenityItem, { backgroundColor: C.green + '12', borderColor: C.green + '55' }]}>
                          <Ionicons name="home-outline" size={13} color={C.green} />
                          <Text style={[s.amenityText, { color: C.green }]}>{st}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}
                {(campDetail.activities ?? []).length > 0 && (
                  <View style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>ACTIVITIES</Text>
                    <Text style={s.detailActivities}>{(campDetail.activities ?? []).join(' · ')}</Text>
                  </View>
                )}
                <View style={s.detailSection}>
                  <Text style={s.detailSectionTitle}>COORDINATES</Text>
                  <Text style={s.coordText}>{campDetail.lat.toFixed(6)}, {campDetail.lng.toFixed(6)}</Text>
                  {campInsight?.coordinates_dms ? <Text style={s.coordDms}>{campInsight.coordinates_dms}</Text> : null}
                </View>
                {campInsight && (
                  <View style={s.detailSection}>
                    <View style={s.aiHeader}>
                      <Text style={s.detailSectionTitle}>TRAILHEAD BRIEF</Text>
                      {campInsight.star_rating ? (
                        <Text style={s.aiStars}>{'★'.repeat(campInsight.star_rating)}{'☆'.repeat(5 - campInsight.star_rating)}</Text>
                      ) : null}
                    </View>
                    {campInsight.insider_tip ? (
                      <View style={s.insiderTip}>
                        <Text style={s.insiderLabel}>INSIDER TIP</Text>
                        <Text style={s.insiderText}>{campInsight.insider_tip}</Text>
                      </View>
                    ) : null}
                    {campInsight.best_for ? <Text style={s.aiMeta}>Best for: {campInsight.best_for}</Text> : null}
                    {campInsight.best_season ? <Text style={s.aiMeta}>Best season: {campInsight.best_season}</Text> : null}
                    {campInsight.hazards ? (
                      <View style={s.hazardRow}>
                        <Ionicons name="warning-outline" size={13} color={C.yellow} />
                        <Text style={s.hazardText}>{campInsight.hazards}</Text>
                      </View>
                    ) : null}
                    {campInsight.nearby_highlights?.length ? (
                      <View style={{ marginTop: 8 }}>
                        {campInsight.nearby_highlights.map((h, i) => <Text key={i} style={s.nearbyItem}>• {h}</Text>)}
                      </View>
                    ) : null}
                  </View>
                )}
                <View style={s.detailActions}>
                  <TouchableOpacity style={s.detailUseBtn} onPress={() => { if (selectedCamp) addCamp(selectedCamp); setShowCampDetail(false); setSelectedCamp(null); }}>
                    <Ionicons name="add-circle-outline" size={15} color="#fff" />
                    <Text style={s.detailUseText}>USE AS CAMP</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          )}
        </View>
      </Modal>

      <PaywallModal visible={paywallVisible} code={paywallCode} message={paywallMessage} onClose={() => setPaywallVisible(false)} />
    </SafeAreaView>
  );
}

const makeStyles = (C: ColorPalette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderColor: C.border, backgroundColor: C.s1,
  },
  kicker: { color: C.orange, fontSize: 9, fontFamily: mono, fontWeight: '800', letterSpacing: 1 },
  title: { color: C.text, fontSize: 22, fontWeight: '900', letterSpacing: -0.4 },
  headerBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: C.orange + '55', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  headerBtnText: { color: C.orange, fontSize: 10, fontFamily: mono, fontWeight: '800' },
  nameBar: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderColor: C.border, backgroundColor: C.bg,
  },
  nameInput: {
    flex: 1, color: C.text, fontSize: 14, fontWeight: '700',
    borderWidth: 1, borderColor: C.border, borderRadius: 10,
    backgroundColor: C.s2, paddingHorizontal: 12, paddingVertical: 9,
  },
  mapWrap: { height: 250, backgroundColor: C.s2 },
  mapHint: { position: 'absolute', left: 12, bottom: 10, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.68)', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6 },
  mapHintText: { color: '#fff', fontSize: 10, fontFamily: mono },
  body: { flex: 1 },
  bodyContent: { padding: 14, paddingBottom: 110, gap: 12 },
  dayTabs: { gap: 8 },
  dayTab: { borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: C.s2 },
  dayTabActive: { borderColor: C.orange, backgroundColor: C.orange + '16' },
  dayTabText: { color: C.text3, fontSize: 10, fontFamily: mono, fontWeight: '800' },
  dayTabTextActive: { color: C.orange },
  dayAdd: { width: 34, height: 34, borderRadius: 10, borderWidth: 1, borderColor: C.orange + '55', alignItems: 'center', justifyContent: 'center' },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  typeChip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: C.border, borderRadius: 9, paddingHorizontal: 9, paddingVertical: 7, backgroundColor: C.s2 },
  typeChipText: { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '800' },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderColor: C.border, borderRadius: 12, backgroundColor: C.s2, paddingLeft: 12 },
  searchInput: { flex: 1, color: C.text, fontSize: 13, paddingVertical: 11 },
  searchBtn: { alignSelf: 'stretch', minWidth: 56, backgroundColor: C.orange, borderTopRightRadius: 11, borderBottomRightRadius: 11, alignItems: 'center', justifyContent: 'center' },
  searchBtnText: { color: '#fff', fontSize: 10, fontFamily: mono, fontWeight: '900' },
  readinessCard: { borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 12, backgroundColor: C.s1, gap: 10 },
  readinessTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  readinessTitle: { color: C.text, fontSize: 13, fontWeight: '900' },
  readinessSub: { color: C.text3, fontSize: 11, lineHeight: 16, marginTop: 2, maxWidth: 235 },
  readinessBadge: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 5 },
  readinessBadgeWarn: { borderColor: C.yellow + '66', backgroundColor: C.yellow + '14' },
  readinessBadgeOk: { borderColor: C.green + '66', backgroundColor: C.green + '14' },
  readinessBadgeText: { fontSize: 9, fontFamily: mono, fontWeight: '900', letterSpacing: 0.7 },
  checkGrid: { gap: 8 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  checkLabel: { color: C.text3, fontSize: 8, fontFamily: mono, fontWeight: '900', letterSpacing: 0.6 },
  checkText: { color: C.text2, fontSize: 11, lineHeight: 16, marginTop: 1 },
  resultsBox: { borderWidth: 1, borderColor: C.border, borderRadius: 12, overflow: 'hidden' },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, borderBottomWidth: 1, borderColor: C.border, backgroundColor: C.s1 },
  resultName: { color: C.text, fontSize: 13, fontWeight: '700' },
  resultMeta: { color: C.text3, fontSize: 10, fontFamily: mono, marginTop: 2 },
  sectionHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 4 },
  sectionTitle: { color: C.text, fontSize: 11, fontFamily: mono, fontWeight: '900', letterSpacing: 0.8 },
  sectionMeta: { color: C.text3, fontSize: 10, fontFamily: mono, maxWidth: 190 },
  discoverTabs: { flexDirection: 'row', gap: 8 },
  discoverTab: { flex: 1, alignItems: 'center', borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 9, backgroundColor: C.s2 },
  discoverTabActive: { borderColor: C.orange, backgroundColor: C.orange + '14' },
  discoverTabText: { color: C.text3, fontSize: 10, fontFamily: mono, fontWeight: '800' },
  discoverTabTextActive: { color: C.orange },
  discoverBtn: { width: 42, borderWidth: 1, borderColor: C.orange + '55', borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.orange + '10' },
  discoverHint: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 9, backgroundColor: C.s2 },
  discoverHintText: { flex: 1, color: C.text3, fontSize: 11, lineHeight: 16 },
  candidateRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, borderWidth: 1, borderColor: C.border, borderRadius: 12, backgroundColor: C.s1 },
  candidateIcon: { width: 34, height: 34, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  candidateName: { color: C.text, fontSize: 13, fontWeight: '800' },
  candidateMeta: { color: C.text3, fontSize: 10, marginTop: 2 },
  useBtn: { borderWidth: 1, borderColor: C.green + '66', backgroundColor: C.green + '14', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  useBtnText: { color: C.green, fontSize: 9, fontFamily: mono, fontWeight: '900' },
  emptyState: { borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 14, backgroundColor: C.s2 },
  emptyTitle: { color: C.text, fontSize: 14, fontWeight: '800', marginBottom: 4 },
  emptyText: { color: C.text3, fontSize: 12, lineHeight: 18 },
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 10, backgroundColor: C.s1 },
  stopNum: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  stopNumText: { color: '#fff', fontSize: 11, fontFamily: mono, fontWeight: '900' },
  stopName: { color: C.text, fontSize: 13, fontWeight: '800' },
  stopMeta: { color: C.text3, fontSize: 10, fontFamily: mono, marginTop: 2 },
  iconBtn: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: C.s2 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, paddingBottom: 22, backgroundColor: C.s1, borderTopWidth: 1, borderColor: C.border },
  footerMiles: { color: C.text, fontSize: 18, fontFamily: mono, fontWeight: '900' },
  footerSub: { color: C.text3, fontSize: 10, fontFamily: mono, marginTop: 2 },
  previewBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: C.green, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 12 },
  previewText: { color: '#fff', fontSize: 11, fontFamily: mono, fontWeight: '900', letterSpacing: 0.8 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  quickCard: {
    backgroundColor: C.s1,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    flexDirection: 'row',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 12,
  },
  quickCardImg: { width: 120 },
  quickCardPhoto: { width: 120, height: '100%' as any, borderTopLeftRadius: 20 },
  quickCardPhotoPlaceholder: {
    width: 120, minHeight: 180, alignItems: 'center', justifyContent: 'center',
    borderTopLeftRadius: 20, gap: 5,
  },
  placeholderLand: { fontSize: 9, fontFamily: mono, fontWeight: '800', marginTop: 2 },
  quickCardBody: { flex: 1, padding: 14, paddingBottom: 28, gap: 6 },
  quickCardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  quickCardName: { color: C.text, fontSize: 15, fontWeight: '800', flex: 1, lineHeight: 20 },
  quickCardClose: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: C.s3,
    alignItems: 'center', justifyContent: 'center',
  },
  landBadge: {
    alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 6, borderWidth: 1,
  },
  landBadgeText: { fontSize: 9, fontFamily: mono, fontWeight: '800', letterSpacing: 0.5 },
  quickCardTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  qTag: {
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.s2,
  },
  qTagText: { color: C.text2, fontSize: 9, fontFamily: mono, fontWeight: '700' },
  quickCardCost: { color: C.green, fontSize: 11, fontFamily: mono, fontWeight: '700' },
  quickCardDesc: { color: C.text2, fontSize: 12, lineHeight: 17 },
  quickCardActions: { flexDirection: 'row', gap: 8, marginTop: 2 },
  quickCardNav: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
    backgroundColor: C.green,
  },
  quickCardNavText: { color: '#fff', fontSize: 11, fontFamily: mono, fontWeight: '800' },
  quickCardFull: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 8, borderRadius: 10,
    borderWidth: 1.5, borderColor: C.orange,
  },
  quickCardFullText: { color: C.orange, fontSize: 11, fontFamily: mono, fontWeight: '800' },
  weatherStrip: { flexDirection: 'row', gap: 8 },
  weatherDay: { alignItems: 'center', flex: 1 },
  weatherHiLo: { fontSize: 9, fontFamily: mono, fontWeight: '700', color: C.text2, marginTop: 1 },
  fullnessBanner: {
    backgroundColor: C.red + '12', borderWidth: 1, borderColor: C.red + '55',
    borderRadius: 8, padding: 8, gap: 6,
  },
  fullnessBannerTop: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  fullnessBannerText: { flex: 1, color: C.red, fontSize: 10, fontFamily: mono, fontWeight: '800' },
  reportFullBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingVertical: 6, paddingHorizontal: 10, borderRadius: 7,
    borderWidth: 1, borderColor: C.green + '66', backgroundColor: C.s2,
    alignSelf: 'flex-start',
  },
  reportFullText: { color: C.green, fontSize: 10, fontFamily: mono, fontWeight: '700' },
  detailModal: { flex: 1, backgroundColor: C.bg },
  photoGallery: { height: 260 },
  galleryPhoto: { width: 400, height: 260 },
  galleryPlaceholder: {
    height: 200, backgroundColor: C.s1,
    alignItems: 'center', justifyContent: 'center',
  },
  detailContent: { padding: 20, backgroundColor: C.bg },
  detailHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 8 },
  detailName: { color: C.text, fontSize: 22, fontWeight: '800', flex: 1, lineHeight: 28 },
  detailClose: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: C.s2,
    alignItems: 'center', justifyContent: 'center',
  },
  detailTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  detailLandBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  detailLandText: { fontSize: 10, fontFamily: mono, fontWeight: '800', letterSpacing: 0.5 },
  detailMeta: { flexDirection: 'row', gap: 16, marginBottom: 16, alignItems: 'center' },
  detailCost: { color: C.green, fontSize: 14, fontFamily: mono, fontWeight: '800' },
  detailSiteCount: { color: C.text2, fontSize: 13, fontFamily: mono },
  detailSection: { marginBottom: 20 },
  detailSectionTitle: {
    color: C.text2, fontSize: 10, fontFamily: mono, fontWeight: '800',
    letterSpacing: 1.5, marginBottom: 10, borderBottomWidth: 1, borderColor: C.border, paddingBottom: 6,
  },
  detailDesc: { color: C.text, fontSize: 14, lineHeight: 22 },
  amenityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  amenityItem: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10,
    backgroundColor: C.s1, borderWidth: 1, borderColor: C.border,
    flexDirection: 'row', alignItems: 'center', gap: 5,
  },
  amenityText: { color: C.text, fontSize: 12, fontWeight: '500' },
  detailActivities: { color: C.text2, fontSize: 12, lineHeight: 20 },
  coordText: { color: C.text2, fontSize: 13, fontFamily: mono },
  coordDms: { color: C.text2, fontSize: 11, fontFamily: mono, marginTop: 4 },
  aiHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  aiStars: { color: C.yellow, fontSize: 14, marginBottom: 10 },
  insiderTip: { backgroundColor: C.orange + '14', borderRadius: 10, borderWidth: 1, borderColor: C.orange + '44', padding: 12, marginBottom: 8 },
  insiderLabel: { color: C.orange, fontSize: 9, fontFamily: mono, fontWeight: '800', marginBottom: 4 },
  insiderText: { color: C.text, fontSize: 13, lineHeight: 19 },
  aiMeta: { color: C.text2, fontSize: 12, marginBottom: 3 },
  hazardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 6, backgroundColor: C.yellow + '14', borderRadius: 8, padding: 8 },
  hazardText: { color: C.yellow, fontSize: 12, flex: 1, lineHeight: 17 },
  nearbyItem: { color: C.text2, fontSize: 12, marginBottom: 3 },
  detailActions: { gap: 10, marginTop: 8, marginBottom: 28 },
  detailUseBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 15, borderRadius: 14, backgroundColor: C.green,
  },
  detailUseText: { color: '#fff', fontSize: 14, fontFamily: mono, fontWeight: '800' },
});

function weatherIcon(code: number): keyof typeof Ionicons.glyphMap {
  if ([0, 1].includes(code)) return 'sunny-outline';
  if ([2, 3].includes(code)) return 'cloud-outline';
  if ([45, 48].includes(code)) return 'reorder-three-outline';
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return 'rainy-outline';
  if ([71, 73, 75, 85, 86].includes(code)) return 'snow-outline';
  if ([95, 96, 99].includes(code)) return 'thunderstorm-outline';
  return 'cloud-outline';
}
