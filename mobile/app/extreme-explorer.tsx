import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CopilotPresenceOrb, type CopilotPresenceState } from '@/components/copilot/CopilotPresenceOrb';
import { TripPreviewCaption } from '@/components/copilot/TripPreviewCaption';
import { TripPreviewControls } from '@/components/copilot/TripPreviewControls';
import PremiumPlaceSheet from '@/components/PremiumPlaceSheet';
import { buildMissionCinematic, type MissionCinematic, type MissionScene } from '@/lib/copilotStoryboard';
import { playTrailheadVoice, stopTrailheadVoice } from '@/lib/voice';
import {
  api,
  ExplorerCheckpoint,
  ExplorerConfig,
  ExplorerSurface,
  ExplorePlaceProfile,
  MissionControlBrief,
  MissionControlRecommendation,
  OsmPoi,
  TripMemory,
} from '@/lib/api';
import { useTheme, mono } from '@/lib/design';
import { useStore } from '@/lib/store';
import { loadWelcomeSetupPreferences, type WelcomeSetupPreferences } from '@/lib/welcomeGate';
import { tripPreferenceContextFromWelcomePreferences } from '@/lib/tripPreferences';

type ExplorerWebViewHandle = { injectJavaScript: (js: string) => void };

// Web build: react-native-webview has no web implementation, so render the same
// HTML in an iframe with a postMessage bridge (dev/Playwright verification path).
const ExplorerWebFrame = forwardRef<ExplorerWebViewHandle, any>(function ExplorerWebFrame({ source, onMessage }, ref) {
  const frameRef = useRef<any>(null);
  useImperativeHandle(ref, () => ({
    injectJavaScript: (js: string) => {
      try { frameRef.current?.contentWindow?.eval(js); } catch {}
    },
  }), []);
  useEffect(() => {
    const handler = (event: any) => {
      const payload = event?.data;
      if (payload && payload.__explorer && typeof payload.data === 'string') {
        onMessage?.({ nativeEvent: { data: payload.data } });
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onMessage]);
  return React.createElement('iframe', {
    ref: frameRef,
    srcDoc: source?.html ?? '',
    style: { border: 0, width: '100%', height: '100%', position: 'absolute', inset: 0 },
  });
});

const WebView: any = Platform.OS === 'web' ? ExplorerWebFrame : require('react-native-webview').WebView;

type DemoPlace = {
  id: string;
  type: string;
  title: string;
  note: string;
  lat: number;
  lng: number;
  day?: number;
  source?: string;
  source_label?: string;
  address?: string;
  phone?: string;
  website?: string;
  photo_url?: string | null;
  rating?: number;
  rating_count?: number;
  route_distance_mi?: number;
  confidence?: string;
};

type DemoPayload = {
  token: string;
  styles: ExplorerConfig['style_uris'];
  activeStyle: keyof ExplorerConfig['style_uris'];
  route: [number, number][];
  checkpoints: ExplorerCheckpoint[];
  places: DemoPlace[];
  summary: string;
  tripName: string;
  features: ExplorerConfig['feature_flags'];
  weatherLayers: NonNullable<ExplorerConfig['weather']>['layers'];
  copilotVoice: boolean;
  navigationEnabled: boolean;
  safeTop: number;
  safeBottom: number;
  cinematic: MissionCinematic | null;
  previewMode: 'cinematic' | 'static';
};

type ExplorerPlaceCard = {
  id?: string;
  name: string;
  lat: number;
  lng: number;
  type?: string;
  subtype?: string;
  source?: string;
  source_label?: string;
  address?: string;
  phone?: string;
  website?: string;
  photo_url?: string | null;
  rating?: number;
  rating_count?: number;
  summary?: string;
  access_note?: string;
  route_distance_mi?: number;
  confidence?: string;
};

const STYLE_ORDER: Array<keyof ExplorerConfig['style_uris']> = [
  'standard',
  'live_road',
  'satellite_trail',
  '3d_terrain',
  'night_drive',
  'weather_watch',
  'outdoors',
];

const STYLE_TITLES: Record<keyof ExplorerConfig['style_uris'], string> = {
  standard: 'Standard',
  live_road: 'Live Road',
  satellite_trail: 'Satellite Trail',
  '3d_terrain': '3D Terrain',
  night_drive: 'Night Drive',
  weather_watch: 'Weather Watch',
  outdoors: 'Outdoors',
};

function finiteCoord(lat?: number, lng?: number) {
  return Number.isFinite(lat) && Number.isFinite(lng);
}

function safeText(value: unknown, fallback = '') {
  return String(value ?? fallback).replace(/\s+/g, ' ').trim();
}

function escapeHtmlJson(data: unknown) {
  return JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function routeFromTrip(trip: ReturnType<typeof useStore.getState>['activeTrip']): [number, number][] {
  const saved = trip?.route_geometry?.coords ?? [];
  if (saved.length > 1) {
    return saved
      .filter(coord => Array.isArray(coord) && Number.isFinite(coord[0]) && Number.isFinite(coord[1]))
      .map(coord => [Number(coord[0]), Number(coord[1])] as [number, number]);
  }
  return (trip?.plan.waypoints ?? [])
    .filter(wp => finiteCoord(wp.lat, wp.lng))
    .map(wp => [Number(wp.lng), Number(wp.lat)] as [number, number]);
}

function checkpointType(type: string) {
  const clean = String(type || '').toLowerCase();
  if (clean.includes('fuel')) return 'fuel';
  if (clean.includes('camp')) return 'camp';
  if (clean.includes('stay')) return 'stay';
  if (clean.includes('start')) return 'start';
  if (clean.includes('finish')) return 'finish';
  return 'checkpoint';
}

function checkpointsFromTrip(trip: ReturnType<typeof useStore.getState>['activeTrip']): ExplorerCheckpoint[] {
  return (trip?.plan.waypoints ?? [])
    .filter(wp => finiteCoord(wp.lat, wp.lng))
    .map((wp, index) => ({
      id: `wp-${index}-${safeText(wp.name, 'stop').slice(0, 24)}`,
      type: checkpointType(wp.type),
      title: safeText(wp.name, `Stop ${index + 1}`),
      note: safeText(wp.description || wp.land_type || wp.notes, ''),
      lat: Number(wp.lat),
      lng: Number(wp.lng),
      day: Number(wp.day || 1),
      sequence: index + 1,
      status: wp.needs_review ? 'review' : 'planned',
      source: 'trailhead',
      source_id: String((wp as any).id ?? ''),
      confidence: wp.verified_match ? 'high' : 'estimated',
      expires_at: null,
    }));
}

function placeFromPoi(p: OsmPoi, idx: number): DemoPlace | null {
  if (!finiteCoord(p.lat, p.lng)) return null;
  return {
    id: String((p as any).id ?? (p as any).place_id ?? `poi-${idx}`),
    type: safeText(p.type || p.subtype || 'place', 'place'),
    title: safeText(p.name || p.type, 'Place'),
    note: safeText((p as any).summary || (p as any).address || (p as any).source_badge || p.source, ''),
    lat: Number(p.lat),
    lng: Number(p.lng),
    day: Number((p as any).recommended_day || 0) || undefined,
    source: p.source,
    source_label: p.source_label || p.source_badge,
    address: p.address,
    phone: p.phone,
    website: p.website || p.official_url,
    photo_url: p.photo_url,
    rating: p.rating,
    rating_count: p.rating_count,
    route_distance_mi: p.route_distance_mi,
    confidence: (p as any).confidence,
  };
}

function placeFromExploreProfile(place: ExplorePlaceProfile, idx: number): DemoPlace | null {
  const summary = place.summary || ({} as ExplorePlaceProfile['summary']);
  const lat = Number(summary.lat);
  const lng = Number(summary.lng);
  if (!finiteCoord(lat, lng)) return null;
  const routeSummary = summary as typeof summary & {
    route_distance_mi?: number;
    route_fit?: string;
  };
  const media = Array.isArray(place.media) ? place.media.find(item => item?.url) : null;
  const sources = Array.isArray(place.sources) ? place.sources : [];
  const sourceLabel = safeText(
    place.source_pack?.primary
      || summary.source_title
      || sources.find(item => item.publisher || item.name || item.title)?.publisher
      || sources.find(item => item.publisher || item.name || item.title)?.name
      || 'Explore',
    'Explore',
  );
  const note = safeText(
    place.card?.summary
      || place.profile?.summary
      || summary.short_description
      || summary.hook
      || routeSummary.route_fit,
    'Explore stop',
  );
  return {
    id: String(place.id || summary.id || `explore-${idx}`),
    type: safeText(place.category || summary.explore_group || summary.category || 'place', 'place'),
    title: safeText(summary.title || place.card?.title, 'Explore stop'),
    note: routeSummary.route_fit ? `${routeSummary.route_fit}. ${note}` : note,
    lat,
    lng,
    source: 'explore',
    source_label: sourceLabel,
    website: place.source_pack?.official_url || summary.source_url || place.facts?.official_url || place.facts?.source_url,
    photo_url: summary.image_url || summary.thumbnail_url || media?.url || place.source_pack?.photos?.find(item => item?.url)?.url || null,
    route_distance_mi: typeof routeSummary.route_distance_mi === 'number' ? routeSummary.route_distance_mi : undefined,
    confidence: place.verified || place.quality === 'official' ? 'high' : 'medium',
  };
}

function placesFromTrip(trip: ReturnType<typeof useStore.getState>['activeTrip']): DemoPlace[] {
  const places: DemoPlace[] = [];
  for (const [idx, gas] of (trip?.gas_stations ?? []).entries()) {
    if (!finiteCoord(gas.lat, gas.lng)) continue;
    places.push({
      id: `fuel-${gas.id ?? idx}`,
      type: 'fuel',
      title: safeText(gas.name, 'Fuel'),
      note: safeText(gas.address || gas.route_fit || gas.fuel_types, 'Fuel stop'),
      lat: Number(gas.lat),
      lng: Number(gas.lng),
      day: Number((gas as any).recommended_day || 0) || undefined,
    });
  }
  for (const [idx, camp] of (trip?.campsites ?? []).entries()) {
    if (!finiteCoord(camp.lat, camp.lng)) continue;
    places.push({
      id: `stay-${camp.id ?? idx}`,
      type: String(camp.verified_source || '').toLowerCase().includes('private') ? 'private_stay' : 'camp',
      title: safeText(camp.name, 'Stay'),
      note: safeText(camp.description || camp.route_fit || camp.verified_source, 'Overnight option'),
      lat: Number(camp.lat),
      lng: Number(camp.lng),
      day: Number((camp as any).recommended_day || 0) || undefined,
    });
  }
  for (const [idx, poi] of (trip?.route_pois ?? []).entries()) {
    const place = placeFromPoi(poi, idx);
    if (place) places.push(place);
  }
  for (const [idx, day] of (trip?.timeline?.days ?? []).entries()) {
    if (!day.warning_level || day.warning_level === 'info') continue;
    const point = day.events.find(event => event.point?.lat && event.point?.lng)?.point;
    if (!point) continue;
    places.push({
      id: `weather-${day.day}-${idx}`,
      type: 'weather_risk',
      title: `Day ${day.day} review`,
      note: safeText(day.summary || 'Check route conditions before leaving signal.', ''),
      lat: point.lat,
      lng: point.lng,
      day: day.day,
    });
  }
  return places.slice(0, 48);
}

function routeAnchor(route: [number, number][], checkpoints: ExplorerCheckpoint[]) {
  const source = route.length ? route : checkpoints.map(cp => [cp.lng, cp.lat] as [number, number]);
  if (!source.length) return { lat: 38.5733, lng: -109.5498 };
  const mid = source[Math.floor(source.length / 2)];
  return { lat: Number(mid[1]), lng: Number(mid[0]) };
}

function fallbackPlaces(route: [number, number][], checkpoints: ExplorerCheckpoint[]): DemoPlace[] {
  const source = route.length > 1 ? route : checkpoints.map(cp => [cp.lng, cp.lat] as [number, number]);
  if (!source.length) return [];
  const pick = (ratio: number) => source[Math.max(0, Math.min(source.length - 1, Math.floor((source.length - 1) * ratio)))];
  const defs = [
    { id: 'extreme-fuel-check', type: 'fuel', title: 'Fuel before remote stretch', note: 'Check your range before the next low-service section.', ratio: 0.28 },
    { id: 'extreme-stay-check', type: 'private_stay', title: 'Stay options near tonight', note: 'Review camps and private stays that fit the current day window.', ratio: 0.62 },
    { id: 'extreme-repair-check', type: 'repair', title: 'Repair and parts check', note: 'Useful stop to keep in the plan before leaving larger towns.', ratio: 0.42 },
    { id: 'extreme-weather-check', type: 'weather_risk', title: 'Weather watch point', note: 'Check wind, heat, and precipitation timing before this segment.', ratio: 0.78 },
    { id: 'extreme-viewpoint-check', type: 'viewpoint', title: 'Scenic pullout candidate', note: 'Optional stop if daylight and route timing still work.', ratio: 0.5 },
  ];
  return defs.map((def, idx) => {
    const [lng, lat] = pick(def.ratio);
    const offset = (idx - 2) * 0.018;
    return {
      id: def.id,
      type: def.type,
      title: def.title,
      note: def.note,
      lat: Number(lat) + offset,
      lng: Number(lng) - offset,
      source: 'trailhead',
      source_label: 'Trailhead preview',
      confidence: 'estimated',
    };
  }).filter(p => finiteCoord(p.lat, p.lng));
}

function mergePlaces(places: DemoPlace[]) {
  const seen = new Set<string>();
  const out: DemoPlace[] = [];
  for (const place of places) {
    if (!finiteCoord(place.lat, place.lng)) continue;
    const key = `${place.id || place.title}:${place.lat.toFixed(4)}:${place.lng.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(place);
  }
  return out.slice(0, 64);
}

function placeCardFromDemo(place: DemoPlace): ExplorerPlaceCard {
  return {
    id: place.id,
    name: place.title || 'Place',
    lat: place.lat,
    lng: place.lng,
    type: place.type,
    source: place.source || 'extreme',
    source_label: place.source_label || 'Explore pick',
    address: place.address,
    phone: place.phone,
    website: place.website,
    photo_url: place.photo_url,
    rating: place.rating,
    rating_count: place.rating_count,
    summary: place.note,
    access_note: place.day ? `Suggested for day ${place.day}` : undefined,
    route_distance_mi: place.route_distance_mi,
    confidence: place.confidence,
  };
}

function tripMemoryFromState(rigProfile: ReturnType<typeof useStore.getState>['rigProfile']): TripMemory {
  const rangeMiles = Number((rigProfile as any)?.fuel_range_miles || 0);
  return {
    vehicle: rigProfile ? {
      type: rigProfile.vehicle_type,
      make: rigProfile.make,
      model: rigProfile.model,
      year: rigProfile.year,
    } : undefined,
    range: rangeMiles ? { miles: rangeMiles } : undefined,
    clearance: rigProfile?.ground_clearance_in ? { inches: rigProfile.ground_clearance_in } : undefined,
    trailer: rigProfile?.is_towing ? { length_ft: rigProfile.trailer_length_ft } : undefined,
    comfort_level: 'remote-ready',
    preferred_stays: ['public land', 'quiet stays'],
    avoid_rules: ['uncertain access', 'long fuel gaps'],
    public_private_preference: 'public first',
    offline_readiness: {},
    risk_notes: [],
    recent_user_edits: [],
  };
}

function coPilotSummary(places: DemoPlace[]) {
  const fuel = places.filter(p => p.type.includes('fuel')).length;
  const stays = places.filter(p => p.type.includes('camp') || p.type.includes('stay')).length;
  const risks = places.filter(p => p.type.includes('weather') || p.type.includes('risk')).length;
  const parts: string[] = [];
  if (fuel > 0) parts.push(`${fuel} fuel ${fuel === 1 ? 'stop' : 'stops'}`);
  if (stays > 0) parts.push(`${stays} stay ${stays === 1 ? 'option' : 'options'}`);
  if (parts.length) return `I found ${parts.join(' and ')} near the route.`;
  if (risks) return 'I marked route checks to review before leaving signal.';
  return 'I added checkpoints and nearby options along the route.';
}

function routeForRisk(route: [number, number][]) {
  return route
    .filter(coord => Number.isFinite(coord[0]) && Number.isFinite(coord[1]))
    .slice(0, 80)
    .map(([lng, lat]) => ({ lat, lng }));
}

function makeHtml(payload: DemoPayload) {
  const data = escapeHtmlJson(payload);
  const stylebarTop = Math.max(16, Math.round(payload.safeTop + 58));
  const trayBottom = Math.max(14, Math.round(payload.safeBottom + 14));
  const mapTopPadding = Math.max(120, Math.round(payload.safeTop + 128));
  const mapBottomPadding = Math.max(230, Math.round(payload.safeBottom + 240));
  return `<!doctype html>
<html>
<head>
  <meta name="viewport" content="initial-scale=1,maximum-scale=1,user-scalable=no,width=device-width">
  <link href="https://api.mapbox.com/mapbox-gl-js/v3.11.1/mapbox-gl.css" rel="stylesheet">
  <script src="https://api.mapbox.com/mapbox-gl-js/v3.11.1/mapbox-gl.js"></script>
  <style>
    html, body, #map { height: 100%; margin: 0; background: #070a0d; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .loading { position: absolute; inset: 0; display: grid; place-items: center; background: radial-gradient(circle at 50% 35%, rgba(249,115,22,.18), transparent 32%), #070a0d; color: #f8fafc; z-index: 4; transition: opacity .55s ease; }
    .loading.hide { opacity: 0; pointer-events: none; }
    .load-card { width: 220px; text-align: center; }
    .pulse { width: 52px; height: 52px; border-radius: 18px; margin: 0 auto 18px; border: 1px solid rgba(249,115,22,.7); box-shadow: 0 0 38px rgba(249,115,22,.32); animation: pulse 1.1s infinite alternate; }
    @keyframes pulse { from { transform: scale(.92); opacity: .65; } to { transform: scale(1.04); opacity: 1; } }
    .load-title { font-weight: 900; letter-spacing: .12em; font-size: 12px; }
    .load-sub { color: #94a3b8; font-size: 12px; margin-top: 8px; line-height: 1.35; }
    .marker { width: 30px; height: 30px; border-radius: 15px; display: grid; place-items: center; color: #fff; font-size: 11px; font-weight: 900; border: 2px solid rgba(255,255,255,.88); box-shadow: 0 8px 24px rgba(0,0,0,.36); transform: scale(.2); opacity: 0; transition: transform .42s cubic-bezier(.2,1.3,.25,1), opacity .28s ease; cursor: pointer; }
    .marker.show { transform: scale(1); opacity: 1; }
    .place { background: #0ea5e9; }
    .fuel { background: #f97316; }
    .camp, .stay, .private_stay { background: #16a34a; }
    .food { background: #06b6d4; }
    .repair { background: #eab308; }
    .viewpoint { background: #8b5cf6; }
    .weather_risk { background: #ef4444; }
    .checkpoint { width: 34px; height: 34px; border-radius: 12px; background: #111827; color: #f8fafc; border-color: #f97316; }
    .trail_stop { background: #22d3ee; }
    .monument_stop { background: #8b5cf6; }
    .callout-warning { animation: warnpulse 1s infinite alternate; }
    @keyframes warnpulse { from { box-shadow: 0 0 0 0 rgba(239,68,68,.55); } to { box-shadow: 0 0 0 14px rgba(239,68,68,0); } }
    .popup { max-width: 220px; font: 12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    .popup b { display:block; margin-bottom: 3px; }
    .stylebar { position: absolute; top: ${stylebarTop}px; left: 12px; right: 12px; display: flex; gap: 8px; overflow-x: auto; z-index: 3; padding-bottom: 4px; }
    .stylebar button { white-space: nowrap; border: 1px solid rgba(255,255,255,.18); background: rgba(8,12,18,.78); color: #dbe4ef; border-radius: 999px; padding: 9px 12px; font-size: 11px; font-weight: 800; backdrop-filter: blur(14px); }
    .stylebar button.active { background: #f97316; border-color: #fb923c; color: white; }
    .tray { position: absolute; left: 12px; right: 12px; bottom: ${trayBottom}px; z-index: 3; background: rgba(8,12,18,.86); border: 1px solid rgba(255,255,255,.16); border-radius: 22px; padding: 14px; color: #f8fafc; backdrop-filter: blur(18px); box-shadow: 0 -16px 46px rgba(0,0,0,.32); }
    .tray-top { display:flex; gap:10px; align-items:center; margin-bottom:8px; }
    .orb { width: 30px; height: 30px; border-radius: 12px; background: #f97316; box-shadow: 0 0 26px rgba(249,115,22,.34); }
    .tray-title { font-size: 11px; font-weight: 900; letter-spacing: .14em; color: #fb923c; }
    .tray-text { font-size: 14px; line-height: 1.35; font-weight: 750; }
    .chips { display:flex; gap:8px; overflow-x:auto; padding-top: 10px; }
    .chips button { white-space: nowrap; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.07); color: #f8fafc; border-radius: 999px; padding: 8px 10px; font-size: 11px; font-weight: 800; }
    .chips button.primary { background: #f97316; border-color: #fb923c; }
    .mode-badges { display:flex; gap:6px; overflow-x:auto; padding-top: 9px; }
    .mode-badges span { white-space:nowrap; border:1px solid rgba(255,255,255,.12); color:#cbd5e1; border-radius:999px; padding:5px 8px; font-size:9px; font-weight:900; letter-spacing:.08em; }
    .mapboxgl-ctrl-top-right { top: ${stylebarTop + 52}px; }
  </style>
</head>
<body>
  <div id="map"></div>
  <div id="loading" class="loading"><div class="load-card"><div class="pulse"></div><div class="load-title">EXPLORER</div><div class="load-sub">Loading route preview</div></div></div>
  <div class="stylebar" id="stylebar"></div>
  <script>
    if (!window.ReactNativeWebView && window.parent !== window) {
      window.ReactNativeWebView = { postMessage: msg => window.parent.postMessage({ __explorer: true, data: msg }, '*') };
    }
    const demo = ${data};
    mapboxgl.accessToken = demo.token || '';
    const fallbackCenter = demo.route[0] || [-109.55, 38.57];
    let markers = [];
    const map = new mapboxgl.Map({
      container: 'map',
      style: demo.styles[demo.activeStyle] || demo.styles.standard,
      center: fallbackCenter,
      zoom: demo.route.length > 1 ? 8 : 5,
      pitch: demo.activeStyle === '3d_terrain' ? 62 : 45,
      bearing: demo.route.length > 1 ? -18 : 0,
      attributionControl: false
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: true, visualizePitch: true }), 'right');

    const stylebar = document.getElementById('stylebar');
    const styleTitles = ${escapeHtmlJson(STYLE_TITLES)};
    Object.keys(demo.styles).forEach(key => {
      const btn = document.createElement('button');
      btn.textContent = styleTitles[key] || key;
      btn.className = key === demo.activeStyle ? 'active' : '';
      btn.onclick = () => {
        demo.activeStyle = key;
        Array.from(stylebar.children).forEach(child => child.classList.remove('active'));
        btn.classList.add('active');
        map.setStyle(demo.styles[key] || demo.styles.standard);
        map.once('style.load', () => {
          if (cine.playing && !cine.failed) { restoreAfterStyleSwitch(); } else { renderRoute(); }
        });
        window.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'style', key }));
      };
      stylebar.appendChild(btn);
    });

    function boundsFor(coords) {
      const b = new mapboxgl.LngLatBounds();
      coords.forEach(c => b.extend(c));
      demo.checkpoints.forEach(p => b.extend([p.lng, p.lat]));
      demo.places.forEach(p => b.extend([p.lng, p.lat]));
      return b;
    }
    function labelFor(type, seq) {
      if (type.includes('fuel')) return 'F';
      if (type.includes('camp') || type.includes('stay')) return 'S';
      if (type.includes('food')) return 'D';
      if (type.includes('repair')) return 'R';
      if (type.includes('view')) return 'V';
      if (type.includes('weather')) return '!';
      return String(seq || '•');
    }
    function markerClass(type) {
      const t = String(type || 'place');
      if (t.includes('fuel')) return 'fuel';
      if (t.includes('camp')) return 'camp';
      if (t.includes('stay')) return 'stay';
      if (t.includes('food')) return 'food';
      if (t.includes('repair')) return 'repair';
      if (t.includes('view')) return 'viewpoint';
      if (t.includes('weather') || t.includes('risk')) return 'weather_risk';
      return 'place';
    }
    function clearMarkers() {
      markers.forEach(marker => marker.remove());
      markers = [];
    }
    function selectPlace(point, source) {
      window.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'place', source, place: point }));
    }
    function addMarker(point, idx, checkpoint) {
      const el = document.createElement('div');
      el.className = checkpoint ? 'marker checkpoint' : 'marker ' + markerClass(point.type);
      el.textContent = checkpoint ? String(point.sequence || idx + 1) : labelFor(point.type, point.day);
      const popup = new mapboxgl.Popup({ offset: 18, closeButton: false, className: 'popup' })
        .setHTML('<b>' + String(point.title || 'Stop').replace(/[<>&]/g, '') + '</b>' + String(point.note || '').replace(/[<>&]/g, ''));
      el.addEventListener('click', event => {
        event.stopPropagation();
        selectPlace(point, checkpoint ? 'checkpoint' : 'place');
      });
      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([point.lng, point.lat])
        .setPopup(popup)
        .addTo(map);
      markers.push(marker);
      setTimeout(() => el.classList.add('show'), 520 + idx * 80);
    }
    function renderRoute() {
      if (!map.isStyleLoaded()) return;
      clearMarkers();
      if (demo.activeStyle === '3d_terrain') {
        if (!map.getSource('mapbox-dem')) {
          map.addSource('mapbox-dem', { type: 'raster-dem', url: 'mapbox://mapbox.mapbox-terrain-dem-v1', tileSize: 512, maxzoom: 14 });
        }
        map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.25 });
      }
      if (demo.route.length > 1) {
        if (!map.getSource('route-full')) {
          map.addSource('route-full', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: demo.route } } });
          map.addLayer({ id: 'route-casing', type: 'line', source: 'route-full', paint: { 'line-color': '#0f172a', 'line-width': 9, 'line-opacity': .72 } });
        }
        if (!map.getSource('route-anim')) {
          map.addSource('route-anim', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } } });
          map.addLayer({ id: 'route-anim-line', type: 'line', source: 'route-anim', paint: { 'line-color': '#00a7ff', 'line-width': 5, 'line-opacity': .96 } });
        }
        const b = boundsFor(demo.route);
        if (!b.isEmpty()) map.fitBounds(b, { padding: { top: ${mapTopPadding}, bottom: ${mapBottomPadding}, left: 40, right: 40 }, duration: 950, maxZoom: 12 });
        const start = performance.now();
        const duration = 1700;
        function tick(now) {
          const t = Math.min(1, (now - start) / duration);
          const count = Math.max(2, Math.ceil(t * demo.route.length));
          map.getSource('route-anim')?.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: demo.route.slice(0, count) } });
          if (t < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      }
      demo.places.forEach((p, i) => addMarker(p, i, false));
      demo.checkpoints.forEach((p, i) => addMarker(p, i, true));
      setTimeout(() => {
        document.getElementById('loading')?.classList.add('hide');
        window.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'ready' }));
      }, 900);
    }
    // ---- Cinematic storyboard player ----
    const cine = {
      scenes: (demo.previewMode === 'cinematic' && demo.cinematic && Array.isArray(demo.cinematic.scenes)) ? demo.cinematic.scenes : [],
      index: -1,
      playing: false,
      paused: false,
      failed: false,
      raf: null,
      sceneStart: 0,
      pausedAt: 0,
      pausedTotal: 0,
      markers: []
    };
    function post(type, extra) {
      const msg = extra || {};
      msg.type = type;
      window.ReactNativeWebView?.postMessage(JSON.stringify(msg));
    }
    function cineStopAnim() {
      if (cine.raf) { cancelAnimationFrame(cine.raf); cine.raf = null; }
      try { map.stop(); } catch (err) {}
    }
    function cineClearMarkers() {
      cine.markers.forEach(marker => marker.remove());
      cine.markers = [];
    }
    function cineFail(err) {
      if (cine.failed) return;
      cine.failed = true;
      cine.playing = false;
      cineStopAnim();
      cineClearMarkers();
      post('cinematic_error', { message: String((err && err.message) || err || 'cinematic playback failed') });
      try { renderRoute(); } catch (fallbackErr) {}
    }
    function sliceCoords(slice) {
      const coords = demo.route || [];
      if (coords.length < 2) return coords;
      const s = Math.max(0, Math.min(1, (slice && slice[0]) || 0));
      const rawEnd = slice && slice[1] != null ? slice[1] : 1;
      const e = Math.max(s, Math.min(1, rawEnd));
      const si = Math.floor(s * (coords.length - 1));
      const ei = Math.max(si + 1, Math.ceil(e * (coords.length - 1)));
      return coords.slice(si, ei + 1);
    }
    function ensureRouteLayers() {
      if (demo.route.length < 2) return;
      if (!map.getSource('route-full')) {
        map.addSource('route-full', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: demo.route } } });
        map.addLayer({ id: 'route-casing', type: 'line', source: 'route-full', paint: { 'line-color': '#0f172a', 'line-width': 9, 'line-opacity': .72 } });
      }
      if (!map.getSource('route-anim')) {
        map.addSource('route-anim', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } } });
        map.addLayer({ id: 'route-anim-line', type: 'line', source: 'route-anim', paint: { 'line-color': '#00a7ff', 'line-width': 5, 'line-opacity': .96 } });
      }
    }
    function setProgressLine(ratio) {
      if (demo.route.length < 2) return;
      const clamped = Math.max(0, Math.min(1, ratio));
      const count = Math.max(2, Math.ceil(clamped * demo.route.length));
      map.getSource('route-anim')?.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: demo.route.slice(0, count) } });
    }
    function ensureTerrain(scene) {
      const wants = (scene.layers && scene.layers.terrain) || demo.activeStyle === '3d_terrain';
      if (!wants) return;
      try {
        if (!map.getSource('mapbox-dem')) {
          map.addSource('mapbox-dem', { type: 'raster-dem', url: 'mapbox://mapbox.mapbox-terrain-dem-v1', tileSize: 512, maxzoom: 14 });
        }
        map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.25 });
      } catch (err) {}
    }
    function cineMarkerClass(kind) {
      const k = String(kind || '');
      if (k === 'checkpoint') return 'checkpoint';
      if (k === 'fuel') return 'fuel';
      if (k === 'camp') return 'camp';
      if (k === 'trail') return 'trail_stop';
      if (k === 'monument') return 'monument_stop';
      if (k === 'risk') return 'weather_risk';
      return 'place';
    }
    function cineLabel(kind, idx) {
      const k = String(kind || '');
      if (k === 'checkpoint') return String(idx + 1);
      if (k === 'fuel') return 'F';
      if (k === 'camp') return 'S';
      if (k === 'trail') return 'T';
      if (k === 'monument') return 'M';
      if (k === 'risk') return '!';
      return '•';
    }
    function showCallouts(scene) {
      cineClearMarkers();
      (scene.callouts || []).forEach((callout, i) => {
        if (!isFinite(callout.lat) || !isFinite(callout.lng)) return;
        const el = document.createElement('div');
        let cls = 'marker ' + cineMarkerClass(callout.kind);
        if (scene.layers && scene.layers.warning) cls += ' callout-warning';
        el.className = cls;
        el.textContent = cineLabel(callout.kind, i);
        const popup = new mapboxgl.Popup({ offset: 18, closeButton: false, className: 'popup' })
          .setHTML('<b>' + String(callout.title || 'Stop').replace(/[<>&]/g, '') + '</b>' + String(callout.note || '').replace(/[<>&]/g, ''));
        el.addEventListener('click', event => {
          event.stopPropagation();
          selectPlace({ id: callout.id, type: callout.kind, title: callout.title, note: callout.note, lat: callout.lat, lng: callout.lng }, 'place');
        });
        const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([callout.lng, callout.lat])
          .setPopup(popup)
          .addTo(map);
        cine.markers.push(marker);
        setTimeout(() => el.classList.add('show'), 260 + i * 120);
      });
    }
    function cineElapsed(now) {
      return now - cine.sceneStart - cine.pausedTotal;
    }
    function cineApplyCamera(scene) {
      const cam = scene.camera || { mode: 'fit' };
      const pitch = Math.max(0, Math.min(70, cam.pitch != null ? cam.pitch : 45));
      if (cam.mode === 'fit' || !scene.focus) {
        const coords = sliceCoords(scene.routeSlice || [0, 1]);
        if (coords.length > 1) {
          const b = new mapboxgl.LngLatBounds();
          coords.forEach(c => b.extend(c));
          if (scene.type === 'intro' || scene.type === 'whole_route' || scene.type === 'mission_recap') {
            demo.checkpoints.forEach(p => b.extend([p.lng, p.lat]));
          }
          if (!b.isEmpty()) {
            map.fitBounds(b, { padding: { top: ${mapTopPadding}, bottom: ${mapBottomPadding}, left: 48, right: 48 }, duration: 1500, pitch, maxZoom: 12 });
          }
        } else if (scene.focus) {
          map.flyTo({ center: [scene.focus.lng, scene.focus.lat], zoom: Math.min(cam.zoom || 10, 13.5), pitch, duration: 1900, essential: true });
        }
        return;
      }
      if (cam.mode === 'follow') {
        const coords = sliceCoords(scene.routeSlice || [0, 1]);
        const start = coords[0] || [scene.focus.lng, scene.focus.lat];
        map.easeTo({ center: start, zoom: Math.min(cam.zoom || 9.5, 12), pitch, duration: 1200, essential: true });
        return;
      }
      map.flyTo({
        center: [scene.focus.lng, scene.focus.lat],
        zoom: Math.min(cam.zoom || 11.5, 13.5),
        pitch,
        bearing: cam.bearing != null ? cam.bearing : map.getBearing(),
        duration: 2100,
        essential: true
      });
    }
    function cineRunLoop(scene) {
      const duration = Math.max(2400, Number(scene.durationMs) || 5000);
      const cam = scene.camera || {};
      const slice = scene.routeSlice;
      const coords = slice ? sliceCoords(slice) : null;
      let orbitBase = null;
      function frame(now) {
        if (cine.failed || cine.paused) { cine.raf = null; return; }
        const elapsed = cineElapsed(now);
        const t = Math.max(0, Math.min(1, elapsed / duration));
        try {
          if (scene.type === 'whole_route') {
            setProgressLine(t);
          } else if (scene.type === 'mission_recap') {
            setProgressLine(1);
          } else if (cam.mode === 'follow' && coords && coords.length > 1 && slice) {
            setProgressLine(slice[0] + (slice[1] - slice[0]) * t);
            if (elapsed > 1300) {
              const fpos = t * (coords.length - 1);
              const fi = Math.floor(fpos);
              const frac = fpos - fi;
              const c0 = coords[Math.min(fi, coords.length - 1)];
              const c1 = coords[Math.min(fi + 1, coords.length - 1)];
              map.jumpTo({ center: [c0[0] + (c1[0] - c0[0]) * frac, c0[1] + (c1[1] - c0[1]) * frac] });
            }
          } else if (cam.mode === 'orbit' && elapsed > 2200) {
            if (orbitBase === null) orbitBase = map.getBearing();
            const ot = Math.max(0, Math.min(1, (elapsed - 2200) / Math.max(1, duration - 2200)));
            map.setBearing(orbitBase + 70 * ot);
          }
        } catch (err) { cineFail(err); return; }
        if (t >= 1) { cineFinishScene(); return; }
        cine.raf = requestAnimationFrame(frame);
      }
      cine.raf = requestAnimationFrame(frame);
    }
    function cineStartScene(i) {
      if (cine.failed) return;
      if (i >= cine.scenes.length) { cineComplete(); return; }
      const scene = cine.scenes[i];
      cine.index = i;
      cine.sceneStart = performance.now();
      cine.pausedTotal = 0;
      cine.paused = false;
      post('cinematic_scene_started', { sceneId: scene.id, sceneType: scene.type, index: i });
      try {
        ensureRouteLayers();
        ensureTerrain(scene);
        showCallouts(scene);
        cineApplyCamera(scene);
      } catch (err) { cineFail(err); return; }
      cineRunLoop(scene);
    }
    function cineFinishScene() {
      cineStopAnim();
      const scene = cine.scenes[cine.index];
      post('cinematic_scene_finished', { sceneId: scene && scene.id, index: cine.index });
      cineStartScene(cine.index + 1);
    }
    function cineComplete() {
      cine.playing = false;
      cine.paused = false;
      cineStopAnim();
      cineClearMarkers();
      setProgressLine(1);
      demo.places.forEach((p, i) => addMarker(p, i, false));
      demo.checkpoints.forEach((p, i) => addMarker(p, i, true));
      post('cinematic_complete', { scenes: cine.scenes.length });
    }
    window.__cinematic = {
      replay() {
        if (!cine.scenes.length) return;
        cine.failed = false;
        cine.playing = true;
        cine.paused = false;
        cineStopAnim();
        clearMarkers();
        cineClearMarkers();
        setProgressLine(0.001);
        post('cinematic_started', {});
        cineStartScene(0);
      },
      pause() {
        if (!cine.playing || cine.paused) return;
        cine.paused = true;
        cine.pausedAt = performance.now();
        cineStopAnim();
        post('cinematic_paused', { index: cine.index });
      },
      resume() {
        if (!cine.playing || !cine.paused) return;
        cine.pausedTotal += performance.now() - cine.pausedAt;
        cine.paused = false;
        post('cinematic_resumed', { index: cine.index });
        const scene = cine.scenes[cine.index];
        if (scene) cineRunLoop(scene);
      },
      skip() {
        if (!cine.playing || cine.failed) return;
        if (cine.paused) {
          cine.pausedTotal += performance.now() - cine.pausedAt;
          cine.paused = false;
        }
        cineFinishScene();
      }
    };
    function startCinematic() {
      try {
        ensureRouteLayers();
        setProgressLine(0.001);
        document.getElementById('loading')?.classList.add('hide');
        post('ready', {});
        post('cinematic_ready', { scenes: cine.scenes.length });
        cine.playing = true;
        post('cinematic_started', {});
        cineStartScene(0);
      } catch (err) { cineFail(err); }
    }
    function restoreAfterStyleSwitch() {
      try {
        ensureRouteLayers();
        const scene = cine.scenes[cine.index];
        if (scene) {
          ensureTerrain(scene);
          if (scene.routeSlice) setProgressLine(scene.routeSlice[1]);
        } else {
          setProgressLine(1);
        }
      } catch (err) { cineFail(err); }
    }
    map.on('load', () => {
      if (!cine.failed && cine.scenes.length > 1 && demo.route.length > 1) {
        startCinematic();
      } else {
        renderRoute();
      }
    });
    map.on('click', event => {
      window.ReactNativeWebView?.postMessage(JSON.stringify({
        type: 'map_tap',
        lng: event.lngLat.lng,
        lat: event.lngLat.lat
      }));
    });
    document.querySelectorAll('.chips button').forEach(btn => {
      btn.addEventListener('click', () => window.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'chip', action: btn.dataset.action })));
    });
  </script>
</body>
</html>`;
}

export default function ExplorerExplorerScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ surface?: string }>();
  const C = useTheme();
  const insets = useSafeAreaInsets();
  const activeTrip = useStore(st => st.activeTrip);
  const rigProfile = useStore(st => st.rigProfile);
  const sessionIdRef = useRef<string | null>(null);
  const navigationSessionIdRef = useRef<string | null>(null);
  const [config, setConfig] = useState<ExplorerConfig | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'blocked' | 'error'>('loading');
  const [message, setMessage] = useState('Loading Explorer');
  const [discoveredPlaces, setDiscoveredPlaces] = useState<DemoPlace[]>([]);
  const [routeExplorePlaces, setRouteExplorePlaces] = useState<DemoPlace[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<ExplorerPlaceCard | null>(null);
  const [relatedPlaces, setRelatedPlaces] = useState<ExplorerPlaceCard[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [missionBrief, setMissionBrief] = useState<MissionControlBrief | null>(null);
  const [missionLoading, setMissionLoading] = useState(false);
  const [welcomeSetupPreferences, setWelcomeSetupPreferences] = useState<WelcomeSetupPreferences | null>(null);
  const webViewRef = useRef<ExplorerWebViewHandle | null>(null);
  const [copilotPresence, setCopilotPresence] = useState<CopilotPresenceState>('building');
  const [activeScene, setActiveScene] = useState<MissionScene | null>(null);
  const [activeSceneIndex, setActiveSceneIndex] = useState(0);
  const [cinematicPlaying, setCinematicPlaying] = useState(false);
  const [cinematicPaused, setCinematicPaused] = useState(false);
  const [cinematicComplete, setCinematicComplete] = useState(false);
  const [cinematicError, setCinematicError] = useState(false);
  const presenceAfterSpeechRef = useRef<CopilotPresenceState>('flying');
  const surface: ExplorerSurface = params.surface === 'route_builder' ? 'route_builder' : 'map';

  const route = useMemo(() => routeFromTrip(activeTrip), [activeTrip?.trip_id, activeTrip?.route_geometry?.ts]);
  const checkpoints = useMemo(() => checkpointsFromTrip(activeTrip), [activeTrip?.trip_id, activeTrip?.updated_at, activeTrip?.version]);
  const tripPlaces = useMemo(() => placesFromTrip(activeTrip), [activeTrip?.trip_id, activeTrip?.updated_at, activeTrip?.version]);
  const places = useMemo(() => {
    const seed = tripPlaces.length + discoveredPlaces.length + routeExplorePlaces.length > 0 ? [] : fallbackPlaces(route, checkpoints);
    return mergePlaces([...tripPlaces, ...routeExplorePlaces, ...discoveredPlaces, ...seed]);
  }, [checkpoints, discoveredPlaces, route, routeExplorePlaces, tripPlaces]);
  const tripMemory = useMemo(() => tripMemoryFromState(rigProfile), [rigProfile]);
  const tripPreferenceContext = useMemo(
    () => tripPreferenceContextFromWelcomePreferences(welcomeSetupPreferences),
    [welcomeSetupPreferences],
  );
  const summary = useMemo(() => missionBrief?.summary || coPilotSummary(places), [missionBrief?.summary, places]);
  const missionEnabled = config?.feature_flags?.mission_control !== false && config?.feature_flags?.adventure_scores !== false;
  const cinematic = useMemo<MissionCinematic | null>(() => {
    if (route.length < 2) return null;
    try {
      return buildMissionCinematic({
        tripId: activeTrip?.trip_id ?? null,
        tripName: activeTrip?.plan.trip_name ?? 'Explorer route',
        route,
        checkpoints,
        places,
        missionBrief,
      });
    } catch {
      return null;
    }
  }, [activeTrip?.plan.trip_name, activeTrip?.trip_id, checkpoints, missionBrief, places, route]);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      try {
        const cfg = await api.getExplorerConfig();
        if (cancelled) return;
        setConfig(cfg);
        const surfaceAllowed = cfg.allowed_surfaces.includes(surface);
        if (!cfg.beta_active || cfg.kill_switch || !surfaceAllowed) {
          setStatus('blocked');
          setMessage('Explorer is not available here yet.');
          return;
        }
        if (!cfg.enabled || !cfg.entitled) {
          setStatus('blocked');
          setMessage('Explorer is in hidden beta for selected accounts.');
          return;
        }
        if (!cfg.mapbox_public_token) {
          setStatus('error');
          setMessage('Route preview is not available right now.');
          return;
        }
        const auth = await api.authorizeExplorerSession({
          surface,
          trip_id: activeTrip?.trip_id ?? null,
          checkpoints,
          trip_memory: tripMemory,
          metadata: {
            route_points: route.length,
            places: places.length,
            source: Platform.OS,
          },
        });
        if (cancelled) return;
        sessionIdRef.current = auth.session_id;
        setStatus('ready');
        api.logExplorerLedger({
          session_id: auth.session_id,
          event_type: 'demo_opened',
          surface,
          trip_id: activeTrip?.trip_id ?? null,
          event_data: { route_points: route.length, places: places.length },
        }).catch(() => {});
      } catch (error: any) {
        if (cancelled) return;
        setStatus(error?.status === 403 ? 'blocked' : 'error');
        const detail = error?.detail;
        setMessage(typeof detail?.message === 'string' ? detail.message : error?.message ?? 'Explorer could not open.');
      }
    }
    boot();
    return () => {
      cancelled = true;
      const sid = sessionIdRef.current;
      if (sid) {
        api.endExplorerSession(sid, 'closed').catch(() => {});
        sessionIdRef.current = null;
      }
      const navSid = navigationSessionIdRef.current;
      if (navSid) {
        api.endExplorerSession(navSid, 'closed').catch(() => {});
        navigationSessionIdRef.current = null;
      }
    };
  }, [activeTrip?.trip_id, checkpoints, route.length, surface, tripMemory]);

  useEffect(() => {
    let mounted = true;
    loadWelcomeSetupPreferences()
      .then(preferences => { if (mounted) setWelcomeSetupPreferences(preferences); })
      .catch(() => { if (mounted) setWelcomeSetupPreferences(null); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (status !== 'ready') return;
    let cancelled = false;
    const anchor = routeAnchor(route, checkpoints);
    api.getNearbyPlaces(
      anchor.lat,
      anchor.lng,
      45,
      'fuel,propane,water,dump,private_stay,camp,food,grocery,mechanic,viewpoint,trailhead,hardware,camping,medical,parts,wifi',
      'auto',
    )
      .then(results => {
        if (cancelled) return;
        setDiscoveredPlaces(results.map(placeFromPoi).filter(Boolean) as DemoPlace[]);
      })
      .catch(() => {
        if (!cancelled) setDiscoveredPlaces([]);
      });
    return () => { cancelled = true; };
  }, [checkpoints, route, status]);

  useEffect(() => {
    if (status !== 'ready' || route.length < 2) {
      setRouteExplorePlaces([]);
      return;
    }
    let cancelled = false;
    api.getExploreRouteRank({
      route,
      categories: ['trails', 'trail', 'trailhead', 'viewpoint', 'park', 'monument', 'historic', 'water', 'waterfall', 'camping', 'glamping', 'glacier', 'tourism'],
      limit: 28,
      max_distance_mi: 75,
      mode: 'extreme_explorer',
    })
      .then(results => {
        if (cancelled) return;
        const mapped = (results.places ?? []).map(placeFromExploreProfile).filter(Boolean) as DemoPlace[];
        setRouteExplorePlaces(mapped);
      })
      .catch(() => {
        if (!cancelled) setRouteExplorePlaces([]);
      });
    return () => { cancelled = true; };
  }, [route, status]);

  useEffect(() => {
    if (status !== 'ready') return;
    if (!missionEnabled) return;
    refreshMissionControl();
  }, [activeTrip?.trip_id, checkpoints.length, missionEnabled, places.length, route.length, status]);

  const payload = useMemo<DemoPayload | null>(() => {
    if (!config) return null;
    const demoRoute = route.length > 1 ? route : checkpoints.map(cp => [cp.lng, cp.lat] as [number, number]);
    return {
      token: config.mapbox_public_token,
      styles: config.style_uris,
      activeStyle: 'standard',
      route: demoRoute,
      checkpoints,
      places,
      summary,
      tripName: activeTrip?.plan.trip_name ?? 'Explorer',
      features: config.feature_flags,
      weatherLayers: config.weather?.enabled ? (config.weather.layers ?? []) : [],
      copilotVoice: true,
      navigationEnabled: !!config.navigation?.enabled && config.allowed_surfaces.includes('navigation'),
      safeTop: insets.top,
      safeBottom: insets.bottom,
      cinematic,
      previewMode: cinematic && cinematic.scenes.length > 0 ? 'cinematic' : 'static',
    };
  }, [activeTrip?.plan.trip_name, checkpoints, cinematic, config, insets.bottom, insets.top, places, route, summary]);

  const showCinematicUi = payload?.previewMode === 'cinematic' && !cinematicError;

  const speak = useCallback((message: string) => {
    const text = safeText(message);
    if (!text) return;
    playTrailheadVoice(text, 'guide', undefined, {
      onStart: () => setCopilotPresence('speaking'),
      onFinish: () => setCopilotPresence(presenceAfterSpeechRef.current),
    }).catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      stopTrailheadVoice().catch(() => {});
    };
  }, []);

  async function stageCopilotCommand(action: string) {
    if (!sessionIdRef.current) return;
    const commands: Record<string, string> = {
      add_fuel: 'Find fuel before the next remote stretch.',
      review_stay: 'Review private stays and camps near tonight.',
      mark_checkpoint: 'Mark a checkpoint here for review.',
      show_weather: 'Show weather risks along this route.',
      download_trip: 'Download this trip for offline use.',
      start_guidance: 'Start guided navigation for this route.',
      voice_command: 'Listen for an overland route command.',
    };
    const response = await api.extremeCopilotCommand({
      session_id: sessionIdRef.current,
      trip_id: activeTrip?.trip_id ?? null,
      command: commands[action] ?? action,
      mode: action === 'voice_command' ? 'voice' : 'text',
      context: {
        user: { trip_preferences: tripPreferenceContext },
        route_points: route.length,
        places: places.length,
        checkpoints: checkpoints.length,
      },
    });
    speak(response.message);
    return response.message;
  }

  async function refreshMissionControl() {
    if (!sessionIdRef.current) return;
    setMissionLoading(true);
    try {
      const days = Math.max(1, ...checkpoints.map(cp => Number(cp.day || 1)), ...places.map(place => Number(place.day || 0)));
      const brief = await api.extremeMissionControl({
        session_id: sessionIdRef.current,
        trip_id: activeTrip?.trip_id ?? null,
        route,
        checkpoints,
        places: places.map(place => ({
          id: place.id,
          type: place.type,
          title: place.title,
          note: place.note,
          lat: place.lat,
          lng: place.lng,
          day: place.day,
          source: place.source,
          source_label: place.source_label,
          confidence: place.source_label === 'Trailhead preview' ? 'low' : place.confidence,
          route_distance_mi: place.route_distance_mi,
        })),
        trip_memory: tripMemory,
        context: {
          route: { active_route: route.length > 1, route_ready: route.length > 1 },
          user: { trip_preferences: tripPreferenceContext },
          map: { current_screen: 'extreme_explorer' },
          trip: { active_trip: activeTrip?.trip_id ?? null, route_builder_defaults: tripPreferenceContext?.route_builder ?? null },
        },
        metadata: { source: Platform.OS, days },
      });
      setMissionBrief(brief);
    } catch (error: any) {
      if (!missionBrief) {
        setMissionBrief({
          ok: false,
          generated_at: Math.floor(Date.now() / 1000),
          readiness: 'needs_review',
          headline: 'Trip needs review',
          summary: error?.message || 'Route check could not finish yet.',
          scores: [],
          overnights: [],
          risks: [],
          recommendations: [],
          map_filters: [],
          source_summary: [],
        });
      }
    } finally {
      setMissionLoading(false);
    }
  }

  async function runMissionRecommendation(action: MissionControlRecommendation) {
    if (action.action_type === 'applyMissionFilter') {
      Alert.alert('Route check', action.reason || 'Map focus is ready for route review.');
      api.logExplorerLedger({
        session_id: sessionIdRef.current,
        event_type: 'mission_filter_selected',
        surface,
        trip_id: activeTrip?.trip_id ?? null,
        event_data: { preset: action.args?.preset || 'remote_ready' },
      }).catch(() => {});
      return;
    }
    if (action.action_type === 'searchPlaces') {
      const category = safeText(action.args?.category, 'camp');
      const anchor = routeAnchor(route, checkpoints);
      const query = category === 'fuel' ? 'fuel,gas,propane' : 'private_stay,camp,lodging';
      setRelatedLoading(true);
      try {
        const nearby = await api.getNearbyPlaces(anchor.lat, anchor.lng, 45, query, 'auto');
        const mapped = nearby.map(placeFromPoi).filter(Boolean) as DemoPlace[];
        setDiscoveredPlaces(prev => mergePlaces([...mapped, ...prev]));
        Alert.alert('Route check', action.reason || `Showing ${category} options near this route.`);
      } catch (error: any) {
        Alert.alert('Route check', error?.message || 'Nearby search could not load.');
      } finally {
        setRelatedLoading(false);
      }
      return;
    }
    if (action.action_type === 'toggleLayer') {
      const text = await previewWeather().catch((error: any) => error?.message || action.reason);
      Alert.alert('Route check', text || action.reason);
      return;
    }
    const fallbackCommand =
      action.action_type === 'startRouteScout'
        ? 'Build route geometry for this trip.'
        : action.action_type === 'openOfflineDownloads'
          ? 'Show offline downloads for this route.'
          : action.action_type === 'showMissionControl'
            ? 'Show route check.'
            : action.reason || action.label;
    const message = await stageCopilotCommand(fallbackCommand).catch((error: any) => error?.message || 'Added for review.');
    Alert.alert(action.requires_confirmation ? 'Confirm in Co-Pilot' : 'Route check', message || action.reason);
  }

  async function previewWeather() {
    if (!config?.feature_flags?.weather) {
      return 'Weather Watch is not available yet for your account.';
    }
    const risk = await api.extremeWeatherRouteRisk({
      trip_id: activeTrip?.trip_id ?? null,
      route: routeForRisk(route),
      checkpoints,
      metadata: { source: Platform.OS },
    });
    return risk.summary;
  }

  function showPlaceCard(place: ExplorerPlaceCard) {
    setSelectedPlace(place);
    setRelatedLoading(true);
    setRelatedPlaces([]);
    const nearbyCategories = 'fuel,water,private_stay,camp,food,grocery,mechanic,viewpoint,trailhead,hardware,camping,medical,parts,wifi';
    Promise.all([
      api.resolveMapCard({
        kind: 'poi',
        id: place.id,
        source: place.source,
        source_label: place.source_label,
        name: place.name,
        lat: place.lat,
        lng: place.lng,
        type: place.type,
        subtype: place.subtype,
        photo_url: place.photo_url,
        summary: place.summary,
        address: place.address,
        rating: place.rating,
        rating_count: place.rating_count,
        route,
      }).catch(() => null),
      api.getNearbyPlaces(place.lat, place.lng, 18, nearbyCategories, 'auto').catch(() => [] as OsmPoi[]),
    ]).then(([resolved, nearby]) => {
      const resolvedCard = resolved?.card ? {
        ...place,
        ...resolved.card,
        name: resolved.card.name || place.name,
        lat: Number(resolved.card.lat ?? place.lat),
        lng: Number(resolved.card.lng ?? place.lng),
        summary: resolved.card.summary || place.summary,
      } : place;
      setSelectedPlace(resolvedCard);
      const related = [
        ...(resolved?.related?.places ?? []),
        ...(resolved?.related?.camps ?? []),
        ...nearby,
      ]
        .filter(item => finiteCoord(item.lat, item.lng))
        .map((item, idx) => ({
          id: String((item as any).id ?? (item as any).place_id ?? `related-${idx}`),
          name: safeText((item as any).name || (item as any).title, 'Nearby option'),
          lat: Number(item.lat),
          lng: Number(item.lng),
          type: String((item as any).type || (item as any).subtype || 'place'),
          subtype: (item as any).subtype,
          source: (item as any).source,
          source_label: (item as any).source_label || (item as any).source_badge,
          photo_url: (item as any).photo_url,
          route_distance_mi: (item as any).route_distance_mi || (item as any).distance_mi,
          summary: (item as any).summary || (item as any).address,
        }))
        .slice(0, 8);
      setRelatedPlaces(related);
    }).finally(() => {
      setRelatedLoading(false);
    });
  }

  function showMapTap(lat: number, lng: number) {
    showPlaceCard({
      id: `tap-${lat.toFixed(5)}-${lng.toFixed(5)}`,
      name: 'Map point',
      lat,
      lng,
      type: 'poi',
      source: 'trailhead',
      source_label: 'Map selection',
      summary: 'Tap nearby options below, or add this point as a route checkpoint.',
      confidence: 'selected',
    });
  }

  function confirmGuidance() {
    if (!config?.navigation?.enabled || !config.allowed_surfaces.includes('navigation')) {
      Alert.alert('Guidance', "Guided navigation isn't available for your account yet.");
      return;
    }
    Alert.alert(
      'Start guidance',
      'Guided navigation starts a premium route session. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start',
          style: 'default',
          onPress: async () => {
            try {
              await stageCopilotCommand('start_guidance');
              const nav = await api.authorizeExplorerNavigation({
                surface: 'navigation',
                trip_id: activeTrip?.trip_id ?? null,
                route_id: activeTrip?.trip_id ?? null,
                route_summary: {
                  trip_name: activeTrip?.plan.trip_name,
                  route_points: route.length,
                  checkpoint_count: checkpoints.length,
                },
                trip_memory: tripMemory,
                metadata: { source: Platform.OS },
                acknowledged_billing: true,
                navigation_mode: 'route_guidance',
              });
              navigationSessionIdRef.current = nav.session_id;
              Alert.alert('Guidance ready', "Premium guidance is authorized. We'll notify you when native turn-by-turn is ready on this route.");
            } catch (error: any) {
              Alert.alert('Guidance', error?.message ?? 'Guidance could not start.');
            }
          },
        },
      ],
    );
  }

  function logCinematicEvent(eventType: string, eventData: Record<string, unknown> = {}) {
    if (!sessionIdRef.current) return;
    api.logExplorerLedger({
      session_id: sessionIdRef.current,
      event_type: eventType,
      surface,
      trip_id: activeTrip?.trip_id ?? null,
      event_data: eventData,
    }).catch(() => {});
  }

  function sendCinematicCommand(command: 'replay' | 'pause' | 'resume' | 'skip') {
    try {
      webViewRef.current?.injectJavaScript(
        `window.__cinematic && typeof window.__cinematic.${command} === 'function' && window.__cinematic.${command}(); true;`,
      );
    } catch {}
  }

  function handleCinematicReplay() {
    stopTrailheadVoice().catch(() => {});
    setCinematicComplete(false);
    setCinematicError(false);
    setCinematicPaused(false);
    presenceAfterSpeechRef.current = 'flying';
    sendCinematicCommand('replay');
    logCinematicEvent('cinematic_replay');
  }

  function handleCinematicPauseResume() {
    if (cinematicPaused) {
      sendCinematicCommand('resume');
    } else {
      stopTrailheadVoice().catch(() => {});
      sendCinematicCommand('pause');
    }
  }

  function handleCinematicSkip() {
    stopTrailheadVoice().catch(() => {});
    sendCinematicCommand('skip');
  }

  function handleCinematicMessage(data: any) {
    if (data.type === 'cinematic_ready') {
      setCinematicError(false);
      setCopilotPresence('building');
      logCinematicEvent('cinematic_opened', { scenes: cinematic?.scenes.length ?? 0 });
      return;
    }
    if (data.type === 'cinematic_started') {
      setCinematicPlaying(true);
      setCinematicPaused(false);
      setCinematicComplete(false);
      setCinematicError(false);
      presenceAfterSpeechRef.current = 'flying';
      setCopilotPresence('flying');
      return;
    }
    if (data.type === 'cinematic_scene_started') {
      const index = Number(data.index ?? 0);
      const scene = cinematic?.scenes.find(item => item.id === data.sceneId) ?? cinematic?.scenes[index] ?? null;
      setActiveSceneIndex(index);
      setActiveScene(scene);
      setCinematicPlaying(true);
      setCinematicPaused(false);
      const basePresence: CopilotPresenceState = scene?.layers?.warning ? 'warning' : 'flying';
      presenceAfterSpeechRef.current = scene?.type === 'mission_recap' ? 'complete' : basePresence;
      setCopilotPresence(basePresence);
      if (scene?.narration) speak(scene.narration);
      logCinematicEvent('cinematic_scene_started', { scene_id: scene?.id ?? data.sceneId, scene_type: scene?.type, index });
      return;
    }
    if (data.type === 'cinematic_scene_finished') {
      return;
    }
    if (data.type === 'cinematic_paused') {
      setCinematicPaused(true);
      setCopilotPresence('paused');
      logCinematicEvent('cinematic_pause', { index: activeSceneIndex });
      return;
    }
    if (data.type === 'cinematic_resumed') {
      setCinematicPaused(false);
      const scene = activeScene;
      setCopilotPresence(scene?.layers?.warning ? 'warning' : 'flying');
      logCinematicEvent('cinematic_resume', { index: activeSceneIndex });
      return;
    }
    if (data.type === 'cinematic_complete') {
      setCinematicPlaying(false);
      setCinematicPaused(false);
      setCinematicComplete(true);
      presenceAfterSpeechRef.current = 'complete';
      setCopilotPresence('complete');
      logCinematicEvent('cinematic_complete', { scenes: cinematic?.scenes.length ?? 0 });
      return;
    }
    if (data.type === 'cinematic_error') {
      setCinematicPlaying(false);
      setCinematicPaused(false);
      setCinematicError(true);
      setActiveScene(null);
      presenceAfterSpeechRef.current = 'idle';
      setCopilotPresence('idle');
      stopTrailheadVoice().catch(() => {});
      logCinematicEvent('cinematic_error', { message: safeText(data.message).slice(0, 200) });
    }
  }

  function handleMessage(event: any) {
    let data: any = null;
    try { data = JSON.parse(event.nativeEvent.data); } catch {}
    if (!data || !sessionIdRef.current) return;
    if (typeof data.type === 'string' && data.type.startsWith('cinematic_')) {
      handleCinematicMessage(data);
      return;
    }
    if (data.type === 'chip') {
      if (data.action === 'start_guidance') {
        confirmGuidance();
        return;
      }
      api.logExplorerLedger({
        session_id: sessionIdRef.current,
        event_type: `chip_${data.action}`,
        surface,
        trip_id: activeTrip?.trip_id ?? null,
        event_data: { action: data.action },
      }).catch(() => {});
      Promise.all([
        stageCopilotCommand(data.action).catch((error: any) => error?.message ?? 'Added for review.'),
        data.action === 'show_weather' ? previewWeather().catch((error: any) => error?.message ?? '') : Promise.resolve(''),
      ]).then(([message, weather]) => {
        const text = weather || message || 'Added for review.';
        Alert.alert(data.action === 'show_weather' ? 'Weather' : 'Explorer', text);
      });
    }
    if (data.type === 'style') {
      api.logExplorerLedger({
        session_id: sessionIdRef.current,
        event_type: 'style_changed',
        surface,
        trip_id: activeTrip?.trip_id ?? null,
        event_data: { style: data.key },
      }).catch(() => {});
    }
    if (data.type === 'place' && data.place) {
      const place = placeCardFromDemo(data.place);
      showPlaceCard(place);
      api.logExplorerLedger({
        session_id: sessionIdRef.current,
        event_type: `map_${data.source || 'place'}_selected`,
        surface,
        trip_id: activeTrip?.trip_id ?? null,
        event_data: { id: place.id, type: place.type, title: place.name },
      }).catch(() => {});
    }
    if (data.type === 'map_tap' && finiteCoord(data.lat, data.lng)) {
      showMapTap(Number(data.lat), Number(data.lng));
      api.logExplorerLedger({
        session_id: sessionIdRef.current,
        event_type: 'map_tapped',
        surface,
        trip_id: activeTrip?.trip_id ?? null,
        event_data: { lat: data.lat, lng: data.lng },
      }).catch(() => {});
    }
  }

  if (status !== 'ready' || !payload) {
    return (
      <SafeAreaView style={[styles.blocked, { backgroundColor: C.bg }]}>
        <TouchableOpacity style={[styles.backBtn, { borderColor: C.border, backgroundColor: C.s2 }]} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={18} color={C.text} />
        </TouchableOpacity>
        <View style={styles.blockedInner}>
          {status === 'loading' ? <ActivityIndicator color={C.orange} /> : <Ionicons name="sparkles-outline" size={30} color={C.orange} />}
          <Text style={[styles.blockedTitle, { color: C.text }]}>Explorer</Text>
          <Text style={[styles.blockedText, { color: C.text3 }]}>{message}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.screen}>
      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html: makeHtml(payload) }}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        style={styles.web}
      />
      <View pointerEvents="box-none" style={[styles.chrome, { top: insets.top + 8 }]}>
        <TouchableOpacity style={styles.closeBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={20} color="#f8fafc" />
        </TouchableOpacity>
        <View style={styles.titlePill}>
          <Text style={styles.titleKicker}>EXPLORER</Text>
          <Text style={styles.titleText} numberOfLines={1}>{activeTrip?.plan.trip_name ?? 'Route preview'}</Text>
        </View>
      </View>
      {!selectedPlace && showCinematicUi && (
        <View pointerEvents="box-none" style={[styles.missionWrap, { bottom: insets.bottom + 16 }]}>
          {showCinematicUi && (
            <View pointerEvents="box-none" style={styles.cinematicBlock}>
              <View pointerEvents="box-none" style={styles.cinematicRow}>
                <CopilotPresenceOrb state={copilotPresence} />
                <View style={styles.cinematicCaption} pointerEvents="none">
                  <TripPreviewCaption
                    scene={activeScene}
                    sceneIndex={activeSceneIndex}
                    sceneCount={cinematic?.scenes.length ?? 0}
                  />
                </View>
              </View>
              <View style={styles.cinematicControls}>
                <TripPreviewControls
                  playing={cinematicPlaying}
                  paused={cinematicPaused}
                  complete={cinematicComplete}
                  onReplay={handleCinematicReplay}
                  onPauseResume={handleCinematicPauseResume}
                  onSkip={handleCinematicSkip}
                />
              </View>
            </View>
          )}
        </View>
      )}
      <PremiumPlaceSheet
        place={selectedPlace}
        visible={!!selectedPlace}
        initialStage="half"
        related={{ loading: relatedLoading, places: relatedPlaces, camps: [], trails: [] }}
        routeContextLabel="Explorer"
        addToRouteLabel="Add checkpoint"
        promoteToRouteLabel="Route through"
        onClose={() => setSelectedPlace(null)}
        onNavigate={place => {
          showPlaceCard({ ...place, type: 'poi', source: 'trailhead', source_label: 'Map selection' });
        }}
        onSave={place => {
          Alert.alert('Saved', `${place.name} saved.`);
        }}
        onAddToRoute={place => {
          Alert.alert('Added to route', `${place.name} added as a checkpoint.`);
        }}
        onPromoteToRoute={place => {
          Alert.alert('Routed through', `${place.name} added to the route.`);
        }}
        onReport={() => Alert.alert('Report', "Field reports aren't available in Explorer yet. Submit them from the Report tab.")}
        onNearbyCamps={place => {
          showPlaceCard({ ...place, type: 'camp', source: 'trailhead', source_label: 'Camp search' });
        }}
        onOpenRelatedPlace={place => showPlaceCard({
          id: String(place.id ?? ''),
          name: safeText(place.name, 'Nearby option'),
          lat: place.lat,
          lng: place.lng,
          type: place.type,
          subtype: place.subtype,
          source_label: place.source_label,
          photo_url: place.photo_url,
          route_distance_mi: place.route_distance_mi || place.distance_mi,
        })}
        onOpenRelatedCamp={place => showPlaceCard({
          id: String(place.id ?? ''),
          name: safeText(place.name, 'Camp option'),
          lat: place.lat,
          lng: place.lng,
          type: place.type || 'camp',
          subtype: place.subtype,
          source_label: place.source_label,
          photo_url: place.photo_url,
          route_distance_mi: place.route_distance_mi || place.distance_mi,
        })}
        onOpenRelatedTrail={place => showPlaceCard({
          id: String(place.id ?? ''),
          name: safeText(place.name, 'Trail option'),
          lat: place.lat,
          lng: place.lng,
          type: place.type || 'trail',
          subtype: place.subtype,
          source_label: place.source_label,
          photo_url: place.photo_url,
          route_distance_mi: place.route_distance_mi || place.distance_mi,
        })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#070a0d' },
  web: { flex: 1, backgroundColor: '#070a0d' },
  chrome: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
  },
  closeBtn: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(8,12,18,.82)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,.16)',
  },
  titlePill: {
    flex: 1,
    minHeight: 42,
    borderRadius: 15,
    paddingHorizontal: 12,
    justifyContent: 'center',
    backgroundColor: 'rgba(8,12,18,.82)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,.16)',
  },
  missionWrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 4,
    gap: 10,
  },
  cinematicBlock: { gap: 8 },
  cinematicRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  cinematicCaption: { flex: 1 },
  cinematicControls: { flexDirection: 'row', justifyContent: 'flex-end' },
  titleKicker: { color: '#fb923c', fontSize: 9, fontFamily: mono, fontWeight: '900', letterSpacing: 1.2 },
  titleText: { color: '#f8fafc', fontSize: 12, fontWeight: '800', marginTop: 2 },
  blocked: { flex: 1 },
  backBtn: {
    position: 'absolute',
    top: 54,
    left: 16,
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blockedInner: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  blockedTitle: { fontSize: 26, fontWeight: '900', textAlign: 'center' },
  blockedText: { fontSize: 14, lineHeight: 20, textAlign: 'center', maxWidth: 300 },
});
