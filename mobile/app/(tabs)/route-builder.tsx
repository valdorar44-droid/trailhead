import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput,
  ActivityIndicator, Modal, Alert, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import NativeMap, { NativeMapHandle } from '@/components/NativeMap';
import PaywallModal from '@/components/PaywallModal';
import TourTarget from '@/components/TourTarget';
import { api, CampFullness, Campsite, CampsiteDetail, CampsiteInsight, CampsitePin, GasStation, GeocodePlace, OsmPoi, PaywallError, TripResult, Waypoint, WeatherForecast } from '@/lib/api';
import { loadAllPlacePoints } from '@/lib/offlinePlacePacks';
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
type LegSearchContext = {
  from: { lat: number; lng: number; name: string };
  to: { lat: number; lng: number; name: string };
  miles: number;
  center: { lat: number; lng: number };
  targetDay?: number;
  purpose?: 'leg' | 'overnight';
};
type RouteDayPlan = {
  day: number;
  previous: BuilderStop | null;
  target: BuilderStop | null;
  frameworkTarget: BuilderStop | null;
  stops: BuilderStop[];
  miles: number;
  hours: number;
  rest: boolean;
  complete: boolean;
};
type InlineSearchState = {
  day: number;
  tab: DiscoveryTab;
  label: string;
} | null;
type TripBuildMode = 'recommended' | 'blank';
type DistanceMode = 'hours' | 'miles';

const PLACE_FILTER_TYPES = [
  { id: 'fuel', label: 'Fuel', icon: 'flash-outline', color: '#ea580c' },
  { id: 'propane', label: 'Propane', icon: 'flame-outline', color: '#f97316' },
  { id: 'water', label: 'Water', icon: 'water-outline', color: '#0284c7' },
  { id: 'dump', label: 'Dump', icon: 'trash-bin-outline', color: '#a16207' },
  { id: 'shower', label: 'Showers', icon: 'rainy-outline', color: '#06b6d4' },
  { id: 'laundromat', label: 'Laundry', icon: 'shirt-outline', color: '#06b6d4' },
  { id: 'lodging', label: 'Lodging', icon: 'bed-outline', color: '#6366f1' },
  { id: 'food', label: 'Food', icon: 'restaurant-outline', color: '#06b6d4' },
  { id: 'grocery', label: 'Groceries', icon: 'cart-outline', color: '#06b6d4' },
  { id: 'mechanic', label: 'Mechanic', icon: 'construct-outline', color: '#f97316' },
  { id: 'parking', label: 'Parking', icon: 'car-outline', color: '#d97706' },
  { id: 'attraction', label: 'Attractions', icon: 'camera-outline', color: '#0ea5e9' },
  { id: 'trailhead', label: 'Trailheads', icon: 'trail-sign-outline', color: '#22c55e' },
  { id: 'viewpoint', label: 'Views', icon: 'flag-outline', color: '#a855f7' },
  { id: 'peak', label: 'Peaks', icon: 'triangle-outline', color: '#92400e' },
  { id: 'hot_spring', label: 'Hot Springs', icon: 'flame-outline', color: '#f97316' },
] as const;
const DEFAULT_PLACE_FILTERS = ['fuel', 'propane', 'water', 'dump', 'trailhead'];
const FUEL_POI_TYPES = 'fuel,propane';
const ROUTE_POI_TYPES = 'water,trailhead,viewpoint,peak,hot_spring,dump,shower,laundromat,lodging,food,grocery,mechanic,parking,attraction';
const STATE_INFO: Record<string, { name: string; minLat: number; maxLat: number; minLng: number; maxLng: number }> = {
  AL: { name: 'Alabama', minLat: 30.1, maxLat: 35.1, minLng: -88.6, maxLng: -84.9 },
  AZ: { name: 'Arizona', minLat: 31.2, maxLat: 37.1, minLng: -114.9, maxLng: -109.0 },
  AR: { name: 'Arkansas', minLat: 33.0, maxLat: 36.6, minLng: -94.7, maxLng: -89.6 },
  CA: { name: 'California', minLat: 32.4, maxLat: 42.1, minLng: -124.5, maxLng: -114.1 },
  CO: { name: 'Colorado', minLat: 36.9, maxLat: 41.1, minLng: -109.1, maxLng: -102.0 },
  CT: { name: 'Connecticut', minLat: 40.9, maxLat: 42.1, minLng: -73.8, maxLng: -71.8 },
  DE: { name: 'Delaware', minLat: 38.4, maxLat: 39.9, minLng: -75.8, maxLng: -75.0 },
  FL: { name: 'Florida', minLat: 24.4, maxLat: 31.1, minLng: -87.7, maxLng: -80.0 },
  GA: { name: 'Georgia', minLat: 30.3, maxLat: 35.1, minLng: -85.7, maxLng: -80.8 },
  ID: { name: 'Idaho', minLat: 42.0, maxLat: 49.1, minLng: -117.3, maxLng: -111.0 },
  IL: { name: 'Illinois', minLat: 36.9, maxLat: 42.6, minLng: -91.6, maxLng: -87.5 },
  IN: { name: 'Indiana', minLat: 37.7, maxLat: 41.8, minLng: -88.1, maxLng: -84.8 },
  IA: { name: 'Iowa', minLat: 40.3, maxLat: 43.6, minLng: -96.7, maxLng: -90.1 },
  KS: { name: 'Kansas', minLat: 36.9, maxLat: 40.1, minLng: -102.1, maxLng: -94.5 },
  KY: { name: 'Kentucky', minLat: 36.4, maxLat: 39.2, minLng: -89.6, maxLng: -81.9 },
  LA: { name: 'Louisiana', minLat: 28.9, maxLat: 33.1, minLng: -94.1, maxLng: -88.8 },
  ME: { name: 'Maine', minLat: 43.0, maxLat: 47.5, minLng: -71.1, maxLng: -66.9 },
  MD: { name: 'Maryland', minLat: 37.8, maxLat: 39.8, minLng: -79.6, maxLng: -75.0 },
  MA: { name: 'Massachusetts', minLat: 41.2, maxLat: 42.9, minLng: -73.6, maxLng: -69.9 },
  MI: { name: 'Michigan', minLat: 41.6, maxLat: 48.4, minLng: -90.5, maxLng: -82.1 },
  MN: { name: 'Minnesota', minLat: 43.4, maxLat: 49.4, minLng: -97.3, maxLng: -89.5 },
  MS: { name: 'Mississippi', minLat: 30.1, maxLat: 35.1, minLng: -91.7, maxLng: -88.1 },
  MO: { name: 'Missouri', minLat: 35.9, maxLat: 40.7, minLng: -95.8, maxLng: -89.1 },
  MT: { name: 'Montana', minLat: 44.3, maxLat: 49.1, minLng: -116.1, maxLng: -104.0 },
  NE: { name: 'Nebraska', minLat: 39.9, maxLat: 43.1, minLng: -104.1, maxLng: -95.3 },
  NV: { name: 'Nevada', minLat: 35.0, maxLat: 42.1, minLng: -120.1, maxLng: -114.0 },
  NH: { name: 'New Hampshire', minLat: 42.7, maxLat: 45.4, minLng: -72.6, maxLng: -70.6 },
  NJ: { name: 'New Jersey', minLat: 38.8, maxLat: 41.4, minLng: -75.6, maxLng: -73.9 },
  NM: { name: 'New Mexico', minLat: 31.2, maxLat: 37.1, minLng: -109.1, maxLng: -103.0 },
  NY: { name: 'New York', minLat: 40.4, maxLat: 45.1, minLng: -79.8, maxLng: -71.7 },
  NC: { name: 'North Carolina', minLat: 33.8, maxLat: 36.7, minLng: -84.4, maxLng: -75.4 },
  ND: { name: 'North Dakota', minLat: 45.9, maxLat: 49.1, minLng: -104.1, maxLng: -96.5 },
  OH: { name: 'Ohio', minLat: 38.3, maxLat: 42.4, minLng: -84.9, maxLng: -80.5 },
  OK: { name: 'Oklahoma', minLat: 33.6, maxLat: 37.1, minLng: -103.1, maxLng: -94.4 },
  OR: { name: 'Oregon', minLat: 41.9, maxLat: 46.4, minLng: -124.7, maxLng: -116.4 },
  PA: { name: 'Pennsylvania', minLat: 39.6, maxLat: 42.6, minLng: -80.6, maxLng: -74.7 },
  RI: { name: 'Rhode Island', minLat: 41.1, maxLat: 42.1, minLng: -71.9, maxLng: -71.1 },
  SC: { name: 'South Carolina', minLat: 32.0, maxLat: 35.3, minLng: -83.4, maxLng: -78.5 },
  SD: { name: 'South Dakota', minLat: 42.4, maxLat: 45.9, minLng: -104.1, maxLng: -96.4 },
  TN: { name: 'Tennessee', minLat: 34.9, maxLat: 36.7, minLng: -90.4, maxLng: -81.6 },
  TX: { name: 'Texas', minLat: 25.8, maxLat: 36.6, minLng: -106.7, maxLng: -93.5 },
  UT: { name: 'Utah', minLat: 36.9, maxLat: 42.1, minLng: -114.1, maxLng: -109.0 },
  VT: { name: 'Vermont', minLat: 42.7, maxLat: 45.1, minLng: -73.5, maxLng: -71.5 },
  VA: { name: 'Virginia', minLat: 36.5, maxLat: 39.5, minLng: -83.8, maxLng: -75.2 },
  WA: { name: 'Washington', minLat: 45.5, maxLat: 49.1, minLng: -124.9, maxLng: -116.9 },
  WV: { name: 'West Virginia', minLat: 37.2, maxLat: 40.7, minLng: -82.7, maxLng: -77.7 },
  WI: { name: 'Wisconsin', minLat: 42.4, maxLat: 47.2, minLng: -92.9, maxLng: -86.8 },
  WY: { name: 'Wyoming', minLat: 40.9, maxLat: 45.1, minLng: -111.1, maxLng: -104.0 },
};

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

function scenicPoint(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  progress: number,
  offsetMi: number
) {
  const t = Math.max(0, Math.min(1, progress));
  const base = { lat: from.lat + (to.lat - from.lat) * t, lng: from.lng + (to.lng - from.lng) * t };
  if (!offsetMi || t <= 0 || t >= 1) return base;
  const avgLat = ((from.lat + to.lat) / 2) * Math.PI / 180;
  const milesPerLng = Math.max(8, 69 * Math.cos(avgLat));
  const dx = (to.lng - from.lng) * milesPerLng;
  const dy = (to.lat - from.lat) * 69;
  const len = Math.hypot(dx, dy);
  if (!len) return base;
  const bow = Math.sin(Math.PI * t) * offsetMi;
  const perpLngMi = -dy / len * bow;
  const perpLatMi = dx / len * bow;
  return {
    lat: base.lat + perpLatMi / 69,
    lng: base.lng + perpLngMi / milesPerLng,
  };
}

function pointSegmentDistanceMi(point: { lat: number; lng: number }, a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  return pointSegmentProjection(point, a, b).distanceMi;
}

function pointSegmentProjection(point: { lat: number; lng: number }, a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const refLat = ((point.lat + a.lat + b.lat) / 3) * Math.PI / 180;
  const px = point.lng * Math.cos(refLat), py = point.lat;
  const ax = a.lng * Math.cos(refLat), ay = a.lat;
  const bx = b.lng * Math.cos(refLat), by = b.lat;
  const dx = bx - ax, dy = by - ay;
  if (dx === 0 && dy === 0) return { distanceMi: haversineMi(point, a), progress: 0, progressMi: 0 };
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  const projected = { lat: ay + t * dy, lng: (ax + t * dx) / Math.cos(refLat) };
  return { distanceMi: haversineMi(point, projected), progress: t, progressMi: haversineMi(a, b) * t };
}

function routeProgressLabel(progress?: number) {
  if (progress == null || !Number.isFinite(progress)) return '';
  if (progress < 0.34) return 'early leg';
  if (progress < 0.67) return 'mid leg';
  return 'late leg';
}

function withLegProjection<T extends { lat: number; lng: number }>(item: T, leg: LegSearchContext) {
  const projection = pointSegmentProjection(item, leg.from, leg.to);
  return {
    ...item,
    route_distance_mi: projection.distanceMi,
    route_progress: projection.progress,
    route_progress_mi: projection.progressMi,
  };
}

function spreadAlongLeg<T extends { route_distance_mi?: number; route_progress?: number }>(items: T[]) {
  const buckets = [0, 1, 2].map(bucket => items
    .filter(item => Math.min(2, Math.floor(((item.route_progress ?? 0) * 3))) === bucket)
    .sort((a, b) => (a.route_distance_mi ?? 999) - (b.route_distance_mi ?? 999)));
  const out: T[] = [];
  const rounds = Math.max(...buckets.map(bucket => bucket.length), 0);
  for (let round = 0; round < rounds; round++) {
    for (const bucket of buckets) {
      const item = bucket[round];
      if (item) out.push(item);
    }
  }
  return out;
}

function overnightEndpointCamps<T extends { lat: number; lng: number; route_distance_mi?: number; route_progress?: number }>(items: T[], leg: LegSearchContext) {
  const withEndpointDistance = items.map(item => ({
    ...item,
    endpoint_distance_mi: haversineMi(item, leg.to),
  }));
  const routeBuffer = routeBufferForMiles(leg.miles) + 8;
  const nearEndpoint = withEndpointDistance
    .filter(item => item.endpoint_distance_mi <= 30 && (item.route_distance_mi ?? 999) <= routeBuffer)
    .sort((a, b) => (a.endpoint_distance_mi - b.endpoint_distance_mi) || ((a.route_distance_mi ?? 999) - (b.route_distance_mi ?? 999)));
  if (nearEndpoint.length) return nearEndpoint;
  const endpointFallback = withEndpointDistance
    .filter(item => item.endpoint_distance_mi <= 45)
    .sort((a, b) => (a.endpoint_distance_mi - b.endpoint_distance_mi) || ((a.route_distance_mi ?? 999) - (b.route_distance_mi ?? 999)));
  if (endpointFallback.length) return endpointFallback;
  return withEndpointDistance.sort((a, b) => {
    const aScore = (a.route_distance_mi ?? 999) + Math.abs(1 - (a.route_progress ?? 0)) * 30 + a.endpoint_distance_mi * 0.45;
    const bScore = (b.route_distance_mi ?? 999) + Math.abs(1 - (b.route_progress ?? 0)) * 30 + b.endpoint_distance_mi * 0.45;
    return aScore - bScore;
  });
}

function fmtMi(mi: number) {
  if (!Number.isFinite(mi)) return '-';
  return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`;
}

function fmtHours(hours: number) {
  if (!Number.isFinite(hours) || hours <= 0) return '-';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h <= 0) return `${m} min`;
  return m > 0 ? `${h} h ${m} min` : `${h} h`;
}

function parsePositiveNumber(value?: string | null) {
  const n = Number(String(value ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function estimateMovingHours(mi: number) {
  // Manual builder does not have turn-by-turn route durations yet, so use a
  // conservative overland planning speed rather than interstate speed.
  return mi / 42;
}

function estimateMpg(rig: ReturnType<typeof useStore.getState>['rigProfile']) {
  const realMpg = parsePositiveNumber(rig?.fuel_mpg);
  if (realMpg) return Math.max(6, Math.round(realMpg * 10) / 10);
  const type = (rig?.vehicle_type || '').toLowerCase();
  let mpg = type.includes('rv') ? 10 : type.includes('truck') ? 15 : type.includes('van') ? 17 : type.includes('suv') ? 18 : 20;
  if (rig?.is_towing) mpg *= 0.72;
  if (parsePositiveNumber(rig?.lift_in) || parsePositiveNumber(rig?.tire_size)) mpg *= 0.9;
  return Math.max(8, Math.round(mpg));
}

function stateForPoint(point: { lat: number; lng: number }) {
  return Object.entries(STATE_INFO).find(([, box]) =>
    point.lat >= box.minLat && point.lat <= box.maxLat && point.lng >= box.minLng && point.lng <= box.maxLng
  )?.[0] ?? null;
}

function sampleRouteStates(stops: BuilderStop[], loop: boolean) {
  const out: Record<string, number> = {};
  const sorted = stops;
  for (let i = 1; i < sorted.length; i++) {
    const from = sorted[i - 1];
    const to = sorted[i];
    const miles = haversineMi(from, to);
    const samples = Math.max(1, Math.ceil(miles / 60));
    for (let j = 0; j < samples; j++) {
      const t = (j + 0.5) / samples;
      const point = { lat: from.lat + (to.lat - from.lat) * t, lng: from.lng + (to.lng - from.lng) * t };
      const state = stateForPoint(point);
      if (state) out[state] = (out[state] ?? 0) + miles / samples;
    }
  }
  if (loop && sorted.length > 2) {
    const from = sorted[sorted.length - 1];
    const to = sorted[0];
    const miles = haversineMi(from, to);
    const samples = Math.max(1, Math.ceil(miles / 60));
    for (let j = 0; j < samples; j++) {
      const t = (j + 0.5) / samples;
      const point = { lat: from.lat + (to.lat - from.lat) * t, lng: from.lng + (to.lng - from.lng) * t };
      const state = stateForPoint(point);
      if (state) out[state] = (out[state] ?? 0) + miles / samples;
    }
  }
  return out;
}

async function fetchAaaStateRegular(state: string) {
  const name = STATE_INFO[state]?.name;
  if (!name) return null;
  const res = await fetch(`https://gasprices.aaa.com/?state=${encodeURIComponent(state)}`);
  const html = await res.text();
  const stateAvg = html.match(new RegExp(`Today[^$]+${name.replace(/\s+/g, '\\s+')}\\s+Avg\\.\\s+\\$([0-9.]+)`, 'i'));
  const currentAvg = html.match(/<td>\s*Current Avg\.\s*<\/td>\s*<td>\s*\$([0-9.]+)/i);
  const value = Number(stateAvg?.[1] ?? currentAvg?.[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function routeBufferForMiles(mi: number) {
  return Math.max(10, Math.min(30, mi * 0.16));
}

function legSamplePoints(leg: LegSearchContext) {
  const count = Math.max(2, Math.min(6, Math.ceil(leg.miles / 90) + 1));
  return Array.from({ length: count }, (_, idx) => {
    const t = count === 1 ? 0.5 : idx / (count - 1);
    return {
      lat: leg.from.lat + (leg.to.lat - leg.from.lat) * t,
      lng: leg.from.lng + (leg.to.lng - leg.from.lng) * t,
    };
  });
}

function uniqueByGeo<T extends { id?: string | number; name?: string; lat: number; lng: number }>(items: T[]) {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = String(item.id || `${item.name}_${item.lat.toFixed(4)}_${item.lng.toFixed(4)}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

function placeIcon(type: string): keyof typeof Ionicons.glyphMap {
  const match = PLACE_FILTER_TYPES.find(t => t.id === type);
  return (match?.icon as keyof typeof Ionicons.glyphMap) ?? 'navigate-outline';
}

function placeColor(type: string) {
  return PLACE_FILTER_TYPES.find(t => t.id === type)?.color ?? '#f97316';
}

function builderTypeForPoi(type: string): BuilderStopType {
  if (type === 'fuel' || type === 'propane') return 'fuel';
  if (type === 'lodging') return 'motel';
  return 'waypoint';
}

function dedupePois(points: OsmPoi[]) {
  const seen = new Set<string>();
  return points.filter(point => {
    const key = point.id || `${point.type}_${point.lat.toFixed(5)}_${point.lng.toFixed(5)}_${point.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function poiToGasStation(point: OsmPoi): GasStation {
  return {
    id: point.id,
    name: point.name || (point.type === 'propane' ? 'Propane stop' : 'Fuel stop'),
    lat: point.lat,
    lng: point.lng,
    fuel_types: point.type === 'propane' ? 'Propane' : 'Fuel',
    address: point.subtype || point.type.replace(/_/g, ' '),
    route_distance_mi: point.route_distance_mi,
    route_fit: point.route_fit,
  };
}

function routeScopedOfflinePlaces(points: OsmPoi[], leg: LegSearchContext, types: string[], extraBuffer = 8) {
  const allowed = new Set(types);
  return dedupePois(points
    .filter(point => allowed.has(point.type))
    .map(point => withLegProjection(point, leg))
    .filter(point => (point.route_distance_mi ?? 999) <= routeBufferForMiles(leg.miles) + extraBuffer)
  );
}

function areaScopedOfflinePlaces(points: OsmPoi[], center: { lat: number; lng: number }, types: string[], radiusMi: number) {
  const allowed = new Set(types);
  return dedupePois(points
    .filter(point => allowed.has(point.type))
    .map(point => ({ ...point, route_distance_mi: haversineMi(point, center) }))
    .filter(point => (point.route_distance_mi ?? 999) <= radiusMi)
    .sort((a, b) => (a.route_distance_mi ?? 999) - (b.route_distance_mi ?? 999))
  );
}

function stopTypeFromWaypoint(type?: string): BuilderStopType {
  const t = (type || '').toLowerCase();
  if (t === 'start') return 'start';
  if (t.includes('fuel') || t.includes('gas')) return 'fuel';
  if (t.includes('camp')) return 'camp';
  if (t.includes('motel') || t.includes('hotel') || t.includes('lodg')) return 'motel';
  return 'waypoint';
}

function closeEnough(a: { lat?: number; lng?: number }, b: { lat?: number; lng?: number }) {
  if (!Number.isFinite(a.lat) || !Number.isFinite(a.lng) || !Number.isFinite(b.lat) || !Number.isFinite(b.lng)) return false;
  return Math.abs((a.lat ?? 0) - (b.lat ?? 0)) < 0.0008 && Math.abs((a.lng ?? 0) - (b.lng ?? 0)) < 0.0008;
}

function campsiteToPin(camp: Campsite): CampsitePin {
  return {
    id: camp.id,
    name: camp.name,
    lat: camp.lat,
    lng: camp.lng,
    tags: [],
    land_type: 'camp',
    description: camp.description || 'Trip camp.',
    reservable: camp.reservable,
    cost: undefined,
    url: camp.url,
    ada: false,
    route_distance_mi: camp.route_distance_mi,
    route_fit: camp.route_fit,
    recommended_day: camp.recommended_day,
    verified_source: camp.verified_source,
  };
}

function sourceLabel(source?: BuilderStop['source']) {
  if (source === 'camp') return 'verified camp';
  if (source === 'gas') return 'fuel search';
  if (source === 'poi') return 'poi search';
  if (source === 'search') return 'search';
  if (source === 'map') return 'map tap';
  return 'manual';
}

function isFrameworkTarget(stop: BuilderStop) {
  return stop.source === 'map' && stop.type === 'waypoint' && /target area/i.test(stop.name);
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
  const serverPlaces = await api.geocodePlaces(query, 8).catch(() => [] as GeocodePlace[]);
  if (serverPlaces.length) return serverPlaces;
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

async function searchNominatimNearby(query: string, center: { lat: number; lng: number }, radiusMi = 25, type: OsmPoi['type'] = 'poi', limit = 8): Promise<OsmPoi[]> {
  const latDelta = radiusMi / 69;
  const lngDelta = radiusMi / Math.max(8, 69 * Math.cos(center.lat * Math.PI / 180));
  const west = center.lng - lngDelta;
  const east = center.lng + lngDelta;
  const south = center.lat - latDelta;
  const north = center.lat + latDelta;
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=${limit}&countrycodes=us&bounded=1&viewbox=${west},${north},${east},${south}&q=${encodeURIComponent(query)}`,
    { headers: { 'User-Agent': 'TrailheadRouteBuilder/1.0' } }
  );
  const data = await res.json();
  return (data ?? []).map((p: any) => ({
    id: `${type}_${p.osm_type ?? 'n'}_${p.osm_id ?? `${p.lat}_${p.lon}`}`,
    name: p.name || p.display_name?.split(',').slice(0, 2).join(',') || query,
    lat: Number(p.lat),
    lng: Number(p.lon),
    type,
    subtype: p.type || p.class,
  })).filter((p: OsmPoi) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
}

export default function RouteBuilderScreen() {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const router = useRouter();
  const mapRef = useRef<NativeMapHandle>(null);
  const didInitialMapFitRef = useRef(false);
  const activeTrip = useStore(st => st.activeTrip);
  const setActiveTrip = useStore(st => st.setActiveTrip);
  const addTripToHistory = useStore(st => st.addTripToHistory);
  const userLoc = useStore(st => st.userLoc);
  const setStoreUserLoc = useStore(st => st.setUserLoc);
  const rigProfile = useStore(st => st.rigProfile);

  const [activeDay, setActiveDay] = useState(1);
  const [days, setDays] = useState([1]);
  const [stops, setStops] = useState<BuilderStop[]>([]);
  const [tripLoop, setTripLoop] = useState(false);
  const [driveHoursPerDay, setDriveHoursPerDay] = useState('5');
  const [plannedDays, setPlannedDays] = useState('3');
  const [routeStyle, setRouteStyle] = useState<'balanced' | 'direct' | 'adventure'>('balanced');
  const [tripBuildMode, setTripBuildMode] = useState<TripBuildMode>('recommended');
  const [distanceMode, setDistanceMode] = useState<DistanceMode>('hours');
  const [wizardStep, setWizardStep] = useState(0);
  const [targetMiles, setTargetMiles] = useState('180');
  const [startQuery, setStartQuery] = useState('');
  const [endQuery, setEndQuery] = useState('');
  const [buildingFramework, setBuildingFramework] = useState(false);
  const [showBuildSuccess, setShowBuildSuccess] = useState(false);
  const [restDays, setRestDays] = useState<number[]>([]);
  const [dayDriveTargets, setDayDriveTargets] = useState<Record<number, string>>({});
  const [gasPrice, setGasPrice] = useState('3.65');
  const [stateGasPrices, setStateGasPrices] = useState<Record<string, number>>({});
  const [gasPriceStatus, setGasPriceStatus] = useState<'idle' | 'loading' | 'live' | 'fallback'>('idle');
  const [importedTripId, setImportedTripId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [routeName, setRouteName] = useState('');
  const [searchResults, setSearchResults] = useState<SearchPlace[]>([]);
  const [pendingType, setPendingType] = useState<BuilderStopType>('start');
  const [insertAfterId, setInsertAfterId] = useState<string | null>(null);
  const [insertTargetDay, setInsertTargetDay] = useState<number | null>(null);
  const [replaceStopId, setReplaceStopId] = useState<string | null>(null);
  const [discoverTab, setDiscoverTab] = useState<DiscoveryTab>('camps');
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverySummary, setDiscoverySummary] = useState('');
  const [inlineSearch, setInlineSearch] = useState<InlineSearchState>(null);
  const [camps, setCamps] = useState<CampsitePin[]>([]);
  const [gas, setGas] = useState<GasStation[]>([]);
  const [pois, setPois] = useState<OsmPoi[]>([]);
  const [offlinePlaces, setOfflinePlaces] = useState<OsmPoi[]>([]);
  const [activePlaceFilters, setActivePlaceFilters] = useState<string[]>(DEFAULT_PLACE_FILTERS);
  const [showPlaceFilters, setShowPlaceFilters] = useState(false);
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

  useEffect(() => {
    let mounted = true;
    loadAllPlacePoints()
      .then(points => {
        if (!mounted) return;
        setOfflinePlaces(points.map(point => ({
          id: point.id,
          name: point.name,
          lat: point.lat,
          lng: point.lng,
          type: point.type,
          subtype: point.subtype,
          elevation: point.elevation,
        })));
      })
      .catch(() => {
        if (mounted) setOfflinePlaces([]);
      });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!activeTrip || importedTripId === activeTrip.trip_id || stops.length > 0) return;
    const importedStops: BuilderStop[] = activeTrip.plan.waypoints
      .filter(wp => Number.isFinite(wp.lat) && Number.isFinite(wp.lng))
      .map((wp, idx) => {
        const type = stopTypeFromWaypoint(wp.type);
        const camp = type === 'camp'
          ? activeTrip.campsites
              .map(campsiteToPin)
              .find(c => c.recommended_day === wp.day && (closeEnough(c, wp) || c.name === wp.name)) ?? {
                id: `wp_${idx}`,
                name: wp.name || 'Camp',
                lat: wp.lat!,
                lng: wp.lng!,
                tags: [],
                land_type: wp.land_type || 'camp',
                description: wp.description || wp.notes || 'Trip camp.',
                reservable: false,
                url: '',
                ada: false,
                recommended_day: wp.day,
                verified_source: wp.verified_source,
              }
          : undefined;
        const station = type === 'fuel'
          ? activeTrip.gas_stations.find(g => g.recommended_day === wp.day && (closeEnough(g, wp) || g.name === wp.name)) ?? {
            id: `wp_${idx}`,
            name: wp.name || 'Fuel stop',
            lat: wp.lat!,
            lng: wp.lng!,
            fuel_types: '',
            address: wp.description || '',
            recommended_day: wp.day,
          }
          : undefined;
        const poi = type === 'waypoint'
          ? activeTrip.route_pois?.find(p => closeEnough(p, wp) || p.name === wp.name)
          : undefined;
        return {
          id: `import_${idx}_${Math.random().toString(36).slice(2, 7)}`,
          day: wp.day || 1,
          name: wp.name || stopLabel(type),
          lat: wp.lat!,
          lng: wp.lng!,
          type,
          description: wp.description || wp.notes || 'Imported trip stop.',
          land_type: wp.land_type || (type === 'fuel' || type === 'motel' ? 'town' : 'route'),
          source: camp ? 'camp' : station ? 'gas' : poi ? 'poi' : 'search',
          camp,
          gas: station,
          poi,
        };
      });
    if (!importedStops.length) return;
    const importedDays = Array.from(new Set([
      ...activeTrip.plan.daily_itinerary.map(day => day.day),
      ...importedStops.map(stop => stop.day),
    ])).filter(Number.isFinite).sort((a, b) => a - b);
    setStops(importedStops);
    setDays(importedDays.length ? importedDays : [1]);
    setActiveDay(importedStops[0]?.day ?? 1);
    setRouteName(activeTrip.plan.trip_name || '');
    setImportedTripId(activeTrip.trip_id);
    const first = importedStops[0];
    if (first) setTimeout(() => fly(first.lat, first.lng, 8), 350);
  }, [activeTrip, importedTripId, stops.length]);

  const dayStops = stops.filter(st => st.day === activeDay);
  const selectedInsertStop = stops.find(st => st.id === insertAfterId) ?? null;
  const orderedStops = [...stops].sort((a, b) => a.day - b.day || stops.indexOf(a) - stops.indexOf(b));
  const mapWaypoints = orderedStops.map(st => ({ lat: st.lat, lng: st.lng, name: st.name, day: st.day, type: st.type }));
  const mapCamps = useMemo(() => uniqueByGeo([
    ...orderedStops.map(st => st.camp).filter((camp): camp is CampsitePin => !!camp),
    ...camps,
  ]), [orderedStops, camps]);
  const anchor = [...dayStops].reverse()[0] ?? [...stops].reverse()[0] ?? (userLoc ? { lat: userLoc.lat, lng: userLoc.lng, name: 'Current location' } : null);
  const selectedStopIndex = selectedInsertStop ? orderedStops.findIndex(st => st.id === selectedInsertStop.id) : -1;
  const selectedNextStop = selectedStopIndex >= 0 ? orderedStops[selectedStopIndex + 1] ?? null : null;
  const previousDayEnd = [...orderedStops].reverse().find(st => st.day < activeDay) ?? null;
  const activeDayDestination = [...dayStops].reverse().find(st => st.type !== 'fuel' && st.type !== 'waypoint') ?? [...dayStops].reverse()[0] ?? null;
  const dayBridge = previousDayEnd && activeDayDestination
    ? { from: previousDayEnd, to: activeDayDestination, source: 'day' as const }
    : null;
  const activeSegment = selectedInsertStop && selectedNextStop
    ? { from: selectedInsertStop, to: selectedNextStop, source: 'selected' as const, targetDay: insertTargetDay ?? selectedInsertStop.day }
    : dayBridge ? { ...dayBridge, targetDay: activeDay } : null;
  const legContext = activeSegment
    ? {
        ...activeSegment,
        miles: haversineMi(activeSegment.from, activeSegment.to),
        hours: estimateMovingHours(haversineMi(activeSegment.from, activeSegment.to)),
        center: midpoint(activeSegment.from, activeSegment.to),
        targetDay: activeSegment.targetDay,
      }
    : null;
  const discoverContextLabel = legContext
    ? `${legContext.from.name.split(',')[0]} to ${legContext.to.name.split(',')[0]} · ${fmtMi(legContext.miles)}`
    : anchor ? anchor.name.split(',')[0] : 'add a stop first';
  const filteredOfflinePlaces = useMemo(() => (
    offlinePlaces.filter(place => activePlaceFilters.includes(place.type))
  ), [offlinePlaces, activePlaceFilters]);
  const mapPois = useMemo(() => dedupePois([...pois, ...filteredOfflinePlaces]), [pois, filteredOfflinePlaces]);
  const offlinePlaceCandidates = useMemo(() => {
    const target = legContext ? legContext.center : anchor;
    if (!target) return [];
    const scoped = filteredOfflinePlaces
      .map(place => ({
        ...place,
        route_distance_mi: legContext
          ? pointSegmentDistanceMi(place, legContext.from, legContext.to)
          : haversineMi(place, target),
      }))
      .filter(place => place.route_distance_mi <= (legContext ? Math.max(20, Math.min(50, legContext.miles * 0.5)) : 45))
      .sort((a, b) => (a.route_distance_mi ?? 999) - (b.route_distance_mi ?? 999));
    return dedupePois(scoped);
  }, [anchor, filteredOfflinePlaces, legContext]);
  const discoveryPois = useMemo(() => dedupePois([...pois, ...offlinePlaceCandidates]), [pois, offlinePlaceCandidates]);
  const routeStateMiles = useMemo(() => sampleRouteStates(orderedStops, tripLoop), [orderedStops, tripLoop]);
  const routeStates = useMemo(() => Object.keys(routeStateMiles).sort((a, b) => routeStateMiles[b] - routeStateMiles[a]), [routeStateMiles]);

  useEffect(() => {
    const missing = routeStates.filter(state => stateGasPrices[state] == null).slice(0, 6);
    if (!missing.length) {
      if (routeStates.length && Object.keys(stateGasPrices).length) setGasPriceStatus('live');
      return;
    }
    let cancelled = false;
    setGasPriceStatus('loading');
    Promise.all(missing.map(async state => [state, await fetchAaaStateRegular(state)] as const))
      .then(entries => {
        if (cancelled) return;
        const next: Record<string, number> = {};
        for (const [state, price] of entries) if (price) next[state] = price;
        if (Object.keys(next).length) {
          setStateGasPrices(prev => ({ ...prev, ...next }));
          setGasPriceStatus('live');
        } else {
          setGasPriceStatus('fallback');
        }
      })
      .catch(() => {
        if (!cancelled) setGasPriceStatus('fallback');
      });
    return () => { cancelled = true; };
  }, [routeStates.join(','), stateGasPrices]);

  const totals = useMemo(() => {
    let miles = 0;
    for (let i = 1; i < orderedStops.length; i++) miles += haversineMi(orderedStops[i - 1], orderedStops[i]);
    if (tripLoop && orderedStops.length > 2) miles += haversineMi(orderedStops[orderedStops.length - 1], orderedStops[0]);
    return { miles, stops: orderedStops.length, camps: orderedStops.filter(st => st.type === 'camp').length };
  }, [orderedStops, tripLoop]);
  const planningStats = useMemo(() => {
    const mpg = estimateMpg(rigProfile);
    const fallbackPrice = parsePositiveNumber(gasPrice) ?? 3.65;
    const weightedGallons = Object.entries(routeStateMiles).reduce((sum, [state, miles]) => {
      const price = stateGasPrices[state] ?? fallbackPrice;
      return sum + (miles / mpg) * price;
    }, 0);
    const gallons = totals.miles / mpg;
    const fuelCost = totals.miles > 0 ? (Object.keys(routeStateMiles).length ? weightedGallons : gallons * fallbackPrice) : 0;
    const price = gallons > 0 ? fuelCost / gallons : fallbackPrice;
    const driveLimit = parsePositiveNumber(driveHoursPerDay) ?? 5;
    const range = parsePositiveNumber(rigProfile?.fuel_range_miles);
    return {
      mpg,
      price,
      gallons,
      fuelCost,
      driveLimit,
      range,
      driveHours: estimateMovingHours(totals.miles),
    };
  }, [driveHoursPerDay, gasPrice, rigProfile, routeStateMiles, stateGasPrices, totals.miles]);
  const dayMileage = useMemo(() => {
    const out: Record<number, number> = {};
    for (const day of days) {
      const prev = [...orderedStops].reverse().find(st => st.day < day) ?? null;
      const wps = orderedStops.filter(st => st.day === day);
      let miles = 0;
      if (prev && wps.length) miles += haversineMi(prev, wps[0]);
      for (let i = 1; i < wps.length; i++) miles += haversineMi(wps[i - 1], wps[i]);
      out[day] = miles;
    }
    return out;
  }, [days, orderedStops]);
  const routeDayPlans = useMemo<RouteDayPlan[]>(() => (
    days.map(day => {
      const wps = orderedStops.filter(st => st.day === day);
      const previous = [...orderedStops].reverse().find(st => st.day < day) ?? null;
      const frameworkTarget = wps.find(isFrameworkTarget) ?? null;
      const target = [...wps].reverse().find(st => st.type === 'camp' || st.type === 'motel')
        ?? frameworkTarget
        ?? [...wps].reverse().find(st => st.type !== 'fuel')
        ?? wps[wps.length - 1]
        ?? null;
      const miles = dayMileage[day] ?? 0;
      return {
        day,
        previous,
        target,
        frameworkTarget,
        stops: wps,
        miles,
        hours: estimateMovingHours(miles),
        rest: restDays.includes(day),
        complete: !!target && !isFrameworkTarget(target) && (target.type === 'camp' || target.type === 'motel' || day === days[days.length - 1]),
      };
    })
  ), [days, orderedStops, dayMileage, restDays]);
  const hasBaseRoute = orderedStops.length >= 2;
  const realOvernights = routeDayPlans.filter(day => day.complete).length;
  const setupProgress = useMemo(() => {
    let score = 0;
    if (startQuery.trim() || orderedStops.length >= 1 || userLoc) score += 1;
    if (endQuery.trim() || orderedStops.length >= 2) score += 1;
    if (parsePositiveNumber(plannedDays)) score += 1;
    return score;
  }, [endQuery, orderedStops.length, plannedDays, startQuery, userLoc]);
  const baseRouteSummary = hasBaseRoute
    ? `${orderedStops[0].name.split(',')[0]} to ${orderedStops[orderedStops.length - 1].name.split(',')[0]}`
    : 'Build a base route first';
  const activeDayDriveLimit = parsePositiveNumber(dayDriveTargets[activeDay]) ?? planningStats.driveLimit;
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
    const longDays = days.filter(day => !restDays.includes(day) && estimateMovingHours(dayMileage[day] ?? 0) > (parsePositiveNumber(dayDriveTargets[day]) ?? planningStats.driveLimit));
    if (longDays.length) {
      const limit = parsePositiveNumber(dayDriveTargets[longDays[0]]) ?? planningStats.driveLimit;
      checks.push({ level: 'warn', label: 'Drive time', text: `Day ${longDays[0]} is about ${fmtHours(estimateMovingHours(dayMileage[longDays[0]]))}, over the ${fmtHours(limit)} max.` });
    } else if (orderedStops.length > 1) {
      checks.push({ level: 'ok', label: 'Pace', text: `Days stay under the ${fmtHours(planningStats.driveLimit)} max.` });
    }
    const fuelCount = orderedStops.filter(st => st.type === 'fuel').length;
    if ((planningStats.range && totals.miles > planningStats.range * 0.7 && fuelCount === 0) || (!planningStats.range && totals.miles > 160 && fuelCount === 0)) {
      checks.push({ level: 'warn', label: 'Fuel', text: planningStats.range ? `Rig range is about ${Math.round(planningStats.range)} mi. Add fuel before remote stretches.` : 'Add at least one fuel stop before remote stretches.' });
    } else if (fuelCount > 0) {
      checks.push({ level: 'ok', label: 'Fuel', text: `${fuelCount} fuel stop${fuelCount === 1 ? '' : 's'} added.` });
    }
    const driveCapacity = days
      .filter(day => !restDays.includes(day))
      .reduce((sum, day) => sum + ((parsePositiveNumber(dayDriveTargets[day]) ?? planningStats.driveLimit) * 42), 0);
    if (totals.miles > driveCapacity && orderedStops.length > 1) {
      checks.push({ level: 'warn', label: 'Schedule', text: `This route needs more than the selected ${days.length} day${days.length === 1 ? '' : 's'} at the current daily max.` });
    }
    return checks.slice(0, 3);
  }, [days, orderedStops, dayMileage, totals.miles, planningStats.driveLimit, planningStats.range, dayDriveTargets, restDays]);
  const discoverEmptyText = discoverTab === 'camps'
    ? 'Tap scan to find legal camps near the selected leg or route anchor.'
    : discoverTab === 'gas'
      ? 'Tap scan to find fuel between the selected stops.'
      : 'Tap scan to find water, trailheads, viewpoints, peaks, and hot springs near this route.';

  function fly(lat: number, lng: number, zoom = 11) {
    mapRef.current?.flyTo(lat, lng, zoom);
  }

  function addStop(input: Omit<BuilderStop, 'id' | 'day'> & { day?: number }) {
    const target = insertAfterId ? stops.find(st => st.id === insertAfterId) : null;
    const stop: BuilderStop = {
      ...input,
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      day: input.day ?? insertTargetDay ?? target?.day ?? activeDay,
    };
    setStops(prev => {
      const idx = target ? prev.findIndex(st => st.id === target.id) : -1;
      if (idx < 0) return [...prev, stop];
      return [...prev.slice(0, idx + 1), stop, ...prev.slice(idx + 1)];
    });
    setActiveDay(stop.day);
    if (stop.type === 'start') setPendingType('waypoint');
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

  async function getRouteBuilderLocation() {
    if (userLoc) return userLoc;
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Location needed', 'Allow location or type a start city so Trailhead knows where this route begins.');
      return null;
    }
    const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const loc = { lat: fix.coords.latitude, lng: fix.coords.longitude };
    setStoreUserLoc(loc);
    return loc;
  }

  async function setWizardStartFromLocation() {
    const loc = await getRouteBuilderLocation();
    if (!loc) return;
    const start: BuilderStop = {
      id: `start_${Date.now()}`,
      day: 1,
      name: 'Current location',
      lat: loc.lat,
      lng: loc.lng,
      type: 'start',
      description: 'Route start from current location.',
      land_type: 'route',
      source: 'map',
    };
    setStops(prev => {
      const withoutOldStart = prev.filter((st, idx) => !(idx === 0 && st.type === 'start'));
      return [start, ...withoutOldStart];
    });
    setStartQuery('');
    setPendingType('waypoint');
    fly(start.lat, start.lng, 10);
  }

  function rebalanceFrameworkTargets(prev: BuilderStop[], anchor: BuilderStop) {
    if (tripLoop) return prev;
    const sorted = [...prev].sort((a, b) => a.day - b.day || prev.indexOf(a) - prev.indexOf(b));
    const final = sorted[sorted.length - 1] ?? null;
    if (!final || final.day <= anchor.day) return prev;
    return prev.map(st => {
      if (st.day <= anchor.day || st.day >= final.day || !isFrameworkTarget(st)) return st;
      const t = (st.day - anchor.day) / (final.day - anchor.day);
      return {
        ...st,
        lat: anchor.lat + (final.lat - anchor.lat) * t,
        lng: anchor.lng + (final.lng - anchor.lng) * t,
        description: `Rebalanced target after selecting ${anchor.name.split(',')[0]}. Search this leg for camps, fuel, and POIs.`,
      };
    });
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

  async function runDiscovery(tab: DiscoveryTab, target: { lat: number; lng: number }, leg: LegSearchContext | null, opts: { focusMap?: boolean } = {}) {
    const useLeg = !!leg;
    setDiscoverLoading(true);
    setDiscoverySummary('');
    if (opts.focusMap !== false) fly(target.lat, target.lng, useLeg ? 8 : 9);
    try {
      if (tab === 'camps') {
        if (useLeg) {
          const radius = Math.max(28, Math.min(48, leg!.miles / 4 + 12));
          const found = uniqueByGeo((await Promise.all(
            legSamplePoints(leg!).map(point => api.getNearbyCamps(point.lat, point.lng, radius, []).catch(() => []))
          )).flat());
          const scopedRaw = found
              .map(camp => withLegProjection(camp, leg!))
              .filter(camp => (camp.route_distance_mi ?? 999) <= routeBufferForMiles(leg!.miles) + 8);
          let scoped = leg!.purpose === 'overnight' ? overnightEndpointCamps(scopedRaw, leg!) : spreadAlongLeg(scopedRaw);
          let fallbackText = '';
          if (leg!.purpose === 'overnight' && scoped.length === 0) {
            const endpointCamps = await api.getNearbyCamps(leg!.to.lat, leg!.to.lng, 55, []).catch(() => []);
            scoped = endpointCamps
              .map(camp => withLegProjection(camp, leg!))
              .sort((a, b) => haversineMi(a, leg!.to) - haversineMi(b, leg!.to));
            fallbackText = ' using the day-end area';
          }
          setCamps(scoped);
          setDiscoverySummary(`${scoped.length} camp${scoped.length === 1 ? '' : 's'} ${leg!.purpose === 'overnight' ? `near Day ${leg!.targetDay ?? activeDay} endpoint${fallbackText}` : 'spread along this leg'}`);
        } else {
          const found = await api.getNearbyCamps(target.lat, target.lng, 45, []);
          setCamps(found);
          setDiscoverySummary(`${found.length} camp${found.length === 1 ? '' : 's'} near this area`);
        }
      } else if (tab === 'gas') {
        if (useLeg) {
          const radius = Math.max(24, Math.min(42, leg!.miles / 5 + 10));
          const nrelStations = uniqueByGeo((await Promise.all(
            legSamplePoints(leg!).map(point => api.getGas(point.lat, point.lng, radius).catch(() => []))
          )).flat());
          const osmFuel = uniqueByGeo((await Promise.all(
            legSamplePoints(leg!).map(point => api.getOsmPois(point.lat, point.lng, radius, FUEL_POI_TYPES).catch(() => []))
          )).flat());
          const offlineFuel = routeScopedOfflinePlaces(offlinePlaces, leg!, ['fuel', 'propane']);
          const stations = uniqueByGeo([
            ...nrelStations,
            ...osmFuel.map(poiToGasStation),
            ...offlineFuel.map(poiToGasStation),
          ]);
          if (stations.length === 0) {
            const nominatimFuel = uniqueByGeo((await Promise.all(
              legSamplePoints(leg!).map(point => searchNominatimNearby('gas station', point, radius, 'fuel', 5).catch(() => []))
            )).flat());
            stations.push(...nominatimFuel.map(poiToGasStation));
          }
          const scoped = spreadAlongLeg(stations
            .map(st => withLegProjection(st, leg!))
            .filter(st => (st.route_distance_mi ?? 999) <= routeBufferForMiles(leg!.miles) + 8)
          );
          setGas(scoped);
          setDiscoverySummary(`${scoped.length} fuel stop${scoped.length === 1 ? '' : 's'} along this leg`);
        } else {
          const [nrelStations, osmFuel] = await Promise.all([
            api.getGas(target.lat, target.lng, 35).catch(() => []),
            api.getOsmPois(target.lat, target.lng, 35, FUEL_POI_TYPES).catch(() => []),
          ]);
          const offlineFuel = areaScopedOfflinePlaces(offlinePlaces, target, ['fuel', 'propane'], 45);
          const stations = uniqueByGeo([
            ...nrelStations,
            ...osmFuel.map(poiToGasStation),
            ...offlineFuel.map(poiToGasStation),
          ]);
          if (stations.length === 0) {
            const nominatimFuel = await searchNominatimNearby('gas station', target, 35, 'fuel', 8).catch(() => []);
            stations.push(...nominatimFuel.map(poiToGasStation));
          }
          stations.sort((a, b) => (a.route_distance_mi ?? haversineMi(a, target)) - (b.route_distance_mi ?? haversineMi(b, target)));
          setGas(stations);
          setDiscoverySummary(`${stations.length} fuel stop${stations.length === 1 ? '' : 's'} near this area`);
        }
      } else {
        if (useLeg) {
          const radius = Math.max(24, Math.min(42, leg!.miles / 5 + 12));
          const found = uniqueByGeo((await Promise.all(
            legSamplePoints(leg!).map(point => api.getOsmPois(point.lat, point.lng, radius, ROUTE_POI_TYPES).catch(() => []))
          )).flat());
          const offlineRoutePlaces = routeScopedOfflinePlaces(
            offlinePlaces,
            leg!,
            ROUTE_POI_TYPES.split(',').filter(type => type !== 'fuel' && type !== 'propane')
          );
          const routePlaces = uniqueByGeo([...found, ...offlineRoutePlaces]);
          if (routePlaces.length === 0) {
            const fallbackQueries: Array<[string, OsmPoi['type']]> = [
              ['trailhead', 'trailhead'],
              ['viewpoint', 'viewpoint'],
              ['water', 'water'],
              ['grocery', 'grocery'],
            ];
            const nominatimPlaces = uniqueByGeo((await Promise.all(
              legSamplePoints(leg!).flatMap(point =>
                fallbackQueries.map(([query, type]) => searchNominatimNearby(query, point, radius, type, 3).catch(() => []))
              )
            )).flat());
            routePlaces.push(...nominatimPlaces);
          }
          const scoped = spreadAlongLeg(routePlaces
              .map(poi => withLegProjection(poi, leg!))
              .filter(poi => poi.route_distance_mi <= routeBufferForMiles(leg!.miles) + 5)
          );
          setPois(scoped);
          setDiscoverySummary(`${scoped.length} place${scoped.length === 1 ? '' : 's'} along this leg`);
        } else {
          const found = await api.getOsmPois(target.lat, target.lng, 40, ROUTE_POI_TYPES).catch(() => []);
          const offlineRoutePlaces = areaScopedOfflinePlaces(
            offlinePlaces,
            target,
            ROUTE_POI_TYPES.split(',').filter(type => type !== 'fuel' && type !== 'propane'),
            45
          );
          const routePlaces = uniqueByGeo([...found, ...offlineRoutePlaces]);
          if (routePlaces.length === 0) {
            const fallbackQueries: Array<[string, OsmPoi['type']]> = [
              ['trailhead', 'trailhead'],
              ['viewpoint', 'viewpoint'],
              ['water', 'water'],
              ['grocery', 'grocery'],
            ];
            const nominatimPlaces = uniqueByGeo((await Promise.all(
              fallbackQueries.map(([query, type]) => searchNominatimNearby(query, target, 40, type, 5).catch(() => []))
            )).flat());
            routePlaces.push(...nominatimPlaces);
          }
          const scoped = routePlaces
            .map(poi => ({ ...poi, route_distance_mi: poi.route_distance_mi ?? haversineMi(poi, target) }))
            .sort((a, b) => (a.route_distance_mi ?? 999) - (b.route_distance_mi ?? 999));
          setPois(scoped);
          setDiscoverySummary(`${scoped.length} place${scoped.length === 1 ? '' : 's'} near this area`);
        }
      }
    } catch {
      Alert.alert('Search failed', 'Could not load nearby stops right now.');
      setInlineSearch(null);
    } finally {
      setDiscoverLoading(false);
    }
  }

  function clearDiscoveryResults() {
    setCamps([]);
    setGas([]);
    setPois([]);
    setDiscoverySummary('');
    setInlineSearch(null);
  }

  async function discover() {
    const target = legContext ? legContext.center : anchor;
    if (!target) {
      Alert.alert('Add a stop first', 'Start with a city, address, or map point, then discover camps, fuel, and POIs nearby.');
      return;
    }
    setInlineSearch(null);
    await runDiscovery(discoverTab, target, legContext);
  }

  function addCamp(camp: CampsitePin) {
    const stopDay = insertTargetDay ?? activeDay;
    const campStop: BuilderStop = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      day: stopDay,
      name: camp.name,
      lat: camp.lat,
      lng: camp.lng,
      type: 'camp',
      description: camp.description || 'Camp selected in Route Builder.',
      land_type: camp.land_type || 'camp',
      source: 'camp',
      camp,
    };
    if (replaceStopId) {
      setStops(prev => {
        const replaced = prev.map(st => st.id === replaceStopId ? {
          ...st,
          ...campStop,
          id: st.id,
          day: st.day,
          gas: undefined,
          poi: undefined,
        } : st);
        const anchorStop = replaced.find(st => st.id === replaceStopId) ?? campStop;
        return rebalanceFrameworkTargets(replaced, anchorStop);
      });
      setReplaceStopId(null);
      setInsertAfterId(null);
      setInsertTargetDay(null);
      setSelectedCamp(null);
      clearDiscoveryResults();
      fly(camp.lat, camp.lng, 12);
      return;
    }
    const targetDay = legContext ? stopDay : null;
    const frameworkTarget = targetDay
      ? orderedStops.find(st => st.day === targetDay && isFrameworkTarget(st))
      : null;
    if (frameworkTarget) {
      setStops(prev => {
        const anchorStop = { ...campStop, id: frameworkTarget.id, day: frameworkTarget.day };
        return rebalanceFrameworkTargets(prev.map(st => st.id === frameworkTarget.id ? anchorStop : st), anchorStop);
      });
      setSelectedCamp(null);
      setInsertAfterId(null);
      setInsertTargetDay(null);
      clearDiscoveryResults();
      fly(camp.lat, camp.lng, 12);
      return;
    }
    addStop({
      name: camp.name,
      lat: camp.lat,
      lng: camp.lng,
      type: 'camp',
      description: camp.description || 'Camp selected in Route Builder.',
      land_type: camp.land_type || 'camp',
      source: 'camp',
      camp,
      day: stopDay,
    });
    clearDiscoveryResults();
    setInsertAfterId(null);
    setInsertTargetDay(null);
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
    clearDiscoveryResults();
  }

  function addPoi(poi: OsmPoi) {
    const type = builderTypeForPoi(poi.type);
    addStop({
      name: poi.name || poi.type,
      lat: poi.lat,
      lng: poi.lng,
      type,
      description: `${poi.type.replace(/_/g, ' ')} stop selected in Route Builder.`,
      land_type: type === 'fuel' || type === 'motel' ? 'town' : 'route',
      source: 'poi',
      poi,
    });
    clearDiscoveryResults();
  }

  function removeStop(id: string) {
    if (insertAfterId === id) setInsertAfterId(null);
    if (insertAfterId === id) setInsertTargetDay(null);
    if (replaceStopId === id) setReplaceStopId(null);
    setStops(prev => prev.filter(st => st.id !== id));
  }

  function selectInsertStop(stop: BuilderStop) {
    setInsertAfterId(prev => {
      const next = prev === stop.id ? null : stop.id;
      setInsertTargetDay(next ? stop.day : null);
      return next;
    });
    setActiveDay(stop.day);
    fly(stop.lat, stop.lng, 13);
  }

  function scanBetweenStops(from: BuilderStop, to: BuilderStop, tab: DiscoveryTab, targetDay = from.day, purpose: LegSearchContext['purpose'] = 'leg', inline = true) {
    const miles = haversineMi(from, to);
    const leg = { from, to, miles, center: midpoint(from, to), targetDay, purpose };
    setInsertAfterId(from.id);
    setInsertTargetDay(targetDay);
    setActiveDay(targetDay);
    setDiscoverTab(tab);
    setInlineSearch(inline ? {
      day: targetDay,
      tab,
      label: tab === 'camps'
        ? `Choose an overnight near Day ${targetDay} endpoint`
        : `Add ${tab === 'gas' ? 'fuel' : 'places'} between ${from.name.split(',')[0]} and ${to.name.split(',')[0]}`,
    } : null);
    runDiscovery(tab, leg.center, leg, { focusMap: false });
  }

  function scanDayPlan(plan: RouteDayPlan, tab: DiscoveryTab) {
    setActiveDay(plan.day);
    const from = plan.previous ?? plan.stops[0] ?? null;
    const to = plan.target ?? plan.stops[plan.stops.length - 1] ?? null;
    if (from && to && from.id !== to.id) {
      scanBetweenStops(from, to, tab, plan.day, tab === 'camps' ? 'overnight' : 'leg');
      return;
    }
    if (to) {
      setDiscoverTab(tab);
      setInsertTargetDay(plan.day);
      setInlineSearch({
        day: plan.day,
        tab,
        label: tab === 'camps' ? `Choose a camp near Day ${plan.day}` : `Add ${tab === 'gas' ? 'fuel' : 'places'} near Day ${plan.day}`,
      });
      runDiscovery(tab, { lat: to.lat, lng: to.lng }, null, { focusMap: false });
      return;
    }
    const fallbackTarget = plan.previous ?? orderedStops[orderedStops.length - 1] ?? anchor;
    if (fallbackTarget) {
      setDiscoverTab(tab);
      setInsertTargetDay(plan.day);
      setInlineSearch({
        day: plan.day,
        tab,
        label: tab === 'camps'
          ? `Choose a camp near Day ${plan.day}`
          : `Add ${tab === 'gas' ? 'fuel' : 'places'} near Day ${plan.day}`,
      });
      runDiscovery(tab, { lat: fallbackTarget.lat, lng: fallbackTarget.lng }, null, { focusMap: false });
      return;
    }
    setInlineSearch(null);
    Alert.alert('Start the route first', 'Add a start location and destination, then Trailhead can search camps, fuel, and places for each day.');
  }

  function replaceCampStop(stop: BuilderStop) {
    const sortedIdx = orderedStops.findIndex(st => st.id === stop.id);
    const from = orderedStops[sortedIdx - 1] ?? orderedStops[sortedIdx];
    const leg = from && from.id !== stop.id
      ? { from, to: stop, miles: haversineMi(from, stop), center: midpoint(from, stop), targetDay: stop.day, purpose: 'overnight' as const }
      : null;
    setReplaceStopId(stop.id);
    setInsertAfterId(from?.id ?? null);
    setInsertTargetDay(stop.day);
    setActiveDay(stop.day);
    setDiscoverTab('camps');
    setInlineSearch({ day: stop.day, tab: 'camps', label: `Swap the Day ${stop.day} camp` });
    if (leg) runDiscovery('camps', leg.center, leg, { focusMap: false });
    else runDiscovery('camps', { lat: stop.lat, lng: stop.lng }, null, { focusMap: false });
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
        setCampDetail({
          ...selectedCamp,
          photos: selectedCamp.photo_url ? [selectedCamp.photo_url] : [],
          amenities: [],
          site_types: selectedCamp.tags ?? [],
          activities: [],
          campsites_count: 0,
          source: selectedCamp.verified_source ?? selectedCamp.source,
          description: stripHtml(selectedCamp.description) || 'This camp has a route preview, but a full profile has not been built yet. You can still add it to the trip and replace it later from the route.',
        } as CampsiteDetail);
        setCampInsight(null);
        setShowCampDetail(true);
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

  function ensureCampForDay(campStop: BuilderStop, targetDay: number, rest = false) {
    setDays(prev => prev.includes(targetDay) ? prev : [...prev, targetDay].sort((a, b) => a - b));
    setStops(prev => {
      const hasSameCamp = prev.some(st => st.day === targetDay && (st.type === 'camp' || st.type === 'motel') && closeEnough(st, campStop));
      const withoutFrameworkTarget = prev.filter(st => !(st.day === targetDay && isFrameworkTarget(st)));
      if (hasSameCamp) return withoutFrameworkTarget;
      const clone: BuilderStop = {
        ...campStop,
        id: `rest_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        day: targetDay,
        type: campStop.type === 'motel' ? 'motel' : 'camp',
        description: rest ? `Rest day at ${campStop.name}.` : campStop.description,
        gas: undefined,
        poi: undefined,
      };
      return [...withoutFrameworkTarget, clone];
    });
    if (rest) setRestDays(prev => prev.includes(targetDay) ? prev : [...prev, targetDay].sort((a, b) => a - b));
    setActiveDay(targetDay);
    setInsertAfterId(null);
    setInsertTargetDay(null);
    setReplaceStopId(null);
    fly(campStop.lat, campStop.lng, 12);
  }

  function stayAtCampNextDay(campStop: BuilderStop) {
    ensureCampForDay(campStop, campStop.day + 1, true);
  }

  function toggleRestDay(day: number) {
    if (restDays.includes(day)) {
      setRestDays(prev => prev.filter(d => d !== day));
      return;
    }
    const sameDayCamp = [...orderedStops].reverse().find(st => st.day === day && (st.type === 'camp' || st.type === 'motel')) ?? null;
    const previousCamp = [...orderedStops].reverse().find(st => st.day < day && (st.type === 'camp' || st.type === 'motel')) ?? null;
    const camp = sameDayCamp ?? previousCamp;
    if (camp) {
      ensureCampForDay(camp, day, true);
      return;
    }
    setRestDays(prev => [...prev, day].sort((a, b) => a - b));
  }

  async function addDestinationFromSetup() {
    const q = endQuery.trim();
    if (!q) {
      Alert.alert('Destination needed', 'Enter the place you want to end up at, then build the route framework.');
      return null;
    }
    setBuildingFramework(true);
    try {
      let start = orderedStops[0] ?? null;
      const startQ = startQuery.trim();
      if (startQ) {
        const [startPlace] = await geocodePlaces(startQ);
        if (!startPlace) {
          Alert.alert('Start not found', 'Try a city, address, trailhead, or coordinates for the route start.');
          return null;
        }
        start = {
          id: `start_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          day: 1,
          name: startPlace.name,
          lat: startPlace.lat,
          lng: startPlace.lng,
          type: 'start',
          description: 'Route start.',
          land_type: 'route',
          source: 'search',
        };
      } else if (!start && userLoc) {
        start = {
          id: `start_${Date.now()}`,
          day: 1,
          name: 'Current location',
          lat: userLoc.lat,
          lng: userLoc.lng,
          type: 'start' as BuilderStopType,
          description: 'Route start.',
          land_type: 'route',
          source: 'map' as const,
        };
      } else if (!start && !startQ) {
        const loc = await getRouteBuilderLocation();
        if (!loc) return null;
        start = {
          id: `start_${Date.now()}`,
          day: 1,
          name: 'Current location',
          lat: loc.lat,
          lng: loc.lng,
          type: 'start' as BuilderStopType,
          description: 'Route start.',
          land_type: 'route',
          source: 'map' as const,
        };
      }
      const [place] = await geocodePlaces(q);
      if (!place) {
        Alert.alert('Destination not found', 'Try a city, campground, park, trailhead, or coordinates.');
        return null;
      }
      if (!start) {
        Alert.alert('Start needed', 'Add a start point or allow location so Trailhead knows where the route begins.');
        return null;
      }
      const destination: BuilderStop = {
        id: `dest_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        day: Math.max(1, Math.round(parsePositiveNumber(plannedDays) ?? 3)),
        name: place.name,
        lat: place.lat,
        lng: place.lng,
        type: 'waypoint',
        description: 'Route destination.',
        land_type: 'route',
        source: 'search',
      };
      const next = orderedStops.length
        ? [start, ...orderedStops.slice(1, Math.max(1, orderedStops.length - 1)), destination]
        : [start, destination];
      setStops(next);
      setEndQuery('');
      fly((start.lat + destination.lat) / 2, (start.lng + destination.lng) / 2, 5);
      return next;
    } finally {
      setBuildingFramework(false);
    }
  }

  async function buildRouteFramework() {
    let base = orderedStops;
    if (endQuery.trim()) {
      const next = await addDestinationFromSetup();
      if (!next) return;
      base = next;
    }
    if (base.length < 2) {
      Alert.alert('Start and end needed', 'Add a start and destination first. Trailhead will split the route into day target areas from there.');
      return;
    }
    const routeMiles = haversineMi(base[0], base[base.length - 1]);
    const plannedCount = parsePositiveNumber(plannedDays) ?? days.length ?? 3;
    const milesCount = Math.ceil(routeMiles / (parsePositiveNumber(targetMiles) ?? 180));
    const count = Math.max(1, Math.min(14, Math.round(distanceMode === 'miles' ? milesCount : plannedCount)));
    const first = base[0];
    const last = base[base.length - 1];
    const buildLoop = tripLoop && count > 1 && !closeEnough(first, last);
    const turnDay = buildLoop ? Math.max(1, Math.min(count - 1, Math.ceil(count / 2))) : count;
    const styleLabel = routeStyle === 'adventure' ? 'scenic target area' : routeStyle === 'direct' ? 'direct target area' : 'target area';
    const scenicOffset = routeStyle === 'adventure'
      ? Math.max(35, Math.min(140, routeMiles * 0.16))
      : routeStyle === 'balanced'
      ? Math.max(16, Math.min(70, routeMiles * 0.07))
      : 0;
    const framework: BuilderStop[] = [
      { ...first, day: 1, type: first.type === 'start' ? 'start' : first.type },
    ];
    if (tripBuildMode === 'recommended') {
      for (let day = 1; day < count; day++) {
        const outbound = !buildLoop || day <= turnDay;
        const t = buildLoop
          ? outbound
            ? day / turnDay
            : (day - turnDay) / (count - turnDay)
          : day / count;
        const from = outbound ? first : last;
        const to = outbound ? last : first;
        const point = scenicPoint(
          from,
          to,
          t,
          buildLoop
            ? outbound ? scenicOffset : -scenicOffset
            : routeStyle === 'adventure' ? scenicOffset * (day % 2 === 0 ? -0.65 : 1) : 0
        );
        const name = buildLoop && day === turnDay
          ? `${last.name.split(',')[0]} turnaround`
          : `Day ${day} ${styleLabel}`;
        framework.push({
          id: `target_${Date.now()}_${day}_${Math.random().toString(36).slice(2, 6)}`,
          day,
          name,
          lat: point.lat,
          lng: point.lng,
          type: 'waypoint',
          description: buildLoop && day === turnDay
            ? 'Loop turnaround target. Pick a camp nearby, then build the return days back to the start.'
            : `Planning anchor based on ${distanceMode === 'miles' ? `${Math.round(parsePositiveNumber(targetMiles) ?? 180)} miles` : `${fmtHours(parsePositiveNumber(dayDriveTargets[day]) ?? planningStats.driveLimit)} max drive`} between stops. Add fuel, POIs, and camp choices around this leg.`,
          land_type: 'route',
          source: 'map',
        });
      }
    }
    framework.push(buildLoop
      ? {
          ...first,
          id: `return_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          day: count,
          type: 'waypoint',
          name: `${first.name.split(',')[0]} return`,
          description: 'Loop return to the route start.',
          source: 'map',
        }
      : { ...last, day: count });
    setDays(Array.from({ length: count }, (_, i) => i + 1));
    setStops(framework);
    setActiveDay(1);
    setInsertAfterId(null);
    setInsertTargetDay(null);
    setRouteName(routeName.trim() || (buildLoop ? `${first.name.split(',')[0]} to ${last.name.split(',')[0]} Loop` : `${first.name.split(',')[0]} to ${last.name.split(',')[0]}`));
    fly((first.lat + last.lat) / 2, (first.lng + last.lng) / 2, 5);
    setShowBuildSuccess(true);
  }

  function closeLoopToStart() {
    if (orderedStops.length < 2) return;
    const first = orderedStops[0];
    const last = orderedStops[orderedStops.length - 1];
    if (closeEnough(first, last)) {
      setTripLoop(true);
      return;
    }
    setInsertAfterId(null);
    setInsertTargetDay(null);
    setActiveDay(last.day);
    setTripLoop(true);
    const stop: BuilderStop = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: `${first.name.split(',')[0]} return`,
      lat: first.lat,
      lng: first.lng,
      type: 'waypoint',
      description: 'Loop return to the route start.',
      land_type: first.land_type || 'route',
      source: 'map',
      day: last.day,
    };
    setStops(prev => [...prev, stop]);
    fly(stop.lat, stop.lng, 11);
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
    const navStops = sorted.filter(st => !isFrameworkTarget(st));
    const waypoints: Waypoint[] = navStops.map(st => ({
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
      const wps = navStops.filter(st => st.day === day);
      const hasPlanningTarget = sorted.some(st => st.day === day && isFrameworkTarget(st));
      const prev = [...navStops].reverse().find(st => st.day < day) ?? null;
      let miles = 0;
      if (prev && wps.length) miles += haversineMi(prev, wps[0]);
      for (let i = 1; i < wps.length; i++) miles += haversineMi(wps[i - 1], wps[i]);
      const first = wps[0]?.name?.split(',')[0] ?? 'Start';
      const last = wps[wps.length - 1]?.name?.split(',')[0] ?? (hasPlanningTarget ? 'overnight camp needed' : 'Finish');
      const rest = restDays.includes(day);
      return {
        day,
        title: rest ? `Day ${day}: Rest / local exploring` : `Day ${day}: ${first} to ${last}`,
        description: rest
          ? 'Rest day. Keep the camp, add local POIs, or set a shorter drive max.'
          : wps.length
          ? `Manual route day with ${wps.length} planned stop${wps.length === 1 ? '' : 's'}.`
          : hasPlanningTarget
          ? 'Planning day. Pick an overnight camp before using GPS navigation.'
          : 'Open day. Add a destination, fuel, POIs, and camp.',
        est_miles: Math.round(miles),
        road_type: rest ? 'none' : routeStyle === 'adventure' ? 'backroads' : routeStyle === 'direct' ? 'direct' : 'mixed',
        highlights: wps.filter(st => st.type === 'waypoint' || st.type === 'camp').slice(0, 3).map(st => st.name),
      };
    });
    const campsites = navStops.filter(st => st.camp).map(st => ({ ...st.camp!, recommended_day: st.day }));
    const gas_stations = navStops.filter(st => st.gas).map(st => ({ ...st.gas!, recommended_day: st.day }));
    return {
      trip_id: importedTripId ? `${importedTripId}_edited_${Date.now()}` : `manual_${Date.now()}`,
      plan: {
        trip_name: resolvedRouteName(),
        overview: importedTripId
          ? 'A Trailhead route edited in Route Builder with user-selected stops, fuel, POIs, and camps.'
          : 'A manually built Trailhead route with user-selected stops, fuel, POIs, and camps.',
        duration_days: days.length,
        states: importedTripId ? activeTrip?.plan.states ?? [] : [],
        total_est_miles: Math.round(totals.miles),
        waypoints,
        daily_itinerary,
        logistics: {
          vehicle_recommendation: `User-built ${routeStyle} route. Review road surfaces against the saved rig profile before departure.`,
          fuel_strategy: `Estimated fuel: ${Math.round(planningStats.gallons)} gal / $${Math.round(planningStats.fuelCost)} at ${planningStats.mpg} MPG and $${planningStats.price.toFixed(2)}/gal. Fuel stops are manually selected.`,
          water_strategy: 'Carry water for each day and add water POIs where needed.',
          permits_needed: `${tripLoop ? 'Loop route. ' : ''}Check local land manager rules for selected camps and trailheads.`,
          best_season: `Verify seasonal closures and weather before departure. Daily drive max: ${fmtHours(planningStats.driveLimit)}.`,
        },
      },
      campsites,
      gas_stations,
      route_pois: navStops.filter(st => st.poi).map(st => st.poi!),
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
    if (openMap) router.push('/(tabs)/map');
  }

  function renderCampPreview(stop: BuilderStop, label: string, compact = false) {
    const camp = stop.camp;
    return (
      <View style={[s.selectedCampCard, compact && s.selectedCampCardCompact]}>
        <View style={[s.selectedCampPhotoWrap, compact && s.selectedCampPhotoWrapCompact]}>
          {camp?.photo_url ? (
            <Image source={{ uri: camp.photo_url }} style={[s.selectedCampPhoto, compact && s.selectedCampPhotoCompact]} resizeMode="cover" />
          ) : (
            <View style={[s.selectedCampPlaceholder, compact && s.selectedCampPhotoCompact, { backgroundColor: landColor(stop.land_type).bg }]}>
              <Ionicons name={stop.type === 'motel' ? 'bed-outline' : 'bonfire-outline'} size={compact ? 18 : 24} color={landColor(stop.land_type).text} />
            </View>
          )}
        </View>
        <View style={[s.selectedCampBody, compact && s.selectedCampBodyCompact]}>
          <Text style={s.selectedCampLabel}>{label}</Text>
          <Text style={s.selectedCampName} numberOfLines={2}>{stop.name}</Text>
          <Text style={s.selectedCampMeta} numberOfLines={2}>
            {stop.land_type || stopLabel(stop.type)}{camp?.cost ? ` · ${camp.cost}` : ''}{restDays.includes(stop.day) ? ' · rest day' : ''}
          </Text>
          {!compact ? (
            <View style={s.campPreviewActions}>
              <TouchableOpacity style={s.campPreviewBtn} onPress={() => replaceCampStop(stop)}>
                <Ionicons name="swap-horizontal-outline" size={12} color={C.orange} />
                <Text style={s.campPreviewBtnText}>SWAP</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.campPreviewBtn} onPress={() => stayAtCampNextDay(stop)}>
                <Ionicons name="bed-outline" size={12} color={C.green} />
                <Text style={[s.campPreviewBtnText, { color: C.green }]}>STAY NEXT DAY</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
        {camp ? (
          <TouchableOpacity style={s.selectedCampSwap} onPress={() => openCampDetail(camp)}>
            <Ionicons name="image-outline" size={14} color={C.orange} />
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  function renderRouteTimeline() {
    if (!hasBaseRoute) return null;
    return (
      <View style={s.routeTimelineCard}>
        <View style={s.routeTimelineTop}>
          <View style={{ flex: 1 }}>
            <Text style={s.routeTimelineTitle}>Trip overview</Text>
            <Text style={s.routeTimelineSub}>Scroll days, choose camps, then add fuel and places in the matching segment.</Text>
          </View>
          <TouchableOpacity style={s.routeTimelineLoop} onPress={() => setTripLoop(v => !v)}>
            <Ionicons name={tripLoop ? 'repeat' : 'repeat-outline'} size={13} color={tripLoop ? C.green : C.text3} />
            <Text style={[s.routeTimelineLoopText, tripLoop && { color: C.green }]}>ROUND</Text>
          </TouchableOpacity>
        </View>
        {routeDayPlans.map(plan => {
          const camp = plan.stops.find(st => st.type === 'camp' || st.type === 'motel') ?? null;
          return (
            <View key={plan.day} style={s.routeDayWrap}>
              <TouchableOpacity activeOpacity={0.88} style={[s.routeDayCard, activeDay === plan.day && s.routeDayCardActive]} onPress={() => setActiveDay(plan.day)}>
                <View style={s.routeDayDotCol}>
                  <View style={[s.routeDayDot, plan.complete && { backgroundColor: C.green, borderColor: C.green }]} />
                  <View style={s.routeDayStem} />
                </View>
                <View style={{ flex: 1, gap: 8 }}>
                  <View style={s.routeDayHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.routeDayTitle}>Day {plan.day}{plan.rest ? ' · Rest' : ''}</Text>
                      <Text style={s.routeDayMeta}>{fmtMi(plan.miles)} · {fmtHours(plan.hours)}{plan.previous ? ` · from ${plan.previous.name.split(',')[0]}` : ''}</Text>
                    </View>
                    <TouchableOpacity style={s.routeDayMiniBtn} onPress={() => scanDayPlan(plan, 'camps')}>
                      <Ionicons name="bonfire-outline" size={13} color={C.orange} />
                    </TouchableOpacity>
                    <TouchableOpacity style={s.routeDayMiniBtn} onPress={() => scanDayPlan(plan, 'gas')}>
                      <Ionicons name="flash-outline" size={13} color={C.orange} />
                    </TouchableOpacity>
                  </View>
                  {camp ? (
                    renderCampPreview(camp, plan.rest ? 'OVERNIGHT / REST CAMP' : 'OVERNIGHT CAMP', true)
                  ) : (
                    <TouchableOpacity style={s.routeDayEmptyCamp} onPress={() => scanDayPlan(plan, 'camps')}>
                      <Ionicons name="add-circle-outline" size={14} color={C.orange} />
                      <Text style={s.routeDayEmptyCampText}>{plan.frameworkTarget ? 'Choose camp near day finish' : 'Choose overnight camp'}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </TouchableOpacity>
              {renderInlineResultsForDay(plan.day)}
            </View>
          );
        })}
      </View>
    );
  }

  function renderInlineResultsForDay(day: number) {
    if (!inlineSearch || inlineSearch.day !== day) return null;
    const inlineTab = inlineSearch.tab;
    return (
      <View style={s.inlineResults}>
        <View style={s.inlineResultsTop}>
          <View style={{ flex: 1 }}>
            <Text style={s.inlineResultsTitle}>{inlineSearch.label}</Text>
            <Text style={s.inlineResultsSub}>{discoverySummary || 'Searching along this day segment'}</Text>
          </View>
          <TouchableOpacity style={s.inlineClose} onPress={() => setInlineSearch(null)}>
            <Ionicons name="close" size={13} color={C.text3} />
          </TouchableOpacity>
        </View>
        {discoverLoading ? (
          <View style={s.inlineLoading}>
            <ActivityIndicator size="small" color={C.orange} />
            <Text style={s.inlineLoadingText}>Finding options on this route segment...</Text>
          </View>
        ) : inlineTab === 'camps' ? (
          camps.length ? camps.slice(0, 6).map(camp => (
            <TouchableOpacity key={camp.id} style={s.inlineCampCard} onPress={() => openCampDetail(camp)}>
              <View style={s.inlineCampPhotoWrap}>
                {camp.photo_url ? (
                  <Image source={{ uri: camp.photo_url }} style={s.inlineCampPhoto} resizeMode="cover" />
                ) : (
                  <View style={[s.inlineCampPlaceholder, { backgroundColor: landColor(camp.land_type).bg }]}>
                    <Ionicons name="bonfire-outline" size={19} color={landColor(camp.land_type).text} />
                  </View>
                )}
              </View>
              <View style={s.inlineCampBody}>
                <Text style={s.candidateName} numberOfLines={2}>{camp.name}</Text>
                <Text style={s.candidateMeta} numberOfLines={2}>
                  {camp.route_distance_mi != null ? `${fmtMi(camp.route_distance_mi)} off route · ` : ''}
                  {routeProgressLabel((camp as any).route_progress) ? `${routeProgressLabel((camp as any).route_progress)} · ` : ''}
                  {camp.land_type || 'Camp'} · {camp.cost || 'See site'}
                </Text>
              </View>
              <TouchableOpacity style={s.useBtn} onPress={() => addCamp(camp)}>
                <Text style={s.useBtnText}>{replaceStopId ? 'SWAP' : 'USE'}</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          )) : (
            <Text style={s.inlineEmpty}>No camps found for this day segment.</Text>
          )
        ) : inlineTab === 'gas' ? (
          gas.length ? gas.slice(0, 6).map(station => (
            <TouchableOpacity key={String(station.id)} style={s.inlineStopRow} onPress={() => { addGas(station); fly(station.lat, station.lng, 13); }}>
              <View style={[s.candidateIcon, { borderColor: '#eab30866', backgroundColor: '#eab30818' }]}>
                <Ionicons name="flash-outline" size={16} color="#eab308" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.candidateName} numberOfLines={1}>{station.name}</Text>
                <Text style={s.candidateMeta} numberOfLines={1}>
                  {station.route_distance_mi != null ? `${fmtMi(station.route_distance_mi)} off route · ` : ''}
                  {routeProgressLabel((station as any).route_progress) ? `${routeProgressLabel((station as any).route_progress)} · ` : ''}
                  {station.address || station.fuel_types || 'Fuel stop'}
                </Text>
              </View>
            </TouchableOpacity>
          )) : (
            <Text style={s.inlineEmpty}>No fuel found for this day segment.</Text>
          )
        ) : (
          discoveryPois.length ? discoveryPois.slice(0, 6).map(poi => (
            <TouchableOpacity key={poi.id} style={s.inlineStopRow} onPress={() => { addPoi(poi); fly(poi.lat, poi.lng, 13); }}>
              <View style={[s.candidateIcon, { borderColor: placeColor(poi.type) + '66', backgroundColor: placeColor(poi.type) + '18' }]}>
                <Ionicons name={placeIcon(poi.type)} size={16} color={placeColor(poi.type)} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.candidateName} numberOfLines={1}>{poi.name || poi.type}</Text>
                <Text style={s.candidateMeta} numberOfLines={1}>
                  {(poi as any).route_distance_mi != null ? `${fmtMi((poi as any).route_distance_mi)} off route · ` : ''}
                  {routeProgressLabel((poi as any).route_progress) ? `${routeProgressLabel((poi as any).route_progress)} · ` : ''}
                  {poi.type.replace(/_/g, ' ')}
                </Text>
              </View>
            </TouchableOpacity>
          )) : (
            <Text style={s.inlineEmpty}>No places found for this day segment.</Text>
          )
        )}
      </View>
    );
  }

  function renderWizardSetup() {
    const steps = ['Start', 'Destination', 'Style', 'Pace'];
    const canMoveNext = wizardStep === 0
      ? !!(startQuery.trim() || orderedStops[0] || userLoc)
      : wizardStep === 1
      ? !!(endQuery.trim() || orderedStops.length > 1)
      : true;
    const nextStep = () => setWizardStep(step => Math.min(3, step + 1));
    return (
      <View style={s.wizardCard}>
        <View style={s.wizardSteps}>
          {steps.map((label, idx) => (
            <TouchableOpacity key={label} style={[s.wizardStep, wizardStep === idx && s.wizardStepActive]} onPress={() => setWizardStep(idx)}>
              <Text style={[s.wizardStepNum, wizardStep === idx && s.wizardStepNumActive]}>{idx + 1}</Text>
              <Text style={[s.wizardStepText, wizardStep === idx && s.wizardStepTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {wizardStep === 0 ? (
          <View style={s.wizardPane}>
            <View>
              <Text style={s.wizardTitle}>Where are you starting?</Text>
              <Text style={s.wizardHelp}>Use current location or type a city, trailhead, address, or coordinates.</Text>
            </View>
            <View style={s.setupInputWrap}>
              <View style={s.setupLabelRow}>
                <Text style={s.setupLabel}>START</Text>
                <TouchableOpacity style={s.currentLocationBtn} onPress={async () => { await setWizardStartFromLocation(); setWizardStep(1); }}>
                  <Ionicons name="locate-outline" size={10} color={C.orange} />
                  <Text style={s.currentLocationText}>CURRENT</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                value={startQuery}
                onChangeText={setStartQuery}
                placeholder={orderedStops[0]?.name?.split(',')[0] ?? (userLoc ? 'Current location' : 'Denver, address, coordinates')}
                placeholderTextColor={C.text3}
                style={s.setupInput}
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => { if (canMoveNext) nextStep(); }}
              />
            </View>
          </View>
        ) : wizardStep === 1 ? (
          <View style={s.wizardPane}>
            <View>
              <Text style={s.wizardTitle}>Where are you headed?</Text>
              <Text style={s.wizardHelp}>Pick the final destination first. Trailhead will spread day targets and camp searches between start and finish.</Text>
            </View>
            <View style={s.setupInputWrap}>
              <Text style={s.setupLabel}>DESTINATION</Text>
              <TextInput
                value={endQuery}
                onChangeText={setEndQuery}
                placeholder={orderedStops.length > 1 ? orderedStops[orderedStops.length - 1].name.split(',')[0] : 'Moab, Big Bend, coordinates'}
                placeholderTextColor={C.text3}
                style={s.setupInput}
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => { if (canMoveNext) nextStep(); }}
              />
            </View>
          </View>
        ) : wizardStep === 2 ? (
          <View style={s.wizardPane}>
            <View>
              <Text style={s.wizardTitle}>Choose the route feel</Text>
              <Text style={s.wizardHelp}>Recommended builds a base route with day targets. Blank keeps it simple for hand-building.</Text>
            </View>
            <View style={s.modeRow}>
              {(['recommended', 'blank'] as TripBuildMode[]).map(mode => (
                <TouchableOpacity key={mode} style={[s.modeCard, tripBuildMode === mode && s.modeCardActive]} onPress={() => setTripBuildMode(mode)}>
                  <View style={[s.radioDot, tripBuildMode === mode && s.radioDotActive]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.modeTitle, tripBuildMode === mode && { color: C.orange }]}>{mode === 'recommended' ? 'Recommended Trip' : 'Blank Trip'}</Text>
                    <Text style={s.modeText}>{mode === 'recommended' ? 'Auto-place day targets and camp searches.' : 'Only route points, then build by hand.'}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.routeStyleRow}>
              {(['balanced', 'direct', 'adventure'] as const).map(style => (
                <TouchableOpacity key={style} style={[s.routeStyleChip, routeStyle === style && s.routeStyleChipActive]} onPress={() => setRouteStyle(style)}>
                  <Ionicons name={style === 'direct' ? 'navigate-outline' : style === 'adventure' ? 'trail-sign-outline' : 'options-outline'} size={12} color={routeStyle === style ? C.orange : C.text3} />
                  <Text style={[s.routeStyleText, routeStyle === style && { color: C.orange }]}>
                    {style === 'adventure' ? 'WILD' : style.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : (
          <View style={s.wizardPane}>
            <View>
              <Text style={s.wizardTitle}>Set the daily pace</Text>
              <Text style={s.wizardHelp}>Hours per day is the max you want to drive. Trailhead should not force every day to hit that limit.</Text>
            </View>
            <View style={s.setupGridPair}>
              <View style={s.setupInputWrap}>
                <Text style={s.setupLabel}>DAYS</Text>
                <TextInput value={plannedDays} onChangeText={setPlannedDays} keyboardType="number-pad" style={s.setupInput} placeholder="3" placeholderTextColor={C.text3} />
              </View>
              <View style={s.setupInputWrap}>
                <Text style={s.setupLabel}>{distanceMode === 'hours' ? 'MAX HRS / DAY' : 'MI / STOP'}</Text>
                <TextInput
                  value={distanceMode === 'hours' ? driveHoursPerDay : targetMiles}
                  onChangeText={distanceMode === 'hours' ? setDriveHoursPerDay : setTargetMiles}
                  keyboardType="decimal-pad"
                  style={s.setupInput}
                  placeholder={distanceMode === 'hours' ? '5' : '180'}
                  placeholderTextColor={C.text3}
                />
              </View>
            </View>
            <View style={s.segmentRow}>
              {(['hours', 'miles'] as DistanceMode[]).map(mode => (
                <TouchableOpacity key={mode} style={[s.segmentBtn, distanceMode === mode && s.segmentBtnActive]} onPress={() => setDistanceMode(mode)}>
                  <Text style={[s.segmentText, distanceMode === mode && { color: '#fff' }]}>{mode === 'hours' ? 'HOURS' : 'MILES'}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={[s.segmentBtn, tripLoop && s.segmentBtnActive]}
                onPress={() => {
                  if (tripLoop) setTripLoop(false);
                  else if (orderedStops.length > 1) closeLoopToStart();
                  else setTripLoop(true);
                }}
              >
                <Text style={[s.segmentText, tripLoop && { color: '#fff' }]}>ROUND</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={s.wizardNav}>
          <TouchableOpacity style={[s.wizardNavBtn, wizardStep === 0 && { opacity: 0.45 }]} onPress={() => setWizardStep(step => Math.max(0, step - 1))} disabled={wizardStep === 0}>
            <Ionicons name="chevron-back" size={13} color={C.text3} />
            <Text style={s.wizardNavText}>BACK</Text>
          </TouchableOpacity>
          {wizardStep < 3 ? (
            <TouchableOpacity style={[s.wizardNextBtn, !canMoveNext && { opacity: 0.55 }]} onPress={nextStep} disabled={!canMoveNext}>
              <Text style={s.wizardNextText}>NEXT</Text>
              <Ionicons name="chevron-forward" size={13} color="#fff" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={s.wizardNextBtn} onPress={buildRouteFramework} disabled={buildingFramework}>
              {buildingFramework ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="map-outline" size={13} color="#fff" />}
              <Text style={s.wizardNextText}>{hasBaseRoute ? 'REBUILD ROUTE' : 'PREVIEW ROUTE'}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
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
          camps={mapCamps}
          gas={gas.map(g => ({ lat: g.lat, lng: g.lng, name: g.name }))}
          pois={mapPois}
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
            if (didInitialMapFitRef.current) return;
            didInitialMapFitRef.current = true;
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
        <TouchableOpacity style={s.mapFilterPill} onPress={() => setShowPlaceFilters(true)}>
          <Ionicons name="filter" size={13} color="#fff" />
          <Text style={s.mapFilterPillText}>{activePlaceFilters.length} places</Text>
        </TouchableOpacity>
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

        <View style={s.builderHero}>
          <View style={s.builderHeroTop}>
            <View style={{ flex: 1 }}>
              <Text style={s.kicker}>{hasBaseRoute ? 'TRIP WORKSPACE' : 'BASE ROUTE'}</Text>
              <Text style={s.builderHeroTitle}>{hasBaseRoute ? baseRouteSummary : 'Build the route first'}</Text>
              <Text style={s.builderHeroText}>
                {hasBaseRoute
                  ? 'Scroll the route, fill each day with fuel, wild stops, and legal camp options.'
                  : 'Pick a route shape, start, destination, rig pace, and camp style. Trailhead creates the base route, then you tune each day.'}
              </Text>
            </View>
            <View style={s.progressBadge}>
              <Text style={s.progressBadgeNum}>{hasBaseRoute ? `${realOvernights}/${routeDayPlans.length}` : `${setupProgress}/3`}</Text>
              <Text style={s.progressBadgeText}>{hasBaseRoute ? 'CAMPS' : 'READY'}</Text>
            </View>
          </View>

          {renderWizardSetup()}

          <View style={s.routeStatStrip}>
            <View style={s.routeStatItem}>
              <Ionicons name="time-outline" size={14} color={C.text3} />
              <Text style={s.routeStatValue}>{fmtHours(planningStats.driveHours)}</Text>
            </View>
            <View style={s.routeStatItem}>
              <Ionicons name="car-outline" size={14} color={C.text3} />
              <Text style={s.routeStatValue}>{fmtMi(totals.miles)}</Text>
            </View>
            <View style={s.routeStatItem}>
              <Ionicons name="flash-outline" size={14} color={C.text3} />
              <Text style={s.routeStatValue}>${Math.round(planningStats.fuelCost)}</Text>
            </View>
          </View>

          {routeStates.length > 0 ? (
            <View style={s.gasSourceStrip}>
              <Ionicons name={gasPriceStatus === 'live' ? 'cloud-done-outline' : gasPriceStatus === 'loading' ? 'cloud-download-outline' : 'cloud-offline-outline'} size={13} color={gasPriceStatus === 'live' ? C.green : C.text3} />
              <Text style={s.gasSourceText} numberOfLines={2}>
                {gasPriceStatus === 'live'
                  ? `AAA state avg: ${routeStates.slice(0, 4).map(st => `${st} $${(stateGasPrices[st] ?? planningStats.price).toFixed(2)}`).join(' · ')}`
                  : gasPriceStatus === 'loading'
                    ? 'Loading current state gas averages for this route'
                    : `Using fallback gas price until live state averages load`}
              </Text>
            </View>
          ) : null}

          {renderRouteTimeline()}

        </View>

        <View style={s.typeRow}>
          {(['start', 'fuel', 'waypoint', 'camp', 'motel'] as BuilderStopType[]).map(type => (
            <TouchableOpacity key={type} style={[s.typeChip, pendingType === type && { borderColor: stopColor(type), backgroundColor: stopColor(type) + '18' }]} onPress={() => setPendingType(type)}>
              <Ionicons name={stopIcon(type)} size={13} color={pendingType === type ? stopColor(type) : C.text3} />
              <Text style={[s.typeChipText, pendingType === type && { color: stopColor(type) }]}>{type.toUpperCase()}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={[s.insertCard, selectedInsertStop && { borderColor: C.orange + '66', backgroundColor: C.orange + '10' }]}>
          <Ionicons name={selectedInsertStop ? 'git-commit-outline' : 'add-circle-outline'} size={15} color={selectedInsertStop ? C.orange : C.text3} />
          <View style={{ flex: 1 }}>
            <Text style={s.insertTitle}>{selectedInsertStop ? 'Insert after stop' : 'Add to active day'}</Text>
            <Text style={s.insertText} numberOfLines={3}>
              {selectedInsertStop
                ? `New stops will land after ${selectedInsertStop.name.split(',')[0]} on Day ${insertTargetDay ?? selectedInsertStop.day}.`
                : 'Use a day action below to place fuel, camps, or POIs in the right leg.'}
            </Text>
          </View>
          {selectedInsertStop ? (
            <TouchableOpacity style={s.insertClear} onPress={() => { setInsertAfterId(null); setInsertTargetDay(null); }}>
              <Text style={s.insertClearText}>END</Text>
            </TouchableOpacity>
          ) : null}
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
          <Text style={s.sectionTitle}>DAY {activeDay} ITINERARY</Text>
          <Text style={s.sectionMeta}>
            {restDays.includes(activeDay) ? 'rest day' : `${fmtMi(dayMileage[activeDay] ?? 0)} · ${fmtHours(estimateMovingHours(dayMileage[activeDay] ?? 0))}`}
          </Text>
        </View>
        <View style={s.dayControlRow}>
          <TouchableOpacity
            style={[s.restToggle, restDays.includes(activeDay) && { borderColor: C.green + '77', backgroundColor: C.green + '14' }]}
            onPress={() => toggleRestDay(activeDay)}
          >
            <Ionicons name="bed-outline" size={13} color={restDays.includes(activeDay) ? C.green : C.text3} />
            <Text style={[s.restToggleText, restDays.includes(activeDay) && { color: C.green }]}>REST DAY</Text>
          </TouchableOpacity>
          <View style={s.dayHoursBox}>
            <Text style={s.setupLabel}>MAX HOURS</Text>
            <TextInput
              value={dayDriveTargets[activeDay] ?? driveHoursPerDay}
              onChangeText={v => setDayDriveTargets(prev => ({ ...prev, [activeDay]: v }))}
              keyboardType="decimal-pad"
              style={s.setupInput}
              placeholder={driveHoursPerDay}
              placeholderTextColor={C.text3}
            />
          </View>
          <Text style={s.dayControlMeta}>{fmtHours(activeDayDriveLimit)} max</Text>
        </View>
        {!hasBaseRoute ? renderInlineResultsForDay(activeDay) : null}
        {dayStops.length === 0 ? (
          <View style={s.emptyState}>
            <Text style={s.emptyTitle}>Build the day in order</Text>
            <Text style={s.emptyText}>Start with a destination, then add fuel, POIs, and a camp. Tap a stop later to insert new places after it.</Text>
          </View>
        ) : dayStops.map((st, idx) => {
          const next = dayStops[idx + 1] ?? null;
          const legMiles = next ? haversineMi(st, next) : 0;
          return (
            <View key={st.id} style={s.timelineItem}>
              <TouchableOpacity style={[s.stopRow, insertAfterId === st.id && s.stopRowSelected]} onPress={() => selectInsertStop(st)}>
                <View style={[s.stopNum, { backgroundColor: stopColor(st.type) }]}>
                  <Text style={s.stopNumText}>{idx + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.stopName} numberOfLines={1}>{st.name}</Text>
                  <Text style={s.stopMeta}>{stopLabel(st.type).toUpperCase()} · {sourceLabel(st.source)}{insertAfterId === st.id ? ' · INSERT AFTER' : ''}</Text>
                </View>
                {st.camp ? (
                  <TouchableOpacity style={s.iconBtn} onPress={() => openCampDetail(st.camp!)}>
                    <Ionicons name="image-outline" size={15} color={C.orange} />
                  </TouchableOpacity>
                ) : null}
                {st.type === 'camp' ? (
                  <TouchableOpacity style={s.iconBtn} onPress={() => replaceCampStop(st)}>
                    <Ionicons name="swap-horizontal-outline" size={15} color={C.orange} />
                  </TouchableOpacity>
                ) : null}
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
              {(st.type === 'camp' || st.type === 'motel') ? renderCampPreview(st, restDays.includes(st.day) ? 'REST / OVERNIGHT' : 'OVERNIGHT') : null}
              {next ? (
                <View style={s.legCard}>
                  <View style={s.legLine} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.legMeta}>{fmtMi(legMiles)} · {fmtHours(estimateMovingHours(legMiles))}</Text>
                    <Text style={s.legText} numberOfLines={1}>to {next.name}</Text>
                  </View>
                  <TouchableOpacity style={s.legAction} onPress={() => scanBetweenStops(st, next, 'gas')}>
                    <Ionicons name="flash-outline" size={14} color={C.orange} />
                    <Text style={s.legActionText}>FUEL</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.legAction} onPress={() => scanBetweenStops(st, next, 'camps', next.day ?? st.day, 'overnight')}>
                    <Ionicons name="bonfire-outline" size={14} color={C.orange} />
                    <Text style={s.legActionText}>CAMP</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.legAction} onPress={() => scanBetweenStops(st, next, 'poi')}>
                    <Ionicons name="trail-sign-outline" size={14} color={C.orange} />
                    <Text style={s.legActionText}>POI</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>

      <View style={s.footer} pointerEvents="box-none">
        <View>
          <Text style={s.footerMiles}>{fmtMi(totals.miles)}</Text>
          <Text style={s.footerSub}>{totals.stops} stops · {totals.camps} camps · ${Math.round(planningStats.fuelCost)} fuel · {days.length} days</Text>
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
                <Text style={s.quickCardNavText}>{replaceStopId ? 'REPLACE CAMP' : 'USE AS CAMP'}</Text>
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
                    <Text style={s.detailUseText}>{replaceStopId ? 'REPLACE CAMP' : 'USE AS CAMP'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          )}
        </View>
      </Modal>

      <Modal visible={showPlaceFilters} transparent animationType="slide" onRequestClose={() => setShowPlaceFilters(false)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setShowPlaceFilters(false)}>
          <TouchableOpacity activeOpacity={1} style={s.filterSheet}>
            <View style={s.filterSheetTop}>
              <View>
                <Text style={s.kicker}>ROUTE BUILDER</Text>
                <Text style={s.filterSheetTitle}>Downloaded Places</Text>
              </View>
              <TouchableOpacity style={s.quickCardClose} onPress={() => setShowPlaceFilters(false)}>
                <Ionicons name="close" size={17} color={C.text3} />
              </TouchableOpacity>
            </View>
            <Text style={s.filterHintText}>
              These filters control which downloaded pack points appear on the map and in Places search while building routes offline.
            </Text>
            <View style={s.filterToolbar}>
              <TouchableOpacity style={s.filterSmallBtn} onPress={() => setActivePlaceFilters(DEFAULT_PLACE_FILTERS)}>
                <Text style={s.filterSmallText}>DEFAULT</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.filterSmallBtn} onPress={() => setActivePlaceFilters(PLACE_FILTER_TYPES.map(t => t.id))}>
                <Text style={s.filterSmallText}>ALL</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.filterSmallBtn} onPress={() => setActivePlaceFilters([])}>
                <Text style={s.filterSmallText}>CLEAR</Text>
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.filterGrid}>
              {PLACE_FILTER_TYPES.map(f => {
                const active = activePlaceFilters.includes(f.id);
                const count = offlinePlaces.filter(p => p.type === f.id).length;
                return (
                  <TouchableOpacity
                    key={f.id}
                    style={[s.filterChip, active && { backgroundColor: f.color, borderColor: f.color }]}
                    onPress={() => setActivePlaceFilters(prev => (
                      prev.includes(f.id) ? prev.filter(id => id !== f.id) : [...prev, f.id]
                    ))}
                  >
                    <Ionicons name={f.icon as any} size={14} color={active ? '#fff' : f.color} />
                    <View style={{ flex: 1 }}>
                      <Text style={[s.filterChipText, active && { color: '#fff' }]}>{f.label}</Text>
                      <Text style={[s.filterChipSub, active && { color: 'rgba(255,255,255,0.76)' }]}>{count} saved</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showBuildSuccess} transparent animationType="fade" onRequestClose={() => setShowBuildSuccess(false)}>
        <TouchableOpacity style={s.buildSuccessOverlay} activeOpacity={1} onPress={() => setShowBuildSuccess(false)}>
          <TouchableOpacity activeOpacity={1} style={s.buildSuccessCard}>
            <View style={s.successIconWrap}>
              <Ionicons name="sparkles-outline" size={28} color={C.orange} />
            </View>
            <Text style={s.buildSuccessTitle}>Base Route Built</Text>
            <Text style={s.buildSuccessText}>
              Trailhead split {baseRouteSummary} into {days.length} day segments. Start with each day card to choose camps, fuel, and wild stops.
            </Text>
            <View style={s.successChecks}>
              <View style={s.successCheck}><Ionicons name="checkmark" size={14} color={C.green} /><Text style={s.successCheckText}>{fmtMi(totals.miles)}</Text></View>
              <View style={s.successCheck}><Ionicons name="checkmark" size={14} color={C.green} /><Text style={s.successCheckText}>{fmtHours(planningStats.driveHours)}</Text></View>
              <View style={s.successCheck}><Ionicons name="checkmark" size={14} color={C.green} /><Text style={s.successCheckText}>{days.length} days</Text></View>
            </View>
            <TouchableOpacity style={s.successPrimaryBtn} onPress={() => setShowBuildSuccess(false)}>
              <Text style={s.successPrimaryText}>EXPLORE MY ROUTE</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
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
  title: { color: C.text, fontSize: 22, fontWeight: '900', letterSpacing: 0 },
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
  mapHint: { position: 'absolute', left: 12, bottom: 10, maxWidth: '62%', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.68)', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6 },
  mapHintText: { flexShrink: 1, color: '#fff', fontSize: 10, fontFamily: mono },
  mapFilterPill: { position: 'absolute', right: 12, top: 12, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.68)', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6 },
  mapFilterPillText: { color: '#fff', fontSize: 10, fontFamily: mono, fontWeight: '800' },
  body: { flex: 1 },
  bodyContent: { padding: 14, paddingBottom: 160, gap: 12 },
  dayTabs: { gap: 8 },
  dayTab: { borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: C.s2 },
  dayTabActive: { borderColor: C.orange, backgroundColor: C.orange + '16' },
  dayTabText: { color: C.text3, fontSize: 10, fontFamily: mono, fontWeight: '800' },
  dayTabTextActive: { color: C.orange },
  dayAdd: { width: 34, height: 34, borderRadius: 10, borderWidth: 1, borderColor: C.orange + '55', alignItems: 'center', justifyContent: 'center' },
  builderHero: { borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 13, backgroundColor: C.s1, gap: 13 },
  builderHeroTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  builderHeroTitle: { color: C.text, fontSize: 21, fontWeight: '900', marginTop: 2 },
  builderHeroText: { color: C.text3, fontSize: 12, lineHeight: 18, marginTop: 4 },
  progressBadge: { width: 62, minHeight: 58, borderRadius: 14, borderWidth: 1, borderColor: C.orange + '55', backgroundColor: C.orange + '12', alignItems: 'center', justifyContent: 'center' },
  progressBadgeNum: { color: C.orange, fontSize: 16, fontFamily: mono, fontWeight: '900' },
  progressBadgeText: { color: C.text3, fontSize: 8, fontFamily: mono, fontWeight: '900', marginTop: 2 },
  modeRow: { flexDirection: 'row', gap: 8 },
  modeCard: { flex: 1, minHeight: 74, flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: 1, borderColor: C.border, borderRadius: 13, backgroundColor: C.s2, padding: 10 },
  modeCardActive: { borderColor: C.orange, backgroundColor: C.orange + '10' },
  radioDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: C.text3, marginTop: 2 },
  radioDotActive: { borderColor: C.orange, backgroundColor: C.orange },
  modeTitle: { color: C.text, fontSize: 12, fontWeight: '900' },
  modeText: { color: C.text3, fontSize: 10, lineHeight: 14, marginTop: 3 },
  wizardCard: { borderWidth: 1, borderColor: C.border, borderRadius: 14, backgroundColor: C.bg, padding: 10, gap: 11 },
  wizardSteps: { flexDirection: 'row', gap: 6 },
  wizardStep: { flex: 1, minHeight: 36, borderWidth: 1, borderColor: C.border, borderRadius: 10, backgroundColor: C.s2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  wizardStepActive: { borderColor: C.orange + '66', backgroundColor: C.orange + '12' },
  wizardStepNum: { color: C.text3, fontSize: 10, fontFamily: mono, fontWeight: '900' },
  wizardStepNumActive: { color: C.orange },
  wizardStepText: { color: C.text3, fontSize: 7, fontFamily: mono, fontWeight: '900', marginTop: 1 },
  wizardStepTextActive: { color: C.orange },
  wizardPane: { gap: 10, minHeight: 142 },
  wizardTitle: { color: C.text, fontSize: 18, fontWeight: '900' },
  wizardHelp: { color: C.text3, fontSize: 12, lineHeight: 17, marginTop: 3 },
  wizardNav: { flexDirection: 'row', gap: 9 },
  wizardNavBtn: { minHeight: 40, minWidth: 88, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderWidth: 1, borderColor: C.border, borderRadius: 11, backgroundColor: C.s2 },
  wizardNavText: { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '900' },
  wizardNextBtn: { flex: 1, minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 11, backgroundColor: C.green },
  wizardNextText: { color: '#fff', fontSize: 10, fontFamily: mono, fontWeight: '900', letterSpacing: 0.6 },
  setupGrid: { gap: 8 },
  setupGridPair: { flexDirection: 'row', gap: 8 },
  setupLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  currentLocationBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1, borderColor: C.orange + '55', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 3, backgroundColor: C.orange + '10' },
  currentLocationText: { color: C.orange, fontSize: 7, fontFamily: mono, fontWeight: '900' },
  preferenceBlock: { gap: 7 },
  prefLabel: { color: C.text3, fontSize: 8, fontFamily: mono, fontWeight: '900', letterSpacing: 0.9 },
  segmentRow: { flexDirection: 'row', gap: 7 },
  segmentBtn: { flex: 1, minHeight: 34, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.s2, alignItems: 'center', justifyContent: 'center' },
  segmentBtnActive: { borderColor: C.green, backgroundColor: C.green },
  segmentText: { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '900' },
  routeStatStrip: { flexDirection: 'row', gap: 8 },
  routeStatItem: { flex: 1, minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderWidth: 1, borderColor: C.border, borderRadius: 11, backgroundColor: C.bg },
  routeStatValue: { color: C.text2, fontSize: 10, fontFamily: mono, fontWeight: '900' },
  primaryBuildBtn: { minHeight: 48, borderRadius: 12, backgroundColor: C.green, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryBuildText: { color: '#fff', fontSize: 11, fontFamily: mono, fontWeight: '900', letterSpacing: 0.8 },
  frameworkCard: { borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 11, backgroundColor: C.s1, gap: 10 },
  frameworkTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  frameworkTitle: { color: C.text, fontSize: 13, fontWeight: '900' },
  frameworkText: { color: C.text3, fontSize: 11, lineHeight: 16, marginTop: 2 },
  frameworkBuildBtn: { minWidth: 76, minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10, backgroundColor: C.green, paddingHorizontal: 10 },
  frameworkBuildText: { color: '#fff', fontSize: 10, fontFamily: mono, fontWeight: '900' },
  frameworkInputs: { flexDirection: 'row', gap: 8 },
  routeStyleRow: { flexDirection: 'row', gap: 7 },
  routeStyleChip: { flex: 1, minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderWidth: 1, borderColor: C.border, borderRadius: 10, backgroundColor: C.s2 },
  routeStyleChipActive: { borderColor: C.orange + '77', backgroundColor: C.orange + '12' },
  routeStyleText: { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '900' },
  tripSetup: { flexDirection: 'row', gap: 8, alignItems: 'stretch' },
  setupToggle: { minWidth: 78, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderWidth: 1, borderColor: C.border, borderRadius: 10, backgroundColor: C.s2, paddingHorizontal: 10, paddingVertical: 8 },
  setupToggleText: { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '900' },
  setupInputWrap: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 10, backgroundColor: C.s2, paddingHorizontal: 9, paddingVertical: 5 },
  setupLabel: { color: C.text3, fontSize: 7, fontFamily: mono, fontWeight: '900', letterSpacing: 0.8 },
  setupInput: { color: C.text, fontSize: 13, fontFamily: mono, fontWeight: '900', paddingVertical: 2 },
  tripStats: { flexDirection: 'row', gap: 8 },
  tripStat: { flex: 1, minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderWidth: 1, borderColor: C.border, borderRadius: 10, backgroundColor: C.s1, paddingHorizontal: 7 },
  tripStatText: { color: C.text2, fontSize: 9, fontFamily: mono, fontWeight: '800' },
  flowCard: { borderWidth: 1, borderColor: C.border, borderRadius: 12, backgroundColor: C.s1, padding: 11, gap: 9 },
  flowStep: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  flowDot: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border, backgroundColor: C.s2 },
  flowTitle: { color: C.text, fontSize: 12, fontWeight: '900' },
  flowText: { color: C.text3, fontSize: 10, lineHeight: 14, marginTop: 1 },
  gasSourceStrip: { flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: C.border, borderRadius: 10, backgroundColor: C.s2, paddingHorizontal: 10, paddingVertical: 8 },
  gasSourceText: { flex: 1, color: C.text3, fontSize: 10, lineHeight: 14, fontFamily: mono, fontWeight: '700' },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  typeChip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: C.border, borderRadius: 9, paddingHorizontal: 9, paddingVertical: 7, backgroundColor: C.s2 },
  typeChipText: { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '800' },
  insertCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 10, backgroundColor: C.s2 },
  insertTitle: { color: C.text, fontSize: 12, fontWeight: '900' },
  insertText: { color: C.text3, fontSize: 10, lineHeight: 15, marginTop: 1 },
  insertClear: { borderWidth: 1, borderColor: C.orange + '55', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: C.s1 },
  insertClearText: { color: C.orange, fontSize: 9, fontFamily: mono, fontWeight: '900' },
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
  routePlanCard: { borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 10, backgroundColor: C.s1, gap: 9 },
  routePlanTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  routePlanMeta: { color: C.text3, fontSize: 10, fontFamily: mono, marginTop: 2 },
  routePlanBadge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  routePlanBadgeWarn: { borderColor: C.yellow + '66', backgroundColor: C.yellow + '12' },
  routePlanBadgeOk: { borderColor: C.green + '66', backgroundColor: C.green + '12' },
  routePlanBadgeText: { fontSize: 8, fontFamily: mono, fontWeight: '900', letterSpacing: 0.6 },
  routeDayMain: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  routeDayNum: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: C.s3 },
  routeDayNumText: { color: '#fff', fontSize: 10, fontFamily: mono, fontWeight: '900' },
  routeDayTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  routeDayTitle: { flex: 1, color: C.text, fontSize: 12, fontWeight: '900' },
  routeDayMeta: { color: C.text3, fontSize: 10, fontFamily: mono, marginTop: 2 },
  routeTimelineCard: { borderWidth: 1, borderColor: C.border, borderRadius: 14, backgroundColor: C.s2, padding: 10, gap: 9 },
  routeTimelineTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 2 },
  routeTimelineTitle: { color: C.text, fontSize: 14, fontWeight: '900' },
  routeTimelineSub: { color: C.text3, fontSize: 11, lineHeight: 15, marginTop: 2 },
  routeTimelineLoop: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 9, backgroundColor: C.s1 },
  routeTimelineLoopText: { color: C.text3, fontSize: 8, fontFamily: mono, fontWeight: '900' },
  routeDayWrap: { gap: 8 },
  routeDayCard: { flexDirection: 'row', gap: 9, borderWidth: 1, borderColor: C.border, borderRadius: 12, backgroundColor: C.s1, padding: 9 },
  routeDayCardActive: { borderColor: C.orange + '66', backgroundColor: C.orange + '0f' },
  routeDayDotCol: { width: 17, alignItems: 'center' },
  routeDayDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: C.orange, backgroundColor: C.s1, marginTop: 4 },
  routeDayStem: { flex: 1, width: 2, backgroundColor: C.border, marginTop: 4 },
  routeDayHeader: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  routeDayMiniBtn: { width: 31, height: 31, borderRadius: 9, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.orange + '35', backgroundColor: C.orange + '10' },
  routeDayEmptyCamp: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: C.orange + '38', borderRadius: 10, backgroundColor: C.orange + '0f', paddingHorizontal: 10 },
  routeDayEmptyCampText: { color: C.orange, fontSize: 10, fontFamily: mono, fontWeight: '900' },
  routeDayActions: { flexDirection: 'row', gap: 7, paddingLeft: 37 },
  routeDayAction: { flex: 1, minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderWidth: 1, borderColor: C.orange + '38', borderRadius: 9, backgroundColor: C.orange + '10' },
  routeDayActionText: { color: C.orange, fontSize: 8, fontFamily: mono, fontWeight: '900' },
  routeDayVisual: { gap: 7, paddingLeft: 37 },
  routeStopPill: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: C.border, borderRadius: 10, backgroundColor: C.s1, paddingHorizontal: 9, paddingVertical: 7 },
  routeStopPillIcon: { width: 28, height: 28, borderRadius: 9, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  routeStopPillTitle: { color: C.text, fontSize: 11, fontWeight: '800' },
  routeStopPillMeta: { color: C.text3, fontSize: 8, fontFamily: mono, marginTop: 1 },
  selectedCampCard: { flexDirection: 'row', alignItems: 'stretch', gap: 9, borderWidth: 1, borderColor: C.green + '55', borderRadius: 12, backgroundColor: C.green + '0f', padding: 8 },
  selectedCampCardCompact: { padding: 6, gap: 7, borderRadius: 10 },
  selectedCampPhotoWrap: { width: 72, borderRadius: 10, overflow: 'hidden', backgroundColor: C.s2 },
  selectedCampPhotoWrapCompact: { width: 54, borderRadius: 8 },
  selectedCampPhoto: { width: '100%', height: 82 },
  selectedCampPhotoCompact: { height: 58 },
  selectedCampPlaceholder: { width: '100%', height: 82, alignItems: 'center', justifyContent: 'center' },
  selectedCampBody: { flex: 1, minHeight: 82, justifyContent: 'center' },
  selectedCampBodyCompact: { minHeight: 58 },
  selectedCampLabel: { color: C.green, fontSize: 8, fontFamily: mono, fontWeight: '900', letterSpacing: 0.6 },
  selectedCampName: { color: C.text, fontSize: 13, fontWeight: '900', lineHeight: 17, marginTop: 2 },
  selectedCampMeta: { color: C.text3, fontSize: 10, marginTop: 3 },
  selectedCampSwap: { width: 30, height: 30, borderRadius: 9, borderWidth: 1, borderColor: C.orange + '55', backgroundColor: C.orange + '10', alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  campPreviewActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 8 },
  campPreviewBtn: { minHeight: 30, flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: C.border, borderRadius: 9, backgroundColor: C.s1, paddingHorizontal: 8 },
  campPreviewBtnText: { color: C.orange, fontSize: 8, fontFamily: mono, fontWeight: '900' },
  inlineResults: { borderWidth: 1, borderColor: C.orange + '44', borderRadius: 12, backgroundColor: C.bg, padding: 9, gap: 8 },
  inlineResultsTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  inlineResultsTitle: { color: C.text, fontSize: 12, fontWeight: '900' },
  inlineResultsSub: { color: C.text3, fontSize: 10, fontFamily: mono, marginTop: 2 },
  inlineClose: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: C.s2, borderWidth: 1, borderColor: C.border },
  inlineLoading: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  inlineLoadingText: { color: C.text3, fontSize: 11, fontFamily: mono },
  inlineCampCard: { flexDirection: 'row', alignItems: 'stretch', gap: 8, padding: 8, borderRadius: 11, borderWidth: 1, borderColor: C.border, backgroundColor: C.s1 },
  inlineCampPhotoWrap: { width: 64, borderRadius: 9, overflow: 'hidden', backgroundColor: C.s2 },
  inlineCampPhoto: { width: '100%', height: 74 },
  inlineCampPlaceholder: { width: '100%', height: 74, alignItems: 'center', justifyContent: 'center' },
  inlineCampBody: { flex: 1, minHeight: 74, justifyContent: 'center' },
  inlineStopRow: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 9, borderWidth: 1, borderColor: C.border, borderRadius: 11, backgroundColor: C.s1 },
  inlineEmpty: { color: C.text3, fontSize: 11, lineHeight: 16, paddingVertical: 8 },
  sectionHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 4 },
  sectionTitle: { color: C.text, fontSize: 11, fontFamily: mono, fontWeight: '900', letterSpacing: 0.8 },
  sectionMeta: { color: C.text3, fontSize: 10, fontFamily: mono, maxWidth: 190 },
  sectionAction: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: C.orange + '55', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: C.orange + '10' },
  sectionActionText: { color: C.orange, fontSize: 9, fontFamily: mono, fontWeight: '900' },
  discoverTabs: { flexDirection: 'row', gap: 8, alignItems: 'stretch' },
  discoverTab: { width: 70, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 9, backgroundColor: C.s2 },
  discoverTabActive: { borderColor: C.orange, backgroundColor: C.orange + '14' },
  discoverTabText: { color: C.text3, fontSize: 10, fontFamily: mono, fontWeight: '800' },
  discoverTabTextActive: { color: C.orange },
  discoverBtn: { flex: 1, minHeight: 40, flexDirection: 'row', gap: 6, borderWidth: 1, borderColor: C.orange + '55', borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.orange + '10', paddingHorizontal: 10 },
  discoverBtnText: { color: C.orange, fontSize: 10, fontFamily: mono, fontWeight: '900' },
  discoverySummary: { flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: C.green + '44', borderRadius: 10, backgroundColor: C.green + '10', paddingHorizontal: 10, paddingVertical: 8 },
  discoverySummaryText: { flex: 1, color: C.green, fontSize: 11, fontFamily: mono, fontWeight: '800' },
  discoverHint: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 9, backgroundColor: C.s2 },
  discoverHintText: { flex: 1, color: C.text3, fontSize: 11, lineHeight: 16 },
  replaceCancel: { alignSelf: 'flex-start', borderWidth: 1, borderColor: C.orange + '55', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5, backgroundColor: C.orange + '10' },
  replaceCancelText: { color: C.orange, fontSize: 8, fontFamily: mono, fontWeight: '900' },
  candidateRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, borderWidth: 1, borderColor: C.border, borderRadius: 12, backgroundColor: C.s1 },
  candidateIcon: { width: 34, height: 34, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  campCandidateCard: { flexDirection: 'row', alignItems: 'stretch', gap: 10, padding: 9, borderWidth: 1, borderColor: C.border, borderRadius: 12, backgroundColor: C.s1 },
  campCandidatePhotoWrap: { width: 76, borderRadius: 9, overflow: 'hidden', backgroundColor: C.s2 },
  campCandidatePhoto: { width: '100%', height: 86 },
  campCandidatePlaceholder: { width: '100%', height: 86, alignItems: 'center', justifyContent: 'center' },
  campCandidateBody: { flex: 1, minHeight: 86, justifyContent: 'center' },
  campCandidateTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 7 },
  miniTag: { borderWidth: 1, borderColor: C.border, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 3, backgroundColor: C.s2 },
  miniTagText: { color: C.text3, fontSize: 7, fontFamily: mono, fontWeight: '900' },
  candidateName: { color: C.text, fontSize: 13, fontWeight: '800' },
  candidateMeta: { color: C.text3, fontSize: 10, marginTop: 2 },
  useBtn: { borderWidth: 1, borderColor: C.green + '66', backgroundColor: C.green + '14', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  useBtnText: { color: C.green, fontSize: 9, fontFamily: mono, fontWeight: '900' },
  emptyState: { borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 14, backgroundColor: C.s2 },
  emptyTitle: { color: C.text, fontSize: 14, fontWeight: '800', marginBottom: 4 },
  emptyText: { color: C.text3, fontSize: 12, lineHeight: 18 },
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 10, backgroundColor: C.s1 },
  stopRowSelected: { borderColor: C.orange, backgroundColor: C.orange + '10' },
  stopNum: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  stopNumText: { color: '#fff', fontSize: 11, fontFamily: mono, fontWeight: '900' },
  stopName: { color: C.text, fontSize: 13, fontWeight: '800' },
  stopMeta: { color: C.text3, fontSize: 10, fontFamily: mono, marginTop: 2 },
  iconBtn: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: C.s2 },
  timelineItem: { gap: 8 },
  legCard: { marginLeft: 14, flexDirection: 'row', alignItems: 'center', gap: 9, borderLeftWidth: 2, borderLeftColor: C.orange + '55', paddingLeft: 14, paddingVertical: 6 },
  legLine: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.orange },
  legMeta: { color: C.text, fontSize: 11, fontFamily: mono, fontWeight: '900' },
  legText: { color: C.text3, fontSize: 10, marginTop: 1 },
  legAction: { minWidth: 48, minHeight: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: C.orange + '12', borderWidth: 1, borderColor: C.orange + '35', paddingHorizontal: 7 },
  legActionText: { color: C.orange, fontSize: 7, fontFamily: mono, fontWeight: '900', marginTop: 1 },
  dayControlRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 9, backgroundColor: C.s2 },
  restToggle: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 10, backgroundColor: C.s1 },
  restToggleText: { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '900' },
  dayHoursBox: { width: 82, borderWidth: 1, borderColor: C.border, borderRadius: 10, backgroundColor: C.s1, paddingHorizontal: 8, paddingVertical: 4 },
  dayControlMeta: { flex: 1, color: C.text3, fontSize: 10, fontFamily: mono, textAlign: 'right' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, paddingBottom: 22, backgroundColor: C.s1, borderTopWidth: 1, borderColor: C.border },
  footerMiles: { color: C.text, fontSize: 18, fontFamily: mono, fontWeight: '900' },
  footerSub: { color: C.text3, fontSize: 10, fontFamily: mono, marginTop: 2 },
  previewBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: C.green, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 12 },
  previewText: { color: '#fff', fontSize: 11, fontFamily: mono, fontWeight: '900', letterSpacing: 0.8 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  filterSheet: {
    maxHeight: '78%',
    backgroundColor: C.s1,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    paddingBottom: 28,
    gap: 12,
  },
  filterSheetTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  filterSheetTitle: { color: C.text, fontSize: 20, fontWeight: '900' },
  filterHintText: { color: C.text3, fontSize: 12, lineHeight: 18 },
  filterToolbar: { flexDirection: 'row', gap: 8 },
  filterSmallBtn: { borderWidth: 1, borderColor: C.border, backgroundColor: C.s2, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  filterSmallText: { color: C.text2, fontSize: 9, fontFamily: mono, fontWeight: '900' },
  filterGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 10 },
  filterChip: { width: '48%', minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.s2, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 9 },
  filterChipText: { color: C.text2, fontSize: 11, fontFamily: mono, fontWeight: '900' },
  filterChipSub: { color: C.text3, fontSize: 9, fontFamily: mono, marginTop: 2 },
  buildSuccessOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.58)', padding: 24 },
  buildSuccessCard: { width: '100%', borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.border, padding: 18, alignItems: 'center', gap: 12 },
  successIconWrap: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: C.orange + '14', borderWidth: 1, borderColor: C.orange + '55' },
  buildSuccessTitle: { color: C.text, fontSize: 22, fontWeight: '900', textAlign: 'center' },
  buildSuccessText: { color: C.text3, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  successChecks: { flexDirection: 'row', gap: 8 },
  successCheck: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: C.green + '44', borderRadius: 999, backgroundColor: C.green + '10', paddingHorizontal: 9, paddingVertical: 6 },
  successCheckText: { color: C.green, fontSize: 9, fontFamily: mono, fontWeight: '900' },
  successPrimaryBtn: { alignSelf: 'stretch', minHeight: 46, borderRadius: 12, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' },
  successPrimaryText: { color: '#fff', fontSize: 11, fontFamily: mono, fontWeight: '900', letterSpacing: 0.8 },
  quickCard: {
    backgroundColor: C.s1,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '86%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 12,
  },
  quickCardImg: { width: '100%' },
  quickCardPhoto: { width: '100%', height: 176, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  quickCardPhotoPlaceholder: {
    width: '100%', height: 142, alignItems: 'center', justifyContent: 'center',
    borderTopLeftRadius: 20, borderTopRightRadius: 20, gap: 5,
  },
  placeholderLand: { fontSize: 9, fontFamily: mono, fontWeight: '800', marginTop: 2 },
  quickCardBody: { padding: 14, paddingBottom: 28, gap: 6 },
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
