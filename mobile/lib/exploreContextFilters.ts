import type { ExploreSourcePackItem } from '@/lib/api';

type SourcePackLike = Partial<ExploreSourcePackItem> & {
  name?: string | null;
  summary?: string | null;
  details?: string | null;
  display_type?: string | null;
  subtype?: string | null;
  type?: string | null;
  website?: string | null;
  official_url?: string | null;
};

export type RelatedContextPlace = {
  id?: string | number;
  name?: string;
  lat: number;
  lng: number;
  type?: string;
  subtype?: string;
  display_type?: string;
  source?: string;
  source_label?: string;
  distance_mi?: number;
  route_distance_mi?: number;
  photo_url?: string | null;
  length_mi?: number | null;
  website?: string;
  official_url?: string;
  summary?: string;
  description?: string;
  details?: string;
};

function compactText(value?: string | number | null) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function sourceText(item?: SourcePackLike | null) {
  return String(item?.source || item?.source_label || '').toLowerCase();
}

function itemTitle(item?: SourcePackLike | null) {
  return compactText(item?.title || item?.name);
}

function itemKind(item?: SourcePackLike | null) {
  return compactText(item?.kind || item?.category || item?.display_type || item?.subtype || item?.type).toLowerCase();
}

function itemUrl(item?: SourcePackLike | null) {
  return compactText(item?.url || item?.official_url || item?.website).toLowerCase();
}

function itemBody(item?: SourcePackLike | null) {
  return compactText(item?.description || item?.summary || item?.details);
}

export function cleanExploreSourceLabel(label?: string | null, fallback = 'Explore Area') {
  const clean = compactText(label);
  if (!clean) return fallback;
  if (/trailhead\s+northern\s+pakistan\s+trek\s+catalog/i.test(clean)) return 'Trek Area';
  if (/trailhead\s+trail\s+catalog/i.test(clean)) return 'Trail Area';
  if (/trailhead\s+explore/i.test(clean)) return fallback;
  if (/wikidata|wikipedia|wikimedia|multiple sources/i.test(clean)) return fallback;
  if (/offline\s+place\s+pack|downloaded\s+place\s+packs/i.test(clean)) return 'Downloaded Places';
  return clean;
}

export function sourcePackItemLooksLikeArticle(item?: SourcePackLike | null) {
  const source = sourceText(item);
  const kind = itemKind(item);
  const url = itemUrl(item);
  const title = itemTitle(item).toLowerCase();
  const description = itemBody(item).toLowerCase();
  if (/(^|\/)(articles|news|stories)\//.test(url)) return true;
  if (/\/learn\/(nature|history|science|photosmultimedia)\//.test(url)) return true;
  if (/\b(article|news|story|research|publication|collection)\b/.test(kind)) return true;
  if (/nps|national park service/.test(source)) {
    return /\b(species database|species spotlight|nifty finds|humanities research|photograph collection|bioaccumulation|cracking the code|research methods|holding the line|conservation across the national park service)\b/.test(title);
  }
  if (/\b(disambiguation|wikidata|wikipedia extract)\b/.test(description)) return true;
  return false;
}

export function sourcePackItemCanShow(item?: SourcePackLike | null) {
  const title = itemTitle(item);
  if (!title || /^(places?|things to do|details?|overview)$/i.test(title)) return false;
  return !sourcePackItemLooksLikeArticle(item);
}

function sourcePackItemDedupeKey(item?: SourcePackLike | null) {
  const title = itemTitle(item).toLowerCase();
  const kind = itemKind(item).replace(/[^a-z0-9]+/g, '-');
  if (title) return `${kind}:${title.replace(/[^a-z0-9]+/g, ' ').trim()}`;
  return String(item?.source_id || itemUrl(item)).toLowerCase();
}

export function uniqueSourcePackItems<T extends SourcePackLike>(items: T[]) {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of items) {
    const key = sourcePackItemDedupeKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

export function sourcePackItemLooksLikeActivity(item?: SourcePackLike | null) {
  const text = [
    itemTitle(item),
    itemBody(item),
    itemKind(item),
    itemUrl(item),
  ].join(' ').toLowerCase();
  return /\b(hikes?|hiking|trail|walk|walking|drive|driving|road|tour|program|ranger|visit|visitor|birding|wildlife watching|watching safety|scenic|overlook|viewpoint|camp|camping|fish|fishing|boat|boating|paddle|paddling|kayak|climb|climbing|bike|biking|cycle|cycling|horse|ride|ski|snowshoe|lodge|historic)\b/.test(text);
}

export function sourcePackItemLooksLikeSpeciesProfile(item?: SourcePackLike | null) {
  const source = sourceText(item);
  const title = itemTitle(item).toLowerCase();
  const description = itemBody(item).toLowerCase();
  const url = itemUrl(item);
  if (!/nps|national park service/.test(source)) return false;
  if (/\b(watch|watching|view|viewing|safety|drive|hike|trail|tour|program|visit|visitor|lodge|road|walk|camp|fish|boat|bike|climb|birding)\b/.test(title)) {
    return false;
  }
  const animalTitle = /\b(duck|osprey|loon|owl|eagle|thrush|dipper|woodpecker|ptarmigan|bluebird|weasel|wolverine|pika|otter|lion|goat|sheep|moose|marmot|coyote|squirrel|lynx|bobcat|beaver|bear|bat|marten|bison|elk|deer|wolf|fox|snake|turtle|frog|salmon|trout|fish|bird|raptor|insect|mammal|wildlife)\b/.test(title);
  const plantTitle = /\b(huckleberry|elderberry|berry|pine|fir|spruce|cedar|willow|cottonwood|aspen|maple|oak|wildflower|flower|grass|sedge|moss|lichen|plant|flora|shrub|tree)\b/.test(title);
  const profileCopy = /\b(species|subspecies|genus|family|feathers|wings|fur|rodent|mammal|bird|reproductive|habitat|predator|prey|listed as|scientific name|native plant|berries|leaf|leaves|flowers|shrub|tree)\b/.test(description);
  const npsProfileUrl = /\/(thingstodo|places)\/[^/]+\.htm$/.test(url);
  return ((animalTitle || plantTitle) && (profileCopy || npsProfileUrl)) || (npsProfileUrl && /\([^)]*(berry|plant|tree|flower|grass|shrub)[^)]*\)/.test(title));
}

export function sourcePackThingToDoCanShow(item?: SourcePackLike | null) {
  return sourcePackItemCanShow(item) && !sourcePackItemLooksLikeSpeciesProfile(item) && sourcePackItemLooksLikeActivity(item);
}

export function sourcePackThingToSeeCanShow(item?: SourcePackLike | null) {
  if (!sourcePackItemCanShow(item) || sourcePackItemLooksLikeSpeciesProfile(item)) return false;
  const title = itemTitle(item).toLowerCase();
  const kind = itemKind(item);
  const text = `${title} ${itemBody(item).toLowerCase()} ${kind}`;
  if (/\b(campgrounds?|rv park|lodging|hotel|motel|cabin|fuel|gas|grocery|restaurant)\b/.test(text)) return false;
  if (/\b(trailhead|parking|picnic area|restroom)\b/.test(text)) return false;
  return /\b(view|overlook|vista|falls?|waterfall|lake|river|creek|glacier|canyon|arch|bridge|peak|pass|summit|historic|museum|site|landmark|beach|spring|scenic|road|visitor center|lighthouse|ruins?)\b/.test(text)
    || /\b(viewpoint|peak|pass|glacier|bridge|attraction)\b/.test(kind);
}

function relatedToSourcePackLike(item?: RelatedContextPlace | null): SourcePackLike {
  return {
    name: item?.name,
    title: item?.name,
    description: item?.description || item?.summary || item?.details,
    summary: item?.summary,
    details: item?.details,
    kind: item?.display_type || item?.subtype || item?.type,
    category: item?.type,
    type: item?.type,
    subtype: item?.subtype,
    display_type: item?.display_type,
    source: item?.source,
    source_label: item?.source_label,
    url: item?.official_url || item?.website,
  };
}

export function relatedPlaceCanShow(item?: RelatedContextPlace | null) {
  if (!item?.name) return false;
  return sourcePackItemCanShow(relatedToSourcePackLike(item)) && !sourcePackItemLooksLikeSpeciesProfile(relatedToSourcePackLike(item));
}

export function relatedPlaceLooksLikeGenericRoad(item?: RelatedContextPlace | null) {
  const like = relatedToSourcePackLike(item);
  const title = itemTitle(like).toLowerCase();
  if (!/\b(?:road|rd|route|highway|hwy)\b/.test(title)) return false;
  if (/\b(trail|trailhead|scenic|historic|drive|byway|loop|overlook|viewpoint)\b/.test(title)) return false;
  const context = `${itemBody(like).toLowerCase()} ${itemKind(like)} ${itemUrl(like)}`;
  return !/\b(trail|trailhead|scenic|historic|drive|byway|overlook|viewpoint|hike|walk|visitor|waterfall|falls)\b/.test(context);
}

export function relatedTrailCanShow(item?: RelatedContextPlace | null) {
  if (!relatedPlaceCanShow(item) || relatedPlaceLooksLikeGenericRoad(item)) return false;
  const like = relatedToSourcePackLike(item);
  const title = itemTitle(like).toLowerCase();
  if (/\b(?:national forest development road|forest(?: service)? road|nf-?\d|fs-?\d|fr\s*\d|road\s*\d+[a-z]?|rd\s*\d)\b/.test(title)) {
    return false;
  }
  if (/\b(?:road|rd|route|highway|hwy|drive|dr|byway)\b/.test(title) && !/\b(?:trail|trailhead|path|walk|loop|overlook|viewpoint|falls?|waterfall|summit|pass)\b/.test(title)) {
    return false;
  }
  const context = `${title} ${itemBody(like).toLowerCase()} ${itemKind(like)}`;
  return /\b(?:trail|trailhead|hike|hiking|walk|footpath|singletrack|summit|pass|falls?|waterfall|lake|creek|canyon)\b/.test(context)
    || Number.isFinite(Number(item?.length_mi));
}

export function relatedThingToDoCanShow(item?: RelatedContextPlace | null) {
  const like = relatedToSourcePackLike(item);
  return relatedPlaceCanShow(item)
    && !relatedPlaceLooksLikeGenericRoad(item)
    && !/\bpodcast\b/i.test(itemTitle(like))
    && sourcePackItemLooksLikeActivity(like);
}

export function relatedThingToSeeCanShow(item?: RelatedContextPlace | null) {
  return relatedPlaceCanShow(item) && sourcePackThingToSeeCanShow(relatedToSourcePackLike(item));
}

export function uniqueRelatedPlaces<T extends RelatedContextPlace>(items: T[]) {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of items) {
    const key = relatedPlaceDedupeKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

export function relatedPlaceNameKey(item?: RelatedContextPlace | null) {
  return String(item?.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function relatedPlaceDedupeKey(item?: RelatedContextPlace | null) {
  const lat = Number(item?.lat);
  const lng = Number(item?.lng);
  return [
    String(item?.id || ''),
    relatedPlaceNameKey(item),
    Number.isFinite(lat) ? lat.toFixed(4) : '',
    Number.isFinite(lng) ? lng.toFixed(4) : '',
  ].filter(Boolean).join(':');
}
