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
  | 'things'
  | 'guided'
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
  { key: 'resupply', label: 'Supplies', icon: 'basket-outline', color: '#7c3aed' },
  { key: 'things', label: 'Things', icon: 'compass-outline', color: '#0f766e' },
  { key: 'guided', label: 'Guided', icon: 'ticket-outline', color: '#d97706' },
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
  things: ['things to do', 'what to do', 'activity', 'activities', 'attraction', 'sights', 'see and do'],
  guided: ['tour', 'tours', 'experience', 'experiences', 'ticket', 'tickets', 'guide', 'guided', 'book', 'booking'],
  tours: ['tour', 'tours', 'experience', 'experiences', 'ticket', 'tickets', 'guide', 'guided', 'book', 'booking'],
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
  'things',
  'guided',
];

const FALLBACK_COPY: Record<string, string> = {
  camp: 'Camp options for the area. Check access, fees, closures, fire rules, and overnight limits.',
  glamping: 'Comfort-focused outdoor stay. Check booking rules, road conditions, and availability.',
  huts: 'Backcountry shelter or hut. Check reservations, condition, weather, and seasonal access.',
  trails: 'Trail area. Check route conditions, daylight, permits, and closures before starting.',
  trailheads: 'Trail access point. Confirm parking, road conditions, closures, and daylight before starting.',
  views: 'Scenic viewpoint for photos, short stops, and nearby trails.',
  peaks: 'Mountain or summit landmark. Check route, weather, access, and difficulty.',
  waterfalls: 'Waterfall or cascade. Check trail access, seasonal flow, closures, and slippery terrain.',
  springs: 'Thermal feature. Check legality, access, temperature, water safety, and local rules.',
  climb: 'Climbing area or crag. Check access, closures, route information, rules, and conditions.',
  fuel: 'Fuel or service stop. Check hours, availability, road access, and payment options.',
  resupply: 'Supply stop. Check hours, inventory, payment options, and road access before you go.',
  things: 'Activities, viewpoints, trails, stops, and visitor options from public sources.',
  guided: 'Guided trips will return when bookings are available. Free things to do still show here.',
  tours: 'Guided trips will return when bookings are available. Free things to do still show here.',
  water: 'Water access or feature. Check safety, access, seasonal conditions, and local rules.',
  scenic: 'Scenic stop for photos, short walks, and nearby exploration.',
  parks: 'Outdoor destination. Check official access, fees, closures, and local rules before setting dates.',
  land: 'Public land or managed area. Check land rules, camping limits, access, and current restrictions.',
};

const THIN_OPEN_REFERENCE_PATTERNS = [
  /\bUse it to stage trail time, nearby stays, weather, and map context\b/i,
  /\bUse this card for map context, nearby stops, weather, and access checks\b/i,
  /\badds a real named destination to Explore\b/i,
  /\bOpen global Explore\b/i,
  /\bFallback global Explore\b/i,
  /\bsource-backed Explore destination\b/i,
  /\broute planning can connect map, weather, nearby stops\b/i,
  /\bOpen nearby camps, services, weather, and trails before\b/i,
  /\bsafer overnight or weather-reset lead\b/i,
  /\bday anchor for nearby camps\b/i,
  /\bdrive-by pin\b/i,
];

const WEAK_COPY_PATTERNS = [
  /\bmay refer to\b/i,
  /\b(disambiguation|wikimedia|wikidata)\b/i,
  /\b(undefined|null|nan)\b/i,
  /\bis a managed outdoor area near\b/i,
  /\bCheck official access, fees, closures, permits, weather\b/i,
  ...THIN_OPEN_REFERENCE_PATTERNS,
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

const COUNTRY_ALIASES: Array<[string, string[]]> = [
  ['united states', ['united states', 'usa', 'u.s.', 'u.s.a.']],
  ['canada', ['canada']],
  ['mexico', ['mexico']],
  ['switzerland', ['switzerland', 'swiss']],
  ['austria', ['austria']],
  ['italy', ['italy', 'italian']],
  ['france', ['france', 'french']],
  ['germany', ['germany', 'german']],
  ['spain', ['spain', 'spanish']],
  ['portugal', ['portugal']],
  ['norway', ['norway', 'norwegian']],
  ['sweden', ['sweden', 'swedish']],
  ['finland', ['finland', 'finnish']],
  ['iceland', ['iceland', 'icelandic']],
  ['ireland', ['ireland', 'irish']],
  ['united kingdom', ['united kingdom', 'uk', 'u.k.', 'england', 'scotland', 'wales']],
  ['australia', ['australia', 'australian']],
  ['new zealand', ['new zealand']],
  ['japan', ['japan', 'japanese']],
];

function normalizedWords(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function textLooksLikeStay(value: string) {
  return /\b(inn|hotel|motel|lodge|lodging|cabin|cabins|hut|huts|shelter|hostel|resort|glamping|yurt|overnight stay|place to stay|places to stay)\b/.test(value);
}

function countryMentions(value: string) {
  const normalized = normalizedWords(value);
  const countries = new Set<string>();
  for (const [country, aliases] of COUNTRY_ALIASES) {
    if (aliases.some(alias => new RegExp(`(^|\\s)${normalizedWords(alias).replace(/\s+/g, '\\s+')}($|\\s)`).test(normalized))) {
      countries.add(country);
    }
  }
  return countries;
}

function locationNeedlesForPlace(place: ExplorePlaceProfile) {
  const location = compact([
    readV3(place).card?.region,
    place.summary.state,
    place.summary.region,
  ]).join(' ');
  const normalized = normalizedWords(location);
  const parts = normalized
    .split(' ')
    .filter(part => part.length >= 5 && !/^(canton|county|state|province|region|national|park|district|municipality|republic|kingdom|united)$/.test(part));
  return new Set(parts);
}

export function isExploreLocationMismatchCopy(value: string | null | undefined, place: ExplorePlaceProfile) {
  const clean = normalizeExploreCopyBlock(value);
  if (!clean) return false;
  const placeCountries = countryMentions(compact([
    readV3(place).card?.region,
    place.summary.state,
    place.summary.region,
  ]).join(' '));
  const copyCountries = countryMentions(clean);
  if (!placeCountries.size || !copyCountries.size) return false;
  if ([...placeCountries].some(country => copyCountries.has(country))) return false;
  const normalizedCopy = normalizedWords(clean);
  if ([...locationNeedlesForPlace(place)].some(part => new RegExp(`(^|\\s)${part}($|\\s)`).test(normalizedCopy))) return false;
  return true;
}

export function cleanSourcePublisherLabel(value?: string | null) {
  const clean = String(value || '').trim();
  if (!clean) return '';
  return clean.replace(/\b(blm|nps|usfs|usgs|nws)\b/gi, match => match.toUpperCase());
}

function looksLikeRawRecordText(value?: string | null) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  if (clean.length < 40 || !/^[{[]/.test(clean)) return false;
  return /['"](?:id|title|category|summary|source_pack|lat|lng|canonical_name)['"]\s*:/.test(clean);
}

function isSourceOnlyDisplayLabel(value?: string | null) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  return [
    'national park service',
    'nps',
    'us forest service',
    'u.s. forest service',
    'forest service',
    'recreation.gov',
    'ridb',
    'blm',
    'bureau of land management',
    'fws',
    'us fish and wildlife service',
    'public lands',
    'trailhead',
  ].includes(clean);
}

export function normalizeExploreCopyBlock(value?: string | null) {
  if (looksLikeRawRecordText(value)) return '';
  return String(value || '')
    .replace(/<\s*br\s*\/?>/gi, '. ')
    .replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, '. ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\bscenic-route anchor\b/gi, 'scenic route stop')
    .replace(/\bscenic route anchor\b/gi, 'scenic route stop')
    .replace(/\broute-area anchor\b/gi, 'route area')
    .replace(/\bmountain route anchor\b/gi, 'mountain route')
    .replace(/\bUse it for route context, weather checks, access research, and nearby trail planning\.?/gi, 'Check weather, access, local guidance, and nearby trail options before planning around it.')
    .replace(/\bUse this as access context only\.?/gi, 'Access notes only.')
    .replace(/\bUse this for ([^.]*?) trekking context\.?/gi, 'Good for $1 trek planning.')
    .replace(/\bUse this for ([^.]*?) context\.?/gi, 'Good for $1 planning.')
    .replace(/\bUse this for\b/gi, 'Good for')
    .replace(/\bUse it for\b/gi, 'Good for')
    .replace(/\bUse this when\b/gi, 'Good when')
    .replace(/\bUse it when\b/gi, 'Good when')
    .replace(/\bday anchor\b/gi, 'day stop')
    .replace(/\bovernight anchor\b/gi, 'overnight option')
    .replace(/\broute anchor\b/gi, 'route stop')
    .replace(/\bplanning anchor\b/gi, 'stop')
    .replace(/\bclassic overnight option\b/gi, 'reliable overnight option')
    .replace(/\bbefore relying on it\b/gi, 'before you go')
    .replace(/\bVerify\b/g, 'Check')
    .replace(/\bverify\b/g, 'check')
    .replace(/\bUse it for context, photos, and a cleaner break in the drive\b/gi, 'Good for a focused stop, photos, and a cleaner break in the drive')
    .replace(/\bUse it for a reset night when camping every day stops sounding fun\b/gi, 'Good for a reset night between camp days')
    .replace(/\bUse it when a hike should decide the day, not just fill an hour\b/gi, 'Good when a hike should shape the day')
    .replace(/\bGood for staging the route before and after trail time\b/gi, 'Good before or after trail time')
    .replace(/\bUse it for a recovery night or a safer end to a hard day\b/gi, 'Good for a recovery night or a safer end to a hard day')
    .replace(/\bYosemite\s+NP\b/gi, 'Yosemite National Park')
    .replace(/\b([A-Z][A-Za-z][A-Za-z .&'-]{1,80})\s+NP\s+Preserve\b/g, '$1 National Park Preserve')
    .replace(/\b([A-Z][A-Za-z][A-Za-z .&'-]{1,80})\s+NP\b/g, '$1 National Park')
    .replace(/\s+has area details around\s+/gi, ' covers access near ')
    .replace(/([a-z0-9])\.([A-Z])/g, '$1. $2')
    .replace(/\bClick the reservation button below for details\.?/gi, '')
    .replace(/\bUse the reservation button below for details\.?/gi, '')
    .replace(/\bClick below for details\.?/gi, '')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/(?:\.\s*){2,}/g, '. ')
    .replace(/\s+/g, ' ')
    .trim();
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
  return clean;
}

export function sentenceAwarePreviewText(value?: string | null, maxChars = 220) {
  const preview = sentenceAwarePreview(value, maxChars);
  if (!preview.text) return '';
  return preview.expandable ? withPreviewEllipsis(preview.text) : preview.text;
}

function categoryFromText(text: string): ExploreCategoryKey | null {
  if (!text) return null;
  if (/\b(things?|activities|activity|things to do|what to do|see and do|visitor center|visitor centre|nature center|nature centre|contact station|interpretive center|interpretive centre|environmental education|ranger station|shooting range|rifle range)\b/.test(text)) return 'things';
  if (/\bday use\b/.test(text)) return 'things';
  if (/waterfall|falls|cascade/.test(text)) return 'waterfalls';
  if (/hot spring|thermal|soak/.test(text)) return 'springs';
  if (/trailhead|trail head/.test(text)) return 'trailheads';
  if (/\b(trails?|treks?|trekking|ohv|route)\b/.test(text)) return 'trails';
  if (/\b(glamp|private stay|yurts?)\b/.test(text)) return 'glamping';
  if (textLooksLikeStay(text) || /hut|shelter|refuge|cabin|lodg/.test(text)) return 'huts';
  if (/\b(campgrounds?|campsites?|camping|camp|rv|tent|overnight)\b/.test(text)) return 'camp';
  if (/viewpoint|overlook|lookout|vista|view\b/.test(text)) return 'views';
  if (/\b(peaks?|summit|mountain)\b/.test(text)) return 'peaks';
  if (/\b(climb|crag|boulder)\b/.test(text)) return 'climb';
  if (/\b(fuel|gas|diesel|petrol)\b/.test(text)) return 'fuel';
  if (/\b(resupply|grocery|gear|supplies|market)\b/.test(text)) return 'resupply';
  if (/\b(tour|experience|ticket|guided|guide|booking|book)\b/.test(text)) return 'guided';
  if (/\b(hikes?|hiking)\b/.test(text)) return 'trails';
  if (/\b(lake|river|shore|beach|marina|boat|water)\b/.test(text)) return 'water';
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
  return /\b(campgrounds?|campsites?|camping|glamping|huts?|cabins?|lodges?|lodging|inn|hotel|motel|resort|trails?|trailheads?|visitor centers?|parking|rv|tent|overnight|tours?|activities|things to do|places to stay|where to stay)\b/.test(text);
}

function categoryFromGroup(text: string): ExploreCategoryKey | null {
  if (!text) return null;
  if (/\b(things?|activities|activity)\b/.test(text)) return 'things';
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
  const title = String(v3.card?.title || v3.name || place.summary.title || 'Explore stop').trim();
  const letters = title.replace(/[^a-z]/gi, '');
  if (letters.length >= 4) {
    const upperRatio = letters.replace(/[^A-Z]/g, '').length / letters.length;
    if (upperRatio >= 0.85) {
      return title
        .toLowerCase()
        .replace(/\b\w/g, char => char.toUpperCase())
        .replace(/\b(Rv|Ohv|Atv|Usfs|Blm)\b/g, token => token.toUpperCase());
    }
  }
  return title;
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
  ])
    .map(part => String(part || '').trim())
    .filter(part => part && !isSourceOnlyDisplayLabel(part))
    .filter((part, index, parts) => parts.indexOf(part) === index)
    .join(' · ');
}

export function getExploreCategoryKey(place: ExplorePlaceProfile): ExploreCategoryKey {
  const v3 = readV3(place);
  const titleText = normalize(getExploreDisplayTitle(place));
  const destinationTitle = categoryFromDestinationTitle(titleText);
  const nestedDestinationTitle = isNestedDestinationTitle(titleText);
  const primaryExplicit = categoryFromText(normalize(compact([
    v3.category,
    place.summary.category,
  ]).join(' ')));
  const explicit = primaryExplicit || categoryFromText(normalize(compact([
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
  if (isOpenKnowledgePublisher(primary)) return 'Check locally';
  if (quality.includes('official')) {
    return 'Current access';
  }
  if (quality.includes('wiki') || /wikipedia|wikidata|wikimedia/i.test(facts.source_title || primary)) return 'Check locally';
  if (primary || sources.length > 1 || place.source_pack?.sources?.length) return 'Check details';
  return 'Check access';
}

export function getExploreTrustBadge(place: ExplorePlaceProfile) {
  const confidence = sourceConfidenceFromRecord(readV3(place));
  if (confidence.score >= 85) return 'Current access';
  if (confidence.score >= 65) return 'Check details';
  const badge = getExploreSourceBadge(place);
  if (/official|current access/i.test(badge)) return 'Current access';
  if (/community|curated|multiple|area details|check details/i.test(badge)) return 'Check details';
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
  const badge = getExploreSourceBadge(place);
  if (/check locally/i.test(badge)) return 'Confirm locally';
  if (/current access/i.test(badge)) return 'Current access';
  return 'Check current status';
}

export function getExploreCardSourceLine(place: ExplorePlaceProfile) {
  return compact([
    getExploreTrustBadge(place),
    getExploreBestSeason(place),
  ]).filter((part, index, parts) => parts.indexOf(part) === index).join(' · ');
}

export function getExploreSourceRows(place: ExplorePlaceProfile): ExploreSourceRow[] {
  const v3 = readV3(place);
  const facts = place.facts ?? {};
  const sourceBadge = getExploreSourceBadge(place);
  const season = getExploreBestSeason(place);
  const confidence = sourceConfidenceFromRecord(v3);
  const officialUrl = place.source_pack?.official_url || facts.official_url || place.summary.source_url || facts.source_url;
  const rows: ExploreSourceRow[] = [
    {
      label: 'Access',
      value: /current access/i.test(sourceBadge) ? 'Current access' : 'Check current access',
      icon: /current access/i.test(sourceBadge) ? 'shield-checkmark-outline' : 'map-outline',
      tone: /current access/i.test(sourceBadge) ? '#16a34a' : '#2563eb',
    },
    {
      label: 'Season',
      value: season,
      icon: 'calendar-outline',
      tone: facts.last_updated ? '#16a34a' : '#ca8a04',
    },
    {
      label: 'Details',
      value: confidence.score >= 65 || /official/i.test(sourceBadge) ? 'Current details' : 'Check before going',
      icon: 'shield-outline',
      tone: confidence.score >= 65 || /official/i.test(sourceBadge) ? '#0ea5e9' : '#ca8a04',
    },
  ];
  if (officialUrl) {
    rows.push({
      label: 'Website',
      value: /viator|booking/i.test(String(officialUrl)) ? 'Booking page' : 'Official website',
      icon: 'open-outline',
      tone: '#f97316',
    });
  }
  return rows;
}

export function getExploreCardSummary(place: ExplorePlaceProfile) {
  const v3 = readV3(place);
  const key = getExploreCategoryKey(place);
  return cleanExploreCopy(String(
    v3.card?.summary ||
    place.summary.short_description ||
    place.profile.summary ||
    v3.card?.highlight ||
    place.summary.hook ||
    v3.card?.headline ||
    FALLBACK_COPY[key] ||
    'Check access before you go.',
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
        ? 'Trail areas work best with clear route type, nearby stops, and current conditions.'
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
    facts.push({ label: 'Check access', icon: 'trail-sign-outline', tone: '#16a34a' });
  } else if (key === 'waterfalls' || key === 'views') {
    facts.push({ label: key === 'waterfalls' ? 'Viewpoints nearby' : 'Scenic stop', icon: 'binoculars-outline', tone: '#15803d' });
  } else if (key === 'fuel') {
    facts.push({ label: 'Check hours', icon: 'car-outline', tone: '#ea580c' });
  } else if (key === 'resupply') {
    facts.push({ label: 'Check supply', icon: 'basket-outline', tone: '#7c3aed' });
  } else if (key === 'trails' || key === 'trailheads' || key === 'climb') {
    facts.push({ label: 'Trail access', icon: 'walk-outline', tone: '#f97316' });
  } else if (key === 'peaks') {
    facts.push({ label: 'Mountain', icon: 'triangle-outline', tone: '#2563eb' });
  } else {
    facts.push({ label: 'Details', icon: 'navigate-outline', tone: '#2563eb' });
  }
  facts.push({ label: getExploreBestSeason(place), icon: 'calendar-outline', tone: '#c4552d' });
  facts.push({ label: getExploreTrustBadge(place), icon: 'shield-checkmark-outline', tone: '#2563eb' });
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
      { label: 'Drop', value: explicitFacts[0] || 'Check height', icon: 'water-outline', tone: '#0284c7' },
      { label: 'Access', value: explicitFacts[1] || compact([place.profile.access_notes, 'Open area']).join(' · ') || 'Check trailhead', icon: 'trail-sign-outline', tone: '#16a34a' },
      { label: 'Best Flow', value: explicitFacts[2] || getExploreBestSeason(place), icon: 'calendar-outline', tone: '#ca8a04' },
      { label: 'Safety', value: explicitFacts[3] || 'Wet rock, ice, closures', icon: 'alert-circle-outline', tone: '#dc2626' },
    ];
  }

  if (key === 'trails' || key === 'trailheads' || key === 'climb') {
    const distance = text.match(/\b(\d+(?:\.\d+)?)\s?(mi|mile|miles|km|kilometer|kilometers)\b/);
    const difficulty = text.match(/\b(easy|moderate|strenuous|hard|difficult|expert|beginner|advanced)\b/);
    const distanceFact = explicitFacts.find((fact: string) => /\b\d+(?:\.\d+)?\s?mi\b/i.test(fact));
    const difficultyFact = explicitFacts.find((fact: string) => /\b(easy|moderate|strenuous|hard|very hard|difficult|expert|beginner|advanced)\b/i.test(fact));
    const activityFact = explicitFacts.find((fact: string) => /\b(hiking trail|ohv route|bike trail|snowmobile route|horse trail|water route|hiking|mountain biking|horseback riding|4x4)\b/i.test(fact));
    const surfaceFact = explicitFacts.find((fact: string) => /\b(surface|paved|gravel|snow route|water route|boardwalk|natural surface|compacted)\b/i.test(fact));
    const loopLikely = /\b(loop|lollipop|circuit)\b/.test(text);
    const pointToPoint = /\b(point to point|point-to-point|through hike|thru hike)\b/.test(text);
    return [
      { label: 'Route', value: activityFact || (loopLikely ? 'Loop likely' : pointToPoint ? 'Point-to-point' : 'Trail route'), icon: 'git-compare-outline', tone: '#f97316' },
      { label: 'Distance', value: distanceFact || (distance ? `${distance[1]} ${distance[2].replace('mile', 'mi').replace('kilometer', 'km')}` : 'Check route'), icon: 'walk-outline', tone: '#16a34a' },
      { label: 'Difficulty', value: difficultyFact || (difficulty ? difficulty[1].replace(/^\w/, c => c.toUpperCase()) : 'Check grade'), icon: 'trending-up-outline', tone: '#7c3aed' },
      { label: 'Surface', value: surfaceFact || 'Check conditions', icon: 'trail-sign-outline', tone: '#2563eb' },
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

function exploreLooksLikeBlockedViewItem(place: ExplorePlaceProfile) {
  const text = normalize(compact([
    getExploreDisplayTitle(place),
    getExploreDisplayCategory(place),
    place.summary.hook,
    place.summary.short_description,
    place.profile.summary,
    ...(place.summary.tags ?? []),
  ]).join(' '));
  return /\b(bus stop|shuttle|entrance station|restaurant|steakhouse|cafe|grill|market|store|bookstore|kennel|conservancy|clinic|medical|healthcare|visitor center|exhibit|talk|program|parking|restroom|trailhead|campground|campgrounds|campsite|cemetery|lodge|lodging|hotel|motel|appeared about|rocks are|geologically speaking)\b/.test(text);
}

function exploreLooksLikeViewItem(place: ExplorePlaceProfile) {
  if (exploreLooksLikeBlockedViewItem(place)) return false;
  const key = getExploreCategoryKey(place);
  if (key === 'waterfalls' || key === 'peaks' || key === 'views') return true;
  const text = normalize(compact([
    getExploreDisplayTitle(place),
    place.summary.hook,
    place.summary.short_description,
    place.profile.summary,
    ...(place.summary.tags ?? []),
  ]).join(' '));
  return /\b(viewpoint|overlook|vista|scenic|window|rim|fault|fossil|canyon|mountain|summit|arch|bridge|falls|waterfall|loop)\b/.test(text);
}

function exploreLooksLikeWaterItem(place: ExplorePlaceProfile) {
  const v3 = readV3(place);
  const text = normalize(compact([
    getExploreDisplayTitle(place),
    getExploreDisplayCategory(place),
    place.summary.category,
    place.summary.explore_group,
    place.summary.hook,
    place.summary.short_description,
    place.profile.summary,
    ...(place.summary.tags ?? []),
    ...(Array.isArray(v3.search_aliases) ? v3.search_aliases : []),
  ]).join(' '));
  return /\b(lake|lakes|river|rivers|creek|creeks|shore|shoreline|beach|beaches|marina|boat|boating|canoe|kayak|water|waterfall|falls|cascade|spring|springs|bay|sound|coast|coastal|ocean|sea|island|islands)\b/.test(text);
}

export function exploreCategoryMatches(place: ExplorePlaceProfile, selected: ExploreCategoryKey) {
  if (selected === 'all') return true;
  if (selected === 'guided' || selected === 'tours') return false;
  if (selected === 'nearby') return true;
  const key = getExploreCategoryKey(place);
  if (selected === 'views') {
    return ['views', 'scenic', 'waterfalls', 'peaks'].includes(key) && exploreLooksLikeViewItem(place);
  }
  if (selected === 'water') {
    return ['water', 'waterfalls', 'springs'].includes(key)
      || (['views', 'scenic', 'parks', 'land', 'trails', 'trailheads'].includes(key) && exploreLooksLikeWaterItem(place));
  }
  if (selected === 'things') {
    const sourcePack = place.source_pack ?? {};
    if (Array.isArray(sourcePack.things_to_do) && sourcePack.things_to_do.length > 0) return true;
    if (key === 'things') return true;
    if (['camp', 'glamping', 'huts', 'fuel', 'resupply', 'guided', 'tours'].includes(key)) return false;
    return ['parks', 'land', 'trails', 'trailheads', 'views', 'waterfalls', 'peaks', 'springs', 'climb', 'water', 'scenic'].includes(key);
  }
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

export function isExploreThinOpenReference(place: ExplorePlaceProfile) {
  const v3 = readV3(place);
  const sourcePack = place.source_pack ?? {};
  const sourceText = compact([
    place.attribution,
    place.quality,
    v3.source_quality,
    v3.source_confidence,
    sourcePack.quality,
    sourcePack.primary,
    sourcePack.source_note,
    place.summary.source_title,
    ...(Array.isArray(place.sources) ? place.sources.flatMap((source: any) => [
      source?.publisher,
      source?.name,
      source?.title,
      source?.kind,
    ]) : []),
    ...(Array.isArray(sourcePack.sources) ? sourcePack.sources.flatMap((source: any) => [
      source?.publisher,
      source?.name,
      source?.title,
      source?.kind,
    ]) : []),
  ]).join(' ');
  const copyText = compact([
    v3.card?.summary,
    v3.card?.headline,
    place.summary.hook,
    place.summary.short_description,
    place.profile.summary,
    place.profile.why_it_matters,
    place.profile.nearby_context,
    sourcePack.source_note,
  ]).join(' ');
  const openKnowledge = isOpenKnowledgePublisher(sourceText);
  if (THIN_OPEN_REFERENCE_PATTERNS.some(pattern => pattern.test(copyText))) return true;
  if (!openKnowledge) return false;
  const hasRicherMedia = Boolean(place.summary.image_url || place.summary.thumbnail_url || (Array.isArray(v3.media) && v3.media.length));
  const hasNestedDetails = Boolean(
    (Array.isArray(v3.trails) && v3.trails.length)
    || (Array.isArray(sourcePack.things_to_do) && sourcePack.things_to_do.length)
    || (Array.isArray(sourcePack.things_to_see) && sourcePack.things_to_see.length)
    || (Array.isArray(sourcePack.campgrounds) && sourcePack.campgrounds.length)
  );
  return !hasRicherMedia && !hasNestedDetails && isWeakExploreCopy(copyText, place);
}

export function exploreContentQualityScore(place: ExplorePlaceProfile) {
  const v3 = readV3(place);
  const sourcePack = place.source_pack ?? {};
  let score = 0;
  if (place.summary.image_url || place.summary.thumbnail_url || (Array.isArray(v3.media) && v3.media.length)) score += 24;
  if (v3.card?.summary || v3.card?.headline || v3.card?.highlight) score += 18;
  if (place.profile.summary && !isWeakExploreCopy(place.profile.summary, place)) score += 14;
  if (place.profile.story && !isWeakExploreCopy(place.profile.story, place)) score += 10;
  if (Array.isArray(v3.trails) && v3.trails.length) score += Math.min(20, v3.trails.length * 4);
  if (Array.isArray(sourcePack.things_to_do) && sourcePack.things_to_do.length) score += Math.min(16, sourcePack.things_to_do.length * 3);
  if (Array.isArray(sourcePack.things_to_see) && sourcePack.things_to_see.length) score += Math.min(16, sourcePack.things_to_see.length * 3);
  if (Array.isArray(sourcePack.campgrounds) && sourcePack.campgrounds.length) score += Math.min(12, sourcePack.campgrounds.length * 3);
  if (isExploreThinOpenReference(place)) score -= 70;
  return score;
}

function cleanExploreCopy(raw: string, place: ExplorePlaceProfile) {
  const key = getExploreCategoryKey(place);
  const title = getExploreDisplayTitle(place);
  const campHubCopy = `${title} has nearby campground options. Check access, fees, rules, and seasonal closures before picking a night.`;
  if (looksLikeRawRecordText(raw)) {
    return FALLBACK_COPY[key] || `${title} has current access notes to check before you go.`;
  }
  let text = raw
    .replace(/\broute-ready\b/gi, 'ready')
    .replace(/\broute planner\b/gi, 'map')
    .replace(/\bscenic-route anchor\b/gi, 'scenic route stop')
    .replace(/\bscenic route anchor\b/gi, 'scenic route stop')
    .replace(/\broute-area anchor\b/gi, 'route area')
    .replace(/\bmountain route anchor\b/gi, 'mountain route')
    .replace(/\bday anchor\b/gi, 'day stop')
    .replace(/\bovernight anchor\b/gi, 'overnight option')
    .replace(/\broute anchor\b/gi, 'route stop')
    .replace(/\bplanning anchor\b/gi, 'stop')
    .replace(/\bclassic overnight option\b/gi, 'reliable overnight option')
    .replace(/\bUse it for context, photos, and a cleaner break in the drive\b/gi, 'Good for a focused stop, photos, and a cleaner break in the drive')
    .replace(/\bUse it for a reset night when camping every day stops sounding fun\b/gi, 'Good for a reset night between camp days')
    .replace(/\bUse it when a hike should decide the day, not just fill an hour\b/gi, 'Good when a hike should shape the day')
    .replace(/\bGood for staging the route before and after trail time\b/gi, 'Good before or after trail time')
    .replace(/\bUse it for a recovery night or a safer end to a hard day\b/gi, 'Good for a recovery night or a safer end to a hard day')
    .replace(/\bYosemite\s+NP\b/gi, 'Yosemite National Park')
    .replace(/\s+has area details around\s+/gi, ' covers access near ')
    .replace(/\s+has area details\.\s*/gi, ' has current access notes. ')
    .replace(/\bThis stop is a managed outdoor area\.?\s*/gi, '')
    .replace(/\bis a managed outdoor area\.?\s*/gi, ' has access notes to check. ')
    .replace(/\bmanaged outdoor area\b/gi, 'outdoor stop')
    .replace(/\b(?:a|an)\s+0\.\d+\s+miles?\s+trail\b/gi, 'a short trail under 1 mile')
    .replace(/\b(?:a|an)\s+0\.\d+\s+miles?\b/gi, 'under 1 mile')
    .replace(/\b0\.\d+\s+miles?\b/gi, 'under 1 mile')
    .replace(/\b0\.\d+\s+mi\b/gi, 'under 1 mi')
    .replace(/\b(\d+)\.0\s+miles?\b/gi, (_match, value) => `${value} ${Number(value) === 1 ? 'mile' : 'miles'}`)
    .replace(/\b(\d+)\.0\s+mi\b/gi, '$1 mi')
    .replace(/([a-z0-9])\.([A-Z])/g, '$1. $2')
    .replace(/\bsource pack\b/gi, 'details')
    .replace(/\bAI\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^Use it as a day stop when the drive needs more than mileage/i.test(text)) {
    return `${title} is a worthwhile stop. Check access, fees, closures, and overnight rules before you go.`;
  }
  if (/^Use this as a protected-area anchor/i.test(text)) {
    return `${title} covers protected-area planning. Confirm permits, guide requirements, road access, weather, and safety conditions before travel.`;
  }
  text = text.replace(/^Use\s+(.+?)\s+as\s+a\s+(.+?)\./i, (_match, name, role) => `${name} is a ${role}.`);
  if (/^it is a day stop when the drive needs more than mileage/i.test(text)) {
    return `${title} is a worthwhile stop. Check access, fees, closures, and overnight rules before you go.`;
  }
  text = text.replace(/^under 1 mile\b/i, 'Under 1 mile');
  text = text.replace(/\s+has access notes to check\.\s+near\s+[^.]+\.?\s*/i, ' has access notes to check before you go. ');
  text = text.replace(/\b(has access notes to check before you go)\.\s+Check current access, fees, closures, permits, weather, and nearby services before you go\.?/gi, '$1.');
  if (
    key === 'camp'
    && /\b(live results|live map results|blank (?:map|camp) search|legal overnight options|overnight search area|camp search a real center|place to start looking for legal stays|shows campground options|good for overnight planning)\b/i.test(text)
  ) {
    return campHubCopy;
  }
  if (isExploreLocationMismatchCopy(text, place)) {
    if (key === 'peaks') return `${title} is a mountain target. Check route, weather, access, and current conditions before you go.`;
    if (key === 'trails' || key === 'trailheads' || key === 'climb') return `${title} has trails and route options nearby. Check access, weather, permits, and current conditions before you go.`;
    if (key === 'water') return `${title} has water access, views, and nearby stops to check before you go.`;
    if (key === 'camp') return campHubCopy;
    if (key === 'glamping' || key === 'huts') return `${title} has stay options nearby. Check booking, access, rules, and closures.`;
    return FALLBACK_COPY[key] || `${title} has current access notes to check before you go.`;
  }
  if (/Use it to stage trail time, nearby stays, weather, and map context|Use this card for map context, nearby stops, weather, and access checks/i.test(text)) {
    if (key === 'peaks') return `${title} is a mountain target. Check route, weather, access, and current conditions before you go.`;
    if (key === 'trails' || key === 'trailheads' || key === 'climb') return `${title} has trails and route options nearby. Check access, weather, permits, and current conditions before you go.`;
    return `${title} has access notes to compare with weather, nearby stops, and current conditions.`;
  }
  if (/safer overnight or weather-reset lead|Verify reservations, seasonal access, food, hut rules, and route approach/i.test(text)) {
    return `${title} is a hut or shelter option. Check reservations, seasonal access, route approach, and current conditions.`;
  }
  if (/Build around this only if the reservation and access details work/i.test(text)) {
    return `${title} is a lodging option. Check reservation timing, access, food, shuttles, and operating dates.`;
  }
  if (/Use it as a day stop when the drive needs more than mileage/i.test(text)) {
    return `${title} is a worthwhile stop. Check access, fees, closures, and overnight rules before you go.`;
  }
  if (/Build extra time around this stop, especially if weather or crowds matter/i.test(text)) {
    return `${title} is worth extra time when weather or crowds matter. Check access, fees, closures, and overnight rules.`;
  }
  if (/day (?:anchor|stop) for nearby camps, trailheads, access notes, and weather/i.test(text)) {
    return `${title} has nearby camps, trails, access notes, and weather to check before setting dates.`;
  }
  if (/Use it for photos, route timing, nearby trail context, and weather checks/i.test(text)) {
    return `${title} is a scenic stop. Check access, seasonal conditions, and local rules before you go.`;
  }
  if (/drive-by pin|Plan time to stop, walk, and read the place/i.test(text)) {
    return `${title} is a history or landmark stop. Check hours, tickets, access, and local rules.`;
  }
  if (/Use it to start a camp search near a real destination/i.test(text)) {
    return campHubCopy;
  }
  if (/Use this as .*K2\/Baltoro route area/i.test(text)) {
    return `${title} covers the K2/Baltoro trek area. Confirm permits, guides, road access, glacier conditions, and rescue logistics before travel.`;
  }
  if (/Use this as orientation only/i.test(text)) {
    return `${title} is an orientation point. Confirm local conditions, guide support, permits, and access before travel.`;
  }
  if (/Use this as .*route area/i.test(text)) {
    return `${title} is a route area. Check permits, access, seasonal conditions, local support, and safety logistics before travel.`;
  }
  if (/^(.+?)\s+is a\s+(fuel|gas|diesel|petrol)\.\s+Check\b/i.test(text)) {
    return `${title} is a fuel stop. Check hours, access, current conditions, and payment options before you go.`;
  }
  if (/^(.+?)\s+is a\s+(resupply|grocery|market|shop|supplies|repair|service)\.\s+Check\b/i.test(text)) {
    return `${title} is a supply stop. Check hours, access, and current services before you go.`;
  }
  const waterfallFallback = text.match(/^(.+?)\s+is a waterfall or cascade near\s+([^.]+)\.\s+Check trail access, seasonal flow, closures, water levels, and slippery terrain before visiting\.?$/i);
  if (waterfallFallback) {
    return `Waterfall near ${waterfallFallback[2]}. Check trail access, seasonal flow, closures, and slippery terrain before visiting.`;
  }
  const mappedFallback = text.match(/^(.+?)\s+is mapped as\s+([a-z\s-]+)\s+in OpenStreetMap\.\s+Verify access, current conditions, and local rules before relying on it\.?$/i);
  if (mappedFallback) {
    const mappedType = mappedFallback[2].trim();
    if (/\b(fuel|gas|diesel|petrol)\b/i.test(mappedType)) {
      return `${title} is a fuel stop. Check hours, access, current conditions, and payment options before you go.`;
    }
    if (/\b(resupply|grocery|market|shop|supplies|repair|service)\b/i.test(mappedType)) {
      return `${title} is a supply stop. Check hours, access, and current services before you go.`;
    }
    return `${title} is a ${mappedType}. Check access, current conditions, and local rules before you go.`;
  }
  const mappedTrailFallback = text.match(/^(.+?)\s+is a mapped trail area near\s+([^.]+)\.\s+Check route conditions, daylight, permits, and closures before starting\.?$/i);
  if (mappedTrailFallback) {
    return `Trail area near ${mappedTrailFallback[2]}. Check route conditions, daylight, permits, and closures before starting.`;
  }
  const trailTargetFallback = text.match(/^(.+?)\s+is a trail target\.\s+Check route, access, weather, permits, and current conditions before you go\.?$/i);
  if (trailTargetFallback) {
    return `${title} has trails and route options nearby. Check access, weather, permits, and current conditions before you go.`;
  }
  if (isWeakExploreCopy(text, place)) {
    return FALLBACK_COPY[key] || `${title} has current access notes to check before you go.`;
  }
  if (/Use .+ as the overnight search area|gives camp search a real center|Start camp planning around .+ then narrow it with live results/i.test(text)) {
    return campHubCopy;
  }
  if (/\b(campgrounds?|lodging|glamping|stays?)\b/i.test(title) && /Good for overnight planning|live map results|blank camp search|Search around .+ legal overnight options/i.test(text)) {
    return key === 'camp' ? campHubCopy : `${title} has stay options nearby. Check booking, access, rules, and closures.`;
  }
  if (/Trailhead groups .* records into one map-ready card list/i.test(text)) {
    return `${title} shows nearby trail access and overnight planning context. Check current access, closures, and conditions.`;
  }
  if (/when the route needs a softer landing|is for the night you want comfort|setup time matters more than roughing it/i.test(text)) {
    return `${title} is a comfort-focused stay option. Check booking, road access, and availability.`;
  }
  if (/Good for a reset night between camp days/i.test(text)) {
    const region = getExploreDisplayRegion(place);
    const usableRegion = /^[A-Z]{2}$/.test(region) ? '' : region;
    return `${title} is a comfortable stay option${usableRegion ? ` near ${usableRegion}` : ''}. Check booking, access, rules, and closures.`;
  }
  if (/Good before or after trail time|Good when a hike should shape the day/i.test(text)) {
    return `${title} has trail access, nearby stops, and conditions to check before you go.`;
  }
  if (/weather or mileage makes camping less appealing/i.test(text)) {
    const region = getExploreDisplayRegion(place);
    const usableRegion = /^[A-Z]{2}$/.test(region) ? '' : region;
    return `${title} gives you an indoor stay option${usableRegion ? ` near ${usableRegion}` : ''}. Check booking and seasonal access.`;
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
    return FALLBACK_COPY[key] || `${title} has current access notes to check before you go.`;
  }
  if (/is the place to start looking for legal stays/i.test(text)) {
    return campHubCopy;
  }
  return text;
}

function isWeakExploreCopy(text: string, place: ExplorePlaceProfile) {
  const clean = normalizeExploreCopyBlock(text);
  if (!clean) return true;
  if (looksLikeTrailFactSummary(clean, place)) return false;
  if (clean.length < 42) return true;
  if (WEAK_COPY_PATTERNS.some(pattern => pattern.test(clean))) return true;
  const title = normalizeExploreCopyBlock(getExploreDisplayTitle(place));
  if (title && clean.toLowerCase() === title.toLowerCase()) return true;
  return false;
}

function looksLikeTrailFactSummary(text: string, place: ExplorePlaceProfile) {
  const key = getExploreCategoryKey(place);
  if (key !== 'trails' && key !== 'trailheads' && key !== 'climb') return false;
  const clean = normalizeExploreCopyBlock(text);
  if (!clean) return false;
  const hasDistance = /\b\d+(?:\.\d+)?\s*(?:mi|mile|miles|km|kilometer|kilometers)\b/i.test(clean);
  const hasShortAccess = /\bshort trail access\b/i.test(clean);
  const hasTrailFact = /\b(loop|out-and-back|point-to-point|easy|moderate|hard|very hard|hiking trail|bike trail|horse trail|ohv route|snowmobile route|natural surface|paved|gravel|singletrack)\b/i.test(clean);
  return (hasDistance || hasShortAccess) && hasTrailFact;
}

function shortSeasonLabel(value: string) {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean) return 'Check season';
  if (/book|reservation/i.test(clean)) return 'Book early';
  if (/timed|hours?|entry/i.test(clean)) return 'Check hours';
  if (/weekend|holiday/i.test(clean)) return 'Book early';
  if (/permit/i.test(clean)) return 'Permit season';
  if (/road/i.test(clean)) return 'Check roads';
  if (/year.?round/i.test(clean)) return clean.length > 28 ? 'Year-round' : clean;
  if (/spring/i.test(clean) && /summer/i.test(clean)) return 'Spring-summer';
  if (/spring/i.test(clean)) return 'Spring';
  if (/summer/i.test(clean)) return 'Summer';
  if (/fall|autumn/i.test(clean)) return 'Fall';
  if (/winter/i.test(clean)) return 'Winter';
  return clean.length > 24 ? 'Check season' : clean;
}
