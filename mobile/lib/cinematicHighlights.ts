import type { ExplorePlaceProfile } from './api';
import type { StoryboardPlace } from './copilotStoryboard';
import { relatedThingToSeeCanShow } from './exploreContextFilters';
import { distanceBetweenLngLatMeters, routeRatioForPoint } from './routeProjection';
import { sourceConfidenceFromRecord } from './sourceConfidence';

export const CINEMATIC_ROUTE_RANK_CATEGORIES = [
  'viewpoint',
  'view',
  'overlook',
  'vista',
  'trail',
  'trailhead',
  'peak',
  'pass',
  'glacier',
  'waterfall',
  'water',
  'river',
  'lake',
  'canyon',
  'arch',
  'park',
  'monument',
  'historic',
  'hot_spring',
  'attraction',
  'scenic',
  'tourism',
];

export function cinematicRouteCorridorMiles(route: [number, number][]) {
  let routeMiles = 0;
  for (let index = 1; index < route.length; index += 1) {
    routeMiles += distanceBetweenLngLatMeters(route[index - 1], route[index]) / 1609.344;
  }
  return Math.max(2.5, Math.min(6, routeMiles * 0.08));
}

const SCENIC_KIND_SCORE: Array<[RegExp, number, string]> = [
  [/\b(waterfalls?|falls?)\b/i, 34, 'waterfall'],
  [/\b(canyons?|arches?|glaciers?)\b/i, 32, 'landform'],
  [/\b(overlooks?|viewpoints?|vistas?|lookouts?)\b/i, 31, 'viewpoint'],
  [/\b(peaks?|summits?|passes?)\b/i, 29, 'mountain'],
  [/\b(lakes?|rivers?|creeks?|springs?|hot springs?)\b/i, 27, 'water'],
  [/\b(national park|state park|parks?)\b/i, 24, 'park'],
  [/\b(monuments?|historic|landmarks?|ruins?|lighthouse|bridge)\b/i, 23, 'landmark'],
  [/\b(trails?|trailheads?|hikes?|climb)\b/i, 18, 'trail'],
  [/\b(scenic|byway|drive)\b/i, 16, 'scenic_drive'],
];

const BORING_OR_ESSENTIAL_RE = /\b(camps?|campgrounds?|rv park|lodging|hotel|motel|cabin|fuel|gas|diesel|propane|charging|grocery|restaurant|parking|restroom|toilet|picnic|dump station)\b/i;
const GENERIC_ROAD_RE = /\b(road|rd|route|highway|hwy|forest road|service road)\b/i;
const SCENIC_ROAD_ALLOW_RE = /\b(scenic|byway|historic|drive|overlook|viewpoint|trail|falls?|waterfall|canyon|summit|pass)\b/i;
const GENERIC_LABEL_TYPE_RE = /\b(place|locality|hamlet|village|town|city|administrative|neighbou?rhood|region|area|desert)\b/i;

function finiteCoord(lat: unknown, lng: unknown) {
  return Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
}

function compactText(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function firstSentence(value: unknown, max = 170) {
  const clean = compactText(value);
  if (!clean) return '';
  const match = clean.match(/^[^.!?]{10,180}[.!?]/);
  return (match ? match[0] : clean).slice(0, max).trim();
}

export const routeRatioForCinematic = routeRatioForPoint;

function scenicKindScore(place: Pick<StoryboardPlace, 'type' | 'title' | 'note'>) {
  const haystack = `${place.type || ''} ${place.title || ''} ${place.note || ''}`;
  for (const [re, score, kind] of SCENIC_KIND_SCORE) {
    if (re.test(haystack)) return { score, kind };
  }
  return { score: 0, kind: 'poi' };
}

function confidenceScore(place: Pick<StoryboardPlace, 'confidence' | 'source' | 'source_label'>) {
  const explicit = String(place.confidence || '').toLowerCase();
  if (explicit === 'high') return 18;
  if (explicit === 'medium') return 11;
  if (explicit === 'review') return 6;
  if (explicit === 'low' || explicit === 'estimated') return 2;
  const source = `${place.source || ''} ${place.source_label || ''}`;
  if (/\b(nps|national park|recreation\.?gov|ridb|usfs|forest service|blm|usgs)\b/i.test(source)) return 16;
  if (/\b(trailhead|curated)\b/i.test(source)) return 14;
  if (/\b(osm|openstreetmap|wikidata|wikipedia|mapbox)\b/i.test(source)) return 8;
  return 4;
}

export function isCinematicScenicPlace(place: Pick<StoryboardPlace, 'type' | 'title' | 'note' | 'source' | 'source_label'>) {
  const text = `${place.type || ''} ${place.title || ''} ${place.note || ''}`.toLowerCase();
  const source = compactText(`${place.source || ''} ${place.source_label || ''}`);
  const note = compactText(place.note);
  const type = compactText(place.type);
  if (!place.title || !type || !source || note.length < 10 || BORING_OR_ESSENTIAL_RE.test(text)) return false;
  if (GENERIC_ROAD_RE.test(text) && !SCENIC_ROAD_ALLOW_RE.test(text)) return false;
  const scenic = scenicKindScore(place);
  if (GENERIC_LABEL_TYPE_RE.test(type) && scenic.score <= 0) return false;
  return scenic.score > 0 || relatedThingToSeeCanShow({
    name: place.title,
    lat: 0,
    lng: 0,
    type: place.type,
    summary: place.note,
  });
}

export function scenicStoryboardPlace(place: StoryboardPlace): StoryboardPlace {
  const kind = scenicKindScore(place).kind;
  return {
    ...place,
    type: kind === 'poi' ? place.type : `scenic_${kind}`,
    source: place.source || 'cinematic_highlight',
    confidence: place.confidence || 'medium',
  };
}

export function rankCinematicPlaces(input: {
  route: [number, number][];
  places: StoryboardPlace[];
  max?: number;
  maxRouteDistanceMi?: number;
}): StoryboardPlace[] {
  const max = input.max ?? 5;
  const route = input.route;
  const maxRouteDistanceMi = input.maxRouteDistanceMi ?? cinematicRouteCorridorMiles(route);
  const scored = input.places
    .filter(place => {
      const routeDistanceMi = Number(place.route_distance_mi);
      return finiteCoord(place.lat, place.lng)
        && isCinematicScenicPlace(place)
        && (!Number.isFinite(routeDistanceMi) || routeDistanceMi <= maxRouteDistanceMi);
    })
    .map(place => {
      const ratio = routeRatioForCinematic(route, Number(place.lat), Number(place.lng));
      const scenic = scenicKindScore(place);
      const source = confidenceScore(place);
      const offRoutePenalty = Math.min(10, Math.max(0, Number(place.route_distance_mi || 0) - 4));
      return {
        place: scenicStoryboardPlace(place),
        ratio,
        score: scenic.score + source - offRoutePenalty,
      };
    })
    .sort((a, b) => b.score - a.score);

  const chosen: typeof scored = [];
  for (const item of scored) {
    if (chosen.some(existing => Math.abs(existing.ratio - item.ratio) < 0.08)) continue;
    const samePlace = chosen.some(existing =>
      Math.abs(existing.place.lat - item.place.lat) < 0.005
      && Math.abs(existing.place.lng - item.place.lng) < 0.005,
    );
    if (samePlace) continue;
    chosen.push(item);
    if (chosen.length >= max) break;
  }
  return chosen
    .sort((a, b) => a.ratio - b.ratio)
    .map(item => item.place);
}

function exploreLatLng(place: ExplorePlaceProfile): { lat: number; lng: number } | null {
  const summary = place.summary || {};
  if (finiteCoord(summary.lat, summary.lng)) return { lat: Number(summary.lat), lng: Number(summary.lng) };
  const coordinates = String(place.facts?.coordinates || '');
  const match = coordinates.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  return finiteCoord(lat, lng) ? { lat, lng } : null;
}

export function storyboardPlacesFromExploreRouteRank(places: ExplorePlaceProfile[] = []): StoryboardPlace[] {
  return places.flatMap((place, idx) => {
    const coords = exploreLatLng(place);
    if (!coords) return [];
    const confidence = sourceConfidenceFromRecord(place).label;
    const summary = firstSentence(
      place.card?.highlight
        || place.card?.summary
        || place.profile?.hook
        || place.profile?.summary
        || place.summary?.hook
        || place.summary?.short_description
        || place.wiki_extract,
    );
    return [{
      id: `explore-rank-${place.id || idx}`,
      type: compactText(place.category || place.module_target || place.summary?.category || place.summary?.explore_group || 'scenic'),
      title: compactText(place.card?.title || place.summary?.title || place.id || 'Scenic stop'),
      note: summary,
      lat: coords.lat,
      lng: coords.lng,
      source: compactText(place.source_quality?.primary_provider || place.source_pack?.primary || place.sources?.[0]?.publisher || 'explore_route_rank'),
      source_label: compactText(place.source_quality?.primary_name || place.sources?.[0]?.title || place.attribution),
      confidence: confidence === 'review' ? 'medium' : confidence,
      route_distance_mi: Number.isFinite(Number(place.summary?.distance_m))
        ? Number(place.summary?.distance_m) / 1609.344
        : undefined,
    } satisfies StoryboardPlace];
  });
}

export function buildCinematicHighlights(input: {
  route: [number, number][];
  places: StoryboardPlace[];
  exploreRouteRankPlaces?: StoryboardPlace[];
  max?: number;
}): StoryboardPlace[] {
  return rankCinematicPlaces({
    route: input.route,
    places: [...input.places, ...(input.exploreRouteRankPlaces ?? [])],
    max: input.max ?? 5,
  });
}
