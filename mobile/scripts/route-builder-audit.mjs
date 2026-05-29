#!/usr/bin/env node
import https from 'node:https';

const API_BASE = process.env.TRAILHEAD_API_BASE || 'https://api.gettrailhead.app';

const cases = [
  { name: 'Moab to Big Sur wild', style: 'wild', locations: [[38.5733, -109.5498], [36.2704, -121.8081]], camps: true },
  { name: 'Moab to Big Sur there-back wild', style: 'wild', locations: [[38.5733, -109.5498], [36.2704, -121.8081], [38.5733, -109.5498]], camps: true },
  { name: 'San Francisco to Los Angeles', style: 'balanced', locations: [[37.7749, -122.4194], [34.0522, -118.2437]] },
  { name: 'Denver to Moab wild', style: 'wild', locations: [[39.7392, -104.9903], [38.5733, -109.5498]] },
  { name: 'Seattle to Banff', style: 'balanced', locations: [[47.6062, -122.3321], [51.1784, -115.5708]] },
  { name: 'Reykjavik to Akureyri', style: 'balanced', locations: [[64.1466, -21.9426], [65.6835, -18.1105]] },
  { name: 'Paris to Chamonix', style: 'balanced', locations: [[48.8566, 2.3522], [45.9237, 6.8694]] },
  { name: 'Tokyo to Kyoto', style: 'balanced', locations: [[35.6762, 139.6503], [35.0116, 135.7681]] },
  { name: 'Sydney to Melbourne', style: 'balanced', locations: [[-33.8688, 151.2093], [-37.8136, 144.9631]] },
  { name: 'Honolulu to Big Sur unsupported', style: 'balanced', locations: [[21.3069, -157.8583], [36.2704, -121.8081]], expectFailure: true },
];

function postJson(path, body) {
  const url = new URL(`${API_BASE}${path}`);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request({
      method: 'POST',
      hostname: url.hostname,
      path: `${url.pathname}${url.search}`,
      port: url.port || 443,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
      },
      timeout: 45000,
    }, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if ((res.statusCode || 500) >= 400) {
            reject(new Error(`${res.statusCode}: ${JSON.stringify(parsed).slice(0, 240)}`));
          } else {
            resolve(parsed);
          }
        } catch (err) {
          reject(new Error(`Invalid JSON from ${path}: ${raw.slice(0, 160)}`));
        }
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error(`Timeout calling ${path}`));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function decodePolyline6(shape) {
  const coords = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  while (i < shape.length) {
    for (let axis = 0; axis < 2; axis += 1) {
      let shift = 0;
      let result = 0;
      let byte = 0;
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

function downsample(points, target = 700) {
  if (points.length <= target) return points;
  const step = Math.max(1, Math.floor(points.length / target));
  const out = points.filter((_, idx) => idx % step === 0);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

async function runCase(item) {
  const locations = item.locations.map(([lat, lon]) => ({ lat, lon }));
  const wild = item.style === 'wild';
  const route = await postJson('/api/route', {
    locations,
    options: { backRoads: wild, avoidHighways: wild, avoidTolls: true, noFerries: false },
    units: 'miles',
  });
  const trip = route.trip || {};
  const summary = trip.summary || {};
  const legs = trip.legs || [];
  const report = {
    name: item.name,
    style: item.style,
    engine: route._trailhead?.engine,
    cache: route._trailhead?.cache,
    valhalla_error: route._trailhead?.valhalla_error ? String(route._trailhead.valhalla_error).slice(0, 80) : undefined,
    miles: Math.round((summary.length || 0) * 10) / 10,
    hours: Math.round(((summary.time || 0) / 3600) * 100) / 100,
    legs: legs.length,
    shape_chars: legs.reduce((sum, leg) => sum + String(leg.shape || '').length, 0),
  };
  if (item.camps && legs.length) {
    const points = downsample(legs.flatMap(leg => decodePolyline6(leg.shape || '')));
    const days = 7;
    const windows = Array.from({ length: days }, (_, idx) => ({
      day: idx + 1,
      start: idx + 1,
      end: idx + 1,
      label: `Day ${idx + 1}`,
      target_mi: (summary.length || 0) * ((idx + 1) / days),
      search_window_mi: 70,
    }));
    const publicResult = await postJson('/api/route/camp-windows', {
      route: points,
      windows,
      camp_filters: ['public', 'dispersed'],
      route_style: item.style,
      camp_preference: 'public',
      region_hint: 'ut,nv,ca',
      camp_reuse_policy: item.name.includes('there-back') ? 'same_camp_window' : 'different_each_night',
      max_daily_drive_hours: 5,
      max_radius: 58,
    });
    const anyResult = await postJson('/api/route/camp-windows', {
      route: points,
      windows,
      camp_filters: [],
      route_style: item.style,
      camp_preference: 'any',
      region_hint: 'ut,nv,ca',
      camp_reuse_policy: item.name.includes('there-back') ? 'same_camp_window' : 'different_each_night',
      max_daily_drive_hours: 5,
      max_radius: 75,
    });
    report.camps_public = publicResult.windows.map(win => ({ day: win.day, found: win.found, strong: win.strong, camp: win.camp?.name || null }));
    report.camps_any = anyResult.windows.map(win => ({ day: win.day, found: win.found, strong: win.strong, camp: win.camp?.name || null }));
  }
  return report;
}

for (const item of cases) {
  try {
    console.log(JSON.stringify(await runCase(item)));
  } catch (err) {
    console.log(JSON.stringify({ name: item.name, error: err instanceof Error ? err.message : String(err), expected: item.expectFailure || undefined }));
  }
}
