import type { TrailProfile } from './api';
import { trailConfidenceLabel, trailSourceLabel, type TrailFeature } from './trailEngine';

export type TrailheadTrailProfile = {
  id: string;
  name: string;
  distance_mi: number | null;
  elevation_gain_ft: number | null;
  difficulty: 'easy' | 'moderate' | 'hard' | 'expert' | 'unknown';
  difficulty_label: string;
  difficulty_reason: string[];
  route_type: 'loop' | 'out_back' | 'point_to_point' | 'network' | 'unknown';
  activities: string[];
  access: {
    foot?: string;
    bicycle?: string;
    horse?: string;
    motor_vehicle?: string;
    dog?: string;
    seasonal?: string;
    closure_status?: string;
  };
  surface?: string;
  land_manager?: string;
  source: {
    primary: string;
    official_url?: string;
    last_checked?: number;
    license?: string;
    attribution?: string;
  };
  confidence: {
    geometry: number;
    difficulty: number;
    access: number;
    trailhead: number;
  };
  stats: {
    saves: number;
    completions: number;
    reports_recent: number;
    photos: number;
  };
  recent_conditions: string[];
};

export type TrailDisplayRow = {
  label: string;
  value: string;
  icon: string;
  tone: string;
};

function normalizeDifficulty(raw?: string | null): TrailheadTrailProfile['difficulty'] {
  const value = String(raw || '').toLowerCase();
  if (/expert|extreme|black|very hard/.test(value)) return 'expert';
  if (/hard|strenuous|difficult/.test(value)) return 'hard';
  if (/moderate|medium|blue/.test(value)) return 'moderate';
  if (/easy|green|short/.test(value)) return 'easy';
  return 'unknown';
}

function normalizeRouteType(raw?: string | null): TrailheadTrailProfile['route_type'] {
  const value = String(raw || '').toLowerCase().replace(/[-\s]+/g, '_');
  if (/loop/.test(value)) return 'loop';
  if (/out.*back|out_back|return/.test(value)) return 'out_back';
  if (/point|through|one_way/.test(value)) return 'point_to_point';
  if (/network|system|area/.test(value)) return 'network';
  return 'unknown';
}

function compact(values: Array<string | number | null | undefined>) {
  return values.map(value => String(value ?? '').trim()).filter(Boolean);
}

function titleCase(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function difficultyReasons(profile?: TrailProfile | null, trail?: TrailFeature | null) {
  const reasons: string[] = [];
  const difficulty = profile?.difficulty || trail?.difficulty;
  if (difficulty) reasons.push(`Difficulty source: ${difficulty}`);
  if (profile?.length_mi || trail?.length_mi) reasons.push(`${Number(profile?.length_mi ?? trail?.length_mi).toFixed(1)} mi route length`);
  if (profile?.elevation_gain_ft) reasons.push(`${Math.round(profile.elevation_gain_ft).toLocaleString()} ft elevation gain`);
  if (trail?.surface) reasons.push(`Surface: ${trail.surface}`);
  if (profile?.field_report_summary?.top_tags?.length) reasons.push('Recent condition reports available');
  return reasons.length ? reasons.slice(0, 4) : ['Difficulty needs source confirmation'];
}

function confidenceScore(value: boolean, fallback = 0.35) {
  return value ? 0.78 : fallback;
}

export function normalizeTrailheadTrailProfile(profile?: TrailProfile | null, trail?: TrailFeature | null): TrailheadTrailProfile {
  const sourcePrimary = profile?.source_pack?.primary || profile?.source_label || profile?.source || (trail ? trailSourceLabel(trail) : 'Trailhead');
  const hasGeometry = Boolean(profile?.geometry?.features?.length || profile?.geometry_ref || trail?.source === 'trailhead');
  const hasDifficulty = Boolean(profile?.difficulty || trail?.difficulty);
  const hasAccess = Boolean(profile?.land_manager || trail?.managing_agency || profile?.official_url);
  const hasTrailhead = Boolean(profile?.trailheads?.length);
  const reportsRecent = profile?.field_report_summary?.count ?? trail?.support?.reportsNearby ?? 0;
  const conditions = (profile?.field_report_summary?.top_tags ?? [])
    .slice(0, 6)
    .map(item => item.tag)
    .filter(Boolean);
  return {
    id: profile?.id || trail?.id || 'trail',
    name: profile?.name || trail?.name || 'Trail',
    distance_mi: profile?.length_mi ?? trail?.length_mi ?? null,
    elevation_gain_ft: profile?.elevation_gain_ft ?? null,
    difficulty: normalizeDifficulty(profile?.difficulty || trail?.difficulty),
    difficulty_label: profile?.difficulty || trail?.difficulty || 'Unrated',
    difficulty_reason: difficultyReasons(profile, trail),
    route_type: normalizeRouteType(profile?.route_type),
    activities: compact([...(profile?.activities ?? []), ...(trail?.activities ?? [])]).slice(0, 8),
    access: {
      foot: 'check local rules',
      motor_vehicle: trail?.type === 'road' ? trail.vehicle_fit || 'unknown' : undefined,
      seasonal: profile?.season_window || profile?.best_season,
      closure_status: trail?.open_status || undefined,
    },
    surface: trail?.surface,
    land_manager: profile?.land_manager || trail?.managing_agency,
    source: {
      primary: sourcePrimary,
      official_url: profile?.official_url || profile?.source_pack?.official_url,
      last_checked: profile?.last_checked || trail?.last_checked,
      license: profile?.source_pack?.license,
      attribution: profile?.source,
    },
    confidence: {
      geometry: confidenceScore(hasGeometry, trail?.source === 'map_tile' ? 0.55 : 0.4),
      difficulty: confidenceScore(hasDifficulty, reportsRecent ? 0.45 : 0.3),
      access: confidenceScore(hasAccess, 0.35),
      trailhead: confidenceScore(hasTrailhead, trail?.type === 'trailhead' ? 0.62 : 0.32),
    },
    stats: {
      saves: 0,
      completions: 0,
      reports_recent: reportsRecent,
      photos: (profile?.photos?.length ?? 0) + (trail?.photo_url ? 1 : 0),
    },
    recent_conditions: conditions,
  };
}

export function trailProfileStatRows(model: TrailheadTrailProfile): TrailDisplayRow[] {
  return [
    { label: 'Distance', value: model.distance_mi != null ? `${model.distance_mi.toFixed(1)} mi` : 'Distance TBD', icon: 'walk-outline', tone: '#22c55e' },
    { label: 'Difficulty', value: titleCase(model.difficulty_label), icon: 'speedometer-outline', tone: model.difficulty === 'hard' || model.difficulty === 'expert' ? '#ef4444' : '#f97316' },
    { label: 'Route', value: titleCase(model.route_type), icon: 'git-branch-outline', tone: '#38bdf8' },
    { label: 'Reports', value: model.stats.reports_recent ? `${model.stats.reports_recent} recent` : 'No recent reports', icon: 'radio-outline', tone: '#a855f7' },
  ];
}

export function trailProfileSourceRows(model: TrailheadTrailProfile): TrailDisplayRow[] {
  const confidence = Math.round(((model.confidence.geometry + model.confidence.difficulty + model.confidence.access + model.confidence.trailhead) / 4) * 100);
  const checked = model.source.last_checked
    ? new Date(model.source.last_checked * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Check current status';
  return [
    { label: 'Source', value: model.source.primary, icon: 'map-outline', tone: '#38bdf8' },
    { label: 'Confidence', value: `${confidence}% profile confidence`, icon: 'shield-checkmark-outline', tone: confidence >= 70 ? '#22c55e' : '#f97316' },
    { label: 'Freshness', value: checked, icon: 'calendar-outline', tone: '#f97316' },
  ];
}

export function trailFeatureSourceSummary(trail: TrailFeature, profile?: TrailProfile | null) {
  const model = normalizeTrailheadTrailProfile(profile, trail);
  const source = trailProfileSourceRows(model)[1]?.value ?? trailConfidenceLabel(trail);
  return `${model.source.primary} · ${source}`;
}
