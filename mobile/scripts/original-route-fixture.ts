import { createHash } from 'node:crypto';

import { validateOriginalManifest } from '../lib/originals/manifest';
import {
  ORIGINAL_ROUTE_VALIDATION_ENGINE_VERSION,
  runOriginalRouteValidation,
} from '../lib/originals/routeValidation';
import {
  createOriginalVirtualDriveLabState,
  tickOriginalVirtualDriveLab,
  updateOriginalVirtualDriveLabState,
} from '../lib/originals/virtualDriveLab';
import type { OriginalLocationSample, OriginalManifestV1 } from '../lib/originals/types';

export const ORIGINAL_ROUTE_FIXTURE_SCHEMA_VERSION = 1 as const;
export const ORIGINAL_ROUTE_FIXTURE_GENERATOR_VERSION = 'continuous-route-fixture-v1' as const;
export const ORIGINAL_ROUTE_FIXTURE_START_TIMESTAMP_MS = 1_800_000_000_000;
export const ORIGINAL_ROUTE_FIXTURE_INTERVAL_MS = 3_100;
export const ORIGINAL_ROUTE_FIXTURE_SPEED_MPS = 16.09344;

type FixtureSample = {
  lat: number;
  lng: number;
  accuracy_m: number;
  heading_deg: number | null;
  speed_mps: number;
  timestamp_ms: number;
  sequence: number;
  phase: 'route_start' | 'continuous' | 'route_end';
  expected_route_progress_m: number;
};

export type OriginalContinuousRouteFixtureV1 = Readonly<{
  schema_version: typeof ORIGINAL_ROUTE_FIXTURE_SCHEMA_VERSION;
  kind: 'trailhead_original_continuous_location_fixture';
  manifest: Readonly<{
    pack_id: string;
    version: number;
    manifest_id: string;
    sha256: string;
  }>;
  generator: Readonly<{
    version: typeof ORIGINAL_ROUTE_FIXTURE_GENERATOR_VERSION;
    trigger_engine_version: typeof ORIGINAL_ROUTE_VALIDATION_ENGINE_VERSION;
  }>;
  drive: Readonly<{
    speed_mps: number;
    interval_ms: number;
    accuracy_m: number;
    route_distance_m: number;
  }>;
  samples: readonly FixtureSample[];
}>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

export function originalManifestSha256(manifest: OriginalManifestV1) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(manifest)))
    .digest('hex');
}

function fixtureSample(
  sample: OriginalLocationSample,
  sequence: number,
  phase: FixtureSample['phase'],
  expectedRouteProgressM: number,
): FixtureSample {
  if (sample.accuracy_m == null || sample.speed_mps == null) {
    throw new Error(`Generated route fix ${sequence} is missing accuracy or speed.`);
  }
  return {
    lat: sample.lat,
    lng: sample.lng,
    accuracy_m: sample.accuracy_m,
    heading_deg: sample.heading_deg ?? null,
    speed_mps: sample.speed_mps,
    timestamp_ms: sample.timestamp_ms,
    sequence,
    phase,
    expected_route_progress_m: expectedRouteProgressM,
  };
}

export function buildOriginalContinuousRouteFixture(
  manifestInput: unknown,
  expected: { pack_id: string; version: number },
): OriginalContinuousRouteFixtureV1 {
  const manifest = validateOriginalManifest(manifestInput);
  if (manifest.pack_id !== expected.pack_id) {
    throw new Error(`Expected pack ${expected.pack_id}; manifest is ${manifest.pack_id}.`);
  }
  if (manifest.version !== expected.version) {
    throw new Error(`Expected version ${expected.version}; manifest is version ${manifest.version}.`);
  }
  const validation = runOriginalRouteValidation(manifest);
  if (!validation.passed) {
    const failed = validation.scenarios.filter(scenario => !scenario.passed).map(scenario => scenario.id);
    throw new Error(`The pinned manifest did not pass authoritative route validation: ${failed.join(', ')}`);
  }

  let state = createOriginalVirtualDriveLabState(manifest, {
    playing: true,
    speed_mps: 0,
    synthetic_timestamp_ms: ORIGINAL_ROUTE_FIXTURE_START_TIMESTAMP_MS,
  });
  const start = tickOriginalVirtualDriveLab(manifest, state, 100);
  if (!start.sample) throw new Error('Could not generate the route-start location fix.');
  state = updateOriginalVirtualDriveLabState(manifest, start.state, {
    playing: true,
    speed_mps: ORIGINAL_ROUTE_FIXTURE_SPEED_MPS,
  });

  const samples: FixtureSample[] = [fixtureSample(start.sample, 0, 'route_start', 0)];
  const maximumSamples = 50_000;
  while (state.playing && samples.length < maximumSamples) {
    const tick = tickOriginalVirtualDriveLab(manifest, state, ORIGINAL_ROUTE_FIXTURE_INTERVAL_MS);
    state = tick.state;
    if (!tick.sample) throw new Error('The virtual drive stopped without a location fix.');
    samples.push(fixtureSample(
      tick.sample,
      samples.length,
      state.playing ? 'continuous' : 'route_end',
      state.progress_m,
    ));
  }
  if (state.playing || samples.length >= maximumSamples) {
    throw new Error(`The route fixture exceeded ${maximumSamples.toLocaleString()} fixes.`);
  }
  if (samples.at(-1)?.phase !== 'route_end') throw new Error('The route fixture did not reach the authored endpoint.');

  const fixture: OriginalContinuousRouteFixtureV1 = {
    schema_version: ORIGINAL_ROUTE_FIXTURE_SCHEMA_VERSION,
    kind: 'trailhead_original_continuous_location_fixture',
    manifest: {
      pack_id: manifest.pack_id,
      version: manifest.version,
      manifest_id: manifest.manifest_id,
      sha256: originalManifestSha256(manifest),
    },
    generator: {
      version: ORIGINAL_ROUTE_FIXTURE_GENERATOR_VERSION,
      trigger_engine_version: ORIGINAL_ROUTE_VALIDATION_ENGINE_VERSION,
    },
    drive: {
      speed_mps: ORIGINAL_ROUTE_FIXTURE_SPEED_MPS,
      interval_ms: ORIGINAL_ROUTE_FIXTURE_INTERVAL_MS,
      accuracy_m: samples[0].accuracy_m,
      route_distance_m: manifest.route.distance_m,
    },
    samples,
  };
  verifyOriginalContinuousRouteFixture(fixture, manifest);
  return fixture;
}

export function verifyOriginalContinuousRouteFixture(
  fixtureInput: unknown,
  manifestInput: unknown,
) {
  const fixture = fixtureInput as OriginalContinuousRouteFixtureV1;
  const manifest = validateOriginalManifest(manifestInput);
  if (fixture?.schema_version !== ORIGINAL_ROUTE_FIXTURE_SCHEMA_VERSION) throw new Error('Unsupported route fixture schema.');
  if (fixture.kind !== 'trailhead_original_continuous_location_fixture') throw new Error('Unexpected route fixture kind.');
  if (fixture.manifest?.pack_id !== manifest.pack_id
    || fixture.manifest?.version !== manifest.version
    || fixture.manifest?.manifest_id !== manifest.manifest_id) {
    throw new Error('The route fixture is pinned to a different manifest.');
  }
  if (fixture.manifest.sha256 !== originalManifestSha256(manifest)) {
    throw new Error('The manifest hash no longer matches this route fixture.');
  }
  if (!Array.isArray(fixture.samples) || fixture.samples.length < 2) throw new Error('The route fixture has too few fixes.');
  const first = fixture.samples[0];
  const last = fixture.samples.at(-1)!;
  if (first.phase !== 'route_start' || first.expected_route_progress_m !== 0) throw new Error('The fixture does not start at route progress zero.');
  if (last.phase !== 'route_end' || Math.abs(last.expected_route_progress_m - manifest.route.distance_m) > 0.01) {
    throw new Error('The fixture does not end at the authored route distance.');
  }
  fixture.samples.forEach((sample, index) => {
    if (sample.sequence !== index) throw new Error(`Route fixture sequence is invalid at fix ${index}.`);
    if (![sample.lat, sample.lng, sample.accuracy_m, sample.speed_mps, sample.timestamp_ms, sample.expected_route_progress_m].every(Number.isFinite)) {
      throw new Error(`Route fixture fix ${index} contains a non-finite value.`);
    }
    if (index > 0 && sample.timestamp_ms <= fixture.samples[index - 1].timestamp_ms) {
      throw new Error(`Route fixture timestamps are not strictly increasing at fix ${index}.`);
    }
    if (index > 0 && sample.expected_route_progress_m < fixture.samples[index - 1].expected_route_progress_m) {
      throw new Error(`Route fixture progress regressed at fix ${index}.`);
    }
  });
  return {
    pack_id: manifest.pack_id,
    version: manifest.version,
    manifest_id: manifest.manifest_id,
    manifest_sha256: fixture.manifest.sha256,
    sample_count: fixture.samples.length,
    route_distance_m: manifest.route.distance_m,
  };
}
