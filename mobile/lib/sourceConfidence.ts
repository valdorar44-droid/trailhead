export type SourceConfidence = {
  score: number;
  label: 'high' | 'medium' | 'review' | 'low';
  displayLabel: string;
  factors: string[];
  primaryProvider: string;
  primaryName: string;
  freshnessLabel: string;
};

type SourceRef = {
  source?: string;
  publisher?: string;
  name?: string;
  title?: string;
  kind?: string;
};

const PROVIDER_DEFAULTS: Record<string, { name: string; type: 'official' | 'open' | 'community' | 'commercial' | 'first_party'; score: number; freshness: string }> = {
  nps: { name: 'National Park Service', type: 'official', score: 88, freshness: 'Official NPS data' },
  ridb: { name: 'RIDB / Recreation.gov', type: 'official', score: 86, freshness: 'Official recreation data' },
  'recreation.gov': { name: 'Recreation.gov', type: 'official', score: 86, freshness: 'Official recreation data' },
  usfs: { name: 'USFS', type: 'official', score: 84, freshness: 'USFS open data' },
  blm: { name: 'BLM', type: 'official', score: 83, freshness: 'BLM open data' },
  usgs: { name: 'USGS', type: 'official', score: 82, freshness: 'USGS source data' },
  nws: { name: 'National Weather Service', type: 'official', score: 84, freshness: 'Official weather data' },
  airnow: { name: 'AirNow', type: 'official', score: 82, freshness: 'Official air quality data' },
  firms: { name: 'NASA FIRMS / WFIGS', type: 'official', score: 82, freshness: 'Official fire data' },
  osm: { name: 'OpenStreetMap', type: 'open', score: 60, freshness: 'Open map data' },
  geofabrik: { name: 'Geofabrik OSM', type: 'open', score: 60, freshness: 'OSM extract data' },
  overpass: { name: 'Overpass / OSM', type: 'open', score: 58, freshness: 'Open map query' },
  wikidata: { name: 'Wikidata', type: 'open', score: 56, freshness: 'Open entity data' },
  wikipedia: { name: 'Wikipedia / Commons', type: 'open', score: 54, freshness: 'Open reference data' },
  openbeta: { name: 'OpenBeta', type: 'open', score: 62, freshness: 'Open climbing data' },
  viator: { name: 'Viator', type: 'commercial', score: 68, freshness: 'Partner experience data' },
  mapbox: { name: 'Mapbox', type: 'commercial', score: 72, freshness: 'Live Mapbox data' },
  trailhead_curated: { name: 'Trailhead curated', type: 'first_party', score: 74, freshness: 'Trailhead curated' },
  trailhead_user: { name: 'Trailhead community', type: 'community', score: 52, freshness: 'Community report' },
};

function normalizeProviderId(value: unknown) {
  const key = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/^_+|_+$/g, '');
  if (!key) return '';
  if (key === 'recreationgov' || key === 'recreation_gov') return 'recreation.gov';
  if (key === 'openstreetmap') return 'osm';
  if (key === 'osm_overpass') return 'overpass';
  if (key === 'usda_forest_service' || key === 'fsgeodata') return 'usfs';
  if (key === 'usgs_digital_trails') return 'usgs';
  if (key === 'wikimedia') return 'wikipedia';
  if (key === 'wfigs' || key === 'nasa_firms') return 'firms';
  if (key === 'trailhead') return 'trailhead_curated';
  if (key === 'community') return 'trailhead_user';
  return key;
}

function providerFromSource(ref: SourceRef) {
  const direct = normalizeProviderId(ref.source || ref.publisher || ref.name || ref.kind || ref.title);
  if (PROVIDER_DEFAULTS[direct]) return direct;
  const text = `${ref.source || ''} ${ref.publisher || ''} ${ref.name || ''} ${ref.title || ''}`.toLowerCase();
  if (/national park service|\bnps\b/.test(text)) return 'nps';
  if (/ridb|recreation\.?gov/.test(text)) return 'ridb';
  if (/forest service|usfs/.test(text)) return 'usfs';
  if (/bureau of land management|\bblm\b/.test(text)) return 'blm';
  if (/openstreetmap|\bosm\b/.test(text)) return 'osm';
  if (/wikidata/.test(text)) return 'wikidata';
  if (/wikipedia|commons|wikimedia/.test(text)) return 'wikipedia';
  if (/viator/.test(text)) return 'viator';
  return direct;
}

function labelFor(score: number): SourceConfidence['label'] {
  if (score >= 85) return 'high';
  if (score >= 65) return 'medium';
  if (score >= 40) return 'review';
  return 'low';
}

function displayLabelFor(label: SourceConfidence['label']) {
  if (label === 'high') return 'High confidence';
  if (label === 'medium') return 'Good confidence';
  if (label === 'review') return 'Needs review';
  return 'Low confidence';
}

export function sourceConfidenceFromRecord(record: any): SourceConfidence {
  const existing = record?.source_quality || record?.source_confidence;
  if (existing && typeof existing === 'object' && Number.isFinite(Number(existing.score))) {
    const score = Math.max(0, Math.min(100, Math.round(Number(existing.score))));
    const label = labelFor(score);
    return {
      score,
      label,
      displayLabel: displayLabelFor(label),
      factors: Array.isArray(existing.factors) ? existing.factors.map(String) : [],
      primaryProvider: String(existing.primary_provider || existing.primaryProvider || ''),
      primaryName: String(existing.primary_name || existing.primaryName || ''),
      freshnessLabel: String(existing.freshness_label || existing.freshnessLabel || 'Source freshness unknown'),
    };
  }

  const sources: SourceRef[] = Array.isArray(record?.sources)
    ? record.sources
    : Array.isArray(record?.source_pack?.sources)
      ? record.source_pack.sources
      : [];
  const providerIds = sources.map(providerFromSource).filter(Boolean);
  const providers = providerIds.map(id => PROVIDER_DEFAULTS[id]).filter(Boolean);
  const primaryId = providerIds.find(id => PROVIDER_DEFAULTS[id]) || '';
  const primary = primaryId ? PROVIDER_DEFAULTS[primaryId] : undefined;
  const official = providers.some(provider => provider.type === 'official');
  const multiple = new Set(providerIds).size > 1 || sources.length > 1;
  let score = primary?.score ?? Number(record?.quality_score || 35);
  const factors: string[] = [];
  if (official) {
    score = Math.max(score, 75);
    factors.push('official');
  }
  if (multiple) {
    score = Math.min(100, score + 8);
    factors.push('multiple_sources');
  }
  if (/inferred|ai/i.test(String(record?.quality || record?.facts?.source_quality || ''))) {
    score = Math.max(0, score - 12);
    factors.push('inferred');
  }
  const label = labelFor(score);
  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    label,
    displayLabel: displayLabelFor(label),
    factors,
    primaryProvider: primaryId,
    primaryName: primary?.name || '',
    freshnessLabel: primary?.freshness || 'Source freshness unknown',
  };
}
