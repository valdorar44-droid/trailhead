import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function source(relativePath) {
  return fs.readFileSync(path.resolve(relativePath), 'utf8');
}

function requireSelectors(relativePath, selectors) {
  const text = source(relativePath);
  for (const selector of selectors) {
    assert.ok(
      text.includes(`testID="${selector}"`),
      `${relativePath} must expose stable selector ${selector}`,
    );
  }
  return text;
}

const map = requireSelectors('app/(tabs)/map.tsx', [
  'map.location-disclosure',
  'map.location-disclosure.continue',
  'map.location-disclosure.not-now',
  'map.trip-overview',
  'map.trip-overview.timeline',
  'map.trip-overview.start',
  'map.trip-overview.brief-backup',
  'map.trip-overview.packing-list',
  'map.trip-overview.notes',
]);
assert.match(map, /testID=\{`map\.trip-overview\.day\.\$\{day\.day\}`\}/);
assert.match(map, /testID=\{`map\.trip-overview\.day\.\$\{day\.day\}\.start`\}/);

const mapLayers = requireSelectors('components/map/MapLayerSheetContent.tsx', [
  'map.layers.style-carousel',
  'map.layers.toggle-carousel',
  'map.layers.tool-carousel',
]);
assert.match(mapLayers, /testID=\{`map\.layers\.toggle\.\$\{layer\.key\}`\}/);
assert.match(mapLayers, /accessibilityRole="switch"/);
assert.match(mapLayers, /accessibilityState=\{\{ checked: layer\.val \}\}/);

requireSelectors('app/(tabs)/guide.tsx', ['explore.screen', 'explore.scroll']);
const exploreHero = requireSelectors('components/explore/ExploreHero.tsx', [
  'explore.hero',
  'explore.search.open',
  'explore.search.input',
  'explore.search.clear',
  'explore.categories',
  'explore.category.originals',
]);
assert.match(exploreHero, /testID=\{`explore\.category\.\$\{key\}`\}/);

const mainOriginal = requireSelectors('components/originals/OriginalsMapPlayerSheet.tsx', [
  'originals.player.sheet',
  'originals.player.minimize',
  'originals.player.pause-resume',
  'originals.player.end',
]);
assert.match(mainOriginal, /testID=\{testID\}/, 'Original player action helpers must forward their selector');

requireSelectors('app/originals/player.tsx', [
  'originals.legacy-player.screen',
  'originals.legacy-player.minimize',
  'originals.legacy-player.pause-resume',
  'originals.legacy-player.end',
]);

requireSelectors('app/originals/[id].tsx', [
  'original.detail.screen',
  'original.detail.scroll',
  'original.detail.back',
  'original.detail.share',
  'original.detail.primary',
  'original.download.overlay',
  'original.download.sheet',
  'original.download.close',
  'original.download.progress',
  'original.download.action',
  'original.start.overlay',
  'original.start.sheet',
  'original.start.close',
  'original.start.disclosure',
  'original.start.confirm',
  'original.start.continue',
  'original.start.not-now',
  'original.start.simulate',
]);

const downloads = requireSelectors('components/NativeMap/OfflineModal.tsx', [
  'offline.downloads.modal',
  'offline.downloads.close',
  'offline.downloads.storage',
  'offline.downloads.area.status',
  'offline.downloads.area.progress',
  'offline.downloads.area.pause-resume',
  'offline.downloads.area.download',
  'offline.downloads.trip.status',
  'offline.downloads.trip.progress',
  'offline.downloads.trip.pause-resume',
  'offline.downloads.trip.download',
  'offline.downloads.remove-confirmation.remove',
]);
assert.match(downloads, /testID=\{`offline\.downloads\.item\.\$\{safePackId\(item\.id\)\}`\}/);
assert.match(downloads, /testID=\{testID\}/, 'Offline action helpers must forward their selector');

requireSelectors('app/(tabs)/trips.tsx', [
  'plan.trips.screen',
  'plan.trips.scroll',
  'plan.trips.anchor',
  'plan.originals.anchor',
  'plan.downloads.anchor',
  'plan.downloads.manage',
  'plan.saved.anchor',
]);
const planSwitcher = source('components/plan/PlanWorkspaceSwitcher.tsx');
assert.match(planSwitcher, /testID=\{`plan\.workspace\.\$\{workspace\.id\}`\}/);
const tripFilters = source('components/trips/TripFilterSegment.tsx');
assert.match(tripFilters, /testID=\{`plan\.trip-filter\.\$\{filter\.id\}`\}/);
assert.match(tripFilters, /testID="plan\.trip-filter\.select-drafts"/);
const tripCards = source('components/trips/TripCard.tsx');
assert.match(tripCards, /testID=\{`plan\.trip\.\$\{trip\.id\}`\}/);
assert.match(tripCards, /testID=\{`plan\.trip\.\$\{trip\.id\}\.more`\}/);
const tripActions = requireSelectors('components/trips/TripActionSheet.tsx', [
  'plan.trip-actions.sheet',
  'plan.trip-actions.backdrop',
  'plan.trip-actions.cancel',
]);
assert.match(tripActions, /testID=\{`plan\.trip-actions\.\$\{action\.id\}`\}/);
const savedItems = source('components/trips/SavedItemsSection.tsx');
assert.match(savedItems, /testID=\{`plan\.saved\.item\.\$\{item\.id\}`\}/);
for (const selector of ['plan.saved.browse', 'plan.saved.empty.browse', 'plan.saved.show-more']) {
  assert.ok(savedItems.includes(`testID="${selector}"`), `Saved items expose stable selector ${selector}`);
}
requireSelectors('components/trips/AvailabilityWatchManager.tsx', [
  'plan.watches.manage',
  'plan.watches.open',
  'plan.watches.sheet',
  'plan.watches.close',
  'plan.watches.retry',
]);
const ownedOriginals = requireSelectors('components/originals/OwnedOriginalsSection.tsx', [
  'plan.originals.section',
  'plan.originals.retry',
  'plan.originals.restore',
]);
assert.match(ownedOriginals, /testID=\{`plan\.originals\.item\.\$\{item\.id\}\.\$\{item\.version\}`\}/);
requireSelectors('components/offline/OfflineDownloadsSection.tsx', ['offline.v2-downloads.section', 'offline.v2-downloads.list']);

requireSelectors('app/(tabs)/profile.tsx', ['profile.qa.telemetry.open']);
requireSelectors('app/qa/telemetry.tsx', [
  'qa.telemetry.blocked',
  'qa.telemetry.screen',
  'qa.telemetry.close',
  'qa.telemetry.status',
  'qa.telemetry.javascript-exception',
  'qa.telemetry.performance-span',
  'qa.telemetry.native-crash.state',
  'qa.telemetry.native-crash.acknowledgement',
  'qa.telemetry.native-crash',
  'qa.telemetry.release-identity',
  'qa.telemetry.snapshot.refresh',
  'qa.telemetry.snapshot',
  'qa.search-race.status',
  'qa.search-race.run',
  'qa.search-race.evidence',
  'qa.search-race.stale',
  'qa.search-race.no-auto-open',
  'qa.search-race.explicit-selection',
]);

console.log('Automation selector contract tests passed.');
