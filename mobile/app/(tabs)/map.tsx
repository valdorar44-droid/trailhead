import { useEffect, useRef, useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Linking, Animated, TextInput, ActivityIndicator, Modal, Image, Share, Alert } from 'react-native';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '@/lib/store';
import { api, Report, Pin, CampsitePin, CampsiteDetail, OsmPoi, WikiArticle, CampsiteInsight, RouteBrief, PackingList } from '@/lib/api';
import { useTheme, mono, ColorPalette } from '@/lib/design';

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

// Returns [far_m, near_m] announcement distances based on current speed
function announceDists(speedMph: number | null): [number, number] {
  if (!speedMph || speedMph < 10) return [250, 60];
  if (speedMph < 25) return [400, 100];
  if (speedMph < 40) return [600, 180];
  if (speedMph < 60) return [1000, 300];
  return [1800, 600]; // highway: ~1 mile then ~0.4 mile
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
  if (type === 'arrive') return 'arrive at your destination';
  if (type === 'depart') return 'proceed toward the route';
  if (type === 'roundabout') return 'take the roundabout';
  const m = modifier.toLowerCase();
  const isExit = name ? /exit|ramp|off.?ramp/i.test(name) : false;
  if (m === 'uturn')        return 'make a U-turn when safe';
  if (m === 'sharp left')   return 'turn sharply left';
  if (m === 'sharp right')  return 'turn sharply right';
  if (m === 'slight left')  return isExit ? 'take the exit on your left'  : 'keep left';
  if (m === 'slight right') return isExit ? 'take the exit on your right' : 'keep right';
  if (m === 'left')         return 'turn left';
  if (m === 'right')        return 'turn right';
  return 'continue straight';
}

// Build spoken announcement from step — natural, not robotic
function buildAnnouncement(step: RouteStep, distM: number, phase: 'far' | 'near'): string {
  const type     = step.type     ?? 'turn';
  const modifier = step.modifier ?? 'straight';
  const action   = stepSpeak(type, modifier, step.name);
  const road     = step.name ? ` on ${step.name}` : '';
  if (type === 'arrive') {
    return phase === 'far'
      ? `You'll arrive at your destination in ${speakDist(distM)}.`
      : `You have arrived at your destination.`;
  }
  if (phase === 'near') {
    if (distM < 30) return `${action}${road}.`;
    return `${action}${road}, in ${speakDist(distM)}.`;
  }
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
// 3 tile sources per coord (streets vector + terrain vector + satellite raster)
function tilesMB(count: number, maxZ: number): string {
  const avgKBPerCoord = maxZ >= 15 ? 55 : maxZ >= 13 ? 80 : maxZ >= 11 ? 110 : 150;
  const mb = (count * avgKBPerCoord) / 1024;
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

// ─── Map HTML ─────────────────────────────────────────────────────────────────

const MAPBOX_STYLES: Record<string, string> = {
  satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
  topo:      'mapbox://styles/mapbox/outdoors-v12',
  hybrid:    'mapbox://styles/mapbox/satellite-streets-v12',
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
<script src='https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.js'></script>
<link href='https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.css' rel='stylesheet'/>
<style>
  body,html{margin:0;padding:0;height:100%;background:#080c12;overflow:hidden;}
  #map{height:100vh;width:100vw;}
  .mapboxgl-popup-content{background:#0f1319!important;border:1px solid #252d3d!important;color:#f1f5f9!important;border-radius:10px!important;padding:12px 14px!important;box-shadow:0 4px 20px rgba(0,0,0,0.7)!important;min-width:160px;}
  .mapboxgl-popup-tip{border-top-color:#252d3d!important;border-bottom-color:#252d3d!important;}
  .mapboxgl-popup-close-button{color:#6b7280!important;font-size:16px!important;right:4px!important;top:2px!important;}
  .mapboxgl-ctrl-logo,.mapboxgl-ctrl-attrib{display:none!important;}
  .mk-wp{background:#f97316;border:2.5px solid #fff;border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:12px;font-family:monospace;box-shadow:0 2px 10px rgba(249,115,22,0.6);cursor:pointer;user-select:none;}
  .mk-wp.nav-target{background:#fff;color:#f97316;animation:pulse 1.4s ease-in-out infinite;}
  .mk-wp.wp-start{background:#22c55e;box-shadow:0 2px 10px rgba(34,197,94,0.6);}
  .mk-wp.wp-motel{background:#6366f1;box-shadow:0 2px 10px rgba(99,102,241,0.6);}
  .mk-wp.wp-town{background:#94a3b8;box-shadow:0 2px 10px rgba(148,163,184,0.4);}
  .mk-wp.wp-fuel{background:#eab308;box-shadow:0 2px 10px rgba(234,179,8,0.6);}
  .mk-wp.wp-waypoint{background:#a855f7;box-shadow:0 2px 10px rgba(168,85,247,0.6);}
  .mk-wp.wp-shower{background:#38bdf8;box-shadow:0 2px 10px rgba(56,189,248,0.5);}
  .mk-wp.nav-target.wp-motel{color:#6366f1;}
  .mk-wp.nav-target.wp-fuel{color:#eab308;}
  .mk-wp.nav-target.wp-start{color:#22c55e;}
  .mk-wp.nav-target.wp-waypoint{color:#a855f7;}
  @keyframes pulse{0%,100%{box-shadow:0 0 0 4px rgba(249,115,22,0.45);}50%{box-shadow:0 0 0 12px rgba(249,115,22,0.1);}}
  .mk-me{width:44px;height:44px;display:flex;align-items:center;justify-content:center;position:relative;pointer-events:none;}
  .mk-me-ring{position:absolute;width:44px;height:44px;border-radius:50%;background:rgba(249,115,22,0.1);border:1.5px solid rgba(249,115,22,0.4);animation:loc-pulse 2s ease-in-out infinite;}
  .mk-me-arrow{filter:drop-shadow(0 2px 5px rgba(0,0,0,0.6)) drop-shadow(0 0 8px rgba(249,115,22,0.6));}
  @keyframes loc-pulse{0%,100%{transform:scale(1);opacity:0.9;}50%{transform:scale(1.7);opacity:0.15;}}
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

  var map,mapboxToken='',currentStyle='mapbox://styles/mapbox/satellite-streets-v12';
  var userMarker=null,wpMarkers=[],searchMarker=null;
  var allCamps=[],allGas=[],allPois=[],allReports=[];
  var reportMarkers=[];
  var lastSpeed=null;
  var _routeLoading=false;
  var routeIsProper=false;
  var showLandOverlay=false;
  var routeOpts={avoidTolls:false,avoidHighways:false,backRoads:false,noFerries:false};
  var _routeCoords=[],routePts=[],breadcrumbPts=[];
  var lastOffCheck=0,downloadActive=false,mapReady=false,pendingMsgs=[];
  function postRN(o){try{window.ReactNativeWebView.postMessage(JSON.stringify(o));}catch(e){}}

  // ── Offline tile cache via Cache API + fetch intercept ────────────────────────
  // Auto-caches every Mapbox tile request so the map works offline.
  // This intercepts the actual tiles Mapbox GL JS fetches (vector PBF + satellite
  // raster), not the style raster tiles — so offline rendering actually works.
  var TILE_CACHE='trailhead-tiles-v3';
  var _origFetch=window.fetch.bind(window);
  window.fetch=async function(input,init){
    var url=typeof input==='string'?input:(input&&input.url?input.url:'');
    var isTile=url&&(url.indexOf('api.mapbox.com/v4/')>=0||url.indexOf('api.mapbox.com/styles/')>=0||url.indexOf('api.mapbox.com/fonts/')>=0||url.indexOf('api.mapbox.com/sprites/')>=0);
    if(isTile){
      try{
        var cacheKey=url.replace(/access_token=[^&]*/,'access_token=_');
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

  function _ll2t(lat,lng,z){var x=Math.floor((lng+180)/360*Math.pow(2,z));var s=Math.sin(lat*Math.PI/180);var y=Math.floor((0.5-Math.log((1+s)/(1-s))/(4*Math.PI))*Math.pow(2,z));return{x:Math.max(0,x),y:Math.max(0,y)};}

  // The real tiles Mapbox GL JS requests — vector streets, terrain, satellite
  function _tileUrls(z,x,y){
    var t=mapboxToken;
    return [
      'https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/'+z+'/'+x+'/'+y+'.vector.pbf?access_token='+t,
      'https://api.mapbox.com/v4/mapbox.mapbox-terrain-v2/'+z+'/'+x+'/'+y+'.vector.pbf?access_token='+t,
      'https://api.mapbox.com/v4/mapbox.satellite/'+z+'/'+x+'/'+y+'.jpg90?access_token='+t,
    ];
  }

  // Average KB per tile-set (streets+terrain vector + satellite) by zoom
  function _avgKbPerCoord(z){return z>=15?55:z>=13?80:z>=11?110:150;}

  async function _dlTiles(n,s,e,w,minZ,maxZ){
    var coords=[];
    for(var z=minZ;z<=maxZ;z++){
      var nw=_ll2t(n,w,z),se=_ll2t(s,e,z),cap=Math.pow(2,z)-1;
      for(var x=Math.max(0,nw.x);x<=Math.min(cap,se.x);x++){
        for(var y=Math.max(0,nw.y);y<=Math.min(cap,se.y);y++){
          coords.push({z:z,x:x,y:y});
        }
      }
    }
    var total=coords.length,saved=0,bytes=0,BATCH=30;
    postRN({type:'download_progress',percent:0,saved:0,total:total,mb:'0'});
    for(var i=0;i<coords.length;i+=BATCH){
      if(!downloadActive)break;
      var batch=coords.slice(i,i+BATCH);
      await Promise.allSettled(batch.map(async function(t){
        var urls=_tileUrls(t.z,t.x,t.y);
        for(var ui=0;ui<urls.length;ui++){
          try{await fetch(urls[ui]);}catch(e){}
        }
        saved++;bytes+=_avgKbPerCoord(t.z)*1024;
        postRN({type:'download_progress',percent:Math.round(saved/total*100),saved:saved,total:total,mb:(bytes/1048576).toFixed(1)});
      }));
    }
    postRN({type:'download_complete',saved:saved,total:total});
  }

  // ── Map init ──────────────────────────────────────────────────────────────────
  function initMap(token,style){
    mapboxToken=token;mapboxgl.accessToken=token;
    currentStyle=style||'mapbox://styles/mapbox/satellite-streets-v12';
    map=new mapboxgl.Map({container:'map',style:currentStyle,
      center:[${centerLng},${centerLat}],zoom:${waypoints.length > 1 ? 7 : 10},
      attributionControl:false,pitchWithRotate:false});
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
    });
    var boundsTimer;
    map.on('moveend',function(){
      clearTimeout(boundsTimer);
      boundsTimer=setTimeout(function(){var b=map.getBounds();postRN({type:'map_bounds',n:b.getNorth(),s:b.getSouth(),e:b.getEast(),w:b.getWest(),zoom:map.getZoom()});},400);
    });
    map.on('click',function(e){if(!e.defaultPrevented)postRN({type:'map_tapped'});});
  }

  // ── GeoJSON helpers ───────────────────────────────────────────────────────────
  function campFeat(c){return{type:'Feature',geometry:{type:'Point',coordinates:[c.lng,c.lat]},properties:{id:c.id||'',name:c.name||'',land_type:c.land_type||'Campground',cost:c.cost||'',ada:c.ada?1:0,reservable:c.reservable?1:0,raw:JSON.stringify(c)}};}

  function setupSources(){
    if(!map.getSource('camps'))map.addSource('camps',{type:'geojson',data:{type:'FeatureCollection',features:[]},cluster:true,clusterMaxZoom:11,clusterRadius:45});
    if(!map.getSource('gas'))map.addSource('gas',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    if(!map.getSource('pois'))map.addSource('pois',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    if(!map.getSource('route'))map.addSource('route',{type:'geojson',data:{type:'Feature',geometry:{type:'LineString',coordinates:[]}}});
    if(!map.getSource('breadcrumb'))map.addSource('breadcrumb',{type:'geojson',data:{type:'Feature',geometry:{type:'LineString',coordinates:[]}}});
  }

  function setupLayers(){
    var _a=function(id,def){if(!map.getLayer(id))map.addLayer(def);};
    _a('breadcrumb',{id:'breadcrumb',type:'line',source:'breadcrumb',paint:{'line-color':'#3b82f6','line-width':2.5,'line-opacity':0.8,'line-dasharray':[2,4]}});
    _a('route-shadow',{id:'route-shadow',type:'line',source:'route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'rgba(0,0,0,0.35)','line-width':9,'line-blur':5,'line-translate':[0,2]}});
    _a('route-line',{id:'route-line',type:'line',source:'route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#f97316','line-width':5,'line-opacity':0.94}});
    _a('gas-circle',{id:'gas-circle',type:'circle',source:'gas',paint:{'circle-radius':9,'circle-color':'#eab308','circle-opacity':0.92,'circle-stroke-width':2,'circle-stroke-color':'#fff'}});
    _a('gas-label',{id:'gas-label',type:'symbol',source:'gas',filter:['>=',['zoom'],13],layout:{'text-field':['get','name'],'text-size':9,'text-offset':[0,1.5],'text-anchor':'top'},paint:{'text-color':'#f1f5f9','text-halo-color':'rgba(0,0,0,0.85)','text-halo-width':1.5}});
    _a('poi-circle',{id:'poi-circle',type:'circle',source:'pois',paint:{'circle-radius':['case',['==',['get','type'],'peak'],9,8],'circle-color':['match',['get','type'],'water','#3b82f6','trailhead','#22c55e','viewpoint','#a855f7','peak','#92400e','#6b7280'],'circle-opacity':0.9,'circle-stroke-width':1.5,'circle-stroke-color':'#fff'}});
    _a('poi-label',{id:'poi-label',type:'symbol',source:'pois',filter:['>=',['zoom'],12],layout:{'text-field':['case',['all',['==',['get','type'],'peak'],['has','elevation']],['concat',['get','name'],'\\n▲ ',['get','elevation']],['get','name']],'text-size':['case',['==',['get','type'],'peak'],10,9],'text-offset':[0,1.3],'text-anchor':'top','text-max-width':10},paint:{'text-color':['case',['==',['get','type'],'peak'],'#d97706','#f1f5f9'],'text-halo-color':['case',['==',['get','type'],'peak'],'rgba(255,255,255,0.95)','rgba(0,0,0,0.85)'],'text-halo-width':2}});
    _a('camp-cluster',{id:'camp-cluster',type:'circle',source:'camps',filter:['has','point_count'],paint:{'circle-color':['step',['get','point_count'],'#14b8a6',10,'#f97316',50,'#ef4444'],'circle-radius':['step',['get','point_count'],18,10,25,50,32],'circle-opacity':0.88,'circle-stroke-width':2,'circle-stroke-color':'#fff'}});
    _a('camp-count',{id:'camp-count',type:'symbol',source:'camps',filter:['has','point_count'],layout:{'text-field':'{point_count_abbreviated}','text-size':12,'text-font':['DIN Offc Pro Medium','Arial Unicode MS Bold']},paint:{'text-color':'#fff'}});
    _a('camp-circle',{id:'camp-circle',type:'circle',source:'camps',filter:['!',['has','point_count']],paint:{'circle-radius':['interpolate',['linear'],['zoom'],9,7,13,11],'circle-color':['match',['get','land_type'],'BLM Land','#f97316','National Forest','#22c55e','National Park','#3b82f6','State Park','#8b5cf6','Campground','#14b8a6','#14b8a6'],'circle-opacity':0.88,'circle-stroke-width':2,'circle-stroke-color':'rgba(255,255,255,0.9)'}});
    _a('camp-label',{id:'camp-label',type:'symbol',source:'camps',filter:['all',['!',['has','point_count']],['>=',['zoom'],12]],layout:{'text-field':['get','name'],'text-size':10,'text-offset':[0,1.3],'text-anchor':'top','text-max-width':10},paint:{'text-color':'#f1f5f9','text-halo-color':'rgba(0,0,0,0.85)','text-halo-width':1.5}});
    // clicks
    map.on('click','camp-cluster',function(e){var f=map.queryRenderedFeatures(e.point,{layers:['camp-cluster']});if(!f.length)return;map.getSource('camps').getClusterExpansionZoom(f[0].properties.cluster_id,function(err,zoom){if(err)return;map.easeTo({center:f[0].geometry.coordinates,zoom:zoom+0.5});});e.preventDefault();});
    map.on('click','camp-circle',function(e){if(!e.features||!e.features[0])return;var p=e.features[0].properties;var raw;try{raw=JSON.parse(p.raw||'{}');}catch(x){raw=p;}postRN({type:'campsite_tapped',id:raw.id||p.id,name:raw.name||p.name,camp:raw});e.preventDefault();});
    map.on('click','gas-circle',function(e){if(!e.features||!e.features[0])return;var p=e.features[0].properties;new mapboxgl.Popup({closeButton:false,offset:12}).setLngLat(e.lngLat).setHTML('<div class="pt">⛽ '+p.name+'</div><div class="pm">Fuel Station</div>').addTo(map);e.preventDefault();});
    map.on('click','poi-circle',function(e){if(!e.features||!e.features[0])return;var p=e.features[0].properties;var ic=p.type==='water'?'💧':p.type==='trailhead'?'🥾':'👁️';new mapboxgl.Popup({closeButton:false,offset:12}).setLngLat(e.lngLat).setHTML('<div class="pt">'+ic+' '+p.name+'</div><div class="pm">'+p.type+'</div>').addTo(map);e.preventDefault();});
    ['camp-cluster','camp-circle','gas-circle','poi-circle'].forEach(function(l){map.on('mouseenter',l,function(){map.getCanvas().style.cursor='pointer';});map.on('mouseleave',l,function(){map.getCanvas().style.cursor='';});});
  }

  function renderWaypoints(){
    wpMarkers.forEach(function(m){m.remove();});wpMarkers=[];
    wps.forEach(function(w,i){
      var el=document.createElement('div');
      var typeClass=w.type==='start'?'wp-start':w.type==='motel'?'wp-motel':w.type==='fuel'?'wp-fuel':w.type==='waypoint'?'wp-waypoint':w.type==='town'?'wp-town':w.type==='shower'?'wp-shower':'';
      el.className='mk-wp'+(typeClass?' '+typeClass:'');
      el.textContent=w.type==='fuel'?'⛽':w.type==='motel'?'M':w.type==='start'?'S':(w.day||i+1);
      var popup=new mapboxgl.Popup({offset:18,closeButton:false}).setHTML('<div class="pt">'+w.name+'</div><div class="pm">Day '+w.day+' · '+w.type+'</div>');
      var m=new mapboxgl.Marker({element:el}).setLngLat([w.lng,w.lat]).setPopup(popup).addTo(map);
      el.addEventListener('click',function(ev){ev.stopPropagation();postRN({type:'wp_tapped',idx:i,name:w.name});});
      wpMarkers.push(m);
    });
    if(wps.length>=2){var bounds=new mapboxgl.LngLatBounds();wps.forEach(function(w){bounds.extend([w.lng,w.lat]);});map.fitBounds(bounds,{padding:60,maxZoom:12,duration:800});}
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
  var REP_ICONS={police:'🚔',hazard:'⚠️',road_condition:'🛑',wildlife:'🐾',campsite:'⛺',road_closure:'🚧',water:'💧'};
  function updateReportMarkers(){
    reportMarkers.forEach(function(m){m.remove();});reportMarkers=[];
    allReports.forEach(function(r){
      var el=document.createElement('div');
      el.className='mk-rep mk-rep-'+(r.type||'hazard');
      el.textContent=REP_ICONS[r.type]||'⚠️';
      el.title=(r.subtype||r.type)+(r.confirmations?' ✓'+r.confirmations:'');
      var popup=new mapboxgl.Popup({offset:18,closeButton:false}).setHTML('<div class="pt">'+(r.subtype||r.type)+'</div><div class="pm">'+(r.description||'Community report')+'</div>');
      var m=new mapboxgl.Marker({element:el,anchor:'center'}).setLngLat([r.lng,r.lat]).setPopup(popup).addTo(map);
      el.addEventListener('click',function(ev){ev.stopPropagation();m.togglePopup();postRN({type:'report_tapped',report:r});});
      reportMarkers.push(m);
    });
  }

  // ── Land ownership overlay (BLM/USFS/NPS public tile service) ─────────────────
  function setLandOverlay(show){
    showLandOverlay=show;
    if(!map||!mapReady)return;
    if(show){
      if(!map.getSource('blm-sma'))map.addSource('blm-sma',{type:'raster',tiles:['https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_LimitedScale/MapServer/tile/{z}/{y}/{x}'],tileSize:256,attribution:'BLM/USGS'});
      if(!map.getLayer('blm-sma'))map.addLayer({id:'blm-sma',type:'raster',source:'blm-sma',paint:{'raster-opacity':0.48}},'route-shadow');
    }else{
      if(map.getLayer('blm-sma'))map.removeLayer('blm-sma');
      if(map.getSource('blm-sma'))map.removeSource('blm-sma');
    }
  }

  // ── User position ──────────────────────────────────────────────────────────────
  var navActive=false;
  function setUserPos(lat,lng,recenter,zoom,heading){
    if(!userMarker){
      var el=document.createElement('div');el.className='mk-me';
      el.innerHTML='<div class="mk-me-ring"></div><svg class="mk-me-arrow" width="20" height="26" viewBox="0 0 20 26"><path d="M10 1 L19 24 L10 18 L1 24 Z" fill="#f97316" stroke="white" stroke-width="1.5" stroke-linejoin="round"/></svg>';
      userMarker=new mapboxgl.Marker({element:el,anchor:'center'}).setLngLat([lng,lat]).addTo(map);
    }else{userMarker.setLngLat([lng,lat]);}
    if(navActive&&heading!=null&&heading>=0){
      map.easeTo({center:[lng,lat],bearing:heading,pitch:52,zoom:zoom||17,duration:900});
    }else if(recenter){
      map.easeTo({center:[lng,lat],zoom:zoom||15,duration:500});
    }
    var now=Date.now();
    // Only check off-route when: route exists + is a real routed path + not mid-load + moving
    if(routePts.length>0&&routeIsProper&&!_routeLoading&&now-lastOffCheck>8000&&(lastSpeed==null||lastSpeed>1.5)){
      lastOffCheck=now;var minD=Infinity;
      for(var i=0;i<routePts.length;i++){var dlat=(routePts[i][1]-lat)*111000;var dlng=(routePts[i][0]-lng)*111000*Math.cos(lat*Math.PI/180);var d=Math.sqrt(dlat*dlat+dlng*dlng);if(d<minD)minD=d;if(minD<60)break;}
      if(minD>200)postRN({type:'off_route',lat:lat,lng:lng,dist:Math.round(minD)});
    }
  }

  function setNavTarget(idx){wpMarkers.forEach(function(m,i){m.getElement().classList.toggle('nav-target',i===idx);});}

  // ── Routing ───────────────────────────────────────────────────────────────────
  function decodeP6(enc){var coords=[],i=0,lat=0,lng=0;while(i<enc.length){var b,shift=0,res=0;do{b=enc.charCodeAt(i++)-63;res|=(b&0x1f)<<shift;shift+=5;}while(b>=0x20);lat+=res&1?~(res>>1):(res>>1);shift=0;res=0;do{b=enc.charCodeAt(i++)-63;res|=(b&0x1f)<<shift;shift+=5;}while(b>=0x20);lng+=res&1?~(res>>1):(res>>1);coords.push([lng/1e6,lat/1e6]);}return coords;}

  function _fallback(pairs,fromIdx){routeIsProper=false;_routeLoading=false;if(!pairs.length){postRN({type:'route_ready',routed:false,steps:[],legs:[],fromIdx:fromIdx||0});return;}var coords=pairs.map(function(p){var s=p.split(',');return[parseFloat(s[0]),parseFloat(s[1])];});_routeCoords=coords;routePts=coords;updateRoute();postRN({type:'route_ready',routed:false,steps:[],legs:[],fromIdx:fromIdx||0});}

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
      var legSpeedLimits=[];
      (route.legs||[]).forEach(function(leg){
        var ls=[];
        (leg.steps||[]).forEach(function(s){if(s.distance>0||s.maneuver.type==='arrive'){
          var loc=s.maneuver&&s.maneuver.location;
          // Extract lane data from last intersection that has lanes
          var lanes=[];
          if(s.intersections){for(var ii=s.intersections.length-1;ii>=0;ii--){var isc=s.intersections[ii];if(isc.lanes&&isc.lanes.length){lanes=isc.lanes.map(function(l){return{indications:l.indications||[],valid:l.valid===true,active:l.active===true};});break;}}}
          var st={type:s.maneuver.type,modifier:s.maneuver.modifier||'',name:s.name||'',distance:s.distance,duration:s.duration,lat:loc?loc[1]:undefined,lng:loc?loc[0]:undefined,lanes:lanes.length?lanes:undefined};
          steps.push(st);ls.push(st);}});
        legs.push(ls);
        var ann=(leg.annotation&&leg.annotation.maxspeed)||[];
        var valid=ann.filter(function(s){return s&&typeof s.speed==='number';}).map(function(s){return s.speed;});
        var freq={};valid.forEach(function(v){freq[v]=(freq[v]||0)+1;});
        var keys=Object.keys(freq).sort(function(a,b){return freq[b]-freq[a];});
        legSpeedLimits.push(keys.length?parseFloat(keys[0]):null);
      });
      routeIsProper=true;_routeLoading=false;
      postRN({type:'route_ready',routed:true,steps:steps,legs:legs,legSpeedLimits:legSpeedLimits,total_distance:route.distance,total_duration:route.duration,fromIdx:fromIdx||0});
    }catch(e){_fallback(pairs,fromIdx);}
  }

  async function _fetchValhalla(pairs,fromIdx){
    var locs=pairs.map(function(p){var s=p.split(',');return{lon:parseFloat(s[0]),lat:parseFloat(s[1])};});
    var body={locations:locs,costing:'auto',costing_options:{auto:{use_tracks:0.9,use_highways:0.0,use_tolls:routeOpts.avoidTolls?0.0:0.5}},units:'miles'};
    try{
      var ctrl=new AbortController();var tid=setTimeout(function(){ctrl.abort();},12000);
      var data=await(await fetch('https://valhalla1.openstreetmap.de/route',{method:'POST',signal:ctrl.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json();clearTimeout(tid);
      if(!data.trip||data.trip.status!==0)return _fallback(pairs,fromIdx);
      var all=[],steps=[],legs=[];
      (data.trip.legs||[]).forEach(function(leg){var c=decodeP6(leg.shape||'');all=all.concat(c);var ls=[];(leg.maneuvers||[]).forEach(function(m){var dist=Math.round((m.length||0)*1609.34);var shp=c[m.begin_shape_index];var st={type:m.type===4?'arrive':m.type===1?'depart':'turn',modifier:{0:'',1:'',2:'left',3:'right',4:'arrive',5:'sharp left',6:'sharp right',7:'left',8:'right',9:'uturn',10:'slight left',11:'slight right'}[m.type]||'',name:m.street_names&&m.street_names[0]||'',distance:dist,duration:m.time||0,lat:shp?shp[1]:undefined,lng:shp?shp[0]:undefined};steps.push(st);ls.push(st);});legs.push(ls);});
      _routeCoords=all;routePts=all.filter(function(_,i){return i%3===0;});updateRoute();
      routeIsProper=true;_routeLoading=false;
      postRN({type:'route_ready',routed:true,steps:steps,legs:legs,total_distance:Math.round((data.trip.summary.length||0)*1609.34),total_duration:data.trip.summary.time||0,fromIdx:fromIdx||0});
    }catch(e){_fallback(pairs,fromIdx);}
  }

  async function loadRoute(){if(wps.length<2)return;await _fetchRoute(wps.map(function(w){return w.lng+','+w.lat;}),0);}
  async function loadRouteFrom(lat,lng,fromIdx){var rem=wps.slice(fromIdx);if(!rem.length){_fallback([],fromIdx);return;}await _fetchRoute([lng+','+lat].concat(rem.map(function(w){return w.lng+','+w.lat;})),fromIdx);}

  // ── Message handler ───────────────────────────────────────────────────────────
  function handleMsgData(msg){
    if(msg.type==='set_token'){initMap(msg.token,msg.style);return;}
    if(!mapReady){pendingMsgs.push(msg);return;}
    if(msg.type==='nav_active'){navActive=msg.active;if(!msg.active)map.easeTo({pitch:0,bearing:0,zoom:12,duration:700});}
    if(msg.type==='user_pos'&&msg.lat){lastSpeed=msg.speed!=null?msg.speed:lastSpeed;setUserPos(msg.lat,msg.lng,false,null,msg.heading);}
    if(msg.type==='nav_center'&&msg.lat){lastSpeed=msg.speed!=null?msg.speed:lastSpeed;setUserPos(msg.lat,msg.lng,true,17,msg.heading);}
    if(msg.type==='locate'&&msg.lat)setUserPos(msg.lat,msg.lng,true,13);
    if(msg.type==='nav_target')setNavTarget(msg.idx);
    if(msg.type==='nav_reset'){setNavTarget(-1);_routeCoords=[];routePts=[];updateRoute();}
    if(msg.type==='fly_to'&&msg.lat){
      map.flyTo({center:[msg.lng,msg.lat],zoom:14,duration:600});
      if(searchMarker){searchMarker.remove();searchMarker=null;}
      var el=document.createElement('div');el.className='mk-search';el.textContent='📍';
      searchMarker=new mapboxgl.Marker({element:el}).setLngLat([msg.lng,msg.lat]).setPopup(new mapboxgl.Popup({offset:18,closeButton:false}).setHTML('<div class="pt">'+(msg.name||'Location')+'</div>')).addTo(map);
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
    if(msg.type==='reroute_from'&&msg.lat){_routeCoords=[];routePts=[];routeIsProper=false;lastOffCheck=Date.now();loadRouteFrom(msg.lat,msg.lng,msg.fromIdx||0);}
    if(msg.type==='route_to_search'&&msg.lat){
      if(searchMarker){searchMarker.remove();searchMarker=null;}
      var el2=document.createElement('div');el2.className='mk-search';el2.textContent='📍';
      searchMarker=new mapboxgl.Marker({element:el2}).setLngLat([msg.lng,msg.lat]).setPopup(new mapboxgl.Popup({offset:18,closeButton:false}).setHTML('<div class="pt">'+(msg.name||'Destination')+'</div>')).addTo(map);
      searchMarker.togglePopup();
      _fetchRoute([msg.userLng+','+msg.userLat,msg.lng+','+msg.lat],0);
    }
    if(msg.type==='set_reports'){allReports=msg.reports||[];updateReportMarkers();}
    if(msg.type==='add_report'){allReports=allReports.filter(function(r){return r.id!==msg.report.id;});allReports.push(msg.report);updateReportMarkers();}
    if(msg.type==='set_style'&&msg.style){currentStyle=msg.style;map.setStyle(msg.style);}
    if(msg.type==='set_land_overlay')setLandOverlay(!!msg.show);
    if(msg.type==='download_tiles_bbox'){if(!downloadActive){downloadActive=true;_dlTiles(msg.n,msg.s,msg.e,msg.w,msg.minZ||10,msg.maxZ||12);}}
    if(msg.type==='download_tiles'){if(!downloadActive){downloadActive=true;var b=map.getBounds();_dlTiles(b.getNorth(),b.getSouth(),b.getEast(),b.getWest(),msg.minZ||10,msg.maxZ||15);}}
    if(msg.type==='cancel_download')downloadActive=false;
  }

  function onMsg(e){try{handleMsgData(JSON.parse(e.data||'{}'));}catch(err){}}
  document.addEventListener('message',onMsg);
  window.addEventListener('message',onMsg);
})();
</script>
</body></html>`;

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function MapScreen() {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const activeTrip = useStore(st => st.activeTrip);
  const user = useStore(st => st.user);
  const setStoreLoc = useStore(st => st.setUserLoc);
  const setStoreToken = useStore(st => st.setMapboxToken);
  const liveReports = useStore(st => st.liveReports);
  const addLiveReport = useStore(st => st.addLiveReport);
  const cachedRegions = useStore(st => st.cachedRegions);
  const addCachedRegion = useStore(st => st.addCachedRegion);
  const webRef = useRef<WebView>(null);

  const [userLoc,       setUserLoc]       = useState<{ lat: number; lng: number } | null>(null);
  const [userSpeed,     setUserSpeed]     = useState<number | null>(null);
  const [userHeading,   setUserHeading]   = useState<number | null>(null);
  const [legSpeedLimits,setLegSpeedLimits]= useState<(number | null)[]>([]);
  const [quickReport,   setQuickReport]   = useState(false);
  const [quickToast,    setQuickToast]    = useState('');
  const [quickTypeIdx,  setQuickTypeIdx]  = useState<number | null>(null);
  const [navMode,   setNavMode]   = useState(false);
  const [navIdx,    setNavIdx]    = useState(0);
  const [routeSteps,  setRouteSteps]  = useState<RouteStep[]>([]);
  const [isRouted,    setIsRouted]    = useState(false);
  const [mapLayer,    setMapLayerState] = useState<MapLayer>('satellite');
  const [showLands,   setShowLands]    = useState(false);
  const [audioGuide,  setAudioGuide]   = useState<Record<string, string>>({});
  const [showSteps,   setShowSteps]    = useState(false);
  const [showPanel,   setShowPanel]    = useState(true);
  const [routeAlerts, setRouteAlerts]  = useState<Report[]>([]);
  const [showAlerts,  setShowAlerts]   = useState(false);
  const [communityPins, setCommunityPins] = useState<Pin[]>([]);
  const [routeLegs,    setRouteLegs]    = useState<RouteStep[][]>([]);
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
  const [offlineSaved, setOfflineSaved] = useState(false);
  const [mapboxToken,   setMapboxToken]   = useState('');
  const [showFilters,   setShowFilters]   = useState(false);
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [discoverPins,  setDiscoverPins]  = useState<CampsitePin[]>([]);
  const [selectedCamp,  setSelectedCamp]  = useState<CampsitePin | null>(null);
  const [campDetail,    setCampDetail]    = useState<CampsiteDetail | null>(null);
  const [showCampDetail,setShowCampDetail] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [isSearchingCamps, setIsSearchingCamps] = useState(false);

  // Nearby mode (Dyrt-style)
  const [nearbyMode,    setNearbyMode]    = useState(false);
  const [nearbyPins,    setNearbyPins]    = useState<CampsitePin[]>([]);
  const [loadingNearby, setLoadingNearby] = useState(false);
  const nearbyRef = useRef<CampsitePin[]>([]);

  // POI layer
  const [showPois, setShowPois] = useState(false);
  const [pois,     setPois]     = useState<OsmPoi[]>([]);

  // Route options
  const [routeOpts,      setRouteOpts]      = useState<RouteOpts>({ avoidTolls: false, avoidHighways: false, backRoads: false, noFerries: false });
  const [showRouteOpts,  setShowRouteOpts]  = useState(false);
  const [searchRouteCard,setSearchRouteCard]= useState<SearchPlace | null>(null);

  // Offline state modal
  const [showOfflineModal,  setShowOfflineModal]  = useState(false);
  const [offlineWarning,    setOfflineWarning]    = useState(false);

  // AI & Wikipedia in campsite detail
  const [campInsight,    setCampInsight]    = useState<CampsiteInsight | null>(null);
  const [loadingInsight, setLoadingInsight] = useState(false);
  const [wikiArticles,   setWikiArticles]   = useState<WikiArticle[]>([]);
  const [loadingWiki,    setLoadingWiki]    = useState(false);

  // Route brief
  const [routeBrief,    setRouteBrief]    = useState<RouteBrief | null>(null);
  const [showRouteBrief,setShowRouteBrief]= useState(false);
  const [loadingBrief,  setLoadingBrief]  = useState(false);

  // Packing list
  const [packingList,   setPackingList]   = useState<PackingList | null>(null);
  const [showPacking,   setShowPacking]   = useState(false);
  const [loadingPacking,setLoadingPacking]= useState(false);

  const [navDest, setNavDest] = useState<WP | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [approachingReport, setApproachingReport] = useState<Report | null>(null);

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
  const discoverRef  = useRef<CampsitePin[]>([]);

  const webLoadedRef = useRef(false);
  const viewportRef  = useRef<{ n: number; s: number; e: number; w: number; zoom: number } | null>(null);
  const [isLoadingAreaCamps, setIsLoadingAreaCamps] = useState(false);
  const [mapMoved, setMapMoved] = useState(false);
  const [searchResult, setSearchResult] = useState<{ count: number } | null>(null);

  // Fetch Mapbox token once on mount; send set_token to WebView when both are ready
  useEffect(() => {
    api.getConfig().then(c => {
      const token = c.mapbox_token || '';
      setMapboxToken(token);
      setStoreToken(token);
      if (token && webLoadedRef.current) {
        webRef.current?.postMessage(JSON.stringify({
          type: 'set_token', token,
          style: MAPBOX_STYLES[mapLayer] ?? MAPBOX_STYLES.satellite,
        }));
      }
    }).catch(() => {});
  }, []);

  // Keep refs in sync
  useEffect(() => { navRef.current.active = navMode; }, [navMode]);
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

  const waypoints: WP[] = useMemo(() =>
    (activeTrip?.plan.waypoints ?? [])
      .filter(w => w.lat && w.lng)
      .map(w => ({ lat: w.lat!, lng: w.lng!, name: w.name, day: w.day, type: w.type })),
    [activeTrip?.trip_id]
  );

  useEffect(() => { navRef.current.wps = waypoints; }, [waypoints]);

  // ── Location watch ──────────────────────────────────────────────────────────

  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    Location.requestForegroundPermissionsAsync().then(({ status }) => {
      if (status !== 'granted') return;
      Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 5 },
        loc => {
          const pos = { lat: loc.coords.latitude, lng: loc.coords.longitude };
          setUserLoc(pos);
          setStoreLoc(pos);
          const rawSpeed = loc.coords.speed ?? null;
          setUserSpeed(rawSpeed);
          userSpeedRef.current = rawSpeed;

          // Heading: use EMA smoothing; fall back to bearing-to-next-step at low speed
          const rawHdg = (loc.coords.heading ?? -1);
          const speedMs = rawSpeed ?? 0;
          let hdg = -1;
          if (speedMs > 0.8 && rawHdg >= 0) {
            // Smooth heading with EMA (α=0.35), handling 0/360 wraparound
            const prev = smoothedHdgRef.current;
            if (prev === null) {
              smoothedHdgRef.current = rawHdg; hdg = rawHdg;
            } else {
              let diff = rawHdg - prev;
              if (diff > 180) diff -= 360;
              if (diff < -180) diff += 360;
              const s = (prev + diff * 0.35 + 360) % 360;
              smoothedHdgRef.current = s; hdg = s;
            }
          } else if (speedMs <= 0.8) {
            // Parked/slow: use bearing toward current step if navigating
            const cur = routeStepsRef.current[stepIdxRef.current];
            if (cur?.lat != null) {
              hdg = calcBearing(pos.lat, pos.lng, cur.lat!, cur.lng!);
              smoothedHdgRef.current = hdg;
            } else {
              hdg = smoothedHdgRef.current ?? -1;
            }
          }
          setUserHeading(hdg >= 0 ? hdg : null);

          const { active, idx, wps } = navRef.current;
          webRef.current?.postMessage(JSON.stringify({
            type: active ? 'nav_center' : 'user_pos',
            lat: pos.lat, lng: pos.lng, heading: hdg, speed: rawSpeed,
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
              const [farDist, nearDist] = announceDists(speedMph > 0 ? speedMph : null);
              const farKey  = si * 2;      // first announcement (far)
              const nearKey = si * 2 + 1;  // second announcement (close)

              if (cur.type !== 'depart' && cur.type !== 'arrive') {
                // Far announcement (e.g. "In 1 mile, turn right on I-95")
                if (distM < farDist && !stepAnnouncedRef.current.has(farKey)) {
                  stepAnnouncedRef.current.add(farKey);
                  Speech.speak(buildAnnouncement(cur, distM, 'far'), { rate: 0.88, pitch: 1.05, language: 'en-US' });
                }
                // Near announcement (e.g. "Turn right on I-95 in 300 feet")
                if (distM < nearDist && !stepAnnouncedRef.current.has(nearKey)) {
                  stepAnnouncedRef.current.add(nearKey);
                  Speech.speak(buildAnnouncement(cur, distM, 'near'), { rate: 0.88, pitch: 1.05, language: 'en-US' });
                }
              }

              // Advance to next step when within 30m of maneuver point
              if (distM < 30 && si < steps.length - 1) {
                const next = si + 1;
                stepIdxRef.current = next;
                setStepIdx(next);
                stepAnnouncedRef.current.delete(next * 2 + 1); // allow near announce for new step
              }
            }
          }

          // ── Approaching report alert (Waze-style 1-mile warning) ──────────
          {
            const allReps = [...liveReportsRef.current, ...routeAlertsRef.current];
            for (const rep of allReps) {
              if (alertedRepIdsRef.current.has(rep.id)) continue;
              const repDistM = haversineKm(pos.lat, pos.lng, rep.lat, rep.lng) * 1000;
              if (repDistM < 1609) { // 1 mile
                alertedRepIdsRef.current.add(rep.id);
                setApproachingReport(rep);
                const labels: Record<string, string> = {
                  police: 'Ranger patrol', hazard: 'Hazard reported',
                  road_condition: 'Road condition', wildlife: 'Wildlife',
                  road_closure: 'Road closure', campsite: 'Campsite report', water: 'Water source',
                };
                const label = labels[rep.type] ?? 'Community report';
                Speech.speak(`${label} ahead in ${speakDist(repDistM)}.`, { rate: 0.88, pitch: 1.05, language: 'en-US' });
                if (approachDismissRef.current) clearTimeout(approachDismissRef.current);
                approachDismissRef.current = setTimeout(() => setApproachingReport(null), 20000);
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
              Speech.speak(`You have arrived at ${singleDest.name}.`, { rate: 0.88, pitch: 1.05, language: 'en-US' });
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
            Speech.speak(narration, { rate: 0.88, language: 'en-US' });
          }

          // Arrival at final destination
          if (dist < 0.25 && idx === wps.length - 1) {
            Speech.speak(`You have arrived at ${wps[idx].name}. Journey complete.`, { rate: 0.88, pitch: 1.05, language: 'en-US' });
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
            setRouteLegOffset(next);
            Speech.speak(`Arrived at ${wps[idx].name}. Now heading to ${wps[next].name}.`, { rate: 0.88, pitch: 1.05, language: 'en-US' });
          }
        }
      ).then(s => { sub = s; });
    });
    return () => { sub?.remove(); };
  }, []);

  // ── Trip data ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!activeTrip) return;
    const wps = activeTrip.plan.waypoints.filter(w => w.lat && w.lng);
    if (!wps.length) return;
    const center = wps[Math.floor(wps.length / 2)];
    if (center.lat && center.lng) {
      api.getNearbyPins(center.lat!, center.lng!, 3.0).then(setCommunityPins).catch(() => {});
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
  }, [userLoc]);

  // POI layer
  useEffect(() => {
    if (!showPois) {
      webRef.current?.postMessage(JSON.stringify({ type: 'clear_pois' }));
      return;
    }
    const center = userLoc ?? (waypoints[0] ? { lat: waypoints[0].lat, lng: waypoints[0].lng } : null);
    if (!center) return;
    api.getOsmPois(center.lat, center.lng, 40, 'water,trailhead,viewpoint,peak')
      .then(p => {
        setPois(p);
        webRef.current?.postMessage(JSON.stringify({ type: 'set_pois', pois: p }));
      })
      .catch(() => {});
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
      const dest = navDestRef.current;
      if (dest && waypoints.length === 0) {
        // Single-destination nav (from search) — route already drawn by route_to_search
        const dist = userLoc ? haversineKm(userLoc.lat, userLoc.lng, dest.lat, dest.lng) : null;
        const distStr = dist && dist > 0.5 ? `, ${formatDist(dist)} away` : '';
        Speech.speak(`Navigation started. Heading to ${dest.name}${distStr}.`, { rate: 0.88, pitch: 1.05, language: 'en-US' });
      } else {
        // Trip navigation
        const loc = navRef.current.active ? null : userLoc;
        let startIdx = navIdx;
        if (loc && waypoints.length > 0) {
          startIdx = nearestWpIdx(loc, waypoints);
          setNavIdx(startIdx);
          navRef.current.idx = startIdx;
          setRouteLegOffset(startIdx);
        }
        webRef.current?.postMessage(JSON.stringify({ type: 'nav_target', idx: startIdx }));
        if (userLoc) {
          webRef.current?.postMessage(JSON.stringify({
            type: 'start_route_from',
            lat: userLoc.lat, lng: userLoc.lng, fromIdx: startIdx,
          }));
        }
        const target = waypoints[startIdx];
        if (target) {
          const dist = userLoc ? haversineKm(userLoc.lat, userLoc.lng, target.lat, target.lng) : null;
          const distStr = dist && dist > 0.5 ? `, ${formatDist(dist)} away` : '';
          Speech.speak(`Navigation started. Heading to ${target.name}${distStr}.`, { rate: 0.88, pitch: 1.05, language: 'en-US' });
        }
      }
    } else {
      setIsApproaching(false);
      setIsRerouting(false);
      setApproachingReport(null);
      alertedRepIdsRef.current.clear();
      if (approachDismissRef.current) clearTimeout(approachDismissRef.current);
      setRouteLegOffset(0);
      navDestRef.current = null;
      setNavDest(null);
      webRef.current?.postMessage(JSON.stringify({ type: 'nav_reset' }));
      webRef.current?.postMessage(JSON.stringify({ type: 'clear_track' }));
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
      Speech.speak(buildAnnouncement(first, first.distance, 'far'), { rate: 0.88, pitch: 1.05, language: 'en-US' });
    }, 1500);
    return () => clearTimeout(t);
  }, [navIdx, navMode, routeLegOffset]);

  // ── Nominatim map search ────────────────────────────────────────────────────

  async function searchMap() {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setSearchRouteCard(null);
    try {
      const q = encodeURIComponent(searchQuery.trim());
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=5`,
        { headers: { 'User-Agent': 'Trailhead/1.0' } }
      );
      const data = await res.json();
      setSearchResults(data.map((r: any) => ({
        lat: parseFloat(r.lat), lng: parseFloat(r.lon), name: r.display_name,
      })));
    } catch {}
    setIsSearching(false);
  }

  function selectSearchResult(place: { lat: number; lng: number; name: string }) {
    const dist = userLoc ? haversineKm(userLoc.lat, userLoc.lng, place.lat, place.lng) : null;
    setSearchRouteCard({ ...place, dist });
    setSearchResults([]);
    webRef.current?.postMessage(JSON.stringify({ type: 'fly_to', lat: place.lat, lng: place.lng, name: place.name }));
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
    setNavMode(true);
  }

  async function openCampInsight() {
    if (!selectedCamp) return;
    setLoadingInsight(true);
    setLoadingWiki(true);
    try {
      const [insight, wiki] = await Promise.all([
        api.getCampsiteInsight({ name: selectedCamp.name, lat: selectedCamp.lat, lng: selectedCamp.lng,
          description: selectedCamp.description, land_type: selectedCamp.land_type,
          amenities: campDetail?.amenities ?? [] }),
        api.getWikipediaNearby(selectedCamp.lat, selectedCamp.lng, 15000),
      ]);
      setCampInsight(insight);
      setWikiArticles(wiki);
    } catch {}
    setLoadingInsight(false);
    setLoadingWiki(false);
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

  function copyCoordinates(lat: number, lng: number) {
    Share.share({ message: `${lat.toFixed(6)}, ${lng.toFixed(6)}` });
  }

  // ── Layer switch ────────────────────────────────────────────────────────────

  function switchLayer() {
    const next: MapLayer = mapLayer === 'satellite' ? 'topo' : mapLayer === 'topo' ? 'hybrid' : 'satellite';
    setMapLayerState(next);
    webRef.current?.postMessage(JSON.stringify({
      type: 'set_style',
      style: MAPBOX_STYLES[next] ?? MAPBOX_STYLES.satellite,
    }));
  }

  async function loadCampsInArea(bounds: { n: number; s: number; e: number; w: number; zoom: number }, types: string[]) {
    if (bounds.zoom < 6) return;
    setIsLoadingAreaCamps(true);
    setMapMoved(false);
    setSearchResult(null);
    try {
      const camps = await api.getCampsBbox(bounds.n, bounds.s, bounds.e, bounds.w, types);
      webRef.current?.postMessage(JSON.stringify({ type: 'set_camps', pins: camps }));
      setSearchResult({ count: camps.length });
      // Clear result badge after 3 seconds
      setTimeout(() => setSearchResult(null), 3000);
    } catch (e: any) {
      setSearchResult({ count: -1 }); // -1 = error
      setTimeout(() => setSearchResult(null), 3000);
    }
    setIsLoadingAreaCamps(false);
  }

  // ── WebView message handler ──────────────────────────────────────────────────

  function onWebMessage(e: any) {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'map_ready') {
        if (viewportRef.current) loadCampsInArea(viewportRef.current, activeFilters);
      }
      if (msg.type === 'map_bounds') {
        viewportRef.current = { n: msg.n, s: msg.s, e: msg.e, w: msg.w, zoom: msg.zoom };
        if ((msg.zoom ?? 0) >= 6) setMapMoved(true);
      }
      if (msg.type === 'search_area') {
        // Legacy WebView button — handled by native button now, but keep as fallback
        const bounds = { n: msg.n, s: msg.s, e: msg.e, w: msg.w, zoom: msg.zoom };
        viewportRef.current = bounds;
        loadCampsInArea(bounds, activeFilters);
      }
      if (msg.type === 'map_tapped') {
        setSelectedCamp(null);
      }
      if (msg.type === 'route_ready') {
        setIsRouted(msg.routed);
        setRouteSteps(msg.steps ?? []);
        setRouteLegs(msg.legs ?? []);
        if (msg.fromIdx !== undefined) setRouteLegOffset(msg.fromIdx);
        setLegSpeedLimits(msg.legSpeedLimits ?? []);
        setIsRerouting(false);
      }
      if (msg.type === 'off_route' && navRef.current.active) {
        const now = Date.now();
        if (isReroutingRef.current || now - lastRerouteRef.current < 35000) return;
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
        Speech.speak('Off route. Recalculating.', { rate: 0.88, pitch: 1.05 });
      }
      if (msg.type === 'wp_tapped') {
        setNavIdx(msg.idx);
        navRef.current.idx = msg.idx;
        if (!navRef.current.active) setNavMode(true);
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
        setOfflineSaved(true);
        setDownloadLabel(prev => { if (prev) addCachedRegion(prev); return prev; });
        setTimeout(() => { setDownloadProgress(0); setDownloadSaved(0); setDownloadMB('0'); }, 3000);
      }
      if (msg.type === 'campsite_tapped') {
        const camp = (msg.camp as CampsitePin) || null;
        setSelectedCamp(camp);
        setCampDetail(null);
        setCampInsight(null);
        setWikiArticles([]);
      }
    } catch {}
  }

  async function openCampDetail() {
    if (!selectedCamp) return;
    setLoadingDetail(true);
    setCampInsight(null);
    setWikiArticles([]);
    try {
      const d = await api.getCampsiteDetail(selectedCamp.id);
      setCampDetail(d);
      setShowCampDetail(true);
      // Load AI insight + Wikipedia in background after modal opens
      openCampInsight();
    } catch {
      // OSM pins don't have RIDB detail — show quick card data as detail
      setCampDetail(selectedCamp as any);
      setShowCampDetail(true);
      openCampInsight();
    }
    setLoadingDetail(false);
  }

  // ── Stable map HTML (only rebuilds on trip/pins change) ─────────────────────

  const campsites = useMemo(() =>
    (activeTrip?.campsites ?? []).filter(c => c.lat && c.lng).map(c => ({ lat: c.lat, lng: c.lng, name: c.name })),
    [activeTrip?.trip_id]
  );
  const gas = useMemo(() =>
    (activeTrip?.gas_stations ?? []).filter(g => g.lat && g.lng).map(g => ({ lat: g.lat, lng: g.lng, name: g.name })),
    [activeTrip?.trip_id]
  );
  const pinList = useMemo(() =>
    communityPins.map(p => ({ lat: p.lat, lng: p.lng, name: p.name, type: p.type })),
    [communityPins.length]
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
  const etaMins   = distKm && userSpeed && userSpeed > 0.5
    ? Math.round(distKm / (userSpeed * 3.6) * 60) : null;
  const legIdx    = Math.max(0, navIdx - routeLegOffset);
  const speedLimitKph = legSpeedLimits[legIdx] ?? null;
  const speedLimitMph = speedLimitKph ? Math.round(speedLimitKph * 0.621371) : null;

  // Current step the user is navigating toward
  const nextStep = routeSteps[stepIdx] ?? null;
  // Real distance to the step's maneuver point (more accurate than step.distance)
  const stepDistM = nextStep?.lat != null && userLoc
    ? haversineKm(userLoc.lat, userLoc.lng, nextStep.lat!, nextStep.lng!) * 1000
    : null;
  const isProceeding = distKm !== null && distKm > 30;
  // "Proceed to route" when user hasn't started moving along it yet
  const proceedToRoute = !isRerouting && isRouted && stepIdx === 0 && stepDistM !== null && stepDistM > 300;

  // Total remaining trip distance (current → navIdx → ... → last waypoint)
  const remainingKm = useMemo(() => {
    if (!navMode || !userLoc || !waypoints.length) return null;
    let total = distKm ?? 0;
    for (let i = navIdx; i < waypoints.length - 1; i++) {
      total += haversineKm(waypoints[i].lat, waypoints[i].lng, waypoints[i + 1].lat, waypoints[i + 1].lng);
    }
    return total;
  }, [navMode, navIdx, distKm, userLoc]);

  function manualReroute() {
    if (!userLoc || !navMode) return;
    const now = Date.now();
    lastRerouteRef.current = now;
    setIsRerouting(true);
    isReroutingRef.current = true;
    webRef.current?.postMessage(JSON.stringify({
      type: 'reroute_from',
      lat: userLoc.lat, lng: userLoc.lng,
      fromIdx: navRef.current.idx,
    }));
    setRouteLegOffset(navRef.current.idx);
    Speech.speak('Recalculating.', { rate: 0.95 });
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
    setNavMode(true);
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
          if (mapboxToken) {
            webRef.current?.postMessage(JSON.stringify({
              type: 'set_token', token: mapboxToken,
              style: MAPBOX_STYLES[mapLayer] ?? MAPBOX_STYLES.satellite,
            }));
          }
          if (userLoc) webRef.current?.postMessage(JSON.stringify({ type: 'user_pos', lat: userLoc.lat, lng: userLoc.lng }));
        }}
      />

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
                      : `NAVIGATING · STOP ${navIdx + 1}/${waypoints.length} · ${isRouted ? '🗺 ROUTED' : '🧭 OFF-ROAD'}`
                : activeTrip ? activeTrip.plan.trip_name.toUpperCase() : 'NO ACTIVE TRIP'}
        </Text>
        {routeAlerts.length > 0 && (
          <TouchableOpacity style={s.alertPill} onPress={() => setShowAlerts(v => !v)}>
            <Text style={s.alertPillText}>⚠ {routeAlerts.length}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Offline download progress bar */}
      {isDownloading && (
        <View style={s.dlBar}>
          <View style={[s.dlFill, { width: `${downloadProgress}%` as any }]} />
        </View>
      )}

      {/* Controls */}
      <View style={s.controls}>
        <TouchableOpacity style={s.ctrlBtn} onPress={() => {
          if (userLoc) webRef.current?.postMessage(JSON.stringify({ type: 'locate', lat: userLoc.lat, lng: userLoc.lng }));
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

        {waypoints.length > 0 && (
          <TouchableOpacity
            style={[s.ctrlBtn, navMode && { backgroundColor: C.green + 'dd', borderColor: C.green }]}
            onPress={() => navMode ? setNavMode(false) : (setNavIdx(0), navRef.current.idx = 0, setNavMode(true))}
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
              if (isDownloading) {
                webRef.current?.postMessage(JSON.stringify({ type: 'cancel_download' }));
                setIsDownloading(false);
              } else {
                setIsDownloading(true); setOfflineSaved(false);
                webRef.current?.postMessage(JSON.stringify({ type: 'download_tiles', minZ: 10, maxZ: 15 }));
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
          onPress={() => { setShowFilters(p => !p); if (showFilters) { setActiveFilters([]); setSelectedCamp(null); } }}
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
            : <Text style={{ fontSize: 16 }}>⛺</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.ctrlBtn, showPois && { backgroundColor: '#3b82f6dd', borderColor: '#3b82f6' }]}
          onPress={() => setShowPois(p => !p)}
        >
          <Text style={{ fontSize: 15 }}>💧</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.ctrlBtn, { borderColor: C.border }]}
          onPress={() => setShowOfflineModal(true)}
        >
          <Ionicons name="map-outline" size={18} color={C.text2} />
        </TouchableOpacity>

        {!navMode && (
          <TouchableOpacity style={s.ctrlBtn} onPress={() => setShowPanel(p => !p)}>
            <Ionicons name={showPanel ? 'chevron-down' : 'chevron-up'} size={20} color={C.text} />
          </TouchableOpacity>
        )}
      </View>

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
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* ── Search overlay ── */}
      {showSearch && (
        <View style={s.searchOverlay}>
          <View style={s.searchBar}>
            <Ionicons name="search" size={15} color={OVR.text3} />
            <TextInput
              style={s.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={searchMap}
              placeholder="Search location..."
              placeholderTextColor={OVR.text3}
              returnKeyType="search"
              autoFocus
            />
            {isSearching
              ? <ActivityIndicator size="small" color={C.orange} />
              : searchQuery.length > 0 && (
                <TouchableOpacity onPress={searchMap}>
                  <Text style={s.searchGo}>GO</Text>
                </TouchableOpacity>
              )
            }
          </View>
          {searchResults.length > 0 && (
            <ScrollView style={s.searchResults} keyboardShouldPersistTaps="handled">
              {searchResults.map((r, i) => (
                <TouchableOpacity key={i} style={s.searchResultItem} onPress={() => selectSearchResult(r)}>
                  <Ionicons name="location-outline" size={13} color={OVR.text3} />
                  <Text style={s.searchResultText} numberOfLines={2}>{r.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
          {searchRouteCard && (
            <View style={s.routeCard}>
              <Text style={s.routeCardName} numberOfLines={2}>{searchRouteCard.name}</Text>
              {searchRouteCard.dist !== null && (
                <Text style={s.routeCardDist}>
                  {formatDist(searchRouteCard.dist!)} from you
                  {routeOpts.backRoads ? ' · BACK ROADS' : routeOpts.avoidHighways ? ' · NO HWY' : ''}
                  {routeOpts.avoidTolls ? ' · NO TOLL' : ''}
                </Text>
              )}
              <View style={s.routeCardActions}>
                <TouchableOpacity style={s.routeCardNav} onPress={navigateToSearch} disabled={!userLoc}>
                  <Ionicons name="navigate" size={14} color="#fff" />
                  <Text style={s.routeCardNavText}>NAVIGATE HERE</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.routeCardOpts} onPress={() => setShowRouteOpts(true)}>
                  <Ionicons name="options-outline" size={14} color={C.text2} />
                  <Text style={s.routeCardOptsText}>OPTIONS</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setSearchRouteCard(null)}>
                  <Ionicons name="close" size={18} color={C.text3} />
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      )}

      {/* ── Campsite filter bar ── */}
      {showFilters && !navMode && (
        <View style={s.filterBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterScroll}>
            {([
              { id: 'blm',       label: 'BLM',              emoji: '🏕️' },
              { id: 'nfs',       label: 'Nat. Forest',      emoji: '🌿' },
              { id: 'nps',       label: 'Nat. Park',        emoji: '⛰️' },
              { id: 'state',     label: 'State Park',       emoji: '🏞️' },
              { id: 'dispersed', label: 'Dispersed',        emoji: '🌲' },
              { id: 'rv',        label: 'RV / Hookups',     emoji: '🚐' },
              { id: 'koa',       label: 'KOA',              emoji: '🏡' },
              { id: 'tent',      label: 'Tent Only',        emoji: '⛺' },
              { id: 'free',      label: 'Free',             emoji: '💚' },
              { id: 'water',     label: 'Water',            emoji: '💧' },
              { id: 'showers',   label: 'Showers',          emoji: '🚿' },
              { id: 'dog',       label: 'Dog Friendly',     emoji: '🐕' },
              { id: 'ada',       label: 'ADA',              emoji: '♿' },
              { id: 'parking',   label: 'Overnight Prkg',   emoji: '🅿️' },
            ]).map(f => {
              const active = activeFilters.includes(f.id);
              return (
                <TouchableOpacity
                  key={f.id}
                  style={[s.filterChip, active && s.filterChipActive]}
                  onPress={() => setActiveFilters(prev =>
                    prev.includes(f.id) ? prev.filter(x => x !== f.id) : [...prev, f.id]
                  )}
                >
                  <Text style={s.filterChipEmoji}>{f.emoji}</Text>
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
                    {selectedCamp.tags.includes('rv') ? '🚐' : selectedCamp.tags.includes('dispersed') ? '🌲' : '🏕️'}
                  </Text>
                  <Text style={{ fontSize: 9, color: landColor(selectedCamp.land_type).text, fontFamily: mono, marginTop: 4, fontWeight: '700' }}>
                    {(selectedCamp.land_type || 'CAMP').toUpperCase().slice(0, 12)}
                  </Text>
                </View>
            }
          </View>
          <View style={s.quickCardBody}>
            {/* Close + name */}
            <View style={s.quickCardHeader}>
              <Text style={s.quickCardName} numberOfLines={2}>{selectedCamp.name}</Text>
              <TouchableOpacity style={s.quickCardClose} onPress={() => setSelectedCamp(null)}>
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
              {selectedCamp.tags.slice(0, 5).map(t => (
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
              {campDetail.photos.length > 0 ? (
                <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={s.photoGallery}>
                  {campDetail.photos.map((uri, i) => (
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
                {campDetail.amenities.length > 0 && (
                  <View style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>AMENITIES</Text>
                    <View style={s.amenityGrid}>
                      {campDetail.amenities.map(a => {
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
                {campDetail.site_types.length > 0 && (
                  <View style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>SITE TYPES</Text>
                    <View style={s.amenityGrid}>
                      {campDetail.site_types.map(st => (
                        <View key={st} style={[s.amenityItem, { backgroundColor: '#f0fdf4', borderColor: '#86efac' }]}>
                          <Text style={{ fontSize: 13 }}>⛺</Text>
                          <Text style={[s.amenityText, { color: '#15803d' }]}>{st}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                {/* Activities */}
                {campDetail.activities.length > 0 && (
                  <View style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>Activities</Text>
                    <Text style={s.detailActivities}>{campDetail.activities.join(' · ')}</Text>
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

      {/* ── Offline Map Download Modal ── */}
      <Modal visible={showOfflineModal} animationType="slide" transparent onRequestClose={() => setShowOfflineModal(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.65)' }}>
          <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={() => setShowOfflineModal(false)} />
          <View style={s.offlineSheet}>
            {/* Header */}
            <View style={s.offlineHeader}>
              <Ionicons name="map-outline" size={18} color={C.orange} />
              <Text style={s.offlineTitle}>OFFLINE MAPS</Text>
              <TouchableOpacity onPress={() => setShowOfflineModal(false)} style={s.offlineClose}>
                <Ionicons name="close" size={18} color={C.text3} />
              </TouchableOpacity>
            </View>

            {/* What's included */}
            <View style={s.offlineIncludesRow}>
              {['Trails & 4WD tracks', 'All road names', 'Terrain contours', 'Speed limits', 'Satellite imagery', 'Camp labels'].map(item => (
                <View key={item} style={s.offlineIncludeChip}>
                  <Text style={s.offlineIncludeText}>{item}</Text>
                </View>
              ))}
            </View>

            {!user ? (
              <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                <Text style={s.offlineSub}>Sign in to download offline maps.</Text>
                <TouchableOpacity onPress={() => setShowOfflineModal(false)} style={s.offlineRouteBtn}>
                  <Text style={s.offlineRouteBtnText}>GO TO PROFILE → SIGN IN</Text>
                </TouchableOpacity>
              </View>
            ) : (<>

            {/* Active download progress */}
            {isDownloading && (
              <View style={s.offlineProgressCard}>
                <View style={s.offlineProgressTop}>
                  <Text style={s.offlineProgressLabel}>
                    DOWNLOADING · {downloadSaved.toLocaleString()} / {downloadTotal.toLocaleString()} COORDS
                  </Text>
                  <Text style={s.offlineProgressMB}>{downloadMB} MB</Text>
                </View>
                <View style={s.dlBar}>
                  <View style={[s.dlFill, { width: `${downloadProgress}%` as any }]} />
                </View>
                <TouchableOpacity style={s.offlineCancelBtn} onPress={() => {
                  webRef.current?.postMessage(JSON.stringify({ type: 'cancel_download' }));
                  setIsDownloading(false);
                }}>
                  <Text style={s.offlineCancelText}>CANCEL</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Current trip download */}
            <Text style={s.offlineSectionLabel}>MY TRIP CORRIDOR · FULL TRAIL DETAIL (z10–z16)</Text>
            {waypoints.length > 0 ? (() => {
              const lats = waypoints.map(w => w.lat), lngs = waypoints.map(w => w.lng);
              const pad = 0.4;
              const n = Math.max(...lats) + pad, s2 = Math.min(...lats) - pad;
              const e = Math.max(...lngs) + pad, w2 = Math.min(...lngs) - pad;
              const count = estimateTileCount(n, s2, e, w2, 10, 16);
              const label = activeTrip?.plan.trip_name ?? 'Trip';
              const isCached = cachedRegions.includes(label);
              return (
                <TouchableOpacity style={[s.offlineTripBtn, isCached && { borderColor: C.green + '66' }]}
                  disabled={isDownloading}
                  onPress={() => {
                    setShowOfflineModal(false); setIsDownloading(true); setOfflineSaved(false);
                    setDownloadLabel(label);
                    webRef.current?.postMessage(JSON.stringify({ type: 'download_tiles_bbox', n, s: s2, e, w: w2, minZ: 10, maxZ: 16 }));
                  }}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.offlineTripName} numberOfLines={1}>{label.toUpperCase()}</Text>
                    <Text style={s.offlineTripMeta}>
                      ~{count.toLocaleString()} tile coords · {tilesMB(count, 16)} · trails, tracks, speed limits
                    </Text>
                    {isCached && <Text style={[s.offlineTripMeta, { color: C.green }]}>✓ Cached</Text>}
                  </View>
                  <Ionicons name={isCached ? 'refresh-outline' : 'cloud-download-outline'} size={20} color={isCached ? C.green : C.orange} />
                </TouchableOpacity>
              );
            })() : (
              <Text style={s.offlineNoTrip}>Plan a trip first to download its full trail corridor</Text>
            )}

            {/* State downloads */}
            <Text style={[s.offlineSectionLabel, { marginTop: 16 }]}>US STATES</Text>
            <ScrollView style={{ maxHeight: 280 }} showsVerticalScrollIndicator={false}>
              {Object.entries(US_STATES).map(([code, st]) => {
                const countOvr = estimateTileCount(st.n, st.s, st.e, st.w, 10, 12);
                const countDet = estimateTileCount(st.n, st.s, st.e, st.w, 10, 15);
                const isCached = cachedRegions.includes(st.name);
                const isCachedDet = cachedRegions.includes(st.name + '-detail');
                return (
                  <View key={code} style={s.offlineStateRow}>
                    <Text style={s.stateEmoji}>{st.emoji}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={s.stateName}>{st.name}</Text>
                      <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                        <TouchableOpacity
                          style={[s.stateTierBtn, isCached && { borderColor: C.green }]}
                          disabled={isDownloading}
                          onPress={() => {
                            setShowOfflineModal(false); setIsDownloading(true); setOfflineSaved(false);
                            setDownloadLabel(st.name);
                            webRef.current?.postMessage(JSON.stringify({ type: 'download_tiles_bbox', n: st.n, s: st.s, e: st.e, w: st.w, minZ: 10, maxZ: 12 }));
                          }}>
                          <Text style={s.stateTierLabel}>{isCached ? '✓ ' : ''}OVERVIEW</Text>
                          <Text style={s.stateTierSize}>{tilesMB(countOvr, 12)}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[s.stateTierBtn, { borderColor: C.orange + '77' }, isCachedDet && { borderColor: C.green }]}
                          disabled={isDownloading}
                          onPress={() => {
                            setShowOfflineModal(false); setIsDownloading(true); setOfflineSaved(false);
                            setDownloadLabel(st.name + '-detail');
                            webRef.current?.postMessage(JSON.stringify({ type: 'download_tiles_bbox', n: st.n, s: st.s, e: st.e, w: st.w, minZ: 10, maxZ: 15 }));
                          }}>
                          <Text style={[s.stateTierLabel, { color: C.orange }]}>{isCachedDet ? '✓ ' : ''}TRAILS</Text>
                          <Text style={s.stateTierSize}>{tilesMB(countDet, 15)}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                );
              })}
            </ScrollView>

            {/* Cached regions summary */}
            {cachedRegions.length > 0 && (
              <View style={s.offlineCachedBar}>
                <Ionicons name="save-outline" size={12} color={C.green} />
                <Text style={s.offlineCachedText}>
                  {cachedRegions.length} region{cachedRegions.length !== 1 ? 's' : ''} cached: {cachedRegions.slice(0, 3).join(', ')}{cachedRegions.length > 3 ? '…' : ''}
                </Text>
              </View>
            )}
            </>)}
          </View>
        </View>
      </Modal>

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
                <View style={s.briefStat}><Text style={s.briefStatVal}>{routeBrief.water_carry_gallons}</Text><Text style={s.briefStatLabel}>Gallons Water</Text></View>
              </View>
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
      {(mapMoved || isLoadingAreaCamps || searchResult !== null) && !navMode && !showSearch && (
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
                name={searchResult.count < 0 ? 'alert-circle-outline' : searchResult.count === 0 ? 'information-circle-outline' : 'checkmark-circle-outline'}
                size={14}
                color={searchResult.count < 0 ? C.red : searchResult.count === 0 ? C.text3 : C.green}
                style={{ marginRight: 5 }}
              />
            ) : (
              <Ionicons name="search" size={13} color={C.orange} style={{ marginRight: 5 }} />
            )}
            <Text style={[s.searchAreaText, isLoadingAreaCamps && { color: OVR.text3 }]}>
              {isLoadingAreaCamps
                ? 'SEARCHING...'
                : searchResult !== null
                  ? searchResult.count < 0
                    ? 'SEARCH FAILED — RETRY'
                    : searchResult.count === 0
                      ? 'NO CAMPS FOUND HERE'
                      : `${searchResult.count} CAMP${searchResult.count !== 1 ? 'S' : ''} FOUND`
                  : 'SEARCH THIS AREA'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Navigation HUD ── */}
      <Animated.View style={[s.navHud, {
        opacity: navAnim,
        transform: [{ translateY: navAnim.interpolate({ inputRange: [0, 1], outputRange: [160, 0] }) }],
        pointerEvents: navMode ? 'box-none' : 'none',
      }]}>

        {/* Turn instruction strip — rerouting / proceed-to-route / normal */}
        {navMode && isRerouting ? (
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
              <Ionicons name="navigate-outline" size={22} color="#fff" />
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
                <Ionicons name={stepIcon(nextStep.type, nextStep.modifier) as any} size={22} color="#fff" />
              </View>
              <View style={s.turnInfo}>
                <Text style={s.turnLabel}>{stepLabel(nextStep.type, nextStep.modifier, nextStep.name)}</Text>
                {nextStep.name ? <Text style={s.turnRoad} numberOfLines={1}>{nextStep.name}</Text> : null}
              </View>
              <Text style={s.turnDist}>{formatStepDist(stepDistM ?? nextStep.distance)}</Text>
            </View>
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
          </View>
        ) : null}

        {/* Speed + distance strip */}
        <View style={s.navStrip}>
          {/* Speed circle (Waze-style) */}
          <View style={s.navSpeedCircle}>
            <Text style={s.navSpeedBig}>{speedMph !== null ? Math.round(speedMph) : '--'}</Text>
            <Text style={s.navSpeedUnit}>MPH</Text>
          </View>

          {/* Speed limit badge */}
          {speedLimitMph !== null && (
            <View style={[s.navSpeedLimit, speedMph !== null && Math.round(speedMph) > speedLimitMph + 5 && s.navSpeedLimitOver]}>
              <Text style={s.navSpeedLimitTop}>LIMIT</Text>
              <Text style={s.navSpeedLimitVal}>{speedLimitMph}</Text>
            </View>
          )}

          {/* Distance + ETA */}
          <View style={s.navDistBlock}>
            <Text style={[s.navDistVal, isApproaching && { color: C.green }]}>
              {distKm !== null ? formatDist(distKm) : '--'}
            </Text>
            {etaMins !== null && (
              <Text style={s.navEta}>
                {etaMins < 60 ? `~${etaMins} min` : `~${Math.floor(etaMins / 60)}h ${etaMins % 60}m`}
              </Text>
            )}
            {remainingKm !== null && waypoints.length > navIdx + 1 && (
              <Text style={s.navRemaining}>{formatDist(remainingKm)} trip total</Text>
            )}
          </View>

          {/* Compass */}
          <View style={s.navBearing}>
            <Text style={s.navBearingText}>{userHeading !== null ? compassDir(userHeading) : bearing !== null ? compassDir(bearing) : '--'}</Text>
          </View>
        </View>

        {/* Next waypoint */}
        {navTarget && (
          <View style={s.navTarget}>
            <View style={[s.navTargetBadge, isApproaching && { backgroundColor: C.green + '22', borderColor: C.green }]}>
              <Text style={[s.navTargetBadgeText, isApproaching && { color: C.green }]}>
                {isApproaching ? '⬤ ARRIVING' : isProceeding ? 'PROCEED TO' : 'NEXT STOP'}
              </Text>
            </View>
            <View style={s.navTargetInfo}>
              <Text style={s.navTargetName} numberOfLines={1}>{navTarget.name}</Text>
              <Text style={s.navTargetMeta}>
                Day {navTarget.day} · {navTarget.type} · {navIdx + 1} of {waypoints.length}
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
              </Text>
            </View>
            <View style={s.approachAlertActions}>
              <TouchableOpacity
                style={[s.approachAlertBtn, { backgroundColor: color + '22', borderColor: color + '55' }]}
                onPress={async () => {
                  try { await api.confirmReport(rep.id); } catch {}
                  setApproachingReport(null);
                  setQuickToast('+2 credits');
                  setTimeout(() => setQuickToast(''), 2000);
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
      {userLoc && !showSearch && !selectedCamp && (
        <View style={s.quickReportWrap} pointerEvents="box-none">
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
          <TouchableOpacity
            style={[s.quickReportFab, navMode && s.quickReportFabNav]}
            onPress={() => { setQuickTypeIdx(null); setQuickReport(p => !p); }}
          >
            <Ionicons name="warning-outline" size={18} color={quickReport ? OVR.text : OVR.text2} />
            <Text style={[s.quickReportFabText, quickReport && { color: OVR.text }]}>REPORT</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Bottom itinerary panel */}
      {showPanel && !navMode && activeTrip && (
        <View style={s.panel}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.dayScroll}>
            {activeTrip.plan.daily_itinerary.map(day => (
              <View key={day.day} style={s.dayCard}>
                <View style={s.dayBadge}><Text style={s.dayBadgeText}>{day.day}</Text></View>
                <Text style={s.dayTitle} numberOfLines={1}>{day.title}</Text>
                <Text style={s.dayMeta}>{day.est_miles}mi · {day.road_type}</Text>
              </View>
            ))}
          </ScrollView>
          <View style={s.legendRow}>
            {([[C.orange,'⬤','Waypoint'],[C.green,'⛺','Camp'],[C.yellow,'⛽','Fuel'],['#a855f7','📍','Community']] as const)
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
          <View style={s.aiActionsRow}>
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
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

// Map overlays always sit on dark transparent backgrounds regardless of app theme.
// Use these constants so text stays legible in both light and dark mode.
const OVR = {
  bg:      'rgba(6,10,8,0.95)',
  bg2:     'rgba(8,14,10,0.98)',
  border:  '#1e2e20',
  border2: '#0d1a0e',
  text:    '#e4ddd2',
  text2:   '#8a9285',
  text3:   '#4a5a4c',
};

const makeStyles = (C: ColorPalette) => StyleSheet.create({
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

  controls: { position: 'absolute', top: 106, right: 16, gap: 8 },
  ctrlBtn: {
    width: 44, height: 44, borderRadius: 14,
    backgroundColor: OVR.bg, borderWidth: 1, borderColor: OVR.border,
    alignItems: 'center', justifyContent: 'center',
  },
  layerText: { color: OVR.text2, fontSize: 9, fontFamily: mono, fontWeight: '800', letterSpacing: 0.5 },

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
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: '#1a3a1a',
  },
  turnIconWrap: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: 'rgba(249,115,22,0.25)', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: 'rgba(249,115,22,0.5)',
  },
  turnInfo: { flex: 1 },
  turnLabel: { color: '#fff', fontSize: 15, fontWeight: '900', fontFamily: mono, letterSpacing: 0.5 },
  turnRoad: { color: 'rgba(255,255,255,0.65)', fontSize: 11, marginTop: 2, fontFamily: mono },
  turnDist: { color: '#f97316', fontSize: 14, fontWeight: '700', fontFamily: mono },
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

  navStrip: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderColor: OVR.border,
  },
  navBearing: { alignItems: 'center', justifyContent: 'center', width: 46 },
  navBearingText: { color: C.orange, fontSize: 18, fontWeight: '900', fontFamily: mono },
  navDistBlock: { flex: 1, alignItems: 'center' },
  navDistVal: { color: OVR.text, fontSize: 28, fontWeight: '800', fontFamily: mono },
  navEta: { color: OVR.text3, fontSize: 10, fontFamily: mono, marginTop: 1 },
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
  dlBar: {
    position: 'absolute', top: 92, left: 16, right: 16,
    height: 3, borderRadius: 1.5, backgroundColor: C.border, overflow: 'hidden',
  },
  dlFill: { height: 3, backgroundColor: C.orange, borderRadius: 1.5 },

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
  searchOverlay: {
    position: 'absolute', top: 106, left: 16, right: 70,
    backgroundColor: OVR.bg2, borderRadius: 14,
    borderWidth: 1, borderColor: '#3b82f6',
    overflow: 'hidden',
  },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderColor: OVR.border,
  },
  searchInput: {
    flex: 1, color: OVR.text, fontSize: 14, fontFamily: mono,
  },
  searchGo: { color: C.orange, fontSize: 11, fontFamily: mono, fontWeight: '700' },
  searchResults: { maxHeight: 240 },
  searchResultItem: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderColor: OVR.border2,
  },
  searchResultText: { color: OVR.text2, fontSize: 12, flex: 1, lineHeight: 17, fontFamily: mono },

  // ── Bottom panel
  panel: { backgroundColor: C.s1, borderTopWidth: 1, borderColor: C.border, paddingBottom: 10 },
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
    backgroundColor: 'rgba(8,12,18,0.96)', borderBottomWidth: 1, borderColor: C.border,
  },
  filterScroll: { paddingHorizontal: 14, paddingVertical: 10, gap: 8 },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
    backgroundColor: C.s2, borderWidth: 1, borderColor: C.border,
  },
  filterChipActive: { backgroundColor: '#14b8a6', borderColor: '#14b8a6' },
  filterChipEmoji: { fontSize: 14 },
  filterChipText: { color: C.text2, fontSize: 11, fontFamily: mono, fontWeight: '600' },
  filterLoading: { alignItems: 'center', paddingBottom: 8 },

  // ── Campsite quick card (Dyrt-style: white card, photo left, bold info right)
  quickCard: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    flexDirection: 'row',
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.12, shadowRadius: 16,
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
  quickCardName: { color: '#0f172a', fontSize: 15, fontWeight: '800', flex: 1, lineHeight: 20 },
  quickCardClose: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: '#f1f5f9',
    alignItems: 'center', justifyContent: 'center',
  },
  landBadge: {
    alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 6, borderWidth: 1,
  },
  landBadgeText: { fontSize: 9, fontFamily: mono, fontWeight: '800', letterSpacing: 0.5 },
  quickCardTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  quickCardCost: { color: '#16a34a', fontSize: 11, fontFamily: mono, fontWeight: '700' },
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
  qTag: {
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6,
    borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#f8fafc',
  },
  qTagText: { color: '#475569', fontSize: 9, fontFamily: mono, fontWeight: '700' },

  // ── Campsite detail modal
  detailModal: { flex: 1, backgroundColor: '#ffffff' },
  photoGallery: { height: 260 },
  galleryPhoto: { width: 400, height: 260 },
  galleryPlaceholder: {
    height: 200, backgroundColor: '#f1f5f9',
    alignItems: 'center', justifyContent: 'center',
  },
  detailContent: { padding: 20, backgroundColor: '#ffffff' },
  detailHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 8 },
  detailName: { color: '#0f172a', fontSize: 22, fontWeight: '800', flex: 1, lineHeight: 28 },
  detailClose: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#f1f5f9',
    alignItems: 'center', justifyContent: 'center',
  },
  detailTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  detailLandBadge: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
    borderWidth: 1,
  },
  detailLandText: { fontSize: 10, fontFamily: mono, fontWeight: '800', letterSpacing: 0.5 },
  detailMeta: { flexDirection: 'row', gap: 16, marginBottom: 16, alignItems: 'center' },
  detailCost: { color: '#16a34a', fontSize: 14, fontFamily: mono, fontWeight: '800' },
  detailSiteCount: { color: '#64748b', fontSize: 13, fontFamily: mono },
  detailSection: { marginBottom: 20 },
  detailSectionTitle: {
    color: '#94a3b8', fontSize: 10, fontFamily: mono, fontWeight: '800',
    letterSpacing: 1.5, marginBottom: 10,
    borderBottomWidth: 1, borderColor: '#e2e8f0', paddingBottom: 6,
  },
  detailDesc: { color: '#374151', fontSize: 14, lineHeight: 22 },
  amenityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  amenityItem: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10,
    backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0',
    flexDirection: 'row', alignItems: 'center', gap: 5,
  },
  amenityText: { color: '#334155', fontSize: 12, fontWeight: '500' },
  siteTypeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  siteTypeText: { color: '#374151', fontSize: 13 },
  detailActivities: { color: '#64748b', fontSize: 12, lineHeight: 20 },
  detailActions: { gap: 10, marginTop: 8 },
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
  coordDms: { color: C.text3, fontSize: 11, fontFamily: mono, marginTop: 4 },
  coordCopy: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: C.orange },
  coordCopyText: { color: C.orange, fontSize: 9, fontFamily: mono, fontWeight: '700' },

  // ── AI insight
  aiStars: { color: C.yellow, fontSize: 14 },
  insiderTip: { backgroundColor: C.orange + '14', borderRadius: 10, borderWidth: 1, borderColor: C.orange + '44', padding: 12, marginBottom: 8 },
  insiderLabel: { color: C.orange, fontSize: 9, fontFamily: mono, fontWeight: '800', marginBottom: 4 },
  insiderText: { color: C.text, fontSize: 13, lineHeight: 19 },
  aiMeta: { color: C.text3, fontSize: 12, marginBottom: 3 },
  hazardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 6, backgroundColor: C.yellow + '14', borderRadius: 8, padding: 8 },
  hazardText: { color: C.yellow, fontSize: 12, flex: 1, lineHeight: 17 },
  nearbyItem: { color: C.text3, fontSize: 12, marginBottom: 3 },

  // ── Wikipedia
  wikiItem: { paddingVertical: 10, borderBottomWidth: 1, borderColor: C.s2 },
  wikiItemHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  wikiTitle: { color: '#3b82f6', fontSize: 13, fontWeight: '600', flex: 1 },
  wikiDist: { color: C.text3, fontSize: 10, fontFamily: mono },
  wikiExtract: { color: C.text3, fontSize: 11, lineHeight: 16 },

  // ── AI action buttons in panel
  aiActionsRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingBottom: 8 },
  aiActionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    flex: 1, paddingVertical: 8, borderRadius: 10,
    borderWidth: 1, borderColor: C.orange + '55',
    backgroundColor: C.orange + '0f', justifyContent: 'center',
  },
  aiActionText: { color: C.orange, fontSize: 10, fontFamily: mono, fontWeight: '700' },

  // ── Route card (search result card)
  routeCard: {
    padding: 12, borderTopWidth: 1, borderColor: '#3b82f6',
    backgroundColor: 'rgba(8,12,18,0.98)',
  },
  routeCardName: { color: C.text, fontSize: 12, fontWeight: '600', marginBottom: 4, lineHeight: 17 },
  routeCardDist: { color: C.text3, fontSize: 10, fontFamily: mono, marginBottom: 8 },
  routeCardActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  routeCardNav: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingVertical: 9, borderRadius: 10, backgroundColor: '#3b82f6',
  },
  routeCardNavText: { color: '#fff', fontSize: 11, fontFamily: mono, fontWeight: '700' },
  routeCardOpts: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 9, borderRadius: 10,
    borderWidth: 1, borderColor: C.border,
  },
  routeCardOptsText: { color: C.text2, fontSize: 10, fontFamily: mono },

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
  navSpeedLimit: {
    width: 44, height: 44, borderRadius: 22,
    borderWidth: 3, borderColor: '#ef4444',
    backgroundColor: OVR.bg, alignItems: 'center', justifyContent: 'center',
  },
  navSpeedLimitOver: { backgroundColor: '#ef444422' },
  navSpeedLimitTop: { color: '#ef4444', fontSize: 6, fontFamily: mono, fontWeight: '800', letterSpacing: 0.5 },
  navSpeedLimitVal: { color: OVR.text, fontSize: 16, fontWeight: '900', fontFamily: mono, lineHeight: 18 },

  // ── Waze-style quick report
  quickReportWrap: {
    position: 'absolute', bottom: 190, left: 12,
    alignItems: 'flex-start',
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
    paddingHorizontal: 14, paddingVertical: 9,
    borderWidth: 1, borderColor: OVR.border,
  },
  quickReportFabNav: {
    backgroundColor: '#1a2a1c', borderColor: OVR.border,
  },
  quickReportFabText: { color: OVR.text2, fontSize: 11, fontFamily: mono, fontWeight: '700' },
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
});
