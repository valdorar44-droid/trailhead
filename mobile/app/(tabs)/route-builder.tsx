import { useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput,
  ActivityIndicator, Modal, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import NativeMap, { NativeMapHandle } from '@/components/NativeMap';
import PaywallModal from '@/components/PaywallModal';
import { api, CampFullness, CampsiteDetail, CampsitePin, GasStation, OsmPoi, PaywallError, TripResult, Waypoint, WeatherForecast } from '@/lib/api';
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
  const [detailLoading, setDetailLoading] = useState(false);
  const [paywallVisible, setPaywallVisible] = useState(false);

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
      setCampDetail(await api.getCampsiteDetail(selectedCamp.id));
    } catch (e: any) {
      if (e instanceof PaywallError) {
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
        trip_name: 'Manual Route Builder Trip',
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
              <Text style={s.stopMeta}>{st.type.toUpperCase()} · {st.source ?? 'manual'}</Text>
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
          <Text style={s.footerSub}>{totals.stops} stops · {totals.camps} camps · {days.length} days</Text>
        </View>
        <TouchableOpacity style={s.previewBtn} onPress={() => saveRoute(true)}>
          <Ionicons name="map-outline" size={16} color="#fff" />
          <Text style={s.previewText}>OPEN MAP</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={!!selectedCamp} transparent animationType="slide" onRequestClose={() => setSelectedCamp(null)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setSelectedCamp(null)}>
          <View style={s.campSheet}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle} numberOfLines={2}>{selectedCamp?.name}</Text>
            <Text style={s.sheetMeta}>{selectedCamp?.land_type || 'Camp'} · {selectedCamp?.cost || 'See site'}</Text>
            <Text style={s.sheetDesc} numberOfLines={campDetail ? undefined : 3}>
              {campDetail?.description || selectedCamp?.description || 'Camp profile preview. Full details show amenities, photos, activities, coordinates, and access notes.'}
            </Text>
            {campWeather?.daily?.time?.length ? (
              <View style={s.weatherStrip}>
                {[0, 1, 2].map(i => (
                  <View key={i} style={s.weatherDay}>
                    <Ionicons name={weatherIcon(campWeather.daily.weathercode?.[i] ?? 1)} size={18} color={C.orange} />
                    <Text style={s.weatherTemp}>
                      {Math.round(campWeather.daily.temperature_2m_max?.[i] ?? 0)}°/{Math.round(campWeather.daily.temperature_2m_min?.[i] ?? 0)}°
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
            {campFullness?.status === 'full' ? (
              <View style={s.fullBanner}>
                <Ionicons name="warning" size={13} color={C.red} />
                <Text style={s.fullBannerText}>REPORTED FULL · {campFullness.confirmations} confirmed</Text>
              </View>
            ) : (
              <View style={s.openBanner}>
                <Ionicons name="checkmark-circle-outline" size={13} color={C.green} />
                <Text style={s.openBannerText}>No recent full reports</Text>
              </View>
            )}
            {campDetail && (
              <View style={s.detailGrid}>
                {(campDetail.amenities ?? []).slice(0, 6).map(item => <Text key={item} style={s.detailPill}>{item}</Text>)}
                {(campDetail.site_types ?? []).slice(0, 4).map(item => <Text key={item} style={s.detailPill}>{item}</Text>)}
              </View>
            )}
            <View style={s.sheetActions}>
              <TouchableOpacity style={s.addCampBtn} onPress={() => { if (selectedCamp) addCamp(selectedCamp); setSelectedCamp(null); }}>
                <Text style={s.addCampText}>USE AS CAMP</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.fullDetailBtn} onPress={loadFullCampDetail} disabled={detailLoading}>
                {detailLoading ? <ActivityIndicator size="small" color={C.orange} /> : <Text style={s.fullDetailText}>FULL DETAILS</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      <PaywallModal visible={paywallVisible} code="camp_detail" message="Use credits or Explorer to open full campsite profiles. You can still add this camp to your route from the free preview." onClose={() => setPaywallVisible(false)} />
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
  campSheet: { backgroundColor: C.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderColor: C.border, padding: 20, paddingBottom: 34 },
  sheetHandle: { width: 38, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginBottom: 14 },
  sheetTitle: { color: C.text, fontSize: 18, fontWeight: '900', lineHeight: 22 },
  sheetMeta: { color: C.orange, fontSize: 11, fontFamily: mono, marginTop: 5, marginBottom: 10 },
  sheetDesc: { color: C.text2, fontSize: 13, lineHeight: 19 },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  detailPill: { color: C.text2, fontSize: 10, borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, backgroundColor: C.s2 },
  sheetActions: { flexDirection: 'row', gap: 9, marginTop: 16 },
  addCampBtn: { flex: 1, backgroundColor: C.green, borderRadius: 12, alignItems: 'center', paddingVertical: 12 },
  addCampText: { color: '#fff', fontSize: 11, fontFamily: mono, fontWeight: '900' },
  fullDetailBtn: { flex: 1, borderWidth: 1, borderColor: C.orange, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
  fullDetailText: { color: C.orange, fontSize: 10, fontFamily: mono, fontWeight: '900' },
  weatherStrip: { flexDirection: 'row', gap: 8, marginTop: 12 },
  weatherDay: { flex: 1, alignItems: 'center', borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 8, backgroundColor: C.s2 },
  weatherTemp: { color: C.text2, fontSize: 11, fontFamily: mono, marginTop: 3 },
  fullBanner: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 12, borderWidth: 1, borderColor: C.red + '66', backgroundColor: C.red + '14', borderRadius: 10, padding: 9 },
  fullBannerText: { color: C.red, fontSize: 10, fontFamily: mono, fontWeight: '800' },
  openBanner: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 12, borderWidth: 1, borderColor: C.green + '55', backgroundColor: C.green + '12', borderRadius: 10, padding: 9 },
  openBannerText: { color: C.green, fontSize: 10, fontFamily: mono, fontWeight: '800' },
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
