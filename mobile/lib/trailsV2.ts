import type { TrailDiscoveryItemV2, TrailSystemV2 } from './api';
import type { TrailFeature, TrailFeatureType, TrailSupport } from './trailEngine';

function kindToFeatureType(kind: string): TrailFeatureType {
  if (kind === 'trailhead' || kind === 'viewpoint' || kind === 'peak' || kind === 'hot_spring' || kind === 'road') return kind;
  return 'trail';
}

function compactFacts(item: TrailDiscoveryItemV2): string {
  const values: string[] = [];
  const { facts } = item;
  if (facts.distance_mi != null && Number.isFinite(facts.distance_mi)) {
    const distance = facts.distance_mi >= 10 ? Math.round(facts.distance_mi) : Number(facts.distance_mi.toFixed(1));
    values.push(`${distance} mi`);
  }
  if (facts.route_shape) values.push(facts.route_shape);
  if (facts.difficulty) values.push(facts.difficulty);
  if (item.activities[0]) values.push(item.activities[0]);
  return values.slice(0, 3).join(' · ');
}

export function trailDiscoveryItemToFeature(item: TrailDiscoveryItemV2, support: TrailSupport): TrailFeature {
  const source = item.sources[0]?.label || 'Trailhead';
  return {
    id: item.id,
    name: item.name,
    lat: item.center.lat,
    lng: item.center.lng,
    type: kindToFeatureType(item.kind),
    source: 'trailhead',
    subtitle: compactFacts(item) || source,
    score: item.geometry_status === 'complete' ? 120 : item.geometry_status === 'partial' ? 70 : 35,
    support,
    profile_id: item.primary_trail_id,
    system_v2_id: item.id,
    geometry_status: item.geometry_status,
    geometry_revision: item.geometry_revision,
    capabilities_v2: item.capabilities,
    facts_v2: item.facts,
    trailheads_v2: item.trailheads,
    source_label: source,
    photo_url: item.media[0]?.url ?? null,
    length_mi: item.facts.distance_mi,
    activities: item.activities,
    last_checked: item.freshness.checked_at,
    summary: item.summary,
    difficulty: item.facts.difficulty,
    surface: item.facts.surface,
    open_status: 'unknown',
    vehicle_fit: 'unknown',
  };
}

export function trailSystemGeometry(system: TrailSystemV2): GeoJSON.FeatureCollection | null {
  if (system.geometry_status !== 'complete' || !system.capabilities.highlight) return null;
  if (!system.geometry || system.geometry.type !== 'FeatureCollection' || !system.geometry.features.length) return null;
  return system.geometry;
}

export function trailSelectionMatches(feature: TrailFeature, system: TrailSystemV2): boolean {
  return feature.system_v2_id === system.id && feature.geometry_revision === system.geometry_revision;
}

export function hydrateTrailFeatureFromSystem(feature: TrailFeature, system: TrailSystemV2): TrailFeature {
  if (feature.system_v2_id !== system.id) return feature;
  return {
    ...feature,
    name: system.name || feature.name,
    geometry_status: system.geometry_status,
    geometry_revision: system.geometry_revision,
    capabilities_v2: system.capabilities,
    facts_v2: system.facts,
    trailheads_v2: system.trailheads,
    length_mi: system.facts.distance_mi,
    difficulty: system.facts.difficulty,
    surface: system.facts.surface,
    summary: system.summary || feature.summary,
    photo_url: system.media[0]?.url ?? feature.photo_url,
  };
}
