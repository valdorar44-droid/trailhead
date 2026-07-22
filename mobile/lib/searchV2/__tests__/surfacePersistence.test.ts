import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const mapSource = readFileSync(resolve(testDirectory, '../../../app/(tabs)/map.tsx'), 'utf8');
const exploreSource = readFileSync(resolve(testDirectory, '../../../app/(tabs)/guide.tsx'), 'utf8');
const routeBuilderSource = readFileSync(resolve(testDirectory, '../../../app/(tabs)/route-builder.tsx'), 'utf8');
const searchSheetSource = readFileSync(resolve(testDirectory, '../../../components/search/SearchV2Sheet.tsx'), 'utf8');
const mapSearchSheetSource = readFileSync(resolve(testDirectory, '../../../components/map/MapSearchSheet.tsx'), 'utf8');
const premiumPlaceSheetSource = readFileSync(resolve(testDirectory, '../../../components/PremiumPlaceSheet.tsx'), 'utf8');

test('Map keeps account-owned offline inventory scoped and refreshes open Search V2 sessions', () => {
  assert.match(mapSource, /accountInventoryIsVisible\(/);
  assert.match(mapSource, /accountInventoryRequestIsCurrent\(/);
  assert.match(mapSource, /accountStorage\.isCleaning\(\) \|\| mapAccountTransitionBlocked/);
  assert.match(mapSource, /offlinePlaceInventoryRef\.current = nextInventory;/);
  assert.match(mapSource, /await mapSearchV2\.refreshOffline\(\);/);
});

test('Route Builder scopes places and trails, then refreshes Search V2 from the committed inventory refs', () => {
  assert.match(routeBuilderSource, /accountStorage\.isCleaning\(\) \|\| routeAccountTransitionBlocked/);
  assert.match(routeBuilderSource, /offlinePlaceInventoryRef\.current = nextInventory;/);
  assert.match(routeBuilderSource, /await routeSearchV2\.refreshOffline\(\);/);
  assert.match(routeBuilderSource, /setSavedTrailInventory\(\{[\s\S]*scope_key: requestScope\.key,/);
  assert.match(routeBuilderSource, /surface: 'route_editor' as const,[\s\S]*intent: 'any' as const,/);
  const directProviderHost = /nominatim[.]openstreetmap[.]org/i;
  assert.doesNotMatch(routeBuilderSource, directProviderHost);
  assert.doesNotMatch(mapSource, directProviderHost);
  assert.match(mapSource, /api\.geocodePlaces\(wp\.name, 1, \{ prefer: 'locality' \}\)/);
});

test('Explore hides account-owned rows during cleanup and rejects stale selections and offline commits', () => {
  assert.match(exploreSource, /accountInventoryRequiresCleanup\(/);
  assert.match(exploreSource, /accountInventoryIsVisible\(/);
  assert.match(exploreSource, /accountInventoryRequestIsCurrent\(/);
  assert.match(exploreSource, /exploreSearchOwnerIsCurrent = !exploreAccountLifecycle\.cleaning/);
  assert.match(exploreSource, /results=\{exploreSearchOwnerIsCurrent/);
  assert.match(exploreSource, /exploreOfflineInventoryRef\.current = emptyInventory;/);
  assert.match(exploreSource, /exploreSearchSelectionSeq\.current \+= 1;/);
});

test('Map and Explore retain useful rows while provider completion is still running', () => {
  assert.match(mapSource, /isSearching && mapSearchDisplayResults\.length === 0/);
  assert.match(mapSearchSheetSource, /searching && usableResults\.length === 0/);
  assert.match(searchSheetSource, /searchV2ShouldShowEmptyState\(\{[\s\S]*displayedQuery: query,[\s\S]*settledQuery,/);
  assert.match(exploreSource, /exploreSearchV2\.setQuery\(value\);/);
  assert.match(exploreSource, /settledQuery=\{exploreSearchV2\.state\.query\}/);
  assert.match(routeBuilderSource, /function updateRouteSearchQuery\(value: string\)[\s\S]*routeSearchV2\.setQuery\(value\);/);
  assert.match(routeBuilderSource, /emptyStateReady=\{routeSearchEmptyStateReady\}/);
  assert.doesNotMatch(searchSheetSource, /No matches yet/);
});

test('temporary place sheets expose session-safe actions only', () => {
  assert.match(premiumPlaceSheetSource, /const transientPlace = place \? isTransientMapboxPlace\(place\) : false;/);
  assert.match(premiumPlaceSheetSource, /!!onSave && !transientPlace/);
  assert.match(premiumPlaceSheetSource, /addToRoutePrimary && !!onAddToRoute && !transientPlace/);
  assert.match(premiumPlaceSheetSource, /!!onAddToRoute && !addToRoutePrimary && !transientPlace/);
  assert.match(premiumPlaceSheetSource, /!!onReport && !transientPlace/);
  const guardedCommunityBlocks = premiumPlaceSheetSource.match(/stage === 'full' && !transientPlace && \(/g) || [];
  assert.equal(guardedCommunityBlocks.length, 2);
});

test('temporary provider rows are not written to Map history or persisted by Route Builder', () => {
  const guardedHistoryWrites = mapSource.match(/if \(!searchPlaceIsTemporary\([^)]*\)\) \{\s*addSearchHistory/g) || [];
  assert.equal(guardedHistoryWrites.length, 2);
  assert.match(routeBuilderSource, /const temporaryProviderStop = inputStops\.find\(stop => searchPlaceIsTemporary\(stop\)\);/);
  assert.match(routeBuilderSource, /temporaryProviderStop[\s\S]*cannot be saved/);
});

test('Route Builder persists only resolved durable external destinations and keeps attribution', () => {
  assert.match(routeBuilderSource, /persistence_policy: wp\.search_source \? 'durable_external'/);
  assert.match(routeBuilderSource, /st\.persistence_policy === 'durable_external'/);
  assert.match(routeBuilderSource, /attribution: st\.source_attribution \|\| 'OpenStreetMap contributors'/);
  assert.match(routeBuilderSource, /That place is no longer available\. Search again or drop a pin\./);
});
