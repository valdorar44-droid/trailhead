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
const detailSheet = read(join(mobileRoot, 'components/explore/ExploreDetailSheet.tsx'));
const trailArea = read(join(mobileRoot, 'components/explore/ExploreTrailArea.tsx'));
const rootLayout = read(join(mobileRoot, 'app/_layout.tsx'));
const server = read(join(repoRoot, 'dashboard/server.py'));
const nearbyContext = read(join(mobileRoot, 'lib/exploreNearbyContext.ts'));
const originalsShelf = read(join(mobileRoot, 'components/originals/OriginalsShelf.tsx'));
const ownedOriginals = read(join(mobileRoot, 'components/originals/OwnedOriginalsSection.tsx'));
const originalsUiService = read(join(mobileRoot, 'components/originals/originalsUiService.ts'));
const tripLibraryAdapter = read(join(mobileRoot, 'components/trips/trip-library-adapter.ts'));
const tripRepositorySync = read(join(mobileRoot, 'lib/tripRepositorySync.ts'));

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
    && guide.includes("setExploreMode('nearby')")
    && guide.includes('resolveExploreNearbySearchCenter(')
    && guide.includes("exploreNearbySearchCenter?.source === 'destination'"),
  'Fuel and Supplies filters must retain selected destinations and use widening, category-specific nearby searches.',
);
assert(
  nearbyContext.includes('serviceDestinationQueryFromExploreQuery')
    && nearbyContext.includes('SERVICE_DESTINATION_ONLY_TERMS')
    && guide.includes("api.resolveGeocodePlace(query, 5, { prefer: 'search_center' })")
    && guide.includes('guidedDestinationContextActive || !!resolvedServiceDestinationCenter')
    && guide.includes('exploreServiceDestinationQuery ? null : userLoc'),
  'Fuel and Supplies must resolve ordinary destination searches before using device location.',
);
assert(
  guide.includes('|| exploreServiceDestinationQuery\n    ) return;')
    && guide.includes('exploreServiceDestinationResolving')
    && guide.includes('exploreServiceDestinationFailed'),
  'Explore must not request location while resolving an ordinary service destination.',
);
assert(
  server.includes('and (not requested or _explore_place_matches_category_request(place, requested))')
    && server.includes('selected_global = category_matches if effective_category else global_profiles')
    && !server.includes('global_relaxed_ids'),
  'Explore destination fallbacks must preserve the requested category.',
);
const categorySelection = guide.match(
  /function selectExploreHomeCategory\(key: ExploreCategoryKey\) \{([\s\S]*?)\n  \}\n\n  function handleExploreQueryChange/,
)?.[1] ?? '';
assert(
  categorySelection.length > 0 && !categorySelection.includes("setExploreQuery('')"),
  'Explore category changes must preserve the typed destination.',
);
assert(
  guide.includes('function exploreCatalogQueryForDestinationContext(')
    && guide.includes("normalizeExploreText(query) !== normalizeExploreText(guidedQuery)")
    && guide.includes('return center.name.trim();')
    && guide.includes('const exploreCatalogRequestQuery = useMemo(')
    && guide.includes('q: requestQuery.length >= 2 ? requestQuery : undefined')
    && guide.includes('const matchedQuery = normalizeExploreText(visibleQuery);')
    && guide.includes('const matchedQuery = normalizeExploreText(exploreQuery);'),
  'Explore must use the selected Guided destination name for catalog requests while preserving the visible query.',
);
assert(
  categorySelection.includes('guidedDestinationContextActive')
    && !categorySelection.includes("if (key !== 'guided' && key !== 'tours') setGuidedTourSelectedDestinationKey(null)"),
  'Explore category changes must retain the selected Guided destination context.',
);
const queryChange = guide.match(
  /function handleExploreQueryChange\(value: string\) \{([\s\S]*?)\n  \}\n\n  function renderLandingHeader/,
)?.[1] ?? '';
assert(
  queryChange.includes('keepsGuidedDestination')
    && queryChange.includes('setGuidedTourSelectedCenter(null)')
    && queryChange.includes('setGuidedTourSelectedDestinationKey(null)')
    && queryChange.includes('setGuidedTourSearchRunId(0)')
    && guide.includes("onClearQuery={() => handleExploreQueryChange('')}"),
  'Editing or clearing an Explore destination must clear stale Guided destination context.',
);
assert(
  guide.includes(") : !exploreError && !tourSearchPaused && !showExperienceSearch"),
  'Explore must not stack its normal empty view beneath a loading error.',
);
assert(
  guide.includes('routeDisabled={!!activeTrip && isExploreAddedToTrip(selectedExplore)}')
    && detailSheet.includes('disabled={disabled}')
    && detailSheet.includes('accessibilityState={{ disabled, selected: disabled }}'),
  'Places already added to the active trip must expose a disabled completed action.',
);
assert(
  trailArea.includes('Directions to trailhead')
    && !trailArea.includes('Route preview')
    && !trailArea.includes('TrailMiniMap'),
  'Trail actions must offer directions to the trailhead without a decorative route preview.',
);
assert(
  guide.includes('{showExploreHome ? <OriginalsShelf /> : null}')
    && !originalsShelf.includes('TrailheadRailSkeleton')
    && originalsShelf.includes("studioOnly ? 'Originals Studio' : 'Self-guided drives'")
    && originalsShelf.includes("isAdmin ? 'Open Originals Studio' : 'See all Trailhead Originals'")
    && originalsShelf.includes("isAdmin ? 'Studio' : 'All'")
    && originalsShelf.includes("if (!isAdmin && visible.length === 0) return null;"),
  'Originals discovery must stay on Explore home, avoid a disabled loading flash, and retain a stable admin Studio entry.',
);
assert(
  ownedOriginals.includes('requestRef.current')
    && ownedOriginals.includes('if (items.length === 0 && !scopedView.error) return null;')
    && ownedOriginals.includes('Your Originals')
    && ownedOriginals.includes('Downloads and listening progress')
    && ownedOriginals.includes('Try again')
    && !ownedOriginals.includes('Browse Trailhead Originals'),
  'Trips must show a scope-safe ownership library, retain retry/Restore recovery, and stay hidden only for verified empty accounts.',
);
const ownedOriginalsService = originalsUiService.match(
  /export async function listOwnedOriginals\(\)[^{]*\{([\s\S]*?)\n\}\n\nexport async function restoreOwnedOriginals/,
)?.[1] ?? '';
assert(
  ownedOriginalsService.length > 0
    && !ownedOriginalsService.includes('listOriginals(')
    && ownedOriginalsService.includes('originalSummaryForLocalAccess(access)')
    && ownedOriginalsService.includes('requestEpoch = accountStorage.epoch()'),
  'The Trips Originals library must not load the public catalog and must retain undownloaded local ownership within one account epoch.',
);
assert(
  tripRepositorySync.includes('experienceRef: tripExperienceRefFromApi(item.experience_ref)')
    && tripLibraryAdapter.includes('.filter(document => !isTrailheadOriginalTripDocument(document))')
    && api.includes("'experience_ref'>"),
  'Server-owned Original provenance must keep cloned fulfillment trips out of the editable Plan trip list and out of client writes.',
);

console.log('Explore feed audit passed.');
