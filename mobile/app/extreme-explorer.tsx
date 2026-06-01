import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Speech from 'expo-speech';
import { WebView } from 'react-native-webview';
import { api, ExtremeCheckpoint, ExtremeConfig, ExtremeSurface, OsmPoi, TripMemory } from '@/lib/api';
import { useTheme, mono } from '@/lib/design';
import { useStore } from '@/lib/store';

type DemoPlace = {
  id: string;
  type: string;
  title: string;
  note: string;
  lat: number;
  lng: number;
  day?: number;
};

type DemoPayload = {
  token: string;
  styles: ExtremeConfig['style_uris'];
  activeStyle: keyof ExtremeConfig['style_uris'];
  route: [number, number][];
  checkpoints: ExtremeCheckpoint[];
  places: DemoPlace[];
  summary: string;
  tripName: string;
  features: ExtremeConfig['feature_flags'];
  weatherLayers: NonNullable<ExtremeConfig['weather']>['layers'];
  copilotVoice: boolean;
  navigationEnabled: boolean;
};

const STYLE_ORDER: Array<keyof ExtremeConfig['style_uris']> = [
  'standard',
  'live_road',
  'satellite_trail',
  '3d_terrain',
  'night_drive',
  'weather_watch',
  'outdoors',
];

const STYLE_TITLES: Record<keyof ExtremeConfig['style_uris'], string> = {
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

function checkpointsFromTrip(trip: ReturnType<typeof useStore.getState>['activeTrip']): ExtremeCheckpoint[] {
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
  if (fuel || stays) return `I found ${fuel || 'a'} fuel ${fuel === 1 ? 'stop' : 'stops'} and ${stays || 'several'} stay options near the route.`;
  if (risks) return 'I marked route checks to review before leaving signal.';
  return 'I staged the route with checkpoints and nearby options.';
}

function routeForRisk(route: [number, number][]) {
  return route
    .filter(coord => Number.isFinite(coord[0]) && Number.isFinite(coord[1]))
    .slice(0, 80)
    .map(([lng, lat]) => ({ lat, lng }));
}

function makeHtml(payload: DemoPayload) {
  const data = escapeHtmlJson(payload);
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
    .marker { width: 30px; height: 30px; border-radius: 15px; display: grid; place-items: center; color: #fff; font-size: 11px; font-weight: 900; border: 2px solid rgba(255,255,255,.88); box-shadow: 0 8px 24px rgba(0,0,0,.36); transform: scale(.2); opacity: 0; transition: transform .42s cubic-bezier(.2,1.3,.25,1), opacity .28s ease; }
    .marker.show { transform: scale(1); opacity: 1; }
    .place { background: #0ea5e9; }
    .fuel { background: #f97316; }
    .camp, .stay, .private_stay { background: #16a34a; }
    .food { background: #06b6d4; }
    .repair { background: #eab308; }
    .viewpoint { background: #8b5cf6; }
    .weather_risk { background: #ef4444; }
    .checkpoint { width: 34px; height: 34px; border-radius: 12px; background: #111827; color: #f8fafc; border-color: #f97316; }
    .popup { max-width: 220px; font: 12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    .popup b { display:block; margin-bottom: 3px; }
    .stylebar { position: absolute; top: 14px; left: 12px; right: 12px; display: flex; gap: 8px; overflow-x: auto; z-index: 3; padding-bottom: 4px; }
    .stylebar button { white-space: nowrap; border: 1px solid rgba(255,255,255,.18); background: rgba(8,12,18,.78); color: #dbe4ef; border-radius: 999px; padding: 9px 12px; font-size: 11px; font-weight: 800; backdrop-filter: blur(14px); }
    .stylebar button.active { background: #f97316; border-color: #fb923c; color: white; }
    .tray { position: absolute; left: 12px; right: 12px; bottom: 14px; z-index: 3; background: rgba(8,12,18,.86); border: 1px solid rgba(255,255,255,.16); border-radius: 22px; padding: 14px; color: #f8fafc; backdrop-filter: blur(18px); box-shadow: 0 -16px 46px rgba(0,0,0,.32); }
    .tray-top { display:flex; gap:10px; align-items:center; margin-bottom:8px; }
    .orb { width: 30px; height: 30px; border-radius: 12px; background: #f97316; box-shadow: 0 0 26px rgba(249,115,22,.34); }
    .tray-title { font-size: 11px; font-weight: 900; letter-spacing: .14em; color: #fb923c; }
    .tray-text { font-size: 14px; line-height: 1.35; font-weight: 750; }
    .chips { display:flex; gap:8px; overflow-x:auto; padding-top: 10px; }
    .chips button { white-space: nowrap; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.07); color: #f8fafc; border-radius: 999px; padding: 8px 10px; font-size: 11px; font-weight: 800; }
    .chips button.primary { background: #f97316; border-color: #fb923c; }
    .mode-badges { display:flex; gap:6px; overflow-x:auto; padding-top: 9px; }
    .mode-badges span { white-space:nowrap; border:1px solid rgba(255,255,255,.12); color:#cbd5e1; border-radius:999px; padding:5px 8px; font-size:9px; font-weight:900; letter-spacing:.08em; }
  </style>
</head>
<body>
  <div id="map"></div>
  <div id="loading" class="loading"><div class="load-card"><div class="pulse"></div><div class="load-title">EXTREME EXPLORER</div><div class="load-sub">Loading premium route preview</div></div></div>
  <div class="stylebar" id="stylebar"></div>
  <div class="tray">
    <div class="tray-top"><div class="orb"></div><div><div class="tray-title">CO-PILOT</div><div class="tray-text">${payload.summary.replace(/[<>&]/g, '')}</div></div></div>
    <div class="chips">
      <button class="primary" data-action="${payload.copilotVoice ? 'voice_command' : 'mark_checkpoint'}">${payload.copilotVoice ? 'Voice' : 'Ask'}</button>
      <button data-action="add_fuel">Add fuel</button>
      <button data-action="review_stay">Review stays</button>
      <button data-action="mark_checkpoint">Mark checkpoint</button>
      <button data-action="show_weather">Show weather</button>
      <button data-action="start_guidance">Start guidance</button>
      <button data-action="download_trip">Download trip</button>
    </div>
    <div class="mode-badges">
      <span>${payload.navigationEnabled ? 'GUIDANCE READY' : 'GUIDANCE LOCKED'}</span>
      <span>${payload.weatherLayers.length ? 'WEATHER WATCH' : 'WEATHER LOCKED'}</span>
      <span>${payload.copilotVoice ? 'VOICE READY' : 'TEXT COMMANDS'}</span>
    </div>
  </div>
  <script>
    const demo = ${data};
    mapboxgl.accessToken = demo.token || '';
    const fallbackCenter = demo.route[0] || [-109.55, 38.57];
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
        map.once('style.load', renderRoute);
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
    function addMarker(point, idx, checkpoint) {
      const el = document.createElement('div');
      el.className = checkpoint ? 'marker checkpoint' : 'marker ' + markerClass(point.type);
      el.textContent = checkpoint ? String(point.sequence || idx + 1) : labelFor(point.type, point.day);
      const popup = new mapboxgl.Popup({ offset: 18, closeButton: false, className: 'popup' })
        .setHTML('<b>' + String(point.title || 'Stop').replace(/[<>&]/g, '') + '</b>' + String(point.note || '').replace(/[<>&]/g, ''));
      new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([point.lng, point.lat])
        .setPopup(popup)
        .addTo(map);
      setTimeout(() => el.classList.add('show'), 520 + idx * 80);
    }
    function renderRoute() {
      if (!map.isStyleLoaded()) return;
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
          map.addLayer({ id: 'route-anim-line', type: 'line', source: 'route-anim', paint: { 'line-color': '#f97316', 'line-width': 5, 'line-opacity': .96 } });
        }
        const b = boundsFor(demo.route);
        if (!b.isEmpty()) map.fitBounds(b, { padding: { top: 96, bottom: 210, left: 40, right: 40 }, duration: 950, maxZoom: 12 });
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
    map.on('load', renderRoute);
    document.querySelectorAll('.chips button').forEach(btn => {
      btn.addEventListener('click', () => window.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'chip', action: btn.dataset.action })));
    });
  </script>
</body>
</html>`;
}

export default function ExtremeExplorerScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ surface?: string }>();
  const C = useTheme();
  const activeTrip = useStore(st => st.activeTrip);
  const rigProfile = useStore(st => st.rigProfile);
  const sessionIdRef = useRef<string | null>(null);
  const navigationSessionIdRef = useRef<string | null>(null);
  const [config, setConfig] = useState<ExtremeConfig | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'blocked' | 'error'>('loading');
  const [message, setMessage] = useState('Loading Extreme Explorer');
  const surface: ExtremeSurface = params.surface === 'route_builder' ? 'route_builder' : 'map';

  const route = useMemo(() => routeFromTrip(activeTrip), [activeTrip?.trip_id, activeTrip?.route_geometry?.ts]);
  const checkpoints = useMemo(() => checkpointsFromTrip(activeTrip), [activeTrip?.trip_id, activeTrip?.updated_at, activeTrip?.version]);
  const places = useMemo(() => placesFromTrip(activeTrip), [activeTrip?.trip_id, activeTrip?.updated_at, activeTrip?.version]);
  const tripMemory = useMemo(() => tripMemoryFromState(rigProfile), [rigProfile]);
  const summary = useMemo(() => coPilotSummary(places), [places]);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      try {
        const cfg = await api.getExtremeConfig();
        if (cancelled) return;
        setConfig(cfg);
        const surfaceAllowed = cfg.allowed_surfaces.includes(surface);
        if (!cfg.beta_active || cfg.kill_switch || !surfaceAllowed) {
          setStatus('blocked');
          setMessage('Extreme Explorer is not available here yet.');
          return;
        }
        if (!cfg.enabled || !cfg.entitled) {
          setStatus('blocked');
          setMessage('Extreme Explorer is in hidden beta for selected accounts.');
          return;
        }
        if (!cfg.mapbox_public_token) {
          setStatus('error');
          setMessage('Premium map preview is not configured.');
          return;
        }
        const auth = await api.authorizeExtremeSession({
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
        api.logExtremeLedger({
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
        setMessage(typeof detail?.message === 'string' ? detail.message : error?.message ?? 'Extreme Explorer could not open.');
      }
    }
    boot();
    return () => {
      cancelled = true;
      const sid = sessionIdRef.current;
      if (sid) {
        api.endExtremeSession(sid, 'closed').catch(() => {});
        sessionIdRef.current = null;
      }
      const navSid = navigationSessionIdRef.current;
      if (navSid) {
        api.endExtremeSession(navSid, 'closed').catch(() => {});
        navigationSessionIdRef.current = null;
      }
    };
  }, [activeTrip?.trip_id, checkpoints, places.length, route.length, surface, tripMemory]);

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
      tripName: activeTrip?.plan.trip_name ?? 'Extreme Explorer',
      features: config.feature_flags,
      weatherLayers: config.weather?.enabled ? (config.weather.layers ?? []) : [],
      copilotVoice: !!config.copilot?.voice_enabled,
      navigationEnabled: !!config.navigation?.enabled && config.allowed_surfaces.includes('navigation'),
    };
  }, [activeTrip?.plan.trip_name, checkpoints, config, places, route, summary]);

  function speak(message: string) {
    if (!config?.copilot?.voice_enabled) return;
    Speech.stop();
    Speech.speak(message, { rate: 0.96, pitch: 1.0 });
  }

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
        route_points: route.length,
        places: places.length,
        checkpoints: checkpoints.length,
      },
    });
    speak(response.message);
    return response.message;
  }

  async function previewWeather() {
    if (!config?.feature_flags?.weather) {
      return 'Weather Watch is not enabled for this beta.';
    }
    const risk = await api.extremeWeatherRouteRisk({
      trip_id: activeTrip?.trip_id ?? null,
      route: routeForRisk(route),
      checkpoints,
      metadata: { source: Platform.OS },
    });
    return risk.summary;
  }

  function confirmGuidance() {
    if (!config?.navigation?.enabled || !config.allowed_surfaces.includes('navigation')) {
      Alert.alert('Guidance', 'Guided navigation is not enabled for this beta.');
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
              const nav = await api.authorizeExtremeNavigation({
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
              Alert.alert('Guidance ready', 'Premium guidance is authorized. Native turn-by-turn opens in the next build slice.');
            } catch (error: any) {
              Alert.alert('Guidance', error?.message ?? 'Guidance could not start.');
            }
          },
        },
      ],
    );
  }

  function handleMessage(event: any) {
    let data: any = null;
    try { data = JSON.parse(event.nativeEvent.data); } catch {}
    if (!data || !sessionIdRef.current) return;
    if (data.type === 'chip') {
      if (data.action === 'start_guidance') {
        confirmGuidance();
        return;
      }
      api.logExtremeLedger({
        session_id: sessionIdRef.current,
        event_type: `chip_${data.action}`,
        surface,
        trip_id: activeTrip?.trip_id ?? null,
        event_data: { action: data.action },
      }).catch(() => {});
      Promise.all([
        stageCopilotCommand(data.action).catch((error: any) => error?.message ?? 'Action staged for review.'),
        data.action === 'show_weather' ? previewWeather().catch((error: any) => error?.message ?? '') : Promise.resolve(''),
      ]).then(([message, weather]) => {
        const text = weather || message || 'Action staged for review.';
        Alert.alert('Co-Pilot', text);
      });
    }
    if (data.type === 'style') {
      api.logExtremeLedger({
        session_id: sessionIdRef.current,
        event_type: 'style_changed',
        surface,
        trip_id: activeTrip?.trip_id ?? null,
        event_data: { style: data.key },
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
          <Text style={[styles.blockedTitle, { color: C.text }]}>Extreme Explorer</Text>
          <Text style={[styles.blockedText, { color: C.text3 }]}>{message}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.screen}>
      <WebView
        originWhitelist={['*']}
        source={{ html: makeHtml(payload) }}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        style={styles.web}
      />
      <SafeAreaView pointerEvents="box-none" style={styles.chrome}>
        <TouchableOpacity style={styles.closeBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={20} color="#f8fafc" />
        </TouchableOpacity>
        <View style={styles.titlePill}>
          <Text style={styles.titleKicker}>EXTREME EXPLORER</Text>
          <Text style={styles.titleText} numberOfLines={1}>{activeTrip?.plan.trip_name ?? 'Premium map preview'}</Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#070a0d' },
  web: { flex: 1, backgroundColor: '#070a0d' },
  chrome: {
    position: 'absolute',
    top: 0,
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
