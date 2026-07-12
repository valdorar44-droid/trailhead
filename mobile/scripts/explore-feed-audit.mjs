#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(mobileRoot, '..');

function read(path) {
  return readFileSync(path, 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
}

const guide = read(join(mobileRoot, 'app/(tabs)/guide.tsx'));
const api = read(join(mobileRoot, 'lib/api.ts'));
const card = read(join(mobileRoot, 'components/explore/ExplorePlaceCard.tsx'));
const homeControls = read(join(mobileRoot, 'components/explore/ExploreHomeControls.tsx'));
const filterRow = read(join(mobileRoot, 'components/explore/ExploreFilterRow.tsx'));
const mapPreview = read(join(mobileRoot, 'components/explore/StaticMapboxPreview.tsx'));
const guidedBrowser = read(join(mobileRoot, 'components/explore/GuidedDestinationBrowser.tsx'));
const categoryChips = read(join(mobileRoot, 'components/explore/ExploreCategoryChips.tsx'));
const categorySheet = read(join(mobileRoot, 'components/explore/ExploreCategoryFilterSheet.tsx'));
const rootLayout = read(join(mobileRoot, 'app/_layout.tsx'));
const server = read(join(repoRoot, 'dashboard/server.py'));

assert(
  server.includes('class ExplorePlacesBulkRequest') && server.includes('@app.post("/api/explore/places/bulk")'),
  'Explore bulk detail endpoint is missing.',
);
assert(
  server.includes('explore_places_bulk_v1:') && server.includes('ttl_hours'),
  'Explore bulk detail endpoint must use a cache key and expose cache metadata.',
);
assert(
  api.includes('getExplorePlacesBulk') && api.includes('/api/explore/places/bulk'),
  'Mobile API wrapper for bulk Explore detail hydration is missing.',
);
assert(
  guide.includes('exploreVisibleLimit + EXPLORE_VISIBLE_STEP') && guide.includes('getExplorePlacesBulk'),
  'Explorer feed must hydrate the visible page plus the next page with the bulk endpoint.',
);
assert(
  /for \(let index = 0; index < candidates\.length; index \+= 24\)/.test(guide),
  'Explorer bulk hydration should run in bounded chunks.',
);
assert(
  card.includes('StaticMapboxPreview') && !card.includes('seededFallback(') && mapPreview.includes('buildStaticMapboxUrl'),
  'Explore cards without real media must use a coordinate-specific map preview, not stock fallback imagery.',
);
assert(
  !rootLayout.includes('requestForegroundPermissionsAsync'),
  'App launch must not request location before the traveler selects a location-dependent workflow.',
);
assert(
  guide.includes("permission?.status === 'denied' && permission.canAskAgain === false")
    && guide.includes('openExploreLocationSettings')
    && guide.includes("if (permission?.status === 'granted')")
    && guide.includes('Linking.openSettings()'),
  'Explorer Nearby must provide a recovery path after location is permanently denied.',
);
assert(
  server.includes('EXPLORE_LOCAL_IMAGE_GENERIC_SLUG_WORDS') && server.includes('_explore_contextual_image_url(place, summary.get(key))'),
  'Explore detail responses must strip mismatched bundled local images before bulk hydration.',
);
assert(
  server.includes('area_fallback_used = False') && server.includes('not has_source_photo and area_image and not area_fallback_used'),
  'Nearby camps should not all inherit the same area fallback image.',
);
assert(
  !/Show\s+48\s+more/.test(guide),
  'Explore load-more text should stay count-aware instead of hard-coded.',
);
assert(
  guide.includes('loadNextExploreCatalogPage')
    && guide.includes('cursor,')
    && guide.includes('catalog.next_cursor')
    && guide.includes('setExplorePlaces(current => mergeMatchedExplorePlaces(current, remotePlaces))'),
  'Explore load-more must request cursor pages and merge them into the in-session catalog.',
);
assert(
  guide.includes('guidedOrganicFallbackFromPlaces')
    && guide.includes('EXPLORE_GUIDED_FALLBACK_CACHE_PREFIX')
    && guide.includes('api.getExploreCatalogIndex({ q: placeQuery, limit: 120, cursor: 0 })'),
  'Selected Guided destination failures must retain cached or catalog-backed nearby places.',
);
assert(
  guide.includes('imageUrl: mediaUrl(item.image_url)')
    && guide.includes('imageCredit: String(item.image_credit')
    && guidedBrowser.includes('imageUrl={destination.imageUrl}')
    && guidedBrowser.includes('Linking.openURL(destination.imageSourceUrl!)')
    && guidedBrowser.includes('Photo: {destination.imageCredit}')
    && guidedBrowser.includes('cardCopyBackdrop')
    && guidedBrowser.includes('adjustsFontSizeToFit')
    && mapPreview.includes('[imageUrl, mapUrl]')
    && mapPreview.includes("window.addEventListener('online', retryMedia)"),
  'Preloaded Guided destinations must render destination media, attribution, and a map fallback.',
);
assert(
  guide.includes('setGuidedTourSelectedDestinationKey(destination?.id ?? null)'),
  'Known typed Guided destinations must use the selected destination endpoint.',
);
assert(
  guide.includes('guidedTourCategoryDraft')
    && guide.includes('applyGuidedFilters')
    && guide.includes('setGuidedTourCategory(guidedTourCategoryDraft)'),
  'Guided filters must remain draft values until Apply is pressed.',
);
assert(
  homeControls.includes('showSort={!guidedMode}')
    && homeControls.includes('showSourceStatus={!guidedMode}'),
  'Guided browsing must not show unrelated Explorer sort or source-status controls.',
);
assert(
  !guide.includes('Explore catalog could not load')
    && !homeControls.includes('Source-backed')
    && !filterRow.includes('Source-backed')
    && !homeControls.includes('Checked details'),
  'Explorer copy must avoid implementation language and unqualified checked-detail claims.',
);
assert(
  categoryChips.includes("new Set<ExploreCategoryKey>(['fuel', 'resupply'])")
    && categorySheet.includes("item.key === 'fuel' || item.key === 'resupply'")
    && guide.includes('const radii = serviceCategory ? [35, 100, 250] : [35]')
    && guide.includes("candidates.filter(place => livePlaceMatchesCategory(place, serviceCategory))")
    && guide.includes("setExploreMode('nearby')"),
  'Fuel and Supplies filters must stay reachable and use widening, category-specific nearby searches.',
);

console.log('Explore feed audit passed.');
