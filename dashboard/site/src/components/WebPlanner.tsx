import React, { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  Bot,
  Car,
  ChevronRight,
  Compass,
  Download,
  Filter,
  Layers,
  LocateFixed,
  LogIn,
  MapPin,
  Mountain,
  Plus,
  Route,
  Save,
  Search,
  Send,
  Smartphone,
  Tent,
  Trash2,
} from 'lucide-react';
import '../styles/planner.css';

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: { client_id: string; callback: (response: { credential?: string }) => void }) => void;
          prompt: () => void;
        };
      };
    };
    AppleID?: {
      auth?: {
        init: (config: { clientId: string; scope: string; redirectURI: string; usePopup: boolean }) => void;
        signIn: () => Promise<{ authorization?: { id_token?: string }; user?: { name?: { firstName?: string; lastName?: string }; email?: string } }>;
      };
    };
  }
}

type StopType = 'start' | 'waypoint' | 'camp' | 'fuel' | 'motel' | 'trailhead';
type RouteStyle = 'balanced' | 'direct' | 'adventure';
type MapLayer = 'standard' | 'satellite' | 'topo';

interface User {
  id: number;
  email: string;
  username: string;
  credits: number;
}

interface GeocodePlace {
  name: string;
  lat: number;
  lng: number;
  source?: string;
  place_id?: string;
}

interface Camp {
  id: string;
  name: string;
  lat: number;
  lng: number;
  tags?: string[];
  land_type?: string;
  description?: string;
  summary?: string;
  reservable?: boolean;
  url?: string;
  ada?: boolean;
  recommended_day?: number;
  route_distance_mi?: number;
  verified_source?: string;
  type?: string;
}

interface GasStation {
  id: number | string;
  name: string;
  lat: number;
  lng: number;
  fuel_types?: string;
  address?: string;
  recommended_day?: number;
}

interface OsmPoi {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type: string;
  subtype?: string;
  source?: string;
  address?: string;
  route_distance_mi?: number;
}

interface TrailProfile {
  id: string;
  name: string;
  summary?: string;
  lat: number;
  lng: number;
  length_mi?: number | null;
  difficulty?: string;
  activities?: string[];
  land_manager?: string;
  source_label?: string;
  geometry?: any;
  type?: string;
}

interface Pin {
  id: number;
  lat: number;
  lng: number;
  name: string;
  type: string;
  description?: string;
  land_type?: string;
  upvotes?: number;
  downvotes?: number;
}

interface ExcursionCandidate {
  id: string;
  name: string;
  type: string;
  subtype?: string;
  lat: number;
  lng: number;
  source: string;
  source_label: string;
  summary?: string;
  why_go?: string;
  access_notes?: string;
  risk_notes?: string;
  best_for?: string;
  distance_from_route_mi?: number;
  detour_mi?: number;
  drive_time_min?: number;
  day_fit?: string;
  offline_ready?: boolean;
  source_confidence?: string;
  sensitive_location?: boolean;
}

interface BuilderStop {
  id: string;
  day: number;
  name: string;
  lat: number;
  lng: number;
  type: StopType;
  description: string;
  land_type: string;
  camp?: Camp;
  gas?: GasStation;
  poi?: OsmPoi;
}

interface RouteGeometry {
  coords: [number, number][];
  steps?: any[];
  legs?: any[];
  totalDistance?: number;
  totalDuration?: number;
  source?: string;
}

interface TripResult {
  trip_id: string;
  plan: {
    trip_name: string;
    overview: string;
    duration_days: number;
    states: string[];
    total_est_miles: number;
    waypoints: any[];
    daily_itinerary: any[];
    logistics: Record<string, string>;
  };
  campsites: Camp[];
  gas_stations: GasStation[];
  route_pois?: OsmPoi[];
  route_geometry?: RouteGeometry;
  builder_state?: BuilderState;
}

interface SavedTrip {
  trip_id: string;
  trip_name: string;
  duration_days: number;
  est_miles: number;
  updated_at: number;
  source?: string;
}

interface BuilderState {
  stops: BuilderStop[];
  days: number[];
  routeStyle: RouteStyle;
  activeFilters: string[];
  activeLayer: MapLayer;
  overlays?: OverlayState;
  excursions?: ExcursionCandidate[];
}

type OverlayKey = 'publicLand' | 'usgs' | 'pois' | 'fire' | 'avalanche' | 'radar' | 'mvum';
type OverlayState = Record<OverlayKey, boolean>;

const TILE_BASE = 'https://tiles.gettrailhead.app';
const API = '';

const STOP_TYPES: Array<{ type: StopType; label: string }> = [
  { type: 'start', label: 'Start' },
  { type: 'waypoint', label: 'Waypoint' },
  { type: 'camp', label: 'Camp' },
  { type: 'fuel', label: 'Fuel' },
  { type: 'motel', label: 'Lodging' },
  { type: 'trailhead', label: 'Trailhead' },
];

const PLACE_FILTERS = [
  'fuel',
  'propane',
  'water',
  'dump',
  'shower',
  'laundromat',
  'lodging',
  'food',
  'grocery',
  'mechanic',
  'parking',
  'attraction',
  'trailhead',
  'viewpoint',
  'peak',
  'hot_spring',
];

const DEFAULT_FILTERS = ['fuel', 'propane', 'water', 'dump', 'trailhead'];
const DEFAULT_OVERLAYS: OverlayState = {
  publicLand: true,
  usgs: false,
  pois: true,
  fire: false,
  avalanche: false,
  radar: false,
  mvum: true,
};

const OVERLAY_ROWS: Array<{ key: OverlayKey; label: string; note: string }> = [
  { key: 'publicLand', label: 'Public Land Tint', note: 'BLM surface management tile overlay' },
  { key: 'usgs', label: 'USGS Topo + Trails', note: 'USGS topo raster under Trailhead labels' },
  { key: 'pois', label: 'Trailheads + Water POIs', note: 'Trailhead services and camp search layer' },
  { key: 'fire', label: 'Active Wildfires', note: 'Public fire source hook' },
  { key: 'avalanche', label: 'Avalanche Zones', note: 'Public avalanche source hook' },
  { key: 'radar', label: 'Rain Radar', note: 'Weather radar source hook' },
  { key: 'mvum', label: 'MVUM - USFS Roads & Trails', note: 'Trailhead trail tile roads and routes' },
];

function token() {
  return localStorage.getItem('trailhead_token') || '';
}

async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string> | undefined),
  };
  const auth = token();
  if (auth) headers.Authorization = `Bearer ${auth}`;
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(typeof err.detail === 'string' ? err.detail : err.detail?.message || err.detail?.reason || 'Request failed');
  }
  return res.json();
}

function loadScript(src: string) {
  if (document.querySelector(`script[src="${src}"]`)) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(script);
  });
}

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function cleanText(value?: string, max = 360) {
  if (!value) return '';
  const div = document.createElement('div');
  div.innerHTML = value;
  const text = (div.textContent || div.innerText || value)
    .replace(/\b(overview|about)\s*(overview|about)?\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, '')}...` : text;
}

function miles(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = 3958.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

function decodeValhallaShape(shape = ''): [number, number][] {
  let index = 0;
  let lat = 0;
  let lng = 0;
  const coords: [number, number][] = [];
  while (index < shape.length) {
    let result = 1;
    let shift = 0;
    let b: number;
    do {
      b = shape.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    lat += (result & 1) ? ~(result >> 1) : result >> 1;
    result = 1;
    shift = 0;
    do {
      b = shape.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    lng += (result & 1) ? ~(result >> 1) : result >> 1;
    coords.push([lng / 1e6, lat / 1e6]);
  }
  return coords;
}

function geojson(points: Array<{ lng: number; lat: number; [key: string]: any }>) {
  return {
    type: 'FeatureCollection',
    features: points
      .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      .map(p => ({
        type: 'Feature',
        properties: { ...p, description: cleanText(p.description, 520), summary: cleanText(p.summary, 260) },
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      })),
  };
}

function buildTrailheadStyle(layer: MapLayer, mapboxToken: string): any {
  const satellite = layer === 'satellite';
  const topo = layer === 'topo';
  const sources: any = {
    th: {
      type: 'vector',
      tiles: [`${TILE_BASE}/api/tiles/{z}/{x}/{y}.pbf`],
      minzoom: 0,
      maxzoom: 15,
      attribution: 'OpenStreetMap, Trailhead',
    },
    trailpacks: {
      type: 'vector',
      tiles: [`${TILE_BASE}/api/trails/{z}/{x}/{y}.pbf`],
      minzoom: 8,
      maxzoom: 15,
      attribution: 'OpenStreetMap, USFS MVUM',
    },
    contours: {
      type: 'vector',
      tiles: ['https://tiles.openstreetmap.us/vector/contours-feet/{z}/{x}/{y}.mvt'],
      minzoom: 8,
      maxzoom: 12,
      attribution: 'OpenStreetMap US',
    },
    publicland: {
      type: 'raster',
      tiles: [`${API}/api/land-tile/{z}/{y}/{x}`],
      tileSize: 256,
      maxzoom: 14,
    },
    usgs: {
      type: 'raster',
      tiles: ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 16,
    },
  };
  if (satellite && mapboxToken) {
    sources.sat = {
      type: 'raster',
      tiles: [`https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token=${mapboxToken}`],
      tileSize: 512,
      maxzoom: 19,
    };
  }

  const fillOpacity = satellite ? 0 : 1;
  const roadOpacity = satellite ? 0.86 : 1;
  const labelOpacity = satellite ? 0.95 : 1;
  const halo = satellite ? 'rgba(0,0,0,0.82)' : '#06100f';
  const layers: any[] = [
    { id: 'bg', type: 'background', paint: { 'background-color': satellite ? '#050706' : '#162118' } },
  ];
  if (sources.sat) layers.push({ id: 'satellite', type: 'raster', source: 'sat', paint: { 'raster-opacity': 1 } });
  if (topo) layers.push({ id: 'usgs-topo', type: 'raster', source: 'usgs', paint: { 'raster-opacity': 0.62 } });
  layers.push(
    { id: 'earth', type: 'fill', source: 'th', 'source-layer': 'earth', filter: ['==', ['get', 'kind'], 'earth'], paint: { 'fill-color': '#1b261c', 'fill-opacity': fillOpacity } },
    { id: 'landuse-park', type: 'fill', source: 'th', 'source-layer': 'landuse', filter: ['in', ['get', 'kind'], ['literal', ['national_park', 'park', 'nature_reserve', 'protected_area']]], paint: { 'fill-color': '#1a3322', 'fill-opacity': satellite ? 0.28 : 0.9 } },
    { id: 'landuse-forest', type: 'fill', source: 'th', 'source-layer': 'landuse', filter: ['in', ['get', 'kind'], ['literal', ['forest', 'wood']]], paint: { 'fill-color': '#162818', 'fill-opacity': satellite ? 0.22 : 0.86 } },
    { id: 'water-poly', type: 'fill', source: 'th', 'source-layer': 'water', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': satellite ? 'rgba(6,26,47,0.34)' : '#061a2f', 'fill-opacity': satellite ? 0.36 : 1 } },
    { id: 'water-line', type: 'line', source: 'th', 'source-layer': 'water', filter: ['in', ['get', 'kind'], ['literal', ['river', 'stream', 'canal']]], paint: { 'line-color': '#8fe3d9', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 12, 2.2], 'line-opacity': satellite ? 0.66 : 0.78 } },
    { id: 'public-land', type: 'raster', source: 'publicland', paint: { 'raster-opacity': 0.36 } },
    { id: 'contour-line', type: 'line', source: 'contours', 'source-layer': 'contours', minzoom: 10, paint: { 'line-color': topo ? '#ffe0a3' : '#a38a5c', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.35, 15, 1.2], 'line-opacity': topo ? 0.72 : 0.38 } },
    { id: 'road-casing', type: 'line', source: 'th', 'source-layer': 'roads', paint: { 'line-color': halo, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.1, 8, 2.4, 13, 6.4], 'line-opacity': roadOpacity } },
    { id: 'road-primary', type: 'line', source: 'th', 'source-layer': 'roads', filter: ['in', ['get', 'kind'], ['literal', ['highway', 'major_road', 'minor_road', 'path', 'track']]], paint: { 'line-color': ['match', ['coalesce', ['get', 'kind'], 'road'], 'highway', '#e89428', 'major_road', '#d99a3d', 'track', '#7cbf74', 'path', '#7cbf74', '#d8c7a8'], 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.9, 8, 1.8, 13, 4.4], 'line-opacity': roadOpacity } },
    { id: 'trail-pack-casing', type: 'line', source: 'trailpacks', 'source-layer': 'trails', minzoom: 9, paint: { 'line-color': halo, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 2.4, 14, 6.8], 'line-opacity': 0.78 } },
    { id: 'trail-pack-line', type: 'line', source: 'trailpacks', 'source-layer': 'trails', minzoom: 9, paint: { 'line-color': ['match', ['coalesce', ['get', 'trail_visual_class'], ['get', 'route_class'], ['get', 'kind'], 'unknown'], 'motorized', '#22c55e', 'mvum', '#22c55e', 'track', '#22c55e', 'hike', '#1d8cff', 'hiking', '#1d8cff', 'foot', '#1d8cff', 'footway', '#1d8cff', 'path', '#1d8cff', 'bike', '#f97316', 'bicycle', '#f97316', 'mtb', '#f97316', 'cycleway', '#f97316', 'horse', '#a855f7', 'bridleway', '#a855f7', 'restricted', '#ef4444', 'unknown', '#94a3b8', '#94a3b8'], 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.35, 14, 4.2], 'line-opacity': 0.94 } },
    { id: 'place-label', type: 'symbol', source: 'th', 'source-layer': 'places', minzoom: 4, layout: { 'text-field': ['coalesce', ['get', 'name'], ''], 'text-font': ['Noto Sans Medium'], 'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10, 10, 15], 'text-allow-overlap': false }, paint: { 'text-color': '#f7f3ea', 'text-halo-color': halo, 'text-halo-width': 1.4, 'text-opacity': labelOpacity } },
    { id: 'road-label', type: 'symbol', source: 'th', 'source-layer': 'roads', minzoom: 10, layout: { 'symbol-placement': 'line', 'text-field': ['coalesce', ['get', 'shield_text'], ['get', 'ref'], ['get', 'name'], ''], 'text-font': ['Noto Sans Medium'], 'text-size': 11, 'symbol-spacing': 420 }, paint: { 'text-color': '#f7d08a', 'text-halo-color': halo, 'text-halo-width': 1.4, 'text-opacity': labelOpacity } },
  );
  return { version: 8, glyphs: `${TILE_BASE}/api/fonts/{fontstack}/{range}.pbf`, sources, layers };
}

function buildTrip(stops: BuilderStop[], days: number[], routeStyle: RouteStyle, geometry: RouteGeometry | null, name = ''): TripResult {
  const ordered = [...stops].sort((a, b) => a.day - b.day || stops.indexOf(a) - stops.indexOf(b));
  const totalMiles = geometry?.totalDistance ?? ordered.slice(1).reduce((sum, st, idx) => sum + miles(ordered[idx], st), 0);
  const waypoints = ordered.map(st => ({
    day: st.day,
    name: st.name,
    type: st.type,
    description: st.description || `${st.type} stop`,
    land_type: st.land_type || 'route',
    lat: st.lat,
    lng: st.lng,
    verified_source: st.camp?.verified_source || st.poi?.source || 'web',
    verified_match: true,
  }));
  const daily_itinerary = days.map(day => {
    const dayStops = ordered.filter(st => st.day === day);
    const first = dayStops[0]?.name?.split(',')[0] || 'Start';
    const last = dayStops[dayStops.length - 1]?.name?.split(',')[0] || 'Finish';
    let dayMiles = 0;
    for (let i = 1; i < dayStops.length; i += 1) dayMiles += miles(dayStops[i - 1], dayStops[i]);
    return {
      day,
      title: `Day ${day}: ${first} to ${last}`,
      description: `${dayStops.length} planned stop${dayStops.length === 1 ? '' : 's'} from the web planner.`,
      est_miles: Math.round(dayMiles),
      road_type: routeStyle === 'adventure' ? 'backroads' : routeStyle === 'direct' ? 'direct' : 'mixed',
      highlights: dayStops.filter(st => st.type === 'camp' || st.type === 'trailhead' || st.type === 'waypoint').slice(0, 3).map(st => st.name),
    };
  });
  const start = ordered[0]?.name?.split(',')[0] || 'Trailhead';
  const end = ordered[ordered.length - 1]?.name?.split(',')[0] || 'Route';
  return {
    trip_id: `web_${Date.now()}`,
    plan: {
      trip_name: name || `${start} to ${end}`,
      overview: 'A Trailhead route built in the web planner with selected stops, camps, services, and trail context.',
      duration_days: days.length,
      states: [],
      total_est_miles: Math.round(totalMiles),
      waypoints,
      daily_itinerary,
      logistics: {
        vehicle_recommendation: `Review this ${routeStyle} route against your vehicle before driving.`,
        fuel_strategy: 'Add fuel stops before long remote stretches.',
        water_strategy: 'Carry backup water and verify seasonal sources.',
        permits_needed: 'Verify land manager rules, closures, and permits before driving.',
        best_season: 'Check weather, fire restrictions, closures, and road conditions before departure.',
      },
    },
    campsites: ordered.filter(st => st.camp).map(st => ({ ...st.camp!, recommended_day: st.day })),
    gas_stations: ordered.filter(st => st.gas).map(st => ({ ...st.gas!, recommended_day: st.day })),
    route_pois: ordered.filter(st => st.poi).map(st => st.poi!),
    route_geometry: geometry || undefined,
  };
}

function sourceRadiusFromMap(map: mapboxgl.Map) {
  const bounds = map.getBounds();
  const center = map.getCenter();
  const ne = bounds.getNorthEast();
  const sw = bounds.getSouthWest();
  const radius = Math.min(85, Math.max(8, miles({ lat: center.lat, lng: center.lng }, { lat: ne.lat, lng: ne.lng })));
  return { center, bounds, radius, n: ne.lat, e: ne.lng, s: sw.lat, w: sw.lng };
}

function setLayerVisibility(map: mapboxgl.Map, ids: string[], visible: boolean) {
  ids.forEach(id => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
  });
}

export default function WebPlanner() {
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const mapNode = useRef<HTMLDivElement | null>(null);
  const pendingTypeRef = useRef<StopType>('waypoint');
  const dayRef = useRef(1);
  const [mapReady, setMapReady] = useState(false);
  const [mapToken, setMapToken] = useState('');
  const [googleOAuthClientId, setGoogleOAuthClientId] = useState('');
  const [appleServiceId, setAppleServiceId] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('Planner ready.');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodePlace[]>([]);
  const [pendingType, setPendingType] = useState<StopType>('waypoint');
  const [day, setDay] = useState(1);
  const [days, setDays] = useState([1]);
  const [stops, setStops] = useState<BuilderStop[]>([]);
  const [routeStyle, setRouteStyle] = useState<RouteStyle>('balanced');
  const [routeGeometry, setRouteGeometry] = useState<RouteGeometry | null>(null);
  const [activeLayer, setActiveLayer] = useState<MapLayer>('standard');
  const [activeFilters, setActiveFilters] = useState(DEFAULT_FILTERS);
  const [overlays, setOverlays] = useState<OverlayState>(DEFAULT_OVERLAYS);
  const [camps, setCamps] = useState<Camp[]>([]);
  const [pois, setPois] = useState<OsmPoi[]>([]);
  const [trails, setTrails] = useState<TrailProfile[]>([]);
  const [pins, setPins] = useState<Pin[]>([]);
  const [excursions, setExcursions] = useState<ExcursionCandidate[]>([]);
  const [savedTrips, setSavedTrips] = useState<SavedTrip[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [aiText, setAiText] = useState('');
  const [aiReply, setAiReply] = useState('');
  const [savedTripId, setSavedTripId] = useState<string | null>(null);
  const [routeHealth, setRouteHealth] = useState<string>('checking');

  const activeTrip = useMemo(() => buildTrip(stops, days, routeStyle, routeGeometry, ''), [stops, days, routeStyle, routeGeometry]);

  useEffect(() => {
    pendingTypeRef.current = pendingType;
  }, [pendingType]);

  useEffect(() => {
    dayRef.current = day;
  }, [day]);

  useEffect(() => {
    api<{ mapbox_token: string; google_oauth_client_id?: string; apple_service_id?: string }>('/api/config')
      .then(cfg => {
        setMapToken(cfg.mapbox_token || '');
        setGoogleOAuthClientId(cfg.google_oauth_client_id || '');
        setAppleServiceId(cfg.apple_service_id || '');
      })
      .catch(() => setStatus('Map token is not configured.'));
    api<{ ok: boolean; error?: string }>('/api/route/health')
      .then(r => setRouteHealth(r.ok ? 'healthy' : (r.error || 'offline')))
      .catch(() => setRouteHealth('offline'));
    if (token()) {
      api<User>('/api/auth/me').then(setUser).catch(() => localStorage.removeItem('trailhead_token'));
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    api<{ trips: SavedTrip[] }>('/api/trips').then(r => setSavedTrips(r.trips || [])).catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!mapNode.current || mapRef.current) return;
    const map = new mapboxgl.Map({
      container: mapNode.current,
      style: buildTrailheadStyle(activeLayer, mapToken),
      center: [-111.8, 39.4],
      zoom: 4.2,
      pitch: 0,
      maxPitch: 70,
    });
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    map.on('load', () => {
      addPlannerSources(map);
      applyOverlayVisibility(map, overlays, activeFilters);
      setMapReady(true);
      scanVisibleMap(map).catch(() => {});
    });
    map.on('style.load', () => {
      addPlannerSources(map);
      applyOverlayVisibility(map, overlays, activeFilters);
      syncMapData(map, stops, routeGeometry, camps, pois, pins, trails, excursions);
    });
    map.on('click', e => {
      const type = pendingTypeRef.current;
      const name = `${STOP_TYPES.find(t => t.type === type)?.label || 'Stop'} pin`;
      setStops(prev => [...prev, {
        id: uid(type),
        day: dayRef.current,
        name,
        lat: e.lngLat.lat,
        lng: e.lngLat.lng,
        type,
        description: `${type} added from web planner.`,
        land_type: type === 'camp' ? 'camp' : type === 'fuel' || type === 'motel' ? 'town' : 'route',
      }]);
      setStatus(`${name} added.`);
    });
    ['camp-points', 'poi-points', 'pin-points', 'stop-points', 'trail-profile-points', 'excursion-points'].forEach(id => {
      map.on('click', id, e => {
        e.preventDefault();
        if (e.features?.[0]?.properties) setSelected(e.features[0].properties);
      });
      map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
    });
    map.on('moveend', () => {
      if (map.getZoom() >= 7) scanVisibleMap(map).catch(() => {});
    });
    mapRef.current = map;
    return () => map.remove();
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    syncMapData(map, stops, routeGeometry, camps, pois, pins, trails, excursions);
    fitRouteOrStops(map, stops, routeGeometry);
  }, [stops, routeGeometry, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    syncMapData(map, stops, routeGeometry, camps, pois, pins, trails, excursions);
  }, [camps, pois, pins, trails, excursions, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    applyOverlayVisibility(map, overlays, activeFilters);
  }, [overlays, activeFilters, mapReady]);

  function addPlannerSources(map: mapboxgl.Map) {
    if (!map.getSource('route')) map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } as any });
    if (!map.getSource('stops')) map.addSource('stops', { type: 'geojson', data: geojson([]) as any });
    if (!map.getSource('camps')) map.addSource('camps', { type: 'geojson', data: geojson([]) as any, cluster: true, clusterRadius: 46 });
    if (!map.getSource('pois')) map.addSource('pois', { type: 'geojson', data: geojson([]) as any, cluster: true, clusterRadius: 40 });
    if (!map.getSource('pins')) map.addSource('pins', { type: 'geojson', data: geojson([]) as any, cluster: true, clusterRadius: 40 });
    if (!map.getSource('trailprofiles')) map.addSource('trailprofiles', { type: 'geojson', data: geojson([]) as any });
    if (!map.getSource('excursions')) map.addSource('excursions', { type: 'geojson', data: geojson([]) as any, cluster: true, clusterRadius: 42 });
    const layers: any[] = [
      { id: 'route-halo', type: 'line', source: 'route', paint: { 'line-color': '#06100f', 'line-width': 9, 'line-opacity': 0.58 } },
      { id: 'route-line', type: 'line', source: 'route', paint: { 'line-color': '#00a7ff', 'line-width': 5, 'line-opacity': 0.96 } },
      { id: 'camp-clusters', type: 'circle', source: 'camps', filter: ['has', 'point_count'], paint: { 'circle-color': '#7cbf74', 'circle-radius': 18, 'circle-stroke-color': '#f7f3ea', 'circle-stroke-width': 1 } },
      { id: 'camp-points', type: 'circle', source: 'camps', filter: ['!', ['has', 'point_count']], paint: { 'circle-color': '#7cbf74', 'circle-radius': 8, 'circle-stroke-color': '#06100f', 'circle-stroke-width': 2 } },
      { id: 'poi-points', type: 'circle', source: 'pois', paint: { 'circle-color': '#8fe3d9', 'circle-radius': 6, 'circle-stroke-color': '#06100f', 'circle-stroke-width': 1.5 } },
      { id: 'trail-profile-points', type: 'circle', source: 'trailprofiles', paint: { 'circle-color': '#d99a3d', 'circle-radius': 6, 'circle-stroke-color': '#06100f', 'circle-stroke-width': 2 } },
      { id: 'excursion-clusters', type: 'circle', source: 'excursions', filter: ['has', 'point_count'], paint: { 'circle-color': '#8fe3d9', 'circle-radius': 17, 'circle-stroke-color': '#06100f', 'circle-stroke-width': 2 } },
      { id: 'excursion-points', type: 'circle', source: 'excursions', filter: ['!', ['has', 'point_count']], paint: { 'circle-color': ['match', ['get', 'type'], 'historic', '#e7d7bb', 'climbing', '#d99a3d', 'ohv', '#f97316', 'park', '#7cbf74', '#8fe3d9'], 'circle-radius': 7, 'circle-stroke-color': '#06100f', 'circle-stroke-width': 2 } },
      { id: 'pin-points', type: 'circle', source: 'pins', paint: { 'circle-color': '#f7f3ea', 'circle-radius': 7, 'circle-stroke-color': '#d99a3d', 'circle-stroke-width': 2 } },
      { id: 'stop-points', type: 'circle', source: 'stops', paint: { 'circle-color': ['match', ['get', 'type'], 'camp', '#7cbf74', 'fuel', '#8fe3d9', 'start', '#f7f3ea', '#d99a3d'], 'circle-radius': 9, 'circle-stroke-color': '#06100f', 'circle-stroke-width': 2.5 } },
    ];
    layers.forEach(layer => {
      if (!map.getLayer(layer.id)) map.addLayer(layer);
    });
  }

  function applyOverlayVisibility(map: mapboxgl.Map, next: OverlayState, filters = activeFilters) {
    setLayerVisibility(map, ['public-land'], next.publicLand);
    setLayerVisibility(map, ['usgs-topo', 'contour-line'], next.usgs || activeLayer === 'topo');
    setLayerVisibility(map, ['trail-pack-casing', 'trail-pack-line'], next.mvum);
    setLayerVisibility(map, ['poi-points'], next.pois && filters.length > 0);
    setLayerVisibility(map, ['camp-clusters', 'camp-points'], true);
    setLayerVisibility(map, ['trail-profile-points'], true);
    setLayerVisibility(map, ['excursion-clusters', 'excursion-points'], true);
  }

  function syncMapData(map: mapboxgl.Map, nextStops = stops, nextRoute = routeGeometry, nextCamps = camps, nextPois = pois, nextPins = pins, nextTrails = trails, nextExcursions = excursions) {
    (map.getSource('stops') as mapboxgl.GeoJSONSource | undefined)?.setData(geojson(nextStops) as any);
    const routeData = nextRoute?.coords?.length
      ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: nextRoute.coords } }] }
      : { type: 'FeatureCollection', features: [] };
    (map.getSource('route') as mapboxgl.GeoJSONSource | undefined)?.setData(routeData as any);
    (map.getSource('camps') as mapboxgl.GeoJSONSource | undefined)?.setData(geojson(nextCamps.map(c => ({ ...c, type: 'camp', description: cleanText(c.description, 520), summary: cleanText(c.summary || c.description, 220) }))) as any);
    (map.getSource('pois') as mapboxgl.GeoJSONSource | undefined)?.setData(geojson(nextPois) as any);
    (map.getSource('pins') as mapboxgl.GeoJSONSource | undefined)?.setData(geojson(nextPins) as any);
    (map.getSource('trailprofiles') as mapboxgl.GeoJSONSource | undefined)?.setData(geojson(nextTrails.map(t => ({ ...t, type: 'trailhead' }))) as any);
    (map.getSource('excursions') as mapboxgl.GeoJSONSource | undefined)?.setData(geojson(nextExcursions) as any);
  }

  function fitRouteOrStops(map: mapboxgl.Map, nextStops: BuilderStop[], nextRoute: RouteGeometry | null) {
    if (nextRoute?.coords?.length) {
      const bounds = nextRoute.coords.reduce((b, c) => b.extend(c), new mapboxgl.LngLatBounds(nextRoute.coords[0], nextRoute.coords[0]));
      map.fitBounds(bounds, { padding: { top: 120, left: 80, right: 460, bottom: 110 }, maxZoom: 10, duration: 650 });
    } else if (nextStops.length) {
      const bounds = nextStops.reduce((b, s) => b.extend([s.lng, s.lat]), new mapboxgl.LngLatBounds([nextStops[0].lng, nextStops[0].lat], [nextStops[0].lng, nextStops[0].lat]));
      map.fitBounds(bounds, { padding: { top: 120, left: 80, right: 460, bottom: 110 }, maxZoom: 12, duration: 450 });
    }
  }

  async function login(event?: React.FormEvent) {
    event?.preventDefault();
    const res = await api<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    localStorage.setItem('trailhead_token', res.token);
    setUser(res.user);
    setStatus(`Signed in as ${res.user.username}.`);
  }

  async function finishOAuth(provider: 'apple' | 'google', identityToken: string, fullName = '', providerEmail = '') {
    const res = await api<{ token: string; user: User }>(`/api/auth/oauth/${provider}`, {
      method: 'POST',
      body: JSON.stringify({ identity_token: identityToken, full_name: fullName, email: providerEmail }),
    });
    localStorage.setItem('trailhead_token', res.token);
    setUser(res.user);
    setStatus(`Signed in as ${res.user.username}.`);
  }

  async function loginWithGoogle() {
    if (!googleOAuthClientId) {
      setStatus('Google sign in is not configured yet.');
      return;
    }
    setStatus('Opening Google sign in...');
    await loadScript('https://accounts.google.com/gsi/client');
    window.google?.accounts?.id?.initialize({
      client_id: googleOAuthClientId,
      callback: response => {
        if (!response.credential) {
          setStatus('Google did not return a sign-in token.');
          return;
        }
        finishOAuth('google', response.credential).catch(err => setStatus(err.message || 'Google sign in failed.'));
      },
    });
    window.google?.accounts?.id?.prompt();
  }

  async function loginWithApple() {
    if (!appleServiceId) {
      setStatus('Apple sign in is not configured yet.');
      return;
    }
    setStatus('Opening Apple sign in...');
    await loadScript('https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js');
    window.AppleID?.auth?.init({
      clientId: appleServiceId,
      scope: 'name email',
      redirectURI: `${window.location.origin}${window.location.pathname}`,
      usePopup: true,
    });
    try {
      const result = await window.AppleID?.auth?.signIn();
      const identityToken = result?.authorization?.id_token || '';
      const name = result?.user?.name;
      const fullName = [name?.firstName, name?.lastName].filter(Boolean).join(' ');
      await finishOAuth('apple', identityToken, fullName, result?.user?.email || '');
    } catch (err: any) {
      setStatus(err?.message || 'Apple sign in was cancelled.');
    }
  }

  async function searchPlaces() {
    if (!query.trim()) return;
    setStatus('Searching places...');
    const list = await api<GeocodePlace[]>(`/api/geocode?q=${encodeURIComponent(query)}&limit=8`);
    setResults(list);
    setStatus(`${list.length} results.`);
  }

  function addStop(place: GeocodePlace, type = pendingType) {
    const stop: BuilderStop = {
      id: uid(type),
      day,
      name: place.name,
      lat: place.lat,
      lng: place.lng,
      type,
      description: `${type} added from web planner.`,
      land_type: type === 'camp' ? 'camp' : type === 'fuel' || type === 'motel' ? 'town' : 'route',
    };
    setStops(prev => [...prev, stop]);
    setResults([]);
    setQuery('');
    setStatus(`${place.name} added.`);
  }

  function addCamp(camp: Camp) {
    setStops(prev => [...prev, {
      id: uid('camp'),
      day,
      name: camp.name,
      lat: Number(camp.lat),
      lng: Number(camp.lng),
      type: 'camp',
      description: cleanText(camp.description || camp.summary, 700) || 'Camp selected from Trailhead data.',
      land_type: camp.land_type || 'camp',
      camp,
    }]);
  }

  function addPoi(poi: OsmPoi) {
    const type = poi.type === 'fuel' ? 'fuel' : poi.type === 'lodging' ? 'motel' : poi.type === 'trailhead' ? 'trailhead' : 'waypoint';
    setStops(prev => [...prev, {
      id: uid(type),
      day,
      name: poi.name,
      lat: Number(poi.lat),
      lng: Number(poi.lng),
      type,
      description: poi.address || poi.subtype || 'POI selected from Trailhead data.',
      land_type: poi.type === 'fuel' || poi.type === 'lodging' ? 'town' : 'route',
      poi,
    }]);
  }

  function addExcursion(item: ExcursionCandidate) {
    const poi: OsmPoi = {
      id: item.id,
      name: item.name,
      lat: item.lat,
      lng: item.lng,
      type: item.type,
      subtype: item.subtype || item.best_for || 'excursion',
      source: item.source,
      address: [item.day_fit, item.source_label].filter(Boolean).join(' - '),
      route_distance_mi: item.distance_from_route_mi,
    };
    setStops(prev => [...prev, {
      id: uid('waypoint'),
      day,
      name: item.name,
      lat: item.lat,
      lng: item.lng,
      type: item.type === 'trail' ? 'trailhead' : 'waypoint',
      description: cleanText([item.summary || item.why_go, item.access_notes ? `Access: ${item.access_notes}` : ''].filter(Boolean).join(' '), 900) || 'Excursion selected from Trailhead map data.',
      land_type: item.type,
      poi,
    }]);
    setSelected({ ...item, type: item.type || 'excursion' });
    setStatus(`${item.name} added as a Day ${day} side trip.`);
  }

  async function buildRouteLine() {
    if (stops.length < 2) {
      setStatus('Add at least two stops.');
      return;
    }
    if (routeHealth !== 'healthy') {
      setStatus(`Route engine is not healthy yet: ${routeHealth}. Pins are still saved.`);
      return;
    }
    try {
      setStatus('Building route...');
      const data = await api<any>('/api/route', {
        method: 'POST',
        body: JSON.stringify({
          locations: stops.map(st => ({ lat: st.lat, lon: st.lng, type: 'break' })),
          options: { backRoads: routeStyle === 'adventure', avoidHighways: routeStyle === 'adventure', avoidTolls: true },
          units: 'miles',
        }),
      });
      const legs = data.trip?.legs || [];
      const coords = legs.flatMap((leg: any) => decodeValhallaShape(leg.shape || ''));
      const totalDistance = data.trip?.summary?.length || coords.slice(1).reduce((sum: number, c: [number, number], idx: number) => {
        const prev = coords[idx];
        return sum + miles({ lng: prev[0], lat: prev[1] }, { lng: c[0], lat: c[1] });
      }, 0);
      setRouteGeometry({ coords, legs, totalDistance, totalDuration: data.trip?.summary?.time, source: 'valhalla' });
      setStatus(`Route built: ${Math.round(totalDistance)} mi.`);
    } catch (err: any) {
      setStatus(`Route build failed: ${err.message || 'route engine unavailable'}.`);
    }
  }

  async function scanVisibleMap(map = mapRef.current) {
    if (!map) return;
    const view = sourceRadiusFromMap(map);
    setStatus('Loading Trailhead map data...');
    const body = {
      bounds: { n: view.n, s: view.s, e: view.e, w: view.w },
      center: { lat: view.center.lat, lng: view.center.lng },
      radius: view.radius,
      filters: activeFilters,
      route: routeGeometry?.coords || [],
    };
    const [data, excursionData] = await Promise.all([
      api<{ camps: Camp[]; places: OsmPoi[]; pins: Pin[]; trails: TrailProfile[]; errors?: Record<string, string> }>('/api/planner/context', {
      method: 'POST',
      body: JSON.stringify(body),
      }).catch(async () => {
      const [campData, poiData, pinData, trailData] = await Promise.all([
        api<Camp[]>(`/api/camps/bbox?n=${view.n}&s=${view.s}&e=${view.e}&w=${view.w}&types=`).catch(() => []),
        api<OsmPoi[]>(`/api/places/nearby?lat=${view.center.lat}&lng=${view.center.lng}&radius=${view.radius}&categories=${encodeURIComponent(activeFilters.join(','))}&provider=auto`).catch(() => []),
        api<Pin[]>(`/api/pins?lat=${view.center.lat}&lng=${view.center.lng}&radius=${view.radius}`).catch(() => []),
        api<{ trails: TrailProfile[] }>(`/api/trails/discover?mode=view&n=${view.n}&s=${view.s}&e=${view.e}&w=${view.w}&limit=80`).catch(() => ({ trails: [] })),
      ]);
      return { camps: campData, places: poiData, pins: pinData, trails: trailData.trails || [], errors: {} };
      }),
      api<{ excursions: ExcursionCandidate[]; errors?: Record<string, string> }>('/api/excursions/nearby', {
        method: 'POST',
        body: JSON.stringify({
          center: body.center,
          radius: body.radius,
          route: body.route,
          source_context: routeGeometry?.coords?.length ? 'route' : 'map',
          categories: ['trail', 'ohv', 'viewpoint', 'peak', 'hot_spring', 'park', 'historic', 'climbing', 'water', 'attraction'],
        }),
      }).catch(() => ({ excursions: [] })),
    ]);
    setCamps((data.camps || []).map(c => ({ ...c, description: cleanText(c.description, 700), summary: cleanText(c.summary || c.description, 220) })));
    setPois(data.places || []);
    setPins(data.pins || []);
    setTrails(data.trails || []);
    setExcursions((excursionData.excursions || []).filter(item => !item.sensitive_location || item.source_confidence === 'high'));
    const errorCount = data.errors ? Object.keys(data.errors).length : 0;
    setStatus(`Loaded ${data.camps?.length || 0} camps, ${data.places?.length || 0} places, ${data.pins?.length || 0} pins, ${data.trails?.length || 0} trails, ${excursionData.excursions?.length || 0} side trips${errorCount ? ` (${errorCount} sources skipped)` : ''}.`);
  }

  async function saveTrip() {
    if (!user) {
      setStatus('Sign in to save this route to your account.');
      return;
    }
    if (stops.length < 2) {
      setStatus('Add at least two stops before saving.');
      return;
    }
    const trip = buildTrip(stops, days, routeStyle, routeGeometry, '');
    if (savedTripId) trip.trip_id = savedTripId;
    const body = {
      trip,
      route_geometry: routeGeometry,
      builder_state: { stops, days, routeStyle, activeFilters, activeLayer, overlays, excursions },
      source: 'web-planner',
      request: `Web route: ${trip.plan.trip_name}`,
    };
    const saved = await api<TripResult>(savedTripId ? `/api/trip/${savedTripId}` : '/api/trips', {
      method: savedTripId ? 'PUT' : 'POST',
      body: JSON.stringify(body),
    });
    setSavedTripId(saved.trip_id);
    setStatus('Saved to account. Open the phone app to pick it up.');
    const list = await api<{ trips: SavedTrip[] }>('/api/trips').catch(() => ({ trips: [] }));
    setSavedTrips(list.trips || []);
  }

  async function openTrip(id: string) {
    const trip = await api<TripResult>(`/api/trip/${id}`);
    const builder = trip.builder_state;
    if (builder?.stops?.length) {
      setStops(builder.stops);
      setDays(builder.days?.length ? builder.days : [1]);
      setRouteStyle(builder.routeStyle || 'balanced');
      setActiveFilters(builder.activeFilters?.length ? builder.activeFilters : DEFAULT_FILTERS);
      setActiveLayer(builder.activeLayer || 'standard');
      setOverlays({ ...DEFAULT_OVERLAYS, ...(builder.overlays || {}) });
      setExcursions(Array.isArray(builder.excursions) ? builder.excursions : []);
    } else {
      setStops((trip.plan.waypoints || []).filter(w => w.lat && w.lng).map((w, idx) => ({
        id: uid(`import_${idx}`),
        day: w.day || 1,
        name: w.name,
        lat: w.lat!,
        lng: w.lng!,
        type: (w.type as StopType) || 'waypoint',
        description: w.description || '',
        land_type: w.land_type || 'route',
      })));
      setDays(Array.from(new Set((trip.plan.daily_itinerary || []).map(d => d.day))).sort((a, b) => a - b));
    }
    setRouteGeometry(trip.route_geometry || null);
    setSavedTripId(trip.trip_id);
    setStatus(`Opened ${trip.plan.trip_name}.`);
  }

  async function askAi() {
    if (!aiText.trim()) return;
    setAiReply('Thinking...');
    const response = await api<{ content: string; trip?: TripResult }>('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: aiText, session_id: 'web-planner', current_trip: stops.length >= 2 ? activeTrip : undefined }),
    });
    setAiReply(response.content || 'Done.');
    if (response.trip) setStatus('AI returned a trip update. Save it when it looks right.');
  }

  async function submitPlanningPin() {
    if (!user || !selected?.lat || !selected?.lng) {
      setStatus('Select a map item and sign in to add a planning pin.');
      return;
    }
    await api('/api/pins', {
      method: 'POST',
      body: JSON.stringify({
        lat: Number(selected.lat),
        lng: Number(selected.lng),
        name: selected.name || 'Web planning pin',
        type: selected.type || 'poi',
        description: 'Added from the Trailhead web planner.',
        land_type: selected.land_type || 'unknown',
      }),
    });
    setStatus('Planning pin submitted.');
    scanVisibleMap().catch(() => {});
  }

  async function publishCommunityTrail() {
    if (!user) {
      setStatus('Sign in to publish community trails.');
      return;
    }
    const coords = routeGeometry?.coords?.length ? routeGeometry.coords : stops.map(st => [st.lng, st.lat] as [number, number]);
    if (coords.length < 2) {
      setStatus('Drop at least start and finish pins before publishing a trail.');
      return;
    }
    const midpoint = coords[Math.floor(coords.length / 2)];
    const name = activeTrip.plan.trip_name || 'Pinned community trail';
    const result = await api<{ ok: boolean; profile: TrailProfile; credits_earned?: number; new_balance?: number }>('/api/trails/community', {
      method: 'POST',
      body: JSON.stringify({
        name,
        summary: `Community trail route built from ${coords.length} web planner points.`,
        description: 'Submitted from Trailhead web planner pinned trail builder.',
        geometry: { type: 'LineString', coordinates: coords },
        trailheads: [
          { name: stops[0]?.name || 'Start', lat: coords[0][1], lng: coords[0][0], role: 'start' },
          { name: stops[stops.length - 1]?.name || 'Finish', lat: coords[coords.length - 1][1], lng: coords[coords.length - 1][0], role: 'finish' },
        ],
        activities: ['overland', 'trail'],
        difficulty: routeStyle === 'adventure' ? 'Backcountry' : 'Unrated',
        source_note: 'User-pinned route. Verify legality, closures, and conditions before driving.',
        lat: midpoint?.[1],
        lng: midpoint?.[0],
      }),
    });
    setStatus(`Community trail saved: ${result.profile.name}${result.credits_earned ? ` (+${result.credits_earned} credits)` : ''}.`);
    scanVisibleMap().catch(() => {});
  }

  function locateRoute() {
    const map = mapRef.current;
    if (!map) return;
    if (stops[0]) map.flyTo({ center: [stops[0].lng, stops[0].lat], zoom: Math.max(map.getZoom(), 9), duration: 650 });
    else navigator.geolocation?.getCurrentPosition(pos => map.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 10, duration: 650 }));
  }

  function setLayer(layer: MapLayer) {
    setActiveLayer(layer);
    const map = mapRef.current;
    if (map) map.setStyle(buildTrailheadStyle(layer, mapToken));
    setStatus(layer === 'satellite' ? 'Satellite selected. Trailhead route and camp layers stay on top.' : `${layer} selected.`);
  }

  function toggleOverlay(key: OverlayKey) {
    setOverlays(prev => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <main className="app-shell">
      <section className="map-pane">
        <div ref={mapNode} className="map" />
        {!mapToken && activeLayer === 'satellite' && <div className="map-empty app-panel">Satellite needs the Mapbox token. Standard and topo still use Trailhead tiles.</div>}
        <div className="topbar app-panel">
          <a className="brand" href="/">
            <img src="/assets/app-icon.png" alt="" />
            <span>Trailhead Planner</span>
          </a>
          <div className="topbar-actions">
            <button className="icon-btn" onClick={locateRoute} title="Fly to route or location"><LocateFixed size={18} /></button>
            <button className="icon-btn" onClick={buildRouteLine} title="Build route line"><Route size={18} /></button>
            <button className="save-btn" onClick={saveTrip}><Save size={17} /> Save</button>
          </div>
        </div>

        <div className="layer-card app-panel">
          <div className="card-title"><Layers size={17} /> Map</div>
          {(['standard', 'satellite', 'topo'] as MapLayer[]).map(layer => (
            <button key={layer} className={activeLayer === layer ? 'chip on' : 'chip'} onClick={() => setLayer(layer)}>{layer}</button>
          ))}
          <div className="card-title"><Filter size={17} /> Layers</div>
          <div className="map-overlay-list" aria-label="Trailhead map overlays">
            {OVERLAY_ROWS.map(row => (
              <button key={row.key} title={row.note} className={overlays[row.key] ? 'overlay-row on' : 'overlay-row'} onClick={() => toggleOverlay(row.key)}>
                <span>{row.label}</span>
                <i />
              </button>
            ))}
          </div>
          <div className="filter-grid">
            {PLACE_FILTERS.map(filter => (
              <button
                key={filter}
                className={activeFilters.includes(filter) ? 'tiny-chip on' : 'tiny-chip'}
                onClick={() => setActiveFilters(prev => prev.includes(filter) ? prev.filter(x => x !== filter) : [...prev, filter])}
              >
                {filter.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>

        <aside className="planner app-panel">
          <header className="planner-head">
            <div>
              <span className="eyebrow">WEB PLANNER - PHONE HANDOFF</span>
              <h1>Build the trip. Drive it from the app.</h1>
            </div>
            <Smartphone className="phone-icon" size={28} />
          </header>

          {!user ? (
            <form className="panel compact" onSubmit={login}>
              <div className="panel-title"><LogIn size={17} /> Sign in for sync</div>
              <div className="social-login-row">
                <button type="button" onClick={loginWithApple}>Apple</button>
                {googleOAuthClientId && <button type="button" onClick={loginWithGoogle}>Google</button>}
              </div>
              <div className="login-divider">or use email</div>
              <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" autoComplete="email" />
              <input value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" type="password" autoComplete="current-password" />
              <button className="primary" type="submit">Sign in</button>
            </form>
          ) : (
            <section className="account-strip">
              <span>{user.username}</span>
              <b>{user.credits} credits</b>
            </section>
          )}

          <section className="panel">
            <div className="panel-title"><Search size={17} /> Search and pin stops</div>
            <div className="row">
              <select value={pendingType} onChange={e => setPendingType(e.target.value as StopType)}>
                {STOP_TYPES.map(t => <option key={t.type} value={t.type}>{t.label}</option>)}
              </select>
              <select value={day} onChange={e => setDay(Number(e.target.value))}>
                {days.map(d => <option key={d} value={d}>Day {d}</option>)}
              </select>
              <button className="icon-btn inline" type="button" onClick={() => setDays(prev => [...prev, prev.length + 1])}><Plus size={17} /></button>
            </div>
            <div className="search-row">
              <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && searchPlaces()} placeholder="City, trailhead, address, camp..." />
              <button className="icon-btn inline" onClick={searchPlaces}><Search size={17} /></button>
            </div>
            {results.length > 0 && <div className="result-list">{results.map(r => <button key={`${r.name}_${r.lat}`} onClick={() => addStop(r)}><MapPin size={15} />{r.name}</button>)}</div>}
          </section>

          <section className="panel route-list">
            <div className="panel-title"><Route size={17} /> Route Builder <small>{routeHealth === 'healthy' ? 'route engine ready' : `route engine: ${routeHealth}`}</small></div>
            <p className="muted">Drop pins on the map, scan the visible area, save to your account, then open the same route on the phone.</p>
            <div className="segmented">
              {(['balanced', 'direct', 'adventure'] as RouteStyle[]).map(style => (
                <button key={style} className={routeStyle === style ? 'on' : ''} onClick={() => setRouteStyle(style)}>{style}</button>
              ))}
            </div>
            {stops.length === 0 ? <p className="muted">Search a place or click the map to add your start.</p> : stops.map((st, idx) => (
              <div className="stop-card" key={st.id}>
                <span>{idx + 1}</span>
                <div><b>{st.name}</b><small>Day {st.day} - {st.type}</small></div>
                <button onClick={() => setStops(prev => prev.filter(x => x.id !== st.id))}><Trash2 size={15} /></button>
              </div>
            ))}
            <div className="action-grid">
              <button onClick={buildRouteLine}><Route size={16} /> Build route</button>
              <button onClick={() => scanVisibleMap()}><Compass size={16} /> Scan view</button>
              <button onClick={saveTrip}><Save size={16} /> Save</button>
              <button onClick={publishCommunityTrail}><Mountain size={16} /> Publish trail</button>
              <button disabled={!savedTripId} onClick={() => savedTripId && window.open(`/api/trip/${savedTripId}/gpx`, '_blank')}><Download size={16} /> GPX</button>
            </div>
          </section>

          <section className="panel data-tabs">
            <div className="panel-title"><Tent size={17} /> Map data</div>
            <div className="data-grid">
              <DataColumn title="Camps" icon={<Tent size={15} />} count={camps.length}>
                {camps.slice(0, 10).map(c => <ItemCard key={c.id} title={c.name} meta={c.land_type || 'camp'} text={c.summary || c.description} onClick={() => { setSelected({ ...c, type: 'camp' }); }} />)}
              </DataColumn>
              <DataColumn title="Places" icon={<Car size={15} />} count={pois.length}>
                {pois.slice(0, 10).map(p => <ItemCard key={p.id} title={p.name} meta={p.type} text={p.address || p.subtype} onClick={() => setSelected(p)} />)}
              </DataColumn>
              <DataColumn title="Trails" icon={<Mountain size={15} />} count={trails.length}>
                {trails.slice(0, 10).map(t => <ItemCard key={t.id} title={t.name} meta={[t.length_mi ? `${t.length_mi} mi` : null, t.difficulty].filter(Boolean).join(' - ')} text={t.summary || t.land_manager} onClick={() => setSelected({ ...t, type: 'trailhead' })} />)}
              </DataColumn>
              <DataColumn title="Side trips" icon={<Compass size={15} />} count={excursions.length}>
                {excursions.slice(0, 10).map(x => (
                  <ItemCard
                    key={x.id}
                    title={x.name}
                    meta={[x.day_fit, x.distance_from_route_mi != null ? `${x.distance_from_route_mi.toFixed(1)} mi` : null, x.source_label].filter(Boolean).join(' - ')}
                    text={x.summary || x.why_go || x.access_notes}
                    onClick={() => setSelected({ ...x, type: x.type || 'excursion' })}
                  />
                ))}
              </DataColumn>
            </div>
          </section>

          <section className="panel">
            <div className="panel-title"><Bot size={17} /> AI planner</div>
            <textarea value={aiText} onChange={e => setAiText(e.target.value)} placeholder="Ask for a route edit, camp scan, fuel strategy, or pacing check." />
            <button className="primary" onClick={askAi}><Send size={16} /> Ask Trailhead</button>
            {aiReply && <p className="ai-reply">{aiReply}</p>}
          </section>

          <section className="panel">
            <div className="panel-title"><Save size={17} /> Saved routes</div>
            {savedTrips.length === 0 ? <p className="muted">Saved web and phone routes appear here after sign in.</p> : savedTrips.slice(0, 8).map(t => (
              <button className="saved-trip" key={t.trip_id} onClick={() => openTrip(t.trip_id)}>
                <span>{t.trip_name}</span>
                <small>{Math.round(t.est_miles || 0)} mi - {t.duration_days || 0} days</small>
                <ChevronRight size={16} />
              </button>
            ))}
          </section>
          <footer>{status}</footer>
        </aside>

        {selected && (
          <RouteSummaryCard
            selected={selected}
            onAddCamp={() => selected.type === 'camp' && addCamp(selected)}
            onAddPoi={() => {
              if (selected.type === 'camp') return;
              if (selected.source_label && selected.distance_from_route_mi != null) addExcursion(selected);
              else addPoi(selected);
            }}
            onPin={submitPlanningPin}
            onClose={() => setSelected(null)}
          />
        )}
      </section>
    </main>
  );
}

function DataColumn({ title, icon, count, children }: { title: string; icon: React.ReactNode; count: number; children: React.ReactNode }) {
  return <div className="data-column"><h3>{icon}{title}<span>{count}</span></h3>{children}</div>;
}

function ItemCard({ title, meta, text, onClick }: { title: string; meta?: string; text?: string; onClick: () => void }) {
  return <button className="item-card" onClick={onClick}><b>{title}</b><small>{meta || 'Trailhead data'}</small>{text && <p>{cleanText(text, 170)}</p>}</button>;
}

function RouteSummaryCard({ selected, onAddCamp, onAddPoi, onPin, onClose }: { selected: any; onAddCamp: () => void; onAddPoi: () => void; onPin: () => void; onClose: () => void }) {
  const body = cleanText(selected.description || selected.summary || selected.address || selected.type || 'Trailhead map context.', 520);
  return (
    <div className="summary-card app-panel">
      <button className="summary-close" onClick={onClose}>x</button>
      <span className="eyebrow">SELECTED</span>
      <h2>{selected.name || 'Map item'}</h2>
      <p>{body}</p>
      <div className="summary-actions">
        <button onClick={selected.type === 'camp' ? onAddCamp : onAddPoi}><Plus size={15} /> Add to route</button>
        <button onClick={onPin}><MapPin size={15} /> Pin</button>
      </div>
    </div>
  );
}
