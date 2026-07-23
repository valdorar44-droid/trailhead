import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  buildFireOverlayRequest,
  FIRE_OVERLAY_CAUTION_COLOR,
  FIRE_OVERLAY_CURRENT_COLOR,
  FIRE_OVERLAY_UNAVAILABLE_STATUS,
  fireOverlayGeometryStyle,
  fireOverlayStatusColor,
  fireOverlayStatusFromPayload,
  fireOverlayStatusLabel,
  isValidFireOverlayViewport,
  loadFireOverlayViewport,
  MAX_FIRE_OVERLAY_FEATURES,
  MAX_FIRE_FEATURE_VERTICES,
  normalizeFireOverlayPayload,
} from '../fireOverlay';

const viewport = { n: 39, s: 38, e: -108, w: -110 };

test('fire overlay requires an ordered finite viewport', () => {
  assert.equal(isValidFireOverlayViewport(viewport), true);
  assert.equal(isValidFireOverlayViewport({ ...viewport, n: 37 }), false);
  assert.equal(isValidFireOverlayViewport({ ...viewport, e: Number.NaN }), false);
  assert.equal(isValidFireOverlayViewport({ ...viewport, e: -179, w: 179 }), true);
});

test('fire overlay keeps viewport coordinates out of the request URL', () => {
  const request = buildFireOverlayRequest('https://api.example.test', viewport);
  assert.equal(request.url, 'https://api.example.test/api/conditions/fire-perimeters/query');
  assert.equal(request.init.method, 'POST');
  assert.equal(request.url.includes('-110'), false);
  assert.deepEqual(JSON.parse(String(request.init.body)), viewport);
});

test('shared fire overlay loader posts the viewport and returns normalized stale status and style', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const result = await loadFireOverlayViewport('https://api.example.test', viewport, {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 0]]] },
            properties: {},
          }],
          metadata: { availability: 'degraded', freshness: 'stale', age_seconds: 900 },
        }),
      };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.example.test/api/conditions/fire-perimeters/query');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), viewport);
  assert.equal(result.payload.features.length, 1);
  assert.equal(result.status.kind, 'stale');
  assert.equal(result.style.fillColor, FIRE_OVERLAY_CAUTION_COLOR);
  assert.equal(result.style.lineColor, FIRE_OVERLAY_CAUTION_COLOR);
});

test('shared fire overlay loader rejects non-success and malformed responses', async () => {
  let errorJsonRead = false;
  await assert.rejects(
    loadFireOverlayViewport('https://api.example.test', viewport, {
      fetchImpl: async () => ({
        ok: false,
        status: 503,
        json: async () => {
          errorJsonRead = true;
          return { type: 'FeatureCollection', features: [] };
        },
      }),
    }),
    /failed \(503\)/,
  );
  assert.equal(errorJsonRead, false);
  await assert.rejects(
    loadFireOverlayViewport('https://api.example.test', viewport, {
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ features: 'bad' }) }),
    }),
    /response was invalid/,
  );
});

test('fire overlay caps features before they cross into the map source', () => {
  const payload = {
    type: 'FeatureCollection',
    features: Array.from({ length: MAX_FIRE_OVERLAY_FEATURES + 5 }, (_, index) => ({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[[index, index], [index + 1, index], [index, index]]] },
      properties: {},
    })),
  };
  assert.equal(normalizeFireOverlayPayload(payload)?.features.length, MAX_FIRE_OVERLAY_FEATURES);
  assert.equal(normalizeFireOverlayPayload({ features: 'bad' }), null);
});

test('fire overlay rejects unsupported, malformed, and oversized geometry', () => {
  const oversizedRing = Array.from({ length: MAX_FIRE_FEATURE_VERTICES + 1 }, (_, index) => [index / 100, index / 100]);
  const payload = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} },
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[['bad', 0]]] }, properties: {} },
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: [oversizedRing] }, properties: {} },
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 0]]] }, properties: {} },
    ],
  };
  const normalized = normalizeFireOverlayPayload(payload);
  assert.equal(normalized?.features.length, 1);
  assert.equal(normalized?.features[0].geometry.type, 'Polygon');
});

test('fire overlay preserves only bounded availability metadata', () => {
  const normalized = normalizeFireOverlayPayload({
    type: 'FeatureCollection',
    features: [],
    metadata: {
      availability: 'degraded',
      freshness: 'stale',
      age_seconds: 1200.8,
      availability_reason: 'provider_unavailable',
      raw_provider_message: 'not for the client',
    },
  });
  assert.deepEqual(normalized?.metadata, {
    availability: 'degraded',
    freshness: 'stale',
    age_seconds: 1200,
  });
});

test('fire overlay distinguishes mapped data from a checked empty viewport', () => {
  const mapped = normalizeFireOverlayPayload({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 0]]] }, properties: {} },
    ],
    metadata: { availability: 'available', freshness: 'fresh', age_seconds: 125 },
  });
  const empty = normalizeFireOverlayPayload({
    type: 'FeatureCollection',
    features: [],
    metadata: { availability: 'available', freshness: 'fresh', age_seconds: 15 },
  });
  assert.ok(mapped);
  assert.ok(empty);
  assert.deepEqual(fireOverlayStatusFromPayload(mapped), {
    kind: 'fresh',
    featureCount: 1,
    ageSeconds: 125,
  });
  assert.deepEqual(fireOverlayStatusFromPayload(empty), {
    kind: 'fresh_empty',
    featureCount: 0,
    ageSeconds: 15,
  });
  assert.equal(fireOverlayStatusLabel(fireOverlayStatusFromPayload(mapped)), 'Interagency data · 1 mapped · 2 min ago');
  assert.equal(fireOverlayStatusLabel(fireOverlayStatusFromPayload(empty)), 'No mapped perimeters here · checked just now');
  assert.equal(fireOverlayStatusColor(fireOverlayStatusFromPayload(mapped)), FIRE_OVERLAY_CURRENT_COLOR);
  assert.equal(fireOverlayStatusColor(fireOverlayStatusFromPayload(empty)), FIRE_OVERLAY_CURRENT_COLOR);
});

test('fire overlay keeps full stale fallback geometry and labels it stale', () => {
  const stale = normalizeFireOverlayPayload({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 0]]] }, properties: {} },
    ],
    metadata: { availability: 'degraded', freshness: 'stale', age_seconds: 7_560, partial: false },
  });
  assert.ok(stale);
  assert.equal(stale.features.length, 1);
  assert.deepEqual(fireOverlayStatusFromPayload(stale), {
    kind: 'stale',
    featureCount: 1,
    ageSeconds: 7_560,
  });
  assert.equal(fireOverlayStatusLabel(fireOverlayStatusFromPayload(stale)), 'Stale interagency data · 2 hr ago');
  assert.equal(fireOverlayStatusColor(fireOverlayStatusFromPayload(stale)), FIRE_OVERLAY_CAUTION_COLOR);
});

test('fire overlay treats degraded partial coverage as partial, not stale', () => {
  const degradedPartial = normalizeFireOverlayPayload({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 0]]] }, properties: {} },
    ],
    metadata: {
      availability: 'degraded',
      freshness: 'fresh',
      age_seconds: 90,
      partial: true,
      partial_reasons: ['cell_fetch_failure'],
    },
  });
  assert.ok(degradedPartial);
  const status = fireOverlayStatusFromPayload(degradedPartial);
  assert.deepEqual(status, {
    kind: 'partial',
    featureCount: 1,
    ageSeconds: 90,
    partialReasons: ['cell_fetch_failure'],
  });
  assert.equal(
    fireOverlayStatusLabel(status),
    'Partial interagency data · coverage incomplete · some areas unavailable · checked 1 min ago',
  );
  assert.equal(fireOverlayStatusLabel(status).includes('Stale'), false);
  assert.equal(fireOverlayStatusColor(status), FIRE_OVERLAY_CAUTION_COLOR);
});

test('fire overlay treats partial freshness as incomplete even without partial flags', () => {
  const partialFreshness = normalizeFireOverlayPayload({
    type: 'FeatureCollection',
    features: [],
    metadata: { availability: 'available', freshness: 'partial', age_seconds: 30 },
  });
  assert.ok(partialFreshness);
  const status = fireOverlayStatusFromPayload(partialFreshness);
  assert.deepEqual(status, {
    kind: 'partial',
    featureCount: 0,
    ageSeconds: 30,
  });
  assert.equal(fireOverlayStatusColor(status), FIRE_OVERLAY_CAUTION_COLOR);
});

test('fire overlay does not confuse degraded availability with incomplete fresh data', () => {
  const degradedFresh = normalizeFireOverlayPayload({
    type: 'FeatureCollection',
    features: [],
    metadata: { availability: 'degraded', freshness: 'fresh', age_seconds: 12 },
  });
  assert.ok(degradedFresh);
  const status = fireOverlayStatusFromPayload(degradedFresh);
  assert.deepEqual(status, {
    kind: 'fresh_empty',
    featureCount: 0,
    ageSeconds: 12,
  });
  assert.equal(
    fireOverlayStatusLabel(status),
    'No mapped perimeters here · checked just now',
  );
  assert.equal(fireOverlayStatusColor(status), FIRE_OVERLAY_CURRENT_COLOR);
});

test('server-produced availability, freshness, and completeness combinations stay independent', () => {
  const cases = [
    {
      name: 'complete stale fallback',
      metadata: { availability: 'degraded', freshness: 'stale', age_seconds: 1_200, partial: false },
      expectedKind: 'stale',
    },
    {
      name: 'current missing coverage',
      metadata: {
        availability: 'degraded',
        freshness: 'fresh',
        age_seconds: 20,
        partial: true,
        partial_reasons: ['cell_fetch_failure'],
      },
      expectedKind: 'partial',
    },
    {
      name: 'stale missing coverage',
      metadata: {
        availability: 'degraded',
        freshness: 'stale',
        age_seconds: 1_200,
        partial: true,
        partial_reasons: ['provider_limit'],
      },
      expectedKind: 'stale_partial',
    },
  ] as const;

  for (const testCase of cases) {
    const payload = normalizeFireOverlayPayload({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 0]]] },
        properties: { id: testCase.name },
      }],
      metadata: testCase.metadata,
    });
    assert.ok(payload, testCase.name);
    const status = fireOverlayStatusFromPayload(payload);
    assert.equal(status.kind, testCase.expectedKind, testCase.name);
    assert.equal(fireOverlayStatusColor(status), FIRE_OVERLAY_CAUTION_COLOR, testCase.name);
    assert.equal(fireOverlayGeometryStyle(status).lineColor, FIRE_OVERLAY_CAUTION_COLOR, testCase.name);
    assert.equal(fireOverlayGeometryStyle(status).fillColor, FIRE_OVERLAY_CAUTION_COLOR, testCase.name);
  }
});

test('current perimeter geometry uses the same red status color as the layer card', () => {
  const status = { kind: 'fresh', featureCount: 1, ageSeconds: 10 } as const;
  const style = fireOverlayGeometryStyle(status);
  assert.equal(style.fillColor, FIRE_OVERLAY_CURRENT_COLOR);
  assert.equal(style.lineColor, FIRE_OVERLAY_CURRENT_COLOR);
  assert.equal(style.lineColor, fireOverlayStatusColor(status));
});

test('NativeMap binds perimeter fill and line colors to the derived fire status', () => {
  const nativeMapSource = readFileSync(
    resolve(process.cwd(), 'components/NativeMap/index.tsx'),
    'utf8',
  );
  assert.match(nativeMapSource, /fireOverlayGeometryStyle\(fireStatus\)/);
  assert.match(nativeMapSource, /fillColor:\s*fireGeometryStyle\.fillColor/);
  assert.match(nativeMapSource, /lineColor:\s*fireGeometryStyle\.lineColor/);
  assert.doesNotMatch(nativeMapSource, /id="fire-line"[\s\S]{0,180}lineColor:\s*['"]#ef4444['"]/);
});

test('WebView recovery map uses the shared viewport loader and preserves honest status and geometry', () => {
  const mapSource = readFileSync(
    resolve(process.cwd(), 'app/(tabs)/map.tsx'),
    'utf8',
  );
  assert.doesNotMatch(mapSource, /fetch\(apiBase\+'\/api\/conditions\/fire-perimeters'/);
  assert.match(mapSource, /type:'fire_overlay_request',request_id:\+\+_fireRequestSeq/);
  assert.match(mapSource, /loadFireOverlayViewport\(API_BASE_URL, viewport, \{ signal: controller\.signal \}\)/);
  assert.match(mapSource, /setFireOverlayStatus\(result\.status\)/);
  assert.match(mapSource, /type: 'fire_overlay_error'[\s\S]{0,220}FIRE_OVERLAY_UNAVAILABLE_STATUS/);
  assert.match(mapSource, /if\(msg\.payload&&msg\.payload\.type==='FeatureCollection'[\s\S]{0,180}_fireLastData=msg\.payload/);
  assert.match(mapSource, /map\.setPaintProperty\('fires-fill','fill-color',style\.fillColor\)/);
  assert.match(mapSource, /map\.setPaintProperty\('fires-line','line-color',style\.lineColor\)/);
  assert.match(mapSource, /if \(layerFire\) postWebMessage\(JSON\.stringify\(\{ type: 'set_layer', layer: 'fire', show: true \}\)\)/);
});

test('fire overlay treats a zero-feature truncated response as partial', () => {
  const truncated = normalizeFireOverlayPayload({
    type: 'FeatureCollection',
    features: [],
    metadata: {
      availability: 'available',
      freshness: 'fresh',
      age_seconds: 8,
      truncated: true,
      partial: true,
      partial_reasons: ['invalid_geometry', 'not_safe_for_clients'],
      dropped_feature_count: 3,
      dropped: { invalid_geometry: 3 },
    },
  });
  assert.ok(truncated);
  assert.deepEqual(truncated.metadata, {
    availability: 'available',
    freshness: 'fresh',
    age_seconds: 8,
    partial: true,
    truncated: true,
    partial_reasons: ['invalid_geometry'],
    dropped_feature_count: 3,
  });
  assert.deepEqual(fireOverlayStatusFromPayload(truncated), {
    kind: 'partial',
    featureCount: 0,
    ageSeconds: 8,
    omittedFeatureCount: 3,
    partialReasons: ['invalid_geometry'],
  });
  assert.equal(
    fireOverlayStatusLabel(fireOverlayStatusFromPayload(truncated)),
    'Partial interagency data · 3 perimeters omitted · unsupported perimeter geometry · checked just now',
  );
});

test('fire overlay marks client-filtered geometry partial even when provider metadata says fresh', () => {
  const filtered = normalizeFireOverlayPayload({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} },
    ],
    metadata: { availability: 'available', freshness: 'fresh', age_seconds: 0 },
  });
  assert.ok(filtered);
  assert.equal(filtered.features.length, 0);
  assert.deepEqual(fireOverlayStatusFromPayload(filtered), {
    kind: 'partial',
    featureCount: 0,
    ageSeconds: 0,
    omittedFeatureCount: 1,
    partialReasons: ['client_geometry_filter'],
  });
});

test('fire overlay preserves stale and partial semantics together', () => {
  const stalePartial = normalizeFireOverlayPayload({
    type: 'FeatureCollection',
    features: [],
    metadata: {
      availability: 'degraded',
      freshness: 'stale',
      age_seconds: 1_800,
      partial: true,
      partial_reasons: ['provider_limit'],
    },
  });
  assert.ok(stalePartial);
  assert.deepEqual(fireOverlayStatusFromPayload(stalePartial), {
    kind: 'stale_partial',
    featureCount: 0,
    ageSeconds: 1_800,
    partialReasons: ['provider_limit'],
  });
  assert.equal(
    fireOverlayStatusLabel(fireOverlayStatusFromPayload(stalePartial)),
    'Stale, partial interagency data · coverage incomplete · source limit · 30 min ago',
  );
});

test('fire overlay preserves a bounded omission count and safe reasons for stale partial data', () => {
  const stalePartial = normalizeFireOverlayPayload({
    type: 'FeatureCollection',
    features: [],
    metadata: {
      availability: 'degraded',
      freshness: 'stale',
      age_seconds: 3_600,
      partial: true,
      partial_reasons: ['cell_fetch_failure', 'stale_cell', 'raw_provider_error'],
      dropped_feature_count: 7,
    },
  });
  assert.ok(stalePartial);
  assert.deepEqual(fireOverlayStatusFromPayload(stalePartial), {
    kind: 'stale_partial',
    featureCount: 0,
    ageSeconds: 3_600,
    omittedFeatureCount: 7,
    partialReasons: ['cell_fetch_failure', 'stale_cell'],
  });
  assert.equal(
    fireOverlayStatusLabel(fireOverlayStatusFromPayload(stalePartial)),
    'Stale, partial interagency data · 7 perimeters omitted · some areas unavailable, some areas older · 1 hr ago',
  );
});

test('fire overlay presents provider failure as unavailable, never as an empty current result', () => {
  assert.equal(FIRE_OVERLAY_UNAVAILABLE_STATUS.kind, 'unavailable');
  assert.equal(fireOverlayStatusLabel(FIRE_OVERLAY_UNAVAILABLE_STATUS), 'Interagency fire data unavailable');
  assert.notEqual(fireOverlayStatusLabel(FIRE_OVERLAY_UNAVAILABLE_STATUS), fireOverlayStatusLabel({
    kind: 'fresh_empty',
    featureCount: 0,
    ageSeconds: 0,
  }));
});

test('fire overlay does not call an unversioned empty payload current', () => {
  const legacyEmpty = normalizeFireOverlayPayload({ type: 'FeatureCollection', features: [] });
  assert.ok(legacyEmpty);
  assert.deepEqual(fireOverlayStatusFromPayload(legacyEmpty), {
    kind: 'partial',
    featureCount: 0,
  });
  assert.equal(fireOverlayStatusLabel(fireOverlayStatusFromPayload(legacyEmpty)), 'Partial interagency data · coverage incomplete · update time unavailable');
});
