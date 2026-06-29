import type { ExplorePlaceProfile } from '@/lib/api';
import { sourceConfidenceFromRecord } from '@/lib/sourceConfidence';

export type ExploreMode = 'featured' | 'nearby' | 'trip';
export type ExploreCategoryKey =
  | 'all'
  | 'camp'
  | 'glamping'
  | 'huts'
  | 'trails'
  | 'trailheads'
  | 'views'
  | 'peaks'
  | 'waterfalls'
  | 'springs'
  | 'climb'
  | 'water'
  | 'scenic'
  | 'parks'
  | 'land'
  | 'fuel'
  | 'resupply'
  | 'tours'
  | 'nearby';

export type ExploreFact = {
  label: string;
  value?: string;
  icon: string;
  tone: string;
};

export type ExploreNearbyModule = {
  label: string;
  detail: string;
  icon: string;
  tone: string;
  action: 'trails' | 'parking' | 'fuel' | 'weather' | 'water' | 'views' | 'hours' | 'services' | 'route' | 'map';
};

export type ExplorePlanNote = {
  label: string;
  value: string;
  icon: string;
  tone: string;
};

export type ExploreSourceRow = {
  label: string;
  value: string;
  icon: string;
  tone: string;
};

export type ExploreDisplayContext = {
  campCount?: number;
  relatedCount?: number;
  distanceMi?: number | null;
  day?: number;
  saved?: boolean;
};

export const EXPLORE_CATEGORY_CHIPS: Array<{
  key: ExploreCategoryKey;
  label: string;
  icon: string;
  color: string;
}> = [
  { key: 'all', label: 'All', icon: 'grid-outline', color: '#64748b' },
  { key: 'camp', label: 'Camp', icon: 'bonfire-outline', color: '#16a34a' },
  { key: 'glamping', label: 'Glamping', icon: 'sparkles-outline', color: '#0ea5e9' },
  { key: 'huts', label: 'Cabins', icon: 'home-outline', color: '#6366f1' },
  { key: 'trails', label: 'Trails', icon: 'walk-outline', color: '#f97316' },
  { key: 'trailheads', label: 'Trailheads', icon: 'trail-sign-outline', color: '#f59e0b' },
  { key: 'views', label: 'Views', icon: 'binoculars-outline', color: '#0f766e' },
  { key: 'peaks', label: 'Mountains', icon: 'triangle-outline', color: '#2563eb' },
  { key: 'waterfalls', label: 'Waterfalls', icon: 'water-outline', color: '#0284c7' },
  { key: 'springs', label: 'Springs', icon: 'thermometer-outline', color: '#dc2626' },
  { key: 'climb', label: 'Climb', icon: 'fitness-outline', color: '#9333ea' },
  { key: 'water', label: 'Water', icon: 'water-outline', color: '#0ea5e9' },
  { key: 'scenic', label: 'Scenic', icon: 'camera-outline', color: '#ca8a04' },
  { key: 'parks', label: 'Parks', icon: 'leaf-outline', color: '#22c55e' },
  { key: 'land', label: 'Land', icon: 'map-outline', color: '#84cc16' },
  { key: 'fuel', label: 'Fuel', icon: 'car-outline', color: '#ea580c' },
  { key: 'resupply', label: 'Resupply', icon: 'basket-outline', color: '#7c3aed' },
  { key: 'tours', label: 'Tours', icon: 'ticket-outline', color: '#d97706' },
  { key: 'nearby', label: 'Near', icon: 'locate-outline', color: '#a855f7' },
];

const CATEGORY_ALIASES: Record<ExploreCategoryKey, string[]> = {
  all: [],
  camp: ['camp', 'campground', 'camping', 'campsite', 'tent', 'rv', 'overnight'],
  glamping: ['glamping', 'glamp', 'private stay', 'resort', 'yurt'],
  huts: ['hut', 'shelter', 'refuge', 'cabin', 'backcountry hut', 'lodging'],
  trails: ['trail', 'hike', 'hiking', 'trek', 'trekking', 'route'],
  trailheads: ['trailhead', 'trail head', 'access point'],
  views: ['view', 'viewpoint', 'overlook', 'lookout', 'scenic view'],
  peaks: ['peak', 'summit', 'mountain'],
  waterfalls: ['waterfall', 'falls', 'cascade'],
  springs: ['hot spring', 'spring', 'thermal', 'soak'],
  climb: ['climb', 'climbing', 'rock climbing', 'crag', 'bouldering'],
  water: ['water', 'lake', 'river', 'shore', 'beach', 'marina', 'boat', 'swim'],
  scenic: ['scenic', 'photo', 'landmark', 'attraction', 'historic'],
  parks: ['park', 'preserve', 'monument', 'forest', 'recreation area'],
  land: ['public land', 'blm', 'national forest', 'wilderness', 'conservation'],
  fuel: ['fuel', 'gas', 'diesel', 'petrol', 'service station'],
  resupply: ['resupply', 'grocery', 'gear', 'supplies', 'food', 'market'],
  tours: ['tour', 'tours', 'experience', 'experiences', 'things to do', 'activity', 'activities', 'ticket', 'tickets', 'guide', 'guided'],
  nearby: [],
};

const DESTINATION_PRIMARY_OVERRIDES: ExploreCategoryKey[] = [
  'camp',
  'glamping',
  'huts',
  'trails',
  'trailheads',
  'views',
  'peaks',
  'waterfalls',
  'springs',
  'climb',
  'water',
  'scenic',
  'tours',
];

const FALLBACK_COPY: Record<string, string> = {
  camp: 'Camp options for the area. Check access, fees, closures, fire rules, and overnight limits.',
  glamping: 'Comfort-focused outdoor stay. Check booking rules, road conditions, and availability.',
  huts: 'Backcountry shelter or hut. Check reservations, condition, weather, and seasonal access.',
  trails: 'Trail area with distance, difficulty, weather, daylight, permit, and closure checks.',
  trailheads: 'Trail access point. Confirm parking, road conditions, closures, and daylight before starting.',
  views: 'Scenic viewpoint for photos, short stops, and nearby trails.',
  peaks: 'Mountain or summit landmark. Check route, weather, access, and difficulty.',
  waterfalls: 'Waterfall or cascade. Check trail access, seasonal flow, closures, and slippery terrain.',
  springs: 'Thermal feature. Check legality, access, temperature, water safety, and local rules.',
  climb: 'Climbing area or crag. Check access, closures, route information, rules, and conditions.',
  fuel: 'Fuel or service stop. Verify hours, availability, road access, and payment options.',
  resupply: 'Resupply stop. Verify hours, inventory, payment options, and road access before depending on it.',
  tours: 'Bookable guided trips, tickets, local tours, and activities from external providers.',
  water: 'Water access or feature. Verify safety, access, seasonal conditions, and local rules.',
  scenic: 'Scenic stop for photos, short walks, and nearby exploration.',
  parks: 'Outdoor destination. Check official access, fees, closures, and local rules before committing dates.',
  land: 'Public land or managed area. Verify land rules, camping limits, access, and current restrictions.',
};

const WEAK_COPY_PATTERNS = [
  /\bmay refer to\b/i,
  /\b(disambiguation|wikimedia|wikidata)\b/i,
  /\b(undefined|null|nan)\b/i,
  /\bis a managed outdoor area near\b/i,
  /\bCheck official access, fees, closures, permits, weather\b/i,
  /^\s*(lake|mountain|waterfall|glacier|island|hill|volcano|national park|former national park|marine reserve|animal sanctuary|locality|river|peak)\s+(in|on|near|of)\s+[^.]{1,90}\.?\s*$/i,
  /^\s*(mountain|waterfall|glacier|lake|peak|park|trail|campground|historic site|protected area|places?|things to do)\s*\.?\s*$/i,
];

function readV3(place: ExplorePlaceProfile): Record<string, any> {
  return place as unknown as Record<string, any>;
}

function compact(parts: Array<string | null | undefined>) {
  return parts.map(part => String(part || '').trim()).filter(Boolean);
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function isOpenKnowledgePublisher(value?: string | null) {
  return /\b(wikidata|wikipedia|wikimedia|commons)\b/i.test(String(value || ''));
}

function cleanSourcePublisherLabel(value?: string | null) {
  const clean = String(value || '').trim();
  if (!clean) return '';
  return clean.replace(/\b(blm|nps|usfs|usgs|nws)\b/gi, match => match.toUpperCase());
}

export function normalizeExploreCopyBlock(value?: string | null) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function sentenceAwarePreview(value?: string | null, maxChars = 220) {
  const clean = normalizeExploreCopyBlock(value);
  if (!clean || clean.length <= maxChars) return { text: clean, expandable: false };
  const wordBoundary = clean.slice(0, maxChars).replace(/\s+\S*$/, '').trim() || clean.slice(0, maxChars).trim();
  const boundaries = Array.from(clean.matchAll(/[.!?](?=(?:["')\]]|\s|$))/g))
    .map(match => (match.index ?? 0) + 1);
  if (!boundaries.length) return { text: wordBoundary, expandable: true };
  const minChars = Math.min(Math.max(72, Math.floor(maxChars * 0.45)), maxChars);
  const beforeLimit = [...boundaries].reverse().find(index => index >= minChars && index <= maxChars);
  const afterLimit = boundaries.find(index => index > maxChars && index <= Math.floor(maxChars * 1.45));
  const cut = beforeLimit ?? afterLimit;
  if (!cut || cut >= clean.length) return { text: wordBoundary, expandable: true };
  return { text: clean.slice(0, cut).trim(), expandable: true };
}

export function withPreviewEllipsis(value?: string | null) {
  const clean = normalizeExploreCopyBlock(value);
  if (!clean) return '';
  return `${clean.replace(/[.!?]+$/, '')}...`;
}

export function sentenceAwarePreviewText(value?: string | null, maxChars = 220) {
  const preview = sentenceAwarePreview(value, maxChars);
  if (!preview.text) return '';
  return preview.expandable ? withPreviewEllipsis(preview.text) : preview.text;
}

function categoryFromText(text: string): ExploreCategoryKey | null {
  if (!text) return null;
  if (/waterfall|falls|cascade/.test(text)) return 'waterfalls';
  if (/hot spring|thermal|soak/.test(text)) return 'springs';
  if (/trailhead|trail head/.test(text)) return 'trailheads';
  if (/viewpoint|overlook|lookout|vista|view\b/.test(text)) return 'views';
  if (/peak|summit|mountain/.test(text)) return 'peaks';
  if (/climb|crag|boulder/.test(text)) return 'climb';
  if (/fuel|gas|diesel|petrol/.test(text)) return 'fuel';
  if (/resupply|grocery|gear|supplies|market/.test(text)) return 'resupply';
  if (/things to do|tour|experience|activity|ticket|guided|guide\b/.test(text)) return 'tours';
  if (/glamp|private stay|yurt/.test(text)) return 'glamping';
  if (/hut|shelter|refuge|cabin|lodg/.test(text)) return 'huts';
  if (/trail|hike|trek|ohv|route/.test(text)) return 'trails';
  if (/camp|rv|tent|overnight/.test(text)) return 'camp';
  if (/lake|river|shore|beach|marina|boat|water/.test(text)) return 'water';
  if (/public land|blm|wilderness|forest/.test(text)) return 'land';
  if (/scenic|historic|landmark|attraction|photo/.test(text)) return 'scenic';
  if (/park|preserve|monument|recreation area/.test(text)) return 'parks';
  return null;
}

function categoryFromDestinationTitle(text: string): ExploreCategoryKey | null {
  if (!text) return null;
  if (/\b(national|state|provincial|regional|county|territorial|historic|historical|ecological\s*&\s*historic|ecological\s+and\s+historic)\s+(park|monument|preserve|reserve|seashore|lakeshore|memorial|battlefield|historic site|historical park|historic park|historical reserve|historic reserve|recreation area)\b/.test(text)) {
    return 'parks';
  }
  if (/\b(national|state|provincial|regional|county|territorial)\s+(forest|wilderness|reserve|conservation area)\b/.test(text)) {
    return 'land';
  }
  return null;
}

function isNestedDestinationTitle(text: string) {
  return /\b(campgrounds?|campsites?|camping|glamping|huts?|cabins?|lodges?|lodging|trails?|trailheads?|visitor centers?|parking|rv|tent|overnight|tours?|activities|things to do|places to stay|where to stay)\b/.test(text);
}

function categoryFromGroup(text: string): ExploreCategoryKey | null {
  if (!text) return null;
  if (/camping/.test(text)) return 'camp';
  if (/glamping/.test(text)) return 'glamping';
  if (/huts|lodging|cabins/.test(text)) return 'huts';
  if (/trail|climb/.test(text)) return 'trails';
  if (/water|scenic/.test(text)) return 'water';
  if (/service|fuel|resupply/.test(text)) return 'fuel';
  if (/park|land/.test(text)) return 'parks';
  return null;
}

export function getExploreDisplayTitle(place: ExplorePlaceProfile) {
  const v3 = readV3(place);
  return String(v3.card?.title || v3.name || place.summary.title || 'Explore stop').trim();
}

export function exploreCategoryFromQuery(query: string): ExploreCategoryKey | null {
  const normalized = normalize(query);
  if (!normalized) return null;
  if (normalized === 'water falls') return 'waterfalls';
  for (const item of EXPLORE_CATEGORY_CHIPS) {
    if (item.key === 'all' || item.key === 'nearby') continue;
    if (normalize(item.label) === normalized || item.key === normalized) return item.key;
    if ((CATEGORY_ALIASES[item.key] ?? []).some(alias => {
      const aliasText = normalize(alias);
      return aliasText === normalized || `${aliasText}s` === normalized;
    })) {
      return item.key;
    }
  }
  return null;
}

export function getExploreDisplayRegion(place: ExplorePlaceProfile) {
  const v3 = readV3(place);
  return compact([
    v3.card?.region,
    place.summary.state,
    place.summary.region,
  ]).filter((part, index, parts) => parts.indexOf(part) === index).join(' · ');
}

export function getExploreCategoryKey(place: ExplorePlaceProfile): ExploreCategoryKey {
  const v3 = readV3(place);
  const titleText = normalize(getExploreDisplayTitle(place));
  const destinationTitle = categoryFromDestinationTitle(titleText);
  const nestedDestinationTitle = isNestedDestinationTitle(titleText);
  const explicit = categoryFromText(normalize(compact([
    v3.category,
    place.summary.category,
    ...(Array.isArray(v3.subcategories) ? v3.subcategories : []),
  ]).join(' ')));
  const title = categoryFromText(titleText);
  if (nestedDestinationTitle && title && title !== explicit) {
    return title;
  }
  if (
    destinationTitle
    && !nestedDestinationTitle
    && explicit
    && DESTINATION_PRIMARY_OVERRIDES.includes(explicit)
  ) {
    return destinationTitle;
  }
  if (explicit) return explicit;
  if (destinationTitle && !nestedDestinationTitle) return destinationTitle;
  if (title) return title;
  const group = categoryFromGroup(normalize(String(place.summary.explore_group || '')));
  if (group) return group;
  const secondary = categoryFromText(normalize(compact([
    ...(place.summary.tags ?? []),
    place.summary.hook,
    place.summary.short_description,
    place.profile.summary,
  ]).join(' ')));
  return secondary || 'parks';
}

export function getExploreDisplayCategory(place: ExplorePlaceProfile) {
  const key = getExploreCategoryKey(place);
  const chip = EXPLORE_CATEGORY_CHIPS.find(item => item.key === key);
  return chip?.label || String(place.summary.category || 'Explore');
}

export function getExploreIcon(place: ExplorePlaceProfile) {
  const chip = EXPLORE_CATEGORY_CHIPS.find(item => item.key === getExploreCategoryKey(place));
  return chip?.icon || 'compass-outline';
}

export function getExploreCategoryColor(place: ExplorePlaceProfile) {
  const chip = EXPLORE_CATEGORY_CHIPS.find(item => item.key === getExploreCategoryKey(place));
  return chip?.color || '#c4552d';
}

export function getExploreSourceBadge(place: ExplorePlaceProfile) {
  const v3 = readV3(place);
  const sources = Array.isArray(v3.sources) ? v3.sources : [];
  const facts = place.facts ?? {};
  const quality = normalize(String(v3.quality || place.source_pack?.quality || facts.source_quality || ''));
  const primary = cleanSourcePublisherLabel(place.source_pack?.primary || sources[0]?.publisher || sources[0]?.name);
  if (isOpenKnowledgePublisher(primary)) return 'Multiple sources';
  if (quality.includes('official')) {
    if (!primary) return 'Official source';
    if (/official/i.test(primary)) return primary;
    return `${primary} official`;
  }
  if (sources.length > 1 || place.source_pack?.sources?.length) return 'Multiple sources';
  if (quality.includes('wiki') || /wikipedia/i.test(facts.source_title || primary)) return 'Curated details';
  if (primary) return primary;
  return 'Map details';
}

export function getExploreTrustBadge(place: ExplorePlaceProfile) {
  const confidence = sourceConfidenceFromRecord(readV3(place));
  if (confidence.score >= 85) return 'High confidence';
  if (confidence.score >= 65) return 'Good confidence';
  const badge = getExploreSourceBadge(place);
  if (/official/i.test(badge)) return 'Verified details';
  if (/community|curated|multiple/i.test(badge)) return 'Curated details';
  return 'Check access';
}

export function getExploreFreshnessLabel(place: ExplorePlaceProfile) {
  const facts = place.facts ?? {};
  if (facts.last_updated && Number.isFinite(facts.last_updated)) {
    return new Date(facts.last_updated * 1000).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  }
  if (/official/i.test(getExploreSourceBadge(place))) return 'Official details';
  return 'Check current status';
}

export function getExploreCardSourceLine(place: ExplorePlaceProfile) {
  return compact([
    getExploreSourceBadge(place),
    getExploreFreshnessLabel(place),
  ]).filter((part, index, parts) => parts.indexOf(part) === index).join(' · ');
}

export function getExploreSourceRows(place: ExplorePlaceProfile): ExploreSourceRow[] {
  const v3 = readV3(place);
  const facts = place.facts ?? {};
  const sourceBadge = getExploreSourceBadge(place);
  const freshness = getExploreFreshnessLabel(place);
  const confidence = sourceConfidenceFromRecord(v3);
  const sourceCount = Math.max(
    Array.isArray(v3.sources) ? v3.sources.length : 0,
    Array.isArray(place.source_pack?.sources) ? place.source_pack?.sources?.length ?? 0 : 0,
  );
  const photoCredit = compact([
    place.summary.image_credit,
    place.summary.image_license,
    place.media?.find(item => item.credit)?.credit,
    place.source_pack?.photos?.find(item => item.credit)?.credit,
  ])[0];
  const sourceNote = String(place.source_pack?.source_note || '').trim();
  const officialUrl = place.source_pack?.official_url || facts.official_url || place.summary.source_url || facts.source_url;
  const rows: ExploreSourceRow[] = [
    {
      label: 'Source',
      value: sourceBadge,
      icon: /official/i.test(sourceBadge) ? 'shield-checkmark-outline' : 'map-outline',
      tone: /official/i.test(sourceBadge) ? '#16a34a' : '#2563eb',
    },
    {
      label: 'Updated',
      value: freshness,
      icon: 'calendar-outline',
      tone: facts.last_updated ? '#16a34a' : '#ca8a04',
    },
    {
      label: 'Status',
      value: confidence.score >= 65 ? 'Ready to compare' : 'Confirm before going',
      icon: 'shield-outline',
      tone: confidence.score >= 65 ? '#0ea5e9' : '#ca8a04',
    },
  ];
  if (sourceCount > 1) {
    rows.push({
      label: 'References',
      value: `${sourceCount} sources`,
      icon: 'layers-outline',
      tone: '#6366f1',
    });
  }
  if (officialUrl) {
    rows.push({
      label: 'Link',
      value: /viator|booking/i.test(String(officialUrl)) ? 'Booking page' : 'Official website',
      icon: 'open-outline',
      tone: '#f97316',
    });
  }
  if (photoCredit) {
    rows.push({
      label: 'Photo',
      value: photoCredit,
      icon: 'image-outline',
      tone: '#0f766e',
    });
  }
  if (sourceNote) {
    const cleanedNote = cleanExploreCopy(sourceNote, place);
    if (!/will be added|future|enrichment|generated from|open map|openstreetmap/i.test(cleanedNote)) {
      rows.push({
        label: 'Note',
        value: cleanedNote,
        icon: 'information-circle-outline',
        tone: '#64748b',
      });
    }
  }
  return rows;
}

export function getExploreCardSummary(place: ExplorePlaceProfile) {
  const v3 = readV3(place);
  const key = getExploreCategoryKey(place);
  return cleanExploreCopy(String(
    v3.card?.summary ||
    v3.card?.headline ||
    place.summary.hook ||
    place.summary.short_description ||
    place.profile.summary ||
    FALLBACK_COPY[key] ||
    'Use this stop with current access checks before you go.',
  ), place).trim();
}

export function getExploreHighlightCopy(place: ExplorePlaceProfile) {
  const v3 = readV3(place);
  const key = getExploreCategoryKey(place);
  return cleanExploreCopy(String(
    v3.card?.highlight ||
    place.profile.summary ||
    place.profile.hook ||
    FALLBACK_COPY[key] ||
    'Check nearby options and current access before you go.',
  ), place).trim();
}

export function getExploreWhyCopy(place: ExplorePlaceProfile) {
  const key = getExploreCategoryKey(place);
  return cleanExploreCopy(String(
    place.profile.why_it_matters ||
    (key === 'waterfalls'
      ? 'Waterfalls make strong scenic stops, especially when nearby trails, viewpoints, and weather line up.'
      : key === 'trails'
        ? 'Trail areas need clear distance, difficulty, route type, nearby stops, and current conditions.'
        : key === 'camp'
          ? 'Named campground areas make it easier to compare access, rules, fees, and nearby trail options.'
          : FALLBACK_COPY[key] || 'This stop helps compare access, timing, and nearby options.'),
  ), place).trim();
}

export function getExploreBestSeason(place: ExplorePlaceProfile) {
  const v3 = readV3(place);
  const best = String(v3.best_season || '').trim();
  if (best) return shortSeasonLabel(best);
  if (place.profile.best_time_to_stop) return shortSeasonLabel(place.profile.best_time_to_stop);
  return 'Check season';
}

export function getExploreQuickFacts(place: ExplorePlaceProfile, context: ExploreDisplayContext = {}): ExploreFact[] {
  const key = getExploreCategoryKey(place);
  const facts: ExploreFact[] = [];
  if (context.campCount && context.campCount > 0) {
    facts.push({
      label: key === 'camp' ? 'Campgrounds nearby' : 'Camps nearby',
      value: String(context.campCount),
      icon: 'bonfire-outline',
      tone: '#16a34a',
    });
  } else if (key === 'camp' || key === 'glamping' || key === 'huts') {
    facts.push({ label: 'Verify access', icon: 'trail-sign-outline', tone: '#16a34a' });
  } else if (key === 'waterfalls' || key === 'views') {
    facts.push({ label: key === 'waterfalls' ? 'Viewpoints nearby' : 'Scenic stop', icon: 'binoculars-outline', tone: '#15803d' });
  } else if (key === 'fuel') {
    facts.push({ label: 'Verify hours', icon: 'car-outline', tone: '#ea580c' });
  } else if (key === 'resupply') {
    facts.push({ label: 'Verify supply', icon: 'basket-outline', tone: '#7c3aed' });
  } else {
    facts.push({ label: 'Area', icon: 'navigate-outline', tone: '#2563eb' });
  }
  facts.push({ label: getExploreBestSeason(place), icon: 'calendar-outline', tone: '#c4552d' });
  facts.push({ label: getExploreSourceBadge(place), icon: 'shield-checkmark-outline', tone: '#2563eb' });
  facts.push({ label: 'Offline', value: 'Recommended', icon: 'cloud-download-outline', tone: '#7c3aed' });
  return facts.slice(0, 4);
}

export function getExplorePlanNotes(place: ExplorePlaceProfile): ExplorePlanNote[] {
  const key = getExploreCategoryKey(place);
  const v3 = readV3(place);
  const explicitFacts = Array.isArray(v3.card?.facts) ? v3.card.facts.map(String).filter(Boolean) : [];
  const text = normalize(compact([
    getExploreDisplayTitle(place),
    place.summary.hook,
    place.summary.short_description,
    place.profile.summary,
    place.profile.what_to_know,
    place.profile.access_notes,
    place.profile.best_time_to_stop,
    ...explicitFacts,
  ]).join(' '));

  if (key === 'waterfalls') {
    return [
      { label: 'Drop', value: explicitFacts[0] || 'Verify height', icon: 'water-outline', tone: '#0284c7' },
      { label: 'Access', value: explicitFacts[1] || compact([place.profile.access_notes, 'Open area']).join(' · ') || 'Check trailhead', icon: 'trail-sign-outline', tone: '#16a34a' },
      { label: 'Best Flow', value: explicitFacts[2] || getExploreBestSeason(place), icon: 'calendar-outline', tone: '#ca8a04' },
      { label: 'Safety', value: explicitFacts[3] || 'Wet rock, ice, closures', icon: 'alert-circle-outline', tone: '#dc2626' },
    ];
  }

  if (key === 'trails' || key === 'trailheads' || key === 'climb') {
    const distance = text.match(/\b(\d+(?:\.\d+)?)\s?(mi|mile|miles|km|kilometer|kilometers)\b/);
    const difficulty = text.match(/\b(easy|moderate|strenuous|hard|difficult|expert|beginner|advanced)\b/);
    const loopLikely = /\b(loop|lollipop|circuit)\b/.test(text);
    const pointToPoint = /\b(point to point|point-to-point|through hike|thru hike)\b/.test(text);
    return [
      { label: 'Route Type', value: loopLikely ? 'Loop likely' : pointToPoint ? 'Point-to-point' : 'Loop / out-and-back options', icon: 'git-compare-outline', tone: '#f97316' },
      { label: 'Distance', value: distance ? `${distance[1]} ${distance[2].replace('mile', 'mi').replace('kilometer', 'km')}` : 'Choose trail', icon: 'walk-outline', tone: '#16a34a' },
      { label: 'Difficulty', value: difficulty ? difficulty[1].replace(/^\w/, c => c.toUpperCase()) : 'Verify grade', icon: 'trending-up-outline', tone: '#7c3aed' },
      { label: 'Trail Lines', value: 'Open segments', icon: 'map-outline', tone: '#2563eb' },
    ];
  }

  return [];
}

export function getExploreNearbyModules(place: ExplorePlaceProfile, context: ExploreDisplayContext = {}): ExploreNearbyModule[] {
  const key = getExploreCategoryKey(place);
  if (key === 'waterfalls') {
    return [
      { label: 'Trails', detail: context.relatedCount ? `${context.relatedCount} nearby` : 'Nearby access', icon: 'walk-outline', tone: '#16a34a', action: 'trails' },
      { label: 'Parking', detail: 'Open area', icon: 'car-outline', tone: '#2563eb', action: 'parking' },
      { label: 'Fuel', detail: 'Open area', icon: 'car-sport-outline', tone: '#ea580c', action: 'fuel' },
      { label: 'Weather', detail: 'Forecast', icon: 'partly-sunny-outline', tone: '#9333ea', action: 'weather' },
    ];
  }
  if (key === 'fuel' || key === 'resupply') {
    return [
      { label: 'Hours', detail: 'Check hours', icon: 'time-outline', tone: '#ea580c', action: 'hours' },
      { label: 'Route', detail: 'Start route', icon: 'navigate-outline', tone: '#2563eb', action: 'route' },
      { label: 'Services', detail: 'Open area', icon: 'build-outline', tone: '#7c3aed', action: 'services' },
      { label: 'Road access', detail: 'Open area', icon: 'map-outline', tone: '#16a34a', action: 'map' },
    ];
  }
  return [
    { label: 'Trails', detail: context.relatedCount ? `${context.relatedCount} nearby` : 'Nearby', icon: 'walk-outline', tone: '#16a34a', action: 'trails' },
    { label: 'Views', detail: 'Open area', icon: 'image-outline', tone: '#2563eb', action: 'views' },
    { label: 'Fuel', detail: 'Open area', icon: 'car-sport-outline', tone: '#ea580c', action: 'fuel' },
    { label: 'Water', detail: 'Open area', icon: 'water-outline', tone: '#0ea5e9', action: 'water' },
    { label: 'Weather', detail: 'Forecast', icon: 'partly-sunny-outline', tone: '#9333ea', action: 'weather' },
  ];
}

export function getExploreTrailCards(place: ExplorePlaceProfile) {
  const v3 = readV3(place);
  return Array.isArray(v3.trails) ? v3.trails : [];
}

export function getExploreSearchText(place: ExplorePlaceProfile) {
  const v3 = readV3(place);
  const key = getExploreCategoryKey(place);
  return normalize(compact([
    getExploreDisplayTitle(place),
    getExploreDisplayCategory(place),
    place.summary.state,
    place.summary.region,
    place.summary.hook,
    place.summary.short_description,
    place.profile.summary,
    place.profile.why_it_matters,
    place.profile.what_to_know,
    ...(place.summary.tags ?? []),
    ...(Array.isArray(v3.search_aliases) ? v3.search_aliases : []),
    ...(CATEGORY_ALIASES[key] ?? []),
  ]).join(' '));
}

export function exploreCategoryMatches(place: ExplorePlaceProfile, selected: ExploreCategoryKey) {
  if (selected === 'all') return true;
  if (selected === 'tours') return false;
  if (selected === 'nearby') return true;
  const key = getExploreCategoryKey(place);
  return key === selected;
}

export function exploreQueryScore(place: ExplorePlaceProfile, query: string) {
  const normalized = normalize(query);
  if (!normalized) return 0;
  const title = normalize(getExploreDisplayTitle(place));
  const category = normalize(getExploreDisplayCategory(place));
  const text = getExploreSearchText(place);
  let score = 0;
  if (title === normalized) score += 120;
  else if (title.startsWith(normalized)) score += 75;
  else if (title.includes(normalized)) score += 42;
  if (category.includes(normalized)) score += 24;
  if (text.includes(normalized)) score += 14;
  for (const aliases of Object.values(CATEGORY_ALIASES)) {
    if (aliases.some(alias => normalize(alias) === normalized && text.includes(normalize(alias)))) score += 18;
  }
  return score;
}

export function exploreTrustScore(place: ExplorePlaceProfile) {
  const v3 = readV3(place);
  const confidence = sourceConfidenceFromRecord(v3);
  let score = Number(v3.quality_score || 0);
  score = Math.max(score, confidence.score);
  const badge = getExploreSourceBadge(place);
  if (/official/i.test(badge)) score += 60;
  else if (/curated|community/i.test(badge)) score += 24;
  if (place.source_pack?.sources?.length) score += 12;
  if (place.summary.image_url || place.summary.thumbnail_url) score += 8;
  if (place.profile.summary || place.profile.why_it_matters) score += 6;
  return score;
}

function cleanExploreCopy(raw: string, place: ExplorePlaceProfile) {
  const key = getExploreCategoryKey(place);
  const title = getExploreDisplayTitle(place);
  let text = raw
    .replace(/\broute-ready\b/gi, 'ready')
    .replace(/\broute planner\b/gi, 'map')
    .replace(/\bplanning anchor\b/gi, 'stop')
    .replace(/\bsource pack\b/gi, 'details')
    .replace(/\bAI\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (isWeakExploreCopy(text, place)) {
    return FALLBACK_COPY[key] || `${title} has map details and current access checks.`;
  }
  if (/Use .+ as the overnight search area|gives camp search a real center|Start camp planning around .+ then narrow it with live results/i.test(text)) {
    return `${title} shows campground options for the area. Check reservations, access, rules, and closures.`;
  }
  if (/\b(campgrounds?|lodging|glamping|stays?)\b/i.test(title) && /Good for overnight planning|live map results|blank camp search|Search around .+ legal overnight options/i.test(text)) {
    return `${title} shows campground options for the area. Check reservations, access, rules, and closures.`;
  }
  if (/Trailhead groups .* records into one map-ready card list/i.test(text)) {
    return `${title} shows nearby trail access and overnight planning context. Check current access, closures, and conditions.`;
  }
  if (/when the route needs a softer landing|is for the night you want comfort|setup time matters more than roughing it/i.test(text)) {
    return `${title} is a comfort-focused stay option. Check booking, road access, and availability.`;
  }
  if (/weather or mileage makes camping less appealing/i.test(text)) {
    return `${title} gives you an indoor stay option near the area. Check booking and seasonal access.`;
  }
  if (/gives the drive a specific story to stop for|best treated as a real stop, not a quick pin/i.test(text)) {
    return `${title} is a focused stop with views, history, or short walks to check before you go.`;
  }
  if (/can decide where the rest of the day goes|better day anchor than a last-minute trail search|Use .+ to stage parking, camps/i.test(text)) {
    return `${title} has trailheads, parking, nearby stops, and current conditions to compare.`;
  }
  if (/when water and views matter|scenic pause/i.test(text)) {
    return `${title} has water access, views, and nearby stops to check before you go.`;
  }
  if (/works as a real day stop|not just a map label|when the route needs more than road miles|Put .+ on the route/i.test(text)) {
    if (key === 'parks') return `${title} has trails, viewpoints, access roads, and nearby stops to scout.`;
    if (key === 'water') return `${title} has water access, views, and nearby stops to check before you go.`;
    return FALLBACK_COPY[key] || `${title} has map details and current access checks.`;
  }
  if (/is the place to start looking for legal stays/i.test(text)) {
    return `${title} shows campground options for the area. Check reservations, access, rules, and closures.`;
  }
  return text;
}

function isWeakExploreCopy(text: string, place: ExplorePlaceProfile) {
  const clean = normalizeExploreCopyBlock(text);
  if (!clean || clean.length < 42) return true;
  if (WEAK_COPY_PATTERNS.some(pattern => pattern.test(clean))) return true;
  const title = normalizeExploreCopyBlock(getExploreDisplayTitle(place));
  if (title && clean.toLowerCase() === title.toLowerCase()) return true;
  return false;
}

function shortSeasonLabel(value: string) {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean) return 'Check season';
  if (/book|reservation/i.test(clean)) return 'Book early';
  if (/timed|hours?|entry/i.test(clean)) return 'Check hours';
  if (/weekend|holiday/i.test(clean)) return 'Book early';
  if (/permit/i.test(clean)) return 'Permit season';
  if (/road/i.test(clean)) return 'Road-open season';
  if (/year.?round/i.test(clean)) return clean.length > 28 ? 'Year-round' : clean;
  if (/spring/i.test(clean) && /summer/i.test(clean)) return 'Spring-summer';
  if (/spring/i.test(clean)) return 'Spring';
  if (/summer/i.test(clean)) return 'Summer';
  if (/fall|autumn/i.test(clean)) return 'Fall';
  if (/winter/i.test(clean)) return 'Winter';
  return clean.length > 24 ? 'Check season' : clean;
}
