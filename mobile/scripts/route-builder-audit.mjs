#!/usr/bin/env node
import https from 'node:https';
import http from 'node:http';

const API_BASE = process.env.TRAILHEAD_API_BASE || 'https://api.gettrailhead.app';
const FULL = process.env.TRAILHEAD_ROUTE_AUDIT_FULL === '1';
const REQUEST_TIMEOUT_MS = Number(process.env.TRAILHEAD_ROUTE_AUDIT_TIMEOUT_MS || 120000);

const CAMP_PREFS = {
  public: ['blm', 'usfs', 'dispersed', 'free', 'tent'],
  developed: ['tent', 'reservable', 'state', 'nps', 'usfs'],
  rv: ['rv', 'reservable'],
  private: ['private', 'farm', 'ranch', 'winery', 'glamping', 'private_camp'],
  any: [],
};

const BASE_ROUTES = [
  { id: 'moab-big-sur', name: 'Moab to Big Sur', region: 'ut,nv,ca', start: [38.5733, -109.5498], end: [36.2704, -121.8081], campMatrix: true, strictCampCoverage: true },
  { id: 'denver-moab', name: 'Denver to Moab', region: 'co,ut', start: [39.7392, -104.9903], end: [38.5733, -109.5498], campMatrix: true, strictCampCoverage: true },
  { id: 'sf-la', name: 'San Francisco to Los Angeles', region: 'ca', start: [37.7749, -122.4194], end: [34.0522, -118.2437], campMatrix: false },
  { id: 'seattle-banff', name: 'Seattle to Banff', region: 'wa,bc,ab,canada', start: [47.6062, -122.3321], end: [51.1784, -115.5708], campMatrix: true },
  { id: 'paris-chamonix', name: 'Paris to Chamonix', region: 'france,europe', start: [48.8566, 2.3522], end: [45.9237, 6.8694], campMatrix: true },
  { id: 'reykjavik-akureyri', name: 'Reykjavik to Akureyri', region: 'iceland,europe', start: [64.1466, -21.9426], end: [65.6835, -18.1105], campMatrix: true },
  { id: 'honolulu-big-sur', name: 'Honolulu to Big Sur unsupported', region: 'hi,ca', start: [21.3069, -157.8583], end: [36.2704, -121.8081], expectFailure: true },
];

const SMOKE_CASES = [
  { route: 'moab-big-sur', shape: 'one_way', style: 'wild', campPreference: 'public', cadence: 'nightly', reuse: 'different_each_night', days: 7, hours: 5 },
  { route: 'moab-big-sur', shape: 'one_way', style: 'wild', campPreference: 'private', cadence: 'nightly', reuse: 'different_each_night', days: 7, hours: 5 },
  { route: 'moab-big-sur', shape: 'one_way', style: 'wild', campPreference: 'any', cadence: 'nightly', reuse: 'different_each_night', days: 7, hours: 5 },
  { route: 'moab-big-sur', shape: 'there_and_back', style: 'wild', campPreference: 'private', cadence: 'nightly', reuse: 'same_camp_window', days: 7, hours: 5 },
  { route: 'moab-big-sur', shape: 'loop', style: 'balanced', campPreference: 'developed', cadence: 'alternate', reuse: 'same_camp_window', days: 5, hours: 5 },
  { route: 'denver-moab', shape: 'one_way', style: 'wild', campPreference: 'private', cadence: 'manual', reuse: 'manual', days: 5, hours: 4 },
  { route: 'seattle-banff', shape: 'one_way', style: 'balanced', campPreference: 'any', cadence: 'nightly', reuse: 'different_each_night', days: 5, hours: 6 },
  { route: 'paris-chamonix', shape: 'one_way', style: 'direct', campPreference: 'private', cadence: 'nightly', reuse: 'different_each_night', days: 3, hours: 6 },
  { route: 'reykjavik-akureyri', shape: 'one_way', style: 'balanced', campPreference: 'private', cadence: 'nightly', reuse: 'different_each_night', days: 5, hours: 5 },
  { route: 'reykjavik-akureyri', shape: 'there_and_back', style: 'balanced', campPreference: 'any', cadence: 'alternate', reuse: 'same_camp_window', days: 4, hours: 5 },
  { route: 'sf-la', shape: 'one_way', style: 'direct', campPreference: 'any', cadence: 'nightly', reuse: 'different_each_night', days: 3, hours: 6 },
  { route: 'honolulu-big-sur', shape: 'one_way', style: 'balanced', campPreference: 'any', cadence: 'nightly', reuse: 'different_each_night', days: 3, hours: 5 },
];

function fullCases() {
  const cases = [];
  const primary = ['moab-big-sur', 'denver-moab'];
  for (const route of primary) {
    for (const shape of ['one_way', 'loop', 'there_and_back']) {
      for (const style of ['direct', 'balanced', 'wild']) {
        for (const campPreference of ['public', 'developed', 'rv', 'private', 'any']) {
          for (const days of [3, 5, 7]) {
            cases.push({
              route,
              shape,
              style,
              campPreference,
              cadence: shape === 'loop' ? 'alternate' : 'nightly',
              reuse: shape === 'there_and_back' ? 'same_camp_window' : 'different_each_night',
              days,
              hours: days === 3 ? 7 : 5,
            });
          }
        }
      }
    }
  }
  for (const route of ['seattle-banff', 'paris-chamonix', 'reykjavik-akureyri']) {
    for (const style of ['direct', 'balanced', 'wild']) {
      for (const campPreference of ['developed', 'private', 'any']) {
        cases.push({ route, shape: 'one_way', style, campPreference, cadence: 'nightly', reuse: 'different_each_night', days: 5, hours: 6 });
      }
    }
  }
  cases.push(...SMOKE_CASES.filter(c => c.route === 'honolulu-big-sur'));
  return cases;
}

function postJson(path, body) {
  const url = new URL(`${API_BASE}${path}`);
  const payload = JSON.stringify(body);
  const transport = url.protocol === 'http:' ? http : https;
  return new Promise((resolve, reject) => {
    const req = transport.request({
      method: 'POST',
      hostname: url.hostname,
      path: `${url.pathname}${url.search}`,
      port: url.port || 443,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
      timeout: REQUEST_TIMEOUT_MS,
    }, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if ((res.statusCode || 500) >= 400) reject(new Error(`${res.statusCode}: ${JSON.stringify(parsed).slice(0, 240)}`));
          else resolve(parsed);
        } catch {
          reject(new Error(`Invalid JSON from ${path}: ${raw.slice(0, 160)}`));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`Timeout calling ${path}`)));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function decodePolyline6(shape) {
  const coords = [];
  let i = 0, lat = 0, lng = 0;
  while (i < shape.length) {
    for (let axis = 0; axis < 2; axis += 1) {
      let shift = 0, result = 0, byte = 0;
      do {
        byte = shape.charCodeAt(i) - 63;
        i += 1;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20 && i <= shape.length);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta;
      else lng += delta;
    }
    coords.push({ lat: lat / 1e6, lng: lng / 1e6 });
  }
  return coords;
}

function haversineMi(a, b) {
  const r = 3958.8;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function scenicPoint(from, to, progress, offsetMi) {
  const t = Math.max(0, Math.min(1, progress));
  const base = { lat: from.lat + (to.lat - from.lat) * t, lng: from.lng + (to.lng - from.lng) * t };
  const avgLat = ((from.lat + to.lat) / 2) * Math.PI / 180;
  const milesPerLng = Math.max(8, 69 * Math.cos(avgLat));
  const dx = (to.lng - from.lng) * milesPerLng;
  const dy = (to.lat - from.lat) * 69;
  const len = Math.hypot(dx, dy);
  if (!len || !offsetMi) return base;
  const bow = Math.sin(Math.PI * t) * offsetMi;
  return { lat: base.lat + (dx / len * bow) / 69, lng: base.lng + (-dy / len * bow) / milesPerLng };
}

function routeLocations(base, shape) {
  const start = { lat: base.start[0], lng: base.start[1] };
  const end = { lat: base.end[0], lng: base.end[1] };
  const directMi = haversineMi(start, end);
  const offset = Math.max(22, Math.min(120, directMi * 0.14));
  if (shape === 'loop') {
    return [
      { lat: start.lat, lon: start.lng, type: 'break' },
      { ...scenicPoint(start, end, 0.48, offset), type: 'through' },
      { lat: end.lat, lon: end.lng, type: 'break' },
      { ...scenicPoint(end, start, 0.48, offset), type: 'through' },
      { lat: start.lat, lon: start.lng, type: 'break' },
    ].map(p => ({ lat: p.lat, lon: p.lon ?? p.lng, type: p.type }));
  }
  if (shape === 'there_and_back') {
    return [
      { lat: start.lat, lon: start.lng, type: 'break' },
      { lat: end.lat, lon: end.lng, type: 'break' },
      { lat: start.lat, lon: start.lng, type: 'break' },
    ];
  }
  return [
    { lat: start.lat, lon: start.lng, type: 'break' },
    { lat: end.lat, lon: end.lng, type: 'break' },
  ];
}

function downsample(points, target = 700) {
  if (points.length <= target) return points;
  const step = Math.max(1, Math.floor(points.length / target));
  const out = points.filter((_, idx) => idx % step === 0);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

function campWindows(days, cadence, miles) {
  const required = [];
  for (let day = 1; day <= days; day += 1) {
    if (cadence === 'alternate') {
      const start = Math.floor((day - 1) / 2) * 2 + 1;
      const end = Math.min(start + 1, days);
      if (day !== end) continue;
      required.push({ day, start, end, label: start === end ? `Day ${start}` : `Days ${start}-${end}` });
    } else {
      required.push({ day, start: day, end: day, label: `Day ${day}` });
    }
  }
  return required.map(win => ({
    ...win,
    target_mi: miles * (win.day / days),
    search_window_mi: Math.max(40, Math.min(90, miles / Math.max(2, days) * 0.65)),
  }));
}

const routeCache = new Map();

async function getRoute(base, item) {
  const key = `${base.id}:${item.shape}:${item.style}`;
  if (routeCache.has(key)) return routeCache.get(key);
  const wild = item.style === 'wild';
  const route = await postJson('/api/route', {
    locations: routeLocations(base, item.shape),
    options: { backRoads: wild, avoidHighways: wild, avoidTolls: true, noFerries: false },
    units: 'miles',
  });
  routeCache.set(key, route);
  return route;
}

function evaluateCampWindows(item, windows, base) {
  const required = windows.length;
  const usable = windows.filter(win => win.camp || win.selected || (win.candidates || []).length > 0).length;
  const reviewable = windows.filter(win => win.camp || win.selected || (win.candidates || []).length > 0 || win.fallback).length;
  const strong = windows.filter(win => win.strong || win.confidence === 'strong').length;
  const review = windows.filter(win => win.confidence === 'review' || (!win.strong && (win.camp || win.selected || (win.candidates || []).length > 0))).length;
  const missing = required - usable;
  const sparse = required - reviewable;
  const issues = [];
  const warnings = [];
  const minimumUsable = Math.max(1, Math.ceil(required * 0.7));
  if (base.strictCampCoverage && usable < minimumUsable) {
    issues.push(`${item.campPreference} usable ${usable}/${required}`);
  } else if (usable < required) {
    warnings.push(`${item.campPreference} review needed ${missing}/${required}`);
  }
  if (sparse > 0) issues.push(`missing review fallback ${sparse}/${required}`);
  return { required, usable, reviewable, strong, review, missing, issues, warnings };
}

async function runCase(item) {
  const base = BASE_ROUTES.find(route => route.id === item.route);
  if (!base) throw new Error(`Unknown route ${item.route}`);
  const route = await getRoute(base, item);
  const trip = route.trip || {};
  const summary = trip.summary || {};
  const legs = trip.legs || [];
  const report = {
    name: base.name,
    shape: item.shape,
    style: item.style,
    campPreference: item.campPreference,
    cadence: item.cadence,
    reuse: item.reuse,
    days: item.days,
    hours: item.hours,
    engine: route._trailhead?.engine,
    cache: route._trailhead?.cache,
    valhalla_error: route._trailhead?.valhalla_error ? String(route._trailhead.valhalla_error).slice(0, 80) : undefined,
    miles: Math.round((summary.length || 0) * 10) / 10,
    route_hours: Math.round(((summary.time || 0) / 3600) * 100) / 100,
    legs: legs.length,
    shape_chars: legs.reduce((sum, leg) => sum + String(leg.shape || '').length, 0),
    issues: [],
  };
  if (base.expectFailure) {
    report.expectedFailure = true;
    return report;
  }
  if (legs.length === 0 || report.shape_chars < 100) report.issues.push('missing provider geometry');
  if (!base.campMatrix) return report;
  const points = downsample(legs.flatMap(leg => decodePolyline6(leg.shape || '')));
  const windows = campWindows(item.days, item.cadence, report.miles);
  const result = await postJson('/api/route/camp-windows', {
    route: points,
    windows,
    camp_filters: CAMP_PREFS[item.campPreference] || [],
    route_style: item.style,
    camp_preference: item.campPreference,
    region_hint: base.region,
    camp_reuse_policy: item.reuse,
    max_daily_drive_hours: item.hours,
    max_radius: item.campPreference === 'any' || item.campPreference === 'private' ? 115 : 100,
  });
  const campEval = evaluateCampWindows(item, result.windows || [], base);
  report.camps = campEval;
  report.camp_days = (result.windows || []).map(win => ({
    day: win.day,
    found: win.found ?? (win.candidates || []).length,
    confidence: win.confidence || (win.strong ? 'strong' : win.camp ? 'review' : 'missing'),
    coverage: win.coverage_status || null,
    camp: win.selected?.name || win.camp?.name || win.candidates?.[0]?.name || null,
    fallback: win.fallback?.name || null,
    passes: (win.search_passes || []).map(pass => `${pass.name}${pass.target_only ? '*' : ''}:${pass.kept ?? pass.found}`).join(','),
  }));
  report.issues.push(...campEval.issues);
  if (campEval.warnings.length) report.warnings = campEval.warnings;
  return report;
}

const cases = FULL ? fullCases() : SMOKE_CASES;
let failures = 0;
for (const item of cases) {
  try {
    const report = await runCase(item);
    if (report.issues?.length) failures += 1;
    console.log(JSON.stringify(report));
  } catch (err) {
    const base = BASE_ROUTES.find(route => route.id === item.route);
    const expected = Boolean(base?.expectFailure);
    if (!expected) failures += 1;
    console.log(JSON.stringify({ name: base?.name || item.route, shape: item.shape, style: item.style, error: err instanceof Error ? err.message : String(err), expected }));
  }
}
if (failures > 0) {
  console.error(`Route Builder audit failed ${failures}/${cases.length} cases`);
  process.exit(1);
}
console.error(`Route Builder audit passed ${cases.length} cases`);
