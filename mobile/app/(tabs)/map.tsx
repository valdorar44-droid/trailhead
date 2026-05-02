import { useEffect, useRef, useState, useMemo, useCallback, Component } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Linking, Animated, TextInput, ActivityIndicator, Modal, Image, Share, Alert, AppState, KeyboardAvoidingView, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import NativeMap, { type NativeMapHandle } from '@/components/NativeMap';
import RouteSearchModal from '@/components/RouteSearchModal';
import OfflineModal from '@/components/NativeMap/OfflineModal';

// ── Native MapLibre SDK active ────────────────────────────────────────────────
const USE_NATIVE_MAP = true;
import * as Location from 'expo-location';
import { storage } from '@/lib/storage';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as FileSystem from 'expo-file-system';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useStore } from '@/lib/store';
import { api, PaywallError, Report, Pin, CampsitePin, CampsiteDetail, OsmPoi, WikiArticle, CampsiteInsight, RouteBrief, PackingList, CampFullness, WeatherForecast, RouteWeatherResult, LandCheck, CampFieldReport, FieldReportSummary, FieldReportSentiment, FieldReportAccess, FieldReportCrowd, Waypoint } from '@/lib/api';
import { loadOfflineTrip, saveOfflineTrip } from '@/lib/offlineTrips';
import { loadRouteGeometry, saveRouteGeometry } from '@/lib/offlineRoutes';
import * as ImagePicker from 'expo-image-picker';
import PaywallModal from '@/components/PaywallModal';
import { useTheme, mono, ColorPalette } from '@/lib/design';
import { useConnectivitySync } from '@/lib/connectivitySync';

// ─── US State bounding boxes for offline download ─────────────────────────────

const US_STATES: Record<string, { name: string; n: number; s: number; e: number; w: number; emoji: string }> = {
  // West
  AK: { name: 'Alaska',       n: 71.4, s: 54.6, e: -130.0, w: -168.0, emoji: '🐻' },
  AZ: { name: 'Arizona',      n: 37.0, s: 31.3, e: -109.0, w: -114.8, emoji: '🏜️' },
  CA: { name: 'California',   n: 42.0, s: 32.5, e: -114.1, w: -124.4, emoji: '🌴' },
  CO: { name: 'Colorado',     n: 41.0, s: 37.0, e: -102.0, w: -109.1, emoji: '🏔️' },
  HI: { name: 'Hawaii',       n: 22.2, s: 18.9, e: -154.8, w: -160.2, emoji: '🌺' },
  ID: { name: 'Idaho',        n: 49.0, s: 42.0, e: -111.0, w: -117.2, emoji: '🏔️' },
  MT: { name: 'Montana',      n: 49.0, s: 44.4, e: -104.0, w: -116.0, emoji: '🦬' },
  NM: { name: 'New Mexico',   n: 37.0, s: 31.3, e: -103.0, w: -109.1, emoji: '🌵' },
  NV: { name: 'Nevada',       n: 42.0, s: 35.0, e: -114.0, w: -120.0, emoji: '🎰' },
  OR: { name: 'Oregon',       n: 46.3, s: 41.9, e: -116.5, w: -124.6, emoji: '🌲' },
  UT: { name: 'Utah',         n: 42.0, s: 36.9, e: -109.0, w: -114.1, emoji: '🏜️' },
  WA: { name: 'Washington',   n: 49.0, s: 45.5, e: -116.9, w: -124.7, emoji: '☁️' },
  WY: { name: 'Wyoming',      n: 45.0, s: 41.0, e: -104.1, w: -111.1, emoji: '🦅' },
  // Central / South
  KS: { name: 'Kansas',       n: 40.0, s: 36.9, e: -94.6,  w: -102.1, emoji: '🌾' },
  MN: { name: 'Minnesota',    n: 49.4, s: 43.5, e: -89.5,  w: -97.2,  emoji: '🦅' },
  MO: { name: 'Missouri',     n: 40.6, s: 35.9, e: -89.1,  w: -95.8,  emoji: '🌉' },
  ND: { name: 'North Dakota', n: 49.0, s: 45.9, e: -96.6,  w: -104.1, emoji: '🌾' },
  NE: { name: 'Nebraska',     n: 43.0, s: 40.0, e: -95.3,  w: -104.1, emoji: '🌽' },
  OK: { name: 'Oklahoma',     n: 37.0, s: 33.6, e: -94.4,  w: -103.0, emoji: '🤠' },
  SD: { name: 'South Dakota', n: 45.9, s: 42.5, e: -96.4,  w: -104.1, emoji: '🦬' },
  TX: { name: 'Texas',        n: 36.5, s: 25.8, e: -93.5,  w: -106.6, emoji: '🤠' },
  // Southeast
  AL: { name: 'Alabama',      n: 35.0, s: 30.2, e: -84.9,  w: -88.5,  emoji: '🌿' },
  AR: { name: 'Arkansas',     n: 36.5, s: 33.0, e: -89.6,  w: -94.6,  emoji: '🏞️' },
  FL: { name: 'Florida',      n: 31.0, s: 24.5, e: -80.0,  w: -87.6,  emoji: '🌊' },
  GA: { name: 'Georgia',      n: 35.0, s: 30.4, e: -80.8,  w: -85.6,  emoji: '🍑' },
  KY: { name: 'Kentucky',     n: 39.1, s: 36.5, e: -81.9,  w: -89.6,  emoji: '🐎' },
  LA: { name: 'Louisiana',    n: 33.0, s: 28.9, e: -88.8,  w: -94.0,  emoji: '🎷' },
  MS: { name: 'Mississippi',  n: 35.0, s: 30.2, e: -88.1,  w: -91.7,  emoji: '🌊' },
  NC: { name: 'North Carolina',n:36.6, s: 33.8, e: -75.5,  w: -84.3,  emoji: '🏔️' },
  SC: { name: 'South Carolina',n:35.2, s: 32.0, e: -78.5,  w: -83.4,  emoji: '🌴' },
  TN: { name: 'Tennessee',    n: 36.7, s: 35.0, e: -81.6,  w: -90.3,  emoji: '🎵' },
  VA: { name: 'Virginia',     n: 39.5, s: 36.5, e: -75.2,  w: -83.7,  emoji: '🏛️' },
  WV: { name: 'West Virginia',n: 40.6, s: 37.2, e: -77.7,  w: -82.6,  emoji: '⛏️' },
  // Northeast
  CT: { name: 'Connecticut',  n: 42.1, s: 41.0, e: -71.8,  w: -73.7,  emoji: '🍂' },
  DE: { name: 'Delaware',     n: 39.8, s: 38.4, e: -75.0,  w: -75.8,  emoji: '🏖️' },
  MA: { name: 'Massachusetts',n: 42.9, s: 41.2, e: -69.9,  w: -73.5,  emoji: '🦞' },
  MD: { name: 'Maryland',     n: 39.7, s: 37.9, e: -75.0,  w: -79.5,  emoji: '🦀' },
  ME: { name: 'Maine',        n: 47.5, s: 43.1, e: -66.9,  w: -71.1,  emoji: '🦌' },
  NH: { name: 'New Hampshire',n: 45.3, s: 42.7, e: -70.6,  w: -72.6,  emoji: '🍁' },
  NJ: { name: 'New Jersey',   n: 41.4, s: 38.9, e: -73.9,  w: -75.6,  emoji: '🏙️' },
  NY: { name: 'New York',     n: 45.0, s: 40.5, e: -71.8,  w: -79.8,  emoji: '🗽' },
  PA: { name: 'Pennsylvania', n: 42.3, s: 39.7, e: -74.7,  w: -80.5,  emoji: '🔔' },
  RI: { name: 'Rhode Island', n: 42.0, s: 41.1, e: -71.1,  w: -71.9,  emoji: '⚓' },
  VT: { name: 'Vermont',      n: 45.0, s: 42.7, e: -71.5,  w: -73.4,  emoji: '🍁' },
  // Midwest
  IA: { name: 'Iowa',         n: 43.5, s: 40.4, e: -90.1,  w: -96.6,  emoji: '🌽' },
  IL: { name: 'Illinois',     n: 42.5, s: 36.9, e: -87.0,  w: -91.5,  emoji: '🏙️' },
  IN: { name: 'Indiana',      n: 41.8, s: 37.8, e: -84.8,  w: -88.1,  emoji: '🏎️' },
  MI: { name: 'Michigan',     n: 48.3, s: 41.7, e: -82.4,  w: -90.4,  emoji: '🚗' },
  OH: { name: 'Ohio',         n: 42.0, s: 38.4, e: -80.5,  w: -84.8,  emoji: '🌻' },
  WI: { name: 'Wisconsin',    n: 47.1, s: 42.5, e: -86.2,  w: -92.9,  emoji: '🧀' },
};

type RouteOpts = { avoidTolls: boolean; avoidHighways: boolean; backRoads: boolean; noFerries: boolean };

interface SearchPlace { lat: number; lng: number; name: string; dist?: number | null; };

// ─── Types ────────────────────────────────────────────────────────────────────

type WP = { lat: number; lng: number; name: string; day: number; type: string };
type MapLayer = 'satellite' | 'topo' | 'hybrid';

interface RouteStep {
  type: string;
  modifier: string;
  name: string;
  distance: number; // metres
  duration: number; // seconds
  lat?: number;     // maneuver point — used for step advancement
  lng?: number;
  lanes?: { indications: string[]; valid: boolean; active?: boolean }[];
  speedLimit?: number | null; // kph, from per-step maxspeed annotation
}

// ─── Geo math ─────────────────────────────────────────────────────────────────

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calcBearing(lat1: number, lng1: number, lat2: number, lng2: number) {
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
    Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function nearestWpIdx(loc: { lat: number; lng: number }, wps: WP[]): number {
  let minD = Infinity, nearest = 0;
  wps.forEach((wp, i) => {
    const d = haversineKm(loc.lat, loc.lng, wp.lat, wp.lng);
    if (d < minD) { minD = d; nearest = i; }
  });
  return nearest;
}

function compassDir(deg: number) {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
}

function smoothAngle(prev: number | null, next: number, alpha: number) {
  if (prev === null || !Number.isFinite(prev)) return ((next % 360) + 360) % 360;
  let diff = next - prev;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return (prev + diff * alpha + 360) % 360;
}

function formatDist(km: number) {
  const mi = km * 0.621371;
  if (mi < 0.05) return 'ARRIVING';
  if (mi < 0.12) return `${Math.round(mi * 5280)} ft`;
  return mi >= 10 ? `${Math.round(mi)} mi` : `${mi.toFixed(1)} mi`;
}

function formatStepDist(metres: number) {
  if (metres < 30) return 'NOW';
  const ft = metres * 3.28084;
  if (ft < 500) return `${Math.round(ft / 50) * 50} FT`;
  if (ft < 1000) return `${Math.round(ft / 100) * 100} FT`;
  const mi = metres * 0.000621371;
  if (mi < 0.4) return `${Math.round(mi * 10) / 10} MI`;
  return mi >= 10 ? `${Math.round(mi)} MI` : `${mi.toFixed(1)} MI`;
}

function timeAgo(unixSec: number): string {
  const mins = Math.floor((Date.now() / 1000 - unixSec) / 60);
  if (mins < 2)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ─── Turn arrow — pure View, no SVG dependency ───────────────────────────────
// Draws a road-style directional arrow using borders + transforms.
function TurnArrow({ modifier, type, size = 56, color = '#f5a623' }: {
  modifier: string; type: string; size?: number; color?: string;
}) {
  const m = modifier.toLowerCase();
  const lw = Math.round(size / 8);   // line width
  const r  = Math.round(size / 4);   // corner radius
  const hw = Math.round(size / 2);   // half width
  const ah = Math.round(size / 5);   // arrowhead height
  const aw = Math.round(size / 3);   // arrowhead width

  // Arrowhead as two angled lines rendered via rotated Views
  const ArrowHead = ({ style }: { style: any }) => (
    <View style={style}>
      <View style={{ width: lw * 1.4, height: ah, backgroundColor: color, borderRadius: lw / 2,
        transform: [{ rotate: '-40deg' }, { translateY: -ah * 0.15 }] }} />
      <View style={{ width: lw * 1.4, height: ah, backgroundColor: color, borderRadius: lw / 2,
        transform: [{ rotate: '40deg' }, { translateY: -ah * 0.15 }] }} />
    </View>
  );

  if (type === 'arrive') {
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: size * 0.55, height: size * 0.55, borderRadius: size * 0.275,
          borderWidth: lw, borderColor: color }} />
        <View style={{ position: 'absolute', width: lw, height: size * 0.3,
          backgroundColor: color, bottom: size * 0.1, borderRadius: lw / 2 }} />
      </View>
    );
  }

  // Straight
  if (!m || m === 'straight') {
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: lw, height: size * 0.65, backgroundColor: color, borderRadius: lw / 2, marginTop: ah * 0.8 }} />
        <ArrowHead style={{ position: 'absolute', top: 0, flexDirection: 'row', gap: 2, alignItems: 'flex-start' }} />
      </View>
    );
  }

  // U-turn
  if (m === 'uturn') {
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: size * 0.45, height: size * 0.55, borderTopLeftRadius: size * 0.225,
          borderTopRightRadius: size * 0.225, borderTopWidth: lw, borderLeftWidth: lw, borderRightWidth: lw,
          borderColor: color, marginLeft: -size * 0.1 }} />
        <View style={{ position: 'absolute', left: size * 0.14, bottom: size * 0.12,
          width: lw, height: size * 0.25, backgroundColor: color, borderRadius: lw / 2 }} />
        <ArrowHead style={{ position: 'absolute', left: size * 0.03, bottom: size * 0.07,
          flexDirection: 'row', gap: 2, transform: [{ rotate: '-90deg' }] }} />
      </View>
    );
  }

  const isLeft  = m.includes('left');
  const isSharp = m.includes('sharp');
  const isSlight = m.includes('slight');

  // Curve radius and x-offset depend on sharpness
  const curveW  = isSharp ? size * 0.32 : isSlight ? size * 0.18 : size * 0.28;
  const curveR  = isSharp ? size * 0.22 : isSlight ? size * 0.32 : size * 0.26;
  const stemH   = isSharp ? size * 0.32 : size * 0.36;
  const armW    = isSharp ? size * 0.28 : isSlight ? size * 0.2 : size * 0.24;
  const side    = isLeft ? -1 : 1;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: size * 0.06 }}>
      {/* Vertical stem */}
      <View style={{ width: lw, height: stemH, backgroundColor: color, borderRadius: lw / 2,
        alignSelf: 'center', marginBottom: 0 }} />
      {/* Corner curve — simulated with a border-radius box */}
      <View style={{
        position: 'absolute',
        bottom: stemH - lw / 2,
        [isLeft ? 'left' : 'right']: hw - lw / 2 - curveW,
        width: curveW, height: curveR,
        borderBottomWidth: lw, borderColor: color, borderRadius: 0,
        borderBottomLeftRadius: isLeft ? 0 : curveR,
        borderBottomRightRadius: isLeft ? curveR : 0,
        borderLeftWidth: isLeft ? 0 : lw,
        borderRightWidth: isLeft ? lw : 0,
      }} />
      {/* Horizontal arm */}
      <View style={{
        position: 'absolute',
        bottom: stemH + curveR - lw * 1.5,
        [isLeft ? 'left' : 'right']: hw - lw / 2 - curveW - armW,
        width: armW, height: lw, backgroundColor: color, borderRadius: lw / 2,
      }} />
      {/* Arrowhead at end of arm */}
      <View style={{
        position: 'absolute',
        bottom: stemH + curveR - lw * 1.5 - ah * 0.4,
        [isLeft ? 'left' : 'right']: hw - lw / 2 - curveW - armW - ah * 0.3,
        transform: [{ rotate: isLeft ? '-90deg' : '90deg' }],
        flexDirection: 'row', gap: 2,
      }}>
        <View style={{ width: lw * 1.3, height: ah, backgroundColor: color, borderRadius: lw / 2,
          transform: [{ rotate: '-40deg' }, { translateY: -ah * 0.15 }] }} />
        <View style={{ width: lw * 1.3, height: ah, backgroundColor: color, borderRadius: lw / 2,
          transform: [{ rotate: '40deg' }, { translateY: -ah * 0.15 }] }} />
      </View>
    </View>
  );
}

// Compute Mapbox zoom level from speed for speed-aware camera
function navZoom(speedMs: number | null): number {
  if (!speedMs || speedMs < 4)  return 17;  // stopped/slow
  if (speedMs < 14)             return 16;  // <30 mph, city
  if (speedMs < 22)             return 15;  // <50 mph, suburban
  if (speedMs < 35)             return 14;  // highway
  return 13;                                // freeway
}

// Format ETA as clock time: "3:42 PM"
function etaClockTime(mins: number): string {
  const d = new Date(Date.now() + mins * 60000);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
}

// Returns [preview_m, prepare_m, action_m] announcement distances.
// preview ~60s out (first warning), prepare ~15s (lane-change time), action ~5s (turn now).
// modifier adjusts for turn severity: sharp/U-turn = more lead; slight/merge = less.
function announceDists(speedMph: number | null, modifier?: string): [number, number, number] {
  const mph = Math.max(0, speedMph ?? 0);
  const ms  = mph * 0.44704;
  const preview = Math.max(400,  Math.min(2500, ms * 60));
  const prepare = Math.max(120,  Math.min(600,  ms * 15));
  const action  = Math.max(28,   Math.min(100,  ms * 5));
  const mod  = (modifier ?? '').toLowerCase();
  const mult = mod === 'uturn'                        ? 1.5
             : mod.includes('sharp')                  ? 1.25
             : mod.includes('slight')                 ? 0.85
             : mod === '' || mod === 'straight'        ? 0.6
             : 1.0;
  return [
    Math.round(preview * mult),
    Math.round(Math.max(80,  prepare * mult)),
    Math.round(Math.max(20,  action  * Math.min(mult, 1.2))),
  ];
}

// Natural-language distance for TTS — never reads abbreviations aloud
function speakDist(metres: number): string {
  const ft = metres * 3.28084;
  const mi = metres * 0.000621371;
  if (metres < 30)   return 'now';
  if (ft < 200)      return `${Math.round(ft / 25) * 25} feet`;
  if (ft < 600)      return `${Math.round(ft / 50) * 50} feet`;
  if (ft < 1000)     return `${Math.round(ft / 100) * 100} feet`;
  if (mi < 0.35)     return 'a quarter mile';
  if (mi < 0.65)     return 'half a mile';
  if (mi < 0.85)     return 'three quarters of a mile';
  if (mi < 1.15)     return '1 mile';
  return `${mi.toFixed(mi >= 10 ? 0 : 1)} miles`;
}

// ─── Maneuver helpers ─────────────────────────────────────────────────────────

function stepIcon(type: string, modifier: string): string {
  if (type === 'arrive') return 'flag-outline';
  if (type === 'depart') return 'navigate-outline';
  if (type === 'roundabout' || type === 'rotary') return 'refresh-outline';
  const m = modifier.toLowerCase();
  if (m === 'uturn') return 'refresh-outline';
  if (m === 'sharp left')   return 'arrow-undo-outline';
  if (m === 'left')         return 'return-up-back-outline';
  if (m === 'slight left')  return 'arrow-back-outline';
  if (m === 'sharp right')  return 'arrow-redo-outline';
  if (m === 'right')        return 'return-up-forward-outline';
  if (m === 'slight right') return 'arrow-forward-outline';
  return 'arrow-up-outline';
}

function stepLabel(type: string, modifier: string, name?: string): string {
  if (type === 'arrive') return 'ARRIVE';
  if (type === 'depart') return 'DEPART';
  if (type === 'roundabout') return 'ROUNDABOUT';
  const m = modifier.toLowerCase();
  const isExit = name ? /exit|ramp|off.?ramp/i.test(name) : false;
  if (m === 'uturn') return 'MAKE U-TURN';
  if (m === 'sharp left')   return 'TURN SHARP LEFT';
  if (m === 'sharp right')  return 'TURN SHARP RIGHT';
  if (m === 'slight left')  return isExit ? 'TAKE EXIT LEFT'  : 'KEEP LEFT';
  if (m === 'slight right') return isExit ? 'TAKE EXIT RIGHT' : 'KEEP RIGHT';
  if (m === 'left')         return 'TURN LEFT';
  if (m === 'right')        return 'TURN RIGHT';
  return 'CONTINUE STRAIGHT';
}

function laneArrowIcon(indication: string): string {
  const map: Record<string, string> = {
    'left': 'arrow-back-outline', 'slight left': 'arrow-back-outline',
    'sharp left': 'arrow-back-outline', 'straight': 'arrow-up-outline',
    'right': 'arrow-forward-outline', 'slight right': 'arrow-forward-outline',
    'sharp right': 'arrow-forward-outline', 'uturn': 'return-down-back-outline',
  };
  return map[indication.toLowerCase()] ?? 'arrow-up-outline';
}

// Conversational spoken maneuver label (never all-caps, no abbreviations)
function stepSpeak(type: string, modifier: string, name?: string): string {
  const m = (modifier ?? '').toLowerCase();
  const isExit = name ? /exit|ramp|off.?ramp|i-\d|interstate/i.test(name) : false;
  if (type === 'arrive')    return 'arrive at your destination';
  if (type === 'depart')    return 'proceed toward the route';
  if (type === 'on ramp')   return `take the ramp${m.includes('right') ? ' on your right' : m.includes('left') ? ' on your left' : ''}`;
  if (type === 'off ramp')  return `take the exit${m.includes('right') ? ' on your right' : m.includes('left') ? ' on your left' : ''}`;
  if (type === 'merge')     return `merge ${m.includes('right') ? 'right' : m.includes('left') ? 'left' : 'onto the highway'}`;
  if (type === 'fork')      return `keep ${m.includes('right') ? 'right' : 'left'} at the fork`;
  if (type === 'roundabout' || type === 'rotary') return 'take the roundabout';
  if (type === 'end of road') return `turn ${m.includes('right') ? 'right' : 'left'} at the end of the road`;
  if (m === 'uturn')        return 'make a U-turn when safe';
  if (m === 'sharp left')   return 'turn sharply left';
  if (m === 'sharp right')  return 'turn sharply right';
  if (m === 'slight left')  return isExit ? 'take the exit on your left'  : 'keep left';
  if (m === 'slight right') return isExit ? 'take the exit on your right' : 'keep right';
  if (m === 'left')         return 'turn left';
  if (m === 'right')        return 'turn right';
  return 'continue straight';
}

// Generate lane guidance voice phrase from lane data
function laneSpeakPhrase(lanes: RouteStep['lanes']): string {
  if (!lanes?.length) return '';
  const valid = lanes.filter(l => l.valid);
  if (!valid.length) return '';
  const total = lanes.length;
  const validCount = valid.length;
  // Determine which side the valid lanes are on
  const allIndications = valid.flatMap(l => l.indications ?? []);
  const hasRight  = allIndications.some(i => i.includes('right') || i === 'straight');
  const hasLeft   = allIndications.some(i => i.includes('left'));
  const hasStr    = allIndications.some(i => i === 'straight');
  if (validCount === total) return ''; // all lanes valid — no guidance needed
  if (hasRight && !hasLeft) {
    return validCount === 1 ? 'Use the right lane. ' : `Keep right and use the ${validCount === 2 ? 'two right lanes' : 'right lanes'}. `;
  }
  if (hasLeft && !hasRight && !hasStr) {
    return validCount === 1 ? 'Use the left lane. ' : `Keep left and use the ${validCount === 2 ? 'two left lanes' : 'left lanes'}. `;
  }
  if (hasStr && !hasRight && !hasLeft) return 'Keep straight. ';
  return '';
}

// Build spoken announcement from step — natural, not robotic.
// phase 'far'=preview warning, 'near'=prepare/lane-change, 'action'=turn now (no distance)
function buildAnnouncement(step: RouteStep, distM: number, phase: 'far' | 'near' | 'action'): string {
  const type     = step.type     ?? 'turn';
  const modifier = (step.modifier ?? '').toLowerCase();
  const action   = stepSpeak(type, modifier, step.name);
  const road     = step.name ? ` on ${step.name}` : '';
  const laneHint = phase !== 'far' ? laneSpeakPhrase(step.lanes) : '';
  const isAction = phase === 'action';

  if (type === 'arrive') {
    return isAction ? `Arriving at your destination.`
         : phase === 'near' ? `You will arrive in ${speakDist(distM)}.`
         : `You'll arrive at your destination in ${speakDist(distM)}.`;
  }
  if (type === 'on ramp')  return isAction ? `${laneHint}Take the ramp${road}.`                    : phase === 'near' ? `${laneHint}Take the ramp${road}.`                    : `In ${speakDist(distM)}, take the ramp${road}.`;
  if (type === 'off ramp') return isAction ? `${laneHint}Take the exit${road}.`                   : phase === 'near' ? `${laneHint}Take the exit${road}.`                   : `In ${speakDist(distM)}, take the exit${road}.`;
  if (type === 'end of road') {
    // Stop sign / T-intersection — driver must stop, needs clear command
    return isAction ? `${laneHint}${action}${road}.`
         : phase === 'near' ? `${laneHint}In ${speakDist(distM)}, ${action}${road}.`
         : `In ${speakDist(distM)}, ${action} at the intersection${road}.`;
  }
  if (type === 'merge') {
    const side = modifier.includes('right') ? 'right' : modifier.includes('left') ? 'left' : '';
    return isAction ? `Merge ${side}${road}.` : phase === 'near' ? `Merge ${side}${road}.` : `In ${speakDist(distM)}, merge ${side}${road}.`;
  }
  if (type === 'fork') {
    const side = modifier.includes('right') ? 'right' : modifier.includes('left') ? 'left' : '';
    return isAction ? `${laneHint}Keep ${side} at the fork${road}.` : phase === 'near' ? `${laneHint}Keep ${side} at the fork${road}.` : `In ${speakDist(distM)}, keep ${side} at the fork${road}.`;
  }
  if (type === 'roundabout' || type === 'rotary') {
    return isAction ? `Enter the roundabout.` : phase === 'near' ? `In ${speakDist(distM)}, enter the roundabout.` : `In ${speakDist(distM)}, enter the roundabout.`;
  }
  const isStraight = modifier === '' || modifier === 'straight';
  if (isStraight) {
    if (isAction) return `${laneHint}Keep straight${road}.`;
    if (phase === 'far') return step.name ? `Stay on ${step.name} for ${speakDist(distM)}.` : `Continue for ${speakDist(distM)}.`;
    return `${laneHint}Keep straight${road}.`;
  }
  // Standard turn
  if (isAction)       return `${laneHint}${action}${road}.`;
  if (phase === 'near') return `${laneHint}In ${speakDist(distM)}, ${action}${road}.`;
  return `In ${speakDist(distM)}, ${action}${road}.`;
}

// ─── Offline tile estimation ──────────────────────────────────────────────────
function ll2tile(lat: number, lng: number, z: number): { x: number; y: number } {
  const x = Math.floor((lng + 180) / 360 * Math.pow(2, z));
  const s = Math.sin(lat * Math.PI / 180);
  const y = Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * Math.pow(2, z));
  return { x: Math.max(0, x), y: Math.max(0, y) };
}
function estimateTileCount(n: number, s: number, e: number, w: number, minZ: number, maxZ: number): number {
  let count = 0;
  for (let z = minZ; z <= maxZ; z++) {
    const cap = Math.pow(2, z) - 1;
    const nw = ll2tile(n, w, z); const se = ll2tile(s, e, z);
    count += Math.max(0, Math.min(cap, se.x) - Math.max(0, nw.x) + 1) *
             Math.max(0, Math.min(cap, se.y) - Math.max(0, nw.y) + 1);
  }
  return count;
}
function tilesMB(count: number, maxZ: number, vectorOnly = false): string {
  const avgKB = vectorOnly
    ? (maxZ >= 15 ? 10 : maxZ >= 13 ? 8 : 5)
    : (maxZ >= 15 ? 130 : maxZ >= 13 ? 85 : maxZ >= 11 ? 40 : 20);
  const mb = (count * avgKB) / 1024;
  if (mb < 1) return '<1 MB';
  if (mb >= 1024) return `~${(mb / 1024).toFixed(1)} GB`;
  if (mb >= 100) return `~${Math.round(mb / 50) * 50} MB`;
  return `~${Math.round(mb)} MB`;
}

// ─── Quick-report types with Waze-style subtypes ─────────────────────────────
const QUICK_TYPES = [
  { type: 'police',       label: 'PATROL',  icon: 'shield-outline',     color: '#eab308',
    subtypes: ['Police hidden', 'Police visible', 'Speed trap', 'Ranger patrol'] },
  { type: 'hazard',       label: 'HAZARD',  icon: 'warning-outline',    color: '#ef4444',
    subtypes: ['Object in road', 'Pothole', 'Flood / water', 'Ice / snow', 'Downed tree'] },
  { type: 'road_condition', label: 'ROAD',  icon: 'trail-sign-outline', color: '#f97316',
    subtypes: ['Muddy / soft', 'Washed out road', 'Deep ruts', 'Low clearance', 'Logging traffic'] },
  { type: 'wildlife',     label: 'ANIMAL',  icon: 'paw-outline',        color: '#a855f7',
    subtypes: ['Animal in road', 'Livestock loose', 'Bear / predator', 'Deer herd', 'Animal sighting'] },
] as const;

const COMMUNITY_PIN_TYPES = [
  { id: 'camp', label: 'Camp', icon: 'bonfire-outline', color: '#16a34a', group: 'Camps' },
  { id: 'informal_camp', label: 'Informal', icon: 'business-outline', color: '#65a30d', group: 'Camps' },
  { id: 'wild_camp', label: 'Wild Camp', icon: 'moon-outline', color: '#15803d', group: 'Camps' },
  { id: 'fuel', label: 'Gas', icon: 'flash-outline', color: '#ea580c', group: 'Services' },
  { id: 'propane', label: 'Propane', icon: 'flame-outline', color: '#f97316', group: 'Services' },
  { id: 'water', label: 'Water', icon: 'water-outline', color: '#0284c7', group: 'Services' },
  { id: 'dump', label: 'Dump', icon: 'trash-bin-outline', color: '#a16207', group: 'Services' },
  { id: 'parking', label: 'Parking', icon: 'car-outline', color: '#d97706', group: 'Services' },
  { id: 'mechanic', label: 'Mechanic', icon: 'construct-outline', color: '#f97316', group: 'Services' },
  { id: 'restaurant', label: 'Food', icon: 'restaurant-outline', color: '#06b6d4', group: 'Community' },
  { id: 'attraction', label: 'POI', icon: 'camera-outline', color: '#0ea5e9', group: 'Community' },
  { id: 'shopping', label: 'Shop', icon: 'cart-outline', color: '#06b6d4', group: 'Community' },
  { id: 'medical', label: 'Medical', icon: 'medical-outline', color: '#06b6d4', group: 'Community' },
  { id: 'pet', label: 'Pet', icon: 'paw-outline', color: '#06b6d4', group: 'Community' },
  { id: 'laundromat', label: 'Laundry', icon: 'shirt-outline', color: '#06b6d4', group: 'Community' },
  { id: 'shower', label: 'Shower', icon: 'rainy-outline', color: '#06b6d4', group: 'Community' },
  { id: 'wifi', label: 'Wifi', icon: 'wifi-outline', color: '#06b6d4', group: 'Community' },
  { id: 'checkpoint', label: 'Checkpoint', icon: 'hand-left-outline', color: '#dc2626', group: 'Road' },
  { id: 'road_report', label: 'Road', icon: 'trail-sign-outline', color: '#dc2626', group: 'Road' },
  { id: 'warning', label: 'Warning', icon: 'warning-outline', color: '#ef4444', group: 'Road' },
  { id: 'other', label: 'Other', icon: 'star-outline', color: '#38bdf8', group: 'Community' },
] as const;

type CommunityPinTypeId = typeof COMMUNITY_PIN_TYPES[number]['id'];

function communityPinMeta(type?: string) {
  return COMMUNITY_PIN_TYPES.find(t => t.id === type) ?? COMMUNITY_PIN_TYPES[COMMUNITY_PIN_TYPES.length - 1];
}

// ─── Land type color helper ──────────────────────────────────────────────────

function landColor(lt: string) {
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
  if (t === 'rv' || t === 'hookups') return '🚐';
  if (t === 'tent') return '⛺';
  if (t === 'dispersed') return '🌲';
  if (t === 'water') return '💧';
  if (t === 'showers') return '🚿';
  if (t === 'ada') return '♿';
  if (t === 'dogs' || t === 'dog friendly') return '🐾';
  if (t === 'free') return '🆓';
  if (t === 'reservable') return '📅';
  if (t === 'usfs') return '🌲';
  if (t === 'blm') return '🏜️';
  if (t === 'nps') return '🏔️';
  return '•';
}

function weatherIcon(code: number): string {
  if (code === 0) return '☀️';
  if (code <= 2) return '⛅';
  if (code <= 48) return '☁️';
  if (code <= 67) return '🌧️';
  if (code <= 77) return '❄️';
  if (code <= 82) return '🌦️';
  return '⛈️';
}

function rigCompatibility(camp: CampsitePin, rig: import('@/lib/store').RigProfile | null): { ok: boolean; msg: string } | null {
  if (!rig) return null;
  const tags = Array.isArray(camp.tags) ? camp.tags : [];
  const desc = (camp.description || '').toLowerCase();
  const needsHighClear = desc.includes('high clearance') || desc.includes('4wd') || desc.includes('4-wheel') || desc.includes('rough road');
  const clearance = parseFloat(rig.ground_clearance_in || '0');
  const drive = (rig.drive || '').toLowerCase();
  const length = parseFloat(rig.length_ft || '0');
  const isTowing = rig.is_towing;
  const trailerLen = parseFloat(rig.trailer_length_ft || '0');
  const totalLen = length + (isTowing ? trailerLen : 0);

  if (tags.includes('walk_in')) return { ok: false, msg: '🚶 WALK-IN ONLY' };
  if (needsHighClear && drive === '2wd') return { ok: false, msg: '⚠️ 4WD RECOMMENDED' };
  if (needsHighClear && clearance > 0 && clearance < 8.5) return { ok: false, msg: `⚠️ CHECK CLEARANCE (${clearance}")` };
  if (isTowing && totalLen > 28 && !tags.includes('rv')) return { ok: false, msg: `⚠️ TIGHT FOR ${Math.round(totalLen)}' RIG` };
  if (isTowing && tags.includes('rv')) return { ok: true, msg: '✅ RV/TRAILER OK' };
  if (tags.includes('rv') && !isTowing) return { ok: true, msg: '⛺ TENT & RV OK' };
  return { ok: true, msg: '✅ RIG COMPATIBLE' };
}

// ─── Map HTML ─────────────────────────────────────────────────────────────────

// Map mode names sent to the WebView. The WebView builds its own MapLibre style
// from these — no external style URLs (Mapbox tiles are now satellite-only).
const MAP_MODES: Record<string, string> = {
  satellite: 'satellite',
  topo:      'topo',
  hybrid:    'hybrid',
};

const buildMapHtml = (
  centerLat: number, centerLng: number,
  waypoints: WP[],
  campsites: { lat: number; lng: number; name: string }[],
  gasList:   { lat: number; lng: number; name: string }[],
  pins:      { lat: number; lng: number; name: string; type: string }[],
) => /* html */`<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no">
<script src='https://tiles.gettrailhead.app/assets/maplibre-gl.js'></script>
<link href='https://tiles.gettrailhead.app/assets/maplibre-gl.css' rel='stylesheet'/>
<style>
  body,html{margin:0;padding:0;height:100%;background:#080c12;overflow:hidden;}
  #map{height:100vh;width:100vw;}
  .maplibregl-popup-content{background:#0f1319!important;border:1px solid #252d3d!important;color:#f1f5f9!important;border-radius:10px!important;padding:12px 14px!important;box-shadow:0 4px 20px rgba(0,0,0,0.7)!important;min-width:160px;}
  .maplibregl-popup-tip{border-top-color:#252d3d!important;border-bottom-color:#252d3d!important;}
  .maplibregl-popup-close-button{color:#6b7280!important;font-size:16px!important;right:4px!important;top:2px!important;}
  .maplibregl-ctrl-logo,.maplibregl-ctrl-attrib{display:none!important;}
  .mk-wp{background:#f97316;border:2.5px solid #fff;border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:12px;font-family:monospace;box-shadow:0 2px 10px rgba(249,115,22,0.6);cursor:pointer;user-select:none;}
  .mk-wp.nav-target{background:#fff;color:#f97316;animation:pulse 1.4s ease-in-out infinite;}
  .mk-wp.wp-start{background:#22c55e;box-shadow:0 2px 10px rgba(34,197,94,0.6);}
  .mk-wp.wp-motel{background:#6366f1;box-shadow:0 2px 10px rgba(99,102,241,0.6);}
  .mk-wp.wp-town{background:#94a3b8;box-shadow:0 2px 10px rgba(148,163,184,0.4);}
  .mk-wp.wp-fuel{background:#eab308;box-shadow:0 2px 10px rgba(234,179,8,0.6);}
  .mk-wp.wp-waypoint{background:#a855f7;box-shadow:0 2px 10px rgba(168,85,247,0.6);}
  .mk-wp.wp-shower{background:#38bdf8;box-shadow:0 2px 10px rgba(56,189,248,0.5);}
  .mk-wp.wp-camp{background:#14b8a6;box-shadow:0 2px 10px rgba(20,184,166,0.6);}
  .mk-wp.nav-target.wp-motel{color:#6366f1;}
  .mk-wp.nav-target.wp-fuel{color:#eab308;}
  .mk-wp.nav-target.wp-start{color:#22c55e;}
  .mk-wp.nav-target.wp-waypoint{color:#a855f7;}
  .mk-wp.nav-target.wp-camp{color:#14b8a6;}
  @keyframes pulse{0%,100%{box-shadow:0 0 0 4px rgba(249,115,22,0.45);}50%{box-shadow:0 0 0 12px rgba(249,115,22,0.1);}}
  .mk-me{width:44px;height:44px;display:flex;align-items:center;justify-content:center;position:relative;pointer-events:none;}
  .mk-me-ring{position:absolute;width:44px;height:44px;border-radius:50%;background:rgba(249,115,22,0.1);border:1.5px solid rgba(249,115,22,0.4);animation:loc-pulse 2s ease-in-out infinite;transition:opacity 0.4s,width 0.4s,height 0.4s;}
  .mk-me-arrow{filter:drop-shadow(0 2px 5px rgba(0,0,0,0.6)) drop-shadow(0 0 8px rgba(249,115,22,0.6));}
  @keyframes loc-pulse{0%,100%{transform:scale(1);opacity:0.9;}50%{transform:scale(1.7);opacity:0.15;}}
  /* In nav mode: shrink ring to a tight clean outline, no pulsing */
  .mk-me.nav-active .mk-me-ring{animation:none;width:28px;height:28px;opacity:0.5;background:transparent;}
  .mk-search{background:rgba(59,130,246,0.2);border:2.5px solid #3b82f6;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:17px;}
  /* search-this-area button moved to React Native for reliable touch handling */
  #loading{position:fixed;top:0;left:0;right:0;bottom:0;background:#080c12;display:flex;align-items:center;justify-content:center;z-index:200;flex-direction:column;gap:12px;}
  #loading.hidden{display:none;}
  .ld{width:8px;height:8px;background:#f97316;border-radius:50%;animation:ld 1.2s infinite;}
  .ld:nth-child(2){animation-delay:.2s}.ld:nth-child(3){animation-delay:.4s}
  @keyframes ld{0%,80%,100%{transform:scale(.3);opacity:.3}40%{transform:scale(1);opacity:1}}
  .pt{font-weight:700;font-size:13px;margin-bottom:4px;}
  .pm{color:#6b7280;font-size:11px;font-family:monospace;}
  .mk-rep{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;border:2.5px solid rgba(255,255,255,0.7);box-shadow:0 2px 10px rgba(0,0,0,0.45);cursor:pointer;user-select:none;transition:transform .15s;}
  .mk-rep:hover{transform:scale(1.15);}
  .mk-rep-police{background:#eab308dd;box-shadow:0 2px 10px rgba(234,179,8,0.6);}
  .mk-rep-hazard{background:#ef4444dd;box-shadow:0 2px 10px rgba(239,68,68,0.6);}
  .mk-rep-road_condition{background:#f97316dd;box-shadow:0 2px 10px rgba(249,115,22,0.6);}
  .mk-rep-wildlife{background:#a855f7dd;box-shadow:0 2px 10px rgba(168,85,247,0.6);}
  .mk-rep-campsite{background:#22c55edd;box-shadow:0 2px 10px rgba(34,197,94,0.5);}
  .mk-rep-road_closure{background:#dc2626dd;box-shadow:0 2px 10px rgba(220,38,38,0.6);}
  .mk-rep-water{background:#38bdf8dd;box-shadow:0 2px 10px rgba(56,189,248,0.5);}
</style>
</head>
<body>
<div id="map"></div>
<div id="loading"><div style="display:flex;gap:6px"><div class="ld"></div><div class="ld"></div><div class="ld"></div></div><div style="color:#4b5563;font-family:monospace;font-size:10px;letter-spacing:.1em;margin-top:4px">LOADING MAP</div></div>
<script>
(function(){
  var wps=${JSON.stringify(waypoints)};
  var initGas=${JSON.stringify(gasList.slice(0,20))};
  var initPins=${JSON.stringify(pins.slice(0,30))};

  var map,mapboxToken='',apiBase='https://api.gettrailhead.app',currentStyle='satellite';
  var tileBase='https://tiles.gettrailhead.app';
  // Protomaps API key — set via set_token from RN. When present we fetch tiles
  // directly from Protomaps' CDN (faster); otherwise fall back to our backend
  // proxy at apiBase + '/api/tiles/'.
  var protomapsKey='';
  var userMarker=null,wpMarkers=[],searchMarker=null;
  var allCamps=[],allGas=[],allPois=[],allReports=[];
  var reportMarkers=[];
  var lastSpeed=null;
  var _routeLoading=false;
  var routeIsProper=false;
  var showLandOverlay=false,showUsgsOverlay=false;
  var showTerrainLayer=false,showNaipLayer=false,showFireLayer=false,showAvaLayer=false,showRadarLayer=false,showMvumLayer=false,showRoadsLayer=false;
  var radarFrames=[],radarFrameIdx=0,radarTimer=null;
  var _mvumTimer=null,_roadsTimer=null;
  var routeOpts={avoidTolls:false,avoidHighways:false,backRoads:false,noFerries:false};
  var _routeCoords=[],routePts=[],breadcrumbPts=[];
  var lastOffCheck=0,downloadActive=false,mapReady=false,pendingMsgs=[];
  var _searchDest=null; // {lat,lng} for single-dest nav so reroute works

  // ── Dynamic layer functions ───────────────────────────────────────────────────
  function setTerrainLayer(show){showTerrainLayer=show;if(!map||!mapReady)return;if(show){if(!mapboxToken)return;if(!map.getSource('mapbox-dem'))map.addSource('mapbox-dem',{type:'raster-dem',tiles:['https://api.mapbox.com/raster/v1/mapbox.mapbox-terrain-dem-v1/{z}/{x}/{y}.webp?access_token='+mapboxToken],encoding:'mapbox',tileSize:512,maxzoom:14});map.setTerrain({source:'mapbox-dem',exaggeration:1.5});var bl=map.getLayer('water-name')?'water-name':undefined;if(!map.getLayer('hillshade'))map.addLayer({id:'hillshade',type:'hillshade',source:'mapbox-dem',paint:{'hillshade-shadow-color':'#473B24','hillshade-illumination-anchor':'viewport','hillshade-exaggeration':0.5}},bl);}else{if(map.getLayer('hillshade'))map.removeLayer('hillshade');map.setTerrain(null);if(map.getSource('mapbox-dem'))map.removeSource('mapbox-dem');}}

  function setNaipLayer(show){showNaipLayer=show;if(!map||!mapReady)return;if(show){if(!map.getSource('naip'))map.addSource('naip',{type:'raster',tiles:['https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}'],tileSize:256,maxzoom:19,attribution:'USGS NAIP'});if(!map.getLayer('naip-layer'))map.addLayer({id:'naip-layer',type:'raster',source:'naip',paint:{'raster-opacity':0.85}},map.getLayer('water-name')?'water-name':undefined);}else{if(map.getLayer('naip-layer'))map.removeLayer('naip-layer');if(map.getSource('naip'))map.removeSource('naip');}}

  function setFireLayer(show){showFireLayer=show;if(!map||!mapReady)return;if(show){if(!map.getSource('fires')){map.addSource('fires',{type:'geojson',data:{type:'FeatureCollection',features:[]}});fetch('https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/Current_WildlandFire_Perimeters/FeatureServer/0/query?where=1%3D1&outFields=IncidentName%2CContainment%2CGISAcres&returnGeometry=true&f=geojson&resultRecordCount=500').then(function(r){return r.json();}).then(function(d){if(map.getSource('fires'))map.getSource('fires').setData(d);}).catch(function(){});}if(!map.getLayer('fires-fill'))map.addLayer({id:'fires-fill',type:'fill',source:'fires',paint:{'fill-color':'#dc2626','fill-opacity':0.3}},map.getLayer('water-name')?'water-name':undefined);if(!map.getLayer('fires-line'))map.addLayer({id:'fires-line',type:'line',source:'fires',paint:{'line-color':'#ef4444','line-width':1.5,'line-opacity':0.85}});}else{['fires-line','fires-fill'].forEach(function(l){if(map.getLayer(l))map.removeLayer(l);});if(map.getSource('fires'))map.removeSource('fires');}}

  function setAvaLayer(show){showAvaLayer=show;if(!map||!mapReady)return;if(show){if(!map.getSource('ava')){map.addSource('ava',{type:'geojson',data:{type:'FeatureCollection',features:[]}});fetch('https://api.avalanche.org/v2/public/products/map-layer').then(function(r){return r.json();}).then(function(d){if(map.getSource('ava'))map.getSource('ava').setData(d);}).catch(function(){});}if(!map.getLayer('ava-fill'))map.addLayer({id:'ava-fill',type:'fill',source:'ava',paint:{'fill-color':['match',['get','danger_level'],'1','#50C878','2','#FFD700','3','#FF8C00','4','#E63946','5','#1a0a0a','#888888'],'fill-opacity':0.45}},map.getLayer('water-name')?'water-name':undefined);if(!map.getLayer('ava-line'))map.addLayer({id:'ava-line',type:'line',source:'ava',paint:{'line-color':['match',['get','danger_level'],'1','#50C878','2','#FFD700','3','#FF8C00','4','#E63946','5','#1a0a0a','#888888'],'line-width':1.5}});}else{['ava-line','ava-fill'].forEach(function(l){if(map.getLayer(l))map.removeLayer(l);});if(map.getSource('ava'))map.removeSource('ava');}}

  function setRadarLayer(show){showRadarLayer=show;if(!map||!mapReady)return;if(radarTimer){clearInterval(radarTimer);radarTimer=null;}if(map.getLayer('radar-layer'))map.removeLayer('radar-layer');if(map.getSource('radar'))map.removeSource('radar');if(!show)return;fetch('https://api.rainviewer.com/public/weather-maps.json').then(function(r){return r.json();}).then(function(d){radarFrames=(d.radar&&d.radar.past)||[];if(!radarFrames.length)return;radarFrameIdx=radarFrames.length-1;var ts=radarFrames[radarFrameIdx].time;map.addSource('radar',{type:'raster',tiles:['https://tilecache.rainviewer.com/v2/radar/'+ts+'/256/{z}/{x}/{y}/2/1_1.png'],tileSize:256});map.addLayer({id:'radar-layer',type:'raster',source:'radar',paint:{'raster-opacity':0.65}});radarTimer=setInterval(function(){if(!showRadarLayer||!map.getSource('radar'))return;radarFrameIdx=(radarFrameIdx+1)%radarFrames.length;map.getSource('radar').setTiles(['https://tilecache.rainviewer.com/v2/radar/'+radarFrames[radarFrameIdx].time+'/256/{z}/{x}/{y}/2/1_1.png']);},900);}).catch(function(){});}

  function _fetchMvum(){if(!showMvumLayer||!map)return;var b=map.getBounds();var bbox=b.getWest()+','+b.getSouth()+','+b.getEast()+','+b.getNorth();var base='https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MVUM_01/MapServer/';var rUrl=base+'1/query?where=1%3D1&geometry='+encodeURIComponent(bbox)+'&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326&outFields=MVUM_NAME%2CSYSTEM%2CPASSENGER_VEHICLE%2CHIGH_CLEARANCE_VEHICLE&returnGeometry=true&f=geojson&resultRecordCount=2000';var tUrl=base+'2/query?where=1%3D1&geometry='+encodeURIComponent(bbox)+'&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326&outFields=TRAIL_NAME%2CTRAIL_SURFACE&returnGeometry=true&f=geojson&resultRecordCount=2000';Promise.all([fetch(rUrl).then(function(r){return r.json();}),fetch(tUrl).then(function(r){return r.json();})]).then(function(res){if(map.getSource('mvum-roads'))map.getSource('mvum-roads').setData(res[0]);if(map.getSource('mvum-trails'))map.getSource('mvum-trails').setData(res[1]);}).catch(function(){});}

  function setMvumLayer(show){showMvumLayer=show;if(!map||!mapReady)return;if(show){if(!map.getSource('mvum-roads'))map.addSource('mvum-roads',{type:'geojson',data:{type:'FeatureCollection',features:[]}});if(!map.getSource('mvum-trails'))map.addSource('mvum-trails',{type:'geojson',data:{type:'FeatureCollection',features:[]}});if(!map.getLayer('mvum-roads-line'))map.addLayer({id:'mvum-roads-line',type:'line',source:'mvum-roads',paint:{'line-color':['case',['==',['get','PASSENGER_VEHICLE'],'YES'],'#22c55e',['==',['get','HIGH_CLEARANCE_VEHICLE'],'YES'],'#f97316','#ef4444'],'line-width':2.5,'line-opacity':0.85}});if(!map.getLayer('mvum-trails-line'))map.addLayer({id:'mvum-trails-line',type:'line',source:'mvum-trails',paint:{'line-color':'#a855f7','line-width':1.5,'line-opacity':0.8,'line-dasharray':[3,2]}});_fetchMvum();}else{['mvum-trails-line','mvum-roads-line'].forEach(function(l){if(map.getLayer(l))map.removeLayer(l);});['mvum-trails','mvum-roads'].forEach(function(s){if(map.getSource(s))map.removeSource(s);});}}

  function _fetchRoads(){if(!showRoadsLayer||!map||map.getZoom()<9)return;var b=map.getBounds();var bbox=b.getSouth()+','+b.getWest()+','+b.getNorth()+','+b.getEast();var q='[out:json][bbox:'+bbox+'];(way["highway"]["surface"~"unpaved|gravel|dirt|ground|sand|mud"];way["highway"]["4wd_only"="yes"];way["highway"]["smoothness"~"bad|very_bad|horrible|very_horrible|impassable"];);out geom;';fetch('https://overpass-api.de/api/interpreter',{method:'POST',body:'data='+encodeURIComponent(q)}).then(function(r){return r.json();}).then(function(d){var features=(d.elements||[]).filter(function(el){return el.type==='way'&&el.geometry;}).map(function(el){return{type:'Feature',geometry:{type:'LineString',coordinates:el.geometry.map(function(n){return[n.lon,n.lat];})},properties:{surface:(el.tags&&el.tags.surface)||'unpaved',name:(el.tags&&el.tags.name)||''}};});if(map.getSource('oroads'))map.getSource('oroads').setData({type:'FeatureCollection',features:features});}).catch(function(){});}

  function setRoadsLayer(show){showRoadsLayer=show;if(!map||!mapReady)return;if(show){if(!map.getSource('oroads'))map.addSource('oroads',{type:'geojson',data:{type:'FeatureCollection',features:[]}});if(!map.getLayer('oroads-line'))map.addLayer({id:'oroads-line',type:'line',source:'oroads',paint:{'line-color':['match',['get','surface'],'gravel','#eab308','dirt','#f97316','ground','#a16207','sand','#d97706','mud','#92400e','#dc2626'],'line-width':2,'line-opacity':0.9}});_fetchRoads();}else{if(map.getLayer('oroads-line'))map.removeLayer('oroads-line');if(map.getSource('oroads'))map.removeSource('oroads');}}

  function postRN(o){try{window.ReactNativeWebView.postMessage(JSON.stringify(o));}catch(e){}}

  // ── Offline tile cache via Cache API + fetch intercept ────────────────────────
  // Auto-caches every vector tile, font, and satellite raster the WebView fetches.
  // Vector tiles come from our backend (apiBase + /api/tiles/...) so the entire
  // world's road/trail/landuse data is reachable without selective region downloads.
  // Satellite imagery still requires Mapbox (online-only) but is cached when viewed.
  var TILE_CACHE='trailhead-tiles-v3';
  var _origFetch=window.fetch.bind(window);
  window.fetch=async function(input,init){
    var url=typeof input==='string'?input:(input&&input.url?input.url:'');
    var isTile=url&&(
      url.indexOf('api.mapbox.com/v4/')>=0||
      url.indexOf('api.mapbox.com/raster/')>=0||
      url.indexOf('api.mapbox.com/fonts/')>=0||
      url.indexOf('api.mapbox.com/sprites/')>=0||
      url.indexOf('api.protomaps.com/tiles/')>=0||
      url.indexOf('protomaps.github.io/basemaps-assets/')>=0||
      url.indexOf('/api/tiles/')>=0||
      url.indexOf('/api/fonts/')>=0||
      url.indexOf('basemap.nationalmap.gov')>=0
    );
    if(isTile){
      try{
        // Strip both Mapbox access_token AND Protomaps key from the cache key
        // so the same tile cached once serves all rotation states of the key.
        var cacheKey=url.replace(/access_token=[^&]*/,'access_token=_').replace(/[?&]key=[^&]*/,function(m){return m[0]+'key=_';});
        var c=await caches.open(TILE_CACHE);
        var hit=await c.match(cacheKey);
        if(hit)return hit;
        var resp=await _origFetch(input,init);
        if(resp&&resp.ok){c.put(cacheKey,resp.clone());}
        return resp;
      }catch(e){try{return await _origFetch(input,init);}catch(e2){throw e2;}}
    }
    return _origFetch(input,init);
  };

  // ── MapLibre outdoor style ────────────────────────────────────────────────────
  // Vector tiles served by our self-hosted backend (reads from /data/us.pmtiles
  // on Railway — no per-tile API cost, no upstream latency). Glyphs come direct
  // from Protomaps' static GitHub assets. Optional Mapbox satellite raster
  // overlay when in satellite/hybrid mode and token is available.
  function _tileUrl(){
    return tileBase+'/api/tiles/{z}/{x}/{y}.pbf';
  }
  function _glyphUrl(){
    return tileBase+'/api/fonts/{fontstack}/{range}.pbf';
  }
  function buildStyle(mode){
    var sources={
      pm:{type:'vector',tiles:[_tileUrl()],maxzoom:15,attribution:'© OpenStreetMap'}
    };
    if((mode==='satellite'||mode==='hybrid')&&mapboxToken){
      sources['sat']={type:'raster',tiles:['https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token='+mapboxToken],tileSize:512,maxzoom:19};
    }
    var labelOpacity=mode==='satellite'?0.0:1.0; // pure satellite hides vector labels
    // Polished dark outdoor palette — modeled on Protomaps' official dark theme
    // but tuned warmer for an overlanding feel. All filters use the real
    // Protomaps tiles v4 property "kind" (not pmap:kind).
    var hidden=mode==='satellite';
    var sat=mode==='satellite', hyb=mode==='hybrid';
    var roadOpacity=sat?0.0:1.0;
    var labelOpacity=sat?0.0:1.0;
    var fillOpacity=sat?0.0:(hyb?0.40:1.0);
    var lwHalo=sat?'rgba(0,0,0,0.85)':'#1c1f26';
    var layers=[
      {id:'bg',type:'background',paint:{'background-color':sat?'#000':'#1c1f26'}},
    ];
    if(sources.sat){
      layers.push({id:'satellite',type:'raster',source:'sat',paint:{'raster-opacity':1.0,'raster-fade-duration':200}});
    }
    layers=layers.concat([
      // ── Earth + landcover (low-zoom continents, then refined inland) ─────────
      {id:'earth',type:'fill',source:'pm','source-layer':'earth',
        filter:['==',['get','kind'],'earth'],
        paint:{'fill-color':'#272a30','fill-opacity':fillOpacity}},
      {id:'earth-cliff',type:'fill',source:'pm','source-layer':'earth',
        filter:['==',['get','kind'],'cliff'],
        paint:{'fill-color':'#3b3f48','fill-opacity':sat?0.0:0.7}},
      // ── Landuse (parks/forests/grass) ────────────────────────────────────────
      {id:'lu-park',type:'fill',source:'pm','source-layer':'landuse',
        filter:['in',['get','kind'],['literal',['national_park','park','nature_reserve','protected_area']]],
        paint:{'fill-color':'#2a3f2c','fill-opacity':sat?0.0:(hyb?0.35:0.92)}},
      {id:'lu-forest',type:'fill',source:'pm','source-layer':'landuse',
        filter:['in',['get','kind'],['literal',['forest','wood']]],
        paint:{'fill-color':'#243325','fill-opacity':sat?0.0:(hyb?0.30:0.8)}},
      {id:'lu-grass',type:'fill',source:'pm','source-layer':'landuse',
        filter:['in',['get','kind'],['literal',['grassland','meadow']]],
        paint:{'fill-color':'#2c3327','fill-opacity':sat?0.0:(hyb?0.25:0.55)}},
      {id:'lu-farmland',type:'fill',source:'pm','source-layer':'landuse',
        filter:['==',['get','kind'],'farmland'],
        paint:{'fill-color':'#2e2f29','fill-opacity':sat?0.0:(hyb?0.2:0.45)}},
      {id:'lu-residential',type:'fill',source:'pm','source-layer':'landuse',
        filter:['in',['get','kind'],['literal',['residential','urban_area']]],
        minzoom:9,
        paint:{'fill-color':'#2b2e34','fill-opacity':sat?0.0:0.5}},
      // ── Water polygons + rivers ──────────────────────────────────────────────
      {id:'water-poly',type:'fill',source:'pm','source-layer':'water',
        paint:{'fill-color':sat?'rgba(12,30,53,0.0)':'#1a2940','fill-opacity':hyb?0.45:1.0}},
      {id:'water-river',type:'line',source:'pm','source-layer':'water',
        filter:['in',['get','kind'],['literal',['river','stream','canal']]],
        layout:{'line-cap':'round','line-join':'round'},
        paint:{'line-color':'#1a2940','line-width':['interpolate',['linear'],['zoom'],8,0.5,12,1.6,15,3],'line-opacity':roadOpacity}},
      // ── Park boundary line — outlines national parks/wilderness even when fill is dim ─
      {id:'lu-park-line',type:'line',source:'pm','source-layer':'landuse',
        filter:['in',['get','kind'],['literal',['national_park','nature_reserve','protected_area']]],
        minzoom:7,
        paint:{'line-color':'#3f6845','line-width':1.2,'line-opacity':sat?0.0:0.7}},
      // ── Roads — case + fill for highways and major roads ─────────────────────
      {id:'road-other',type:'line',source:'pm','source-layer':'roads',
        filter:['==',['get','kind'],'other'],minzoom:12,
        layout:{'line-cap':'round','line-join':'round'},
        paint:{'line-color':sat?'#fff8':'#5a4a2c','line-width':['interpolate',['linear'],['zoom'],12,0.5,16,2],'line-dasharray':[2,2],'line-opacity':roadOpacity}},
      {id:'road-path',type:'line',source:'pm','source-layer':'roads',
        filter:['==',['get','kind'],'path'],minzoom:12,
        layout:{'line-cap':'round','line-join':'round'},
        paint:{'line-color':sat?'#a78bfacc':'#a07840','line-width':['interpolate',['linear'],['zoom'],12,1,16,2.5],'line-dasharray':[3,2],'line-opacity':roadOpacity}},
      {id:'road-minor-case',type:'line',source:'pm','source-layer':'roads',
        filter:['==',['get','kind'],'minor_road'],minzoom:11,
        layout:{'line-cap':'round','line-join':'round'},
        paint:{'line-color':sat?'#0008':'#1c1f26','line-width':['interpolate',['linear'],['zoom'],11,0.6,14,2.6,17,8],'line-opacity':roadOpacity}},
      {id:'road-minor',type:'line',source:'pm','source-layer':'roads',
        filter:['==',['get','kind'],'minor_road'],minzoom:9,
        layout:{'line-cap':'round','line-join':'round'},
        paint:{'line-color':sat?'#fff':'#6e7079','line-width':['interpolate',['linear'],['zoom'],11,0.4,14,1.8,17,6],'line-opacity':roadOpacity}},
      {id:'road-major-case',type:'line',source:'pm','source-layer':'roads',
        filter:['in',['get','kind'],['literal',['major_road','medium_road']]],
        layout:{'line-cap':'round','line-join':'round'},
        paint:{'line-color':sat?'#0008':'#1c1f26','line-width':['interpolate',['linear'],['zoom'],7,0.7,12,3.6,16,10],'line-opacity':roadOpacity}},
      {id:'road-major',type:'line',source:'pm','source-layer':'roads',
        filter:['in',['get','kind'],['literal',['major_road','medium_road']]],
        layout:{'line-cap':'round','line-join':'round'},
        paint:{'line-color':sat?'#fde68a':'#a8896a','line-width':['interpolate',['linear'],['zoom'],7,0.6,12,2.6,16,8],'line-opacity':roadOpacity}},
      {id:'road-trunk-case',type:'line',source:'pm','source-layer':'roads',
        filter:['==',['get','kind'],'highway'],
        layout:{'line-cap':'round','line-join':'round'},
        paint:{'line-color':sat?'#0008':'#1c1f26','line-width':['interpolate',['linear'],['zoom'],5,2.4,10,6,15,12],'line-opacity':roadOpacity}},
      {id:'road-trunk',type:'line',source:'pm','source-layer':'roads',
        filter:['==',['get','kind'],'highway'],
        layout:{'line-cap':'round','line-join':'round'},
        paint:{'line-color':sat?'#fbbf24':'#d8a23a','line-width':['interpolate',['linear'],['zoom'],5,1.4,10,3.6,15,8],'line-opacity':roadOpacity}},
      // ── Boundaries ───────────────────────────────────────────────────────────
      {id:'boundary-region',type:'line',source:'pm','source-layer':'boundaries',
        filter:['==',['get','kind'],'region'],
        paint:{'line-color':'#5a6a82','line-width':['interpolate',['linear'],['zoom'],3,0.6,8,1.2],'line-dasharray':[4,3],'line-opacity':sat?0.4:0.65}},
      {id:'boundary-country',type:'line',source:'pm','source-layer':'boundaries',
        filter:['==',['get','kind'],'country'],
        paint:{'line-color':'#7c8aa3','line-width':['interpolate',['linear'],['zoom'],3,0.8,8,2],'line-opacity':sat?0.6:0.85}},
      // ── Protomaps POIs surfaced for tap (camp_site, trailhead, viewpoint, peak) ─
      {id:'pm-pois-camp',type:'circle',source:'pm','source-layer':'pois',
        filter:['in',['get','kind'],['literal',['camp_site','camp_pitch','picnic_site','shelter']]],
        paint:{'circle-radius':5,'circle-color':'#14b8a6','circle-stroke-width':1.5,'circle-stroke-color':'#fff','circle-opacity':labelOpacity}},
      {id:'pm-pois-trailhead',type:'circle',source:'pm','source-layer':'pois',
        filter:['==',['get','kind'],'trailhead'],
        paint:{'circle-radius':5,'circle-color':'#22c55e','circle-stroke-width':1.5,'circle-stroke-color':'#fff','circle-opacity':labelOpacity}},
      {id:'pm-pois-viewpoint',type:'circle',source:'pm','source-layer':'pois',
        filter:['==',['get','kind'],'viewpoint'],
        paint:{'circle-radius':4,'circle-color':'#a855f7','circle-stroke-width':1.2,'circle-stroke-color':'#fff','circle-opacity':labelOpacity}},
      // ── Labels ───────────────────────────────────────────────────────────────
      {id:'water-name',type:'symbol',source:'pm','source-layer':'water',
        filter:['has','name'],minzoom:8,
        layout:{'text-field':['get','name'],'text-size':['interpolate',['linear'],['zoom'],8,10,14,13],
          'text-font':['Noto Sans Italic'],'text-max-width':8},
        paint:{'text-color':'#7eb6e2','text-halo-color':lwHalo,'text-halo-width':1.5,'text-opacity':labelOpacity}},
      {id:'peak-name',type:'symbol',source:'pm','source-layer':'pois',
        filter:['==',['get','kind'],'peak'],minzoom:11,
        layout:{'text-field':['concat',['get','name'],['case',['has','elevation'],['concat','\\n▲ ',['get','elevation'],'m'],'']],
          'text-size':['interpolate',['linear'],['zoom'],11,9,15,12],'text-font':['Noto Sans Regular'],
          'text-offset':[0,0.7],'text-anchor':'top'},
        paint:{'text-color':'#f59e0b','text-halo-color':lwHalo,'text-halo-width':1.5,'text-opacity':labelOpacity}},
      {id:'road-name',type:'symbol',source:'pm','source-layer':'roads',
        minzoom:13,filter:['all',['has','name'],['in',['get','kind'],['literal',['highway','major_road','medium_road','minor_road']]]],
        layout:{'text-field':['get','name'],'text-size':['interpolate',['linear'],['zoom'],13,10,17,13],
          'text-font':['Noto Sans Medium'],'symbol-placement':'line','text-max-width':10,
          'text-letter-spacing':0.05},
        paint:{'text-color':sat?'#fff':'#b9bcc4','text-halo-color':lwHalo,'text-halo-width':1.8,'text-opacity':labelOpacity}},
      // Places: Protomaps gives us only kind=locality with population_rank. Tier by rank.
      {id:'place-small',type:'symbol',source:'pm','source-layer':'places',
        minzoom:7,filter:['all',['==',['get','kind'],'locality'],['<',['coalesce',['get','population_rank'],0],8]],
        layout:{'text-field':['get','name'],'text-size':['interpolate',['linear'],['zoom'],10,10,14,12],
          'text-font':['Noto Sans Regular'],'text-letter-spacing':0.04},
        paint:{'text-color':'#a3aab9','text-halo-color':lwHalo,'text-halo-width':1.8,'text-opacity':labelOpacity}},
      {id:'place-medium',type:'symbol',source:'pm','source-layer':'places',
        minzoom:6,filter:['all',['==',['get','kind'],'locality'],['>=',['coalesce',['get','population_rank'],0],8],['<',['coalesce',['get','population_rank'],0],11]],
        layout:{'text-field':['get','name'],'text-size':['interpolate',['linear'],['zoom'],6,10,12,15],
          'text-font':['Noto Sans Medium'],'text-letter-spacing':0.05},
        paint:{'text-color':'#cdd2dd','text-halo-color':lwHalo,'text-halo-width':2,'text-opacity':labelOpacity}},
      {id:'place-large',type:'symbol',source:'pm','source-layer':'places',
        minzoom:3,filter:['all',['==',['get','kind'],'locality'],['>=',['coalesce',['get','population_rank'],0],11]],
        layout:{'text-field':['get','name'],'text-size':['interpolate',['linear'],['zoom'],4,11,12,17],
          'text-font':['Noto Sans Bold'],'text-letter-spacing':0.06},
        paint:{'text-color':'#e6e9f1','text-halo-color':lwHalo,'text-halo-width':2.2,'text-opacity':labelOpacity}},
      // Park names — italic for outdoor feel
      {id:'park-name',type:'symbol',source:'pm','source-layer':'pois',
        filter:['in',['get','kind'],['literal',['park','national_park','nature_reserve']]],
        minzoom:8,
        layout:{'text-field':['get','name'],'text-size':['interpolate',['linear'],['zoom'],8,9,13,12],
          'text-font':['Noto Sans Italic'],'text-max-width':9,'text-letter-spacing':0.05},
        paint:{'text-color':'#7fb88b','text-halo-color':lwHalo,'text-halo-width':1.6,'text-opacity':labelOpacity}},
    ]);
    return {version:8,sources:sources,glyphs:_glyphUrl(),layers:layers};
  }

  function _ll2t(lat,lng,z){var x=Math.floor((lng+180)/360*Math.pow(2,z));var s=Math.sin(lat*Math.PI/180);var y=Math.floor((0.5-Math.log((1+s)/(1-s))/(4*Math.PI))*Math.pow(2,z));return{x:Math.max(0,x),y:Math.max(0,y)};}

  function _mbUrls(z,x,y,vectorOnly){
    // Vector tiles always come from our backend (Protomaps proxy) — global coverage.
    var v=[apiBase+'/api/tiles/'+z+'/'+x+'/'+y+'.pbf'];
    // Satellite raster from Mapbox is online-only; only fetch if user opted-in.
    if(!vectorOnly&&mapboxToken){
      v.push('https://api.mapbox.com/v4/mapbox.satellite/'+z+'/'+x+'/'+y+'@2x.jpg90?access_token='+mapboxToken);
    }
    return v;
  }
  function _kbPer(z,vectorOnly){return vectorOnly?(z>=14?12:z>=12?7:4):(z>=14?180:z>=12?95:z>=10?45:20);}

  var _currentDlLabel='';

  // Pre-cache glyph PBFs so labels render offline. Style is built inline so no
  // style JSON/sprites to fetch — keep this list small and high-coverage.
  async function _preCacheMapResources(){
    var base=apiBase+'/api/fonts/';
    var stacks=['Noto Sans Regular','Noto Sans Bold','Noto Sans Medium'];
    // ASCII + Latin extended ranges cover all US/EU place names
    var ranges=['0-255','256-511','512-767','7680-7935'];
    for(var s=0;s<stacks.length;s++){
      for(var r=0;r<ranges.length;r++){
        try{await fetch(base+encodeURIComponent(stacks[s])+'/'+ranges[r]+'.pbf');}catch(e){}
      }
    }
  }

  async function _runDl(coords,vectorOnly){
    var total=coords.length,saved=0,bytes=0,BATCH=20;
    var manifestKeys=[];
    // Cache style/glyphs/sprites first so map can initialize fully offline
    await _preCacheMapResources();
    postRN({type:'download_progress',percent:0,saved:0,total:total,mb:'0'});
    for(var i=0;i<coords.length;i+=BATCH){
      if(!downloadActive)break;
      var batch=coords.slice(i,i+BATCH);
      await Promise.allSettled(batch.map(async function(t){
        var urls=_mbUrls(t.z,t.x,t.y,vectorOnly);
        for(var ui=0;ui<urls.length;ui++){
          var ck=urls[ui].replace(/access_token=[^&]*/,'access_token=_');
          manifestKeys.push(ck);
          try{await fetch(urls[ui]);}catch(e){}
        }
        saved++;bytes+=_kbPer(t.z,vectorOnly)*1024;
        postRN({type:'download_progress',percent:Math.round(saved/total*100),saved:saved,total:total,mb:(bytes/1048576).toFixed(1)});
      }));
    }
    // Store manifest so delete can find exactly which keys belong to this region
    if(_currentDlLabel){
      try{
        var c=await caches.open(TILE_CACHE);
        await c.put('manifest-'+_currentDlLabel,new Response(JSON.stringify(manifestKeys),{headers:{'Content-Type':'application/json'}}));
      }catch(e){}
    }
    downloadActive=false;
    postRN({type:'download_complete',saved:saved,total:total});
  }

  // Bbox download (used for state-level downloads)
  async function _dlTiles(n,s,e,w,minZ,maxZ,vectorOnly){
    var coords=[];
    for(var z=minZ;z<=maxZ;z++){
      var nw=_ll2t(n,w,z),se=_ll2t(s,e,z),cap=Math.pow(2,z)-1;
      for(var x=Math.max(0,nw.x);x<=Math.min(cap,se.x);x++){
        for(var y=Math.max(0,nw.y);y<=Math.min(cap,se.y);y++){coords.push({z:z,x:x,y:y});}
      }
    }
    await _runDl(coords,!!vectorOnly);
  }

  // Route-corridor download: buffers around actual route coords — far fewer tiles than bbox
  async function _dlTilesRoute(bufferKm,minZ,maxZ,vectorOnly){
    if(!_routeCoords||!_routeCoords.length){postRN({type:'download_complete',saved:0,total:0});return;}
    var tileSet=new Set();
    var step=Math.max(1,Math.floor(_routeCoords.length/400));
    for(var z=minZ;z<=maxZ;z++){
      for(var i=0;i<_routeCoords.length;i+=step){
        var lon=_routeCoords[i][0],lat=_routeCoords[i][1];
        var bufLat=bufferKm/111.0;
        var bufLng=bufferKm/(111.0*Math.max(0.05,Math.cos(lat*Math.PI/180)));
        var nw=_ll2t(lat+bufLat,lon-bufLng,z),se=_ll2t(lat-bufLat,lon+bufLng,z),cap=Math.pow(2,z)-1;
        for(var x=Math.max(0,nw.x);x<=Math.min(cap,se.x);x++){
          for(var y=Math.max(0,nw.y);y<=Math.min(cap,se.y);y++){tileSet.add(z+'|'+x+'|'+y);}
        }
      }
    }
    var coords=Array.from(tileSet).map(function(s){var p=s.split('|');return{z:+p[0],x:+p[1],y:+p[2]};});
    await _runDl(coords,!!vectorOnly);
  }

  // ── Map init ──────────────────────────────────────────────────────────────────
  function initMap(token,style){
    mapboxToken=token;
    currentStyle=style||'satellite';
    // Match MapLibre's parallel request limit to WKWebView's actual HTTP/2 cap.
    // Default 16 creates a URLSession backlog — tiles wait for each other.
    maplibregl.config.MAX_PARALLEL_IMAGE_REQUESTS=6;
    map=new maplibregl.Map({container:'map',style:buildStyle(currentStyle),
      center:[${centerLng},${centerLat}],zoom:${waypoints.length > 1 ? 7 : 10},
      attributionControl:false,pitchWithRotate:false,
      fadeDuration:0,
      maxTileCacheSize:2000,
      renderWorldCopies:false,
      localFontFamily:'sans-serif'});
    map.on('load',function(){
      setupSources();setupLayers();renderWaypoints();loadInitialData();
      if(wps.length>=2)loadRoute();
      document.getElementById('loading').classList.add('hidden');
      mapReady=true;postRN({type:'map_ready'});
      pendingMsgs.forEach(handleMsgData);pendingMsgs=[];
    });
    map.on('style.load',function(){
      setupSources();setupLayers();renderWaypoints();
      updateCampSrc();updateGasSrc();updatePoiSrc();updateRoute();updateBreadcrumb();updateReportMarkers();
      if(showLandOverlay)setLandOverlay(true);
      if(showUsgsOverlay)setUsgsOverlay(true);
      if(showTerrainLayer)setTerrainLayer(true);
      if(showNaipLayer)setNaipLayer(true);
      if(showFireLayer)setFireLayer(true);
      if(showAvaLayer)setAvaLayer(true);
      if(showRadarLayer)setRadarLayer(true);
      if(showMvumLayer)setMvumLayer(true);
      if(showRoadsLayer)setRoadsLayer(true);
    });
    var boundsTimer;
    map.on('moveend',function(){
      clearTimeout(boundsTimer);
      boundsTimer=setTimeout(function(){var b=map.getBounds();postRN({type:'map_bounds',n:b.getNorth(),s:b.getSouth(),e:b.getEast(),w:b.getWest(),zoom:map.getZoom()});},400);
      if(userMarker){var svg=userMarker.getElement().querySelector('svg');var hdg=smoothedHdg;if(svg&&hdg>=0){svg.style.transform='rotate('+(hdg-map.getBearing())+'deg)';}}
      if(showMvumLayer){clearTimeout(_mvumTimer);_mvumTimer=setTimeout(_fetchMvum,700);}
      if(showRoadsLayer){clearTimeout(_roadsTimer);_roadsTimer=setTimeout(_fetchRoads,700);}
    });
    // Continuous compass re-sync while map is rotating (nav mode bearing chase)
    map.on('rotate',function(){
      if(userMarker&&smoothedHdg>=0){var svg=userMarker.getElement().querySelector('svg');if(svg)svg.style.transform='rotate('+(smoothedHdg-map.getBearing())+'deg)';}
    });
    map.on('click',function(e){
      if(e.defaultPrevented)return;
      try{
        // Detection uses Protomaps schema - "kind" prop on pois/roads source layers.
        // 1. Camp/shelter/trailhead POI hits — single-pixel test
        var ptFs=map.queryRenderedFeatures(e.point);
        for(var ci=0;ci<ptFs.length;ci++){
          var cf=ptFs[ci];
          var lid=(cf.layer&&cf.layer.id)||'';
          var pName=(cf.properties&&cf.properties.name)||'';
          if(lid==='pm-pois-camp'||lid==='pm-pois-trailhead'){
            var cc=cf.geometry&&cf.geometry.type==='Point'&&cf.geometry.coordinates;
            var pKind=(cf.properties&&cf.properties.kind)||'';
            postRN({type:'base_camp_tapped',name:pName||(pKind==='trailhead'?'Trailhead':'Campsite'),lat:cc?cc[1]:e.lngLat.lat,lng:cc?cc[0]:e.lngLat.lng,landType:pKind==='trailhead'?'Trailhead':'Campground'});
            return;
          }
        }
        // 2. Trail/path lines — wide box for thin-line tolerance
        var box=[{x:e.point.x-12,y:e.point.y-12},{x:e.point.x+12,y:e.point.y+12}];
        var boxFs=map.queryRenderedFeatures(box);
        for(var i=0;i<boxFs.length;i++){
          var f=boxFs[i];
          var lid2=(f.layer&&f.layer.id)||'';
          var pKind2=(f.properties&&f.properties.kind)||'';
          if(lid2==='road-path'||pKind2==='path'){
            var nm=(f.properties&&f.properties.name)||'';
            postRN({type:'trail_tapped',name:nm||'Trail',lat:e.lngLat.lat,lng:e.lngLat.lng,cls:'path'});
            return;
          }
        }
      }catch(x){}
      postRN({type:'map_tapped'});
    });
    // ── Long-press to check camping legality ──────────────────────────────────
    map.on('contextmenu',function(e){
      postRN({type:'map_long_press',lat:e.lngLat.lat,lng:e.lngLat.lng});
    });
    var _longPressTimer;
    map.on('touchstart',function(e){
      _longPressTimer=setTimeout(function(){
        if(e.lngLat)postRN({type:'map_long_press',lat:e.lngLat.lat,lng:e.lngLat.lng});
      },600);
    });
    map.on('touchend',function(){clearTimeout(_longPressTimer);});
    map.on('touchmove',function(){clearTimeout(_longPressTimer);});
  }

  // ── GeoJSON helpers ───────────────────────────────────────────────────────────
  function campFeat(c){return{type:'Feature',geometry:{type:'Point',coordinates:[c.lng,c.lat]},properties:{id:c.id||'',name:c.name||'',land_type:c.land_type||'Campground',cost:c.cost||'',ada:c.ada?1:0,reservable:c.reservable?1:0,full:c.full||0,raw:JSON.stringify(c)}};}

  function setupSources(){
    if(!map.getSource('camps'))map.addSource('camps',{type:'geojson',data:{type:'FeatureCollection',features:[]},cluster:true,clusterMaxZoom:11,clusterRadius:45});
    if(!map.getSource('gas'))map.addSource('gas',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    if(!map.getSource('pois'))map.addSource('pois',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    if(!map.getSource('route'))map.addSource('route',{type:'geojson',data:{type:'Feature',geometry:{type:'LineString',coordinates:[]}}});
    if(!map.getSource('route-passed'))map.addSource('route-passed',{type:'geojson',data:{type:'Feature',geometry:{type:'LineString',coordinates:[]}}});
    if(!map.getSource('breadcrumb'))map.addSource('breadcrumb',{type:'geojson',data:{type:'Feature',geometry:{type:'LineString',coordinates:[]}}});
  }

  var _clicksSetup=false;
  function setupLayers(){
    var _a=function(id,def){if(!map.getLayer(id))map.addLayer(def);};
    _a('breadcrumb',{id:'breadcrumb',type:'line',source:'breadcrumb',paint:{'line-color':'#3b82f6','line-width':2.5,'line-opacity':0.8,'line-dasharray':[2,4]}});
    _a('route-shadow',{id:'route-shadow',type:'line',source:'route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'rgba(0,0,0,0.35)','line-width':9,'line-blur':5,'line-translate':[0,2]}});
    _a('route-line',{id:'route-line',type:'line',source:'route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#f97316','line-width':5,'line-opacity':0.94}});
    /* Dimmed overlay for segments already driven — renders on top of route-line */
    _a('route-passed-line',{id:'route-passed-line',type:'line',source:'route-passed',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#374151','line-width':5,'line-opacity':0.72}});
    _a('gas-circle',{id:'gas-circle',type:'circle',source:'gas',paint:{'circle-radius':9,'circle-color':'#eab308','circle-opacity':0.92,'circle-stroke-width':2,'circle-stroke-color':'#fff'}});
    _a('gas-code',{id:'gas-code',type:'symbol',source:'gas',layout:{'text-field':'F','text-size':10,'text-font':['DIN Offc Pro Medium','Arial Unicode MS Bold'],'text-allow-overlap':true,'text-ignore-placement':true},paint:{'text-color':'#111827','text-halo-color':'rgba(255,255,255,0.55)','text-halo-width':0.8}});
    _a('gas-label',{id:'gas-label',type:'symbol',source:'gas',filter:['>=',['zoom'],13],layout:{'text-field':['get','name'],'text-size':9,'text-offset':[0,1.5],'text-anchor':'top'},paint:{'text-color':'#f1f5f9','text-halo-color':'rgba(0,0,0,0.85)','text-halo-width':1.5}});
    _a('poi-circle',{id:'poi-circle',type:'circle',source:'pois',paint:{'circle-radius':['case',['==',['get','type'],'peak'],9,8],'circle-color':['match',['get','type'],'water','#3b82f6','trailhead','#22c55e','viewpoint','#a855f7','peak','#92400e','hot_spring','#f97316','#6b7280'],'circle-opacity':0.9,'circle-stroke-width':1.5,'circle-stroke-color':'#fff'}});
    _a('poi-code',{id:'poi-code',type:'symbol',source:'pois',layout:{'text-field':['match',['get','type'],'water','W','trailhead','T','viewpoint','V','peak','P','hot_spring','H','P'],'text-size':9.5,'text-font':['DIN Offc Pro Medium','Arial Unicode MS Bold'],'text-allow-overlap':true,'text-ignore-placement':true},paint:{'text-color':'#fff','text-halo-color':'rgba(0,0,0,0.35)','text-halo-width':0.8}});
    _a('poi-label',{id:'poi-label',type:'symbol',source:'pois',filter:['>=',['zoom'],12],layout:{'text-field':['case',['all',['==',['get','type'],'peak'],['has','elevation']],['concat',['get','name'],'\\n▲ ',['get','elevation']],['get','name']],'text-size':['case',['==',['get','type'],'peak'],10,9],'text-offset':[0,1.3],'text-anchor':'top','text-max-width':10},paint:{'text-color':['case',['==',['get','type'],'peak'],'#d97706','#f1f5f9'],'text-halo-color':['case',['==',['get','type'],'peak'],'rgba(255,255,255,0.95)','rgba(0,0,0,0.85)'],'text-halo-width':2}});
    _a('camp-cluster',{id:'camp-cluster',type:'circle',source:'camps',filter:['has','point_count'],paint:{'circle-color':['step',['get','point_count'],'#14b8a6',10,'#f97316',50,'#ef4444'],'circle-radius':['step',['get','point_count'],18,10,25,50,32],'circle-opacity':0.88,'circle-stroke-width':2,'circle-stroke-color':'#fff'}});
    _a('camp-count',{id:'camp-count',type:'symbol',source:'camps',filter:['has','point_count'],layout:{'text-field':'{point_count_abbreviated}','text-size':12,'text-font':['DIN Offc Pro Medium','Arial Unicode MS Bold']},paint:{'text-color':'#fff'}});
    _a('camp-circle',{id:'camp-circle',type:'circle',source:'camps',filter:['!',['has','point_count']],paint:{'circle-radius':['interpolate',['linear'],['zoom'],9,7,13,11],'circle-color':['match',['get','land_type'],'BLM Land','#f97316','National Forest','#22c55e','National Park','#3b82f6','State Park','#8b5cf6','Campground','#14b8a6','#14b8a6'],'circle-opacity':0.88,'circle-stroke-width':['case',['==',['get','full'],1],3,2],'circle-stroke-color':['case',['==',['get','full'],1],'#ef4444','rgba(255,255,255,0.9)']}});
    _a('camp-code',{id:'camp-code',type:'symbol',source:'camps',filter:['!',['has','point_count']],layout:{'text-field':'C','text-size':10,'text-font':['DIN Offc Pro Medium','Arial Unicode MS Bold'],'text-allow-overlap':true,'text-ignore-placement':true},paint:{'text-color':'#fff','text-halo-color':'rgba(0,0,0,0.35)','text-halo-width':0.8}});
    _a('camp-full-badge',{id:'camp-full-badge',type:'circle',source:'camps',filter:['all',['!',['has','point_count']],['==',['get','full'],1]],paint:{'circle-radius':5,'circle-color':'#ef4444','circle-stroke-width':1.5,'circle-stroke-color':'#fff','circle-translate':[7,-7],'circle-opacity':0.95}});
    _a('camp-label',{id:'camp-label',type:'symbol',source:'camps',filter:['all',['!',['has','point_count']],['>=',['zoom'],12]],layout:{'text-field':['get','name'],'text-size':10,'text-offset':[0,1.3],'text-anchor':'top','text-max-width':10},paint:{'text-color':'#f1f5f9','text-halo-color':'rgba(0,0,0,0.85)','text-halo-width':1.5}});
    // Guard: only register click handlers once per map instance, never on style reload
    if(_clicksSetup)return;
    _clicksSetup=true;
    map.on('click','camp-cluster',function(e){var f=map.queryRenderedFeatures(e.point,{layers:['camp-cluster']});if(!f.length)return;map.getSource('camps').getClusterExpansionZoom(f[0].properties.cluster_id,function(err,zoom){if(err)return;map.easeTo({center:f[0].geometry.coordinates,zoom:zoom+0.5});});e.preventDefault();});
    map.on('click','camp-circle',function(e){if(!e.features||!e.features[0])return;var p=e.features[0].properties;var raw;try{raw=JSON.parse(p.raw||'{}');}catch(x){raw=p;}postRN({type:'campsite_tapped',id:raw.id||p.id,name:raw.name||p.name,camp:raw});e.preventDefault();});
    map.on('click','gas-circle',function(e){if(!e.features||!e.features[0])return;var p=e.features[0].properties;new maplibregl.Popup({closeButton:false,offset:12}).setLngLat(e.lngLat).setHTML('<div class="pt">F '+p.name+'</div><div class="pm">Fuel Station</div>').addTo(map);e.preventDefault();});
    map.on('click','poi-circle',function(e){if(!e.features||!e.features[0])return;var p=e.features[0].properties;var ic=p.type==='water'?'W':p.type==='trailhead'?'T':p.type==='viewpoint'?'V':p.type==='peak'?'P':p.type==='hot_spring'?'H':'P';new maplibregl.Popup({closeButton:false,offset:12}).setLngLat(e.lngLat).setHTML('<div class="pt">'+ic+' '+p.name+'</div><div class="pm">'+p.type+'</div>').addTo(map);e.preventDefault();});
    ['camp-cluster','camp-circle','gas-circle','poi-circle'].forEach(function(l){map.on('mouseenter',l,function(){map.getCanvas().style.cursor='pointer';});map.on('mouseleave',l,function(){map.getCanvas().style.cursor='';});});
  }

  function renderWaypoints(){
    wpMarkers.forEach(function(m){m.remove();});wpMarkers=[];
    var typeIcon={fuel:'F',camp:'C',start:'S',motel:'M',shower:'W',town:'T'};
    var typeLabel={fuel:'Fuel Stop',camp:'Camp',start:'Start',motel:'Lodging',shower:'Showers',town:'Town',waypoint:'Waypoint'};
    wps.forEach(function(w,i){
      var el=document.createElement('div');
      var tc=w.type==='start'?'wp-start':w.type==='motel'?'wp-motel':w.type==='fuel'?'wp-fuel':w.type==='waypoint'?'wp-waypoint':w.type==='town'?'wp-town':w.type==='shower'?'wp-shower':w.type==='camp'?'wp-camp':'';
      el.className='mk-wp'+(tc?' '+tc:'');
      el.textContent=typeIcon[w.type]||(w.day||i+1);
      var label=typeLabel[w.type]||w.type;
      var popup=new maplibregl.Popup({offset:20,closeButton:true,maxWidth:'220px'})
        .setHTML('<div class="pt">'+w.name+'</div><div class="pm">Day '+w.day+' &middot; '+label+'</div>');
      var m=new maplibregl.Marker({element:el}).setLngLat([w.lng,w.lat]).setPopup(popup).addTo(map);
      el.addEventListener('click',function(ev){ev.stopPropagation();m.togglePopup();postRN({type:'wp_tapped',idx:i,name:w.name});});
      wpMarkers.push(m);
    });
    if(wps.length>=2){var bounds=new maplibregl.LngLatBounds();wps.forEach(function(w){bounds.extend([w.lng,w.lat]);});map.fitBounds(bounds,{padding:60,maxZoom:12,duration:800});}
  }

  function loadInitialData(){
    if(initGas.length){allGas=initGas;updateGasSrc();}
    if(initPins.length){allPois=initPins.map(function(p){return{name:p.name,lat:p.lat,lng:p.lng,type:p.type||'pin'};});updatePoiSrc();}
  }

  function updateCampSrc(){if(!map||!map.getSource('camps'))return;map.getSource('camps').setData({type:'FeatureCollection',features:allCamps.map(campFeat)});}
  function updateGasSrc(){if(!map||!map.getSource('gas'))return;map.getSource('gas').setData({type:'FeatureCollection',features:allGas.map(function(g){return{type:'Feature',geometry:{type:'Point',coordinates:[g.lng,g.lat]},properties:{name:g.name}};})});}
  function updatePoiSrc(){if(!map||!map.getSource('pois'))return;map.getSource('pois').setData({type:'FeatureCollection',features:allPois.map(function(p){return{type:'Feature',geometry:{type:'Point',coordinates:[p.lng,p.lat]},properties:{name:p.name,type:p.type||'pin'}};})});}
  function updateRoute(){if(!map||!map.getSource('route'))return;map.getSource('route').setData({type:'Feature',geometry:{type:'LineString',coordinates:_routeCoords}});}
  function updateBreadcrumb(){if(!map||!map.getSource('breadcrumb'))return;map.getSource('breadcrumb').setData({type:'Feature',geometry:{type:'LineString',coordinates:breadcrumbPts}});}

  var _passedRouteIdx=0,_passedRouteCoords=[];
  function resetPassedRoute(){_passedRouteIdx=0;_passedRouteCoords=[];if(map&&map.getSource('route-passed'))map.getSource('route-passed').setData({type:'Feature',geometry:{type:'LineString',coordinates:[]}});}
  function updatePassedRoute(lat,lng){
    if(!navActive||!_routeCoords.length||!routeIsProper)return;
    var searchEnd=Math.min(_routeCoords.length-1,_passedRouteIdx+80);
    var bestIdx=_passedRouteIdx,bestD=Infinity;
    for(var i=_passedRouteIdx;i<=searchEnd;i++){
      var dlat=(_routeCoords[i][1]-lat)*111000;
      var dlng=(_routeCoords[i][0]-lng)*111000*Math.cos(lat*Math.PI/180);
      var d=Math.sqrt(dlat*dlat+dlng*dlng);
      if(d<bestD){bestD=d;bestIdx=i;}
      if(d<15)break;
    }
    if(bestIdx>_passedRouteIdx){
      _passedRouteIdx=bestIdx;
      _passedRouteCoords=_routeCoords.slice(0,bestIdx+1);
      if(map&&map.getSource('route-passed'))map.getSource('route-passed').setData({type:'Feature',geometry:{type:'LineString',coordinates:_passedRouteCoords}});
    }
  }
  var REP_ICONS={police:'🚔',hazard:'⚠️',road_condition:'🛑',wildlife:'🐾',campsite:'⛺',road_closure:'🚧',water:'💧'};
  function repTimeAgo(ts){if(!ts)return'';var m=Math.floor((Date.now()/1000-ts)/60);if(m<2)return'just now';if(m<60)return m+'m ago';var h=Math.floor(m/60);if(h<24)return h+'h ago';return Math.floor(h/24)+'d ago';}
  function escHTML(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  function updateReportMarkers(){
    reportMarkers.forEach(function(m){m.remove();});reportMarkers=[];
    allReports.forEach(function(r){
      var el=document.createElement('div');
      el.className='mk-rep mk-rep-'+(r.type||'hazard');
      el.textContent=REP_ICONS[r.type]||'⚠️';
      el.title=(r.subtype||r.type)+(r.confirmations?' ✓'+r.confirmations:'');
      var age=repTimeAgo(r.created_at);
      var confLine=r.confirmations?'<div class="pm" style="color:#22c55e;margin-top:2px">✓ '+r.confirmations+' confirmed</div>':'';
      var ageLine=age?'<div class="pm" style="opacity:0.5;margin-top:2px">'+escHTML(age)+'</div>':'';
      var popup=new maplibregl.Popup({offset:18,closeButton:false}).setHTML('<div class="pt">'+escHTML(r.subtype||r.type)+'</div><div class="pm">'+escHTML(r.description||'Community report')+'</div>'+confLine+ageLine);
      var m=new maplibregl.Marker({element:el,anchor:'center'}).setLngLat([r.lng,r.lat]).setPopup(popup).addTo(map);
      el.addEventListener('click',function(ev){ev.stopPropagation();m.togglePopup();postRN({type:'report_tapped',report:r});});
      reportMarkers.push(m);
    });
  }

  // ── Land ownership overlay (BLM/USFS/NPS via backend proxy) ─────────────────
  // Uses our FastAPI proxy so the WebView never hits BLM ArcGIS directly.
  // The proxy caches tiles 7 days and adds CORS headers.
  function setLandOverlay(show){
    showLandOverlay=show;
    if(!map||!mapReady)return;
    if(show){
      var tileUrl=apiBase+'/api/land-tile/{z}/{y}/{x}';
      if(!map.getSource('blm-sma')){
        map.addSource('blm-sma',{type:'raster',tiles:[tileUrl],tileSize:256,minzoom:4,maxzoom:15,attribution:'BLM/USGS'});
      }
      if(!map.getLayer('blm-sma')){
        // Insert below route layers so route is always visible on top
        var beforeLayer=map.getLayer('route-shadow')?'route-shadow':undefined;
        map.addLayer({id:'blm-sma',type:'raster',source:'blm-sma',paint:{'raster-opacity':0.5}},beforeLayer);
      }
    }else{
      if(map.getLayer('blm-sma'))map.removeLayer('blm-sma');
      if(map.getSource('blm-sma'))map.removeSource('blm-sma');
    }
  }

  // ── USGS National Map topo overlay (full trail + contour detail) ──────────────
  function setUsgsOverlay(show){
    showUsgsOverlay=show;
    if(!map||!mapReady)return;
    if(show){
      if(!map.getSource('usgs-topo')){
        map.addSource('usgs-topo',{type:'raster',tiles:['https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}'],tileSize:256,minzoom:4,maxzoom:16,attribution:'USGS National Map'});
      }
      if(!map.getLayer('usgs-topo')){
        var bl=map.getLayer('route-shadow')?'route-shadow':undefined;
        map.addLayer({id:'usgs-topo',type:'raster',source:'usgs-topo',paint:{'raster-opacity':0.8}},bl);
      }
    }else{
      if(map.getLayer('usgs-topo'))map.removeLayer('usgs-topo');
      if(map.getSource('usgs-topo'))map.removeSource('usgs-topo');
    }
  }

  // ── User position ──────────────────────────────────────────────────────────────
  var navActive=false;
  var smoothedHdg=-1; // last known heading for arrow re-sync on map bearing changes
  var _offRouteStreak=0; // consecutive off-route readings before firing reroute
  var _wakeLock=null;
  function setUserPos(lat,lng,recenter,zoom,heading){
    if(!userMarker){
      var el=document.createElement('div');el.className='mk-me';
      el.innerHTML='<div class="mk-me-ring"></div><svg class="mk-me-arrow" width="24" height="32" viewBox="0 0 24 32" style="transition:transform 0.6s ease"><path d="M12 1 L23 29 L12 22 L1 29 Z" fill="#f97316" stroke="white" stroke-width="1.5" stroke-linejoin="round"/></svg>';
      userMarker=new maplibregl.Marker({element:el,anchor:'center'}).setLngLat([lng,lat]).addTo(map);
    }else{userMarker.setLngLat([lng,lat]);}
    // Rotate the arrow to face the true heading, compensating for map bearing
    if(heading!=null&&heading>=0){
      smoothedHdg=heading;
      var svg=userMarker.getElement().querySelector('svg');
      if(svg){var mapBrg=map?map.getBearing():0;svg.style.transform='rotate('+(heading-mapBrg)+'deg)';}
    }
    if(navActive&&heading!=null&&heading>=0){
      // Only rotate map bearing when actually moving — freezes at stops so map doesn't spin
      // Duration scales with speed — faster driving needs snappier camera to avoid lag
      var dur=lastSpeed!=null?(lastSpeed>25?250:lastSpeed>15?350:450):500;
      var eOpts={center:[lng,lat],pitch:52,zoom:zoom||17,duration:dur,essential:true};
      if(lastSpeed!=null&&lastSpeed>3.5)eOpts.bearing=heading;
      map.easeTo(eOpts);
    }else if(recenter){
      map.easeTo({center:[lng,lat],zoom:zoom||15,duration:500});
    }
    // Update passed-route dimming
    updatePassedRoute(lat,lng);
    var now=Date.now();
    // Off-route check: only when route loaded + moving + 10s cooldown
    if(routePts.length>0&&routeIsProper&&!_routeLoading&&now-lastOffCheck>10000&&(lastSpeed==null||lastSpeed>2)){
      lastOffCheck=now;var minD=Infinity;
      for(var i=0;i<routePts.length;i++){var dlat=(routePts[i][1]-lat)*111000;var dlng=(routePts[i][0]-lng)*111000*Math.cos(lat*Math.PI/180);var d=Math.sqrt(dlat*dlat+dlng*dlng);if(d<minD)minD=d;if(minD<80)break;}
      if(minD>350){
        _offRouteStreak++;
        // Require 2 consecutive readings to avoid GPS jitter false-positives
        if(_offRouteStreak>=2){postRN({type:'off_route',lat:lat,lng:lng,dist:Math.round(minD)});}
        else{postRN({type:'off_route_warn',lat:lat,lng:lng,dist:Math.round(minD)});}
      }else if(minD>60){_offRouteStreak=0;postRN({type:'off_route_warn',lat:lat,lng:lng,dist:Math.round(minD)});}
      else{_offRouteStreak=0;postRN({type:'back_on_route'});}
    }
  }

  function setNavTarget(idx){wpMarkers.forEach(function(m,i){m.getElement().classList.toggle('nav-target',i===idx);});}

  // ── Routing ───────────────────────────────────────────────────────────────────
  function decodeP6(enc){var coords=[],i=0,lat=0,lng=0;while(i<enc.length){var b,shift=0,res=0;do{b=enc.charCodeAt(i++)-63;res|=(b&0x1f)<<shift;shift+=5;}while(b>=0x20);lat+=res&1?~(res>>1):(res>>1);shift=0;res=0;do{b=enc.charCodeAt(i++)-63;res|=(b&0x1f)<<shift;shift+=5;}while(b>=0x20);lng+=res&1?~(res>>1):(res>>1);coords.push([lng/1e6,lat/1e6]);}return coords;}

  function _fallback(pairs,fromIdx){
    // If we already have a valid cached route, do NOT overwrite it with straight lines.
    // This preserves the stored route when the Directions API is unreachable offline.
    if(routeIsProper&&_routeCoords.length){_routeLoading=false;return;}
    routeIsProper=false;_routeLoading=false;
    if(!pairs.length){postRN({type:'route_ready',routed:false,steps:[],legs:[],fromIdx:fromIdx||0});return;}
    var coords=pairs.map(function(p){var s=p.split(',');return[parseFloat(s[0]),parseFloat(s[1])];});
    _routeCoords=coords;routePts=coords;updateRoute();
    postRN({type:'route_ready',routed:false,steps:[],legs:[],fromIdx:fromIdx||0});
  }

  async function _fetchRoute(pairs,fromIdx){
    _routeLoading=true;
    if(routeOpts.backRoads)return _fetchValhalla(pairs,fromIdx);
    var excl=[];if(routeOpts.avoidTolls)excl.push('toll');if(routeOpts.avoidHighways)excl.push('motorway');if(routeOpts.noFerries)excl.push('ferry');
    var profile=(routeOpts.avoidHighways)?'driving':'driving-traffic';
    var url='https://api.mapbox.com/directions/v5/mapbox/'+profile+'/'+pairs.join(';')+'?access_token='+mapboxToken+'&steps=true&geometries=geojson&overview=full&annotations=maxspeed&banner_instructions=true'+(excl.length?'&exclude='+excl.join(','):'');
    try{
      var ctrl=new AbortController();var tid=setTimeout(function(){ctrl.abort();},10000);
      var data=await(await fetch(url,{signal:ctrl.signal})).json();clearTimeout(tid);
      if(!data.routes||!data.routes[0])return _fetchValhalla(pairs,fromIdx);
      var route=data.routes[0];
      _routeCoords=route.geometry.coordinates;routePts=_routeCoords.filter(function(_,i){return i%3===0;});updateRoute();
      var steps=[],legs=[];
      (route.legs||[]).forEach(function(leg){
        var ls=[];
        var ann=(leg.annotation&&leg.annotation.maxspeed)||[];
        var annOff=0;
        (leg.steps||[]).forEach(function(s){
          // Each step's geometry has N coords → N-1 annotation segments; accumulate offset
          var nCoords=(s.geometry&&s.geometry.coordinates&&s.geometry.coordinates.length)||0;
          var nSegs=Math.max(0,nCoords-1);
          var stepAnn=ann.slice(annOff,annOff+nSegs);
          annOff+=nSegs;
          // Mode of valid numeric speeds for this step's coordinate segments
          var valid=stepAnn.filter(function(a){return a&&typeof a.speed==='number';}).map(function(a){return a.speed;});
          var freq={};valid.forEach(function(v){freq[v]=(freq[v]||0)+1;});
          var keys=Object.keys(freq).sort(function(a,b){return freq[b]-freq[a];});
          var spd=keys.length?parseFloat(keys[0]):null;
          if(s.distance>0||s.maneuver.type==='arrive'){
            var loc=s.maneuver&&s.maneuver.location;
            var lanes=[];
            if(s.intersections){for(var ii=s.intersections.length-1;ii>=0;ii--){var isc=s.intersections[ii];if(isc.lanes&&isc.lanes.length){lanes=isc.lanes.map(function(l){return{indications:l.indications||[],valid:l.valid===true,active:l.active===true};});break;}}}
            var st={type:s.maneuver.type,modifier:s.maneuver.modifier||'',name:s.name||'',distance:s.distance,duration:s.duration,lat:loc?loc[1]:undefined,lng:loc?loc[0]:undefined,lanes:lanes.length?lanes:undefined,speedLimit:spd};
            steps.push(st);ls.push(st);
          }
        });
        legs.push(ls);
      });
      routeIsProper=true;_routeLoading=false;
      postRN({type:'route_ready',routed:true,steps:steps,legs:legs,total_distance:route.distance,total_duration:route.duration,fromIdx:fromIdx||0});
      // Persist for offline replay (RN side caches in SecureStore)
      postRN({type:'route_persist',coords:_routeCoords,steps:steps,legs:legs,total_distance:route.distance,total_duration:route.duration});
    }catch(e){_fallback(pairs,fromIdx);}
  }

  async function _fetchValhalla(pairs,fromIdx){
    var locs=pairs.map(function(p){var s=p.split(',');return{lon:parseFloat(s[0]),lat:parseFloat(s[1])};});
    var body={locations:locs,options:routeOpts,units:'miles'};
    try{
      var ctrl=new AbortController();var tid=setTimeout(function(){ctrl.abort();},20000);
      var res=await fetch(apiBase+'/api/route',{method:'POST',signal:ctrl.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      var data=await res.json();clearTimeout(tid);
      if(!res.ok)return _fallback(pairs,fromIdx);
      if(!data.trip||data.trip.status!==0)return _fallback(pairs,fromIdx);
      var all=[],steps=[],legs=[];
      (data.trip.legs||[]).forEach(function(leg){var c=decodeP6(leg.shape||'');all=all.concat(c);var ls=[];(leg.maneuvers||[]).forEach(function(m){var dist=Math.round((m.length||0)*1609.34);var shp=c[m.begin_shape_index];var st={type:m.type===4?'arrive':m.type===1?'depart':'turn',modifier:{0:'',1:'',2:'left',3:'right',4:'arrive',5:'sharp left',6:'sharp right',7:'left',8:'right',9:'uturn',10:'slight left',11:'slight right'}[m.type]||'',name:m.street_names&&m.street_names[0]||'',distance:dist,duration:m.time||0,lat:shp?shp[1]:undefined,lng:shp?shp[0]:undefined};steps.push(st);ls.push(st);});legs.push(ls);});
      _routeCoords=all;routePts=all.filter(function(_,i){return i%3===0;});updateRoute();
      routeIsProper=true;_routeLoading=false;
      postRN({type:'route_ready',routed:true,steps:steps,legs:legs,total_distance:Math.round((data.trip.summary.length||0)*1609.34),total_duration:data.trip.summary.time||0,fromIdx:fromIdx||0});
      postRN({type:'route_persist',coords:all,steps:steps,legs:legs,total_distance:Math.round((data.trip.summary.length||0)*1609.34),total_duration:data.trip.summary.time||0});
    }catch(e){_fallback(pairs,fromIdx);}
  }

  async function loadRoute(){if(wps.length<2)return;await _fetchRoute(wps.map(function(w){return w.lng+','+w.lat;}),0);}
  async function loadRouteFrom(lat,lng,fromIdx){var rem=wps.slice(fromIdx);if(!rem.length){_fallback([],fromIdx);return;}await _fetchRoute([lng+','+lat].concat(rem.map(function(w){return w.lng+','+w.lat;})),fromIdx);}

  // ── Message handler ───────────────────────────────────────────────────────────
  function handleMsgData(msg){
    if(msg.type==='set_token'){
      if(msg.apiBase)apiBase=msg.apiBase;
      if(msg.protomapsKey)protomapsKey=msg.protomapsKey;
      initMap(msg.token,msg.style);
      return;
    }
    if(msg.type==='set_protomaps_key'&&msg.key){
      // Allows updating the Protomaps key after map init (e.g. config arrives
      // late on cold launch). Rebuild the style so tiles re-fetch from CDN.
      protomapsKey=msg.key;
      if(map&&mapReady)map.setStyle(buildStyle(currentStyle));
    }
    if(!mapReady){pendingMsgs.push(msg);return;}
    if(msg.type==='nav_active'){
      navActive=msg.active;
      // Toggle nav-active class on location marker (suppresses pulsing ring in nav mode)
      if(userMarker){userMarker.getElement().classList.toggle('nav-active',msg.active);}
      if(msg.active){
        // Request Wake Lock so screen stays on during navigation
        if('wakeLock' in navigator){navigator.wakeLock.request('screen').then(function(wl){_wakeLock=wl;}).catch(function(){});}
        resetPassedRoute();
      }else{
        map.easeTo({pitch:0,bearing:0,zoom:12,duration:700});
        if(_wakeLock){_wakeLock.release();_wakeLock=null;}
        resetPassedRoute();
      }
    }
    if(msg.type==='user_pos'&&msg.lat){lastSpeed=msg.speed!=null?msg.speed:lastSpeed;setUserPos(msg.lat,msg.lng,false,null,msg.heading);}
    if(msg.type==='nav_center'&&msg.lat){lastSpeed=msg.speed!=null?msg.speed:lastSpeed;setUserPos(msg.lat,msg.lng,true,msg.zoom||17,msg.heading);}
    if(msg.type==='locate'&&msg.lat)setUserPos(msg.lat,msg.lng,true,13);
    if(msg.type==='nav_target')setNavTarget(msg.idx);
    if(msg.type==='nav_reset'){setNavTarget(-1);_routeCoords=[];routePts=[];_searchDest=null;updateRoute();resetPassedRoute();}
    if(msg.type==='restore_route'&&Array.isArray(msg.coords)){
      // Hydrate a previously-fetched route so nav works offline without re-fetching
      _routeCoords=msg.coords;routePts=_routeCoords.filter(function(_,i){return i%3===0;});updateRoute();
      routeIsProper=true;
      postRN({type:'route_ready',routed:true,steps:msg.steps||[],legs:msg.legs||[],total_distance:msg.total_distance,total_duration:msg.total_duration,fromIdx:0});
    }
    if(msg.type==='fly_to'&&msg.lat){
      map.flyTo({center:[msg.lng,msg.lat],zoom:msg.zoom||14,duration:600});
      // Country-level fly-to skips the pin (no point pinpointing the geographic center of CONUS)
      if(msg.zoom&&msg.zoom<=5)return;
      if(searchMarker){searchMarker.remove();searchMarker=null;}
      var el=document.createElement('div');el.className='mk-search';el.textContent='📍';
      searchMarker=new maplibregl.Marker({element:el}).setLngLat([msg.lng,msg.lat]).setPopup(new maplibregl.Popup({offset:18,closeButton:false}).setHTML('<div class="pt">'+(msg.name||'Location')+'</div>')).addTo(map);
      searchMarker.togglePopup();
    }
    if(msg.type==='track_point'&&msg.lat){breadcrumbPts.push([msg.lng,msg.lat]);updateBreadcrumb();}
    if(msg.type==='clear_track'){breadcrumbPts=[];updateBreadcrumb();}
    if(msg.type==='set_camps'){allCamps=msg.pins||[];updateCampSrc();}
    if(msg.type==='set_discover_pins'){allCamps=msg.pins||[];updateCampSrc();}
    if(msg.type==='clear_discover_pins'){allCamps=[];updateCampSrc();}
    if(msg.type==='set_nearby_camps'){allCamps=msg.pins||[];updateCampSrc();}
    if(msg.type==='clear_nearby_camps'){allCamps=[];updateCampSrc();}
    if(msg.type==='set_gas'){allGas=msg.gas||[];updateGasSrc();}
    if(msg.type==='set_pois'){allPois=msg.pois||[];updatePoiSrc();}
    if(msg.type==='clear_pois'){allPois=[];updatePoiSrc();}
    if(msg.type==='set_route_opts')Object.assign(routeOpts,msg.opts||{});
    if(msg.type==='start_route_from'&&msg.lat)loadRouteFrom(msg.lat,msg.lng,msg.fromIdx||0);
    if(msg.type==='reroute_from'&&msg.lat){_routeCoords=[];routePts=[];routeIsProper=false;lastOffCheck=Date.now();resetPassedRoute();_offRouteStreak=0;if(!wps.length&&_searchDest){_fetchRoute([msg.lng+','+msg.lat,_searchDest.lng+','+_searchDest.lat],0);}else{loadRouteFrom(msg.lat,msg.lng,msg.fromIdx||0);}}
    if(msg.type==='route_to_search'&&msg.lat){
      if(searchMarker){searchMarker.remove();searchMarker=null;}
      var el2=document.createElement('div');el2.className='mk-search';el2.textContent='📍';
      searchMarker=new maplibregl.Marker({element:el2}).setLngLat([msg.lng,msg.lat]).setPopup(new maplibregl.Popup({offset:18,closeButton:false}).setHTML('<div class="pt">'+(msg.name||'Destination')+'</div>')).addTo(map);
      searchMarker.togglePopup();
      _searchDest={lat:msg.lat,lng:msg.lng};
      _fetchRoute([msg.userLng+','+msg.userLat,msg.lng+','+msg.lat],0);
    }
    if(msg.type==='set_reports'){allReports=msg.reports||[];updateReportMarkers();}
    if(msg.type==='add_report'){allReports=allReports.filter(function(r){return r.id!==msg.report.id;});allReports.push(msg.report);updateReportMarkers();}
    if(msg.type==='set_style'&&msg.style){currentStyle=msg.style;map.setStyle(buildStyle(msg.style));}
    if(msg.type==='set_land_overlay')setLandOverlay(!!msg.show);
    if(msg.type==='set_usgs_overlay')setUsgsOverlay(!!msg.show);
    if(msg.type==='set_layer'){var _s=!!msg.show;if(msg.layer==='terrain')setTerrainLayer(_s);else if(msg.layer==='naip')setNaipLayer(_s);else if(msg.layer==='fire')setFireLayer(_s);else if(msg.layer==='ava')setAvaLayer(_s);else if(msg.layer==='radar')setRadarLayer(_s);else if(msg.layer==='mvum')setMvumLayer(_s);else if(msg.layer==='roads')setRoadsLayer(_s);}
    if(msg.type==='download_tiles_bbox'){if(!downloadActive){downloadActive=true;_currentDlLabel=msg.label||'';_dlTiles(msg.n,msg.s,msg.e,msg.w,msg.minZ||10,msg.maxZ||12,!!msg.vectorOnly);}}
    if(msg.type==='download_tiles_route'){if(!downloadActive){downloadActive=true;_currentDlLabel=msg.label||'';_dlTilesRoute(msg.bufferKm||20,msg.minZ||10,msg.maxZ||16,!!msg.vectorOnly);}}
    if(msg.type==='download_tiles'){if(!downloadActive){downloadActive=true;_currentDlLabel=msg.label||'';var b=map.getBounds();_dlTiles(b.getNorth(),b.getSouth(),b.getEast(),b.getWest(),msg.minZ||10,msg.maxZ||15,!!msg.vectorOnly);}}
    if(msg.type==='cancel_download'){downloadActive=false;}
    if(msg.type==='clear_cached_region'&&msg.label){(async function(){
      try{
        var c=await caches.open(TILE_CACHE);
        var mkey='manifest-'+msg.label;
        var mresp=await c.match(mkey);
        if(mresp){
          var urls=JSON.parse(await mresp.text());
          for(var i=0;i<urls.length;i++){await c.delete(urls[i]);}
          await c.delete(mkey);
        }
      }catch(e){}
    })();}
  }

  function onMsg(e){try{handleMsgData(JSON.parse(e.data||'{}'));}catch(err){}}
  document.addEventListener('message',onMsg);
  window.addEventListener('message',onMsg);
})();
</script>
</body></html>`;

// ─── Three-needle compass widget ─────────────────────────────────────────────

function ThreeNeedleCompass({ heading, bearing, compact = false }: { heading: number | null; bearing: number | null; compact?: boolean }) {
  const sz = compact ? 34 : 46;
  const half = sz / 2;
  const nLen = compact ? 10 : 13;
  const ringRot = heading !== null && isFinite(heading) ? -heading : 0;
  const bearRot  = heading !== null && isFinite(heading) && bearing !== null && isFinite(bearing) ? bearing - heading : null;
  return (
    <View style={{ width: sz, height: sz }}>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        borderRadius: half, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' }} />
      {/* Rotating ring — N label + north needle */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        alignItems: 'center', justifyContent: 'flex-start',
        transform: [{ rotate: `${ringRot}deg` }] }}>
        <Text style={{ color: '#ef4444', fontSize: compact ? 7 : 8, fontWeight: '900', fontFamily: mono, lineHeight: compact ? 8 : 10, marginTop: 1 }}>N</Text>
        <View style={{ width: 1.5, height: nLen - 2, backgroundColor: '#ef4444', borderRadius: 1 }} />
      </View>
      {/* South side of ring */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        alignItems: 'center', justifyContent: 'flex-end',
        transform: [{ rotate: `${ringRot}deg` }] }}>
        <View style={{ width: 1.5, height: 8, backgroundColor: '#374151', borderRadius: 1, marginBottom: 2 }} />
      </View>
      {/* Course needle — orange, always points up (direction of travel) */}
      <View style={{ position: 'absolute', top: half - nLen, left: half - 1, width: 2, height: nLen, backgroundColor: '#f97316', borderRadius: 1 }} />
      {/* Waypoint bearing needle — blue */}
      {bearRot !== null && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          alignItems: 'center', justifyContent: 'flex-start',
          transform: [{ rotate: `${bearRot}deg` }] }}>
          <View style={{ marginTop: half - nLen, width: 1.5, height: nLen, backgroundColor: '#3b82f6', borderRadius: 1 }} />
        </View>
      )}
      {/* Center pin */}
      <View style={{ position: 'absolute', top: half - 3, left: half - 3, width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff', zIndex: 10 }} />
    </View>
  );
}

// ─── Error boundary ───────────────────────────────────────────────────────────

class MapErrorBoundary extends Component<{ children: React.ReactNode }, { error: string | null }> {
  state = { error: null };
  static getDerivedStateFromError(e: any) { return { error: e?.message ?? String(e) }; }
  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, backgroundColor: '#0a0f0a', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Text style={{ color: '#ef4444', fontSize: 14, fontWeight: '900', marginBottom: 12 }}>MAP ERROR</Text>
          <Text style={{ color: '#e4ddd2', fontSize: 11, fontFamily: 'Courier', textAlign: 'center', lineHeight: 18 }}>
            {this.state.error}
          </Text>
          <TouchableOpacity onPress={() => this.setState({ error: null })} style={{ marginTop: 20, backgroundColor: '#22c55e', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 }}>
            <Text style={{ color: '#fff', fontWeight: '800' }}>RETRY</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

// ─── Screen ───────────────────────────────────────────────────────────────────

function MapScreen() {
  const C = useTheme();
  const OVR = useMemo(() => overlayPalette(C), [C]);
  const s = useMemo(() => makeStyles(C), [C]);
  const router = useRouter();
  const activeTrip = useStore(st => st.activeTrip);
  const setActiveTrip = useStore(st => st.setActiveTrip);
  const activeTripFromCache = useStore(st => st.activeTripFromCache);
  const user = useStore(st => st.user);
  const setStoreLoc = useStore(st => st.setUserLoc);
  const setStoreToken = useStore(st => st.setMapboxToken);
  const liveReports = useStore(st => st.liveReports);
  const addLiveReport = useStore(st => st.addLiveReport);
  const cachedRegions = useStore(st => st.cachedRegions);
  const addCachedRegion    = useStore(st => st.addCachedRegion);
  const removeCachedRegion = useStore(st => st.removeCachedRegion);
  const rigProfile = useStore(st => st.rigProfile);
  const webRef       = useRef<WebView>(null);
  const nativeMapRef = useRef<NativeMapHandle>(null);
  const navVoiceRef  = useRef<string | undefined>(undefined);

  // Load best available TTS voice — prefer natural iOS voices over robotic default
  useEffect(() => {
    Speech.getAvailableVoicesAsync().then(voices => {
      const en = voices.filter(v => v.language === 'en-US' || v.language?.startsWith('en-US'));
      // Priority: Siri (most natural) → named quality voices → premium/enhanced generic
      const best = en.find(v => /siri_female|Nicky|Samantha|Karen/i.test(v.identifier ?? ''))
                ?? en.find(v => v.identifier?.includes('premium'))
                ?? en.find(v => v.identifier?.includes('enhanced'))
                ?? en.find(v => /premium|enhanced/i.test(String(v.quality ?? '')));
      navVoiceRef.current = best?.identifier;
    }).catch(() => {});
  }, []);

  const safeSpeech = (text: string, opts?: Parameters<typeof Speech.speak>[1]) => {
    try {
      // Stop any in-progress speech so new announcement isn't delayed/jumbled
      Speech.stop();
      Speech.speak(text, {
        rate: 0.9,    // slightly faster than default = more natural
        pitch: 1.0,   // natural pitch (0.88 was slightly robotic)
        language: 'en-US',
        ...(opts ?? {}),
        ...(navVoiceRef.current ? { voice: navVoiceRef.current } : {}),
      });
    } catch {}
  };

  const [userLoc,       setUserLoc]       = useState<{ lat: number; lng: number } | null>(null);
  const [userSpeed,     setUserSpeed]     = useState<number | null>(null);
  const [userHeading,   setUserHeading]   = useState<number | null>(null);
  const [quickReport,   setQuickReport]   = useState(false);
  const [controlsCollapsed, setControlsCollapsed] = useState(false);
  const [quickToast,    setQuickToast]    = useState('');
  const [quickTypeIdx,  setQuickTypeIdx]  = useState<number | null>(null);
  const [navMode,   setNavMode]   = useState(false);
  const [navIdx,    setNavIdx]    = useState(0);
  const [routeSteps,  setRouteSteps]  = useState<RouteStep[]>([]);
  const [isRouted,    setIsRouted]    = useState(false);
  const [routeFromCache, setRouteFromCache] = useState(false);
  const [routeDebug, setRouteDebug] = useState('');
  const [mapLayer,    setMapLayerState] = useState<MapLayer>('topo');
  const [showLands,   setShowLands]    = useState(false);
  const [showUsgs,    setShowUsgs]     = useState(false);
  const [audioGuide,  setAudioGuide]   = useState<Record<string, string>>({});
  const [showSteps,   setShowSteps]    = useState(false);
  const [showPanel,   setShowPanel]    = useState(true);
  const [selectedDay, setSelectedDay]  = useState<number | null>(null);
  const [routeAlerts, setRouteAlerts]  = useState<Report[]>([]);
  const [showAlerts,  setShowAlerts]   = useState(false);
  const [communityPins, setCommunityPins] = useState<Pin[]>([]);
  const [routeLegs,    setRouteLegs]    = useState<RouteStep[][]>([]);
  const [lastRouteCoords, setLastRouteCoords] = useState<[number,number][]>([]);
  const [selectOnMapMode, setSelectOnMapMode] = useState(false);
  const [searchQuery,  setSearchQuery]  = useState('');
  const [searchResults,setSearchResults] = useState<{ lat: number; lng: number; name: string }[]>([]);
  const [showSearch,   setShowSearch]   = useState(false);
  const [isSearching,  setIsSearching]  = useState(false);
  const [routeLegOffset, setRouteLegOffset] = useState(0);
  const [isApproaching,  setIsApproaching]  = useState(false);
  const [isRerouting,    setIsRerouting]    = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadTotal, setDownloadTotal] = useState(0);
  const [downloadSaved, setDownloadSaved] = useState(0);
  const [downloadMB, setDownloadMB] = useState('0');
  const [downloadLabel, setDownloadLabel] = useState('');
  const offlineSaved = cachedRegions.length > 0;
  const [mapboxToken,   setMapboxToken]   = useState('');
  const [protomapsKey,  setProtomapsKey]  = useState('');
  const [showFilters,   setShowFilters]   = useState(false);
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [activePinFilters, setActivePinFilters] = useState<string[]>([]);
  const [pinDropMode, setPinDropMode] = useState(false);
  const [pendingPin, setPendingPin] = useState<{ lat: number; lng: number } | null>(null);
  const [pinType, setPinType] = useState<CommunityPinTypeId>('camp');
  const [pinName, setPinName] = useState('');
  const [pinDescription, setPinDescription] = useState('');
  const [pinSubmitting, setPinSubmitting] = useState(false);
  const [selectedCommunityPin, setSelectedCommunityPin] = useState<Pin | null>(null);
  const [selectedCamp,  setSelectedCamp]  = useState<CampsitePin | null>(null);
  const [campDetail,    setCampDetail]    = useState<CampsiteDetail | null>(null);
  const [showCampDetail,setShowCampDetail] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Field reports
  const [fieldReports,      setFieldReports]      = useState<CampFieldReport[]>([]);
  const [fieldReportSummary,setFieldReportSummary] = useState<FieldReportSummary | null>(null);
  const [showFieldReportForm, setShowFieldReportForm] = useState(false);
  const [frSentiment,  setFrSentiment]  = useState<FieldReportSentiment | null>(null);
  const [frAccess,     setFrAccess]     = useState<FieldReportAccess | null>(null);
  const [frCrowd,      setFrCrowd]      = useState<FieldReportCrowd | null>(null);
  const [frTags,       setFrTags]       = useState<string[]>([]);
  const [frNote,       setFrNote]       = useState('');
  const [frPhoto,      setFrPhoto]      = useState<string | null>(null);
  const [frSubmitting, setFrSubmitting] = useState(false);
  const [isSearchingCamps, setIsSearchingCamps] = useState(false);
  const [paywallVisible, setPaywallVisible] = useState(false);
  const [paywallCode, setPaywallCode] = useState('');
  const [paywallMessage, setPaywallMessage] = useState('');


  // POI layer
  const [showPois, setShowPois] = useState(false);
  const [pois,     setPois]     = useState<OsmPoi[]>([]);
  const showPoisRef    = useRef(false);
  const lastPoiFetchRef = useRef<{lat: number; lng: number} | null>(null);

  // Route options
  const [routeOpts,      setRouteOpts]      = useState<RouteOpts>({ avoidTolls: false, avoidHighways: false, backRoads: false, noFerries: false });
  const [showRouteOpts,  setShowRouteOpts]  = useState(false);
  const [searchRouteCard,setSearchRouteCard]= useState<SearchPlace | null>(null);

  // Offline state modal
  const [showOfflineModal,  setShowOfflineModal]  = useState(false);
  const [offlineWarning,    setOfflineWarning]    = useState(false);
  const [isActuallyOffline, setIsActuallyOffline] = useState(false);

  // AI & Wikipedia in campsite detail
  const [campInsight,    setCampInsight]    = useState<CampsiteInsight | null>(null);
  const [loadingInsight, setLoadingInsight] = useState(false);
  const [wikiArticles,   setWikiArticles]   = useState<WikiArticle[]>([]);
  const [loadingWiki,    setLoadingWiki]    = useState(false);

  // Camp fullness
  const [campFullness,   setCampFullness]   = useState<CampFullness | null>(null);
  const [fullnessVoting, setFullnessVoting] = useState(false);

  // Camp card extras
  const [campWeather,    setCampWeather]    = useState<WeatherForecast | null>(null);

  // Favorites
  const favoriteCamps  = useStore(s => s.favoriteCamps);
  const toggleFavorite = useStore(s => s.toggleFavorite);

  // Route brief
  const [routeBrief,    setRouteBrief]    = useState<RouteBrief | null>(null);
  const [showRouteBrief,setShowRouteBrief]= useState(false);
  const [loadingBrief,  setLoadingBrief]  = useState(false);

  // Packing list
  const [packingList,   setPackingList]   = useState<PackingList | null>(null);
  const [showPacking,   setShowPacking]   = useState(false);
  const [loadingPacking,setLoadingPacking]= useState(false);

  // Cached route weather (loaded from FileSystem)
  const [cachedWeather, setCachedWeather] = useState<RouteWeatherResult | null>(null);

  const [navDest, setNavDest] = useState<WP | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [approachingReport, setApproachingReport] = useState<Report | null>(null);
  const [offRouteWarn, setOffRouteWarn] = useState(false);
  const offRouteWarnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rerouteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showDayModal, setShowDayModal] = useState(false);
  const [tappedWp, setTappedWp] = useState<{ idx: number; wp: WP } | null>(null);
  const [campPickerVisible, setCampPickerVisible] = useState(false);
  const [campPickerLoading, setCampPickerLoading] = useState(false);
  const [campPickerDay, setCampPickerDay] = useState<number | null>(null);
  const [campPickerError, setCampPickerError] = useState('');
  const [campCandidates, setCampCandidates] = useState<CampsitePin[]>([]);

  // Dynamic map layers
  const [showLayerSheet, setShowLayerSheet] = useState(false);
  const [layerTerrain, setLayerTerrain] = useState(false);
  const [layerNaip,    setLayerNaip]    = useState(false);
  const [layerFire,    setLayerFire]    = useState(false);
  const [layerAva,     setLayerAva]     = useState(false);
  const [layerRadar,   setLayerRadar]   = useState(false);
  const [layerMvum,    setLayerMvum]    = useState(false);
  const [layerRoads,   setLayerRoads]   = useState(false);
  const [tappedTrail, setTappedTrail] = useState<{ name: string; lat: number; lng: number; cls: string } | null>(null);
  const [tappedTileSpot, setTappedTileSpot] = useState<{ name: string; kind: string; lat: number; lng: number } | null>(null);
  const [tappedGas,  setTappedGas]  = useState<{ name: string; lat: number; lng: number } | null>(null);
  const [tappedPoi,  setTappedPoi]  = useState<{ name: string; type: string; lat: number; lng: number } | null>(null);

  // Connectivity sync toast
  const [syncToast, setSyncToast] = useState('');
  const syncToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Land check card
  const [landCheck,        setLandCheck]        = useState<LandCheck | null>(null);
  const [landCheckLoading, setLandCheckLoading] = useState(false);
  const landCheckDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const navAnim      = useRef(new Animated.Value(0)).current;
  const navRef       = useRef({ active: false, idx: 0, wps: [] as WP[] });
  const navDestRef   = useRef<WP | null>(null);
  const guideRef     = useRef<Record<string, string>>({});
  const spokenRef    = useRef(new Set<string>());
  const stepIdxRef       = useRef(0);
  const routeStepsRef    = useRef<RouteStep[]>([]);
  const stepAnnouncedRef = useRef(new Set<number>());
  const isReroutingRef   = useRef(false);
  const lastRerouteRef   = useRef(0);
  const liveReportsRef   = useRef<Report[]>([]);
  const routeAlertsRef   = useRef<Report[]>([]);
  const alertedRepIdsRef = useRef(new Set<number>());
  const approachDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userSpeedRef     = useRef<number | null>(null);
  const smoothedHdgRef   = useRef<number | null>(null);
  const compassHdgRef    = useRef<number | null>(null);
  const courseHdgRef     = useRef<number | null>(null);
  const discoverRef  = useRef<CampsitePin[]>([]);

  const webLoadedRef = useRef(false);
  const viewportRef  = useRef<{ n: number; s: number; e: number; w: number; zoom: number } | null>(null);
  const lastPinFetchRef = useRef<{ lat: number; lng: number; ts: number } | null>(null);
  const [isLoadingAreaCamps, setIsLoadingAreaCamps] = useState(false);
  const [areaCamps, setAreaCamps] = useState<CampsitePin[]>([]);
  const [mapMoved, setMapMoved] = useState(false);
  const [mapZoom, setMapZoom] = useState(10);
  const [searchResult, setSearchResult] = useState<{ count: number } | null>(null);
  const [mapLoadFailed, setMapLoadFailed] = useState(false);
  const [showLocDisclosure, setShowLocDisclosure] = useState(false);

  const [nearbyLoading,   setNearbyLoading]   = useState(false);
  const [nearbyNarration, setNearbyNarration] = useState<string | null>(null);

  // Fetch Mapbox token + Protomaps key once on mount; fall back to cached when offline
  useEffect(() => {
    function applyConfig(token: string, pmKey: string) {
      if (token) { setMapboxToken(token); setStoreToken(token); }
      if (pmKey) setProtomapsKey(pmKey);
      if (webLoadedRef.current) {
        webRef.current?.postMessage(JSON.stringify({
          type: 'set_token', token,
          style: MAP_MODES[mapLayer] ?? MAP_MODES.satellite,
          apiBase: process.env.EXPO_PUBLIC_API_URL ?? 'https://api.gettrailhead.app',
          protomapsKey: pmKey,
        }));
      }
    }
    api.getConfig().then(c => {
      const token = c.mapbox_token || '';
      const pmKey = c.protomaps_key || '';
      if (token) storage.set('trailhead_mapbox_token', token).catch(() => {});
      if (pmKey) storage.set('trailhead_protomaps_key', pmKey).catch(() => {});
      applyConfig(token, pmKey);
      setIsActuallyOffline(false); // confirmed online
    }).catch(() => {
      setIsActuallyOffline(true);
      // Offline — use cached values so the map can load from tile cache
      Promise.all([
        storage.get('trailhead_mapbox_token').catch(() => null),
        storage.get('trailhead_protomaps_key').catch(() => null),
      ]).then(([t, k]) => applyConfig(t || '', k || ''));
    });
  }, []);

  // Load cached route weather from FileSystem when active trip changes
  useEffect(() => {
    if (!activeTrip) { setCachedWeather(null); return; }
    const path = `${FileSystem.documentDirectory}weather_${activeTrip.trip_id}.json`;
    FileSystem.readAsStringAsync(path, { encoding: FileSystem.EncodingType.UTF8 })
      .then(raw => { try { setCachedWeather(JSON.parse(raw)); } catch { setCachedWeather(null); } })
      .catch(() => setCachedWeather(null));
  }, [activeTrip?.trip_id]);

  // Keep refs in sync
  useEffect(() => {
    navRef.current.active = navMode;
    // Keep screen alive during navigation — phone would otherwise sleep in 15s
    if (navMode) {
      activateKeepAwakeAsync('navigation');
    } else {
      deactivateKeepAwake('navigation');
    }
    return () => { deactivateKeepAwake('navigation'); };
  }, [navMode]);
  useEffect(() => { isReroutingRef.current = isRerouting; }, [isRerouting]);

  // Sync report refs + push combined list to WebView whenever either changes
  useEffect(() => {
    liveReportsRef.current = liveReports;
    const all = [...liveReports, ...routeAlertsRef.current];
    webRef.current?.postMessage(JSON.stringify({ type: 'set_reports', reports: all }));
    // Push just the new live report individually too (in case map isn't ready yet the set_reports will catch it)
    if (liveReports.length > 0) {
      webRef.current?.postMessage(JSON.stringify({ type: 'add_report', report: liveReports[0] }));
    }
  }, [liveReports]);

  useEffect(() => {
    routeAlertsRef.current = routeAlerts;
    const all = [...liveReportsRef.current, ...routeAlerts];
    webRef.current?.postMessage(JSON.stringify({ type: 'set_reports', reports: all }));
  }, [routeAlerts]);

  const mapReports = useMemo(() => {
    const seen = new Set<number>();
    return [...liveReports, ...routeAlerts].filter(r => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });
  }, [liveReports, routeAlerts]);

  // Keep routeStepsRef in sync; reset step index on each new route
  useEffect(() => {
    routeStepsRef.current = routeSteps;
    const firstReal = routeSteps.findIndex(s => s.type !== 'depart');
    const init = firstReal >= 0 ? firstReal : 0;
    setStepIdx(init);
    stepIdxRef.current = init;
    stepAnnouncedRef.current.clear();
  }, [routeSteps]);
  useEffect(() => { navRef.current.idx = navIdx; }, [navIdx]);
  useEffect(() => { guideRef.current = audioGuide; }, [audioGuide]);

  // Recompute when trip changes OR when geocoding populates lat/lng on waypoints
  const geocodedCount = activeTrip?.plan.waypoints.filter(w => w.lat && w.lng).length ?? 0;
  const waypoints: WP[] = useMemo(() =>
    (activeTrip?.plan.waypoints ?? [])
      .filter(w => w.lat != null && w.lng != null && isFinite(w.lat) && isFinite(w.lng))
      .map(w => ({ lat: w.lat!, lng: w.lng!, name: w.name, day: w.day, type: w.type })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeTrip?.trip_id, geocodedCount]
  );

  useEffect(() => { navRef.current.wps = waypoints; }, [waypoints]);

  const refreshCommunityPins = useCallback((
    center?: { lat: number; lng: number } | null,
    radiusDeg = 3.0,
    force = false,
  ) => {
    const vp = viewportRef.current;
    const target = center
      ?? (vp ? { lat: (vp.n + vp.s) / 2, lng: (vp.e + vp.w) / 2 } : null)
      ?? userLoc
      ?? (waypoints[0] ? { lat: waypoints[0].lat, lng: waypoints[0].lng } : null);
    if (!target || !Number.isFinite(target.lat) || !Number.isFinite(target.lng)) return;

    const last = lastPinFetchRef.current;
    const movedKm = last ? haversineKm(last.lat, last.lng, target.lat, target.lng) : Infinity;
    const recently = last ? Date.now() - last.ts < 45_000 : false;
    if (!force && movedKm < 8 && recently) return;

    lastPinFetchRef.current = { lat: target.lat, lng: target.lng, ts: Date.now() };
    api.getNearbyPins(target.lat, target.lng, radiusDeg)
      .then(setCommunityPins)
      .catch(() => {});
  }, [userLoc?.lat, userLoc?.lng, waypoints]);

  // ── Location watch ──────────────────────────────────────────────────────────

  const [locGranted, setLocGranted] = useState(false);

  // On mount: check if already granted; otherwise show disclosure first
  useEffect(() => {
    Location.getForegroundPermissionsAsync().then(({ status }) => {
      if (status === 'granted') setLocGranted(true);
      else setShowLocDisclosure(true);
    }).catch(() => setShowLocDisclosure(true));
  }, []);

  // Start watch only after permission is confirmed granted
  useEffect(() => {
    if (!locGranted) return;
    let sub: Location.LocationSubscription | null = null;
    let headingSub: Location.LocationSubscription | null = null;
    Location.watchHeadingAsync(h => {
      const raw = h.trueHeading != null && h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
      if (raw == null || raw < 0 || !Number.isFinite(raw)) return;
      const smooth = smoothAngle(compassHdgRef.current, raw, 0.32);
      compassHdgRef.current = smooth;
      setUserHeading(smooth);
      if ((userSpeedRef.current ?? 0) < 1.2) {
        smoothedHdgRef.current = smooth;
      }
    }).then(s => { headingSub = s; }).catch(() => {});
    Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 5 },
      loc => {
          const pos = { lat: loc.coords.latitude, lng: loc.coords.longitude };
          setUserLoc(pos);
          setStoreLoc(pos);
          const rawSpeed = loc.coords.speed ?? null;
          setUserSpeed(rawSpeed);
          userSpeedRef.current = rawSpeed;

          // GPS heading is course-over-ground, not a reliable compass while stopped.
          // Use course for map-follow when moving; use watchHeadingAsync for the UI compass.
          const rawCourse = (loc.coords.heading ?? -1);
          const speedMs = rawSpeed ?? 0;
          let hdg = -1;
          if (speedMs > 1.2 && rawCourse >= 0) {
            const s = smoothAngle(courseHdgRef.current, rawCourse, 0.28);
            courseHdgRef.current = s;
            smoothedHdgRef.current = s;
            hdg = s;
          } else if (compassHdgRef.current !== null) {
            hdg = compassHdgRef.current;
            smoothedHdgRef.current = hdg;
          } else if (speedMs <= 0.8) {
            // No compass + parked: point toward next step as a last resort.
            const cur = routeStepsRef.current[stepIdxRef.current];
            if (cur?.lat != null) {
              hdg = calcBearing(pos.lat, pos.lng, cur.lat!, cur.lng!);
              smoothedHdgRef.current = hdg;
            } else {
              hdg = smoothedHdgRef.current ?? -1;
            }
          } else {
            hdg = smoothedHdgRef.current ?? -1;
          }
          if (compassHdgRef.current === null) setUserHeading(hdg >= 0 ? hdg : null);

          const { active, idx, wps } = navRef.current;
          webRef.current?.postMessage(JSON.stringify({
            type: active ? 'nav_center' : 'user_pos',
            lat: pos.lat, lng: pos.lng, heading: hdg, speed: rawSpeed,
            zoom: active ? navZoom(rawSpeed) : undefined,
          }));

          if (active) {
            webRef.current?.postMessage(JSON.stringify({ type: 'track_point', lat: pos.lat, lng: pos.lng }));
          }

          if (!active) return;

          // ── Step advancement + two-phase speed-based announcements ──────
          {
            const steps = routeStepsRef.current;
            const si    = stepIdxRef.current;
            const cur   = steps[si];
            if (cur?.lat != null && cur?.lng != null) {
              const distM = haversineKm(pos.lat, pos.lng, cur.lat, cur.lng) * 1000;
              const speedMph = (userSpeedRef.current ?? 0) * 2.237;
              const [previewDist, prepareDist, actionDist] = announceDists(speedMph > 0 ? speedMph : null, cur.modifier);
              const previewKey = si * 3;       // "In 1 mile, turn left on Main St"
              const prepareKey = si * 3 + 1;   // "In 500 feet, turn left"
              const actionKey  = si * 3 + 2;   // "Turn left" (right at the moment)

              if (cur.type !== 'depart' && cur.type !== 'arrive') {
                // Phase 1 — preview (far warning, only fires outside prepare zone)
                if (distM < previewDist && distM >= prepareDist && !stepAnnouncedRef.current.has(previewKey)) {
                  stepAnnouncedRef.current.add(previewKey);
                  safeSpeech(buildAnnouncement(cur, distM, 'far'), { rate: 0.88, pitch: 1.05, language: 'en-US' });
                }
                // Phase 2 — prepare: slow down + get in lane
                if (distM < prepareDist && !stepAnnouncedRef.current.has(prepareKey)) {
                  stepAnnouncedRef.current.add(prepareKey);
                  Speech.stop();
                  safeSpeech(buildAnnouncement(cur, distM, 'near'), { rate: 0.88, pitch: 1.05, language: 'en-US' });
                }
                // Phase 3 — action: turn NOW, haptic so driver feels it
                if (distM < actionDist && !stepAnnouncedRef.current.has(actionKey)) {
                  stepAnnouncedRef.current.add(actionKey);
                  Speech.stop();
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
                  safeSpeech(buildAnnouncement(cur, distM, 'action'), { rate: 0.88, pitch: 1.1, language: 'en-US' });
                }
              }

              // Advance to next step — threshold scales with speed so fast travel advances slightly earlier
              const advThreshold = Math.max(20, (userSpeedRef.current ?? 0) * 1.5);
              if (distM < advThreshold && si < steps.length - 1) {
                const next = si + 1;
                stepIdxRef.current = next;
                setStepIdx(next);
                // Reset all 3 announcement keys for the new step
                stepAnnouncedRef.current.delete(next * 3);
                stepAnnouncedRef.current.delete(next * 3 + 1);
                stepAnnouncedRef.current.delete(next * 3 + 2);

                // "Turn complete" + next maneuver preview — the most important GPS UX moment
                const nextStep = steps[next];
                const stepAfter = steps[next + 1];
                if (nextStep && nextStep.type !== 'arrive' && nextStep.type !== 'depart') {
                  const contDist = speakDist(nextStep.distance);
                  if (stepAfter && stepAfter.type !== 'arrive') {
                    const thenAction = stepSpeak(stepAfter.type, stepAfter.modifier ?? '', stepAfter.name);
                    const thenRoad   = stepAfter.name ? ` on ${stepAfter.name}` : '';
                    // Small delay so it doesn't overlap the near-arrival speech that might still be finishing
                    setTimeout(() => {
                      safeSpeech(`Continue for ${contDist}, then ${thenAction}${thenRoad}.`, { rate: 0.88, pitch: 1.05, language: 'en-US' });
                    }, 800);
                  } else {
                    setTimeout(() => {
                      safeSpeech(`Continue for ${contDist}.`, { rate: 0.88, pitch: 1.05, language: 'en-US' });
                    }, 800);
                  }
                  // "Continue for X, then Y" serves as preview — mark preview key so it won't double-fire
                  stepAnnouncedRef.current.add(next * 3);
                }
              }
            }
          }

          // ── Approaching report alert (Waze-style 1-mile warning) ──────────
          {
            const allReps = [...liveReportsRef.current, ...routeAlertsRef.current];
            // Speed-aware alert distance — give ~45 seconds of warning like Waze
            const speedMps = userSpeedRef.current ?? 0;
            const alertDistM = Math.max(400, Math.min(speedMps * 45, 2500));
            for (const rep of allReps) {
              if (alertedRepIdsRef.current.has(rep.id)) continue;
              const repDistM = haversineKm(pos.lat, pos.lng, rep.lat, rep.lng) * 1000;
              if (repDistM < alertDistM && repDistM > 30) {
                alertedRepIdsRef.current.add(rep.id);
                setApproachingReport(rep);
                // Waze-style clear labels — short, punchy, no redundant "ahead" suffix
                const labels: Record<string, string> = {
                  police:         'Police ahead',
                  hazard:         'Hazard ahead',
                  road_condition: 'Road condition ahead',
                  wildlife:       'Wildlife on road',
                  road_closure:   'Road closure ahead',
                  campsite:       'Campsite report',
                  water:          'Water source nearby',
                };
                const label = labels[rep.type] ?? 'Obstacle ahead';
                // Announce with distance only — label already includes "ahead"
                safeSpeech(
                  repDistM < 200 ? label
                    : `${label}, ${speakDist(repDistM)}.`
                );
                if (approachDismissRef.current) clearTimeout(approachDismissRef.current);
                approachDismissRef.current = setTimeout(() => setApproachingReport(null), 15000);
                break; // one alert at a time
              }
            }
          }

          // Single-destination nav (from search) — no trip waypoints
          const singleDest = navDestRef.current;
          if (!wps[idx] && singleDest) {
            const dist = haversineKm(pos.lat, pos.lng, singleDest.lat, singleDest.lng);
            setIsApproaching(dist < 0.8);
            if (dist < 0.25) {
              safeSpeech(`You have arrived at ${singleDest.name}.`, { rate: 0.88, pitch: 1.05, language: 'en-US' });
              setTimeout(() => setNavMode(false), 3000);
            }
            return;
          }
          if (!wps[idx]) return;

          const dist = haversineKm(pos.lat, pos.lng, wps[idx].lat, wps[idx].lng);

          // Approaching indicator (within 800m)
          setIsApproaching(dist < 0.8);

          // Speak audio guide narration when close
          const narration = guideRef.current[wps[idx].name];
          if (dist < 0.5 && narration && !spokenRef.current.has(wps[idx].name)) {
            spokenRef.current.add(wps[idx].name);
            safeSpeech(narration, { rate: 0.88, language: 'en-US' });
          }

          // Arrival at final destination
          if (dist < 0.25 && idx === wps.length - 1) {
            safeSpeech(`You have arrived at ${wps[idx].name}. Journey complete.`, { rate: 0.88, pitch: 1.05, language: 'en-US' });
            setTimeout(() => setNavMode(false), 3000);
            return;
          }

          // Auto-advance to next waypoint + reroute from current position
          if (dist < 0.25 && idx < wps.length - 1) {
            const next = idx + 1;
            setNavIdx(next);
            navRef.current.idx = next;
            setIsApproaching(false);
            webRef.current?.postMessage(JSON.stringify({ type: 'nav_target', idx: next }));
            webRef.current?.postMessage(JSON.stringify({
              type: 'start_route_from',
              lat: pos.lat, lng: pos.lng, fromIdx: next,
            }));
            nativeMapRef.current?.setNavTarget(next);
            nativeMapRef.current?.loadRouteFrom(pos.lat, pos.lng, next);
            setRouteLegOffset(next);
            safeSpeech(`Arrived at ${wps[idx].name}. Now heading to ${wps[next].name}.`, { rate: 0.88, pitch: 1.05, language: 'en-US' });
          }
        }
    ).then(s => { sub = s; }).catch(() => {});
    return () => { sub?.remove(); headingSub?.remove(); };
  }, [locGranted]);

  // ── Trip data ───────────────────────────────────────────────────────────────

  // Geocode any waypoints that are missing lat/lng (backend geocoding sometimes partial)
  useEffect(() => {
    if (!activeTrip) return;
    const missing = activeTrip.plan.waypoints.filter(w => !w.lat || !w.lng);
    if (missing.length > 0) {
      Promise.all(missing.map(async wp => {
        try {
          const r = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(wp.name)}&format=json&limit=1&countrycodes=us`,
            { headers: { 'User-Agent': 'Trailhead/1.0' } }
          );
          const d = await r.json();
          if (d[0]) { wp.lat = parseFloat(d[0].lat); wp.lng = parseFloat(d[0].lon); }
        } catch {}
      })).then(() => {
        // Force useMemo to re-evaluate by creating a shallow clone of activeTrip
        useStore.getState().setActiveTrip({ ...activeTrip, plan: { ...activeTrip.plan, waypoints: [...activeTrip.plan.waypoints] } });
      }).catch(() => {});
    }
  }, [activeTrip?.trip_id]);

  useEffect(() => {
    if (!activeTrip) return;
    const wps = activeTrip.plan.waypoints.filter(w => w.lat && w.lng);
    if (!wps.length) return;
    const center = wps[Math.floor(wps.length / 2)];
    if (center.lat && center.lng) {
      refreshCommunityPins({ lat: center.lat!, lng: center.lng! }, 3.0, true);
      // Load camps + POIs around the trip center so pins appear without requiring a manual search
      const bounds = {
        n: center.lat! + 1.5, s: center.lat! - 1.5,
        e: center.lng! + 1.5, w: center.lng! - 1.5, zoom: 9,
      };
      loadCampsInArea(bounds, activeFilters);
      fetchPois({ lat: center.lat!, lng: center.lng! });
    }
    api.getReportsAlongRoute(wps).then(alerts => {
      setRouteAlerts(alerts);
      if (alerts.some(a => a.severity === 'critical' || a.severity === 'high')) setShowAlerts(true);
    }).catch(() => {});
    // Pre-load audio guide
    if (activeTrip.audio_guide) {
      setAudioGuide(activeTrip.audio_guide);
    } else {
      api.getAudioGuide(activeTrip.trip_id).then(setAudioGuide).catch(() => {});
    }
    setNavIdx(0); setNavMode(false); setRouteSteps([]); setIsRouted(false);
    spokenRef.current.clear();
  }, [activeTrip?.trip_id]);

  // ── Opportunistic background sync ──────────────────────────────────────────
  useConnectivitySync({
    activeTrip,
    onWeatherUpdate: (weather) => {
      setCachedWeather(weather);
      setIsActuallyOffline(false); // if weather updated, we're online
    },
    onSyncComplete: () => {
      if (syncToastTimer.current) clearTimeout(syncToastTimer.current);
      setSyncToast('Signal found — weather updated');
      syncToastTimer.current = setTimeout(() => setSyncToast(''), 3500);
      setIsActuallyOffline(false);
    },
    onReportRefresh: () => {
      if (!activeTrip) return;
      const wps = activeTrip.plan.waypoints.filter(w => w.lat && w.lng);
      if (wps.length) {
        api.getReportsAlongRoute(wps).then(alerts => {
          setRouteAlerts(alerts);
        }).catch(() => {});
      }
    },
  });

  // ── Reload camps in current viewport whenever filters change ──────────────
  useEffect(() => {
    if (!viewportRef.current) return;
    loadCampsInArea(viewportRef.current, activeFilters);
  }, [activeFilters]);

  // Auto-load camps when userLoc first becomes available + map is ready
  const autoLoadedRef = useRef(false);
  useEffect(() => {
    if (!userLoc || autoLoadedRef.current) return;
    autoLoadedRef.current = true;
    const deg = 0.5;
    const bounds = { n: userLoc.lat + deg, s: userLoc.lat - deg, e: userLoc.lng + deg, w: userLoc.lng - deg, zoom: 10 };
    viewportRef.current = bounds;
    loadCampsInArea(bounds, activeFilters);
    refreshCommunityPins(userLoc, 3.0, true);
  }, [userLoc]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') refreshCommunityPins(null, 3.0, true);
    });
    return () => sub.remove();
  }, [refreshCommunityPins]);

  // POI layer
  useEffect(() => { showPoisRef.current = showPois; }, [showPois]);

  function fetchPois(center: { lat: number; lng: number }) {
    lastPoiFetchRef.current = center;
    api.getOsmPois(center.lat, center.lng, 40, 'water,trailhead,viewpoint,peak,hot_spring')
      .then(p => {
        setPois(p);
        webRef.current?.postMessage(JSON.stringify({ type: 'set_pois', pois: p }));
      })
      .catch(() => {});
  }

  function beginCommunityPinDrop(useCurrentLocation = false) {
    setQuickReport(false);
    setQuickTypeIdx(null);
    setSelectedCamp(null);
    setTappedTrail(null);
    setTappedTileSpot(null);
    setTappedGas(null);
    setTappedPoi(null);
    setSelectedCommunityPin(null);
    if (useCurrentLocation && userLoc) {
      setPendingPin(userLoc);
      setPinName('');
      setPinDescription('');
      return;
    }
    setPinDropMode(true);
    setQuickToast('Tap anywhere on the map to place a community pin');
    setTimeout(() => setQuickToast(''), 4000);
  }

  async function submitCommunityPin() {
    if (!pendingPin || pinSubmitting) return;
    const meta = communityPinMeta(pinType);
    const name = (pinName.trim() || meta.label).slice(0, 80);
    setPinSubmitting(true);
    try {
      await api.submitPin({
        lat: pendingPin.lat,
        lng: pendingPin.lng,
        type: pinType,
        name,
        description: pinDescription.trim(),
        land_type: '',
      });
      const created: Pin = {
        id: Date.now(),
        lat: pendingPin.lat,
        lng: pendingPin.lng,
        type: pinType,
        name,
        description: pinDescription.trim(),
        land_type: '',
        upvotes: 0,
        downvotes: 0,
        submitted_at: Date.now() / 1000,
      };
      setCommunityPins(prev => [created, ...prev].slice(0, 150));
      setPendingPin(null);
      setPinName('');
      setPinDescription('');
      setQuickToast('+5 credits · community pin added');
      setTimeout(() => setQuickToast(''), 3000);
    } catch (e: any) {
      setQuickToast(e?.status === 429 ? 'Daily pin cap reached' : e?.status === 401 || e?.status === 403 ? 'Sign in to add community pins' : 'Could not add pin');
      setTimeout(() => setQuickToast(''), 3500);
    } finally {
      setPinSubmitting(false);
    }
  }

  async function voteCommunityPin(pin: Pin, action: 'upvote' | 'downvote') {
    try {
      const res = action === 'upvote' ? await api.upvotePin(pin.id) : await api.downvotePin(pin.id);
      setCommunityPins(prev => res.hidden
        ? prev.filter(p => p.id !== pin.id)
        : prev.map(p => p.id === pin.id ? { ...p, upvotes: res.upvotes, downvotes: res.downvotes } : p)
      );
      if (res.hidden) setSelectedCommunityPin(null);
      else setSelectedCommunityPin(p => p && p.id === pin.id ? { ...p, upvotes: res.upvotes, downvotes: res.downvotes } : p);
    } catch {
      setQuickToast('Vote already counted');
      setTimeout(() => setQuickToast(''), 2500);
    }
  }

  useEffect(() => {
    if (!showPois) {
      webRef.current?.postMessage(JSON.stringify({ type: 'clear_pois' }));
      lastPoiFetchRef.current = null;
      return;
    }
    const vp = viewportRef.current;
    const center = vp
      ? { lat: (vp.n + vp.s) / 2, lng: (vp.e + vp.w) / 2 }
      : userLoc ?? (waypoints[0] ? { lat: waypoints[0].lat, lng: waypoints[0].lng } : null);
    if (!center) return;
    fetchPois(center);
  }, [showPois]);

  // Sync route options to WebView
  useEffect(() => {
    webRef.current?.postMessage(JSON.stringify({ type: 'set_route_opts', opts: {
      avoidTolls: routeOpts.avoidTolls,
      avoidHighways: routeOpts.avoidHighways,
      backRoads: routeOpts.backRoads,
      preferDirt: routeOpts.backRoads,
      noFerries: routeOpts.noFerries,
    }}));
  }, [routeOpts]);

  // Offline warning during nav if area hasn't been cached
  useEffect(() => {
    if (!navMode) { setOfflineWarning(false); return; }
    const timer = setTimeout(() => setOfflineWarning(!offlineSaved), 4000);
    return () => clearTimeout(timer);
  }, [navMode, offlineSaved]);

  // ── Nav mode animate + speak start ─────────────────────────────────────────

  useEffect(() => {
    Animated.spring(navAnim, { toValue: navMode ? 1 : 0, tension: 80, friction: 10, useNativeDriver: true }).start();
    webRef.current?.postMessage(JSON.stringify({ type: 'nav_active', active: navMode }));
    if (navMode) {
      setShowPanel(false);
      setIsApproaching(false);
      setIsRerouting(false);
      // Immediately fly to user location so they don't have to tap locate
      if (userLoc) {
        const hdg = smoothedHdgRef.current ?? -1;
        webRef.current?.postMessage(JSON.stringify({
          type: 'nav_center',
          lat: userLoc.lat, lng: userLoc.lng,
          heading: hdg, zoom: 17,
        }));
        nativeMapRef.current?.flyTo(userLoc.lat, userLoc.lng, 17);
      }
      const dest = navDestRef.current;
      if (dest && waypoints.length === 0) {
        // Single-destination nav (from search) — route already drawn by route_to_search
        const dist = userLoc ? haversineKm(userLoc.lat, userLoc.lng, dest.lat, dest.lng) : null;
        const distStr = dist && dist > 0.5 ? `, ${formatDist(dist)} away` : '';
        safeSpeech(`Navigation started. Heading to ${dest.name}${distStr}.`, { rate: 0.88, pitch: 1.05, language: 'en-US' });
      } else {
        // Trip navigation
        let startIdx = navIdx;
        // Find nearest waypoint to user if location available
        if (userLoc && waypoints.length > 0) {
          startIdx = nearestWpIdx(userLoc, waypoints);
          setNavIdx(startIdx);
          navRef.current.idx = startIdx;
          setRouteLegOffset(startIdx);
        }
        webRef.current?.postMessage(JSON.stringify({ type: 'nav_target', idx: startIdx }));
        nativeMapRef.current?.setNavTarget(startIdx);
        // Route from user location if available, otherwise from first waypoint
        const routeStart = userLoc ?? (waypoints[startIdx] ? { lat: waypoints[startIdx].lat, lng: waypoints[startIdx].lng } : null);
        if (routeStart) {
          webRef.current?.postMessage(JSON.stringify({
            type: 'start_route_from',
            lat: routeStart.lat, lng: routeStart.lng, fromIdx: startIdx,
          }));
          nativeMapRef.current?.loadRouteFrom(routeStart.lat, routeStart.lng, startIdx);
        }
        const target = waypoints[startIdx];
        if (target) {
          const dist = userLoc ? haversineKm(userLoc.lat, userLoc.lng, target.lat, target.lng) : null;
          const distStr = dist && dist > 0.5 ? `, ${formatDist(dist)} away` : '';
          safeSpeech(`Navigation started. Heading to ${target.name}${distStr}.`, { rate: 0.88, pitch: 1.05, language: 'en-US' });
        }
      }
    } else {
      setIsApproaching(false);
      setIsRerouting(false);
      setApproachingReport(null);
      setOffRouteWarn(false);
      if (offRouteWarnTimer.current) clearTimeout(offRouteWarnTimer.current);
      if (rerouteTimeoutRef.current) { clearTimeout(rerouteTimeoutRef.current); rerouteTimeoutRef.current = null; }
      alertedRepIdsRef.current.clear();
      if (approachDismissRef.current) clearTimeout(approachDismissRef.current);
      setRouteLegOffset(0);
      // Restore search card so user can re-navigate without retyping
      const prevDest = navDestRef.current;
      if (prevDest && waypoints.length === 0) {
        const dist = userLoc ? haversineKm(userLoc.lat, userLoc.lng, prevDest.lat, prevDest.lng) : null;
        setSearchRouteCard({ lat: prevDest.lat, lng: prevDest.lng, name: prevDest.name, dist });
        setShowSearch(true);
      }
      navDestRef.current = null;
      setNavDest(null);
      webRef.current?.postMessage(JSON.stringify({ type: 'nav_reset' }));
      webRef.current?.postMessage(JSON.stringify({ type: 'clear_track' }));
      nativeMapRef.current?.resetRoute();
      Speech.stop();
    }
  }, [navMode]);

  // ── Voice turn announcement on leg advance ──────────────────────────────────

  useEffect(() => {
    if (!navMode || routeLegs.length === 0) return;
    const legIdx = navIdx - routeLegOffset;
    if (legIdx < 0 || legIdx >= routeLegs.length) return;
    const legSteps = routeLegs[legIdx];
    if (!legSteps) return;
    const first = legSteps.find(s => s.type !== 'depart' && s.distance > 50);
    if (!first) return;
    const t = setTimeout(() => {
      safeSpeech(buildAnnouncement(first, first.distance, 'far'), { rate: 0.88, pitch: 1.05, language: 'en-US' });
    }, 1500);
    return () => clearTimeout(t);
  }, [navIdx, navMode, routeLegOffset]);

  // ── Nominatim map search ────────────────────────────────────────────────────

  async function searchMap() {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setSearchRouteCard(null);
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 8000);
      const q = encodeURIComponent(searchQuery.trim());
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=5`,
        { headers: { 'User-Agent': 'Trailhead/1.0' }, signal: ctrl.signal }
      );
      clearTimeout(tid);
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) {
        setSearchResults([]);
      } else {
        setSearchResults(data.map((r: any) => ({
          lat: parseFloat(r.lat), lng: parseFloat(r.lon), name: r.display_name,
        })));
      }
    } catch (e: any) {
      const isTimeout = e?.name === 'AbortError';
      setSearchResults([]);
      // Show brief error in results area via a sentinel item
      if (!isTimeout) setSearchResults([{ lat: 0, lng: 0, name: '__error__' }]);
    }
    setIsSearching(false);
  }

  function selectSearchResult(place: { lat: number; lng: number; name: string }) {
    const dist = userLoc ? haversineKm(userLoc.lat, userLoc.lng, place.lat, place.lng) : null;
    setSearchRouteCard({ ...place, dist });
    setSearchResults([]);
    webRef.current?.postMessage(JSON.stringify({ type: 'fly_to', lat: place.lat, lng: place.lng, name: place.name }));
    nativeMapRef.current?.flyTo(place.lat, place.lng);
  }

  function navigateToSearch() {
    if (!searchRouteCard || !userLoc) return;
    const dest: WP = { lat: searchRouteCard.lat, lng: searchRouteCard.lng, name: searchRouteCard.name, day: 0, type: 'waypoint' };
    navDestRef.current = dest;
    setNavDest(dest);
    setShowSearch(false);
    setSearchRouteCard(null);
    webRef.current?.postMessage(JSON.stringify({
      type: 'route_to_search',
      lat: dest.lat, lng: dest.lng,
      name: dest.name,
      userLat: userLoc.lat, userLng: userLoc.lng,
    }));
    nativeMapRef.current?.routeToSearch(dest.lat, dest.lng, dest.name, userLoc.lat, userLoc.lng);
    setNavMode(true);
    setShowSearch(false);
  }

  async function openCampInsight(camp: CampsitePin, detail?: CampsiteDetail | null): Promise<boolean> {
    setLoadingInsight(true);
    setLoadingWiki(true);
    try {
      const insight = await api.getCampsiteInsight({ name: camp.name, lat: camp.lat, lng: camp.lng,
        description: camp.description, land_type: camp.land_type,
        amenities: detail?.amenities ?? [], facility_id: camp.id ?? '' });
      setCampInsight(insight);
      api.getWikipediaNearby(camp.lat, camp.lng, 15000)
        .then(setWikiArticles)
        .catch(() => setWikiArticles([]))
        .finally(() => setLoadingWiki(false));
      return true;
    } catch (e: any) {
      setLoadingWiki(false);
      if (e instanceof PaywallError) {
        setPaywallCode(e.code); setPaywallMessage(e.message); setPaywallVisible(true);
        return false;
      }
      return true;
    } finally {
      setLoadingInsight(false);
    }
  }

  async function fetchRouteBrief() {
    if (!activeTrip) return;
    setLoadingBrief(true);
    try {
      const brief = await api.getRouteBrief({
        trip_name: activeTrip.plan.trip_name,
        waypoints: activeTrip.plan.waypoints,
        reports: routeAlerts,
      });
      setRouteBrief(brief);
      setShowRouteBrief(true);
    } catch {}
    setLoadingBrief(false);
  }

  async function fetchPackingList() {
    if (!activeTrip) return;
    setLoadingPacking(true);
    try {
      const list = await api.getPackingList({
        trip_name: activeTrip.plan.trip_name,
        duration_days: activeTrip.plan.duration_days,
        road_types: [...new Set(activeTrip.plan.daily_itinerary.map(d => d.road_type))],
        land_types: [...new Set(activeTrip.plan.waypoints.map(w => w.land_type))],
        states: activeTrip.plan.states,
      });
      setPackingList(list);
      setShowPacking(true);
    } catch {}
    setLoadingPacking(false);
  }

  function tripDayAnchors(day: number) {
    const allStops = (activeTrip?.plan.waypoints ?? [])
      .filter(w => w.lat != null && w.lng != null && isFinite(w.lat) && isFinite(w.lng));
    const dayStops = allStops
      .filter(w => w.day === day && w.lat != null && w.lng != null && isFinite(w.lat) && isFinite(w.lng));
    const ordered = [
      ...dayStops.filter(w => w.type === 'camp'),
      ...dayStops.filter(w => w.type !== 'camp' && w.type !== 'fuel'),
      ...dayStops.filter(w => w.type === 'fuel'),
      ...allStops,
    ];
    const seen = new Set<string>();
    return ordered.filter(w => {
      const key = `${w.lat!.toFixed(3)}:${w.lng!.toFixed(3)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 5);
  }

  async function openCampPicker(day?: number) {
    if (!activeTrip) return;
    const nextDay = day ?? selectedDay ?? activeTrip.plan.daily_itinerary[0]?.day ?? 1;
    const anchors = tripDayAnchors(nextDay);
    setCampPickerDay(nextDay);
    setCampPickerVisible(true);
    setCampPickerError('');
    setCampCandidates([]);
    if (anchors.length === 0) {
      setCampPickerError('This day needs at least one mapped stop before camps can be searched nearby.');
      return;
    }
    setCampPickerLoading(true);
    try {
      const localTripCamps = (activeTrip.campsites ?? [])
        .filter(c => c.lat != null && c.lng != null && isFinite(c.lat) && isFinite(c.lng))
        .filter(c => {
          const nearestMi = Math.min(...anchors.map(anchor => haversineKm(anchor.lat!, anchor.lng!, c.lat, c.lng) * 0.621371));
          return c.recommended_day === nextDay || nearestMi <= 80;
        }) as CampsitePin[];
      const batches = await Promise.allSettled([
        ...anchors.map(anchor => api.getNearbyCamps(anchor.lat!, anchor.lng!, 65, [])),
        ...anchors.slice(0, 3).map(anchor => api.searchCampsites(anchor.lat!, anchor.lng!, 75, [])),
      ]);
      const seen = new Set<string>();
      const candidates: CampsitePin[] = [];
      for (const camp of localTripCamps) {
        const key = String(camp.id || `${camp.name}:${camp.lat.toFixed(4)}:${camp.lng.toFixed(4)}`);
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push(camp);
      }
      for (const batch of batches) {
        if (batch.status !== 'fulfilled') continue;
        for (const camp of batch.value) {
          const key = String(camp.id || `${camp.name}:${camp.lat.toFixed(4)}:${camp.lng.toFixed(4)}`);
          if (seen.has(key)) continue;
          seen.add(key);
          candidates.push(camp);
        }
      }
      const sorted = candidates
        .map(c => {
          const nearestMi = Math.min(...anchors.map(anchor => haversineKm(anchor.lat!, anchor.lng!, c.lat, c.lng) * 0.621371));
          const tags = new Set((c.tags ?? []).map(t => t.toLowerCase()));
          const publicLandBonus = tags.has('dispersed') || tags.has('blm') || tags.has('usfs') ? -8 : 0;
          const developedPenalty = c.reservable ? 2 : 0;
          return {
            ...c,
            route_distance_mi: c.route_distance_mi ?? nearestMi,
            route_fit: c.route_fit ?? (nearestMi <= 5 ? 'on_route' : nearestMi <= 18 ? 'short_detour' : 'detour'),
            _score: nearestMi + publicLandBonus + developedPenalty,
          };
        })
        .filter(c => (c.route_distance_mi ?? 999) <= 80)
        .sort((a, b) => ((a as any)._score ?? 999) - ((b as any)._score ?? 999))
        .map(({ _score, ...c }: CampsitePin & { _score?: number }) => c)
        .slice(0, 30);
      setCampCandidates(sorted);
      if (sorted.length === 0) setCampPickerError('No camps found near this day yet. Try the map search or choose a nearby map camp and tap Use for Day.');
    } catch (e: any) {
      if (e instanceof PaywallError) {
        setPaywallCode(e.code); setPaywallMessage(e.message); setPaywallVisible(true);
        setCampPickerVisible(false);
      } else {
        setCampPickerError('Could not load camps for this day.');
      }
    } finally {
      setCampPickerLoading(false);
    }
  }

  function useCampForTripDay(camp: CampsitePin, dayOverride?: number) {
    const day = dayOverride ?? campPickerDay;
    if (!activeTrip || !day) return;
    const campWaypoint: Waypoint = {
      day,
      name: camp.name,
      type: 'camp',
      description: camp.description || 'Selected camp for this trip day.',
      land_type: camp.land_type || 'camp',
      notes: [
        camp.cost ? `Cost: ${camp.cost}` : null,
        camp.reservable ? 'Reservable' : 'First-come or dispersed',
        camp.route_distance_mi != null ? `${camp.route_distance_mi.toFixed(1)} mi from day route anchor` : null,
      ].filter(Boolean).join(' · '),
      lat: camp.lat,
      lng: camp.lng,
      verified_source: camp.verified_source ?? 'camp_picker',
      verified_match: true,
    };

    const original = activeTrip.plan.waypoints ?? [];
    const existingCampIndex = original.findIndex(w => w.day === day && w.type === 'camp');
    let nextWaypoints: Waypoint[];
    if (existingCampIndex >= 0) {
      nextWaypoints = original.map((w, idx) => idx === existingCampIndex ? campWaypoint : w);
    } else {
      const lastDayIndex = original.reduce((last, w, idx) => w.day === day ? idx : last, -1);
      nextWaypoints = [...original];
      nextWaypoints.splice(lastDayIndex >= 0 ? lastDayIndex + 1 : nextWaypoints.length, 0, campWaypoint);
    }

    const nextTrip = {
      ...activeTrip,
      campsites: [
        camp,
        ...(activeTrip.campsites ?? []).filter(c => c.id !== camp.id),
      ],
      plan: {
        ...activeTrip.plan,
        waypoints: nextWaypoints,
      },
    };
    setActiveTrip(nextTrip);
    saveOfflineTrip(nextTrip).catch(() => {});
    setCampPickerVisible(false);
    setQuickToast(`Day ${day} camp updated`);
    setTimeout(() => setQuickToast(''), 2500);
    nativeMapRef.current?.flyTo(camp.lat, camp.lng, 12);
  }

  async function handleNearbyAudio() {
    const vp = viewportRef.current;
    const center = vp
      ? { lat: (vp.n + vp.s) / 2, lng: (vp.e + vp.w) / 2 }
      : userLoc;
    if (!center) return;
    setNearbyLoading(true);
    setNearbyNarration(null);
    try {
      Speech.stop();
      const res = await api.nearbyAudio(center.lat, center.lng);
      setNearbyNarration(res.narration);
      safeSpeech(res.narration, { rate: 0.88, language: 'en-US' });
    } catch (e: any) {
      if (e instanceof PaywallError) {
        setPaywallVisible(true);
      } else {
        setQuickToast('Could not load narration');
        setTimeout(() => setQuickToast(''), 2500);
      }
    } finally {
      setNearbyLoading(false);
    }
  }

  function copyCoordinates(lat: number, lng: number) {
    Share.share({ message: `${lat.toFixed(6)}, ${lng.toFixed(6)}` });
  }

  // ── Layer switch ────────────────────────────────────────────────────────────

  function switchLayer() {
    const next: MapLayer = mapLayer === 'satellite' ? 'topo' : mapLayer === 'topo' ? 'hybrid' : 'satellite';
    setMapLayerState(next);
    webRef.current?.postMessage(JSON.stringify({
      type: 'set_style',
      style: MAP_MODES[next] ?? MAP_MODES.satellite,
    }));
  }

  async function loadCampsInArea(bounds: { n: number; s: number; e: number; w: number; zoom: number }, types: string[]) {
    if ((bounds.zoom ?? 0) < 9) {
      setSearchResult({ count: -2 });
      setTimeout(() => setSearchResult(null), 3000);
      return;
    }
    // Center of the visible map area (not GPS location)
    const centerLat = (bounds.n + bounds.s) / 2;
    const centerLng = (bounds.e + bounds.w) / 2;
    // Half-diagonal of visible area in miles, capped at 50
    const latMi = ((bounds.n - bounds.s) / 2) * 69;
    const lngMi = ((bounds.e - bounds.w) / 2) * 69 * Math.cos(centerLat * Math.PI / 180);
    const radiusMi = Math.min(Math.ceil(Math.sqrt(latMi * latMi + lngMi * lngMi)), 50);
    setIsLoadingAreaCamps(true);
    setMapMoved(false);
    setSearchResult(null);
    try {
      const [campsResult, fullResult] = await Promise.allSettled([
        api.getNearbyCamps(centerLat, centerLng, radiusMi, types),
        api.getNearbyFullness(centerLat, centerLng, radiusMi * 0.6),
      ]);
      const camps = campsResult.status === 'fulfilled' ? campsResult.value : [];
      if (campsResult.status === 'rejected' && campsResult.reason instanceof PaywallError) {
        setPaywallCode(campsResult.reason.code);
        setPaywallMessage(campsResult.reason.message);
        setPaywallVisible(true);
        setIsLoadingAreaCamps(false);
        return;
      }
      const fullIds = new Set(
        fullResult.status === 'fulfilled' ? fullResult.value.map(f => f.camp_id) : []
      );
      const tagged = camps.map(c => ({ ...c, full: fullIds.has(c.id) ? 1 : 0 }));
      // Feed results to WebView (legacy path) AND native map
      webRef.current?.postMessage(JSON.stringify({ type: 'set_camps', pins: tagged }));
      setAreaCamps(tagged);
      setSearchResult({ count: camps.length });
      setTimeout(() => setSearchResult(null), 3000);
    } catch (e: any) {
      if (e instanceof PaywallError) {
        setPaywallCode(e.code); setPaywallMessage(e.message); setPaywallVisible(true);
      } else {
        setSearchResult({ count: -1 });
        setTimeout(() => setSearchResult(null), 3000);
      }
    }
    setIsLoadingAreaCamps(false);
  }

  function restoreCachedActiveRoute(target: 'web' | 'native') {
    if (!activeTrip?.trip_id) return;
    loadRouteGeometry(activeTrip.trip_id).then(saved => {
      if (!saved || !Array.isArray(saved.coords) || saved.coords.length < 2) return;
      const steps = saved.steps ?? [];
      const legs = saved.legs ?? [];
      const totalDistance = saved.totalDistance ?? saved.total_distance ?? 0;
      const totalDuration = saved.totalDuration ?? saved.total_duration ?? 0;

      if (target === 'native') {
        nativeMapRef.current?.restoreRoute(saved.coords, steps, legs, totalDistance, totalDuration);
        setLastRouteCoords(saved.coords);
        return;
      }

      webRef.current?.postMessage(JSON.stringify({
        type: 'restore_route',
        coords: saved.coords,
        steps,
        legs,
        total_distance: totalDistance,
        total_duration: totalDuration,
      }));
    }).catch(() => {});

    storage.get('trailhead_active_route').then(raw => {
      if (!raw) return;
      try {
        const cached = JSON.parse(raw);
        if (cached.tripId !== activeTrip.trip_id) return;
        if (!Array.isArray(cached.coords) || cached.coords.length < 2) return;

        const steps = cached.steps ?? [];
        const legs = cached.legs ?? [];
        const totalDistance = cached.totalDistance ?? cached.total_distance ?? 0;
        const totalDuration = cached.totalDuration ?? cached.total_duration ?? 0;

        if (target === 'native') {
          nativeMapRef.current?.restoreRoute(cached.coords, steps, legs, totalDistance, totalDuration);
          setLastRouteCoords(cached.coords);
          return;
        }

        webRef.current?.postMessage(JSON.stringify({
          type: 'restore_route',
          coords: cached.coords,
          steps,
          legs,
          total_distance: totalDistance,
          total_duration: totalDuration,
        }));
      } catch {}
    }).catch(() => {});
  }

  const runLandCheck = useCallback((lat: number, lng: number) => {
    setLandCheck(null);
    setLandCheckLoading(true);
    if (landCheckDismissTimer.current) clearTimeout(landCheckDismissTimer.current);
    api.getLandCheck(lat, lng)
      .then(result => {
        setLandCheck(result);
        setLandCheckLoading(false);
        landCheckDismissTimer.current = setTimeout(() => {
          setLandCheck(null);
          setLandCheckLoading(false);
        }, 8000);
      })
      .catch(() => {
        setLandCheckLoading(false);
      });
  }, []);

  // ── WebView message handler ──────────────────────────────────────────────────

  function onWebMessage(e: any) {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'map_ready') {
        if (viewportRef.current) loadCampsInArea(viewportRef.current, activeFilters);
        // If we restored a trip from cache (offline relaunch), replay its route geometry
        // into the WebView so navigation works without re-fetching from Mapbox Directions.
        restoreCachedActiveRoute('web');
      }
      if (msg.type === 'map_bounds') {
        viewportRef.current = { n: msg.n, s: msg.s, e: msg.e, w: msg.w, zoom: msg.zoom };
        setMapZoom(msg.zoom ?? 10);
        if ((msg.zoom ?? 0) >= 9) setMapMoved(true);
        const pinLat = (msg.n + msg.s) / 2;
        const pinLng = (msg.e + msg.w) / 2;
        const pinRadius = Math.max(1.0, Math.min(4.0, Math.max(Math.abs(msg.n - msg.s), Math.abs(msg.e - msg.w)) / 2 + 0.5));
        refreshCommunityPins({ lat: pinLat, lng: pinLng }, pinRadius, false);
        // Refresh POIs when panned far enough from last fetch
        if (showPoisRef.current && (msg.zoom ?? 0) >= 8) {
          const newLat = (msg.n + msg.s) / 2;
          const newLng = (msg.e + msg.w) / 2;
          const last = lastPoiFetchRef.current;
          if (!last || Math.abs(newLat - last.lat) > 0.15 || Math.abs(newLng - last.lng) > 0.15) {
            fetchPois({ lat: newLat, lng: newLng });
          }
        }
      }
      if (msg.type === 'search_area') {
        // Legacy WebView button — handled by native button now, but keep as fallback
        const bounds = { n: msg.n, s: msg.s, e: msg.e, w: msg.w, zoom: msg.zoom };
        viewportRef.current = bounds;
        loadCampsInArea(bounds, activeFilters);
      }
      if (msg.type === 'map_tapped') {
        setSelectedCamp(null);
        setTappedTrail(null);
      }
      if (msg.type === 'route_persist' && Array.isArray(msg.coords)) {
        // Cache the freshly-routed geometry + steps so we can replay offline
        const payload = {
          coords: msg.coords, steps: msg.steps ?? [], legs: msg.legs ?? [],
          total_distance: msg.total_distance, total_duration: msg.total_duration,
          tripId: activeTrip?.trip_id ?? null,
          ts: Date.now(),
        };
        storage.set('trailhead_active_route', JSON.stringify(payload)).catch(() => {});
        saveRouteGeometry(activeTrip?.trip_id, payload).catch(() => {});
      }
      if (msg.type === 'route_ready') {
        setIsRouted(msg.routed);
        setRouteSteps(msg.steps ?? []);
        setRouteLegs(msg.legs ?? []);
        if (msg.fromIdx !== undefined) setRouteLegOffset(msg.fromIdx);
        setIsRerouting(false);
        if (rerouteTimeoutRef.current) { clearTimeout(rerouteTimeoutRef.current); rerouteTimeoutRef.current = null; }
      }
      if (msg.type === 'off_route' && navRef.current.active) {
        const now = Date.now();
        if (isReroutingRef.current || now - lastRerouteRef.current < 35000) return;
        // Never reroute when within 500m of next maneuver — driver is making the turn
        const curStep = routeStepsRef.current[stepIdxRef.current];
        if (curStep?.lat != null && msg.lat != null) {
          const stepDist = haversineKm(msg.lat as number, msg.lng as number, curStep.lat, curStep.lng!) * 1000;
          if (stepDist < 500) return;
        }
        // Advance past any waypoints we may have already driven through
        const { wps } = navRef.current;
        let bestIdx = navRef.current.idx;
        while (bestIdx < wps.length - 1) {
          const d = haversineKm(msg.lat, msg.lng, wps[bestIdx].lat, wps[bestIdx].lng);
          if (d < 0.4) { bestIdx++; } else break;
        }
        lastRerouteRef.current = now;
        setIsRerouting(true);
        isReroutingRef.current = true;
        if (rerouteTimeoutRef.current) clearTimeout(rerouteTimeoutRef.current);
        rerouteTimeoutRef.current = setTimeout(() => { setIsRerouting(false); isReroutingRef.current = false; }, 15000);
        if (bestIdx !== navRef.current.idx) {
          setNavIdx(bestIdx);
          navRef.current.idx = bestIdx;
        }
        webRef.current?.postMessage(JSON.stringify({
          type: 'reroute_from',
          lat: msg.lat, lng: msg.lng,
          fromIdx: bestIdx,
        }));
        setRouteLegOffset(bestIdx);
        setOffRouteWarn(false);
        if (offRouteWarnTimer.current) clearTimeout(offRouteWarnTimer.current);
        safeSpeech('Off route. Recalculating.', { rate: 0.88, pitch: 1.05 });
      }
      if (msg.type === 'off_route_warn' && navRef.current.active && !isReroutingRef.current) {
        // Suppress warn if within 400m of current maneuver — GPS wobble at intersections is normal
        const curStep = routeStepsRef.current[stepIdxRef.current];
        if (curStep?.lat != null && msg.lat != null) {
          const stepDist = haversineKm(msg.lat as number, msg.lng as number, curStep.lat, curStep.lng!) * 1000;
          if (stepDist < 400) return;
        }
        setOffRouteWarn(true);
        if (offRouteWarnTimer.current) clearTimeout(offRouteWarnTimer.current);
        offRouteWarnTimer.current = setTimeout(() => setOffRouteWarn(false), 18000);
      }
      if (msg.type === 'back_on_route') {
        setOffRouteWarn(false);
        if (offRouteWarnTimer.current) clearTimeout(offRouteWarnTimer.current);
      }
      if (msg.type === 'wp_tapped') {
        const wp = waypoints[msg.idx];
        if (wp) setTappedWp({ idx: msg.idx, wp });
      }
      if (msg.type === 'download_progress') {
        setDownloadProgress(msg.percent ?? 0);
        setDownloadTotal(msg.total ?? 0);
        setDownloadSaved(msg.saved ?? 0);
        if (msg.mb != null) setDownloadMB(String(msg.mb));
      }
      if (msg.type === 'download_complete') {
        setIsDownloading(false);
        setDownloadProgress(100);
        setDownloadLabel(prev => { if (prev) addCachedRegion(prev); return prev; });
        setTimeout(() => { setDownloadProgress(0); setDownloadSaved(0); setDownloadMB('0'); }, 3000);
      }
      if (msg.type === 'campsite_tapped') {
        const camp = (msg.camp as CampsitePin) || null;
        setSelectedCamp(camp);
        setCampDetail(null);
        setCampInsight(null);
        setWikiArticles([]);
        setCampFullness(null);
        setCampWeather(null);
        if (camp?.id) api.getCampFullness(camp.id).then(r => setCampFullness(r)).catch(() => {});
        if (camp?.lat && camp?.lng) api.getWeather(camp.lat, camp.lng, 3).then(r => setCampWeather(r)).catch(() => {});
      }
      if (msg.type === 'trail_tapped') {
        setSelectedCamp(null);
        setTappedTrail({ name: msg.name, lat: msg.lat, lng: msg.lng, cls: msg.cls ?? 'path' });
      }
      if (msg.type === 'base_camp_tapped') {
        setTappedTrail(null);
        const minId = `map_${msg.lat.toFixed(5)}_${msg.lng.toFixed(5)}`;
        const minPin: CampsitePin = {
          id: minId,
          name: msg.name,
          lat: msg.lat,
          lng: msg.lng,
          tags: [],
          land_type: 'Dispersed',
          description: '',
          reservable: false,
          cost: '',
          url: '',
          ada: false,
        };
        setSelectedCamp(minPin);
        setCampDetail(null);
        setCampInsight(null);
        setWikiArticles([]);
        setCampFullness(null);
        setCampWeather(null);
        api.getCampFullness(minId).then(r => setCampFullness(r)).catch(() => {});
        api.getWeather(msg.lat, msg.lng, 3).then(r => setCampWeather(r)).catch(() => {});
        // Silently upgrade to full camp data if our backend has it
        api.getNearbyCamps(msg.lat, msg.lng, 2).then(results => {
          if (!results.length) return;
          const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
          const tapped = norm(msg.name);
          const match = results.find(r =>
            norm(r.name).includes(tapped.slice(0, 8)) || tapped.includes(norm(r.name).slice(0, 8))
          ) ?? results[0];
          // Only update if user hasn't closed/changed the card
          setSelectedCamp(prev => prev?.id === minId ? match : prev);
        }).catch(() => {});
      }
      if (msg.type === 'map_long_press') {
        runLandCheck(msg.lat, msg.lng);
      }
    } catch {}
  }

  async function handleReportFull() {
    if (!selectedCamp || fullnessVoting) return;
    setFullnessVoting(true);
    try {
      const res = await api.reportCampFull(selectedCamp.id, {
        camp_name: selectedCamp.name, lat: selectedCamp.lat, lng: selectedCamp.lng,
      });
      const updated = await api.getCampFullness(selectedCamp.id).catch(() => null);
      setCampFullness(updated);
      if (res.credits_earned > 0) {
        setQuickToast(`+${res.credits_earned} credits`);
        setTimeout(() => setQuickToast(''), 2500);
      }
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not submit report');
    }
    setFullnessVoting(false);
  }

  async function handleFullnessVote(action: 'confirm' | 'dispute') {
    if (!selectedCamp || fullnessVoting) return;
    setFullnessVoting(true);
    try {
      if (action === 'confirm') await api.confirmCampFull(selectedCamp.id);
      else await api.disputeCampFull(selectedCamp.id);
      const updated = await api.getCampFullness(selectedCamp.id).catch(() => null);
      setCampFullness(updated);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not submit vote');
    }
    setFullnessVoting(false);
  }

  async function openCampDetail() {
    if (!selectedCamp) return;
    setLoadingDetail(true);
    setCampInsight(null);
    setWikiArticles([]);
    setFieldReports([]);
    setFieldReportSummary(null);
    setShowFieldReportForm(false);
    resetFieldReportForm();
    let detail: CampsiteDetail;
    try {
      detail = await api.getCampsiteDetail(selectedCamp.id);
    } catch {
      // Build a safe minimal CampsiteDetail so the modal doesn't crash on missing arrays
      detail = {
        id: selectedCamp.id, name: selectedCamp.name,
        lat: selectedCamp.lat, lng: selectedCamp.lng,
        land_type: selectedCamp.land_type ?? '',
        description: selectedCamp.description ?? '',
        cost: selectedCamp.cost ?? '',
        reservable: selectedCamp.reservable ?? false,
        url: selectedCamp.url ?? '',
        ada: selectedCamp.ada ?? false,
        tags: Array.isArray(selectedCamp.tags) ? selectedCamp.tags : [],
        photos: [], amenities: [], site_types: [], activities: [],
        campsites_count: 0,
      } as any;
    }
    const canOpen = await openCampInsight(selectedCamp, detail);
    if (!canOpen) {
      setLoadingDetail(false);
      return;
    }
    setCampDetail(detail);
    setShowCampDetail(true);
    setLoadingDetail(false);
    // Load field reports in background
    api.getFieldReports(selectedCamp.id).then(setFieldReports).catch(() => {});
    api.getFieldReportSummary(selectedCamp.id).then(setFieldReportSummary).catch(() => {});
  }

  function resetFieldReportForm() {
    setFrSentiment(null); setFrAccess(null); setFrCrowd(null);
    setFrTags([]); setFrNote(''); setFrPhoto(null);
  }

  async function pickFieldReportPhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, quality: 0.5, base64: true,
    });
    if (!result.canceled && result.assets[0].base64) setFrPhoto(result.assets[0].base64);
  }

  async function submitFieldReport() {
    if (!selectedCamp || !frSentiment || !frAccess || !frCrowd) return;
    setFrSubmitting(true);
    try {
      const rigLabel = rigProfile?.make && rigProfile?.model
        ? `${rigProfile.year ? rigProfile.year + ' ' : ''}${rigProfile.make} ${rigProfile.model}`
        : undefined;
      const today = new Date().toISOString().split('T')[0];
      const res = await api.submitFieldReport(selectedCamp.id, {
        camp_name: selectedCamp.name, lat: selectedCamp.lat, lng: selectedCamp.lng,
        rig_label: rigLabel, visited_date: today,
        sentiment: frSentiment, access_condition: frAccess, crowd_level: frCrowd,
        tags: frTags, note: frNote || undefined, photo_data: frPhoto ?? undefined,
      });
      setQuickToast(`+${res.credits_earned} credits`);
      setTimeout(() => setQuickToast(''), 2500);
      setShowFieldReportForm(false);
      resetFieldReportForm();
      // Refresh lists
      api.getFieldReports(selectedCamp.id).then(setFieldReports).catch(() => {});
      api.getFieldReportSummary(selectedCamp.id).then(setFieldReportSummary).catch(() => {});
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not submit field report');
    }
    setFrSubmitting(false);
  }

  // ── Stable map HTML (only rebuilds on trip/pins change) ─────────────────────

  const campsites = useMemo(() =>
    (activeTrip?.campsites ?? []).filter(c => c.lat && c.lng).map(c => ({ lat: c.lat, lng: c.lng, name: c.name })),
    [activeTrip?.trip_id]
  );
  const gas = useMemo(() =>
    (activeTrip?.gas_stations ?? []).filter(g => g.lat != null && g.lng != null && isFinite(g.lat) && isFinite(g.lng)).map(g => ({ lat: g.lat, lng: g.lng, name: g.name })),
    [activeTrip?.trip_id]
  );
  const routePois = useMemo(() => {
    const merged = [...(activeTrip?.route_pois ?? []), ...pois];
    const seen = new Set<string>();
    return merged
      .filter(p => p.lat != null && p.lng != null && isFinite(p.lat) && isFinite(p.lng))
      .filter(p => {
        const key = p.id || `${p.name}:${p.lat.toFixed(4)}:${p.lng.toFixed(4)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(p => ({ lat: p.lat, lng: p.lng, name: p.name, type: p.type || 'poi' }));
  }, [activeTrip?.trip_id, pois]);
  const visibleCommunityPins = useMemo(() => {
    if (activePinFilters.length === 0) return communityPins;
    const allowed = new Set(activePinFilters);
    return communityPins.filter(p => allowed.has((p.type || 'other').toLowerCase()));
  }, [communityPins, activePinFilters]);
  const pinList = useMemo(() =>
    visibleCommunityPins.map(p => ({ lat: p.lat, lng: p.lng, name: p.name, type: p.type })),
    [visibleCommunityPins.length, activePinFilters.length]
  );

  const centerLat = waypoints[0]?.lat ?? 39.5;
  const centerLng = waypoints[0]?.lng ?? -111.0;

  const mapHtml = useMemo(() =>
    buildMapHtml(centerLat, centerLng, waypoints, campsites, gas, pinList),
    [activeTrip?.trip_id, communityPins.length]
  );

  // ── Nav HUD values ──────────────────────────────────────────────────────────

  const navTarget = navMode ? (waypoints[navIdx] ?? navDest ?? null) : null;
  const distKm    = userLoc && navTarget ? haversineKm(userLoc.lat, userLoc.lng, navTarget.lat, navTarget.lng) : null;
  const bearing   = userLoc && navTarget ? calcBearing(userLoc.lat, userLoc.lng, navTarget.lat, navTarget.lng) : null;
  const speedMph  = userSpeed !== null && userSpeed > 0 ? userSpeed * 2.237 : null;
  // Current step the user is navigating toward
  const nextStep = routeSteps[stepIdx] ?? null;
  const afterStep = routeSteps[stepIdx + 1] ?? null;
  const speedLimitMph = nextStep?.speedLimit ? Math.round(nextStep.speedLimit * 0.621371) : null;
  // Real distance to the step's maneuver point (more accurate than step.distance)
  const stepDistM = nextStep?.lat != null && userLoc
    ? haversineKm(userLoc.lat, userLoc.lng, nextStep.lat!, nextStep.lng!) * 1000
    : null;
  const isProceeding = distKm !== null && distKm > 30;
  // "Proceed to route" when user hasn't started moving along it yet
  const proceedToRoute = !isRerouting && isRouted && stepIdx === 0 && stepDistM !== null && stepDistM > 300;
  // Step-based ETA: remaining seconds = time to reach current maneuver + sum of later step durations
  const etaMins = useMemo(() => {
    if (!navMode || !userSpeed || userSpeed < 0.5) return null;
    const curStepSecs = stepDistM != null ? stepDistM / userSpeed : (nextStep?.duration ?? 0);
    const laterSecs = routeSteps.slice(stepIdx + 1).reduce((sum, s) => sum + (s.duration || 0), 0);
    return Math.round((curStepSecs + laterSecs) / 60);
  }, [navMode, userSpeed, stepDistM, stepIdx, routeSteps]);

  // Total remaining trip distance (current → navIdx → ... → last waypoint)
  const remainingKm = useMemo(() => {
    if (!navMode || !userLoc || !waypoints.length) return null;
    let total = distKm ?? 0;
    for (let i = navIdx; i < waypoints.length - 1; i++) {
      total += haversineKm(waypoints[i].lat, waypoints[i].lng, waypoints[i + 1].lat, waypoints[i + 1].lng);
    }
    return total;
  }, [navMode, navIdx, distKm, userLoc]);

  function toggleDataLayer(key: string, val: boolean) {
    webRef.current?.postMessage(JSON.stringify({ type: 'set_layer', layer: key, show: val }));
  }

  function manualReroute() {
    if (!userLoc || !navMode) return;
    const now = Date.now();
    if (isReroutingRef.current || now - lastRerouteRef.current < 5000) return;
    lastRerouteRef.current = now;
    setIsRerouting(true);
    isReroutingRef.current = true;
    webRef.current?.postMessage(JSON.stringify({
      type: 'reroute_from',
      lat: userLoc.lat, lng: userLoc.lng,
      fromIdx: navRef.current.idx,
    }));
    nativeMapRef.current?.rerouteFrom(userLoc.lat, userLoc.lng, navRef.current.idx);
    setRouteLegOffset(navRef.current.idx);
    safeSpeech('Recalculating.', { rate: 0.95 });
  }

  function startDayNav(day: number | 'all', fromIdx?: number) {
    setShowDayModal(false);
    setTappedWp(null);
    if (day === 'all') {
      setNavIdx(fromIdx ?? 0);
      navRef.current.idx = fromIdx ?? 0;
    } else {
      const firstOfDay = waypoints.findIndex(w => w.day === day);
      const idx = fromIdx !== undefined ? fromIdx : (firstOfDay >= 0 ? firstOfDay : 0);
      setNavIdx(idx);
      navRef.current.idx = idx;
    }
    setNavMode(true);
    setShowSearch(false);
  }

  function openInMaps() {
    if (!waypoints.length) return;
    const origin = `${waypoints[0].lat},${waypoints[0].lng}`;
    const dest   = `${waypoints[waypoints.length - 1].lat},${waypoints[waypoints.length - 1].lng}`;
    const mids   = waypoints.slice(1, -1).slice(0, 8).map(w => `${w.lat},${w.lng}`).join('|');
    const url    = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}${mids ? `&waypoints=${encodeURIComponent(mids)}` : ''}&travelmode=driving`;
    Linking.openURL(url).catch(() =>
      Linking.openURL(`maps://?saddr=${origin}&daddr=${dest}`).catch(() => {})
    );
  }

  function navigateToCamp(camp: { lat: number; lng: number; name: string }) {
    setShowCampDetail(false);
    if (!userLoc) {
      Alert.alert('Location Needed', 'Enable location services to navigate.');
      return;
    }
    const dest: WP = { lat: camp.lat, lng: camp.lng, name: camp.name, day: 0, type: 'camp' };
    navDestRef.current = dest;
    setNavDest(dest);
    webRef.current?.postMessage(JSON.stringify({
      type: 'route_to_search',
      lat: dest.lat, lng: dest.lng, name: dest.name,
      userLat: userLoc.lat, userLng: userLoc.lng,
    }));
    nativeMapRef.current?.routeToSearch(dest.lat, dest.lng, dest.name, userLoc.lat, userLoc.lng);
    setNavMode(true);
    setShowSearch(false);
  }

  function openExternalMaps(lat: number, lng: number, name: string) {
    const label = encodeURIComponent(name);
    Alert.alert('Get Directions', name.split(',')[0], [
      { text: '🗺 Navigate in App', onPress: () => navigateToCamp({ lat, lng, name }) },
      { text: '🟢 Google Maps', onPress: () => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`) },
      { text: '🍎 Apple Maps', onPress: () => Linking.openURL(`maps://?daddr=${lat},${lng}&q=${label}`) },
      { text: '🚗 Waze', onPress: () => Linking.openURL(`waze://?ll=${lat},${lng}&navigate=yes`) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  const layerLabel: Record<MapLayer, string> = { satellite: 'SAT', topo: 'TOPO', hybrid: 'HYB' };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <View style={s.container}>
      {USE_NATIVE_MAP ? (
        // ── Native MapLibre SDK (new binary required) ───────────────────────
        <NativeMap
          ref={nativeMapRef}
          waypoints={waypoints}
          camps={[
            ...(activeTrip?.campsites ?? []).filter(c => c.lat != null && c.lng != null && isFinite(c.lat) && isFinite(c.lng)),
            ...areaCamps.filter(c => c.lat != null && c.lng != null),
          ] as any}
          gas={(activeTrip?.gas_stations ?? []).filter(g => g.lat != null && g.lng != null && isFinite(g.lat) && isFinite(g.lng)) as any}
          pois={routePois}
          reports={mapReports}
          communityPins={visibleCommunityPins}
          searchMarker={searchRouteCard ? { lat: searchRouteCard.lat, lng: searchRouteCard.lng, name: searchRouteCard.name } : null}
          userLoc={userLoc}
          navMode={navMode}
          navIdx={navRef.current.idx}
          navHeading={smoothedHdgRef.current}
          navSpeed={userSpeed}
          mapLayer={mapLayer}
          routeOpts={routeOpts}
          showLandOverlay={showLands}
          showUsgsOverlay={showUsgs}
          showTerrain={layerTerrain}
          showMvum={layerMvum}
          showFire={layerFire}
          showAva={layerAva}
          showRadar={layerRadar}
          onMapReady={() => {
            webLoadedRef.current = true;
            // Load camps in the current area — this is what the WebView did on map_ready.
            // Without this, no camp/POI pins show on the native map until user pans.
            const vp = viewportRef.current;
            const center = vp
              ? { lat: (vp.n + vp.s) / 2, lng: (vp.e + vp.w) / 2 }
              : waypoints[0] ? { lat: waypoints[0].lat, lng: waypoints[0].lng } : null;
            if (center) {
              // Search a generous radius on first load so trip camps appear immediately
              const bounds = vp ?? {
                n: center.lat + 1.5, s: center.lat - 1.5,
                e: center.lng + 1.5, w: center.lng - 1.5, zoom: 9,
              };
              loadCampsInArea(bounds, activeFilters);
              refreshCommunityPins(center, 3.0, true);
              // Also load nearby POIs
              fetchPois(center);
            }
            restoreCachedActiveRoute('native');
          }}
          onBoundsChange={b => {
            viewportRef.current = b;
            setMapZoom(b.zoom ?? 10);
            if ((b.zoom ?? 0) >= 9) setMapMoved(true);
            if ((b.zoom ?? 0) < 8) setAreaCamps([]);
            const lat = (b.n + b.s) / 2;
            const lng = (b.e + b.w) / 2;
            const radius = Math.max(1.0, Math.min(4.0, Math.max(Math.abs(b.n - b.s), Math.abs(b.e - b.w)) / 2 + 0.5));
            refreshCommunityPins({ lat, lng }, radius, false);
          }}
          onMapTap={(lat, lng) => {
            if (pinDropMode && (lat == null || lng == null)) {
              setQuickToast('Map tap did not return a coordinate. Try again.');
              setTimeout(() => setQuickToast(''), 3500);
              return;
            }
            if (pinDropMode && lat != null && lng != null) {
              setPinDropMode(false);
              setPendingPin({ lat, lng });
              setPinName('');
              setPinDescription('');
              return;
            }
            if (selectOnMapMode && (lat == null || lng == null)) {
              setQuickToast('Map tap did not return a coordinate. Try tapping the road surface.');
              setTimeout(() => setQuickToast(''), 4000);
              return;
            }
            if (selectOnMapMode && lat != null && lng != null) {
              setSelectOnMapMode(false);
              const name = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
              const dist = userLoc ? haversineKm(userLoc.lat, userLoc.lng, lat, lng) : null;
              setSearchRouteCard({ name, lat, lng, dist });
              setShowSearch(true);
              if (userLoc) {
                const dest = { lat, lng, name, day: 0, type: 'waypoint' as const };
                navDestRef.current = dest; setNavDest(dest);
                nativeMapRef.current?.routeToSearch(lat, lng, name, userLoc.lat, userLoc.lng);
                webRef.current?.postMessage(JSON.stringify({ type: 'route_to_search', lat, lng, name, userLat: userLoc.lat, userLng: userLoc.lng }));
              }
              return;
            }
            setSelectedCamp(null); setTappedTrail(null); setTappedTileSpot(null); setTappedGas(null); setTappedPoi(null); setSelectedCommunityPin(null);
          }}
          onMapLongPress={runLandCheck}
          onCampTap={camp => {
            setSelectedCamp(camp);
            setCampDetail(null); setCampInsight(null); setWikiArticles([]);
            setCampFullness(null); setCampWeather(null);
            if (camp?.id) api.getCampFullness(camp.id).then(r => setCampFullness(r)).catch(() => {});
            if (camp?.lat && camp?.lng) api.getWeather(camp.lat, camp.lng, 3).then(r => setCampWeather(r)).catch(() => {});
          }}
          onGasTap={s => { setTappedGas(s); setSelectedCamp(null); setTappedTrail(null); setTappedTileSpot(null); }}
          onPoiTap={p => { setTappedPoi(p); setSelectedCamp(null); setTappedTrail(null); setTappedTileSpot(null); setSelectedCommunityPin(null); }}
          onCommunityPinTap={p => { setSelectedCommunityPin(p); setSelectedCamp(null); setTappedTrail(null); setTappedTileSpot(null); setTappedGas(null); setTappedPoi(null); }}
          onTileCampTap={(name, kind, lat, lng) => {
            setTappedTileSpot({ name, kind, lat, lng });
          }}
          onBaseCampTap={(name, lat, lng, landType) => {
            // Open nearby camp search for the tapped point
          }}
          onTrailTap={(name, lat, lng) => setTappedTrail({ name, lat, lng, cls: 'path' })}
          onWaypointTap={(idx, name) => { setTappedWp({ idx, wp: waypoints[idx] }); }}
          onRouteReady={result => {
            setIsRouted(result.isProper);
            setRouteFromCache(!!result.fromCache);
            setRouteDebug(result.debug ?? '');
            setRouteSteps(result.steps ?? []);
            setRouteLegs(result.legs ?? []);
            if (result.fromIdx !== undefined) setRouteLegOffset(result.fromIdx);
            setIsRerouting(false); isReroutingRef.current = false;
            if (result.coords?.length) setLastRouteCoords(result.coords);
            if (!result.isProper && result.debug) {
              const longOffline = result.debug.includes('confidence limit');
              const nativeValhallaDebug = result.debug.includes('native valhalla') || result.debug.includes('diag ');
              setQuickToast(longOffline && !nativeValhallaDebug
                ? 'Long offline route needs the Valhalla routing pack engine. Map tiles still work; try a shorter segment or route with signal.'
                : `Offline route failed: ${result.debug}`
              );
              setTimeout(() => setQuickToast(''), nativeValhallaDebug ? 16000 : longOffline ? 11000 : 8000);
              setNavMode(false);
              if (!longOffline) {
                setNavDest(null);
                navDestRef.current = null;
                nativeMapRef.current?.resetRoute();
                webRef.current?.postMessage(JSON.stringify({ type: 'nav_reset' }));
              }
              return;
            }
          }}
          onRoutePersist={data => {
            storage.set('trailhead_active_route', JSON.stringify({ ...data, ts: Date.now() })).catch(() => {});
          }}
          onOffRoute={(lat, lng, dist) => onWebMessage({ nativeEvent: { data: JSON.stringify({ type: 'off_route', lat, lng, dist }) } })}
          onOffRouteWarn={(lat, lng, dist) => onWebMessage({ nativeEvent: { data: JSON.stringify({ type: 'off_route_warn', lat, lng, dist }) } })}
          onBackOnRoute={() => onWebMessage({ nativeEvent: { data: JSON.stringify({ type: 'back_on_route' }) } })}
        />
      ) : (
        // ── WebView (current binary) ────────────────────────────────────────
        <WebView
          ref={webRef}
          source={{ html: mapHtml }}
          style={s.map}
          javaScriptEnabled
          allowsInlineMediaPlayback
          scrollEnabled={false}
          onShouldStartLoadWithRequest={() => true}
          onMessage={onWebMessage}
          onLoad={() => {
            webLoadedRef.current = true;
            setMapLoadFailed(false);
            if (mapboxToken || protomapsKey) {
              webRef.current?.postMessage(JSON.stringify({
                type: 'set_token', token: mapboxToken,
                style: MAP_MODES[mapLayer] ?? MAP_MODES.satellite,
                apiBase: process.env.EXPO_PUBLIC_API_URL ?? 'https://api.gettrailhead.app',
                protomapsKey,
              }));
            }
            if (userLoc) webRef.current?.postMessage(JSON.stringify({ type: 'user_pos', lat: userLoc.lat, lng: userLoc.lng }));
          }}
          onError={() => setMapLoadFailed(true)}
        />
      )}

      {/* Offline map load error banner */}
      {mapLoadFailed && (
        <View style={s.mapLoadFailBanner}>
          <Ionicons name="cloud-offline-outline" size={14} color="#fbbf24" />
          <Text style={s.mapLoadFailText}>MAP FAILED TO LOAD — OFFLINE MAPS NOT DOWNLOADED FOR THIS AREA</Text>
        </View>
      )}

      {/* Select-on-map mode banner */}
      {selectOnMapMode && (
        <View style={{ position: 'absolute', top: 60, left: 16, right: 16, zIndex: 100,
          backgroundColor: '#3b82f6', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10,
          flexDirection: 'row', alignItems: 'center', gap: 10,
          shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, elevation: 8 }}>
          <Ionicons name="locate" size={18} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600', flex: 1 }}>Tap the map to set destination</Text>
          <TouchableOpacity onPress={() => setSelectOnMapMode(false)}>
            <Ionicons name="close" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      )}

      {/* Top bar */}
      <View style={s.topBar}>
        <View style={[s.topBarDot, navMode && { backgroundColor: C.green }]} />
        <Text style={s.topBarText} numberOfLines={1}>
          {isDownloading
            ? `CACHING ${downloadProgress}% · ${downloadSaved.toLocaleString()} COORDS · ${downloadMB} MB`
            : offlineWarning && navMode
              ? '⚠ NO OFFLINE MAPS — TAP MAP BUTTON TO DOWNLOAD'
              : isRerouting
              ? 'RECALCULATING ROUTE...'
              : navMode
                ? navDest && waypoints.length === 0
                  ? isApproaching ? `ARRIVING · ${navDest.name}` : `NAVIGATING TO ${navDest.name.split(',')[0].toUpperCase()}`
                  : isApproaching
                    ? `ARRIVING · ${waypoints[navIdx]?.name ?? ''}`
                    : isProceeding
                      ? `PROCEED TO STOP ${navIdx + 1}/${waypoints.length}`
                      : `NAVIGATING · STOP ${navIdx + 1}/${waypoints.length} · ${isRouted ? (routeFromCache ? '📦 CACHED ROUTE' : '🗺 ROUTED') : '🧭 OFF-ROAD'}`
                : activeTrip ? activeTrip.plan.trip_name.toUpperCase() : 'NO ACTIVE TRIP'}
        </Text>
        {routeAlerts.length > 0 && (
          <TouchableOpacity style={s.alertPill} onPress={() => setShowAlerts(v => !v)}>
            <Text style={s.alertPillText}>⚠ {routeAlerts.length}</Text>
          </TouchableOpacity>
        )}
        {activeTrip && !navMode && (
          <TouchableOpacity
            style={s.exitTripBtn}
            onPress={() => Alert.alert('Exit Trip', 'Clear this trip and go back to planning?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Exit Trip', style: 'destructive', onPress: async () => {
                if (activeTrip) await saveOfflineTrip(activeTrip);
                if (activeTrip?.trip_id) {
                  await storage.get('trailhead_active_route').then(raw => {
                    if (!raw) return;
                    const cached = JSON.parse(raw);
                    if (cached.tripId === activeTrip.trip_id) return saveRouteGeometry(activeTrip.trip_id, cached);
                  }).catch(() => {});
                }
                setActiveTrip(null);
                webRef.current?.postMessage(JSON.stringify({ type: 'nav_reset' }));
                router.push('/(tabs)/');
              }},
            ])}
          >
            <Ionicons name="close" size={14} color={C.text2} />
          </TouchableOpacity>
        )}
      </View>

      {/* Offline mode banners */}
      {activeTripFromCache && isActuallyOffline && (
        <View style={s.offlineCacheBanner}>
          <Ionicons name="cloud-offline-outline" size={12} color="#a3e635" />
          <Text style={s.offlineCacheBannerText}>Using cached trip data — offline mode</Text>
        </View>
      )}
      {routeFromCache && navMode && isActuallyOffline && (
        <View style={[s.offlineCacheBanner, { backgroundColor: 'rgba(234,179,8,0.15)' }]}>
          <Ionicons name="navigate-outline" size={12} color="#eab308" />
          <Text style={[s.offlineCacheBannerText, { color: '#eab308' }]}>Offline — using cached route · re-routing disabled</Text>
        </View>
      )}
      {routeFromCache && navMode && !isActuallyOffline && (
        <View style={[s.offlineCacheBanner, { backgroundColor: 'rgba(59,130,246,0.12)' }]}>
          <Ionicons name="checkmark-circle-outline" size={12} color="#60a5fa" />
          <Text style={[s.offlineCacheBannerText, { color: '#60a5fa' }]}>Using cached route</Text>
        </View>
      )}
      {!!routeDebug && !isRouted && (
        <View style={[s.offlineCacheBanner, { top: 136, backgroundColor: 'rgba(127,29,29,0.82)', borderColor: 'rgba(248,113,113,0.45)' }]}>
          <Ionicons name="bug-outline" size={12} color="#fecaca" />
          <Text style={[s.offlineCacheBannerText, { color: '#fecaca' }]} numberOfLines={4}>Router: {routeDebug}</Text>
        </View>
      )}

      {!navMode && userHeading !== null && !showSearch && !selectedCamp && !selectedCommunityPin && (
        <View style={s.compassPill}>
          <ThreeNeedleCompass heading={userHeading} bearing={null} compact />
          <View>
            <Text style={s.compassDir}>{compassDir(userHeading)}</Text>
            <Text style={s.compassDeg}>{Math.round(userHeading)}°</Text>
          </View>
        </View>
      )}

      {/* Sync toast — flashes briefly when signal restores and weather is refreshed */}
      {!!syncToast && (
        <View style={s.syncToast}>
          <Ionicons name="wifi" size={11} color="#22c55e" />
          <Text style={s.syncToastText}>{syncToast}</Text>
        </View>
      )}

      {/* Land check card — appears on long-press, auto-dismisses after 8s */}
      {(landCheckLoading || landCheck) && (
        <TouchableOpacity
          activeOpacity={0.92}
          style={s.landCheckCard}
          onPress={() => { setLandCheck(null); setLandCheckLoading(false); if (landCheckDismissTimer.current) clearTimeout(landCheckDismissTimer.current); }}
        >
          {landCheckLoading ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <ActivityIndicator size="small" color="#f97316" />
              <Text style={s.landCheckTitle}>Checking land status...</Text>
            </View>
          ) : landCheck ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <View style={[s.landCheckBadge, {
                  backgroundColor: landCheck.camping_status === 'allowed' ? '#16a34a33'
                    : landCheck.camping_status === 'restricted' ? '#dc262633'
                    : landCheck.camping_status === 'check-rules' ? '#d9770633'
                    : '#37415133',
                  borderColor: landCheck.camping_status === 'allowed' ? '#22c55e'
                    : landCheck.camping_status === 'restricted' ? '#ef4444'
                    : landCheck.camping_status === 'check-rules' ? '#f97316'
                    : '#6b7280',
                }]}>
                  <Text style={[s.landCheckBadgeText, {
                    color: landCheck.camping_status === 'allowed' ? '#22c55e'
                      : landCheck.camping_status === 'restricted' ? '#ef4444'
                      : landCheck.camping_status === 'check-rules' ? '#f97316'
                      : '#9ca3af',
                  }]}>
                    {landCheck.camping_status === 'allowed' ? 'CAMPING OK'
                      : landCheck.camping_status === 'restricted' ? 'RESTRICTED'
                      : landCheck.camping_status === 'check-rules' ? 'CHECK RULES'
                      : 'UNKNOWN'}
                  </Text>
                </View>
                <Text style={s.landCheckType}>{landCheck.land_type}</Text>
                {landCheck.admin_name ? <Text style={s.landCheckAdmin} numberOfLines={1}>{landCheck.admin_name}</Text> : null}
              </View>
              <Text style={s.landCheckNote}>{landCheck.camping_note}</Text>
              <Text style={s.landCheckSource}>Source: {landCheck.source} · tap to dismiss</Text>
            </>
          ) : null}
        </TouchableOpacity>
      )}

      {/* Offline download progress bar */}
      {isDownloading && (
        <View style={s.dlBar}>
          <View style={[s.dlFill, { width: `${downloadProgress}%` as any }]} />
        </View>
      )}

      {/* Controls — hidden during nav (panel covers them and they serve no purpose while driving) */}
      <ScrollView
        style={[s.controls, navMode && { opacity: 0, pointerEvents: 'none' as any }]}
        contentContainerStyle={s.controlsInner}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <TouchableOpacity style={s.ctrlBtn} onPress={() => setControlsCollapsed(v => !v)}>
          <Ionicons name={controlsCollapsed ? 'chevron-down' : 'chevron-up'} size={20} color={C.text} />
        </TouchableOpacity>

        {!controlsCollapsed && (
          <>
            <TouchableOpacity style={s.ctrlBtn} onPress={() => {
              if (!userLoc) return;
              webRef.current?.postMessage(JSON.stringify({ type: 'locate', lat: userLoc.lat, lng: userLoc.lng }));
              nativeMapRef.current?.locate(userLoc.lat, userLoc.lng);
              const deg = 0.35;
              const b = { n: userLoc.lat + deg, s: userLoc.lat - deg, e: userLoc.lng + deg, w: userLoc.lng - deg, zoom: 10 };
              viewportRef.current = b;
              loadCampsInArea(b, activeFilters);
            }}>
              <Ionicons name="locate" size={20} color={OVR.text} />
            </TouchableOpacity>

            <TouchableOpacity style={s.ctrlBtn} onPress={switchLayer}>
              <Text style={s.layerText}>{layerLabel[mapLayer]}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.ctrlBtn, showLands && { backgroundColor: '#16a34a99', borderColor: '#22c55e' }]}
              onPress={() => {
                const next = !showLands;
                setShowLands(next);
                webRef.current?.postMessage(JSON.stringify({ type: 'set_land_overlay', show: next }));
              }}
            >
              <Text style={[s.layerText, showLands && { color: '#22c55e' }]}>LANDS</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.ctrlBtn, showUsgs && { backgroundColor: '#0369a199', borderColor: '#0ea5e9' }]}
              onPress={() => {
                const next = !showUsgs;
                setShowUsgs(next);
                webRef.current?.postMessage(JSON.stringify({ type: 'set_usgs_overlay', show: next }));
              }}
            >
              <Text style={[s.layerText, showUsgs && { color: '#0ea5e9' }]}>TRAILS</Text>
            </TouchableOpacity>

            {waypoints.length > 0 && (
              <TouchableOpacity
                style={[s.ctrlBtn, navMode && { backgroundColor: C.green + 'dd', borderColor: C.green }]}
                onPress={() => {
                  if (navMode) { setNavMode(false); return; }
                  const days = [...new Set(waypoints.map(w => w.day))].sort((a, b) => a - b);
                  if (days.length <= 1) { startDayNav('all'); return; }
                  setShowDayModal(true);
                }}
              >
                <Ionicons name="navigate" size={20} color={navMode ? '#fff' : OVR.text} />
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[s.ctrlBtn, showSearch && { backgroundColor: '#3b82f6dd', borderColor: '#3b82f6' }]}
              onPress={() => { setShowSearch(p => !p); setSearchResults([]); setSearchQuery(''); }}
            >
              <Ionicons name="search" size={20} color={showSearch ? '#fff' : OVR.text} />
            </TouchableOpacity>

            {waypoints.length > 0 && (
              <TouchableOpacity
                style={[s.ctrlBtn, isDownloading && { backgroundColor: C.orange + 'dd', borderColor: C.orange }]}
                onPress={() => {
                  if (USE_NATIVE_MAP) {
                    setShowOfflineModal(true);
                    return;
                  }
                  if (isDownloading) {
                    webRef.current?.postMessage(JSON.stringify({ type: 'cancel_download' }));
                    setIsDownloading(false);
                  } else {
                    const vpLabel = 'area-' + Date.now();
                    setIsDownloading(true);
                    setDownloadLabel(vpLabel);
                    webRef.current?.postMessage(JSON.stringify({ type: 'download_tiles', label: vpLabel, minZ: 10, maxZ: 17 }));
                  }
                }}
              >
                <Ionicons
                  name={isDownloading ? 'close-circle-outline' : offlineSaved ? 'cloud-done-outline' : 'cloud-download-outline'}
                  size={20}
                  color={isDownloading ? '#fff' : offlineSaved ? C.green : OVR.text}
                />
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[s.ctrlBtn, showFilters && { backgroundColor: '#14b8a6dd', borderColor: '#14b8a6' }]}
              onPress={() => { setShowFilters(p => !p); if (showFilters) { setActiveFilters([]); setActivePinFilters([]); setSelectedCamp(null); } }}
            >
              <Ionicons name="filter" size={20} color={showFilters ? '#fff' : OVR.text} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.ctrlBtn, isLoadingAreaCamps && { borderColor: '#14b8a6' }]}
              onPress={() => {
                const center = userLoc ?? (waypoints[0] ? { lat: waypoints[0].lat, lng: waypoints[0].lng } : null);
                if (!center) return;
                const deg = 0.4;
                const bounds = { n: center.lat + deg, s: center.lat - deg, e: center.lng + deg, w: center.lng - deg, zoom: 10 };
                viewportRef.current = bounds;
                loadCampsInArea(bounds, activeFilters);
              }}
            >
              {isLoadingAreaCamps
                ? <ActivityIndicator size="small" color="#14b8a6" />
                : <Ionicons name="trail-sign-outline" size={20} color={OVR.text} />
              }
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.ctrlBtn, showPois && { backgroundColor: '#3b82f6dd', borderColor: '#3b82f6' }]}
              onPress={() => setShowPois(p => !p)}
            >
              <Ionicons name="water-outline" size={20} color={showPois ? '#fff' : OVR.text} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.ctrlBtn, { borderColor: C.border }]}
              onPress={() => setShowOfflineModal(true)}
            >
              <Ionicons name="map-outline" size={18} color={C.text2} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.ctrlBtn, showLayerSheet && { backgroundColor: '#6366f1dd', borderColor: '#6366f1' }]}
              onPress={() => setShowLayerSheet(true)}
            >
              <Ionicons name="layers-outline" size={20} color={showLayerSheet ? '#fff' : OVR.text} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.ctrlBtn, nearbyNarration != null && { backgroundColor: '#f97316dd', borderColor: '#f97316' }]}
              onPress={nearbyLoading ? undefined : handleNearbyAudio}
              disabled={nearbyLoading}
            >
              {nearbyLoading
                ? <ActivityIndicator size="small" color={C.orange} />
                : <Ionicons name="headset-outline" size={20} color={nearbyNarration != null ? '#fff' : OVR.text} />
              }
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      {/* Route alerts */}
      {showAlerts && routeAlerts.length > 0 && (
        <View style={s.alertPanel}>
          <View style={s.alertHeader}>
            <Ionicons name="warning" size={14} color={C.red} />
            <Text style={s.alertTitle}>ROUTE ALERTS ({routeAlerts.length})</Text>
            <TouchableOpacity onPress={() => setShowAlerts(false)}>
              <Ionicons name="close" size={15} color={C.text3} />
            </TouchableOpacity>
          </View>
          <ScrollView style={{ maxHeight: 160 }} showsVerticalScrollIndicator={false}>
            {routeAlerts.map(r => (
              <View key={r.id} style={[s.alertItem, r.severity === 'critical' && { borderLeftWidth: 3, borderLeftColor: C.red }]}>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 2 }}>
                  <Text style={s.alertBadge}>{r.type.replace('_', ' ').toUpperCase()}</Text>
                  {(r.severity === 'critical' || r.severity === 'high') && (
                    <Text style={[s.alertSev, { color: r.severity === 'critical' ? C.red : C.yellow }]}>
                      {r.severity.toUpperCase()}
                    </Text>
                  )}
                </View>
                {r.description ? <Text style={s.alertDesc} numberOfLines={2}>{r.description}</Text> : null}
                {r.created_at ? (
                  <Text style={[s.alertDesc, { opacity: 0.45, marginTop: 1 }]}>{timeAgo(r.created_at)}</Text>
                ) : null}
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* ── Search overlay ── */}
      {/* ── Route Search Modal (OsmAnd-style) ──────────────────────────── */}
      {showSearch && !navMode && (
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
          <RouteSearchModal
            visible={showSearch}
            userLoc={userLoc}
            camps={[
              ...(activeTrip?.campsites ?? []).filter(c => c.lat != null && c.lng != null && isFinite(c.lat) && isFinite(c.lng)),
              ...areaCamps.filter(c => c.lat != null && c.lng != null),
            ] as any}
            gas={(activeTrip?.gas_stations ?? []).filter(g => g.lat != null && g.lng != null && isFinite(g.lat) && isFinite(g.lng)) as any}
            pois={routePois}
            communityPins={communityPins}
            routeOpts={routeOpts}
            routeCoords={lastRouteCoords.length > 0 ? lastRouteCoords : undefined}
            routeCard={searchRouteCard}
            onLoadSavedTrip={async (tripId) => {
              const trip = await loadOfflineTrip(tripId).catch(() => null)
                ?? await api.getTrip(tripId).catch(() => null);
              if (trip) {
                setActiveTrip(trip);
                setShowSearch(false);
                setTimeout(() => setShowDayModal(true), 350);
              }
            }}
            onCampTap={camp => {
              setShowSearch(false); setSelectedCamp(camp);
              setCampDetail(null); setCampInsight(null); setWikiArticles([]);
              setCampFullness(null); setCampWeather(null);
              if (camp?.id) api.getCampFullness(camp.id).then(r => setCampFullness(r)).catch(() => {});
              if (camp?.lat && camp?.lng) api.getWeather(camp.lat, camp.lng, 3).then(r => setCampWeather(r)).catch(() => {});
            }}
            onSelectDest={place => {
              const dist = userLoc ? haversineKm(userLoc.lat, userLoc.lng, place.lat, place.lng) : null;
              setSearchRouteCard({ ...place, dist });
              nativeMapRef.current?.flyTo(place.lat, place.lng);
              webRef.current?.postMessage(JSON.stringify({ type: 'fly_to', lat: place.lat, lng: place.lng, name: place.name }));
              // Pre-load route
              if (userLoc) {
                const dest = { lat: place.lat, lng: place.lng, name: place.name, day: 0, type: 'waypoint' as const };
                navDestRef.current = dest;
                setNavDest(dest);
                webRef.current?.postMessage(JSON.stringify({ type: 'route_to_search', lat: dest.lat, lng: dest.lng, name: dest.name, userLat: userLoc.lat, userLng: userLoc.lng }));
                nativeMapRef.current?.routeToSearch(dest.lat, dest.lng, dest.name, userLoc.lat, userLoc.lng);
              }
            }}
            onStartNav={() => { setShowSearch(false); navigateToSearch(); }}
            onSelectOnMap={() => { setShowSearch(false); setSelectOnMapMode(true); }}
            onClose={() => { setShowSearch(false); setSearchRouteCard(null); }}
            onClearRoute={() => { setSearchRouteCard(null); navDestRef.current = null; setNavDest(null); }}
            onOpenRouteOpts={() => setShowRouteOpts(true)}
          />
        </View>
      )}

      {/* ── Campsite filter bar ── */}
      {showFilters && !navMode && (
        <View style={s.filterBar}>
          {/* Row 1 — land type */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterScroll}>
            {([
              { id: 'blm',       label: 'BLM',          icon: 'earth-outline' as const },
              { id: 'usfs',      label: 'Nat. Forest',  icon: 'leaf-outline' as const },
              { id: 'nps',       label: 'Nat. Park',    icon: 'triangle-outline' as const },
              { id: 'state',     label: 'State Park',   icon: 'map-outline' as const },
              { id: 'corps',     label: 'Corps / Lake', icon: 'water-outline' as const },
            ] as const).map(f => {
              const active = activeFilters.includes(f.id);
              return (
                <TouchableOpacity key={f.id} style={[s.filterChip, active && s.filterChipActive]}
                  onPress={() => setActiveFilters(prev =>
                    prev.includes(f.id) ? prev.filter(x => x !== f.id) : [...prev, f.id]
                  )}>
                  <Ionicons name={f.icon} size={13} color={active ? '#fff' : OVR.text2} style={{ marginRight: 4 }} />
                  <Text style={[s.filterChipText, active && { color: '#fff' }]}>{f.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {/* Row 2 — site type */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[s.filterScroll, { paddingTop: 0 }]}>
            {([
              { id: 'dispersed', label: 'Dispersed',    icon: 'radio-button-off-outline' as const },
              { id: 'tent',      label: 'Tent Sites',   icon: 'home-outline' as const },
              { id: 'rv',        label: 'RV / Hookups', icon: 'car-outline' as const },
              { id: 'walk_in',   label: 'Walk-in',      icon: 'walk-outline' as const },
              { id: 'group',     label: 'Group',        icon: 'people-outline' as const },
              { id: 'equestrian',label: 'Horse / Stock',icon: 'trail-sign-outline' as const },
              { id: 'waterfront',label: 'Waterfront',   icon: 'boat-outline' as const },
              { id: 'free',      label: 'Free',         icon: 'pricetag-outline' as const },
              { id: 'ada',       label: 'ADA',          icon: 'accessibility-outline' as const },
            ] as const).map(f => {
              const active = activeFilters.includes(f.id);
              return (
                <TouchableOpacity key={f.id} style={[s.filterChip, active && s.filterChipActive]}
                  onPress={() => setActiveFilters(prev =>
                    prev.includes(f.id) ? prev.filter(x => x !== f.id) : [...prev, f.id]
                  )}>
                  <Ionicons name={f.icon} size={13} color={active ? '#fff' : OVR.text2} style={{ marginRight: 4 }} />
                  <Text style={[s.filterChipText, active && { color: '#fff' }]}>{f.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <View style={s.filterSectionHeader}>
            <Text style={s.filterSectionTitle}>COMMUNITY PINS</Text>
            {activePinFilters.length > 0 && (
              <TouchableOpacity onPress={() => setActivePinFilters([])}>
                <Text style={s.filterClearText}>SHOW ALL</Text>
              </TouchableOpacity>
            )}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[s.filterScroll, { paddingTop: 0 }]}>
            {COMMUNITY_PIN_TYPES.map(f => {
              const active = activePinFilters.includes(f.id);
              return (
                <TouchableOpacity key={f.id} style={[s.filterChip, active && { backgroundColor: f.color, borderColor: f.color }]}
                  onPress={() => setActivePinFilters(prev =>
                    prev.includes(f.id) ? prev.filter(x => x !== f.id) : [...prev, f.id]
                  )}>
                  <Ionicons name={f.icon as any} size={13} color={active ? '#fff' : f.color} style={{ marginRight: 4 }} />
                  <Text style={[s.filterChipText, active && { color: '#fff' }]}>{f.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {isLoadingAreaCamps && (
            <View style={s.filterLoading}>
              <ActivityIndicator size="small" color="#14b8a6" />
            </View>
          )}
        </View>
      )}

      {/* ── Campsite quick card ── */}
      {selectedCamp && !navMode && (
        <View style={s.quickCard}>
          {/* Photo / placeholder */}
          <View style={s.quickCardImg}>
            {selectedCamp.photo_url
              ? <Image source={{ uri: selectedCamp.photo_url }} style={s.quickCardPhoto} resizeMode="cover" />
              : <View style={[s.quickCardPhotoPlaceholder, { backgroundColor: landColor(selectedCamp.land_type).bg }]}>
                  <Text style={{ fontSize: 36 }}>
                    {(selectedCamp.tags ?? []).includes('rv') ? '🚐' : (selectedCamp.tags ?? []).includes('dispersed') ? '🌲' : '🏕️'}
                  </Text>
                  <Text style={{ fontSize: 9, color: landColor(selectedCamp.land_type).text, fontFamily: mono, marginTop: 4, fontWeight: '700' }}>
                    {(selectedCamp.land_type || 'CAMP').toUpperCase().slice(0, 12)}
                  </Text>
                </View>
            }
          </View>
          <View style={s.quickCardBody}>
            {/* Close + name + heart */}
            <View style={s.quickCardHeader}>
              <Text style={s.quickCardName} numberOfLines={2}>{selectedCamp.name}</Text>
              <TouchableOpacity
                style={[s.quickCardClose, { marginRight: 2 }]}
                onPress={() => toggleFavorite(selectedCamp)}
              >
                <Ionicons
                  name={favoriteCamps.some(f => f.id === selectedCamp.id) ? 'heart' : 'heart-outline'}
                  size={16}
                  color={favoriteCamps.some(f => f.id === selectedCamp.id) ? '#ef4444' : C.text2}
                />
              </TouchableOpacity>
              <TouchableOpacity style={s.quickCardClose} onPress={() => { setSelectedCamp(null); setCampFullness(null); setCampWeather(null); }}>
                <Ionicons name="close" size={16} color={C.text3} />
              </TouchableOpacity>
            </View>
            {/* Land badge */}
            {selectedCamp.land_type ? (
              <View style={[s.landBadge, { backgroundColor: landColor(selectedCamp.land_type).bg, borderColor: landColor(selectedCamp.land_type).border }]}>
                <Text style={[s.landBadgeText, { color: landColor(selectedCamp.land_type).text }]}>
                  {selectedCamp.land_type.toUpperCase()}
                </Text>
              </View>
            ) : null}
            {/* Amenity tags */}
            <View style={s.quickCardTags}>
              {(selectedCamp.tags ?? []).slice(0, 5).map(t => (
                <View key={t} style={s.qTag}>
                  <Text style={s.qTagText}>{tagEmoji(t)} {t.toUpperCase()}</Text>
                </View>
              ))}
              {selectedCamp.ada && (
                <View style={[s.qTag, { borderColor: '#3b82f6', backgroundColor: '#eff6ff' }]}>
                  <Text style={[s.qTagText, { color: '#1d4ed8' }]}>♿ ADA</Text>
                </View>
              )}
            </View>
            {/* Cost */}
            {selectedCamp.cost ? (
              <Text style={s.quickCardCost}>
                {selectedCamp.reservable ? '📅 ' : '🆓 '}{selectedCamp.cost}
              </Text>
            ) : null}
            {/* Rig compatibility */}
            {(() => { const compat = rigCompatibility(selectedCamp, rigProfile); return compat ? (
              <View style={[s.rigCompatBadge, { borderColor: compat.ok ? C.green + '66' : C.yellow + '88', backgroundColor: compat.ok ? C.green + '18' : C.yellow + '14' }]}>
                <Text style={[s.rigCompatText, { color: compat.ok ? C.green : C.yellow }]}>{compat.msg}</Text>
              </View>
            ) : null; })()}
            {/* Weather 3-day strip */}
            {campWeather && campWeather.daily.time.length >= 3 && (
              <View style={s.weatherStrip}>
                {[0, 1, 2].map(i => (
                  <View key={i} style={s.weatherDay}>
                    <Text style={s.weatherIcon}>{weatherIcon(campWeather.daily.weathercode[i])}</Text>
                    <Text style={s.weatherHiLo}>
                      {Math.round(campWeather.daily.temperature_2m_max[i])}°/{Math.round(campWeather.daily.temperature_2m_min[i])}°
                    </Text>
                  </View>
                ))}
              </View>
            )}
            {/* Camp Fullness */}
            {campFullness && campFullness.status === 'full' ? (
              <View style={s.fullnessBanner}>
                <View style={s.fullnessBannerTop}>
                  <Ionicons name="warning" size={13} color="#dc2626" />
                  <Text style={s.fullnessBannerText}>
                    REPORTED FULL · {campFullness.confirmations} confirmed
                  </Text>
                  <Text style={s.fullnessAge}>
                    {Math.round((Date.now() / 1000 - campFullness.reported_at) / 3600)}h ago
                  </Text>
                </View>
                <View style={s.fullnessVoteRow}>
                  <TouchableOpacity
                    style={[s.fullnessVoteBtn, s.fullnessStillFull]}
                    onPress={() => handleFullnessVote('confirm')}
                    disabled={fullnessVoting}
                  >
                    <Text style={s.fullnessStillFullText}>👍 STILL FULL</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.fullnessVoteBtn, s.fullnessOpen]}
                    onPress={() => handleFullnessVote('dispute')}
                    disabled={fullnessVoting}
                  >
                    <Text style={s.fullnessOpenText}>✅ IT'S OPEN</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity style={s.reportFullBtn} onPress={handleReportFull} disabled={fullnessVoting}>
                <Ionicons name="warning-outline" size={12} color="#f59e0b" />
                <Text style={s.reportFullText}>REPORT CAMP FULL</Text>
              </TouchableOpacity>
            )}
            {activeTrip && (
              <TouchableOpacity
                style={s.quickCardTripBtn}
                onPress={() => useCampForTripDay(selectedCamp, selectedDay ?? selectedCamp.recommended_day ?? activeTrip.plan.daily_itinerary[0]?.day ?? 1)}
              >
                <Ionicons name="add-circle-outline" size={13} color={C.green} />
                <Text style={s.quickCardTripText}>
                  USE FOR DAY {selectedDay ?? selectedCamp.recommended_day ?? activeTrip.plan.daily_itinerary[0]?.day ?? 1}
                </Text>
              </TouchableOpacity>
            )}
            {/* Actions */}
            <View style={s.quickCardActions}>
              <TouchableOpacity style={s.quickCardNav} onPress={() => navigateToCamp(selectedCamp)}>
                <Ionicons name="navigate" size={13} color="#fff" />
                <Text style={s.quickCardNavText}>NAVIGATE</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.quickCardFull} onPress={openCampDetail} disabled={loadingDetail}>
                {loadingDetail
                  ? <ActivityIndicator size="small" color={C.orange} />
                  : <Text style={s.quickCardFullText}>FULL PROFILE →</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* ── Campsite full profile modal ── */}
      <Modal visible={showCampDetail} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowCampDetail(false)}>
        <View style={s.detailModal}>
          {campDetail && (
            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Photos */}
              {(campDetail.photos ?? []).length > 0 ? (
                <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={s.photoGallery}>
                  {(campDetail.photos ?? []).map((uri, i) => (
                    <Image key={i} source={{ uri }} style={s.galleryPhoto} resizeMode="cover" />
                  ))}
                </ScrollView>
              ) : (
                <View style={s.galleryPlaceholder}>
                  <Text style={{ fontSize: 48 }}>🏕️</Text>
                </View>
              )}

              <View style={s.detailContent}>
                {/* Header */}
                <View style={s.detailHeader}>
                  <Text style={s.detailName}>{campDetail.name}</Text>
                  <TouchableOpacity style={s.detailClose} onPress={() => setShowCampDetail(false)}>
                    <Ionicons name="close" size={22} color={C.text} />
                  </TouchableOpacity>
                </View>

                {/* Tags */}
                <View style={s.detailTags}>
                  {campDetail.land_type ? (
                    <View style={[s.detailLandBadge, { backgroundColor: landColor(campDetail.land_type).bg, borderColor: landColor(campDetail.land_type).border }]}>
                      <Text style={[s.detailLandText, { color: landColor(campDetail.land_type).text }]}>{campDetail.land_type.toUpperCase()}</Text>
                    </View>
                  ) : null}
                  {campDetail.tags.map(t => (
                    <View key={t} style={s.qTag}><Text style={s.qTagText}>{tagEmoji(t)} {t.toUpperCase()}</Text></View>
                  ))}
                  {campDetail.ada && (
                    <View style={[s.qTag, { borderColor: '#3b82f6', backgroundColor: '#eff6ff' }]}>
                      <Text style={[s.qTagText, { color: '#1d4ed8' }]}>♿ ADA</Text>
                    </View>
                  )}
                </View>

                {/* Cost + sites count */}
                <View style={s.detailMeta}>
                  <Text style={s.detailCost}>{campDetail.cost}</Text>
                  {campDetail.campsites_count > 0 && (
                    <Text style={s.detailSiteCount}>{campDetail.campsites_count} sites</Text>
                  )}
                </View>

                {/* Description */}
                {campDetail.description ? (
                  <View style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>About</Text>
                    <Text style={s.detailDesc}>{campDetail.description.replace(/<[^>]+>/g, '')}</Text>
                  </View>
                ) : null}

                {/* Amenities */}
                {(campDetail.amenities ?? []).length > 0 && (
                  <View style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>AMENITIES</Text>
                    <View style={s.amenityGrid}>
                      {(campDetail.amenities ?? []).map(a => {
                        const al = a.toLowerCase();
                        const icon = al.includes('water') ? '💧' : al.includes('shower') ? '🚿'
                          : al.includes('toilet') || al.includes('restroom') ? '🚻'
                          : al.includes('electric') || al.includes('hookup') ? '⚡'
                          : al.includes('dump') ? '🗑️' : al.includes('fire') ? '🔥'
                          : al.includes('picnic') ? '🌳' : al.includes('trash') ? '🗑️'
                          : al.includes('wifi') || al.includes('internet') ? '📶'
                          : al.includes('cell') ? '📱' : al.includes('rv') ? '🚐'
                          : al.includes('pet') || al.includes('dog') ? '🐾' : '✓';
                        return (
                          <View key={a} style={s.amenityItem}>
                            <Text style={{ fontSize: 13 }}>{icon}</Text>
                            <Text style={s.amenityText}>{a}</Text>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                )}

                {/* Site types */}
                {(campDetail.site_types ?? []).length > 0 && (
                  <View style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>SITE TYPES</Text>
                    <View style={s.amenityGrid}>
                      {(campDetail.site_types ?? []).map(st => (
                        <View key={st} style={[s.amenityItem, { backgroundColor: '#f0fdf4', borderColor: '#86efac' }]}>
                          <Text style={{ fontSize: 13 }}>⛺</Text>
                          <Text style={[s.amenityText, { color: '#15803d' }]}>{st}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                {/* Activities */}
                {(campDetail.activities ?? []).length > 0 && (
                  <View style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>Activities</Text>
                    <Text style={s.detailActivities}>{(campDetail.activities ?? []).join(' · ')}</Text>
                  </View>
                )}

                {/* Coordinates */}
                <View style={s.detailSection}>
                  <Text style={s.detailSectionTitle}>Coordinates</Text>
                  <View style={s.coordRow}>
                    <Text style={s.coordText}>
                      {campDetail.lat.toFixed(6)}, {campDetail.lng.toFixed(6)}
                    </Text>
                    <TouchableOpacity style={s.coordCopy} onPress={() => copyCoordinates(campDetail.lat, campDetail.lng)}>
                      <Ionicons name="copy-outline" size={14} color={C.orange} />
                      <Text style={s.coordCopyText}>COPY</Text>
                    </TouchableOpacity>
                  </View>
                  {campInsight?.coordinates_dms ? (
                    <Text style={s.coordDms}>{campInsight.coordinates_dms}</Text>
                  ) : null}
                </View>

                {/* AI Insight */}
                {(campInsight || loadingInsight) && (
                  <View style={s.detailSection}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                      <Text style={s.detailSectionTitle}>AI Insight</Text>
                      {campInsight?.star_rating && (
                        <Text style={s.aiStars}>{'★'.repeat(campInsight.star_rating)}{'☆'.repeat(5 - campInsight.star_rating)}</Text>
                      )}
                    </View>
                    {loadingInsight && !campInsight && <ActivityIndicator size="small" color={C.orange} />}
                    {campInsight?.insider_tip ? (
                      <View style={s.insiderTip}>
                        <Text style={s.insiderLabel}>💡 INSIDER TIP</Text>
                        <Text style={s.insiderText}>{campInsight.insider_tip}</Text>
                      </View>
                    ) : null}
                    {campInsight?.best_for ? <Text style={s.aiMeta}>Best for: {campInsight.best_for}</Text> : null}
                    {campInsight?.best_season ? <Text style={s.aiMeta}>Best season: {campInsight.best_season}</Text> : null}
                    {campInsight?.hazards ? (
                      <View style={s.hazardRow}>
                        <Ionicons name="warning-outline" size={13} color={C.yellow} />
                        <Text style={s.hazardText}>{campInsight.hazards}</Text>
                      </View>
                    ) : null}
                    {campInsight?.nearby_highlights?.length ? (
                      <View style={{ marginTop: 8 }}>
                        <Text style={[s.detailSectionTitle, { borderBottomWidth: 0, paddingBottom: 0, marginBottom: 6 }]}>Nearby</Text>
                        {campInsight.nearby_highlights.map((h, i) => (
                          <Text key={i} style={s.nearbyItem}>• {h}</Text>
                        ))}
                      </View>
                    ) : null}
                  </View>
                )}

                {/* Wikipedia nearby */}
                {(wikiArticles.length > 0 || loadingWiki) && (
                  <View style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>Wikipedia Nearby</Text>
                    {loadingWiki && !wikiArticles.length && <ActivityIndicator size="small" color={C.orange} />}
                    {wikiArticles.map((w, i) => (
                      <TouchableOpacity key={i} style={s.wikiItem} onPress={() => Linking.openURL(w.url)}>
                        <View style={s.wikiItemHeader}>
                          <Text style={s.wikiTitle} numberOfLines={1}>{w.title}</Text>
                          <Text style={s.wikiDist}>{(w.dist_m / 1609).toFixed(1)} mi</Text>
                        </View>
                        {w.extract ? <Text style={s.wikiExtract} numberOfLines={2}>{w.extract}</Text> : null}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* ── Field Reports ── */}
                <View style={s.detailSection}>
                  <View style={s.frHeader}>
                    <Text style={s.detailSectionTitle}>FIELD REPORTS</Text>
                    {fieldReportSummary && fieldReportSummary.count > 0 && (
                      <Text style={s.frCount}>{fieldReportSummary.count} {fieldReportSummary.count === 1 ? 'report' : 'reports'}</Text>
                    )}
                  </View>

                  {/* Sentiment bar */}
                  {fieldReportSummary && fieldReportSummary.count > 0 && (() => {
                    const total = fieldReportSummary.count;
                    const loved = (fieldReportSummary.sentiment_counts['loved_it'] ?? 0) / total;
                    const ok    = (fieldReportSummary.sentiment_counts['its_ok']    ?? 0) / total;
                    const skip  = (fieldReportSummary.sentiment_counts['would_skip'] ?? 0) / total;
                    return (
                      <View style={{ marginBottom: 10 }}>
                        <View style={s.frSentimentBar}>
                          {loved > 0 && <View style={[s.frBarSeg, { flex: loved, backgroundColor: '#22c55e' }]} />}
                          {ok    > 0 && <View style={[s.frBarSeg, { flex: ok,    backgroundColor: '#f59e0b' }]} />}
                          {skip  > 0 && <View style={[s.frBarSeg, { flex: skip,  backgroundColor: '#ef4444' }]} />}
                        </View>
                        <View style={s.frSentimentLegend}>
                          {loved > 0 && <Text style={[s.frLegendItem, { color: '#22c55e' }]}>😍 {Math.round(loved * 100)}%</Text>}
                          {ok    > 0 && <Text style={[s.frLegendItem, { color: '#f59e0b' }]}>👍 {Math.round(ok * 100)}%</Text>}
                          {skip  > 0 && <Text style={[s.frLegendItem, { color: '#ef4444' }]}>👎 {Math.round(skip * 100)}%</Text>}
                          {fieldReportSummary.last_visited && (
                            <Text style={s.frLastVisited}>Last visited {fieldReportSummary.last_visited}</Text>
                          )}
                        </View>
                        {/* Top tags */}
                        {fieldReportSummary.top_tags.length > 0 && (
                          <View style={s.frTagCloud}>
                            {fieldReportSummary.top_tags.map(({ tag, count }) => (
                              <View key={tag} style={s.frTagCloudItem}>
                                <Text style={s.frTagCloudText}>{tag}</Text>
                                {count > 1 && <Text style={s.frTagCloudCount}>{count}</Text>}
                              </View>
                            ))}
                          </View>
                        )}
                      </View>
                    );
                  })()}

                  {/* Report list */}
                  {fieldReports.slice(0, 5).map(fr => {
                    const sentimentIcon = fr.sentiment === 'loved_it' ? '😍' : fr.sentiment === 'its_ok' ? '👍' : '👎';
                    const accessLabel   = fr.access_condition === 'easy' ? '🟢 Easy access' : fr.access_condition === 'rough' ? '🟡 Rough access' : '🔴 4WD required';
                    const crowdLabel    = fr.crowd_level === 'empty' ? 'Empty' : fr.crowd_level === 'few_rigs' ? 'A few rigs' : 'Packed';
                    return (
                      <View key={fr.id} style={s.frCard}>
                        <View style={s.frCardTop}>
                          <Text style={s.frCardSentiment}>{sentimentIcon}</Text>
                          <View style={{ flex: 1 }}>
                            <Text style={s.frCardMeta}>{fr.username} · {fr.visited_date}</Text>
                            {fr.rig_label && <Text style={s.frCardRig}>{fr.rig_label}</Text>}
                          </View>
                          {fr.has_photo && <Ionicons name="camera-outline" size={13} color={C.text3} />}
                        </View>
                        <View style={s.frCardBadges}>
                          <Text style={s.frCardBadge}>{accessLabel}</Text>
                          <Text style={s.frCardBadge}>👥 {crowdLabel}</Text>
                        </View>
                        {fr.tags.length > 0 && (
                          <View style={s.frCardTags}>
                            {fr.tags.slice(0, 5).map(t => (
                              <View key={t} style={s.frInlineTag}><Text style={s.frInlineTagText}>{t}</Text></View>
                            ))}
                          </View>
                        )}
                        {fr.note ? <Text style={s.frCardNote} numberOfLines={3}>{fr.note}</Text> : null}
                      </View>
                    );
                  })}

                  {fieldReports.length === 0 && !showFieldReportForm && (
                    <Text style={s.frEmpty}>No field reports yet. Be the first to check in.</Text>
                  )}

                  {/* Submission form */}
                  {showFieldReportForm ? (
                    <View style={s.frForm}>
                      <Text style={s.frFormLabel}>How was it?</Text>
                      <View style={s.frPillRow}>
                        {([['loved_it','😍 Loved it','#22c55e'],['its_ok','👍 It\'s OK','#f59e0b'],['would_skip','👎 Would skip','#ef4444']] as const).map(([val, label, color]) => (
                          <TouchableOpacity key={val} style={[s.frSentimentBtn, frSentiment === val && { borderColor: color, backgroundColor: color + '22' }]}
                            onPress={() => setFrSentiment(val)}>
                            <Text style={[s.frSentimentBtnText, frSentiment === val && { color }]}>{label}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>

                      <Text style={s.frFormLabel}>Access road</Text>
                      <View style={s.frPillRow}>
                        {([['easy','🟢 Easy'],['rough','🟡 Rough'],['four_wd_required','🔴 4WD Only']] as const).map(([val, label]) => (
                          <TouchableOpacity key={val} style={[s.frPill, frAccess === val && s.frPillActive]}
                            onPress={() => setFrAccess(val)}>
                            <Text style={[s.frPillText, frAccess === val && s.frPillTextActive]}>{label}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>

                      <Text style={s.frFormLabel}>Crowd level</Text>
                      <View style={s.frPillRow}>
                        {([['empty','🌲 Empty'],['few_rigs','⛺ A few rigs'],['packed','🚗 Packed']] as const).map(([val, label]) => (
                          <TouchableOpacity key={val} style={[s.frPill, frCrowd === val && s.frPillActive]}
                            onPress={() => setFrCrowd(val)}>
                            <Text style={[s.frPillText, frCrowd === val && s.frPillTextActive]}>{label}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>

                      <Text style={s.frFormLabel}>Tags (pick any)</Text>
                      <View style={s.frTagPicker}>
                        {['Great Views','Dog Friendly','Water Nearby','No Cell Signal','Fire Ring',
                          'Very Quiet','High Clearance','Good Shade','Exposed/Windy','Creek Nearby',
                          'Stargazing','Kids Friendly','Dusty Road','Fishing Nearby','Horse Friendly'].map(tag => {
                          const on = frTags.includes(tag);
                          return (
                            <TouchableOpacity key={tag}
                              style={[s.frTagPill, on && s.frTagPillOn]}
                              onPress={() => setFrTags(p => on ? p.filter(t => t !== tag) : [...p, tag])}>
                              <Text style={[s.frTagPillText, on && s.frTagPillTextOn]}>{tag}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>

                      <Text style={s.frFormLabel}>Notes <Text style={s.frOptional}>(optional)</Text></Text>
                      <TextInput
                        style={s.frNoteInput}
                        value={frNote}
                        onChangeText={v => setFrNote(v.slice(0, 280))}
                        placeholder="Road conditions, water source, anything useful..."
                        placeholderTextColor={C.text3}
                        multiline
                        numberOfLines={3}
                      />
                      <Text style={s.frCharCount}>{frNote.length}/280</Text>

                      <TouchableOpacity style={s.frPhotoBtn} onPress={pickFieldReportPhoto}>
                        <Ionicons name={frPhoto ? 'checkmark-circle' : 'camera-outline'} size={16} color={frPhoto ? '#22c55e' : C.text3} />
                        <Text style={[s.frPhotoBtnText, frPhoto && { color: '#22c55e' }]}>
                          {frPhoto ? 'Photo added (+5 credits)' : 'Add photo (+5 credits)'}
                        </Text>
                      </TouchableOpacity>

                      <View style={s.frFormActions}>
                        <TouchableOpacity style={s.frCancelBtn} onPress={() => { setShowFieldReportForm(false); resetFieldReportForm(); }}>
                          <Text style={s.frCancelText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[s.frSubmitBtn, (!frSentiment || !frAccess || !frCrowd || frSubmitting) && { opacity: 0.5 }]}
                          onPress={submitFieldReport}
                          disabled={!frSentiment || !frAccess || !frCrowd || frSubmitting}
                        >
                          {frSubmitting
                            ? <ActivityIndicator size="small" color="#fff" />
                            : <Text style={s.frSubmitText}>SUBMIT +{frPhoto ? 10 : 5} CREDITS</Text>}
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    user && (
                      <TouchableOpacity style={s.frAddBtn} onPress={() => setShowFieldReportForm(true)}>
                        <Ionicons name="add-circle-outline" size={15} color={C.orange} />
                        <Text style={s.frAddBtnText}>ADD FIELD REPORT</Text>
                      </TouchableOpacity>
                    )
                  )}
                </View>

                {/* Actions */}
                <View style={s.detailActions}>
                  {campDetail.url && !campDetail.url.includes('openstreetmap.org/node') && (
                    <TouchableOpacity style={s.detailBookBtn} onPress={() => Linking.openURL(campDetail.url)}>
                      <Ionicons name="calendar" size={16} color="#fff" />
                      <Text style={s.detailBookText}>BOOK ON RECREATION.GOV</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={s.detailDirBtn} onPress={() => openExternalMaps(campDetail.lat, campDetail.lng, campDetail.name)}>
                    <Ionicons name="navigate-outline" size={16} color={C.orange} />
                    <Text style={s.detailDirText}>GET DIRECTIONS</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.detailDirBtn, { borderColor: '#3b82f6' }]}
                    onPress={() => copyCoordinates(campDetail.lat, campDetail.lng)}>
                    <Ionicons name="copy-outline" size={16} color="#3b82f6" />
                    <Text style={[s.detailDirText, { color: '#3b82f6' }]}>COPY GPS COORDS</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* ── Route Options Sheet ── */}
      <Modal visible={showRouteOpts} animationType="slide" transparent onRequestClose={() => setShowRouteOpts(false)}>
        <TouchableOpacity style={s.modalBackdrop} activeOpacity={1} onPress={() => setShowRouteOpts(false)}>
          <View style={s.routeOptsSheet}>
            <Text style={s.routeOptsTitle}>ROUTE OPTIONS</Text>
            {([
              { key: 'avoidTolls',   label: 'Avoid Tolls',          sub: 'Stay off toll roads' },
              { key: 'avoidHighways',label: 'Avoid Highways',        sub: 'No interstates/motorways' },
              { key: 'backRoads',    label: 'Prefer Back Roads',     sub: 'Scenic, slower — via Valhalla' },
              { key: 'noFerries',    label: 'No Ferries',            sub: 'Avoid water crossings' },
            ] as const).map(opt => (
              <TouchableOpacity key={opt.key} style={s.routeOptRow}
                onPress={() => setRouteOpts(p => ({ ...p, [opt.key]: !p[opt.key] }))}>
                <View style={s.routeOptCheck}>
                  {routeOpts[opt.key] && <Ionicons name="checkmark" size={14} color={C.orange} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.routeOptLabel}>{opt.label}</Text>
                  <Text style={s.routeOptSub}>{opt.sub}</Text>
                </View>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={s.routeOptsApply} onPress={() => {
              setShowRouteOpts(false);
              if (searchRouteCard && userLoc) navigateToSearch();
            }}>
              <Text style={s.routeOptsApplyText}>APPLY & ROUTE</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Offline Map Download Modal — native MLN pack system ── */}
      <OfflineModal
        visible={showOfflineModal}
        onClose={() => setShowOfflineModal(false)}
        waypoints={waypoints}
        routeCoords={lastRouteCoords}
        tripName={activeTrip?.plan?.trip_name ?? null}
        useNativeMap={USE_NATIVE_MAP}
        onWebDownloadBbox={opts => {
          webRef.current?.postMessage(JSON.stringify({ type: 'download_tiles_bbox', ...opts }));
          setIsDownloading(true); setDownloadLabel(opts.label);
        }}
        onWebDownloadRoute={opts => {
          webRef.current?.postMessage(JSON.stringify({ type: 'download_tiles_route', ...opts }));
          setIsDownloading(true); setDownloadLabel(opts.label);
        }}
        onWebCancelDownload={() => {
          webRef.current?.postMessage(JSON.stringify({ type: 'cancel_download' }));
          setIsDownloading(false);
        }}
        onWebClearRegion={label => {
          removeCachedRegion(label);
          webRef.current?.postMessage(JSON.stringify({ type: 'clear_cached_region', label }));
        }}
        webIsDownloading={isDownloading}
        webDownloadProgress={downloadProgress}
        webDownloadSaved={downloadSaved}
        webDownloadTotal={downloadTotal}
        webDownloadMB={downloadMB}
        webCachedRegions={cachedRegions}
        webDownloadLabel={downloadLabel}
      />

      {/* ── Route Brief Modal ── */}
      <Modal visible={showRouteBrief} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowRouteBrief(false)}>
        <View style={s.detailModal}>
          {routeBrief && (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20 }}>
              <View style={s.detailHeader}>
                <Text style={s.detailName}>Route Briefing</Text>
                <TouchableOpacity style={s.detailClose} onPress={() => setShowRouteBrief(false)}>
                  <Ionicons name="close" size={22} color={C.text} />
                </TouchableOpacity>
              </View>
              <View style={[s.readinessRow, { borderColor: routeBrief.readiness_score >= 7 ? C.green : routeBrief.readiness_score >= 4 ? C.yellow : C.red }]}>
                <Text style={s.readinessScore}>{routeBrief.readiness_score}/10</Text>
                <Text style={s.readinessLabel}>READINESS</Text>
              </View>
              <Text style={s.briefSummary}>{routeBrief.briefing_summary}</Text>
              {routeBrief.top_concerns.length > 0 && (
                <View style={s.detailSection}>
                  <Text style={s.detailSectionTitle}>Key Concerns</Text>
                  {routeBrief.top_concerns.map((c, i) => (
                    <View key={i} style={s.briefItem}>
                      <Ionicons name="warning-outline" size={14} color={C.yellow} />
                      <Text style={s.briefItemText}>{c}</Text>
                    </View>
                  ))}
                </View>
              )}
              {routeBrief.must_do_before_leaving.length > 0 && (
                <View style={s.detailSection}>
                  <Text style={s.detailSectionTitle}>Before You Leave</Text>
                  {routeBrief.must_do_before_leaving.map((t, i) => (
                    <View key={i} style={s.briefItem}>
                      <Ionicons name="checkmark-circle-outline" size={14} color={C.green} />
                      <Text style={s.briefItemText}>{t}</Text>
                    </View>
                  ))}
                </View>
              )}
              <View style={s.briefStats}>
                <View style={s.briefStat}><Text style={s.briefStatVal}>{routeBrief.estimated_fuel_stops}</Text><Text style={s.briefStatLabel}>Fuel Stops</Text></View>
                <View style={s.briefStat}><Text style={s.briefStatVal}>{routeBrief.water_carry_gallons}</Text><Text style={s.briefStatLabel}>Gals Water</Text></View>
              </View>
              {routeBrief.signal_dead_zones && routeBrief.signal_dead_zones.length > 0 && (
                <View style={s.detailSection}>
                  <Text style={s.detailSectionTitle}>📵 Signal Dead Zones</Text>
                  {routeBrief.signal_dead_zones.map((z, i) => (
                    <View key={i} style={s.briefItem}>
                      <Ionicons name="cellular-outline" size={14} color={C.text3} />
                      <Text style={s.briefItemText}>{z}</Text>
                    </View>
                  ))}
                </View>
              )}
              {routeBrief.fire_restriction_likelihood && (
                <View style={s.detailSection}>
                  <Text style={s.detailSectionTitle}>🔥 Fire Restrictions</Text>
                  <Text style={[s.briefSummary, { marginTop: 4 }]}>{routeBrief.fire_restriction_likelihood}</Text>
                </View>
              )}
              {routeBrief.emergency_bailout && (
                <View style={[s.detailSection, { backgroundColor: C.red + '12', borderRadius: 8, padding: 10 }]}>
                  <Text style={[s.detailSectionTitle, { color: C.red }]}>🚨 Emergency Bailout</Text>
                  <Text style={[s.briefSummary, { marginTop: 4 }]}>{routeBrief.emergency_bailout}</Text>
                </View>
              )}
              {routeBrief.daily_highlights.length > 0 && (
                <View style={s.detailSection}>
                  <Text style={s.detailSectionTitle}>Daily Highlights</Text>
                  {routeBrief.daily_highlights.map((h, i) => (
                    <View key={i} style={s.briefItem}>
                      <Text style={{ fontSize: 12, color: C.orange }}>D{i + 1}</Text>
                      <Text style={s.briefItemText}>{h}</Text>
                    </View>
                  ))}
                </View>
              )}
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* ── Packing List Modal ── */}
      <Modal visible={showPacking} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowPacking(false)}>
        <View style={s.detailModal}>
          {packingList && (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20 }}>
              <View style={s.detailHeader}>
                <Text style={s.detailName}>Packing List</Text>
                <TouchableOpacity style={s.detailClose} onPress={() => setShowPacking(false)}>
                  <Ionicons name="close" size={22} color={C.text} />
                </TouchableOpacity>
              </View>
              {([
                { key: 'essentials',          label: 'Essentials',       icon: '⭐' },
                { key: 'recovery_gear',       label: 'Recovery Gear',    icon: '🔧' },
                { key: 'water_food',          label: 'Water & Food',     icon: '💧' },
                { key: 'navigation',          label: 'Navigation',       icon: '🗺️' },
                { key: 'shelter',             label: 'Shelter',          icon: '⛺' },
                { key: 'tools_spares',        label: 'Tools & Spares',   icon: '🔩' },
                { key: 'optional_nice_to_have',label:'Nice to Have',     icon: '✨' },
                { key: 'leave_at_home',       label: 'Leave at Home',    icon: '🚫' },
              ] as const).map(section => {
                const items = (packingList as any)[section.key] as string[];
                if (!items?.length) return null;
                return (
                  <View key={section.key} style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>{section.icon} {section.label}</Text>
                    {items.map((item, i) => (
                      <View key={i} style={s.briefItem}>
                        <View style={s.packDot} />
                        <Text style={s.briefItemText}>{item}</Text>
                      </View>
                    ))}
                  </View>
                );
              })}
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* ── Search This Area (native button — reliable on all platforms) ── */}
      {(mapMoved || isLoadingAreaCamps || searchResult !== null || activeFilters.length > 0 || activePinFilters.length > 0) && !navMode && !showSearch && !selectedCamp && !selectedCommunityPin && !(showPanel && activeTrip) && mapZoom >= 9 && (
        <View style={s.searchAreaWrap}>
          <TouchableOpacity
            style={[s.searchAreaBtn, isLoadingAreaCamps && s.searchAreaBtnLoading]}
            onPress={() => {
              if (!isLoadingAreaCamps && viewportRef.current) {
                loadCampsInArea(viewportRef.current, activeFilters);
              }
            }}
            disabled={isLoadingAreaCamps}
          >
            {isLoadingAreaCamps ? (
              <ActivityIndicator size="small" color={C.orange} style={{ marginRight: 6 }} />
            ) : searchResult !== null ? (
              <Ionicons
                name={searchResult.count === -2 ? 'expand-outline' : searchResult.count < 0 ? 'alert-circle-outline' : searchResult.count === 0 ? 'information-circle-outline' : 'checkmark-circle-outline'}
                size={14}
                color={searchResult.count === -2 ? C.text2 : searchResult.count < 0 ? C.red : searchResult.count === 0 ? C.text3 : C.green}
                style={{ marginRight: 5 }}
              />
            ) : (
              <Ionicons name="search" size={13} color={C.orange} style={{ marginRight: 5 }} />
            )}
            <Text style={[s.searchAreaText, isLoadingAreaCamps && { color: OVR.text3 }]}>
              {isLoadingAreaCamps
                ? 'SEARCHING...'
                : searchResult !== null
                  ? searchResult.count === -2
                    ? 'ZOOM IN TO SEARCH'
                    : searchResult.count < 0
                      ? 'SEARCH FAILED — RETRY'
                      : searchResult.count === 0
                        ? 'NO CAMPS FOUND HERE'
                        : `${searchResult.count} CAMP${searchResult.count !== 1 ? 'S' : ''} FOUND`
                  : activeFilters.length + activePinFilters.length > 0
                    ? `SEARCH · ${activeFilters.length + activePinFilters.length} FILTER${activeFilters.length + activePinFilters.length !== 1 ? 'S' : ''} ACTIVE`
                    : 'SEARCH THIS AREA'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Layer Sheet ── */}
      <Modal visible={showLayerSheet} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowLayerSheet(false)}>
        <View style={s.layerSheet}>
          <View style={s.layerSheetHeader}>
            <Text style={s.layerSheetTitle}>MAP LAYERS</Text>
            <TouchableOpacity onPress={() => setShowLayerSheet(false)}>
              <Ionicons name="close" size={22} color={C.text2} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={s.layerSectionHead}>BASE OVERLAYS</Text>
            {([
              { key: 'terrain', label: '3D Terrain + Hillshade', sub: 'Mapbox DEM — elevation + depth shading', icon: 'triangle-outline', val: layerTerrain, set: setLayerTerrain },
              { key: 'naip',    label: 'USGS Aerial (NAIP)',     sub: 'High-res US aerial photography',          icon: 'earth-outline',    val: layerNaip,    set: setLayerNaip },
            ] as const).map(l => (
              <TouchableOpacity key={l.key} style={s.layerRow} onPress={() => { const nv = !l.val; l.set(nv); toggleDataLayer(l.key, nv); }}>
                <View style={[s.layerRowIcon, l.val && { backgroundColor: '#6366f1' }]}>
                  <Ionicons name={l.icon as any} size={16} color={l.val ? '#fff' : C.text2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.layerRowLabel}>{l.label}</Text>
                  <Text style={s.layerRowSub}>{l.sub}</Text>
                </View>
                <View style={[s.layerDot, l.val && { backgroundColor: '#6366f1' }]} />
              </TouchableOpacity>
            ))}

            <Text style={s.layerSectionHead}>CONDITIONS</Text>
            {([
              { key: 'fire',  label: 'Active Wildfires',   sub: 'NIFC WFIGS — live fire perimeters',       icon: 'flame-outline',      val: layerFire,  set: setLayerFire,  color: '#ef4444' },
              { key: 'ava',   label: 'Avalanche Zones',    sub: 'Danger 1–5 across all 20 US centers',     icon: 'snow-outline',       val: layerAva,   set: setLayerAva,   color: '#3b82f6' },
              { key: 'radar', label: 'Rain Radar',         sub: 'RainViewer — animated precipitation',     icon: 'rainy-outline',      val: layerRadar, set: setLayerRadar, color: '#06b6d4' },
            ] as const).map(l => (
              <TouchableOpacity key={l.key} style={s.layerRow} onPress={() => { const nv = !l.val; l.set(nv); toggleDataLayer(l.key, nv); }}>
                <View style={[s.layerRowIcon, l.val && { backgroundColor: l.color }]}>
                  <Ionicons name={l.icon as any} size={16} color={l.val ? '#fff' : C.text2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.layerRowLabel}>{l.label}</Text>
                  <Text style={s.layerRowSub}>{l.sub}</Text>
                </View>
                <View style={[s.layerDot, l.val && { backgroundColor: l.color }]} />
              </TouchableOpacity>
            ))}

            <Text style={s.layerSectionHead}>ROADS &amp; TRAILS</Text>
            {([
              { key: 'mvum',  label: 'MVUM — USFS Roads & Trails', sub: 'Legal vehicle access per USFS designation', icon: 'car-outline',        val: layerMvum,  set: setLayerMvum,  color: '#22c55e' },
              { key: 'roads', label: 'Road Surface (4WD/Dirt)',    sub: 'OSM gravel/dirt/4WD-only overlay',          icon: 'git-branch-outline', val: layerRoads, set: setLayerRoads, color: '#f97316' },
            ] as const).map(l => (
              <TouchableOpacity key={l.key} style={s.layerRow} onPress={() => { const nv = !l.val; l.set(nv); toggleDataLayer(l.key, nv); }}>
                <View style={[s.layerRowIcon, l.val && { backgroundColor: l.color }]}>
                  <Ionicons name={l.icon as any} size={16} color={l.val ? '#fff' : C.text2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.layerRowLabel}>{l.label}</Text>
                  <Text style={s.layerRowSub}>{l.sub}</Text>
                </View>
                <View style={[s.layerDot, l.val && { backgroundColor: l.color }]} />
              </TouchableOpacity>
            ))}

            <Text style={s.layerSectionHead}>LEGEND</Text>
            <View style={{ paddingHorizontal: 16, paddingBottom: 8, gap: 6 }}>
              {[
                { color: '#22c55e', label: 'MVUM — Open to all vehicles' },
                { color: '#f97316', label: 'MVUM — High clearance required' },
                { color: '#ef4444', label: 'MVUM — Closed / motorized prohibited' },
                { color: '#a855f7', label: 'MVUM — Designated trail' },
                { color: '#eab308', label: 'Road surface — Gravel' },
                { color: '#f97316', label: 'Road surface — Dirt/unpaved' },
                { color: '#92400e', label: 'Road surface — Mud/difficult' },
              ].map(l => (
                <View key={l.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ width: 22, height: 4, backgroundColor: l.color, borderRadius: 2 }} />
                  <Text style={{ color: C.text2, fontSize: 11, fontFamily: mono }}>{l.label}</Text>
                </View>
              ))}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                {[
                  { color: '#50C878', label: 'Low (1)' }, { color: '#FFD700', label: 'Moderate (2)' },
                  { color: '#FF8C00', label: 'Considerable (3)' }, { color: '#E63946', label: 'High (4)' }, { color: '#1a0a0a', label: 'Extreme (5)' },
                ].map(a => (
                  <View key={a.label} style={{ alignItems: 'center', gap: 2 }}>
                    <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: a.color }} />
                    <Text style={{ color: C.text3, fontSize: 8, fontFamily: mono }}>{a.label}</Text>
                  </View>
                ))}
              </View>
              <Text style={{ color: C.text3, fontSize: 10, fontFamily: mono, marginTop: 2 }}>Avalanche danger levels</Text>
            </View>
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </Modal>

      {/* ── Navigation HUD ── */}
      <Animated.View style={[s.navHud, {
        opacity: navAnim,
        transform: [{ translateY: navAnim.interpolate({ inputRange: [0, 1], outputRange: [160, 0] }) }],
        pointerEvents: navMode ? 'box-none' : 'none',
      }]}>

        {/* Turn instruction strip — arriving / rerouting / proceed-to-route / normal */}
        {navMode && isApproaching ? (
          <View style={[s.turnStrip, { backgroundColor: '#0d2a16' }]}>
            <View style={[s.turnIconWrap, { borderColor: '#22c55e77', backgroundColor: '#22c55e22' }]}>
              <Ionicons name="flag-outline" size={28} color="#22c55e" />
            </View>
            <View style={s.turnInfo}>
              <Text style={[s.turnLabel, { color: '#22c55e' }]}>ARRIVING</Text>
              {navTarget?.name ? <Text style={s.turnRoad} numberOfLines={1}>{navTarget.name}</Text> : null}
            </View>
            {distKm !== null && (
              <Text style={[s.turnDist, { color: '#22c55e' }]}>{formatDist(distKm)}</Text>
            )}
          </View>
        ) : navMode && isRerouting ? (
          <View style={[s.turnStrip, { backgroundColor: '#92400e' }]}>
            <ActivityIndicator color="#fff" size="small" style={{ marginRight: 12 }} />
            <View style={s.turnInfo}>
              <Text style={s.turnLabel}>Recalculating...</Text>
              <Text style={s.turnRoad}>Off route — finding new path</Text>
            </View>
          </View>
        ) : navMode && proceedToRoute ? (
          <View style={[s.turnStrip, { backgroundColor: '#1e3a5f' }]}>
            <View style={s.turnIconWrap}>
              <Ionicons name="navigate-outline" size={28} color="#fff" />
            </View>
            <View style={s.turnInfo}>
              <Text style={s.turnLabel}>Proceed to route</Text>
              <Text style={s.turnRoad} numberOfLines={1}>Head toward the route</Text>
            </View>
            <Text style={s.turnDist}>{formatStepDist(stepDistM!)}</Text>
          </View>
        ) : nextStep && isRouted ? (
          <View style={s.turnStripWrap}>
            <View style={s.turnStrip}>
              <View style={s.turnIconWrap}>
                <TurnArrow modifier={nextStep.modifier ?? ''} type={nextStep.type ?? ''} size={54} color="#f5a623" />
              </View>
              <View style={s.turnInfo}>
                <Text style={s.turnDist}>{formatStepDist(stepDistM ?? nextStep.distance)}</Text>
                <Text style={s.turnLabel}>{stepLabel(nextStep.type, nextStep.modifier, nextStep.name)}</Text>
                {nextStep.name ? <Text style={s.turnRoad} numberOfLines={1}>{nextStep.name}</Text> : null}
              </View>
            </View>
            {/* Distance countdown bar — fills orange as maneuver approaches */}
            {stepDistM !== null && nextStep.distance > 80 && (
              <View style={s.stepProgressBg}>
                <View style={[s.stepProgressFill, {
                  width: `${Math.max(2, Math.min(100, ((nextStep.distance - stepDistM) / nextStep.distance) * 100))}%` as any,
                }]} />
              </View>
            )}
            {/* Lane guidance row */}
            {nextStep.lanes && nextStep.lanes.length > 0 && stepDistM !== null && stepDistM < 800 && (
              <View style={s.laneRow}>
                <Text style={s.laneLabel}>LANES</Text>
                {nextStep.lanes.map((lane, li) => (
                  <View key={li} style={[s.laneBox, lane.valid && s.laneBoxActive]}>
                    <Ionicons
                      name={laneArrowIcon(lane.indications[0] ?? 'straight') as any}
                      size={13}
                      color={lane.valid ? '#f97316' : OVR.text3 + '44'}
                    />
                  </View>
                ))}
              </View>
            )}
            {/* "Then" preview — next step shown when within far-announcement range */}
            {afterStep && stepDistM !== null && stepDistM < (announceDists(speedMph)[0] * 1.2) &&
              afterStep.type !== 'arrive' && (
              <View style={s.thenRow}>
                <Ionicons name={stepIcon(afterStep.type, afterStep.modifier) as any} size={14} color="rgba(255,255,255,0.5)" />
                <Text style={s.thenText} numberOfLines={1}>
                  then {stepLabel(afterStep.type, afterStep.modifier, afterStep.name)} · {formatStepDist(afterStep.distance)}
                </Text>
              </View>
            )}
          </View>
        ) : null}

        {/* Off-route nudge — shown between 30–200m off route, before rerouting */}
        {offRouteWarn && navMode && !isRerouting && (
          <View style={s.offRouteWarnBar}>
            <Ionicons name="return-up-back-outline" size={14} color="#fbbf24" />
            <Text style={s.offRouteWarnText}>RETURN TO ROUTE</Text>
            <TouchableOpacity onPress={manualReroute} style={s.offRouteWarnBtn}>
              <Text style={s.offRouteWarnBtnText}>REROUTE NOW</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Speed + distance strip */}
        <View style={s.navStrip}>
          {/* Speed circle (Waze-style) */}
          <View style={s.navSpeedCircle}>
            <Text style={s.navSpeedBig}>{speedMph !== null ? Math.round(speedMph) : '--'}</Text>
            <Text style={s.navSpeedUnit}>MPH</Text>
          </View>

          {/* Speed limit sign (MUTCD) — only shown when per-step data is available */}
          {speedLimitMph !== null && (
            <View style={[s.navSpeedSign, speedMph !== null && Math.round(speedMph) > speedLimitMph + 5 && s.navSpeedSignOver]}>
              <Text style={s.navSpeedSignHeader}>SPEED</Text>
              <Text style={s.navSpeedSignHeader}>LIMIT</Text>
              <Text style={s.navSpeedSignNum}>{speedLimitMph}</Text>
            </View>
          )}

          {/* Distance + ETA */}
          <View style={s.navDistBlock}>
            <Text style={[s.navDistVal, isApproaching && { color: C.green }]}>
              {distKm !== null ? formatDist(distKm) : '--'}
            </Text>
            {etaMins !== null && (
              <Text style={s.navEta}>ARRIVE {etaClockTime(etaMins)}</Text>
            )}
            {remainingKm !== null && waypoints.length > navIdx + 1 && (
              <Text style={s.navRemaining}>{formatDist(remainingKm)} trip total</Text>
            )}
          </View>

          {/* Three-needle compass */}
          <View style={s.navBearing}>
            <ThreeNeedleCompass heading={userHeading} bearing={bearing} />
          </View>
        </View>

        {/* Next waypoint */}
        {navTarget && !isApproaching && (
          <View style={s.navTarget}>
            <View style={[s.navTargetBadge, isProceeding && { backgroundColor: '#1e3a5f', borderColor: '#3b82f6' }]}>
              <Text style={[s.navTargetBadgeText, isProceeding && { color: '#60a5fa' }]}>
                {isProceeding ? 'PROCEED TO' : 'NEXT STOP'}
              </Text>
            </View>
            <View style={s.navTargetInfo}>
              <Text style={s.navTargetName} numberOfLines={1}>{navTarget.name}</Text>
              <Text style={s.navTargetMeta}>
                {navTarget.day > 0 ? `Day ${navTarget.day} · ` : ''}
                {navTarget.type === 'camp' ? '⛺ Camp' : navTarget.type === 'fuel' ? '⛽ Fuel' : navTarget.type === 'start' ? '🚩 Start' : navTarget.type === 'motel' ? '🏨 Motel' : navTarget.type}
                {waypoints.length > 0 ? ` · ${navIdx + 1}/${waypoints.length}` : ''}
              </Text>
            </View>
          </View>
        )}

        {/* Turn list toggle + actions */}
        <View style={s.navActions}>
          <TouchableOpacity style={s.navEndBtn} onPress={() => setNavMode(false)}>
            <Ionicons name="close" size={14} color={C.red} />
            <Text style={s.navEndText}>END</Text>
          </TouchableOpacity>

          {routeSteps.length > 0 && (
            <TouchableOpacity style={s.navStepsBtn} onPress={() => setShowSteps(p => !p)}>
              <Ionicons name="list-outline" size={14} color={OVR.text2} />
              <Text style={s.navStepsBtnText}>TURNS {showSteps ? '▲' : '▼'}</Text>
            </TouchableOpacity>
          )}

          {isRouted && userLoc && (
            <TouchableOpacity style={s.navRerouteBtn} onPress={manualReroute} disabled={isRerouting}>
              <Ionicons name="refresh-outline" size={14} color={isRerouting ? OVR.text3 : OVR.text2} />
              <Text style={[s.navStepsBtnText, isRerouting && { color: OVR.text3 }]}>REROUTE</Text>
            </TouchableOpacity>
          )}

          {userLoc && (
            <TouchableOpacity
              style={[s.navReportBtn, quickReport && s.navReportBtnActive]}
              onPress={() => { setQuickTypeIdx(null); setQuickReport(p => !p); }}
            >
              <Ionicons name="warning" size={13} color={quickReport ? '#fff' : '#f59e0b'} />
              <Text style={[s.navReportBtnText, quickReport && { color: '#fff' }]}>REPORT</Text>
            </TouchableOpacity>
          )}

        </View>

        {/* Steps list */}
        {showSteps && routeSteps.length > 0 && (
          <ScrollView style={s.stepsList} showsVerticalScrollIndicator={false}>
            {routeSteps.map((step, i) => {
              if (step.distance <= 20 && step.type !== 'arrive') return null;
              const isActive = i === stepIdx;
              const isPast   = i < stepIdx;
              return (
                <View key={i} style={[s.stepRow, i === 0 && s.stepRowFirst, isActive && s.stepRowActive]}>
                  <Ionicons
                    name={stepIcon(step.type, step.modifier) as any}
                    size={16}
                    color={isActive ? '#fff' : isPast ? OVR.text3 + '55' : OVR.text3}
                  />
                  <View style={s.stepInfo}>
                    <Text style={[s.stepLabel, isActive && { color: '#fff' }, isPast && { color: OVR.text3, opacity: 0.4 }]}>
                      {stepLabel(step.type, step.modifier, step.name)}
                    </Text>
                    {step.name ? <Text style={[s.stepRoad, isPast && { opacity: 0.4 }]} numberOfLines={1}>{step.name}</Text> : null}
                  </View>
                  <Text style={[s.stepDist, isActive && { color: '#f97316' }, isPast && { opacity: 0.4 }]}>
                    {isActive && stepDistM !== null ? formatStepDist(stepDistM) : formatStepDist(step.distance)}
                  </Text>
                </View>
              );
            })}
          </ScrollView>
        )}
      </Animated.View>

      {/* ── Approaching report alert (Waze-style) ─────────────────────────── */}
      {approachingReport && navMode && (() => {
        const rep = approachingReport;
        const repDistM = userLoc ? haversineKm(userLoc.lat, userLoc.lng, rep.lat, rep.lng) * 1000 : null;
        const repIcons: Record<string, string> = { police: '🚔', hazard: '⚠️', road_condition: '🛑', wildlife: '🐾', road_closure: '🚧', campsite: '⛺', water: '💧' };
        const repColors: Record<string, string> = { police: '#eab308', hazard: '#ef4444', road_condition: '#f97316', wildlife: '#a855f7', road_closure: '#dc2626', campsite: '#22c55e', water: '#38bdf8' };
        const color = repColors[rep.type] ?? '#f97316';
        const icon  = repIcons[rep.type] ?? '⚠️';
        const label = rep.subtype || ({ police: 'Ranger Patrol', hazard: 'Hazard', road_condition: 'Road Condition', wildlife: 'Wildlife', road_closure: 'Road Closure' }[rep.type] ?? 'Community Report');
        return (
          <View style={[s.approachAlert, { borderColor: color + '66' }]}>
            <View style={[s.approachAlertIcon, { backgroundColor: color + '22' }]}>
              <Text style={{ fontSize: 22 }}>{icon}</Text>
            </View>
            <View style={s.approachAlertInfo}>
              <Text style={[s.approachAlertLabel, { color }]}>{label.toUpperCase()}</Text>
              <Text style={s.approachAlertDist}>
                {repDistM !== null ? `${formatStepDist(repDistM)} ahead` : 'Nearby'}
                {rep.confirmations > 0 ? ` · ${rep.confirmations} confirmed` : ''}
                {rep.created_at ? ` · ${timeAgo(rep.created_at)}` : ''}
              </Text>
            </View>
            <View style={s.approachAlertActions}>
              <TouchableOpacity
                style={[s.approachAlertBtn, { backgroundColor: color + '22', borderColor: color + '55' }]}
                onPress={async () => {
                  try {
                    await api.confirmReport(rep.id);
                    setQuickToast('+1 credit');
                  } catch (e: any) {
                    const msg = e?.message ?? '';
                    if (msg.includes('Already confirmed') || msg.includes('own report')) {
                      setQuickToast('Already confirmed');
                    } else {
                      setQuickToast('Confirmed');
                    }
                  }
                  setApproachingReport(null);
                  setTimeout(() => setQuickToast(''), 2500);
                }}
              >
                <Text style={[s.approachAlertBtnText, { color }]}>STILL{'\n'}THERE</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.approachAlertBtn, { borderColor: OVR.border }]}
                onPress={async () => {
                  try { await api.downvoteReport(rep.id); } catch {}
                  setApproachingReport(null);
                }}
              >
                <Text style={[s.approachAlertBtnText, { color: OVR.text3 }]}>NOT{'\n'}THERE</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.approachAlertClose} onPress={() => setApproachingReport(null)}>
                <Ionicons name="close" size={14} color={OVR.text3} />
              </TouchableOpacity>
            </View>
          </View>
        );
      })()}

      {/* ── Waze-style quick report (two-step: type → subtype) ─────────────── */}
      {userLoc && !showSearch && !selectedCamp && !selectedCommunityPin && (
        <View style={[s.quickReportWrap, navMode && s.quickReportWrapNav]} pointerEvents="box-none">
          {!!quickToast && (
            <View style={s.quickToast}>
              <Ionicons name="checkmark-circle" size={14} color={C.green} />
              <Text style={s.quickToastText}>{quickToast}</Text>
            </View>
          )}
          {quickReport && (
            <View style={s.quickReportPanel}>
              {quickTypeIdx === null ? (
                // Step 1: choose type
                <>
                  {QUICK_TYPES.map((rt, i) => (
                    <TouchableOpacity
                      key={rt.type}
                      style={[s.quickReportBtn, { borderColor: rt.color + '55', backgroundColor: rt.color + '18' }]}
                      onPress={() => setQuickTypeIdx(i)}
                    >
                      <Ionicons name={rt.icon as any} size={22} color={rt.color} />
                      <Text style={[s.quickReportLabel, { color: rt.color }]}>{rt.label}</Text>
                      <Ionicons name="chevron-forward-outline" size={14} color={rt.color + 'aa'} style={{ marginLeft: 'auto' }} />
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity style={s.quickReportClose} onPress={() => setQuickReport(false)}>
                    <Ionicons name="close" size={16} color={OVR.text2} />
                  </TouchableOpacity>
                </>
              ) : (
                // Step 2: choose subtype
                (() => {
                  const rt = QUICK_TYPES[quickTypeIdx];
                  const sevMap: Record<string, string> = {
                    'Police hidden': 'high', 'Speed trap': 'high', 'Police visible': 'moderate', 'Ranger patrol': 'moderate',
                    'Object in road': 'high', 'Flood / water': 'high', 'Ice / snow': 'high', 'Pothole': 'moderate', 'Downed tree': 'high',
                    'Washed out road': 'high', 'Deep ruts': 'moderate', 'Low clearance': 'high', 'Muddy / soft': 'moderate', 'Logging traffic': 'low',
                    'Animal in road': 'high', 'Livestock loose': 'high', 'Bear / predator': 'high', 'Deer herd': 'moderate', 'Animal sighting': 'low',
                  };
                  return (
                    <>
                      <View style={s.quickSubtypeHeader}>
                        <TouchableOpacity onPress={() => setQuickTypeIdx(null)} style={{ padding: 4 }}>
                          <Ionicons name="arrow-back-outline" size={16} color={OVR.text2} />
                        </TouchableOpacity>
                        <Ionicons name={rt.icon as any} size={16} color={rt.color} />
                        <Text style={[s.quickSubtypeTitle, { color: rt.color }]}>{rt.label}</Text>
                      </View>
                      {rt.subtypes.map(sub => (
                        <TouchableOpacity
                          key={sub}
                          style={[s.quickSubtypeBtn, { borderColor: rt.color + '33' }]}
                          onPress={async () => {
                            setQuickReport(false);
                            setQuickTypeIdx(null);
                            try {
                              const sev = sevMap[sub] ?? 'moderate';
                              const res = await api.submitReport({
                                lat: userLoc.lat, lng: userLoc.lng,
                                type: rt.type as any, subtype: sub,
                                description: '', severity: sev as any,
                              });
                              setQuickToast(`+${res.credits_earned} credits`);
                              setTimeout(() => setQuickToast(''), 3000);
                              addLiveReport({
                                id: res.report_id, lat: userLoc.lat, lng: userLoc.lng,
                                type: rt.type, subtype: sub, description: '',
                                severity: sev, upvotes: 0, downvotes: 0, confirmations: 0,
                                has_photo: 0, cluster_count: 1, username: user?.username ?? 'me',
                                created_at: Date.now() / 1000,
                                expires_at: Date.now() / 1000 + res.ttl_hours * 3600,
                              });
                            } catch { setQuickToast('Submitted'); setTimeout(() => setQuickToast(''), 2000); }
                          }}
                        >
                          <Text style={[s.quickSubtypeText, { color: rt.color }]}>{sub}</Text>
                        </TouchableOpacity>
                      ))}
                    </>
                  );
                })()
              )}
            </View>
          )}
          {!navMode && (
            <View style={{ gap: 8 }}>
              <TouchableOpacity
                style={[s.quickReportFab, pinDropMode && { backgroundColor: '#f97316', borderColor: '#f97316' }]}
                onPress={() => beginCommunityPinDrop(false)}
              >
                <Ionicons name="location-outline" size={13} color={pinDropMode ? '#fff' : '#f97316'} />
                <Text style={[s.quickReportFabText, pinDropMode && s.quickReportFabTextActive]}>PIN</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.quickReportFab, quickReport && s.quickReportFabActive]}
                onPress={() => { setQuickTypeIdx(null); setQuickReport(p => !p); }}
              >
                <Ionicons name="warning" size={13} color={quickReport ? '#fff' : '#f59e0b'} />
                <Text style={[s.quickReportFabText, quickReport && s.quickReportFabTextActive]}>REPORT</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {/* ── Location permission prominent disclosure ── */}
      {showLocDisclosure && (
        <View style={s.locDisclosureOverlay}>
          <View style={s.locDisclosureCard}>
            <View style={s.locDisclosureIcon}>
              <Ionicons name="navigate-circle" size={40} color={C.orange} />
            </View>
            <Text style={s.locDisclosureTitle}>LOCATION ACCESS</Text>
            <Text style={s.locDisclosureBody}>
              Trailhead uses your location <Text style={{ fontWeight: '700', color: OVR.text }}>while you use the app</Text> to:
            </Text>
            <View style={s.locDisclosureList}>
              <View style={s.locDisclosureRow}>
                <Ionicons name="location" size={13} color={C.orange} />
                <Text style={s.locDisclosureItem}>Show your position on the map</Text>
              </View>
              <View style={s.locDisclosureRow}>
                <Ionicons name="navigate" size={13} color={C.orange} />
                <Text style={s.locDisclosureItem}>Provide turn-by-turn navigation</Text>
              </View>
              <View style={s.locDisclosureRow}>
                <Ionicons name="trail-sign" size={13} color={C.orange} />
                <Text style={s.locDisclosureItem}>Find nearby campsites and trails</Text>
              </View>
              <View style={s.locDisclosureRow}>
                <Ionicons name="warning" size={13} color={C.orange} />
                <Text style={s.locDisclosureItem}>Alert you to road hazard reports</Text>
              </View>
            </View>
            <Text style={s.locDisclosureNote}>
              Location is only used while the app is open and is never shared without your consent.
            </Text>
            <TouchableOpacity
              style={s.locDisclosureAllow}
              onPress={() => {
                setShowLocDisclosure(false);
                Location.requestForegroundPermissionsAsync().then(({ status }) => {
                  if (status === 'granted') setLocGranted(true);
                });
              }}
            >
              <Ionicons name="checkmark-circle" size={16} color="#fff" />
              <Text style={s.locDisclosureAllowText}>Continue</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── "What's here?" narration card ────────────────────────────────────── */}
      {nearbyNarration && !navMode && !selectedCamp && (
        <View style={s.narrationCard}>
          <View style={s.narrationHeader}>
            <View style={s.narrationIconWrap}>
              <Ionicons name="headset-outline" size={16} color={C.orange} />
            </View>
            <Text style={s.narrationTitle}>WHAT'S HERE</Text>
            <TouchableOpacity
              style={s.narrationReplay}
              onPress={() => safeSpeech(nearbyNarration, { rate: 0.88, language: 'en-US' })}
            >
              <Ionicons name="play-circle-outline" size={18} color={C.orange} />
            </TouchableOpacity>
            <TouchableOpacity
              style={s.narrationClose}
              onPress={() => { Speech.stop(); setNearbyNarration(null); }}
            >
              <Ionicons name="close" size={16} color={OVR.text3} />
            </TouchableOpacity>
          </View>
          <Text style={s.narrationText} numberOfLines={6}>{nearbyNarration}</Text>
        </View>
      )}

      {/* Bottom itinerary panel */}
      {showPanel && !navMode && activeTrip && (
        <View style={s.panel}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.dayScroll}>
            {activeTrip.plan.daily_itinerary.map(day => {
              const isSelected = selectedDay === day.day;
              return (
                <TouchableOpacity
                  key={day.day}
                  style={[s.dayCard, isSelected && { borderColor: C.orange, borderWidth: 2, backgroundColor: C.orangeGlow }]}
                  onPress={() => {
                    Haptics.selectionAsync();
                    if (selectedDay === day.day) {
                      setSelectedDay(null);
                    } else {
                      setSelectedDay(day.day);
                      // Fit map to this day's waypoints
                      const dayWps = waypoints.filter(w => w.day === day.day);
                      if (dayWps.length >= 2) {
                        const lngs = dayWps.map(w => w.lng);
                        const lats = dayWps.map(w => w.lat);
                        setTimeout(() => {
                          nativeMapRef.current?.flyTo(
                            (Math.max(...lats) + Math.min(...lats)) / 2,
                            (Math.max(...lngs) + Math.min(...lngs)) / 2,
                            9
                          );
                        }, 100);
                      }
                    }
                  }}
                >
                  <View style={[s.dayBadge, isSelected && { backgroundColor: C.orange }]}>
                    <Text style={s.dayBadgeText}>{day.day}</Text>
                  </View>
                  <Text style={s.dayTitle} numberOfLines={1}>{day.title}</Text>
                  <Text style={s.dayMeta}>{day.est_miles}mi · {day.road_type}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Start selected day button */}
          {selectedDay !== null && (() => {
            const dayPlan = activeTrip.plan.daily_itinerary.find(d => d.day === selectedDay);
            const isRestDay = (dayPlan?.est_miles ?? 0) === 0 || dayPlan?.road_type === 'none';
            return isRestDay ? (
              <View style={s.restDayNotice}>
                <Ionicons name="bed-outline" size={14} color={C.text3} />
                <Text style={s.restDayNoticeText}>REST DAY · NO ROUTE TO START</Text>
              </View>
            ) : (
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.orange, borderRadius: 10, paddingVertical: 11, marginHorizontal: 12, marginBottom: 6 }}
              onPress={() => { setSelectedDay(null); startDayNav(selectedDay); }}
            >
              <Ionicons name="navigate" size={14} color="#fff" />
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800', fontFamily: mono }}>START DAY {selectedDay}</Text>
            </TouchableOpacity>
            );
          })()}
          <View style={s.legendRow}>
            {([[C.orange,'W','Waypoint'],[C.green,'C','Camp'],[C.yellow,'F','Fuel'],['#a855f7','P','Community']] as const)
              .map(([color, dot, label]) => (
                <View key={label} style={s.legendItem}>
                  <Text style={[s.legendDot, { color }]}>{dot}</Text>
                  <Text style={s.legendText}>{label}</Text>
                </View>
              ))}
            <TouchableOpacity style={s.mapsBtn} onPress={openInMaps}>
              <Ionicons name="open-outline" size={11} color={C.text3} />
              <Text style={s.mapsBtnText}>EXPORT</Text>
            </TouchableOpacity>
          </View>
          {/* ── WEATHER section ── */}
          <View style={s.weatherSection}>
            <View style={s.weatherSectionHeader}>
              <Ionicons name="cloud-outline" size={11} color={C.text3} />
              <Text style={s.weatherSectionLabel}>WEATHER</Text>
            </View>
            {cachedWeather ? (() => {
              // Collect camp waypoints (one per day)
              const campDays = activeTrip.plan.waypoints
                .filter(w => w.type === 'camp')
                .reduce<Record<number, typeof activeTrip.plan.waypoints[0]>>((acc, w) => {
                  if (!acc[w.day]) acc[w.day] = w;
                  return acc;
                }, {});
              const campEntries = Object.values(campDays).sort((a, b) => a.day - b.day);
              if (campEntries.length === 0) {
                return <Text style={s.weatherNone}>No camp waypoints</Text>;
              }
              return (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.weatherScroll}>
                  {campEntries.map(wp => {
                    // Find matching forecast — try exact name, then first available
                    const forecast = cachedWeather.forecasts[wp.name] ?? Object.values(cachedWeather.forecasts)[0];
                    if (!forecast?.daily) return null;
                    const { time, temperature_2m_max, temperature_2m_min, precipitation_sum, windspeed_10m_max, weathercode } = forecast.daily;
                    // Pick day index 0 as representative (forecast for first available day)
                    const idx = 0;
                    const hi   = temperature_2m_max?.[idx];
                    const lo   = temperature_2m_min?.[idx];
                    const precip = precipitation_sum?.[idx] ?? 0;
                    const wind   = windspeed_10m_max?.[idx];
                    const code   = weathercode?.[idx] ?? 1;
                    return (
                      <View key={wp.day} style={s.weatherDayCard}>
                        <Text style={s.weatherDayNum}>DAY {wp.day}</Text>
                        <Text style={s.weatherDayIcon}>{weatherIcon(code)}{precip > 2 ? ' 🌧️' : ''}</Text>
                        <Text style={s.weatherTemps}>
                          {hi !== undefined ? `${Math.round(hi)}°` : '—'}
                          <Text style={s.weatherTempLo}> / {lo !== undefined ? `${Math.round(lo)}°` : '—'}</Text>
                        </Text>
                        {wind !== undefined && (
                          <Text style={s.weatherWind}>{Math.round(wind)} mph</Text>
                        )}
                      </View>
                    );
                  })}
                </ScrollView>
              );
            })() : (
              <Text style={s.weatherNone}>No weather cached — build a trip to download forecasts</Text>
            )}
          </View>

          {/* ── START NAVIGATION — primary CTA ── */}
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.green, borderRadius: 12, paddingVertical: 13, marginBottom: 8 }}
            onPress={() => {
              const days = [...new Set(waypoints.map(w => w.day))].sort((a, b) => a - b);
              if (days.length <= 1) { startDayNav('all'); } else { setShowDayModal(true); }
            }}
          >
            <Ionicons name="navigate" size={16} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: '800', fontFamily: mono, letterSpacing: 0.5 }}>START TRIP</Text>
          </TouchableOpacity>

          <View style={s.aiActionsRow}>
            <TouchableOpacity style={s.aiActionBtn} onPress={() => openCampPicker(selectedDay ?? undefined)} disabled={campPickerLoading}>
              {campPickerLoading
                ? <ActivityIndicator size="small" color={C.orange} />
                : <><Ionicons name="trail-sign-outline" size={13} color={C.orange} /><Text style={s.aiActionText}>FIND CAMPS</Text></>
              }
            </TouchableOpacity>
            <TouchableOpacity style={s.aiActionBtn} onPress={fetchRouteBrief} disabled={loadingBrief}>
              {loadingBrief
                ? <ActivityIndicator size="small" color={C.orange} />
                : <><Ionicons name="shield-checkmark-outline" size={13} color={C.orange} /><Text style={s.aiActionText}>ROUTE BRIEF</Text></>
              }
            </TouchableOpacity>
            <TouchableOpacity style={s.aiActionBtn} onPress={fetchPackingList} disabled={loadingPacking}>
              {loadingPacking
                ? <ActivityIndicator size="small" color={C.orange} />
                : <><Ionicons name="bag-outline" size={13} color={C.orange} /><Text style={s.aiActionText}>PACKING LIST</Text></>
              }
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Day selector modal ── */}
      <Modal visible={showDayModal} transparent animationType="slide" onRequestClose={() => setShowDayModal(false)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setShowDayModal(false)}>
          <View style={s.daySheet}>
            <View style={s.daySheetHandle} />
            <Text style={s.daySheetTitle}>START NAVIGATION</Text>
            <Text style={s.daySheetSub}>Choose which day's route to navigate</Text>
            <TouchableOpacity style={s.dayBtnAll} onPress={() => startDayNav('all')}>
              <Ionicons name="navigate" size={16} color="#fff" />
              <Text style={s.dayBtnAllText}>START FULL TRIP (ALL DAYS)</Text>
            </TouchableOpacity>
            <View style={s.dayDivider}>
              <View style={s.dayDividerLine} />
              <Text style={s.dayDividerText}>OR START A SPECIFIC DAY</Text>
              <View style={s.dayDividerLine} />
            </View>
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 280 }}>
              {[...new Set(waypoints.map(w => w.day))].sort((a, b) => a - b).map(day => {
                const dayWps = waypoints.filter(w => w.day === day);
                const first = dayWps[0];
                const last = dayWps[dayWps.length - 1];
                const camps = dayWps.filter(w => w.type === 'camp').length;
                const fuel = dayWps.filter(w => w.type === 'fuel').length;
                return (
                  <TouchableOpacity key={day} style={s.dayBtn} onPress={() => startDayNav(day)}>
                    <View style={s.dayBtnDayBadge}>
                      <Text style={s.dayBtnDayNum}>{day}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.dayBtnFrom} numberOfLines={1}>{first?.name ?? '—'}</Text>
                      {last && last.name !== first?.name && (
                        <Text style={s.dayBtnTo} numberOfLines={1}>→ {last.name}</Text>
                      )}
                      <View style={s.dayBtnMeta}>
                        {camps > 0 && <Text style={s.dayBtnMetaTag}>⛺ {camps} camp</Text>}
                        {fuel > 0 && <Text style={s.dayBtnMetaTag}>⛽ {fuel} fuel</Text>}
                        <Text style={s.dayBtnMetaTag}>{dayWps.length} stops</Text>
                      </View>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={OVR.text3} />
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Trip camp picker ── */}
      <Modal visible={campPickerVisible} transparent animationType="slide" onRequestClose={() => setCampPickerVisible(false)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setCampPickerVisible(false)}>
          <View style={s.daySheet}>
            <View style={s.daySheetHandle} />
            <View style={s.campPickerHeader}>
              <View>
                <Text style={s.daySheetTitle}>CHOOSE CAMP</Text>
                <Text style={s.daySheetSub}>
                  Day {campPickerDay ?? selectedDay ?? 1} · sorted near this day's route
                </Text>
              </View>
              <TouchableOpacity style={s.campPickerRefresh} onPress={() => openCampPicker(campPickerDay ?? undefined)}>
                <Ionicons name="refresh" size={15} color={C.orange} />
              </TouchableOpacity>
            </View>
            {campPickerLoading ? (
              <View style={s.campPickerLoading}>
                <ActivityIndicator size="small" color={C.orange} />
                <Text style={s.campPickerLoadingText}>Searching camps near route...</Text>
              </View>
            ) : campPickerError ? (
              <Text style={s.campPickerError}>{campPickerError}</Text>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
                {campCandidates.map(camp => {
                  const land = landColor(camp.land_type);
                  return (
                    <TouchableOpacity key={camp.id} style={s.campPickRow} onPress={() => useCampForTripDay(camp)}>
                      <View style={[s.campPickIcon, { backgroundColor: land.bg, borderColor: land.border }]}>
                        <Ionicons name="bonfire-outline" size={17} color={land.text} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.campPickName} numberOfLines={2}>{camp.name}</Text>
                        <Text style={s.campPickMeta} numberOfLines={1}>
                          {(camp.land_type || 'camp').toUpperCase()}
                          {camp.route_distance_mi != null ? ` · ${camp.route_distance_mi.toFixed(1)} mi` : ''}
                          {camp.cost ? ` · ${camp.cost}` : ''}
                        </Text>
                        {(camp.tags ?? []).length > 0 && (
                          <Text style={s.campPickTags} numberOfLines={1}>
                            {(camp.tags ?? []).slice(0, 4).map(t => t.replace(/_/g, ' ')).join(' · ')}
                          </Text>
                        )}
                      </View>
                      <View style={s.campPickUse}>
                        <Text style={s.campPickUseText}>USE</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Trail tap sheet ── */}
      {tappedTrail && (
        <Modal visible transparent animationType="slide" onRequestClose={() => setTappedTrail(null)}>
          <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setTappedTrail(null)}>
            <View style={s.wpSheet}>
              <View style={s.daySheetHandle} />
              <View style={s.wpSheetHeader}>
                <View style={[s.wpSheetTypeDot, { backgroundColor: '#22c55e' }]} />
                <View style={{ flex: 1 }}>
                  <Text style={s.wpSheetName} numberOfLines={2}>{tappedTrail.name}</Text>
                  <Text style={s.wpSheetMeta}>{tappedTrail.cls === 'track' ? 'Dirt Track / Forest Road' : 'Trail / Path'}</Text>
                </View>
              </View>
              <View style={s.wpSheetActions}>
                <TouchableOpacity
                  style={s.wpSheetNavBtn}
                  onPress={() => {
                    setTappedTrail(null);
                    navigateToCamp({ lat: tappedTrail.lat, lng: tappedTrail.lng, name: tappedTrail.name });
                  }}
                >
                  <Ionicons name="navigate" size={14} color="#fff" />
                  <Text style={s.wpSheetNavText}>NAVIGATE HERE</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.wpSheetDayBtn} onPress={() => setTappedTrail(null)}>
                  <Ionicons name="close" size={14} color={OVR.text2} />
                  <Text style={s.wpSheetDayText}>DISMISS</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </Modal>
      )}

      {/* ── Tile-layer camp/spot tap mini sheet ── */}
      {tappedTileSpot && (
        <Modal visible transparent animationType="slide" onRequestClose={() => setTappedTileSpot(null)}>
          <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setTappedTileSpot(null)}>
            <View style={s.wpSheet}>
              <View style={s.daySheetHandle} />
              <View style={s.wpSheetHeader}>
                <View style={[s.wpSheetTypeDot, {
                  backgroundColor: tappedTileSpot.kind === 'camp_pitch' ? '#c4915a'
                                 : tappedTileSpot.kind === 'shelter'    ? '#8b5cf6'
                                 : '#14b8a6',
                }]} />
                <View style={{ flex: 1 }}>
                  <Text style={s.wpSheetName} numberOfLines={2}>{tappedTileSpot.name || (
                    tappedTileSpot.kind === 'camp_pitch' ? 'Dispersed Camping Spot' :
                    tappedTileSpot.kind === 'shelter'    ? 'Trail Shelter' :
                    'Campground'
                  )}</Text>
                  <Text style={s.wpSheetMeta}>
                    {tappedTileSpot.kind === 'camp_pitch' ? '🟤 Dispersed / Primitive Spot' :
                     tappedTileSpot.kind === 'shelter'    ? '🟣 Trail Shelter' :
                     '🟢 Developed Campground'}
                  </Text>
                </View>
              </View>
              <View style={s.wpSheetActions}>
                <TouchableOpacity
                  style={s.wpSheetNavBtn}
                  onPress={() => {
                    setTappedTileSpot(null);
                    navigateToCamp({ lat: tappedTileSpot.lat, lng: tappedTileSpot.lng, name: tappedTileSpot.name });
                  }}
                >
                  <Ionicons name="navigate" size={14} color="#fff" />
                  <Text style={s.wpSheetNavText}>NAVIGATE HERE</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.wpSheetDayBtn, { borderColor: '#ef4444' + '44' }]}
                  onPress={() => {
                    setTappedTileSpot(null);
                    setQuickReport(true);
                  }}
                >
                  <Ionicons name="warning-outline" size={14} color="#ef4444" />
                  <Text style={[s.wpSheetDayText, { color: '#ef4444' }]}>REPORT SPOT</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.wpSheetDayBtn} onPress={() => setTappedTileSpot(null)}>
                  <Ionicons name="close" size={14} color={OVR.text2} />
                  <Text style={s.wpSheetDayText}>DISMISS</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </Modal>
      )}

      {/* ── Gas station tap card ── */}
      {tappedGas && (
        <Modal visible transparent animationType="slide" onRequestClose={() => setTappedGas(null)}>
          <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setTappedGas(null)}>
            <View style={s.wpSheet}>
              <View style={s.daySheetHandle} />
              <View style={s.wpSheetHeader}>
                <View style={[s.wpSheetTypeDot, { backgroundColor: '#eab308' }]} />
                <View style={{ flex: 1 }}>
                  <Text style={s.wpSheetName} numberOfLines={2}>{tappedGas.name}</Text>
                  <Text style={s.wpSheetMeta}>⛽ Gas Station</Text>
                </View>
              </View>
              <View style={s.wpSheetActions}>
                <TouchableOpacity style={s.wpSheetNavBtn} onPress={() => { setTappedGas(null); navigateToCamp(tappedGas); }}>
                  <Ionicons name="navigate" size={14} color="#fff" />
                  <Text style={s.wpSheetNavText}>NAVIGATE HERE</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.wpSheetDayBtn} onPress={() => setTappedGas(null)}>
                  <Ionicons name="close" size={14} color={OVR.text2} />
                  <Text style={s.wpSheetDayText}>DISMISS</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </Modal>
      )}

      {/* ── POI tap card ── */}
      {tappedPoi && (
        <Modal visible transparent animationType="slide" onRequestClose={() => setTappedPoi(null)}>
          <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setTappedPoi(null)}>
            <View style={s.wpSheet}>
              <View style={s.daySheetHandle} />
              <View style={s.wpSheetHeader}>
                <View style={[s.wpSheetTypeDot, {
                  backgroundColor: tappedPoi.type === 'water' ? '#3b82f6'
                    : tappedPoi.type === 'trailhead' ? '#22c55e'
                    : tappedPoi.type === 'viewpoint' ? '#a855f7'
                    : tappedPoi.type === 'peak' ? '#92400e'
                    : tappedPoi.type === 'hot_spring' ? '#f97316' : '#6b7280',
                }]} />
                <View style={{ flex: 1 }}>
                  <Text style={s.wpSheetName} numberOfLines={2}>{tappedPoi.name || tappedPoi.type}</Text>
                  <Text style={s.wpSheetMeta}>
                    {tappedPoi.type === 'water' ? 'Water Source'
                      : tappedPoi.type === 'trailhead' ? 'Trailhead'
                      : tappedPoi.type === 'viewpoint' ? 'Viewpoint'
                      : tappedPoi.type === 'peak' ? 'Summit / Peak'
                      : tappedPoi.type === 'hot_spring' ? 'Hot Spring'
                      : 'Point of Interest'}
                  </Text>
                </View>
              </View>
              <View style={s.wpSheetActions}>
                <TouchableOpacity style={s.wpSheetNavBtn} onPress={() => { setTappedPoi(null); navigateToCamp(tappedPoi); }}>
                  <Ionicons name="navigate" size={14} color="#fff" />
                  <Text style={s.wpSheetNavText}>NAVIGATE HERE</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.wpSheetDayBtn, { borderColor: C.orange + '44' }]} onPress={() => { setTappedPoi(null); setQuickReport(true); }}>
                  <Ionicons name="warning-outline" size={14} color={C.orange} />
                  <Text style={[s.wpSheetDayText, { color: C.orange }]}>REPORT</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.wpSheetDayBtn} onPress={() => setTappedPoi(null)}>
                  <Ionicons name="close" size={14} color={OVR.text2} />
                  <Text style={s.wpSheetDayText}>DISMISS</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </Modal>
      )}

      {/* ── Community pin card ── */}
      {selectedCommunityPin && (() => {
        const meta = communityPinMeta(selectedCommunityPin.type);
        return (
          <Modal visible transparent animationType="slide" onRequestClose={() => setSelectedCommunityPin(null)}>
            <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setSelectedCommunityPin(null)}>
              <View style={s.wpSheet}>
                <View style={s.daySheetHandle} />
                <View style={s.wpSheetHeader}>
                  <View style={[s.pinIconBadge, { backgroundColor: meta.color }]}>
                    <Ionicons name={meta.icon as any} size={17} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.wpSheetName} numberOfLines={2}>{selectedCommunityPin.name || meta.label}</Text>
                    <Text style={s.wpSheetMeta}>
                      {meta.label.toUpperCase()} · {selectedCommunityPin.upvotes ?? 0} up · {selectedCommunityPin.downvotes ?? 0} down
                    </Text>
                    {!!selectedCommunityPin.description && (
                      <Text style={s.pinDescription} numberOfLines={3}>{selectedCommunityPin.description}</Text>
                    )}
                  </View>
                </View>
                <View style={s.wpSheetActions}>
                  <TouchableOpacity style={s.wpSheetNavBtn} onPress={() => { setSelectedCommunityPin(null); navigateToCamp(selectedCommunityPin); }}>
                    <Ionicons name="navigate" size={14} color="#fff" />
                    <Text style={s.wpSheetNavText}>NAVIGATE</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.wpSheetDayBtn} onPress={() => voteCommunityPin(selectedCommunityPin, 'upvote')}>
                    <Ionicons name="thumbs-up-outline" size={14} color={OVR.text2} />
                    <Text style={s.wpSheetDayText}>GOOD</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.wpSheetDayBtn, { borderColor: '#ef4444' + '44' }]} onPress={() => voteCommunityPin(selectedCommunityPin, 'downvote')}>
                    <Ionicons name="thumbs-down-outline" size={14} color="#ef4444" />
                    <Text style={[s.wpSheetDayText, { color: '#ef4444' }]}>BAD</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableOpacity>
          </Modal>
        );
      })()}

      {/* ── Drop community pin ── */}
      {pendingPin && (
        <Modal visible transparent animationType="slide" onRequestClose={() => setPendingPin(null)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.modalOverlay}>
            <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setPendingPin(null)} />
            <View style={s.wpSheet}>
              <View style={s.daySheetHandle} />
              <View style={s.pinSheetHeader}>
                <View>
                  <Text style={s.daySheetTitle}>DROP COMMUNITY PIN</Text>
                  <Text style={s.daySheetSub}>{pendingPin.lat.toFixed(5)}, {pendingPin.lng.toFixed(5)}</Text>
                </View>
                <TouchableOpacity style={s.pinCloseBtn} onPress={() => setPendingPin(null)}>
                  <Ionicons name="close" size={16} color={OVR.text2} />
                </TouchableOpacity>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.pinTypeScroll}>
                {COMMUNITY_PIN_TYPES.map(t => {
                  const active = pinType === t.id;
                  return (
                    <TouchableOpacity
                      key={t.id}
                      style={[s.pinTypeChip, { borderColor: t.color + '55', backgroundColor: active ? t.color : t.color + '18' }]}
                      onPress={() => setPinType(t.id)}
                    >
                      <Ionicons name={t.icon as any} size={15} color={active ? '#fff' : t.color} />
                      <Text style={[s.pinTypeText, { color: active ? '#fff' : t.color }]}>{t.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              <TextInput
                value={pinName}
                onChangeText={setPinName}
                placeholder={`${communityPinMeta(pinType).label} name`}
                placeholderTextColor={OVR.text3}
                style={s.pinInput}
                maxLength={80}
              />
              <TextInput
                value={pinDescription}
                onChangeText={setPinDescription}
                placeholder="Details, access notes, hours, water type..."
                placeholderTextColor={OVR.text3}
                style={[s.pinInput, s.pinTextArea]}
                maxLength={500}
                multiline
              />
              <View style={s.wpSheetActions}>
                <TouchableOpacity style={s.wpSheetNavBtn} onPress={submitCommunityPin} disabled={pinSubmitting}>
                  {pinSubmitting ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="checkmark" size={14} color="#fff" />}
                  <Text style={s.wpSheetNavText}>ADD PIN</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.wpSheetDayBtn} onPress={() => setPendingPin(null)}>
                  <Text style={s.wpSheetDayText}>CANCEL</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      )}

      {/* ── Waypoint tap sheet ── */}
      {tappedWp && (
        <Modal visible transparent animationType="slide" onRequestClose={() => setTappedWp(null)}>
          <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setTappedWp(null)}>
            <View style={s.wpSheet}>
              <View style={s.daySheetHandle} />
              <View style={s.wpSheetHeader}>
                <View style={[s.wpSheetTypeDot, {
                  backgroundColor:
                    tappedWp.wp.type === 'camp' ? '#14b8a6' :
                    tappedWp.wp.type === 'fuel' ? '#eab308' :
                    tappedWp.wp.type === 'start' ? '#22c55e' :
                    tappedWp.wp.type === 'motel' ? '#6366f1' : '#f97316',
                }]} />
                <View style={{ flex: 1 }}>
                  <Text style={s.wpSheetName} numberOfLines={2}>{tappedWp.wp.name}</Text>
                  <Text style={s.wpSheetMeta}>
                    Day {tappedWp.wp.day} · {tappedWp.wp.type === 'camp' ? 'Camp' : tappedWp.wp.type === 'fuel' ? 'Fuel Stop' : tappedWp.wp.type === 'start' ? 'Start' : tappedWp.wp.type}
                  </Text>
                </View>
              </View>
              <View style={s.wpSheetActions}>
                <TouchableOpacity style={s.wpSheetNavBtn} onPress={() => startDayNav(tappedWp.wp.day, tappedWp.idx)}>
                  <Ionicons name="navigate" size={14} color="#fff" />
                  <Text style={s.wpSheetNavText}>NAVIGATE FROM HERE</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.wpSheetDayBtn} onPress={() => { setTappedWp(null); setShowDayModal(true); }}>
                  <Ionicons name="calendar-outline" size={14} color={OVR.text2} />
                  <Text style={s.wpSheetDayText}>CHANGE DAY</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </Modal>
      )}

      <PaywallModal
        visible={paywallVisible}
        code={paywallCode}
        message={paywallMessage}
        onClose={() => setPaywallVisible(false)}
      />
    </View>
  );
}

export default function MapScreenWithBoundary() {
  return <MapErrorBoundary><MapScreen /></MapErrorBoundary>;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const DARK_OVR = {
  bg:      'rgba(6,10,8,0.95)',
  bg2:     'rgba(8,14,10,0.98)',
  border:  '#1e2e20',
  border2: '#0d1a0e',
  text:    '#e4ddd2',
  text2:   '#8a9285',
  text3:   '#4a5a4c',
};

const LIGHT_OVR = {
  bg:      'rgba(250,247,242,0.96)',
  bg2:     'rgba(244,240,235,0.98)',
  border:  '#d1c7b8',
  border2: '#ebe4dc',
  text:    '#1a1208',
  text2:   '#5a4e3e',
  text3:   '#8a7a68',
};

function overlayPalette(C: ColorPalette) {
  return C.bg === '#060d07' ? DARK_OVR : LIGHT_OVR;
}

const makeStyles = (C: ColorPalette) => {
  const OVR = overlayPalette(C);
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  map: { flex: 1 },

  topBar: {
    position: 'absolute', top: 56, left: 16, right: 16,
    backgroundColor: OVR.bg, borderRadius: 20,
    paddingVertical: 8, paddingHorizontal: 14,
    borderWidth: 1, borderColor: OVR.border,
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  topBarDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.orange },
  topBarText: { color: OVR.text, fontSize: 10, fontFamily: mono, flex: 1, letterSpacing: 0.5 },
  alertPill: {
    backgroundColor: C.red + '22', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: C.red,
  },
  alertPillText: { color: C.red, fontSize: 10, fontFamily: mono, fontWeight: '700' },
  exitTripBtn: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: C.s3, borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center', marginLeft: 4,
  },

  controls: { position: 'absolute', top: 106, right: 16, bottom: 100, maxHeight: '80%' as any },
  controlsInner: { gap: 8, paddingBottom: 8, alignItems: 'flex-end' },
  ctrlBtn: {
    width: 44, height: 44, borderRadius: 14,
    backgroundColor: OVR.bg, borderWidth: 1, borderColor: OVR.border,
    alignItems: 'center', justifyContent: 'center',
  },
  layerText: { color: OVR.text2, fontSize: 9, fontFamily: mono, fontWeight: '800', letterSpacing: 0.5 },
  compassPill: {
    position: 'absolute', top: 106, left: 16,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: OVR.bg, borderRadius: 18,
    borderWidth: 1, borderColor: OVR.border,
    paddingHorizontal: 9, paddingVertical: 7,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.22, shadowRadius: 8,
    elevation: 7,
  },
  compassDir: { color: OVR.text, fontSize: 12, fontFamily: mono, fontWeight: '900', lineHeight: 14 },
  compassDeg: { color: OVR.text3, fontSize: 9, fontFamily: mono, fontWeight: '700', marginTop: 1 },

  alertPanel: {
    position: 'absolute', top: 106, left: 16, right: 70,
    backgroundColor: OVR.bg2, borderRadius: 14,
    borderWidth: 1, borderColor: C.red,
  },
  alertHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 9,
    borderBottomWidth: 1, borderColor: OVR.border,
  },
  alertTitle: { color: C.red, fontSize: 10, fontFamily: mono, fontWeight: '700', flex: 1 },
  alertItem: { paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderColor: OVR.border2 },
  alertBadge: { color: OVR.text, fontSize: 10, fontFamily: mono },
  alertSev: { fontSize: 9, fontFamily: mono, fontWeight: '700' },
  alertDesc: { color: OVR.text3, fontSize: 11 },

  // ── Nav HUD
  navHud: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: OVR.bg2,
    borderTopWidth: 1, borderColor: OVR.border,
  },

  turnStripWrap: { overflow: 'hidden' },
  turnStrip: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 12,
    backgroundColor: '#0d1b2e',
  },
  turnIconWrap: {
    width: 64, height: 64, alignItems: 'center', justifyContent: 'center',
  },
  turnInfo: { flex: 1, justifyContent: 'center' },
  turnDist: { color: '#fff', fontSize: 26, fontWeight: '900', fontFamily: mono, letterSpacing: -0.5, lineHeight: 30 },
  turnLabel: { color: '#f5a623', fontSize: 12, fontWeight: '700', fontFamily: mono, marginTop: 2, letterSpacing: 0.3 },
  turnRoad: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 1, fontFamily: mono },
  stepProgressBg: {
    height: 4, backgroundColor: 'rgba(249,115,22,0.15)',
    borderTopWidth: 1, borderColor: 'rgba(249,115,22,0.1)',
  },
  stepProgressFill: {
    height: 4, backgroundColor: '#f97316',
    borderTopRightRadius: 2, borderBottomRightRadius: 2,
  },
  laneRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#111a11', paddingHorizontal: 14, paddingVertical: 6,
    borderTopWidth: 1, borderColor: 'rgba(249,115,22,0.15)',
  },
  laneLabel: { color: OVR.text3, fontSize: 9, fontFamily: mono, marginRight: 4, letterSpacing: 1 },
  laneBox: {
    width: 26, height: 22, borderRadius: 5, borderWidth: 1, borderColor: OVR.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: OVR.border2,
  },
  laneBoxActive: { borderColor: '#f97316', backgroundColor: 'rgba(249,115,22,0.15)' },
  thenRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 5,
    backgroundColor: 'rgba(0,0,0,0.25)', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)',
  },
  thenText: { color: 'rgba(255,255,255,0.5)', fontSize: 11, fontFamily: mono, flex: 1, letterSpacing: 0.3 },

  offRouteWarnBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: '#451a03', borderBottomWidth: 1, borderColor: '#92400e',
  },
  offRouteWarnText: { color: '#fbbf24', fontSize: 11, fontFamily: mono, fontWeight: '800', flex: 1, letterSpacing: 0.5 },
  offRouteWarnBtn: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
    backgroundColor: '#92400e', borderWidth: 1, borderColor: '#fbbf24',
  },
  offRouteWarnBtnText: { color: '#fbbf24', fontSize: 10, fontFamily: mono, fontWeight: '700' },

  navStrip: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderColor: OVR.border,
  },
  navBearing: { alignItems: 'center', justifyContent: 'center', width: 46 },
  navBearingText: { color: C.orange, fontSize: 18, fontWeight: '900', fontFamily: mono },
  navDistBlock: { flex: 1, alignItems: 'center' },
  navDistVal: { color: OVR.text, fontSize: 28, fontWeight: '800', fontFamily: mono },
  navEta: { color: C.orange, fontSize: 11, fontFamily: mono, fontWeight: '700', marginTop: 2, letterSpacing: 0.3 },
  navRemaining: { color: OVR.text3, fontSize: 9, fontFamily: mono, marginTop: 2, opacity: 0.7 },
  navSpeedBlock: { alignItems: 'center', width: 50 },
  navSpeedVal: { color: OVR.text2, fontSize: 22, fontWeight: '700', fontFamily: mono },

  navTarget: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderColor: OVR.border,
  },
  navTargetBadge: {
    backgroundColor: C.orangeGlow, borderRadius: 6, borderWidth: 1, borderColor: C.orange,
    paddingHorizontal: 6, paddingVertical: 3,
  },
  navTargetBadgeText: { color: C.orange, fontSize: 8, fontFamily: mono, fontWeight: '700' },
  navTargetInfo: { flex: 1 },
  navTargetName: { color: OVR.text, fontSize: 14, fontWeight: '700', fontFamily: mono },
  navTargetMeta: { color: OVR.text3, fontSize: 10, fontFamily: mono, marginTop: 2 },

  navActions: {
    flexDirection: 'row', gap: 8,
    paddingHorizontal: 14, paddingVertical: 10, paddingBottom: 26,
  },
  navEndBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 11,
    borderWidth: 1, borderColor: C.red + '55', backgroundColor: C.red + '14',
  },
  navEndText: { color: C.red, fontSize: 11, fontFamily: mono, fontWeight: '700' },
  navStepsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 11,
    borderWidth: 1, borderColor: OVR.border, backgroundColor: OVR.border2,
  },
  navStepsBtnText: { color: OVR.text2, fontSize: 11, fontFamily: mono },
  navRerouteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 11,
    borderWidth: 1, borderColor: OVR.border, backgroundColor: OVR.border2,
  },
  navReportBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 11,
    borderWidth: 1.5, borderColor: '#f59e0b55', backgroundColor: '#f59e0b14',
    marginLeft: 'auto' as any,
  },
  navReportBtnActive: { backgroundColor: '#f59e0b', borderColor: '#f59e0b' },
  navReportBtnText: { color: '#f59e0b', fontSize: 11, fontFamily: mono, fontWeight: '800' },
  dlBar: {
    position: 'absolute', top: 92, left: 16, right: 16,
    height: 3, borderRadius: 1.5, backgroundColor: C.border, overflow: 'hidden',
  },
  dlFill: { height: 3, backgroundColor: C.orange, borderRadius: 1.5 },

  // ── Land check card
  landCheckCard: {
    position: 'absolute', top: 102, left: 16, right: 70,
    backgroundColor: OVR.bg2, borderRadius: 14,
    borderWidth: 1, borderColor: OVR.border,
    paddingHorizontal: 14, paddingVertical: 10,
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  landCheckBadge: {
    borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3,
    borderWidth: 1,
  },
  landCheckBadgeText: { fontSize: 9, fontFamily: mono, fontWeight: '800', letterSpacing: 0.5 },
  landCheckType: { color: OVR.text, fontSize: 11, fontFamily: mono, fontWeight: '700' },
  landCheckAdmin: { color: OVR.text2, fontSize: 10, fontFamily: mono, flex: 1 },
  landCheckTitle: { color: OVR.text, fontSize: 12, fontFamily: mono },
  landCheckNote: { color: OVR.text2, fontSize: 11, lineHeight: 16, marginBottom: 4 },
  landCheckSource: { color: OVR.text3, fontSize: 9, fontFamily: mono },

  // ── Search This Area (native)
  searchAreaWrap: {
    position: 'absolute', bottom: 120, left: 0, right: 0,
    alignItems: 'center', pointerEvents: 'box-none',
  },
  searchAreaBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: OVR.bg2, borderWidth: 1.5, borderColor: C.orange,
    paddingHorizontal: 18, paddingVertical: 10, borderRadius: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.55, shadowRadius: 10, elevation: 8,
  },
  searchAreaBtnLoading: { borderColor: OVR.border, opacity: 0.8 },
  searchAreaText: { color: C.orange, fontSize: 11, fontFamily: mono, fontWeight: '700', letterSpacing: 0.8 },

  stepsList: { maxHeight: 200, borderTopWidth: 1, borderColor: OVR.border },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 9, borderBottomWidth: 1, borderColor: OVR.border2 },
  stepRowFirst: { backgroundColor: OVR.border2 },
  stepRowActive: { backgroundColor: '#f97316' + '22', borderLeftWidth: 3, borderLeftColor: '#f97316' },
  stepInfo: { flex: 1 },
  stepLabel: { color: OVR.text2, fontSize: 11, fontFamily: mono, fontWeight: '700' },
  stepRoad: { color: OVR.text3, fontSize: 10, marginTop: 1, fontFamily: mono },
  stepDist: { color: OVR.text3, fontSize: 10, fontFamily: mono },

  // ── Search overlay
  searchSheet: {
    backgroundColor: OVR.bg2,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderTopWidth: 1, borderColor: OVR.border,
    paddingBottom: 28,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.35, shadowRadius: 12, elevation: 12,
  },
  searchHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: OVR.border, alignSelf: 'center', marginTop: 10, marginBottom: 4,
  },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderColor: OVR.border,
  },
  searchInput: {
    flex: 1, color: OVR.text, fontSize: 15, fontFamily: mono,
  },
  searchGoBtn: {
    backgroundColor: C.orange, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
  },
  searchGo: { color: '#fff', fontSize: 11, fontFamily: mono, fontWeight: '700' },
  searchResults: { maxHeight: 280 },
  searchResultItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 13,
    borderBottomWidth: 1, borderColor: OVR.border2,
  },
  searchResultIcon: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(249,115,22,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  searchResultText: { color: OVR.text, fontSize: 14, fontWeight: '500' },
  searchResultSub:  { color: OVR.text3, fontSize: 11, marginTop: 1 },
  searchResultDist: { color: C.text3, fontSize: 11, fontFamily: mono },

  // ── Bottom panel
  panel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: C.bg, borderTopWidth: 1, borderColor: C.border,
    paddingBottom: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.12, shadowRadius: 8, elevation: 8,
  },
  dayScroll: { paddingHorizontal: 14, paddingVertical: 12, gap: 10 },
  dayCard: {
    backgroundColor: C.s2, borderRadius: 12, borderWidth: 1, borderColor: C.border,
    padding: 12, width: 140,
  },
  dayBadge: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: C.orange, alignItems: 'center', justifyContent: 'center', marginBottom: 6,
  },
  dayBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700', fontFamily: mono },
  dayTitle: { color: C.text, fontSize: 12, fontWeight: '600', marginBottom: 2 },
  dayMeta: { color: C.text3, fontSize: 10, fontFamily: mono },
  restDayNotice: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    marginHorizontal: 12, marginBottom: 6, paddingVertical: 10,
    borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.s2,
  },
  restDayNoticeText: { color: C.text3, fontSize: 11, fontFamily: mono, fontWeight: '800', letterSpacing: 0.5 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingBottom: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { fontSize: 10 },
  legendText: { color: C.text3, fontSize: 10 },
  mapsBtn: {
    marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
    borderWidth: 1, borderColor: C.border,
  },
  mapsBtnText: { color: C.text3, fontSize: 9, fontFamily: mono },

  // ── Filter bar
  filterBar: {
    position: 'absolute', top: 92, left: 0, right: 0,
    backgroundColor: OVR.bg2, borderBottomWidth: 1, borderColor: OVR.border,
    paddingBottom: 4,
  },
  filterScroll: { paddingHorizontal: 14, paddingVertical: 8, gap: 7 },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
    backgroundColor: C.s2, borderWidth: 1, borderColor: C.border,
  },
  filterChipActive: { backgroundColor: '#14b8a6', borderColor: '#14b8a6' },
  filterChipText: { color: C.text2, fontSize: 11, fontFamily: mono, fontWeight: '600' },
  filterSectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 4,
  },
  filterSectionTitle: { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '900', letterSpacing: 1 },
  filterClearText: { color: '#14b8a6', fontSize: 9, fontFamily: mono, fontWeight: '900' },
  filterLoading: { alignItems: 'center', paddingBottom: 8 },

  // ── Campsite quick card (Dyrt-style: white card, photo left, bold info right)
  quickCard: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: C.s1,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    flexDirection: 'row',
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.18, shadowRadius: 16,
    elevation: 12,
  },
  quickCardImg: { width: 120 },
  quickCardPhoto: { width: 120, height: '100%' as any, borderTopLeftRadius: 20 },
  quickCardPhotoPlaceholder: {
    width: 120, minHeight: 150, alignItems: 'center', justifyContent: 'center',
    borderTopLeftRadius: 20, gap: 2,
  },
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
  quickCardCost: { color: C.green, fontSize: 11, fontFamily: mono, fontWeight: '700' },
  quickCardTripBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 8, borderRadius: 10,
    borderWidth: 1, borderColor: C.green + '66', backgroundColor: C.green + '14',
  },
  quickCardTripText: { color: C.green, fontSize: 10, fontFamily: mono, fontWeight: '800', letterSpacing: 0.5 },
  quickCardActions: { flexDirection: 'row', gap: 8, marginTop: 2 },
  quickCardNav: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
    backgroundColor: '#16a34a',
  },
  quickCardNavText: { color: '#fff', fontSize: 11, fontFamily: mono, fontWeight: '700' },
  quickCardFull: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 8, borderRadius: 10,
    borderWidth: 1.5, borderColor: C.orange,
  },
  quickCardFullText: { color: C.orange, fontSize: 11, fontFamily: mono, fontWeight: '700' },

  // ── Rig compat + weather
  rigCompatBadge: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 6, borderWidth: 1, alignSelf: 'flex-start',
  },
  rigCompatText: { fontSize: 9, fontFamily: mono, fontWeight: '800' },
  weatherStrip: { flexDirection: 'row', gap: 8 },
  weatherDay: { alignItems: 'center', flex: 1 },
  weatherIcon: { fontSize: 16 },
  weatherHiLo: { fontSize: 9, fontFamily: mono, fontWeight: '700', color: C.text2 },

  // ── Camp fullness UI
  fullnessBanner: {
    backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fca5a5',
    borderRadius: 8, padding: 8, gap: 6,
  },
  fullnessBannerTop: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  fullnessBannerText: { flex: 1, color: C.red, fontSize: 10, fontFamily: mono, fontWeight: '800' },
  fullnessAge: { color: C.red, fontSize: 9, fontFamily: mono },
  fullnessVoteRow: { flexDirection: 'row', gap: 6 },
  fullnessVoteBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 7, borderWidth: 1,
  },
  fullnessStillFull: { backgroundColor: C.s2, borderColor: C.red + '66' },
  fullnessStillFullText: { color: C.red, fontSize: 10, fontFamily: mono, fontWeight: '700' },
  fullnessOpen: { backgroundColor: C.s2, borderColor: C.green + '66' },
  fullnessOpenText: { color: C.green, fontSize: 10, fontFamily: mono, fontWeight: '700' },
  reportFullBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingVertical: 6, paddingHorizontal: 10, borderRadius: 7,
    borderWidth: 1, borderColor: C.gold + '88', backgroundColor: C.s2,
    alignSelf: 'flex-start',
  },
  reportFullText: { color: C.gold, fontSize: 10, fontFamily: mono, fontWeight: '700' },

  qTag: {
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.s2,
  },
  qTagText: { color: C.text2, fontSize: 9, fontFamily: mono, fontWeight: '700' },

  // ── Campsite detail modal
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
  detailLandBadge: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
    borderWidth: 1,
  },
  detailLandText: { fontSize: 10, fontFamily: mono, fontWeight: '800', letterSpacing: 0.5 },
  detailMeta: { flexDirection: 'row', gap: 16, marginBottom: 16, alignItems: 'center' },
  detailCost: { color: C.green, fontSize: 14, fontFamily: mono, fontWeight: '800' },
  detailSiteCount: { color: C.text2, fontSize: 13, fontFamily: mono },
  detailSection: { marginBottom: 20 },
  detailSectionTitle: {
    color: C.text2, fontSize: 10, fontFamily: mono, fontWeight: '800',
    letterSpacing: 1.5, marginBottom: 10,
    borderBottomWidth: 1, borderColor: C.border, paddingBottom: 6,
  },
  detailDesc: { color: C.text, fontSize: 14, lineHeight: 22 },
  amenityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  amenityItem: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10,
    backgroundColor: C.s1, borderWidth: 1, borderColor: C.border,
    flexDirection: 'row', alignItems: 'center', gap: 5,
  },
  amenityText: { color: C.text, fontSize: 12, fontWeight: '500' },
  siteTypeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  siteTypeText: { color: C.text, fontSize: 13 },
  detailActivities: { color: C.text2, fontSize: 12, lineHeight: 20 },
  detailActions: { gap: 10, marginTop: 8 },

  // ── Field Reports
  frHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  frCount: { color: C.text3, fontSize: 11, fontFamily: mono },
  frSentimentBar: { flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: C.s2, marginBottom: 6 },
  frBarSeg: { height: 6 },
  frSentimentLegend: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 },
  frLegendItem: { fontSize: 12, fontWeight: '600' },
  frLastVisited: { color: C.text3, fontSize: 11, marginLeft: 'auto' as any },
  frTagCloud: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 2 },
  frTagCloudItem: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: C.s2, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  frTagCloudText: { color: C.text2, fontSize: 11 },
  frTagCloudCount: { color: C.orange, fontSize: 10, fontWeight: '700' },
  frCard: { backgroundColor: C.s2, borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: C.border },
  frCardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  frCardSentiment: { fontSize: 18, lineHeight: 22 },
  frCardMeta: { color: C.text2, fontSize: 12 },
  frCardRig: { color: C.text3, fontSize: 11, fontFamily: mono, marginTop: 1 },
  frCardBadges: { flexDirection: 'row', gap: 8, marginBottom: 5 },
  frCardBadge: { color: C.text2, fontSize: 11 },
  frCardTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 5 },
  frInlineTag: { backgroundColor: C.s1, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  frInlineTagText: { color: C.text3, fontSize: 10 },
  frCardNote: { color: C.text2, fontSize: 12, lineHeight: 17, marginTop: 4 },
  frEmpty: { color: C.text3, fontSize: 12, fontStyle: 'italic', marginBottom: 10 },
  frAddBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10 },
  frAddBtnText: { color: C.orange, fontSize: 12, fontFamily: mono, fontWeight: '700' },
  frForm: { backgroundColor: C.s2, borderRadius: 12, padding: 14, gap: 4 },
  frFormLabel: { color: C.text, fontSize: 12, fontWeight: '700', fontFamily: mono, marginTop: 8, marginBottom: 4 },
  frOptional: { color: C.text3, fontWeight: '400' },
  frPillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  frSentimentBtn: { borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: C.border, backgroundColor: C.s1 },
  frSentimentBtnText: { color: C.text2, fontSize: 12, fontWeight: '600' },
  frPill: { borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: C.border, backgroundColor: C.s1 },
  frPillActive: { borderColor: C.orange, backgroundColor: C.orange + '22' },
  frPillText: { color: C.text2, fontSize: 11 },
  frPillTextActive: { color: C.orange, fontWeight: '600' },
  frTagPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginBottom: 4 },
  frTagPill: { borderRadius: 14, paddingHorizontal: 9, paddingVertical: 5, borderWidth: 1, borderColor: C.border, backgroundColor: C.s1 },
  frTagPillOn: { borderColor: C.green, backgroundColor: C.green + '22' },
  frTagPillText: { color: C.text2, fontSize: 11 },
  frTagPillTextOn: { color: C.green, fontWeight: '600' },
  frNoteInput: { backgroundColor: C.s1, borderRadius: 8, padding: 10, color: C.text, fontSize: 13, minHeight: 72, textAlignVertical: 'top', borderWidth: 1, borderColor: C.border, marginBottom: 2 },
  frCharCount: { color: C.text3, fontSize: 10, textAlign: 'right', marginBottom: 4 },
  frPhotoBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  frPhotoBtnText: { color: C.text3, fontSize: 12 },
  frFormActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  frCancelBtn: { flex: 1, paddingVertical: 11, borderRadius: 10, borderWidth: 1, borderColor: C.border, alignItems: 'center' },
  frCancelText: { color: C.text3, fontSize: 12 },
  frSubmitBtn: { flex: 2, paddingVertical: 11, borderRadius: 10, backgroundColor: C.orange, alignItems: 'center' },
  frSubmitText: { color: '#fff', fontSize: 11, fontFamily: mono, fontWeight: '800' },
  detailBookBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 15, borderRadius: 14, backgroundColor: '#16a34a',
    shadowColor: '#16a34a', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 8,
  },
  detailBookText: { color: '#fff', fontSize: 14, fontFamily: mono, fontWeight: '800' },
  detailDirBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 15, borderRadius: 14, backgroundColor: C.orange,
    shadowColor: C.orange, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 8,
  },
  detailDirText: { color: '#fff', fontSize: 14, fontFamily: mono, fontWeight: '800' },

  // ── Coordinates
  coordRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  coordText: { color: C.text2, fontSize: 13, fontFamily: mono, flex: 1 },
  coordDms: { color: C.text2, fontSize: 11, fontFamily: mono, marginTop: 4 },
  coordCopy: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: C.orange },
  coordCopyText: { color: C.orange, fontSize: 9, fontFamily: mono, fontWeight: '700' },

  // ── AI insight
  aiStars: { color: C.yellow, fontSize: 14 },
  insiderTip: { backgroundColor: C.orange + '14', borderRadius: 10, borderWidth: 1, borderColor: C.orange + '44', padding: 12, marginBottom: 8 },
  insiderLabel: { color: C.orange, fontSize: 9, fontFamily: mono, fontWeight: '800', marginBottom: 4 },
  insiderText: { color: C.text, fontSize: 13, lineHeight: 19 },
  aiMeta: { color: C.text2, fontSize: 12, marginBottom: 3 },
  hazardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 6, backgroundColor: C.yellow + '14', borderRadius: 8, padding: 8 },
  hazardText: { color: C.yellow, fontSize: 12, flex: 1, lineHeight: 17 },
  nearbyItem: { color: C.text2, fontSize: 12, marginBottom: 3 },

  // ── Wikipedia
  wikiItem: { paddingVertical: 10, borderBottomWidth: 1, borderColor: C.border },
  wikiItemHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  wikiTitle: { color: '#3b82f6', fontSize: 13, fontWeight: '600', flex: 1 },
  wikiDist: { color: C.text2, fontSize: 10, fontFamily: mono },
  wikiExtract: { color: C.text2, fontSize: 11, lineHeight: 16 },

  // ── AI action buttons in panel
  aiActionsRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingBottom: 8 },
  aiActionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    flex: 1, paddingVertical: 8, borderRadius: 10,
    borderWidth: 1, borderColor: C.orange + '55',
    backgroundColor: C.orange + '0f', justifyContent: 'center',
  },
  aiActionText: { color: C.orange, fontSize: 10, fontFamily: mono, fontWeight: '700' },

  // ── Route weather strip ──────────────────────────────────────────────────────
  weatherSection: { paddingHorizontal: 14, paddingBottom: 6 },
  weatherSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6 },
  weatherSectionLabel: { color: C.text3, fontSize: 8.5, fontFamily: mono, letterSpacing: 1 },
  weatherScroll: { gap: 6, paddingRight: 4 },
  weatherDayCard: {
    backgroundColor: C.s3, borderWidth: 1, borderColor: C.border,
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, alignItems: 'center', minWidth: 64,
  },
  weatherDayNum: { color: C.text3, fontSize: 8, fontFamily: mono, letterSpacing: 0.5, marginBottom: 3 },
  weatherDayIcon: { fontSize: 18, lineHeight: 22 },
  weatherTemps: { color: C.text, fontSize: 12, fontWeight: '700', marginTop: 2 },
  weatherTempLo: { color: C.text3, fontSize: 11, fontWeight: '400' },
  weatherWind: { color: C.text3, fontSize: 9, fontFamily: mono, marginTop: 1 },
  weatherNone: { color: C.text3, fontSize: 11, fontFamily: mono, fontStyle: 'italic', paddingVertical: 4 },

  // ── Route card (search result card)
  routeCard: {
    padding: 16, borderTopWidth: 1, borderColor: OVR.border,
  },
  routeCardRoute: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10,
  },
  routeCardDotLine: {
    width: 16, alignItems: 'center', gap: 3,
  },
  routeCardDot: {
    width: 10, height: 10, borderRadius: 5,
  },
  routeCardLine: {
    width: 2, height: 14, backgroundColor: OVR.border,
  },
  routeCardRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  routeCardLabel: {
    color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '700', width: 30,
  },
  routeCardRowText: { color: OVR.text, fontSize: 13, fontWeight: '500', flex: 1 },
  routeCardDist: { color: C.text3, fontSize: 10, fontFamily: mono, marginBottom: 12 },
  routeCardActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  routeCardNav: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 12, backgroundColor: C.orange,
  },
  routeCardNavText: { color: '#fff', fontSize: 13, fontFamily: mono, fontWeight: '700' },
  routeCardOpts: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12,
    borderWidth: 1, borderColor: OVR.border,
  },
  routeCardOptsText: { color: C.text2, fontSize: 12, fontFamily: mono },

  // ── Route options sheet
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  routeOptsSheet: {
    backgroundColor: C.s1, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 40, borderTopWidth: 1, borderColor: C.border,
  },
  routeOptsTitle: { color: C.text, fontSize: 12, fontFamily: mono, fontWeight: '800', letterSpacing: 1, marginBottom: 16, textAlign: 'center' },
  routeOptRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderColor: C.border },
  routeOptCheck: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: C.orange, alignItems: 'center', justifyContent: 'center' },
  routeOptLabel: { color: C.text, fontSize: 14, fontWeight: '600' },
  routeOptSub: { color: C.text3, fontSize: 11, marginTop: 1 },
  routeOptsApply: { marginTop: 16, paddingVertical: 14, borderRadius: 14, backgroundColor: '#3b82f6', alignItems: 'center' },
  routeOptsApplyText: { color: '#fff', fontSize: 13, fontFamily: mono, fontWeight: '800' },

  // ── Offline modal
  offlineSheet: {
    backgroundColor: C.s1, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 40, borderTopWidth: 1, borderColor: C.border, maxHeight: '85%',
  },
  offlineHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  offlineTitle: { color: C.text, fontSize: 13, fontFamily: mono, fontWeight: '800', letterSpacing: 1, flex: 1 },
  offlineClose: { padding: 4 },
  offlineIncludesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 },
  offlineIncludeChip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: C.s2, borderWidth: 1, borderColor: C.border },
  offlineIncludeText: { color: C.text3, fontSize: 10, fontFamily: mono },
  offlineSub: { color: C.text3, fontSize: 11, textAlign: 'center', marginBottom: 16, lineHeight: 16 },
  offlineSectionLabel: { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '700', letterSpacing: 1, marginBottom: 8 },
  offlineConusBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 2, borderColor: C.orange, backgroundColor: C.orange + '14', marginBottom: 4 },
  offlineConusIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.s2, alignItems: 'center', justifyContent: 'center' },
  offlineConusTitle: { color: C.text, fontSize: 12, fontFamily: mono, fontWeight: '900', letterSpacing: 0.5 },
  offlineConusMeta: { color: C.text3, fontSize: 10, fontFamily: mono, marginTop: 3, lineHeight: 14 },
  offlineTripBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: C.orange + '55', backgroundColor: C.s2, marginBottom: 6 },
  offlineTripName: { color: C.text, fontSize: 12, fontFamily: mono, fontWeight: '800' },
  offlineTripMeta: { color: C.text3, fontSize: 10, fontFamily: mono, marginTop: 2 },
  offlineStateRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 1, borderColor: C.border },
  stateEmoji: { fontSize: 20 },
  stateName: { color: C.text2, fontSize: 12, fontFamily: mono, fontWeight: '600' },
  offlineStateMeta: { color: C.text3, fontSize: 10, fontFamily: mono, marginTop: 1 },
  stateTierBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.s2, alignItems: 'center' },
  stateTierLabel: { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '700', letterSpacing: 0.5 },
  stateTierSize: { color: C.text3, fontSize: 9, fontFamily: mono, marginTop: 1 },
  offlineProgressCard: { backgroundColor: C.s2, borderRadius: 12, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: C.border },
  offlineProgressTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  offlineProgressLabel: { color: C.text3, fontSize: 9, fontFamily: mono, letterSpacing: 0.5 },
  offlineProgressMB: { color: C.orange, fontSize: 11, fontFamily: mono, fontWeight: '700' },
  offlineCancelBtn: { alignSelf: 'center', marginTop: 8, paddingHorizontal: 16, paddingVertical: 6 },
  offlineCancelText: { color: C.red, fontSize: 10, fontFamily: mono, fontWeight: '700' },
  offlineRouteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13, borderRadius: 14, backgroundColor: C.orange },
  offlineRouteBtnText: { color: '#fff', fontSize: 12, fontFamily: mono, fontWeight: '700' },
  offlineNoTrip: { color: C.text3, fontSize: 11, textAlign: 'center', marginTop: 6 },
  offlineCachedBar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 10, marginTop: 6, borderTopWidth: 1, borderColor: C.border },
  offlineCachedText: { color: C.text3, fontSize: 10, fontFamily: mono, flex: 1 },

  // ── Route brief
  readinessRow: {
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderRadius: 60,
    width: 100, height: 100, alignSelf: 'center', marginBottom: 16,
  },
  readinessScore: { color: C.text, fontSize: 32, fontWeight: '800', fontFamily: mono },
  readinessLabel: { color: C.text3, fontSize: 9, fontFamily: mono },
  briefSummary: { color: C.text2, fontSize: 14, lineHeight: 21, marginBottom: 20 },
  briefItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  briefItemText: { color: C.text2, fontSize: 13, flex: 1, lineHeight: 18 },
  briefStats: { flexDirection: 'row', gap: 16, justifyContent: 'center', marginTop: 8 },
  briefStat: { alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, backgroundColor: C.s2, borderRadius: 14, flex: 1 },
  briefStatVal: { color: C.text, fontSize: 28, fontWeight: '800', fontFamily: mono },
  briefStatLabel: { color: C.text3, fontSize: 10, fontFamily: mono },

  // ── Nav speed circle + limit badge
  navSpeedCircle: {
    width: 62, height: 62, borderRadius: 31,
    backgroundColor: OVR.bg, borderWidth: 2, borderColor: OVR.border,
    alignItems: 'center', justifyContent: 'center',
  },
  navSpeedBig: { color: OVR.text, fontSize: 26, fontWeight: '900', fontFamily: mono, lineHeight: 28 },
  navSpeedUnit: { color: OVR.text3, fontSize: 7, fontFamily: mono, letterSpacing: 0.5 },
  navSpeedSign: {
    width: 42, borderRadius: 3,
    borderWidth: 3, borderColor: '#111',
    backgroundColor: '#fff',
    alignItems: 'center', paddingVertical: 4, paddingHorizontal: 3,
  },
  navSpeedSignOver: { borderColor: '#ef4444', backgroundColor: '#fff0f0' },
  navSpeedSignHeader: { color: '#111', fontSize: 5.5, fontFamily: mono, fontWeight: '900', letterSpacing: 0.2, lineHeight: 8 },
  navSpeedSignNum: { color: '#111', fontSize: 22, fontWeight: '900', fontFamily: mono, lineHeight: 24 },

  // ── Waze-style quick report
  quickReportWrap: {
    position: 'absolute', bottom: 190, left: 12,
    alignItems: 'flex-start',
  },
  quickReportWrapNav: {
    bottom: 400,
  },
  quickToast: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: OVR.bg, borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 7,
    borderWidth: 1, borderColor: C.green,
    marginBottom: 8,
  },
  quickToastText: { color: C.green, fontSize: 11, fontFamily: mono, fontWeight: '700' },
  quickReportPanel: {
    backgroundColor: OVR.bg, borderRadius: 16,
    borderWidth: 1, borderColor: OVR.border,
    padding: 10, marginBottom: 8, gap: 8,
  },
  quickReportBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: 12, borderWidth: 1, minWidth: 150,
  },
  quickReportLabel: { fontSize: 13, fontFamily: mono, fontWeight: '800', letterSpacing: 0.5 },
  quickReportClose: {
    alignSelf: 'center', marginTop: 2,
    paddingVertical: 4, paddingHorizontal: 20,
    borderTopWidth: 1, borderColor: OVR.border, width: '100%',
    alignItems: 'center',
  },
  quickReportFab: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: OVR.bg, borderRadius: 24,
    paddingHorizontal: 16, paddingVertical: 10,
    borderWidth: 1.5, borderColor: '#f59e0b55',
    shadowColor: '#f59e0b', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 6,
  },
  quickReportFabActive: {
    backgroundColor: '#f59e0b', borderColor: '#f59e0b',
    shadowOpacity: 0.4,
  },
  quickReportFabNav: {
    backgroundColor: '#1a2a1c', borderColor: '#f59e0b55',
  },
  quickReportFabText: { color: '#f59e0b', fontSize: 11, fontFamily: mono, fontWeight: '800', letterSpacing: 0.5 },
  quickReportFabTextActive: { color: '#fff' },
  quickSubtypeHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingBottom: 6, marginBottom: 2,
    borderBottomWidth: 1, borderColor: OVR.border,
  },
  quickSubtypeTitle: { fontSize: 12, fontFamily: mono, fontWeight: '800', letterSpacing: 1 },
  quickSubtypeBtn: {
    paddingHorizontal: 14, paddingVertical: 11,
    borderRadius: 10, borderWidth: 1,
    backgroundColor: OVR.border2,
  },
  quickSubtypeText: { fontSize: 13, fontFamily: mono, fontWeight: '700' },
  packDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.orange, marginTop: 6 },

  // ── Approaching report alert ─────────────────────────────────────────────────
  approachAlert: {
    position: 'absolute', top: 100, left: 16, right: 16,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: OVR.bg, borderRadius: 16,
    borderWidth: 1.5, padding: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12,
    elevation: 12,
  },
  approachAlertIcon: {
    width: 46, height: 46, borderRadius: 23,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  approachAlertInfo: { flex: 1 },
  approachAlertLabel: { fontSize: 12, fontFamily: mono, fontWeight: '800', letterSpacing: 1 },
  approachAlertDist: { color: OVR.text2, fontSize: 11, fontFamily: mono, marginTop: 2 },
  approachAlertActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  approachAlertBtn: {
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 10, borderWidth: 1,
    paddingHorizontal: 8, paddingVertical: 6, minWidth: 44,
  },
  approachAlertBtnText: { fontSize: 9, fontFamily: mono, fontWeight: '800', textAlign: 'center', letterSpacing: 0.5 },
  approachAlertClose: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: OVR.border2,
  },

  // ── Day selector + waypoint tap modals ───────────────────────────────────────
  modalOverlay: {
    flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)',
  },
  daySheet: {
    backgroundColor: OVR.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22,
    padding: 20, paddingBottom: 36, borderWidth: 1, borderColor: OVR.border,
  },
  daySheetHandle: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: OVR.border2,
    alignSelf: 'center', marginBottom: 16,
  },
  daySheetTitle: {
    color: OVR.text, fontSize: 13, fontFamily: mono, fontWeight: '800', letterSpacing: 1, marginBottom: 4,
  },
  daySheetSub: { color: OVR.text3, fontSize: 12, marginBottom: 16 },
  campPickerHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  campPickerRefresh: {
    width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.orange + '55', backgroundColor: C.orange + '12',
  },
  campPickerLoading: { alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 28 },
  campPickerLoadingText: { color: OVR.text2, fontSize: 11, fontFamily: mono },
  campPickerError: { color: OVR.text2, fontSize: 12, lineHeight: 18, paddingVertical: 12 },
  campPickRow: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    paddingVertical: 12, borderBottomWidth: 1, borderColor: OVR.border,
  },
  campPickIcon: {
    width: 38, height: 38, borderRadius: 10, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  campPickName: { color: OVR.text, fontSize: 13, fontWeight: '800', lineHeight: 17 },
  campPickMeta: { color: C.orange, fontSize: 10, fontFamily: mono, marginTop: 3 },
  campPickTags: { color: OVR.text3, fontSize: 10, marginTop: 3 },
  campPickUse: {
    borderWidth: 1, borderColor: C.green + '66', backgroundColor: C.green + '16',
    borderRadius: 8, paddingHorizontal: 9, paddingVertical: 6,
  },
  campPickUseText: { color: C.green, fontSize: 9, fontFamily: mono, fontWeight: '800', letterSpacing: 0.5 },
  dayBtnAll: {
    backgroundColor: C.green, borderRadius: 12, padding: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 16,
  },
  dayBtnAllText: { color: '#fff', fontSize: 13, fontFamily: mono, fontWeight: '800', letterSpacing: 0.5 },
  dayDivider: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  dayDividerLine: { flex: 1, height: 1, backgroundColor: OVR.border },
  dayDividerText: { color: OVR.text3, fontSize: 9, fontFamily: mono, letterSpacing: 0.8 },
  dayBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, borderBottomWidth: 1, borderColor: OVR.border,
  },
  dayBtnDayBadge: {
    width: 38, height: 38, borderRadius: 10, backgroundColor: C.orange,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  dayBtnDayNum: { color: '#fff', fontSize: 16, fontWeight: '900', fontFamily: mono },
  dayBtnFrom: { color: OVR.text, fontSize: 13, fontWeight: '700' },
  dayBtnTo: { color: OVR.text2, fontSize: 11, marginTop: 1 },
  dayBtnMeta: { flexDirection: 'row', gap: 8, marginTop: 4 },
  dayBtnMetaTag: { color: OVR.text3, fontSize: 10, fontFamily: mono },

  wpSheet: {
    backgroundColor: OVR.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22,
    padding: 20, paddingBottom: 36, borderWidth: 1, borderColor: OVR.border,
  },
  wpSheetHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 18 },
  wpSheetTypeDot: { width: 12, height: 12, borderRadius: 6, marginTop: 4, flexShrink: 0 },
  wpSheetName: { color: OVR.text, fontSize: 16, fontWeight: '800' },
  wpSheetMeta: { color: OVR.text3, fontSize: 11, fontFamily: mono, marginTop: 2 },
  wpSheetActions: { flexDirection: 'row', gap: 10 },
  wpSheetNavBtn: {
    flex: 1, backgroundColor: C.orange, borderRadius: 12, padding: 13,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  wpSheetNavText: { color: '#fff', fontSize: 12, fontFamily: mono, fontWeight: '800' },
  wpSheetDayBtn: {
    flex: 1, borderWidth: 1, borderColor: OVR.border, borderRadius: 12, padding: 13,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  wpSheetDayText: { color: OVR.text2, fontSize: 12, fontFamily: mono, fontWeight: '700' },
  pinIconBadge: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#fff',
  },
  pinDescription: { color: OVR.text2, fontSize: 12, lineHeight: 17, marginTop: 8 },
  pinSheetHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  pinCloseBtn: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: OVR.border,
  },
  pinTypeScroll: { gap: 7, paddingVertical: 10 },
  pinTypeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderRadius: 18,
    paddingHorizontal: 11, paddingVertical: 7,
  },
  pinTypeText: { fontSize: 10, fontFamily: mono, fontWeight: '900' },
  pinInput: {
    color: OVR.text,
    backgroundColor: OVR.border2,
    borderWidth: 1,
    borderColor: OVR.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 13,
    marginBottom: 10,
  },
  pinTextArea: { minHeight: 74, textAlignVertical: 'top' },

  // Layer sheet
  layerSheet: { flex: 1, backgroundColor: C.bg },
  layerSheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingTop: 18, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  layerSheetTitle: { color: C.text, fontSize: 14, fontWeight: '900', fontFamily: mono, letterSpacing: 1 },
  layerSectionHead: {
    color: C.text3, fontSize: 10, fontWeight: '800', fontFamily: mono, letterSpacing: 1.5,
    paddingHorizontal: 16, paddingTop: 18, paddingBottom: 8,
  },
  layerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.border + '40',
  },
  layerRowIcon: {
    width: 34, height: 34, borderRadius: 10, backgroundColor: C.s2,
    alignItems: 'center', justifyContent: 'center',
  },
  layerRowLabel: { color: C.text, fontSize: 13, fontFamily: mono, fontWeight: '700' },
  layerRowSub:   { color: C.text3, fontSize: 10, fontFamily: mono, marginTop: 2 },
  layerDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.border },

  // Offline cache banner
  offlineCacheBanner: {
    position: 'absolute', top: 102, left: 16, right: 16,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(20,30,20,0.92)', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: 'rgba(163,230,53,0.3)',
    zIndex: 30,
  },
  offlineCacheBannerText: { color: '#a3e635', fontSize: 10, fontFamily: mono, fontWeight: '700', letterSpacing: 0.3, flex: 1 },

  syncToast: {
    position: 'absolute', bottom: 110, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(10,25,10,0.92)', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: 'rgba(34,197,94,0.45)',
  },
  syncToastText: { color: '#22c55e', fontSize: 11, fontFamily: mono, fontWeight: '700', letterSpacing: 0.3 },

  // ── "What's here?" narration card ────────────────────────────────────────────
  narrationCard: {
    position: 'absolute', bottom: 108, left: 12, right: 12,
    backgroundColor: OVR.bg, borderRadius: 16,
    borderWidth: 1.5, borderColor: C.orange + '55',
    paddingHorizontal: 14, paddingVertical: 12,
    shadowColor: C.orange, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.18, shadowRadius: 12,
    elevation: 10,
  },
  narrationHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8,
  },
  narrationIconWrap: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: C.orange + '18',
    alignItems: 'center', justifyContent: 'center',
  },
  narrationTitle: {
    flex: 1, color: C.orange, fontSize: 11, fontFamily: mono,
    fontWeight: '800', letterSpacing: 0.8,
  },
  narrationReplay: { padding: 4 },
  narrationClose:  { padding: 4 },
  narrationText: {
    color: OVR.text2, fontSize: 12, fontFamily: mono, lineHeight: 18,
  },

  // ── Location permission disclosure
  locDisclosureOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 24,
    zIndex: 999,
  },
  locDisclosureCard: {
    backgroundColor: OVR.bg2, borderRadius: 20,
    borderWidth: 1.5, borderColor: C.orange + '44',
    padding: 24,
    shadowColor: C.orange, shadowOpacity: 0.2, shadowRadius: 24, shadowOffset: { width: 0, height: 4 },
    elevation: 16,
    width: '100%',
  },
  locDisclosureIcon: { alignItems: 'center', marginBottom: 12 },
  locDisclosureTitle: {
    color: C.orange, fontSize: 16, fontFamily: mono, fontWeight: '900',
    letterSpacing: 2, textAlign: 'center', marginBottom: 12,
  },
  locDisclosureBody: {
    color: OVR.text2, fontSize: 13, fontFamily: mono, lineHeight: 19,
    marginBottom: 14, textAlign: 'center',
  },
  locDisclosureList: { gap: 10, marginBottom: 16 },
  locDisclosureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  locDisclosureItem: { color: OVR.text2, fontSize: 12, fontFamily: mono, flex: 1, lineHeight: 17 },
  locDisclosureNote: {
    color: OVR.text3, fontSize: 10, fontFamily: mono, lineHeight: 15,
    textAlign: 'center', marginBottom: 20,
    borderTopWidth: 1, borderColor: OVR.border, paddingTop: 12,
  },
  locDisclosureAllow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.orange, borderRadius: 14,
    paddingVertical: 14, marginBottom: 10,
  },
  locDisclosureAllowText: {
    color: '#fff', fontSize: 13, fontFamily: mono, fontWeight: '900', letterSpacing: 1,
  },
  locDisclosureDeny: { alignItems: 'center', paddingVertical: 8 },
  locDisclosureDenyText: { color: OVR.text3, fontSize: 12, fontFamily: mono },

  // ── Offline cached regions list
  offlineCachedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 6, paddingHorizontal: 4,
    borderBottomWidth: 1, borderColor: OVR.border2,
  },
  offlineCachedRegionText: {
    flex: 1, color: OVR.text2, fontSize: 11, fontFamily: mono,
  },
  offlineCachedLoad: {
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6,
    backgroundColor: C.orange + '22', borderWidth: 1, borderColor: C.orange + '55',
    marginRight: 4,
  },
  offlineCachedLoadText: {
    color: C.orange, fontSize: 9, fontFamily: mono, fontWeight: '800', letterSpacing: 0.5,
  },
  offlineCachedDelete: {
    padding: 4,
  },

  // ── Offline map load failure banner
  mapLoadFailBanner: {
    position: 'absolute', top: 56, left: 16, right: 16,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(69,26,3,0.95)', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 9,
    borderWidth: 1, borderColor: '#92400e',
  },
  mapLoadFailText: {
    flex: 1, color: '#fbbf24', fontSize: 10, fontFamily: mono, fontWeight: '700', letterSpacing: 0.3,
  },
  });
};
